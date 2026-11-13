---
id: T-0064
tittel: «Venter på Ståle» ber ham svare på spørsmål han alt har svart på, og mangler to ting bare han kan gjøre
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (plan, tilstand)
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
S8 i planen ber Ståle svare på spørsmål 54–58 og 73 og vurdere forslag 64, men de ble besvart 12.11.2026. Valget om tofaktor før ekte data og kontrollen av fuktgrensen og levetidene mot NS 3600:2025 står bare i tilstandsfilen, ikke i S-listen.

## Slik gjenskapes det
1. Les S8 i `docs/07-utviklingsplan.md` (ca. linje 92).
2. Les linje 229 i samme fil: «Spørsmål 54–58 og 73 er besvart 12.11.2026». Se også svarfilen `svar-fra-stale-2026-11-12.md` (K9 svarer på forslag 64).
3. Let i S1–S8 etter tofaktor (I2, I3) og kontrollen av tallene (F3).

## Forventet
S8 viser bare det som gjenstår (EU/EØS-vei, databehandleravtale, nøkkel, beløpsgrense, valg av tale-leverandør). Tofaktor og F3-kontrollen står i S-listen.

## Faktisk
S8 ber om svar som er gitt. Tofaktor og F3-kontrollen mangler i S-listen.

## Forslag
Skriv S8 om til det som gjenstår, og legg tofaktor og F3-kontrollen inn som S-punkter. Ta det sammen med T-0002 og T-0022.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
