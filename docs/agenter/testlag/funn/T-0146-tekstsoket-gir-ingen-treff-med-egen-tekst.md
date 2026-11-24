---
id: T-0146
tittel: «Forslag» uten nett gir «Ingen treff» så snart feltet har egen tekst
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-ki
omrade: KI, badet, uten nett
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Uten nett, eller med KI av, faller «Forslag» tilbake på tekstsøk. Søket krever at alle ord står i kandidaten, så det gir «Ingen treff» så snart takstmannen har skrevet noe selv. Med nett blinker også «Ingen treff» før KI-listen kommer. Hovedmål: de ansatte.

## Slik gjenskapes det
1. TG3-avvik.
2. Skriv «vann kan trenge inn i bjelkelaget» i Konsekvens.
3. «Forslag» med nett: 5 kandidater.
4. Slå av nettet og trykk «Forslag».

## Forventet
Kandidater som ligner, også uten nett.

## Faktisk
«Ingen treff». Steder: `src/core/reports/logic/phrase-candidates.ts` linje 232–246 og `room-model.ts` linje 560–581.

## Forslag
Ranger etter antall like ord, eller vis kandidatene for avvikets utfall. Ikke vis «Ingen treff» mens KI-listen hentes.

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-ki/40-uten-nett-konsekvens-ingen-treff.png.

## Logg
- 2026-11-24: funnet
