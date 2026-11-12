---
id: T-0046
tittel: Svaret fra KI kontrolleres ikke for ny eller endret TG før det vises og kan brukes
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-12
rolle: test-ki
omrade: KI (kjernen)
maal: reklamasjoner
commit: 11672aa
forsok: 0
pr:
---

## Hva
KI skal aldri sette TG. I dag ligger hindringen bare i instruksen til KI og i evalueringssettet, som kjøres før en funksjon slås på. Når en ekte modell er koblet til, er det ingenting som stopper et svar der KI har lagt til eller endret en TG. Det kan havne i teksten med ett trykk på «Bruk».

## Slik gjenskapes det
1. Les `requestSuggestion` i `src/core/ai/request-suggestion.ts` linje 220–232: svaret går rett videre.
2. Søk etter `extractTgMentions`: finnes bare i `src/core/ai/evals/run.ts`.

## Forventet
Har svaret andre TG-omtaler enn teksten som ble sendt, vises det ikke som forslag (ADR 0006 del 7, regel 14).

## Faktisk
Ingen kontroll av svaret i kjernen. Kan ikke prøves i appen ennå, fordi den falske leverandøren bare gjentar teksten.

## Forslag
Flytt TG-kontrollen til kjernen og kjør den på hvert svar. Vurder det samme for tall som ikke sto i teksten. Tas før første KI-funksjon slås på mot ekte modell.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
