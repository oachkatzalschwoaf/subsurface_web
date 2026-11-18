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

/** 'internal': not a problem of the server or the connection, e.g. a logbook Topside cannot write. */
export type SyncErrorKind = 'auth' | 'not-found' | 'conflict' | 'unsupported' | 'network' | 'internal';

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
  if (status === 421) return new SyncError('unsupported', 'This git server is not enabled in git-proxy.config.php');
  if (status === 401 || status === 403) return new SyncError('auth', 'Wrong e-mail or password');
  if (status === 404) return new SyncError('not-found', `HTTP 404 ${e.data?.statusMessage ?? ''}`.trim());
  if (e.code === 'NotFoundError') return new SyncError('not-found', e.message ?? 'NotFoundError');
  if (e.code === 'PushRejectedError') return new SyncError('conflict', 'The logbook changed on the server in the meantime');
  // isomorphic-git's errors carry a code and fetch() fails with a TypeError; anything else is
  // Topside's own, and calling it a network problem would mislead
  if (error instanceof Error && !(error instanceof TypeError) && e.code === undefined && e.data === undefined) {
    return new SyncError('internal', error.message);
  }
  return new SyncError('network', e.message ?? String(error));
}

/**
 * The Subsurface cloud does not advertise HEAD (its repositories have no default branch), but
 * isomorphic-git's fetch insists on one. This wraps the HTTP client and, in the ref advertisement
 * of git-upload-pack only, adds the capability `symref=HEAD:refs/heads/<branch>` when the server
 * sent none. Nothing else in the traffic is touched.
 */
export function withHeadSymref(http: HttpClient, branch: string): HttpClient {
  return {
    async request(request) {
      const response = await http.request(request);
      const isAdvertisement =
        (request.method ?? 'GET') === 'GET' && request.url.includes('/info/refs?service=git-upload-pack') && response.statusCode === 200;
      if (!isAdvertisement || !response.body) return response;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) chunks.push(chunk);
      const body = addHeadSymref(concat(chunks), branch);
      const headers = { ...response.headers };
      delete headers['content-length'];
      return { ...response, headers, body: (async function* () { yield body; })() };
    },
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

/** Rewrite the first ref line of a pkt-line advertisement. Returns the input unchanged if unsure. */
export function addHeadSymref(body: Uint8Array, branch: string): Uint8Array {
  const decoder = new TextDecoder('latin1');
  const encode = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  let pos = 0;
  while (pos + 4 <= body.length) {
    const length = Number.parseInt(decoder.decode(body.subarray(pos, pos + 4)), 16);
    if (Number.isNaN(length)) return body;
    if (length === 0) {
      pos += 4;
      continue;
    }
    const payload = decoder.decode(body.subarray(pos + 4, pos + length));
    if (!payload.startsWith('#')) {
      const nul = payload.indexOf('\u0000');
      if (nul < 0 || /(^|\s)symref=HEAD:/.test(payload.slice(nul + 1))) return body;
      const newline = payload.endsWith('\n') ? '\n' : '';
      const rewritten = `${payload.slice(0, payload.length - newline.length)} symref=HEAD:refs/heads/${branch}${newline}`;
      const pkt = encode(`${(rewritten.length + 4).toString(16).padStart(4, '0')}${rewritten}`);
      return concat([body.subarray(0, pos), pkt, body.subarray(pos + length)]);
    }
    pos += length;
  }
  return body;
}

const auth = (remote: Remote) => () => ({ username: remote.username, password: remote.password });

/** The part of a promise-based file system removeDir() needs (Node's fs and createMemoryFs()). */
interface RemovableFs {
  promises: {
    readdir(path: string): Promise<string[]>;
    lstat(path: string): Promise<{ isDirectory(): boolean }>;
    unlink(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
  };
}

/** Delete a directory with everything in it (FsClient has no recursive rm). */
async function removeDir(fs: FsClient, path: string): Promise<void> {
  const p = (fs as unknown as RemovableFs).promises;
  for (const name of await p.readdir(path).catch(() => [] as string[])) {
    const child = `${path}/${name}`;
    if ((await p.lstat(child)).isDirectory()) await removeDir(fs, child);
    else await p.unlink(child);
  }
  await p.rmdir(path).catch(() => undefined);
}

/**
 * Clone the remote branch (objects only) and read the logbook at its tip. Only the latest commit
 * is fetched: Subsurface commits on every save, so a long-used logbook has thousands, and each
 * sync would download all of them. A push from it is a normal fast-forward of that commit.
 */
export async function fetchLogbook(env: GitEnv, remote: Remote): Promise<Snapshot> {
  const { fs, dir } = env;
  const http = withHeadSymref(env.http, remote.branch);
  try {
    const clone = (depth?: number) =>
      git.clone({
        fs,
        http,
        dir,
        url: remote.url,
        ...(remote.corsProxy ? { corsProxy: remote.corsProxy } : {}),
        ref: remote.branch,
        singleBranch: true,
        noCheckout: true,
        noTags: true,
        ...(depth ? { depth } : {}),
        onAuth: auth(remote),
      });
    try {
      await clone(1);
    } catch (error) {
      // a server that cannot send a shallow clone sends the whole history
      if ((error as { code?: string }).code !== 'RemoteCapabilityError') throw error;
      await removeDir(fs, dir);
      await clone();
    }
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
    // serializeLogbook() leaves its argument unchanged (tested), so the parsed logbook is reused
    const after = flattenTree(serializeLogbook(logbook));
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

/** Whether the branch exists on the remote (false for a new, empty repository). */
export async function remoteHasBranch(env: GitEnv, remote: Remote): Promise<boolean> {
  try {
    const refs = await git.listServerRefs({
      http: env.http,
      url: remote.url,
      ...(remote.corsProxy ? { corsProxy: remote.corsProxy } : {}),
      prefix: 'refs/heads/',
      protocolVersion: 1,
      onAuth: auth(remote),
    });
    return refs.some((r) => r.ref === `refs/heads/${remote.branch}`);
  } catch (error) {
    throw classify(error);
  }
}

/**
 * Write a logbook as the first commit of a branch that does not exist yet, for example to start
 * an own repository from a copy of the Subsurface cloud. Refuses if the branch exists.
 */
export async function initRemote(env: GitEnv, remote: Remote, logbook: Logbook, info: CommitInfo): Promise<string> {
  if (await remoteHasBranch(env, remote)) {
    throw new SyncError('conflict', `The branch "${remote.branch}" already exists on the server`);
  }
  const { fs, http, dir } = env;
  try {
    await git.init({ fs, dir, defaultBranch: remote.branch });
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
      commit: { message: info.message, tree, parent: [], author: signature, committer: signature },
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
