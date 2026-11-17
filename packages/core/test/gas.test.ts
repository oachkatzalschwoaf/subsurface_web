import { describe, expect, it } from 'vitest';
import { airUse, compressibility, depthToMbar, gasVolume, newCylinder, newEvent, parseLogbook, sacRate } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const dive1 = () => parseLogbook(treeFromObject(sampleRepo)).logbook.dives[0]!;

describe('gas use and SAC like Subsurface', () => {
  it('uses real-gas volumes', () => {
    expect(compressibility(0, 0, 1)).toBeCloseTo(0.99968, 5);
    expect(compressibility(0, 0, 200)).toBeCloseTo(1.0359, 4);
    const cyl = { ...newCylinder(), volume: 12000 };
    // 12 l at 200 bar hold about 2287 l of air, not 12 × 200 / 1.013 ≈ 2369 l
    expect(gasVolume(cyl, 200000)).toBe(2287171);
    expect(gasVolume(cyl, 0)).toBe(0);
  });

  it('computes pressure at depth from salinity and surface pressure', () => {
    const dive = dive1();
    // the fixture has fresh water (salinity 10000) and no surface pressure
    expect(depthToMbar(dive, 10000)).toBe(1013 + 981);
    dive.computers[0]!.salinity = 0;
    expect(depthToMbar(dive, 10000)).toBe(1013 + 1010);
    dive.computers[0]!.surfacePressure = 950;
    expect(depthToMbar(dive, 10000)).toBe(950 + 1010);
  });

  it('gives the SAC rate of the sample dive', () => {
    const dive = dive1();
    expect(airUse(dive)).toBeCloseTo(1712.377, 3);
    expect(sacRate(dive)).toBe(22830);
  });

  it('gives nothing when gas use is not known for a breathed cylinder', () => {
    const noEnd = dive1();
    noEnd.cylinders[0]!.end = 0;
    expect(sacRate(noEnd)).toBe(0);

    const ccr = dive1();
    ccr.computers[0]!.diveMode = 1;
    expect(sacRate(ccr)).toBe(0);

    // a second cylinder without pressures is ignored, unless the dive switched to it
    const second = dive1();
    second.cylinders.push({ ...newCylinder(), volume: 7000 });
    expect(sacRate(second)).toBe(22830);
    const change = { ...newEvent(600), type: 25, name: 'gaschange', cylinder: 1 };
    second.computers[0]!.events.push(change);
    expect(sacRate(second)).toBe(0);

    // "not used" cylinders never count
    second.cylinders[1]!.use = 3;
    expect(sacRate(second)).toBe(22830);
  });

  it('falls back to tank pressures recorded in the samples', () => {
    const dive = dive1();
    const cyl = dive.cylinders[0]!;
    cyl.start = 0;
    cyl.end = 0;
    const samples = dive.computers[0]!.samples;
    samples[0]!.pressures = [{ sensor: 0, mbar: 200000 }];
    samples[samples.length - 1]!.pressures = [{ sensor: 0, mbar: 50000 }];
    expect(sacRate(dive)).toBe(22830);
  });
});
