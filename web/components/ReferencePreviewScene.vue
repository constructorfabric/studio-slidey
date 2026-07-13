<script setup>
import { computed, inject, ref, watch } from 'vue';
import { store } from '../store.js';
import {
  extractReferenceSnippet,
  normalizeReference,
  renderMarkdownHTML,
  renderNumberedTextHTML,
} from '../reference-viewer.js';

const refsApi = inject('slideyReferences', null);
const scene = computed(() => store.scene || {});
const rawReference = computed(() => scene.value.reference || scene.value.ref || scene.value);
const reference = computed(() => normalizeReference(rawReference.value, { label: scene.value.title || 'reference' }) || {});
const resolvedReference = computed(() => refsApi && refsApi.resolve ? refsApi.resolve(reference.value) : reference.value);
const kind = computed(() => reference.value.kind || 'file');
const title = computed(() => scene.value.title || reference.value.label || reference.value.src || 'Reference');
const loading = ref(false);
const error = ref('');
const text = ref('');
const snippet = ref({ text: '', startLine: 1, endLine: 1 });
const canFetchText = computed(() => !['image', 'video'].includes(kind.value));
const shown = name => store.isRevealed(name);

const bodyHTML = computed(() => {
  if (kind.value === 'markdown') return renderMarkdownHTML(snippet.value.text);
  return renderNumberedTextHTML(snippet.value.text, kind.value, reference.value.lang || '', {
    ...reference.value,
    previewStartLine: snippet.value.startLine,
  });
});

function open() {
  if (refsApi && refsApi.open) refsApi.open(reference.value);
}

watch(resolvedReference, async (next) => {
  text.value = '';
  error.value = '';
  snippet.value = { text: '', startLine: 1, endLine: 1 };
  if (!next || !canFetchText.value) return;
  if (typeof next.inline === 'string') {
    text.value = next.inline;
    snippet.value = extractReferenceSnippet(text.value, reference.value, scene.value.previewLines || 14);
    return;
  }
  if (!next.href) return;
  loading.value = true;
  try {
    const res = await fetch(next.href);
    if (!res.ok) throw new Error(`${res.status} fetching ${next.src || next.href}`);
    text.value = await res.text();
    snippet.value = extractReferenceSnippet(text.value, reference.value, scene.value.previewLines || 14);
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    loading.value = false;
  }
}, { immediate: true });
</script>

<template>
  <div id="reference-region" class="scene-region active" :data-kind="kind">
    <div
      v-if="title"
      id="reference-title"
      class="reference-title reveal"
      :class="{ shown: shown('reference-title') }"
      data-edit-path='["title"]'
    >{{ title }}</div>

    <div
      id="reference-frame"
      class="reference-frame reveal"
      :class="{ shown: shown('reference-frame') }"
      :title="`Open ${reference.label || title}`"
      role="button"
      tabindex="0"
      data-slidey-reference-trigger
      @click.stop="open"
      @keydown.enter.stop.prevent="open"
      @keydown.space.stop.prevent="open"
    >
      <div class="reference-frame-head">
        <span class="reference-kind">{{ kind }}</span>
        <span class="reference-label">{{ reference.label || reference.src }}</span>
        <span v-if="reference.lineStart" class="reference-range">L{{ reference.lineStart }}-{{ reference.lineEnd || reference.lineStart }}</span>
      </div>

      <div v-if="loading" class="reference-status">Loading reference...</div>
      <div v-else-if="error" class="reference-status reference-error">{{ error }}</div>
      <img
        v-else-if="kind === 'image'"
        class="reference-media"
        :src="resolvedReference.href"
        :alt="reference.label || title"
      />
      <video
        v-else-if="kind === 'video'"
        class="reference-media"
        :src="resolvedReference.href"
        muted
        playsinline
      ></video>
      <article
        v-else-if="kind === 'markdown'"
        class="reference-markdown"
        v-html="bodyHTML"
      ></article>
      <pre
        v-else
        class="reference-pre slidey-ref-numbered"
        :data-lang="reference.lang || kind"
      ><code v-html="bodyHTML"></code></pre>
    </div>

    <div
      v-if="scene.caption"
      id="reference-caption"
      class="reference-caption reveal"
      :class="{ shown: shown('reference-caption') }"
      data-edit-path='["caption"]'
      data-edit-multiline
    >{{ scene.caption }}</div>
  </div>
</template>

<style scoped>
#reference-region {
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
  gap: 22px;
  text-align: left;
}

.reference-title {
  font-size: 34px;
  font-weight: bold;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.reference-frame {
  width: 100%;
  height: 740px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  border: 1px solid #30363d;
  border-radius: 10px;
  background: #0d1117;
  color: #e6edf3;
  text-align: left;
  cursor: zoom-in;
}

.reference-frame:hover {
  border-color: #58a6ff;
  box-shadow: 0 0 0 2px rgb(88 166 255 / 24%);
}

.reference-frame-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 18px;
  border-bottom: 1px solid #30363d;
  background: #161b22;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.reference-kind {
  color: #79c0ff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.reference-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #c9d1d9;
  font-size: 18px;
}

.reference-range {
  margin-left: auto;
  color: #8b949e;
  font-size: 15px;
}

.reference-status {
  padding: 26px;
  color: #8b949e;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 24px;
}

.reference-error {
  color: #ffb4ad;
}

.reference-media {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  background: #000;
}

.reference-markdown {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 24px 30px;
  color: #c9d1d9;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 25px;
  line-height: 1.42;
}

.reference-markdown :deep(h1),
.reference-markdown :deep(h2),
.reference-markdown :deep(h3) {
  margin: 0 0 0.5em;
  color: #f0f6fc;
  line-height: 1.16;
}

.reference-markdown :deep(p),
.reference-markdown :deep(ul) {
  margin: 0 0 0.7em;
}

.reference-pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  padding: 22px 24px;
  background: #060b12;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 24px;
  line-height: 1.34;
  white-space: pre;
}

.reference-caption {
  color: #8b949e;
  font-size: 24px;
  line-height: 1.4;
  text-align: center;
}
</style>
