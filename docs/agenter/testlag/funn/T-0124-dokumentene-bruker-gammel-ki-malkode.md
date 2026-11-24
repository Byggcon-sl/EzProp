---
id: T-0124
tittel: Dokumentene bruker fortsatt den gamle KI-målkoden «answer»
type: feil
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-ki
omrade: dokumenter (KI)
maal: KI i bunnen
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Koden heter `field_answer` (A350), men domenemodellen, ADR 0006 og oppgavekortet for vasken bruker fortsatt `answer`. En kontroll som ADR 0006 lover, er ikke bygget og ikke omtalt som utsatt.

## Slik gjenskapes det
1. Søk etter `answer` i `docs/05-domenemodell.md` linje 1753 og 1770, `docs/adr/0006-ki-i-bunnen.md` linje 142, 195 og 231, og `docs/funksjoner/fase2a-vask-for-ki.md` linje 64, 70, 81 og 135.
2. Les i ADR 0006 at kontrollen av at målet hører til oppdraget kommer «når answers finnes i 2a-2».

## Forventet
Dokumentene bruker `field_answer`. Kontrollen er bygget, eller står som utsatt med en plass i planen.

## Faktisk
Som i stegene. Koden ble dessuten omdøpt, ikke arkivert (regel 6); trolig ufarlig fordi det ikke fantes rapportrader.

## Forslag
Rett ordet i dokumentene, og legg kontrollen av målet inn i «KI i veien» eller som eget punkt.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-18: funnet
- 2026-11-24: `docs/05-domenemodell.md` linje 1754 bruker fortsatt `answer` (main 01fc9e4c).
