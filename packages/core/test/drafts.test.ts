import { describe, expect, it } from 'vitest';
import { applyDrafts, flattenTree, importFit, listTrips, newDraft, parseLogbook, serializeLogbook, type DiveDraft } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const fit = (localIso: string) => {
  const start = Date.parse(`${localIso}Z`) / 1000 - 631065600;
  return buildFit([
    { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 4533]] },
    { global: 259, fields: [[0, 'uint8', 0], [1, 'uint8', 21], [2, 'enum', 1]] },
    { global: 20, fields: [[253, 'uint32', start], [92, 'uint32', 5000], [0, 'sint32', 0x20000000], [1, 'sint32', 0x10000000]] },
    { global: 18, fields: [[2, 'uint32', start], [5, 'enum', 53]] },
    { global: 268, fields: [[0, 'uint16', 18], [3, 'uint32', 5000], [11, 'uint32', 1800000]] },
  ]);
};

const draftFor = async (localIso: string, name: string): Promise<DiveDraft> => newDraft(await importFit(fit(localIso), name));
const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;

describe('applyDrafts', () => {
  it('adds dives to a new trip with numbers, shared new site and equipment', async () => {
    const logbook = load();
    const a = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    const b = await draftFor('2026-10-18T15:00:00', '11111111112_ACTIVITY.fit');
    Object.assign(a, { site: { kind: 'new', name: 'House Reef' }, buddy: ' Sam ', tags: 'Night, Wreck, Night', rating: 4 });
    Object.assign(a, { cylinderVolume: 15, cylinderDescription: '15L Steel', startPressure: 200, endPressure: 50, weight: 6, weightDescription: 'Belt' });
    Object.assign(b, { site: { kind: 'new', name: 'House Reef' } });

    const { added, duplicates } = applyDrafts(logbook, [b, a], { kind: 'new', location: 'Red Sea', notes: '' });
    expect(duplicates).toEqual([]);
    expect(added.map((d) => d.number).sort()).toEqual([4, 5]);

    const files = flattenTree(serializeLogbook(logbook));
    const base = '2026/10/18-RedSea';
    expect(files.get(`${base}/00-Trip`)).toBe('date 2026-10-18\ntime 11:00:00\nlocation "Red Sea"\nnotes ""\n');
    expect(files.get(`${base}/18-Sun-11=00=00/Dive-4`)).toBe(
      [
        'duration 30:00 min',
        'rating 4',
        'tags "Night", "Wreck"',
        `divesiteid ${files.get(`${base}/18-Sun-15=00=00/Dive-5`)!.match(/divesiteid (\w+)/)![1]}`,
        'divemaster ""',
        'buddy "Sam"',
        'suit ""',
        'notes ""',
        'cylinder vol=15.0l description="15L Steel" start=200.0bar end=50.0bar',
        'weightsystem weight=6.0kg description="Belt"',
        '',
      ].join('\n'),
    );
    const sites = [...files.keys()].filter((p) => p.startsWith('01-Divesites/'));
    expect(sites).toHaveLength(3);
    const created = logbook.sites.find((s) => s.name === 'House Reef')!;
    expect(files.get(`01-Divesites/Site-${created.uuid.toString(16).padStart(8, '0')}`)).toBe(
      'name "House Reef"\ndescription ""\nnotes ""\ngps 45.000000 22.500000\n',
    );
    // Everything that existed before is untouched
    for (const [path, content] of flattenTree(treeFromObject(sampleRepo))) expect(files.get(path)).toBe(content);
  });

  it('adds to an existing trip and reuses an existing site', async () => {
    const logbook = load();
    const [existing] = listTrips(logbook);
    const draft = await draftFor('2026-08-01T09:00:00', '11111111113_ACTIVITY.fit');
    draft.site = { kind: 'existing', uuid: 0x00c0ffee };
    const { added } = applyDrafts(logbook, [draft], { kind: 'existing', location: existing!.trip.location, first: existing!.first });
    expect(added[0]!.trip).toBe(existing!.trip);
    expect(added[0]!.number).toBe(4);
    expect([...flattenTree(serializeLogbook(logbook)).keys()]).toContain('2026/04/26-TestTrip/08-01-Sat-09=00=00/Dive-4');
  });

  it('skips dives that are already in the logbook', async () => {
    const logbook = load();
    const draft = await draftFor('2026-07-18T10:19:40', '11111111114_ACTIVITY.fit'); // 11 s after dive 3
    const { added, duplicates } = applyDrafts(logbook, [draft], { kind: 'none' });
    expect(added).toEqual([]);
    expect(duplicates).toEqual([draft]);
    expect(logbook.dives).toHaveLength(3);
  });

  it('fails clearly when the chosen trip is gone', async () => {
    const draft = await draftFor('2026-08-01T09:00:00', '11111111115_ACTIVITY.fit');
    expect(() => applyDrafts(load(), [draft], { kind: 'existing', location: 'Nowhere', first: 1 })).toThrow('no longer in the logbook');
  });
});
