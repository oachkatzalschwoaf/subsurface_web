/**
 * Subsurface's dive ID for dives imported from Garmin FIT files.
 *
 * Subsurface uses libdivecomputer for Garmin imports. The fingerprint of a Garmin dive is the
 * FIT file name, copied with strncpy into a zero-padded buffer and cut to FIT_NAME_SIZE (24) bytes
 * (libdc src/garmin.c, struct fit_file and the dive callback). Subsurface then takes the first
 * 32-bit word of the SHA-1 of that fingerprint as the dive ID (core/libdivecomputer.cpp,
 * calculate_diveid). The word is read in host byte order, which is little endian on every
 * platform Subsurface ships for.
 *
 * Subsurface uses the ID to recognize a dive it already has. Matching it lets Subsurface treat a
 * Topside upload and its own FIT import of the same file as the same dive.
 */

/** FIT_NAME_SIZE in libdc src/garmin.h */
export const FIT_NAME_SIZE = 24;

/** The 24-byte fingerprint libdivecomputer stores for a Garmin FIT file name. */
export function garminFingerprint(fileName: string): Uint8Array<ArrayBuffer> {
  const fingerprint = new Uint8Array(FIT_NAME_SIZE);
  fingerprint.set(new TextEncoder().encode(fileName).subarray(0, FIT_NAME_SIZE));
  return fingerprint;
}

/** Subsurface dive ID as an unsigned 32-bit number. */
export async function garminDiveId(fileName: string): Promise<number> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', garminFingerprint(fileName));
  return new DataView(digest).getUint32(0, true);
}

/** Dive ID in the form Subsurface writes it (`diveid 3b9aec2d`): 8 lowercase hex digits. */
export function formatDiveId(id: number): string {
  return id.toString(16).padStart(8, '0');
}
