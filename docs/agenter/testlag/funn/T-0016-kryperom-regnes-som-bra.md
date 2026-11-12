---
id: T-0016
tittel: Kryperom regnes som BRA og «under terreng», og det finnes ikke noe valg for «ikke del av BRA»
type: forbedring
alvor: middels
status: rettet
funnet: 2026-11-11
rolle: test-fag
omrade: bygninger, areal og rom
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr: PR #? (12.11.2026)
---

## Hva
Velger takstmannen romtypen «Kryperom», regnes rommet som innvendig bruksareal og som rom under terreng. Kryperom og lavt uinnredet loft er normalt ikke måleverdige. Feil areal er en vanlig grunn til reklamasjon, og når kravet om hulltaking i rom under terreng bygges, kan det slå til på et kryperom.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne «Bygninger, areal og rom» på et oppdrag.
2. Trykk «Legg til rom» og velg romtypen «Kryperom».
3. Se «Arealtype» og «Under terreng».

## Forventet
Kryperom og uinnredet loft kan føres uten å bli regnet som BRA. Kryperom følger reglene for krypkjeller, ikke kravet om hulltaking for rom under terreng.

## Faktisk
Arealtypen blir BRA-i, og listen har bare BRA-i, BRA-e og BRA-b. «Under terreng» krysses av.

## Forslag
Legg til valget «ikke del av BRA» (eller la arealtypen være tom) for kryperom og uinnredet loft (`src/core/buildings/codes.ts`), og la kryperom følge reglene for krypkjeller. Romtypene er utkast; fagrådet er spurt i `docs/09-apne-sporsmal.md`.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
- 2026-11-12: rettet i PR #? (branch `svar-stale-regler-bygninger`). Rettet etter Ståles svar F6 12.11.2026: ny arealtype «Ikke del av BRA» (`not_bra`), foreslått for kryperom og uinnredet loft (A235, A240). «Under terreng» følger etasjen, og unntaket fra hulltaking knyttes til romtypen kryperom (A239).
