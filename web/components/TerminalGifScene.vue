<script setup>
import { store } from '../store.js';
</script>

<template>
  <div id="termgif-region" class="scene-region active">
    <div id="termgif-frame" class="termgif-frame reveal" :class="{ shown: store.isRevealed('termgif-frame') }">
      <div class="termgif-titlebar">
        <span class="termgif-dot r"></span>
        <span class="termgif-dot y"></span>
        <span class="termgif-dot g"></span>
        <span class="termgif-titlebar-title" id="termgif-titlebar-title">{{ store.scene.title || '' }}</span>
      </div>
      <img id="termgif-img" alt="" :src="store.gifDataUri || undefined">
    </div>
    <div id="termgif-caption" class="reveal" :class="{ shown: store.isRevealed('termgif-caption') }">{{ store.scene.caption || '' }}</div>
  </div>
</template>
