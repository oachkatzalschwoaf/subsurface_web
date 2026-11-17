<script lang="ts">
  /** Logbook statistics: totals, records, per year and per trip. */
  import { logStats, ZERO_C_IN_MKELVIN, type Dive, type Logbook } from '@topside/core';
  import { formatDate, formatDateRange } from '../lib/format.ts';
  import { locale, t } from '../lib/i18n.ts';

  let { logbook, onOpen }: { logbook: Logbook; onOpen: (dive: Dive) => void } = $props();

  const s = $derived(logStats(logbook));
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const hours = (seconds: number) => {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
  };
  const metres = (mm: number) => `${one.format(mm / 1000)} m`;
  const celsius = (mk: number) => `${one.format((mk - ZERO_C_IN_MKELVIN) / 1000)} °C`;
  const siteOf = (d: Dive) => logbook.sites.find((x) => x.uuid === d.siteUuid)?.name || formatDate(d.when);

  const tiles = $derived(
    [
      { label: t.statsDives, value: String(s.dives) },
      { label: t.statsTime, value: hours(s.seconds) },
      s.meanDepth !== null ? { label: t.statMeanDepth, value: metres(s.meanDepth) } : null,
      s.sac !== null ? { label: t.statsSac, value: `${one.format(s.sac / 1000)} l/min` } : null,
      { label: t.statsSites, value: String(s.sites) },
    ].filter((x): x is { label: string; value: string } => x !== null),
  );
  const records = $derived(
    [
      s.deepest ? { label: t.statsDeepest, value: metres(s.deepest.value), dive: s.deepest.dive } : null,
      s.longest ? { label: t.statsLongest, value: `${Math.round(s.longest.value / 60)} min`, dive: s.longest.dive } : null,
      s.coldest ? { label: t.statsColdest, value: celsius(s.coldest.value), dive: s.coldest.dive } : null,
      s.warmest ? { label: t.statsWarmest, value: celsius(s.warmest.value), dive: s.warmest.dive } : null,
    ].filter((x): x is { label: string; value: string; dive: Dive } => x !== null),
  );
</script>

{#if s.dives === 0}
  <p class="hint">{t.noDives}</p>
{:else}
  <section class="tiles">
    {#each tiles as tile}
      <div class="tile"><span>{tile.label}</span><strong>{tile.value}</strong></div>
    {/each}
  </section>

  <section class="card">
    <h3>{t.statsRecords}</h3>
    <ul class="records">
      {#each records as r}
        <li>
          <button class="row-link" onclick={() => onOpen(r.dive)}>
            <span>{r.label}</span>
            <strong>{r.value}</strong>
            <small>{r.dive.number ? `#${r.dive.number} ` : ''}{siteOf(r.dive)}</small>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <section class="card">
    <h3>{t.statsPerYear}</h3>
    <table>
      <thead><tr><th></th><th>{t.statsDives}</th><th>{t.statsTime}</th><th>{t.statMaxDepth}</th></tr></thead>
      <tbody>
        {#each s.years as y}
          <tr><td>{y.year}</td><td>{y.dives}</td><td>{hours(y.seconds)}</td><td>{metres(y.maxDepth)}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if s.trips.length > 0}
    <section class="card">
      <h3>{t.statsPerTrip}</h3>
      <table>
        <thead><tr><th></th><th>{t.statsDives}</th><th>{t.statsTime}</th><th>{t.statMaxDepth}</th></tr></thead>
        <tbody>
          {#each s.trips as trip}
            <tr>
              <td>{trip.trip.location || '—'}<br /><small>{formatDateRange(trip.first, trip.last)}</small></td>
              <td>{trip.dives}</td>
              <td>{hours(trip.seconds)}</td>
              <td>{metres(trip.maxDepth)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
  <p class="hint">{t.statsNote}</p>
{/if}

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
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
  h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .records {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .records li + li {
    border-top: 1px solid var(--line);
  }
  .row-link {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 12px;
    width: 100%;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 8px 0;
    min-height: 0;
    color: var(--text);
    font-weight: 400;
    text-align: left;
  }
  .row-link strong {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .row-link small {
    grid-column: 1 / -1;
    color: var(--muted);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 6px 4px;
    text-align: right;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  th {
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 600;
  }
  td small {
    color: var(--muted);
  }
</style>
