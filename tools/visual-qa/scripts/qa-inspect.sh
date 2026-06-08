#!/usr/bin/env bash
# Stage 2 (LLM vision): inspect each rendered frame against the defect catalog
# (checks.yaml) and emit an evidence-cited findings.json. Spawns the local
# `claude` CLI as a READ-ONLY agent (no API key, no per-call cost) that opens the
# frame PNGs with its Read tool.
#
# Reliability does NOT come from the model behaving — it comes from structure:
#   • the frame PNGs are the ONLY admissible evidence; every finding cites a
#     frame filename + quotes what is LITERALLY visible;
#   • the deterministic geometry audit (audit.json) is handed to the model as
#     already-known ground truth, so it spends its judgement on what pixels-only
#     can decide (legibility, contrast, balance, cramped diagrams) instead of
#     re-guessing overflow the audit already measured;
#   • an adversarial second pass plays skeptic and may ONLY drop a finding or
#     LOWER its severity — it cannot invent defects (disable with --no-adversary).
#
# This is an LLM-driven review tool by design (it needs vision). It must never be
# wired into the no-LLM automated test suite. render-frames.sh / report.sh (the
# deterministic halves) are testable without a model.
#
# Usage: qa-inspect.sh --frames <dir> --audit <audit.json> --checks <checks.yaml>
#                      --out <findings.json> [--model M] [--no-adversary]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

frames="" audit="" checks="" out="" model="claude-sonnet-4-6" adversary=1
while [ $# -gt 0 ]; do
  case "$1" in
    --frames)       frames="$2"; shift 2 ;;
    --audit)        audit="$2"; shift 2 ;;
    --checks)       checks="$2"; shift 2 ;;
    --out)          out="$2"; shift 2 ;;
    --model)        model="$2"; shift 2 ;;
    --no-adversary) adversary=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v claude >/dev/null 2>&1 || { echo "claude CLI not on PATH" >&2; exit 1; }
command -v jq     >/dev/null 2>&1 || { echo "jq not on PATH" >&2; exit 1; }
[ -d "$frames" ]  || { echo "no such frames dir: $frames" >&2; exit 1; }
[ -f "$audit" ]   || { echo "no such audit json: $audit" >&2; exit 1; }
[ -f "$checks" ]  || { echo "no such checks file: $checks" >&2; exit 1; }
[ -n "$out" ]     || { echo "--out is required" >&2; exit 1; }

frames="$(cd "$frames" && pwd)"
mkdir -p "$(dirname "$out")"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

frame_list="$(cd "$frames" && ls -1 [0-9]*.png 2>/dev/null | sort || true)"
[ -n "$frame_list" ] || { echo "no NN-MM.png frames in $frames" >&2; exit 1; }

# one read-only claude call; echoes the extracted+validated JSON on success,
# returns 1 (no exit) on failure so callers can decide whether it's fatal.
call_claude() { # <promptfile> <label>
  local pf="$1" lbl="${2:-claude}" raw result json
  raw="$(claude -p \
          --output-format json \
          --model "$model" \
          --permission-mode bypassPermissions \
          --allowedTools "Read" \
          --add-dir "$frames" \
          < "$pf")" || { echo "$lbl: claude invocation failed" >&2; return 1; }
  result="$(printf '%s' "$raw" | jq -r '.result // .text // empty')"
  [ -n "$result" ] || result="$raw"
  # Robust: pull the first balanced JSON object even if wrapped in prose/fences.
  json="$(printf '%s' "$result" | node "$here/extract-json.mjs" 2>/dev/null || true)"
  if [ -z "$json" ] || ! printf '%s' "$json" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$result" > "${out%.json}.${lbl}.raw.txt"
    echo "$lbl: no valid JSON in reply; raw saved to ${out%.json}.${lbl}.raw.txt" >&2
    return 1
  fi
  printf '%s' "$json" | jq .
}

# ---------- pass 1: grounded defect review ----------
review_prompt="$tmp/review.txt"
{
  cat <<'HEAD'
You are a meticulous visual-QA reviewer for slide/video frames. You are given:
a DEFECT CATALOG (checks.yaml) naming the defect classes to look for, a set of
rendered frame PNGs, and a deterministic GEOMETRY AUDIT (audit.json) of those
same frames. Your job: report every visual defect you can see, grounded in the
pixels.

EVIDENCE RULES (these make the review trustworthy — follow them exactly):
1. The frame PNG files are the ONLY admissible evidence. Use the Read tool to
   open each frame and look closely. Review EVERY frame in the list.
2. Every finding MUST cite the frame filename and quote what is LITERALLY visible
   that constitutes the defect (the overflowing text, the unreadable label, the
   colliding boxes). Do not infer beyond the pixels. If you cannot point to it in
   a frame, do not report it.
3. Use ONLY the defect ids from the catalog as `check`. Respect each check's
   `not_this` guard — if what you see matches the guard, it is NOT a defect.
   When genuinely unsure, omit the finding rather than guess (false positives
   destroy trust in this tool).
   PROGRESSIVE REVEAL — read this carefully. Frames are named NN-MM.png where MM
   is a reveal STEP within scene NN. Content is revealed step by step, so an
   EARLY step legitimately shows only PART of the scene (e.g. a diagram scene's
   first step shows just the title, with an empty stage below — that is correct,
   NOT `missing-or-broken`). The audit manifest gives each frame's scene/step.
   Only judge "completeness" (missing content, empty regions) on the HIGHEST step
   number of each scene — the fully-assembled frame. Never report a not-yet-
   revealed element as missing.
4. The geometry AUDIT already lists deterministically-measured defects (off-page,
   box/node overflow, node overlap, off-viewbox, template leaks, tiny text). Those
   are ground truth — you do NOT need to re-report them. Spend your attention on
   what geometry cannot judge: is text actually legible, is contrast adequate, is
   the diagram followable, is the layout balanced, does anything look broken to a
   human. You MAY confirm an audit finding if the frame makes it visually obvious.
5. Severity: copy the catalog's default `severity` for the matched check unless
   the frame clearly warrants otherwise; state your reason in the observation if
   you deviate.

OUTPUT: print ONLY a single raw JSON object (no prose, no ``` fences) of shape:
{
  "overall": "pass|fail",
  "summary": {"frames_reviewed":0,"findings":0,"errors":0,"warnings":0,"info":0},
  "findings": [
    {"frame":"04-02.png","scene":4,"step":2,"check":"illegible-text",
     "severity":"error|warn|info","observation":"<literal, what is visible>",
     "confidence":0.0}
  ],
  "clean_frames": ["00-01.png"]
}
`overall` is "fail" if any finding has severity "error", else "pass". Fill summary
counts to match findings. List frames with no defect in clean_frames.
HEAD
  echo; echo "## DEFECT CATALOG (checks.yaml)"; echo; echo '```yaml'; cat "$checks"; echo '```'
  echo; echo "## GEOMETRY AUDIT (audit.json — deterministic ground truth, already caught)"
  echo; echo '```json'; jq '{summary, frames: [.frames[] | {frame, scene, step, type, title, findings}]}' "$audit"; echo '```'
  echo; echo "## FRAMES TO REVIEW"
  echo "Located in: $frames (Read each by filename). Each is named scene-step (NN-MM.png)."
  echo "$frame_list" | sed 's/^/  - /'
} > "$review_prompt"

nframes="$(echo "$frame_list" | wc -l | tr -d ' ')"
echo "▸ grounded vision review ($model, $nframes frames)…" >&2
if ! call_claude "$review_prompt" review > "$tmp/review.json"; then
  echo "vision review failed to produce valid JSON — aborting" >&2
  exit 2
fi
mv "$tmp/review.json" "$out"

# ---------- pass 2: adversarial verification (downgrade-only) ----------
if [ "$adversary" -eq 1 ]; then
  adv_prompt="$tmp/adversary.txt"
  {
    cat <<'HEAD'
You are an adversarial verifier. Below is a prior visual-QA verdict (JSON) plus
the frames it cites. Your ONLY job is to catch FALSE POSITIVES — reported defects
that the cited frame does not actually show.

For each finding: Read its cited frame and confirm the quoted defect is ACTUALLY
visible there. If it is not (the text is in fact legible, the box does not really
overflow, the layout is fine, it was inferred) then DROP the finding entirely, or
LOWER its severity (error→warn→info) if a milder version is defensible. Rewrite
the observation to state what the frame really shows.

You may ONLY weaken: drop findings or lower severity. NEVER add a new finding and
NEVER raise a severity. Then recompute `overall` (fail iff any error remains),
the summary counts, and clean_frames.

OUTPUT: print ONLY the full revised verdict as a single raw JSON object of the
exact same shape as the input (no prose, no ``` fences).
HEAD
    echo; echo "## PRIOR VERDICT"; echo; echo '```json'; cat "$out"; echo '```'
    echo; echo "## FRAMES"; echo "Located in: $frames (Read them by filename)."
    echo "$frame_list" | sed 's/^/  - /'
  } > "$adv_prompt"

  echo "▸ adversarial verification (false-positive sweep)…" >&2
  # The adversary only refines; if it fails to return JSON, keep the (valid)
  # pass-1 verdict rather than sinking the whole review.
  if call_claude "$adv_prompt" adversary > "$tmp/verified.json"; then
    mv "$tmp/verified.json" "$out"
  else
    echo "  adversary pass unusable — keeping pass-1 verdict" >&2
  fi
fi

echo "wrote $out" >&2
