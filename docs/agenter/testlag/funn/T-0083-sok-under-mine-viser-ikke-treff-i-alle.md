---
id: T-0083
tittel: Takstmann som søker under «Mine», får ikke vite at det finnes treff under «Alle»
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-takstmann, test-robusthet, test-kontor
omrade: arbeidskø, søk (T2)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Søker en takstmann etter et oppdrag han ikke er på teamet til, viser alle faner 0 og «Ingen oppdrag med status Under arbeid.». Han får ikke vite at oppdraget finnes under «Alle», selv om alle takstmenn ser alt (Ståle 27.10.2026).

## Slik gjenskapes det
1. Som kontor: lag et oppdrag uten takstmannen på teamet.
2. Som takstmann (standard «Mine»): søk på oppdragsnummeret eller adressen i arbeidskøen.

## Forventet
«Ingen treff i Mine. Treff i Alle: Bestilt (1)» med lenke. Teksten sier at søket ikke ga treff.

## Faktisk
Alle faner viser 0 og «Ingen oppdrag med status Under arbeid.». Med `mine=0` i adressen vises «Treff i: Bestilt (1)».

## Forslag
Tell også med `mine=0` når «Mine» gir 0 i alle faner, og lag lenken med `queueHref` og `mine=0`.

## Etterprøvd
2026-11-14, funn-kontrolløren så det ved etterprøvingen av T-0029 (nytt, lite). Meldt av tre testere; slått sammen hit.

## Logg
- 2026-11-14: funnet
