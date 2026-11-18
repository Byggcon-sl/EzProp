---
id: T-0130
tittel: Hver lagring av et felt på badet sender hele rommet tilbake
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-robusthet
omrade: badet, ytelse
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Når ett felt lagres, sendes hele rommet tilbake til nettleseren. Med mange avvik blir det mye data per tastetrykk, som kan merkes på iPad over mobilnett.

## Slik gjenskapes det
1. Lag et bad med 100 avvik.
2. Lagre ett felt, og se på svaret i nettverksfanen.

## Forventet
Svaret er lite (bare det som er endret), eller målt og godkjent på iPad over mobilnett.

## Faktisk
Ca. 97 KB per lagring med 100 avvik. Siden er 1,2 MB. Et punkt med 50 avvik åpner på ca. 0,5 s, så det er ikke tregt på PC.

## Forslag
Mål på iPad over mobilnett før S2 (prøve på ekte iPad). Send bare endringen hvis det er tregt.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-18: funnet
