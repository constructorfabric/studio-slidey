'use strict';

const test = require('node:test');
const assert = require('node:assert');

function resetBrowserModule() {
  delete require.cache[require.resolve('../src/browser')];
}

test('SLIDEY_CHROME_PATH overrides Puppeteer browser selection', () => {
  const oldSlidey = process.env.SLIDEY_CHROME_PATH;
  const oldPptr = process.env.PUPPETEER_EXECUTABLE_PATH;
  process.env.SLIDEY_CHROME_PATH = '/tmp/slidey-chrome';
  process.env.PUPPETEER_EXECUTABLE_PATH = '/tmp/puppeteer-chrome';
  resetBrowserModule();
  const { defaultChromePath, launchOptions } = require('../src/browser');

  assert.equal(defaultChromePath(), '/tmp/slidey-chrome');
  assert.equal(launchOptions({ width: 10, height: 20 }).executablePath, '/tmp/slidey-chrome');
  assert.equal(launchOptions({ width: 10, height: 20 }).pipe, true);

  if (oldSlidey === undefined) delete process.env.SLIDEY_CHROME_PATH;
  else process.env.SLIDEY_CHROME_PATH = oldSlidey;
  if (oldPptr === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
  else process.env.PUPPETEER_EXECUTABLE_PATH = oldPptr;
  resetBrowserModule();
});

test('PUPPETEER_EXECUTABLE_PATH is the fallback explicit browser override', () => {
  const oldSlidey = process.env.SLIDEY_CHROME_PATH;
  const oldPptr = process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.SLIDEY_CHROME_PATH;
  process.env.PUPPETEER_EXECUTABLE_PATH = '/tmp/puppeteer-chrome';
  resetBrowserModule();
  const { defaultChromePath, launchOptions } = require('../src/browser');

  assert.equal(defaultChromePath(), '/tmp/puppeteer-chrome');
  assert.equal(launchOptions().executablePath, '/tmp/puppeteer-chrome');

  if (oldSlidey === undefined) delete process.env.SLIDEY_CHROME_PATH;
  else process.env.SLIDEY_CHROME_PATH = oldSlidey;
  if (oldPptr === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
  else process.env.PUPPETEER_EXECUTABLE_PATH = oldPptr;
  resetBrowserModule();
});
