# Testplan: Liten oppgave (r) og (s) – småfunn fra PR #69 og nattløkken 03.11.2026

- **Oppgavekort:** `docs/agenter/oppgaver/fase0b-smafunn-r-s.md`
- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Branch:** `fase0b-smafunn-r-s` (bygger på `main`), versjon `0.2.60`
- **Laget av:** test-leder, 03.11.2026 (før koding, runde 1). Justert av prosjektlederen samme dag etter avgjørelsene i kortet («Avgjørelser etter forhåndsvurderingen»): T4 er tatt ut, T1, T2 og T5 er påstander i tester som finnes, ikke nye tester. 2b, 8c og E1–E3 står.
- **Støtter hovedmål:** Reklamasjoner: en halvskrevet bildefil kan aldri leses av e2e-testen eller visningsruten; typesjekken sier fra hvis Microsoft 365-innstillingene får et nytt felt; loggvasken blir kortere og dermed lettere å holde riktig. Tid: oppslaget på innlogging ved ny ansatt bruker indeksen; færre doble tester gir raskere CI. KI først: ikke direkte (grunnmur).

## Hva som skal vises

1. **Punkt 18:** etter `storeTrialPhoto` og `storeTrialDisplayCopy` ligger bare de endelige filene i mappen, med samme byte som ble sendt. Feiler skrivingen etter at den midlertidige filen er laget, ligger ingen `.tmp-`-fil igjen, og feilen kastes videre. e2e-testen «kopi som får 400 …» er grønn i både `pc` og `ipad`, også når den kjøres flere ganger på rad.
2. **Punkt 20:** `findOrCreateUser` sammenligner eksakt på `users.email`. Det vises med to saker: en innlogging med små bokstaver treffes av skjemaet med store bokstaver og mellomrom uten ny rad (test 2, finnes), og en rad med store bokstaver lagt inn utenom skriverne treffes *ikke* (ny test; dette er saken som skiller `eq` fra `lower(`). Kriteriet `grep -c 'lower(' … = 0` sjekkes av test-leder i rapporten, ikke av en test (prosjektet tok bort tester som leser kildefiler i liten oppgave (f)).
3. **(r) 1:** `senderForConnection` bruker typen fra Zod, og alle tre leverandørene valideres fortsatt (Microsoft 365 med `microsoft365SettingsSchema`, `server_log` og `dev_mailbox` med det tomme skjemaet). Ingen `as {` i `resolve.ts`.
4. **(r) 5:** alle elleve ordene som tas ut av `SENSITIVE_KEY`, vaskes fortsatt, eksakt og med prefiks. Ingen eksisterende test fjernes eller endres; én ny tabelltest låser de elleve.
5. **Ryddingen fjerner bare det som er dekket et annet sted** (kart nederst).
6. **Tilgang og tenant-isolasjon er uendret:** ingen ny spørring tar `organizationId`, ingen endring i `src/core/access`. `users` er en global tabell uten `organization_id` (låst i `tests/tenant-isolation-all-tables.test.ts`). `findOrCreateUser` kalles bare fra `createEmployee` bak `organization.manage` (3.1 i `employees-admin.test.ts`, finnes). Admin stenges ikke ute av noe her.

Fast oppsett som i dag: `resetDatabase` i `beforeEach` for sakene mot databasen; `TRIAL_UPLOAD_DIR` pekes til en `mkdtemp`-mappe i `photo-storage.test.ts`; `globalThis.fetch` spioneres på og skal være ukalt i e-post-testene (`afterEach` i `email.test.ts` sjekker det for hele filen).

## 1. Enhetstester uten database

### `src/shared/lib/logger.test.ts` (ny gruppe «de elleve ordene vaskes fortsatt etter at de eksakte alternativene er tatt ut»)

| Test | Viser |
|---|---|
| E1. `it.each` over `password`, `passord`, `secret`, `clientSecret`, `token`, `accessToken`, `refreshToken`, `sessionToken`, `apiKey`, `connectionString`, `accountKey`: `formatLogLine("info", "Test", { [key]: "x" })[key]` er `[fjernet]` | Eksakt nøkkel vaskes av «slutter på»-alternativet (`.*` kan være tomt). I dag er bare `password`, `accessToken`, `connectionString`, `accountKey` og `clientSecret` dekket eksakt. |
| E2. Samme elleve med prefiks i to skrivemåter: `graphRefreshToken` / `GRAPH_REFRESH_TOKEN`, `userPassord` / `USER_PASSORD` osv. (`it.each` med en liten tabell) | Prefiks og begge skrivemåter går gjennom normaliseringen (`-`/`_` fjernes, små bokstaver). |
| E3. Ingen overvasking: `tokens`, `secretRef`, `secret_ref`, `passordHint`, `apiKeys` står urørt | Mønsteret er fortsatt «slutter på», ikke «inneholder». (`secretRef`/`clientId` finnes i M365 3 og P5; de står.) |
| Eksisterende: «fjerner følsomme felt» (linje 30), Azure 3, M365 3, P1–P6 | Regresjon, uendret. |

### `src/core/files/config.test.ts`

| Test | Viser |
|---|---|
| 6 (endret): `fetchSpy` ukalt og `driver === "azure"`; spionene på `put`/`get` er borte | Konfigurasjonen bygger Azure-adapteren uten nett. At `put`/`get` ikke kalles av `createFileStorage`, kan ikke vises med en spion som settes etter kallet. |

## 2. Integrasjonstester mot testdatabasen

### `src/core/organization/employees-admin.test.ts` (gruppe 3.5 «ny ansatt og innlogging»)

| Test | Viser |
|---|---|
| 2 (beholdes). `createUser({ email: "ola@eksempel.no" })` + `createEmployee` med `"  Ola@Eksempel.NO "` → ingen ny rad i `users`, `userId` er den eksisterende, navn og e-post på innloggingen uendret | Skjemaet normaliserer, og eksakt sammenligning treffer raden som seedet/`employeeCreateSchema` har skrevet. |
| 2b (ny). Rad i `users` lagt inn **direkte** med `db.insert(users)` og `email: "Kari@Eksempel.NO"` (utenom skriverne) + `createEmployee` med `"kari@eksempel.no"` → **ny** rad i `users` med `kari@eksempel.no`, den ansatte peker på den nye, og raden med store bokstaver er uendret | Sammenligningen er eksakt (`eq`), ikke `lower(`. Dette er den eneste oppførselen som skiller før og etter. Kommentaren i testen sier at slike rader ikke skal finnes (alle skrivere gjør adressen til små bokstaver), og at testen går rød hvis noen setter `lower(` tilbake. |
| 1 (beholdes). Ny e-post lager innlogging med små bokstaver | Skjemaet er en av skriverne som holder invarianten. |
| `src/db/seed/run.test.ts` (finnes): seedet skriver `SEED_ADMIN_EMAIL` med små bokstaver | Seedet er den andre skriveren. Ingen ny test; test-leder bekrefter at den finnes, ellers én liten sak der. |

Ikke med: `EXPLAIN` mot testdatabasen (ville bare måle en håndskrevet spørring, ikke koden) og statisk lesing av kildefilen (tatt ut av prosjektet i liten oppgave (f)). Kriteriet `grep -c 'lower(' src/core/organization/employees-admin.ts` = 0 kjøres av test-leder i testrapporten.

### `src/core/email/resolve.test.ts`

| Test | Viser |
|---|---|
| 1 (finnes). Aktiv microsoft365-tilkobling brukes med sine settings og sin hemmelighet | `from`, `tenantId` og `clientId` kommer fra `parsed.data` med Zod-typen. |
| 8b (finnes). Ugyldige settings på microsoft365-raden: `send` avvises, `fetchFn` ukalt, hemmeligheten ikke i feilen | Valideringen i microsoft365-grenen. |
| 8c (ny). `server_log`-rad med `settings: { x: 1 }` (ikke tomt): `connectionId` satt, `send` avvises, ingen logglinje skrives | De to andre grenene validerer fortsatt mot det tomme skjemaet etter omleggingen. Uten denne testen kan valideringen stille forsvinne for `server_log`/`dev_mailbox`. |
| 10 (finnes). `server_log`-tilkobling med tomme settings gir server_log | Motstykket til 8c. |
| `email.test.ts` 2 (finnes). microsoft365 sender gjennom `fetchFn`: ett token-kall og ett sendekall | Hele veien med typen fra skjemaet. |

### `src/core/email/email.test.ts` og `src/core/integrations/connections.test.ts` (fjerning)

| Fjernes | Dekkes av |
|---|---|
| `email.test.ts` 16 «ingen nettkall der sending ikke skjer (disabled → server_log)» | 13 (samme oppsett, `calls` tom, raden uendret, `NOT_CONFIGURED`), og `afterEach` i filen som krever `fetchSpy` ukalt for hver test. 13b og 13c står. |
| `connections.test.ts` 3.12 test 9 «ingen rad i revisjonsloggen etter suksess og feil» | `email.test.ts` 8.2 test 1, 2 og 5 (`recordConnectionResult` gjennom `sendEmail`, `auditRows` tom). 3.12 test 1–8 står, inkludert `expectTenantIsolation` (3.9.4). |
| `config.test.ts` 6: spionene på `put` og `get` | Ingenting å dekke; sjekken beviste ingenting. `fetchSpy`-sjekken står. |

Ingen andre tester fjernes. Test-leder sammenligner antall `it(` per fil mot `main` i rapporten.

### `src/modules/offline-trial/server/photo-storage.test.ts` (T1, T2 og T5 som én ekstra påstand hver i tester som finnes; T3 som ny test)

Hjelperen i `photo-storage.test.ts` som lister mappen rekursivt (`readdir(dir, { recursive: true })`, linje 93) brukes i alle sakene.

| Test | Viser |
|---|---|
| T1 (påstand i testen for `storeTrialPhoto`, linje 98). Mappen `TRIAL_UPLOAD_DIR/<organizationId>` inneholder nøyaktig `[<id>]`; ingen oppføring inneholder `.tmp-`. Sha256-sjekken av innholdet finnes alt der | Originalen skrives via midlertidig fil og `rename`, ingen rest. |
| T2 (påstand i testen for `storeTrialDisplayCopy`, linje 601). Mappen inneholder nøyaktig `[<id>, <id>.display.jpg]`; ingen `.tmp-` | Visningskopien går samme vei. |
| T3 (ny test). Feil **etter** at den midlertidige filen er laget: lag en **mappe** på den endelige stien (`mkdir(TRIAL_UPLOAD_DIR/<organizationId>/<id>)`) før `storeTrialPhoto` → kallet avvises (Linux gir `EISDIR` fra `rename`), mappen står, og det ligger ingen `.tmp-`-fil i `TRIAL_UPLOAD_DIR/<organizationId>`. Raden har fortsatt ikke `uploaded_at` | Hjelperen rydder den midlertidige filen når `rename` feiler, og feilen kastes videre. «Mappen er en fil» (kortets forslag) feiler alt i `mkdir`, før noen midlertidig fil finnes, og viser derfor ikke oppryddingen. |
| ~~T4~~ Tatt ut av prosjektlederen: begge skrivestedene går gjennom samme hjelper, og grep-kriteriet «`writeFile` bare i hjelperen» (avsnitt 6) låser det. | – |
| T5 (påstand i testen «samme fil to ganger gir samme sti og samme sha256»). Mappen har fortsatt bare `[<id>]` etter andre kall | `rename` over en eksisterende fil etterlater ikke to filer. |
| Eksisterende: «den ferdige stien ligger alltid under TRIAL_UPLOAD_DIR» (orig og kopi), tenant-isolasjonen for visningskopien, 404-sakene | Regresjon, uendret. Den midlertidige filen skal ligge i samme mappe som den endelige (T1/T2 viser det indirekte: ingen oppføring utenfor `<organizationId>`). |

Tilgang: ingen endring. Rolletestene «alle fire roller kan laste opp, deaktivert ansatt nektes» og «fremmed organisasjon gir AccessDeniedError» står.

## 3. Regeltester

Ingen regler endres.

## 4. e2e (Playwright, `pc` og `ipad`)

| Test | Viser |
|---|---|
| Hele `pnpm test:e2e` i begge prosjektene | Ingen regresjon; `e2e/` er ikke endret. |
| `pnpm test:e2e -- --repeat-each 3 -g "kopi som får 400"` (begge prosjektene) | Den ustabile testen er grønn tre ganger på rad i begge størrelsene. `waitForFile` ser bare den ferdige filen fordi stien først finnes etter `rename`. Tar ca. 30 s per kjøring per prosjekt. |
| Prøve D for øvrig (rotering, brudd, HEIC) | `sha256File` rett etter `waitForFile` gir riktig fingeravtrykk hver gang, også for visningskopien. |

Uten nett: ingen ny sak; drift uten nett er ikke berørt (bare serverens skriving).

## 5. Dokumentasjon (sjekkes av test-leder, ikke tester)

- `docs/05-domenemodell.md` ved `employee_permissions`: én setning om hvorfor det ikke er indeks på `organization_id` (alle spørringer går via `employee_id` og den delvise unike indeksen), og når det må vurderes på nytt (en spørring som filtrerer på organisasjon uten ansatt). Rad i endringsloggen nederst.
- Kommentaren over `findOrCreateUser` sier **hvem** som skriver `users.email`: seedet (`trim().toLowerCase()`) og `employeeCreateSchema`. Better Auth skriver aldri `users` (`disableSignUp: true` i `src/core/auth/auth.ts`); kortet er rettet på dette punktet. Kommentaren sier også at delt innlogging med Optiplan (ADR i fase 0b) må holde samme regel.

## 6. Grep-kriterier (test-leder kjører i rapporten)

- `grep -c 'lower(' src/core/organization/employees-admin.ts` → 0
- `grep -c ' as {' src/core/email/resolve.ts` → 0
- `SENSITIVE_KEY` uten de elleve eksakte ordene (lest fra `src/shared/lib/logger.ts`)
- `grep -c 'rename' src/modules/offline-trial/server/photo-storage.ts` ≥ 1 og `writeFile` bare i hjelperen
- `git diff --name-only main` uten `.github/workflows/ci.yml`, `deploy-azure.yml`, `src/core/secrets.ts`, `src/shared/config/env.ts`, `e2e/`
- `"version": "0.2.60"` i `package.json`

## 7. Kart: akseptkriterium → test

| Akseptkriterium | Test |
|---|---|
| `lower(` borte, test 2 og ny test grønne | 3.5 test 2, 2b; grep |
| ` as {` borte, settings validert én gang, `resolve.test.ts`/`email.test.ts` grønne | resolve 1, 8b, 8c, 10; email 2; grep; typecheck |
| Elleve ord ut av `SENSITIVE_KEY`, `logger.test.ts` grønn uten fjernet/endret test | E1–E3 (nye), alle eksisterende; grep |
| Midlertidig fil og `rename` på begge skrivestedene, ingen `.tmp-` etter suksess og feil | T1, T2, T3, T5; grep «`writeFile` bare i hjelperen»; e2e «kopi som får 400» ×3 |
| `docs/05-domenemodell.md` ved `employee_permissions` | Avsnitt 5 |
| Test 16, 3.12 test 9 og `put`/`get`-spionene borte, ingen andre | Kartet i avsnitt 2; `it(`-telling mot `main` |
| Ingen fil under «Ikke med» endret | grep (avsnitt 6) |
| Versjon 0.2.60 | grep |
| Tenant-isolasjon: ingen ny spørring, eksisterende kall urørt | `tests/tenant-isolation-all-tables.test.ts` grønn; `git diff` viser ingen fjernet `expectTenantIsolation` |
| e2e pc og iPad grønne, «kopi som får 400» i begge | Avsnitt 4 |
| lint, typecheck, test, test:e2e grønne | Testrapporten |
