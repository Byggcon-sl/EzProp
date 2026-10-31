# Testplan: Revisjonslogg og hendelseslogg

- **Oppgavekort:** `docs/funksjoner/fase0b-revisjon-hendelser.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (admin kan alltid se hvem som endret hva og når, og testene viser at loggen aldri lekker mellom organisasjoner eller kan endres), tid (rutinene i fase 3 kan bygges på hendelsene uten ny grunnmur). KI først: ingen KI i oppgaven; testene sikrer at dataene KI senere leser, er hele og riktige.

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: navn som «Kari Testdatter», e-post på `eksempel.no`/`example.com`. Ingen ekte navn.

Ingen del av oppgaven virker uten nett (adminområdet og serverkode), så det trengs ingen e2e uten nett. Ingen fagregler, så ingen regeltester som data; hendelseskodene testes som en fast liste (avsnitt 1).

## Avtale om signaturer (utvikler og testskriver)

- `EVENT_TYPES` (`as const`) og `type EventType` i `src/core/events/types.ts`, eksportert fra `@/core/events`.
- `recordEvent(executor: DbExecutor, grant: EmployeeGrant, input: { type: EventType; assignmentId?: string | null; reportId?: string | null; data?: Record<string, unknown> })` i `src/core/events/index.ts`. Ingen `organizationId`, `actorType` eller `actorId` i input.
- `listAuditEvents(actor, organizationId, limit = 50)` får feltet `actorName: string | null` (left join på `employees`, filtrert på samme `organization_id`). Ellers uendret.
- Visningstekstene i `src/app/(ansatt)/admin/labels.ts` (eller `admin/logg/labels.ts`, utvikler velger): `auditEntityLabel(entityType: string): string`, `auditActionLabel(action: string): string`, `formatAuditChanges(changes: Record<string, unknown>): string[]`.
- `resetDatabase` i `tests/factories.ts` tømmer også `events`.

**Funn i forkant (lite, må håndteres):** `updateEmployee` logger bare `changes: { fields: [...] }`, uten fra/til. Selskaper og kontorer logger `{ felt: { from, to } }`. Derfor:
- e2e bruker **endring av adresse på et kontor** (gir «felt: fra → til»), ikke stilling på en ansatt.
- `formatAuditChanges` viser `{ from, to }` som «felt: fra → til», en `fields`-liste som «Endret: felt, felt», og hopper over resten. Utvikler endrer ikke `updateEmployee` i denne oppgaven (utenfor omfang); forslaget om fra/til for ansatte føres i PR-en.

## 1. Hendelseskodene, `src/core/events/types.test.ts` (ny, enhetstest)

1. **nøyaktig kodene fra 4.9:** `[...EVENT_TYPES].sort()` er lik en fast fasit i testen med de 35 kodene (`order.received` … `survey.answered`, der «a / b»-radene i 4.9 gir to koder). Fasiten skrives inn i testen, ikke importert.
2. **ingen duplikater:** `new Set(EVENT_TYPES).size === EVENT_TYPES.length`.
3. **riktig format:** hver kode matcher `/^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$/`.
4. **`followup.received` finnes ikke** (forkastet 27.10.2026, domenemodellen avsnitt 9).
5. **typen:** `@ts-expect-error` på `const x: EventType = "assignment.unknown"` (fanges av `pnpm typecheck`).

## 2. Skriving av hendelser, `src/core/events/events.test.ts` (ny, integrasjonstest)

### 2.1 Lagring

1. **organisasjon og ansatt fra tilgangssjekken:** takstmann i A, `recordEvent(db, grant, { type: "inspection.started" })` → én rad med `organizationId = grant.organizationId`, `actorType = "employee"`, `actorId = grant.employeeId`, `createdBy = grant.employeeId`, `type = "inspection.started"`.
2. **tomme koblinger og standard data:** `assignmentId` og `reportId` er `null`, `data` er `{}`, `occurredAt` og `receivedAt` (om kolonnen finnes) er satt, `deletedAt` er `null`.
3. **med koblinger og data:** tilfeldige uuid-er i `assignmentId`/`reportId` (ingen fremmednøkkel, A33) og `data: { from: "bestilt", to: "under_arbeid" }` lagres uendret.
4. **i transaksjon som rulles tilbake:** `db.transaction(async (tx) => { await recordEvent(tx, …); throw … })` → ingen rad i `events`.
5. **i transaksjon som lykkes:** raden finnes etterpå (samme `tx` som endringen).

### 2.2 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`, `admin`:** alle kan skrive (funksjonen sjekker ingen rettighet selv; kallet ligger bak handlinger de har lov til). Raden har riktig `actorId`.

### 2.3 Tenant-isolasjon (regel 2)

`recordEvent` tar ingen `organizationId`, så `expectTenantIsolation` passer ikke (ingen lesespørring i denne oppgaven, `listEvents` kommer i fase 2a). I stedet:

1. **samme person i A og B:** grant fra A → raden har `organizationId` A, og B har ingen rader.
2. **forsøk på å smugle inn organisasjon:** `recordEvent(db, grantA, { type: "assignment.created", organizationId: orgB.id, actorId: annen, actorType: "system" } as never)` → raden har likevel `organizationId` A, `actorId = grantA.employeeId`, `actorType = "employee"`. (Hindrer at input spres rett inn i `values`.)
3. **`@ts-expect-error`:** input med `organizationId`, og input med `type: "ukjent.kode"`, gir typefeil.

### 2.4 Databasen

1. **`actor_type` utenfor de tre verdiene avvises:** rå `insert` med `actorType: "robot"` → databasefeil (sjekkbegrensning).
2. **`employee`, `system`, `integration` godtas** ved rå `insert`; `system` med `actor_id = null` godtas.
3. **`organization_id` er påkrevd:** rå `insert` uten den → databasefeil.
4. **`type` er påkrevd:** rå `insert` uten den → databasefeil.
5. **`resetDatabase` tømmer `events`** (rad før, ingen etter).

## 3. Revisjonsloggen, `src/core/audit/audit.test.ts` (utvides, dagens to tester står)

### 3.1 Navn og left join

1. **navnet på den ansatte kommer med:** admin «Kari Testdatter» endrer noe → `actorName = "Kari Testdatter"`.
2. **rad uten ansatt kommer med:** rå `insert` i `audit_log` med `actorEmployeeId = null` → raden er i listen med `actorName = null`.
3. **ansatt som har sluttet eller er mykt slettet:** navnet vises fortsatt (historikk skal ikke miste navn). Utvikler velger om join tar med slettede; testen dokumenterer valget, og raden forsvinner uansett aldri.
4. **ansatt-id fra en annen organisasjon på raden:** rå `insert` i A med `actorEmployeeId` = en ansatt i B → raden vises i A med `actorName = null` (join filtrerer også på `organization_id`), aldri navnet fra B.

### 3.2 Rekkefølge og grense

1. **nyeste først:** tre rader med `occurredAt` i stigende rekkefølge kommer i synkende.
2. **standardgrensen er 50:** 51 rader → 50 i listen, den eldste mangler.

### 3.3 Tilgang per rolle

1. **`it.each` over `inspector`, `office`:** `listAuditEvents` gir `AccessDeniedError`.
2. **`manager`, `admin`:** lykkes.
3. **admin som har sluttet** og **ansatt uten roller:** `AccessDeniedError`.
4. **admin stenges aldri ute (regel 11):** admin uten sertifisering og uten enkeltrettigheter lykkes. Kommentar: testen skal aldri fjernes.

### 3.4 Tenant-isolasjon

1. **`expectTenantIsolation` mot den utvidede `listAuditEvents`** (erstatter eller utvider dagens test): `seed` skriver rader med `grantA` og `grantB` (to ulike ansatte, «Admin A» og «Admin B»).
2. **ingen navn fra B:** etter isolasjonstesten henter admin A listen; ingen rad har `actorName = "Admin B"`, og alle `actorName` er `null` eller navn på ansatte i A.

## 4. Adminsperren, `src/core/organization/employees-admin.test.ts` (utvides)

1. **`findAdminOrganizationId` gir `null` for `manager` og `office`** (i tillegg til dagens takstmann). Dette er sperren for `/admin/logg`, siden siden bruker `getAdminContext`.

## 5. Visningstekster, `labels.test.ts` ved siden av `labels.ts`

1. **norsk navn for alle `entity_type` som skrives i dag:** `employee`, `employee_permission`, `company`, `office`, `certification`. Fasiten skrives i testen; ved ny `entityType` i koden oppdateres testen.
2. **norsk navn for alle `action` som skrives i dag:** `create`, `update`, `delete`, `role_change`, `permission_change`, `deactivate`, `reactivate`.
3. **ukjent kode vises som koden selv:** `auditEntityLabel("x") === "x"`, `auditActionLabel("y") === "y"`.
4. **`formatAuditChanges` med fra/til:** `{ street: { from: "Storgata 1", to: "Storgata 2" } }` → `["Gate: Storgata 1 → Storgata 2"]` (eller feltkoden når norsk navn mangler).
5. **tomme verdier:** `from: null` og `to: ""` vises som «(tom)» eller «–» (utvikler velger, testen låser valget), aldri «null» eller «undefined».
6. **`fields`-liste:** `{ fields: ["name", "jobTitle"] }` → én linje «Endret: …».
7. **annet innhold** (`{ employeeId: "…" }`, `{ added: [], removed: [] }`) gir ingen linje som viser rå uuid-er eller `[object Object]`.
8. **tom `changes`** gir `[]`.

## 6. E2e, `e2e/fase-0b-logg.spec.ts` (ny, prosjektene pc og ipad)

E2e-databasen tømmes ikke mellom kjøringene. Hver test lager unike verdier med `uniqueSuffix()`.

1. **admin ser sin egen endring:** admin logger inn, oppretter eller endrer et kontor med adresse «Testveien {suffix}», trykker fanen «Logg» i adminmenyen (1 trykk, `navigation` «Admin») og ser en rad med sitt navn, «Kontor» + «Endret»/«Opprettet», et tidspunkt og «… → Testveien {suffix}».
2. **fanen «Logg» er aktiv** (`aria-current="page"`) på `/admin/logg`, og er minst 44 px høy.
3. **iPad stående (834 × 1194, egen `describe` bare i ipad):** `/admin/logg` har ingen vannrett rulling (`scrollWidth <= clientWidth`), og raden fra test 1 er synlig.
4. **takstmann får «Ingen tilgang» eller 404:** `logInAsInspector`, `goto("/admin/logg")` → overskrift «Ingen tilgang» eller «Fant ikke siden», ingen tabell eller liste med rader, ingen adresse eller navn fra loggen på siden, ingen fane «Logg».
5. **`/admin/logg` legges i URL-listen i test 4 i `e2e/fase-0b-admin.spec.ts`** (takstmann ser ingen data fra adminområdet).
6. **aldri 500:** `/admin/logg?limit=abc` og `/admin/logg?organizationId=<annen uuid>` gir samme side for admin (parametrene ignoreres; organisasjonen kommer fra `getAdminContext`).

Leder og kontor får ikke egen e2e (avgjort av prosjektlederen 31.10.2026); dekket av 3.3 og 4.

## 7. Gjennomlesing (test-leder ved godkjenning)

1. `grep` etter hendelseskodene (`"assignment.created"` osv.) i `src/`: står bare i `src/core/events/types.ts` (og testen).
2. Ingen `update(`, `delete(` eller `deletedAt`-setting mot `events` eller `audit_log` i `src/`.
3. `recordEvent` setter `organizationId`, `actorType` og `actorId` eksplisitt fra `grant`, ikke ved å spre input.
4. Migreringen `0008_*.sql`: `events` med sjekkbegrensning på `actor_type`, indeks `(organization_id, occurred_at)`, ingen fremmednøkkel til oppdrag/rapport. Kommentar i skjemaet om at raden aldri slettes eller endres.
5. `/admin/logg` bruker `getAdminContext` og `context.organizationId`, ingen tilgangslogikk i siden.
6. Ingen modulimport på tvers (lint), «EzProp» bare i `brand.ts`, versjon 0.2.48, `start.sh` uendret (ingen nytt oppsett).
7. A33 og A34 står i `docs/09-apne-sporsmal.md`; ordlisten har `events`, `EventType`, `actor_type`.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| `events` med migrering 0008, tomme koblinger, `actor_type` sjekkes | 2.1.2, 2.4.1–2.4.4, 7.4 |
| `EVENT_TYPES` nøyaktig, unike, riktig format; ikke andre steder | 1.1–1.5, 7.1 |
| `recordEvent` bare `EventType`, org og ansatt fra grant, ingen `organizationId` | 2.1.1, 2.3.1–2.3.3 |
| Ingen endring eller sletting av loggrader | 7.2 |
| Admin ser egen endring på `/admin/logg` (pc og ipad), ikke stengt ute | 6.1–6.3, 3.3.4 |
| Takstmann får «Ingen tilgang»/404 | 6.4, 6.5 |
| Leder og kontor slipper ikke inn; kjernen tillater leder og admin | 4.1, 3.3.1–3.3.2 |
| Rad uten ansatt vises med «Ukjent» | 3.1.2 (data), 5 (tekst «Ukjent» sjekkes i siden ved gjennomlesing) |
| Tenant-isolasjon og ingen navn fra annen organisasjon | 3.4.1–3.4.2, 3.1.4, 2.3 |
| `pnpm lint`, `typecheck`, `test`, `test:e2e` grønne, versjon 0.2.48 | Kjøres av test-leder |

Godkjennes ikke uten 2.3, 3.3, 3.4 og 4 (tilgang og tenant-isolasjon).
