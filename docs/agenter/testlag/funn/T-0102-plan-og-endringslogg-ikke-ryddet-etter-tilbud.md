---
id: T-0102
tittel: Planen og endringsloggen er ikke ryddet etter testdata, «Nytt oppdrag» og «Tilbud»
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Punktene er levert og flyttet til `levert.md`, men planen har fortsatt tomme overskrifter som sier «Tas nå». Endringsloggen mangler linjene om leveransene, og nye linjer står nederst i stedet for øverst. Det blir vanskelig å se hva som gjenstår.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md` linje 145–154: «Prioritert av Ståle 13.11.2026» står uten punkter, med «Tas nå, før punktene under» og «Tas etter testdataene».
2. Søk i `docs/plan/endringslogg.md` etter PR #203, #208, #209 og #217: ingen linje om levert og flyttet.
3. Endringsloggen linje 3 sier at tabellen er «den eldre loggen», men linjer fra 13.–16.11 står nederst i den.
4. `docs/plan/forbedrerens-tillegg.md` sier «PR fylles inn» om noe som kom med PR #217.

## Forventet
Planen sier «Levert (PR …), se levert.md» eller har ikke de tomme overskriftene. Endringsloggen har nyeste linje øverst. PR-nummeret er fylt inn.

## Faktisk
Som i stegene.

## Forslag
Rett i neste læringsløkke. Samme slags feil som T-0077 og T-0079, men andre linjer.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
