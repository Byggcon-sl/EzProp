---
id: T-0053
tittel: Rommene følger ikke med når etasjen endres til eller fra «under terreng»
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-fag, test-takstmann
omrade: bygninger, rom
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Endrer takstmannen en etasje til «under terreng» (for eksempel til «Kjeller»), eller retter en kjeller til over terreng, blir rommene som alt er lagt inn stående som før, uten varsel. Han må rette hvert rom for hånd. Når kravet om hulltaking i rom under terreng bygges, kan et rom slippe kravet, eller få det feilaktig.

## Slik gjenskapes det
A) Til under terreng:
1. Legg til etasjen «1. etasje» og rommet Stue.
2. Trykk «Endre» på etasjen og velg «Kjeller» (-1 og «Under terreng»). Lagre og last siden på nytt.
3. Stue står fortsatt bare med «BRA-i», uten «Under terreng».

B) Fra under terreng:
1. Legg til etasjen «Kjeller» og rommene Kryperom, Vaskerom og Bad (alle får «Under terreng»).
2. Trykk «Endre» på etasjen, rett navnet til «Sokkel», fjern krysset i «Under terreng» og lagre.
3. Alle tre rommene står fortsatt «Under terreng».

## Forventet
Takstmannen får beskjed om at rommene har en annen verdi enn etasjen, med ett trykk for å endre dem også. Ingen automatisk endring.

## Faktisk
Bare rom som legges til etterpå, følger etasjen. Ingen melding.

## Forslag
Når «under terreng» på en etasje endres, vis «N rom har en annen verdi» med knappen «Endre rommene også» (unntatt kryperom, A239). Lite nå, fordi oppgavekortet og domenemodellen 4.4 bare lover forslag når rommet lages. Blir middels og bør tas før kravet om hulltaking i rom under terreng bygges.

## Etterprøvd
2026-11-13, bekreftet, men dømt som forbedring (lite): oppgavekortet og domenemodellen 4.4 sier bare forslag når rommet lages. Meldt av test-fag (til under terreng) og test-takstmann (fra under terreng); slått sammen hit.

## Logg
- 2026-11-13: funnet
