import { toTm, type Dive } from '@topside/core';
import { locale } from './i18n.ts';

const dateFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const depthFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Subsurface timestamps are local wall-clock time stored as UTC, so format them as UTC. */
export function formatDate(when: number): string {
  const tm = toTm(when);
  const time = `${String(tm.hour).padStart(2, '0')}:${String(tm.minute).padStart(2, '0')}`;
  return `${dateFormat.format(new Date(when * 1000))} ${time}`;
}

export const formatDepth = (mm: number): string => `${depthFormat.format(mm / 1000)} m`;
export const formatMinutes = (seconds: number): string => String(Math.round(seconds / 60));

/** SVG path of the depth profile inside a width × height box, depth growing downwards. */
export function profilePath(dive: Dive, width: number, height: number): string {
  const samples = dive.computers[0]?.samples ?? [];
  if (samples.length < 2) return '';
  const maxTime = samples[samples.length - 1]!.time || 1;
  const maxDepth = Math.max(...samples.map((s) => s.depth), 1);
  const step = Math.max(1, Math.floor(samples.length / 300));
  const points = samples
    .filter((_, i) => i % step === 0 || i === samples.length - 1)
    .map((s) => `${((s.time / maxTime) * width).toFixed(1)},${((s.depth / maxDepth) * height).toFixed(1)}`);
  return `M0,0 L${points.join(' L')} L${width},0 Z`;
}

const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
const monthYearFormat = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Date range of a group of dives: one day → "Sa 26.09.2026", one month → "Okt. 2026",
 * several months → "Apr.–Mai 2026" or "Dez. 2025 – Jan. 2026".
 */
export function formatDateRange(first: number, last: number): string {
  const a = toTm(first);
  const b = toTm(last);
  const da = new Date(first * 1000);
  const db = new Date(last * 1000);
  if (a.year === b.year && a.month === b.month && a.day === b.day) {
    return `${weekdayFormat.format(da).replace(/\.$/, '')} ${dayFormat.format(da)}`;
  }
  if (a.year === b.year && a.month === b.month) return monthYearFormat.format(da);
  if (a.year === b.year) return `${monthFormat.format(da)}–${monthYearFormat.format(db)}`;
  return `${monthYearFormat.format(da)} – ${monthYearFormat.format(db)}`;
}
