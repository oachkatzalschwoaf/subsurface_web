<script lang="ts">
  /** First start: choose where the logbook lives. */
  import { parseXml, type Logbook } from '@topside/core';
  import { readBackupZip } from '../lib/files.ts';
  import { t } from '../lib/i18n.ts';
  import type { RemoteSource } from '../lib/sources.ts';
  import { emptyLogbook, EmptyRemoteError, workspace } from '../lib/workspace.svelte.ts';
  import { parseLogbook } from '@topside/core';
  import LanguagePicker from './LanguagePicker.svelte';
  import RemoteForm from './RemoteForm.svelte';

  let { onError }: { onError: (e: unknown) => void } = $props();

  let kind = $state<'cloud' | 'git' | 'local' | null>(null);
  let busy = $state(false);
  /** Set when the chosen git repository is empty and needs a first logbook. */
  let emptyRemote = $state.raw<{ source: RemoteSource; secret: string } | null>(null);

  async function run(fn: () => Promise<void>) {
    busy = true;
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      busy = false;
    }
  }

  function connect(source: RemoteSource, secret: string) {
    run(async () => {
      try {
        await workspace.connect(source, secret);
      } catch (e) {
        if (e instanceof EmptyRemoteError && source.kind === 'git') emptyRemote = { source, secret };
        else if (e instanceof EmptyRemoteError) throw new Error(t.errorNotFound);
        else throw e;
      }
    });
  }

  /** Read an .ssrf or backup .zip into a logbook. */
  async function readFile(file: File): Promise<Logbook> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseLogbook(readBackupZip(bytes)).logbook;
    const result = parseXml(new TextDecoder().decode(bytes));
    return result.logbook;
  }

  function startFromFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    // emptied, so the same file can be chosen again after an error
    e.currentTarget.value = '';
    if (file) start(readFile(file));
  }

  function start(logbook: Promise<Logbook> | Logbook) {
    run(async () => {
      const book = await logbook;
      if (emptyRemote) await workspace.createRemote(emptyRemote.source, emptyRemote.secret, book);
      else await workspace.startLocal(book);
    });
  }
</script>

<p class="lead">{t.tagline}</p>

{#if emptyRemote}
  <section class="card">
    <strong>{t.emptyRepo}</strong>
    <p class="hint">{t.emptyRepoHint}</p>
    <button class="primary" disabled={busy} onclick={() => start(emptyLogbook())}>{t.startEmpty}</button>
    <label class="file">
      <span class="secondary button">{t.startFromFile}</span>
      <input type="file" accept=".ssrf,.xml,.zip" onchange={startFromFile} />
    </label>
    <button class="link" onclick={() => (emptyRemote = null)}>{t.back}</button>
  </section>
{:else if kind === null}
  <section class="choices">
    <button class="card choice" onclick={() => (kind = 'cloud')}>
      <strong>{t.srcCloud}</strong><span>{t.srcCloudHint}</span>
    </button>
    <button class="card choice" onclick={() => (kind = 'git')}>
      <strong>{t.srcGit}</strong><span>{t.srcGitHint}</span>
    </button>
    <button class="card choice" onclick={() => (kind = 'local')}>
      <strong>{t.srcLocal}</strong><span>{t.srcLocalHint}</span>
    </button>
  </section>
  <section class="card language">
    <LanguagePicker disabled={busy} />
    <p class="about"><a href="https://subsurface-divelog.org/" target="_blank" rel="noopener">{t.aboutSubsurface} ↗</a></p>
  </section>
{:else}
  <button class="link back" onclick={() => (kind = null)}>← {t.back}</button>
  {#if kind === 'local'}
    <section class="card">
      <button class="primary" disabled={busy} onclick={() => start(emptyLogbook())}>{t.startEmpty}</button>
      <label class="file">
        <span class="secondary button">{t.startFromFile}</span>
        <input type="file" accept=".ssrf,.xml,.zip" onchange={startFromFile} />
      </label>
      <p class="hint">{t.srcLocalNote}</p>
    </section>
  {:else}
    <RemoteForm {kind} {busy} submitLabel={busy ? t.signingIn : t.signIn} onSubmit={connect} />
  {/if}
{/if}

<style>
  .choices {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .choice {
    text-align: left;
    color: var(--text);
    font-weight: 400;
    gap: 4px;
    cursor: pointer;
  }
  .choice strong {
    font-size: 1.05rem;
  }
  .language {
    margin-top: 12px;
  }
  .choice span {
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
