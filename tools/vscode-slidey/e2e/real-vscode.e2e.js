'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron } = require('playwright');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXT_ROOT = path.join(ROOT, 'tools', 'vscode-slidey');
const VSCODE_VERSION = process.env.SLIDEY_VSCODE_VERSION || '1.96.4';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freshDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null || /^VSCODE_/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function stageExtensionAssets() {
  const stagedDist = path.join(EXT_ROOT, '.slidey-dist');
  const stagedRuntime = path.join(EXT_ROOT, '.slidey-runtime', 'src');
  fs.rmSync(stagedDist, { recursive: true, force: true });
  fs.rmSync(path.join(EXT_ROOT, '.slidey-runtime'), { recursive: true, force: true });
  fs.mkdirSync(stagedDist, { recursive: true });
  fs.mkdirSync(stagedRuntime, { recursive: true });
  fs.cpSync(path.join(ROOT, 'dist'), stagedDist, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'schema.js'), path.join(stagedRuntime, 'schema.js'));
  fs.copyFileSync(path.join(ROOT, 'src', 'trace.js'), path.join(stagedRuntime, 'trace.js'));
}

async function launchVSCode(workspace, openFile) {
  const executablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);
  const userDataDir = freshDir('slidey-vscode-user-');
  const extensionsDir = freshDir('slidey-vscode-exts-');
  const args = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-telemetry',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${EXT_ROOT}`,
    workspace,
    openFile,
  ];

  const app = await _electron.launch({
    executablePath,
    args,
    env: cleanEnv(),
    timeout: 120_000,
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      if (await win.locator('.monaco-workbench').count().catch(() => 0)) {
        await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
        return { app, win, userDataDir, extensionsDir };
      }
    }
    await sleep(250);
  }
  await app.close().catch(() => undefined);
  throw new Error('VS Code workbench did not become ready');
}

async function commandPalette(win, command) {
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
  await win.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
  await win.keyboard.type(command);
  await win.waitForFunction((label) => document.body.innerText.includes(label), command, { timeout: 10_000 });
  await win.keyboard.press('Enter');
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
}

async function slideyFrame(win, timeout = 45_000) {
  await win.locator('iframe.webview').first().waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of win.frames()) {
      const hasSlidey = await frame.locator('.slidey-ref-open, .reference-frame, .slidey-loader').count().catch(() => 0);
      if (hasSlidey) return frame;
    }
    await sleep(250);
  }
  throw new Error('Slidey webview frame did not expose the deck UI');
}

async function openSlideyFrame(win) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await commandPalette(win, 'Slidey: Preview Deck or Replay');
    try {
      return await slideyFrame(win);
    } catch (err) {
      lastError = err;
      await win.keyboard.press('Escape').catch(() => undefined);
      await sleep(1000);
    }
  }
  throw lastError || new Error('Slidey preview did not open');
}

async function activeTabLabels(win) {
  return win.locator('.tabs-container .tab .label-name').evaluateAll((nodes) =>
    nodes.map((node) => node.textContent || '').filter(Boolean),
  );
}

test('real VS Code extension opens a spec-relative reference in the editor', async (t) => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    t.skip('dist/index.html missing; run npm run build:web first');
    return;
  }
  stageExtensionAssets();

  const workspace = freshDir('slidey-real-vscode-workspace-');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const deckDir = path.join(workspace, 'deck');
  fs.mkdirSync(deckDir, { recursive: true });
  const deckPath = path.join(deckDir, 'open-reference.slidey.json');
  const notesPath = path.join(deckDir, 'notes.md');
  fs.writeFileSync(notesPath, '# Notes\n\nReference opened from VS Code.\n', 'utf8');
  fs.writeFileSync(deckPath, JSON.stringify({
    scenes: [
      {
        type: 'reference',
        reference: {
          src: 'notes.md',
          label: 'Spec-relative notes',
          kind: 'markdown',
        },
      },
    ],
  }, null, 2), 'utf8');

  const launched = await launchVSCode(workspace, deckPath);
  t.after(async () => {
    await launched.app.close().catch(() => undefined);
    fs.rmSync(launched.userDataDir, { recursive: true, force: true });
    fs.rmSync(launched.extensionsDir, { recursive: true, force: true });
  });

  const frame = await openSlideyFrame(launched.win);
  await frame.locator('.reference-frame').waitFor({ state: 'visible', timeout: 30_000 });
  const bridgeState = await frame.evaluate(() => ({
    hasBridge: typeof window.slideyOpenReference === 'function',
    hasReferenceFrame: !!document.querySelector('.reference-frame'),
  }));
  assert.deepEqual(bridgeState, {
    hasBridge: true,
    hasReferenceFrame: true,
  });
  await frame.evaluate(() => {
    const original = window.slideyOpenReference;
    window.__slideyOpenPayloads = [];
    window.slideyOpenReference = (payload) => {
      window.__slideyOpenPayloads.push(payload);
      return original(payload);
    };
  });
  await frame.evaluate(() => window.slideyOpenReference({ src: 'deck/notes.md', kind: 'markdown' }));
  await sleep(500);
  const payloads = await frame.evaluate(() => window.__slideyOpenPayloads || []);
  assert.deepEqual(payloads.map(({ src, kind, lineStart, lineEnd }) => ({
    src,
    kind,
    ...(lineStart ? { lineStart } : {}),
    ...(lineEnd ? { lineEnd } : {}),
  })), [{ src: 'deck/notes.md', kind: 'markdown' }]);

  try {
    await launched.win.waitForFunction(() => {
      const labels = Array.from(document.querySelectorAll('.tabs-container .tab .label-name'))
        .map((node) => node.textContent || '');
      return labels.includes('notes.md');
    }, null, { timeout: 20_000 });
  } catch (err) {
    const state = await launched.win.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('.tabs-container .tab .label-name')).map((node) => node.textContent || ''),
      body: document.body.innerText.slice(0, 2000),
    }));
    throw new Error(`${err.message}\nstate=${JSON.stringify(state)}`);
  }

  const labels = await activeTabLabels(launched.win);
  assert.ok(labels.includes('notes.md'), `expected notes.md editor tab, got ${JSON.stringify(labels)}`);
  const editorText = await launched.win.locator('.monaco-editor').last().innerText({ timeout: 10_000 });
  assert.match(editorText.replace(/\u00a0/g, ' '), /Reference opened from VS Code/);
});
