/**
 * Fetch a Subsurface logbook from its git remote and push a changed one back.
 *
 * Works on git objects only; there is no checkout. Reading the tree from objects keeps files
 * byte-exact, and writing back reuses the object IDs of everything that did not change.
 *
 * Safety rules:
 * - A logbook is only writable if Topside can reproduce every existing file byte for byte.
 *   Anything it does not fully understand is left alone by refusing to write at all.
 * - A push must be a fast-forward. It is never forced; if the remote moved on, the caller
 *   fetches again and repeats the change.
 */
import git, { type FsClient, type HttpClient, type TreeEntry } from 'isomorphic-git';
import type { Logbook } from '../subsurface/model.ts';
import { parseLogbook } from '../subsurface/parse.ts';
import { serializeLogbook } from '../subsurface/serialize.ts';
import { flattenTree, isTree, type GitTree } from '../subsurface/tree.ts';

export interface Remote {
  /** Repository URL, e.g. https://ssrf-cloud-u2.subsurface-divelog.org/git/user@example.org */
  url: string;
  /** Subsurface names the branch after the account e-mail. */
  branch: string;
  username: string;
  password: string;
  /** Prefix of a proxy that forwards to the git server, for browsers (no CORS on the cloud). */
  corsProxy?: string;
}

export interface GitEnv {
  fs: FsClient;
  http: HttpClient;
  /** Directory of the local repository inside `fs`. Must be empty or not exist before fetching. */
  dir: string;
}

export interface Snapshot {
  /** Commit the logbook was read from. */
  commit: string;
  tree: GitTree;
  logbook: Logbook;
  /** Why Topside must not write this logbook. Empty when writing is safe. */
  problems: string[];
}

export type SyncErrorKind = 'auth' | 'not-found' | 'conflict' | 'unsupported' | 'network';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function classify(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  const e = error as { code?: string; data?: { statusCode?: number; statusMessage?: string }; message?: string };
  const status = e.data?.statusCode;
  if (status === 401 || status === 403) return new SyncError('auth', 'Wrong e-mail or password');
  if (status === 404) return new SyncError('not-found', `HTTP 404 ${e.data?.statusMessage ?? ''}`.trim());
  if (e.code === 'NotFoundError') return new SyncError('not-found', e.message ?? 'NotFoundError');
  if (e.code === 'PushRejectedError') return new SyncError('conflict', 'The logbook changed on the server in the meantime');
  return new SyncError('network', e.message ?? String(error));
}

const auth = (remote: Remote) => () => ({ username: remote.username, password: remote.password });

/** Clone the remote branch (objects only) and read the logbook at its tip. */
export async function fetchLogbook(env: GitEnv, remote: Remote): Promise<Snapshot> {
  const { fs, http, dir } = env;
  try {
    await git.clone({
      fs,
      http,
      dir,
      url: remote.url,
      ...(remote.corsProxy ? { corsProxy: remote.corsProxy } : {}),
      ref: remote.branch,
      singleBranch: true,
      noCheckout: true,
      noTags: true,
      onAuth: auth(remote),
    });
    const commit = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${remote.branch}` });
    const { tree: treeOid } = (await git.readCommit({ fs, dir, oid: commit })).commit;
    const tree = await readTree(env, treeOid);
    return { commit, tree, ...inspect(tree) };
  } catch (error) {
    throw classify(error);
  }
}

/** Parse a tree and check that writing it back reproduces it exactly. */
export function inspect(tree: GitTree): { logbook: Logbook; problems: string[] } {
  const { logbook, warnings } = parseLogbook(tree);
  const problems = [...warnings];
  if (logbook.settings.version !== 3) problems.push(`Unsupported data format version ${logbook.settings.version}`);
  if (problems.length === 0) {
    const before = flattenTree(tree);
    const after = flattenTree(serializeLogbook(parseLogbook(tree).logbook));
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(path) !== after.get(path)) problems.push(`${path}: cannot be reproduced exactly`);
    }
  }
  return { logbook, problems };
}

async function readTree(env: GitEnv, oid: string): Promise<GitTree> {
  const { fs, dir } = env;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const out: GitTree = new Map();
  for (const entry of (await git.readTree({ fs, dir, oid })).tree) {
    if (entry.type === 'tree') out.set(entry.path, await readTree(env, entry.oid));
    else if (entry.type === 'blob') out.set(entry.path, decoder.decode((await git.readBlob({ fs, dir, oid: entry.oid })).blob));
    else throw new SyncError('unsupported', `Unexpected ${entry.type} entry "${entry.path}"`);
  }
  return out;
}

async function writeTree(env: GitEnv, tree: GitTree): Promise<string> {
  const { fs, dir } = env;
  const encoder = new TextEncoder();
  const entries: TreeEntry[] = [];
  for (const [path, node] of tree) {
    if (isTree(node)) entries.push({ mode: '040000', path, oid: await writeTree(env, node), type: 'tree' });
    else entries.push({ mode: '100644', path, oid: await git.writeBlob({ fs, dir, blob: encoder.encode(node) }), type: 'blob' });
  }
  return git.writeTree({ fs, dir, tree: entries });
}

export interface CommitInfo {
  message: string;
  authorName: string;
  authorEmail: string;
  /** Seconds since 1970 UTC; defaults to now. */
  timestamp?: number;
  /** Minutes behind UTC, as Date.getTimezoneOffset() returns; defaults to the local zone. */
  timezoneOffset?: number;
}

/**
 * Commit `logbook` on top of the snapshot it was derived from and push it.
 * Throws SyncError('conflict') if the remote has moved on; nothing is overwritten in that case.
 */
export async function pushLogbook(env: GitEnv, remote: Remote, snapshot: Snapshot, logbook: Logbook, info: CommitInfo): Promise<string> {
  if (snapshot.problems.length > 0) {
    throw new SyncError('unsupported', `This logbook cannot be written safely: ${snapshot.problems[0]}`);
  }
  const { fs, http, dir } = env;
  try {
    const tree = await writeTree(env, serializeLogbook(logbook));
    const now = new Date();
    const signature = {
      name: info.authorName,
      email: info.authorEmail,
      timestamp: info.timestamp ?? Math.floor(now.getTime() / 1000),
      timezoneOffset: info.timezoneOffset ?? now.getTimezoneOffset(),
    };
    const commit = await git.writeCommit({
      fs,
      dir,
      commit: { message: info.message, tree, parent: [snapshot.commit], author: signature, committer: signature },
    });
    await git.writeRef({ fs, dir, ref: `refs/heads/${remote.branch}`, value: commit, force: true });
    const result = await git.push({
      fs,
      http,
      dir,
      url: remote.url,
      ...(remote.corsProxy ? { corsProxy: remote.corsProxy } : {}),
      ref: remote.branch,
      remoteRef: `refs/heads/${remote.branch}`,
      force: false,
      onAuth: auth(remote),
    });
    if (!result.ok) throw new SyncError('conflict', result.error ?? 'The server rejected the upload');
    return commit;
  } catch (error) {
    throw classify(error);
  }
}
