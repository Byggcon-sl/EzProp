---
id: T-0032
tittel: Instruksen for språkvask sier ikke at «bør» og «må», TG og hvor sikkert noe er, skal stå som før
type: forbedring
alvor: lite
status: ny
funnet: 2026-11-11
rolle: test-fag
omrade: KI
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Med en ekte KI kan språkvasken gjøre «trolig fuktskade» til «fuktskade», eller «bør» (TG2) til «må» (TG3). Det endrer innholdet i rapporten. Instruksen til KI sier i dag ikke at dette skal stå som før.

## Slik gjenskapes det
1. Les instruksen `language_polish.v1` i `src/core/ai/features.ts`.
2. Åpne `/prove/ki` som takstmann og send «det antas at membranen trolig er over 20 år, jf. NS 3600. tiltak: membranen må skiftes».

## Forventet
Språkvasken endrer aldri «bør» til «må» eller omvendt, endrer ikke TG, og gjør ikke et usikkert funn sikkert. Gjetteord og NS-henvisning pekes på, ikke skrives om til påstander.

## Faktisk
Instruksen sier «Behold alle fakta» og «Skriv sikkert og konkret, uten ord som uttrykker gjetting», men nevner ikke bør og må, TG eller grad av sikkerhet. Den falske leverandøren gir teksten tilbake uendret, slik den skal nå.

## Forslag
Ny versjon av instruksen (v2) som sier at bør og må, TG og grad av sikkerhet skal stå som før. Ta med slike setninger i evalueringssettet for språkvask.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
