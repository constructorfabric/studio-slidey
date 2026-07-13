/**
 * SLIDEY — Frame Timing Configuration
 *
 * Each value is a frame count at the target FPS (default 30fps).
 * Increase any value to dwell longer on that animation step.
 * Rule of thumb: 30 frames = 1 second.
 */

const TIMING = {
  // ── Shared ──────────────────────────────────────────────────────────────
  inter_scene: 24,          // 0.8 s — brief blank between scenes
  title_card:  90,          // 3.0 s

  // ── Request scene ────────────────────────────
  scene_header:        60,  // 2.0 s
  request_url:         30,
  request_headers:     30,
  request_body:        60,
  sending_ticks:        5,
  sending_per_tick:    15,
  response_status:     75,  // 2.5 s
  response_headers:    30,
  response_body:      120,  // 4.0 s
  response_annotation: 75,
  complete_hold:      300,  // 10.0 s

  // ── Narrative scene ─────────────────────────────────────────────
  narrative_eyebrow:   15,
  narrative_body:      30,
  narrative_lede:      20,
  narrative_hold:     120,  // 4.0 s default dwell

  // ── Diagram scene ───────────────────────────────────────────────
  diagram_title:       20,
  diagram_panel_0:     30,
  diagram_panel_1:     30,
  diagram_panel_2:     30,
  diagram_caption:     30,
  diagram_hold:       180,  // 6.0 s default dwell

  // ── Terminal-gif scene ──────────────────────────────────────────
  termgif_frame:       15,
  termgif_caption:     20,
  termgif_hold:       360,  // 12.0 s default — covers one gif loop

  // ── Kitsoki TUI scene ───────────────────────────────────────────
  kitsokitui_frame:    20,
  kitsokitui_welcome:  30,
  kitsokitui_menu:     24,
  kitsokitui_caption:  24,
  kitsokitui_hold:    220,

  // ── Stat scene ──────────────────────────────────────────────────
  stat_value:          30,
  stat_label:          20,
  stat_detail:         15,
  stat_hold:          120,

  // ── CTA scene ───────────────────────────────────────────────────
  cta_wordmark:        20,
  cta_tagline:         20,
  cta_url:             20,
  cta_hold:           180,  // 6.0 s

  // ── Diagram-SVG scene ───────────────────────────────────────────
  diagramsvg_title:    20,
  diagramsvg_panel_0:  30,
  diagramsvg_panel_1:  30,
  diagramsvg_panel_2:  30,
  diagramsvg_caption:  30,
  diagramsvg_hold:    210,  // 7.0 s default dwell

  // ── Cytoscape graph scene ────────────────────────────────────────────────
  graph_title:         18,
  graph_frame:         36,
  graph_focus_0:       48,
  graph_focus_1:       48,
  graph_focus_2:       48,
  graph_focus_3:       48,
  graph_focus_4:       48,
  graph_focus_5:       48,
  graph_focus_6:       48,
  graph_focus_7:       48,
  graph_focus_8:       48,
  graph_focus_9:       48,
  graph_caption:       28,
  graph_hold:         180,

  // ── Mermaid scene ───────────────────────────────────────────────────────
  mermaid_title:       20,
  mermaid_frame:       30,
  mermaid_caption:     30,
  mermaid_hold:       210,

  // ── Trace scene ─────────────────────────────────────────────────
  trace_title:         20,
  trace_turn_0:        45,  // 1.5 s per turn — slow enough to read
  trace_turn_1:        45,
  trace_turn_2:        45,
  trace_caption:       30,
  trace_hold:         180,  // 6.0 s

  // ── Transcript scene — session as per-turn boxed cards ───────────
  transcript_card:     96,  // 3.2 s per turn card — time to read one turn
  transcript_hold:    150,  // 5.0 s dwell on the final card

  // ── Thread scene — issue-tracker comment threads ───────────
  thread_title:        20,
  thread_panel_0:      40,  // ~1.3 s per panel reveal
  thread_panel_1:      40,
  thread_panel_2:      40,
  thread_caption:      30,
  thread_hold:        300,  // 10 s — generous read time for two threads

  // ── Cards scene ─────────────────────────────────────────────────
  cards_title:         20,
  cards_item_0:        30,
  cards_item_1:        30,
  cards_item_2:        30,
  cards_item_3:        30,
  cards_item_4:        30,
  cards_item_5:        30,
  cards_caption:       30,
  cards_hold:         220,  // ~7.3 s

  // ── Objectives scene ─────────────────────────────────────────────
  objectives_title:    20,
  objectives_item_0:   24,
  objectives_item_1:   24,
  objectives_item_2:   24,
  objectives_item_3:   24,
  objectives_item_4:   24,
  objectives_item_5:   24,
  objectives_caption:  30,
  objectives_hold:    220,

  // ── Evidence scene ───────────────────────────────────────────────
  evidence_title:      20,
  evidence_item_0:     24,
  evidence_item_1:     24,
  evidence_item_2:     24,
  evidence_item_3:     24,
  evidence_item_4:     24,
  evidence_item_5:     24,
  evidence_caption:    30,
  evidence_hold:      220,

  // ── Code scene ──────────────────────────────────────────────────
  code_header:         20,
  code_body:           40,
  code_notes:          30,
  code_hold:          180,  // 6.0 s

  // ── Reference preview scene ─────────────────────────────────────
  reference_title:     20,
  reference_frame:     40,
  reference_caption:   30,
  reference_hold:     180,

  // ── MCP drive scene ─────────────────────────────────────────────
  mcpdrive_prompt:     20,
  mcpdrive_calls:      34,
  mcpdrive_outcome:    28,
  mcpdrive_caption:    24,
  mcpdrive_hold:      210,

  // ── Table scene ─────────────────────────────────────────────────
  table_title:         20,
  table_header:        25,
  table_row_0:         20,
  table_row_1:         20,
  table_row_2:         20,
  table_row_3:         20,
  table_row_4:         20,
  table_row_5:         20,
  table_row_6:         20,
  table_row_7:         20,
  table_caption:       30,
  table_hold:         210,  // 7.0 s

  // ── Chart scene ─────────────────────────────────────────────────
  chart_title:         20,
  chart_frame:         30,
  chart_series_0:      30,
  chart_series_1:      30,
  chart_series_2:      30,
  chart_series_3:      30,
  chart_series_4:      30,
  chart_series_5:      30,
  chart_caption:       30,
  chart_hold:         210,  // 7.0 s

  // ── Image scene ─────────────────────────────────────────────────
  image_title:         20,
  image_frame:         30,
  image_caption:       25,
  image_hold:         210,  // 7.0 s

  // ── Image comparison scene ──────────────────────────────────────
  imagecompare_title:   20,
  imagecompare_frame:   30,
  imagecompare_caption: 25,
  imagecompare_hold:   210,  // 7.0 s

  // ── Meme scene ──────────────────────────────────────────────────
  meme_title:         20,
  meme_frame:         30,
  meme_box_0:         24,
  meme_box_1:         24,
  meme_box_2:         24,
  meme_box_3:         24,
  meme_box_4:         24,
  meme_box_5:         24,
  meme_caption:       25,
  meme_hold:         210,  // 7.0 s default dwell

  // ── Book scene ─────────────────────────────────────────────────
  book_title:         20,
  book_item_0:        30,
  book_item_1:        30,
  book_item_2:        30,
  book_caption:       30,
  book_hold:         240,  // 8.0 s
};

const fs   = require('fs');
const path = require('path');

/**
 * Frames a `video` scene contributes. Needs the source duration:
 *   - `scene.duration` (seconds) if given — explicit, no probe;
 *   - else ffprobe `scene.src` (resolved against opts.specPath);
 *   - else (a `capture:` tour, or a missing src) sum the tour's dwellMs, or fall
 *     back to scene.estimateSeconds. Estimates assume 30fps like the rest of
 *     this table.
 */
function videoSceneFrames(scene, opts = {}) {
  const fps = 30;
  const { videoFrameCount } = require('./video');
  if (scene.duration) return videoFrameCount(scene.duration, scene, fps);
  const specDir = opts.specPath ? path.dirname(opts.specPath) : process.cwd();
  if (scene.src) {
    const abs = path.resolve(specDir, scene.src);
    const dur = fs.existsSync(abs) ? require('./video').probeDuration(abs) : 0;
    if (dur) return videoFrameCount(dur, scene, fps);
  }
  if (scene.rrweb) {
    // No probe needed — the log carries its own duration (last - first event).
    const abs = path.resolve(specDir, scene.rrweb);
    if (fs.existsSync(abs)) {
      try {
        const { durationMs } = require('./rrweb-format').loadRrweb(abs);
        if (durationMs) return videoFrameCount(durationMs / 1000, scene, fps);
      } catch { /* fall through */ }
    }
  }
  if (scene.capture) {
    const tp = path.resolve(specDir, scene.capture);
    if (fs.existsSync(tp)) {
      try {
        const tour = JSON.parse(fs.readFileSync(tp, 'utf-8'));
        const pace = tour.pace != null ? tour.pace : 1;
        const ms = (tour.steps || []).reduce((s, st) => s + (st.dwellMs || 3000), 0);
        return Math.max(1, Math.round((ms / 1000) * fps * pace));
      } catch { /* fall through */ }
    }
  }
  return Math.round((scene.estimateSeconds || 10) * fps);
}

/**
 * Count how many of a meme template's caption boxes are actually filled, so the
 * estimate matches scenes/meme.js reveal sequence. Best-effort: an unknown
 * template (missing registry) falls back to 0 reveal boxes (frame only).
 */
function memeFilledBoxCount(scene) {
  try {
    const tpl = require('./memes/registry').get(scene.template);
    const boxes = (tpl && tpl.boxes) || [];
    return boxes.filter((b, i) => {
      if (scene.fields && b.field in scene.fields) return String(scene.fields[b.field] ?? '') !== '';
      if (Array.isArray(scene.text) && scene.text[i] != null) return String(scene.text[i]) !== '';
      return false;
    }).length;
  } catch (_) { return 0; }
}

/**
 * Estimate the total frame count a scene will produce when rendered.
 * Mirrors the actual reveal/hold sequence in scenes/*.js. Used by
 * --list/--estimate (no rendering) and by --skip-render (to compute
 * scene start frames without a render pass).
 *
 * NOTE: this MUST stay in lock-step with the per-scene render() logic.
 * If a scene module changes its reveal sequence, update the matching
 * branch here.
 */
function estimateScene(scene, opts = {}) {
  // video scenes produce frames straight from ffmpeg (no reveal sequence, no
  // inter_scene gap) — same count whether or not --no-gaps is set.
  if (scene.type === 'video') return videoSceneFrames(scene, opts);
  const T = TIMING;
  const hold = (k, custom) => (custom != null ? custom : T[k]);

  // --no-gaps: setState reveals fire without capturing frames; only explicit
  // hold() calls produce frames. title uses ctx.hold directly so is unchanged.
  if (opts.noGaps) {
    switch (scene.type) {
      case 'title':        return hold('title_card', scene.hold);
      case 'narrative':    return hold('narrative_hold',   scene.hold);
      case 'diagram':      return hold('diagram_hold',     scene.hold);
      case 'diagram-svg':  return hold('diagramsvg_hold',  scene.hold);
      case 'graph':        return hold('graph_hold',       scene.hold);
      case 'mermaid':      return hold('mermaid_hold',     scene.hold);
      case 'terminal-gif': return hold('termgif_hold',     scene.hold);
      case 'kitsoki-tui':  return hold('kitsokitui_hold',  scene.hold);
      case 'trace':        return hold('trace_hold',       scene.hold);
      case 'transcript': {
        const cards = (scene.cards || []).length;
        return Math.max(0, cards - 1) * (scene.cardHold ?? T.transcript_card)
             + hold('transcript_hold', scene.hold);
      }
      case 'thread':       return hold('thread_hold',      scene.hold);
      case 'cards':        return scene.hold ?? T.cards_hold ?? T.thread_hold;
      case 'personas':     return scene.hold ?? T.cards_hold ?? T.thread_hold;
      case 'objectives':   return scene.hold ?? T.objectives_hold ?? T.cards_hold;
      case 'evidence':     return scene.hold ?? T.evidence_hold ?? T.cards_hold;
      case 'code':         return scene.hold ?? T.code_hold ?? T.narrative_hold;
      case 'reference':    return scene.hold ?? T.reference_hold ?? T.code_hold ?? T.narrative_hold;
      case 'table':        return scene.hold ?? T.table_hold ?? T.trace_hold;
      case 'chart':        return scene.hold ?? T.chart_hold ?? T.diagramsvg_hold;
      case 'image':        return scene.hold ?? T.image_hold ?? T.diagramsvg_hold;
      case 'image-compare': return scene.hold ?? T.imagecompare_hold ?? T.image_hold ?? T.diagramsvg_hold;
      case 'book':         return scene.hold ?? T.book_hold ?? T.cards_hold;
      case 'meme':         return scene.hold ?? T.meme_hold ?? T.image_hold;
      case 'stat':         return hold('stat_hold',        scene.hold);
      case 'cta':          return hold('cta_hold',         scene.hold);
      case 'request':      return T.sending_ticks * T.sending_per_tick
                                + T.complete_hold;
      default:             return 100;
    }
  }

  // scene.continues: reveals apply instantly (same frame math as --no-gaps),
  // but the scene keeps its own trailing inter_scene gap. The skipped gap on
  // the PREVIOUS scene is subtracted in estimateBoundaries, which can see
  // adjacency.
  if (scene.continues) {
    return estimateScene(scene, { ...opts, noGaps: true }) + T.inter_scene;
  }

  switch (scene.type) {
    case 'title':
      return hold('title_card', scene.hold);

    case 'narrative': {
      let f = T.narrative_eyebrow + T.narrative_body;
      if (scene.lede) f += T.narrative_lede;
      f += hold('narrative_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'diagram': {
      let f = T.diagram_title;
      const panels = (scene.panels || []).length;
      for (let i = 0; i < panels; i++) f += T[`diagram_panel_${i}`] ?? 30;
      if (scene.caption) f += T.diagram_caption;
      f += hold('diagram_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'diagram-svg': {
      let f = T.diagramsvg_title;
      const panels = (scene.panels || []).length;
      for (let i = 0; i < panels; i++) f += T[`diagramsvg_panel_${i}`] ?? 30;
      if (scene.caption) f += T.diagramsvg_caption;
      f += hold('diagramsvg_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'graph': {
      const path = Array.isArray(scene.path) && scene.path.length
        ? scene.path
        : (Array.isArray(scene.focus) ? scene.focus : []);
      let f = scene.title ? T.graph_title : 0;
      f += T.graph_frame;
      for (let i = 0; i < path.length; i++) f += T[`graph_focus_${i}`] ?? 48;
      if (scene.caption) f += T.graph_caption;
      f += hold('graph_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'mermaid': {
      let f = scene.title ? T.mermaid_title : 0;
      f += T.mermaid_frame;
      if (scene.caption) f += T.mermaid_caption;
      f += hold('mermaid_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'terminal-gif':
      return T.termgif_frame + T.termgif_caption
           + hold('termgif_hold', scene.hold) + T.inter_scene;

    case 'kitsoki-tui': {
      let f = T.kitsokitui_frame + T.kitsokitui_welcome + T.kitsokitui_menu;
      if (scene.caption) f += T.kitsokitui_caption;
      f += hold('kitsokitui_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'trace': {
      let f = T.trace_title;
      const turns = (scene.turns || []).length;
      for (let i = 0; i < turns; i++) f += T[`trace_turn_${i}`] ?? 45;
      if (scene.caption) f += T.trace_caption;
      f += hold('trace_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'transcript': {
      // One dwell per turn card; the last card uses the longer scene hold.
      const cards = (scene.cards || []).length;
      let f = Math.max(0, cards - 1) * (scene.cardHold ?? T.transcript_card);
      f += hold('transcript_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'thread': {
      let f = T.thread_title;
      const panels = (scene.panels || []).length;
      for (let i = 0; i < panels; i++) f += T[`thread_panel_${i}`] ?? 40;
      if (scene.caption) f += T.thread_caption;
      f += hold('thread_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'cards': {
      const v = scene.variant || 'grid';
      const twoCol = ['before-after', 'versus', 'point-counterpoint', 'pros-cons'].includes(v);
      const n = (v === 'qa' || twoCol) ? 2 : (scene.cards || []).length;
      let f = 0;
      if (scene.title) f += T.cards_title;
      // Items beyond cards_item_5 have no table key; the renderer's setState
      // holds the generic fallback (20 frames, see renderer.js), so the estimate
      // must use the same 20 to stay in lock-step with the real reveal sequence
      // for >6-item grids (otherwise narration desyncs by 10f per extra card).
      for (let i = 0; i < n; i++) f += T[`cards_item_${i}`] ?? 20;
      if (scene.caption) f += T.cards_caption;
      f += scene.hold ?? T.cards_hold ?? T.thread_hold;
      f += T.inter_scene;
      return f;
    }

    case 'personas': {
      const n = (scene.variant === 'use-cases' ? (scene.cases || []) : (scene.personas || [])).length;
      let f = 0;
      if (scene.title) f += 20;
      for (let i = 0; i < n; i++) f += 20;
      if (scene.caption) f += 20;
      f += scene.hold ?? T.cards_hold ?? T.thread_hold;
      f += T.inter_scene;
      return f;
    }

    case 'objectives': {
      const MAX_ITEMS = 6;
      const n = Math.min(MAX_ITEMS, (scene.items || []).length);
      let f = 0;
      if (scene.title) f += T.objectives_title;
      for (let i = 0; i < n; i++) f += T[`objectives_item_${i}`] ?? 24;
      if (scene.caption) f += T.objectives_caption;
      f += scene.hold ?? T.objectives_hold ?? T.cards_hold;
      f += T.inter_scene;
      return f;
    }

    case 'evidence': {
      const MAX_ITEMS = 6;
      const n = Math.min(MAX_ITEMS, (scene.items || []).length);
      let f = 0;
      if (scene.title) f += T.evidence_title;
      for (let i = 0; i < n; i++) f += T[`evidence_item_${i}`] ?? 24;
      if (scene.caption) f += T.evidence_caption;
      f += scene.hold ?? T.evidence_hold ?? T.cards_hold;
      f += T.inter_scene;
      return f;
    }

    case 'code': {
      let f = T.code_header + T.code_body;
      if (Array.isArray(scene.annotations) && scene.annotations.length) f += T.code_notes;
      f += scene.hold ?? T.code_hold ?? T.narrative_hold;
      f += T.inter_scene;
      return f;
    }

    case 'reference': {
      let f = 0;
      if (scene.title) f += T.reference_title;
      f += T.reference_frame;
      if (scene.caption) f += T.reference_caption;
      f += scene.hold ?? T.reference_hold ?? T.code_hold ?? T.narrative_hold;
      f += T.inter_scene;
      return f;
    }

    case 'mcp-drive': {
      let f = T.mcpdrive_prompt;
      if ((scene.calls || []).length) f += T.mcpdrive_calls;
      if (scene.outcome) f += T.mcpdrive_outcome;
      if (scene.caption) f += T.mcpdrive_caption;
      f += scene.hold ?? T.mcpdrive_hold ?? T.code_hold;
      f += T.inter_scene;
      return f;
    }

    case 'table': {
      const MAX_ROWS = 8;
      const rows = (scene.rows || []).slice(0, MAX_ROWS);
      let f = T.table_title + T.table_header;
      for (let i = 0; i < rows.length; i++) f += T[`table_row_${i}`] ?? 20;
      if (scene.caption) f += T.table_caption;
      f += scene.hold ?? T.table_hold ?? T.trace_hold;
      f += T.inter_scene;
      return f;
    }

    case 'chart': {
      const v = scene.variant || 'bar';
      const n = (v === 'pie' || v === 'quadrant')
        ? 1
        : Math.max(1, (scene.series || []).length);
      let f = T.chart_title + T.chart_frame;
      for (let i = 0; i < n; i++) f += T[`chart_series_${i}`] ?? 30;
      if (scene.caption) f += T.chart_caption;
      f += scene.hold ?? T.chart_hold ?? T.diagramsvg_hold;
      f += T.inter_scene;
      return f;
    }

    case 'image': {
      let f = 0;
      if (scene.title) f += T.image_title;
      f += T.image_frame;
      if (scene.caption) f += T.image_caption;
      f += scene.hold ?? T.image_hold ?? T.diagramsvg_hold;
      f += T.inter_scene;
      return f;
    }

    case 'image-compare': {
      let f = 0;
      if (scene.title) f += T.imagecompare_title;
      f += T.imagecompare_frame;
      if (scene.caption) f += T.imagecompare_caption;
      f += scene.hold ?? T.imagecompare_hold ?? T.image_hold ?? T.diagramsvg_hold;
      f += T.inter_scene;
      return f;
    }

    case 'book': {
      let f = 0;
      if (scene.title) f += T.book_title;
      const n = Math.min(3, Math.max(0, (scene.books || []).length));
      for (let i = 0; i < n; i++) f += T[`book_item_${i}`] ?? 30;
      if (scene.caption) f += T.book_caption;
      f += scene.hold ?? T.book_hold ?? T.cards_hold;
      f += T.inter_scene;
      return f;
    }

    case 'meme': {
      let f = 0;
      if (scene.title) f += T.meme_title;
      f += T.meme_frame;
      for (let i = 0; i < memeFilledBoxCount(scene); i++) f += T[`meme_box_${i}`] ?? 24;
      if (scene.caption) f += T.meme_caption;
      f += scene.hold ?? T.meme_hold ?? T.image_hold;
      f += T.inter_scene;
      return f;
    }

    case 'stat': {
      let f = T.stat_value + T.stat_label;
      if (scene.detail) f += T.stat_detail;
      f += hold('stat_hold', scene.hold);
      f += T.inter_scene;
      return f;
    }

    case 'cta':
      return T.cta_wordmark + T.cta_tagline + T.cta_url
           + hold('cta_hold', scene.hold);

    case 'request':
      // Request scenes vary widely; rough estimate
      return T.scene_header + T.request_url + T.request_headers
           + T.request_body
           + T.sending_ticks * T.sending_per_tick
           + T.response_status + T.response_headers + T.response_body
           + T.response_annotation
           + T.complete_hold + T.inter_scene;

    default:
      return 100;
  }
}

/**
 * Build a scene-boundary list (without rendering) so --list/--estimate and
 * --skip-render can compute timestamps purely from the spec.
 *
 * @returns {object[]} [{ sceneIndex, startFrame, type, narration, durationFrames }]
 */
function estimateBoundaries(spec, selectedScenes = null, opts = {}) {
  let frame = 0;
  const out = [];
  (spec.scenes || []).forEach((scene, i) => {
    if (selectedScenes && !selectedScenes.has(i)) return;
    let durationFrames = estimateScene(scene, opts);
    // The scene before a `continues` scene drops its trailing inter_scene gap
    // (the renderer cuts straight into the continuing scene).
    const next = (spec.scenes || [])[i + 1];
    if (!opts.noGaps && next && next.continues && scene.type !== 'video') {
      durationFrames = Math.max(0, durationFrames - TIMING.inter_scene);
    }
    out.push({
      sceneIndex: i,
      startFrame: frame,
      type: scene.type,
      narration: scene.narration || null,
      durationFrames,
    });
    frame += durationFrames;
  });
  return out;
}

module.exports = TIMING;
module.exports.estimateScene = estimateScene;
module.exports.estimateBoundaries = estimateBoundaries;
