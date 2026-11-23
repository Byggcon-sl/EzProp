---
id: T-0126
tittel: Manglende sted («[sted mangler]») i avviksteksten telles ikke i «Å se over»
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-takstmann
omrade: badet, advarsler
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Godtar takstmannen forhøyet fukt uten målested, får avviksteksten «[sted mangler]», men punktet kan settes ferdig uten advarsel. Teksten kan bli stående til rapporten.

## Slik gjenskapes det
1. Godta forhøyet fukt som TG3 uten målested.
2. Velg kostnad, og trykk «Ferdig».

## Forventet
«Å se over» viser at avviksteksten mangler sted, med knapp til feltet.

## Faktisk
Punktet blir «Ferdig». «[sted mangler]» står i teksten.

## Forslag
Ny advarsel når en avvikstekst har en tom plassholder. Publiseringssperren (når den bygges) bør stoppe samme ting.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-18: funnet
