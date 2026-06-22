'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodeXml(s = '') {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(s, name) {
  const m = s.match(new RegExp(name + '="([^"]*)"'));
  return m ? decodeXml(m[1]) : undefined;
}

function parseStyle(style = '') {
  const out = {};
  for (const part of style.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

function cleanText(value = '') {
  let s = decodeXml(value);
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/?(div|p|h1|h2)[^>]*>/gi, m => /<\//.test(m) ? '\n' : '');
  s = s.replace(/<\/?(span|font|b|strong|meta)[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\u00a0|&nbsp;/g, ' ');
  s = decodeXml(s);
  s = s.replace(/\s+\S*\]:pointer-events-auto\s+[^"\n]*">\s*/g, '\n');
  return s.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const THEMES = {
  'rose-pine-moon': {
    background: '#252238',
    stroke: '#8f89a8',
    border: '#6e6788',
    text: '#f2eefc',
    textOnAccent: '#fffaf3',
    label: '#c4a7e7',
    colors: {
      '#ffffff': '#2a273f',
      '#f8f2f8': '#332d41',
      '#f8f2e8': '#332d41',
      '#f5f5f5': '#343146',
      '#dae8fc': '#343146',
      '#e1d5e7': '#343146',
      '#e6e6e6': '#343146',
      '#ced3de': '#3a4058',
      '#d5e8d4': '#3a4058',
      '#264074': '#3e68b0',
      '#da8d29': '#d28a36',
      '#b70e5d': '#eb6f92',
      '#c0005a': '#eb6f92',
      '#000000': '#343146',
      '#333333': '#343146',
      '#4d4d4d': '#343146',
      '#666666': '#343146',
      '#969cb0': '#343146',
      '#cccccc': '#343146',
    },
  },
};

function theme(name = 'rose-pine-moon') {
  return THEMES[name] || THEMES['rose-pine-moon'];
}

function themedColor(t, fill, kind) {
  const c = (fill || '').toLowerCase();
  if (!fill || c === 'none') return kind === 'fill' ? 'transparent' : t.stroke;
  if (t.colors[c]) return kind === 'stroke' && ['#000000', '#333333', '#4d4d4d', '#666666', '#969cb0', '#cccccc'].includes(c) ? t.stroke : t.colors[c];
  return fill;
}

function textColor(t, style) {
  const fill = (style.fillColor || '').toLowerCase();
  if (fill === '#264074' || fill === '#da8d29' || fill === '#b70e5d' || fill === '#c0005a') return t.textOnAccent;
  return t.text;
}

function fontSize(style, w, h, text, textOnly) {
  if (textOnly) {
    if (/Each gear encapsulates/i.test(text)) return 9;
    if (w < 90 || h < 24) return 8;
    return 10;
  }
  if (style.fontSize) return Math.max(8, Math.min(13, Number(style.fontSize) || 11));
  if (h <= 20) return 8;
  if (h <= 30) return 9;
  if (h <= 45 && w < 80) return 8;
  if (h <= 45) return 10;
  if (h >= 100 && /architecture|encapsulates|contracts/i.test(text)) return 9;
  return 10;
}

function parseCells(xml) {
  const cells = [];
  const re = /<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const style = parseStyle(attr(attrs, 'style') || '');
    const geom = body.match(/<mxGeometry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxGeometry>)/);
    const gattrs = geom ? geom[1] : '';
    const gbody = geom ? geom[2] || '' : '';
    const points = [...gbody.matchAll(/<mxPoint\b([^>]*?)\/>/g)]
      .map(p => ({ x: Number(attr(p[1], 'x') || 0), y: Number(attr(p[1], 'y') || 0), as: attr(p[1], 'as') || '' }));
    const offset = gbody.match(/<mxPoint\b([^>]*?)as="offset"[^>]*\/>/);
    cells.push({
      id: attr(attrs, 'id'), parent: attr(attrs, 'parent'), source: attr(attrs, 'source'), target: attr(attrs, 'target'),
      vertex: attr(attrs, 'vertex') === '1', edge: attr(attrs, 'edge') === '1', connectable: attr(attrs, 'connectable'),
      value: cleanText(attr(attrs, 'value') || ''), style,
      x: Number(attr(gattrs, 'x') || 0), y: Number(attr(gattrs, 'y') || 0),
      w: Number(attr(gattrs, 'width') || 0), h: Number(attr(gattrs, 'height') || 0), points,
      offset: offset ? { x: Number(attr(offset[1], 'x') || 0), y: Number(attr(offset[1], 'y') || 0) } : null,
    });
  }
  return cells;
}

function applyAbsolute(cells) {
  const byId = new Map(cells.map(c => [c.id, c]));
  const memo = new Map();
  function off(c) {
    if (!c || c.parent === '1' || !byId.has(c.parent)) return { x: 0, y: 0 };
    if (memo.has(c.id)) return memo.get(c.id);
    const p = byId.get(c.parent);
    const po = off(p);
    const value = p.vertex ? { x: po.x + p.x, y: po.y + p.y } : po;
    memo.set(c.id, value);
    return value;
  }
  for (const c of cells) {
    const o = off(c);
    c.ax = c.x + o.x;
    c.ay = c.y + o.y;
    c.apoints = c.points.map(p => ({ ...p, x: p.x + o.x, y: p.y + o.y }));
  }
  return byId;
}

function bounds(cells) {
  const verts = cells.filter(c => c.vertex && c.w > 0 && c.h > 0 && c.style.shape !== 'icon');
  if (!verts.length) throw new Error('Draw.io XML does not contain drawable vertices');
  const minX = Math.min(...verts.map(v => v.ax));
  const minY = Math.min(...verts.map(v => v.ay));
  const maxX = Math.max(...verts.map(v => v.ax + v.w));
  const maxY = Math.max(...verts.map(v => v.ay + v.h));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function center(v) { return { x: v.ax + v.w / 2, y: v.ay + v.h / 2 }; }

function boundaryPoint(v, toward) {
  const c = center(v);
  if (!toward) return c;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const sx = v.w ? Math.abs(dx) / (v.w / 2) : Infinity;
  const sy = v.h ? Math.abs(dy) / (v.h / 2) : Infinity;
  const scale = 1 / Math.max(sx, sy);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function edgePoints(edge, byId) {
  const pts = [];
  const sourcePoint = edge.apoints.find(p => p.as === 'sourcePoint');
  const targetPoint = edge.apoints.find(p => p.as === 'targetPoint');
  const waypoints = edge.apoints.filter(p => !p.as);
  const source = edge.source && byId.get(edge.source) ? byId.get(edge.source) : null;
  const target = edge.target && byId.get(edge.target) ? byId.get(edge.target) : null;
  if (sourcePoint) pts.push(sourcePoint);
  else if (source) {
    const toward = waypoints[0] || (targetPoint || (target ? center(target) : null));
    pts.push(boundaryPoint(source, toward));
  }
  if (!waypoints.length && edge.style.edgeStyle === 'orthogonalEdgeStyle' && source && target) {
    const start = pts[0] || boundaryPoint(source, center(target));
    const end = targetPoint || boundaryPoint(target, start);
    if (Math.abs(start.x - end.x) > 1 && Math.abs(start.y - end.y) > 1) {
      const midX = start.x + (end.x - start.x) / 2;
      pts.push({ x: midX, y: start.y }, { x: midX, y: end.y });
    }
  }
  for (const p of waypoints) pts.push(p);
  if (targetPoint) pts.push(targetPoint);
  else if (target) {
    const toward = waypoints[waypoints.length - 1] || pts[pts.length - 1] || (source ? center(source) : null);
    pts.push(boundaryPoint(target, toward));
  }
  return pts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function pathMidpoint(pts) {
  if (pts.length === 1) return pts[0];
  const lengths = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(len);
    total += len;
  }
  let remain = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const len = lengths[i - 1];
    if (remain <= len) {
      const a = pts[i - 1], b = pts[i];
      const t = len ? remain / len : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remain -= len;
  }
  return pts[pts.length - 1];
}

function lineWrap(text, w, fs) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    const max = Math.max(6, Math.floor(w / (fs * 0.58)));
    for (const word of words) {
      if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function renderTextAt(text, x, y, w, h, fs, fill, bold, align = 'middle', rotate = 0) {
  const lines = lineWrap(text, w, fs).slice(0, Math.max(1, Math.floor(h / (fs * 1.15))));
  const lh = fs * 1.16;
  const tx = align === 'start' ? x : x + w / 2;
  const start = y + h / 2 - (lines.length - 1) * lh / 2 + fs * 0.35;
  const transform = rotate ? ` transform="rotate(${rotate} ${tx} ${start})"` : '';
  return `<text x="${tx}" y="${start}" text-anchor="${align}" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${fs}" font-weight="${bold ? 700 : 500}" fill="${fill}"${transform}>${lines.map((l, i) => `<tspan x="${tx}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
}

function renderVertex(c, t) {
  if (c.style.shape === 'icon') return '';
  const st = c.style;
  const fill = themedColor(t, st.fillColor, 'fill');
  const stroke = themedColor(t, st.strokeColor || '#666666', 'stroke');
  const dash = st.dashed === '1' ? ' stroke-dasharray="5 4"' : '';
  const sw = st.strokeColor === 'none' ? 0 : 1.4;
  const text = c.value;
  const textOnly = (st.strokeColor === 'none' && st.fillColor === 'none') || st.text === '1';
  const fs = fontSize(st, c.w, c.h, text, textOnly || st.rounded === '0' && st.fillColor === 'none');
  const bold = st.fontStyle === '1' || /^Gear #|Gears w|Gear with|API gateway|Toolkit Libraries/.test(text);
  const tc = textColor(t, st);
  const x = c.ax, y = c.ay;
  if (st.strokeColor === 'none' && st.fillColor === 'none') return text ? renderTextAt(text, x, y, c.w, c.h, fs, tc, bold) : '';
  if (st.shape && st.shape.startsWith('cylinder')) {
    const ry = Math.min(14, c.h * 0.18);
    return `<g><path d="M${x},${y + ry} C${x},${y - ry/2} ${x + c.w},${y - ry/2} ${x + c.w},${y + ry} L${x + c.w},${y + c.h - ry} C${x + c.w},${y + c.h + ry/2} ${x},${y + c.h + ry/2} ${x},${y + c.h - ry} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><ellipse cx="${x + c.w/2}" cy="${y + ry}" rx="${c.w/2}" ry="${ry}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>${text ? renderTextAt(text, x, y, c.w, c.h, fs, tc, bold) : ''}</g>`;
  }
  if ((st.fillColor === 'none' || fill === 'transparent') && !text) return `<rect x="${x}" y="${y}" width="${c.w}" height="${c.h}" rx="${st.rounded === '1' ? 8 : 0}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  return `<g><rect x="${x}" y="${y}" width="${c.w}" height="${c.h}" rx="${st.rounded === '1' ? Math.min(10, Math.max(3, c.h * 0.12)) : 0}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>${text ? renderTextAt(text, x, y, c.w, c.h, fs, tc, bold) : ''}</g>`;
}

function renderEdgeLabel(c, byId, t) {
  if (!c.value || c.w || c.h || !byId.has(c.parent)) return '';
  const edge = byId.get(c.parent);
  const pts = edgePoints(edge, byId);
  if (pts.length < 2) return '';
  const mid = pathMidpoint(pts);
  const rotate = Number(c.style.rotation || 0);
  const x = mid.x + (c.offset?.x || 6);
  const y = mid.y + (c.offset?.y || 0) + (rotate ? 0 : -25);
  return renderTextAt(c.value, x, y, rotate ? 78 : 170, rotate ? 20 : 58, 9, t.text, true, rotate ? 'middle' : 'start', rotate);
}

function renderDrawioSvg(xml, options = {}) {
  const t = theme(options.theme);
  const cells = parseCells(xml);
  const byId = applyAbsolute(cells);
  const b = bounds(cells);
  const pad = Number.isFinite(options.pad) ? options.pad : 18;
  const body = [];
  body.push(`<rect x="${b.minX - pad}" y="${b.minY - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" rx="10" fill="${t.background}" stroke="${t.border}" stroke-width="1.5"/>`);
  for (const c of cells.filter(c => c.edge)) {
    const pts = edgePoints(c, byId);
    if (pts.length < 2) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
    const stroke = themedColor(t, c.style.strokeColor || t.stroke, 'stroke');
    const dash = c.style.dashed === '1' ? ' stroke-dasharray="5 5"' : '';
    const marker = c.style.endArrow === 'none' ? '' : ' marker-end="url(#arrow)"';
    body.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.2"${dash}${marker}/>`);
  }
  for (const c of cells.filter(c => c.vertex && c.w > 0 && c.h > 0)) body.push(renderVertex(c, t));
  for (const c of cells.filter(c => c.vertex && c.value && (!c.w || !c.h))) {
    const label = renderEdgeLabel(c, byId, t);
    if (label) body.push(label);
    else if (c.parent === '1') body.push(renderTextAt(c.value, c.ax, c.ay, 150, 24, 8, t.label, true, 'start'));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${b.w + pad * 2} ${b.h + pad * 2}" role="img" aria-label="${esc(options.label || 'Draw.io diagram')}">
  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="${t.label}"/></marker></defs>
  ${body.join('\n  ')}
</svg>\n`;
  return {
    svg,
    stats: {
      vertices: cells.filter(c => c.vertex).length,
      edges: cells.filter(c => c.edge).length,
      viewBox: [b.minX - pad, b.minY - pad, b.w + pad * 2, b.h + pad * 2],
    },
  };
}

function decodeMxfilePayload(payload) {
  const raw = payload.trim();
  try {
    if (raw.startsWith('%3C') || raw.includes('%3Cmxfile')) return decodeURIComponent(raw);
  } catch (_) {}
  return raw;
}

function extractDrawioXmlFromPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || buf.toString('latin1', 1, 4) !== 'PNG') {
    throw new Error(`not a PNG file: ${file}`);
  }
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      const key = nul >= 0 ? data.slice(0, nul).toString('latin1') : '';
      if (key === 'mxfile') return decodeMxfilePayload(data.slice(nul + 1).toString('utf8'));
    } else if (type === 'zTXt') {
      const nul = data.indexOf(0);
      const key = nul >= 0 ? data.slice(0, nul).toString('latin1') : '';
      if (key === 'mxfile') return decodeMxfilePayload(zlib.inflateSync(data.slice(nul + 2)).toString('utf8'));
    } else if (type === 'iTXt') {
      const nul = data.indexOf(0);
      const key = nul >= 0 ? data.slice(0, nul).toString('latin1') : '';
      if (key === 'mxfile') {
        const compressionFlag = data[nul + 1];
        const compressionMethod = data[nul + 2];
        if (compressionFlag && compressionMethod !== 0) throw new Error(`unsupported PNG iTXt compression method in ${file}`);
        let pos = nul + 3;
        const languageEnd = data.indexOf(0, pos);
        if (languageEnd < 0) continue;
        pos = languageEnd + 1;
        const translatedEnd = data.indexOf(0, pos);
        if (translatedEnd < 0) continue;
        pos = translatedEnd + 1;
        const textData = data.slice(pos);
        const text = compressionFlag ? zlib.inflateSync(textData).toString('utf8') : textData.toString('utf8');
        return decodeMxfilePayload(text);
      }
    }
    off += 12 + len;
  }
  throw new Error(`PNG does not contain a Draw.io mxfile chunk: ${file}`);
}

function loadDrawioXml(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return extractDrawioXmlFromPng(file);
  const xml = fs.readFileSync(file, 'utf8');
  if (!/<mxfile\b|<mxGraphModel\b/.test(xml)) throw new Error(`not a Draw.io XML file: ${file}`);
  return xml;
}

function outputBaseName(input) {
  const name = path.basename(input)
    .replace(/\.drawio\.png$/i, '')
    .replace(/\.drawio\.xml$/i, '')
    .replace(/\.png$/i, '')
    .replace(/\.xml$/i, '');
  return name || 'diagram';
}

function convertDrawioFile(input, options = {}) {
  const xml = loadDrawioXml(input);
  const base = options.name || outputBaseName(input);
  const { svg, stats } = renderDrawioSvg(xml, { ...options, label: options.label || base });
  const outDir = path.resolve(options.outDir || path.dirname(input));
  fs.mkdirSync(outDir, { recursive: true });
  const svgPath = path.join(outDir, `${base}.svg`);
  fs.writeFileSync(svgPath, svg);
  let xmlPath = null;
  if (options.extractDir) {
    const dir = path.resolve(options.extractDir);
    fs.mkdirSync(dir, { recursive: true });
    xmlPath = path.join(dir, `${base}.drawio.xml`);
    fs.writeFileSync(xmlPath, xml.endsWith('\n') ? xml : xml + '\n');
  }
  return { input, svgPath, xmlPath, stats };
}

module.exports = {
  convertDrawioFile,
  extractDrawioXmlFromPng,
  loadDrawioXml,
  outputBaseName,
  renderDrawioSvg,
};
