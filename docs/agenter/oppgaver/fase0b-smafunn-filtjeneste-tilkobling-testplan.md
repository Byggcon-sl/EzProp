# Testplan: Liten oppgave (o), (p) og (q) – småfunn fra filtjenesten, tilkoblingslaget og tenant-testen

- **Oppgavekort:** `docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling.md`
- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Branch:** `fase0b-smafunn-filtjeneste-tilkobling` (bygger på `main`)
- **Laget av:** test-leder, 03.11.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: en tilkobling admin har slått av, blir stående av; admin ser den ekte sendefeilen; hemmeligheter slipper aldri gjennom loggen som feltnavn eller tekst; vakten i tenant-testen navngir tabellen som mangler. Tid: færre doble tester og én hjelper i stedet for to kopier gir mindre å vedlikeholde og raskere CI. KI først: ikke direkte (grunnmur).

## Hva som skal vises

1. **Statusreglene for tilkoblinger holder under press:** `error` → `active` ved vellykket sending; `disabled` og slettet rad røres aldri, verken ved suksess eller feil; en databasefeil ved statusskriving overskygger aldri sendefeilen og stopper aldri en sending som alt er gjort.
2. **Loggen lekker ikke:** `Client_Secret=`/`CLIENT_SECRET=` i tekst vaskes med skrivemåten beholdt; feltnavn som slutter på `connectionstring`, `accountkey`, `clientsecret`, `secret`, `token`, `password`, `passord`, `apikey` gir `[fjernet]`; `secretRef`, `secret_ref` og `clientId` står. `saveFile`/`readFile` logger nok til å feilsøke, uten sti, nøkkel eller hemmelighet.
3. **Tenant-isolasjon for den nye spørringen** `recordConnectionResult` (regel 2): `expectTenantIsolation` 3.9.4 pluss håndtest 3.9.5. De fire eksisterende kallene (`findActiveConnection`, `listConnections`, `readFile`, `markFileDeleted`) står urørt.
4. **Vakten U1** sammenligner navnelister og navngir tabellen som mangler, med selvtester som viser begge retningene.
5. **Ryddingen fjerner bare det som er dekket et annet sted:** hvert akseptkriterium i kortene for PR #62 og PR #64 har fortsatt minst én test (kart nederst), og grep-kriteriene i kortet er grønne.

Fast oppsett: `resetDatabase` i `beforeEach` for sakene mot databasen (som i dag). `logger.error` spioneres på med `vi.spyOn(logger, "error")` som retention-testene gjør med `warn`, og feltene sjekkes via `formatLogLine`. `globalThis.fetch` spioneres på i alle nye e-post- og config-tester og skal være ukalt.

## 1. Enhetstester uten database

### `src/shared/lib/logger.test.ts` (ny gruppe «logger vasker feltnavn med prefiks», pluss utvidelse av Microsoft 365-gruppen)

| Test | Viser |
|---|---|
| M365 1b. `scrubText("Client_Secret=abc")` → `Client_Secret=[fjernet]` | `i`-flagget er på og skrivemåten beholdes (`$1=`-varianten). |
| M365 1c. `scrubText("CLIENT_SECRET=abc&x=1")` → `CLIENT_SECRET=[fjernet]&x=1` | Store bokstaver vaskes, resten av strengen står. |
| M365 4 (beholdes) `client_secret_name=…` står urørt | Ingen overvasking etter endringen. |
| P1. `sanitizeFields({ FILE_STORAGE_AZURE_CONNECTION_STRING: "x" })` → `[fjernet]` | Suffiks `connectionstring` treffer med prefiks. |
| P2. `fileStorageAzureConnectionString` (camelCase) → `[fjernet]` | Normaliseringen virker for begge skrivemåter. |
| P3. `MS_GRAPH_CLIENT_SECRET` → `[fjernet]` | Suffiks `clientsecret`/`secret` med prefiks. |
| P4. `MS_GRAPH_ACCESS_TOKEN` → `[fjernet]` | Suffiks `token` med prefiks (LITE 3 fra sikkerhet-personvern). |
| P5. `it.each(["secretRef", "secret_ref", "clientId", "client_id"])` står urørt | Mønsteret er «slutter på», ikke «inneholder»: `secretref` og `clientid` treffes ikke. |
| P6. Nøkkel dypt i objekt (`{ config: { storage: { FILE_STORAGE_AZURE_CONNECTION_STRING } } }`) → `[fjernet]` | Vaskingen går ned i objektet som før. |
| Eksisterende Azure 3 og M365 3 (nøkler i objekter) | Regresjon: `connectionString`, `CONNECTION_STRING`, `accountKey`, `sas`, `clientSecret`, `client_secret` gir fortsatt `[fjernet]`. |

### `src/core/files/config.test.ts`

| Test | Viser |
|---|---|
| 5 (omgjort til `it.each(["s3", "tull"])`) ukjent driver gir `FileStorageConfigError` | «tull»-saken fra (o) er med; ingen stille fallback. |
| 6 (ny). `FILE_STORAGE_DRIVER=azure`, oppdiktet tilkoblingsstreng (`DefaultEndpointsProtocol=https;AccountName=oppdiktet;AccountKey=b3BwZGlrdGV0;EndpointSuffix=core.windows.net`) og `FILE_STORAGE_AZURE_CONTAINER=filer` gir port med `driver === "azure"`; `vi.spyOn(globalThis, "fetch")` er ukalt; verken `put` eller `get` kalles | Konfigurasjonen bygger Azure-adapteren uten nett. |

### `src/core/files/local-storage.test.ts` og `azure-storage.test.ts`

| Test | Viser |
|---|---|
| Lokal 1 og Azure 1: «ikke Buffer» → `bytes instanceof Uint8Array` og `Array.from(bytes)` lik innholdet | `toPlainBytes` er borte; adapterne gir `Uint8Array` med riktig innhold. |
| Importene endres til `./local-storage` / `./azure-storage` (ikke `./index`) | Eksportene er fjernet fra `src/core/files/index.ts`. |
| Azure 6 redusert til én sak: `../x` avvises, klienten ukalt | Nøkkelkontrollen kjører før klienten; resten av nøkkelfasiten står i lokal 4. |

### `src/core/files/retention.test.ts`

| Test | Viser |
|---|---|
| 3: alle ugyldige verdier for én nøkkel, pluss én ugyldig verdi for hver av de to andre | Fasiten kjøres én gang, ikke tre; hver nøkkel er fortsatt med. |
| 4: tilsvarende for gyldige verdier | Som over. |

### `src/core/integrations/ports.test.ts`

| Test | Viser |
|---|---|
| 4 fjernes | Typen `Record<IntegrationPort, …>` låser det samme ved `pnpm typecheck`. 1–3 står. |

### `tests/tenant-isolation-all-tables.test.ts` (U1 omskrevet, (q))

| Test | Viser |
|---|---|
| U1. `compareTableLists([...tenantTableNames, ...globalTableNames], RESET_TABLES)` gir `{ missingInResetTables: [], missingInSchema: [] }`; fortsatt unike navn, `notNull` på `organization_id`, og `employee_roles`/`files` er med | Tallet 6 er borte; en glemt tabell gir navnet i meldingen. |
| U1b. Hjelperen med ett ekstra skjemanavn (`"oppdiktet_tabell"`) → `missingInResetTables: ["oppdiktet_tabell"]`, `missingInSchema: []` | Retning skjema → `RESET_TABLES`. |
| U1c. Hjelperen med ett ekstra `RESET_TABLES`-navn → `missingInSchema: ["oppdiktet_tabell"]`, `missingInResetTables: []` | Retning `RESET_TABLES` → skjema. |
| U2 (uendret) | De seks globale låses fortsatt ved navn. |

### `src/core/integrations/static-checks.test.ts`

| Test | Viser |
|---|---|
| 5 utvidet med `recordConnectionResult` i både regex og navnelisten | Hjelperen eksporteres ikke fra `src/core/integrations/index.ts` eller `src/core/email/index.ts`, og brukes ikke fra `src/app` eller `src/modules`. |
| 7 fjernes | `secrets.test.ts` 8 viser nektlisten ved oppførsel for alle fem navnene. |

### Grep-kriterier (kjøres av test-leder, kan også stå som statiske tester)

- Bare én `isUniqueViolation` i `src/` (i `src/core/organization/errors.ts`), og `connections.ts` kaller den med `UNIQUE_INDEX`.
- `microsoft365SettingsSchema` eksporteres ikke; `.parse(` finnes ikke i `resolve.ts` (bare `safeParse` én gang per kall).
- `toPlainBytes`, `IntegrationConnectionRecord`, `FileRecord`, `createAzureFileStorage`/`createLocalFileStorage`/`isInsideRoot` i `files/index.ts`, `export const DEFAULT_FILE_STORAGE_DIR` og `executor` i `findActiveConnection` er borte.
- `findActiveFile` eksporteres fortsatt; `.for("update")` står i `markFileDeleted`.
- `integrations.dev.test.ts` finnes ikke.
- `.env.example` har ingen linje som starter med `FILE_STORAGE_DRIVER=` eller `FILE_STORAGE_DIR=`; `start.sh` er uendret (`git diff main -- start.sh` tom).
- `git diff main --stat` har ingen fil under `drizzle/` eller `src/core/access/`, og `src/db/schema` bare fjernede typelinjer.

## 2. Integrasjonstester mot testdatabasen

### `src/core/integrations/connections.test.ts` – ny gruppe «3.12 recordConnectionResult»

Oppsett: rad via `createIntegrationConnection(orgA.id, { status, lastError, lastOkAt })`, `before = connectionRow(id)`, kall hjelperen, sammenlign. `recordConnectionResult` importeres fra `./connections` (ikke fra `./index`).

| Test | Viser |
|---|---|
| 3.12.1 (a) rad i `error` med `last_error = "gammel feil"`; `{ ok: true }` → `active`, `last_ok_at` satt (innen ±1 s), `last_error` null | Hovedregelen `error` → `active`. |
| 3.12.2 (b) rad i `disabled`; `{ ok: true }` → raden er `toEqual(before)` | `disabled` røres aldri. |
| 3.12.3 (c) rad med `deleted_at` satt (status `error`); `{ ok: true }` → `toEqual(before)` | Slettet rad røres aldri (filter på `deleted_at`). |
| 3.12.4 (d) rad i `disabled`; `{ ok: false, error: "x" }` → `toEqual(before)` | Feil skriver heller ikke til `disabled`. |
| 3.12.5 (d′) rad med `deleted_at` satt; `{ ok: false, error: "x" }` → `toEqual(before)` | Feil skriver ikke til slettet rad. |
| 3.12.6 rad i `active`; `{ ok: false, error: "x" }` → `error`, `last_error = "x"`, `last_ok_at` uendret | `active` → `error` ved feil. |
| 3.12.7 (f) `error` på 600 tegn → `last_error.length <= 503` og slutter på « …» (som `scrubText` gir); `client_secret=abc` i meldingen gir `client_secret=[fjernet]` | Ingen ekstra `.slice`; `scrubText` kutter og vasker. |
| 3.12.8 `vi.spyOn(db, "update").mockImplementation(() => { throw new Error("db nede") })`; `{ ok: false, error: "sendefeil" }` → resolver uten å kaste; `logger.error` kalt én gang med `"Kunne ikke oppdatere status på en tilkobling"` og feltene `connectionId` og `error`; `formatLogLine` av kallet inneholder ikke `"sendefeil"`-mottaker, emne eller tekst (hjelperen får dem aldri) | Hjelperen kaster aldri, og logger fast tekst. |
| 3.12.9 ingen rad i revisjonsloggen etter 3.12.1 og 3.12.6 | Systemets egne skrivinger logges ikke (som 8.2.5). |

### `src/core/integrations/connections.test.ts` – gruppe 3.9 (tenant-isolasjon, regel 2)

| Test | Viser |
|---|---|
| 3.9.4 `expectTenantIsolation` for `recordConnectionResult`: `seed` legger to rader i `error` i A og B (`email` og `accounting/x`); `query` henter grant med `organization.manage`, kaller `recordConnectionResult(grant.organizationId, id, { ok: true })` for **alle** seedede id-er (A og B), og returnerer radene i egen organisasjon som ble `active`; `idOf: (row) => row.id` | A kan bare endre egne rader; fremmed organisasjon nektes; admin i B ser bare B. |
| 3.9.5 håndtest: A kaller `recordConnectionResult(orgA.id, idB, { ok: true })` og `{ ok: false, error: "x" }`; B-raden er `toEqual(before)` (fortsatt `error`, `last_ok_at` null, `last_error` som før) | A sender med B sin `connectionId` og endrer ingenting i B. |
| 3.9.1–3.9.3 uendret | De eksisterende kallene står. |

### `src/core/integrations/connections.test.ts` – 3.2 validering

| Test | Viser |
|---|---|
| 3.2 ni `server_log`-saker erstattet av én: `server_log` på `accounting` avvises; `sendgrid` på `email` og `microsoft365` på `accounting` beholdes | Leverandør-mot-port sjekkes; ingen ni kopier. |
| 3.2.x (ny) `clientId` på 129 tegn og `from` på 255 tegn (`"a".repeat(243) + "@example.com"`) → `ConnectionValidationError`, ingen rad, ingen loggrad | Øvre grense håndheves. |
| 3.2.y (ny, positiv kontroll) `clientId` på 128 tegn og `from` på 254 tegn (`"a".repeat(242) + "@example.com"`) → rad opprettes | Grensen er nøyaktig 128/254, ikke lavere. |

### `src/core/email/email.test.ts` – 8.1 og 8.2

| Test | Viser |
|---|---|
| 8.1: 1b, 1c, 1e, 1f fjernes; 1a og 1d står | Fasiten for valg av leverandør er `resolve.test.ts` 7.1.1. |
| 8.2.1 (beholdes) `error` → `active`, `last_ok_at` satt, `last_error` null, ingen loggrad | Akseptkriterium 1. |
| 8.2.2, 8.2.3, 8.2.4, 8.2.8, 8.2.9 (beholdes) | Feil → `error`, vasket `last_error`, feilen kastes videre, B røres ikke. |
| 8.2.13 (ny) rad i `disabled`: `resolveEmailSender` gir systemvalget, så suksess (`ADMIN_EMAIL`) og feil (`OTHER_EMAIL` → kastes videre) endrer ingenting på raden (`toEqual(before)`) | «Disabled: to utfall». Overlapper 6b; 6b slås inn i 13 eller fjernes. |
| 8.2.13b (ny) rad i `error` som settes `disabled` av en «samtidig admin» **etter** at `resolveEmailSender` har valgt raden: `fetchFn` som i sendekallet oppdaterer raden til `disabled` (via `db.update` i den falske `fetch`-planen) og svarer 202; etter `sendEmail` er raden fortsatt `disabled`, `last_ok_at` null | Selve feilen fra (p): sending som pågår slår ikke raden på igjen. |
| 8.2.13c (ny) samme som 13b, men raden settes `deleted_at` under sendingen → raden uendret bortsett fra `deleted_at` | Slettet rad røres ikke av sending som pågikk. |
| 8.2.14 (ny) `vi.spyOn(db, "update")` som kaster; `fetchFn` svarer 500 på sending → `rejects.toBeInstanceOf(EmailSendError)` (sendefeilen, ikke databasefeilen); `logger.error` kalt én gang med fast tekst; raden uendret | Databasefeil overskygger ikke sendefeilen. |
| 8.2.15 (ny) `vi.spyOn(db, "update")` som kaster; `fetchFn` svarer 202 → `sendEmail` resolver; `logger.error` kalt én gang; raden står i `error` | Statusskriving som svikter stopper aldri en sending som er gjort. |
| 8.2.16 (ny) `fetchFn` ukalt og `globalThis.fetch` ukalt i 13–15 der sending ikke skjer (`disabled` → systemvalget `server_log`) | Ingen nett. |

Merk for testskriver: `db` er ett objekt (`src/db/client.ts`), så `vi.spyOn(db, "update")` virker; `vi.restoreAllMocks()` i `afterEach`. Spionen må settes **etter** `createIntegrationConnection`-fabrikken har kjørt (fabrikken bruker `insert`, ikke `update`, men hold rekkefølgen tydelig).

### `src/core/files/files.service.test.ts`

| Test | Viser |
|---|---|
| 6.1.4 utvidet: `vi.spyOn(logger, "error")` → kalt én gang med `"Kunne ikke lagre raden for en fil"` og feltene `organizationId` og `error`; `JSON.stringify(formatLogLine("error", msg, fields))` inneholder `params: [fjernet]` og verken `SECRET`, `tmp`, lagringsnøkkelen eller `testfeil fra trigger`-teksten etter `params:` | Databasefeilen logges, vasket. |
| 6.1.5 utvidet: `logger.error` kalt én gang med `"Fil lest fra lagringen stemmer ikke med raden"` og nøyaktig feltene `{ organizationId, fileId }`; linjen inneholder ikke `row.storageKey` eller `tmp`; begge tilfellene (annet innhold, annen lengde) gir hver sin rad | Integritetsfeil logges uten nøkkel. |
| 6.3.6 fjernes | Typen, `static-checks` 2 og 6.3.1 dekker «ingen sletting i porten». |
| 6.3.7 (ny) to samtidige `markFileDeleted(admin, org, id)` med `Promise.allSettled` → én `fulfilled`, én `rejected` med `FileNotFoundError`; nøyaktig én rad i `audit_log` for organisasjonen; `deleted_at` satt én gang | `.for("update")` gjør «les `retain_until`, så merk» atomisk; den andre ser raden som slettet. |
| 6.4.2 utvidet: `it.each(["inspector", "office", "manager"])` → `AccessDeniedError`, raden `toEqual(before)`, **og** `auditRows(org.id)` er `[]` | Nektet kall skriver ingen loggrad. |
| 6.7.1–6.7.4 uendret | De fire `expectTenantIsolation`-kallene står. |

### `tests/factories.test.ts`

| Test | Viser |
|---|---|
| `createFile` 2: importen av `createLocalFileStorage` flyttes til `@/core/files/local-storage` | Eksporten er borte fra `@/core/files`; testen er ellers lik. |

### `tests/fake-fetch.ts`

| Endring | Viser |
|---|---|
| Svarlister, funksjonssvar og de fire konstantene fjernes eller gjøres interne; `graph.test.ts`, `email.test.ts` og `resolve.test.ts` er fortsatt grønne | Ingen test bruker dem. Hvis 8.2.13b trenger et funksjonssvar for «oppdater raden i sendekallet», beholdes funksjonssvar (begrunnes i PR-en) eller testen bruker `fetchFn` skrevet rett i testen. |

### Fjernet fil

- `src/core/integrations/integrations.dev.test.ts` slettes. Dekning: `logger.test.ts` 4, `resolve.test.ts` 2 og 7.2.1/7.2.8a, `connections.test.ts` 3.7, 3.9.1, 3.9.3, 3.5.9/3.5.10, 3.2.

## 3. Regeltester (testsaker som data)

Ingen regler eller TG-logikk i oppgaven. Statusreglene for tilkoblinger (`error` → `active`, `active`/`error` → `error`, `disabled` og slettet røres aldri) er ikke data, men kode, og dekkes av 3.12 og 8.2 over med alle fire tilstander × to utfall.

## 4. E2E (Playwright, pc og iPad 1194×834)

Ingen ny skjerm. Kravet er at den eksisterende kjøringen er grønn i begge prosjektene (`pnpm test:e2e`). Ingen nye spec-filer. Uten nett: ikke relevant (ingen klientendring).

## 5. Alltid med

| Krav | Dekning |
|---|---|
| Tilgang per rolle | 6.4.1–6.4.7 og 3.8.1–3.8.6 uendret; 6.4.2 utvidet med «ingen loggrad». `recordConnectionResult` har ingen actor (intern, som `findActiveConnection`) og kalles bare med `grant.organizationId`; kontroll: statisk test 5 og grep på kallstedene (`email/index.ts` sender `options.organizationId`, som bare er satt fra en grant). |
| Tenant-isolasjon for hver ny spørring | 3.9.4 (`expectTenantIsolation`) og 3.9.5 (håndtest) for `recordConnectionResult`. De fire eksisterende kallene står. `tests/tenant-isolation-all-tables.test.ts` kjører som før (ingen ny tabell). |
| Admin stenges aldri ute | 6.5.1–6.5.2 og 3.8.6 uendret. Ingen ny tilgangsregel. |
| Myk sletting | 3.12.3, 3.12.5, 8.2.13c (slettet tilkobling røres ikke); 6.3.1, 6.3.7 og `static-checks` 2 (filer slettes aldri); `static-checks` (integrations) 2 (ingen `.delete(`). |

## 6. Dekningskart: akseptkriteriene i kortene for PR #62 og PR #64 etter ryddingen

| Kriterium (PR #62, filtjenesten) | Test etter rydding |
|---|---|
| Rundtur samme innhold/SHA-256 | 6.1.1, lokal 1 |
| Endret fil gir feil | 6.1.5 |
| Ugyldige nøkler avvises, løst sti utenfor rot | lokal 4 og 5, Azure 6 (én sak) |
| `put` to ganger | lokal 3, Azure 2–3 |
| `storage_key`-format | 6.1.3 |
| 25 MB-grense, tom fil | 6.2.1a/1b/2 |
| Ugyldig `kind`/filtype | 6.2.3/4 |
| Radfeil: ingen rad, ingen sti/hemmelighet | 6.1.4 (utvidet) |
| `markFileDeleted` + loggrad | 6.3.1, 6.3.2 |
| `retain_until` | 6.3.3, 6.3.4 |
| Rollematrise | 6.4.1–6.4.7 |
| Admin stenges ikke ute | 6.5.1–6.5.2 |
| Azure-adapter, config-feil, standard lokal | Azure 1–5, config 1–6 |
| Loggeren vasker Azure | logger Azure 1–4 (+ P1/P2) |
| `readFileRetention` | retention 1–5 (slanket 3–4) |
| Fremmed fil-ID i egen organisasjon | 6.6.1–6.6.3 |
| `expectTenantIsolation` per operasjon | 6.7.1–6.7.4 |
| Unik `(organization_id, storage_key)` | 6.8.1 |
| Faste koder `FILE_KINDS`/`MAX_FILE_BYTES` | 6.2.5 (beholdes), 6.2.1a |

| Kriterium (PR #64, tilkoblingslaget) | Test etter rydding |
|---|---|
| Migrering/indeks | 3.11.1–3.11.3 |
| `organization.manage` per rolle, ingen loggrad | 3.8.1–3.8.6 |
| `expectTenantIsolation` list/update | 3.9.1–3.9.2 |
| `findActiveConnection` aldri B | 3.9.3, 3.10.1, resolve 7.2.6 |
| Valideringsfasit før skriving | 3.2 (slanket), secrets 5–6 |
| `microsoft365`-settings, lengder | 3.2 + nye 3.2.x/3.2.y |
| Én per port, delvis indeks | 3.3.1–3.3.5 |
| `updateConnection`-regler | 3.5.1–3.5.10 |
| Ukjent id/slettet/B | 3.5.9–3.5.10, 3.6.2–3.6.3 |
| Revisjonslogg uten verdier | 3.7.1–3.7.4 |
| `readSecret`, ugyldige navn | secrets 1–7 |
| Nektlisten | secrets 8 (statisk 7 fjernes) |
| Statisk: hemmeligheten leses ett sted | integrations static 3–4 |
| Statisk: laget holdes inne | integrations static 5 (utvidet) |
| `resolveEmailSender`-fasit | resolve 7.1.1, 7.2.1–7.2.10 (email 1b/1c/1e/1f fjernes) |
| `sendEmail` uten organisasjon | email 1a, 1d, 3a–4f |
| Status etter sending | email 8.2.1–8.2.4, 8.2.8–8.2.9, 8.2.11–8.2.16, connections 3.12 |
| Graph-adapteren | graph 1–12 |
| Ingen ekte nettkall | spion på `globalThis.fetch` i alle e-posttester |
| Loggeren vasker `client_secret` | logger M365 1–5 (+ 1b/1c, P3–P5) |

## 7. Rekkefølge og hvem

1. **Testskriver** skriver de nye og endrede testene i rekkefølgen reelle feil → manglende tester → rydding, mot teksten i kortet. De nye er røde til utviklerens kode er på plass. Rører ingen fil utenfor `*.test.ts`, `tests/` og `tests/fake-fetch.ts`.
2. **Utvikler** leverer punkt 1–5, 11, 12, 14 (kode), 15 og 16 i kortet. Rører ingen testfil.
3. **Test-leder** kjører `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, grep-kriteriene i avsnitt 1 og dekningskartet i avsnitt 6, og godkjenner eller avviser.

Avvises hvis: 3.9.4 eller 3.9.5 mangler; 6.4.2 mangler «ingen loggrad»; 8.2.14 kaster databasefeil i stedet for `EmailSendError`; en test i dekningskartet er fjernet uten at erstatningen finnes; `.for("update")` eller `findActiveFile` er fjernet; en migrering eller endring i `src/core/access` ligger i diffen.

## 8. Risiko og merknader

- **8.2.13b/13c** er de eneste testene som viser selve feilen i (p) (tilstandsendring mellom `resolve` og statusskriving). De er litt mer oppsett, men uten dem viser 8.2.13 bare det som alt var riktig (`disabled` → systemvalget). Beholdes.
- **6.3.7** er avhengig av at begge transaksjonene får hver sin forbindelse fra poolen (`max: 10`), så `Promise.allSettled` på to kall rett etter hverandre er nok. Hvis testen blir ustabil, skal den ikke tas bort, men låses med en `pg_advisory`-fri tilnærming: første kall startes, det andre startes etter en kort `setImmediate`. Rapporteres til prosjektleder hvis det skjer.
- **`vi.spyOn(db, "update")`** treffer også fabrikkenes `update`-kall hvis de kjører etter spionen; sett spionen sist i testen.
- Ingen test bruker ekte nett, ekte e-post eller ekte kundedata; tilkoblingsstrengen i config 6 er oppdiktet og ugyldig.
