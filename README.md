# Slidey

Deterministic, spec-driven declarative video generator. A JSON spec describes a
video as an ordered list of scenes; slidey drives a headless Chrome via Puppeteer
to screenshot each frame, synthesises narration with `edge-tts`, and muxes
everything into an MP4 with ffmpeg.

Same spec + same template → byte-identical frames. No LLM in the rendering loop.

```
spec.json ──► renderer.js (Puppeteer ➜ PNGs) ──┐
                                               ├──► assembler.js (ffmpeg) ──► out.mp4
              narration.js (edge-tts ➜ MP3s) ──┘
```

For the iteration workflow (when to use `--estimate`, `--scenes`,
`--skip-render`, narration budgeting, common gotchas), see
[`.claude/skills/slidey-authoring/SKILL.md`](.claude/skills/slidey-authoring/SKILL.md).
This document is the **reference**: pipeline architecture and JSON schema.

## Requirements

- **Node** ≥ 18 — `npm install` pulls `puppeteer` (which downloads a pinned
  Chromium) and `jsonpath-plus`.
- **ffmpeg** on `PATH` — muxes frames + audio into the MP4.
- **edge-tts** on `PATH` — synthesises narration. Only invoked when at least one
  scene carries a `narration` string; a spec with no narration renders silently
  without it.

## Quick start

```sh
npm install
node src/index.js examples/hello.json --estimate     # scene/duration table, no render (~50ms)
node src/index.js examples/hello.json hello.mp4       # full render
```

`examples/kitsoki-pitch.json` is a real-world sample that exercises every scene
type; it's safe to delete.

## CLI

```
node src/index.js <input.json> <output.mp4> [options]
```

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

All source lives under `src/`:

| File | Role |
|---|---|
| `src/index.js` | CLI; argv parsing; orchestration |
| `src/renderer.js` | Per-scene dispatch; tracks scene start frames; drives Puppeteer |
| `src/template.html` | The single HTML page Puppeteer drives — all CSS + the `window.slidey.*` JS API every scene module calls |
| `src/scenes/<type>.js` | Per-scene-type render module: `{ render(page, scene, ctx) }` |
| `src/timing.js` | Frame counts per reveal state name; `estimateScene` / `estimateBoundaries` |
| `src/narration.js` | Calls `edge-tts` per scene; bundles audio segments aligned to scene start frames |
| `src/assembler.js` | ffmpeg invocation; muxes audio segments if supplied |
| `src/runner.js` | Live-HTTP runner for `request` scenes (template substitution + JSONPath capture) |

Determinism comes from: viewport pinned at 1920×1080, timing measured in frame
counts not seconds, and the spec being pure data — no LLM is consulted during
rendering.

Internally, scene types fall into two families the template toggles between: a
*slides* family (`title`, `narrative`, `diagram`, `diagram-svg`, `trace`,
`thread`, `stat`, `cta`, `terminal-gif`) and an *api* family (`request`). The
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
