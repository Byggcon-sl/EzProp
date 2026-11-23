---
id: T-0113
tittel: TG kan endres på et godtatt regelforslag uten grunn, og loggen sier fortsatt «godtatt»
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-fag
omrade: badet, regelforslag
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Når takstmannen har godtatt et TG3-forslag fra reglene, kan han bytte til TG2 rett i avvikskortet uten å gi grunn. Skjermen og loggen sier fortsatt «Godtatt: TG3». Ved en reklamasjon kan vi da ikke forklare hvorfor graden ble endret.

## Slik gjenskapes det
1. Åpne et bad med startet rapport. Byggeår 1995, sjikt «Folie», årstall for sjiktet tomt.
2. Godta TG3-forslaget på «Vanntett sjikt».
3. Velg TG2 i avvikskortet. Last siden på nytt.

## Forventet
Å bytte TG på et avvik som kom fra et regelforslag, krever grunn på samme måte som «Endre», og gir en ny beslutningsrad `changed` (ADR 0013 punkt 9, A345).

## Faktisk
Avviket blir TG2 uten grunn. `rule_suggestion_decisions` sier fortsatt `accepted` TG3, og skjermen viser «Godtatt: TG3» over et TG2-avvik, også etter omlasting. Bare revisjonsloggen har endringen.

## Forslag
Når TG byttes på et avvik med `suggested_by_rule_id`, åpnes samme valg av begrunnelse som ved «Endre», og det lagres en rad `changed`. Spørsmål 104 (b) til fagrådet: skal det alltid kreve grunn?

## Etterprøvd
2026-11-18, bekreftet (middels) av funn-kontrolløren. Bevis: test-fag/07-godtatt-tg3-men-avvik-tg2.png og 23-beslutninger-mot-avvik.txt; funn-kontrollor-1/f1.log og f1-db.log (i var/, ikke i git).

## Logg
- 2026-11-18: funnet
