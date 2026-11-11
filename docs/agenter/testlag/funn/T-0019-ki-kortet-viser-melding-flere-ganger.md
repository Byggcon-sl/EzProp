---
id: T-0019
tittel: Samme melding står to–tre ganger i KI-kortet
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-takstmann
omrade: KI (forslagskortet)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Etter «Behold min tekst» står «Du beholdt din tekst.» to ganger. Uten nett står «Krever nett. Teksten din er lagret og kan skrives videre.» tre ganger, synlig eller for skjermleser. Det forstyrrer, særlig for den som bruker skjermleser.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`. Lag et forslag.
2. Trykk «Behold min tekst», eller slå av nettet.

## Forventet
Én melding per tilstand.

## Faktisk
Meldingen står to eller tre ganger.

## Forslag
Én melding per tilstand, og skjermlesertekst i bare ett `aria-live`-område i det felles kortet (`src/shared/ui/ai-suggestion.tsx`). Rettes før kortet brukes i 2a-2.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
