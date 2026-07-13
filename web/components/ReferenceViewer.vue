<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { renderMarkdownHTML, renderNumberedTextHTML, renderTextHTML } from '../reference-viewer.js';

const props = defineProps({
  reference: { type: Object, default: null },
  close: { type: Function, required: true },
  openExternal: { type: Function, default: null },
});

const loading = ref(false);
const error = ref('');
const text = ref('');

const refData = computed(() => props.reference || {});
const kind = computed(() => refData.value.kind || 'file');
const title = computed(() => refData.value.label || refData.value.src || 'Reference');
const openLabel = computed(() => kind.value === 'diff' ? 'View Diff' : 'Open');
const canFetchText = computed(() => !['image', 'video', 'html'].includes(kind.value));
const bodyHTML = computed(() => {
  if (kind.value === 'markdown') return renderMarkdownHTML(text.value);
  return renderTextHTML(text.value, kind.value, refData.value.lang || '');
});
const numberedHTML = computed(() =>
  renderNumberedTextHTML(text.value, kind.value, refData.value.lang || '', refData.value));

watch(() => props.reference, async (next) => {
  text.value = '';
  error.value = '';
  if (!next) return;
  if (typeof next.inline === 'string') {
    text.value = next.inline;
    return;
  }
  if (!canFetchText.value || !next.href) return;
  loading.value = true;
  try {
    const res = await fetch(next.href);
    if (!res.ok) throw new Error(`${res.status} fetching ${next.src || next.href}`);
    text.value = await res.text();
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    loading.value = false;
  }
}, { immediate: true });

function onKey(e) {
  if (e.key === 'Escape' && props.reference) props.close();
}

function openReference() {
  if (props.openExternal) props.openExternal(refData.value);
  else if (refData.value.href) window.open(refData.value.href, '_blank', 'noopener,noreferrer');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="reference" class="slidey-ref-backdrop" @click.self="close">
      <section class="slidey-ref-viewer" :class="`slidey-ref-kind-${kind}`" role="dialog" aria-modal="true" :aria-label="title">
        <header class="slidey-ref-head">
          <div class="slidey-ref-titlewrap">
            <div class="slidey-ref-title">{{ title }}</div>
            <div class="slidey-ref-src">{{ refData.src }}</div>
          </div>
          <button
            v-if="refData.href"
            type="button"
            class="slidey-ref-open"
            :title="kind === 'diff' ? 'View diff externally' : 'Open reference'"
            @click="openReference"
          >{{ openLabel }}</button>
          <button type="button" class="slidey-ref-close" title="Close reference" aria-label="Close reference" @click="close">×</button>
        </header>

        <div class="slidey-ref-body">
          <div v-if="loading" class="slidey-ref-status">Loading reference…</div>
          <div v-else-if="error" class="slidey-ref-status slidey-ref-error">{{ error }}</div>
          <img
            v-else-if="kind === 'image'"
            class="slidey-ref-image"
            :src="refData.href"
            :alt="title"
          />
          <video
            v-else-if="kind === 'video'"
            class="slidey-ref-video"
            :src="refData.href"
            controls
            playsinline
          ></video>
          <article
            v-else-if="kind === 'markdown'"
            class="slidey-ref-markdown"
            v-html="bodyHTML"
          ></article>
          <iframe
            v-else-if="kind === 'html'"
            class="slidey-ref-html"
            :src="refData.href"
            :title="title"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerpolicy="no-referrer"
          ></iframe>
          <pre
            v-else
            class="slidey-ref-pre slidey-ref-numbered"
            :data-lang="refData.lang || kind"
          ><code v-html="numberedHTML"></code></pre>
        </div>
      </section>
    </div>
  </Teleport>
</template>
