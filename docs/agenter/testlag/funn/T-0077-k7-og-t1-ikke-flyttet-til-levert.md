---
id: T-0077
tittel: K7 og T1 er levert, men ikke flyttet til «levert» og ikke ført i endringsloggen
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
K7 (oppbevaringstid for avviste KI-forslag) er levert i PR #197 og #204, men står fortsatt avkrysset i planen og ikke i `docs/plan/levert.md`. Endringsloggen mangler «levert og flyttet» for K7 og T1. Planen ser da ut til å ha mer igjen enn den har.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 162 (K7 avkrysset).
2. Søk etter K7 i `docs/plan/levert.md`: ingen treff.
3. Les `docs/plan/endringslogg.md` linje 79 og 89: ingen linje om at K7 og T1 er levert og flyttet.
4. `docs/agenter/tilstand.md` linje 21 lover at neste læringsløkke gjør det; PR #199 og #205 gjorde det ikke.

## Forventet
Levert punkt er flyttet til `levert.md` med samme tekst, og endringsloggen har én linje for det.

## Faktisk
Som i stegene. Samme slags feil som T-0021 og T-0065.

## Forslag
Flytt K7 til `levert.md`, og før «levert og flyttet» for K7 og T1 i endringsloggen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
- 2026-11-18: samme slags feil igjen, ført i T-0102 (main 50fad3e4): planen linje 217 «[x] Papirkurv og angre … (PR for branch papirkurv)» uten #221, ikke i `levert.md` og ingen linje i endringsloggen; linje 242 «[x] Rydding av innloggingsdata» (#222) er ikke flyttet; endringsloggen mangler linje om Mine innlogginger (#228); nye linjer fra 17.11 står i den «eldre» tabellen (linje 105–107); to overskrifter «Fra forbedreren» i 2a-3 (linje 244 og 248); planen sier «Sist oppdatert: 16.11.2026»; regel 3 i planen sier «S1–S8», men listen har S9–S11. Se også T-0121.
