<script setup>
// Interactive web-app root: loads a spec, wires the deck, renders DeckHost +
// NavController. Spec source priority: window.__SLIDEY_SPEC__ (embedded by the
// single-file build) → ?spec=<url> query param → workspace mode (slidey CLI
// viewer: /api/config + file-tree sidebar) → ./spec.json → a drop/file-picker
// overlay.
import { ref, shallowRef, onMounted, onUnmounted } from 'vue';
import DeckHost from './DeckHost.vue';
import NavController from './NavController.vue';
import FileTree from './FileTree.vue';
import { store } from '../store.js';
import { createDeck } from '../useDeck.js';

const deck = shallowRef(null);
const error = ref('');
const loading = ref(true);

// Workspace (CLI viewer) state.
const workspace = ref(false);
const tree = shallowRef(null);       // { name, children: [...] }
const activePath = ref('');
const sidebarWidth = ref(300);

// Live on-disk reload: poll the open spec's mtime and offer a reload when it
// changes underneath us. A failed reload never tears down the session — it
// surfaces a transient message and leaves the current deck on screen.
const stale = ref(false);            // on-disk version differs from the loaded one
const reloadError = ref('');         // transient toast when a reload attempt fails
const reloading = ref(false);
let loadedMtime = 0;                 // mtime of the spec currently rendered
let latestMtime = 0;                 // most recent mtime observed on disk
let pollTimer = null;
let errTimer = null;
const POLL_MS = 1500;

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

// ── Workspace: load a spec selected in the file tree ────────────────────────
async function openPath(rel) {
  try {
    loading.value = true;
    const res = await fetch(`/api/spec?path=${encodeURIComponent(rel)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} loading ${rel}`);
    // Spec-relative gif/img assets resolve under /workspace/<dir>/.
    const base = new URL(`/workspace/${data.dir ? data.dir + '/' : ''}`, window.location.href).href;
    await loadSpec(data.spec, base);
    activePath.value = rel;
    // Fresh file → reset the live-reload watch to this version.
    loadedMtime = latestMtime = data.mtimeMs || 0;
    stale.value = false;
    clearReloadError();
  } catch (err) {
    error.value = String(err.message || err);
    deck.value = null;
  } finally {
    loading.value = false;
  }
}

// ── Live on-disk reload ─────────────────────────────────────────────────────
function clearReloadError() {
  reloadError.value = '';
  if (errTimer) { clearTimeout(errTimer); errTimer = null; }
}

// Poll the open spec's mtime; flag it stale when the file changes on disk.
async function pollMtime() {
  if (!activePath.value || !deck.value) return;
  try {
    const r = await fetch(`/api/stat?path=${encodeURIComponent(activePath.value)}`);
    if (!r.ok) return;
    const { mtimeMs } = await r.json();
    if (!mtimeMs) return;
    latestMtime = mtimeMs;
    if (loadedMtime && mtimeMs !== loadedMtime) stale.value = true;
  } catch (_) { /* server gone / transient — try again next tick */ }
}

// Reload the open spec from disk. On any failure (gone, unparseable, invalid
// spec, broken render) we keep the deck that's already on screen, show a brief
// message, and carry on — never drop the user into an error state.
async function reloadActive() {
  const rel = activePath.value;
  if (!rel || reloading.value) return;
  reloading.value = true;
  clearReloadError();
  try {
    const res = await fetch(`/api/spec?path=${encodeURIComponent(rel)}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} loading ${rel}`);
    const base = new URL(`/workspace/${data.dir ? data.dir + '/' : ''}`, window.location.href).href;
    await loadSpec(data.spec, base);   // swaps deck.value only on success
    loadedMtime = latestMtime = data.mtimeMs || latestMtime;
    stale.value = false;
  } catch (err) {
    // Keep the current version on screen and continue.
    reloadError.value = `Reload failed — kept the previous version. ${String(err.message || err)}`;
    // Acknowledge the broken revision so we stop re-prompting for it; a further
    // edit (newer mtime) re-arms the stale flag on the next poll.
    loadedMtime = latestMtime;
    stale.value = false;
    errTimer = setTimeout(clearReloadError, 8000);
  } finally {
    reloading.value = false;
  }
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
  const sw = workspace.value ? sidebarWidth.value : 0;
  const scale = Math.min((window.innerWidth - sw) / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty('--slidey-scale', String(scale));
  document.documentElement.style.setProperty('--slidey-sidebar-w', `${sw}px`);
}

// ── Sidebar resize ──────────────────────────────────────────────────────────
function startResize(e) {
  e.preventDefault();
  const move = (ev) => {
    sidebarWidth.value = Math.max(180, Math.min(560, ev.clientX));
    fitScale();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

onMounted(async () => {
  fitScale();
  window.addEventListener('resize', fitScale);
  try {
    // Embedded spec (single-file static build): self-contained, no fetch.
    if (window.__SLIDEY_SPEC__) {
      await loadSpec(window.__SLIDEY_SPEC__, window.location.href);
      return;
    }
    const param = new URLSearchParams(window.location.search).get('spec');
    if (param) {
      await loadSpec(await fetchSpec(param), new URL(param, window.location.href).href);
      return;
    }
    // Workspace mode: the slidey CLI viewer serves /api/config + /api/tree.
    let cfg = null;
    try {
      const r = await fetch('/api/config');
      if (r.ok) cfg = await r.json();
    } catch (_) { /* not the CLI viewer — fall through */ }
    if (cfg && cfg.root) {
      workspace.value = true;
      document.body.classList.add('slidey-workspace');
      fitScale();
      try { tree.value = await (await fetch('/api/tree')).json(); } catch (_) { tree.value = null; }
      if (cfg.openFile) await openPath(cfg.openFile);
      // Watch the open spec for on-disk edits (CLI viewer only).
      pollTimer = setInterval(pollMtime, POLL_MS);
      return;
    }
    // Convenience default for `npm run dev`: a spec.json beside index.html.
    await loadSpec(await fetchSpec('./spec.json'), window.location.href);
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', fitScale);
  if (pollTimer) clearInterval(pollTimer);
  if (errTimer) clearTimeout(errTimer);
});
</script>

<template>
  <!-- Workspace sidebar (CLI viewer only) -->
  <aside v-if="workspace" class="slidey-sidebar" :style="{ width: sidebarWidth + 'px' }">
    <div class="slidey-sidebar-head">
      <span class="slidey-sidebar-mark">slidey</span>
      <span class="slidey-sidebar-root" :title="tree && tree.name">{{ tree ? tree.name : '' }}</span>
      <!-- Live-reload affordance: appears when the open spec changes on disk. -->
      <button
        v-if="stale"
        class="slidey-reload"
        :class="{ spinning: reloading }"
        :disabled="reloading"
        title="This deck changed on disk — click to reload"
        @click.stop="reloadActive"
      >⟳ reload</button>
    </div>
    <div class="slidey-sidebar-body">
      <FileTree
        v-if="tree && tree.children && tree.children.length"
        :nodes="tree.children"
        :active="activePath"
        :select="openPath"
      />
      <p v-else class="slidey-sidebar-empty">No .json / .jsonl specs found here.</p>
    </div>
    <div class="slidey-sidebar-resize" @mousedown="startResize"></div>
  </aside>

  <!-- Reload-failure toast: the previous deck stays on screen; this just informs. -->
  <div v-if="reloadError" class="slidey-reload-toast" @click="clearReloadError">
    <span class="slidey-reload-toast-icon">⚠</span>
    <span class="slidey-reload-toast-msg">{{ reloadError }}</span>
  </div>

  <DeckHost />
  <NavController v-if="deck" :key="activePath" :deck="deck" />

  <!-- Empty stage hint in workspace mode before a deck is chosen -->
  <div v-if="workspace && !deck" class="slidey-stage-empty">
    <p v-if="loading">Loading…</p>
    <template v-else>
      <p>Select a deck from the sidebar.</p>
      <p v-if="error" class="slidey-loader-error">{{ error }}</p>
    </template>
  </div>

  <!-- Standalone loader / file picker (non-workspace) -->
  <div v-if="!deck && !workspace" class="slidey-loader">
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

/* Reload-failure toast — non-blocking; the previous deck stays interactive. */
.slidey-reload-toast {
  position: fixed;
  top: 16px; left: 50%;
  transform: translateX(-50%);
  z-index: 2100;
  max-width: min(680px, 80vw);
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 16px;
  border: 1px solid #9e6a03;
  border-radius: 8px;
  background: #2d2206;
  color: #f0d894;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  cursor: pointer;
}
.slidey-reload-toast-icon { color: #e3b341; flex: none; }
.slidey-reload-toast-msg { overflow-wrap: anywhere; }

/* Empty-stage hint shown in workspace mode before a deck is opened. */
.slidey-stage-empty {
  position: fixed; top: 0; bottom: 0; right: 0;
  left: var(--slidey-sidebar-w, 300px);
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  color: #8b949e; font-family: 'Courier New', monospace;
  pointer-events: none;
}
</style>
