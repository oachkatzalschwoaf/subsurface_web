<script lang="ts">
  /** UI language: follow the system or pick one; stored on this device. */
  import { LANGUAGE_NAMES, languageChoice, setLanguage, systemLang, t, type LangChoice } from '../lib/i18n.ts';

  let { disabled = false }: { disabled?: boolean } = $props();

  const choice = languageChoice();
</script>

<label>
  {t.language}
  <select {disabled} value={choice} onchange={(e) => setLanguage(e.currentTarget.value as LangChoice)}>
    <option value="auto">{t.languageAuto(LANGUAGE_NAMES[systemLang()])}</option>
    {#each Object.entries(LANGUAGE_NAMES) as [code, name] (code)}
      <option value={code} lang={code}>{name}</option>
    {/each}
  </select>
</label>
<p class="hint">{t.languageHint}</p>

<style>
  p {
    margin: 0;
  }
</style>
