import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  activityIdFromName,
  decodeFit,
  extractFitFiles,
  findSameDive,
  formatDiveId,
  garminDiveId,
  importFit,
  newDive,
  newDiveComputer,
  NotADiveError,
  serializeDiveComputer,
} from '../src/index.ts';
import { buildFit, type FitTestMessage } from './helpers/fit-builder.ts';

/** FIT time of 2026-05-13 01:19:30 UTC; the dive is at 09:19:30 local time (UTC+8). */
const START = Date.UTC(2026, 4, 13, 1, 19, 30) / 1000 - 631065600;
const TS = 253;

const record = (offset: number, depth: number, extra: FitTestMessage['fields'] = []): FitTestMessage => ({
  global: 20,
  fields: [[TS, 'uint32', START + offset], [92, 'uint32', depth], ...extra],
});

const diveFile: FitTestMessage[] = [
  { global: 0, fields: [[0, 'enum', 4], [1, 'uint16', 1], [2, 'uint16', 4533], [3, 'uint32z', 123456], [4, 'uint32', START]] },
  { global: 23, fields: [[0, 'uint8', 0], [3, 'uint32z', 123456], [4, 'uint16', 4533]] },
  { global: 258, fields: [[4, 'enum', 1]] },
  { global: 259, fields: [[0, 'uint8', 0], [1, 'uint8', 32], [2, 'enum', 1]] },
  record(0, 1500, [[13, 'sint8', 27], [3, 'uint8', 100], [129, 'uint8', 37]]),
  record(1, 3000, [[13, 'sint8', 27], [3, 'uint8', 100], [96, 'uint32', 5940], [95, 'uint32', 20], [97, 'uint8', 1]]),
  record(2, 12345, [[13, 'sint8', 26], [3, 'uint8', 104], [96, 'uint32', 5880]]),
  record(3, 500, [[13, 'sint8', 26], [0, 'sint32', 0x13000000], [1, 'sint32', 0x18000000]]),
  { global: 21, fields: [[TS, 'uint32', START - 5], [0, 'enum', 56], [3, 'uint32', 22]] }, // before the start: ignored
  { global: 21, fields: [[TS, 'uint32', START + 1], [0, 'enum', 56], [3, 'uint32', 17]] },
  { global: 21, fields: [[TS, 'uint32', START + 2], [0, 'enum', 56], [3, 'uint32', 22]] },
  { global: 21, fields: [[TS, 'uint32', START + 3], [0, 'enum', 56], [3, 'uint32', 22]] }, // repeated within 60 s
  { global: 21, fields: [[TS, 'uint32', START + 3], [0, 'enum', 0], [3, 'uint32', 0]] }, // timer event: ignored
  { global: 18, fields: [[TS, 'uint32', START + 3], [2, 'uint32', START], [5, 'enum', 53], [7, 'uint32', 4000]] },
  { global: 268, fields: [[0, 'uint16', 18], [2, 'uint32', 4336], [3, 'uint32', 12345], [11, 'uint32', 2600]] },
  { global: 34, fields: [[TS, 'uint32', START + 3], [5, 'uint32', START + 3 + 8 * 3600]] },
];

describe('importFit', () => {
  it('turns a dive activity into a Subsurface dive', async () => {
    const result = await importFit(buildFit(diveFile), '12345678901_ACTIVITY.fit');
    const { dive } = result;

    expect(result.utcOffset).toBe(8 * 3600);
    expect(new Date(dive.when * 1000).toISOString()).toBe('2026-05-13T09:19:30.000Z');
    expect(result.activityId).toBe('12345678901');
    expect(result.manualEntry).toBe(false);
    expect(result.exit).toEqual(result.entry);
    expect(result.entry!.lat).toBeCloseTo(26718750, -1);
    expect(dive.cylinders).toMatchObject([{ o2: 320, he: 0 }]);

    expect(serializeDiveComputer(dive, dive.computers[0]!)).toBe(
      [
        'model "Fenix 8 Solar Large"',
        'diveid 2747eab0',
        'maxdepth 12.345m',
        'meandepth 4.336m',
        'watertemp 26.0°C',
        'salinity 1025g/l',
        'keyvalue "Garmin Connect" "12345678901"',
        'event 0:01 type=26 flags=12 name="Ascent speed critical"',
        'event 0:02 type=26 flags=4 name="Safety stop begin"',
        '  0:00 1.5m 27.0°C po2=0.37bar heartbeat=100',
        '  0:01 3.0m ndl=99:00 tts=0:20 cns=1%',
        '  0:02 12.345m 26.0°C ndl=98:00 heartbeat=104',
        '  0:03 0.5m',
        '',
      ].join('\n'),
    );
    expect(dive.computers[0]!.duration).toBe(3);
  });

  it('uses the file name for the dive ID when there is no activity ID', async () => {
    const { dive, activityId } = await importFit(buildFit(diveFile), '2026-05-13-09-19-30.fit');
    expect(activityId).toBeNull();
    expect(dive.computers[0]!.diveId).toBe(await garminDiveId('2026-05-13-09-19-30.fit'));
    expect(dive.computers[0]!.extraData).toEqual([]);
  });

  it('rejects activities that are not dives', async () => {
    const run = buildFit([
      { global: 0, fields: [[0, 'enum', 4]] },
      { global: 18, fields: [[2, 'uint32', START], [5, 'enum', 1]] },
    ]);
    await expect(importFit(run, 'run.fit')).rejects.toBeInstanceOf(NotADiveError);
  });

  it('rejects files that are not FIT', () => {
    expect(() => decodeFit(new TextEncoder().encode('this is not a FIT file'))).toThrow('Not a FIT file');
  });
});

describe('extractFitFiles', () => {
  it('reads a Garmin Connect ZIP export', () => {
    const fit = buildFit(diveFile);
    const zip = zipSync({ '12345678901_ACTIVITY.fit': fit, 'readme.txt': new Uint8Array([1]) });
    const files = extractFitFiles('12345678901.zip', zip);
    expect(files.map((f) => [f.name, f.activityId])).toEqual([['12345678901_ACTIVITY.fit', '12345678901']]);
    expect(files[0]!.bytes).toEqual(fit);
  });

  it('finds the activity ID in renamed files', () => {
    expect(activityIdFromName('23_Trip_1_Some-Reef_24000000001.fit')).toBe('24000000001');
    expect(activityIdFromName('2026-05-13-09-19-30.fit')).toBeNull();
  });
});

describe('findSameDive', () => {
  const existing = newDive(1_000_000);
  existing.computers.push({ ...newDiveComputer(), diveId: 0xabc });

  it('matches by dive ID or by start time', () => {
    const byId = newDive(5_000_000);
    byId.computers.push({ ...newDiveComputer(), diveId: 0xabc });
    const byTime = newDive(1_000_030);
    byTime.computers.push({ ...newDiveComputer(), diveId: 0xdef });
    const other = newDive(1_000_500);
    other.computers.push(newDiveComputer());

    expect(findSameDive([existing], byId)).toBe(existing);
    expect(findSameDive([existing], byTime)).toBe(existing);
    expect(findSameDive([existing], other)).toBeNull();
    expect(formatDiveId(0xabc)).toBe('00000abc');
  });
});
