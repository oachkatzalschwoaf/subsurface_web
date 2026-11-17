import { describe, expect, it } from 'vitest';
import { applyEdit, applyTripEdit, commitMessageForChanges, flattenTree, mergeEdits, parseLogbook, serializeLogbook, type Logbook } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const original = flattenTree(treeFromObject(sampleRepo));
const at = (localIso: string) => Date.parse(`${localIso}Z`) / 1000;
const WHEN1 = at('2026-04-26T10:13:05');
const WHEN2 = at('2026-05-01T11:31:26');
const TRIP = '2026/04/26-TestTrip';

const paths = (logbook: Logbook) => [...flattenTree(serializeLogbook(logbook)).keys()];

describe('deleting dives', () => {
  it('removes the dive and keeps everything else, numbers included', () => {
    const logbook = load();
    const dive = applyEdit(logbook, { when: WHEN1, changes: {}, delete: true });
    expect(dive?.number).toBe(1);
    const now = flattenTree(serializeLogbook(logbook));
    // The trip now starts on 1 May, so its directory moves there, as Subsurface names it by the
    // first dive. The remaining dive's files keep their content.
    expect(now.get('2026/05/01-TestTrip/00-Trip')).toBe('date 2026-05-01\ntime 11:31:26\nlocation "Test Trip, Somewhere"\nnotes ""\n');
    expect([...now.keys()].some((p) => p.includes('10=13=05'))).toBe(false);
    expect(now.get('2026/05/01-TestTrip/01-Fri-11=31=26/Dive-2')).toBe(original.get(`${TRIP}/05-01-Fri-11=31=26/Dive-2`));
    for (const [p, content] of original) if (!p.startsWith(`${TRIP}/`)) expect(now.get(p)).toBe(content);
    expect(logbook.dives.map((d) => d.number)).toEqual([2, 3]);
    expect(applyEdit(logbook, { when: WHEN1, changes: {}, delete: true })).toBeNull();
  });

  it('removes a trip whose last dive is deleted', () => {
    const logbook = load();
    applyEdit(logbook, { when: WHEN1, changes: {}, delete: true });
    applyEdit(logbook, { when: WHEN2, changes: {}, delete: true });
    expect(logbook.trips).toEqual([]);
    expect(paths(logbook).some((p) => p.startsWith('2026/04/'))).toBe(false);
  });

  it('keeps a delete when merged with other edits', () => {
    expect(mergeEdits({ when: 1, changes: { buddy: 'A' } }, { when: 1, changes: {}, delete: true }).delete).toBe(true);
    expect(mergeEdits({ when: 1, changes: {}, delete: true }, { when: 1, changes: { buddy: 'B' } }).delete).toBe(true);
  });
});

describe('editing trips', () => {
  it('renames a trip, which renames its directory as Subsurface does', () => {
    const logbook = load();
    const trip = applyTripEdit(logbook, { location: 'Test Trip, Somewhere', first: WHEN1, newLocation: ' Red Sea 2026 ', notes: 'Boat' });
    expect(trip?.location).toBe('Red Sea 2026');
    const now = flattenTree(serializeLogbook(logbook));
    expect(now.get('2026/04/26-RedSea/00-Trip')).toBe('date 2026-04-26\ntime 10:13:05\nlocation "Red Sea 2026"\nnotes "Boat"\n');
    expect([...now.keys()].some((p) => p.startsWith(`${TRIP}/`))).toBe(false);
    // the dives inside are unchanged
    for (const [p, content] of original) {
      if (p.startsWith(`${TRIP}/`) && !p.endsWith('00-Trip')) expect(now.get(p.replace('26-TestTrip', '26-RedSea'))).toBe(content);
    }
  });

  it('finds nothing for a trip that is gone or a wrong first dive', () => {
    const logbook = load();
    expect(applyTripEdit(logbook, { location: 'Test Trip, Somewhere', first: WHEN2, newLocation: 'x' })).toBeNull();
    expect(applyTripEdit(logbook, { location: 'Nowhere', first: WHEN1, newLocation: 'x' })).toBeNull();
  });
});

describe('commit messages', () => {
  it('lists deletions and trip edits', () => {
    const logbook = load();
    const [one, two] = logbook.dives;
    const trip = one!.trip!;
    expect(commitMessageForChanges(logbook, [], [two!], 'Topside:test', { deleted: [one!], trips: [trip] })).toBe(
      'Changes made: \n\nEdit dive #2 (2026-05-01, Lake Spot)\nDelete dive #1 (2026-04-26, Lake Spot)\nEdit trip "Test Trip, Somewhere"\n\nCreated by Topside:test\n',
    );
  });
});
