<script setup>
import { store } from '../store.js';
</script>

<template>
  <div id="cta-region" class="scene-region active">
    <div id="cta-wordmark" class="reveal" :class="{ shown: store.isRevealed('cta-wordmark') }">{{ store.scene.wordmark || '' }}</div>
    <div id="cta-tagline" class="reveal" :class="{ shown: store.isRevealed('cta-tagline') }">{{ store.scene.tagline || '' }}</div>
    <div id="cta-url" class="reveal" :class="{ shown: store.isRevealed('cta-url') }">{{ store.scene.url || '' }}</div>
  </div>
</template>
