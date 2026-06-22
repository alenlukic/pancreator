#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
status=0
while IFS= read -r -d '' file; do
  if ! node --check "$file"; then
    status=1
  fi
done < <(find src tests -type f -name '*.mjs' -print0 | sort -z)
exit "$status"
