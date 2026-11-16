/**
 * Equipment presets: the parts of a dive's details that stay the same over a trip (suit,
 * cylinder, gas, weights, people), saved under a name and applied to new drafts. Start and end
 * pressure are deliberately not part of a preset; they differ on every dive.
 */
import type { Logbook } from '../subsurface/model.ts';
import type { DiveDraft } from './drafts.ts';

export interface GearPreset {
  name: string;
  suit: string;
  cylinderDescription: string;
  /** Litres; null = not set */
  cylinderVolume: number | null;
  /** Percent; null = not set */
  cylinderO2: number | null;
  /** kg; null = not set */
  weight: number | null;
  weightDescription: string;
  buddy: string;
  diveGuide: string;
  /** Comma-separated */
  tags: string;
}

export function presetFromDraft(name: string, draft: DiveDraft): GearPreset {
  return {
    name: name.trim(),
    suit: draft.suit.trim(),
    cylinderDescription: draft.cylinderDescription.trim(),
    cylinderVolume: draft.cylinderVolume,
    cylinderO2: draft.cylinderO2 ?? null,
    weight: draft.weight,
    weightDescription: draft.weightDescription.trim(),
    buddy: draft.buddy.trim(),
    diveGuide: draft.diveGuide.trim(),
    tags: draft.tags.trim(),
  };
}

/** True when the dive computer recorded a gas mix other than air for this dive. */
export function hasRecordedMix(draft: DiveDraft): boolean {
  const cylinder = draft.fit.dive.cylinders[0];
  return cylinder !== undefined && (cylinder.o2 > 0 || cylinder.he > 0);
}

/**
 * Fill a draft from a preset. Only values the preset has are taken over, so an empty preset field
 * never erases input. A gas mix recorded by the dive computer wins over the preset's.
 */
export function applyPreset(draft: DiveDraft, preset: GearPreset): void {
  if (preset.suit) draft.suit = preset.suit;
  if (preset.cylinderDescription) draft.cylinderDescription = preset.cylinderDescription;
  if (preset.cylinderVolume !== null) draft.cylinderVolume = preset.cylinderVolume;
  if (preset.cylinderO2 !== null && !hasRecordedMix(draft)) draft.cylinderO2 = preset.cylinderO2;
  if (preset.weight !== null) draft.weight = preset.weight;
  if (preset.weightDescription) draft.weightDescription = preset.weightDescription;
  if (preset.buddy) draft.buddy = preset.buddy;
  if (preset.diveGuide) draft.diveGuide = preset.diveGuide;
  if (preset.tags) draft.tags = preset.tags;
}

/** Reads presets from stored JSON, dropping anything that does not look like one. */
export function parsePresets(json: string | null): GearPreset[] {
  let data: unknown;
  try {
    data = JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return data
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && typeof (p as { name?: unknown }).name === 'string')
    .map((p) => ({
      name: text(p.name),
      suit: text(p.suit),
      cylinderDescription: text(p.cylinderDescription),
      cylinderVolume: amount(p.cylinderVolume),
      cylinderO2: amount(p.cylinderO2),
      weight: amount(p.weight),
      weightDescription: text(p.weightDescription),
      buddy: text(p.buddy),
      diveGuide: text(p.diveGuide),
      tags: text(p.tags),
    }))
    .filter((p) => p.name !== '');
}

export interface CylinderType {
  description: string;
  /** Litres; null = the logbook has no size for it */
  volume: number | null;
}

/**
 * Cylinder types to choose from: those already used in the logbook, most recently used first,
 * followed by the given common ones that are not among them.
 */
export function cylinderTypes(logbook: Logbook, common: readonly CylinderType[] = []): CylinderType[] {
  const types = new Map<string, CylinderType>();
  for (let i = logbook.dives.length - 1; i >= 0; i--) {
    for (const cylinder of logbook.dives[i]!.cylinders) {
      const description = cylinder.description.trim();
      if (!description) continue;
      const known = types.get(description);
      const volume = cylinder.volume > 0 ? cylinder.volume / 1000 : null;
      if (!known) types.set(description, { description, volume });
      else if (known.volume === null) known.volume = volume;
    }
  }
  for (const type of common) {
    if (!types.has(type.description)) types.set(type.description, { ...type });
  }
  return [...types.values()];
}

/** Distinct non-empty values of a text field over all dives, most recently used first. */
export function usedValues(logbook: Logbook, pick: (dive: Logbook['dives'][number]) => string | readonly string[]): string[] {
  const values = new Set<string>();
  for (let i = logbook.dives.length - 1; i >= 0; i--) {
    const picked = pick(logbook.dives[i]!);
    for (const value of typeof picked === 'string' ? [picked] : picked) {
      if (value.trim()) values.add(value.trim());
    }
  }
  return [...values];
}
