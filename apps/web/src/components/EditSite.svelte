<script lang="ts">
  /** Rename a dive site or correct its position. The change applies to every dive there. */
  import type { DiveSite, Location, Logbook, SiteEdit } from '@topside/core';
  import { t } from '../lib/i18n.ts';
  import PositionField from './PositionField.svelte';

  let {
    logbook,
    site,
    busy,
    onSave,
    onCancel,
  }: { logbook: Logbook; site: DiveSite; busy: boolean; onSave: (edit: SiteEdit) => Promise<boolean>; onCancel: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(site.name);
  // svelte-ignore state_referenced_locally
  let location = $state<Location | null | undefined>(site.location ? { ...site.location } : null);
  const dives = $derived(logbook.dives.filter((d) => d.siteUuid === site.uuid).length);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const edit: SiteEdit = { uuid: site.uuid };
    if (name.trim() && name.trim() !== site.name) edit.name = name.trim();
    const before = site.location;
    const after = location ?? null;
    if ((before === null) !== (after === null) || (before && after && (before.lat !== after.lat || before.lon !== after.lon))) edit.location = after;
    if (edit.name === undefined && edit.location === undefined) onCancel();
    else await onSave(edit);
  }
</script>

<form class="card" onsubmit={save}>
  <label>{t.siteName}<input required bind:value={name} /></label>
  <PositionField bind:location />
  <p class="hint">{t.siteDives(dives)}</p>
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
