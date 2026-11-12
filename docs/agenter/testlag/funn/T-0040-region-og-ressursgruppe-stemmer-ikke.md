---
id: T-0040
tittel: Driftsdokumentet og personvernerklæringen sier feil region og ressursgruppe for testmiljøet
type: feil
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-dokumentvakt
omrade: dokumenter (drift, personvern)
maal: de ansatte
commit: 11672aa
forsok: 0
pr:
---

## Hva
Testmiljøet kjører i ressursgruppen `rg-ezprop-test2` med databasen i Norway East. Driftsdokumentet og personvernerklæringen sier Sweden Central, og slettekommandoen peker på den gamle gruppen. Databasen er fortsatt i EØS, så dette er feil opplysning, ikke et personvernbrudd.

## Slik gjenskapes det
1. Les S1-raden i `docs/07-utviklingsplan.md` (linje 85).
2. Les `docs/drift/testmiljo-azure.md` linje 3 og 185.
3. Les `docs/personvern/intern-personvernerklaering.md` linje 68.

## Forventet
Dokumentene sier Norway East for databasen og riktig ressursgruppe.

## Faktisk
Som i stegene.

## Forslag
Rett de tre linjene. Si i erklæringen at regionen for drift avgjøres før ekte data.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-12: funnet
