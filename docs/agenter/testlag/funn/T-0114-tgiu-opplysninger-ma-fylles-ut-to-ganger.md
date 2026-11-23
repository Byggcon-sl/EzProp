---
id: T-0114
tittel: TGIU-opplysningene må fylles ut to ganger, og de to stedene kan si ulike ting
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-fag, test-takstmann
omrade: badet, TGIU, mal
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Når hulltaking ikke er utført, spør badet om begrunnelse, risiko og annen fuktundersøkelse både i registreringen og i TGIU-delen. Takstmannen skriver det samme to ganger, og rapporten kan få to ulike svar.

## Slik gjenskapes det
1. Åpne «Tilliggende konstruksjoner» på badet (`?punkt=wet_room.adjacent`).
2. Hulltaking «Ikke utført» og «Eier ga ikke samtykke». Fyll ut registreringen: begrunnelse, risiko, annen fuktundersøkelse (metode og resultat), «Er konstruksjonen skadeutsatt? Ja».
3. Godta TGIU-forslaget.

## Forventet
Opplysningene registreres ett sted.

## Faktisk
TGIU-delen (`tgiu-section.tsx`) spør om det samme i sju felt som alle sier «Fyll ut dette for TGIU». «Skadeutsatt» er Ja/Nei i malen (`src/db/seed/templates/wet-room.ts` linje 220–241) og Ja/Nei/Vet ikke i TGIU-delen. Feltene i malen har `show_in_report: true`, så rapporten kan si to ting. I prøven ble 112 tegn skrevet to ganger. Kontrolløren: oppgavekortet beskriver begge stedene uten å si at de skal henge sammen, så feilen ligger i designet.

## Forslag
Én kilde: TGIU-delen bruker svarene fra malfeltene, eller malfeltene arkiveres (regel 6) og skjules. Spørsmål 104 (c) til fagrådet: er «Vet ikke» godt nok for TGIU?

## Etterprøvd
2026-11-18, bekreftet (middels). Bevis: test-fag/16-tgiu-dobbelt-registrering.png og 17-svar-i-databasen.txt; test-takstmann/shots/40-tgiu-dobbelt.png; funn-kontrollor-1/f2.log.

## Logg
- 2026-11-18: funnet
