---
id: T-0089
tittel: «Lagret.» står igjen ved siden av en feilmelding og kommer tilbake ved omlasting
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-ki, test-kontor
omrade: admin KI (K7), endre ordre (T1)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Meldingen om at noe er lagret, står igjen når neste lagring gir feil, og kommer tilbake når siden lastes på nytt. Den ansatte kan tro at det siste ble lagret. Ingen data blir feil.

## Slik gjenskapes det
1. Som admin på `/admin/ki`: lagre 3. Skriv 0 og lagre. Last siden på nytt.
2. Som kontor på en ordre: lagre en endring, gjør så noe som gir feilmelding.
3. Tøm «Mottatt» på ordren og lagre.

## Forventet
«Lagret.» vises bare rett etter en lagring som lyktes, og ikke sammen med en feilmelding.

## Faktisk
«Lagret.» står samtidig med feilmeldingen, og kommer tilbake ved omlasting (`?lagret=1` og `?endret=1` i adressen). Når «Mottatt» tømmes, sier siden «Endringene er lagret.» uten at noe ble endret.

## Forslag
Vis meldingen fra svaret på lagringen i stedet for fra adressen, eller fjern parameteren fra adressen når meldingen er vist.

## Etterprøvd
Ikke etterprøvd (forbedring). To like funn er slått sammen.

## Logg
- 2026-11-14: funnet
