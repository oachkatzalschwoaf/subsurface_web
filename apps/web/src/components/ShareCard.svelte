<script lang="ts">
  import type { Dive, Logbook } from '@topside/core';
  import { APP_NAME } from '../lib/brand.ts';
  import { downsample, profile, summary } from '../lib/dive-data.ts';
  import { formatDate } from '../lib/format.ts';
  import { locale, t } from '../lib/i18n.ts';
  import { renderShare, SIZES, type ShareBackground, type ShareFormat } from '../lib/share-render.ts';

  let { logbook, dive }: { logbook: Logbook; dive: Dive } = $props();

  let format = $state<ShareFormat>('portrait');
  let background = $state<ShareBackground>('transparent');
  let photo = $state.raw<ImageBitmap | null>(null);
  let showSite = $state(true);
  let showDate = $state(true);
  let showTemp = $state(true);
  let canvas = $state<HTMLCanvasElement>();

  const info = $derived(summary(logbook, dive));
  const points = $derived(downsample(profile(dive), 400));
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const canShareFiles = typeof navigator.canShare === 'function';

  $effect(() => {
    if (!canvas) return;
    const stats = [
      { label: t.statDuration, value: `${Math.round(info.duration / 60)} min` },
      { label: t.statMaxDepth, value: `${one.format(info.maxDepth)} m` },
    ];
    if (showTemp && info.waterTemp !== null) stats.push({ label: t.statWater, value: `${Math.round(info.waterTemp)} °C` });
    renderShare(
      canvas,
      {
        points,
        title: showSite ? info.site || info.trip : '',
        subtitle: [showDate ? formatDate(dive.when).replace(/ \d\d:\d\d$/, '') : '', showSite && info.site ? info.trip : '']
          .filter(Boolean)
          .join(' · '),
        stats,
        maxDepthLabel: `${one.format(info.maxDepth)} m`,
        footer: APP_NAME,
      },
      { format, background: background === 'photo' && !photo ? 'transparent' : background, photo },
    );
  });

  async function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    photo = await createImageBitmap(file, { imageOrientation: 'from-image' });
    background = 'photo';
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

  const [w, h] = $derived(SIZES[format]);
</script>

<section class="card">
  <div class="preview" class:checker={background === 'transparent'} style:aspect-ratio={`${w} / ${h}`}>
    <canvas bind:this={canvas}></canvas>
  </div>

  <div class="options">
    <label>
      {t.background}
      <select bind:value={background}>
        <option value="transparent">{t.bgTransparent}</option>
        <option value="ocean">{t.bgOcean}</option>
        <option value="photo">{t.bgPhoto}</option>
      </select>
    </label>
    <label>
      {t.format}
      <select bind:value={format}>
        <option value="portrait">4:5</option>
        <option value="square">1:1</option>
        <option value="story">9:16</option>
      </select>
    </label>
  </div>
  {#if background === 'photo'}
    <label class="file">
      <span class="secondary button">{t.choosePhoto}</span>
      <input type="file" accept="image/*" onchange={(e) => choosePhoto(e.currentTarget.files)} />
    </label>
  {/if}
  <div class="checks">
    <label><input type="checkbox" bind:checked={showSite} /> {t.showSite}</label>
    <label><input type="checkbox" bind:checked={showDate} /> {t.showDate}</label>
    <label><input type="checkbox" bind:checked={showTemp} /> {t.showTemp}</label>
  </div>
  <div class="actions">
    {#if canShareFiles}<button class="primary" onclick={share}>{t.shareImage}</button>{/if}
    <button class={canShareFiles ? 'secondary' : 'primary'} onclick={save}>{t.saveImage}</button>
  </div>
</section>

<style>
  .preview {
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
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .checks label {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 1rem;
    color: var(--text);
  }
  .checks input {
    width: 22px;
    min-height: 22px;
    height: 22px;
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  .actions button {
    flex: 1;
  }
</style>
