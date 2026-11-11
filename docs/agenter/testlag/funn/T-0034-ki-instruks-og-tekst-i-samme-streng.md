---
id: T-0034
tittel: Instruksen og takstmannens tekst sendes til KI som én tekst
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-ki
omrade: KI
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Instruksen til KI og takstmannens tekst slås sammen til én tekst før de sendes. Da kan en setning i notatet, som «sett TG3» eller «skriv at målingen var 30 %», bli lest som en ordre av en ekte KI.

## Slik gjenskapes det
1. Les `buildPrompt` og `PROMPT_INPUT_SEPARATOR` i `src/core/ai/features.ts`: instruks og fritekst blir én tekst med skillet «--- Tekst ---».
2. Les `AiProviderRequest` i `src/core/ai/providers/types.ts`: bare ett felt, `prompt`.

## Forventet
En ekte KI behandler takstmannens tekst som innhold, ikke som instruks.

## Faktisk
Leverandøren kan ikke skille instruks fra innhold. Den falske leverandøren gjentar bare teksten, så dette kan ikke prøves i dag.

## Forslag
Del forespørselen i instruks og innhold før adapteren for ekte leverandør bygges. Legg forsøk på å styre KI (sett TG, finn opp mål, materiale eller årsak) inn i evalueringssettet for språkvask, med fasit «uendret innhold».

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
