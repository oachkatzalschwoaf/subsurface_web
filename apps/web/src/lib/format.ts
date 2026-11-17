import { toTm, type Dive } from '@topside/core';
import { locale } from './i18n.ts';

/** A formatter for the current locale, rebuilt when the language changes. */
function perLocale<F>(make: (locale: string) => F): () => F {
  let made: { locale: string; format: F } | null = null;
  return () => {
    if (made?.locale !== locale) made = { locale, format: make(locale) };
    return made.format;
  };
}

const dateFormat = perLocale((l) => new Intl.DateTimeFormat(l, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }));
const depthFormat = perLocale((l) => new Intl.NumberFormat(l, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Subsurface timestamps are local wall-clock time stored as UTC, so format them as UTC. */
export function formatDate(when: number): string {
  const tm = toTm(when);
  const time = `${String(tm.hour).padStart(2, '0')}:${String(tm.minute).padStart(2, '0')}`;
  return `${dateFormat().format(new Date(when * 1000))} ${time}`;
}

export const formatDepth = (mm: number): string => `${depthFormat().format(mm / 1000)} m`;
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

const weekdayFormat = perLocale((l) => new Intl.DateTimeFormat(l, { weekday: 'short', timeZone: 'UTC' }));
const dayFormat = perLocale((l) => new Intl.DateTimeFormat(l, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }));
const monthFormat = perLocale((l) => new Intl.DateTimeFormat(l, { month: 'short', timeZone: 'UTC' }));
const monthYearFormat = perLocale((l) => new Intl.DateTimeFormat(l, { month: 'short', year: 'numeric', timeZone: 'UTC' }));

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
    return `${weekdayFormat().format(da).replace(/\.$/, '')} ${dayFormat().format(da)}`;
  }
  if (a.year === b.year && a.month === b.month) return monthYearFormat().format(da);
  if (a.year === b.year) return `${monthFormat().format(da)}–${monthYearFormat().format(db)}`;
  return `${monthYearFormat().format(da)} – ${monthYearFormat().format(db)}`;
}
