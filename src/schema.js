'use strict';

// JSON Schema for a slidey spec.
// Exported for --schema (LLM/tooling) and used by --validate and startup validation.

const LIBRARY_LINK = {
  type: 'object',
  additionalProperties: true,
  properties: {
    label: { type: 'string', description: 'Button text for a navigation link shown in the interactive viewer' },
    title: { type: 'string', description: 'Alternate navigation label' },
    deck: { type: 'string', description: 'Target deck id inside library.decks' },
    deckId: { type: 'string', description: 'Alias for deck' },
    scene: { type: 'string', description: 'Optional target source scene id in the destination deck' },
    sceneId: { type: 'string', description: 'Alias for scene' },
    targetScene: { type: 'string', description: 'Alias for scene' },
    section: { type: 'string', description: 'Optional target section id in the destination deck' },
    sectionId: { type: 'string', description: 'Alias for section' },
  },
};

const LIBRARY_SELECTOR = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ids: { type: 'array', items: { type: 'string' }, description: 'Include scenes with these ids' },
    sceneIds: { type: 'array', items: { type: 'string' }, description: 'Alias for ids' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Include scenes with any of these tags' },
    anyTags: { type: 'array', items: { type: 'string' }, description: 'Alias for tags' },
    allTags: { type: 'array', items: { type: 'string' }, description: 'Require every listed tag' },
    excludeTags: { type: 'array', items: { type: 'string' }, description: 'Omit scenes with any of these tags' },
    sections: { type: 'array', items: { type: 'string' }, description: 'Include scenes in these sections' },
    types: { type: 'array', items: { type: 'string' }, description: 'Include scenes with these scene types' },
    deck: { type: 'string', description: 'Restrict a subset selector to scenes from this deck, within the subset parent scope' },
    decks: { type: 'array', items: { type: 'string' }, description: 'Restrict a subset selector to scenes from these decks, within the subset parent scope' },
    fromDeck: { type: 'string', description: 'Alias for deck in subset selectors' },
  },
};

const LIBRARY_DECK = {
  type: 'object',
  required: ['id'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', description: 'Stable deck id used by --deck, the viewer deck picker, and navigation links' },
    deckType: { type: 'string', enum: ['hierarchy', 'subset'], description: 'hierarchy decks are separate child presentations with local scenes; subset decks are synced views of scenes from their parent deck and descendants' },
    kind: { type: 'string', description: 'Alias for deckType; accepted values include deck/hierarchy and subset/view' },
    title: { type: 'string', description: 'Deck title shown in the picker and applied to meta.title for this view' },
    purpose: { type: 'string', description: 'Purpose label, e.g. executive, workshop, training, sales' },
    theme: { type: 'string', description: 'Theme label used to describe this subset deck' },
    audience: { type: 'string', description: 'Audience label for this subset deck' },
    description: { type: 'string' },
    parent: { type: 'string', description: 'Parent deck id for hierarchical navigation and sidebar nesting' },
    meta: { type: 'object', additionalProperties: true, description: 'Metadata merged into the resolved deck' },
    src: { type: 'string', description: 'Path (relative to the file that declares this deck) to another .slidey.json child-deck file; its top-level scenes[] become this deck\'s local scenes, and its own library.decks[] (if any) become nested children. Lets a directory of decks compose one master + sibling files instead of inlining every child.' },
    file: { type: 'string', description: 'Alias for src' },
    path: { type: 'string', description: 'Alias for src' },
    scenes: {
      type: 'array',
      description: 'For subset decks: synced scene refs by id/index or objects like {fromDeck, ref, overrides}; refs can only target the subset parent deck or descendants. For hierarchy decks: inline scene objects that belong to this child deck.',
      items: {
        oneOf: [
          { type: 'string' },
          { type: 'integer', minimum: 0 },
          {
            type: 'object',
            additionalProperties: true,
            properties: {
              ref: { type: 'string' },
              scene: { type: 'string' },
              id: { type: 'string' },
              fromDeck: { type: 'string', description: 'Origin deck id for a subset scene ref' },
              sourceDeck: { type: 'string', description: 'Alias for fromDeck' },
              select: LIBRARY_SELECTOR,
              overrides: { type: 'object', additionalProperties: true },
            },
          },
        ],
      },
    },
    select: LIBRARY_SELECTOR,
    selector: LIBRARY_SELECTOR,
    exclude: LIBRARY_SELECTOR,
    children: {
      oneOf: [
        { type: 'array', items: { type: 'object', additionalProperties: true } },
        { type: 'object', additionalProperties: { type: 'object', additionalProperties: true } },
      ],
      description: 'Nested hierarchy child decks and scoped subset views; children inherit this deck as parent unless parent is set explicitly',
    },
  },
};

const COMMON = {
  _comment: { type: 'string', description: 'Optional human comment; ignored by the renderer' },
  id: { type: 'string', description: 'Stable scene id for library subset decks and hierarchical navigation links' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Scene tags used by library deck selectors' },
  section: { type: 'string', description: 'Section id used by collection navigation and subset selectors' },
  sections: { type: 'array', items: { type: 'string' }, description: 'Additional section ids represented by this scene; useful when one parent slide links to multiple child decks' },
  purpose: { type: 'string', description: 'Scene-level purpose tag used by subset deck selectors' },
  theme: { type: 'string', description: 'Scene-level theme tag used by subset deck selectors' },
  links: { type: 'array', items: LIBRARY_LINK, description: 'Interactive navigation links to other decks or sections in the same library' },
  nav: {
    oneOf: [
      { type: 'array', items: LIBRARY_LINK },
      {
        type: 'object',
        additionalProperties: true,
        properties: {
          links: { type: 'array', items: LIBRARY_LINK },
        },
      },
    ],
    description: 'Alternate navigation-link container for hierarchical deck navigation',
  },
  narration: { type: 'string', description: 'Text spoken by Edge TTS in the live viewer / VS Code preview and synthesized into MP4 exports' },
  hold: { type: 'integer', minimum: 0, description: 'Extra frames to hold after the last reveal step' },
  instant: { type: 'boolean', description: 'Reveal the whole scene at once (no progressive build / no title-only first page) — one PDF page / nav advance for the scene' },
  seamless: { type: 'boolean', description: 'Keep diagram continuity across adjacent scenes when supported by the renderer' },
  continues: { type: 'boolean', description: 'Cut straight into this scene from the previous one: the preceding inter-scene gap is skipped and this scene’s reveals apply instantly (all content on the first frame / one nav step). Designed for consecutive graph scenes sharing a projection, so the graph never leaves the screen between titles.' },
  skipTitle: { type: 'boolean', description: 'Suppress repeated scene title chrome when supported by the renderer' },
};

const REFERENCE = {
  type: 'object',
  additionalProperties: true,
  description: 'Workspace file or media reference opened in the interactive viewer overlay. Markdown, source files, diffs, JSON/text, images, and videos are handled by built-in viewers; plugins can key off `kind`.',
  properties: {
    src: { type: 'string', description: 'Path or URL to inspect. Relative paths resolve against the slidey spec.' },
    path: { type: 'string', description: 'Alias for src, for tool-generated specs.' },
    href: { type: 'string', description: 'Alias for src, for externally generated refs.' },
    label: { type: 'string', description: 'Short label shown in the reference chip and modal title.' },
    kind: { type: 'string', description: 'Optional media kind override such as markdown, code, diff, json, text, image, video, html, mermaid, graph, or file. "html" opens the file in a sandboxed iframe (a rendered page/demo/mockup, not source view).' },
    lang: { type: 'string', description: 'Optional language tag for code/text rendering.' },
    lines: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      minItems: 1,
      maxItems: 2,
      description: 'Optional 1-based line range preview/highlight, e.g. [12, 24].',
    },
    lineStart: { type: 'integer', minimum: 1, description: 'Optional first 1-based line to preview/highlight.' },
    lineEnd: { type: 'integer', minimum: 1, description: 'Optional last 1-based line to preview/highlight.' },
    section: { type: 'string', description: 'Optional Markdown heading text to preview on-slide.' },
    heading: { type: 'string', description: 'Alias for section.' },
  },
};

COMMON.references = {
  oneOf: [
    REFERENCE,
    { type: 'string' },
    {
      type: 'array',
      items: {
        oneOf: [REFERENCE, { type: 'string' }],
      },
    },
  ],
  description: 'Files or media linked to this scene for inline inspection in the web viewer. '
    + 'Any `*Html` companion field (bodyHtml, ledeHtml, labelHtml, subHtml, introHtml, outroHtml, '
    + 'linesHtml, subtitleHtml, ...) may additionally embed inline `<a data-slidey-ref="target">label</a>` '
    + 'links — written as Markdown `[label](target)` when authoring/converting from Markdown, or by hand. '
    + 'Clicking one in the web viewer opens `target` in whichever modal already owns that kind: '
    + '"deck:<id>" or "deck:<id>#<sceneId>" switches to another library deck/scene; a target ending in '
    + '".rrweb.json" opens the rrweb replay modal; anything else opens the reference viewer modal with its '
    + 'kind inferred the same way references[] entries are (image, video, markdown, code, json, diff, text, '
    + 'or html — html targets render in a sandboxed iframe). Static PNG/PDF/MP4 exports never intercept the '
    + 'click, so the link renders as plain visible chrome (an underline plus a small ↗ marker); set '
    + 'meta.linkMarkers:false to hide that marker deck-wide.',
};

const CARDS_ITEM = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    labelHtml: { type: 'string', description: 'Sanitized inline HTML for imported Markdown emphasis' },
    sub: { type: 'string', description: 'Secondary line under the label' },
    subHtml: { type: 'string', description: 'Sanitized inline HTML for imported Markdown emphasis' },
    lines: { type: 'array', items: { type: 'string' }, description: 'Bullet lines' },
    linesHtml: { type: 'array', items: { type: 'string' }, description: 'Sanitized inline HTML for imported Markdown bullet lines' },
    icon: { type: 'string', description: 'Icon prefix (icon-row variant)' },
    style: { type: 'string', enum: ['primary', 'secondary', 'default'], description: 'Accent tint' },
    deck: { type: 'string', description: 'Make this card clickable and navigate to this library deck id' },
    deckId: { type: 'string', description: 'Alias for deck' },
    targetDeck: { type: 'string', description: 'Alias for deck' },
    scene: { type: 'string', description: 'Optional destination scene id' },
    sceneId: { type: 'string', description: 'Alias for scene' },
    targetScene: { type: 'string', description: 'Alias for scene' },
    section: { type: 'string', description: 'Optional destination section id' },
    sectionId: { type: 'string', description: 'Alias for section' },
    link: LIBRARY_LINK,
  },
};

const OBJECTIVE_ITEM = {
  type: 'object',
  required: ['label', 'status', 'detail'],
  properties: {
    label: { type: 'string', description: 'Objective area or milestone label' },
    status: {
      type: 'string',
      enum: ['done', 'issue', 'blocked', 'next', 'progress', 'pending', 'skipped'],
      description: 'Visual status. done renders a large green checkmark; issue/blocked render a large red exclamation mark.',
    },
    detail: { type: 'string', description: 'Concrete evidence, blocker, or next condition' },
  },
};

const EVIDENCE_ITEM = {
  type: 'object',
  required: ['label', 'status', 'detail'],
  properties: {
    label: { type: 'string', description: 'Evidence target, check name, or artifact surface' },
    status: {
      type: 'string',
      enum: ['done', 'validated', 'implemented', 'issue', 'blocked', 'next', 'progress', 'pending', 'skipped'],
      description: 'Visual status. validated/implemented/done render a green checkmark; issue/blocked render a red exclamation mark.',
    },
    detail: { type: 'string', description: 'Short evidence summary, result, or reason this item matters' },
    refType: {
      type: 'string',
      enum: ['command', 'artifact', 'path', 'log', 'doc', 'test'],
      description: 'Label for the monospace reference chip',
    },
    ref: { type: 'string', description: 'Command, file path, log path, or artifact reference shown as a monospace chip' },
    note: { type: 'string', description: 'Small right-aligned qualifier, such as no-LLM or opt-in' },
  },
};

const MCP_CALL = {
  type: 'object',
  required: ['tool'],
  properties: {
    tool: { type: 'string', description: 'MCP tool name, e.g. session.new' },
    args: { type: 'string', description: 'Compact argument preview' },
    result: { type: 'string', description: 'Compact result preview' },
    status: { type: 'string', enum: ['ok', 'warn', 'issue', 'fail'], description: 'Visual status chip' },
  },
};

const MCP_OUTCOME = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Large outcome label' },
    ref: { type: 'string', description: 'Artifact, issue, or trace reference' },
    lines: { type: 'array', items: { type: 'string' }, description: 'Short outcome bullets' },
  },
};

const NODE = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Unique node identifier referenced by edges' },
    label: { type: 'string' },
    sub: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
    x: { type: 'number', description: 'Left edge in SVG user units' },
    y: { type: 'number', description: 'Top edge in SVG user units' },
    w: { type: 'number', description: 'Width in SVG user units' },
    h: { type: 'number', description: 'Height in SVG user units' },
    slot: { type: 'string', enum: ['top', 'right', 'bottom', 'left', 'top-right', 'bottom-right', 'bottom-left', 'top-left'], description: 'Position around a diagram-svg panel with layout:"cycle"' },
    cycle: { type: 'boolean', description: 'Set false to exclude this node from layout:"cycle" placement' },
    style: { type: 'string', enum: ['primary', 'secondary'], description: 'Node colour accent' },
    deck: { type: 'string', description: 'Make this diagram node clickable and navigate to this library deck id' },
    deckId: { type: 'string', description: 'Alias for deck' },
    targetDeck: { type: 'string', description: 'Alias for deck' },
    scene: { type: 'string', description: 'Optional destination scene id' },
    sceneId: { type: 'string', description: 'Alias for scene' },
    targetScene: { type: 'string', description: 'Alias for scene' },
    section: { type: 'string', description: 'Optional destination section id' },
    sectionId: { type: 'string', description: 'Alias for section' },
    link: LIBRARY_LINK,
  },
};

const EDGE = {
  type: 'object',
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', description: 'Source node id' },
    to: { type: 'string', description: 'Target node id' },
    label: { type: 'string' },
    labelX: { type: 'number', description: 'Optional absolute SVG x coordinate for the edge label' },
    labelY: { type: 'number', description: 'Optional absolute SVG y coordinate for the edge label' },
    labelAnchor: { type: 'string', enum: ['start', 'middle', 'end'], description: 'Optional SVG text-anchor for the edge label' },
    gate: { type: 'string', description: 'Dashed-line checkpoint condition label' },
    side: { type: 'string', enum: ['left', 'right'], description: 'Parallel arrow side' },
    style: { type: 'string', description: 'Renderer-specific edge routing/style hint such as "back" or "recycle"' },
    elbow: { type: ['boolean', 'string'], description: 'Route the edge with right-angle elbows; use "H" or "V" to force the first segment orientation' },
    arch: { type: 'number', description: 'SVG y coordinate for an arch-style routed edge' },
    bus: { type: 'number', description: 'SVG coordinate for routed/back-edge bus lines; near-outside lanes are padded to a clear gutter' },
    lift: { type: 'number', description: 'SVG routing offset for edge departure' },
    land: { type: 'number', description: 'SVG routing offset for edge arrival' },
    highlighted: { type: 'boolean', description: 'Accent this edge in the rendered diagram' },
    agent: { type: 'boolean', description: 'Mark this gate/edge as agent-mediated rather than deterministic' },
  },
};

const GRAPH_NODE = {
  type: 'object',
  required: ['id'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', description: 'Unique node identifier referenced by graph edges and focus path entries' },
    label: { type: 'string', description: 'Primary text shown inside the Cytoscape node' },
    sub: { type: 'string', description: 'Secondary line shown under the node label and in the focus card' },
    kind: { type: 'string', description: 'Semantic node type such as requirement, dependency, environment, application, substrate, or proof' },
    weight: { type: 'number', description: 'Relative importance used by layouts and emphasis' },
    color: { type: 'string', description: 'CSS color for the node fill' },
    textColor: { type: 'string', description: 'CSS color for the node label' },
    w: { type: 'number', description: 'Node width in Cytoscape layout units' },
    h: { type: 'number', description: 'Node height in Cytoscape layout units' },
    width: { type: 'number', description: 'Alias for w' },
    height: { type: 'number', description: 'Alias for h' },
    x: { type: 'number', description: 'Pinned x coordinate for layout:"preset"' },
    y: { type: 'number', description: 'Pinned y coordinate for layout:"preset"' },
    col: { type: 'number', description: 'One-indexed graph template column' },
    column: { type: 'number', description: 'Alias for col' },
    gridColumn: { type: 'number', description: 'Alias for col' },
    row: { type: 'number', description: 'One-indexed graph template row or lane' },
    lane: { type: 'number', description: 'Alias for row' },
    gridRow: { type: 'number', description: 'Alias for row' },
    xOffset: { type: 'number', description: 'Template-position x nudge in graph layout units' },
    yOffset: { type: 'number', description: 'Template-position y nudge in graph layout units' },
    dx: { type: 'number', description: 'Alias for xOffset' },
    dy: { type: 'number', description: 'Alias for yOffset' },
    grid: {
      type: 'object',
      description: 'Per-node graph-template slot and optional nudges',
      properties: {
        col: { type: 'number' },
        column: { type: 'number' },
        row: { type: 'number' },
        lane: { type: 'number' },
        xOffset: { type: 'number' },
        yOffset: { type: 'number' },
        dx: { type: 'number' },
        dy: { type: 'number' },
      },
    },
    position: {
      type: 'object',
      description: 'Pinned Cytoscape position for layout:"preset"',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
    classes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Extra Cytoscape classes' },
    className: { type: 'string', description: 'Extra Cytoscape class string' },
  },
};

const GRAPH_EDGE = {
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', description: 'Stable edge id, useful for focus-path edge highlighting' },
    from: { type: 'string', description: 'Source node id' },
    to: { type: 'string', description: 'Target node id' },
    label: { type: 'string', description: 'Text shown along the edge' },
    weight: { type: 'number', description: 'Line thickness / influence weight' },
    influence: { type: 'number', description: 'Alias for weight' },
    color: { type: 'string', description: 'CSS line and arrow color' },
    curve: { type: 'string', enum: ['bezier', 'unbundled-bezier', 'haystack', 'segments', 'taxi', 'straight'], description: 'Cytoscape curve-style for this edge' },
    labelMarginX: { type: 'number', description: 'Horizontal offset for the Cytoscape edge label' },
    labelMarginY: { type: 'number', description: 'Vertical offset for the Cytoscape edge label' },
    labelX: { type: 'number', description: 'Alias for labelMarginX' },
    labelY: { type: 'number', description: 'Alias for labelMarginY' },
    kind: { type: 'string', description: 'Semantic edge type' },
    classes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Extra Cytoscape classes' },
    className: { type: 'string', description: 'Extra Cytoscape class string' },
  },
};

const GRAPH_FOCUS = {
  oneOf: [
    { type: 'string', description: 'Node id to center on this reveal' },
    {
      type: 'object',
      required: ['node'],
      additionalProperties: true,
      properties: {
        node: { type: 'string', description: 'Node id to center on this reveal' },
        note: { type: 'string', description: 'Focus-card explanation for this navigation step' },
        edge: { type: 'string', description: 'Edge id to highlight on this step' },
        edges: { type: 'array', items: { type: 'string' }, description: 'Edge ids to highlight on this step' },
        zoom: { type: 'number', exclusiveMinimum: 0, description: 'Camera zoom for this focus step' },
        view: { type: 'string', enum: ['overview'], description: 'Use overview to fit the whole graph on this focus step' },
        overview: { type: 'boolean', description: 'Fit the whole graph on this focus step' },
        fit: { type: 'boolean', description: 'Alias for overview' },
        padding: { type: 'number', minimum: 0, description: 'Camera padding for overview or neighborhood focus steps' },
        durationMs: { type: 'integer', minimum: 0, description: 'Camera animation duration for this focus step' },
      },
    },
  ],
};

const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Slidey Spec',
  description: 'Declarative video spec — a JSON document describing an ordered list of scenes that the slidey pipeline renders into a narrated MP4.',
  type: 'object',
  required: ['scenes'],
  properties: {
    _comment: { type: 'string', description: 'Optional human comment; ignored by the renderer' },
    meta: {
      type: 'object',
      description: 'Video-level metadata and global defaults',
      properties: {
        title: { type: 'string', description: 'Video title' },
        resolution: {
          type: 'object',
          description: 'Output resolution (default 1920×1080)',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 },
          },
        },
        narration: {
          type: 'object',
          description: 'Default narration voice settings applied to all scenes',
          additionalProperties: false,
          properties: {
            voice: { type: 'string', description: 'Edge TTS voice name, e.g. "en-AU-NatashaNeural"' },
            rate: { type: 'string', description: 'Speech rate offset, e.g. "+0%" or "+10%"' },
            pronunciations: {
              type: 'object',
              description: 'Map of term → phonetic respelling, applied whole-word and case-insensitively to the SPOKEN narration only (the text shown in specs/--list is unchanged). Fixes TTS mispronunciations of brand names, acronyms, and jargon. Use lower-case pronounceable syllables for words; use spaced capitals only for acronyms you want spelled out. Avoid uncommon tokens like "soh" that some voices spell out. e.g. { "Anthropic": "an throp ik", "SDLC": "S D L C", "kitsoki": "kit so key" }',
              additionalProperties: { type: 'string' },
            },
          },
        },
        context: {
          type: 'object',
          description: 'Template variable values; referenced in scenes as {{varName}} (Postman-compatible)',
          additionalProperties: { type: 'string' },
        },
        locale: {
          type: 'string',
          description: 'Source locale tag for this canonical deck, e.g. "en". Resolved localized decks set this to the selected locale.',
        },
        locales: {
          type: 'object',
          description: 'Deterministic locale overlays available for this deck. Keys are locale tags; values are overlay paths or { label, path } objects resolved relative to the spec.',
          additionalProperties: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string', description: 'Human label for the locale, e.g. "Thai".' },
                  path: { type: 'string', description: 'Locale overlay JSON path, relative to the deck spec.' },
                  file: { type: 'string', description: 'Alias for path.' },
                  src: { type: 'string', description: 'Alias for path.' },
                },
              },
            ],
          },
        },
        personas: {
          type: 'array',
          description: 'Deck-wide cast registry for "personas" scenes; each persona is resolved by id so the same stylized avatar recurs across cast and use-case scenes',
          items: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', description: 'Stable id referenced by personas-scene `personas`/`cases[].who`' },
              name: { type: 'string', description: 'Display name' },
              role: { type: 'string', description: 'Role label (small caps under the name)' },
              intro: { type: 'string', description: 'One-line introduction shown on the cast card' },
              color: { type: 'string', description: 'Accent hex tinting the avatar ring and name, e.g. "#58a6ff"' },
              glyph: { type: 'string', description: 'Emoji or 1–2 initials shown in the avatar chip (defaults to name initials)' },
              avatar: { type: 'string', description: 'Optional image avatar (URL or data-URI, e.g. a logo SVG) shown in the chip instead of the glyph' },
            },
          },
        },
        mode: {
          type: 'string',
          enum: ['api', 'pitch'],
          description: '"api" enables request scenes with live/mock/playback HTTP; "pitch" is default slides mode',
        },
        linkMarkers: {
          type: 'boolean',
          default: true,
          description: 'Show a small reference-marker glyph after inline `[text](target)` / `<a data-slidey-ref>` links (see COMMON.references). Applies in the web viewer and in exported PNG/PDF/MP4 renders alike, since only the web viewer can actually open the target on click. Set false to hide the glyph deck-wide.',
        },
        theme: {
          oneOf: [
            { type: 'string', description: 'Built-in theme name, e.g. "rose-pine-moon"' },
            {
              type: 'object',
              description: 'Presentation theme override: built-in name plus optional colors, background, and CSS',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: 'Built-in theme name to extend, e.g. "rose-pine-moon"' },
                background: { type: 'string', description: 'CSS background value for the root deck surface' },
                fontFamily: { type: 'string', description: 'CSS font-family value for the root deck surface' },
                colors: {
                  type: 'object',
                  description: 'Named color tokens exposed as --slidey-<token>',
                  additionalProperties: { type: 'string' },
                },
                css: { type: 'string', description: 'Raw CSS appended after Slidey styles for advanced deck theming' },
              },
            },
          ],
          description: 'Optional deck theme; imported Marp themes are preserved here when supported',
        },
        themePacks: {
          type: 'array',
          description: 'Reusable Slidey pack references. String entries resolve to JSON files relative to the spec; inline objects can define themes and layouts directly.',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  themes: { type: 'object', additionalProperties: true },
                  layouts: { type: 'array', items: { type: 'object', additionalProperties: true } },
                },
              },
            ],
          },
        },
      },
    },
    library: {
      type: 'object',
      additionalProperties: true,
      description: 'Collection metadata. Source scenes remain in scenes[] for the root deck and synced subset views; hierarchy decks are separate child presentations with local scenes.',
      properties: {
        title: { type: 'string', description: 'Collection/library title' },
        sourceTitle: { type: 'string', description: 'Label for the full source deck in the viewer picker' },
        defaultDeck: { type: 'string', description: 'Default library deck id when no --deck/query deck is provided' },
        activeDeck: { type: 'string', description: 'Alias for defaultDeck' },
        meta: { type: 'object', additionalProperties: true, description: 'Metadata merged into every resolved child deck' },
        decks: {
          oneOf: [
            { type: 'array', items: LIBRARY_DECK },
            { type: 'object', additionalProperties: { type: 'object', additionalProperties: true } },
          ],
          description: 'Named collection decks. Use deckType "hierarchy" with inline scenes for child presentations, or deckType "subset" with scenes/select for synced source views.',
        },
        sections: {
          oneOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                required: ['id'],
                additionalProperties: true,
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  deck: { type: 'string', description: 'Deck opened from source scenes with this section id' },
                  parent: { type: 'string', description: 'Parent section id' },
                  cta: { type: 'string', description: 'Link label shown on matching summary scenes' },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  title: { type: 'string' },
                  deck: { type: 'string' },
                  parent: { type: 'string' },
                  cta: { type: 'string' },
                },
              },
            },
          ],
          description: 'Section map for automatic hierarchical navigation links.',
        },
      },
    },
    scenes: {
      type: 'array',
      minItems: 1,
      description: 'Ordered list of scenes to render (at least one required)',
      items: {
        type: 'object',
        required: ['type'],
        discriminator: { propertyName: 'type' },
        oneOf: [
          // ── title ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Full-screen opening card. Fixed 3-second hold.',
            properties: {
              type: { const: 'title' },
              title: { type: 'string', description: 'Main heading' },
              subtitle: { type: 'string', description: 'Secondary heading below the title' },
              subtitleHtml: { type: 'string', description: 'Sanitized inline HTML for imported Markdown subtitle emphasis' },
              eyebrow: { type: 'string', description: 'Small label displayed above the title' },
              theme: { type: 'string', enum: ['markdown'], description: 'Optional presentation typography theme for imported Markdown decks' },
              ...COMMON,
            },
          },
          // ── narrative ──────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Prose slide with an eyebrow, body paragraph, and lede highlight.',
            properties: {
              type: { const: 'narrative' },
              eyebrow: { type: 'string', description: 'Category label at the top' },
              body: { type: 'string', description: 'Main prose paragraph' },
              bodyHtml: { type: 'string', description: 'Sanitized inline HTML companion for body — emphasis/code plus `<a data-slidey-ref="target">` links (see COMMON.references). Set by `slidey convert` from Markdown; renders in place of body when present.' },
              lede: { type: 'string', description: 'Highlighted pull-quote / summary line' },
              ledeHtml: { type: 'string', description: 'Sanitized inline HTML companion for lede, same convention as bodyHtml.' },
              ...COMMON,
            },
          },
          // ── diagram ────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'panels'],
            description: 'Legacy ASCII/text panel diagram. Prefer diagram-svg for new specs.',
            properties: {
              type: { const: 'diagram' },
              title: { type: 'string' },
              panels: { type: 'array', minItems: 1, items: { type: 'object' } },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── diagram-svg ────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'panels'],
            description: 'SVG diagram with positioned nodes and edges. Use --check to validate geometry.',
            properties: {
              type: { const: 'diagram-svg' },
              title: { type: 'string' },
              panels: {
                type: 'array',
                minItems: 1,
                description: 'One or more diagram panels (side-by-side when multiple)',
                items: {
                  type: 'object',
                  required: ['nodes'],
                  properties: {
                    label: { type: 'string', description: 'Panel heading' },
                    caption: { type: 'string', description: 'Panel-local caption' },
                    viewBox: { type: 'string', description: 'SVG viewBox, e.g. "0 0 800 600"' },
                    auto_layout: { type: 'boolean', description: 'Force auto-layout even if nodes contain explicit x/y' },
                    rankdir: { type: 'string', enum: ['TB', 'BT', 'LR', 'RL'], description: 'Dagre rank direction when auto-layout is used (TB: top-bottom, LR: left-right, etc.)', default: 'TB' },
                    ranksep: { type: 'number', minimum: 0, description: 'Dagre rank separation (vertical/horizontal spacing between levels) used by auto-layout.' , default: 100 },
                    nodesep: { type: 'number', minimum: 0, description: 'Dagre node separation used by auto-layout.' , default: 80 },
                    marginx: { type: 'number', minimum: 0, description: 'X-margin around auto-layout graph in user units.', default: 50 },
                    marginy: { type: 'number', minimum: 0, description: 'Y-margin around auto-layout graph in user units.', default: 50 },
                    overlap_gap: { type: 'number', minimum: 0, description: 'Extra pixel gap used by the overlap-repair pass.' , default: 24 },
                    overlap_iterations: { type: 'integer', minimum: 0, maximum: 24, description: 'How many overlap-repair passes to run after dagre layout.', default: 12 },
                    resolve_overlaps: { type: 'boolean', description: 'Run the iterative overlap repair pass after dagre (set false to keep raw dagre positions).' },
                    layout: { type: 'string', enum: ['cycle'], description: 'Optional panel layout template; cycle places nodes around an ellipse with a single background recycle arrow' },
                    cycle: {
                      type: 'object',
                      description: 'Options for layout:"cycle"',
                      properties: {
                        center: {
                          type: 'object',
                          properties: {
                            x: { type: 'number' },
                            y: { type: 'number' },
                          },
                        },
                        rx: { type: 'number', description: 'Horizontal radius of the cycle arrow and node slots' },
                        ry: { type: 'number', description: 'Vertical radius of the cycle arrow and node slots' },
                        arrowRx: { type: 'number', description: 'Optional horizontal radius for the background cycle arrow; defaults outside the node slots' },
                        arrowRy: { type: 'number', description: 'Optional vertical radius for the background cycle arrow; defaults outside the node slots' },
                        variant: { type: 'string', enum: ['recycle', 'recycle-logo'], description: 'Use a recycle treatment behind cycle nodes; recycle-logo draws a large watermark symbol' },
                        glyph: { type: 'string', description: 'Optional symbol for variant:"recycle-logo"' },
                        glyphX: { type: 'number', description: 'Optional x coordinate for variant:"recycle-logo"' },
                        glyphY: { type: 'number', description: 'Optional y coordinate for variant:"recycle-logo"' },
                        glyphSize: { type: 'number', description: 'Optional font size for variant:"recycle-logo"' },
                        startAngle: { type: 'number', description: 'Cycle arrow start angle in degrees; 0 is right, 90 is down' },
                        endAngle: { type: 'number', description: 'Cycle arrow end angle in degrees; 0 is right, 90 is down' },
                        label: { type: 'string', description: 'Optional label drawn inside the cycle arrow' },
                        labelX: { type: 'number' },
                        labelY: { type: 'number' },
                        arrow: { type: 'boolean', description: 'Set false to suppress the background cycle arrow' },
                      },
                    },
                    nodes: {
                      type: 'array',
                      items: NODE,
                      description: 'Diagram nodes; x/y/w/h are SVG user units',
                    },
                    edges: {
                      type: 'array',
                      items: EDGE,
                      description: 'Connections between nodes, referenced by id',
                    },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── graph ─────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Graph viewer. Default input mode is nodes/edges (Cytoscape.js; reveals can navigate a path by centering one node at a time). Set `projection` + `state` instead to render a graph-projection v1 JSON through the shared graph-projection renderer (rounded-rect nodes on a lane/row grid, per-state status overlays) — see ~/code/POG/.context/mockup-demo-tooling-contract.md #7.',
            properties: {
              type: { const: 'graph' },
              title: { type: 'string' },
              projection: { type: 'string', description: 'Path (relative to the spec) to a graph-projection v1 JSON. When set, this scene renders that projection instead of nodes/edges/layout below; `state` selects which projection state to show.' },
              state: { type: 'string', description: 'A key of the projection\'s `states` map (or a bare graph id), selecting which projection state/graph to render. Required (and only meaningful) when `projection` is set.' },
              layout: {
                type: 'string',
                enum: ['preset', 'cose', 'breadthfirst', 'circle', 'concentric', 'grid', 'random'],
                description: 'Initial Cytoscape layout. Use preset with node x/y or position for hand-tuned investor diagrams.',
              },
              layoutTemplate: {
                type: 'string',
                enum: ['lane-grid', 'lane-grid-3x5', 'grid-3x5'],
                description: 'Reusable deterministic graph layout template. Use lane-grid with node row/col slots for investor-style evidence flows.',
              },
              template: {
                type: 'string',
                enum: ['lane-grid', 'lane-grid-3x5', 'grid-3x5'],
                description: 'Alias for layoutTemplate',
              },
              grid: {
                type: 'object',
                description: 'Grid geometry for layoutTemplate:"lane-grid". Nodes use one-indexed row/col slots.',
                properties: {
                  columns: { type: 'number', minimum: 1 },
                  cols: { type: 'number', minimum: 1 },
                  rows: { type: 'number', minimum: 1 },
                  lanes: { type: 'number', minimum: 1 },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  left: { type: 'number' },
                  top: { type: 'number' },
                  width: { type: 'number', exclusiveMinimum: 0 },
                  w: { type: 'number', exclusiveMinimum: 0 },
                  height: { type: 'number', exclusiveMinimum: 0 },
                  h: { type: 'number', exclusiveMinimum: 0 },
                },
              },
              focusLayout: {
                type: 'string',
                enum: ['preset', 'cose', 'breadthfirst', 'circle', 'concentric', 'grid', 'random'],
                description: 'Optional layout to rerun while navigating focus steps; omit to keep the initial layout and animate camera movement.',
              },
              nodes: { type: 'array', minItems: 1, items: GRAPH_NODE, description: 'Graph nodes rendered by Cytoscape' },
              edges: { type: 'array', items: GRAPH_EDGE, description: 'Directed graph edges rendered by Cytoscape' },
              path: { type: 'array', items: GRAPH_FOCUS, description: 'Per-reveal navigation path; each item centers a node and can add explanatory focus text' },
              focus: { type: 'array', items: GRAPH_FOCUS, description: 'Alias for path' },
              roots: { type: 'array', items: { type: 'string' }, description: 'Root node ids for breadthfirst layout' },
              directed: { type: 'boolean', description: 'Treat edges as directed in layouts that support it; default true' },
              padding: { type: 'number', minimum: 0, description: 'Viewport padding when fitting the graph' },
              spacingFactor: { type: 'number', exclusiveMinimum: 0, description: 'Cytoscape breadthfirst spacing factor' },
              idealEdgeLength: { type: 'number', exclusiveMinimum: 0, description: 'Cytoscape cose ideal edge length' },
              nodeOverlap: { type: 'number', minimum: 0, description: 'Cytoscape cose node overlap value' },
              gravity: { type: 'number', minimum: 0, description: 'Cytoscape cose gravity value' },
              componentSpacing: { type: 'number', minimum: 0, description: 'Cytoscape cose spacing between disconnected components' },
              nestingFactor: { type: 'number', minimum: 0, description: 'Cytoscape cose nesting factor' },
              numIter: { type: 'integer', minimum: 1, description: 'Cytoscape cose iteration count' },
              layoutWidth: { type: 'number', exclusiveMinimum: 0, description: 'Cytoscape force-layout bounding-box width' },
              layoutHeight: { type: 'number', exclusiveMinimum: 0, description: 'Cytoscape force-layout bounding-box height' },
              minNodeSpacing: { type: 'number', minimum: 0, description: 'Cytoscape concentric minimum node spacing' },
              randomize: { type: 'boolean', description: 'Allow randomized cose layout starts; default false for deterministic render output' },
              floatMotion: { type: 'boolean', description: 'Add subtle idle node motion in the live viewer; disabled by instant/export mode' },
              idleMotion: { type: 'boolean', description: 'Alias for floatMotion' },
              floatAmplitude: { type: 'number', minimum: 0, description: 'Pixel amplitude for live idle node motion' },
              floatSpeed: { type: 'number', minimum: 0, description: 'Speed multiplier for live idle node motion' },
              focusZoom: { type: 'number', exclusiveMinimum: 0, description: 'Default camera zoom for focus-path reveals' },
              focusMode: { type: 'string', enum: ['center', 'neighborhood'], description: 'Camera mode for focus reveals. center pans/zooms to the active node; neighborhood fits the active node and adjacent edges.' },
              focusPadding: { type: 'number', minimum: 0, description: 'Viewport padding used by focusMode:"neighborhood"' },
              animationMs: { type: 'integer', minimum: 0, description: 'Default Cytoscape camera/layout animation duration' },
              nodeFontSize: { type: 'number', minimum: 1, description: 'Node label font size in pixels' },
              edgeFontSize: { type: 'number', minimum: 1, description: 'Edge label font size in pixels' },
              interactive: { type: 'boolean', description: 'Enable mouse pan/zoom in the live viewer; exports remain deterministic' },
              caption: { type: 'string' },
              narrateCaption: { type: 'boolean', description: 'Set false to reveal the graph caption visually without using it as narration fallback.' },
              captionNarration: { type: 'boolean', description: 'Alias for narrateCaption.' },
              ...COMMON,
            },
          },
          // ── mermaid ───────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'source'],
            description: 'Mermaid diagram source rendered directly in the Slidey viewer with the active deck theme.',
            properties: {
              type: { const: 'mermaid' },
              title: { type: 'string' },
              source: { type: 'string', description: 'Mermaid diagram text, e.g. flowchart, sequenceDiagram, stateDiagram-v2' },
              sourceFile: { type: 'string', description: 'Optional path to the checked-in Mermaid source copied into source during bundling/import workflows' },
              scale: { type: 'number', minimum: 0.1, description: 'Visual scale factor for dense imported diagrams; default 1' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── trace ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'turns'],
            description: 'Multi-layer lookup cascade, one turn per row.',
            properties: {
              type: { const: 'trace' },
              title: { type: 'string' },
              turns: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['user'],
                  properties: {
                    user: { type: 'string', description: 'User input text' },
                    layers: { type: 'array', items: { type: 'object' } },
                    intent: { type: 'string' },
                    no_llm: { type: 'boolean' },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── transcript ─────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'cards'],
            description: 'Session transcript as per-turn boxed cards.',
            properties: {
              type: { const: 'transcript' },
              app: { type: 'string', description: 'Application name shown in the header' },
              session: { type: 'string', description: 'Session identifier' },
              cards: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    turn: { type: 'integer' },
                    room: { type: 'string' },
                    user: { type: 'string' },
                    flow: { type: 'array', items: { type: 'string' } },
                    effects: { type: 'array' },
                    progress: { type: 'object' },
                  },
                },
              },
              cardHold: { type: 'integer', minimum: 0, description: 'Extra hold frames per card' },
              totals: { type: 'object' },
              ...COMMON,
            },
          },
          // ── thread ─────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'panels'],
            description: 'Mocked issue-tracker or review thread (Jira, Bitbucket, GitHub).',
            properties: {
              type: { const: 'thread' },
              title: { type: 'string' },
              panels: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    system: {
                      type: 'string',
                      enum: ['jira', 'bitbucket', 'github'],
                      description: 'Tracker UI to mimic',
                    },
                    ref: { type: 'string', description: 'Issue or PR reference, e.g. "PROJ-42"' },
                    stage: { type: 'string', description: 'Review stage label' },
                    messages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          author: { type: 'string' },
                          role: { type: 'string' },
                          body: { type: 'string' },
                          type: { type: 'string' },
                          ts: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── stat ───────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Giant-number impact slide.',
            properties: {
              type: { const: 'stat' },
              value: { type: 'string', description: 'Large display number/text, e.g. "3×"' },
              label: { type: 'string', description: 'Descriptor line below the value' },
              detail: { type: 'string', description: 'Small footnote below the label' },
              ...COMMON,
            },
          },
          // ── cta ────────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Call-to-action end card.',
            properties: {
              type: { const: 'cta' },
              wordmark: { type: 'string', description: 'Brand name displayed large' },
              tagline: { type: 'string', description: 'Short brand/product tagline' },
              url: { type: 'string', description: 'URL shown below the tagline' },
              ...COMMON,
            },
          },
          // ── terminal-gif ───────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'gif'],
            description: 'Animated GIF played inside a terminal chrome window.',
            properties: {
              type: { const: 'terminal-gif' },
              gif: { type: 'string', description: 'Path to the animated GIF file (relative to spec or absolute)' },
              title: { type: 'string', description: 'Terminal window title bar text' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── kitsoki-tui ───────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Static Kitsoki TUI welcome/onboarding screen with Mesa startup chrome and a selectable action menu.',
            properties: {
              type: { const: 'kitsoki-tui' },
              title: { type: 'string', description: 'Terminal window title bar text' },
              appTitle: { type: 'string', description: 'Welcome banner title, e.g. "kitsoki · project onboarding"' },
              subtitle: { type: 'string', description: 'Welcome banner subtitle/version line' },
              hints: {
                type: 'array',
                maxItems: 5,
                items: { type: 'string' },
                description: 'Command hint lines shown in the welcome block.',
              },
              status: { type: 'string', description: 'Session/state footer line' },
              choicePrompt: { type: 'string', description: 'Menu prompt shown above the selectable rows.' },
              menuItems: {
                type: 'array',
                maxItems: 6,
                items: {
                  oneOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      required: ['label'],
                      properties: {
                        label: { type: 'string' },
                        hint: { type: 'string' },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
                description: 'Selectable menu rows. The active row is marked with a caret.',
              },
              selectedIndex: { type: 'integer', minimum: 0, description: 'Zero-based selected menu row.' },
              footer: { type: 'string', description: 'Menu keybinding footer.' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── cards ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'variant'],
            description: 'Flexible peer-set, contrast, or Q&A layout.',
            properties: {
              type: { const: 'cards' },
              variant: {
                type: 'string',
                enum: [
                  'grid', 'list', 'numbered', 'agenda', 'icon-row', 'markdown',
                  'before-after', 'versus', 'point-counterpoint', 'pros-cons',
                  'qa',
                ],
                description: 'Layout mode: peer variants (grid/list/numbered/agenda/icon-row/markdown), contrast variants (before-after/versus/point-counterpoint/pros-cons), or qa',
              },
              title: { type: 'string', description: 'Optional eyebrow header' },
              intro: { type: 'string', description: 'Optional prose above peer items, used by imported Markdown decks' },
              introHtml: { type: 'string', description: 'Sanitized inline HTML for imported Markdown intro emphasis' },
              columns: { type: 'integer', minimum: 1, description: 'Column count override for peer variants' },
              cards: {
                type: 'array',
                items: CARDS_ITEM,
                description: 'Card items for peer variants (grid/list/numbered/agenda/icon-row)',
              },
              left: { ...CARDS_ITEM, description: 'Left column for contrast variants' },
              right: { ...CARDS_ITEM, description: 'Right column for contrast variants' },
              question: { type: 'string', description: 'Question text (qa variant)' },
              answer: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description: 'Answer text or bullet lines (qa variant)',
              },
              caption: { type: 'string' },
              outro: { type: 'string', description: 'Optional prose below peer items, used by imported Markdown decks' },
              outroHtml: { type: 'string', description: 'Sanitized inline HTML for imported Markdown outro emphasis' },
              ...COMMON,
            },
          },
          // ── objectives ─────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'items'],
            description: 'Objective/status report layout with large status glyphs.',
            properties: {
              type: { const: 'objectives' },
              title: { type: 'string', description: 'Optional eyebrow header' },
              items: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                items: OBJECTIVE_ITEM,
                description: 'Objective rows. Keep to 6 or fewer so status feedback remains visual.',
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── evidence ───────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'items'],
            description: 'Status-forward evidence ledger for commands, checks, paths, and proof artifacts.',
            properties: {
              type: { const: 'evidence' },
              title: { type: 'string', description: 'Optional eyebrow header' },
              items: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                items: EVIDENCE_ITEM,
                description: 'Evidence rows. Keep to 6 or fewer; put commands/paths in ref rather than prose.',
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── personas / use-cases ────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Persona cast intro, or use-case actions attributed to personas by avatar.',
            properties: {
              type: { const: 'personas' },
              variant: {
                type: 'string',
                enum: ['cast', 'use-cases'],
                description: '"cast" renders persona cards (avatar+name+role+intro); "use-cases" renders action rows attributed to a persona',
              },
              title: { type: 'string', description: 'Optional eyebrow header' },
              personas: {
                type: 'array',
                description: 'cast variant: persona ids (into meta.personas) or inline persona objects to display',
                items: {
                  oneOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      required: ['id'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        role: { type: 'string' },
                        intro: { type: 'string' },
                        color: { type: 'string' },
                        glyph: { type: 'string' },
                        avatar: { type: 'string' },
                      },
                    },
                  ],
                },
              },
              columns: { type: 'integer', minimum: 1, description: 'Column count override for the cast grid' },
              cases: {
                type: 'array',
                description: 'use-cases variant: action rows, each attributed to a persona',
                items: {
                  type: 'object',
                  required: ['who', 'action'],
                  additionalProperties: false,
                  properties: {
                    who: { type: 'string', description: 'Persona id whose avatar identifies the actor' },
                    action: { type: 'string', description: 'What this persona does' },
                    detail: { type: 'string', description: 'Optional secondary line under the action' },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── code ───────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'variant'],
            description: 'Source code, diff, function I/O, file tree, config, or log artifact.',
            properties: {
              type: { const: 'code' },
              variant: {
                type: 'string',
                enum: ['source', 'diff', 'function-io', 'tree', 'config', 'log'],
                description: '"source" — snippet with optional highlights/annotations; "diff" — +/- coloured diff; "function-io" — call + return pair; "tree" — indented file tree; "config" — config file; "log" — log/stack trace',
              },
              title: { type: 'string', description: 'Filename shown in the chrome bar' },
              lang: { type: 'string', description: 'Language tag shown at right of the bar, e.g. "javascript"' },
              code: { type: 'string', description: 'The artifact body (\\n-separated lines)' },
              sourceRef: { ...REFERENCE, description: 'Full source reference opened when clicking the code scene in the interactive viewer. Use lines/lineStart/lineEnd to highlight the linked range.' },
              reference: { ...REFERENCE, description: 'Alias for sourceRef.' },
              highlight: {
                type: 'array',
                items: { type: 'integer', minimum: 1 },
                description: '1-based line numbers to emphasise (source variant)',
              },
              annotations: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['line', 'text'],
                  properties: {
                    line: { type: 'integer', minimum: 1, description: '1-based line number' },
                    text: { type: 'string', description: 'Annotation callout text' },
                  },
                },
              },
              call: { type: 'string', description: 'Function invocation expression (function-io variant)' },
              returns: { type: 'string', description: 'Return value display (function-io variant)' },
              tree: { type: 'string', description: 'Indented file tree text (tree variant)' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── reference preview ─────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'On-slide preview of a referenced file or media asset. Click the preview in the interactive viewer to open the full reference modal.',
            properties: {
              type: { const: 'reference' },
              title: { type: 'string', description: 'Title shown above the preview.' },
              reference: REFERENCE,
              ref: REFERENCE,
              previewLines: { type: 'integer', minimum: 1, description: 'Fallback number of lines to show when no line range or Markdown section is specified.' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── mcp-drive ─────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'prompt'],
            description: 'Claude Code-style prompt surface with MCP tool calls and outcome.',
            properties: {
              type: { const: 'mcp-drive' },
              title: { type: 'string', description: 'Optional scene title or mode label' },
              agent: { type: 'string', description: 'Agent/subagent name shown in the chrome' },
              story: { type: 'string', description: 'Story path or workflow context shown in the chrome' },
              prompt: { type: 'string', description: 'Operator prompt shown as terminal input' },
              calls: {
                type: 'array',
                maxItems: 6,
                items: MCP_CALL,
                description: 'MCP tool calls. Keep to 6 or fewer for readability.',
              },
              outcome: MCP_OUTCOME,
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── table ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'variant', 'columns', 'rows'],
            description: 'Bordered data or comparison grid (max 6 columns, 8 rows).',
            properties: {
              type: { const: 'table' },
              variant: {
                type: 'string',
                enum: ['data', 'comparison', 'scorecard'],
                description: '"data" — plain values; "comparison" — first col is criterion, ✓/✗ cells; "scorecard" — like comparison with a highlighted winner column',
              },
              title: { type: 'string' },
              columns: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                items: { type: 'string' },
                description: 'Column header labels (max 6)',
              },
              rows: {
                type: 'array',
                maxItems: 8,
                items: {
                  type: 'object',
                  required: ['cells'],
                  properties: {
                    cells: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Cell values; use "✓" and "✗" for comparison/scorecard',
                    },
                    highlight: { type: 'integer', minimum: 0, description: 'Column index to accent in this row' },
                  },
                },
                description: 'Data rows (max 8)',
              },
              winner: { type: 'integer', minimum: 0, description: 'Column index to crown as winner (comparison/scorecard)' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── chart ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'variant', 'series'],
            description: 'Deterministic inline-SVG chart (no D3/Chart.js).',
            properties: {
              type: { const: 'chart' },
              variant: {
                type: 'string',
                enum: ['bar', 'line', 'area', 'pie', 'scatter', 'quadrant'],
              },
              title: { type: 'string' },
              unit: { type: 'string', description: 'Unit suffix appended to y-axis values, e.g. "%"' },
              axes: {
                type: 'object',
                properties: {
                  x: { type: 'string', description: 'X-axis title' },
                  y: { type: 'string', description: 'Y-axis title' },
                },
              },
              series: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['points'],
                  properties: {
                    name: { type: 'string' },
                    color: {
                      type: 'string',
                      enum: ['primary', 'secondary', 'green', 'orange', 'red', 'teal'],
                      description: 'Design token colour name; omit to use the default palette',
                    },
                    points: {
                      type: 'array',
                      minItems: 1,
                      items: {
                        type: 'object',
                        required: ['x', 'y'],
                        properties: {
                          x: { description: 'Category label (string) or numeric value' },
                          y: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── image ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'src'],
            description: 'Static image slide for screenshots, diagrams, and migrated Markdown/Marp image slides.',
            properties: {
              type: { const: 'image' },
              title: { type: 'string' },
              src: { type: 'string', description: 'Image path relative to the spec, absolute path, URL, or data URI' },
              alt: { type: 'string' },
              fit: { type: 'string', enum: ['contain', 'cover'], description: 'Object-fit mode; contain is default' },
              frameHeight: { type: 'string', description: 'Optional CSS height for the image frame, e.g. 820px for dense diagrams' },
              mediaBackground: { type: 'string', description: 'Optional CSS background for the image media element; useful for transparent SVG diagrams' },
              mediaPadding: { type: 'string', description: 'Optional CSS padding for the image media element' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── meme ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'template'],
            description: 'Meme-template slide. `template` is a registry id (see slidey_meme_search); each template knows its own caption boxes, semantic fields, and orientation. Captions are themed to match the deck by default. Use `text` (positional, by box order) or `fields` (keyed by field name) to fill the boxes.',
            properties: {
              type: { const: 'meme' },
              template: { type: 'string', description: 'Meme template id from the registry, e.g. "db" (Distracted Boyfriend), "drake", "fine". Search with slidey_meme_search.' },
              title: { type: 'string', description: 'Optional eyebrow header shown above the meme.' },
              text: {
                type: 'array',
                items: { type: 'string' },
                description: 'Caption strings in box order (top-to-bottom / left-to-right as defined by the template). Empty strings skip a box.',
              },
              fields: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Captions keyed by the template\'s semantic field names (e.g. {"top":"...","bottom":"..."}). Takes precedence over `text` for any field it sets.',
              },
              fit: { type: 'string', enum: ['contain', 'cover'], description: 'How the template image fits the stage. contain (default) letterboxes tall/wide memes without distortion; cover fills the frame.' },
              style: {
                type: 'object',
                additionalProperties: false,
                description: 'Optional per-slide caption styling override. By default captions use the deck theme.',
                properties: {
                  impact: { type: 'boolean', description: 'Classic Impact meme look: bold uppercase white text with a heavy black outline.' },
                  color: { type: 'string', description: 'Caption text color (CSS).' },
                  stroke: { type: 'string', description: 'Caption outline/stroke color (CSS).' },
                  font: { type: 'string', description: 'Caption font-family (CSS).' },
                  uppercase: { type: 'boolean', description: 'Force uppercase captions.' },
                },
              },
              caption: { type: 'string', description: 'Optional footer line below the meme.' },
              ...COMMON,
            },
          },
          // ── image-compare ─────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'left', 'right'],
            description: 'Side-by-side image comparison slide for old/new screenshots.',
            properties: {
              type: { const: 'image-compare' },
              title: { type: 'string' },
              left: {
                type: 'object',
                required: ['src'],
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  src: { type: 'string', description: 'Image path relative to the spec, absolute path, URL, or data URI' },
                  alt: { type: 'string' },
                },
              },
              right: {
                type: 'object',
                required: ['src'],
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  src: { type: 'string', description: 'Image path relative to the spec, absolute path, URL, or data URI' },
                  alt: { type: 'string' },
                },
              },
              fit: { type: 'string', enum: ['contain', 'cover'], description: 'Object-fit mode; contain is default' },
              variant: { type: 'string', enum: ['qa'], description: 'Compact QA comparison layout with minimal chrome and larger slide previews.' },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── book ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type', 'books'],
            description: 'Book-cover bibliography slide for one to three books, with local cover assets and a one-line takeaway per book.',
            properties: {
              type: { const: 'book' },
              title: { type: 'string' },
              books: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  required: ['title', 'authors', 'cover', 'takeaway'],
                  properties: {
                    title: { type: 'string' },
                    subtitle: { type: 'string' },
                    authors: { type: 'string' },
                    publisher: { type: 'string' },
                    year: { type: 'string' },
                    isbn: { type: 'string' },
                    cover: { type: 'string', description: 'Cover image path relative to the spec, absolute path, URL, or data URI' },
                    alt: { type: 'string' },
                    takeaway: { type: 'string' },
                  },
                },
              },
              caption: { type: 'string' },
              ...COMMON,
            },
          },
          // ── request ────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'API request/response card. Requires meta.mode "api". Three modes: live (real HTTP), mock (mock: true), playback (playback: true).',
            properties: {
              type: { const: 'request' },
              title: { type: 'string' },
              annotation: { type: 'string', description: 'Small label shown above the request' },
              request: {
                type: 'object',
                required: ['method', 'url'],
                description: 'The HTTP request to make or display',
                properties: {
                  method: {
                    type: 'string',
                    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
                  },
                  url: { type: 'string', description: 'Request URL; may use {{context}} variables' },
                  headers: {
                    type: 'array',
                    items: { type: 'object' },
                    description: 'Request headers',
                  },
                  body: { description: 'Request body (any JSON value)' },
                },
              },
              response: { type: 'object', description: 'Synthetic response for mock mode' },
              mock: { type: 'boolean', description: 'Set true to use the inline "response" object instead of making a real HTTP request' },
              playback: { type: 'boolean', description: 'Set true to replay a captured response from --capture-log' },
              expect: { type: 'object', description: 'Assertions on the response (status, body fields)' },
              capture: { type: 'object', description: 'JSONPath expressions to capture from the response into context variables' },
              ...COMMON,
            },
          },
          // ── video ──────────────────────────────────────────────────────────
          {
            type: 'object',
            required: ['type'],
            description: 'Embed a demo into the deck — fullscreen or inset in a slide, with auto chapter captions, hand-authored annotations, and time-keyed narration. Provide exactly one source of "src" (MP4), "rrweb" (rrweb log), or "capture" (tour spec captured on the fly).',
            properties: {
              type: { const: 'video' },
              src: { type: 'string', description: 'Path to a pre-rendered demo MP4 (relative to the spec). A sibling <src>.chapters.json is used for auto captions when present.' },
              rrweb: { type: 'string', description: 'Path to an rrweb event log (*.rrweb.json) relative to the spec. Baked output seek-rasterizes the log to frames; the web viewer mounts a live scrubbable player. Chapters come from in-log slidey.chapter custom events (or a sibling <rrweb>.chapters.json).' },
              capture: { type: 'string', description: 'Path to a tour spec (relative to the spec) captured on the fly via the slidey tour engine, then embedded.' },
              audio: { type: 'string', description: 'Optional audio file (mp3/m4a/wav/ogg) synced to the rrweb or MP4 playback in the web viewer. Single-file bundles inline it as a data URI.' },
              mode: { type: 'string', enum: ['fullscreen', 'embedded'], description: '"fullscreen" (default) fills the frame; "embedded" insets the video in a deck slide with title/caption chrome.' },
              cinematic: { type: 'boolean', description: 'Embedded-scene web viewer choreography: expand to fullscreen during playback. Defaults true; set false to keep the player inline.' },
              introMs: { type: 'integer', minimum: 0, description: 'Milliseconds to hold the embedded thumbnail before cinematic expansion.' },
              fit: { type: 'string', enum: ['contain', 'cover'], description: '"contain" (default) letterboxes on the deck background; "cover" crops to fill.' },
              cinematic: { type: 'boolean', description: 'Embedded viewer only: set false to keep the video inline instead of expanding fullscreen before playback.' },
              start: { type: 'number', minimum: 0, description: 'Trim start (seconds into the source).' },
              end: { type: 'number', minimum: 0, description: 'Trim end (seconds into the source).' },
              speed: { type: 'number', exclusiveMinimum: 0, description: 'Playback speed multiplier (>1 faster).' },
              duration: { type: 'number', exclusiveMinimum: 0, description: 'Explicit on-screen duration hint (seconds) for --estimate; skips probing the source.' },
              title: { type: 'string', description: 'Deck chrome heading (embedded mode).' },
              eyebrow: { type: 'string', description: 'Small label above the title (embedded mode).' },
              caption: { type: 'string', description: 'Caption under the inset (embedded mode).' },
              chapters: {
                description: '"auto" (default) derives lower-third captions from the <src>.chapters.json sidecar; false disables; a string path points at an explicit sidecar.',
                oneOf: [{ type: 'string' }, { type: 'boolean' }],
              },
              annotations: {
                type: 'array',
                description: 'Hand-authored overlays composited over the video, keyed to time.',
                items: {
                  type: 'object',
                  properties: {
                    at: { type: 'number', minimum: 0, description: 'Start time (seconds into the trimmed video).' },
                    until: { type: 'number', minimum: 0, description: 'End time (seconds); defaults to scene end.' },
                    chapter: { type: 'string', description: 'Alternative to "at": a chapter id from the sidecar.' },
                    text: { type: 'string', description: 'Caption/callout text.' },
                    sub: { type: 'string', description: 'Secondary line.' },
                    x: { type: 'number', description: 'Overlay x (px); omit to center.' },
                    y: { type: 'number', description: 'Overlay y (px); omit for lower-third.' },
                  },
                },
              },
              ...COMMON,
              narration: {
                description: 'A whole-scene string (positioned at the scene start) OR time-keyed cues synced to video moments.',
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['text'],
                      properties: {
                        at: { type: 'number', minimum: 0, description: 'Start time (seconds into the video).' },
                        chapter: { type: 'string', description: 'Alternative to "at": a chapter id from the sidecar.' },
                        text: { type: 'string' },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
};

function closeTypedObjects(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  if (schema.type === 'object' && schema.properties && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }

  for (const key of ['properties', 'items']) {
    const child = schema[key];
    if (!child) continue;
    if (Array.isArray(child)) {
      child.forEach(closeTypedObjects);
    } else if (key === 'properties') {
      Object.values(child).forEach(closeTypedObjects);
    } else {
      closeTypedObjects(child);
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const children = schema[key];
    if (Array.isArray(children)) children.forEach(closeTypedObjects);
  }

  return schema;
}

SCHEMA.properties.scenes.items.oneOf.forEach(closeTypedObjects);

module.exports = { SCHEMA };
