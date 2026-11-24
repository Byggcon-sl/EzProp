---
id: T-0141
tittel: Feil nummerområder for beslutningene om «KI i veien», og A431 er ikke merket utvidet
type: feil
alvor: lite
status: ny
funnet: 2026-11-24
rolle: test-dokumentvakt
omrade: dokumenter
maal: de ansatte
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Noen dokumenter viser til beslutninger med feil nummerområde, så den som leter, finner ikke riktig beslutning. Samme slags feil som T-0096, men nye linjer. Hovedmål: de ansatte.

## Slik gjenskapes det
1. Les `docs/05-domenemodell.md` linje 2645, `docs/adr/0006-ki-i-bunnen.md` linje 365 og `docs/funksjoner/fase2a-ki-i-veien.md` linje 161.
2. Les `docs/09-apne-sporsmal.md` linje 398 (A483) og 404 (A431).

## Forventet
A431–A442, A482–A488 og A420–A426. A483 viser til domenemodellen 4.7. A431 er merket «Utvidet i A461, A466».

## Faktisk
«A482–A442» og «A420–A485». A483 viser til 4.5. A431 er ikke merket utvidet.

## Forslag
Rett områdene og merk A431.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-24: funnet
