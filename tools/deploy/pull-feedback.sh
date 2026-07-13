#!/usr/bin/env bash
# Pulls the feedback JSONL down from kitsoki-test.slothattax.me and annotates
# each line's context.viewerHash with the recipient name from the local
# audience file (tools/deploy/audience.local.json, written by
# share-link.sh — never on the VM). Lines with no viewerHash are anonymous
# submits, printed as-is.
#
# Usage: tools/deploy/pull-feedback.sh [--month YYYY-MM]
set -euo pipefail

REMOTE="${SLIDEY_FEEDBACK_VM_REMOTE:-root@kitsoki-test.slothattax.me}"
DATA_DIR="${SLIDEY_FEEDBACK_VM_DATA_DIR:-/var/lib/slidey-feedback}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIENCE_FILE="$ROOT/tools/deploy/audience.local.json"
LOCAL_DIR="$ROOT/tools/deploy/feedback.local"

month=""
while [ $# -gt 0 ]; do
  case "$1" in
    --month) month="$2"; shift 2 ;;
    *) echo "pull-feedback: unknown argument $1" >&2; exit 1 ;;
  esac
done
if [ -z "$month" ]; then
  month="$(date -u +%Y-%m)"
fi

mkdir -p "$LOCAL_DIR"
remote_file="$DATA_DIR/feedback-$month.jsonl"
local_file="$LOCAL_DIR/feedback-$month.jsonl"

echo "pull-feedback: pulling $REMOTE:$remote_file"
if ! rsync -az "$REMOTE:$remote_file" "$local_file" 2>/dev/null; then
  echo "pull-feedback: no feedback file for $month yet (or rsync failed) — nothing to show." >&2
  exit 0
fi

AUDIENCE_FILE="$AUDIENCE_FILE" node -e "
const fs = require('node:fs');
const localFile = process.argv[1];
const audiencePath = process.env.AUDIENCE_FILE;
let audience = {};
if (fs.existsSync(audiencePath)) audience = JSON.parse(fs.readFileSync(audiencePath, 'utf8'));

const lines = fs.readFileSync(localFile, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  let bundle;
  try { bundle = JSON.parse(line); } catch { continue; }
  const rawHash = bundle.context && bundle.context.viewerHash;
  const hash = rawHash ? String(rawHash).replace(/^u_/, '') : null;
  const known = hash && audience[hash];
  const who = known ? known.recipient : (hash ? \`unknown (u=\${hash})\` : 'anonymous');
  const deckVersion = bundle.context && bundle.context.deck && bundle.context.deck.version;
  console.log(\`[\${bundle.receivedAt || '?'}] \${bundle.kind} — \${who}\`);
  console.log(\`  deck: \${bundle.anchor && bundle.anchor.artifactId} @ \${deckVersion || '(dev/unpublished)'} scene \${bundle.anchor && bundle.anchor.scope} step \${bundle.anchor && bundle.anchor.step}\`);
  console.log(\`  \${bundle.userText || '(no text)'}\`);
  console.log('');
}
console.log(\`\${lines.length} line(s) — full JSONL at \${localFile}\`);
" "$local_file"
