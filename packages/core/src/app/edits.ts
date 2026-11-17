/**
 * Changes to a dive that is already in the logbook.
 *
 * Like drafts, an edit does not point into a logbook copy: it names the dive by its start time and
 * lists only the fields the user changed. It can therefore be stored, and applied to a freshly
 * fetched logbook without undoing what somebody else changed in other fields meanwhile.
 */
import { createSite } from '../subsurface/edit.ts';
import { newCylinder, type Dive, type DiveSite, type Location, type Logbook } from '../subsurface/model.ts';
import { milli, o2Permille, splitTags, type DiveDetails, type SiteChoice } from './drafts.ts';

export interface DiveEdit {
  /** Start time of the dive, as in Dive.when */
  when: number;
  /** Only the fields to change */
  changes: Partial<DiveDetails>;
  /** Set to move the dive to another site (or to none) */
  site?: SiteChoice;
}

const amount = (value: number): number | null => (value > 0 ? value / 1000 : null);

/** The editable details of a dive. Cylinder and weight fields describe the first of each. */
export function detailsOf(dive: Dive): DiveDetails {
  const cylinder = dive.cylinders[0];
  const weight = dive.weightsystems[0];
  return {
    buddy: dive.buddy,
    diveGuide: dive.diveGuide,
    suit: dive.suit,
    notes: dive.notes,
    tags: dive.tags.join(', '),
    rating: dive.rating,
    visibility: dive.visibility,
    cylinderVolume: cylinder ? amount(cylinder.volume) : null,
    cylinderDescription: cylinder?.description ?? '',
    cylinderO2: cylinder && cylinder.o2 > 0 ? cylinder.o2 / 10 : null,
    startPressure: cylinder ? amount(cylinder.start) : null,
    endPressure: cylinder ? amount(cylinder.end) : null,
    weight: weight ? amount(weight.weight) : null,
    weightDescription: weight?.description ?? '',
  };
}

const TEXT = ['buddy', 'diveGuide', 'suit', 'notes', 'cylinderDescription', 'weightDescription'] as const;
const NUMBER = ['rating', 'visibility', 'cylinderVolume', 'cylinderO2', 'startPressure', 'endPressure', 'weight'] as const;
const number = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : value);

/** The fields of `after` that differ from `before`. */
export function changedDetails(before: DiveDetails, after: DiveDetails): Partial<DiveDetails> {
  const changes: Partial<DiveDetails> = {};
  for (const key of TEXT) if (before[key].trim() !== after[key].trim()) changes[key] = after[key].trim();
  for (const key of NUMBER) {
    const value = number(after[key]);
    if (number(before[key]) !== value) (changes as Record<string, number | null>)[key] = value;
  }
  if (splitTags(before.tags).join('\n') !== splitTags(after.tags).join('\n')) changes.tags = after.tags;
  return changes;
}

export const isEmptyEdit = (edit: DiveEdit): boolean => Object.keys(edit.changes).length === 0 && edit.site === undefined;

/** Apply an edit. Returns the changed dive, or null if the logbook no longer has that dive. */
export function applyEdit(logbook: Logbook, edit: DiveEdit): Dive | null {
  const dive = logbook.dives.find((d) => d.when === edit.when);
  if (!dive) return null;
  const c = edit.changes;

  if (c.buddy !== undefined) dive.buddy = c.buddy.trim();
  if (c.diveGuide !== undefined) dive.diveGuide = c.diveGuide.trim();
  if (c.suit !== undefined) dive.suit = c.suit.trim();
  if (c.notes !== undefined) dive.notes = c.notes.trim();
  if (c.tags !== undefined) dive.tags = splitTags(c.tags);
  if (c.rating !== undefined) dive.rating = c.rating;
  if (c.visibility !== undefined) dive.visibility = c.visibility;

  const touchesCylinder =
    c.cylinderVolume !== undefined ||
    c.cylinderDescription !== undefined ||
    c.cylinderO2 !== undefined ||
    c.startPressure !== undefined ||
    c.endPressure !== undefined;
  if (touchesCylinder) {
    const existing = dive.cylinders[0];
    const cylinder = existing ?? newCylinder();
    if (c.cylinderVolume !== undefined) cylinder.volume = milli(c.cylinderVolume);
    if (c.cylinderDescription !== undefined) cylinder.description = c.cylinderDescription.trim();
    if (c.startPressure !== undefined) cylinder.start = milli(c.startPressure);
    if (c.endPressure !== undefined) cylinder.end = milli(c.endPressure);
    if (c.cylinderO2 !== undefined) {
      // an emptied field means air; a mix with helium is left alone then
      if (c.cylinderO2 === null) cylinder.o2 = cylinder.he > 0 ? cylinder.o2 : 0;
      else cylinder.o2 = o2Permille(c.cylinderO2, cylinder.he) ?? cylinder.o2;
    }
    const empty = !cylinder.volume && !cylinder.description && !cylinder.start && !cylinder.end && !cylinder.o2 && !cylinder.he;
    if (!existing && !empty) dive.cylinders.push(cylinder);
  }

  if (c.weight !== undefined || c.weightDescription !== undefined) {
    const existing = dive.weightsystems[0];
    const weight = c.weight !== undefined ? milli(c.weight) : (existing?.weight ?? 0);
    const description = c.weightDescription !== undefined ? c.weightDescription.trim() : (existing?.description ?? '');
    if (weight === 0 && description === '') {
      if (existing) dive.weightsystems.shift();
    } else if (existing) {
      existing.weight = weight;
      existing.description = description;
    } else {
      dive.weightsystems.push({ weight, description });
    }
  }

  const site = edit.site;
  if (site?.kind === 'none') {
    dive.siteUuid = null;
  } else if (site?.kind === 'existing') {
    // a site that vanished meanwhile leaves the dive where it is
    if (logbook.sites.some((s) => s.uuid === site.uuid)) dive.siteUuid = site.uuid;
  } else if (site?.kind === 'new' && site.name.trim()) {
    const name = site.name.trim();
    // the dive stays where it was, so a new site inherits the position of the old one
    const position = logbook.sites.find((s) => s.uuid === dive.siteUuid)?.location ?? null;
    dive.siteUuid = (logbook.sites.find((s) => s.name === name) ?? createSite(logbook, name, position)).uuid;
  }
  return dive;
}

// ---- Dive sites -----------------------------------------------------------------------------

/** A change to a dive site, which affects every dive there. */
export interface SiteEdit {
  uuid: number;
  name?: string;
  /** null = no position */
  location?: Location | null;
}

/** Apply a site edit. Returns the changed site, or null if the logbook no longer has it. */
export function applySiteEdit(logbook: Logbook, edit: SiteEdit): DiveSite | null {
  const site = logbook.sites.find((s) => s.uuid === edit.uuid);
  if (!site) return null;
  if (edit.name !== undefined && edit.name.trim()) site.name = edit.name.trim();
  if (edit.location !== undefined) site.location = edit.location === null ? null : { ...edit.location };
  return site;
}

/** Decimal degrees with 6 places, as Subsurface writes them: "47.906674, -13.567017". */
export function formatCoordinates(location: Location): string {
  const degrees = (micro: number) => (micro / 1e6).toFixed(6);
  return `${degrees(location.lat)}, ${degrees(location.lon)}`;
}

/**
 * Coordinates typed in or pasted from a map: "47.906674, -13.567017", "47.906674 -13.567017",
 * "47,906674; -13,567017", "N 47.906674 W 13.567017" or "47.906674N 13.567017W".
 * Returns null for anything else.
 */
export function parseCoordinates(text: string): Location | null {
  const tokens = text.toUpperCase().match(/[NSEW]|[-+]?\d+(?:[.,]\d+)?/g) ?? [];
  const numbers = tokens.flatMap((t, at) => (/^[NSEW]$/.test(t) ? [] : [{ number: t, at }]));
  if (numbers.length !== 2) return null;
  // Letters either all come before their number ("N 47.9 W 13.5") or all after it ("47.9N 13.5W").
  const prefixed = /^[NSEW]$/.test(tokens[0] ?? '');
  const values = numbers.map(({ number, at }) => {
    const neighbour = tokens[prefixed ? at - 1 : at + 1] ?? '';
    const hemisphere = /^[NSEW]$/.test(neighbour) ? neighbour : '';
    const value = Number(number.replace(',', '.'));
    return { hemisphere, value: hemisphere === 'S' || hemisphere === 'W' ? -Math.abs(value) : value };
  });
  let [lat, lon] = values as [(typeof values)[0], (typeof values)[0]];
  // "E 13.5 N 47.9": latitude second
  if (lat.hemisphere === 'E' || lat.hemisphere === 'W' || lon.hemisphere === 'N' || lon.hemisphere === 'S') [lat, lon] = [lon, lat];
  if (!Number.isFinite(lat.value) || !Number.isFinite(lon.value) || Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) return null;
  if (lat.value === 0 && lon.value === 0) return null;
  return { lat: Math.round(lat.value * 1e6), lon: Math.round(lon.value * 1e6) };
}
