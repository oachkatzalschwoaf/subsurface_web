# Subsurface git storage format

Subsurface has no official description of its git storage. This is what Topside implements,
derived from `core/save-git.cpp` and `core/load-git.cpp` (Subsurface commit `7f2610c`, November
2026) and checked byte for byte against real repositories. Code: `packages/core/src/subsurface/`.

## Repository

The Subsurface cloud is a git server. Each account has one repository; the branch is named after
the account e-mail. Every save is a commit with the full tree. Subsurface never force-pushes; it
merges when the remote moved on.

```
00-Subsurface                     settings
01-Divesites/Site-<uuid hex8>     one file per dive site
02-Filterpresets/Preset-<nnn>     saved filters (may be an empty directory)
<yyyy>/<mm>/<dd>-<Trip>/00-Trip   trip, in the year and month of its first dive
<yyyy>/<mm>/<dd>-<Trip>/<dive>/   dives of the trip
<yyyy>/<mm>/<dive>/               dives outside any trip
```

A dive directory is named `[[yyyy-]mm-]dd-Ddd-hh=mm=ss` (`Ddd` is the English weekday). The year and
month prefixes appear only when not all dives of the trip share the trip's year or month; then
every dive in that trip gets them. A trip directory is the day of month plus up to 15 ASCII letters
of the trip location, read up to the first `,` or `.` (`Lake Constance, Ü` gives `18-LakeConstance`),
or `trip` if fewer than two letters remain. When two dive or trip directories in one directory get
the same name (two trips of the same name starting on the same day), every one but the directory
written last gets `~` and the first 7 hex digits of its own git tree ID (`tree_insert()` in
`save-git.cpp`; Topside: `resolveCollisions()` in `serialize.ts`, IDs from `git-object.ts`).

Inside a dive directory:

```
Dive-<number>         dive data (`Dive` if the dive has no number)
Divecomputer          profile of the only dive computer, or
Divecomputer-001 …    one file per dive computer if there are several
Pictures/<±hh=mm=ss>  one file per picture, named by its offset from the dive start
```

## Lines and strings

Files are UTF-8 text, LF line endings. Each line starts with a lowercase keyword, except profile
samples. Strings are double-quoted; `\` escapes `"` and `\`. A newline inside a string is written
as newline plus tab, except when the next character is another newline. Control characters other
than tab, CR and LF become `?`. Empty strings are written out (`buddy ""`).

## Units

All numbers are integers in milli-units printed with three decimals, trailing zeros removed down
to one (`11759` mm → `11.759m`, `27000` → `27.0`). Temperatures are stored in millikelvin and
written in °C. Gas fractions are permille written as percent (`o2=32.0%`). Salinity is stored in
0.1 g/l and written in g/l. Durations are `m:ss`. Coordinates are decimal degrees with six digits.

Timestamps have no time zone: they are the local wall-clock time of the dive.

## Dive file

Fixed order; a line is omitted when its value is zero:

```
duration 43:34 min            from the first dive computer
rating 5 / visibility / wavesize / current / surge / chill
watersalinity 1025 g/l
airpressure 1013              mbar
notrip / invalid              flags
tags "Egypt", "Night"
divesiteid 0000abcd
divemaster "…"  buddy "…"  suit "…"  notes "…"     always written
cylinder vol=15.0l workpressure=232.0bar description="…" o2=32.0% start=200.0bar end=50.0bar
weightsystem weight=6.0kg description="…"
airtemp / watertemp           only when different from the dive computers
```

## Dive computer file

```
model "Fenix 8 Solar Large"   always written
lastmanualtime 5:00min
deviceid <hex8>               hash of the serial number
diveid <hex8>                 identifies the dive for duplicate detection
date / time                   only if different from the dive
duration 30:00min             only if different from the first dive computer
dctype CCR + numberofoxygensensors 3     only for non-OC dives
maxdepth / meandepth / airtemp / watertemp / surfacepressure / salinity / surfacetime
keyvalue "key" "value"        written without escaping
tanksensormapping "sensor" "cylinder"
event 38:26 type=26 flags=4 name="Safety stop begin"
  0:00 1.8m 27.0°C po2=0.25bar heartbeat=119
```

Sample lines start with the time, right-aligned to three digits for minutes, then the depth. All
other values are written only when they change from the previous sample: temperature, tank
pressure (`200.0bar:0`, with sensor index), `ndl`, `tts`, `in_deco`, `stoptime`, `stopdepth`,
`cns`, `rbt`, `sensor1`–`sensor6`, `dc_supplied_ppo2`, `po2`, `heartbeat`, `bearing`. A reader
carries values over from the previous sample, except temperature and tank pressure.

## Dive ID for Garmin FIT files

For dives imported from Garmin FIT files, the dive ID is the first 32-bit word (little endian) of
the SHA-1 of the fingerprint. The fingerprint is the FIT file name, zero-padded or cut to 24 bytes
(libdivecomputer `src/garmin.c`; Subsurface `core/libdivecomputer.cpp`). Example:
`12345678901_ACTIVITY.fit` → `2747eab0`.

## Settings, sites, trips, pictures

```
00-Subsurface   version 3 / divecomputerid "model" deviceid=… serial="…" nickname="…" /
                fingerprint model=… serial=… deviceid=… diveid=… data="<hex>" /
                autogroup / units METRIC / prefs DCCEILING
Site-<uuid>     name / description / notes (always) / gps <lat> <lon> / geo cat <n> origin <n> "value"
00-Trip         date / time of the first dive / location / notes (always)
Pictures/…      filename "…" / gps <lat> <lon>
```
