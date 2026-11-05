# Funksjon: Bygninger, etasjer, areal per etasje og rom

- **Fase:** 2a – Rapporten på PC (punktet «Bygninger, etasjer, areal per etasje (BRA-i, BRA-e, BRA-b, ALH) med hvem som målte og metode, og rom med romtype og ‹under terreng›» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/buildings`, ny side `/oppdrag/[id]/bygninger` og en kort oppsummering på `/oppdrag/[id]`, i rammen Fjord)
- **Branch:** `fase2a-bygninger-areal-rom` (fra `main`, bygger på eiendommen fra PR #91, merget)
- **Status:** utkast (05.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: rom legges til ved å velge romtype fra en fast liste; arealtype og «under terreng» foreslås ut fra romtypen og etasjen, og BRA summeres automatisk per bygning og totalt, så takstmannen slipper å regne og skrive det samme flere ganger. Reklamasjoner: areal er en vanlig reklamasjonsgrunn (sidemannskontrollen 25.10.2026), så hvem som målte, metoden og om det var vanskelig å måle står svart på hvitt per etasje; BRA totalt og fordelt (forskriften § 2-20) kan ikke glemmes; romtypens gruppe og «under terreng» blir grunnlaget for at våtrom og rom under terreng senere alltid får sine kontrollpunkter og krav om hulltaking (§ 2-2 og § 2-15). KI først: strukturen (bygning → etasje → areal og rom med faste koder) er den samme som en senere plantegning, LiDAR-måling (krok K7) eller KI-forslag fra bilder kan fylle ut, slik at takstmannen bare kontrollerer. Ingen KI nå.

## Problem
Oppdraget har eiendom og matrikkel (PR #91), men ingen bygninger, etasjer, areal eller rom. Uten dem kan rapporten ikke vise arealtabellen som forskriften krever (§ 2-20: BRA totalt og fordelt på BRA-i, BRA-e og BRA-b), og malen kan senere ikke vite hvilke rom som er våtrom, kjøkken eller under terreng. Kontrollpunktene per bygning og rom (eget planpunkt under «Rapporten på PC») trenger dette som grunnlag. Lar vi være, må takstmannen skrive areal og romliste som fritekst, slik det blir feil i dag.

## KI først
Ikke nå. Takstmannen legger inn alt for hånd på PC. Kroken er at alt er strukturerte data med faste koder: romtype, arealtype, målemetode og bygningstype er koder, ikke tekst. Senere kan en plantegning, iPadens LiDAR (metoden `lidar`, krok K7) eller KI på bilder foreslå rom og areal, og takstmannen godkjenner. Kopiering fra forrige rapport på samme bolig (`copied_from_id`) kommer med rapportene.

## Brukerhistorier
- Som **takstmann** vil jeg **legge inn bygningene på eiendommen** (for eksempel bolighus og garasje) med byggeår og kilden for byggeåret, slik at **rapporten viser hva som er vurdert, og alderen senere kan brukes i reglene**.
- Som **takstmann** vil jeg **legge inn etasjene i hver bygning** og merke om etasjen er under terreng, slik at **rom under terreng blir riktig merket**.
- Som **takstmann** vil jeg **føre BRA-i, BRA-e, BRA-b og ALH per etasje, med hvem som målte og hvordan**, slik at **arealet kan etterprøves ved en reklamasjon**.
- Som **takstmann** vil jeg **legge til rom ved å velge romtype**, og få forslag til arealtype og «under terreng», slik at **jeg bare retter det som avviker**.
- Som **kontor** vil jeg **se sum BRA og antall bygninger på oppdraget** slik at **jeg ser at arealet er ført før rapporten sendes**.

## Omfang
**Med:**
1. **Tabellen `report_buildings`** (migrering `0017`), enkel utgave av domenemodellen 4.4, per oppdrag til rapportene finnes (A78): `baseColumns`, `assignment_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, assignment_id)` → `assignments`), `property_id` (påkrevd, sammensatt fremmednøkkel → `properties`; settes av kjernen fra `assignments.property_id`, aldri fra skjemaet), `name` (påkrevd, høyst 100 tegn), `building_type` (påkrevd, fast kode, CHECK, se punkt 5), `is_main` (påkrevd, standard `false`), `build_year` (valgfri, 1600 til inneværende år + 1), `build_year_source` (valgfri, CHECK: `documented`, `owner_stated`, `estimated`; påkrevd når `build_year` er satt, CHECK), `sort_order` (heltall). Unik indeks `(organization_id, id)`. Unik delvis indeks `(organization_id, assignment_id)` der `is_main` og `deleted_at is null` (bare ett hovedbygg).
2. **Tabellen `floors`** (samme migrering): `baseColumns`, `report_building_id` (påkrevd, sammensatt fremmednøkkel → `report_buildings`), `name` (påkrevd, høyst 50 tegn), `level` (påkrevd, heltall −3 til 20, for rekkefølge), `below_ground` (påkrevd, standard `false`). Unik indeks `(organization_id, id)`.
3. **Tabellen `floor_areas`** (samme migrering), én aktiv rad per etasje (A80): `baseColumns`, `floor_id` (påkrevd, sammensatt fremmednøkkel → `floors`), `bra_i`, `bra_e`, `bra_b`, `alh`, `tba` (alle `numeric(7,1)`, valgfri, 0–9999,9 m², CHECK `>= 0`), `measured_by` (valgfri, sammensatt fremmednøkkel `(organization_id, measured_by)` → `employees`), `method` (valgfri, CHECK: `laser`, `drawing`, `other`), `hard_to_measure` (påkrevd, standard `false`), `comment` (valgfri, høyst 1000 tegn). Unik delvis indeks `(organization_id, floor_id)` der `deleted_at is null`.
4. **Tabellen `rooms`** (samme migrering): `baseColumns`, `floor_id` (påkrevd, sammensatt fremmednøkkel → `floors`), `room_type` (påkrevd, fast kode, CHECK med alle kodene i punkt 5), `name` (valgfri, høyst 100 tegn; tom betyr at romtypens navn vises), `area_type` (påkrevd, CHECK: `bra_i`, `bra_e`, `bra_b`), `below_ground` (påkrevd), `sort_order` (heltall). Indeks `(organization_id, floor_id)`. `geometry` kommer med plantegning (K7).
5. **Faste koder** i `src/core/buildings/codes.ts` (`as const`, endres aldri, regel 6), med etiketter:
   - `BUILDING_TYPES`: `residential` (Bolighus), `garage` (Garasje), `outbuilding` (Uthus eller bod), `annex` (Anneks), `other` (Annet).
   - `BUILD_YEAR_SOURCES`: `documented` (Dokumentert), `owner_stated` (Eier opplyser), `estimated` (Anslått).
   - `AREA_TYPES`: `bra_i` (BRA-i), `bra_e` (BRA-e), `bra_b` (BRA-b).
   - `MEASURING_METHODS`: `laser` (Oppmålt med laser), `drawing` (Fra tegning), `other` (Annen kilde).
   - `ROOM_TYPE_GROUPS`: `wet_room`, `kitchen`, `toilet`, `special`, `other`.
   - `ROOM_TYPES` (A79): liste med `key`, etikett, `group`, `defaultAreaType` og `defaultBelowGround`, og merket `draft: true` («utkast, ikke godkjent av fagrådet»). Listen er Byggcons egen, kortere enn IVITs 55:
     - våtrom: `bathroom` (Bad), `laundry` (Vaskerom), `bathroom_laundry` (Bad og vaskerom), `room_with_drain` (Annet rom med sluk), `other_wet_room` (Annet våtrom)
     - kjøkken: `kitchen` (Kjøkken), `living_kitchen` (Stue og kjøkken)
     - toalett: `toilet` (Toalettrom)
     - spesialrom: `sauna` (Badstue), `boiler_room` (Fyrrom), `technical_room` (Teknisk rom), `cold_room` (Kjølerom), `swimming_pool` (Svømmebasseng)
     - andre: `living_room` (Stue), `bedroom` (Soverom), `office` (Kontor eller arbeidsrom), `family_room` (Allrom), `dining_room` (Spisestue), `entrance` (Entré og vindfang), `hallway` (Gang og hall), `stairwell` (Trapperom), `wardrobe` (Garderobe), `storage` (Bod, inne), `external_storage` (Bod, ute, BRA-e), `basement_living_room` (Kjellerstue, under terreng), `basement_room` (Kjellerrom, uinnredet, under terreng), `crawl_space` (Kryperom, under terreng), `attic_living_room` (Loftstue), `unfinished_attic` (Loft, uinnredet), `garage` (Garasje, BRA-e), `glazed_balcony` (Innglasset balkong, BRA-b), `workshop` (Verksted), `other` (Annet)
     - Standard arealtype er `bra_i`, unntatt `external_storage` og `garage` (`bra_e`) og `glazed_balcony` (`bra_b`). Standard «under terreng» er sann bare for `basement_living_room`, `basement_room` og `crawl_space`.
   - Rene funksjoner med testsaker (A81): `suggestAreaType(roomType)` gir romtypens standard arealtype; `suggestBelowGround({ roomType, floorBelowGround })` er sann når etasjen er under terreng eller romtypen vanligvis er det; `sumFloorArea(area)` gir BRA = BRA-i + BRA-e + BRA-b (tomme felt teller som 0, én desimal); `sumBuildingArea(floors)` og `sumAssignmentArea(buildings)` summerer per arealtype og totalt.
6. **Skjema** i `src/core/buildings/schemas.ts` (Zod): `buildingInputSchema`, `floorInputSchema`, `floorAreaInputSchema`, `roomInputSchema`. Tekst trimmes, tom tekst blir `null`. Areal godtar komma og punktum, høyst én desimal, 0–9999,9. Fritekstfeltene (navn, kommentar) avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»), samme mønster som eiendommen. `measured_by` i skjemaet sjekkes i kjernen mot ansatte i `grant.organizationId`.
7. **Tjenester i `src/core/buildings`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`; foreldreraden låses med `FOR UPDATE` i skrivingene):
   - `getAssignmentBuildings(actor, organizationId, assignmentId)`: `organization.read`. Gir bygningene (sortert: hovedbygg først, så `sort_order`) med etasjer (sortert på `level`), areal per etasje (eller `null`), rom (sortert på `sort_order`) og summene fra punkt 5. Gir også `hasProperty` (om oppdraget har en aktiv eiendom) og `employees` (aktive ansatte i organisasjonen, id og navn, til «Målt av»).
   - `saveBuilding(actor, organizationId, assignmentId, buildingId | null, input)`: `assignment.edit`. Lager eller oppdaterer. Krever aktiv eiendom på oppdraget, ellers `PropertyMissingError` («Legg inn eiendommen før du legger til bygninger.»). Første bygning på oppdraget blir hovedbygg. Settes `is_main` på en annen, flyttes merket i samme transaksjon.
   - `removeBuilding(...)`: `assignment.edit`. Myk sletting. Bare når bygningen ikke har aktive etasjer, ellers `BuildingNotEmptyError` («Fjern etasjene først.»). Var den hovedbygg, blir den eldste gjenværende hovedbygg (A82).
   - `saveFloor(actor, organizationId, buildingId, floorId | null, input)` og `removeFloor(...)`: `assignment.edit`. Fjerning bare når etasjen ikke har aktive rom, ellers `FloorNotEmptyError` («Fjern rommene først.»); arealraden myk-slettes sammen med etasjen.
   - `saveFloorArea(actor, organizationId, floorId, input)`: `assignment.edit`. Lager eller oppdaterer den ene raden. `measured_by` må være en aktiv ansatt i samme organisasjon, ellers `AccessDeniedError`. Står feltet tomt når et areal fylles ut, settes den innloggede ansatte.
   - `saveRoom(actor, organizationId, floorId, roomId | null, input)` og `removeRoom(...)`: `assignment.edit`. Kommer `area_type` eller `below_ground` ikke med i input, brukes forslagene fra punkt 5.
   - **Hendelser og revisjonslogg** i samme transaksjon: `assignment.building_saved`, `assignment.building_removed`, `assignment.floor_saved`, `assignment.floor_removed`, `assignment.floor_area_saved`, `assignment.room_saved`, `assignment.room_removed`, alle med `data: { <id>, created }` (bare id-er og `created`). Revisjonslogg `report_building`, `floor`, `floor_area`, `room` med `create`/`update`/`delete`; `changes` har bare id-er, kodene og navnene på feltene som ble endret. **Aldri navn på bygning, etasje eller rom, eller kommentar** (raden er kilden). Ingen endring gir ingen hendelse.
8. **Skjermene** (PC først, må virke i iPad-størrelse):
   - **`/oppdrag/[id]`:** ny del **«Bygninger og areal»** under «Fellesdeler»: antall bygninger, sum BRA (og BRA-i, BRA-e, BRA-b) og lenken «Bygninger, areal og rom». Uten eiendom: «Legg inn eiendommen først.»
   - **`/oppdrag/[id]/bygninger`** (ny side): én blokk per bygning med navn, type, hovedbygg, byggeår og kilde. Under hver bygning: etasjene i rekkefølge, hver med arealfeltene (BRA-i, BRA-e, BRA-b, ALH, TBA, «Målt av», «Metode», «Vanskelig å måle», kommentar) og rommene (romtype, navn, arealtype, «Under terreng»). Sum BRA per etasje, per bygning og totalt vises og oppdateres etter lagring. Knappene «Legg til bygning», «Legg til etasje», «Legg til rom», «Lagre areal» og «Fjern». Romtypen er en nedtrekksliste gruppert etter gruppe; når den velges, settes arealtype og «Under terreng» til forslaget (kan endres før lagring). Etasjenavn er tekst med forslag («Kjeller», «Underetasje», «1. etasje», «2. etasje», «Loft»). Uten `canEditOrders` vises alt som tekst.
   - Server actions i `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.ts`, samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som eiendommen (aldri skjemaverdier i loggen). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Kjente feil: `PropertyMissingError`, `BuildingNotEmptyError`, `FloorNotEmptyError`.
   - Feilmeldinger på norsk: «Skriv inn navnet på bygningen.», «Velg bygningstype.», «Byggeåret må være et årstall mellom 1600 og <år + 1>.», «Velg hvor byggeåret kommer fra.», «Skriv inn navnet på etasjen.», «Etasjenummeret må være mellom −3 og 20.», «Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.», «Velg romtype.», «Fødselsnummer skal ikke lagres her.»
9. **Tester** (testskriver). Testdata er oppdiktet.
   - **Fabrikker:** `createBuilding`, `createFloor`, `createFloorArea`, `createRoom` i `tests/factories.ts` (tester i `factories.test.ts`); `RESET_TABLES` får de fire tabellene; alle fire i `tests/tenant-tables.ts` med `src/core/buildings/buildings.test.ts`.
   - **Enhetstester (`codes.test.ts`):** kodene og etikettene i fast rekkefølge; hver romtype har gyldig gruppe og arealtype; `suggestAreaType` for `bathroom`, `garage`, `external_storage`, `glazed_balcony`; `suggestBelowGround` for alle fire kombinasjoner (romtype under terreng ja/nei × etasje under terreng ja/nei); `sumFloorArea` med tomme felt, desimaler (0,1 + 0,2 = 0,3, ingen flyttallsfeil) og ALH/TBA som ikke tas med i BRA; summene per bygning og oppdrag.
   - **Skjemaene (`schemas.test.ts`):** grensene for hvert felt (100/101, 50/51, 1000/1001 tegn; byggeår 1599, 1600, år + 1, år + 2; etasje −4, −3, 20, 21; areal −0,1, 0, 9999,9, 10000, to desimaler, komma og punktum), trimming, tom tekst blir `null`, ukjente koder, byggeår uten kilde, 11 sifre på rad. Alle feilmeldingene i punkt 8.
   - **Database (`src/db/buildings-schema.test.ts`):** databasen avviser ukjente koder, negativt areal, byggeår uten kilde, rader som peker på oppdrag, eiendom, bygning, etasje eller ansatt i en annen organisasjon, to aktive hovedbygg på samme oppdrag og to aktive arealrader på samme etasje (myk-slettede rader sperrer ikke).
   - **Tenant-isolasjon (regel 2):** `expectTenantIsolation` for alle tjenestene i punkt 7. **IDOR:** A med egen org-id og Bs oppdrags-, bygnings-, etasje- eller rom-id gir `AccessDeniedError`, og Bs data er uendret. `measured_by` med en ansatt fra B gir `AccessDeniedError`.
   - **Rettigheter:** lese med `organization.read`, skrive med `assignment.edit`, kjørt med `access.inspectors_edit_all` på og av (admin stenges aldri ute, regel 11).
   - **Oppførsel:** bygning uten eiendom gir `PropertyMissingError`; første bygning blir hovedbygg; flytting av hovedbygg; fjerning av hovedbygg flytter merket; fjerning av bygning med etasjer og etasje med rom avvises; fjerning av etasje myk-sletter arealraden; areal uten «Målt av» får den innloggede; rom uten arealtype og «under terreng» får forslagene; lagring uten endring gir ingen hendelse; slettet oppdrag gir `AccessDeniedError`.
   - **Hendelser og logg:** i samme transaksjon; hele JSON-en gjøres om til tekst, og navn og kommentar står ikke der.
   - **Handlingene (`bygninger/actions.test.ts`):** id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen; de tre kjente feilene gir norsk melding; loggeren får aldri skjemaverdier.
   - **E2E i `pc` og `ipad`** (`e2e/fase-2a-bygninger-areal-rom.spec.ts`): oppdrag med eiendom → «Bygninger, areal og rom» → legg til «Bolighus» (byggeår, eier opplyser) → legg til «Kjeller» (under terreng) og «1. etasje» → før areal på begge → legg til «Bad» i 1. etasje (arealtype BRA-i, ikke under terreng) og «Kjellerstue» i kjelleren (under terreng forhåndsvalgt) → sum BRA stemmer → last siden på nytt, verdiene står → oppsummeringen på oppdraget viser summen. Oppdrag uten eiendom viser «Legg inn eiendommen først.»
10. **Dokumenter:** domenemodellen 4.4 får «Bygget i fase 2a» for bygninger, etasjer, areal og rom (hva som er med, hva som venter), ordlisten får de nye ordene, planpunktet krysses av, beslutningene A78–A83 føres i `docs/09-apne-sporsmal.md`. Versjon 0.2.77 → neste ledige ved PR.

**Ikke med (bevisst utelatt):**
- Oppslag av bygninger, byggeår eller areal fra matrikkelen, Eiendomsverdi eller andre (koster penger og krever konto). Bare for hånd på PC.
- iPad uten nett, plantegning, romskisse (`geometry`), LiDAR-måling (`lidar`, krok K7) og fuktkart.
- Kopiering fra en tidligere rapport (`copied_from_id`), og `report_id` (kommer når rapporten bygges, A78).
- Tilbygg og modernisering (`extensions`), bygningsnummer i matrikkelen (`building_number`), undertype, anvendelse, standard, vedlikehold og bilde av bygningen.
- Areal oppgitt av eier eller annen kilde til sammenligning (`other_source_value`), og areal per rom.
- Romtyper som tabell som Byggcon redigerer selv (`room_types`). Listen er kode nå (A79); tabellen kommer med maleditoren.
- Kontrollpunkter per bygning og rom, regler som bruker romgruppe eller «under terreng», og hulltakingskrav (egne planpunkter).
- Arealtabellen i PDF-en og fast forklaring om areal (kommer med PDF-en).
- Dra og slipp for rekkefølge; rekkefølgen er `level` for etasjer og opprettelsesrekkefølge for bygninger og rom.
- Lovlighet og brannceller per bygning.
- Nye avhengigheter, ny rettighet.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ja, alle oppdrag (`organization.read`) | Når `access.inspectors_edit_all` er på (`assignment.edit`); ellers ikke (A20) |
| kontor | Ja | Ja (`assignment.edit`) |
| leder | Ja | Ja |
| admin | Ja | Ja (admin stenges aldri ute) |

Ingen endring i `src/core/access`.

## Data
- Nye tabeller `report_buildings`, `floors`, `floor_areas` og `rooms` (migrering `0017`), alle med `organization_id`, myk sletting og sammensatte fremmednøkler. `report_buildings` har `assignment_id` til rapportene finnes (A78).
- Nye faste koder: `building_type` (fem), `build_year_source` (tre), `area_type` (tre), `method` (tre), romgrupper (fem) og romtyper (33, utkast). Ingen kode endres senere, bare arkiveres (regel 6).
- Hendelser og revisjonslogg som i punkt 7. Ingen navn eller kommentar i hendelser eller logg.
- Oppdater `docs/05-domenemodell.md` 4.4 og ordlisten (`report_building`, `floor`, `floor_area`, `room`, `room_type`, `room_type_group`, `area_type`, `bra_i`, `bra_e`, `bra_b`, `alh`, `tba`, `measured_by`, `measuring_method`, `hard_to_measure`, `below_ground`, `build_year_source`, `is_main`).

## Skjermer
- **PC og iPad.** Én ny side og én ny del på oppdraget.
- Hovedhandling: legg til bygning (navn, type, byggeår, kilde → «Lagre», 4 trykk) → legg til etasje (navn, nivå, under terreng → «Lagre») → før areal (fire tall, metode → «Lagre areal»; «Målt av» er forhåndsvalgt) → legg til rom (velg romtype → «Lagre», 2 trykk når forslagene stemmer). I IVIT må arealtype og romnummer fylles ut per rom; her er de forhåndsvalgt.
- iPad-størrelse: én kolonne, knapper minst 44 px. På PC kan arealfeltene stå på én linje.

## Regler
Ingen fagregler. Dataregler med testsaker: `suggestAreaType`, `suggestBelowGround`, summene (punkt 5 og 9). Hvilke kontrollpunkter romgruppe og «under terreng» slår på, kommer med regelmotoren.

## Akseptkriterier
- [ ] Takstmann (med `access.inspectors_edit_all` på) og kontor kan legge til, endre og fjerne bygninger, etasjer og rom, og føre areal per etasje, på et oppdrag med eiendom.
- [ ] Arealet per etasje har BRA-i, BRA-e, BRA-b, ALH og TBA, hvem som målte (forhåndsvalgt innlogget), metode, «vanskelig å måle» og kommentar. Sum BRA vises per etasje, bygning og oppdrag.
- [ ] Rom har romtype fra den faste listen; arealtype og «under terreng» foreslås og kan endres.
- [ ] Bare ett hovedbygg per oppdrag; første bygning blir hovedbygg.
- [ ] Bygning med etasjer og etasje med rom kan ikke fjernes; fjerning er myk sletting.
- [ ] Uten eiendom kan det ikke legges til bygninger, og skjermen sier «Legg inn eiendommen først.»
- [ ] Hendelser og revisjonslogg skrives i samme transaksjon og inneholder aldri navn eller kommentar.
- [ ] Med `access.inspectors_edit_all` av får takstmann ikke endret (test i kjernen).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for alle tjenestene; fire tabeller i `tests/tenant-tables.ts`). Fremmed id i egen organisasjon og «Målt av» fra en annen organisasjon avvises uten endring.
- [ ] Virker på iPad-størrelse (e2e i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A78–A83)
Numrene starter på A78 fordi statusflyten (branch `fase2a-statusflyt`) har fire beslutninger som får A74–A77 når den flettes med `main`. Blir den merget med andre numre, eller blir denne merget først, nummereres det om ved fletting. Migreringen er `0017`, fordi statusflyten ikke har noen migrering.
- **A78:** Bygninger, etasjer, areal og rom lagres **per oppdrag** (`report_buildings.assignment_id`) til rapportene finnes; da får tabellen `report_id`. Tabellen heter `report_buildings` allerede nå, så kontrollpunktsvarene senere kan peke på `report_building_id` uten omdøping. `property_id` lagres også, satt fra oppdragets eiendom. I betaen har hvert oppdrag én rapport. Kilde: domenemodellen 4.4 («hører til den enkelte rapporten»), A71 (samme løsning for fellesdeler). Endres ved å legge til `report_id` når rapporten bygges.
- **A79:** **Romtypene er en fast kodeliste i koden** med 33 typer, gruppe, standard arealtype og standard «under terreng», merket «utkast, ikke godkjent av fagrådet». Listen er Byggcons egen og kortere enn IVITs 55; like rom er slått sammen (for eksempel stue, TV-stue og peisstue til «Stue»). Etter forslaget i kravdokumentet gir «Annet rom med sluk» våtromsgruppen, og «Teknisk rom» og «Svømmebasseng» er spesialrom (NS 3600 A.2.8, og basseng skal ha TGIU). Kilde: `kravdokument.md` 2.6 b), sidemannskontrollen P7, domenemodellen 4.4. Endres ved å legge til nye koder (aldri endre en kode); listen blir tabell (`room_types`) når maleditoren kommer.
- **A80:** **Arealet føres per etasje** med BRA-i, BRA-e, BRA-b, ALH og TBA i m² med én desimal, én rad per etasje. BRA er summen av BRA-i, BRA-e og BRA-b; ALH og TBA vises, men tas ikke med i BRA. Metodene er laser, tegning og annen kilde; LiDAR legges til som ny kode senere (K7). «Målt av» er forhåndsvalgt til den innloggede. «Vanskelig å måle» og kommentar er med fordi areal er en vanlig reklamasjonsgrunn. Kilde: forskriften § 2-20, domenemodellen 4.4, IVIT-analysen 27.10.2026 (arealtabell per etasje med TBA), sidemannskontrollen 25.10.2026. Endres i `sumFloorArea` og kodelisten.
- **A81:** **Forslag til arealtype og «under terreng» for rom:** arealtypen kommer fra romtypen; «under terreng» er sant når etasjen er under terreng eller romtypen vanligvis er det. Takstmannen kan endre begge. Hellere ett forslag for mye om «under terreng» enn ett for lite, fordi det styrer kravet om hulltaking (§ 2-15). Kilde: domenemodellen 4.4 (`below_ground`: «forslag fra romtype og etasje»), sidemannskontrollen P7. Endres i `suggestBelowGround` med testsakene.
- **A82:** **Bygning og etasje kan bare fjernes når de er tomme** (ingen aktive etasjer eller rom). Fjerning er myk sletting. Første bygning blir hovedbygg, og fjernes hovedbygget, blir den eldste gjenværende hovedbygg. Det enkleste som virker, og ingen mister rom ved et feiltrykk. Kilde: regel 3 (ingenting slettes permanent), domenemodellen 4.4 (`is_main`, bare én). Endres ved å tillate fjerning med alt under.
- **A83:** **Byggeår og kilden for byggeåret** (dokumentert, eier opplyser, anslått) er med på bygningen nå, fordi regelmotoren trenger alderen og kilden (planen: «TG-forslag fra alder, med kilde for alderen»). Bygningstypene er bolighus, garasje, uthus eller bod, anneks og annet. Kilde: domenemodellen 4.4, svar 25.10.2026 (byggeår registreres for hånd i starten), eiendomskortet (byggeår hører til bygningene). Endres ved å legge til nye koder.

## Roller
- **utvikler:** migrering og skjema, koder, `schemas.ts`, tjenestene i `src/core/buildings`, siden og handlingene, oppsummeringen på oppdraget, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): punkt 9.
- **sikkerhet-personvern:** gjennomgang før PR: fire nye tabeller med `organization_id` og sammensatte fremmednøkler, `measured_by` mot ansatte i samme organisasjon, at navn og kommentar ikke havner i hendelser, revisjonslogg eller applikasjonslogg, og at ingen id fra skjemaet brukes til filtrering uten å gå via `grant.organizationId`.
- **fagansvarlig** (kort sjekk, ingen avvikstekster): romtypelisten med grupper og standardverdier (A79), arealreglene (A80) og forslaget om «under terreng» (A81).

Ikke med: arkitekt (ingen ny ADR, følger domenemodellen og A71), ux-ansvarlig og ui-designer (siden følger mønsteret fra eiendom, team og parter i rammen Fjord), KI.

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/report-buildings.ts`, `floors.ts`, `floor-areas.ts`, `rooms.ts` (+ `index.ts`, migrering `0017`), `src/core/buildings/*` (ikke `*.test.ts`), `src/app/(ansatt)/oppdrag/[id]/bygninger/*` (ikke `*.test.ts`), oppsummeringen i `src/app/(ansatt)/oppdrag/[id]/page.tsx`, `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/buildings/buildings.test.ts`, `src/core/buildings/codes.test.ts`, `src/core/buildings/schemas.test.ts`, `src/db/buildings-schema.test.ts`, `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.test.ts`, `e2e/fase-2a-bygninger-areal-rom.spec.ts`.
   Testskriveren skriver mot signaturene i dette kortet. Avviker utvikleren, står det under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.

## Åpne spørsmål
- Ingen som stopper oppgaven. Romtypelisten og arealreglene er utkast som fagrådet (Ståle) godkjenner før ekte bruk (A79, A80).
