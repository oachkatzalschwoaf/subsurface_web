/**
 * The git side of syncing: isomorphic-git, the Buffer polyfill it needs and the in-memory file
 * system. They load on first use (lib/git-load.ts), so the app starts without them; the service
 * worker keeps them for later. The functions are those of @topside/core.
 */
import type { CommitInfo, GitEnv, Logbook, Remote, Snapshot } from '@topside/core';

const load = () => import('./git-load.ts');

/** A fresh repository in memory for each operation. */
export async function freshEnv(): Promise<GitEnv> {
  return (await load()).freshEnv();
}

export async function fetchLogbook(env: GitEnv, remote: Remote): Promise<Snapshot> {
  return (await load()).fetchLogbook(env, remote);
}

export async function pushLogbook(env: GitEnv, remote: Remote, snapshot: Snapshot, logbook: Logbook, info: CommitInfo): Promise<string> {
  return (await load()).pushLogbook(env, remote, snapshot, logbook, info);
}

export async function initRemote(env: GitEnv, remote: Remote, logbook: Logbook, info: CommitInfo): Promise<string> {
  return (await load()).initRemote(env, remote, logbook, info);
}

export async function remoteHasBranch(env: GitEnv, remote: Remote): Promise<boolean> {
  return (await load()).remoteHasBranch(env, remote);
}
