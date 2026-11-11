---
id: T-0021
tittel: Forslagsmønsteret står fortsatt i planen og er ikke flyttet til listen over levert arbeid
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Et punkt som er levert og merget, skal flyttes fra planen til listen over levert arbeid. Forslagsmønsteret er merget, men står fortsatt avkrysset i planen. Endringsloggen har også rader i feil rekkefølge.

## Slik gjenskapes det
1. Se `docs/07-utviklingsplan.md`, 2a-1: «[x] Forslagsmønsteret».
2. Søk etter punktet i `docs/plan/levert.md`: ikke der.
3. Se `docs/plan/endringslogg.md`: radene fra 10.11 står nederst i en tabell som kalles «den eldre loggen», mens filen sier «Nyeste øverst».

## Forventet
Punktet står i `levert.md` (PR #131, A166–A168), og endringsloggen har nyeste øverst.

## Faktisk
Som i stegene.

## Forslag
Flytt linjen til `levert.md`, og legg radene fra 10.11 øverst i endringsloggen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
