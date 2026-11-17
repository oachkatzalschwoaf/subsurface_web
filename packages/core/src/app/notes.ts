/**
 * Notes taken right after a dive, before its FIT file exists (no network on a boat, the watch has
 * not synced yet): pressures, buddy, weights and so on, which are easily forgotten later. When
 * the FIT file arrives the note is matched to it by time and fills in the form. A note can also
 * become a dive without a profile if no file ever comes.
 */
import type { FitImport } from '../garmin/fit-import.ts';
import { newDive, newDiveComputer, type Location } from '../subsurface/model.ts';
import { emptyDetails, newDraft, type DiveDetails, type DiveDraft } from './drafts.ts';

export interface DiveNote extends DiveDetails {
  id: string;
  /** Roughly when the dive was, in the same local-time seconds as Dive.when */
  when: number;
  siteName: string;
  /** Where the note was taken, if the phone knew; used for a new site when the FIT file has none */
  location: Location | null;
  /** Metres; only needed to save the note as a dive without a profile */
  maxDepth: number | null;
  /** Minutes; as above */
  duration: number | null;
}

/** The model name Subsurface gives dives entered by hand; it draws a stand-in profile for them. */
export const MANUAL_DIVE_MODEL = 'manually added dive';

export function newNote(id: string, when: number): DiveNote {
  return { ...emptyDetails(), id, when, siteName: '', location: null, maxDepth: null, duration: null };
}

const BEFORE = 45 * 60;
const AFTER = 4 * 3600;

/**
 * How badly a note's time fits a dive, in seconds; Infinity = not at all. A note is usually
 * written after surfacing, so a time before the dive counts three times as far away as one after
 * it: between two dives the note then goes to the earlier one unless the later is about to start.
 */
function distance(noteWhen: number, dive: { when: number; duration: number }): number {
  const end = dive.when + dive.duration;
  if (noteWhen < dive.when - BEFORE || noteWhen > end + AFTER) return Infinity;
  if (noteWhen < dive.when) return (dive.when - noteWhen) * 3;
  return noteWhen > end ? noteWhen - end : 0;
}

/** Which note belongs to which dive: dive index → note. Every note and dive is used once at most. */
export function matchNotes(notes: readonly DiveNote[], dives: readonly { when: number; duration: number }[]): Map<number, DiveNote> {
  const pairs: { note: DiveNote; dive: number; distance: number }[] = [];
  for (const note of notes) {
    dives.forEach((dive, index) => {
      const d = distance(note.when, dive);
      if (d !== Infinity) pairs.push({ note, dive: index, distance: d });
    });
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const matched = new Map<number, DiveNote>();
  const used = new Set<DiveNote>();
  for (const pair of pairs) {
    if (matched.has(pair.dive) || used.has(pair.note)) continue;
    matched.set(pair.dive, pair.note);
    used.add(pair.note);
  }
  return matched;
}

/**
 * Fill a draft from a note. Only what the note has is taken over. With `keepGas` the gas mix is
 * left alone (the dive computer recorded one).
 */
export function applyNote(draft: DiveDraft, note: DiveNote, keepGas = false): void {
  for (const key of ['buddy', 'diveGuide', 'suit', 'notes', 'tags', 'cylinderDescription', 'weightDescription'] as const) {
    if (note[key].trim()) draft[key] = note[key];
  }
  for (const key of ['rating', 'visibility'] as const) if (note[key]) draft[key] = note[key];
  for (const key of ['cylinderVolume', 'startPressure', 'endPressure', 'weight'] as const) {
    if (note[key] !== null) draft[key] = note[key];
  }
  if (note.cylinderO2 !== null && !keepGas) draft.cylinderO2 = note.cylinderO2;
  if (note.siteName.trim() && draft.site.kind === 'none') {
    // the watch's GPS fix at the dive is better than where the phone was when the note was taken
    const location = draft.fit.entry ?? draft.fit.exit ?? note.location ?? null;
    draft.site = { kind: 'new', name: note.siteName.trim(), location };
  }
}

/** True when the note has what a dive without a profile needs. */
export const canBecomeDive = (note: DiveNote): boolean => (note.maxDepth ?? 0) > 0 && (note.duration ?? 0) > 0;

/** A draft for a dive without a profile, made from a note alone. */
export function draftFromNote(note: DiveNote): DiveDraft {
  if (!canBecomeDive(note)) throw new Error('A dive without a profile needs depth and duration');
  const dive = newDive(note.when);
  const computer = newDiveComputer(note.when, Math.round(note.duration! * 60));
  computer.model = MANUAL_DIVE_MODEL;
  computer.maxDepth = Math.round(note.maxDepth! * 1000);
  dive.computers.push(computer);
  const location = note.location ?? null;
  const fit: FitImport = { dive, entry: location, exit: null, activityId: null, manualEntry: true, utcOffset: null, fileName: `note-${note.id}` };
  const draft = newDraft(fit);
  applyNote(draft, note);
  return draft;
}
