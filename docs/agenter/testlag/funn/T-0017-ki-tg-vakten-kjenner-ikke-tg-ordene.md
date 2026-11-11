---
id: T-0017
tittel: Vakten som skal hindre at KI får skrive TG, kjenner ikke ordene malen bruker for TG
type: forbedring
alvor: middels
status: ny
funnet: 2026-11-11
rolle: test-ki
omrade: KI
maal: reklamasjoner
commit: 0b8e3b9
forsok: 0
pr:
---

## Hva
Det finnes en automatisk test som skal stoppe en KI-funksjon som får lov til å skrive i et TG-felt. Den kjenner bare navnet «tg». Malmotoren kaller TG-feltene noe annet, så en KI-funksjon i 2a-2 kan få TG som mål uten at testen blir rød. KI skal aldri sette TG.

## Slik gjenskapes det
1. Les `isTgField` i `src/core/ai/features/features.test.ts`: den stopper bare feltkoden «tg» og koder som starter med «tg_».
2. Les `src/db/schema/templates.ts`: TG heter `outcome` (tg2, tg3, choose_tg2_tg3), TGIU heter `tgiu`, og regelvilkåret heter `checkpoint_tg`.
3. Prøv uttrykket på `tgiu`, `outcome`, `outcome_kind`, `condition_grade`, `TG` og `tg2`: alle slipper gjennom.

## Forventet
En funksjonsdefinisjon som har TG-utfallet eller TGIU som mål eller på tillatt-listen, gjør testen rød (ADR 0006 del 7, CLAUDE.md regel 14).

## Faktisk
Navnene som faktisk vil bli brukt i 2a-2, slipper gjennom.

## Forslag
Utvid vakten til en fast liste som også tar `outcome*`, `tgiu*`, `tg[0-9]*`, `condition_grade` og store bokstaver, og sjekk `target.type` mot utfall og kontrollpunkt. Gjøres før første KI-funksjon på kontrollpunktet i 2a-2.

## Etterprøvd
Ikke etterprøvd (forbedring).

## Logg
- 2026-11-11: funnet
