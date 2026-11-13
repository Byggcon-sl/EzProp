---
id: T-0060
tittel: Tiltaket på avvik der takstmannen velger TG2 eller TG3, sier alltid «må», også når han velger TG2
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-13
rolle: test-fag
omrade: avvikstekster i badmalen
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Seks avvik i badmalen lar takstmannen velge TG2 eller TG3, men har bare ett tiltak, skrevet med «må». Velger han TG2, krever rapporten et tiltak med «må». Ved TG2 skal det stå «bør».

## Slik gjenskapes det
1. Les tiltakene på utfallene der takstmannen velger TG2 eller TG3 i `src/db/seed/templates/wet-room.ts` (svakt fall, skadet vinyl, sluk ikke tilgjengelig, lav terskel, sprekker i sanitærutstyr, forhøyet fukt).
2. Tenk deg at TG2 velges.

## Forventet
«Bør» ved TG2 og «må» ved TG3.

## Faktisk
Bare «må». Valgt med vilje i oppgavekortet `fase2a-mal-bad.md`, men gir «må» i rapporten når TG2 velges.

## Forslag
Lag to tiltakstekster per slikt utfall (én med «bør», én med «må»), og la valgt TG avgjøre hvilken som brukes, i «Badet på PC». Tekstene er utkast. Spørsmål til fagrådet: 78 (b).

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
