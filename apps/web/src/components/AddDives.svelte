<script lang="ts">
  /**
   * Pick FIT files, fill in the details, and add the dives (or keep them for the next sync).
   * Also: notes for dives whose FIT file does not exist yet.
   */
  import {
    applyNote,
    applyPreset,
    canBecomeDive,
    draftFromNote,
    extractFitFiles,
    findSameDive,
    hasRecordedMix,
    importFit,
    listTrips,
    MANUAL_DIVE_MODEL,
    matchNotes,
    newDraft,
    newNote,
    NotADiveError,
    presetFromDraft,
    type DiveDraft,
    type DiveNote,
    type GearPreset,
    type Logbook,
    type TripChoice,
  } from '@topside/core';
  import { formatDate, formatDepth, formatMinutes, profilePath } from '../lib/format.ts';
  import { loadLastGear, loadPresets, saveLastGear, savePresets } from '../lib/gear.ts';
  import { t } from '../lib/i18n.ts';
  import { nowWhen } from '../lib/time.ts';
  import { workspace } from '../lib/workspace.svelte.ts';
  import DetailsFields from './DetailsFields.svelte';
  import NoteForm from './NoteForm.svelte';
  import PositionField from './PositionField.svelte';

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
  const draftKey = (d: DiveDraft) => d.fit.fileName + d.fit.dive.when;

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
    if (preset) for (const d of drafts) applyPreset(d, preset, hasRecordedMix(d));
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

  // ---- Notes taken before the FIT file existed ----------------------------------------------
  /** Which note filled which draft; those notes are removed once the dives are added. */
  let noteFor = $state<Record<string, string>>({});
  let editingNote = $state.raw<DiveNote | null>(null);
  const linkedNotes = $derived(new Set(Object.values(noteFor)));
  const noteLabel = (n: DiveNote) => [formatDate(n.when), n.siteName].filter(Boolean).join(' · ');
  const noteSummary = (n: DiveNote) =>
    [
      n.siteName,
      n.startPressure !== null || n.endPressure !== null ? `${n.startPressure ?? '?'} → ${n.endPressure ?? '?'} bar` : '',
      n.buddy,
      n.maxDepth ? `${n.maxDepth} m` : '',
      n.duration ? `${n.duration} ${t.minutes}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

  function useNote(d: DiveDraft, id: string) {
    const note = workspace.notes.find((n) => n.id === id);
    if (!note) delete noteFor[draftKey(d)];
    else {
      applyNote(d, note, hasRecordedMix(d));
      noteFor[draftKey(d)] = note.id;
    }
  }
  async function saveNote(note: DiveNote) {
    await workspace.saveNote(note);
    editingNote = null;
  }
  async function removeNote(note: DiveNote) {
    if (!confirm(t.noteDeleteConfirm)) return;
    await workspace.deleteNotes([note.id]);
  }
  /** No FIT file will come: make the note a dive without a profile. */
  function addNoteAsDive(note: DiveNote) {
    const draft = draftFromNote(note);
    noteFor[draftKey(draft)] = note.id;
    drafts.push(draft);
    drafts.sort((a, b) => a.fit.dive.when - b.fit.dive.when);
  }
  function removeDraft(index: number) {
    const [removed] = drafts.splice(index, 1);
    if (removed) delete noteFor[draftKey(removed)];
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const fresh: DiveDraft[] = [];
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
          const waiting = [...drafts, ...fresh].map((d) => d.fit.dive);
          const known = findSameDive(logbook.dives, imported.dive) ?? findSameDive(waiting, imported.dive);
          if (known) rejected.push({ name: fit.name, reason: `${formatDate(imported.dive.when)} – ${t.alreadyThere}` });
          else fresh.push(newDraft(imported));
        } catch (e) {
          rejected.push({ name: fit.name, reason: e instanceof NotADiveError ? t.notADive : t.unreadable });
        }
      }
    }
    // Fill in the new drafts before they are shown: the chosen preset first, then what was noted
    // for exactly that dive.
    const preset = chosenPreset();
    if (preset) for (const d of fresh) applyPreset(d, preset, hasRecordedMix(d));
    const free = workspace.notes.filter((n) => !linkedNotes.has(n.id));
    const matched = matchNotes(free, fresh.map((d) => ({ when: d.fit.dive.when, duration: d.fit.dive.computers[0]?.duration ?? 0 })));
    for (const [index, note] of matched) {
      const d = fresh[index]!;
      applyNote(d, note, hasRecordedMix(d));
      noteFor[draftKey(d)] = note.id;
    }
    drafts.push(...fresh);
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
    const usedNotes = drafts.map((d) => noteFor[draftKey(d)]).filter((id): id is string => id !== undefined);
    const done = await onAdd($state.snapshot(drafts) as DiveDraft[], tripChoice());
    if (done) {
      if (last) saveLastGear(presetFromDraft('last', last));
      await workspace.deleteNotes(usedNotes);
      noteFor = {};
      presetNote = '';
      drafts = [];
      rejected = [];
      tripKey = 'none';
      newTripLocation = '';
    }
  }

  const siteKey = (d: DiveDraft) => (d.site.kind === 'existing' ? String(d.site.uuid) : d.site.kind);
  function setSite(d: DiveDraft, key: string) {
    d.site =
      key === 'none' ? { kind: 'none' } : key === 'new' ? { kind: 'new', name: '', location: d.fit.entry } : { kind: 'existing', uuid: Number(key) };
  }
  /** Positions the watch recorded: entry and, if different, exit. */
  function watchPositions(d: DiveDraft) {
    const out = d.fit.entry ? [{ label: t.posEntry, location: d.fit.entry }] : [];
    const exit = d.fit.exit;
    if (exit && !(d.fit.entry && d.fit.entry.lat === exit.lat && d.fit.entry.lon === exit.lon)) out.push({ label: t.posExit, location: exit });
    return out;
  }
</script>

{#if editingNote}
  <h2>{t.noteNew}</h2>
  <NoteForm {logbook} note={editingNote} onSave={saveNote} onCancel={() => (editingNote = null)} />
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

  <section class="card notes">
    <strong>{t.noteTitle}</strong>
    <p class="hint">{t.noteHint}</p>
    {#each workspace.notes as n (n.id)}
      <div class="note">
        <div class="dive-head">
          <div>
            <strong>{formatDate(n.when)}</strong>
            <span>{noteSummary(n) || '—'}</span>
          </div>
        </div>
        <div class="note-actions">
          <button class="link" onclick={() => (editingNote = n)}>{t.edit}</button>
          {#if canBecomeDive(n) && !linkedNotes.has(n.id)}
            <button class="link" onclick={() => addNoteAsDive(n)}>{t.noteAsDive}</button>
          {/if}
          <button class="link" onclick={() => removeNote(n)}>{t.noteDelete}</button>
        </div>
      </div>
    {/each}
    <button class="secondary" onclick={() => (editingNote = newNote(crypto.randomUUID(), nowWhen()))}>{t.noteNew}</button>
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

    <h2>{t.newDives}</h2>
    {#each drafts as d, i (d.fit.fileName + d.fit.dive.when)}
      {@const dc = d.fit.dive.computers[0]!}
      {@const linked = noteFor[draftKey(d)]}
      {@const choices = workspace.notes.filter((n) => n.id === linked || !linkedNotes.has(n.id))}
      <section class="card dive">
        <div class="dive-head">
          <div>
            <strong>{formatDate(d.fit.dive.when)}</strong>
            <span>
              {t.maxDepth}
              {formatDepth(dc.maxDepth)} · {formatMinutes(dc.duration)}
              {t.minutes} · {dc.model === MANUAL_DIVE_MODEL ? t.withoutProfile : dc.model}
            </span>
          </div>
          <button class="link" onclick={() => removeDraft(i)}>{t.remove}</button>
        </div>
        {#if dc.samples.length > 1}
          <svg viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path d={profilePath(d.fit.dive, 300, 60)} /></svg>
        {/if}

        {#if choices.length > 0 && dc.model !== MANUAL_DIVE_MODEL}
          <label>
            {t.noteLinked}
            <select value={linked ?? 'none'} onchange={(e) => useNote(d, e.currentTarget.value)}>
              <option value="none">{t.noteNone}</option>
              {#each choices as n (n.id)}<option value={n.id}>{noteLabel(n)}</option>{/each}
            </select>
          </label>
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
          <PositionField bind:location={d.site.location} suggestions={watchPositions(d)} />
        {/if}

        <DetailsFields bind:details={drafts[i]!} {logbook} recordedMix={hasRecordedMix(d)} />

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
  .note {
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
  .note-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 4px;
  }
</style>
