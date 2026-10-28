# Testplan: Testmiljø i Azure (forberedelse)

- **Oppgavekort:** `docs/funksjoner/fase1-testmiljo-azure.md`
- **Fase:** 1 – Prøve uten nett, første punkt
- **Branch:** `fase1-testmiljo-azure` (bygger på `main`)
- **Dato:** 28.10.2026
- **Laget av:** test-leder, før koding (runde 1). Navnene er bindende for testskriver. Utvikler leser avsnitt 8 «Krav til koden som testene bygger på».
- **Støtter hovedmål:** Tid. Uten testmiljø over https kan ikke synkløsningen (største tidsbesparelsen mot IVIT) prøves på ekte iPad. KI først: indirekte, testmiljøet er der KI-forslag senere vises og godkjennes.

## 0. Endringer etter prosjektleders avgjørelser (28.10.2026, overstyrer avsnittene under)

Prosjektleder rettet oppgavekortet etter forhåndsvurderingen. Der dette avsnittet og resten av planen er uenige, gjelder dette avsnittet og kortet.

- **`graph.test.ts` utgår.** Graph-adapteren er utsatt til fase 0b. `graph` kaster fortsatt feilen om fase 0b; én test i `email.test.ts` viser det (`sendEmail` med fire Graph-verdier → `rejects.toThrow(/fase 0b/)`, ingen `fetch`).
- **`logLine` i stedet for prefiks + tekst.** `Email` får `logLine?: string`; `auth.ts` setter den. `serverLog` skriver bare når `to` er lik `SEED_ADMIN_EMAIL` **og** `logLine` er satt. Ny test: «serverLog nekter når logLine mangler» (ingen utskrift, samme feil). Testene sender `logLine: "Engangskode til første admin: 123456 (gyldig i 10 minutter)"` og sjekker at utskriften inneholder `123456`, ikke `@`.
- **`sslmode=verify-full`**, ikke `require`, i Bicep-testen.
- **Ingen `PORT`/`WEBSITES_PORT`** i appinnstillingene; test at de **ikke** finnes. Test i tillegg `appCommandLine` med `node server.js` og `SCM_DO_BUILD_DURING_DEPLOYMENT`.
- **`main.bicepparam` finnes ikke.** Testen «parameterfilen har ingen verdier for hemmeligheter» utgår. Nye Bicep-tester: ingen `output` som inneholder `password`, `secret` eller `DATABASE_URL`; ingen `hostNameBindings`/`certificates` (bindingen gjøres i portalen).
- **Arbeidsflyten:** `permissions: {}` øverst og `id-token: write` bare i jobben `utrulling`; ingen `az group create`; `--output none` eller `--query` på `az deployment group create`; `::add-mask::` finnes; brannmurregelen heter `github-runner`.
- **Seed:** ny test i `src/db/seed/run.test.ts`: utskriften fra `runSeed` (spion på `console.log`) inneholder ikke `@`.
- **Dokumentasjonstesten:** stegene er (a)–(f); «Mail.Send» utgår. Krev i stedet «federated», `repo:Byggcon-sl/EzProp:ref:refs/heads/main`, «asuid», «Legg til på Hjem-skjerm», «Log stream» (eller `log tail`), `rand -hex 24`, «kr», «az group delete».
- **Avsnitt 8, punkt 2 (fetchImpl) og 6 (Graph-feil) utgår.** Resten av avsnitt 8 gjelder.

## 1. Hva som finnes fra før (og brukes)

- `src/core/email/email.test.ts`: tester `emailTransport` i dag (`none` → skal bli `serverLog`). Utvides, ikke erstattes.
- `src/core/health/health.test.ts` og `src/app/api/helse/route.test.ts`: bruker `packageJson.version`, må være grønne uten endring.
- `src/shared/lib/logger.test.ts`: må være grønn **uten endring** (test-leder sjekker `git diff main.. -- src/shared/lib/logger.ts` er tom).
- `src/db/seed/run.test.ts`: viser at seed er idempotent (brukes av utrullingsjobben).
- `tests/setup-env.ts` setter `DEV_MAILBOX=1` for alle tester. Tester for `serverLog` og `graph` må derfor sende inn egen `env` (se avsnitt 8, punkt 1) i stedet for å endre `process.env`.
- `tests/factories.ts`, `tests/tenant-isolation.ts`, `e2e/helpers.ts`: brukes ikke (ingen nye spørringer, ingen e2e-endring).
- Ingen `az` eller `bicep` i skymiljøet. Bicep kan ikke kompileres her; se avsnitt 7.

## 2. Enhetstester (Vitest, rene, ingen database, ingen nett)

### `src/core/email/email.test.ts` (utvides)

| Testnavn | Viser |
|---|---|
| «velger devMailbox når DEV_MAILBOX er på» | `emailTransport({ DEV_MAILBOX: true, … })` → `devMailbox`. |
| «velger graph når alle fire Microsoft 365-verdier er satt» | Fire verdier satt, `DEV_MAILBOX: false` → `graph`. |
| «velger serverLog når e-post ikke er satt opp» | `DEV_MAILBOX: false`, ingen Graph-verdier → `serverLog`. Typen `EmailTransport` har ikke lenger `none`, og `EMAIL_NOT_CONFIGURED` finnes ikke (typecheck feiler hvis den importeres). |
| «serverLog skriver koden for første admin, uten adressen» | `sendEmail({ to: "Admin@Example.com", subject, text: "Koden din er: 123456 …" }, env)` med `env.SEED_ADMIN_EMAIL = "admin@example.com"`. `vi.spyOn(console, "info")` kalt **nøyaktig én gang**; utskriften inneholder `123456` og `docs/drift/testmiljo-azure.md`, inneholder **ikke** `admin@example.com` eller `@`. Store bokstaver i mottaker skal ikke spille noen rolle. |
| «serverLog går ikke gjennom loggeren» | Samme kall: `console.log` og `console.error` kalles ikke, og utskriften er ikke JSON (`JSON.parse` kaster). Viser at vaskingen i `logger.ts` ikke er omgått og ikke brukt. |
| «serverLog nekter alle andre mottakere og skriver ingenting» | `to: "annen@example.com"` → `rejects.toThrow("E-post er ikke satt opp ennå")`. `console.info` ikke kalt. |
| «serverLog nekter når SEED_ADMIN_EMAIL mangler» | `env.SEED_ADMIN_EMAIL` udefinert → kaster samme feil, ingen utskrift. Hindrer at tom innstilling slipper alle inn. |
| «serverLog velges aldri når DEV_MAILBOX er på» | `env.DEV_MAILBOX = true` og Graph-verdier tomme → postkassen brukes (som i dag). |

### `src/core/email/graph.test.ts` (ny) – falsk `fetch`, ingen nettverkskall

Alle tester sender inn en `fetchImpl` (`vi.fn()`) som returnerer `new Response(...)`. Hvis utvikler heller bruker global `fetch`, brukes `vi.stubGlobal("fetch", …)` med `vi.unstubAllGlobals()` i `afterEach`. Ingen test får kalle ekte `fetch`.

| Testnavn | Viser |
|---|---|
| «henter token fra riktig tenant med klientlegitimasjon og Graph-scope» | Første kall går til `https://login.microsoftonline.com/<MS_GRAPH_TENANT_ID>/oauth2/v2.0/token`, `POST`, `content-type: application/x-www-form-urlencoded`, kroppen har `grant_type=client_credentials`, `client_id`, `client_secret` og `scope=https://graph.microsoft.com/.default` (URL-kodet). |
| «sender e-posten fra MAIL_FROM med riktig mottaker, emne og tekst» | Andre kall går til `https://graph.microsoft.com/v1.0/users/<MAIL_FROM>/sendMail`, `POST`, `Authorization: Bearer <token fra første svar>`, JSON-kropp med `message.subject`, `message.body.contentType === "Text"`, `message.body.content`, `message.toRecipients[0].emailAddress.address === to`, `saveToSentItems === false`. Nøyaktig to kall. |
| «kaster norsk feil uten svarinnhold når tokenkallet feiler» | Første svar `401` med kropp `{"error_description":"hemmelig@example.com"}` → `rejects.toThrow(/E-post via Microsoft 365/)`; feilmeldingen inneholder ikke `hemmelig@example.com`, ikke `401`-kroppen, ikke `MS_GRAPH_CLIENT_SECRET`. `sendMail` kalles ikke. |
| «kaster norsk feil uten svarinnhold når sendMail feiler» | Første svar OK, andre `500` med kropp som inneholder en e-postadresse → feil uten adressen. |
| «kaster norsk feil når nettverket feiler» | `fetchImpl` kaster `TypeError("fetch failed")` → norsk feil, ingen gjenforsøk (nøyaktig ett kall). |
| «ingen hurtiglagring av token» | To `sendEmail`-kall → fire `fetch`-kall (token hentes hver gang). Vokter «ingen hurtiglagring» i kortet. |

### `src/core/health/health.test.ts` (utvides)

| Testnavn | Viser |
|---|---|
| «viser commit etter versjonen når APP_VERSION er satt» | `vi.stubEnv("APP_VERSION", "abc1234")` → `appVersion() === \`${packageJson.version} (abc1234)\``. `vi.unstubAllEnvs()` i `afterEach`. Ikke hardkod `0.2.0`. |
| «ignorerer tom APP_VERSION» | `vi.stubEnv("APP_VERSION", "  ")` → bare `packageJson.version`. |

## 3. Tester av drift-filene som tekst (`tests/deploy-workflow.test.ts`, ny)

Leser filene med `node:fs` og sjekker med enkle regex. **Ingen YAML-pakke** (`js-yaml` ligger i `node_modules` via ESLint, men skal ikke importeres; ny avhengighet må begrunnes og er ikke ønsket).

Felles hjelper i testfilen: `secretNames(text)` = alle treff på `secrets\.([A-Z0-9_]+)`, `varNames(text)` = alle treff på `vars\.([A-Z0-9_]+)`.

### `.github/workflows/deploy-azure.yml`

| Testnavn | Viser |
|---|---|
| «kjører ved push til main og manuelt» | Har `push:` med `branches: [main]` (eller `- main`) og `workflow_dispatch:`. Ingen `pull_request:`. |
| «jobben sjekk gir klar, og utrulling kjører bare når klar er true» | Har jobb `sjekk:` med `outputs:` som inneholder `klar`, og jobb `utrulling:` med `needs: sjekk` (eller `needs: [sjekk]`) og `if: needs.sjekk.outputs.klar == 'true'`. Meldingen «hopper over utrullingen» finnes i filen. |
| «sjekk leser bare om AZURE_CLIENT_ID finnes, ikke verdien» | I jobben `sjekk` brukes `secrets.AZURE_CLIENT_ID` bare i en `env:`-linje eller et `!= ''`-uttrykk; ingen `echo` av verdien. |
| «bruker OIDC, ikke lagret Azure-passord» | Har `permissions:` med `id-token: write`, `azure/login` med `client-id`, `tenant-id`, `subscription-id`. Ingen `creds:`, ingen `AZURE_CREDENTIALS`. |
| «bruker bare de dokumenterte navnene på secrets og variabler» | `secretNames` ⊆ `{AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, POSTGRES_ADMIN_PASSWORD, BETTER_AUTH_SECRET, MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MAIL_FROM}` og `varNames` ⊆ `{SEED_ADMIN_EMAIL, APP_HOSTNAME}`. De fem påkrevde secrets og begge variablene **brukes**. |
| «ingen hemmeligheter som verdier» | Ingen linje matcher `/(password|secret|token)\s*[:=]\s*['"]?[A-Za-z0-9+/=]{8,}/i` uten `${{`. `DEV_MAILBOX` finnes ikke i filen. |
| «setter APP_VERSION til kort commit-id og sjekker /api/helse» | Har `APP_VERSION` og enten `github.sha` med kutting (`::7` / `cut -c1-7` / `substr`) eller `git rev-parse --short`. Har et steg som kaller `/api/helse` og feiler hvis svaret mangler commit-id (`grep`/`jq` på `versjon`). |
| «migrering og seed kjører fra arbeidsflyten med riktig miljø» | Har `pnpm db:migrate` og `pnpm db:seed`. Steget/jobben som kjører dem har `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` i `env:` (`getEnv()` krever alle tre). `pnpm install` kjøres **uten** `--prod` (migrering trenger `tsx` og `dotenv` fra devDependencies). |
| «brannmurregelen fjernes alltid» | Steget som fjerner regelen (`firewall-rule delete`) har `if: always()` og kommer etter migreringen. |
| «ingen to utrullinger samtidig» | Har `concurrency:`. |
| «kjører en Bicep-validering før utrullingen» | Har `az deployment group validate` (eller `az bicep build`) **før** `az deployment group create`. Erstatter kompilering som ikke er mulig i skyen. |

### `infra/azure/main.bicep` og `main.bicepparam`

| Testnavn | Viser |
|---|---|
| «ligger i Sweden Central» | `param location string = 'swedencentral'`. |
| «alle passord og hemmeligheter er @secure() og uten standardverdi» | Hver `param` hvis navn matcher `/password|secret/i` har `@secure()` på linjen før og ingen `=` etter typen. Gjelder `postgresAdminPassword`, `betterAuthSecret`, `msGraphClientSecret`. |
| «parameterfilen har ingen verdier for hemmeligheter» | `main.bicepparam`: linjer med `password`/`secret` har ingen literal (`'...'`) som verdi; bare `readEnvironmentVariable(...)`, kommentar eller utelatt. |
| «appen er bare https, TLS 1.2, med helsesjekk på /api/helse» | Har `httpsOnly: true`, `minTlsVersion: '1.2'`, `healthCheckPath: '/api/helse'`, `alwaysOn: true`, `linuxFxVersion` med `NODE|22`. |
| «databasen krever SSL og ligger i samme region» | Flexible Server har `version: '16'`, `location: location`, `geoRedundantBackup: 'Disabled'`, og `DATABASE_URL` inneholder `sslmode=require`. |
| «appinnstillingene er riktige og DEV_MAILBOX settes aldri» | Appinnstillingene har `NODE_ENV` = `production`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SEED_ADMIN_EMAIL`, `APP_VERSION`, `PORT`, `WEBSITES_PORT`. Teksten `DEV_MAILBOX` finnes ikke i noen fil under `infra/azure/`. |
| «ressursnavn bruker environmentName» | Ingen ressursnavn har `test` hardkodet uten `${environmentName}`; regex `/'(app|plan|psql|rg)-ezprop-test'/` gir 0 treff. |
| «ingen modellnavn eller produktnavn utenfor brand.ts» | Dekkes av lint for `src/`; for `infra/` og `.github/` sjekker test-leder for hånd (`grep -ri "claude\|gpt\|opus\|sonnet" infra .github`). |

### Dokumentasjon

| Testnavn | Viser |
|---|---|
| «driftsdokumentet nevner alle secrets og variabler arbeidsflyten bruker» | Hvert navn fra `secretNames(workflow)` og `varNames(workflow)` finnes som tekst i `docs/drift/testmiljo-azure.md`. Gjør «nøyaktige navn» etterprøvbart. |
| «driftsdokumentet har stegene, kostnad og sletting» | Inneholder «federated», «Mail.Send», «asuid», «Legg til på Hjem-skjerm», «Log stream» (eller `log tail`), «kr», «az group delete». |
| «utviklingsmiljø-dokumentet lenker til driftsdokumentet» | `docs/10-utviklingsmiljo.md` inneholder `docs/drift/testmiljo-azure.md`. |

## 4. Integrasjonstester mot testdatabasen

Ingen nye. Ingen tabeller, migreringer eller spørringer. Test-leder bekrefter i rapporten med `git diff --stat main.. -- src/db` (tom, bortsett fra eventuell kommentar) og `git diff --stat main.. -- src/core/access` (tom).

## 5. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | «serverLog nekter alle andre mottakere», «serverLog nekter når SEED_ADMIN_EMAIL mangler». | Ingen nye rettigheter. Eneste nye grense er «bare første admin kan få kode før e-post er satt opp», og den testes på begge sider. |
| Tenant-isolasjon | **Ikke relevant.** Ingen spørring tar `organizationId`. Ingen `expectTenantIsolation`. | Må stå med rene ord i PR-en. Legger utvikler til en spørring, kreves `expectTenantIsolation` i samme PR. |
| Admin stenges aldri ute | «serverLog skriver koden for første admin». | Første admin er den eneste som slipper inn før e-post. Andre admin-brukere finnes ikke i seed. Nevnes i PR-en som kjent begrensning til Microsoft 365 er på. |
| Myk sletting | **Ikke relevant.** Ingen data. | Nevnes i PR-en. |

## 6. Regeltester

Ingen. Ingen regler eller TG-logikk.

## 7. E2e (Playwright) og det som ikke kan testes i skyen

- **Ingen ny e2e.** Eksisterende `e2e/fase-0a.spec.ts` og `e2e/fase-1-testskjema.spec.ts` må være grønne i `pc` og `ipad`. `logIn` bruker fortsatt `/dev/epost`.
- `serverLog` og `graph` testes bare som enhetstester: Playwright bygger appen med `DEV_MAILBOX=1`, og vi skal ikke sende e-post fra tester.
- **Ikke testbart her (alvorlig restrisiko, må stå i PR-en og i rapporten):** Bicep kompileres ikke (ingen `az`/`bicep` i miljøet), ingen Azure-kall, ingen utrulling. Første grønne kjøring hos Ståle er den egentlige testen. Mottiltak: valideringssteget i arbeidsflyten (avsnitt 3), og `workflow_dispatch` så Ståle kan kjøre på nytt uten ny merge. Test-leder leser Bicep gjennom for hånd og sjekker mot Azure-ressurstypene (`Microsoft.Web/sites@…`, `Microsoft.DBforPostgreSQL/flexibleServers@…`).
- Ekte iPad Pro (Safari, hjemskjerm, https): Ståle, etter utrulling. «Ferdig»-kriteriet i kortet kan ikke krysses av av agentene.

## 8. Krav til koden som testene bygger på (til utvikler)

1. **`sendEmail(email, env = getEnv())`.** Valgfri `env` som andre parameter, samme mønster som `emailTransport(env)` og `runSeed(env)`. Da slipper testene å røre `process.env`/`resetEnvCache`, og `tests/setup-env.ts` (som setter `DEV_MAILBOX=1`) står urørt.
2. **Graph-adapteren tar `fetchImpl`** som siste parameter med `fetch` som standard: `sendViaGraph(email, env, fetchImpl = fetch)`. Ingen import av `node-fetch` eller lignende.
3. **Hva `serverLog` skriver.** `sendEmail` får emne og tekst, ikke selve koden. Kontrakten testene krever: utskriften inneholder **koden** (den står i `email.text`) og aldri `email.to`. Enkleste løsning uten parsing: skriv prefikset `[innlogging] Engangskode til første admin (e-post er ikke satt opp ennå, se docs/drift/testmiljo-azure.md):` fulgt av `email.text`. Vil utvikler ha én linje med bare koden, må koden sendes eksplisitt (f.eks. valgfritt felt `code` på `Email` som `auth.ts` fyller), ikke hentes med regex fra teksten.
4. **`console.info` direkte**, aldri `logger` (den fjerner `code`/`otp` og e-post med vilje). Ikke JSON.
5. **Feilen for andre mottakere** er en vanlig `Error` med meldingen «E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.». Innloggingssiden viser i dag en fast tekst («Vi klarte ikke å sende koden …») uansett serverfeil, og en `Error` fra `sendVerificationOTP` blir 500 uten melding. Det er **greit** for denne oppgaven; akseptkriteriet rettes til «`sendEmail` kaster feilen; innloggingssiden viser dagens generelle feilmelding» (ingen endring i `login-form.tsx`).
6. **Graph-feil:** én norsk melding som begynner med «E-post via Microsoft 365», uten statuskropp, uten adresser, uten hemmeligheter.
7. **Arbeidsflyten:** migrering/seed-steget har `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` i `env:`. Databasepassordet brukes i en URL, så dokumentasjonen skal be Ståle lage det med `openssl rand -hex 24` (bare bokstaver og tall, ingen `+/=` som må URL-kodes). `BETTER_AUTH_SECRET` kan fortsatt være `openssl rand -base64 32`.
8. **Bicep:** `@secure()` på egne linjer rett over parameteren, uten standardverdi. Ressursnavn bygges av `environmentName`.
9. `src/shared/lib/logger.ts` og `tests/setup-env.ts` endres ikke.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| Bicep finnes, ingen hemmelige verdier, `swedencentral` | Avsnitt 3, Bicep-tabellen |
| `deploy-azure.yml` gyldig, push til main, `sjekk`/`utrulling`, hopper over uten feil | Avsnitt 3, arbeidsflyt-tabellen (gyldig YAML: `pnpm format:check` kjører Prettier på YAML; i tillegg lest for hånd) |
| `APP_VERSION` = kort commit, helsesjekk feiler uten commit-id | «setter APP_VERSION …» |
| `emailTransport`: devMailbox / graph / serverLog; delvis satt feiler i `env.ts` | Tre første i `email.test.ts`; delvis satt: eksisterende test (test-leder sjekker at den finnes, ellers legges den til) |
| `serverLog`: første admin får én linje med kode uten adresse; andre får feil og ingenting skrives | Fire serverLog-tester |
| `graph` med falsk `fetch` | `graph.test.ts` |
| Loggeren uendret | `git diff` tom + `logger.test.ts` grønn |
| `/api/helse` viser `versjon (commit)` | `health.test.ts` «viser commit …» |
| Driftsdokument med (a)–(g), navn, kostnad, sletting; lenke fra `docs/10` | Dokumentasjonstabellen |
| ADR 0002 og `docs/06` «Hosting» | Test-leder leser for hånd (`grep -n "Hosting" docs/06-arkitektur.md`, `ls docs/adr/0002-*`) |
| Ingen «EzProp» i `src/`, ingen modellnavn, ingen nye avhengigheter, alle fire kommandoer grønne | `pnpm lint`, `git diff main.. -- package.json pnpm-lock.yaml` (bare versjon), `grep -ri` for modellnavn |
| Tenant-isolasjon: ikke relevant | Avsnitt 5, begrunnes i PR |
| iPad-størrelse: eksisterende e2e grønne | Avsnitt 7 |

## 10. Rapporten etterpå

Test-leder leverer: grønt/rødt per kommando, tabellen i avsnitt 9 fylt ut, funn merket **alvorlig** (stopper godkjenning: manglende test for admin-grensen i `serverLog`, hemmelig verdi i fil, `logger.ts` endret, ekte `fetch` i test, ny avhengighet) eller **lite** (tekst, navn, dokumentasjon). Bicep uten kompilering føres alltid som kjent restrisiko, ikke som funn.
