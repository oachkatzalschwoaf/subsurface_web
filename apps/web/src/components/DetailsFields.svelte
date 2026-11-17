<script lang="ts">
  /**
   * The fields a diver fills in about a dive (people, suit, cylinder, gas, pressures, weights,
   * ratings, notes). Shared by new dives, notes and editing. Suggests values from the logbook.
   */
  import { cylinderTypes, usedValues, type DiveDetails, type Logbook } from '@topside/core';
  import { t } from '../lib/i18n.ts';

  let {
    details = $bindable(),
    logbook,
    recordedMix = false,
  }: {
    details: DiveDetails;
    logbook: Logbook;
    /** The dive computer recorded the gas mix: say so next to the oxygen field. */
    recordedMix?: boolean;
  } = $props();

  const uid = $props.id();
  const cylinders = $derived(cylinderTypes(logbook, t.commonCylinders));
  const suits = $derived(usedValues(logbook, (d) => d.suit));
  const buddies = $derived(usedValues(logbook, (d) => d.buddy));
  const guides = $derived(usedValues(logbook, (d) => d.diveGuide));
  const weightKinds = $derived(usedValues(logbook, (d) => d.weightsystems.map((w) => w.description)));

  /** "Other…" was picked: the cylinder is typed in by hand. */
  let ownCylinder = $state(false);
  const cylinderKey = $derived.by(() => {
    if (ownCylinder) return 'other';
    if (!details.cylinderDescription) return 'none';
    return cylinders.some((c) => c.description === details.cylinderDescription) ? details.cylinderDescription : 'other';
  });
  function setCylinder(key: string) {
    ownCylinder = key === 'other';
    if (ownCylinder) return;
    const type = cylinders.find((c) => c.description === key);
    details.cylinderDescription = type?.description ?? '';
    details.cylinderVolume = type ? (type.volume ?? details.cylinderVolume) : null;
  }
</script>

<datalist id="{uid}-suits">{#each suits as v}<option value={v}></option>{/each}</datalist>
<datalist id="{uid}-buddies">{#each buddies as v}<option value={v}></option>{/each}</datalist>
<datalist id="{uid}-guides">{#each guides as v}<option value={v}></option>{/each}</datalist>
<datalist id="{uid}-weights">{#each weightKinds as v}<option value={v}></option>{/each}</datalist>

<div class="grid">
  <label>{t.buddy}<input list="{uid}-buddies" bind:value={details.buddy} /></label>
  <label>{t.guide}<input list="{uid}-guides" bind:value={details.diveGuide} /></label>
  <label>{t.suit}<input list="{uid}-suits" bind:value={details.suit} /></label>
  <label>{t.tags}<input bind:value={details.tags} /></label>
  <label>
    {t.cylinder}
    <select value={cylinderKey} onchange={(e) => setCylinder(e.currentTarget.value)}>
      <option value="none">{t.cylinderNone}</option>
      {#each cylinders as c}<option value={c.description}>{c.description}</option>{/each}
      <option value="other">{t.cylinderOther}</option>
    </select>
  </label>
  {#if cylinderKey === 'other'}
    <label>{t.cylinder}: {t.cylinderDescription}<input bind:value={details.cylinderDescription} /></label>
  {/if}
  <label>{t.volume}<input type="number" inputmode="decimal" min="0" step="0.1" bind:value={details.cylinderVolume} /></label>
  <label>
    {t.o2}
    <input type="number" inputmode="numeric" min="21" max="100" step="1" placeholder="21" bind:value={details.cylinderO2} />
    {#if recordedMix}<small>{t.o2Recorded}</small>{/if}
  </label>
  <label>{t.startPressure}<input type="number" inputmode="numeric" min="0" bind:value={details.startPressure} /></label>
  <label>{t.endPressure}<input type="number" inputmode="numeric" min="0" bind:value={details.endPressure} /></label>
  <label>{t.weight}<input type="number" inputmode="decimal" min="0" step="0.5" bind:value={details.weight} /></label>
  <label>{t.weightDescription}<input list="{uid}-weights" bind:value={details.weightDescription} /></label>
  <label>
    {t.rating}
    <select bind:value={details.rating}>{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}>{n ? '★'.repeat(n) : '—'}</option>{/each}</select>
  </label>
  <label>
    {t.visibility}
    <select bind:value={details.visibility}>{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}>{n ? '★'.repeat(n) : '—'}</option>{/each}</select>
  </label>
</div>
<label>{t.notes}<textarea rows="3" bind:value={details.notes}></textarea></label>

<style>
  small {
    font-size: 0.8rem;
  }
</style>
