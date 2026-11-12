---
id: T-0036
tittel: «Bruk» på et KI-forslag bytter fuktmålinger, årstall og mål med «[telefon]» i takstmannens tekst
type: feil
alvor: middels
status: ny
funnet: 2026-11-12
rolle: test-takstmann, test-ki
omrade: KI (vask før KI, forslagskortet)
maal: reklamasjoner
commit: 11672aa
forsok: 0
pr:
---

## Hva
Før teksten sendes til KI, fjernes alt som ligner persondata. Rekker av tall, som fire fuktmålinger eller to årstall, blir tatt for telefonnummer. Når takstmannen trykker «Bruk», står det «[telefon]» i teksten hans der målingene sto, uten varsel. Forslagskortet skal brukes på avviksteksten i 2a-2. En måling som forsvinner fra et avvik, kan gi reklamasjon.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Skriv «fuktmålinger i vegg mot bad 12 14 18 22 vektprosent, taket skiftet 2010-2012» og trykk «Foreslå bedre språk».
3. Trykk «Bruk».
4. Prøv også «takhøyde målt til 2400 2350 mm i stua», «vindu fra 1985-1990» og «mot bakken 2 m».

## Forventet
Målinger og årstall står igjen i teksten. Har forslaget merker som ikke sto i egen tekst, varsler kortet og stopper «Bruk».

## Faktisk
Feltet blir «Fuktmålinger i vegg mot bad [telefon] vektprosent, taket skiftet [telefon].». «2400 2350 mm» blir «[telefon] mm», «1985-1990» blir «[telefon]», og «mot bakken 2 m» blir «mot [adresse] m». Kortet sier ikke fra. «Angre» henter teksten tilbake. A170 godtar at vasken tar for mye av det som sendes til KI, men ikke at målinger forsvinner fra takstmannens egen tekst. Evalueringssettet har ingen slike eksempler.

## Forslag
Avgjøres sammen med A178 før 2a-2: enten byttes merkene tilbake når forslaget brukes, eller kortet stopper «Bruk» og sier «KI-hjelpen fjernet tall eller navn fra teksten din» når forslaget har merker som ikke sto i egen tekst. Gjør telefonmønsteret strengere (ikke årstall 1800–2100, ikke tall fulgt av måleenhet). Legg måleserier og årstallsspenn inn i evalueringssettet.

## Etterprøvd
2026-11-12, bekreftet (middels). Kontrolløren fikk samme resultat på alle tre tekstene. Middels fordi det bare gjelder prøvesiden ennå og «Angre» virker. Blir alvorlig hvis det ikke er rettet når kortet tas i bruk på avviksteksten.

## Logg
- 2026-11-12: funnet
