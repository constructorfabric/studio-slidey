<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import { buildPanels } from '../svg.js';

const panels = computed(() => buildPanels(store.scene));
const single = computed(() => (store.scene.panels || []).length === 1);
</script>

<template>
  <div id="diagramsvg-region" class="scene-region active">
    <div id="diagramsvg-title" class="reveal" :class="{ shown: store.isRevealed('diagramsvg-title') }">{{ store.scene.title || '' }}</div>
    <div id="diagramsvg-panels" :class="{ 'diagramsvg-panels-single': single }">
      <div
        v-for="(p, i) in panels"
        :key="i"
        :id="`diagramsvg-panel-${i}`"
        class="diagramsvg-panel reveal"
        :class="{ shown: store.isRevealed(`diagramsvg-panel-${i}`) }"
      >
        <div v-if="p.label" class="diagramsvg-panel-label">{{ p.label }}</div>
        <svg :viewBox="p.viewBox" xmlns="http://www.w3.org/2000/svg" class="diagramsvg-svg">
          <defs>
            <marker :id="p.markerId" class="dsvg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <!-- edges first so nodes render on top -->
          <template v-for="(e, j) in p.edges" :key="`e${j}`">
            <g v-if="e.type === 'gate'" class="dsvg-edge dsvg-edge-gate-edge">
              <line :x1="e.bar1.x1" :y1="e.bar1.y1" :x2="e.bar1.x2" :y2="e.bar1.y2" :class="e.barClass" />
              <line :x1="e.bar2.x1" :y1="e.bar2.y1" :x2="e.bar2.x2" :y2="e.bar2.y2" :class="e.barClass" />
              <text :class="e.textClass" :x="e.labelX" :y="e.labelY" text-anchor="middle" dominant-baseline="middle">{{ e.text }}</text>
            </g>
            <g v-else class="dsvg-edge">
              <line :x1="e.line.x1" :y1="e.line.y1" :x2="e.line.x2" :y2="e.line.y2" :marker-end="`url(#${e.markerId})`" />
              <text v-if="e.label" class="dsvg-edge-label" :x="e.labelX" :y="e.labelY" :text-anchor="e.anchor" dominant-baseline="middle">{{ e.label }}</text>
            </g>
          </template>
          <g v-for="(n, k) in p.nodes" :key="`n${k}`" :class="n.groupClass">
            <rect :x="n.rect.x" :y="n.rect.y" :width="n.rect.w" :height="n.rect.h" rx="14" ry="14" />
            <text v-for="(t, m) in n.texts" :key="m" :class="t.cls" :x="t.x" :y="t.y" text-anchor="middle" dominant-baseline="middle">{{ t.text }}</text>
          </g>
        </svg>
        <div v-if="p.caption" class="diagramsvg-panel-caption">{{ p.caption }}</div>
      </div>
    </div>
    <div id="diagramsvg-caption" class="reveal" :class="{ shown: store.isRevealed('diagramsvg-caption') }">{{ store.scene.caption || '' }}</div>
  </div>
</template>
