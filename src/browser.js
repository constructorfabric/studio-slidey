'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function defaultChromePath() {
  const envPath = process.env.SLIDEY_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;

  if (process.platform === 'darwin') {
    return firstExecutable([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
  }

  return null;
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
  const { width, height, args = [] } = opts;
  const executablePath = defaultChromePath();
  const options = {
    headless: 'new',
    args: chromeArgs(width, height, args),
  };
  if (executablePath) options.executablePath = executablePath;
  return options;
}

async function doctor(opts = {}) {
  const puppeteer = require('puppeteer');
  const { width = 320, height = 180 } = opts;
  const executablePath = defaultChromePath();
  let browser;
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
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { chromeArgs, defaultChromePath, doctor, launchOptions };
