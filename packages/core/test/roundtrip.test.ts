import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenTree, parseLogbook, serializeLogbook, unflattenTree, type GitTree } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { describeDifferences, readGitTree, treeFromObject } from './helpers/git-tree.ts';

function roundTrip(tree: GitTree) {
  const { logbook, warnings } = parseLogbook(tree);
  const written = serializeLogbook(logbook);
  return { logbook, warnings, differences: describeDifferences(flattenTree(tree), flattenTree(written)) };
}

describe('round trip of the synthetic repository', () => {
  const tree = treeFromObject(sampleRepo);

  it('parses without warnings and writes identical files', () => {
    const { warnings, differences } = roundTrip(tree);
    expect(warnings).toEqual([]);
    expect(differences).toEqual([]);
  });

  it('notices a changed value (guards the comparison itself)', () => {
    const { logbook } = parseLogbook(tree);
    logbook.dives[0]!.computers[0]!.samples[2]!.heartbeat = 96;
    const differences = describeDifferences(flattenTree(tree), flattenTree(serializeLogbook(logbook)));
    expect(differences).toEqual([
      '2026/04/26-TestTrip/04-26-Sun-10=13=05/Divecomputer:13: expected "  0:20 8.25m 14.9°C ndl=55:00 cns=1% po2=0.3bar heartbeat=95", got "  0:20 8.25m 14.9°C ndl=55:00 cns=1% po2=0.3bar heartbeat=96"',
    ]);
  });

  it('reads the expected content', () => {
    const { logbook } = roundTrip(tree);
    expect(logbook.dives.map((d) => d.number)).toEqual([1, 2, 3]);
    const [first, second, third] = logbook.dives;
    expect(first!.trip).toBe(second!.trip);
    expect(first!.trip!.location).toBe('Test Trip, Somewhere');
    expect(third!.trip).toBeNull();
    expect(first!.notes).toBe('First line\n\nafter empty');
    expect(third!.notes).toBe('Quote "inside" and backslash \\ end');
    expect(first!.tags).toEqual(['Training', 'Lake']);
    expect(first!.cylinders[0]).toMatchObject({ volume: 12000, workPressure: 232000, o2: 320, start: 200000 });

    const dc = first!.computers[0]!;
    expect(dc.maxDepth).toBe(12345);
    expect(dc.waterTemp).toBe(287150);
    expect(dc.salinity).toBe(10000);
    // carried over from the previous sample
    expect(dc.samples[1]).toMatchObject({ time: 10, depth: 3500, ndl: 5940, heartbeat: 90, temperature: 0 });
    expect(dc.samples[5]!.pressures).toEqual([{ sensor: 0, mbar: 200000 }]);

    expect(second!.computers.map((c) => c.duration)).toEqual([2095, 1800]);
    expect(second!.computers[1]!.when).toBe(second!.when - 86);
    expect(second!.pictures.map((p) => p.offset)).toEqual([300, -90]);
    expect(logbook.sites.find((s) => s.uuid === 0x00c0ffee)!.location).toEqual({ lat: 47906674, lon: -13567017 });
  });
});

/**
 * Real dive logs are private, so they are never committed. Point TOPSIDE_REAL_REPO at a local
 * clone of your Subsurface cloud storage to run this test; without it, it is skipped.
 */
const realRepo = process.env.TOPSIDE_REAL_REPO
  ? resolve(process.env.TOPSIDE_REAL_REPO)
  : resolve(import.meta.dirname, '../../../../cloud-repo');

describe.skipIf(!existsSync(join(realRepo, '.git')))('round trip of a real Subsurface repository', () => {
  it('parses without warnings and writes every file byte for byte', () => {
    const tree = readGitTree(realRepo);
    const { logbook, warnings, differences } = roundTrip(tree);
    expect(warnings).toEqual([]);
    expect(differences).toEqual([]);
    expect(logbook.dives.length).toBeGreaterThan(0);
    expect(flattenTree(tree).size).toBeGreaterThan(logbook.dives.length * 2);
  });
});

describe('unflattenTree', () => {
  it('restores a flattened tree, including empty directories', () => {
    const tree = treeFromObject({ ...sampleRepo, '02-Filterpresets': {} });
    expect(flattenTree(unflattenTree(flattenTree(tree)))).toEqual(flattenTree(tree));
  });
});
