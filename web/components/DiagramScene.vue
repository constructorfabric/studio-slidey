<script setup>
import { store } from '../store.js';
</script>

<template>
  <div id="diagram-region" class="scene-region active">
    <div id="diagram-title" class="reveal" :class="{ shown: store.isRevealed('diagram-title') }">{{ store.scene.title || '' }}</div>
    <div id="diagram-panels">
      <div
        v-for="(p, i) in (store.scene.panels || [])"
        :key="i"
        :id="`diagram-panel-${i}`"
        class="diagram-panel reveal"
        :class="{ shown: store.isRevealed(`diagram-panel-${i}`) }"
      >
        <div v-if="p.label" class="diagram-panel-label">{{ p.label }}</div>
        <pre class="diagram-panel-ascii">{{ p.ascii || '' }}</pre>
      </div>
    </div>
    <div id="diagram-caption" class="reveal" :class="{ shown: store.isRevealed('diagram-caption') }">{{ store.scene.caption || '' }}</div>
  </div>
</template>
