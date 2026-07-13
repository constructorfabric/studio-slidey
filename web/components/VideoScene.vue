<script setup>
// SLIDEY — VideoScene (interactive viewer)
//
// Renders a `video` scene live in the deck viewer. Two media sources play
// natively: an rrweb session log (store.rrwebEvents, via RrwebPlayer) or a plain
// MP4 `src` (a <video> element). The headless render + PDF/PNG export do NOT use
// this — they rasterize natively (src/scenes/video.js); this is the selectable,
// scrubbable "video" the viewer interacts with.
//
// Cinematic transition (embedded scenes, default on; opt out with
// `cinematic: false`): when the scene becomes active it first shows the slide as
// laid out — eyebrow / title / framed thumbnail / caption — for a beat, then the
// media EXPANDS to FULL SCREEN as it starts playing, and when playback ends it
// SHRINKS back into the slide before the viewer advances. The player lives in a
// single Teleport-to-body holder so it stays mounted across the size change (no
// remount / no lost playback) and so position:fixed is truly viewport-relative
// (unaffected by the deck stage's CSS transform). The same choreography drives
// both rrweb and MP4 — only the playing element differs. During the cinematic
// expand the transport chrome is hidden (lean-back); with `cinematic: false` the
// media plays inline in the slide with its scrub controls.
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { store } from '../store.js';
import RrwebPlayer from '../rrweb/RrwebPlayer.vue';

const scene = computed(() => store.scene || {});
const embedded = computed(() => scene.value.mode === 'embedded');
const hasRrweb = computed(() => (store.rrwebEvents || []).length >= 2);
const mediaKind = computed(() => (hasRrweb.value ? 'rrweb' : (scene.value.src ? 'mp4' : 'none')));
const hasAudio = computed(() => !!scene.value.audio);

// Cinematic choreography runs for embedded scenes that have media, unless the
// scene opts out. Non-embedded (fullscreen) scenes already fill the stage.
const cinematic = computed(() =>
  embedded.value && mediaKind.value !== 'none' && scene.value.cinematic !== false);
const introMs = computed(() => Math.max(0, scene.value.introMs ?? 900));

// phase: 'intro' (slide as-is, paused) → 'full' (playing) → 'outro' (ended).
const phase = ref('intro');
// Only a cinematic scene in its 'full' phase expands to the viewport; otherwise
// the holder tracks the inline slide thumbnail and plays in place.
const expanded = computed(() => cinematic.value && phase.value === 'full');
// Reserve the top strip for the slidey HUD (which relocates to the top while a
// video is expanded, so its bar can't collide with the player's transport).
const HUD_INSET = 52;
// Show the transport: always when playing inline (non-cinematic), and during the
// fullscreen cinematic playback (the intro/outro thumbnail stays chrome-free).
const showControls = computed(() => !cinematic.value || expanded.value);
const reducedMotion = ref(false);

const frameRef = ref(null);
const playerRef = ref(null);
const videoRef = ref(null);
const audioRef = ref(null);
const frameRect = ref(null);
const playbackStarted = ref(false);
// Gate the size transition: off for the initial inline placement (so the holder
// snaps onto the thumbnail with no grow-in), on once we start expanding.
const animate = ref(false);
let introTimer = null;
let motionQuery = null;
let onMotionPreferenceChange = null;

function emitVideoEvent(name, detail = {}) {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(`slidey:video-${name}`, {
    detail: { kind: mediaKind.value, scene: scene.value, ...detail },
  }));
}

function measure() {
  const el = frameRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width) frameRect.value = { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Teleported holder's screen rect: the slide thumbnail's box, or the full
// viewport when expanded. CSS transitions tween between the two.
const holderStyle = computed(() => {
  if (expanded.value) {
    return { top: `${HUD_INSET}px`, left: '0px', width: '100vw', height: `calc(100vh - ${HUD_INSET}px)` };
  }
  const r = frameRect.value;
  if (!r) return { opacity: 0, top: '0px', left: '0px', width: '0px', height: '0px' };
  return { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` };
});

function startPlayback() {
  if (mediaKind.value === 'rrweb' && playerRef.value) {
    playerRef.value.seek(0);
    syncAudioToMs(0);
    playerRef.value.play();
    playAudio();
  } else if (mediaKind.value === 'mp4' && videoRef.value) {
    try { videoRef.value.currentTime = 0; } catch { /* ignore */ }
    syncAudioToMs(0);
    const p = videoRef.value.play();
    if (p && p.catch) p.catch(() => {});
    playAudio();
  }
}

function syncAudioToMs(ms) {
  const a = audioRef.value;
  if (!a) return;
  const seconds = Math.max(0, ms / 1000);
  if (Math.abs((a.currentTime || 0) - seconds) > 0.25) {
    try { a.currentTime = seconds; } catch { /* ignore */ }
  }
}

function playAudio() {
  const a = audioRef.value;
  if (!a) return;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}

function pauseAudio() {
  const a = audioRef.value;
  if (a) a.pause();
}

function onReplayTime(ms) {
  syncAudioToMs(ms);
  emitVideoEvent('time', { ms });
}
function onReplayPlay() {
  playbackStarted.value = true;
  playAudio();
  emitVideoEvent('play');
}
function onReplayPause() {
  pauseAudio();
  emitVideoEvent('pause');
}
function onMp4Play() {
  playbackStarted.value = true;
  const ms = (videoRef.value?.currentTime || 0) * 1000;
  syncAudioToMs(ms);
  playAudio();
  emitVideoEvent('play', { ms });
}
function onMp4Pause() {
  pauseAudio();
  emitVideoEvent('pause', { ms: (videoRef.value?.currentTime || 0) * 1000 });
}
function onMp4TimeUpdate() {
  const ms = (videoRef.value?.currentTime || 0) * 1000;
  syncAudioToMs(ms);
  emitVideoEvent('time', { ms });
}

function onEnded() {
  pauseAudio();
  emitVideoEvent('ended');
  if (phase.value === 'full') phase.value = 'outro';
}

// Drive the choreography whenever a video scene mounts/activates.
function begin() {
  clearTimeout(introTimer);
  pauseAudio();
  playbackStarted.value = false;
  animate.value = false;
  measure();
  if (!cinematic.value || reducedMotion.value) { phase.value = 'full'; nextTick(startPlayback); return; }
  phase.value = 'intro';
  introTimer = setTimeout(() => {
    animate.value = true;       // enable the tween for the expand (and later shrink)
    phase.value = 'full';
    // let the expand transition start, then play
    nextTick(() => requestAnimationFrame(startPlayback));
  }, introMs.value);
}

function onResize() { if (!expanded.value) measure(); }

function onRrwebReady() {
  if (mediaKind.value === 'rrweb' && phase.value === 'full' && !playbackStarted.value) {
    startPlayback();
  }
}

function onVideoCommand(e) {
  const action = e && e.detail && e.detail.action;
  if (action === 'play') startPlayback();
  if (action === 'pause') {
    if (playerRef.value && mediaKind.value === 'rrweb') playerRef.value.pause();
    if (videoRef.value && mediaKind.value === 'mp4') videoRef.value.pause();
    pauseAudio();
  }
}

// While a video is expanded, flag the document so the slidey HUD relocates to the
// top (NavController reacts to body.slidey-video-full) — keeping its bar clear of
// the player's transport at the bottom of the fullscreen video.
function setFullFlag(on) {
  if (typeof document !== 'undefined') document.body.classList.toggle('slidey-video-full', !!on);
}
watch(expanded, setFullFlag);

watch(() => store.scene, () => nextTick(begin));
onMounted(() => {
  motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  onMotionPreferenceChange = () => { reducedMotion.value = Boolean(motionQuery && motionQuery.matches); };
  onMotionPreferenceChange();
  if (motionQuery) motionQuery.addEventListener('change', onMotionPreferenceChange);
  window.addEventListener('resize', onResize);
  window.addEventListener('slidey:video-command', onVideoCommand);
  nextTick(begin);
});
onBeforeUnmount(() => {
  clearTimeout(introTimer);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('slidey:video-command', onVideoCommand);
  if (motionQuery && onMotionPreferenceChange) motionQuery.removeEventListener('change', onMotionPreferenceChange);
  setFullFlag(false);
});
</script>

<template>
  <div
    id="video-region"
    class="scene-region active video-scene"
    :class="[{ embedded }, `phase-${phase}`]"
  >
    <template v-if="mediaKind !== 'none'">
      <div v-if="embedded" class="video-eyebrow" v-show="scene.eyebrow" data-edit-path='["eyebrow"]'>{{ scene.eyebrow }}</div>
      <div v-if="embedded" class="video-title" v-show="scene.title" data-edit-path='["title"]'>{{ scene.title }}</div>
      <!-- Inline spacer: reserves the slide's framed area so the chrome lays out;
           the live player floats above it (Teleported) matching this box. -->
      <div ref="frameRef" class="video-frame" :class="{ embedded }">
        <div class="video-frame-placeholder"></div>
      </div>
      <div v-if="embedded" class="video-caption" v-show="scene.caption" data-edit-path='["caption"]' data-edit-multiline>{{ scene.caption }}</div>
    </template>
    <div v-else class="video-fallback">
      <p>No session replay or video source loaded.</p>
    </div>

    <!-- The actual player, Teleported to body so position:fixed is viewport-
         relative and it survives the intro→full→outro resize without remounting. -->
    <Teleport to="body">
      <template v-if="mediaKind !== 'none'">
        <div class="video-cine-backdrop" :class="{ expanded }"></div>
        <div class="video-cine-holder" :class="{ expanded, animate }" :style="holderStyle">
          <RrwebPlayer
            v-if="mediaKind === 'rrweb'"
            ref="playerRef"
            :events="store.rrwebEvents"
            :chapters="store.rrwebChapters"
            :autoplay="false"
            :controls="showControls"
            @ready="onRrwebReady"
            @timeupdate="onReplayTime"
            @play="onReplayPlay"
            @pause="onReplayPause"
            @ended="onEnded"
          />
          <video
            v-else
            ref="videoRef"
            class="video-mp4"
            :src="scene.src"
            playsinline
            :controls="showControls"
            preload="auto"
            @play="onMp4Play"
            @pause="onMp4Pause"
            @timeupdate="onMp4TimeUpdate"
            @ended="onEnded"
          ></video>
          <audio
            v-if="hasAudio"
            ref="audioRef"
            :src="scene.audio"
            preload="auto"
          ></audio>
        </div>
      </template>
    </Teleport>
  </div>
</template>

<style scoped>
.video-scene {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
}
.video-frame { width: 100%; }
.video-frame.embedded { width: 76%; }
/* Spacer matching the player's 16:9 box so the slide chrome positions correctly
   while the real player floats above (Teleported). */
.video-frame-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--rrp-frame, #30363d);
  border-radius: 8px;
  background: var(--rrp-bg, #0d1117);
}
.video-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.85rem;
  color: var(--accent, #58a6ff);
  font-weight: 700;
}
.video-title { font-size: 1.8rem; font-weight: 700; color: var(--fg, #e6edf3); }
.video-caption { font-size: 0.95rem; color: var(--sub, #8b949e); }
.video-fallback { color: var(--sub, #8b949e); font-size: 1rem; }
</style>

<style>
/* Unscoped (Teleported to body, so scene-scoped styles wouldn't reach it). */
.video-cine-holder {
  position: fixed;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
}
.video-cine-holder.animate {
  transition: top 0.55s cubic-bezier(0.4, 0, 0.2, 1),
              left 0.55s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.55s cubic-bezier(0.4, 0, 0.2, 1),
              height 0.55s cubic-bezier(0.4, 0, 0.2, 1);
}
.video-cine-holder.expanded { padding: 1.4vh 2vw; }
.video-cine-holder > * { width: 100%; }
/* When expanded, the player fills the available box and its replay letterboxes
   inside (RrwebPlayer.scaleToFit caps at native scale, so nothing is cut off and
   nothing upscales/blurs). The host flexes to take the height left over after the
   transport bar; the transport stays visible at the bottom. */
.video-cine-holder.expanded .rrp { height: 100%; }
.video-cine-holder.expanded .rrp-host {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  aspect-ratio: auto;
}
.video-cine-holder > audio { display: none; }
.video-mp4 {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  border-radius: 8px;
}
/* Dim backdrop behind the fullscreen player; fades in only while expanded. */
.video-cine-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(2, 4, 8, 0.86);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.5s ease;
}
.video-cine-backdrop.expanded { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .video-cine-holder.animate, .video-cine-backdrop { transition: none; }
}
</style>
