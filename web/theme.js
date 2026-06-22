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
  highlightLow: '#2a283e',
  highlightMuted: '#44415a',
  highlightHigh: '#56526e',
};

const ROSE_PINE_MOON_CSS = `
#root.theme-rose-pine-moon {
  background: var(--slidey-background);
  color: var(--slidey-text);
  font-family: var(--slidey-font-family);
}
#root.theme-rose-pine-moon #title-card,
#root.theme-rose-pine-moon #pitch-stage,
#root.theme-rose-pine-moon #main {
  background: var(--slidey-background);
}
#root.theme-rose-pine-moon #pitch-stage::before {
  background: none;
}
#root.theme-rose-pine-moon #header,
#root.theme-rose-pine-moon #scene-header,
#root.theme-rose-pine-moon .panel-label,
#root.theme-rose-pine-moon .imagecompare-panel figcaption {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-low);
}
#root.theme-rose-pine-moon #scene-title-text,
#root.theme-rose-pine-moon .table-grid td,
#root.theme-rose-pine-moon .code-text,
#root.theme-rose-pine-moon .code-filename,
#root.theme-rose-pine-moon .imagecompare-panel figcaption {
  color: var(--slidey-text);
}
#root.theme-rose-pine-moon #title-card-title {
  color: var(--slidey-rose);
}
#root.theme-rose-pine-moon #title-card-subtitle,
#root.theme-rose-pine-moon #ticker,
#root.theme-rose-pine-moon #scene-annotation-text,
#root.theme-rose-pine-moon .cards-label,
#root.theme-rose-pine-moon .cards-lines li,
#root.theme-rose-pine-moon .cards-markdown-intro,
#root.theme-rose-pine-moon .cards-markdown-outro,
#root.theme-rose-pine-moon .image-caption,
#root.theme-rose-pine-moon .imagecompare-caption,
#root.theme-rose-pine-moon .mermaid-caption,
#root.theme-rose-pine-moon .table-caption,
#root.theme-rose-pine-moon .code-caption,
#root.theme-rose-pine-moon .code-lang,
#root.theme-rose-pine-moon .code-gutter {
  color: var(--slidey-subtle);
}
#root.theme-rose-pine-moon #title-card-rule,
#root.theme-rose-pine-moon .slidey-bar-fill {
  background: linear-gradient(90deg, var(--slidey-rose), var(--slidey-iris));
}
#root.theme-rose-pine-moon #title-card-eyebrow,
#root.theme-rose-pine-moon .cards-title,
#root.theme-rose-pine-moon .image-title,
#root.theme-rose-pine-moon .imagecompare-title,
#root.theme-rose-pine-moon .mermaid-title,
#root.theme-rose-pine-moon .table-title,
#root.theme-rose-pine-moon .code-call,
#root.theme-rose-pine-moon .code-dot-call {
  color: var(--slidey-rose);
}
#root.theme-rose-pine-moon a,
#root.theme-rose-pine-moon .cards-bullet,
#root.theme-rose-pine-moon .cards-variant-markdown .cards-lines li::before,
#root.theme-rose-pine-moon .table-crown,
#root.theme-rose-pine-moon .table-row-hi {
  color: var(--slidey-iris);
}
#root.theme-rose-pine-moon strong,
#root.theme-rose-pine-moon #title-card.title-card-markdown strong,
#root.theme-rose-pine-moon .cards-variant-markdown strong {
  color: var(--slidey-text);
  font-weight: 800;
}
#root.theme-rose-pine-moon em {
  font-style: italic;
}
#root.theme-rose-pine-moon code,
#root.theme-rose-pine-moon #title-card.title-card-markdown code,
#root.theme-rose-pine-moon .cards-variant-markdown code,
#root.theme-rose-pine-moon .table-grid code {
  color: var(--slidey-rose);
  background: var(--slidey-highlight-muted);
}
#root.theme-rose-pine-moon .image-frame,
#root.theme-rose-pine-moon .imagecompare-panel,
#root.theme-rose-pine-moon .mermaid-frame,
#root.theme-rose-pine-moon .table-frame,
#root.theme-rose-pine-moon .cards-card,
#root.theme-rose-pine-moon .cards-col,
#root.theme-rose-pine-moon .cards-qa-question,
#root.theme-rose-pine-moon .cards-qa-answer {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .image-media {
  background: #ffffff;
  padding: 10px;
}
#root.theme-rose-pine-moon .imagecompare-media {
  background: var(--slidey-background);
}
#root.theme-rose-pine-moon .cards-markdown-agenda .cards-card {
  background: transparent;
  border-color: transparent;
}
#root.theme-rose-pine-moon .table-grid th {
  background: var(--slidey-overlay);
  color: var(--slidey-text);
  border-color: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .table-grid td {
  background: var(--slidey-surface);
  border-color: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .table-zebra td {
  background: var(--slidey-base);
}
#root.theme-rose-pine-moon .code-header {
  background: var(--slidey-overlay);
  border-color: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .code-body {
  background: var(--slidey-base);
  border-color: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .code-line-hl {
  background: color-mix(in srgb, var(--slidey-iris) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--slidey-iris);
}
#root.theme-rose-pine-moon .json-key,
#root.theme-rose-pine-moon .code-key {
  color: var(--slidey-foam);
}
#root.theme-rose-pine-moon .json-string,
#root.theme-rose-pine-moon .code-val {
  color: var(--slidey-gold);
}
#root.theme-rose-pine-moon .dsvg-node rect {
  fill: var(--slidey-surface);
  stroke: var(--slidey-highlight-high);
}
#root.theme-rose-pine-moon .dsvg-label,
#root.theme-rose-pine-moon .dsvg-sub,
#root.theme-rose-pine-moon .dsvg-edge-label {
  fill: var(--slidey-text);
}
#root.theme-rose-pine-moon .dsvg-edge path,
#root.theme-rose-pine-moon .dsvg-edge line {
  stroke: var(--slidey-iris);
}
#root.theme-rose-pine-moon .dsvg-arrow path {
  fill: var(--slidey-iris);
}
`;

export const BUILTIN_THEMES = {
  'rose-pine-moon': {
    colors: ROSE_PINE_MOON_COLORS,
    background: ROSE_PINE_MOON_COLORS.base,
    fontFamily: 'Pier Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica Neue, Arial, sans-serif',
    css: ROSE_PINE_MOON_CSS,
  },
};

function kebab(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function themeConfig(metaTheme) {
  if (!metaTheme) return { name: '', className: '', style: {}, css: '' };
  const raw = typeof metaTheme === 'string' ? { name: metaTheme } : metaTheme;
  const name = raw.name || raw.id || '';
  const builtin = BUILTIN_THEMES[name] || {};
  const colors = { ...(builtin.colors || {}), ...(raw.colors || {}) };
  const style = {};
  for (const [key, value] of Object.entries(colors)) {
    style[`--slidey-${kebab(key)}`] = value;
  }
  if (builtin.background || raw.background) {
    style['--slidey-background'] = raw.background || builtin.background;
  }
  if (builtin.fontFamily || raw.fontFamily) {
    style['--slidey-font-family'] = raw.fontFamily || builtin.fontFamily;
  }
  return {
    name,
    className: name ? `theme-${kebab(name)}` : '',
    style,
    css: [builtin.css || '', raw.css || ''].filter(Boolean).join('\n'),
  };
}
