/**
 * Copy dives from one logbook into another, for example from a trip logbook kept in an own git
 * repository (or an .ssrf file) into the Subsurface cloud after the trip.
 *
 * Only dives the target does not have yet are copied (same dive ID or start within a minute).
 * Their dive sites and trips come along: a site is reused when the target has one with the same
 * ID, or the same name and position; a trip is reused when the target has one with the same
 * location that already holds a dive within two days, or that holds another dive of the same
 * source trip.
 */
import { findSameDive } from '../garmin/fit-import.ts';
import { appendDives, createSite } from './edit.ts';
import type { Dive, DiveSite, Logbook, Trip } from './model.ts';

export interface MergeResult {
  added: Dive[];
  /** Dives of the source that the target already had. */
  skipped: Dive[];
}

const TWO_DAYS = 2 * 24 * 3600;

function sameSite(a: DiveSite, b: DiveSite): boolean {
  if (a.name !== b.name) return false;
  if (!a.location || !b.location) return !a.location && !b.location;
  return Math.abs(a.location.lat - b.location.lat) < 100 && Math.abs(a.location.lon - b.location.lon) < 100;
}

export function mergeDives(target: Logbook, source: Logbook, dives: readonly Dive[] = source.dives): MergeResult {
  const added: Dive[] = [];
  const skipped: Dive[] = [];
  const siteMap = new Map<number, number>();
  const tripMap = new Map<Trip, Trip>();

  for (const original of [...dives].sort((a, b) => a.when - b.when)) {
    if (findSameDive([...target.dives, ...added], original)) {
      skipped.push(original);
      continue;
    }
    const dive: Dive = structuredClone({ ...original, trip: null });
    dive.number = 0;

    if (original.siteUuid !== null) {
      let uuid = siteMap.get(original.siteUuid);
      if (uuid === undefined) {
        const site = source.sites.find((s) => s.uuid === original.siteUuid);
        if (site) {
          const existing =
            target.sites.find((s) => s.uuid === site.uuid && sameSite(s, site)) ?? target.sites.find((s) => sameSite(s, site));
          if (existing) uuid = existing.uuid;
          else if (!target.sites.some((s) => s.uuid === site.uuid)) {
            target.sites.push(structuredClone(site));
            uuid = site.uuid;
          } else {
            const copy = createSite(target, site.name, site.location ? { ...site.location } : null);
            copy.description = site.description;
            copy.notes = site.notes;
            copy.taxonomy = structuredClone(site.taxonomy);
            uuid = copy.uuid;
          }
          siteMap.set(original.siteUuid, uuid);
        }
      }
      dive.siteUuid = uuid ?? null;
    }

    if (original.trip) {
      let trip = tripMap.get(original.trip);
      if (!trip) {
        // A target trip that already holds one of this trip's dives is the same trip
        for (const sibling of source.dives) {
          if (sibling.trip !== original.trip) continue;
          trip = findSameDive(target.dives, sibling)?.trip ?? undefined;
          if (trip) break;
        }
      }
      if (!trip) {
        trip =
          target.dives.find(
            (d) => d.trip && d.trip.location === original.trip!.location && Math.abs(d.when - original.when) <= TWO_DAYS,
          )?.trip ?? undefined;
        if (!trip) {
          trip = { location: original.trip.location, notes: original.trip.notes };
          target.trips.push(trip);
        }
        tripMap.set(original.trip, trip);
      }
      dive.trip = trip;
    }
    added.push(dive);
  }
  appendDives(target, added);
  return { added, skipped };
}
