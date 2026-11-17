import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  exifDate,
  flattenTree,
  mergeEdits,
  parseLogbook,
  pictureFileName,
  pictureOffset,
  safeFileName,
  serializeLogbook,
  serializeXml,
  type DiveEdit,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;
const original = flattenTree(treeFromObject(sampleRepo));
const at = (localIso: string) => Date.parse(`${localIso}Z`) / 1000;
const WHEN1 = at('2026-04-26T10:13:05');
const WHEN2 = at('2026-05-01T11:31:26');
const DIR1 = '2026/04/26-TestTrip/04-26-Sun-10=13=05';
const DIR2 = '2026/04/26-TestTrip/05-01-Fri-11=31=26';

/** A minimal JPEG with an Exif block: DateTimeOriginal in the Exif IFD, or DateTime in IFD0. */
function jpeg(date: string, { inIfd0 = false, bigEndian = false } = {}): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (bigEndian ? [v >> 8, v & 255] : [v & 255, v >> 8]);
  const u32 = (v: number) => (bigEndian ? [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24]);
  const text = [...date].map((c) => c.charCodeAt(0)).concat(0);
  tiff.push(...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8));
  if (inIfd0) {
    // IFD0 at 8: one entry DateTime (0x0132), string at 26
    tiff.push(...u16(1), ...u16(0x0132), ...u16(2), ...u32(text.length), ...u32(26), ...u32(0), ...text);
  } else {
    // IFD0 at 8: Exif pointer to 26; Exif IFD at 26: DateTimeOriginal, string at 44
    tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
    tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(text.length), ...u32(44), ...u32(0), ...text);
  }
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  // an APP0 block first, as cameras write it
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, length >> 8, length & 255, ...app1, 0xff, 0xd9]);
}

describe('photo time from Exif', () => {
  it('reads DateTimeOriginal and DateTime, in both byte orders', () => {
    expect(exifDate(jpeg('2026:11:20 10:12:30'))).toBe(at('2026-11-20T10:12:30'));
    expect(exifDate(jpeg('2026:11:20 10:12:30', { bigEndian: true }))).toBe(at('2026-11-20T10:12:30'));
    expect(exifDate(jpeg('2026:11:20 10:12:30', { inIfd0: true }))).toBe(at('2026-11-20T10:12:30'));
  });

  it('gives null without a usable date', () => {
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(exifDate(jpeg('0000:00:00 00:00:00'))).toBeNull();
    expect(exifDate(jpeg('2026:11:20 10:12:30').subarray(0, 30))).toBeNull();
  });
});

describe('picture names and offsets', () => {
  it('builds a relative path per dive and avoids clashes', () => {
    const logbook = load();
    const dive = logbook.dives.find((d) => d.when === WHEN1)!;
    expect(pictureFileName(logbook, dive, 'C:\\Users\\x\\IMG_1.JPG', new Set())).toBe('Topside/2026-04-26 10-13 Lake Spot/IMG_1.JPG');
    expect(pictureFileName(logbook, dive, 'IMG_1.JPG', new Set(['topside/2026-04-26 10-13 lake spot/img_1.jpg']))).toBe(
      'Topside/2026-04-26 10-13 Lake Spot/IMG_1 (2).JPG',
    );
    expect(safeFileName('a:b*c?.jpg ')).toBe('a_b_c_.jpg');
    expect(safeFileName('...')).toBe('picture');
  });

  it('places a picture by its time, or at the start when it is far from the dive', () => {
    const dive = load().dives.find((d) => d.when === WHEN1)!;
    expect(pictureOffset(dive, WHEN1 + 600)).toBe(600);
    expect(pictureOffset(dive, WHEN1 - 1800)).toBe(-1800);
    expect(pictureOffset(dive, WHEN1 + 2 * 86400)).toBe(0);
    expect(pictureOffset(dive, null)).toBe(0);
  });
});

describe('picture references in the logbook', () => {
  it('adds and removes references like Subsurface writes them', () => {
    const logbook = load();
    const edit: DiveEdit = {
      when: WHEN1,
      changes: {},
      addPictures: [
        { offset: -1200, filename: 'Topside/x/briefing.jpg', location: null },
        { offset: 300, filename: 'Topside/x/turtle.jpg', location: null },
        { offset: 300, filename: 'Topside/x/turtle-2.jpg', location: null },
      ],
    };
    applyEdit(logbook, edit);
    let files = flattenTree(serializeLogbook(logbook));
    expect(files.get(`${DIR1}/Pictures/-00=20=00`)).toBe('filename "Topside/x/briefing.jpg"\n');
    expect(files.get(`${DIR1}/Pictures/+00=05=00`)).toBe('filename "Topside/x/turtle.jpg"\n');
    // two pictures cannot share an offset: one moves on by a second
    expect(files.get(`${DIR1}/Pictures/+00=05=01`)).toBe('filename "Topside/x/turtle-2.jpg"\n');
    expect(logbook.dives.find((d) => d.when === WHEN1)!.pictures.map((p) => p.offset)).toEqual([-1200, 300, 301]);
    expect(serializeXml(logbook)).toContain("  <picture filename='Topside/x/briefing.jpg' offset='-20:00 min'/>");

    // adding the same file again changes nothing; removing works also for Subsurface's own entries
    applyEdit(logbook, edit);
    applyEdit(logbook, { when: WHEN2, changes: {}, removePictures: ['photos/one.jpg', 'missing.jpg'] });
    applyEdit(logbook, { when: WHEN1, changes: {}, removePictures: ['Topside/x/briefing.jpg', 'Topside/x/turtle.jpg', 'Topside/x/turtle-2.jpg'] });
    files = flattenTree(serializeLogbook(logbook));
    const changed = [...new Set([...original.keys(), ...files.keys()])].filter((p) => original.get(p) !== files.get(p));
    expect(changed).toEqual([`${DIR2}/Pictures/+00=05=00`]);
  });

  it('merges edits: pictures add up, one added and removed before syncing is dropped', () => {
    const pic = (filename: string) => ({ offset: 0, filename, location: null });
    const merged = mergeEdits(
      { when: 1, changes: { buddy: 'A', notes: 'x' }, addPictures: [pic('a'), pic('b')], removePictures: ['old'] },
      { when: 1, changes: { buddy: 'B' }, addPictures: [pic('c')], removePictures: ['b', 'older'] },
    );
    expect(merged).toEqual({
      when: 1,
      changes: { buddy: 'B', notes: 'x' },
      addPictures: [pic('a'), pic('c')],
      removePictures: ['old', 'older'],
    });
  });
});
