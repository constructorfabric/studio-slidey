// SLIDEY — reactive render store
//
// Single source of truth the Vue scene components render from:
//   - `visible`  show()/hide()/.hidden  (API/request mode sections)
//   - `revealed` _reveal()/.shown        (pitch-mode progressive reveal)
//   - `scene`    holds the current scene object  (components read content from it)
// The window.slidey adapter (slideyAdapter.js) is a thin wrapper that calls these
// methods, so renderer.js + src/scenes/*.js drive it unchanged.

import { reactive } from 'vue';

// Pitch-scene reveal step name → element id(s) to mark .shown.
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
  // ── Kitsoki TUI ──
  kitsokitui_frame:   ['kitsokitui-frame'],
  kitsokitui_welcome: ['kitsokitui-welcome'],
  kitsokitui_menu:    ['kitsokitui-menu'],
  kitsokitui_caption: ['kitsokitui-caption'],
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
  graph_title:         ['graph-title'],
  graph_frame:         ['graph-frame'],
  graph_caption:       ['graph-caption'],
  mermaid_title:       ['mermaid-title'],
  mermaid_frame:       ['mermaid-frame'],
  mermaid_caption:     ['mermaid-caption'],
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
  cards_item_6:   ['cards-item-6'],
  cards_item_7:   ['cards-item-7'],
  cards_caption:  ['cards-caption'],
  // ── Objectives ──
  objectives_title:   ['objectives-title'],
  objectives_item_0:  ['objectives-item-0'],
  objectives_item_1:  ['objectives-item-1'],
  objectives_item_2:  ['objectives-item-2'],
  objectives_item_3:  ['objectives-item-3'],
  objectives_item_4:  ['objectives-item-4'],
  objectives_item_5:  ['objectives-item-5'],
  objectives_caption: ['objectives-caption'],
  // ── Evidence ──
  evidence_title:   ['evidence-title'],
  evidence_item_0:  ['evidence-item-0'],
  evidence_item_1:  ['evidence-item-1'],
  evidence_item_2:  ['evidence-item-2'],
  evidence_item_3:  ['evidence-item-3'],
  evidence_item_4:  ['evidence-item-4'],
  evidence_item_5:  ['evidence-item-5'],
  evidence_caption: ['evidence-caption'],
  // ── Personas / use-cases ──
  personas_title:   ['personas-title'],
  personas_item_0:  ['personas-item-0'],
  personas_item_1:  ['personas-item-1'],
  personas_item_2:  ['personas-item-2'],
  personas_item_3:  ['personas-item-3'],
  personas_item_4:  ['personas-item-4'],
  personas_item_5:  ['personas-item-5'],
  personas_item_6:  ['personas-item-6'],
  personas_item_7:  ['personas-item-7'],
  personas_item_8:  ['personas-item-8'],
  personas_item_9:  ['personas-item-9'],
  personas_item_10: ['personas-item-10'],
  personas_item_11: ['personas-item-11'],
  personas_caption: ['personas-caption'],
  // ── Code ──
  code_header: ['code-header'],
  code_body:   ['code-body'],
  code_notes:  ['code-notes'],
  // ── MCP drive ──
  mcpdrive_prompt:  ['mcpdrive-prompt'],
  mcpdrive_calls:   ['mcpdrive-calls'],
  mcpdrive_outcome: ['mcpdrive-outcome'],
  mcpdrive_caption: ['mcpdrive-caption'],
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
  // ── Image ──
  image_title:   ['image-title'],
  image_frame:   ['image-frame'],
  image_caption: ['image-caption'],
  // ── Image comparison ──
  imagecompare_title:   ['imagecompare-title'],
  imagecompare_frame:   ['imagecompare-frame'],
  imagecompare_caption: ['imagecompare-caption'],
  // ── Meme ──
  meme_title:   ['meme-title'],
  meme_frame:   ['meme-frame'],
  meme_box_0:   ['meme-box-0'],
  meme_box_1:   ['meme-box-1'],
  meme_box_2:   ['meme-box-2'],
  meme_box_3:   ['meme-box-3'],
  meme_box_4:   ['meme-box-4'],
  meme_box_5:   ['meme-box-5'],
  meme_caption: ['meme-caption'],
  // ── Book ──
  book_title:   ['book-title'],
  book_item_0:  ['book-item-0'],
  book_item_1:  ['book-item-1'],
  book_item_2:  ['book-item-2'],
  book_caption: ['book-caption'],
  // ── Reference preview ──
  reference_title:   ['reference-title'],
  reference_frame:   ['reference-frame'],
  reference_caption: ['reference-caption'],
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
  // Monotonic id bumped only when a NEW scene is shown (not on step navigation),
  // so the viewer can key the scene component on it and remount per scene — this
  // prevents a previous same-type scene's revealed elements from being reused and
  // visibly fading out before the new scene reveals (the "rows flash" bug).
  sceneNonce: 0,
  gifDataUri: '',
  imageDataUri: '',
  leftImageDataUri: '',
  rightImageDataUri: '',
  bookCoverDataUris: [],
  // meme — blank template image (inlined data URI) + resolved geometry.
  memeDataUri: '',
  memeTemplate: null,
  // video (live rrweb) — populated by showVideo for VideoScene/RrwebPlayer.
  rrwebEvents: [],
  rrwebChapters: [],
  // Transcript: index of the turn card currently on screen (the scene shows one
  // card at a time; the renderers advance it via the transcript_card_<n> step).
  transcriptCard: 0,
  // Graph scene: index into scene.path/focus for the node currently centered.
  graphFocus: -1,
  // Graph scene (projection input mode): the resolved graph-projection v1 JSON
  // for the current scene (null unless scene.projection was set and resolved).
  graphProjectionData: null,
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
    this.sceneNonce++;
    this.scene = scene;
    this.sceneType = 'title';
    this._show('title-card');
  },
  hideTitleCard() { this._hide('title-card'); },

  // ── Request scene ───────────────────────────────────────────────────────
  loadScene(scene, opts) {
    this._resetScene();
    this.sceneNonce++;
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
  _resetPitch() {
    this.revealed = new Set();
    this.revealAll = false;
    this.gifDataUri = '';
    this.imageDataUri = '';
    this.leftImageDataUri = '';
    this.rightImageDataUri = '';
    this.bookCoverDataUris = [];
    this.memeDataUri = '';
    this.memeTemplate = null;
    this.graphProjectionData = null;
  },

  setPitchSteps(steps) {
    this.revealed = new Set();
    this.revealAll = false;
    this.transcriptCard = 0;
    this.graphFocus = -1;
    for (const step of steps || []) {
      const m = /^transcript_card_(\d+)$/.exec(step);
      if (m) {
        this.transcriptCard = parseInt(m[1], 10);
        continue;
      }
      const g = /^graph_focus_(\d+)$/.exec(step);
      if (g) {
        this.graphFocus = parseInt(g[1], 10);
        this.revealed.add('graph-frame');
        continue;
      }
      if (step === 'graph_caption') this.graphFocus = -1;
      if (step === 'reveal_all') {
        this.revealAll = true;
        continue;
      }
      const ids = PITCH_REVEALS[step];
      if (ids) ids.forEach(id => this.revealed.add(id));
    }
  },

  showScene(type, scene) {
    this._resetScene();
    this._resetPitch();
    this.sceneNonce++;
    this.scene = scene;
    this.sceneType = type;
    this.transcriptCard = 0;     // start a transcript at its first turn card
    this.graphFocus = -1;
  },
  // video (live rrweb player in the interactive viewer): the loaded rrweb log
  // (events + derived chapters) is held here for VideoScene → RrwebPlayer.
  showVideo(scene, data) {
    this.showScene('video', scene);
    this.rrwebEvents = (data && data.events) || [];
    this.rrwebChapters = (data && data.chapters) || [];
  },
  // graph (projection input mode): the resolved graph-projection JSON is held
  // separately from `scene` (mirrors showVideo) so GraphScene.vue can render it
  // through the shared renderer without waiting on a second fetch.
  showGraph(scene, projectionData) {
    this.showScene('graph', scene);
    this.graphProjectionData = projectionData || null;
  },
  hidePitch() { this._resetPitch(); },

  // setState dispatch: transcript card step → swap the on-screen turn card;
  // pitch step → reveal ids; else → request state machine.
  setState(step) {
    const m = /^transcript_card_(\d+)$/.exec(step);
    if (m) { this.transcriptCard = parseInt(m[1], 10); return; }
    const g = /^graph_focus_(\d+)$/.exec(step);
    if (g) {
      this.graphFocus = parseInt(g[1], 10);
      this.revealed.add('graph-frame');
      return;
    }
    if (step === 'graph_caption') this.graphFocus = -1;
    if (step === 'reveal_all') { this.revealAll = true; return; }
    const ids = PITCH_REVEALS[step];
    if (ids) { ids.forEach(id => this.revealed.add(id)); return; }
    this.applyRequestStep(step);
  },
});
