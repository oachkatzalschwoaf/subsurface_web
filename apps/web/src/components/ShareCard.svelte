<script lang="ts">
  import '@fontsource/anton/latin-400.css';
  import '@fontsource/archivo-black/latin-400.css';
  import '@fontsource/bebas-neue/latin-400.css';
  import '@fontsource/righteous/latin-400.css';
  import { toTm, type Dive, type Logbook } from '@topside/core';
  import { APP_NAME } from '../lib/brand.ts';
  import { downsample, profile, summary } from '../lib/dive-data.ts';
  import { formatDate } from '../lib/format.ts';
  import { locale, t } from '../lib/i18n.ts';
  import { workspace } from '../lib/workspace.svelte.ts';
  import {
    FONTS,
    loadFont,
    renderShare,
    SIZES,
    TEMPLATES,
    type BlockId,
    type FontId,
    type GraphOptions,
    type Layout,
    type Rect,
    type ShareBackground,
    type ShareFormat,
    type ThemeId,
  } from '../lib/share-render.ts';

  let { logbook, dive }: { logbook: Logbook; dive: Dive } = $props();

  // ---- Settings, remembered on this device --------------------------------------------------
  interface Settings {
    format: ShareFormat;
    background: ShareBackground;
    font: FontId;
    theme: ThemeId;
    columns: number;
    stats: string[];
    showSite: boolean;
    showDate: boolean;
    graph: GraphOptions;
    layout: Layout;
    /** Name of the layout template, or 'custom' once a block was moved. */
    template: keyof typeof TEMPLATES | 'custom';
  }
  const STORE_KEY = 'topside.share';
  const defaults: Settings = {
    format: 'portrait',
    background: 'transparent',
    font: 'bebas',
    theme: 'ocean',
    columns: 3,
    stats: ['duration', 'maxDepth', 'water'],
    showSite: true,
    showDate: true,
    graph: { show: true, grid: true, maxMarker: true, temp: false, hr: false },
    layout: structuredClone(TEMPLATES.classic),
    template: 'classic',
  };
  function loadSettings(): Settings {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null;
      if (!saved) return structuredClone(defaults);
      const merged = { ...structuredClone(defaults), ...saved, graph: { ...defaults.graph, ...saved.graph } };
      // A photo is not stored; fall back until one is chosen again.
      if (merged.background === 'photo') merged.background = 'ocean';
      return merged;
    } catch {
      return structuredClone(defaults);
    }
  }
  let s = $state<Settings>(loadSettings());
  $effect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify($state.snapshot(s)));
    } catch {
      // private mode: not remembered
    }
  });

  let photo = $state.raw<ImageBitmap | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let rects = $state.raw<Record<BlockId, Rect> | null>(null);
  let dragging = $state<BlockId | null>(null);

  // ---- Content ------------------------------------------------------------------------------
  const info = $derived(summary(logbook, dive));
  const allPoints = $derived(profile(dive));
  const points = $derived(downsample(allPoints, 400));
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const canShareFiles = typeof navigator.canShare === 'function';

  /** Everything that can be shown as a number; only entries with data are offered. */
  const available = $derived.by(() => {
    const hrs = allPoints.filter((p) => p.hr !== null).map((p) => p.hr!);
    const cyl = dive.cylinders[0];
    const tm = toTm(dive.when);
    const out: { id: string; label: string; value: string }[] = [
      { id: 'duration', label: t.statDuration, value: `${Math.round(info.duration / 60)} min` },
      { id: 'maxDepth', label: t.statMaxDepth, value: `${one.format(info.maxDepth)} m` },
    ];
    if (info.meanDepth !== null) out.push({ id: 'meanDepth', label: t.statMeanDepth, value: `${one.format(info.meanDepth)} m` });
    if (info.waterTemp !== null) out.push({ id: 'water', label: t.statWater, value: `${Math.round(info.waterTemp)} °C` });
    if (hrs.length) {
      out.push({ id: 'avgHr', label: t.statAvgHr, value: `${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)} bpm` });
      out.push({ id: 'maxHr', label: t.statMaxHr, value: `${Math.max(...hrs)} bpm` });
    }
    out.push({ id: 'start', label: t.statStart, value: `${String(tm.hour).padStart(2, '0')}:${String(tm.minute).padStart(2, '0')}` });
    if (cyl?.start && cyl.end) {
      out.push({ id: 'pressure', label: t.statPressure, value: `${Math.round(cyl.start / 1000)}–${Math.round(cyl.end / 1000)} bar` });
      // Surface air consumption: litres used per minute, corrected to surface pressure
      if (cyl.volume && info.meanDepth && info.duration) {
        const litres = ((cyl.start - cyl.end) / 1000) * (cyl.volume / 1000);
        const sac = litres / (info.duration / 60) / (info.meanDepth / 10 + 1);
        out.push({ id: 'sac', label: t.statSac, value: `${one.format(sac)} l/min` });
      }
    }
    if (cyl) out.push({ id: 'gas', label: t.statGas, value: !cyl.o2 ? t.gasAir : `EAN${Math.round(cyl.o2 / 10)}` });
    return out;
  });
  const hasTemp = $derived(allPoints.filter((p) => p.temp !== null).length > 1);
  const hasHr = $derived(allPoints.filter((p) => p.hr !== null).length > 1);

  function toggleStat(id: string) {
    s.stats = s.stats.includes(id) ? s.stats.filter((x) => x !== id) : [...s.stats, id];
  }

  // ---- Drawing ------------------------------------------------------------------------------
  $effect(() => {
    if (!canvas) return;
    const target = canvas;
    const style = $state.snapshot(s);
    const content = {
      points,
      title: style.showSite ? info.site || info.trip : '',
      subtitle: [style.showDate ? formatDate(dive.when).replace(/ \d\d:\d\d$/, '') : '', style.showSite && info.site ? info.trip : '']
        .filter(Boolean)
        .join(' · '),
      stats: available.filter((a) => style.stats.includes(a.id)),
      footer: APP_NAME,
      depth: (m: number) => `${one.format(m)} m`,
    };
    const background: ShareBackground = style.background === 'photo' && !photo ? 'transparent' : style.background;
    const currentPhoto = photo;
    let cancelled = false;
    loadFont(style.font)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) rects = renderShare(target, content, { ...style, background, photo: currentPhoto });
      });
    return () => {
      cancelled = true;
    };
  });

  // ---- Moving blocks ------------------------------------------------------------------------
  const [W, H] = $derived(SIZES[s.format]);
  let dragStart = { px: 0, py: 0, x: 0, y: 0 };

  function startDrag(e: PointerEvent, block: BlockId) {
    dragging = block;
    s.template = 'custom';
    dragStart = { px: e.clientX, py: e.clientY, x: s.layout[block].x, y: s.layout[block].y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent, block: BlockId) {
    if (dragging !== block || !canvas) return;
    const box = canvas.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    s.layout[block].x = clamp(dragStart.x + (e.clientX - dragStart.px) / box.width, 0.9);
    s.layout[block].y = clamp(dragStart.y + (e.clientY - dragStart.py) / box.height, 0.95);
  }
  function moveByKey(e: KeyboardEvent, block: BlockId) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    s.template = 'custom';
    s.layout[block].x = Math.min(Math.max(s.layout[block].x + d[0], 0), 0.9);
    s.layout[block].y = Math.min(Math.max(s.layout[block].y + d[1], 0), 0.95);
  }
  const blocks: { id: BlockId; label: string }[] = [
    { id: 'title', label: t.showSite },
    { id: 'stats', label: t.shareInfo },
    { id: 'graph', label: t.shareGraph },
  ];
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  function applyTemplate(name: string) {
    if (!(name in TEMPLATES)) return;
    s.template = name as keyof typeof TEMPLATES;
    s.layout = structuredClone(TEMPLATES[s.template]);
  }

  // ---- Photo, save, share -------------------------------------------------------------------
  async function choosePhoto(files: FileList | Blob[] | null) {
    const file = files?.[0];
    if (!file) return;
    photo = await createImageBitmap(file, { imageOrientation: 'from-image' });
    s.background = 'photo';
  }

  // The dive's own pictures on this device, offered as background
  const divePhotos = $derived(dive.pictures.filter((p) => workspace.media.some((m) => m.filename === p.filename)));
  let photoPreviews = $state<{ filename: string; url: string }[]>([]);
  $effect(() => {
    const wanted = divePhotos.map((p) => p.filename);
    const urls: { filename: string; url: string }[] = [];
    let cancelled = false;
    void (async () => {
      for (const filename of wanted) {
        const blob = await workspace.mediaBlob(filename, true);
        if (cancelled) return;
        if (blob) urls.push({ filename, url: URL.createObjectURL(blob) });
      }
      photoPreviews = [...urls];
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u.url);
    };
  });
  async function useDivePhoto(filename: string) {
    const blob = await workspace.mediaBlob(filename);
    if (blob) await choosePhoto([blob]);
  }

  function fileName(): string {
    const d = new Date(dive.when * 1000).toISOString().slice(0, 10);
    return `dive-${dive.number || d}.png`;
  }
  function toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => canvas!.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
  }
  async function save() {
    const url = URL.createObjectURL(await toBlob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function share() {
    const file = new File([await toBlob()], fileName(), { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: info.site || APP_NAME });
      } catch {
        // cancelled
      }
    } else {
      await save();
    }
  }
</script>

<div class="editor">
<section class="card image">
  <div class="preview" class:checker={s.background === 'transparent'} style:aspect-ratio={`${W} / ${H}`} style:--ratio={W / H}>
    <canvas bind:this={canvas}></canvas>
    {#if rects}
      {#each blocks as b (b.id)}
        {@const r = rects[b.id]}
        {#if r.w > 0}
          <div
            class="handle"
            class:active={dragging === b.id}
            role="button"
            tabindex="0"
            aria-label={`${b.label} ↔`}
            style:left={pct(r.x, W)}
            style:top={pct(r.y, H)}
            style:width={pct(r.w, W)}
            style:height={pct(r.h, H)}
            onpointerdown={(e) => startDrag(e, b.id)}
            onpointermove={(e) => moveDrag(e, b.id)}
            onpointerup={() => (dragging = null)}
            onpointercancel={() => (dragging = null)}
            onkeydown={(e) => moveByKey(e, b.id)}
          ></div>
        {/if}
      {/each}
    {/if}
  </div>
  <p class="hint">{t.dragHint}</p>

  <div class="actions">
    {#if canShareFiles}<button class="primary" onclick={share}>{t.shareImage}</button>{/if}
    <button class={canShareFiles ? 'secondary' : 'primary'} onclick={save}>{t.saveImage}</button>
  </div>
</section>

<div class="controls">
<section class="card">
  <h3>{t.shareInfo}</h3>
  <div class="chips">
    <button class="chip" aria-pressed={s.showSite} onclick={() => (s.showSite = !s.showSite)}>{t.showSite}</button>
    <button class="chip" aria-pressed={s.showDate} onclick={() => (s.showDate = !s.showDate)}>{t.showDate}</button>
    {#each available as a (a.id)}
      <button class="chip" aria-pressed={s.stats.includes(a.id)} onclick={() => toggleStat(a.id)}>{a.label}</button>
    {/each}
  </div>

  <h3>{t.shareGraph}</h3>
  <div class="chips">
    <button class="chip" aria-pressed={s.graph.show} onclick={() => (s.graph.show = !s.graph.show)}>{t.optGraph}</button>
    {#if s.graph.show}
      <button class="chip" aria-pressed={s.graph.grid} onclick={() => (s.graph.grid = !s.graph.grid)}>{t.optGrid}</button>
      <button class="chip" aria-pressed={s.graph.maxMarker} onclick={() => (s.graph.maxMarker = !s.graph.maxMarker)}>{t.optMaxMarker}</button>
      {#if hasTemp}<button class="chip" aria-pressed={s.graph.temp} onclick={() => (s.graph.temp = !s.graph.temp)}>{t.optTemp}</button>{/if}
      {#if hasHr}<button class="chip" aria-pressed={s.graph.hr} onclick={() => (s.graph.hr = !s.graph.hr)}>{t.optHr}</button>{/if}
    {/if}
  </div>
  {#if s.graph.show}
    <label>
      {t.graphSize}
      <input type="range" min="0.1" max="0.6" step="0.01" bind:value={s.layout.graph.h} />
    </label>
  {/if}
</section>

<section class="card">
  <div class="options">
    <label>
      {t.template}
      <select value={s.template} onchange={(e) => applyTemplate(e.currentTarget.value)}>
        <option value="classic">{t.tplClassic}</option>
        <option value="profile">{t.tplProfile}</option>
        <option value="minimal">{t.tplMinimal}</option>
        {#if s.template === 'custom'}<option value="custom">{t.tplCustom}</option>{/if}
      </select>
    </label>
    <label>
      {t.format}
      <select bind:value={s.format}>
        <option value="portrait">4:5</option>
        <option value="square">1:1</option>
        <option value="story">9:16</option>
      </select>
    </label>
    <label>
      {t.font}
      <select bind:value={s.font}>
        {#each Object.entries(FONTS) as [id, f]}<option value={id}>{f.label}</option>{/each}
      </select>
    </label>
    <label>
      {t.theme}
      <select bind:value={s.theme}>
        <option value="ocean">{t.themeOcean}</option>
        <option value="ice">{t.themeIce}</option>
        <option value="deep">{t.themeDeep}</option>
      </select>
    </label>
    <label>
      {t.background}
      <select bind:value={s.background}>
        <option value="transparent">{t.bgTransparent}</option>
        <option value="ocean">{t.bgOcean}</option>
        <option value="photo">{t.bgPhoto}</option>
      </select>
    </label>
    <label>
      {t.columns}
      <select bind:value={s.columns}>
        {#each [1, 2, 3] as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
  </div>
  {#if photoPreviews.length > 0}
    <h3>{t.divePhotos}</h3>
    <div class="photos">
      {#each photoPreviews as p (p.filename)}
        <button class="photo" onclick={() => useDivePhoto(p.filename)}><img src={p.url} alt="" /></button>
      {/each}
    </div>
  {/if}
  {#if s.background === 'photo'}
    <label class="file">
      <span class="secondary button">{t.choosePhoto}</span>
      <input type="file" accept="image/*" onchange={(e) => choosePhoto(e.currentTarget.files)} />
    </label>
  {/if}
</section>
</div>
</div>

<style>
  /* Wide screens: the image stays in view on the left, the settings scroll on the right. */
  @media (min-width: 900px) {
    .editor {
      display: grid;
      grid-template-columns: minmax(0, 460px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .image {
      position: sticky;
      top: calc(var(--bar-height) + 16px);
    }
    /* the whole image has to fit the window height, also the tall 9:16 format */
    .image .preview {
      max-width: clamp(200px, calc((100dvh - var(--bar-height) - 190px) * var(--ratio)), 420px);
    }
  }
  .preview {
    position: relative;
    width: 100%;
    max-width: 420px;
    margin: 0 auto;
    border-radius: 12px;
    overflow: hidden;
    background: #0a2233;
  }
  .preview.checker {
    background: repeating-conic-gradient(#3a4a55 0% 25%, #2a3842 0% 50%) 50% / 24px 24px;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  /* Drag areas over the blocks. Only these stop page scrolling; the rest of the image scrolls. */
  .handle {
    position: absolute;
    border: 1px dashed rgb(255 255 255 / 35%);
    border-radius: 6px;
    cursor: grab;
    touch-action: none;
  }
  .handle.active,
  .handle:focus-visible {
    border: 2px dashed #fff;
    cursor: grabbing;
    outline: none;
  }
  h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    min-height: 40px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    font-weight: 500;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
  }
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  input[type='range'] {
    padding: 0;
    min-height: 32px;
    accent-color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  .photos {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .photo {
    width: 72px;
    height: 72px;
    padding: 0;
    min-height: 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--line);
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .actions button {
    flex: 1;
  }
</style>
