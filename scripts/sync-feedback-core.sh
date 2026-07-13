#!/usr/bin/env bash
# Vendors packages/feedback-core and packages/feedback-vue from studio-sassfully
# into web/feedback/vendor/. Both are zero-dep ESM (feedback-vue only takes a
# peerDependency on vue, already bundled here), so a straight file copy is
# safe and CI-proof — see .context/feedback-e2e-plan.md, architecture
# decision 2. The two packages' relative import
# (feedback-vue/src/*.vue -> ../../feedback-core/src/index.mjs) is preserved
# by copying each package's src/ under its own package-name directory.
#
# Source defaults to the sibling studio-sassfully checkout. As of 2026-07-12
# feedback-vue only exists on that repo's unmerged feat/feedback-core-intake
# branch (see .context/feedback-e2e-plan.md) — point SASSFULLY_DIR at a
# worktree checked out to that branch until it lands on sassfully's main:
#   SASSFULLY_DIR=../studio-sassfully/.worktrees/feedback-core-intake \
#     scripts/sync-feedback-core.sh
set -euo pipefail

SASSFULLY_DIR="${SASSFULLY_DIR:-../studio-sassfully}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/web/feedback/vendor"

for pkg in feedback-core feedback-vue; do
  src="$SASSFULLY_DIR/packages/$pkg/src"
  if [ ! -d "$src" ]; then
    echo "sync-feedback-core: missing $src" >&2
    echo "  set SASSFULLY_DIR to a studio-sassfully checkout that has packages/$pkg built" >&2
    exit 1
  fi
  dest_src="$DEST/$pkg/src"
  rm -rf "$dest_src"
  mkdir -p "$dest_src"
  cp "$src"/*.mjs "$dest_src"/ 2>/dev/null || true
  cp "$src"/*.vue "$dest_src"/ 2>/dev/null || true

  branch="$(git -C "$SASSFULLY_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  sha="$(git -C "$SASSFULLY_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  cat > "$DEST/$pkg/PROVENANCE.md" <<EOF
Vendored from studio-sassfully packages/$pkg/src

  source: $SASSFULLY_DIR
  branch: $branch
  commit: $sha

Re-run scripts/sync-feedback-core.sh after upstream changes land. Do not
hand-edit files under src/ — edit upstream in studio-sassfully and re-sync.
EOF
  echo "synced $pkg ($branch @ ${sha:0:7})"
done
