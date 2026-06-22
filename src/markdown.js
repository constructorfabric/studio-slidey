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
    .replace(/`([^`\n]+)`/g, (m, code, offset, full) => {
      return code + (/[A-Za-z0-9_]/.test(full[offset + m.length] || '') ? ' ' : '');
    })
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:span|div|section|p|strong|em|b|i|small|sup|sub|code)\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanInlineRich(s) {
  let text = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:span|div|section|p|small|sup|sub)\b[^>]*>/gi, '');

  text = escapeHtml(text)
    .replace(/`([^`\n]+)`/g, (m, code, offset, full) => {
      return `<code>${code}</code>` + (/[A-Za-z0-9_]/.test(full[offset + m.length] || '') ? ' ' : '');
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function richLine(s) {
  return {
    text: cleanInline(s),
    html: cleanInlineRich(s),
  };
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

function listMarker(line) {
  return line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
}

function isStructuralLine(line) {
  return /^(#{1,3})\s+/.test(line)
    || /^\s*\|.*\|\s*$/.test(line)
    || /^>\s+/.test(line)
    || /^```/.test(line)
    || /^\s*!\[[^\]]*\]\([^)]+\)/.test(line)
    || /^\s*<!--/.test(line);
}

function extractBullets(lines) {
  const items = [];
  let cur = null;
  let inCode = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const marker = listMarker(line);
    if (marker) {
      const indent = marker[1].length;
      const { text, html } = richLine(marker[3]);
      if (!text) continue;

      if (cur && indent > cur.indent) {
        cur.lines.push(text);
        cur.linesHtml.push(html);
      } else {
        cur = { indent, label: text, labelHtml: html, lines: [], linesHtml: [] };
        items.push(cur);
      }
      continue;
    }

    if (!cur || !line.trim() || isStructuralLine(line)) continue;
    if (/^\s+/.test(line) || !/^\S/.test(line)) {
      const { text, html } = richLine(line);
      if (text) {
        cur.label = `${cur.label} ${text}`;
        cur.labelHtml = `${cur.labelHtml} ${html}`;
      }
    }
  }

  return items
    .map(({ label, labelHtml, lines, linesHtml }) => ({
      label,
      ...(labelHtml && labelHtml !== label ? { labelHtml } : {}),
      ...(lines.length ? { lines } : {}),
      ...(linesHtml.some((html, i) => html && html !== lines[i]) ? { linesHtml } : {}),
    }))
    .filter(item => item.label);
}

function stripCodeBlocks(slide) {
  return slide.replace(/```[A-Za-z0-9_-]*\n[\s\S]*?```/g, '');
}

function extractTable(lines) {
  const rows = lines.filter(l => /^\s*\|.*\|\s*$/.test(l));
  if (rows.length < 2) return null;
  const parsed = rows.map(r => r.trim().slice(1, -1).split('|').map(c => cleanInline(c.trim())));
  const sep = parsed[1].every(c => /^:?-{3,}:?$/.test(c));
  if (!sep) return null;
  return { columns: parsed[0], rows: parsed.slice(2).map(cells => ({ cells })) };
}

function flattenBullets(items) {
  return (items || []).map(item => {
    const parts = [item.label, ...((item.lines || []).filter(Boolean))].filter(Boolean);
    return parts.join(' — ');
  }).filter(Boolean);
}

function flattenBulletsHtml(items) {
  return (items || []).map(item => {
    const lines = item.lines || [];
    const lineHtml = item.linesHtml || [];
    const parts = [
      item.labelHtml || escapeHtml(item.label || ''),
      ...lines.map((line, i) => lineHtml[i] || escapeHtml(line)).filter(Boolean),
    ].filter(Boolean);
    return parts.join(' &mdash; ');
  }).filter(Boolean);
}

function captionText(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}

function captionHtml(...parts) {
  return parts.flat().filter(Boolean).join(' ');
}

function relativeFromOutput(inputPath, outputPath, src) {
  if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src) || path.isAbsolute(src)) return src;
  const abs = path.resolve(path.dirname(inputPath), src);
  return path.relative(path.dirname(outputPath), abs).replace(/\\/g, '/');
}

function slideToScene(slide, idx, inputPath, outputPath) {
  const lead = /<!--\s*_class:\s*lead\s*-->/.test(slide);
  const textSlide = stripCodeBlocks(slide);
  const lines = textSlide.split('\n').filter(l => !/^\s*<!--/.test(l));
  const heading = extractHeading(lines);
  const title = heading ? heading.text : `Slide ${idx + 1}`;
  const subheadingMatch = lines
    .map(l => l.match(/^#{3}\s+(.+)$/))
    .filter(Boolean)
    [0];
  const subheading = subheadingMatch ? cleanInline(subheadingMatch[1]) : '';
  const subheadingHtml = subheadingMatch ? cleanInlineRich(subheadingMatch[1]) : '';
  const code = extractCode(slide);
  const image = extractImage(slide);
  const table = extractTable(lines);
  const bullets = extractBullets(lines);
  const quote = lines.map(l => l.match(/^>\s+(.+)$/)).filter(Boolean).map(m => cleanInline(m[1])).join(' ');
  const quoteHtml = lines.map(l => l.match(/^>\s+(.+)$/)).filter(Boolean).map(m => cleanInlineRich(m[1])).join(' ');
  const bodyLines = lines.filter(l =>
    !isStructuralLine(l) &&
    !listMarker(l) &&
    !/^\s+/.test(l)
  ).map(l => cleanInline(l)).filter(Boolean);
  const bodyLineHtmls = lines.filter(l =>
    !isStructuralLine(l) &&
    !listMarker(l) &&
    !/^\s+/.test(l)
  ).map(l => cleanInlineRich(l)).filter(Boolean);
  const body = cleanInline(lines.filter(l =>
    !isStructuralLine(l) &&
    !listMarker(l) &&
    !/^\s+/.test(l)
  ).join(' '));

  if (lead || (heading && heading.level === 1 && !bullets.length && !image && !code)) {
    return {
      type: 'title',
      theme: 'markdown',
      title,
      subtitle: [subheading, ...bodyLines, quote].filter(Boolean).join('\n'),
      subtitleHtml: [subheadingHtml, ...bodyLineHtmls, quoteHtml].filter(Boolean).join('<br>'),
    };
  }
  if (code) {
    if (String(code.lang || '').toLowerCase() === 'mermaid') {
      return {
        type: 'mermaid',
        title,
        source: code.code,
        ...(captionText(body, flattenBullets(bullets), quote) ? {
          caption: captionText(body, flattenBullets(bullets), quote),
        } : {}),
      };
    }
  }
  if (image) {
    return {
      type: 'image',
      title,
      src: relativeFromOutput(inputPath, outputPath, image.src),
      alt: image.alt,
      caption: captionText(body, quote),
      fit: 'contain',
    };
  }
  if (code) {
    return {
      type: 'code',
      variant: 'source',
      title,
      lang: code.lang,
      code: code.code,
      ...(captionText(body, flattenBullets(bullets), quote) ? {
        caption: captionText(body, flattenBullets(bullets), quote),
      } : {}),
    };
  }
  if (table) {
    const caption = captionText(body, flattenBullets(bullets), quote);
    return {
      type: 'table',
      variant: 'data',
      title,
      columns: table.columns.slice(0, 6),
      rows: table.rows.slice(0, 8),
      ...(caption ? { caption } : {}),
    };
  }
  if (bullets.length) {
    const visible = bullets.slice(0, 8);
    const extra = flattenBullets(bullets.slice(8));
    const extraHtml = flattenBulletsHtml(bullets.slice(8));
    const intro = bodyLines.join('\n');
    const introHtml = bodyLineHtmls.join('<br>');
    const outro = captionText(quote, extra.length ? `Additional: ${extra.join('; ')}` : '');
    const outroHtml = captionHtml(quoteHtml, extraHtml.length ? `Additional: ${extraHtml.join('; ')}` : '');
    return {
      type: 'cards',
      variant: 'markdown',
      title,
      cards: visible,
      ...(intro ? { intro } : {}),
      ...(introHtml && introHtml !== intro ? { introHtml } : {}),
      ...(outro ? { outro } : {}),
      ...(outroHtml && outroHtml !== outro ? { outroHtml } : {}),
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
      ...(meta.theme ? { theme: meta.theme } : {}),
    },
    scenes,
  };
  if (opts.comment) spec._comment = opts.comment;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  return spec;
}

module.exports = { convertMarkdownFile, splitSlides, stripFrontMatter };
