<script lang="ts">
  /** Change the details of a dive that is already in the logbook. Only changed fields are saved. */
  import { changedDetails, detailsOf, isEmptyEdit, type Dive, type DiveEdit, type Logbook, type SiteChoice } from '@topside/core';
  import { formatDate } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';
  import DetailsFields from './DetailsFields.svelte';

  let {
    logbook,
    dive,
    busy,
    onSave,
    onCancel,
    onDelete,
  }: {
    logbook: Logbook;
    dive: Dive;
    busy: boolean;
    onSave: (edit: DiveEdit) => Promise<boolean>;
    onCancel: () => void;
    onDelete?: (() => void) | undefined;
  } = $props();

  // svelte-ignore state_referenced_locally
  const before = detailsOf(dive);
  let details = $state(structuredClone(before));

  // svelte-ignore state_referenced_locally
  const siteBefore = dive.siteUuid === null ? 'none' : String(dive.siteUuid);
  let siteKey = $state(siteBefore);
  let newSiteName = $state('');
  const sites = $derived([...logbook.sites].filter((s) => s.name || String(s.uuid) === siteBefore).sort((a, b) => a.name.localeCompare(b.name)));

  function siteChoice(): SiteChoice | undefined {
    if (siteKey === 'new') return newSiteName.trim() ? { kind: 'new', name: newSiteName } : undefined;
    if (siteKey === siteBefore) return undefined;
    return siteKey === 'none' ? { kind: 'none' } : { kind: 'existing', uuid: Number(siteKey) };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const edit: DiveEdit = { when: dive.when, changes: changedDetails(before, $state.snapshot(details)) };
    const site = siteChoice();
    if (site) edit.site = site;
    if (isEmptyEdit(edit)) onCancel();
    else await onSave(edit);
  }
</script>

<form class="card" onsubmit={save}>
  <div>
    <strong>{dive.number ? `#${dive.number} ` : ''}{formatDate(dive.when)}</strong>
  </div>
  <label>
    {t.site}
    <select bind:value={siteKey}>
      <option value="none">{t.siteNone}</option>
      <option value="new">{t.siteNew}</option>
      {#each sites as s}<option value={String(s.uuid)}>{s.name || '—'}</option>{/each}
    </select>
  </label>
  {#if siteKey === 'new'}
    <label>{t.siteName}<input bind:value={newSiteName} /></label>
  {/if}

  <DetailsFields bind:details {logbook} />
  {#if dive.cylinders.length > 1 || dive.weightsystems.length > 1}
    <p class="hint">{t.editFirstOnly}</p>
  {/if}

  <div class="row">
    <button type="button" class="secondary" onclick={onCancel}>{t.cancel}</button>
    <button class="primary" disabled={busy}>{busy ? t.uploading : t.save}</button>
  </div>
  {#if onDelete}
    <button type="button" class="secondary danger" disabled={busy} onclick={onDelete}>{t.deleteDive}</button>
  {/if}
</form>

<style>
  .row {
    display: flex;
    gap: 12px;
  }
  .row button {
    flex: 1;
  }
  .danger {
    margin-top: 12px;
    color: var(--error);
    border-color: var(--error);
  }
</style>
