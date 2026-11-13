---
id: T-0054
tittel: «1. etasje» og «2. etasje» fra forslagslisten fyller ikke ut etasjenummer
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-13
rolle: test-takstmann
omrade: bygninger, etasjer
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Velger takstmannen «1. etasje» eller «2. etasje» fra forslagslisten, settes ikke etasjenummer 1 eller 2. Etter en kjeller blir «1. etasje» nummer 0. Velger han først «Kjeller» ved en feil og retter til «2. etasje», blir den lagret som -1 og under terreng, og havner over 1. etasje i listen.

## Slik gjenskapes det
A) Ny bygning: legg til «Kjeller» (-1), deretter «1. etasje»: etasjenummeret blir 0.
B) I en bygning med «1. etasje»: «Legg til etasje», velg «Kjeller» (feiltrykk), rett navnet til «2. etasje», lagre og last på nytt: -1 og «Under terreng».

## Forventet
«1. etasje» gir 1 og «2. etasje» gir 2, uten «under terreng», slik hjelpeteksten sier («første etasje er 1»). Retter man bort fra «Kjeller», settes forslaget tilbake.

## Faktisk
Som i stegene. Neste nummer regnes som høyeste + 1 (0 etter kjeller), og forslaget fra «Kjeller» blir stående når navnet endres. Ingen varsel.

## Forslag
La `suggestFloor` gi «1. etasje» = 1 og «2. etasje» = 2. La endret navn sette tilbake forslaget fra før («Kjeller» → noe annet: nytt nummer og fjern krysset). La neste nummer hoppe over 0, slik «Loft» gjør. Samme område som T-0010 (lukket) og småfunnet om -1 som blir stående i tilstandsfilen.

## Etterprøvd
2026-11-13, gjenskapt, men dømt ikke feil: oppgavekortet `fase2a-svar-regler-bygninger.md` punkt 7 sier at andre forslag gir dagens neste nummer. Kontrolløren anbefaler det som forbedring (lite) innenfor planen.

## Logg
- 2026-11-13: funnet
