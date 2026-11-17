<script lang="ts">
  import '@fontsource/anton/latin-400.css';
  import '@fontsource/archivo-black/latin-400.css';
  import '@fontsource/bangers/latin-400.css';
  import '@fontsource/bebas-neue/latin-400.css';
  import '@fontsource/comic-neue/latin-700-italic.css';
  import '@fontsource/comic-neue/latin-700.css';
  import '@fontsource/kanit/latin-800-italic.css';
  import '@fontsource/kanit/latin-800.css';
  import '@fontsource/pacifico/latin-400.css';
  import '@fontsource/righteous/latin-400.css';
  import { sacRate, toTm, type Dive, type Logbook } from '@topside/core';
  import { APP_NAME } from '../lib/brand.ts';
  import { downsample, profile, summary } from '../lib/dive-data.ts';
  import { formatDate } from '../lib/format.ts';
  import { locale, t } from '../lib/i18n.ts';
  import { workspace } from '../lib/workspace.svelte.ts';
  import {
    canvasSize,
    FONTS,
    loadFont,
    renderShare,
    statBlock,
    templateLayout,
    type BlockId,
    type FontId,
    type GraphOptions,
    type Layout,
    type Rect,
    type ShareBackground,
    type ShareFormat,
    type TemplateId,
    type TextColor,
    type ThemeId,
  } from '../lib/share-render.ts';

  let { logbook, dive }: { logbook: Logbook; dive: Dive } = $props();

  // ---- Settings, remembered on this device --------------------------------------------------
  interface Settings {
    /** 2: every block placed on its own */
    version: 2;
    format: ShareFormat;
    background: ShareBackground;
    font: FontId;
    italic: boolean;
    fontScale: number;
    theme: ThemeId;
    textColor: TextColor;
    stats: string[];
    showSite: boolean;
    showDate: boolean;
    /** start time of the dive in the date line */
    showTime: boolean;
    graph: GraphOptions;
    layout: Layout;
    /** Name of the layout template, or 'custom' once a block was moved. */
    template: TemplateId | 'custom';
  }
  const STORE_KEY = 'topside.share';
  const defaultStats = ['duration', 'maxDepth', 'water'];
  const defaults: Settings = {
    version: 2,
    format: 'portrait',
    background: 'transparent',
    font: 'bebas',
    italic: false,
    fontScale: 1,
    theme: 'ocean',
    textColor: 'white',
    stats: defaultStats,
    showSite: true,
    showDate: true,
    showTime: false,
    graph: { show: true, grid: true, maxMarker: true, temp: false, hr: false },
    layout: templateLayout('classic', defaultStats, canvasSize('portrait', null)),
    template: 'classic',
  };
  function loadSettings(): Settings {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as (Partial<Settings> & { columns?: number }) | null;
      if (!saved) return structuredClone(defaults);
      const merged: Settings & { columns?: number } = { ...structuredClone(defaults), ...saved, graph: { ...defaults.graph, ...saved.graph } };
      // A photo is not stored; fall back until one is chosen again.
      if (merged.background === 'photo') merged.background = 'ocean';
      if (merged.format === 'photo') merged.format = 'portrait';
      if (!(merged.font in FONTS)) merged.font = defaults.font;
      // "Start" was a number of its own; the time now goes into the date line
      if (merged.stats.includes('start')) {
        merged.stats = merged.stats.filter((id) => id !== 'start');
        merged.showTime = true;
      }
      // Settings of the first version had one block for all numbers: lay them out anew.
      if (saved.version !== 2) {
        if (merged.template === 'custom') merged.template = 'classic';
        merged.layout = templateLayout(merged.template, merged.stats, canvasSize(merged.format, null), merged.fontScale);
        merged.version = 2;
      }
      delete merged.columns;
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
  /** Choices that move every block, so they re-apply the template unless blocks were moved by hand. */
  function relayout() {
    if (s.template !== 'custom') s.layout = templateLayout(s.template, s.stats, canvasSize(s.format, photo), s.fontScale);
  }
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
    const out: { id: string; label: string; value: string }[] = [
      { id: 'duration', label: t.statDuration, value: `${Math.round(info.duration / 60)} min` },
      { id: 'maxDepth', label: t.statMaxDepth, value: `${one.format(info.maxDepth)} m` },
    ];
    if (info.meanDepth !== null) out.push({ id: 'meanDepth', label: t.statMeanDepth, value: `${one.format(info.meanDepth)} m` });
    if (info.waterTemp !== null) out.push({ id: 'water', label: t.statWater, value: `${Math.round(info.waterTemp)} °C` });
    const temps = allPoints.filter((p) => p.temp !== null).map((p) => p.temp!);
    if (temps.length > 1) {
      out.push({ id: 'tempMin', label: t.statTempMin, value: `${one.format(Math.min(...temps))} °C` });
      out.push({ id: 'tempAvg', label: t.statTempAvg, value: `${one.format(temps.reduce((a, b) => a + b, 0) / temps.length)} °C` });
    }
    if (hrs.length) {
      out.push({ id: 'avgHr', label: t.statAvgHr, value: `${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)} bpm` });
      out.push({ id: 'maxHr', label: t.statMaxHr, value: `${Math.max(...hrs)} bpm` });
    }
    if (cyl?.start && cyl.end) {
      out.push({ id: 'pressure', label: t.statPressure, value: `${Math.round(cyl.start / 1000)}–${Math.round(cyl.end / 1000)} bar` });
      // Surface air consumption, computed as Subsurface does
      const sac = sacRate(dive);
      if (sac) out.push({ id: 'sac', label: t.statSac, value: `${one.format(sac / 1000)} l/min` });
    }
    if (cyl) out.push({ id: 'gas', label: t.statGas, value: !cyl.o2 ? t.gasAir : `EAN${Math.round(cyl.o2 / 10)}` });
    return out;
  });
  const hasTemp = $derived(allPoints.filter((p) => p.temp !== null).length > 1);
  const hasHr = $derived(allPoints.filter((p) => p.hr !== null).length > 1);

  function toggleStat(id: string) {
    const adding = !s.stats.includes(id);
    s.stats = adding ? [...s.stats, id] : s.stats.filter((x) => x !== id);
    if (s.template !== 'custom') relayout();
    else if (adding && !s.layout[statBlock(id)]) {
      // a number added after moving blocks by hand goes where the classic layout would put it
      s.layout[statBlock(id)] = templateLayout('classic', s.stats, canvasSize(s.format, photo), s.fontScale)[statBlock(id)]!;
    }
  }

  // ---- Drawing ------------------------------------------------------------------------------
  $effect(() => {
    if (!canvas) return;
    const target = canvas;
    const style = $state.snapshot(s);
    const content = {
      points,
      title: style.showSite ? info.site || info.trip : '',
      subtitle: [
        style.showDate ? formatDate(dive.when).replace(/ \d\d:\d\d$/, '') : '',
        style.showTime ? startTime : '',
        style.showSite && info.site ? info.trip : '',
      ]
        .filter(Boolean)
        .join(' · '),
      stats: available.filter((a) => style.stats.includes(a.id)),
      footer: APP_NAME,
      depth: (m: number) => `${one.format(m)} m`,
    };
    const background: ShareBackground = style.background === 'photo' && !photo ? 'transparent' : style.background;
    const currentPhoto = photo;
    let cancelled = false;
    loadFont(style.font, style.italic)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) rects = renderShare(target, content, { ...style, background, photo: currentPhoto });
      });
    return () => {
      cancelled = true;
    };
  });

  // ---- Moving blocks ------------------------------------------------------------------------
  const [W, H] = $derived(canvasSize(s.format, photo));
  let dragStart = { px: 0, py: 0, x: 0, y: 0 };

  /** The block's place in the layout; created from where it was drawn if the layout lacks it. */
  function boxOf(block: BlockId) {
    const r = rects?.[block];
    s.layout[block] ??= { x: r ? r.x / W : 0.067, y: r ? r.y / H : 0.05, w: r ? r.w / W : 0, h: r ? r.h / H : 0 };
    return s.layout[block]!;
  }
  function startDrag(e: PointerEvent, block: BlockId) {
    dragging = block;
    s.template = 'custom';
    const box = boxOf(block);
    dragStart = { px: e.clientX, py: e.clientY, x: box.x, y: box.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent, block: BlockId) {
    if (dragging !== block || !canvas) return;
    const box = canvas.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    const target = boxOf(block);
    target.x = clamp(dragStart.x + (e.clientX - dragStart.px) / box.width, 0.95);
    target.y = clamp(dragStart.y + (e.clientY - dragStart.py) / box.height, 0.97);
  }
  function moveByKey(e: KeyboardEvent, block: BlockId) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    s.template = 'custom';
    const target = boxOf(block);
    target.x = Math.min(Math.max(target.x + d[0], 0), 0.95);
    target.y = Math.min(Math.max(target.y + d[1], 0), 0.97);
  }
  const blockLabel = (id: BlockId) =>
    id === 'title' ? t.showSite : id === 'subtitle' ? t.showDate : id === 'graph' ? t.shareGraph : (available.find((a) => statBlock(a.id) === id)?.label ?? id);
  const blocks = $derived(rects ? Object.keys(rects).map((id) => ({ id, label: blockLabel(id) })) : []);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const startTime = $derived(`${String(toTm(dive.when).hour).padStart(2, '0')}:${String(toTm(dive.when).minute).padStart(2, '0')}`);

  /** Formats as shapes to pick from; "Original" only with a photo as background. */
  const formats = $derived(
    [
      { id: 'story', ratio: 9 / 16, short: '9:16', label: '9:16' },
      { id: 'portrait', ratio: 4 / 5, short: '4:5', label: '4:5' },
      { id: 'square', ratio: 1, short: '1:1', label: '1:1' },
      { id: 'landscape', ratio: 4 / 3, short: '4:3', label: t.formatLandscape },
      { id: 'wide', ratio: 16 / 9, short: '16:9', label: t.formatWide },
      ...(photo && s.background === 'photo'
        ? [{ id: 'photo', ratio: photo.width / photo.height, short: t.formatPhoto, label: t.formatPhoto }]
        : []),
    ] as { id: ShareFormat; ratio: number; short: string; label: string }[],
  );
  function setFormat(format: ShareFormat) {
    s.format = format;
    relayout();
  }

  function applyTemplate(name: string) {
    if (name !== 'classic' && name !== 'minimal' && name !== 'profile') return;
    s.template = name;
    relayout();
  }

  // ---- Photo, save, share -------------------------------------------------------------------
  async function choosePhoto(files: FileList | Blob[] | null) {
    const file = files?.[0];
    if (!file) return;
    photo = await createImageBitmap(file, { imageOrientation: 'from-image' });
    s.background = 'photo';
    relayout();
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
        {@const r = rects[b.id]!}
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
    <button class="chip" aria-pressed={s.showTime} onclick={() => (s.showTime = !s.showTime)}>{t.showTime}</button>
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
      <input type="range" min="0.1" max="0.6" step="0.01" value={s.layout.graph?.h ?? 0.24} oninput={(e) => (boxOf('graph').h = Number(e.currentTarget.value))} />
    </label>
  {/if}
</section>

<section class="card">
  <div class="formats" role="group" aria-label={t.format}>
    <h3>{t.format}</h3>
    <div class="format-row">
      {#each formats as f (f.id)}
        <button class="format" aria-pressed={s.format === f.id} aria-label={f.label} title={f.label} onclick={() => setFormat(f.id)}>
          <span class="shape" style:width={`${f.ratio >= 1 ? 40 : 40 * f.ratio}px`} style:height={`${f.ratio >= 1 ? 40 / f.ratio : 40}px`}></span>
          <small>{f.short}</small>
        </button>
      {/each}
    </div>
  </div>
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
        <option value="coral">{t.themeCoral}</option>
        <option value="sunset">{t.themeSunset}</option>
        <option value="lava">{t.themeLava}</option>
      </select>
    </label>
    <label>
      {t.textColor}
      <select bind:value={s.textColor}>
        <option value="white">{t.textWhite}</option>
        <option value="dark">{t.textDark}</option>
        <option value="accent">{t.textAccent}</option>
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
      {t.fontSize}
      <input
        type="range"
        min="0.6"
        max="1.6"
        step="0.05"
        value={s.fontScale}
        oninput={(e) => {
          s.fontScale = Number(e.currentTarget.value);
          relayout();
        }}
      />
    </label>
  </div>
  <div class="chips">
    <button class="chip" aria-pressed={s.italic} onclick={() => (s.italic = !s.italic)}><i>{t.italic}</i></button>
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
  .format-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .format {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 64px;
    min-height: 72px;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font-weight: 500;
  }
  .format .shape {
    display: block;
    border: 2px solid currentColor;
    border-radius: 3px;
  }
  .format[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .formats {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
