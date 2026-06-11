#!/usr/bin/env bash
# Stage 1 (deterministic, no LLM): turn a slidey JSON spec into the evidence the
# QA agent reviews — one PNG per reveal step PLUS a geometry audit.
#
#   <out>/frames/NN-MM.png   one image per scene-step (what a viewer sees)
#   <out>/audit.json         slidey --audit: real laid-out geometry findings +
#                            the per-frame scene manifest (type, title, state)
#
# Both come straight from slidey's own render bundle, so the frames are exactly
# what ships and the audit is ground truth (see src/audit.js). Deterministic and
# testable on its own — no model involved.
#
# Usage: render-frames.sh <spec.json> <out-dir> [--scenes SPEC] [--slidey DIR]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# project root = three levels up from tools/visual-qa/scripts
slidey_root="$(cd "$here/../../.." && pwd)"

spec="${1:?usage: render-frames.sh <spec.json> <out-dir> [--scenes SPEC]}"; shift || true
outdir="${1:?usage: render-frames.sh <spec.json> <out-dir> [--scenes SPEC]}"; shift || true

scenes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scenes) scenes="$2"; shift 2 ;;
    --slidey) slidey_root="$(cd "$2" && pwd)"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -f "$spec" ] || { echo "no such spec: $spec" >&2; exit 2; }
[ -f "$slidey_root/src/index.js" ] || { echo "slidey not found at $slidey_root (pass --slidey DIR)" >&2; exit 2; }
[ -f "$slidey_root/dist-render/render.html" ] || {
  echo "render bundle missing — run 'npm run build:render' in $slidey_root first" >&2; exit 2; }

spec="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"   # absolute
mkdir -p "$outdir/frames"
outdir="$(cd "$outdir" && pwd)"

scene_args=()
[ -n "$scenes" ] && scene_args=(--scenes "$scenes")

echo "▸ rendering frames → $outdir/frames/" >&2
node "$slidey_root/src/index.js" "$spec" "$outdir/frames/" "${scene_args[@]}" >&2

echo "▸ geometry audit → $outdir/audit.json" >&2
# Remove any stale audit.json from a reused outdir so a failed audit can't be
# masked by leftover output.
rm -f "$outdir/audit.json"
# --audit exits 1 when it finds error-severity geometry defects; that's expected
# here (we want the findings), so don't let set -e abort on it. Capture the real
# exit code so we can tell "found defects" (1) from a genuine crash.
audit_rc=0
node "$slidey_root/src/index.js" "$spec" --audit "$outdir/audit.json" "${scene_args[@]}" >&2 || audit_rc=$?

[ -f "$outdir/audit.json" ] || { echo "audit produced no output (exit $audit_rc)" >&2; exit 2; }
echo "$outdir"
