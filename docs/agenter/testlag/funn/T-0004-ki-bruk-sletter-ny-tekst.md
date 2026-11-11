---
id: T-0004
tittel: «Bruk» på et KI-forslag sletter tekst takstmannen skrev etter at forslaget ble laget
type: feil
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-takstmann
omrade: KI (forslagskortet)
maal: KI i bunnen
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Skriver takstmannen videre i feltet etter at KI har laget et forslag, og så trykker «Bruk», forsvinner det han skrev etterpå, uten varsel. Forslagskortet skal brukes i alle KI-funksjonene i 2a-2, også i avviksteksten.

## Slik gjenskapes det
1. Logg inn som takstmann og åpne `/prove/ki`.
2. Skriv «taket lekker ved pipa» og trykk «Foreslå bedre språk».
3. Skriv videre i feltet så det står «taket lekker ved pipa og ved takvinduet».
4. Trykk «Bruk».

## Forventet
Egen tekst går aldri tapt uten at takstmannen ser det. Kortet viser at forslaget gjelder eldre tekst, eller ber om nytt forslag.

## Faktisk
Feltet blir «Taket lekker ved pipa.». «og ved takvinduet» er borte. Kortet viser fortsatt den gamle teksten under «Din tekst». Bare «Angre» henter det tilbake.

## Forslag
Når feltet er endret etter at forslaget ble laget: merk forslaget som utdatert og lås «Bruk», eller vis «Teksten er endret. Be om nytt forslag.» (`src/shared/ui/ai-suggestion.tsx`). Lag en e2e-test. Rettes før forslagskortet brukes på ekte felt i 2a-2.

## Etterprøvd
2026-11-11, bekreftet (middels). Kontrolløren fikk samme resultat. Middels fordi «Angre» henter teksten tilbake og siden bare har oppdiktet tekst.

## Logg
- 2026-11-11: funnet
