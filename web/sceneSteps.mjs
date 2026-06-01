// SLIDEY — shared reveal-step model
//
// Single source of truth for "how a scene reveals", consumed by BOTH:
//   - src/pdf.js  → one PDF page per reveal step
//   - the web app → one nav advance per reveal step
// The step sequences mirror the per-scene setState() calls in src/scenes/*.js
// (gaps/holds excluded — only the meaningful, content-adding reveals). If a
// scene module changes its reveal order, update the matching branch here.

function range(n, prefix) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

// Ordered reveal step names for a scene. Each becomes one PDF page / nav step.
// An empty array means the scene has a single fully-shown state and no
// progressive reveal (title) — callers render it as one page with no setState.
export function stepsForScene(scene) {
  const s = scene || {};
  switch (s.type) {
    case 'title':
      return [];
    case 'narrative':
      return ['narrative_eyebrow', 'narrative_body', ...(s.lede ? ['narrative_lede'] : [])];
    case 'diagram':
      return ['diagram_title', ...range((s.panels || []).length, 'diagram_panel_'),
        ...(s.caption ? ['diagram_caption'] : [])];
    case 'diagram-svg':
      return ['diagramsvg_title', ...range((s.panels || []).length, 'diagramsvg_panel_'),
        ...(s.caption ? ['diagramsvg_caption'] : [])];
    case 'terminal-gif':
      return ['termgif_frame', ...(s.caption ? ['termgif_caption'] : [])];
    case 'stat':
      return ['stat_value', 'stat_label', ...(s.detail ? ['stat_detail'] : [])];
    case 'cta':
      return ['cta_wordmark', 'cta_tagline', 'cta_url'];
    case 'trace':
      return ['trace_title', ...range((s.turns || []).length, 'trace_turn_'),
        ...(s.caption ? ['trace_caption'] : [])];
    case 'trace-turn':
      return ['traceturn_title', 'traceturn_map', ...range((s.rows || []).length, 'traceturn_row_'),
        ...((s.convo && (s.convo.messages || []).length) ? ['traceturn_detail'] : [])];
    case 'thread':
      return ['thread_title', ...range((s.panels || []).length, 'thread_panel_'),
        ...(s.caption ? ['thread_caption'] : [])];
    case 'request': {
      const r = s.request || {}, res = s.response || {};
      const steps = ['scene_header', 'request_url'];
      if ((r.headers || []).length) steps.push('request_headers');
      if (String(r.body || '').trim()) steps.push('request_body');
      steps.push('sending', 'response_status');
      if ((res.headers || []).length) steps.push('response_headers');
      if (String(res.body || '').trim()) steps.push('response_body');
      // Final state: annotation overlay if present (otherwise the last reveal
      // above already shows everything — no separate 'complete' page needed).
      if (String(res.annotation || '').trim()) steps.push('response_annotation');
      return steps;
    }
    default:
      return [];
  }
}

// Inject a scene's content via the window.slidey adapter. Runs both in Node-side
// page.evaluate (PDF) and directly in the browser (web app) — only touches
// window.slidey, the scene object, and opts, so it serializes cleanly.
export function applyShow(scene, opts) {
  const o = opts || {};
  const slidey = window.slidey;
  switch (scene.type) {
    case 'title':        slidey.showTitleCard(scene); break;
    case 'request':      slidey.loadScene(scene, { isMock: scene.mock === true, isPlayback: scene.playback === true }); break;
    case 'narrative':    slidey.showNarrative(scene); break;
    case 'diagram':      slidey.showDiagram(scene); break;
    case 'diagram-svg':  slidey.showDiagramSvg(scene); break;
    case 'terminal-gif': slidey.showTerminalGif(scene, o.gifDataUri || ''); break;
    case 'stat':         slidey.showStat(scene); break;
    case 'cta':          slidey.showCta(scene); break;
    case 'trace':        slidey.showTrace(scene); break;
    case 'trace-turn':   slidey.showTraceTurn(scene); break;
    case 'thread':       slidey.showThread(scene); break;
  }
}
