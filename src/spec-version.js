'use strict';

/**
 * SLIDEY — spec version tokens (optimistic concurrency).
 *
 * A "version" is a short content hash of the exact bytes on disk. Both writers
 * to a spec — the human editor (POST /api/spec) and the AI (MCP writeSpecFile)
 * — read a version when they load a spec and hand it back when they save. A
 * save whose base version no longer matches the file on disk means someone else
 * wrote in between, so we refuse the blind overwrite and surface a conflict
 * (resolved as OURS = force-overwrite, or THEIRS = adopt the on-disk version)
 * instead of silently losing the concurrent edit.
 *
 * Content-hash (not mtime) so an identical-content rewrite is NOT a false
 * conflict and a touch that doesn't change bytes doesn't look like an edit.
 */

const crypto = require('crypto');
const fs = require('fs');

/** Version token for a byte buffer or string. */
function versionOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Version token for the file at `abs` (throws if unreadable). */
function versionOfFile(abs) {
  return versionOf(fs.readFileSync(abs));
}

module.exports = { versionOf, versionOfFile };
