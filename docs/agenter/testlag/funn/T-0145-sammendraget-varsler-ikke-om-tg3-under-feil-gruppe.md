---
id: T-0145
tittel: Sammendraget varsler ikke når et TG3-funn mangler så lenge punktets navn står et annet sted, eller når TGIU-linjen mangler grunn
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-fag
omrade: KI, sammendrag
maal: reklamasjoner
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Navnesjekken ser bare etter punktets navn i hele teksten. Har punktet både et TG2- og et TG3-funn, kan TG3-avsnittet slettes uten advarsel. En TGIU-linje uten grunn står også uten advarsel. Begge deler kan gi en rapport der sammendraget ikke stemmer med funnene (A435, A462). Hovedmål: færre reklamasjoner.

## Slik gjenskapes det
1. TG2- og TG3-avvik på «Overflater vegger og himling», TG3 på «Ventilasjon».
2. «Lag utkast», «Bruk».
3. Slett TG3-avsnittet om muggsopp for hånd, og la TG2-avsnittet for samme punkt stå. Varianter: skriv punktets navn i et annet avsnitt, eller flytt avsnittet under TG2-overskriften.
4. Sett TGIU på et punkt uten å fylle ut grunnen, og trykk «Lag utkast».

## Forventet
Advarsel om at et TG3-funn ikke står under TG3. Advarsel om TGIU uten grunn, i samme liste som «N avvik mangler TG».

## Faktisk
Ingen advarsel. `summary_basis` sier fortsatt at funnet er med. Under TGIU står bare punktnavnet. Steder: `src/core/reports/logic/summary.ts` linje 243–254 (`uncoveredSummaryFindings`) og 159–162 (`tgiuSummaryLine`).

## Forslag
Sjekk navnet under riktig gruppeoverskrift, og tell forekomster når punktet har flere funn. Legg advarselen om TGIU uten grunn i samme liste. Slått sammen fra to forbedringer.

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-fag/04-tg3-fjernet-uten-advarsel.png og coverage-probe.txt.

## Logg
- 2026-11-24: funnet
