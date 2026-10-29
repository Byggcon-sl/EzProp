#!/usr/bin/env bash
# Kjøres av GitHub Actions (.github/workflows/oppdater-pr.yml) hver gang main endres.
# Fletter grunnen (som regel main) inn i alle åpne PR-er, så de ikke får konflikt når en annen PR merges.
# - Felles dokumenter (scripts/git/union-filer): begge sider tas med.
# - package.json: løses hvis bare versjonen er i konflikt.
# - Andre konflikter: flettingen avbrytes, PR-en får én kommentar, og hovedløkken retter.
# Etter push startes CI på branchen (push fra Actions starter den ikke av seg selv).
set -uo pipefail

: "${REPO:?REPO mangler}"
ATTR="$(pwd)/scripts/git/union-filer"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch -q origin

prs=$(gh api "repos/$REPO/pulls?state=open&per_page=100" \
  --jq ".[] | select(.head.repo.full_name == \"$REPO\") | \"\(.number) \(.head.ref) \(.base.ref)\"")
if [ -z "$prs" ]; then
  echo "Ingen åpne PR-er."
  exit 0
fi

while read -r nr head base; do
  echo "== PR #$nr: $head <- $base"
  git checkout -q -B "$head" "origin/$head"
  if git merge-base --is-ancestor "origin/$base" HEAD; then
    echo "   Allerede oppdatert."
    continue
  fi
  melding="Flett inn $base automatisk (oppdatering av åpne PR-er)"
  if ! git -c core.attributesFile="$ATTR" merge --no-edit -m "$melding" "origin/$base" >/dev/null 2>&1; then
    konflikter=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
    if [ "$(echo $konflikter)" = "package.json" ] && node scripts/git/versjon-etter-flett.mjs; then
      git add package.json
      git commit -q --no-edit -m "$melding"
    else
      git merge --abort
      echo "   Konflikt som må rettes for hånd: $konflikter"
      merke="<!-- oppdater-pr: $(git rev-parse --short "origin/$base") -->"
      if ! gh api "repos/$REPO/issues/$nr/comments" --jq '.[].body' | grep -qF "$merke"; then
        gh api "repos/$REPO/issues/$nr/comments" -f body="$merke
**Konflikt med $base** i: \`$konflikter\`. Hovedløkken retter den ved neste kjøring. Ikke merge før denne PR-en er grønn igjen." >/dev/null
      fi
      continue
    fi
  fi
  git push -q origin "$head" && echo "   Oppdatert og pushet."
  gh workflow run ci.yml --ref "$head" -R "$REPO" && echo "   CI startet."
done <<<"$prs"
