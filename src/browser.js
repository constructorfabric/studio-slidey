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

module.exports = { chromeArgs, defaultChromePath, launchOptions };
