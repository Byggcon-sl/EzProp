---
id: T-0138
tittel: Feltet får aldri merket «Tekst fra KI, godkjent» etter språkvask eller sammendrag
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-takstmann
omrade: KI, badet
maal: KI i bunnen
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Etter «Bruk» står KI-merket bare i forslagskortet, som forsvinner. Feltet viser ikke at teksten kom fra KI, heller ikke etter omlasting. Hovedmål: KI i bunnen.

## Slik gjenskapes det
1. Skriv tekst i Årsak.
2. «Språkvask avviket», «Bruk: Årsak».
3. Se på feltet, og last siden på nytt.
4. Gjør det samme med sammendraget.

## Forventet
Feltet viser KI-merket, også etter omlasting (designet `fase2a-ki-i-veien-design.md` linje 148).

## Faktisk
Ingen merke på feltet. `report-text-field.tsx` har plass til `aiMark`, men ingen i `rom/[roomId]/` sender den inn.

## Forslag
Send inn `aiMark` med usage-id og status fra serveren.

## Etterprøvd
Ikke etterprøvd (lite). Bevis: test-takstmann/shots/13-etter-bruk-arsak.png.

## Logg
- 2026-11-24: funnet
