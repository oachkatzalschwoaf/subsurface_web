/**
 * Files in and out: downloads, and the backup ZIP of a logbook's git files.
 */
import { flattenTree, unflattenTree, type GitTree } from '@topside/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export function downloadFile(content: Blob | string, name: string, type = 'application/octet-stream'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const BACKUP_MARKER = 'topside-backup.txt';

/** All git files of the logbook in a ZIP, as they are stored in the repository. */
export function backupZip(tree: GitTree, note: string): Uint8Array {
  const entries: Record<string, Uint8Array> = { [BACKUP_MARKER]: strToU8(`${note}\n`) };
  for (const [path, content] of flattenTree(tree)) entries[path] = path.endsWith('/') ? new Uint8Array() : strToU8(content);
  return zipSync(entries, { level: 6 });
}

/** Read a backup ZIP made by backupZip(). */
export function readBackupZip(bytes: Uint8Array): GitTree {
  const entries = unzipSync(bytes);
  if (!(BACKUP_MARKER in entries)) throw new Error('This is not a logbook backup');
  const files: [string, string][] = Object.entries(entries)
    .filter(([path]) => path !== BACKUP_MARKER)
    .map(([path, data]) => [path, path.endsWith('/') ? '' : strFromU8(data)]);
  return unflattenTree(files);
}

/**
 * The full export: the logbook as Subsurface XML plus the pictures at the paths the logbook
 * references, so Subsurface's "Find moved media files" can match them. Images are stored without
 * compression (they are compressed already).
 */
export function fullExportZip(ssrfName: string, xml: string, pictures: { filename: string; data: Uint8Array }[], readme: string): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    [ssrfName]: strToU8(xml),
    'README.txt': strToU8(readme),
  };
  for (const p of pictures) entries[p.filename] = [p.data, { level: 0 }];
  return zipSync(entries, { level: 6 });
}

export const today = (): string => new Date().toISOString().slice(0, 10);
