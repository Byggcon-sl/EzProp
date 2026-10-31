# Testplan: Admin – selskaper, kontorer, ansatte og roller

- **Oppgavekort:** `docs/funksjoner/fase0b-admin-organisasjon.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (riktig utsteder, forsikring og firmatekst; den som har sluttet, mister tilgang, men står på gamle rapporter; alt i revisjonsloggen) og tid (admin gjør endringene selv, uten utvikler). KI først: ingen KI i oppgaven; testene viser at bare rollene admin gir, styrer hvem som kan publisere (`report.publish`).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: navn som «Kari Testdatter», e-post på `eksempel.no`/`example.no`, org.nr. `000000001`–`000000009`, polisenummer `TEST-0001`, forsikringsselskap «Testforsikring». Ingen ekte navn, e-poster eller numre.

## Avtale om signaturer (utvikler og testskriver)

- Funksjonene i kortet, Omfang 2, eksporteres fra `@/core/organization`. Alle tar `(actor, organizationId, …)` først.
- Alle skrivefunksjoner returnerer raden de skrev (selskap, kontor, ansatt). `setEmployeeRoles` returnerer de aktive rollene etter endringen (`EmployeeRole[]`).
- **Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`** i kjernen (samme mønster som `requireActiveEmployee` i PR #50). Siden gir «Ingen tilgang» eller 404, aldri 500.
- Siste admin gir en egen feil med meldingen «Organisasjonen må ha minst én admin.». Testene sjekker meldingen, ikke klassenavnet.
- Duplikat e-post gir en feil med meldingen «Det finnes alt en ansatt med denne e-posten».
- Valideringsfeil er `ZodError`.
- Fabrikkene i `tests/factories.ts` brukes som de er. `resetDatabase` tømmer alt som trengs fra før (ingen ny tabell). Ny hjelper bare hvis den brukes i minst to filer: `activeAdminCount(organizationId)` (tell etter definisjonen i kortet, Omfang 4) og `auditRows(organizationId)`.

## 1. Selskaper, `src/core/organization/companies.test.ts` (utvides)

1. **createCompany lagrer alle feltene:** juridisk navn, org.nr., MVA-registrert, adresse, postnummer, sted, firmatekst, forsikringsselskap, polisenummer og gyldig til leses tilbake uendret; `organizationId` er `grant.organizationId`.
2. **updateCompany endrer alle feltene** og øker `row_version` med 1.
3. **tilgang per rolle** (`it.each` over `inspector`, `office`, `manager`): `createCompany` og `updateCompany` gir `AccessDeniedError`, og antall rader i `companies` er uendret. Admin lykkes (positiv kontroll).
4. **ansatt uten roller og admin som har sluttet** får `AccessDeniedError`.
5. **tenant-isolasjon, `createCompany`:** ett `expectTenantIsolation`. `seed` gir `{ a: [grantA.organizationId], b: [grantB.organizationId] }`; `query` oppretter et selskap og returnerer `[row]`; `idOf: (row) => row.organizationId`. Viser at raden havner i egen organisasjon og at kall mot den andre avvises. Etterpå: B har nøyaktig ett selskap.
6. **tenant-isolasjon, `updateCompany`:** ett `expectTenantIsolation`. `seed` lager ett selskap i A og B og husker id per organisasjon; `query` oppdaterer raden som hører til `organizationId` med `legalName: \`Endret av ${actor.id}\`` og returnerer `[row]`. Etterpå: B-raden har adminB sin id i navnet og `row_version` 2 (bare B sin egen endring).
7. **fremmed id (regel 2):** admin A kaller `updateCompany(adminA, orgA, idFraB, …)` og får `AccessDeniedError`; B-raden er uendret (`row_version` 1). Det samme for en id som ikke er uuid (`"ikke-en-id"`) og en tilfeldig uuid.
8. **slettet selskap kan ikke endres** (`deleted_at` satt) og gir `AccessDeniedError`.
9. **revisjonslogg:** `create` og `update` gir én rad hver med `entityType` for selskap og riktig `organizationId`. Verdiene kan stå (kortet, Omfang 7).
10. **Zod, regeltester som data** (`it.each`): org.nr. `"12345678"`, `"1234567890"`, `"12345678A"`, `"123 456 789"` avvises; `null`/tomt og `"000000001"` godtas. Tomt juridisk navn avvises. «Gyldig til» `"31.13.2026"` og `"ikke-dato"` avvises; `"2027-06-30"` godtas. Ingen rad og ingen loggrad når valideringen stopper.

## 2. Kontorer, `src/core/organization/offices.test.ts` (utvides)

1. **createOffice og updateOffice** lagrer navn, adresse og rekkefølge; `updateOffice` øker `row_version`.
2. **tilgang per rolle**, **uten roller**, **sluttet admin**: som 1.3–1.4.
3. **tenant-isolasjon:** ett `expectTenantIsolation` for `createOffice` og ett for `updateOffice`, samme mønster som 1.5–1.6.
4. **fremmed id, ugyldig id, tilfeldig uuid og slettet kontor:** `AccessDeniedError`, B-raden uendret.
5. **samme navn som et aktivt kontor** i egen organisasjon gir en feil (ikke 500 i skjermen; e2e 8.6 ser på meldingen), samme navn i en annen organisasjon er lov.
6. **revisjonslogg:** `create` og `update`, én rad hver.
7. **Zod:** tomt navn avvises; rekkefølge som ikke er et heltall avvises.

## 3. Ansatte, `src/core/organization/employees-admin.test.ts` (ny)

### 3.1 Tilgang per rolle

1. **Alle nye funksjoner** (`listEmployeesForAdmin`, `getEmployeeForAdmin`, `createEmployee`, `updateEmployee`, `setEmployeeRoles`, `deactivateEmployee`, `reactivateEmployee`) i en tabell, `it.each` over funksjon × `inspector`/`office`/`manager`: `AccessDeniedError`, og antall rader i `employees`, `employee_roles` og `audit_log` er uendret.
2. **ansatt uten roller og admin som har sluttet** får `AccessDeniedError` på de samme funksjonene.
3. **enkeltrettighet hjelper ikke:** en takstmann med `template.edit_structure` får fortsatt `AccessDeniedError` (rettigheten gir ikke `organization.manage`).

### 3.2 Tenant-isolasjon (ett `expectTenantIsolation` per funksjon, sju totalt)

1. **`listEmployeesForAdmin`:** vanlig lesing. `seed` lager en ansatt med selskap og kontor i A og B.
2. **`getEmployeeForAdmin`:** `query` henter den ansatte som hører til `organizationId` og returnerer `[row]`.
3. **`createEmployee`:** som 1.5 (`idOf: row.organizationId`). Unik e-post per kall (`${actor.id}@eksempel.no`).
4. **`updateEmployee`:** som 1.6 (stilling `Endret av ${actor.id}`); etterpå har B-raden adminB sin id og `row_version` 2.
5. **`setEmployeeRoles`:** `seed` lager en takstmann i A og B; `query` setter `["inspector", "office"]` og returnerer den ansatte. Etterpå: B-ansatt har nøyaktig én aktiv `office`-rad, og audit_log i B har nøyaktig én `role_change`.
6. **`deactivateEmployee`:** `seed` lager en takstmann i A og B (ikke admin, så regelen om siste admin slår ikke inn). Etterpå: én `deactivate` i B sin logg.
7. **`reactivateEmployee`:** `seed` lager en sluttet takstmann med `user_id` i A og B. Etterpå: én `reactivate` i B sin logg.

### 3.3 Fremmed id i egen organisasjon (regel 2)

1. **`it.each` over** `getEmployeeForAdmin`, `updateEmployee`, `setEmployeeRoles`, `deactivateEmployee`, `reactivateEmployee`, `grantEmployeePermission`, `revokeEmployeePermission`: admin A kaller med `orgA` og en ansatt-id fra B → `AccessDeniedError`. B-ansatt, roller og rettigheter er uendret (sammenlign raden før og etter), og ingen loggrad i A eller B.
2. **Samme tabell med `"ikke-en-id"` og en tilfeldig uuid:** `AccessDeniedError`, ingen databasefeil.
3. **Slettet ansatt** (`deleted_at`) i egen organisasjon: `AccessDeniedError` på alle skrivefunksjonene og `getEmployeeForAdmin`.

### 3.4 Selskap og kontor på ansatt

1. **`createEmployee` og `updateEmployee` med `companyId` fra B** avvises; ingen rad skrevet.
2. **Det samme med `officeId` fra B.**
3. **Slettet selskap og slettet kontor i egen organisasjon** avvises på begge funksjonene.
4. **Ugyldig id** (`"ikke-en-id"`) for selskap eller kontor avvises uten 500.
5. **Uten selskap og kontor (`null`) er lov** (positiv kontroll).

### 3.5 Ny ansatt og innlogging (A26)

1. **Ny e-post lager en ny innlogging:** `users` får én rad med e-posten i små bokstaver; den ansatte har `user_id` og rollene som ble gitt.
2. **«  Ola@Eksempel.NO » treffer eksisterende innlogging** `ola@eksempel.no`: ingen ny rad i `users`, den ansatte kobles til den, og navnet på innloggingen er uendret (selv om skjemaet har et annet navn).
3. **Duplikat i samme organisasjon** gir «Det finnes alt en ansatt med denne e-posten»; ingen ny rad i `employees`, `users` eller `audit_log`.
4. **Samme melding uansett** om e-posten finnes i en annen organisasjon: to tilfeller (bare i A / i A og B) gir lik `message`. Når e-posten bare finnes i B, lykkes opprettingen i A, og feilmeldinger eller svar nevner aldri B eller navnet på innloggingen.
5. **Duplikat også når den eksisterende ansatte har sluttet:** gir samme melding (unik indeks `(user_id, organization_id)`); admin skal bruke «Angre sluttet».
6. **Ingen e-post sendes:** `vi.spyOn` på `sendEmail` i `@/core/email` er ikke kalt etter `createEmployee`, og `readDevMailbox()` har like mange rader før og etter.
7. **Ny ansatt får tilgang med en gang:** `requireOrganizationAccess(nyActor, orgA, "assignment.read")` lykkes (actor bygget fra `users`-raden).
8. **E-post bare for admin:** `listEmployees` (uendret) gir ikke `email` (eksisterende test for nøklene står); `listEmployeesForAdmin` og `getEmployeeForAdmin` gir `email`, roller og enkeltrettigheter. Sammenlign `Object.keys(row).sort()` med en fast liste; ingen `userId` eller `organizationId` i svaret.
9. **Sluttet nederst:** `listEmployeesForAdmin` viser den som har sluttet etter de aktive, og viser ikke slettede.

### 3.6 Roller og enkeltrettigheter

1. **`setEmployeeRoles` legger til og tar bort:** fra `["inspector"]` til `["inspector", "manager"]` gir én ny rad; fra `["inspector", "manager"]` til `["manager"]` setter `deleted_at` på `inspector`-raden. Ingen rad slettes.
2. **Samme roller på nytt** gir ingen nye rader og ingen ny `deleted_at`.
3. **Effekt i neste tilgangssjekk:** etter at `manager` er tatt bort, gir `requireOrganizationAccess(…, "<rettighet bare leder har>")` `AccessDeniedError`; etter at `admin` er gitt, lykkes `organization.manage`. Enkeltrettighet gitt med `grantEmployeePermission` virker i neste kall og forsvinner etter `revokeEmployeePermission` (de eksisterende testene i `employee-permissions.test.ts` står).
4. **Zod:** ukjent rolle (`"superadmin"`) og tom streng avvises; rettighet som ikke kan gis (`"organization.manage"`) avvises av `grantEmployeePermission` (finnes, skal stå grønn).
5. **Myk sletting:** fjern–gi–fjern av samme rolle gir to rader med `deleted_at` og ingen aktiv. Antall rader i `employees` og `employee_roles` går aldri ned i noen test i filen (tell før og etter i `afterEach` er ikke nødvendig; testen her teller eksplisitt).

### 3.7 Sluttet og angre

1. **`deactivateEmployee`** setter `deactivated_at`; raden finnes fortsatt med `user_id`, roller og navn. `requireOrganizationAccess` for personen gir `AccessDeniedError` i neste kall. `users`-raden og øktene er uendret.
2. **`reactivateEmployee`** nullstiller `deactivated_at`; `requireOrganizationAccess` virker igjen.
3. **`reactivateEmployee` uten `user_id`** (sluttet uten innlogging, satt inn direkte) avvises; raden er uendret.
4. **`deactivateEmployee` på en som alt har sluttet** gir ingen ny loggrad (eller en tydelig feil; utvikler velger, testen sjekker at `deactivated_at` ikke endres).
5. **Den som har sluttet, står fortsatt i `listEmployeesForAdmin`** og i `listEmployees` med `includeDeactivated: true`.

### 3.8 Admin stenges aldri ute (A25). Testene skal aldri fjernes; kommentar øverst i blokken sier det.

1. **Siste admin, `setEmployeeRoles(…, [])`** avvises med «Organisasjonen må ha minst én admin.»; rollen er fortsatt aktiv.
2. **Siste admin, `setEmployeeRoles(…, ["inspector"])`** avvises på samme måte.
3. **Admin kan ikke markere seg selv som sluttet** når han er siste admin; `deactivated_at` er fortsatt `null`.
4. **To aktive admin: det er lov å ta rollen fra én** (positiv kontroll), og etterpå avvises det å ta den fra den andre.
5. **Admin som har sluttet, regnes ikke med:** admin X sluttet, admin Y aktiv; å ta rollen fra Y avvises.
6. **Slettet admin regnes ikke med** (`deleted_at` på ansatt-raden). Det samme for en admin-rolle med `deleted_at`.
7. **Admin uten `user_id` regnes ikke med** (sluttet uten innlogging, satt inn direkte).
8. **Ingen loggrad når sjekken stopper:** antall rader i `audit_log` er uendret i 1–3 og 5–6.
9. **Samtidige endringer** (`Promise.all`, to admin, egne kall via felles pool). Hver variant kjøres i 5 runder med `resetDatabase` mellom, slik at et kappløp uten lås blir synlig:
   - a. admin A tar rollen fra B og B tar rollen fra A,
   - b. A og B markerer hverandre som sluttet,
   - c. A tar rollen fra B mens B markerer A som sluttet.
   Hver runde: nøyaktig ett kall lykkes, ett avvises med meldingen, og `activeAdminCount` er 1 etterpå.
10. **Lås før telling:** i gjennomgangen sjekker test-leder at `pg_advisory_xact_lock` er første setning i transaksjonen i `setEmployeeRoles` og `deactivateEmployee`, med nøkkel fra `grant.organizationId`.

### 3.9 Revisjonslogg og feillogg uten persontekst

1. **`it.each` over `create`, `update`, `role_change`, `permission_change`, `deactivate`, `reactivate`:** kjør handlingen på en ansatt med navn «Kari Testdatter», e-post `kari.testdatter@eksempel.no` og stilling «Testtakstmann». `JSON.stringify(changes)` inneholder ingen av de tre verdiene (sjekk også små bokstaver for e-posten). `action` har riktig navn, `entityId` er riktig id, `organizationId` er `grant.organizationId`.
2. **`update` lister navnene på feltene som er endret** (for eksempel `["jobTitle"]`), ikke verdiene.
3. **Feillogg:** en `createEmployee` som stoppes (duplikat e-post og ugyldig `companyId`) skriver ikke navn, e-post eller stilling til loggeren (`vi.spyOn` på loggeren i `@/shared` og på `console.*`). Gjelder bare hvis kjernen logger; ellers dekkes det av gjennomgangen av server actions (8.8).

## 4. Database og migrering

### `src/db/schema/organization-structure.test.ts` (utvides)

1. **Rolle kan gis på nytt etter myk sletting:** ny `employee_roles`-rad med samme `(employee_id, role)` godtas når den gamle har `deleted_at`.
2. **To aktive rader med samme rolle stoppes** (`rejects.toThrow`, navnet på indeksen `employee_roles_employee_id_role_idx` i meldingen).
3. **Indeksen er delvis:** spørring mot `pg_indexes` viser `WHERE (deleted_at IS NULL)` for `employee_roles_employee_id_role_idx`.

### Migrering

- Ny migrering med neste nummer, laget med `pnpm db:generate`; ingen eldre migrering endret (`git diff main -- drizzle/`).
- CI kjører migreringen to ganger. `pnpm db:seed` etter migreringen virker som før (eksisterende seed-tester grønne).
- `docs/05-domenemodell.md` 4.1 og ordlisten (avsnitt 8) er oppdatert (sjekkes i gjennomgangen).

## 5. Tilgangsmodulen

- `src/core/access/guards.test.ts` er uendret og grønn. Effekten av sluttet og fjernet rolle vises i 3.6.3 og 3.7.1–2.
- Ingen nye rettigheter (`git diff main -- src/core/access` viser bare det som trengs for menypunktet, eller ingenting).
- Testen «admin stenges aldri ute» fra PR #50 står uendret.

## 6. Regeltester

Ingen fagregler eller TG-logikk. Valideringsreglene er skrevet som testsaker i data (`it.each`): org.nr. (1.10), dato (1.10), roller og rettigheter (3.6.4), e-post (`"ola"`, `"ola@"`, `"@eksempel.no"`, `""` avvises; `"  Ola@Eksempel.NO "` godtas og blir `ola@eksempel.no`), tomt navn (1.10, 2.7, og for ansatt). Eksisterende regeltester skal være grønne.

## 7. Skjermene: tilgang (i e2e, se 8)

Menyen er ikke vern. Hver side og hver server action må gjøre tilgangssjekken selv. Det vises i e2e (8.4–8.5) og sjekkes i gjennomgangen (8.8).

## 8. e2e, `e2e/fase-0b-admin.spec.ts` (prosjektene `pc` og `ipad`)

Unike data per kjøring: ending `Date.now().toString(36)` + tilfeldig tall. E-post `ansatt-<ending>@eksempel.no`, navn «Testansatt <ending>», kontor «Testkontor <ending>», org.nr. tilfeldig 9 siffer som begynner på `0` (org.nr. og kontornavn er unike blant aktive, og e2e-databasen tømmes ikke mellom kjøringer). **Seed-admin markeres aldri som sluttet og mister aldri rollen i e2e.** Siste-admin-regelen prøves derfor bare i databasetestene (3.8), ikke i e2e.

1. **Selskap:** admin går Admin → Selskaper → «Nytt selskap», fyller alle feltene (med firmatekst og ansvarsforsikring), lagrer, ser selskapet i listen med org.nr. og «gyldig til». «Endre» → endrer polisenummer → lagrer → ny verdi vises.
2. **Kontor:** «Nytt kontor» med navn, adresse og rekkefølge; «Endre» endrer adressen.
3. **Ny ansatt til innlogging og sluttet** (én test, i rekkefølge):
   - admin lager en ansatt med selskapet og kontoret fra 1–2 og rollen takstmann. Antall rader i `/dev/epost` er uendret etter «Lagre» (ingen invitasjon).
   - i en ny nettleserkontekst logger den ansatte inn med koden fra utviklingspostkassen (`signInWithCode`), havner på `/arbeidskoe` og ser **ikke** menypunktet «Admin».
   - admin åpner `/admin/ansatte/[id]` og trykker «Har sluttet»; listen viser personen nederst, merket «Sluttet».
   - den ansattes åpne økt laster neste side og ser «Ingen tilgang» (eller ingen organisasjon), ingen arbeidskø-data.
   - admin trykker «Angre sluttet»; den ansattes neste side virker igjen.
4. **Takstmann får ingen data** (`logInAsInspector`): ingen «Admin» i menyen; `/admin`, `/admin/selskaper`, `/admin/kontorer`, `/admin/ansatte` og `/admin/ansatte/<id til seed-admin>` gir «Ingen tilgang» eller 404, og `page.content()` inneholder verken `ADMIN_EMAIL`, `INSPECTOR_EMAIL` eller org.nr. fra test 1.
5. **Ugyldig og ukjent id:** `/admin/ansatte/ikke-en-id` og `/admin/ansatte/<tilfeldig uuid>` gir «Ingen tilgang» eller 404 for admin, og svarstatusen er aldri 500.
6. **Feilmeldinger ved feltet:** org.nr. med 8 siffer, ugyldig e-post og tomt navn gir de norske meldingene fra kortet ved riktig felt (`aria-describedby` eller `aria-invalid` på feltet); ingenting lagres.
7. **iPad-størrelse:**
   - i prosjektet `ipad`: «Lagre» i skjemaene og «Har sluttet» er minst 44x44 px; menypunktet «Admin» og «Ny ansatt» likeså.
   - ett skjema (nytt kontor) fylles ut og sendes med tastaturet alene (Tab og Enter), og kontoret står i listen etterpå.
   - iPad stående (834x1194, egen `describe` som bare kjører i `ipad`-prosjektet; jf. lite funn fra PR #51): ansattlisten og ansattskjemaet har ingen vannrett rulling (`scrollWidth <= clientWidth`).
8. **Gjennomgang (ikke automatisk test):** hver side i `/admin` gjør tilgangssjekken før data hentes; hver server action henter organisasjons-id-en på serveren (`listOrganizationsForActor` + tilgangssjekk), aldri fra et skjult felt, og kaller bare `src/core/organization`; ingen `organizationId` i skjemaene; feillogging i actions skriver bare feilkode og id-er.

**Uten nett:** ikke aktuelt. Adminområdet krever nett og er ikke en del av synken. Ingen e2e uten nett; eksisterende e2e for testskjemaet uten nett skal være grønne.

## 9. Kjøres før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (prosjektene `pc` og `ipad`). Versjonen i `package.json` er økt (patch). Ingen ny avhengighet (`git diff main -- package.json pnpm-lock.yaml`).

## Godkjennes ikke uten

- `expectTenantIsolation` for hver ny funksjon: `createCompany`, `updateCompany`, `createOffice`, `updateOffice`, `listEmployeesForAdmin`, `getEmployeeForAdmin`, `createEmployee`, `updateEmployee`, `setEmployeeRoles`, `deactivateEmployee`, `reactivateEmployee` (11 totalt),
- rolletesten (takstmann, kontor, leder, uten roller, sluttet admin) for hver ny funksjon,
- testene for fremmed id (3.3) og fremmed eller slettet selskap og kontor (3.4),
- alle testene i 3.8 (siste admin, også samtidige endringer) med kommentaren om at de aldri skal fjernes,
- testene for revisjonslogg uten persontekst (3.9.1),
- testen for at ingen e-post sendes (3.5.6),
- e2e 3 og 4 i begge prosjektene.

## Merknader til kortet (små)

- Kortet sier både «`AccessDeniedError` (eller ikke funnet)». Testplanen krever `AccessDeniedError` i kjernen for fremmed, ukjent, slettet og ugyldig id, som i PR #50. Det er enklest og gir samme svar i alle tilfeller.
- Kortet sier ikke om admin kan markere seg selv som sluttet når det finnes en annen aktiv admin. Testplanen tester bare tilfellet siste admin (3.8.3). Ingen ny regel.
- E2e-databasen tømmes ikke. Selskaper, kontorer og ansatte fra e2e blir liggende i seed-organisasjonen. Lite, men listene vokser per kjøring; ingen sletting, i tråd med regel 3.
