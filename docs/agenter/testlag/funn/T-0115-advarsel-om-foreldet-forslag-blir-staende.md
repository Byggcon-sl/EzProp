---
id: T-0115
tittel: Advarselen «Forslaget gjelder ikke lenger» blir stående når avviket er fjernet, så «Å se over» blir aldri tom
type: feil
alvor: middels
status: rettet
funnet: 2026-11-18
rolle: test-takstmann, test-fag
omrade: badet, regelforslag, advarsler
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr: 239
---

## Hva
Advarselen sier at avviket du godtok står fortsatt, også når avviket er borte. Den har ingen knapp og kan ikke fjernes. Falske advarsler gjør at ekte advarsler lettere blir oversett.

## Slik gjenskapes det
1. Hulltaking «Utført med funn», 16 vekt-%.
2. Godta forslaget som TG3.
3. Bytt til «Ikke utført», og godta TGIU med «Fjern avvikene med TG og sett TGIU».

## Forventet
Advarselen forsvinner når avviket er fjernet.

## Faktisk
Advarselen står, telles i «Å se over», har ingen knapp, og «Å se over» kan aldri bli tom. Det samme skjer med et godtatt TG0-forslag som aldri hadde avvik. `suggestion_no_longer_applies` i `src/core/reports/logic/warnings.ts` linje 163–168 sjekker ikke om avviket finnes.

## Forslag
Ta bort beslutninger der avviket er slettet. Egen tekst når forslaget ikke ga avvik (TG0 og TGIU). Henger sammen med T-0117.

## Etterprøvd
2026-11-18, bekreftet (middels, kanskje lite). Bevis: test-takstmann/shots/41-alle-ferdig.png; test-fag/15-foreldet-forslag-tekst-avvik-star.png; funn-kontrollor-1/f3b.log og f3b-db.log.

## Logg
- 2026-11-18: funnet

- 2026-11-24: rettet i PR #239 (branch `rett-forslag-og-avvik`, oppgavekort `docs/agenter/oppgaver/rett-forslag-og-avvik.md`). Testlaget prøver på nytt i neste kjøring.
