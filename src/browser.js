'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LAUNCH_TIMEOUT_MS = 10000;
const DEFAULT_CLOSE_TIMEOUT_MS = 3000;

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      // Keep looking.
    }
  }
  return null;
}

function newestExecutableUnder(root, executableName) {
  if (!root || !fs.existsSync(root)) return null;
  const matches = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name === executableName) {
        try {
          fs.accessSync(abs, fs.constants.X_OK);
          matches.push({ abs, mtimeMs: fs.statSync(abs).mtimeMs });
        } catch (_) {
          // Keep looking.
        }
      }
    }
  };
  walk(root);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0] ? matches[0].abs : null;
}

function managedHeadlessShellPath() {
  const cacheRoots = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(os.homedir(), '.cache', 'puppeteer'),
    path.join(os.homedir(), 'Library', 'Caches', 'puppeteer'),
  ].filter(Boolean);

  for (const root of cacheRoots) {
    const executable = newestExecutableUnder(path.join(root, 'chrome-headless-shell'), 'chrome-headless-shell');
    if (executable) return executable;
  }
  return null;
}

function explicitChromePath() {
  return process.env.SLIDEY_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || null;
}

function defaultChromePath() {
  const envPath = explicitChromePath();
  if (envPath) return envPath;

  if (process.env.SLIDEY_USE_MANAGED_HEADLESS_SHELL === '1') {
    const headlessShell = managedHeadlessShellPath();
    if (headlessShell) return headlessShell;
  }

  if (process.platform === 'darwin') {
    const systemChrome = firstExecutable([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
    if (systemChrome) return systemChrome;
  }

  return null;
}

function browserExecutableError(executablePath = defaultChromePath()) {
  if (!executablePath) return null;
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
    return null;
  } catch (err) {
    const code = err && err.code ? err.code : String(err);
    return `browser executable is not available: ${executablePath} (${code})`;
  }
}

function chromeArgs(width, height, extra = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-chrome-profile-'));
  const crash = fs.mkdtempSync(path.join(os.tmpdir(), 'slidey-chrome-crash-'));
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    `--crash-dumps-dir=${crash}`,
    ...(width && height ? [`--window-size=${width},${height}`] : []),
    ...extra,
  ];
}

function launchOptions(opts = {}) {
  const { width, height, args = [], pipe = true, timeout = DEFAULT_LAUNCH_TIMEOUT_MS } = opts;
  const executablePath = defaultChromePath();
  const options = {
    headless: 'new',
    pipe,
    timeout,
    args: chromeArgs(width, height, args),
  };
  if (executablePath) options.executablePath = executablePath;
  return options;
}

async function closeBrowser(browser, timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS) {
  if (!browser) return;
  const proc = browser.process && browser.process();
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`browser close timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  } catch (_) {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  }
}

async function doctor(opts = {}) {
  const puppeteer = require('puppeteer');
  const { width = 320, height = 180 } = opts;
  const executablePath = defaultChromePath();
  let browser;
  const executableError = browserExecutableError(executablePath);
  if (executableError) {
    return {
      ok: false,
      executablePath: executablePath || '(puppeteer bundled browser)',
      error: executableError,
    };
  }
  try {
    browser = await puppeteer.launch(launchOptions({ width, height }));
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><title>slidey doctor</title><body style="margin:0;background:#111;color:#fff">ok</body>');
    await page.screenshot({ encoding: 'binary' });
    return {
      ok: true,
      executablePath: executablePath || '(puppeteer bundled browser)',
    };
  } catch (err) {
    return {
      ok: false,
      executablePath: executablePath || '(puppeteer bundled browser)',
      error: err && err.message ? err.message : String(err),
    };
  } finally {
    await closeBrowser(browser);
  }
}

module.exports = { browserExecutableError, chromeArgs, closeBrowser, defaultChromePath, doctor, launchOptions, managedHeadlessShellPath };
