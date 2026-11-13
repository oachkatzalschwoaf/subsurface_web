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
