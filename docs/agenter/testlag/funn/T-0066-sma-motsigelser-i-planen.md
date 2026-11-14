---
id: T-0066
tittel: Små motsigelser i planen etter 12.11: ulike tall og en linje om et punkt som er levert
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Planen sier «To av ti punkter levert» ett sted og «to av elleve» et annet. En linje sier at første punkt tas før Byggcon-profilen, men det punktet er levert.

## Slik gjenskapes det
1. `docs/07-utviklingsplan.md` linje 76 («To av ti») mot linje 218 («to av elleve»).
2. Linje 140: «Første punkt tas før Byggcon-profilen …». Punktet er levert (PR #174), og første gjenstående er T1.

## Forventet
Samme tall begge steder, og teksten stemmer med punktene som står igjen.

## Faktisk
Som i stegene. At PR #174 mangler i endringsloggen, står i T-0021.

## Forslag
Sett «to av elleve» på linje 76, og skriv på linje 140 at regelpunktet er levert (PR #174).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
- 2026-11-14: tallmotsigelsen er rettet. Linjen om regelpunktet (nå linje 160 i planen) står igjen og sier fortsatt ikke at punktet er levert.
