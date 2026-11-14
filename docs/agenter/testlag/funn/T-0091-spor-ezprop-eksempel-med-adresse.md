---
id: T-0091
tittel: Planen sier ikke hvordan «Spør EzProp» kan svare på spørsmål med adresse uten å sende adressen til KI
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (plan), KI
maal: KI i bunnen
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Eksempelet for «Spør EzProp» i planen er «Hva skrev vi om drenering i Fjordveien 3 i 2021?», men planen sier også at adressen ikke sendes til KI. Planen sier ikke hvordan det skal gå sammen.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 307 («Spør EzProp»).
2. Sammenlign med regel 14 i CLAUDE.md (adresse sendes aldri til KI).

## Forventet
Planen sier hvordan adressen håndteres, for eksempel at den byttes med en plassholder før KI, og at oppslaget gjøres lokalt.

## Faktisk
Ikke beskrevet.

## Forslag
Skriv i punktet hvordan adressen håndteres før det bygges, og før beslutningen som A-beslutning.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-14: funnet
