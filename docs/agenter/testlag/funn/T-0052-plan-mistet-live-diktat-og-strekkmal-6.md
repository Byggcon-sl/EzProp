---
id: T-0052
tittel: Planen har mistet Ståles beslutninger fra 12.11 om live diktat og strekkmål 6 (KI-briller)
type: feil
alvor: middels
status: ny
funnet: 2026-11-13
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: KI i bunnen
commit: e013fde7
forsok: 0
pr:
---

## Hva
Ståle bestemte 12.11.2026 at diktat skal skje live mens takstmannen snakker, i det vanlige befaringsbildet, og at KI-briller er strekkmål 6. En senere PR (#174) ble flettet med en eldre utgave av planen og satte den gamle teksten tilbake. Fase 2b kan da bli bygget mot det motsatte av det Ståle vil.

## Slik gjenskapes det
1. Se planen før PR #174: `git show c4b8bfc7:docs/07-utviklingsplan.md` har «live diktat … i det vanlige befaringsbildet» (fase 2b) og strekkmål 6.
2. Se `git show c4afc1a3 -- docs/07-utviklingsplan.md`: teksten byttes tilbake til «Opptaket lagres uten nett, og når nettet er tilbake, fordeles det …», «Fem strekkmål» settes tilbake, og rad 6 fjernes.
3. Søk etter «live diktat» og «KI-briller» i `docs/`: bare endringsloggen (linje 73–75) har treff.

## Forventet
Planen viser Ståles beslutninger fra 12.11.2026 (PR #171–#173): live diktat i det vanlige befaringsbildet, og seks strekkmål med KI-briller som nummer 6.

## Faktisk
Fase 2b har den gamle teksten, planen sier «Fem strekkmål», og beslutningene finnes bare i endringsloggen, som sier at de står i planen.

## Forslag
Hent tilbake linjene fra c4b8bfc7 (fase 2b og strekkmålene). Før beslutningene inn i beslutningstabellen i kartleggingen (se T-0008). Sjekk om andre PR-er bygget på gamle brancher har skrevet over dokumenter, og sammenlign planen med main før merge (diff), så linjer ikke forsvinner ved fletting.

## Etterprøvd
2026-11-13, bekreftet (middels). Funn-kontrolløren fant teksten i c4b8bfc7, så at c4afc1a3 fjernet den, og at main sier «Fem strekkmål».

## Logg
- 2026-11-13: funnet
