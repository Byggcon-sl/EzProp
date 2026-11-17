---
id: T-0097
tittel: Domenemodellen har både gammel og ny tekst om hvor bestillingen ligger
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (domenemodell og ordliste)
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Domenemodellen er fasit for datamodellen. Etter ADR 0011 og 0012 står gammel tekst (bestillingen ligger på ordren) side om side med ny (oppdraget eier bestillingen). Den nye teksten sier selv at den gjelder, men en agent kan likevel lese bestilleren fra ordren eller legge til et felt som finnes.

## Slik gjenskapes det
Les `docs/05-domenemodell.md`:
1. Linje 315–316: sammenslåing av kontakter flytter bare bestilleren på ordren. Koden flytter også den på oppdraget (A317).
2. Linje 435 og 508: «venter … på oppdraget» og «adresse og matrikkel er tekst på ordren til da». Feltene finnes nå på oppdraget.
3. Linje 535: «Bestilleren leses alltid fra ordren.»
4. Linje 551: avtaleforslaget går via ordren. Koden bruker oppdragets bestiller.
5. Linje 380: ekstern referanse beskrevet som «saksnummer fra oppdragsgiver», skjemaet sier meglerens ordrenummer.
6. Ordlisten linje 2097–2099: grunn for avvisning er fritekst. Nå er det fast kode, med fritekst bare ved «annet».

## Forventet
Fasiten sier én ting.

## Faktisk
Som i stegene.

## Forslag
Rett eller stryk linjene, og ta bort setningen om at ny tekst «erstatter tidligere tekst» når de er rettet. Likner T-0067 og T-0075.

## Etterprøvd
2026-11-17, bekreftet, satt ned til lite (den nye teksten sier selv at den gjelder).

## Logg
- 2026-11-17: funnet
