---
id: T-0120
tittel: Utløpt innlogging på badet sletter teksten, og «Angre» i papirkurven sender til innlogging uten melding
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-robusthet
omrade: innlogging, badet, papirkurv
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Går innloggingen ut mens takstmannen skriver på badet, sendes han til innloggingen og teksten er borte. Det samme mønsteret gjelder «Angre» etter «Fjern»: han havner på innloggingen uten å få vite hva som skjedde. Rettingen av T-0070 tok ikke med disse stedene.

## Slik gjenskapes det
1. Åpne et bad med startet rapport. Slett økten.
2. Skriv i «Beskrivelse av punktet» og gå ut av feltet.
3. Papirkurv: fjern et rom, slett økten, trykk «Angre».

## Forventet
Som rettingen av T-0070: teksten står, og det kommer en dialog «Du er logget ut. Logg inn igjen.». Ved «Angre»: feiltekst og ny «Angre», slik `docs/funksjoner/fase2a-papirkurv.md` linje 48 krever.

## Faktisk
Badet: `/logg-inn?neste=…`, og teksten er borte. `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/actions.ts` linje 87 og 105 bruker `getEmployeeContext`, ikke `getEmployeeContextForAction`. Angre: videresending uten melding (`restoreStructureAction` i `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.ts` linje 380). Rommet ligger i papirkurven og kan hentes derfra.

## Forslag
Bruk samme håndtering som rettingen av T-0070 i alle handlinger på badet og i papirkurven. Rettes sammen med T-0070 (b), som gjelder økt slettet på serveren.

## Etterprøvd
2026-11-18, badet bekreftet og hevet fra lite til middels av kontrolløren. «Angre» er lite og ikke etterprøvd; slått sammen her fordi det er samme feil. Bevis: test-robusthet/expire-*.png og undo-expire-*.png; funn-kontrollor-2/bevis.txt.

## Logg
- 2026-11-18: funnet
- 2026-11-24: gjelder også «Bruk» på et språkvasket felt: med utløpt innlogging sendes takstmannen til innloggingen uten melding, og forslaget forsvinner (main 01fc9e4c, test-robusthet).
