# Testplan: Tredje kandidat for drift uten nett – egenbygd synk (lokal database og endringskø)

- **Oppgavekort:** `docs/funksjoner/fase1-kandidat-egenbygd.md` (pkt.-numrene under viser til kortet; «forarbeid 1–3» viser til avsnittet «Forarbeid – gjenbruk og lesevei»)
- **Fase:** 1 – Prøve uten nett, punktet «Kandidater satt opp mot samme testskjema», kandidat 3
- **Branch:** `fase1-kandidat-egenbygd` (bygger på `fase1-kandidat-electricsql`, PR #10)
- **Dato:** 29.10.2026
- **Laget av:** test-leder, før koding. Testnavnene og filnavnene er bindende for testskriver. Utvikler leser avsnitt 8 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad; testene viser at den egenbygde løsningen holder samme krav som de to verktøyene, så ADR-en kan sammenligne tall mot tall). Reklamasjoner (ingenting går tapt: en bunt slippes bare ved 200, hentingen hopper aldri over en rad, en ugyldig markør rører aldri køen, nedlastede rader legges aldri over usendte endringer). KI først: ikke KI her, men synklaget testene vokter, er der KI-forslag senere vises og godkjennes på iPaden.

Selve prøvene A og B på ekte iPad er **ikke** del av planen. Ståle kjører dem etter `docs/funksjoner/fase1-prove-ab-egenbygd.md`. Planen dekker alt som kan vises i Vitest og Playwright (Chromium). Ulikt ElectricSQL trenger kandidaten ingen ekstra tjeneste, så **lesing fra serveren og to enheter kan testes ende til ende i e2e i skyen** (avsnitt 6.2).

Planen gjentar ikke testene fra `fase1-kandidat-powersync-testplan.md` og `fase1-kandidat-electricsql-testplan.md`. Alle de skal fortsatt være grønne (avsnitt 6.0).

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`, `tests/offline-trial.ts` (`setupOrganization`, `createDeactivatedEmployee`, `ALL_ROLES`, `putTrialForm`, `answerOp`, `photoOp`): brukes uendret. Ingen nye fabrikker.
- `tests/tenant-isolation.ts`: `expectTenantIsolation({ seed, query, idOf })`. Brukes for `listTrialChangesSince` (avsnitt 3.1).
- `tests/test-env.ts`: `testDatabaseUrl()`. Brukes til den **andre tilkoblingen** i testen «ingen rad hoppes over» (`postgres(testDatabaseUrl(), { max: 1 })`, lukkes i `afterAll`). `postgres` er en avhengighet vi har.
- `src/modules/offline-trial/server/trial-queries.test.ts`: mønsteret `actorFor(grant)`. Gjenbrukes.
- `sync/electricsql/outbox.test.ts` og `sync/electricsql/apply-incoming.test.ts`: **flyttes** med `git mv` til `sync/local/` i forarbeidet. Samme testnavn, samme forventninger, bare importstier endres (forarbeid 1).
- `e2e/helpers.ts`: utvides, ikke endres (avsnitt 6). `TrialSyncCandidate` får `"custom"`, `HookTable` får `"sync_state"`.
- `e2e/fase-1-electricsql.spec.ts`: dagens tester med dagens navn. Eneste endring: løkken i «innlogging med annen organisasjon tømmer lokal lagring for begge kandidater» får `"custom"` (kortet, akseptkriterium «organisasjonsbytte»). Navnet på `describe` beholdes.
- `vitest.config.ts`: ingen DOM og ingen `fake-indexeddb` (ingen nye avhengigheter, pkt. 4). Derfor testes IndexedDB (`local/idb.ts`, `custom/store.ts`) bare i e2e, og de rene delene (kø, innfletting, hente-leser med falsk kontekst, takt) i Vitest.

### 1.1 Tillatte endringer i eksisterende tester (alt annet er «uendret»)

| Fil | Endring | Hvorfor |
|---|---|---|
| `sync/local/outbox.test.ts`, `sync/local/apply-incoming.test.ts` | bare importstier (flyttet) | forarbeid 1 |
| `sync/select-store.test.ts` | testen «nøkkelen er trial_sync_candidate og verdiene bare powersync og electricsql» får nytt navn og ny forventning (2.4) | `TRIAL_SYNC_CANDIDATES` får `custom` (forarbeid 3) |
| `sync/candidate-boundaries.test.ts` | mønster og fillister utvides (2.5) | forarbeid 3 |
| `e2e/fase-1-electricsql.spec.ts` | `"custom"` i løkken for organisasjonsbytte, og `sync_state`-sjekk for den | akseptkriterium |
| `e2e/helpers.ts` | typer utvides, nye hjelpere | avsnitt 6 |

Alle andre endringer i en eksisterende test er et funn.

## 2. Enhetstester (Vitest, rene, ingen database, ingen DOM)

Ingen av filene importerer `window`, `indexedDB`, `navigator`, React eller `@electric-sql/*`. 2.5 håndhever det.

### 2.1 `src/modules/offline-trial/sync/custom/pull-schedule.test.ts` (takt og ventetid, pkt. 6)

Ren fil `sync/custom/pull-schedule.ts`. Funksjonen tar forrige tilstand og en hendelse og gir ny tilstand med `delayMs` (ms til neste henting) regnet fra nå. Hendelser: `"start"`, `"success"` (med `done: boolean`), `"failure"`, `"invalid-cursor"`, `"ack"`, `"wake"`, `"offline"`. Testene skrives som **tabeller med testsaker** (`it.each`), så takten er data. Funksjonsnavnet kan justeres hvis det står i PR-en; filnavnet og hendelsene er faste.

| Testnavn | Viser |
|---|---|
| «første henting går med en gang» | `start` → `delayMs` 0. |
| «vellykket henting med ferdig: true gir neste henting om 5 s» | `success { done: true }` → 5000. |
| «ferdig: false gir neste side med en gang» | `success { done: false }` → 0, uansett om forrige var feil. |
| «feil gir 5, 10, 20, 40, 60 og 60 s» | `failure` ×6 fra start → 5000, 10000, 20000, 40000, 60000, 60000. **Obligatorisk.** |
| «vellykket henting etter feil gir 5 s igjen» | 3× `failure`, så `success { done: true }` → 5000; neste `failure` → 5000 (telleren nullstilt). |
| «ugyldig markør gir ny henting uten siden med en gang, og teller ikke som feil» | `invalid-cursor` → 0, tilstanden sier `resetCursor: true` (eller tilsvarende); feiltelleren uendret. To `invalid-cursor` på rad uten `success` imellom → andre gir 5000 (ingen løkke). |
| «200 på en bunt gir henting ved neste takt, aldri tettere enn 5 s etter forrige henting» | `ack` 1 s etter forrige start → 4000; `ack` 7 s etter → 0. |
| «ack under feilventetid gir henting ved neste takt, men nullstiller ikke feiltelleren» | 3× `failure` (ventetid 20 s), `ack` 1 s etter → 4000; ny `failure` → 40000. |
| «wake gir henting med en gang, men aldri tettere enn 5 s» | `wake` 10 s etter forrige → 0; `wake` 2 s etter → 3000. |
| «uten nett planlegges ingen henting» | `offline` → `delayMs` `null`; `wake` (nettet tilbake) etter det → 0. |
| «ventetiden er aldri under 5 s mellom to hentinger med ferdig: true» | Egenskapstest over alle hendelsesrekker på inntil 8 steg uten `done: false`: summen av tid mellom to starter er ≥ 5000. |

### 2.2 `src/modules/offline-trial/sync/custom/reader.test.ts` (hente-leseren, pkt. 5–6, beslutning «myk sletting»)

`createCustomReader({ fetchImpl, setTimer, clearTimer, now })` (avsnitt 8.3) med en **falsk `LocalReadContext`**: `mergeIncoming` er laget i testen med den ekte `applyIncoming` fra `sync/local/apply-incoming.ts` over en tabell i minnet og et sett `pendingKeys`; `deleteState`, `resetTable`, `notifyStatus` er spioner; `isOnline`/`isClosed` styres av testen. `fetchImpl` gir svar fra testen. Tidtakeren er falsk (`vi.useFakeTimers` eller innsatt `setTimer`).

| Testnavn | Viser |
|---|---|
| «rad med deleted_at fra hente-ruten fjernes lokalt» | Lokal `trial_forms`-rad X; svar med X og `deleted_at` satt → X borte fra tabellen i minnet. **Obligatorisk.** |
| «rad med deleted_at og usendt lokal endring røres ikke» | Lokal `trial_answers` `floors = 7` med nøkkelen i `pendingKeys`; svar med samme nøkkel og `deleted_at` → raden står, `value` 7. **Obligatorisk (tap av data).** |
| «innkommende rader sendes som update, tabellene i rekkefølgen forms, answers, photos» | `mergeIncoming` kalt tre ganger i den rekkefølgen; alle endringer har `kind: "update"`. |
| «markøren skrives bare sammen med den siste tabellen» | `stateRow` er `null` for forms og answers; for photos `{ key: "cursor", value: <markor fra svaret> }`. Også når `trial_photos` er tom (kallet skjer med `[]`). |
| «stopp midt i flettingen gir samme rader på nytt og ingen markør» | `isClosed()` blir `true` etter første `mergeIncoming` → ingen flere kall, markøren ikke lagret; ny leser med samme lagrede markør sender samme `siden`, og radene flettes uten dobbel rad. |
| «spørrestrengen har organisasjonen fra konteksten og den lagrede markøren» | URL `…/api/prove/synk/hent?organisasjon=<ctx.organizationId>&siden=<lagret>`; uten lagret markør ingen `siden`. Ingen andre parametre. |
| «ferdig: false gir neste side med en gang med den nye markøren» | To svar; andre kall går uten ventetid og med `siden` = første svars `markor`. |
| «400 sletter bare markøren, og neste henting går uten siden» | Svar 400 `{ feil }` → `deleteState("cursor")` kalt én gang; `resetTable` og `mergeIncoming` aldri kalt; tabellen i minnet og `pendingKeys` uendret; neste kall uten `siden`. **Obligatorisk (tap av data).** |
| «401, 403, 500 og nettverksfeil fletter ingenting og rører ikke markøren» | `it.each` over 401, 403, 500, 502 og `fetchImpl` som kaster → ingen `mergeIncoming`, ingen `deleteState`, neste kall planlagt etter ventetiden fra `pull-schedule`. |
| «radene normaliseres før fletting» | Svar med `size_bytes: "120"` og `value` som JSON-tekst → raden i minnet har `size_bytes` 120 (tall) og `value` lik teksten. Samme normaliserer som Electric (fra `sync/local/`). |
| «ingen henting uten nett og ingen etter stop» | `isOnline()` `false` → `fetchImpl` ikke kalt etter `start`; `wake()` etter at nettet er tilbake → kalt. Etter `stop()` → aldri kalt igjen, også når en planlagt tidtaker går av. |
| «afterAck gir henting ved neste takt» | Leseren registrerer seg med `ctx.afterAck`; når testen kaller lytteren, går neste kall ved neste takt (2.1). |

### 2.3 Flyttede tester (forarbeid 1, uendret)

- `src/modules/offline-trial/sync/local/outbox.test.ts`: alle 13 tester fra `electricsql/outbox.test.ts`, samme navn.
- `src/modules/offline-trial/sync/local/apply-incoming.test.ts`: alle 12 tester fra `electricsql/apply-incoming.test.ts`, samme navn. Dekker «nedlastet rad legges aldri over en usendt lokal endring» og tekstflettingen også for egenbygd (samme kode).
- `src/modules/offline-trial/sync/electricsql/shape-messages.test.ts`: blir der den er. Flyttes `normalizeShapeRow` til `sync/local/`, får den der én test: «normaliseringen er lik for Electric og egenbygd» (samme inn gir samme ut som før flyttingen; kopier de tre sakene fra «value konverteres til de lokale kolonnetypene»).

Test-leder sjekker at `git diff -M fase1-kandidat-electricsql --stat` viser flyttingene som `rename` med få endrede linjer, og at `grep -c "it(" ` er lik før og etter.

### 2.4 `src/modules/offline-trial/sync/select-store.test.ts` (pkt. 3)

| Testnavn | Viser |
|---|---|
| «lagret custom leses tilbake» | Ny. `trial_sync_candidate` = `"custom"` → `"custom"`. |
| «nøkkelen er trial_sync_candidate og verdiene powersync, electricsql og custom» | Erstatter «… bare powersync og electricsql» (1.1). `TRIAL_SYNC_CANDIDATES` er nøyaktig `["powersync", "electricsql", "custom"]`. |

Dagens «standard er powersync når ingenting er lagret» og «ukjent verdi gir powersync, ikke krasj» er uendret. Ny test i tillegg: «custom med store bokstaver eller norsk navn gir powersync» (`"CUSTOM"`, `"egenbygd"` → `"powersync"`).

### 2.5 `src/modules/offline-trial/sync/candidate-boundaries.test.ts` (forarbeid 3)

| Testnavn | Viser |
|---|---|
| «sidene under prove/testskjema importerer ikke fra noen kandidat» | Uendret navn; mønsteret er nå `sync/(powersync|electricsql|custom|local)`. **Obligatorisk.** |
| «photo-uploader.ts importerer ikke fra noen kandidat» | Samme mønster. |
| «sync-indicator.tsx importerer ikke fra noen kandidat» | Samme mønster. |
| «de rene filene i sync/electricsql importerer ikke window, React eller @electric-sql» | Uendret navn; listen er nå bare `shape-messages.ts` (de to andre er flyttet). |
| «de rene filene i sync/local og sync/custom importerer ikke window, React eller @electric-sql» | Ny. `local/outbox.ts`, `local/apply-incoming.ts`, `custom/pull-schedule.ts`, `custom/reader.ts` (og normaliseringen hvis den er egen fil): ingen `from "react"`, `@electric-sql/`, `@powersync/`, `window.`, `indexedDB`, `document.`, `navigator.`. |
| «sync/custom importerer aldri fra sync/electricsql eller sync/powersync» | Ny. Alle `.ts` i `sync/custom/`. **Obligatorisk** (kortet: kandidat 3 knyttes ikke til en kandidat som kanskje kastes). |
| «sync/local importerer aldri fra noen kandidat» | Ny. Alle `.ts` i `sync/local/`: ingen `sync/(powersync|electricsql|custom)/`, ingen `@electric-sql/`, `@powersync/`. |
| «select-store.ts laster kandidaten med dynamisk import» | Uendret navn; i tillegg `import(` for `custom/`, og ingen statisk import fra `custom/` eller `local/`. |
| «alle filer i sync/electricsql har hodekommentaren» | Uendret. |
| «alle filer i sync/local og sync/custom har hodekommentaren» | Ny. Hver `.ts` (ikke `.test.ts`) begynner med en kommentar med «Prøve fase 1, kastes eller gjøres om etter ADR». Også `server/changes-since.ts` og `src/app/api/prove/synk/hent/route.ts`. |

## 3. Integrasjonstester mot testdatabasen (Vitest, `beforeEach(resetDatabase)`)

### 3.1 `src/modules/offline-trial/server/changes-since.test.ts` (pkt. 10 og 12, forarbeid 2)

Rader legges inn med `putTrialForm`/`applyTrialChanges` der det går, og med SQL mot testdatabasen der testen må styre `updated_at` eller `deleted_at` (myk sletting finnes ikke som skriveoperasjon; `DELETE` gir 400). Hjelperen `fetchAll(actor, orgId, cursor)` i testfilen henter side for side til `ferdig: true` (høyst 20 sider, ellers feiler testen: «sidene går i ring»).

**Tilgang og tenant-isolasjon**

| Testnavn | Viser |
|---|---|
| «listTrialChangesSince gir aldri en annen organisasjons rader (expectTenantIsolation)» | `seed`: `putTrialForm` i A og B, gir skjema-id-ene; `query: async (actor, orgId) => (await listTrialChangesSince(actor, orgId, null)).endringer.trial_forms`; `idOf: r => r.id as string`. **Obligatorisk.** |
| «en markør laget for B og sendt av A gir 0 B-rader» | Hent som B → `markorB`. A kaller med `markorB` → ingen id fra B i noen tabell; A sine rader fra etter markørens tid kommer med. Markøren gir ingen tilgang. **Obligatorisk.** |
| «alle fire roller får hente, deaktivert ansatt nektes» | `it.each(ALL_ROLES)` → svar; `createDeactivatedEmployee` → `AccessDeniedError`. Admin stenges aldri ute. **Obligatorisk.** |
| «fremmed organisasjon gir AccessDeniedError før markøren leses» | Bruker i A mot `orgB.id` med en **ugyldig** markør → `AccessDeniedError`, ikke `InvalidTrialCursorError` (tilgang sjekkes først). |
| «markøren har ingen organisasjons-ID og ingen andre felt enn v og t» | Dekod `markor` (base64url → JSON): nøkler nøyaktig `["t","v"]`, `v === 1`, `t` har de tre tabellene med `u` og `id`; teksten inneholder ikke `organizationId`. |

**Ingen rad hoppes over (forarbeid 2)**

| Testnavn | Viser |
|---|---|
| «ingen rad hoppes over når en eldre transaksjon committer etter hentingen» | To tilkoblinger. tx1 (andre tilkobling) `BEGIN`, setter inn skjema S1 i A (får `now()` = tx1s start), committer **ikke**. tx2 (vanlig `db`) setter inn S2 og committer. Hent til `ferdig: true`: S2 med, S1 ikke; markøren er flyttet forbi S2. tx1 committer. Neste henting med markøren → S1 er med. **Obligatorisk (tap av data).** |
| «oppdatering med updated_at bakover i tid innenfor 60 s kommer med» | Hent til ferdig. Oppdater en rad med `updated_at = <største u> − 30 s` (SQL). Neste henting → raden med ny verdi. **Obligatorisk.** |
| «oppdatering mer enn 60 s bakover kommer ikke med (kjent grense)» | Samme med − 90 s → raden er ikke med. Dokumenterer grensen; teksten «kjent grense, se resultatfilen» står i testen. Utvikler fører grensen i `fase1-prove-ab-egenbygd.md`. |
| «501 rader med samme updated_at gir ferdig: false og resten i neste svar» | 501 `trial_forms` i én `INSERT` (samme `now()`). Første svar: 500 skjemaer, `ferdig: false`. Andre svar: resten, `ferdig: true`. Unionen av id-er er alle 501 (duplikater lov). **Obligatorisk.** |
| «rader som skiller seg med ett mikrosekund hoppes ikke over ved sidegrensen» | 501 skjemaer der rad 500 og 501 har `updated_at` med ett mikrosekunds forskjell (SQL). `fetchAll` gir alle 501. Viser at markøren ikke går gjennom JS `Date`. **Obligatorisk.** |
| «grensen 500 gjelder hele svaret, og tabellene leses i fast rekkefølge» | 300 skjemaer og 300 svar. Første svar: 300 skjemaer, 200 svar, 0 bilder, `ferdig: false`; i markøren er `trial_photos` lik startverdien. `fetchAll` gir alle 600. |
| «ferdig henting leser de siste 60 s på nytt» | To hentinger rett etter hverandre uten endring: andre svar inneholder de samme radene igjen og `ferdig: true` (overlappet virker; `applyIncoming` tåler dem). |
| «uten markør hentes alt fra start» | `cursor: null` på tom organisasjon → tre tomme lister, `ferdig: true`, gyldig `markor`; ny henting med den → 200 uten feil. |

**Form på radene**

| Testnavn | Viser |
|---|---|
| «nøklene i hver rad er nøyaktig localColumnsOf(table)» | `it.each` over tabellene, med skjema, svar og bilde i A: `Object.keys(rad).sort()` lik `[...localColumnsOf(table)].sort()`. Aldri `storage_path`, `organization_id`, `created_by`, `updated_by`, `deleted_by`, `row_version`. **Obligatorisk (sikkerhet).** |
| «radene har samme form som normalizeShapeRow gir» | For hver rad: normalisereren fra `sync/local/` gir en lik rad. Tid er ISO-tekst, `value` JSON-tekst, `size_bytes` tall. |
| «myk slettede rader kommer med deleted_at» | Hent til ferdig. Sett `deleted_at` og `updated_at = now()` på et skjema og et svar (SQL). Neste henting → begge med `deleted_at` satt. Raden finnes fortsatt i databasen (regel 3). **Obligatorisk.** |

**Forfalsket markør (aldri 500)**

| Testnavn | Viser |
|---|---|
| «ugyldig markør gir InvalidTrialCursorError» | `it.each`: `"søppel"`, `"!!!"` (feil base64url), base64url av `"ikke json"`, av `{ v: 2, t: … }`, av `{ v: 1 }`, av `{ v: 1, t: { trial_forms: { u: "i går", id: "x" }, … } }`, `id` som ikke er uuid, og en tekst på 10 000 tegn → kaster `InvalidTrialCursorError`, aldri annen feil. **Obligatorisk.** |
| «markør med fremtidig tid eller fremmed id gir bare egne rader» | `u` = år 2100 → tomme lister, ingen feil. `id` = en B-rads id → bare A-rader. |

### 3.2 Skrivevei og skjema (uendret)

`apply-changes.test.ts`, `photo-storage.test.ts`, `offline-trial-schema.test.ts`: uendret og grønne. Test-leder sjekker at `git diff fase1-kandidat-electricsql -- src/modules/offline-trial/server/apply-changes.ts src/modules/offline-trial/server/photo-storage.ts src/app/api/prove/synk/endringer src/db/` er tom.

## 4. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | 3.1 «alle fire roller …», «fremmed organisasjon … før markøren leses». E2e 6.2: 401 og 403 på hente-ruten. | Ruten kaller bare `getCurrentActor` og `listTrialChangesSince`; `requireOrganizationAccess(actor, organizationId, "organization.read")` ligger i `changes-since.ts`. Test-leder leser ruten (avsnitt 7). |
| Tenant-isolasjon | `expectTenantIsolation` på `listTrialChangesSince` (nytt kall; `grep -rn "expectTenantIsolation(" src/modules/offline-trial` gir nøyaktig **fire**: `listTrialForms`, `listTrialAnswers`, `buildTrialShapeRequest`, `listTrialChangesSince`). Markør fra B gir 0 B-rader (3.1). Lokalt: organisasjonsbytte tømmer `offline-trial-custom` med markøren (6.2). | Testene merket **Obligatorisk** må finnes og være grønne. Mangler én, avvises PR-en. |
| Admin stenges aldri ute | Admin i `it.each` og i `expectTenantIsolation`. E2e logger inn som admin. | Ingen ny tilgangslogikk, ingen nye roller. |
| Myk sletting | Myk slettede rader kommer med fra serveren (3.1) og fjernes lokalt, men ikke over usendt endring (2.2). Serveren beholder radene. Velgerbytte sletter ingenting lokalt (6.2). | Regel 3. |
| Ingen kundeopplysninger eller hemmeligheter | Oppdiktede data. Ingen ny hemmelighet. Svaret har aldri `storage_path` eller brukerkolonner (3.1, 6.2). Logging uten rader (avsnitt 7). | Regel 8. |

## 5. Regeltester

Ingen regler eller TG-logikk (prøve E). Takten og ventetiden er skrevet som data (`it.each`-tabeller) i 2.1. Test-leder sjekker at `sync/custom/` og `sync/local/` ikke inneholder TG-avledning.

## 6. E2e (Playwright, Chromium, `pc` og `ipad`)

Hente-ruten og skriveruten finnes i e2e, så egenbygd kan testes **med ekte lesing fra serveren**. E2e-databasen tømmes aldri: testene må tåle mange rader fra andre tester (flere sider med `ferdig: false`), og må aldri regne med et bestemt antall rader på serveren.

**Nye hjelpere i `e2e/helpers.ts`** (de gamle uendret):
- `TrialSyncCandidate` får `"custom"`; `HookTable` får `"sync_state"`.
- `countRequests` brukes som før; i tillegg `recordPulls(page)`: registrerer kall mot `/api/prove/synk/hent` med tidspunkt (`Date.now()`), `siden` og `ferdig` fra svaret.
- `openSecondDevice(browser, candidate)`: ny `BrowserContext` med `useCandidate` og `logIn(ADMIN_EMAIL)`; gir `page`. Egen `deviceId` fordi `localStorage` er per kontekst.

### 6.0 Dagens e2e (uendret)

`e2e/fase-1-powersync.spec.ts`, `e2e/fase-1-testskjema.spec.ts` og `e2e/fase-1-electricsql.spec.ts` kjøres med samme testnavn. Eneste endring er 1.1. Blir en av dem rød, er det et funn mot flyttingen til `sync/local/`, ikke mot testen (fallback i forarbeid 1).

### 6.1 `e2e/fase-1-testskjema.spec.ts` (én ny delt test)

- Ny: «alle 40 felt fylles ut og telleren viser 40 av 40 med Egenbygd valgt» (pc, ipad): `useCandidate(context, "custom")` → `fillAllFields` → «40 av 40 felt utfylt». **Obligatorisk.**

### 6.2 `e2e/fase-1-egenbygd.spec.ts` (ny)

Alle tester starter med `useCandidate(context, "custom")` og `logIn(page, ADMIN_EMAIL)`, unntatt velgertestene. `pcOnly` som i Electric-filen. Alle `page.route` fjernes i `finally`.

**Lagring og kø (samme som Electric, med navnet «(Egenbygd)»)**

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «testkroken viser custom som kandidat og lageret er klart» | `hookValue(page, "candidate") === "custom"`; `readRowsViaHook(page, "trial_forms")` gir en liste; `window.__offlineTrial.db` finnes ikke. | pc, ipad |
| «listen viser nye testskjemaer med navn og laget når, og åpner dem (Egenbygd)» | Som Electric-testen. | pc, ipad |
| «svarene og et bilde overlever at siden lastes på nytt (Egenbygd)» | `roof_tg = TG2`, `floors = "7"`, tekst, ett bilde. `reload` → alt står, «4 av 40», «1 bilde». Akseptkriterium 2. | pc, ipad |
| «indikatoren viser Uten nett uten nett, og alt lagret med nett (Egenbygd)» | `setOffline(true)` → «Uten nett»; skriv `floors = "3"`; `setOffline(false)` → «Alt er lagret på serveren» innen 20 s. Akseptkriterium 3. | pc, ipad |
| «skjemaet åpner fra hurtiglageret uten nett etter ett besøk (Egenbygd)» | Som Electric-testen. Nye svar kan skrives uten nett. | pc, ipad |
| «endringskøen overlever omlasting og tømmes bare etter 200 (Egenbygd)» | `CHANGES_ROUTE` → 500 før skjemaet lages. `pendingChanges` ≥ 2 og holder seg i 6 s. `reload` → fortsatt ≥ 2, verdien står. `unroute` → 0 innen 20 s, «Alt er lagret på serveren». **Obligatorisk (tap av data).** | pc, ipad |
| «avbrutt sending beholder bunten (Egenbygd)» | Som over med `route.abort()`. | pc |
| «køen overlever at fanen lukkes og åpnes igjen (Egenbygd)» | `CHANGES_ROUTE` → 500 (på `context.route`). Skriv `floors = "7"`. `page.close()`, ny `page` i samme kontekst, åpne skjemaet → `floors` 7, `pendingChanges` ≥ 2. `unroute` → 0. Nærmeste vi kommer «lukk appen» (A5) i e2e. **Obligatorisk (tap av data).** | pc, ipad |
| «det som skrives mens en bunt er underveis går ikke tapt (Egenbygd)» | Som Electric-testen: endringer-ruten venter 3 s; `floors` 7, så 8; to `POST` med `floors`, siste `"8"`; køen tom til slutt. | pc |
| «bildet blir liggende lokalt til serveren har bekreftet sha256, så viser indikatoren 0 bilder (Egenbygd)» | Som Electric-testen; `markPhotoUploaded` øker ikke `pendingChanges`. | pc, ipad |
| «Electric og Egenbygd har hver sin lokale database» | Erstatter Vitest-testen for `createLocalDb` (ingen IndexedDB i Vitest, ingen nye avhengigheter). Lag skjema med `electricsql`, bytt til `custom` (`localStorage` + `reload`): skjemaet finnes ikke i `readRowsViaHook("trial_forms")` før hentingen har gått (skjemaet er på serveren, så det **kan** komme via hentingen; testen sjekker derfor IndexedDB direkte). `indexedDB.databases()` har både `offline-trial-electric` og `offline-trial-custom`. `offline-trial-electric` har versjonen og lagrene den hadde før (`shape_state` med keyPath `table`, `outbox`, tre `synced_*`); `offline-trial-custom` har `sync_state` (keyPath `key`), `outbox`, tre `synced_*` og **ikke** `shape_state`. Bytt tilbake → Electric-skjemaet står. Akseptkriterium «createLocalDb». | pc |

**Henting fra serveren (nytt for denne kandidaten)**

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «ny enhet får skjemaet og svarene fra serveren via hente-ruten» | Enhet 1: nytt skjema, `floors = "7"`, `roof_tg = TG2`, «Alt er lagret». Enhet 2 (`openSecondDevice`, tom IndexedDB): skjemaet står i listen innen 20 s, åpnes, `floors` 7, TG2, «2 av 40», **ingen** «Endret av en annen» (første lasting). | pc, ipad |
| «hentingen går omtrent hvert 5. sekund med nett, aldri tettere» | `recordPulls` fra før `goto`, 16 s. For hvert par der første svarte `ferdig: true`: avstand ≥ 4 500 ms og ≤ 8 000 ms. Minst 3 kall. Grense med slingringsmonn 500 ms nedover og 3 s oppover (CI kan være treg). | pc |
| «feil på hente-ruten gir økende ventetid, og skriving virker i mellomtiden» | `page.route` hente-ruten → 500. Over 20 s: høyst 3 kall; avstand mellom første og andre ≥ 4 500 ms, mellom andre og tredje ≥ 9 500 ms. Samtidig `floors = "7"` → «Alt er lagret på serveren» innen 20 s (henting blokkerer aldri skriving). | pc |
| «ugyldig markør (400) gir ny henting uten siden, og køen er urørt» | Vent til et kall har `siden`. `CHANGES_ROUTE` → 500, skriv `floors = "7"` og Tak TG2 (to svar, så køen har minst to endringer også når «nytt skjema» alt er sendt), `pendingChanges` ≥ 2. Neste hentekall med `siden` får `route.fulfill({ status: 400, body: '{"feil":"…"}' })`. Neste kall innen 6 s er **uten** `siden`; `pendingChanges` uendret; `floors` 7 i `readRowsViaHook`; `outbox` like lang som før. `unroute` begge → køen tømmes. **Obligatorisk (tap av data).** | pc |
| «ingen henting uten nett» | `setOffline(true)` → i 10 s ingen nye kall mot hente-ruten. `setOffline(false)` → ett kall innen 6 s. | pc |
| «Egenbygd kaller verken shape-ruten eller PowerSync» | `countRequests` på `**/api/prove/synk/shape*` og `**/api/prove/synk/token*` i 10 s → 0. | pc |

**To enheter (prøve B i det små, akseptkriterium «to enheter»)**

To kontekster mot samme server, samme skjema. Rekkefølgen på sendingen styres med `setOffline` per kontekst, så det er fast hvem som taper. Vente-grense for at en endring vises på den andre: **20 s** (takt 5 s pluss sending og slingringsmonn).

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «tekst skrevet på én enhet vises på den andre uten omlasting» | A og B har skjemaet åpent. A skriver «Taket er tett.» i «Tak – beskrivelse». B viser teksten innen 20 s uten `reload`. | pc, ipad |
| «samtidig tekst i samme felt gir begge bidrag på begge» | Felles start: A skriver «Grunnmur.», begge ser den. Begge `setOffline(true)`. A legger til « Del A.», B legger til « Del B.». A på nett, vent til A har «Alt er lagret». B på nett. Innen 20 s viser **begge** felt «Del A.» og «Del B.» og «Grunnmur.» én gang. **Obligatorisk (prøve B).** | pc |
| «TG på begge gir samme verdi på begge og Endret av en annen hos den som tapte» | Begge `setOffline(true)`. A setter `roof_tg` TG2, B TG3. A på nett, vent til «Alt er lagret». Så B. Innen 20 s: TG3 trykket på begge (den som kom sist til serveren vinner, regelen fra oppgave 4); A viser «Endret av en annen» i `[data-field="roof_tg"]`, B gjør det ikke. **Obligatorisk (prøve B).** | pc |

**Velger og organisasjon**

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «velgeren har tre knapper, og Egenbygd overlever omlasting» | Uten `useCandidate`. Gruppen «Synkløsning» har «PowerSync», «ElectricSQL» og «Egenbygd» (`exact: true`), alle ≥ 44 px høye på `ipad`. Trykk «Egenbygd» → siden lastes på nytt, `aria-pressed="true"`, `localStorage.trial_sync_candidate === "custom"`, kroken `custom`. `reload` → fortsatt valgt. | pc, ipad |
| «velgeren er sperret med forklaring når noe venter på å bli sendt (Egenbygd)» | `CHANGES_ROUTE` → 500, skriv. På listen: de to andre knappene `disabled`, «Vent til alt er lagret på serveren før du bytter» synlig. `unroute` → aktive innen 20 s. | pc, ipad |
| «bytte mellom alle tre kandidater sletter ingenting lokalt» | Lag skjema og `floors = "7"` med hver av de tre (lokalt). Bytt rundt `powersync → electricsql → custom → powersync → electricsql → custom`: hvert skjema står i sin kandidats `readRowsViaHook("trial_forms")` med `floors` 7. **Obligatorisk (tap av data).** | pc |
| «innlogging med annen organisasjon tømmer lokal lagring for begge kandidater (custom)» | Den utvidede løkken i Electric-filen (1.1). For `custom` i tillegg: **vent til `readRowsViaHook("sync_state")` har raden `cursor` før byttet**; etter byttet er `sync_state` og `outbox` tomme, og første kall mot hente-ruten etter `reload` er uten `siden`. **Obligatorisk (tenant).** | pc |

**Hente-ruten**

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «uinnlogget gir 401 på hente-ruten» | `request.get("/api/prove/synk/hent?organisasjon=<uuid>")` → 401, `cache-control` `private, no-store`. | pc |
| «fremmed organisasjon gir 403 på hente-ruten» | Innlogget, tilfeldig uuid → 403, `private, no-store`, kroppen har ingen rader. **Obligatorisk.** | pc |
| «ugyldig markør gir 400 på hente-ruten» | Egen organisasjon, `siden=søppel` → 400, JSON `{ feil }` på norsk, `private, no-store`. | pc |
| «hente-ruten svarer med endringer, markor og ferdig, og aldri storage_path» | Egen organisasjon (`hookValue(page, "organizationId")`), etter ett bilde lastet opp → 200, nøkler nøyaktig `endringer`, `markor`, `ferdig`; `endringer` har de tre tabellene; kroppen inneholder ikke `storage_path`, `created_by`, `organization_id`; `private, no-store`. | pc |
| «service worker rører ikke hente-ruten» | Etter registrering og ett hentekall: ingen `/api/` i noen cache. | pc |

## 7. Sjekker test-leder gjør for hånd

| Sjekk | Kommando | Forventet |
|---|---|---|
| Ingen nye avhengigheter | `git diff fase1-kandidat-electricsql -- package.json pnpm-lock.yaml` | bare `"version": "0.2.2"` → `"0.2.3"`; lockfila uendret |
| Skrivevei, tabeller og drift uendret | `git diff fase1-kandidat-electricsql --stat -- src/modules/offline-trial/server/apply-changes.ts src/modules/offline-trial/server/photo-storage.ts src/app/api/prove/synk/endringer src/db docker-compose.yml start.sh infra` | tomt |
| Flyttingen er ren | `git diff -M fase1-kandidat-electricsql --stat -- src/modules/offline-trial/sync/` | `outbox*` og `apply-incoming*` som rename; `electricsql/store.ts` mindre, `local/trial-store.ts` ny |
| PowerSync-lageret uendret | `git diff fase1-kandidat-electricsql -- src/modules/offline-trial/sync/powersync/` | tomt |
| Ruten er tynn | lese `src/app/api/prove/synk/hent/route.ts` | `dynamic = "force-dynamic"`; `getCurrentActor` → 401; kall `listTrialChangesSince`; feil → 400/403; `Cache-Control: private, no-store` på alle svar; ingen `requireOrganizationAccess`, ingen SQL; logger bare rute, bruker, antall rader og status |
| Spørringen filtrerer på grant | lese `server/changes-since.ts` | `requireOrganizationAccess` først; `organization_id = grant.organizationId`; markøren leses med Zod; `u` som tekst fra PostgreSQL, aldri `new Date(u)` |
| Ingen kandidatimport i sidene | `grep -rlnE "sync/(powersync\|electricsql\|custom\|local)" "src/app/(ansatt)/prove" src/modules/offline-trial/sync/photo-uploader.ts src/modules/offline-trial/sync-indicator.tsx` | tomt |
| Hodekommentar | `grep -L "Prøve fase 1" src/modules/offline-trial/sync/local/*.ts src/modules/offline-trial/sync/custom/*.ts src/modules/offline-trial/server/changes-since.ts src/app/api/prove/synk/hent/route.ts` | tomt (utenom `*.test.ts`) |
| Tenant-kall | `grep -rn "expectTenantIsolation(" src/modules/offline-trial` | fire |
| Ingen modellnavn | `git log fase1-kandidat-electricsql..HEAD --format=%B \| grep -iE "claude\|gpt\|sonnet\|opus"` | tomt |
| Resultatfilen | lese `docs/funksjoner/fase1-prove-ab-egenbygd.md` | teknisk avsnitt fylt: hva som ikke virket, overlapp 60 s og blandede klokker, manglende indeks, linjer eid selv (gjenbrukt og nytt hver for seg, talt som i Electric-filen) |

## 8. Krav til koden som testene bygger på (til utvikler)

1. **Filnavn er bindende:** `sync/local/{outbox,apply-incoming,idb,trial-store}.ts`, `sync/custom/{store,reader,pull-schedule}.ts`, `server/changes-since.ts`, `src/app/api/prove/synk/hent/route.ts`. Normalisereren for innkommende rader ligger i `sync/local/` (ikke i `electricsql/`), så `custom/` kan bruke den.
2. **`pull-schedule.ts`** er ren og tar `now` som argument (ingen `Date.now()` inne i funksjonen), så 2.1 kan kjøre uten falske tidtakere.
3. **`custom/reader.ts`** er ren ved import: `createCustomReader({ fetchImpl = fetch, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now })` gir en `LocalTrialReader`. Nett leses bare via `ctx.isOnline()`, aldri `navigator.onLine` direkte. 400 → `ctx.deleteState("cursor")` og ny henting uten `siden`; aldri `resetTable`, aldri noe med køen.
4. **`listTrialChangesSince(actor, organizationId, cursor)`** kaster `AccessDeniedError` før markøren leses, og `InvalidTrialCursorError` (ny i `server/errors.ts`) for alt som ikke er en gyldig markør. Ingen annen feiltype for dårlig input. Øvre lengde på markøren velger arkitekt; 10 000 tegn skal avvises.
5. **Testkroken:** for `custom` som for `electricsql`. `readRows` godtar `"sync_state"` (uten raden `outbox_next_seq`) og `"outbox"`. `applySyncedRows` går samme vei som hentingen (`mergeIncoming`).
6. **Velgeren:** tredje `<button aria-pressed>` med nøyaktig «Egenbygd» (eller «Egenbygd (ikke klar)» ved pkt. 14), ≥ 44 px.
7. **`clearIfOtherOrganization`** sletter også `offline-trial-custom` (hele databasen, med `sync_state`).
8. **`status().pendingChanges`** er antall operasjoner i `outbox`, som for Electric. `markPhotoUploaded` øker den aldri.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| 40 felt i `pc` og `ipad` med Egenbygd; samme test for de to andre | 6.1 + dagens tester |
| Svar og bilde overlever `reload` | 6.2 «svarene og et bilde overlever …» |
| Uten nett: hurtiglager, «Uten nett», så «Alt er lagret» | 6.2 «indikatoren …», «skjemaet åpner fra hurtiglageret …» |
| Kø: 500 og avbrutt beholder, tømmes etter `unroute`, overlever omlasting | 6.2 tre kø-tester + «køen overlever at fanen lukkes …»; 2.3 |
| To enheter: tekst vises, samtidig tekst flettes, TG lik på begge med varsel hos taperen | 6.2 tre to-enhet-tester |
| Henting: ren takt-funksjon; e2e teller kall; 400 gir henting uten `siden`, kø urørt | 2.1, 2.2, 6.2 «hentingen går …», «feil på hente-ruten …», «ugyldig markør (400) …» |
| Ikke over usendte endringer, `text_state` flettes, `deleted_at` fjernes lokalt unntatt ved usendt endring | 2.3 (flyttede), 2.2 to obligatoriske |
| Organisasjonsbytte tømmer markøren og `offline-trial-custom` | 6.2 «… (custom)» |
| `listTrialChangesSince`: ingen rad hoppes over, 60 s bakover, myk slettet, kolonner, 501 rader, markør fra B, forfalsket markør, roller, `expectTenantIsolation`; ruten 401/403/400 og `no-store` | 3.1, 6.2 hente-rute-tester |
| Velgeren: tre knapper, overlever omlasting, sperret når noe venter, bytte sletter ingenting | 6.2 velgertestene |
| `candidate-boundaries.test.ts` dekker `custom/` og `local/` | 2.5 |
| Electric- og PowerSync-tester grønne uendret; `createLocalDb` med to databaser | 6.0, 1.1, 2.3; 6.2 «Electric og Egenbygd har hver sin lokale database» |
| Skrivevei uendret, ingen nye avhengigheter | 3.2, 7 |
| Resultatfilen fylt inn | 7 |
| Fremmed organisasjon nektes | 3.1 `expectTenantIsolation`, 6.2 403 |
| `ipad` har kjørt alt, også `fase-1-egenbygd.spec.ts` | 6.1, 6.2 |
| format, lint, typecheck, test, e2e grønne; versjon 0.2.3 | 10 |
| Ingen modellnavn | 7 |

Ikke testbart av KI, står i protokollen for Ståle: lagring og kø i Safari på iPad, omstart av iPaden, 200 bilder, to ekte iPader, henting gjennom App Service i Azure.

## 10. Slik godkjenner test-leder

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e
```

Godkjennes bare når alt dette stemmer:

- Alle kommandoer grønne. Playwright viser testene under både `[pc]` og `[ipad]` der planen sier det. PowerSync-, Electric- og testskjema-testene er grønne med samme navn (1.1 er eneste unntak).
- Alle tester merket **Obligatorisk** finnes med navnet fra planen og er grønne: 2.1 (1), 2.2 (3), 2.5 (2), 3.1 (10), 6.1 (1), 6.2 (8). Mangler én, avvises PR-en.
- `expectTenantIsolation(` har nøyaktig fire kall i `src/modules/offline-trial`.
- **Pkt. 14 («ikke klar»):** `test.fixme` godtas **bare** for e2e i 6.1 og 6.2 som trenger et virkende egenbygd lager, og bare når det står i PR-en og resultatfilen. Uansett grønne: hele 2.1, 2.3–2.5, hele 3.1 og hente-rute-testene i 6.2 (401, 403, 400, 200-formen, service worker), samt «innlogging med annen organisasjon … (custom)». Velgertesten viser da at «Egenbygd (ikke klar)» finnes og er `disabled`.
- Avsnitt 7 er gått gjennom. Det som ikke kunne kjøres, står som «ikke kjørt», ikke som grønt.
- Testrapporten merker funn som «alvorlig» (tilgang, tenant, tap av data, rad hoppet over, bunt slippes før 200, markør som gir fremmede rader, kolonne som ikke skal ut) eller «lite» (tekst, takt, ytelse), og sier hvilket hovedmål hvert funn rammer.
