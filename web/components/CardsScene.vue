<script setup>
// SLIDEY — Cards scene
//
// A single component that switches on store.scene.variant to render either a
// set of peer items (grid / list / numbered / agenda / icon-row) or a
// side-by-side contrast (before-after / versus / point-counterpoint / pros-cons)
// or a question/answer pair (qa). Mirrors the reveal pattern used by
// NarrativeScene / ThreadScene exactly: each element is shown when its reveal
// step name is in store.revealed, via the shared .reveal / .shown CSS.
//
// Reveal step namespace (unified across all variants — see src/scenes/cards.js
// and stepsForScene() in web/sceneSteps.mjs):
//   cards_title                 → cards-title
//   cards_item_<i>              → cards-item-<i>   (one per card / side / qa part)
//   cards_caption               → cards-caption
// For the two-column contrast variants, item 0 is the LEFT side and item 1 is
// the RIGHT side. For qa, item 0 is the question and item 1 is the answer.
import { computed } from 'vue';
import { store } from '../store.js';

const sc = computed(() => store.scene || {});
const variant = computed(() => sc.value.variant || 'grid');

// Which family does this variant belong to?
const TWO_COL = ['before-after', 'versus', 'point-counterpoint', 'pros-cons'];
const isTwoCol = computed(() => TWO_COL.includes(variant.value));
const isQa     = computed(() => variant.value === 'qa');
const isPeers  = computed(() => !isTwoCol.value && !isQa.value);

const cards = computed(() => sc.value.cards || []);

// Sensible default column count for the peer grid when none is given.
function defaultColumns(n) {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 4) return 2;
  if (n <= 3) return 3;
  if (n <= 6) return 3;
  return 4;
}
// list / numbered / agenda always stack in a single column; grid / icon-row use
// a multi-column grid (scene.columns overrides the default).
const columns = computed(() => {
  if (variant.value === 'list' || variant.value === 'numbered' || variant.value === 'agenda') return 1;
  return sc.value.columns || defaultColumns(cards.value.length);
});
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
}));

// Two-column contrast sides. The favoured side (after / point / pro) takes the
// blue accent; the other takes purple/muted. pros-cons additionally prefixes
// each line with a ✓ / ✗ glyph.
const left = computed(() => sc.value.left || {});
const right = computed(() => sc.value.right || {});

// Accent class per side, keyed off variant. Index 0 = left, 1 = right.
function sideAccent(idx) {
  switch (variant.value) {
    case 'before-after':       return idx === 1 ? 'accent-blue' : 'accent-muted';
    case 'pros-cons':          return idx === 0 ? 'accent-green' : 'accent-red';
    case 'versus':             return idx === 0 ? 'accent-blue' : 'accent-purple';
    case 'point-counterpoint': return idx === 0 ? 'accent-blue' : 'accent-purple';
    default:                   return 'accent-blue';
  }
}
function sideGlyph(idx) {
  if (variant.value === 'pros-cons') return idx === 0 ? '✓' : '✗';
  return '';
}
// A side may carry lines[] (preferred) or fall back to a cards[] of {label}.
function sideLines(side) {
  if (Array.isArray(side.lines)) return side.lines;
  if (Array.isArray(side.cards)) return side.cards.map(c => (c && c.label) || c || '');
  return [];
}

// qa answer may be a string or lines[].
const answerLines = computed(() => {
  const a = sc.value.answer;
  if (Array.isArray(a)) return a;
  if (a == null || a === '') return [];
  return [a];
});

const shown = name => store.isRevealed(name);
</script>

<template>
  <div id="cards-region" class="scene-region active" :class="`cards-variant-${variant}`">
    <div
      id="cards-title"
      class="cards-title reveal"
      :class="{ shown: shown('cards-title') }"
      v-if="sc.title"
    >{{ sc.title }}</div>

    <!-- PEER ITEMS: grid / list / numbered / agenda / icon-row -->
    <div v-if="isPeers" class="cards-grid" :style="gridStyle">
      <div
        v-for="(c, i) in cards"
        :key="i"
        :id="`cards-item-${i}`"
        class="cards-card reveal"
        :class="[`cards-style-${c.style || 'default'}`, { shown: shown(`cards-item-${i}`) }]"
      >
        <div class="cards-card-head">
          <span v-if="variant === 'numbered'" class="cards-num">{{ i + 1 }}</span>
          <span v-else-if="variant === 'icon-row' && c.icon" class="cards-icon">{{ c.icon }}</span>
          <span v-else-if="variant === 'agenda'" class="cards-bullet">▸</span>
          <div class="cards-card-titles">
            <div class="cards-label">{{ c.label || '' }}</div>
            <div v-if="c.sub" class="cards-sub">{{ c.sub }}</div>
          </div>
        </div>
        <ul v-if="(c.lines || []).length" class="cards-lines">
          <li v-for="(ln, j) in c.lines" :key="j">{{ ln }}</li>
        </ul>
      </div>
    </div>

    <!-- TWO-COLUMN CONTRAST: before-after / versus / point-counterpoint / pros-cons -->
    <div v-else-if="isTwoCol" class="cards-contrast">
      <div
        v-for="(side, i) in [left, right]"
        :key="i"
        :id="`cards-item-${i}`"
        class="cards-col reveal"
        :class="[sideAccent(i), { shown: shown(`cards-item-${i}`) }]"
      >
        <div class="cards-col-head">{{ side.label || '' }}</div>
        <ul class="cards-lines">
          <li v-for="(ln, j) in sideLines(side)" :key="j">
            <span v-if="sideGlyph(i)" class="cards-glyph">{{ sideGlyph(i) }}</span>
            <span class="cards-line-text">{{ ln }}</span>
          </li>
        </ul>
      </div>
      <div class="cards-divider"></div>
    </div>

    <!-- QA: question header + answer body -->
    <div v-else-if="isQa" class="cards-qa">
      <div
        id="cards-item-0"
        class="cards-qa-question reveal"
        :class="{ shown: shown('cards-item-0') }"
      >
        <span class="cards-qa-glyph">Q</span>
        <span class="cards-qa-text">{{ sc.question || '' }}</span>
      </div>
      <div
        id="cards-item-1"
        class="cards-qa-answer reveal"
        :class="{ shown: shown('cards-item-1') }"
      >
        <span class="cards-qa-glyph cards-qa-glyph-a">A</span>
        <div class="cards-qa-body">
          <div v-for="(ln, j) in answerLines" :key="j" class="cards-qa-line">{{ ln }}</div>
        </div>
      </div>
    </div>

    <div
      id="cards-caption"
      class="cards-caption reveal"
      :class="{ shown: shown('cards-caption') }"
      v-if="sc.caption"
    >{{ sc.caption }}</div>
  </div>
</template>

<style scoped>
/* Cards scene — self-contained styles using the shared design tokens. The
   shared .reveal / .shown transition comes from template.css; only layout and
   card chrome live here. Mono font matches the rest of the deck. */
#cards-region {
  gap: 44px;
  width: 100%;
  max-width: 1640px;
  margin: 0 auto;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.cards-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.cards-caption {
  font-size: 28px;
  color: #cdd9e5;
  text-align: center;
  max-width: 1400px;
  line-height: 1.5;
  margin: 0 auto;
}

/* ── Peer grid / list / numbered / agenda / icon-row ───────────────────────── */
.cards-grid {
  display: grid;
  gap: 28px;
  width: 100%;
  align-items: stretch;
}
.cards-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 14px;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.cards-card.cards-style-primary   { border-color: #58a6ff; background: #0c2740; }
.cards-card.cards-style-secondary { border-color: #bc8cff; background: #1b1430; }

.cards-card-head { display: flex; align-items: flex-start; gap: 18px; }
.cards-card-titles { min-width: 0; flex: 1; }

.cards-num {
  flex-shrink: 0;
  font-size: 34px;
  font-weight: bold;
  color: #58a6ff;
  line-height: 1.1;
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}
.cards-icon { flex-shrink: 0; font-size: 34px; line-height: 1.1; color: #39c5cf; }
.cards-bullet { flex-shrink: 0; font-size: 32px; line-height: 1.2; color: #58a6ff; }

.cards-label {
  font-size: 32px;
  font-weight: bold;
  color: #e6edf3;
  line-height: 1.25;
}
.cards-sub {
  font-size: 22px;
  color: #8b949e;
  margin-top: 6px;
  line-height: 1.4;
}
.cards-card.cards-style-primary   .cards-label { color: #79c0ff; }
.cards-card.cards-style-secondary .cards-label { color: #d2b3ff; }

.cards-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cards-lines li {
  font-size: 24px;
  line-height: 1.45;
  color: #cdd9e5;
  display: flex;
  align-items: baseline;
  gap: 14px;
}

/* numbered / list / agenda stack as wide single-column rows — looser padding. */
.cards-variant-numbered .cards-card,
.cards-variant-list .cards-card,
.cards-variant-agenda .cards-card {
  padding: 22px 32px;
}
.cards-variant-agenda .cards-label,
.cards-variant-list .cards-label { font-size: 30px; }

/* ── Two-column contrast ──────────────────────────────────────────────────── */
.cards-contrast {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  width: 100%;
  align-items: stretch;
}
.cards-divider {
  position: absolute;
  left: 50%;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: #30363d;
  transform: translateX(-50%);
}
.cards-col {
  background: #161b22;
  border: 1px solid #30363d;
  border-top: 4px solid #30363d;
  border-radius: 14px;
  padding: 30px 36px 34px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.cards-col-head {
  font-size: 30px;
  font-weight: bold;
  letter-spacing: 0.06em;
  color: #e6edf3;
}
.cards-col .cards-lines li { font-size: 26px; }
.cards-line-text { min-width: 0; }
.cards-glyph { flex-shrink: 0; font-weight: bold; font-size: 26px; }

/* accents */
.cards-col.accent-blue   { border-top-color: #58a6ff; }
.cards-col.accent-blue   .cards-col-head { color: #79c0ff; }
.cards-col.accent-purple { border-top-color: #bc8cff; }
.cards-col.accent-purple .cards-col-head { color: #d2b3ff; }
.cards-col.accent-muted  { border-top-color: #484f58; }
.cards-col.accent-muted  .cards-col-head { color: #8b949e; }
.cards-col.accent-muted  .cards-lines li { color: #8b949e; }
.cards-col.accent-green  { border-top-color: #3fb950; }
.cards-col.accent-green  .cards-col-head { color: #3fb950; }
.cards-col.accent-green  .cards-glyph { color: #3fb950; }
.cards-col.accent-red    { border-top-color: #f85149; }
.cards-col.accent-red    .cards-col-head { color: #f85149; }
.cards-col.accent-red    .cards-glyph { color: #f85149; }

/* ── QA ────────────────────────────────────────────────────────────────────── */
.cards-qa {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}
.cards-qa-question,
.cards-qa-answer {
  display: flex;
  align-items: flex-start;
  gap: 26px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 14px;
  padding: 30px 36px;
}
.cards-qa-question { border-left: 4px solid #58a6ff; }
.cards-qa-answer   { border-left: 4px solid #bc8cff; }
.cards-qa-glyph {
  flex-shrink: 0;
  font-size: 40px;
  font-weight: bold;
  color: #58a6ff;
  line-height: 1.1;
  min-width: 48px;
}
.cards-qa-glyph-a { color: #bc8cff; }
.cards-qa-text {
  font-size: 38px;
  font-weight: bold;
  color: #e6edf3;
  line-height: 1.3;
}
.cards-qa-body { display: flex; flex-direction: column; gap: 12px; }
.cards-qa-line {
  font-size: 30px;
  color: #cdd9e5;
  line-height: 1.45;
}
</style>
