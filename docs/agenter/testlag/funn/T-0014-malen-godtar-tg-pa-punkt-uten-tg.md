---
id: T-0014
tittel: Malen godtar TG og TG-regler på kontrollpunkter som ikke skal gi TG, og regler som ikke henger sammen
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-fag
omrade: mal
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Malmotoren stopper ikke feil som kan gi feil TG i en rapport: TG på punkter som ikke skal ha TG (el-anlegg, rekkverk, lovlighet), regler som foreslår TG uten noe vilkår, og regler som peker på et annet punkt enn utfallet hører til.

## Slik gjenskapes det
Kjør den rene valideringen som `saveDraftContent` bruker (`src/core/templates/schemas.ts` og `document.ts`), uten database, med en mal som har:
1. Et kontrollpunkt med `gives_tg = false` og utfallet tg3.
2. En regel `suggest_outcome` eller `suggest_tgiu` mot et punkt uten TG.
3. En regel `suggest_outcome` uten `suggested_outcome`.
4. En regel som gjelder punkt A, men foreslår et utfall under punkt B.
5. Et TG3-forslag uten betingelser, eller med «always».

## Forventet
Alle fem avvises med en klar norsk melding. I tillegg: alder alene kan bare gi TG3 for vanntett sjikt i våtrom fra før 2000.

## Faktisk
Alle godtas.

## Forslag
Ta disse kontrollene med i «Automatisk kontroll av malen før publisering» (2a-3), helst før badet legges inn i 2a-2: ingen TG på punkt uten TG, regelen og utfallet på samme punkt, TG-forslag krever betingelse, og `age_vs_lifespan` kan bare gi TG3 for vanntett sjikt i våtrom fra før 2000.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
