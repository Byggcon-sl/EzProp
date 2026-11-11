#!/usr/bin/env bash
# Skriver «kun_dokumenter=true» når endringen mot main bare gjelder dokumenter som ingen test leser,
# og eventuelt versjonsnummeret i package.json. Ellers «kun_dokumenter=false».
# Brukes av CI for å hoppe over de tunge jobbene på rene dokument-PR-er. På main kjøres alltid alt.
#   bash scripts/ci/kun-dokumenter.sh <git-ref>
set -uo pipefail

if [ "${1:-}" = "refs/heads/main" ]; then
  echo "kun_dokumenter=false"
  exit 0
fi

git fetch -q origin main 2>/dev/null || true
base=$(git merge-base HEAD origin/main 2>/dev/null) || { echo "kun_dokumenter=false"; exit 0; }
filer=$(git diff --name-only "$base" HEAD)
if [ -z "$filer" ]; then
  echo "kun_dokumenter=false"
  exit 0
fi

while IFS= read -r fil; do
  case "$fil" in
    package.json)
      # Bare versjonslinjen kan være endret.
      andre=$(git diff -U0 "$base" HEAD -- package.json | grep -E '^[+-][^+-]' | grep -vE '^[+-][[:space:]]*"version":' || true)
      if [ -n "$andre" ]; then echo "kun_dokumenter=false"; exit 0; fi
      ;;
    docs/*|*.md)
      # Et dokument som en test, et skript eller koden leser, må testes.
      if grep -rqF --exclude-dir=git -- "$fil" tests e2e src scripts .github 2>/dev/null; then
        echo "kun_dokumenter=false"; exit 0
      fi
      ;;
    *)
      echo "kun_dokumenter=false"; exit 0
      ;;
  esac
done <<< "$filer"

echo "kun_dokumenter=true"
