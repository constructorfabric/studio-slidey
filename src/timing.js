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

  // ── Trace scene ─────────────────────────────────────────────────
  trace_title:         20,
  trace_turn_0:        45,  // 1.5 s per turn — slow enough to read
  trace_turn_1:        45,
  trace_turn_2:        45,
  trace_caption:       30,
  trace_hold:         180,  // 6.0 s

  // ── Thread scene — issue-tracker comment threads ───────────
  thread_title:        20,
  thread_panel_0:      40,  // ~1.3 s per panel reveal
  thread_panel_1:      40,
  thread_panel_2:      40,
  thread_caption:      30,
  thread_hold:        300,  // 10 s — generous read time for two threads
};

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
  const T = TIMING;
  const hold = (k, custom) => (custom != null ? custom : T[k]);

  // --no-gaps: setState reveals fire without capturing frames; only explicit
  // hold() calls produce frames. title uses ctx.hold directly so is unchanged.
  if (opts.noGaps) {
    switch (scene.type) {
      case 'title':        return T.title_card;
      case 'narrative':    return hold('narrative_hold',   scene.hold);
      case 'diagram':      return hold('diagram_hold',     scene.hold);
      case 'diagram-svg':  return hold('diagramsvg_hold',  scene.hold);
      case 'terminal-gif': return hold('termgif_hold',     scene.hold);
      case 'trace':        return hold('trace_hold',       scene.hold);
      case 'thread':       return hold('thread_hold',      scene.hold);
      case 'stat':         return hold('stat_hold',        scene.hold);
      case 'cta':          return hold('cta_hold',         scene.hold);
      default:             return 100;
    }
  }

  switch (scene.type) {
    case 'title':
      return T.title_card;

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

    case 'terminal-gif':
      return T.termgif_frame + T.termgif_caption
           + hold('termgif_hold', scene.hold) + T.inter_scene;

    case 'trace': {
      let f = T.trace_title;
      const turns = (scene.turns || []).length;
      for (let i = 0; i < turns; i++) f += T[`trace_turn_${i}`] ?? 45;
      if (scene.caption) f += T.trace_caption;
      f += hold('trace_hold', scene.hold);
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
    const durationFrames = estimateScene(scene, opts);
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
