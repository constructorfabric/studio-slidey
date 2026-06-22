'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { convertDrawioFile, extractDrawioXmlFromPng, renderDrawioSvg } = require('../src/drawio');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function drawioPng(xml) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const text = Buffer.from(`mxfile\0${encodeURIComponent(xml)}`, 'utf8');
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('tEXt', text), pngChunk('IEND', Buffer.alloc(0))]);
}

const XML = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hello&lt;br&gt;Draw.io" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#666666;" parent="1" vertex="1"><mxGeometry x="10" y="20" width="120" height="50" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';

test('extractDrawioXmlFromPng reads the embedded mxfile text chunk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-drawio-'));
  const png = path.join(dir, 'diagram.drawio.png');
  fs.writeFileSync(png, drawioPng(XML));
  assert.equal(extractDrawioXmlFromPng(png), XML);
});

test('renderDrawioSvg converts Draw.io XML to themed SVG text and shapes', () => {
  const { svg, stats } = renderDrawioSvg(XML);
  assert.match(svg, /<svg /);
  assert.match(svg, /Hello/);
  assert.match(svg, /Draw\.io/);
  assert.equal(stats.vertices, 1);
  assert.equal(stats.edges, 0);
});

test('convertDrawioFile writes SVG and extracted XML for PNG inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-drawio-'));
  const png = path.join(dir, 'diagram.drawio.png');
  const outDir = path.join(dir, 'svg');
  const extractDir = path.join(dir, 'xml');
  fs.writeFileSync(png, drawioPng(XML));
  const result = convertDrawioFile(png, { outDir, extractDir });
  assert.equal(result.svgPath, path.join(outDir, 'diagram.svg'));
  assert.equal(result.xmlPath, path.join(extractDir, 'diagram.drawio.xml'));
  assert.match(fs.readFileSync(result.svgPath, 'utf8'), /Hello/);
  assert.equal(fs.readFileSync(result.xmlPath, 'utf8').trim(), XML);
});
