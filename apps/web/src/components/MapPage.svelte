<script lang="ts">
  /**
   * Every dive site with a position as a flag on an OpenStreetMap map. A flag lists the site's
   * dives; each entry opens the dive. Leaflet is loaded only when the map is opened, and the tiles
   * come from tile.openstreetmap.org (allowed in the CSP in public/.htaccess).
   */
  import 'leaflet/dist/leaflet.css';
  import { hasLocation, type Dive, type DiveSite, type Logbook } from '@topside/core';
  import type * as Leaflet from 'leaflet';
  import { onMount } from 'svelte';
  import flagUrl from '../assets/dive-flag.svg';
  import { formatDate } from '../lib/format.ts';
  import { t } from '../lib/i18n.ts';

  let { logbook }: { logbook: Logbook } = $props();

  interface Place {
    site: DiveSite;
    lat: number;
    lon: number;
    dives: Dive[];
  }
  const places = $derived<Place[]>(
    logbook.sites
      .filter((site) => hasLocation(site.location))
      .map((site) => ({
        site,
        lat: site.location!.lat / 1e6,
        lon: site.location!.lon / 1e6,
        dives: logbook.dives.filter((d) => d.siteUuid === site.uuid).sort((a, b) => a.when - b.when),
      }))
      .filter((p) => p.dives.length > 0),
  );

  let container = $state<HTMLDivElement>();
  let leaflet = $state.raw<typeof Leaflet | null>(null);
  let map: Leaflet.Map | null = null;

  onMount(() => {
    let disposed = false;
    void import('leaflet').then((module) => {
      if (disposed || !container) return;
      const L = module.default;
      map = L.map(container, { worldCopyJump: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // The app sends no referrer; OpenStreetMap asks for one, so the tiles send the origin only.
        referrerPolicy: 'strict-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      leaflet = L;
    });
    return () => {
      disposed = true;
      map?.remove();
      map = null;
    };
  });

  /** Popup content built from DOM nodes, so names from the logbook are never parsed as HTML. */
  function popup(place: Place): HTMLElement {
    const box = document.createElement('div');
    box.className = 'map-popup';
    const title = document.createElement('strong');
    title.textContent = place.site.name;
    const list = document.createElement('ul');
    for (const dive of place.dives) {
      const link = document.createElement('a');
      link.href = `#/dive/${dive.when}`;
      link.textContent = `${dive.number ? `#${dive.number} · ` : ''}${formatDate(dive.when)}`;
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
    box.append(title, list);
    return box;
  }

  $effect(() => {
    const L = leaflet;
    if (!L || !map) return;
    const icon = L.icon({ iconUrl: flagUrl, iconSize: [32, 40], iconAnchor: [4, 39], popupAnchor: [12, -36] });
    const group = L.featureGroup();
    for (const place of places) {
      L.marker([place.lat, place.lon], { icon, title: place.site.name, alt: place.site.name })
        .bindPopup(() => popup(place))
        .addTo(group);
    }
    group.addTo(map);
    if (places.length > 0) map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 13 });
    else map.setView([20, 0], 2);
    return () => {
      group.remove();
    };
  });
</script>

{#if places.length === 0}<p class="hint">{t.mapEmpty}</p>{/if}
<div class="map" bind:this={container}></div>

<style>
  .map {
    height: max(320px, calc(100dvh - 220px));
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--line);
  }
  :global(.map-popup strong) {
    display: block;
    margin-bottom: 4px;
    font-size: 0.95rem;
  }
  :global(.map-popup ul) {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 180px;
    overflow-y: auto;
  }
  :global(.map-popup li) {
    padding: 3px 0;
  }
  :global(.map-popup a) {
    color: #0b5c8a;
    font-size: 0.9rem;
  }
</style>
