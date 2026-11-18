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
  applyEdit,
  applySiteEdit,
  applyTripEdit,
  commitMessageForChanges,
  editableCopy,
  exifDate,
  mergeEdits,
  pictureFileName,
  pictureOffset,
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
  type DiveEdit,
  type DiveSite,
  type SiteEdit,
  type Trip,
  type TripEdit,
  type DiveNote,
  type GitTree,
  type Logbook,
  type Remote,
  type TripChoice,
} from '@topside/core';
import { APP_NAME } from './brand.ts';
import { dbDelete, dbGet, dbSet, persistStorage } from './db.ts';
import { deleteMedia, loadMediaList, mediaBlob, saveMediaList, storeMedia, takenAt, type MediaItem } from './media.ts';
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
  /** inspect() of `files` when they were saved; older versions did not store it */
  problems?: string[];
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
  /** Number of changed dives that were uploaded */
  edited?: number;
}

/** The remote branch does not exist yet (new, empty repository). */
export class EmptyRemoteError extends Error {}

const WORKSPACE_KEY = 'workspace';
const PENDING_KEY = 'pending';
const EDITS_KEY = 'edits';
const SITE_EDITS_KEY = 'siteEdits';
const TRIP_EDITS_KEY = 'tripEdits';
const NOTES_KEY = 'notes';
const ADD_INPUT_KEY = 'addInput';

/** What is typed on the "New" page before uploading, kept so that leaving the page loses nothing. */
export interface AddInput {
  drafts: DiveDraft[];
  /** draft key → id of the note that filled it */
  noteFor: Record<string, string>;
  trip: TripChoice;
}

/** Two edits of the same dive as one (see mergeEdits). */
function mergeEdit(edits: DiveEdit[], edit: DiveEdit): DiveEdit[] {
  const earlier = edits.find((e) => e.when === edit.when);
  return earlier ? edits.map((e) => (e === earlier ? mergeEdits(earlier, edit) : e)) : [...edits, edit];
}

function mergeSiteEdit(edits: SiteEdit[], edit: SiteEdit): SiteEdit[] {
  const earlier = edits.find((e) => e.uuid === edit.uuid);
  return earlier ? edits.map((e) => (e === earlier ? { ...earlier, ...edit } : e)) : [...edits, edit];
}

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
  /** Changes to dives already in the logbook, not synced yet. */
  edits = $state.raw<DiveEdit[]>([]);
  /** Changes to dive sites, not synced yet. */
  siteEdits = $state.raw<SiteEdit[]>([]);
  /** Changes to trips, not synced yet; applied in order (a trip is named by its location) */
  tripEdits = $state.raw<TripEdit[]>([]);
  /** Notes for dives whose FIT file does not exist yet. Kept on this device only. */
  notes = $state.raw<DiveNote[]>([]);
  /** Pictures kept on this device */
  media = $state.raw<MediaItem[]>([]);
  /** Why the current logbook must not be written. */
  problems = $state.raw<string[]>([]);

  /** The secret for the current source, in memory only. */
  private secret: string | null = null;
  /** Set by the UI: asks the user for a password or token. */
  askSecret: ((label: string) => Promise<string | null>) | null = null;

  /**
   * The stored logbook, parsed once per state. Never change it: changes go to an editableCopy(),
   * which shares the samples with it.
   */
  logbook = $derived(this.tree ? parseLogbook(this.tree).logbook : null);

  /** The logbook with pending dives and edits applied, and which dives are not synced. */
  view = $derived.by(() => {
    if (!this.logbook) return null;
    const logbook = editableCopy(this.logbook);
    const pendingDives = new Set<Dive>();
    for (const batch of this.pending) {
      try {
        for (const d of applyDrafts(logbook, batch.drafts, batch.trip).added) pendingDives.add(d);
      } catch {
        // a chosen trip vanished; shown again after the next sync
      }
    }
    for (const edit of this.edits) {
      const dive = applyEdit(logbook, edit);
      if (dive) pendingDives.add(dive);
    }
    for (const edit of this.siteEdits) applySiteEdit(logbook, edit);
    for (const edit of this.tripEdits) applyTripEdit(logbook, edit);
    return { logbook, pendingDives };
  });

  pendingCount = $derived(this.pending.reduce((n, b) => n + b.drafts.length, 0) + this.edits.length + this.siteEdits.length + this.tripEdits.length);
  label = $derived(this.source ? sourceLabel(this.source) : '');

  async load(): Promise<void> {
    try {
      const stored = await dbGet<StoredWorkspace>(WORKSPACE_KEY);
      if (stored) {
        this.source = stored.source;
        this.tree = unflattenTree(stored.files);
        this.commit = stored.commit;
        this.savedAt = stored.savedAt;
        // the check is stored with the logbook; parsing and writing it again here took seconds
        this.problems = stored.problems ?? inspect(this.tree).problems;
      }
      this.pending = (await dbGet<PendingBatch[]>(PENDING_KEY)) ?? [];
      this.edits = (await dbGet<DiveEdit[]>(EDITS_KEY)) ?? [];
      this.siteEdits = (await dbGet<SiteEdit[]>(SITE_EDITS_KEY)) ?? [];
      this.tripEdits = (await dbGet<TripEdit[]>(TRIP_EDITS_KEY)) ?? [];
      this.notes = (await dbGet<DiveNote[]>(NOTES_KEY)) ?? [];
      this.media = await loadMediaList();
    } finally {
      this.loaded = true;
    }
  }

  /**
   * Keep `tree` as the logbook on this device. `problems` is what inspect() says about it; the
   * callers know it already (a fetched snapshot was inspected, and Topside's own output of a
   * logbook that passed the check needs none). Remote writes are checked again on every fetch.
   */
  private async save(source: Source, tree: GitTree, commit: string | null, problems: string[]): Promise<void> {
    const stored: StoredWorkspace = { source, files: [...flattenTree(tree)], commit, savedAt: Date.now(), problems };
    await dbSet(WORKSPACE_KEY, stored);
    this.source = source;
    this.tree = tree;
    this.commit = commit;
    this.savedAt = stored.savedAt;
    this.problems = problems;
    void persistStorage();
  }

  /** A copy of the stored logbook to change (local mode). */
  private editable(): Logbook {
    if (!this.logbook) throw new Error('No logbook');
    return editableCopy(this.logbook);
  }

  private async savePending(pending: PendingBatch[]): Promise<void> {
    await dbSet(PENDING_KEY, pending);
    this.pending = pending;
  }

  private async saveEdits(edits: DiveEdit[]): Promise<void> {
    await dbSet(EDITS_KEY, edits);
    this.edits = edits;
  }

  private async saveSiteEdits(edits: SiteEdit[]): Promise<void> {
    await dbSet(SITE_EDITS_KEY, edits);
    this.siteEdits = edits;
  }

  private async saveTripEdits(edits: TripEdit[]): Promise<void> {
    await dbSet(TRIP_EDITS_KEY, edits);
    this.tripEdits = edits;
  }

  // ---- Notes ------------------------------------------------------------------------------------

  async saveNote(note: DiveNote): Promise<void> {
    const notes = [...this.notes.filter((n) => n.id !== note.id), structuredClone(note)].sort((a, b) => a.when - b.when);
    await dbSet(NOTES_KEY, notes);
    this.notes = notes;
    void persistStorage();
  }

  loadAddInput(): Promise<AddInput | undefined> {
    return dbGet<AddInput>(ADD_INPUT_KEY);
  }

  /** Keep the input of the "New" page; null when there is nothing left to upload. */
  async saveAddInput(input: AddInput | null): Promise<void> {
    if (input) await dbSet(ADD_INPUT_KEY, input);
    else await dbDelete(ADD_INPUT_KEY);
  }

  async deleteNotes(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const notes = this.notes.filter((n) => !ids.includes(n.id));
    await dbSet(NOTES_KEY, notes);
    this.notes = notes;
  }

  // ---- Secrets --------------------------------------------------------------------------------

  /**
   * Set when the server rejected the password: the password manager's copy is then skipped and
   * the user is asked, otherwise a changed password could never be typed in (Chrome hands the
   * stored one over without asking).
   */
  private askAgain = false;

  private async secretFor(source: RemoteSource): Promise<string> {
    if (this.secret) return this.secret;
    if (!this.askAgain) {
      const recalled = await recallSecret(credentialId(source));
      if (recalled) return (this.secret = recalled);
    }
    const asked = await this.askSecret?.(sourceLabel(source));
    if (!asked) throw new SyncError('auth', 'No password given');
    return asked;
  }

  /** The server accepted `secret`. */
  private accepted(secret: string): void {
    this.secret = secret;
    this.askAgain = false;
  }

  /** Runs an operation on the current remote; a rejected password is forgotten. */
  private async withCurrentSecret<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'auth') {
        this.secret = null;
        this.askAgain = true;
      }
      throw error;
    }
  }

  // ---- Setting up -----------------------------------------------------------------------------

  /** Connect to a remote and keep its logbook. Throws EmptyRemoteError for an empty repository. */
  async connect(source: RemoteSource, secret: string): Promise<void> {
    await requireProxy();
    const remote = remoteFor(source, secret);
    if (!(await remoteHasBranch(freshEnv(), remote))) throw new EmptyRemoteError();
    const snapshot = await fetchLogbook(freshEnv(), remote);
    this.accepted(secret);
    await this.save(source, snapshot.tree, snapshot.commit, snapshot.problems);
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
    await this.save({ kind: 'local' }, serializeLogbook(logbook), null, []);
  }

  /**
   * Delete everything on this device. With `keepDeviceData` the dive notes and pictures stay
   * (switching to a copy of the same logbook).
   */
  async signOut(keepDeviceData = false): Promise<void> {
    await dbDelete(WORKSPACE_KEY);
    await dbDelete(PENDING_KEY);
    await dbDelete(EDITS_KEY);
    await dbDelete(SITE_EDITS_KEY);
    await dbDelete(TRIP_EDITS_KEY);
    if (!keepDeviceData) {
      await dbDelete(NOTES_KEY);
      await dbDelete(ADD_INPUT_KEY);
      this.notes = [];
      for (const item of this.media) await deleteMedia(item.filename);
      await saveMediaList([]);
      this.media = [];
    }
    this.source = null;
    this.tree = null;
    this.commit = null;
    this.pending = [];
    this.edits = [];
    this.siteEdits = [];
    this.tripEdits = [];
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
      const logbook = this.editable();
      const { added, duplicates } = applyDrafts(logbook, drafts, trip);
      await this.save(this.source, serializeLogbook(logbook), null, []);
      return { added, skipped: duplicates.length };
    }
    const batch: PendingBatch = { id: crypto.randomUUID(), drafts: structuredClone(drafts), trip: structuredClone(trip), createdAt: Date.now() };
    await this.savePending([...this.pending, batch]);
    return { added: [], skipped: 0 };
  }

  // ---- Dropping changes that are not synced yet ----------------------------------------------

  /** Drop new dives that are not synced yet, with their changes and their pictures on this device. */
  async discardBatch(batch: PendingBatch): Promise<void> {
    const whens = new Set(batch.drafts.map((d) => d.fit.dive.when));
    await this.savePending(this.pending.filter((b) => b.id !== batch.id));
    await this.saveEdits(this.edits.filter((e) => !whens.has(e.when)));
    await this.dropMedia((m) => whens.has(m.diveWhen));
  }

  /** Drop a change of a dive; pictures it added stay off the dive and leave this device. */
  async discardEdit(edit: DiveEdit): Promise<void> {
    await this.saveEdits(this.edits.filter((e) => e !== edit));
    const added = new Set((edit.addPictures ?? []).map((p) => p.filename));
    await this.dropMedia((m) => added.has(m.filename));
  }

  async discardSiteEdit(edit: SiteEdit): Promise<void> {
    await this.saveSiteEdits(this.siteEdits.filter((e) => e !== edit));
  }

  async discardTripEdit(edit: TripEdit): Promise<void> {
    await this.saveTripEdits(this.tripEdits.filter((e) => e !== edit));
  }

  /** Drop everything that is not synced yet. */
  async discardPending(): Promise<void> {
    for (const batch of this.pending) await this.discardBatch(batch);
    for (const edit of this.edits) await this.discardEdit(edit);
    await this.saveSiteEdits([]);
    await this.saveTripEdits([]);
  }

  private async dropMedia(drop: (item: MediaItem) => boolean): Promise<void> {
    const gone = this.media.filter(drop);
    if (gone.length === 0) return;
    for (const item of gone) await deleteMedia(item.filename);
    const media = this.media.filter((m) => !drop(m));
    await saveMediaList(media);
    this.media = media;
  }

  // ---- Editing dives ----------------------------------------------------------------------------

  /**
   * Change a dive. In local mode the logbook changes directly; otherwise the edit is kept and
   * uploaded by sync(), applied to the then current state of the remote logbook.
   */
  async editDive(edit: DiveEdit): Promise<void> {
    if (!this.source || !this.tree) throw new Error('No logbook');
    if (this.source.kind === 'local') {
      const logbook = this.editable();
      if (!applyEdit(logbook, edit)) throw new Error('This dive is no longer in the logbook');
      await this.save(this.source, serializeLogbook(logbook), null, []);
      return;
    }
    await this.saveEdits(mergeEdit(this.edits, structuredClone(edit)));
  }

  /**
   * Delete a dive. One that is not synced yet is simply dropped from the pending dives; its
   * pictures on this device go as well.
   */
  async deleteDive(dive: Dive): Promise<void> {
    if (!this.source || !this.tree) throw new Error('No logbook');
    const when = dive.when;
    const pendingNew = this.pending.some((b) => b.drafts.some((d) => d.fit.dive.when === when));
    if (pendingNew) {
      const pending = this.pending
        .map((b) => ({ ...b, drafts: b.drafts.filter((d) => d.fit.dive.when !== when) }))
        .filter((b) => b.drafts.length > 0);
      await this.savePending(pending);
      await this.saveEdits(this.edits.filter((e) => e.when !== when));
    } else {
      await this.editDive({ when, changes: {}, delete: true });
    }
    const gone = this.media.filter((m) => m.diveWhen === when);
    for (const item of gone) await deleteMedia(item.filename);
    if (gone.length) {
      const media = this.media.filter((m) => m.diveWhen !== when);
      await saveMediaList(media);
      this.media = media;
    }
  }

  /** Rename a trip or change its notes; like editDive(). */
  async editTrip(edit: TripEdit): Promise<void> {
    if (!this.source || !this.tree) throw new Error('No logbook');
    if (this.source.kind === 'local') {
      const logbook = this.editable();
      if (!applyTripEdit(logbook, edit)) throw new Error('This trip is no longer in the logbook');
      await this.save(this.source, serializeLogbook(logbook), null, []);
      return;
    }
    await this.saveTripEdits([...this.tripEdits, structuredClone(edit)]);
  }

  /** Change a dive site; like editDive(). Only sites that are already synced can be changed. */
  async editSite(edit: SiteEdit): Promise<void> {
    if (!this.source || !this.tree) throw new Error('No logbook');
    if (this.source.kind === 'local') {
      const logbook = this.editable();
      if (!applySiteEdit(logbook, edit)) throw new Error('This dive site is no longer in the logbook');
      await this.save(this.source, serializeLogbook(logbook), null, []);
      return;
    }
    await this.saveSiteEdits(mergeSiteEdit(this.siteEdits, structuredClone(edit)));
  }

  // ---- Pictures ---------------------------------------------------------------------------------

  /**
   * Keep pictures on this device and add references to them to the dive. The reference is a logbook
   * change like any edit: direct in local mode, otherwise uploaded with the next sync.
   */
  async addPictures(dive: Dive, files: readonly File[]): Promise<number> {
    const logbook = this.view?.logbook;
    if (!logbook || files.length === 0) return 0;
    const taken = new Set([...logbook.dives.flatMap((d) => d.pictures), ...this.media].map((p) => p.filename.toLowerCase()));
    const added: MediaItem[] = [];
    const pictures = [];
    for (const file of files) {
      const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      const filename = pictureFileName(logbook, dive, file.name, taken);
      taken.add(filename.toLowerCase());
      await storeMedia(filename, file);
      added.push({ filename, diveWhen: dive.when, type: file.type, size: file.size, addedAt: Date.now() });
      pictures.push({ offset: pictureOffset(dive, takenAt(file, exifDate(head))), filename, location: null });
    }
    const media = [...this.media, ...added];
    await saveMediaList(media);
    this.media = media;
    void persistStorage();
    await this.editDive({ when: dive.when, changes: {}, addPictures: pictures });
    return added.length;
  }

  /** Remove a picture reference from the dive, and the picture from this device. */
  async removePicture(dive: Dive, filename: string): Promise<void> {
    await this.editDive({ when: dive.when, changes: {}, removePictures: [filename] });
    await deleteMedia(filename);
    const media = this.media.filter((m) => m.filename !== filename);
    await saveMediaList(media);
    this.media = media;
  }

  mediaBlob(filename: string, preview = false): Promise<Blob | null> {
    return mediaBlob(filename, preview);
  }

  /** Whether a site can be edited: it must exist in the synced logbook, not only in a pending dive. */
  isSyncedSite(uuid: number): boolean {
    return this.logbook?.sites.some((s) => s.uuid === uuid) ?? false;
  }

  // ---- Syncing ----------------------------------------------------------------------------------

  /** The remote operation that runs now; the next one waits for it. */
  private running: Promise<unknown> = Promise.resolve();

  /** Remote operations run one after the other, so two syncs never work on the same changes. */
  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.running.then(operation, operation);
    this.running = result.catch(() => undefined);
    return result;
  }

  /** Fetch the remote state, apply pending dives, push. Retries once if the remote moved on. */
  sync(): Promise<ChangeResult> {
    return this.queued(() => this.withCurrentSecret(() => this.syncNow()));
  }

  /**
   * Forget the changes a sync uploaded. Changes made while it ran stay for the next one (an edit
   * of the same dive replaces the uploaded one by a merged edit, which is applied again then).
   */
  private async forgetSynced(synced: { pending: PendingBatch[]; edits: DiveEdit[]; siteEdits: SiteEdit[]; tripEdits: TripEdit[] }): Promise<void> {
    await this.savePending(this.pending.filter((b) => !synced.pending.includes(b)));
    await this.saveEdits(this.edits.filter((e) => !synced.edits.includes(e)));
    await this.saveSiteEdits(this.siteEdits.filter((e) => !synced.siteEdits.includes(e)));
    await this.saveTripEdits(this.tripEdits.filter((e) => !synced.tripEdits.includes(e)));
  }

  private async syncNow(): Promise<ChangeResult> {
    const source = this.source;
    if (!source || !isRemote(source)) throw new Error('Nothing to sync');
    await requireProxy();
    const secret = await this.secretFor(source);
    const remote = remoteFor(source, secret);
    for (let attempt = 1; ; attempt++) {
      const env = freshEnv();
      const snapshot = await fetchLogbook(env, remote);
      this.accepted(secret);
      if (snapshot.problems.length > 0) {
        await this.save(source, snapshot.tree, snapshot.commit, snapshot.problems);
        throw new SyncError('unsupported', snapshot.problems[0]!);
      }
      // fetched for this sync only, so it can take the changes directly
      const logbook = snapshot.logbook;
      const synced = { pending: this.pending, edits: this.edits, siteEdits: this.siteEdits, tripEdits: this.tripEdits };
      const added: Dive[] = [];
      const edited: Dive[] = [];
      let skipped = 0;
      for (const batch of synced.pending) {
        const result = applyDrafts(logbook, batch.drafts, batch.trip);
        added.push(...result.added);
        skipped += result.duplicates.length;
      }
      const deleted: Dive[] = [];
      for (const edit of synced.edits) {
        // an edit of a dive that was deleted elsewhere meanwhile is dropped
        const dive = applyEdit(logbook, edit);
        if (!dive) skipped++;
        else if (edit.delete) deleted.push(dive);
        else edited.push(dive);
      }
      const sites: DiveSite[] = [];
      for (const edit of synced.siteEdits) {
        const site = applySiteEdit(logbook, edit);
        if (site) sites.push(site);
      }
      const trips: Trip[] = [];
      for (const edit of synced.tripEdits) {
        const trip = applyTripEdit(logbook, edit);
        if (trip) trips.push(trip);
      }
      const changes = edited.length + deleted.length + sites.length + new Set(trips).size;
      if (added.length === 0 && changes === 0) {
        await this.save(source, snapshot.tree, snapshot.commit, []);
        await this.forgetSynced(synced);
        return { added, skipped, edited: 0 };
      }
      try {
        const message = commitMessageForChanges(logbook, added, edited, agent(), { sites, trips, deleted });
        const commit = await pushLogbook(env, remote, snapshot, logbook, commitInfo(remote, message));
        await this.save(source, serializeLogbook(logbook), commit, []);
        await this.forgetSynced(synced);
        await rememberSecret(credentialId(source), secret, sourceLabel(source));
        return { added, skipped, edited: changes };
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
      const logbook = this.editable();
      const { added, skipped } = mergeDives(logbook, incoming);
      await this.save(source, serializeLogbook(logbook), null, []);
      return { added, skipped: skipped.length };
    }
    return this.queued(() =>
      this.withCurrentSecret(async () => {
        const secret = await this.secretFor(source);
        const result = await this.mergeIntoRemote(source, secret, incoming, true);
        this.accepted(secret);
        return result;
      }),
    );
  }

  /** Copy the dives of this logbook that the target is missing into another remote. */
  async transferTo(target: RemoteSource, secret: string): Promise<ChangeResult> {
    const view = this.view;
    if (!view) throw new Error('No logbook');
    await requireProxy();
    return this.queued(() => this.mergeIntoRemote(target, secret, view.logbook, false));
  }

  private async mergeIntoRemote(target: RemoteSource, secret: string, incoming: Logbook, isCurrent: boolean): Promise<ChangeResult> {
    await requireProxy();
    const remote = remoteFor(target, secret);
    for (let attempt = 1; ; attempt++) {
      const env = freshEnv();
      const snapshot = await fetchLogbook(env, remote);
      if (snapshot.problems.length > 0) throw new SyncError('unsupported', snapshot.problems[0]!);
      const logbook = snapshot.logbook;
      const { added, skipped } = mergeDives(logbook, incoming);
      if (added.length === 0) {
        if (isCurrent) await this.save(target, snapshot.tree, snapshot.commit, []);
        return { added, skipped: skipped.length };
      }
      try {
        const commit = await pushLogbook(env, remote, snapshot, logbook, commitInfo(remote, commitMessageForNewDives(logbook, added, agent())));
        if (isCurrent) await this.save(target, serializeLogbook(logbook), commit, []);
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
      await this.save(source, tree, null, []);
      return;
    }
    await this.queued(() => this.withCurrentSecret(async () => {
      await requireProxy();
      const secret = await this.secretFor(source);
      const remote = remoteFor(source, secret);
      const env = freshEnv();
      const snapshot = await fetchLogbook(env, remote);
      this.accepted(secret);
      const commit = await pushLogbook(env, remote, snapshot, check.logbook, commitInfo(remote, `Restore backup\n\nCreated by ${agent()}\n`));
      await this.save(source, serializeLogbook(check.logbook), commit, []);
    }));
  }
}

export const workspace = new Workspace();
