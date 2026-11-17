/**
 * Pictures of dives, kept in this browser (IndexedDB). The logbook holds only references; the
 * image is found by the reference's file name. A small preview is stored next to each image.
 */
import { dbDelete, dbGet, dbSet } from './db.ts';

export interface MediaItem {
  /** The file name used in the logbook, "Topside/<folder>/<name>" */
  filename: string;
  /** Dive.when of the dive it belongs to */
  diveWhen: number;
  type: string;
  size: number;
  addedAt: number;
}

interface StoredMedia {
  blob: Blob;
  thumb: Blob | null;
}

const LIST_KEY = 'media';
const key = (filename: string) => `media:${filename}`;

export const loadMediaList = async (): Promise<MediaItem[]> => (await dbGet<MediaItem[]>(LIST_KEY)) ?? [];
export const saveMediaList = (items: MediaItem[]): Promise<void> => dbSet(LIST_KEY, items);

export async function storeMedia(filename: string, blob: Blob): Promise<void> {
  const stored: StoredMedia = { blob, thumb: await thumbnail(blob) };
  await dbSet(key(filename), stored);
}

export async function mediaBlob(filename: string, preview = false): Promise<Blob | null> {
  const stored = await dbGet<StoredMedia>(key(filename));
  return (preview ? (stored?.thumb ?? stored?.blob) : stored?.blob) ?? null;
}

export const deleteMedia = (filename: string): Promise<void> => dbDelete(key(filename));

/** A JPEG preview at most 480 px wide or high; null if the browser cannot decode the image. */
async function thumbnail(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

/**
 * When a file was taken: from its Exif date (passed in), else from the file's modification time,
 * as local time in seconds like Dive.when.
 */
export function takenAt(file: File, exif: number | null): number | null {
  if (exif !== null) return exif;
  if (!file.lastModified) return null;
  const date = new Date(file.lastModified);
  return Math.round(file.lastModified / 1000 - date.getTimezoneOffset() * 60);
}
