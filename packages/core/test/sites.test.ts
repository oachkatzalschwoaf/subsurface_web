import { describe, expect, it } from 'vitest';
import {
  applyDrafts,
  applyNote,
  applySiteEdit,
  commitMessageForChanges,
  draftFromNote,
  flattenTree,
  formatCoordinates,
  importFit,
  newDraft,
  newNote,
  parseCoordinates,
  parseLogbook,
  serializeLogbook,
  type DiveDraft,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const original = flattenTree(treeFromObject(sampleRepo));

/** A dive with entry (45°, 22.5°) and exit (45°, 22.5° + a bit) positions from the session. */
const fitWithPositions = () => {
  const start = Date.parse('2026-10-18T11:00:00Z') / 1000 - 631065600;
  return buildFit([
    { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 4533]] },
    { global: 20, fields: [[253, 'uint32', start], [92, 'uint32', 5000]] },
    {
      global: 18,
      fields: [
        [2, 'uint32', start],
        [5, 'enum', 53],
        [3, 'sint32', 0x20000000],
        [4, 'sint32', 0x10000000],
        [38, 'sint32', 0x20000000],
        [39, 'sint32', 0x10100000],
      ],
    },
    { global: 268, fields: [[0, 'uint16', 18], [3, 'uint32', 5000], [11, 'uint32', 1800000]] },
  ]);
};
const draft = async (): Promise<DiveDraft> => newDraft(await importFit(fitWithPositions(), '11111111111_ACTIVITY.fit'));
const siteFile = (logbook: ReturnType<typeof load>, name: string) => {
  const site = logbook.sites.find((s) => s.name === name)!;
  return flattenTree(serializeLogbook(logbook)).get(`01-Divesites/Site-${site.uuid.toString(16).padStart(8, '0')}`);
};

describe('position of a new site', () => {
  it('uses the entry point unless another position is chosen', async () => {
    const d = await draft();
    expect(d.fit.entry).toEqual({ lat: 45000000, lon: 22500000 });
    expect(d.fit.exit).toEqual({ lat: 45000000, lon: 22587891 });

    let logbook = load();
    d.site = { kind: 'new', name: 'Old Draft' };
    applyDrafts(logbook, [d], { kind: 'none' });
    expect(siteFile(logbook, 'Old Draft')).toContain('gps 45.000000 22.500000');

    logbook = load();
    d.site = { kind: 'new', name: 'Exit', location: d.fit.exit };
    applyDrafts(logbook, [d], { kind: 'none' });
    expect(siteFile(logbook, 'Exit')).toContain('gps 45.000000 22.587891');

    logbook = load();
    d.site = { kind: 'new', name: 'Nowhere', location: null };
    applyDrafts(logbook, [d], { kind: 'none' });
    expect(siteFile(logbook, 'Nowhere')).toBe('name "Nowhere"\ndescription ""\nnotes ""\n');
  });

  it('takes the position of a note only when the watch had none', async () => {
    const note = { ...newNote('n', Date.parse('2026-10-18T11:50:00Z') / 1000), siteName: 'Reef', location: { lat: 1000000, lon: 2000000 } };
    const withFix = await draft();
    applyNote(withFix, note);
    expect(withFix.site).toEqual({ kind: 'new', name: 'Reef', location: { lat: 45000000, lon: 22500000 } });

    const manual = draftFromNote({ ...note, maxDepth: 10, duration: 30 });
    expect(manual.site).toEqual({ kind: 'new', name: 'Reef', location: { lat: 1000000, lon: 2000000 } });
  });
});

describe('editing a dive site', () => {
  it('renames and moves a site, touching only its file', () => {
    const logbook = load();
    const site = applySiteEdit(logbook, { uuid: 0x00c0ffee, name: ' Lake Spot North ', location: parseCoordinates('47.91, -13.5') });
    expect(site?.name).toBe('Lake Spot North');
    const now = flattenTree(serializeLogbook(logbook));
    const path = '01-Divesites/Site-00c0ffee';
    expect(now.get(path)).toBe(original.get(path)!.replace('name "Lake Spot"', 'name "Lake Spot North"').replace('gps 47.906674 -13.567017', 'gps 47.910000 -13.500000'));
    for (const [p, content] of original) if (p !== path) expect(now.get(p)).toBe(content);
    expect(commitMessageForChanges(logbook, [], [], 'Topside:test', [site!])).toBe(
      'Changes made: \n\nEdit dive site "Lake Spot North"\n\nCreated by Topside:test\n',
    );
  });

  it('removes a position, keeps a name that is left empty, and ignores a missing site', () => {
    const logbook = load();
    applySiteEdit(logbook, { uuid: 0x0000abcd, name: '  ', location: null });
    expect(logbook.sites.find((s) => s.uuid === 0x0000abcd)).toMatchObject({ name: 'Test Reef', location: null });
    expect(applySiteEdit(logbook, { uuid: 42, name: 'x' })).toBeNull();
  });
});

describe('coordinates', () => {
  it.each([
    ['47.906674, -13.567017', { lat: 47906674, lon: -13567017 }],
    ['47.906674 -13.567017', { lat: 47906674, lon: -13567017 }],
    ['47,906674; -13,567017', { lat: 47906674, lon: -13567017 }],
    ['47.906674 -13.567017 12', null],
    ['N 47.906674 W 13.567017', { lat: 47906674, lon: -13567017 }],
    ['47.906674N 13.567017W', { lat: 47906674, lon: -13567017 }],
    ['-8.546062° 119.633°', { lat: -8546062, lon: 119633000 }],
    ['E 119.633 S 8.546062', { lat: -8546062, lon: 119633000 }],
    ['91, 10', null],
    ['10', null],
    ['0, 0', null],
    ['N 10 E 10', { lat: 10000000, lon: 10000000 }],
    ['10 S 10 W', { lat: -10000000, lon: -10000000 }],
    ['', null],
  ])('parses %j', (text, expected) => {
    expect(parseCoordinates(text)).toEqual(expected);
  });

  it('formats like Subsurface', () => {
    expect(formatCoordinates({ lat: -8546062, lon: 119633000 })).toBe('-8.546062, 119.633000');
  });
});
