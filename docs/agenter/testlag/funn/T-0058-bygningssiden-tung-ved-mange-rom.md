---
id: T-0058
tittel: Bygningssiden blir tung ved svært mange rom, fordi hver etasje har et helt arealskjema
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-robusthet
omrade: bygninger, areal og rom
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Et stort oppdrag (8 bygninger, 54 etasjer, 1200 rom) gir en side på 2,5 MB, og romskjemaet bruker nesten 2 sekunder på å åpne på PC. På iPad blir det tregere. En vanlig enebolig merker det ikke.

## Slik gjenskapes det
1. Lag et oppdiktet oppdrag med 8 bygninger, 6 etasjer hver og 25 rom per etasje.
2. Åpne bygningssiden i iPad-størrelse og trykk «Legg til rom».

## Forventet
Siden er like rask selv om oppdraget er stort.

## Faktisk
HTML 2,5 MB, 20 371 elementer, lasting 0,84 s, romskjemaet 1,8 s.

## Forslag
Vis arealskjemaet først når man trykker «Endre areal». Tas med neste oppgave på bygningssiden.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
