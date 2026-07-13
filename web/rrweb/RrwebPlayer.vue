<script setup>
/**
 * SLIDEY — RrwebPlayer
 *
 * A reusable, themeable rrweb replay surface: mounts rrweb's own Replayer (not
 * the rrweb-player wrapper, whose 2.0.1 ESM build renders empty — see
 * BugReportModal.vue), scales it to fit, and adds play/pause, a scrub bar with
 * clickable chapter markers, and an interactive ("grab") toggle.
 *
 * Generalized from kitsoki's BugReportModal replayer so ONE widget serves both:
 *   - slidey's deck viewer (the live "selectable video" in a `video` scene), and
 *   - kitsoki's bug-report modal (pass the captured session `events`).
 *
 * Playback model ("both via toggle"): plays inline (optionally autoplay); the
 * viewer can scrub or jump chapters at any time, and the "grab" toggle flips the
 * replay to interactive (pointer-events on) so text selects and links click.
 *
 * Theming: all colors come from CSS vars (--rrp-*) with deck-dark defaults, so a
 * host (kitsoki) restyles by setting the vars. The reconstructed app inside the
 * iframe keeps its own captured styles regardless.
 *
 * Props:
 *   events     Array   rrweb event log (required, ≥2 events to replay)
 *   chapters   Array   [{id,label,start_ms,end_ms}] — optional scrub markers
 *   autoplay   Bool    start playing on mount (default false)
 *   startAtEnd Bool    pause on the last frame on mount (default false; useful
 *                      for bug reports where the final state is most relevant)
 *   loop       Bool    restart at end (default false)
 * Emits: ready(meta), timeupdate(ms), chapter(id), play, pause, ended
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  events: { type: Array, default: () => [] },
  chapters: { type: Array, default: () => [] },
  autoplay: { type: Boolean, default: false },
  startAtEnd: { type: Boolean, default: false },
  loop: { type: Boolean, default: false },
  // Show the transport (play/pause, scrub bar, chapter markers, grab toggle).
  // Off for lean-back cinematic playback where the deck drives everything.
  controls: { type: Boolean, default: true },
});
const emit = defineEmits(['ready', 'timeupdate', 'chapter', 'play', 'pause', 'ended']);

const host = ref(null);
let player = null;
let tick = null;
let resizeObs = null;

const ready = ref(false);
const playing = ref(false);
const interactive = ref(false);
const totalMs = ref(0);
const currentMs = ref(0);

const hasEvents = computed(() => (props.events || []).length >= 2);
const t0 = computed(() => (props.events && props.events.length ? props.events[0].timestamp || 0 : 0));

// Chapter markers as scrub-bar percentages.
const markers = computed(() => {
  if (!totalMs.value) return [];
  return (props.chapters || []).map((c) => ({
    id: c.id,
    label: c.label || c.id,
    startMs: c.start_ms != null ? c.start_ms : Math.max(0, (c.timestamp || 0) - t0.value),
    pct: Math.min(100, Math.max(0, ((c.start_ms != null ? c.start_ms : 0) / totalMs.value) * 100)),
  }));
});
const activeChapterId = computed(() => {
  let id = null;
  for (const m of markers.value) if (currentMs.value + 1 >= m.startMs) id = m.id;
  return id;
});

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 100) / 10);
  return `${s.toFixed(1)}s`;
}

function stopTick() {
  if (tick) { clearInterval(tick); tick = null; }
}

async function mount() {
  ready.value = false;
  playing.value = false;
  currentMs.value = 0;
  if (!host.value || !hasEvents.value) return;
  try {
    const mod = await import('rrweb');
    try { await import('rrweb/dist/style.css'); } catch { /* style optional */ }
    const Replayer = mod && mod.Replayer;
    if (!Replayer) return;
    player = new Replayer(props.events, {
      root: host.value,
      speed: 1,
      skipInactive: false,
      showWarning: false,
      mouseTail: false,
    });
    const meta = player.getMetaData();
    totalMs.value = Math.max(0, meta.totalTime || 0);
    if (props.startAtEnd) {
      currentMs.value = totalMs.value;
      player.pause(totalMs.value);
    } else {
      player.pause(0);
    }
    scaleToFit();
    // The iframe's intrinsic size (offsetWidth/Height) is often still 0 on the
    // synchronous mount tick, so the first scaleToFit() bails and the replay
    // renders at its full captured viewport — overflowing the host and reading
    // as a "heavily cut off" video. Re-fit across the next two frames once layout
    // settles, and keep fitting on any host/iframe resize (the deck stage itself
    // scales to the viewport, which would otherwise leave the scale stale).
    requestAnimationFrame(() => { scaleToFit(); requestAnimationFrame(scaleToFit); });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => scaleToFit());
      if (host.value) resizeObs.observe(host.value);
      if (player.iframe) resizeObs.observe(player.iframe);
    }
    ready.value = true;
    emit('ready', meta);
    if (props.autoplay) togglePlay();
  } catch {
    player = null;
    ready.value = false;
  }
}

function scaleToFit() {
  const h = host.value;
  const wrapper = player && player.wrapper;
  const iframe = player && player.iframe;
  if (!h || !wrapper || !iframe) return;
  const fw = iframe.offsetWidth || parseFloat(iframe.style.width) || 0;
  const fh = iframe.offsetHeight || parseFloat(iframe.style.height) || 0;
  if (!fw || !fh) return;
  const scale = Math.min(h.clientWidth / fw, h.clientHeight / fh, 1);
  wrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;
  wrapper.style.transformOrigin = 'center center';
}

function destroy() {
  stopTick();
  if (resizeObs) { try { resizeObs.disconnect(); } catch { /* ignore */ } resizeObs = null; }
  try { if (player) player.destroy(); } catch { /* ignore */ }
  player = null;
  playing.value = false;
}

function pause() {
  if (!player) return;
  if (playing.value) {
    player.pause();
    playing.value = false;
    stopTick();
    emit('pause');
  }
}

function play(fromMs = null) {
  if (!player) return;
  if (fromMs != null) currentMs.value = Math.min(Math.max(0, Number(fromMs) || 0), totalMs.value);
  if (playing.value) return;
  const from = currentMs.value >= totalMs.value ? 0 : currentMs.value;
  player.play(from);
  playing.value = true;
  emit('play');
  stopTick();
  tick = setInterval(() => {
    if (!player) return;
    currentMs.value = Math.min(player.getCurrentTime(), totalMs.value);
    emit('timeupdate', currentMs.value);
    if (currentMs.value >= totalMs.value) {
      if (props.loop) { player.play(0); }
      else { playing.value = false; stopTick(); emit('pause'); emit('ended'); }
    }
  }, 100);
}

function togglePlay() {
  if (playing.value) pause();
  else play();
}

function seek(ms) {
  if (!player) return;
  currentMs.value = Math.min(Math.max(0, ms), totalMs.value);
  player.pause(currentMs.value);
  playing.value = false;
  stopTick();
  emit('timeupdate', currentMs.value);
  emit('pause');
}

function onScrub(e) { seek(Number(e.target.value)); }
function jumpTo(m) { seek(m.startMs); emit('chapter', m.id); }
function toggleInteractive() { interactive.value = !interactive.value; }

watch(() => props.events, () => { destroy(); mount(); });
onMounted(mount);
onBeforeUnmount(destroy);

defineExpose({ play, pause, seek, destroy });
</script>

<template>
  <div class="rrp">
    <div
      ref="host"
      class="rrp-host"
      :class="{ 'rrp-interactive': interactive }"
    >
      <p v-if="!hasEvents" class="rrp-msg">No session replay captured.</p>
      <p v-else-if="!ready" class="rrp-msg">Loading replay…</p>
    </div>

    <div v-if="ready && controls" class="rrp-ctl">
      <button type="button" class="rrp-btn" @click="togglePlay">
        {{ playing ? '❚❚' : (currentMs >= totalMs ? '↻' : '▶') }}
      </button>

      <div class="rrp-track">
        <input
          class="rrp-scrub"
          type="range"
          min="0"
          :max="totalMs"
          step="50"
          :value="currentMs"
          @input="onScrub"
        />
        <button
          v-for="m in markers"
          :key="m.id"
          type="button"
          class="rrp-mark"
          :class="{ active: m.id === activeChapterId }"
          :style="{ left: m.pct + '%' }"
          :title="m.label"
          @click="jumpTo(m)"
        ></button>
      </div>

      <span class="rrp-time">{{ fmt(currentMs) }} / {{ fmt(totalMs) }}</span>
      <button
        type="button"
        class="rrp-btn rrp-grab"
        :class="{ on: interactive }"
        :title="interactive ? 'Playback control' : 'Interact with the page'"
        @click="toggleInteractive"
      >{{ interactive ? '✋' : '⇅' }}</button>
    </div>

    <div v-if="ready && controls && activeChapterId" class="rrp-chapter">
      {{ (chapters.find(c => c.id === activeChapterId) || {}).label }}
    </div>
  </div>
</template>

<style scoped>
.rrp {
  --rrp-bg: var(--rrp-bg, #0d1117);
  --rrp-frame: var(--rrp-frame, #30363d);
  --rrp-fg: var(--rrp-fg, #e6edf3);
  --rrp-sub: var(--rrp-sub, #8b949e);
  --rrp-accent: var(--rrp-accent, #58a6ff);
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.rrp-host {
  position: relative;
  background: var(--rrp-bg);
  border: 1px solid var(--rrp-frame);
  border-radius: 8px;
  width: 100%;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* rrweb injects an absolutely-positioned .replayer-wrapper holding the iframe;
   center it. pointer-events are OFF unless the host is "interactive" (grab). */
.rrp-host :deep(.replayer-wrapper) {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.rrp-host.rrp-interactive :deep(.replayer-wrapper) { pointer-events: auto; }
.rrp-host :deep(iframe) { border: none; background: #fff; }
.rrp-msg { color: var(--rrp-sub); font-size: 0.85rem; margin: 0; }

.rrp-ctl {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rrp-btn {
  background: none;
  border: 1px solid var(--rrp-frame);
  border-radius: 6px;
  color: var(--rrp-fg);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  padding: 4px 9px;
  line-height: 1;
}
.rrp-btn:hover { border-color: var(--rrp-accent); }
.rrp-grab.on { border-color: var(--rrp-accent); color: var(--rrp-accent); }

.rrp-track { position: relative; flex: 1; height: 18px; display: flex; align-items: center; }
.rrp-scrub { width: 100%; accent-color: var(--rrp-accent); }
.rrp-mark {
  position: absolute;
  top: 50%;
  width: 3px;
  height: 14px;
  margin-left: -1px;
  transform: translateY(-50%);
  padding: 0;
  border: none;
  border-radius: 1px;
  background: var(--rrp-sub);
  cursor: pointer;
}
.rrp-mark:hover, .rrp-mark.active { background: var(--rrp-accent); height: 18px; }
.rrp-time { color: var(--rrp-sub); font-size: 0.72rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rrp-chapter { color: var(--rrp-fg); font-size: 0.8rem; font-weight: 600; }
</style>
