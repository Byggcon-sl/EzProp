# Testplan: Tilkoblingslag med faste porter, første tilkobling e-post

- **Oppgavekort:** `docs/funksjoner/fase0b-tilkoblingslag.md`
- **Dato:** 02.11.2026 (runde 2, før koding; erstatter runde 1 fra samme dag etter at kortet kuttet `external_references`, `company_id`, token-mellomlageret og `emailTransport`)
- **Støtter hovedmål:** tid (ett testet lag som alle senere tilkoblinger bruker; e-post til alle ansatte gjør at hele testmiljøet kan brukes), reklamasjoner (`last_ok_at`/`last_error` viser svikt, revisjonslogg på hver endring admin gjør), KI først (porten `ai` og `readSecret` er det KI-kallene i fase 2 og 3 skal gå gjennom; testene sikrer at hemmeligheter aldri lekker til logg, feilmelding eller revisjonslogg).

Alle integrasjonstester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Ingen test gjør et nettkall: Graph testes bare med en falsk `fetchFn`, og `globalThis.fetch` har en spion som skal være ukalt. Testdata er oppdiktet: hemmelige verdier er tekster som `hemmelig-test-verdi`, adresser er `@example.com`, tenant- og klient-id er `t-oppdiktet`/`c-oppdiktet`. Ingen ekte nøkler, ingen kundeopplysninger.

Ingen skjerm og ingen fagregler. Derfor ingen nye e2e-tester og ingen regeltester som data i fil. Valgreglene for leverandør testes som en tabell med fasit **skrevet inn i testen** (`resolve.test.ts`), ikke importert fra koden. Portkodene, leverandørkodene og statusene sammenlignes med en fast liste i testen (regel 6).

## Tre punkter utvikleren må låse (ikke blokkerende; gjør som anbefalt hvis ikke annet sies i PR-en)

1. **«`last_error` høyst 500 tegn» stemmer ikke med `scrubText`**, som gir `slice(0, 500) + " …"` = 502 tegn. Anbefalt: `last_error = scrubText(message).slice(0, 500)`. Test 8.2.3 låser `length <= 500`.
2. **`sendEmail` må kjenne `connectionId` også når `readSecret` kaster eller `settings` på raden er ugyldige.** Kortet sier bare «regnes som svikt». Anbefalt: `resolveEmailSender` gir alltid `{ sender, connectionId }` når en rad er funnet; svikter hemmelighet eller `settings`, er `sender.send` en funksjon som avviser med feilen (ingen ny feilklasse). Da kan `sendEmail` sette `status = error` på riktig rad og kaste videre. Tester 7.2.8, 8.2.4 og 8.2.11.
3. **`EmailSender` blir et objekt `{ provider, send }`, men kortet sier `server-log.ts` er «uendret».** `createServerLogSender` må gi `{ provider: "server_log", send }`; de to testene i `server-log.test.ts` kaller `.send(...)`. Oppførselen er ellers uendret.

## Avtale om signaturer (fra kortet, slik testene skrives)

- `@/core/integrations` eksporterer: `INTEGRATION_PORTS`, `PROVIDERS_BY_PORT`, `CONNECTION_STATUSES`, `readSecret`, `SecretNotFoundError`, `InvalidSecretRefError`, `listConnections`, `createConnection`, `updateConnection`, `markConnectionDeleted`, `ConnectionValidationError`, `ConnectionNotFoundError`, typene `IntegrationPort`, `ConnectionStatus`, `ConnectionSummary`, `CreateConnectionInput`, `UpdateConnectionInput`. **Ikke** `findActiveConnection` (testene importerer den fra `./connections`).
- `@/core/email` eksporterer: `sendEmail(email, options?, env?)` med `options = { organizationId?, fetchFn? }`, `readDevMailbox`, `createGraphEmailSender(config, fetchFn = fetch)`, `EmailSendError` (`step: "token" | "send"`, `statusCode: number | null`), typene `Email`, `EmailProvider`, `EmailSender`, `StoredEmail`. **Ikke** `resolveEmailSender` (testene importerer den fra `./resolve`).
- `resolveEmailSender({ organizationId?, fetchFn? }, env?)` → `Promise<{ sender: EmailSender; connectionId: string | null }>`. Ny sender per kall.
- `createServerLogSender(seedAdminEmail, write?)` som i dag, men gir `{ provider: "server_log", send }` (punkt 3 over).
- **Fabrikk** i `tests/factories.ts`: `createIntegrationConnection(organizationId, overrides = {})` (standard `port: "email"`, `provider: "server_log"`, `status: "active"`, `settings: {}`; overstyringer: `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`, `deletedAt`, `deletedBy`). Setter inn rått uten validering. `RESET_TABLES` får `integration_connections` (før `organizations`).

## Testfiler (én per kildefil)

| Kildefil | Testfil | Type |
|---|---|---|
| `src/core/integrations/ports.ts` | `ports.test.ts` | enhet |
| `src/core/integrations/secrets.ts` | `secrets.test.ts` | enhet |
| `src/core/integrations/connections.ts` (+ skjema, migrering) | `connections.test.ts` | integrasjon |
| `src/core/integrations/` og `src/` | `static-checks.test.ts` | statisk |
| `src/core/email/graph.ts` | `graph.test.ts` | enhet, falsk `fetchFn` |
| `src/core/email/resolve.ts` | `resolve.test.ts` | enhet + integrasjon |
| `src/core/email/index.ts` (+ `dev-mailbox.ts`) | `email.test.ts` | enhet + integrasjon (oppdatert) |
| `src/core/email/server-log.ts` | `server-log.test.ts` | oppdatert til `.send` |
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
5. **ugyldig navn** (`it.each`, fasit i testen): `"ms graph"`, `"a=b"`, `"lowercase"`, `""`, `"A"`, `"1ABC"`, `"ABC-DEF"`, `"A".repeat(129)`, `"MS_GRAPH_CLIENT_SECRET\n"` → `InvalidSecretRefError`, og miljøet leses ikke (ugyldig navn satt i miljøet med en verdi, og verdien kommer likevel ikke tilbake, heller ikke i `message`).
6. **gyldige navn** (`it.each`): `"AB"`, `"MS_GRAPH_CLIENT_SECRET"`, `"A_1"`, `"A".repeat(128)` leses.
7. **loggeren:** `logger.error("x", { clientSecret: "hemmelig-test-verdi", secretRef: "MS_GRAPH_CLIENT_SECRET" })` gir `[fjernet]` for `clientSecret`, og `secretRef`-navnet står (navn er ikke hemmelig).
8. **nektlisten** (`it.each`): `BETTER_AUTH_SECRET`, `DATABASE_URL`, `TEST_DATABASE_URL`, `POWERSYNC_JWT_SECRET`, `FILE_STORAGE_AZURE_CONNECTION_STRING` → `InvalidSecretRefError` selv når miljøet har verdien (stubbet til `hemmelig-test-verdi`), og verdien står ikke i `message`.

## 3. Tilkoblinger, `connections.test.ts` (integrasjon)

Oppsett: organisasjon A med admin, takstmann, kontor, leder; organisasjon B med admin. `M365 = { from: "noreply@example.com", tenantId: "t-oppdiktet", clientId: "c-oppdiktet" }`.

### 3.1 Opprette

1. **e-post via Microsoft 365:** `createConnection(adminA, orgA, { port: "email", provider: "microsoft365", secretRef: "MS_GRAPH_CLIENT_SECRET", settings: M365 })` → rad med `organization_id = A`, `status = active`, `last_ok_at`/`last_error` tomme, `created_by` = admins ansatt-id, `row_version` 1.
2. **server_log og dev_mailbox** med `settings: {}` og uten `secretRef` godtas.
3. **retur:** `createConnection` gir `ConnectionSummary` med nøyaktig nøklene `id`, `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError` (ingen sporingsfelt).

### 3.2 Validering før skriving (`ConnectionValidationError`, ingen rad, ingen loggrad)

`it.each` med fasit i testen:

1. ukjent port `"fax"`; tom port.
2. ukjent leverandør `"sendgrid"` på `email`.
3. leverandør som ikke hører til porten: `provider: "microsoft365"` på `port: "accounting"`; alle ni andre porter avviser `"server_log"`.
4. `secretRef` ugyldig: `"a=b"`, `"ms graph"`, `"lowercase"`, `"hemmelig-test-verdi=abc"`, `""`, `"A"`.
5. ukjent nøkkel i `settings` (`{ ...M365, sandbox: true }` for `microsoft365`; `{ x: 1 }` for `server_log`).
6. `microsoft365` uten `secretRef`; uten `from`; uten `tenantId`; uten `clientId`; tom streng i noen av dem.
7. **`settings` for `microsoft365`** (`it.each`): `tenantId` `"t/oppdiktet"`, `"a b"`, `"t".repeat(65)`; `from` `"ikke-en-adresse"`, `"a@b"` uten toppdomene (låses til det Zod `email()` gir).
8. **nektlisten i tjenesten:** `createConnection` med `secretRef: "BETTER_AUTH_SECRET"` (og `DATABASE_URL`) → `ConnectionValidationError`.
9. `dev_mailbox`/`server_log` med `secretRef` satt: godtas (navn skader ikke). Testen låser valget; velger utvikleren å avvise, endres bare fasiten.
10. **ingen rad etter avvisning:** `select` på tabellen er tom og `auditRows(orgA)` tom i alle sakene over.

### 3.3 Unikhet (én per organisasjon og port blant rader uten `deleted_at`)

1. **to for samme port:** andre `createConnection` for `email` i A → `ConnectionValidationError`, fortsatt én rad, én loggrad.
2. **disabled sperrer også:** første satt til `disabled` → ny avvises.
3. **etter myk sletting:** `markConnectionDeleted` på den første → ny kan lages; begge radene finnes i tabellen (én med `deleted_at`).
4. **samme port i B** påvirker ikke A: B har `email`, A kan lage `email`.
5. **databasen holder uansett tjenesten:** to rå `insert` (fabrikken) med samme `(organization_id, port)` og `deleted_at` tom gir databasefeil; med `deleted_at` satt på den første godtas den andre. Viser den delvise unike indeksen.

### 3.4 Liste

1. **sortert på port og leverandør:** rå rader (fabrikken) `email/server_log`, `email/dev_mailbox`, `accounting/x` → listen kommer `accounting/x`, `email/dev_mailbox`, `email/server_log`.
2. **slettede rader er borte**, `disabled` og `error` er med.
3. **fast feltliste:** hver rad har nøyaktig nøklene i 3.1.3; `JSON.stringify(rad)` inneholder ikke `createdBy`, `rowVersion`, `deletedAt`.
4. **`secretRef` i listen er navnet**, og listen inneholder aldri `hemmelig-test-verdi` selv om miljøet har den (stubbet).

### 3.5 Oppdatere

1. **status:** `active` → `disabled` → `active` lykkes; `row_version` øker per endring.
2. **`error` fra admin avvises:** `{ status: "error" }` → `ConnectionValidationError`, raden uendret, ingen loggrad.
3. **fra `error` til `active` beholder `last_error`:** rad laget med fabrikken i `error` med `last_error: "gammel feil"` → admin setter `active`; `status = active`, `last_error` er fortsatt `"gammel feil"` (nullstilles først ved neste vellykkede sending, 8.2.1).
4. **`secretRef` byttes** til et annet gyldig navn; ugyldig navn og navn på nektlisten avvises med `ConnectionValidationError`, raden uendret, ingen loggrad.
5. **`settings` mot radens leverandør:** `microsoft365`-rad får `{ ...M365, from: "ny@example.com" }` → ok; `{ sandbox: true }` → avvises; `server_log`-rad får `{ from: "x@example.com" }` → avvises. Skjemaet kan ikke lure tjenesten: `{ provider: "server_log", settings: {} }` på en `microsoft365`-rad avvises (ukjent nøkkel `provider`), og raden beholder sine `settings`.
6. **`secretRef` kan ikke fjernes for `microsoft365`:** `{ secretRef: null }` avvises; for `server_log` godtas `null` (eller avvises; testen låser utviklerens valg).
7. **port og leverandør kan ikke endres:** `{ port: "sms" }`, `{ provider: "server_log" }` avvises med `ConnectionValidationError` (ukjent nøkkel, Zod strict), raden uendret.
8. **tomt input og uendret input:** `{}` og `{ status: "active" }` på en aktiv rad → ingen endring, ingen loggrad, `row_version` uendret.
9. **ukjent id, slettet rad, ikke-uuid (`"ikke-en-id"`):** `ConnectionNotFoundError`, ingenting endret.
10. **id fra B:** `updateConnection(adminA, orgA, idB, { status: "disabled" })` → `ConnectionNotFoundError`; raden i B er fortsatt `active`; ingen loggrad i A eller B.

### 3.6 Myk sletting

1. **merker:** `deleted_at` og `deleted_by` (= admins ansatt-id) satt; raden finnes i `select` uten filter; `listConnections` viser den ikke.
2. **allerede slettet:** `ConnectionNotFoundError`, `deleted_at`/`deleted_by` nøyaktig slik fabrikken satte dem.
3. **id fra B og ikke-uuid:** `ConnectionNotFoundError`, raden i B urørt, ingen loggrad i A eller B.
4. **ingen sletting noe sted:** statisk (5.2) og `select` uten filter i 3.6.1.

### 3.7 Revisjonslogg

1. **create:** `auditRows(orgA)` har én rad: `entityType: "integration_connection"`, `action: "create"`, `entityId` = tilkoblingens id, `organizationId` = A, `actorEmployeeId` = admins ansatt-id. `changes` har `port`, `provider`, `secretRef` (navnet) og nøklene i `settings` (for eksempel `settingsKeys: ["from", "tenantId", "clientId"]`); `JSON.stringify(rad)` inneholder ikke `noreply@example.com`, `t-oppdiktet`, `c-oppdiktet` eller `hemmelig-test-verdi`.
2. **update:** én rad med `action: "update"` og `changes.status = { from: "active", to: "disabled" }`; endret `settings.from` gir bare nøkkelen `from` i `changes` (for eksempel `settings: { keys: ["from"] }`), aldri gammel eller ny adresse; byttet `secretRef` gir gammelt og nytt navn.
3. **delete:** én rad med `action: "delete"`.
4. **én rad per handling:** etter create + update + delete er det nøyaktig tre rader.
5. **avvist handling gir ingen rad** (dekket i 3.2.10, 3.5.2, 3.5.4, 3.5.8).
6. **systemets egne skrivinger gir ingen rad:** dekkes i 8.2.5.

### 3.8 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`:** `listConnections`, `createConnection`, `updateConnection`, `markConnectionDeleted` gir `AccessDeniedError`; ingen rad laget eller endret; ingen loggrad.
2. **`admin`:** alle fire lykkes.
3. **to roller:** ansatt med `inspector` + `admin` kan alt.
4. **enkeltrettighet gir ikke tilgang:** takstmann med `grantPermission(…, "organization.manage")` får fortsatt `AccessDeniedError` (kan ikke gis, A21).
5. **deaktivert admin, ansatt uten roller, innlogget uten ansettelse i A:** `AccessDeniedError` på alle fire.
6. **admin stenges aldri ute (regel 11, skal aldri fjernes):** `access.inspectors_edit_all = false` i `organizations.settings`, admin uten sertifisering og uten enkeltrettigheter → alle fire lykkes.

### 3.9 Tenant-isolasjon (regel 2), tre `expectTenantIsolation`-kall

`seed` lager to tilkoblinger i hver organisasjon via fabrikken (`email` og `accounting/x`, siden unikheten er per port).

1. **`listConnections`:** `query = (actor, orgId) => listConnections(actor, orgId)`, `idOf = r => r.id`.
2. **`updateConnection`:** `query` prøver `updateConnection(actor, orgId, id, { status: "disabled" })` på **alle** id-er fra begge organisasjonene; `ConnectionNotFoundError` gir ingen rad, ellers `{ id }`. Etterpå: ingen rad i den andre organisasjonen er `disabled`.
3. **`findActiveConnection(orgId, port)`** (import fra `./connections`): `query` henter tilgangen med `requireOrganizationAccess(actor, orgId, "organization.manage")` (gir `AccessDeniedError` mot fremmed id) og kaller `findActiveConnection(grant.organizationId, port)` for `email` og `accounting`; returnerer radene som ble funnet.

### 3.10 `findActiveConnection` (import fra `./connections`)

1. **B har den eneste aktive:** A har ingen, B har `email/microsoft365` aktiv → `findActiveConnection(orgA, "email")` gir `null`.
2. **status:** `active` og `error` finnes; `disabled` og slettet gir `null`.
3. **port:** `findActiveConnection(orgA, "sms")` gir `null` selv om `email` finnes.
4. **organisasjon som ikke finnes** (tilfeldig uuid) → `null`, ingen feil.

### 3.11 Databasen

1. **indeks som starter med `organization_id`:** `pg_indexes` for `integration_connections` har minst én indeks hvis definisjon inneholder `(organization_id`.
2. **den delvise unike indeksen finnes:** `pg_indexes` har en indeks som er `UNIQUE`, har `organization_id` og `port`, og `WHERE (deleted_at IS NULL)` i definisjonen (3.3.5 viser at den virker).
3. **fremmednøkkel mot `organizations`:** rå `insert` med ukjent `organization_id` gir databasefeil.

## 4. (Utgått: `external_references` er fase 3)

Beholdes som tomt nummer så henvisninger i PR-en ikke forskyves. Ingen tester.

## 5. Statiske kontroller, `static-checks.test.ts` (mønster fra `src/core/files/static-checks.test.ts`)

1. Mappen `src/core/integrations` har kildefiler.
2. **ingen sletting:** ingen `.delete(` på `integrationConnections` i `src/` (unntatt tester).
3. **hemmeligheten leses ett sted:** ingen fil i `src/` utenom `src/shared/config/env.ts`, `src/core/integrations/secrets.ts` og `*.test.ts` matcher `/(env|getEnv\(\)|process\.env)\s*[.[]\s*["']?MS_GRAPH_CLIENT_SECRET/`. Strengen `"MS_GRAPH_CLIENT_SECRET"` som navn er lov.
4. **`process.env` leses ikke for hemmeligheter andre steder:** ingen fil i `src/core/email` eller `src/core/integrations` (unntatt `secrets.ts` og tester) inneholder `process.env`.
5. **interne funksjoner holdes inne:** `src/core/integrations/index.ts` og `src/core/email/index.ts` eksporterer ikke `findActiveConnection` eller `resolveEmailSender` (tekstsøk på navnene); ingen fil under `src/modules` eller `src/app` importerer fra `core/integrations/connections` eller `core/email/resolve`, eller nevner `findActiveConnection`/`resolveEmailSender`.
6. **Graph-adressene er faste:** `graph.ts` inneholder `login.microsoftonline.com` og `graph.microsoft.com/v1.0`, og ingen annen kildefil i `src/` gjør det.
7. **nektlisten er fullstendig:** `secrets.ts` inneholder alle de fem navnene i 2.8 (listen skrevet inn i testen).

## 6. Graph-adapteren, `graph.test.ts` (falsk `fetchFn`, aldri nett)

Hjelper i testen: `fakeFetch(plan)` som registrerer hvert kall (`url`, `init.method`, `init.headers`, `init.body`, `init.signal`) og svarer etter en plan per adresse. Standard: token-svar `{ access_token: "tok-1", expires_in: 3600 }` med 200, sending 202 uten kropp. `vi.spyOn(globalThis, "fetch")` i `beforeEach`; `expect(fetchSpy).not.toHaveBeenCalled()` i `afterEach` for hele filen. Oppsett: `{ tenantId: "t-oppdiktet", clientId: "c-oppdiktet", clientSecret: "hemmelig-test-verdi", from: "noreply@example.com" }`.

1. **sender riktig:** `send({ to: "a@example.com", subject: "Emne", text: "Hei" })` → kall 1 er `POST https://login.microsoftonline.com/t-oppdiktet/oauth2/v2.0/token` med `Content-Type: application/x-www-form-urlencoded` og kropp som inneholder `grant_type=client_credentials`, `scope=https%3A%2F%2Fgraph.microsoft.com%2F.default`, `client_id=c-oppdiktet`, `client_secret=hemmelig-test-verdi`; kall 2 er `POST https://graph.microsoft.com/v1.0/users/noreply%40example.com/sendMail` med `Authorization: Bearer tok-1`, `Content-Type: application/json`, kropp `{ message: { subject: "Emne", body: { contentType: "Text", content: "Hei" }, toRecipients: [{ emailAddress: { address: "a@example.com" } }] }, saveToSentItems: false }`.
2. **hemmeligheten står bare i token-kroppen:** `JSON.stringify` av kall 2 (adresse, headers, kropp) inneholder ikke `hemmelig-test-verdi`; adressen og headerne i kall 1 inneholder den heller ikke.
3. **ett token-kall per sending (ingen mellomlager):** to `send` etter hverandre → fire kall i rekkefølgen token, send, token, send.
4. **`tenantId` kodes i adressen:** `tenantId: "contoso.example"` gir `/contoso.example/oauth2/`; GUID-form `"0f1e2d3c-0000-4000-8000-000000000000"` godtas.
5. **token-svar uten `access_token`** (`{}` med 200): `EmailSendError` med `step: "token"`, ingen sending.
6. **feil fra token** (`it.each` 400, 401, 500): `EmailSendError` med `step: "token"`, `statusCode` = koden, ingen sending; `message` inneholder ikke svarteksten `{"error":"invalid_client","error_description":"AADSTS7000215 oppdiktet"}`, ikke `a@example.com`, `Emne`, `Hei` eller `hemmelig-test-verdi`.
7. **feil fra sending** (`it.each` 403, 429, 500): `EmailSendError` med `step: "send"` og koden; samme fravær i meldingen; token-kallet ble gjort én gang.
8. **`fetchFn` kaster** (`TypeError("fetch failed")` på token, og `DOMException` med navn `AbortError` på sending): `EmailSendError` med riktig `step` og `statusCode: null`; `message` inneholder ikke `fetch failed`; `cause` er `undefined`.
9. **tidsavbrudd settes:** begge kallene har `init.signal instanceof AbortSignal`.
10. **`provider`:** `sender.provider === "microsoft365"`.
11. **loggeren vasker feilen:** `logger.error("x", { error })` for feilen fra 6 gir en linje uten svartekst og uten `hemmelig-test-verdi` (viser at `EmailSendError` serialiseres som vanlig `Error`).
12. **ugyldig oppsett avvises når senderen lages:** `createGraphEmailSender` med `tenantId: "t/oppdiktet"`, `tenantId: ""`, `tenantId` på 65 tegn eller `from: "ikke-en-adresse"` kaster før noe kall; `fetchFn` er ukalt; feilmeldingen inneholder ikke `hemmelig-test-verdi`.

## 7. Valg av leverandør, `resolve.test.ts` (import fra `./resolve`)

### 7.1 Uten organisasjon (enhet, `env`-objekt som i dagens `email.test.ts`)

Fasit som tabell i testen (`it.each`):

| `DEV_MAILBOX` | tenant+klient+from satt | forventet `sender.provider` | `connectionId` |
|---|---|---|---|
| på | nei | `dev_mailbox` | `null` |
| på | ja | `dev_mailbox` | `null` |
| av | ja | `microsoft365` | `null` |
| av | nei | `server_log` | `null` |

1. **tabellen** over mot `resolveEmailSender({}, env)`.
2. **`microsoft365` leser hemmeligheten gjennom `readSecret`:** med `MS_GRAPH_CLIENT_SECRET` stubbet til `hemmelig-test-verdi` gir sending (falsk `fetchFn`) `client_secret=hemmelig-test-verdi` i token-kallet; uten stub avvises `send` med `SecretNotFoundError`. `env`-objektet har bevisst `MS_GRAPH_CLIENT_SECRET: "fra-env-objektet"`, og den verdien vises aldri i noe kall.
3. **`fetchFn` sendes videre:** senderen fra tabellen bruker `options.fetchFn`, `globalThis.fetch` er ukalt.

### 7.2 Med organisasjon (integrasjon)

1. **aktiv `microsoft365`-tilkobling** i A med `settings` `{ from: "org@example.com", tenantId: "t-org", clientId: "c-org" }` og `secretRef: "ORG_HEMMELIGHET"` (stubbet til `hemmelig-org-verdi`) → `provider === "microsoft365"`, `connectionId` lik radens id, token-kallet bruker `t-org`, `c-org`, `client_secret=hemmelig-org-verdi`, sendingen går til `/users/org%40example.com/`. Miljøet har samtidig de fire `MS_GRAPH_*` satt til andre verdier, som **ikke** brukes.
2. **`disabled` tilkobling** → systemvalget (`server_log` når miljøet er tomt, `microsoft365` fra miljøet når de fire er satt), `connectionId` `null`.
3. **ingen tilkobling** → systemvalget, `connectionId` `null`.
4. **`error`-tilkobling** brukes (status ulik `disabled`), `connectionId` satt.
5. **`DEV_MAILBOX` vinner** også med aktiv `microsoft365`-tilkobling: `dev_mailbox`, `connectionId` `null`, ingen `fetchFn`-kall.
6. **B sin tilkobling brukes aldri for A:** bare B har en aktiv `microsoft365` → A får systemvalget, `connectionId` `null`.
7. **organisasjon som ikke finnes** (tilfeldig uuid) → systemvalget, ingen feil.
8. **svikt på tilkoblingen gir fortsatt `connectionId`:** aktiv `microsoft365`-rad med `secretRef: "FINNES_IKKE"` → `connectionId` satt, og `sender.send(...)` avvises med `SecretNotFoundError`. Samme med ugyldige `settings` på raden (fabrikken setter `{ from: "ikke-en-adresse" }`): `send` avvises, `fetchFn` ukalt.
9. **ny sender per kall:** første kall gir `microsoft365`; admin setter raden `disabled`; neste kall gir systemvalget. Ingen modultilstand mellom kallene.
10. **`server_log`-tilkobling i tabellen** gir `server_log` med `connectionId` satt (slik at 8.2.1 kan vise `last_ok_at` uten Graph).

## 8. `sendEmail`, `email.test.ts` (oppdatert)

### 8.1 Som i dag (oppdaterte navn)

1. Dagens tester beholdes med `devMailbox` → `dev_mailbox`, `graph` → `microsoft365`, `serverLog` → `server_log`, `sendEmail(email, env)` → `sendEmail(email, undefined, env)`, og `emailTransport(env)` → `(await resolveEmailSender({}, env)).sender.provider`.
2. **«graph kaster fortsatt feilen om fase 0b» tas ut** og erstattes av: `sendEmail(email, { fetchFn: fakeFetch }, { ...env, ...graph })` med `MS_GRAPH_CLIENT_SECRET` stubbet → sendingen går gjennom den falske `fetchFn` (ett token-kall, ett sendekall), `globalThis.fetch` ukalt.
3. **`readDevMailbox`** gir tom liste når `DEV_MAILBOX` er av; 50 siste beholdes (51 sendinger → 50 rader, nyeste først).
4. **`server_log` uendret:** dagens seks tester går grønne.

### 8.2 Gjennom en tilkobling (integrasjon; `DEV_MAILBOX` av i `env`)

1. **suksess setter `last_ok_at` og `active`:** A har `email/server_log`-tilkobling i `error` med `last_error: "gammel feil"`; `sendEmail({ to: SEED_ADMIN_EMAIL, …, logLine }, { organizationId: orgA }, env)` → raden har `last_ok_at` satt (innen testens tidsrom), `status = active`, `last_error` tom.
2. **feil setter `last_error` og `error`:** samme tilkobling i `active` med `last_ok_at` satt, mottaker `annen@example.com` → `sendEmail` kaster (`NOT_CONFIGURED`-meldingen), raden har `status = error`, `last_error` satt, `last_ok_at` uendret.
3. **`last_error` er vasket:** `microsoft365`-tilkobling med falsk `fetchFn` som kaster `new Error("til a@example.com kode 123456 client_secret=hemmelig-test-verdi +47 912 34 567" + "x".repeat(2000))` → `last_error` inneholder ikke `a@example.com`, `hemmelig-test-verdi` eller telefonnummeret; lengden er høyst 500 tegn. (Meldingen i `EmailSendError` er alt fast; testen viser at `scrubText` er på plass hvis en annen feiltype slipper gjennom.)
4. **svikt før sending teller:** `microsoft365`-tilkobling med `secretRef: "FINNES_IKKE"` → `SecretNotFoundError` kastes videre, raden får `status = error` og `last_error` som inneholder `FINNES_IKKE`, aldri noen verdi.
5. **ingen revisjonslogg** for 1, 2, 3 og 4: `auditRows(orgA)` er tom (admin har ikke gjort noe), `row_version` kan øke eller stå; testen låser ikke det.
6. **systemvalget skriver ingenting:** ingen tilkobling i A, sending via `server_log` → tabellen er tom etterpå; `disabled` tilkobling → raden uendret (`row_version`, `last_ok_at`, `last_error`).
7. **`DEV_MAILBOX` skriver ingenting:** aktiv tilkobling + `DEV_MAILBOX` på → raden uendret, e-posten ligger i postkassen.
8. **feilen kastes videre etter skrivingen:** `await expect(...).rejects` og så er raden alt oppdatert (ikke først ved neste kall).
9. **B sin rad røres ikke:** A sender og feiler; B sin tilkobling har fortsatt `last_error` tom og `status = active`.
10. **`fetch` aldri kalt:** spion i `beforeEach`/`afterEach` for hele filen.
11. **ugyldige `settings` på raden teller som feil:** rå rad (fabrikken) `microsoft365` med `settings: {}` og gyldig `secretRef` (stubbet) → `sendEmail` kaster, raden får `status = error` og `last_error` satt, `fetchFn` ukalt, ingen loggrad.
12. **ny sending etter feil:** etter 11 settes `settings` riktig med `updateConnection` (admin) → neste `sendEmail` med falsk `fetchFn` lykkes, raden er `active` med `last_error` tom og `last_ok_at` satt; revisjonsloggen har nøyaktig én rad (admins `update`).

## 9. Loggeren, `logger.test.ts` (utvidet, egen `describe("logger vasker Microsoft 365-hemmeligheter")`)

1. **`client_secret=` i tekst:** `"grant_type=client_credentials&client_id=c&client_secret=hemmelig-test-verdi&scope=x"` → `client_secret=[fjernet]`, `client_id=c` og `scope=x` står.
2. **i feilmelding:** `logger.error("x", { error: new Error("…client_secret=hemmelig-test-verdi …") })` → linjen inneholder ikke verdien.
3. **nøkler:** `clientSecret`, `client_secret`, `CLIENT_SECRET` blir `[fjernet]`; `secretRef` og `clientId` står.
4. **ingen overvasking:** `client_secret_name=MS_GRAPH_CLIENT_SECRET` står urørt (mønsteret krever `=` rett etter `client_secret`).
5. **`scrubText` direkte:** `scrubText("client_secret=abc def")` → `"client_secret=[fjernet] def"` (stopper ved mellomrom), `scrubText("client_secret=abc&x=1")` → `"client_secret=[fjernet]&x=1"` (stopper ved `&`).

## 10. Fabrikken, `tests/factories.test.ts`

1. `createIntegrationConnection(orgA)` gir rad i A med `port: "email"`, `provider: "server_log"`, `status: "active"`, `settings: {}`, `secret_ref` tom.
2. Overstyringene `port`, `provider`, `status`, `secretRef`, `settings`, `lastOkAt`, `lastError`, `deletedAt`, `deletedBy` står på raden; fabrikken validerer ikke (`provider: "x"` og `settings: { from: "ikke-en-adresse" }` godtas).
3. Testen «truncate-listen har alle tabellene i databasen» går grønn med den nye tabellen, og `resetDatabase` tømmer `integration_connections`.

## 11. Migrering og e2e (kjøres av test-leder, ikke egne tester)

1. `pnpm db:migrate` på tom database, deretter `pnpm db:generate` → ingen ny migreringsfil, ingen diff (den delvise indeksen må stå i Drizzle-skjemaet med `.where(sql\`deleted_at is null\`)`, ellers lager generate en diff).
2. `pnpm test:e2e` for `pc` og `ipad` grønn uendret, særlig `e2e/fase-0a.spec.ts` (innlogging via `/dev/epost`), `e2e/fase-0b-sperre-innlogging.spec.ts` og `e2e/fase-1-prove-f-innlogging.spec.ts`. Ingen nye e2e-tester: ingen skjerm, ingenting virker uten nett i denne oppgaven. iPad-størrelse dekkes ved at `ipad`-prosjektet kjører innloggingstestene.
3. `/api/helse` viser 0.2.53 (eller neste ledige patch over `main`).

## 12. Kontroller i gjennomgangen (test-leder)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- `git diff main -- src/core/files src/modules` er tom (filtjenesten og prøvemodulene røres ikke).
- **Tre** `expectTenantIsolation`-kall finnes i `connections.test.ts` (3.9.1–3.9.3).
- Rollematrisen 3.8 og «admin stenges aldri ute» (3.8.6) finnes.
- `index.ts` i `integrations` og `email` eksporterer ikke `findActiveConnection`/`resolveEmailSender` (5.5).
- Ingen testfil importerer fasiten (portlisten, leverandørlistene, statusene, valgtabellen, nektlisten) fra koden.
- Ingen ekte verdier i `.env.example` (kommentaren om `readSecret` er der, verdiene tomme), ingen `@`-adresser utenfor `example.com` i testene, ingen produktnavn i `src/` utenom `brand.ts`, ingen modellnavn.
- `RESET_TABLES` har `integration_connections`, migreringen `0011_tilkoblinger.sql` finnes, `docs/05-domenemodell.md` 4.10 og ordlisten oppdatert, A44 og videre i `docs/09-apne-sporsmal.md`, versjon økt, «Trenger Ståle når han er tilbake» oppdatert i tilstandsfilen.
- **Avvises** hvis 3.8, 3.9, 2.8, 3.2.8, 3.5.3 eller 7.2.8 mangler, hvis noen e-posttest kaller `globalThis.fetch`, hvis `hemmelig-test-verdi` kan finnes i noen loggutskrift, feilmelding eller `audit_log`-rad i testkjøringen, eller hvis en test leser en ekte miljøvariabel for hemmeligheter uten `vi.stubEnv`.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Migreringen lager tabellen og den delvise indeksen, ingen diff etter generate | 3.3.5, 3.11, 10.3, 11.1 |
| `organization.manage` for de fire funksjonene, admin får alt | 3.8 |
| `expectTenantIsolation` for `listConnections` og `updateConnection` | 3.9.1, 3.9.2 |
| `findActiveConnection` finner aldri B sin rad | 3.9.3, 3.10.1, 7.2.6 |
| Ukjent port/leverandør/par, `secretRef` (også nektlisten), ukjent nøkkel avvises før skriving | 3.2, 2.8 |
| `microsoft365` krever `secretRef` og `settings` med `from`/`tenantId`/`clientId`; de to andre tomme `settings` | 3.2.5–3.2.7, 3.5.5–3.5.6 |
| Én per organisasjon og port blant ikke-slettede, også `disabled`; ny etter myk sletting; databasen stopper rå dublett | 3.3 |
| `updateConnection` bare `active`/`disabled`; port og leverandør låst; `settings` mot radens leverandør; `secretRef` ikke fjernes; `last_error` beholdes; tomt input ingen loggrad | 3.5 |
| Ukjent id, ikke-uuid, slettet, annen organisasjon gir «ikke funnet» uten endring | 3.5.9, 3.5.10, 3.6.2, 3.6.3, 3.9.2 |
| Revisjonslogg én rad per handling, organisasjonen fra tilgangssjekken, aldri adresse eller hemmelighet | 3.7 |
| `readSecret` verdi, mangler, tom streng, ugyldig navn uten å lese miljøet | 2.1–2.6 |
| Nektlisten i `readSecret` og i tjenesten | 2.8, 3.2.8, 3.5.4, 5.7 |
| Hemmeligheten leses ett sted (statisk), `env.ts` beholder «alle fire eller ingen» | 5.3–5.4, 7.1.2 |
| Interne funksjoner ikke eksportert og ikke importert fra `src/app`/`src/modules` | 5.5 |
| `resolveEmailSender` følger fasit-tabellen, ny sender per kall | 7.1, 7.2 |
| `sendEmail` uten organisasjon som i dag; `/dev/epost` lokalt | 7.1, 8.1, 11.2 |
| `last_ok_at`/`active` ved suksess, `last_error`/`error` ved feil (også før sending), feil videre, ingen loggrad; `dev_mailbox` og systemvalget skriver ingenting | 8.2 |
| Graph-adapteren: ett token-kall og ett sendekall, koding av `from` og `tenantId`, hemmeligheten bare i token-kroppen, `AbortSignal`, feilkoder, `fetchFn` som kaster, tomt token-svar, ugyldig oppsett | 6 |
| Ingen test gjør nettkall | 6 (afterEach), 7.1.3, 7.2.5, 8.2.10 |
| Loggeren vasker `client_secret=` og nøkkelen `clientSecret`, `secretRef` står | 2.7, 9 |
| Bruker i annen organisasjon får ikke tilgang | 3.9, 7.2.6, 8.2.9 |
| Virker på iPad-størrelse (innlogging grønn på `ipad`) | 11.2 |
| Alle sjekker grønne, ingen ny avhengighet, ingen produktnavn, ingen modellnavn | 12 |
