import { describe, expect, it } from 'vitest';
import { logStats, parseLogbook, searchDives } from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;

describe('logbook statistics', () => {
  it('sums up valid dives, with records, years and trips', () => {
    const logbook = load();
    const [one, two, three] = logbook.dives;
    // dive 3 is marked invalid in the fixture and does not count
    expect(three!.invalid).toBe(true);
    const s = logStats(logbook);
    expect(s.dives).toBe(2);
    expect(s.seconds).toBe(one!.computers[0]!.duration + two!.computers[0]!.duration);
    expect(s.deepest?.dive).toBe(s.maxDepth === one!.computers[0]!.maxDepth ? one : two);
    expect(s.longest?.dive).toBe(one);
    expect(s.sac).toBe(22830);
    expect(s.sites).toBe(1);
    expect(s.years).toEqual([{ year: 2026, dives: 2, seconds: s.seconds, maxDepth: s.maxDepth }]);
    expect(s.trips).toHaveLength(1);
    expect(s.trips[0]).toMatchObject({ dives: 2, first: one!.when, last: two!.when });
    expect(s.trips[0]!.trip.location).toBe('Test Trip, Somewhere');
  });

  it('is empty for no dives', () => {
    const logbook = load();
    expect(logStats(logbook, [])).toMatchObject({ dives: 0, seconds: 0, deepest: null, meanDepth: null, sac: null, years: [], trips: [] });
  });
});

describe('search', () => {
  it('finds dives by site, people, tags, notes, trip and number', () => {
    const logbook = load();
    const numbers = (q: string) => searchDives(logbook, q).map((d) => d.number);
    expect(numbers('')).toEqual([1, 2, 3]);
    expect(numbers('lake spot')).toEqual([1, 2]);
    expect(numbers('SAM training')).toEqual([1]);
    expect(numbers('solo')).toEqual([3]);
    expect(numbers('somewhere')).toEqual([1, 2]);
    expect(numbers('#2')).toEqual([2]);
    expect(numbers('3')).toEqual([3]);
    expect(numbers('lake nothing')).toEqual([]);
  });
});
