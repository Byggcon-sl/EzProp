---
id: T-0079
tittel: Planen sier feil om hva som er neste, og bruker det gamle ordet «ordreforslag»
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
To linjer i planen stemmer ikke etter Ståles beslutninger 13.11.2026. En agent som leser dem, kan ta feil oppgave.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 79: «Neste: resten av Fra Ståles svar 12.11.2026, deretter badet på PC».
2. Les linje 121: «e-post blir ordreforslag».

## Forventet
Linje 79 sier at neste er testdataene og deretter «rett på oppdrag». Linje 121 bruker ordet oppdragsforslag.

## Faktisk
Som i stegene.

## Forslag
Rett de to linjene, og før endringen i endringsloggen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
