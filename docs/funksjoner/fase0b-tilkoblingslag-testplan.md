# Testplan: Tilkoblingslag med faste porter, første tilkobling e-post

- **Oppgavekort:** `docs/funksjoner/fase0b-tilkoblingslag.md`
- **Dato:** 02.11.2026 (runde 1, før koding)
- **Støtter hovedmål:** tid (ett testet lag som alle senere tilkoblinger bruker; e-post til alle ansatte gjør at hele testmiljøet kan brukes), reklamasjoner (`external_references` uten dubletter, `last_ok_at`/`last_error` viser svikt, revisjonslogg på hver endring admin gjør), KI først (porten `ai` og `readSecret` er det KI-kallene i fase 2 og 3 skal gå gjennom; testene sikrer at hemmeligheter aldri lekker til logg, feilmelding eller revisjonslogg).

Alle integrasjonstester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Ingen test gjør et nettkall: Graph testes bare med en falsk `fetchFn`, og `globalThis.fetch` har en spion som skal være ukalt. Testdata er oppdiktet: hemmelige verdier er tekster som `hemmelig-test-verdi`, adresser er `@example.com`, tenant- og klient-id er `t-oppdiktet`/`c-oppdiktet`. Ingen ekte nøkler, ingen kundeopplysninger.

Ingen skjerm og ingen fagregler. Derfor ingen nye e2e-tester og ingen regeltester som data i fil. Valgreglene for leverandør testes som en tabell med fasit **skrevet inn i testen** (`resolve.test.ts`), ikke importert fra koden. Portkodene, leverandørkodene og statusene sammenlignes med en fast liste i testen (regel 6).

> **Etter runde 1 (prosjektlederen, 02.11.2026):** avklaringene 1–5, 7–9 og 11–13 er tatt inn i kortet. Kortets «Avgjørelser etter runde 1» gjelder foran denne planen der de spriker: `external_references`, `company_id`, token-mellomlageret og klokken (`now`) er kuttet, `emailTransport` er erstattet av `resolveEmailSender`, og `readSecret` har fått nektliste. Testskriveren hopper over avsnittene om det som er kuttet.

## Avklaringer som må inn i kortet før koding (runde 1)

Disse gjør akseptkriteriene entydige. Utvikler og testskriver følger dem.

1. **Unikhet:** «én aktiv tilkobling per organisasjon, port og selskap» betyr **blant rader uten `deleted_at`, uansett `status`**. En `disabled` rad sperrer altså en ny; admin må merke den gamle som slettet først. Enklest, og deterministisk i testen. Feilen er `ConnectionValidationError` (ingen egen klasse).
2. **Navngitt «ikke funnet»:** `ConnectionNotFoundError` eksporteres fra `@/core/integrations` og brukes av `updateConnection`, `markConnectionDeleted` og `saveExternalReference` (ukjent id, slettet rad, id fra annen organisasjon). Ikke-uuid som id gir samme feil, ikke databasefeil.
3. **Falsk `fetchFn` inn i `sendEmail`:** `sendEmail(email, options?, env?)` der `options = { organizationId?, fetchFn? }`. Uten `fetchFn` brukes innebygd `fetch`. Slik kan testene vise hele veien tabell → Graph uten at `globalThis.fetch` kalles (akseptkriteriet «fetch aldri kalt» står da fast).
4. **Systemvalget leser aldri hemmeligheten:** `resolve.ts` avgjør `microsoft365` på `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID` og `MAIL_FROM` (env.ts garanterer «alle fire eller ingen»), og henter klienthemmeligheten bare gjennom `readSecret("MS_GRAPH_CLIENT_SECRET")`. Den statiske testen forbyr mønstrene `env.MS_GRAPH_CLIENT_SECRET`, `.MS_GRAPH_CLIENT_SECRET` etter `getEnv()`/`env`/`process.env`, og `process.env["MS_GRAPH_CLIENT_SECRET"]` i `src/` unntatt `src/shared/config/env.ts`, `src/core/integrations/secrets.ts` og `*.test.ts`. Strengen `"MS_GRAPH_CLIENT_SECRET"` som navn er lov.
5. **Feil uten statuskode fra Graph** (nettfeil, `AbortError` ved tidsavbrudd, `fetchFn` som kaster): `EmailSendError` med `step` (`token` | `send`) og `statusCode: null`; meldingen er en fast norsk tekst, aldri den opprinnelige feilen. `cause` settes ikke.
6. **Klokke i Graph-adapteren:** `createGraphEmailSender(config, fetchFn = fetch, now: () => number = Date.now)`. Da testes «under 60 sekunder igjen» uten falske timere (som kolliderer med `AbortSignal.timeout`).
7. **Svikt før sending teller som feil på tilkoblingen:** finner `resolveEmailSender` en tilkobling, men `readSecret` kaster eller `settings` er ugyldige, settes `last_error` og `status = error` på raden, og feilen kastes videre. `last_error` kan inneholde **navnet** på hemmeligheten, aldri verdien.
8. **`DEV_MAILBOX` vinner uten å røre tabellen:** når postkassen velges, skrives verken `last_ok_at` eller `last_error`, selv om organisasjonen har en tilkobling.
9. **`findActiveConnection` og `resolveEmailSender` eksporteres ikke fra `index.ts`.** Lint-regelen for modulgrenser stopper ikke at en modul importerer fra `@/core/integrations`, så «lint dekker dette» i kortet holder ikke. Tenant-testen importerer dem direkte fra `./connections` og `./resolve`. Den statiske testen sjekker at ingen fil i `src/modules` eller `src/app` importerer `connections`, `resolve` eller navnene `findActiveConnection`/`resolveEmailSender`.
10. **Zod-grenser for referanser:** `entityType` matcher `^[a-z][a-z0-9_]{1,63}$`, `entityId` er uuid, `externalId` trimmes og er 1–256 tegn. Avvises med `ExternalReferenceValidationError`.
11. **`readSecret`:** tom streng i miljøet regnes som manglende (`SecretNotFoundError`). Navn på ett tegn avvises (regex krever minst to).
12. **`updateConnection` validerer mot radens leverandør:** `settings` i oppdateringen sjekkes mot leverandøren på raden (ikke fra skjemaet), og `secretRef` kan ikke fjernes for `microsoft365`. Ingen rad i revisjonsloggen når ingenting ble endret (tomt `input` → «ikke endret», ingen loggrad).
13. **Tidsavbrudd 15 s:** testes ved at `fetchFn` får `init.signal` som er en `AbortSignal`; selve ventetiden testes ikke.

## Avtale om signaturer (slik koden skal bli)

- `@/core/integrations` eksporterer: `INTEGRATION_PORTS`, `PROVIDERS_BY_PORT`, `CONNECTION_STATUSES`, `readSecret`, `SecretNotFoundError`, `InvalidSecretRefError`, `listConnections`, `createConnection`, `updateConnection`, `markConnectionDeleted`, `ConnectionValidationError`, `ConnectionNotFoundError`, `saveExternalReference`, `findExternalReference`, `ExternalReferenceConflictError`, `ExternalReferenceValidationError`, typene `IntegrationPort`, `ConnectionStatus`, `ConnectionSummary`, `CreateConnectionInput`, `UpdateConnectionInput`. **Ikke** `findActiveConnection` og ikke `resolveEmailSender` (punkt 9 over).
- `@/core/email` eksporterer: `sendEmail(email, options?, env?)`, `emailTransport(env?)` → `"dev_mailbox" | "microsoft365" | "server_log"`, `readDevMailbox`, `createGraphEmailSender`, `EmailSendError`, typene `Email`, `EmailProvider`, `EmailSender`, `StoredEmail`.
- `EmailSendError` har `step: "token" | "send"` og `statusCode: number | null`.
- `createServerLogSender(seedAdminEmail, write?)` uendret.
- **Fabrikker** i `tests/factories.ts`: `createIntegrationConnection(organizationId, overrides = {})` (standard `port: "email"`, `provider: "server_log"`, `status: "active"`, `settings: {}`; overstyringer: `companyId`, `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`, `deletedAt`, `deletedBy`) og `createExternalReference(organizationId, connectionId, overrides = {})` (standard `entityType: "contact"`, ny uuid som `entityId`, `externalId: "ext-<n>"`; overstyringer: `entityType`, `entityId`, `externalId`, `deletedAt`, `deletedBy`). Fabrikkene setter inn rått uten validering, slik at testene kan lage rader som tjenesten ville avvist. `RESET_TABLES` får `external_references` og `integration_connections` (før `companies`).

## Testfiler (én per kildefil)

| Kildefil | Testfil | Type |
|---|---|---|
| `src/core/integrations/ports.ts` | `ports.test.ts` | enhet |
| `src/core/integrations/secrets.ts` | `secrets.test.ts` | enhet |
| `src/core/integrations/connections.ts` (+ skjema, migrering) | `connections.test.ts` | integrasjon |
| `src/core/integrations/external-references.ts` | `external-references.test.ts` | integrasjon |
| `src/core/integrations/` og `src/` | `static-checks.test.ts` | statisk |
| `src/core/email/graph.ts` | `graph.test.ts` | enhet, falsk `fetchFn` |
| `src/core/email/resolve.ts` | `resolve.test.ts` | enhet + integrasjon |
| `src/core/email/index.ts` (+ `dev-mailbox.ts`) | `email.test.ts` | enhet + integrasjon (oppdatert) |
| `src/core/email/server-log.ts` | `server-log.test.ts` | uendret |
| `src/shared/lib/logger.ts` | `logger.test.ts` | enhet (utvidet) |
| `tests/factories.ts` | `tests/factories.test.ts` | integrasjon (utvidet) |

## 1. Faste koder, `ports.test.ts`

1. **portene:** `INTEGRATION_PORTS` er nøyaktig `["accounting", "email", "broker", "property_data", "sms", "speech_to_text", "ai", "file_storage", "energy_label", "scanning"]` (listen skrevet inn i testen).
2. **leverandører per port:** `PROVIDERS_BY_PORT.email` er nøyaktig `["dev_mailbox", "server_log", "microsoft365"]`; alle de ni andre portene har tom liste.
3. **statusene:** `CONNECTION_STATUSES` er nøyaktig `["active", "disabled", "error"]`.
4. **alle porter har en oppføring:** `Object.keys(PROVIDERS_BY_PORT)` er lik `INTEGRATION_PORTS` (ingen port glemt, ingen ekstra).

## 2. Hemmeligheter, `secrets.test.ts`

`vi.stubEnv` i hver test, `vi.unstubAllEnvs` i `afterEach`.

1. **leser verdien:** `MS_GRAPH_CLIENT_SECRET=hemmelig-test-verdi` → `readSecret("MS_GRAPH_CLIENT_SECRET") === "hemmelig-test-verdi"`.
2. **mangler:** ikke satt → `SecretNotFoundError`; `message` inneholder `MS_GRAPH_CLIENT_SECRET`.
3. **tom streng er mangler:** satt til `""` → `SecretNotFoundError`.
4. **meldingen har aldri verdi:** med `ANNEN_HEMMELIGHET=hemmelig-test-verdi` satt og `MS_GRAPH_CLIENT_SECRET` ikke satt: `message` og `String(error)` inneholder ikke `hemmelig-test-verdi`.
5. **ugyldig navn** (`it.each`, fasit i testen): `"ms graph"`, `"a=b"`, `"lowercase"`, `""`, `"A"`, `"1ABC"`, `"ABC-DEF"`, `"A".repeat(129)`, `"MS_GRAPH_CLIENT_SECRET\n"` → `InvalidSecretRefError`, og `process.env` leses ikke (en `Proxy`/`vi.spyOn` på oppslag, eller: ugyldig navn satt i miljøet med en verdi, og verdien kommer likevel ikke tilbake).
6. **gyldige navn** (`it.each`): `"AB"`, `"MS_GRAPH_CLIENT_SECRET"`, `"A_1"`, `"A".repeat(128)` leses.
7. **loggeren:** `logger.error("x", { clientSecret: "hemmelig-test-verdi", secretRef: "MS_GRAPH_CLIENT_SECRET" })` gir `[fjernet]` for `clientSecret`, og `secretRef`-navnet står (navn er ikke hemmelig).

## 3. Tilkoblinger, `connections.test.ts` (integrasjon)

Oppsett: organisasjon A med admin, takstmann, kontor, leder; organisasjon B med admin.

### 3.1 Opprette

1. **e-post via Microsoft 365:** admin, `createConnection(adminA, orgA, { port: "email", provider: "microsoft365", secretRef: "MS_GRAPH_CLIENT_SECRET", settings: { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" } })` → rad med `organization_id = A`, `status = active`, `company_id` tom, `last_ok_at`/`last_error` tomme, `created_by` = admins ansatt-id, `row_version` 1.
2. **server_log og dev_mailbox** med `settings: {}` og uten `secretRef` godtas.
3. **med selskap:** `companyId` = selskap i A → raden har `company_id`.
4. **retur:** `createConnection` gir `ConnectionSummary` med nøyaktig nøklene `id`, `companyId`, `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError` (ingen sporingsfelt).

### 3.2 Validering før skriving (`ConnectionValidationError`, ingen rad, ingen loggrad)

`it.each` med fasit i testen:

1. ukjent port `"fax"`; tom port.
2. ukjent leverandør `"sendgrid"` på `email`.
3. leverandør som ikke hører til porten: `provider: "microsoft365"` på `port: "accounting"`; alle ni andre porter avviser `"server_log"`.
4. `secretRef` ugyldig: `"a=b"`, `"ms graph"`, `"lowercase"`, `"hemmelig-test-verdi=abc"`, `""`.
5. `companyId` fra organisasjon B; `companyId` som er mykt slettet i A; `companyId` som ikke er uuid.
6. ukjent nøkkel i `settings` (`{ from: …, tenantId: …, clientId: …, sandbox: true }` for `microsoft365`; `{ x: 1 }` for `server_log`).
7. `microsoft365` uten `secretRef`; uten `from`; `from` som ikke er e-postadresse (`"ikke-en-adresse"`); uten `tenantId`; uten `clientId`; tom streng i noen av dem.
8. `dev_mailbox`/`server_log` med `secretRef` satt godtas (navn skader ikke) **eller** avvises; utvikleren velger, testen låser valget. Anbefalt: godtas.
9. **ingen rad etter avvisning:** `select` på tabellen er tom, `auditRows(orgA)` tom, i alle sakene over.

### 3.3 Unikhet (punkt 1 i avklaringene)

1. **to uten selskap:** andre `createConnection` for `email` i A uten selskap → `ConnectionValidationError`, fortsatt én rad.
2. **to med samme selskap:** samme feil.
3. **uten og med selskap** er to ulike rader og godtas; **to ulike selskaper** godtas.
4. **disabled sperrer også:** første satt til `disabled` → ny avvises.
5. **etter myk sletting:** `markConnectionDeleted` på den første → ny kan lages; begge radene finnes i tabellen (én med `deleted_at`).
6. **samme port i B** påvirker ikke A: B har `email`, A kan lage `email`.
7. **databasen holder uansett tjenesten:** to rå `insert` (fabrikken) med samme `(organization_id, port, company_id = null)` og `deleted_at` tom gir databasefeil; med `deleted_at` satt på den første godtas den andre. (Viser den delvise unike indeksen; faller utvikleren ned på sjekk under lås i stedet, erstattes 7 av en test med to samtidige `createConnection` i `Promise.allSettled` der nøyaktig én lykkes.)

### 3.4 Liste

1. **sortert på port og leverandør:** rader `email/server_log`, `email/dev_mailbox` → listen kommer `dev_mailbox`, `server_log`. (Flere porter kan ikke lages i dag, så sorteringen på port testes med to rå rader via fabrikken med `port: "accounting"`, `provider: "x"`; fabrikken validerer ikke.)
2. **slettede rader er borte**, `disabled` og `error` er med.
3. **fast feltliste:** hver rad har nøyaktig nøklene i 3.1.4; `JSON.stringify(rad)` inneholder ikke `createdBy`, `rowVersion`, `deletedAt`.
4. **`secretRef` i listen er navnet**, og listen inneholder aldri `hemmelig-test-verdi` selv om miljøet har den.

### 3.5 Oppdatere

1. **status:** `active` → `disabled` → `active` lykkes; `row_version` øker per endring.
2. **`error` fra admin avvises:** `{ status: "error" }` → `ConnectionValidationError`, raden uendret, ingen loggrad.
3. **fra `error` til `active`:** rad laget med fabrikken i `error` med `last_error` satt → admin setter `active`; `last_error` beholdes (historikk) eller nullstilles; utvikleren velger, testen låser. Anbefalt: beholdes, nullstilles ved neste vellykkede sending.
4. **`secretRef` byttes** til et annet gyldig navn; ugyldig navn avvises.
5. **`settings` mot radens leverandør:** `microsoft365`-rad får `{ from: "ny@example.com", tenantId, clientId }` → ok; `{ sandbox: true }` → avvises; `server_log`-rad får `{ from: … }` → avvises.
6. **`secretRef` kan ikke fjernes for `microsoft365`:** `{ secretRef: null }` avvises.
7. **port, leverandør og selskap kan ikke endres:** `{ port: "sms" }`, `{ provider: "server_log" }`, `{ companyId: … }` avvises med `ConnectionValidationError` (ukjent nøkkel, Zod strict), raden uendret.
8. **tomt input:** `{}` → ingen endring, ingen loggrad, `row_version` uendret.
9. **ukjent id, slettet rad, ikke-uuid:** `ConnectionNotFoundError`, ingenting endret.
10. **id fra B:** `updateConnection(adminA, orgA, idB, { status: "disabled" })` → `ConnectionNotFoundError`; raden i B er fortsatt `active`.

### 3.6 Myk sletting

1. **merker:** `deleted_at` og `deleted_by` (= admins ansatt-id) satt; raden finnes i `select` uten filter; `listConnections` viser den ikke.
2. **allerede slettet:** `ConnectionNotFoundError`, `deleted_at`/`deleted_by` nøyaktig slik fabrikken satte dem.
3. **id fra B:** `ConnectionNotFoundError`, raden i B urørt, ingen loggrad i A eller B.
4. **referanser røres ikke:** `createExternalReference(orgA, id)` før sletting → raden i `external_references` har fortsatt `deleted_at` tom etterpå.
5. **ingen sletting noe sted:** statisk (5.2) og `select` uten filter i 3.6.1.

### 3.7 Revisjonslogg

1. **create:** `auditRows(orgA)` har én rad: `entityType: "integration_connection"`, `action: "create"`, `entityId` = tilkoblingens id, `organizationId` = A, `actorEmployeeId` = admins ansatt-id. `changes` har nøklene `port`, `provider`, `companyId`, `secretRef` (navnet) og `settingsKeys: ["from", "tenantId", "clientId"]` (eller tilsvarende); `JSON.stringify(rad)` inneholder ikke `noreply@example.com`, `t-oppdiktet`, `c-oppdiktet` eller `hemmelig-test-verdi`.
2. **update:** én rad med `action: "update"` og `changes.status = { from: "active", to: "disabled" }`; endret `settings.from` gir `changes.settings = { keys: ["from"] }` (bare nøkkelen), aldri adressen.
3. **delete:** én rad med `action: "delete"`.
4. **én rad per handling:** etter create + update + delete er det nøyaktig tre rader.
5. **avvist handling gir ingen rad** (dekket i 3.2.9, 3.5.2, 3.5.8).
6. **systemets egne skrivinger gir ingen rad:** dekkes i 7.3.

### 3.8 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`:** `listConnections`, `createConnection`, `updateConnection`, `markConnectionDeleted` gir `AccessDeniedError`; ingen rad laget eller endret; ingen loggrad.
2. **`admin`:** alle fire lykkes.
3. **to roller:** ansatt med `inspector` + `admin` kan alt.
4. **enkeltrettighet gir ikke tilgang:** takstmann med `grantPermission(…, "organization.manage")` får fortsatt `AccessDeniedError` (kan ikke gis, A21).
5. **deaktivert admin, ansatt uten roller, innlogget uten ansettelse i A:** `AccessDeniedError` på alle fire.
6. **admin stenges aldri ute (regel 11, skal aldri fjernes):** `access.inspectors_edit_all = false` i `organizations.settings`, admin uten sertifisering og uten enkeltrettigheter → alle fire lykkes.

### 3.9 Tenant-isolasjon (regel 2), tre `expectTenantIsolation`-kall

`seed` lager to tilkoblinger i hver organisasjon (ulike selskaper eller ulik `port` via fabrikken).

1. **`listConnections`:** `query = (actor, orgId) => listConnections(actor, orgId)`, `idOf = r => r.id`.
2. **`updateConnection`:** `query` prøver `updateConnection(actor, orgId, id, { status: "disabled" })` på **alle** id-er fra begge organisasjonene; `ConnectionNotFoundError` gir ingen rad, ellers `{ id }`. Etterpå: ingen rad i den andre organisasjonen er `disabled`.
3. **`findActiveConnection(orgId, "email", companyId?)`** (import fra `./connections`): `query` henter tilgangen med `requireOrganizationAccess(actor, orgId, "organization.manage")` (som gir `AccessDeniedError` mot fremmed id) og kaller `findActiveConnection(grant.organizationId, "email")` for radene uten selskap og med hvert selskap; returnerer de radene som ble funnet.

### 3.10 `findActiveConnection` (import fra `./connections`)

1. **B har den eneste aktive:** A har ingen, B har `email/microsoft365` aktiv → `findActiveConnection(orgA, "email")` gir `null`.
2. **status:** `active` og `error` finnes; `disabled` og slettet gir `null`.
3. **selskap først:** A har rad uten selskap og rad for selskap S → med `companyId = S` kommer S-raden; med `companyId = T` (annet selskap uten rad) kommer raden uten selskap; uten `companyId` kommer raden uten selskap.
4. **port:** `findActiveConnection(orgA, "sms")` gir `null` selv om `email` finnes.

### 3.11 Databasen

1. **sammensatt fremmednøkkel mot `companies`:** rå `insert` med `company_id` fra B og `organization_id` = A gir databasefeil.
2. **indeks som starter med `organization_id`:** `pg_indexes` for `integration_connections` har minst én indeks hvis definisjon begynner med `(organization_id`.
3. **`external_references` sammensatt fremmednøkkel mot `integration_connections`:** rå `insert` med `connection_id` fra B og `organization_id` = A gir databasefeil.
4. **unike indekser på `external_references`:** to rå rader med samme `(connection_id, external_id)` → feil; samme `(connection_id, entity_type, entity_id)` → feil; samme par med `deleted_at` på den første → godtas; samme `external_id` på en annen tilkobling → godtas.

## 4. Eksterne referanser, `external-references.test.ts` (integrasjon)

### 4.1 Lagre og finne

1. **rundtur:** takstmann, `saveExternalReference(inspectorA, orgA, { connectionId, entityType: "contact", entityId, externalId: "ext-1" })` → rad i A; `findExternalReference` med samme tre nøkler gir raden med `externalId: "ext-1"`.
2. **samme to ganger:** andre kall med `"ext-1"` gir samme `id`, fortsatt én rad.
3. **annen `externalId`:** `"ext-2"` → `ExternalReferenceConflictError`, raden har fortsatt `"ext-1"`.
4. **`findExternalReference` uten treff:** `null`. Slettet rad (fabrikken med `deletedAt`) gir `null`.
5. **samme `externalId` for to ulike enheter** på samme tilkobling: andre kall → `ExternalReferenceConflictError` (dubletten hos leverandøren er poenget), ingen ny rad.
6. **tilkobling som ikke finnes, er slettet, eller hører til B:** `ConnectionNotFoundError`, ingen rad. Også `disabled` tilkobling godtas (referanser er historikk).
7. **validering** (`it.each`, fasit i testen): `entityType` `""`, `"Contact"`, `"a b"`, 65 tegn; `entityId` `"ikke-en-id"`; `externalId` `""`, `"   "`, 257 tegn → `ExternalReferenceValidationError`, ingen rad. `externalId` `"  ext-1 "` lagres som `"ext-1"`.
8. **ingen revisjonslogg:** `auditRows(orgA)` tom etter lagring.

### 4.2 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`, `admin`:** `saveExternalReference` og `findExternalReference` lykkes.
2. **deaktivert ansatt, ansatt uten roller, innlogget uten ansettelse:** `AccessDeniedError`, ingen rad.
3. **admin stenges aldri ute:** `access.inspectors_edit_all = false` → admin lykkes.

### 4.3 Tenant-isolasjon, to `expectTenantIsolation`-kall

`seed` lager en tilkobling og to referanser i hver organisasjon og returnerer referanse-id-ene.

1. **`findExternalReference`:** `query` prøver alle `(connectionId, entityType, entityId)` fra begge organisasjonene og gir radene som ikke er `null`. Fremmed `connectionId` gir `null` eller `ConnectionNotFoundError` (begge regnes som «ingen rad»; `AccessDeniedError` slippes gjennom).
2. **`saveExternalReference`:** `query` lagrer en ny referanse på egen tilkobling, slår opp raden uten filter og gir alle rader med **den radens** `organization_id`. Havner raden i feil organisasjon, inneholder svaret fremmede id-er.

## 5. Statiske kontroller, `static-checks.test.ts`

1. Mappen `src/core/integrations` har kildefiler.
2. **ingen sletting:** ingen `.delete(` på `integrationConnections` eller `externalReferences` i `src/` (unntatt tester).
3. **hemmeligheten leses ett sted** (punkt 4 i avklaringene): ingen fil i `src/` utenom `src/shared/config/env.ts`, `src/core/integrations/secrets.ts` og `*.test.ts` matcher `/(env|getEnv\(\)|process\.env)\s*[.[]\s*["']?MS_GRAPH_CLIENT_SECRET/`.
4. **`process.env` leses ikke for hemmeligheter andre steder:** ingen fil i `src/core/email` eller `src/core/integrations` (unntatt `secrets.ts` og tester) inneholder `process.env`.
5. **interne funksjoner holdes inne** (punkt 9): `src/core/integrations/index.ts` og `src/core/email/index.ts` eksporterer ikke `findActiveConnection` eller `resolveEmailSender`; ingen fil i `src/modules` eller `src/app` importerer fra `core/integrations/connections` eller `core/email/resolve`.
6. **Graph-adressene er faste:** `graph.ts` inneholder `login.microsoftonline.com` og `graph.microsoft.com/v1.0`, og ingen annen fil i `src/` gjør det.

## 6. Graph-adapteren, `graph.test.ts` (falsk `fetchFn`, aldri nett)

Hjelper i testen: `fakeFetch(plan)` som registrerer hvert kall (`url`, `init.method`, `init.headers`, `init.body`, `init.signal`) og svarer etter en plan per adresse. Standard: token-svar `{ access_token: "tok-1", expires_in: 3600 }` med 200, sending 202 uten kropp. `now` sendes inn som en variabel testen kan flytte. `vi.spyOn(globalThis, "fetch")` i `beforeEach`; `expect(fetchSpy).not.toHaveBeenCalled()` i `afterEach` for hele filen.

1. **sender riktig:** `send({ to: "a@example.com", subject: "Emne", text: "Hei" })` → kall 1 er `POST https://login.microsoftonline.com/t-oppdiktet/oauth2/v2.0/token` med `Content-Type: application/x-www-form-urlencoded` og kropp som inneholder `grant_type=client_credentials`, `scope=https%3A%2F%2Fgraph.microsoft.com%2F.default`, `client_id=c-oppdiktet`, `client_secret=hemmelig-test-verdi`; kall 2 er `POST https://graph.microsoft.com/v1.0/users/noreply%40example.com/sendMail` (eller ukodet `@`; testen låser valget) med `Authorization: Bearer tok-1`, `Content-Type: application/json`, kropp `{ message: { subject: "Emne", body: { contentType: "Text", content: "Hei" }, toRecipients: [{ emailAddress: { address: "a@example.com" } }] }, saveToSentItems: false }`.
2. **hemmeligheten står bare i token-kallet:** `JSON.stringify` av kall 2 (adresse, headers, kropp) inneholder ikke `hemmelig-test-verdi`; adressen i kall 1 inneholder den heller ikke (bare kroppen).
3. **token gjenbrukes:** to `send` etter hverandre → ett token-kall, to sendinger.
4. **nytt token under 60 s igjen:** `expires_in: 3600`, flytt `now` 3541 s frem → neste `send` henter nytt token; ved 3539 s gjenbrukes det.
5. **token-svar uten `access_token`** (`{}` med 200): `EmailSendError` med `step: "token"`, ingen sending.
6. **feil fra token** (`it.each` 400, 401, 500): `EmailSendError` med `step: "token"`, `statusCode` = koden, ingen sending; `message` inneholder ikke svarteksten `{"error":"invalid_client","error_description":"AADSTS7000215 oppdiktet"}`, ikke `a@example.com`, `Emne`, `Hei` eller `hemmelig-test-verdi`.
7. **feil fra sending** (`it.each` 403, 429, 500): `EmailSendError` med `step: "send"` og koden; samme fravær i meldingen; token-kallet ble gjort én gang.
8. **`fetchFn` kaster** (`TypeError("fetch failed")` og `DOMException` med navn `AbortError`): `EmailSendError` med `step` og `statusCode: null`; `message` inneholder ikke `fetch failed`; `cause` er `undefined`.
9. **tidsavbrudd settes:** begge kallene har `init.signal instanceof AbortSignal`.
10. **mislykket token lagres ikke:** etter 6 gir neste `send` et nytt token-kall.
11. **`provider`:** `sender.provider === "microsoft365"`.
12. **loggeren vasker feilen:** `logger.error("x", { error })` for feilen fra 6 gir en linje uten svartekst (dekkes også av at meldingen alt er ren; testen viser at `EmailSendError` serialiseres som vanlig `Error`).

## 7. Valg av leverandør, `resolve.test.ts`

### 7.1 Uten organisasjon (enhet, `env`-objekt som i dagens `email.test.ts`)

Fasit som tabell i testen (`it.each`):

| `DEV_MAILBOX` | tenant+klient+from satt | forventet |
|---|---|---|
| på | nei | `dev_mailbox` |
| på | ja | `dev_mailbox` |
| av | ja | `microsoft365` |
| av | nei | `server_log` |

1. **tabellen** over mot `resolveEmailSender({}, env).provider` og mot `emailTransport(env)`.
2. **`microsoft365` leser hemmeligheten gjennom `readSecret`:** med `MS_GRAPH_CLIENT_SECRET` stubbet til `hemmelig-test-verdi` gir sending (falsk `fetchFn`) `client_secret=hemmelig-test-verdi` i token-kallet; uten stub → `SecretNotFoundError` (ikke fra `env`-objektet, som bevisst har `MS_GRAPH_CLIENT_SECRET: "fra-env-objektet"`, og den verdien vises aldri i token-kallet). Dette låser punkt 4 i avklaringene.

### 7.2 Med organisasjon (integrasjon)

1. **aktiv `microsoft365`-tilkobling** i A med `settings` `{ from: "org@example.com", tenantId: "t-org", clientId: "c-org" }` og `secretRef: "ORG_HEMMELIGHET"` (stubbet) → `provider === "microsoft365"`, token-kallet bruker `t-org`, `c-org`, `client_secret=hemmelig-org-verdi`, sendingen går til `/users/org@example.com/`. Miljøet har samtidig de fire `MS_GRAPH_*` satt til andre verdier, som **ikke** brukes.
2. **`disabled` tilkobling** → systemvalget (`server_log` når miljøet er tomt, `microsoft365` fra miljøet når de fire er satt).
3. **ingen tilkobling** → systemvalget.
4. **`error`-tilkobling** brukes (status ulik `disabled`).
5. **`DEV_MAILBOX` vinner** også med aktiv `microsoft365`-tilkobling: `dev_mailbox`, ingen `fetchFn`-kall.
6. **B sin tilkobling brukes aldri for A:** bare B har en aktiv `microsoft365` → A får systemvalget.
7. **organisasjon som ikke finnes** (tilfeldig uuid) → systemvalget, ingen feil.

## 8. `sendEmail`, `email.test.ts` (oppdatert)

### 8.1 Som i dag (oppdaterte navn)

1. Dagens tester beholdes med `devMailbox` → `dev_mailbox`, `graph` → `microsoft365`, `serverLog` → `server_log`, og `sendEmail(email, env)` → `sendEmail(email, undefined, env)`.
2. **«graph kaster fortsatt feilen om fase 0b» tas ut** og erstattes av: `sendEmail(email, { fetchFn: fakeFetch }, { ...env, ...graph })` med `MS_GRAPH_CLIENT_SECRET` stubbet → sendingen går gjennom den falske `fetchFn`, `globalThis.fetch` ukalt.
3. **`readDevMailbox`** gir tom liste når `DEV_MAILBOX` er av; 50 siste beholdes (51 sendinger → 50 rader, nyeste først).
4. **`server_log` uendret:** eksisterende seks tester.

### 8.2 Gjennom en tilkobling (integrasjon; `DEV_MAILBOX` av i `env`)

1. **suksess setter `last_ok_at` og `active`:** A har `email/server_log`-tilkobling i `error` med `last_error: "gammel feil"`; `sendEmail({ to: SEED_ADMIN_EMAIL, …, logLine }, { organizationId: orgA }, env)` → raden har `last_ok_at` satt (innen testens tidsrom), `status = active`, `last_error` tom.
2. **feil setter `last_error` og `error`:** samme tilkobling, mottaker `annen@example.com` → `sendEmail` kaster (`NOT_CONFIGURED`-meldingen), raden har `status = error`, `last_error` satt, `last_ok_at` uendret.
3. **`last_error` er vasket:** `microsoft365`-tilkobling med falsk `fetchFn` som kaster `new Error("til a@example.com kode 123456 client_secret=hemmelig-test-verdi +47 912 34 567")` → `last_error` inneholder ikke `a@example.com`, `123456`, `hemmelig-test-verdi` eller telefonnummeret; lengden er høyst 500 tegn (feil med 2 000 tegn kortes). (Med punkt 5 i avklaringene er meldingen i `EmailSendError` alt fast; testen viser likevel at `scrubText` er på plass hvis en annen feiltype slipper gjennom.)
4. **svikt før sending teller** (punkt 7): `microsoft365`-tilkobling med `secretRef: "FINNES_IKKE"` → `SecretNotFoundError` kastes videre, raden får `status = error` og `last_error` som inneholder `FINNES_IKKE`, aldri noen verdi.
5. **ingen revisjonslogg** for 1, 2 og 4: `auditRows(orgA)` er tom (admin har ikke gjort noe).
6. **systemvalget skriver ingenting:** ingen tilkobling i A, sending via `server_log` → tabellen er tom etterpå; `disabled` tilkobling → raden uendret (`row_version`, `last_ok_at`, `last_error`).
7. **`DEV_MAILBOX` skriver ingenting** (punkt 8): aktiv tilkobling + `DEV_MAILBOX` på → raden uendret, e-posten ligger i postkassen.
8. **feilen kastes videre etter skrivingen:** `await expect(...).rejects` og så er raden alt oppdatert (ikke først ved neste kall).
9. **B sin rad røres ikke:** A sender og feiler; B sin tilkobling har fortsatt `last_error` tom.
10. **`fetch` aldri kalt:** spion i `beforeEach`/`afterEach` for hele filen.

## 9. Loggeren, `logger.test.ts` (utvidet, egen `describe("logger vasker Microsoft 365-hemmeligheter")`)

1. **`client_secret=` i tekst:** `"grant_type=client_credentials&client_id=c&client_secret=hemmelig-test-verdi&scope=x"` → `client_secret=[fjernet]`, `client_id=c` står.
2. **i feilmelding:** `logger.error("x", { error: new Error("…client_secret=hemmelig-test-verdi …") })` → linjen inneholder ikke verdien.
3. **nøkler:** `clientSecret`, `client_secret`, `CLIENT_SECRET` blir `[fjernet]`; `secretRef` og `clientId` står.
4. **ingen overvasking:** `client_secret_name=MS_GRAPH_CLIENT_SECRET` → utvikleren velger om mønsteret skal treffe; testen låser valget. Anbefalt: `client_secret=` krever `=` rett etter, så `client_secret_name=` står urørt.

## 10. Fabrikkene, `tests/factories.test.ts`

1. `createIntegrationConnection(orgA)` gir rad i A med `port: "email"`, `provider: "server_log"`, `status: "active"`, `settings: {}`.
2. Overstyringene `status`, `lastError`, `deletedAt`, `deletedBy`, `companyId` står på raden.
3. `createExternalReference(orgA, connectionId)` gir rad i A med tilkoblingen; to kall gir ulik `externalId`.
4. Testen «truncate-listen har alle tabellene i databasen» går grønn med de to nye tabellene.

## 11. Migrering og e2e (kjøres av test-leder, ikke egne tester)

1. `pnpm db:migrate` på tom database, deretter `pnpm db:generate` → ingen ny migreringsfil, ingen diff (den delvise indeksen med `COALESCE` må stå i Drizzle-skjemaet med `sql`, ellers lager generate en diff).
2. `pnpm test:e2e` for `pc` og `ipad` grønn uendret, særlig `e2e/fase-0a.spec.ts` (innlogging via `/dev/epost`), `e2e/fase-0b-sperre-innlogging.spec.ts` og `e2e/fase-1-prove-f-innlogging.spec.ts`. Ingen nye e2e-tester: ingen skjerm, ingenting virker uten nett i denne oppgaven.
3. `/api/helse` viser 0.2.53 (eller neste ledige patch over `main`).

## 12. Kontroller i gjennomgangen (test-leder)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- `git diff main -- src/core/files src/modules` er tom (filtjenesten og prøvemodulen røres ikke).
- **Fem** `expectTenantIsolation`-kall finnes: tre i `connections.test.ts` (3.9), to i `external-references.test.ts` (4.3).
- Rollematrisen 3.8 og 4.2 og «admin stenges aldri ute» (3.8.6, 4.2.3) finnes.
- `index.ts` i `integrations` og `email` eksporterer ikke `findActiveConnection`/`resolveEmailSender` (5.5).
- Ingen testfil importerer fasiten (portlisten, leverandørlistene, statusene, valgtabellen) fra koden.
- Ingen ekte verdier i `.env.example` (kommentaren om `readSecret` er der, verdiene tomme), ingen `@`-adresser utenfor `example.com` i testene, ingen produktnavn i `src/` utenom `brand.ts`, ingen modellnavn.
- `RESET_TABLES` har begge tabellene, migreringen `0011_tilkoblinger.sql` finnes, `docs/05-domenemodell.md` 4.10 og ordlisten oppdatert, A44 og videre i `docs/09-apne-sporsmal.md`, versjon økt.
- **Avvises** hvis 3.8, 3.9, 4.2 eller 4.3 mangler, hvis noen e-posttest kaller `globalThis.fetch`, hvis `hemmelig-test-verdi` kan finnes i noen loggutskrift, feilmelding eller `audit_log`-rad i testkjøringen, eller hvis en test leser en ekte miljøvariabel for hemmeligheter uten `vi.stubEnv`.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Migreringen lager tabellene, ingen diff etter generate | 3.11, 10.4, 11.1 |
| `organization.manage` for de fire funksjonene, admin får alt | 3.8 |
| `expectTenantIsolation` for `listConnections` | 3.9.1 |
| `expectTenantIsolation` for `external_references` | 4.3.1–4.3.2 |
| `findActiveConnection` finner aldri B sin rad | 3.9.3, 3.10.1, 7.2.6 |
| Ukjent port/leverandør/par, `secretRef`, `companyId`, ukjent nøkkel avvises før skriving | 3.2 |
| `microsoft365` krever `secretRef` og `settings`; de to andre tomme `settings` | 3.2.6–3.2.8, 3.5.5–3.5.6 |
| Én aktiv per organisasjon, port, selskap; ny etter myk sletting | 3.3 |
| `updateConnection` bare `active`/`disabled`; port, leverandør, selskap låst | 3.5 |
| Id fra annen organisasjon gir «ikke funnet» uten endring | 3.5.10, 3.6.3, 3.9.2, 4.1.6 |
| Revisjonslogg én rad per handling, aldri adresse eller hemmelighet | 3.7 |
| `saveExternalReference` idempotent, konflikt, fremmed tilkobling | 4.1 |
| `readSecret` verdi, mangler, ugyldig navn | 2 |
| Hemmeligheten leses ett sted (statisk) | 5.3–5.4, 7.1.2 |
| `sendEmail` uten organisasjon som i dag | 7.1, 8.1 |
| `sendEmail` med organisasjon: tilkobling, disabled, ingen, `DEV_MAILBOX` vinner | 7.2, 8.2.6–8.2.7 |
| `last_ok_at`/`active` ved suksess, `last_error`/`error` ved feil, feil videre, ingen loggrad | 8.2 |
| Graph-adapteren med falsk `fetchFn` | 6 |
| Ingen test gjør nettkall | 6 (afterEach), 8.2.10, 7.2.5 |
| Loggeren vasker `client_secret=` | 9 |
| `/dev/epost` virker, innlogging grønn på pc og iPad | 11.2 |
| Bruker i annen organisasjon får ikke tilgang (begge tabellene) | 3.9, 4.3 |
| Alle sjekker grønne, ingen ny avhengighet, ingen produktnavn, ingen modellnavn | 12 |
