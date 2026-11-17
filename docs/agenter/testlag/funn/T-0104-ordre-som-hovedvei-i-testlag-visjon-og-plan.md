---
id: T-0104
tittel: Kontortesteren, produktvisjonen og planen omtaler fortsatt ordre som hovedveien
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (agenter og visjon)
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Ståle sa 13.11.2026 at nesten alle jobber legges rett inn som oppdrag, og at tilbud er unntaket. Kontortesteren er fortsatt bedt om å prøve veien fra ordre til oppdrag, som nå brukes for 1–2 av 100 jobber. Hovedveien blir da prøvd mindre enn den bør.

## Slik gjenskapes det
1. `.claude/agents/test-kontor.md` linje 3 og 15: «legg inn en ordre fra en e-post, gjør den om til oppdrag».
2. `docs/01-produktvisjon.md` linje 22: «Kontoret: ordre, oppdrag …».
3. `docs/07-utviklingsplan.md` linje 480: «2a (manuell ordre og «Send»)».

## Forventet
«Nytt oppdrag» er hovedveien, og tilbud er unntaket.

## Faktisk
Som i stegene.

## Forslag
Skriv om test-kontor til «Nytt oppdrag, og av og til et tilbud som gjøres om». Bytt ordet i produktvisjonen og planlinjen. Likner T-0067 (utdaterte grunndokumenter).

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
