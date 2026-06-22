#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const { launchOptions, doctor } = require('./browser');
const { validateSpec } = require('./validate');
const { SCHEMA } = require('./schema');
const { sceneShowOpts } = require('./assets');
const { auditSpec } = require('./audit');
const { runCheck } = require('./check');
const { estimateBoundaries } = require('./timing');

const ROOT_DIR = path.resolve(__dirname, '..');
const RENDER_BUNDLE = path.join(ROOT_DIR, 'dist-render', 'render.html');
const SPEC_EXT = new Set(['.json', '.jsonl']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-render', 'dist-web-single', '.git', '.worktrees']);

// MCP uses stdout for framed JSON-RPC. Keep every existing Slidey diagnostic off
// stdout so build/render logs cannot corrupt the protocol stream.
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

function parseArgs(argv) {
  const opts = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--root' || arg === '-r') && argv[i + 1]) {
      opts.root = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write([
        'slidey-mcp',
        '',
        'Usage:',
        '  slidey-mcp --root <workspace>',
        '',
        'Runs a stdio MCP server exposing Slidey viewing, editing, validation, and debugging tools.',
        '',
      ].join('\n'));
      process.exit(0);
    }
  }
  opts.root = path.resolve(opts.root);
  return opts;
}

const CONFIG = parseArgs(process.argv.slice(2));

function jsonText(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function okResult(value) {
  return { content: jsonText(value) };
}

function errorResult(message, details = null) {
  const payload = details ? { error: message, details } : { error: message };
  return { isError: true, content: jsonText(payload) };
}

function safeResolve(rel = '') {
  if (typeof rel !== 'string') throw new Error('path must be a string');
  const abs = path.resolve(CONFIG.root, '.' + path.sep + rel);
  const rootWithSep = CONFIG.root.endsWith(path.sep) ? CONFIG.root : CONFIG.root + path.sep;
  if (abs !== CONFIG.root && !abs.startsWith(rootWithSep)) {
    throw new Error(`path escapes workspace root: ${rel}`);
  }
  return abs;
}

function relPath(abs) {
  return path.relative(CONFIG.root, abs).replace(/\\/g, '/');
}

function requireSpecPath(inputPath) {
  const abs = safeResolve(inputPath || '');
  if (!fs.existsSync(abs)) throw new Error(`spec not found: ${inputPath}`);
  if (!fs.statSync(abs).isFile()) throw new Error(`not a file: ${inputPath}`);
  if (!SPEC_EXT.has(path.extname(abs).toLowerCase())) {
    throw new Error(`expected a .json or .jsonl spec: ${inputPath}`);
  }
  return abs;
}

function readSpecFile(inputPath) {
  const abs = requireSpecPath(inputPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const spec = /\.jsonl$/i.test(abs) ? require('./trace').buildSpecFromFile(abs) : JSON.parse(raw);
  return { abs, raw, spec, generated: /\.jsonl$/i.test(abs) };
}

function writeSpecFile(inputPath, spec) {
  const abs = requireSpecPath(inputPath);
  if (!/\.json$/i.test(abs)) throw new Error('only .json specs can be edited; .jsonl traces are generated read-only inputs');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('spec must be a JSON object');
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) throw new Error('spec must have a non-empty "scenes" array');
  const body = JSON.stringify(spec, null, 2) + '\n';
  fs.writeFileSync(abs, body, 'utf8');
  return { path: relPath(abs), bytes: Buffer.byteLength(body), mtimeMs: fs.statSync(abs).mtimeMs };
}

function buildTree(absDir, relDir = '') {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childAbs = path.join(absDir, entry.name);
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const children = buildTree(childAbs, childRel);
      if (children.length) dirs.push({ name: entry.name, type: 'dir', path: childRel, children });
    } else if (entry.isFile() && SPEC_EXT.has(path.extname(entry.name).toLowerCase())) {
      files.push({ name: entry.name, type: 'file', path: childRel, editable: /\.json$/i.test(entry.name) });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return [...dirs.sort(byName), ...files.sort(byName)];
}

function pointerParts(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function parentForPointer(doc, pointer) {
  const parts = pointerParts(pointer);
  if (parts.length === 0) return { parent: null, key: null };
  let parent = doc;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const idx = part === '-' ? parent.length : Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) throw new Error(`array index not found in pointer: ${pointer}`);
      parent = parent[idx];
    } else if (parent && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, part)) {
      parent = parent[part];
    } else {
      throw new Error(`object key not found in pointer: ${pointer}`);
    }
  }
  return { parent, key: parts[parts.length - 1] };
}

function getPointer(doc, pointer) {
  let node = doc;
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(node)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) throw new Error(`array index not found in pointer: ${pointer}`);
      node = node[idx];
    } else if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, part)) {
      node = node[part];
    } else {
      throw new Error(`object key not found in pointer: ${pointer}`);
    }
  }
  return node;
}

function applyJsonPatch(doc, operations) {
  if (!Array.isArray(operations)) throw new Error('operations must be an array');
  const target = structuredClone(doc);
  for (const op of operations) {
    if (!op || typeof op !== 'object') throw new Error('each patch operation must be an object');
    const { parent, key } = parentForPointer(target, op.path);
    if (op.op === 'test') {
      const actual = getPointer(target, op.path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`);
      continue;
    }
    if (parent === null) {
      if (op.op === 'replace') return op.value;
      throw new Error(`operation ${op.op} is not supported at the document root`);
    }
    if (Array.isArray(parent)) {
      const idx = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new Error(`invalid array index in pointer: ${op.path}`);
      if (op.op === 'add') parent.splice(idx, 0, op.value);
      else if (op.op === 'replace') {
        if (idx >= parent.length) throw new Error(`array index not found in pointer: ${op.path}`);
        parent[idx] = op.value;
      } else if (op.op === 'remove') {
        if (idx >= parent.length) throw new Error(`array index not found in pointer: ${op.path}`);
        parent.splice(idx, 1);
      } else {
        throw new Error(`unsupported patch op: ${op.op}`);
      }
    } else if (parent && typeof parent === 'object') {
      if (op.op === 'add' || op.op === 'replace') {
        if (op.op === 'replace' && !Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`object key not found in pointer: ${op.path}`);
        parent[key] = op.value;
      } else if (op.op === 'remove') {
        if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`object key not found in pointer: ${op.path}`);
        delete parent[key];
      } else {
        throw new Error(`unsupported patch op: ${op.op}`);
      }
    } else {
      throw new Error(`cannot patch through non-container at ${op.path}`);
    }
  }
  return target;
}

async function loadRenderPage(spec, specPath, sceneIndex, stepIndex) {
  require('./render-bundle').ensureRenderBundle();
  const { stepsForScene, applyShow } = await import(pathToFileURL(path.join(ROOT_DIR, 'web', 'sceneSteps.mjs')).href);
  const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
    throw new Error(`sceneIndex must be between 0 and ${Math.max(0, scenes.length - 1)}`);
  }
  const scene = scenes[sceneIndex];
  const steps = stepsForScene(scene);
  const pageSteps = steps.length ? steps : [null];
  const resolvedStepIndex = stepIndex == null ? pageSteps.length - 1 : stepIndex;
  if (!Number.isInteger(resolvedStepIndex) || resolvedStepIndex < 0 || resolvedStepIndex >= pageSteps.length) {
    throw new Error(`stepIndex must be between 0 and ${pageSteps.length - 1} for scene ${sceneIndex}`);
  }

  const { width = 1920, height = 1080 } = (spec.meta && spec.meta.resolution) || {};
  const mode = (spec.meta && spec.meta.mode) || 'api';
  const browser = await puppeteer.launch(launchOptions({ width, height }));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_BUNDLE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__slideyReady === true', { timeout: 15000 });
    await page.emulateMediaType('screen');
    await page.evaluate((meta, m) => {
      window.slidey.setMeta(meta);
      window.slidey.setMode(m);
      document.body.classList.add('instant');
    }, spec.meta || {}, mode);
    await page.evaluate(applyShow, scene, sceneShowOpts(scene, specPath));
    const step = pageSteps[resolvedStepIndex];
    if (step) await page.evaluate((s) => window.slidey.setState(s), step);
    await page.evaluate('window.__slideySettle && window.__slideySettle()');
    return { browser, page, scene, step, steps: pageSteps, width, height, sceneIndex, stepIndex: resolvedStepIndex };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

async function renderPng(args) {
  const { abs, spec } = readSpecFile(args.path);
  const session = await loadRenderPage(spec, abs, args.sceneIndex, args.stepIndex);
  try {
    const data = await session.page.screenshot({ type: 'png', encoding: 'base64' });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: args.path,
            sceneIndex: session.sceneIndex,
            stepIndex: session.stepIndex,
            step: session.step,
            steps: session.steps,
            width: session.width,
            height: session.height,
          }, null, 2),
        },
        { type: 'image', mimeType: 'image/png', data },
      ],
    };
  } finally {
    await session.browser.close();
  }
}

async function renderHtml(args) {
  const { abs, spec } = readSpecFile(args.path);
  const session = await loadRenderPage(spec, abs, args.sceneIndex, args.stepIndex);
  try {
    const html = await session.page.evaluate(() => {
      const root = document.getElementById('root') || document.body;
      const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]'))
        .map((node) => node.outerHTML)
        .join('\n');
      return [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        styles,
        '</head>',
        `<body class="${document.body.className}">`,
        root.outerHTML,
        '</body>',
        '</html>',
      ].join('\n');
    });
    return okResult({
      path: args.path,
      sceneIndex: session.sceneIndex,
      stepIndex: session.stepIndex,
      step: session.step,
      steps: session.steps,
      html,
    });
  } finally {
    await session.browser.close();
  }
}

function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const value = fn();
    return { value, output: lines.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function toolInputSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

const TOOLS = [
  {
    name: 'slidey_workspace_tree',
    description: 'List editable Slidey .json specs and generated .jsonl trace specs under the MCP workspace root.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_read_spec',
    description: 'Read a Slidey spec. .jsonl traces are converted to generated specs and returned read-only.',
    inputSchema: toolInputSchema({
      path: { type: 'string', description: 'Workspace-relative .json or .jsonl path.' },
    }, ['path']),
  },
  {
    name: 'slidey_write_spec',
    description: 'Replace an editable .json Slidey spec with a full JSON object.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      spec: { type: 'object' },
    }, ['path', 'spec']),
  },
  {
    name: 'slidey_patch_spec',
    description: 'Edit an editable .json spec with JSON Patch operations: add, replace, remove, and test.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['op', 'path'],
          properties: {
            op: { enum: ['add', 'replace', 'remove', 'test'] },
            path: { type: 'string', description: 'JSON Pointer, e.g. /scenes/0/title.' },
            value: {},
          },
        },
      },
    }, ['path', 'operations']),
  },
  {
    name: 'slidey_validate',
    description: 'Validate a spec against Slidey JSON Schema and semantic checks. Returns structured errors and warnings.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_scene_summary',
    description: 'Return scene indices, types, titles, reveal steps, estimated timing, and narration snippets.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      fps: { type: 'number', default: 30 },
    }, ['path']),
  },
  {
    name: 'slidey_render_png',
    description: 'Render a particular scene/reveal step as a PNG image using the real Slidey Vue render bundle.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0 },
      stepIndex: { type: 'integer', minimum: 0, description: 'Reveal step index. Omit for final step of the scene.' },
    }, ['path', 'sceneIndex']),
  },
  {
    name: 'slidey_render_html',
    description: 'Render a particular scene/reveal step and return the HTML snapshot of the rendered slide.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0 },
      stepIndex: { type: 'integer', minimum: 0, description: 'Reveal step index. Omit for final step of the scene.' },
    }, ['path', 'sceneIndex']),
  },
  {
    name: 'slidey_check',
    description: 'Run Slidey static diagram-svg geometry checks and return the report.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
    }, ['path']),
  },
  {
    name: 'slidey_audit',
    description: 'Run the browser-based rendered geometry audit. This catches off-page content, overflow, overlap, tiny text, contrast, broken images, and template leaks.',
    inputSchema: toolInputSchema({
      path: { type: 'string' },
      sceneIndex: { type: 'integer', minimum: 0, description: 'Optional single scene to audit.' },
    }, ['path']),
  },
  {
    name: 'slidey_schema',
    description: 'Return the authoritative Slidey JSON Schema used by validation and the editor.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_docs',
    description: 'Return the bundled LLM authoring guide for Slidey specs.',
    inputSchema: toolInputSchema({}),
  },
  {
    name: 'slidey_doctor',
    description: 'Verify headless Chrome can launch and take a screenshot for Slidey rendering tools.',
    inputSchema: toolInputSchema({}),
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'slidey_workspace_tree':
      return okResult({ root: CONFIG.root, children: buildTree(CONFIG.root) });

    case 'slidey_read_spec': {
      const { abs, raw, spec, generated } = readSpecFile(args.path);
      return okResult({ path: relPath(abs), generated, editable: !generated, raw: generated ? undefined : raw, spec });
    }

    case 'slidey_write_spec': {
      const written = writeSpecFile(args.path, args.spec);
      const validation = validateSpec(args.spec, { specPath: safeResolve(args.path) });
      return okResult({ ok: validation.valid, written, validation });
    }

    case 'slidey_patch_spec': {
      const { abs, spec } = readSpecFile(args.path);
      if (!/\.json$/i.test(abs)) throw new Error('only .json specs can be edited; .jsonl traces are generated read-only inputs');
      const patched = applyJsonPatch(spec, args.operations);
      const written = writeSpecFile(args.path, patched);
      const validation = validateSpec(patched, { specPath: abs });
      return okResult({ ok: validation.valid, written, validation, spec: patched });
    }

    case 'slidey_validate': {
      const { abs, spec, generated } = readSpecFile(args.path);
      return okResult({ path: relPath(abs), generated, ...validateSpec(spec, { specPath: abs }) });
    }

    case 'slidey_scene_summary': {
      const { abs, spec } = readSpecFile(args.path);
      const { stepsForScene } = await import(pathToFileURL(path.join(ROOT_DIR, 'web', 'sceneSteps.mjs')).href);
      const fps = args.fps || 30;
      const boundaries = estimateBoundaries(spec, null, { specPath: abs });
      return okResult({
        path: relPath(abs),
        fps,
        sceneCount: Array.isArray(spec.scenes) ? spec.scenes.length : 0,
        scenes: (spec.scenes || []).map((scene, i) => {
          const steps = stepsForScene(scene);
          const boundary = boundaries.find((b) => b.sceneIndex === i);
          const narration = Array.isArray(scene.narration)
            ? scene.narration.map((cue) => cue && cue.text).filter(Boolean).join(' ')
            : (scene.narration || '');
          return {
            sceneIndex: i,
            type: scene.type,
            title: scene.title || scene.headline || scene.eyebrow || null,
            stepCount: steps.length || 1,
            steps: steps.length ? steps : [null],
            startSeconds: boundary ? Number((boundary.startFrame / fps).toFixed(3)) : null,
            durationSeconds: boundary ? Number((boundary.durationFrames / fps).toFixed(3)) : null,
            narration: narration ? String(narration).slice(0, 240) : null,
          };
        }),
      });
    }

    case 'slidey_render_png':
      return await renderPng(args);

    case 'slidey_render_html':
      return await renderHtml(args);

    case 'slidey_check': {
      const { spec } = readSpecFile(args.path);
      const { value, output } = captureConsole(() => runCheck(spec));
      return okResult({ path: args.path, violations: value, output });
    }

    case 'slidey_audit': {
      const { abs, spec } = readSpecFile(args.path);
      const selectedScenes = Number.isInteger(args.sceneIndex) ? new Set([args.sceneIndex]) : null;
      const report = await auditSpec(spec, { specPath: abs, selectedScenes });
      return okResult({ path: relPath(abs), ...report });
    }

    case 'slidey_schema':
      return okResult(SCHEMA);

    case 'slidey_docs': {
      const guide = path.join(ROOT_DIR, '.claude', 'skills', 'slidey-authoring', 'SKILL.md');
      let body = fs.readFileSync(guide, 'utf8');
      body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
      return okResult(body);
    }

    case 'slidey_doctor':
      return okResult(await doctor());

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function listResources() {
  return [
    {
      uri: 'slidey://schema',
      name: 'Slidey JSON Schema',
      description: 'Authoritative JSON Schema for Slidey specs.',
      mimeType: 'application/json',
    },
    {
      uri: 'slidey://docs',
      name: 'Slidey Authoring Guide',
      description: 'Bundled LLM-facing guide for authoring and debugging Slidey presentations.',
      mimeType: 'text/markdown',
    },
  ];
}

function readResource(uri) {
  if (uri === 'slidey://schema') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(SCHEMA, null, 2) }],
    };
  }
  if (uri === 'slidey://docs') {
    const guide = path.join(ROOT_DIR, '.claude', 'skills', 'slidey-authoring', 'SKILL.md');
    let body = fs.readFileSync(guide, 'utf8');
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: body }],
    };
  }
  throw new Error(`unknown resource: ${uri}`);
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null;
  try {
    let result;
    if (method === 'initialize') {
      result = {
        protocolVersion: params.protocolVersion || '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'slidey-mcp', version: '1.0.0' },
      };
    } else if (method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (method === 'tools/call') {
      try {
        result = await callTool(params.name, params.arguments || {});
      } catch (err) {
        result = errorResult(err && err.message ? err.message : String(err));
      }
    } else if (method === 'resources/list') {
      result = { resources: listResources() };
    } else if (method === 'resources/read') {
      result = readResource(params.uri);
    } else {
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
    }
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: err.code || -32000,
        message: err && err.message ? err.message : String(err),
      },
    };
  }
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      process.stderr.write('[slidey-mcp] missing Content-Length header\n');
      process.exit(1);
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const raw = buffer.slice(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.slice(bodyStart + length);
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } });
      continue;
    }
    if (message.id === undefined || message.id === null) continue;
    const response = await handleRequest(message);
    if (response) writeMessage(response);
  }
});

process.stdin.resume();
