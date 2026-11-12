import { execFileSync } from 'node:child_process';
import type { GitTree } from '../../src/index.ts';

/**
 * Read a commit's tree straight from the git object store. Reading the checkout instead would
 * pick up line-ending conversion (core.autocrlf) and break byte-exact comparisons.
 */
export function readGitTree(repo: string, rev = 'HEAD'): GitTree {
  const listing = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '-t', '-z', rev], {
    maxBuffer: 1 << 28,
  }).toString('utf8');

  const entries = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [, type, oid] = line.slice(0, tab).split(' ');
      return { type: type!, oid: oid!, path: line.slice(tab + 1) };
    });

  const blobOids = entries.filter((e) => e.type === 'blob').map((e) => e.oid);
  const contents = readBlobs(repo, blobOids);

  const root: GitTree = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const entry of entries) {
    const parts = entry.path.split('/');
    const name = parts.pop()!;
    let dir = root;
    for (const part of parts) dir = dir.get(part) as GitTree;
    if (entry.type === 'tree') dir.set(name, new Map());
    else if (entry.type === 'blob') dir.set(name, decoder.decode(contents.get(entry.oid)!));
  }
  return root;
}

function readBlobs(repo: string, oids: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (oids.length === 0) return out;
  const raw = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], {
    input: `${oids.join('\n')}\n`,
    maxBuffer: 1 << 28,
  });
  let pos = 0;
  while (pos < raw.length) {
    const headerEnd = raw.indexOf(0x0a, pos);
    const [oid, , size] = raw.subarray(pos, headerEnd).toString('utf8').split(' ');
    const start = headerEnd + 1;
    const end = start + Number(size);
    out.set(oid!, raw.subarray(start, end));
    pos = end + 1;
  }
  return out;
}

/** Build a GitTree from a nested object literal; an empty object is an empty directory. */
export function treeFromObject(obj: { [name: string]: string | object }): GitTree {
  const tree: GitTree = new Map();
  for (const [name, value] of Object.entries(obj)) {
    tree.set(name, typeof value === 'string' ? value : treeFromObject(value as { [name: string]: string | object }));
  }
  return tree;
}

/** Human-readable differences between two flattened trees, for test failure messages. */
export function describeDifferences(expected: Map<string, string>, actual: Map<string, string>, limit = 10): string[] {
  const out: string[] = [];
  for (const path of new Set([...expected.keys(), ...actual.keys()])) {
    if (out.length >= limit) break;
    const e = expected.get(path);
    const a = actual.get(path);
    if (e === a) continue;
    if (e === undefined) out.push(`extra file: ${path}`);
    else if (a === undefined) out.push(`missing file: ${path}`);
    else {
      const el = e.split('\n');
      const al = a.split('\n');
      const i = el.findIndex((line, n) => line !== al[n]);
      const at = i < 0 ? el.length : i;
      out.push(`${path}:${at + 1}: expected ${JSON.stringify(el[at])}, got ${JSON.stringify(al[at])}`);
    }
  }
  return out;
}
