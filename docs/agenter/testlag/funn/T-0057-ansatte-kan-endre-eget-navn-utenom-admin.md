---
id: T-0057
tittel: En innlogget ansatt kan endre sitt eget visningsnavn og bilde utenom admin, uten lengdegrense
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-robusthet
omrade: innlogging
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Et kall i innloggingsbiblioteket står åpent, så en innlogget ansatt kan endre navnet og bildet som vises i menyen og arbeidskøen. Navnene skal styres av admin. Et svært langt navn gjorde arbeidskøen tung (1,6 MB).

## Slik gjenskapes det
1. Logg inn som vanlig ansatt med kode.
2. Send POST til `/api/auth/update-user` fra appens adresse med nytt navn og en ekstern bildeadresse.
3. Åpne arbeidskøen.

## Forventet
Kallet er stengt (404), slik de andre lukkede kallene er (ADR 0008 punkt 14).

## Faktisk
Svaret er 200. Menyen og arbeidskøen viser det nye navnet. Navnet på den ansatte i organisasjonen er uendret. Et navn på 200 008 tegn ble godtatt.

## Forslag
Legg `/update-user` (og gjerne `/list-accounts` og `/delete-user`) i listen over lukkede kall i `src/core/auth/auth.ts`, med en test som for de andre. Tilstandsfilen nevnte dette som noe som «ser ut til å stå åpent»; nå er det vist. Tas før signering av rapporter, helst med neste oppgave i innloggingen.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
