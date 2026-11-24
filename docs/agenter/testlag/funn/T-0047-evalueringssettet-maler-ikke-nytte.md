---
id: T-0047
tittel: Evalueringssettet måler bare at ingenting ødelegges, ikke om forslagene er til nytte
type: forbedring
alvor: middels
status: rettet
funnet: 2026-11-12
rolle: test-ki
omrade: KI (evalueringssett)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr: PR KI i veien, 23.11.2026
---

## Hva
`pnpm ai:eval` gir 100 % mot den falske leverandøren, som bare gjentar teksten. Ingen av de 30 eksemplene krever at en skrivefeil faktisk rettes. En ekte modell som ikke hjelper, vil også bestå. Før Ståle betaler for en kjøring mot ekte modell, bør «bestått» bety at forslagene er til nytte.

## Slik gjenskapes det
1. Kjør `pnpm ai:eval`: 30 av 30, 100 %.
2. Les `src/core/ai/evals/language_polish.cases.json`: alle sjekker bare at ord står eller ikke kommer til.

## Forventet
Settet har eksempler som krever en faktisk forbedring, og vanskelige eksempler (diktat, motstrid, nesten tom tekst, måleserier). Utskriften sier at resultatet mot falsk leverandør ikke viser kvalitet.

## Faktisk
100 % uten at nytte er målt. Eksempel lp-023 bruker en prøveverdi som bare den falske leverandøren forstår.

## Forslag
Legg til eksempler der en rettet skrivefeil kreves, egne nyttetilfeller, de vanskelige eksemplene og en linje i utskriften. Bytt lp-023. Eksemplene merkes «utkast, ikke godkjent av fagrådet».

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
- 2026-11-23: rettet i PR KI i veien (branch `ki-i-veien`). Settet har skrivefeil som må rettes og nytteeksempler, utskriften sier at resultat mot falsk leverandør ikke viser kvalitet, og lp-023 er byttet ut med en ekte tekst (nektelse og sted står, ingenting legges til). Ingen sak bruker lenger prøveverdier for den falske leverandøren.
