/**
 * Minimal decoder for Garmin FIT files.
 *
 * Decodes the container only: every data message becomes its global message number plus a map
 * from field number to raw value. Meaning, scale and units of the fields are applied by the
 * caller. Written from the public FIT protocol description; it does not use Garmin's FIT SDK,
 * whose license does not allow redistribution under the GPL.
 */

export interface FitMessage {
  /** Global message number, e.g. 20 = record */
  global: number;
  /** Field number → value. Invalid ("not set") values are left out. */
  fields: Map<number, FitValue>;
}

export type FitValue = number | string | number[];

/** Field 253 is the timestamp in every message that has one. */
export const FIT_TIMESTAMP_FIELD = 253;

/** Seconds between 1970-01-01 and the FIT epoch 1989-12-31, both UTC. */
export const FIT_EPOCH_OFFSET = 631065600;

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface Definition {
  global: number;
  littleEndian: boolean;
  fields: FieldDef[];
  /** Total size of developer fields, which are skipped. */
  devSize: number;
}

export class FitError extends Error {}

export function isFit(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54 // ".FIT"
  );
}

/** Decode all messages of a FIT file (including chained files). */
export function decodeFit(bytes: Uint8Array): FitMessage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const messages: FitMessage[] = [];
  let pos = 0;

  while (pos + 12 <= bytes.length) {
    if (!isFit(bytes.subarray(pos))) {
      if (pos === 0) throw new FitError('Not a FIT file');
      break;
    }
    const headerSize = view.getUint8(pos);
    const dataSize = view.getUint32(pos + 4, true);
    const end = Math.min(pos + headerSize + dataSize, bytes.length);
    pos += headerSize;

    const definitions = new Map<number, Definition>();
    let lastTimestamp = 0;

    while (pos < end) {
      const header = view.getUint8(pos++);
      let localType: number;
      let compressedOffset: number | null = null;

      if (header & 0x80) {
        localType = (header >> 5) & 0x3;
        compressedOffset = header & 0x1f;
      } else {
        localType = header & 0x0f;
        if (header & 0x40) {
          const [definition, next] = readDefinition(view, pos, (header & 0x20) !== 0);
          definitions.set(localType, definition);
          pos = next;
          continue;
        }
      }

      const def = definitions.get(localType);
      if (!def) throw new FitError(`Data message without definition (local type ${localType})`);

      const fields = new Map<number, FitValue>();
      for (const field of def.fields) {
        if (pos + field.size > end) throw new FitError('Truncated FIT file');
        const value = readField(view, pos, field, def.littleEndian);
        if (value !== null) fields.set(field.num, value);
        pos += field.size;
      }
      pos += def.devSize;

      if (compressedOffset !== null) {
        let timestamp = (lastTimestamp & ~0x1f) + compressedOffset;
        if (compressedOffset < (lastTimestamp & 0x1f)) timestamp += 0x20;
        lastTimestamp = timestamp;
        fields.set(FIT_TIMESTAMP_FIELD, timestamp);
      } else {
        const ts = fields.get(FIT_TIMESTAMP_FIELD);
        if (typeof ts === 'number') lastTimestamp = ts;
      }
      messages.push({ global: def.global, fields });
    }
    pos = end + 2; // file CRC
  }
  return messages;
}

function readDefinition(view: DataView, start: number, hasDevFields: boolean): [Definition, number] {
  let pos = start + 1; // reserved
  const littleEndian = view.getUint8(pos++) === 0;
  const global = view.getUint16(pos, littleEndian);
  pos += 2;
  const count = view.getUint8(pos++);
  const fields: FieldDef[] = [];
  for (let i = 0; i < count; i++) {
    fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), baseType: view.getUint8(pos + 2) & 0x1f });
    pos += 3;
  }
  let devSize = 0;
  if (hasDevFields) {
    const devCount = view.getUint8(pos++);
    for (let i = 0; i < devCount; i++) {
      devSize += view.getUint8(pos + 1);
      pos += 3;
    }
  }
  return [{ global, littleEndian, fields, devSize }, pos];
}

/** Size in bytes and the "invalid" marker of each numeric base type. */
const BASE_TYPES: Record<number, { size: number; read: (v: DataView, p: number, le: boolean) => number; invalid: number }> = {
  0: { size: 1, read: (v, p) => v.getUint8(p), invalid: 0xff }, // enum
  1: { size: 1, read: (v, p) => v.getInt8(p), invalid: 0x7f },
  2: { size: 1, read: (v, p) => v.getUint8(p), invalid: 0xff },
  3: { size: 2, read: (v, p, le) => v.getInt16(p, le), invalid: 0x7fff },
  4: { size: 2, read: (v, p, le) => v.getUint16(p, le), invalid: 0xffff },
  5: { size: 4, read: (v, p, le) => v.getInt32(p, le), invalid: 0x7fffffff },
  6: { size: 4, read: (v, p, le) => v.getUint32(p, le), invalid: 0xffffffff },
  8: { size: 4, read: (v, p, le) => v.getFloat32(p, le), invalid: Number.NaN },
  9: { size: 8, read: (v, p, le) => v.getFloat64(p, le), invalid: Number.NaN },
  10: { size: 1, read: (v, p) => v.getUint8(p), invalid: 0 }, // uint8z
  11: { size: 2, read: (v, p, le) => v.getUint16(p, le), invalid: 0 },
  12: { size: 4, read: (v, p, le) => v.getUint32(p, le), invalid: 0 },
  13: { size: 1, read: (v, p) => v.getUint8(p), invalid: 0xff }, // byte
};

function readField(view: DataView, pos: number, field: FieldDef, littleEndian: boolean): FitValue | null {
  if (field.baseType === 7) {
    const raw = new Uint8Array(view.buffer, view.byteOffset + pos, field.size);
    const zero = raw.indexOf(0);
    const text = new TextDecoder().decode(zero < 0 ? raw : raw.subarray(0, zero));
    return text === '' ? null : text;
  }
  const type = BASE_TYPES[field.baseType];
  if (!type || field.size % type.size !== 0) return null; // 64-bit integers and unknown types
  const count = field.size / type.size;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = type.read(view, pos + i * type.size, littleEndian);
    values.push(value);
  }
  const valid = (v: number) => !Number.isNaN(v) && v !== type.invalid;
  if (count === 1) return valid(values[0]!) ? values[0]! : null;
  return values.some(valid) ? values : null;
}
