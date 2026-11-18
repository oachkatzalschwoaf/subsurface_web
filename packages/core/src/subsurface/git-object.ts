/**
 * Git object IDs of trees held in memory, computed the way git does: SHA-1 of "<type> <size>\0"
 * plus the content, a tree being its entries sorted by name ("<mode> <name>\0" and the raw 20-byte
 * ID each). The serializer needs them for the "~<id>" suffix Subsurface gives colliding names.
 * Synchronous, so serializeLogbook() stays synchronous; only used when names collide.
 */
import { isTree, type GitTree } from './tree.ts';

const encoder = new TextEncoder();

/** SHA-1 (FIPS 180-4) of `data`. */
export function sha1(data: Uint8Array): Uint8Array {
  const length = data.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // length in bits as a 64-bit big-endian number
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const result = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => result.setUint32(i * 4, h));
  return out;
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function objectId(type: 'blob' | 'tree', content: Uint8Array): Uint8Array {
  const header = encoder.encode(`${type} ${content.length}\0`);
  const all = new Uint8Array(header.length + content.length);
  all.set(header);
  all.set(content, header.length);
  return sha1(all);
}

/** git's tree order: by name as bytes, a directory sorting as if its name ended in "/". */
function compareEntries(a: { key: Uint8Array }, b: { key: Uint8Array }): number {
  const n = Math.min(a.key.length, b.key.length);
  for (let i = 0; i < n; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
  return a.key.length - b.key.length;
}

function treeId(tree: GitTree): Uint8Array {
  const entries = [...tree].map(([name, node]) => {
    const isDir = isTree(node);
    const nameBytes = encoder.encode(name);
    return {
      key: isDir ? encoder.encode(`${name}/`) : nameBytes,
      head: encoder.encode(`${isDir ? '40000' : '100644'} ${name}\0`),
      id: isDir ? treeId(node) : objectId('blob', encoder.encode(node)),
    };
  });
  entries.sort(compareEntries);
  const content = new Uint8Array(entries.reduce((n, e) => n + e.head.length + 20, 0));
  let pos = 0;
  for (const e of entries) {
    content.set(e.head, pos);
    content.set(e.id, pos + e.head.length);
    pos += e.head.length + 20;
  }
  return objectId('tree', content);
}

/** The git object ID (40 hex digits) of a tree. */
export function treeObjectId(tree: GitTree): string {
  return hex(treeId(tree));
}
