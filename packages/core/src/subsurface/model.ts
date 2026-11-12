/**
 * In-memory model of a Subsurface logbook, close to Subsurface's own structures.
 *
 * Units follow Subsurface: lengths in mm, pressures in mbar, volumes in ml, weights in g,
 * temperatures in mK, gas fractions in permille, salinity in 0.1 g/l, times in seconds.
 * A value of 0 means "not set" wherever Subsurface treats it that way.
 *
 * Timestamps (`when`) are seconds since 1970 of the local wall-clock time, stored as if it were
 * UTC. That is how Subsurface stores them; there is no time zone.
 */

export interface Logbook {
  settings: Settings;
  sites: DiveSite[];
  /** Raw contents of 02-Filterpresets/Preset-NNN, in file order. Topside does not interpret them. */
  filterPresets: string[];
  trips: Trip[];
  /** All dives, sorted by time. Trip membership is `dive.trip`. */
  dives: Dive[];
}

export interface Settings {
  version: number;
  devices: DeviceEntry[];
  fingerprints: Fingerprint[];
  autogroup: boolean;
  /** Rest of the `units` line, e.g. "METRIC". Empty if the file has none. */
  units: string;
  /** `prefs` flags, e.g. "DCCEILING". */
  prefs: string[];
}

/** `divecomputerid` line: a dive computer the user gave a nickname. */
export interface DeviceEntry {
  model: string;
  /** Hash of the serial number. Kept as read; computed with deviceIdFromSerial() for new entries. */
  deviceId: number;
  serial: string;
  nickname: string;
}

/** `fingerprint` line: where the last download from a dive computer stopped. */
export interface Fingerprint {
  model: number;
  serial: number;
  deviceId: number;
  diveId: number;
  /** Hex-encoded fingerprint bytes */
  data: string;
}

export interface Location {
  /** micro-degrees */
  lat: number;
  /** micro-degrees */
  lon: number;
}

export interface Taxonomy {
  category: number;
  origin: number;
  value: string;
}

export interface DiveSite {
  uuid: number;
  name: string;
  description: string;
  notes: string;
  location: Location | null;
  taxonomy: Taxonomy[];
}

export interface Trip {
  location: string;
  notes: string;
}

export interface Cylinder {
  /** ml */
  volume: number;
  /** mbar */
  workPressure: number;
  description: string;
  /** permille, 0 = air */
  o2: number;
  /** permille */
  he: number;
  /** mbar */
  start: number;
  /** mbar */
  end: number;
  /** Index into CYLINDER_USE */
  use: number;
  /** mm */
  depth: number;
}

/** cylinderuse_text in core/equipment.cpp */
export const CYLINDER_USE = ['OC-gas', 'diluent', 'oxygen', 'not used', 'Travel Gas'] as const;

export interface Weightsystem {
  /** g */
  weight: number;
  description: string;
}

export interface Picture {
  /** Seconds from dive start; may be negative. */
  offset: number;
  filename: string;
  location: Location | null;
}

/** divemode_text in core/dive.cpp */
export const DIVE_MODES = ['OC', 'CCR', 'PSCR', 'Freedive'] as const;

/** libdivecomputer SAMPLE_EVENT_GASCHANGE and SAMPLE_EVENT_GASCHANGE2 */
export const GASCHANGE_EVENT_TYPES = [11, 25] as const;

export interface DiveEvent {
  /** s */
  time: number;
  type: number;
  flags: number;
  /** For "modechange" events: index into DIVE_MODES. */
  value: number;
  name: string;
  /** Gas changes only: cylinder index, -1 if none. */
  cylinder: number;
  /** Gas changes only, permille; used when the event has no valid cylinder. */
  o2: number;
  he: number;
}

export interface SamplePressure {
  sensor: number;
  /** mbar */
  mbar: number;
}

/**
 * One profile sample. Fields Subsurface carries over from the previous sample when the file does
 * not repeat them (ndl, tts, deco state, cns, sensors, setpoint, heartbeat, bearing) hold the full
 * value here. Temperature and tank pressures are only set where the file has a reading, which is
 * also how Subsurface keeps them after its fixups.
 */
export interface Sample {
  /** s */
  time: number;
  /** mm */
  depth: number;
  /** mK, 0 = no new reading */
  temperature: number;
  pressures: SamplePressure[];
  /** s, -1 = none */
  ndl: number;
  /** s */
  tts: number;
  inDeco: boolean;
  /** s */
  stoptime: number;
  /** mm */
  stopdepth: number;
  /** % */
  cns: number;
  /** s */
  rbt: number;
  /** mbar: sensor1–sensor6, then dc_supplied_ppo2 */
  o2sensor: number[];
  /** mbar, written as `po2` */
  setpoint: number;
  heartbeat: number;
  /** degrees, -1 = none */
  bearing: number;
}

export interface DiveComputer {
  model: string;
  /** s */
  lastManualTime: number;
  deviceId: number;
  diveId: number;
  when: number;
  /** s */
  duration: number;
  /** Index into DIVE_MODES */
  diveMode: number;
  o2Sensors: number;
  /** mm */
  maxDepth: number;
  /** mm */
  meanDepth: number;
  /** mK */
  airTemp: number;
  /** mK */
  waterTemp: number;
  /** mbar */
  surfacePressure: number;
  /** 0.1 g/l */
  salinity: number;
  /** s */
  surfaceTime: number;
  extraData: { key: string; value: string }[];
  tankSensorMappings: { sensorId: number; cylinderIndex: number }[];
  events: DiveEvent[];
  samples: Sample[];
}

export interface Dive {
  when: number;
  /** 0 = no number */
  number: number;
  trip: Trip | null;
  rating: number;
  visibility: number;
  wavesize: number;
  current: number;
  surge: number;
  chill: number;
  /** 0.1 g/l, 0 = not set */
  userSalinity: number;
  /** mbar, 0 = not set */
  airPressure: number;
  notrip: boolean;
  invalid: boolean;
  tags: string[];
  siteUuid: number | null;
  diveGuide: string;
  buddy: string;
  suit: string;
  notes: string;
  cylinders: Cylinder[];
  weightsystems: Weightsystem[];
  /** mK, set only when it differs from the dive computers' value */
  airTemp: number;
  /** mK, set only when it differs from the dive computers' value */
  waterTemp: number;
  /** At least one. The first one's duration is the dive's duration. */
  computers: DiveComputer[];
  pictures: Picture[];
}

export function newSample(time = 0): Sample {
  return {
    time,
    depth: 0,
    temperature: 0,
    pressures: [],
    ndl: -1,
    tts: 0,
    inDeco: false,
    stoptime: 0,
    stopdepth: 0,
    cns: 0,
    rbt: 0,
    o2sensor: [0, 0, 0, 0, 0, 0, 0],
    setpoint: 0,
    heartbeat: 0,
    bearing: -1,
  };
}

export function newDiveComputer(when = 0, duration = 0): DiveComputer {
  return {
    model: '',
    lastManualTime: 0,
    deviceId: 0,
    diveId: 0,
    when,
    duration,
    diveMode: 0,
    o2Sensors: 0,
    maxDepth: 0,
    meanDepth: 0,
    airTemp: 0,
    waterTemp: 0,
    surfacePressure: 0,
    salinity: 0,
    surfaceTime: 0,
    extraData: [],
    tankSensorMappings: [],
    events: [],
    samples: [],
  };
}

export function newDive(when: number): Dive {
  return {
    when,
    number: 0,
    trip: null,
    rating: 0,
    visibility: 0,
    wavesize: 0,
    current: 0,
    surge: 0,
    chill: 0,
    userSalinity: 0,
    airPressure: 0,
    notrip: false,
    invalid: false,
    tags: [],
    siteUuid: null,
    diveGuide: '',
    buddy: '',
    suit: '',
    notes: '',
    cylinders: [],
    weightsystems: [],
    airTemp: 0,
    waterTemp: 0,
    computers: [],
    pictures: [],
  };
}

export function newCylinder(): Cylinder {
  return { volume: 0, workPressure: 0, description: '', o2: 0, he: 0, start: 0, end: 0, use: 0, depth: 0 };
}

export function newEvent(time = 0): DiveEvent {
  return { time, type: 0, flags: 0, value: 0, name: '', cylinder: -1, o2: 0, he: 0 };
}

export function newSettings(): Settings {
  return { version: 3, devices: [], fingerprints: [], autogroup: false, units: '', prefs: [] };
}

export function isGasChange(event: DiveEvent): boolean {
  return (GASCHANGE_EVENT_TYPES as readonly number[]).includes(event.type);
}

/** dive_site::is_empty() */
export function isEmptySite(site: DiveSite): boolean {
  return !site.name && !site.description && !site.notes && !hasLocation(site.location);
}

/** has_location() */
export function hasLocation(location: Location | null): location is Location {
  return location !== null && (location.lat !== 0 || location.lon !== 0);
}
