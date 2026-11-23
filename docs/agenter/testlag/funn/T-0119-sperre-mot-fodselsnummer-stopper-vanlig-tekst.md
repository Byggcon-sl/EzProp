---
id: T-0119
tittel: Sperren mot fødselsnummer stopper vanlig fagtekst med dato, beløp eller måleverdier
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-robusthet
omrade: fritekst i alle skjemaer
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Tekst med dato og klokkeslett, kostnadsintervall eller en rekke målinger blir stoppet med meldingen om fødselsnummer. Takstmannen må skrive om vanlig fagtekst.

## Slik gjenskapes det
1. Åpne «Beskrivelse av punktet» på badet.
2. Skriv «Befart 12.11.2026 14.30, eier til stede.», «Antatt kostnad 125 000 - 250 000 kr.» eller «Fuktmålinger i vekt-%: 12 14 15 18 20 22».
3. Gå ut av feltet.

## Forventet
Teksten lagres.

## Faktisk
«Teksten ser ut til å inneholde et fødselsnummer. Fjern det.» Omveien er komma mellom tallene. `src/shared/validation/free-text.ts` linje 13–25 fjerner alle skilletegn før testen på 11 sifre.

## Forslag
Slå bare sammen sifre i mønsteret 6+5 (med eller uten mellomrom), krev ordgrense, og legg til kontroll av kontrollsiffer eller dato. Testsaker for eksemplene over. Sperren er personvern (A299), så den må ikke bli svakere for ekte fødselsnummer.

## Etterprøvd
2026-11-18, bekreftet (middels). Bevis: test-robusthet/fnr-dato.png og fnr-kostnad.png; funn-kontrollor-2/bevis.txt.

## Logg
- 2026-11-18: funnet
