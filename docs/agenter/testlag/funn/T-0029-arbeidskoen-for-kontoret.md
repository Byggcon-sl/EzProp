---
id: T-0029
tittel: Arbeidskøen starter tom for kontoret, og søket viser ikke treff i andre faner
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-kontor
omrade: arbeidskø
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Kontoret og lederen er sjelden på teamet, så arbeidskøen («Mine») er tom hver gang de logger inn. De må trykke «Alle» hver gang. Søker de, sier køen «ingen oppdrag» selv om treffet ligger i en annen fane.

## Slik gjenskapes det
1. Logg inn som kontor eller leder. Arbeidskøen viser 0 i alle faner og «Ingen oppdrag med status Under arbeid.».
2. Ha et oppdrag med status Ferdig på «Testveien». Stå i fanen «Under arbeid», trykk «Alle» og søk «Testveien».

## Forventet
Kontoret ser alle oppdrag med en gang. Er listen tom og andre faner har treff, sier køen det.

## Faktisk
Køen starter tom, og valget huskes ikke. Søket sier «Ingen oppdrag med status Under arbeid.»; bare et lite tall i fanen «Ferdig» viser treffet.

## Forslag
La «Alle» være standard for den som ikke er på noe team (eller for kontorrollen), eller husk siste valg (`parseWorkQueueParams`). Ved tom liste: «Ingen her. 1 treff under Ferdig» med lenke.

## Etterprøvd
Ikke etterprøvd (forbedring). To funn er slått sammen.

## Logg
- 2026-11-11: funnet
