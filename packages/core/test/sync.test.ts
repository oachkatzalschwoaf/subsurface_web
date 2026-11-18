import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addHeadSymref,
  appendDives,
  createMemoryFs,
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

  it('works the same on the in-memory file system used by the browser', async () => {
    const memory = { fs: createMemoryFs(), http, dir: '/repo' };
    const snapshot = await fetchLogbook(memory, remote());
    expect(snapshot.problems).toEqual([]);
    expect(flattenTree(snapshot.tree)).toEqual(flattenTree(treeFromObject(sampleRepo)));
    const { logbook } = inspect(snapshot.tree);
    logbook.dives[2]!.notes = 'edited in memory';
    const commit = await pushLogbook(memory, remote(), snapshot, logbook, info);
    expect(server.git('rev-parse', BRANCH).trim()).toBe(commit);
    expect(server.git('fsck', '--strict', '--no-dangling').trim()).toBe('');
    expect(server.git('show', `${commit}:2026/07/18-Sat-10=19=29/Dive-3`)).toContain('notes "edited in memory"');
  });

  it('fetches only the latest commit and pushes on top of it', async () => {
    // a few commits of history on the server
    for (const note of ['one', 'two']) {
      const e = env();
      const snapshot = await fetchLogbook(e, remote());
      const { logbook } = inspect(snapshot.tree);
      logbook.dives[1]!.notes = `history ${note}`;
      await pushLogbook(e, remote(), snapshot, logbook, info);
    }
    expect(Number(server.git('rev-list', '--count', BRANCH).trim())).toBeGreaterThan(2);

    const e = env();
    const snapshot = await fetchLogbook(e, remote());
    // the clone holds one commit, marked shallow
    expect(fs.readFileSync(join(e.dir, '.git', 'shallow'), 'utf8').trim()).toBe(snapshot.commit);
    const { logbook } = inspect(snapshot.tree);
    logbook.dives[1]!.notes = 'pushed from a shallow clone';
    const commit = await pushLogbook(e, remote(), snapshot, logbook, info);
    expect(server.git('rev-parse', `${BRANCH}^`).trim()).toBe(snapshot.commit);
    expect(server.git('rev-parse', BRANCH).trim()).toBe(commit);
    expect(server.git('fsck', '--strict', '--no-dangling').trim()).toBe('');
  });

  it('falls back to the whole history when the server cannot clone shallow', async () => {
    // the server's advertisement without the "shallow" capability
    const noShallow: GitEnv['http'] = {
      async request(request) {
        const response = await http.request(request);
        if (!request.url.includes('/info/refs?service=git-upload-pack') || !response.body) return response;
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.body) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('latin1');
        // pkt-lines: "# service=git-upload-pack", a flush "0000", then the first ref with the capabilities
        let pos = 0;
        let length = Number.parseInt(text.slice(0, 4), 16);
        while (length === 0 || text[pos + 4] === '#') {
          pos += length === 0 ? 4 : length;
          length = Number.parseInt(text.slice(pos, pos + 4), 16);
        }
        const line = text.slice(pos + 4, pos + length).replace(' shallow', '');
        const body = text.slice(0, pos) + (line.length + 4).toString(16).padStart(4, '0') + line + text.slice(pos + length);
        const headers = { ...response.headers };
        delete headers['content-length'];
        return { ...response, headers, body: (async function* () { yield Buffer.from(body, 'latin1'); })() };
      },
    };
    const e = { ...env(), http: noShallow };
    const snapshot = await fetchLogbook(e, remote());
    expect(snapshot.problems).toEqual([]);
    expect(fs.existsSync(join(e.dir, '.git', 'shallow'))).toBe(false);
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

describe('addHeadSymref', () => {
  const pkt = (s: string) => `${(s.length + 4).toString(16).padStart(4, '0')}${s}`;
  const oid = 'a'.repeat(40);
  const advert = (caps: string) =>
    new TextEncoder().encode(`${pkt('# service=git-upload-pack\n')}0000${pkt(`${oid} refs/heads/me@x.org\u0000${caps}\n`)}0000`);

  it('adds a HEAD symref when the server sent none', () => {
    const out = new TextDecoder().decode(addHeadSymref(advert('multi_ack side-band-64k'), 'me@x.org'));
    expect(out).toBe(
      `${pkt('# service=git-upload-pack\n')}0000${pkt(`${oid} refs/heads/me@x.org\u0000multi_ack side-band-64k symref=HEAD:refs/heads/me@x.org\n`)}0000`,
    );
  });

  it('leaves an advertisement with a HEAD symref alone', () => {
    const input = advert('multi_ack symref=HEAD:refs/heads/main');
    expect(addHeadSymref(input, 'me@x.org')).toBe(input);
  });
});
