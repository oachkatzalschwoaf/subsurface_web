<script lang="ts">
  /**
   * The pictures of a dive: previews of those kept on this device, the names of the others
   * (added on a PC or another phone), adding and removing, and a full-screen view.
   */
  import type { Dive, Picture } from '@topside/core';
  import { t } from '../lib/i18n.ts';
  import { overlay } from '../lib/overlay.ts';
  import { workspace } from '../lib/workspace.svelte.ts';

  let {
    dive,
    onChange,
  }: {
    dive: Dive;
    /** Saves a change and uploads it when possible; missing = read-only */
    onChange?: ((change: () => Promise<void>) => Promise<boolean>) | undefined;
  } = $props();

  let input = $state<HTMLInputElement>();
  /** Object URLs of the previews, by file name */
  let previews = $state<Record<string, string>>({});
  let open = $state<{ picture: Picture; url: string | null } | null>(null);

  const stored = $derived(new Set(workspace.media.map((m) => m.filename)));

  // Load previews for the pictures on this device; release them when they are no longer shown.
  $effect(() => {
    const wanted = dive.pictures.filter((p) => stored.has(p.filename)).map((p) => p.filename);
    let cancelled = false;
    const urls: Record<string, string> = {};
    void (async () => {
      for (const filename of wanted) {
        const blob = await workspace.mediaBlob(filename, true);
        if (cancelled) return;
        if (blob) urls[filename] = URL.createObjectURL(blob);
      }
      previews = { ...urls };
    })();
    return () => {
      cancelled = true;
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    };
  });

  const label = (p: Picture) => {
    const minutes = Math.round(p.offset / 60);
    return p.offset < 0 ? t.pictureBefore(-minutes) : t.pictureAt(minutes);
  };
  const shortName = (filename: string) => filename.split('/').pop() ?? filename;

  async function show(picture: Picture) {
    const blob = stored.has(picture.filename) ? await workspace.mediaBlob(picture.filename) : null;
    open = { picture, url: blob ? URL.createObjectURL(blob) : null };
  }
  function close() {
    if (open?.url) URL.revokeObjectURL(open.url);
    open = null;
  }

  async function add(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (input) input.value = '';
    if (!list.length || !onChange) return;
    await onChange(async () => {
      await workspace.addPictures(dive, list);
    });
  }

  async function remove(picture: Picture) {
    if (!onChange || !confirm(t.pictureRemoveConfirm)) return;
    const filename = picture.filename;
    close();
    await onChange(() => workspace.removePicture(dive, filename));
  }
</script>

{#if dive.pictures.length > 0 || onChange}
  <section class="card">
    <h3>{t.pictures}</h3>
    {#if dive.pictures.length > 0}
      <ul class="grid-pics">
        {#each dive.pictures as p (p.filename)}
          <li>
            <button class="pic" onclick={() => show(p)} title={shortName(p.filename)}>
              {#if previews[p.filename]}
                <img src={previews[p.filename]} alt={shortName(p.filename)} loading="lazy" />
              {:else}
                <span class="missing">{shortName(p.filename)}<small>{stored.has(p.filename) ? '' : t.pictureMissing}</small></span>
              {/if}
              <small class="when">{label(p)}</small>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if onChange}
      <label class="file">
        <span class="secondary button">{t.addPictures}</span>
        <input bind:this={input} type="file" accept="image/*" multiple onchange={(e) => add(e.currentTarget.files)} />
      </label>
      <p class="hint">{t.picturesHint}</p>
    {/if}
  </section>
{/if}

{#if open}
  <dialog class="viewer" use:overlay={close} aria-label={shortName(open.picture.filename)}>
    {#if open.url}
      <img src={open.url} alt={shortName(open.picture.filename)} />
    {:else}
      <p class="hint">{shortName(open.picture.filename)} – {t.pictureMissing}</p>
    {/if}
    <div class="bar">
      <span>{label(open.picture)}</span>
      {#if onChange}<button class="link" onclick={() => open && remove(open.picture)}>{t.pictureRemove}</button>{/if}
      <!-- the dialog focuses its first button otherwise, which would be "Remove" -->
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" onclick={close} autofocus>{t.close}</button>
    </div>
  </dialog>
{/if}

<style>
  h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .grid-pics {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 8px;
  }
  .pic {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    min-height: 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--line);
    font-weight: 400;
    color: var(--text);
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .missing {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    padding: 6px;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  .missing small {
    color: var(--muted);
  }
  .when {
    position: absolute;
    left: 4px;
    bottom: 4px;
    background: rgb(0 0 0 / 55%);
    color: #fff;
    border-radius: 4px;
    padding: 0 4px;
    font-size: 0.7rem;
  }
  .viewer {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    border: 0;
    color: inherit;
    background: rgb(0 0 0 / 92%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px;
    gap: 12px;
  }
  .viewer img {
    max-width: 100%;
    max-height: calc(100dvh - 100px);
    object-fit: contain;
  }
  .viewer .hint {
    color: #ddd;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    color: #eee;
  }
  .bar .link {
    color: #ff9c94;
  }
</style>
