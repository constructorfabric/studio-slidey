#!/usr/bin/env bash
# Generates a personalized share link for a published deck: HMAC-SHA256 of
# the recipient's name (keyed by a local-only secret), appended to a
# gitignored hash->recipient mapping so it can be resolved back to a name
# later by pull-feedback.sh. The hash rides in the URL as ?u=<hash>; the
# mapping never leaves this machine. Absent ?u=, feedback is anonymous — see
# .context/feedback-e2e-plan.md, architecture decision 4.
#
# Usage: tools/deploy/share-link.sh <slug> <recipient>
set -euo pipefail

SITE="${SLIDEY_FEEDBACK_SITE:-https://kitsoki-test.slothattax.me}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIENCE_FILE="$ROOT/tools/deploy/audience.local.json"
SECRET_FILE="$ROOT/tools/deploy/audience-secret.local"

slug="${1:-}"
recipient="${2:-}"
if [ -z "$slug" ] || [ -z "$recipient" ]; then
  echo "Usage: tools/deploy/share-link.sh <slug> <recipient>" >&2
  exit 1
fi

if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "share-link: generated a new local HMAC secret at $SECRET_FILE (never commit this)" >&2
fi
secret="$(cat "$SECRET_FILE")"

hash="$(printf '%s' "$recipient" | openssl dgst -sha256 -hmac "$secret" -binary | xxd -p -c 256 | cut -c1-16)"

node -e "
const fs = require('node:fs');
const path = process.argv[1];
const slug = process.argv[2];
const recipient = process.argv[3];
const hash = process.argv[4];
let audience = {};
if (fs.existsSync(path)) audience = JSON.parse(fs.readFileSync(path, 'utf8'));
audience[hash] = { slug, recipient, createdAt: new Date().toISOString() };
fs.writeFileSync(path, JSON.stringify(audience, null, 2) + '\n');
" "$AUDIENCE_FILE" "$slug" "$recipient" "$hash"

echo "$SITE/constructor-studio/decks/$slug/?u=$hash"
