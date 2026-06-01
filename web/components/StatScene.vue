<script setup>
import { store } from '../store.js';
</script>

<template>
  <div id="stat-region" class="scene-region active">
    <div id="stat-value" class="reveal" :class="{ shown: store.isRevealed('stat-value') }">{{ store.scene.value || '' }}</div>
    <div id="stat-label" class="reveal" :class="{ shown: store.isRevealed('stat-label') }">{{ store.scene.label || '' }}</div>
    <div id="stat-detail" class="reveal" :class="{ shown: store.isRevealed('stat-detail') }">{{ store.scene.detail || '' }}</div>
  </div>
</template>
