<script setup>
// Root render surface — the #root DOM whose ids/classes web/styles/template.css
// targets. API/request chrome is inline here; pitch scenes are dispatched to
// child components. All visibility/reveal flows through the reactive store.
import { computed, watchEffect } from 'vue';
import { store } from '../store.js';
import { renderBody, renderHeadersHTML, statusClass, escapeHTML } from '../format.js';
import { themeConfig } from '../theme.js';

import NarrativeScene from './NarrativeScene.vue';
import DiagramScene from './DiagramScene.vue';
import DiagramSvgScene from './DiagramSvgScene.vue';
import GraphScene from './GraphScene.vue';
import MermaidScene from './MermaidScene.vue';
import TerminalGifScene from './TerminalGifScene.vue';
import KitsokiTuiScene from './KitsokiTuiScene.vue';
import StatScene from './StatScene.vue';
import CtaScene from './CtaScene.vue';
import TraceScene from './TraceScene.vue';
import TranscriptScene from './TranscriptScene.vue';
import ThreadScene from './ThreadScene.vue';
import CardsScene from './CardsScene.vue';
import ObjectivesScene from './ObjectivesScene.vue';
import EvidenceScene from './EvidenceScene.vue';
import CodeScene from './CodeScene.vue';
import McpDriveScene from './McpDriveScene.vue';
import TableScene from './TableScene.vue';
import ChartScene from './ChartScene.vue';
import ImageScene from './ImageScene.vue';
import ImageCompareScene from './ImageCompareScene.vue';
import BookScene from './BookScene.vue';
import MemeScene from './MemeScene.vue';
import VideoScene from './VideoScene.vue';
import PersonasScene from './PersonasScene.vue';
import ReferencePreviewScene from './ReferencePreviewScene.vue';

const PITCH_COMPONENTS = {
  narrative: NarrativeScene,
  diagram: DiagramScene,
  'diagram-svg': DiagramSvgScene,
  graph: GraphScene,
  mermaid: MermaidScene,
  'terminal-gif': TerminalGifScene,
  'kitsoki-tui': KitsokiTuiScene,
  stat: StatScene,
  cta: CtaScene,
  trace: TraceScene,
  transcript: TranscriptScene,
  thread: ThreadScene,
  cards: CardsScene,
  objectives: ObjectivesScene,
  evidence: EvidenceScene,
  code: CodeScene,
  'mcp-drive': McpDriveScene,
  table: TableScene,
  chart: ChartScene,
  image: ImageScene,
  'image-compare': ImageCompareScene,
  book: BookScene,
  meme: MemeScene,
  video: VideoScene,
  personas: PersonasScene,
  reference: ReferencePreviewScene,
};

// Toggle body classes for mode, mirroring slidey.setMode. body.instant is owned
// by the renderer (added directly via page.evaluate), so we don't touch it here.
watchEffect(() => {
  const pitch = store.mode === 'pitch';
  document.body.classList.toggle('mode-pitch', pitch);
  document.body.classList.toggle('mode-api', !pitch);
});

// Inline `[data-slidey-ref]` links (see markdown.js / inline-links.js) show a
// small reference-marker glyph by default in every render mode — including
// static PNG/PDF/MP4 exports, which mount this component directly with no
// click routing at all. `meta.linkMarkers: false` hides that glyph deck-wide.
watchEffect(() => {
  document.body.classList.toggle('slidey-no-link-markers', store.meta && store.meta.linkMarkers === false);
});

const activeTheme = computed(() => themeConfig(store.meta && store.meta.theme, store.meta || {}));

watchEffect(() => {
  const id = 'slidey-runtime-theme';
  let el = document.getElementById(id);
  const css = activeTheme.value.css || '';
  const style = activeTheme.value.style || {};

  for (const [name, value] of Object.entries(style)) {
    document.documentElement.style.setProperty(name, value);
    document.body.style.setProperty(name, value);
  }
  document.documentElement.style.background = style['--slidey-background'] || '';
  document.body.style.background = style['--slidey-background'] || '';

  if (!css) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
});

const activePitch = computed(() =>
  store.mode === 'pitch' ? (PITCH_COMPONENTS[store.sceneType] || null) : null,
);

const hidden = id => !store.isVisible(id);

// ── Header (global meta) ────────────────────────────────────────────────────
const phaseBadge = computed(() => {
  const phase = store.meta.phase;
  if (phase === 'before') return { cls: 'badge-before', text: 'BEFORE FIX' };
  if (phase === 'after')  return { cls: 'badge-after',  text: 'AFTER FIX' };
  return { cls: 'badge-neutral', text: (phase || 'DEMO').toUpperCase() };
});

// ── Request-scene content (computed from store.scene) ───────────────────────
const sc = computed(() => store.scene || {});
const req = computed(() => sc.value.request || {});
const res = computed(() => sc.value.response || {});

const method = computed(() => req.value.method || 'GET');
const reqHeadersHTML = computed(() => renderHeadersHTML(req.value.headers || []));
const reqBodyHTML = computed(() => {
  const headers = req.value.headers || [];
  const ct = (headers.find(h => h.name.toLowerCase() === 'content-type') || {}).value;
  return renderBody(req.value.body || '', ct);
});
const statusCode = computed(() => res.value.status || 200);
const statusDisplayClass = computed(() => statusClass(statusCode.value));
const resHeadersHTML = computed(() => renderHeadersHTML(res.value.headers || []));
const resBodyHTML = computed(() => {
  const headers = res.value.headers || [];
  const ct = (headers.find(h => h.name.toLowerCase() === 'content-type') || {}).value;
  return renderBody(res.value.body || '', ct);
});
const statusExpectedHTML = computed(() =>
  res.value.statusExpected
    ? `Expected<br><strong>${escapeHTML(String(res.value.statusExpected))}</strong>`
    : '');
const annotType = computed(() => res.value.annotationType || 'error');
const annotIcon = computed(() => ({ error: '✗', warning: '⚠', success: '✓', info: 'ℹ' }[annotType.value] || '·'));

// ── Title card ──────────────────────────────────────────────────────────────
const title = computed(() => store.sceneType === 'title' ? sc.value : {});
const titleSubtitleHTML = computed(() =>
  title.value.subtitleHtml || escapeHTML(String(title.value.subtitle || '')).replace(/\n/g, '<br>'));
</script>

<template>
  <div id="root" :class="activeTheme.className" :style="activeTheme.style">
    <!-- TITLE CARD -->
    <div
      id="title-card"
      :class="[{ hidden: hidden('title-card') }, title.theme === 'markdown' ? 'title-card-markdown' : '']"
    >
      <div id="title-card-eyebrow" data-embed-field="eyebrow" data-embed-label="eyebrow" data-edit-path='["eyebrow"]'>{{ title.eyebrow || '' }}</div>
      <div id="title-card-rule"></div>
      <div id="title-card-title" data-embed-field="title" data-embed-label="title" data-edit-path='["title"]'>{{ title.title || '' }}</div>
      <div id="title-card-subtitle" data-embed-field="subtitle" data-embed-label="subtitle" v-html="titleSubtitleHTML"></div>
    </div>

    <!-- HEADER BAR -->
    <div id="header">
      <span id="ticker">
        <span class="ticket-id" id="header-ticket">{{ store.meta.ticket ? store.meta.ticket + '  ' : '' }}</span>
        <span id="header-title">{{ store.meta.title || '' }}</span>
      </span>
      <span id="phase-badge" :class="phaseBadge.cls">{{ phaseBadge.text }}</span>
    </div>

    <!-- SCENE HEADER -->
    <div id="scene-header" :class="{ hidden: hidden('scene-header') }">
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:0;">
          <div id="scene-title-text" data-edit-path='["title"]'>{{ sc.title || '' }}</div>
          <span id="mock-badge" :class="{ hidden: hidden('mock-badge') }">MOCK</span>
          <span id="playback-badge" :class="{ hidden: hidden('playback-badge') }">PLAYBACK</span>
        </div>
        <div id="scene-annotation-text" data-edit-path='["annotation"]'>{{ sc.annotation || '' }}</div>
      </div>
    </div>

    <!-- MAIN TWO-PANEL AREA -->
    <div id="main">
      <div class="panel" id="request-panel">
        <div class="panel-label">Request</div>
        <div class="panel-body">
          <div id="url-bar" :class="{ hidden: hidden('url-bar') }">
            <span id="method-badge" :class="`method-badge method-${method}`">{{ method }}</span>
            <span id="url-text" data-edit-path='["request","url"]'>{{ req.url || '' }}</span>
            <button id="send-btn" :class="{ sending: store.sendBtnSending }">{{ store.sendBtnSending ? 'Sending…' : 'Send' }}</button>
          </div>
          <div id="req-headers-section" class="section" :class="{ hidden: hidden('req-headers-section') }">
            <div class="section-label">Headers</div>
            <div id="req-headers-list" class="headers-list" v-html="reqHeadersHTML"></div>
          </div>
          <div id="req-body-section" class="section" :class="{ hidden: hidden('req-body-section') }">
            <div class="section-label">Body</div>
            <div id="req-body-code" class="code-block" v-html="reqBodyHTML"></div>
          </div>
          <div id="sending-overlay" :class="{ hidden: hidden('sending-overlay') }">
            <div class="spinner-track"><div class="spinner-bar" id="spinner-bar" :style="{ width: store.progress + '%' }"></div></div>
            <span id="sending-text">{{ store.sendingText }}</span>
          </div>
        </div>
      </div>

      <div class="panel-divider"></div>

      <div class="panel" id="response-panel" :class="{ 'is-mock': store.isMock, 'is-playback': store.isPlayback }">
        <div class="panel-label">Response</div>
        <div class="panel-body">
          <div id="status-display" :class="[statusDisplayClass, { hidden: hidden('status-display') }]">
            <span id="status-code">{{ statusCode }}</span>
            <span id="status-text-label">{{ res.statusText || '' }}</span>
            <div class="status-expected" id="status-expected" :class="{ hidden: hidden('status-expected') }" v-html="statusExpectedHTML"></div>
          </div>
          <div id="res-headers-section" class="section" :class="{ hidden: hidden('res-headers-section') }">
            <div class="section-label">Headers</div>
            <div id="res-headers-list" class="headers-list" v-html="resHeadersHTML"></div>
          </div>
          <div id="res-body-section" class="section" :class="{ hidden: hidden('res-body-section') }">
            <div class="section-label">Body</div>
            <div id="res-body-code" class="code-block" v-html="resBodyHTML"></div>
          </div>
        </div>
      </div>

      <!-- ANNOTATION OVERLAY -->
      <div id="footer-annotation" :class="[`type-${annotType}`, { hidden: hidden('footer-annotation') }]">
        <span id="annotation-icon">{{ annotIcon }}</span>
        <span id="annotation-text" data-edit-path='["response","annotation"]'>{{ res.annotation || '' }}</span>
      </div>
    </div>

    <!-- PITCH STAGE -->
    <div id="pitch-stage">
      <component :is="activePitch" v-if="activePitch" :key="store.sceneType + ':' + store.sceneNonce" />
    </div>
  </div>
</template>
