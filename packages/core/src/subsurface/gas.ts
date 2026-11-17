/**
 * Gas use and SAC rate, computed the way Subsurface does for its dive list and XML export
 * (calculate_airuse() and calculate_sac() in core/divelist.cpp, gas_volume() in
 * core/equipment.cpp, gas_compressibility_factor() in core/gas-model.cpp, depth_to_mbar() in
 * core/dive.cpp). Real-gas behaviour matters: 200 bar of air is noticeably less than 200 times
 * the cylinder volume.
 */
import { CYLINDER_USE, isGasChange, type Cylinder, type Dive } from './model.ts';
import { lrint } from './units.ts';

const O2_IN_AIR = 209;
const SEAWATER_SALINITY = 10300;
const FRESHWATER_SALINITY = 10000;
const ONE_ATM_MBAR = 1013;
const NOT_USED = CYLINDER_USE.indexOf('not used');
const MANUAL_DC = 'manually added dive';

const O2 = [-7.18092073703e-4, +2.81852572808e-6, -1.50290620492e-9];
const N2 = [-2.19260353292e-4, +2.92844845532e-6, -2.07613482075e-9];
const HE = [+4.87320026468e-4, -8.83632921053e-8, +5.33304543646e-11];
const virialM1 = (c: number[], x: number) => x * c[0]! + x * x * c[1]! + x * x * x * c[2]!;

/** Z = pV/nRT of a mix (permille, o2 0 = air) at `bar`. */
export function compressibility(o2Permille: number, hePermille: number, bar: number): number {
  const p = Math.min(Math.max(bar, 0), 500);
  const o2 = o2Permille || O2_IN_AIR;
  const z = virialM1(O2, p) * o2 + virialM1(HE, p) * hePermille + virialM1(N2, p) * (1000 - o2 - hePermille);
  return z * 0.001 + 1;
}

/** Gas in a cylinder at `mbar`, in ml at surface pressure. */
export function gasVolume(cylinder: Cylinder, mbar: number): number {
  const bar = mbar / 1000;
  return lrint((cylinder.volume * ((bar / ONE_ATM_MBAR) * 1000)) / compressibility(cylinder.o2, cylinder.he, bar));
}

/** Absolute pressure at a depth of the dive, in mbar. */
export function depthToMbar(dive: Dive, depthMm: number): number {
  const dc = dive.computers[0];
  const manual = dc?.model === MANUAL_DC;
  let salinity = (manual ? dive.userSalinity : dc?.salinity) || SEAWATER_SALINITY;
  if (salinity < 500) salinity += FRESHWATER_SALINITY;
  const surface = dc?.surfacePressure || ONE_ATM_MBAR;
  return lrint(surface + depthMm * ((salinity * 0.981) / 100000));
}

/** First and last tank pressure the samples recorded for a cylinder. */
function samplePressures(dive: Dive, index: number): [number, number] {
  let first = 0;
  let last = 0;
  for (const dc of dive.computers.slice(0, 1)) {
    const mapped = dc.tankSensorMappings.find((m) => m.cylinderIndex === index)?.sensorId ?? index;
    for (const s of dc.samples) {
      for (const p of s.pressures) {
        if (p.sensor !== mapped || !p.mbar) continue;
        if (!first) first = p.mbar;
        last = p.mbar;
      }
    }
  }
  return [first, last];
}

/** Whether the dive breathes from a cylinder: the first one, or one switched to. */
function isUsed(dive: Dive, index: number): boolean {
  if (index === 0) return true;
  return dive.computers.some((dc) => dc.events.some((e) => isGasChange(e) && e.cylinder === index));
}

/** Gas used over all cylinders, in litres at surface pressure; 0 if not known for every used one. */
export function airUse(dive: Dive): number {
  if (dive.computers[0]?.diveMode === 1) return 0; // CCR
  let ml = 0;
  for (const [i, cylinder] of dive.cylinders.entries()) {
    if (cylinder.use === NOT_USED) continue;
    const [sampleStart, sampleEnd] = samplePressures(dive, i);
    const start = cylinder.start || sampleStart;
    const end = cylinder.end || sampleEnd;
    if (!end || start <= end) {
      if (isUsed(dive, i)) return 0;
      continue;
    }
    ml += gasVolume(cylinder, start) - gasVolume(cylinder, end);
  }
  return ml / 1000;
}

/** Surface air consumption in ml/min, as Subsurface shows it; 0 if it cannot be computed. */
export function sacRate(dive: Dive): number {
  const dc = dive.computers[0];
  const litres = airUse(dive);
  if (!litres || !dc?.duration || !dc.meanDepth) return 0;
  const atm = depthToMbar(dive, dc.meanDepth) / ONE_ATM_MBAR;
  return lrint(((litres / atm) * 60 * 1000) / dc.duration);
}
