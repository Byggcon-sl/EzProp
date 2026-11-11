---
id: T-0026
tittel: Ordlisten og datamodellen mangler fire tabeller som finnes i databasen
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (datamodell)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Ordlisten skal ha alle tabellene. Fire mangler, og ett avsnitt viser til feil beslutningsnumre.

## Slik gjenskapes det
1. Hent tabellnavnene fra `src/db/schema` (`pgTable`).
2. Søk etter hvert navn i ordlisten i `docs/05-domenemodell.md`, avsnitt 8.
3. Les avsnitt 4.12 i samme fil.

## Forventet
Alle tabellene står i ordlisten, og 4.12 viser til riktige beslutninger.

## Faktisk
`employee_roles`, `sessions`, `accounts` og `verifications` mangler. 4.12 sier «A158–A164», men A165 hører også til.

## Forslag
Legg inn de fire tabellene, og rett til A158–A165.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
