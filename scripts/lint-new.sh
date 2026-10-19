#!/usr/bin/env bash
# Lint findings this change adds: Biome's rule hits per changed file, against the same files at HEAD (new files count from zero).
# bash scripts/lint-new.sh [base-ref]
set -euo pipefail
base="${1:-HEAD}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
files=$( { git diff --name-only "$base" -- '*.ts' '*.tsx'; git ls-files --others --exclude-standard -- '*.ts' '*.tsx'; } | sort -u)
[ -z "$files" ] && { echo "no changed TypeScript files"; exit 0; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp biome.json* "$tmp/" 2>/dev/null || true
for f in $files; do
  if git cat-file -e "$base:$f" 2>/dev/null; then mkdir -p "$tmp/$(dirname "$f")"; git show "$base:$f" > "$tmp/$f"; fi
done
count() { grep -E "^[^ ]+\.tsx?:[0-9]+:[0-9]+ (lint|assist)/" | awk '{print $1" "$2}' | sed -E 's/:[0-9]+:[0-9]+//; s#\\#/#g' | sort | uniq -c; }
# shellcheck disable=SC2086
before=$(cd "$tmp" && npx --prefix "$root" biome check $(cd "$tmp" && ls -d $files 2>/dev/null || true) --max-diagnostics=1000 2>&1 | count || true)
# shellcheck disable=SC2086
after=$(npx biome check $files --max-diagnostics=1000 2>&1 | count || true)
new=$(join -1 2 -2 2 -a 2 -e 0 -o 0,1.1,2.1 <(echo "$before" | grep . | awk '{print $1, $2"|"$3}' | sort -k2) <(echo "$after" | grep . | awk '{print $1, $2"|"$3}' | sort -k2) | awk '$3 > $2 {print $1": "$3-$2" new"}')
if [ -n "$new" ]; then echo "$new" | tr '|' ' '; exit 1; fi
echo "no new lint findings in $(echo "$files" | wc -l) changed files"
