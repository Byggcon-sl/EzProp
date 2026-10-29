# Testplan: Synktjenestene i Azure-testmiljøet (PowerSync og ElectricSQL)

- **Oppgavekort:** `docs/funksjoner/fase1-synk-i-azure.md`
- **Fase:** 1 – Prøve uten nett (forberedelse til prøve A og B)
- **Branch:** `fase1-synk-i-azure` (bygger på `main`)
- **Dato:** 29.10.2026
- **Laget av:** test-leder, før koding. Navnene er kontrakten for testskriver og utvikler. Utvikler leser avsnitt 9 «Krav til koden som testene bygger på».
- **Støtter hovedmål:** Tid (prøve A og B på ekte iPad for alle tre kandidatene, grunnlaget for valget av synkløsning) og reklamasjoner (prøvene viser om noe går tapt mellom iPad og server). KI først: nei, dette er drift.

## 0. Funn i oppgavekortet (for prosjektleder, rettes før bygging)

1. **Motstrid om når rolleskriptet kjøres.** Punkt 4 sier «bare når bryteren er på», men samme punkt og «Slå av» sier at skriptet rydder replikeringsplasser når bryteren er **av**. Testplanen legger til grunn: **steget kjører alltid** (etter seed, mens brannmuren er åpen), og skriptet selv velger på/av ut fra `ENABLE_SYNC_TRIAL`. Ellers blir plassene liggende og disken fylles. (Alvorlig hvis ikke rettet.)
2. **Eksisterende test stopper `@secure()` med standardverdi.** «alle passord og hemmeligheter er @secure() og uten standardverdi» i `tests/deploy-workflow.test.ts` blir rød med `= ''` på de fire nye parameterne. Testen endres: standardverdi er bare lov for de fire, og bare `= ''`. De tre gamle skal fortsatt være uten standardverdi.
3. **`powersync_storage` finnes fra før i Docker** (`scripts/docker-init.sql`, eier `ezprop`). Integrasjonstesten kan derfor ikke bruke det navnet. Skriptet må ta navnet på lagringsdatabasen som valgfri parameter (standard `powersync_storage`), og testen bruker `powersync_storage_test` (avsnitt 9).
4. **Skymiljøet kjører testene uten superbruker** (`scripts/cloud-setup.sh`: `ezprop` har bare `createdb`). Rolleskriptet trenger `CREATEROLE` og `REPLICATION`, som admin i Azure. `cloud-setup.sh` må gi `ezprop` disse (alltid, ikke bare når rollen lages). Det er en fordel: da kjører testen med samme rettigheter som i Azure.
5. **PostgreSQL 16 og `CREATE DATABASE … OWNER powersync_repl`:** en bruker med `CREATEROLE` som ikke er superbruker, må ha `SET`-rett på rollen for å gi den eierskap. I CI og Docker er `ezprop` superbruker, så feilen viser seg ikke der. Derfor testen «virker uten superbruker, slik som i Azure» (avsnitt 4). Uten den kan første utrulling hos Ståle stoppe.

## 1. Hva som finnes fra før (og brukes)

- `tests/deploy-workflow.test.ts`: tekstsjekker av `deploy-azure.yml`, `main.bicep` og driftsdokumentet. Utvides (avsnitt 3). Hjelperne `read`, `secretNames`, `varNames`, `after`, `lineIndexes` brukes videre.
- `tests/powersync/config.test.ts` og `tests/electricsql/config.test.ts`: synkregler filtrerer på `organization_id` og `deleted_at`; Electric har aldri `NEXT_PUBLIC_`. Må være grønne **uten endring**.
- Tenant-isolasjon for synkdata: `src/modules/offline-trial/server/electric-shape.test.ts`, `trial-queries.test.ts`, `changes-since.test.ts` (alle med `expectTenantIsolation`). Må være grønne uten endring.
- `src/modules/offline-trial/server/sync-token.ts` (`issueSyncToken`, `SYNC_TOKEN_KEY_ID`): nøkkelen er UTF-8-byte av `POWERSYNC_JWT_SECRET`. `jose` finnes fra før.
- `tests/test-env.ts` (`testDatabaseUrl()`), `vitest.config.ts` (`fileParallelism: false`).
- `tests/factories.ts`, `e2e/helpers.ts`: brukes ikke (ingen ny spørring med `organizationId`, ingen ny skjerm).
- Ingen `az` eller `bicep` i skymiljøet. Bicep kompileres bare i CI (avsnitt 5).

## 2. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Hvordan det vises |
|---|---|
| Tilgang per rolle uendret | `git diff main -- src/core/access docs/02-roller-og-tilgang.md` er tom (test-leder sjekker). Eksisterende tilgangstester grønne. |
| Tenant-isolasjon | Ingen ny spørring som tar `organizationId`. `git diff main -- powersync/sync-rules.yaml src/modules` er tom. Bicep laster samme `sync-rules.yaml` som er testet (avsnitt 3, «PowerSync-konfig lastes fra repoet»). Eksisterende `expectTenantIsolation`-tester grønne. |
| Replikeringsrollene ser bare de tre `trial_*`-tabellene | Integrasjonstestene i avsnitt 4 (SELECT ja, skriving nei, ingen andre tabeller). Dette er tenant-grensen på databasenivå: synkreglene og shape-proxyen filtrerer per organisasjon, rollene kan ikke lese brukere, sesjoner eller revisjonslogg. |
| Admin stenges aldri ute | Rollematrisen er uendret (diff over). Rolleskriptet endrer aldri admin-rollen: testen «rører ikke andre roller» (avsnitt 4). |
| Myk sletting | Ingen ny tabell, ingen sletting av data. Rolleskriptet sletter bare replikeringsplasser (ikke data). Synkreglene filtrerer fortsatt `deleted_at` (eksisterende test). |

## 3. Tekstsjekker av drift-filene (`tests/deploy-workflow.test.ts`, utvides)

Ingen YAML-pakke, ingen Azure-kall. Konstantene utvides:

- `ALLOWED_SECRETS` += `POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET`, `ELECTRIC_DB_PASSWORD`. `REQUIRED_SECRETS` endres ikke (de nye er bare påkrevd når bryteren er på).
- `ALLOWED_VARS` += `ENABLE_SYNC_TRIAL`.
- Ny: `SYNC_SECRET_PARAMS = ["powerSyncJwtSecret", "powerSyncDbPassword", "electricSecret", "electricDbPassword"]`.

### `.github/workflows/deploy-azure.yml`

| Testnavn | Viser |
|---|---|
| «bruker bare de dokumenterte navnene på secrets og variabler» (finnes, utvides) | De fire nye secrets og `ENABLE_SYNC_TRIAL` er tillatt **og brukes**. |
| «synkbryteren er på bare når ENABLE_SYNC_TRIAL er nøyaktig true» | `vars.ENABLE_SYNC_TRIAL` sammenlignes med `'true'` (`== 'true'` i uttrykk, eller `= "true"` i bash). Ingen annen sammenligning (ikke `!= ''`, ikke `contains`). `enableSyncTrial=` sendes til både `validate` og `create`. |
| «secrets for synk sjekkes med skriptet før Bicep valideres» | `scripts/azure/check-sync-secrets.sh` kalles, og kommer før `az deployment group validate`. Steget får de fire secrets og `ENABLE_SYNC_TRIAL` under `env:`, ikke i `run:`-linjen. |
| «ingen set -x og ingen echo av hemmeligheter» | Ingen `set -x` i filen. Ingen linje har `echo` sammen med noen av de fire nye navnene eller `PASSWORD`/`SECRET` (unntatt `::add-mask::`). |
| «passord og tilkoblingsstrenger for synk maskeres før bruk» | `::add-mask::` forekommer for `POWERSYNC_DB_PASSWORD` og `ELECTRIC_DB_PASSWORD`, og før `sync-trial-roles.ts` kalles. |
| «ingen hemmeligheter som verdier» (finnes, utvides) | Mønsteret dekker også de fire nye navnene: de får bare `${{ secrets.… }}`. |
| «wal_level sjekkes og databasen startes på nytt bare når Azure ber om det» | `parameter show` med `wal_level`, `isConfigPendingRestart`, `flexible-server restart`, og en venting (`flexible-server wait` eller løkke med `show` og `Ready`). Alt dette kommer etter `az deployment group create` og før `firewall-rule create` med `github-runner`. |
| «rolleskriptet kjører alltid etter seed, mens brannmuren er åpen» | `sync-trial-roles.ts` kommer etter `pnpm db:seed` og før `firewall-rule delete`. Steget har **ingen** `if:` som avhenger av `ENABLE_SYNC_TRIAL` (se funn 1). Steget har `DATABASE_URL`, `ENABLE_SYNC_TRIAL`, `POWERSYNC_DB_PASSWORD` og `ELECTRIC_DB_PASSWORD` under `env:`. |
| «uten synkbryteren er resten av utrullingen som før» | De eksisterende testene for rekkefølge (validate før create, brannmur, migrering, seed, helsesjekk, zip) er grønne uendret. Jobben `check` hopper fortsatt over uten `AZURE_CLIENT_ID`. |

### `infra/azure/main.bicep`

| Testnavn | Viser |
|---|---|
| «alle passord og hemmeligheter er @secure() og uten standardverdi» (finnes, endres) | Som før for de tre gamle. De fire i `SYNC_SECRET_PARAMS` er `@secure()` og har enten ingen standardverdi eller nøyaktig `= ''`. Ingen andre `= ''`-unntak. |
| «synkbryteren finnes og er av som standard» | `param enableSyncTrial bool = false` står i filen. |
| «alle nye ressurser har betingelsen enableSyncTrial» | Hver linje `resource … 'Microsoft.App/…'` har `= if (enableSyncTrial)`. Det samme for ressursen med `'wal_level'`. Minst tre `Microsoft.App`-ressurser (miljø og to containere). |
| «wal_level settes til logical etter brannmurregelen» | Ressursen for `wal_level` har `value: 'logical'` og `dependsOn` med ressursen for brannmurregelen for Azure-tjenester. |
| «ingen VNet, Files eller Log Analytics» | Ingen `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.OperationalInsights`, `logAnalyticsConfiguration`, `AzureFile`. |
| «containerne bruker samme faste versjoner som docker-compose» | Bildene i Bicep er nøyaktig `journeyapps/powersync-service:<tag>` og `electricsql/electric:<tag>` med taggene lest fra `docker-compose.yml`. Ingen `latest`. |
| «PowerSync startes riktig med konfig fra repoet» | `start`, `-r`, `unified` i kommandoen; `targetPort: 8080`; `loadTextContent('../../powersync/config.yaml')` og `loadTextContent('../../powersync/sync-rules.yaml')`; volumtype `Secret`, `mountPath: '/config'`, og `path: 'config.yaml'` og `path: 'sync-rules.yaml'`. Navn på Container Apps-secrets er bare små bokstaver, tall og bindestrek. |
| «Electric er sperret til appens utgående adresser» | `ipSecurityRestrictions`, `possibleOutboundIpAddresses`, `split(`, `/32`, `action: 'Allow'`, `targetPort: 3000`. Ingen `0.0.0.0` og ingen `action: 'Deny'`-regel som åpner alt. Ingen `ELECTRIC_INSECURE` i noen fil under `infra/`. `ELECTRIC_USAGE_REPORTING` = `'false'`, `ELECTRIC_MANUAL_TABLE_PUBLISHING` = `'true'`. |
| «hemmeligheter i containerne går via secretRef» | For `PS_DATA_SOURCE_URI`, `PS_STORAGE_URI`, `PS_JWT_SECRET_BASE64`, `DATABASE_URL` (Electric) og `ELECTRIC_SECRET` i containerens `env`: neste linje(r) i samme blokk har `secretRef:`, aldri `value:`. |
| «synktilkoblingene krever sertifikatsjekk» | `PS_PG_SSLMODE` har `'verify-full'`; Electrics `DATABASE_URL` inneholder `sslmode=verify-full`. Ingen `sslmode=require`/`disable` i filen. Passordene går gjennom `uriComponent(`. |
| «containerne har én kopi og liten størrelse» | `minReplicas: 1` og `maxReplicas: 1` for begge; `cpu: json('0.5')`, `memory: '1Gi'`. |
| «appen bruker miljøets domene, uten egen appsettings-ressurs» | `defaultDomain` brukes i `POWERSYNC_URL` og `ELECTRIC_URL`. Ingen ressurs av typen `Microsoft.Web/sites/config` med navnet `'appsettings'`. |
| «synkinnstillingene i appen er betinget, TRIAL_UPLOAD_DIR alltid» | En `var` med `enableSyncTrial ? [ … ] : []` inneholder `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET`, `ELECTRIC_URL`, `ELECTRIC_SECRET`, og ingen av de fire står utenfor den. `appSettings: concat(` tar med den. `TRIAL_UPLOAD_DIR` med `/home/data/uploads/trial` står i den faste listen. Ingen `NEXT_PUBLIC_` i filen. |
| «PS_JWT_SECRET_BASE64 er base64url av samme nøkkel som appen» | Uttrykket for Container Apps-secreten bruker `base64(powerSyncJwtSecret)` med `replace` av `'+'`→`'-'`, `'/'`→`'_'` og `'='`→`''`. Samme parameter `powerSyncJwtSecret` gir appinnstillingen `POWERSYNC_JWT_SECRET`. |
| «ingen hemmelige utdata» (finnes) | Dekker også de nye: ingen `output` med `secret`, `password`, `DATABASE_URL`, `URI` eller `connectionString`. |
| «ressursnavn bruker environmentName» (finnes, utvides) | Navnene på Container Apps-miljøet og de to containerne bruker `${environmentName}`. |

### Nøkkelen for PowerSync (egen `describe` i samme fil, eller `tests/powersync/jwt-key.test.ts`)

| Testnavn | Viser |
|---|---|
| «Bicep-omformingen gir samme base64url som start.sh og Node» | En hjelpefunksjon i testen gjør det samme som Bicep-uttrykket (base64 av UTF-8, så de tre `replace`). For minst fire nøkler, blant dem en som gir `+` og `/` i vanlig base64 (f.eks. byte `0xfb 0xff`, og en med `æøå`) og en med lengde som gir `=`: resultatet er lik `Buffer.from(s, "utf8").toString("base64url")`. |
| «et token fra appen godtas med nøkkelen slik Bicep lager den» | `POWERSYNC_JWT_SECRET` (oppdiktet, minst minstelengden, ikke lik `BETTER_AUTH_SECRET`), `POWERSYNC_URL` og `BETTER_AUTH_URL=http://localhost:3000` settes med `vi.stubEnv`. Token fra `issueSyncToken` verifiseres med `jose.jwtVerify` mot `{ kty: "oct", alg: "HS256", kid: SYNC_TOKEN_KEY_ID, k: <Bicep-omformingen> }` og `audience: "powersync"`. Med en annen nøkkel avvises det. `vi.unstubAllEnvs()` i `afterEach`. |

### `.github/workflows/ci.yml`

| Testnavn | Viser |
|---|---|
| «CI bygger og linter Bicep uten innlogging» | `az bicep build` og `az bicep lint` med `infra/azure/main.bicep`. Ingen `azure/login` i `ci.yml`, og ingen `secrets.` i jobben. |
| «CI sjekker at alle synkressurser har betingelsen» | `jq` brukes på den kompilerte JSON-en, og teksten nevner `Microsoft.App` og `enableSyncTrial`. |

### Dokumentasjon

| Testnavn | Viser |
|---|---|
| «driftsdokumentet nevner alle secrets og variabler arbeidsflyten bruker» (finnes) | Dekker de nye navnene automatisk. |
| «driftsdokumentet forklarer å slå på, sjekke og slå av synktjenestene» | `testmiljo-azure.md` inneholder `ENABLE_SYNC_TRIAL`, de fire secret-navnene, `Slå på`, `Slå av`, `403`, `mobilnett`, `replikeringsplass`, `oppdiktede`, `Minimum før ekte data`, `wal_level` og en linje med `kr` og `måned`. |
| «kostnaden i driftsdokumentet ligger innenfor anslaget» | Tallet i kroner per måned for synktjenestene (første tall foran `kr` i avsnittet om synk) er mellom 600 og 950, eller et spenn innenfor det. Feiler den, rettes spørsmål nr. 12 (kortet punkt 8). |
| «powersync.md og electricsql.md lenker til driftsdokumentet» | Begge inneholder `testmiljo-azure.md`. `electricsql.md` inneholder ikke `Azure Files`, og inneholder `ELECTRIC_SECRET` og ordet `https`. |
| «spørsmål nr. 12 finnes» | `docs/09-apne-sporsmal.md` har et spørsmål nr. 12 som nevner synktjenestene og `kr`. |
| «ADR 0003 finnes med valgene» | `docs/adr/0003-synktjenester-testmiljo.md` finnes og nevner `enableSyncTrial`, `VNet`, `Azure Files` og `wal_level`. |

## 4. Integrasjonstester mot testdatabasen (`scripts/azure/sync-trial-roles.test.ts`, én fil, serielt)

Bruker `testDatabaseUrl()`. Passordene lages i testen (`randomBytes(18).toString("hex")`, bare bokstaver og tall, 36 tegn). Lagringsdatabasen heter `powersync_storage_test`. `afterAll`: `DROP DATABASE IF EXISTS powersync_storage_test`, `DROP OWNED BY powersync_repl, electric_repl` i testdatabasen, `DROP ROLE IF EXISTS` for begge (feilkode `2BP01`, avhengigheter i en annen database, tåles). Testene tåler at rollene finnes fra før.

| Testnavn | Viser |
|---|---|
| «lager rollene og lagringsdatabasen og kan kjøres to ganger» | To kall med bryteren på gir ingen feil. `pg_roles` har begge rollene. `powersync_storage_test` finnes og eies av `powersync_repl`. |
| «rollene har REPLICATION, men ikke SUPERUSER, CREATEDB eller CREATEROLE» | `rolreplication` sann, `rolsuper`, `rolcreatedb`, `rolcreaterole` usanne, `rolcanlogin` sann. Ingen av dem er medlem av `azure_pg_admin` eller `pg_read_all_data` (`pg_auth_members`). |
| «rollene kan lese de tre trial-tabellene, men ikke skrive» | For begge roller og alle tre tabeller: `has_table_privilege(…, 'SELECT')` sann; `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` usanne. |
| «rollene kan ikke lese andre tabeller i public» | For alle tabeller i `public` utenom de tre: `has_table_privilege(…, 'SELECT')` usann for begge roller (gjelder blant annet `users`, `sessions`, `employees`, `audit_log`, `organizations`). |
| «innlogging med passordet virker, og rollen ser bare trial-tabellene» | Kobler til testdatabasen som `powersync_repl` med passordet: `select 1 from trial_forms limit 1` virker, `select 1 from users limit 1` feiler med manglende rettighet. |
| «passordbytte virker» | Andre kall med nye passord; innlogging med det nye passordet virker. |
| «electric_repl kan ikke koble til lagringsdatabasen» | `has_database_privilege('electric_repl', 'powersync_storage_test', 'CONNECT')` usann; `PUBLIC` har ikke `CONNECT` på den. |
| «sjekken stopper hvis en rolle kan lese en annen tabell» | Testen gir `electric_repl` `SELECT` på `users`, kaller skriptet: avvises med norsk melding som nevner `electric_repl` og `users`, uten passordet. Rettigheten fjernes etterpå. |
| «passord står ikke i loggen eller i feilmeldinger» | `console.log/info/warn/error` spionert under alle kall: ingen utskrift inneholder noen av passordene. Feilen i testen over inneholder ikke passordet. |
| «bryteren av rydder ubrukte replikeringsplasser og ingenting annet» | Testen lager **fysiske** plasser (virker uten `wal_level=logical`, også i CI): `powersync_testplan_1`, `electric_slot_testplan_1` og `annen_testplan_1`. Kall med bryteren av: de to første er borte, `annen_testplan_1` finnes (ryddes av testen). Kall igjen uten plasser: ingen feil. |
| «bryteren av lager ingen roller og trenger ingen passord» | Med rollene fjernet først (eller i en ren database): kall med bryteren av og uten passord gir ingen feil og lager verken roller eller lagringsdatabase. |
| «bryteren på uten passord stopper med navnet» | Bryteren på, `powerSyncPassword` tom: avvises med melding som inneholder `POWERSYNC_DB_PASSWORD`. Samme for `ELECTRIC_DB_PASSWORD`. |
| «rører ikke andre roller» | Gjeldende bruker (admin) har de samme rolleegenskapene og medlemskapene før og etter kallene. |
| «virker uten superbruker, slik som i Azure» | Er testbrukeren superbruker (CI, Docker), lager testen en innloggingsrolle `sync_trial_admin_sim` med `CREATEROLE CREATEDB REPLICATION` (ikke superbruker), gir den samme rettigheter på testdatabasen som admin har i Azure, og kjører skriptet som den. Er testbrukeren ikke superbruker (skymiljøet), kjøres skriptet som den. I begge tilfeller: rollene og `powersync_storage_test` med riktig eier lages. Rollen ryddes i `afterAll`. |
| «passordet står ikke i skriptfilen» | Filteksten har `format(` med `%L`, ingen `PASSWORD '` og ingen strengmal med `PASSWORD ${`. Ingen `rolsuper`/`SUPERUSER`/`CREATEROLE`/`CREATEDB` blir gitt (`GRANT azure_pg_admin`, `SUPERUSER` uten `NO`-foran finnes ikke i SQL-teksten). |

## 5. Skripttest (`scripts/azure/check-sync-secrets.test.ts`, Vitest med `spawnSync("bash", [script])`)

Miljøet bygges fra bunnen (`PATH` og `HOME` fra `process.env`, ellers bare det testen setter). Oppdiktede verdier: passord `a1`×12 (24 tegn), nøkler `oppdiktet-…` (minst 32 tegn).

| Testnavn | Viser |
|---|---|
| «bryter av gir ok uten secrets» | Uten `ENABLE_SYNC_TRIAL`, og med `ENABLE_SYNC_TRIAL=false`, `TRUE`, `ja`, tom: exit 0. |
| «bryter på og én secret mangler gir exit 1 med navnet» | For hver av de fire, med de tre andre satt: exit 1, utskriften (stdout + stderr) inneholder navnet og er på norsk (inneholder `mangler`). Kjøres som `it.each` over alle fire. |
| «aldri verdiene i utskriften» | I alle tilfellene over og under: ingen satt verdi står i stdout eller stderr. |
| «DB-passord som ikke bare er bokstaver og tall stopper» | `POWERSYNC_DB_PASSWORD` med `@`, `/`, `%` eller mellomrom: exit 1 med navnet. Samme for `ELECTRIC_DB_PASSWORD`. |
| «DB-passord under 24 tegn stopper» | 23 tegn: exit 1 med navnet. 24 tegn: exit 0. |
| «alle satt gir exit 0» | Alle fire gyldige og `ENABLE_SYNC_TRIAL=true`: exit 0, ingen verdi i utskriften. |
| «virker med bash 3.2» | `bash -n` er grønn. Filen har ikke `declare -A`, `mapfile`, `readarray`, `${…,,}`, `${…^^}`, `;&` eller `set -x`. Første linje er `#!/usr/bin/env bash` eller `#!/bin/bash`. |

## 6. Regeltester

Ingen. Kortet har ingen regler eller TG-logikk, og synkreglene endres ikke (`git diff main -- powersync/` er tom unntatt eventuelle kommentarer i `config.yaml`; test-leder sjekker).

## 7. E2E (Playwright, PC og iPad, også uten nett)

Ingen ny skjerm og ingen endring i appens synklogikk. Hele den eksisterende pakken kjøres i begge prosjektene (`pc`, `ipad`) og skal være grønn uendret, særlig `e2e/fase-1-powersync.spec.ts`, `e2e/fase-1-electricsql.spec.ts` og `e2e/fase-1-egenbygd.spec.ts` (velge kandidat, jobbe uten nett, synke etterpå). Den ekte prøven på iPad mot Azure gjør Ståle etter `docs/funksjoner/fase1-prove-ab-*.md`; den kan ikke automatiseres her.

## 8. Det som ikke kan testes her (sjekkes av Ståle, står i `testmiljo-azure.md`)

- At Azure faktisk lager containerne, at `wal_level` slår inn etter omstart og at PowerSync svarer over https.
- At Electric gir 403 eller ikke svarer fra mobilnett (IP-sperren).
- At appen i Azure når begge (prøve A og B i appen).
- At containerne og miljøet er slettet etter prøven (portalen), og at neste utrulling har fjernet appinnstillingene.

## 9. Krav til koden som testene bygger på (for utvikler)

1. `scripts/azure/sync-trial-roles.ts` følger kontrakten i `scripts/azure/sync-trial-roles.types.ts` (rettet av prosjektleder 29.10.2026, gjelder foran tidligere utkast her) og eksporterer
   ```ts
   export const applySyncTrialRoles: ApplySyncTrialRoles; // (input: SyncTrialRolesInput) => Promise<SyncTrialRolesResult>
   export const readSyncTrialRolesInput: ReadSyncTrialRolesInput; // (env) => SyncTrialRolesInput
   export const toPowerSyncJwtKey: ToPowerSyncJwtKey; // (secret) => base64url av UTF-8
   ```
   Input når bryteren er på: `{ enabled: true, adminDatabaseUrl, powerSyncDbPassword, electricDbPassword, storageDatabase? }` (standard `powersync_storage`). Når av: `{ enabled: false, adminDatabaseUrl }`. Testene i avsnitt 4 bruker disse navnene («`powerSyncPassword` tom» betyr `powerSyncDbPassword: ""`). Skriptet har en tynn kjøredel (bare når filen kjøres direkte) som bruker `readSyncTrialRolesInput(process.env)`. Import fra testen skal ikke starte kjøredelen.
2. Databasenavnet for `GRANT CONNECT` tas fra tilkoblingen (`current_database()`), ikke hardkodet `ezprop`, så testen kan bruke `ezprop_test`.
3. Feilmeldinger er på norsk og nevner navn (rolle, tabell, miljøvariabel), aldri verdier.
4. Med bryteren av: bare rydding av ubrukte plasser (`powersync%`, `electric_slot%`, `active = false`); ingen passord kreves.
5. `scripts/cloud-setup.sh` gir `ezprop` `CREATEROLE REPLICATION` hver gang (funn 4). Bash 3.2.
6. `.env.example`: ingen nye verdier trengs (navnene finnes). `docker-compose.yml` endres ikke (versjonene er fasit).

## 10. Når test-leder godkjenner

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjon 0.2.6.
- Alle testnavn over finnes (eller en likeverdig test med begrunnelse i PR-en).
- Avvises hvis testene i avsnitt 4 for rettigheter og «virker uten superbruker» mangler, eller hvis funn 1 ikke er rettet.
- CI-jobben for Bicep er grønn på PR-en (kan ikke kjøres lokalt).
