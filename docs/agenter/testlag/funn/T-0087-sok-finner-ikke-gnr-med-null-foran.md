---
id: T-0087
tittel: Søket finner ikke ordren når gårdsnummeret er lagret med null foran
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-kontor
omrade: søk (T2)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Søk på «138/2201» finner ikke ordren når gnr er lagret som «0138», selv om dublettregelen regner dem som like.

## Slik gjenskapes det
1. Lag en ordre med gnr 0138 og bnr 2201.
2. Søk på «138/2201» i `/ordre` eller i arbeidskøen.

## Forventet
Ordren blir funnet.

## Faktisk
Ingen treff.

## Forslag
Bruk samme normalisering i søket som i dublettregelen (`normalizeCadastreNumber`), eller fjern nuller foran ved lagring.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-14: funnet
