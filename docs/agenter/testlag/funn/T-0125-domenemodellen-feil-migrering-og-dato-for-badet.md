---
id: T-0125
tittel: Domenemodellen oppgir feil migrering og dato for badet
type: feil
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-dokumentvakt
omrade: dokumenter (datamodell)
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Domenemodellen sier at kolonnen kom i en annen migrering og at badet ble levert en annen dag enn det ble.

## Slik gjenskapes det
1. Les `docs/05-domenemodell.md` linje 866: `applies_to_tg` «Migrering 0035».
2. Les linje 1094 og 2617: «14.11.2026».

## Forventet
Migrering 0036 og 17.11.2026 (merget).

## Faktisk
Som i stegene.

## Forslag
Rett de tre linjene.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-18: funnet
