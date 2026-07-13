#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hooks="$(git -C "$root" rev-parse --git-path hooks)"
case "$hooks" in /*) ;; *) hooks="$root/$hooks" ;; esac
mkdir -p "$hooks"
for name in reference-transaction pre-commit; do
  install -m 0755 "$root/scripts/git-hooks/$name" "$hooks/$name"
done
echo "installed protected-main hooks in $hooks"
