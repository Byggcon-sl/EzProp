---
id: T-0131
tittel: Sammendraget stoppes hver gang takstmannens egen tekst sier «ikke undersøkt» eller nevner en TG, og meldingen gir KI skylden
type: feil
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-ki, test-fag
omrade: KI, sammendrag
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Står «ikke undersøkt» eller «TG2» i takstmannens egen tekst i et funn, blir «Lag utkast» stoppet hver gang. Meldingen sier at KI endret TG eller la til tall, så takstmannen får ikke vite at det er hans egen tekst som må endres. «Ikke undersøkt bak badekaret» er en vanlig formulering. Hovedmål: de ansatte og KI i bunnen.

## Slik gjenskapes det
1. Bad med startet rapport, punktet «Vanntett sjikt, membran og sluk».
2. Lag et TG3-avvik.
3. Skriv i Årsak «Membranen er fra 1990 og ikke undersøkt bak badekaret», eller i Avvik «Forrige takst satte TG2 på sluket.»
4. Trykk «Lag utkast».
5. Fjern ordene og trykk igjen.

## Forventet
Et utkast, eller en melding som sier hvilket funn som har TG-omtale i teksten.

## Faktisk
Hver gang: «KI-svaret ble stoppet fordi det endret TG eller la til tall. Sammendraget ditt er uendret.» Meldingen står to ganger. Uten ordene kommer utkastet. Loggen får `stopped` med `tg_guard`. Steder: `src/core/ai/guards.ts` linje 151–152, `report-summary-section.tsx`, `room-messages.ts` linje 183–195 (`summaryStoppedText`).

## Forslag
Sjekk TG-omtale i funnene før kallet, og vis en egen melding med punktets navn uten å kalle KI. Eller la vakten bare stoppe TG-omtaler som ikke sto i samme funn. Skill meldingene for `tg_guard` og `number_guard`, og vis meldingen én gang. Legg saken inn i `guard-cases.ts` og `summary_draft.cases.json`. test-fag meldte det samme som forbedring; slått sammen hit.

## Etterprøvd
2026-11-24, bekreftet (middels) av funn-kontrolløren. Fire «Lag utkast»: ok, stopped/tg_guard, stopped/tg_guard, ok. Bevis: test-ki/20-sammendrag-ikke-undersokt.png og 21-logg-sammendrag.txt; test-fag/07-tg-i-avvikstekst.png; funn-kontrollor-1/f3-logg.txt.

## Logg
- 2026-11-24: funnet
