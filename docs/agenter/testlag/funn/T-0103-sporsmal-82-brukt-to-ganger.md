---
id: T-0103
tittel: Spørsmål nummer 82, 85, 88 og 89 er brukt to ganger, og spørsmål 81 står to ganger
type: feil
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt
omrade: dokumenter (spørsmål til Ståle)
maal: de ansatte
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Ståle kan svare «82» og mene et annet spørsmål enn agentene tror.

## Slik gjenskapes det
1. Les tabellen «Spørsmål til Ståle» i `docs/09-apne-sporsmal.md` (rundt linje 359–362).
2. Én rad 82 gjelder testdata i testmiljøet (A303). En annen rad 82 gjelder spørsmål til fagrådet fra testlaget (14.11.2026).
3. Spørsmål 81 står to ganger med nesten lik tekst.

## Forventet
Unike nummer og ingen doble rader.

## Faktisk
Som i stegene.

## Forslag
Gi fagrådsspørsmålene et nytt nummer og stryk den doble raden for 81. Samme slags feil som T-0023 (spørsmål 77 sto to ganger). Testlaget bør sjekke neste ledige nummer rett før det fører nye spørsmål.

## Etterprøvd
Ikke etterprøvd (lite).

## Logg
- 2026-11-17: funnet
- 2026-11-18: samme feil for tre nummer til (main 50fad3e4, test-dokumentvakt, bekreftet av kontrolløren, lite). I `docs/09-apne-sporsmal.md` står 89 på linje 425 og 428, 88 på 429 og 430, og 85 på 431 og 434. `sessions-list.ts` linje 50 og 166, `admin/ansatte/[id]/page.tsx` linje 86 og A428 bruker 89 i betydningen fra 17.11; `fase2a-badet-pc.md` linje 131–132 og 271 og A385 bruker 88 og 89 i betydningen fra 14.11. Ved retting må henvisningene i koden og dokumentene følge med. Branchene `ki-i-veien`, `publisering-badet`, `pdf-motor-badet` og `testdata-del-2` bruker 92–103; testlaget brukte 104 for fagrådsspørsmålene 18.11.
