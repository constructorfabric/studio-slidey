#!/usr/bin/env bash
# Publishes a slidey deck to kitsoki-test.slothattax.me as a self-contained
# single-file build, stamped with a pre-chosen git tag as its deck version
# (never a SHA derived from the build's own output — see
# .context/feedback-e2e-plan.md, architecture decision 7).
#
# Usage: tools/deploy/publish-deck.sh <spec.slidey.json> [--slug <slug>]
#
# The spec may live in ANY git repo, not just this one (e.g. a deck authored
# in a sibling POG checkout) — the tag is created in the repo that actually
# contains the spec file, so `git show <tag>:<path-within-that-repo>`
# reproduces it later, regardless of which repo's tooling built it.
#
# Refuses to run when that repo's working tree is dirty: a deck version that
# doesn't map to a real commit defeats the point of pull-feedback.sh's
# `git show <tag>:<spec>` reproducibility guarantee.
#
# Requires the `edge-tts` CLI on PATH (same dependency `slidey doctor` checks
# for MP4 narration) to pre-render narration audio into the published build
# (web/build-single.mjs → build-narration-audio.mjs). Without it, publishing
# still succeeds but SILENTLY produces a deck with no narration that rushes
# through reveals at a fixed ~650ms/step — there is no error, only a build-time
# log line, so `slidey doctor` before publishing if narration seems to be
# missing after a publish. See docs/decks/README.md's "Publishing" section.
set -euo pipefail

REMOTE="${SLIDEY_FEEDBACK_VM_REMOTE:-root@kitsoki-test.slothattax.me}"
DECKS_DIR="${SLIDEY_FEEDBACK_VM_DECKS_DIR:-/srv/slidey-decks}"
SITE="${SLIDEY_FEEDBACK_SITE:-https://kitsoki-test.slothattax.me}"
FEEDBACK_ENDPOINT="${SLIDEY_FEEDBACK_ENDPOINT:-/api/feedback}"
FEEDBACK_ENVIRONMENT="${SLIDEY_FEEDBACK_ENVIRONMENT:-public}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

spec=""
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) slug="$2"; shift 2 ;;
    -*) echo "publish-deck: unknown flag $1" >&2; exit 1 ;;
    *) spec="$1"; shift ;;
  esac
done
if [ -z "$spec" ]; then
  echo "Usage: tools/deploy/publish-deck.sh <spec.slidey.json> [--slug <slug>]" >&2
  exit 1
fi
if [ ! -f "$spec" ]; then
  echo "publish-deck: spec not found: $spec" >&2
  exit 1
fi
spec="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"
if [ -z "$slug" ]; then
  slug="$(basename "$spec" | sed -E 's/\.slidey\.json$//; s/\.json$//')"
fi
if ! [[ "$slug" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "publish-deck: slug '$slug' must be lowercase alphanumeric with hyphens (URL path-safe)" >&2
  exit 1
fi

# The spec's own repo owns the version tag — not necessarily this repo.
spec_repo="$(cd "$(dirname "$spec")" && git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$spec_repo" ]; then
  echo "publish-deck: $spec is not inside a git repo — a deck version must map to a real commit" >&2
  exit 1
fi
spec_relpath="${spec#"$spec_repo"/}"

spec_dir="$(dirname "$spec_relpath")"
if [ -n "$(git -C "$spec_repo" status --porcelain -- "$spec_dir")" ]; then
  echo "publish-deck: $spec_repo has uncommitted changes under $spec_dir — commit or stash before publishing" >&2
  echo "  (a deck version must point at a real commit; see architecture decision 7 in feedback-e2e-plan.md)" >&2
  echo "  Only checking $spec_dir, not the whole repo — unrelated dirty files elsewhere don't block this." >&2
  git -C "$spec_repo" status --short -- "$spec_dir" >&2
  exit 1
fi

# Next sequential version for this slug: deck/<slug>/v<n>.
last_n=0
while IFS= read -r existing_tag; do
  [ -z "$existing_tag" ] && continue
  n="${existing_tag##*/v}"
  if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt "$last_n" ]; then last_n="$n"; fi
done < <(git -C "$spec_repo" tag -l "deck/$slug/v*")
next_n=$((last_n + 1))
tag="deck/$slug/v$next_n"

echo "publish-deck: tagging $spec_repo @ HEAD as $tag"
git -C "$spec_repo" tag -a "$tag" -m "Publish deck '$slug' ($spec_relpath)"
if git -C "$spec_repo" remote get-url origin >/dev/null 2>&1; then
  git -C "$spec_repo" push origin "$tag"
else
  echo "publish-deck: $spec_repo has no 'origin' remote — tag created locally only." >&2
  echo "  The reproducibility guarantee (git show $tag:$spec_relpath) only holds on this machine" >&2
  echo "  until this repo has a remote and the tag is pushed there." >&2
fi

outfile="$(mktemp -t slidey-publish-XXXXXX).html"
echo "publish-deck: building single-file bundle…"
node "$ROOT/web/build-single.mjs" "$spec" "$outfile"

echo "publish-deck: stamping deck version + feedback sinks"
DECK_VERSION_TAG="$tag" FEEDBACK_ENDPOINT_URL="$FEEDBACK_ENDPOINT" FEEDBACK_ENVIRONMENT_NAME="$FEEDBACK_ENVIRONMENT" PROJECT_ROOT="$ROOT" node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const outfile = process.argv[1];
const tag = process.env.DECK_VERSION_TAG;
const endpoint = process.env.FEEDBACK_ENDPOINT_URL;
const environment = process.env.FEEDBACK_ENVIRONMENT_NAME;
let sinks = [{ id: 'default', label: 'Send feedback', endpoint }];
try {
  const config = JSON.parse(readFileSync(join(process.env.PROJECT_ROOT, '.slidey', 'feedback.json'), 'utf8'));
  const ids = config?.publishing?.environments?.[environment]?.sinks;
  if (Array.isArray(ids) && ids.length) sinks = ids.map((id) => ({ id, ...config.sinks?.[id] })).filter((sink) => sink.type === 'http' && typeof sink.endpoint === 'string');
} catch (err) { console.warn('publish-deck: no project feedback config:', err.message); }
if (!sinks.length) throw new Error('publish-deck: selected feedback environment has no HTTP sinks');
let html = readFileSync(outfile, 'utf8');
const inject = \`<script>window.__SLIDEY_DECK_VERSION__ = \${JSON.stringify(tag)}; window.__SLIDEY_FEEDBACK__ = { environment: \${JSON.stringify(environment)}, sinks: \${JSON.stringify(sinks)} };</script>\n\`;
const patched = html.replace(/(<script type=\"module\">)/, \`\${inject}\$1\`);
if (patched === html) throw new Error('publish-deck: could not find injection point in built HTML');
writeFileSync(outfile, patched);
" "$outfile"

echo "publish-deck: publishing to $REMOTE:$DECKS_DIR/$slug/"
ssh "$REMOTE" "mkdir -p '$DECKS_DIR/$slug'"
rsync -az "$outfile" "$REMOTE:$DECKS_DIR/$slug/index.html"
rm -f "$outfile"

echo
echo "Published: $SITE/constructor-studio/decks/$slug/"
echo "Deck version: $tag"
echo "Reproduce:   git -C $spec_repo show $tag:$spec_relpath"
