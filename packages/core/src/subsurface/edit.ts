/**
 * Changes to a logbook: adding dives, sites and trips.
 */
import type { Dive, DiveSite, Location, Logbook, Trip } from './model.ts';
import { toTm, pad2, pad4 } from './units.ts';

/** A new dive site with an unused ID. `random` is injectable for tests. */
export function createSite(
  logbook: Logbook,
  name: string,
  location: Location | null,
  random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]!,
): DiveSite {
  const used = new Set(logbook.sites.map((s) => s.uuid));
  let uuid = 0;
  while (uuid === 0 || used.has(uuid)) uuid = random() >>> 0;
  const site: DiveSite = { uuid, name, description: '', notes: '', location, taxonomy: [] };
  logbook.sites.push(site);
  return site;
}

export function createTrip(logbook: Logbook, location: string, notes = ''): Trip {
  const trip: Trip = { location, notes };
  logbook.trips.push(trip);
  return trip;
}

/** Trips with their first and last dive, newest first, for choosing where new dives belong. */
export function listTrips(logbook: Logbook): { trip: Trip; first: number; last: number; dives: number }[] {
  const out = new Map<Trip, { trip: Trip; first: number; last: number; dives: number }>();
  for (const dive of logbook.dives) {
    if (!dive.trip) continue;
    const entry = out.get(dive.trip) ?? { trip: dive.trip, first: dive.when, last: dive.when, dives: 0 };
    entry.first = Math.min(entry.first, dive.when);
    entry.last = Math.max(entry.last, dive.when);
    entry.dives++;
    out.set(dive.trip, entry);
  }
  return [...out.values()].sort((a, b) => b.first - a.first);
}

/**
 * Add dives to the logbook. Dives later than every existing dive continue the numbering, as
 * Subsurface does on download. Dives that fall between existing ones stay unnumbered, because
 * renumbering the rest of the logbook is the user's call (Subsurface offers it as a command).
 */
export function appendDives(logbook: Logbook, dives: readonly Dive[]): void {
  const sorted = [...dives].sort((a, b) => a.when - b.when);
  const latest = logbook.dives.reduce((max, d) => Math.max(max, d.when), Number.NEGATIVE_INFINITY);
  let number = logbook.dives.reduce((max, d) => Math.max(max, d.number), 0);
  for (const dive of sorted) {
    if (dive.number === 0 && dive.when > latest) dive.number = ++number;
    logbook.dives.push(dive);
  }
  logbook.dives.sort((a, b) => a.when - b.when);
}

const dateOf = (when: number): string => {
  const tm = toTm(when);
  return `${pad4(tm.year)}-${pad2(tm.month)}-${pad2(tm.day)}`;
};

/**
 * Commit message in the shape Subsurface uses ("Changes made:", a list, "Created by …"),
 * so the history reads the same whichever program wrote it.
 */
export function commitMessageForNewDives(logbook: Logbook, dives: readonly Dive[], userAgent: string): string {
  return commitMessageForChanges(logbook, dives, [], userAgent);
}

/** Like commitMessageForNewDives(), for a commit that adds dives and changes dives and sites. */
export function commitMessageForChanges(
  logbook: Logbook,
  added: readonly Dive[],
  edited: readonly Dive[],
  userAgent: string,
  sites: readonly DiveSite[] = [],
): string {
  const line = (verb: string) => (dive: Dive) => {
    const site = logbook.sites.find((s) => s.uuid === dive.siteUuid)?.name;
    const label = dive.number ? `#${dive.number}` : 'unnumbered';
    return `${verb} dive ${label} (${dateOf(dive.when)}${site ? `, ${site}` : ''})`;
  };
  const byTime = (dives: readonly Dive[]) => [...new Set(dives)].sort((a, b) => a.when - b.when);
  // a dive that was added and then edited in the same commit is just an added one
  const lines = [
    ...byTime(added).map(line('Add')),
    ...byTime(edited.filter((d) => !added.includes(d))).map(line('Edit')),
    ...[...new Set(sites)].map((site) => `Edit dive site "${site.name}"`),
  ];
  return `Changes made: \n\n${lines.join('\n')}\n\nCreated by ${userAgent}\n`;
}
