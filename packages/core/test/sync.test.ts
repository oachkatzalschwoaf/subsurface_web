import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendDives,
  commitMessageForNewDives,
  createSite,
  fetchLogbook,
  flattenTree,
  importFit,
  inspect,
  listTrips,
  pushLogbook,
  SyncError,
  type GitEnv,
  type Remote,
} from '../src/index.ts';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { buildFit } from './helpers/fit-builder.ts';
import { startGitServer, type TestServer } from './helpers/git-server.ts';
import { treeFromObject } from './helpers/git-tree.ts';

const BRANCH = 'diver@example.org';
const START = Date.UTC(2026, 4, 2, 8, 0, 0) / 1000 - 631065600;

/** A dive on 2026-05-02 10:00 local time, the day after the last dive of the sample trip. */
const fitFile = buildFit([
  { global: 0, fields: [[0, 'enum', 4], [2, 'uint16', 3258]] },
  { global: 258, fields: [[4, 'enum', 0]] },
  { global: 20, fields: [[253, 'uint32', START], [92, 'uint32', 1000], [13, 'sint8', 12]] },
  { global: 20, fields: [[253, 'uint32', START + 60], [92, 'uint32', 18500], [13, 'sint8', 9]] },
  { global: 18, fields: [[2, 'uint32', START], [5, 'enum', 53]] },
  { global: 268, fields: [[0, 'uint16', 18], [2, 'uint32', 9000], [3, 'uint32', 18500], [11, 'uint32', 60000]] },
  { global: 34, fields: [[253, 'uint32', START + 60], [5, 'uint32', START + 60 + 7200]] },
]);

let server: TestServer;
const dirs: string[] = [];
const env = (): GitEnv => {
  const dir = mkdtempSync(join(tmpdir(), 'topside-clone-'));
  dirs.push(dir);
  return { fs, http, dir };
};
const remote = (): Remote => ({ url: server.url, branch: BRANCH, username: BRANCH, password: 'secret' });
const info = { message: 'test\n', authorName: 'Topside', authorEmail: BRANCH, timestamp: 1_800_000_000, timezoneOffset: -60 };

beforeAll(async () => {
  server = await startGitServer({
    branch: BRANCH,
    files: Object.fromEntries(flattenTree(treeFromObject(sampleRepo))),
    username: BRANCH,
    password: 'secret',
  });
});

afterAll(async () => {
  await server.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('sync with a git server', () => {
  it('fetches the logbook byte for byte', async () => {
    const snapshot = await fetchLogbook(env(), remote());
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.logbook.dives.map((d) => d.number)).toEqual([1, 2, 3]);
    expect(flattenTree(snapshot.tree)).toEqual(flattenTree(treeFromObject(sampleRepo)));
    expect(snapshot.commit).toBe(server.git('rev-parse', BRANCH).trim());
  });

  it('rejects a wrong password', async () => {
    await expect(fetchLogbook(env(), { ...remote(), password: 'wrong' })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('adds a dive and pushes exactly that change', async () => {
    const e = env();
    const snapshot = await fetchLogbook(e, remote());
    const before = server.git('rev-parse', BRANCH).trim();

    const { dive, entry } = await importFit(fitFile, '12345678901_ACTIVITY.fit');
    const { logbook } = inspect(snapshot.tree);
    dive.trip = listTrips(logbook)[0]!.trip;
    dive.siteUuid = createSite(logbook, 'New Site', entry, () => 0x12345678).uuid;
    dive.buddy = 'Sam Sample';
    appendDives(logbook, [dive]);
    expect(dive.number).toBe(0); // falls before dive 3 of the sample repository

    const message = commitMessageForNewDives(logbook, [dive], 'Topside:test');
    const commit = await pushLogbook(e, remote(), snapshot, logbook, { ...info, message });

    expect(server.git('rev-parse', BRANCH).trim()).toBe(commit);
    expect(server.git('rev-parse', `${BRANCH}^`).trim()).toBe(before);
    expect(server.git('fsck', '--strict', '--no-dangling').trim()).toBe('');
    expect(server.git('diff-tree', '-r', '--name-status', before, commit).trim().split('\n').sort()).toEqual([
      'A\t01-Divesites/Site-12345678',
      'A\t2026/04/26-TestTrip/05-02-Sat-10=00=00/Dive',
      'A\t2026/04/26-TestTrip/05-02-Sat-10=00=00/Divecomputer',
    ]);
    expect(server.git('show', `${commit}:2026/04/26-TestTrip/05-02-Sat-10=00=00/Divecomputer`)).toBe(
      'model "Descent Mk2"\ndiveid 2747eab0\nmaxdepth 18.5m\nmeandepth 9.0m\nwatertemp 9.0°C\nsalinity 1000g/l\n' +
        'keyvalue "Garmin Connect" "12345678901"\n  0:00 1.0m 12.0°C\n  1:00 18.5m 9.0°C\n',
    );
    expect(server.git('log', '-1', '--format=%an <%ae>%n%B', commit)).toBe(
      `Topside <${BRANCH}>\nChanges made: \n\nAdd dive unnumbered (2026-05-02, New Site)\n\nCreated by Topside:test\n\n`,
    );

    // What was pushed reads back cleanly
    const again = await fetchLogbook(env(), remote());
    expect(again.problems).toEqual([]);
    expect(again.logbook.dives).toHaveLength(4);
  });

  it('never overwrites: a push based on an old state is refused', async () => {
    const stale = env();
    const staleSnapshot = await fetchLogbook(stale, remote());

    // Someone else pushes first
    const other = env();
    const otherSnapshot = await fetchLogbook(other, remote());
    const otherLogbook = inspect(otherSnapshot.tree).logbook;
    otherLogbook.dives[0]!.buddy = 'Changed elsewhere';
    const winner = await pushLogbook(other, remote(), otherSnapshot, otherLogbook, info);

    const staleLogbook = inspect(staleSnapshot.tree).logbook;
    staleLogbook.dives[0]!.suit = 'Drysuit';
    await expect(pushLogbook(stale, remote(), staleSnapshot, staleLogbook, info)).rejects.toMatchObject({ kind: 'conflict' });
    expect(server.git('rev-parse', BRANCH).trim()).toBe(winner);
  });

  it('refuses to write a logbook it cannot reproduce', async () => {
    const e = env();
    const snapshot = await fetchLogbook(e, remote());
    const broken = { ...snapshot, problems: ['2026/x: cannot be reproduced exactly'] };
    const before = server.git('rev-parse', BRANCH).trim();
    await expect(pushLogbook(e, remote(), broken, snapshot.logbook, info)).rejects.toBeInstanceOf(SyncError);
    expect(server.git('rev-parse', BRANCH).trim()).toBe(before);
  });

  it('flags unknown content as not writable', () => {
    const tree = treeFromObject(sampleRepo);
    tree.set('03-Future', 'something new\n');
    expect(inspect(tree).problems).toEqual(['03-Future: unexpected entry']);
  });
});
