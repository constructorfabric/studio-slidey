/**
 * SLIDEY — Tour target launcher
 *
 * A tour captures a live web app. The app is reached one of two ways:
 *
 *   { "url": "http://localhost:5173/" }         — caller already serves it
 *   { "launch": "kitsoki web --addr …",         — slidey spawns it,
 *     "addr": "127.0.0.1:7799",                   health-polls until ready,
 *     "readyPath": "/" }                          and kills it (process group)
 *                                                  when the capture finishes.
 *
 * Generalized from kitsoki's `_helpers/server.ts` startWebServer: the deterministic
 * no-LLM posture (flow + cassette) is now just flags inside the `launch` string,
 * so any app — kitsoki or otherwise — works unchanged.
 */

'use strict';

const { spawn } = require('child_process');

/** Poll `${base}${readyPath}` until it returns 2xx, or throw after timeoutMs. */
async function waitForHealthy(base, readyPath, timeoutMs, log) {
  const url = base + (readyPath || '/');
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status >= 200 && res.status < 400) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`tour target not healthy after ${timeoutMs}ms (last: ${lastErr})\n--- log ---\n${log()}`);
}

/**
 * Resolve a tour's target into a base URL + a stop() teardown.
 *
 * @param {object} target  { url } | { launch, addr, readyPath?, cwd?, env?, timeoutMs? }
 * @returns {Promise<{ base: string, stop: () => void, log: () => string }>}
 */
async function resolveTarget(target) {
  if (!target || (!target.url && !target.launch)) {
    throw new Error('tour.target requires either "url" or "launch"');
  }

  // Pre-served app: nothing to spawn or tear down.
  if (target.url && !target.launch) {
    return { base: target.url.replace(/\/$/, ''), stop: () => {}, log: () => '' };
  }

  if (!target.addr) {
    throw new Error('tour.target.launch requires "addr" (host:port) for the health check');
  }

  // Spawn via a shell so the launch string can carry its own flags/quoting.
  // detached so a wrapper (e.g. `go run`) shares a killable process group.
  let serverLog = '';
  const proc = spawn(target.launch, {
    cwd: target.cwd || process.cwd(),
    env: Object.assign({}, process.env, target.env || {}),
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => (serverLog += d.toString()));
  proc.stderr.on('data', (d) => (serverLog += d.toString()));
  proc.on('exit', (code, sig) => (serverLog += `\n[target exited code=${code} sig=${sig}]\n`));

  const base = `http://${target.addr}`;
  const log = () => serverLog;
  const stop = () => {
    if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); }
      catch { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }
    }
  };

  try {
    await waitForHealthy(base, target.readyPath, target.timeoutMs || 30000, log);
  } catch (err) {
    stop();
    throw err;
  }
  return { base, stop, log };
}

module.exports = { resolveTarget };
