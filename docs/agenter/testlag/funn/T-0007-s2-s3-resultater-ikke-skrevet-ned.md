---
id: T-0007
tittel: Prøvene på iPad og fagrådet står som gjort, men resultatene og de godkjente tallene er ikke skrevet ned
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-dokumentvakt
omrade: dokumenter (plan, prøve uten nett, fagråd)
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Planen sier at Ståle har kjørt prøvene på ekte iPad (S2) og at fagrådet har godkjent grenser, levetider og prøveeksempler (S3). Men resultatfilene sier fortsatt «ikke kjørt», og ingen steder står hvilken fuktgrense og hvilke levetider som er godkjent. Disse tallene trengs når reglene for badet lages i 2a-2.

## Slik gjenskapes det
1. Les `docs/07-utviklingsplan.md`, «Status nå» og S2/S3 under «Venter på Ståle».
2. Åpne resultatfilene for prøve A–F i `docs/funksjoner/` (`fase1-prove-ab-egenbygd.md`, `fase1-prove-c-lagring-resultat.md`, `-d-bilder-`, `-e-regler-`, `-f-innlogging-`): alle sier «Status: mal, ikke kjørt».
3. Les `docs/plan/levert.md`: fase 1 står som «i arbeid», prøve A, B og demoen er ikke krysset av, og ADR og sammenligning står som «Foreløpig».
4. Les `docs/kartlegging/avvikstekster-10-proveeksempler-IKKE-GODKJENT.md` (sier «Ikke godkjent») og `docs/09-apne-sporsmal.md` (sier «utkast til fagrådet har godkjent (K3)»).

## Forventet
Når S2 og S3 er gjort, står det hva som ble prøvd og godkjent, og hvilke tall og tekster som gjelder. Resultatfilene, `levert.md` og tekstfilen sier det samme som planen.

## Faktisk
Alt bygger på Ståles korte svar «2 og 3 også» 10.11.2026. Ingen resultater er ført inn, og godkjent fuktgrense og levetider står ingen steder.

## Forslag
Skriv ned i beslutningstabellen hva Ståle godkjente. Oppdater statusen i resultatfilene og i `levert.md` for fase 1, og gi tekstfilen ny status. Er noe uklart (særlig tallene), føres det under «Trenger Ståle». Spørsmålet om tallene er også lagt i `docs/09-apne-sporsmal.md`.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fant at alle resultatfilene sier «mal, ikke kjørt», at `levert.md` sier «i arbeid», og at ingen godkjent fuktgrense eller levetid står noe sted.

## Logg
- 2026-11-11: funnet
