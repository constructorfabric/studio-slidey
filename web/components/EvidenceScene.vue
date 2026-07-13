<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import {
  evidencePlaybackRef,
  evidencePlaybackTitle,
  isEvidencePlayback,
} from '../evidencePlayback.mjs';

const MAX_ITEMS = 6;

const items = computed(() => (store.scene?.items || []).slice(0, MAX_ITEMS));

const STATUS = {
  done: { label: 'DONE', glyph: '✓' },
  validated: { label: 'VALIDATED', glyph: '✓' },
  implemented: { label: 'IMPLEMENTED', glyph: '✓' },
  issue: { label: 'ISSUE', glyph: '!' },
  blocked: { label: 'BLOCKED', glyph: '!' },
  next: { label: 'NEXT', glyph: '→' },
  progress: { label: 'IN PROGRESS', glyph: '…' },
  pending: { label: 'PENDING', glyph: '·' },
  skipped: { label: 'SKIPPED', glyph: '-' },
};

function norm(status) {
  return String(status || 'pending').toLowerCase().replace(/[\s_]+/g, '-');
}

function statusMeta(status) {
  return STATUS[norm(status)] || { label: String(status || 'PENDING').toUpperCase(), glyph: '?' };
}

function refLabel(item) {
  const type = String(item.refType || 'artifact').toUpperCase();
  return type.replace(/[-_]+/g, ' ');
}

function openPlayback(item) {
  if (!isEvidencePlayback(item)) return;
  try {
    window.dispatchEvent(new CustomEvent('slidey:open-rrweb', {
      detail: {
        ref: evidencePlaybackRef(item),
        title: evidencePlaybackTitle(item),
        label: item.label || '',
        note: item.note || '',
      },
    }));
  } catch (_) {
    /* no browser event target */
  }
}
</script>

<template>
  <div id="evidence-region" class="scene-region active">
    <div
      v-if="store.scene.title"
      id="evidence-title"
      class="reveal"
      data-edit-path='["title"]'
      :class="{ shown: store.isRevealed('evidence-title') }"
    >{{ store.scene.title }}</div>

    <div class="evidence-list">
      <article
        v-for="(item, i) in items"
        :key="i"
        :id="`evidence-item-${i}`"
        class="evidence-item reveal"
        :class="[`evidence-${norm(item.status)}`, { shown: store.isRevealed(`evidence-item-${i}`) }]"
      >
        <div class="evidence-status">
          <div class="evidence-glyph" aria-hidden="true">{{ statusMeta(item.status).glyph }}</div>
          <div class="evidence-status-label">{{ statusMeta(item.status).label }}</div>
        </div>
        <div class="evidence-copy">
          <div class="evidence-head">
            <span class="evidence-label" :data-edit-path="JSON.stringify(['items', i, 'label'])">{{ item.label }}</span>
            <span v-if="item.note" class="evidence-note" :data-edit-path="JSON.stringify(['items', i, 'note'])">{{ item.note }}</span>
          </div>
          <div class="evidence-detail" :data-edit-path="JSON.stringify(['items', i, 'detail'])" data-edit-multiline>{{ item.detail }}</div>
          <div v-if="item.ref" class="evidence-ref">
            <span class="evidence-ref-type">{{ refLabel(item) }}</span>
            <button
              v-if="isEvidencePlayback(item)"
              type="button"
              class="evidence-ref-playback"
              data-testid="evidence-open-rrweb"
              :title="`Open playback: ${item.ref}`"
              @click.stop="openPlayback(item)"
            >
              <span class="evidence-ref-play-icon" aria-hidden="true">▶</span>
              <code>{{ item.ref }}</code>
            </button>
            <code v-else>{{ item.ref }}</code>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="store.scene.caption"
      id="evidence-caption"
      class="reveal"
      data-edit-path='["caption"]'
      data-edit-multiline
      :class="{ shown: store.isRevealed('evidence-caption') }"
    >{{ store.scene.caption }}</div>
  </div>
</template>

<style scoped>
#evidence-region {
  gap: 24px;
  max-width: 1680px;
  width: 100%;
  margin: 0 auto;
}

#evidence-title {
  font-size: 36px;
  font-weight: bold;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #58a6ff;
  text-align: center;
}

.evidence-list {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.evidence-item {
  min-height: 142px;
  display: grid;
  grid-template-columns: 148px 1fr;
  gap: 26px;
  align-items: stretch;
  padding: 18px 26px;
  border: 1px solid #30363d;
  border-left-width: 10px;
  border-radius: 12px;
  background: #161b22;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
}

.evidence-status {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
}

.evidence-glyph {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 58px;
  line-height: 1;
  font-weight: 900;
}

.evidence-status-label {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-align: center;
}

.evidence-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.evidence-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 22px;
}

.evidence-label {
  color: #e6edf3;
  font-size: 31px;
  font-weight: 850;
}

.evidence-note {
  flex: 0 0 auto;
  color: #8b949e;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 18px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.evidence-detail {
  color: #cdd9e5;
  font-size: 25px;
  line-height: 1.26;
}

.evidence-ref {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.evidence-ref-type {
  color: #8b949e;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.evidence-ref code,
.evidence-ref-playback {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.evidence-ref code {
  display: block;
  border: 1px solid rgba(88, 166, 255, 0.22);
  border-radius: 8px;
  padding: 10px 14px;
  color: #e6edf3;
  background: rgba(13, 17, 23, 0.7);
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 21px;
}

.evidence-ref-playback {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(88, 166, 255, 0.44);
  border-radius: 8px;
  padding: 0;
  color: #e6edf3;
  background: rgba(31, 111, 235, 0.16);
  cursor: pointer;
  text-align: left;
}

.evidence-ref-playback:hover,
.evidence-ref-playback:focus-visible {
  border-color: #58a6ff;
  background: rgba(31, 111, 235, 0.26);
  outline: none;
}

.evidence-ref-playback code {
  border: 0;
  background: transparent;
  padding-left: 0;
}

.evidence-ref-play-icon {
  width: 34px;
  height: 34px;
  margin-left: 8px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #0d1117;
  background: #58a6ff;
  font-size: 16px;
  font-weight: 900;
}

.evidence-done,
.evidence-validated,
.evidence-implemented {
  border-left-color: #3fb950;
  background: linear-gradient(90deg, rgba(63, 185, 80, 0.14), #161b22 30%);
}
.evidence-done .evidence-glyph,
.evidence-validated .evidence-glyph,
.evidence-implemented .evidence-glyph {
  color: #0d1117;
  background: #3fb950;
  box-shadow: 0 0 32px rgba(63, 185, 80, 0.34);
}
.evidence-done .evidence-status-label,
.evidence-validated .evidence-status-label,
.evidence-implemented .evidence-status-label { color: #3fb950; }

.evidence-issue,
.evidence-blocked {
  border-left-color: #f85149;
  background: linear-gradient(90deg, rgba(248, 81, 73, 0.16), #161b22 32%);
}
.evidence-issue .evidence-glyph,
.evidence-blocked .evidence-glyph {
  color: #0d1117;
  background: #f85149;
  box-shadow: 0 0 32px rgba(248, 81, 73, 0.34);
}
.evidence-issue .evidence-status-label,
.evidence-blocked .evidence-status-label { color: #f85149; }

.evidence-next {
  border-left-color: #d29922;
  background: linear-gradient(90deg, rgba(210, 153, 34, 0.14), #161b22 30%);
}
.evidence-next .evidence-glyph {
  color: #0d1117;
  background: #d29922;
  box-shadow: 0 0 32px rgba(210, 153, 34, 0.32);
}
.evidence-next .evidence-status-label { color: #d29922; }

.evidence-progress,
.evidence-pending,
.evidence-skipped {
  border-left-color: #58a6ff;
}
.evidence-progress .evidence-glyph,
.evidence-pending .evidence-glyph,
.evidence-skipped .evidence-glyph {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.12);
  border: 1px solid rgba(88, 166, 255, 0.28);
}
.evidence-progress .evidence-status-label,
.evidence-pending .evidence-status-label,
.evidence-skipped .evidence-status-label { color: #58a6ff; }

#evidence-caption {
  max-width: 1450px;
  margin: 0 auto;
  color: #8b949e;
  font-size: 27px;
  line-height: 1.42;
  text-align: center;
}
</style>
