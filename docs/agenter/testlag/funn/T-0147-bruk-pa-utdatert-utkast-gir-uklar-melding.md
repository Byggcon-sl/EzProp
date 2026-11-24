---
id: T-0147
tittel: «Bruk» på et utdatert sammendragsutkast gir «Det som ble sendt, kan ikke lagres»
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-robusthet
omrade: KI, sammendrag
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Er funnene endret i en annen fane etter at utkastet ble laget, gir «Bruk» en uklar melding om at noe ikke kan lagres. Takstmannen får ikke vite at han må lage nytt utkast. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Fane A: «Lag utkast».
2. Fane B: fjern avviket.
3. Fane A: «Bruk».

## Forventet
«Funnene er endret etter utkastet. Lag nytt utkast.» (teksten `summaryChanged` finnes alt).

## Faktisk
«Det som ble sendt, kan ikke lagres. Sjekk feltet». Sted: `src/core/reports/summary.ts` linje 565–573 (`checkedBasis`).

## Forslag
Gi egen feilkode når grunnlaget er utdatert, og vis teksten som finnes.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-24: funnet
