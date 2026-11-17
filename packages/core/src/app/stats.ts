/**
 * Logbook statistics: totals, records, per year and per trip; and a text search over dives.
 */
import { sacRate } from '../subsurface/gas.ts';
import type { Dive, Logbook, Trip } from '../subsurface/model.ts';
import { toTm } from '../subsurface/units.ts';

export interface DiveRecord<T> {
  value: T;
  dive: Dive;
}

export interface Totals {
  dives: number;
  /** s */
  seconds: number;
  /** mm, of the deepest dive */
  maxDepth: number;
}

export interface LogStats extends Totals {
  deepest: DiveRecord<number> | null;
  longest: DiveRecord<number> | null;
  /** mm, mean depth weighted by dive time */
  meanDepth: number | null;
  /** ml/min, average over dives where it is known */
  sac: number | null;
  /** mK, of the water */
  coldest: DiveRecord<number> | null;
  warmest: DiveRecord<number> | null;
  sites: number;
  years: (Totals & { year: number })[];
  trips: (Totals & { trip: Trip; first: number; last: number })[];
}

const duration = (d: Dive) => d.computers[0]?.duration ?? 0;
const depth = (d: Dive) => d.computers[0]?.maxDepth ?? 0;
const water = (d: Dive) => d.waterTemp || d.computers[0]?.waterTemp || 0;

function add(t: Totals, d: Dive): void {
  t.dives++;
  t.seconds += duration(d);
  t.maxDepth = Math.max(t.maxDepth, depth(d));
}

/** Statistics over `dives` (by default all dives of the logbook); invalid dives are left out. */
export function logStats(logbook: Logbook, dives: readonly Dive[] = logbook.dives): LogStats {
  const valid = dives.filter((d) => !d.invalid);
  const stats: LogStats = {
    dives: 0,
    seconds: 0,
    maxDepth: 0,
    deepest: null,
    longest: null,
    meanDepth: null,
    sac: null,
    coldest: null,
    warmest: null,
    sites: new Set(valid.map((d) => d.siteUuid).filter((u) => u !== null)).size,
    years: [],
    trips: [],
  };
  let depthTime = 0;
  let timeWithDepth = 0;
  const sacs: number[] = [];
  const years = new Map<number, LogStats['years'][number]>();
  const trips = new Map<Trip, LogStats['trips'][number]>();
  for (const d of valid) {
    add(stats, d);
    if (!stats.deepest || depth(d) > stats.deepest.value) stats.deepest = { value: depth(d), dive: d };
    if (!stats.longest || duration(d) > stats.longest.value) stats.longest = { value: duration(d), dive: d };
    const mean = d.computers[0]?.meanDepth ?? 0;
    if (mean && duration(d)) {
      depthTime += mean * duration(d);
      timeWithDepth += duration(d);
    }
    const sac = sacRate(d);
    if (sac) sacs.push(sac);
    const w = water(d);
    if (w) {
      if (!stats.coldest || w < stats.coldest.value) stats.coldest = { value: w, dive: d };
      if (!stats.warmest || w > stats.warmest.value) stats.warmest = { value: w, dive: d };
    }
    const year = toTm(d.when).year;
    if (!years.has(year)) years.set(year, { year, dives: 0, seconds: 0, maxDepth: 0 });
    add(years.get(year)!, d);
    if (d.trip) {
      if (!trips.has(d.trip)) trips.set(d.trip, { trip: d.trip, first: d.when, last: d.when, dives: 0, seconds: 0, maxDepth: 0 });
      const t = trips.get(d.trip)!;
      add(t, d);
      t.first = Math.min(t.first, d.when);
      t.last = Math.max(t.last, d.when);
    }
  }
  if (timeWithDepth) stats.meanDepth = Math.round(depthTime / timeWithDepth);
  if (sacs.length) stats.sac = Math.round(sacs.reduce((a, b) => a + b, 0) / sacs.length);
  stats.years = [...years.values()].sort((a, b) => b.year - a.year);
  stats.trips = [...trips.values()].sort((a, b) => b.first - a.first);
  return stats;
}

/**
 * Dives matching a search: every word must appear in the site, trip, buddy, guide, suit, tags or
 * notes (any case), or be the dive's number ("12" or "#12"). An empty search matches every dive.
 */
export function searchDives(logbook: Logbook, query: string): Dive[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...logbook.dives];
  const sites = new Map(logbook.sites.map((s) => [s.uuid, s.name]));
  return logbook.dives.filter((d) => {
    const text = [sites.get(d.siteUuid ?? -1) ?? '', d.trip?.location ?? '', d.buddy, d.diveGuide, d.suit, d.tags.join(' '), d.notes]
      .join('\n')
      .toLowerCase();
    return words.every((w) => text.includes(w) || (/^#?\d+$/.test(w) && d.number === Number(w.replace('#', ''))));
  });
}
