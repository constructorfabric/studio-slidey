'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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
  return {
    headless: 'new',
    args: chromeArgs(width, height, args),
  };
}

module.exports = { chromeArgs, launchOptions };
