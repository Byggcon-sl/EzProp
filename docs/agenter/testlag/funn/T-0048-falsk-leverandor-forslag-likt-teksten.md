---
id: T-0048
tittel: Den falske KI-leverandøren gir «Forslag klart» når forslaget er likt teksten
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-ki
omrade: KI (falsk leverandør)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
Koblingen til ekte leverandør gir «ingen forslag» når svaret er likt teksten. Den falske gjør ikke det. Da prøves ikke visningen av «ingen endring», og teksten «.» sendes til KI, noe som vil koste penger mot ekte leverandør.

## Slik gjenskapes det
1. På `/prove/ki`, send «.».

## Forventet
Samme regel som for ekte leverandør: likt svar gir «ingen forslag».

## Faktisk
Kortet viser «Forslag klart» med teksten «.».

## Forslag
La den falske leverandøren gi «ingen forslag» når svaret er likt teksten. Vurder krav om minst én bokstav før noe sendes.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
