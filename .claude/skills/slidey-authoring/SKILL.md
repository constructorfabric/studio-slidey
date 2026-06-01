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

A full render takes **7–12 minutes** (4,400+ Puppeteer screenshots for a long video). Don't trigger one until you've gone through `--estimate` first. Run commands from the repo root.

**Build the render bundle first.** The visuals are Vue components compiled to `dist-render/render.html`; the video and PDF pipelines load that file. After any change under `web/` (or on a fresh checkout), run `npm run build:render` — otherwise rendering errors with *"render bundle missing"*. `--estimate`/`--list` don't need it.

**Three outputs, one spec.** The output extension picks the format: `.mp4` → video, `.pdf` → slides (one vector page per reveal step — ideal for sharing the step-by-step diagram build-up). The interactive web app is `npm run dev`. Don't run two Puppeteer renders (or render while another browser-driving test runs) at once — concurrent headless Chrome instances can crash each other's screenshot capture.

```sh
npm run build:render                                 # (re)build the Vue bundle after editing web/

# 1. Sanity-check the spec — no render, ~50ms (no bundle needed)
node src/index.js examples/my-video.json --estimate

# 1b. Slide deck — one page per reveal step, vector/selectable, ~3s
node src/index.js examples/my-video.json .artifacts/deck.pdf

# 2. Iterate on a single scene — ~30s
node src/index.js examples/my-video.json .artifacts/scene.mp4 --scenes 5

# 3. Render a section for review — one merged MP4, ~30s per scene in the range
#    --scenes accepts comma-separated indices and/or N-M ranges; all selected
#    scenes are concatenated into one output file.
#    Add --no-gaps to suppress the 0.8s blank between scenes — useful for
#    progressive sequences that should feel like one continuous diagram.
node src/index.js examples/my-video.json .artifacts/section.mp4 --scenes 7-10 --no-gaps
node src/index.js examples/my-video.json .artifacts/section.mp4 --scenes 0,3-5,7

# 4. Iterate on narration text only — ~10s (reuses cached frames)
node src/index.js examples/my-video.json .artifacts/out.mp4 \
  --frames-dir .artifacts/frames \
  --keep-frames \
  --skip-render

# 5. Final full render — 7–12 min
node src/index.js examples/my-video.json examples/my-video.mp4
```

**Always run `--estimate` first.** It catches narration overruns (the #1 cause of wasted full renders) and prints scene start times so you don't have to count.

**Use `--scenes N-M` for section review.** When iterating on a multi-scene sequence (e.g. a progressive graph build-up), render the whole range into one merged MP4 rather than separate files. The reviewer can watch the sequence in one clip without clicking between videos.

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

The most-used type. Each panel has a viewBox and an array of `nodes` and `edges`.

- **Nodes** support `label` (big), `sub` (medium), and `lines: []` (smaller multi-line content stacked below). Use `style: "primary"` (blue accent) or `"secondary"` (purple) to highlight the focal box.
- **Edges** auto-anchor to the sides of the connected nodes facing each other. The renderer picks horizontal vs vertical anchoring based on which axis dominates the delta. `side: "left"|"right"` offsets the edge perpendicular to its direction — used for parallel bidirectional arrows.
- **Gates** are a special edge property. Setting `gate: "check fails"` on an edge replaces the arrow with a dashed orange checkpoint bar and uppercase label. Format the spec text as `"gate · check fails"` so the rendered uppercase reads "GATE · CHECK FAILS".

### Single-panel vs two-panel diagrams

Slidey's CSS treats `diagram-svg` panels differently based on count:

- **Two panels** (side-by-side comparison): smaller boxes, smaller fonts (label 30 / sub 19 / line 18 in viewBox units), aspect-ratio 1/0.7 so panels are wide-and-short. Good for comparisons.
- **Single panel** (hero diagram): bigger boxes, bigger fonts (label 44 / sub 28 / line 26), SVG height 680px, no panel chrome (transparent border). Good for standalone diagrams.

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

### Title/caption clipping

If a scene's content overflows the available stage height (1080px − 192px padding = 888px on screen), `overflow: hidden` clips top and bottom equally, pushing the title against the top edge and clipping the caption.

For two-panel diagrams: the SVG aspect-ratio is `1/0.7`, so each panel SVG is ~70% as tall as it is wide. The CONTENT inside scales to fit via `preserveAspectRatio="meet"`. Make panel content fit by either (a) reducing content lines per node, or (b) reducing SVG aspect via the panel's viewBox.

For single-panel diagrams: SVG is hard-capped at 680px height. Title (40px) + caption (32–36px wrapped to 2 lines) + gaps eats ~200px, leaving ~680px for the SVG itself. If content needs more, you've overpacked the scene.

### The `--scenes` flag rewrites the output file

`--scenes 4` overwrites the output MP4 with **only** scene 4 (and its narration). When iterating on a single scene, always send output to `.artifacts/`:

```sh
node src/index.js spec.json .artifacts/test.mp4 --scenes 4
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

1. `node src/index.js examples/my-video.json --list` — see what scenes exist.
2. Make your edit to the spec.
3. `node src/index.js examples/my-video.json --estimate` — verify the change doesn't blow a budget.
4. `node src/index.js examples/my-video.json .artifacts/test.mp4 --scenes N` — visual check on a single scene (~30s).
5. `node src/index.js examples/my-video.json .artifacts/section.mp4 --scenes N-M --no-gaps` — seamless section review; `--no-gaps` removes the 0.8s blank between scenes so progressive sequences feel like one diagram.
6. Once happy, run the full render.

Don't full-render to "see if it works."
