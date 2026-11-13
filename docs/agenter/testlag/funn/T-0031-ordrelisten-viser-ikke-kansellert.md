---
id: T-0031
tittel: Ordrelisten viser ikke at oppdraget er kansellert
type: forbedring
alvor: lite
status: rettet
funnet: 2026-11-11
rolle: test-kontor
omrade: ordre
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr: PR #? (13.11.2026)
---

## Hva
Ordresiden viser «kansellert», men ordrelisten viser et kansellert oppdrag som et vanlig oppdrag. Kontoret kan tro at det er i arbeid.

## Slik gjenskapes det
1. Lag en ny ordre og gjør den om til oppdrag.
2. Kanseller oppdraget med grunn.
3. Gå til `/ordre`.

## Forventet
Raden viser «kansellert», slik ordresiden gjør.

## Faktisk
Raden viser «2026-00006 · Gjort om til oppdrag».

## Forslag
Bruk samme sjekk som ordresiden (`assignmentCancelled`) i listen.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
- 2026-11-13: rettet på branch `rette-ordre-etter-lagring` (PR #?): ordrelisten viser «kansellert» og nummeret uten lenke når oppdraget er kansellert, med samme sjekk som ordresiden (`docs/funksjoner/fase2a-rette-ordre.md` punkt 7).
