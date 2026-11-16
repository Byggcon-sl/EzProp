# Lagt til av forbedreren

Sist oppdatert: 16.11.2026

Her står alt forbedreren har fått bygget som ikke stod i planen (Ståle 14.11.2026, se «Forbedreren» i `CLAUDE.md`). Listen er til for Ståle: mot slutten av utviklingen går han gjennom den og beholder, justerer eller fjerner.

Én rad per tillegg, nyeste øverst. Prosjektlederen fører raden når tillegget tas inn, og fyller inn PR-nummeret når det er bygget.

| Dato | Tillegg (det den ansatte merker) | Hvorfor | Type | Hvor (PR, oppgavekort, kode) | Slik fjernes det | Ståle |
|---|---|---|---|---|---|---|
| 16.11.2026 | Historikk på oppdraget: tidslinje over hvem som la til, endret, fjernet og hentet tilbake hva, med filter, «Gjenopprett» og KI-utkast til «hva er endret». | Sporbarhet ved reklamasjoner, KI i bunnen, best for lederne. | nytt planpunkt | `docs/07-utviklingsplan.md` 2a-3 «Fra forbedreren»; kort fra `docs/funksjoner/fase2a-papirkurv.md` | Stryk punktet i planen før det bygges. | |
| 16.11.2026 | «Fjern» på etasje og bygning tar med rommene og arealene som én slettegruppe; «Angre» henter hele gruppen (A414, erstatter A98). | 1 trykk i stedet for 7; feil etasjer blir ikke stående. | i oppgaven | `docs/funksjoner/fase2a-papirkurv.md`, `src/core/buildings/service.ts` (PR fylles inn) | Sett sperren `BuildingNotEmptyError`/`FloorNotEmptyError` tilbake i `removeBuilding` og `removeFloor`. | |
| 16.11.2026 | «Angre»-meldingen: Cmd/Ctrl+Z, én melding om gangen med «Mer i papirkurven», overlever omlasting, uthevet rad etter gjenoppretting. | Raskere og tryggere angring. | i oppgaven | `docs/funksjoner/fase2a-papirkurv.md`, felles melding i `src/shared/ui` (PR fylles inn) | Ta ut hurtigtasten og uthevingen i meldingskomponenten. | |
| 16.11.2026 | Papirkurven viser hvor, areal for etasjer, hvem og når i klarspråk («i dag 14:02»), og slettegrupper som én linje. | Mindre leting. | i oppgaven | `docs/funksjoner/fase2a-papirkurv.md` (PR fylles inn) | Fjern feltene fra linjen i papirkurven. | |
| 16.11.2026 | Hendelsene for fjerning og gjenoppretting får strukturerte felt (romtype, antall, angre eller papirkurv, tid til gjenoppretting) uten persondata (A418). | KI i bunnen: finne feiltrykk og romtyper i malen som nesten alltid fjernes. | i oppgaven | `docs/funksjoner/fase2a-papirkurv.md`, `src/core/events/types.ts` (PR fylles inn) | Ta feltene ut av hendelsesdataene. | |

Type: «i oppgaven» eller «nytt planpunkt». Kolonnen «Ståle» er tom til han har sett på raden: behold, juster eller fjern.
