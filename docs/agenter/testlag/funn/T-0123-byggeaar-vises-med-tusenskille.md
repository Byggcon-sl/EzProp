---
id: T-0123
tittel: Byggeåret vises som «1 990» når badet bare kan leses
type: feil
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-kontor
omrade: badet, visning
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Når kontoret åpner badet uten å kunne skrive, står byggeåret med mellomrom som et tall i tusener. Kan havne i rapporten på samme måte.

## Slik gjenskapes det
1. Logg inn som kontor, og åpne badet i Prøvegata 12 B.
2. Se på «Generelt».

## Forventet
«1990».

## Faktisk
«1 990». `answer-field.tsx` linje 49–50 bruker `formatDecimal` (`labels.ts` linje 43–55).

## Forslag
Årstall vises uten tusenskille. Sjekk også regelbegrunnelsene (`labels.ts` linje 320) og PDF-en når den bygges.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-18: funnet
