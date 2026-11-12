---
id: T-0010
tittel: Etasjen «Kjeller» får etasjenummer 2 og blir ikke merket «under terreng»
type: forbedring
alvor: middels
status: rettet
funnet: 2026-11-11
rolle: test-takstmann
omrade: bygninger, etasjer
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr: PR #174 (12.11.2026)
---

## Hva
Velger takstmannen forslaget «Kjeller» når han legger til en etasje, blir den etasje nummer 2 over terreng. Lagrer han uten å se etter, får rommene i kjelleren ikke forslaget «under terreng», og det skal senere styre kravet om hulltaking i rom under terreng.

## Slik gjenskapes det
1. Åpne et oppdrag med en bygning som har «1. etasje».
2. Trykk «Legg til etasje».
3. Velg forslaget «Kjeller».

## Forventet
Etasjenummer -1 og «Under terreng» krysset av (kan endres), slik romtypen allerede fyller ut arealtypen.

## Faktisk
Etasjenummer 2 og «Under terreng» ikke krysset av.

## Forslag
Koble etasjeforslagene til nummer og «under terreng»: Kjeller gir -1 og under terreng, Loft gir øverste + 1. Underetasje venter på fagrådet (spørsmål i `docs/09-apne-sporsmal.md`). Forslagene er utkast og kan endres av takstmannen.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
- 2026-11-12: rettet i PR #174 (branch `svar-stale-regler-bygninger`). Rettet etter Ståles svar F7 12.11.2026: «Kjeller» og «Underetasje» gir etasjenummer -1 og «Under terreng» forhåndsvalgt, «Loft» gir høyeste etasje + 1 (A236). Takstmannen kan endre alt.
