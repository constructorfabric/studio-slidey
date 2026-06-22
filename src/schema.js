'use strict';

// JSON Schema for a slidey spec.
// Exported for --schema (LLM/tooling) and used by --validate and startup validation.

const COMMON = {
  narration: { type: 'string', description: 'Text synthesized to speech audio via edge-tts' },
  hold: { type: 'integer', minimum: 0, description: 'Extra frames to hold after the last reveal step' },
  instant: { type: 'boolean', description: 'Reveal the whole scene at once (no progressive build / no title-only first page) — one PDF page / nav advance for the scene' },
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
    style: { type: 'string', enum: ['primary', 'secondary'], description: 'Node colour accent' },
  },
};

const EDGE = {
  type: 'object',
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', description: 'Source node id' },
    to: { type: 'string', description: 'Target node id' },
    label: { type: 'string' },
    gate: { type: 'string', description: 'Dashed-line checkpoint condition label' },
    side: { type: 'string', enum: ['left', 'right'], description: 'Parallel arrow side' },
  },
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
              description: 'Map of term → phonetic respelling, applied whole-word and case-insensitively to the SPOKEN narration only (the text shown in specs/--list is unchanged). Fixes TTS mispronunciations of brand names, acronyms, and jargon. e.g. { "Anthropic": "an-THROP-ik", "SDLC": "S D L C", "kitsoki": "kit-SOH-kee" }',
              additionalProperties: { type: 'string' },
            },
          },
        },
        context: {
          type: 'object',
          description: 'Template variable values; referenced in scenes as {{varName}} (Postman-compatible)',
          additionalProperties: { type: 'string' },
        },
        mode: {
          type: 'string',
          enum: ['api', 'pitch'],
          description: '"api" enables request scenes with live/mock/playback HTTP; "pitch" is default slides mode',
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
              lede: { type: 'string', description: 'Highlighted pull-quote / summary line' },
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
                    viewBox: { type: 'string', description: 'SVG viewBox, e.g. "0 0 800 600"' },
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
                  required: ['title'],
                  additionalProperties: false,
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
              mode: { type: 'string', enum: ['fullscreen', 'embedded'], description: '"fullscreen" (default) fills the frame; "embedded" insets the video in a deck slide with title/caption chrome.' },
              fit: { type: 'string', enum: ['contain', 'cover'], description: '"contain" (default) letterboxes on the deck background; "cover" crops to fill.' },
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

module.exports = { SCHEMA };
