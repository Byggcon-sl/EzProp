# Funksjon: Bygninger, etasjer, areal per etasje og rom

- **Fase:** 2a – Rapporten på PC (punktet «Bygninger, etasjer, areal per etasje (BRA-i, BRA-e, BRA-b, ALH) med hvem som målte og metode, og rom med romtype og ‹under terreng›» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/buildings`, ny side `/oppdrag/[id]/bygninger` og en lenke dit fra `/oppdrag/[id]`, i rammen Fjord)
- **Branch:** `fase2a-bygninger-areal-rom` (fra `main`, bygger på eiendommen fra PR #91, merget)
- **Status:** klar for bygging (05.11.2026, prosjektleder; forenklet etter gjennomgangen, se «Avgjørelser etter gjennomgangen»)
- **Støtter hovedmål:** Tid: rom legges til ved å velge romtype fra en fast liste; arealtype og «under terreng» foreslås ut fra romtypen og etasjen, og BRA summeres automatisk per bygning og totalt, så takstmannen slipper å regne og skrive det samme flere ganger. Reklamasjoner: areal er en vanlig reklamasjonsgrunn (sidemannskontrollen 25.10.2026), så hvem som målte, metoden og en kommentar står svart på hvitt per etasje; BRA totalt og fordelt (forskriften § 2-20) kan ikke glemmes; romtypens gruppe og «under terreng» blir grunnlaget for at våtrom og rom under terreng senere alltid får sine kontrollpunkter og krav om hulltaking (§ 2-2 og § 2-15). KI først: strukturen (bygning → etasje → areal og rom med faste koder) er den samme som en senere plantegning, LiDAR-måling (krok K7) eller KI-forslag fra bilder kan fylle ut, slik at takstmannen bare kontrollerer. Ingen KI nå.

## Problem
Oppdraget har eiendom og matrikkel (PR #91), men ingen bygninger, etasjer, areal eller rom. Uten dem kan rapporten ikke vise arealtabellen som forskriften krever (§ 2-20: BRA totalt og fordelt på BRA-i, BRA-e og BRA-b), og malen kan senere ikke vite hvilke rom som er våtrom, kjøkken eller under terreng. Kontrollpunktene per bygning og rom (eget planpunkt under «Rapporten på PC») trenger dette som grunnlag. Lar vi være, må takstmannen skrive areal og romliste som fritekst, slik det blir feil i dag.

## KI først
Ikke nå. Takstmannen legger inn alt for hånd på PC. Kroken er at alt er strukturerte data med faste koder: romtype, arealtype og målemetode er koder, ikke tekst. Senere kan en plantegning, iPadens LiDAR (metoden `lidar`, krok K7) eller KI på bilder foreslå rom og areal, og takstmannen godkjenner. Kopiering fra forrige rapport på samme bolig (`copied_from_id`) kommer med rapportene.

## Brukerhistorier
- Som **takstmann** vil jeg **legge inn bygningene på eiendommen** (for eksempel bolighus og garasje), slik at **rapporten viser hva som er vurdert**.
- Som **takstmann** vil jeg **legge inn etasjene i hver bygning** og merke om etasjen er under terreng, slik at **rom under terreng blir riktig merket**.
- Som **takstmann** vil jeg **føre BRA-i, BRA-e, BRA-b og ALH per etasje, med hvem som målte og hvordan**, slik at **arealet kan etterprøves ved en reklamasjon**.
- Som **takstmann** vil jeg **legge til rom ved å velge romtype**, og få forslag til arealtype og «under terreng», slik at **jeg bare retter det som avviker**.
- Som **kontor** vil jeg **se sum BRA per bygning og totalt på bygningssiden** slik at **jeg ser at arealet er ført før rapporten sendes**.

## Omfang
**Med:**
1. **Tabellen `report_buildings`** (migrering `0018`), enkel utgave av domenemodellen 4.4, per oppdrag til rapportene finnes (A84): `baseColumns`, `assignment_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, assignment_id)` → `assignments`), `name` (påkrevd, høyst 100 tegn). Unik indeks `(organization_id, id)`, indeks `(organization_id, assignment_id)`. Ingen `property_id`: eiendommen finnes via `assignments.property_id`, så den kan ikke komme i utakt.
2. **Tabellen `floors`** (samme migrering): `baseColumns`, `report_building_id` (påkrevd, sammensatt fremmednøkkel → `report_buildings`), `name` (påkrevd, høyst 50 tegn), `level` (påkrevd, heltall −3 til 20, for rekkefølge), `below_ground` (påkrevd, standard `false`). Unik indeks `(organization_id, id)`.
3. **Tabellen `floor_areas`** (samme migrering), én aktiv rad per etasje (A86): `baseColumns`, `floor_id` (påkrevd, sammensatt fremmednøkkel → `floors`), `bra_i`, `bra_e`, `bra_b`, `alh` (alle `numeric(7,1)`, valgfri, 0–9999,9 m², CHECK `>= 0`), `measured_by` (valgfri, sammensatt fremmednøkkel `(organization_id, measured_by)` → `employees`), `method` (valgfri, CHECK: `laser`, `drawing`, `other`), `comment` (valgfri, høyst 1000 tegn). Unik delvis indeks `(organization_id, floor_id)` der `deleted_at is null`.
4. **Tabellen `rooms`** (samme migrering): `baseColumns`, `floor_id` (påkrevd, sammensatt fremmednøkkel → `floors`), `room_type` (påkrevd, fast kode, CHECK med alle kodene i punkt 5), `name` (valgfri, høyst 100 tegn; tom betyr at romtypens navn vises), `area_type` (påkrevd, CHECK: `bra_i`, `bra_e`, `bra_b`), `below_ground` (påkrevd). Indeks `(organization_id, floor_id)`. `geometry` kommer med plantegning (K7).
5. **Faste koder** i `src/core/buildings/codes.ts` (`as const`, endres aldri, regel 6), med etiketter:
   - `AREA_TYPES`: `bra_i` (BRA-i), `bra_e` (BRA-e), `bra_b` (BRA-b).
   - `MEASURING_METHODS`: `laser` (Oppmålt med laser), `drawing` (Fra tegning), `other` (Annen kilde).
   - `ROOM_TYPE_GROUPS`: `wet_room`, `kitchen`, `toilet`, `special`, `other`.
   - `ROOM_TYPES` (A85): liste med `key`, etikett, `group`, `defaultAreaType` og `defaultBelowGround`, og merket `draft: true` («utkast, ikke godkjent av fagrådet»). Listen er Byggcons egen, kortere enn IVITs 55:
     - våtrom: `bathroom` (Bad), `laundry` (Vaskerom), `bathroom_laundry` (Bad og vaskerom), `room_with_drain` (Annet rom med sluk), `other_wet_room` (Annet våtrom)
     - kjøkken: `kitchen` (Kjøkken), `living_kitchen` (Stue og kjøkken)
     - toalett: `toilet` (Toalettrom)
     - spesialrom: `sauna` (Badstue), `boiler_room` (Fyrrom), `technical_room` (Teknisk rom), `cold_room` (Kjølerom), `swimming_pool` (Svømmebasseng)
     - andre: `living_room` (Stue), `bedroom` (Soverom), `office` (Kontor eller arbeidsrom), `family_room` (Allrom), `dining_room` (Spisestue), `entrance` (Entré og vindfang), `hallway` (Gang og hall), `stairwell` (Trapperom), `wardrobe` (Garderobe), `storage` (Bod, inne), `external_storage` (Bod, ute, BRA-e), `basement_living_room` (Kjellerstue, under terreng), `basement_room` (Kjellerrom, uinnredet, under terreng), `crawl_space` (Kryperom, under terreng), `attic_living_room` (Loftstue), `unfinished_attic` (Loft, uinnredet), `garage` (Garasje, BRA-e), `glazed_balcony` (Innglasset balkong, BRA-b), `workshop` (Verksted), `other` (Annet)
     - Standard arealtype er `bra_i`, unntatt `external_storage` og `garage` (`bra_e`) og `glazed_balcony` (`bra_b`). Standard «under terreng» er sann bare for `basement_living_room`, `basement_room` og `crawl_space`.
   - Rene funksjoner med testsaker (A87): `suggestAreaType(roomType)` gir romtypens standard arealtype; `suggestBelowGround({ roomType, floorBelowGround })` er sann når etasjen er under terreng eller romtypen vanligvis er det; `sumFloorArea(area)` gir BRA = BRA-i + BRA-e + BRA-b (tomme felt teller som 0, én desimal); `sumBuildingArea(floors)` og `sumAssignmentArea(buildings)` summerer per arealtype og totalt.
6. **Skjema** i `src/core/buildings/schemas.ts` (Zod): `buildingInputSchema`, `floorInputSchema`, `floorAreaInputSchema`, `roomInputSchema`. Tekst trimmes, tom tekst blir `null`. Areal godtar komma og punktum, høyst én desimal, 0–9999,9. Fritekstfeltene (navn, kommentar) avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»), samme mønster som eiendommen. `measured_by` i skjemaet sjekkes i kjernen mot ansatte i `grant.organizationId`.
7. **Tjenester i `src/core/buildings`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`; foreldreraden låses med `FOR UPDATE` i skrivingene):
   - **Sortering, fast og testbar:** bygninger og rom på `created_at`, så `id` når to er like; etasjer på `level`, så `created_at`, så `id`.
   - `getAssignmentBuildings(actor, organizationId, assignmentId)`: `organization.read`. Gir bygningene med etasjer, areal per etasje (eller `null`), rom og summene fra punkt 5, sortert som over. Gir også `hasProperty` (om oppdraget har en aktiv eiendom, via `assignments.property_id`) og `employees` (aktive ansatte i `grant.organizationId`, id og navn, til «Målt av»). Er eiendommen myk-slettet etter at det finnes bygninger: `hasProperty` er `false`, bygningene vises fortsatt og kan endres og fjernes, men nye bygninger avvises.
   - `saveBuilding(actor, organizationId, assignmentId, buildingId | null, input)`: `assignment.edit`. Lager eller oppdaterer. En **ny** bygning krever aktiv eiendom på oppdraget, ellers `PropertyMissingError` («Legg inn eiendommen før du legger til bygninger.»).
   - `removeBuilding(...)`: `assignment.edit`. Myk sletting. Bare når bygningen ikke har aktive etasjer, ellers `BuildingNotEmptyError` («Fjern etasjene først.») (A88).
   - `saveFloor(actor, organizationId, buildingId, floorId | null, input)` og `removeFloor(...)`: `assignment.edit`. Fjerning bare når etasjen ikke har aktive rom, ellers `FloorNotEmptyError` («Fjern rommene først.»); arealraden myk-slettes sammen med etasjen.
   - `saveFloorArea(actor, organizationId, floorId, input)`: `assignment.edit`. Lager eller oppdaterer den ene raden. Regler for `measured_by`:
     - Er minst ett arealfelt fylt ut og «Målt av» tom, settes den innloggede ansatte.
     - Er alle arealfeltene tomme og «Målt av» tom, blir `measured_by` `null`.
     - En **ny** id (ulik den lagrede) må være en aktiv ansatt i `grant.organizationId`, ellers `AccessDeniedError`.
     - **Samme id som før** godtas selv om den ansatte er deaktivert siden, så en gammel rad kan lagres på nytt uten at «Målt av» må endres.
   - `saveRoom(actor, organizationId, floorId, roomId | null, input)` og `removeRoom(...)`: `assignment.edit`. Kommer `area_type` eller `below_ground` ikke med i input, brukes forslagene fra punkt 5.
   - **Hendelser og revisjonslogg** i samme transaksjon: `assignment.building_saved`, `assignment.building_removed`, `assignment.floor_saved`, `assignment.floor_removed`, `assignment.floor_area_saved`, `assignment.room_saved`, `assignment.room_removed`, alle med `data: { <id>, created }` (bare id-er og `created`). Revisjonslogg `report_building`, `floor`, `floor_area`, `room` med `create`/`update`/`delete`; `changes` har bare id-er, kodene og navnene på feltene som ble endret. **Aldri navn på bygning, etasje eller rom, kommentar eller arealtall** (raden er kilden). Ingen endring gir ingen hendelse, for alle fire typene.
8. **Skjermene** (PC først, må virke i iPad-størrelse):
   - **`/oppdrag/[id]`:** bare lenken «Bygninger, areal og rom» under «Fellesdeler». Ingen oppsummering der.
   - **`/oppdrag/[id]/bygninger`** (ny side): uten aktiv eiendom står «Legg inn eiendommen først.» og «Legg til bygning» vises ikke. Én blokk per bygning med navnet. Under hver bygning: etasjene i rekkefølge, hver med arealfeltene (BRA-i, BRA-e, BRA-b, ALH, «Målt av», «Metode», kommentar) og rommene (romtype, navn, arealtype, «Under terreng»). Sum BRA per etasje, per bygning og totalt vises og oppdateres etter lagring. Knappene «Legg til bygning», «Legg til etasje», «Legg til rom», «Lagre areal» og «Fjern». Romtypen er en nedtrekksliste gruppert etter gruppe; når den velges, settes arealtype og «Under terreng» til forslaget (kan endres før lagring). Etasjenavn er tekst med forslag («Kjeller», «Underetasje», «1. etasje», «2. etasje», «Loft»). Uten `canEditOrders` vises alt som tekst, uten «Legg til»-, «Lagre»- og «Fjern»-knapper.
   - Server actions i `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.ts`, samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som eiendommen (aldri skjemaverdier i loggen). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Kjente feil: `PropertyMissingError`, `BuildingNotEmptyError`, `FloorNotEmptyError`.
   - Feilmeldinger på norsk: «Skriv inn navnet på bygningen.», «Skriv inn navnet på etasjen.», «Etasjenummeret må være mellom −3 og 20.», «Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.», «Velg romtype.», «Fødselsnummer skal ikke lagres her.»
9. **Tester** (testskriver). Testdata er oppdiktet.
   - **Fabrikker:** `createBuilding`, `createFloor`, `createFloorArea`, `createRoom` i `tests/factories.ts` (tester i `factories.test.ts`); `RESET_TABLES` får alle fire tabellene; alle fire i `tests/tenant-tables.ts` med `src/core/buildings/buildings.test.ts`, slik at `tenant-isolation-all-tables` er grønn.
   - **Enhetstester (`codes.test.ts`):** kodene og etikettene i fast rekkefølge; hver romtype har gyldig gruppe og arealtype; `suggestAreaType` for `bathroom`, `garage`, `external_storage`, `glazed_balcony`; `suggestBelowGround` for alle fire kombinasjoner (romtype under terreng ja/nei × etasje under terreng ja/nei); `sumFloorArea` med tomme felt, desimaler (0,1 + 0,2 = 0,3, ingen flyttallsfeil) og ALH som ikke tas med i BRA; summene per bygning og oppdrag.
   - **Skjemaene (`schemas.test.ts`):** grensene for hvert felt (100/101, 50/51, 1000/1001 tegn; etasje −4, −3, 20, 21; areal −0,1, 0, 9999,9, 10000, to desimaler, komma og punktum), trimming, tom tekst blir `null`, ukjente koder, 11 sifre på rad. Alle feilmeldingene i punkt 8.
   - **Database (`src/db/buildings-schema.test.ts`):** databasen avviser ukjente koder, negativt areal, rader som peker på oppdrag, bygning, etasje eller ansatt i en annen organisasjon, og to aktive arealrader på samme etasje. En myk-slettet arealrad sperrer ikke for en ny.
   - **Tenant-isolasjon (regel 2):** `expectTenantIsolation` for alle åtte tjenestene i punkt 7. En egen test viser at `employees` og summene i `getAssignmentBuildings` aldri tar med ansatte eller rader fra organisasjon B. **IDOR:** A med egen org-id og Bs oppdrags-, bygnings-, etasje-, rom- eller ansatt-id (`measured_by`) gir `AccessDeniedError`, og Bs rader er uendret etterpå.
   - **Rettigheter:** matrise med alle fire rollene (takstmann, kontor, leder, admin) for lesing og for hver skrivetjeneste, kjørt med `access.inspectors_edit_all` på og av. Admin og leder kan alltid skrive (regel 11); takstmann får `AccessDeniedError` når innstillingen er av.
   - **Slettede id-er:** en myk-slettet bygning, etasje eller rom, og et slettet oppdrag, brukt som id gir `AccessDeniedError` i alle tjenestene som tar imot dem. Ett tilfelle der oppdraget er kansellert gjennom statustjenesten (A76, myk sletting), ikke bare med `deleted_at` satt for hånd: bygninger på et kansellert oppdrag kan verken leses eller endres.
   - **Myk sletting:** etter fjerning finnes raden fortsatt med `deleted_at` satt, og den vises ikke i `getAssignmentBuildings`. Fjerning av etasje myk-sletter arealraden.
   - **Oppførsel:** ny bygning uten eiendom gir `PropertyMissingError`; eiendom myk-slettet etter at bygninger finnes gir `hasProperty: false`, bygningene vises, ny bygning avvises; fjerning av bygning med etasjer og etasje med rom avvises; sorteringen i punkt 7 (også to rader med lik `created_at`); `measured_by`-reglene i punkt 7 (areal fylt ut uten «Målt av» gir den innloggede, alle felt tomme gir `null`, deaktivert ansatt godtas som samme id men ikke som ny id); rom uten arealtype og «under terreng» får forslagene; lagring uten endring gir ingen hendelse for alle fire typene.
   - **Hendelser og logg:** i samme transaksjon; hele JSON-en gjøres om til tekst, og navn, kommentar og arealtall står ikke der.
   - **Handlingene (`bygninger/actions.test.ts`):** id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen; når kjernen kaster `AccessDeniedError` (takstmann med `access.inspectors_edit_all` av), gir handlingen `NO_ACCESS` og ingenting lagres; de tre kjente feilene gir norsk melding; loggeren får aldri skjemaverdier.
   - **E2E i `pc` og `ipad`** (`e2e/fase-2a-bygninger-areal-rom.spec.ts`): oppdrag med eiendom → «Bygninger, areal og rom» → legg til «Bolighus» → legg til «Kjeller» (under terreng) og «1. etasje» → før areal på begge → legg til «Bad» i 1. etasje (arealtype BRA-i, ikke under terreng) og «Kjellerstue» i kjelleren (under terreng forhåndsvalgt) → sum BRA stemmer → last siden på nytt, verdiene står. Oppdrag uten eiendom viser «Legg inn eiendommen først.» Takstmann med `access.inspectors_edit_all` av ser alt som tekst og ingen «Legg til»- eller «Fjern»-knapper. I `ipad` er knappene minst 44 px høye.
10. **Dokumenter:** domenemodellen 4.4 får «Bygget i fase 2a» for bygninger, etasjer, areal og rom (hva som er med, hva som venter), ordlisten får de nye ordene, planpunktet krysses av, beslutningene A84–A88 føres i `docs/09-apne-sporsmal.md`. Versjon → 0.2.83 (main står på 0.2.82).

**Ikke med (bevisst utelatt):**
- Oppslag av bygninger, byggeår eller areal fra matrikkelen, Eiendomsverdi eller andre (koster penger og krever konto). Bare for hånd på PC.
- iPad uten nett, plantegning, romskisse (`geometry`), LiDAR-måling (`lidar`, krok K7) og fuktkart.
- Kopiering fra en tidligere rapport (`copied_from_id`), og `report_id` (kommer når rapporten bygges, A84).
- Tilbygg og modernisering (`extensions`), bygningsnummer i matrikkelen (`building_number`), undertype, anvendelse, standard, vedlikehold og bilde av bygningen.
- Areal oppgitt av eier eller annen kilde til sammenligning (`other_source_value`), og areal per rom.
- Romtyper som tabell som Byggcon redigerer selv (`room_types`). Listen er kode nå (A85); tabellen kommer med maleditoren.
- Kontrollpunkter per bygning og rom, regler som bruker romgruppe eller «under terreng», og hulltakingskrav (egne planpunkter).
- Arealtabellen i PDF-en og fast forklaring om areal (kommer med PDF-en).
- Dra og slipp for rekkefølge; rekkefølgen er `level` for etasjer og opprettelsesrekkefølge for bygninger og rom.
- Lovlighet og brannceller per bygning.
- Nye avhengigheter, ny rettighet.
- Kuttet etter gjennomgangen (forenkleren): TBA (kommer som valgfri kolonne med arealtabellen i PDF-en); «Vanskelig å måle» (skrives i kommentaren); byggeår og kilde for byggeåret (kommer med regelmotoren, «TG-forslag fra alder»); bygningstype (kommer med betingelsestypen «bygningstype» i regelmotoren); hovedbygg (`is_main`); `property_id` på bygningen; `sort_order`; oppsummering av areal på oppdragssiden.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ja, alle oppdrag (`organization.read`) | Når `access.inspectors_edit_all` er på (`assignment.edit`); ellers ikke (A20) |
| kontor | Ja | Ja (`assignment.edit`) |
| leder | Ja | Ja |
| admin | Ja | Ja (admin stenges aldri ute) |

Ingen endring i `src/core/access`.

## Data
- Nye tabeller `report_buildings`, `floors`, `floor_areas` og `rooms` (migrering `0018`), alle med `organization_id`, myk sletting og sammensatte fremmednøkler. `report_buildings` har `assignment_id` til rapportene finnes (A84).
- Nye faste koder: `area_type` (tre), `method` (tre), romgrupper (fem) og romtyper (33, utkast). Ingen kode endres senere, bare arkiveres (regel 6).
- Hendelser og revisjonslogg som i punkt 7. Ingen navn, kommentar eller arealtall i hendelser eller logg.
- Oppdater `docs/05-domenemodell.md` 4.4 og ordlisten (`report_building`, `floor`, `floor_area`, `room`, `room_type`, `room_type_group`, `area_type`, `bra_i`, `bra_e`, `bra_b`, `alh`, `measured_by`, `measuring_method`, `below_ground`).

## Skjermer
- **PC og iPad.** Én ny side og én lenke på oppdraget.
- Hovedhandling: legg til bygning (navn → «Lagre», 2 trykk) → legg til etasje (navn, nivå, under terreng → «Lagre») → før areal (fire tall, metode → «Lagre areal»; «Målt av» er forhåndsvalgt) → legg til rom (velg romtype → «Lagre», 2 trykk når forslagene stemmer). I IVIT må arealtype og romnummer fylles ut per rom; her er de forhåndsvalgt.
- iPad-størrelse: én kolonne, knapper minst 44 px. På PC kan arealfeltene stå på én linje.

## Regler
Ingen fagregler. Dataregler med testsaker: `suggestAreaType`, `suggestBelowGround`, summene (punkt 5 og 9). Hvilke kontrollpunkter romgruppe og «under terreng» slår på, kommer med regelmotoren.

## Akseptkriterier
- [ ] Takstmann (med `access.inspectors_edit_all` på) og kontor kan legge til, endre og fjerne bygninger, etasjer og rom, og føre areal per etasje, på et oppdrag med eiendom.
- [ ] Arealet per etasje har BRA-i, BRA-e, BRA-b og ALH, hvem som målte (forhåndsvalgt innlogget), metode og kommentar. Sum BRA vises per etasje, bygning og oppdrag på bygningssiden.
- [ ] Rom har romtype fra den faste listen; arealtype og «under terreng» foreslås og kan endres.
- [ ] Oppdragssiden har lenken «Bygninger, areal og rom».
- [ ] Bygning med etasjer og etasje med rom kan ikke fjernes; fjerning er myk sletting.
- [ ] Uten eiendom kan det ikke legges til bygninger, og bygningssiden sier «Legg inn eiendommen først.»
- [ ] Hendelser og revisjonslogg skrives i samme transaksjon og inneholder aldri navn, kommentar eller arealtall.
- [ ] Med `access.inspectors_edit_all` av får takstmann ikke endret (test i kjernen), og siden viser alt som tekst uten knapper.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for alle tjenestene; fire tabeller i `tests/tenant-tables.ts`). Fremmed id i egen organisasjon og «Målt av» fra en annen organisasjon avvises uten endring.
- [ ] Virker på iPad-størrelse (e2e i `pc` og `ipad`, knapper minst 44 px).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A84–A88)
Numrene er A84–A88 og migreringen `0018` (sjekket 05.11.2026): `origin/main` (`246b2d4`) har A74–A77 (statusflyten, PR #93, merget), A78 («Fakturert») og A79–A83 (kontakter og firma, PR #95), og migreringen `0017_kontakter-og-firma.sql`. `origin/fase2a-statusflyt` er merget i `main` og har ingen nye numre. Branchen er laget fra `92aa6a4` og mangler PR #93–#96; derfor flettes `origin/main` inn før sluttrunden, og der gjøres omnummereringen (se «Avgjørelser etter gjennomgangen, runde 2»). Kommer nye numre på `main` før merge, sjekkes det på nytt.
- **A84:** Bygninger, etasjer, areal og rom lagres **per oppdrag** (`report_buildings.assignment_id`) til rapportene finnes; da får tabellen `report_id`. Tabellen heter `report_buildings` allerede nå, så kontrollpunktsvarene senere kan peke på `report_building_id` uten omdøping. Eiendommen finnes via oppdraget (`assignments.property_id`), ikke som egen kolonne. I betaen har hvert oppdrag én rapport. Kilde: domenemodellen 4.4 («hører til den enkelte rapporten»), A71 (samme løsning for fellesdeler). Endres ved å legge til `report_id` når rapporten bygges.
- **A85:** **Romtypene er en fast kodeliste i koden** med 33 typer, gruppe, standard arealtype og standard «under terreng», merket «utkast, ikke godkjent av fagrådet». Listen er Byggcons egen og kortere enn IVITs 55; like rom er slått sammen (for eksempel stue, TV-stue og peisstue til «Stue»). Etter forslaget i kravdokumentet gir «Annet rom med sluk» våtromsgruppen, og «Teknisk rom» og «Svømmebasseng» er spesialrom (NS 3600 A.2.8, og basseng skal ha TGIU). Kilde: `kravdokument.md` 2.6 b), sidemannskontrollen P7, domenemodellen 4.4. Endres ved å legge til nye koder (aldri endre en kode); listen blir tabell (`room_types`) når maleditoren kommer.
- **A86:** **Arealet føres per etasje** med BRA-i, BRA-e, BRA-b og ALH i m² med én desimal, én rad per etasje. BRA er summen av BRA-i, BRA-e og BRA-b; ALH vises, men tas ikke med i BRA. TBA kommer som valgfri kolonne med arealtabellen i PDF-en. Metodene er laser, tegning og annen kilde; LiDAR legges til som ny kode senere (K7). «Målt av» settes til den innloggede når areal føres uten måler; en tidligere lagret måler godtas selv om personen er deaktivert. Kommentaren er med fordi areal er en vanlig reklamasjonsgrunn; der skrives også om noe var vanskelig å måle. Kilde: forskriften § 2-20, domenemodellen 4.4, IVIT-analysen 27.10.2026 (arealtabell per etasje med TBA), sidemannskontrollen 25.10.2026. Endres i `sumFloorArea` og kodelisten.
- **A87:** **Forslag til arealtype og «under terreng» for rom:** arealtypen kommer fra romtypen; «under terreng» er sant når etasjen er under terreng eller romtypen vanligvis er det. Takstmannen kan endre begge. Hellere ett forslag for mye om «under terreng» enn ett for lite, fordi det styrer kravet om hulltaking (§ 2-15). Kilde: domenemodellen 4.4 (`below_ground`: «forslag fra romtype og etasje»), sidemannskontrollen P7. Endres i `suggestBelowGround` med testsakene.
- **A88:** **Bygning og etasje kan bare fjernes når de er tomme** (ingen aktive etasjer eller rom). Fjerning er myk sletting. Det enkleste som virker, og ingen mister rom ved et feiltrykk. Hovedbygg, byggeår og bygningstype venter til regelmotoren trenger dem. Kilde: regel 3 (ingenting slettes permanent). Endres ved å tillate fjerning med alt under.

## Roller
- **utvikler:** migrering og skjema, koder, `schemas.ts`, tjenestene i `src/core/buildings`, siden og handlingene, lenken på oppdraget, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): punkt 9.
- **sikkerhet-personvern:** gjennomgang før PR: fire nye tabeller med `organization_id` og sammensatte fremmednøkler, `measured_by` mot ansatte i samme organisasjon, at navn og kommentar ikke havner i hendelser, revisjonslogg eller applikasjonslogg, og at ingen id fra skjemaet brukes til filtrering uten å gå via `grant.organizationId`.
- **fagansvarlig** (kort sjekk, ingen avvikstekster): romtypelisten med grupper og standardverdier (A85), arealreglene (A86) og forslaget om «under terreng» (A87).

Ikke med: arkitekt (ingen ny ADR, følger domenemodellen og A71), ux-ansvarlig og ui-designer (siden følger mønsteret fra eiendom, team og parter i rammen Fjord), KI.

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/report-buildings.ts`, `floors.ts`, `floor-areas.ts`, `rooms.ts` (+ `index.ts`, migrering `0018`), `src/core/buildings/*` (ikke `*.test.ts`), `src/app/(ansatt)/oppdrag/[id]/bygninger/*` (ikke `*.test.ts`), lenken i `src/app/(ansatt)/oppdrag/[id]/page.tsx`, `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/buildings/buildings.test.ts`, `src/core/buildings/codes.test.ts`, `src/core/buildings/schemas.test.ts`, `src/db/buildings-schema.test.ts`, `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.test.ts`, `e2e/fase-2a-bygninger-areal-rom.spec.ts`.
   Testskriveren skriver mot signaturene i dette kortet. Avviker utvikleren, står det under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.

## Avgjørelser etter gjennomgangen (prosjektleder 05.11.2026)
- **Forenkleren får medhold i alle åtte punktene.** Planpunktet nevner bygninger, etasjer, BRA-i, BRA-e, BRA-b, ALH, måler, metode, rom, romtype og «under terreng», ikke mer. TBA, «vanskelig å måle», byggeår, bygningstype, hovedbygg, `sort_order`, `property_id` og oppsummeringen på oppdraget gir mer kode og flere tester uten at noe akseptkriterium trenger dem nå. Byggeår og bygningstype hører til regelmotoren og legges til der, som nye kolonner (ingen kode endres). «Vanskelig å måle» kan skrives i kommentaren, så sporbarheten ved reklamasjon er beholdt. Beslutningen om byggeår er tatt ut, og A88 (fjerning bare når tom) er forenklet.
- **Test-lederens fire presiseringer er tatt inn** i punkt 7: `measured_by` når alle arealfelt er tomme (`null`) og når måleren er deaktivert (samme id godtas, ny id må være aktiv); sortering på `created_at` og så `id`; eiendom myk-slettet etter at bygninger finnes. Punktet om hovedbygg og `sort_order` faller bort med forenklingen.
- **Testplanen** har fått rollematrisen, tenant-testen for `employees` og summene, IDOR med ansatt-id, slettede id-er, myk sletting, ingen arealtall i logg, «ingen endring» for alle fire typene, visning uten skriverett og 44 px på iPad. Testen om `property_id` fra input og om myk-slettet hovedbygg faller bort fordi feltene er tatt ut.

## Avgjørelser etter gjennomgangen, runde 2 (prosjektleder 05.11.2026)
- **Forenkleren:** alle åtte punktene var allerede tatt inn i runde 1 (se over). Kortet har ingen TBA, «vanskelig å måle», byggeår, bygningstype, hovedbygg, `property_id`, `sort_order` eller oppsummering på oppdraget. Ingen ny endring.
- **Test-lederen får medhold i alle seks punktene:**
  1. Migreringen blir `0018_bygninger-areal-rom.sql`. Journalen i `src/db/migrations/meta` lages på nytt med `pnpm db:generate` etter at `origin/main` er flettet inn, ikke rettet for hånd.
  2. Beslutningene flyttes A78→A84, A79→A85, A80→A86, A81→A87, A82→A88, i kortet, `docs/09-apne-sporsmal.md`, `docs/05-domenemodell.md` og kodekommentarer. Main sine A78–A83 beholdes uendret.
  3. Versjonen blir 0.2.83.
  4. `origin/main` flettes inn før testene kjøres. `tests/factories.ts`, `RESET_TABLES` og `tests/tenant-tables.ts` får både kontakt- og firmatabellene fra main og de fire nye tabellene.
  5. Testen for slettet oppdrag får et tilfelle med kansellering gjennom statustjenesten (punkt 9).
  6. Handlingstesten viser at `AccessDeniedError` fra kjernen gir `NO_ACCESS` (punkt 9). Den dekker hullet hvis knappen likevel skulle vises.
- **Rekkefølge:** utvikleren fletter `origin/main`, renummererer og lager journalen; testskriveren legger til de to testene; test-lederen kjører lint, typecheck, test og test:e2e i sluttrunden.

## Åpne spørsmål
- Ingen som stopper oppgaven. Romtypelisten og arealreglene er utkast som fagrådet (Ståle) godkjenner før ekte bruk (A85, A86).
