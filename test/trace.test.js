'use strict';

// Generator golden test for src/trace.js. Runs against a committed synthetic
// cloak-style trace (examples/fixtures/cloak-session.jsonl) that exercises the
// rich paths: oracle start/complete pairing with usage+cost, world set +
// increment fold (net before→after), a host call, a say, a guard rejection, a
// self-loop transition, and an inter-room edge. Fast (no I/O beyond one read).
//
//   node --test

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const t = require('../src/trace');

const FIXTURE = path.join(__dirname, '..', 'examples', 'fixtures', 'cloak-session.jsonl');

function journey() {
  const { events } = t.loadTrace(FIXTURE);
  return t.buildJourney(events);
}

test('turn grouping by file order', () => {
  const j = journey();
  assert.equal(j.turns.length, 2);
  assert.equal(j.turns[0].turn, 1);
  assert.equal(j.turns[1].turn, 2);
});

test('oracle calls pair by call_id and carry usage + cost', () => {
  const j = journey();
  assert.equal(j.stats.oracleCalls, 2);
  assert.equal(j.stats.tokens, 900);          // (400+50) + (420+30)
  assert.ok(Math.abs(j.stats.cost - 0.0061) < 1e-9);
  const o = j.turns[0].oracle[0];
  assert.equal(o.verb, 'decide');
  assert.equal(o.outcome, 'intent: go');
  assert.equal(o.duration, '1.2s');
  assert.equal(o.cost, 0.0033);
  assert.equal(o.tokens, 450);
});

test('world diff folds set + increment to net before→after', () => {
  const j = journey();
  const c1 = j.turns[0].worldChanges;
  const loc = c1.find(c => c.key === 'location');
  const moves1 = c1.find(c => c.key === 'moves');
  assert.deepEqual({ before: loc.before, after: loc.after }, { before: '∅', after: 'bar' });
  assert.deepEqual({ before: moves1.before, after: moves1.after }, { before: '∅', after: '1' });
  // moves carries forward across turns: 1 → 2 in turn 2.
  const moves2 = j.turns[1].worldChanges.find(c => c.key === 'moves');
  assert.deepEqual({ before: moves2.before, after: moves2.after }, { before: '1', after: '2' });
});

test('graph: distinct rooms as nodes, inter-room transitions as edges (no self-loops)', () => {
  const j = journey();
  assert.deepEqual(j.graph.nodes, ['foyer', 'bar']);
  assert.equal(j.graph.edges.length, 1);
  assert.deepEqual(j.graph.edges[0], { from: 'foyer', to: 'bar', label: 'go' });
});

test('host call, say and guard rejection are captured', () => {
  const j = journey();
  const t1 = j.turns[0];
  assert.ok(t1.hosts.some(h => h.name === 'host.notify' && h.ok));
  assert.ok(t1.says.some(s => s.includes('pitch dark')));
  assert.ok(j.turns[1].rejects.some(r => r.code === 'guard_rejected'));
});

test('self-loop transition is flagged on the turn', () => {
  const j = journey();
  assert.equal(j.turns[1].transition.from, 'bar');
  assert.equal(j.turns[1].transition.to, 'bar');
});

test('buildSpec is deterministic and emits the expected scene arc', () => {
  const j = journey();
  const a = JSON.stringify(t.buildSpec(j, { app: 'cloak', session: 'abcd1234' }));
  const b = JSON.stringify(t.buildSpec(j, { app: 'cloak', session: 'abcd1234' }));
  assert.equal(a, b);
  const spec = t.buildSpec(j, { app: 'cloak', session: 'abcd1234' });
  const types = spec.scenes.map(s => s.type);
  // Title → state-machine overview → ONE continuous transcript → end card.
  assert.deepEqual(types, ['title', 'diagram-svg', 'transcript', 'cta']);
  // No per-turn slides, and no stats recap.
  assert.equal(types.filter(x => x === 'trace-turn').length, 0);
  assert.equal(types.filter(x => x === 'stat').length, 0);
  const tx = spec.scenes.find(s => s.type === 'transcript');
  assert.ok(Array.isArray(tx.cards) && tx.cards.length > 0);
});

test('transcript: one continuous chat across all turns, with inline mechanics in reading order', () => {
  const j = journey();
  const e = t.buildTranscript(j).entries;

  // Leads with the first turn's user input.
  assert.equal(e[0].role, 'user');
  assert.match(e[0].text, /go south/);

  // A decide call has no free prose — it is an inline structured decision.
  const dec = e.find(x => x.role === 'decision' && x.verb === 'decide');
  assert.equal(dec.outcome, 'intent: go');

  // A say distinct from any oracle reply surfaces as an assistant bubble.
  assert.ok(e.some(x => x.role === 'assistant' && x.say && x.text.includes('pitch dark')));

  // Mechanics are inline entries: host call, world diff, transition divider.
  assert.ok(e.some(x => x.role === 'tool' && x.name === 'host.notify' && x.ok === true));
  assert.ok(e.some(x => x.role === 'world' && x.changes.some(c => c.key === 'location' && c.after === 'bar')));
  assert.ok(e.some(x => x.role === 'transition' && x.self === false && x.from === 'foyer' && x.to === 'bar'));

  // Both turns are present in the single flow (turn 2's self-stay divider).
  assert.ok(e.some(x => x.role === 'transition' && x.self === true && x.to === 'bar'));

  // Within turn 1, user precedes its decision which precedes the transition divider.
  const iUser = e.findIndex(x => x.role === 'user');
  const iDec = e.findIndex(x => x.role === 'decision');
  const iTrans = e.findIndex(x => x.role === 'transition');
  assert.ok(iUser < iDec && iDec < iTrans);
});

test('transcript: a converse reply becomes a prose bubble; the prompt collapses; a duplicate say is dropped', () => {
  // Inline synthetic turn — exercises the converse-text path the golden fixture
  // (decide-only) does not: prose bubble + bounded prompt preview + say dedup.
  const events = [
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'tell me a joke' } },
    { turn: 1, kind: 'oracle.call.start', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', model: 'claude-sonnet-4-6', prompt: 'You are a helpful narrator. '.repeat(40) } },
    { turn: 1, kind: 'oracle.call.complete', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', response: { text: 'Why did the chicken cross the road?' } } },
    { turn: 1, kind: 'machine.say', state_path: 'idle', payload: { text: 'Why did the chicken cross the road?' } },
    { turn: 1, kind: 'world.update', state_path: 'idle', payload: { increment: { jokes: 1 } } },
  ];
  const e = t.buildTranscript(t.buildJourney(events)).entries;
  assert.equal(e[0].role, 'user');
  const reply = e.find(x => x.role === 'assistant' && x.verb === 'converse');
  assert.match(reply.text, /chicken cross the road/);                 // free prose → bubble
  assert.ok(reply.prompt.length > 0 && reply.prompt.length <= 200);   // engineered prompt collapsed
  assert.equal(e.filter(x => x.role === 'assistant' && x.say).length, 0); // say == reply → dropped
  assert.ok(e.some(x => x.role === 'world' && x.changes.some(c => c.key === 'jokes')));
});

test('buildTranscript is exported and the cards it folds are what buildSpec ships', () => {
  const j = journey();
  const direct = t.buildTranscript(j).cards;
  const viaSpec = t.buildSpec(j, { app: 'cloak', session: 'abcd1234' })
    .scenes.find(s => s.type === 'transcript').cards;
  assert.deepEqual(direct, viaSpec);
});

test('transcript cards: one boxed card per turn, conversation up top and mechanics below', () => {
  const j = journey();
  const { cards, entries } = t.buildTranscript(j);
  // One card per turn that produced entries (the two real turns here).
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(c => c.turn), [1, 2]);
  assert.equal(cards.every(c => c.bootstrap === false), true);

  // Turn 1: user bubble + a decide row in the flow; the host call, world diff
  // and transition are mechanics in `effects`, BELOW the conversation.
  const c1 = cards[0];
  assert.match(c1.user.text, /go south/);
  assert.ok(c1.flow.some(f => f.kind === 'decision' && f.outcome === 'intent: go'));
  assert.equal(c1.flow.every(f => f.kind === 'assistant' || f.kind === 'decision'), true);
  assert.ok(c1.effects.some(e => e.kind === 'tool' && e.name === 'host.notify' && e.ok === true));
  assert.ok(c1.effects.some(e => e.kind === 'world' && e.changes.some(x => x.key === 'location' && x.after === 'bar')));
  assert.ok(c1.effects.some(e => e.kind === 'transition' && e.self === false && e.from === 'foyer' && e.to === 'bar'));

  // Turn 2 keeps its self-stay transition and a guard rejection.
  const c2 = cards[1];
  assert.ok(c2.effects.some(e => e.kind === 'transition' && e.self === true && e.to === 'bar'));
  assert.ok(c2.effects.some(e => e.kind === 'reject'));

  // A card's progress is the end-of-turn cumulative — the last entry of its turn.
  const lastOfTurn1 = [...entries].reverse().find(e => e.progress.turn === 1);
  assert.deepEqual(c1.progress, lastOfTurn1.progress);
});

test('transcript cards: a turn with many host calls keeps the box bounded with a "+N more" count', () => {
  // 9 host calls in one turn — the card shows the first six and collapses the rest.
  const events = [
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'do a lot' } },
  ];
  for (let i = 0; i < 9; i++) {
    events.push({ turn: 1, kind: 'harness.returned', state_path: 'idle',
      payload: { namespace: `host.step${i}`, data: { ok: true } } });
  }
  const c = t.buildTranscript(t.buildJourney(events)).cards[0];
  const tools = c.effects.filter(e => e.kind === 'tool');
  assert.equal(tools.length, 6);     // CARD_TOOLS_SHOWN
  assert.equal(c.effectsMore, 3);    // 9 − 6 collapsed
});

test('transcript: an answer card shows the room view (questions) the user is responding to', () => {
  // The engine records the rendered room view on turn.end (`view`). A turn's
  // view is the screen the NEXT turn's input responds to — so a clarify answer
  // card must show the questions it answers (the PRIOR turn's view), not its
  // own post-answer view where the answered question has dropped off the list.
  const enterView = [
    'CLARIFYING',
    'Questions for you',
    '1. Who specifically is the power user?',
    '2. Where does the app live and who controls the data?',
  ].join('\n');
  const events = [
    // Turn 1 enters clarifying and renders the question list.
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'ready' } },
    { turn: 1, kind: 'turn.end', state_path: 'clarifying', payload: { outcome: 'transitioned', to: 'clarifying', view: enterView } },
    // Turn 2 answers question 1; its own end view has q1 removed.
    { turn: 2, kind: 'turn.input', state_path: 'clarifying', payload: { input: '1 - a security analyst' } },
    { turn: 2, kind: 'turn.end', state_path: 'clarifying',
      payload: { outcome: 'transitioned', to: 'clarifying', view: 'CLARIFYING\nQuestions for you\n2. Where does the app live and who controls the data?' } },
  ];
  const { cards } = t.buildTranscript(t.buildJourney(events));

  // The answer card (turn 2) shows the questions it is responding to — the
  // PRIOR turn's view, with q1 still present.
  const answer = cards.find(c => c.turn === 2);
  assert.match(answer.user.text, /security analyst/);
  assert.ok(answer.prompt, 'answer card should carry the room view it responds to');
  assert.match(answer.prompt, /Who specifically is the power user/);
  assert.match(answer.prompt, /controls the data/);
});

// Source-colour provenance: the recorded room view marks LLM-generated spans
// with zero-width sentinels (U+2063/U+2061/U+2062). The generator parses them
// into [{llm, text}] segments so the slide can paint LLM vs template text in
// the two TUI dark-mode tones, mirroring kitsoki's `sourcecolor` package.
const OPEN = '⁣⁡⁡⁣';   // U+2063 U+2061 U+2061 U+2063
const CLOSE = '⁣⁢⁢⁣';  // U+2063 U+2062 U+2062 U+2063

test('segmentNarration: splits a balanced LLM span from surrounding template text', () => {
  const segs = t.segmentNarration('Idea: ' + OPEN + 'a notes app' + CLOSE + '\nUpstream: none');
  // Three segments: template prefix, llm span, template suffix.
  assert.deepStrictEqual(segs.map(s => s.llm), [false, true, false]);
  assert.strictEqual(segs[1].text, 'a notes app');
  assert.strictEqual(segs.map(s => s.text).join(''), 'Idea: a notes app\nUpstream: none');
  // The visible text carries no sentinels.
  assert.ok(!segs.map(s => s.text).join('').includes(OPEN));
});

test('segmentNarration: a dangling open (truncation dropped the close) auto-closes at the blank line, not the view end', () => {
  // Reproduces the real kitsoki bug: `truncatechars` cuts a kv value mid-span,
  // dropping the CLOSE sentinel. A naive stack walk would paint everything
  // after the open as LLM; the blank-line guard stops the warm band at the value.
  const view = 'Idea:  ' + OPEN + 'a notes app for ...' + '\n\nUpstream: none\nQuestions for you\n1. Who?';
  const segs = t.segmentNarration(view);
  const llmText = segs.filter(s => s.llm).map(s => s.text).join('');
  assert.match(llmText, /a notes app for \.\.\./);
  assert.ok(!llmText.includes('Upstream'), 'warm band must not bleed past the blank line');
  assert.ok(!llmText.includes('Questions'), 'warm band must not reach the template question list');
  // Everything after the blank line is template again.
  const tail = segs.filter(s => !s.llm).map(s => s.text).join('');
  assert.match(tail, /Questions for you/);
});

test('segmentNarration: truncation counts visible chars only (zero-width sentinels are free)', () => {
  const raw = OPEN + 'abcdefghij' + CLOSE; // 10 visible chars wrapped in sentinels
  const segs = t.segmentNarration(raw, 5);
  const text = segs.map(s => s.text).join('');
  assert.strictEqual(text, 'abcde…');     // cut at 5 visible chars, ellipsis appended
  assert.ok(segs[0].llm, 'the kept span is still flagged LLM-generated');
});

test('segmentNarration: strips baked-in ANSI styling but keeps the source-colour sentinels', () => {
  // A view rendered to a colour terminal carries lipgloss SGR codes; HTML must
  // not show them as literal text. The zero-width sentinels survive the strip.
  const raw = '\x1b[38;2;159;138;240mCLARIFYING\x1b[0m\nIdea: ' + OPEN + 'a notes app' + CLOSE;
  const segs = t.segmentNarration(raw);
  const text = segs.map(s => s.text).join('');
  assert.ok(!text.includes('\x1b') && !text.includes('[38;2'), 'ANSI codes stripped');
  assert.match(text, /CLARIFYING/);
  assert.strictEqual(segs.find(s => s.llm).text, 'a notes app');
});

test('transcript: an answer card carries provenance segments for the room view it responds to', () => {
  const enterView = 'Idea: ' + OPEN + 'a Vue notes app' + CLOSE + '\n\nQuestions for you\n1. Who is the user?';
  const events = [
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'ready' } },
    { turn: 1, kind: 'turn.end', state_path: 'clarifying', payload: { outcome: 'transitioned', to: 'clarifying', view: enterView } },
    { turn: 2, kind: 'turn.input', state_path: 'clarifying', payload: { input: '1 - an analyst' } },
    { turn: 2, kind: 'turn.end', state_path: 'clarifying', payload: { outcome: 'transitioned', to: 'clarifying', view: 'Questions for you\n(answered)' } },
  ];
  const { cards } = t.buildTranscript(t.buildJourney(events));
  const answer = cards.find(c => c.turn === 2);
  assert.ok(Array.isArray(answer.promptSegments) && answer.promptSegments.length, 'answer card carries promptSegments');
  // The idea echo is flagged LLM; the question scaffolding is template.
  const llm = answer.promptSegments.filter(s => s.llm).map(s => s.text).join('');
  const tpl = answer.promptSegments.filter(s => !s.llm).map(s => s.text).join('');
  assert.match(llm, /a Vue notes app/);
  assert.match(tpl, /Questions for you/);
  assert.ok(!llm.includes('Questions'), 'template scaffolding is not flagged LLM');
  // The plain prompt stays sentinel-free for hasNarration + fallback rendering.
  assert.ok(!answer.prompt.includes(OPEN) && !answer.prompt.includes(CLOSE));
});

test('progress chrome: every entry carries a cumulative snapshot that ends at the session totals', () => {
  const j = journey();
  const { entries, totals } = t.buildTranscript(j);

  // Every entry has a progress snapshot.
  assert.ok(entries.every(e => e.progress && typeof e.progress.cost === 'number'));

  // Turn number is monotonic non-decreasing and bounded by the turn count.
  let lastTurn = -1, lastCost = -1, lastTok = -1;
  for (const e of entries) {
    assert.ok(e.progress.turn >= lastTurn); lastTurn = e.progress.turn;
    assert.ok(e.progress.cost >= lastCost - 1e-12); lastCost = e.progress.cost;
    assert.ok(e.progress.tokens >= lastTok); lastTok = e.progress.tokens;
    assert.equal(e.progress.turns, j.stats.turns);
  }

  // The last entry's running totals equal the whole-session totals.
  const last = entries[entries.length - 1].progress;
  assert.ok(Math.abs(last.cost - j.stats.cost) < 1e-9);
  assert.equal(last.input + last.output + last.cacheRead + last.cacheWrite, totals.tokens);
});

test('totals break tokens down by type and match buildJourney stats', () => {
  const j = journey();
  const { totals } = t.buildTranscript(j);
  assert.equal(totals.haveTokens, true);
  assert.equal(totals.haveCost, true);
  // Fixture reports only input/output usage (400+50, 420+30) — no cache tokens.
  assert.equal(totals.input, 820);
  assert.equal(totals.output, 80);
  assert.equal(totals.cacheRead, 0);
  assert.equal(totals.cacheWrite, 0);
  assert.deepEqual(j.stats.tokensByType, { input: 820, output: 80, cacheRead: 0, cacheWrite: 0 });
  // The transcript scene exposes the totals for its status chrome.
  const tx = t.buildSpec(j, { app: 'cloak', session: 'abcd1234' }).scenes.find(s => s.type === 'transcript');
  assert.deepEqual(tx.totals, totals);
});

test('graph layout: boxes grow to fit their label and room ids render prettified', () => {
  // A long, underscore-namespaced room id is the overflow case: a fixed-width
  // box clipped the text. The box must now be wide enough to hold the label at
  // the single-panel label metric (~0.6em of a 44px monospace font ≈ 26 u/char),
  // and the displayed label drops the namespace underscores.
  const g = { nodes: ['idle', '__exit__abandoned'], edges: [{ from: 'idle', to: '__exit__abandoned', label: 'quit' }] };
  const lg = t.layoutGraph(g);
  const exit = lg.nodes.find(n => n.id === '__exit__abandoned');
  assert.equal(exit.label, 'exit abandoned');                 // prettified
  assert.ok(!/_/.test(exit.label));                           // no underscores survive
  // Every box holds its label with margin to spare (>= ~26 u/char would already
  // fit; assert a slightly looser 24 so the test tracks intent, not the constant).
  for (const n of lg.nodes) assert.ok(n.w >= n.label.length * 24, `box ${n.id} too narrow for label`);
  // The wide box is genuinely wider than the default floor (regression guard).
  assert.ok(exit.w > 230);
});

test('overview highlights the start (secondary) and ended (primary) rooms', () => {
  const j = journey();
  const panel = t.buildSpec(j, { app: 'cloak', session: 'abcd1234' })
    .scenes.find(s => s.type === 'diagram-svg').panels[0];
  const first = panel.nodes[0];
  const ended = panel.nodes.find(n => n.id === j.finalState);
  assert.equal(first.style, 'secondary');                     // opening room
  assert.equal(ended.style, 'primary');                       // where the session came to rest
});

test('cache_read / cache_creation token types are captured per call and accrued', () => {
  // Synthetic converse turn carrying the full claude-CLI usage shape.
  const events = [
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'go on' } },
    { turn: 1, kind: 'oracle.call.start', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', model: 'claude-sonnet-4-6', prompt: 'narrate ' } },
    { turn: 1, kind: 'oracle.call.complete', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', response: { text: 'A long corridor stretches ahead.' },
        meta: { cost_usd: 0.197, usage: {
          input_tokens: 6, output_tokens: 1850,
          cache_read_input_tokens: 86695, cache_creation_input_tokens: 38281 } } } },
  ];
  const j = t.buildJourney(events);
  assert.deepEqual(j.stats.tokensByType,
    { input: 6, output: 1850, cacheRead: 86695, cacheWrite: 38281 });
  // tokens headline stays fresh-I/O only (input+output), unchanged contract.
  assert.equal(j.stats.tokens, 1856);

  const { entries, totals } = t.buildTranscript(j);
  const reply = entries.find(e => e.role === 'assistant');
  assert.deepEqual({ cr: reply.progress.cacheRead, cw: reply.progress.cacheWrite },
    { cr: 86695, cw: 38281 });
  assert.ok(Math.abs(reply.progress.cost - 0.197) < 1e-9);
  assert.equal(totals.cacheRead, 86695);
  assert.equal(totals.cacheWrite, 38281);
});
