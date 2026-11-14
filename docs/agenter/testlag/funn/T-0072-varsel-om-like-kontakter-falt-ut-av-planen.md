---
id: T-0072
tittel: Ståles ja til varsel om like kontakter og firma ble til varsel på ordre, og A289 sier feil
type: feil
alvor: middels
status: ny
funnet: 2026-11-14
rolle: test-dokumentvakt
omrade: dokumenter (plan og beslutninger), dublettvarsel T3
maal: de ansatte
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Ståle sa ja 12.11.2026 til forslag 62: varsel når kontoret lager en kontakt eller et firma som ligner en som finnes. I planen ble det til varsel om like ordre, og bare det er bygget. A289 sier at varselet for kontakter og firma venter på Ståles ja, men han har sagt ja. Doble kontakter gjør at rapporten kan gå til feil person.

## Slik gjenskapes det
1. Les forslag 62 i `docs/09-apne-sporsmal.md` (kontakt eller firma, «Ligner Kari Testmegler», besvart «ja, nå (T3)»).
2. Les Ståles svar i `docs/kartlegging/svar-fra-stale-2026-11-12.md` (T3 (62): «Ja, nå. Fast regel uten KI, og varselet stopper ikke lagringen.»).
3. Les A289 og A285 i `docs/09-apne-sporsmal.md`, og `docs/funksjoner/fase2a-varsel-dublett.md` (linje 63 og 120).
4. `git show db6e92ce -- docs/07-utviklingsplan.md` (PR #170) viser at T3 ble «samme adresse eller matrikkel og overlappende tid» da svarene ble ført inn. Det kommer ikke fra Ståle.

## Forventet
Planen har varsel om like kontakter og firma, slik Ståle sa ja til, eventuelt i tillegg til varselet på ordre.

## Faktisk
Bare varselet på ordre er bygget (PR #198). A289 sier at varselet for kontakter og firma venter på Ståles ja. Oppgavekortet sier at det står som eget punkt rett etter T3, men punktet finnes ikke. Ingen beslutning fra Ståle etter 12.11 forklarer omskrivingen. I tillegg er A285 («alle oppdrag lages fra en ordre») utdatert etter «rett på oppdrag» 13.11.2026; planen dekker likevel at dublettvarselet skal virke på oppdraget.

## Forslag
Legg varselet for kontakter og firma inn i planen som del av T3 (det er Ståles egen beslutning, ikke en ny idé), rett A289 og oppgavekortet, og merk A285 som endret av «rett på oppdrag». Samme slags feil som T-0052: en beslutning fra Ståle har falt ut. Mål: de ansatte og færre reklamasjoner.

## Etterprøvd
2026-11-14, bekreftet (middels). Ikke duplikat av T-0025, T-0030 eller T-0055, som gjelder annet.

## Logg
- 2026-11-14: funnet
