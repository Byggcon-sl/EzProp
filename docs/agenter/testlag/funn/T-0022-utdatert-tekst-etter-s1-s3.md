---
id: T-0022
tittel: Planen og CLAUDE.md har tekst som ikke stemmer lenger etter at S1–S3 ble gjort
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Flere steder sier planen fortsatt at synken ikke er prøvd på ekte iPad og at fagstoff venter på fagrådet, selv om Ståle sa 10.11.2026 at dette er gjort. CLAUDE.md sier at synkløsningen skal velges i fase 1, men den er valgt.

## Slik gjenskapes det
1. Les risikotabellen nederst i `docs/07-utviklingsplan.md`: «Synk uten nett er ikke prøvd på ekte iPad … Prøve A og B (S2) før 2b», «Azure-oppsettet kan gis til en annen (S1)» og «Alt er utkast til det er godkjent (S3)».
2. Les CLAUDE.md, avsnittet «Teknologi»: «synkløsningen velges i fase 1».

## Forventet
Planen sier bare det som gjelder. CLAUDE.md sier at synken er egenbygd (ADR 0004).

## Faktisk
Teksten motsier «Status nå» i planen. S1–S3 står igjen som overstrøket tekst i listen «Venter på Ståle».

## Forslag
Skriv risikoradene om, ta ut S1–S3 (se også T-0002), og skriv i CLAUDE.md at synken er egenbygd (ADR 0004).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
