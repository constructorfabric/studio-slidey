# studio-slidey

A part of Studio - a tool that generates animated presentations, videos and HTML viewer from declarative json manifest

Deterministic, spec-driven declarative scene engine. A JSON spec describes an
ordered list of scenes; from that **one spec** slidey produces three outputs that
all share a single set of Vue 3 scene components (so they never drift):

- **Video** (`out.mp4`) — headless Chrome screenshots each frame, `edge-tts`
  synthesises narration, ffmpeg muxes to MP4.
- **PDF** (`out.pdf`) — one vector page per reveal step (a diagram that builds
  across N panels becomes N pages). Text and SVG stay selectable, not rasterised.
  (Add `--pdf-raster` to instead emit a flat JPEG per page — larger, not
  selectable, but paints instantly in viewers that repaint vector gradients
  slowly, e.g. macOS Preview. Tune with `--pdf-raster-quality <n>` (default 92;
  use 95 to kill banding on dark gradients on iPhone/OLED) and
  `--pdf-raster-scale <n>` (default 2; 1.5 ≈ 2880px wide, smaller but still
  crisp on phones).)
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

## Native localization and accessibility

Slidey localizes from one canonical deck rather than forking translations. A
locale overlay is source-hash checked, so a translated web, PDF, or MP4 export
cannot silently drift from its source. The interactive viewer applies the
deck's `meta.locale` to the document language, announces slide and reveal
position to assistive technology, preserves native keyboard controls for media
and buttons, honors reduced-motion preferences, and can show narration as
closed captions during automatic playback. These behaviors are part of the
same deck runtime—not a separate accessibility export.

For the iteration workflow (when to use `--estimate`, `--scenes`,
`--skip-render`, narration budgeting, common gotchas), see
[`.claude/skills/slidey-authoring/SKILL.md`](.claude/skills/slidey-authoring/SKILL.md).
This document is the **reference**: pipeline architecture and JSON schema.

## Requirements

Three external prerequisites — only Node is needed for the schema/validation
tooling; `ffmpeg` is needed for MP4 export, and `edge-tts` is needed when a
deck contains narration:

| Prerequisite | Needed for | Check | Install |
|---|---|---|---|
| **Node 20.19–22.x** | everything (CLI, build, validation) | `node --version` | [nodejs.org](https://nodejs.org/) or `nvm install 22` |
| **ffmpeg** on `PATH` | video output only — muxes frames + audio into the MP4 | `ffmpeg -version` | `apt install ffmpeg` · `brew install ffmpeg` |
| **edge-tts** on `PATH` | narration audio only | `edge-tts --version` | `pipx install edge-tts` (or `pip install edge-tts`) |

Notes:

- Run `slidey doctor` or `make doctor` after setup. By default it checks the
  narrated-MP4 path: Node packages, render bundle, browser launch, `ffmpeg`,
  `ffprobe`, `edge-tts`, and a tiny online TTS sample with
  `en-AU-NatashaNeural`. Use `slidey doctor --no-narration` for PDF/PNG/silent
  video environments, or `--no-tts-sample` when CI cannot make network calls.
  Doctor does not install Homebrew/Python dependencies; it exits non-zero and
  prints concrete `fix:` commands for anything missing.
- **edge-tts** is a Python package and uses Microsoft's online TTS, so narrated
  renders need network access. It is only invoked when at least one scene
  carries a `narration` string — a spec with no narration renders silently
  without it, and PDF output skips narration entirely. So a no-narration video
  or any PDF needs neither edge-tts nor network.
- `npm install` pulls `puppeteer` (which downloads a pinned Chromium on first
  install), plus `ajv`, `dagre`, `jsonpath-plus`, `pdf-lib`, and the Vue/Vite
  build toolchain. No system Chrome is required — Puppeteer brings its own.
- This repo's `.npmrc` pins an internal registry (`global-npm-prod-virtual`);
  `npm install` against the public registry may 401. Leave `.npmrc` in place.

## Quick start

```sh
make setup                                            # npm install, build render bundle, run doctor
# or manually:
npm install
npm run build:render                                  # build the Vue render bundle (required before video/PDF)
npm run doctor                                        # verify narrated MP4 export dependencies

node src/index.js examples/hello.slidey.json --validate     # check the spec is well-formed (no render, no deps)
node src/index.js examples/hello.slidey.json --estimate     # scene/duration table, no render (~50ms)
node src/index.js examples/hello.slidey.json out.mp4        # video  (needs ffmpeg; + edge-tts/network if narrated)
node src/index.js examples/hello.slidey.json out.pdf       # slides — one page per reveal step (no ffmpeg/edge-tts)

npm run dev                                           # interactive web app (Vite); open ?spec=<url> or drop a spec

npm run build:single -- examples/hello.slidey.json hello.html   # one self-contained .html — open it straight off disk
```

Slidey specs use the `.slidey.json` extension (this is what the file-tree sidebar
and the VS Code extension auto-discover), and `.readonly.slidey.json` is the
authoritative, non-editable variant for reports/artifacts.
`examples/hello.slidey.json` is the
smallest starting point; `examples/kitsoki-pitch.slidey.json` is a fuller pitch
example, and `examples/layout-gallery.slidey.json` exercises the authoring
layout gallery. `examples/embed-qa.slidey.json` is the single manual-QA deck for
inline references and embeddable media. Keep `examples/embed-qa.slidey.json` up
to date whenever Slidey adds a new reference kind, plugin viewer, media source,
or embeddable scene source. All examples are safe to delete or copy as templates.

### Collections, synced subset decks, and drill-down navigation

A `.slidey.json` file can also be a **library**. The root `scenes[]` are the
full source deck and can be used for synced subset views. `library.decks` can
also contain hierarchy decks: separate child presentations with their own local
slides and parent/child navigation. In the viewer sidebar, a collection spec
expands like a folder: source deck, hierarchy children, grandchildren, and a
separate Subsets group.

```json
{
  "meta": { "title": "Tree of Life taxonomy", "mode": "pitch" },
  "library": {
    "sourceTitle": "Tree of Life",
    "defaultDeck": "source",
    "decks": [
      {
        "id": "bacteria",
        "deckType": "hierarchy",
        "title": "Bacteria",
        "scenes": [
          { "id": "bacteria-intro", "type": "title", "title": "Bacteria" },
          {
            "id": "bacteria-lineages",
            "type": "cards",
            "variant": "grid",
            "title": "Major bacterial lineages",
            "links": [
              { "deck": "proteobacteria", "label": "Open Proteobacteria" },
              { "deck": "cyanobacteria", "label": "Open Cyanobacteria" }
            ],
            "cards": [
              { "label": "Proteobacteria" },
              { "label": "Cyanobacteria" }
            ]
          }
        ],
        "children": [
          {
            "id": "proteobacteria",
            "deckType": "hierarchy",
            "title": "Proteobacteria",
            "scenes": [
              { "id": "proteobacteria-intro", "type": "title", "title": "Proteobacteria" }
            ]
          },
          {
            "id": "cyanobacteria",
            "deckType": "hierarchy",
            "title": "Cyanobacteria",
            "scenes": [
              { "id": "cyanobacteria-intro", "type": "title", "title": "Cyanobacteria" }
            ]
          }
        ]
      },
      {
        "id": "eukarya",
        "deckType": "hierarchy",
        "title": "Eukarya",
        "children": [
          { "id": "animals", "deckType": "hierarchy", "title": "Animals", "scenes": [{ "id": "animals-intro", "type": "title", "title": "Animals" }] },
          { "id": "plants", "deckType": "hierarchy", "title": "Plants", "scenes": [{ "id": "plants-intro", "type": "title", "title": "Plants" }] },
          { "id": "fungi", "deckType": "hierarchy", "title": "Fungi", "scenes": [{ "id": "fungi-intro", "type": "title", "title": "Fungi" }] }
        ],
        "scenes": [
          { "id": "eukarya-intro", "type": "title", "title": "Eukarya" }
        ]
      },
      {
        "id": "intro-biology",
        "deckType": "subset",
        "title": "Intro biology subset",
        "purpose": "classroom",
        "theme": "overview",
        "select": { "tags": ["intro"] }
      }
    ],
    "sections": [
      { "id": "bacteria", "title": "Bacteria", "deck": "bacteria" },
      { "id": "proteobacteria", "title": "Proteobacteria", "parent": "bacteria", "deck": "proteobacteria" },
      { "id": "cyanobacteria", "title": "Cyanobacteria", "parent": "bacteria", "deck": "cyanobacteria" },
      { "id": "eukarya", "title": "Eukarya", "deck": "eukarya" }
    ]
  },
  "scenes": [
    { "id": "intro", "type": "title", "title": "Tree of Life", "tags": ["intro"] },
    {
      "id": "three-domains",
      "type": "cards",
      "variant": "grid",
      "title": "Three domains",
      "tags": ["intro"],
      "links": [
        { "deck": "bacteria", "label": "Open Bacteria" },
        { "deck": "eukarya", "label": "Open Eukarya" }
      ],
      "cards": [
        { "label": "Bacteria" },
        { "label": "Archaea" },
        { "label": "Eukarya" }
      ]
    }
  ]
}
```

Open the viewer directly with `slidey deck.slidey.json --deck eukarya`, or
append `?deck=eukarya` to a hosted viewer URL. Render/export commands also
accept `--deck eukarya`. In the web viewer, subset decks are read-only
resolved views; edit the source deck and every subset follows. Hierarchy decks
are separate presentations and show normal slide counts, not “3 of 5” subset
counts. Summary scenes can link to deeper decks with
`links: [{ "label": "Open Animals", "deck": "animals" }]`, or by matching
`scene.section` to `library.sections[].deck`.

#### A master deck composing sibling deck FILES

A large stack (one master + several child decks, each maintained by a
different author) doesn't have to be one giant inlined JSON file. A
`library.decks[]` entry can point at another `.slidey.json` file with `src`
(aliases `file`/`path`, resolved relative to the file that declares the
reference) instead of an inline `scenes[]` array. The referenced file is an
ordinary, independently-openable/validatable slidey spec — its top-level
`scenes[]` become that deck's local (hierarchy) scenes, and if it ALSO has its
own `library.decks[]`, those become nested grandchildren:

```json
{
  "meta": { "title": "Constructor Studio stack", "mode": "pitch" },
  "library": {
    "sourceTitle": "Full stack deck",
    "decks": [
      { "id": "pog", "deckType": "hierarchy", "title": "POG deep dive", "src": "pog-deck.slidey.json" },
      { "id": "kitsoki", "deckType": "hierarchy", "title": "Kitsoki deep dive", "src": "kitsoki-deck.slidey.json" },
      {
        "id": "pitch-15min",
        "deckType": "subset",
        "title": "15-minute pitch cut",
        "scenes": [
          "root-intro",
          { "fromDeck": "pog", "ref": "pog-title" },
          { "fromDeck": "pog", "ref": "pog-detail", "narration": "Custom VO for this cut", "overrides": { "eyebrow": "POG, in one slide" } },
          { "fromDeck": "kitsoki", "ref": "kit-title" },
          "root-close"
        ]
      }
    ]
  },
  "scenes": [
    { "id": "root-intro", "type": "title", "title": "Constructor Studio", "tags": ["pitch"] },
    { "id": "root-close", "type": "narrative", "eyebrow": "Thank you", "body": "Questions?", "tags": ["pitch"] }
  ]
}
```

`pog-deck.slidey.json` and `kitsoki-deck.slidey.json` sit next to the master
and are themselves plain `{ "meta": {...}, "scenes": [...] }` specs (openable
and `slidey validate`-able on their own). The **`pitch-15min` subset selects
specific slides across BOTH children in a bespoke order**, with a per-scene
narration and title (`overrides`) override on top of the file-loaded scene —
the same explicit `{fromDeck, ref, overrides}` ref form works whether the
origin deck's scenes came from an inline `scenes[]` or from `src`. `--deck`,
`--list`, `--estimate`, PNG/PDF/MP4 render, `bundle`, and the viewer's
`/api/tree`+`/api/spec` all resolve the file-loaded children transparently —
see `test/fixtures/deck-stack/` for a complete, runnable 3-file example and
`test/collections-file-refs.test.js` for the coverage (CLI validate/list/
estimate/render, viewer server, node/browser resolver parity, missing-file and
circular-reference handling).

A `select`-based (tag) subset cannot reorder or override per-scene — use the
explicit `scenes: [...]` ref form (as above) whenever a pitch cut needs a
specific order or per-scene copy/VO changes.

### Install as a CLI & open a folder/file

```sh
npm run build:web          # build the viewer bundle once (auto-built on first open if missing)
npm link                   # or: make install   → installs into ~/.local/bin for this user

slidey ./examples          # open a folder → VS-Code-style file-tree sidebar + click-through deck
slidey examples/hello.slidey.json # open a single deck (sidebar rooted at its folder, file pre-selected)
slidey ./examples --port 5000 --no-open   # choose the port; don't auto-launch the browser
```

`slidey <folder>` / `slidey <file.slidey.json>` (no output path) start a small local
server and open the interactive viewer in your browser: pick any `.json` /
`.jsonl` spec from the sidebar, arrow keys / click to step through it.
`slidey in.json out.mp4` (two paths) still renders, unchanged.

### Feedback destinations

The first local preview creates no remote data by default: its feedback picker
offers **Save in this repo**, which appends reviewed bugs, ideas, and evidence
to `.slidey/feedback/feedback.jsonl` beside the deck workspace. That output is
ignored by Git so it is safe for private working notes.

Commit `.slidey/feedback.json` to name the HTTP intake sink(s) used by each
publishing environment. `tools/deploy/publish-deck.sh` injects the selected
`SLIDEY_FEEDBACK_ENVIRONMENT` (default `public`) into the generated deck.
Developers can add an ignored `.slidey/feedback.local.json` overlay to expose a
personal/fork GitHub intake alongside the upstream one:

```json
{
  "publishing": { "environments": { "local": { "sinks": ["my-origin", "upstream-feedback"] } } },
  "sinks": {
    "my-origin": { "label": "My fork GitHub", "type": "http", "endpoint": "https://feedback.example/my-origin" }
  }
}
```

An HTTP sink is an authenticated server-side GitHub/issue intake, not a token
embedded in the deck. The viewer sends only the reviewed Sassfully bundle.

### Preview in VS Code

Slidey also ships a local VS Code extension under `tools/vscode-slidey`. It opens
`.slidey.json`, `.json`, `.jsonl`, and raw rrweb replay logs in a webview preview
tab using the same built web viewer as `slidey <file>`.

```sh
make vscode-install-local
```

That target rebuilds the web viewer, stages the viewer/runtime assets into the
extension package, creates a VSIX, and installs it into the local editor. Override
`CODE_CLI` for a compatible editor CLI:

```sh
make vscode-install-local CODE_CLI=/path/to/code-compatible-cli
```

Inside VS Code, run **Slidey: Preview Deck or Replay** from the command palette,
or use the editor-title / Explorer context menu on a `.slidey.json`, `*.rrweb.json`,
`rrweb.json`, or `.jsonl` file. The extension auto-discovers deck files, rrweb
logs, and `.jsonl` traces; plain `.json` files can still be previewed explicitly.

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

The interactive viewer can also inspect scene references inline. Add
`references` to any scene as a path, object, or list:

```json
{
  "type": "code",
  "variant": "source",
  "title": "Renderer hook",
  "code": "await render(page, scene, ctx)",
  "references": [
    { "label": "Implementation", "src": "src/renderer.js", "kind": "code" },
    "docs/design-notes.md"
  ]
}
```

References resolve relative to the spec. Built-in viewers cover Markdown,
highlighted text/code/JSON, unified diffs (`.diff`/`.patch`), images, and
MP4/WebM videos; unknown types still open as text or in a new tab. Existing media scenes (`image`, `image-compare`,
`video`) automatically expose their own media as inspectable reference chips in
the web viewer.

Use a `reference` scene when the slide should show an excerpt or media preview
that opens into the full modal:

```json
{
  "type": "reference",
  "title": "Design notes",
  "reference": {
    "label": "Full Markdown",
    "src": "docs/design-notes.md",
    "kind": "markdown",
    "section": "Runtime contract"
  }
}
```

For source files, add `lines: [start, end]` (or `lineStart` / `lineEnd`) to show
and highlight the linked range while keeping the modal pointed at the full file.
`code` scenes can also set `sourceRef` so clicking the code block opens the full
source. For proposed code changes, use `kind: "diff"` or a `.diff`/`.patch`
reference; the modal button is labelled `View Diff` and routes through the host
open behavior.

Manual QA for this surface should use `examples/embed-qa.slidey.json`; it covers
Markdown, code, diff patches, JSON/text/logs, image/image-compare, Mermaid graph
source, MP4, and rrweb fixtures in one deck. Keep it updated whenever a new
embed type, reference kind, plugin viewer, or host open behavior is added.

### Inline links that open in a modal

A `[text](target)` Markdown link inside prose is preserved through
`slidey convert` (and can be hand-authored the same way) as
`<a data-slidey-ref="target">text</a>` in the field's `*Html` companion —
`bodyHtml`/`ledeHtml` on `narrative` scenes, `labelHtml`/`subHtml`/`linesHtml`
on Markdown-imported `cards`, `introHtml`/`outroHtml`, `subtitleHtml`, and so
on. Clicking one in the web viewer opens `target` in whichever surface
already owns that kind — nothing new to configure per link, the routing is
inferred from `target` itself:

- **A path or URL** (`docs/design.md`, `qa-assets/mockup.html`,
  `diagram.svg`, `demo.mp4`, ...) opens the reference viewer modal, exactly
  like a `references[]` entry — same kind inference (Markdown, code, JSON,
  diff, text, image, video), plus a new **`html` kind** for `.html`/`.htm`
  files: it renders the page live in a sandboxed `<iframe>` instead of
  showing it as source.
- **`deck:<id>`** or **`deck:<id>#<sceneId>`** switches to another `library`
  deck (and optionally a scene in it) — the same in-app navigation a `links`
  entry drives, without opening a modal.
- **A target ending in `.rrweb.json`** opens the rrweb session-replay modal.

The modal dismisses via its close button, <kbd>Escape</kbd>, or a backdrop
click — the same as every other reference modal — and the link is exempt
from the deck's click-to-advance navigation, so clicking it never also
changes slides.

Static exports (PNG/PDF/MP4) never intercept the click — there's no click to
intercept — so the link renders as a plain visible reference marker instead
(an underline plus a small ↗ glyph after the text) rather than silently
looking like ordinary prose. Set `meta.linkMarkers: false` on the spec to
hide the glyph deck-wide (the underline stays either way).

```json
{
  "type": "narrative",
  "eyebrow": "Inline links",
  "body": "See the design doc for details.",
  "bodyHtml": "See the <a data-slidey-ref=\"docs/design.md\">design doc</a> for details."
}
```

`examples/embed-qa.slidey.json` includes a slide exercising the Markdown-link
and HTML-iframe cases end to end.

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
node src/index.js convert <input.md> [output.slidey.json]
node src/index.js capture <tour.json> <out.mp4> [--fps N] [--pace N]
node src/index.js capture <tour.json> <out.rrweb.json> --format rrweb [--pace N]
```

The output **extension selects the format**: `.pdf` → slide deck (one page per
reveal step; no frames, narration, or ffmpeg); anything else → MP4 video.

`convert` imports Markdown slide decks, including Marp-style decks with
front-matter and `---` slide separators, into native Slidey JSON:

```sh
node src/index.js convert docs/slides/1_OVERVIEW.md docs/slides/1_OVERVIEW.slidey.json
node src/index.js docs/slides/1_OVERVIEW.slidey.json docs/slides/1_OVERVIEW.pdf
```

The importer is conservative and deterministic. It maps lead slides to `title`,
bullets to `cards`, Markdown tables to `table`, fenced blocks to `code`, and
image slides to `image`; the generated JSON is validated before it is written.

The `capture` subcommand drives a live web app through a time-based tour
storyboard. Two capture formats:

- **MP4 (default)** — a deterministic freeze-frame demo MP4 +
  `<out>.mp4.chapters.json` sidecar, with deck-styled curtain/caption/spotlight
  overlays baked in.
- **rrweb** (`--format rrweb`, or an `*.rrweb.json` output path) — a real-time
  **DOM session log** (`*.rrweb.json` + `<out>.rrweb.json.chapters.json`).
  Captures true motion as compact JSON, not pixels. The clean log (no baked
  overlays) is the single source for both the baked seek-rasterizer and the live
  web-viewer player, and is the same artifact a [kitsoki bug report](#rrweb-as-a-library-for-kitsoki)
  captures.

Embed either with a [`video`](#video--embed-mp4-rrweb-or-a-captured-tour) scene (or
capture on the fly via that scene's `capture` field). See `examples/demos/`.

| Flag | Effect |
|---|---|
| `--fps N` | Frames per second (default 30) |
| `--format rrweb` | `capture` only: record an rrweb DOM-session log instead of an MP4 |
| `--pace N` | `capture` only: dwell multiplier (1 = watch-speed, 0 = 1 frame/step) |
| `--context key=value` | Override a template variable; repeatable; takes precedence over `meta.context` |
| `--scenes 0,3-5` | Render only the given scene indices (still combined into one MP4) |
| `--no-gaps` | Suppress the 0.8s blank between scenes — useful for progressive sequences that should feel continuous |
| `--list` | Print scene index + duration table; no render |
| `--estimate` | Like `--list` plus narration audio-length estimates and overrun warnings |
| `--frames-dir PATH` | Use this directory for frames instead of a temp dir |
| `--keep-frames` | Keep frame directory after render |
| `--skip-render` | Skip PNG generation, reuse cached frames; regenerate narration + mux only |
| `--capture-log FILE` | Write live HTTP responses to JSON (for later playback freeze) |
| `--validate` | Validate the spec against the JSON Schema and exit. Human-readable error report; exits 0/1 (CI-friendly). No render, no ffmpeg/edge-tts |
| `--schema` | Print the spec's JSON Schema to stdout and exit. Pipe to a file or hand to an LLM/editor for completion + inline validation. Needs no input file |
| `--check` | Validate `diagram-svg` scenes' declared geometry (node width/height fit, node overlap, slanted connectors from misaligned box centres, gate/label clearance between boxes) without rendering. Exits 1 on violations (CI-friendly) |
| `--audit [FILE]` | Render every reveal step in headless Chrome and measure the *real* laid-out geometry — off-page content, box/SVG-node overflow, rendered overlap, unsubstituted template vars, tiny text. Writes findings JSON to `FILE` (or stdout); exits 1 on any error-severity finding. The deterministic half of the `slidey-visual-qa` skill |

Run `slidey doctor` before a narrated MP4 export. Use `--no-narration` for
PDF/PNG/silent-video machines, `--no-tts-sample` for offline CI, and
`--voice <id>` to verify the exact Edge TTS voice a deck uses.

## Marp Replacement Matrix

Marp is excellent for Markdown-first slide authoring: `---` separates slides,
directives tune theme/class/pagination/backgrounds, CSS themes control look, and
Marp CLI exports HTML, PDF, PPTX, and images. Slidey now covers the same project
deck migration path while adding deterministic QA and richer developer scenes:

| Capability | Marp | Slidey |
|---|---|---|
| Source format | Markdown + directives | JSON scene spec; `convert` imports Markdown/Marp |
| Slide splitting | `---` horizontal ruler | `scenes[]`; converter reads `---` |
| Themes | CSS themes/directives | Shared Vue/CSS renderer and scene primitives |
| Static diagrams/images | Markdown image syntax | Native `image` scene with local asset inlining |
| Bullets/agenda | Markdown lists | `cards` variants with progressive reveal |
| Tables | Markdown table rendered by browser | `table` scene with comparison/scorecard variants |
| Code | Markdown fences | `code` scene with source/diff/log variants |
| Outputs | HTML, PDF, PPTX, images | MP4, PDF, PNG frames, interactive web, single HTML |
| Narration/video | External workflow | Built-in narration, MP4 assembly, demo/video scenes |
| QA | Visual inspection or external tests | `--validate`, `--check`, `--audit`, reusable visual-QA report |
| Determinism | Browser conversion output | Same Vue scene components for MP4/PDF/PNG/web |

Every render also runs `--validate` implicitly at startup: a spec that fails the
schema aborts before any frames are generated, with the same error report.
`--check` (static geometry) and `--audit` (rendered geometry) are the two layers
of diagram QA — `--check` is instant and needs no build; `--audit` needs the
render bundle (`npm run build:render`).

### For LLMs & agents

Slidey ships its own usage docs so an agent can self-serve without reading the
source tree:

```
slidey docs                            # print the full authoring guide to stdout
slidey --schema                        # print the spec's JSON Schema
slidey skill install                   # install the slidey-authoring agent skill into ./.claude/skills
slidey skill install --user            # …into ~/.claude/skills (every project)
```

`slidey docs` prints the same content as the bundled **slidey-authoring** skill
(scene-type vocabulary, the PNG/PDF/MP4 iteration loop, narration budgeting, and
the accumulated gotchas) — one source backs both, so they never drift. After
`slidey skill install`, Claude Code loads the skill automatically.

### MCP server

For agents that should not have shell access, Slidey also ships a stdio MCP
server:

```sh
slidey-mcp --root /path/to/presentation-workspace
```

The server keeps all file access inside `--root` and exposes tools for the full
authoring loop:

- `slidey_workspace_tree`, `slidey_deck_overview`, `slidey_read_slide`,
  `slidey_search_slides` — discover decks, get a compact outline, retrieve one
  slide, or search slide text without fetching an entire large spec.
- `slidey_read_spec` — read the complete `.slidey.json`,
  `.readonly.slidey.json`, or generated `.jsonl` trace deck when it is needed.
- `slidey_write_spec`, `slidey_patch_spec` — edit `.json` specs directly;
  `.jsonl` and `.readonly.slidey.json` are read-only because their specs are
  generated or authoritative.
- `slidey_validate`, `slidey_check`, `slidey_audit` — schema/semantic
  validation, static `diagram-svg` geometry checks, and rendered browser
  geometry debugging.
- `slidey_scene_summary` — list scenes, reveal steps, estimated timing, and
  narration snippets.
- `slidey_render_png`, `slidey_render_html` — render a specific scene/reveal
  step through the real Vue render bundle and return an image or HTML snapshot.
- `slidey_schema`, `slidey_docs`, `slidey_doctor` — expose the schema, bundled
  authoring guide, and export setup check.

The PNG/HTML/audit tools launch headless Chrome, so they need the same browser
setup as PDF/PNG/video rendering. The MCP protocol itself uses stdout; Slidey
diagnostics are written to stderr so client framing stays clean.

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
*slides* family (`title`, `narrative`, `diagram`, `diagram-svg`, `mermaid`,
`trace`, `transcript`, `thread`, `stat`, `cta`, `terminal-gif`, `cards`,
`objectives`, `evidence`, `code`, `reference`, `table`, `chart`, `image`,
`image-compare`, `book`, `video`, `personas`) and an
*api* family (`request`). The
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
| `meta.narration.pronunciations` | `{ "term": "respelling" }` map fixing TTS mispronunciations. Applied whole-word and case-insensitively to the **spoken** audio only (spec/`--list` text is unchanged). Use lower-case pronounceable syllables for words; use spaced capitals only for acronyms you want spelled out. Avoid uncommon tokens like `soh` that some voices spell out. e.g. `{ "Anthropic": "an throp ik", "SDLC": "S D L C", "Kitsoki": "kit so key" }` |
| `meta.context` | Key/value template variables interpolated into scene fields. Overridden by `--context` CLI flags |
| `meta.personas` | Deck-wide cast registry for `personas` scenes. Each entry has `id`, plus optional `name`, `role`, `intro`, `color`, and `glyph` |
| `meta.theme` | Theme name or `{ name, background, fontFamily, colors, css }`. Built-ins include `rose-pine-moon`, `github-dark-default`, `one-dark-pro`, `dracula`, `ayu-dark`, `monokai-pro`, `night-owl`, `tokyo-night`, `palenight`, `synthwave-84`, and `atom-one-light` |
| `meta.themePacks` | Optional array of pack JSON paths, resolved relative to the deck, or inline pack objects. Use this when a deck needs an explicit reusable theme/layout pack |

A scene also takes a top-level `narration: "..."` string (any scene type). If
**any** scene has `narration`, edge-tts is invoked and the resulting audio is
muxed onto the video, with each segment starting at that scene's start frame.

Scenes also accept `hold: <frames>` to extend the post-reveal dwell. `30
frames = 1s` at default fps. The default hold per scene type lives in
`timing.js` (`narrative_hold`, `diagram_hold`, etc.).

### Theme and layout packs

Slidey discovers reusable packs at render/view time, so a project can add color
schemes or layout templates without rebuilding Slidey. Put JSON files in any of:

- `.slidey/packs/*.json`
- `.slidey/theme-packs/*.json`
- `.slidey/template-packs/*.json`
- `slidey-packs/*.json`
- `theme-packs/*.json`
- `slidey.packs.json`, `slidey.theme-pack.json`, or `slidey.template-pack.json`

Pack shape:

```json
{
  "id": "my-project",
  "themes": {
    "my-project": {
      "background": "#101820",
      "colors": {
        "base": "#101820",
        "surface": "#162333",
        "text": "#f6f7f9",
        "accent": "#58a6ff"
      }
    }
  },
  "layouts": [
    {
      "id": "project-proof",
      "label": "Project Proof",
      "scene": { "type": "title", "title": "Proof" }
    }
  ]
}
```

The web editor and `slidey_layout_gallery` include pack layouts. `slidey_add_slide`
can insert them by id.

### Scene types

Each scene is an object with a `type` discriminator. Render handlers live in
`scenes/<type>.js`; the per-type fields below are passed through verbatim.

| Need | Use |
|---|---|
| Opening / section break | `title` |
| Prose beat | `narrative` |
| Hand-authored flow / architecture diagram | `diagram-svg` |
| Mermaid flowchart / sequence / state diagram | `mermaid` |
| Imported screenshot, SVG, or generated image | `image` |
| Before/after screenshot comparison | `image-compare` |
| Recorded terminal animation | `terminal-gif` |
| Product demo, MP4, rrweb recording, or captured tour | `video` |
| Cast of roles, stakeholders, or user journeys | `personas` |
| Book recommendations / bibliography | `book` |
| Lists, comparisons, and Q&A | `cards` |
| Objective status / done vs issue vs next | `objectives` |
| Evidence, checks, commands, paths, and logs | `evidence` |
| Source, diff, logs, config, function I/O | `code` |
| Tables and scorecards | `table` |
| Quantitative charts | `chart` |
| API request/response demo | `request` |

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
      "auto_layout": true,
      "rankdir": "TB",
      "nodes": [
        { "id":"spec","label":"spec.json","sub":"scenes","style":"primary" },
        { "id":"mp4", "label":"out.mp4","sub":"frames + audio" }
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

- **Auto-layout is the normal path.** Set `auto_layout: true` or omit coordinates
  on every node; dagre places the graph, computes the `viewBox`, and the Vue
  component remeasures text so boxes grow to fit labels.
- **Hand placement is the exception.** Use explicit `x`/`y`/`w`/`h` only for
  diagrams dagre cannot express. Run `--check` and a PNG spot-check afterward,
  because auto-sizing can grow a hand-placed box but cannot move its neighbours.
- **Nodes** support `label` (big), `sub` (medium), and `lines: ["...", ...]`
  (smaller multi-line content). `style: "primary"` (blue) or `"secondary"`
  (purple) highlights the focal box.
- **Edges** auto-anchor to whichever sides of the two nodes face each other
  (horizontal vs vertical chosen by which delta dominates). `side: "left" |
  "right"` offsets the line perpendicular to its direction — used for parallel
  bidirectional arrows.
- **Layout controls**: `rankdir: "TB"` gives top-to-bottom flow; `"LR"` works well
  for hub-and-spoke diagrams. `elbow: true` draws orthogonal routes, with shared
  bus routing when several elbow edges leave the same node.
- **Gates**: an edge with `gate: "check fails"` renders as a dashed orange
  checkpoint bar instead of an arrow, with the label uppercased.

Single-panel vs two-panel layouts differ in scale (single = larger fonts,
fixed 680px SVG height, no panel chrome; two = side-by-side, smaller fonts,
1/0.7 aspect ratio). See the authoring skill for sizing rules.

#### `graph` — Cytoscape graph viewer with reveal-by-reveal navigation

Use `graph` when the audience should follow a path through a graph, not just
inspect a static diagram. The first reveal shows the graph; each `path` entry
can center a node, highlight one or more edges, and show a short focus note.

For repeatable pitch or diligence diagrams, prefer a lane grid over hand-tuned
pixel positions:

```json
{
  "type": "graph",
  "title": "Buyer diligence graph",
  "layout": "preset",
  "layoutTemplate": "lane-grid",
  "grid": { "columns": 5, "rows": 3, "x": 105, "y": 95, "width": 2800, "height": 810 },
  "nodes": [
    { "id": "buyer", "label": "Regulated buyer", "col": 1, "row": 2 },
    { "id": "gate", "label": "FIPS 140-3", "sub": "federal crypto gate", "col": 2, "row": 1 },
    { "id": "proof", "label": "Security packet", "col": 4, "row": 1 },
    { "id": "signoff", "label": "Diligence signoff", "col": 5, "row": 2 }
  ],
  "edges": [
    { "id": "buyer-gate", "from": "buyer", "to": "gate", "label": "eligibility gate", "weight": 10 },
    { "id": "gate-proof", "from": "gate", "to": "proof", "label": "evidence", "weight": 8 },
    { "id": "proof-signoff", "from": "proof", "to": "signoff", "label": "clears gate", "weight": 10 }
  ],
  "path": [
    { "node": "buyer", "view": "overview" },
    { "node": "gate", "edge": "buyer-gate", "note": "Hard gate before evaluation." }
  ]
}
```

`layoutTemplate: "lane-grid-3x5"` is a built-in shortcut for three horizontal
lanes across five columns. A custom `grid` overrides the shortcut. Nodes use
one-indexed `col`/`row` slots plus optional `xOffset`/`yOffset` nudges for small
semantic adjustments. Edge labels get deterministic geometry-based offsets and
opaque backgrounds; use `labelMarginX`/`labelMarginY` only for exceptions. When
two edges' auto-computed labels would land on top of each other (a common case
in a dense lane grid, e.g. the crossing diagonals of a 2x2 node block), the
renderer nudges the later one apart rather than stacking them — this only
applies to the auto-offset heuristic, never to an explicit
`labelMarginX`/`labelMarginY` you set yourself. The graph frame always fills
its slide area regardless of `title`/`caption` length.

##### `projection` input mode — render a graph-projection JSON instead of `nodes`/`edges`

Use this to drive graph scenes from an existing graph-projection v1 JSON
(lane/row-positioned nodes, a shared type `palette`, and named `states` that
each select one graph plus a `done`/`fail`/`plan`/`dim`/`pulse` status
overlay) instead of authoring `nodes`/`edges` per scene:

```json
{ "type": "graph",
  "title": "Diligence: compliance question",
  "projection": "gravytanker-portal.graph-projection.json",
  "state": "complianceQuestion",
  "caption": "The buyer's first question is always the crypto boundary." }
```

`projection` is a path relative to the spec file; `state` is a key in the
projection's `states` map (or, as a fallback, a bare graph id with no status
overlay). One scene renders one state — author one scene per state to build a
reveal across several states of the same graph. There is no `path`/`focus`
camera in this mode (`path`/`focus` are Cytoscape-only); the whole graph is
shown at once, sized and centered to fill the frame at the graph's own aspect
ratio. `slidey_graph_audit` statically checks that `projection` resolves to
valid JSON and that `state` is a real key/graph id before you ever render.

#### `mermaid` — Mermaid diagrams rendered as themed SVG

```json
{ "type": "mermaid",
  "title": "Request lifecycle",
  "source": "flowchart LR\n  browser[Browser] --> api[API]\n  api --> db[(Database)]",
  "scale": 1,
  "caption": "Use Mermaid when the diagram source is already the artifact." }
```

Mermaid source is rendered in the Vue bundle with the active Slidey theme, so PDF
output stays vector and the web viewer stays interactive. Use it for common
Mermaid-native diagrams such as `flowchart`, `sequenceDiagram`, and
`stateDiagram-v2`. Use `diagram-svg` instead when you need exact box sizing,
Slidey's node/edge styling, `--check` geometry validation, or highly controlled
placement. `scale` can shrink dense imported diagrams without editing the source.

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

#### `video` — embed MP4, rrweb, or a captured tour

```json
{ "type": "video",
  "src":     "demos/tour.mp4",
  "mode":    "fullscreen",
  "chapters": "auto",
  "annotations": [ { "at": 4, "until": 7, "text": "Note this" } ],
  "narration":   [ { "at": 0, "text": "We open on the home screen." },
                   { "chapter": "open", "text": "Now we open a project." } ] }
```

Splices a product demo or recorded UI session into the deck. Pick **one** source:

- `src` — a pre-rendered MP4 (a sibling `<src>.mp4.chapters.json` drives auto
  captions). This is the best choice when you already have a rendered demo, or
  when you want fast baked MP4/PDF/PNG output.
- `rrweb` — an rrweb DOM-session log (`*.rrweb.json`). Baked output (mp4/pdf/png)
  seek-rasterizes the log via rrweb's `Replayer`; the **web viewer mounts a live,
  scrubbable, chapter-aware player** you can grab to interact with. Chapters come
  from in-log `slidey.chapter` custom events. See `examples/rrweb-demo.slidey.json`.
- `capture` — a tour spec (`*.json`) recorded on the fly via the tour engine, then
  embedded. This is convenient for one-command final renders; for iteration,
  prefer `slidey capture ... out.mp4` or `out.rrweb.json` first and embed the
  produced artifact.

`mode: "embedded"` insets the video in a slide with `eyebrow`/`title`/`caption`
chrome instead of filling the frame (`fit: "contain"|"cover"`);
`start`/`end`/`speed` trim and retime. `audio` can point at an mp3/m4a/wav/ogg
file synced with rrweb playback in the web viewer; raw `*.rrweb.json` or
`rrweb.json` viewer inputs automatically pick up a sibling `*.mp3` when present. Deck-styled lower-third captions come from
the chapter sidecar (`chapters`), `annotations` add timed callouts, and
`narration` may be a string or time-keyed cues (`{at|chapter, text}`) so the
voiceover tracks demo moments. The scene's duration equals the (trimmed) source
length; PNG/PDF export shows a poster frame. Produce a source with
[`slidey capture`](#cli). See `examples/demo-video.slidey.json` (MP4) and
`examples/rrweb-demo.slidey.json` (rrweb).

> **rrweb baked render is the slow path by design.** Each frame is a distinct
> `Replayer.goto(t)` seek + screenshot (real motion), so it's far slower than the
> freeze-frame MP4 path — freeze-frame stays the default; rrweb is opt-in per
> scene. For interactive review, the web viewer plays the log with no render at
> all.

Use `slidey capture` to create demo sources:

```sh
slidey capture examples/demos/kitsoki-onboarding-tour.json examples/demos/tour.mp4
slidey capture examples/demos/kitsoki-onboarding-tour.json examples/demos/tour.rrweb.json --format rrweb
```

Both commands write a matching `.chapters.json` sidecar. The MP4 path bakes a
deterministic freeze-frame walkthrough with deck-styled overlays; the rrweb path
records real DOM motion as compact JSON and keeps the capture clean for reuse in
the web player, bug reports, and later narrated decks.

#### rrweb as a library (for kitsoki)

slidey owns the canonical rrweb pieces and exposes them as subpath exports so
another app (kitsoki) consumes them instead of maintaining its own:

| Import | What |
|---|---|
| `slidey/rrweb-buffer` | App-agnostic rolling-buffer recorder (browser ESM) — the bug-report capture engine. `createSessionCapture(opts)` or the singleton `startSessionCapture` / `snapshotSessionEvents`. |
| `slidey/rrweb-player` | `RrwebPlayer.vue` — themeable (CSS `--rrp-*` vars) scrubbable player with chapter markers + an interactive "grab" toggle. Ship-as-source SFC; the consumer's Vite compiles it. Powers both the deck viewer and kitsoki's bug-report modal. |
| `slidey/rrweb-format` | Node-side `*.rrweb.json` envelope + `chaptersFromEvents()` (→ `source_ref.kind:"rrweb"` chapters). |
| `slidey/rrweb-chapters` | Browser ESM chapter extractor (the fields the player needs). |

A kitsoki bug-report session and a slidey demo recording are the **same artifact
type**: drop a bug session's `*.rrweb.json` into a `video` scene to turn a repro
into a narrated, annotated deck.

#### `cards` — peer-set, contrast, or Q&A layouts

```json
{ "type": "cards", "variant": "grid", "title": "Three pillars",
  "cards": [
    { "label": "Deterministic", "sub": "same spec → same frames" },
    { "label": "Declarative",   "sub": "no LLM in the loop" },
    { "label": "Multi-output",  "sub": "video · PDF · web" }
  ] }
```

One scene type, many shapes selected by `variant`:

- **Peer sets** — `grid`, `list`, `numbered`, `agenda`, `icon-row`: an array of
  `cards` (each `{ label, sub?, lines?, icon?, style? }`). `columns` overrides
  the grid column count.
- **Contrast** — `before-after`, `versus`, `point-counterpoint`, `pros-cons`:
  use `left` and `right` card objects instead of the `cards` array.
- **Q&A** — `qa`: a `question` string and an `answer` (string or array of
  bullet lines).

#### `objectives` — objective status with visual feedback

Use `objectives` for eval/report decks where the viewer needs to know whether
the work is done, in progress, blocked, or has issues. Do not use a generic
`table` for this; status needs a large glyph and color, not just text in a cell.

```json
{ "type": "objectives", "title": "Objective status",
  "items": [
    { "label": "Harness objective", "status": "done",
      "detail": "One local entrypoint and project catalog are in place." },
    { "label": "HTML preview", "status": "issue",
      "detail": "Bundle render is blocked by sandbox write permissions." },
    { "label": "Product-site journey", "status": "next",
      "detail": "Run production web build for A/B walkthroughs." }
  ],
  "caption": "Core harness complete; runtime preview still needs a clean environment." }
```

Statuses: `done` renders a large green checkmark; `issue` and `blocked` render a
large red exclamation mark; `next`, `progress`, `pending`, and `skipped` are
visually distinct but less final. Keep to six items or fewer.

#### `evidence` — checks, artifacts, commands, and paths

Use `evidence` for report decks where each row answers "what proof exists, what
state is it in, and where do I rerun or inspect it?" Do not use a wide `table`
for commands or artifact paths; the evidence layout gives each row a status
glyph and keeps the command/path in a monospace chip.

```json
{ "type": "evidence", "title": "Latest check state",
  "items": [
    { "label": "PostgreSQL", "status": "validated",
      "detail": "ALTER DOMAIN oracle proves baseline red and fix green.",
      "refType": "command",
      "ref": "bash tools/product-journey/checks/postgresql-oracle.sh" },
    { "label": "Run log", "status": "implemented",
      "detail": "Chronological job state and lane validation record.",
      "refType": "log",
      "ref": ".context/product-journey-runlog.md" }
  ],
  "caption": "Each evidence row has a visible state plus a concrete reference." }
```

Statuses: `done`, `validated`, and `implemented` render green checkmarks;
`issue` and `blocked` render red exclamation marks; `next`, `progress`,
`pending`, and `skipped` are visually distinct but less final. `refType` may be
`command`, `artifact`, `path`, `log`, `doc`, or `test`. Keep to six rows or
fewer.

#### `personas` — reusable cast and use-case rows

```json
{
  "meta": {
    "personas": [
      { "id": "pm", "name": "Priya", "role": "Product manager",
        "intro": "Turns a rough idea into a validated plan.",
        "color": "#58a6ff", "glyph": "PM" }
    ]
  },
  "scenes": [
    { "type": "personas", "variant": "cast",
      "title": "The cast", "personas": ["pm"] },
    { "type": "personas", "variant": "use-cases",
      "title": "How the work moves",
      "cases": [
        { "who": "pm", "action": "Frames the customer problem",
          "detail": "keeps the deck anchored in a real user" }
      ] }
  ]
}
```

Use `personas` when the audience needs to remember who is doing what across a
story. Define reusable identities in `meta.personas`, then reference them by id.
`variant: "cast"` renders avatar cards with name, role, and intro;
`variant: "use-cases"` renders action rows attributed to a persona via `who`.
Scenes may also carry inline persona objects for self-contained examples.

#### `code` — source, diff, function I/O, tree, config, or log

```json
{ "type": "code", "variant": "source", "title": "renderer.js", "lang": "javascript",
  "code": "function render(page, scene, ctx) {\n  // …\n}",
  "highlight": [1],
  "annotations": [{ "line": 1, "text": "one entry point per scene type" }] }
```

`variant` picks the artifact: `source` (snippet, with optional 1-based
`highlight` lines and `annotations`), `diff` (+/- coloured), `function-io`
(`call` + `returns` pair), `tree` (indented file tree in `tree`), `config`, or
`log`. `title` is the chrome bar filename; `lang` the language tag.

#### `table` — bordered data / comparison grid

```json
{ "type": "table", "variant": "comparison", "title": "Output formats",
  "columns": ["", "Video", "PDF", "Web"],
  "rows": [
    { "cells": ["Narration", "✓", "✗", "✗"] },
    { "cells": ["Selectable text", "✗", "✓", "✓"] }
  ],
  "winner": 1 }
```

`variant`: `data` (plain values), `comparison` (first column is the criterion,
`✓`/`✗` cells), or `scorecard` (comparison with a highlighted `winner` column).
Max 6 columns, 8 rows. A row's `highlight` accents one column for that row.

#### `chart` — deterministic inline-SVG chart

```json
{ "type": "chart", "variant": "bar", "title": "Frames per scene", "unit": "f",
  "axes": { "x": "scene", "y": "frames" },
  "series": [
    { "name": "duration", "color": "primary",
      "points": [{ "x": "title", "y": 90 }, { "x": "narrative", "y": 165 }] }
  ] }
```

`variant`: `bar`, `line`, `area`, `pie`, `scatter`, or `quadrant`. No D3/Chart.js
— charts are drawn as plain SVG so frames stay byte-deterministic. Each series'
`color` is a design-token name (`primary`, `secondary`, `green`, `orange`,
`red`, `teal`); omit it for the default palette. Point `x` is a category label
or number; `y` is numeric.

#### `image` — static screenshot or diagram

```json
{ "type": "image", "title": "Architecture",
  "src": "docs/img/architecture.drawio.png",
  "caption": "Imported from a Marp image slide." }
```

Local `src` paths are resolved relative to the spec and inlined for headless
MP4/PDF/PNG rendering. `fit` defaults to `contain`; use `cover` for full-bleed
screenshots when cropping is acceptable.

#### `image-compare` — side-by-side screenshot comparison

```json
{ "type": "image-compare",
  "title": "Before / after",
  "left":  { "label": "Before", "src": "compare/old.png" },
  "right": { "label": "After",  "src": "compare/new.png" },
  "fit": "contain",
  "caption": "Useful for migration fidelity and UI reviews." }
```

Use this for visual diffs where the screenshots are the point. `variant: "qa"`
switches to a compact review layout with larger previews and less chrome.

#### `book` — book-cover bibliography

```json
{ "type": "book",
  "title": "Further reading",
  "books": [
    { "title": "Thinking in Systems",
      "authors": "Donella H. Meadows",
      "year": "2008",
      "cover": "assets/books/thinking-in-systems.jpg",
      "takeaway": "A practical vocabulary for feedback loops." }
  ],
  "caption": "One to three books per scene." }
```

Each book needs `title`, `authors`, `cover`, and `takeaway`; `subtitle`,
`publisher`, `year`, `isbn`, and `alt` are optional. Covers are resolved like
other local assets and validated for minimum useful resolution.

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

A scene type is wired across the render driver and the shared Vue bundle. Using
an existing type (e.g. `cards`) as a template, touch these seven places:

1. **`web/components/<Name>Scene.vue`** — the visual component (keep ids/classes
   consistent with `web/styles/template.css`). This is the single source of
   truth that video, PDF, and the web app all render.
2. **`web/components/DeckHost.vue`** — import the component and add it to the
   scene-type → component map.
3. **`web/slideyAdapter.js`** — add `show<Name>(scene)` / `hide<Name>()` over the
   store (`store.showScene('<name>', scene)` / `store.hidePitch()`).
4. **`web/sceneSteps.mjs`** — add a `case '<name>':` to `stepsForScene()`
   returning the ordered reveal-step base-names (one step = one PDF page / nav
   advance / video dwell).
5. **`src/scenes/<name>.js`** — render module exporting `{ render(page, scene,
   ctx) }`; it calls `window.slidey.show<Name>` then walks the same reveal steps
   via `ctx.setState('<step>')`. Register it in `src/renderer.js`'s
   `SCENE_MODULES`.
6. **`src/timing.js`** — per-reveal frame budgets for each step name, plus a
   branch in `estimateScene()` so `--estimate` knows the duration.
7. **`src/schema.js`** — add a `oneOf` branch (discriminated on `type`) so
   `--validate` / `--schema` / startup validation accept the new type. Add its
   name to `VALID_TYPES` in `src/validate.js`.

Then rebuild the bundle (`npm run build:render`) and verify with `--estimate`
and `--audit`. The Vue components in `web/` are the single renderer — the live
viewer and every headless export (PDF/PNG/MP4) drive the same bundle.
