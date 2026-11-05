# Testplan: Bygninger, etasjer, areal per etasje og rom

- **Oppgavekort:** `docs/funksjoner/fase2a-bygninger-areal-rom.md`
- **Dato:** 05.11.2026 (test-leder, før bygging; oppdatert etter runde 2: migrering `0019`, A94–A98, versjon 0.2.83, fletting med `origin/main`)
- **Støtter hovedmål:** tid (testene låser at arealtype og «under terreng» foreslås fra romtype og etasje, at «Målt av» settes til den innloggede, og at BRA summeres riktig, så takstmannen slipper å regne og skrive det samme flere ganger), reklamasjoner (måler, metode og kommentar per etasje er sporbare; summene har testsaker uten flyttallsfeil; kodene er låst i skjema og database) og KI først (strukturen bygning → etasje → areal og rom med faste koder er den samme som et senere forslag fra plantegning eller LiDAR kan fylle ut; testene viser at navn, kommentar og arealtall aldri havner i hendelser eller logg).

Alle Vitest-tester mot databasen går mot `TEST_DATABASE_URL` med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: bygninger «Bolighus» og «Garasje test», etasjer «Kjeller» og «1. etasje», rom med navn «Rom test», kommentar «Målt langs innvendig vegg test». Arealtall velges slik at de ikke kolliderer med id-er eller tidsstempler: `123.4`, `56.7`, `8.9`, `210.3`. «Fødselsnummer» er alltid `12345678901` (oppdiktet). Fast tid: `TEST_NOW`.

Ingen del av oppgaven virker uten nett (føres for hånd på PC), så det trengs ingen e2e uten nett. Ingen fagregler; regeltestene er datareglene `suggestAreaType`, `suggestBelowGround` og summene som testsaker (avsnitt 1).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1–8. Avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- `src/core/buildings/codes.ts`: `AREA_TYPES`, `MEASURING_METHODS`, `ROOM_TYPE_GROUPS`, `ROOM_TYPES` (33 rader med `key`, `label`, `group`, `defaultAreaType`, `defaultBelowGround`, `draft: true`), etikettfunksjoner (ukjent kode gir koden tilbake), `suggestAreaType(roomType)`, `suggestBelowGround({ roomType, floorBelowGround })`, `sumFloorArea(area)`, `sumBuildingArea(floors)`, `sumAssignmentArea(buildings)`. Summene gir `{ braI, braE, braB, bra }` med én desimal (ALH er ikke med i `bra`).
- `src/core/buildings/schemas.ts`: `buildingInputSchema` (`name`), `floorInputSchema` (`name`, `level`, `belowGround`), `floorAreaInputSchema` (`braI`, `braE`, `braB`, `alh`, `measuredBy`, `method`, `comment`), `roomInputSchema` (`roomType`, `name`, `areaType?`, `belowGround?`).
- `src/core/buildings/errors.ts`: `PropertyMissingError`, `BuildingNotEmptyError`, `FloorNotEmptyError` med tekstene i kortet.
- Tjenester fra `@/core/buildings`: `getAssignmentBuildings`, `saveBuilding`, `removeBuilding`, `saveFloor`, `removeFloor`, `saveFloorArea`, `saveRoom`, `removeRoom` med signaturene i kortet punkt 7.
- Fabrikker: `createBuilding(organizationId, { assignmentId?, name?, deletedAt? })` lager oppdrag med eiendom når `assignmentId` mangler; `createFloor(organizationId, { buildingId?, name?, level?, belowGround?, deletedAt? })`; `createFloorArea(organizationId, { floorId?, braI?, braE?, braB?, alh?, measuredBy?, method?, comment?, deletedAt? })`; `createRoom(organizationId, { floorId?, roomType?, name?, areaType?, belowGround?, deletedAt? })`. Mangler forelderen, lages den i samme organisasjon.

## 1. Faste koder og regeltester, `src/core/buildings/codes.test.ts` (ny, ren enhetstest)

1. **`AREA_TYPES` er låst:** nøyaktig `bra_i`, `bra_e`, `bra_b` i fast rekkefølge, med etikettene BRA-i, BRA-e, BRA-b. (Regel 6: koder endres aldri.)
2. **`MEASURING_METHODS` er låst:** `laser`, `drawing`, `other`; `lidar` finnes ikke ennå (K7).
3. **`ROOM_TYPE_GROUPS` er låst:** `wet_room`, `kitchen`, `toilet`, `special`, `other`.
4. **`ROOM_TYPES` er låst:** nøyaktig de 33 kodene i kortets rekkefølge, med etiketter; ingen dubletter; alle har `draft: true`.
5. **gyldige felt per romtype** (`it.each` over `ROOM_TYPES`): `group` finnes i `ROOM_TYPE_GROUPS`, `defaultAreaType` i `AREA_TYPES`, `defaultBelowGround` er boolsk.
6. **grupper som testsaker:** de fem våtrommene (inkludert `room_with_drain`) har `wet_room`; `kitchen` og `living_kitchen` har `kitchen`; `toilet` har `toilet`; `sauna`, `boiler_room`, `technical_room`, `cold_room`, `swimming_pool` har `special`; resten `other`.
7. **`suggestAreaType`:** `bathroom` → `bra_i`, `garage` → `bra_e`, `external_storage` → `bra_e`, `glazed_balcony` → `bra_b`; og en `it.each` som viser at alle andre 29 gir `bra_i`.
8. **`suggestBelowGround`, fire kombinasjoner (A97):**
   | romtype | etasje under terreng | forslag |
   |---|---|---|
   | `basement_living_room` | ja | ja |
   | `basement_living_room` | nei | ja |
   | `bathroom` | ja | ja |
   | `bathroom` | nei | nei |
   Pluss `it.each` over alle romtyper med etasje over terreng: sann bare for `basement_living_room`, `basement_room`, `crawl_space`.
9. **`sumFloorArea`:** alle tomme → 0; bare BRA-i → BRA = BRA-i; `0.1 + 0.2` (BRA-i, BRA-e) → `0.3` nøyaktig; `123.4 + 56.7 + 8.9` → `189.0`; ALH `210.3` endrer ikke BRA; resultatet har aldri mer enn én desimal.
10. **`sumBuildingArea` og `sumAssignmentArea`:** to etasjer, én uten areal (`null`) → summen per arealtype og totalt; to bygninger → totalen er summen av bygningene; tom liste → 0.
11. **alle koder er dekket:** testsakene i 1.6 og 1.7 har like mange rader som `ROOM_TYPES` (ny kode uten testsak gjør testen rød).

## 2. Skjemaene, `src/core/buildings/schemas.test.ts` (ny, ren enhetstest)

1. **bygningsnavn:** tomt og bare mellomrom → «Skriv inn navnet på bygningen.»; 100 ok, 101 avvist; trimmes.
2. **etasjenavn:** tomt → «Skriv inn navnet på etasjen.»; 50 ok, 51 avvist; trimmes.
3. **etasjenummer:** −4 og 21 → «Etasjenummeret må være mellom −3 og 20.»; −3, 0 og 20 ok; `1.5` og `"a"` avvist.
4. **`belowGround`** på etasje: mangler → `false`; `"on"`/`true` → `true`.
5. **areal** (`it.each` over `braI`, `braE`, `braB`, `alh`): tom → `null`; `-0.1`, `10000`, `12.34`, `abc` → «Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.»; `0`, `9999.9`, `9999,9`, `12,3`, `12.3` ok og gir tall.
6. **metode:** tom → `null`; `laser`, `drawing`, `other` ok; `lidar` og `ukjent` avvist.
7. **kommentar:** valgfri; 1000 ok, 1001 avvist; trimmes; tom → `null`.
8. **`measuredBy`:** tom → `null`; uuid ok; `ikke-en-id` avvist.
9. **romtype:** mangler, tom, `villa` → «Velg romtype.»; alle 33 koder godtas (`it.each`).
10. **romnavn:** valgfritt; 100 ok, 101 avvist; tomt → `null`.
11. **arealtype på rom:** mangler → `undefined` (kjernen bruker forslaget); `bra_i`, `bra_e`, `bra_b` ok; `alh` og ukjent avvist.
12. **fødselsnummer** (`it.each` over bygningsnavn, etasjenavn, kommentar, romnavn): `12345678901` og `Bolighus 12345678901` → «Fødselsnummer skal ikke lagres her.»; 10 sifre godtas.
13. **`organizationId`, `id`, `assignmentId`, `floorId` i input** blir aldri med i resultatet.
14. **alle norske meldinger i kortet punkt 8 er brukt** i testene over (en samletest).

## 3. Databasen, `src/db/buildings-schema.test.ts` (ny, direkte innsetting)

1. **CHECK:** `rooms.room_type = "villa"`, `rooms.area_type = "alh"`, `floor_areas.method = "lidar"` avvises.
2. **negativt areal:** `bra_i = -0.1` (og hver av de fire kolonnene) avvises.
3. **`floors.level`:** −4 og 21 avvises (hvis CHECK finnes i databasen; ellers dekket av 2.3 og noteres).
4. **sammensatte fremmednøkler** (rad i A som peker på B): bygning → oppdrag i B, etasje → bygning i B, areal → etasje i B, rom → etasje i B, `measured_by` → ansatt i B. Alle avvises.
5. **én aktiv arealrad per etasje:** to aktive → unik-feil; én myk-slettet og én aktiv godtas.
6. **påkrevde felt:** `assignment_id`, `name` (bygning og etasje), `level`, `below_ground`, `floor_id`, `room_type`, `area_type` er `NOT NULL`; `below_ground` på etasje får standard `false`.
7. **tenant-tabeller:** `report_buildings`, `floors`, `floor_areas`, `rooms` står i `tests/tenant-tables.ts` med radbyggere og testfilen `src/core/buildings/buildings.test.ts`, **sammen med** `contacts` og `firms` fra `origin/main` (PR #95); `tests/tenant-isolation-all-tables.test.ts` er grønn etter flettingen.
8. **migreringen er ren:** filen heter `0019_bygninger-areal-rom.sql` og kommer etter `0017_kontakter-og-firma` fra `origin/main`; journalen i `src/db/migrations/meta` er laget med `pnpm db:generate` etter flettingen (ikke rettet for hånd); `pnpm db:generate` etterpå lager ingen ny fil; `pnpm db:migrate` mot en tom testdatabase går gjennom alle 19 migreringene. Sjekkes på nytt mot `origin/main` rett før merge.

## 4. Kjernen, `src/core/buildings/buildings.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres med `access.inspectors_edit_all` **på** og **av**.

1. **lese** (`getAssignmentBuildings`): `inspector`, `office`, `manager`, `admin` lykkes i begge.
2. **skrive** (alle sju skrivetjenestene): med innstillingen på lykkes alle fire roller. Med innstillingen av lykkes `office`, `manager`, `admin`; `inspector` får `AccessDeniedError`, og antall rader i de fire tabellene, `events` og `audit_log` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` kan skrive.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt:** `AccessDeniedError` på lesing og én skrivetjeneste.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av, kan lese og bruke alle sju skrivetjenestene.

### 4.2 Tenant-isolasjon (regel 2; åtte kall til `expectTenantIsolation`, ett per tjeneste)

1. **`getAssignmentBuildings`:** `seed` lager oppdrag med eiendom, bygning, etasje, areal og rom i A og B; `query` gir bygningene; `idOf = id`.
2. **`saveBuilding`, `saveFloor`, `saveFloorArea`, `saveRoom`:** `seed` lager forelderen i A og B; `query` lagrer i egen organisasjon og returnerer `[{ id }]`. Etterpå er Bs rader urørt, og alle nye rader, hendelser og loggrader for A har `organization_id = A`.
3. **`removeBuilding`, `removeFloor`, `removeRoom`:** `seed` lager en tom rad i A og B; `query` fjerner i egen organisasjon og returnerer `[{ id }]`. Bs rad har `deleted_at = null` etterpå.
4. **`employees` og summene i `getAssignmentBuildings`:** B har flere ansatte og bygninger med store arealtall; As `employees` har bare As ansatte (id og navn), og As summer er de samme som om B ikke fantes.

### 4.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id`:

1. **Bs oppdrags-id** i `getAssignmentBuildings` og `saveBuilding` → `AccessDeniedError`.
2. **Bs bygnings-id** i `saveBuilding` (som `buildingId`), `removeBuilding` og `saveFloor` → `AccessDeniedError`.
3. **Bs etasje-id** i `saveFloor`, `removeFloor`, `saveFloorArea`, `saveRoom` → `AccessDeniedError`.
4. **Bs rom-id** i `saveRoom` og `removeRoom` → `AccessDeniedError`.
5. **Bs ansatt-id som `measuredBy`** i `saveFloorArea` → `AccessDeniedError`.
6. **bygning fra et annet oppdrag i A** som `buildingId` sammen med oppdrag X i `saveBuilding` → `AccessDeniedError` (id-en må høre til oppdraget i adressen).
7. Etter hver av 1–6: Bs rader har samme verdier og `updated_at`, og ingen ny rad, hendelse eller loggrad finnes.
8. **tilfeldig uuid og `"ikke-en-id"`** som id i hver tjeneste → `AccessDeniedError`, aldri databasefeil.

### 4.4 Slettede id-er og myk sletting

1. **slettet oppdrag** (`deleted_at` satt i fabrikken) → `AccessDeniedError` i `getAssignmentBuildings` og `saveBuilding`.
1b. **kansellert gjennom statustjenesten** (A76): oppdrag med eiendom, bygning, etasje, areal og rom; `cancelAssignment` fra `@/core/assignments` kjøres som admin; deretter gir `getAssignmentBuildings`, `saveBuilding` (ny og eksisterende), `saveFloor`, `saveFloorArea`, `saveRoom` og `removeRoom` `AccessDeniedError`, og radene i de fire tabellene er uendret (samme `updated_at`, `deleted_at` fortsatt `null`).
2. **myk-slettet bygning, etasje eller rom** brukt som id → `AccessDeniedError` i alle tjenestene som tar imot dem (`it.each`).
3. **fjerning er myk:** etter `removeBuilding`, `removeFloor`, `removeRoom` finnes raden med `deleted_at` og `deleted_by` satt, og den vises ikke i `getAssignmentBuildings`.
4. **fjerning av etasje** myk-sletter arealraden; ingen rad slettes permanent (antall rader i tabellene er uendret).
5. **myk-slettet arealrad** vises ikke (`area = null`), og `saveFloorArea` lager ny rad.

### 4.5 Oppførsel

1. **ny bygning uten eiendom** → `PropertyMissingError`, ingen rad.
2. **eiendom myk-slettet etter at bygninger finnes:** `hasProperty = false`, bygningene vises, eksisterende bygning kan endres og fjernes, ny bygning gir `PropertyMissingError`.
3. **bygning med aktiv etasje** → `BuildingNotEmptyError`; **etasje med aktivt rom** → `FloorNotEmptyError`; med bare myk-slettede barn går fjerningen gjennom.
4. **sortering:** bygninger og rom på `created_at`, så `id` (to rader med lik `created_at`, satt direkte); etasjer på `level` (−1, 0, 1), så `created_at`, så `id`.
5. **`measured_by`-reglene:** areal fylt ut uten «Målt av» → den innloggede; alle felt tomme og «Målt av» tom → `null`; ny aktiv ansatt i A → lagres; deaktivert ansatt som ny id → `AccessDeniedError`; deaktivert ansatt som samme id som før → godtas.
6. **rom uten arealtype og «under terreng»** får forslagene (`garage` → `bra_e`; `bathroom` i etasje under terreng → `true`); oppgitte verdier vinner over forslaget.
7. **ingen endring:** lagring av samme verdier gir ingen hendelse, ingen loggrad og samme `updated_at`, for bygning, etasje, areal og rom.
8. **`getAssignmentBuildings` har faste felt:** ingen `deletedAt`, `rowVersion`, `organizationId`; summene stemmer med `sumAssignmentArea`.
9. **valideringsfeil** gir `ZodError`, ingen rad, ingen hendelse.

### 4.6 Hendelser og revisjonslogg

1. **hendelsene** `assignment.building_saved`, `…building_removed`, `…floor_saved`, `…floor_removed`, `…floor_area_saved`, `…room_saved`, `…room_removed` med `data = { <id>, created }`, og `created` er `true` første gang og `false` ved endring.
2. **revisjonslogg** `report_building`, `floor`, `floor_area`, `room` med `create`, `update`, `delete`; `changes` har bare id-er, koder og feltnavn.
3. **ingen navn, kommentar eller arealtall:** for alle sju skrivetjenestene gjøres hele `events.data` og `audit_log.changes` om til tekst med `JSON.stringify`, og «Bolighus», «Kjeller», «Rom test», «Målt langs innvendig vegg», `123.4`, `56.7`, `8.9` og `210.3` står ikke der.
4. **ingen hendelse** ved avvist tilgang, valideringsfeil eller de tre kjente feilene.
5. **samme transaksjon** (`src/core/buildings/buildings-transaction.test.ts`, `vi.mock` av hendelser eller logg som kaster én gang): `saveBuilding`, `saveFloorArea` og `removeFloor` kaster → ingen ny rad og ingen myk sletting står igjen.

## 5. Fabrikker, `tests/factories.test.ts` (utvides)

1. **`createBuilding`, `createFloor`, `createFloorArea`, `createRoom`** uten overstyring lager gyldige rader med foreldre i samme organisasjon; overstyring brukes.
2. **`RESET_TABLES`** inneholder de fire tabellene i rekkefølge som tåler fremmednøklene.

## 6. Handlingene, `src/app/(ansatt)/oppdrag/[id]/bygninger/actions.test.ts` (ny, kjernen byttet ut)

1. **ingen ansattkontekst** → `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** (oppdrag, bygning, etasje, rom) → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` endrer ikke kallet.
4. **`AccessDeniedError`** → `NO_ACCESS`. Egen test: takstmann med `access.inspectors_edit_all` av, kjernen kaster `AccessDeniedError` for hver av de sju skrivehandlingene → `NO_ACCESS`, og ingenting lagres (ingen `revalidatePath`, ingen ny rad når testen går mot ekte kjerne, eller kjernen kalt én gang og kastet). Dekker hullet hvis en knapp likevel skulle vises.
   Videre: `PropertyMissingError`, `BuildingNotEmptyError`, `FloorNotEmptyError` → norsk melding; `ZodError` → feil ved feltet; ukjent feil → `UNKNOWN_ERROR`.
5. **loggkontrakt:** `JSON.stringify` av alle loggkall inneholder ikke navn, kommentar eller arealtall.

## 7. E2E, `e2e/fase-2a-bygninger-areal-rom.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egen ordre, oppdrag og eiendom med `uniqueSuffix()`.

1. **hovedflyt:** oppdrag med eiendom → lenken «Bygninger, areal og rom» → «Legg til bygning» «Bolighus» → etasjene «Kjeller» (nivå −1, under terreng) og «1. etasje» (nivå 1) → areal på begge (`56,7` og `123,4`, metode «Oppmålt med laser»; «Målt av» er forhåndsvalgt med admin) → rom «Bad» i 1. etasje (arealtype BRA-i, «Under terreng» ikke valgt) og «Kjellerstue» i kjelleren («Under terreng» forhåndsvalgt) → sum BRA per etasje, bygning og totalt er `180,1` → last siden på nytt → alle verdier står.
2. **etasjene i rekkefølge:** «Kjeller» står over «1. etasje» selv om den ble lagt til sist.
3. **forslaget kan endres:** velg «Garasje» → arealtype BRA-e forhåndsvalgt; bytt til BRA-i før lagring → BRA-i lagres.
4. **fjerning:** «Fjern» på etasje med rom gir «Fjern rommene først.»; fjern rommet, så etasjen → borte fra siden.
5. **uten eiendom:** siden viser «Legg inn eiendommen først.» og ingen «Legg til bygning».
6. **feilmelding ved feltet:** areal `12,34` → «Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.»; ingenting lagres.
7. **uten skriverett:** innstillingen `access.inspectors_edit_all` settes av i databasen for testen (og settes tilbake i `finally`; Playwright kjører med én arbeider); `logInAsInspector` ser bygning, etasjer, areal og rom som tekst, og ingen «Legg til»-, «Lagre»- eller «Fjern»-knapper.
8. **ukjent id** i adressen gir «Fant ikke siden» eller «Ingen tilgang», aldri 500.
9. **iPad-størrelse** (prosjektet `ipad`, stående): ingen vannrett rulling, én kolonne, alle knapper og nedtrekkslister minst 44 px høye.
10. **tastaturet alene:** bygning og rom kan legges til med Tab, piltaster og Enter; feltene har synlige etiketter (`getByLabel`).

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- Alle åtte `expectTenantIsolation`-kall (4.2.1–4.2.3), testen for `employees` og summene (4.2.4) og IDOR inkludert ansatt-id (4.3).
- Rettighetsmatrisen med innstillingen på og av, og admin-testen 4.1.5.
- Myk sletting og slettede id-er (4.4), og at fjerning av ikke-tomme rader avvises (4.5.3).
- Personverntesten 4.6.3 og loggkontrakten 6.5.
- Alle fire tabellene i `tests/tenant-tables.ts` og fremmednøkkeltestene 3.4.
- Regeltestene dekker alle romtyper (1.5–1.8, 1.11), og 0,1 + 0,2 = 0,3.
- Ingen tilgangslogikk i siden eller handlingene utover `NO_ACCESS`; ingen id fra skjemaet brukes til filtrering uten `grant.organizationId`.
- `origin/main` er flettet inn før sluttrunden; `tests/factories.ts`, `RESET_TABLES` og `tests/tenant-tables.ts` har både `contacts`/`firms` og de fire nye tabellene.
- Kanselleringstesten 4.4.1b og handlingstesten med `AccessDeniedError` (6.4).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjonen er 0.2.84 (main 0.2.83); migreringen er `0019`; beslutningene er A94–A98 overalt (kortet, `docs/09-apne-sporsmal.md`, `docs/05-domenemodell.md`, kodekommentarer) og main sine A78–A83 er uendret. Sjekkes mot `origin/main` og `origin/fase2a-statusflyt` rett før merge.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Takstmann (innstilling på) og kontor legger til, endrer og fjerner; areal per etasje | 4.1.2, 4.5, 7.1, 7.4 |
| BRA-i, BRA-e, BRA-b, ALH, måler, metode, kommentar; sum per etasje, bygning, oppdrag | 1.9–1.10, 2.5–2.8, 4.5.5, 4.5.8, 7.1 |
| Romtype fra fast liste; forslag som kan endres | 1.4–1.8, 2.9, 2.11, 3.1, 4.5.6, 7.1, 7.3 |
| Lenken «Bygninger, areal og rom» | 7.1 |
| Ikke-tomme kan ikke fjernes; fjerning er myk | 4.4.1b, 4.4.3–4.4.4, 4.5.3, 7.4 |
| Uten eiendom ingen bygninger, og teksten vises | 4.5.1–4.5.2, 7.5 |
| Hendelser og logg i samme transaksjon, uten navn, kommentar, arealtall | 4.6 |
| Innstillingen av: takstmann får ikke endre; siden viser tekst | 4.1.2, 6.4, 7.7 |
| Tenant-isolasjon, fremmed id og «Målt av» fra annen organisasjon | 3.4, 3.7, 4.2, 4.3 |
| iPad-størrelse, knapper minst 44 px | 7.9 |
| Kommandoene grønne, versjon økt | gjennomgangen |
