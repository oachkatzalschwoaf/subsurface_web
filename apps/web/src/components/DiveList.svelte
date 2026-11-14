<script lang="ts">
  import { toTm, type Dive, type Logbook, type Trip } from '@topside/core';
  import { formatDate, formatDepth, formatMinutes, profilePath } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';

  let { logbook, onOpen }: { logbook: Logbook; onOpen: (dive: Dive) => void } = $props();

  interface Group {
    key: Trip | string;
    label: string;
    dives: Dive[];
  }

  // Newest first; a trip forms one group, dives without a trip are grouped by year.
  const groups = $derived.by(() => {
    const out: Group[] = [];
    for (const dive of [...logbook.dives].reverse()) {
      const key: Trip | string = dive.trip ?? `year-${toTm(dive.when).year}`;
      let group = out.find((g) => g.key === key);
      if (!group) {
        const label = dive.trip ? dive.trip.location || '—' : `${t.noTrip} ${toTm(dive.when).year}`;
        group = { key, label, dives: [] };
        out.push(group);
      }
      group.dives.push(dive);
    }
    return out;
  });

  const siteName = (dive: Dive) => logbook.sites.find((s) => s.uuid === dive.siteUuid)?.name ?? '';
</script>

{#if logbook.dives.length === 0}
  <p class="hint">{t.noDives}</p>
{/if}

{#each groups as group, i (group.key)}
  <details class="group" open={i < 2}>
    <summary>
      <span>{group.label}</span>
      <span class="count">{group.dives.length}</span>
    </summary>
    <ul>
      {#each group.dives as dive (dive.when)}
        {@const dc = dive.computers[0]}
        <li>
          <button class="row" onclick={() => onOpen(dive)}>
            <span class="nr">{dive.number || '–'}</span>
            <span class="main">
              <strong>{siteName(dive) || formatDate(dive.when)}</strong>
              <small>{formatDate(dive.when)}</small>
            </span>
            {#if (dc?.samples.length ?? 0) > 1}
              <svg viewBox="0 0 80 28" preserveAspectRatio="none" aria-hidden="true"><path d={profilePath(dive, 80, 28)} /></svg>
            {/if}
            <span class="nums">
              <strong>{formatDepth(dc?.maxDepth ?? 0)}</strong>
              <small>{formatMinutes(dc?.duration ?? 0)} {t.minutes}</small>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </details>
{/each}

<style>
  .group {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  summary {
    display: flex;
    justify-content: space-between;
    padding: 12px 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .count {
    color: var(--muted);
    font-weight: 500;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    background: none;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    color: var(--text);
    font-weight: 400;
    padding: 10px 14px;
    text-align: left;
    min-height: 56px;
  }
  li + li .row {
    border-top: 0;
  }
  .nr {
    width: 2.2em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .main,
  .nums {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .main {
    flex: 1;
  }
  .main strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nums {
    align-items: flex-end;
    font-variant-numeric: tabular-nums;
  }
  small {
    color: var(--muted);
    font-size: 0.85rem;
  }
  svg {
    width: 80px;
    height: 28px;
    flex: none;
  }
  svg path {
    fill: var(--series-depth);
    opacity: 0.45;
  }
</style>
