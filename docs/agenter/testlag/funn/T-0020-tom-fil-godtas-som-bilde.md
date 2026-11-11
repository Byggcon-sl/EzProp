---
id: T-0020
tittel: Tom fil og fil som ikke er et bilde, godtas som bilde
type: feil
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-robusthet
omrade: bilder uten nett (testskjema)
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
En tom fil eller en fil som ikke er et bilde, lagres som bilde, og feltet teller som utfylt. I en ekte rapport kan det bli et tomt eller ødelagt bilde uten at noen merker det.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne et nytt testskjema.
2. Velg en tom fil (0 byte) kalt `tom.jpg` i «Tak – bilde».
3. Velg en PDF med navnet `falsk.jpg` i «Yttervegger – bilde».

## Forventet
Appen sier at filen ikke er et bilde, og feltet teller ikke som utfylt.

## Faktisk
Begge lagres (svar 200, størrelse 0 for den tomme). Telleren går opp («3 av 40 felt utfylt»).

## Forslag
Sjekk at filen ikke er tom og er et bilde (de første bytene stemmer med JPEG, PNG eller HEIC), både i nettleseren og i ruten `/api/prove/bilder/[id]`. Vis en klar melding ved feltet. Tas med i den ekte bildeopplastingen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
