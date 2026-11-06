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
// that end right before it read too. Pure: tested in test/pdf-images.test.ts.
import { imageSizeOf } from './limits.js';

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
const LEADING_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)/;

/** Deeper nesting is refused rather than read (pdf.js itself would not get far). */
const MAX_DEPTH = 1000;

/** How far back from a `stream` keyword the reading looks for its dictionary. */
const DICTIONARY_WINDOW = 1024 * 1024;

const STREAM = codes('stream');
const ENDSTREAM = codes('endstream');

function matches(bytes: Uint8Array, at: number, word: readonly number[]): boolean {
  return word.every((code, i) => bytes[at + i] === code);
}

/** Reads PDF tokens from `pos` up to `end` (excluded), as leniently as pdf.js. */
class Reader {
  pos: number;

  constructor(
    readonly bytes: Uint8Array,
    start: number,
    readonly end: number,
    readonly budget: { left: number },
  ) {
    this.pos = start;
  }

  private step(count = 1): void {
    this.budget.left -= count;
    if (this.budget.left < 0) throw new OverBudget();
  }

  at(offset = 0): number | undefined {
    const at = this.pos + offset;
    return at < this.end ? this.bytes[at] : undefined;
  }

  /** Skips whitespace and comments. */
  skipSpace(): void {
    for (;;) {
      const c = this.at();
      if (isWhite(c)) {
        this.pos += 1;
        this.step();
      } else if (c === 37) {
        while (this.at() !== undefined && this.at() !== 10 && this.at() !== 13) {
          this.pos += 1;
          this.step();
        }
      } else {
        return;
      }
    }
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
    this.pos += 1;
    const codes: number[] = [];
    while (isRegular(this.at())) {
      const c = this.at() ?? 0;
      const high = hexValue(this.at(1));
      const low = hexValue(this.at(2));
      if (c === 35 && high >= 0 && low >= 0) {
        codes.push(high * 16 + low);
        this.pos += 3;
      } else {
        codes.push(c);
        this.pos += 1;
      }
      this.step();
    }
    return new Name(String.fromCharCode(...codes));
  }

  private number(): number {
    const start = this.pos;
    while (isDigit(this.at()) || this.at() === 43 || this.at() === 45 || this.at() === 46) {
      this.pos += 1;
    }
    this.step(this.pos - start);
    const text = String.fromCharCode(...this.bytes.subarray(start, this.pos));
    const found = LEADING_NUMBER.exec(text)?.[0];
    return found === undefined ? 0 : Number(found);
  }

  /** After an integer: ` gen R` makes a reference. */
  private referenceAfter(num: number): Ref | undefined {
    const save = this.pos;
    this.skipSpace();
    const start = this.pos;
    while (isDigit(this.at())) this.pos += 1;
    if (this.pos > start) {
      const gen = Number(String.fromCharCode(...this.bytes.subarray(start, this.pos)));
      this.skipSpace();
      if (this.at() === 82 && !isRegular(this.at(1))) {
        this.pos += 1;
        return new Ref(num, gen);
      }
    }
    this.pos = save;
    return undefined;
  }

  private literalString(): void {
    this.pos += 1;
    let depth = 1;
    while (this.at() !== undefined) {
      const c = this.at();
      this.pos += 1;
      this.step();
      if (c === 92) this.pos += 1;
      else if (c === 40) depth += 1;
      else if (c === 41 && --depth === 0) return;
    }
  }

  private hexString(): void {
    this.pos += 1;
    while (this.at() !== undefined) {
      const c = this.at();
      this.pos += 1;
      this.step();
      if (c === 62) return;
    }
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
    if (isRegular(c)) {
      while (isRegular(this.at())) {
        this.pos += 1;
        this.step();
      }
      return OTHER;
    }
    // A stray delimiter: one character, as pdf.js gets past it.
    this.pos += 1;
    this.step();
    return OTHER;
  }

  /** A dictionary starting at `<<`; undefined when it does not end before `end`. */
  dict(depth = 0): Dict | undefined {
    this.pos += 2;
    this.step(2);
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
      dict.set(key, [...(dict.get(key) ?? []), value]);
    }
  }
}

interface StreamFound {
  dict: Dict;
  /** Where its data starts: after the end of line that follows `stream`. */
  data: number;
}

/** Where the data of a stream whose keyword is at `keyword` starts, as pdf.js skips to it. */
function dataStart(bytes: Uint8Array, keyword: number): number {
  let at = keyword + STREAM.length;
  while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at += 1;
  if (bytes[at] === 13) at += 1;
  if (bytes[at] === 10) at += 1;
  return at;
}

function indexOfWord(bytes: Uint8Array, word: readonly number[], from: number): number {
  for (
    let at = bytes.indexOf(word[0] ?? 0, from);
    at >= 0;
    at = bytes.indexOf(word[0] ?? 0, at + 1)
  ) {
    if (matches(bytes, at, word)) return at;
  }
  return -1;
}

/** Where the data of a stream ends: by its /Length when `endstream` follows, else at `endstream`. */
function dataEnd(bytes: Uint8Array, dict: Dict, data: number): number {
  const length = dict.get('Length')?.at(-1);
  if (typeof length === 'number' && Number.isInteger(length) && length >= 0) {
    let at = data + length;
    while (isWhite(bytes[at])) at += 1;
    if (at < bytes.length && matches(bytes, at, ENDSTREAM)) return data + length;
  }
  const found = indexOfWord(bytes, ENDSTREAM, data);
  return found < 0 ? bytes.length : found;
}

/** The positions of every `stream` keyword of the file (not `endstream`). */
function streamKeywords(bytes: Uint8Array): number[] {
  const found: number[] = [];
  for (let at = indexOfWord(bytes, STREAM, 0); at >= 0; at = indexOfWord(bytes, STREAM, at + 1)) {
    if (!isRegular(bytes[at - 1]) && !isRegular(bytes[at + STREAM.length])) found.push(at);
  }
  return found;
}

/**
 * The stream dictionaries of the file, whether it is encrypted, and why it
 * cannot be read here (a `stream` keyword after `>>` with no dictionary found).
 */
function streamsOf(bytes: Uint8Array, budget: { left: number }) {
  const streams: StreamFound[] = [];
  const accounted = new Set<number>();
  let encrypted = false;
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
        const data = dataStart(bytes, keyword);
        streams.push({ dict: value, data });
        reader.pos = dataEnd(bytes, value, data);
      }
    }
    if (reader.pos === before) reader.pos += 1;
  }

  // Each `stream` keyword that reading did not reach: the dictionaries ending right before it.
  for (const keyword of streamKeywords(bytes)) {
    if (accounted.has(keyword)) continue;
    let found = false;
    const from = Math.max(0, keyword - DICTIONARY_WINDOW);
    for (let at = keyword - 2; at >= from; at--) {
      budget.left -= 1;
      if (budget.left < 0) throw new OverBudget();
      if (bytes[at] !== 60 || bytes[at + 1] !== 60) continue;
      const candidate = new Reader(bytes, at, keyword, budget);
      const dict = candidate.dict();
      if (dict === undefined) continue;
      candidate.skipSpace();
      if (candidate.pos !== keyword) continue;
      found = true;
      note(dict);
      streams.push({ dict, data: dataStart(bytes, keyword) });
    }
    let before = keyword - 1;
    while (isWhite(bytes[before])) before -= 1;
    if (!found && bytes[before] === 62 && bytes[before - 1] === 62) {
      return { streams, encrypted, unreadable: true };
    }
  }
  return { streams, encrypted, unreadable: false };
}

const WHITE_CLASS = '[\\0\\t\\n\\f\\r ]+';

/** Resolves the references of a file to the values its plain objects hold. */
class Objects {
  private text: string | undefined;
  private readonly found = new Map<string, Value[]>();

  constructor(
    private readonly bytes: Uint8Array,
    private readonly budget: { left: number },
  ) {}

  private latin1(): string {
    if (this.text === undefined) {
      const parts: string[] = [];
      for (let at = 0; at < this.bytes.length; at += 0x8000) {
        parts.push(String.fromCharCode(...this.bytes.subarray(at, at + 0x8000)));
      }
      this.text = parts.join('');
      this.budget.left -= this.bytes.length;
    }
    return this.text;
  }

  /** Every value the file gives object `ref` (every revision), as `N G obj value`. */
  private definitions(ref: Ref): Value[] {
    const key = `${String(ref.num)} ${String(ref.gen)}`;
    const known = this.found.get(key);
    if (known !== undefined) return known;
    const pattern = new RegExp(
      `(?<![0-9])${String(ref.num)}${WHITE_CLASS}${String(ref.gen)}${WHITE_CLASS}obj(?![A-Za-z0-9])`,
      'g',
    );
    const values: Value[] = [];
    for (const match of this.latin1().matchAll(pattern)) {
      const reader = new Reader(
        this.bytes,
        match.index + match[0].length,
        this.bytes.length,
        this.budget,
      );
      const value = reader.value();
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

/**
 * The pixels of the JPEG data in [start, end), from its first SOI marker as
 * pdf.js finds it; undefined with no frame header, null when the height is
 * left to a later marker (DNL).
 */
function jpegPixels(bytes: Uint8Array, start: number, end: number): number | undefined | null {
  for (let at = start; at + 1 < end; at++) {
    if (bytes[at] === 0xff && bytes[at + 1] === 0xd8) {
      const size = imageSizeOf(bytes.subarray(at, end));
      if (size === undefined) return undefined;
      return size.height === 0 ? null : size.width * size.height;
    }
  }
  return undefined;
}

/** The pixels of the JPEG 2000 data in [start, end), from its first SIZ marker as pdf.js reads it. */
function jpxPixels(bytes: Uint8Array, start: number, end: number): number | undefined {
  for (let at = start; at + 1 < end; at++) {
    if (bytes[at] === 0xff && bytes[at + 1] === 0x51) {
      if (at + 22 > bytes.length) return undefined;
      const view = new DataView(bytes.buffer, bytes.byteOffset + at);
      const width = Math.abs(view.getUint32(6) - view.getUint32(14));
      const height = Math.abs(view.getUint32(10) - view.getUint32(18));
      return width * height;
    }
  }
  return undefined;
}

interface Image {
  width: number[];
  height: number[];
  filters: string[];
  dict: Dict;
  data: number;
}

/**
 * Why the PDF `bytes` may not be read on this phone, from its bytes alone,
 * or null. Refused: an image, a soft mask, a stencil mask, or JPEG or JPEG
 * 2000 data, of more than `maxPixels` pixels; a size or a filter given by an
 * object that cannot be read here (in an object stream, or not a plain
 * value); JPEG or JPEG 2000 data compressed again first, whose size cannot be
 * read; a stream dictionary that cannot be read; a file that takes too long
 * to read. The data of an encrypted file is not read: only the sizes its
 * dictionaries give are checked.
 */
export function oversizedImage(bytes: Uint8Array, maxPixels: number): string | null {
  const budget = { left: 32 * bytes.length + 1_000_000 };
  try {
    const { streams, encrypted, unreadable } = streamsOf(bytes, budget);
    if (unreadable) return 'a stream dictionary cannot be read here';
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
        return 'the size of an image is given by an object that cannot be read here';
      }
      if (filters.unreadable) return 'the filters of an image cannot be read here';
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
        return 'the size of JPEG or JPEG 2000 data compressed again cannot be read here';
      }
      // Encrypted data cannot be read without the key.
      if (encrypted) continue;
      const end = dataEnd(bytes, image.dict, image.data);
      if (JPEG.has(image.filters[codec] ?? '')) {
        const pixels = jpegPixels(bytes, image.data, end);
        if (pixels === null) return 'the size of JPEG data cannot be read here';
        if (pixels !== undefined) {
          if (pixels > maxPixels) return `JPEG data of ${String(pixels)} pixels`;
          codecPixels.push(pixels);
        }
      } else {
        const pixels = jpxPixels(bytes, image.data, end);
        if (pixels !== undefined) {
          if (pixels > maxPixels) return `JPEG 2000 data of ${String(pixels)} pixels`;
          codecPixels.push(pixels);
        }
      }
    }
    // A mask without a width or a height takes those of the image it masks:
    // at most the largest side the file gives.
    const largest = Math.max(
      0,
      ...images.flatMap((image) => [...image.width, ...image.height]),
      ...codecPixels.map((pixels) => Math.sqrt(pixels)),
    );
    for (const image of images) {
      const width = image.width.length > 0 ? Math.max(...image.width) : undefined;
      const height = image.height.length > 0 ? Math.max(...image.height) : undefined;
      if (width === undefined && height === undefined) continue;
      const w = width ?? largest;
      const h = height ?? largest;
      if (w * h > maxPixels) return `an image of ${String(w)} x ${String(h)} pixels`;
    }
    return null;
  } catch (error) {
    if (error instanceof OverBudget) return 'the file takes too long to read here';
    throw error;
  }
}
