# Funksjon: Testmiljø i Azure (forberedelse, slik at Ståle bare legger inn nøkler, velger adresse og merger)

- **Fase:** 1 – Prøve uten nett
- **Modul:** kjerne (`src/core/email`, `src/core/auth`), drift (`infra/azure`, `.github/workflows`), dokumentasjon (`docs/drift`)
- **Status:** utkast 28.10.2026 (oppgavekort fra prosjektleder, venter på forenkler, arkitekt, test-leder og sikkerhet-personvern)
- **Branch:** `fase1-testmiljo-azure` (bygger på `main`)
- **Dato:** 28.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, første punkt: «Testmiljø i Azure» (Ståle 28.10.2026)
- **Støtter hovedmål:** Tid: prøvene A–F i fase 1 må kjøres på ekte iPad Pro over https; uten testmiljø kan ikke synkløsningen (den største tidsbesparelsen mot IVIT) velges. / Reklamasjoner: indirekte, prøvene skal vise at ingenting går tapt mellom befaring og rapport. / KI først: nei i denne oppgaven (drift og innlogging), se under.

## Problem
Testskjemaet fra oppgave 3 (PR #6) virker lokalt, men prøvene A–F skal kjøres på to ekte iPad Pro, og Safari gir bare sikker tilfeldighet (bilde-id, tabellrader) og «app på hjemskjermen» over **https** (spørsmål nr. 7). Ståle har bestemt 28.10.2026 at EzProp skal kjøre i **samme Azure-miljø som Optiplan** (Sweden Central, EU), med egen app og egen database, og at utrulling skjer fra GitHub ved merge til `main`. I dag finnes verken infrastruktur, utrullingsjobb eller en måte å logge inn på uten utviklings-postkassen (som er sperret utenfor localhost). Lar vi være, stopper fase 1: oppgave 4 (første kandidat) kan ikke prøves på iPad.

Oppgaven er **forberedelsen**: alt skal ligge klart i repoet slik at Ståle bare (1) lager en innlogging for GitHub i Azure, (2) legger inn secrets med nøyaktige navn, (3) velger adresse, og (4) merger. Ingenting rulles ut fra skyen, og ingen Azure-kall kjøres av agentene (det koster penger og krever nøkler vi ikke har).

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

1. **Infrastruktur som kode i `infra/azure/`** (Bicep, uten Azure-kall fra skyen):
   - `main.bicep` med parametere: `location` (standard `swedencentral`), `environmentName` (standard `test`), `appHostname` (valgfri, standard tom = bare `*.azurewebsites.net`), `postgresAdminPassword` (`@secure()`), `betterAuthSecret` (`@secure()`), `seedAdminEmail`, og de fire valgfrie e-postverdiene (`msGraphTenantId`, `msGraphClientId`, `msGraphClientSecret` `@secure()`, `mailFrom`). Verdier står **aldri** i Bicep-filene eller i `main.bicepparam`; parameterfilen refererer bare til navnene på GitHub-secrets (kommentar) og settes fra arbeidsflyten.
   - Ressurser i ressursgruppen `rg-ezprop-test`: App Service-plan Linux **B1** (`plan-ezprop-test`), **App Service** for Node 22 (`app-ezprop-test`, bare https, TLS 1.2, `alwaysOn`, helsesjekk på `/api/helse`), **PostgreSQL Flexible Server** 16 (`psql-ezprop-test`, Burstable B1ms, 32 GB, Sweden Central, database `ezprop`, bare SSL, geo-redundans av), og brannmurregel «Azure-tjenester» slik at App Service når databasen. Alt navngis slik at `environmentName` kan byttes til `prod` senere uten kollisjon.
   - Appinnstillinger settes fra Bicep: `NODE_ENV=production`, `DATABASE_URL` (bygges fra servernavn, bruker og passord-parameteren, med `sslmode=require`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://<appHostname>` når satt, ellers `https://app-ezprop-test.azurewebsites.net`), `SEED_ADMIN_EMAIL`, `APP_VERSION` (fra parameter `appVersion`, settes av arbeidsflyten til kort commit-id), `PORT=3000`, `WEBSITES_PORT=3000`, og de fire e-postverdiene bare når de er gitt. `DEV_MAILBOX` settes **aldri**.
   - Egendefinert adresse: når `appHostname` er satt, lages hostname-binding med **gratis App Service Managed Certificate**. Det forutsetter at Ståle først har lagt inn DNS (CNAME og TXT `asuid`), se dokumentasjonen. Første utrulling skjer **uten** egen adresse; den legges til i en ny kjøring når DNS er på plass.
   - `infra/azure/README.md` (kort): hva filene gjør, hvordan Ståle kjører dem første gang fra Mac (`az deployment group create …`) hvis han vil, og at arbeidsflyten ellers gjør det.

2. **Utrulling: `.github/workflows/deploy-azure.yml`.** Kjører ved push til `main` (og manuelt med `workflow_dispatch`).
   - Innlogging til Azure med **OIDC** (`azure/login` med `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), ingen lagret Azure-passord.
   - **Hopper over uten feil når secrets mangler:** en første jobb `sjekk` leser om `AZURE_CLIENT_ID` er satt og gir `klar=true/false` som output; jobben `utrulling` har `if: needs.sjekk.outputs.klar == 'true'`. Når Ståle ikke har lagt inn noe, blir kjøringen grønn med meldingen «Ingen Azure-nøkler i GitHub, hopper over utrullingen» i loggen. (Job-nivå `if` kan ikke lese secrets direkte; derfor egen jobb.)
   - Steg i `utrulling`: checkout → pnpm install → `pnpm build` (standalone) → Azure-innlogging → `az deployment group create` med `main.bicep` (lager ressursgruppen om den mangler, idempotent) → åpne midlertidig brannmurregel for kjørerens IP på PostgreSQL → `pnpm db:migrate` og `pnpm db:seed` mot Azure-databasen (seed er idempotent; lager bare organisasjonen Byggcon og første admin fra `SEED_ADMIN_EMAIL`) → fjern brannmurregelen (også ved feil, `if: always()`) → pakke `.next/standalone` + `.next/static` + `public` til zip → `azure/webapps-deploy` → vent og sjekk `GET /api/helse` svarer 200 og at `versjon` inneholder commit-id-en (ellers rød jobb).
   - Secrets og variabler, **nøyaktige navn** (dokumenteres i `docs/drift/testmiljo-azure.md`):
     - Secrets (må): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `POSTGRES_ADMIN_PASSWORD`, `BETTER_AUTH_SECRET`.
     - Secrets (valgfrie, alle fire sammen): `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MAIL_FROM`.
     - Variabler (Settings → Variables): `SEED_ADMIN_EMAIL` (Ståles jobbadresse), `APP_HOSTNAME` (tom til DNS er klar; forslag `ezprop-test.byggcon.no`).
   - `ci.yml` endres ikke. `deploy-azure.yml` krever ikke at CI er grønn (CI kjører allerede på hver PR), men bruker `concurrency` så to utrullinger ikke kjører samtidig.

3. **Innlogging uten utviklings-postkasse i drift** (`src/core/email`, `src/core/auth`):
   - Ny e-posttjeneste **`serverLog`** i `emailTransport`: velges automatisk når `DEV_MAILBOX` er av **og** de fire Microsoft 365-verdiene mangler. Når alle fire er satt, velges `graph` automatisk (ingen ny innstilling å huske). `none` finnes ikke lenger; `EMAIL_NOT_CONFIGURED` fjernes.
   - `serverLog` skriver **bare** innloggingskoden for **første admin** (mottaker lik `SEED_ADMIN_EMAIL`, sammenlignet uten store bokstaver) til standard ut, med én tydelig linje: `[innlogging] Engangskode til første admin: 123456 (gyldig i 10 minutter). E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md.` Bruk `console.info` direkte, **ikke** `logger` (loggeren fjerner med vilje felt som `otp`/`code` og e-postadresser, og den skal fortsette å gjøre det). Adressen skrives ikke i linjen. For alle andre mottakere kastes feil med norsk melding: «E-post er ikke satt opp ennå. Bare første admin kan logge inn til Microsoft 365 er koblet til.» Innloggingssiden viser meldingen slik den gjør for andre feil i dag.
   - `rateLimit` i Better Auth er fortsatt på i drift (den slås bare av sammen med `DEV_MAILBOX`). Ingen endring der.
   - **Microsoft 365 (Graph) som enkel adapter, valgt å ta med nå:** `src/core/email/graph.ts` med to `fetch`-kall og ingen ny avhengighet: hent token med klientlegitimasjon fra `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` (scope `https://graph.microsoft.com/.default`), deretter `POST https://graph.microsoft.com/v1.0/users/<MAIL_FROM>/sendMail` med ren tekst, `saveToSentItems: false`. Feil fra Graph gir én norsk feilmelding uten innhold fra svaret i loggen (kan inneholde adresser). Ingen gjenforsøk, ingen vedlegg, ingen HTML, ingen hurtiglagring av token. Begrunnelse for å ta den med: uten adapteren ville «sett de fire verdiene» gi feil i stedet for e-post, og Ståle må kunne skru på Microsoft 365 uten ny PR. Hvis forenkler eller arkitekt mener den likevel er for stor, utsettes den til fase 0b, og `graph` gir en tydelig feil som i dag; prosjektleder avgjør etter forhåndsvurderingen.
   - `.env.example` og `docs/10-utviklingsmiljo.md` oppdateres: `DEV_MAILBOX` lokalt, serverlogg i drift før e-post, Microsoft 365 når de fire er satt.

4. **Helsesjekken viser commit.** `appVersion()` gjør dette allerede når `APP_VERSION` er satt; oppgaven er bare at Bicep/arbeidsflyten setter `APP_VERSION` til kort commit-id, og at utrullingsjobben sjekker svaret. Ingen kodeendring i `src/core/health` utover eventuelt en test som viser formatet `0.2.0 (abc1234)`.

5. **Dokumentasjon for Ståle:** `docs/drift/testmiljo-azure.md` (ny, kort, klarspråk) med steg for steg: (a) lage app-registrering/service principal med **federated credential** for GitHub (OIDC) og gi den rollen «Contributor» på abonnementet eller ressursgruppen, (b) legge inn de fem secrets og to variabler med nøyaktige navn (med `openssl rand -base64 32` for `BETTER_AUTH_SECRET` og et langt tilfeldig databasepassord), (c) merge → se at arbeidsflyten «Utrulling til Azure» er grønn, (d) første innlogging: åpne `https://app-ezprop-test.azurewebsites.net/logg-inn`, skriv inn `SEED_ADMIN_EMAIL`, hent koden fra loggen (App Service → Log stream, eller `az webapp log tail`), (e) legge appen på hjemskjermen på iPad Pro (Del → Legg til på Hjem-skjerm), (f) egen adresse: DNS hos den som har byggcon.no (CNAME `ezprop-test` → `app-ezprop-test.azurewebsites.net`, TXT `asuid.ezprop-test` → verifikasjons-id fra Azure), sett `APP_HOSTNAME`, kjør arbeidsflyten på nytt, (g) Microsoft 365 senere: samme app-registrering som Optiplan bruker for e-post, rettigheten `Mail.Send`, de fire secrets, kjør på nytt. Pluss **anslått månedskostnad** (App Service B1 ca. 130–150 kr, PostgreSQL B1ms ca. 180–220 kr, til sammen ca. 350–450 kr per måned ved dagens kurs; Ståle sammenligner med Optiplans faktura) og hvordan miljøet stoppes/slettes uten å miste koden (`az group delete`). Lenke fra `docs/10-utviklingsmiljo.md` (nytt avsnitt «Testmiljø i Azure»).

6. **ADR 0002 – Testmiljø i Azure** (`docs/adr/0002-testmiljo-azure.md`, skrives av arkitekt): App Service i stedet for Container Apps (ingen registry, ingen Dockerfile, zip av standalone-bygget, gratis sertifikat), PostgreSQL Flexible Server, OIDC fra GitHub, migrering fra arbeidsflyten med midlertidig brannmurregel, og at valgene er antakelser om Optiplans mønster som Ståle bekrefter. `docs/06-arkitektur.md` raden «Hosting» oppdateres til «Azure App Service + PostgreSQL Flexible Server, Sweden Central (ADR 0002). Testmiljø fra fase 1.»

7. Kryss av punktet i `docs/07-utviklingsplan.md`. Øk versjonen i `package.json` til **0.2.0** (første leveranse som kan kjøre utenfor utviklingsmaskinen). Ordlisten i `docs/05-domenemodell.md` avsnitt 8 får «Testmiljø» → `test environment`, «Utrulling» → `deploy`, «Serverlogg» → `server log`. `start.sh` og `scripts/session-start.sh` trenger ingen endring (ingen nye påkrevde miljøvariabler lokalt).

**Ikke med (bevisst utelatt):**
- Ingen utrulling, ingen `az`-kommandoer og ingen Azure-kall fra skyen. Agentene har ikke nøkler og skal ikke ha det. Bicep valideres bare med `az bicep build` **hvis** `az` finnes i miljøet; ellers leses den gjennom av arkitekt og test-leder.
- Ingen produksjonsmiljø, ingen egen «staging». Bare `test`. Navnene tåler `prod` senere.
- Ingen Azure Key Vault (fase 0b, «Nøkkelboks for hemmeligheter»). Secrets ligger i GitHub og i App Service sine appinnstillinger.
- Ingen Container Apps, Docker, registry eller Dockerfile.
- Ingen felles innlogging med Optiplan, ingen felles brukerdatabase (fase 0b, ADR). Testmiljøet har egen database.
- Ingen fillagring (blob) for bilder; bildene i prøvene lagres der kandidaten i oppgave 4 bestemmer.
- Ingen overvåking, varsling eller Application Insights. Loggene leses i App Service.
- Ingen sikkerhetskopi utover det Flexible Server gir som standard (7 dager). Bare oppdiktede data til «Minimum før ekte data» er på plass.
- Ingen innloggingskode i loggen for andre enn første admin, og aldri i den vaskede loggeren.
- Ingen e-postmaler, HTML, vedlegg eller gjenforsøk i Graph-adapteren. Ingen e-post sendes fra tester eller fra skyen (tester bruker falsk `fetch`).
- Ingen endring i CI (`ci.yml`), ingen Playwright-kjøring mot Azure.
- Ingen endringer i testskjemaet eller `offline-trial`.
- Adressen og e-postvalget (spørsmål nr. 6) avgjøres av Ståle; oppgaven forutsetter «kode i serverloggen» og adressen som tom innstilling med `ezprop-test.byggcon.no` som forslag.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ingen endring | ingen endring |
| kontor | ingen endring | ingen endring |
| leder | ingen endring | ingen endring |
| admin | ingen endring. Første admin (`SEED_ADMIN_EMAIL`) er den eneste som kan logge inn før e-post er satt opp | ingen endring |

Ingen nye tilgangsregler, ingen nye spørringer. `expectTenantIsolation` trengs derfor ikke i denne oppgaven; det begrunnes i PR-en.

## Data
Ingen nye tabeller, ingen migreringer. Ingen nye faste koder. Nye miljøinnstillinger: ingen nye navn (`APP_VERSION` og de fire e-postverdiene finnes alt i `env.ts`). `emailTransport` får verdien `serverLog` i stedet for `none`.

## Skjermer
Ingen nye skjermer. Innloggingssiden viser feilmeldingen «E-post er ikke satt opp ennå …» for andre enn første admin (samme feilvisning som i dag). Antall trykk uendret.

## Regler
Ingen regler eller TG-logikk.

## Avgjørelser (prosjektleder 28.10.2026, kan endres av forhåndsvurderingen)
- **App Service, ikke Container Apps.** Enklest: ett zip av `.next/standalone`, ingen registry, gratis sertifikat for egen adresse, logg i nettleseren. Antakelse om at det ligner Optiplan; Ståle bekrefter.
- **Migrering fra arbeidsflyten**, ikke ved oppstart av appen. Standalone-bygget tar ikke med `tsx` og migreringsfilene, og en feilslått migrering skal stoppe utrullingen før ny kode kjører. Prisen er en midlertidig brannmurregel for kjørerens IP (fjernes alltid).
- **Serverlogg bare for første admin**, automatisk når e-post mangler. Ingen ny innstilling, fordi Ståle da har én ting mindre å sette. Bytter seg selv til Microsoft 365 når de fire verdiene er satt.
- **Graph-adapteren tas med** (liten, ingen avhengighet). Se punkt 3 for når den utsettes.
- **Versjon 0.2.0**, ikke 0.1.3: første leveranse som kan kjøre utenfor utviklingsmaskinen.

## Akseptkriterier
- [ ] `infra/azure/main.bicep` og `main.bicepparam` finnes, inneholder ingen verdier for hemmeligheter (grep etter `password`, `secret` gir bare parameternavn), og lager app, plan og database i `swedencentral`.
- [ ] `.github/workflows/deploy-azure.yml` er gyldig YAML, kjører på push til `main`, og jobben `utrulling` hoppes over uten feil når `AZURE_CLIENT_ID` mangler (jobben `sjekk` gir `klar=false`). Test: `node -e` eller en vitest som leser filen og sjekker `on.push.branches`, `needs.sjekk`, `if`-uttrykket og at ingen secrets står som verdier.
- [ ] Arbeidsflyten setter `APP_VERSION` til kort commit-id og feiler hvis `/api/helse` ikke svarer 200 med commit-id i `versjon`.
- [ ] `emailTransport`: `DEV_MAILBOX=1` → `devMailbox`; fire Graph-verdier satt → `graph`; ellers `serverLog`. Delvis satt kaster fortsatt feil i `env.ts` (eksisterende test).
- [ ] `sendEmail` med `serverLog`: mottaker lik `SEED_ADMIN_EMAIL` (uavhengig av store bokstaver) gir én `console.info`-linje som inneholder koden og **ikke** e-postadressen; annen mottaker kaster feil med meldingen «E-post er ikke satt opp ennå …» og skriver ingenting.
- [ ] `sendEmail` med `graph` (falsk `fetch`): henter token med riktig tenant og scope, kaller `sendMail` for `MAIL_FROM` med riktig mottaker, emne og tekst, og kaster norsk feil uten svarinnhold ved 4xx/5xx. Ingen ekte nettverkskall i tester.
- [ ] Loggeren (`src/shared/lib/logger.ts`) er uendret og vasker fortsatt `otp`/`code`/e-post (eksisterende tester grønne).
- [ ] `/api/helse` viser `0.2.0 (abc1234)` når `APP_VERSION=abc1234` (enhetstest av `appVersion`).
- [ ] `docs/drift/testmiljo-azure.md` har stegene (a)–(g), nøyaktige navn på secrets og variabler, anslått månedskostnad og hvordan miljøet slettes. `docs/10-utviklingsmiljo.md` lenker dit.
- [ ] ADR 0002 finnes og `docs/06-arkitektur.md` raden «Hosting» er oppdatert.
- [ ] Ingen «EzProp» i `src/` utenfor `brand.ts`, ingen modellnavn, ingen nye avhengigheter. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): **ikke relevant**, ingen nye spørringer (begrunnes i PR).
- [ ] Virker på iPad-størrelse (e2e): **ikke relevant** for infrastruktur; eksisterende e2e grønne. Ekte iPad testes av Ståle etter utrulling («ferdig når appen åpner på ekte iPad Pro i Safari fra hjemskjermen»).

## Testplan (kort, test-leder utdyper)
- Enhetstester i `src/core/email/email.test.ts` (transportvalg, serverlogg, Graph med falsk `fetch`), `src/core/health/health.test.ts` eller eksisterende (`appVersion`).
- `tests/deploy-workflow.test.ts`: leser `.github/workflows/deploy-azure.yml` og `infra/azure/*.bicep` som tekst og sjekker kriteriene over (ingen YAML-avhengighet nødvendig hvis sjekken gjøres med enkle tekstsøk; hvis `yaml`-pakken ønskes, må den begrunnes).
- Ingen e2e-endring.

## Må bestemmes av Ståle (står i PR-en)
- Spørsmål nr. 6: adressen (`ezprop-test.byggcon.no`?) og om e-post skal gå via Microsoft 365 fra start. Oppgaven forutsetter kode i serverloggen til han svarer, og adressen er en innstilling han setter selv.
- Bekrefte at App Service + PostgreSQL Flexible Server + OIDC ligner Optiplans oppsett. Hvis Optiplan bruker Container Apps, byttes det i egen PR.
- Legge inn secrets og variabler i GitHub (ingen andre kan).

## Åpne spørsmål
- Skal databasen stoppes når den ikke brukes (sparer ca. halve kostnaden, men første åpning tar et minutt)? Ikke i denne oppgaven; nevnes i dokumentasjonen.
