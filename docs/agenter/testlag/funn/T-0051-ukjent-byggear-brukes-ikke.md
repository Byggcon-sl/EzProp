---
id: T-0051
tittel: «Ukjent (byggeåret for bygningen brukes)» lover noe regelmotoren ikke gjør
type: feil
alvor: middels
status: ny
funnet: 2026-11-13
rolle: test-fag
omrade: badmalen, regler
maal: reklamasjoner
commit: e013fde7
forsok: 0
pr:
---

## Hva
Når takstmannen velger at alderen på badet er «Ukjent», sier valget at byggeåret for bygningen brukes. Det skjer ikke. Et gammelt bad med ukjent alder får da ikke forslaget om TG3 for sjikt fra før 2000, og takstmannen tror reglene har vurdert det.

## Slik gjenskapes det
1. Lag et bad med ukjent membrantype, tomt årstall for sjiktet, tomt `wet_room.build_year` og kilden «Ukjent».
2. La bygningen ha byggeår 1975.
3. Kjør reglene for badet.

## Forventet
Byggeåret for bygningen brukes, slik valget og `regelverk-krav.md` sier («Er alderen ukjent, brukes byggeåret»). Et bad i et hus fra 1975 gir TG3-forslaget for sjikt fra før 2000.

## Faktisk
Begge aldersreglene gir «ikke vurdert» (`year_missing`). Motoren har bare `wet_room.build_year` som reserve, og datamodellen har ikke byggeår for bygningen. Valget står i `src/db/seed/templates/wet-room.ts` (valget i `wet_room.build_year_source`).

## Forslag
I «Badet på PC»: fyll `wet_room.build_year` med byggeåret for bygningen når kilden er «Ukjent», og vis hvor årstallet kom fra. Krever byggeår på bygningen. Til det finnes, gi valget en tekst som stemmer («Ukjent»). Lag en testsak for tilfellet. Se også spørsmål 78 (d) til fagrådet om TG3 ved anslått eller hentet årstall.

## Etterprøvd
2026-11-13, bekreftet (middels). Funn-kontrolløren kjørte regelen: begge aldersreglene gir `not_evaluated` / `year_missing`, og datamodellen har ikke byggeår for bygningen.

## Logg
- 2026-11-13: funnet
