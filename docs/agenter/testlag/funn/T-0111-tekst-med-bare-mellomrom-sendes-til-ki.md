---
id: T-0111
tittel: Tekst med bare mellomrom sendes til KI-tjenesten og gir en rad i loggen
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-ki
omrade: KI (kjernen)
maal: KI i bunnen
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
KI-kjernen stopper tom tekst, men ikke tekst med bare mellomrom. Den sendes til KI-tjenesten og logges. Mot en ekte tjeneste koster det penger uten nytte. Prøvesiden stopper det i nettleseren, men kommende funksjoner kaller kjernen fra serveren.

## Slik gjenskapes det
1. Be kjernen om et forslag med teksten «   » (tre mellomrom), mot den falske KI-tjenesten.

## Forventet
Avvist uten kall og uten rad i loggen.

## Faktisk
KI-tjenesten kalles, og det lages en rad med utfallet «ingen treff».

## Forslag
Sjekk tekst som er tom etter at mellomrom er tatt bort (`hasEmptyValue` i `src/core/ai/request-suggestion.ts`). Kan tas sammen med T-0048.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-17: funnet
