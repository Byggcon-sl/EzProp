---
id: T-0132
tittel: Hver lagring på badet laster hele malen på nytt
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-24
rolle: utvikler
omrade: rapportkjernen, ytelse
maal: de ansatte
commit: 15542ac7
forsok: 0
pr:
---

## Hva
`withRoomWrite` kaller `loadLockedTemplate`, som henter hele maldokumentet med `getTemplateVersion` ved hver lagring. Det tar omtrent 13 ms av omtrent 25 ms per lagring lokalt, og det bruker flere databaseforbindelser samtidig. Publiserte malversjoner endres aldri, så dokumentet kan gjenbrukes.

## Slik gjenskapes det
1. Kjør `pnpm db:seed:testdata` med publisert systemmal i Byggcon (omtrent 1 500 tjenestekall for 47 bad).
2. Mål tiden for `getTemplateVersion` og for én `setCheckpointDone` uten endring.

## Forventet
En lagring av ett felt tar noen få millisekunder på serveren.

## Faktisk
Omtrent 25 ms per lagring, der omtrent halvparten er å laste malen. Hele `seedTestdata` tar 30–55 sekunder lokalt, nær grensen på 60 sekunder i testen.

## Forslag
Hurtigbuffer for maldokumentet per publisert versjon (versjons-id som nøkkel) i serverprosessen. Det gir raskere lagring for takstmennene og kortere seed.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-24: funnet under bygging av testdata del 2
