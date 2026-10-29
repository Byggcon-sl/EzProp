#!/usr/bin/env bash
# Merger åpne PR-er som er klare (Ståle 29.10.2026: agentene merger selv når alt er grønt).
# Brukes av hovedløkken og av arbeidsflyten «oppgave».
#
#   bash scripts/merge-klare-pr.sh            # alle åpne PR-er som er klare nå
#   bash scripts/merge-klare-pr.sh 12 --vent  # vent på CI for PR 12 (høyst 30 min), merge hvis klar
#
# En PR er klar når: den ikke er merket «venter-pa-stale» og tittelen ikke starter med «Venter på Ståle»,
# GitHub melder ingen konflikt (mergeable_state = clean), og begge CI-jobbene på siste commit er grønne.
# Merges med «Squash and merge» og bare tittelen, så main aldri får modellnavn fra commit-meldingene.
# PR-er som bygger på den mergede branchen, flyttes til grunnen den ble merget inn i.
set -uo pipefail

REPO="${REPO:-Byggcon-sl/EzProp}"
ONLY="${1:-}"
VENT="${2:-}"

klar() {
  local nr="$1" info sha labels title state
  info=$(gh api "repos/$REPO/pulls/$nr") || return 1
  [ "$(echo "$info" | jq -r .state)" = "open" ] || return 1
  title=$(echo "$info" | jq -r .title)
  labels=$(echo "$info" | jq -r '[.labels[].name] | join(",")')
  case "$title" in "Venter på Ståle"*) echo "#$nr venter på Ståle (tittel)"; return 2 ;; esac
  case ",$labels," in *",venter-pa-stale,"*) echo "#$nr venter på Ståle (merke)"; return 2 ;; esac
  state=$(echo "$info" | jq -r .mergeable_state)
  sha=$(echo "$info" | jq -r .head.sha)
  local runs total ok pending
  runs=$(gh api "repos/$REPO/commits/$sha/check-runs" --jq '.check_runs')
  total=$(echo "$runs" | jq 'length')
  ok=$(echo "$runs" | jq '[.[] | select(.conclusion == "success")] | length')
  pending=$(echo "$runs" | jq '[.[] | select(.status != "completed")] | length')
  if [ "$pending" -gt 0 ] || [ "$total" -lt 2 ]; then echo "#$nr: CI ikke ferdig"; return 3; fi
  if [ "$ok" -ne "$total" ]; then echo "#$nr: CI er rød"; return 4; fi
  if [ "$state" != "clean" ]; then echo "#$nr: ikke klar ($state)"; return 5; fi
  return 0
}

merge() {
  local nr="$1" info title head base
  info=$(gh api "repos/$REPO/pulls/$nr")
  title=$(echo "$info" | jq -r .title)
  head=$(echo "$info" | jq -r .head.ref)
  base=$(echo "$info" | jq -r .base.ref)
  gh api -X PUT "repos/$REPO/pulls/$nr/merge" -f merge_method=squash \
    -f commit_title="$title (#$nr)" -f commit_message="" >/dev/null || { echo "#$nr: merge feilet"; return 1; }
  echo "#$nr merget: $title"
  for barn in $(gh api "repos/$REPO/pulls?state=open&base=$head" --jq '.[].number'); do
    gh api -X PATCH "repos/$REPO/pulls/$barn" -f base="$base" >/dev/null && echo "   #$barn flyttet til $base"
  done
}

if [ -n "$ONLY" ]; then
  for _ in $(seq 1 60); do
    klar "$ONLY"; rc=$?
    case $rc in
      0) merge "$ONLY"; exit $? ;;
      3|5) [ "$VENT" = "--vent" ] || exit $rc; sleep 30 ;;
      *) exit $rc ;;
    esac
  done
  echo "#$ONLY: ga opp etter 30 minutter"; exit 3
fi

for nr in $(gh api "repos/$REPO/pulls?state=open&sort=created&direction=asc&per_page=100" --jq '.[].number'); do
  if klar "$nr"; then merge "$nr"; sleep 5; fi
done
