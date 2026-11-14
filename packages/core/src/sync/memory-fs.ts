/**
 * An in-memory file system with the subset of Node's fs.promises API that isomorphic-git uses.
 *
 * Topside clones the logbook fresh for every operation and throws the copy away afterwards, so
 * nothing needs to survive a page reload. Keeping it in memory avoids IndexedDB, its quotas and
 * its delayed writes.
 */

interface FileNode {
  kind: 'file';
  data: Uint8Array;
  mode: number;
  mtimeMs: number;
  ino: number;
}
interface DirNode {
  kind: 'dir';
  entries: Map<string, Node>;
  mtimeMs: number;
  ino: number;
}
interface LinkNode {
  kind: 'link';
  target: string;
  mtimeMs: number;
  ino: number;
}
type Node = FileNode | DirNode | LinkNode;

function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

function split(path: string): string[] {
  return path.split('/').filter((p) => p !== '' && p !== '.');
}

export function createMemoryFs() {
  let nextIno = 1;
  const root: DirNode = { kind: 'dir', entries: new Map(), mtimeMs: Date.now(), ino: nextIno++ };

  function lookup(path: string): Node | undefined {
    let node: Node = root;
    for (const part of split(path)) {
      if (node.kind !== 'dir') return undefined;
      const next: Node | undefined = node.entries.get(part);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  function parentOf(path: string): { dir: DirNode; name: string } {
    const parts = split(path);
    const name = parts.pop();
    if (!name) throw fsError('EEXIST', path);
    const dir = lookup(parts.join('/'));
    if (!dir) throw fsError('ENOENT', path);
    if (dir.kind !== 'dir') throw fsError('ENOTDIR', path);
    return { dir, name };
  }

  function stats(node: Node) {
    const size = node.kind === 'file' ? node.data.byteLength : 0;
    const mode = node.kind === 'file' ? node.mode : node.kind === 'dir' ? 0o40755 : 0o120000;
    return {
      type: node.kind === 'link' ? 'symlink' : node.kind,
      mode,
      size,
      ino: node.ino,
      mtimeMs: node.mtimeMs,
      ctimeMs: node.mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => node.kind === 'file',
      isDirectory: () => node.kind === 'dir',
      isSymbolicLink: () => node.kind === 'link',
    };
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const wantsText = (options: unknown) =>
    options === 'utf8' || (typeof options === 'object' && options !== null && (options as { encoding?: string }).encoding === 'utf8');

  const promises = {
    async readFile(path: string, options?: unknown): Promise<Uint8Array | string> {
      const node = lookup(path);
      if (!node) throw fsError('ENOENT', path);
      if (node.kind !== 'file') throw fsError('EISDIR', path);
      return wantsText(options) ? decoder.decode(node.data) : node.data.slice();
    },
    async writeFile(path: string, data: Uint8Array | string, options?: { mode?: number }): Promise<void> {
      const { dir, name } = parentOf(path);
      const existing = dir.entries.get(name);
      if (existing?.kind === 'dir') throw fsError('EISDIR', path);
      const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
      dir.entries.set(name, { kind: 'file', data: bytes, mode: options?.mode ?? 0o100644, mtimeMs: Date.now(), ino: nextIno++ });
    },
    async unlink(path: string): Promise<void> {
      const { dir, name } = parentOf(path);
      const node = dir.entries.get(name);
      if (!node) throw fsError('ENOENT', path);
      if (node.kind === 'dir') throw fsError('EISDIR', path);
      dir.entries.delete(name);
    },
    async readdir(path: string): Promise<string[]> {
      const node = lookup(path);
      if (!node) throw fsError('ENOENT', path);
      if (node.kind !== 'dir') throw fsError('ENOTDIR', path);
      return [...node.entries.keys()];
    },
    async mkdir(path: string): Promise<void> {
      const { dir, name } = parentOf(path);
      if (dir.entries.has(name)) throw fsError('EEXIST', path);
      dir.entries.set(name, { kind: 'dir', entries: new Map(), mtimeMs: Date.now(), ino: nextIno++ });
    },
    async rmdir(path: string): Promise<void> {
      const { dir, name } = parentOf(path);
      const node = dir.entries.get(name);
      if (!node) throw fsError('ENOENT', path);
      if (node.kind !== 'dir') throw fsError('ENOTDIR', path);
      if (node.entries.size > 0) throw fsError('ENOTEMPTY', path);
      dir.entries.delete(name);
    },
    async stat(path: string) {
      let node = lookup(path);
      for (let hops = 0; node?.kind === 'link' && hops < 8; hops++) node = lookup(node.target);
      if (!node) throw fsError('ENOENT', path);
      return stats(node);
    },
    async lstat(path: string) {
      const node = lookup(path);
      if (!node) throw fsError('ENOENT', path);
      return stats(node);
    },
    async readlink(path: string): Promise<string> {
      const node = lookup(path);
      if (!node || node.kind !== 'link') throw fsError('ENOENT', path);
      return node.target;
    },
    async symlink(target: string, path: string): Promise<void> {
      const { dir, name } = parentOf(path);
      if (dir.entries.has(name)) throw fsError('EEXIST', path);
      dir.entries.set(name, { kind: 'link', target, mtimeMs: Date.now(), ino: nextIno++ });
    },
    async chmod(path: string, mode: number): Promise<void> {
      const node = lookup(path);
      if (!node) throw fsError('ENOENT', path);
      if (node.kind === 'file') node.mode = mode;
    },
  };
  return { promises };
}
