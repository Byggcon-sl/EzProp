---
id: T-0047
tittel: Evalueringssettet måler bare at ingenting ødelegges, ikke om forslagene er til nytte
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-12
rolle: test-ki
omrade: KI (evalueringssett)
maal: KI i bunnen
commit: 11672aa
forsok: 0
pr:
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
