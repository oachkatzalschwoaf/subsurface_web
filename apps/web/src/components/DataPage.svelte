<script lang="ts">
  /** Sync status, export, backup, import, travel copy and transfer, sign out. */
  import { parseLogbook, parseXml } from '@topside/core';
  import { APP_NAME } from '../lib/brand.ts';
  import { backupZip, downloadFile, fullExportZip, readBackupZip, today } from '../lib/files.ts';
  import { clearGear } from '../lib/gear.ts';
  import { locale, t } from '../lib/i18n.ts';
  import { isRemote, sourceLabel, type RemoteSource } from '../lib/sources.ts';
  import { workspace } from '../lib/workspace.svelte.ts';
  import InstallHint from './InstallHint.svelte';
  import LanguagePicker from './LanguagePicker.svelte';
  import RemoteForm from './RemoteForm.svelte';

  let { busy, run }: { busy: boolean; run: (fn: () => Promise<string | void>) => Promise<void> } = $props();

  let panel = $state<'' | 'copy' | 'transfer'>('');
  let targetKind = $state<'cloud' | 'git'>('git');
  let copied = $state.raw<{ source: RemoteSource; secret: string } | null>(null);

  const when = $derived(workspace.savedAt ? new Date(workspace.savedAt).toLocaleString(locale) : '');
  const remote = $derived(workspace.source && isRemote(workspace.source));

  function exportXml(onlyPending: boolean) {
    const xml = workspace.exportXml(onlyPending);
    downloadFile(xml, `${onlyPending ? t.fileNewDives : t.fileLogbook}-${today()}.ssrf`, 'application/xml');
  }

  /** Pictures referenced by the logbook that are kept on this device */
  const exportable = $derived.by(() => {
    const referenced = new Set(workspace.view?.logbook.dives.flatMap((d) => d.pictures.map((p) => p.filename)) ?? []);
    return workspace.media.filter((m) => referenced.has(m.filename));
  });

  async function fullExport() {
    await run(async () => {
      const pictures = [];
      for (const item of exportable) {
        const blob = await workspace.mediaBlob(item.filename);
        if (blob) pictures.push({ filename: item.filename, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const name = `${t.fileLogbook}-${today()}`;
      const zip = fullExportZip(`${name}.ssrf`, workspace.exportXml(false), pictures, t.fullExportReadme(APP_NAME));
      downloadFile(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${name}-${t.fileWithPictures}.zip`);
    });
  }

  function backup() {
    if (!workspace.tree) return;
    const zip = backupZip(workspace.tree, `${APP_NAME} backup ${new Date().toISOString()} · ${workspace.label || 'local'}`);
    downloadFile(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${t.fileBackup}-${today()}.zip`);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const incoming = bytes[0] === 0x50 && bytes[1] === 0x4b ? parseLogbook(readBackupZip(bytes)).logbook : parseXml(new TextDecoder().decode(bytes)).logbook;
      const { added, skipped } = await workspace.importDives(incoming);
      return t.imported(added.length, skipped);
    });
  }

  async function restoreFile(file: File | undefined) {
    if (!file) return;
    if (!confirm(remote ? t.restoreConfirmRemote : t.restoreConfirmLocal)) return;
    await run(async () => {
      const tree = readBackupZip(new Uint8Array(await file.arrayBuffer()));
      await workspace.restore(tree);
      return t.restored;
    });
  }

  function copyTo(source: RemoteSource, secret: string) {
    run(async () => {
      await workspace.copyToNewRemote(source, secret);
      copied = { source, secret };
      return t.copyDone(sourceLabel(source));
    });
  }

  function transferTo(source: RemoteSource, secret: string) {
    run(async () => {
      const { added, skipped } = await workspace.transferTo(source, secret);
      panel = '';
      return t.transferDone(added.length, skipped, sourceLabel(source));
    });
  }

  function switchToCopy() {
    const target = copied;
    if (!target) return;
    if (workspace.pendingCount && !confirm(t.switchConfirm)) return;
    run(async () => {
      await workspace.signOut(true);
      await workspace.connect(target.source, target.secret);
      copied = null;
      panel = '';
      return t.switched(sourceLabel(target.source));
    });
  }

  function signOut() {
    const message =
      (workspace.pendingCount ? t.signOutPending(workspace.pendingCount) : t.signOutConfirm) +
      (workspace.media.length ? t.signOutMedia(workspace.media.length) : '');
    if (!confirm(message)) return;
    run(async () => {
      await workspace.signOut();
      clearGear();
      location.hash = '#/';
    });
  }
</script>

<div class="data">
<section class="card">
  <h3>{t.dataSource}</h3>
  <p>{workspace.source?.kind === 'local' ? t.srcLocal : workspace.label}</p>
  {#if when}<p class="hint">{t.savedAt(when)}</p>{/if}
  {#if remote}
    <p class="hint">{workspace.pendingCount ? t.pendingCount(workspace.pendingCount) : t.allSynced}</p>
    <button class="primary" disabled={busy} onclick={() => run(async () => {
      const r = await workspace.sync();
      return r.added.length || r.edited ? t.synced(r.added.length, r.edited ?? 0, workspace.source?.kind === 'cloud') : t.refreshed;
    })}>{t.syncNow}</button>
  {/if}
</section>

<section class="card">
  <h3>{t.exportTitle}</h3>
  <button class="secondary" onclick={() => exportXml(false)}>{t.exportAll}</button>
  {#if workspace.pendingCount}<button class="secondary" onclick={() => exportXml(true)}>{t.exportPending}</button>{/if}
  <button class="secondary" onclick={backup}>{t.backupDownload}</button>
  <p class="hint">{t.exportHint}</p>
  {#if exportable.length > 0}
    <button class="secondary" disabled={busy} onclick={fullExport}>{t.fullExport}</button>
    <p class="hint">{t.fullExportHint(exportable.length)}</p>
  {/if}
</section>

<section class="card">
  <h3>{t.importTitle}</h3>
  <label class="file">
    <span class="secondary button">{t.importSsrf}</span>
    <input type="file" accept=".ssrf,.xml,.zip" disabled={busy} onchange={(e) => importFile(e.currentTarget.files?.[0])} />
  </label>
  <label class="file">
    <span class="secondary button">{t.restoreBackup}</span>
    <input type="file" accept=".zip" disabled={busy} onchange={(e) => restoreFile(e.currentTarget.files?.[0])} />
  </label>
  <p class="hint">{t.importHint}</p>
</section>

<section class="card">
  <h3>{t.travelTitle}</h3>
  <p class="hint">{t.travelHint}</p>
  <div class="row">
    <button class="secondary" aria-pressed={panel === 'copy'} onclick={() => (panel = panel === 'copy' ? '' : 'copy')}>{t.copyToGit}</button>
    <button class="secondary" aria-pressed={panel === 'transfer'} onclick={() => (panel = panel === 'transfer' ? '' : 'transfer')}>{t.transferDives}</button>
  </div>
  {#if panel === 'copy'}
    <p class="hint">{t.copyHint}</p>
    <RemoteForm kind="git" {busy} submitLabel={t.copyToGit} onSubmit={copyTo} />
    {#if copied}
      <button class="primary" disabled={busy} onclick={switchToCopy}>{t.switchToCopy}</button>
    {/if}
  {:else if panel === 'transfer'}
    <p class="hint">{t.transferHint}</p>
    <div class="row">
      <button class="chip" aria-pressed={targetKind === 'cloud'} onclick={() => (targetKind = 'cloud')}>{t.srcCloud}</button>
      <button class="chip" aria-pressed={targetKind === 'git'} onclick={() => (targetKind = 'git')}>{t.srcGit}</button>
    </div>
    {#key targetKind}
      <RemoteForm kind={targetKind} {busy} submitLabel={t.transferDives} onSubmit={transferTo} />
    {/key}
  {/if}
</section>

<section class="card">
  <LanguagePicker disabled={busy} />
</section>

<InstallHint />

<section class="card">
  <button class="secondary danger" disabled={busy} onclick={signOut}>{t.signOutDelete}</button>
</section>
</div>

<style>
  @media (min-width: 900px) {
    .data {
      columns: 2;
      column-gap: 16px;
    }
    .data > :global(*) {
      break-inside: avoid;
    }
  }
  h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row > button {
    flex: 1;
  }
  .chip[aria-pressed='true'],
  .secondary[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-text);
  }
  .chip {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    border-radius: 999px;
  }
  .danger {
    color: var(--error);
    border-color: var(--error);
  }
</style>
