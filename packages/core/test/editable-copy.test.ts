import { describe, expect, it } from 'vitest';
import {
  applyDrafts,
  applyEdit,
  applySiteEdit,
  applyTripEdit,
  editableCopy,
  flattenTree,
  importFit,
  listTrips,
  mergeDives,
  newDraft,
  parseLogbook,
  serializeLogbook,
  type DiveDraft,
  type Logbook,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const files = (logbook: Logbook) => flattenTree(serializeLogbook(logbook));

async function draft(): Promise<DiveDraft> {
  const start = Date.parse('2026-10-18T10:00:00Z') / 1000 - 631065600;
  const fit = buildFit([
    { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 4533]] },
    { global: 20, fields: [[253, 'uint32', start], [92, 'uint32', 5000]] },
    { global: 20, fields: [[253, 'uint32', start + 10], [92, 'uint32', 7000]] },
    { global: 18, fields: [[2, 'uint32', start], [5, 'enum', 53]] },
    { global: 268, fields: [[0, 'uint16', 18], [3, 'uint32', 7000], [11, 'uint32', 1800000]] },
  ]);
  const d = newDraft(await importFit(fit, '22222222222_ACTIVITY.fit'));
  d.buddy = 'New buddy';
  d.startPressure = 200;
  return d;
}

/** Every kind of change the app applies to a logbook before showing or uploading it. */
function change(logbook: Logbook, drafts: DiveDraft[]): void {
  const [first, second, third] = logbook.dives;
  applyEdit(logbook, {
    when: first!.when,
    changes: { buddy: 'Changed', cylinderVolume: 15, startPressure: 210, weight: 6, weightDescription: 'belt', tags: 'a, b' },
    site: { kind: 'existing', uuid: 0x00c0ffee },
    addPictures: [{ offset: 60, filename: 'Topside/x/a.jpg', location: null }],
  });
  applyEdit(logbook, { when: second!.when, changes: { rating: 2 }, removePictures: [second!.pictures[0]!.filename] });
  applyEdit(logbook, { when: third!.when, changes: {}, delete: true });
  applySiteEdit(logbook, { uuid: 0x0000abcd, name: 'Renamed Reef', location: { lat: 1000000, lon: 2000000 } });
  const trip = listTrips(logbook)[0]!;
  applyTripEdit(logbook, { location: trip.trip.location, first: trip.first, newLocation: 'Renamed Trip', notes: 'Trip notes' });
  applyDrafts(logbook, drafts, { kind: 'existing', location: 'Renamed Trip', first: trip.first });
}

describe('editableCopy', () => {
  it('takes every change without changing the original', async () => {
    const drafts = [await draft()];
    const base = load();
    const before = structuredClone(base);
    const copy = editableCopy(base);
    change(copy, drafts);
    expect(base).toEqual(before);
    expect(files(base)).toEqual(flattenTree(treeFromObject(sampleRepo)));

    // the copy ends up exactly like a freshly parsed logbook with the same changes
    const fresh = load();
    change(fresh, drafts);
    expect(files(copy)).toEqual(files(fresh));
  });

  it('shares the samples instead of copying them', () => {
    const base = load();
    const copy = editableCopy(base);
    expect(copy.dives[0]!.computers).toBe(base.dives[0]!.computers);
    expect(copy.dives[0]!.trip).not.toBe(base.dives[0]!.trip);
    expect(copy.dives[0]!.trip).toBe(copy.dives[1]!.trip);
  });

  it('can be merged into without changing the original', () => {
    const base = load();
    const before = structuredClone(base);
    const target = editableCopy(base);
    const other = load();
    for (const d of other.dives) {
      d.when += 86400 * 30;
      for (const dc of d.computers) dc.diveId = 0;
    }
    mergeDives(target, other);
    expect(target.dives.length).toBe(6);
    expect(base).toEqual(before);
  });
});
