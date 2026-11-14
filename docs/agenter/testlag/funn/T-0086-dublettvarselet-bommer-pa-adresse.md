---
id: T-0086
tittel: Dublettvarselet bommer på adresse i to vanlige tilfeller: annen seksjon og adresse uten komma
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-takstmann, test-robusthet, test-kontor
omrade: ordre, dublettvarsel (T3, A286)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Varselet om mulig dublett slår til for ulike seksjoner i samme bygg, så det kommer på mange ordre i blokker og blir lett oversett. Og det slår ikke til når adressen er skrevet uten komma foran postnummeret, som er vanlig.

## Slik gjenskapes det
A) Annen seksjon:
1. Lag en ordre med «Prøvegata 12 B, H0402, Prøvestad», gnr 102, bnr 7, snr 3.
2. Lag en ny ordre med samme adresse, gnr 102, bnr 7, snr 4.
3. Se: «Mulig dublett … samme adresse».

B) Uten komma:
1. Lag en ordre med «Dobbelveien 1, 9999 Prøvested».
2. Lag en ny ordre med «Dobbelveien 1 9999 Prøvested».
3. Se: ingen varsel.

## Forventet
A) Ingen varsel når begge har seksjonsnummer og de er ulike. B) Varsel, fordi det er samme adresse.

## Faktisk
A) Varsel om samme adresse. B) Ingen varsel. Begge følger regelen i oppgavekortet og A286 («Adresse uten komma brukes i sin helhet»), som er merket lett å endre.

## Forslag
A) Dropp grunnen «adresse» når begge har seksjonsnummer og de er ulike (`src/core/orders/duplicates.ts`). B) Kutt også ved firesifret postnummer, likt i koden, i spørringen og i indeksen, med en test som viser at de gir samme svar. Krever migrering. Endrer agentbeslutningen A286, som føres som ny beslutning.

## Etterprøvd
Ikke etterprøvd (forbedring). To forbedringer er slått sammen.

## Logg
- 2026-11-14: funnet
