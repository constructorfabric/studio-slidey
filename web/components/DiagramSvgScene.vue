<script setup>
import { computed, ref, watch, nextTick, onMounted, onUpdated } from 'vue';
import { store } from '../store.js';
import { buildPanels } from '../svg.js';

// sizeOverrides: measured node dimensions from the getBBox pass.
// Keyed by node id → {w, h}. Passed to buildPanels so dagre re-runs
// with actual text dimensions on pass 2.
const sizeOverrides = ref({});
// layoutGen: prevents infinite update loops. Resets on scene change.
const layoutGen     = ref(0);

const panels = computed(() => buildPanels(store.scene, sizeOverrides.value));
const single = computed(() => (store.scene.panels || []).length === 1);

// Serialize a scene-relative JSON path for the in-place text editor (inline-edit.js).
const ep = (arr) => (arr ? JSON.stringify(arr) : null);

function openNodeLink(node, event) {
  if (!node || !node.link) return;
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(new CustomEvent('slidey:library-link', { detail: node.link }));
}

function onNodeLinkKey(node, event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  openNodeLink(node, event);
}

// Reset overrides whenever the scene changes so each new scene starts fresh.
watch(() => store.scene, () => {
  sizeOverrides.value = {};
  layoutGen.value     = 0;
});

// ---------------------------------------------------------------------------
// Feature A — auto-size + two-pass feedback loop
//
// After each render:
//   1. Walk every node group, measure actual text bounding box via getBBox().
//   2. Expand the <rect> (and re-center texts) if the text overflows.
//   3. If any node expanded AND we haven't hit the pass limit, feed the
//      measured sizes back into sizeOverrides. Vue recomputes panels →
//      dagre re-runs with real dimensions → final layout is correct.
// ---------------------------------------------------------------------------
const svgRoots = ref([]);
const H_PAD = 52;  // horizontal padding inside node box (26px each side)
const V_PAD = 40;  // vertical padding inside node box (20px each side)
const MAX_PASSES = 2;

function autoSizeNodes() {
  const newOverrides = {};
  let anyExpanded   = false;

  for (const wrapperEl of svgRoots.value) {
    if (!wrapperEl) continue;
    const svg = wrapperEl.querySelector('svg.diagramsvg-svg');
    if (!svg) continue;

    for (const nodeGroup of svg.querySelectorAll('g.dsvg-node')) {
      const rectEl = nodeGroup.querySelector('rect');
      if (!rectEl) continue;
      const nodeId = nodeGroup.dataset.nodeId;
      if (!nodeId) continue;

      const texts = nodeGroup.querySelectorAll('text');
      if (!texts.length) continue;

      // Measure the aggregate bounding box of all text elements.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of texts) {
        try {
          const bb = t.getBBox();
          if (bb.width === 0 && bb.height === 0) continue;
          minX = Math.min(minX, bb.x);
          minY = Math.min(minY, bb.y);
          maxX = Math.max(maxX, bb.x + bb.width);
          maxY = Math.max(maxY, bb.y + bb.height);
        } catch (_) { /* getBBox can throw in hidden elements */ }
      }
      if (!isFinite(minX)) continue;

      const requiredW = (maxX - minX) + H_PAD;
      const requiredH = (maxY - minY) + V_PAD;

      const curW = parseFloat(rectEl.getAttribute('width'));
      const curH = parseFloat(rectEl.getAttribute('height'));
      const newW = Math.max(curW, requiredW);
      const newH = Math.max(curH, requiredH);

      // Always record the measured size so dagre gets it on the next pass.
      newOverrides[nodeId] = { w: Math.ceil(newW), h: Math.ceil(newH) };

      if (newW > curW + 1 || newH > curH + 1) {
        anyExpanded = true;

        // Immediately expand the DOM rect and re-center texts — this makes
        // pass 1 look correct even before dagre re-runs on pass 2.
        const curX = parseFloat(rectEl.getAttribute('x'));
        const curY = parseFloat(rectEl.getAttribute('y'));
        rectEl.setAttribute('width',  newW);
        rectEl.setAttribute('height', newH);
        const dx = (newW - curW) / 2;
        const dy = (newH - curH) / 2;
        for (const t of texts) {
          t.setAttribute('x', parseFloat(t.getAttribute('x')) + dx);
          t.setAttribute('y', parseFloat(t.getAttribute('y')) + dy);
        }
      }
    }
  }

  // Feed measurements back into dagre if anything changed and we have passes left.
  if (anyExpanded && layoutGen.value < MAX_PASSES) {
    layoutGen.value++;
    sizeOverrides.value = { ...sizeOverrides.value, ...newOverrides };
    // Vue reactively re-computes panels → dagre re-runs → onUpdated fires again.
  }
}

onMounted(async () => { await nextTick(); autoSizeNodes(); });
onUpdated(async () => { await nextTick(); autoSizeNodes(); });
</script>

<template>
  <div id="diagramsvg-region" class="scene-region active">
    <div id="diagramsvg-title" class="reveal" :class="{ shown: store.isRevealed('diagramsvg-title') || store.scene?.skipTitle }" data-edit-path='["title"]'>{{ store.scene.title || '' }}</div>
    <div id="diagramsvg-panels" :class="{ 'diagramsvg-panels-single': single }">
      <div
        v-for="(p, i) in panels"
        :key="i"
        :id="`diagramsvg-panel-${i}`"
        class="diagramsvg-panel reveal"
        :class="{ shown: store.isRevealed(`diagramsvg-panel-${i}`) }"
        :ref="el => { svgRoots[i] = el }"
      >
        <div v-if="p.label" class="diagramsvg-panel-label" :data-edit-path="ep(['panels', i, 'label'])">{{ p.label }}</div>
        <svg :viewBox="p.viewBox" xmlns="http://www.w3.org/2000/svg" class="diagramsvg-svg">
          <defs>
            <marker :id="p.markerId" class="dsvg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker :id="`arrow-back-${i}`" class="dsvg-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker :id="`arrow-recycle-${i}`" class="dsvg-arrow-recycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker :id="p.cycleMarkerId" class="dsvg-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="46" markerHeight="46" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <g v-for="(a, c) in p.cycleArrows || []" :key="`c${c}`" class="dsvg-cycle-arrow">
            <text v-if="a.glyph" class="dsvg-cycle-glyph" :x="a.glyphX" :y="a.glyphY" text-anchor="middle" dominant-baseline="middle" :style="{ fontSize: `${a.glyphSize}px` }">{{ a.glyph }}</text>
            <ellipse v-if="a.ellipse" class="dsvg-cycle-guide" :cx="a.ellipse.cx" :cy="a.ellipse.cy" :rx="a.ellipse.rx" :ry="a.ellipse.ry" />
            <path :d="a.d" :marker-end="`url(#${a.markerId})`" />
            <text v-if="a.label" class="dsvg-edge-label dsvg-cycle-label" :x="a.labelX" :y="a.labelY" text-anchor="middle" dominant-baseline="middle">{{ a.label }}</text>
          </g>
          <!-- edges first so nodes render on top -->
          <template v-for="(e, j) in p.edges" :key="`e${j}`">
            <g v-if="e.type === 'gate'" class="dsvg-edge dsvg-edge-gate-edge">
              <line :x1="e.bar1.x1" :y1="e.bar1.y1" :x2="e.bar1.x2" :y2="e.bar1.y2" :class="e.barClass" />
              <line :x1="e.bar2.x1" :y1="e.bar2.y1" :x2="e.bar2.x2" :y2="e.bar2.y2" :class="e.barClass" />
              <text :class="e.textClass" :x="e.labelX" :y="e.labelY" text-anchor="middle" dominant-baseline="middle" :data-edit-path="ep(e.editPath)">{{ e.text }}</text>
            </g>
            <g v-else-if="e.type === 'elbow'" :class="e.groupClass || 'dsvg-edge'">
              <path :d="e.d" :marker-end="`url(#${e.markerId})`" />
              <text v-if="e.label" class="dsvg-edge-label" :x="e.labelX" :y="e.labelY" :text-anchor="e.labelAnchor || 'middle'" dominant-baseline="middle" :data-edit-path="ep(e.editPath)">{{ e.label }}</text>
            </g>
            <g v-else class="dsvg-edge">
              <line :x1="e.line.x1" :y1="e.line.y1" :x2="e.line.x2" :y2="e.line.y2" :marker-end="`url(#${e.markerId})`" />
              <text v-if="e.label" class="dsvg-edge-label" :x="e.labelX" :y="e.labelY" :text-anchor="e.anchor" dominant-baseline="middle" :data-edit-path="ep(e.editPath)">{{ e.label }}</text>
            </g>
          </template>
          <!-- data-node-id is read by autoSizeNodes to key size measurements -->
          <g
            v-for="(n, k) in p.nodes"
            :key="`n${k}`"
            :class="[n.groupClass, { 'dsvg-node-link slidey-library-link': n.link }]"
            :data-node-id="n.id"
            :role="n.link ? 'button' : null"
            :tabindex="n.link ? 0 : null"
            :focusable="n.link ? 'true' : null"
            :aria-label="n.link ? `Open ${n.link.label}` : null"
            @click="openNodeLink(n, $event)"
            @keydown="onNodeLinkKey(n, $event)"
          >
            <rect :x="n.rect.x" :y="n.rect.y" :width="n.rect.w" :height="n.rect.h" rx="14" ry="14" />
            <text v-for="(t, m) in n.texts" :key="m" :class="t.cls" :x="t.x" :y="t.y" text-anchor="middle" dominant-baseline="middle" :data-edit-path="ep(t.editPath)">{{ t.text }}</text>
          </g>
        </svg>
        <div v-if="p.caption" class="diagramsvg-panel-caption" :data-edit-path="ep(['panels', i, 'caption'])">{{ p.caption }}</div>
      </div>
    </div>
    <div id="diagramsvg-caption" class="reveal" :class="{ shown: store.isRevealed('diagramsvg-caption') }" data-edit-path='["caption"]'>{{ store.scene.caption || '' }}</div>
  </div>
</template>
