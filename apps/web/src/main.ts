import './polyfill.ts';
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Offline support: only in the built app, the dev server serves files directly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
