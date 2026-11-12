---
id: T-0038
tittel: Dokumentene sier at evaluering mot ekte KI «kommer med adapteren», men den ble ikke levert og står ikke i planen
type: feil
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-dokumentvakt
omrade: KI (dokumenter og plan)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
Før en KI-funksjon kan slås på, skal evalueringssettet kjøres mot den ekte modellen. Programmet tar i dag bare den falske leverandøren. Tre dokumenter sier at dette kom med koblingen til leverandøren, og oppgaven står ikke som punkt i planen.

## Slik gjenskapes det
1. Les `docs/adr/0006-ki-i-bunnen.md` linje 278 og 355, A183 i `docs/09-apne-sporsmal.md` og `docs/10-utviklingsmiljo.md` linje 21.
2. Se `src/core/ai/evals/run.ts` linje 44 og `scripts/ai-eval.ts` linje 17: bare den falske leverandøren.
3. Søk i `docs/07-utviklingsplan.md` etter «evaluering»: ikke noe åpent punkt.

## Forventet
Dokumentene sier hva som er bygget. Utvidelsen står som et punkt i planen (regel 1).

## Faktisk
Tre dokumenter lover noe som ikke er levert. Oppgaven står bare som «liten oppgave» i tilstandsfilen.

## Forslag
Rett ADR 0006, A183 og `docs/10`. Legg inn et planpunkt: evalueringsprogrammet mot ekte leverandør (treffprosent styrer resultatet, kostnad vises, kjøres først etter Ståles ja).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-12: funnet
