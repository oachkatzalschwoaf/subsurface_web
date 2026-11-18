import { describe, expect, it } from 'vitest';
import { createMemoryFs, createTrip, parseLogbook, pushLogbook, SyncError, type Dive } from '../src/index.ts';
import http from 'isomorphic-git/http/node';
import { sampleRepo } from './fixtures/sample-repo.ts';
import { treeFromObject } from './helpers/git-tree.ts';

describe('sync errors', () => {
  it('reports a logbook it cannot write as internal, not as a network problem', async () => {
    const tree = treeFromObject(sampleRepo);
    const { logbook } = parseLogbook(tree);
    // two trips of the same name starting on the same day need a "~hash" suffix, not supported yet
    const [first] = logbook.dives;
    const twin: Dive = structuredClone({ ...first!, trip: null });
    twin.when += 60 * 30;
    twin.trip = createTrip(logbook, first!.trip!.location);
    logbook.dives.push(twin);
    const remote = { url: 'http://127.0.0.1:1/none.git', branch: 'main', username: 'u', password: 'p' };
    const error = await pushLogbook({ fs: createMemoryFs(), http, dir: '/repo' }, remote, { commit: '0'.repeat(40), tree, logbook, problems: [] }, logbook, {
      message: 'x',
      authorName: 'Test',
      authorEmail: 'test@example.org',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).kind).toBe('internal');
    expect((error as SyncError).message).toMatch(/Duplicate entry/);
  });
});
