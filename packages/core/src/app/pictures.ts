/**
 * Pictures of a dive (briefing sketch, highlights). The logbook only holds a reference per picture
 * (file name, time offset into the dive, position), as Subsurface does; the image itself stays on
 * the device and goes into the full export.
 *
 * The file name is a relative path, "Topside/<date time site>/<name>". Unpacked from the full
 * export anywhere on a PC, Subsurface's "Find moved media files" matches it by name and folders.
 */
import { toTm, pad2, pad4 } from '../subsurface/units.ts';
import { comparePictures, type Dive, type Logbook, type Picture } from '../subsurface/model.ts';

export const MEDIA_ROOT = 'Topside';

/** A file name without characters Windows, macOS or Linux reject, and without a path. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return cleaned || 'picture';
}

/** The folder for a dive's pictures: "2026-11-20 10-00 House Reef". */
export function pictureFolder(logbook: Logbook, dive: Dive): string {
  const tm = toTm(dive.when);
  const site = logbook.sites.find((s) => s.uuid === dive.siteUuid)?.name ?? '';
  const name = `${pad4(tm.year)}-${pad2(tm.month)}-${pad2(tm.day)} ${pad2(tm.hour)}-${pad2(tm.minute)}${site ? ` ${site}` : ''}`;
  return safeFileName(name.slice(0, 80));
}

/**
 * The logbook file name for a new picture of `dive`; `taken` are names already in use (in the
 * logbook or about to be added), which get a number appended: "IMG_1 (2).jpg".
 */
export function pictureFileName(logbook: Logbook, dive: Dive, originalName: string, taken: ReadonlySet<string>): string {
  const folder = `${MEDIA_ROOT}/${pictureFolder(logbook, dive)}/`;
  const name = safeFileName(originalName);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = folder + name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${folder}${stem} (${n})${ext}`;
  return candidate;
}

/**
 * Seconds into the dive at which a picture was taken (local time, like Dive.when). Pictures from
 * more than 12 hours around the dive, or without a time, go to the start of the dive.
 */
export function pictureOffset(dive: Dive, takenAt: number | null): number {
  if (takenAt === null) return 0;
  const end = dive.when + (dive.computers[0]?.duration ?? 0);
  if (takenAt < dive.when - 12 * 3600 || takenAt > end + 12 * 3600) return 0;
  return Math.round(takenAt - dive.when);
}

/**
 * Add a picture the way Subsurface's add_picture() does (sorted by offset, then file name). In the
 * git format each picture is a file named after its offset, so two pictures cannot share one:
 * a taken offset moves on by a second.
 */
export function addPicture(dive: Dive, picture: Picture): boolean {
  if (dive.pictures.some((p) => p.filename === picture.filename)) return false;
  const added = { ...picture };
  while (dive.pictures.some((p) => p.offset === added.offset)) added.offset++;
  const at = dive.pictures.findIndex((p) => comparePictures(added, p) < 0);
  if (at < 0) dive.pictures.push(added);
  else dive.pictures.splice(at, 0, added);
  return true;
}

export function removePicture(dive: Dive, filename: string): boolean {
  const at = dive.pictures.findIndex((p) => p.filename === filename);
  if (at < 0) return false;
  dive.pictures.splice(at, 1);
  return true;
}

/**
 * When a photo was taken, from its Exif data (DateTimeOriginal, else DateTime), as local time in
 * seconds like Dive.when. JPEG only; null if there is no usable date.
 */
export function exifDate(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1]!;
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (marker === 0xda || marker === 0xd9) break; // image data starts: no Exif
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === 'Exif') {
      return tiffDate(bytes.subarray(pos + 10, pos + 2 + length));
    }
    pos += 2 + length;
  }
  return null;
}

function tiffDate(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => (at + 2 <= tiff.length ? view.getUint16(at, little) : 0);
  const u32 = (at: number) => (at + 4 <= tiff.length ? view.getUint32(at, little) : 0);
  /** Tag → value offset (or value) in an IFD */
  const entries = (ifd: number) => {
    const out = new Map<number, { type: number; count: number; value: number }>();
    const n = u16(ifd);
    for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= tiff.length; i++) {
      const at = ifd + 2 + i * 12;
      out.set(u16(at), { type: u16(at + 2), count: u32(at + 4), value: u32(at + 8) });
    }
    return out;
  };
  const text = (entry: { type: number; count: number; value: number } | undefined) => {
    if (!entry || entry.type !== 2 || entry.count < 19 || entry.value + 19 > tiff.length) return null;
    return String.fromCharCode(...tiff.subarray(entry.value, entry.value + 19));
  };
  const ifd0 = entries(u32(4));
  const exifIfd = ifd0.get(0x8769);
  const exif = exifIfd ? entries(exifIfd.value) : new Map();
  const value = text(exif.get(0x9003)) ?? text(exif.get(0x9004)) ?? text(ifd0.get(0x0132));
  const m = value && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const seconds = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) / 1000;
  return Number.isFinite(seconds) && +m[1]! > 1990 ? seconds : null;
}
