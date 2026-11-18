<script lang="ts">
  import { listTrips, SyncError, type Dive, type DiveDraft, type DiveEdit, type SiteEdit, type Trip, type TripChoice, type TripEdit } from '@topside/core';
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import AddDives from './components/AddDives.svelte';
  import DataPage from './components/DataPage.svelte';
  import DiveDetail from './components/DiveDetail.svelte';
  import DiveList from './components/DiveList.svelte';
  import EditDive from './components/EditDive.svelte';
  import EditSite from './components/EditSite.svelte';
  import EditTrip from './components/EditTrip.svelte';
  import InstallHint from './components/InstallHint.svelte';
  import MapPage from './components/MapPage.svelte';
  import Setup from './components/Setup.svelte';
  import ShareCard from './components/ShareCard.svelte';
  import StatsPage from './components/StatsPage.svelte';
  import { APP_NAME } from './lib/brand.ts';
  import { lang, locale, onLanguageChange, t } from './lib/i18n.ts';
  import { isRemote, ProxyMissingError } from './lib/sources.ts';
  import { workspace } from './lib/workspace.svelte.ts';

  /** Operations in progress; several can overlap (adding pictures while a sync runs). */
  let running = $state(0);
  const busy = $derived(running > 0);
  let error = $state('');
  let success = $state('');
  /** When the message appeared: going to another page clears it, but not the page change that
   * comes with the result itself (saving goes back to the dive). */
  let messageAt = 0;
  $effect(() => {
    if (error || success) messageAt = Date.now();
  });
  // a success goes away by itself; an error stays until it is closed or the page changes
  $effect(() => {
    if (!success) return;
    const timer = setTimeout(() => (success = ''), 6000);
    return () => clearTimeout(timer);
  });
  function dismissMessage() {
    error = '';
    success = '';
  }
  let online = $state(navigator.onLine);
  let hasLegal = $state(false);

  // Hash routes, so the phone's back button works: #/, #/add, #/data, #/dive/<when>, #/share/<when>
  let route = $state(location.hash || '#/');
  const go = (hash: string) => (location.hash = hash);
  const view = $derived(workspace.view);
  const logbook = $derived(view?.logbook ?? null);
  const routeDive = (prefix: string) =>
    route.startsWith(prefix) ? (logbook?.dives.find((d) => String(d.when) === route.slice(prefix.length)) ?? null) : null;
  const detailDive = $derived(routeDive('#/dive/'));
  const shareDive = $derived(routeDive('#/share/'));
  const editingDive = $derived(routeDive('#/edit/'));
  // #/site/<uuid>
  const editingSite = $derived(
    route.startsWith('#/site/') ? (logbook?.sites.find((s) => String(s.uuid) === route.slice('#/site/'.length)) ?? null) : null,
  );
  const tab = $derived(route === '#/add' ? 'add' : route === '#/data' ? 'data' : 'log');
  const remote = $derived(workspace.source !== null && isRemote(workspace.source));
  /** Dives can be changed unless the remote logbook is one Topside must not write. */
  const canEdit = $derived(!(remote && workspace.problems.length > 0));

  // Wide screens (PC, tablet, phone held sideways) show the list and one dive side by side.
  const wide = new MediaQuery('(min-width: 900px)');
  const showStats = $derived(route === '#/stats');
  const showMap = $derived(route === '#/map');
  /** The help section for the page on screen; help.html opens in its own tab. */
  const helpSection = $derived.by(() => {
    if (!workspace.source) return 'start';
    if (tab === 'add') return 'import';
    if (tab === 'data') return 'data';
    const prefixes: [string, string][] = [
      ['#/share/', 'share'], ['#/edit/', 'edit'], ['#/site/', 'edit'], ['#/trip/', 'edit'],
      ['#/dive/', 'dive'], ['#/stats', 'stats'], ['#/map', 'map'],
    ];
    return prefixes.find(([prefix]) => route.startsWith(prefix))?.[1] ?? 'log';
  });
  // #/trip/<time of its first dive>
  const editingTrip = $derived(
    route.startsWith('#/trip/') && logbook ? (listTrips(logbook).find((e) => String(e.first) === route.slice('#/trip/'.length)) ?? null) : null,
  );
  const split = $derived(wide.current && tab === 'log' && !shareDive && !editingSite && !showStats && !showMap && !editingTrip);
  /** The dive on the right-hand side: the opened one, otherwise the newest. */
  const shownDive = $derived(editingDive ?? detailDive ?? (split ? (logbook?.dives.at(-1) ?? null) : null));
  function openDive(dive: Dive) {
    const hash = `#/dive/${dive.when}`;
    // Side by side, picking another dive should not pile up history entries.
    if (split && route.startsWith('#/dive/')) location.replace(hash);
    else go(hash);
  }

  // ---- Password prompt ------------------------------------------------------------------------
  let secretRequest = $state<{ label: string; resolve: (v: string | null) => void } | null>(null);
  let secretValue = $state('');
  workspace.askSecret = (label) =>
    new Promise((resolve) => {
      secretValue = '';
      secretRequest = { label, resolve };
    });
  function answerSecret(value: string | null) {
    secretRequest?.resolve(value);
    secretRequest = null;
  }

  // Switching the language re-renders everything below (strings and formatters are read on render).
  let uiLang = $state(lang);
  onMount(() => onLanguageChange((next) => (uiLang = next)));
  $effect(() => {
    void uiLang;
    document.title = `${APP_NAME} ${t.appFor}`;
  });

  onMount(() => {
    window.addEventListener('hashchange', () => {
      route = location.hash || '#/';
      if (Date.now() - messageAt > 1500) dismissMessage();
    });
    window.addEventListener('online', () => (online = true));
    window.addEventListener('offline', () => (online = false));
    void workspace.load();
    // legal.html is optional and instance-specific (see public/legal.example.html)
    // A missing file may come back as the app's index.html (SPA fallback), hence the marker check.
    fetch('legal.html', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => (hasLegal = text.includes('name="topside-legal"')), () => undefined);
  });

  function message(e: unknown): string {
    if (e instanceof ProxyMissingError) return t.errorProxy;
    if (e instanceof SyncError) {
      if (e.kind === 'auth') return t.errorAuth;
      if (e.kind === 'not-found') return `${t.errorNotFound} (${e.message})`;
      if (e.kind === 'conflict') return `${t.errorConflict} (${e.message})`;
      if (e.kind === 'unsupported') return `${t.errorUnsupported}: ${e.message}`;
      return `${t.errorNetwork}: ${e.message}`;
    }
    return e instanceof Error ? e.message : String(e);
  }

  async function run(fn: () => Promise<string | void>) {
    running++;
    error = '';
    success = '';
    try {
      success = (await fn()) ?? '';
    } catch (e) {
      error = message(e);
    } finally {
      running--;
    }
  }

  async function sync() {
    await run(async () => {
      const r = await workspace.sync();
      return r.added.length || r.edited ? t.synced(r.added.length, r.edited ?? 0, workspace.source?.kind === 'cloud') : t.refreshed;
    });
  }

  async function editSite(edit: SiteEdit): Promise<boolean> {
    return saveChange(() => workspace.editSite(edit), `#/`);
  }

  async function editTrip(edit: TripEdit): Promise<boolean> {
    return saveChange(() => workspace.editTrip(edit), `#/`);
  }
  function openTrip(trip: Trip) {
    const entry = logbook ? listTrips(logbook).find((e) => e.trip === trip) : undefined;
    if (entry) go(`#/trip/${entry.first}`);
  }

  async function deleteDive(dive: Dive) {
    const pictures = workspace.media.filter((m) => m.diveWhen === dive.when).length;
    if (!confirm(t.deleteDiveConfirm(pictures))) return;
    // the dive and its edit page are gone: go to the list
    if (await applyChange(() => workspace.deleteDive(dive))) location.replace('#/');
  }

  async function editDive(edit: DiveEdit): Promise<boolean> {
    return saveChange(() => workspace.editDive(edit), `#/dive/${edit.when}`);
  }

  /** Save a change, upload it when possible, and go back to where the edit page was opened. */
  async function saveChange(change: () => Promise<void>, fallback: string): Promise<boolean> {
    const ok = await applyChange(change);
    // leaves no edit page in the history
    if (ok) {
      if (history.length > 1) history.back();
      else location.replace(fallback);
    }
    return ok;
  }

  /** Save a change and upload it when possible. */
  async function applyChange(change: () => Promise<void>): Promise<boolean> {
    let ok = false;
    await run(async () => {
      await change();
      ok = true;
      if (!remote) return t.editSaved;
      if (!online) return t.editSavedOffline;
      try {
        const r = await workspace.sync();
        return t.synced(r.added.length, r.edited ?? 0, workspace.source?.kind === 'cloud');
      } catch (e) {
        return `${t.editSavedOffline} ${message(e)}`;
      }
    });
    return ok;
  }

  async function addDives(drafts: DiveDraft[], trip: TripChoice): Promise<boolean> {
    let ok = false;
    await run(async () => {
      const result = await workspace.addDives(drafts, trip);
      ok = true;
      if (!remote) return t.addedLocal(result.added.length) + (result.skipped ? ` ${t.skipped(result.skipped)}` : '');
      if (!online) return t.savedOffline(drafts.length);
      try {
        const synced = await workspace.sync();
        return t.synced(synced.added.length, synced.edited ?? 0, workspace.source?.kind === 'cloud') + (synced.skipped ? ` ${t.skipped(synced.skipped)}` : '');
      } catch (e) {
        return `${t.savedOffline(drafts.length)} ${message(e)}`;
      }
    });
    if (ok) go('#/');
    return ok;
  }
</script>

{#snippet listPane(current: Dive | null, hintFirst: boolean)}
  {#if logbook}
    <section class="card summary">
      <div>
        <strong>{t.logbook(logbook.dives.length)}</strong>
        <small class="hint">
          {remote ? workspace.label : t.srcLocal}
          {#if workspace.savedAt}
            · {new Date(workspace.savedAt).toLocaleDateString(locale)}{/if}
          {#if workspace.pendingCount}
            · ⏳ {t.pendingCount(workspace.pendingCount)}{/if}
        </small>
      </div>
      <div class="summary-actions">
        <a class="link" href="#/map">{t.map}</a>
        <a class="link" href="#/stats">{t.stats}</a>
        {#if remote}
          <button class="link" disabled={busy || !online} onclick={sync}>{busy ? t.signingIn : t.syncNow}</button>
        {/if}
      </div>
    </section>
    <!-- Side by side the list has little height (phone held sideways), so the dives come first. -->
    {#if hintFirst}<InstallHint dismissible />{/if}
    <DiveList {logbook} pending={view?.pendingDives} selected={current} onOpen={openDive} onEditTrip={canEdit ? openTrip : undefined} />
    {#if !hintFirst}<InstallHint dismissible />{/if}
  {/if}
{/snippet}

{#snippet divePane(dive: Dive)}
  {#if logbook && editingDive === dive}
    <h2>{t.editTitle}</h2>
    {#key dive}
      <EditDive {logbook} {dive} {busy} onSave={editDive} onCancel={() => history.back()} onDelete={() => deleteDive(dive)} />
    {/key}
  {:else if logbook}
    {#if view?.pendingDives.has(dive)}<p class="hint">⏳ {t.notSynced}</p>{/if}
    <DiveDetail
      {logbook}
      {dive}
      onShare={() => go(`#/share/${dive.when}`)}
      onEdit={canEdit ? () => go(`#/edit/${dive.when}`) : undefined}
      onEditSite={canEdit && dive.siteUuid !== null && workspace.isSyncedSite(dive.siteUuid) ? () => go(`#/site/${dive.siteUuid}`) : undefined}
      onChange={canEdit ? applyChange : undefined}
    />
  {/if}
{/snippet}

{#key uiLang}
<div class="topbar">
  <header>
    <h1><a href="#/">{APP_NAME} <small>{t.appFor}</small></a></h1>
    {#if !online}<span class="badge">{t.offline}</span>{/if}
    <a class="help" href={`help.html#${helpSection}`} target="_blank" rel="noopener" title={t.help} aria-label={t.help}>?</a>
  </header>

{#if workspace.source}
  <nav class="tabs">
    <a href="#/" class:active={tab === 'log'}>{t.navLog}</a>
    <a href="#/add" class:active={tab === 'add'}>{t.navAdd}</a>
    <a href="#/data" class:active={tab === 'data'}>
      {t.navData}{#if workspace.pendingCount}<span class="count">{workspace.pendingCount}</span>{/if}
    </a>
  </nav>
{/if}
</div>

<main class:roomy={split || shareDive !== null || showMap || tab === 'data'}>
  {#if !workspace.loaded}
    <p class="hint">…</p>
  {:else if !workspace.source}
    <Setup onError={(e) => (error = message(e))} />
  {:else if logbook && shareDive}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.shareTitle}</h2>
    <ShareCard {logbook} dive={shareDive} />
  {:else if logbook && editingTrip}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.tripEditTitle}</h2>
    {#key editingTrip.trip}
      <EditTrip {logbook} entry={editingTrip} {busy} onSave={editTrip} onCancel={() => history.back()} />
    {/key}
  {:else if logbook && showStats}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.stats}</h2>
    <StatsPage {logbook} onOpen={openDive} />
  {:else if logbook && showMap}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.map}</h2>
    <MapPage {logbook} />
  {:else if logbook && editingSite}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.siteEditTitle}</h2>
    {#key editingSite}
      <EditSite {logbook} site={editingSite} {busy} onSave={editSite} onCancel={() => history.back()} />
    {/key}
  {:else if logbook && split}
    <div class="split">
      <aside>{@render listPane(shownDive, false)}</aside>
      <div class="pane">
        {#if shownDive}{@render divePane(shownDive)}{/if}
      </div>
    </div>
  {:else if logbook && (editingDive ?? detailDive)}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    {@render divePane((editingDive ?? detailDive)!)}
  {:else if logbook && tab === 'add'}
    {#if workspace.problems.length > 0 && remote}
      <p class="error" role="alert">{t.readOnly} {workspace.problems[0]}</p>
    {:else}
      <AddDives {logbook} local={!remote} {busy} onAdd={addDives} />
    {/if}
  {:else if tab === 'data'}
    <DataPage {busy} {run} />
  {:else if logbook}
    {@render listPane(null, true)}
  {/if}


  <footer>
    <p>{t.footerNote}</p>
    {#if hasLegal}<a href={`legal.html#${lang}`}>{t.legal}</a>{/if}
  </footer>
</main>

<!-- Results show in a bar at the bottom of the window, so they are seen wherever the page is scrolled to. -->
<div class="toast-area" aria-live="polite">
  {#if error || success}
    <div class="toast" class:failed={error !== ''} role={error ? 'alert' : 'status'}>
      <span>{error || success}</span>
      <button class="close" onclick={dismissMessage} aria-label={t.close} title={t.close}>×</button>
    </div>
  {/if}
</div>

{#if secretRequest}
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="secret-title">
    <form
      class="card"
      onsubmit={(e) => {
        e.preventDefault();
        answerSecret(secretValue);
      }}
    >
      <strong id="secret-title">{t.passwordFor}</strong>
      <p class="hint">{secretRequest.label}</p>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" name="password" autocomplete="current-password" required autofocus bind:value={secretValue} />
      <div class="row">
        <button type="button" class="secondary" onclick={() => answerSecret(null)}>{t.cancel}</button>
        <button class="primary">{t.ok}</button>
      </div>
    </form>
  </div>
{/if}
{/key}

<style>
  /* List on the left with its own scrolling, the dive on the right. */
  .split {
    display: grid;
    grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .split aside {
    position: sticky;
    top: calc(var(--bar-height) + 16px);
    max-height: calc(100dvh - var(--bar-height) - 32px);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .pane {
    min-width: 0;
  }
  footer {
    margin-top: 32px;
    font-size: 0.8rem;
    color: var(--muted);
    text-align: center;
  }
  footer p {
    margin: 0 0 4px;
  }
  footer a {
    color: var(--muted);
  }
  .badge {
    background: rgb(255 255 255 / 20%);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .count {
    display: inline-block;
    margin-left: 6px;
    background: var(--accent);
    color: var(--accent-text);
    border-radius: 999px;
    padding: 0 7px;
    font-size: 0.75rem;
  }
  .summary small {
    display: block;
  }
  .summary-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  /* above the sticky upload button of the "New" page, below everything else */
  .toast-area {
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    z-index: 15;
    padding: 0 16px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    max-width: 688px;
    margin: 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--card);
    color: var(--text);
    border: 1px solid var(--line);
    border-left: 4px solid var(--success);
    border-radius: 10px;
    padding: 10px 6px 10px 14px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 25%);
    font-weight: 600;
  }
  .toast.failed {
    border-left-color: var(--error);
  }
  .toast span {
    flex: 1;
    padding-top: 2px;
    overflow-wrap: anywhere;
  }
  .toast .close {
    min-height: 32px;
    min-width: 32px;
    padding: 0 8px;
    background: none;
    border: 0;
    color: var(--muted);
    font-size: 1.3rem;
    line-height: 1;
  }
  .modal {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 50%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 20;
  }
  .modal form {
    width: 100%;
    max-width: 420px;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .row button {
    flex: 1;
  }
</style>
