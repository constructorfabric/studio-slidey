<script setup>
// SLIDEY — VideoScene (interactive viewer)
//
// Renders a `video` scene live in the deck viewer using the rrweb log loaded by
// useDeck (store.rrwebEvents / store.rrwebChapters). Fullscreen fills the stage;
// embedded wraps the player in the same eyebrow/title/caption chrome the baked
// render composites. The headless render + PDF/PNG export do NOT use this — they
// rasterize the log natively (src/scenes/video.js); this is the "selectable
// video" the user can scrub, jump by chapter, and grab to interact with.
//
// Only rrweb-source video scenes play live here; a pre-rendered MP4 `src` shows
// a hint (the interactive viewer doesn't embed an <video> element).
import { computed } from 'vue';
import { store } from '../store.js';
import RrwebPlayer from '../rrweb/RrwebPlayer.vue';

const scene = computed(() => store.scene || {});
const embedded = computed(() => scene.value.mode === 'embedded');
const hasRrweb = computed(() => (store.rrwebEvents || []).length >= 2);
</script>

<template>
  <div id="video-region" class="scene-region active video-scene" :class="{ embedded }">
    <template v-if="hasRrweb">
      <div v-if="embedded" class="video-eyebrow" v-show="scene.eyebrow">{{ scene.eyebrow }}</div>
      <div v-if="embedded" class="video-title" v-show="scene.title">{{ scene.title }}</div>
      <div class="video-frame" :class="{ embedded }">
        <RrwebPlayer :events="store.rrwebEvents" :chapters="store.rrwebChapters" />
      </div>
      <div v-if="embedded" class="video-caption" v-show="scene.caption">{{ scene.caption }}</div>
    </template>
    <div v-else class="video-fallback">
      <p>{{ scene.src ? 'Pre-rendered MP4 — render to video to view.' : 'No rrweb log loaded.' }}</p>
    </div>
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
.video-frame.embedded { width: 66%; }
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
