---
id: T-0008
tittel: Beslutningstabellen, som er fasit, mangler Ståles beslutninger fra 10.11.2026
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (beslutninger)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Tabellen over Ståles beslutninger er fasit for agentene, men den ble sist oppdatert 28.10.2026. Beslutningene fra 10.11.2026 mangler. Agentene kan da bygge på noe som er gammelt.

## Slik gjenskapes det
1. Åpne `docs/kartlegging/LES-MEG-kartlegging.md`. Øverst står «Sist oppdatert: 28.10.2026».
2. Søk etter Anthropic, S3, ADR 0004, radon og 59a i filen.
3. Les avsnittet om synk (kandidater å teste) og «Neste steg».

## Forventet
Tabellen har radene fra 10.11.2026: testmiljøet er ok (S1), prøvene og ADR 0004 med egenbygd synk er godkjent (S2), fagråd runde 1 og svarene 59a–c (S3), KI-leverandøren Anthropic (S8), og de nye hovedmålene.

## Faktisk
Ingen av radene finnes. Filen sier fortsatt «Kandidater å teste: PowerSync, ElectricSQL …», og «Neste steg» sier at fagråd runde 1 skal gjøres og at fase 0a skal startes.

## Forslag
Legg inn radene fra 10.11.2026 med kilde, og oppdater «Sist oppdatert», synkavsnittet og «Neste steg».

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fant ingen rader for S1, S2/ADR 0004, S3/59a–c eller Anthropic, og fant at «Neste steg» er utdatert.

## Logg
- 2026-11-11: funnet
- 2026-11-12: fortsatt åpent. Nytt: `docs/11-agentlaget.md` linje 62 viser til «Ståle 11.11.2026» (raskere CI), som heller ikke står i beslutningstabellen.
