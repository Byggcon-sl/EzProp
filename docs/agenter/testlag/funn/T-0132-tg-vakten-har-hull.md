---
id: T-0132
tittel: TG-vakten slipper gjennom to TG-er som bytter plass, romertall, tallord og andre bindestreker
type: feil
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-ki, test-fag
omrade: KI, vakter
maal: reklamasjoner
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Vakten som skal stoppe KI-svar som endrer TG, ser ikke alle måter å skrive TG på. Bytter KI om på TG for to funn, eller skriver «TG III», «TG tre» eller «TG–3», slipper svaret gjennom. I dag gjelder det bare den falske leverandøren, men vakten er det som skal stoppe ekte KI. Hovedmål: færre reklamasjoner og KI i bunnen.

## Slik gjenskapes det
1. Kall `checkAnswerGuards` direkte (`pnpm exec tsx`).
2. Prøv «Sluk TG2. Membran TG3.» → «Sluk TG3. Membran TG2.», og svar med «TG III», «TG tre», «Tilstandsgraden er tre», «TG–IU» (tankestrek), «Tilstands-grad tre».
3. Prøv «sprekk på 3 mm» → «… TG–3» og «… TG:3».

## Forventet
Alle stoppes med `tg_guard`.

## Faktisk
I språkvask slipper alle gjennom. I sammendraget slipper romertall, tallord med bokstaver, tankestrek og «TG:3» gjennom (ombytting og «Tilstandsgraden er tre» stoppes der). Steder: `src/core/ai/guards.ts` linje 17–20 (`TG_MENTION`) og 47–52 (`tgSignature` sorterer omtalene).

## Forslag
Sammenlign TG-omtalene i rekkefølge, ikke sortert. Godta alle bindestreker og kolon, romertall og tallord. Legg sakene i `guard-cases.ts`. Må være gjort før ekte KI slås på.

## Etterprøvd
2026-11-24, bekreftet (middels) av funn-kontrolløren. Ikke duplikat av T-0046 (den grunnleggende vakten finnes nå; dette er hull i den). Bevis: test-ki/guards-probe.txt; test-fag/guards-probe.txt; funn-kontrollor-1/f4-resultat.txt.

## Logg
- 2026-11-24: funnet
