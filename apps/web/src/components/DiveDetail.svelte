<script lang="ts">
  import { CYLINDER_USE, type Dive, type Logbook } from '@topside/core';
  import { summary } from '../lib/dive-data.ts';
  import { formatDate } from '../lib/format.ts';
  import { locale, t } from '../lib/i18n.ts';
  import DiveChart from './DiveChart.svelte';

  let { logbook, dive, onShare }: { logbook: Logbook; dive: Dive; onShare: () => void } = $props();

  const info = $derived(summary(logbook, dive));
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const gas = (o2: number, he: number) => (!o2 ? t.gasAir : he ? `Tx ${o2 / 10}/${he / 10}` : `EAN${Math.round(o2 / 10)}`);

  const tiles = $derived(
    [
      { label: t.statMaxDepth, value: `${one.format(info.maxDepth)} m` },
      { label: t.statDuration, value: `${Math.round(info.duration / 60)} min` },
      info.meanDepth !== null ? { label: t.statMeanDepth, value: `${one.format(info.meanDepth)} m` } : null,
      info.waterTemp !== null ? { label: t.statWater, value: `${one.format(info.waterTemp)} °C` } : null,
      info.airTemp !== null ? { label: t.statAir, value: `${one.format(info.airTemp)} °C` } : null,
    ].filter((x): x is { label: string; value: string } => x !== null),
  );

  const people = $derived(
    [
      [t.buddy, dive.buddy],
      [t.guide, dive.diveGuide],
      [t.suit, dive.suit],
      ['Tags', dive.tags.join(', ')],
      [t.computer, info.model],
    ].filter(([, v]) => v) as [string, string][],
  );
</script>

<section class="card head">
  <div>
    <h2>{dive.number ? `#${dive.number} ` : ''}{info.site || formatDate(dive.when)}</h2>
    <p class="hint">{formatDate(dive.when)}{info.trip ? ` · ${info.trip}` : ''}</p>
  </div>
  <button class="secondary" onclick={onShare}>{t.share}</button>
</section>

<section class="tiles">
  {#each tiles as tile}
    <div class="tile"><span>{tile.label}</span><strong>{tile.value}</strong></div>
  {/each}
</section>

<section class="card">
  <DiveChart {dive} />
</section>

{#if people.length || dive.rating || dive.visibility}
  <section class="card">
    <dl>
      {#each people as [label, value]}
        <dt>{label}</dt>
        <dd>{value}</dd>
      {/each}
      {#if dive.rating}<dt>{t.rating}</dt><dd class="stars" aria-label={`${dive.rating}/5`}>{stars(dive.rating)}</dd>{/if}
      {#if dive.visibility}<dt>{t.visibility}</dt><dd class="stars" aria-label={`${dive.visibility}/5`}>{stars(dive.visibility)}</dd>{/if}
    </dl>
  </section>
{/if}

{#if dive.cylinders.length || dive.weightsystems.length}
  <section class="card">
    <dl>
      {#each dive.cylinders as c}
        <dt>{t.cylinder}</dt>
        <dd>
          {[c.description, c.volume ? `${one.format(c.volume / 1000)} l` : '', gas(c.o2, c.he), c.use > 0 ? CYLINDER_USE[c.use] : '']
            .filter(Boolean)
            .join(' · ')}
          {#if c.start || c.end}<br />{c.start ? Math.round(c.start / 1000) : '?'} → {c.end ? Math.round(c.end / 1000) : '?'} bar{/if}
        </dd>
      {/each}
      {#each dive.weightsystems as w}
        <dt>{t.weight}</dt>
        <dd>{one.format(w.weight / 1000)} kg{w.description ? ` · ${w.description}` : ''}</dd>
      {/each}
    </dl>
  </section>
{/if}

{#if dive.notes}
  <section class="card">
    <h3>{t.notes}</h3>
    <p class="notes">{dive.notes}</p>
  </section>
{/if}

<style>
  .head {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text);
  }
  h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .tile {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
  }
  .tile span {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .tile strong {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .stars {
    letter-spacing: 2px;
  }
  .notes {
    white-space: pre-wrap;
    margin: 0;
  }
</style>
