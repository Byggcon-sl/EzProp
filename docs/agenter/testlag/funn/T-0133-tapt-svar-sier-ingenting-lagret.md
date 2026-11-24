---
id: T-0133
tittel: Når svaret går tapt, står det «Ingenting er lagret» selv om KI-teksten er lagret, og nytt trykk gir et ekstra tiltak
type: feil
alvor: middels
status: ny
funnet: 2026-11-24
rolle: test-robusthet
omrade: KI, badet, lagring
maal: reklamasjoner
commit: 01fc9e4c
forsok: 0
pr:
---

## Hva
Går svaret fra serveren tapt etter at et fraseforslag eller en språkvask er lagret, sier skjermen at ingenting er lagret. Takstmannen trykker igjen og får samme tiltak to ganger, eller «Endret av andre» om sin egen lagring. Hovedmål: færre reklamasjoner og de ansatte.

## Slik gjenskapes det
1. Bad med TG3-avvik.
2. «Forslag til tiltak», «Legg til som tiltak», og la svaret gå tapt etter at serveren har svart.
3. Les meldingen og tell tiltakene. Trykk igjen.
4. Gjør det samme med «Bruk» på et språkvasket felt.
5. Send `applyPhrase` på nytt med samme `usageId` og ny `measureId`.

## Forventet
«Fikk ikke svar. Sjekk om teksten er lagret.», og avviket hentes på nytt. Samme `usageId` kan ikke brukes to ganger.

## Faktisk
«Fikk ikke kontakt med serveren. Ingenting er lagret. Prøv igjen.», men tiltaket er lagret. Nytt trykk gir ett tiltak til. Samme `usageId` gir dobbelt tiltak. I språkvask sier andre trykk «Endret av andre». Steder: `polish-deviation.tsx` linje 205–225, `phrase-suggestions.tsx`, `room-messages.ts` linje 26 (`ROOM_ACTION_MESSAGES.network`), `applyPhrase` i kjernen.

## Forslag
Ved nettfeil: si «Fikk ikke svar» og hent rommet på nytt. `applyPhrase` avviser en `usageId` som alt er `accepted`.

## Etterprøvd
2026-11-24, bekreftet (middels) av funn-kontrolløren. Ligner T-0093 (tilbud), men annet område. Bevis: test-robusthet/t13-frase-tapt.txt, t12-apply.txt, t8-utennett.txt; funn-kontrollor-2/funn5.log.

## Logg
- 2026-11-24: funnet
