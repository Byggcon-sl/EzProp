---
id: T-0018
tittel: Listen over romtyper er ikke delt i grupper
type: feil
alvor: lite
status: lukket
funnet: 2026-11-11
rolle: test-takstmann
omrade: bygninger, rom
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr: kommer
---

## Hva
Når takstmannen legger til et rom, må han lete i én lang liste med 34 romtyper. Oppgavekortet sier at listen skal være delt i grupper.

## Slik gjenskapes det
1. Åpne «Bygninger, areal og rom» på et oppdrag og trykk «Legg til rom».
2. Åpne «Romtype».

## Forventet
Oppgavekortet `docs/funksjoner/fase2a-bygninger-areal-rom.md`: «Romtypen er en nedtrekksliste gruppert etter gruppe».

## Faktisk
34 romtyper i én flat liste, uten grupper (ingen `optgroup`).

## Forslag
Del listen i grupper (for eksempel våtrom, kjøkken, tekniske rom, andre), eller vis de 6–8 vanligste som knapper.

## Etterprøvd
2026-11-14, rettet bekreftet. Funn-kontrolløren så at nedtrekkslisten for romtype har 34 valg i fem grupper: Våtrom (5), Kjøkken (2), Toalett (1), Spesialrom (5) og Andre rom (20). At dialogen «Legg til flere rom» bruker andre grupper, er ført som eget funn (T-0090).

Ikke etterprøvd (lite).

## Logg
- 2026-11-11: funnet
- 2026-11-13: rettet på branch `flere-rom-samtidig`: nedtrekkslisten for ett rom er gruppert med `optgroup` etter romgruppe (`docs/funksjoner/fase2a-flere-rom.md`). PR: kommer
- 2026-11-14: rettet bekreftet av testlaget på main a1ca41d9. Lukket.
