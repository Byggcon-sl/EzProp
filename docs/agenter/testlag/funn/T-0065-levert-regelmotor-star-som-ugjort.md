---
id: T-0065
tittel: Planen viser regelmotoren og reglene for badet som ugjort i 2a-3, selv om de er levert
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: KI i bunnen
commit: e013fde7
forsok: 0
pr:
---

## Hva
To linjer i 2a-3 beskriver regelmotoren og reglene for badet som om de ikke er laget. De ble levert i PR #167. En agent kan bygge det på nytt.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 167 («Regelmotoren som én felles kodepakke …») og 169 («hulltaking nektet gir TGIU …, våtrom fra før 2000»).
2. Les `docs/plan/levert.md` linje 196 (PR #167).

## Forventet
Linjene i 2a-3 sier bare det som gjenstår, med henvisning til det som er levert.

## Faktisk
Levert arbeid står som uavkrysset.

## Forslag
Skriv linje 167 og 169 om til det som gjenstår (nye betingelsestyper, regler for loft og radon, tabeller for levetider og terskler), med henvisning til PR #167 og ADR 0009.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
