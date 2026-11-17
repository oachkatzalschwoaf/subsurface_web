<script lang="ts">
  /** A note about a dive whose FIT file does not exist yet: time, site and the usual details. */
  import { applyPreset, type DiveNote, type Logbook } from '@topside/core';
  import { loadLastGear, loadPresets } from '../lib/gear.ts';
  import { t } from '../lib/i18n.ts';
  import { inputToWhen, whenToInput } from '../lib/time.ts';
  import DetailsFields from './DetailsFields.svelte';

  let {
    logbook,
    note: initial,
    onSave,
    onCancel,
  }: { logbook: Logbook; note: DiveNote; onSave: (note: DiveNote) => void; onCancel: () => void } = $props();

  const uid = $props.id();
  // svelte-ignore state_referenced_locally
  let note = $state<DiveNote>(structuredClone($state.snapshot(initial)));
  // svelte-ignore state_referenced_locally
  let when = $state(whenToInput(initial.when));
  const sites = $derived(logbook.sites.map((s) => s.name).filter(Boolean).sort((a, b) => a.localeCompare(b)));

  const presets = loadPresets();
  const lastGear = loadLastGear();
  function usePreset(key: string) {
    const preset = key === 'last' ? lastGear : presets[Number(key)];
    if (preset) applyPreset(note, preset);
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    const time = inputToWhen(when);
    if (time === null) return;
    onSave({ ...$state.snapshot(note), when: time });
  }
</script>

<form class="card" onsubmit={save}>
  <label>{t.noteWhen}<input type="datetime-local" required bind:value={when} /></label>
  <label>
    {t.site}
    <input list="{uid}-sites" bind:value={note.siteName} />
    <datalist id="{uid}-sites">{#each sites as s}<option value={s}></option>{/each}</datalist>
  </label>
  {#if presets.length > 0 || lastGear}
    <label>
      {t.gearPreset}
      <select onchange={(e) => usePreset(e.currentTarget.value)}>
        <option value="none">{t.presetNone}</option>
        {#if lastGear}<option value="last">{t.presetLast}</option>{/if}
        {#each presets as p, i}<option value={String(i)}>{p.name}</option>{/each}
      </select>
    </label>
  {/if}

  <DetailsFields bind:details={note} {logbook} />

  <div class="grid">
    <label>{t.noteDepth}<input type="number" inputmode="decimal" min="0" step="0.1" bind:value={note.maxDepth} /></label>
    <label>{t.noteDuration}<input type="number" inputmode="numeric" min="0" step="1" bind:value={note.duration} /></label>
  </div>
  <p class="hint">{t.noteManualHint}</p>

  <div class="row">
    <button type="button" class="secondary" onclick={onCancel}>{t.cancel}</button>
    <button class="primary">{t.noteSave}</button>
  </div>
</form>

<style>
  .row {
    display: flex;
    gap: 12px;
  }
  .row button {
    flex: 1;
  }
</style>
