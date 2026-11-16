<script lang="ts">
  /** Pick FIT files, fill in the details, and add the dives (or keep them for the next sync). */
  import {
    applyPreset,
    cylinderTypes,
    extractFitFiles,
    findSameDive,
    hasRecordedMix,
    importFit,
    listTrips,
    newDraft,
    NotADiveError,
    presetFromDraft,
    usedValues,
    type DiveDraft,
    type GearPreset,
    type Logbook,
    type TripChoice,
  } from '@topside/core';
  import { formatDate, formatDepth, formatMinutes, profilePath } from '../lib/format.ts';
  import { loadLastGear, loadPresets, saveLastGear, savePresets } from '../lib/gear.ts';
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

  // ---- Suggestions from the logbook ---------------------------------------------------------
  const cylinders = $derived(cylinderTypes(logbook, t.commonCylinders));
  const suits = $derived(usedValues(logbook, (d) => d.suit));
  const buddies = $derived(usedValues(logbook, (d) => d.buddy));
  const guides = $derived(usedValues(logbook, (d) => d.diveGuide));
  const weightKinds = $derived(usedValues(logbook, (d) => d.weightsystems.map((w) => w.description)));

  const draftKey = (d: DiveDraft) => d.fit.fileName + d.fit.dive.when;
  /** Drafts whose cylinder is typed in by hand instead of picked from the list. */
  let ownCylinder = $state<Record<string, boolean>>({});
  function cylinderKey(d: DiveDraft): string {
    if (ownCylinder[draftKey(d)]) return 'other';
    if (!d.cylinderDescription) return 'none';
    return cylinders.some((c) => c.description === d.cylinderDescription) ? d.cylinderDescription : 'other';
  }
  function setCylinder(d: DiveDraft, key: string) {
    ownCylinder[draftKey(d)] = key === 'other';
    if (key === 'other') return;
    const type = cylinders.find((c) => c.description === key);
    d.cylinderDescription = type?.description ?? '';
    d.cylinderVolume = type ? (type.volume ?? d.cylinderVolume) : null;
  }

  // ---- Equipment presets, kept on this device -----------------------------------------------
  let presets = $state<GearPreset[]>(loadPresets());
  const lastGear = loadLastGear();
  /** 'none', 'last' or the index of a saved preset */
  let presetKey = $state('none');
  let savingFor = $state('');
  let presetName = $state('');
  let presetNote = $state('');

  const chosenPreset = () => (presetKey === 'last' ? lastGear : (presets[Number(presetKey)] ?? null));
  function usePreset(key: string) {
    presetKey = key;
    presetNote = '';
    const preset = chosenPreset();
    if (preset) for (const d of drafts) applyPreset(d, preset);
  }
  function savePreset(d: DiveDraft) {
    const preset = presetFromDraft(presetName, d);
    if (!preset.name) return;
    const at = presets.findIndex((p) => p.name === preset.name);
    if (at >= 0) presets[at] = preset;
    else presets.push(preset);
    savePresets($state.snapshot(presets));
    presetKey = String(at >= 0 ? at : presets.length - 1);
    presetNote = t.presetSaved(preset.name);
    savingFor = '';
    presetName = '';
  }
  function deletePreset() {
    const at = Number(presetKey);
    if (!presets[at]) return;
    presets.splice(at, 1);
    savePresets($state.snapshot(presets));
    presetKey = 'none';
    presetNote = '';
  }

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
          else {
            const draft = newDraft(imported);
            const preset = chosenPreset();
            if (preset) applyPreset(draft, preset);
            drafts.push(draft);
          }
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
      ownCylinder[draftKey(d)] = ownCylinder[draftKey(source)] ?? false;
      if (!hasRecordedMix(d)) d.cylinderO2 = source.cylinderO2;
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
    const last = drafts.at(-1);
    const done = await onAdd($state.snapshot(drafts) as DiveDraft[], tripChoice());
    if (done) {
      if (last) saveLastGear(presetFromDraft('last', last));
      ownCylinder = {};
      presetNote = '';
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
    {#if presets.length > 0 || lastGear}
      <label>
        {t.gearPreset}
        <select value={presetKey} onchange={(e) => usePreset(e.currentTarget.value)}>
          <option value="none">{t.presetNone}</option>
          {#if lastGear}<option value="last">{t.presetLast}</option>{/if}
          {#each presets as p, i}<option value={String(i)}>{p.name}</option>{/each}
        </select>
      </label>
      <p class="hint">{t.presetHint}</p>
      {#if presets[Number(presetKey)]}
        <button class="link" onclick={deletePreset}>{t.presetDelete}</button>
      {/if}
    {/if}
    {#if presetNote}<p class="success" role="status">{presetNote}</p>{/if}
  </section>

  <datalist id="known-suits">{#each suits as v}<option value={v}></option>{/each}</datalist>
  <datalist id="known-buddies">{#each buddies as v}<option value={v}></option>{/each}</datalist>
  <datalist id="known-guides">{#each guides as v}<option value={v}></option>{/each}</datalist>
  <datalist id="known-weights">{#each weightKinds as v}<option value={v}></option>{/each}</datalist>

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
        <label>{t.buddy}<input list="known-buddies" bind:value={d.buddy} /></label>
        <label>{t.guide}<input list="known-guides" bind:value={d.diveGuide} /></label>
        <label>{t.suit}<input list="known-suits" bind:value={d.suit} /></label>
        <label>{t.tags}<input bind:value={d.tags} /></label>
        <label>
          {t.cylinder}
          <select value={cylinderKey(d)} onchange={(e) => setCylinder(d, e.currentTarget.value)}>
            <option value="none">{t.cylinderNone}</option>
            {#each cylinders as c}<option value={c.description}>{c.description}</option>{/each}
            <option value="other">{t.cylinderOther}</option>
          </select>
        </label>
        {#if cylinderKey(d) === 'other'}
          <label>{t.cylinder}: {t.cylinderDescription}<input bind:value={d.cylinderDescription} /></label>
        {/if}
        <label>{t.volume}<input type="number" inputmode="decimal" min="0" step="0.1" bind:value={d.cylinderVolume} /></label>
        <label>
          {t.o2}
          <input type="number" inputmode="numeric" min="21" max="100" step="1" placeholder="21" bind:value={d.cylinderO2} />
          {#if hasRecordedMix(d)}<small>{t.o2Recorded}</small>{/if}
        </label>
        <label>{t.startPressure}<input type="number" inputmode="numeric" min="0" bind:value={d.startPressure} /></label>
        <label>{t.endPressure}<input type="number" inputmode="numeric" min="0" bind:value={d.endPressure} /></label>
        <label>{t.weight}<input type="number" inputmode="decimal" min="0" step="0.5" bind:value={d.weight} /></label>
        <label>{t.weightDescription}<input list="known-weights" bind:value={d.weightDescription} /></label>
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
      {#if savingFor === draftKey(d)}
        <form
          class="preset"
          onsubmit={(e) => {
            e.preventDefault();
            savePreset(d);
          }}
        >
          <label>{t.presetName}<input required bind:value={presetName} /></label>
          <button class="secondary">{t.presetSave}</button>
        </form>
      {:else}
        <button
          class="link"
          onclick={() => {
            savingFor = draftKey(d);
            presetName = presets[Number(presetKey)]?.name ?? '';
          }}>{t.presetSave}</button
        >
      {/if}
    </section>
  {/each}

  <button class="primary sticky" disabled={busy} onclick={submit}>
    {busy ? t.uploading : local ? t.addLocal(drafts.length) : t.upload(drafts.length)}
  </button>
{/if}

<style>
  .preset {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }
  .preset label {
    flex: 1;
    min-width: 180px;
  }
  .card > .link {
    align-self: flex-start;
  }
  small {
    font-size: 0.8rem;
  }
</style>
