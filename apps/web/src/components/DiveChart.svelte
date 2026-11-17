<script lang="ts">
  /**
   * Dive profile as small multiples on one time axis: depth (main), water temperature and heart
   * rate. One y-axis per panel; a shared crosshair shows all values at the pointer's time.
   */
  import type { Dive } from '@topside/core';
  import { downsample, nearest, niceStep, profile, type Point } from '../lib/dive-data.ts';
  import { locale, t } from '../lib/i18n.ts';

  let { dive }: { dive: Dive } = $props();

  let width = $state(640);
  let hover = $state<number | null>(null);

  const LEFT = 44;
  const RIGHT = 12;
  const GAP = 28;
  const DEPTH_H = 220;
  const SMALL_H = 72;

  const all = $derived(profile(dive));
  const pts = $derived(downsample(all, Math.max(200, Math.round(width * 1.5))));
  const maxT = $derived(Math.max(all.at(-1)?.t ?? 1, 1));
  const maxD = $derived(Math.max(...all.map((p) => p.depth), 1));
  const temps = $derived(all.filter((p) => p.temp !== null).map((p) => p.temp!));
  const hrs = $derived(all.filter((p) => p.hr !== null).map((p) => p.hr!));
  const hasTemp = $derived(temps.length > 1);
  const hasHr = $derived(hrs.length > 1);

  const events = $derived(
    (dive.computers[0]?.events ?? []).filter((e) => !/^Alert (timed out|dismissed)$/.test(e.name)),
  );

  // Layout
  const plotW = $derived(Math.max(width - LEFT - RIGHT, 50));
  const depthTop = 22;
  const tempTop = $derived(depthTop + DEPTH_H + GAP + 14);
  const hrTop = $derived((hasTemp ? tempTop + SMALL_H + GAP : tempTop) + (hasTemp ? 14 : 0));
  const axisY = $derived((hasHr ? hrTop + SMALL_H : hasTemp ? tempTop + SMALL_H : depthTop + DEPTH_H) + 4);
  const height = $derived(axisY + 34);

  const x = (s: number) => LEFT + (s / maxT) * plotW;
  const yDepth = (m: number) => depthTop + (m / (maxD * 1.08)) * DEPTH_H;

  function range(values: number[], pad: number): [number, number] {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi - lo < pad ? [lo - pad / 2, hi + pad / 2] : [lo, hi];
  }
  const tempRange = $derived(hasTemp ? range(temps, 2) : [0, 1]);
  const hrRange = $derived(hasHr ? range(hrs, 20) : [0, 1]);
  const ySmall = (v: number, [lo, hi]: number[], top: number) => top + SMALL_H - ((v - lo! ) / (hi! - lo! || 1)) * SMALL_H;

  function line(points: Point[], value: (p: Point) => number | null, y: (v: number) => number): string {
    let d = '';
    let pen = false;
    for (const p of points) {
      const v = value(p);
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  }

  const depthLine = $derived(line(pts, (p) => p.depth, yDepth));
  const depthArea = $derived(depthLine ? `${depthLine}L${x(pts.at(-1)!.t).toFixed(1)},${depthTop}L${LEFT},${depthTop}Z` : '');
  const tempLine = $derived(hasTemp ? line(pts, (p) => p.temp, (v) => ySmall(v, tempRange, tempTop)) : '');
  const hrLine = $derived(hasHr ? line(pts, (p) => p.hr, (v) => ySmall(v, hrRange, hrTop)) : '');

  const depthTicks = $derived.by(() => {
    const step = niceStep(maxD, 4);
    const out: number[] = [];
    for (let v = 0; v <= maxD * 1.08; v += step) out.push(v);
    return out;
  });
  const timeTicks = $derived.by(() => {
    const step = niceStep(maxT / 60, Math.max(4, Math.floor(plotW / 55)));
    const out: number[] = [];
    // count in steps, not by adding: 0.1 + 0.2 is 0.30000000000000004
    for (let i = 0; i * step * 60 <= maxT; i++) out.push(Number((i * step).toFixed(6)));
    return out;
  });

  const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  function depthAt(time: number): number {
    return all.length ? all[nearest(all, time)]!.depth : 0;
  }

  /**
   * Touch: the values show while the finger is on the chart (drag to scrub) and disappear on
   * release, so the whole profile is visible again. Mouse: they follow the pointer.
   */
  let touching = false;
  function endTouch() {
    touching = false;
    hover = null;
  }

  function onPointer(e: PointerEvent) {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const s = ((e.clientX - rect.left) / rect.width) * maxT;
    hover = all.length ? nearest(all, Math.min(Math.max(s, 0), maxT)) : null;
  }

  const hp = $derived(hover !== null ? all[hover] : undefined);
  const hoverEvents = $derived(hp ? events.filter((e) => Math.abs(e.time - hp.t) <= 6) : []);
  const tipLeft = $derived(hp ? Math.min(Math.max(x(hp.t) + 10, 0), width - 170) : 0);
</script>

{#if all.length < 2}
  <p class="hint">{t.noProfile}</p>
{:else}
  <div class="chart" bind:clientWidth={width}>
    <svg {width} {height} role="img" aria-label={`${t.chartDepth}: max ${one.format(maxD)} m`}>
      <!-- depth panel -->
      <text class="title" x={LEFT} y="12">{t.chartDepth}</text>
      {#each depthTicks as v}
        <line class="grid" x1={LEFT} x2={LEFT + plotW} y1={yDepth(v)} y2={yDepth(v)} />
        <text class="tick" x={LEFT - 6} y={yDepth(v) + 4} text-anchor="end">{v}</text>
      {/each}
      <path class="depth-area" d={depthArea} />
      <path class="depth-line" d={depthLine} />
      {#each events as e}
        {@const ex = x(e.time)}
        {@const ey = yDepth(depthAt(e.time))}
        {#if e.flags >= 8}
          <path class="event warn" d={`M${ex},${ey - 13} l7,12 h-14 z`} />
        {:else}
          <circle class="event info" cx={ex} cy={ey - 7} r="4" />
        {/if}
      {/each}

      {#if hasTemp}
        <text class="title" x={LEFT} y={tempTop - 8}>{t.chartTemp}</text>
        <line class="grid" x1={LEFT} x2={LEFT + plotW} y1={tempTop + SMALL_H} y2={tempTop + SMALL_H} />
        <text class="tick" x={LEFT - 6} y={tempTop + 8} text-anchor="end">{one.format(tempRange[1]!)}</text>
        <text class="tick" x={LEFT - 6} y={tempTop + SMALL_H} text-anchor="end">{one.format(tempRange[0]!)}</text>
        <path class="temp-line" d={tempLine} />
      {/if}

      {#if hasHr}
        <text class="title" x={LEFT} y={hrTop - 8}>{t.chartHeart}</text>
        <line class="grid" x1={LEFT} x2={LEFT + plotW} y1={hrTop + SMALL_H} y2={hrTop + SMALL_H} />
        <text class="tick" x={LEFT - 6} y={hrTop + 8} text-anchor="end">{Math.round(hrRange[1]!)}</text>
        <text class="tick" x={LEFT - 6} y={hrTop + SMALL_H} text-anchor="end">{Math.round(hrRange[0]!)}</text>
        <path class="hr-line" d={hrLine} />
      {/if}

      <!-- shared time axis -->
      {#each timeTicks as m}
        <text class="tick" x={x(m * 60)} y={axisY + 14} text-anchor="middle">{m}</text>
      {/each}
      <text class="tick" x={LEFT + plotW} y={axisY + 30} text-anchor="end">{t.chartTime}</text>

      {#if hp}
        <line class="crosshair" x1={x(hp.t)} x2={x(hp.t)} y1={depthTop} y2={axisY} />
        <circle class="dot" cx={x(hp.t)} cy={yDepth(hp.depth)} r="5" />
      {/if}

      <rect
        class="hit"
        x={LEFT}
        y="0"
        width={plotW}
        height={axisY}
        role="presentation"
        onpointermove={(e) => (e.pointerType === 'mouse' || touching) && onPointer(e)}
        onpointerdown={(e) => {
          touching = e.pointerType !== 'mouse';
          onPointer(e);
        }}
        onpointerup={(e) => e.pointerType !== 'mouse' && endTouch()}
        onpointercancel={endTouch}
        onpointerleave={(e) => e.pointerType === 'mouse' && (hover = null)}
      />
    </svg>

    {#if hp}
      <div class="tip" style:left={`${tipLeft}px`}>
        <strong>{mmss(hp.t)} min</strong>
        <span><i class="key depth"></i>{one.format(hp.depth)} m</span>
        {#if hp.temp !== null}<span><i class="key temp"></i>{one.format(hp.temp)} °C</span>{/if}
        {#if hp.hr !== null}<span><i class="key hr"></i>{hp.hr} bpm</span>{/if}
        {#if hp.ndl !== null}<span>{t.ndl} {Math.round(hp.ndl / 60)} min</span>{/if}
        {#each hoverEvents as e}<span class="ev">{e.flags >= 8 ? '⚠' : 'ℹ'} {e.name}</span>{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .chart {
    position: relative;
    width: 100%;
    user-select: none;
    /* SVG children ignore touch-action; set it here so a sideways drag scrubs instead of being
       taken over by the browser (vertical drags still scroll the page) */
    touch-action: pan-y;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .title {
    font-size: 12px;
    fill: var(--muted);
    font-weight: 600;
  }
  .tick {
    font-size: 11px;
    fill: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .depth-area {
    fill: var(--series-depth);
    opacity: 0.18;
  }
  .depth-line {
    fill: none;
    stroke: var(--series-depth);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .temp-line {
    fill: none;
    stroke: var(--series-temp);
    stroke-width: 2;
  }
  .hr-line {
    fill: none;
    stroke: var(--series-hr);
    stroke-width: 1.5;
  }
  .event.warn {
    fill: var(--status-warning);
    stroke: var(--card);
    stroke-width: 2;
  }
  .event.info {
    fill: var(--muted);
    stroke: var(--card);
    stroke-width: 2;
  }
  .crosshair {
    stroke: var(--text);
    stroke-width: 1;
    opacity: 0.5;
  }
  .dot {
    fill: var(--series-depth);
    stroke: var(--card);
    stroke-width: 2;
  }
  .hit {
    fill: transparent;
    touch-action: pan-y;
    cursor: crosshair;
  }
  .tip {
    position: absolute;
    top: 24px;
    min-width: 150px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
    box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
    font-variant-numeric: tabular-nums;
  }
  .key {
    display: inline-block;
    width: 12px;
    height: 2px;
    margin-right: 6px;
    vertical-align: middle;
  }
  .key.depth {
    background: var(--series-depth);
  }
  .key.temp {
    background: var(--series-temp);
  }
  .key.hr {
    background: var(--series-hr);
  }
  .ev {
    color: var(--muted);
  }
</style>
