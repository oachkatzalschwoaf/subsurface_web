/**
 * Checks against a real Subsurface repository on the developer's machine.
 *
 * Real dive logs are private, so they are never committed. Point TOPSIDE_REAL_REPO at a local
 * clone of your Subsurface cloud storage to run these tests; without it they are skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDiveId, garminDiveId } from '../src/index.ts';

const repo = process.env.TOPSIDE_REAL_REPO
  ? resolve(process.env.TOPSIDE_REAL_REPO)
  : resolve(import.meta.dirname, '../../../../cloud-repo');
const settingsFile = join(repo, '00-Subsurface');

describe.skipIf(!existsSync(settingsFile))('real Subsurface repository', () => {
  it('Garmin fingerprint records match garminDiveId', async () => {
    const lines = readFileSync(settingsFile, 'utf8').split('\n');
    const records = lines
      .map((line) => /^fingerprint .*diveid=([0-9a-f]{8}) data="([0-9a-f]+)"/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null);
    expect(records.length).toBeGreaterThan(0);

    for (const [, diveId, hex] of records) {
      const fileName = Buffer.from(hex!, 'hex').toString('latin1').replace(/\0+$/, '');
      if (!/\.fit$/i.test(fileName)) continue;
      expect(formatDiveId(await garminDiveId(fileName))).toBe(diveId);
    }
  });
});
