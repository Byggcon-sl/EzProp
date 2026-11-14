---
id: T-0071
tittel: Faller nettet midt i lagring, kommer en engelsk feilside, og det som er skrevet går tapt
type: feil
alvor: middels
status: ny
funnet: 2026-11-14
rolle: test-robusthet
omrade: feilhåndtering (eiendom, rom)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Mister iPaden nettet idet takstmannen lagrer eiendommen eller nye rom, blir hele siden en engelsk standard feilside. Dialogen og det han valgte, forsvinner. «Endre ordren» håndterer dette riktig, men de andre skjemaene gjør det ikke.

## Slik gjenskapes det
1. Åpne `/oppdrag/<id>/bygninger`, trykk «Legg til flere rom» og velg et rom.
2. Slå av nettet.
3. Trykk «Legg til 1 rom i 1. etasje».
4. Det samme med «Lagre eiendom» på `/oppdrag/<id>`.

## Forventet
Norsk melding om at du er uten nett og at ingenting er lagret. Tellere og felt står, slik «Endre ordren» gjør («Du er uten nett. Endringen er ikke lagret.»).

## Faktisk
Hele siden blir «This page couldn’t load. Reload to try again, or go back.» på engelsk. Dialogen og tellerne er borte. Ingenting ble lagret. Det finnes ingen `error.tsx` eller `global-error.tsx` i `src/app`.

## Forslag
Lag norske `error.tsx` og `global-error.tsx`, og bruk samme håndtering av manglende nett som `order-edit-form.tsx` i de andre skjemaene. Hører til kravet om tydelige feilmeldinger i «produksjonsklar» (CLAUDE.md).

## Etterprøvd
2026-11-14, bekreftet (middels). Ikke duplikat.

## Logg
- 2026-11-14: funnet
