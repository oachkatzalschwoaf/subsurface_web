<script lang="ts">
  /** Pick FIT files, fill in the details, and add the dives (or keep them for the next sync). */
  import {
    extractFitFiles,
    findSameDive,
    importFit,
    listTrips,
    newDraft,
    NotADiveError,
    type DiveDraft,
    type Logbook,
    type TripChoice,
  } from '@topside/core';
  import { formatDate, formatDepth, formatMinutes, profilePath } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';

  let {
    logbook,
    local,
    busy,
    onAdd,
  }: {
    logbook: Logbook;
    /** Logbook lives only on this device: dives go in directly. */
    local: boolean;
    busy: boolean;
    onAdd: (drafts: DiveDraft[], trip: TripChoice) => Promise<boolean>;
  } = $props();

  let drafts = $state<DiveDraft[]>([]);
  let rejected = $state<{ name: string; reason: string }[]>([]);
  let tripKey = $state('none');
  let newTripLocation = $state('');
  let fileInput = $state<HTMLInputElement>();

  const trips = $derived(listTrips(logbook).slice(0, 8));
  const sites = $derived([...logbook.sites].filter((s) => s.name).sort((a, b) => a.name.localeCompare(b.name)));

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      let fits: ReturnType<typeof extractFitFiles> = [];
      try {
        fits = extractFitFiles(file.name, new Uint8Array(await file.arrayBuffer()));
      } catch {
        // reported below
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

  async function submit() {
    const done = await onAdd($state.snapshot(drafts) as DiveDraft[], tripChoice());
    if (done) {
      drafts = [];
      rejected = [];
      tripKey = 'none';
      newTripLocation = '';
    }
  }

  const siteKey = (d: DiveDraft) => (d.site.kind === 'existing' ? String(d.site.uuid) : d.site.kind);
  function setSite(d: DiveDraft, key: string) {
    d.site = key === 'none' ? { kind: 'none' } : key === 'new' ? { kind: 'new', name: '' } : { kind: 'existing', uuid: Number(key) };
  }
</script>

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
      <label>{t.tripLocation}<input bind:value={newTripLocation} /></label>
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

  <button class="primary sticky" disabled={busy} onclick={submit}>
    {busy ? t.uploading : local ? t.addLocal(drafts.length) : t.upload(drafts.length)}
  </button>
{/if}
