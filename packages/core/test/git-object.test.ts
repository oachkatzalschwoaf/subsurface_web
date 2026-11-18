import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTrip, flattenTree, inspect, isTree, parseLogbook, serializeLogbook, type Dive, type GitTree } from '../src/index.ts';
import { sha1, treeObjectId } from '../src/subsurface/git-object.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const repo = mkdtempSync(join(tmpdir(), 'topside-objects-'));
execFileSync('git', ['init', '-q', '--bare', repo]);
afterAll(() => rmSync(repo, { recursive: true, force: true }));

/** The tree's ID as git itself computes it (hash-object and mktree in a scratch repository). */
function gitTreeId(tree: GitTree): string {
  const lines: string[] = [];
  for (const [name, node] of tree) {
    if (isTree(node)) lines.push(`040000 tree ${gitTreeId(node)}\t${name}`);
    else {
      const id = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: Buffer.from(node, 'utf8') }).toString().trim();
      lines.push(`100644 blob ${id}\t${name}`);
    }
  }
  return execFileSync('git', ['-C', repo, 'mktree'], { input: lines.map((l) => `${l}\n`).join('') }).toString().trim();
}

describe('git object IDs', () => {
  it('computes SHA-1', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(hex(sha1(text('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(text('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    // lengths around the padding boundary and over several blocks
    for (const n of [55, 56, 63, 64, 65, 119, 1000, 100_000]) {
      const data = text('x'.repeat(n));
      expect(hex(sha1(data))).toBe(createHash('sha1').update(data).digest('hex'));
    }
  });

  it('matches git for the empty tree and for a whole logbook', () => {
    expect(treeObjectId(new Map())).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    const tree = treeFromObject({ ...sampleRepo, '02-Filterpresets': {}, Äpfel: { 'ö-ü': 'Ünïcode\n' } });
    expect(treeObjectId(tree)).toBe(gitTreeId(tree));
  });
});

describe('directory names that collide', () => {
  it('get "~" and seven digits of the git ID, like Subsurface, and read back unchanged', () => {
    const { logbook } = parseLogbook(treeFromObject(sampleRepo));
    // a second trip of the same name whose first dive is on the same day as the existing one
    const [first] = logbook.dives;
    const twin: Dive = structuredClone({ ...first!, trip: null });
    twin.when = first!.when + 3600;
    for (const dc of twin.computers) dc.diveId = 0;
    twin.number = 0;
    twin.trip = createTrip(logbook, first!.trip!.location);
    logbook.dives.push(twin);
    logbook.dives.sort((a, b) => a.when - b.when);

    const tree = serializeLogbook(logbook);
    const month = (tree.get('2026') as GitTree).get('04') as GitTree;
    const names = [...month.keys()].sort();
    expect(names).toHaveLength(2);
    const [plain, suffixed] = names as [string, string];
    expect(suffixed).toMatch(new RegExp(`^${plain}~[0-9a-f]{7}$`));
    // the trip saved first (its first dive is earlier) gets the suffix, from the git ID of its directory
    const dives = (name: string) => [...(month.get(name) as GitTree).keys()].join(' ');
    expect(dives(suffixed)).toMatch(/10=13=05/);
    expect(dives(plain)).toMatch(/11=13=05/);
    expect(suffixed.slice(-7)).toBe(gitTreeId(month.get(suffixed) as GitTree).slice(0, 7));

    // a logbook with such names is read and written back byte for byte, so it stays writable
    const check = inspect(tree);
    expect(check.problems).toEqual([]);
    expect(flattenTree(serializeLogbook(check.logbook))).toEqual(flattenTree(tree));
    expect(check.logbook.trips).toHaveLength(2);
  });
});
