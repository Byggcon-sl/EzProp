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
