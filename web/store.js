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
  traceturn_title:     ['traceturn-title'],
  traceturn_map:       ['traceturn-map'],
  traceturn_row_0:     ['traceturn-row-0'],
  traceturn_row_1:     ['traceturn-row-1'],
  traceturn_row_2:     ['traceturn-row-2'],
  traceturn_row_3:     ['traceturn-row-3'],
  traceturn_row_4:     ['traceturn-row-4'],
  traceturn_row_5:     ['traceturn-row-5'],
  traceturn_row_6:     ['traceturn-row-6'],
  traceturn_row_7:     ['traceturn-row-7'],
  traceturn_row_8:     ['traceturn-row-8'],
  traceturn_detail:    ['traceturn-detail'],
  thread_title:        ['thread-title'],
  thread_panel_0:      ['thread-panel-0'],
  thread_panel_1:      ['thread-panel-1'],
  thread_panel_2:      ['thread-panel-2'],
  thread_caption:      ['thread-caption'],
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
  // visibility / reveal sets
  visible: new Set(),
  revealed: new Set(),
  // request-scene imperative bits
  isMock: false,
  isPlayback: false,
  sendBtnSending: false,
  sendingText: 'Sending request...',
  progress: 0,

  isVisible(id) { return this.visible.has(id); },
  isRevealed(id) { return this.revealed.has(id); },

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
  _resetPitch() { this.revealed = new Set(); },

  showScene(type, scene) {
    this._resetScene();
    this._resetPitch();
    this.scene = scene;
    this.sceneType = type;
  },
  hidePitch() { this._resetPitch(); },

  // setState dispatch: pitch step → reveal ids; else → request state machine.
  setState(step) {
    const ids = PITCH_REVEALS[step];
    if (ids) { ids.forEach(id => this.revealed.add(id)); return; }
    this.applyRequestStep(step);
  },
});
