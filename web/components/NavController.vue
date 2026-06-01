<script setup>
// Manual click-through controller: keyboard + click navigation, plus a progress
// readout. Wraps a deck created by useDeck(). No audio, no autoplay (v1 scope).
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({ deck: { type: Object, required: true } });
const s = props.deck.state;

function onKey(e) {
  switch (e.key) {
    case 'ArrowRight': case ' ': case 'PageDown': case 'Enter':
      e.preventDefault(); props.deck.next(); break;
    case 'ArrowLeft': case 'PageUp': case 'Backspace':
      e.preventDefault(); props.deck.prev(); break;
    case 'Home': e.preventDefault(); props.deck.first(); break;
    case 'End':  e.preventDefault(); props.deck.last(); break;
  }
}
function onClick(e) {
  // Click right 2/3 → next, left 1/3 → prev (ignore clicks on the HUD).
  if (e.target.closest('.slidey-hud')) return;
  if (e.clientX < window.innerWidth / 3) props.deck.prev();
  else props.deck.next();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('click', onClick);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('click', onClick);
});
</script>

<template>
  <div class="slidey-hud">
    <div class="slidey-progress">
      <span class="slidey-scene">scene {{ s.sceneIndex + 1 }}/{{ s.sceneCount }}</span>
      <span class="slidey-sep">·</span>
      <span class="slidey-step">step {{ s.stepIndex + 1 }}/{{ s.stepsInScene }}</span>
    </div>
    <div class="slidey-bar"><div class="slidey-bar-fill" :style="{ width: (s.total > 1 ? (s.pos / (s.total - 1) * 100) : 100) + '%' }"></div></div>
    <div class="slidey-hint">← → / click to navigate</div>
  </div>
</template>

<style>
/* HUD chrome only — deliberately NOT scoped and prefixed `slidey-` so it never
   collides with the deck's verbatim template.css. */
.slidey-hud {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 22px;
  font-family: 'Courier New', monospace;
  font-size: 15px;
  color: #8b949e;
  background: linear-gradient(180deg, transparent, rgba(13,17,23,0.85));
  pointer-events: none;
}
.slidey-progress { display: flex; gap: 8px; }
.slidey-scene { color: #58a6ff; }
.slidey-sep { color: #484f58; }
.slidey-bar {
  flex: 1;
  height: 4px;
  background: #21262d;
  border-radius: 2px;
  overflow: hidden;
}
.slidey-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #58a6ff, #bc8cff);
  transition: width 200ms ease-out;
}
.slidey-hint { color: #484f58; letter-spacing: 0.05em; }
</style>
