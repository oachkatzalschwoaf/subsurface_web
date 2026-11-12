/**
 * Builds small FIT files for tests. Every message gets its own definition (local type 0),
 * little endian, no CRC check on the reading side.
 */
export type FitType = 'enum' | 'sint8' | 'uint8' | 'uint16' | 'sint32' | 'uint32' | 'uint32z';

const TYPES: Record<FitType, { id: number; size: number; write: (v: DataView, p: number, n: number) => void }> = {
  enum: { id: 0x00, size: 1, write: (v, p, n) => v.setUint8(p, n) },
  sint8: { id: 0x01, size: 1, write: (v, p, n) => v.setInt8(p, n) },
  uint8: { id: 0x02, size: 1, write: (v, p, n) => v.setUint8(p, n) },
  uint16: { id: 0x84, size: 2, write: (v, p, n) => v.setUint16(p, n, true) },
  sint32: { id: 0x85, size: 4, write: (v, p, n) => v.setInt32(p, n, true) },
  uint32: { id: 0x86, size: 4, write: (v, p, n) => v.setUint32(p, n, true) },
  uint32z: { id: 0x8c, size: 4, write: (v, p, n) => v.setUint32(p, n, true) },
};

export interface FitTestMessage {
  global: number;
  /** [field number, type, value] */
  fields: [number, FitType, number][];
}

export function buildFit(messages: FitTestMessage[]): Uint8Array {
  const body: number[] = [];
  for (const message of messages) {
    body.push(0x40, 0, 0, message.global & 0xff, message.global >> 8, message.fields.length);
    for (const [num, type] of message.fields) body.push(num, TYPES[type].size, TYPES[type].id);
    body.push(0x00);
    for (const [, type, value] of message.fields) {
      const bytes = new Uint8Array(TYPES[type].size);
      TYPES[type].write(new DataView(bytes.buffer), 0, value);
      body.push(...bytes);
    }
  }
  const out = new Uint8Array(12 + body.length + 2);
  const view = new DataView(out.buffer);
  out.set([12, 0x20, 0, 0], 0);
  view.setUint32(4, body.length, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  out.set(body, 12);
  return out;
}
