---
id: T-0084
tittel: «Legg til rom» (ett rom) nummererer ikke, så samme etasje kan få «Soverom» ved siden av «Soverom 1»
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-14
rolle: test-fag, test-takstmann
omrade: bygninger og rom (T4, A281)
maal: reklamasjoner
commit: a1ca41d9
forsok: 0
pr:
---

## Hva
Dialogen «Legg til flere rom» nummererer like rom, men «Legg til rom» (ett rom) gjør det ikke. Samme etasje kan da få «Soverom» ved siden av «Soverom 1–3». En kjøper eller advokat kan ikke vite hvilket soverom avviket gjelder.

## Slik gjenskapes det
1. I 1. etasje: legg til et soverom med «Legg til rom» uten navn. Det heter «Soverom».
2. Legg til ett soverom til med «Legg til flere rom». Det heter «Soverom 2». Det finnes ingen «Soverom 1».
3. Eller: legg til tre soverom med dialogen (Soverom 1–3), og så ett med «Legg til rom» uten navn. Det heter «Soverom».

## Forventet
Rom av samme type i samme etasje kan alltid skilles.

## Faktisk
Skjemaet sier «Valgfritt. Tomt gir navnet på romtypen.» A281 og oppgavekortet gjelder bare dialogen, så dette er ikke en feil mot kortet, men navnene kan ikke skilles.

## Forslag
La `saveRoom` bruke `numberRoomDrafts` når navnet er tomt og typen finnes i etasjen, eller foreslå navnet i feltet. Avhenger av spørsmål 82 (a) og (b) til fagrådet (nummerering per etasje eller for hele boligen, og om første rom skal få «1»).

## Etterprøvd
2026-11-14: meldt som feil av test-takstmann; funn-kontrolløren dømte det «ikke feil» mot kortet. Tatt som forbedring.

## Logg
- 2026-11-14: funnet
