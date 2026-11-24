---
id: T-0149
tittel: Etter sammenslåing av kontakter finner ikke søket oppdraget på navnet til kontakten som ble beholdt
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-kontor
omrade: søk, kontakter
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Når lederen slår sammen to like kontakter, beholder parten på oppdraget det gamle navnet og den gamle e-posten. Søk på navnet som ble beholdt, gir 0 treff, så kontoret finner ikke oppdraget. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Lag kontaktene «Lise Testmegler» og «Lise Test-Megler».
2. Lag et oppdrag med «Lise Test-Megler» som bestiller og megler.
3. Logg inn som leder, slå sammen og behold «Lise Testmegler».
4. Søk «Testmegler» i arbeidskøen.

## Forventet
Oppdraget finnes.

## Faktisk
0 treff. Søket ser bare i friteksten for bestiller og i partens navn og firma (`src/core/assignments/search.ts`).

## Forslag
La søket også treffe navnet på koblet kontakt og firma. (En liste «Oppdrag med denne kontakten» er ny funksjon og er lagt som forslag.)

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-kontor/34-sok-testmegler.png og db-etter-sammenslaing.txt.

## Logg
- 2026-11-24: funnet
