import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Chrome fires this early, possibly before the component that offers installing is mounted.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as { topsideInstallPrompt?: Event }).topsideInstallPrompt = e;
});

mount(App, { target: document.getElementById('app')! });

// Offline support: only in the built app, the dev server serves files directly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
