---
id: T-0127
tittel: Et endret bør-tiltak blir stående når TG byttes til 3, uten advarsel
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-takstmann
omrade: badet, avvik, tiltak
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Har takstmannen skrevet videre på et TG2-tiltak og så velger TG3, står både «bør holdes under oppsyn» og «må skiftes» på avviket. Rapporten kan si to ting om samme forhold.

## Slik gjenskapes det
1. Lag avviket «Sprekker … sanitærutstyr» med TG2.
2. Skriv videre på tiltaket.
3. Velg TG3.

## Forventet
Advarsel «Se over tiltakene, ett hører til TG2».

## Faktisk
Begge tiltakene står uten advarsel. `swapMeasuresForTg` i `save-field.ts` linje 325–380 bytter bare tekst som ikke er endret, og det er riktig, men ingen sier fra.

## Forslag
Advarsel i «Å se over» når et tiltak som hører til en annen TG, er endret og blir stående.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-18: funnet
