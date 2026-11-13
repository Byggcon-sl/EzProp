---
id: T-0024
tittel: Tilstandsfilen har utdaterte og doble linjer
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (tilstand)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Tilstandsfilen skal bare si det som gjelder nå, men har småfunn som er tatt og status som er gammel. Agentene kan gjøre arbeid som allerede er gjort.

## Slik gjenskapes det
1. Les «Gjeldende oppgave» i `docs/agenter/tilstand.md`: første punkt sier at småfunnene om `ensureSampleAi` og `recordDecision` står, og tredje punkt sier at PR #131 tok dem med.
2. «Trenger Ståle» sier «etter at PR-en … er merget» om synk-secrets, men PR #129 er merget.
3. «Siste kjøring» sier at «Forslagsmønsteret» er i arbeid hos en annen kjøring, men det er merget.

## Forventet
Filen har bare det som gjelder nå.

## Faktisk
Som i stegene.

## Forslag
Prosjektlederen tar bort det som er tatt, skriver om de to linjene og beholder én «Siste kjøring».

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
- 2026-11-12: flere linjer er kommet til (main 11672aa): «Levert: KI-kø uten nett» står to ganger; «Neste i 2a-1: Beslutningsnotat» er utdatert; linjen om KI-leverandør nevner to brancher; «når PR-en for `fase2a-ki-leverandor` er merget» (den er merget som #154); pekeren «(S4–S8)» tar ikke med resten av S1 (første innlogging og iPad).
- 2026-11-13: flere utdaterte linjer på main e013fde7: «PR åpnet: Småfunn etter svarene i reglene» (merget som #180), og «Ingen åpne PR-er» med gammelt klokkeslett; «Svar også på spørsmål 74 og 75» (besvart, I1 og I2) og «når PR-en `microsoft-innlogging` er merget» (merget som #166); «T-0003 må tas før 2a-2» (regelen er rettet); to linjer som motsier hverandre om T-0021; T-0010 og T-0016 omtalt som lukket før de var etterprøvd. «Gjeldende oppgave» har 17 punkter, de fleste levert historikk.
