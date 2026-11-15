<script lang="ts">
  /**
   * How to put the app on the home screen. Uses the browser's install prompt where there is one
   * (Chrome, Edge, Samsung Internet on Android); otherwise shows the steps.
   */
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.ts';

  let { dismissible = false }: { dismissible?: boolean } = $props();

  interface InstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  const KEY = 'topside.installHintDismissed';
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let dismissedNow = $state(readDismissed());
  const dismissed = $derived(dismissible && dismissedNow);
  let promptEvent = $state.raw<InstallPromptEvent | null>((window as { topsideInstallPrompt?: InstallPromptEvent }).topsideInstallPrompt ?? null);

  function readDismissed(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
  function dismiss() {
    dismissedNow = true;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // not remembered
    }
  }

  onMount(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      promptEvent = e as InstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  });

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    if ((await promptEvent.userChoice).outcome === 'accepted') dismiss();
    promptEvent = null;
  }
</script>

{#if !standalone && !dismissed}
  <section class="card install">
    <strong>{t.installTitle}</strong>
    {#if promptEvent}
      <button class="primary" onclick={install}>{t.installButton}</button>
    {:else}
      <p class="hint">{ios ? t.installIos : t.installAndroid}</p>
    {/if}
    <p class="hint">{t.installWhy}</p>
    {#if dismissible}<button class="link" onclick={dismiss}>{t.installLater}</button>{/if}
  </section>
{/if}

<style>
  .install .link {
    align-self: flex-start;
  }
  p {
    margin: 0;
  }
</style>
