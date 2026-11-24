---
id: T-0148
tittel: Språkvask sender malens urørte tekster til KI, og «Ingen endring» blir stående som åpent forslag
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-takstmann
omrade: KI, badet
maal: KI i bunnen
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Et avvik fra malen som ikke er endret, sendes likevel til KI når takstmannen trykker «Språkvask avviket». Det gir fire kall og «0 forslag», og radene i loggen står som åpne forslag for alltid. Mot ekte leverandør koster det penger, og tallene for KI-bruk blir feil. Samme tanke som T-0048. Hovedmål: KI i bunnen.

## Slik gjenskapes det
1. Legg til et avvik fra malen uten å endre teksten.
2. Trykk «Språkvask avviket».
3. Se i `ai_usage_log`.

## Forventet
Malens urørte tekster sendes ikke. Svar uten endring lukkes i loggen.

## Faktisk
Fire kall, «0 forslag», og radene står som `suggested`. Steder: `polish-deviation.tsx`, `src/core/reports/polish.ts`.

## Forslag
Ikke send felt som er like malens tekst. Lukk rader med «Ingen endring» (for eksempel som `rejected` eller eget utfall etter vurdering).

## Etterprøvd
Ikke etterprøvd (forbedring). Bevis: test-takstmann/db-polish-template.txt.

## Logg
- 2026-11-24: funnet
