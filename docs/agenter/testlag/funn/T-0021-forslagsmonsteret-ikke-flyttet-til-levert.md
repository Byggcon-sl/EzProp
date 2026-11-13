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
forsok: 2
pr: rydd-plan-t0021 (12.11.2026)
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
- 2026-11-12: prøvd på nytt på main 11672aa: fortsatt feil. Forslagsmønsteret står nå i `levert.md`, men endringsloggen har igjen nye rader (11.–12.11) nederst i den eldre tabellen, og rad 64 viser til en overflødig branch. Samme mønster på nytt: «[x] Beslutningsnotat om KI-leverandør» står i planen (linje 128) etter at PR #154 er merget, og mangler i `levert.md`. Planen sier «Sist oppdatert: 10.11.2026». Satt tilbake til «ny», forsøk 1.
- 2026-11-12: rettet av prosjektlederen: «Beslutningsnotat om KI-leverandør» flyttet til `levert.md`, radene fra 11.–12.11 flyttet øverst i endringsloggen, «Sist oppdatert» satt til 12.11.2026.
- 2026-11-13: prøvd på nytt på main e013fde7: fortsatt feil. Sju nye rader fra 12.11.2026 står igjen nederst i den eldre tabellen i `docs/plan/endringslogg.md` (linje 70–77), mens filen sier «Nyeste øverst». Leveransen i PR #174 har ingen linje i endringsloggen. Satt tilbake til «ny», forsøk 2. Neste gang: legg de nye radene øverst og sjekk at hver flyttet leveranse har en linje, før PR-en merges. Ved forsøk 3 går funnet til «Trenger Ståle».
