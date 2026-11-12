/**
 * Read a Subsurface git storage tree into a Logbook.
 *
 * Follows core/load-git.cpp: the same directory walk, keywords and value parsing. Values are kept
 * as written; Subsurface's own fixups (recomputing mean depth and the like) are not applied, so
 * that writing the logbook back gives the same files.
 *
 * Temperatures in samples are not carried over to the next sample. Subsurface carries them on
 * load and then drops repeated readings in fixup_dc_temp(), which gives the same result.
 */
import {
  CYLINDER_USE,
  DIVE_MODES,
  isGasChange,
  newCylinder,
  newDive,
  newDiveComputer,
  newEvent,
  newSample,
  newSettings,
  type Dive,
  type DiveComputer,
  type DiveSite,
  type Location,
  type Logbook,
  type Picture,
  type Sample,
  type Settings,
  type Trip,
} from './model.ts';
import { parseKeyValues, splitKeyword, splitLines, StringQueue, type Line } from './text.ts';
import { isTree, type GitTree } from './tree.ts';
import {
  atoi,
  fromParts,
  lrint,
  parseDegrees,
  parseDuration,
  parseFraction,
  parseHex,
  parseMilli,
  parseSalinity,
  parseTemperature,
  strtod,
  toTm,
} from './units.ts';

export interface ParseResult {
  logbook: Logbook;
  /** Lines or files Subsurface would ignore or report. Empty for a clean repository. */
  warnings: string[];
}

type Warn = (message: string) => void;

export function parseLogbook(tree: GitTree): ParseResult {
  const warnings: string[] = [];
  const warn: Warn = (m) => warnings.push(m);

  const settingsFile = tree.get('00-Subsurface');
  const settings = typeof settingsFile === 'string' ? parseSettings(settingsFile, warn) : newSettings();

  const sites: DiveSite[] = [];
  const sitesDir = tree.get('01-Divesites');
  if (isTree(sitesDir)) {
    for (const name of sortedNames(sitesDir)) {
      const node = sitesDir.get(name)!;
      if (typeof node !== 'string' || !name.startsWith('Site')) {
        warn(`01-Divesites/${name}: unexpected entry`);
        continue;
      }
      sites.push(parseSite(parseHex(name.slice(5)), node, warn, `01-Divesites/${name}`));
    }
  }

  const filterPresets: string[] = [];
  const presetsDir = tree.get('02-Filterpresets');
  if (isTree(presetsDir)) {
    for (const name of sortedNames(presetsDir)) {
      const node = presetsDir.get(name)!;
      if (typeof node === 'string' && name.startsWith('Preset-')) filterPresets.push(node);
      else warn(`02-Filterpresets/${name}: unexpected entry`);
    }
  }

  const trips: Trip[] = [];
  const dives: Dive[] = [];

  for (const yearName of sortedNames(tree)) {
    if (['00-Subsurface', '01-Divesites', '02-Filterpresets'].includes(yearName)) continue;
    const yearDir = tree.get(yearName)!;
    if (!isTree(yearDir) || !/^\d{4}$/.test(yearName)) {
      warn(`${yearName}: unexpected entry`);
      continue;
    }
    for (const monthName of sortedNames(yearDir)) {
      const monthDir = yearDir.get(monthName)!;
      const path = `${yearName}/${monthName}`;
      if (!isTree(monthDir) || !/^\d{2}$/.test(monthName)) {
        warn(`${path}: unexpected entry`);
        continue;
      }
      const year = Number(yearName);
      const month = Number(monthName);
      for (const name of sortedNames(monthDir)) {
        const node = monthDir.get(name)!;
        const entryPath = `${path}/${name}`;
        const kind = isTree(node) ? classifyDirectory(name) : 'other';
        if (kind === 'dive' && isTree(node)) {
          const dive = parseDiveDirectory(node, name, year, month, null, warn, entryPath);
          if (dive) dives.push(dive);
        } else if (kind === 'trip' && isTree(node)) {
          const trip: Trip = { location: '', notes: '' };
          trips.push(trip);
          for (const sub of sortedNames(node)) {
            const subNode = node.get(sub)!;
            const subPath = `${entryPath}/${sub}`;
            if (sub === '00-Trip' && typeof subNode === 'string') {
              parseTripFile(trip, subNode, warn, subPath);
            } else if (isTree(subNode) && classifyDirectory(sub) === 'dive') {
              const dive = parseDiveDirectory(subNode, sub, year, month, trip, warn, subPath);
              if (dive) dives.push(dive);
            } else {
              warn(`${subPath}: unexpected entry`);
            }
          }
        } else {
          warn(`${entryPath}: unexpected entry`);
        }
      }
    }
  }

  dives.sort((a, b) => a.when - b.when);
  return { logbook: { settings, sites, filterPresets, trips, dives }, warnings };
}

function sortedNames(tree: GitTree): string[] {
  return [...tree.keys()].sort();
}

/** walk_tree_directory(): dive directories end in hh=mm=ss, trip directories are nn-name. */
function classifyDirectory(name: string): 'dive' | 'trip' | 'other' {
  const base = name.split('~')[0]!;
  const digits = /^\d*/.exec(base)![0].length;
  if (digits !== 2 && digits !== 4) return 'other';
  if (base[digits] !== '-') return 'other';
  const c = base[base.length - 3];
  if (c === '=' || c === ':') return 'dive';
  return digits === 2 ? 'trip' : 'other';
}

/** dive_directory(): [[yyyy-]mm-]dd-Ddd-hh=mm=ss[~hex] */
export function parseDiveDirectoryName(name: string, pathYear: number, pathMonth: number): number | null {
  const base = name.split('~')[0]!;
  const timeOff = base.length - 8;
  let mdayOff = timeOff;
  if (mdayOff <= 0 || base[--mdayOff] !== '-') return null;
  while (mdayOff > 0 && base[--mdayOff] !== '-');
  mdayOff -= 2;
  const monthOff = mdayOff - 3;
  const yearOff = monthOff - 5;
  if (mdayOff < 0) return null;

  const time = /^(\d+)[=:](\d+)[=:](\d+)/.exec(base.slice(timeOff));
  if (!time) return null;
  const [h, m, s] = [Number(time[1]), Number(time[2]), Number(time[3])];
  if (h > 23 || m > 59 || s > 60) return null;

  const day = atoi(base.slice(mdayOff));
  const year = yearOff >= 0 ? atoi(base.slice(yearOff)) : pathYear;
  const month = monthOff >= 0 ? atoi(base.slice(monthOff)) : pathMonth;
  if (year <= 1930 || year >= 3000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return fromParts(year, month, day, h, m, s);
}

function parseDiveDirectory(
  dir: GitTree,
  name: string,
  year: number,
  month: number,
  trip: Trip | null,
  warn: Warn,
  path: string,
): Dive | null {
  const when = parseDiveDirectoryName(name, year, month);
  if (when === null) {
    warn(`${path}: not a valid dive directory name`);
    return null;
  }
  const dive = newDive(when);
  dive.trip = trip;

  const names = sortedNames(dir);
  let duration = 0;
  const diveFile = names.find((n) => n.startsWith('Dive') && !n.startsWith('Divecomputer'));
  if (diveFile) {
    const content = dir.get(diveFile);
    if (typeof content === 'string') {
      const suffix = diveFile.slice(4);
      if (suffix) dive.number = atoi(suffix.slice(1));
      duration = parseDiveFile(dive, content, warn, `${path}/${diveFile}`);
    }
  }

  for (const n of names) {
    const node = dir.get(n)!;
    const filePath = `${path}/${n}`;
    if (n === diveFile) continue;
    if (n.startsWith('Divecomputer') && typeof node === 'string') {
      dive.computers.push(parseDiveComputer(dive, node, duration, warn, filePath));
    } else if (n === 'Pictures' && isTree(node)) {
      for (const pic of sortedNames(node)) {
        const picNode = node.get(pic)!;
        const picture = typeof picNode === 'string' ? parsePicture(pic, picNode, warn, `${filePath}/${pic}`) : null;
        if (picture) dive.pictures.push(picture);
        else warn(`${filePath}/${pic}: unexpected entry`);
      }
    } else {
      warn(`${filePath}: unexpected entry`);
    }
  }
  if (dive.computers.length === 0) dive.computers.push(newDiveComputer(dive.when, duration));
  return dive;
}

function forEachLine(content: string, warn: Warn, path: string, fn: (line: Line) => void): void {
  const { lines, skipped } = splitLines(content);
  for (const s of skipped) warn(`${path}: skipped invalid line ${JSON.stringify(s)}`);
  for (const line of lines) fn(line);
}

/** Parses a Dive-N file into `dive` and returns the `duration` it states (seconds). */
function parseDiveFile(dive: Dive, content: string, warn: Warn, path: string): number {
  let duration = 0;
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    if (!kw) return warn(`${path}: unknown line ${JSON.stringify(line.text)}`);
    const strings = new StringQueue(line.strings);
    const first = () => line.strings[0] ?? '';
    const { keyword, rest } = kw;
    switch (keyword) {
      case 'duration': duration = parseDuration(rest); break;
      case 'rating': dive.rating = atoi(rest); break;
      case 'visibility': dive.visibility = atoi(rest); break;
      case 'wavesize': dive.wavesize = atoi(rest); break;
      case 'current': dive.current = atoi(rest); break;
      case 'surge': dive.surge = atoi(rest); break;
      case 'chill': dive.chill = atoi(rest); break;
      case 'watersalinity': dive.userSalinity = parseSalinity(rest); break;
      case 'airpressure': dive.airPressure = lrint(strtod(rest)); break;
      case 'notrip': dive.notrip = true; break;
      case 'invalid': dive.invalid = true; break;
      case 'tags': dive.tags.push(...line.strings.filter((t) => t !== '')); break;
      case 'divesiteid': dive.siteUuid = parseHex(rest); break;
      case 'divemaster':
      case 'diveguide': dive.diveGuide = first(); break;
      case 'buddy': dive.buddy = first(); break;
      case 'suit': dive.suit = first(); break;
      case 'notes': dive.notes = first(); break;
      case 'airtemp': dive.airTemp = parseTemperature(rest); break;
      case 'watertemp': dive.waterTemp = parseTemperature(rest); break;
      case 'cylinder': {
        const cyl = newCylinder();
        for (const { key, value } of parseKeyValues(rest, strings)) {
          switch (key) {
            case 'vol': cyl.volume = parseMilli(value); break;
            case 'workpressure': cyl.workPressure = parseMilli(value); break;
            case 'description': cyl.description = value; break;
            case 'o2': cyl.o2 = parseFraction(value); break;
            case 'he': cyl.he = parseFraction(value); break;
            case 'start': cyl.start = parseMilli(value); break;
            case 'end': cyl.end = parseMilli(value); break;
            case 'use': cyl.use = Math.max(0, (CYLINDER_USE as readonly string[]).indexOf(value)); break;
            case 'depth': cyl.depth = parseMilli(value); break;
            default:
              if (!(key.startsWith('m') && value === '')) warn(`${path}: unknown cylinder key ${key}`);
          }
        }
        dive.cylinders.push(cyl);
        break;
      }
      case 'weightsystem': {
        const ws = { weight: 0, description: '' };
        for (const { key, value } of parseKeyValues(rest, strings)) {
          if (key === 'weight') ws.weight = parseMilli(value);
          else if (key === 'description') ws.description = value;
          else warn(`${path}: unknown weightsystem key ${key}`);
        }
        dive.weightsystems.push(ws);
        break;
      }
      case 'gps':
      case 'location':
        // Legacy keywords that create dive sites in Subsurface. Not supported.
        warn(`${path}: legacy keyword "${keyword}" ignored`);
        break;
      default:
        warn(`${path}: unknown keyword "${keyword}"`);
    }
  });
  return duration;
}

function parseDiveComputer(dive: Dive, content: string, diveDuration: number, warn: Warn, path: string): DiveComputer {
  const dc = newDiveComputer(dive.when, diveDuration);
  const defaultSensor = dive.cylinders.length > 0 ? 0 : -1;
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    if (!kw) {
      parseSample(dc, line.text, defaultSensor, warn, path);
      return;
    }
    const { keyword, rest } = kw;
    const strings = new StringQueue(line.strings);
    switch (keyword) {
      case 'airtemp': dc.airTemp = parseTemperature(rest); break;
      case 'date': dc.when = withDate(dc.when, rest); break;
      case 'time': dc.when = withTime(dc.when, rest); break;
      case 'dctype': dc.diveMode = Math.max(0, (DIVE_MODES as readonly string[]).indexOf(rest)); break;
      case 'deviceid': dc.deviceId = parseHex(rest); break;
      case 'diveid': dc.diveId = parseHex(rest); break;
      case 'duration': dc.duration = parseDuration(rest); break;
      case 'lastmanualtime': dc.lastManualTime = parseDuration(rest); break;
      case 'maxdepth': dc.maxDepth = parseMilli(rest); break;
      case 'meandepth': dc.meanDepth = parseMilli(rest); break;
      case 'model': dc.model = line.strings[0] ?? ''; break;
      case 'numberofoxygensensors': dc.o2Sensors = atoi(rest); break;
      case 'salinity': dc.salinity = parseSalinity(rest); break;
      case 'surfacepressure': dc.surfacePressure = parseMilli(rest); break;
      case 'surfacetime': dc.surfaceTime = parseDuration(rest); break;
      case 'watertemp': dc.waterTemp = parseTemperature(rest); break;
      case 'keyvalue':
        if (line.strings.length === 2) dc.extraData.push({ key: line.strings[0]!, value: line.strings[1]! });
        else warn(`${path}: keyvalue needs two strings`);
        break;
      case 'tanksensormapping':
        if (line.strings.length === 2) {
          dc.tankSensorMappings.push({ sensorId: atoi(line.strings[0]!), cylinderIndex: atoi(line.strings[1]!) });
        } else warn(`${path}: tanksensormapping needs two strings`);
        break;
      case 'event': {
        const event = newEvent(parseDuration(rest));
        let hasDivemode = false;
        let cylinderMarker = 0;
        const afterTime = rest.replace(/^\s*[+-]?\d+(?::\d+)?/, '');
        for (const { key, value } of parseKeyValues(afterTime, strings)) {
          switch (key) {
            case 'type': event.type = atoi(value); break;
            case 'flags': event.flags = atoi(value); break;
            case 'value': event.value = atoi(value); break;
            case 'name': event.name = value; break;
            case 'divemode':
              event.value = Math.max(0, (DIVE_MODES as readonly string[]).indexOf(value));
              hasDivemode = true;
              break;
            case 'cylinder': cylinderMarker = 1 + atoi(value); break;
            case 'o2': event.o2 = parseFraction(value); break;
            case 'he': event.he = parseFraction(value); break;
            default: warn(`${path}: unknown event key ${key}`);
          }
        }
        if (hasDivemode) event.name = 'modechange';
        if (isGasChange(event)) event.cylinder = cylinderMarker - 1;
        dc.events.push(event);
        break;
      }
      default:
        warn(`${path}: unknown keyword "${keyword}"`);
    }
  });
  return dc;
}

/** sample_parser() */
function parseSample(dc: DiveComputer, text: string, defaultSensor: number, warn: Warn, path: string): void {
  const previous = dc.samples[dc.samples.length - 1];
  const sample: Sample = previous
    ? { ...structuredClone(previous), temperature: 0, pressures: [] }
    : newSample();
  let currentSensor = previous ? (previous.pressures[0]?.sensor ?? defaultSensor) : defaultSensor;

  const tokens = text.trim().split(/\s+/);
  sample.time = parseDuration(tokens.shift() ?? '');

  for (const token of tokens) {
    const c = token[0] ?? '';
    if (c >= 'a' && c <= 'z') {
      const eq = token.indexOf('=');
      const key = eq < 0 ? token : token.slice(0, eq);
      const value = eq < 0 ? '' : token.slice(eq + 1);
      applySampleKey(sample, key, value, warn, path);
      continue;
    }
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(token);
    if (!num) {
      warn(`${path}: odd sample data ${JSON.stringify(token)}`);
      break;
    }
    const value = Number.parseFloat(num[0]);
    const unit = token.slice(num[0].length);
    if (unit.startsWith('m')) {
      sample.depth = lrint(1000 * value);
    } else if (unit.startsWith('b')) {
      let sensor = currentSensor;
      if (unit.length > 4 && unit[3] === ':') sensor = atoi(unit.slice(4));
      currentSensor = sensor;
      sample.pressures.push({ sensor, mbar: lrint(1000 * value) });
    } else {
      sample.temperature = parseTemperature(num[0]);
    }
  }
  dc.samples.push(sample);
}

function applySampleKey(sample: Sample, key: string, value: string, warn: Warn, path: string): void {
  switch (key) {
    case 'ndl': sample.ndl = parseDuration(value); break;
    case 'tts': sample.tts = parseDuration(value); break;
    case 'in_deco': sample.inDeco = atoi(value) !== 0; break;
    case 'stoptime': sample.stoptime = parseDuration(value); break;
    case 'stopdepth': sample.stopdepth = parseMilli(value); break;
    case 'cns': sample.cns = atoi(value); break;
    case 'rbt': sample.rbt = parseDuration(value); break;
    case 'po2': sample.setpoint = parseMilli(value); break;
    case 'heartbeat': sample.heartbeat = atoi(value); break;
    case 'bearing': sample.bearing = atoi(value); break;
    case 'dc_supplied_ppo2': sample.o2sensor[6] = parseMilli(value); break;
    default: {
      const sensor = /^sensor([1-6])$/.exec(key);
      if (sensor) sample.o2sensor[Number(sensor[1]) - 1] = parseMilli(value);
      else warn(`${path}: unknown sample key ${key}`);
    }
  }
}

function withDate(when: number, text: string): number {
  const m = /^(\d+)-(\d+)-(\d+)/.exec(text.trim());
  if (!m) return when;
  const tm = toTm(when);
  return fromParts(Number(m[1]), Number(m[2]), Number(m[3]), tm.hour, tm.minute, tm.second);
}

function withTime(when: number, text: string): number {
  const m = /^(\d+):(\d+)(?::(\d+))?/.exec(text.trim());
  if (!m) return when;
  const tm = toTm(when);
  return fromParts(tm.year, tm.month, tm.day, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0);
}

function parseLocation(text: string): Location {
  const [lat = '', lon = ''] = text.trim().split(/[\s,]+/);
  return { lat: parseDegrees(lat), lon: parseDegrees(lon) };
}

function parseTripFile(trip: Trip, content: string, warn: Warn, path: string): void {
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    switch (kw?.keyword) {
      case 'date':
      case 'time':
        break; // derived from the first dive
      case 'location': trip.location = line.strings[0] ?? ''; break;
      case 'notes': trip.notes = line.strings[0] ?? ''; break;
      default: warn(`${path}: unknown line ${JSON.stringify(line.text)}`);
    }
  });
}

function parseSite(uuid: number, content: string, warn: Warn, path: string): DiveSite {
  const site: DiveSite = { uuid, name: '', description: '', notes: '', location: null, taxonomy: [] };
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    switch (kw?.keyword) {
      case 'name': site.name = line.strings[0] ?? ''; break;
      case 'description': site.description = line.strings[0] ?? ''; break;
      case 'notes': site.notes = line.strings[0] ?? ''; break;
      case 'gps': site.location = parseLocation(kw.rest); break;
      case 'geo': {
        const m = /cat (-?\d+) origin (-?\d+)/.exec(kw.rest);
        site.taxonomy.push({
          category: m ? Number(m[1]) : 0,
          origin: m ? Number(m[2]) : 0,
          value: line.strings[0] ?? '',
        });
        break;
      }
      default: warn(`${path}: unknown line ${JSON.stringify(line.text)}`);
    }
  });
  return site;
}

function parsePicture(name: string, content: string, warn: Warn, path: string): Picture | null {
  const m = /^([+-])(\d+)[=:](\d+)[=:](\d+)/.exec(name);
  if (!m) return null;
  const seconds = Number(m[4]) + 60 * (Number(m[3]) + 60 * Number(m[2]));
  const picture: Picture = { offset: m[1] === '-' ? -seconds : seconds, filename: '', location: null };
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    switch (kw?.keyword) {
      case 'filename': picture.filename = line.strings[0] ?? ''; break;
      case 'gps': picture.location = parseLocation(kw.rest); break;
      case 'hash': break; // legacy
      default: warn(`${path}: unknown line ${JSON.stringify(line.text)}`);
    }
  });
  return picture;
}

function parseSettings(content: string, warn: Warn): Settings {
  const settings = newSettings();
  const path = '00-Subsurface';
  forEachLine(content, warn, path, (line) => {
    const kw = splitKeyword(line.text);
    if (!kw) return warn(`${path}: unknown line ${JSON.stringify(line.text)}`);
    const strings = new StringQueue(line.strings);
    switch (kw.keyword) {
      case 'version': settings.version = atoi(kw.rest); break;
      case 'autogroup': settings.autogroup = true; break;
      case 'units': settings.units = kw.rest; break;
      case 'prefs': settings.prefs.push(kw.rest); break;
      case 'subsurface':
      case 'userid':
        break; // legacy
      case 'divecomputerid': {
        const device = { model: strings.pop(), deviceId: 0, serial: '', nickname: '' };
        for (const { key, value } of parseKeyValues(kw.rest.replace(/^"/, ''), strings)) {
          if (key === 'deviceid') device.deviceId = parseHex(value);
          else if (key === 'serial') device.serial = value;
          else if (key === 'nickname') device.nickname = value;
          else if (key !== 'firmware') warn(`${path}: unknown divecomputerid key ${key}`);
        }
        settings.devices.push(device);
        break;
      }
      case 'fingerprint': {
        const fp = { model: 0, serial: 0, deviceId: 0, diveId: 0, data: '' };
        for (const { key, value } of parseKeyValues(kw.rest, strings)) {
          if (key === 'model') fp.model = parseHex(value);
          else if (key === 'serial') fp.serial = parseHex(value);
          else if (key === 'deviceid') fp.deviceId = parseHex(value);
          else if (key === 'diveid') fp.diveId = parseHex(value);
          else if (key === 'data') fp.data = value;
          else warn(`${path}: unknown fingerprint key ${key}`);
        }
        settings.fingerprints.push(fp);
        break;
      }
      default:
        warn(`${path}: unknown keyword "${kw.keyword}"`);
    }
  });
  return settings;
}
