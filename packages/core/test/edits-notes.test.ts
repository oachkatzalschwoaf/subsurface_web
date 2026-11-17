import { describe, expect, it } from 'vitest';
import {
  applyDrafts,
  applyEdit,
  applyNote,
  canBecomeDive,
  changedDetails,
  commitMessageForChanges,
  detailsOf,
  draftFromNote,
  flattenTree,
  importFit,
  isEmptyEdit,
  matchNotes,
  newDraft,
  newNote,
  parseLogbook,
  serializeLogbook,
  type DiveEdit,
  type DiveNote,
  type Logbook,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const at = (localIso: string) => Date.parse(`${localIso}Z`) / 1000;
const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const original = flattenTree(treeFromObject(sampleRepo));
const files = (logbook: Logbook) => flattenTree(serializeLogbook(logbook));

const DIVE1 = '2026/04/26-TestTrip/04-26-Sun-10=13=05/Dive-1';
const DIVE2 = '2026/04/26-TestTrip/05-01-Fri-11=31=26/Dive-2';
const DIVE3 = '2026/07/18-Sat-10=19=29/Dive-3';
const WHEN1 = at('2026-04-26T10:13:05');
const WHEN2 = at('2026-05-01T11:31:26');
const WHEN3 = at('2026-07-18T10:19:29');

/** Paths whose content differs from the fixture, plus added and removed ones. */
function changedPaths(logbook: Logbook): string[] {
  const now = files(logbook);
  const paths = new Set([...original.keys(), ...now.keys()]);
  return [...paths].filter((p) => original.get(p) !== now.get(p)).sort();
}

describe('editing dives', () => {
  it('reads the editable details of a dive', () => {
    const dive = load().dives.find((d) => d.when === WHEN1)!;
    expect(detailsOf(dive)).toEqual({
      buddy: 'Sam Sample',
      diveGuide: 'Alex Example',
      suit: '7 mm wetsuit',
      notes: 'First line\n\nafter empty',
      tags: 'Training, Lake',
      rating: 4,
      visibility: 3,
      cylinderVolume: 12,
      cylinderDescription: '12L Steel',
      cylinderO2: 32,
      startPressure: 200,
      endPressure: 50,
      weight: 6,
      weightDescription: 'Belt',
    });
    expect(changedDetails(detailsOf(dive), detailsOf(dive))).toEqual({});
    expect(isEmptyEdit({ when: WHEN1, changes: {} })).toBe(true);
  });

  it('changes only the edited fields of only that dive', () => {
    const logbook = load();
    const before = detailsOf(logbook.dives.find((d) => d.when === WHEN1)!);
    const changes = changedDetails(before, { ...before, buddy: ' Kim Sample ', endPressure: 60, tags: 'Lake,  Training , Night' });
    expect(changes).toEqual({ buddy: 'Kim Sample', endPressure: 60, tags: 'Lake,  Training , Night' });

    expect(applyEdit(logbook, { when: WHEN1, changes })?.number).toBe(1);
    expect(changedPaths(logbook)).toEqual([DIVE1]);
    expect(files(logbook).get(DIVE1)).toBe(
      original
        .get(DIVE1)!
        .replace('buddy "Sam Sample"', 'buddy "Kim Sample"')
        .replace('end=50.0bar', 'end=60.0bar')
        .replace('tags "Training", "Lake"', 'tags "Lake", "Training", "Night"'),
    );
  });

  it('adds a cylinder and a weight to a dive that had none, and moves it to a new site', () => {
    const logbook = load();
    const edit: DiveEdit = {
      when: WHEN2,
      changes: { cylinderVolume: 15, cylinderO2: 32, startPressure: 210, weight: 4, weightDescription: 'Belt' },
      site: { kind: 'new', name: ' New Place ' },
    };
    applyEdit(logbook, edit);
    const site = logbook.sites.find((s) => s.name === 'New Place')!;
    const sitePath = `01-Divesites/Site-${site.uuid.toString(16).padStart(8, '0')}`;
    expect(changedPaths(logbook)).toEqual([sitePath, DIVE2].sort());
    const now = files(logbook);
    // the dive did not move, so the new site is where the old one was
    expect(now.get(sitePath)).toBe('name "New Place"\ndescription ""\nnotes ""\ngps 47.906674 -13.567017\n');
    expect(now.get(DIVE2)).toBe(
      original
        .get(DIVE2)!
        .replace('divesiteid 00c0ffee', `divesiteid ${site.uuid.toString(16).padStart(8, '0')}`)
        .replace('notes ""\n', 'notes ""\ncylinder vol=15.0l description="" o2=32.0% start=210.0bar\nweightsystem weight=4.0kg description="Belt"\n'),
    );
  });

  it('clears values: air instead of nitrox, no weight, no site', () => {
    const logbook = load();
    applyEdit(logbook, { when: WHEN1, changes: { cylinderO2: null, weight: null, weightDescription: '' }, site: { kind: 'none' } });
    expect(files(logbook).get(DIVE1)).toBe(
      original.get(DIVE1)!.replace(' o2=32.0%', '').replace('weightsystem weight=6.0kg description="Belt"\n', '').replace('divesiteid 00c0ffee\n', ''),
    );
  });

  it('keeps an empty weight entry written by Subsurface unless it is edited', () => {
    const logbook = load();
    applyEdit(logbook, { when: WHEN3, changes: { buddy: 'Duo' } });
    expect(files(logbook).get(DIVE3)).toBe(original.get(DIVE3)!.replace('buddy "Solo"', 'buddy "Duo"'));
    applyEdit(logbook, { when: WHEN3, changes: { weight: 2 } });
    expect(files(logbook).get(DIVE3)).toContain('weightsystem weight=2.0kg description=""');
  });

  it('leaves the logbook alone when the dive or the chosen site is gone', () => {
    const logbook = load();
    expect(applyEdit(logbook, { when: WHEN1 + 5, changes: { buddy: 'x' } })).toBeNull();
    applyEdit(logbook, { when: WHEN1, changes: {}, site: { kind: 'existing', uuid: 12345 } });
    expect(changedPaths(logbook)).toEqual([]);
  });

  it('names added and edited dives in the commit message', () => {
    const logbook = load();
    const [one, two] = logbook.dives;
    expect(commitMessageForChanges(logbook, [two!], [one!, two!, one!], 'Topside:test')).toBe(
      'Changes made: \n\nAdd dive #2 (2026-05-01, Lake Spot)\nEdit dive #1 (2026-04-26, Lake Spot)\n\nCreated by Topside:test\n',
    );
  });
});

describe('notes taken before the FIT file exists', () => {
  const note = (id: string, localIso: string, extra: Partial<DiveNote> = {}): DiveNote => ({ ...newNote(id, at(localIso)), ...extra });
  const dives = [
    { when: at('2026-10-18T10:00:00'), duration: 45 * 60 },
    { when: at('2026-10-18T12:00:00'), duration: 50 * 60 },
  ];

  it('matches notes to dives by time', () => {
    const afterFirst = note('a', '2026-10-18T10:50:00');
    const beforeSecond = note('b', '2026-10-18T11:55:00');
    const between = note('c', '2026-10-18T11:20:00');
    const nextDay = note('d', '2026-10-19T10:10:00');
    const matched = matchNotes([nextDay, between, beforeSecond, afterFirst], dives);
    expect([...matched].map(([index, n]) => [index, n.id]).sort()).toEqual([
      [0, 'a'],
      [1, 'b'],
    ]);
    // written between two dives, a note belongs to the one that is over
    expect(matchNotes([between], dives).get(0)?.id).toBe('c');
    expect(matchNotes([nextDay], dives).size).toBe(0);
  });

  it('fills a draft from a note without erasing input or the recorded gas', async () => {
    const start = at('2026-10-18T10:00:00') - 631065600;
    const fit = buildFit([
      { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 4533]] },
      { global: 259, fields: [[0, 'uint8', 0], [1, 'uint8', 30], [2, 'enum', 1]] },
      { global: 20, fields: [[253, 'uint32', start], [92, 'uint32', 5000]] },
      { global: 18, fields: [[2, 'uint32', start], [5, 'enum', 53]] },
      { global: 268, fields: [[0, 'uint16', 18], [3, 'uint32', 5000], [11, 'uint32', 1800000]] },
    ]);
    const draft = newDraft(await importFit(fit, '11111111111_ACTIVITY.fit'));
    draft.buddy = 'Typed';
    applyNote(draft, note('a', '2026-10-18T10:50:00', { startPressure: 205, endPressure: 60, cylinderO2: 32, suit: '5 mm', siteName: ' House Reef ', rating: 4 }), true);
    expect(draft).toMatchObject({ buddy: 'Typed', startPressure: 205, endPressure: 60, cylinderO2: 30, suit: '5 mm', rating: 4, site: { kind: 'new', name: 'House Reef' } });
  });

  it('turns a note into a dive without a profile', () => {
    const logbook = load();
    const n = note('n1', '2026-10-18T10:00:00', { buddy: 'Sam', startPressure: 200, endPressure: 70, siteName: 'House Reef' });
    expect(canBecomeDive(n)).toBe(false);
    expect(() => draftFromNote(n)).toThrow();
    Object.assign(n, { maxDepth: 18.5, duration: 45 });
    expect(canBecomeDive(n)).toBe(true);

    const { added } = applyDrafts(logbook, [draftFromNote(n)], { kind: 'none' });
    expect(added[0]!.number).toBe(4);
    const now = files(logbook);
    const dir = '2026/10/18-Sun-10=00=00';
    const site = logbook.sites.find((s) => s.name === 'House Reef')!;
    expect(now.get(`${dir}/Dive-4`)).toBe(
      [
        'duration 45:00 min',
        `divesiteid ${site.uuid.toString(16).padStart(8, '0')}`,
        'divemaster ""',
        'buddy "Sam"',
        'suit ""',
        'notes ""',
        'cylinder description="" start=200.0bar end=70.0bar',
        '',
      ].join('\n'),
    );
    expect(now.get(`${dir}/Divecomputer`)).toBe('model "manually added dive"\nmaxdepth 18.5m\n');
    expect(site.location).toBeNull();
  });
});
