/**
 * Faithful port of Armagetron's legacy `nStreamMessage` reader and the
 * section-based protobuf<->stream converter (`StreamFromDefault` in
 * `src/network/nProtoBuf.cpp`).
 *
 * Tournament `.aarec` files record traffic from 0.2.8.x servers, which use the
 * old stream wire format (no protobuf flag). Each message body is a sequence of
 * 16-bit words. Net objects are (de)serialized field-by-field in proto
 * declaration order, split into "sections" delimited by the `legacy_*_end`
 * marker fields:
 *
 *   SECTION_First  (1) = creation data (object id, owner, player id, color, ...)
 *   SECTION_ID     (2) = object id only (used by the protobuf message streamer)
 *   SECTION_Second (4) = sync data (time, direction, position, speed, ...)
 *   SECTION_All    (5) = First | Second (full creation message)
 *
 * `StreamFrom` runs one pass per requested flag (First, then Second), sharing a
 * single read cursor, which is exactly how the wire bytes are laid out.
 */

export const SECTION_FIRST = 1;
export const SECTION_ID = 2;
export const SECTION_SECOND = 4;
export const SECTION_ALL = 5;
export const SECTION_MAX = 7;

export type ScalarType = "uint32" | "int32" | "float" | "bool" | "string";

export type StreamField =
  | { key?: string; type: ScalarType }
  | { key?: string; type: "message"; sub: StreamField[] }
  | { type: "endmarker" };

export type StreamValue = number | boolean | string | StreamObject;
export type StreamObject = { [key: string]: StreamValue };

class WordReader {
  constructor(public words: number[], public pos: number, public end: number) {}

  atEnd(): boolean {
    return this.pos >= this.end;
  }

  word(): number {
    return this.words[this.pos++] & 0xffff;
  }

  /** signed 32-bit int: low word first, then signed high word (operator>>(int)). */
  int(): number {
    const a = this.word();
    const b = (this.word() << 16) >> 16; // sign-extend high word
    return (b << 16) + a;
  }

  /** AA custom float (26-bit exp / 25-bit mantissa packed into an int). */
  real(): number {
    const a = this.word();
    const b = (this.word() << 16) >> 16;
    const trans = ((b << 16) + a) >>> 0;
    const mant = trans & 0x1ffffff; // 25 bits
    const negative = (trans >>> 25) & 1;
    let exp = (trans >>> 26) & 0x3f; // 6 bits
    let x = mant / (1 << 25);
    if (negative) x = -x;
    while (exp >= 6) {
      x *= 64;
      exp -= 6;
    }
    while (exp > 0) {
      x *= 2;
      exp--;
    }
    return x;
  }

  /** length-prefixed string (ReadRaw): one length word then ceil(len/2) words. */
  raw(): string {
    const len = this.word();
    if (len <= 0) return "";
    const bytes: number[] = [];
    for (let i = 0; i < len; i += 2) {
      const w = this.word();
      bytes.push(w & 0xff);
      if (i + 1 < len) bytes.push((w >> 8) & 0xff);
    }
    // Drop the trailing null terminator(s).
    while (bytes.length && bytes[bytes.length - 1] === 0) bytes.pop();
    return String.fromCharCode(...bytes);
  }
}

function readScalar(reader: WordReader, type: ScalarType): StreamValue {
  switch (type) {
    case "uint32":
      return reader.word();
    case "int32":
      return reader.int();
    case "float":
      return reader.real();
    case "bool":
      return reader.word() !== 0;
    case "string":
      return reader.raw();
  }
}

function streamFromDefault(reader: WordReader, schema: StreamField[], sections: number, out: StreamObject): void {
  let currentSectionFlags = 1;

  for (let i = 0; i < schema.length; i++) {
    const fld = schema[i];

    if (reader.atEnd()) break;

    if (fld.type === "endmarker") {
      currentSectionFlags <<= 2;
      continue;
    }

    const isMessage = fld.type === "message";
    // Mirror StreamFromDefault's skip condition exactly.
    if (
      (sections & currentSectionFlags) === 0 &&
      ((sections !== SECTION_ID && !isMessage) || i !== 0)
    ) {
      if (currentSectionFlags > sections) break;
      continue;
    }

    if (isMessage) {
      const key = fld.key ?? `_${i}`;
      const existing = out[key];
      const subOut: StreamObject =
        existing && typeof existing === "object" ? (existing as StreamObject) : {};
      out[key] = subOut;
      streamFromDefault(reader, fld.sub, i === 0 ? sections : SECTION_FIRST, subOut);
    } else {
      const value = readScalar(reader, fld.type);
      if (fld.key) out[fld.key] = value;
    }
  }
}

/**
 * Decode a net-object stream body. `startPos` skips a leading object-id word
 * (sync messages read it in the handler before the section data).
 */
export function decodeStream(
  words: number[],
  startPos: number,
  schema: StreamField[],
  sectionsMask: number,
): StreamObject {
  const reader = new WordReader(words, startPos, words.length);
  const out: StreamObject = {};
  for (let flag = 1; flag < SECTION_MAX; flag <<= 1) {
    if (sectionsMask & flag) {
      streamFromDefault(reader, schema, flag, out);
    }
  }
  return out;
}

export function asObject(value: StreamValue | undefined): StreamObject | undefined {
  return value && typeof value === "object" ? (value as StreamObject) : undefined;
}

export function asNumber(value: StreamValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
