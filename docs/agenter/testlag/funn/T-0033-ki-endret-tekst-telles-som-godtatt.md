---
id: T-0033
tittel: Når takstmannen retter en godtatt KI-tekst, telles den fortsatt som godtatt uten retting
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-ki
omrade: KI (forslagskortet)
maal: KI i bunnen
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Planen måler KI-nytte som andelen forslag som godtas, endres eller avvises. Skriver takstmannen om en KI-tekst etter «Bruk», telles den fortsatt som godtatt. Da ser KI mer nyttig ut enn den er.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Skriv en setning og trykk «Foreslå bedre språk», så «Bruk».
3. Skriv om hele teksten i feltet.
4. Se linjen under kortet og statusen i `ai_usage_log`.

## Forventet
Raden får status «endret» (`edited`) når en godtatt KI-tekst rettes, slik at «godtatt uten retting» kan telles riktig.

## Faktisk
Status forblir «godtatt». At merket blir stående, er bestemt i A168 og er ikke feil; men følgen for nyttetallet er ikke nevnt der.

## Forslag
Når «Endre og bruk» kommer i 2a-2: endring av en godtatt KI-tekst setter status `edited` (én overgang `accepted` → `edited`). Merket kan bli stående som A168 sier.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
