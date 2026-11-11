---
id: T-0009
tittel: Endringer på oppdraget og i bygninger forsvinner uten varsel hvis man ikke trykker riktig Lagre-knapp
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-takstmann, test-kontor
omrade: oppdrag, bygninger og areal
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Oppdragssiden har 11 egne Lagre-knapper. Fyller man ut et felt og trykker en annen Lagre-knapp, eller går videre, forsvinner det man skrev uten varsel. Når «Lagre eiendom» trykkes, kommer heller ingen bekreftelse, så man vet ikke hva som ble lagret.

## Slik gjenskapes det
A) På oppdraget:
1. Åpne et oppdrag. Sett «Avtalt befaring» og endre «Festenummer».
2. Trykk bare «Lagre eiendom».
3. Last siden på nytt: datoen er tom.

B) I bygninger:
1. Åpne «Bygninger, areal og rom». Skriv BRA-i 12,5 og en kommentar i en etasje.
2. Trykk «‹ Oppdraget» uten å trykke «Lagre areal».
3. Gå tilbake: arealet og kommentaren er borte.

C) Ingen bekreftelse:
1. Rett adressen på et oppdrag og trykk «Lagre eiendom».
2. Ingen melding vises. Bare linjen «Fylt ut fra ordren» forsvinner.

## Forventet
Feltet lagres selv (slik testskjemaet gjør), eller man får beskjed om at noe ikke er lagret før man går. Etter lagring vises en kort melding, slik «Befaring og frist er lagret.» gjør.

## Faktisk
Som i stegene. Ingen advarsel.

## Forslag
Vis «Ikke lagret» på kortet når noe er endret, og advar før man går fra siden. På sikt: lagre per felt som i testskjemaet. Legg til «Eiendommen er lagret.» i `property-form.tsx`, som i `schedule-card`. Tas med neste oppgave som berører oppdragssiden eller bygninger.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
