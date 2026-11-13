---
id: T-0061
tittel: Feilskrevet årstall (for eksempel 208 eller 5) gir forslag om TG3
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-fag
omrade: regler, felt i badmalen
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Skriver takstmannen et urimelig årstall, for eksempel 208, regnes sjiktet som fra før 2000 og gir TG3-forslag. Avviksteksten blir «registrert som fra 208». En urimelig fuktmåling (999 vekt-%) gir også forslag.

## Slik gjenskapes det
1. Lag et bad med årstall 208 eller 5 for sjiktet, eller fuktmåling 999 vekt-%.
2. Kjør reglene.

## Forventet
Et urimelig årstall gir «ikke vurdert», og feltet stopper eller varsler om verdien.

## Faktisk
TG3-forslag for sjikt fra før 2000, og forslag om forhøyet fukt ved 999 vekt-%.

## Forslag
Sett nedre og øvre grense på feltene (årstall for eksempel 1850 til befaringsåret, fukt 0–100), og la motoren gi «ikke vurdert» under nedre grense. Legg til testsaker. Gjelder også småfunnet om `readYear` i tilstandsfilen.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-13: funnet
