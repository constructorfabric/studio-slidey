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
import { escapeHTML } from '../format.js';
import { linkTargetForItem } from '../collections.mjs';

const sc = computed(() => store.scene || {});
const variant = computed(() => sc.value.variant || 'grid');

// Which family does this variant belong to?
const TWO_COL = ['before-after', 'versus', 'point-counterpoint', 'pros-cons'];
const isTwoCol = computed(() => TWO_COL.includes(variant.value));
const isQa     = computed(() => variant.value === 'qa');
const isPeers  = computed(() => !isTwoCol.value && !isQa.value);
const isMarkdown = computed(() => variant.value === 'markdown');
const isMarkdownAgenda = computed(() =>
  isMarkdown.value && /^agenda$/i.test(String(sc.value.title || '').trim()));

const cards = computed(() => sc.value.cards || []);
const markdownDensity = computed(() => {
  if (!isMarkdown.value) return '';
  const itemCount = cards.value.length;
  const lineCount = cards.value.reduce((n, c) => n + 1 + ((c.lines || []).length), 0);
  const textLen = [
    sc.value.title || '',
    sc.value.intro || '',
    sc.value.outro || '',
    ...cards.value.flatMap(c => [c.label || '', ...((c.lines || []))]),
  ].join(' ').length;
  if (itemCount >= 8 || lineCount >= 11 || textLen > 760) return 'markdown-density-dense';
  if (itemCount >= 6 || lineCount >= 8 || textLen > 520) return 'markdown-density-medium';
  return 'markdown-density-roomy';
});

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
  if (variant.value === 'list' || variant.value === 'numbered' || variant.value === 'agenda' || isMarkdown.value) return 1;
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

function inlineHTML(html, text = '') {
  return html || escapeHTML(String(text || '')).replace(/\n/g, '<br>');
}

function lineHTML(card, i) {
  const html = Array.isArray(card.linesHtml) ? card.linesHtml[i] : '';
  const text = Array.isArray(card.lines) ? card.lines[i] : '';
  return inlineHTML(html, text);
}

function cardLink(card) {
  return linkTargetForItem(card);
}

function openCardLink(card, event) {
  const link = cardLink(card);
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(new CustomEvent('slidey:library-link', { detail: link }));
}

function onCardLinkKey(card, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  openCardLink(card, event);
}
</script>

<template>
  <div
    id="cards-region"
    class="scene-region active"
    :class="[
      `cards-variant-${variant}`,
      markdownDensity,
      { 'cards-markdown-agenda': isMarkdownAgenda },
    ]"
  >
    <div
      id="cards-title"
      class="cards-title reveal"
      :class="{ shown: shown('cards-title') }"
      v-if="sc.title"
      data-edit-path='["title"]'
    >{{ sc.title }}</div>

    <div
      v-if="isMarkdown && sc.intro"
      class="cards-markdown-intro reveal"
      :class="{ shown: shown('cards-title') || shown('cards-item-0') }"
      v-html="inlineHTML(sc.introHtml, sc.intro)"
    ></div>

    <!-- PEER ITEMS: grid / list / numbered / agenda / icon-row -->
    <div v-if="isPeers" class="cards-grid" :style="gridStyle">
      <div
        v-for="(c, i) in cards"
        :key="i"
        :id="`cards-item-${i}`"
        class="cards-card reveal"
        :class="[`cards-style-${c.style || 'default'}`, { shown: shown(`cards-item-${i}`), 'cards-card-link slidey-library-link': cardLink(c) }]"
        :role="cardLink(c) ? 'button' : null"
        :tabindex="cardLink(c) ? 0 : null"
        :title="cardLink(c) ? `Open ${cardLink(c).label}` : null"
        @click="openCardLink(c, $event)"
        @keydown="onCardLinkKey(c, $event)"
      >
        <div class="cards-card-head">
          <span v-if="variant === 'numbered'" class="cards-num">{{ i + 1 }}</span>
          <span v-else-if="variant === 'icon-row' && c.icon" class="cards-icon">{{ c.icon }}</span>
          <span v-else-if="variant === 'agenda'" class="cards-bullet">▸</span>
          <span v-else-if="variant === 'markdown'" class="cards-bullet">•</span>
          <div class="cards-card-titles">
            <div
              v-if="isMarkdown"
              class="cards-label"
              v-html="inlineHTML(c.labelHtml, c.label)"
            ></div>
            <div v-else class="cards-label" :data-edit-path="JSON.stringify(['cards', i, 'label'])">{{ c.label || '' }}</div>
            <div
              v-if="isMarkdown && c.sub"
              class="cards-sub"
              v-html="inlineHTML(c.subHtml, c.sub)"
            ></div>
            <div v-else-if="c.sub" class="cards-sub" :data-edit-path="JSON.stringify(['cards', i, 'sub'])">{{ c.sub }}</div>
          </div>
        </div>
        <ul v-if="(c.lines || []).length" class="cards-lines">
          <li v-for="(ln, j) in c.lines" :key="j">
            <span v-if="isMarkdown" v-html="lineHTML(c, j)"></span>
            <span v-else :data-edit-path="JSON.stringify(['cards', i, 'lines', j])">{{ ln }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div
      v-if="isMarkdown && sc.outro"
      class="cards-markdown-outro reveal"
      :class="{ shown: shown('cards-caption') || shown('cards-item-' + Math.max(0, cards.length - 1)) }"
      v-html="inlineHTML(sc.outroHtml, sc.outro)"
    ></div>

    <!-- TWO-COLUMN CONTRAST: before-after / versus / point-counterpoint / pros-cons -->
    <div v-else-if="isTwoCol" class="cards-contrast">
      <div
        v-for="(side, i) in [left, right]"
        :key="i"
        :id="`cards-item-${i}`"
        class="cards-col reveal"
        :class="[sideAccent(i), { shown: shown(`cards-item-${i}`) }]"
      >
        <div class="cards-col-head" :data-edit-path="JSON.stringify([i === 0 ? 'left' : 'right', 'label'])">{{ side.label || '' }}</div>
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
        <span class="cards-qa-text" data-edit-path='["question"]'>{{ sc.question || '' }}</span>
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
      data-edit-path='["caption"]'
      data-edit-multiline
    >{{ sc.caption }}</div>
  </div>
</template>

<style scoped>
/* Cards scene — self-contained styles using the shared design tokens. The
   shared .reveal / .shown transition comes from template.css; only layout and
   card chrome live here. Mono font matches the rest of the deck. */
#cards-region {
  gap: 24px;
  width: 100%;
  max-width: 1640px;
  margin: 0 auto;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.cards-title {
  font-size: 30px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.cards-caption {
  font-size: 22px;
  color: #cdd9e5;
  text-align: center;
  max-width: 1400px;
  line-height: 1.35;
  margin: 0 auto;
}

/* ── Peer grid / list / numbered / agenda / icon-row ───────────────────────── */
.cards-grid {
  display: grid;
  gap: 18px;
  width: 100%;
  align-items: stretch;
}
.cards-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 14px;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  position: relative;
}
.cards-card.cards-style-primary   { border-color: #58a6ff; background: #0c2740; }
.cards-card.cards-style-secondary { border-color: #bc8cff; background: #1b1430; }
.cards-card.cards-card-link {
  cursor: pointer;
  border-color: #3fb950;
  box-shadow: inset 0 0 0 1px rgba(63, 185, 80, 0.2);
}
.cards-card.cards-card-link::after {
  content: ">";
  position: absolute;
  top: 14px;
  right: 16px;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(63, 185, 80, 0.7);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #7ee787;
  font-size: 19px;
  font-weight: bold;
  line-height: 1;
}
.cards-card.cards-card-link:hover,
.cards-card.cards-card-link:focus-visible {
  border-color: #7ee787;
  box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.24), inset 0 0 0 1px rgba(126, 231, 135, 0.32);
  outline: none;
}

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
  font-size: 28px;
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
  font-size: 21px;
  line-height: 1.35;
  color: #cdd9e5;
  display: flex;
  align-items: baseline;
  gap: 14px;
}

/* numbered / list / agenda stack as wide single-column rows — looser padding. */
.cards-variant-numbered .cards-card,
.cards-variant-list .cards-card,
.cards-variant-agenda .cards-card {
  padding: 16px 26px;
}
.cards-variant-agenda .cards-label,
.cards-variant-list .cards-label { font-size: 26px; }

/* Imported Markdown/Marp decks should read like slides, not UI cards. */
#cards-region.cards-variant-markdown {
  max-width: 1760px;
  gap: 34px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  align-items: flex-start;
  justify-content: center;
}
.cards-variant-markdown .cards-title {
  font-family: inherit;
  font-size: 62px;
  letter-spacing: 0;
  text-transform: none;
  color: #e6edf3;
  text-align: left;
  width: 100%;
  line-height: 1.15;
}
.cards-markdown-intro,
.cards-markdown-outro {
  width: 100%;
  font-family: inherit;
  font-size: 42px;
  line-height: 1.34;
  color: #cdd9e5;
  white-space: pre-line;
}
.cards-markdown-outro {
  color: #8b949e;
  border-left: 4px solid #58a6ff;
  padding-left: 28px;
}
.cards-variant-markdown .cards-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.cards-variant-markdown .cards-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  gap: 8px;
}
.cards-variant-markdown .cards-card-head {
  gap: 24px;
}
.cards-variant-markdown .cards-bullet {
  font-size: 46px;
  line-height: 1.18;
  color: #58a6ff;
  min-width: 30px;
}
.cards-variant-markdown .cards-label {
  font-family: inherit;
  font-size: 46px;
  font-weight: normal;
  color: #e6edf3;
  line-height: 1.2;
}
.cards-variant-markdown :deep(strong) {
  font-weight: 800;
}
.cards-variant-markdown :deep(em) {
  font-style: italic;
}
.cards-variant-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  color: #a5d6ff;
  background: rgba(88, 166, 255, 0.12);
  border-radius: 6px;
  margin: 0 0.04em;
  padding: 0 0.16em;
}
.cards-variant-markdown .cards-lines {
  margin-left: 64px;
  gap: 10px;
}
.cards-variant-markdown .cards-lines li {
  font-family: inherit;
  font-size: 36px;
  line-height: 1.25;
  color: #8b949e;
}
.cards-variant-markdown .cards-lines li::before {
  content: "–";
  color: #58a6ff;
  flex: none;
}

#cards-region.cards-variant-markdown.markdown-density-medium {
  gap: 30px;
}
.cards-variant-markdown.markdown-density-medium .cards-title { font-size: 52px; }
.cards-variant-markdown.markdown-density-medium .cards-markdown-intro,
.cards-variant-markdown.markdown-density-medium .cards-markdown-outro {
  font-size: 38px;
  line-height: 1.32;
}
.cards-variant-markdown.markdown-density-medium .cards-grid { gap: 20px; }
.cards-variant-markdown.markdown-density-medium .cards-bullet { font-size: 42px; }
.cards-variant-markdown.markdown-density-medium .cards-label {
  font-size: 40px;
  line-height: 1.22;
}
.cards-variant-markdown.markdown-density-medium .cards-lines li { font-size: 34px; }

#cards-region.cards-variant-markdown.markdown-density-dense {
  max-width: 1780px;
  gap: 28px;
}
.cards-variant-markdown.markdown-density-dense .cards-title { font-size: 62px; }
.cards-variant-markdown.markdown-density-dense .cards-markdown-intro,
.cards-variant-markdown.markdown-density-dense .cards-markdown-outro {
  font-size: 38px;
  line-height: 1.28;
}
.cards-variant-markdown.markdown-density-dense .cards-grid { gap: 18px; }
.cards-variant-markdown.markdown-density-dense .cards-card { gap: 6px; }
.cards-variant-markdown.markdown-density-dense .cards-card-head { gap: 18px; }
.cards-variant-markdown.markdown-density-dense .cards-bullet {
  font-size: 42px;
  line-height: 1.16;
  min-width: 26px;
}
.cards-variant-markdown.markdown-density-dense .cards-label {
  font-size: 42px;
  line-height: 1.2;
}
.cards-variant-markdown.markdown-density-dense .cards-lines {
  margin-left: 48px;
  gap: 6px;
}
.cards-variant-markdown.markdown-density-dense .cards-lines li {
  font-size: 34px;
  line-height: 1.22;
}

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
