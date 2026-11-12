---
id: T-0045
tittel: Meldingen «Teksten er for lang til KI-hjelp» blir stående etter at forslaget har kommet
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-12
rolle: test-robusthet
omrade: KI-kø (prøvesiden)
maal: de ansatte
commit: 11672aa
forsok: 0
pr:
---

## Hva
Den røde meldingen om for lang tekst forsvinner ikke når et forslag kommer fra køen. Samme feil har også to ulike tekster, med og uten nett.

## Slik gjenskapes det
1. Uten nett: skriv en kort tekst og trykk «Foreslå bedre språk».
2. Lim inn 6000 tegn og trykk igjen: «Teksten er for lang til KI-hjelp.»
3. Skriv den korte teksten igjen og slå på nettet.

## Forventet
Meldingen forsvinner når forslaget kommer. Samme tekst med og uten nett.

## Faktisk
Forslaget vises, men meldingen står. Med nett heter feilen «Skriv en setning på høyst 5000 tegn.»

## Forslag
Fjern meldingen når køen gir svar (`src/app/(ansatt)/prove/ki/ai-trial-client.tsx`), og bruk én tekst.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-12: funnet
