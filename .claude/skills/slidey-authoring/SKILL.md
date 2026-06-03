---
name: slidey-authoring
description: Author and iterate on declarative videos using the slidey pipeline (a JSON scene spec rendered to a narrated MP4). Use when the user asks to create a new video, add/edit a scene, tweak narration, adjust visuals, re-cut a video, or generate an MP4 from a JSON spec. Covers the iteration loop, scene-type vocabulary, narration budgeting, and the gotchas accumulated across many cuts.
---

# Slidey authoring

**Slidey** is a deterministic spec-driven Puppeteer + ffmpeg pipeline at the repo root. You describe a video as a JSON array of scenes; slidey renders each scene to PNG frames via headless Chrome, generates narration via edge-tts, and muxes everything into an MP4. Output is reproducible: same JSON spec + same template = byte-identical frames.

Specs live in `examples/` alongside their output MP4s. The minimal starting point is `examples/hello.json`; `examples/kitsoki-pitch.json` is a full real-world sample that exercises every scene type.

## Starting a new video

Create a JSON file in `examples/` (or anywhere) with this shape:

```json
{
  "meta": {
    "mode": "pitch",
    "narration": { "voice": "en-AU-NatashaNeural" }
  },
  "scenes": [
    { "type": "title", "title": "My Feature" },
    ...
  ]
}
```

Then follow the iteration loop below. Name the output MP4 alongside the spec (`examples/my-feature.mp4`).

## The iteration loop

A full MP4 render takes **7–12 minutes**. Never trigger one to spot-check a single scene. Use PNG or PDF for all visual iteration — they share the same render bundle and run in seconds.

**Build the render bundle first.** The visuals are Vue components compiled to `dist-render/render.html`; all pipelines (MP4/PDF/PNG) load that file. After any change under `web/` (or on a fresh checkout), run `npm run build:render` — otherwise rendering errors with *"render bundle missing"*. `--estimate`/`--list` don't need it.

**Four outputs, one spec.** The output path picks the format:

| Output path | Format | Speed | Use for |
|---|---|---|---|
| `path/to/dir` (no extension) | PNG directory | ~1–3s/scene | Visual spot-check; LLM can `Read` files directly |
| `.pdf` | PDF (vector, one page per reveal step) | ~3s total | Full deck review, sharing |
| `.mp4` | Video with narration | 7–12 min | Final deliverable only |
| `--estimate` / `--list` | Console table | ~50ms | Narration budget check |
| `--check` | Console validation | ~instant | Diagram-svg sizing/overlap guard (CI-usable) |

Don't run two Puppeteer renders at once — concurrent headless Chrome instances can crash each other's screenshot capture.

```sh
npm run build:render                                 # (re)build the Vue bundle after editing web/

# 1. Sanity-check — no render, ~50ms (no bundle needed)
slidey examples/my-video.json --estimate

# 1b. Validate diagram-svg sizing/overlap — console only, ~instant, no Chrome (no bundle needed)
slidey examples/my-video.json out.mp4 --check     # or: node src/index.js my-video.json out.mp4 --check
# Checks every diagram-svg node's w/h against its text and flags node overlaps.
# Exits non-zero on violations — safe to run anytime, and usable as a CI gate.

# 2. PNG spot-check one scene — ~1-3s, LLM-readable
slidey examples/my-video.json .artifacts/check --scenes 5
# Produces: .artifacts/check/05-01.png, 05-02.png, 05-03.png (one per reveal step)
# Then: Read .artifacts/check/05-02.png  ← vision model checks layout directly

# 3. Full deck as PDF — ~3s, good for a complete pass before MP4 render
slidey examples/my-video.json .artifacts/deck.pdf

# 4. Iterate on narration text only — ~10s (reuses cached MP4 frames)
slidey examples/my-video.json .artifacts/out.mp4 \
  --frames-dir .artifacts/frames \
  --keep-frames \
  --skip-render

# 5. Final full render — 7–12 min, only when layout and narration are confirmed
slidey examples/my-video.json examples/my-video.mp4
```

**Always run `--estimate` first.** It catches narration overruns (the #1 cause of wasted full renders) and prints scene start times so you don't have to count.

**Use PNG for all visual iteration.** The LLM can `Read` PNG files directly (multimodal) — this makes layout review a first-class part of the authoring loop without waiting 30s for an MP4 render per scene.

## Scene types

All are declared in JSON; render handlers live in `src/scenes/`:

| `type` | Use for | Key fields | Typical duration |
|---|---|---|---|
| `title` | Cold open, chapter break (e.g. "vs.") | `title`, `subtitle`, `eyebrow` | 3s |
| `narrative` | Eyebrow + body + lede text beats | `eyebrow`, `body`, `lede`, `hold` | 7–9s |
| `diagram` | ASCII/code panel comparison (e.g. "before vs after") | `panels: [{label, ascii}]` | 10–14s |
| `diagram-svg` | Proper SVG diagrams (the architecturally important visuals) | `panels: [{viewBox, nodes, edges}]` | 10–15s |
| `trace` | Multi-layer lookup cascade with HIT/MISS badges | `turns: [{user, layers, intent, no_llm}]` | 12s |
| `thread` | Mocked issue-tracker / review comment threads | `panels: [{system, ref, stage, messages}]` | 14–17s |
| `stat` | Big gradient number + caption | `value`, `label`, `detail` | 7s |
| `cta` | Wordmark + tagline + URL end card | `wordmark`, `tagline`, `url` | 8s |
| `terminal-gif` | Embed a recorded gif in a fake-terminal chrome | `gif`, `title`, `caption` | 8–12s |
| `request` | API request/response card (live/mock/playback) | see `src/scenes/request.js` | varies |

### `diagram-svg` — the workhorse for proper diagrams

The most-used type. Each panel has an array of `nodes` and `edges`. **`auto_layout: true` is the default — let dagre compute all x/y positions and the renderer auto-size boxes to fit text.** Hand-authored x/y/w/h is a deliberate EXCEPTION, only for layouts dagre can't express (e.g. uniform full-width list rows, or two-panel comparisons with specific spatial semantics). When you DO hand-author coordinates you MUST run `--check` and verify with a PNG render: the auto-size loop can only grow a box in place — it can't reposition neighbors — so an undersized hand-authored box overlaps the boxes and arrows around it.

#### Nodes

- `label` (big text), `sub` (medium), `lines: []` (smaller lines stacked below)
- `style: "primary"` (blue accent) or `"secondary"` (purple) to highlight the focal node
- No coordinates needed — `auto_layout` places them; auto-size expands boxes to fit text

#### Panels

```json
{
  "auto_layout": true,
  "rankdir": "TB",
  "nodes": [...],
  "edges": [...]
}
```

- `auto_layout: true` — dagre computes all x/y positions; viewBox is auto-computed
- `rankdir: "TB"` (default) — top-to-bottom flow; use `"LR"` for hub-and-spoke diagrams where one node fans out to many children
- Terminal nodes (no outgoing edges, multiple predecessors) are automatically ranked last

#### Edges

- `label` — text beside the arrow
- `gate: "gate · label text"` — replaces the arrow with a dashed orange checkpoint bar
- `elbow: true` — orthogonal Z-bend routing instead of straight diagonal. **When multiple edges share the same source, bus routing kicks in automatically** — all branches share a common trunk line extending from the source, producing a clean tree appearance. No extra flag needed.
- `side: "left"|"right"` — offset for parallel bidirectional arrows

#### Layouts by topology

| Topology | `rankdir` | Edge style | Example |
|---|---|---|---|
| Pipeline (A→B→C) | `TB` | straight | Bugfix rooms |
| Hub-and-spoke (A→many) | `LR` | `elbow: true` | Story anatomy |
| Comparison | two panels | straight | Judge polymorphism |
| Decision tree | `TB` | straight | Room lifecycle |

### Single-panel vs two-panel diagrams

Slidey's CSS treats `diagram-svg` panels differently based on count:

- **Two panels** (side-by-side comparison): smaller boxes, smaller fonts. Good for comparisons.
- **Single panel** (hero diagram): bigger boxes, bigger fonts, SVG height 680px. Good for standalone diagrams.

If you need both panels visually consistent, use TWO single-panel scenes back-to-back with a `title` scene transition between them.

## Narration

Voice: **`en-AU-NatashaNeural`** (Australian female, set in `meta.narration.voice`). Speech rate calibrates to **~1.85 words/sec** for budget estimation — measured across many cuts (real range 1.7–2.3 depending on punctuation and word length).

### Budgeting

Audio must be **shorter** than its scene. Margin of >0.6s is comfortable; 0–0.6s is tight; negative is overrun (audio bleeds into the next scene). `--estimate` flags all three.

**Per-scene word budget formula:** `max_words ≈ (scene_duration_seconds × 1.5)`. Conservative; gives ~70% scene utilisation. For a 10s scene, plan ~15 words.

### Pronunciation tips

- **URLs** read literally. Write them phonetically: `"github dot com slash org slash repo"`. Even then, **URLs are slow** (3–5s for a single short URL) — often better to drop the URL from narration and let it appear only on the visual.
- **Em-dashes (`—`)** create a natural pause (~0.4s). Useful for pacing but eats into your budget.
- **Numbers**: write "seventy-eight percent" not "78%" — TTS reads it the same way but writing it out makes the budget more predictable.

### Iteration

When narration overruns, two fixes:
1. **Trim the text** (preferred — usually the script was over-detailed)
2. **Extend the scene's `hold`** (in frames; 30 frames = 1s)

If you only change narration text:
```sh
node src/index.js spec.json .artifacts/out.mp4 --frames-dir .artifacts/frames --keep-frames --skip-render
```
This regenerates audio + remuxes onto cached frames — ~10s instead of 7min.

## Common gotchas (battle-tested)

### Text width vs box width

For monospace at viewBox-unit font-size `F`, character width is approximately `0.6 × F` (in the same viewBox units). For SVG nodes in `diagram-svg`:

| Mode | Label font | Char width | Margin needed (each side) |
|---|---|---|---|
| Two-panel | 30 | ~18 vbox | ~20 vbox |
| Single-panel | 44 | ~26 vbox | ~30 vbox |

So a 12-character label in single-panel mode needs box width ≥ `12 × 26 + 60` = **372 viewBox units**.

The `sub` and `lines[]` fonts are SMALLER than the label, so the label usually dominates box width — but a long `sub`/`line` can still overflow: single-panel is `sub` 28 / `line` 26, two-panel is `sub` 19 / `line` 18. Note `sub` renders as a SINGLE line (it is NOT auto-wrapped on `" · "`); for stacked multi-line content use the `lines: []` array, one entry per line.

**Run `--check` to catch sizing/overlap automatically instead of eyeballing this.**

### Title/caption clipping

If a scene's content overflows the available stage height (1080px − 192px padding = 888px on screen), `overflow: hidden` clips top and bottom equally, pushing the title against the top edge and clipping the caption.

For two-panel diagrams: the SVG aspect-ratio is `1/0.7`, so each panel SVG is ~70% as tall as it is wide. The CONTENT inside scales to fit via `preserveAspectRatio="meet"`. Make panel content fit by either (a) reducing content lines per node, or (b) reducing SVG aspect via the panel's viewBox.

For single-panel diagrams: SVG is hard-capped at 680px height. Title (40px) + caption (32–36px wrapped to 2 lines) + gaps eats ~200px, leaving ~680px for the SVG itself. If content needs more, you've overpacked the scene.

### `"mode": "pitch"` is required in meta

Without `"mode": "pitch"`, the template keeps `#pitch-stage` hidden (`display: none`) — every page of every PDF and every video frame renders as a blank background. Always include it:

```json
{ "meta": { "mode": "pitch", "narration": { "voice": "en-AU-NatashaNeural" } } }
```

### The `--scenes` flag rewrites the output file

`--scenes 4` scopes any output format to only scene 4. Works for PNG, PDF, and MP4. When spot-checking, prefer PNG (not MP4):

```sh
slidey spec.json .artifacts/check --scenes 4     # PNG, ~2s, LLM-readable
slidey spec.json .artifacts/check.pdf --scenes 4 # PDF, ~2s, viewer-friendly
# MP4 is ~30s and produces audio you don't need during layout iteration
```

### Edge label overflow on diagrams

Edge labels render TO THE SIDE of the line. If the label is wider than the gap to the panel edge, it gets clipped by the SVG viewBox boundary. Keep edge labels under ~16 characters, or move the content to a panel caption.

### Headless Chrome doesn't render colour emoji

`🟢` renders as a tofu box. Use plain Unicode (`✓`, `✗`, `▸`) or descriptive text instead.

### Two render processes can race for the output file

Check `ps aux | grep "node src/index"` before launching a new render to avoid corrupt/truncated output.

## File map

```
slidey/
├── src/
│   ├── index.js              # CLI entry point — argv parsing, orchestration
│   ├── renderer.js           # Per-scene dispatch; tracks scene start frames
│   ├── assembler.js          # ffmpeg invocation; muxes audio if segments supplied
│   ├── narration.js          # Calls edge-tts CLI per scene; bundles segments
│   ├── runner.js             # Live-HTTP runner for `request` scenes
│   ├── timing.js             # Frame counts per state name + estimateScene/estimateBoundaries
│   ├── template.html         # The single HTML page Puppeteer drives — all CSS + JS API
│   └── scenes/
│       ├── title.js
│       ├── narrative.js
│       ├── diagram.js          # ASCII (legacy comparison)
│       ├── diagram-svg.js      # Proper SVG (the workhorse)
│       ├── terminal-gif.js
│       ├── trace.js
│       ├── thread.js
│       ├── stat.js
│       ├── cta.js
│       └── request.js          # API request/response card
└── examples/
    ├── hello.json            # Minimal starting spec
    ├── kitsoki-pitch.json    # Full real-world sample (every scene type; safe to delete)
    └── <name>.json           # Additional specs live here
```

To add a new scene type:
1. Add a render module in `src/scenes/<name>.js` (`{ render(page, scene, ctx) }`)
2. Register it in `src/renderer.js`'s `SCENE_MODULES`
3. Add HTML region + CSS in `src/template.html` (`<div id="<name>-region">…</div>`)
4. Add `window.slidey.show<Name>(scene)` / `hide<Name>()` methods inline in src/template.html
5. Add reveal state names to `src/timing.js` and to the `_PITCH_REVEALS` table in `src/template.html`
6. Add a branch to `estimateScene()` in `src/timing.js` so `--estimate` knows the duration

## Render pipeline (one-line summary)

`spec.json → renderer.js (Puppeteer screenshots) → frames/*.png → [narration.js (edge-tts) → audio/*.mp3] → assembler.js (ffmpeg) → output.mp4`

Determinism comes from: (1) viewport size fixed at 1920×1080, (2) timing in frame counts not seconds, (3) JSON spec — no LLM in the rendering loop, ever.

## Iteration workflow

1. `slidey examples/my-video.json --list` — see what scenes exist and page counts.
2. Edit the spec JSON.
3. `slidey examples/my-video.json --estimate` — verify no narration overrun.
4. `slidey examples/my-video.json out.mp4 --check` — validate diagram-svg sizing/overlap (~instant, no render; exits non-zero on violations, so it doubles as a CI gate).
5. `slidey examples/my-video.json .artifacts/check --scenes N` — PNG spot-check (~1-3s). Read the output files directly to review layout with vision.
6. Repeat 2–5 until the scene looks right.
7. `slidey examples/my-video.json .artifacts/deck.pdf` — full pass as PDF (~3s) to review the whole deck in sequence.
8. `slidey examples/my-video.json examples/my-video.mp4` — final MP4 render only when layout and narration are confirmed.

**Never render MP4 to "see if it works."** PNG or PDF first.
