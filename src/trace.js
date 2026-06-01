/**
 * SLIDEY — Kitsoki session-trace → spec generator
 *
 * Turns a kitsoki session trace (the canonical append-only JSONL written by
 * `kitsoki run` under ~/.kitsoki/sessions/<app>/) into a slidey scene spec: a
 * title card, a state-machine overview, a per-turn boxed transcript of the whole
 * session (one card per turn, each fit to a single screen), and an end card. The
 * output is an ordinary slidey spec object, so the normal render/pdf/estimate
 * pipeline takes it from there.
 *
 * This is the video analogue of kitsoki's tools/runstatus SPA. It reads the
 * RAW trace (kind/payload shape, see kitsoki docs/tracing/trace-format.md) — no
 * dependency on `kitsoki export-status`, which expects an older slog shape.
 *
 * Design notes grounded in real traces:
 *   - FILE ORDER is the chronology. `seq` is neither dense nor reliably ordered
 *     within a turn, so we never sort by it — we preserve line order.
 *   - Turn 0 is a bootstrap turn (host.chat.create + initial world sets) with no
 *     user input; its effects open the transcript.
 *   - A turn may carry several oracle calls (e.g. converse + decide).
 *   - oracle.call.complete `meta.usage` / `meta.cost_usd` are frequently absent;
 *     every metric degrades to n/a rather than crashing.
 *   - The state map shows ROOMS (distinct state paths) and inter-room
 *     transitions. In the transcript, transitions are inline dividers.
 *   - host.oracle.* harness calls are the oracle dispatch surfaced as a host
 *     call; they are folded into the oracle rows, not shown as separate hosts.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Tunables ─────────────────────────────────────────────────────────────────
const VAL_MAX = 64;       // string-value truncation

// Layout geometry (viewBox units) for the room graph. NODE_W is a floor; boxes
// grow to fit their label so room names never spill past the box edge. CHAR_W is
// the per-character advance of the single-panel label font (44px, monospace, so
// ~0.6em) and LABEL_PAD the breathing room on each side.
const NODE_W = 230, NODE_H = 84, GAP_X = 120, GAP_Y = 46, MARGIN = 36;
const CHAR_W = 26, LABEL_PAD = 46;

// Room ids are namespaced with underscores (e.g. `__exit__abandoned`); render
// them as readable labels (`exit abandoned`) without losing the node identity.
function prettyRoom(name) {
  return String(name).replace(/^_+/, '').replace(/_+/g, ' ').trim() || String(name);
}
function nodeWidth(label) {
  return Math.max(NODE_W, Math.ceil(label.length * CHAR_W + LABEL_PAD * 2));
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Read a JSONL trace file into { header, events }. Tolerant of a torn final
 * line (a crash mid-write leaves a partial last line) and of both the current
 * `session.header` and the legacy `SessionHeader` header kinds.
 */
function loadTrace(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  let header = null;
  const events = [];
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch (err) {
      // A torn last line is expected on a crashed session; anything else is a
      // real parse error worth surfacing.
      if (i === lines.length - 1) return;
      throw new Error(`trace ${path.basename(filePath)} line ${i + 1}: ${err.message}`);
    }
    const kind = obj.kind || '';
    if (kind === 'session.header' || kind === 'SessionHeader') {
      if (!header) header = obj;
      return;
    }
    events.push(obj);
  });
  return { header, events };
}

// ── Value formatting ────────────────────────────────────────────────────────

function truncate(s, n = VAL_MAX) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Full (untruncated, but bounded) text for chat-bubble prose.
const FULL_MAX = 4000;
function fullText(v, n = FULL_MAX) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Render any value to a short, stable, single-line string. */
function fmtVal(v) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return truncate(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Object/array → compact JSON, truncated.
  try {
    return truncate(JSON.stringify(v));
  } catch {
    return truncate(String(v));
  }
}

/** RFC3339 timestamp → ms epoch, or null for the zero/sentinel year-1 time. */
function tsMs(ts) {
  if (!ts || ts.startsWith('0001-')) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

function fmtDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// ── Journey model ──────────────────────────────────────────────────────────

/**
 * Fold the flat event list into an ordered journey: turn groups (each with its
 * user input, oracle calls, transition, world diff, host calls, narration and
 * rejections), the room graph, and session-level stats. Mirrors the grouping in
 * kitsoki's tools/runstatus TraceTimeline, in file order.
 */
function buildJourney(events) {
  // Group events by turn, preserving first-seen turn order and within-turn file
  // order. A Map keeps insertion order so bootstrap turn 0 leads.
  const byTurn = new Map();
  for (const ev of events) {
    const t = ev.turn ?? 0;
    if (!byTurn.has(t)) byTurn.set(t, []);
    byTurn.get(t).push(ev);
  }

  const world = {};          // running world state (folded in file order)
  const graphNodes = [];     // distinct rooms, first-appearance order
  const nodeSeen = new Set();
  const edgeMap = new Map();  // "from to" -> Set(intents); inter-room only
  const turns = [];

  let totalOracleCalls = 0, totalTokens = 0, haveTokens = false;
  let totalCost = 0, haveCost = false;
  // Cumulative token breakdown by type (the claude-CLI usage shape).
  const tokTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let firstMs = null, lastMs = null;
  let finalState = '';

  const noteRoom = (name) => {
    if (name && !nodeSeen.has(name)) { nodeSeen.add(name); graphNodes.push(name); }
  };

  for (const [turnNo, evs] of byTurn) {
    // Pair oracle.call.start with its complete/error by call_id.
    const oracleByCall = new Map();
    const turn = {
      turn: turnNo,
      room: '',
      input: '',
      direct: false,
      oracle: [],
      transition: null,
      worldChanges: [],
      hosts: [],
      says: [],
      rejects: [],
      narration: '',      // the room's rendered view (operator-facing narration), from turn.end
      outcome: '',
    };

    // Snapshot world before this turn's effects, to diff per-key net change.
    const worldBefore = Object.assign({}, world);
    const touched = new Set();

    for (const ev of evs) {
      const p = ev.payload || {};
      const k = ev.kind;
      const ms = tsMs(ev.ts);
      if (ms != null) { if (firstMs == null) firstMs = ms; lastMs = ms; }
      if (ev.state_path && !turn.room) turn.room = ev.state_path;
      noteRoom(ev.state_path);

      switch (k) {
        case 'turn.input':
          if (p.input && !turn.input) turn.input = p.input;
          if (ev.state_path) turn.room = ev.state_path; // room the user acted from
          break;
        case 'turn.start':
          if (p.input && !turn.input) turn.input = p.input;
          if (p.direct) turn.direct = true;
          if (ev.state_path) turn.room = ev.state_path;
          break;
        case 'turn.end':
          turn.outcome = p.outcome || '';
          if (p.to) finalState = p.to;
          // The engine records the rendered room view (the operator-facing
          // narration — banner/prose/kv/headings/the questions a clarify room
          // poses) on turn.end. This IS what the operator saw; surface it so
          // the transcript shows the room's own words, not just the answers.
          if (typeof p.view === 'string' && p.view.trim()) turn.narration = p.view;
          break;
        case 'oracle.call.start':
          oracleByCall.set(ev.call_id || `s${turn.oracle.length}`, {
            verb: p.verb || 'ask', model: p.model || '', outcome: '', duration: null,
            error: '', tokens: null, cost: null,
            prompt: fullText(p.prompt), response: '',
          });
          totalOracleCalls++;
          break;
        case 'oracle.call.complete': {
          const rec = oracleByCall.get(ev.call_id) || { verb: p.verb || 'ask', model: p.model || '', prompt: '', response: '' };
          rec.duration = fmtDuration(p.duration_ms);
          rec.outcome = oracleOutcome(p.response);
          const resp = p.response;
          rec.response = (resp && typeof resp === 'object' && typeof resp.text === 'string')
            ? fullText(resp.text) : fullText(resp);
          const meta = p.meta || {};
          if (meta.usage) {
            const u = meta.usage;
            // The four token types the claude-CLI transport reports. cache_read
            // (replayed prompt) and cache_creation (newly cached) dominate real
            // sessions and are priced very differently, so we keep them distinct.
            const input = u.input_tokens || 0;
            const output = u.output_tokens || 0;
            const cacheRead = u.cache_read_input_tokens || 0;
            const cacheWrite = u.cache_creation_input_tokens || 0;
            rec.usage = { input, output, cacheRead, cacheWrite };
            const billable = input + output;        // tokens headline = fresh I/O
            if (input || output || cacheRead || cacheWrite) {
              rec.tokens = billable;
              totalTokens += billable; haveTokens = true;
              tokTotals.input += input; tokTotals.output += output;
              tokTotals.cacheRead += cacheRead; tokTotals.cacheWrite += cacheWrite;
            }
          }
          if (typeof meta.cost_usd === 'number') { rec.cost = meta.cost_usd; totalCost += meta.cost_usd; haveCost = true; }
          oracleByCall.set(ev.call_id, rec);
          if (!turn.oracle.includes(rec)) turn.oracle.push(rec);
          break;
        }
        case 'oracle.call.error': {
          const rec = oracleByCall.get(ev.call_id) || { verb: p.verb || 'ask' };
          rec.duration = fmtDuration(p.duration_ms);
          rec.error = p.error || 'error';
          oracleByCall.set(ev.call_id, rec);
          if (!turn.oracle.includes(rec)) turn.oracle.push(rec);
          break;
        }
        case 'machine.intent_accepted':
          if (!turn.intent) turn.intent = p.intent;
          break;
        case 'machine.transition':
          turn.transition = { from: p.from || '', to: p.to || '', intent: p.intent || '' };
          noteRoom(p.from); noteRoom(p.to);
          if (p.from && p.to && p.from !== p.to) {
            const key = p.from + ' ' + p.to;
            if (!edgeMap.has(key)) edgeMap.set(key, new Set());
            if (p.intent) edgeMap.get(key).add(p.intent);
          }
          if (p.to) finalState = p.to;
          break;
        case 'machine.state_entered':
          if (p.state) { noteRoom(p.state); finalState = p.state; }
          break;
        case 'machine.say':
          if (p.text) turn.says.push(p.text);
          break;
        case 'machine.validation_failed':
          turn.rejects.push({ code: p.code || 'validation_failed', reason: p.reason || '' });
          break;
        case 'machine.guard_rejected':
          turn.rejects.push({ code: 'guard_rejected', reason: p.reason || (p.guards || []).join(', ') });
          break;
        case 'world.update': {
          // Fold set + increment into the running world; diff is computed
          // per-turn (net before→after) after the loop.
          const set = p.set || {};
          for (const key of Object.keys(set)) { world[key] = set[key]; touched.add(key); }
          const inc = p.increment || {};
          for (const key of Object.keys(inc)) {
            const cur = typeof world[key] === 'number' ? world[key] : 0;
            world[key] = cur + inc[key]; touched.add(key);
          }
          break;
        }
        case 'harness.returned': {
          // Match the call by namespace; capture error/data. Skip host.oracle.*
          // (folded into oracle rows).
          const ns = p.namespace || '';
          if (ns.startsWith('host.oracle.')) break;
          turn.hosts.push({
            name: ns,
            ok: !p.error,
            detail: p.error ? truncate(p.error) : (p.data ? fmtVal(p.data) : ''),
            duration: fmtDuration(p.duration_ms),
          });
          break;
        }
        default:
          break; // harness.called/dispatched/oracle.tool_call/state_exited etc.
      }
    }

    // Per-key net world diff for this turn.
    for (const key of touched) {
      const before = worldBefore[key];
      const after = world[key];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      turn.worldChanges.push({ key, before: fmtVal(before), after: fmtVal(after) });
    }

    if (!turn.room) turn.room = turn.transition ? turn.transition.from : (finalState || (graphNodes[0] || ''));
    turns.push(turn);
  }

  // Build edge list (deterministic order: by first appearance via Map order).
  const edges = [];
  for (const [key, intents] of edgeMap) {
    const [from, to] = key.split(' ');
    edges.push({ from, to, label: [...intents].sort().join(' / ') });
  }

  const spanMs = (firstMs != null && lastMs != null) ? (lastMs - firstMs) : null;
  return {
    turns,
    graph: { nodes: graphNodes, edges },
    finalState,
    stats: {
      turns: turns.filter(t => t.turn !== 0).length,
      oracleCalls: totalOracleCalls,
      tokens: haveTokens ? totalTokens : null,
      tokensByType: haveTokens ? tokTotals : null,
      cost: haveCost ? totalCost : null,
      durationMs: spanMs,
    },
  };
}

/** Summarise an oracle response for a one-line outcome label. */
function oracleOutcome(response) {
  if (!response || typeof response !== 'object') return response ? fmtVal(response) : '';
  if (response.intent) return `intent: ${response.intent}`;
  if (response.decision) return `decision: ${fmtVal(response.decision)}`;
  if (response.choice) return `choice: ${fmtVal(response.choice)}`;
  if (typeof response.text === 'string') return `“${truncate(response.text, 50)}”`;
  return fmtVal(response);
}

// ── Graph layout ──────────────────────────────────────────────────────────

/**
 * Deterministic layered layout. BFS depth from the first room over inter-room
 * edges → columns by depth, rows by first-appearance within a column. Returns a
 * diagram-svg panel shape ({ viewBox, nodes:[{id,label,x,y,w,h}], edges }).
 */
function layoutGraph(graph) {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { viewBox: '0 0 400 200', nodes: [], edges: [] };

  const adj = new Map(nodes.map(n => [n, []]));
  for (const e of edges) if (adj.has(e.from)) adj.get(e.from).push(e.to);

  // BFS depth from the first node; unreachable nodes land one past the max.
  const depth = new Map();
  depth.set(nodes[0], 0);
  const queue = [nodes[0]];
  while (queue.length) {
    const cur = queue.shift();
    for (const nxt of adj.get(cur) || []) {
      const d = depth.get(cur) + 1;
      if (!depth.has(nxt) || d < depth.get(nxt)) { depth.set(nxt, d); queue.push(nxt); }
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const n of nodes) if (!depth.has(n)) depth.set(n, ++maxDepth);

  // Columns by depth, rows by appearance.
  const columns = new Map();
  for (const n of nodes) {
    const d = depth.get(n);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(n);
  }

  // Each box grows to fit its (prettified) label; a column is as wide as its
  // widest box, and the left edge of column d is the running sum of the columns
  // before it. This keeps long room names inside their boxes regardless of how
  // the whole graph scales to fit the stage.
  const depths = [...columns.keys()].sort((a, b) => a - b);
  const colWidth = new Map();
  for (const d of depths) {
    colWidth.set(d, Math.max(...columns.get(d).map(n => nodeWidth(prettyRoom(n)))));
  }
  const colX = new Map();
  let runX = MARGIN;
  for (const d of depths) { colX.set(d, runX); runX += colWidth.get(d) + GAP_X; }

  const placed = [];
  let maxRows = 0;
  for (const d of depths) maxRows = Math.max(maxRows, columns.get(d).length);
  for (const d of depths) {
    const cw = colWidth.get(d);
    columns.get(d).forEach((name, row) => {
      const w = nodeWidth(prettyRoom(name));
      placed.push({
        id: name,
        label: prettyRoom(name),
        x: colX.get(d) + (cw - w) / 2,   // centre narrower boxes within the column
        y: MARGIN + row * (NODE_H + GAP_Y),
        w,
        h: NODE_H,
      });
    });
  }

  const vbW = runX - GAP_X + MARGIN;
  const vbH = MARGIN * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  return { viewBox: `0 0 ${vbW} ${Math.max(vbH, NODE_H + MARGIN * 2)}`, nodes: placed, edges };
}

// ── Spec assembly ──────────────────────────────────────────────────────────

// Transcript tunables.
const MSG_MAX = 1600;       // chat-bubble text truncation (full prose for a card)
const PROMPT_PREVIEW = 200; // dim collapsed engineered-prompt preview
const TX_WORLD_KEYS = 8;    // world-diff keys shown inline before "+N more"
const CARD_TOOLS_SHOWN = 6; // host-call rows shown per card before "+N more calls"
const NARRATION_MAX = 1800; // rendered room-view (narration) truncation per card

/** Collapse whitespace for prompt previews and say/text dedup. */
function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

// ── Source-colour sentinels (LLM- vs template-generated text) ────────────────
//
// kitsoki marks LLM-generated spans inside a rendered room view with a pair of
// zero-width Unicode sentinels (the same scheme the TUI's `sourcecolor` package
// paints in dark mode: template text on cool slate, LLM text on warm bronze).
// The sentinels survive pongo2 rendering and ride along in the recorded
// `turn.end.view`, so the narration we already capture carries provenance for
// free — we just parse and re-paint it on the slide. See kitsoki
// internal/render/sourcecolor/sourcecolor.go for the source-side definition.
const LLM_OPEN = '⁣⁡⁡⁣';  // U+2063 U+2061 U+2061 U+2063
const LLM_CLOSE = '⁣⁢⁢⁣'; // U+2063 U+2062 U+2062 U+2063

/** Strip the source-colour sentinels, leaving the plain visible text. */
function stripSentinels(s) {
  return String(s || '').split(LLM_OPEN).join('').split(LLM_CLOSE).join('');
}

// A recorded view may carry the room's own ANSI styling baked in (lipgloss
// SGR colour for banners/headings) when it was rendered to a colour terminal.
// slidey is HTML and applies its own styling, so we strip CSI escape sequences
// — otherwise the raw codes (e.g. `\x1b[38;2;159;138;240m`) show as literal
// `[38;2;…m` text. The zero-width source-colour sentinels are NOT ANSI and
// survive this; they carry the LLM/template distinction we re-paint ourselves.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(s) { return String(s || '').replace(ANSI_RE, ''); }

/**
 * Parse a rendered room view into provenance segments [{ llm, text }], walking
 * the LLM open/close sentinels with a depth counter — the same stack the TUI's
 * Colorize uses. Two robustness rules keep a slide from bleed-painting:
 *
 *   - A dangling OPEN (its CLOSE dropped when the engine truncated a value
 *     mid-span, e.g. a `truncatechars`'d `Idea:` field) auto-closes at the next
 *     blank line, so the warm band stops at the value instead of running to the
 *     end of the view.
 *   - Truncation is by VISIBLE length (sentinels are zero-width and never count
 *     toward `max`), and appends an ellipsis like the plain-text truncate().
 */
function segmentNarration(raw, max = Infinity) {
  raw = stripAnsi(String(raw || ''));
  const segs = [];
  let i = 0, depth = 0, vis = 0, buf = '';
  const flush = (llm) => { if (buf) { segs.push({ llm, text: buf }); buf = ''; } };
  while (i < raw.length && vis < max) {
    if (raw.startsWith(LLM_OPEN, i)) { flush(depth > 0); depth++; i += LLM_OPEN.length; continue; }
    if (raw.startsWith(LLM_CLOSE, i)) { flush(depth > 0); if (depth > 0) depth--; i += LLM_CLOSE.length; continue; }
    // Dangling-open guard: inside an LLM span, a blank line (\n, optional
    // whitespace, \n) force-closes the span so a truncation-dropped CLOSE
    // can't paint the rest of the view.
    if (depth > 0 && raw[i] === '\n') {
      let j = i + 1;
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t')) j++;
      if (j < raw.length && raw[j] === '\n') {
        buf += '\n'; vis++; i++;
        flush(true); depth = 0; continue;
      }
    }
    buf += raw[i]; vis++; i++;
  }
  flush(depth > 0);
  if (i < raw.length) {
    if (segs.length) segs[segs.length - 1].text += '…';
    else segs.push({ llm: false, text: '…' });
  }
  return segs;
}

/**
 * Fold the whole journey into a per-turn boxed transcript — the session as a
 * sequence of conversation cards, ONE CARD PER TURN, each meant to fit a single
 * screen. The renderers (video dwell / PDF page) show one card at a time, so a
 * long session reads as an ongoing conversation advancing turn by turn rather
 * than a single tall scroll.
 *
 * Two parallel views are returned:
 *   - `entries`: the flat reading-order stream (user → replies → side effects →
 *     transition), kept as the intermediate the cards are folded from.
 *   - `cards`:   the entries regrouped by turn, the structure the scene renders.
 *
 * Every card LEADS with the user input — a slide is one turn, and a turn is
 * driven by an intent. Cards with no user input (the bootstrap turn 0, a
 * background-completion turn) are dropped: it makes no sense to "enter a room"
 * on screen before the intent that took us there is known, and the view the
 * user was looking at when they typed lives on the PRECEDING card anyway.
 *
 * Each card carries:
 *   user     — the player's input bubble for the turn; cards without one are
 *              not emitted, so this is always present.
 *   roomView — THIS turn's rendered room view (operator-facing narration),
 *              shown BELOW the input: the room as it re-rendered after the
 *              intent. The view that PRECEDED this intent is the previous
 *              turn's view, already shown on the previous card — so it is not
 *              repeated here (input-then-result, not prompt-then-input). Held
 *              as `roomViewSegments` ([{llm,text}] for the source-colour paint)
 *              plus a plain `roomView` string for presence/fallback.
 *   flow     — the conversational items in order: assistant/say prose bubbles
 *              and structured decide/choose rows
 *   effects  — the turn's mechanics BELOW the conversation: host/tool calls,
 *              the net world diff, guard/validation rejections, and the closing
 *              state transition
 *   effectsMore — host calls beyond CARD_TOOLS_SHOWN, collapsed to a count
 *   progress — the cumulative spend/turn snapshot as of the END of the turn
 *
 * Entry roles (the flat stream): user · assistant · decision · tool · world ·
 * reject · transition.
 */
function buildTranscript(journey) {
  const entries = [];
  const cards = [];
  const totalTurns = journey.stats.turns;     // excludes bootstrap turn 0
  const haveTokens = !!journey.stats.tokensByType;
  const haveCost = journey.stats.cost != null;

  // Running cumulative totals, snapshotted onto every entry as `progress` so the
  // scene's status chrome can show how far through the session you are and what
  // the conversation has cost SO FAR through the turn on screen.
  const run = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let ordinal = 0;                             // current turn number (1-based)

  // Entries for the turn currently being assembled (folded into a card at the
  // end of the turn). `add` appends to both the flat stream and this buffer.
  let turnEntries = [];
  const add = (entry) => {
    entry.progress = {
      turn: ordinal, turns: totalTurns,
      input: run.input, output: run.output, cacheRead: run.cacheRead, cacheWrite: run.cacheWrite,
      tokens: run.input + run.output + run.cacheRead + run.cacheWrite,
      cost: run.cost,
    };
    entries.push(entry);
    turnEntries.push(entry);
  };

  // Fold one turn's reading-order entries into a single boxed card. A card is
  // emitted only when the turn has a user input — every slide leads with one.
  const foldCard = (turn) => {
    if (!turnEntries.length) return;
    if (!turnEntries.some((e) => e.role === 'user')) return; // no input → no card
    const card = {
      turn: ordinal,
      room: prettyRoom(turn.room || ''),
      roomView: '',          // THIS turn's rendered view (narration), shown below the input
      roomViewSegments: null,
      user: null,
      flow: [],
      effects: [],
      effectsMore: 0,
    };
    let toolsShown = 0;
    for (const e of turnEntries) {
      switch (e.role) {
        case 'user':
          card.user = { text: e.text, direct: !!e.direct };
          break;
        case 'assistant':
          card.flow.push({ kind: 'assistant', tag: e.say ? 'say' : (e.verb || 'assistant'), model: e.model || '', text: e.text });
          break;
        case 'decision':
          card.flow.push({ kind: 'decision', verb: e.verb, model: e.model || '', outcome: e.outcome, error: !!e.error });
          break;
        case 'tool':
          if (toolsShown < CARD_TOOLS_SHOWN) {
            card.effects.push({ kind: 'tool', name: e.name, ok: e.ok, detail: e.detail, duration: e.duration });
            toolsShown++;
          } else card.effectsMore++;
          break;
        case 'world':
          card.effects.push({ kind: 'world', changes: e.changes, more: e.more });
          break;
        case 'reject':
          card.effects.push({ kind: 'reject', text: e.text });
          break;
        case 'transition':
          card.effects.push({ kind: 'transition', from: e.from, to: e.to, intent: e.intent, self: e.self });
          break;
        default:
          break;
      }
      card.progress = e.progress; // last entry wins → end-of-turn cumulative
    }
    // This turn's own rendered room view (input-then-result): the room as it
    // re-rendered after the intent. roomViewSegments carries the LLM- vs
    // template-generated provenance for the source-colour paint; roomView is
    // the plain (sentinel-free) text for presence checks and fallback render.
    if (turn.narration) {
      const segs = segmentNarration(turn.narration, NARRATION_MAX);
      card.roomViewSegments = segs;
      card.roomView = segs.map((s) => s.text).join('');
    }
    cards.push(card);
  };

  for (const turn of journey.turns) {
    if (turn.turn !== 0) ordinal++;            // bootstrap turn 0 stays "turn 0"
    turnEntries = [];

    if (turn.input) {
      add({ role: 'user', text: truncate(turn.input, MSG_MAX), direct: !!turn.direct, turn: turn.turn });
    }

    const replyTexts = [];
    for (const o of turn.oracle) {
      // Accrue this call's cost/tokens BEFORE its entry, so the reply row already
      // reflects what it cost.
      if (o.usage) {
        run.input += o.usage.input; run.output += o.usage.output;
        run.cacheRead += o.usage.cacheRead; run.cacheWrite += o.usage.cacheWrite;
      }
      if (typeof o.cost === 'number') run.cost += o.cost;

      const prompt = o.prompt ? truncate(norm(o.prompt), PROMPT_PREVIEW) : '';
      if (o.error) {
        add({ role: 'decision', verb: o.verb, model: o.model, outcome: `error: ${o.error}`, error: true, prompt });
        continue;
      }
      // oracleOutcome wraps free prose in “ ”; anything else is a structured result.
      const isText = typeof o.outcome === 'string' && o.outcome.startsWith('“');
      if (isText && o.response) {
        add({ role: 'assistant', verb: o.verb, model: o.model, text: truncate(o.response, MSG_MAX), prompt });
        replyTexts.push(norm(o.response));
      } else {
        add({ role: 'decision', verb: o.verb, model: o.model, outcome: o.outcome || '∅', prompt });
      }
    }

    // Surface a say only when it isn't already the substance of an oracle reply.
    for (const s of turn.says) {
      const n = norm(s);
      if (replyTexts.some(t => t.includes(n) || n.includes(t))) continue;
      add({ role: 'assistant', text: truncate(s, MSG_MAX), say: true });
    }

    for (const h of turn.hosts) add({ role: 'tool', name: h.name, ok: h.ok, detail: h.detail, duration: h.duration });

    if (turn.worldChanges.length) {
      const shown = turn.worldChanges.slice(0, TX_WORLD_KEYS);
      add({ role: 'world', changes: shown, more: Math.max(0, turn.worldChanges.length - shown.length) });
    }

    for (const r of turn.rejects) add({ role: 'reject', text: r.reason ? `${r.code}: ${r.reason}` : r.code });

    if (turn.transition && turn.transition.from && turn.transition.to) {
      const tr = turn.transition;
      add({ role: 'transition', from: tr.from, to: tr.to, intent: tr.intent, self: tr.from === tr.to });
    }

    foldCard(turn);
  }

  const totals = {
    turns: totalTurns,
    tokens: haveTokens ? (run.input + run.output + run.cacheRead + run.cacheWrite) : null,
    input: run.input, output: run.output, cacheRead: run.cacheRead, cacheWrite: run.cacheWrite,
    cost: haveCost ? run.cost : null,
    haveTokens, haveCost,
  };
  return { entries, cards, totals };
}

/**
 * Build a full slidey spec from a journey: title → state-machine overview →
 * one continuous conversation transcript → end card.
 * @param {object} journey   buildJourney() result
 * @param {object} opts       { app, session }
 */
function buildSpec(journey, opts = {}) {
  const app = opts.app || 'kitsoki';
  const session = opts.session || '';
  const base = layoutGraph(journey.graph);
  const scenes = [];

  // 1. Title.
  scenes.push({
    type: 'title',
    eyebrow: 'kitsoki session trace',
    title: app,
    subtitle: [session && `session ${session.slice(0, 8)}`, `${journey.stats.turns} turns`,
      journey.finalState && `ended in ${journey.finalState}`].filter(Boolean).join('  ·  '),
  });

  // 2. State-machine overview (full traversed graph). The room the session ended
  //    in is highlighted (style: primary) so the eye lands on where the journey
  //    came to rest; the opening room is marked secondary.
  if (base.nodes.length) {
    const startId = base.nodes[0].id;
    for (const n of base.nodes) {
      if (n.id === journey.finalState) n.style = 'primary';
      else if (n.id === startId) n.style = 'secondary';
    }
    scenes.push({
      type: 'diagram-svg',
      title: 'State machine — path taken',
      panels: [base],
      caption: `${base.nodes.length} rooms · ${base.edges.length} transitions`,
      hold: 180,
    });
  }

  // 3. The session as a per-turn boxed conversation — one card per turn, each
  //    fit to a screen, advancing one at a time (a continuation marker carries
  //    the "same ongoing conversation" thread across cards). The status chrome
  //    (turn progress + cumulative token/cost meters) reads the current card's
  //    `progress` snapshot and the scene-level `totals`.
  const transcript = buildTranscript(journey);
  scenes.push({
    type: 'transcript',
    title: app,
    subtitle: [session && `session ${session.slice(0, 8)}`, `${journey.stats.turns} turns`,
      journey.finalState && `ended in ${journey.finalState}`].filter(Boolean).join('  ·  '),
    // Identity for the merged status row (single-line HUD): app + short session +
    // the room the session ended in.
    app,
    session: session ? session.slice(0, 8) : '',
    ended: journey.finalState || '',
    cards: transcript.cards,
    totals: transcript.totals,
    hold: 150,
  });

  // 4. End card.
  scenes.push({
    type: 'cta',
    wordmark: 'kitsoki',
    tagline: 'every decision recorded · every run replayable',
    url: '',
  });

  return {
    meta: {
      mode: 'pitch',
      title: `${app} — session ${session.slice(0, 8)}`,
    },
    scenes,
  };
}

/** Convenience: file path → spec. Derives app (parent dir) and session (filename). */
function buildSpecFromFile(filePath, opts = {}) {
  const { events } = loadTrace(filePath);
  const journey = buildJourney(events);
  const app = opts.app || path.basename(path.dirname(filePath));
  const base = path.basename(filePath, '.jsonl');
  const session = opts.session || base.split('-')[0] || base;
  return buildSpec(journey, { app, session });
}

module.exports = {
  loadTrace,
  buildJourney,
  buildTranscript,
  layoutGraph,
  buildSpec,
  buildSpecFromFile,
  segmentNarration,
  stripSentinels,
};
