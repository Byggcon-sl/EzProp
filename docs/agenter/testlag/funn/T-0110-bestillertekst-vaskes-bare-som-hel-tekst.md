---
id: T-0110
tittel: Navn i «Hvem bestilte», borettslag og ordrenummer vaskes bare som hel tekst før KI
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-ki
omrade: KI (vask før KI)
maal: KI i bunnen
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Navn skal aldri sendes til KI. Står bestilleren som fritekst på oppdraget (det vanligste nå), blir hele navnet vasket, men fornavn eller etternavn alene går gjennom. Det samme gjelder borettslagsnavnet uten første ord, og ordrenummeret med mellomrom. Lekkasjesjekken merker det ikke. Bare den falske KI-tjenesten er på nå.

## Slik gjenskapes det
1. Lag et oppdrag uten å velge kontakt, med «Synnøve Testkisen» i «Hvem bestilte», borettslaget «Testki Fjellstua borettslag» og ordrenummer «TKMEGL-998877».
2. Be om KI-forslag for oppdraget på «Testkisen var med på befaringen.», «Synnøve var med.», «Fjellstua borettslag har felles tak.» og «Ordrenr TKMEGL 998877».

## Forventet
Navnet vaskes ord for ord som andre personnavn. Borettslag og ordrenummer vaskes også i vanlige korte former.

## Faktisk
Teksten går urørt til KI-tjenesten.

## Forslag
Del bestillerteksten ved komma, og send delene uten selskapsform gjennom samme vask som personnavn. Variant av borettslagsnavnet uten første ord. Valgfrie skilletegn i ordrenummeret. Stedet i koden: `src/core/ai/redaction.ts` og `addCompanyPhrase` i `src/core/ai/redact-text.ts`. Tas før ekte KI slås på, gjerne sammen med T-0044 og T-0094.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-17: funnet
