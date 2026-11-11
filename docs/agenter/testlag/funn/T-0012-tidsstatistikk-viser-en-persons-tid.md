---
id: T-0012
tittel: Tidsstatistikken viser i praksis én persons arbeidstid når få oppdrag telles
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-kontor
omrade: statistikk
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Tidsstatistikken skal aldri vise tall per person (A124 og arbeidsmiljøloven kapittel 9). Men med bare ett eller noen få ferdige oppdrag ser lederen i praksis hvor lang tid én bestemt ansatt brukte.

## Slik gjenskapes det
1. Som kontor: åpne et nytt oppdrag i et par minutter og sett det til Ferdig.
2. Logg inn som leder og åpne `/statistikk/tid`.

## Forventet
Ingen tall vises når så få oppdrag telles at man kan se hvem som jobbet.

## Faktisk
«Ferdige oppdrag med målt tid: 1» med «Forberedelse 2 minutter». Med ett oppdrag og kjent team er det én persons tid.

## Forslag
Vis tall først når minst 5 oppdrag telles. Ellers: «For få ferdige oppdrag til å vise tall.»

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
