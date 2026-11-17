/**
 * Dive times are "local time as if it were UTC", in seconds (Dive.when). These helpers convert
 * between that and the value of an <input type="datetime-local">.
 */

/** Now, on this device's clock, cut to the minute. */
export function nowWhen(): number {
  const now = new Date();
  return Math.floor((now.getTime() / 1000 - now.getTimezoneOffset() * 60) / 60) * 60;
}

export const whenToInput = (when: number): string => new Date(when * 1000).toISOString().slice(0, 16);

/** null if the field is empty or not a date. */
export function inputToWhen(value: string): number | null {
  const ms = Date.parse(`${value.slice(0, 16)}:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}
