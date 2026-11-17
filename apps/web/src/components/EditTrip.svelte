<script lang="ts">
  /** Rename a trip or change its notes. */
  import type { Logbook, Trip, TripEdit } from '@topside/core';
  import { formatDateRange } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';

  let {
    entry,
    busy,
    onSave,
    onCancel,
  }: {
    logbook: Logbook;
    entry: { trip: Trip; first: number; last: number; dives: number };
    busy: boolean;
    onSave: (edit: TripEdit) => Promise<boolean>;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let location = $state(entry.trip.location);
  // svelte-ignore state_referenced_locally
  let notes = $state(entry.trip.notes);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const edit: TripEdit = { location: entry.trip.location, first: entry.first };
    if (location.trim() && location.trim() !== entry.trip.location) edit.newLocation = location.trim();
    if (notes.trim() !== entry.trip.notes.trim()) edit.notes = notes.trim();
    if (edit.newLocation === undefined && edit.notes === undefined) onCancel();
    else await onSave(edit);
  }
</script>

<form class="card" onsubmit={save}>
  <p class="hint">{formatDateRange(entry.first, entry.last)} · {t.logbook(entry.dives)}</p>
  <label>{t.tripLocation}<input required bind:value={location} /></label>
  <label>{t.tripNotes}<textarea rows="3" bind:value={notes}></textarea></label>
  <div class="row">
    <button type="button" class="secondary" onclick={onCancel}>{t.cancel}</button>
    <button class="primary" disabled={busy}>{busy ? t.uploading : t.save}</button>
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
