# Testplan: Fire testoppdrag som grunndata

- **Oppgavekort:** `docs/funksjoner/fase2a-testoppdrag.md`
- **Dato:** 06.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at de fire oppdragene alltid finnes og er like, så ingen skriver inn eiendom, bygninger og rom for hånd før en prøve), reklamasjoner (regler og mal prøves senere mot fire faste boligtyper, og testene sikrer at grunnlaget ikke endrer seg i det stille) og KI først (KI-forslagene i senere faser måles mot de samme fire oppdragene; testene låser at innholdet er fast og oppdiktet).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`, og `console.log` dempes som i `src/db/seed/run.test.ts`. Seed-steget tar `env` og `now` som argument (fast `now = TEST_NOW`), slik at datoene i testene er faste. Testdata er oppdiktet. Ingen TG og ingen fagtekster. «Regeltestene» her er tabelltester (`it.each`) over datafilen. Seed-steget har ingen nettfri del, så det er ingen e2e uten nett. E2e kjøres i prosjektene `pc` og `ipad`.

## Avtale om signaturer (utvikler og testskriver)

Navnene kan endres, men avvik føres i kortet.

- `src/db/seed/sample-assignments.data.ts`: `SAMPLE_ASSIGNMENTS` (fire oppføringer med `externalRef`, `status`, eiendom, bygninger, etasjer, areal, rom, parter), `SAMPLE_ORGANIZATION_NAME` (fra `brand.companyName`), `SAMPLE_INSPECTOR` (navn og e-post).
- `src/db/seed/sample-assignments.ts`: `runSampleSeed(env, now?) → SampleSeedSummary` (antall laget og hoppet over per testoppdrag). Kaster `SampleOrganizationError` (eller tilsvarende) med norsk melding når organisasjonen ikke har merket, eller når navnet finnes to ganger.
- Intern spørring `findSampleOrders(organizationId)` (eller tilsvarende), eksportert for testen. Den gir ordrene med `external_ref` som starter med `sample:` i én organisasjon, også avviste ordrer og ordrer med kansellert oppdrag.
- `src/db/seed/sample-index.ts`: inngangen for `pnpm db:seed:testoppdrag`.
- Testhjelper (bare i testfilen) `countRows()` som gir antall rader per berørt tabell (`organizations`, `users`, `employees`, `employee_role_assignments`, `companies`, `offices`, `orders`, `assignments`, `assignment_team_members`, `assignment_parties`, `properties` og tabellene for matrikkel og fellesdeler, `buildings`, `floors`, `floor_areas`, `rooms`, `number_sequences`, `events`, `audit_log`), og verdien i `number_sequences`.

## 1. Datafilen, `src/db/seed/sample-assignments.data.test.ts` (ny, ren)

Tabelltester (`it.each` over `SAMPLE_ASSIGNMENTS`):

1. **nøyaktig fire testoppdrag** med `externalRef` `sample:detached-garage`, `sample:apartment-section`, `sample:apartment-cooperative`, `sample:holiday-home`. Alle unike, alle starter med `sample:`.
2. **boligtype og eierform:** `detached`/`freehold`, `apartment`/`section`, `apartment`/`cooperative`, `holiday_home`/`freehold`. Hver kode finnes i `HOUSING_TYPES` og `OWNERSHIP_FORMS`.
3. **status:** eneboligen er `ordered`, de tre andre `in_progress` (A133). Alle verdier finnes i `ASSIGNMENT_STATUSES`.
4. **kommunenummer `9999`** på alle fire, og verdien godtas av `propertyInputSchema` (hele eiendomsdelen av hvert testoppdrag går gjennom skjemaet uten feil).
5. **bygninger, etasjer, areal og rom går gjennom skjemaene** `buildingInputSchema`, `floorInputSchema`, `floorAreaInputSchema` og `roomInputSchema` uten feil (samme skjemaer som i appen).
6. **kodelistene:** hver romtype finnes i `ROOM_TYPE_KEYS`, hver arealtype i `AREA_TYPES`, hver målemetode i `MEASURING_METHODS`, hver partsrolle i `PARTY_ROLES`.
7. **enebolig:** to bygninger (bolig og garasje). Boligen har to etasjer og en kjeller med `below_ground = true` på rommene der. Garasjen har areal med `bra_b`. Minst ett våtrom har byggeår eller ombygging før 2000.
8. **sameie:** seksjonsnummer er satt, fellesdeler er med.
9. **borettslag:** borettslagets navn er satt, fellesdeler er med.
10. **fritidsbolig:** to bygninger (hytte og bod). Hytta har hems med ALH.
11. **realistiske tall:** byggeår mellom 1900 og 2025, alle arealer > 0 og < 500 m², ALH ≤ BRA-i i samme etasje.
12. **ingen kundeopplysninger:** hver e-postadresse i hele datafilen (søk med regex i `JSON.stringify`) ender på `@example.invalid`. Ingen streng har 11 sifre på rad (fødselsnummer), 8 sifre eller `+47` (telefon), eller 9 sifre (org.nr.). Ingen nøkkel heter `phone`, `orgNumber`, `nationalId` eller tilsvarende med verdi.
13. **ingen fagtekster og ingen gjetteord:** ingen streng inneholder «antas», «trolig», «TG», og datafilen har ingen nøkler for avvik, kontrollpunkt eller regel.
14. **produktnavnet:** prøveorganisasjonens navn er bygget fra `brand.companyName` (lint dekker resten).

## 2. Seed-steget, `src/db/seed/sample-assignments.test.ts` (ny, mot databasen)

`beforeEach`: `resetDatabase`, så `runSeed(env)` (Byggcon og admin finnes, som i drift).

### 2.1 Første kjøring

1. **prøveorganisasjonen** lages med navnet `` `${brand.companyName} prøve` `` og `settings.sampleData = true`. Byggcons `settings` er uendret.
2. **grunndata:** ett selskap `Prøveselskap AS` uten org.nr., ett kontor `Prøvekontor`, én takstmann med e-post på `@example.invalid` og selskap `Prøveselskap AS`.
3. **fire ordrer** i prøveorganisasjonen med riktig `external_ref`, hver gjort om til oppdrag. Status som i 1.3.
4. **oppdragsnummer fra nummerserien:** fire ulike numre, og telleren i `number_sequences` for prøveorganisasjonen har økt med fire. Byggcons teller (om den finnes) er uendret.
5. **team:** takstmannen er `responsible` på alle fire.
6. **utstedende selskap** på hvert oppdrag er `Prøveselskap AS` (satt av regelen når ansvarlig settes, A67), ikke satt direkte.
7. **eiendom:** boligtype, eierform og matrikkel (kommunenummer `9999`) som i datafilen. Seksjonsnummer på sameie, borettslagets navn på borettslag, fellesdeler på begge.
8. **bygninger, etasjer, areal og rom:** antall per testoppdrag er likt datafilen. Arealtype, metode, hvem som målte, romtype og «under terreng» stemmer for et utvalg (garasjens `bra_b`, hemsens ALH, kjellerrom med `below_ground`).
9. **parter:** roller og navn som i datafilen, alle som fritekst (ingen kobling til kontaktregisteret).
10. **laget gjennom tjenestene:** det finnes hendelser for opprettelse og omgjøring på hvert oppdrag, og `created_by` er admin-ansatt i prøveorganisasjonen (viser at `src/core` er brukt, ikke direkte innsetting).
11. **ingen bilder, ingen filer:** `files` er tom for prøveorganisasjonen (A134).

### 2.2 Gjentatt kjøring og kansellert testoppdrag (akseptkriterium 2)

1. **andre kjøring endrer ingenting:** `countRows()` før og etter er like i alle tabeller, telleren i `number_sequences` er uendret, ingen nye `events` eller `audit_log`. I samme test kanselleres borettslagsoppdraget med `cancelAssignment` før andre kjøring. Etter kjøringen finnes fortsatt bare én ordre med `sample:apartment-cooperative`, oppdraget har fortsatt `deleted_at`, og det er ikke laget noe nytt.
2. **`updated_at` er uendret** på alle rader i prøveorganisasjonen etter andre kjøring (ingen skrivende kall, ikke bare samme antall).
3. **tredje kjøring** gir det samme som andre.

### 2.3 Kjøring som stoppet halvveis (akseptkriterium 3)

1. **bare ordren finnes:** lag ordren for `sample:detached-garage` med `createOrder` i prøveorganisasjonen (etter at prøveorganisasjonen og grunndataene er laget ved at første kjøring stoppes, eller ved å kalle tjenesten direkte). Neste kjøring gjør den om til oppdrag og lager resten. Resultatet har samme `countRows()` som en ren kjøring i en egen database-runde (sammenlign mot tall lagret fra 2.1), og ordren er ikke laget to ganger.
2. **del som finnes, røres ikke:** i samme test får den eksisterende ordren en annen merknad før kjøringen; merknaden er uendret etterpå.

### 2.4 Vern mot feil organisasjon (akseptkriterium 4)

1. **samme navn uten merket:** lag organisasjonen `` `${brand.companyName} prøve` `` uten `settings.sampleData`. Kjøringen kaster med norsk melding, og `countRows()` er uendret (ingenting skrevet, heller ikke selskap, kontor eller ansatt).
2. **`sampleData` er ikke `true`** (`"true"`, `1`, `false`): `it.each`, samme resultat som 2.4.1.
3. **to organisasjoner med navnet**, begge med merket: kjøringen kaster med norsk melding og skriver ingenting.
4. **`SEED_ADMIN_EMAIL` mangler:** kaster før noe skrives (samme melding som `runSeed`).
5. **admin finnes ikke** (`runSeed` ikke kjørt): kaster med melding om å kjøre `pnpm db:seed` først, skriver ingenting.

### 2.5 Byggcon er urørt (akseptkriterium 5)

1. **ingen nye rader i Byggcon:** antall rader med Byggcons `organization_id` i alle tabellene i `countRows()` er likt før og etter to kjøringer.
2. **`pnpm db:seed` er uendret:** de eksisterende testene i `src/db/seed/run.test.ts` står uendret og er grønne. `runSeed` alene lager ingen prøveorganisasjon og ingen ordrer.
3. **`package.json`:** `db:seed` peker fortsatt på `src/db/seed/index.ts`, og `db:seed:testoppdrag` peker på `src/db/seed/sample-index.ts`.

### 2.6 Tilgang per rolle og admin (akseptkriterium 7, regel 11)

1. **admin i prøveorganisasjonen:** etter kjøringen gir `requireOrganizationAccess(admin, prøveorg, "organization.manage")` rollen `admin`.
2. **admin i Byggcon finnes fortsatt** etter to kjøringer: `activeAdminCount(byggcon) ≥ 1`, og admin har fortsatt `organization.manage` i Byggcon.
3. **admin lander fortsatt i Byggcon:** `findEmployeeGrant(admin)` gir Byggcons id etter kjøringen (prøveorganisasjonen skal ikke bli admins standard). Testen låser at navnet sorteres etter «Byggcon».
4. **takstmannen** har `organization.read` og `assignment.edit` i prøveorganisasjonen, og `AccessDeniedError` i Byggcon. `findEmployeeGrant(takstmann)` gir prøveorganisasjonen.
5. **takstmannen ser alle fire** i `listWorkQueue` (fanene `ordered` og `in_progress` til sammen) og kan endre med `access.inspectors_edit_all` som standard.

### 2.7 Tenant-isolasjon (akseptkriterium 6, regel 2)

1. **`expectTenantIsolation` for `findSampleOrders`:** `seed` lager ordrer med `external_ref = "sample:detached-garage"` i A og B; `query` kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og så `findSampleOrders(grant.organizationId)`; `idOf = id`.
2. **ansatt i Byggcon ser ingen testoppdrag:** ny takstmann i Byggcon. `listWorkQueue(byggconTakstmann, byggcon, { status })` for hver status har ingen av de fire oppdrags-id-ene. `getAssignment(byggconTakstmann, prøveorg, id)` gir `AccessDeniedError`. `getAssignment(byggconTakstmann, byggcon, id)` gir ikke-funnet-feil (aldri databasefeil, aldri data).
3. **samme `external_ref` i Byggcon:** lag en ordre i Byggcon med `external_ref = "sample:holiday-home"` før kjøringen. Kjøringen lager fortsatt fritidsboligen i prøveorganisasjonen, og Byggcons ordre har uendret `updated_at`, status og antall hendelser.
4. **fremmednøkler:** alle rader som steget lager, har prøveorganisasjonens `organization_id`, og hver `assignment_id`, `building_id`, `floor_id` og `employee_id` peker på rader i samme organisasjon (spørring som teller rader der organisasjonene ikke stemmer = 0).
5. **ingen ny tabell:** `tests/tenant-tables.ts` er uendret, og `tests/tenant-isolation-all-tables.test.ts` er grønn.

### 2.8 Myk sletting (akseptkriterium 8)

1. **ingen `deleted_at` satt av steget:** etter to kjøringer har ingen rad i prøveorganisasjonen `deleted_at`, unntatt oppdraget testen selv kansellerte i 2.2.1.
2. **kildetekst-sjekk:** `sample-assignments.ts` og `sample-index.ts` inneholder ikke `db.delete`, `tx.delete`, `DELETE FROM`, `deletedAt:` eller `cancelAssignment` (som i de andre modulene).

### 2.9 Loggen

1. **ingen e-postadresse og ingen navn i loggen:** ingen linje fra `console.log` i to kjøringer inneholder `@` eller takstmannens eller partenes navn (samme regel som `runSeed`).
2. **sammendraget** sier «laget» ved første kjøring og «finnes fra før» eller «hoppet over» ved andre, per testoppdrag med `external_ref`.

## 3. Utrulling og oppstart, `tests/deploy-workflow.test.ts` (endres) og `tests/start-script.test.ts` (ny eller eksisterende)

1. **`findIndex` treffer riktig linje:** ny hjelper eller regex som skiller `pnpm db:seed` (hele linjen, slutt på linjen) fra `pnpm db:seed:testoppdrag`. De eksisterende testene «brannmurregelen …» og «rolleskriptet …» bruker hjelperen, så de ikke blir grønne av feil grunn.
2. **`deploy-azure.yml`:** `pnpm db:seed:testoppdrag` finnes, kommer etter `pnpm db:seed` og før `firewall-rule delete` for `github-runner`.
3. **`ci.yml`:** `pnpm db:seed:testoppdrag` kommer etter `pnpm db:seed` og før `pnpm test:e2e`.
4. **`start.sh`:** `db:seed:testoppdrag` kommer etter `db:seed`, med `stopp` og norsk melding ved feil. `bash -n start.sh` går gjennom; ingen bash 4-ting (`declare -A`, `${var,,}`, `mapfile`) i nye linjer.
5. **produksjon:** ingen arbeidsflyt som ruller ut til produksjon kjører steget (sjekk at linjen bare finnes i jobben for testmiljøet).

## 4. E2e, `e2e/fase-2a-testoppdrag.spec.ts` (ny, `pc` og `ipad`)

Viktig: appen har **ingen organisasjonsvelger**. `findEmployeeGrant` velger første organisasjon etter navn, og admin lander alltid i Byggcon (se funn 1). E2e logger derfor inn som **prøvetakstmannen** fra datafilen, som bare er ansatt i prøveorganisasjonen. E2e kjører ikke seed-steget selv.

1. **forhåndssjekk:** `beforeAll` spør databasen (via `e2eSql`, med databasevakten) om prøveorganisasjonen og de fire `external_ref`-ene. Mangler noe, kastes `Kjør pnpm db:seed:testoppdrag først`, ikke en «fant ikke»-feil fra en locator.
2. **arbeidskøen:** prøvetakstmannen logger inn med `signInWithCode`. Fanen «Bestilt» har eneboligen, fanen «Under arbeid» har de tre andre. Sjekkes på adressene fra datafilen, ikke på fast antall rader (andre tester kan dele databasen).
3. **bygninger på eneboligen:** åpne eneboligen, gå til `/oppdrag/[id]/bygninger`, se bolig og garasje.
4. **iPad-størrelse** (prosjektet `ipad`): ingen vannrett rulling på arbeidskøen og på bygningssiden.

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- `expectTenantIsolation` for oppslaget på `external_ref` (2.7.1), Byggcon-ansatt uten tilgang (2.7.2) og ordre med samme `external_ref` i Byggcon (2.7.3).
- Admin-testene (2.6.1–2.6.3). De skal aldri fjernes.
- Vernet mot feil organisasjon (2.4.1–2.4.3) med «ingenting skrevet» målt med `countRows()`.
- Gjentatt kjøring uten nye numre, hendelser eller loggrader (2.2.1–2.2.2) og halvveis kjøring (2.3).
- Myk sletting (2.8) og kildetekst-sjekken.
- Kundeopplysninger i datafilen (1.12) og ingen fagtekster (1.13).
- `deploy-workflow.test.ts` skiller de to seed-linjene (3.1).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjonen økt (patch fra 0.3.8).

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Steget lager prøveorganisasjonen og fire testoppdrag med alt innhold | 1.1–1.11, 2.1.1–2.1.11 |
| Andre kjøring uendret; kansellert lages ikke på nytt | 2.2.1–2.2.3 |
| Halvveis kjøring fullføres | 2.3.1–2.3.2 |
| Nekter uten merket, stopper ved to like navn | 2.4.1–2.4.5 |
| Byggcon får ingen nye rader, `pnpm db:seed` uendret | 2.5.1–2.5.3 |
| Annen organisasjon får ikke tilgang | 2.7.1–2.7.5 |
| Admin i prøveorganisasjonen, admin i Byggcon blir ikke borte | 2.6.1–2.6.3 |
| Sletter aldri, setter aldri `deleted_at` | 2.8.1–2.8.2 |
| Datafilen: `@example.invalid`, ingen fnr./telefon/org.nr., `9999`, kodelistene | 1.4, 1.6, 1.12 |
| Utstedende selskap og oppdragsnummer fra de vanlige reglene | 2.1.4, 2.1.6, 2.1.10 |
| Virker på iPad-størrelse, tydelig melding når data mangler | 4.1–4.4 |
| CI og `deploy-azure.yml`, `deploy-workflow.test.ts` skiller linjene | 3.1–3.3, 3.5 |
| `start.sh` (bash 3.2) | 3.4 |
| Versjon, plan, ordliste | gjennomgangen |

## Funn i kortet

1. **Alvorlig:** kortet sier at admin «kan bytte til prøveorganisasjonen», og e2e-kriteriet sier «admin bytter til prøveorganisasjonen». Appen har ingen organisasjonsvelger. `findEmployeeGrant` (`src/core/organization/employees.ts`) tar første organisasjon etter navn, og «Byggcon» kommer før «Byggcon prøve». Admin ser derfor aldri testoppdragene i appen, og e2e som beskrevet kan ikke bygges. Kortet sier også «ingen nye skjermer». Forslag: e2e logger inn som prøvetakstmannen (avsnitt 4), og kortet rettes til det. At Ståle selv kan vise testoppdragene i testmiljøet, krever en organisasjonsvelger eller en egen demobruker. Det føres i `docs/09-apne-sporsmal.md` og bygges ikke her. Merk: takstmannens e-post på `@example.invalid` kan bare brukes til innlogging der `DEV_MAILBOX=1` (lokalt og i CI), ikke i testmiljøet.
2. **Lite:** «utstedende selskap satt av den vanlige regelen» virker bare hvis takstmannen har `company_id = Prøveselskap AS` før han settes som ansvarlig (A67). Kortet bør si det, og 2.1.6 tester det.
3. **Lite:** halvveis kjøring (2.3) er lettest å teste hvis steget er delt i funksjoner per del (ordre, omgjøring, team, eiendom, bygninger, parter), så testen kan lage tilstanden «bare ordren» med samme tjeneste. Testskriver bruker `createOrder` direkte hvis det ikke er delt.
