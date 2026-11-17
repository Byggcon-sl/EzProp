# Testplan: Rydding av innloggingsdata

- **Oppgavekort:** `docs/agenter/oppgaver/rydd-innloggingsdata.md`
- **Fase:** 2a («Rydding av innloggingsdata» under «Publisering, PDF og sending»)
- **Branch:** `rydd-innloggingsdata` (bygger på `main`)
- **Laget av:** test-leder, 17.11.2026 (før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** testene viser at ryddingen aldri sletter en gyldig økt eller kode, så ingen blir logget ut eller mister en kode midt i arbeidet, og at innloggingssperren virker som før.
  - **KI i bunnen:** ikke berørt. Testplanen sjekker at ingenting går gjennom `src/core/ai`.
  - **Færre reklamasjoner:** ikke direkte.

## Kort om omfanget

Ingen skjerm, ingen skjemaendring, ingen faste koder, ingen TG-regler. Testene er derfor mest integrasjonstester mot testdatabasen, enhetstester for hemmelighetssjekken, rutetester, tekstsjekker av arbeidsflyt og Bicep, og én liten e2e-test mot API-et.

**Fast tid i ryddetestene.** `purgeExpiredAuthData(now)` kalles med `NOW = 2000-01-01T00:00:00Z`, og testene lager egne rader rundt den tiden med oppdiktede e-poster på `example.com`. Testene sjekker bare egne rader (på id). Grensene i testene regnes fra de eksporterte konstantene, ikke fra egne tall, i tillegg til én test som låser selve tallene.

## 1. Regeltester: grensene som data

Grensene er konstanter med testsaker. Testsakene skrives som en tabell (`BOUNDARY_CASES`) i testfilen og kjøres med `it.each`, slik at nye grenser bare blir nye rader.

Fil: `src/core/auth/auth-cleanup.integration.test.ts`

| # | Test | Hva den viser |
|---|---|---|
| R1 | `retention constants match decision 10.11.2026` | `LOGIN_ATTEMPT_RETENTION_MS` og `EXPIRED_VERIFICATION_RETENTION_MS` er 24 t (86 400 000), `EXPIRED_SESSION_RETENTION_MS` er 30 d (2 592 000 000) |
| R2 | `login_attempts: created_at 1 ms before the 24 h limit is deleted` | `created_at = NOW − 24 t − 1 ms` slettes |
| R3 | `login_attempts: created_at exactly on the limit is kept` | `created_at = NOW − 24 t` står (strengt eldre) |
| R4 | `login_attempts: created_at 1 ms after the limit is kept` | `NOW − 24 t + 1 ms` står |
| R5 | `login_attempts: all kinds are deleted when old` | `code_requested`, `code_failed` og `login_succeeded` eldre enn grensen slettes alle |
| R6 | `verifications: expires_at 1 ms before the 24 h limit is deleted` | Slettes |
| R7 | `verifications: expires_at exactly on the limit is kept` | Står |
| R8 | `verifications: old created_at but valid expires_at is kept` | Grensen måles fra `expires_at`, ikke `created_at` (A421) |
| R9 | `sessions: expires_at 1 ms before the 30 d limit is deleted` | Slettes |
| R10 | `sessions: expires_at exactly on the limit is kept` | Står |
| R11 | `sessions: expired less than 30 days ago is kept` | `expires_at = NOW − 29 d` står |
| R12 | `sessions: renewed session is kept` | Økt med gammel `created_at` og `expires_at` flyttet fram (fornyet) står |
| R13 | `sessions: old created_at but valid expires_at is kept` | Grensen måles fra `expires_at` (A421) |

## 2. Integrasjonstester: ryddefunksjonen

Samme fil, `src/core/auth/auth-cleanup.integration.test.ts`.

| # | Test | Hva den viser |
|---|---|---|
| I1 | `valid one-time codes are kept` | Kode med `expires_at` etter `NOW` står |
| I2 | `valid Microsoft login state row is kept` | State-rad i `verifications` for en pågående Microsoft-runde (gyldig `expires_at`) står |
| I3 | `valid sessions are kept` | Økt med `expires_at` etter `NOW` står |
| I4 | `counters younger than 24 h are kept` | Tellere med `created_at` innenfor 24 t står |
| I5 | `active throttle still blocks after cleanup` | Lag `MAX_FAILED_CODES` feilforsøk rett før `NOW`, kjør ryddingen, kall `checkAndRecordAttempt(email, "sign_in", NOW)`: fortsatt sperret med samme grunn |
| I6 | `returns counts per table` | Resultatet har riktige tall for egne rader og `durationMs ≥ 0`, og bare de fire feltene |
| I7 | `second run deletes nothing` | Idempotens: andre kjøring med samme `NOW` gir 0, 0, 0 |
| I8 | `runs in one transaction` | Feiler sletting i én tabell (stubbet), står radene i de andre tabellene urørt |
| I9 | `only the three auth tables are touched` | Rader i `users`, `accounts` og `employees` er urørt, også for brukere der alle økter og koder ble slettet |
| I10 | `accounts with tokens are kept` | `accounts` med tilgangs- og oppfriskingstoken (oppdiktet) står uendret etter rydding |
| I11 | `default now is the app clock` | Uten argument brukes `new Date()` (falsk klokke med `vi.useFakeTimers`/`vi.setSystemTime` satt til `NOW`, samme resultat som med `NOW`) |
| I12 | `does not import Better Auth` | Statisk: `auth-cleanup.ts` importerer bare `@/db/client`, `@/db/schema` og loggeren, aldri `./auth`, `better-auth` eller `@/core/ai` |

### Tilgang og tenant-isolasjon (to organisasjoner)

Tabellene har ingen `organization_id`, så `expectTenantIsolation` gjelder ikke og tabellene føres ikke i `tests/tenant-tables.ts`. I stedet:

| # | Test | Hva den viser |
|---|---|---|
| T1 | `two organizations: users, accounts and employees untouched` | Org A og org B med én ansatt hver (`createOrganization`, `createUser`, `createEmployee`). Etter rydding finnes alle `users`, `accounts` og `employees` i begge |
| T2 | `two organizations: sessions are cleaned by time only` | Én gammel utløpt og én gyldig økt i hver org. Bare de gamle slettes, i begge org, uavhengig av organisasjon |
| T3 | `cleanup has no condition on user, email hash or organization` | Statisk: `auth-cleanup.ts` har ingen `eq(`/`inArray(` på `userId`, `emailHash`, `identifier` eller `organizationId`; bare `lt(` på tidskolonnene |
| T4 | `admin keeps access after cleanup` (regel 11) | Admin i org A med gyldig økt: økten, brukeren og kontoen står; `checkAndRecordAttempt` for admin er tillatt når de gamle tellerne er ryddet |
| T5 | `tenant registry unchanged` | `tests/tenant-isolation-all-tables.test.ts` og `tests/factories.test.ts` grønne uten endring i `tests/tenant-tables.ts` og `RESET_TABLES` |

### Logging

| # | Test | Hva den viser |
|---|---|---|
| L1 | `logs one info line with counts and duration` | Nøyaktig én infolinje med antall per tabell, `durationMs` og utfall |
| L2 | `info log has no personal data` | Loggen inneholder ikke e-posten, e-post-hashen, token, IP, user agent eller bruker-id fra testradene (sjekkes mot hver kjent verdi) |
| L3 | `database error is logged with reference code only` | Databasefeil med parametre som inneholder e-post, hash, token og IP (stubbet): én feillinje med referansekode, ingen av verdiene, og funksjonen kaster videre |

## 3. Enhetstester: hemmelighetssjekken

Fil: `src/core/access/operations-secret.test.ts`. Hemmeligheten settes med `vi.stubEnv` og `resetEnvCache()`. Oppdiktet verdi på minst 32 tegn.

| # | Test | Hva den viser |
|---|---|---|
| S1 | `false when secret is not set` | Usann |
| S2 | `false when secret is shorter than 32 chars` | Usann, også med riktig header |
| S3 | `true when secret is exactly 32 chars and header matches` | Grensen 32 er lov |
| S4 | `false when secret is an unresolved key vault reference` | Usann, også om headeren er lik referanseteksten |
| S5 | `false without header` | `null` gir usann |
| S6 | `false with wrong secret` | Usann |
| S7 | `false with wrong length` | Lengre og kortere verdi enn riktig gir usann, uten unntak |
| S8 | `false without Bearer prefix or with other scheme` | `Basic …`, bare verdien, `bearer` med feil form gir usann |
| S9 | `true with correct Bearer header` | Sann |
| S10 | `warns with name only on bad setup` | For kort og uløst referanse gir én advarsel med `AUTH_CLEANUP_SECRET`, aldri verdien |
| S11 | `does not use readSecret, no database import, uses timingSafeEqual` | Statisk: `operations-secret.ts` importerer ikke `@/db`, `@/core/integrations` eller `readSecret`; bruker `getEnv`, `createHash("sha256")` og `timingSafeEqual` |
| S12 | `exported from @/core/access` | `verifyOperationsSecret` kan importeres fra `@/core/access` |

## 4. Rutetester: endepunktet

Fil: `src/app/api/intern/rydd-innloggingsdata/route.test.ts` (mot testdatabasen, handleren kalles direkte).

| # | Test | Hva den viser |
|---|---|---|
| E1 | `404 when secret is not set` | Status 404, `Cache-Control: no-store`, ingen ryddekjøring (rader står) |
| E2 | `404 without Authorization header` | Samme svar som E1 (lik kropp) |
| E3 | `404 with wrong secret` | Samme svar som E1 |
| E4 | `404 when secret is too short or unresolved reference` | Feil oppsett slår av endepunktet |
| E5 | `200 with correct secret returns counts only` | Kroppen har nøyaktig nøklene `loginAttempts`, `verifications`, `sessions`, `durationMs`; `no-store` |
| E6 | `ignores body and query parameters` | Kall med body `{ "now": "2100-01-01", "retentionMs": 0 }` og `?now=2100-01-01`: nye rader (1 t gamle) står; grensene kan ikke styres utenfra |
| E7 | `only POST is exported` | Modulen eksporterer `POST` og ikke `GET`, `PUT`, `PATCH`, `DELETE` (Next gir da 405); `dynamic === "force-dynamic"` |
| E8 | `500 without details on failure` | Ryddefunksjonen kaster (stubbet): 500, `no-store`, kroppen har ingen feiltekst |
| E9 | `rejected call is logged without headers or IP` | Advarselen inneholder ikke hemmeligheten, `authorization`, `x-forwarded-for` eller IP fra forespørselen |
| E10 | `logged-in admin without secret gets 404` | En gyldig admin-økt (cookie) gir ingen tilgang; bare driftshemmeligheten gjelder |
| E11 | `route imports only access and auth-cleanup` | Statisk: ruten importerer bare `@/core/access` og `@/core/auth/auth-cleanup` (og `next/server`), ingen `@/db` |

## 5. Oppsett, hemmeligheter og drift

| # | Fil | Test | Hva den viser |
|---|---|---|---|
| C1 | `src/shared/config/env.test.ts` | `AUTH_CLEANUP_SECRET is optional` | Uten verdi og med tom verdi kaster ikke `getEnv()` |
| C2 | samme | `short or unresolved AUTH_CLEANUP_SECRET does not stop the app` | For kort og uløst nøkkelboks-referanse: `getEnv()` kaster ikke (regel 11, admin kan logge inn) |
| C3 | `src/core/integrations/secrets.test.ts` | `AUTH_CLEANUP_SECRET is denied` | Står i `DENIED_SECRET_REFS`; `readSecret("AUTH_CLEANUP_SECRET")` avvises; ingen tilkobling kan peke på den |
| C4 | `tests/auth-cleanup-workflow.test.ts` (eller nytt `describe` i `tests/deploy-workflow.test.ts`) | `scheduled workflow` | `.github/workflows/rydd-innloggingsdata.yml` har `schedule` og `workflow_dispatch`, `permissions: {}`, hemmeligheten via `env:` (ikke i `run:`-linjen), ingen `set -x`, `curl --fail --silent --show-error -X POST`, ingen `-v`/`-i`/`--include`/`--trace` |
| C5 | samme | `skips without error when secret or url missing` | Arbeidsflyten har en sjekk som avslutter med 0 når hemmelighet eller adresse mangler (samme mønster som «Utrulling til Azure») |
| C6 | samme | `same GitHub secret as deploy, no production url` | Samme `secrets.`-navn i begge arbeidsflytene; adressen er testmiljøets; ingen produksjonsadresse |
| C7 | samme | `Bicep and deploy carry AUTH_CLEANUP_SECRET` | `infra/azure/main.bicep` har parameter, betinget hemmelighet i nøkkelboksen og appinnstilling `AUTH_CLEANUP_SECRET` (som `ANTHROPIC_API_KEY`); `deploy-azure.yml` sender parameteren |
| C8 | `.env.example` | lesing | Tom linje `AUTH_CLEANUP_SECRET=` med forklaring, ingen verdi |
| C9 | `tests/no-model-names.test.ts`, lint | eksisterende | Ingen modellnavn, produktnavnet bare i `brand.ts` |

## 6. E2e (Playwright)

Ingen skjerm, så det finnes ingen iPad-visning eller uten-nett-oppførsel å teste (oppgavekortet: «gjelder ikke»). Én kort API-test kjøres i begge prosjektene (PC og iPad-størrelse) fordi den er billig og viser at det bygde programmet oppfører seg som rutetestene:

Fil: `e2e/fase-2a-rydd-innloggingsdata.spec.ts`

| # | Test | Hva den viser |
|---|---|---|
| P1 | `cleanup endpoint is hidden without secret` | `POST /api/intern/rydd-innloggingsdata` uten header gir 404 og `no-store` (e2e-miljøet setter ikke `AUTH_CLEANUP_SECRET` i `playwright.config.ts`) |
| P2 | `GET is rejected` | `GET` gir 405 (eller 404), aldri 200 |
| P3 | `login still works` | Eksisterende innloggingstester (`fase-0b-sperre-innlogging.spec.ts`, `fase-1-prove-f-innlogging.spec.ts`, `fase-2a-microsoft-innlogging.spec.ts`) er grønne uendret |

Settes hemmeligheten i `playwright.config.ts`, må den være oppdiktet, minst 32 tegn, og P1 utvides med 200-kall. Ellers skal den ikke settes.

## 7. Dokumentsjekker (gjennomgang)

| # | Sjekk |
|---|---|
| D1 | `docs/adr/0014-rydding-av-innloggingsdata.md` finnes og har alle punktene i oppgavekortet, del 6 (unntaket bare for tre tabeller, hjemmel «til gjennomgang», oppbevaringstider, ingen indeks, kjøremåte og forkastede valg, drift, forbehold om Optiplan) |
| D2 | A419–A422 står i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte»), med «lett/dyrt å endre». Spørsmålet om innloggingshistorikk er ført som spørsmål |
| D3 | `docs/05-domenemodell.md`: `login_attempts` sier ikke lenger «Radene endres aldri» uten unntak; unntaket med henvisning til ADR 0014; ordlisten har `auth_cleanup` og `operations secret` |
| D4 | `docs/06-arkitektur.md` henviser til ADR 0014 ved myk sletting |
| D5 | Kommentarene i `src/core/auth/login-throttle.ts` og `src/db/schema/auth.ts` sier ikke lenger «ingenting slettes» (`grep -n "slettes" ...`) |
| D6 | `docs/drift/testmiljo-azure.md` har eget avsnitt med alle punktene i oppgavekortet, del 7 |
| D7 | `docs/agenter/tilstand.md` har under «Trenger Ståle når han er tilbake»: legg inn GitHub-secret, kjør utrullingen på nytt, bekreft unntaket fra myk sletting |
| D8 | `CLAUDE.md` regel 3 er ikke skrevet om |
| D9 | Ingen migrering i diffen (`git diff --stat main -- src/db/migrations` tom) |
| D10 | Versjonen i `package.json` er én patch over `main` |
| D11 | Ingen hemmelighet, ekte e-post eller kundeopplysning i diffen |

## 8. Kommandoer før godkjenning

| # | Kommando | Krav |
|---|---|---|
| K1 | `pnpm lint` | Grønn (modulgrenser, produktnavn) |
| K2 | `pnpm typecheck` | Grønn |
| K3 | `pnpm test` | Grønn, med alle nye tester over |
| K4 | `pnpm test:e2e` | Grønn på PC og iPad-størrelse |

## Avvises hvis

- Testene for to organisasjoner (T1–T2), admin (T4) eller hemmelighetssjekken (S1–S9) mangler.
- Ryddetestene bruker dagens tid i stedet for fast `NOW`, eller sjekker andre rader enn sine egne.
- Endepunktet svarer noe annet enn 404 for et kall som ikke er godkjent, eller kan styres med body eller adresseparametre.
- Loggen kan inneholde e-post, hash, token, IP, user agent, bruker-id eller hemmeligheten.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Sletting etter 24 t / 30 d, grensen står | R1–R13 |
| Gyldige koder (også Microsoft), økter og nye tellere står; sperren virker | I1–I5, R12 |
| `users`, `accounts`, `employees` urørt i to org; økter etter tid | T1–T3, I9–I10 |
| Idempotent | I7 |
| Logg bare antall og tid, også ved feil | L1–L3 |
| 404 uten hemmelighet, header eller med feil; bare POST; ingen inndata; `no-store` | E1–E7, P1–P2 |
| Hemmelighetssjekk i `src/core/access`, uten database, `getEnv`, hash + `timingSafeEqual` | S1–S12 |
| Feil oppsett slår av endepunktet, ikke appen; `DENIED_SECRET_REFS`; Bicep og utrulling | C1–C3, C7, E4 |
| Planlagt arbeidsflyt | C4–C6 |
| ADR, drift og rettede dokumenter | D1–D8 |
| Lint, typecheck, test, e2e; versjon | K1–K4, D10 |
