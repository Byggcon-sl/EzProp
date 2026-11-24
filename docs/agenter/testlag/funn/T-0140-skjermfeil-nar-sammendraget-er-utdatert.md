---
id: T-0140
tittel: Feil i nettleseren hver gang badet lastes mens sammendraget er utdatert
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-takstmann
omrade: badet, sammendrag
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Så lenge advarselen om endrede funn står, gir hver lasting av badet en feil i nettleseren, og siden tegnes på nytt. Det kan blinke og gå tregere på iPad. Hovedmål: de ansatte.

## Slik gjenskapes det
1. «Lag utkast», «Bruk».
2. Bytt TG på avviket.
3. Last siden på nytt og se i konsollen.

## Forventet
Ingen feil.

## Faktisk
«Minified React error #418» ved hver lasting. Trolig advarselen om endrede funn i `report-summary-section.tsx`.

## Forslag
Sjekk at advarselen regnes ut likt på server og i nettleseren.

## Etterprøvd
Ikke etterprøvd (lite). Bevis: test-takstmann/hydration.log.

## Logg
- 2026-11-24: funnet
