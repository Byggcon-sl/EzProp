---
id: T-0142
tittel: Fire beslutninger som er dyre å endre, er merket «lett» (A434, A435, A462, A470)
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-dokumentvakt
omrade: dokumenter, beslutninger
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Fire beslutninger om sammendraget og KI-loggen står som lette å endre, men gjelder en ny kolonne i databasen, sikkerhet og hva publiserte rapporter inneholder. Ståle kan hoppe over dem når han leser de dyre. Samme slags feil som T-0082 og T-0101. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Les `docs/09-apne-sporsmal.md` linje 407, 408, 418 og 426.

## Forventet
A434, A435, A462 og A470 er merket dyre å endre.

## Faktisk
A435 (ny kolonne `reports.summary_basis`), A470 (serveren kontrollerer loggraden fra nettleseren, sikkerhet, som A346), og A434 og A462 (hva sammendraget tar med, fag i publiserte rapporter) er merket «Lett å endre».

## Forslag
Prosjektlederen merker dem dyre. Kvalitetslederen har ført dem i `beslutninger-til-staale.md` 24.11.2026.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-24: funnet
