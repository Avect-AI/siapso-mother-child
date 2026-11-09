// SPDX-License-Identifier: MIT
// The sizes of the images of a PDF, read from its bytes before pdf.js decodes
// anything. pdf.js checks maxImageSize against the painted image only: a soft
// mask (/SMask), a stencil mask (/Mask), or the JPEG or JPEG 2000 data of an
// image are decoded at their own size, so a file of a few kilobytes could ask
// a 2 GB phone for hundreds of megabytes. A stream can never sit inside an
// object stream (ISO 32000-1, 7.5.7), and encryption leaves dictionaries in
// the clear, so the dictionary of every image, its masks included, is in the
// file's bytes. No cross-reference table is trusted: the file is read from
// its start, token by token as pdf.js reads them (whitespace, comments,
// strings, nested dictionaries, #xx name escapes, malformed entries skipped),
// stream data skipped; and every `stream` keyword this reading does not
// account for (one inside another stream's data, say) has the dictionaries
// that end right before it read too. All of it counts in one work budget, so
// a file crafted to be slow is refused in bounded time. Pure: tested in
// test/pdf-images.test.ts.

class Name {
  constructor(readonly name: string) {}
}

class Ref {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}

/** Anything else: a string, a boolean, null, a keyword, a stray delimiter. */
const OTHER = Symbol('other');

type Value = number | Name | Ref | Value[] | Dict | typeof OTHER;
/** A dictionary, each key with every value it was given (pdf.js keeps the last). */
type Dict = Map<string, Value[]>;

/** The reading went over its work budget, or nested too deep: the file is not vouched for. */
class OverBudget extends Error {}

/**
 * The work a check may do, in steps: a byte read, looked at or searched
 * through, or an object looked up. A fixed amount plus a little per byte of
 * the file. The slowest files to read (a token or a stray stream keyword
 * every few bytes) run at 25 to 35 million steps a second on the bench
 * laptop (busy): a file of 20 MB (MAX_FILE_BYTES) crafted that way is
 * refused or read within about 1.5 s there, and within about 6 to 9 s on a
 * phone four to six times slower, inside the 90 s of a reading. Ordinary
 * files use a small part of it: their streams' data is skipped, not read.
 */
export const BUDGET_BASE = 8_000_000;
export const BUDGET_PER_BYTE = 1.5;

class Budget {
  left: number;

  constructor(readonly total: number) {
    this.left = total;
  }

  spend(steps: number): void {
    this.left -= steps;
    if (this.left < 0) throw new OverBudget();
  }

  /** The steps counted so far, at most the total. */
  get used(): number {
    return Math.min(this.total, this.total - this.left);
  }
}

const isWhite = (c: number | undefined) =>
  c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const codes = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
const DELIMITERS = new Set(codes('()<>[]{}/%'));
const isRegular = (c: number | undefined) => c !== undefined && !isWhite(c) && !DELIMITERS.has(c);
const isDigit = (c: number | undefined) => c !== undefined && c >= 48 && c <= 57;
const hexValue = (c: number | undefined) => {
  if (c === undefined) return -1;
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
};

/** Deeper nesting is refused rather than read (pdf.js itself would not get far). */
const MAX_DEPTH = 1000;

/** How far back from a `stream` keyword the reading looks for its dictionary. */
export const DICTIONARY_WINDOW = 64 * 1024;

const STREAM = codes('stream');
const ENDSTREAM = codes('endstream');
const OBJ = codes('obj');

function matches(bytes: Uint8Array, at: number, word: readonly number[]): boolean {
  return word.every((code, i) => bytes[at + i] === code);
}

/** The next `word` from `from`, the search counted in `budget` when given. */
function indexOfWord(
  bytes: Uint8Array,
  word: readonly number[],
  from: number,
  budget?: Budget,
): number {
  const first = word[0] ?? 0;
  for (let at = bytes.indexOf(first, from); at >= 0; at = bytes.indexOf(first, at + 1)) {
    if (matches(bytes, at, word)) {
      budget?.spend(at - from + 1);
      return at;
    }
  }
  budget?.spend(bytes.length - from);
  return -1;
}

/** Reads PDF tokens from `pos` up to `end` (excluded), as leniently as pdf.js. */
class Reader {
  pos: number;

  constructor(
    readonly bytes: Uint8Array,
    start: number,
    readonly end: number,
    readonly budget: Budget,
  ) {
    this.pos = start;
  }

  at(offset = 0): number | undefined {
    const at = this.pos + offset;
    return at < this.end ? this.bytes[at] : undefined;
  }

  /** Skips whitespace and comments. */
  skipSpace(): void {
    const start = this.pos;
    for (;;) {
      const c = this.at();
      if (isWhite(c)) {
        this.pos += 1;
      } else if (c === 37) {
        while (this.at() !== undefined && this.at() !== 10 && this.at() !== 13) this.pos += 1;
      } else {
        break;
      }
    }
    this.budget.spend(this.pos - start);
  }

  /** Whether the keyword `word` is at the position. */
  isKeyword(word: readonly number[]): boolean {
    return (
      this.pos + word.length <= this.end &&
      matches(this.bytes, this.pos, word) &&
      !isRegular(this.at(word.length))
    );
  }

  private name(): Name {
    const start = this.pos;
    this.pos += 1;
    let name = '';
    while (isRegular(this.at())) {
      const c = this.at() ?? 0;
      const high = hexValue(this.at(1));
      const low = hexValue(this.at(2));
      if (c === 35 && high >= 0 && low >= 0) {
        name += String.fromCharCode(high * 16 + low);
        this.pos += 3;
      } else {
        name += String.fromCharCode(c);
        this.pos += 1;
      }
    }
    this.budget.spend(this.pos - start);
    return new Name(name);
  }

  /** A number as pdf.js reads one: its leading valid part, the rest of the token skipped. */
  private number(): number {
    const start = this.pos;
    let sign = 1;
    if (this.at() === 43 || this.at() === 45) {
      if (this.at() === 45) sign = -1;
      this.pos += 1;
    }
    let value = 0;
    let digits = 0;
    while (isDigit(this.at())) {
      value = value * 10 + ((this.at() ?? 48) - 48);
      digits += 1;
      this.pos += 1;
    }
    if (this.at() === 46) {
      this.pos += 1;
      let scale = 0.1;
      while (isDigit(this.at())) {
        value += ((this.at() ?? 48) - 48) * scale;
        scale /= 10;
        digits += 1;
        this.pos += 1;
      }
    }
    // Junk such as a second sign or point: part of the token, not of the number.
    while (isDigit(this.at()) || this.at() === 43 || this.at() === 45 || this.at() === 46) {
      this.pos += 1;
    }
    this.budget.spend(this.pos - start);
    return digits === 0 ? 0 : sign * value;
  }

  /** After an integer: ` gen R` makes a reference. */
  private referenceAfter(num: number): Ref | undefined {
    const save = this.pos;
    this.skipSpace();
    const start = this.pos;
    let gen = 0;
    while (isDigit(this.at())) {
      gen = gen * 10 + ((this.at() ?? 48) - 48);
      this.pos += 1;
    }
    if (this.pos > start) {
      this.skipSpace();
      if (this.at() === 82 && !isRegular(this.at(1))) {
        this.pos += 1;
        this.budget.spend(1);
        return new Ref(num, gen);
      }
    }
    this.pos = save;
    return undefined;
  }

  private literalString(): void {
    const start = this.pos;
    this.pos += 1;
    let depth = 1;
    while (this.at() !== undefined) {
      const c = this.at();
      this.pos += 1;
      if (c === 92) this.pos += 1;
      else if (c === 40) depth += 1;
      else if (c === 41 && --depth === 0) break;
    }
    this.budget.spend(this.pos - start);
  }

  private hexString(): void {
    const start = this.pos;
    this.pos += 1;
    while (this.at() !== undefined) {
      const c = this.at();
      this.pos += 1;
      if (c === 62) break;
    }
    this.budget.spend(this.pos - start);
  }

  /** One value; undefined only at the end of what may be read. */
  value(depth = 0): Value | undefined {
    if (depth > MAX_DEPTH) throw new OverBudget();
    this.skipSpace();
    const c = this.at();
    if (c === undefined) return undefined;
    if (c === 60 && this.at(1) === 60) return this.dict(depth);
    if (c === 60) {
      this.hexString();
      return OTHER;
    }
    if (c === 40) {
      this.literalString();
      return OTHER;
    }
    if (c === 47) return this.name();
    if (c === 91) {
      this.pos += 1;
      this.budget.spend(1);
      const items: Value[] = [];
      for (;;) {
        this.skipSpace();
        if (this.at() === undefined) return undefined;
        if (this.at() === 93) {
          this.pos += 1;
          return items;
        }
        const item = this.value(depth + 1);
        if (item === undefined) return undefined;
        items.push(item);
      }
    }
    if (isDigit(c) || c === 43 || c === 45 || c === 46) {
      const value = this.number();
      if (isDigit(c) && Number.isInteger(value)) return this.referenceAfter(value) ?? value;
      return value;
    }
    const start = this.pos;
    if (isRegular(c)) {
      while (isRegular(this.at())) this.pos += 1;
    } else {
      // A stray delimiter: one character, as pdf.js gets past it.
      this.pos += 1;
    }
    this.budget.spend(this.pos - start);
    return OTHER;
  }

  /** A dictionary starting at `<<`; undefined when it does not end before `end`. */
  dict(depth = 0): Dict | undefined {
    this.pos += 2;
    this.budget.spend(2);
    const dict: Dict = new Map();
    for (;;) {
      this.skipSpace();
      if (this.at() === undefined) return undefined;
      if (this.at() === 62 && this.at(1) === 62) {
        this.pos += 2;
        return dict;
      }
      if (this.at() !== 47) {
        // Not a key: pdf.js skips it ("Malformed dictionary").
        if (this.value(depth + 1) === undefined) return undefined;
        continue;
      }
      const key = this.name().name;
      const value = this.value(depth + 1);
      if (value === undefined) return undefined;
      const values = dict.get(key);
      if (values === undefined) dict.set(key, [value]);
      else values.push(value);
    }
  }
}

interface StreamFound {
  dict: Dict;
  /** Where its data starts: after the end of line that follows `stream`. */
  data: number;
}

/** Where the data of a stream whose keyword is at `keyword` starts, as pdf.js skips to it. */
function dataStart(bytes: Uint8Array, keyword: number, budget: Budget): number {
  const from = keyword + STREAM.length;
  let at = from;
  while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at += 1;
  budget.spend(at - from + 1);
  if (bytes[at] === 13) at += 1;
  if (bytes[at] === 10) at += 1;
  return at;
}

/** Where the data of a stream ends: by its /Length when `endstream` follows, else at `endstream`. */
function dataEnd(bytes: Uint8Array, dict: Dict, data: number, budget: Budget): number {
  const length = dict.get('Length')?.at(-1);
  if (typeof length === 'number' && Number.isInteger(length) && length >= 0) {
    let at = data + length;
    while (isWhite(bytes[at])) at += 1;
    if (at < bytes.length && matches(bytes, at, ENDSTREAM)) return data + length;
  }
  const found = indexOfWord(bytes, ENDSTREAM, data, budget);
  return found < 0 ? bytes.length : found;
}

/** The positions of every `stream` keyword of the file (not `endstream`), each counted. */
function streamKeywords(bytes: Uint8Array, budget: Budget): number[] {
  const found: number[] = [];
  for (let at = indexOfWord(bytes, STREAM, 0); at >= 0; at = indexOfWord(bytes, STREAM, at + 1)) {
    if (!isRegular(bytes[at - 1]) && !isRegular(bytes[at + STREAM.length])) {
      budget.spend(1);
      found.push(at);
    }
  }
  return found;
}

interface Streams {
  streams: StreamFound[];
  encrypted: boolean;
  /** Why a stream of the file cannot be read here, if one cannot. */
  unreadable?: string;
}

/** The stream dictionaries of the file, and whether it is encrypted. */
function streamsOf(bytes: Uint8Array, budget: Budget): Streams {
  const streams: StreamFound[] = [];
  const accounted = new Set<number>();
  let encrypted = false;
  let unreadable: string | undefined;
  const note = (dict: Dict) => {
    if (dict.has('Encrypt')) encrypted = true;
  };

  // The file from its start, stream data skipped.
  const reader = new Reader(bytes, 0, bytes.length, budget);
  for (;;) {
    const before = reader.pos;
    const value = reader.value();
    if (value === undefined) break;
    if (value instanceof Map) {
      note(value);
      reader.skipSpace();
      if (reader.isKeyword(STREAM)) {
        const keyword = reader.pos;
        accounted.add(keyword);
        const data = dataStart(bytes, keyword, budget);
        streams.push({ dict: value, data });
        reader.pos = dataEnd(bytes, value, data, budget);
      }
    }
    if (reader.pos === before) reader.pos += 1;
  }

  // Each `stream` keyword that reading did not reach: the dictionaries ending right before it.
  for (const keyword of streamKeywords(bytes, budget)) {
    if (accounted.has(keyword)) continue;
    const from = Math.max(0, keyword - DICTIONARY_WINDOW);
    budget.spend(keyword - from);
    const window = bytes.subarray(from, keyword);
    let found = false;
    for (let at = window.lastIndexOf(60); at > 0; at = window.lastIndexOf(60, at - 1)) {
      if (window[at - 1] !== 60) continue;
      const candidate = new Reader(bytes, from + at - 1, keyword, budget);
      const dict = candidate.dict();
      if (dict === undefined) continue;
      candidate.skipSpace();
      if (candidate.pos !== keyword) continue;
      found = true;
      note(dict);
      streams.push({ dict, data: dataStart(bytes, keyword, budget) });
    }
    let before = keyword - 1;
    while (isWhite(bytes[before])) before -= 1;
    if (!found && bytes[before] === 62 && bytes[before - 1] === 62) {
      unreadable ??= 'a stream dictionary cannot be read here';
    }
  }
  return unreadable === undefined ? { streams, encrypted } : { streams, encrypted, unreadable };
}

/**
 * The plain objects of the file (`N G obj value`), indexed in one pass the
 * first time a reference is followed: each lookup is then the reading of its
 * value alone. An object whose header has a comment between its tokens, or
 * that sits in an object stream, is not found: its reference cannot be read.
 */
class Objects {
  private index: Map<string, number[]> | undefined;
  private readonly found = new Map<string, Value[]>();

  constructor(
    private readonly bytes: Uint8Array,
    private readonly budget: Budget,
  ) {}

  private headers(): Map<string, number[]> {
    if (this.index !== undefined) return this.index;
    const index = new Map<string, number[]>();
    const { bytes } = this;
    for (let at = indexOfWord(bytes, OBJ, 0); at >= 0; at = indexOfWord(bytes, OBJ, at + 1)) {
      this.budget.spend(1);
      if (isRegular(bytes[at + OBJ.length]) || !isWhite(bytes[at - 1])) continue;
      // Backwards: whitespace, the generation, whitespace, the number.
      let p = at - 1;
      while (isWhite(bytes[p])) p -= 1;
      const genEnd = p + 1;
      while (isDigit(bytes[p])) p -= 1;
      const genStart = p + 1;
      if (genStart === genEnd || !isWhite(bytes[p])) continue;
      while (isWhite(bytes[p])) p -= 1;
      const numEnd = p + 1;
      while (isDigit(bytes[p])) p -= 1;
      const numStart = p + 1;
      this.budget.spend(at - p);
      if (numStart === numEnd || isRegular(bytes[p])) continue;
      const key = `${String.fromCharCode(...bytes.subarray(numStart, numEnd))} ${String.fromCharCode(...bytes.subarray(genStart, genEnd))}`;
      const positions = index.get(key);
      if (positions === undefined) index.set(key, [at + OBJ.length]);
      else positions.push(at + OBJ.length);
    }
    this.index = index;
    return index;
  }

  /** Every value the file gives object `ref` (every revision). */
  private definitions(ref: Ref): Value[] {
    const key = `${String(ref.num)} ${String(ref.gen)}`;
    const known = this.found.get(key);
    if (known !== undefined) return known;
    this.budget.spend(1);
    const values: Value[] = [];
    for (const at of this.headers().get(key) ?? []) {
      const value = new Reader(this.bytes, at, this.bytes.length, this.budget).value();
      if (value !== undefined) values.push(value);
    }
    this.found.set(key, values);
    return values;
  }

  /** The values `value` stands for, references followed; null when one cannot be read. */
  resolve(value: Value, depth = 0): Value[] | null {
    if (!(value instanceof Ref)) return [value];
    if (depth > 4) return null;
    const values = this.definitions(value);
    if (values.length === 0) return null;
    const resolved: Value[] = [];
    for (const item of values) {
      const inner = this.resolve(item, depth + 1);
      if (inner === null) return null;
      resolved.push(...inner);
    }
    return resolved;
  }
}

interface Read<T> {
  values: T[];
  /** A reference that could not be read, or that is not what it should be. */
  unreadable: boolean;
}

/** The sizes a stream gives under `keys`, references followed. */
function numbersOf(dict: Dict, keys: readonly string[], objects: Objects): Read<number> {
  const values: number[] = [];
  let unreadable = false;
  for (const key of keys) {
    for (const value of dict.get(key) ?? []) {
      const resolved = objects.resolve(value);
      if (resolved === null) {
        unreadable = true;
        continue;
      }
      for (const item of resolved) {
        if (typeof item === 'number') values.push(Math.abs(item));
        else if (value instanceof Ref) unreadable = true;
      }
    }
  }
  return { values, unreadable };
}

/** The filter names of a stream, in order (pdf.js reads /F before /Filter). */
function filtersOf(dict: Dict, objects: Objects): Read<string> {
  const usable = (values: Value[] | undefined) =>
    values?.some((v) => v instanceof Name || Array.isArray(v) || v instanceof Ref) === true;
  const given = usable(dict.get('F')) ? dict.get('F') : dict.get('Filter');
  const names: string[] = [];
  let unreadable = false;
  const add = (value: Value, depth: number) => {
    const resolved = objects.resolve(value);
    if (resolved === null) {
      unreadable = true;
      return;
    }
    for (const item of resolved) {
      if (item instanceof Name) names.push(item.name);
      else if (Array.isArray(item) && depth === 0) {
        for (const inner of item) add(inner, 1);
      } else if (value instanceof Ref) unreadable = true;
    }
  };
  for (const value of given ?? []) add(value, 0);
  return { values: names, unreadable };
}

const JPEG = new Set(['DCTDecode', 'DCT']);
const JPX = new Set(['JPXDecode']);
const IMAGE_FILTERS = new Set([...JPEG, ...JPX, 'JBIG2Decode', 'CCITTFaxDecode', 'CCF']);

/** The next 0xFF 0xNN pair in [from, end), the search counted. */
function marker(bytes: Uint8Array, code: number, from: number, end: number, budget: Budget) {
  for (
    let at = bytes.indexOf(0xff, from);
    at >= 0 && at + 1 < end;
    at = bytes.indexOf(0xff, at + 1)
  ) {
    if (bytes[at + 1] === code) {
      budget.spend(at - from + 1);
      return at;
    }
  }
  budget.spend(end - from);
  return -1;
}

/**
 * The size of the JPEG data in [start, end): its first frame header after
 * its first SOI marker, as pdf.js finds them; undefined with none, null when
 * the height is left to a later marker (DNL).
 */
function jpegPixels(
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: Budget,
): number | undefined | null {
  const soi = marker(bytes, 0xd8, start, end, budget);
  if (soi < 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = soi + 2;
  while (at + 9 < end) {
    budget.spend(1);
    if (bytes[at] !== 0xff) return undefined;
    const code = bytes[at + 1] ?? 0;
    if (code === 0xff) {
      at += 1;
      continue;
    }
    if (code === 0xd8 || code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      at += 2;
      continue;
    }
    // Start of frame: baseline, progressive, lossless and the others but DHT, JPG and DAC.
    if (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return height === 0 ? null : width * height;
    }
    const length = view.getUint16(at + 2);
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

/** The size of the JPEG 2000 data in [start, end), from its first SIZ marker as pdf.js reads it. */
function jpxPixels(bytes: Uint8Array, start: number, end: number, budget: Budget) {
  const siz = marker(bytes, 0x51, start, end, budget);
  if (siz < 0 || siz + 22 > bytes.length) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset + siz);
  const width = Math.abs(view.getUint32(6) - view.getUint32(14));
  const height = Math.abs(view.getUint32(10) - view.getUint32(18));
  return width * height;
}

interface Image {
  width: number[];
  height: number[];
  filters: string[];
  dict: Dict;
  data: number;
}

/** Why a PDF may not be read on this phone. */
export interface PdfRefusal {
  /** `too-large`: an image says more pixels than allowed; `pdf-unsupported`: its size cannot be read here. */
  reason: 'too-large' | 'pdf-unsupported';
  why: string;
}

/**
 * Why the PDF `bytes` may not be read on this phone, from its bytes alone,
 * or null. `too-large`: an image, a soft mask, a stencil mask, or JPEG or
 * JPEG 2000 data, of more than `maxPixels` pixels. `pdf-unsupported`, when
 * no size is too large but one cannot be read here: a size or a filter given
 * by an object that cannot be read (in an object stream, missing, not a
 * plain value); JPEG or JPEG 2000 data behind another filter; a JPEG height
 * left to a later marker; a stream dictionary that cannot be found; nesting
 * too deep; a file that takes more than the work budget. The data of an
 * encrypted file is not read: only the sizes its dictionaries give count.
 */
export function oversizedImage(bytes: Uint8Array, maxPixels: number): PdfRefusal | null {
  return inspectPdfImages(bytes, maxPixels).refusal;
}

/** What oversizedImage decided, and the work it took: tested against the budget, not the clock. */
export interface PdfImageInspection {
  refusal: PdfRefusal | null;
  /** Steps counted (see BUDGET_BASE). */
  steps: number;
  /** The budget for this file: BUDGET_BASE + BUDGET_PER_BYTE x its size. */
  budget: number;
  /** Whether the check stopped at its budget (then refused, unless an image was too large first). */
  overBudget: boolean;
}

/** oversizedImage, with the work it counted. */
export function inspectPdfImages(bytes: Uint8Array, maxPixels: number): PdfImageInspection {
  const budget = new Budget(BUDGET_BASE + BUDGET_PER_BYTE * bytes.length);
  let overBudget = false;
  const refusal = refusalOf(bytes, maxPixels, budget, () => {
    overBudget = true;
  });
  return { refusal, steps: budget.used, budget: budget.total, overBudget };
}

function refusalOf(
  bytes: Uint8Array,
  maxPixels: number,
  budget: Budget,
  onOverBudget: () => void,
): PdfRefusal | null {
  let unsupported: string | undefined;
  const cannot = (why: string) => {
    unsupported ??= why;
  };
  try {
    const found = streamsOf(bytes, budget);
    if (found.unreadable !== undefined) cannot(found.unreadable);
    const { streams, encrypted } = found;
    const objects = new Objects(bytes, budget);
    const images: Image[] = [];
    for (const { dict, data } of streams) {
      const width = numbersOf(dict, ['W', 'Width'], objects);
      const height = numbersOf(dict, ['H', 'Height'], objects);
      const filters = filtersOf(dict, objects);
      const subtype = dict.get('Subtype') ?? [];
      const isImage =
        width.values.length > 0 ||
        height.values.length > 0 ||
        width.unreadable ||
        height.unreadable ||
        filters.values.some((name) => IMAGE_FILTERS.has(name)) ||
        subtype.some(
          (value) => value instanceof Ref || (value instanceof Name && value.name === 'Image'),
        );
      if (!isImage) continue;
      if (width.unreadable || height.unreadable) {
        cannot('the size of an image is given by an object that cannot be read here');
      }
      if (filters.unreadable) cannot('the filters of an image cannot be read here');
      images.push({
        width: width.values,
        height: height.values,
        filters: filters.values,
        dict,
        data,
      });
    }
    const codecPixels: number[] = [];
    for (const image of images) {
      const codec = image.filters.findIndex((name) => JPEG.has(name) || JPX.has(name));
      if (codec < 0) continue;
      if (codec > 0) {
        cannot('the size of JPEG or JPEG 2000 data behind another filter cannot be read here');
        continue;
      }
      // Encrypted data cannot be read without the key.
      if (encrypted) continue;
      const end = dataEnd(bytes, image.dict, image.data, budget);
      if (JPEG.has(image.filters[codec] ?? '')) {
        const pixels = jpegPixels(bytes, image.data, end, budget);
        if (pixels === null) cannot('the height of JPEG data is given later than its frame');
        else if (pixels !== undefined) {
          if (pixels > maxPixels) {
            return { reason: 'too-large', why: `JPEG data of ${String(pixels)} pixels` };
          }
          codecPixels.push(pixels);
        }
      } else {
        const pixels = jpxPixels(bytes, image.data, end, budget);
        if (pixels !== undefined) {
          if (pixels > maxPixels) {
            return { reason: 'too-large', why: `JPEG 2000 data of ${String(pixels)} pixels` };
          }
          codecPixels.push(pixels);
        }
      }
    }
    // A mask without a width or a height takes those of the image it masks:
    // at most the largest side the file gives.
    let largest = 0;
    for (const image of images) {
      for (const side of [...image.width, ...image.height]) largest = Math.max(largest, side);
    }
    for (const pixels of codecPixels) largest = Math.max(largest, Math.sqrt(pixels));
    for (const image of images) {
      const width = image.width.length > 0 ? Math.max(...image.width) : undefined;
      const height = image.height.length > 0 ? Math.max(...image.height) : undefined;
      if (width === undefined && height === undefined) continue;
      const w = width ?? largest;
      const h = height ?? largest;
      if (w * h > maxPixels) {
        return { reason: 'too-large', why: `an image of ${String(w)} x ${String(h)} pixels` };
      }
    }
  } catch (error) {
    if (!(error instanceof OverBudget)) throw error;
    onOverBudget();
    cannot('the file takes too long to read here');
  }
  return unsupported === undefined ? null : { reason: 'pdf-unsupported', why: unsupported };
}
