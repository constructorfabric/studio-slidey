<script setup>
import { store } from '../store.js';

function roleLabel(m) {
  return m.role === 'bot' ? '· bot' : (m.role === 'dev' ? '· dev' : '');
}
</script>

<template>
  <div id="thread-region" class="scene-region active">
    <div id="thread-title" class="reveal" :class="{ shown: store.isRevealed('thread-title') }">{{ store.scene.title || '' }}</div>
    <div id="thread-panels">
      <div
        v-for="(p, i) in (store.scene.panels || [])"
        :key="i"
        :id="`thread-panel-${i}`"
        class="thread-panel reveal"
        :class="{ shown: store.isRevealed(`thread-panel-${i}`) }"
      >
        <div class="thread-header">
          <span class="thread-system" :class="`thread-system-${p.system || 'jira'}`">{{ p.system || '' }}</span>
          <template v-if="p.ref"><span class="thread-sep">·</span><span class="thread-ref">{{ p.ref }}</span></template>
          <span v-if="p.stage" class="thread-stage">{{ p.stage }}</span>
        </div>
        <div class="thread-messages">
          <div v-for="(m, j) in (p.messages || [])" :key="j" class="thread-message">
            <div class="thread-author" :class="`thread-author-${m.role || 'dev'}`">{{ m.author || '' }}<span v-if="roleLabel(m)" class="thread-author-role">{{ roleLabel(m) }}</span></div>
            <div class="thread-body">{{ m.body || '' }}</div>
          </div>
        </div>
      </div>
    </div>
    <div id="thread-caption" class="reveal" :class="{ shown: store.isRevealed('thread-caption') }">{{ store.scene.caption || '' }}</div>
  </div>
</template>
