'use strict';

// Project-owned feedback routing. Keep per-developer overrides in
// .slidey/feedback.local.json; the committed file only describes destinations.
const fs = require('fs');
const path = require('path');
const CONFIG_REL = path.join('.slidey', 'feedback.json');
const LOCAL_CONFIG_REL = path.join('.slidey', 'feedback.local.json');
const DEFAULT_LOCAL_PATH = path.join('.slidey', 'feedback', 'feedback.jsonl');
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function object(value) { return isObject(value) ? value : {}; }
function merge(base, overlay) {
  const result = { ...object(base) };
  for (const [key, value] of Object.entries(object(overlay))) result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
  return result;
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw new Error(`Slidey feedback config ${file}: ${err.message}`); }
}
function loadFeedbackConfig(root) {
  const config = merge(readJSON(path.join(root, CONFIG_REL)), readJSON(path.join(root, LOCAL_CONFIG_REL)));
  return { ...config, publishing: object(config.publishing), sinks: object(config.sinks), local: object(config.local) };
}
function runtimeFeedbackConfig(root, { environment = 'local', localEndpoint = '/api/feedback/local' } = {}) {
  const config = loadFeedbackConfig(root);
  const environments = object(config.publishing.environments);
  // Older/downstream configs may only name their published environment. A
  // local viewer still offers that configured sink alongside its repo log.
  const publishedEnvironment = typeof config.publishing.environment === 'string' ? config.publishing.environment : 'public';
  const selected = object(environments[environment] || (environment === 'local' && environments[publishedEnvironment]));
  const sinks = (Array.isArray(selected.sinks) ? selected.sinks : []).map((id) => ({ id, ...object(config.sinks[id]) }))
    .filter((sink) => sink.id && sink.type === 'http' && typeof sink.endpoint === 'string');
  if (environment === 'local') sinks.unshift({ id: 'local', label: 'Save in this repo', type: 'http', endpoint: localEndpoint, local: true });
  return { environment, sinks };
}
function localFeedbackPath(root) {
  const config = loadFeedbackConfig(root);
  const rel = typeof config.local.path === 'string' && config.local.path ? config.local.path : DEFAULT_LOCAL_PATH;
  const abs = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (abs !== root && !abs.startsWith(prefix)) throw new Error('Slidey feedback local.path must stay inside the workspace');
  return abs;
}
function appendLocalFeedback(root, bundle) {
  if (!bundle || bundle.reviewed !== true || typeof bundle.idempotencyKey !== 'string') throw new Error('only reviewed feedback bundles can be saved locally');
  const file = localFeedbackPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...bundle })}\n`, 'utf8');
  return path.relative(root, file).split(path.sep).join('/');
}
module.exports = { CONFIG_REL, LOCAL_CONFIG_REL, loadFeedbackConfig, runtimeFeedbackConfig, localFeedbackPath, appendLocalFeedback };
