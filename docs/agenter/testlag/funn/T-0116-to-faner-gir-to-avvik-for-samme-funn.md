---
id: T-0116
tittel: Godta i én fane og Endre i en annen gir to avvik for samme funn (TG3 og TG2)
type: feil
alvor: middels
status: ny
funnet: 2026-11-18
rolle: test-robusthet
omrade: badet, regelforslag
maal: reklamasjoner
commit: 50fad3e4
forsok: 0
pr:
---

## Hva
Har takstmannen badet åpent to steder (for eksempel iPad og PC), kan samme forslag godtas det ene stedet og endres det andre. Da står det to avvik for samme forhold, med ulik TG.

## Slik gjenskapes det
1. Åpne samme bad i fane A og B, punktet «Vanntett sjikt», «Folie», årstall 1990.
2. Godta forslaget i fane A.
3. I fane B, uten å laste på nytt: «Endre», velg TG2 og «Synlig skade», lagre.

## Forventet
Endre i fane B avvises, eller retter avviket som finnes. Aldri to avvik (testplan B4.31).

## Faktisk
To avvik og to beslutningsrader. TG2-avviket fikk tiltaket «må fornyes», som hører til TG3. `alreadyAccepted` i `src/core/reports/suggestions.ts` (linje 147–244) gjelder bare «Godta».

## Forslag
I `decideSuggestion` hentes siste beslutning før «Endre» og «Avvis». Finnes et gyldig avvik, svar `already_decided`, slik «Godta» gjør.

## Etterprøvd
2026-11-18, bekreftet (middels). Bevis: test-robusthet/twotabs2-*.png; funn-kontrollor-1/f5b.log og f5b-db.log.

## Logg
- 2026-11-18: funnet
