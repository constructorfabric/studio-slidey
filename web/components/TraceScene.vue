<script setup>
import { store } from '../store.js';

function isHit(l) { return (l.result || '').toUpperCase() === 'HIT'; }
</script>

<template>
  <div id="trace-region" class="scene-region active">
    <div id="trace-title" class="reveal" :class="{ shown: store.isRevealed('trace-title') }">{{ store.scene.title || '' }}</div>
    <div id="trace-turns">
      <div
        v-for="(t, i) in (store.scene.turns || [])"
        :key="i"
        :id="`trace-turn-${i}`"
        class="trace-turn reveal"
        :class="{ shown: store.isRevealed(`trace-turn-${i}`) }"
      >
        <div class="trace-turn-header"><span class="trace-turn-label">TURN {{ i + 1 }}</span></div>
        <div class="trace-turn-user">{{ t.user || '' }}</div>
        <div class="trace-turn-layers">
          <div
            v-for="(l, j) in (t.layers || [])"
            :key="j"
            class="trace-layer"
            :class="isHit(l) ? 'trace-layer-hit' : 'trace-layer-miss'"
          >
            <span class="trace-layer-dot">▸</span>
            <span class="trace-layer-name">{{ l.name || '' }}</span>
            <span class="trace-layer-dots">···</span>
            <span class="trace-layer-result">{{ l.result || '' }}</span>
            <span v-if="l.ms" class="trace-layer-ms">{{ l.ms }} ms</span>
          </div>
        </div>
        <div v-if="t.intent" class="trace-turn-intent">→ intent: <code>{{ t.intent }}</code><span v-if="t.no_llm" class="trace-no-llm">no LLM call</span></div>
      </div>
    </div>
    <div id="trace-caption" class="reveal" :class="{ shown: store.isRevealed('trace-caption') }">{{ store.scene.caption || '' }}</div>
  </div>
</template>
