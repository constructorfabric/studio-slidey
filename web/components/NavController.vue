<script setup>
// Manual click-through controller: keyboard + click navigation, plus progress
// and Edge TTS narration controls. Wraps a deck created by useDeck().
import { computed, onMounted, onUnmounted } from 'vue';
import { store } from '../store.js';

const props = defineProps({
  deck: { type: Object, required: true },
  isInlineEditing: { type: Boolean, default: false },
  suppressDeckClick: { type: Boolean, default: false },
  clearDeckClickSuppression: { type: Function, default: () => {} },
  narrationState: { type: Object, default: () => ({}) },
  playSlide: { type: Function, default: () => {} },
  playDeck: { type: Function, default: () => {} },
  playStack: { type: Function, default: () => {} },
  stackAvailable: { type: Boolean, default: false },
  setNarrationEnabled: { type: Function, default: () => {} },
  setCaptionsEnabled: { type: Function, default: () => {} },
  stopNarration: { type: Function, default: () => {} },
});
// The app replaces the deck object for live reloads and collection/stack
// navigation. Keep this as a computed lookup rather than capturing the first
// deck's state during setup, otherwise the HUD continues to show its obsolete
// scene and reveal totals after the visible deck has changed.
const s = computed(() => props.deck.state);
const narration = computed(() => props.narrationState || {});
const playing = computed(() => Boolean(narration.value.playing));
const playScope = computed(() => narration.value.playScope || '');
const narrationTitle = computed(() => narration.value.supported
  ? 'Speak reveal narration during automatic playback'
  : 'Narration preview is available in the Slidey web viewer and VS Code preview');

function onKey(e) {
  if (e.target.closest && e.target.closest('.slidey-editor')) return;
  if (e.target.closest && e.target.closest('.slidey-ref-backdrop')) return;
  if (e.target.closest && e.target.closest('[data-slidey-reference-trigger]')) return;
  if (e.target.closest && e.target.closest('[data-slidey-ref]')) return;
  // Do not steal native keyboard behavior from controls. In particular, Enter
  // must activate the focused button once (rather than also advancing a slide),
  // and arrows must continue to seek a focused video player or range input.
  if (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'AUDIO', 'VIDEO'].includes(e.target.tagName)
    || e.target.closest?.('[role="button"], [role="slider"], [contenteditable="true"]')) return;
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
  if (props.suppressDeckClick) {
    props.clearDeckClickSuppression();
    return;
  }
  if (props.isInlineEditing) return;
  // Click right 2/3 → next, left 1/3 → prev (ignore clicks on the HUD and the
  // workspace file-tree sidebar so selecting a deck doesn't advance the slide).
  if (e.target.closest('.slidey-hud')) return;
  if (e.target.closest('.slidey-sidebar')) return;
  if (e.target.closest('.slidey-editor')) return;
  if (e.target.closest('.slidey-library-link')) return;
  if (e.target.closest('.slidey-reference-rail')) return;
  if (e.target.closest('.slidey-ref-backdrop')) return;
  if (e.target.closest('[data-slidey-reference-trigger]')) return;
  if (e.target.closest('[data-slidey-ref]')) return;
  // Clicks on the video player / its transport (play, scrub, grab) must not also
  // advance the slide, so the controls are actually usable.
  if (e.target.closest('.video-cine-holder')) return;
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
    <div class="slidey-progress" role="status" aria-live="polite" aria-atomic="true">
      <span class="slidey-scene">scene {{ s.sceneIndex + 1 }}/{{ s.sceneCount }}</span>
      <span class="slidey-sep">·</span>
      <span class="slidey-step">step {{ s.stepIndex + 1 }}/{{ s.stepsInScene }}</span>
    </div>
    <button
      type="button"
      class="slidey-jump"
      title="Jump to beginning (Home)"
      aria-label="Jump to beginning"
      :disabled="s.pos <= 0"
      @click="deck.first()"
    >⏮</button>
    <div class="slidey-playback-controls" @click.stop>
      <button
        type="button"
        class="slidey-play-btn"
        :class="{ active: playing && playScope === 'slide' }"
        :title="playing && playScope === 'slide' ? 'Stop automatic slide playback' : 'Automatically reveal this slide from the start'"
        :aria-label="playing && playScope === 'slide' ? 'Stop automatic slide playback' : 'Play this slide automatically from the start'"
        @click="playing && playScope === 'slide' ? stopNarration() : playSlide()"
      ><span class="slidey-play-icon">▶</span><span class="slidey-scope-icon" aria-hidden="true">▣</span><span>{{ playing && playScope === 'slide' ? 'Stop' : 'Slide' }}</span></button>
      <button
        type="button"
        class="slidey-play-btn primary"
        :class="{ active: playing && playScope === 'deck' }"
        :title="playing && playScope === 'deck' ? 'Stop automatic deck playback' : 'Automatically reveal this deck'"
        :aria-label="playing && playScope === 'deck' ? 'Stop automatic deck playback' : 'Play deck automatically'"
        @click="playing && playScope === 'deck' ? stopNarration() : playDeck()"
      ><span class="slidey-play-icon">▶</span><span class="slidey-scope-icon deck" aria-hidden="true">▤</span><span>{{ playing && playScope === 'deck' ? 'Stop' : 'Deck' }}</span></button>
      <button
        type="button"
        class="slidey-play-btn"
        :class="{ active: playing && playScope === 'stack' }"
        :disabled="!stackAvailable"
        :title="!stackAvailable ? 'Play Stack is available for hierarchy collections' : (playing && playScope === 'stack' ? 'Stop automatic stack playback' : 'Play the complete hierarchy from the root')"
        :aria-label="!stackAvailable ? 'Play Stack unavailable' : (playing && playScope === 'stack' ? 'Stop automatic stack playback' : 'Play complete hierarchy stack from the root')"
        @click="playing && playScope === 'stack' ? stopNarration() : playStack()"
      ><span class="slidey-play-icon">▶</span><span class="slidey-scope-icon deck" aria-hidden="true">▥</span><span>{{ playing && playScope === 'stack' ? 'Stop' : 'Stack' }}</span></button>
    </div>
    <div
      class="slidey-bar"
      role="progressbar"
      aria-label="Deck progress"
      :aria-valuemin="0"
      :aria-valuemax="Math.max(s.total - 1, 1)"
      :aria-valuenow="s.pos"
      :aria-valuetext="`Slide ${s.sceneIndex + 1} of ${s.sceneCount}, reveal ${s.stepIndex + 1} of ${s.stepsInScene}`"
    ><div class="slidey-bar-fill" :style="{ width: (s.total > 1 ? (s.pos / (s.total - 1) * 100) : 100) + '%' }"></div></div>
    <button
      type="button"
      class="slidey-jump"
      title="Jump to end (End)"
      aria-label="Jump to end"
      :disabled="s.pos >= s.total - 1"
      @click="deck.last()"
    >⏭</button>
    <div class="slidey-narration-controls" @click.stop>
      <label class="slidey-play-toggle" :class="{ disabled: !narration.supported }" :title="narrationTitle">
        <input type="checkbox" :checked="narration.narrationEnabled" :disabled="!narration.supported" @change="setNarrationEnabled($event.target.checked)">
        <span>♪ Narration</span>
      </label>
      <label class="slidey-play-toggle" title="Show spoken reveal text as closed captions during automatic playback">
        <input type="checkbox" :checked="narration.captionsEnabled" @change="setCaptionsEnabled($event.target.checked)">
        <span>CC</span>
      </label>
      <span
        v-if="narration.error"
        class="slidey-narration-error"
        tabindex="0"
        role="status"
        :title="`Narration error: ${narration.error}`"
        :aria-label="`Narration error: ${narration.error}`"
      >
        !
        <span class="slidey-narration-error-popover">
          <strong>Narration error:</strong>
          <span>{{ narration.error }}</span>
        </span>
      </span>
    </div>
    <div class="slidey-hint">⏮ ⏭ / ← → / click to navigate</div>
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
/* While a video scene is expanded to fullscreen (VideoScene sets this body flag),
   relocate the HUD to the TOP so its bar can't collide with the player's transport
   at the bottom of the video. The gradient flips to fade downward from the top. */
body.slidey-video-full .slidey-hud {
  top: 0;
  bottom: auto;
  background: linear-gradient(0deg, transparent, rgba(13,17,23,0.92));
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

/* Jump-to-beginning / jump-to-end buttons. The HUD is pointer-events:none so
   stray clicks pass through to navigate; these re-enable pointer events so they
   are clickable (the global click handler ignores anything inside .slidey-hud). */
.slidey-jump {
  pointer-events: auto;
  flex: none;
  background: none;
  border: none;
  padding: 2px 6px;
  font: inherit;
  font-size: 16px;
  line-height: 1;
  color: #8b949e;
  cursor: pointer;
  border-radius: 4px;
  transition: color 120ms ease, background 120ms ease;
}
.slidey-jump:hover:not(:disabled) { color: #58a6ff; background: rgba(88,166,255,0.12); }
.slidey-jump:disabled { opacity: 0.3; cursor: default; }
.slidey-playback-controls,
.slidey-narration-controls {
  pointer-events: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
}
.slidey-play-btn, .slidey-play-toggle {
  border: 1px solid #30363d;
  border-radius: 6px;
  background: rgba(22, 27, 34, 0.78);
  color: #8b949e;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 8px;
}
.slidey-play-btn { min-width: 72px; display: inline-flex; align-items: center; gap: 5px; }
.slidey-play-btn:hover:not(:disabled), .slidey-play-toggle:hover:not(.disabled) {
  border-color: #58a6ff;
  color: #c9d1d9;
}
.slidey-play-btn.primary { border-color: rgba(88, 166, 255, 0.68); color: #dbeeff; background: rgba(31, 111, 235, 0.2); }
.slidey-play-btn.active {
  border-color: #3fb950;
  color: #d2f8d2;
  background: rgba(35, 134, 54, 0.24);
}
.slidey-play-icon { font-size: 10px; color: #79c0ff; }
.slidey-scope-icon { color: #c9d1d9; font-size: 14px; line-height: 10px; }
.slidey-scope-icon.deck { letter-spacing: -4px; margin-right: 2px; }
.slidey-play-toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
.slidey-play-toggle input { margin: 0; accent-color: #58a6ff; }
.slidey-play-toggle.disabled { opacity: 0.38; cursor: default; }
.slidey-narration-error {
  position: relative;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 1px solid #da3633;
  border-radius: 50%;
  color: #ffb4ad;
  font-size: 12px;
  font-weight: bold;
  cursor: help;
  outline: none;
}
.slidey-narration-error:focus-visible {
  box-shadow: 0 0 0 2px rgba(218, 54, 51, 0.45);
}
.slidey-narration-error-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 1001;
  display: none;
  width: min(420px, calc(100vw - 44px));
  padding: 10px 12px;
  border: 1px solid rgba(248, 81, 73, 0.55);
  border-radius: 6px;
  background: rgba(22, 27, 34, 0.98);
  color: #ffd6d2;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
}
.slidey-narration-error-popover strong {
  display: block;
  margin-bottom: 4px;
  color: #ffb4ad;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.slidey-narration-error:hover .slidey-narration-error-popover,
.slidey-narration-error:focus .slidey-narration-error-popover {
  display: block;
}
</style>
