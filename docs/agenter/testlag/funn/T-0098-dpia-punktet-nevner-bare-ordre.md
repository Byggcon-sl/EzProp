---
id: T-0098
tittel: DPIA-punktet i planen nevner bare endring av ordre, ikke bestillingen på oppdraget
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (plan), personvern
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Når bestillingen på et oppdrag endres, lagres gammel og ny adresse, matrikkel og bestiller i revisjonsloggen i 10 år. Nesten alle jobber er nå oppdrag, ikke tilbud. Underpunktet om personvernvurdering (DPIA) i planen nevner likevel bare «endring av ordre».

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 267 (DPIA-utkastet skal ta med revisjonsloggen «for endring av ordre»).
2. Se at bestillingen på oppdraget lagres på samme måte (`src/core/assignments/booking/update.ts`, domenemodellen linje 449).

## Forventet
DPIA-punktet nevner både tilbud (ordre) og bestillingen på oppdraget.

## Faktisk
Bare ordre.

## Forslag
Utvid linjen til «ordre (tilbud) og bestillingen på oppdraget». Ta også med at fritekst i avslagsgrunnen for tilbud lagres i revisjonsloggen i 10 år (meldt av test-robusthet). Spørsmål 79 nevner allerede oppdraget (A292). Ikke samme feil som T-0078; de kan rettes sammen.

## Etterprøvd
2026-11-17, delvis bekreftet, satt ned til lite. Spørsmål 79 og A292 er i orden; bare planlinjen stemmer ikke.

## Logg
- 2026-11-17: funnet
