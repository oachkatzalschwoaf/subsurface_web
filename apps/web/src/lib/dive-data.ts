/**
 * Display data derived from a dive: profile points in display units and summary values.
 */
import { ZERO_C_IN_MKELVIN, type Dive, type Logbook } from '@topside/core';

export interface Point {
  /** seconds */
  t: number;
  /** metres */
  depth: number;
  /** °C, carried over from the last reading */
  temp: number | null;
  /** bpm */
  hr: number | null;
  /** seconds, null = not given */
  ndl: number | null;
}

export function profile(dive: Dive): Point[] {
  const samples = dive.computers[0]?.samples ?? [];
  let temp: number | null = null;
  return samples.map((s) => {
    if (s.temperature) temp = (s.temperature - ZERO_C_IN_MKELVIN) / 1000;
    return { t: s.time, depth: s.depth / 1000, temp, hr: s.heartbeat || null, ndl: s.ndl >= 0 ? s.ndl : null };
  });
}

/**
 * Reduce to about `max` points for drawing. Each bucket keeps its shallowest and deepest point,
 * so the deepest point of the dive is always drawn.
 */
export function downsample(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / (max / 2));
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += size) {
    const bucket = points.slice(i, i + size);
    let lo = bucket[0]!;
    let hi = bucket[0]!;
    for (const p of bucket) {
      if (p.depth < lo.depth) lo = p;
      if (p.depth > hi.depth) hi = p;
    }
    if (lo === hi) out.push(lo);
    else out.push(...(lo.t < hi.t ? [lo, hi] : [hi, lo]));
  }
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Index of the point nearest to time t (points sorted by t). */
export function nearest(points: Point[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo]!.t - t) <= Math.abs(points[hi]!.t - t) ? lo : hi;
}

export interface Summary {
  maxDepth: number;
  meanDepth: number | null;
  duration: number;
  waterTemp: number | null;
  airTemp: number | null;
  site: string;
  trip: string;
  model: string;
}

const celsius = (mk: number): number | null => (mk ? (mk - ZERO_C_IN_MKELVIN) / 1000 : null);

export function summary(logbook: Logbook, dive: Dive): Summary {
  const dc = dive.computers[0];
  return {
    maxDepth: (dc?.maxDepth ?? 0) / 1000,
    meanDepth: dc?.meanDepth ? dc.meanDepth / 1000 : null,
    duration: dc?.duration ?? 0,
    waterTemp: celsius(dive.waterTemp || dc?.waterTemp || 0),
    airTemp: celsius(dive.airTemp || dc?.airTemp || 0),
    site: logbook.sites.find((s) => s.uuid === dive.siteUuid)?.name ?? '',
    trip: dive.trip?.location ?? '',
    model: dc?.model ?? '',
  };
}

/** A tick step of 1, 2 or 5 × 10^n that gives about `target` ticks. */
export function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
