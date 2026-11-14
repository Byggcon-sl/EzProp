---
id: T-0088
tittel: Loggen i admin viser endringer uten innhold og med engelske koder
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-kontor
omrade: admin, logg
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Når admin endrer oppbevaringstiden for KI-forslag, viser `/admin/logg` bare «organization – Endret» uten hva som ble endret, selv om loggen har det. Flere linjer står med engelske koder.

## Slik gjenskapes det
1. Som admin: endre oppbevaringstiden på `/admin/ki`.
2. Åpne `/admin/logg`.

## Forventet
Norsk navn på det som ble endret, og gammel og ny verdi.

## Faktisk
«organization – Endret» uten innhold. Andre linjer: «room – Opprettet», «ai_usage_log – Endret», «status: suggested → rejected». `auditEntityLabels` har bare employee, employee_permission, company, office, certification og order.

## Forslag
Legg til norske navn for organization, room og ai_usage_log, og vis nøkkel, gammel og ny verdi for innstillinger.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-14: funnet
