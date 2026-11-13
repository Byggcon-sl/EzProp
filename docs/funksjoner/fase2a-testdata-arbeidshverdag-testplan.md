# Testplan: Testdata som ligner en ekte arbeidshverdag

- **Oppgavekort:** `docs/funksjoner/fase2a-testdata-arbeidshverdag.md`
- **Dato:** 13.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** **de ansatte** (testene låser at testmiljøet alltid viser en full arbeidsdag i organisasjonen de logger inn i, og at skriptet aldri kan røre produksjon eller ekte arbeid), **KI i bunnen** (vasken prøves på ekte-lignende, oppdiktede parter; ingen nye KI-kall) og **færre reklamasjoner** (lister, søk, reklamasjoner og ytelse prøves med en datamengde som ligner drift, og dataene lærer ikke bort feil fag).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL`, `resetDatabase` i `beforeEach`, `runSeed(env)` først (Byggcon og admin finnes, som i drift) og dempet `console.log` som i `src/db/seed/run.test.ts`. Seed-steget tar `env` og `now` som argument (fast `now = TEST_NOW`), så datoene i testene er faste. Testdata er oppdiktet. Ingen TG og ingen fagtekster settes (kortet: «Ingen nye regler»). «Regeltestene» her er tabelltester (`it.each`) over datafilen og over radene i databasen, ikke regelmotoren. E2e kjøres i prosjektene `pc` og `ipad`.

## Avvik mellom oppgaveteksten og kortet (gjelder testplanen)

Oppgaveteksten nevner bilder, funn, TG og målinger. Kortet (A264) flytter dette til del 2 under 2a-2 «Badet på PC», fordi datamodellen ikke har plass (`files` har ingen kobling til rom eller avvik, ingen tabell for rapportsvar, ingen byggeår-kolonne). Testplanen følger kortet. Den har derfor en **negativ** test (6.4): skriptet lager ingen `files`, ingen TG og ingen rader i regel- eller maltabellene. Når del 2 bygges, får den egen testplan.

## Avtale om signaturer (utvikler og testskriver)

Navnene kan endres, men avvik føres i kortet.

- `src/db/seed/seeded-random.ts`: `createSeededRandom(seed: number)` med `next(): number` (0 ≤ x < 1), `int(min, max)`, `pick(list)`. Ingen bruk av `Math.random` i `testdata*.ts`.
- `src/db/seed/testdata-guard.ts`: `assertTestdataAllowed(env)` som kaster `TestdataGuardError` med norsk melding. Ren funksjon, ingen database.
- `src/db/seed/testdata.data.ts`: `TESTDATA_EMPLOYEES`, `TESTDATA_FIRMS`, `TESTDATA_PROPERTIES`, `TESTDATA_ORDERS` (eller tilsvarende), `TESTDATA_EMAIL_DOMAIN = "testdata.invalid"`, `TESTDATA_PHONE_PATTERN`, `TESTDATA_GNR_RANGE = [9001, 9099]`, `TESTDATA_MUNICIPALITIES` (postnummer, poststed, kommunenummer), `TESTDATA_SEED`.
- `src/db/seed/testdata.ts`: `runTestdataSeed(env, now?) → TestdataSummary` (antall laget og hoppet over per tabell, og `TD-`-nøkler). Oppslagene skriptet bruker for «finnes fra før» eksporteres for tenant-testen, f.eks. `findTestdataOrders(organizationId)`, `findTestdataEmployees(organizationId)`, `findTestdataFirms(organizationId)`, `findTestdataProperties(organizationId)`.
- `src/db/seed/testdata-index.ts`: inngangen for `pnpm db:seed:testdata`. Vakten kalles **før** databasen åpnes.
- Testhjelper (bare i testfilen) `countRows(organizationId?)`: antall rader per tabell i «Data» i kortet (`users`, `employees`, `employee_roles`, `certifications`, `firms`, `contacts`, `orders`, `assignments`, `assignment_team_members`, `assignment_parties`, `properties`, `cadastral_units`, `common_areas`, `report_buildings`, `floors`, `rooms`, `floor_areas`, `work_sessions`, `claims`, `events`, `audit_log`, `number_sequences`), pluss `ai_usage_log`, `sessions`, `accounts`, `files`, og verdien i `number_sequences`.
- Testhjelper `snapshot(organizationId)`: alle TD-rader som sortert JSON uten `id`, fremmednøkler byttet med naturlig nøkkel, og uten `created_at`/`updated_at`. Brukes i determinisme og «ingen datoer flytter seg».

## 1. Frøgeneratoren, `src/db/seed/seeded-random.test.ts` (ny, ren)

1. **samme frø gir samme rekkefølge:** 1000 tall fra to generatorer med `TESTDATA_SEED` er like.
2. **annet frø gir annen rekkefølge:** frø 1 og 2 gir ulike første 10 tall.
3. **verdiområde:** `next()` er alltid i [0, 1); `int(1, 3)` gir bare 1, 2, 3 og alle tre minst én gang på 1000 trekk; `pick([])` kaster.
4. **ingen global tilfeldighet:** kildetekst-sjekk av `seeded-random.ts`, `testdata.ts`, `testdata.data.ts`: ingen `Math.random`, `crypto.randomUUID`, `Date.now()` eller `new Date()` uten argument (tid kommer bare fra `now`).

## 2. Produksjonsvakten, `src/db/seed/testdata-guard.test.ts` (ny, ren)

1. **godtar** `APP_ENVIRONMENT` `development` og `test` sammen med vert `localhost`, `127.0.0.1`, `[::1]` og `psql-ezprop-test.postgres.database.azure.com` (`it.each`).
2. **stopper på miljø** (`it.each`): `production`, `Production`, `PRODUCTION`, `prod`, ` test `, `test\n`, `""`, mangler, `staging`, `development,test`. Lokal vert i alle, så det er miljøet som stopper.
3. **stopper på vert** med `APP_ENVIRONMENT=test` (`it.each`): `psql-ezprop-prod…`, `psql-ezprop.postgres…`, `ezprop-test.example`, `psql-ezprop-testprod.postgres.database.azure.com` (se funn F3), `localhost.evil.example`, `10.0.0.5`, ugyldig URL, tom og manglende `DATABASE_URL`.
4. **`NODE_ENV` teller ikke:** `NODE_ENV=production` med `APP_ENVIRONMENT=test` og lokal vert godtas; `NODE_ENV=development` med `APP_ENVIRONMENT=production` stopper.
5. **meldingen:** norsk, nevner `APP_ENVIRONMENT` eller databasen, og inneholder aldri adressen, verten, brukernavnet eller passordet fra `DATABASE_URL` (`postgres://hemmeligbruker:hemmeligpassord@psql-ezprop-prod…`). Feilobjektets `cause`/`stack` lekker heller ikke adressen.

## 3. Datafilen, `src/db/seed/testdata.data.test.ts` (ny, ren)

### 3.1 Ingen ekte-lignende data (A265)

1. **e-post:** hver streng med `@` i hele datafilen (regex over `JSON.stringify`) ender på `@testdata.invalid`.
2. **telefon:** hvert telefonnummer følger `TESTDATA_PHONE_PATTERN` og går gjennom telefonvalideringen i `src/core/contacts/schemas.ts`.
3. **gnr:** alle gnr i eiendommer og ordre er 9001–9099.
4. **elleve sifre:** ingen streng har elleve sifre på rad (også med mellomrom fjernet), ingen ni sifre på rad (org.nr.).
5. **organisasjonsnummer:** tomt eller fraværende på alle firma.
6. **postnummer og kommune:** hvert par finnes i `TESTDATA_MUNICIPALITIES`, og alle kommunenummer starter på `18` (Nordland) eller `55` (Troms).
7. **kjedenavn:** ingen firma- eller borettslagsnavn inneholder (uten store/små bokstaver) et navn fra en kort liste i testen: `DNB`, `Eiendomsmegler 1`, `EiendomsMegler 1`, `Privatmegleren`, `Krogsveen`, `Nordvik`, `Obos`, `Usbl`, `Boligbyggelaget`, `Heimdal`, `Aktiv`, `Proaktiv`, `Sem & Johnsen`, `Garanti`, `Exact`, `Schala`, `Nordlandsbanken`, `Sparebank`.
8. **seed-admin:** ingen ansatt i datafilen har samme fulle navn som `SEED_ADMIN_NAME` i `.env.example`, eller e-postdomene lik domenet i `SEED_ADMIN_EMAIL`.
9. **ingen gjetteord og ingen TG:** ingen streng inneholder «antas», «trolig», «sannsynligvis», «TG0»–«TG3», «tilstandsgrad», og ingen tekst framstiller «nektet hulltaking» som grunnlag for TG.
10. **ingen særlige kategorier:** fritekst har ikke ord fra en kort liste i testen (`sykdom`, `diagnose`, `gravid`, `religion`, `straffe`, `fødselsnummer`).

### 3.2 Innhold og roller

1. **ansatte:** 10–15, alle e-poster unike. Rollene til sammen = `employeeRoles` uten `admin` (testen leser konstanten, så en ny rolle gjør den rød), og ingen har `admin`.
2. **etternavn** kommer fra den faste listen i datafilen.
3. **firma:** 4–5 meglerfirma (`firm_type` megler), hvert med minst én megler.
4. **eiendommer:** 45–55, alle tre slagene: enebolig (med minst én `terraced` og én `semi_detached`), leilighet i sameie, leilighet i borettslag, fritidsbolig.
5. **statuser:** minst én av hver i `ASSIGNMENT_STATUSES` (bestilt, under arbeid, ferdig, fakturert) og minst to ordre som ikke er gjort om.
6. **tidsspenn:** planlagte befaringer fra minst 90 dager før til minst 21 dager etter ankeret, ingen eldre enn 4 måneder (gyldighet ett år brytes ikke).
7. **reklamasjoner:** 4–5, utfallene åpen, avvist, medhold, forlik og trukket finnes alle.
8. **byggeår:** finnes i datafilen for hver eiendom, 1900–2025, minst én med bad før 2000 og én med bad 0–5 år gammelt (for senere aldersregler).

### 3.3 Faglige krav (regeltester, `it.each` over eiendommene)

1. **arealtype følger `suggestAreaType`** (`src/core/buildings/codes.ts`) for hver romtype; garasje og utebod er `bra_e`; `bra_b` bare på innglasset balkong (A269).
2. **etasjens arealtyper:** BRA-e og BRA-b i etasjen har rom med samme arealtype.
3. **ALH** bare på loft og hems, og aldri samtidig talt som BRA.
4. **`not_bra`** på kryperom og uinnredet loft.
5. **under terreng** stemmer med etasjen (kryperom er unntaket).
6. **bad og kjøkken:** hver bolig har minst ett bad og ett kjøkken eller stue/kjøkken.
7. **metode:** `drawing` bare på fellesbod, ellers `laser`.
8. **størrelser:** leilighet 35–120 m², enebolig 90–250 m², fritidsbolig 30–120 m² (sum BRA).
9. **eierform og matrikkel:** sameie har `snr` og ingen andel; borettslag har lagets navn og andelsnummer og ingen `snr`; enebolig og varianter er selveier uten `snr`/andel; fritidsbolig er selveier, minst én med `fnr`.
10. **fellesarealer** bare på sameie og borettslag.
11. **skjemaene:** eiendom, bygning, etasje, areal, rom, kontakt og firma går gjennom de samme Zod-skjemaene som appen bruker, og alle koder finnes i kodelistene (`HOUSING_TYPES`, `OWNERSHIP_FORMS`, `ROOM_TYPE_KEYS`, `AREA_TYPES`, `MEASURING_METHODS`, `PARTY_ROLES`).
12. **reklamasjoner:** bare på oppdrag som er ferdige eller fakturerte; beløp bare ved medhold og forlik; bygningsdelene dekker minst våtrom, tak, drenering og areal.
13. **tid og team:** sidemann ≠ ansvarlig; befaring før ferdig-tidspunkt; ferdige og fakturerte har befaring i fortiden og egenerklæring mottatt.
14. **tidsregistrering:** befaring 1–3 t, rapportskriving 2–5 t; snitt for leilighet < snitt for enebolig med kjeller.

## 4. Seed-steget, `src/db/seed/testdata.test.ts` (ny, mot databasen)

### 4.1 Første kjøring, innhold (akseptkriterium 1 og 2)

1. **organisasjonen:** alle TD-rader har Byggcon-organisasjonens id fra `runSeed`; prøveorganisasjonen (hvis `runSampleSeed` er kjørt først) har null nye rader.
2. **antall i databasen** som i 3.2 (ansatte, firma, meglere, eiendommer, statuser, ordre uten oppdrag, reklamasjoner med alle utfall).
3. **team og parter:** hvert TD-oppdrag har ansvarlig, sidemann (annen person), kontor og minst én part. Alle teammedlemmer er oppdiktede ansatte.
4. **befarte oppdrag** (under arbeid, ferdig, fakturert) har bygning, etasje, rom og `floor_areas`; bestilte har ingen.
5. **`work_sessions`** finnes på alle ferdige og fakturerte, bare med oppdiktede ansatte, aldri seed-admin.
6. **sertifiseringer:** ansvarlig takstmann har gyldig sertifisering på befaringsdagen for hvert ferdige og fakturerte oppdrag; nøyaktig én takstmann har utløpt sertifisering, og `requireOrganizationAccess` gir ham ikke `report.publish`, mens de andre takstmennene har den.
7. **laget gjennom tjenestene:** hvert oppdrag har hendelser for opprettelse og hvert statusbytte; `created_by` på ordre er en kontoransatt, statusbytter er gjort av ansvarlig takstmann, reklamasjoner er registrert av en leder. Seed-admin er aldri aktør i `events` eller `audit_log` for TD-rader.
8. **fakturert nås gjennom gyldige bytter:** hendelsesrekken for hvert fakturert oppdrag er bestilt → under arbeid → ferdig → fakturert.
9. **tidspunkter flyttet bakover:** mottatt, statusbytter og hendelser ligger på planlagt dato (ikke `now`), i riktig rekkefølge, og bare på TD-rader.
10. **nummerserien:** oppdragsnumrene er unike, og telleren har økt med antall TD-oppdrag.
11. **samme faglige krav i databasen:** 3.3.1–3.3.13 kjøres også mot radene etter kjøring (ett `it.each`-sett som leser databasen), så feil i overføringen fanges.

### 4.2 Idempotens (akseptkriterium 4)

1. **andre kjøring skriver ingenting:** `countRows()` før og etter er like i alle tabeller, også `events`, `audit_log`, `number_sequences` (verdi), `users` og `ai_usage_log`.
2. **`updated_at` uendret** på alle TD-rader etter andre kjøring.
3. **klokka 30 dager fram:** andre kjøring med `now = TEST_NOW + 30 dager` gir samme `countRows()` og samme `snapshot()` (ingen datoer flytter seg; ankeret er `created_at` på `TD-0001`).
4. **tredje kjøring** gir det samme som andre.
5. **sammendraget** sier «laget» ved første og «finnes fra før» ved andre kjøring.

### 4.3 Avbrutt kjøring og myk sletting (akseptkriterium 5)

1. **bare ansatte finnes:** kjør bare ansatt-steget (eller avbryt med en kastende stub etter ansatte). Neste kjøring gir samme `countRows()` som en ren kjøring, uten kopier av ansatte eller brukere.
2. **avbrutt midt i ordrene:** `TD-0001`–`TD-0010` finnes. Neste kjøring fyller ut resten; hver `external_ref` finnes én gang; ankeret er uendret.
3. **mykt slettet ordre:** sett `deleted_at` på `TD-0005` (via tjenesten). Neste kjøring gjenoppliver den ikke og lager ingen ny `TD-0005`.
4. **mykt slettet kontakt og ansatt:** samme resultat (ingen kopi, ingen gjenoppliving).
5. **skriptet setter aldri `deleted_at`:** etter to kjøringer har ingen TD-rad `deleted_at` utenom dem testen selv slettet. Kildetekst-sjekk: `testdata*.ts` har ikke `db.delete`, `tx.delete`, `DELETE FROM`, `deletedAt:`.

### 4.4 Determinisme (akseptkriterium 6)

1. **to tomme databaser gir like data:** kjør i database-runde 1, ta `snapshot()`, `resetDatabase` og `runSeed`, kjør igjen, sammenlign. Like nøkler og feltverdier.

### 4.5 Vakten mot databasen (akseptkriterium 7)

1. **stopper før skriving** (`it.each` over et utvalg fra 2.2 og 2.3, også `APP_ENVIRONMENT=test` med ukjent vert): `runTestdataSeed` kaster `TestdataGuardError`, og `countRows()` og verdien i `number_sequences` er uendret.
2. **ingen transaksjon åpnes:** en spion på `db.transaction` (eller tilsvarende) er ikke kalt når vakten stopper.
3. **inngangen:** `testdata-index.ts` med `APP_ENVIRONMENT=production` avslutter med kode ≠ 0 og norsk melding på stderr, uten adressen (kjøres som barneprosess med `tsx`).

### 4.6 Tenant-isolasjon (akseptkriterium 8, regel 2)

1. **`expectTenantIsolation` for hvert oppslag** skriptet bruker: `findTestdataOrders`, `findTestdataEmployees`, `findTestdataFirms`, `findTestdataProperties` (og hvert annet eksportert oppslag). `seed` lager like TD-nøkler i A og B (samme `external_ref`, samme e-post, samme firmanavn, samme kommune/gnr/bnr); `query` går gjennom `requireOrganizationAccess` og bruker `grant.organizationId`.
2. **annen organisasjon med like nøkler:** lag en annen organisasjon med ordre `TD-0001`, kontakt `megler1@testdata.invalid` og ansatt med TD-e-post før kjøring. Kjøringen lager alt i Byggcon som vanlig, og radene i den andre organisasjonen har uendret `updated_at`, status og antall hendelser.
3. **datoankeret** leses bare fra Byggcons `TD-0001`: en eldre `TD-0001` i en annen organisasjon påvirker ikke datoene.
4. **fremmednøkler:** spørring som teller TD-rader der `assignment_id`, `building_id`, `floor_id`, `employee_id`, `contact_id`, `firm_id`, `property_id` peker til en rad i en annen organisasjon = 0.
5. **ansatt i en annen organisasjon** ser ingen TD-oppdrag i `listWorkQueue`, `listOrders` og `getTimeStatistics`, og får `AccessDeniedError` mot Byggcons id.
6. **ingen ny tabell:** `tests/tenant-tables.ts` er uendret, og `tests/tenant-isolation-all-tables.test.ts` er grønn.

### 4.7 Ekte arbeid og admin (akseptkriterium 9, regel 11)

1. **ekte rader urørt:** før kjøring lages en ordre, en kontakt og en ansatt uten TD i Byggcon. Etterpå er alle felt og `updated_at` uendret, og ingen TD-rad peker på dem (ikke som part, teammedlem eller kontakt).
2. **seed-admin:** samme roller, aktiv, `activeAdminCount(byggcon)` er uendret (ikke økt, ikke redusert), `findEmployeeGrant(admin)` gir fortsatt Byggcon, og admin har `organization.manage`.
3. **ingen oppdiktet admin:** ingen TD-ansatt har rollen `admin`, rader i `sessions` eller `accounts`, eller deler navn eller e-postdomene med seed-admin.
4. **kan ikke logge inn:** innloggingsoppslaget for en TD-e-post gir ingen kode som kan sendes (eller: den ansatte finnes, men e-post-domenet er `.invalid`; testen låser det som faktisk skjer, uten å sende e-post).

### 4.8 Tilgang per rolle med testdata (akseptkriterium 11)

Brukere: én TD-ansatt per rolle (aktør gjennom `requireOrganizationAccess`), pluss seed-admin.

1. **takstmann, kontor, leder, admin** ser alle TD-oppdrag i `listWorkQueue` (alle fire faner til sammen, `mineOnly: false`) og TD-ordre i `listOrders`.
2. **takstmann ser egne:** `listWorkQueue` med `mineOnly: true` for en TD-takstmann gir bare oppdrag der han er i teamet, og minst ett har befaring denne uken (fra ankeret).
3. **reklamasjoner:** leder og admin får sakene i `listClaimsForAssignment` og `getClaim`; takstmann og kontor får `AccessDeniedError`.
4. **endre:** takstmann kan endre et TD-oppdrag med `access.inspectors_edit_all` som standard; med innstillingen av får han nei, og admin får fortsatt ja.

### 4.9 Vasken på testdata (akseptkriterium 10, ingen KI-kall)

1. **`loadKnownValues` + `redactText`:** hent et TD-oppdrag med parter, kontakt og matrikkel; en tekst med partens navn, e-post, telefon, gateadresse og «gnr 9012/34» (matrikkelen til oppdraget) får alle fem byttet med plassholdere, og ingen av verdiene står igjen.
2. **telefonmønsteret fanges** også skrevet som `00047 000 12 345` og `00012345`.
3. **ingen KI-kall:** `ai_usage_log` er tom etter testen, og den falske leverandøren er ikke kalt.

### 4.10 Logging (akseptkriterium 12)

1. **stdout og stderr** fra to kjøringer (og fra en vaktstopp) har ingen `@`, ingen navn, gatenavn, telefonnummer eller firmanavn fra datafilen (`it.each` over alle strenger i datafilen med lengde ≥ 4), bare antall og `TD-`-nøkler.

### 4.11 Ytelse (akseptkriterium 13, A270)

1. **`listWorkQueue`** for hver fane, og **`listOrders`** med og uten søkeord, svarer på under 2 s med full testdata (median av 3 kall, etter ett oppvarmingskall).
2. **ordrelisten over grensen:** med flere TD-ordre enn `ORDER_LIST_LIMIT` (50) gir `listOrders` 50 rader og riktig `total`, og `orderListSummary` gir teksten om at ikke alle vises.
3. **`getTimeStatistics`** svarer på under 2 s og gir tall > 0 for TD-takstmennene.

## 5. Utrulling og oppstart, `tests/deploy-workflow.test.ts` (endres) og `tests/start-script.test.ts`

1. **`deploy-azure.yml`:** `pnpm db:seed:testdata` står etter `pnpm db:seed:testoppdrag` i steget «Migrering og seed», og før `firewall-rule delete`.
2. **miljøet:** steget har `APP_ENVIRONMENT: ${{ env.ENVIRONMENT_NAME }}`, ikke fast tekst `test`.
3. **ingen annen arbeidsflyt** under `.github/workflows/` kaller `db:seed:testdata` (heller ikke `ci.yml`, siden e2e kjører seed selv).
4. **`.env.example`** har `APP_ENVIRONMENT=development`.
5. **`package.json`:** `db:seed:testdata` peker på `src/db/seed/testdata-index.ts`; `db:seed` og `db:seed:testoppdrag` er uendret; versjonen er økt (minor).
6. **ingen nye avhengigheter:** `dependencies` og `devDependencies` er like `main` (testen sammenligner med en fast liste eller med lockfila).
7. **`start.sh`** (hvis endret): `bash -n` går gjennom, ingen bash 4-ting i nye linjer, og `APP_ENVIRONMENT` settes til `development` hvis den mangler.

## 6. Ting som ikke skal skje (negative tester i `testdata.test.ts`)

1. ingen nye rader i `ai_usage_log` (også i 4.2.1).
2. ingen rader i `sessions` eller `accounts` for TD-brukere.
3. ingen endring i prøveorganisasjonen (`countRows(prøveorg)` uendret når `runSampleSeed` er kjørt før).
4. ingen `files`, ingen rader i regel-, mal- eller svartabellene, ingen TG (A264).
5. ingen `client_agreements`.

## 7. E2e, `e2e/fase-2a-testdata.spec.ts` (ny, `pc` og `ipad`)

`beforeAll`: `assertLocalOrTestDatabase` (`e2e/database-guard.ts`), så seed-funksjonen via en hjelper i `e2e/helpers.ts` med `APP_ENVIRONMENT=test` mot `DATABASE_URL`. De oppdiktede ansatte kan ikke logge inn, så testene logger inn med de eksisterende e2e-brukerne i Byggcon (`logInAsInspector`, `logInAsOffice`, `logInAsManager`, `logIn` for admin) og bruker «Alle» (`?mine=0`). Testene sjekker på `TD-`-nøkler og adresser fra datafilen, ikke på faste antall (andre tester deler databasen).

1. **arbeidskøen (takstmann):** fanen «Bestilt» har minst ett TD-oppdrag med befaringstid denne uken; alle fire faner har TD-oppdrag; søk på et oppdiktet gatenavn gir treff.
2. **ordrelisten (kontor):** viser TD-ordre med alle ordrestatuser (merket), og teksten om at ikke alle vises når det er over 50. Statusfilteret: fanene i arbeidskøen (`?status=`) viser bare oppdrag med valgt status (se funn F1).
3. **oppdragssiden:** et befart TD-oppdrag viser team, parter, matrikkel med gnr 9001–9099, og fellesarealer på sameie/borettslag; «Bygninger» viser etasjer, rom og areal.
4. **reklamasjoner:** leder åpner et ferdig TD-oppdrag med sak og ser reklamasjonene; takstmannen får ikke lenken og får nei-siden ved direkte adresse til `/oppdrag/[id]/reklamasjoner/[claimId]`.
5. **tidsstatistikk (leder):** `/statistikk/tid` viser tall > 0 for minst én TD-takstmann.
6. **uten nett (bare `ipad`):** arbeidskøen ligger i hurtiglageret (`public/sw.js`, `/arbeidskoe`). Takstmannen åpner køen på nett, setter `context.setOffline(true)`, laster på nytt, og ser fortsatt TD-oppdragene fra forrige visning.
7. **universell utforming:** axe-sjekk uten alvorlige brudd på arbeidskøen og ordrelisten med full testdata (lange lister).

## Krav for godkjenning

- Alle avsnitt 1–7 finnes og er grønne; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- Avvises uten: 4.6 (tenant-isolasjon på hvert oppslag), 4.7 (ekte arbeid og admin), 4.8 (tilgang per rolle), 2 og 4.5 (vakten), 4.3.3–4.3.5 (myk sletting).

## Funn før bygging (til utvikler og prosjektleder)

- **F1 (lite):** kortets e2e-kriterium sier «ordrelisten viser alle statuser og statusfilteret virker», men ordrelisten (`/ordre`) har bare søk, ingen statusfilter. Statusfilteret finnes i arbeidskøen. Testplanen prøver filteret der. Kortet bør rettes, ikke ny funksjon bygges.
- **F2 (lite):** det finnes ingen samlet reklamasjonsliste; sakene vises per oppdrag (`/oppdrag/[id]/reklamasjoner/…`). E2e 7.4 prøver dem der.
- **F3 (lite):** vertsjekken «starter med `psql-ezprop-test`» slipper også `psql-ezprop-testprod…` gjennom. Servernavnet er `psql-ezprop-${environmentName}` (`infra/azure/main.bicep`), så verten er `psql-ezprop-test.postgres.database.azure.com`. Foreslår å kreve at verten starter med `psql-ezprop-test.` (med punktum). Test 2.3 krever at `psql-ezprop-testprod…` stoppes.
- **F4 (lite):** oppgaveteksten ber om bilder, funn og TG; kortet utsetter dem (A264). Testplanen følger kortet og tester at de ikke lages (6.4).
