/**
 * Turn a Garmin FIT dive activity into a Subsurface dive.
 *
 * Field numbers, event names and severities follow libdivecomputer's Garmin parser
 * (src/garmin_parser.c), which Subsurface itself uses, so that an upload from Topside looks like
 * Subsurface's own import of the same file.
 */
import { unzipSync } from 'fflate';
import { newCylinder, newDive, newDiveComputer, newEvent, nextSample, type Dive, type DiveEvent, type Location } from '../subsurface/model.ts';
import { lrint, ZERO_C_IN_MKELVIN } from '../subsurface/units.ts';
import { garminDiveId } from './dive-id.ts';
import { decodeFit, FIT_EPOCH_OFFSET, FIT_TIMESTAMP_FIELD, isFit, type FitMessage } from './fit-decode.ts';

/** Global FIT message numbers */
const MSG = { fileId: 0, session: 18, record: 20, event: 21, deviceInfo: 23, activity: 34, diveSettings: 258, diveGas: 259, diveSummary: 268 } as const;

/** libdivecomputer SAMPLE_EVENT_STRING */
const EVENT_TYPE_STRING = 26;
/** FIT event number of a dive alert */
const FIT_EVENT_DIVE_ALERT = 56;
/** file_id.product of entries typed into Garmin Connect by hand */
const PRODUCT_CONNECT = 65534;

/** Dive alerts: [severity, name], indexed by the FIT dive_alert value (libdc garmin_event()). */
const DIVE_ALERTS: Record<number, [number, string]> = {
  0: [2, 'Deco required'], 1: [2, 'Gas Switch prompted'], 2: [1, 'Surface'], 3: [2, 'Approaching NDL'],
  4: [3, 'ppO2 warning'], 5: [4, 'ppO2 critical high'], 6: [4, 'ppO2 critical low'], 7: [2, 'Time alert'],
  8: [2, 'Depth alert'], 9: [3, 'Deco ceiling broken'], 10: [1, 'Deco completed'],
  11: [3, 'Safety stop ceiling broken'], 12: [1, 'Safety stop completed'], 13: [3, 'CNS warning'],
  14: [4, 'CNS critical'], 15: [3, 'OTU warning'], 16: [4, 'OTU critical'], 17: [3, 'Ascent speed critical'],
  18: [1, 'Alert dismissed'], 19: [1, 'Alert timed out'], 20: [3, 'Battry Low'], 21: [3, 'Battry Critical'],
  22: [1, 'Safety stop begin'], 23: [1, 'Approaching deco stop'], 24: [1, 'Automatic switch to low setpoint'],
  25: [1, 'Automatic switch to high setpoint'], 26: [2, 'Manual switch to low setpoint'],
  27: [2, 'Manual switch to high setpoint'], 32: [1, 'Tank battery low'],
};

/** Garmin product IDs of dive-capable watches. Unknown IDs are shown as "Garmin (id)". */
const MODELS: Record<number, string> = {
  2859: 'Descent Mk1', 2991: 'Descent Mk1', 3258: 'Descent Mk2', 3702: 'Descent Mk2', 3542: 'Descent Mk2 S',
  3930: 'Descent Mk2 S', 4005: 'Descent G1', 4222: 'Descent Mk3 43mm', 4223: 'Descent Mk3 51mm',
  4518: 'Descent X50i', 4588: 'Descent G2', 4533: 'Fenix 8 Solar Large', 4534: 'Fenix 8 43mm',
  4536: 'Fenix 8', 4775: 'Fenix 8', 4631: 'Fenix 8 Pro',
};

export const MANUAL_ENTRY_MODEL = 'Garmin Connect (manual entry)';

export interface FitImport {
  dive: Dive;
  /** Where the dive started and ended, if the watch had a GPS fix. */
  entry: Location | null;
  exit: Location | null;
  /** Garmin Connect activity ID, taken from the file name. */
  activityId: string | null;
  /** Typed into Garmin Connect by hand: no profile. */
  manualEntry: boolean;
  /** Seconds the dive's local time is ahead of UTC; null if the file does not say. */
  utcOffset: number | null;
  fileName: string;
}

export class NotADiveError extends Error {}

const num = (m: FitMessage | undefined, field: number): number | null => {
  const v = m?.fields.get(field);
  return typeof v === 'number' ? v : null;
};

/** Semicircles to micro-degrees; 0 and the invalid marker mean "no fix". */
function position(lat: number | null, lon: number | null): Location | null {
  if (lat === null || lon === null || lat === 0 || lon === 0) return null;
  const scale = (180 / 2 ** 31) * 1e6;
  return { lat: lrint(lat * scale), lon: lrint(lon * scale) };
}

/** Garmin Connect exports are named `<activity id>_ACTIVITY.fit`, inside `<activity id>.zip`. */
export function activityIdFromName(...names: (string | undefined)[]): string | null {
  for (const name of names) {
    const base = name?.split(/[\\/]/).pop() ?? '';
    const m = /(\d{7,})(?=_ACTIVITY\.fit$|\.fit$|\.zip$)/i.exec(base) ?? /(\d{7,})/.exec(base);
    if (m) return m[1]!;
  }
  return null;
}

/** FIT files inside an upload: the file itself, or every .fit inside a ZIP. */
export function extractFitFiles(name: string, bytes: Uint8Array): { name: string; bytes: Uint8Array; activityId: string | null }[] {
  if (isFit(bytes)) return [{ name, bytes, activityId: activityIdFromName(name) }];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return Object.entries(unzipSync(bytes))
      .filter(([entry]) => /\.fit$/i.test(entry))
      .map(([entry, content]) => ({ name: entry, bytes: content, activityId: activityIdFromName(entry, name) }));
  }
  return [];
}

export async function importFit(bytes: Uint8Array, fileName: string, activityId = activityIdFromName(fileName)): Promise<FitImport> {
  const messages = decodeFit(bytes);
  const first = (global: number) => messages.find((m) => m.global === global);
  const all = (global: number) => messages.filter((m) => m.global === global);

  const fileId = first(MSG.fileId);
  const session = first(MSG.session);
  const records = all(MSG.record);
  const summaries = all(MSG.diveSummary);
  const summary = summaries.find((s) => num(s, 0) === MSG.session) ?? summaries[0];

  const isDive = summary !== undefined || first(MSG.diveSettings) !== undefined || num(session, 5) === 53;
  if (!isDive) throw new NotADiveError(`${fileName}: not a dive activity`);

  const startUtc = num(session, 2) ?? num(fileId, 4);
  if (startUtc === null) throw new NotADiveError(`${fileName}: no start time`);

  // activity.local_timestamp minus its timestamp is the UTC offset, rounded to quarter hours
  const activity = first(MSG.activity);
  const actTs = num(activity, FIT_TIMESTAMP_FIELD);
  const actLocal = num(activity, 5);
  let utcOffset: number | null = null;
  if (actTs !== null && actLocal !== null) {
    const offset = Math.round((actLocal - actTs) / 900) * 900;
    if (offset >= -12 * 3600 && offset <= 14 * 3600) utcOffset = offset;
  }

  const manualEntry = num(fileId, 2) === PRODUCT_CONNECT;
  const dive = newDive(startUtc + FIT_EPOCH_OFFSET + (utcOffset ?? 0));
  const bottomTime = num(summary, 11);
  const duration = bottomTime !== null ? Math.round(bottomTime / 1000) : Math.round((num(session, 8) ?? num(session, 7) ?? 0) / 1000);
  const dc = newDiveComputer(dive.when, duration);
  dive.computers.push(dc);

  // Model: the creator device (device_index 0), else the file_id
  const creator = all(MSG.deviceInfo).find((d) => num(d, 0) === 0);
  const product = num(creator, 4) ?? num(fileId, 2);
  dc.model = manualEntry ? MANUAL_ENTRY_MODEL : product !== null ? (MODELS[product] ?? `Garmin (${product})`) : 'Garmin';

  // Garmin Connect names its export "<id>_ACTIVITY.fit"; use that name so the ID matches
  // Subsurface's own import regardless of how the file was renamed.
  dc.diveId = await garminDiveId(activityId ? `${activityId}_ACTIVITY.fit` : (fileName.split(/[\\/]/).pop() ?? fileName));
  if (activityId) dc.extraData.push({ key: 'Garmin Connect', value: activityId });

  const settings = first(MSG.diveSettings);
  const waterType = num(settings, 4);
  if (waterType !== null) dc.salinity = waterType === 0 ? 10000 : waterType === 3 ? lrint((num(settings, 5) ?? 1025) * 10) : 10250;

  // Samples
  let minTemp: number | null = null;
  let lastTemp: number | null = null;
  let maxDepth = 0;
  for (const r of records) {
    const ts = num(r, FIT_TIMESTAMP_FIELD);
    const depth = num(r, 92);
    if (ts === null || depth === null || ts < startUtc) continue;

    const previous = dc.samples[dc.samples.length - 1];
    const s = nextSample(previous);
    s.time = ts - startUtc;
    s.depth = depth;
    maxDepth = Math.max(maxDepth, depth);

    const temp = num(r, 13);
    if (temp !== null) {
      minTemp = minTemp === null ? temp : Math.min(minTemp, temp);
      if (temp !== lastTemp) s.temperature = temp * 1000 + ZERO_C_IN_MKELVIN;
      lastTemp = temp;
    }
    const hr = num(r, 3);
    if (hr !== null && hr > 0) s.heartbeat = hr;
    const tts = num(r, 95);
    if (tts !== null) s.tts = tts;
    const ndl = num(r, 96);
    if (ndl !== null) s.ndl = ndl;
    const cns = num(r, 97);
    if (cns !== null) s.cns = cns;
    const po2 = num(r, 129);
    if (po2 !== null) s.setpoint = po2 * 10;
    const stopDepth = num(r, 93);
    const stopTime = num(r, 94);
    if (stopDepth !== null) {
      s.inDeco = stopDepth > 0;
      s.stopdepth = stopDepth;
      s.stoptime = stopDepth > 0 ? (stopTime ?? 0) : 0;
    }
    dc.samples.push(s);
  }

  dc.maxDepth = num(summary, 3) ?? num(session, 0) ?? maxDepth;
  dc.meanDepth = num(summary, 2) ?? 0;
  const waterTemp = minTemp ?? num(session, 58) ?? num(session, 57);
  if (waterTemp !== null) dc.waterTemp = waterTemp * 1000 + ZERO_C_IN_MKELVIN;

  // Dive alerts
  for (const e of all(MSG.event)) {
    const ts = num(e, FIT_TIMESTAMP_FIELD);
    const alert = DIVE_ALERTS[num(e, 3) ?? -1];
    if (num(e, 0) !== FIT_EVENT_DIVE_ALERT || ts === null || ts < startUtc || !alert) continue;
    const event = newEvent(ts - startUtc);
    event.type = EVENT_TYPE_STRING;
    event.flags = alert[0] << 2;
    event.name = alert[1];
    dc.events.push(event);
  }
  dc.events = dropRepeatedEvents(dc.events);

  // Gases: one cylinder per enabled gas; air is stored as "no mix", as Subsurface does
  for (const gas of all(MSG.diveGas)) {
    if ((num(gas, 2) ?? 0) === 0) continue;
    const cylinder = newCylinder();
    const o2 = num(gas, 1) ?? 21;
    const he = num(gas, 0) ?? 0;
    if (o2 !== 21 || he) {
      cylinder.o2 = o2 * 10;
      cylinder.he = he * 10;
    }
    dive.cylinders.push(cylinder);
  }

  // Position: session start/end, else first/last record with a fix
  const fixes = records.map((r) => position(num(r, 0), num(r, 1))).filter((p): p is Location => p !== null);
  const entry = position(num(session, 3), num(session, 4)) ?? fixes[0] ?? null;
  const exit = position(num(session, 38), num(session, 39)) ?? fixes[fixes.length - 1] ?? null;

  return { dive, entry: entry ?? exit, exit, activityId, manualEntry, utcOffset, fileName };
}

/**
 * Subsurface drops an event when the same one (name and flags) occurred up to 60 seconds earlier
 * (fixup_dc_events() in core/dive.cpp). Doing it here keeps the upload identical to what
 * Subsurface writes after it has loaded the dive once. Like Subsurface, the first event is never
 * used as the earlier one.
 */
function dropRepeatedEvents(events: DiveEvent[]): DiveEvent[] {
  const dropped = new Set<number>();
  events.forEach((event, idx) => {
    for (let i = idx - 1; i > 0; i--) {
      const prev = events[i]!;
      if (event.time - prev.time > 60) break;
      if (dropped.has(i)) continue;
      if (prev.name === event.name && prev.flags === event.flags) {
        dropped.add(idx);
        break;
      }
    }
  });
  return events.filter((_, idx) => !dropped.has(idx));
}

/**
 * The dive in `dives` that is the same dive as `candidate`: same dive ID on a dive computer, or
 * a start time within a minute. The time check is needed because dives imported by other tools
 * carry other IDs.
 */
export function findSameDive(dives: readonly Dive[], candidate: Dive): Dive | null {
  const ids = new Set(candidate.computers.map((c) => c.diveId).filter((id) => id !== 0));
  return (
    dives.find((d) => d.computers.some((c) => ids.has(c.diveId))) ??
    dives.find((d) => Math.abs(d.when - candidate.when) <= 60) ??
    null
  );
}
