<script lang="ts">
  import {
    extractFitFiles,
    findSameDive,
    importFit,
    listTrips,
    newDraft,
    NotADiveError,
    SyncError,
    type DiveDraft,
    type Snapshot,
    type TripChoice,
  } from '@topside/core';
  import { onMount } from 'svelte';
  import { download, loadSettings, recallLogin, rememberLogin, saveSettings, upload, type Account } from './lib/cloud.ts';
  import { formatDate, formatDepth, formatMinutes, profilePath } from './lib/format.ts';
  import { t } from './lib/i18n.ts';

  const settings = loadSettings();
  let account = $state<Account>({ server: settings.server, email: settings.email, password: '' });
  let snapshot = $state.raw<Snapshot | null>(null);
  let busy = $state<'' | 'login' | 'upload'>('');
  let error = $state('');
  let success = $state('');

  let drafts = $state<DiveDraft[]>([]);
  let rejected = $state<{ name: string; reason: string }[]>([]);
  let tripKey = $state('none');
  let newTripLocation = $state('');
  let fileInput = $state<HTMLInputElement>();

  const logbook = $derived(snapshot?.logbook ?? null);
  const trips = $derived(logbook ? listTrips(logbook).slice(0, 8) : []);
  const sites = $derived(logbook ? [...logbook.sites].filter((s) => s.name).sort((a, b) => a.name.localeCompare(b.name)) : []);
  const lastDive = $derived(logbook?.dives.at(-1) ?? null);
  const siteName = (uuid: number | null) => logbook?.sites.find((s) => s.uuid === uuid)?.name ?? '';

  function message(e: unknown): string {
    if (e instanceof SyncError) {
      if (e.kind === 'auth') return t.errorAuth;
      if (e.kind === 'not-found') return `${t.errorNotFound} (${e.message})`;
      if (e.kind === 'conflict') return t.errorConflict;
      if (e.kind === 'unsupported') return `${t.errorUnsupported}: ${e.message}`;
      return `${t.errorNetwork}: ${e.message}`;
    }
    return e instanceof Error ? e.message : String(e);
  }

  async function signIn(remember: boolean) {
    busy = 'login';
    error = '';
    try {
      snapshot = await download(account);
      saveSettings(account);
      if (remember) await rememberLogin(account);
    } catch (e) {
      error = message(e);
    } finally {
      busy = '';
    }
  }

  function signOut() {
    snapshot = null;
    account.password = '';
    drafts = [];
    rejected = [];
    success = '';
    navigator.credentials?.preventSilentAccess?.();
  }

  onMount(async () => {
    const login = await recallLogin();
    if (login && !snapshot) {
      account.email = login.email;
      account.password = login.password;
      await signIn(false);
    }
  });

  async function addFiles(files: FileList | null) {
    if (!files || !logbook) return;
    success = '';
    error = '';
    for (const file of Array.from(files)) {
      let fits: ReturnType<typeof extractFitFiles> = [];
      try {
        fits = extractFitFiles(file.name, new Uint8Array(await file.arrayBuffer()));
      } catch {
        // handled below as unreadable
      }
      if (fits.length === 0) {
        rejected.push({ name: file.name, reason: t.unreadable });
        continue;
      }
      for (const fit of fits) {
        try {
          const imported = await importFit(fit.bytes, fit.name, fit.activityId);
          const known = findSameDive(logbook.dives, imported.dive) ?? findSameDive(drafts.map((d) => d.fit.dive), imported.dive);
          if (known) rejected.push({ name: fit.name, reason: `${formatDate(imported.dive.when)} – ${t.alreadyThere}` });
          else drafts.push(newDraft(imported));
        } catch (e) {
          rejected.push({ name: fit.name, reason: e instanceof NotADiveError ? t.notADive : t.unreadable });
        }
      }
    }
    drafts.sort((a, b) => a.fit.dive.when - b.fit.dive.when);
    if (fileInput) fileInput.value = '';
  }

  /** Copy the equipment and people fields of one dive to all others. */
  function copyToAll(source: DiveDraft) {
    for (const d of drafts) {
      if (d === source) continue;
      d.buddy = source.buddy;
      d.diveGuide = source.diveGuide;
      d.suit = source.suit;
      d.tags = source.tags;
      d.cylinderVolume = source.cylinderVolume;
      d.cylinderDescription = source.cylinderDescription;
      d.startPressure = source.startPressure;
      d.weight = source.weight;
      d.weightDescription = source.weightDescription;
    }
  }

  function tripChoice(): TripChoice {
    if (tripKey === 'new') return newTripLocation.trim() ? { kind: 'new', location: newTripLocation, notes: '' } : { kind: 'none' };
    const existing = trips[Number(tripKey)];
    return existing ? { kind: 'existing', location: existing.trip.location, first: existing.first } : { kind: 'none' };
  }

  async function doUpload() {
    busy = 'upload';
    error = '';
    success = '';
    try {
      const result = await upload(account, $state.snapshot(drafts) as DiveDraft[], tripChoice());
      snapshot = result.snapshot;
      success =
        result.added.length > 0
          ? t.uploaded(result.added.length) + (result.duplicates.length ? ` ${t.skipped(result.duplicates.length)}` : '')
          : t.nothingNew;
      drafts = [];
      rejected = [];
      tripKey = 'none';
      newTripLocation = '';
    } catch (e) {
      error = message(e);
    } finally {
      busy = '';
    }
  }

  const siteKey = (d: DiveDraft) => (d.site.kind === 'existing' ? String(d.site.uuid) : d.site.kind);
  function setSite(d: DiveDraft, key: string) {
    d.site = key === 'none' ? { kind: 'none' } : key === 'new' ? { kind: 'new', name: '' } : { kind: 'existing', uuid: Number(key) };
  }
</script>

<header>
  <h1>Topside</h1>
  {#if snapshot}<button class="link" onclick={signOut}>{t.signOut}</button>{/if}
</header>

<main>
  {#if !snapshot}
    <p class="lead">{t.tagline}</p>
    <form
      class="card"
      onsubmit={(e) => {
        e.preventDefault();
        signIn(true);
      }}
    >
      <label>
        {t.email}
        <input type="email" name="username" autocomplete="username" required bind:value={account.email} />
      </label>
      <label>
        {t.password}
        <input type="password" name="password" autocomplete="current-password" required bind:value={account.password} />
      </label>
      <details>
        <summary>{t.advanced}</summary>
        <label>
          {t.server}
          <input type="url" required bind:value={account.server} />
        </label>
      </details>
      <button class="primary" disabled={busy !== ''}>{busy === 'login' ? t.signingIn : t.signIn}</button>
    </form>
  {:else if logbook}
    <section class="card summary">
      <strong>{t.logbook(logbook.dives.length)}</strong>
      {#if lastDive}
        <span>{t.lastDive}: {lastDive.number ? `#${lastDive.number} · ` : ''}{formatDate(lastDive.when)} {siteName(lastDive.siteUuid)}</span>
      {/if}
    </section>

    {#if snapshot.problems.length > 0}
      <p class="error" role="alert">{t.readOnly} {snapshot.problems[0]}</p>
    {:else}
      <section class="card">
        <label class="file">
          <span class="primary button">{t.chooseFiles}</span>
          <input bind:this={fileInput} type="file" multiple accept=".fit,.zip,.FIT,application/zip,application/octet-stream" onchange={(e) => addFiles(e.currentTarget.files)} />
        </label>
        <p class="hint">{t.chooseHint}</p>
        {#each rejected as r}
          <p class="hint">⚠ {r.name}: {r.reason}</p>
        {/each}
      </section>

      {#if drafts.length > 0}
        <section class="card">
          <label>
            {t.trip}
            <select bind:value={tripKey}>
              <option value="none">{t.tripNone}</option>
              <option value="new">{t.tripNew}</option>
              {#each trips as trip, i}
                <option value={String(i)}>{trip.trip.location || '—'} ({formatDate(trip.first).slice(0, -6)}, {trip.dives})</option>
              {/each}
            </select>
          </label>
          {#if tripKey === 'new'}
            <label>
              {t.tripLocation}
              <input bind:value={newTripLocation} />
            </label>
          {/if}
        </section>

        <h2>{t.newDives}</h2>
        {#each drafts as d, i (d.fit.fileName + d.fit.dive.when)}
          {@const dc = d.fit.dive.computers[0]!}
          <section class="card dive">
            <div class="dive-head">
              <div>
                <strong>{formatDate(d.fit.dive.when)}</strong>
                <span>{t.maxDepth} {formatDepth(dc.maxDepth)} · {formatMinutes(dc.duration)} {t.minutes} · {dc.model}</span>
              </div>
              <button class="link" onclick={() => drafts.splice(i, 1)}>{t.remove}</button>
            </div>
            {#if dc.samples.length > 1}
              <svg viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path d={profilePath(d.fit.dive, 300, 60)} /></svg>
            {/if}

            <label>
              {t.site}
              <select value={siteKey(d)} onchange={(e) => setSite(d, e.currentTarget.value)}>
                <option value="none">{t.siteNone}</option>
                <option value="new">{t.siteNew}</option>
                {#each sites as s}<option value={String(s.uuid)}>{s.name}</option>{/each}
              </select>
            </label>
            {#if d.site.kind === 'new'}
              <label>{t.siteName}<input bind:value={d.site.name} /></label>
            {/if}

            <div class="grid">
              <label>{t.buddy}<input bind:value={d.buddy} /></label>
              <label>{t.guide}<input bind:value={d.diveGuide} /></label>
              <label>{t.suit}<input bind:value={d.suit} /></label>
              <label>{t.tags}<input bind:value={d.tags} /></label>
              <label>{t.cylinder}: {t.cylinderDescription}<input bind:value={d.cylinderDescription} /></label>
              <label>{t.volume}<input type="number" inputmode="decimal" min="0" step="0.1" bind:value={d.cylinderVolume} /></label>
              <label>{t.startPressure}<input type="number" inputmode="numeric" min="0" bind:value={d.startPressure} /></label>
              <label>{t.endPressure}<input type="number" inputmode="numeric" min="0" bind:value={d.endPressure} /></label>
              <label>{t.weight}<input type="number" inputmode="decimal" min="0" step="0.5" bind:value={d.weight} /></label>
              <label>{t.weightDescription}<input bind:value={d.weightDescription} /></label>
              <label>
                {t.rating}
                <select bind:value={d.rating}>{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}>{n ? '★'.repeat(n) : '—'}</option>{/each}</select>
              </label>
              <label>
                {t.visibility}
                <select bind:value={d.visibility}>{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}>{n ? '★'.repeat(n) : '—'}</option>{/each}</select>
              </label>
            </div>
            <label>{t.notes}<textarea rows="3" bind:value={d.notes}></textarea></label>
            {#if drafts.length > 1}
              <button class="secondary" onclick={() => copyToAll(d)}>{t.applyToAll}</button>
            {/if}
          </section>
        {/each}

        <button class="primary sticky" disabled={busy !== ''} onclick={doUpload}>
          {busy === 'upload' ? t.uploading : t.upload(drafts.length)}
        </button>
      {/if}
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if success}<p class="success" role="status">{success}</p>{/if}
</main>
