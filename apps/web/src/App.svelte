<script lang="ts">
  import { SyncError, type Dive, type DiveDraft, type TripChoice } from '@topside/core';
  import { onMount } from 'svelte';
  import AddDives from './components/AddDives.svelte';
  import DataPage from './components/DataPage.svelte';
  import DiveDetail from './components/DiveDetail.svelte';
  import DiveList from './components/DiveList.svelte';
  import InstallHint from './components/InstallHint.svelte';
  import Setup from './components/Setup.svelte';
  import ShareCard from './components/ShareCard.svelte';
  import { APP_NAME } from './lib/brand.ts';
  import { locale, t } from './lib/i18n.ts';
  import { isRemote, ProxyMissingError } from './lib/sources.ts';
  import { workspace } from './lib/workspace.svelte.ts';

  let busy = $state(false);
  let error = $state('');
  let success = $state('');
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
  const tab = $derived(route === '#/add' ? 'add' : route === '#/data' ? 'data' : 'log');
  const remote = $derived(workspace.source !== null && isRemote(workspace.source));
  const openDive = (dive: Dive) => go(`#/dive/${dive.when}`);

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

  onMount(() => {
    window.addEventListener('hashchange', () => (route = location.hash || '#/'));
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
    busy = true;
    error = '';
    success = '';
    try {
      success = (await fn()) ?? '';
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  async function sync() {
    await run(async () => {
      const r = await workspace.sync();
      return r.added.length ? t.uploaded(r.added.length, workspace.source?.kind === 'cloud') : t.refreshed;
    });
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
        return t.uploaded(synced.added.length, workspace.source?.kind === 'cloud') + (synced.skipped ? ` ${t.skipped(synced.skipped)}` : '');
      } catch (e) {
        return `${t.savedOffline(drafts.length)} ${message(e)}`;
      }
    });
    if (ok) go('#/');
    return ok;
  }
</script>

<header>
  <h1>{APP_NAME}</h1>
  {#if !online}<span class="badge">{t.offline}</span>{/if}
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

<main>
  {#if !workspace.loaded}
    <p class="hint">…</p>
  {:else if !workspace.source}
    <Setup onError={(e) => (error = message(e))} />
  {:else if logbook && shareDive}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    <h2>{t.shareTitle}</h2>
    <ShareCard {logbook} dive={shareDive} />
  {:else if logbook && detailDive}
    <button class="link back" onclick={() => history.back()}>← {t.back}</button>
    {#if view?.pendingDives.has(detailDive)}<p class="hint">⏳ {t.notSynced}</p>{/if}
    <DiveDetail {logbook} dive={detailDive} onShare={() => go(`#/share/${detailDive.when}`)} />
  {:else if logbook && tab === 'add'}
    {#if workspace.problems.length > 0 && remote}
      <p class="error" role="alert">{t.readOnly} {workspace.problems[0]}</p>
    {:else}
      <AddDives {logbook} local={!remote} {busy} onAdd={addDives} />
    {/if}
  {:else if tab === 'data'}
    <DataPage {busy} {run} />
  {:else if logbook}
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
      {#if remote}
        <button class="link" disabled={busy || !online} onclick={sync}>{busy ? t.signingIn : t.syncNow}</button>
      {/if}
    </section>
    <InstallHint dismissible />
    <DiveList {logbook} pending={view?.pendingDives} onOpen={openDive} />
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if success}<p class="success" role="status">{success}</p>{/if}

  <footer>
    <p>{t.footerNote}</p>
    {#if hasLegal}<a href="legal.html">{t.legal}</a>{/if}
  </footer>
</main>

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

<style>
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
