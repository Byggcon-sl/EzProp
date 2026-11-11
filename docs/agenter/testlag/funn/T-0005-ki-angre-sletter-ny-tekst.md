---
id: T-0005
tittel: «Angre» etter «Bruk» sletter det takstmannen har skrevet etterpå, uten varsel
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-robusthet, test-takstmann
omrade: KI (forslagskortet)
maal: KI i bunnen
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Har takstmannen godtatt et KI-forslag og så skrevet mer i feltet, sletter «Angre» det nye uten å si fra. En måling eller et viktig tillegg kan forsvinne fra teksten.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Skriv «det var  fukt i kjelleren» og trykk «Foreslå bedre språk».
3. Trykk «Bruk».
4. Skriv videre i feltet: « Målt 25 vektprosent ved nordvegg, viktig tillegg.»
5. Trykk «Angre».

## Forventet
Egen tekst overskrives aldri uten at takstmannen har valgt det. «Angre» setter bare status tilbake og beholder teksten, eller spør før den overskriver tekst som er endret etter «Bruk».

## Faktisk
Feltet blir «det var  fukt i kjelleren». Tillegget med målingen er borte, uten melding. Linjen under kortet viser «Logget: forslag».

At merket «Tekst fra KI, godkjent» og «Logget: godtatt» blir stående når takstmannen redigerer en godtatt tekst, er **ikke** en feil: det er bestemt i A168.

## Forslag
Når feltet er endret etter «Bruk», skal «Angre» ikke overskrive teksten, eller den skal spørre først (`decide()` i `src/app/(ansatt)/prove/ki/ai-trial-client.tsx`, og det felles kortet i `src/shared/ui/ai-suggestion.tsx`). Lag en e2e-test for redigering etter «Bruk» og så «Angre». Rettes før mønsteret brukes på avviksteksten i 2a-2.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fikk samme resultat: målingen forsvant uten melding. Middels fordi det bare er prøvesiden; blir alvorlig når mønsteret brukes på ekte felt. Samme funn fra test-takstmann er slått sammen hit.

## Logg
- 2026-11-11: funnet
