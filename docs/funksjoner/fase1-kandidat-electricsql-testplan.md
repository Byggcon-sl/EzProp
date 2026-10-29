# Testplan: Andre kandidat for drift uten nett – ElectricSQL koblet til testskjemaet

- **Oppgavekort:** `docs/funksjoner/fase1-kandidat-electricsql.md` (pkt.-numrene under viser til kortet; «avgjørelse A–G» viser til «Avgjørelser etter runde 1», som gjelder foran kortet)
- **Fase:** 1 – Prøve uten nett, punktet «Kandidater satt opp mot samme testskjema», andre kandidat
- **Branch:** `fase1-kandidat-electricsql` (bygger på `fase1-kandidat-powersync`, PR #8)
- **Dato:** 28.10.2026
- **Laget av:** test-leder, før koding. Testnavnene og filnavnene er bindende for testskriver. Utvikler leser avsnitt 8 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad; testene viser at svar overlever lukking og uten nett også med kandidat 2, så valget av synkløsning blir et valg og ikke et første forsøk) og reklamasjoner (ingenting går tapt: endringskøen slipper en bunt bare når serveren svarte 200, bilder slippes bare etter bekreftet sha256, nedlastede rader legges aldri over usendte endringer). KI først: ikke KI her, men synklaget testene vokter, er der KI-forslag senere skal vises og godkjennes på iPaden.

Selve prøvene A og B på ekte iPad er **ikke** del av denne planen. De kjøres av Ståle etter protokollen i `docs/funksjoner/fase1-prove-ab-electricsql.md`. Planen dekker alt KI kan vise i Vitest og Playwright (Chromium) **uten Electric-tjenesten** (skyen har ikke Docker, pkt. 14). Proxy-ruten testes med en innsatt `fetchImpl`.

Planen gjentar ikke testene fra `fase1-kandidat-powersync-testplan.md`. Alle de skal fortsatt være grønne (avsnitt 6.0).

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`, `tests/offline-trial.ts` (`setupOrganization`, `createDeactivatedEmployee`, `ALL_ROLES`, `putTrialForm`, `answerOp`, `photoOp`): brukes uendret. Ingen nye fabrikker.
- `tests/tenant-isolation.ts`: `expectTenantIsolation({ seed, query, idOf })`. Brukes for `buildTrialShapeRequest` (avsnitt 3.1). Merk: `query` må returnere **rader**; for en funksjon som bygger en URL, returnerer `query` `[{ id: params[1] fra URL-en }]`, og `seed` gir `{ a: [grantA.organizationId], b: [grantB.organizationId] }`. Da viser steg 1–2 at `where` alltid har egen organisasjon, og steg 3–4 at fremmed organisasjon gir `AccessDeniedError`.
- `src/modules/offline-trial/server/trial-queries.test.ts`: mønsteret `actorFor(grant)` for å finne innloggingen bak en grant. Gjenbrukes.
- `src/modules/offline-trial/server/sync-token.test.ts`: mønster for `vi.stubEnv` og «utviklingsverdien fra `.env.example` nektes utenfor localhost». Gjentas for `ELECTRIC_SECRET`.
- `tests/powersync/config.test.ts`: tekst-/YAML-hjelperne `block`, `contentLines`, `envExampleValue`. Flyttes til `tests/compose-text.ts` (ren hjelpefil, ingen test) så `tests/electricsql/config.test.ts` kan bruke dem uten kopi.
- `src/db/offline-trial-schema.test.ts`: utvides med migrering 0002 (avsnitt 3.3).
- `e2e/helpers.ts`: `logIn`, `createTrialForm`, `indicator`, `queryLocal`, `setAnswerViaHook`, `hookValue`, `localPhotoFileCount`. **Utvides**, ikke endres (avsnitt 6).
- `e2e/fase-1-powersync.spec.ts` og `e2e/fase-1-testskjema.spec.ts`: dagens tester beholdes med samme navn. PowerSync-kroken beholder `db` og `pendingOverride` (avgjørelse A), så ingen av dem skrives om. Én ny delt test i `fase-1-testskjema.spec.ts` (avsnitt 6.1).
- `playwright.config.ts` og `ci.yml`: `webServer.env` får `ELECTRIC_URL=http://localhost:3010` og `ELECTRIC_SECRET` (testverdi, minst 32 tegn, ikke utviklingsverdien fra `.env.example`). Ingen Electric kjører i e2e; proxy-ruten gir 502 der, og det er med vilje (avsnitt 6.2).
- `vitest.config.ts`: tar bare `src/**/*.test.ts` og `tests/**/*.test.ts`. Ingen DOM, ingen `fake-indexeddb` (pkt. 4). Derfor testes IndexedDB-lageret og selve `store.ts` bare i e2e; de rene delene (kø, innfletting, meldingstolking) i Vitest (avsnitt 2).

## 2. Enhetstester (Vitest, rene, ingen database, ingen DOM)

Filnavnene her er de som avgjørelse D ber test-leder sette. Ingen av filene importerer `window`, `indexedDB`, React eller `@electric-sql/*`. Testen i 2.5 håndhever det.

### 2.1 `src/modules/offline-trial/sync/electricsql/outbox.test.ts` (endringskøens tilstandsmaskin, avgjørelse D)

Ren fil `sync/electricsql/outbox.ts`: `createOutbox(entries?)` med `enqueue(op)`, `takeBatch(max)`, `ackBatch(batch)`, `keepBatch(batch)`, `size()`, `entries()` over `{ seq, op }`, der `op` er `TrialChangeOperation` (`PUT`/`PATCH`, tabell, id, `data`). Tilstanden er et vanlig objekt/array, så lageret kan skrive den til `outbox` i IndexedDB.

| Testnavn | Viser |
|---|---|
| «enqueue gir stigende seq og takeBatch gir operasjonene i seq-rekkefølge» | Tre `enqueue` (skjema, svar, bilde) → `takeBatch(500)` gir tre i rekkefølge, `seq` 1, 2, 3. |
| «enqueue på samme (tabell, id) slår sammen og beholder opprinnelig seq» | `PUT trial_answers id X value 1` (seq 1), `PUT trial_forms` (seq 2), `PUT trial_answers id X value 2` → to oppføringer; svaret har `seq` 1 og `value` 2. Skjemaet (seq 2) kommer etter. **Koalescering uten omsortering.** |
| «PATCH etter PUT på samme rad slås sammen til én PUT med alle kolonner» | `PUT` med full rad, `PATCH { value }` → én `PUT` med ny `value` og de andre kolonnene beholdt. Serveren krever full rad for upsert på ny rad. |
| «skjemaet sendes alltid før svarene som peker på det» | `enqueue` svar først (feil rekkefølge fra UI er umulig, men køen skal tåle det) og så skjema → `takeBatch` gir skjemaet først. Hvis utvikler velger ren seq-rekkefølge og garanterer at `createForm` alltid enqueue-er først, erstattes testen av «createForm legger skjemaet i køen før første svar» i 6.2 og det står i PR-en. |
| «takeBatch gir høyst max operasjoner og tar aldri ut av køen» | 600 oppføringer, `takeBatch(500)` → 500; `size()` fortsatt 600; to `takeBatch` på rad gir samme bunt (ingen skjult «under sending»-tilstand som kan gå tapt ved omlasting). |
| «ackBatch fjerner bare operasjonene i bunten» | Bunt på 2 av 3 → `size()` 1, den gjenværende har sin `seq`. |
| «ackBatch etter en ny enqueue på samme nøkkel fjerner ikke den nye endringen» | Bunt tatt ut med svar X (`value` 1). Før `ack`: `enqueue` X (`value` 2). `ackBatch(bunt)` → X ligger igjen med `value` 2 og **ny** seq. Ingen stille tap av det brukeren skrev mens bunten var underveis. **Obligatorisk (tap av data).** |
| «keepBatch endrer ingenting» | `keepBatch(bunt)` → `entries()` lik før; `size()` lik. |
| «ackBatch kalles bare ved 200: hjelperen shouldAckBatch» | `shouldAckBatch(status)`: 200 → `true`; 201, 204, 400, 401, 403, 409, 429, 500, 502, `undefined` (nettverksfeil) → `false`. Samme regel som PowerSync-koblingen (pkt. 5). |
| «tom kø gir tom bunt og ingen feil» | `takeBatch` på tom kø → `[]`; `ackBatch([])` ok. |
| «må-hente-på-nytt rører aldri køen» | Hjelperen `onMustRefetch(state)` (eller tilsvarende i lageret) nullstiller `shape_state` og synkede rader for tabellen, men `outbox` er identisk før og etter. Hvis denne logikken ligger i `apply-incoming.ts`, flyttes testen dit med samme navn. **Obligatorisk (tap av data).** |
| «tilstanden tåler JSON-rundtur» | `JSON.parse(JSON.stringify(entries()))` gir samme kø (slik den lagres i IndexedDB). |
| «ventetiden ved feil dobles fra 5 s til høyst 60 s og nullstilles ved 200» | `nextRetryDelayMs(previous)`: `undefined → 5000`, `5000 → 10000`, … `→ 60000`, `60000 → 60000`; etter `ack` er den `undefined` igjen. (Samme funksjon brukes av shape-henting.) |

### 2.2 `src/modules/offline-trial/sync/electricsql/apply-incoming.test.ts` (innfletting, avgjørelse D)

Ren fil `sync/electricsql/apply-incoming.ts`: `applyIncoming(localRows, incomingRows, pendingKeys)` for én tabell, der rader er snake_case som i de lokale lagrene, `pendingKeys` er nøklene (`id`, for `trial_answers` `trial_form_id + field_key`) som har usendte endringer i køen, og resultatet er `{ rows, overwrittenPending: [] }` (eller tilsvarende; `overwrittenPending` skal alltid være tom).

| Testnavn | Viser |
|---|---|
| «ny rad fra serveren legges til» | Tom lokal, én innkommende → én rad. |
| «oppdatering fra serveren patcher bare kolonnene som kom» | Lokal rad med `value`, `text_state`, `device_id`; innkommende update med bare `value` → `text_state` og `device_id` beholdt (standard `replica`, avgjørelse B). |
| «nedlastet rad legges aldri over en usendt lokal endring» | Lokal `floors = 7` med nøkkel i `pendingKeys`; innkommende `floors = 3` → lokal viser fortsatt 7. **Obligatorisk (tap av data).** |
| «usendt tekstendring og innkommende text_state flettes med mergeTextStates» | Lokal `roof_description` med `text_state` a («Taket er tett.») i `pendingKeys`; innkommende `text_state` b («Merk: » foran, fra felles start) → resultatets `text_state` er `merge(a, b)` (`textOf` inneholder begge bidrag), `value` er den flettede teksten. **Obligatorisk.** |
| «innkommende text_state uten usendt lokal endring flettes også» | Ikke i `pendingKeys`: resultatet er `merge(lokal, innkommende)`, aldri bare innkommende (to enheter, ingen av dem mister tekst). |
| «text_state lages aldri fra en gammel value» | Innkommende rad med `value` men `text_state: null` på et tekstfelt der lokal har `text_state` → lokal `text_state` beholdes, `value` patches ikke til noe som strider mot tilstanden (utvikler velger: beholde lokal `value` fra `textOf(text_state)`). Dokumenteres i testen. |
| «delete-melding fjerner raden lokalt (myk slettet på serveren)» | Innkommende `delete` → raden borte fra `rows`. Serveren beholder den (regel 3); lokalt er den ikke lenger i shapen. |
| «rad med deleted_at satt filtreres bort» | Innkommende insert med `deleted_at` → ikke med. |
| «trial_answers nøkles på (trial_form_id, field_key), ikke på id» | Lokal rad id T, innkommende id S for samme skjema/felt → én rad, id S (serverens id vinner, som på serveren). |
| «bekreftet overlegg beholdes til neste melding for samme nøkkel» | Etter `ack`: nøkkelen er i `confirmedKeys` med verdien som ble sendt; innkommende eldre update for nøkkelen (`updated_at` eldre enn det sendte) → bekreftet verdi vises fortsatt; innkommende nyere → bekreftet overlegg fjernes. Svakheten (eldre melding underveis uten tidsstempel) står i resultatfilen; testen dekker bare det vi lover. |
| «ugyldig text_state i innkommende rad gir behold av lokal, ikke krasj» | `text_state: "ikke base64!!"` → lokal rad uendret, ingen exception. |

### 2.3 `src/modules/offline-trial/sync/electricsql/shape-messages.test.ts` (tolking av Electric-meldinger, avgjørelse D)

Ren fil `sync/electricsql/shape-messages.ts`: `parseShapeMessages(json: unknown): ShapeMessage[]` og `readShapeHeaders(headers: Headers | Record<string,string>)` → `{ handle, offset, cursor, upToDate }`.

| Testnavn | Viser |
|---|---|
| «insert, update og delete tolkes med key, value og operation» | Tre meldinger `{ key, value, headers: { operation } }` → tre `ShapeMessage` med `operation` og `row` (value). |
| «up-to-date-kontrollmelding gir upToDate» | `{ headers: { control: "up-to-date" } }` → `upToDate: true`, ingen rad. |
| «must-refetch-kontrollmelding gir mustRefetch» | `{ headers: { control: "must-refetch" } }` → `mustRefetch: true`. |
| «ukjent kontrollmelding og ukjent operasjon ignoreres uten krasj» | `control: "noe-nytt"`, `operation: "upsert"` → hoppes over, resten tolkes. |
| «kropp som ikke er en liste gir tom liste» | `null`, `{}`, `"tekst"` → `[]`. |
| «electric-handle, electric-offset, electric-cursor og electric-up-to-date leses fra hodene» | Alle fire satt → verdiene; `electric-up-to-date` manglende → `upToDate: false`. |
| «ETag, Age og Cache-Control i hodene brukes aldri» | Hoder med `etag`, `age`, `cache-control: public` → ikke i resultatet (funksjonen har ikke feltene). |
| «value konverteres til de lokale kolonnetypene» | `size_bytes: "120"` (tekst fra Electric) → tall; `value` jsonb → JSON-tekst (som i den lokale raden); tidsstempler → ISO-tekst; `deleted_at: null` beholdes. |

### 2.4 `src/modules/offline-trial/sync/select-store.test.ts` (valg av kandidat, pkt. 7)

`readSyncCandidate(storage?)` og `writeSyncCandidate(candidate, storage?)` tar `Storage` som valgfritt argument (som `getTrialDeviceId`). `openTrialStore` (dynamisk `import()`) testes ikke i Vitest.

| Testnavn | Viser |
|---|---|
| «standard er powersync når ingenting er lagret» | Tom `Map`-storage → `"powersync"`. |
| «lagret electricsql leses tilbake» | Nøkkel `trial_sync_candidate` = `"electricsql"` → `"electricsql"`. |
| «ukjent verdi gir powersync, ikke krasj» | `"pglite"`, `""`, `"ELECTRICSQL"` → `"powersync"`. |
| «writeSyncCandidate skriver nøkkelen trial_sync_candidate» | Etter kall: `storage.get("trial_sync_candidate") === "electricsql"`. |
| «nøkkelen er trial_sync_candidate og verdiene bare powersync og electricsql» | Eksporterte konstanter `TRIAL_SYNC_CANDIDATE_KEY` og `TRIAL_SYNC_CANDIDATES` er nøyaktig disse. |

### 2.5 `src/modules/offline-trial/sync/candidate-boundaries.test.ts` (kandidatuavhengige sider, pkt. 2 og avgjørelse E)

Leser filene som tekst med `node:fs`. Ingen ESLint-regel.

| Testnavn | Viser |
|---|---|
| «sidene under prove/testskjema importerer ikke fra noen kandidat» | Alle `.ts`/`.tsx` under `src/app/(ansatt)/prove/testskjema/` (rekursivt) har ingen `import`/`from`-linje som matcher `@powersync/`, `@electric-sql/`, `sync/powersync/` eller `sync/electricsql/`. **Obligatorisk (rettferdig «Arbeid»).** |
| «photo-uploader.ts importerer ikke fra noen kandidat» | Samme for `sync/photo-uploader.ts`. |
| «sync-indicator.tsx importerer ikke fra noen kandidat» | Samme for `sync-indicator.tsx` (måleindikatoren lytter bare på `onStatusChange`). |
| «de rene filene i sync/electricsql importerer ikke window, React eller @electric-sql» | `outbox.ts`, `apply-incoming.ts`, `shape-messages.ts`: ingen `from "react"`, `@electric-sql/`, og ingen forekomst av `window.`, `indexedDB`, `document.`, `navigator.`. |
| «select-store.ts laster kandidaten med dynamisk import» | `sync/select-store.ts` har ingen statisk `import … from` som matcher `sync/powersync/` eller `sync/electricsql/`; har `import(` for begge. |
| «types.ts har ikke getAnswers» | `sync/types.ts` inneholder ikke `getAnswers`; inneholder `flush`, `close`, `subscribeForms`, `onStatusChange`, `listPendingPhotos`, `markPhotoUploaded` og `TrialSyncTestable` (avgjørelse A). |
| «alle filer i sync/electricsql har hodekommentaren» | Hver `.ts` i `sync/electricsql/` (ikke `.test.ts`) begynner med en kommentar som inneholder «Prøve fase 1, kastes eller gjøres om etter ADR». Også `server/electric-shape.ts` og `sync/select-store.ts`. |

### 2.6 `src/modules/offline-trial/sync/powersync/store-text.test.ts` (uendret)

Dagens fire tester for `nextTextState` beholdes. Electric-lageret skal bruke **samme** `nextTextState` (flyttes til `sync/text-state.ts` hvis utvikler vil dele den; testen følger filen, navnet beholdes). Ingen ny flettekode (pkt. 6).

### 2.7 `tests/electricsql/config.test.ts` (Docker og miljø, pkt. 11–12, avgjørelse F)

| Testnavn | Viser |
|---|---|
| «docker-compose binder Electric bare til 127.0.0.1, ikke port 3000, med fast versjonstag» | `services.electric.ports` alle begynner med `127.0.0.1:`, vertsporten er ikke `3000`; `image` begynner med `electricsql/electric:` og slutter ikke på `:latest`, taggen matcher `/^\d+\.\d+\.\d+/`. |
| «Electric venter på databasen, har eget volum og sender ikke bruksdata» | `depends_on.db.condition === "service_healthy"`; `volumes` har minst én linje som ikke er en `./`-montering (navngitt volum) og volumet står under toppnivå `volumes:`; `environment` har `ELECTRIC_USAGE_REPORTING: "false"` (eller `=false`); `ELECTRIC_SECRET` leses fra miljøet (`${ELECTRIC_SECRET…}`), aldri som fast verdi. |
| «Electric-tjenesten har ingen tilkoblingsstreng med passord i filen» | Ingen linje i `docker-compose.yml` matcher `postgres(ql)?:\/\/\w+:\w+@` **utenfor** `${…:-…}`-standardverdier som allerede finnes for PowerSync (bare `db`-vertsnavnet, aldri en ekstern vert). Samme regel som 2.9 i PowerSync-planen. |
| «.env.example har ELECTRIC_URL og ELECTRIC_SECRET med forklaring, aldri NEXT_PUBLIC_» | Begge nøkler finnes, kommentarlinje over hver, `ELECTRIC_SECRET` minst 32 tegn, ingen linje begynner med `NEXT_PUBLIC_ELECTRIC`; `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS` finnes ikke. |
| «ci.yml og playwright.config.ts har ELECTRIC_URL og ELECTRIC_SECRET, og hemmeligheten er ikke utviklingsverdien» | Begge filer inneholder begge nøkler; verdien for `ELECTRIC_SECRET` er ulik `envExampleValue("ELECTRIC_SECRET")`. |
| «start.sh har steget for ElectricSQL og TOTALT stemmer» | Teksten inneholder `steg "Starter synktjenesten (ElectricSQL)"`; `TOTALT=<n>` er lik antall `^steg "`-linjer; steget står etter PowerSync-steget; `EZPROP_SKIP_DOCKER` nevnes i steget; `ELECTRIC_URL` og `ELECTRIC_SECRET` legges til `.env` for eldre filer. |

## 3. Integrasjonstester mot testdatabasen (Vitest, `beforeEach(resetDatabase)`)

### 3.1 `src/modules/offline-trial/server/electric-shape.test.ts` (pkt. 9–10, avgjørelse B; `buildTrialShapeRequest` og `forwardTrialShape`)

Miljø per test med `vi.stubEnv`: `ELECTRIC_URL=http://electric.test:3000`, `ELECTRIC_SECRET` = 40 tegn testverdi, `BETTER_AUTH_URL=http://localhost:3000`; `afterEach(vi.unstubAllEnvs)`. `clientParams` er `URLSearchParams`. `forwardTrialShape` får en `fetchImpl` som tar opp forespørselen og svarer med det testen sier.

| Testnavn | Viser |
|---|---|
| «buildTrialShapeRequest gir aldri en annen organisasjons utsnitt (expectTenantIsolation)» | `seed: (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] })`; `query: async (actor, orgId) => { const { url } = await buildTrialShapeRequest(actor, orgId, "trial_answers", new URLSearchParams()); return [{ id: url.searchParams.get("params[1]")! }]; }`; `idOf: r => r.id`. **Obligatorisk.** |
| «params[1] er alltid grant.organizationId, aldri fra spørrestrengen» | Klient sender `params[1]=<orgB.id>` og `organization_id=<orgB.id>` → URL-en har `params[1] === grant.organizationId`, ingen `organization_id`-parameter. **Obligatorisk.** |
| «where er fast: organization_id = $1 AND deleted_at IS NULL» | Klient sender `where=1=1` → URL-ens `where` er nøyaktig teksten fra kortet (mellomrom normalisert). Organisasjons-id-en står **ikke** som tekst i `where`. **Obligatorisk.** |
| «table kommer bare fra argumentet, aldri fra klienten» | `table` arg `trial_forms`, klient sender `table=users` → URL `table === "trial_forms"`. |
| «ukjent tabell gir InvalidTrialChangeError uten kall» | `"users"`, `"session"`, `"trial_forms; drop"`, `""` → kaster `InvalidTrialChangeError`; `fetchImpl` er aldri kalt (`forwardTrialShape` med `tabell=users`). |
| «columns er eksplisitt for alle tre tabellene og har aldri storage_path, created_by, updated_by eller deleted_by» | `it.each` over tabellene: `columns` satt, splittet på komma, inneholder `id`, `trial_form_id`/`name` osv. etter tabell, inneholder `deleted_at` og `updated_at`, inneholder ikke de fire. **Obligatorisk (sikkerhet).** |
| «kolonnene i columns finnes i PostgreSQL-skjemaet» | Hver kolonne i `columns` finnes i `getTableColumns()` fra Drizzle for tabellen (som `schema.test.ts` for PowerSync). Fanger stavefeil som gir 400 fra Electric. |
| «secret settes fra ELECTRIC_SECRET og aldri fra klienten» | Klient sender `secret=x&api_secret=y` → URL `secret === process.env.ELECTRIC_SECRET`, ingen `api_secret`. |
| «bare offset, handle, live og cursor kopieres fra klienten» | Klient sender `offset=0_0&handle=abc-1&live=true&cursor=12&replica=full&columns=id&foo=bar` → URL har de fire, og ikke `replica`, `foo`, klientens `columns`. `Array.from(url.searchParams.keys()).sort()` er nøyaktig `["columns","cursor","handle","live","offset","params[1]","secret","table","where"]`. **Obligatorisk.** |
| «ulovlig format på offset, handle, cursor eller live gir InvalidTrialChangeError» | `offset=../x`, `handle=a b`, `cursor=<script>`, `live=yes`, `live=false` (bare `true` er lov) → kaster, ingen kall. `offset=-1` og `offset=26800584_4` er lov. |
| «ELECTRIC_URL med sti beholdes og ender på /v1/shape» | `ELECTRIC_URL=http://electric.test:3000/` og `…/prefix` → `url.pathname` er `/v1/shape` hhv. `/prefix/v1/shape`. |
| «uten ELECTRIC_URL eller ELECTRIC_SECRET kastes tydelig feil uten kall» | Tom → `Error` med nøkkelnavnet i meldingen; `fetchImpl` ikke kalt. |
| «for kort ELECTRIC_SECRET (under 32 byte) kastes feil» | 31 tegn → kaster. |
| «utviklingsverdien for ELECTRIC_SECRET fra .env.example nektes når BETTER_AUTH_URL ikke er localhost» | Les `.env.example`; `BETTER_AUTH_URL=https://test.example.com` → kaster; `http://localhost:3000` → ok. Egen funksjon i `electric-shape.ts`, ikke delt med `sync-token.ts` (avgjørelse F). |
| «alle fire roller får bygge forespørselen, deaktivert ansatt nektes» | `it.each(ALL_ROLES)` → ok; `createDeactivatedEmployee` → `AccessDeniedError`. Admin stenges aldri ute. **Obligatorisk.** |
| «forwardTrialShape videresender 200, 204, 400, 409 og 429 uendret» | `it.each` over statusene: `fetchImpl` svarer med status og kropp `[{"x":1}]` → `Response.status` lik, kroppen lik. |
| «forwardTrialShape svarer alltid Cache-Control: private, no-store og videresender bare content-type og electric-hodene» | Upstream-hoder: `content-type`, `electric-handle`, `electric-offset`, `electric-schema`, `electric-cursor`, `electric-up-to-date`, `etag`, `age`, `expires`, `cache-control: public, max-age=60`, `x-powered-by`. Svaret har de seks første, `cache-control === "private, no-store"`, og **ikke** `etag`, `age`, `expires`, `x-powered-by`. Gjelder også for 204, 400, 409, 429. **Obligatorisk (sikkerhet).** |
| «forwardTrialShape gir 502 med { feil } uten Electrics tekst ved nettverksfeil og tidsavbrudd» | `fetchImpl` kaster `TypeError("fetch failed")` eller `AbortError` → status 502, JSON `{ feil: <norsk tekst> }`, kroppen inneholder ikke «fetch failed», ikke `ELECTRIC_URL`-verten, ikke `ELECTRIC_SECRET`. `fetchImpl` kalt nøyaktig én gang (ingen ny prøving på serveren). |
| «forwardTrialShape sender secret til Electric, men aldri til klienten» | Forespørselen `fetchImpl` fikk har `secret`; ingen av svarets hoder eller kropp (200 og 502) inneholder verdien. Upstream-kroppen ved 400 er `{"message":"ugyldig offset"}`; testen viser bare at proxyen selv ikke legger hemmeligheten til. Om Electric selv gjentar spørrestrengen i egen 400-kropp, er et åpent punkt for sikkerhet-personvern i `/security-review` (kortet sier 400 videresendes uendret). |
| «forwardTrialShape logger bare rute, bruker, tabell og status» | Spion på `console.*`/loggeren: etter ett kall inneholder ingen loggmelding `secret`, `ELECTRIC_SECRET`-verdien, `where` eller `params`. |
| «fremmed organisasjon gir AccessDeniedError uten kall» | Bruker i A mot `orgB.id` → kaster, `fetchImpl` ikke kalt. **Obligatorisk.** |

### 3.2 `src/modules/offline-trial/server/apply-changes.test.ts` (uendret)

Ingen endring i skriveregler (pkt. «Ikke med»). Test-leder sjekker at `git diff fase1-kandidat-powersync.. -- src/modules/offline-trial/server/apply-changes.ts src/modules/offline-trial/server/photo-storage.ts` er tom. Er den ikke tom, stoppes arbeidet (kortet).

### 3.3 `src/db/offline-trial-schema.test.ts` (utvides, migrering 0002, avgjørelse C)

| Testnavn | Viser |
|---|---|
| «publikasjonen electric_publication_default har nøyaktig trial_forms, trial_answers og trial_photos» | `pg_publication_tables WHERE pubname = 'electric_publication_default'` → sortert lik de tre. Aldri `users`, `sessions`, `verifications`, `accounts`, `employees`, `organizations`. **Obligatorisk (sikkerhet).** |
| «publikasjonen electric_publication_default er ikke FOR ALL TABLES» | `puballtables === false`. |
| «de tre trial-tabellene har REPLICA IDENTITY FULL» | `SELECT relname, relreplident FROM pg_class WHERE relname IN (…)` → `relreplident === 'f'` for alle tre. |
| «ingen andre tabeller har fått REPLICA IDENTITY FULL» | Alle andre tabeller i `public` har `relreplident === 'd'`. Migreringen rørte bare prøvetabellene. |
| «publikasjonen powersync er uendret» | Dagens test «publikasjonen powersync har nøyaktig …» er fortsatt grønn (side om side, pkt. 11). |
| «migreringen kjører to ganger uten feil» | Kjøres av `tests/global-setup.ts` (migrerer testdatabasen) pluss en test som kjører SQL-en i `0002_*.sql` på nytt mot testdatabasen; den må være idempotent (`IF NOT EXISTS`/`DROP … IF EXISTS` eller tilsvarende) **eller** testen viser at Drizzle-journalen hindrer dobbeltkjøring (`__drizzle_migrations` har én rad for 0002). Utvikler velger og sier i PR-en. |

### 3.4 `tests/factories.test.ts` (uendret)

Ingen nye tabeller, ingen endring i `resetDatabase`.

## 4. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | 3.1 «alle fire roller får bygge forespørselen, deaktivert ansatt nektes». E2e 6.2: 401 uinnlogget, 403 fremmed organisasjon på `/api/prove/synk/shape`. | Ruten kaller bare `getCurrentActor` og `forwardTrialShape`; `requireOrganizationAccess(actor, organizationId, "organization.read")` ligger i `electric-shape.ts`. Ingen tilgangslogikk i ruten (test-leder leser ruten). |
| Tenant-isolasjon | `expectTenantIsolation` for `buildTrialShapeRequest` (3.1, nytt kall; `grep -rn expectTenantIsolation src/modules/offline-trial` gir nøyaktig tre treff: `listTrialForms`, `listTrialAnswers`, `buildTrialShapeRequest`). `params[1]` alltid `grant.organizationId`; klientens `where`/`params`/`table`/`columns` når aldri Electric (3.1). E2e 6.2: 403. Lokalt: organisasjonsbytte tømmer Electric-lageret (6.2). | Testene merket **Obligatorisk** må finnes og være grønne. Mangler én, avvises PR-en. |
| Admin stenges aldri ute | Admin i `it.each` og i `expectTenantIsolation` (admin i begge organisasjoner). E2e logger inn som admin og gjør alt med begge kandidater. | Ingen ny tilgangslogikk, ingen nye roller (kortet). |
| Myk sletting | `where … deleted_at IS NULL` i shapen (3.1), delete-melding fjerner lokalt men serveren beholder (2.2), `DELETE` fortsatt 400 i skriveruten (uendret fra PR #8). | Regel 3. Ingen skjerm sletter noe. |
| Ingen kundeopplysninger eller hemmeligheter | Oppdiktede data overalt. 3.1: `ELECTRIC_SECRET` aldri i svar eller logg; 2.7: aldri `NEXT_PUBLIC_ELECTRIC`; 6.2: 502-kroppen uten vert og hemmelighet. | Regel 8. |

## 5. Regeltester

Ingen regler eller TG-logikk (prøve E). Flettereglene er kode med testsaker i 2.1–2.3 og i PowerSync-planen 2.1. Test-leder sjekker at `sync/electricsql/` ikke inneholder TG-avledning.

## 6. E2e (Playwright, Chromium, `pc` og `ipad`)

Uten Electric-tjeneste: proxy-ruten svarer 502, lageret prøver shape-henting igjen med økende ventetid, og alt lokalt virker. Køen tømmes likevel mot `POST /api/prove/synk/endringer` (den finnes i e2e), så indikatoren **når** «Alt er lagret på serveren» med ElectricSQL (ulikt PowerSync; står i resultatfilen).

**Nye hjelpere i `e2e/helpers.ts`** (de gamle beholdes uendret):
- `useCandidate(context, candidate)`: `context.addInitScript` som setter `localStorage.trial_sync_candidate` før hver side. Kalles **før** `logIn`.
- `ElectricTrialHook` (utvider den delte kroken): `{ candidate, store, deviceId, organizationId, applySyncedRows(table, rows), readRows(table, formId?), simulateOrganizationChange(id) }`. `waitForTrialHook` venter på `__offlineTrial?.store` i stedet for `.db` (PowerSync har begge, så dagens tester går som før).
- `readRowsViaHook(page, table, formId?)`: `page.evaluate` → `hook.readRows`.
- `applySyncedRowsViaHook(page, table, rows)`: `page.evaluate` → `hook.applySyncedRows` (upsert på `(trial_form_id, field_key)` for `trial_answers`).
- `pendingChanges(page)`: `page.evaluate` → `(await hook.store.status()).pendingChanges`.
- `countRequests(page, urlGlob)`: registrerer `page.on("request")` og gir en teller for kall mot `/api/prove/synk/shape`.

### 6.1 `e2e/fase-1-testskjema.spec.ts` (én ny delt test)

- Utfyllingen i «alle 40 felt fylles ut og telleren viser 40 av 40» trekkes ut i `fillAllFields(page)` (samme fil). Dagens test beholder navnet og kjører med standardkandidaten (PowerSync).
- Ny: «alle 40 felt fylles ut og telleren viser 40 av 40 med ElectricSQL valgt» (pc og ipad): `useCandidate(context, "electricsql")` → `openTrialForm` → `fillAllFields` → «40 av 40 felt utfylt». Akseptkriterium 1. **Obligatorisk** (merkes `test.fixme` bare ved pkt. 16, se avsnitt 10).
- Resten av filen kjører bare med PowerSync (avgjørelse E).

### 6.2 `e2e/fase-1-electricsql.spec.ts` (ny)

Alle tester starter med `useCandidate(context, "electricsql")` og `logIn(page, ADMIN_EMAIL)`, unntatt velger- og organisasjonstestene som sier noe annet. `pcOnly` som i PowerSync-filen.

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «testkroken viser electricsql som kandidat og lageret er klart» | `hookValue(page, "candidate") === "electricsql"`; `readRowsViaHook(page, "trial_forms")` gir en liste; `window.__offlineTrial.db` finnes **ikke**. | pc, ipad |
| «listen viser nye testskjemaer med navn og laget når, og åpner dem (ElectricSQL)» | Som PowerSync-testen: to skjemaer, tidsangivelse, åpning via lenke. Viser `subscribeForms`. | pc, ipad |
| «svarene og et bilde overlever at siden lastes på nytt uten server (ElectricSQL)» | `roof_tg = TG2`, `floors = "7"`, tekst «Oppdiktet tekst», ett bilde. `readRowsViaHook` viser fire rader (`value` og `text_state` for teksten). `page.reload()` → alle fire står, «4 av 40», bildet «1 bilde». Tilbake til listen, åpne igjen → 4. Akseptkriterium 2. | pc, ipad |
| «indikatoren viser Uten nett uten nett, og venter-tekst eller alt lagret med nett (ElectricSQL)» | Med nett: `ANY_STATUS`. `setOffline(true)` → «Uten nett»; skriv `floors = "3"` → fortsatt «Uten nett», teller +1; `setOffline(false)` → matcher `/^Venter: \d+ endring(er)?, 0 bilder$|^Alt er lagret på serveren$/` og **innen 20 s** nøyaktig «Alt er lagret på serveren» (skriveruten finnes). Akseptkriterium 3. | pc, ipad |
| «skjemaet åpner fra hurtiglageret uten nett etter ett besøk (ElectricSQL)» | Som PowerSync-testen, med samme reserve via `caches.match` og annotasjon. Viser at valg (b) ikke trenger service worker-endring. | pc, ipad |
| «endringskøen overlever omlasting og tømmes bare etter 200» | `page.route("**/api/prove/synk/endringer", r => r.fulfill({ status: 500, body: "{}" }))` **før** skjemaet lages. Lag skjema, `floors = "7"`. `pendingChanges(page)` ≥ 2 (skjema + svar) og holder seg ≥ 2 i 6 s. `page.reload()` → `pendingChanges` fortsatt ≥ 2, verdien 7 står. `unroute` → `pendingChanges` → 0 innen 20 s, indikator «Alt er lagret på serveren». Akseptkriterium 8. **Obligatorisk (tap av data).** | pc, ipad |
| «avbrutt sending beholder bunten» | Samme med `route.abort()` i stedet for 500; etter `unroute` tømmes køen. | pc |
| «det som skrives mens en bunt er underveis går ikke tapt» | `page.route` på endringer-ruten som **venter 3 s** før den svarer 200. Skriv `floors = "7"`, vent 500 ms (bunten er sendt), skriv `floors = "8"`. Etter at ruten har svart og køen er tom: `floors` i den lokale raden og på serveren (`page.request.post` av en ny tom bunt er ikke nok; bruk `GET`-fri vei: les `readRowsViaHook` etter neste shape-melding er umulig uten Electric, så testen sjekker at køen hadde en ny oppføring for `floors` med `value` 8 etter første 200, og at den også ble sendt (teller to `POST` med `floors`), siste med `"8"`). Dekker 2.1 «ackBatch etter en ny enqueue …» ende til ende. | pc |
| «shape-henting uten Electric prøves igjen med økende ventetid, høyst ett kall per tabell per 5 s» | `countRequests(page, "**/api/prove/synk/shape*")` fra før `goto`. Etter 12 s: per tabell (les `tabell=` i URL-en) ≤ 3 kall (0 s, 5 s, 10 s), ≥ 2 kall; alle svarte 502. Skriving virker i mellomtiden (`floors = "7"`, teller 1). Akseptkriterium 8. | pc |
| «shape-svar via proxyen legges inn lokalt og vises (simulert med testkroken)» | `applySyncedRowsViaHook(page, "trial_answers", [{ …floors 7, device_id: "annen-enhet" }])` etter egen rad `floors = 5` → feltet viser 7, «Endret av en annen» i `[data-field="floors"]`. Klikk i feltet → borte. Akseptkriterium 6. | pc, ipad |
| «TG og valg satt utenfra viser Endret av en annen, egen endring gjør det ikke (ElectricSQL)» | Som PowerSync-testen via `applySyncedRowsViaHook`; egen `deviceId` gir ikke varsel. | pc, ipad |
| «innkommende text_state flettes med egen tekst» | Skriv «Taket er tett.» i «Tak – beskrivelse», vent 500 ms. `applySyncedRowsViaHook` med en `trial_answers`-rad som har `text_state` laget i testen fra felles tom start med «Merk: » (base64 Yjs; testen lager den med `yjs` i Node, samme kode som `text-merge.ts`, eller `page.evaluate` som kaller en eksportert hjelper på kroken `hook.createTextState(text)`). Feltet viser både «Merk: » og «Taket er tett.». Akseptkriterium 7 ende til ende. | pc |
| «første lasting av et skjema fra en annen enhet gir ingen varsler (ElectricSQL)» | Fem rader via `applySyncedRowsViaHook` før skjemaet åpnes fra listen → «5 av 40», 0 varsler. | pc, ipad |
| «bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder (ElectricSQL)» | `test.use({ serviceWorkers: "block" })`. `route.abort()` på bilder-ruten → «1 bilde», én fil i `offline-trial-photos`. `unroute` → «0 bilder»/«Alt er lagret», fil borte, `readRowsViaHook(page, "trial_photos")` har `uploaded_at` satt, og **`pendingChanges` økte ikke** av `markPhotoUploaded` (skriver bare lokalt, avgjørelse A). | pc, ipad |
| «velgeren Synkløsning: valget overlever omlasting og er tillatt når alt er lagret» | Uten `useCandidate`. `goto /prove/testskjema` → gruppen «Synkløsning» har knappene «PowerSync» (valgt, `aria-pressed="true"`) og «ElectricSQL» (`aria-pressed="false"`, aktiv). Begge ≥ 44 px høye (`test.skip` utenfor `ipad` for høyden). Indikator «Alt er lagret på serveren» (ny kontekst, tom kø). Trykk «ElectricSQL» → siden lastes på nytt (`waitForLoadState`), «ElectricSQL» er valgt, `localStorage.trial_sync_candidate === "electricsql"`. `page.reload()` → fortsatt valgt. Akseptkriterium 4. | pc, ipad |
| «velgeren er sperret med forklaring når noe venter på å bli sendt» | `page.route` endringer-ruten → 500. Nytt skjema, `floors = "7"`. Tilbake til listen → den andre knappen er `disabled`, teksten «Vent til alt er lagret på serveren før du bytter» synlig. `unroute` → innen 20 s er knappen aktiv og teksten borte. Akseptkriterium 4. | pc, ipad |
| «bytte av kandidat sletter ingenting lokalt» | PowerSync: lag skjema, `floors = "7"`, vent til raden er lokal. Sett `localStorage.trial_sync_candidate = "electricsql"` direkte, `reload` → listen er **tom** (eget lager) eller viser bare Electric-skjemaer; lag ett skjema med Electric. Sett nøkkelen tilbake til `powersync`, `reload` → PowerSync-skjemaet står i listen med `floors = 7`. Sett `electricsql` igjen → Electric-skjemaet står. Akseptkriterium 4. **Obligatorisk (tap av data).** | pc |
| «innlogging med annen organisasjon tømmer lokal lagring for begge kandidater» | `test.describe` med `for (const candidate of ["powersync", "electricsql"])`: `useCandidate`, nytt skjema, ett bilde (bilder-ruten avbrutt så filen ligger lokalt), `hook.simulateOrganizationChange(uuid)`, `reload` → `readRowsViaHook("trial_forms")` tom, `localPhotoFileCount` 0, `pendingChanges` 0; for Electric i tillegg: `readRowsViaHook("shape_state")` tom (eller `hook.readRows` støtter `shape_state`/`outbox` som tabellnavn; ellers via `indexedDB` direkte). Akseptkriterium 5. **Obligatorisk (tenant).** | pc |
| «uinnlogget gir 401 på shape-ruten» | `request.get("/api/prove/synk/shape?organisasjon=<uuid>&tabell=trial_forms&offset=-1")` → 401, `cache-control` inneholder `no-store`. | pc |
| «fremmed organisasjon gir 403 på shape-ruten» | Innlogget `page.request` med tilfeldig uuid → 403, kroppen uten `electric`-hoder. | pc |
| «shape-ruten gir 400 for ukjent tabell og ulovlig offset» | `tabell=users` → 400; `tabell=trial_forms&offset=../x` → 400; begge med norsk feilmelding i JSON. | pc |
| «shape-ruten gir 502 uten Electric, med private no-store og uten vert eller hemmelighet i svaret» | Egen organisasjon (`hookValue(page, "organizationId")`), `tabell=trial_forms&offset=-1` → 502, JSON `{ feil }`, `cache-control === "private, no-store"`, ingen `etag`/`age`/`expires`, kroppen inneholder ikke «3010», «localhost:3010» eller `ELECTRIC_SECRET`-verdien fra `playwright.config.ts`. Akseptkriterium 9. | pc |
| «shape-ruten kopierer bare tillatte parametre (ingen Electric: 502 betyr at kallet ble gjort)» | `…&secret=x&where=1=1&params[1]=<uuid>&replica=full` → 502 (ikke 400): parametrene ble ignorert, ikke avvist. Kombinert med 3.1 viser det at de aldri når Electric. | pc |
| «service worker rører ikke shape-ruten» | Etter registrering og ett kall mot shape-ruten: ingen `/api/` i noen cache (som PowerSync-testen, utvidet med shape-URL-en). | pc |

Alle `page.route`-tester bruker `page.unroute` i `finally`. E2e sletter aldri noe i databasen. Testene som bruker `pendingChanges` venter med `expect.poll`.

### 6.3 Dagens e2e (uendret)

`e2e/fase-1-powersync.spec.ts` (19 tester) og `e2e/fase-1-testskjema.spec.ts` (18 tester) kjøres uendret med PowerSync som standardkandidat. Kontraktsryddingen (A) og flyttingen av testkroken til `sync/test-hooks.ts` skal ikke endre ett eneste testnavn. Blir en PowerSync-test rød, er det et funn mot kontraktsryddingen, ikke mot testen.

## 7. Skript, konfigurasjon og dokumentasjon (test-leder kjører for hånd)

| Sjekk | Kommando | Forventet |
|---|---|---|
| `start.sh` er gyldig bash 3.2 | `bash -n start.sh && bash --posix -n start.sh`; `git diff fase1-kandidat-powersync.. -- start.sh` | ingen feil; ingen `mapfile`, `declare -A`, `${var,,}`, `[[ =~ ]]` med grupper nye for bash 4 |
| `start.sh` kjører uten Docker | `EZPROP_SKIP_DOCKER=1 ./start.sh` | går gjennom alle steg, `TOTALT` lik antall steg, skriver Electric-adressen i oppsummeringen, legger `ELECTRIC_URL`/`ELECTRIC_SECRET` til en `.env` som mangler dem |
| compose er gyldig | `docker compose config -q` | ingen feil; «ikke kjørt» hvis CLI mangler |
| Electric og Postgres på Mac | Ståle, etter PR: `./start.sh`, `curl -s http://127.0.0.1:3010/v1/health` | `{"status":"active"}`; test-leder noterer «ikke kjørt i skyen» |
| Ingen `getAnswers` | `grep -rn getAnswers src/` | tomt |
| Ingen kandidatimport i sidene | `grep -rln "@powersync\|@electric-sql\|sync/powersync\|sync/electricsql" "src/app/(ansatt)/prove" src/modules/offline-trial/sync/photo-uploader.ts src/modules/offline-trial/sync-indicator.tsx` | tomt (dobbeltsjekk av 2.5) |
| Hodekommentar | `grep -L "Prøve fase 1" src/modules/offline-trial/sync/electricsql/*.ts src/modules/offline-trial/sync/select-store.ts src/modules/offline-trial/sync/test-hooks.ts src/modules/offline-trial/server/electric-shape.ts` | tomt |
| Ingen hemmelighet i repoet | `grep -rn "ELECTRIC_SECRET" --include=*.ts --include=*.tsx --include=*.yml --include=*.yaml --include=*.sh . \| grep -v node_modules` | bare `process.env`, `${ELECTRIC_SECRET…}`, `.env.example`, `ci.yml`, `playwright.config.ts`, `start.sh` |
| `ELECTRIC_SECRET` aldri til klienten | `grep -rn "NEXT_PUBLIC_ELECTRIC" . --include=*.ts --include=*.tsx --include=*.env* \| grep -v node_modules` | tomt |
| Ingen modellnavn | `git log fase1-kandidat-powersync..HEAD --format=%B \| grep -i "claude\|gpt\|sonnet\|opus"` | tomt |
| Avhengigheter | `git diff fase1-kandidat-powersync.. -- package.json` | bare `@electric-sql/client` (ny) og versjon `0.2.1 → 0.2.2`; `pnpm licenses list \| grep -A1 electric` viser Apache-2.0; ingen `@electric-sql/pglite`, `@electric-sql/react`, `fake-indexeddb` |
| Skriveregler uendret | `git diff fase1-kandidat-powersync.. --stat -- src/modules/offline-trial/server/apply-changes.ts src/modules/offline-trial/server/photo-storage.ts src/db/schema/` | tomt |
| Migreringen er den eneste databaseendringen | `ls src/db/migrations/` og `git diff fase1-kandidat-powersync.. -- src/db/migrations/meta/` | én ny fil `0002_*.sql` med bare `ALTER TABLE … REPLICA IDENTITY FULL` ×3 og `CREATE PUBLICATION electric_publication_default FOR TABLE …`; journalen oppdatert |
| Ruten er tynn | lese `src/app/api/prove/synk/shape/route.ts` | `getCurrentActor` → 401, kall `forwardTrialShape`, oversett feil til 400/403/502; ingen `requireOrganizationAccess`, ingen `ELECTRIC_*` i ruten; `dynamic = "force-dynamic"` |
| Testkrok aldri i `.env.example` eller Azure-dokumentet | `grep NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS .env.example docs/drift/electricsql.md` | tomt i `.env.example`; i driftsdokumentet bare setningen om at den aldri settes i Azure |
| Dokumenter | `docs/drift/electricsql.md` (del A Mac, del B Azure med rolle, intern ingress, lagring, kostnad, personvern); «Teknisk som utvikleren fyller inn» i `fase1-prove-ab-electricsql.md` er fylt, også «det som ikke virket», linjer eid selv med kø og lagring som egne tall, PGlite forkastet, synktoken ikke brukt | lest |

## 8. Krav til koden som testene bygger på (til utvikler)

1. **Rene filer uten DOM og uten `@electric-sql/*`:** `sync/electricsql/outbox.ts`, `sync/electricsql/apply-incoming.ts`, `sync/electricsql/shape-messages.ts`, `sync/select-store.ts` (`readSyncCandidate`/`writeSyncCandidate` tar `Storage` som valgfritt argument; `openTrialStore` bruker dynamisk `import()`), `sync/types.ts`. Vitest har ingen DOM og skal kunne importere dem. Filnavnene er bindende; funksjonsnavnene i 2.1–2.3 kan justeres hvis det står i PR-en, men **`enqueue`, `takeBatch`, `ackBatch`, `keepBatch`, `applyIncoming`, `parseShapeMessages`** er faste (kortet og avgjørelse D).
2. **`server/electric-shape.ts`:** `buildTrialShapeRequest(actor, organizationId, table, clientParams): Promise<{ url: URL }>` og `forwardTrialShape(actor, organizationId, searchParams, fetchImpl = fetch): Promise<Response>`. Kaster `InvalidTrialChangeError` (400) for ukjent tabell og ulovlig format; `AccessDeniedError` fra `requireOrganizationAccess`. Miljøvariabler leses **ved kall**, så `vi.stubEnv` virker. `DEVELOPMENT_ELECTRIC_SECRET` eksporteres og er lik verdien i `.env.example`.
3. **Proxy-svaret** bygges alltid med nye `Headers` (aldri `upstream.headers` videre). `Cache-Control: private, no-store` settes sist, uansett status.
4. **Testkroken** `window.__offlineTrial` fra `sync/test-hooks.ts`: for begge kandidater `{ candidate, store, deviceId, organizationId, applySyncedRows, readRows, simulateOrganizationChange }`; PowerSync i tillegg `db` og `pendingOverride`. `readRows` godtar også `"shape_state"` og `"outbox"` for ElectricSQL (så e2e kan vise at de tømmes ved organisasjonsbytte). `applySyncedRows` tar rader i snake_case og går samme vei som en shape-melding (`applyIncoming`), så «Endret av en annen» og tekstfletting testes ende til ende. Kroken eksporterer også `createTextState(text)` for e2e-testen om fletting.
5. **Velgeren** på listen: `<fieldset>` med `<legend>Synkløsning</legend>`, to `<button aria-pressed>` med nøyaktig «PowerSync» og «ElectricSQL» (eller «ElectricSQL (ikke klar)» ved pkt. 16), minst 44 px høye. Sperret knapp har `disabled` og teksten «Vent til alt er lagret på serveren før du bytter» i et element som er synlig (ikke bare `title`). Bytte: `writeSyncCandidate` + `location.reload()`.
6. **Statusen** `store.status().pendingChanges` for ElectricSQL er antall operasjoner i `outbox` (etter koalescering). `markPhotoUploaded` øker den aldri.
7. **Indikatoren** uendret (`data-testid="sync-indicator"`, tekstene fra oppgave 4), lytter bare på `store.onStatusChange`.
8. **Shape-henting** starter ved åpning, bruker `live=true` når `up-to-date` er nådd, og ved feil (alle statuser unntatt 200/204, og nettverksfeil) venter 5 s, så dobling til 60 s, per tabell. Aldri tettere enn 5 s per tabell. 409 `must-refetch`: slett `shape_state` og synkede rader for tabellen, hent fra `offset=-1`; `outbox` urørt.
9. **Lokal lagring** `offline-trial-electric` med lagrene fra avgjørelse D. Organisasjonsbytte (`trial_last_organization_id`) sletter hele databasen (`indexedDB.deleteDatabase`) og `clearLocalPhotos()`, for begge kandidater, før lageret åpnes.
10. **Sidene og bildekøen** bruker bare `TrialSyncStore` og `select-store.ts`. `startPhotoUploader(store, organizationId)`.
11. **PowerSync-lageret** får bare kontraktsendringene (A). Ingen annen endring i `sync/powersync/`.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| 40 felt i `pc` og `ipad` med ElectricSQL; samme e2e grønn med PowerSync | 6.1 ny delt test + dagens test |
| Svar og bilde overlever `reload` uten server | 6.2 «svarene og et bilde overlever …» |
| Uten nett: hurtiglager, «Uten nett», venter-tekst/alt lagret | 6.2 «indikatoren viser …», «skjemaet åpner fra hurtiglageret …» |
| Velgeren: overlever omlasting, tillatt når alt er lagret, sperret etter én endring, sletter ingenting | 6.2 tre velger-tester |
| Organisasjonsbytte tømmer alt for begge kandidater | 6.2 «innlogging med annen organisasjon …» |
| «Endret av en annen» via testkroken | 6.2 «shape-svar via proxyen …», «TG og valg …», «første lasting …» |
| `mergeTextStates` lokalt; usendt endring overskrives aldri | 2.2 (tre obligatoriske), 6.2 «innkommende text_state flettes …» |
| Endringskøen: bare 200 fjerner, 500/avbrutt beholder, overlever omlasting, `must-refetch` rører ikke køen | 2.1, 6.2 «endringskøen overlever …», «avbrutt sending …», «det som skrives mens en bunt er underveis …» |
| Uten Electric: lokalt virker, køen tømmes, høyst ett kall per tabell per 5 s | 6.2 «indikatoren …», «shape-henting uten Electric …» |
| `buildTrialShapeRequest`: `params[1]`, tillatelsesliste, `columns`, ukjent tabell, roller, `expectTenantIsolation`; proxy-hoder; 401/403/400/502 | 3.1, 6.2 fem rute-tester |
| `types.ts` uten `getAnswers`; `candidate-boundaries.test.ts` | 2.5 |
| `applyIncoming` rent, uten `window`/React/`@electric-sql` | 2.2, 2.5 |
| compose, `start.sh`, `.env.example`, `ci.yml`, `playwright.config.ts` | 2.7, 7 |
| Migrering 0002: `REPLICA IDENTITY FULL` og publikasjonen | 3.3 |
| `docs/drift/electricsql.md` og teknisk avsnitt fylt inn | 7 (lest) |
| Fremmed organisasjon nektes | 3.1 `expectTenantIsolation` |
| `ipad` har kjørt alt | 6.1 og 6.2 i `ipad`-prosjektet |
| format, lint, typecheck, test, e2e grønne; versjon 0.2.2 | 10 |
| Ingen modellnavn | 7 |

Ikke testbart av KI, står i protokollen for Ståle: ekte shape-strøm fra Electric, lang-polling gjennom App Service, lagring i Safari, to iPader samtidig, omstart av iPad, 200 bilder, at Electric godtar en ferdiglaget publikasjon (utvikler sjekker i Docker på Mac, pkt. 11).

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

- Alle kommandoer grønne. Playwright-listen viser hver test under både `[pc]` og `[ipad]` der planen sier det. Dagens PowerSync- og testskjema-tester er grønne med samme navn.
- Alle tester merket **Obligatorisk** finnes med navnet fra planen og er grønne: 2.1 (2), 2.2 (3), 2.5 (1), 3.1 (8), 3.3 (1), 6.1 (1), 6.2 (3). Mangler én, avvises PR-en uten unntak.
- `grep -rn expectTenantIsolation src/modules/offline-trial` gir nøyaktig tre kall (`listTrialForms`, `listTrialAnswers`, `buildTrialShapeRequest`).
- **Pkt. 16 («ikke klar»)**: hvis utvikler lander der, godtas `test.fixme` **bare** for e2e-testene i 6.1 og 6.2 som trenger et virkende Electric-lager, og bare når det står i PR-en og i resultatfilen med henvisning. Følgende må **uansett** være grønne: hele 2.1–2.5, 2.7, 3.1, 3.3, og rute-testene i 6.2 (401, 403, 400, 502, tillatte parametre, service worker). Velgeren viser da «ElectricSQL (ikke klar)», og testen «velgeren Synkløsning …» tilpasses til å vise at knappen finnes, er `disabled`, og at valget ikke kan settes.
- Avsnitt 7 er gått gjennom; det som ikke kunne kjøres (Docker-daemon, Electric på Mac), står som «ikke kjørt» i testrapporten, ikke som grønt.
- Testrapporten lister funn som «alvorlig» (tilgang, tenant, tap av data, bilde eller bunt slippes før bekreftelse, hemmelighet eller vert i svar) eller «lite» (tekst, rekkefølge, ytelse), og sier hvilket hovedmål hvert funn rammer.
