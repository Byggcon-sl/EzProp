---
id: T-0144
tittel: Vaktene ser ikke at en måling forsvinner, at enheten byttes, eller at «bør» blir «må»
type: forbedring
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
Tallvakten ser bare nye sifre. Fjerner KI en måling, bytter mm til cm, bytter om to årstall eller skriver tall med ord, slipper svaret gjennom. Det er heller ingen vakt mot at «bør» blir «må». A440 sier at tall og enhet skal beholdes. Hovedmål: færre reklamasjoner.

## Slik gjenskapes det
1. Kall vakten med «Målt 18,5 vekt-% fukt i svill» → «Målt fukt i svill.»
2. «5 mm per meter» → «5 cm per meter.»
3. «Badet er fra 1995, membran fra 2005» → årstallene byttet om.
4. «Membranen er gammel» → «… rundt tjue år gammel.»
5. I språkvask: «membranen bør skiftes» → «Membranen må skiftes.»

## Forventet
`number_guard`, eller et tydelig varsel. Bytte av «bør» og «må» stoppes eller varsles.

## Faktisk
Alt slipper gjennom og vises. Bare ledeteksten og evalueringen fanger «bør» og «må» (T-0032 gjelder ledeteksten). Steder: `src/core/ai/guards.ts` linje 130–134 (`hasNewNumber`) og 146–177.

## Forslag
Sammenlign tallene som en liste i rekkefølge med enhet, og ta med tallord. Om «bør» og «må» skal stoppes, er spurt fagrådet (spørsmål 105 i `docs/09-apne-sporsmal.md`). Gjøres før ekte KI, sammen med spørsmål 103. Slått sammen fra to forbedringer.

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-ki/guards-probe.txt.

## Logg
- 2026-11-24: funnet
