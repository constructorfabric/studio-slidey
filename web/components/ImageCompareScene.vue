<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const sc = computed(() => store.scene || {});
const shown = name => store.isRevealed(name);
const left = computed(() => sc.value.left || {});
const right = computed(() => sc.value.right || {});
const leftSrc = computed(() => store.leftImageDataUri || left.value.dataUri || left.value.src || '');
const rightSrc = computed(() => store.rightImageDataUri || right.value.dataUri || right.value.src || '');
const fit = computed(() => sc.value.fit === 'cover' ? 'cover' : 'contain');
const variant = computed(() => sc.value.variant === 'qa' ? 'qa' : 'default');
</script>

<template>
  <div
    id="imagecompare-region"
    class="scene-region active"
    :class="`imagecompare-variant-${variant}`"
  >
    <div
      v-if="sc.title"
      id="imagecompare-title"
      class="imagecompare-title reveal"
      :class="{ shown: shown('imagecompare-title') }"
    >{{ sc.title }}</div>

    <div
      id="imagecompare-frame"
      class="imagecompare-frame reveal"
      :class="{ shown: shown('imagecompare-frame') }"
    >
      <figure class="imagecompare-panel">
        <figcaption>{{ left.label || 'Old' }}</figcaption>
        <img
          v-if="leftSrc"
          class="imagecompare-media"
          :class="`imagecompare-fit-${fit}`"
          :src="leftSrc"
          :alt="left.alt || left.label || 'Old'"
        />
        <div v-else class="imagecompare-missing">Missing image source</div>
      </figure>
      <figure class="imagecompare-panel">
        <figcaption>{{ right.label || 'New' }}</figcaption>
        <img
          v-if="rightSrc"
          class="imagecompare-media"
          :class="`imagecompare-fit-${fit}`"
          :src="rightSrc"
          :alt="right.alt || right.label || 'New'"
        />
        <div v-else class="imagecompare-missing">Missing image source</div>
      </figure>
    </div>

    <div
      v-if="sc.caption"
      id="imagecompare-caption"
      class="imagecompare-caption reveal"
      :class="{ shown: shown('imagecompare-caption') }"
    >{{ sc.caption }}</div>
  </div>
</template>

<style scoped>
#imagecompare-region {
  gap: 16px;
  width: 100%;
  max-width: 1840px;
  height: 100%;
  margin: 0 auto;
  padding: 8px 0;
}

.imagecompare-title {
  flex-shrink: 0;
  font-size: 28px;
  font-weight: bold;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
  max-width: 1760px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.imagecompare-frame {
  width: 100%;
  height: min(902px, calc(100% - 86px));
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.imagecompare-panel {
  min-width: 0;
  min-height: 0;
  margin: 0;
  border: 1px solid #30363d;
  border-radius: 8px;
  background: #0d1117;
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  overflow: hidden;
}

.imagecompare-panel figcaption {
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #30363d;
  background: #161b22;
  color: #cdd9e5;
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.imagecompare-media {
  width: 100%;
  height: 100%;
  display: block;
  background: #0d1117;
}

.imagecompare-fit-contain { object-fit: contain; }
.imagecompare-fit-cover { object-fit: cover; }

.imagecompare-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
  font-size: 24px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.imagecompare-caption {
  flex-shrink: 0;
  font-size: 20px;
  color: #8b949e;
  text-align: center;
  max-width: 1500px;
  line-height: 1.28;
  margin: 0 auto;
}

.imagecompare-variant-qa {
  gap: 10px;
  max-width: 1880px;
  padding: 0;
}

.imagecompare-variant-qa .imagecompare-title {
  font-size: 22px;
  letter-spacing: 0.1em;
}

.imagecompare-variant-qa .imagecompare-frame {
  height: min(944px, calc(100% - 60px));
  gap: 12px;
}

.imagecompare-variant-qa .imagecompare-panel {
  border-radius: 4px;
  grid-template-rows: 28px minmax(0, 1fr);
}

.imagecompare-variant-qa .imagecompare-panel figcaption {
  font-size: 13px;
  letter-spacing: 0.08em;
}

.imagecompare-variant-qa .imagecompare-caption {
  font-size: 16px;
  line-height: 1.2;
}
</style>
