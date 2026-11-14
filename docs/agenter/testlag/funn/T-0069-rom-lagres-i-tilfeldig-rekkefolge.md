---
id: T-0069
tittel: Rom som legges til samtidig, står i tilfeldig rekkefølge
type: feil
alvor: middels
status: ny
funnet: 2026-11-14
rolle: test-fag, test-takstmann, test-robusthet
omrade: bygninger og rom (T4)
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Legger takstmannen til flere rom på én gang, kommer de i en annen rekkefølge enn i settet og forhåndsvisningen, og rekkefølgen er ulik fra gang til gang. Rapporten vil hente rommene i samme rekkefølge, så den blir rotete og vanskelig å lese.

## Slik gjenskapes det
1. Logg inn som takstmann og lag et oppdrag med enebolig.
2. Åpne «Bygninger, areal og rom». Legg til en bygning og etasjen «2. etasje» (nr. 2).
3. «Legg til flere rom», velg settet «Bolig, etasje over», trykk «Legg til 5 rom i 2. etasje».
4. Se romlisten, også etter at siden er lastet på nytt.

## Forventet
Samme rekkefølge som settet og forhåndsvisningen: Gang og hall, Soverom 1, Soverom 2, Soverom 3, Bad.

## Faktisk
For eksempel Soverom 2, Gang og hall, Soverom 3, Soverom 1, Bad. Rekkefølgen står fast etter lagring, men er ulik fra gang til gang. «Entré og vindfang 3» kom foran «2». Årsak: alle rommene får samme opprettet-tidspunkt i samme lagring (`addRooms` i `src/core/buildings/service.ts`), og listen sorteres på tidspunkt og deretter på den tilfeldige id-en (`getAssignmentBuildings`).

## Forslag
Gi hvert rom et stigende tidspunkt i `addRooms` (for eksempel `clock_timestamp()`, eller opprettet-tidspunkt pluss i mikrosekunder), eller en fast rekkefølgenøkkel. Legg til en e2e-sjekk av rekkefølgen etter ny lasting. Mål: de ansatte, og færre reklamasjoner når rapporten bruker rekkefølgen.

## Etterprøvd
2026-11-14, bekreftet (middels). Tre testere fant det hver for seg; slått sammen hit.

## Logg
- 2026-11-14: funnet
