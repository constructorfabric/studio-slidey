<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

// Caps — keep the table inside the 1920x1080 stage. The scene module and
// sceneSteps.mjs only ever emit body-row reveal steps for rows[0..MAX_ROWS-1],
// so any rows/columns past the cap are clipped here to stay in sync (a
// --check-friendly invariant: rendered row count === revealed-step count).
const MAX_COLS = 6;
const MAX_ROWS = 8;

const variant = computed(() => store.scene?.variant || 'data');
const columns = computed(() => (store.scene?.columns || []).slice(0, MAX_COLS));
const rows = computed(() => (store.scene?.rows || []).slice(0, MAX_ROWS));
const winner = computed(() => {
  const w = store.scene?.winner;
  return (typeof w === 'number' && w >= 0 && w < columns.value.length) ? w : -1;
});

// data variant: right-align numeric cells. A cell is numeric when, stripped of
// common formatting (%, $, commas, spaces, leading +/-), it parses as a number.
function isNumeric(cell) {
  if (cell == null) return false;
  const s = String(cell).trim().replace(/[%$,\s]/g, '');
  if (s === '') return false;
  return !Number.isNaN(Number(s));
}

// comparison/scorecard: render ✓ / ✗ glyphs in colour; everything else verbatim.
function glyphClass(cell) {
  const s = String(cell ?? '').trim();
  if (s === '✓' || s === '✔') return 'table-yes';
  if (s === '✗' || s === '✘' || s === '✕') return 'table-no';
  return '';
}

// Per-column highlight: scorecard always highlights the winner column; any
// variant may flag a favoured column per-row via row.highlight === colIndex,
// and scene.winner highlights a whole column for comparison/scorecard.
function colHighlighted(colIndex) {
  if (variant.value !== 'scorecard' && variant.value !== 'comparison') return false;
  return colIndex === winner.value;
}

function alignClass(cell, colIndex) {
  // comparison/scorecard: first column is the criterion → left; glyph/short
  // cells centre. data: numerics right, text left.
  if (variant.value === 'data') return isNumeric(cell) ? 'table-right' : 'table-left';
  if (colIndex === 0) return 'table-left';
  return 'table-center';
}
</script>

<template>
  <div id="table-region" class="scene-region active" :class="`table-variant-${variant}`">
    <div
      id="table-title"
      class="reveal"
      :class="{ shown: store.isRevealed('table-title') }"
    >{{ store.scene.title || '' }}</div>

    <div class="table-frame">
      <table class="table-grid">
        <thead>
          <tr
            id="table-header"
            class="table-header-row reveal"
            :class="{ shown: store.isRevealed('table-header') }"
          >
            <th
              v-for="(c, ci) in columns"
              :key="ci"
              :class="[
                ci === 0 ? 'table-left' : (variant === 'data' ? 'table-th-data' : 'table-center'),
                { 'table-col-win': colHighlighted(ci), 'table-th-crown': variant === 'scorecard' && ci === winner }
              ]"
            >
              <span v-if="variant === 'scorecard' && ci === winner" class="table-crown">▸ </span>{{ c }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, ri) in rows"
            :key="ri"
            :id="`table-row-${ri}`"
            class="table-body-row reveal"
            :class="[{ shown: store.isRevealed(`table-row-${ri}`) }, ri % 2 === 1 ? 'table-zebra' : '']"
          >
            <td
              v-for="(cell, ci) in (r.cells || []).slice(0, MAX_COLS)"
              :key="ci"
              :class="[
                alignClass(cell, ci),
                glyphClass(cell),
                {
                  'table-col-win': colHighlighted(ci),
                  'table-row-hi': typeof r.highlight === 'number' && r.highlight === ci,
                  'table-criterion': ci === 0 && variant !== 'data'
                }
              ]"
            >{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      id="table-caption"
      class="reveal"
      :class="{ shown: store.isRevealed('table-caption') }"
    >{{ store.scene.caption || '' }}</div>
  </div>
</template>

<style scoped>
/* All colours below are verbatim from web/styles/template.css design tokens —
   no new colours introduced. Scoped so nothing else is touched. */
#table-region {
  gap: 36px;
  max-width: 1700px;
  width: 100%;
  margin: 0 auto;
}

#table-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.table-frame {
  width: 100%;
  max-width: 1600px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 14px;
  overflow: hidden;
}

.table-grid {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
}

/* Table rows reveal by fade only. The global `.reveal` helper adds
   `transform: translateY(8px)` to un-shown elements; on a table row inside this
   tight `overflow:hidden` frame that pushes the row 8px down, past the clip
   (the geometry audit flags it as box-overflow on every step). Opacity-only
   keeps every row flush within the frame. Title/caption sit outside the frame
   and keep the slide-up. */
.table-grid .reveal { transform: none; }

.table-grid th,
.table-grid td {
  padding: 22px 34px;
  font-size: 32px;
  color: #e6edf3;
  border-bottom: 1px solid #21262d;
  vertical-align: middle;
}

.table-header-row th {
  font-size: 26px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8b949e;
  font-weight: bold;
  border-bottom: 2px solid #30363d;
  background: #0d1117;
}

.table-body-row:last-child td { border-bottom: none; }

/* data variant: zebra rows on panel bg #161b22 over the slightly darker base */
.table-zebra td { background: #161b22; }
.table-variant-data .table-body-row td { background: transparent; }
.table-variant-data .table-zebra td { background: #161b22; }

.table-left   { text-align: left; }
.table-right  { text-align: right; }
.table-center { text-align: center; }
.table-th-data { text-align: right; }

/* comparison / scorecard glyphs */
.table-yes { color: #3fb950; font-weight: bold; }
.table-no  { color: #f85149; font-weight: bold; }

/* first-column criterion label */
.table-criterion { color: #8b949e; }

/* favoured / winner column highlight */
.table-col-win { background: rgba(88, 166, 255, 0.10); }
.table-header-row th.table-col-win { background: rgba(88, 166, 255, 0.16); }

/* scorecard crowned header: accent the winning column header */
.table-th-crown {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.16);
}
.table-crown { color: #58a6ff; }

/* per-cell favoured highlight (row.highlight) */
.table-row-hi { color: #58a6ff; font-weight: bold; }

#table-caption {
  font-size: 28px;
  color: #8b949e;
  text-align: center;
  max-width: 1400px;
  margin: 0 auto;
  line-height: 1.5;
}
</style>
