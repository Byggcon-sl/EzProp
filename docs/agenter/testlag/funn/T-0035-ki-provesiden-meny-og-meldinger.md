---
id: T-0035
tittel: Prøvesiden for KI står ikke i menyen, og noen meldinger er feil eller kommer for sent
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-ki, test-takstmann, test-kontor
omrade: KI (prøveside)
maal: de ansatte
commit: 0b8e3b9
forsok: 0
pr: 143 (bare punkt 4, resten står åpent)
---

## Hva
De ansatte skal kunne prøve KI-forslag i testmiljøet, men siden står ikke i menyen. På siden får man først vite at KI er av etter at man har skrevet og trykket, en gammel feilmelding blir stående, og uten nett står det at teksten er lagret når den ikke er det.

## Slik gjenskapes det
1. Logg inn som takstmann eller leder. Under «Prøver» i menyen står bare «Testskjema uten nett».
2. Logg inn i en organisasjon der KI er av og åpne `/prove/ki`: knappen er aktiv, og «KI er av.» kommer først etter trykk.
3. Som takstmann: lim inn 5001 tegn og trykk. Skriv så en kort setning og slå av nettet: «Skriv en setning på høyst 5000 tegn.» står fortsatt.
4. Uten nett står «Teksten din er lagret», men teksten er borte etter ny lasting av siden.

## Forventet
Siden står i menyen for dem som har tilgang. Den ansatte ser at KI er av før hen skriver, gamle feilmeldinger forsvinner når teksten endres, og «lagret» brukes bare når teksten faktisk er lagret.

## Faktisk
Som i stegene.

## Forslag
Legg «Prøv KI: språkvask» under «Prøver» for dem med `report.edit`, til siden fjernes i 2a-2. Les om KI er av eller på når siden lastes. Tøm meldingen ved endring i feltet. Bruk en tekst uten «lagret» på prøvesiden.

## Etterprøvd
Ikke etterprøvd (forbedring). Menyfunnet er meldt av tre testere og slått sammen.

## Logg
- 2026-11-11: funnet
- 2026-11-11: punkt 4 (teksten står igjen etter ny lasting) rettet i PR #143 (KI-kø). Resten står åpent.
