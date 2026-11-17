/**
 * Subsurface XML (.ssrf): writing follows core/save-xml.cpp, reading covers what it writes
 * (core/parse-xml.cpp, current format version 3). Legacy XML variants of older Subsurface
 * versions and other programs are not supported.
 *
 * Not carried over: filter presets (Topside keeps them only as raw git files) and the values
 * Subsurface computes on save and ignores on load (sac, otu, cns of a dive).
 */
import {
  comparePictures,
  CYLINDER_USE,
  DIVE_MODES,
  hasLocation,
  isEmptySite,
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
  type Sample,
  type Trip,
} from './model.ts';
import type { ParseResult } from './parse.ts';
import {
  atoi,
  formatDegrees,
  formatDuration,
  formatFraction,
  formatHex8,
  formatMilli,
  formatTemperature,
  fromParts,
  parseDegrees,
  parseDuration,
  parseFraction,
  parseHex,
  parseMilli,
  parseSalinity,
  parseTemperature,
  pad2,
  pad4,
  toTm,
} from './units.ts';

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** put_quoted(): control characters become '?', markup characters become entities. */
function escape(text: string, attribute: boolean): string {
  let out = '';
  for (const c of text) {
    const code = c.charCodeAt(0);
    if ((code > 0 && code < 9) || code === 11 || code === 12 || (code >= 14 && code <= 31)) out += '?';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '&') out += '&amp;';
    else if (c === "'" && attribute) out += '&apos;';
    else if (c === '"' && attribute) out += '&quot;';
    else out += c;
  }
  return out;
}

/** show_utf8(): trimmed; nothing at all when empty. */
function utf8(text: string, pre: string, post: string, attribute: boolean): string {
  const trimmed = text.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  return trimmed ? `${pre}${escape(trimmed, attribute)}${post}` : '';
}

const attr = (name: string, value: string) => utf8(value, ` ${name}='`, "'", true);
const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, ' ');
const dateAttrs = (when: number) => {
  const tm = toTm(when);
  return ` date='${pad4(tm.year)}-${pad2(tm.month)}-${pad2(tm.day)}' time='${pad2(tm.hour)}:${pad2(tm.minute)}:${pad2(tm.second)}'`;
};
const minutes = (seconds: number) => `${formatDuration(seconds >>> 0)} min`;
const gasmix = (o2: number, he: number) => (o2 ? ` o2='${formatFraction(o2)}'${he ? ` he='${formatFraction(he)}'` : ''}` : '');
const location = (name: string, loc: Location | null) =>
  hasLocation(loc) ? ` ${name}='${formatDegrees(loc.lat)} ${formatDegrees(loc.lon)}'` : '';

export interface XmlExportOptions {
  /** Export only these dives (and the sites and trips they use). Default: all. */
  dives?: readonly Dive[];
}

/** The logbook as Subsurface XML, ready to be saved as a .ssrf file. */
export function serializeXml(logbook: Logbook, options: XmlExportOptions = {}): string {
  const dives = [...(options.dives ?? logbook.dives)].sort((a, b) => a.when - b.when);
  const subset = options.dives !== undefined;
  const usedSites = new Set(dives.map((d) => d.siteUuid));

  let b = "<divelog program='subsurface' version='3'>\n<settings>\n";
  for (const d of logbook.settings.devices) {
    if (!d.nickname || !d.serial || d.model === d.nickname) continue;
    b += `<divecomputerid${attr('model', d.model)} deviceid='${formatHex8(d.deviceId)}'${attr('serial', d.serial)}${attr('nickname', d.nickname)}/>\n`;
  }
  for (const fp of logbook.settings.fingerprints) {
    b += `<fingerprint model='${formatHex8(fp.model)}' serial='${formatHex8(fp.serial)}' deviceid='${formatHex8(fp.deviceId)}' diveid='${formatHex8(fp.diveId)}' data='${fp.data}'/>\n`;
  }
  if (logbook.settings.autogroup) b += "  <autogroup state='1' />\n";
  b += '</settings>\n<divesites>\n';
  for (const site of logbook.sites) {
    if (isEmptySite(site)) continue;
    if (subset && !usedSites.has(site.uuid)) continue;
    b += serializeSite(site);
  }
  b += '</divesites>\n<dives>\n';

  const savedTrips = new Set<Trip>();
  for (const dive of dives) {
    const trip = dive.trip;
    if (!trip) {
      b += serializeDive(logbook, dive);
      continue;
    }
    if (savedTrips.has(trip)) continue;
    savedTrips.add(trip);
    const tripDives = dives.filter((d) => d.trip === trip);
    b += `<trip${dateAttrs(tripDives[0]!.when)}${attr('location', trip.location)}>\n`;
    b += utf8(trip.notes, '<notes>', '</notes>\n', false);
    for (const d of tripDives) b += serializeDive(logbook, d);
    b += '</trip>\n';
  }
  return `${b}</dives>\n</divelog>\n`;
}

function serializeSite(site: DiveSite): string {
  let b = `<site uuid='${hex8(site.uuid)}'${attr('name', site.name)}${location('gps', site.location)}${attr('description', site.description)}>\n`;
  b += utf8(site.notes, '  <notes>', ' </notes>\n', false);
  for (const t of site.taxonomy) {
    if (t.category !== 0 && t.value) b += `  <geo cat='${t.category}' origin='${t.origin}'${attr('value', t.value)}/>\n`;
  }
  return `${b}</site>\n`;
}

function serializeDive(logbook: Logbook, dive: Dive): string {
  let b = '<dive';
  if (dive.number) b += ` number='${dive.number}'`;
  if (dive.notrip) b += " tripflag='NOTRIP'";
  for (const [name, value] of [
    ['rating', dive.rating],
    ['visibility', dive.visibility],
    ['wavesize', dive.wavesize],
    ['current', dive.current],
    ['surge', dive.surge],
    ['chill', dive.chill],
  ] as const) {
    if (value) b += ` ${name}='${value}'`;
  }
  if (dive.invalid) b += " invalid='1'";
  if (dive.tags.length) b += ` tags='${dive.tags.map((t) => escape(t, true)).join(', ')}'`;
  if (dive.siteUuid !== null && logbook.sites.some((s) => s.uuid === dive.siteUuid)) b += ` divesiteid='${hex8(dive.siteUuid)}'`;
  if (dive.userSalinity) b += ` watersalinity='${Math.trunc(dive.userSalinity / 10)} g/l'`;
  b += dateAttrs(dive.when);
  if (dive.airPressure) b += ` airpressure='${formatMilli(dive.airPressure)} bar'`;
  const duration = dive.computers[0]?.duration ?? 0;
  b += duration > 0 ? ` duration='${formatDuration(duration)} min'>\n` : '>\n';

  b += utf8(dive.diveGuide, '  <divemaster>', '</divemaster>\n', false);
  b += utf8(dive.buddy, '  <buddy>', '</buddy>\n', false);
  b += utf8(dive.notes, '  <notes>', '</notes>\n', false);
  b += utf8(dive.suit, '  <suit>', '</suit>\n', false);
  for (const c of dive.cylinders) {
    b += '  <cylinder';
    if (c.volume) b += ` size='${formatMilli(c.volume)} l'`;
    if (c.workPressure) b += ` workpressure='${formatMilli(c.workPressure)} bar'`;
    b += attr('description', c.description) + gasmix(c.o2, c.he);
    if (c.start) b += ` start='${formatMilli(c.start)} bar'`;
    if (c.end) b += ` end='${formatMilli(c.end)} bar'`;
    if (c.use > 0 && c.use < CYLINDER_USE.length) b += attr('use', CYLINDER_USE[c.use]!);
    if (c.depth) b += ` depth='${formatMilli(c.depth)} m'`;
    b += ' />\n';
  }
  for (const w of dive.weightsystems) b += `  <weightsystem weight='${formatMilli(w.weight)} kg'${attr('description', w.description)} />\n`;
  if (dive.airTemp || dive.waterTemp) {
    b += '  <divetemperature';
    if (dive.airTemp) b += ` air='${formatTemperature(dive.airTemp)} C'`;
    if (dive.waterTemp) b += ` water='${formatTemperature(dive.waterTemp)} C'`;
    b += '/>\n';
  }
  for (const dc of dive.computers) b += serializeComputer(dive, dc);
  for (const p of dive.pictures) {
    b += `  <picture filename='${escape(p.filename, true)}'`;
    if (p.offset) b += ` offset='${p.offset < 0 ? '-' : '+'}${formatDuration(Math.abs(p.offset))} min'`;
    b += `${location('gps', p.location)}/>\n`;
  }
  return `${b}</dive>\n`;
}

function serializeComputer(dive: Dive, dc: DiveComputer): string {
  let b = `  <divecomputer${attr('model', dc.model)}`;
  if (dc.lastManualTime) b += ` last-manual-time='${minutes(dc.lastManualTime)}'`;
  if (dc.deviceId) b += ` deviceid='${formatHex8(dc.deviceId)}'`;
  if (dc.diveId) b += ` diveid='${formatHex8(dc.diveId)}'`;
  if (dc.when && dc.when !== dive.when) b += dateAttrs(dc.when);
  if (dc.duration && dc.duration !== dive.computers[0]?.duration) b += ` duration='${minutes(dc.duration)}'`;
  if (dc.diveMode !== 0) {
    b += attr('dctype', DIVE_MODES[dc.diveMode] ?? '');
    if (dc.o2Sensors) b += ` no_o2sensors='${dc.o2Sensors}'`;
  }
  b += '>\n';
  if (dc.maxDepth || dc.meanDepth) {
    b += '  <depth';
    if (dc.maxDepth) b += ` max='${formatMilli(dc.maxDepth)} m'`;
    if (dc.meanDepth) b += ` mean='${formatMilli(dc.meanDepth)} m'`;
    b += ' />\n';
  }
  if (dc.airTemp || dc.waterTemp) {
    b += '  <temperature';
    if (dc.airTemp) b += ` air='${formatTemperature(dc.airTemp)} C'`;
    if (dc.waterTemp) b += ` water='${formatTemperature(dc.waterTemp)} C'`;
    b += ' />\n';
  }
  if (dc.surfacePressure) b += `  <surface pressure='${formatMilli(dc.surfacePressure)} bar' />\n`;
  if (dc.salinity) b += `  <water salinity='${Math.trunc(dc.salinity / 10)} g/l' />\n`;
  if (dc.surfaceTime) b += `  <surfacetime>${minutes(dc.surfaceTime)}</surfacetime>\n`;
  for (const { key, value } of dc.extraData) if (key && value) b += `  <extradata${attr('key', key)}${attr('value', value)} />\n`;
  for (const m of dc.tankSensorMappings) b += `  <tanksensormapping sensorid='${m.sensorId}' cylinderindex='${m.cylinderIndex}' />\n`;
  for (const ev of dc.events) {
    b += `  <event time='${Math.floor(ev.time / 60)}:${pad2(ev.time % 60)} min'`;
    if (ev.type) b += ` type='${ev.type}'`;
    if (ev.flags) b += ` flags='${ev.flags}'`;
    if (ev.name === 'modechange') b += attr('divemode', DIVE_MODES[ev.value] ?? '');
    else if (ev.value) b += ` value='${ev.value}'`;
    b += attr('name', ev.name);
    if (isGasChange(ev)) {
      const cyl = ev.cylinder >= 0 ? dive.cylinders[ev.cylinder] : undefined;
      if (ev.cylinder >= 0) b += ` cylinder='${ev.cylinder}'`;
      b += cyl ? gasmix(cyl.o2, cyl.he) : gasmix(ev.o2, ev.he);
    }
    b += ' />\n';
  }
  b += serializeSamples(dc.samples);
  return `${b}  </divecomputer>\n`;
}

/** save_sample() of save-xml.cpp: like the git format, most values only when they change. */
function serializeSamples(samples: readonly Sample[]): string {
  const old = { ...newSample(), o2sensor: [0, 0, 0, 0, 0, 0, 0] };
  const oldSensor: number[] = [];
  const oldPressure: number[] = [];
  let b = '';
  for (const s of samples) {
    let line = `  <sample time='${minutes(s.time)}' depth='${formatMilli(s.depth)} m'`;
    if (s.temperature && s.temperature !== old.temperature) {
      line += ` temp='${formatTemperature(s.temperature)} C'`;
      old.temperature = s.temperature;
    }
    s.pressures.forEach((p, idx) => {
      if (p.sensor === -1 || !p.mbar || (oldSensor[idx] === p.sensor && oldPressure[idx] === p.mbar)) return;
      line += ` pressure${p.sensor}='${formatMilli(p.mbar)} bar'`;
      oldSensor[idx] = p.sensor;
      oldPressure[idx] = p.mbar;
    });
    if (s.ndl !== old.ndl) line += ` ndl='${minutes((old.ndl = s.ndl))}'`;
    if (s.tts !== old.tts) line += ` tts='${minutes((old.tts = s.tts))}'`;
    if (s.rbt !== old.rbt) line += ` rbt='${minutes((old.rbt = s.rbt))}'`;
    if (s.inDeco !== old.inDeco) line += ` in_deco='${(old.inDeco = s.inDeco) ? 1 : 0}'`;
    if (s.stoptime !== old.stoptime) line += ` stoptime='${minutes((old.stoptime = s.stoptime))}'`;
    if (s.stopdepth !== old.stopdepth) line += ` stopdepth='${formatMilli((old.stopdepth = s.stopdepth))} m'`;
    if (s.cns !== old.cns) line += ` cns='${(old.cns = s.cns)}%'`;
    for (let i = 0; i <= 6; i++) {
      const v = s.o2sensor[i] ?? 0;
      if (v && v !== old.o2sensor[i]) {
        line += ` ${i === 6 ? 'dc_supplied_ppo2' : `sensor${i + 1}`}='${formatMilli(v)} bar'`;
        old.o2sensor[i] = v;
      }
    }
    if (s.setpoint !== old.setpoint) line += ` po2='${formatMilli((old.setpoint = s.setpoint))} bar'`;
    if (s.heartbeat !== old.heartbeat) {
      if (s.heartbeat) line += ` heartbeat='${s.heartbeat}'`;
      old.heartbeat = s.heartbeat;
    }
    if (s.bearing !== old.bearing) {
      if (s.bearing) line += ` bearing='${s.bearing}'`;
      old.bearing = s.bearing;
    }
    b += `${line} />\n`;
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

interface XmlElement {
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** A small, strict-enough XML reader for the element/attribute/text subset Subsurface writes. */
export function parseXmlTree(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: new Map(), children: [], text: '' };
  const stack = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:'[^']*'|"[^"]*"))*)\s*(\/?)>/g;
  const attrRe = /([\w.:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
  let pos = 0;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const current = stack[stack.length - 1]!;
    current.text += decodeEntities(source.slice(pos, m.index));
    pos = tag.lastIndex;
    if (m[1] !== undefined) {
      current.text += m[1];
      continue;
    }
    if (!m[3]) continue; // comment or declaration
    if (m[2] === '/') {
      if (current.name !== m[3]) throw new Error(`XML: unexpected </${m[3]}>`);
      stack.pop();
      continue;
    }
    const element: XmlElement = { name: m[3], attrs: new Map(), children: [], text: '' };
    for (let a = attrRe.exec(m[4] ?? ''); a; a = attrRe.exec(m[4] ?? '')) element.attrs.set(a[1]!, decodeEntities(a[2] ?? a[3] ?? ''));
    attrRe.lastIndex = 0;
    current.children.push(element);
    if (m[5] !== '/') stack.push(element);
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1]!.name}> is not closed`);
  return root;
}

const child = (e: XmlElement, name: string) => e.children.find((c) => c.name === name);
const children = (e: XmlElement, name: string) => e.children.filter((c) => c.name === name);

function parseWhen(e: XmlElement, fallback = 0): number {
  const date = /^(\d+)-(\d+)-(\d+)/.exec(e.attrs.get('date') ?? '');
  if (!date) return fallback;
  const time = /^(\d+):(\d+)(?::(\d+))?/.exec(e.attrs.get('time') ?? '') ?? ['', '0', '0', '0'];
  return fromParts(Number(date[1]), Number(date[2]), Number(date[3]), Number(time[1]), Number(time[2]), Number(time[3] ?? 0));
}

function parseGps(text: string | undefined): Location | null {
  if (!text) return null;
  const [lat = '', lon = ''] = text.trim().split(/[\s,]+/);
  return { lat: parseDegrees(lat), lon: parseDegrees(lon) };
}

/** Read a Subsurface .ssrf / XML file. */
export function parseXml(source: string): ParseResult {
  const warnings: string[] = [];
  const root = parseXmlTree(source.replace(/\r\n/g, '\n'));
  const log = child(root, 'divelog');
  if (!log) throw new Error('Not a Subsurface file (no <divelog>)');
  const version = atoi(log.attrs.get('version') ?? '0');
  if (version !== 3) warnings.push(`File format version ${version} is not supported`);

  const settings = newSettings();
  const settingsEl = child(log, 'settings');
  for (const e of settingsEl?.children ?? []) {
    if (e.name === 'divecomputerid') {
      settings.devices.push({
        model: e.attrs.get('model') ?? '',
        deviceId: parseHex(e.attrs.get('deviceid') ?? ''),
        serial: e.attrs.get('serial') ?? '',
        nickname: e.attrs.get('nickname') ?? '',
      });
    } else if (e.name === 'fingerprint') {
      settings.fingerprints.push({
        model: parseHex(e.attrs.get('model') ?? ''),
        serial: parseHex(e.attrs.get('serial') ?? ''),
        deviceId: parseHex(e.attrs.get('deviceid') ?? ''),
        diveId: parseHex(e.attrs.get('diveid') ?? ''),
        data: e.attrs.get('data') ?? '',
      });
    } else if (e.name === 'autogroup') {
      settings.autogroup = e.attrs.get('state') === '1';
    } else {
      warnings.push(`settings: <${e.name}> ignored`);
    }
  }
  settings.units = 'METRIC';
  settings.prefs = [];

  const sites: DiveSite[] = [];
  for (const e of children(child(log, 'divesites') ?? root, 'site')) {
    sites.push({
      uuid: parseHex(e.attrs.get('uuid') ?? ''),
      name: e.attrs.get('name') ?? '',
      description: e.attrs.get('description') ?? '',
      notes: (child(e, 'notes')?.text ?? '').replace(/ $/, ''),
      location: parseGps(e.attrs.get('gps')),
      taxonomy: children(e, 'geo').map((g) => ({
        category: atoi(g.attrs.get('cat') ?? '0'),
        origin: atoi(g.attrs.get('origin') ?? '0'),
        value: g.attrs.get('value') ?? '',
      })),
    });
  }

  const trips: Trip[] = [];
  const dives: Dive[] = [];
  for (const e of child(log, 'dives')?.children ?? []) {
    if (e.name === 'dive') dives.push(parseDiveElement(e, null, warnings));
    else if (e.name === 'trip') {
      const trip: Trip = { location: e.attrs.get('location') ?? '', notes: child(e, 'notes')?.text ?? '' };
      trips.push(trip);
      for (const d of children(e, 'dive')) dives.push(parseDiveElement(d, trip, warnings));
    } else if (e.name !== 'filterpresets') {
      warnings.push(`dives: <${e.name}> ignored`);
    }
  }
  dives.sort((a, b) => a.when - b.when);
  return { logbook: { settings, sites, filterPresets: [], trips, dives }, warnings };
}

function parseDiveElement(e: XmlElement, trip: Trip | null, warnings: string[]): Dive {
  const dive = newDive(parseWhen(e));
  const a = e.attrs;
  dive.trip = trip;
  dive.number = atoi(a.get('number') ?? '0');
  dive.notrip = a.get('tripflag') === 'NOTRIP';
  dive.rating = atoi(a.get('rating') ?? '0');
  dive.visibility = atoi(a.get('visibility') ?? '0');
  dive.wavesize = atoi(a.get('wavesize') ?? '0');
  dive.current = atoi(a.get('current') ?? '0');
  dive.surge = atoi(a.get('surge') ?? '0');
  dive.chill = atoi(a.get('chill') ?? '0');
  dive.invalid = a.get('invalid') === '1';
  dive.tags = (a.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  dive.siteUuid = a.has('divesiteid') ? parseHex(a.get('divesiteid')!) : null;
  dive.userSalinity = a.has('watersalinity') ? parseSalinity(a.get('watersalinity')!) : 0;
  dive.airPressure = a.has('airpressure') ? parseMilli(a.get('airpressure')!) : 0;
  const duration = parseDuration(a.get('duration') ?? '');

  for (const c of e.children) {
    switch (c.name) {
      case 'divemaster': dive.diveGuide = c.text; break;
      case 'buddy': dive.buddy = c.text; break;
      case 'notes': dive.notes = c.text; break;
      case 'suit': dive.suit = c.text; break;
      case 'cylinder': {
        const cyl = newCylinder();
        const ca = c.attrs;
        cyl.volume = ca.has('size') ? parseMilli(ca.get('size')!) : 0;
        cyl.workPressure = ca.has('workpressure') ? parseMilli(ca.get('workpressure')!) : 0;
        cyl.description = ca.get('description') ?? '';
        cyl.o2 = ca.has('o2') ? parseFraction(ca.get('o2')!) : 0;
        cyl.he = ca.has('he') ? parseFraction(ca.get('he')!) : 0;
        cyl.start = ca.has('start') ? parseMilli(ca.get('start')!) : 0;
        cyl.end = ca.has('end') ? parseMilli(ca.get('end')!) : 0;
        cyl.use = Math.max(0, (CYLINDER_USE as readonly string[]).indexOf(ca.get('use') ?? 'OC-gas'));
        cyl.depth = ca.has('depth') ? parseMilli(ca.get('depth')!) : 0;
        dive.cylinders.push(cyl);
        break;
      }
      case 'weightsystem':
        dive.weightsystems.push({ weight: parseMilli(c.attrs.get('weight') ?? '0'), description: c.attrs.get('description') ?? '' });
        break;
      case 'divetemperature':
        if (c.attrs.has('air')) dive.airTemp = parseTemperature(c.attrs.get('air')!);
        if (c.attrs.has('water')) dive.waterTemp = parseTemperature(c.attrs.get('water')!);
        break;
      case 'divecomputer': dive.computers.push(parseComputerElement(c, dive, duration, warnings)); break;
      case 'picture': {
        const m = /^([+-])?(\d+):(\d+)/.exec(c.attrs.get('offset') ?? '');
        const seconds = m ? Number(m[2]) * 60 + Number(m[3]) : 0;
        dive.pictures.push({
          offset: m?.[1] === '-' ? -seconds : seconds,
          filename: c.attrs.get('filename') ?? '',
          location: parseGps(c.attrs.get('gps')),
        });
        break;
      }
      default: warnings.push(`dive: <${c.name}> ignored`);
    }
  }
  if (dive.computers.length === 0) dive.computers.push(newDiveComputer(dive.when, duration));
  dive.pictures.sort(comparePictures);
  return dive;
}

function parseComputerElement(e: XmlElement, dive: Dive, diveDuration: number, warnings: string[]): DiveComputer {
  const a = e.attrs;
  const dc = newDiveComputer(dive.when, diveDuration);
  dc.model = a.get('model') ?? '';
  dc.lastManualTime = parseDuration(a.get('last-manual-time') ?? '');
  dc.deviceId = parseHex(a.get('deviceid') ?? '');
  dc.diveId = parseHex(a.get('diveid') ?? '');
  if (a.has('date')) dc.when = parseWhen(e, dive.when);
  if (a.has('duration')) dc.duration = parseDuration(a.get('duration')!);
  dc.diveMode = Math.max(0, (DIVE_MODES as readonly string[]).indexOf(a.get('dctype') ?? 'OC'));
  dc.o2Sensors = atoi(a.get('no_o2sensors') ?? '0');
  const defaultSensor = dive.cylinders.length > 0 ? 0 : -1;

  for (const c of e.children) {
    const ca = c.attrs;
    switch (c.name) {
      case 'depth':
        dc.maxDepth = ca.has('max') ? parseMilli(ca.get('max')!) : 0;
        dc.meanDepth = ca.has('mean') ? parseMilli(ca.get('mean')!) : 0;
        break;
      case 'temperature':
        dc.airTemp = ca.has('air') ? parseTemperature(ca.get('air')!) : 0;
        dc.waterTemp = ca.has('water') ? parseTemperature(ca.get('water')!) : 0;
        break;
      case 'surface': dc.surfacePressure = parseMilli(ca.get('pressure') ?? '0'); break;
      case 'water': dc.salinity = parseSalinity(ca.get('salinity') ?? '0'); break;
      case 'surfacetime': dc.surfaceTime = parseDuration(c.text); break;
      case 'extradata': dc.extraData.push({ key: ca.get('key') ?? '', value: ca.get('value') ?? '' }); break;
      case 'tanksensormapping':
        dc.tankSensorMappings.push({ sensorId: atoi(ca.get('sensorid') ?? '0'), cylinderIndex: atoi(ca.get('cylinderindex') ?? '0') });
        break;
      case 'event': {
        const ev = newEvent(parseDuration(ca.get('time') ?? ''));
        ev.type = atoi(ca.get('type') ?? '0');
        ev.flags = atoi(ca.get('flags') ?? '0');
        ev.value = atoi(ca.get('value') ?? '0');
        ev.name = ca.get('name') ?? '';
        if (ca.has('divemode')) {
          ev.name = 'modechange';
          ev.value = Math.max(0, (DIVE_MODES as readonly string[]).indexOf(ca.get('divemode')!));
        }
        if (isGasChange(ev)) {
          ev.cylinder = ca.has('cylinder') ? atoi(ca.get('cylinder')!) : -1;
          ev.o2 = ca.has('o2') ? parseFraction(ca.get('o2')!) : 0;
          ev.he = ca.has('he') ? parseFraction(ca.get('he')!) : 0;
        }
        dc.events.push(ev);
        break;
      }
      case 'sample': {
        const previous = dc.samples[dc.samples.length - 1];
        const s: Sample = previous ? { ...structuredClone(previous), temperature: 0, pressures: [] } : newSample();
        for (const [key, value] of ca) {
          if (key === 'time') s.time = parseDuration(value);
          else if (key === 'depth') s.depth = parseMilli(value);
          else if (key === 'temp') s.temperature = parseTemperature(value);
          else if (key.startsWith('pressure')) s.pressures.push({ sensor: key === 'pressure' ? defaultSensor : atoi(key.slice(8)), mbar: parseMilli(value) });
          else if (key === 'ndl') s.ndl = parseDuration(value);
          else if (key === 'tts') s.tts = parseDuration(value);
          else if (key === 'rbt') s.rbt = parseDuration(value);
          else if (key === 'in_deco') s.inDeco = atoi(value) !== 0;
          else if (key === 'stoptime') s.stoptime = parseDuration(value);
          else if (key === 'stopdepth') s.stopdepth = parseMilli(value);
          else if (key === 'cns') s.cns = atoi(value);
          else if (key === 'po2') s.setpoint = parseMilli(value);
          else if (key === 'heartbeat') s.heartbeat = atoi(value);
          else if (key === 'bearing') s.bearing = atoi(value);
          else if (key === 'dc_supplied_ppo2') s.o2sensor[6] = parseMilli(value);
          else if (/^sensor[1-6]$/.test(key)) s.o2sensor[Number(key[6]) - 1] = parseMilli(value);
          else warnings.push(`sample: attribute ${key} ignored`);
        }
        dc.samples.push(s);
        break;
      }
      default: warnings.push(`divecomputer: <${c.name}> ignored`);
    }
  }
  // XML stores only temperature changes; the samples above already hold explicit readings only.
  return dc;
}
