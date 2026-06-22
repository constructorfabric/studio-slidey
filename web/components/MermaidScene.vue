<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import mermaid from 'mermaid';
import { store } from '../store.js';

const scene = computed(() => store.scene || {});
const source = computed(() => String(scene.value.source || scene.value.code || '').trim());
const scale = computed(() => {
  const value = Number(scene.value.scale || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
});
const rendered = ref('');
const error = ref('');
let renderSerial = 0;

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function themeVariables() {
  return {
    background: 'transparent',
    primaryColor: cssVar('--slidey-surface', '#2a273f'),
    primaryTextColor: cssVar('--slidey-text', '#e0def4'),
    primaryBorderColor: cssVar('--slidey-highlight-high', '#56526e'),
    lineColor: cssVar('--slidey-iris', '#c4a7e7'),
    secondaryColor: cssVar('--slidey-overlay', '#393552'),
    tertiaryColor: cssVar('--slidey-base', '#232136'),
    clusterBkg: cssVar('--slidey-surface', '#2a273f'),
    clusterBorder: cssVar('--slidey-highlight-high', '#56526e'),
    edgeLabelBackground: cssVar('--slidey-background', '#232136'),
    fontFamily: cssVar('--slidey-font-family', 'ui-sans-serif, system-ui, sans-serif'),
    fontSize: '24px',
    nodeTextColor: cssVar('--slidey-text', '#e0def4'),
    textColor: cssVar('--slidey-text', '#e0def4'),
    titleColor: cssVar('--slidey-text', '#e0def4'),
    actorBkg: cssVar('--slidey-surface', '#2a273f'),
    actorBorder: cssVar('--slidey-highlight-high', '#56526e'),
    actorTextColor: cssVar('--slidey-text', '#e0def4'),
    signalColor: cssVar('--slidey-iris', '#c4a7e7'),
    signalTextColor: cssVar('--slidey-text', '#e0def4'),
    noteBkgColor: cssVar('--slidey-overlay', '#393552'),
    noteTextColor: cssVar('--slidey-text', '#e0def4'),
    noteBorderColor: cssVar('--slidey-highlight-high', '#56526e'),
  };
}

async function renderDiagram() {
  const serial = ++renderSerial;
  const diagram = source.value;
  rendered.value = '';
  error.value = '';
  if (!diagram) return;

  await nextTick();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    flowchart: { htmlLabels: false, curve: 'basis' },
    sequence: { mirrorActors: false, showSequenceNumbers: false },
  });

  let pending = null;
  try {
    const id = `slidey-mermaid-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    pending = mermaid.render(id, diagram);
    if (window.__slideyPendingRenders) window.__slideyPendingRenders.add(pending);
    const result = await pending;
    if (serial === renderSerial) rendered.value = result.svg;
  } catch (err) {
    if (serial === renderSerial) error.value = err && err.message ? err.message : String(err);
  } finally {
    if (pending && window.__slideyPendingRenders) window.__slideyPendingRenders.delete(pending);
  }
}

watch(source, renderDiagram, { immediate: true });
</script>

<template>
  <div id="mermaid-region" class="scene-region active mermaid-scene">
    <div
      v-if="scene.title"
      id="mermaid-title"
      class="mermaid-title reveal"
      :class="{ shown: store.isRevealed('mermaid-title') }"
    >{{ scene.title }}</div>
    <div
      id="mermaid-frame"
      class="mermaid-frame reveal"
      :class="{ shown: store.isRevealed('mermaid-frame') }"
    >
      <div
        v-if="rendered"
        class="mermaid-svg"
        :style="{ transform: `scale(${scale})` }"
        v-html="rendered"
      ></div>
      <pre v-else-if="error" class="mermaid-error">{{ error }}</pre>
    </div>
    <div
      v-if="scene.caption"
      id="mermaid-caption"
      class="mermaid-caption reveal"
      :class="{ shown: store.isRevealed('mermaid-caption') }"
    >{{ scene.caption }}</div>
  </div>
</template>

<style scoped>
.mermaid-scene.active {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 20px;
  align-items: stretch;
  justify-items: center;
}

.mermaid-title {
  font-size: 46px;
  font-weight: 800;
  color: var(--slidey-rose, #ffb4a8);
  letter-spacing: 0;
}

.mermaid-frame {
  width: min(1680px, 100%);
  height: 100%;
  box-sizing: border-box;
  min-height: 0;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 8px;
  background: rgba(255,255,255,.04);
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 20px;
}

.mermaid-svg {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  place-items: center;
}

.mermaid-svg :deep(svg) {
  max-width: 100% !important;
  max-height: 100% !important;
  width: 100% !important;
  height: 100% !important;
}

.mermaid-svg :deep(.label),
.mermaid-svg :deep(.nodeLabel),
.mermaid-svg :deep(.edgeLabel),
.mermaid-svg :deep(.messageText),
.mermaid-svg :deep(.actor),
.mermaid-svg :deep(.loopText),
.mermaid-svg :deep(.noteText) {
  font-family: var(--slidey-font-family, ui-sans-serif, system-ui, sans-serif) !important;
}

.mermaid-caption {
  font-size: 24px;
  line-height: 1.35;
  color: var(--slidey-subtle, rgba(255,255,255,.74));
}

.mermaid-error {
  max-width: 100%;
  white-space: pre-wrap;
  color: var(--slidey-love, #eb6f92);
  font-size: 22px;
  line-height: 1.35;
}
</style>
