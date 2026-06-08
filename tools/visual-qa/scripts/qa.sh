#!/usr/bin/env bash
# One-shot slidey visual QA: render frames + geometry audit → grounded,
# adversarially-verified vision review → merged gated report.
#
#   render-frames.sh → qa-inspect.sh → report.sh
#
# Reliability comes from a deterministic frame set + geometry audit, an
# evidence-cited vision verdict, and an adversarial false-positive sweep
# (see SKILL.md). Exit code is the gate: 0 pass, 1 a blocking defect, 2 error.
#
# Usage: qa.sh <spec.json> [--scenes SPEC] [--out DIR] [--checks FILE]
#               [--model M] [--no-adversary] [--strict] [--audit-only]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
base_dir="$(cd "$here/.." && pwd)"

spec="${1:?usage: qa.sh <spec.json> [opts]}"; shift || true
scenes="" outdir="" checks="$base_dir/checks.yaml" model=""
adv_flag="" strict_flag="" audit_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --scenes)       scenes="$2"; shift 2 ;;
    --out)          outdir="$2"; shift 2 ;;
    --checks)       checks="$2"; shift 2 ;;
    --model)        model="$2"; shift 2 ;;
    --no-adversary) adv_flag="--no-adversary"; shift ;;
    --strict)       strict_flag="--strict"; shift ;;
    --audit-only)   audit_only=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -f "$spec" ] || { echo "no such spec: $spec" >&2; exit 2; }
stem="$(basename "${spec%.*}")"
[ -n "$outdir" ] || outdir=".artifacts/visual-qa/$stem"
mkdir -p "$outdir"

# 1. Frames + geometry audit (deterministic).
render_args=("$spec" "$outdir")
[ -n "$scenes" ] && render_args+=(--scenes "$scenes")
"$here/render-frames.sh" "${render_args[@]}"
audit="$outdir/audit.json"

# 2. Vision review (skip with --audit-only — pure-geometry gate, no LLM/cost).
findings_arg=()
if [ "$audit_only" -eq 0 ]; then
  findings="$outdir/findings.json"
  inspect_args=(--frames "$outdir/frames" --audit "$audit" --checks "$checks" --out "$findings")
  [ -n "$model" ]    && inspect_args+=(--model "$model")
  [ -n "$adv_flag" ] && inspect_args+=("$adv_flag")
  "$here/qa-inspect.sh" "${inspect_args[@]}"
  findings_arg=(--findings "$findings")
else
  echo "▸ --audit-only: skipping the vision pass (geometry gate only)" >&2
fi

# 3. Merged, gated report — exit code propagates as the QA gate.
echo
"$here/report.sh" --audit "$audit" "${findings_arg[@]}" --out "$outdir/qa-report.md" $strict_flag
rc=$?
echo
echo "QA artifacts in $outdir/ : audit.json, findings.json, qa-report.md, frames/"
exit $rc
