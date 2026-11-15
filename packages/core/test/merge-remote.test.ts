import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMemoryFs,
  fetchLogbook,
  flattenTree,
  initRemote,
  mergeDives,
  newDive,
  newDiveComputer,
  parseLogbook,
  remoteHasBranch,
  serializeLogbook,
  type Remote,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { startGitServer, type TestServer } from './helpers/git-server.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const load = () => parseLogbook(treeFromObject(sampleRepo)).logbook;

describe('mergeDives', () => {
  it('copies only missing dives, with their site and trip', () => {
    const target = load();
    target.dives = target.dives.filter((d) => d.number !== 2); // the target lacks dive 2
    const source = load();
    const { added, skipped } = mergeDives(target, source);
    expect(added.map((d) => d.when)).toEqual([source.dives[1]!.when]);
    expect(skipped).toHaveLength(2);
    expect(added[0]!.siteUuid).toBe(0x00c0ffee); // same site reused
    expect(added[0]!.trip).toBe(target.dives[0]!.trip); // the trip that already holds dive 1
    expect(target.trips).toHaveLength(1);
  });

  it('brings sites and trips the target does not know', () => {
    const target = load();
    const source = load();
    const extra = newDive(Date.UTC(2026, 9, 1, 9, 0) / 1000);
    extra.computers.push(newDiveComputer(extra.when, 1800));
    extra.siteUuid = 0x1234;
    extra.trip = { location: 'Red Sea', notes: '' };
    source.sites.push({ uuid: 0x1234, name: 'House Reef', description: '', notes: '', location: null, taxonomy: [] });
    source.trips.push(extra.trip);
    source.dives.push(extra);

    const { added } = mergeDives(target, source);
    expect(added).toHaveLength(1);
    expect(added[0]!.number).toBe(4);
    expect(target.sites.find((s) => s.uuid === 0x1234)?.name).toBe('House Reef');
    expect([...flattenTree(serializeLogbook(target)).keys()]).toContain('2026/10/01-RedSea/01-Thu-09=00=00/Dive-4');
  });

  it('gives a copied site a new ID when the target uses that ID for another site', () => {
    const target = load();
    const source = load();
    const extra = newDive(Date.UTC(2026, 9, 1, 9, 0) / 1000);
    extra.computers.push(newDiveComputer(extra.when, 1800));
    extra.siteUuid = 0x0000abcd; // same ID as "Test Reef" in the target
    source.sites = [{ uuid: 0x0000abcd, name: 'Other Reef', description: '', notes: '', location: null, taxonomy: [] }];
    source.dives = [extra];
    const { added } = mergeDives(target, source);
    expect(added[0]!.siteUuid).not.toBe(0x0000abcd);
    expect(target.sites.find((s) => s.uuid === added[0]!.siteUuid)?.name).toBe('Other Reef');
  });
});

describe('initRemote', () => {
  let server: TestServer;
  const dirs: string[] = [];
  beforeAll(async () => {
    server = await startGitServer({ branch: 'main', files: {}, username: 'me', password: 'token' });
  });
  afterAll(async () => {
    await server.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const remote = (): Remote => ({ url: server.url, branch: 'main', username: 'me', password: 'token' });
  const env = () => {
    const dir = mkdtempSync(join(tmpdir(), 'topside-init-'));
    dirs.push(dir);
    return { fs, http, dir };
  };
  const info = { message: 'Copy\n', authorName: 'Topside', authorEmail: 'me@example.org', timestamp: 1_800_000_000, timezoneOffset: 0 };

  it('fills an empty repository and refuses a second time', async () => {
    expect(await remoteHasBranch(env(), remote())).toBe(false);
    const commit = await initRemote({ fs: createMemoryFs(), http, dir: '/repo' }, remote(), load(), info);
    expect(server.git('rev-parse', 'main').trim()).toBe(commit);
    expect(server.git('fsck', '--strict', '--no-dangling').trim()).toBe('');

    const snapshot = await fetchLogbook(env(), remote());
    expect(snapshot.problems).toEqual([]);
    expect(flattenTree(snapshot.tree)).toEqual(flattenTree(treeFromObject(sampleRepo)));

    expect(await remoteHasBranch(env(), remote())).toBe(true);
    await expect(initRemote(env(), remote(), load(), info)).rejects.toMatchObject({ kind: 'conflict' });
  });
});
