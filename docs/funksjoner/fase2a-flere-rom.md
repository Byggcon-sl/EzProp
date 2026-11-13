# Funksjon: Flere rom på én gang

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», punktet «Flere rom på én gang med færrest mulig trykk» (T4)
- **Modul:** kjerne (`src/core/buildings`) og siden `/oppdrag/[id]/bygninger`
- **Branch:** `flere-rom-samtidig` (fra `main`)
- **Status:** klar for bygging (13.11.2026, prosjektleder)
- **Kilde:** Ståle 12.11.2026, T4 (`docs/kartlegging/svar-fra-stale-2026-11-12.md`): «færrest klikk, mest mulig effektivt. ki first»
- **Støtter hovedmål:**
  - **De ansatte:** en vanlig leilighet får alle rommene med tre trykk: åpne, velg sett, lagre. I dag tar det rundt 4 trykk per rom.
  - **KI i bunnen:** listen med romutkast er samme inngang som KI-forslaget fra plantegning (2a-3) skal fylle. Da trenger KI-punktet ingen ny skjerm og ingen ny lagring.
  - **Færre reklamasjoner:** når rommene kommer raskt og riktig inn, med riktig romtype, blir det sjeldnere at et våtrom eller et rom under terreng mangler kontrollpunktene sine senere.

## Problem
Takstmannen legger i dag inn ett rom om gangen: «Legg til rom», velg romtype i en lang liste med 33 typer uten grupper (T-0018), lagre, og så på nytt. En enebolig med 12–15 rom gir 50–60 trykk før befaringen i det hele tatt har startet. Lar vi det være, blir romlisten kortere enn boligen, eller den føres som fritekst.

## KI i bunnen
- **Fra første dag:** ingen KI-kall i dette punktet. KI-forslaget fra plantegning er et eget punkt i 2a-3 («KI: forslag til rom fra plantegning»), og det trenger opplasting av tegning. Det som bygges nå, er grunnmuren KI-forslaget skal stå på:
  - **Én liste med romutkast** (`RoomDraft`: romtype, valgfritt navn, antall). Settet, avkrysningen og senere KI-forslaget fyller den samme listen. Takstmannen ser og retter listen før lagring. Det gir mønsteret godta, endre eller avvise per rad.
  - **Én lagring** i kjernen, `addRooms(actor, organizationId, floorId, drafts, source)`, som KI-punktet bruker uendret. Kildekoden `source` er `manual` (avkrysning) eller `preset:<nøkkel>` (ferdig sett) nå. `ai_floor_plan` kommer med KI-punktet.
  - **Kilden lagres** i revisjonsloggen for hvert rom (`source`). Senere kan vi måle hvor mye takstmannen retter på sett og KI-forslag. Dette er grunnlaget for å se om KI gir nytte.
- **Settene er faste regler, ikke KI:** forslaget til sett velges ut fra boligtypen på eiendommen og om etasjen er under terreng. Det virker uten KI og uten nett i nettleseren.
- Ingen data går til KI i dette punktet. Når KI-punktet kommer, går det gjennom `src/core/ai` med vask og logg i `ai_usage_log`, som vanlig.

## Brukerhistorier
- Som **takstmann** vil jeg **legge inn alle rommene i en etasje i én operasjon** slik at **jeg kommer raskt i gang med befaringen**.
- Som **takstmann** vil jeg **få et ferdig sett som passer boligen og etasjen, og rette antallet** slik at **jeg bare retter det som avviker**.
- Som **takstmann** vil jeg **at like rom får nummer** («Soverom 1», «Soverom 2») slik at **jeg og kjøperen kan skille dem i rapporten**.

## Omfang
**Med:**
1. **Knappen «Legg til flere rom»** på hver etasje på `/oppdrag/[id]/bygninger`, ved siden av «Legg til rom». Den åpner **én dialog for hele siden** (ikke én per etasje, jf. T-0058), med etasjen valgt.
2. **Dialogen** (iPad og PC, store trykkflater, rammen Fjord):
   - Øverst: **ferdige sett** som knapper. Settet som passer boligtypen og etasjen, står først og er merket «Foreslått». Ett trykk fyller tellerne (legger ikke til flere ved nytt trykk på samme sett; erstatter tellerne).
   - **Vanlige romtyper som fliser med teller** (trykk på flisen = +1, egen «–»-knapp): Entré og vindfang, Gang og hall, Stue, Kjøkken, Stue og kjøkken, Soverom, Bad, Toalettrom, Vaskerom, Bod (inne), Teknisk rom.
   - **«Flere romtyper»** åpner hele listen gruppert etter romgruppe (våtrom, kjøkken, toalett, spesialrom, andre), med samme teller.
   - Nederst: sammendrag («9 rom i 1. etasje») og hovedknappen **«Legg til 9 rom»**. Knappen er av når tellerne er 0.
   - Etasjen kan byttes i dialogen. Etter lagring lukkes dialogen, og rommene står i etasjen.
3. **Ferdige sett** som data i `src/core/buildings/room-presets.ts` (A270), merket «utkast, ikke godkjent av fagrådet»:
   - `apartment` (Leilighet): Entré og vindfang, Stue, Kjøkken, Bad, Soverom ×2, Bod (inne)
   - `house_main_floor` (Bolig, inngangsetasje): Entré og vindfang, Gang og hall, Stue, Kjøkken, Bad, Toalettrom, Soverom, Bod (inne)
   - `house_upper_floor` (Bolig, etasje over): Gang og hall, Soverom ×3, Bad
   - `basement` (Kjeller eller underetasje): Gang og hall, Vaskerom, Bod (inne), Teknisk rom, Kjellerstue
   - Ren funksjon `suggestRoomPreset({ housingType, floorLevel, floorBelowGround, lowestAboveGroundLevel })` med testsaker: etasjen under terreng gir `basement`, `apartment` gir `apartment`, laveste etasje over terreng gir `house_main_floor`, ellers `house_upper_floor`. Ukjent boligtype gir `house_main_floor`.
4. **Nummerering** (A271), ren funksjon `numberRoomDrafts(drafts, existingRoomsOnFloor)` med testsaker: får en romtype mer enn ett rom i etasjen (nye pluss de som finnes), blir de nye «<romtypens navn> N», der N fortsetter etter de som finnes. Rom som finnes, endres aldri. Ett rom av typen får tomt navn (romtypens navn vises, som i dag).
5. **Lagring i kjernen:** `addRooms` i `src/core/buildings/service.ts`. `requireOrganizationAccess(actor, organizationId, "assignment.edit")`, alle spørringer filtrerer på `grant.organizationId`. Låser etasjen (`lockFloor`) og setter inn alle rommene **i én transaksjon**: feiler ett, lagres ingen. Arealtype og «under terreng» fra `suggestAreaType` og `suggestBelowGround`, som for ett rom. Revisjonslogg `room`/`create` per rom (med `source`), og hendelsen `assignment.room_saved` per rom, som i dag. Zod-skjemaet `addRoomsInputSchema`: romtype må være en kjent kode, antall 1–20 per romtype, høyst 40 rom per operasjon (A272), navn som i `roomInputSchema` (sperren mot elleve sifre gjelder).
6. **Serverhandling** i `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.ts`, uten egen tilgangslogikk, med samme feilmeldingsmønster som de andre handlingene (valgene står igjen etter feil, jf. T-0050).
7. **Lite funn tatt med (samme område):** T-0018: nedtrekkslisten for ett rom grupperes med `optgroup` etter romgruppe (gruppene finnes allerede i `ROOM_TYPES`). Funnet settes til «rettet» med PR-nummer.

**Ikke med (bevisst utelatt):**
- KI-forslag fra plantegning, opplasting av tegning og bilder (eget punkt i 2a-3).
- Flere etasjer i én lagring (én etasje per operasjon; etasjen byttes i dialogen).
- Ferdige sett som Byggcon redigerer selv (kommer med maleditoren); sett per bygningstype (garasje, hytte).
- Areal per rom, rekkefølge på rom (`sort_order`), dra og slipp.
- Uten nett på iPaden (siden er i dag bare for hånd på PC og med nett; befaringsvisningen kommer i fase 2b).
- Fjerne eller endre flere rom samtidig, angre (T-0028 venter på «Papirkurv og angre for sletting»), rom som følger etasjen ved endring (T-0053).
- Arealskjemaet på bygningssiden (T-0058 er en egen forbedring); dialogen skal bare ikke gjøre siden tyngre.
- Ny tabell, ny kolonne eller migrering.

## Tilgang
| Rolle | Se | Endre (legge til flere rom) |
|---|---|---|
| takstmann | ja | ja (`assignment.edit`, `access.inspectors_edit_all`) |
| kontor | som i dag for bygningssiden | som i dag (`assignment.edit`) |
| leder | ja | ja |
| admin | ja | ja (stenges aldri ute) |

Samme rettighet som «Legg til rom». Ingen ny rettighet.

## Data
- Ingen nye tabeller eller kolonner. Rommene lagres i `rooms` som i dag.
- Nye kodelister (kode, ikke tabell): `ROOM_PRESETS` med nøklene `apartment`, `house_main_floor`, `house_upper_floor`, `basement` (regel 6: nøklene endres aldri). Kildekoder i revisjonsloggen: `manual`, `preset:<nøkkel>`; `ai_floor_plan` er reservert for KI-punktet.
- `docs/05-domenemodell.md` 4.4 og ordlisten (avsnitt 8): «romutkast» = `RoomDraft`, «ferdig sett» = `RoomPreset`, `addRooms`.

## Skjermer
- **Bygningssiden, dialogen «Legg til flere rom»** (iPad og PC). Hovedhandling: «Legg til N rom».
- **Trykk før og etter** (leilighet med 7 rom, én etasje): før rundt 28 (4 per rom). Etter: 3 (åpne, sett, lagre). Enebolig 1. etasje med 9 rom og 2. etasje med 5 rom: før rundt 56, etter rundt 7 (åpne, sett, lagre, åpne, bytt etasje, sett, lagre), pluss én rettelse per avvik.

## Regler
Ingen TG-regler. De rene funksjonene `suggestRoomPreset` og `numberRoomDrafts` har testsaker (tabelltester), og `suggestAreaType`/`suggestBelowGround` brukes uendret.

## Akseptkriterier
- [ ] «Legg til flere rom» på en etasje åpner dialogen med etasjen valgt og det foreslåtte settet merket «Foreslått» (boligtype og etasje).
- [ ] Ett trykk på settet og ett på «Legg til N rom» lagrer alle rommene i etasjen, med riktig romtype, arealtype og «under terreng».
- [ ] Like rom nummereres og fortsetter etter rom som finnes («Soverom 3» når «Soverom 1» og «Soverom 2» finnes). Rom som finnes, endres ikke.
- [ ] Alt lagres i én transaksjon: feiler ett rom (for eksempel ukjent romtype eller etasje i en annen organisasjon), lagres ingen (test).
- [ ] Over 40 rom eller over 20 av én type gir en norsk feilmelding, og tellerne står igjen.
- [ ] Revisjonsloggen har én `create` per rom med `source`, uten romnavn.
- [ ] Bruker i annen organisasjon får ikke tilgang og får ingen rom (test med `expectTenantIsolation`); etasje-id fra skjemaet brukes aldri uten oppslag på `grant.organizationId`.
- [ ] Rolle uten `assignment.edit` får ikke lagre (test); admin får alltid.
- [ ] Nedtrekkslisten for ett rom er gruppert (T-0018).
- [ ] Virker på iPad-størrelse og PC (e2e: sett, teller opp og ned, «Flere romtyper», lagring, rommene vises).
- [ ] KI: ingen KI-kall her. `addRooms` tar imot samme romutkast som KI-punktet i 2a-3 skal levere (typen er eksportert fra `src/core/buildings`).
- [ ] Versjonen i `package.json` er økt (minor: 0.11.0).

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A270 (lett å endre):** fire ferdige sett (leilighet, inngangsetasje, etasje over, kjeller), valgt ut fra boligtype og etasje, som kode og utkast. Grunn: «færrest klikk» (T4); romtypene og gruppene fra A95. Endres i `room-presets.ts`, senere i maleditoren.
- **A271 (lett å endre):** like rom nummereres «Soverom 1, 2 …», og nummeret fortsetter etter rom som finnes. Grunn: rommene må kunne skilles i rapporten og ved reklamasjon.
- **A272 (lett å endre):** høyst 40 rom per operasjon og 20 per romtype. Grunn: vern mot feiltrykk og tunge sider (T-0058); en stor enebolig ligger godt under.
- **A273 (lett å endre):** én etasje per lagring, ingen ny tabell eller kolonne; kilden (`manual`, `preset:<nøkkel>`, senere `ai_floor_plan`) står i revisjonsloggen. Grunn: det enkleste som virker, og samme inngang for KI-forslaget fra plantegning.

## Roller
utvikler (kjerne, handling og dialog), testskriver (tabelltester, transaksjon, tenant-isolasjon, e2e iPad og PC), ux (trykkflyt og flisene; ingen ny visuell stil, bruker Byggcon-profilen).

## Åpne spørsmål
- Ingen som stopper. Settene er utkast som fagrådet kan rette (A270). Neste ledige spørsmålsnummer er 82, om det trengs.
