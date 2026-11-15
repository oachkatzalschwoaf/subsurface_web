/**
 * The logbook on this device: an offline copy of the remote logbook (or the only copy, in local
 * mode), plus dives entered but not synced yet. Everything is kept in IndexedDB so the app works
 * without network and without signing in again.
 *
 * Syncing never merges on the device: it fetches the current remote state, applies the pending
 * dives to it and pushes a new commit on top. Nothing is ever overwritten.
 */
import {
  applyDrafts,
  commitMessageForNewDives,
  fetchLogbook,
  flattenTree,
  initRemote,
  inspect,
  mergeDives,
  newSettings,
  parseLogbook,
  pushLogbook,
  remoteHasBranch,
  serializeLogbook,
  serializeXml,
  SyncError,
  unflattenTree,
  type CommitInfo,
  type Dive,
  type DiveDraft,
  type GitTree,
  type Logbook,
  type Remote,
  type TripChoice,
} from '@topside/core';
import { APP_NAME } from './brand.ts';
import { dbDelete, dbGet, dbSet, persistStorage } from './db.ts';
import {
  credentialId,
  freshEnv,
  isRemote,
  recallSecret,
  rememberSecret,
  remoteFor,
  requireProxy,
  sourceLabel,
  type RemoteSource,
  type Source,
} from './sources.ts';

export const APP_VERSION = '0.2.0';

interface StoredWorkspace {
  source: Source;
  files: [string, string][];
  commit: string | null;
  savedAt: number;
}

export interface PendingBatch {
  id: string;
  drafts: DiveDraft[];
  trip: TripChoice;
  createdAt: number;
}

export interface ChangeResult {
  added: Dive[];
  skipped: number;
}

/** The remote branch does not exist yet (new, empty repository). */
export class EmptyRemoteError extends Error {}

const WORKSPACE_KEY = 'workspace';
const PENDING_KEY = 'pending';

export function emptyLogbook(): Logbook {
  return { settings: { ...newSettings(), units: 'METRIC' }, sites: [], filterPresets: [], trips: [], dives: [] };
}

function commitInfo(remote: Remote, message: string): CommitInfo {
  const email = remote.username.includes('@') ? remote.username : `${remote.username}@topside.invalid`;
  return { message, authorName: APP_NAME, authorEmail: email };
}

const agent = () => `${APP_NAME}:${APP_VERSION}:${navigator.platform || 'web'}`;

class Workspace {
  loaded = $state(false);
  source = $state.raw<Source | null>(null);
  tree = $state.raw<GitTree | null>(null);
  commit = $state<string | null>(null);
  savedAt = $state(0);
  pending = $state.raw<PendingBatch[]>([]);
  /** Why the current logbook must not be written. */
  problems = $state.raw<string[]>([]);

  /** The secret for the current source, in memory only. */
  private secret: string | null = null;
  /** Set by the UI: asks the user for a password or token. */
  askSecret: ((label: string) => Promise<string | null>) | null = null;

  logbook = $derived(this.tree ? parseLogbook(this.tree).logbook : null);

  /** The logbook with the pending dives applied, and which dives are pending. */
  view = $derived.by(() => {
    if (!this.tree) return null;
    const logbook = parseLogbook(this.tree).logbook;
    const pendingDives = new Set<Dive>();
    for (const batch of this.pending) {
      try {
        for (const d of applyDrafts(logbook, batch.drafts, batch.trip).added) pendingDives.add(d);
      } catch {
        // a chosen trip vanished; shown again after the next sync
      }
    }
    return { logbook, pendingDives };
  });

  pendingCount = $derived(this.pending.reduce((n, b) => n + b.drafts.length, 0));
  label = $derived(this.source ? sourceLabel(this.source) : '');

  async load(): Promise<void> {
    try {
      const stored = await dbGet<StoredWorkspace>(WORKSPACE_KEY);
      if (stored) {
        this.source = stored.source;
        this.tree = unflattenTree(stored.files);
        this.commit = stored.commit;
        this.savedAt = stored.savedAt;
        this.problems = inspect(this.tree).problems;
      }
      this.pending = (await dbGet<PendingBatch[]>(PENDING_KEY)) ?? [];
    } finally {
      this.loaded = true;
    }
  }

  private async save(source: Source, tree: GitTree, commit: string | null): Promise<void> {
    const stored: StoredWorkspace = { source, files: [...flattenTree(tree)], commit, savedAt: Date.now() };
    await dbSet(WORKSPACE_KEY, stored);
    this.source = source;
    this.tree = tree;
    this.commit = commit;
    this.savedAt = stored.savedAt;
    this.problems = inspect(tree).problems;
    void persistStorage();
  }

  private async savePending(pending: PendingBatch[]): Promise<void> {
    await dbSet(PENDING_KEY, pending);
    this.pending = pending;
  }

  // ---- Secrets --------------------------------------------------------------------------------

  private async secretFor(source: RemoteSource): Promise<string> {
    if (this.secret) return this.secret;
    const recalled = await recallSecret(credentialId(source));
    if (recalled) return (this.secret = recalled);
    const asked = await this.askSecret?.(sourceLabel(source));
    if (!asked) throw new SyncError('auth', 'No password given');
    return asked;
  }

  // ---- Setting up -----------------------------------------------------------------------------

  /** Connect to a remote and keep its logbook. Throws EmptyRemoteError for an empty repository. */
  async connect(source: RemoteSource, secret: string): Promise<void> {
    await requireProxy();
    const remote = remoteFor(source, secret);
    if (!(await remoteHasBranch(freshEnv(), remote))) throw new EmptyRemoteError();
    const snapshot = await fetchLogbook(freshEnv(), remote);
    this.secret = secret;
    await this.save(source, snapshot.tree, snapshot.commit);
    await rememberSecret(credentialId(source), secret, sourceLabel(source));
  }

  /** Start an empty remote repository with `logbook`, then connect to it. */
  async createRemote(source: RemoteSource, secret: string, logbook: Logbook): Promise<void> {
    await requireProxy();
    const remote = remoteFor(source, secret);
    await initRemote(freshEnv(), remote, logbook, commitInfo(remote, `Start logbook\n\nCreated by ${agent()}\n`));
    await this.connect(source, secret);
  }

  /** Keep a logbook on this device only. */
  async startLocal(logbook: Logbook): Promise<void> {
    await this.save({ kind: 'local' }, serializeLogbook(logbook), null);
  }

  /** Delete everything on this device. */
  async signOut(): Promise<void> {
    await dbDelete(WORKSPACE_KEY);
    await dbDelete(PENDING_KEY);
    this.source = null;
    this.tree = null;
    this.commit = null;
    this.pending = [];
    this.problems = [];
    this.secret = null;
    navigator.credentials?.preventSilentAccess?.();
  }

  // ---- Adding dives -----------------------------------------------------------------------------

  /**
   * Add new dives. In local mode they go straight into the logbook; otherwise they are kept as
   * pending and uploaded by sync().
   */
  async addDives(drafts: DiveDraft[], trip: TripChoice): Promise<ChangeResult> {
    if (!this.source || !this.tree) throw new Error('No logbook');
    if (this.source.kind === 'local') {
      const logbook = parseLogbook(this.tree).logbook;
      const { added, duplicates } = applyDrafts(logbook, drafts, trip);
      await this.save(this.source, serializeLogbook(logbook), null);
      return { added, skipped: duplicates.length };
    }
    const batch: PendingBatch = { id: crypto.randomUUID(), drafts: structuredClone(drafts), trip: structuredClone(trip), createdAt: Date.now() };
    await this.savePending([...this.pending, batch]);
    return { added: [], skipped: 0 };
  }

  async discardPending(): Promise<void> {
    await this.savePending([]);
  }

  // ---- Syncing ----------------------------------------------------------------------------------

  /** Fetch the remote state, apply pending dives, push. Retries once if the remote moved on. */
  async sync(): Promise<ChangeResult> {
    const source = this.source;
    if (!source || !isRemote(source)) throw new Error('Nothing to sync');
    await requireProxy();
    const secret = await this.secretFor(source);
    const remote = remoteFor(source, secret);
    for (let attempt = 1; ; attempt++) {
      const env = freshEnv();
      const snapshot = await fetchLogbook(env, remote);
      this.secret = secret;
      if (snapshot.problems.length > 0) {
        await this.save(source, snapshot.tree, snapshot.commit);
        throw new SyncError('unsupported', snapshot.problems[0]!);
      }
      const logbook = inspect(snapshot.tree).logbook;
      const added: Dive[] = [];
      let skipped = 0;
      for (const batch of this.pending) {
        const result = applyDrafts(logbook, batch.drafts, batch.trip);
        added.push(...result.added);
        skipped += result.duplicates.length;
      }
      if (added.length === 0) {
        await this.save(source, snapshot.tree, snapshot.commit);
        await this.savePending([]);
        return { added, skipped };
      }
      try {
        const commit = await pushLogbook(env, remote, snapshot, logbook, commitInfo(remote, commitMessageForNewDives(logbook, added, agent())));
        await this.save(source, serializeLogbook(logbook), commit);
        await this.savePending([]);
        await rememberSecret(credentialId(source), secret, sourceLabel(source));
        return { added, skipped };
      } catch (error) {
        if (error instanceof SyncError && error.kind === 'conflict' && attempt < 2) continue;
        throw error;
      }
    }
  }

  // ---- Data -------------------------------------------------------------------------------------

  /** Subsurface XML of the whole logbook (with pending dives), or of the pending dives only. */
  exportXml(onlyPending: boolean): string {
    const view = this.view;
    if (!view) throw new Error('No logbook');
    return serializeXml(view.logbook, onlyPending ? { dives: [...view.pendingDives] } : {});
  }

  /**
   * Bring the dives of `incoming` that are missing here into this logbook: directly in local
   * mode, otherwise as a commit on the remote.
   */
  async importDives(incoming: Logbook): Promise<ChangeResult> {
    const source = this.source;
    if (!source || !this.tree) throw new Error('No logbook');
    if (source.kind === 'local') {
      const logbook = parseLogbook(this.tree).logbook;
      const { added, skipped } = mergeDives(logbook, incoming);
      await this.save(source, serializeLogbook(logbook), null);
      return { added, skipped: skipped.length };
    }
    return this.mergeIntoRemote(source, await this.secretFor(source), incoming, true);
  }

  /** Copy the dives of this logbook that the target is missing into another remote. */
  async transferTo(target: RemoteSource, secret: string): Promise<ChangeResult> {
    const view = this.view;
    if (!view) throw new Error('No logbook');
    await requireProxy();
    return this.mergeIntoRemote(target, secret, view.logbook, false);
  }

  private async mergeIntoRemote(target: RemoteSource, secret: string, incoming: Logbook, isCurrent: boolean): Promise<ChangeResult> {
    await requireProxy();
    const remote = remoteFor(target, secret);
    for (let attempt = 1; ; attempt++) {
      const env = freshEnv();
      const snapshot = await fetchLogbook(env, remote);
      if (snapshot.problems.length > 0) throw new SyncError('unsupported', snapshot.problems[0]!);
      const logbook = inspect(snapshot.tree).logbook;
      const { added, skipped } = mergeDives(logbook, incoming);
      if (added.length === 0) {
        if (isCurrent) await this.save(target, snapshot.tree, snapshot.commit);
        return { added, skipped: skipped.length };
      }
      try {
        const commit = await pushLogbook(env, remote, snapshot, logbook, commitInfo(remote, commitMessageForNewDives(logbook, added, agent())));
        if (isCurrent) await this.save(target, serializeLogbook(logbook), commit);
        return { added, skipped: skipped.length };
      } catch (error) {
        if (error instanceof SyncError && error.kind === 'conflict' && attempt < 2) continue;
        throw error;
      }
    }
  }

  /** Start an empty own repository with a copy of this logbook (pending dives included). */
  async copyToNewRemote(target: RemoteSource, secret: string): Promise<void> {
    const view = this.view;
    if (!view) throw new Error('No logbook');
    await requireProxy();
    const remote = remoteFor(target, secret);
    await initRemote(freshEnv(), remote, view.logbook, commitInfo(remote, `Copy of ${this.label}\n\nCreated by ${agent()}\n`));
  }

  /**
   * Make a backup the current state: in local mode by replacing the logbook, otherwise as a new
   * commit on top (the history keeps everything in between).
   */
  async restore(tree: GitTree): Promise<void> {
    const source = this.source;
    if (!source) throw new Error('No logbook');
    const check = inspect(tree);
    if (check.problems.length > 0) throw new SyncError('unsupported', check.problems[0]!);
    if (source.kind === 'local') {
      await this.save(source, tree, null);
      return;
    }
    await requireProxy();
    const secret = await this.secretFor(source);
    const remote = remoteFor(source, secret);
    const env = freshEnv();
    const snapshot = await fetchLogbook(env, remote);
    const commit = await pushLogbook(env, remote, snapshot, check.logbook, commitInfo(remote, `Restore backup\n\nCreated by ${agent()}\n`));
    await this.save(source, serializeLogbook(check.logbook), commit);
  }
}

export const workspace = new Workspace();
