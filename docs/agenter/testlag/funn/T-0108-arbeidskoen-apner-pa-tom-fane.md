---
id: T-0108
tittel: Arbeidskøen åpner på tom fane «Under arbeid» selv om nye oppdrag står under «Bestilt»
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-takstmann, test-kontor
omrade: arbeidskø
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Har den ansatte bare oppdrag med status «Bestilt», viser arbeidskøen «Ingen oppdrag med status Under arbeid.». Bare et lite tall på fanen «Bestilt» viser at det finnes noe. Det samme etter «Kanseller oppdraget». Gjelder takstmann, kontor og leder.

## Slik gjenskapes det
1. Logg inn som takstmann med to oppdrag under «Bestilt» og ingen under arbeid.
2. Åpne arbeidskøen.

## Forventet
Den ansatte ser oppdragene sine med en gang, eller får beskjed om hvor de ligger («Ingen under arbeid. Treff i: Bestilt (2)»).

## Faktisk
«Ingen oppdrag med status Under arbeid.»

## Forslag
Vis lenken «Treff i: Bestilt (2)» også uten søk når fanen er tom, eller start på første fane som ikke er tom. Henger sammen med T-0083 (søk under «Mine»), så de kan tas sammen.

## Etterprøvd
Ikke etterprøvd (forbedring). TM-5 og KO-4 er slått sammen hit.

## Logg
- 2026-11-17: funnet
