# Testplan: Roller og rettigheter i én felles tilgangsmodul

- **Oppgavekort:** `docs/funksjoner/fase0b-roller-rettigheter.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (bare de som skal, kan publisere, endre systemmalen og se reklamasjonssaker; tilgangen er testet ett sted per rolle) og tid (takstmenn endrer alt fra start, innstramming er én innstilling uten ny kode). KI først: testene låser at `report.publish` krever en person med rettigheten, slik at KI aldri kan publisere selv.

Alle databasetester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet (navn som «Test Takstmann», e-post `<uuid>@example.com`). Ingen ekte navn, e-poster eller org.nr.

## Avtale om signaturer (utvikler og testskriver)

Testskriver bygger på disse navnene. Endres de, meldes det før testene skrives om.

- `src/core/access/permissions.ts`:
  - `permissions` (ni koder, i rekkefølgen i kortet), `type Permission`.
  - `grantablePermissions` = `["template.edit_structure", "assignment.edit", "report.edit", "report.publish"]`.
  - `effectivePermissions(roles: readonly EmployeeRole[], grantedPermissions: readonly string[], settings: { inspectorsEditAll: boolean }): readonly Permission[]`. Ren funksjon, ingen database.
  - `readInspectorsEditAll(organizationId: string, settings: unknown): boolean` (eller tilsvarende navn i `src/core/access`): tolker `organizations.settings` og logger advarsel ved ugyldig verdi. Eksporteres for enhetstest; brukes av `guards.ts`.
  - `grantHasPermission(grant, permission): boolean`, `isAdmin(grant)`.
  - `EmployeeGrant` får `permissions: readonly Permission[]`.
- `@/core/access` eksporterer **ikke** `rolesHavePermission` lenger.
- `src/core/organization/employee-permissions.ts`, eksportert fra `@/core/organization`:
  - `grantEmployeePermission(actor, organizationId, employeeId, permission)` gir tilbake den aktive raden.
  - `revokeEmployeePermission(actor, organizationId, employeeId, permission)` gir tilbake `void` (eller den slettede raden; testene sjekker bare databasen).
- `tests/factories.ts`: `grantPermission(employee, permission)` setter inn én rad i `employee_permissions` med `employee.organizationId`, og gir tilbake raden. Tar imot vilkårlig tekst (`string`), slik at testene kan sette inn ukjente og ikke-tillatte navn rett i databasen.
- Advarsel i loggen sjekkes med `vi.spyOn(logger, "warn")` fra `@/shared/lib/logger`.
- Innstillingen settes i testene med `db.update(organizations).set({ settings: { "access.inspectors_edit_all": false } })`.
- Myk sletting i testene: `db.update(employeePermissions).set({ deletedAt: new Date() })`.

## 1. Enhetstester uten database

### `src/core/access/permissions.test.ts`

Forventet matrise (fasit i testen, skrevet ut som tabell, ikke regnet ut fra koden):

| Rettighet | inspector på | inspector av | office | manager | admin |
|---|---|---|---|---|---|
| `organization.read` | ja | ja | ja | ja | ja |
| `organization.manage` | nei | nei | nei | nei | ja |
| `claims.read` | nei | nei | nei | ja | ja |
| `staff.manage` | nei | nei | nei | ja | ja |
| `assignment.edit` | ja | nei | ja | ja | ja |
| `report.edit` | ja | nei | nei | ja | ja |
| `report.publish` | ja | ja | nei | ja | ja |
| `template.edit_structure` | nei | nei | nei | nei | ja |
| `invoice.send` | ja | ja | ja | ja | ja |

Office, manager og admin er like med innstillingen på og av.

1. **`permissions` har nøyaktig de ni kodene** (`toEqual` på sortert liste). Viser at ingen kode er lagt til eller fjernet uten at testen endres (regel 6, faste koder).
2. **`grantablePermissions` er nøyaktig de fire** og er en delmengde av `permissions`. `organization.manage`, `staff.manage`, `claims.read`, `organization.read` og `invoice.send` står ikke der (A21).
3. **Tabelltest `it.each` over 4 roller × innstilling på/av × 9 rettigheter** (72 tilfeller) mot fasiten over, uten enkeltrettigheter. Viser hver rolle sin ja og nei.
4. **Innstillingen påvirker aldri `claims.read`, `organization.manage` eller `staff.manage`** for noen rolle (sammenligner på og av).
5. **Kontor har aldri `report.edit` eller `report.publish`**, med innstillingen på og av.
6. **Flere roller gir unionen:** `["inspector", "office"]` med innstillingen av gir `assignment.edit` (fra kontor), men ikke `report.edit`.
7. **Enkeltrettighet legges til:** leder med `["template.edit_structure"]` får den; uten får hun den ikke.
8. **Enkeltrettighet virker med innstillingen av:** takstmann med `["report.edit"]` og innstillingen av får `report.edit`, men ikke `assignment.edit`.
9. **Ingen roller, bare enkeltrettighet:** `effectivePermissions([], ["template.edit_structure"], …)` gir nøyaktig `["template.edit_structure"]`, ikke `organization.read`.
10. **Ikke-tillatte navn ignoreres (fail-closed):** `it.each` over `organization.manage`, `staff.manage`, `claims.read`, `organization.read`, `invoice.send` gitt til ansatt uten roller gir tom liste.
11. **Ukjente og rare navn ignoreres uten krasj:** `"report.delete"`, `""`, `"REPORT.EDIT"`, `" report.edit"` gir ingen ekstra rettighet.
12. **Ingen duplikater:** leder med `["report.edit"]` (som hun alt har) gir `report.edit` én gang.
13. **«Admin stenges aldri ute, skal aldri fjernes»:** admin har alle ni med innstillingen av, uten enkeltrettigheter, og med ukjente og ikke-tillatte navn i `grantedPermissions`. Sjekkes med `toEqual([...permissions].sort())`.
14. **Innstillingen tolkes riktig** (`readInspectorsEditAll`), `it.each`:
    - mangler nøkkelen, `settings` er `{}`, `null` eller ikke et objekt → `true`, ingen advarsel.
    - `true` → `true`, ingen advarsel.
    - `false` → `false`, ingen advarsel.
    - `null`, `"false"`, `0`, `1`, `{}`, `[]` som verdi → `true` og **én** advarsel.
15. **Advarselen har ingen persondata:** feltene i kallet til `logger.warn` er nøyaktig `organizationId` og nøkkelen (`Object.keys` sammenlignes). Ingen verdi, navn, e-post eller bruker-id.
16. **`grantHasPermission` og `isAdmin`** på et hånd-laget `EmployeeGrant`: `grantHasPermission` leser bare `grant.permissions`; `isAdmin` leser bare `grant.roles`.

## 2. Integrasjonstester mot testdatabasen

### `src/core/access/guards.test.ts` (utvides; eksisterende tester beholdes)

Eksisterende `toEqual` på grant oppdateres med `permissions`. Testen «en ansatt uten roller kan ingenting, heller ikke lese» beholdes uendret (uten enkeltrettigheter).

**Tilgang per rolle**
1. **Rettighetsmatrisen per rolle med innstillingen på** (`it.each` over 4 roller og 9 rettigheter): `requireOrganizationAccess` godtar eller kaster `AccessDeniedError` etter fasiten. Erstatter den gamle matrisetesten, som utvides.
2. **Samme med innstillingen av** (`settings: { "access.inspectors_edit_all": false }`): takstmann avvises på `assignment.edit` og `report.edit`, men godtas på `organization.read`, `report.publish` og `invoice.send`. De andre rollene er uendret.
3. **Innstillingen mangler** (standard `settings`): takstmann godtas på `assignment.edit` og `report.edit`.
4. **`grant.permissions` er lik `effectivePermissions`** for en takstmann med innstillingen av og enkeltrettigheten `report.edit` (viser at sjekken og feltet bruker samme utregning).

**Admin stenges aldri ute, skal aldri fjernes**
5. Innstillingen av, admin har bare slettede rader i `employee_permissions` (både tillatte og `organization.manage`): admin godtas på alle ni, `isAdmin(grant)` er sann og `grantHasPermission(grant, p)` er sann for alle.
6. Samme admin uten noen rader i `employee_permissions`: identisk resultat (viser at admin ikke avhenger av tabellen).

**Enkeltrettigheter**
7. **Virker i neste kall:** leder avvises på `template.edit_structure`; `grantPermission` gis; neste `requireOrganizationAccess` godtar.
8. **Forsvinner etter myk sletting:** raden får `deleted_at`; neste kall avvises.
9. **Rad med ukjent navn eller ikke-tillatt navn satt rett inn** (`grantPermission(takstmann, "organization.manage")`, `"claims.read"`, `"finnes.ikke"`): ingen krasj, ingen av dem gir tilgang.
10. **Ansatt uten roller med `template.edit_structure`:** `requireOrganizationAccess(bruker, org, "template.edit_structure")` godtas, `requireOrganizationAccess(bruker, org)` avvises (akseptkriteriet, én kodevei).
11. **Enkeltrettighet for slettet eller deaktivert ansatt gir ingen tilgang** (personen avvises før rettigheter leses).

**Tenant-isolasjon**
12. **Rettighet gitt i A virker ikke i B:** samme bruker er takstmann i A og B; `template.edit_structure` gis i A. A godtas, B avvises.
13. **Innstillingen av i B påvirker ikke A:** samme bruker takstmann i begge; `assignment.edit` godtas i A, avvises i B.
14. **Rad med feil organisasjon kan ikke settes inn:** innsetting i `employee_permissions` med `organization_id` = B og `employee_id` fra A avvises av databasen (sammensatt fremmednøkkel). Kalles i `expect(...).rejects`.
15. Eksisterende «nekter en ansatt i organisasjon A tilgang til organisasjon B» beholdes.

**Innstilling med ugyldig verdi**
16. `settings: { "access.inspectors_edit_all": "false" }`: takstmann godtas på `report.edit`, og `logger.warn` er kalt én gang med bare organisasjons-id og nøkkel. Ingen e-post, navn eller bruker-id i kallet (sjekkes med `JSON.stringify` mot brukerens e-post og navn).

### `src/core/organization/employee-permissions.test.ts` (ny)

**Tenant-isolasjon (regel 2, påkrevd)**
1. **`expectTenantIsolation` for `grantEmployeePermission`:** `seed` lager en takstmann i A og B og gir `template.edit_structure` med `grantEmployeePermission`; `query` gir samme rettighet igjen til den ansatte i organisasjonen den kalles mot, og returnerer `[rad]`. Viser at egen rad kommer tilbake (også idempotens), at fremmed rad aldri kommer, og at fremmed organisasjon gir `AccessDeniedError`.
2. **`expectTenantIsolation` for `revokeEmployeePermission`:** `seed` gir rettigheten i A og B; `query` tar den bort og leser så raden fra databasen med `grant.organizationId` (raden har `deleted_at`). Fremmed organisasjon gir `AccessDeniedError`, og radene i den andre organisasjonen er urørt (sjekkes etterpå: `deleted_at` er tom).
3. **Ansatt i en annen organisasjon avvises:** admin i A kaller med `organizationId` = A og `employeeId` fra B. `AccessDeniedError`, ingen rad og ingen revisjonslogg i noen organisasjon.

**Tilgang per rolle**
4. `it.each` over takstmann, kontor, leder og leder med enkeltrettigheten `template.edit_structure`: både gi og ta bort gir `AccessDeniedError`, og ingenting skrives.
5. Takstmann med enkeltrettigheten `organization.manage` satt rett inn i databasen avvises også (viser at A21 ikke kan omgås).
6. Admin kan gi og ta bort, også til en annen admin og til seg selv. Admin har fortsatt alle rettigheter etter å ha tatt bort noe fra seg selv (admin stenges aldri ute).

**Validering**
7. **Ikke-tillatt rettighet avvises med Zod:** `it.each` over `organization.manage`, `staff.manage`, `claims.read`, `organization.read`, `invoice.send`, `"finnes.ikke"`, `""`. Ingen rad, ingen revisjonslogg.
8. **Slettet ansatt avvises** (`deleted_at` satt) med `AccessDeniedError`.
9. **Deaktivert ansatt avvises** (`deactivated_at` satt) med `AccessDeniedError`.
10. **Ugyldig `employeeId`** (ikke uuid, ukjent uuid) gir `AccessDeniedError`, ikke databasefeil.

**Revisjonslogg**
11. **Gi:** én linje med `action: "permission_change"`, `organizationId` = `grant.organizationId`, `actorEmployeeId` = adminens ansatt-id, og `changes` er nøyaktig `{ permission, employeeId, granted: true }` (`toEqual`, ingen ekstra felt, ingen navn eller e-post).
12. **Ta bort:** samme med `revoked: true`.
13. **Samme transaksjon:** når innsettingen i revisjonsloggen feiler (for eksempel `vi.spyOn` på `recordAuditEvent` som kaster, eller tilsvarende), finnes heller ingen ny rad i `employee_permissions`. Testskriver velger metode som ikke endrer produktkoden.

**Idempotens og myk sletting**
14. **Gi to ganger:** samme rad-id tilbake, én aktiv rad, én linje i revisjonsloggen.
15. **To samtidige kall** (`Promise.all`): ingen feil, én aktiv rad, én linje i revisjonsloggen, begge får samme rad-id.
16. **Ta bort ikke-gitt:** ingen feil, ingen rad endret, ingen revisjonslogg.
17. **Ta bort to ganger:** andre kall gir ingen feil og ingen ny linje.
18. **Gi, ta bort, gi igjen:** to rader for samme ansatt og rettighet; den første har `deleted_at` og `deleted_by` satt, den andre er aktiv. Ingen rad er slettet permanent (antall rader øker, aldri synker).
19. **Effekt i neste tilgangssjekk:** etter gi godtar `requireOrganizationAccess` den ansatte på rettigheten; etter ta bort avvises den.

### `tests/factories.test.ts`

1. **`grantPermission` virker:** raden har den ansattes `organizationId` og `employeeId`, og `requireOrganizationAccess` godtar rettigheten etterpå.
2. **`resetDatabase` tømmer `employee_permissions`** (antall rader er 0 etter kall).

### Migrering og skjema

- Dekkes av `pnpm test` (global oppsett kjører migreringene) og av test 14 i `guards.test.ts` (sammensatt fremmednøkkel). Delvis unik indeks dekkes av test 15 i `employee-permissions.test.ts`. I tillegg: **direkte innsetting av to aktive like rader feiler** med unik-brudd, mens en aktiv og en slettet godtas (i `employee-permissions.test.ts`).

## 3. Regeltester

Ingen fagregler eller TG-logikk i denne oppgaven. Rettighetsmatrisen er kode, og den testes som data: fasittabellen i `permissions.test.ts` (seksjon 1) er en egen konstant i testen, ikke avledet av `permissionsByRole`.

## 4. E2e (Playwright, PC og iPad-størrelse)

Ingen ny e2e (ingen skjermer). Eksisterende `e2e/*.spec.ts` skal gå grønt i begge prosjektene `pc` og `ipad`. Særlig `fase-0a.spec.ts` (innlogging og organisasjonsside) og `fase-1-*.spec.ts` (bruker `requireOrganizationAccess` gjennom `offline-trial`), fordi `EmployeeGrant` endres og tilgangssjekken gjør én spørring til. Uten nett: ingen endring; testene for prøvene uten nett skal fortsatt gå.

## 5. Sjekker før godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- `rolesHavePermission` er ikke eksportert fra `src/core/access/index.ts`, og ingen fil utenfor `src/core/access` bruker den (`grep`).
- Spørringene i `guards.ts` mot `employee_role_assignments` og `employee_permissions` filtrerer på `employee_id`, `organization_id` fra den ansatt-raden og `deleted_at IS NULL`. Innstillingen leses i samme spørring som joiner `organizations`.
- `employee-permissions.ts` filtrerer bare på `grant.organizationId`, aldri på `organizationId`-argumentet etter tilgangssjekken.
- Ingen `delete from` mot `employee_permissions` i produktkoden.
- Ingen ny avhengighet i `package.json`; versjonen er økt (patch).
- Ingen persondata i testdata, logger eller revisjonslogg.

## Akseptkriterier og dekning

| Akseptkriterium | Tester |
|---|---|
| Rettighetene finnes, hver rolle testet på/av | permissions 1, 3; guards 1–3 |
| Innstillingen mangler gir på; `false` stenger bare endring for takstmann | permissions 3, 14; guards 2, 3 |
| Admin har alt i alle tilfeller (aldri fjernes) | permissions 13; guards 5, 6; employee-permissions 6 |
| Admin gir og tar bort, revisjonslogg, effekt i neste sjekk | employee-permissions 11, 12, 19; guards 7, 8 |
| Andre enn admin kan ikke; ikke-tillatte avvises (Zod) og gir ingen rettighet fra databasen | employee-permissions 4, 5, 7; permissions 10; guards 9 |
| Ansatt uten roller med `template.edit_structure` | permissions 9; guards 10 |
| Idempotens (også samtidig) og ta bort ikke-gitt | employee-permissions 14–17 |
| Slettet eller deaktivert ansatt avvises | employee-permissions 8, 9; guards 11 |
| Ugyldig innstilling gir på og advarsel uten persondata | permissions 14, 15; guards 16 |
| Tenant-isolasjon (`expectTenantIsolation` for gi og ta bort), A virker ikke i B | employee-permissions 1–3; guards 12–14 |
| Ingen slettet rad gir rettighet | guards 5, 8; employee-permissions 18 |
| Lint, typecheck, test, e2e grønne (PC og iPad) | seksjon 4 og 5 |
| Ingen ny avhengighet | seksjon 5 |
