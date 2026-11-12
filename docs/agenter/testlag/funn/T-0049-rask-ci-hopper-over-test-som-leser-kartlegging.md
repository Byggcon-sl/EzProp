---
id: T-0049
tittel: Den raske kontrollen for dokument-PR-er hopper over testen som leser hele `docs/kartlegging/`
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-dokumentvakt
omrade: CI
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
PR-er som bare endrer dokumenter, får en kort kontroll. Skriptet sjekker om en test leser filen med fullt navn. Én test leser hele mappen `docs/kartlegging/` og blir dermed hoppet over. Feilen blir da først synlig på main.

## Slik gjenskapes det
1. Kjør `grep -rqF -- docs/kartlegging/kartlegging-bad.md tests e2e src scripts .github || echo hoppes`: svaret er «hoppes».
2. Se `scripts/ci/kun-dokumenter.sh` linje 29–33 og `src/core/ai/evals/language-polish.eval.test.ts` linje 397–415.

## Forventet
Dokumenter som en test leser, også via mappe, gir full kontroll.

## Faktisk
En PR som bare endrer en fil i `docs/kartlegging/`, får kort kontroll.

## Forslag
Behandle `docs/kartlegging/*` som «må testes» i skriptet.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
