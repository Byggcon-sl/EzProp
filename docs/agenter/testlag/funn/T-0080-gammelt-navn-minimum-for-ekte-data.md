---
id: T-0080
tittel: Det gamle navnet «Minimum før ekte data» brukes fortsatt etter at det ble «Klar for drift»
type: feil
alvor: lite
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Delen av planen heter nå «Klar for drift», men ni dokumenter bruker fortsatt det gamle navnet. Det er forvirrende for den som skal finne kravene før ekte data.

## Slik gjenskapes det
Søk etter «Minimum før ekte data». Treff:
- `.claude/agents/sikkerhet-personvern.md` linje 26
- `docs/06-arkitektur.md` linje 20
- `docs/adr/0002-testmiljo-azure.md` linje 23 og 46
- `docs/adr/0004-drift-uten-nett.md` linje 127
- `docs/adr/0005-nokkelboks-key-vault.md` linje 30
- `docs/09-apne-sporsmal.md` linje 280
- `docs/personvern/intern-personvernerklaering.md` linje 83
- `docs/kartlegging/LES-MEG-kartlegging.md` linje 162
- `docs/plan/levert.md` linje 116

## Forventet
Det nye navnet overalt, eller en merknad om at det gamle navnet betyr det samme.

## Faktisk
Det gamle navnet står i ni dokumenter (ti steder).

## Forslag
Bytt til «Klar for drift». I historiske tekster (ADR-er og beslutninger) kan navnet stå med en merknad «(nå Klar for drift)».

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-14: funnet
