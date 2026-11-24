---
id: T-0139
tittel: Etter «Bruk» på sammendraget viser «Din tekst før» den nye teksten
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-takstmann
omrade: KI, sammendrag
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Etter «Bruk» skal «Din tekst før» vise det takstmannen hadde skrevet, men den viser utkastet. «Angre» gir likevel riktig tekst tilbake. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Skriv «Min gamle tekst.» i Sammendrag.
2. «Lag utkast», så «Bruk».
3. Se på «Din tekst før».

## Forventet
«Min gamle tekst.»

## Faktisk
Utkastet vises. Steder: `report-summary-section.tsx` eller `ai-suggestion.tsx`.

## Forslag
Ta vare på teksten før «Bruk» og vis den.

## Etterprøvd
Ikke etterprøvd (lite). Bevis: test-takstmann/shots/21-din-tekst-for-etter-bruk.png.

## Logg
- 2026-11-24: funnet
