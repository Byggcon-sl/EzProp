---
id: T-0015
tittel: Testsakene i malen kan ikke si «ikke vurdert» når data mangler
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-fag
omrade: mal, regler
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
En regel kan i dag bare «slå til» eller «ikke slå til». Mangler alder, dokumentasjon eller måling, ser det ut som «ikke over levetid», og takstmannen får ikke vite at regelen ikke ble vurdert. Da kan et TG2-forslag utebli uten at noen merker det.

## Slik gjenskapes det
1. Se prøve E (`trial-rule-cases.ts`): den har tre svar (slår til, slår ikke til, ikke vurdert).
2. Se `ruleTestCaseSchema` i `src/core/templates/schemas.ts`: bare `expect_triggered` sann eller usann.

## Forventet
En regel som mangler data, gir «ikke vurdert», og det kan prøves med en testsak. Når alderen er ukjent, brukes byggeåret.

## Faktisk
Malen kan bare si «slår til» eller «slår ikke til».

## Forslag
Gi testsakene et tredje svar (ikke vurdert) når regelmotoren bygges i 2a-2, og krev testsaker for tomt felt, verdi lik grensen og manglende dokumentasjon på hver TG-regel.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
