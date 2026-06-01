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
  assert.equal(types[0], 'title');
  assert.equal(types[1], 'diagram-svg');               // overview
  assert.equal(types.filter(x => x === 'trace-turn').length, 2);
  assert.equal(types[types.length - 1], 'cta');
  // No end-of-deck stats recap — cost/tokens live inline on the oracle rows.
  assert.equal(types.filter(x => x === 'stat').length, 0);
  // The turn beat with a self-loop renders a transition row marked self:true.
  const turn2 = spec.scenes.find(s => s.type === 'trace-turn' && s.turn === 2);
  assert.ok(turn2.rows.find(r => r.kind === 'transition' && r.self === true));
  // Oracle rows carry per-call duration, tokens and cost.
  const turn1 = spec.scenes.find(s => s.type === 'trace-turn' && s.turn === 1);
  const oracleRow = turn1.rows.find(r => r.kind === 'oracle');
  assert.match(oracleRow.meta, /1\.2s/);
  assert.match(oracleRow.meta, /450 tok/);
  assert.match(oracleRow.meta, /\$0\.0033/);
});

test('convo view: structured decide shows its outcome; a distinct say is kept; mechanics go to the strip', () => {
  const j = journey();
  const spec = t.buildSpec(j, { app: 'cloak', session: 'abcd1234' });
  const turn1 = spec.scenes.find(s => s.type === 'trace-turn' && s.turn === 1);
  const c = turn1.convo;
  assert.ok(c, 'turn 1 carries a convo view');
  // The human exchange leads with the user's input.
  assert.equal(c.messages[0].role, 'user');
  assert.match(c.messages[0].text, /go south/);
  // A decide call has no free text — it shows its structured outcome, not a bubble of prose.
  const dec = c.messages.find(m => m.role === 'oracle' && m.verb === 'decide');
  assert.equal(dec.text, '');
  assert.equal(dec.outcome, 'intent: go');
  // The say is distinct from any oracle reply, so it surfaces as its own message.
  assert.ok(c.messages.some(m => m.role === 'say' && m.text.includes('pitch dark')));
  // World diff, the transition, and the host call live on the bottom strip — L→R.
  assert.ok(c.events.some(e => e.kind === 'world' && e.key === 'location' && e.after === 'bar'));
  assert.ok(c.events.some(e => e.kind === 'transition' && e.self === false && e.to === 'bar'));
  assert.ok(c.events.some(e => e.kind === 'host' && e.name === 'host.notify' && e.ok === true));
});

test('convo view: a converse reply becomes a chat bubble, the prompt collapses, a duplicate say is dropped', () => {
  // Inline synthetic turn — exercises the converse-text path the golden fixture
  // (decide-only) does not: text bubble + bounded prompt preview + say dedup.
  const events = [
    { turn: 1, kind: 'turn.input', state_path: 'idle', payload: { input: 'tell me a joke' } },
    { turn: 1, kind: 'oracle.call.start', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', model: 'claude-sonnet-4-6', prompt: 'You are a helpful narrator. '.repeat(40) } },
    { turn: 1, kind: 'oracle.call.complete', state_path: 'idle', call_id: 'c1',
      payload: { verb: 'converse', response: { text: 'Why did the chicken cross the road?' } } },
    { turn: 1, kind: 'machine.say', state_path: 'idle', payload: { text: 'Why did the chicken cross the road?' } },
    { turn: 1, kind: 'world.update', state_path: 'idle', payload: { increment: { jokes: 1 } } },
  ];
  const spec = t.buildSpec(t.buildJourney(events), { app: 'x', session: 'sess' });
  const c = spec.scenes.find(s => s.type === 'trace-turn' && s.turn === 1).convo;
  assert.equal(c.messages[0].role, 'user');
  const reply = c.messages.find(m => m.role === 'oracle' && m.verb === 'converse');
  assert.match(reply.text, /chicken cross the road/);   // free prose → chat bubble
  assert.ok(reply.prompt.length > 0 && reply.prompt.length <= 200); // engineered prompt collapsed
  assert.equal(c.messages.filter(m => m.role === 'say').length, 0);  // say == reply → dropped
  assert.ok(c.events.some(e => e.kind === 'world' && e.key === 'jokes'));
});
