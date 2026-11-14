/**
 * Talks to the Subsurface cloud from the browser: a throw-away repository in IndexedDB and the
 * git proxy next to the app.
 */
import {
  applyDrafts,
  createMemoryFs,
  commitMessageForNewDives,
  fetchLogbook,
  inspect,
  pushLogbook,
  SyncError,
  type Dive,
  type DiveDraft,
  type GitEnv,
  type Remote,
  type Snapshot,
  type TripChoice,
} from '@topside/core';
import http from 'isomorphic-git/http/web';

export const DEFAULT_SERVER = 'https://ssrf-cloud-u2.subsurface-divelog.org';
export const APP_VERSION = '0.1.0';

export interface Account {
  server: string;
  email: string;
  password: string;
}

function remoteFor(account: Account): Remote {
  const email = account.email.trim();
  return {
    url: `${account.server.replace(/\/+$/, '')}/git/${email}`,
    branch: email,
    username: email,
    password: account.password,
    corsProxy: new URL('git-proxy.php', document.baseURI).href.replace(/\/$/, ''),
  };
}

/** A fresh repository in memory each time: the logbook is small and stale state is the bigger risk. */
function freshEnv(): GitEnv {
  return { fs: createMemoryFs(), http, dir: '/repo' };
}

/** Thrown when git-proxy.php is not running, e.g. the page is served without PHP. */
export class ProxyMissingError extends Error {}

/** True if git-proxy.php answers. A static file server returns a 404 page or the PHP source instead. */
export async function proxyAvailable(): Promise<boolean> {
  try {
    const response = await fetch(new URL('git-proxy.php?ping', document.baseURI), { cache: 'no-store' });
    return response.ok && (await response.text()).startsWith('topside-proxy');
  } catch {
    return false;
  }
}

export async function download(account: Account): Promise<Snapshot> {
  if (!(await proxyAvailable())) throw new ProxyMissingError();
  return fetchLogbook(freshEnv(), remoteFor(account));
}

export interface UploadResult {
  added: Dive[];
  duplicates: DiveDraft[];
  snapshot: Snapshot;
}

/**
 * Fetch the current logbook, add the drafts and push. If someone else pushed in between, do it
 * all again once on the newer state; nothing is ever overwritten.
 */
export async function upload(account: Account, drafts: DiveDraft[], trip: TripChoice): Promise<UploadResult> {
  if (!(await proxyAvailable())) throw new ProxyMissingError();
  const remote = remoteFor(account);
  for (let attempt = 1; ; attempt++) {
    const env = freshEnv();
    const snapshot = await fetchLogbook(env, remote);
    if (snapshot.problems.length > 0) throw new SyncError('unsupported', snapshot.problems[0]!);
    const { logbook } = inspect(snapshot.tree);
    const { added, duplicates } = applyDrafts(logbook, drafts, trip);
    if (added.length === 0) return { added, duplicates, snapshot };
    try {
      await pushLogbook(env, remote, snapshot, logbook, {
        message: commitMessageForNewDives(logbook, added, `Topside:${APP_VERSION}:${navigator.platform || 'web'}`),
        authorName: 'Topside',
        authorEmail: remote.username,
      });
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'conflict' && attempt < 2) continue;
      throw error;
    }
    return { added, duplicates, snapshot: await fetchLogbook(freshEnv(), remote) };
  }
}

// ---- Remembering the account ---------------------------------------------------------------

const SETTINGS_KEY = 'topside.account';

/** E-mail and server are remembered in localStorage; the password never is. */
export function loadSettings(): { server: string; email: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { server?: string; email?: string };
    return { server: raw.server || DEFAULT_SERVER, email: raw.email ?? '' };
  } catch {
    return { server: DEFAULT_SERVER, email: '' };
  }
}

export function saveSettings(account: Account): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ server: account.server, email: account.email }));
  } catch {
    // private mode: not remembered
  }
}

interface PasswordCredentialLike {
  id: string;
  password?: string;
}
type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;

/** Hand the login to the browser's password manager (Chromium). Elsewhere autofill does the job. */
export async function rememberLogin(account: Account): Promise<void> {
  const Ctor = (window as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (!Ctor || !navigator.credentials) return;
  try {
    await navigator.credentials.store(new Ctor({ id: account.email, password: account.password, name: 'Subsurface cloud' }));
  } catch {
    // declined by the user or the browser
  }
}

/** A login the password manager is willing to hand over without asking, if any. */
export async function recallLogin(): Promise<{ email: string; password: string } | null> {
  if (!(window as { PasswordCredential?: unknown }).PasswordCredential || !navigator.credentials) return null;
  try {
    const credential = (await navigator.credentials.get({ password: true, mediation: 'optional' } as CredentialRequestOptions)) as PasswordCredentialLike | null;
    return credential?.password ? { email: credential.id, password: credential.password } : null;
  } catch {
    return null;
  }
}
