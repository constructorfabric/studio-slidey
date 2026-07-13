'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { doctor: browserDoctor } = require('./browser');
const { RENDER_BUNDLE } = require('./render-bundle');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_VOICE = 'en-AU-NatashaNeural';

function firstLine(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function runCommand(command, args = [], opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error,
      detail: result.error.code === 'ENOENT'
        ? `${command} not found on PATH`
        : result.error.message,
    };
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      output,
      detail: firstLine(output) || `${command} exited with status ${result.status}`,
    };
  }
  return {
    ok: true,
    status: result.status,
    output,
    detail: firstLine(output),
  };
}

function parseVersion(version) {
  const [major, minor, patch] = String(version).split('.').map((part) => Number(part));
  return { major, minor, patch };
}

function versionAtLeast(version, min) {
  const a = parseVersion(version);
  const b = parseVersion(min);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

function checkNode(minVersion = '20.19.0', maxMajorExclusive = 23) {
  const parsed = parseVersion(process.versions.node);
  const inRange = Number.isFinite(parsed.major)
    && versionAtLeast(process.versions.node, minVersion)
    && parsed.major < maxMajorExclusive;
  return {
    id: 'node',
    label: `Node ${minVersion} through 22.x`,
    required: true,
    ok: inRange,
    detail: `v${process.versions.node}`,
    install: 'Use Node 22 LTS: nvm install 22 && nvm use 22',
  };
}

function checkPackage(name, why, required = true) {
  try {
    const resolved = require.resolve(name, { paths: [ROOT] });
    return {
      id: `package:${name}`,
      label: `npm package ${name}`,
      required,
      ok: true,
      detail: path.relative(ROOT, resolved),
      requiredFor: why,
    };
  } catch (err) {
    return {
      id: `package:${name}`,
      label: `npm package ${name}`,
      required,
      ok: false,
      detail: `${name} is not installed`,
      install: 'Run npm install',
      requiredFor: why,
    };
  }
}

function checkCommand({ id, label, command, args, required = true, install, requiredFor }) {
  const result = runCommand(command, args);
  return {
    id,
    label,
    required,
    ok: result.ok,
    detail: result.ok ? result.detail : result.detail,
    install,
    requiredFor,
  };
}

function checkRenderBundle() {
  const exists = fs.existsSync(RENDER_BUNDLE);
  return {
    id: 'render-bundle',
    label: 'headless render bundle',
    required: false,
    ok: exists,
    detail: exists ? path.relative(ROOT, RENDER_BUNDLE) : 'dist-render/render.html is missing',
    install: 'Run npm run build:render',
    requiredFor: 'faster first PDF/PNG/MP4 export; exports can rebuild it automatically',
  };
}

async function checkBrowser() {
  const result = await browserDoctor();
  return {
    id: 'browser',
    label: 'headless browser',
    required: true,
    ok: !!result.ok,
    detail: result.ok
      ? `${result.executablePath}; launch and screenshot succeeded`
      : (result.error || 'browser launch failed'),
    install: 'Install Chrome/Chromium, run npm install, or set SLIDEY_CHROME_PATH',
    requiredFor: 'PDF/PNG/MP4 rendering',
  };
}

function checkEdgeTtsBinary(required) {
  return checkCommand({
    id: 'edge-tts',
    label: 'edge-tts CLI',
    command: 'edge-tts',
    args: ['--version'],
    required,
    install: 'pipx install edge-tts  # or: python3 -m pip install --user edge-tts',
    requiredFor: 'narrated MP4 exports',
  });
}

function checkEdgeTtsSample({ voice = DEFAULT_VOICE } = {}) {
  const outPath = path.join(os.tmpdir(), `slidey-doctor-${process.pid}.mp3`);
  try {
    const result = runCommand('edge-tts', [
      '--voice', voice,
      '--text', 'Slidey narration check.',
      '--write-media', outPath,
    ]);
    const ok = result.ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
    return {
      id: 'edge-tts-sample',
      label: `Edge TTS synthesis (${voice})`,
      required: true,
      ok,
      detail: ok
        ? `generated ${fs.statSync(outPath).size} byte sample`
        : (result.detail || 'sample generation failed'),
      install: 'Check network/proxy access to Microsoft Edge TTS or choose a different voice with --voice',
      requiredFor: 'narrated MP4 exports',
    };
  } finally {
    try { fs.rmSync(outPath, { force: true }); } catch (_) {}
  }
}

async function runSetupDoctor(opts = {}) {
  const narration = opts.narration !== false;
  const checks = [
    checkNode(),
    checkPackage('puppeteer', 'headless rendering'),
    checkPackage('vite', 'render bundle builds', false),
    checkRenderBundle(),
  ];

  if (opts.browser !== false) {
    checks.push(await checkBrowser());
  }

  checks.push(checkCommand({
    id: 'ffmpeg',
    label: 'ffmpeg CLI',
    command: 'ffmpeg',
    args: ['-version'],
    required: true,
    install: 'brew install ffmpeg  # macOS; apt install ffmpeg on Debian/Ubuntu',
    requiredFor: 'MP4 assembly and video scenes',
  }));

  checks.push(checkCommand({
    id: 'ffprobe',
    label: 'ffprobe CLI',
    command: 'ffprobe',
    args: ['-version'],
    required: narration,
    install: 'brew install ffmpeg  # ffprobe is included with ffmpeg',
    requiredFor: 'narration duration checks',
  }));

  const edgeBinary = checkEdgeTtsBinary(narration);
  checks.push(edgeBinary);
  if (narration && opts.ttsSample !== false && edgeBinary.ok) {
    checks.push(checkEdgeTtsSample({ voice: opts.voice || DEFAULT_VOICE }));
  }

  const failures = checks.filter((check) => check.required && !check.ok);
  return {
    ok: failures.length === 0,
    profile: narration ? 'narrated MP4 export' : 'silent/PDF/PNG export',
    checks,
  };
}

function formatDoctorReport(report) {
  const lines = [
    '[slidey] Doctor',
    `[slidey] Profile: ${report.profile}`,
    '',
  ];

  for (const check of report.checks) {
    const status = check.ok ? 'ok' : (check.required ? 'fail' : 'warn');
    lines.push(`[${status}] ${check.label}: ${check.detail || ''}`.trimEnd());
    if (!check.ok && check.requiredFor) lines.push(`       required for: ${check.requiredFor}`);
    if (!check.ok && check.install) lines.push(`       fix: ${check.install}`);
  }

  lines.push('');
  lines.push(report.ok
    ? '[slidey] OK: setup is ready.'
    : `[slidey] ERROR: setup is incomplete for ${report.profile}.`);
  return lines.join('\n');
}

module.exports = {
  DEFAULT_VOICE,
  checkCommand,
  checkNode,
  checkPackage,
  checkRenderBundle,
  formatDoctorReport,
  runCommand,
  runSetupDoctor,
};
