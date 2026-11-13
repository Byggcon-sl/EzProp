---
id: T-0055
tittel: Samme kontakt kan legges til to ganger som part med samme rolle, uten varsel
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-kontor
omrade: oppdrag (parter)
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Kontoret kan legge til samme megler to ganger på et oppdrag. Da står megleren to ganger i listene, og når utsendingen kommer, kan han få rapporten og meldingene to ganger.

## Slik gjenskapes det
1. Som kontor: åpne et oppdrag og trykk «Legg til part».
2. Søk opp en kontakt, velg rollen Megler og lagre.
3. Gjør det samme én gang til.

## Forventet
Varsel om at kontakten alt er part med denne rollen, eller at lagringen stoppes.

## Faktisk
Kontakten står to ganger som Megler, begge med Rapport og Kopi krysset av. Reklamasjonsskjemaet viser personen to ganger.

## Forslag
Sjekk i kjernen om samme kontakt og rolle finnes fra før på oppdraget, og gi en melding. Fast regel, ingen KI. Tas med neste oppgave om parter, eller med varsel om dublett (T3).

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
