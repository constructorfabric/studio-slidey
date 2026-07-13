#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0
case "$cmd" in *"git checkout"*|*"git switch"*) ;; *) exit 0 ;; esac
deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] && [ -d "$root/.git" ] || exit 0
case "$PWD" in *"/.capsules/workspaces/"*|*"/.capsules/workspaces") exit 0 ;; esac
branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
[ -n "$branch" ] || branch=main
case "$cmd" in
  *"git switch -c"*|*"git switch -C"*|*"git checkout -b"*|*"git checkout -B"*)
    deny "Blocked branch creation in the primary checkout. Work in a claimed capsule under .capsules/workspaces/<id>." ;;
  *"git switch $branch"*|*"git checkout $branch"*) exit 0 ;;
  *"git switch"*|*"git checkout"*)
    case "$cmd" in *" -- "*) exit 0 ;; esac
    deny "Blocked branch switch or detached checkout in the primary checkout. Work in a claimed capsule under .capsules/workspaces/<id>." ;;
esac
