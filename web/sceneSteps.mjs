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
  // `instant: true` — reveal the whole scene at once (no progressive build, no
  // title-only first page). One PDF page / one nav advance for the entire scene.
  if (s.instant && s.type !== 'title') return ['reveal_all'];
  switch (s.type) {
    case 'title':
      return [];
    case 'video':
      // Rendered as a single poster page in PDF/PNG export (the MP4 itself is
      // only produced for video output). No progressive reveal.
      return [];
    case 'narrative':
      return ['narrative_eyebrow', 'narrative_body', ...(s.lede ? ['narrative_lede'] : [])];
    case 'diagram':
      return ['diagram_title', ...range((s.panels || []).length, 'diagram_panel_'),
        ...(s.caption ? ['diagram_caption'] : [])];
    case 'diagram-svg':
      return [...(s.skipTitle ? [] : ['diagramsvg_title']),
        ...range((s.panels || []).length, 'diagramsvg_panel_'),
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
    case 'transcript':
      // One boxed card per turn; each card is its own reveal step → one PDF
      // page / nav advance. The component shows the card at the latest step.
      return range((s.cards || []).length, 'transcript_card_');
    case 'thread':
      return ['thread_title', ...range((s.panels || []).length, 'thread_panel_'),
        ...(s.caption ? ['thread_caption'] : [])];
    case 'cards': {
      const v = s.variant || 'grid';
      const twoCol = ['before-after', 'versus', 'point-counterpoint', 'pros-cons'].includes(v);
      const n = (v === 'qa' || twoCol) ? 2 : (s.cards || []).length;
      return [
        ...(s.title ? ['cards_title'] : []),
        ...range(n, 'cards_item_'),
        ...(s.caption ? ['cards_caption'] : []),
      ];
    }
    case 'code': {
      return ['code_header', 'code_body',
        ...(Array.isArray(s.annotations) && s.annotations.length ? ['code_notes'] : [])];
    }
    case 'table': {
      const MAX_ROWS = 8;
      const rows = (s.rows || []).slice(0, MAX_ROWS);
      return ['table_title', 'table_header',
        ...range(rows.length, 'table_row_'),
        ...(s.caption ? ['table_caption'] : [])];
    }
    case 'chart': {
      const v = s.variant || 'bar';
      const n = (v === 'pie' || v === 'quadrant')
        ? 1
        : Math.max(1, (s.series || []).length);
      return ['chart_title', 'chart_frame',
        ...range(n, 'chart_series_'),
        ...(s.caption ? ['chart_caption'] : [])];
    }
    case 'image':
      return [...(s.title ? ['image_title'] : []), 'image_frame',
        ...(s.caption ? ['image_caption'] : [])];
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
    case 'transcript':   slidey.showTranscript(scene); break;
    case 'thread':       slidey.showThread(scene); break;
    case 'cards':        slidey.showCards(scene); break;
    case 'code':         slidey.showCode(scene); break;
    case 'table':        slidey.showTable(scene); break;
    case 'chart':        slidey.showChart(scene); break;
    case 'image':        slidey.showImage(scene, o.imageDataUri || ''); break;
    // video: only the interactive viewer renders it live (the headless render +
    // PDF/PNG export handle video scenes natively). Guard so render adapters
    // without showVideo (export contexts) don't throw.
    case 'video':        if (slidey.showVideo) slidey.showVideo(scene, o.rrweb || null); break;
  }
}
