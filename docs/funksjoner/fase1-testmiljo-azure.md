# Funksjon: Testmiljø i Azure (forberedelse, slik at Ståle bare legger inn nøkler, velger adresse og merger)

- **Fase:** 1 – Prøve uten nett
- **Modul:** kjerne (`src/core/email`, `src/core/auth`), drift (`infra/azure`, `.github/workflows`), dokumentasjon (`docs/drift`)
- **Status:** godkjent for bygging 28.10.2026 (oppgavekort rettet av prosjektleder etter forhåndsvurdering fra forenkler, arkitekt, test-leder og sikkerhet-personvern; avgjørelsene står nederst)
- **Branch:** `fase1-testmiljo-azure` (bygger på `main`)
- **Dato:** 28.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, første punkt: «Testmiljø i Azure» (Ståle 28.10.2026)
- **Testplan:** `docs/funksjoner/fase1-testmiljo-azure-testplan.md` (test-leder; avsnitt 0 der viser hva som er endret etter dette kortet)
- **Støtter hovedmål:** Tid: prøvene A–F i fase 1 må kjøres på ekte iPad Pro over https; uten testmiljø kan ikke synkløsningen (den største tidsbesparelsen mot IVIT) velges. / Reklamasjoner: indirekte, prøvene skal vise at ingenting går tapt mellom befaring og rapport. / KI først: nei i denne oppgaven (drift og innlogging), se under.

## Problem
Testskjemaet fra oppgave 3 (PR #6) virker lokalt, men prøvene A–F skal kjøres på to ekte iPad Pro, og Safari gir bare sikker tilfeldighet (bilde-id, tabellrader) og «app på hjemskjermen» over **https** (spørsmål nr. 7). Ståle har bestemt 28.10.2026 at EzProp skal kjøre i **samme Azure-miljø som Optiplan** (Sweden Central, EU), med egen app og egen database, og at utrulling skjer fra GitHub ved merge til `main`. I dag finnes verken infrastruktur, utrullingsjobb eller en måte å logge inn på uten utviklings-postkassen (som er sperret utenfor localhost). Lar vi være, stopper fase 1: oppgave 4 (første kandidat) kan ikke prøves på iPad.

Oppgaven er **forberedelsen**: alt skal ligge klart i repoet slik at Ståle bare (1) lager ressursgruppen og en innlogging for GitHub i Azure, (2) legger inn secrets med nøyaktige navn, (3) velger adresse, og (4) merger. Ingenting rulles ut fra skyen, og ingen Azure-kall kjøres av agentene (det koster penger og krever nøkler vi ikke har).

**Viktig antakelse:** Optiplans repo (`infra/azure`, `deploy-azure.yml`) er ikke tilgjengelig fra denne sesjonen. Mønsteret følges ut fra det vi vet (Azure, Sweden Central, Microsoft 365, Better Auth, GitHub Actions), og det som er valgt står under «Avgjørelser» slik at Ståle kan sammenligne med Optiplan. Avvik fra Optiplan rettes i en senere PR.

## KI først
Nei. Dette er drift og innlogging, ingen oppgave takstmannen gjør. KI kommer ikke inn før grunnmuren står (beslutning 25.10.2026). Testmiljøet er likevel der KI-forslag senere vises på iPaden og godkjennes av takstmannen, så det er et nødvendig steg.

## Brukerhistorier
- Som **Ståle (produkteier)** vil jeg **åpne EzProp på en ekte iPad Pro fra hjemskjermen over https** slik at **prøvene A–F kan kjøres slik takstmennene skal bruke appen**.
- Som **Ståle** vil jeg **legge inn nøklene i GitHub én gang og deretter få hver merge rullet ut automatisk** slik at **jeg ikke trenger å gjøre noe teknisk per PR**.
- Som **Ståle (første admin)** vil jeg **logge inn i testmiljøet før e-post er satt opp** slik at **jeg ikke må vente på Microsoft 365-oppsettet**.
- Som **prosjektleder** vil jeg **se hvilken commit som kjører i `/api/helse`** slik at **jeg vet at utrullingen virket før jeg melder fra til Ståle**.

## Omfang
**Med:**

1. **Infrastruktur som kode i `infra/azure/main.bicep`** (Bicep, uten Azure-kall fra skyen). Én fil. Øverst står en kommentar som peker til `docs/drift/testmiljo-azure.md` (ingen README, ingen `main.bicepparam`; parameterne gis direkte fra arbeidsflyten).
   - Parametere: `location` (standard `swedencentral`), `environmentName` (standard `test`), `appHostname` (valgfri, standard tom), `appVersion`, `seedAdminEmail`, `postgresAdminPassword` (`@secure()`), `betterAuthSecret` (`@secure()`), og de fire valgfrie e-postverdiene (`msGraphTenantId`, `msGraphClientId`, `msGraphClientSecret` `@secure()`, `mailFrom`). `@secure()` står på egen linje rett over parameteren, og hemmelige parametere har ingen standardverdi. Verdier står **aldri** i filen.
   - Bicep er på ressursgruppenivå og **lager ikke ressursgruppen**. Ståle lager `rg-ezprop-test` én gang selv (steg (a) i dokumentasjonen), og GitHub-innloggingen får bare «Contributor» på den gruppen, ikke på abonnementet der Optiplan ligger.
   - Ressurser: App Service-plan Linux **B1** (`plan-ezprop-${environmentName}`), **App Service** (`app-ezprop-${environmentName}`): `linuxFxVersion: 'NODE|22-lts'`, `appCommandLine: 'node server.js'` (standalone-bygget starter ikke av seg selv), `httpsOnly: true`, `minTlsVersion: '1.2'`, `alwaysOn: true`, `healthCheckPath: '/api/helse'`, applikasjonslogg til filsystem slått på med kort oppbevaring (3 dager, liten kvote) slik at Ståle ser innloggingskoden i Log stream uten at den blir liggende. **PostgreSQL Flexible Server** 16 (`psql-ezprop-${environmentName}`, Burstable B1ms, 32 GB, `location: location`, database `ezprop`, bare SSL, `geoRedundantBackup: 'Disabled'`), og brannmurregelen «Azure-tjenester» (0.0.0.0) slik at App Service når databasen (kjent avveining, se ADR 0002). Alle navn bygges av `environmentName` slik at `prod` kan legges til senere uten kollisjon; ingen ressursnavn har `test` hardkodet.
   - Appinnstillinger fra Bicep: `NODE_ENV=production`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `DATABASE_URL` (bygges av servernavn, bruker og passord med `uriComponent()`, og `sslmode=verify-full`, ikke `require`: `postgres`-pakken slår av sertifikatsjekken ved `require`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://<appHostname>` når satt, ellers `https://app-ezprop-<environmentName>.azurewebsites.net`), `SEED_ADMIN_EMAIL`, `APP_VERSION` (fra `appVersion`), og de fire e-postverdiene bare når de er gitt. **Ikke** `PORT`/`WEBSITES_PORT` (App Service setter `PORT`, og Next sin `server.js` lytter på den). `DEV_MAILBOX` settes **aldri**.
   - `output`: bare servernavn og appens adresse. Aldri `DATABASE_URL`, passord eller nøkler (alt i `output` havner i GitHub-loggen).
   - **Ingen hostname-binding eller sertifikat i Bicep.** `appHostname` styrer bare `BETTER_AUTH_URL`. Selve bindingen og det gratis App Service Managed Certificate legger Ståle inn i Azure-portalen (steg (f)); binding og sertifikat i Bicep krever to kjøringer og gir unødig risiko for rød utrulling.

2. **Utrulling: `.github/workflows/deploy-azure.yml`.** Kjører ved push til `main` og manuelt med `workflow_dispatch`. `concurrency` så to utrullinger ikke kjører samtidig. `permissions: {}` øverst; bare jobben `utrulling` har `permissions: id-token: write, contents: read`.
   - **Hopper over uten feil når secrets mangler:** jobben `sjekk` setter `klar` fra `${{ secrets.AZURE_CLIENT_ID != '' }}` i `env` og gir det som output; verdien skrives aldri ut. Jobben `utrulling` har `needs: sjekk` og `if: needs.sjekk.outputs.klar == 'true'`. Uten nøkler blir kjøringen grønn med meldingen «Ingen Azure-nøkler i GitHub, hopper over utrullingen».
   - Innlogging til Azure med **OIDC** (`azure/login` med `client-id`, `tenant-id`, `subscription-id`), ingen lagret Azure-passord, ingen `creds:`.
   - Steg i `utrulling`: checkout → `pnpm install` (uten `--prod`; migrering trenger `tsx` og `dotenv`) → `pnpm build` med **de samme oppdiktede verdiene som i `ci.yml`** (ekte secrets brukes bare i Bicep, migrering og seed) → Azure-innlogging → `az deployment group validate` → `az deployment group create` med `main.bicep` og `--parameters` direkte, `--output none` (eller snever `--query` på servernavn og adresse) → bygg `DATABASE_URL` for kjøreren og masker den med `echo "::add-mask::…"` før bruk → midlertidig brannmurregel `github-runner` for **bare kjørerens egen IP** → `pnpm db:migrate` og `pnpm db:seed` med `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` i `env` (`getEnv()` krever alle tre; seed er idempotent) → slett `github-runner` med `if: always()` → kopier `.next/static` til `.next/standalone/.next/static` og `public` til `.next/standalone/public`, lag zip **fra innsiden av** `.next/standalone` → `azure/webapps-deploy` → vent og sjekk at `GET /api/helse` svarer 200 og at `versjon` inneholder kort commit-id (ellers rød jobb).
   - `APP_VERSION` = kort commit-id (`${GITHUB_SHA::7}` eller tilsvarende).
   - Secrets og variabler, **nøyaktige navn** (dokumenteres i `docs/drift/testmiljo-azure.md`):
     - Secrets (må): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `POSTGRES_ADMIN_PASSWORD`, `BETTER_AUTH_SECRET`.
     - Secrets (valgfrie, alle fire sammen): `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MAIL_FROM`. Arbeidsflyten sender dem til Bicep når de finnes; selve sendingen via Graph kommer i fase 0b (se punkt 3).
     - Variabler (Settings → Variables): `SEED_ADMIN_EMAIL` (Ståles jobbadresse), `APP_HOSTNAME` (tom til DNS er klar; forslag `ezprop-test.byggcon.no`).
   - `ci.yml` endres ikke.

3. **Innlogging uten utviklings-postkasse i drift** (`src/core/email`, `src/core/auth`):
   - `emailTransport` gir **`serverLog`** når `DEV_MAILBOX` er av og de fire Microsoft 365-verdiene mangler, og `graph` når alle fire er satt (som i dag). `none` finnes ikke lenger; `EMAIL_NOT_CONFIGURED` fjernes.
   - `Email` får valgfritt felt `logLine?: string`: «én linje som er trygg i serverloggen, uten personopplysninger, satt av avsenderen». `auth.ts` setter `logLine: "Engangskode til første admin: <kode> (gyldig i 10 minutter)"`. Ingen regex-parsing av e-postteksten.
   - Ny fil `src/core/email/server-log.ts`: `createServerLogSender(firstAdminEmail: string | undefined, write: (line: string) => void = console.info): EmailSender` med `export type EmailSender = (email: Email) => Promise<void>` i `index.ts`. Adapteren skriver **én** linje, `[innlogging] ${logLine}. E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md`, **bare** når `email.to` (små bokstaver) er lik `firstAdminEmail` (allerede små bokstaver fra `env.ts`) **og** `logLine` er satt. Adressen skrives aldri. Ellers (annen mottaker, `firstAdminEmail` udefinert eller `logLine` mangler) kastes `Error("E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.")` og ingenting skrives. Meldingen avslører ikke hvem første admin er. `console.info` direkte, **aldri** `logger` (den vasker `otp`/`code`/e-post med vilje og endres ikke).
   - `sendEmail(email, env = getEnv())` får valgfri `env` som andre parameter (samme mønster som `emailTransport(env)` og `runSeed(env)`), slik at testene ikke rører `process.env` eller `tests/setup-env.ts`.
   - `graph` kaster fortsatt samme tydelige feil som i dag («E-post via Microsoft 365 er ikke koblet til ennå (fase 0b).»). **Graph-adapteren bygges ikke nå**, se «Avgjørelser».
   - Innloggingssiden (`login-form.tsx`) endres ikke: den viser dagens generelle feilmelding ved alle serverfeil.
   - `rateLimit` i Better Auth er fortsatt på i drift. Ingen endring der.
   - `src/db/seed/run.ts` skriver ikke lenger adressen (`Admin: opprettet` / `Admin: finnes fra før`), fordi seed kjører i GitHub Actions og loggen der skal ikke inneholde Ståles adresse. Test som viser at utskriften ikke inneholder `@`.
   - `.env.example`, kommentarene i `env.ts` og raden «E-post» i `docs/06-arkitektur.md` oppdateres: `DEV_MAILBOX` lokalt, serverlogg for første admin i drift før e-post, Microsoft 365 (Graph) kobles til i fase 0b.

4. **Helsesjekken viser commit.** `appVersion()` gjør dette allerede når `APP_VERSION` er satt; oppgaven er at arbeidsflyten setter `APP_VERSION` til kort commit-id og sjekker svaret. Ingen kodeendring i `src/core/health` utover tester som bruker `packageJson.version` (ikke hardkodet `0.2.0`).

5. **Dokumentasjon for Ståle:** `docs/drift/testmiljo-azure.md` (ny, kort, klarspråk), steg for steg:
   - (a) Lage ressursgruppen `rg-ezprop-test` i Sweden Central selv (én gang). Lage app-registrering for GitHub med **federated credential** (OIDC), subject nøyaktig `repo:Byggcon-sl/EzProp:ref:refs/heads/main`, og gi den rollen «Contributor» **bare på ressursgruppen**.
   - (b) Legge inn de fem secrets og to variablene med nøyaktige navn. `BETTER_AUTH_SECRET` med `openssl rand -base64 32`; `POSTGRES_ADMIN_PASSWORD` med `openssl rand -hex 24` (bare bokstaver og tall, fordi det brukes i en URL).
   - (c) Merge → se at arbeidsflyten «Utrulling til Azure» er grønn; den kan kjøres på nytt fra Actions uten ny merge.
   - (d) Første innlogging: åpne `https://app-ezprop-test.azurewebsites.net/logg-inn`, skriv inn adressen i `SEED_ADMIN_EMAIL`, hent koden i App Service → Log stream (eller `az webapp log tail`). Merk: alle med lesetilgang til ressursgruppen i Azure-portalen kan lese koden og logge inn som første admin i testmiljøet; greit med oppdiktede data (spørsmål nr. 9). Andre brukere kan ikke logge inn før Microsoft 365 er koblet til.
   - (e) Legge appen på hjemskjermen på iPad Pro (Del → Legg til på Hjem-skjerm).
   - (f) Egen adresse (når Ståle har svart på spørsmål nr. 6): DNS hos den som har byggcon.no (CNAME `ezprop-test` → `app-ezprop-test.azurewebsites.net`, TXT `asuid.ezprop-test` → verifikasjons-id fra Azure), i Azure-portalen: Custom domains → Add → managed certificate, deretter sett `APP_HOSTNAME` og kjør arbeidsflyten på nytt. **Merk:** når `APP_HOSTNAME` er satt, virker innlogging bare på den adressen, ikke lenger på `app-ezprop-test.azurewebsites.net` (Better Auth avviser annet opphav).
   - Pluss: at miljøet aldri skal få ekte oppdrag før «Minimum før ekte data» er krysset av; **anslått månedskostnad** (App Service B1 ca. 130–150 kr, PostgreSQL B1ms ca. 180–220 kr, til sammen ca. 350–450 kr per måned ved dagens kurs; Ståle sammenligner med Optiplans faktura); og hvordan miljøet slettes uten å miste koden (`az group delete`). Ikke noe om å stoppe databasen (står bare under «Åpne spørsmål» her).
   - Lenke fra `docs/10-utviklingsmiljo.md` (nytt avsnitt «Testmiljø i Azure»).
   - Microsoft 365-oppsettet (steg (g) i utkastet) er flyttet til fase 0b sammen med adapteren.

6. **ADR 0002 – Testmiljø i Azure** (`docs/adr/0002-testmiljo-azure.md`, skrives av arkitekt): App Service i stedet for Container Apps (ingen registry, ingen Dockerfile, zip av standalone-bygget), PostgreSQL Flexible Server, OIDC fra GitHub med rettigheter bare på ressursgruppen, migrering fra arbeidsflyten med midlertidig brannmurregel, og at valgene er antakelser om Optiplans mønster som Ståle bekrefter. **Kjente avveininger som skal stå der:** brannmurregelen «Azure-tjenester» åpner for alle Azure-kunders IP-adresser (greit i test med TLS og langt passord; VNet-integrasjon er senere alternativ), og appen bruker administratorbrukeren på databasen (egen bruker uten eierrettigheter før ekte data; bygges ikke nå). `docs/06-arkitektur.md` raden «Hosting» oppdateres til «Azure App Service + PostgreSQL Flexible Server, Sweden Central (ADR 0002). Testmiljø fra fase 1.»

7. **Plan, versjon og ordliste.** Kryss av punktet i `docs/07-utviklingsplan.md`. Legg til to punkter under «Minimum før ekte data» (sikkerhet-personvern 28.10.2026): «Microsoft 365 koblet til, og koden i serverloggen er ikke lenger i bruk» og «Privat nettverk eller VNet-integrasjon mellom app og database (ikke brannmurregelen for alle Azure-tjenester)». Øk versjonen i `package.json` til **0.2.0** (første leveranse som kan kjøre utenfor utviklingsmaskinen). Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får «Testmiljø» → `test environment`, «Utrulling» → `deploy`, «Serverlogg» → `server log`. `start.sh` og `scripts/session-start.sh` trenger ingen endring.

**Ikke med (bevisst utelatt):**
- **Graph-adapteren** (`src/core/email/graph.ts`, falsk-`fetch`-tester, steg (g)). Flyttes til fase 0b («Tilkoblingslag … første tilkobling: e-post via Microsoft 365 som i Optiplan»). Når den bygges: bruk Optiplans app-registrering, `Mail.Send` begrenset til `MAIL_FROM`-postboksen med «Application Access Policy» i Exchange, token og svar fra Graph logges aldri.
- Ingen utrulling, ingen `az`-kommandoer og ingen Azure-kall fra skyen. Bicep kompileres ikke her (ingen `az`/`bicep`); arbeidsflyten kjører `az deployment group validate` som erstatning, og arkitekt og test-leder leser filen for hånd.
- Ingen hostname-binding eller sertifikat i Bicep (Ståle gjør det i portalen, steg (f)).
- Ingen `infra/azure/README.md`, ingen `main.bicepparam`.
- Ingen produksjonsmiljø, ingen egen «staging». Bare `test`. Navnene tåler `prod` senere.
- Ingen Azure Key Vault (fase 0b). Secrets ligger i GitHub og i App Service sine appinnstillinger.
- Ingen Container Apps, Docker, registry eller Dockerfile.
- Ingen felles innlogging med Optiplan, ingen felles brukerdatabase (fase 0b, ADR). Testmiljøet har egen database.
- Ingen VNet-integrasjon, ingen egen databasebruker for appen (før ekte data).
- Ingen fillagring (blob) for bilder; bildene i prøvene lagres der kandidaten i oppgave 4 bestemmer.
- Ingen overvåking, varsling eller Application Insights. Loggene leses i App Service.
- Ingen sikkerhetskopi utover det Flexible Server gir som standard (7 dager). Bare oppdiktede data til «Minimum før ekte data» er på plass.
- Ingen innloggingskode i loggen for andre enn første admin, og aldri i den vaskede loggeren.
- Ingen endring i CI (`ci.yml`), `login-form.tsx`, `logger.ts` eller `tests/setup-env.ts`. Ingen Playwright-kjøring mot Azure.
- Ingen endringer i testskjemaet eller `offline-trial`.
- Adressen og e-postvalget (spørsmål nr. 6) avgjøres av Ståle; oppgaven forutsetter «kode i serverloggen» og adressen som tom innstilling med `ezprop-test.byggcon.no` som forslag.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ingen endring | ingen endring |
| kontor | ingen endring | ingen endring |
| leder | ingen endring | ingen endring |
| admin | ingen endring. Første admin (`SEED_ADMIN_EMAIL`) er den eneste som kan logge inn før e-post er satt opp | ingen endring |

Ingen nye tilgangsregler, ingen nye spørringer. `expectTenantIsolation` trengs derfor ikke i denne oppgaven; det begrunnes i PR-en. Legger utvikler til en spørring, kreves `expectTenantIsolation` i samme PR.

## Data
Ingen nye tabeller, ingen migreringer. Ingen nye faste koder. Ingen nye miljøinnstillinger (`APP_VERSION` og de fire e-postverdiene finnes alt i `env.ts`). `emailTransport` får verdien `serverLog` i stedet for `none`. `Email` får valgfritt felt `logLine`.

## Skjermer
Ingen nye skjermer. Innloggingssiden er uendret og viser dagens generelle feilmelding når `sendEmail` kaster. Antall trykk uendret.

## Regler
Ingen regler eller TG-logikk.

## Avgjørelser (prosjektleder 28.10.2026, etter forhåndsvurderingen)
- **Graph-adapteren utsettes til fase 0b** (forenkler vant over arkitekt og sikkerhet-personvern, som ville ta den med). Begrunnelse: spørsmål nr. 6 (om e-post skal gå via Microsoft 365 fra start) er åpent, og vi gjetter ikke på Ståles beslutninger; Optiplans `graph.ts` er ikke tilgjengelig, så adapteren ville måtte skrives om i fase 0b uansett; den krever i tillegg oppsett i Exchange (Application Access Policy) som er mer for Ståle å gjøre nå. Planens fase 1-punkt oppfylles med «koden i serverloggen for første admin». PR-en blir mindre og lettere å lese. Når Ståle svarer ja på nr. 6, er adapteren en liten egen PR.
- **Ressursgruppen lages av Ståle, ikke av arbeidsflyten** (sikkerhet-personvern vant over arkitekt). «Contributor» bare på `rg-ezprop-test`, så en kompromittert arbeidsflyt ikke når Optiplan.
- **Hostname-binding og sertifikat ut av Bicep** (forenkler, arkitekt hadde ingen innvending). To-kjørings-problemet gir rød utrulling uten gevinst; «ferdig når» nås på `*.azurewebsites.net`.
- **Ingen README og ingen `main.bicepparam`** (forenkler). Ett sted å lese (`docs/drift`), én vei å rulle ut (arbeidsflyten).
- **`logLine` på `Email`** (arkitekt) i stedet for prefiks + e-posttekst (test-leders enkleste forslag). Én trygg linje satt av avsenderen; serverloggen får aldri hele e-postteksten.
- **`sslmode=verify-full`**, **`node server.js`**, ingen `PORT`-innstillinger, zip fra innsiden av standalone (arkitekt).
- **Bygget kjører med oppdiktede verdier**, ekte secrets bare i Bicep, migrering og seed; `DATABASE_URL` maskeres; ingen hemmelige `output` (sikkerhet-personvern).
- **App Service, ikke Container Apps.** Enklest: ett zip av `.next/standalone`, ingen registry, gratis sertifikat for egen adresse, logg i nettleseren. Antakelse om at det ligner Optiplan; Ståle bekrefter.
- **Migrering fra arbeidsflyten**, ikke ved oppstart av appen. Standalone-bygget tar ikke med `tsx` og migreringsfilene, og en feilslått migrering skal stoppe utrullingen før ny kode kjører.
- **Serverlogg bare for første admin**, automatisk når e-post mangler. Ingen ny innstilling.
- **Versjon 0.2.0**, ikke 0.1.3: første leveranse som kan kjøre utenfor utviklingsmaskinen.

## Akseptkriterier
- [ ] `infra/azure/main.bicep` finnes, inneholder ingen verdier for hemmeligheter (hver `param` med `password`/`secret` i navnet har `@secure()` på linjen over og ingen standardverdi), lager app, plan og database i `swedencentral`, og har ingen `output` med passord, nøkler eller `DATABASE_URL`.
- [ ] Bicep: `httpsOnly: true`, `minTlsVersion: '1.2'`, `healthCheckPath: '/api/helse'`, `alwaysOn: true`, `linuxFxVersion` med `NODE|22`, `appCommandLine` med `node server.js`, `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false`; database `version: '16'`, `location: location`, `geoRedundantBackup: 'Disabled'`; `DATABASE_URL` med `sslmode=verify-full`. Appinnstillingene har `NODE_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SEED_ADMIN_EMAIL`, `APP_VERSION`; ikke `PORT`, `WEBSITES_PORT` eller `DEV_MAILBOX`. Ingen ressursnavn med `-test` hardkodet.
- [ ] `.github/workflows/deploy-azure.yml` kjører på push til `main` og `workflow_dispatch`, har `concurrency`, `permissions: {}` øverst og `id-token: write` bare på `utrulling`; jobben `sjekk` gir `klar`, `utrulling` har `needs: sjekk` og `if: needs.sjekk.outputs.klar == 'true'`; meldingen «hopper over utrullingen» finnes. Bruker bare de dokumenterte navnene på secrets og variabler; ingen `creds:`/`AZURE_CREDENTIALS`; ingen `az group create`.
- [ ] Arbeidsflyten: `az deployment group validate` før `create`; `--output none` eller snever `--query`; `::add-mask::` på `DATABASE_URL`; migrering/seed-steget har `DATABASE_URL`, `BETTER_AUTH_SECRET` og `SEED_ADMIN_EMAIL` i `env`; `pnpm install` uten `--prod`; brannmurregelen `github-runner` slettes med `if: always()` etter migreringen; `APP_VERSION` = kort commit-id; helsesjekk-steget feiler hvis `versjon` mangler commit-id.
- [ ] `emailTransport`: `DEV_MAILBOX=1` → `devMailbox`; fire Graph-verdier satt → `graph`; ellers `serverLog`. Delvis satt kaster fortsatt feil i `env.ts` (eksisterende test).
- [ ] `sendEmail(email, env)` med `serverLog`: mottaker lik `SEED_ADMIN_EMAIL` (uavhengig av store bokstaver) og `logLine` satt gir **nøyaktig én** `console.info`-linje som inneholder koden og `docs/drift/testmiljo-azure.md`, og **ikke** `@`; `console.log`/`console.error` kalles ikke og linjen er ikke JSON. Annen mottaker, `SEED_ADMIN_EMAIL` udefinert eller `logLine` mangler → kaster `Error` med meldingen «E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.» og skriver ingenting.
- [ ] `auth.ts` setter `logLine` med koden og uten adresse. `graph` kaster fortsatt feilen om fase 0b.
- [ ] Seed skriver ikke e-postadressen (test: utskriften fra `runSeed` inneholder ikke `@`).
- [ ] Loggeren (`src/shared/lib/logger.ts`), `tests/setup-env.ts` og `login-form.tsx` er uendret (`git diff main..` tom), og loggertestene er grønne.
- [ ] `appVersion()` gir `${packageJson.version} (abc1234)` når `APP_VERSION=abc1234`, og bare versjonen ved tom `APP_VERSION`.
- [ ] `docs/drift/testmiljo-azure.md` har stegene (a)–(f), alle secret- og variabelnavn arbeidsflyten bruker, federated subject, `openssl rand -hex 24`, merknaden om Log stream og om `APP_HOSTNAME`/innlogging, anslått månedskostnad i kr og `az group delete`. `docs/10-utviklingsmiljo.md` lenker dit.
- [ ] ADR 0002 finnes med begge avveiningene; `docs/06-arkitektur.md` radene «Hosting» og «E-post» er oppdatert; «Minimum før ekte data» har de to nye punktene.
- [ ] Ingen «EzProp» i `src/` utenfor `brand.ts`, ingen modellnavn i `infra/`, `.github/` eller `docs/drift/`, ingen nye avhengigheter (ingen `yaml`-pakke i testene). `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): **ikke relevant**, ingen nye spørringer (begrunnes i PR).
- [ ] Virker på iPad-størrelse (e2e): **ikke relevant** for infrastruktur; eksisterende e2e grønne. Ekte iPad testes av Ståle etter utrulling («ferdig når appen åpner på ekte iPad Pro i Safari fra hjemskjermen»).

## Biter som bygges i parallell
| Bit | Rolle | Filer | Avhenger av |
|---|---|---|---|
| A: e-post og innlogging | utvikler | `src/core/email/index.ts`, `src/core/email/server-log.ts`, `src/core/auth/auth.ts`, `src/db/seed/run.ts`, `src/shared/config/env.ts` (kommentar), `.env.example`, `package.json` (0.2.0) | ingen |
| B: infrastruktur og utrulling | arkitekt | `infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`, `docs/adr/0002-testmiljo-azure.md`, `docs/06-arkitektur.md` | ingen |
| C: dokumentasjon og plan | utvikler (etter A) | `docs/drift/testmiljo-azure.md`, `docs/10-utviklingsmiljo.md`, `docs/07-utviklingsplan.md`, `docs/05-domenemodell.md` (ordliste) | B for nøyaktige navn (står alt i dette kortet) |
| T: tester | testskriver | `src/core/email/email.test.ts`, `src/core/health/health.test.ts`, `src/db/seed/run.test.ts`, `tests/deploy-workflow.test.ts` | ingen (skrives mot kontraktene i dette kortet og testplanen) |

## Testplan (kort, se `fase1-testmiljo-azure-testplan.md`)
- Enhetstester i `src/core/email/email.test.ts` (transportvalg, serverlogg via `sendEmail(email, env)` med `vi.spyOn(console, "info")`), `src/core/health/health.test.ts` (`appVersion`), `src/db/seed/run.test.ts` (ingen adresse i loggen).
- `tests/deploy-workflow.test.ts`: leser `.github/workflows/deploy-azure.yml`, `infra/azure/main.bicep` og `docs/drift/testmiljo-azure.md` som tekst og sjekker kriteriene over med enkle tekstsøk. Ingen YAML-pakke.
- Ingen `graph.test.ts` (adapteren er utsatt).
- Ingen e2e-endring.
- **Kjent restrisiko (står i PR-en):** Bicep kompileres ikke og ingenting rulles ut fra skyen. Første grønne kjøring hos Ståle er den egentlige testen; `workflow_dispatch` gjør at han kan kjøre på nytt uten ny merge.

## Må bestemmes av Ståle (står i PR-en)
- Spørsmål nr. 6: adressen (`ezprop-test.byggcon.no`?) og om e-post skal gå via Microsoft 365 fra start. Oppgaven forutsetter kode i serverloggen til han svarer, og adressen er en innstilling han setter selv. Sier han ja til Microsoft 365, bygges Graph-adapteren i en liten egen PR.
- Spørsmål nr. 9: hvem skal ha tilgang til ressursgruppen `rg-ezprop-test` i Azure-portalen (og dermed til serverloggen med innloggingskoden og appinnstillingene). Anbefaling: bare Ståle til nøkkelboksen i fase 0b er på plass.
- Bekrefte at App Service + PostgreSQL Flexible Server + OIDC ligner Optiplans oppsett. Hvis Optiplan bruker Container Apps, byttes det i egen PR.
- Lage ressursgruppen og GitHub-innloggingen i Azure, og legge inn secrets og variabler i GitHub (ingen andre kan).

## Åpne spørsmål
- Skal databasen stoppes når den ikke brukes (sparer ca. halve kostnaden, men første åpning tar et minutt)? Ikke i denne oppgaven, og ikke i dokumentasjonen til Ståle ennå.
