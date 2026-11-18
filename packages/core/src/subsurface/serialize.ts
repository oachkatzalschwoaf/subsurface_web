/**
 * Write a Logbook as a Subsurface git storage tree.
 *
 * Follows core/save-git.cpp line by line: same file and directory names, same order of lines,
 * same number formats, same "write only when changed" rules for samples. The round-trip test
 * checks the output byte by byte against repositories written by Subsurface.
 */
import {
  CYLINDER_USE,
  DIVE_MODES,
  hasLocation,
  isEmptySite,
  isGasChange,
  newSample,
  type Cylinder,
  type Dive,
  type DiveComputer,
  type DiveEvent,
  type DiveSite,
  type Location,
  type Logbook,
  type Picture,
  type Sample,
  type Settings,
  type Trip,
} from './model.ts';
import { treeObjectId } from './git-object.ts';
import { quoted } from './text.ts';
import { addFile, subtree, type GitTree } from './tree.ts';
import {
  formatDegrees,
  formatDuration,
  formatFraction,
  formatHex8,
  formatMilli,
  formatTemperature,
  pad2,
  pad3,
  pad4,
  toTm,
  type Tm,
} from './units.ts';

/** Year and month a directory stands for; -1 when its dives do not share it (save-git.cpp). */
interface DirDate {
  year: number;
  month: number;
}

const KNOWN_PREFS = ['TANKBAR', 'DCCEILING', 'SHOW_SETPOINT', 'SHOW_SENSORS', 'PO2_GRAPH'] as const;

export function serializeLogbook(logbook: Logbook): GitTree {
  const root: GitTree = new Map();
  addFile(root, '00-Subsurface', serializeSettings(logbook.settings));

  const referenced = new Set(logbook.dives.map((d) => d.siteUuid).filter((u): u is number => u !== null));
  const sitesDir = subtree(root, '01-Divesites');
  for (const site of logbook.sites) {
    if (isEmptySite(site) && !referenced.has(site.uuid)) continue;
    addFile(sitesDir, `Site-${formatHex8(site.uuid)}`, serializeSite(site));
  }

  const presetsDir = subtree(root, '02-Filterpresets');
  logbook.filterPresets.forEach((content, i) => addFile(presetsDir, `Preset-${pad3(i)}`, content));

  const dives = [...logbook.dives].sort((a, b) => a.when - b.when);
  const savedTrips = new Set<Trip>();
  const collisions: Collision[] = [];
  for (const dive of dives) {
    const trip = dive.trip;
    if (trip && savedTrips.has(trip)) continue;

    const tripDives = trip ? dives.filter((d) => d.trip === trip) : [];
    const tm = toTm(trip ? tripDives[0]!.when : dive.when);
    const monthDir = subtree(subtree(root, pad4(tm.year)), pad2(tm.month));

    if (!trip) {
      saveDive(monthDir, dive, { year: tm.year, month: tm.month }, collisions, 3);
      continue;
    }
    savedTrips.add(trip);
    const tripDir: GitTree = new Map();
    addTree(monthDir, tripDirectoryName(trip, tm), tripDir, collisions, 3);
    addFile(tripDir, '00-Trip', serializeTrip(trip, tm));
    const shared = sharedDate(tm, tripDives[0]!.when, tripDives[tripDives.length - 1]!.when);
    for (const d of tripDives) saveDive(tripDir, d, shared, collisions, 4);
  }
  resolveCollisions(collisions);
  return root;
}

/** A dive or trip directory named like one created before it in the same directory. */
interface Collision {
  parent: GitTree;
  name: string;
  tree: GitTree;
  /** Levels below the root, for resolving inner names first */
  depth: number;
}

function addTree(parent: GitTree, name: string, tree: GitTree, collisions: Collision[], depth: number): void {
  if (parent.has(name)) collisions.push({ parent, name, tree, depth });
  else parent.set(name, tree);
}

/**
 * Two trips of the same name starting on the same day, or two dives in the same second, get the
 * same directory name. Subsurface marks dive and trip directories "unique" and its tree_insert()
 * then appends "~" and the first 7 hex digits of the directory's git object ID to every one but
 * the directory created last, which keeps the plain name (new_directory() puts new ones first and
 * write_git_tree() writes in that order). Names inside go first: they are part of the IDs.
 */
function resolveCollisions(collisions: Collision[]): void {
  for (const c of [...collisions].sort((a, b) => b.depth - a.depth)) {
    const earlier = c.parent.get(c.name) as GitTree;
    c.parent.set(c.name, c.tree);
    c.parent.set(`${c.name}~${treeObjectId(earlier).slice(0, 7)}`, earlier);
  }
}

/** verify_shared_date() for the first and the last dive of a trip */
function sharedDate(tm: Tm, first: number, last: number): DirDate {
  const out = { year: tm.year, month: tm.month };
  for (const when of [first, last]) {
    const t = toTm(when);
    if (t.year !== out.year) {
      out.year = -1;
      out.month = -1;
    }
    if (t.month !== out.month) out.month = -1;
  }
  return out;
}

/** create_trip_name(): day of month plus up to 15 ASCII letters of the location. */
export function tripDirectoryName(trip: Trip, tm: Tm): string {
  let letters = '';
  for (const c of trip.location) {
    if (letters.length >= 15 || c === ',' || c === '.') break;
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) letters += c;
  }
  return `${pad2(tm.day)}-${letters.length > 1 ? letters : 'trip'}`;
}

/** create_dive_name(): [[yyyy-]mm-]dd-Ddd-hh=mm=ss relative to the directory's date. */
export function diveDirectoryName(when: number, dir: DirDate): string {
  const tm = toTm(when);
  let name = '';
  if (tm.year !== dir.year) name += `${pad4(tm.year)}-`;
  if (tm.month !== dir.month) name += `${pad2(tm.month)}-`;
  return `${name}${pad2(tm.day)}-${tm.weekday}-${pad2(tm.hour)}=${pad2(tm.minute)}=${pad2(tm.second)}`;
}

function saveDive(parent: GitTree, dive: Dive, dir: DirDate, collisions: Collision[], depth: number): void {
  const diveDir: GitTree = new Map();
  addTree(parent, diveDirectoryName(dive.when, dir), diveDir, collisions, depth);
  addFile(diveDir, dive.number ? `Dive-${dive.number}` : 'Dive', serializeDive(dive));

  let idx = dive.computers.length > 1 ? 1 : 0;
  for (const dc of dive.computers) {
    addFile(diveDir, idx ? `Divecomputer-${pad3(idx)}` : 'Divecomputer', serializeDiveComputer(dive, dc));
    idx++;
  }

  if (dive.pictures.length > 0) {
    const pictures = subtree(diveDir, 'Pictures');
    for (const picture of dive.pictures) addFile(pictures, pictureName(picture), serializePicture(picture));
  }
}

function pictureName(picture: Picture): string {
  const sign = picture.offset < 0 ? '-' : '+';
  let offset = Math.abs(picture.offset);
  const h = Math.floor(offset / 3600);
  offset -= h * 3600;
  return `${sign}${pad2(h)}=${pad2(Math.floor(offset / 60))}=${pad2(offset % 60)}`;
}

function serializeTrip(trip: Trip, tm: Tm): string {
  return (
    `date ${pad4(tm.year)}-${pad2(tm.month)}-${pad2(tm.day)}\n` +
    `time ${pad2(tm.hour)}:${pad2(tm.minute)}:${pad2(tm.second)}\n` +
    quoted('location ', trip.location, '\n') +
    quoted('notes ', trip.notes, '\n')
  );
}

/** create_dive_buffer() */
export function serializeDive(dive: Dive): string {
  let b = '';
  const duration = dive.computers[0]?.duration ?? 0;
  if (duration > 0) b += `duration ${formatDuration(duration)} min\n`;
  const ints: [string, number][] = [
    ['rating', dive.rating],
    ['visibility', dive.visibility],
    ['wavesize', dive.wavesize],
    ['current', dive.current],
    ['surge', dive.surge],
    ['chill', dive.chill],
  ];
  for (const [label, value] of ints) if (value) b += `${label} ${value}\n`;
  if (dive.userSalinity) b += `watersalinity ${Math.trunc(dive.userSalinity / 10)} g/l\n`;
  if (dive.airPressure) b += `airpressure ${dive.airPressure}\n`;
  if (dive.notrip) b += 'notrip\n';
  if (dive.invalid) b += 'invalid\n';
  if (dive.tags.length > 0) b += `tags${dive.tags.map((t, i) => quoted(i ? ', ' : ' ', t, '')).join('')}\n`;
  if (dive.siteUuid !== null) b += `divesiteid ${formatHex8(dive.siteUuid)}\n`;
  b += quoted('divemaster ', dive.diveGuide, '\n');
  b += quoted('buddy ', dive.buddy, '\n');
  b += quoted('suit ', dive.suit, '\n');
  b += quoted('notes ', dive.notes, '\n');
  for (const cyl of dive.cylinders) b += serializeCylinder(cyl);
  for (const ws of dive.weightsystems) {
    b += `weightsystem weight=${formatMilli(ws.weight)}kg${quoted(' description=', ws.description, '')}\n`;
  }
  if (dive.airTemp) b += `airtemp ${formatTemperature(dive.airTemp)}°C\n`;
  if (dive.waterTemp) b += `watertemp ${formatTemperature(dive.waterTemp)}°C\n`;
  return b;
}

function gasmix(o2: number, he: number): string {
  if (!o2) return '';
  return ` o2=${formatFraction(o2)}${he ? ` he=${formatFraction(he)}` : ''}`;
}

function serializeCylinder(cyl: Cylinder): string {
  let s = 'cylinder';
  if (cyl.volume) s += ` vol=${formatMilli(cyl.volume)}l`;
  if (cyl.workPressure) s += ` workpressure=${formatMilli(cyl.workPressure)}bar`;
  s += quoted(' description=', cyl.description, '');
  s += gasmix(cyl.o2, cyl.he);
  if (cyl.start) s += ` start=${formatMilli(cyl.start)}bar`;
  if (cyl.end) s += ` end=${formatMilli(cyl.end)}bar`;
  if (cyl.use > 0 && cyl.use < CYLINDER_USE.length) s += quoted(' use=', CYLINDER_USE[cyl.use]!, '');
  if (cyl.depth) s += ` depth=${formatMilli(cyl.depth)}m`;
  return `${s}\n`;
}

/** save_dc() */
export function serializeDiveComputer(dive: Dive, dc: DiveComputer): string {
  let b = quoted('model ', dc.model, '\n');
  if (dc.lastManualTime) b += `lastmanualtime ${formatDuration(dc.lastManualTime)}min\n`;
  if (dc.deviceId) b += `deviceid ${formatHex8(dc.deviceId)}\n`;
  if (dc.diveId) b += `diveid ${formatHex8(dc.diveId)}\n`;
  if (dc.when && dc.when !== dive.when) {
    const tm = toTm(dc.when);
    b += `date ${pad4(tm.year)}-${pad2(tm.month)}-${pad2(tm.day)}\n`;
    b += `time ${pad2(tm.hour)}:${pad2(tm.minute)}:${pad2(tm.second)}\n`;
  }
  if (dc.duration && dc.duration !== dive.computers[0]?.duration) b += `duration ${formatDuration(dc.duration)}min\n`;
  if (dc.diveMode !== 0) {
    b += `dctype ${DIVE_MODES[dc.diveMode] ?? ''}\n`;
    b += `numberofoxygensensors ${dc.o2Sensors}\n`;
  }
  if (dc.maxDepth) b += `maxdepth ${formatMilli(dc.maxDepth)}m\n`;
  if (dc.meanDepth) b += `meandepth ${formatMilli(dc.meanDepth)}m\n`;
  if (dc.airTemp) b += `airtemp ${formatTemperature(dc.airTemp)}°C\n`;
  if (dc.waterTemp) b += `watertemp ${formatTemperature(dc.waterTemp)}°C\n`;
  if (dc.surfacePressure) b += `surfacepressure ${formatMilli(dc.surfacePressure)}bar\n`;
  if (dc.salinity) b += `salinity ${Math.trunc(dc.salinity / 10)}g/l\n`;
  if (dc.surfaceTime) b += `surfacetime ${formatDuration(dc.surfaceTime)}min\n`;
  // Subsurface writes key and value without escaping.
  for (const { key, value } of dc.extraData) if (key && value) b += `keyvalue "${key}" "${value}"\n`;
  for (const m of dc.tankSensorMappings) b += `tanksensormapping "${m.sensorId}" "${m.cylinderIndex}"\n`;
  for (const ev of dc.events) b += serializeEvent(dive, ev);
  b += serializeSamples(dc.samples);
  return b;
}

function serializeEvent(dive: Dive, ev: DiveEvent): string {
  let s = `event ${Math.floor(ev.time / 60)}:${pad2(ev.time % 60)}`;
  if (ev.type) s += ` type=${ev.type}`;
  if (ev.flags) s += ` flags=${ev.flags}`;
  if (ev.name === 'modechange') s += quoted(' divemode=', DIVE_MODES[ev.value] ?? '', '');
  else if (ev.value) s += ` value=${ev.value}`;
  s += quoted(' name=', ev.name, '');
  if (isGasChange(ev)) {
    const cyl = ev.cylinder >= 0 ? dive.cylinders[ev.cylinder] : undefined;
    if (ev.cylinder >= 0) s += ` cylinder=${ev.cylinder}`;
    s += cyl ? gasmix(cyl.o2, cyl.he) : gasmix(ev.o2, ev.he);
  }
  return `${s}\n`;
}

/** `%u:%02u` with C's unsigned wrap-around for negative values */
function unsignedDuration(seconds: number): string {
  return formatDuration(seconds >>> 0);
}

/** save_samples() / save_sample(): most values are written only when they change. */
export function serializeSamples(samples: readonly Sample[]): string {
  const old = { ...newSample(), o2sensor: [0, 0, 0, 0, 0, 0, 0] };
  const oldSensor: number[] = [];
  const oldPressure: number[] = [];
  // collected and joined once instead of appending every line to one string
  const lines: string[] = [];
  for (const s of samples) {
    let line = `${String(Math.floor(s.time / 60)).padStart(3)}:${pad2(s.time % 60)}`;
    line += ` ${formatMilli(s.depth)}m`;
    if (s.temperature) line += ` ${formatTemperature(s.temperature)}°C`;
    s.pressures.forEach((p, idx) => {
      if (p.sensor === -1 || !p.mbar || (oldSensor[idx] === p.sensor && oldPressure[idx] === p.mbar)) return;
      line += ` ${formatMilli(p.mbar)}bar:${p.sensor}`;
      oldSensor[idx] = p.sensor;
      oldPressure[idx] = p.mbar;
    });
    if (s.ndl !== old.ndl) line += ` ndl=${unsignedDuration((old.ndl = s.ndl))}`;
    if (s.tts !== old.tts) line += ` tts=${unsignedDuration((old.tts = s.tts))}`;
    if (s.inDeco !== old.inDeco) line += ` in_deco=${(old.inDeco = s.inDeco) ? 1 : 0}`;
    if (s.stoptime !== old.stoptime) line += ` stoptime=${unsignedDuration((old.stoptime = s.stoptime))}`;
    if (s.stopdepth !== old.stopdepth) line += ` stopdepth=${formatMilli((old.stopdepth = s.stopdepth))}m`;
    if (s.cns !== old.cns) line += ` cns=${(old.cns = s.cns)}%`;
    if (s.rbt !== old.rbt) line += ` rbt=${unsignedDuration((old.rbt = s.rbt))}`;
    const o2 = s.o2sensor;
    if ((o2[0] ?? 0) !== old.o2sensor[0]) line += ` sensor1=${formatMilli((old.o2sensor[0] = o2[0] ?? 0))}bar`;
    for (let i = 1; i <= 6; i++) {
      const v = o2[i] ?? 0;
      if (v && v !== old.o2sensor[i]) {
        line += ` ${i === 6 ? 'dc_supplied_ppo2' : `sensor${i + 1}`}=${formatMilli(v)}bar`;
        old.o2sensor[i] = v;
      }
    }
    if (s.setpoint !== old.setpoint) line += ` po2=${formatMilli((old.setpoint = s.setpoint))}bar`;
    if (s.heartbeat !== old.heartbeat) {
      if (s.heartbeat) line += ` heartbeat=${s.heartbeat}`;
      old.heartbeat = s.heartbeat;
    }
    if (s.bearing !== old.bearing) {
      if (s.bearing) line += ` bearing=${s.bearing}°`;
      old.bearing = s.bearing;
    }
    lines.push(line);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function location(prefix: string, loc: Location | null): string {
  return hasLocation(loc) ? `${prefix}${formatDegrees(loc.lat)} ${formatDegrees(loc.lon)}\n` : '';
}

function serializePicture(picture: Picture): string {
  return quoted('filename ', picture.filename, '\n') + location('gps ', picture.location);
}

function serializeSite(site: DiveSite): string {
  let b = quoted('name ', site.name, '\n');
  b += quoted('description ', site.description, '\n');
  b += quoted('notes ', site.notes, '\n');
  b += location('gps ', site.location);
  for (const t of site.taxonomy) {
    if (t.category !== 0 && t.value) b += `geo cat ${t.category} origin ${t.origin} ${quoted('', t.value, '\n')}`;
  }
  return b;
}

/** save_settings() */
function serializeSettings(settings: Settings): string {
  let b = `version ${settings.version}\n`;
  for (const d of settings.devices) {
    if (!d.nickname || !d.serial) continue;
    b += `${quoted('divecomputerid ', d.model, '')} deviceid=${formatHex8(d.deviceId)}`;
    b += `${quoted(' serial=', d.serial, '')}${quoted(' nickname=', d.nickname, '')}\n`;
  }
  for (const fp of settings.fingerprints) {
    b += `fingerprint model=${formatHex8(fp.model)} serial=${formatHex8(fp.serial)} `;
    b += `deviceid=${formatHex8(fp.deviceId)} diveid=${formatHex8(fp.diveId)} data="${fp.data}"\n`;
  }
  if (settings.autogroup) b += 'autogroup\n';
  b += `units ${settings.units || 'METRIC'}\n`;
  for (const pref of KNOWN_PREFS) if (settings.prefs.includes(pref)) b += `prefs ${pref}\n`;
  return b;
}
