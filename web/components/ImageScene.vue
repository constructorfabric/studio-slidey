<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const sc = computed(() => store.scene || {});
const shown = name => store.isRevealed(name);
const src = computed(() => store.imageDataUri || sc.value.dataUri || sc.value.src || '');
const fit = computed(() => sc.value.fit === 'cover' ? 'cover' : 'contain');
</script>

<template>
  <div id="image-region" class="scene-region active">
    <div
      v-if="sc.title"
      id="image-title"
      class="image-title reveal"
      :class="{ shown: shown('image-title') }"
    >{{ sc.title }}</div>

    <div
      id="image-frame"
      class="image-frame reveal"
      :class="{ shown: shown('image-frame') }"
    >
      <img
        v-if="src"
        class="image-media"
        :class="`image-fit-${fit}`"
        :src="src"
        :alt="sc.alt || sc.title || ''"
      />
      <div v-else class="image-missing">Missing image source</div>
    </div>

    <div
      v-if="sc.caption"
      id="image-caption"
      class="image-caption reveal"
      :class="{ shown: shown('image-caption') }"
    >{{ sc.caption }}</div>
  </div>
</template>

<style scoped>
#image-region {
  gap: 30px;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
}

.image-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.image-frame {
  width: 100%;
  height: 760px;
  border: 1px solid #30363d;
  border-radius: 14px;
  background: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.image-media {
  width: 100%;
  height: 100%;
  display: block;
}
.image-fit-contain { object-fit: contain; }
.image-fit-cover { object-fit: cover; }

.image-missing {
  color: #8b949e;
  font-size: 34px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.image-caption {
  font-size: 28px;
  color: #8b949e;
  text-align: center;
  max-width: 1400px;
  line-height: 1.5;
  margin: 0 auto;
}
</style>
