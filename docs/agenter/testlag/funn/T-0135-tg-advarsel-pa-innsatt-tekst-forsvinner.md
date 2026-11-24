---
id: T-0135
tittel: Advarselen «Teksten hører til TG2» forsvinner når du bytter punkt, og står ikke i «Å se over»
type: feil
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-takstmann
omrade: KI, badet
maal: reklamasjoner
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Setter takstmannen inn en tekst som hører til en annen TG enn avviket, kommer en advarsel. Den forsvinner så snart han bytter punkt eller laster siden på nytt, og telles ikke i «Å se over». Da kan et TG3-avvik stå med en TG2-tekst i rapporten. Hovedmål: færre reklamasjoner.

## Slik gjenskapes det
1. Bad, «Vanntett sjikt», legg til avviket «Det vanntette sjiktet er ikke tettet mot sluket» (TG3).
2. Skriv «klemring sluk», trykk «Forslag» og «Bytt ut teksten» på TG2-teksten om klemring.
3. Se advarselen.
4. Gå til Ventilasjon og tilbake, eller last siden på nytt.

## Forventet
Advarselen står til takstmannen har rettet eller bekreftet teksten, og den telles i «Å se over».

## Faktisk
Advarselen er borte. Avviket står som TG3 med en TG2-tekst, og «Å se over» teller den ikke. Steder: `phrase-suggestions.tsx`, `deviation-card.tsx`; `src/core/reports/logic/warnings.ts` sjekker ikke avvikets TG mot innsatt tekst.

## Forslag
Regn ut advarselen på serveren i `warnings.ts`, og vis den i «Å se over» og i sjekken før publisering.

## Etterprøvd
2026-11-24, bekreftet (middels) av funn-kontrolløren. Delen om plassholdere som ikke telles i «Å se over», er ført i T-0126. Bevis: test-takstmann/s25.log og shots/25-*.png; funn-kontrollor-2/funn7.log.

## Logg
- 2026-11-24: funnet
