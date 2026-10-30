# Testplan: Organisasjon → selskap → kontor → ansatt

- **Oppgavekort:** `docs/funksjoner/fase0b-organisasjon-selskap-kontor.md`
- **Dato:** 30.10.2026
- **Støtter hovedmål:** reklamasjoner (riktig selskap og forsikring hentes fra data, ansatte som har sluttet står riktig på gamle rapporter) og tid (bunntekst og side 2 fylles ut automatisk senere).

Alle tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: org.nr. `000000001`–`000000009`, «Testforsikring», «Testselskap A AS», «Testkontor Nord». Ingen ekte navn, e-poster eller org.nr.

## Avtale om signaturer (utvikler og testskriver)

- `listCompanies(actor, organizationId)`, `listOffices(actor, organizationId)`, `listEmployees(actor, organizationId, { includeDeactivated }?)` fra `@/core/organization`.
- Fabrikker i `tests/factories.ts`:
  - `createCompany(organizationId, overrides?)` og `createOffice(organizationId, overrides?)`. Gir raden tilbake.
  - `createEmployee(actor, organizationId, roles, options?)` der `options` er `{ companyId?, officeId? }`. Dagens kall uten fjerde argument virker uendret.
- Ansatt uten innlogging (sluttet) settes inn direkte med `db.insert(employees)` i testen (`userId: null`, `deactivatedAt` satt). Ingen egen fabrikk.
- Myk sletting i testene: `db.update(...).set({ deletedAt: new Date() })`. Ingen skrivefunksjoner i `src/core/organization`.

## 1. Spørringer

### `src/core/organization/companies.test.ts`

- **tenant-isolasjon:** ett kall til `expectTenantIsolation` med `seed` som lager ett selskap i hver organisasjon og `query: listCompanies`.
- **tilgang per rolle** (`it.each` over `inspector`, `office`, `manager`, `admin`): alle kan lese og får selskapet.
- **ansatt uten roller får `AccessDeniedError`.**
- **ansatt som har sluttet (`deactivated_at`) får `AccessDeniedError`** (viser at spørringen går gjennom tilgangssjekken; selve regelen er dekket i `guards.test.ts`).
- **slettet selskap vises ikke.**
- **sorterer på navn:** tre selskaper satt inn i feil rekkefølge kommer ut alfabetisk.

### `src/core/organization/offices.test.ts`

- **tenant-isolasjon:** ett kall til `expectTenantIsolation` med `query: listOffices`.
- **tilgang per rolle** (`it.each` som over) og **ansatt uten roller får `AccessDeniedError`**.
- **slettet kontor vises ikke.**
- **sorterer på `sort_order`, så navn:** kontor med `sort_order` 2, og to kontorer med `sort_order` 1 («Bkontor», «Akontor») gir rekkefølgen Akontor, Bkontor, så det med 2.

### `src/core/organization/employees.test.ts`

- **tenant-isolasjon:** ett kall til `expectTenantIsolation` med `query: listEmployees`. `seed` lager en ansatt med selskap og kontor i hver organisasjon og gir tilbake id-ene (adminene fra hjelperen kan også stå i svaret).
- **tilgang per rolle** (`it.each` som over) og **ansatt uten roller får `AccessDeniedError`**.
- **feltene er nøyaktig de lovede:** `Object.keys(row).sort()` er lik `["companyName", "deactivatedAt", "id", "jobTitle", "name", "officeName"]`. Ingen `email`, `userId` eller `organizationId`.
- **viser selskaps- og kontornavn** for en ansatt med selskap og kontor, og `null` for en ansatt uten (admin fra seed-mønsteret).
- **slettet ansatt vises ikke**, heller ikke med `includeDeactivated: true`.
- **slettet selskap gir tomt selskapsnavn, slettet kontor gir tomt kontornavn**; den ansatte vises fortsatt.
- **uten valg vises ikke den som har sluttet;** med `includeDeactivated: true` vises både en som har sluttet med innlogging og en som har sluttet uten innlogging (`userId: null`).
- **filtrerer på organisasjonen fra tilgangssjekken:** i tillegg til tenant-hjelperen sjekker gjennomgangen at koden bruker `grant.organizationId` i `where` og i join-betingelsene (gjelder alle tre filene).

## 2. Databaseregler, `src/db/schema/organization-structure.test.ts`

Feil fra databasen fanges med `rejects.toThrow()`; testen sjekker gjerne navnet på sjekken eller indeksen i feilmeldingen, så feilen ikke skyldes noe annet.

- **sluttet uten innlogging (D18):** `userId: null` uten `deactivatedAt` avvises; `userId: null` med `deactivatedAt` godtas.
- **selskap fra annen organisasjon:** innsetting av ansatt i A med `companyId` fra B avvises; oppdatering av en gyldig ansatt i A til `companyId` fra B avvises.
- **kontor fra annen organisasjon:** samme to tilfeller for `officeId`.
- **selskap og kontor fra egen organisasjon godtas** (positiv kontroll for fremmednøklene).
- **org.nr. unikt per organisasjon blant aktive:** to aktive med `000000001` i A avvises; lov når det første er slettet; lov med samme nummer i A og B.
- **kontornavn unikt per organisasjon blant aktive:** samme tre tilfeller for `name`.
- **org.nr.-format** (regeltest som data, `it.each`): avvises `"12345678"`, `"1234567890"`, `"12345678A"`, `"123 456 789"`; godtas `null` og `"000000001"`.
- **standardverdier:** `vat_registered` er `true` og `sort_order` er `0` når de ikke er oppgitt.

## 3. Seed, `src/db/seed/run.test.ts` (utvidet)

- **fire selskaper og fem kontorer etter første kjøring, ingen nye etter andre kjøring** (tell rader; navnene som i domenemodellen 4.1).
- **seed fyller ikke ut org.nr., adresse, forsikring eller firmatekst** (alle `null`, beslutning A13).
- **slettet selskap lages ikke på nytt:** seed, myk-slett «Byggcon Troms AS», seed igjen: fortsatt fire rader totalt og ingen aktiv «Byggcon Troms AS».
- **admin får ikke selskap eller kontor:** `companyId` og `officeId` er `null` på adminens ansatt-rad.
- Eksisterende tester («to ganger uten duplikater», «skriver aldri e-postadressen i loggen») skal være grønne uendret.

## 4. Tilgang for den som har sluttet

Ingen ny test. Dekkes av `src/core/access/guards.test.ts`: «nekter når den ansatte er fjernet (myk sletting) eller har sluttet» og «nekter noen som ikke er ansatt, ukjent id og ugyldig id». `findGrant` endres ikke. Testen «følger rettighetsmatrisen» viser at admin fortsatt har `organization.read` og `organization.manage`, så admin stenges ikke ute.

## 5. Fabrikker og eksisterende tester

- `resetDatabase` tømmer `companies` og `offices` (vises indirekte: hver testfil over starter tom; ingen egen test).
- Alle dagens tester som bruker `createEmployee` og `expectTenantIsolation`, er grønne uten endring.

## 6. Migrering

- CI kjører `pnpm db:migrate` to ganger i testjobben (lest i `.github/workflows/ci.yml` i gjennomgangen).
- Utvikler viser i PR-en at `pnpm db:migrate` er kjørt to ganger på utviklingsdatabasen etter `pnpm db:seed` (admin uten selskap, med `user_id`, så den nye sjekken holder).
- Den nye migreringen har neste nummer etter `0003`; ingen eldre migrering er endret (`git diff main -- drizzle/` viser bare nye filer og journalen).

## 7. Regeltester

Ingen fagregler eller TG-logikk i oppgaven. Org.nr.-formatet over er skrevet som testsaker i data. Eksisterende regeltester skal være grønne.

## 8. e2e (PC og iPad-størrelse)

Ingen nye e2e, fordi ingenting vises. iPad-størrelse og uten nett prøves når admin-skjermene lages. `pnpm test:e2e` kjøres i sin helhet og skal være grønn (prosjektene `pc` og `ipad`).

## 9. Kjøres før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Versjonen i `package.json` er økt (patch). Ingen ny avhengighet.

## Godkjennes ikke uten

- ett `expectTenantIsolation` per spørring (tre totalt),
- rolletest og avvisning uten roller for hver av de tre spørringene,
- testene for sammensatte fremmednøkler ved både innsetting og oppdatering,
- sammenligning av nøklene i svaret fra `listEmployees`.

## Merknad

`docs/agenter/tilstand.md` nevner `phone` på `employees`, men oppgavekortet har tatt den ut (forenkler, 30.10.2026). Kortet gjelder; tilstandsfilen bør rettes av prosjektlederen. Lite funn.
