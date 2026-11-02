# Testplan: Test av tenant-isolasjon for alle nye tabeller

- **Oppgavekort:** `docs/agenter/oppgaver/fase0b-tenant-test-alle-tabeller.md`
- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Branch:** `fase0b-tenant-test-alle-tabeller` (bygger på `main`)
- **Laget av:** test-leder, 02.11.2026 (før koding, etter runde 1)
- **Støtter hovedmål:** Reklamasjoner: en lekkasje mellom organisasjoner er den alvorligste feilen systemet kan ha. Én samlet test beviser isolasjon for hver tabell med `organization_id`, og vakten gjør at en ny tabell aldri kommer inn uten slik test. Tid og KI først: ikke direkte (testverktøy for utviklerne).

## Hva som skal vises

1. **Alle tabeller med `organization_id` er isolert**, bevist med `expectTenantIsolation` per tabell (A ser bare A, B ser bare B, fremmed id gir `AccessDeniedError` begge veier, også for admin). Listen kommer fra Drizzle-skjemaet, ikke fra en håndskrevet liste. I dag 13 tabeller (`baseColumns`); tallet skal regnes ut i testen, ikke hardkodes som 13.
2. **Tabellene uten `organization_id` er nøyaktig de seks kjente** (`accounts`, `login_attempts`, `organizations`, `sessions`, `users`, `verifications`). En ny global tabell gir rød test til den er ført opp bevisst.
3. **Vakten `checkTenantRegistry`** er en ren funksjon som er grønn mot det ekte registeret og de ekte filene, og rød i hvert av tilfellene (a), (b), (c) og (e) fra kortet. Den kan ikke omgås med en fil under `tests/`, en fil som ikke er `.test.ts`, eller en `.dev.test.ts`.
4. **Radbyggerne** legger raden i oppgitt organisasjon, bruker bare oppdiktede og ufarlige verdier, og en tabell uten radbygger gir norsk feilmelding med tabellnavnet.

Fast oppsett: `resetDatabase` i `beforeEach` for sakene mot databasen. `fileParallelism: false` i `vitest.config.ts` gjør at samletesten ikke kolliderer med de andre databasetestene.

## 1. Enhetstester uten database: `tests/tenant-isolation-all-tables.test.ts`

Tabellene hentes slik: `import * as schema from "@/db/schema"`, `Object.values(schema)` filtrert med `is(value, PgTable)` fra `drizzle-orm` (skjemaet eksporterer også typer og hjelpere), `getTableName` for databasenavnet og `getTableColumns` for å finne kolonnen med `name === "organization_id"`. Bruk alltid databasenavnet (`employee_roles`, ikke eksportnavnet `employeeRoleAssignments`).

| # | Testnavn | Hva den viser |
|---|---|---|
| U1 | «finner alle tabeller med organization_id fra skjemaet» | Listen er ikke tom, har ingen dobbelte navn, og alle tabellene i listen har kolonnen `organization_id` med `notNull`. Lengden skal være lik `RESET_TABLES.length - 6` (fra `tests/factories.ts`), så tallet regnes ut og ikke hardkodes. Ekstra sjekk: listen inneholder `employee_roles` og `files` (to navn som er lett å ta feil av). |
| U2 | «tabellene uten organization_id er nøyaktig de seks kjente» | Sortert liste sammenlignet med `toEqual(["accounts", "login_attempts", "organizations", "sessions", "users", "verifications"])`. Biter når en ny tabell uten kolonnen kommer inn uten å være ført opp. |
| U3 | «vakten er grønn mot det ekte registeret og de ekte filene» | `checkTenantRegistry({ tables: <fra U1>, registry: tenantTables, readText })` der `readText` bruker `readFileSync(path.resolve(process.cwd(), p), "utf8")` og gir `null` ved `ENOENT` (samme mønster som `sync-token.test.ts`). Forvent `toEqual([])`. Feilmeldingene i listen skal stå i påstanden, så en rød test sier hva som mangler. |
| U4 | «vakten er rød når en tabell mangler i registeret» | `tables: ["a", "b"]`, registeret har bare `a`. Én melding som nevner `b` og `tests/tenant-tables.ts`. |
| U5 | «vakten er rød når registeret nevner en tabell som ikke finnes» | Registeret har `x`, `tables` har ikke `x`. Meldingen nevner `x`. |
| U6 | «vakten er rød når testFile ikke finnes» | `readText` gir `null` for `src/core/x/x.test.ts`. Meldingen nevner tabellen og filstien. |
| U7 | «vakten er rød når testFile mangler expectTenantIsolation(» | `readText` gir en tekst uten `expectTenantIsolation(`. Også en variant der teksten bare har `expectTenantIsolation` uten parentes (for eksempel i en import eller kommentar): skal være rød. |
| U8 | «vakten er rød når testFile er null uten reason» | `testFile: null`, ingen `reason` (og en variant med `reason: ""`, tom tekst er ikke en begrunnelse). Grønn når `reason` har innhold. |
| U10 | «vakten er rød når testFile peker utenfor src/ eller har feil endelse» | Tre varianter i `it.each`: `tests/tenant-isolation.test.ts` (under `tests/`, inneholder teksten), `src/core/x/x.ts` (ikke `.test.ts`), `src/core/x/x.dev.test.ts` (`.dev.test.ts`). `readText` gir en tekst **med** `expectTenantIsolation(` i alle tre, så det er stien som felles, ikke innholdet. Beviser at vakten ikke kan omgås. |
| U12 | «events står med testFile null og begrunnelse» | Oppslag i `tenantTables`: `table === "events"` har `testFile === null` og `reason` som ikke er tom. Og: ingen **annen** tabell har `testFile: null` i dag (så nye `null`-oppføringer må være bevisste). |
| U13 | «hver oppføring i registeret peker på hovedtestfilen for modulen» | For alle oppføringer med `testFile`: stien slutter ikke på `admin-core.test.ts` eller `integrations.dev.test.ts` (begge er ført for fjerning i liten oppgave (m) og (p)). Enkel liste i testen, ikke en regel i vakten. |

U9 og U11 fra første utkast faller bort (avgjørelse 4 i kortet).

## 2. Integrasjonstester mot testdatabasen: samme fil

Den generiske lesespørringen defineres i testfilen, ikke i `src/`:

```ts
async function readRows(table: PgTable, actor: Actor, organizationId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId); // organization.read
  return db.select({ id: table.id }).from(table).where(eq(table.organizationId, grant.organizationId));
}
```

Filteret skal bruke `grant.organizationId`, aldri parameteren. Test-leder kontrollerer dette ved lesing.

| # | Testnavn | Hva den viser |
|---|---|---|
| I1–I13 | «isolasjon: <databasenavn>» (`it.each` over tabellene fra U1) | `expectTenantIsolation({ seed, query, idOf })` der `seed` kaller `insertMinimalRow(name, grantA.organizationId)` og `insertMinimalRow(name, grantB.organizationId)` og returnerer id-ene, `query` er `readRows` for tabellen, `idOf` er `row.id`. Én bestått sak per tabell, med databasenavnet i saksnavnet, slik at `pnpm test` viser `isolasjon: employee_roles` osv. |
| I14 | «radbygger for ukjent tabell feiler med tabellnavnet i meldingen» | `insertMinimalRow("finnes_ikke", orgId)` avvises med melding som matcher `/finnes_ikke/` og `/tests\/tenant-tables\.ts/`. |
| I15 | «radbyggeren legger raden i oppgitt organisasjon» (`it.each` over tabellene) | Opprett organisasjon, kall `insertMinimalRow(name, org.id)`, les raden direkte med `db.select` på id og sjekk `organization_id === org.id` og `deleted_at === null`. Viser at radbyggeren ikke lykkes ved en tilfeldighet (for eksempel ved å legge raden i en seed-organisasjon). |
| I16 | «radbyggeren lager foreldre-rader i samme organisasjon» | For `certifications`, `employee_roles`, `employee_permissions`, `trial_answers` og `trial_photos`: foreldre-raden (`employees` / `trial_forms`) som raden peker på, har samme `organization_id`. Fanger en radbygger som gjenbruker en foreldre-rad fra feil organisasjon. Kan slås sammen med I15 hvis det blir enklere. |

## 3. Krav til registeret `tests/tenant-tables.ts` (leses av test-leder, ikke egne tester)

| Tabell | Forventet `testFile` | Foreldre-rader radbyggeren må lage |
|---|---|---|
| `audit_log` | `src/core/audit/audit.test.ts` | ingen |
| `certifications` | `src/core/organization/certifications.test.ts` | bruker, `employees` |
| `companies` | `src/core/organization/companies.test.ts` | ingen |
| `employee_permissions` | `src/core/organization/employee-permissions.test.ts` | bruker, `employees` |
| `employee_roles` | `src/core/organization/employees-admin.test.ts` | bruker, `employees` |
| `employees` | `src/core/organization/employees.test.ts` | bruker |
| `events` | `null` med `reason` (ingen lesespørring i produktkoden; testfil føres opp ved første) | ingen |
| `files` | `src/core/files/files.service.test.ts` | ingen (oppdiktet `storage_key` og sjekksum, `retain_until` null, ingen skriving til disk) |
| `integration_connections` | `src/core/integrations/connections.test.ts` | ingen (port `email`, leverandør `server_log`, tomme `settings`) |
| `offices` | `src/core/organization/offices.test.ts` | ingen |
| `trial_answers` | `src/modules/offline-trial/server/trial-queries.test.ts` (eller `changes-since.test.ts`) | `trial_forms` |
| `trial_forms` | `src/modules/offline-trial/server/trial-queries.test.ts` | ingen |
| `trial_photos` | `src/modules/offline-trial/server/photo-storage.test.ts` | `trial_forms` |

Alle verdier oppdiktede: ingen ekte navn, e-poster, org.nr. eller adresser; ingen fagtekst; ingenting som ligner `clientId`/`clientSecret`. Fabrikkene i `tests/factories.ts` brukes der de finnes (`createUser`, `createEmployee`, `createCompany`, `createOffice`, `createFile`, `createIntegrationConnection`, `createCertification`, `grantPermission`).

## 4. Obligatorisk (alltid med)

| # | Hva | Hvordan |
|---|---|---|
| O1 | **Tilgang per rolle** | Ingen ny produktfunksjon eller skjerm. `expectTenantIsolation` viser at en bruker uten ansattrad i organisasjonen nektes (fremmed id). Rollematrisen beviser `src/core/access/guards.test.ts` som før (uendret). |
| O2 | **Tenant-isolasjon** | Dette **er** oppgaven: I1–I13. I tillegg: eksisterende tenant-tester i modulene skal stå uendret (`git diff main --stat` viser ingen endring i `src/**/*.test.ts`). |
| O3 | **Admin stenges aldri ute** | `expectTenantIsolation` bruker admin i begge organisasjonene; A ser alle egne rader. Ingen sak skal vise at admin nektes i egen organisasjon. |
| O4 | **Myk sletting** | Radene legges inn med `deleted_at = null` (I15 sjekker det). Ingen egen slettetest; den generiske spørringen filtrerer ikke på `deleted_at`, og det er bevisst (den beviser organisasjonsfilteret, ikke modulenes spørringer). |
| O5 | **Ingen produktkode** | `git diff main -- src/` viser ingen endring (eventuelt bare kommentarer). Ingen migrering. |
| O6 | **Ingen ny avhengighet** | `git diff main -- package.json pnpm-lock.yaml` viser bare versjon 0.2.53 → 0.2.54. |
| O7 | **Dokumentasjon** | Én setning i `CLAUDE.md` under «Tilgang» om `tests/tenant-tables.ts`; punktet krysset av i `docs/07-utviklingsplan.md` fase 0b. |
| O8 | **Brand og modulgrenser** | `pnpm lint` grønn. Testfilene under `tests/` importerer fra `@/db/schema`, `@/core/access` og `tests/`; aldri fra en modul. |

## 5. Regeltester (regler som data)

Ingen. Ingen regler eller TG-logikk i oppgaven.

## 6. E2E (PC og iPad-størrelse, uten nett)

Ingen nye. Ingen skjerm endres, ingenting uten nett. `pnpm test:e2e` kjøres likevel til slutt (begge prosjekter) for å vise at ingenting er brukket.

## 7. Kontroll av at testene biter (test-leder gjør det lokalt, ikke i PR-en)

- Legg til en oppdiktet tabell med `organization_id` i et skjema (lokalt, uten migrering): U1/U3 og I1–I13 skal bli røde med meldingen `mangler radbygger for tabellen <navn> (legg den til i tests/tenant-tables.ts)` og vaktmeldingen for (a).
- Bytt `where`-filteret i `readRows` til parameteren `organizationId` i stedet for `grant.organizationId`: alle 13 skal fortsatt være grønne (tilgangssjekken nekter fremmed id først). Dette er forventet; derfor skal test-leder lese at filteret bruker `grant.organizationId`, ikke stole på rødt.
- Fjern `where` helt: alle 13 røde med «Lekkasje: …».
- Fjern `expectTenantIsolation(` fra `src/core/organization/offices.test.ts` midlertidig: U3 rød og nevner `offices`.
- Sett `testFile` for `files` til `tests/tenant-isolation.test.ts`: U3 rød (ikke bare U10).

## 8. Akseptkriterier mot tester

| Akseptkriterium | Tester |
|---|---|
| Tabellene finnes fra Drizzle-skjemaet, én bestått sak per tabell, navngitt `isolasjon: <databasenavn>` | U1, I1–I13 |
| A ser bare A, B ser bare B, fremmed id gir `AccessDeniedError` begge veier | I1–I13 (via `expectTenantIsolation`) |
| De seks globale tabellene er nøyaktig de kjente, sortert, `toEqual` | U2 |
| Radbyggeren legger raden i oppgitt organisasjon; ukjent tabell gir rød test med tabellnavn og `tests/tenant-tables.ts` | I14, I15, I16 |
| `checkTenantRegistry` er ren og rød i (a), (b), (c), (e); kan ikke omgås med fil under `tests/` | U4–U8, U10 |
| `events` har `testFile: null` med begrunnelse; vakten grønn mot ekte register og filer | U3, U12 |
| Ingen endring i `src/`, ingen ny avhengighet | O5, O6 |
| Bruker i annen organisasjon får ikke tilgang | I1–I13 |
| Lint, typesjekk, test og e2e grønne | sluttkjøring |
| iPad-størrelse | ikke relevant, ingen skjerm |

## 9. Sluttkjøring og godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Utskriften fra `pnpm test` skal vise `tests/tenant-isolation-all-tables.test.ts` med 13 saker `isolasjon: …`, 13 saker I15 (og I16), I14, og U1–U13 (uten U9 og U11).

Godkjennes ikke hvis: en tabell med `organization_id` mangler sak, U10 ikke har alle tre variantene, `readRows` filtrerer på parameteren, radbyggerne har noe som ligner ekte data eller hemmeligheter, registeret peker på `admin-core.test.ts` eller `integrations.dev.test.ts`, eller noe er endret i `src/` utenom kommentarer.
