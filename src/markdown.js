'use strict';

const fs = require('fs');
const path = require('path');

function stripFrontMatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { meta: {}, body: text };
  const end = lines.slice(1).findIndex(l => l.trim() === '---');
  if (end === -1) return { meta: {}, body: text };
  const fm = lines.slice(1, end + 1);
  const meta = {};
  for (const line of fm) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: lines.slice(end + 2).join('\n').replace(/^\s*\n/, '') };
}

function splitSlides(body) {
  const slides = [];
  let cur = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '---') {
      slides.push(cur.join('\n').trim());
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) slides.push(cur.join('\n').trim());
  return slides.filter(Boolean);
}

function cleanInline(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCode(slide) {
  const m = slide.match(/```([A-Za-z0-9_-]*)\n([\s\S]*?)```/);
  return m ? { lang: m[1] || '', code: m[2].trimEnd() } : null;
}

function extractImage(slide) {
  const m = slide.match(/!\[([^\]]*)\]\(([^)]+)\)/);
  if (!m) return null;
  const alt = m[1].replace(/\b[wh]:\d+\b/g, '').trim();
  const src = m[2].trim();
  return { alt, src };
}

function extractHeading(lines) {
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) return { level: m[1].length, text: cleanInline(m[2]) };
  }
  return null;
}

function extractBullets(lines) {
  return lines
    .map(l => l.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/))
    .filter(Boolean)
    .map(m => cleanInline(m[1]))
    .filter(Boolean);
}

function extractTable(lines) {
  const rows = lines.filter(l => /^\s*\|.*\|\s*$/.test(l));
  if (rows.length < 2) return null;
  const parsed = rows.map(r => r.trim().slice(1, -1).split('|').map(c => cleanInline(c.trim())));
  const sep = parsed[1].every(c => /^:?-{3,}:?$/.test(c));
  if (!sep) return null;
  return { columns: parsed[0], rows: parsed.slice(2).map(cells => ({ cells })) };
}

function relativeFromOutput(inputPath, outputPath, src) {
  if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src) || path.isAbsolute(src)) return src;
  const abs = path.resolve(path.dirname(inputPath), src);
  return path.relative(path.dirname(outputPath), abs).replace(/\\/g, '/');
}

function slideToScene(slide, idx, inputPath, outputPath) {
  const lead = /<!--\s*_class:\s*lead\s*-->/.test(slide);
  const lines = slide.split('\n').filter(l => !/^\s*<!--/.test(l));
  const heading = extractHeading(lines);
  const title = heading ? heading.text : `Slide ${idx + 1}`;
  const subheading = lines
    .map(l => l.match(/^#{3}\s+(.+)$/))
    .filter(Boolean)
    .map(m => cleanInline(m[1]))[0] || '';
  const code = extractCode(slide);
  const image = extractImage(slide);
  const table = extractTable(lines);
  const bullets = extractBullets(lines);
  const quote = lines.map(l => l.match(/^>\s+(.+)$/)).filter(Boolean).map(m => cleanInline(m[1])).join(' ');
  const body = cleanInline(lines.filter(l =>
    !/^(#{1,3})\s+/.test(l) &&
    !/^\s*(?:[-*]|\d+\.)\s+/.test(l) &&
    !/^\s*\|.*\|\s*$/.test(l) &&
    !/^>\s+/.test(l) &&
    !/^```/.test(l)
  ).join(' '));

  if (lead || (heading && heading.level === 1 && !bullets.length && !image && !code)) {
    return { type: 'title', title, subtitle: subheading || body || quote || '' };
  }
  if (image) {
    return {
      type: 'image',
      title,
      src: relativeFromOutput(inputPath, outputPath, image.src),
      alt: image.alt,
      caption: quote || body || '',
      fit: 'contain',
    };
  }
  if (code) {
    return { type: 'code', variant: 'source', title, lang: code.lang, code: code.code };
  }
  if (table) {
    return { type: 'table', variant: 'data', title, columns: table.columns.slice(0, 6), rows: table.rows.slice(0, 8) };
  }
  if (bullets.length) {
    return {
      type: 'cards',
      variant: title.toLowerCase() === 'agenda' ? 'agenda' : 'list',
      title,
      cards: bullets.slice(0, 8).map(label => ({ label })),
    };
  }
  return { type: 'narrative', eyebrow: title, body: body || quote || title };
}

function convertMarkdownFile(inputPath, outputPath, opts = {}) {
  const text = fs.readFileSync(inputPath, 'utf-8');
  const { meta, body } = stripFrontMatter(text);
  const scenes = splitSlides(body).map((slide, i) => slideToScene(slide, i, inputPath, outputPath));
  const spec = {
    meta: {
      title: meta.title || path.basename(inputPath, path.extname(inputPath)),
      mode: 'pitch',
      source: { kind: meta.marp === 'true' ? 'marp' : 'markdown' },
    },
    scenes,
  };
  if (opts.comment) spec._comment = opts.comment;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  return spec;
}

module.exports = { convertMarkdownFile, splitSlides, stripFrontMatter };
