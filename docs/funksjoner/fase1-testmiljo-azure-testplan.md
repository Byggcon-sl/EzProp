# Testplan: Testmiljø i Azure (forberedelse)

- **Oppgavekort:** `docs/funksjoner/fase1-testmiljo-azure.md`
- **Fase:** 1 – Prøve uten nett, første punkt
- **Branch:** `fase1-testmiljo-azure` (bygger på `main`)
- **Dato:** 28.10.2026 (runde 2, samlet versjon; erstatter runde 1 og avsnitt 0 fra den)
- **Laget av:** test-leder, før koding. Navnene er bindende for testskriver. Utvikler og arkitekt leser avsnitt 8 «Krav til koden som testene bygger på».
- **Støtter hovedmål:** Tid. Uten testmiljø over https kan ikke synkløsningen (største tidsbesparelsen mot IVIT) prøves på ekte iPad. KI først: indirekte, testmiljøet er der KI-forslag senere vises og godkjennes.

## 0. Hva runde 2 endret (for prosjektleder)

Sjekket mot koden på `main` 28.10.2026:

- **Kortet sier «Delvis satt kaster fortsatt feil i `env.ts` (eksisterende test)». Den testen finnes ikke** (`grep` i `src` og `tests` gir 0 treff). Den legges til nå, i ny fil `src/shared/config/env.test.ts` (avsnitt 2). Kortet bør rette ordet «eksisterende» til «ny».
- **Kriteriet «`auth.ts` setter `logLine` med koden og uten adresse» var ikke testbart** slik `auth.ts` er bygd (e-posten lages inne i `sendVerificationOTP` i `betterAuth({...})`, som trenger database ved import). Krav til utvikler: den rene funksjonen `otpEmail(to, otp)` i `src/core/auth/otp-email.ts` (avsnitt 8, punkt 2). Da får kriteriet en enhetstest.
- **`sslmode=verify-full` er bekreftet riktig:** i `postgres` 3.4.9 slår bare `require`, `prefer` og `allow` av sertifikatsjekken; `verify-full` bruker Nodes vanlige sjekk. Ingen endring, men står her så arkitekt slipper å lete.
- **Testen «ingen hemmeligheter som verdier» i arbeidsflyten er gjort presis:** bygget skal bruke nøyaktig samme oppdiktede `BETTER_AUTH_SECRET` som `ci.yml`, og testen sammenligner med `ci.yml` i stedet for en løs regex som kan slå til på det oppdiktede.
- Stale rader fra runde 1 er fjernet (`graph.test.ts`, `main.bicepparam`, `sslmode=require`, `PORT`/`WEBSITES_PORT` som påkrevde, «Mail.Send», steg (g)).
- Tre merknader til arkitekt om arbeidsflyten som ikke kan testes her, men som gir rød første kjøring hos Ståle hvis de glipper (avsnitt 7).

## 1. Hva som finnes fra før (og brukes)

- `src/core/email/email.test.ts`: tester `emailTransport` i dag (`none` → skal bli `serverLog`). Utvides, ikke erstattes. Dagens test «velger tjeneste ut fra innstillingene» endres fra `"none"` til `"serverLog"`.
- `src/core/health/health.test.ts` og `src/app/api/helse/route.test.ts`: bruker `packageJson.version` og `appVersion()`, må være grønne uten endring.
- `src/shared/lib/logger.test.ts`: må være grønn **uten endring** (test-leder sjekker `git diff main.. -- src/shared/lib/logger.ts` er tom).
- `src/db/seed/run.test.ts`: viser at seed er idempotent (brukes av utrullingsjobben). Utvides med én test.
- `tests/setup-env.ts` setter `DEV_MAILBOX=1` for alle tester og endres ikke. Tester for `serverLog` og `graph` sender derfor inn egen `env` til `sendEmail(email, env)`. Testen for delvis Graph-oppsett må gå via `process.env`, og bruker `vi.stubEnv` + `resetEnvCache()` med opprydding i `afterEach` (`vi.unstubAllEnvs()` og `resetEnvCache()`).
- `tests/factories.ts`, `tests/tenant-isolation.ts`, `e2e/helpers.ts`: brukes ikke (ingen nye spørringer, ingen e2e-endring).
- Ingen `az` eller `bicep` i skymiljøet. Bicep kan ikke kompileres her; se avsnitt 7.

## 2. Enhetstester (Vitest, rene, ingen database, ingen nett)

### `src/core/email/email.test.ts` (utvides)

Felles `env` i testene: `{ DEV_MAILBOX: false, SEED_ADMIN_EMAIL: "admin@example.com", … } as Env` (små bokstaver, slik `env.ts` leverer). `logLine` i testene: `"Engangskode til første admin: 123456 (gyldig i 10 minutter)"`.

| Testnavn | Viser |
|---|---|
| «velger devMailbox når DEV_MAILBOX er på» | `emailTransport({ DEV_MAILBOX: true, … })` → `devMailbox`, også når de fire Graph-verdiene er satt. |
| «velger graph når alle fire Microsoft 365-verdier er satt» | Fire verdier satt, `DEV_MAILBOX: false` → `graph`. |
| «velger serverLog når e-post ikke er satt opp» | `DEV_MAILBOX: false`, ingen Graph-verdier → `serverLog`. Typen `EmailTransport` har ikke lenger `none`, og `EMAIL_NOT_CONFIGURED` finnes ikke (typecheck feiler om den importeres; testskriver sjekker at ingen fil i `src` nevner den: `grep -rn EMAIL_NOT_CONFIGURED src` gir 0 treff). |
| «graph kaster fortsatt feilen om fase 0b» | `sendEmail(email, envMedFireGraphVerdier)` → `rejects.toThrow(/fase 0b/)`. Ingen `fetch` kalles (`vi.spyOn(globalThis, "fetch")` ikke kalt). |
| «serverLog skriver koden for første admin, uten adressen» | `sendEmail({ to: "Admin@Example.com", subject, text, logLine }, env)`. `vi.spyOn(console, "info").mockImplementation(() => {})` kalt **nøyaktig én gang**; linjen inneholder `123456`, `[innlogging]` og `docs/drift/testmiljo-azure.md`, og inneholder **ikke** `@` (dermed heller ikke adressen). Store bokstaver i mottaker spiller ingen rolle. |
| «serverLog går ikke gjennom loggeren» | Samme kall: `console.log` og `console.error` kalles ikke, og `JSON.parse(linjen)` kaster. Viser at vaskingen i `logger.ts` verken er brukt eller omgått. |
| «serverLog nekter alle andre mottakere og skriver ingenting» | `to: "annen@example.com"` → `rejects.toThrow("E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.")`. `console.info` ikke kalt. |
| «serverLog nekter når SEED_ADMIN_EMAIL mangler» | `env.SEED_ADMIN_EMAIL` udefinert, `to` hva som helst → samme feil, ingen utskrift. Hindrer at tom innstilling slipper alle inn. |
| «serverLog nekter når logLine mangler» | Riktig mottaker, ingen `logLine` → samme feil, ingen utskrift. Hindrer at e-posttekst (med adresse) noen gang havner i loggen. |
| «serverLog skriver aldri hele e-posten» | Riktig mottaker, `text: "Koden din er: 999999 …"` og `logLine` med `123456` → linjen inneholder `123456` og **ikke** `999999`. Viser at bare `logLine` skrives. |

### `src/core/email/server-log.test.ts` (ny, tester adapteren direkte)

| Testnavn | Viser |
|---|---|
| «skriver én linje med egen skriver» | `createServerLogSender("admin@example.com", write)` med `write = vi.fn()`; riktig mottaker og `logLine` → `write` kalt én gang, med linjen `[innlogging] <logLine>. E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md`. |
| «feilmeldingen avslører ikke hvem første admin er» | Feil mottaker → `error.message` inneholder ikke `admin@example.com` og ikke `@`. |

### `src/core/auth/otp-email.test.ts` (ny)

| Testnavn | Viser |
|---|---|
| «e-posten med engangskode har koden i tekst og logLine, men ikke adressen i logLine» | `otpEmail("Bruker@Example.com", "123456")` → `to === "Bruker@Example.com"`, `text` inneholder `123456`, `logLine` inneholder `123456` og `10 minutter`, `logLine` inneholder **ikke** `@`, og `subject` inneholder produktnavnet fra `brand`. |

### `src/shared/config/env.test.ts` (ny)

Bruker `vi.stubEnv` og `resetEnvCache()`; `afterEach`: `vi.unstubAllEnvs(); resetEnvCache()`. `tests/setup-env.ts` endres ikke.

| Testnavn | Viser |
|---|---|
| «delvis Microsoft 365-oppsett stopper oppstarten» | `MS_GRAPH_TENANT_ID=t`, de andre tre tomme → `getEnv()` kaster `/bare delvis satt opp/`. |
| «alle fire Microsoft 365-verdier sammen godtas» | Alle fire satt → `getEnv()` kaster ikke, og `emailTransport(getEnv())` er `devMailbox` (fordi `DEV_MAILBOX=1` i tester) – viser at postkassen alltid vinner lokalt. |
| «SEED_ADMIN_EMAIL leveres med små bokstaver» | `SEED_ADMIN_EMAIL=" Admin@Example.com "` → `getEnv().SEED_ADMIN_EMAIL === "admin@example.com"`. Grunnlaget for sammenligningen i `serverLog`. |

### `src/core/health/health.test.ts` (utvides)

| Testnavn | Viser |
|---|---|
| «viser commit etter versjonen når APP_VERSION er satt» | `vi.stubEnv("APP_VERSION", "abc1234")` → `appVersion() === \`${packageJson.version} (abc1234)\``. `vi.unstubAllEnvs()` i `afterEach`. Ikke hardkod `0.2.0`. |
| «ignorerer tom APP_VERSION» | `vi.stubEnv("APP_VERSION", "  ")` → bare `packageJson.version`. |

## 3. Tester av drift-filene som tekst (`tests/deploy-workflow.test.ts`, ny)

Leser filene med `node:fs` (sti fra `process.cwd()`) og sjekker med enkle regex. **Ingen YAML-pakke** (`js-yaml` ligger i `node_modules` via ESLint, men skal ikke importeres; ny avhengighet må begrunnes og er ikke ønsket).

Felles hjelpere i testfilen: `secretNames(text)` = alle treff på `secrets\.([A-Z0-9_]+)`, `varNames(text)` = alle treff på `vars\.([A-Z0-9_]+)`, `after(text, a, b)` = `text.indexOf(a) < text.indexOf(b)` (begge må finnes).

### `.github/workflows/deploy-azure.yml`

| Testnavn | Viser |
|---|---|
| «kjører ved push til main og manuelt» | Har `push:` med `branches: [main]` (eller `- main`) og `workflow_dispatch:`. Ingen `pull_request:`. |
| «ingen to utrullinger samtidig» | Har `concurrency:`. |
| «rettigheter er minst mulig» | Første `permissions:` i filen er `permissions: {}`. `id-token: write` forekommer nøyaktig én gang, og etter `utrulling:`. |
| «jobben sjekk gir klar, og utrulling kjører bare når klar er true» | Har jobb `sjekk:` med `outputs:` som inneholder `klar`, og jobb `utrulling:` med `needs: sjekk` (eller `needs: [sjekk]`) og `if: needs.sjekk.outputs.klar == 'true'`. Teksten «hopper over utrullingen» finnes. |
| «sjekk leser bare om AZURE_CLIENT_ID finnes, ikke verdien» | `secrets.AZURE_CLIENT_ID != ''` finnes. Ingen linje har både `echo` og `AZURE_CLIENT_ID` uten `klar`/`!= ''`. |
| «bruker OIDC, ikke lagret Azure-passord» | `azure/login` med `client-id`, `tenant-id`, `subscription-id`. Ingen `creds:`, ingen `AZURE_CREDENTIALS`. |
| «lager ikke ressursgruppen» | Ingen `az group create`. |
| «bruker bare de dokumenterte navnene på secrets og variabler» | `secretNames` ⊆ `{AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, POSTGRES_ADMIN_PASSWORD, BETTER_AUTH_SECRET, MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MAIL_FROM}` og `varNames` ⊆ `{SEED_ADMIN_EMAIL, APP_HOSTNAME}`. De fem påkrevde secrets og begge variablene **brukes**. |
| «bygget bruker de oppdiktede verdiene fra ci.yml, ikke ekte secrets» | Linjen `BETTER_AUTH_SECRET: <verdi>` uten `${{` i `deploy-azure.yml` har nøyaktig samme verdi som i `ci.yml` (testen leser `ci.yml` og sammenligner). `DEV_MAILBOX` finnes **ikke** i `deploy-azure.yml` (bygget i drift skal ikke ha postkassen; `BETTER_AUTH_URL` for bygget er `http://localhost:3000` som i `ci.yml`). |
| «ingen hemmeligheter som verdier» | Ingen linje matcher `/(POSTGRES_ADMIN_PASSWORD|MS_GRAPH_CLIENT_SECRET|AZURE_CLIENT_ID|AZURE_TENANT_ID|AZURE_SUBSCRIPTION_ID)\s*:\s*[^$\s]/` (altså: disse får bare `${{ secrets.… }}`). |
| «Bicep valideres før den rulles ut, uten hemmelige utskrifter» | `az deployment group validate` kommer før `az deployment group create`. Linjen/blokken med `create` har `--output none` eller `--query`. |
| «DATABASE_URL maskeres før bruk» | `::add-mask::` finnes og kommer før `pnpm db:migrate`. |
| «migrering og seed kjører fra arbeidsflyten med riktig miljø» | Har `pnpm db:migrate` og `pnpm db:seed`. Teksten mellom `db:migrate`-steget og neste `- name:` (eller samme steg) har `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` under `env:`. Enklere variant godtas: de tre navnene finnes i en `env:`-blokk innen 15 linjer før `pnpm db:migrate`. `pnpm install` finnes og ingen forekomst av `--prod`. |
| «brannmurregelen for kjøreren fjernes alltid» | `firewall-rule create` med `github-runner` kommer før `db:migrate`; `firewall-rule delete` med `github-runner` kommer etter `db:seed` og har `if: always()` innen 3 linjer. |
| «setter APP_VERSION til kort commit-id og sjekker /api/helse» | `APP_VERSION` finnes, og enten `GITHUB_SHA::7`, `github.sha` med `substr`/`cut -c1-7`, eller `git rev-parse --short`. Et steg etter `webapps-deploy` kaller `/api/helse` og nevner `versjon` sammen med `grep`/`jq`/`exit 1` (feiler uten commit-id). |
| «zip lages fra innsiden av standalone» | `.next/standalone/.next/static` og `.next/standalone/public` finnes, og `zip` kjøres i `.next/standalone` (`cd .next/standalone` eller `working-directory: .next/standalone`). |

### `infra/azure/main.bicep`

| Testnavn | Viser |
|---|---|
| «ligger i Sweden Central» | `param location string = 'swedencentral'`. |
| «alle passord og hemmeligheter er @secure() og uten standardverdi» | Hver `param` hvis navn matcher `/password|secret/i` har `@secure()` på linjen før og ingen `=` på param-linjen. Gjelder minst `postgresAdminPassword`, `betterAuthSecret`, `msGraphClientSecret`. |
| «ingen hemmelige utdata» | Ingen linje som starter med `output` inneholder `password`, `secret`, `DATABASE_URL` eller `connectionString` (uavhengig av store bokstaver). |
| «ingen hostname-binding eller sertifikat» | Ingen `hostNameBindings`, ingen `Microsoft.Web/certificates`. |
| «appen er bare https, TLS 1.2, med helsesjekk, alltid på» | `httpsOnly: true`, `minTlsVersion: '1.2'`, `healthCheckPath: '/api/helse'`, `alwaysOn: true`, `linuxFxVersion` med `NODE|22`, `appCommandLine` med `node server.js`. |
| «ingen bygging på serveren» | `SCM_DO_BUILD_DURING_DEPLOYMENT` med verdien `false`. |
| «databasen er PostgreSQL 16 i samme region uten geo-kopi, og krever sertifikatsjekk» | Flexible Server har `version: '16'`, `location: location`, `geoRedundantBackup: 'Disabled'`; `DATABASE_URL` inneholder `sslmode=verify-full` og ikke `sslmode=require`. Passordet går gjennom `uriComponent(`. |
| «appinnstillingene er riktige, og DEV_MAILBOX og PORT settes aldri» | Har `NODE_ENV` med `production`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SEED_ADMIN_EMAIL`, `APP_VERSION`. Ingen forekomst av `DEV_MAILBOX`, `PORT` eller `WEBSITES_PORT` i noen fil under `infra/azure/` (`PORT` sjekkes som helt ord). |
| «BETTER_AUTH_URL følger appHostname» | `appHostname` brukes i uttrykket for `BETTER_AUTH_URL`, med `azurewebsites.net` som reserve (begge tekstene finnes i samme eller nærliggende linjer; `empty(appHostname)` godtas). |
| «ressursnavn bruker environmentName» | `ezprop-test` forekommer ikke i filen (heller ikke i kommentarer; dokumentasjonen peker motsatt vei). `${environmentName}` brukes i navnet på plan, app og database. |
| «ingen verdier for hemmeligheter» | Ingen linje matcher `/(password|secret)\w*\s*:\s*'[^']{8,}'/i`. |

### Dokumentasjon

| Testnavn | Viser |
|---|---|
| «driftsdokumentet nevner alle secrets og variabler arbeidsflyten bruker» | Hvert navn fra `secretNames(workflow)` og `varNames(workflow)` finnes som tekst i `docs/drift/testmiljo-azure.md`. Gjør «nøyaktige navn» etterprøvbart. |
| «driftsdokumentet har stegene, kostnad og sletting» | Inneholder `rg-ezprop-test`, «federated», `repo:Byggcon-sl/EzProp:ref:refs/heads/main`, «Contributor», `rand -hex 24`, `rand -base64 32`, «Log stream» (eller `log tail`), «Legg til på Hjem-skjerm», «asuid», `APP_HOSTNAME`, «kr», `az group delete`, «Minimum før ekte data». Inneholder **ikke** «Mail.Send» (hører til fase 0b). |
| «utviklingsmiljø-dokumentet lenker til driftsdokumentet» | `docs/10-utviklingsmiljo.md` inneholder `docs/drift/testmiljo-azure.md`. |
| «ADR 0002 finnes med begge avveiningene» | `docs/adr/0002-testmiljo-azure.md` finnes og inneholder «Azure-tjenester» (brannmur) og «administrator» (databasebruker). `docs/06-arkitektur.md` inneholder «ADR 0002». |

## 4. Integrasjonstester mot testdatabasen

### `src/db/seed/run.test.ts` (utvides)

| Testnavn | Viser |
|---|---|
| «skriver aldri e-postadressen i loggen» | `vi.spyOn(console, "log").mockImplementation(() => {})`; `runSeed(env)` to ganger. Ingen av kallene inneholder `@`. Første kjøring skriver en linje med «opprettet», andre en linje med «finnes fra før». |

Ingen andre. Ingen tabeller, migreringer eller spørringer. Test-leder bekrefter i rapporten med `git diff --stat main.. -- src/db` (bare `seed/run.ts` og `seed/run.test.ts`) og `git diff --stat main.. -- src/core/access` (tom).

## 5. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | «serverLog nekter alle andre mottakere», «serverLog nekter når SEED_ADMIN_EMAIL mangler», «serverLog nekter når logLine mangler». | Ingen nye rettigheter. Eneste nye grense er «bare første admin kan få kode før e-post er satt opp», og den testes på begge sider. |
| Tenant-isolasjon | **Ikke relevant.** Ingen spørring tar `organizationId`. Ingen `expectTenantIsolation`. | Må stå med rene ord i PR-en. Legger utvikler til en spørring, kreves `expectTenantIsolation` i samme PR, ellers avvises PR-en. |
| Admin stenges aldri ute | «serverLog skriver koden for første admin». | Første admin er den eneste som slipper inn før e-post. Andre admin-brukere finnes ikke i seed. Nevnes i PR-en som kjent begrensning til Microsoft 365 er på. |
| Myk sletting | **Ikke relevant.** Ingen data. | Nevnes i PR-en. |

## 6. Regeltester

Ingen. Ingen regler eller TG-logikk.

## 7. E2e (Playwright) og det som ikke kan testes i skyen

- **Ingen ny e2e.** Eksisterende `e2e/fase-0a.spec.ts` og `e2e/fase-1-testskjema.spec.ts` må være grønne i `pc` og `ipad`. `logIn` bruker fortsatt `/dev/epost`.
- `serverLog` og `graph` testes bare som enhetstester: Playwright bygger appen med `DEV_MAILBOX=1`, og vi skal ikke sende e-post fra tester.
- **Ikke testbart her (alvorlig restrisiko, må stå i PR-en og i rapporten):** Bicep kompileres ikke (ingen `az`/`bicep` i miljøet), ingen Azure-kall, ingen utrulling. Første grønne kjøring hos Ståle er den egentlige testen. Mottiltak: valideringssteget i arbeidsflyten, og `workflow_dispatch` så Ståle kan kjøre på nytt uten ny merge. Test-leder leser Bicep gjennom for hånd og sjekker mot Azure-ressurstypene (`Microsoft.Web/serverfarms@…`, `Microsoft.Web/sites@…`, `Microsoft.DBforPostgreSQL/flexibleServers@…` med `databases` og `firewallRules`).
- **Tre merknader til arkitekt** (kan ikke testes, men gir rød første kjøring hvis de glipper):
  1. `pnpm build` i `utrulling` kjører uten database. I `ci.yml` kjører bygget med PostgreSQL oppe, så vi vet ikke om Next trenger databasen under bygging. Enten legg til samme `services: postgres` som i `ci.yml`, eller sjekk lokalt at `pnpm build` går uten database (`DATABASE_URL` mot en port som ikke svarer) og skriv det i PR-en.
  2. Brannmurregelen `github-runner` kan ta opptil ett minutt å virke på Flexible Server. Legg inn et kort gjenforsøk (f.eks. opptil 6 forsøk med 10 sekunder mellom) rundt `pnpm db:migrate`, ellers blir første kjøring rød uten at noe er galt.
  3. Next sitt `server.js` lytter på `process.env.HOSTNAME` hvis den er satt, og App Service Linux setter `HOSTNAME` til containernavnet. Det virker normalt, men hvis helsesjekken ikke svarer etter utrulling, er dette første sted å lete. Skriv det som feilsøkingstips i `docs/drift/testmiljo-azure.md`.
- Ekte iPad Pro (Safari, hjemskjerm, https): Ståle, etter utrulling. «Ferdig»-kriteriet i kortet kan ikke krysses av av agentene.

## 8. Krav til koden som testene bygger på (til utvikler og arkitekt)

1. **`sendEmail(email, env = getEnv())`.** Valgfri `env` som andre parameter, samme mønster som `emailTransport(env)` og `runSeed(env)`. Da slipper testene å røre `process.env`, og `tests/setup-env.ts` står urørt.
2. **`otpEmail(to: string, otp: string): Email` i `src/core/auth/otp-email.ts`** (ren funksjon, ingen import av `auth.ts`, `db` eller Better Auth). `auth.ts` kaller `sendEmail(otpEmail(email, otp))`. Funksjonen setter `to`, `subject`, `text` som i dag og `logLine: "Engangskode til første admin: <otp> (gyldig i 10 minutter)"`. Uten denne er kriteriet om `logLine` i `auth.ts` bare lesbart, ikke testbart.
3. **`Email.logLine?: string`** med kommentar «én linje som er trygg i serverloggen, uten personopplysninger, satt av avsenderen». `serverLog` skriver bare `logLine`, aldri `subject` eller `text`.
4. **`createServerLogSender(firstAdminEmail, write = console.info)`** i `src/core/email/server-log.ts`, med `export type EmailSender = (email: Email) => Promise<void>` i `index.ts`. Sammenligner `email.to.trim().toLowerCase()` med `firstAdminEmail`. Skriver én linje: `[innlogging] ${logLine}. E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md`. Ellers `throw new Error("E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.")` og ingen utskrift.
5. **`console.info` direkte**, aldri `logger` (den fjerner `code`/`otp` og e-post med vilje). Ikke JSON.
6. **Feilen for andre mottakere** er en vanlig `Error`. Innloggingssiden viser dagens generelle feilmelding; `login-form.tsx` endres ikke.
7. **`EmailTransport` = `"devMailbox" | "graph" | "serverLog"`.** `EMAIL_NOT_CONFIGURED` fjernes helt.
8. **Seed:** `console.log("Admin: opprettet")` / `console.log("Admin: finnes fra før")`, aldri adressen.
9. **Arbeidsflyten:** bygget bruker nøyaktig `ci.yml` sine oppdiktede verdier for `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` og `DATABASE_URL`; ekte secrets bare i Bicep-, migrerings- og seed-stegene. Migrerings-/seed-steget har `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` i `env:` (`db/client.ts` kaller `getEnv()`, som krever alle tre). Dokumentasjonen ber Ståle lage databasepassordet med `openssl rand -hex 24` (bare bokstaver og tall, ingen `+/=`) og `BETTER_AUTH_SECRET` med `openssl rand -base64 32`.
10. **Bicep:** `@secure()` på egen linje rett over parameteren, uten standardverdi. Ressursnavn bygges av `environmentName`; teksten `ezprop-test` forekommer ikke i filen. `DATABASE_URL` med `sslmode=verify-full` (bekreftet: `postgres` 3.4.9 slår bare av sertifikatsjekken ved `require`/`prefer`/`allow`).
11. `src/shared/lib/logger.ts`, `tests/setup-env.ts`, `login-form.tsx` og `ci.yml` endres ikke.

## 9. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| Bicep finnes, ingen hemmelige verdier, `@secure()`, `swedencentral`, ingen hemmelige `output` | Avsnitt 3, Bicep-tabellen (fire første rader) |
| Bicep: https, TLS, helsesjekk, Node 22, `node server.js`, `SCM_DO_BUILD_DURING_DEPLOYMENT`, PostgreSQL 16, `verify-full`, appinnstillinger, ikke `PORT`/`DEV_MAILBOX`, ingen `-test` | Avsnitt 3, Bicep-tabellen (øvrige rader) |
| `deploy-azure.yml`: push/dispatch, `concurrency`, `permissions`, `sjekk`/`utrulling`, hopper over, bare dokumenterte navn, ingen `creds`, ingen `az group create` | Avsnitt 3, arbeidsflyt-tabellen (åtte første rader). Gyldig YAML: `pnpm format:check` kjører Prettier på YAML (test-leder kjører den) |
| Arbeidsflyten: validate før create, `--output none`/`--query`, `add-mask`, `env` på migrering, `pnpm install` uten `--prod`, `github-runner` med `if: always()`, `APP_VERSION`, helsesjekk feiler uten commit-id | Avsnitt 3, arbeidsflyt-tabellen (øvrige rader) |
| `emailTransport`: devMailbox / graph / serverLog; delvis satt feiler i `env.ts` | Tre første i `email.test.ts`; `env.test.ts` «delvis Microsoft 365-oppsett stopper oppstarten» (**ny** test, fantes ikke) |
| `serverLog`: én `console.info`-linje med kode og dokumentsti, uten `@`, ikke JSON, ikke `console.log`/`error`; andre mottaker, tom `SEED_ADMIN_EMAIL` eller manglende `logLine` → feil og ingenting skrives | Seks serverLog-tester i `email.test.ts` og `server-log.test.ts` |
| `auth.ts` setter `logLine` med koden uten adresse; `graph` kaster fase 0b | `otp-email.test.ts`; «graph kaster fortsatt feilen om fase 0b» |
| Seed skriver ikke adressen | `run.test.ts` «skriver aldri e-postadressen i loggen» |
| Loggeren, `setup-env.ts`, `login-form.tsx` uendret; loggertestene grønne | `git diff main.. -- src/shared/lib/logger.ts tests/setup-env.ts src/app/**/login-form.tsx` tom + `pnpm test` |
| `appVersion()` med og uten `APP_VERSION` | `health.test.ts`, to nye tester |
| Driftsdokument med (a)–(f), navn, subject, `rand -hex 24`, Log stream, `APP_HOSTNAME`, kostnad i kr, `az group delete`; lenke fra `docs/10` | Dokumentasjonstabellen |
| ADR 0002 med begge avveiningene; `docs/06` «Hosting» og «E-post»; «Minimum før ekte data» to nye punkter | Dokumentasjonstabellen (ADR) + test-leder leser for hånd: `grep -n "Hosting\|E-post" docs/06-arkitektur.md`, `grep -n "Microsoft 365 koblet til\|VNet" docs/07-utviklingsplan.md` |
| Ingen «EzProp» i `src/`, ingen modellnavn, ingen nye avhengigheter, alle fire kommandoer grønne | `pnpm lint`; `git diff main.. -- package.json pnpm-lock.yaml` (bare versjon 0.2.0); `grep -ri` for kjente modellnavn i `infra`, `.github`, `docs/drift`, `docs/adr` (navnene skrives ikke i repoet) |
| Tenant-isolasjon: ikke relevant | Avsnitt 5, begrunnes i PR |
| iPad-størrelse: eksisterende e2e grønne | Avsnitt 7 |

## 10. Rapporten etterpå

Test-leder leverer: grønt/rødt per kommando (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`), tabellen i avsnitt 9 fylt ut, funn merket **alvorlig** (stopper godkjenning: manglende test for admin-grensen i `serverLog`, hemmelig verdi i fil, `logger.ts`/`setup-env.ts`/`login-form.tsx`/`ci.yml` endret, ekte `fetch` i test, ny avhengighet, `expectTenantIsolation` mangler for en ny spørring, modellnavn i fil) eller **lite** (tekst, navn, dokumentasjon). Bicep uten kompilering og de tre merknadene i avsnitt 7 føres som kjent restrisiko, ikke som funn.
