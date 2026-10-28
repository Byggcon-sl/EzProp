# Testplan: Første kandidat for drift uten nett – PowerSync koblet til testskjemaet

- **Oppgavekort:** `docs/funksjoner/fase1-kandidat-powersync.md` (pkt.-numrene under viser til kortet slik det er etter runde 2)
- **Fase:** 1 – Prøve uten nett, punktet «Kandidater satt opp mot samme testskjema», første kandidat
- **Branch:** `fase1-kandidat-powersync` (bygger på `main`)
- **Dato:** 28.10.2026, skrevet om samme dag etter runde 2 og arkitektens presiseringer i `server/types.ts` og `sync/types.ts` (commit `74c14d8`: PUT med hele raden, base64url-nøkkel med `kid`, `deleted_at` serverstyrt, PATCH bare på rad som finnes)
- **Laget av:** test-leder, før koding. Testnavnene er bindende for testskriver. Utvikler leser avsnitt 8 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad er den største tidsbesparelsen mot IVIT; testene viser at svar overlever lukking og uten nett) og reklamasjoner (ingenting går tapt mellom befaring og rapport; testene viser at bunter bare fullføres når serveren har svart 200, og at serveren aldri mister rader). KI først: ikke KI her, men synklaget testene vokter, er der KI-forslag senere skal vises på iPaden.

> **Status etter runde 2 (test-leder, 28.10.2026):** tekstfletting, varselet «Endret av en annen» og bildekøen (også serverdelen) er ute av denne oppgaven. De gamle avsnittene 2.1 (`text-merge`), 2.2 (`foreign-change`), 2.4 (`photo-upload`) og 3.4 (`photo-storage`) er **fjernet** fra planen; testene som erstatter dem står i 2.3, 3.2 og 6.2. Avsnitt 12 nederst lister det som er nytt siden runde 1, så prosjektleder og testskriver ser forskjellen. Ingen `test.fixme` er tillatt i denne PR-en.

Selve prøvene A og B på ekte iPad er **ikke** del av denne planen. De kjøres av Ståle etter protokollen i `docs/funksjoner/fase1-prove-ab-powersync.md`. Planen her dekker alt KI kan vise i Vitest og Playwright (Chromium) **uten PowerSync-tjenesten** (skyen har ikke Docker).

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`: `resetDatabase` (har alt `trial_photos, trial_answers, trial_forms` først i truncate-listen), `createUser`, `createOrganization`, `createEmployee(actor, organizationId, roles)`. Ingen nye fabrikker for `trial_*`: testene lager rader gjennom `applyTrialChanges` (da testes kontrakten samtidig) eller med `db.insert` når de trenger en rad i en fremmed organisasjon.
- `tests/tenant-isolation.ts`: `expectTenantIsolation({ seed, query, idOf })`. Brukes for `listTrialForms`, `listTrialAnswers` og `listTrialPhotos` (avsnitt 3.1). `query` tar `(actor, organizationId)`; de to siste tar også `trialFormId`, så testen pakker dem inn med skjema-id-en fra `seed`.
- `tests/setup-env.ts`: setter miljø for Vitest. **Endres:** `POWERSYNC_JWT_SECRET ??= <43 base64url-tegn, testverdi>` og `POWERSYNC_URL ??= "http://localhost:8080"`, så `pnpm test` går uten `.env`-endring. Testene i 3.3 overstyrer med `vi.stubEnv`.
- `e2e/helpers.ts`: `logIn(page, ADMIN_EMAIL)`. Bare admin finnes i seed, så e2e tester admin; rollene testes i Vitest.
- `playwright.config.ts`: prosjektene `pc` og `ipad` (1194 × 834, `hasTouch`), `workers: 1`. **Endres:** `webServer.env` får `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET` og `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1` (pkt. 4 og 15). `ci.yml` får de samme tre i e2e-jobben, og de to første i `check`-jobben.
- `vitest.config.ts`: tar bare `src/**/*.test.ts`, `tests/**/*.test.ts` og `eslint-rules/**/*.test.ts`. **Ikke** `.test.tsx`, og ingen DOM. Derfor ingen komponenttest; skjermene dekkes av e2e. Rene funksjoner i modulen må kunne importeres uten React, `server-only`, `window` eller `@powersync/web` (avsnitt 8).
- `src/core/access/guards.test.ts`: mønster for roller, deaktivert ansatt og slettet organisasjon. Testene her gjentar ikke `requireOrganizationAccess` sin logikk, bare at hver ny funksjon kaller den.
- `src/shared/lib/uuid.ts`: `uuidv7()` og `isUuid()`. Brukes i testene for id-er.
- `e2e/fase-0a.spec.ts`: mønster for `request`-tester mot API-ruter.
- `e2e/fase-1-testskjema.spec.ts`: dagens 14 tester. **Endres** (avsnitt 6.1), ikke erstattes.

## 2. Enhetstester (Vitest, rene, ingen database)

### 2.3 `src/modules/offline-trial/sync/answer-rows.test.ts` (pkt. 7)

| Testnavn | Viser |
|---|---|
| «answerToRow gir rad med field_key, value som JSON-streng og device_id» | `answerToRow(formId, "floors", 7, "enhet-1")` → `trialFormId`, `fieldKey: "floors"`, `value: "7"`, `deviceId: "enhet-1"`, og en `id` som består `isUuid`. Ingen `organization_id`. |
| «answerToRow lagrer 0 og null forskjellig» | `0` → `"0"`, `null` → `"null"`. |
| «rowsToAnswers nøkler på field_key og leser value fra JSON» | To rader → `{ floors: 7, roof_tg: "TG2" }`. |
| «rowsToAnswers skiller 0 og null» | `"0"` → `0` (teller som utfylt), `"null"` → `null`. |
| «rowsToAnswers hopper over rader med deletedAt» | Rad med `deletedAt` er ikke i svaret. |
| «rowsToAnswers tar siste rad når samme field_key kommer to ganger» | Lokal database kan kortvarig ha to rader (før serverens id vinner); den med høyest `updatedAt` gjelder. Ingen krasj. |
| «bildefelt bygges av trial_photos, aldri av trial_answers.value» | `trial_answers` har `cover_photo` med `value: "[]"` og én `trial_photos`-rad → svaret har ett bilde med `id`, `name`, `sizeBytes`. Også: `trial_answers` har `cover_photo` med `value: "[{\"id\":\"x\"…}]"` og ingen bilderad → tomt bildefelt. |
| «bilderekkefølgen er stabil: createdAt, så id» | Tre bilder gitt i tilfeldig rekkefølge → sortert på `createdAt`, like tidsstempler sortert på `id`. |
| «myk slettet bilde er ikke med» | `trial_photos` med `deletedAt` → ikke i listen. |
| «value tåler JSON-rundtur for alle seks typene» | Tekst, TG, valg, tall, tabell (med `TrialTableRow`) og tomt bildefelt gjennom `answerToRow` → `rowsToAnswers` gir `toEqual` på originalen. |
| «ugyldig JSON i value gir null, ikke krasj» | `value: "{ikke json"` → feltet er `null`, de andre feltene leses. |

### 2.5 `src/modules/offline-trial/answers.test.ts` (utvides, pkt. 10)

Dagens ni tester beholdes. Testen «parseTrialNumber godtar komma og punktum, avviser tekst» erstattes av:

| Testnavn | Viser |
|---|---|
| «parseTrialNumber godtar strengt desimaltall med komma eller punktum» | `"12,5"` → 12.5, `"12.5"` → 12.5, `"0"` → 0, `"-3"` → -3, `" 7 "` → 7, `"007"` → 7, `"-0,5"` → -0.5. |
| «parseTrialNumber avviser alt som ikke er et rent desimaltall» | `"1e3"`, `"Infinity"`, `"-Infinity"`, `"NaN"`, `"0x10"`, `"1 000"`, `"12,"`, `",5"`, `"12,5,1"`, `"1_000"`, `"abc"`, `""`, `"   "`, `"+3"` → alle `null`. |

### 2.6 `src/modules/offline-trial/sync/device.test.ts` (pkt. 6)

| Testnavn | Viser |
|---|---|
| «getTrialDeviceId lager en uuid og gir den samme neste gang» | Med en falsk `Storage` (Map) sendt inn: første kall gir en id som består `isUuid`, andre kall gir samme id, nøkkelen er `trial_device_id`. |
| «getTrialDeviceId respekterer en id som allerede ligger lagret» | Forhåndslagt verdi returneres uendret. |

### 2.7 `src/modules/offline-trial/sync/powersync/schema.test.ts` (pkt. 3)

Kolonnelisten ligger i `schema-columns.ts` (ren data), som både PowerSync-skjemaet og testen bruker, fordi `@powersync/web` ikke kan importeres i Node uten DOM.

| Testnavn | Viser |
|---|---|
| «klientskjemaet har tabellene trial_forms, trial_answers og trial_photos» | Nøyaktig tre tabeller. |
| «kolonnenavnene i klientskjemaet finnes i PostgreSQL-skjemaet» | Hver kolonne i klientskjemaet finnes i `getTableColumns()` fra Drizzle for samme tabell (`src/db/schema/offline-trial.ts`). Fanger stavefeil som ellers gir tom synk. |
| «storage_path, text_state, created_by, updated_by og deleted_by er ikke i klientskjemaet» | Ingen av de fem i noen tabell (samme liste som synkreglene, 2.9). |

### 2.8 `src/modules/offline-trial/server/change-schema.test.ts` (pkt. 12, Zod-skjemaet for nyttelasten)

| Testnavn | Viser |
|---|---|
| «godtar PUT og PATCH for de tre tabellene» | Gyldig bunt parses. |
| «avviser DELETE, ukjent op og ukjent tabell» | `op: "DELETE"`, `op: "UPSERT"`, `table: "users"` → feil. |
| «avviser mer enn 500 operasjoner» | 501 → feil, 500 → ok. |
| «avviser value over 64 kB målt i UTF-8-byte og device_id over 64 tegn» | `value` på nøyaktig 64·1024 byte går, +1 byte feiler; en streng med «æøå» måles i byte (`TextEncoder`), ikke tegn. `device_id` 64 tegn ok, 65 feil. |
| «text_state godtas som null eller streng» | Feltet avviser ikke bunten (en eldre klient skal ikke få 400); serveren lagrer den uansett aldri (3.2). |
| «avviser id og trial_form_id som ikke er uuid» | `id: "../x"` og `trial_form_id: "x"` → feil (før noe treffer databasen). |

### 2.9 `tests/powersync-config.test.ts` (pkt. 14, leser filene som tekst med regex)

Ingen YAML-parser i treet, og `config.yaml` bruker `!env`-merker. Ingen ny avhengighet.

| Testnavn | Viser |
|---|---|
| «config.yaml slår av telemetri og leser hemmeligheter fra miljøet» | `disable_telemetry_sharing: true`; `audience` inneholder `powersync`; nøkkelen har `kty: oct`, `alg: HS256`, `kid: trial` og `k: !env PS_…`; ingen linje inneholder utviklingsverdien for `POWERSYNC_JWT_SECRET` fra `.env.example` eller en tilkoblingsstreng med passord (`postgres(ql)?:\/\/\w+:\w+@`). |
| «sync-rules.yaml filtrerer alle tre tabellene på organization_id og deleted_at med eksplisitt kolonneliste» | Én bøtte, parameter med `request.jwt() ->> 'organization_id'`, tre `SELECT` som hver har `organization_id = bucket.organization_id` og `deleted_at IS NULL`. Ingen `SELECT *`, ingen `request.parameters()`, ingen fjerde tabell, og ingen av `storage_path`, `text_state`, `created_by`, `updated_by`, `deleted_by`. `device_id` er med i `trial_answers`. |
| «docker-compose binder PowerSync bare til 127.0.0.1 og bruker fast versjonstag» | `powersync`-tjenesten: port begynner med `127.0.0.1:`; `image` har en tag og slutter ikke på `:latest`; `depends_on` på `db` med `condition: service_healthy`; de to konfigurasjonsfilene er montert `:ro`; `PS_JWT_SECRET: ${POWERSYNC_JWT_SECRET}`; `db.command` inneholder `wal_level=logical`. |
| «.env.example har gyldig utviklingsnøkkel som ikke er lik BETTER_AUTH_SECRET» | `POWERSYNC_JWT_SECRET` matcher `^[A-Za-z0-9_-]{43,}$` (base64url, minst 32 byte dekodet) og er ulik `BETTER_AUTH_SECRET`; `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS` finnes ikke i filen. |

### 2.10 `src/modules/offline-trial/sync/powersync/upload-batch.test.ts` (pkt. 5, arkitekt `74c14d8`)

`buildTrialChangeOperations(entries, readRow)` er den rene delen av `connector.ts`: `entries` er SDK-ens køposter (`{ table, id, op }`), `readRow(table, id)` leser hele den lokale raden.

| Testnavn | Viser |
|---|---|
| «alle køposter sendes som PUT med hele raden» | Køposter med lokal `op` PUT og PATCH → alle gir `op: "PUT"` og `data` lik hele raden (snake_case-kolonner, `value` som JSON-tekst slik den ligger lokalt). |
| «samme rad flere ganger i køen gir like PUT-er» | Insert + to oppdateringer på samme id → tre identiske PUT med gjeldende rad (serveren er idempotent). |
| «DELETE i køen kaster en tydelig feil» | Ingen skjerm sletter noe; en DELETE betyr feil i lokal skriving (f.eks. `INSERT OR REPLACE`). Feilen skal være synlig, ikke en bunt serveren avviser for alltid. |
| «rad som ikke finnes lokalt kaster en tydelig feil» | `readRow` gir `undefined` → kaster. Raden skal ligge lokalt til bunten er fullført. |

## 3. Integrasjonstester mot testdatabasen (Vitest, `beforeEach(resetDatabase)`)

Alle bruker `createOrganization`, `createUser`, `createEmployee`. Innloggede roller lages med `createEmployee(actor, org.id, ["inspector"])` osv.

### 3.1 `src/modules/offline-trial/server/queries.test.ts` (pkt. 12, `listTrialForms`, `listTrialAnswers`, `listTrialPhotos`)

| Testnavn | Viser |
|---|---|
| «listTrialForms gir aldri skjemaer fra en annen organisasjon (expectTenantIsolation)» | `seed` skriver ett skjema i hver organisasjon via `applyTrialChanges(adminX, grantX.organizationId, [PUT trial_forms])`; `query: listTrialForms`; `idOf: row => row.id`. **Obligatorisk.** |
| «listTrialAnswers gir aldri svar fra en annen organisasjon (expectTenantIsolation)» | `seed` lager skjema og én `trial_answers`-rad per organisasjon, husker skjema-id per organisasjon i en lukning; `query: (actor, orgId) => listTrialAnswers(actor, orgId, formIdFor(orgId))`. `formIdFor` velger skjema-id ut fra organisasjonen som spørres, så steg 3 og 4 (fremmed id) treffer `requireOrganizationAccess` og ikke en tom liste. **Obligatorisk.** |
| «listTrialPhotos gir aldri bilder fra en annen organisasjon (expectTenantIsolation)» | Samme mønster med én `trial_photos`-rad per organisasjon. **Obligatorisk** (tredje tabell må ha samme bevis; regel 2). |
| «listTrialAnswers og listTrialPhotos med skjema-id fra en annen organisasjon gir tom liste» | Bruker i A spør mot A med B sin skjema-id → `[]`. `WHERE organization_id = grant.organizationId AND trial_form_id = …`. |
| «de tre lesefunksjonene hopper over myk slettede rader» | Sett `deleted_at` direkte med `db.update` → raden er borte fra svaret, men finnes i databasen (`db.select` uten filter gir den). Regel 3. |
| «alle fire roller kan lese, deaktivert ansatt nektes» | `inspector`, `office`, `manager`, `admin` får svar; ansatt med `deactivated_at` satt får `AccessDeniedError`. Admin stenges aldri ute. |

### 3.2 `src/modules/offline-trial/server/apply-changes.test.ts` (pkt. 12, `applyTrialChanges`)

| Testnavn | Viser |
|---|---|
| «skriver skjema, svar og bilde med organization_id fra grant» | PUT i alle tre tabeller → radene har `organization_id === grant.organizationId`, `created_by === actor.id`, `updated_by === actor.id`. Svar `{ applied: 3 }`. |
| «bruker aldri organization_id fra nyttelasten» | `data.organization_id = orgB.id` i alle tre → radene får `orgA.id`. **Obligatorisk.** |
| «fremmed organisasjon gir AccessDeniedError og ingen skriving» | Bruker i A mot `orgB.id` → kaster, `count(*)` i alle tre tabeller er 0. **Obligatorisk.** |
| «fremmed id gir TrialIdConflictError og raden i den andre organisasjonen er uendret» | B har et skjema med id X. A sender PUT `trial_forms` med id X og `name: "kapret"` → kaster `TrialIdConflictError` (ruten gir 409), B sin rad har fortsatt sitt navn og `row_version`, og A har ingen rad med id X. Samme for `trial_answers` og `trial_photos` (tre `it.each`-saker). **Obligatorisk.** |
| «fremmed id i en annen tabell gir også TrialIdConflictError» | B har `trial_forms` med id X; A sender `trial_answers` med id X → kaster, ingen skriving. **Obligatorisk.** |
| «fremmed trial_form_id gir InvalidTrialChangeError og ingen rad» | A sender `trial_answers` og `trial_photos` med `trial_form_id` fra B sitt skjema → kaster, 0 rader i A. **Obligatorisk.** |
| «ukjent trial_form_id gir InvalidTrialChangeError» | Tilfeldig uuid som skjema → kaster. |
| «rekkefølgen i bunten spiller ingen rolle» | Bunt med `trial_answers` **før** `trial_forms` for samme nye skjema → begge skrives (serveren sorterer `trial_forms` → `trial_answers` → `trial_photos`). |
| «DELETE, ukjent tabell og ukjent felt gir InvalidTrialChangeError og ingen skriving» | Tre saker; en gyldig PUT i samme bunt skrives **ikke** (hele bunten avvises i én transaksjon). |
| «serverstyrte kolonner i nyttelasten overses» | `data` har `organization_id`, `created_by: "x"`, `updated_by: "x"`, `row_version: 99`, `uploaded_at`, `sha256`, `storage_path`, `text_state: "abc"` → ingen feil, raden har serverens verdier (`row_version` 1, `uploaded_at`/`sha256`/`storage_path`/`text_state` null). |
| «deleted_at fra enheten overses: enheten kan verken slette eller gjenopprette» | PUT med `deleted_at: "2026-01-01T00:00:00Z"` → raden er **ikke** slettet. Rad som er myk slettet i databasen (`db.update`) og får PUT med `deleted_at: null` → fortsatt slettet. **Obligatorisk** (regel 3). |
| «created_at fra enheten beholdes ved første innsetting og endres aldri» | PUT med `created_at` T1 → raden har T1; ny PUT med `created_at` T2 og annen `value` → `created_at` fortsatt T1, `value` ny. (Bilderekkefølgen bygger på den.) |
| «samme bunt to ganger gir samme data og øker ikke row_version» | PUT ×2 med identisk `data` → én rad per tabell, `row_version` uendret. |
| «en faktisk endring øker row_version» | PUT `floors = 7`, så `floors = 8` → `row_version` 1 → 2, `value` er `8`. |
| «PATCH oppdaterer bare feltene som sendes, og krever at raden finnes» | PATCH `trial_forms` med `{ name }` beholder andre kolonner. PATCH på id som ikke finnes → `InvalidTrialChangeError`, ingen rad. PATCH på id som finnes i B → `TrialIdConflictError` (tenant-vokteren først). |
| «trial_answers med annen id for samme (trial_form_id, field_key) beholder serverens id» | Rad finnes med id S. PUT med id T, samme skjema og felt, `value: 9` → én rad, id S, `value` 9. **Vokter unik-nøkkelen.** |
| «tekstfelt følger siste endring vinner, og innkommende text_state lagres ikke» | To PUT på `roof_description` med ulik `value` (og `text_state` satt på begge) → siste `value` gjelder, `text_state` er `null` i databasen. |
| «siste endring vinner for tg, valg, tall og tabell» | To PUT etter hverandre på `roof_tg`, `leak_stopper`, `moisture_floor`, `drill_measurements` → den siste gjelder, ett `row_version`-hopp per endring. |
| «bunter over 500 operasjoner og value over 64 kB gir InvalidTrialChangeError» | Zod-grensene håndheves i funksjonen, ikke bare i ruten. |
| «alle fire roller kan skrive, deaktivert ansatt nektes» | `it.each` over rollene; deaktivert → `AccessDeniedError`. Admin stenges aldri ute. |
| «logger aldri innholdet i endringene» | Spion på loggeren (`src/shared/lib/logger.ts`) og `console`: etter en bunt med `value: "\"HEMMELIG-MARKØR-1234\""` inneholder ingen loggmelding markøren. |

### 3.3 `src/modules/offline-trial/server/sync-token.test.ts` (pkt. 12, `issueSyncToken`)

Miljøvariabler settes med `vi.stubEnv` per test (`POWERSYNC_JWT_SECRET`, `POWERSYNC_URL`, `BETTER_AUTH_URL`) og nullstilles i `afterEach`. Testhemmeligheten er 43+ base64url-tegn.

| Testnavn | Viser |
|---|---|
| «tokenet har organization_id lik grant.organizationId og aud powersync» | Dekod nyttelasten (base64url) → `organization_id === grant.organizationId`, `aud === "powersync"`, `sub === actor.id`. `endpoint === POWERSYNC_URL`. |
| «tokenet har bare sub, organization_id, aud, iat og exp» | `Object.keys(payload).sort()` er nøyaktig disse fem. Bruker med `name: "Kari Nordmann"`: verken navn eller e-post finnes i den dekodede JSON-en. |
| «exp er høyst én time etter iat» | `exp - iat <= 3600` og `> 0`. |
| «signaturen er HS256 med kid trial og verifiseres med nøkkelbytene fra base64url» | Hode `alg === "HS256"`, `kid === "trial"`; `createHmac("sha256", Buffer.from(secret, "base64url"))` over `header.payload` er lik signaturen. **Ikke** `Buffer.from(secret)` (da bruker tjenesten og serveren ulike byte). Feil hemmelighet gir ulik signatur. |
| «uten POWERSYNC_JWT_SECRET kastes en tydelig feil» | `vi.stubEnv("POWERSYNC_JWT_SECRET", "")` → kaster `Error` med «POWERSYNC_JWT_SECRET» i meldingen. Aldri et token. |
| «for kort hemmelighet (under 32 byte dekodet) kastes feil» | 42 base64url-tegn (31 byte) → kaster; 43 → ok. |
| «utviklingsverdien fra .env.example nektes når BETTER_AUTH_URL ikke er localhost» | Les `.env.example`, hent verdien, sett `BETTER_AUTH_URL=https://test.example.com` → kaster. Med `http://localhost:3000` → ok. |
| «fremmed organisasjon gir AccessDeniedError» | Bruker i A mot `orgB.id`. **Obligatorisk.** |
| «alle fire roller får token, deaktivert ansatt nektes» | `it.each`. Admin stenges aldri ute. |

### 3.5 `src/db/offline-trial-schema.test.ts` (pkt. 11, migrering og publikasjon)

| Testnavn | Viser |
|---|---|
| «migreringen lager trial_forms, trial_answers og trial_photos med baseColumns» | `information_schema.columns` for hver tabell inneholder `id`, `organization_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`, `row_version`. |
| «trial_answers er unik på (trial_form_id, field_key)» | To `db.insert` med samme par → andre kaster (unik-brudd). |
| «publikasjonen powersync har nøyaktig trial_forms, trial_answers og trial_photos» | `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'` → sortert lik `["trial_answers", "trial_forms", "trial_photos"]`. **Obligatorisk (sikkerhet).** |
| «publikasjonen er ikke FOR ALL TABLES» | `SELECT puballtables FROM pg_publication WHERE pubname = 'powersync'` → `false`. |

### 3.6 `tests/factories.test.ts` (liten)

| Testnavn | Viser |
|---|---|
| «resetDatabase tømmer trial_-tabellene» | Legg inn ett skjema, kall `resetDatabase`, `count(*) === 0` i alle tre. |

## 4. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | 3.1, 3.2, 3.3: «alle fire roller … deaktivert ansatt nektes». E2e 6.2: 401 uinnlogget på begge ruter. | Alle serverfunksjonene kaller `requireOrganizationAccess(actor, organizationId, "organization.read")`. Ingen rolle stenges ute. |
| Tenant-isolasjon | `expectTenantIsolation` for `listTrialForms`, `listTrialAnswers` og `listTrialPhotos` (3.1). `issueSyncToken` og `applyTrialChanges`: fremmed organisasjon gir `AccessDeniedError`, `organization_id` fra nyttelast ignoreres, fremmed `id` gir 409 uten skriving (også på tvers av tabeller), fremmed `trial_form_id` gir 400 uten skriving (3.2–3.3). E2e 6.2: 403 på begge ruter med fremmed `?organisasjon=`. Synkreglene: 2.9. JWT bærer `grant.organizationId`: 3.3. Enhetsbytte: 6.2 «annen organisasjon i token tømmer …». | Testene merket **Obligatorisk** må alle finnes og være grønne. Mangler én, avvises PR-en. |
| Admin stenges aldri ute | Admin er med i alle `it.each` over roller og i `expectTenantIsolation`. E2e logger inn som admin og gjør alt. | Ingen ny tilgangslogikk. |
| Myk sletting | 3.1 «hopper over myk slettede rader», 2.3 «hopper over deletedAt» og «myk slettet bilde er ikke med», 2.9 `deleted_at IS NULL`, 3.2 «DELETE … gir InvalidTrialChangeError» og «deleted_at fra enheten overses». | Ingen skjerm sletter noe; `deleted_at` ligger i `baseColumns`, eies av serveren og filtreres overalt. |
| Ingen kundeopplysninger | Alle testdata er oppdiktede («Oppdiktet tekst», `example.com`). 3.3: JWT bærer aldri navn eller e-post. 3.2: logg inneholder aldri fritekst. 2.9: ingen hemmelighet i konfigurasjonsfilene. | Regel 8. |

## 5. Regeltester

Ingen regler eller TG-logikk (prøve E). «Siste endring vinner» er kode med testsaker i 3.2. Test-leder sjekker at modulen ikke inneholder TG-avledning fra tall.

## 6. E2e (Playwright, Chromium, `pc` og `ipad`)

Uten PowerSync-tjeneste: SDK-en får token fra egen server, men når ikke `POWERSYNC_URL` og prøver igjen i bakgrunnen; den lokale databasen virker, og ingenting lastes opp (SDK-en laster bare opp når den er koblet til). Alle tester bruker `logIn(page, ADMIN_EMAIL)`. **Alle tester i 6.1 og 6.2 kjører i både `pc` og `ipad`** (kortets akseptkriterium: `ipad` har kjørt alle), unntatt målingen av trykkflate som bare gir mening i `ipad`.

**Premiss:** Playwright gir ny nettleserkontekst per test, så den lokale databasen og hurtiglageret er tomme ved hver test, og uten tjenesten kommer ingenting ned fra serveren. Listen starter alltid tom («Testskjema 1» er deterministisk), og svar fra én test finnes ikke i den neste.

**Felles hjelpere i `e2e/helpers.ts` (nye):**
- `createTrialForm(page): Promise<string>`: går til `/prove/testskjema`, trykker «Nytt testskjema», venter på URL `/prove/testskjema/<uuid>`, returnerer id-en.
- `indicator(page)`: `page.getByTestId("sync-indicator")`.
- `expectTestHooks(page)`: `expect(await page.evaluate(() => typeof window.__offlineTrial)).toBe("object")` med meldingen «Bygg appen med NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1». Først i alle krok-tester.
- `setAnswerViaHook(page, formId, fieldKey, value, deviceId)`: `page.evaluate` som gjør `UPDATE trial_answers … WHERE trial_form_id = ? AND field_key = ?` og `INSERT` hvis ingen rad ble endret, i én `writeTransaction` i `window.__offlineTrial.db`, med `device_id`.
- `readLocalRows(page, table, formId)`: `page.evaluate` som leser radene for skjemaet fra den lokale databasen.

### 6.1 `e2e/fase-1-testskjema.spec.ts` (tilpasses listen)

- `openTrialForm` blir: `logIn` → `createTrialForm` → `expectCount(page, 0)`. Testen «uinnlogget sendes til innlogging fra /prove/testskjema» er uendret. Testen «admin finner lenken …» ender nå på listen: forventer overskriften «Testskjema» og knappen «Nytt testskjema», og først etter trykk «0 av 40 felt utfylt».
- Alle de andre 12 testene beholdes med samme navn og skal være grønne i både `pc` og `ipad`, særlig «alle 40 felt fylles ut og telleren viser 40 av 40» (akseptkriterium 1).
- Ny: «tall med komma på slutten beholdes mens man skriver» (pkt. 10): `fill("12,")` i «Antall etasjer» → `toHaveValue("12,")`, telleren uendret (streng parsing gir null); `fill("12,5")` → teller +1; `blur` → feltet viser «12,5».
- Ny: «Nytt testskjema er minst 44 px høy» (`test.skip` utenfor `ipad`).

### 6.2 `e2e/fase-1-powersync.spec.ts` (ny)

| Testnavn | Viser |
|---|---|
| «listen viser nye testskjemaer med navn og laget når, og åpner dem» | To trykk på «Nytt testskjema» (tilbake til listen mellom) → listen har «Testskjema 1» og «Testskjema 2» med en tidsangivelse hver; trykk på «Testskjema 1» → URL med riktig id. |
| «svarene overlever at siden lastes på nytt uten server» | Fyll `roof_tg = TG2`, `floors = "7"`, «Tak – beskrivelse» = «Oppdiktet tekst», ett bilde i «Forsidebilde». `page.reload()`. Alle fire står, teller «4 av 40». Deretter `page.goto("/prove/testskjema")` → skjemaet står i listen; åpne → fortsatt 4. |
| «et valgt bilde gir en trial_photos-rad i lokal database uten fil» | Velg `test-image.png` → `readLocalRows(page, "trial_photos", formId)` har én rad med `name: "test-image.png"` og `size_bytes` lik filstørrelsen; `uploaded_at` og `sha256` er null; `indexedDB.databases()` inneholder ikke `offline-trial-photos`. |
| «indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett» | Med nett: indikator matcher `/^(Venter: \d+ endring(er)?|Alt er lagret på serveren)$/`. `context.setOffline(true)` → `toHaveText("Uten nett")`. Skriv `floors = "3"` → fortsatt «Uten nett», teller +1. `setOffline(false)` → matcher `/^Venter: \d+ endring(er)?$|^Alt er lagret på serveren$/`. |
| «indikatoren bøyer entall og flertall riktig» | Uten tjeneste er køen deterministisk. Rett etter «Nytt testskjema» (skjemaraden er én endring) → «Venter: 1 endring». Ett trykk på TG1 i «Tak – tilstandsgrad» → «Venter: 2 endringer». (Tall- og tekstfelt brukes ikke her: hvert tastetrykk kan gi en køpost.) |
| «skjemaet åpner fra hurtiglageret uten nett etter ett besøk» | Besøk skjemaet med nett, vent på `navigator.serviceWorker.ready` og at `caches.keys()` ikke er tom. `setOffline(true)`, `page.reload()` → overskrift og teller synlige, indikatoren «Uten nett». **Reserve** hvis `setOffline` ikke treffer service worker-henting i Chromium: `caches.match()` for ett `/_next/static/`-skript på siden og for skjemasiden er begge truthy; testen sier i `test.info().annotations` hvilken vei som ble brukt. |
| «tall, TG og tekst satt utenfra via testkroken vises i feltene» | Skriv `floors = "5"` selv. `setAnswerViaHook(…, "floors", 7, "annen-enhet")` → «Antall etasjer» `toHaveValue("7")`. `roof_tg = "TG3"` → TG3 `aria-pressed="true"`. `roof_description = "Fra annen enhet"` → feltet viser teksten. Viser at inputs leser fra `answers` (kjent svakhet fra oppgave 3). |
| «rader skrevet før skjemaet åpnes vises ved første lasting» | Krok: skriv 5 rader for skjemaet **før** det åpnes fra listen. Åpne → teller «5 av 40». |
| «uinnlogget gir 401 på begge synkrutene» | `request` uten cookies: `GET /api/prove/synk/token?organisasjon=<uuid>` og `POST /api/prove/synk/endringer` → 401. |
| «fremmed organisasjon gir 403 på begge synkrutene» | Innlogget `page.request` (deler cookies): begge med `organisasjon=<tilfeldig uuid>` → 403, og token-svaret har ikke `token` i kroppen. |
| «token-ruten svarer med no-store og et token for egen organisasjon» | Organisasjons-id fra `window.__offlineTrial.organizationId`. `GET token` → 200, `cache-control` inneholder `no-store`, JSON har `token` (tre deler) og `endpoint`. Dekod nyttelasten: `organization_id` lik id-en, ingen `email`. |
| «endringer-ruten gir 400 for DELETE og ukjent felt, og 413 før kroppen leses» | `POST endringer` med `op: "DELETE"` → 400 med norsk feilmelding i JSON; ukjent `field_key` → 400. Kropp på 4 MB + 1 byte som **ikke er JSON** (bare «x»-er) → 413, ikke 400 (beviser at kroppen ikke ble lest). 409 krever en annen organisasjon og dekkes i Vitest (3.2). |
| «service worker rører ikke API, innlogging og dev-postkasse» | Etter registrering: `caches.keys()` og `cache.keys()` har ingen URL under `/api/`, `/logg-inn` eller `/dev/`. |
| «utlogging tømmer lokal database og hurtiglager» | Lag skjema, skriv ett svar, trykk «Logg ut» → `logIn` igjen → listen er tom, `caches.keys()` har ingen nøkkel med `/prove/testskjema` eller `/arbeidskoe`. |
| «annen organisasjon i token tømmer lokal database og hurtiglager» | Lag skjema. `page.evaluate` setter `localStorage.trial_organization_id` til en tilfeldig uuid. `reload` → token fra egen server har en annen `organization_id` enn den lagrede → `expect.poll`: listen er tom, lokal database har 0 skjemaer, `caches.keys()` er tomt for prøvesidene, og `localStorage.trial_organization_id` er nå den ekte id-en. |

E2e sletter aldri noe i serverdatabasen.

## 7. Skript, konfigurasjon og dokumentasjon (test-leder kjører for hånd)

| Sjekk | Kommando | Forventet |
|---|---|---|
| `start.sh` er gyldig bash 3.2 | `bash -n start.sh` | ingen feil; ingen `mapfile`, `declare -A`, `${var,,}` i `git diff main.. -- start.sh` |
| Stegtelling | `test "$(grep -c '^steg "' start.sh)" = "$(sed -n 's/^TOTALT=//p' start.sh)"` | sant |
| Hopper over Docker og PowerSync-venting | `grep -n EZPROP_SKIP_DOCKER start.sh` | treffer både Docker-steget og PowerSync-ventingen |
| Kjøring | bare når port 3000 er ledig: `EZPROP_SKIP_DOCKER=1 EZPROP_NO_BROWSER=1 timeout 90 ./start.sh` | alle steg til og med «Starter» vises med PowerSync-adressen i oppsummeringen; avslutningskode 124 godtas |
| compose er gyldig | `docker compose --env-file .env.example config -q` | ingen feil (Compose-CLI finnes i skyen; daemon trengs ikke for `config`) |
| Ingen produktnavn i `public/sw.js` | `grep -n "EzProp" public/sw.js` | tomt |
| Hodekommentar | `grep -L "Prøve fase 1" src/modules/offline-trial/sync/powersync/*.ts src/modules/offline-trial/server/*.ts` | tomt |
| Ingen hemmelighet i repoet | `grep -rn "POWERSYNC_JWT_SECRET" --include=*.ts --include=*.yaml --include=*.yml --include=*.sh . \| grep -v node_modules` | bare `process.env`, `!env`/`PS_`-mapping, `start.sh`-nøkkelløkken og `.env.example` |
| Testkrok aldri i deploy | `grep -rn NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS .env.example .github/workflows/` | bare i `ci.yml`, aldri i deploy-arbeidsflyten eller `.env.example` |
| Ingen modellnavn | `git log origin/main..HEAD --format=%B \| grep -i "claude\|gpt\|sonnet\|opus"` | tomt |
| Avhengigheter | `git diff main.. -- package.json` | bare `@powersync/web`, `@powersync/react`, `@journeyapps/wa-sqlite`, `jose` og versjonen; **ikke** `yjs` |
| Dokumenter | `docs/drift/powersync.md` finnes med Mac- og Azure-del; «Teknisk som utvikleren fyller inn» i resultatfilen er fylt, også «det som ikke virket» | lest |

## 8. Krav til koden som testene bygger på (til utvikler)

1. **Rene filer uten DOM og uten `@powersync/web`:** `sync/answer-rows.ts`, `sync/device.ts` (tar `Storage` som valgfritt argument, standard `globalThis.localStorage`), `sync/types.ts`, `sync/powersync/schema-columns.ts`, `sync/powersync/upload-batch.ts`, `server/change-schema.ts`. Vitest har ingen DOM og skal kunne importere dem.
2. **Feilklasser med faste navn** i `server/errors.ts`: `InvalidTrialChangeError` (400), `TrialIdConflictError` (409). Rutene oversetter; testene sjekker `instanceof`.
3. **Miljøvariabler leses ved kall**, ikke ved modul-last (`POWERSYNC_JWT_SECRET`, `POWERSYNC_URL`, `BETTER_AUTH_URL`), så `vi.stubEnv` virker. `tests/setup-env.ts` får standardverdier (avsnitt 1).
4. **Hemmeligheten er base64url** (arkitekt `74c14d8`): signer med `jose.importJWK({ kty: "oct", alg: "HS256", k: secret })`, aldri `TextEncoder`. Minst 43 tegn. `kid: "trial"` i hodet.
5. **Hele bunten avvises** ved første ugyldige operasjon (én transaksjon), ingen halvskrevne bunter. Tenant-vokteren på `id` (409) sjekkes før `trial_form_id`-vokteren (400) og før PATCH-oppslaget.
6. **`listTrialPhotos(actor, organizationId, trialFormId)`** legges til i `server/queries.ts` ved siden av de to andre (bare for testene).
7. **Indikatoren** har `data-testid="sync-indicator"` og nøyaktig tekstene fra pkt. 9. `pendingChanges` er antall rader i SDK-ens kø (`ps_crud`), så skjemaraden selv teller som én.
8. **Testkroken** `window.__offlineTrial = { db, deviceId, organizationId }` når `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1` (bygg-tid). `db.execute(sql, params)` og `db.writeTransaction` må kunne brukes fra `page.evaluate`. Visningen må reagere på rader skrevet rett i databasen (det er slik synk kommer inn). `organizationId` er bare det brukeren alt ser.
9. **Organisasjons-id-en den lokale databasen tilhører** ligger i `localStorage` under nøkkelen `trial_organization_id`. Når token-ens `organization_id` er en annen, kalles `clearLocalTrialData()` og nøkkelen settes på nytt. Samme funksjon kalles ved utlogging.
10. **Listen:** overskrift `<h1>Testskjema</h1>`, knapp med nøyaktig tekst «Nytt testskjema» (`<button>`), hvert skjema en `<a>` med navnet som tekst. Nytt skjema navigerer til `/prove/testskjema/<uuid>`.
11. **Alle inputs: lokal kladd mens feltet har fokus, verdi fra `answers` ellers** (pkt. 10). E2e `fill()` må være stabil når `useQuery` leverer asynkront.
12. **Service worker** svarer aldri (`respondWith`) for `/api/*`, `/logg-inn*` eller `/dev/*`, og legger dem aldri i hurtiglageret. Ingen `page.route`-tester er igjen i planen, så `serviceWorkers: "block"` trengs ikke.
13. `trial-form-view.tsx` beholder `data-field`, `<label htmlFor>`, `<fieldset><legend>` og `aria-pressed` fra oppgave 3; dagens e2e skal gå grønn med bare endringen i `openTrialForm`.
14. **`connector.ts`** bruker `buildTrialChangeOperations` (2.10) og fullfører bunten (`transaction.complete()`) bare ved 200.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| Nytt skjema fra listen, 40 felt i `pc` og `ipad`, «40 av 40» | 6.1 (tilpasset `openTrialForm`), 6.2 «listen viser …» |
| Svarene overlever `reload` uten server | 6.2 «svarene overlever …», «rader skrevet før skjemaet åpnes …» |
| Uten nett: åpner fra hurtiglager, indikator «Uten nett», venter-regex, entall/flertall | 6.2 «indikatoren viser …», «indikatoren bøyer …», «skjemaet åpner fra hurtiglageret …», 7 (sw.js) |
| Valgt bilde gir `trial_photos`-rad uten fil | 6.2 «et valgt bilde gir …», 2.3 |
| `parseTrialNumber` streng; e2e `floors = 7` utenfra og «12,» | 2.5, 6.1 «tall med komma på slutten …», 6.2 «tall, TG og tekst satt utenfra …» |
| `rowsToAnswers` | 2.3 |
| `applyTrialChanges` (alle kulepunkter) | 3.2, 2.8, 2.10 |
| `issueSyncToken` + e2e 401/403/413 | 3.3, 6.2 «uinnlogget …», «fremmed organisasjon …», «token-ruten …», «endringer-ruten …» |
| `expectTenantIsolation`; roller; deaktivert; admin | 3.1–3.3 |
| Annen organisasjon tømmer lokal database og hurtiglager | 6.2 «annen organisasjon i token …», «utlogging tømmer …» |
| Migrering og `pg_publication_tables` | 3.5 |
| `config.yaml`/`sync-rules.yaml`, `docker compose config`, `start.sh` | 2.9, 7 |
| `docs/drift/powersync.md` og teknisk avsnitt i resultatfilen | 7 (lest av test-leder) |
| `yjs` ikke i `package.json` | 7 |
| format, lint, typecheck, test, e2e grønne, `ipad` kjørte alt | 10 |
| Virker på iPad-størrelse | `ipad`-prosjektet i 6.1 og 6.2 |
| Ingen modellnavn i commits | 7 |

Ikke testbart av KI, står i protokollen for Ståle: lagringstype i Safari (OPFS/IndexedDB), flere faner, synk mot ekte tjeneste, omstart av iPad, to iPader samtidig.

## 10. Slik godkjenner test-leder

Kjører i denne rekkefølgen og stopper ved første røde:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e
bash -n start.sh
docker compose --env-file .env.example config -q
```

Godkjennes bare når alt dette stemmer:

- Alle kommandoer grønne. Playwright-listen viser hver e2e-test under både `[pc]` og `[ipad]`. Ingen `test.fixme`.
- Alle tester merket **Obligatorisk** finnes med navnet fra planen og er grønne. Mangler én, avvises PR-en uten unntak (tilgang og tenant-isolasjon).
- `expectTenantIsolation` kalles for `listTrialForms`, `listTrialAnswers` og `listTrialPhotos` (`grep -rn expectTenantIsolation src/modules/offline-trial`).
- Utfyllingstesten når «40 av 40» i begge prosjekter.
- Ingen `.test.tsx` (Vitest plukker dem ikke opp).
- Avsnitt 7 er gått gjennom; det som ikke kunne kjøres (selve tjenesten), står som «ikke kjørt» i testrapporten, ikke som grønt.
- Testrapporten lister funn som «alvorlig» (tilgang, tenant, tap av data) eller «lite» (tekst, rekkefølge, ytelse).

## 11. Kjente svakheter som ikke testes her (skrives i resultatfilen, ikke blokkerende)

- **Permanent avvist bunt låser køen.** Svarer serveren 400 eller 409 på en bunt, blir den liggende og prøves igjen for alltid (SDK-ens standard, kortets pkt. 5). Indikatoren viser da «Venter: N» uten at N synker. Godt nok for prøven; ADR-en må ta stilling til hva som skal skje (vis feil, hopp over raden, logg).
- **Utlogging med ventende endringer kaster dem.** `clearLocalTrialData()` ved utlogging (pkt. 4) sletter også køen. Oppdiktede data i prøven; et varsel før utlogging er et eget punkt senere.
- **Publikasjonen i Azure** krever at migreringsbrukeren får lage publikasjoner på Flexible Server; står i driftsdokumentet, ikke i testene.

## 12. Tillegg etter forhåndsvurdering runde 2 (test-leder, 28.10.2026)

Det som er nytt siden runde 1, og hva prosjektleder må ta inn i kortet (**kort**):

1. **(kort) PATCH-regelen i pkt. 12 motsier `server/types.ts`.** Kortet sier «PUT og PATCH er upsert»; arkitekten (`74c14d8`) sier PATCH bare når raden finnes på `id` i `grant.organizationId`, ellers `InvalidTrialChangeError`, og PowerSync-utgaven sender alltid PUT med hele raden. Planen følger `types.ts` (3.2 «PATCH … krever at raden finnes», 2.10). Kortet rettes.
2. **(kort) Hemmeligheten er base64url, minst 43 tegn.** Kortet sier «minst 32 byte» / `.env.example` «minst 32 tegn». Akseptkriteriet «HMAC verifiseres med `node:crypto`» presiseres til nøkkel = `Buffer.from(secret, "base64url")` (3.3). Testen i 2.9 sjekker formatet i `.env.example`.
3. **(kort) `deleted_at`, `deleted_by` og `created_at`** er nå serverstyrt/regulert i `types.ts`, men mangler i kortets liste i pkt. 12. To nye tester i 3.2 («deleted_at fra enheten overses», «created_at … beholdes»), den første **Obligatorisk** (regel 3).
4. **(kort) `listTrialPhotos`** (bare for testene) så alle tre `trial_*`-tabellene får `expectTenantIsolation` (regel 2 i CLAUDE.md). Kortet sier i dag at to lesefunksjoner er beviset for tre tabeller; `trial_photos` leses ellers bare av synkreglene, som ikke kan testes uten tjenesten.
5. **(kort) Akseptkriteriet om «12,»** er tvetydig («telleren teller»). Med streng parsing gir «12,» null: feltet beholder teksten, telleren er uendret; først «12,5» teller. Planen tester det slik (6.1).
6. **(kort) Indikatoren starter på «Venter: 1 endring»** rett etter «Nytt testskjema» (skjemaraden er en køpost), ikke på 0. Testen i 6.2 bruker TG-trykk, ikke tastefelt, for å telle deterministisk.
7. **(kort) Testkroken får `organizationId`** (bare det brukeren alt ser), og den lokale organisasjons-id-en ligger i `localStorage.trial_organization_id`, så akseptkriteriet «innlogging med en annen organisasjon tømmer …» kan testes uten tjenesten og uten en annen organisasjon i seed (6.2). I tillegg en utloggingstest, som er den enkleste veien til samme funksjon.
8. **(kort) `ipad` kjører alle e2e-tester**, også `request`-testene; planen hadde «pc» på flere. Rettet, så akseptkriteriet og planen sier det samme.
9. `tests/setup-env.ts` får standardverdier for `POWERSYNC_JWT_SECRET` og `POWERSYNC_URL`, og `ci.yml` får dem i begge jobbene (avsnitt 1). Ellers er `pnpm test` rødt uten `.env`-endring.
10. `docker compose config -q` kjøres med `--env-file .env.example`, så `${POWERSYNC_JWT_SECRET}` i compose er satt uansett `.env` (avsnitt 7 og 10).
11. Ny ren funksjon `buildTrialChangeOperations` i `upload-batch.ts` (2.10) gjør arkitektens «PUT med hele raden» testbar i Vitest; `connector.ts` selv kan ikke importeres uten DOM.
12. 413-testen sender en kropp som ikke er JSON, så 413 (ikke 400) beviser at kroppen ikke ble lest (6.2).
13. Avsnitt 11 lister to svakheter (låst kø ved 400/409, utlogging kaster køen) som ikke testes, men skal stå i resultatfilen under «det som ikke virket / kjente svakheter».
