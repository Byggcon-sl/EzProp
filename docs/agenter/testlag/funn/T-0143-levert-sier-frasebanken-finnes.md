---
id: T-0143
tittel: levert.md sier «forslag fra frasebanken», men frasebanken er ikke bygget
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-dokumentvakt
omrade: dokumenter, plan
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Forslagene på badet er malens egne tekster (A482). Frasebanken kommer først i 2a-3. Dokumentene sier noe annet, så Ståle kan tro at frasebanken finnes, og en agent kan bygge det samme to ganger. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Les `docs/plan/levert.md` linje 197, `docs/07-utviklingsplan.md` linje 208 og 212, `docs/plan/forbedrerens-tillegg.md` linje 11 og `docs/05-domenemodell.md` linje 2430.

## Forventet
Dokumentene sier at forslagene kommer fra malen, og planpunktet i 2a-3 sier hva som gjenstår.

## Faktisk
levert.md sier «forslag fra frasebanken». Planpunktet på linje 212 sier ikke hva som gjenstår. Ordlisten sier «godkjente tekster», men de er utkast.

## Forslag
Rett ordlyden og si i 2a-3 at frasebanken skal kobles inn i «Forslag».

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-24: funnet
