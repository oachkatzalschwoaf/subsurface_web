/**
 * Where a logbook lives: the Subsurface cloud, an own git repository, or only this device.
 */
import { SyncError, type Remote } from '@topside/core';

export const DEFAULT_SERVER = 'https://ssrf-cloud-u2.subsurface-divelog.org';

export type Source =
  | { kind: 'cloud'; server: string; email: string }
  | { kind: 'git'; url: string; branch: string; username: string }
  | { kind: 'local' };

export type RemoteSource = Exclude<Source, { kind: 'local' }>;

export function isRemote(source: Source): source is RemoteSource {
  return source.kind !== 'local';
}

/** Short label for the UI. */
export function sourceLabel(source: Source): string {
  if (source.kind === 'cloud') return `Subsurface Cloud · ${source.email}`;
  if (source.kind === 'git') {
    try {
      const url = new URL(source.url);
      return `git · ${url.host}${url.pathname.replace(/\.git$/, '')} (${source.branch})`;
    } catch {
      return `git · ${source.url}`;
    }
  }
  return '';
}

/** Identifier under which the browser's password manager keeps the secret. */
export function credentialId(source: RemoteSource): string {
  if (source.kind === 'cloud') return source.email;
  try {
    return `${source.username}@${new URL(source.url).host}`;
  } catch {
    return source.username;
  }
}

const proxyBase = () => new URL('git-proxy.php', document.baseURI).href.replace(/\/$/, '');

export function remoteFor(source: RemoteSource, secret: string): Remote {
  if (source.kind === 'cloud') {
    const email = source.email.trim();
    return {
      url: `${source.server.replace(/\/+$/, '')}/git/${email}`,
      branch: email,
      username: email,
      password: secret,
      corsProxy: proxyBase(),
    };
  }
  return {
    url: source.url.trim(),
    branch: source.branch.trim() || 'main',
    username: source.username.trim() || 'git',
    password: secret,
    corsProxy: proxyBase(),
  };
}

/** Thrown when git-proxy.php is not running, e.g. the page is served without PHP. */
export class ProxyMissingError extends Error {}

/**
 * Throws ProxyMissingError when git-proxy.php does not answer as itself (no PHP, or a hotel
 * Wi-Fi login page in between), and a network SyncError when there is no connection at all.
 */
export async function requireProxy(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL('git-proxy.php?ping', document.baseURI), { cache: 'no-store' });
  } catch {
    throw new SyncError('network', '');
  }
  if (!response.ok || !(await response.text()).startsWith('topside-proxy')) throw new ProxyMissingError();
}

// ---- Password manager ----------------------------------------------------------------------

interface PasswordCredentialLike {
  id: string;
  password?: string;
}
type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;

/** Hand the secret to the browser's password manager (Chromium); elsewhere autofill does it. */
export async function rememberSecret(id: string, secret: string, name: string): Promise<void> {
  const Ctor = (window as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (!Ctor || !navigator.credentials) return;
  try {
    await navigator.credentials.store(new Ctor({ id, password: secret, name }));
  } catch {
    // declined
  }
}

/** The secret for `id`, if the password manager hands it over without asking. */
export async function recallSecret(id: string): Promise<string | null> {
  if (!(window as { PasswordCredential?: unknown }).PasswordCredential || !navigator.credentials) return null;
  try {
    const c = (await navigator.credentials.get({ password: true, mediation: 'optional' } as CredentialRequestOptions)) as PasswordCredentialLike | null;
    return c?.password && c.id === id ? c.password : null;
  } catch {
    return null;
  }
}
