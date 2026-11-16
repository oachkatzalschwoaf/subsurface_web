/**
 * Equipment presets and the equipment of the last added dive, kept in this browser only.
 * They can hold names (buddy, guide), so signing out deletes them.
 */
import { parsePresets, type GearPreset } from '@topside/core';

const PRESETS_KEY = 'topside.gearPresets';
const LAST_KEY = 'topside.lastGear';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered
  }
}

export const loadPresets = (): GearPreset[] => parsePresets(read(PRESETS_KEY));
export const savePresets = (presets: GearPreset[]): void => write(PRESETS_KEY, JSON.stringify(presets));

export const loadLastGear = (): GearPreset | null => parsePresets(`[${read(LAST_KEY) ?? ''}]`)[0] ?? null;
export const saveLastGear = (gear: GearPreset): void => write(LAST_KEY, JSON.stringify(gear));

export function clearGear(): void {
  try {
    localStorage.removeItem(PRESETS_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    // nothing stored
  }
}
