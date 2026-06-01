# Slidey

Deterministic, spec-driven declarative scene engine. A JSON spec describes an
ordered list of scenes; from that **one spec** slidey produces three outputs that
all share a single set of Vue 3 scene components (so they never drift):

- **Video** (`out.mp4`) — headless Chrome screenshots each frame, `edge-tts`
  synthesises narration, ffmpeg muxes to MP4.
- **PDF** (`out.pdf`) — one vector page per reveal step (a diagram that builds
  across N panels becomes N pages). Text and SVG stay selectable, not rasterised.
- **Interactive web app** — the same components, navigated by keyboard/click.

Same bundle + same spec → byte-identical frames. No LLM in the rendering loop.

```
                          ┌─ renderer.js (Puppeteer ➜ PNGs) + edge-tts ─► ffmpeg ─► out.mp4
spec.json ─► Vue scene ───┼─ pdf.js     (Puppeteer ➜ page.pdf per step) ─────────► out.pdf
            components     └─ web app    (Vite dev/build, manual click-through)
```

The Vue components are built into a self-contained `dist-render/render.html`
(loaded via `file://` by the video + PDF pipelines) and into the `dist/` web app.
`web/store.js` + `web/slideyAdapter.js` re-expose the exact `window.slidey.*` API
the scene modules drive, so `src/renderer.js` runs against the bundle unchanged.

For the iteration workflow (when to use `--estimate`, `--scenes`,
`--skip-render`, narration budgeting, common gotchas), see
[`.claude/skills/slidey-authoring/SKILL.md`](.claude/skills/slidey-authoring/SKILL.md).
This document is the **reference**: pipeline architecture and JSON schema.

## Requirements

- **Node** ≥ 18 — `npm install` pulls `puppeteer` (pinned Chromium),
  `jsonpath-plus`, `pdf-lib`, and the Vue/Vite build toolchain.
- **ffmpeg** on `PATH` — muxes frames + audio into the MP4 (video output only).
- **edge-tts** on `PATH` — synthesises narration. Only invoked when at least one
  scene carries a `narration` string; a spec with no narration renders silently
  without it. (PDF output skips narration entirely.)

## Quick start

```sh
npm install
npm run build:render                                  # build the Vue render bundle (required before video/PDF)

node src/index.js examples/kitsoki-pitch.json --estimate   # scene/duration table, no render (~50ms)
node src/index.js examples/kitsoki-pitch.json out.mp4      # video
node src/index.js examples/kitsoki-pitch.json out.pdf      # slides — one page per reveal step

npm run dev                                           # interactive web app (Vite); open ?spec=<url> or drop a spec

npm run build:single -- examples/kitsoki-pitch.json kitsoki.html   # one self-contained .html — open it straight off disk
```

The video and PDF pipelines load the built `dist-render/render.html`; rebuild it
with `npm run build:render` whenever you change anything under `web/`. `npm run
build` builds both the render bundle and the web app.

`npm run build:single -- <spec.json> [out.html]` produces a **single
self-contained HTML file** of the interactive viewer with the spec (and any gif
assets) embedded inline — no server, no fetches, no sidecar files. Open it
directly (`file://`) or email/host it anywhere; arrow keys / click step through
the deck. Output defaults to `dist-web-single/<spec>.html`. (The orchestrator is
[`web/build-single.mjs`](web/build-single.mjs), built via the `webfile` Vite
target; it folds the app's JS + CSS inline the same way the render harness does
and injects the spec as `window.__SLIDEY_SPEC__`.)

`examples/kitsoki-pitch.json` is a real-world sample that exercises every scene
type; it's safe to delete.

## Visualizing a kitsoki session trace

A **`.jsonl` input is treated as a [kitsoki](https://github.com/) session trace**
(the canonical append-only event log `kitsoki run` writes under
`~/.kitsoki/sessions/<app>/`) rather than a hand-authored spec. Slidey reads the
raw trace (the `kind`/`payload` event shape) and generates a full scene spec
automatically — the video analogue of kitsoki's `tools/runstatus` SPA:

```sh
node src/index.js ~/.kitsoki/sessions/prd/<id>.jsonl session.mp4   # render the session as a video
node src/index.js ~/.kitsoki/sessions/prd/<id>.jsonl spec.json     # dump the generated spec to inspect/hand-tweak
node src/index.js ~/.kitsoki/sessions/prd/<id>.jsonl --estimate    # scene/duration table, no render
```

The generated arc is: a **title** card → a **state-machine overview**
(`diagram-svg`) of the path actually taken (boxes grow to fit each room name —
ids are rendered prettified, e.g. `__exit__abandoned` → `exit abandoned` — and
the opening room is marked secondary while the room the session ended in is
highlighted primary) → a per-turn boxed **`transcript`** of
the whole session (one card per turn, each fit to a single screen: the turn's
user input and the assistant's replies/decisions up top, the turn's mechanics —
tool/host calls, world-state diffs, rejections and the closing state transition —
below; cards advance one at a time and carry a "continued" marker so the session
reads as one ongoing conversation) → a **cta** end card. Generation is pure and
deterministic: the same trace always yields byte-identical output. The generator
lives in [`src/trace.js`](src/trace.js); `examples/fixtures/` holds a synthetic
trace used by `npm test`.

## CLI

```
node src/index.js <input.json> <output> [options]
```

The output **extension selects the format**: `.pdf` → slide deck (one page per
reveal step; no frames, narration, or ffmpeg); anything else → MP4 video.

| Flag | Effect |
|---|---|
| `--fps N` | Frames per second (default 30) |
| `--context key=value` | Override a template variable; repeatable; takes precedence over `meta.context` |
| `--scenes 0,3-5` | Render only the given scene indices (still combined into one MP4) |
| `--no-gaps` | Suppress the 0.8s blank between scenes — useful for progressive sequences that should feel continuous |
| `--list` | Print scene index + duration table; no render |
| `--estimate` | Like `--list` plus narration audio-length estimates and overrun warnings |
| `--frames-dir PATH` | Use this directory for frames instead of a temp dir |
| `--keep-frames` | Keep frame directory after render |
| `--skip-render` | Skip PNG generation, reuse cached frames; regenerate narration + mux only |
| `--capture-log FILE` | Write live HTTP responses to JSON (for later playback freeze) |

## Pipeline

Render pipeline (`src/`):

| File | Role |
|---|---|
| `src/index.js` | CLI; argv parsing; orchestration; dispatches `.pdf` → `src/pdf.js`, else video |
| `src/renderer.js` | Per-scene dispatch; tracks scene start frames; drives Puppeteer against the Vue bundle |
| `src/pdf.js` | PDF exporter — drives the bundle, `page.pdf()` per reveal step, merges with `pdf-lib` |
| `src/scenes/<type>.js` | Per-scene-type render module: `{ render(page, scene, ctx) }` |
| `src/timing.js` | Frame counts per reveal state name; `estimateScene` / `estimateBoundaries` |
| `src/narration.js` | Calls `edge-tts` per scene; bundles audio segments aligned to scene start frames |
| `src/assembler.js` | ffmpeg invocation; muxes audio segments if supplied |
| `src/runner.js` | Live-HTTP runner for `request` scenes (template substitution + JSONPath capture) |
| `src/template.html` | **Legacy reference** — the original single-page renderer the Vue components were ported from. No longer driven by the pipeline; kept as the visual source of truth `web/styles/template.css` was extracted from. |

Shared Vue render core (`web/`, built by `npm run build:*`):

| File | Role |
|---|---|
| `web/components/*.vue` | One component per scene type + `DeckHost.vue`; keep the original ids/classes so `template.css` applies verbatim |
| `web/store.js` | Reactive store: a faithful port of the `window.slidey` state machine (`visible`/`revealed` sets) |
| `web/slideyAdapter.js` | Installs `window.slidey.*` (over the store) + `__slideyReady` / `__slideySettle` |
| `web/sceneSteps.mjs` | Shared reveal-step model — one step = one PDF page / one nav advance |
| `web/useDeck.js` + `NavController.vue` | Web-app navigation (keyboard/click, progress) |
| `web/inline-render.mjs` | Post-build: folds JS+CSS into a self-contained `dist-render/render.html` for `file://` |

Determinism comes from: viewport pinned at 1920×1080, timing measured in frame
counts not seconds, the spec being pure data (no LLM during rendering), and a
settle barrier (`__slideySettle`) that flushes Vue's async DOM patch before each
capture. Run-to-run frame variance is limited to sub-pixel CSS-transition
sampling (≈8/658 on the sample deck — on par with the legacy renderer).

Internally, scene types fall into two families the template toggles between: a
*slides* family (`title`, `narrative`, `diagram`, `diagram-svg`, `trace`,
`transcript`, `thread`, `stat`, `cta`, `terminal-gif`) and an *api* family
(`request`). The
spec's optional `meta.mode` selects the default; you rarely set it by hand. (In
the code this distinction still carries its original `pitch`/`api` names — e.g.
`mode-pitch`, `_PITCH_REVEALS` — they're internal labels, not project identity.)

## Spec schema

A spec is a JSON object with two top-level keys: `meta` (optional) and
`scenes` (required, non-empty array).

```json
{
  "meta": {
    "title": "My Video",
    "resolution": { "width": 1920, "height": 1080 },
    "narration": { "voice": "en-AU-NatashaNeural", "rate": "+0%" },
    "context": { "host": "example.com", "token": "abc" }
  },
  "scenes": [
    { "type": "title", "title": "My Video" },
    { "type": "narrative", "eyebrow": "The setting", "body": "..." }
  ]
}
```

### `meta` fields

| Field | Purpose |
|---|---|
| `meta.title` | Label shown on debug overlays; not rendered into the video |
| `meta.resolution` | `{ width, height }`. Default 1920×1080. Changing this is unusual |
| `meta.narration.voice` | edge-tts voice id. Default `en-AU-NatashaNeural` |
| `meta.narration.rate` | edge-tts speech rate, e.g. `"+0%"`, `"-10%"` |
| `meta.context` | Key/value template variables interpolated into scene fields. Overridden by `--context` CLI flags |

A scene also takes a top-level `narration: "..."` string (any scene type). If
**any** scene has `narration`, edge-tts is invoked and the resulting audio is
muxed onto the video, with each segment starting at that scene's start frame.

Scenes also accept `hold: <frames>` to extend the post-reveal dwell. `30
frames = 1s` at default fps. The default hold per scene type lives in
`timing.js` (`narrative_hold`, `diagram_hold`, etc.).

### Scene types

Each scene is an object with a `type` discriminator. Render handlers live in
`scenes/<type>.js`; the per-type fields below are passed through verbatim.

#### `title` — cold open or chapter break

```json
{ "type": "title", "title": "Slidey",
  "subtitle": "Declarative videos from a JSON spec",
  "eyebrow":  "Demo" }
```

Fixed 3s card. No reveal animation.

#### `narrative` — eyebrow + body + optional lede

```json
{ "type": "narrative",
  "eyebrow": "The problem",
  "body":    "Cutting a polished explainer video by hand is slow and unrepeatable.",
  "lede":    "Edit a frame and you re-render everything from scratch.",
  "hold":    165 }
```

#### `diagram` — ASCII / code-panel comparison (legacy)

```json
{ "type": "diagram",
  "title":   "Before vs after",
  "panels":  [{ "label": "Before", "ascii": "$ ...\n..." }, { "label": "After", "ascii": "..." }],
  "caption": "Two panels, side by side." }
```

Up to three panels (`diagram_panel_0..2` reveal slots).

#### `diagram-svg` — proper SVG diagrams (the workhorse)

```json
{ "type": "diagram-svg",
  "title":   "Pipeline",
  "panels": [
    {
      "label":   "Render path",
      "viewBox": "0 0 400 360",
      "nodes": [
        { "id":"spec","label":"spec.json","sub":"scenes",
          "x":100,"y":40,"w":200,"h":80,"style":"primary" },
        { "id":"mp4", "label":"out.mp4","sub":"frames + audio",
          "x":100,"y":240,"w":200,"h":80 }
      ],
      "edges": [
        { "from":"spec","to":"mp4","label":"render" }
      ],
      "caption": "Spec in, video out."
    }
  ],
  "caption": "The same spec always produces the same frames.",
  "hold":    210 }
```

- **Nodes** support `label` (big), `sub` (medium), and `lines: ["...", ...]`
  (smaller multi-line content). `style: "primary"` (blue) or `"secondary"`
  (purple) highlights the focal box.
- **Edges** auto-anchor to whichever sides of the two nodes face each other
  (horizontal vs vertical chosen by which delta dominates). `side: "left" |
  "right"` offsets the line perpendicular to its direction — used for parallel
  bidirectional arrows.
- **Gates**: an edge with `gate: "check fails"` renders as a dashed orange
  checkpoint bar instead of an arrow, with the label uppercased.

Single-panel vs two-panel layouts differ in scale (single = larger fonts,
fixed 680px SVG height, no panel chrome; two = side-by-side, smaller fonts,
1/0.7 aspect ratio). See the authoring skill for sizing rules.

#### `trace` — multi-step cascade with HIT/MISS badges

```json
{ "type": "trace",
  "title": "Lookup cascade",
  "turns": [
    { "user": "deploy the api", "layers": ["cache", "index", "scan", "fallback"],
      "intent": "deploy", "no_llm": true }
  ],
  "caption": "Cheaper layers resolve the request before the expensive one." }
```

Up to three turns (`trace_turn_0..2`). Each turn shows the input utterance, the
cascade of layers tried, the resolved result, and an optional shortcut badge.

#### `transcript` — a whole kitsoki session as per-turn boxed cards

The session rendered as a sequence of conversation cards, **one card per turn**,
each fit to a single screen (à la Claude Code / an online AI chat, but one turn
at a time). Inside each enclosing box: the turn's user input and the assistant's
replies/decisions up top, and the turn's mechanics below — tool/host calls, the
net world diff, guard/validation rejections and the closing state transition.
The scene shows one card at a time; cards advance through the shared reveal-step
model (one `transcript_card_<n>` step per turn → one PDF page / video dwell / nav
advance). Every card after the first carries a "⋯ continued" marker, and every
card before the last a trailing "⋯", so the run reads as one ongoing conversation
moving turn by turn. Verbose bubbles line-clamp and the box clips overflow, so a
long turn still fits one screen (host calls past six collapse to a "+N more").

A single full-width status row across the top is the conversation's HUD: the
session identity (`app` + short `session`) on the left, then how far through the
session you are (turn N / M plus a fill bar tied to card position) and the
cumulative token spend broken out by type — `in` (fresh input), `out`, `cache r`
(cache reads) and `cache w` (cache creation) — alongside the running dollar
`cost`. It sits flush at the top of the frame (the transcript scene trims the
stage padding to run nearly full-bleed). The meters reflect the turn on screen
(the current card's `progress` snapshot), so they tick up exactly as the cost was
incurred. The token/cost section is shown only when the trace actually carries
`meta.usage` / `meta.cost_usd` (it degrades to just identity + turn meter
otherwise).

```json
{ "type": "transcript",
  "title": "prd", "app": "prd", "session": "86fa0981",
  "subtitle": "session 86fa0981  ·  5 turns  ·  ended in clarifying",
  "cards": [
    { "turn": 1, "bootstrap": false, "room": "idle",
      "user": { "text": "refine the title", "direct": false },
      "flow": [
        { "kind": "assistant", "tag": "converse", "model": "claude-sonnet-4-6", "text": "Here's a tighter title…" },
        { "kind": "decision", "verb": "decide", "outcome": "intent: refine", "error": false }
      ],
      "effects": [
        { "kind": "tool", "name": "host.notify", "ok": true, "duration": "6ms" },
        { "kind": "world", "changes": [ { "key": "title", "before": "∅", "after": "PRD" } ], "more": 0 },
        { "kind": "transition", "from": "idle", "to": "clarifying", "intent": "start", "self": false }
      ],
      "effectsMore": 0,
      "progress": { "turn": 1, "turns": 5, "input": 6, "output": 1850,
                    "cacheRead": 86695, "cacheWrite": 38281, "tokens": 126832, "cost": 0.197 } }
  ],
  "totals": { "turns": 5, "tokens": 554365, "input": 19, "output": 7059,
              "cacheRead": 453674, "cacheWrite": 93613, "cost": 0.594,
              "haveTokens": true, "haveCost": true },
  "hold": 150 }
```

Each card carries: `turn` (display number; `bootstrap: true` marks turn 0, shown
as "session start"), `room`, an optional `user` bubble, a `flow` of conversation
items (`kind: "assistant"` prose bubbles — `tag` is the verb or `"say"` — and
`kind: "decision"` structured decide/choose rows), an `effects` list of the
turn's mechanics (`tool` / `world` / `reject` / `transition`), an `effectsMore`
count of collapsed host calls, and a cumulative `progress` snapshot (turn number
+ token/cost totals as of the end of that turn) that drives the HUD. The scene
also carries the grand `totals`. `buildTranscript` also returns the flat
reading-order `entries` stream the cards are folded from (used by tests).
`scene.cardHold` overrides the per-card dwell (frames); the last card uses the
longer `hold`. Authored by hand rarely — usually emitted by the trace generator
above.

#### `thread` — mocked issue-tracker / review comment threads

```json
{ "type": "thread",
  "title": "How a change lands",
  "panels": [
    {
      "system": "jira",
      "ref":    "PROJ-123",
      "stage":  "in progress",
      "messages": [
        { "author": "alice", "body": "Filing this." },
        { "author": "bot",   "body": "Reproduced. Patch below." }
      ]
    }
  ],
  "caption": "A scripted comment thread in a familiar chrome." }
```

Up to three panels (`thread_panel_0..2`). `system` selects the visual chrome
(e.g. `jira`, `bitbucket`).

#### `stat` — big gradient number

```json
{ "type": "stat",
  "value":  "78%",
  "label":  "of requests served from cache",
  "detail": "(measured over a representative run)" }
```

#### `cta` — end card

```json
{ "type": "cta",
  "wordmark": "Slidey",
  "tagline":  "Declarative videos from a JSON spec.",
  "url":      "github.com/you/slidey" }
```

#### `terminal-gif` — embed a recorded gif in a terminal chrome

```json
{ "type": "terminal-gif",
  "gif":     "assets/run.gif",
  "title":   "demo",
  "caption": "A recorded terminal session, framed and captioned." }
```

The default `termgif_hold` is 12s — one loop of a typical [VHS](https://github.com/charmbracelet/vhs) recording.

#### `request` — API request/response card

```json
{ "type": "request",
  "request":  { "method": "POST", "url": "https://{{host}}/api/v1/...",
                "headers": {...}, "body": {...} },
  "response": { "status": 200, "headers": {...}, "body": {...} },
  "mock":     true
}
```

Three modes:

- **Live** (neither `mock` nor `playback`): real HTTP request is made; the live
  response is rendered. Pair with `--capture-log` to save the response for
  later playback.
- **Mock** (`mock: true`): the embedded response is rendered with a MOCK badge.
- **Playback** (`playback: true`): a previously-captured response is rendered
  with a PLAYBACK badge.

This is the one scene type in the *api* family; the rest are *slides*.

## Frame timing

Every reveal step has a frame budget in `timing.js`. The per-type defaults
add up to the scene's total duration when `--list` / `--estimate` is run.
Override the final dwell with a scene-level `hold: <frames>`; per-step
revealing budgets aren't user-overridable.

A scene's estimated duration is computed by `estimateScene(scene)` and is the
sum of the type's reveal-step budgets plus `inter_scene` (24 frames).
`estimateBoundaries(spec)` returns `[{ sceneIndex, startFrame, type, narration,
durationFrames }]` — this is what `--estimate`, `--list`, `--skip-render`, and
narration alignment all use.

Whenever a scene module's reveal sequence changes, the matching branch in
`estimateScene` must be updated, or `--estimate` will lie about durations and
narration alignment will drift.

## Adding a new scene type

1. Add `src/scenes/<name>.js` exporting `{ render(page, scene, ctx) }`.
2. Register it in `src/renderer.js`'s `SCENE_MODULES`.
3. Add the HTML region and CSS in `src/template.html` (`<div id="<name>-region">…</div>`).
4. Add `window.slidey.show<Name>(scene)` / `hide<Name>()` to the inline JS
   in `src/template.html`.
5. Add per-reveal frame budgets in `src/timing.js`, plus a branch in
   `estimateScene()` so `--estimate` knows the duration.
6. Add the reveal state names to the `_PITCH_REVEALS` table in
   `src/template.html` so the renderer knows when each reveal step has settled.
