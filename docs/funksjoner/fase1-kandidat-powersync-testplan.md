# Testplan: Første kandidat for drift uten nett – PowerSync koblet til testskjemaet

- **Oppgavekort:** `docs/funksjoner/fase1-kandidat-powersync.md` (pkt.-numrene under viser til kortet)
- **Fase:** 1 – Prøve uten nett, punktet «Kandidater satt opp mot samme testskjema», første kandidat
- **Branch:** `fase1-kandidat-powersync` (bygger på `main`)
- **Dato:** 28.10.2026
- **Laget av:** test-leder, før koding. Testnavnene er bindende for testskriver. Utvikler leser avsnitt 8 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad er den største tidsbesparelsen mot IVIT; testene viser at svar overlever lukking og uten nett) og reklamasjoner (ingenting går tapt mellom befaring og rapport; testene viser at bilder og svar bare slippes når serveren har bekreftet). KI først: ikke KI her, men synklaget testene vokter, er der KI-forslag senere skal vises på iPaden.

> **Avgjørelse etter runde 2 (prosjektleder, 28.10.2026):** tekstfletting (Yjs), varselet «Endret av en annen» og bildekøen **inkludert serverdelen** (`storeTrialPhoto`, ruten `PUT /api/prove/bilder/[id]`, `TRIAL_UPLOAD_DIR`) er kuttet til egne oppgaver. Kolonnen «Kommer i stedet» i avsnitt 11.2 gjelder, med ett unntak: **3.4 går også ut** (serverkode uten kaller bygges i bildekø-oppgaven, samme regel som for `DELETE` i runde 1). Dermed går 2.1, 2.2, 2.4 og 3.4 ut, «ugyldig text_state»-testen ut, «synk av trial_photos-raden etter opplasting …» til bildekø-oppgaven, og `test.fixme`-unntakene trengs ikke. Nytt i 3.2: «kropp over 4 MB gir 413 uten skriving» (e2e `request`, `TRIAL_SYNC_LIMITS.maxBodyBytes`). Nytt i 6.2: «innlogging med annen organisasjon tømmer lokal database og hurtiglager» sjekker også `caches.keys()`. Nytt i 2.9: synkreglene har eksplisitt kolonneliste uten `storage_path`, `text_state`, `created_by`, `updated_by`, `deleted_by`, og ingen `request.parameters()`. Test-leder justerer planen; dette avsnittet gjelder til det er gjort. Begrunnelsen står i kortet under «Avgjørelser etter runde 2».

Selve prøvene A og B på ekte iPad er **ikke** del av denne planen. De kjøres av Ståle etter protokollen i `docs/funksjoner/fase1-prove-ab-powersync.md`. Planen her dekker alt KI kan vise i Vitest og Playwright (Chromium) uten PowerSync-tjenesten.

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`: `resetDatabase`, `createUser`, `createOrganization`, `createEmployee(actor, organizationId, roles)`. **Endres:** `resetDatabase` får `trial_photos, trial_answers, trial_forms` først i truncate-listen (pkt. 10). Ingen nye fabrikker for `trial_*`: testene lager rader gjennom `applyTrialChanges` (da testes kontrakten samtidig) eller med `db.insert` når de trenger en rad i en fremmed organisasjon.
- `tests/tenant-isolation.ts`: `expectTenantIsolation({ seed, query, idOf })`. Brukes for `listTrialForms` og `listTrialAnswers` (avsnitt 3). Merk: `query` tar `(actor, organizationId)`; `listTrialAnswers` tar også `trialFormId`, så testen pakker den inn med skjema-id-en fra `seed` (se avsnitt 3).
- `e2e/helpers.ts`: `logIn(page, ADMIN_EMAIL)`. Alle innloggede e2e-tester bruker den. Bare admin finnes i seed, så e2e tester admin; rollene testes i Vitest.
- `playwright.config.ts`: prosjektene `pc` og `ipad` (1194 × 834, `hasTouch`), `workers: 1`. **Endres:** `webServer.env` får `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET`, `TRIAL_UPLOAD_DIR` (egen mappe per kjøring er ikke nødvendig; `var/uploads/trial` er i `.gitignore`) og `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1` (pkt. 14).
- `vitest.config.ts`: tar bare `src/**/*.test.ts` og `tests/**/*.test.ts`. **Ikke** `.test.tsx`, og ingen DOM. Derfor ingen komponenttest; skjermene dekkes av e2e. Rene funksjoner i modulen må kunne importeres uten React, `server-only`, `window` eller `@powersync/web` (se avsnitt 8).
- `src/core/access/guards.test.ts`: mønster for roller, deaktivert ansatt og slettet organisasjon. Testene her gjentar ikke `requireOrganizationAccess` sin logikk, bare at hver ny funksjon kaller den (fremmed organisasjon gir `AccessDeniedError`, deaktivert nektes, alle roller med `organization.read` slipper inn).
- `e2e/fase-0a.spec.ts`: mønster for `request`-tester mot API-ruter.
- `e2e/fase-1-testskjema.spec.ts`: dagens 14 tester. **Endres** (avsnitt 6.1), ikke erstattes.

## 2. Enhetstester (Vitest, rene, ingen database)

### 2.1 `src/modules/offline-trial/text-merge.test.ts` (pkt. 17)

| Testnavn | Viser |
|---|---|
| «createTextState og textOf gir samme tekst tilbake» | `textOf(createTextState("Tak i god stand"))` → `"Tak i god stand"`; tom streng gir tom streng. |
| «applyTextEdit legger til tekst i slutten, starten og midten» | Fra `"abc"`: `"abcd"`, `"xabc"`, `"abXc"`. `textOf` gir ny tekst for alle tre. |
| «applyTextEdit sletter tekst i slutten, starten og midten» | Fra `"abcd"`: `"abc"`, `"bcd"`, `"ad"`. |
| «applyTextEdit erstatter hele teksten» | Fra `"gammel"` til `"ny"`. |
| «to som skriver i hver sin ende samtidig gir en tekst med begge bidrag» | Felles start `"Taket "`; A legger til `"er tett."` på slutten, B legger til `"Merk: "` foran, hver fra felles start. `textOf(merge(a, b))` inneholder både `"Merk: "` og `"er tett."` og `"Taket "` én gang. |
| «mergeTextStates er symmetrisk» | `textOf(merge(a, b)) === textOf(merge(b, a))` for sakene over. |
| «samme tilstand flettet to ganger gir samme resultat» | `textOf(merge(merge(a, b), b)) === textOf(merge(a, b))` (idempotent, serveren får bunter to ganger). |
| «tom tilstand flettet med tekst gir teksten» | `textOf(merge(createTextState(""), a)) === textOf(a)`, begge veier. |
| «æøå og emoji overlever redigering og fletting» | `"Blåbærsyltetøy 🏠"` → legg til `" på Ørnes"`; flettes med en annen tilstand; tegnene er intakte og `length` stemmer med forventet streng. |
| «tilstanden er base64 og tåler JSON-rundtur» | `state` matcher `/^[A-Za-z0-9+/]+=*$/`; `JSON.parse(JSON.stringify({ state }))` gir en tilstand `textOf` leser likt. |
| «ugyldig tilstand kaster en tydelig feil» | `textOf("ikke base64!!")` kaster `Error` (ikke stille tom tekst). Serveren må kunne gi 400, ikke skrive tom tekst. |

### 2.2 `src/modules/offline-trial/foreign-change.test.ts` (pkt. 19)

`detectForeignChanges(previousRows, nextRows, deviceId): Set<string>`. Rader er `TrialAnswerRow` med `field_key`, `value` (JSON-streng), `device_id`.

| Testnavn | Viser |
|---|---|
| «endring fra en annen enhet gir feltnøkkelen» | `roof_tg` fra `"TG2"` (`device_id: "min"`) til `"TG3"` (`device_id: "annen-enhet"`) → `Set(["roof_tg"])`. |
| «egen endring gir ikke varsel» | Samme endring med `device_id: "min"` på begge → tom Set. |
| «tom previousRows gir aldri varsel» | `previousRows = []`, `nextRows` med 40 rader fra annen enhet → tom Set. |
| «uendret verdi fra annen enhet gir ikke varsel» | Samme `value`, bare `device_id` byttet til annen → tom Set. |
| «ny rad fra annen enhet i et felt denne enheten aldri har satt gir varsel» | `previousRows` har andre felt, `nextRows` får `floors = 7` fra annen enhet → `Set(["floors"])`. |
| «bare tg, choice og number gir varsel» | Fremmed endring i `roof_description` (text), `drill_measurements` (table) og `cover_photo` (photo) → tom Set; i `roof_tg`, `leak_stopper`, `moisture_floor` → alle tre. Bruker `trialForm` for å finne typen. |
| «ukjent feltnøkkel gir ikke varsel» | `unknown_key` fra annen enhet → tom Set. |
| «myk slettet rad gir ikke varsel» | Rad med `deleted_at` satt → ikke med. |

### 2.3 `src/modules/offline-trial/sync/answer-rows.test.ts` (pkt. 7)

| Testnavn | Viser |
|---|---|
| «answerToRow gir rad med field_key, value som JSON-streng og device_id» | `answerToRow(formId, "floors", 7, "enhet-1")` → `trial_form_id`, `field_key: "floors"`, `value: "7"`, `device_id: "enhet-1"`, ingen `organization_id` og ingen `id`-krav fra kalleren (id lages med `uuidv7` og består `isUuid`). |
| «answerToRow lagrer 0 og null forskjellig» | `0` → `"0"`, `null` → `"null"`. |
| «rowsToAnswers nøkler på field_key og leser value fra JSON» | To rader → `{ floors: 7, roof_tg: "TG2" }`. |
| «rowsToAnswers skiller 0 og null» | `"0"` → `0` (teller som utfylt), `"null"` → `null`. |
| «rowsToAnswers hopper over rader med deleted_at» | Rad med `deleted_at` er ikke i svaret. |
| «rowsToAnswers tar siste rad når samme field_key kommer to ganger» | Lokal database kan kortvarig ha to rader (før serverens id vinner); den med høyest `updated_at` gjelder. Ingen krasj. |
| «bildefelt bygges av trial_photos, aldri av trial_answers.value» | `trial_answers` har `cover_photo` med `value: "[]"` og én `trial_photos`-rad → svaret har ett bilde med `id`, `name`, `sizeBytes`. |
| «bilderekkefølgen er stabil: created_at, så id» | Tre bilder gitt i tilfeldig rekkefølge → sortert på `created_at`, like tidsstempler sortert på `id`. |
| «myk slettet bilde er ikke med» | `trial_photos` med `deleted_at` → ikke i listen. |
| «value tåler JSON-rundtur for alle seks typene» | Tekst, TG, valg, tall, tabell (med `TrialTableRow`) og tomt bildefelt gjennom `answerToRow` → `rowsToAnswers` gir `toEqual` på originalen. |
| «ugyldig JSON i value gir null, ikke krasj» | `value: "{ikke json"` → feltet er `null`, de andre feltene leses. |

### 2.4 `src/modules/offline-trial/sync/photo-upload.test.ts` (pkt. 22)

`shouldReleaseLocalPhoto(localSha256, response): boolean`.

| Testnavn | Viser |
|---|---|
| «lik sha256 og status 200 gir slipp» | → `true`. |
| «ulik sha256 gir behold» | status 200, annen sha → `false`. |
| «status 201, 400, 404, 500 gir behold selv om sha er lik» | Alle → `false`. Bare nøyaktig 200. |
| «manglende svar gir behold» | `undefined`/`null`/kastet nettverksfeil → `false`. |
| «tom eller manglende sha256 i svaret gir behold» | `{ sha256: "" }` og `{}` → `false`. |
| «sammenligningen skiller store og små bokstaver ikke, men krever 64 hex-tegn» | `"ABC…"` mot `"abc…"` lik → `true`; 63 tegn → `false`. |

### 2.5 `src/modules/offline-trial/answers.test.ts` (utvides, pkt. 20)

Dagens ni tester beholdes. Testen «parseTrialNumber godtar komma og punktum, avviser tekst» erstattes av:

| Testnavn | Viser |
|---|---|
| «parseTrialNumber godtar strengt desimaltall med komma eller punktum» | `"12,5"` → 12.5, `"12.5"` → 12.5, `"0"` → 0, `"-3"` → -3, `" 7 "` → 7, `"007"` → 7, `"-0,5"` → -0.5. |
| «parseTrialNumber avviser alt som ikke er et rent desimaltall» | `"1e3"`, `"Infinity"`, `"-Infinity"`, `"NaN"`, `"0x10"`, `"1 000"`, `"12,"`, `",5"`, `"12,5,1"`, `"1_000"`, `"abc"`, `""`, `"   "`, `"+3"` → alle `null`. |

### 2.6 `src/modules/offline-trial/sync/device.test.ts` (pkt. 6)

| Testnavn | Viser |
|---|---|
| «getTrialDeviceId lager en uuid og gir den samme neste gang» | Med en falsk `Storage` (Map) sendt inn eller `globalThis.localStorage` stubbet: første kall gir en id som består `isUuid`, andre kall gir samme id, nøkkelen er `trial_device_id`. |
| «getTrialDeviceId respekterer en id som allerede ligger lagret» | Forhåndslagt verdi returneres uendret. |

### 2.7 `src/modules/offline-trial/sync/powersync/schema.test.ts` (pkt. 3)

Importerer bare klientskjemaet (ren datadefinisjon). Hvis `@powersync/web` ikke kan importeres i Node uten DOM, legges kolonnelisten i en egen fil `schema-columns.ts` som både skjemaet og testen bruker.

| Testnavn | Viser |
|---|---|
| «klientskjemaet har tabellene trial_forms, trial_answers og trial_photos» | Nøyaktig tre tabeller. |
| «kolonnenavnene i klientskjemaet finnes i PostgreSQL-skjemaet» | Hver kolonne i klientskjemaet finnes i `getTableColumns()` fra Drizzle for samme tabell (`src/db/schema/offline-trial.ts`). Fanger stavefeil som ellers gir tom synk. |
| «storage_path synkes ikke til enheten» | `trial_photos` i klientskjemaet har ikke `storage_path`. |

### 2.8 `src/modules/offline-trial/server/change-schema.test.ts` (pkt. 11, Zod-skjemaet for nyttelasten)

| Testnavn | Viser |
|---|---|
| «godtar PUT og PATCH for de tre tabellene» | Gyldig bunt parses. |
| «avviser DELETE, ukjent op og ukjent tabell» | `op: "DELETE"`, `op: "UPSERT"`, `table: "users"` → feil. |
| «avviser mer enn 500 operasjoner» | 501 → feil, 500 → ok. |
| «avviser value og text_state over 64 kB og device_id over 64 tegn» | Grensene fra kortet. |
| «avviser id som ikke er uuid» | `id: "../x"` → feil (før noe treffer databasen). |

### 2.9 `powersync/config.test.ts` i `tests/` (pkt. 13, leser filene som tekst/YAML)

| Testnavn | Viser |
|---|---|
| «config.yaml slår av telemetri og leser hemmeligheter fra miljøet» | `telemetry.disable_telemetry_sharing === true`; `client_auth.audience` inneholder `"powersync"`; ingen linje i filen inneholder utviklingsverdien for `POWERSYNC_JWT_SECRET` fra `.env.example` eller en tilkoblingsstreng med passord (regex `postgres(ql)?:\/\/\w+:\w+@`). `!env` brukes for `k` og tilkoblingen. |
| «sync-rules.yaml filtrerer alle tre tabellene på organization_id og deleted_at» | Én bøtte, parameter med `request.jwt() ->> 'organization_id'`, tre `SELECT` som hver inneholder `organization_id = bucket.organization_id` og `deleted_at IS NULL`. Ingen fjerde tabell. |
| «docker-compose binder PowerSync bare til 127.0.0.1 og bruker fast versjonstag» | `powersync.ports[0]` begynner med `127.0.0.1:`; `image` slutter ikke på `:latest` og har en tag; `depends_on.db.condition === "service_healthy"`; konfigurasjonsfilene er montert `:ro`; `db.command` inneholder `wal_level=logical`. |

Filene leses som tekst med regex (ingen YAML-parser i treet, og `config.yaml` bruker `!env`-merker). Ingen ny avhengighet for dette.

## 3. Integrasjonstester mot testdatabasen (Vitest, `beforeEach(resetDatabase)`)

Alle bruker `createOrganization`, `createUser`, `createEmployee`. Innloggede roller lages med `createEmployee(actor, org.id, ["inspector"])` osv.

### 3.1 `src/modules/offline-trial/server/trial-queries.test.ts` (pkt. 11, `listTrialForms` og `listTrialAnswers`)

| Testnavn | Viser |
|---|---|
| «listTrialForms gir aldri skjemaer fra en annen organisasjon (expectTenantIsolation)» | `seed` skriver ett skjema i hver organisasjon via `applyTrialChanges(adminX, grantX.organizationId, [PUT trial_forms])`; `query: listTrialForms`; `idOf: row => row.id`. **Obligatorisk.** |
| «listTrialAnswers gir aldri svar fra en annen organisasjon (expectTenantIsolation)» | `seed` lager skjema og én `trial_answers`-rad per organisasjon, husker skjema-id per organisasjon i en lukning; `query: (actor, orgId) => listTrialAnswers(actor, orgId, formIdFor(orgId))`. `formIdFor` velger skjema-id ut fra hvilken organisasjon som spørres, så steg 3 og 4 (fremmed id) treffer `requireOrganizationAccess` og ikke en tom liste. **Obligatorisk.** |
| «listTrialAnswers med skjema-id fra en annen organisasjon gir tom liste, ikke fremmede rader» | Bruker i A spør mot A med B sin skjema-id → `[]`. `WHERE organization_id = grant.organizationId AND trial_form_id = …`. |
| «listTrialForms og listTrialAnswers hopper over myk slettede rader» | Sett `deleted_at` direkte med `db.update` → raden er borte fra svaret, men finnes i databasen (`db.select` uten filter gir den). Regel 3. |
| «alle fire roller kan lese, deaktivert ansatt nektes» | `inspector`, `office`, `manager`, `admin` får svar; ansatt med `deactivated_at` satt får `AccessDeniedError`. |

### 3.2 `src/modules/offline-trial/server/apply-changes.test.ts` (pkt. 11, `applyTrialChanges`)

| Testnavn | Viser |
|---|---|
| «skriver skjema, svar og bilde med organization_id fra grant» | PUT i alle tre tabeller → rader i databasen har `organization_id === grant.organizationId`, `created_by === actor.id`, `updated_by === actor.id`. Svar `{ applied: 3 }`. |
| «bruker aldri organization_id fra nyttelasten» | `data.organization_id = orgB.id` i alle tre → radene får `orgA.id`. **Obligatorisk.** |
| «fremmed organisasjon gir AccessDeniedError og ingen skriving» | Bruker i A mot `orgB.id` → kaster, `count(*)` i alle tre tabeller er 0. **Obligatorisk.** |
| «fremmed id gir 409-feil og raden i den andre organisasjonen er uendret» | B har et skjema med id X. A sender PUT `trial_forms` med id X og `name: "kapret"` → kaster `TrialIdConflictError` (navnet er bindende, ruten gir 409), B sin rad har fortsatt sitt navn og `row_version`, og A har ingen rad med id X. Samme for `trial_answers` og `trial_photos` (tre `it.each`-saker). **Obligatorisk.** |
| «fremmed trial_form_id gir InvalidTrialChangeError og ingen rad» | A sender `trial_answers` og `trial_photos` med `trial_form_id` fra B sitt skjema → kaster, 0 rader i A. **Obligatorisk.** |
| «ukjent trial_form_id gir InvalidTrialChangeError» | Tilfeldig uuid som skjema → kaster. Svar før skjema er en feil på klienten, ikke stille tap. |
| «DELETE, ukjent tabell og ukjent felt gir InvalidTrialChangeError og ingen skriving» | Tre saker; en gyldig PUT i samme bunt skrives **ikke** (hele bunten avvises, så klienten kan prøve igjen uten halvskrevne data). |
| «serverstyrte kolonner i nyttelasten overses» | `data` har `organization_id`, `created_by`, `updated_by`, `row_version: 99`, `uploaded_at`, `sha256`, `storage_path` → ingen feil, raden har serverens verdier (`row_version` 1, `uploaded_at` null, `sha256` null). |
| «samme bunt to ganger gir samme data og øker ikke row_version» | PUT ×2 med identisk `data` → én rad per tabell, `row_version` uendret (ingen faktisk endring), `updated_at` kan endre seg. |
| «en faktisk endring øker row_version» | PUT `floors = 7`, så `floors = 8` → `row_version` 1 → 2, `value` er `8`. |
| «PATCH oppdaterer bare feltene som sendes» | PATCH `trial_forms` med `{ name }` beholder andre kolonner. PATCH på rad som ikke finnes → raden opprettes (upsert) hvis `data` er fullstendig, ellers `InvalidTrialChangeError`. |
| «trial_answers med annen id for samme (trial_form_id, field_key) beholder serverens id» | Rad finnes med id S. PUT med id T, samme skjema og felt, `value: 9` → én rad, id S, `value` 9. **Vokter unik-nøkkelen.** |
| «to enheters text_state for samme felt flettes på serveren og value er den flettede teksten» | Enhet 1 PUT `roof_description` med `text_state` a (`"Taket er tett."`), enhet 2 PUT med `text_state` b (`"Merk: "` foran, fra felles tom start) → lagret `value` inneholder begge bidrag, lagret `text_state` er `merge(a, b)` (sammenlignet via `textOf`). `value` fra nyttelasten (`"bare enhet 2"`) ignoreres. |
| «text_state null på begge sider gir siste endring vinner» | To PUT uten `text_state` → siste `value` gjelder. |
| «ugyldig text_state gir InvalidTrialChangeError» | `text_state: "ikke base64!!"` → kaster, ingen rad. |
| «siste endring vinner for tg, valg, tall og tabell» | To PUT etter hverandre på `roof_tg`, `leak_stopper`, `moisture_floor`, `drill_measurements` → den siste gjelder, ett `row_version`-hopp per endring. |
| «bunter over 500 operasjoner og value over 64 kB gir InvalidTrialChangeError» | Zod-grensene håndheves også i funksjonen, ikke bare i ruten. |
| «alle fire roller kan skrive, deaktivert ansatt nektes» | `it.each` over rollene; deaktivert → `AccessDeniedError`. Admin stenges aldri ute. |
| «logger aldri innholdet i endringene» | Spion på `console.info`/`console.log`/loggeren som brukes: etter en bunt med `value: "HEMMELIG-MARKØR-1234"` og `text_state`, inneholder ingen loggmelding markøren. Pkt. 11 «Logging». |

### 3.3 `src/modules/offline-trial/server/sync-token.test.ts` (pkt. 11, `issueSyncToken`)

Miljøvariabler settes med `vi.stubEnv` per test (`POWERSYNC_JWT_SECRET`, `POWERSYNC_URL`, `BETTER_AUTH_URL`) og nullstilles i `afterEach`.

| Testnavn | Viser |
|---|---|
| «tokenet har organization_id lik grant.organizationId og aud powersync» | Dekod nyttelasten (base64url) → `organization_id === grant.organizationId`, `aud === "powersync"`, `sub === actor.id`. `endpoint === POWERSYNC_URL`. |
| «tokenet har bare sub, organization_id, aud, iat og exp» | `Object.keys(payload).sort()` er nøyaktig disse fem. Aldri e-post eller navn (test med en bruker med `name: "Kari Nordmann"` og sjekk at verken navn eller e-post finnes i den dekodede JSON-en). |
| «exp er høyst én time etter iat» | `exp - iat <= 3600` og `> 0`. |
| «signaturen er HS256 og kan verifiseres med node:crypto» | Hode `alg === "HS256"`, `kid === "trial"` hvis satt; `createHmac("sha256", secret)` over `header.payload` i base64url er lik signaturen. Feil hemmelighet gir ulik signatur. |
| «uten POWERSYNC_JWT_SECRET kastes en tydelig feil» | `vi.stubEnv("POWERSYNC_JWT_SECRET", "")` → kaster `Error` med «POWERSYNC_JWT_SECRET» i meldingen. Aldri et token. |
| «for kort hemmelighet (under 32 byte) kastes feil» | 31 tegn → kaster. |
| «utviklingsverdien fra .env.example nektes når BETTER_AUTH_URL ikke er localhost» | Les `.env.example`, hent verdien, sett `BETTER_AUTH_URL=https://test.example.com` → kaster. Med `http://localhost:3000` → ok. |
| «fremmed organisasjon gir AccessDeniedError» | Bruker i A mot `orgB.id`. **Obligatorisk.** |
| «alle fire roller får token, deaktivert ansatt nektes» | `it.each`. |

### 3.4 `src/modules/offline-trial/server/photo-storage.test.ts` (pkt. 11, `storeTrialPhoto`)

`TRIAL_UPLOAD_DIR` pekes til `fs.mkdtemp` i `beforeEach` (`vi.stubEnv`), ryddes i `afterEach`. Bytes: en liten oppdiktet PNG-buffer (`e2e/fixtures/test-image.png` kan leses inn) eller `Buffer.from("oppdiktet")` med `Content-Type: image/png`.

| Testnavn | Viser |
|---|---|
| «lagrer filen under TRIAL_UPLOAD_DIR/<organizationId>/<id> og svarer riktig sha256» | Filen finnes på stien, innholdet er likt, `sha256` i svaret er lik `createHash("sha256")` over bytes, raden har `sha256`, `storage_path`, `uploaded_at` satt. |
| «lager raden fra meta når den mangler» | Ingen `trial_photos`-rad på forhånd → etter kall finnes raden med `trial_form_id`, `field_key`, `name`, `size_bytes` fra `meta` og `organization_id = grant.organizationId`. |
| «oppdaterer eksisterende rad uten å endre id, trial_form_id eller field_key» | Rad finnes (fra `applyTrialChanges`) → bare `sha256`, `storage_path`, `uploaded_at`, `updated_by` endres. |
| «idempotent: samme fil to ganger gir samme sti og samme sha256» | To kall → én rad, én fil, likt svar. |
| «ugyldig id gir 404-feil uten filskriving» | `photoId = "../x"` og `"x"` → kaster `TrialPhotoNotFoundError` (navnet er bindende, ruten gir 404), mappen `TRIAL_UPLOAD_DIR` er tom (ingen fil, ingen undermappe). **Obligatorisk (sti-vokter).** |
| «bilde-id i en annen organisasjon gir 404-feil uten filskriving» | B har `trial_photos`-rad X. A kaller med X → kaster `TrialPhotoNotFoundError`, ingen fil under `orgA.id/` eller `orgB.id/`, B sin rad er uendret. **Obligatorisk.** |
| «fremmed trial_form_id i meta gir InvalidTrialChangeError uten fil» | `meta.trial_form_id` fra B → kaster, ingen rad, ingen fil. **Obligatorisk.** |
| «innholdstype som ikke er image/* gir InvalidTrialChangeError» | `application/pdf`, `text/html`, tom → kaster, ingen fil. `image/jpeg`, `image/png`, `image/heic` → ok. |
| «fil over TRIAL_PHOTO_MAX_BYTES gir TrialPhotoTooLargeError» | `vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", "10")`, 11 bytes → kaster (ruten gir 413), ingen fil. Standardgrensen er 25 MB (test leser konstanten). |
| «den ferdige stien ligger alltid under TRIAL_UPLOAD_DIR» | Med `TRIAL_UPLOAD_DIR` satt til en relativ sti (`var/tmp-test`) → stien som lagres i `storage_path` starter med `path.resolve(TRIAL_UPLOAD_DIR)`. |
| «fremmed organisasjon gir AccessDeniedError» | Bruker i A mot `orgB.id`. **Obligatorisk.** |
| «alle fire roller kan laste opp, deaktivert ansatt nektes» | `it.each`. |

### 3.5 `src/db/offline-trial-schema.test.ts` (pkt. 10, migrering og publikasjon)

| Testnavn | Viser |
|---|---|
| «migreringen lager trial_forms, trial_answers og trial_photos med baseColumns» | `information_schema.columns` for hver tabell inneholder `id`, `organization_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`, `row_version`. |
| «trial_answers er unik på (trial_form_id, field_key)» | To `db.insert` med samme par → andre kaster (unik-brudd). |
| «publikasjonen powersync har nøyaktig trial_forms, trial_answers og trial_photos» | `SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'` → sortert lik `["trial_answers", "trial_forms", "trial_photos"]`. Aldri `users`, `sessions`, `verifications`. **Obligatorisk (sikkerhet).** |
| «publikasjonen er ikke FOR ALL TABLES» | `SELECT puballtables FROM pg_publication WHERE pubname = 'powersync'` → `false`. |

### 3.6 `tests/factories.test.ts` (liten, valgfri)

| Testnavn | Viser |
|---|---|
| «resetDatabase tømmer trial_-tabellene» | Legg inn ett skjema, kall `resetDatabase`, `count(*) === 0` i alle tre. Fanger at truncate-listen glemmes. |

## 4. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | 3.1, 3.2, 3.3, 3.4: «alle fire roller … deaktivert ansatt nektes». E2e 6.2: 401 uinnlogget på alle tre ruter. | Alle fire funksjonene kaller `requireOrganizationAccess(actor, organizationId, "organization.read")`. Ingen rolle stenges ute. |
| Tenant-isolasjon | `expectTenantIsolation` for `listTrialForms` og `listTrialAnswers` (3.1). `issueSyncToken`, `applyTrialChanges`, `storeTrialPhoto`: fremmed organisasjon gir `AccessDeniedError`, `organization_id` fra nyttelast ignoreres, fremmed `id` gir 409 uten skriving, fremmed `trial_form_id` gir 400 uten skriving (3.2–3.4). E2e 6.2: 403 på alle tre ruter med fremmed `?organisasjon=`. Synkreglene: 2.9. JWT bærer `grant.organizationId`: 3.3. | Testene merket **Obligatorisk** må alle finnes og være grønne. Mangler én, avvises PR-en (ansvar i rollen). |
| Admin stenges aldri ute | Admin er med i alle `it.each` over roller og i `expectTenantIsolation` (bruker admin i begge organisasjoner). E2e logger inn som admin og gjør alt. | Ingen ny tilgangslogikk. |
| Myk sletting | 3.1 «hopper over myk slettede rader», 2.3 «hopper over deleted_at» og «myk slettet bilde er ikke med», 2.2 «myk slettet rad gir ikke varsel», 2.9 `deleted_at IS NULL` i synkreglene, 3.2 «DELETE … gir InvalidTrialChangeError». | Ingen skjerm sletter noe; `deleted_at` ligger i `baseColumns` og filtreres overalt. |
| Ingen kundeopplysninger | Alle testdata er oppdiktede («Oppdiktet tekst», `example.com`). 3.3 viser at JWT aldri bærer navn eller e-post. 3.2 viser at logg aldri inneholder fritekst. | Regel 8. |

## 5. Regeltester

Ingen regler eller TG-logikk (prøve E). Flettereglene (tekst) og «siste endring vinner» er kode med testsaker i 2.1, 2.2 og 3.2. Test-leder sjekker at modulen ikke inneholder TG-avledning fra tall.

## 6. E2e (Playwright, Chromium, `pc` og `ipad`)

Uten PowerSync-tjeneste: koblingen feiler stille i bakgrunnen (SDK-ens standard), den lokale databasen virker. Alle tester bruker `logIn(page, ADMIN_EMAIL)`.

**Felles hjelpere i `e2e/helpers.ts` (nye):**
- `createTrialForm(page): Promise<string>`: går til `/prove/testskjema`, trykker «Nytt testskjema», venter på URL `/prove/testskjema/<uuid>`, returnerer id-en.
- `indicator(page)`: `page.getByTestId("sync-indicator")`.
- `setAnswerViaHook(page, formId, fieldKey, value, deviceId)`: `page.evaluate` som skriver en `trial_answers`-rad i `window.__offlineTrial.db` (upsert på `(trial_form_id, field_key)`) med `device_id`.

### 6.1 `e2e/fase-1-testskjema.spec.ts` (tilpasses listen)

- `openTrialForm` blir: `logIn` → `createTrialForm` → `expectCount(page, 0)`. Testen «uinnlogget sendes til innlogging fra /prove/testskjema» er uendret. Testen «admin finner lenken …» ender nå på listen: forventer overskriften «Testskjema» og knappen «Nytt testskjema», og først etter trykk «0 av 40 felt utfylt».
- Alle de andre 12 testene beholdes med samme navn og skal være grønne i både `pc` og `ipad`, særlig «alle 40 felt fylles ut og telleren viser 40 av 40» (akseptkriterium 1).
- Ny: «tall med komma på slutten beholdes mens man skriver» (pkt. 20): `fill("12,")` i «Antall etasjer» → `toHaveValue("12,")`, telleren uendret; `fill("12,5")` → teller +1; `blur` → verdien vises som «12,5».
- Ny: «Nytt testskjema er minst 44 px høy» (`test.skip` utenfor `ipad`).

### 6.2 `e2e/fase-1-powersync.spec.ts` (ny)

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «listen viser nye testskjemaer med navn og laget når, og åpner dem» | To trykk på «Nytt testskjema» (gå tilbake mellom) → listen har «Testskjema 1» og «Testskjema 2» med en tidsangivelse hver; trykk på «Testskjema 1» → URL med riktig id. | pc, ipad |
| «svarene overlever at siden lastes på nytt uten server» | Fyll `roof_tg = TG2`, `floors = "7"`, «Tak – beskrivelse» = «Oppdiktet tekst», ett bilde i «Forsidebilde». `page.reload()`. Alle fire står, teller «4 av 40». Deretter `page.goto("/prove/testskjema")` → skjemaet står i listen; åpne → fortsatt 4. | pc, ipad |
| «indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett» | Med nett: indikator matcher `/^(Venter: \d+ endring(er)?, \d+ bilde(r)?|Alt er lagret på serveren)$/`. `context.setOffline(true)` → `toHaveText("Uten nett")`. Skriv `floors = "3"` → fortsatt «Uten nett», teller +1. `setOffline(false)` → matcher `/^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/` (uten tjeneste blir N aldri 0). | pc, ipad |
| «indikatoren bøyer entall og flertall riktig» | Via testkroken: `window.__offlineTrial.pendingOverride = { changes: 1, photos: 1 }` hvis utvikler tilbyr det; ellers regnes testen ut fra faktisk kø: etter nøyaktig én endring og ett ikke-opplastet bilde (server nede via `page.route("**/api/prove/bilder/**", abort)`) viser indikatoren «Venter: 1 endring, 1 bilde». Etter to endringer: «2 endringer». | pc |
| «skjemaet åpner fra hurtiglageret uten nett etter ett besøk» | Besøk skjemaet med nett, vent på `navigator.serviceWorker.ready` og at `caches.keys()` ikke er tom. `setOffline(true)`, `page.reload()` → overskrift og teller synlige, indikatoren «Uten nett». **Reserve** hvis `setOffline` ikke treffer service worker-henting i Chromium: `page.evaluate(() => caches.match("/_next/static/…"))` for ett av skriptene på siden og `caches.match(location.pathname)` er begge truthy; testen sier i navnet hvilken vei som ble brukt (`test.info().annotations.push`). | pc, ipad |
| «bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder» | `page.route("**/api/prove/bilder/**", route => route.abort())` → velg bilde → indikator matcher `/, 1 bilde$/`; IndexedDB `offline-trial-photos` har én nøkkel (`page.evaluate`). `page.unroute(...)` → indikator matcher `/, 0 bilder$|^Alt er lagret/` innen 15 s; IndexedDB er tom; raden i lokal database har `uploaded_at`. | pc, ipad |
| «bildet beholdes lokalt når serveren svarer med feil sha256» | `page.route` som svarer `200 { sha256: "0".repeat(64) }` → indikator fortsatt «1 bilde», IndexedDB fortsatt én nøkkel. (Ren funksjon er testet i 2.4; dette viser koblingen. Serversiden med fingeravtrykk er prøve D.) | pc |
| «tall satt utenfra via testkroken vises i feltet med Endret av en annen» | Skriv `floors = "5"` selv. `setAnswerViaHook(page, formId, "floors", 7, "annen-enhet")` → «Antall etasjer» `toHaveValue("7")`, `getByRole("status", { name: /Endret av en annen/ })` eller `getByText("Endret av en annen")` innenfor `[data-field="floors"]` synlig. Klikk i feltet → teksten borte. | pc, ipad |
| «TG og valg satt utenfra viser Endret av en annen, egen endring gjør det ikke» | Sett `roof_tg = TG2` selv (ingen varsel). Krok: `roof_tg = "TG3"` fra `annen-enhet` → TG3 `aria-pressed="true"`, varsel under `roof_tg`. Krok: `leak_stopper = "no"` → varsel. Krok med egen `deviceId` (`window.__offlineTrial.deviceId`): `moisture_floor = 12` → ingen varsel. | pc, ipad |
| «tekstfelt satt utenfra gir ikke varsel, men viser teksten» | Krok: `roof_description` fra annen enhet (uten `text_state`) → feltet viser teksten, ingen «Endret av en annen» i `[data-field="roof_description"]`. | pc |
| «tekst skrevet i feltet lagres med text_state i lokal database» | Skriv «Oppdiktet tekst» i «Tak – beskrivelse», vent 500 ms → `page.evaluate` leser raden: `value === "\"Oppdiktet tekst\""` og `text_state` er en ikke-tom base64-streng. Hvis tekstfletting er utsatt (pkt. 18, grense for arbeidet), merkes testen `test.fixme` med henvisning til resultatfilen; test-leder godkjenner da bare når utsettelsen står i PR-en og resultatfilen. | pc |
| «første lasting av et skjema fra en annen enhet gir ingen varsler» | Krok: skriv 5 rader fra `annen-enhet` **før** skjemaet åpnes (fra listen). Åpne → 0 treff på «Endret av en annen». | pc, ipad |
| «uinnlogget gir 401 på alle tre synkrutene» | `request` uten cookies: `GET /api/prove/synk/token?organisasjon=<uuid>`, `POST /api/prove/synk/endringer`, `PUT /api/prove/bilder/<uuid>?…` → alle 401. | pc |
| «fremmed organisasjon gir 403 på alle tre synkrutene» | Innlogget `page.request` (deler cookies): samme tre med `organisasjon=<tilfeldig uuid>` → alle 403, og token-svaret har ikke `token` i kroppen. | pc |
| «token-ruten svarer med no-store og et token for egen organisasjon» | Finn organisasjons-id via `window.__offlineTrial.organizationId` (eller fra siden). `GET token` → 200, `cache-control` inneholder `no-store`, JSON har `token` (tre deler skilt med punktum) og `endpoint`. Dekod nyttelasten i testen: `organization_id` lik id-en, ingen `email`. | pc |
| «endringer-ruten gir 400 for DELETE og 409 for fremmed id» | `POST endringer` med `op: "DELETE"` → 400 med norsk feilmelding i JSON. 409 krever en rad i en annen organisasjon; e2e har bare Byggcon, så 409 dekkes i Vitest (3.2) og testen sjekker bare 400 her. Navnet justeres til «endringer-ruten gir 400 for DELETE og ukjent felt». | pc |
| «bilder-ruten gir 404 for ugyldig id og 400 for feil innholdstype» | `PUT /api/prove/bilder/ikke-en-uuid` → 404. `PUT /api/prove/bilder/<uuid>` med `Content-Type: text/plain` og gyldig `skjema` → 400. | pc |
| «service worker rører ikke API og innlogging» | Etter registrering: `page.evaluate(() => caches.keys())` og innholdet (`cache.keys()`) har ingen URL under `/api/`, `/logg-inn` eller `/dev/epost`. Viser at tokens og e-postkoder aldri legges i hurtiglageret. | pc |
| «innlogging med annen organisasjon tømmer lokal database» | Hvis det kan gjøres uten PowerSync-tjeneste: `page.evaluate` som setter `localStorage.trial_last_organization_id` til en annen uuid (eller den kroken utvikler legger ut, `window.__offlineTrial.simulateOrganizationChange(uuid)`) → `reload` → lokal database har 0 skjemaer. Hvis det ikke lar seg gjøre uten tjenesten: `test.fixme` med begrunnelse, og det står i resultatfilen. | pc |

Alle `page.route`-tester bruker `page.unroute` i `finally`, og e2e sletter aldri noe i databasen (hvert skjema er nytt; listen vokser i løpet av kjøringen, det er greit).

## 7. Skript, konfigurasjon og dokumentasjon (test-leder kjører for hånd)

| Sjekk | Kommando | Forventet |
|---|---|---|
| `start.sh` er gyldig bash 3.2 | `bash -n start.sh` og `bash --posix -n start.sh` | ingen feil; ingen `[[ … ]]`-konstruksjoner nye for bash 4 (`mapfile`, `declare -A`, `${var,,}`) i `git diff main.. -- start.sh` |
| `start.sh` kjører uten Docker | `EZPROP_SKIP_DOCKER=1 ./start.sh` (med database i `DATABASE_URL`) | går gjennom alle steg, `TOTALT` stemmer med antall `steg`-kall, skriver PowerSync-adressen i oppsummeringen |
| compose er gyldig | `docker compose config -q` | ingen feil (Compose v5.6.1 finnes i skyen; daemon trengs ikke for `config`, så sjekken kjøres alltid) |
| Ingen produktnavn i `public/sw.js` | `grep -n "EzProp" public/sw.js` | tomt |
| Hodekommentar | `grep -L "Prøve fase 1" src/modules/offline-trial/sync/powersync/*.ts src/modules/offline-trial/server/photo-storage.ts` | tomt (alle har den) |
| Ingen hemmelighet i repoet | `grep -rn "POWERSYNC_JWT_SECRET" --include=*.ts --include=*.yaml --include=*.yml . | grep -v node_modules` | bare `process.env`, `!env` og `.env.example` |
| Ingen modellnavn | `git log origin/main..HEAD --format=%B | grep -i "claude\|gpt\|sonnet\|opus"` | tomt |
| Avhengigheter | `git diff main.. -- package.json` | bare `@powersync/web`, `@powersync/react`, `@journeyapps/wa-sqlite`, `yjs` (og `jose` hvis den må løftes til direkte avhengighet); `pnpm licenses list` viser Apache-2.0/MIT for dem |
| Testkrok aldri i `.env.example` | `grep NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS .env.example` | tomt |
| Dokumenter | `docs/drift/powersync.md` finnes med Mac- og Azure-del; «Teknisk som utvikleren fyller inn» i resultatfilen er fylt, også «det som ikke virket» | lest |

## 8. Krav til koden som testene bygger på (til utvikler)

1. **Rene filer uten DOM og uten `@powersync/web`:** `text-merge.ts`, `foreign-change.ts`, `sync/answer-rows.ts`, `sync/photo-upload.ts`, `sync/device.ts` (tar `Storage` som valgfritt argument, standard `globalThis.localStorage`), `sync/types.ts`, `server/change-schema.ts`. Vitest har ingen DOM og skal kunne importere dem.
2. **Feilklasser med faste navn** i `server/errors.ts`: `InvalidTrialChangeError` (400), `TrialIdConflictError` (409), `TrialPhotoNotFoundError` (404), `TrialPhotoTooLargeError` (413). Rutene oversetter; testene sjekker `instanceof`.
3. **Miljøvariabler leses ved kall**, ikke ved modul-last (`POWERSYNC_JWT_SECRET`, `POWERSYNC_URL`, `TRIAL_UPLOAD_DIR`, `TRIAL_PHOTO_MAX_BYTES`), så `vi.stubEnv` virker.
4. **Hele bunten avvises** ved første ugyldige operasjon (transaksjon), ingen halvskrevne bunter.
5. **Indikatoren** har `data-testid="sync-indicator"` og nøyaktig tekstene fra pkt. 9. «Endret av en annen» ligger i et element med `role="status"` **inne i** `[data-field="<key>"]`.
6. **Testkroken** `window.__offlineTrial = { db, deviceId, organizationId }` når `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`. `db.execute(sql, params)` må kunne brukes fra `page.evaluate`. Visningen må reagere på rader skrevet rett i databasen (det er slik synk kommer inn).
7. **Listen:** overskrift `<h1>Testskjema</h1>`, knapp med nøyaktig tekst «Nytt testskjema» (`<button>`), hvert skjema en `<a>` med navnet som tekst. Nytt skjema navigerer til `/prove/testskjema/<uuid>`.
8. **Alle inputs: lokal kladd mens feltet har fokus, verdi fra `answers` ellers** (pkt. 20). E2e `fill()` må være stabil når `useQuery` leverer asynkront.
9. **IndexedDB for bildefiler** heter `offline-trial-photos`, med ett objektlager der nøkkelen er `photo.id`, så e2e kan telle nøkler.
10. **Service worker** legger aldri `/api/*`, `/logg-inn*` eller `/dev/*` i hurtiglageret.
11. `trial-form-view.tsx` beholder `data-field`, `<label htmlFor>`, `<fieldset><legend>` og `aria-pressed` fra oppgave 3; dagens e2e skal gå grønn med bare endringen i `openTrialForm`.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| Nytt skjema fra listen, 40 felt i `pc` og `ipad`, «40 av 40» | 6.1 (tilpasset `openTrialForm`), 6.2 «listen viser …» |
| Svarene overlever `reload` uten server | 6.2 «svarene overlever …» |
| Uten nett: åpner fra hurtiglager, indikator «Uten nett», venter-regex | 6.2 «indikatoren viser …», «skjemaet åpner fra hurtiglageret …», 7 (sw.js) |
| Bilde ligger lokalt til sha256 er bekreftet; `shouldReleaseLocalPhoto` | 2.4, 6.2 «bildet blir liggende …», «bildet beholdes … feil sha256» |
| `parseTrialNumber` streng; e2e `floors = 7` utenfra og «12,» | 2.5, 6.1 «tall med komma på slutten …», 6.2 «tall satt utenfra …» |
| `text-merge.ts` testsaker | 2.1 |
| `detectForeignChanges` + e2e «Endret av en annen» | 2.2, 6.2 tre varsel-tester og «første lasting …» |
| `rowsToAnswers` | 2.3 |
| `applyTrialChanges` (alle kulepunkter) | 3.2 |
| `issueSyncToken` + e2e 401/403 | 3.3, 6.2 «uinnlogget gir 401 …», «fremmed organisasjon gir 403 …», «token-ruten …» |
| `storeTrialPhoto` | 3.4, 6.2 «bilder-ruten …» |
| `expectTenantIsolation` for `listTrialForms` og `listTrialAnswers`; roller; deaktivert; admin | 3.1–3.4 |
| Migrering og `pg_publication_tables` | 3.5 |
| `config.yaml`/`sync-rules.yaml`, `docker compose config`, `start.sh` | 2.9, 7 |
| `docs/drift/powersync.md` og teknisk avsnitt i resultatfilen | 7 (lest av test-leder) |
| format, lint, typecheck, test, e2e grønne, `ipad` kjørte alt | 10 |
| Virker på iPad-størrelse | `ipad`-prosjektet i 6.1 og 6.2 |
| Ingen modellnavn i commits | 7 |

Ikke testbart av KI, står i protokollen for Ståle: lagringstype i Safari (OPFS/IndexedDB), flere faner, synk mot ekte tjeneste, 200 bilder, omstart av iPad, to iPader samtidig.

## 10. Slik godkjenner test-leder

Kjører i denne rekkefølgen og stopper ved første røde:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e
bash -n start.sh && EZPROP_SKIP_DOCKER=1 ./start.sh
docker compose config -q
```

Godkjennes bare når alt dette stemmer:

- Alle kommandoer grønne. Playwright-listen viser hver e2e-test under både `[pc]` og `[ipad]` der planen sier det; `test.fixme` godtas **bare** for de to testene planen åpner for (tekstfletting via synk og tømming ved organisasjonsbytte), og bare når utsettelsen står i PR-en og i resultatfilen.
- Alle tester merket **Obligatorisk** i avsnitt 3 finnes med navnet fra planen og er grønne. Mangler én, avvises PR-en uten unntak (tilgang og tenant-isolasjon).
- `expectTenantIsolation` kalles nøyaktig for `listTrialForms` og `listTrialAnswers` (`grep -rn expectTenantIsolation src/modules/offline-trial`).
- Utfyllingstesten når «40 av 40» i begge prosjekter.
- `resetDatabase` har de tre `trial_*`-tabellene først i listen.
- Ingen `.test.tsx` (Vitest plukker dem ikke opp).
- Avsnitt 7 er gått gjennom; det som ikke kunne kjøres (f.eks. Docker-daemon), står som «ikke kjørt» i testrapporten, ikke som grønt.
- Testrapporten lister funn som «alvorlig» (tilgang, tenant, tap av data, bilde slippes før bekreftelse) eller «lite» (tekst, rekkefølge, ytelse).

## 11. Tillegg etter runde 1, andre kjøring (test-leder, 28.10.2026)

Forhåndsvurderingen ble kjørt på nytt med den snevrere rammen (kortets merknad nederst). Akseptkriteriene er testbare uten PowerSync-tjenesten, med disse rettelsene. Punktene merket **(kort)** må prosjektleder ta inn i kortet; resten gjelder testskriver og utvikler direkte.

### 11.1 Rettelser i kortet (kort)

1. **Bilde-telleren `M` kan aldri bli 0 i e2e slik pkt. 9 definerer den.** Pkt. 3 sier at `uploaded_at` aldri skrives lokalt, og pkt. 9 teller `trial_photos`-rader uten `uploaded_at`. Uten synktjenesten kommer serverens `uploaded_at` aldri ned til enheten, så akseptkriteriet «etter bekreftelse viser indikatoren 0 bilder» blir rødt i CI. **Ny definisjon:** `M` = antall filer som ligger igjen i IndexedDB `offline-trial-photos` på denne enheten (filen slettes først når serveren har bekreftet sha256, pkt. 22). Det er også det takstmannen mener med «venter»: filer som ikke er sendt fra denne iPaden. Testen 6.2 «bildet blir liggende lokalt …» mister påstanden «raden i lokal database har `uploaded_at`»; den kan ikke holde uten tjenesten.
2. **`var/` i `.gitignore`:** kortet sier `var/uploads/trial` er i `.gitignore`, men `var/` finnes ikke der i dag. Legges til i PR-en; sjekk i avsnitt 7: `git check-ignore -q var/uploads/trial/x && echo ok`.
3. **Service worker må ikke svare for API-kall.** Playwright fanger ikke kall som gjøres fra service workerens `fetch()`. Kaller `public/sw.js` `event.respondWith(fetch(event.request))` for `/api/*`, virker ingen av `page.route`-testene i 6.2 (bilde avbrutt, feil sha256, holdt synkkø). Krav (nytt pkt. 12 i avsnitt 8): for `/api/*`, `/logg-inn*` og `/dev/*` returnerer `fetch`-lytteren **uten** `respondWith`, så nettleseren håndterer kallet selv. Reserve hvis det ikke lar seg gjøre: `test.use({ serviceWorkers: "block" })` i en egen `describe` for `page.route`-testene, med begrunnelse i testfilen.
4. **`start.sh` kan ikke kjøres rett fram:** den ender i `exec pnpm dev` og stopper det som lytter på port 3000. Sjekken i avsnitt 7 blir: `bash -n start.sh`, `test "$(grep -c '^steg "' start.sh)" = "$(sed -n 's/^TOTALT=//p' start.sh)"` (antall steg stemmer med `TOTALT`), `grep -n EZPROP_SKIP_DOCKER start.sh` viser at både Docker-steget og PowerSync-ventingen hoppes over, og kjøring bare når port 3000 er ledig: `EZPROP_SKIP_DOCKER=1 EZPROP_NO_BROWSER=1 timeout 90 ./start.sh`, der alle steg til og med «Starter» vises med PowerSync-adressen i oppsummeringen, og avslutningskode 124 (timeout) godtas.

### 11.2 Hvis forenkler kutter i runde 2 (tester som faller bort, og hva som kommer i stedet)

Tilgangs- og tenant-testene (alle merket **Obligatorisk**) er aldri betinget.

| Kuttes | Faller bort | Kommer i stedet |
|---|---|---|
| Yjs/tekstfletting (pkt. 17–18) | Hele 2.1. I 3.2: «to enheters text_state … flettes på serveren …» og «ugyldig text_state gir InvalidTrialChangeError». I 6.2: «tekst skrevet i feltet lagres med text_state …» (ikke `fixme`, fjernes). Avsnitt 7: `yjs` skal da **ikke** stå i `git diff main.. -- package.json`. | 3.2 ny: «tekstfelt følger siste endring vinner, og innkommende text_state lagres ikke» (to PUT på `roof_description` med ulik `value` → siste `value`, `text_state` er `null` i databasen; serveren tar aldri vare på en tilstand den ikke kan flette). 2.8 ny: «text_state godtas som null eller streng» (Zod-skjemaet avviser ikke feltet, så en eldre klient ikke får 400). |
| Bildekø (pkt. 22) | 2.4. I 6.2: «bildet blir liggende lokalt …», «bildet beholdes … feil sha256», og bildedelen av «indikatoren bøyer entall og flertall …» (bare «1 endring»/«2 endringer» testes). | 6.2 ny: «et valgt bilde gir en trial_photos-rad i lokal database uten fil» (velg bilde → `page.evaluate` leser raden med `name` og `size_bytes`; ingen IndexedDB-fil). Det er beviset for «bildepostene kommer fram» i PR-teksten. 3.4 beholdes uendret: ruten `PUT /api/prove/bilder/[id]` er server-kode uten klient og testes likevel. |
| Varselet «Endret av en annen» (pkt. 19), hvis merknaden «siste endring vinner uten varsel» leses slik | 2.2. I 6.2: «TG og valg satt utenfra viser Endret av en annen …», «tekstfelt satt utenfra gir ikke varsel …», «første lasting … gir ingen varsler». | 6.2 «tall satt utenfra via testkroken …» beholdes, men uten påstanden om varselet: `floors = 7` fra kroken → feltet viser «7». Den viser at `NumberInput` leser fra `answers` (kjent svakhet fra oppgave 3) og er ikke betinget. |

Forenklers avgjørelse skrives inn øverst i denne planen med dato, så testskriver vet hvilken kolonne som gjelder.

### 11.3 Presiseringer til avsnitt 2, 3, 6 og 7

- **2.9 leser filene med regex, ikke YAML-parser.** Det finnes ingen `yaml`-pakke i treet, og `config.yaml` bruker `!env`-merker som en vanlig parser ikke kjenner. «Hvis» i 2.9 strykes.
- **`docker compose config -q` kjøres alltid.** Compose v5.6.1 finnes i skyen (bare CLI, ingen daemon trengs for `config`). Avsnitt 7 er rettet; «ikke kjørt» i avsnitt 10 gjelder bare det som trenger daemon (selve tjenesten).
- **3.2 ny sak: «fremmed id i en annen tabell gir også 409».** Kortet sier «i noen av de tre tabellene». B har et `trial_forms` med id X; A sender `trial_answers` med id X → `TrialIdConflictError`, ingen skriving. Merkes **Obligatorisk** (det er tenant-vokteren).
- **3.2/3.4 ny sak: «synk av trial_photos-raden etter opplasting sletter ikke sha256 og uploaded_at».** Rekkefølgen i prøven er: ruten lager raden og setter serverfeltene, deretter kommer PowerSync-bunten med samme id (uten disse feltene). PUT via `applyTrialChanges` etterpå → `sha256`, `storage_path`, `uploaded_at` står. Viser «ingenting går tapt» for den vanlige rekkefølgen. Alvorlig hvis rød.
- **6.2 «indikatoren bøyer entall og flertall riktig»:** ingen `pendingOverride`-krok. SDK-en laster ikke opp endringer uten å være koblet til tjenesten, så uten tjeneste er køen deterministisk: én endring gir «Venter: 1 endring, …», to gir «2 endringer». Mindre testkode i produktet.
- **Premiss for 6.2:** Playwright gir ny nettleserkontekst per test, så den lokale databasen er tom ved hver test, og uten tjenesten kommer ingenting ned fra serveren. Listen starter alltid tom («Testskjema 1» er deterministisk), og svar fra én test finnes ikke i den neste. Testskriver skal ikke forvente det motsatte.
- **Testkroken er bygg-tid:** `NEXT_PUBLIC_*` bakes inn ved `next build`. `webServer.env` i `playwright.config.ts` treffer `pnpm build`, så det holder; men med `reuseExistingServer` lokalt må serveren på port 3100 være bygget med kroken, ellers feiler krok-testene med en uforståelig feil. Testskriver legger en tydelig `expect(window.__offlineTrial).toBeDefined()`-sjekk med melding «Bygg appen med NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1» først i de testene.
- **Avsnitt 8, nytt pkt. 12:** service worker svarer aldri (`respondWith`) for `/api/*`, `/logg-inn*` og `/dev/*` (se 11.1 nr. 3). Nytt pkt. 13: `M` i indikatoren regnes fra IndexedDB-filene (se 11.1 nr. 1).
- **Til prosjektleder:** arkitektens presiseringer i `src/modules/offline-trial/server/types.ts` (transaksjon og rekkefølge, `isUuid` i Zod, `row_version` bare ved faktisk endring) ligger **ukommittert** på branchen. Planens 3.2 («samme bunt to ganger … øker ikke row_version», «hele bunten avvises») bygger på dem; de må committes før testskriver starter.
