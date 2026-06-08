# Slidey Layout Taxonomy

A planned, **semantic** catalogue of reusable layouts for slidey scenes.

## Design principle: organise by intent, not by appearance

The single rule this taxonomy is built on:

> An author (human or LLM) does not think *"I want two columns."*
> They think *"I want to contrast our approach with the old one."*

Visual descriptors — *columns, grid, left/right* — are poor selection keys. Many
intents share the same shape (a 2×2 quadrant and a pros/cons table and a
before/after both look like "two boxes"), and one intent can take many shapes (a
*process* can be a horizontal pipeline, a vertical list, or a cycle). When the
catalogue is keyed on shape, an LLM picks by superficial resemblance and gets it
wrong.

So every layout here is filed under **what it is trying to communicate**. The
shape is an implementation detail chosen *after* the intent is known.

This mirrors the three frameworks the design draws on, each of which is
semantic, not visual:

- **Microsoft SmartArt** — 8 categories defined by relationship type: *List,
  Process, Cycle, Hierarchy, Relationship, Matrix, Pyramid, Picture.*
  ([Choose a SmartArt graphic](https://support.microsoft.com/en-us/office/choose-a-smartart-graphic-e9a7a134-f8a5-4251-aba2-93f96b88644d))
- **Abela's chart chooser** — picks a chart by the *question about the data*:
  *Comparison, Composition, Distribution, Relationship, Trend.*
  ([Data visualization chart types](https://eazybi.com/blog/data-visualization-and-chart-types))
- **Duarte's contrast / sparkline** — narrative is built by oscillating
  *"what is"* against *"what could be."*
  ([Duarte: contrast](https://www.duarte.com/blog/ultimate-guide-to-contrast/))

Mermaid's diagram catalogue (flowchart, sequence, state, ER, class, gantt,
timeline, journey, quadrant, sankey, …) informed the *Sequence / Structure /
Relate* families.
([Mermaid diagram types](https://mermaid.js.org/intro/syntax-reference.html))

---

## How selection works

1. The author states an **intent** in a sentence: *"show how a request flows
   through three services,"* *"prove our latency dropped,"* *"contrast the
   manual workflow with the automated one."*
2. The verb in that sentence maps to a **family** (§ The nine families).
3. Within the family, the **modifiers** (over time? part-of-whole? real
   artifact?) pick the concrete **layout**.
4. The layout names a scene `type` (+ a `variant`/`intent` field). The shape is
   resolved by the renderer.

A flat decision table for step 2→3 is at the end (§ Intent → layout index). It
is the Abela chart-chooser idea generalised to all slide content, and it is the
primary surface an LLM should consult.

---

## Architecture strategy: a few flexible primitives, many semantic presets

The taxonomy below lists ~45 layouts. **It does not imply ~45 Vue components.**
That would be unmaintainable and would push visual decisions back onto the
author. Instead, layouts collapse onto a small number of **primitives**, each
parameterised by a semantic `variant`:

| Primitive (scene `type`) | Status | Absorbs these families |
|---|---|---|
| `diagram-svg` | **exists** | Sequence, Structure, Relate (everything node+edge) |
| `cards` *(new)* | **new** | Enumerate, Compare (peer items / side-by-side) |
| `code` *(new)* | **new** | Demonstrate: source, diff, function I/O, file tree, config, logs |
| `chart` *(new)* | **new** | Quantify: bar, line, area, pie/donut, scatter |
| `table` *(new)* | **new** | Quantify + Compare: data tables, comparison matrices, scorecards |
| `statement` *(new, or extend `narrative`)* | **extend** | Frame, Assert (text-forward layouts, quote, definition) |
| `metrics` *(new, or extend `stat`)* | **extend** | Assert: multi-KPI row |
| existing: `narrative` `stat` `cta` `title` `terminal-gif` `trace` `transcript` `thread` `request` | **exists** | Frame, Assert, Demonstrate |

So the build is **5 new primitives + 2 extensions**, exposing ~45 *named
semantic layouts* via a `variant` enum on each. The author picks a semantic
name; the renderer picks pixels.

Why this matters for LLM authoring: the `variant` enum on each primitive is a
closed vocabulary of *intents* (`"pipeline"`, `"cycle"`, `"before-after"`,
`"pros-cons"`, `"bar"`, `"trend"`). The model selects from a short semantic
menu, never from raw geometry. The crucial design point — `diagram-svg` already
covers three whole families purely by varying `rankdir` + edge style; most
"new diagram layouts" are **example specs, not code.**

---

## The nine families

Each family is *a verb* — the communicative job. Layouts within it are filed by
the modifier that distinguishes them.

Status legend: **✅ exists** · **🔧 extend an existing type** · **🆕 new primitive/variant**

---

### 1. FRAME — orient, transition, set context

> *"Tell them where they are / what this means / what's coming."* Connective
> tissue between substantive scenes. SmartArt analogue: none (this is narration).

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Title / cold open | open the deck or a major section | `title` | ✅ |
| Section break | mark a chapter boundary (e.g. "vs.") | `title` (eyebrow only) | ✅ |
| Narrative beat | land a sentence or two of prose with rhythm | `narrative` | ✅ |
| Agenda / roadmap | preview the structure of the talk | `cards` (`variant:"agenda"`) | 🆕 |
| Definition / term | introduce one concept and its meaning | `statement` (`variant:"definition"`) | 🔧 |
| Quote / testimonial | borrow authority from a voice | `statement` (`variant:"quote"`) | 🆕 |

### 2. ASSERT — land one idea with weight

> *"Make them feel the force of a single point."* One scene = one claim. Used at
> emotional peaks (Duarte's climaxes).

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Big statement / thesis | state the core claim as a headline | `statement` (`variant:"headline"`) | 🔧 |
| Single statistic | make one number hit hard | `stat` | ✅ |
| KPI / metric row | show 2–4 headline numbers together | `metrics` | 🔧 (extend `stat`) |
| Callout / takeaway | isolate "the thing to remember" | `statement` (`variant:"callout"`) | 🆕 |
| Call to action | close with the ask + where to go | `cta` | ✅ |

### 3. ENUMERATE — a set of peer items

> *"Here are N things at the same level."* Order may or may not matter, but there
> is **no flow between them.** SmartArt analogue: **List.** This is the family
> people reach for when they want "bullets" — give them a better shape.

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Key points / list | present 3–6 non-sequential points | `cards` (`variant:"list"`) | 🆕 |
| Feature grid | show a set of capabilities as cards | `cards` (`variant:"grid"`) | 🆕 |
| Numbered items | present items where rank matters but flow doesn't | `cards` (`variant:"numbered"`) | 🆕 |
| Icon row | a compact horizontal set of labelled items | `cards` (`variant:"icon-row"`) | 🆕 |

### 4. SEQUENCE — ordered flow over time or causality

> *"A leads to B leads to C."* There is direction. SmartArt analogue:
> **Process / Cycle.** Mermaid: flowchart, sequence, gantt, timeline.

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Pipeline / process | show steps A→B→C with direction | `diagram-svg` (`rankdir:"LR"`/`"TB"`) | ✅ |
| Timeline / roadmap | place events/phases on a time axis | `diagram-svg` (`variant:"timeline"`) | 🔧 (spec preset) |
| Cycle / loop | show a repeating, closed-loop process | `diagram-svg` (`variant:"cycle"`) | 🔧 (closing edge) |
| Lifecycle / state machine | show states and the transitions between them | `diagram-svg` (decision-tree style) | ✅ |
| Sequence / interaction | show messages exchanged between actors over time | `diagram-svg` (`variant:"sequence"`) | 🔧 (spec preset) |

### 5. STRUCTURE — part/whole and hierarchy

> *"How the pieces nest / who reports to whom / what's built on what."* Static
> containment, not flow. SmartArt analogue: **Hierarchy / Pyramid.**

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Architecture / layers | show a stacked, layered system | `diagram-svg` (`rankdir:"TB"`) | ✅ |
| Tree / org chart | show parent→child hierarchy | `diagram-svg` (`rankdir:"TB"`) | ✅ |
| Hub-and-spoke | show one centre fanning out to many | `diagram-svg` (`rankdir:"LR"`, `elbow`) | ✅ |
| Pyramid / maturity | show proportional levels building up | `diagram-svg` (`variant:"pyramid"`) | 🔧 (spec preset) |
| Containment / nesting | show components inside a boundary | `diagram-svg` (subgraph boxes) | 🔧 (cluster support) |

### 6. RELATE — non-hierarchical connections

> *"How these factors interrelate"* — no parent/child, no time order. SmartArt
> analogue: **Relationship / Matrix.** Mermaid: ER, class, quadrant.

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Network / mesh | show many-to-many connections | `diagram-svg` (free edges) | ✅ |
| Matrix / 2×2 quadrant | position items on two axes | `chart` (`variant:"quadrant"`) | 🆕 |
| Venn / overlap | show shared vs distinct membership | `diagram-svg` (`variant:"venn"`) | 🆕 |
| Mapping (A ↔ B) | show correspondence between two sets | `diagram-svg` (`rankdir:"LR"`, bipartite) | ✅ |
| Entity-relationship | show data entities and their relations | `diagram-svg` (ER node style) | 🔧 |

### 7. COMPARE — set items against each other

> *"X versus Y."* The audience is meant to weigh options. This is Duarte's
> **contrast** engine. SmartArt analogue: partly Matrix. The "2-column" request
> lives **here** — but as *contrast*, never as "two columns" in the abstract.

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Before / after | contrast a prior state with a new one | `cards` (`variant:"before-after"`) | 🆕 (replaces ASCII `diagram`) |
| This vs that | put two alternatives side by side | `cards` (`variant:"versus"`) | 🆕 |
| Point / counterpoint | stage a claim against its rebuttal | `cards` (`variant:"point-counterpoint"`) | 🆕 |
| Pros / cons | weigh upsides against downsides | `cards` (`variant:"pros-cons"`) | 🆕 |
| Comparison matrix | compare N options across M criteria | `table` (`variant:"comparison"`) | 🆕 |
| Option scorecard | rate options, highlight a winner | `table` (`variant:"scorecard"`) | 🆕 |

### 8. QUANTIFY — data and measurement

> *"What do the numbers say?"* This whole family is **missing today.** Filed by
> Abela's question-about-the-data, not by chart shape.

| Layout (Abela question) | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Comparison — bar/column | compare a value across categories | `chart` (`variant:"bar"`) | 🆕 |
| Trend — line/area | show change over a continuous axis (time) | `chart` (`variant:"line"` / `"area"`) | 🆕 |
| Composition — pie/donut | show parts of a single whole (≤5 slices) | `chart` (`variant:"pie"`) | 🆕 |
| Composition — stacked bar | show part-of-whole across categories | `chart` (`variant:"stacked-bar"`) | 🆕 |
| Relationship — scatter | show correlation between two variables | `chart` (`variant:"scatter"`) | 🆕 |
| Data table | show exact values in rows/columns | `table` (`variant:"data"`) | 🆕 |

Guidance baked into the variant docs: pie only for simple composition, never for
comparison or trend; bar for category comparison; line for time trend. (Abela.)

### 9. DEMONSTRATE — show the real technical artifact

> *"Here is the actual thing."* Slidey's distinctive strength and the heart of
> the user's request. Concrete developer evidence, rendered faithfully. SmartArt
> has no analogue — this family is what makes slidey a *developer* presentation
> tool rather than a generic one.

| Layout | Use when you want to… | `type` (variant) | Status |
|---|---|---|---|
| Code block | show formatted, syntax-highlighted source | `code` (`variant:"source"`) | 🆕 |
| Code diff | show what changed (added/removed lines) | `code` (`variant:"diff"`) | 🆕 |
| Function I/O | show input args → return value of a call | `code` (`variant:"function-io"`) | 🆕 |
| File tree | show project/directory structure | `code` (`variant:"tree"`) | 🆕 |
| Config / data file | show a JSON/YAML/TOML artifact | `code` (`variant:"config"`) | 🆕 |
| Log / console output | show emitted log lines or stack traces | `code` (`variant:"log"`) | 🆕 |
| Terminal session (static) | show a command and its output, no animation | `terminal` | 🆕 (static sibling of `terminal-gif`) |
| Terminal session (recorded) | show an animated recorded terminal | `terminal-gif` | ✅ |
| HTTP request/response | show an API call and its response | `request` | ✅ |
| Chat / conversation | show an LLM/agent conversation | `transcript` | ✅ |
| Lookup / trace cascade | show a multi-layer lookup with HIT/MISS | `trace` | ✅ |
| Review / issue thread | show a mocked PR/issue comment thread | `thread` | ✅ |
| Q & A / FAQ | stage a question and its answer | `cards` (`variant:"qa"`) | 🆕 |

> Note on **Q&A**: it straddles Frame and Demonstrate. It is filed here because
> in this tool a Q&A is almost always *"a question a skeptic asks + our concrete
> answer,"* i.e. evidence. If used purely as a rhetorical device, the same
> `cards` variant serves.

---

## Intent → layout index (the chart-chooser for slides)

The primary LLM-facing surface. Read top-down: match the author's sentence to a
row.

| If the author wants to… | Family | Layout | `type` |
|---|---|---|---|
| open / transition / define / quote | FRAME | title, narrative, definition, quote | `title` `narrative` `statement` |
| land ONE claim / number / takeaway | ASSERT | headline, stat, KPI row, callout, CTA | `statement` `stat` `metrics` `cta` |
| list N peer items (no flow) | ENUMERATE | list, feature grid, numbered, icon row | `cards` |
| show A→B→C over time/cause | SEQUENCE | pipeline, timeline, cycle, lifecycle, sequence | `diagram-svg` |
| show how parts nest / hierarchy | STRUCTURE | architecture, tree, hub-spoke, pyramid, containment | `diagram-svg` |
| show how factors interrelate | RELATE | network, 2×2, venn, mapping, ER | `diagram-svg` `chart` |
| weigh X against Y | COMPARE | before/after, versus, point/counterpoint, pros/cons, comparison matrix, scorecard | `cards` `table` |
| show what the numbers say | QUANTIFY | bar, line/area, pie, stacked, scatter, data table | `chart` `table` |
| show the real artifact | DEMONSTRATE | code, diff, function I/O, file tree, config, log, terminal, http, chat, trace, thread, Q&A | `code` `terminal` `request` `transcript` `trace` `thread` `cards` |

Disambiguation rules (the cases LLMs get wrong):

- **List vs Sequence:** if removing the arrows loses nothing → ENUMERATE; if
  order/causality is the point → SEQUENCE.
- **Structure vs Relate:** is there a parent/child or contains relationship? →
  STRUCTURE. Are the nodes peers? → RELATE.
- **Compare vs Quantify:** comparing *named options on qualities* → COMPARE
  (`cards`/`table`). Comparing *measured values* → QUANTIFY (`chart`).
- **Compare-table vs 2×2:** discrete criteria in cells → comparison matrix;
  continuous positioning on two axes → quadrant.
- **Diagram vs Code:** is it a *conceptual* relationship (boxes/arrows) →
  `diagram-svg`. Is it the *literal text* of an artifact → `code`.

---

## New primitive specs (proposed JSON shapes)

These keep the existing field idioms (`label`/`sub`/`lines`, reveal-per-element,
the GitHub-dark tokens at `web/styles/template.css`).

### `cards` — Enumerate + Compare + Q&A

```jsonc
{
  "type": "cards",
  "variant": "grid",            // list|grid|numbered|icon-row|before-after|
                                // versus|point-counterpoint|pros-cons|qa|agenda
  "title": "What you get",
  "columns": 3,                 // optional; default chosen from variant + count
  "cards": [
    { "label": "Deterministic", "sub": "same spec → same frames",
      "lines": ["no LLM in render loop"], "style": "primary" }
  ],
  "caption": "optional footer"
}
```

- `before-after` / `versus` / `point-counterpoint` / `pros-cons` force two
  columns with a divider and contrasting accent colours (blue vs purple, reusing
  existing tokens). `qa` renders question header + answer body.
- Reveal: one step per card (reuse the `range(n, prefix)` pattern in
  `web/sceneSteps.mjs`).
- **Supersedes** the legacy ASCII `diagram` two-panel comparison.

### `code` — Demonstrate (text artifacts)

```jsonc
{
  "type": "code",
  "variant": "source",          // source|diff|function-io|tree|config|log
  "title": "src/svg.js",
  "lang": "javascript",
  "code": "export function buildPanel(panel, idx) { … }",
  "highlight": [3, 7],          // lines to emphasise
  "annotations": [ { "line": 7, "text": "auto-size happens here" } ],
  // function-io variant:
  "call": "lookup('en-AU', cache)",
  "returns": "{ voice: 'NatashaNeural', hit: true }"
}
```

- Syntax highlighting can reuse/extend `web/format.js` (`highlightJSON` already
  exists; add a light tokenizer or pull in a tiny highlighter at build time).
- `diff` colours +/− lines (green/red tokens already defined).

### `chart` — Quantify (+ Relate quadrant)

```jsonc
{
  "type": "chart",
  "variant": "bar",             // bar|line|area|pie|stacked-bar|scatter|quadrant
  "title": "p50 latency by service",
  "unit": "ms",
  "series": [
    { "name": "before", "color": "secondary",
      "points": [ { "x": "auth", "y": 120 }, { "x": "api", "y": 90 } ] },
    { "name": "after",  "color": "primary",
      "points": [ { "x": "auth", "y": 40 },  { "x": "api", "y": 35 } ] }
  ],
  "axes": { "x": "service", "y": "ms" }
}
```

- Render as **hand-built SVG** (no Chart.js dependency) so it stays deterministic
  and uses the same viewBox/`preserveAspectRatio` discipline as `diagram-svg`.
  One component switches on `variant`.
- Reveal: per-series (line draws on; bars grow in).

### `table` — Quantify data + Compare matrices

```jsonc
{
  "type": "table",
  "variant": "comparison",      // data|comparison|scorecard
  "title": "Options",
  "columns": ["Criterion", "Manual", "Slidey"],
  "rows": [
    { "cells": ["Reproducible", "no", "yes"], "highlight": 2 },
    { "cells": ["Time to re-cut", "hours", "minutes"] }
  ],
  "winner": 2                   // scorecard: column to crown
}
```

- Reveal: per-row.
- `scorecard` adds a highlighted winning column; `comparison` supports ✓/✗ cell
  glyphs (plain Unicode — headless Chrome has no colour emoji, per the gotcha in
  `template.css` notes).

### `statement` / `metrics` (extensions)

- `statement`: a text-forward primitive for headline/thesis/quote/definition/
  callout — generalises today's `narrative` lede. Could be added as variants on
  `narrative` rather than a new type.
- `metrics`: 2–4 `stat`-style numbers in a row. Could be an array form of `stat`.

---

## Inventory: have / extend / build

**✅ Already covered (9 of 9 families touch existing types):**
`title` `narrative` `stat` `cta` · `diagram-svg` (all of Sequence/Structure/
Relate) · `terminal-gif` `request` `transcript` `trace` `thread` (Demonstrate).

**🔧 Extensions (small, additive):**
- `statement` variants (or extend `narrative`): headline, quote, definition, callout.
- `metrics`: multi-stat row.
- `diagram-svg` spec presets: `timeline`, `cycle`, `pyramid`, `sequence`,
  clusters/subgraphs, venn, ER node style. **Most are example specs + a few CSS
  classes, not new components.**

**🆕 New primitives (the real build, ~5):**
1. `cards` — Enumerate + Compare + Q&A + agenda. (Highest leverage: covers the
   2-column, point/counterpoint, pros/cons, feature-grid, before/after asks.)
2. `code` — code block + diff + function I/O + tree + config + log.
3. `chart` — bar/line/area/pie/stacked/scatter/quadrant.
4. `table` — data + comparison matrix + scorecard.
5. `terminal` — static terminal sibling of `terminal-gif`.

Each follows the documented add-a-scene checklist: `web/components/<Name>Scene.vue`
→ register in `DeckHost.vue` `PITCH_COMPONENTS` → `src/scenes/<name>.js` →
`SCENE_MODULES` in `src/renderer.js` → steps in `web/sceneSteps.mjs` → CSS +
`window.slidey.show<Name>` in the adapter/template → duration branch in
`src/timing.js`.

---

## Suggested build order (by leverage)

1. **`cards`** — unblocks the most explicit requests (2-column, point/counterpoint,
   pros/cons, feature grid, before/after, Q&A, agenda) with one component.
2. **`code`** — the other headline request; `source` + `function-io` first,
   `diff`/`tree`/`log` follow.
3. **`table`** — comparison matrix + data table.
4. **`chart`** — bar + line first (cover ~80% of QUANTIFY), then pie/scatter.
5. **`diagram-svg` presets** — ship `timeline`/`cycle`/`pyramid` as example specs
   in `examples/` + thin CSS; no new component.
6. **`terminal` (static)** and **`statement`/`metrics`** extensions last.

Each primitive should ship with: a `variant` enum (the semantic menu), an entry
in this taxonomy's index table, an `examples/` spec exercising every variant, and
a `--check` rule if it has geometry (charts/tables do).

---

## Sources

- [Microsoft — Choose a SmartArt graphic](https://support.microsoft.com/en-us/office/choose-a-smartart-graphic-e9a7a134-f8a5-4251-aba2-93f96b88644d)
- [Abela chart chooser / data-viz chart types](https://eazybi.com/blog/data-visualization-and-chart-types)
- [Duarte — the ultimate guide to contrast](https://www.duarte.com/blog/ultimate-guide-to-contrast/)
- [Duarte — sparklines for strategic conversations](https://www.duarte.com/blog/creating-moments-of-impact-using-sparklines-for-strategic-conversations/)
- [Mermaid — diagram syntax reference](https://mermaid.js.org/intro/syntax-reference.html)
