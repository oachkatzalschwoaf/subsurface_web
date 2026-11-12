/**
 * Number formats of the Subsurface git storage.
 *
 * Subsurface keeps every quantity as an integer in milli-units (mm, mbar, ml, g, mK) and writes it
 * with put_milli() from core/membuffer.cpp. Reading goes through ascii_strtod() and lrint() in
 * core/load-git.cpp. The helpers here mirror both sides exactly, because the round-trip test
 * compares files byte by byte.
 */

/** 0 °C in millikelvin (core/units.h) */
export const ZERO_C_IN_MKELVIN = 273150;

/** C's lrint() in the default rounding mode: round half to even. */
export function lrint(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const NUMBER_PREFIX = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** C's strtod() on the start of a string; 0 if there is no number. */
export function strtod(text: string): number {
  const m = NUMBER_PREFIX.exec(text);
  return m ? Number.parseFloat(m[0]) : 0;
}

/** C's atoi() */
export function atoi(text: string): number {
  const m = /^\s*[+-]?\d+/.exec(text);
  return m ? Number.parseInt(m[0], 10) : 0;
}

/** C's strtoul(text, NULL, 16) */
export function parseHex(text: string): number {
  const m = /^\s*(?:0[xX])?([0-9a-fA-F]+)/.exec(text);
  return m ? Number.parseInt(m[1]!, 16) >>> 0 : 0;
}

/** `%08x` */
export function formatHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** put_milli(): 11759 → "11.759", 27000 → "27.0", 250 → "0.25" */
export function formatMilli(value: number): string {
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  let frac = String(v % 1000).padStart(3, '0');
  if (frac[2] === '0') {
    frac = frac.slice(0, 2);
    if (frac[1] === '0') frac = frac.slice(0, 1);
  }
  return `${sign}${Math.floor(v / 1000)}.${frac}`;
}

/** get_depth(), get_volume(), get_weight(): lrint(1000 * strtod) */
export function parseMilli(text: string): number {
  return lrint(1000 * strtod(text));
}

/** get_temperature(): C_to_mkelvin(strtod) */
export function parseTemperature(text: string): number {
  return lrint(strtod(text) * 1000 + ZERO_C_IN_MKELVIN);
}

/** put_temperature() without the zero check */
export function formatTemperature(mkelvin: number): string {
  return formatMilli(mkelvin - ZERO_C_IN_MKELVIN);
}

/** get_salinity(): stored in 0.1 g/l */
export function parseSalinity(text: string): number {
  return lrint(10 * strtod(text));
}

/** get_fraction(): "32.0%" → 320 permille */
export function parseFraction(text: string): number {
  return lrint(10 * strtod(text));
}

/** `%u.%u%%` of a permille value */
export function formatFraction(permille: number): string {
  return `${Math.floor(permille / 10)}.${permille % 10}%`;
}

/** get_duration(): sscanf "%d:%d" */
export function parseDuration(text: string): number {
  const m = /^\s*([+-]?\d+)(?::([+-]?\d+))?/.exec(text);
  if (!m) return 0;
  return Number.parseInt(m[1]!, 10) * 60 + (m[2] ? Number.parseInt(m[2], 10) : 0);
}

/** `%u:%02u` of seconds */
export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Micro-degrees from a decimal degree string such as "47.906674" or "-13.567017". */
export function parseDegrees(text: string): number {
  const value = strtod(text);
  return value < 0 ? -lrint(-value * 1e6) : lrint(value * 1e6);
}

/** put_degrees(): `%s%u.%06u` */
export function formatDegrees(udeg: number): string {
  const sign = udeg < 0 ? '-' : '';
  const v = Math.abs(udeg);
  return `${sign}${Math.floor(v / 1e6)}.${String(v % 1e6).padStart(6, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Broken-down time of a Subsurface timestamp (local wall-clock time stored as if it were UTC). */
export interface Tm {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: (typeof WEEKDAYS)[number];
}

export function toTm(when: number): Tm {
  const d = new Date(when * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: WEEKDAYS[d.getUTCDay()]!,
  };
}

export function fromParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const pad3 = (n: number): string => String(n).padStart(3, '0');
export const pad4 = (n: number): string => String(n).padStart(4, '0');
