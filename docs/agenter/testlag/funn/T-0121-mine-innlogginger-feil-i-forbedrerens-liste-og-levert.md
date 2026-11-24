---
id: T-0121
tittel: «Mine innlogginger» står som «ikke bygd» i forbedrerens liste, og levert.md lover mer enn det som er bygget
type: feil
alvor: lite
status: ny
funnet: 2026-11-18
rolle: test-dokumentvakt
omrade: dokumenter (plan)
maal: de ansatte
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Ståle bruker forbedrerens liste når han vil fjerne funksjoner. Der står «Mine innlogginger» som ikke bygd, og levert.md beskriver ting som ikke ble bygget.

## Slik gjenskapes det
1. Les `docs/plan/forbedrerens-tillegg.md` linje 24: «ikke bygd ennå», «Fjern punktet fra planen før det bygges».
2. Les `docs/plan/levert.md` linje 220: «sist brukt i dag 08:12» og «Admin ser samme liste per ansatt».
3. Les radene på linje 12–16 og 25–32 i forbedrerens liste: «PR fylles inn».

## Forventet
«Mine innlogginger» står som bygd (PR #228). levert.md sier det som ble bygget: dag uten klokkeslett (A427), og admin ser bare enhet, nettleser og antall (A428). PR-numrene er fylt inn (#221, #223, #224, #228).

## Faktisk
Som i stegene.

## Forslag
Rett de tre stedene i neste læringsløkke. Samme slags feil som T-0102, men andre linjer.

## Etterprøvd
Bekreftet av kontrolløren, senket fra middels til lite.

## Logg
- 2026-11-18: funnet
- 2026-11-24: `docs/plan/forbedrerens-tillegg.md` linje 11 og 13–16 sier «PR fylles inn», men PR-en er #232 (main 01fc9e4c). Meldt av dokumentvakten.
