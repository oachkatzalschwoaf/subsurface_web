import { describe, expect, it } from 'vitest';
import {
  applyDrafts,
  applyPreset,
  cylinderTypes,
  flattenTree,
  importFit,
  newDraft,
  parseLogbook,
  parsePresets,
  presetFromDraft,
  serializeLogbook,
  usedValues,
  type DiveDraft,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { treeFromObject } from './helpers/git-tree.ts';

/** A dive on 2026-10-18; `o2` is the gas set on the dive computer in percent. */
const fit = (localIso: string, o2: number) => {
  const start = Date.parse(`${localIso}Z`) / 1000 - 631065600;
  return buildFit([
    { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 4533]] },
    { global: 259, fields: [[0, 'uint8', 0], [1, 'uint8', o2], [2, 'enum', 1]] },
    { global: 20, fields: [[253, 'uint32', start], [92, 'uint32', 5000]] },
    { global: 18, fields: [[2, 'uint32', start], [5, 'enum', 53]] },
    { global: 268, fields: [[0, 'uint16', 18], [3, 'uint32', 5000], [11, 'uint32', 1800000]] },
  ]);
};
const draftFor = async (localIso: string, name: string, o2 = 21): Promise<DiveDraft> => newDraft(await importFit(fit(localIso, o2), name));
const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const cylinderLine = (logbook: ReturnType<typeof load>) =>
  [...flattenTree(serializeLogbook(logbook))].find(([path]) => path.includes('18-Sun-11=00=00/Dive-'))![1].match(/^cylinder.*$/m)?.[0];

describe('oxygen in drafts', () => {
  it('takes the mix from the dive computer and writes it unchanged', async () => {
    const logbook = load();
    const draft = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit', 32);
    expect(draft.cylinderO2).toBe(32);
    applyDrafts(logbook, [draft], { kind: 'none' });
    expect(cylinderLine(logbook)).toBe('cylinder description="" o2=32.0%');
  });

  it('writes an entered mix, and air as no mix', async () => {
    const nitrox = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    expect(nitrox.cylinderO2).toBeNull();
    Object.assign(nitrox, { cylinderO2: 28, cylinderVolume: 15, cylinderDescription: '15 l steel' });
    let logbook = load();
    applyDrafts(logbook, [nitrox], { kind: 'none' });
    expect(cylinderLine(logbook)).toBe('cylinder vol=15.0l description="15 l steel" o2=28.0%');

    const air = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit', 32);
    air.cylinderO2 = 21;
    logbook = load();
    applyDrafts(logbook, [air], { kind: 'none' });
    expect(cylinderLine(logbook)).not.toContain('o2=');
  });

  it('accepts drafts stored before the field existed', async () => {
    const draft = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit', 30);
    delete (draft as Partial<DiveDraft>).cylinderO2;
    const logbook = load();
    applyDrafts(logbook, [draft], { kind: 'none' });
    expect(cylinderLine(logbook)).toBe('cylinder description="" o2=30.0%');
  });
});

describe('equipment presets', () => {
  it('keeps equipment and people but no pressures', async () => {
    const draft = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    Object.assign(draft, { suit: ' 5 mm ', cylinderDescription: '12 l steel', cylinderVolume: 12, cylinderO2: 32, weight: 6, weightDescription: 'Belt' });
    Object.assign(draft, { buddy: 'Sam', tags: 'Safari', startPressure: 200, endPressure: 50, notes: 'x' });
    const preset = presetFromDraft(' Safari ', draft);
    expect(preset).toEqual({
      name: 'Safari',
      suit: '5 mm',
      cylinderDescription: '12 l steel',
      cylinderVolume: 12,
      cylinderO2: 32,
      weight: 6,
      weightDescription: 'Belt',
      buddy: 'Sam',
      diveGuide: '',
      tags: 'Safari',
    });
    expect(parsePresets(JSON.stringify([preset]))).toEqual([preset]);
  });

  it('fills a draft without erasing input or the recorded gas', async () => {
    const preset = {
      name: 'Safari',
      suit: '5 mm',
      cylinderDescription: '12 l steel',
      cylinderVolume: 12,
      cylinderO2: 32,
      weight: 6,
      weightDescription: '',
      buddy: '',
      diveGuide: '',
      tags: '',
    };
    const air = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    Object.assign(air, { buddy: 'Kim', weightDescription: 'Belt', startPressure: 210 });
    applyPreset(air, preset);
    expect(air).toMatchObject({ suit: '5 mm', cylinderVolume: 12, cylinderO2: 32, weight: 6, weightDescription: 'Belt', buddy: 'Kim', startPressure: 210 });

    const recorded = await draftFor('2026-10-18T15:00:00', '11111111112_ACTIVITY.fit', 28);
    applyPreset(recorded, preset);
    expect(recorded.cylinderO2).toBe(28);
  });

  it('ignores stored data that is not a preset list', () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets('{')).toEqual([]);
    expect(parsePresets('{"name":"x"}')).toEqual([]);
    expect(parsePresets('[1, null, {"suit":"x"}, {"name":"A","weight":"6","cylinderVolume":12}]')).toEqual([
      { name: 'A', suit: '', cylinderDescription: '', cylinderVolume: 12, cylinderO2: null, weight: null, weightDescription: '', buddy: '', diveGuide: '', tags: '' },
    ]);
  });
});

describe('suggestions from the logbook', () => {
  it('lists used cylinder types first, then common ones not yet used', async () => {
    const logbook = load();
    const used = cylinderTypes(logbook);
    const first = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    Object.assign(first, { cylinderDescription: 'Rental 12', cylinderVolume: 12 });
    applyDrafts(logbook, [first], { kind: 'none' });
    const types = cylinderTypes(logbook, [
      { description: 'Rental 12', volume: 99 },
      { description: '15 l steel test', volume: 15 },
    ]);
    expect(types[0]).toEqual({ description: 'Rental 12', volume: 12 });
    expect(types.slice(1, 1 + used.length)).toEqual(used);
    expect(types.at(-1)).toEqual({ description: '15 l steel test', volume: 15 });
    expect(types).toHaveLength(used.length + 2);
  });

  it('lists distinct text values, newest first', async () => {
    const logbook = load();
    const before = usedValues(logbook, (d) => d.buddy);
    const draft = await draftFor('2026-10-18T11:00:00', '11111111111_ACTIVITY.fit');
    draft.buddy = 'Zoe Newest';
    applyDrafts(logbook, [draft], { kind: 'none' });
    expect(usedValues(logbook, (d) => d.buddy)).toEqual(['Zoe Newest', ...before]);
  });
});
