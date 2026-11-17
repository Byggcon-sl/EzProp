---
id: T-0112
tittel: Dublettvarselet regner 90 dager fra når et utløpt tilbud kom inn, ikke fra når det gikk ut
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-17
rolle: test-dokumentvakt, test-kontor
omrade: tilbud, dublettvarsel
maal: reklamasjoner
commit: 2dc573c0
forsok: 0
pr:
---

## Hva
Utløpte tilbud skal gi varsel om mulig dublett i 90 dager (A325). Vinduet regnes fra mottatt-datoen. Et tilbud som er forlenget flere ganger og gikk ut i går, gir derfor ikke varsel hvis det kom inn for mer enn 90 dager siden. Kontoret kan lage et nytt oppdrag uten å se tilbudet.

## Slik gjenskapes det
1. Lag et tilbud med mottatt-dato 120 dager tilbake.
2. Trykk «Forleng 30 dager» til «Gyldig til» blir i går.
3. Lag et nytt oppdrag på samme adresse.

## Forventet
Varsel om mulig dublett.

## Faktisk
Ifølge koden ingen treff (vilkåret ser på mottatt-datoen). Lest fra koden, ikke kjørt i appen.

## Forslag
La utløpte tilbud gi treff når «Gyldig til» er innenfor de siste 90 dagene (`src/core/assignments/booking/duplicate-sql.ts`), eller skriv i A325 at vinduet regnes fra mottaket.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-17: funnet
