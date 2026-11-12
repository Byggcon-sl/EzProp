---
id: T-0043
tittel: Tekst skrevet etter at forespørselen ble lagt i KI-køen, forsvinner når siden lastes på nytt
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-takstmann
omrade: KI-kø (prøvesiden, mønster for 2b)
maal: de ansatte
commit: 11672aa
forsok: 0
pr:
---

## Hva
Uten nett legges teksten i kø. Skriver takstmannen videre og laster siden på nytt, hentes bare teksten fra køen tilbake. Det han skrev etterpå, er borte, og forslaget kommer uten merknad om eldre tekst.

## Slik gjenskapes det
1. Åpne `/prove/ki` og skriv «vann på gulvet i vaskerom».
2. Slå av nettet og trykk «Foreslå bedre språk».
3. Skriv videre: «Sluk mangler, målt fall 1:200.»
4. Slå på nettet og last siden på nytt.

## Forventet
Det han skrev sist, står i feltet, eller han får vite at bare teksten som ble sendt til KI, er tatt vare på.

## Faktisk
Feltet viser bare «vann på gulvet i vaskerom». Prøvesiden har aldri lagret fritekst, men når teksten fra køen hentes fram, ser det ut som om alt er tatt vare på.

## Forslag
I 2b lagres feltet lokalt for seg, ikke bare som kopi av det som ligger i KI-køen. Skriv det som krav i ADR 0006 del 10.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
