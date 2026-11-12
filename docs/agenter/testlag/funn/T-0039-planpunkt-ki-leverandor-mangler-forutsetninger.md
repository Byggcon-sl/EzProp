---
id: T-0039
tittel: Planens punkt om KI-leverandør før ekte data mangler to av kravene i ADR 0006
type: feil
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-dokumentvakt
omrade: dokumenter (plan, personvern)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
---

## Hva
ADR 0006 krever fire ting før ekte KI kobles til: avtale, valgt EU/EØS-vei, avklart trening og lagring, og oppdatert personvernerklæring. Planen nevner bare de to første. Punktet kan da krysses av uten at personvernerklæringen er rettet.

## Slik gjenskapes det
1. Les `docs/adr/0006-ki-i-bunnen.md` linje 109.
2. Les `docs/07-utviklingsplan.md` linje 214.
3. Les `docs/personvern/intern-personvernerklaering.md` linje 38 og 66–70: sier at bare den falske leverandøren brukes.

## Forventet
Planpunktet har de samme kravene som ADR-en.

## Faktisk
«Trening og lagring avklart» og «personvernerklæringen oppdatert» mangler i planen.

## Forslag
Legg de to kravene inn i planlinjen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-12: funnet
