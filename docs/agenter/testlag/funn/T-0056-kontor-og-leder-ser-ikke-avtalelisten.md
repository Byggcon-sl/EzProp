---
id: T-0056
tittel: Kontoret og lederen kan ikke se avtalelisten, selv om oppgavekortet sier at de skal
type: feil
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-kontor
omrade: avtaler, tilgang
maal: de ansatte
commit: e013fde7
forsok: 0
pr:
---

## Hva
Oppgavekortet for oppdragsgiveravtaler sier at kontor og leder kan se avtalene. De får «Ingen tilgang». Kontoret ser bare navnet på avtalen i nedtrekkslisten på oppdraget, og kan ikke lese periode eller teksten om forutsetninger før det velger.

## Slik gjenskapes det
1. Logg inn som kontor eller leder.
2. Gå til /admin/avtaler.

## Forventet
Listen over avtaler, bare til lesing (tilgangstabellen i `docs/funksjoner/fase2a-oppdragsgiveravtale.md`).

## Faktisk
«Ingen tilgang».

## Forslag
Vis listen og avtalen bare til lesing for den som kan lese organisasjonen, utenfor adminområdet. Eller rett tilgangstabellen i kortet hvis det er meningen at bare admin skal se avtalene (før det i så fall som beslutning). Tilgangen sjekkes i `src/core/access`.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-13: funnet
