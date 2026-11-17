---
id: T-0100
tittel: Planen sier at nye ideer ikke bygges før Ståle sier ja, men forbedreren kan sette i gang bygging
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: KI i bunnen
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Ståle bestemte 14.11.2026 at det forbedreren foreslår, bygges uten å spørre ham. Planen sier fortsatt det gamle. En agent som leser planen, kan la være å bygge forbedrerens forslag.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 60: «Nye ideer foreslås i docs/09-apne-sporsmal.md. De bygges ikke før Ståle har sagt ja.»
2. Les «Forbedreren» og regel 1 i `CLAUDE.md`.

## Forventet
Planen sier det samme som CLAUDE.md.

## Faktisk
Planen motsier regel 1.

## Forslag
Skriv linjen om etter regel 1 i CLAUDE.md (planen og forbedreren bestemmer; andre ideer blir forslag), og før endringen i endringsloggen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
