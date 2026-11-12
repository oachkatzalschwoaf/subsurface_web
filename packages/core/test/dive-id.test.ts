import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FIT_NAME_SIZE, formatDiveId, garminDiveId, garminFingerprint } from '../src/index.ts';

/** Independent reference: SHA-1 via node:crypto over an explicitly built buffer. */
function referenceId(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest().readUInt32LE(0).toString(16).padStart(8, '0');
}

describe('garminFingerprint', () => {
  it('pads short names with zero bytes to 24 bytes', () => {
    const fp = garminFingerprint('2020-01-02-03-04-05.fit');
    expect(fp.length).toBe(FIT_NAME_SIZE);
    expect(Buffer.from(fp.subarray(0, 23)).toString('ascii')).toBe('2020-01-02-03-04-05.fit');
    expect(fp[23]).toBe(0);
  });

  it('cuts long names to 24 bytes', () => {
    const fp = garminFingerprint('12345678901_ACTIVITY.fit.extra');
    expect(Buffer.from(fp).toString('ascii')).toBe('12345678901_ACTIVITY.fit');
  });
});

describe('garminDiveId', () => {
  it('hashes the full 24-byte fingerprint, including the zero padding', async () => {
    const name = '2020-01-02-03-04-05.fit';
    const padded = Buffer.concat([Buffer.from(name), Buffer.alloc(1)]);
    expect(formatDiveId(await garminDiveId(name))).toBe(referenceId(padded));
    expect(formatDiveId(await garminDiveId(name))).not.toBe(referenceId(Buffer.from(name)));
  });

  it('reads the first SHA-1 word as little endian', async () => {
    const name = '12345678901_ACTIVITY.fit';
    expect(formatDiveId(await garminDiveId(name))).toBe(referenceId(Buffer.from(name)));
  });
});

describe('formatDiveId', () => {
  it('writes 8 lowercase hex digits', () => {
    expect(formatDiveId(0xabc)).toBe('00000abc');
    expect(formatDiveId(0xffffffff)).toBe('ffffffff');
  });
});
