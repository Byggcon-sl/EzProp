---
id: T-0134
tittel: Skjermleseren sier «forslaget er brukt» også når «Bruk» feilet
type: feil
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-robusthet
omrade: KI, universell utforming
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Den som bruker skjermleser, får høre at forslaget er brukt selv om det ikke ble lagret (endret av andre eller nettfeil). Hovedmål: de ansatte.

## Slik gjenskapes det
1. Åpne samme bad i fane A og B.
2. A: skriv tekst i Avvik og trykk «Språkvask avviket».
3. B: endre Avvik.
4. A: trykk «Bruk», og les området med `role=status`.

## Forventet
«Endret av andre. Forslaget er ikke brukt.»

## Faktisk
«Avvik: forslaget er brukt.» samtidig med «Endret av andre». Det samme ved nettfeil og ved «Bruk alle». Sted: `src/shared/ui/ai-suggestion-group.tsx` linje 159–176 og 198–203 (`lastAction` settes før resultatet er kjent).

## Forslag
Sett `lastAction` først når `use()` har gitt `true`.

## Etterprøvd
2026-11-24, bekreftet (middels) av funn-kontrolløren. Bevis: test-robusthet/t3-tofaner.txt; funn-kontrollor-2/funn6.log.

## Logg
- 2026-11-24: funnet
