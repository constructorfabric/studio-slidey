<script setup>
// Interactive web-app root: loads a spec, wires the deck, renders DeckHost +
// NavController. Spec source priority: window.__SLIDEY_SPEC__ (embedded by the
// single-file build) → ?spec=<url> query param → ./spec.json → a drop/file-
// picker overlay.
import { ref, shallowRef, onMounted } from 'vue';
import DeckHost from './DeckHost.vue';
import NavController from './NavController.vue';
import { store } from '../store.js';
import { createDeck } from '../useDeck.js';

const deck = shallowRef(null);
const error = ref('');
const loading = ref(true);

async function loadSpec(spec, baseUrl) {
  if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) {
    throw new Error('spec must have a non-empty "scenes" array');
  }
  store.setMeta(spec.meta || {});
  store.setMode((spec.meta && spec.meta.mode) || 'api');
  const d = createDeck(spec, baseUrl);
  await d.render();
  deck.value = d;
  error.value = '';
}

async function fetchSpec(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const spec = JSON.parse(await file.text());
    await loadSpec(spec, ''); // no base URL → relative gif assets won't resolve
  } catch (err) { error.value = String(err.message || err); }
}

function fitScale() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty('--slidey-scale', String(scale));
}

onMounted(async () => {
  fitScale();
  window.addEventListener('resize', fitScale);
  try {
    // Embedded spec (single-file static build): self-contained, no fetch.
    // window.location.href as base lets any data-URI gifs resolve trivially.
    if (window.__SLIDEY_SPEC__) {
      await loadSpec(window.__SLIDEY_SPEC__, window.location.href);
      return;
    }
    const param = new URLSearchParams(window.location.search).get('spec');
    if (param) {
      await loadSpec(await fetchSpec(param), new URL(param, window.location.href).href);
    } else {
      // Convenience default for `npm run dev`: a spec.json beside index.html.
      await loadSpec(await fetchSpec('./spec.json'), window.location.href);
    }
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DeckHost />
  <NavController v-if="deck" :deck="deck" />

  <div v-if="!deck" class="slidey-loader">
    <div class="slidey-loader-card">
      <div class="slidey-loader-title">slidey</div>
      <p v-if="loading">Loading spec…</p>
      <template v-else>
        <p class="slidey-loader-hint">Load a scene spec to begin.</p>
        <p v-if="error" class="slidey-loader-error">{{ error }}</p>
        <label class="slidey-loader-btn">
          Choose spec.json…
          <input type="file" accept="application/json,.json" @change="onFile" hidden>
        </label>
        <p class="slidey-loader-tip">or pass <code>?spec=&lt;url&gt;</code></p>
      </template>
    </div>
  </div>
</template>

<style>
.slidey-loader {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: #0d1117; color: #e6edf3;
  font-family: 'Courier New', monospace;
}
.slidey-loader-card { text-align: center; max-width: 520px; padding: 40px; }
.slidey-loader-title {
  font-size: 56px; font-weight: bold;
  background: linear-gradient(180deg, #58a6ff, #bc8cff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  margin-bottom: 18px;
}
.slidey-loader-hint { color: #8b949e; margin-bottom: 24px; }
.slidey-loader-error { color: #f85149; margin-bottom: 16px; }
.slidey-loader-btn {
  display: inline-block; cursor: pointer;
  padding: 12px 28px; border-radius: 8px;
  background: #1f6feb; color: #fff; font-weight: bold;
}
.slidey-loader-tip { color: #484f58; margin-top: 20px; font-size: 15px; }
.slidey-loader-tip code { color: #79c0ff; }
</style>
