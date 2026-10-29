# Funksjon: Synktjenestene i Azure-testmiljøet (PowerSync og ElectricSQL)

- **Fase:** 1 – Prøve uten nett (forberedelse til prøve A og B)
- **Modul:** drift (`infra/azure`, `.github/workflows`, `docs/drift`). Ingen ny produktkode.
- **Status:** bygget, PR åpnet 29.10.2026 (vurdert av forenkler, arkitekt, sikkerhet-personvern og test-leder)
- **Branch:** `fase1-synk-i-azure` (bygger på `main`)
- **Dato:** 29.10.2026
- **Støtter hovedmål:** Tid: prøve A og B må kjøres på ekte iPad mot testmiljøet før vi velger synkløsning; valget avgjør om befaring uten nett (den største tidsbesparelsen mot IVIT) holder. / Reklamasjoner: prøvene viser om noe går tapt mellom iPad og server, før ekte rapporter bygges oppå. / KI først: nei (se under).

## Problem
Kandidat 1 (PowerSync) og kandidat 2 (ElectricSQL) kjører i dag bare på Macen (`127.0.0.1`). iPadene når dem ikke, så Ståle kan ikke kjøre prøve A og B for disse to. Kandidat 3 (egenbygd) går bare gjennom appen og trenger ingen ny tjeneste. Lar vi være, kan bare én av tre kandidater prøves på ekte iPad, og ADR-en får et svakt grunnlag.

Nye Azure-ressurser koster penger hver måned. Derfor skal alt nytt være **av som standard**, slik at en merge til `main` ikke lager noe nytt før Ståle selv slår det på.

## KI først
Nei. Dette er drift av testmiljøet. KI er ikke med. Det som støttes, er grunnlaget for befaring på iPad der KI-forslag senere vises og godkjennes.

## Brukerhistorier
- Som **Ståle** vil jeg **slå på synktjenestene med én innstilling i GitHub** slik at **jeg kan kjøre prøve A og B for alle tre kandidatene på ekte iPad**, og slå dem av igjen etterpå så de ikke koster penger.
- Som **takstmann i prøven** vil jeg **velge kandidat på listen over testskjemaer og jobbe uten nett** slik at **vi ser hvilken løsning som holder**.

## Omfang
**Med:**
1. **Bryter i Bicep:** ny parameter `enableSyncTrial bool = false` i `infra/azure/main.bicep` (samme fil og samme mønster, Sweden Central, `environmentName` i alle nye navn). Alle nye ressurser har `if (enableSyncTrial)`. Med `false` gir utrullingen nøyaktig de samme ressursene som i dag.
2. **Bryter i GitHub:** variabelen `ENABLE_SYNC_TRIAL` (Settings → Variables, ikke secret). `deploy-azure.yml` sender `enableSyncTrial=true` bare når verdien er nøyaktig `true`; alt annet (også tom) betyr av.
3. **Nye secrets (bare navn i repoet):** `POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET`, `ELECTRIC_DB_PASSWORD`. I Bicep blir de `@secure()`-parametere med tom standardverdi (`powerSyncJwtSecret`, `powerSyncDbPassword`, `electricSecret`, `electricDbPassword`). Ingen output inneholder dem.
   - **Sjekken ligger i eget skript** `scripts/azure/check-sync-secrets.sh` (bash 3.2), som leser navnene fra miljøet. Bryter av: ok uten secrets. Bryter på: mangler en secret, eller har et DB-passord annet enn bokstaver og tall eller under 24 tegn (de brukes i URI-er, som admin-passordet), stopper det med exit 1 og en norsk melding med **navnet**, aldri verdien.
   - Arbeidsflyten: ingen `set -x`, ingen `echo` av verdier, `::add-mask::` på passord og alle avledede verdier (tilkoblingsstrenger) før bruk.
4. **Databasen (bare når bryteren er på):**
   - **wal_level:** `configurations 'wal_level'` = `logical` i Bicep med betingelse, kjedet etter `allowAzureServices` med `dependsOn` (parallelle endringer gir ServerIsBusy). Arbeidsflyten sjekker `az postgres flexible-server parameter show --name wal_level`; er `isConfigPendingRestart` `true`, kjører den `az postgres flexible-server restart` og venter til serveren er klar, før brannmur og migrering. Tåler å kjøres flere ganger. `wal_level` settes ikke tilbake når bryteren slås av (ufarlig, dokumenteres).
   - **Roller:** nytt skript `scripts/azure/sync-trial-roles.ts` (tsx og driveren `postgres` som finnes fra før, ingen ny avhengighet). Kjøres **alltid** etter migrering og seed, mens brannmuren er åpen (ingen `if:` på bryteren i arbeidsflyten). Skriptet velger selv: bryteren på gir roller og rettigheter, bryteren av gir bare rydding av replikeringsplasser (rettet av prosjektleder 29.10.2026 etter testplanens funn 1).
     - Lager `powersync_repl` og `electric_repl` hvis de mangler, og kjører deretter alltid `ALTER ROLE … LOGIN REPLICATION PASSWORD …` (passordbytte virker). Passordet settes inn med `format('… PASSWORD %L', $1)` på serveren og `sql.unsafe` på resultatet; det logges aldri og står aldri i SQL-tekst i filen.
     - Aldri SUPERUSER, CREATEDB, CREATEROLE eller `azure_pg_admin`. CONNECT til `ezprop`, USAGE på `public`, bare SELECT på `trial_forms`, `trial_answers` og `trial_photos`.
     - `powersync_storage` lages med `CREATE DATABASE … OWNER powersync_repl` bare når den mangler i `pg_database`, utenfor transaksjon (ikke i Bicep, da eier admin den). `REVOKE ALL ON DATABASE powersync_storage FROM PUBLIC`; `electric_repl` kan ikke koble til den.
     - Til slutt en sjekk med `has_table_privilege` som feiler hvis en rolle kan lese en annen tabell i `public` enn de tre.
     - **Bryter av:** skriptet sletter ubrukte replikeringsplasser (`powersync%`, `electric_slot%`, `active = false`). Finnes ingen, gjør det ingenting. Ståle kjører aldri SQL selv.
5. **Container Apps (bare når bryteren er på):** ett Container Apps-miljø (forbruksplan) **uten Log Analytics** (`appLogsConfiguration` uten destinasjon; Ståle bruker loggstrømmen i portalen under prøven, og ingen logger med hemmeligheter lagres). To containere, faste versjoner som i `docker-compose.yml`:
   - **PowerSync** `journeyapps/powersync-service:1.27.2`, kommando `start -r unified`, ekstern https-inngang mot port 8080, 0,5 vCPU / 1 GiB, `minReplicas = maxReplicas = 1`. `powersync/config.yaml` og `powersync/sync-rules.yaml` lastes med `loadTextContent` som Container Apps-secrets (navn med små bokstaver og bindestrek) og monteres som secret-volum på `/config` med `path` lik filnavnet.
   - **Electric** `electricsql/electric:1.8.1`, 0,5 vCPU / 1 GiB, 1/1 kopi, `ELECTRIC_USAGE_REPORTING=false`, `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`. **Nettverk: valg (b)**: ekstern https-inngang (targetPort 3000) med `ipSecurityRestrictions` som bare slipper inn `app.properties.possibleOutboundIpAddresses` (split på komma, `/32`, IPv6 filtreres bort), ingen 0.0.0.0/0. `ELECTRIC_SECRET` kreves i tillegg; `ELECTRIC_INSECURE` settes **aldri**.
   - **Hemmeligheter i containerne** (`PS_DATA_SOURCE_URI`, `PS_STORAGE_URI`, `PS_JWT_SECRET_BASE64`, Electrics `DATABASE_URL`, `ELECTRIC_SECRET`) er Container Apps-secrets med `secretRef`, aldri `value` i env.
   - **`PS_JWT_SECRET_BASE64`** regnes ut i Bicep som base64url av `powerSyncJwtSecret`: `base64()` og så `replace` av `+`→`-`, `/`→`_` og fjerning av `=`. Samme nøkkel som appen signerer med. Blir dette feil, avviser PowerSync alle tokens, så det skal testes.
   - Databasetilkoblingene bruker `sslmode=verify-full` (`PS_PG_SSLMODE` og i Electrics `DATABASE_URL`).
   - Begge når databasen gjennom den eksisterende brannmurregelen for Azure-tjenester (ADR 0002; ingen ny åpning). Lagringen er mellomlager, uten Azure Files.
   - Første utrulling med bryteren på: containerne kan starte på nytt et par ganger før rollene finnes. Dokumenteres («tar noen minutter»).
6. **Appen og rekkefølgen i Bicep (ingen løkke):** adressene lages av miljøets domene, `https://<navn>.${containerEnv.properties.defaultDomain}`, så appen avhenger bare av Container Apps-miljøet, og Electric-containeren avhenger av appen (IP-ene). Appinnstillingene står i `siteConfig.appSettings` med `concat` og et betinget array; **ingen** egen `sites/config 'appsettings'`-ressurs (den overskriver alt). Når bryteren er på: `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET`, `ELECTRIC_URL`, `ELECTRIC_SECRET`. `ELECTRIC_URL` brukes bare på serveren, aldri som `NEXT_PUBLIC_*`. `TRIAL_UPLOAD_DIR=/home/data/uploads/trial` settes **alltid**.
7. **Dokumentasjon for Ståle:** alt om kostnad, slå på, sjekke og slå av står **ett sted**, i `docs/drift/testmiljo-azure.md`. `powersync.md` og `electricsql.md` del B skrives om til det som er bygget og lenker dit.
   - *Slå på:* lage fire secrets (hvordan de lages), sette variabelen, kjøre utrullingen, vente noen minutter.
   - *Sjekke:* PowerSync svarer; Electric-adressen gir 403 eller svarer ikke fra mobilnett (bevis på IP-sperren); prøve A og B i appen.
   - *Slå av:* 1) slett Container Apps-miljøet og de to containerne i portalen, 2) sett `ENABLE_SYNC_TRIAL` til noe annet enn `true`, 3) kjør utrullingen; den fjerner appinnstillingene og replikeringsplassene. Tydelig om hvorfor: ellers fylles databasedisken og testmiljøet stopper.
   - Én setning: bare oppdiktede adresser, navn og bilder i prøve A og B, aldri ekte kunder (testmiljøet oppfyller ikke «Minimum før ekte data»).
   - `electricsql.md`: forbeholdet om at App Service-adresser deles med andre Azure-kunder, så IP-sperren er et ekstra lag og `ELECTRIC_SECRET` er den egentlige beskyttelsen. Setningen om at nøkkelen bare skal gå på privat nett skrives om: trafikken går kryptert med https, og loggene lagres ikke. Azure Files-raden i B.2 og B.4 fjernes.
8. **Kostnad:** anslag per måned med bryteren på, i PR-en og `testmiljo-azure.md`. Utgangspunkt (arkitekt): gratiskvoten gjelder per abonnement, så ca. 350 kr for den første og ca. 400 kr for den andre containeren, til sammen ca. 700–850 kr i tillegg til dagens testmiljø. Ingen kostnad for VNet, Files eller logg. Utvikleren sjekker tallet og retter spørsmål nr. 12 hvis det faller utenfor 600–950 kr.
9. **Spørsmål nr. 12** ligger allerede i `docs/09-apne-sporsmal.md`. Ikke blokkerende, siden alt er av.
10. **CI (`ci.yml`):** `az bicep build` og `az bicep lint` på `main.bicep`, uten `azure/login`. Deretter en `jq`-sjekk på den kompilerte JSON-en: alle ressurser av typen `Microsoft.App/*` og `wal_level`-konfigurasjonen har `condition` med `parameters('enableSyncTrial')`.
11. **ADR** `docs/adr/0003-synktjenester-testmiljo.md` (arkitekten skriver den): bryteren, forbruksplan, nettverksvalg (b) med forbeholdet, omstart av databasen, logger lagres ikke, forkastet: VNet og Azure Files.
12. Versjon i `package.json`: 0.2.6 → 0.2.7 (main var 0.2.6 etter PR #15).

**Ikke med (bevisst utelatt):**
- Ingen utrulling til Azure og ingen Azure-kall fra agentene. Ståle slår på selv.
- Ingen ny produktkode, ingen migrering, ingen endring i synkreglene eller i appens synklogikk.
- Ingen tjeneste for kandidat 3 (egenbygd).
- Ingen VNet, subnett eller privat DNS (valg a er forkastet). Ingen Azure Files. Ingen Log Analytics-område.
- Ingen automatisk sletting av containerne når bryteren slås av (Bicep sletter ikke ressurser), og intet eget nedrivingsskript. Replikeringsplassene ryddes av rolleskriptet.
- Ingen egen adresse (domene) for containerne, ingen nøkkelboks (fase 0b), ingen privat nettverk mellom app og database («Minimum før ekte data»).
- Ingen konto hos PowerSync Cloud eller Electric Cloud.
- Ingen produksjonsmiljø.

## Tilgang
Ingen ny tilgangslogikk. Tilgang til synkdata går som før gjennom `src/core/access` i appen og synkreglene. Hver iPad får bare egen organisasjons rader.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som i dag (testskjema) | som i dag |
| kontor | som i dag | som i dag |
| leder | som i dag | som i dag |
| admin | som i dag | som i dag |

## Data
Ingen nye tabeller. Nye databaseroller `powersync_repl` og `electric_repl` og databasen `powersync_storage` i testmiljøet (bare når bryteren er på). Ingen faste koder. Ordlisten: «synkbryter» → `enableSyncTrial` (Bicep) / `ENABLE_SYNC_TRIAL` (GitHub).

## Skjermer
Ingen nye. Takstmannen velger kandidat på listen over testskjemaer som før.

## Regler
Ingen.

## Akseptkriterier
- [ ] CI kjører `az bicep build` og `az bicep lint` på `main.bicep` uten innlogging, og `jq`-sjekken viser at alle nye ressurser har `condition` med `enableSyncTrial`. Standardverdien `false` står i teksten.
- [ ] Med bryteren av kommer ingen nye appinnstillinger utover `TRIAL_UPLOAD_DIR` (betinget array, sjekket i test).
- [ ] Uten variabelen `ENABLE_SYNC_TRIAL` er utrullingen den samme som i dag; uten Azure-nøkler hoppes den over som før.
- [ ] `check-sync-secrets.sh`: bryter av gir ok; bryter på og én secret mangler gir exit 1 og norsk melding med navnet, aldri verdien (testet for alle fire); alle satt gir exit 0 uten at verdiene skrives ut.
- [ ] Ingen hemmeligheter i repoet, Bicep-utdata eller loggene. Containerhemmeligheter går via `secretRef`; nye parametere er `@secure()`; arbeidsflyten har ingen `set -x` og maskerer passord og tilkoblingsstrenger.
- [ ] `PS_JWT_SECRET_BASE64` er base64url av samme nøkkel som appen bruker (testet).
- [ ] Electric har bare Allow for appens utgående adresser, ingen 0.0.0.0/0, `ELECTRIC_SECRET` kreves og `ELECTRIC_INSECURE` finnes ikke. Ståles sjekk fra mobilnett står i `testmiljo-azure.md`.
- [ ] Synktilkoblingene bruker `sslmode=verify-full`.
- [ ] Rolleskriptet (integrasjonstest mot testdatabasen, én fil, serielt): kan kjøres to ganger; rollene har SELECT, men ikke INSERT/UPDATE/DELETE, på de tre `trial_*`; ingen SELECT på andre tabeller i `public`; REPLICATION på, SUPERUSER/CREATEDB/CREATEROLE av; `powersync_storage` eies av `powersync_repl`; passordet står ikke i skriptfilen; rydder ubrukte replikeringsplasser når bryteren er av.
- [ ] Bildeversjonene er like i Bicep og `docker-compose.yml`.
- [ ] `docs/drift/testmiljo-azure.md` sier i klarspråk hvordan Ståle slår på, sjekker og slår av, hva det koster per måned, og at bare oppdiktede data brukes. `powersync.md` og `electricsql.md` lenker dit.
- [ ] `tests/deploy-workflow.test.ts` er utvidet (nye secrets, `ENABLE_SYNC_TRIAL`, mønstre for hemmeligheter, driftsdokumentet, spørsmål nr. 12, CI-steget).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne, versjon 0.2.7.
- [ ] Bruker i annen organisasjon får ikke tilgang: uendret, dekket av eksisterende tester for synkreglene og shape-proxyen. Ingen ny spørring som tar `organizationId`.
- [ ] Admin stenges ikke ute: rollematrisen er uendret.
- [ ] Virker på iPad-størrelse: uendret (ingen nye skjermer).

## Funn til ADR-en
- REPLICATION gir synkrollene (`powersync_repl` og `electric_repl`) mulighet til å lese hele databasen via replikeringsprotokollen, uavhengig av lesetilgangen (SELECT). Det er akseptert for testmiljøet, der det bare finnes oppdiktede data. I produksjon må dette vurderes, for eksempel med en egen database for synkdata, eller med en tjeneste som ikke trenger REPLICATION. Kilde: gjennomgangen av PR #17, 29.10.2026.

## Åpne spørsmål
- Nr. 12 (nytt): vil Ståle slå på synktjenestene i testmiljøet, og hvor lenge? Ikke blokkerende.
- Nr. 10 og 11 (leverandørvalg) gjelder fortsatt før ADR-en. Ikke blokkerende.
- Forbeholdet i `docs/drift/electricsql.md` (om Electric godtar en ferdiglaget publikasjon uten å eie tabellene) avklares først når Ståle har slått på tjenesten i Azure.

## Roller
- **arkitekt:** valgene er tatt (se «Avgjort ved uenighet»). Skriver ADR 0003.
- **sikkerhet-personvern:** har godkjent nettverksvalg (b) med vilkårene over; gjennomgår PR-en.
- **utvikler:** Bicep, `deploy-azure.yml`, `ci.yml`, `check-sync-secrets.sh`, `sync-trial-roles.ts` og dokumentasjon.
- **testskriver (i parallell):** utvidelse av `tests/deploy-workflow.test.ts`, skripttest for `check-sync-secrets.sh` (Vitest med spawn), integrasjonstest for `sync-trial-roles.ts`. Navnene i dette kortet er kontrakten mellom de to.
- **test-leder:** godkjenner før PR.
- Ingen UX, UI, KI eller fag.

## Avgjort ved uenighet (prosjektleder, 29.10.2026)
- **Rettelser etter testplanen (funn 1–5):**
  1. Rolleskriptet kjøres alltid (se punkt 4). Ellers blir replikeringsplassene liggende når bryteren slås av.
  2. Den eksisterende testen «alle passord og hemmeligheter er @secure() og uten standardverdi» endres: nøyaktig `= ''` er lov bare for de fire nye synkparameterne.
  3. Navnet på lagringsdatabasen er valgfritt i skriptet (`storageDatabase`, standard `powersync_storage`), fordi Docker allerede har en `powersync_storage`. Testen bruker `powersync_storage_test`.
  4. `scripts/cloud-setup.sh` gir `ezprop` `CREATEROLE REPLICATION` hver gang (bash 3.2), så testene i skyen kjører med samme rettigheter som admin i Azure.
  5. PostgreSQL 16: før `CREATE DATABASE … OWNER powersync_repl` gir skriptet seg selv retten til å bruke rollen (`GRANT powersync_repl TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`) når det ikke kjører som superbruker. Testen «virker uten superbruker, slik som i Azure» viser at det virker.
- **Kontrakten for rolleskriptet** er `scripts/azure/sync-trial-roles.types.ts`. Testplanens avsnitt 9 er rettet til samme navn: `applySyncTrialRoles(input: SyncTrialRolesInput): Promise<SyncTrialRolesResult>`, `readSyncTrialRolesInput(env)` og `toPowerSyncJwtKey(secret)`, alle eksportert fra `scripts/azure/sync-trial-roles.ts`. `appDatabaseName` er fjernet; databasen for `GRANT CONNECT` tas fra `current_database()`.
- **Omstart for wal_level: arbeidsflyten gjør det** (arkitekt), ikke Ståle i portalen (forenkler). Ståle er ikke utvikler, og hvert manuelt steg er et sted prøven kan stoppe. Omstarten skjer bare når Azure melder at den trengs, og står i loggen og i dokumentet, så den skjer ikke ubemerket.
- **PowerSync-konfig: secret-volum med `loadTextContent`** (arkitekt), ikke miljøvariabler (forenkler). Volumet er kjent å virke; miljøvariant måtte først prøves i 1.27.2 uten Azure. Begge laster fra repoet.
- **Logg: ingen Log Analytics** (forenkler og arkitekt). Sikkerhet-personvern ba om det eksisterende området «logs», men testmiljøet har ikke noe Log Analytics-område i dag (App Service logger til filsystemet, 3 dager). Uten lagrede logger er det heller ingen hemmeligheter i logg, som er strengere enn ønsket.
- **Rolleskript i TypeScript** (arkitekt), ikke `.sql`/psql (test-leder, sikkerhet-personvern). Det er en egen fil, passordet går som parameter via `format(%L)` og aldri i filen, og det kan testes direkte fra Vitest uten psql. Vilkårene fra begge er dermed oppfylt.
- **Sjekken av secrets i eget skript** (test-leder), filnavn på engelsk: `scripts/azure/check-sync-secrets.sh`.
- **Testskriver tas med** (test-leder): det kommer to nye skript som trenger tester, og testfilen ville ellers blitt rød.
- Ingenting her er fag, pris, personvern eller ny funksjon for Ståle utover spørsmål nr. 12.
