---
id: T-0059
tittel: «Utført uten funn» og forhøyet fukt kan stå i samme rapport
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-13
rolle: test-fag
omrade: regler, avvikstekster
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Hulltakingen kan stå som «Utført uten funn» samtidig som regelen foreslår avviket forhøyet fukt. Da sier rapporten imot seg selv, og en kjøper eller advokat kan bruke det.

## Slik gjenskapes det
1. Lag et bad med hulltaking «Utført uten funn» og fuktmåling 25 vekt-%.
2. Kjør reglene.

## Forventet
Rapporten sier ikke imot seg selv. Takstmannen blir gjort oppmerksom på motstriden.

## Faktisk
Regelen foreslår forhøyet fukt (TG2 eller TG3), og hulltakingen står fortsatt «Utført uten funn». Ingen advarsel.

## Forslag
Når målingen er lik eller over grensen og hulltakingen står «Utført uten funn», vis en advarsel med forslag om å endre til «Utført med funn» (advarsel, aldri sperre). Om en måling over grensen alltid er et funn, er spurt fagrådet (spørsmål 78 a). Tas med «Badet på PC».

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
