import builtinVsCodePack from '../data/theme-packs/builtin-vscode.json';

const ROSE_PINE_MOON_COLORS = {
  base: '#232136',
  surface: '#2a273f',
  overlay: '#393552',
  muted: '#6e6a86',
  subtle: '#908caa',
  text: '#e0def4',
  love: '#eb6f92',
  gold: '#f6c177',
  rose: '#ea9a97',
  pine: '#3e8fb0',
  foam: '#9ccfd8',
  iris: '#c4a7e7',
  accent: '#ea9a97',
  accent2: '#9ccfd8',
  accent3: '#f6c177',
  danger: '#eb6f92',
  highlightLow: '#2a283e',
  highlightMuted: '#44415a',
  highlightHigh: '#56526e',
};

const DEFAULT_FONT = 'Pier Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica Neue, Arial, sans-serif';

const BUILTIN_THEMES = {
  'rose-pine-moon': {
    label: 'Rosé Pine Moon',
    colors: ROSE_PINE_MOON_COLORS,
    background: ROSE_PINE_MOON_COLORS.base,
    fontFamily: DEFAULT_FONT,
  },
  ...(builtinVsCodePack.themes || {}),
};

function kebab(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeThemes(themes) {
  if (!themes) return {};
  if (!Array.isArray(themes)) return themes && typeof themes === 'object' ? themes : {};
  return themes.reduce((acc, theme) => {
    if (theme && typeof theme === 'object' && typeof theme.id === 'string') {
      const { id, ...rest } = theme;
      acc[id] = rest;
    }
    return acc;
  }, {});
}

function runtimeThemes(meta) {
  const out = { ...BUILTIN_THEMES };
  const packs = Array.isArray(meta && meta._themePacks) ? meta._themePacks : [];
  for (const pack of packs) {
    for (const [id, theme] of Object.entries(normalizeThemes(pack && pack.themes))) {
      out[id] = theme;
    }
  }
  return out;
}

function baseThemeCss(className) {
  const root = `#root.${className}`;
  return `
${root} {
  background: var(--slidey-background);
  color: var(--slidey-text);
  font-family: var(--slidey-font-family);
}
${root} #title-card,
${root} #pitch-stage,
${root} #main {
  background: var(--slidey-background);
}
${root} #pitch-stage::before {
  background: none;
}
${root} #header,
${root} #scene-header,
${root} .panel-label,
${root} .imagecompare-panel figcaption {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-low);
}
${root} #scene-title-text,
${root} .table-grid td,
${root} .code-text,
${root} .code-filename,
${root} .imagecompare-panel figcaption {
  color: var(--slidey-text);
}
${root} #title-card-title,
${root} #title-card-eyebrow,
${root} .cards-title,
${root} .image-title,
${root} .imagecompare-title,
${root} .mermaid-title,
${root} .table-title,
${root} .code-call,
${root} .code-dot-call {
  color: var(--slidey-accent);
}
${root} #title-card-subtitle,
${root} #ticker,
${root} #scene-annotation-text,
${root} .cards-label,
${root} .cards-lines li,
${root} .cards-markdown-intro,
${root} .cards-markdown-outro,
${root} .image-caption,
${root} .imagecompare-caption,
${root} .mermaid-caption,
${root} .table-caption,
${root} .code-caption,
${root} .code-lang,
${root} .code-gutter {
  color: var(--slidey-subtle);
}
${root} #title-card-rule,
${root} .slidey-bar-fill {
  background: linear-gradient(90deg, var(--slidey-accent), var(--slidey-accent2));
}
${root} a,
${root} .cards-bullet,
${root} .cards-variant-markdown .cards-lines li::before,
${root} .table-crown,
${root} .table-row-hi {
  color: var(--slidey-accent2);
}
${root} strong,
${root} #title-card.title-card-markdown strong,
${root} .cards-variant-markdown strong {
  color: var(--slidey-text);
  font-weight: 800;
}
${root} em {
  font-style: italic;
}
${root} code,
${root} #title-card.title-card-markdown code,
${root} .cards-variant-markdown code,
${root} .table-grid code {
  color: var(--slidey-accent);
  background: var(--slidey-highlight-muted);
}
${root} .image-frame,
${root} .imagecompare-panel,
${root} .mermaid-frame,
${root} .table-frame,
${root} .cards-card,
${root} .cards-col,
${root} .cards-qa-question,
${root} .cards-qa-answer {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-high);
}
${root} .image-media {
  background: #ffffff;
  padding: 10px;
}
${root} .imagecompare-media {
  background: var(--slidey-background);
}
${root} .cards-markdown-agenda .cards-card {
  background: transparent;
  border-color: transparent;
}
${root} .table-grid th {
  background: var(--slidey-overlay);
  color: var(--slidey-text);
  border-color: var(--slidey-highlight-high);
}
${root} .table-grid td {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-high);
}
${root} .table-zebra td {
  background: var(--slidey-base);
}
${root} .code-header {
  background: var(--slidey-overlay);
  border-color: var(--slidey-highlight-high);
}
${root} .code-body {
  background: var(--slidey-base);
  border-color: var(--slidey-highlight-high);
}
${root} .code-line-hl {
  background: color-mix(in srgb, var(--slidey-accent2) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--slidey-accent2);
}
${root} .json-key,
${root} .code-key {
  color: var(--slidey-accent);
}
${root} .json-string,
${root} .code-val {
  color: var(--slidey-accent3);
}
${root} .dsvg-node rect {
  fill: var(--slidey-surface);
  stroke: var(--slidey-highlight-high);
}
${root} .dsvg-label,
${root} .dsvg-sub,
${root} .dsvg-edge-label {
  fill: var(--slidey-text);
}
${root} .dsvg-edge path,
${root} .dsvg-edge line {
  stroke: var(--slidey-accent2);
}
${root} .dsvg-arrow path {
  fill: var(--slidey-accent2);
}
`;
}

export function themeConfig(metaTheme, meta = {}) {
  if (!metaTheme) return { name: '', className: '', style: {}, css: '' };
  const raw = typeof metaTheme === 'string' ? { name: metaTheme } : metaTheme;
  const name = raw.name || raw.id || '';
  const builtin = runtimeThemes(meta)[name] || {};
  const colors = { ...(builtin.colors || {}), ...(raw.colors || {}) };
  const style = {};
  for (const [key, value] of Object.entries(colors)) {
    style[`--slidey-${kebab(key)}`] = value;
  }
  if (builtin.background || raw.background || colors.base) {
    style['--slidey-background'] = raw.background || builtin.background || colors.base;
  }
  if (builtin.fontFamily || raw.fontFamily || DEFAULT_FONT) {
    style['--slidey-font-family'] = raw.fontFamily || builtin.fontFamily || DEFAULT_FONT;
  }
  const className = name ? `theme-${kebab(name)}` : '';
  return {
    name,
    className,
    style,
    css: [className ? baseThemeCss(className) : '', builtin.css || '', raw.css || ''].filter(Boolean).join('\n'),
  };
}
