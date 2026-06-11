#!/usr/bin/env bash
# Stage 3 (deterministic, no LLM): merge the geometry audit (audit.json) and the
# vision findings (findings.json) into one human qa-report.md, AND set the
# process exit code so QA can GATE a render. Pure jq/bash — testable in isolation
# by feeding it canned JSON.
#
# Gate (authoritative — recomputed here, NOT trusted from any model's `overall`):
#   default   any error-severity finding (from either source) fails the gate
#   --strict  any error- OR warn-severity finding fails the gate
# Exit 0 if the gate passes, 1 if it fails, 2 on bad input.
#
# Usage: report.sh --findings <findings.json> --audit <audit.json>
#                  [--out report.md] [--strict]
set -euo pipefail

findings="" audit="" out="" strict=0
while [ $# -gt 0 ]; do
  case "$1" in
    --findings) [ $# -ge 2 ] || { echo "--findings needs a value" >&2; exit 2; }; findings="$2"; shift 2 ;;
    --audit)    [ $# -ge 2 ] || { echo "--audit needs a value" >&2; exit 2; }; audit="$2"; shift 2 ;;
    --out)      [ $# -ge 2 ] || { echo "--out needs a value" >&2; exit 2; }; out="$2"; shift 2 ;;
    --strict)   strict=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq not on PATH" >&2; exit 2; }
[ -f "$audit" ] || { echo "no such audit: $audit" >&2; exit 2; }
jq -e . "$audit" >/dev/null 2>&1 || { echo "audit is not valid JSON" >&2; exit 2; }
# findings.json is optional — audit-only runs (no vision pass) are valid.
if [ -n "$findings" ]; then
  [ -f "$findings" ] || { echo "no such findings: $findings" >&2; exit 2; }
  jq -e . "$findings" >/dev/null 2>&1 || { echo "findings is not valid JSON" >&2; exit 2; }
else
  findings="$(mktemp)"; echo '{"findings":[],"clean_frames":[]}' > "$findings"
fi
[ -n "$out" ] || out="$(dirname "$audit")/qa-report.md"

# Normalise both sources into one flat finding stream:
#   {source, frame, scene, step, type, check, severity, detail}
merged="$(jq -n --slurpfile a "$audit" --slurpfile f "$findings" '
  ( $a[0].frames // [] | map(. as $fr | ($fr.findings // [])[] | {
      source:"audit", frame:$fr.frame, scene:$fr.scene, step:$fr.step,
      type:$fr.type, check:.check, severity:.severity,
      detail:(.detail + (if (.text//"")|length>0 then "  «\(.text)»" else "" end))
    }) )
  +
  ( ($f[0].findings // []) | map({
      source:"vision", frame:.frame, scene:.scene, step:.step, type:(.type//""),
      check:.check, severity:.severity, detail:.observation
    }) )
')"

# --- Gate (independent of report rendering) --------------------------------
blockers="$(printf '%s' "$merged" | jq --argjson strict "$strict" '
  [ .[] | select( if $strict==1 then (.severity=="error" or .severity=="warn")
                  else (.severity=="error") end ) ] | length')"

# --- Markdown report -------------------------------------------------------
printf '%s' "$merged" | jq -r --argjson strict "$strict" --slurpfile a "$audit" '
  def icon(s): if s=="error" then "❌" elif s=="warn" then "⚠️" else "ℹ️" end;
  . as $all |
  ( [ .[] | select( if $strict==1 then (.severity=="error" or .severity=="warn") else (.severity=="error") end ) ] | length ) as $blockers |
  "# Slidey visual-QA report",
  "",
  ( if $blockers==0 then "**Gate: ✅ PASS**" else "**Gate: ❌ FAIL** — \($blockers) blocking finding(s)" end ),
  "",
  "Spec: `\($a[0].spec // "?")` · frames audited: \($a[0].summary.frames // 0)",
  "",
  "| source | severity | count |",
  "|---|---|---|",
  "| audit (geometry) | error | \([.[]|select(.source=="audit" and .severity=="error")]|length) |",
  "| audit (geometry) | warn  | \([.[]|select(.source=="audit" and .severity=="warn")]|length) |",
  "| vision | error | \([.[]|select(.source=="vision" and .severity=="error")]|length) |",
  "| vision | warn  | \([.[]|select(.source=="vision" and .severity=="warn")]|length) |",
  "| vision | info  | \([.[]|select(.source=="vision" and .severity=="info")]|length) |",
  "",
  ( if ($all|length)==0 then "No defects found. ✅" else
    ( "## Findings (by frame)",
      "",
      "| frame | scene | severity | check | source | detail |",
      "|---|---|---|---|---|---|",
      ( $all
        | sort_by(.frame, (if .severity=="error" then 0 elif .severity=="warn" then 1 else 2 end))
        | .[]
        | "| `\(.frame)` | \(.scene) \(.type) | \(icon(.severity)) \(.severity) | `\(.check)` | \(.source) | \(.detail // "") |" )
    ) end ),
  ""
' > "$out"

echo "wrote $out  (blocking findings: $blockers)"
[ "$blockers" -eq 0 ] || exit 1
