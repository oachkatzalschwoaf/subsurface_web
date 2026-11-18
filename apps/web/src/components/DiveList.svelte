<script lang="ts">
  import { searchDives, toTm, type Dive, type Logbook, type Trip } from '@topside/core';
  import { formatDate, formatDateRange, formatDepth, formatMinutes, profilePath } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';

  let {
    logbook,
    pending,
    selected = null,
    onOpen,
    onEditTrip,
  }: {
    logbook: Logbook;
    pending?: Set<Dive> | undefined;
    selected?: Dive | null;
    onOpen: (dive: Dive) => void;
    /** Missing = trips cannot be edited */
    onEditTrip?: ((trip: Trip) => void) | undefined;
  } = $props();

  interface Group {
    key: Trip | string;
    /** Stays the same while the logbook is rebuilt (a pending change makes new trip objects) */
    id: string;
    label: string;
    dives: Dive[];
  }

  let query = $state('');
  const found = $derived(searchDives(logbook, query));
  const searching = $derived(query.trim() !== '');

  // Newest first; a trip forms one group, dives without a trip are grouped by year.
  const groups = $derived.by(() => {
    const out = new Map<Trip | string, Group>();
    for (const dive of [...found].reverse()) {
      const key: Trip | string = dive.trip ?? `year-${toTm(dive.when).year}`;
      let group = out.get(key);
      if (!group) {
        const label = dive.trip ? dive.trip.location || '—' : `${t.noTrip} ${toTm(dive.when).year}`;
        group = { key, id: typeof key === 'string' ? key : '', label, dives: [] };
        out.set(key, group);
      }
      group.dives.push(dive);
    }
    // a trip by its first dive
    for (const group of out.values()) if (!group.id) group.id = `trip-${group.dives.at(-1)!.when}`;
    return [...out.values()];
  });

  /** Groups opened or closed by hand; the others follow isOpen()'s default. */
  let toggled = $state<Record<string, boolean>>({});
  const isOpen = (group: Group, i: number) =>
    searching || (toggled[group.id] ?? (i < 2 || (selected !== null && group.dives.includes(selected))));

  const sites = $derived(new Map(logbook.sites.map((s) => [s.uuid, s.name])));
  const siteName = (dive: Dive) => (dive.siteUuid === null ? '' : (sites.get(dive.siteUuid) ?? ''));
</script>

{#if logbook.dives.length === 0}
  <p class="hint">{t.noDives}</p>
{:else}
  <div class="search">
    <input type="search" placeholder={t.search} aria-label={t.search} bind:value={query} />
    {#if searching}<small class="hint">{t.searchCount(found.length, logbook.dives.length)}</small>{/if}
  </div>
{/if}

{#each groups as group, i (group.id)}
  {@const open = isOpen(group, i)}
  <details class="group" {open} ontoggle={(e) => (toggled[group.id] = e.currentTarget.open)}>
    <summary>
      <span class="title">
        <span>{group.label}</span>
        <small>{formatDateRange(group.dives.at(-1)!.when, group.dives[0]!.when)}</small>
      </span>
      <span class="count">{group.dives.length}</span>
    </summary>
    <!-- rows of closed groups are not built: a long logbook has hundreds of profiles -->
    {#if open}
      <ul>
        {#each group.dives as dive (dive.when)}
          {@const dc = dive.computers[0]}
          <li>
            <button class="row" aria-current={dive === selected ? 'true' : undefined} onclick={() => onOpen(dive)}>
              <span class="nr">{dive.number || '–'}</span>
              <span class="main">
                <strong>{pending?.has(dive) ? "⏳ " : ""}{siteName(dive) || formatDate(dive.when)}</strong>
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
      {#if onEditTrip && typeof group.key !== 'string'}
        {@const trip = group.key}
        <button class="link trip-edit" onclick={() => onEditTrip(trip)}>{t.tripEdit}</button>
      {/if}
    {/if}
  </details>
{/each}

<style>
  .trip-edit {
    display: block;
    margin: 4px 10px 10px auto;
    font-size: 0.85rem;
  }
  .search {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
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
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title small {
    font-weight: 500;
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
  .row[aria-current] {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: inset 4px 0 0 var(--accent);
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
  .main strong,
  .main small {
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
  /* phones: room for the whole date line */
  @media (max-width: 420px) {
    svg {
      width: 52px;
    }
  }
  svg path {
    fill: var(--series-depth);
    opacity: 0.45;
  }
</style>
