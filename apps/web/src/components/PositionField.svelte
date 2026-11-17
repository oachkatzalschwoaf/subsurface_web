<script lang="ts">
  /**
   * Where a dive site is: a position from the dive computer, the phone's current position,
   * coordinates typed in, or none. Links to the map for checking.
   */
  import { formatCoordinates, parseCoordinates, type Location } from '@topside/core';
  import { t } from '../lib/i18n.ts';

  let {
    location = $bindable(),
    suggestions = [],
  }: {
    location: Location | null | undefined;
    /** Positions to offer, e.g. entry and exit point recorded by the watch */
    suggestions?: { label: string; location: Location }[];
  } = $props();

  const same = (a: Location | null | undefined, b: Location | null | undefined) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;

  /** Coordinates are typed in (or came from the phone and may be corrected). */
  let manual = $state(false);
  // svelte-ignore state_referenced_locally
  let text = $state(location ? formatCoordinates(location) : '');
  let invalid = $state(false);
  let locating = $state(false);
  let geoError = $state('');

  const key = $derived.by(() => {
    if (manual) return 'manual';
    if (!location) return 'none';
    const at = suggestions.findIndex((s) => same(s.location, location));
    return at >= 0 ? String(at) : 'manual';
  });

  function choose(value: string) {
    geoError = '';
    invalid = false;
    if (value === 'here') return locate();
    manual = value === 'manual';
    if (value === 'none') location = null;
    else if (!manual) location = suggestions[Number(value)]?.location ?? null;
    text = location ? formatCoordinates(location) : '';
  }

  function typed(value: string) {
    text = value;
    const parsed = parseCoordinates(value);
    invalid = value.trim() !== '' && parsed === null;
    location = value.trim() === '' ? null : (parsed ?? location);
  }

  function locate() {
    if (!navigator.geolocation) {
      geoError = t.posFailed;
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locating = false;
        location = { lat: Math.round(position.coords.latitude * 1e6), lon: Math.round(position.coords.longitude * 1e6) };
        manual = true;
        text = formatCoordinates(location);
      },
      () => {
        locating = false;
        geoError = t.posFailed;
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 },
    );
  }

  const mapUrl = (l: Location) => {
    const lat = (l.lat / 1e6).toFixed(6);
    const lon = (l.lon / 1e6).toFixed(6);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
  };
</script>

<div class="position">
  <label>
    {t.position}
    <select value={key} onchange={(e) => choose(e.currentTarget.value)}>
      <option value="none">{t.posNone}</option>
      {#each suggestions as s, i}<option value={String(i)}>{s.label} ({formatCoordinates(s.location)})</option>{/each}
      <option value="here">{t.posHere}</option>
      <option value="manual">{t.posManual}</option>
    </select>
  </label>
  {#if key === 'manual'}
    <label>
      {t.coordinates}
      <input inputmode="decimal" placeholder="47.906674, -13.567017" value={text} oninput={(e) => typed(e.currentTarget.value)} />
    </label>
  {/if}
  {#if locating}<p class="hint">{t.posLocating}</p>{/if}
  {#if geoError}<p class="hint">⚠ {geoError}</p>{/if}
  {#if invalid}<p class="hint">⚠ {t.posInvalid}</p>{/if}
  {#if location}
    <a class="hint" href={mapUrl(location)} target="_blank" rel="noopener noreferrer">{t.showMap} ↗</a>
  {/if}
</div>

<style>
  .position {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .position a {
    align-self: flex-start;
  }
</style>
