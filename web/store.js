// SLIDEY — reactive render store
//
// Single source of truth the Vue scene components render from. It is a faithful
// port of the imperative state machine in src/template.html's `window.slidey`:
//   - `visible`  mirrors show()/hide()/.hidden  (API/request mode sections)
//   - `revealed` mirrors _reveal()/.shown        (pitch-mode progressive reveal)
//   - `scene`    holds the current scene object  (components read content from it)
// The window.slidey adapter (slideyAdapter.js) is a thin wrapper that calls these
// methods, so renderer.js + src/scenes/*.js drive it unchanged.

import { reactive } from 'vue';

// Pitch-scene reveal step name → element id(s) to mark .shown.
// Verbatim from src/template.html `_PITCH_REVEALS`.
export const PITCH_REVEALS = {
  narrative_eyebrow: ['narrative-eyebrow'],
  narrative_body:    ['narrative-body'],
  narrative_lede:    ['narrative-lede'],
  diagram_title:     ['diagram-title'],
  diagram_panel_0:   ['diagram-panel-0'],
  diagram_panel_1:   ['diagram-panel-1'],
  diagram_panel_2:   ['diagram-panel-2'],
  diagram_caption:   ['diagram-caption'],
  termgif_frame:     ['termgif-frame'],
  termgif_caption:   ['termgif-caption'],
  stat_value:        ['stat-value'],
  stat_label:        ['stat-label'],
  stat_detail:       ['stat-detail'],
  cta_wordmark:      ['cta-wordmark'],
  cta_tagline:       ['cta-tagline'],
  cta_url:           ['cta-url'],
  diagramsvg_title:    ['diagramsvg-title'],
  diagramsvg_panel_0:  ['diagramsvg-panel-0'],
  diagramsvg_panel_1:  ['diagramsvg-panel-1'],
  diagramsvg_panel_2:  ['diagramsvg-panel-2'],
  diagramsvg_caption:  ['diagramsvg-caption'],
  trace_title:         ['trace-title'],
  trace_turn_0:        ['trace-turn-0'],
  trace_turn_1:        ['trace-turn-1'],
  trace_turn_2:        ['trace-turn-2'],
  trace_caption:       ['trace-caption'],
  thread_title:        ['thread-title'],
  thread_panel_0:      ['thread-panel-0'],
  thread_panel_1:      ['thread-panel-1'],
  thread_panel_2:      ['thread-panel-2'],
  thread_caption:      ['thread-caption'],
  // ── Cards ──
  cards_title:    ['cards-title'],
  cards_item_0:   ['cards-item-0'],
  cards_item_1:   ['cards-item-1'],
  cards_item_2:   ['cards-item-2'],
  cards_item_3:   ['cards-item-3'],
  cards_item_4:   ['cards-item-4'],
  cards_item_5:   ['cards-item-5'],
  cards_caption:  ['cards-caption'],
  // ── Code ──
  code_header: ['code-header'],
  code_body:   ['code-body'],
  code_notes:  ['code-notes'],
  // ── Table ──
  table_title:   ['table-title'],
  table_header:  ['table-header'],
  table_row_0:   ['table-row-0'],
  table_row_1:   ['table-row-1'],
  table_row_2:   ['table-row-2'],
  table_row_3:   ['table-row-3'],
  table_row_4:   ['table-row-4'],
  table_row_5:   ['table-row-5'],
  table_row_6:   ['table-row-6'],
  table_row_7:   ['table-row-7'],
  table_caption: ['table-caption'],
  // ── Chart ──
  chart_title:     ['chart-title'],
  chart_frame:     ['chart-frame'],
  chart_series_0:  ['chart-series-0'],
  chart_series_1:  ['chart-series-1'],
  chart_series_2:  ['chart-series-2'],
  chart_series_3:  ['chart-series-3'],
  chart_series_4:  ['chart-series-4'],
  chart_series_5:  ['chart-series-5'],
  chart_caption:   ['chart-caption'],
};

// API/request-mode ids cleared on a scene reset (verbatim from _resetScene).
const RESET_IDS = [
  'title-card', 'scene-header', 'url-bar',
  'req-headers-section', 'req-body-section',
  'sending-overlay', 'status-display',
  'res-headers-section', 'res-body-section',
  'footer-annotation', 'mock-badge', 'playback-badge', 'status-expected',
];

export const store = reactive({
  meta: {},
  mode: 'api',
  scene: null,
  sceneType: null,
  gifDataUri: '',
  // Transcript: index of the turn card currently on screen (the scene shows one
  // card at a time; the renderers advance it via the transcript_card_<n> step).
  transcriptCard: 0,
  // visibility / reveal sets
  visible: new Set(),
  revealed: new Set(),
  // `instant` scenes reveal everything in one step (no progressive build) — set
  // by the 'reveal_all' step so isRevealed() returns true for every id.
  revealAll: false,
  // request-scene imperative bits
  isMock: false,
  isPlayback: false,
  sendBtnSending: false,
  sendingText: 'Sending request...',
  progress: 0,

  isVisible(id) { return this.visible.has(id); },
  isRevealed(id) { return this.revealAll || this.revealed.has(id); },

  _show(id) { this.visible.add(id); },
  _hide(id) { this.visible.delete(id); },

  setMeta(meta) { this.meta = { ...(meta || {}) }; },

  setMode(mode) { this.mode = mode === 'pitch' ? 'pitch' : 'api'; },

  // ── Title card ────────────────────────────────────────────────────────────
  showTitleCard(scene) {
    this._resetScene();
    this.scene = scene;
    this.sceneType = 'title';
    this._show('title-card');
  },
  hideTitleCard() { this._hide('title-card'); },

  // ── Request scene ───────────────────────────────────────────────────────
  loadScene(scene, opts) {
    this._resetScene();
    this.scene = scene;
    this.sceneType = 'request';
    this.isMock     = (opts && opts.isMock)     || scene.mock     === true;
    this.isPlayback = (opts && opts.isPlayback) || scene.playback === true;
  },

  // Content-presence guards (mirror the hasX checks in template setState).
  _reqHeaders() { return (this.scene && this.scene.request && this.scene.request.headers) || []; },
  _reqBody()    { return (this.scene && this.scene.request && this.scene.request.body) || ''; },
  _res()        { return (this.scene && this.scene.response) || {}; },
  _hasReqHeaders() { return this._reqHeaders().length > 0; },
  _hasReqBody()    { return this._reqBody().trim().length > 0; },
  _hasResHeaders() { return (this._res().headers || []).length > 0; },
  _hasResBody()    { return String(this._res().body || '').trim().length > 0; },
  _hasAnnotation() { return String(this._res().annotation || '').trim().length > 0; },

  _applyModeBadge() {
    if (this.isMock) this._show('mock-badge'); else this._hide('mock-badge');
    if (this.isPlayback) this._show('playback-badge'); else this._hide('playback-badge');
  },

  _resetScene() {
    RESET_IDS.forEach(id => this._hide(id));
    this.sendBtnSending = false;
    this.progress = 0;
    this.isMock = false;
    this.isPlayback = false;
  },

  setProgress(pct) { this.progress = pct; },
  setSendingText(text) { this.sendingText = text; },

  // Drive the request reveal state machine. Verbatim port of template setState's
  // switch (cumulative section reveals with content guards).
  applyRequestStep(step) {
    if (step !== 'sending') {
      this._hide('sending-overlay');
      this.sendBtnSending = false;
    }
    if (step !== 'blank') this._applyModeBadge();

    const showReqBase = () => {
      this._show('scene-header');
      this._show('url-bar');
      if (this._hasReqHeaders()) this._show('req-headers-section');
      if (this._hasReqBody())    this._show('req-body-section');
    };
    const statusExpected = () => {
      if (this._res().statusExpected) this._show('status-expected');
    };

    switch (step) {
      case 'blank':
        this._resetScene();
        break;
      case 'scene_header':
        this._show('scene-header');
        break;
      case 'request_url':
        this._show('scene-header'); this._show('url-bar');
        break;
      case 'request_headers':
        this._show('scene-header'); this._show('url-bar');
        if (this._hasReqHeaders()) this._show('req-headers-section');
        break;
      case 'request_body':
        showReqBase();
        break;
      case 'sending':
        showReqBase();
        this.sendBtnSending = true;
        this._show('sending-overlay');
        break;
      case 'response_status':
        showReqBase();
        this._show('status-display'); statusExpected();
        break;
      case 'response_headers':
        showReqBase();
        this._show('status-display'); statusExpected();
        if (this._hasResHeaders()) this._show('res-headers-section');
        break;
      case 'response_body':
        showReqBase();
        this._show('status-display'); statusExpected();
        if (this._hasResHeaders()) this._show('res-headers-section');
        if (this._hasResBody())    this._show('res-body-section');
        break;
      case 'response_annotation':
      case 'complete':
        showReqBase();
        this._show('status-display'); statusExpected();
        if (this._hasResHeaders()) this._show('res-headers-section');
        if (this._hasResBody())    this._show('res-body-section');
        if (this._hasAnnotation()) this._show('footer-annotation');
        break;
    }
  },

  // ── Pitch scenes ──────────────────────────────────────────────────────────
  _resetPitch() { this.revealed = new Set(); this.revealAll = false; },

  showScene(type, scene) {
    this._resetScene();
    this._resetPitch();
    this.scene = scene;
    this.sceneType = type;
    this.transcriptCard = 0;     // start a transcript at its first turn card
  },
  hidePitch() { this._resetPitch(); },

  // setState dispatch: transcript card step → swap the on-screen turn card;
  // pitch step → reveal ids; else → request state machine.
  setState(step) {
    const m = /^transcript_card_(\d+)$/.exec(step);
    if (m) { this.transcriptCard = parseInt(m[1], 10); return; }
    if (step === 'reveal_all') { this.revealAll = true; return; }
    const ids = PITCH_REVEALS[step];
    if (ids) { ids.forEach(id => this.revealed.add(id)); return; }
    this.applyRequestStep(step);
  },
});
