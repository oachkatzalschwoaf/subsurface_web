/**
 * What the user enters for an upload, kept apart from the logbook.
 *
 * The logbook is fetched fresh right before every upload, so the user's input cannot hold
 * references into an older copy. Drafts describe the intent ("this dive, at that site, in that
 * trip") and applyDrafts() turns them into changes on whatever the logbook looks like then.
 */
import { findSameDive, type FitImport } from '../garmin/fit-import.ts';
import { appendDives, createSite, createTrip, listTrips } from '../subsurface/edit.ts';
import { newCylinder, type Dive, type Location, type Logbook, type Trip } from '../subsurface/model.ts';

export type SiteChoice =
  | { kind: 'none' }
  /**
   * `name` is the site's name when it was chosen; if the site is gone by the time of the upload
   * (merged or removed elsewhere), a site of that name takes its place.
   */
  | { kind: 'existing'; uuid: number; name?: string }
  /**
   * `location` is the position of a new site; when it is missing (drafts stored by older versions)
   * the dive computer's entry point is used.
   */
  | { kind: 'new'; name: string; location?: Location | null };

export type TripChoice =
  | { kind: 'none' }
  /** An existing trip, identified by its location and the time of its first dive. */
  | { kind: 'existing'; location: string; first: number }
  | { kind: 'new'; location: string; notes: string };

/** What the user can enter about a dive; the same fields for new dives, notes and later edits. */
export interface DiveDetails {
  buddy: string;
  diveGuide: string;
  suit: string;
  notes: string;
  /** Comma-separated */
  tags: string;
  /** 0–5, 0 = not set */
  rating: number;
  /** 0–5, 0 = not set */
  visibility: number;
  /** Litres; null = not set */
  cylinderVolume: number | null;
  cylinderDescription: string;
  /**
   * Oxygen in percent. null = keep what the dive computer recorded (air if it recorded nothing).
   * Drafts stored by older versions do not have this field.
   */
  cylinderO2: number | null;
  /** bar; null = not set */
  startPressure: number | null;
  endPressure: number | null;
  /** kg; null = no weight entry */
  weight: number | null;
  weightDescription: string;
}

export interface DiveDraft extends DiveDetails {
  fit: FitImport;
  site: SiteChoice;
}

export function emptyDetails(): DiveDetails {
  return {
    buddy: '',
    diveGuide: '',
    suit: '',
    notes: '',
    tags: '',
    rating: 0,
    visibility: 0,
    cylinderVolume: null,
    cylinderDescription: '',
    cylinderO2: null,
    startPressure: null,
    endPressure: null,
    weight: null,
    weightDescription: '',
  };
}

/** Comma-separated tags as a list without blanks and repeats. */
export const splitTags = (tags: string): string[] => [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))];

/** Oxygen percentage as Subsurface stores it (permille, air = 0); null if the value is unusable. */
export function o2Permille(percent: number | null | undefined, helium = 0): number | null {
  if (percent === null || percent === undefined || !Number.isFinite(percent) || percent < 1 || percent > 100) return null;
  const permille = Math.round(percent * 10);
  return permille === 210 && helium === 0 ? 0 : permille;
}

export function newDraft(fit: FitImport): DiveDraft {
  const recordedO2 = fit.dive.cylinders[0]?.o2 ?? 0;
  return {
    fit,
    site: { kind: 'none' },
    buddy: '',
    diveGuide: '',
    suit: '',
    notes: '',
    tags: '',
    rating: 0,
    visibility: 0,
    cylinderVolume: null,
    cylinderDescription: '',
    cylinderO2: recordedO2 > 0 ? recordedO2 / 10 : null,
    startPressure: null,
    endPressure: null,
    weight: null,
    weightDescription: '',
  };
}

export const milli = (value: number | null): number => (value === null || !Number.isFinite(value) ? 0 : Math.round(value * 1000));

const TWO_DAYS = 2 * 24 * 3600;

export interface ApplyResult {
  added: Dive[];
  /** Drafts whose dive is already in the logbook. */
  duplicates: DiveDraft[];
}

export function applyDrafts(logbook: Logbook, drafts: readonly DiveDraft[], tripChoice: TripChoice): ApplyResult {
  const added: Dive[] = [];
  const duplicates: DiveDraft[] = [];
  const fresh = drafts.filter((draft) => {
    const duplicate = findSameDive(logbook.dives, draft.fit.dive) !== null;
    if (duplicate) duplicates.push(draft);
    return !duplicate;
  });
  if (fresh.length === 0) return { added, duplicates };

  // Drafts wait for the next sync, and the logbook may have changed elsewhere meanwhile. A choice
  // that no longer fits is replaced by the closest match instead of blocking every later upload.
  let trip: Trip | null = null;
  if (tripChoice.kind === 'existing') {
    const trips = listTrips(logbook);
    const near = (t: (typeof trips)[number]) => fresh.some((d) => d.fit.dive.when >= t.first - TWO_DAYS && d.fit.dive.when <= t.last + TWO_DAYS);
    const match =
      trips.find((t) => t.trip.location === tripChoice.location && t.first === tripChoice.first) ??
      // another dive became the trip's first one
      trips.find((t) => t.trip.location === tripChoice.location && near(t));
    trip = match?.trip ?? createTrip(logbook, tripChoice.location.trim(), '');
  } else if (tripChoice.kind === 'new') {
    trip = createTrip(logbook, tripChoice.location.trim(), tripChoice.notes);
  }

  for (const draft of fresh) {
    const dive = structuredClone(draft.fit.dive);
    dive.trip = trip;
    dive.buddy = draft.buddy.trim();
    dive.diveGuide = draft.diveGuide.trim();
    dive.suit = draft.suit.trim();
    dive.notes = draft.notes.trim();
    dive.tags = splitTags(draft.tags);
    dive.rating = draft.rating;
    dive.visibility = draft.visibility;

    if (draft.site.kind === 'existing') {
      const { uuid, name } = draft.site;
      const named = name?.trim();
      const site =
        logbook.sites.find((s) => s.uuid === uuid) ??
        (named ? (logbook.sites.find((s) => s.name === named) ?? createSite(logbook, named, draft.fit.entry)) : null);
      dive.siteUuid = site?.uuid ?? null;
    } else if (draft.site.kind === 'new' && draft.site.name.trim()) {
      const name = draft.site.name.trim();
      const location = draft.site.location !== undefined ? draft.site.location : draft.fit.entry;
      const site = logbook.sites.find((s) => s.name === name) ?? createSite(logbook, name, location);
      dive.siteUuid = site.uuid;
    }

    const o2 = (draft.cylinderO2 as number | null | undefined) ?? null;
    const hasCylinderInput =
      draft.cylinderVolume !== null ||
      draft.cylinderDescription.trim() !== '' ||
      draft.startPressure !== null ||
      draft.endPressure !== null ||
      o2 !== null;
    if (hasCylinderInput) {
      const cylinder = dive.cylinders[0] ?? newCylinder();
      if (dive.cylinders.length === 0) dive.cylinders.push(cylinder);
      cylinder.volume = milli(draft.cylinderVolume);
      cylinder.description = draft.cylinderDescription.trim();
      cylinder.start = milli(draft.startPressure);
      cylinder.end = milli(draft.endPressure);
      // air is stored as "no mix", as Subsurface does
      const permille = o2Permille(o2, cylinder.he);
      if (permille !== null) cylinder.o2 = permille;
    }
    if (draft.weight !== null && Number.isFinite(draft.weight)) {
      dive.weightsystems.push({ weight: milli(draft.weight), description: draft.weightDescription.trim() });
    }
    added.push(dive);
  }
  appendDives(logbook, added);
  return { added, duplicates };
}
