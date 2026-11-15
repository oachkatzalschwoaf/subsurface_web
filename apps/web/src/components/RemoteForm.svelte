<script lang="ts">
  /** Form for a remote logbook: Subsurface cloud or own git repository. */
  import { t } from '../lib/i18n.ts';
  import { DEFAULT_SERVER, type RemoteSource } from '../lib/sources.ts';

  let {
    kind,
    submitLabel,
    busy = false,
    onSubmit,
  }: {
    kind: 'cloud' | 'git';
    submitLabel: string;
    busy?: boolean;
    onSubmit: (source: RemoteSource, secret: string) => void;
  } = $props();

  let email = $state('');
  let server = $state(DEFAULT_SERVER);
  let url = $state('');
  let branch = $state('main');
  let username = $state('');
  let secret = $state('');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const source: RemoteSource =
      kind === 'cloud'
        ? { kind: 'cloud', server: server.trim(), email: email.trim() }
        : { kind: 'git', url: url.trim(), branch: branch.trim() || 'main', username: username.trim() };
    onSubmit(source, secret);
  }
</script>

<form class="card" onsubmit={submit}>
  {#if kind === 'cloud'}
    <label>{t.email}<input type="email" name="username" autocomplete="username" required bind:value={email} /></label>
    <label>{t.password}<input type="password" name="password" autocomplete="current-password" required bind:value={secret} /></label>
    <details>
      <summary>{t.advanced}</summary>
      <label>{t.server}<input type="url" required bind:value={server} /></label>
    </details>
  {:else}
    <label>{t.gitUrl}<input type="url" required placeholder="https://github.com/name/divelog.git" bind:value={url} /></label>
    <div class="grid">
      <label>{t.gitBranch}<input required bind:value={branch} /></label>
      <label>{t.gitUser}<input name="username" autocomplete="username" required bind:value={username} /></label>
    </div>
    <label>{t.gitToken}<input type="password" name="password" autocomplete="current-password" required bind:value={secret} /></label>
    <p class="hint">{t.gitHint}</p>
  {/if}
  <button class="primary" disabled={busy}>{submitLabel}</button>
</form>
