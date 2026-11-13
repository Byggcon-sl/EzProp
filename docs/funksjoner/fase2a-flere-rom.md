# Funksjon: Flere rom på én gang

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», punktet «Flere rom på én gang med færrest mulig trykk» (T4)
- **Modul:** kjerne (`src/core/buildings`) og siden `/oppdrag/[id]/bygninger`
- **Branch:** `flere-rom-samtidig` (fra `main`)
- **Status:** klar for bygging etter forhåndsvurdering runde 1 (13.11.2026, prosjektleder)
- **Kilde:** Ståle 12.11.2026, T4 (`docs/kartlegging/svar-fra-stale-2026-11-12.md`): «færrest klikk, mest mulig effektivt. ki first»
- **Støtter hovedmål:**
  - **De ansatte:** en vanlig leilighet får alle rommene med tre trykk: åpne, velg sett, lagre. I dag tar det rundt 4 trykk per rom.
  - **KI i bunnen:** listen med romutkast og lagringen `addRooms` er samme inngang som KI-forslaget fra plantegning (2a-3) skal bruke. Da trenger KI-punktet ingen ny skjerm og ingen ny lagring.
  - **Færre reklamasjoner:** riktig romtype gir riktig arealtype, riktig «under terreng» og riktige kontrollpunkter senere, og like rom får nummer slik at de kan skilles i rapporten.

## Problem
Takstmannen legger i dag inn ett rom om gangen: «Legg til rom», velg romtype i en lang liste med 33 typer uten grupper (T-0018), lagre, og så på nytt. En enebolig med 12–15 rom gir 50–60 trykk før befaringen i det hele tatt har startet. Lar vi det være, blir romlisten kortere enn boligen, eller den føres som fritekst.

## KI i bunnen
- **Fra første dag:** ingen KI-kall i dette punktet. KI-forslaget fra plantegning er et eget punkt i 2a-3 («KI: forslag til rom fra plantegning»), og det trenger opplasting av tegning. Det som bygges nå, er grunnmuren KI-forslaget skal stå på:
  - **Én liste med romutkast** (`RoomDraft`: `roomType` og `count`). Settet og tellerne fyller listen, senere også KI-forslaget. Takstmannen ser navnene på rommene før lagring og retter tellerne. Det er kontrollsteget (godta, endre, avvise) som KI-forslaget skal bruke.
  - **Én lagring** i kjernen, `addRooms(actor, organizationId, floorId, input)`, der `input` er `{ drafts, source, presetKey? }`. KI-punktet bruker den uendret.
  - **Kilden** er en lukket kodeliste `ROOM_DRAFT_SOURCES = ["manual", "preset"]`, validert med Zod. `presetKey` er påkrevd når kilden er `preset` og må være en kjent nøkkel i `ROOM_PRESETS`; ellers skal den mangle. Er tellerne rettet etter at settet ble valgt, er kilden fortsatt `preset`. `ai_floor_plan` legges til i kodelisten først når KI-punktet kommer (regel 6), og avvises nå.
  - **Etasjer:** `addRooms` tar én etasje om gangen. KI-punktet deler forslaget per etasje og kaller `addRooms` én gang per etasje. Det skal ikke lages egen lagring for flere etasjer.
  - **Romnavn sendes aldri til KI.** `name` er ikke med i `RoomDraft` nå (navnet lages av `numberRoomDrafts`). Om KI-punktet trenger navn, legges feltet til da, med sperren mot elleve sifre.
- **Settene er faste regler, ikke KI:** forslaget til sett velges ut fra boligtypen på eiendommen og etasjen. `ROOM_PRESETS`, `suggestRoomPreset` og `numberRoomDrafts` er rene funksjoner uten import fra server eller database, slik at befaringsvisningen uten nett (2b) og KI-punktet kan bruke dem uendret.
- **Måling:** revisjonsloggen får `source` og `presetKey` per rom. Hvor mye takstmannen retter på KI-forslag (godtatt, endret, avvist) måles i 2a-3 i `ai_usage_log`, som allerede logger forslag og beslutning. Det bygges ikke egen måling for de faste settene nå (se beslutning under).
- Ingen data går til KI i dette punktet. Kostnad: 0 kr.

## Brukerhistorier
- Som **takstmann** vil jeg **legge inn alle rommene i en etasje i én operasjon** slik at **jeg kommer raskt i gang med befaringen**.
- Som **takstmann** vil jeg **få et ferdig sett som passer boligen og etasjen, og rette antallet** slik at **jeg bare retter det som avviker**.
- Som **takstmann** vil jeg **at like rom får nummer** («Soverom 1», «Soverom 2») slik at **jeg og kjøperen kan skille dem i rapporten**.

## Omfang
**Med:**
1. **Knappen «Legg til flere rom»** på hver etasje på `/oppdrag/[id]/bygninger`, ved siden av «Legg til rom». Den åpner **én dialog for hele siden** (ikke én per etasje, jf. T-0058) for den etasjen. Etasjen kan ikke byttes i dialogen; neste etasje åpnes fra sin egen knapp.
2. **Dialogen** (iPad og PC, rammen Fjord, utseendet bestemmes av ui-designer):
   - Øverst: etasjens navn og «Etasjen har allerede N rom» (når N > 0), så takstmannen ikke legger inn de samme rommene to ganger.
   - **Ferdige sett** som knapper. Settet fra `suggestRoomPreset` står først og er merket «Foreslått». Ett trykk erstatter tellerne (legger ikke til ved nytt trykk).
   - **Vanlige romtyper som fliser med teller:** trykk på flisen = +1, egen «–»-knapp. Flisene: `entrance`, `hallway`, `living_room`, `kitchen`, `living_kitchen`, `bedroom`, `bathroom`, `toilet`, `laundry`, `storage`, `technical_room`. Antallet står med store tall på flisen. Flisen er minst 56 pt, «–» minst 44 pt med god avstand til flisen. Telleren stopper på 20 (flisen blir av).
   - **«Flere romtyper»** folder ut i samme dialog hele listen gruppert etter `group` i `ROOM_TYPES` (ingen ny datastruktur), med samme teller.
   - **Rommene som blir lagt til:** en kort liste med navnene slik de blir lagret («Soverom 3, Soverom 4 …»), laget med `numberRoomDrafts` mot rommene som finnes i etasjen. Ingen redigering per rad.
   - Nederst, fast og synlig uten å rulle på iPad i stående format (56–72 pt): hovedknappen **«Legg til N rom i <etasje>»**. Knappen er av når tellerne er 0, og er av og viser at den jobber mens lagringen pågår (ingen dobbel lagring).
   - Etter lagring lukkes dialogen, og rommene står i etasjen. Lukkes dialogen med tellere over 0, spørres det: «Forkaste N rom?» [Forkast] [Fortsett].
3. **Ferdige sett** som data i `src/core/buildings/room-presets.ts` (A270), merket «utkast, ikke godkjent av fagrådet», med romtypenøkler (ikke navn):
   - `apartment` (Leilighet): `entrance`, `living_room`, `kitchen`, `bathroom`, `bedroom` ×2, `storage`
   - `house_main_floor` (Bolig, inngangsetasje): `entrance`, `hallway`, `living_room`, `kitchen`, `bathroom`, `toilet`, `bedroom`, `storage`
   - `house_upper_floor` (Bolig, etasje over): `hallway`, `bedroom` ×3, `bathroom`
   - `basement` (Kjeller eller underetasje): `hallway`, `laundry`, `storage`, `technical_room`, `basement_living_room`
   - Ren funksjon `suggestRoomPreset({ housingType, floorLevel, floorBelowGround })`, i denne rekkefølgen:
     1. `floorBelowGround` gir `basement`, uansett boligtype.
     2. `apartment` og `apartment_in_house` gir `apartment`.
     3. `floorLevel` 1 eller lavere gir `house_main_floor`.
     4. Ellers `house_upper_floor`.
     `detached`, `semi_detached`, `terraced`, `holiday_home`, `farm`, `other` og manglende eiendom (`null`) går til punkt 3 og 4. Er det feil, retter takstmannen det med ett trykk på et annet sett.
4. **Boligtypen til dialogen:** `getAssignmentBuildings` utvides med `housingType: HousingType | null` fra eiendommen på oppdraget, hentet med `grant.organizationId`. Tenant-testen 4.2.1 utvides til å vise at boligtypen aldri kommer fra organisasjon B.
5. **Nummerering** (A271), ren funksjon `numberRoomDrafts(drafts, existingRooms)`:
   - `existingRooms` er de aktive rommene i etasjen (`roomType`, `name`). Myk-slettede rom telles ikke.
   - Har en romtype bare ett rom i etasjen totalt (nye pluss de som finnes), får det nye rommet tomt navn (romtypens navn vises, som i dag).
   - Ellers får de nye «<romtypens navn> N». Første N er `max(antall aktive rom av typen, høyeste N i navn på formen «<romtypens navn> N») + 1`. Det gir aldri to like navn, også når «Soverom 2» finnes uten «Soverom 1».
   - Rom som finnes, endres aldri. Ett rom med tomt navn fra før beholder det tomme navnet, og det nye blir «Soverom 2».
   - Typene påvirker ikke hverandre.
   - **På serveren** kjøres nummereringen inne i transaksjonen etter `lockFloor`, mot rommene i databasen. Listen i dialogen er bare forhåndsvisning; klienten sender aldri navn.
6. **Lagring i kjernen:** `addRooms` i `src/core/buildings/service.ts`. `requireOrganizationAccess(actor, organizationId, "assignment.edit")`, alle spørringer filtrerer på `grant.organizationId`. Låser etasjen (`lockFloor`), henter aktive rom, nummererer og setter inn alle rommene **i én transaksjon**: feiler noe midt i, lagres ingenting. Arealtype og «under terreng» fra `suggestAreaType` og `suggestBelowGround`, som for ett rom. Revisjonslogg `room`/`create` per rom med `source` og eventuelt `presetKey` i `changes` (aldri romnavn), og hendelsen `assignment.room_saved` per rom, som i dag. Zod-skjemaet `addRoomsInputSchema`: romtype må være en aktiv kode, `count` 1–20 per romtype, høyst 40 rom per operasjon (A272), `source` og `presetKey` som over. Norske feilmeldinger.
7. **Serverhandling** i `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.ts`, uten egen tilgangslogikk, med samme feilmeldingsmønster som de andre handlingene (tellerne står igjen etter feil, jf. T-0050).
8. **Lite funn tatt med (samme område):** T-0018: nedtrekkslisten for ett rom grupperes med `optgroup` etter `group`. Funnet settes til «rettet» med PR-nummer.

**Ikke med (bevisst utelatt):**
- KI-forslag fra plantegning, opplasting av tegning og bilder (eget punkt i 2a-3), og kildekoden `ai_floor_plan`.
- Bytte etasje i dialogen, og flere etasjer i én lagring. Dialogen blir heller ikke stående med neste etasje etter lagring (kan komme senere).
- Navn per rad, redigering per rad i listen, og opphav per rad (`origin`).
- Egen måling av hvor mye takstmannen retter på de faste settene.
- Ferdige sett som Byggcon redigerer selv (kommer med maleditoren); sett per bygningstype (garasje, hytte).
- Areal per rom, rekkefølge på rom (`sort_order`), dra og slipp.
- Uten nett på iPaden (siden er i dag for PC med nett; befaringsvisningen kommer i fase 2b). De rene funksjonene er likevel laget for å kunne brukes der.
- Fjerne eller endre flere rom samtidig, angre (T-0028), rom som følger etasjen ved endring (T-0053).
- Arealskjemaet på bygningssiden (T-0058 er en egen forbedring); dialogen skal bare ikke gjøre siden tyngre.
- Ny tabell, ny kolonne eller migrering.

## Tilgang
| Rolle | Se | Endre (legge til flere rom) |
|---|---|---|
| takstmann | ja | ja (`assignment.edit`, `access.inspectors_edit_all`) |
| kontor | som i dag for bygningssiden | som i dag (`assignment.edit`) |
| leder | ja | ja |
| admin | ja | ja (stenges aldri ute) |

Samme rettighet som «Legg til rom». Ingen ny rettighet. `addRooms` føres i `WRITES` og `WRITE_MATRIX` i testene.

## Data
- Ingen nye tabeller eller kolonner. Rommene lagres i `rooms` som i dag. `tests/tenant-tables.ts` endres ikke.
- Nye kodelister (kode, ikke tabell): `ROOM_PRESETS` med nøklene `apartment`, `house_main_floor`, `house_upper_floor`, `basement`, og `ROOM_DRAFT_SOURCES` med `manual`, `preset` (regel 6: nøklene endres aldri).
- `RoomDraft`, `RoomPreset`, `ROOM_PRESETS`, `ROOM_DRAFT_SOURCES`, `suggestRoomPreset`, `numberRoomDrafts` og `addRooms` eksporteres fra `src/core/buildings/index.ts`. Ingen import fra `src/core/ai`.
- `docs/05-domenemodell.md` 4.4 og ordlisten (avsnitt 8): «romutkast» = `RoomDraft`, «ferdig sett» = `RoomPreset`, «kilde for romutkast» = `ROOM_DRAFT_SOURCES`, `addRooms`.

## Skjermer
- **Bygningssiden, dialogen «Legg til flere rom»** (iPad og PC). Hovedhandling: «Legg til N rom i <etasje>».
- **Trykk før og etter** (anslag, ikke målt): leilighet med 7 rom: før rundt 28 (4 per rom), etter 3 (åpne, sett, lagre). Enebolig med 9 rom i 1. etasje og 5 i 2. etasje: før rundt 56, etter 6 (åpne, sett, lagre, to ganger), pluss 1–2 trykk per rom som avviker fra settet.

## Regler
Ingen TG-regler. De rene funksjonene `suggestRoomPreset` og `numberRoomDrafts` har tabelltester, og `suggestAreaType`/`suggestBelowGround` brukes uendret.

## Akseptkriterier
- [ ] «Legg til flere rom» på en etasje åpner dialogen for den etasjen, med det foreslåtte settet merket «Foreslått» (boligtype og etasje), og viser «Etasjen har allerede N rom» når det finnes rom.
- [ ] Ett trykk på settet og ett på «Legg til N rom i <etasje>» lagrer alle rommene i etasjen, med riktig romtype, arealtype og «under terreng» (kjeller gir `belowGround=true`).
- [ ] Listen i dialogen viser navnene slik de blir lagret.
- [ ] Like rom nummereres på serveren og fortsetter etter rom som finnes («Soverom 3» når «Soverom 1» og «Soverom 2» finnes; «Soverom 3» også når bare «Soverom 2» finnes). Myk-slettede rom telles ikke. Rom som finnes, endres ikke.
- [ ] To samtidige `addRooms` på samme etasje gir unike navn (`lockFloor`).
- [ ] Alt eller ingenting: feil midt i lagringen (revisjonsloggen eller hendelsen feiler på rom nr. 3 av 5) gir 0 nye rom, 0 loggrader og 0 hendelser (test i `buildings-transaction.test.ts` med `failAuditOnce`/`failEventOnce`).
- [ ] Ukjent eller arkivert romtype, `count` 0 eller 21, over 40 rom, ukjent `source`, `ai_floor_plan`, og ukjent eller manglende `presetKey` ved `preset` avvises med norsk melding (enhetstest).
- [ ] Over 40 rom gir serverens norske feilmelding i dialogen, og tellerne står igjen (e2e). Telleren stopper på 20 per romtype i dialogen.
- [ ] Hovedknappen er av mens lagringen pågår; ett trykk gir aldri rommene to ganger (test).
- [ ] Lukking med tellere over 0 spør «Forkaste N rom?».
- [ ] Revisjonsloggen har én `create` per rom med `source` (og `presetKey` ved sett), uten romnavn. Én `assignment.room_saved` per rom.
- [ ] Bruker i annen organisasjon får ikke tilgang og får ingen rom (`expectTenantIsolation` for `addRooms`); etasje-id fra B, ukjent id og ugyldig uuid gir `AccessDeniedError` og 0 rader. Boligtypen i `getAssignmentBuildings` kommer aldri fra B.
- [ ] Myk-slettet etasje, bygning eller oppdrag gir `AccessDeniedError`.
- [ ] Rollematrisen: takstmann med innstillingen av, bruker uten ansattrad og ansatt uten roller avvises; takstmann med innstillingen på, `assignment.edit`, kontor, leder og admin (også uten andre roller og med innstillingen av) får lagre.
- [ ] Hver nøkkel i `ROOM_PRESETS` er en aktiv kode i `ROOM_TYPES`; settene er merket utkast; nøklene står i et øyeblikksbilde.
- [ ] Nedtrekkslisten for ett rom er gruppert med `optgroup` (T-0018), og `startRoom` i `e2e/fase-2a-bygninger-areal-rom.spec.ts` virker fortsatt.
- [ ] Virker på iPad-størrelse og PC (e2e `e2e/fase-2a-flere-rom.spec.ts`: sett, teller opp og ned, nytt trykk på sett erstatter tellerne, «Flere romtyper», kjeller foreslår `basement`, nummerering fortsetter, lagring, rommene står etter ny lasting, trykkflater minst 44 px).
- [ ] KI: ingen KI-kall. `RoomDraft` og `addRooms` er eksportert fra `src/core/buildings` og importerer ikke fra `src/core/ai`.
- [ ] Versjonen i `package.json` er økt (minor: 0.11.0).

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A270 (lett å endre):** fire ferdige sett (leilighet, inngangsetasje, etasje over, kjeller), valgt ut fra boligtype og etasje, som kode og utkast. Grunn: «færrest klikk» (T4); romtypene og gruppene fra A95. Endres i `room-presets.ts`, senere i maleditoren.
- **A271 (lett å endre):** like rom nummereres «Soverom 1, 2 …» på serveren; første nye nummer er høyeste av antall aktive rom og høyeste nummer i navnet, pluss 1. Grunn: rommene må kunne skilles i rapporten og ved reklamasjon, og to like navn skal ikke oppstå.
- **A272 (lett å endre):** høyst 40 rom per operasjon og 20 per romtype. Grunn: vern mot feiltrykk og tunge sider (T-0058); en stor enebolig ligger godt under.
- **A273 (lett å endre):** én etasje per lagring og per dialog, ingen ny tabell eller kolonne; kilden (`manual`, `preset` + `presetKey`) står i revisjonsloggen. KI-punktet kaller `addRooms` én gang per etasje. Grunn: det enkleste som virker, og samme inngang for KI-forslaget fra plantegning.

## Avgjort ved uenighet i forhåndsvurderingen (prosjektleder, 13.11.2026)
- **Bytte etasje i dialogen:** kuttes (forenkler), ikke segmentknapper (ux). Dialogen åpnes fra knappen på etasjen, så bytte sparer ingen trykk, men koster tilstand, et felt og et e2e-steg. Ux sitt hensyn (rommene skal ikke havne i feil etasje) ivaretas av at etasjen står øverst og i hovedknappen.
- **`suggestRoomPreset`:** forenklet uten `lowestAboveGroundLevel` (forenkler). Feil sett rettes med ett trykk.
- **Kilde:** lukket kodeliste `manual`, `preset` med eget `presetKey` (forenkler og ki-ansvarlig er enige). `ai_floor_plan` legges ikke inn nå (ki-ansvarlig, regel 6).
- **`name` og `origin` i `RoomDraft`:** begge utelates nå (forenkler, mot ki-ansvarlig sitt forslag om `origin`). Dialogen viser ikke rader med opphav, og et valgfritt felt kan legges til i 2a-3 uten å endre noe som finnes.
- **Måling av godtatt/endret/avvist:** bygges ikke for de faste settene (mot ki-ansvarlig punkt 2). Det som skal evalueres, er KI-forslagene, og de logges i `ai_usage_log` med forslag og beslutning i 2a-3. Teksten om at kilden per rom gir slik måling er fjernet.
- **Forhåndsvisning av navn, «Etasjen har allerede N rom», sperre mot dobbel lagring og «Forkaste N rom?»:** tas med (ux). Små, og de beskytter mot feil og tapt arbeid.
- **Grenser:** dialogen stopper telleren på 20; 40-grensen gis av serveren og vises i dialogen (test-leder punkt 6).

## Roller
utvikler (kjerne, handling og dialog), testskriver (tabelltester, transaksjon, tenant-isolasjon, rollematrise, e2e iPad og PC). ui-designer (utseendet på dialogen i Fjord). Ux har gitt sine krav i forhåndsvurderingen.

## Åpne spørsmål
- Ingen som stopper. Settene er utkast som fagrådet kan rette (A270). Neste ledige spørsmålsnummer er 82, om det trengs.
