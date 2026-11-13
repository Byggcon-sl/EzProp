---
id: T-0023
tittel: Filen med åpne spørsmål har doble avsnitt, feil henvisninger og beslutninger som ikke er merket lett eller dyr
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (åpne spørsmål)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
`docs/09-apne-sporsmal.md` er vanskelig å stole på: innledningen står tre ganger med ulike nummerområder, ett sted sier at forslag i planen ikke skal bygges, og 147 av beslutningene er ikke merket «lett» eller «dyr» å endre. Agentene kan la være å bygge planpunkter, og Ståle må lese alt i stedet for bare de dyre beslutningene.

## Slik gjenskapes det
1. Les de tre første avsnittene under «Avgjort av agentene …»: tre versjoner av samme avsnitt med ulike A-områder.
2. Spørsmål 19 viser til «A69», men statusflyten er A74–A77.
3. Innledningen til «Spørsmål til Ståle» sier at forslagene 41–53 står i planen. Avsnittet rett under og radene 41–53 sier «Ikke i planen; bygges ikke før Ståle sier ja».
4. Noen rader viser til K1, K3 og K4, mens planen bruker S1–S8.
5. Bare A148–A168 er merket «lett» eller «dyrt». Tabellen er ikke sortert etter nummer, og A15 sier fortsatt «foreløpig … Ståle velger i demoen» selv om ADR 0004 er godkjent.

## Forventet
Én innledning, riktige henvisninger, ingen tekst som sier at planpunkter ikke skal bygges, og hver beslutning merket lett eller dyr.

## Faktisk
Som i stegene.

## Forslag
Behold én innledning, rett A69 til A74, skriv om avsnittet og radene 41–53, bytt K-numrene til S-numre, sorter tabellen og oppdater A15. Bruk `docs/agenter/testlag/beslutninger-til-staale.md` til å merke de dyre beslutningene; resten er lette.

## Etterprøvd
Ikke etterprøvd (lite). To funn fra dokumentvakten er slått sammen her.

## Logg
- 2026-11-11: funnet
- 2026-11-13: nytt: spørsmål 77 står to ganger i tabellen «Spørsmål til Ståle» i `docs/09-apne-sporsmal.md` (to like rader).
