---
id: T-0076
tittel: Et usynlig null-tegn i søk eller i et tekstfelt gir databasefeil
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-robusthet
omrade: søk (T2), endre ordre (T1)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Limer den ansatte inn tekst med et usynlig null-tegn, gir søket «Kunne ikke hente listen» og lagringen «Noe gikk galt.» uten å si hvilket felt. Tegnet synes ikke, så det hjelper ikke å prøve igjen.

## Slik gjenskapes det
1. Åpne `/ordre?q=%00` eller `/arbeidskoe?q=%00`.
2. Lim inn tekst med null-tegn (U+0000) i «Borettslag eller sameie» i «Endre ordren», og lagre.

## Forventet
Tegnet fjernes, eller den ansatte får en melding som sier hvilket felt som har et ugyldig tegn.

## Faktisk
«Kunne ikke hente listen. Prøv igjen.» og en feillinje i loggen. Lagring gir «Noe gikk galt.». Ingen persondata i loggen.

## Forslag
Fjern U+0000 og andre styretegn felles i `src/shared`: i `likePattern` og i tekstfeltene i Zod-skjemaene.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
