<script setup>
import { computed, inject } from 'vue';
import { store } from '../store.js';
import { normalizeReference } from '../reference-viewer.js';

const sc = computed(() => store.scene || {});
const shown = name => store.isRevealed(name);
const src = computed(() => store.imageDataUri || sc.value.dataUri || sc.value.src || '');
const fit = computed(() => sc.value.fit === 'cover' ? 'cover' : 'contain');
const frameStyle = computed(() => ({
  height: sc.value.frameHeight || undefined,
}));
const mediaStyle = computed(() => ({
  background: sc.value.mediaBackground || undefined,
  padding: sc.value.mediaPadding || undefined,
}));
const refsApi = inject('slideyReferences', null);
const imageReference = computed(() => normalizeReference(
  sc.value.reference || { src: sc.value.src, label: sc.value.alt || sc.value.title || 'image', kind: 'image' },
));
const hasImageReference = computed(() => !!imageReference.value && !!refsApi && !!refsApi.open);

function openImageReference() {
  if (hasImageReference.value) refsApi.open(imageReference.value);
}
</script>

<template>
  <div id="image-region" class="scene-region active">
    <div
      v-if="sc.title"
      id="image-title"
      class="image-title reveal"
      :class="{ shown: shown('image-title') }"
      data-edit-path='["title"]'
    >{{ sc.title }}</div>

    <div
      id="image-frame"
      class="image-frame reveal"
      :class="{ shown: shown('image-frame'), 'is-clickable-reference': hasImageReference }"
      data-embed-field="src"
      data-embed-label="image"
      :style="frameStyle"
      :title="hasImageReference ? `Open ${imageReference.label}` : undefined"
      role="button"
      tabindex="0"
      data-slidey-reference-trigger
      @click.stop="openImageReference"
      @keydown.enter.stop.prevent="openImageReference"
      @keydown.space.stop.prevent="openImageReference"
    >
      <img
        v-if="src"
        class="image-media"
        :class="`image-fit-${fit}`"
        :style="mediaStyle"
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
      data-edit-path='["caption"]'
      data-edit-multiline
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
.image-frame.is-clickable-reference {
  cursor: zoom-in;
}
.image-frame.is-clickable-reference:hover {
  border-color: #58a6ff;
  box-shadow: 0 0 0 2px rgb(88 166 255 / 20%);
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
