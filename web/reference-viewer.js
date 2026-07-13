import { escapeHTML, highlightJSON } from './format.js';

const IMAGE_EXT = new Set(['.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown']);
const HTML_EXT = new Set(['.html', '.htm']);
const CODE_EXT = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.java', '.js',
  '.jsx', '.kt', '.lua', '.mjs', '.php', '.py', '.rb', '.rs', '.sh', '.sql', '.swift',
  '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
]);
const DIFF_EXT = new Set(['.diff', '.patch']);
const TEXT_EXT = new Set(['.csv', '.ini', '.log', '.text', '.toml', '.txt']);

const LANG_BY_EXT = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.diff': 'diff',
  '.go': 'go',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.kt': 'kotlin',
  '.lua': 'lua',
  '.mjs': 'javascript',
  '.php': 'php',
  '.patch': 'diff',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.swift': 'swift',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

export function referenceExtension(src = '') {
  const clean = String(src).split(/[?#]/)[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function inferReferenceKind(ref = {}) {
  if (ref.kind) return String(ref.kind).toLowerCase();
  const ext = referenceExtension(ref.src || ref.path || ref.href || '');
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (HTML_EXT.has(ext)) return 'html';
  if (DIFF_EXT.has(ext)) return 'diff';
  if (ext === '.json') return 'json';
  if (CODE_EXT.has(ext)) return 'code';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'file';
}

export function referenceLanguage(ref = {}) {
  if (ref.lang) return String(ref.lang);
  const ext = referenceExtension(ref.src || ref.path || ref.href || '');
  return LANG_BY_EXT[ext] || (inferReferenceKind(ref) === 'code' ? ext.replace(/^\./, '') : '');
}

export function normalizeLineRange(ref = {}) {
  if (Array.isArray(ref.lines) && ref.lines.length) {
    const start = Number(ref.lines[0]);
    const end = Number(ref.lines.length > 1 ? ref.lines[1] : ref.lines[0]);
    if (Number.isFinite(start) && start > 0) {
      return {
        lineStart: Math.floor(start),
        lineEnd: Number.isFinite(end) && end > 0 ? Math.max(Math.floor(start), Math.floor(end)) : Math.floor(start),
      };
    }
  }
  const start = Number(ref.lineStart || ref.startLine || ref.line);
  const end = Number(ref.lineEnd || ref.endLine || ref.line);
  if (!Number.isFinite(start) || start <= 0) return {};
  return {
    lineStart: Math.floor(start),
    lineEnd: Number.isFinite(end) && end > 0 ? Math.max(Math.floor(start), Math.floor(end)) : Math.floor(start),
  };
}

export function normalizeReference(ref, fallback = {}) {
  if (!ref) return null;
  const raw = typeof ref === 'string' ? { src: ref } : { ...ref };
  const src = raw.src || raw.path || raw.href || fallback.src || (raw.inline ? raw.label || fallback.label || 'inline' : '');
  if (!src) return null;
  const label = raw.label || fallback.label || src.split('/').pop() || src;
  return {
    ...raw,
    ...normalizeLineRange(raw),
    src,
    label,
    kind: inferReferenceKind({ ...raw, src }),
    lang: referenceLanguage({ ...raw, src }),
    auto: !!fallback.auto,
  };
}

export function normalizeReferences(scene = {}) {
  const refs = [];
  const push = (ref, fallback = {}) => {
    const normalized = normalizeReference(ref, fallback);
    if (normalized) refs.push(normalized);
  };

  if (Array.isArray(scene.references)) {
    for (const ref of scene.references) push(ref);
  } else if (scene.references && typeof scene.references === 'object') {
    push(scene.references);
  }

  if (scene.type === 'image') push(scene.src, { label: scene.alt || scene.title || 'image', auto: true });
  if (scene.type === 'image-compare') {
    push(scene.left && scene.left.src, { label: (scene.left && scene.left.label) || 'left image', auto: true });
    push(scene.right && scene.right.src, { label: (scene.right && scene.right.label) || 'right image', auto: true });
  }
  if (scene.type === 'video') {
    push(scene.src, { label: scene.title || 'video', auto: true });
    push(scene.rrweb, { label: 'rrweb log', auto: true });
    push(scene.capture, { label: 'capture spec', auto: true });
  }
  if (scene.type === 'mermaid' && scene.source) {
    push({ label: scene.title || 'mermaid source', kind: 'code', lang: 'mermaid', inline: scene.source });
  }

  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.src}:${ref.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractReferenceSnippet(text = '', ref = {}, maxLines = 14) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const { lineStart, lineEnd } = normalizeLineRange(ref);
  if (lineStart) {
    const start = Math.max(1, lineStart);
    const end = Math.max(start, lineEnd || start);
    return {
      text: lines.slice(start - 1, end).join('\n'),
      startLine: start,
      endLine: Math.min(end, lines.length),
    };
  }
  const section = String(ref.section || ref.heading || '').trim().toLowerCase();
  if (section) {
    const startIndex = lines.findIndex(line => {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      return m && m[2].trim().toLowerCase() === section;
    });
    if (startIndex >= 0) {
      let endIndex = lines.length;
      for (let i = startIndex + 1; i < lines.length; i += 1) {
        if (/^#{1,6}\s+/.test(lines[i])) {
          endIndex = i;
          break;
        }
      }
      return {
        text: lines.slice(startIndex, endIndex).join('\n'),
        startLine: startIndex + 1,
        endLine: endIndex,
      };
    }
  }
  const preview = lines.slice(0, maxLines);
  return { text: preview.join('\n'), startLine: 1, endLine: preview.length };
}

export function renderMarkdownHTML(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let code = [];
  let codeLang = '';
  let inList = false;

  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };
  const closeCode = () => {
    out.push(`<pre class="slidey-ref-code"><code data-lang="${escapeHTML(codeLang)}">${escapeHTML(code.join('\n'))}</code></pre>`);
    inCode = false;
    code = [];
    codeLang = '';
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (inCode) closeCode();
      else {
        closeList();
        inCode = true;
        codeLang = fence[1] || '';
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inCode) closeCode();
  closeList();
  return out.join('\n');
}

function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderTextHTML(text = '', kind = 'text', lang = '') {
  if (kind === 'json') {
    try {
      return highlightJSON(JSON.stringify(JSON.parse(text), null, 2));
    } catch (_) {
      return escapeHTML(text);
    }
  }
  if (kind === 'diff') return renderDiffHTML(text);
  if (kind === 'code') return highlightCodeHTML(text, lang);
  return escapeHTML(text);
}

export function renderNumberedTextHTML(text = '', kind = 'text', lang = '', ref = {}) {
  const { lineStart, lineEnd } = normalizeLineRange(ref);
  const start = Number(ref.previewStartLine || ref.startLine || 1) || 1;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  return lines.map((line, i) => {
    const n = start + i;
    const highlighted = lineStart && n >= lineStart && n <= (lineEnd || lineStart);
    const html = kind === 'code' ? highlightCodeHTML(line, lang) : renderTextHTML(line, kind, lang);
    return `<span class="slidey-ref-line${highlighted ? ' is-highlighted' : ''}" data-line="${n}"><span class="slidey-ref-lineno">${n}</span><span class="slidey-ref-linecode">${html || ' '}</span></span>`;
  }).join('\n');
}

export function renderDiffHTML(text = '') {
  return String(text).replace(/\r\n/g, '\n').split('\n').map((line) => {
    const kind = diffLineKind(line);
    return `<span class="slidey-ref-diff slidey-ref-diff-${kind}">${escapeHTML(line) || ' '}</span>`;
  }).join('\n');
}

function diffLineKind(line) {
  if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return 'meta';
  if (/^@@ /.test(line)) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export function highlightCodeHTML(text = '', lang = '') {
  const language = String(lang || '').toLowerCase();
  if (language === 'json') return renderTextHTML(text, 'json');
  const keywords = keywordSet(language);
  return String(text).split('\n').map((line) => highlightCodeLine(line, keywords)).join('\n');
}

function keywordSet(lang) {
  const common = ['break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'else', 'export', 'for', 'from', 'function', 'if', 'import', 'let', 'new', 'return', 'switch', 'throw', 'try', 'var', 'while'];
  const byLang = {
    go: ['chan', 'defer', 'fallthrough', 'func', 'go', 'interface', 'map', 'package', 'range', 'select', 'struct', 'type'],
    python: ['as', 'async', 'await', 'def', 'elif', 'except', 'False', 'finally', 'from', 'None', 'pass', 'self', 'True', 'with', 'yield'],
    rust: ['async', 'await', 'enum', 'impl', 'let', 'match', 'mod', 'mut', 'pub', 'self', 'Self', 'struct', 'trait', 'use', 'where'],
    javascript: ['async', 'await', 'false', 'null', 'true', 'undefined'],
    typescript: ['async', 'await', 'false', 'interface', 'null', 'private', 'public', 'readonly', 'true', 'type', 'undefined'],
  };
  return new Set([...common, ...(byLang[lang] || [])]);
}

function highlightCodeLine(line, keywords) {
  const tokenRe = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*|#.*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let out = '';
  let last = 0;
  for (const match of line.matchAll(tokenRe)) {
    const token = match[0];
    out += escapeHTML(line.slice(last, match.index));
    if (/^(\/\/|#)/.test(token)) out += `<span class="slidey-ref-comment">${escapeHTML(token)}</span>`;
    else if (/^["'`]/.test(token)) out += `<span class="slidey-ref-string">${escapeHTML(token)}</span>`;
    else if (/^\d/.test(token)) out += `<span class="slidey-ref-number">${escapeHTML(token)}</span>`;
    else if (keywords.has(token)) out += `<span class="slidey-ref-keyword">${escapeHTML(token)}</span>`;
    else out += escapeHTML(token);
    last = match.index + token.length;
  }
  out += escapeHTML(line.slice(last));
  return out;
}
