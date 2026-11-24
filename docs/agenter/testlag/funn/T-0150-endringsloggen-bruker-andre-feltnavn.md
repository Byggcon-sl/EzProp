---
id: T-0150
tittel: «Endringer» på oppdraget bruker andre feltnavn enn skjermen, og mister navnet på en sammenslått kontakt
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-kontor
omrade: oppdrag
maal: reklamasjoner
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Endringsloggen skal vise hva som ble endret, men bruker andre navn enn skjemaet, og viser «(fjernet kontakt)» i stedet for navnet når kontakten er slått sammen. Det gjør det vanskeligere å spore hva som skjedde ved en reklamasjon. Hovedmål: færre reklamasjoner og de ansatte.

## Slik gjenskapes det
1. Endre meglerens ordrenummer og borettslag på et oppdrag.
2. Slå sammen bestillerens kontakt med en annen.
3. Åpne «Endringer».

## Forventet
Samme feltnavn som på skjermen, og navnet på kontakten.

## Faktisk
«Ekstern referanse» mot «Meglerens ordrenummer», «Borettslag» mot «Borettslag eller sameie», og «(fjernet kontakt)». Sted: `src/core/assignments/booking/codes.ts` linje 38.

## Forslag
Bruk samme etiketter som skjemaet, og vis navnet fra kontakten også når den er slått sammen.

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-kontor/35-endringer.png.

## Logg
- 2026-11-24: funnet
