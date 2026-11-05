// SPDX-License-Identifier: MIT
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregate } from './aggregate.js';
import { assertLabel, renderCsv } from './csv.js';
import {
  aggregateMonth,
  dhis2Period,
  earliestMonthRelease,
  isAllowedDhis2OutDir,
  RESTRICTED_NOTICE,
  isMonth,
  parseDistricts,
  parseMapping,
  renderDhis2,
  toDataValueSets,
} from './dhis2.js';
import { parseEvents } from './events.js';
import { earliestRelease, isDate, isIsoWeek, RELEASE_LAG_DAYS } from './release.js';
import { generateSampleEvents, renderJsonl } from './sample.js';

export interface CliIo {
  /** The directory relative paths are resolved against. */
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

export const TEST_LABEL = 'TEST DATA: synthetic, not real people';

const USAGE = [
  'Usage:',
  '  siapso-open-data build --input <events.jsonl> --week <YYYY-Www> --release <rN>',
  '                         --release-date <YYYY-MM-DD> --out-dir <dir> [--test] [--label <text>]',
  '  siapso-open-data dhis2 --input <events.jsonl> --month <YYYY-MM> --release <rN>',
  '                         --release-date <YYYY-MM-DD> --districts <districts.yaml> --mapping <mapping.yaml>',
  '                         --out-dir <dir> [--test]',
  '  siapso-open-data sample --output <events.jsonl> [--label <text>]',
  '',
  'build   publish one ISO week once, as <week>-<release>[-test].csv in the output directory.',
  `        Refused before ${String(RELEASE_LAG_DAYS)} days after the week ends, and when the week already has a file.`,
  '        Events of other weeks are dropped. --test marks the file as synthetic test data.',
  'dhis2   export one month as DHIS2 dataValueSets JSON, <YYYYMM>-<release>-restricted[-test].json, once.',
  `        Refused before ${String(RELEASE_LAG_DAYS)} days after the month ends, when the month already has a file,`,
  '        and while the mapping holds a placeholder. See docs/dhis2.md.',
  'sample  write the deterministic synthetic test events',
];

interface Options {
  input?: string;
  output?: string;
  label?: string;
  week?: string;
  release?: string;
  releaseDate?: string;
  outDir?: string;
  month?: string;
  districts?: string;
  mapping?: string;
  test: boolean;
}

const VALUE_FLAGS = {
  '--input': 'input',
  '--output': 'output',
  '--label': 'label',
  '--week': 'week',
  '--release': 'release',
  '--release-date': 'releaseDate',
  '--out-dir': 'outDir',
  '--month': 'month',
  '--districts': 'districts',
  '--mapping': 'mapping',
} as const;

function parseOptions(args: string[]): Options | undefined {
  const options: Options = { test: false };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i] ?? '';
    if (flag === '--test') {
      options.test = true;
    } else if (flag in VALUE_FLAGS) {
      const value = args[i + 1];
      if (value === undefined) return undefined;
      options[VALUE_FLAGS[flag as keyof typeof VALUE_FLAGS]] = value;
      i += 1;
    } else {
      return undefined;
    }
  }
  return options;
}

async function writeNew(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
}

async function publishedFilesOfWeek(dir: string, week: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const pattern = new RegExp(`^${week}-r[0-9]+(-test)?\\.csv$`);
  return names.filter((name) => pattern.test(name));
}

class UsageError extends Error {}

async function build(options: Options, io: CliIo): Promise<void> {
  const { input, week, release, releaseDate, outDir } = options;
  if (
    input === undefined ||
    week === undefined ||
    release === undefined ||
    releaseDate === undefined ||
    outDir === undefined
  ) {
    throw new UsageError('missing option');
  }
  if (!isIsoWeek(week)) throw new Error(`Not an ISO week: ${week}`);
  if (!/^r[1-9][0-9]*$/.test(release)) throw new Error('The release id must look like r1, r2.');
  if (!isDate(releaseDate)) throw new Error('The release date must be a real date, YYYY-MM-DD.');
  const earliest = earliestRelease(week);
  if (releaseDate < earliest) {
    throw new Error(
      `${week} cannot be published before ${earliest} (${String(RELEASE_LAG_DAYS)} days after the week ends).`,
    );
  }
  let label = options.label;
  if (options.test) {
    label ??= TEST_LABEL;
    if (!label.startsWith('TEST DATA'))
      throw new Error('A test file label must start with TEST DATA.');
  } else if (label?.startsWith('TEST DATA') === true) {
    throw new Error('A label starting with TEST DATA needs --test.');
  }
  if (label !== undefined) assertLabel(label);
  const directory = path.resolve(io.cwd, outDir);
  const existing = await publishedFilesOfWeek(directory, week);
  if (existing.length > 0) {
    throw new Error(
      `${week} is already published (${existing.join(', ')}). Published files are immutable: ` +
        'withdraw the file first to replace it (see open-data/README.md).',
    );
  }
  const events = parseEvents(await readFile(path.resolve(io.cwd, input), 'utf8'));
  const result = aggregate(events, week);
  const name = `${week}-${release}${options.test ? '-test' : ''}.csv`;
  await writeNew(path.join(directory, name), renderCsv(result, label));
  const dropped = events.filter((event) => event.week !== week).length;
  const published = result.rows.filter((row) => row.status === 'published').length;
  io.out(
    `wrote ${name}: ${String(published)} of ${String(result.rows.length)} regions published, ` +
      `${String(dropped)} events of other weeks dropped`,
  );
}

async function exportDhis2(options: Options, io: CliIo): Promise<void> {
  const { input, month, release, releaseDate, outDir } = options;
  if (
    input === undefined ||
    month === undefined ||
    release === undefined ||
    releaseDate === undefined ||
    outDir === undefined ||
    options.districts === undefined ||
    options.mapping === undefined
  ) {
    throw new UsageError('missing option');
  }
  if (!isMonth(month)) throw new Error(`Not a month: ${month}`);
  if (!/^r[1-9][0-9]*$/.test(release)) throw new Error('The release id must look like r1, r2.');
  if (!isDate(releaseDate)) throw new Error('The release date must be a real date, YYYY-MM-DD.');
  const earliest = earliestMonthRelease(month);
  if (releaseDate < earliest) {
    throw new Error(
      `${month} cannot be exported before ${earliest} (${String(RELEASE_LAG_DAYS)} days after the month ends).`,
    );
  }
  const period = dhis2Period(month);
  const directory = path.resolve(io.cwd, outDir);
  if (!isAllowedDhis2OutDir(directory)) {
    throw new Error(
      'The DHIS2 export is restricted data, never open data. Write it to open-data/dhis2/out ' +
        '(ignored by version control) or to a folder outside the repository, never inside ' +
        'open-data/ or a folder named published (see docs/dhis2.md).',
    );
  }
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    names = [];
  }
  const pattern = new RegExp(`^${period}-r[0-9]+-restricted(-test)?\\.json$`);
  const existing = names.filter((name) => pattern.test(name));
  if (existing.length > 0) {
    throw new Error(
      `${month} is already exported (${existing.join(', ')}). Exported files are immutable: ` +
        'withdraw the file first to replace it (see docs/dhis2.md).',
    );
  }
  const districts = parseDistricts(await readFile(path.resolve(io.cwd, options.districts), 'utf8'));
  const mapping = parseMapping(
    await readFile(path.resolve(io.cwd, options.mapping), 'utf8'),
    districts,
  );
  const events = parseEvents(await readFile(path.resolve(io.cwd, input), 'utf8'));
  const result = aggregateMonth(events, month, districts);
  const set = toDataValueSets(result.cells, month, mapping);
  const stem = `${period}-${release}-restricted${options.test ? '-test' : ''}`;
  const name = `${stem}.json`;
  await writeNew(path.join(directory, name), renderDhis2(set));
  await writeNew(path.join(directory, `${stem}.notice.txt`), `${RESTRICTED_NOTICE}\n`);
  const exported = result.cells.filter((cell) => cell.status === 'exported').length;
  io.out(
    `wrote ${name}: ${String(set.dataValues.length)} data values, ${String(exported)} of ` +
      `${String(result.cells.length)} districts exported, ${String(result.dropped)} events of other months ` +
      `dropped, ${String(result.withoutDistrict)} events without a district not exported`,
  );
}

const PROCESS_IO: CliIo = {
  cwd: process.cwd(),
  out: (line) => {
    console.log(line);
  },
  err: (line) => {
    console.error(line);
  },
};

export async function main(argv: string[], io: CliIo = PROCESS_IO): Promise<number> {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  const usage = (): number => {
    for (const line of USAGE) io.err(line);
    return 2;
  };
  if (options === undefined || (command !== 'build' && command !== 'sample' && command !== 'dhis2'))
    return usage();
  try {
    if (command === 'sample') {
      if (options.output === undefined) return usage();
      const target = path.resolve(io.cwd, options.output);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, renderJsonl(generateSampleEvents(), options.label), 'utf8');
      io.out(`wrote ${options.output}`);
      return 0;
    }
    if (command === 'dhis2') await exportDhis2(options, io);
    else await build(options, io);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) return usage();
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
