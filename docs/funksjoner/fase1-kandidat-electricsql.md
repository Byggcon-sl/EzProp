# Funksjon: Andre kandidat for drift uten nett – ElectricSQL koblet til testskjemaet

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (fra oppgave 3 og 4). Ingen nye tabeller.
- **Status:** runde 1 ferdig 28.10.2026 (forenkler, arkitekt, sikkerhet-personvern, test-leder). Avgjørelsene står nederst under «Avgjørelser etter runde 1» og er bindende; der kortet over og avgjørelsene sier ulikt, gjelder avgjørelsene. Neste: testplan (test-leder), så bygging.
- **Branch:** `fase1-kandidat-electricsql`, **bygger på `fase1-kandidat-powersync` (PR #8)**. PR åpnes mot `fase1-kandidat-powersync` til PR #8 er merget, deretter mot `main`.
- **Dato:** 28.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, punktet «Kandidater satt opp mot samme testskjema …», delpunktet **«Kandidat 2, ElectricSQL, på samme skjema og samme protokoll»**. Kandidat 3 (egenbygd) er en egen senere oppgave. Hovedpunktet krysses av først når alle tre er satt opp.
- **Testplan:** `docs/funksjoner/fase1-kandidat-electricsql-testplan.md` (skrives av test-leder før koding; navnene der er bindende for testskriver). Kortet gjentar ikke testplanen.
- **Protokoll og resultat for prøve A og B:** `docs/funksjoner/fase1-prove-ab-electricsql.md` (ligger klar fra prosjektleder, samme struktur som for PowerSync; utvikler fyller inn det tekniske, Ståle tallene).
- **Drift:** `docs/drift/electricsql.md` (skrives av utvikler i bit 2, samme to deler som `docs/drift/powersync.md`).
- **Støtter hovedmål:** Tid: befaring uten nett på iPad er den største tidsbesparelsen mot IVIT; kandidat 2 er nødvendig for at valget av synkløsning blir et valg og ikke et første forsøk. / Reklamasjoner: ingenting går tapt mellom befaring og rapport (svar og bilder bekreftes av serveren før iPaden gir slipp på dem, samme krav som for PowerSync). / KI først: ikke KI i oppgaven, men synklaget som velges, er der KI-forslag senere vises og godkjennes på iPaden, også uten nett.

## Problem
PR #8 viser at testskjemaet kan lagres lokalt og synkes med PowerSync. Fase 1 skal velge løsning i en ADR, og et valg krever minst to kandidater som er prøvd på **samme skjema, samme tabeller og samme protokoll**, så tallene kan sammenlignes rad for rad. ElectricSQL er kandidat 2 fordi den også bygger rett på PostgreSQL, er åpen kildekode med Apache-2.0-lisens på både tjeneste og klient, og kan driftes selv i Docker. Den er annerledes nok til å gi et ekte valg: Electric synker **bare lesing** (utsnitt av tabeller, «shapes», over vanlig HTTP), og skriving går gjennom våre egne ruter. Hvor mye vi da må eie selv (lokal lagring og endringskø), er nettopp det sammenligningen skal vise.

Oppgaven er **en prøve, ikke en produktfunksjon**. Alt i `sync/electricsql/` får hodekommentaren «Prøve fase 1, kastes eller gjøres om etter ADR». Uten oppgaven blir ADR-en synsing, og vi risikerer å bygge befaringen på iPad på feil grunnmur.

## KI først
Nei. Teknisk grunnarbeid (lokal lagring, synk, fletting). KI kommer ikke inn før grunnmuren står (beslutning 25.10.2026). Oppgaven forbereder «KI først» på samme måte som oppgave 4: svar per felt med enhet og versjon er formen KI-forslag senere lagres i, og tekstflettingen (Yjs) lar et KI-utkast og takstmannens egne ord leve i samme felt.

## Brukerhistorier
- Som **takstmann** vil jeg **fylle ut testskjemaet og ta bilder i flymodus, lukke appen og starte iPaden på nytt** slik at **alt ligger på serveren når nettet kommer**, uansett hvilken kandidat som er valgt.
- Som **takstmann** vil jeg **velge kandidat (PowerSync eller ElectricSQL) på listen over testskjemaer** slik at **prøve A og B kan kjøres likt for begge uten at skjemaet er forskjellig**.
- Som **Ståle** vil jeg **starte ElectricSQL på Macen med `./start.sh`** og **vite hvordan den kjøres i Azure-testmiljøet** slik at **prøvene kan kjøres på ekte iPad**.
- Som **prosjektleder** vil jeg **ha resultatfil med samme tabeller som for PowerSync** slik at **sammenligningen og ADR-en blir tall mot tall**.

## Omfang

Arbeidet deles i **to biter som ikke henger sammen i kode**, pluss et forarbeid fra arkitekt. Kontrakten mellom bitene (proxy-ruten og `TrialSyncStore`) står under «Data» og er bindende.

**Med:**

### Forarbeid – kontrakten (arkitekt, før koding)
1. `src/modules/offline-trial/sync/types.ts` ryddes så den er **lik for alle kandidater** (avgjort av arkitekt, bindende, se avgjørelse A): `getAnswers` fjernes; `flush()` og `close()` inn i kontrakten (provideren kaller dem i dag bare på PowerSync-typen); `TrialFormSnapshot` får `form: TrialFormSummary | null`; nye metoder `subscribeForms(listener)`, `onStatusChange(listener)`, `listPendingPhotos()` og `markPhotoUploaded(id, sha256)`; egen `TrialSyncTestable` for testkroken. Måleindikatoren lytter bare på `onStatusChange`, ikke på PowerSyncs `ps_crud`.
2. **Sidene og bildekøen skal være uavhengige av kandidat:** `src/app/(ansatt)/prove/testskjema/**` og `sync/photo-uploader.ts` importerer **ikke** fra `@powersync/*`, `@electric-sql/*`, `sync/powersync/` eller `sync/electricsql/`. De bruker bare `TrialSyncStore` og `sync/select-store.ts` (`readSyncCandidate`, `writeSyncCandidate`, `openTrialStore(candidate, organizationId)` med dynamisk `import()` per kandidat, så bare den valgte SDK-en lastes). I dag bruker listen og skjemasiden `useQuery` fra `@powersync/react` direkte; det byttes til `store.subscribeForms` / `store.subscribe` (snapshot med `form`). Bildekøen (`startPhotoUploader(store, organizationId)`) bruker `listPendingPhotos`, `markPhotoUploaded` og `onStatusChange`. Håndheves av Vitest-testen `sync/candidate-boundaries.test.ts` som leser filene som tekst (ingen ESLint-regel). Dette er prisen for at kriteriet «Arbeid» skal være rettferdig, og det gjelder også kandidat 3.
3. **Oppsettet av ElectricSQL** er avgjort (avgjørelse B–D under). Kort:
   - **Lesing:** Electric «shapes» for `trial_forms`, `trial_answers` og `trial_photos`, alltid gjennom en proxy-rute i appen (pkt. 9), aldri direkte fra iPaden til Electric.
   - **Skriving:** `POST /api/prove/synk/endringer` fra PR #8 **uendret**. Klienten trenger derfor en egen endringskø lokalt som overlever lukking og omstart; vi eier den selv.
   - **Lokal lagring på iPaden:** alternativ (b), egen IndexedDB-lagring `offline-trial-electric` med synkede rader, lagret synkposisjon (`shape_state`) og endringskø (`outbox`). PGlite (a) er forkastet og føres slik i resultatfilen. Linjene vi eier selv, telles i resultatfilen med kø og lagring som egne tall.
   - **Innlogging mot Electric:** iPaden snakker bare med appen (samme sesjon som de andre `/api/prove/`-rutene). Synktokenet fra PR #8 (`GET /api/prove/synk/token`) brukes **ikke** av denne kandidaten (bekreftet av arkitekt); står i resultatfilen som funn (mindre å eie). Ruten står fordi PowerSync bruker den.

### Bit 1 – Klient: ElectricSQL-lageret og valg av kandidat
4. **Nye avhengigheter:** bare `@electric-sql/client` (Apache-2.0). Ingen PGlite, ingen `@electric-sql/react`, ingen `fake-indexeddb`. Lisensene sjekkes mot `package.json` i pakkene og dateres i resultatfilen. Begrunnelsen gjentas i PR-en.
5. `src/modules/offline-trial/sync/electricsql/store.ts`: `createElectricTrialStore(deviceId, organizationId)` som oppfyller `TrialSyncStore`. Leser de tre shapene gjennom proxy-ruten, skriver lokalt først, legger endringer i den lokale køen og sender dem buntvis til `POST /api/prove/synk/endringer` når nettet finnes. En bunt tas ut av køen **bare** når serveren svarte 200 (samme regel som PowerSync-koblingen). Avviste bunter (400/409) blir liggende, som i PR #8 (kjent svakhet, ikke løst her).
6. **Samme oppførsel som PowerSync-lageret** for det prøvene måler: `trial_answers` upsert på `(trial_form_id, field_key)`; tekstfelt skriver `value` og `text_state` ca. 300 ms etter siste tastetrykk, lager aldri tilstand fra en gammel `value`, og fletter innkommende `text_state` lokalt med `text-merge.ts` (gjenbruk, ingen ny flettekode); bildefelt bygges av `trial_photos`-rader med `rowsToAnswers`; bildefilen lagres i `offline-trial-photos` (IndexedDB) med `photo-store.ts` som før. Nedlastede rader skal aldri legges over lokale endringer som ikke er sendt ennå.
7. **Valg av kandidat:** listen `/prove/testskjema` får en liten velger «Synkløsning» med to knapper, **«PowerSync»** og **«ElectricSQL»** (minst 44 pt). Valget lagres i `localStorage` (nøkkel `trial_sync_candidate`, verdier `powersync` | `electricsql`, standard `powersync`) og gjelder til det byttes. **Bytte = skriv nøkkelen og last siden helt på nytt (`location.reload()`)**; lageret byttes aldri mens siden lever. E2e får sette nøkkelen direkte (`addInitScript`). Bytte er bare tillatt når indikatoren viser «Alt er lagret på serveren»; ellers er den andre knappen slått av med teksten **«Vent til alt er lagret på serveren før du bytter»**. Hver kandidat har sin egen lokale lagring; ingenting slettes ved bytte. Velgeren står på listen, ikke i skjemaet, så skjemaet er likt for begge.
8. **Testkrok** (`NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`): `window.__offlineTrial` flyttes til `sync/test-hooks.ts` og har for begge kandidater `{ candidate, store, deviceId, organizationId, applySyncedRows(table, rows), readRows(table, formId?), simulateOrganizationChange(organizationId) }` (rader i snake_case som i de lokale tabellene; `applySyncedRows` gjør upsert på `(trial_form_id, field_key)` for `trial_answers`; antall i køen leses med `store.status()`). PowerSync-kroken beholder i tillegg `db` og `pendingOverride`, så dagens e2e ikke skrives om. Bare de kandidatuavhengige testene bruker de nye funksjonene.

### Bit 2 – Server: proxy-rute, Electric i Docker og drift
9. `src/modules/offline-trial/server/electric-shape.ts`: `buildTrialShapeRequest(actor, organizationId, table, clientParams): Promise<{ url: URL }>` → `requireOrganizationAccess(actor, organizationId, "organization.read")` → bare de tre `trial_`-tabellene (alt annet `InvalidTrialChangeError`, 400, ingen kall) → bygger forespørselen med `new URL(ELECTRIC_URL)` og `searchParams.set` for nøyaktig `table`, `where organization_id = $1 AND deleted_at IS NULL`, `params[1]` = **`grant.organizationId`** (aldri limt inn i teksten, aldri fra klienten), eksplisitt `columns` for **alle tre** tabellene (aldri `storage_path`, aldri `created_by`/`updated_by`/`deleted_by`) og `secret` = `ELECTRIC_SECRET`. Fra klienten kopieres **bare** `offset`, `handle`, `live`, `cursor` etter formatsjekk (`/^[A-Za-z0-9_.-]+$/`, `live` bare `true`); alt annet i spørrestrengen (også `params[1]`, `replica`, `secret`, `api_secret`, `where`, `columns`, `table`) ignoreres. `forwardTrialShape(actor, organizationId, searchParams, fetchImpl = fetch): Promise<Response>` i samme fil gjør kallet. Tynn rute `src/app/api/prove/synk/shape/route.ts` (`dynamic = "force-dynamic"`): `getCurrentActor` (401), kaller `forwardTrialShape`, strømmer kroppen (`new Response(upstream.body, …)`, `live=true` er lang-polling opptil ca. 20 s). Svarhoder: **alltid** `Cache-Control: private, no-store`; bare `content-type` og `electric-handle`, `electric-offset`, `electric-schema`, `electric-cursor`, `electric-up-to-date` videresendes; `ETag`, `Age`, `Expires` og Electrics `public, max-age` når aldri klienten. Electrics statuser 200, 204, 400, 409 (must-refetch) og 429 videresendes uendret; 502 bare ved nettverksfeil eller tidsavbrudd, som `{ feil }` uten Electrics tekst, uten ny prøving på serveren. Ingen tilgangslogikk i ruten. Logging: bare `route`, `userId`, tabellnavn og status, aldri spørrestrengen (den har `secret`) og aldri radene. `ELECTRIC_SECRET` aldri med `NEXT_PUBLIC_`.
10. `tests/`: `expectTenantIsolation` for `buildTrialShapeRequest` (fremmed organisasjon gir `AccessDeniedError`; `where` har alltid `grant.organizationId`). Enhetstester på at klientens `where`/`columns`/`table` aldri når Electric, og at `storage_path` aldri står i `columns`.
11. **Electric lokalt (Docker, selvdrevet):** `docker-compose.yml` får tjenesten `electric` (offisielt bilde `electricsql/electric`, **fast versjonstag**, aldri `latest`), bundet til `127.0.0.1` på en port som **ikke** er 3000 (Electrics standard krasjer med appen; utvikler velger f.eks. 3010), `depends_on: db: condition: service_healthy`, eget volum for Electrics lagring, `ELECTRIC_SECRET` fra `.env` (utviklingsverdi, ikke hemmelig, bare for localhost, samme mønster som `POWERSYNC_JWT_SECRET`). Databasen har allerede `wal_level=logical`. Electric og PowerSync kjører **side om side** på samme database (hver sin publikasjon og replikeringsplass). **Ny migrering `src/db/migrations/0002_*.sql`** (eneste databaseendring, avgjørelse C): `REPLICA IDENTITY FULL` på de tre `trial_*`-tabellene og publikasjonen `electric_publication_default` `FOR TABLE` de tre (aldri `FOR ALL TABLES`), etter mønster fra 0001. Utvikler sjekker i Docker at Electric-versjonen godtar en ferdiglaget publikasjon; gjør den ikke det, føres det som funn og driftsdokumentet sier at rollen må eie tabellene. `ELECTRIC_USAGE_REPORTING=false` i `docker-compose.yml`.
12. **`start.sh`** (bash 3.2): nytt steg «Starter synktjenesten (ElectricSQL)» etter PowerSync-steget, venter på helsesjekken, hopper over ved `EZPROP_SKIP_DOCKER=1`, `TOTALT` oppdateres, nye `.env`-nøkler (`ELECTRIC_URL`, `ELECTRIC_SECRET`) legges til for eldre `.env`, og adressen skrives i oppsummeringen. `.env.example`, `ci.yml` og `playwright.config.ts` får de samme nøklene med forklaring.
13. **Azure beskrives, ikke rulles ut:** `docs/drift/electricsql.md` med samme to deler som `docs/drift/powersync.md`: (a) Mac: hva `start.sh` gjør, hvordan Ståle ser at tjenesten kjører, nullstilling; (b) Azure-testmiljøet: Electric som egen container i Azure Container Apps (én kjøremåte), samme bilde, varig lagring for Electrics shape-logg, databaserolle med bare det den trenger, miljøvariablene appen trenger (`ELECTRIC_URL` peker på containerens **interne** adresse, `ELECTRIC_SECRET` som hemmelighet), at Electric aldri skal være åpen mot internett (bare appen når den), anslått kostnad per måned, og personvern (lokal lagring på iPaden beskyttet bare av iPadens kryptering, som for PowerSync). Ingen Bicep, ingen Azure-kall, ingen konto hos Electric Cloud.
14. **Skyen har ikke Docker.** Enhets- og integrasjonstester kjører mot PostgreSQL uten Electric. Kobling mot selve tjenesten prøves av Ståle på Macen og i Azure. Står i PR-en under «Slik ser og tester du det».

### Begge biter
15. **Resultatfilen** `docs/funksjoner/fase1-prove-ab-electricsql.md`: utvikler fyller inn «Teknisk som utvikleren fyller inn», også det som ikke virket, og hvor mange linjer vi eier selv (endringskø og lokal lagring skilt ut som egne tall, så kandidat 3 kan gjenbruke dem).
16. **Grense for arbeidet:** klarer ikke utvikler å få lagring, kø og shapes til å virke sammen innen **to arbeidsdager** etter at kontrakten ligger klar, leveres det som står, bytteren på listen viser ElectricSQL som «ikke klar», og det står tydelig i resultatfilen og PR-en. Det er et resultat for ADR-en, ikke en mangel ved PR-en.
17. Versjon `0.2.1 → 0.2.2` i `package.json`. Ordlisten i `docs/05-domenemodell.md` avsnitt 8 er oppdatert i dette kortet (ElectricSQL, shape, endringskø). Spørsmål nr. 11 til Ståle (ElectricSQL som leverandør) ligger i `docs/09-apne-sporsmal.md`, ikke blokkerende.

**Ikke med (bevisst utelatt):**
- **Kandidat 3 (egenbygd)** og **sammenligning/ADR**: egne punkter i fase 1. Endringskøen herfra kan gjenbrukes der, men det er ikke denne oppgaven.
- **Selve prøvene A og B** på ekte iPad: Ståle kjører dem når Electric er oppe i Azure (egen liten PR med Bicep, som for PowerSync).
- **Prøve C–F**, fullt synkstatus-punkt («lagret kl.», «Synk nå»), `DELETE` i synkkontrakten, konfliktlogg, fletting for tabell/TG/valg/tall: som i oppgave 4.
- **Ingen endring i serverens skriveregler** (`applyTrialChanges`, `storeTrialPhoto`) eller i tabellene. Trenger Electric en endring der, stoppes arbeidet og det føres som funn.
- **Ingen Electric-spesifikk tilgangslogikk:** bare proxy-ruten, med `requireOrganizationAccess` som i dag. Ingen nye roller eller rettigheter.
- **Ingen nye skjermer** utover velgeren «Synkløsning» på listen. Skjemaet (`/prove/testskjema/[id]`) ser likt ut for begge kandidater.
- **Ingen service worker-endring** (valg (b) har ingen wasm). Hurtiglagring av shape-svar i service workeren: nei; det er lageret som eier dataene.
- **Ingen `navigator.locks`** (én fane sender køen): iPaden kjører appen som én fane fra hjemskjermen; føres som kjent svakhet i resultatfilen.
- **Ingen rate limit på proxy-ruten** (prøveverktøy bak innlogging).
- **Ingen Bicep, ingen utrulling, ingen Azure-kall, ingen konto hos Electric Cloud eller andre.** Bare selvdrevet i Docker.
- **Ingen småfunn fra PR #8** (6), (8), (9), (10), (13), (14) rettes her; egen liten oppgave etter kandidat 2.
- **Ingen Safari i e2e**, ingen Playwright mot Electric-tjenesten (skyen har ikke Docker).
- **Ingen visning av tid per person** fra `updated_by`, `device_id` eller lignende.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | alle testskjemaer i egen organisasjon | ja |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja (stenges aldri ute) | ja |

Uendret fra oppgave 4. Proxy-ruten kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og setter `where organization_id = grant.organizationId` selv; klienten kan ikke påvirke utsnittet. Electric er aldri nåbar fra iPaden eller internett, bare fra appen med `ELECTRIC_SECRET`.

## Data
Ingen nye tabeller. `trial_forms`, `trial_answers` og `trial_photos` fra PR #8 brukes uendret.

**Ny rute (kontrakt mellom bit 1 og 2):**

| Rute | Inn | Ut |
|---|---|---|
| `GET /api/prove/synk/shape?organisasjon=<id>&tabell=<trial_forms\|trial_answers\|trial_photos>&offset=…&handle=…&live=…&cursor=…` | innlogget | Electrics kropp og statusene 200/204/400/409/429 videresendt uendret, bare `content-type` og `electric-*`-hodene, alltid `Cache-Control: private, no-store`; `400` ukjent tabell eller ulovlig format på `offset`/`handle`/`cursor`/`live`, `401`, `403` fremmed organisasjon, `502` `{ feil }` når Electric ikke svarer |

**Endret klientkontrakt (`sync/types.ts`, arkitekt, bindende):** se avgjørelse A. PowerSync-lageret og sidene oppdateres til den nye kontrakten i samme PR (det er den eneste endringen i `sync/powersync/`, pluss at `window.__offlineTrial` flyttes ut av `sync/powersync/database.ts`).

**Lokal lagring for ElectricSQL (IndexedDB `offline-trial-electric`, avgjørelse D):** lagrene `synced_trial_forms`, `synced_trial_answers` (indeks `trial_form_id`+`field_key`), `synced_trial_photos`, `shape_state` (tabell → `handle`/`offset`) og `outbox` (`seq` → operasjon). Bildefilene ligger som før i `offline-trial-photos`.

**Miljøvariabler:** `ELECTRIC_URL` (appen → Electric, f.eks. `http://localhost:3010`), `ELECTRIC_SECRET` (minst 32 tegn, utviklingsverdi i `.env.example` som nektes når `BETTER_AUTH_URL` ikke er localhost, samme vokter som for `POWERSYNC_JWT_SECRET`). `POWERSYNC_*` og `TRIAL_*` står som før.

**Faste koder:** feltnøklene fra oppgave 3 (40 stk.) uendret. Ingen nye koder. `trial_sync_candidate` er en innstilling i nettleseren, ikke en kode i datamodellen.

## Skjermer
iPad (liggende, 1194 × 834) og PC. Én endring:
- **Liste** (`/prove/testskjema`): under overskriften en linje «Synkløsning» med knappene **«PowerSync»** og **«ElectricSQL»**; den valgte er tydelig merket (ikke bare med farge). Når noe venter på å bli sendt, er den andre knappen slått av med teksten «Vent til alt er lagret på serveren før du bytter». Er ElectricSQL ikke klar (pkt. 16), står knappen som «ElectricSQL (ikke klar)».
- **Skjemaet**: uendret.

Ingen skisse fra ui-designer eller ux-ansvarlig: prøveverktøy, tekstene står her.

## Regler
Ingen regler eller TG-logikk (prøve E).

## Akseptkriterier
- [ ] Med ElectricSQL valgt kan et nytt testskjema lages fra listen, åpnes, og alle 40 felt fylles ut i e2e i `pc` og `ipad`; telleren viser «40 av 40 felt utfylt». Samme e2e er grønn med PowerSync valgt (dagens tester).
- [ ] Svarene og et valgt bilde overlever at siden lastes på nytt i e2e med ElectricSQL valgt, uten at noen server svarte på synk.
- [ ] Uten nett i e2e (`context.setOffline(true)`) åpner skjemaet fra hurtiglageret med ElectricSQL valgt, nye svar kan skrives, og indikatoren viser «Uten nett»; med nett igjen viser den «Venter: N endringer, M bilder» eller «Alt er lagret på serveren».
- [ ] Velgeren: valget overlever omlasting; på ny kontekst før noe er laget («Alt er lagret på serveren») er bytte tillatt; etter én endring er den andre knappen slått av med teksten «Vent til alt er lagret på serveren før du bytter»; bytte sletter ingenting lokalt (e2e setter `localStorage.trial_sync_candidate` direkte: svar skrevet med PowerSync er der igjen når det byttes tilbake).
- [ ] Bytte av organisasjon på samme enhet tømmer forrige organisasjons synkede rader, synkposisjon, endringskø og bilder for begge kandidater (e2e via `simulateOrganizationChange`, samme test for `powersync` og `electricsql`).
- [ ] «Endret av en annen» vises med ElectricSQL valgt når en `trial_answers`-rad med `device_id = "annen-enhet"` skrives via testkroken.
- [ ] Tekstfelt: innkommende `text_state` flettes lokalt med `mergeTextStates` (enhetstest på lagerets rene del), og en lokal endring som ikke er sendt, overskrives aldri av en nedlastet rad (enhetstest).
- [ ] Endringskøen: en bunt fjernes bare etter 200 fra serveren (enhetstest på den rene tilstandsmaskinen: `enqueue`, `takeBatch`, `ackBatch`, `keepBatch`); 500 og avbrutt kall via `page.route` beholder bunten, og den tømmes etter `unroute` (e2e); køen overlever omlasting (e2e); `must-refetch` tømmer aldri køen (enhetstest).
- [ ] Uten Electric (hele e2e): lageret virker lokalt, køen tømmes mot `POST /api/prove/synk/endringer` og indikatoren når «Alt er lagret på serveren»; shape-henting ved feil prøves igjen med økende ventetid, **høyst ett kall per tabell per 5 s** (e2e teller kall mot `/api/prove/synk/shape`).
- [ ] `buildTrialShapeRequest`: `params[1]` er alltid `grant.organizationId`, aldri fra spørrestrengen; klientens `where`, `columns`, `table`, `organization_id`, `params[1]`, `replica`, `secret` og `api_secret` når aldri Electric (sjekk på den bygde URL-en); `storage_path`, `created_by`, `updated_by`, `deleted_by` aldri i `columns`; ukjent tabell gir `InvalidTrialChangeError` uten kall; `it.each` over alle fire roller slipper inn, deaktivert nektes (admin stenges aldri ute); fremmed organisasjon gir `AccessDeniedError` med `expectTenantIsolation` (`seed` gir `{ a: [orgA], b: [orgB] }`, `query` gir `[{ id: <params[1] i den bygde URL-en> }]`, `idOf: r => r.id`). Proxyen: svarhodene har aldri `public`, `ETag`, `Age` eller `Expires`, alltid `Cache-Control: private, no-store`; `ELECTRIC_SECRET` og `ELECTRIC_URL` står aldri i noe svar, heller ikke 502. E2e `request`: 401 uinnlogget, 403 for `?organisasjon=<tilfeldig uuid>`, 400 for ukjent tabell, 502 uten Electric.
- [ ] `sync/types.ts` har ikke `getAnswers`; Vitest-testen `sync/candidate-boundaries.test.ts` viser at `src/app/(ansatt)/prove/testskjema/**` og `sync/photo-uploader.ts` ikke importerer fra `@powersync/*`, `@electric-sql/*`, `sync/powersync/` eller `sync/electricsql/`.
- [ ] Nedlastede rader legges aldri over usendte lokale endringer, og innkommende `text_state` flettes med `mergeTextStates` (enhetstest på den rene innflettingen `applyIncoming`, uten `window`, React eller `@electric-sql/*`).
- [ ] `docker compose config` er gyldig der Docker finnes; test i `tests/` viser at `electric` er bundet til `127.0.0.1`, har fast versjonstag (ikke `latest`), `depends_on` med `service_healthy`, eget volum og `ELECTRIC_USAGE_REPORTING=false`; `start.sh` er gyldig bash 3.2 (`bash -n`) og kjører med `EZPROP_SKIP_DOCKER=1`.
- [ ] Migreringen `0002_*` kjører mot tom database og mot testdatabasen, og gir `REPLICA IDENTITY FULL` og publikasjonen `electric_publication_default` med nøyaktig de tre `trial_*`-tabellene (integrasjonstest).
- [ ] `docs/drift/electricsql.md` og det tekniske avsnittet i `docs/funksjoner/fase1-prove-ab-electricsql.md` er fylt inn, også det som ikke virket og linjene vi eier selv.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dekket av `expectTenantIsolation` på `buildTrialShapeRequest`.
- [ ] Virker på iPad-størrelse (e2e): `ipad`-prosjektet har kjørt alle e2e-testene. Omfang: «40 av 40» er en delt funksjon som kjøres for begge kandidater; resten av `fase-1-testskjema.spec.ts` kjører bare med PowerSync; ny `e2e/fase-1-electricsql.spec.ts` dekker ElectricSQL-kriteriene over. Lander utvikler på pkt. 16 («ikke klar»), merkes ElectricSQL-e2e `test.fixme` med henvisning til resultatfilen, men tenant-isolasjon, roller, proxy-hoder og `candidate-boundaries` må uansett være grønne.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.2.
- [ ] Ingen modellnavn i commit-meldingene (`git log fase1-kandidat-powersync..HEAD`).

## Roller
- **arkitekt**: forarbeidet (pkt. 1–3) er gjort i runde 1 (avgjørelse A–D). Ingen ADR nå.
- **sikkerhet-personvern**: proxy-ruten er ny angrepsflate mot en intern tjeneste (parametre som slippes gjennom, `where` som parameter, hemmelighet bare på serversiden, Electric aldri åpen utad). Kjører `/security-review` på PR-en når bit 2 er skrevet.
- **test-leder**: skriver `fase1-kandidat-electricsql-testplan.md` før koding og godkjenner til slutt.
- **utvikler**: bit 1 (klient) og bit 2 (server, Docker, drift) i parallell etter forarbeidet.
- **testskriver**: etter testplanen, i parallell med utvikler.
- **prosjektleder**: oppgavekort, resultatmal, spørsmål nr. 11, ordliste, tilstand, PR.

Ikke med: ux-ansvarlig og ui-designer (prøveverktøy; tekstene står under «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst).

## Avgjørelser etter runde 1 (prosjektleder, 28.10.2026)
Rollene var enige om kjernen: lager med samme kontrakt, proxy-rute med `grant.organizationId` som parameter, endringskø som tømmes bare ved 200, Docker i `start.sh`, resultatfil, driftsbeskrivelse og to-dagers grensen. Det som står under, er bindende for testplan og bygging. Der kortet over sier noe annet, gjelder dette.

### A. Kontrakten `sync/types.ts` (arkitekt, uendret vedtatt)
- `getAnswers` fjernes. `flush(): Promise<void>` og `close(): Promise<void>` inn i `TrialSyncStore` (forenklerens mangel; de kalles i dag bare på PowerSync-typen).
- `TrialFormSnapshot` = `{ form: TrialFormSummary | null, answers, photos }`.
- Nye metoder: `subscribeForms(listener: (forms: TrialFormSummary[]) => void): () => void` (`listForms()` beholdes), `onStatusChange(listener: () => void): () => void`, `listPendingPhotos(): Promise<TrialPhotoRow[]>` (bare denne enhetens bilder uten `uploadedAt`, stabil rekkefølge), `markPhotoUploaded(id: string, sha256: string): Promise<void>` (skriver bare lokalt, aldri i endringskøen; retter funn (6) for begge kandidater).
- `TrialSyncTestable` = `{ applySyncedRows(table: TrialTableName, rows: Record<string, unknown>[]): Promise<void>, readRows(table: TrialTableName, formId?: string): Promise<Record<string, unknown>[]> }`. Navnene `applySyncedRows` (arkitekt) og `readRows` (test-leder) er satt; test-leders `pendingChanges()` tas ikke med, `store.status().pendingChanges` gir det samme.
- Testkroken flyttes til `sync/test-hooks.ts` (pkt. 8). PowerSync-kroken beholder `db` og `pendingOverride` for dagens e2e (forenkler 7, test-leder 1 er dermed begge dekket).
- Provideren mister `PowerSyncContext`, `db` og `registerListener`; kontekst = `{ store, deviceId, organizationId, candidate }`. `startPhotoUploader(store: TrialSyncStore, organizationId: string): () => void`.

### B. Lesing og proxy (arkitekt og sikkerhet, slått sammen)
- Shapes med eksplisitt `columns` for alle tre tabellene (pkt. 9), `where organization_id = $1 AND deleted_at IS NULL`, `params[1] = grant.organizationId`. Myk slettede rader forlater shapen som delete-melding og fjernes lokalt; serveren beholder dem (regel 3).
- Lukket tillatelsesliste fra klienten (`offset`, `handle`, `live`, `cursor` med formatsjekk); alt annet ignoreres. Enhetstest: `params[1]=<annen uuid>` og `secret=x` fra klienten når aldri Electric.
- **Alltid** `Cache-Control: private, no-store`, bare `content-type` og `electric-*`-hodene videresendes. Sikkerhet og arkitekt sa det samme; kortets «no-store på feil» var for svakt.
- `replica` settes aldri av klienten (standard: bare endrede kolonner ved update), så lageret patcher per kolonne, aldri hele raden.
- 502 svarer `{ feil }` uten Electrics tekst; loggen får aldri spørrestrengen.
- Synktokenet brukes ikke av kandidat 2 (funn i resultatfilen).

### C. Migrering 0002 tas med (arkitekt og sikkerhet over forenkler 4)
Forenkler ville la Electric lage publikasjonen selv. Men uten ferdig publikasjon og `REPLICA IDENTITY FULL` må Electric-rollen **eie** tabellene for å kjøre `ALTER TABLE`/`ALTER PUBLICATION` selv, og det bryter sikkerhets krav om en rolle med bare `SELECT` på de tre tabellene og `REPLICATION`. Migreringen er derfor det som gir **minst** rettigheter, ikke mer arbeid: én SQL-fil etter mønster fra 0001. Konsekvens: mer WAL per oppdatering på tre prøvetabeller; PowerSync påvirkes ikke. Godtar ikke Electric-versjonen en ferdiglaget publikasjon, føres det som funn, og driftsdokumentet sier at rollen må eie tabellene. Det er den eneste databaseendringen; ingen kolonner, ingen kontraktendring.

### D. Lokal lagring og kø: alternativ (b), IndexedDB, med lagret synkposisjon (arkitekt over forenkler 5)
- Alternativ (b) som arkitekt og forenkler var enige om: `offline-trial-electric` med `synced_*`-lagrene, `shape_state` og `outbox`. PGlite (a) forkastes og føres slik i resultatfilen. Lageret skal kunne brukes av kandidat 3 som det er, bare med en annen lesevei.
- `shape_state` (lagret `handle`/`offset`) **tas med**, ikke valgfri. Begrunnelse: 409 `must-refetch` må uansett håndteres (Electric sender den etter omstart eller tapt lagring), så full henting fra `offset=-1` er en vei vi må eie uansett; lagret posisjon er da én rad per tabell ekstra og sparer nettbruk ved hver oppstart på iPaden, som prøve B måler. Regel ved 409: slett `shape_state` og de synkede radene for tabellen, hent på nytt fra `-1`; `outbox` røres aldri.
- Visning = synkede rader med `outbox` lagt over, per (tabell, id) og for svar per (`trial_form_id`, `field_key`); tekstfelt vises som `mergeTextStates(synced.text_state, pending.text_state)`. Nedlastede rader legges aldri over usendte endringer.
- `outbox` koalesceres per (tabell, id) med opprinnelig `seq` beholdt, så skjemaet alltid sendes før svarene. Bunter i `seq`-rekkefølge, maks `TRIAL_SYNC_LIMITS.maxOperationsPerBatch` (500), bare med nett, fjernes bare ved 200; ellers beholdes bunten med eksponentiell ventetid 5–60 s. Avviste bunter (400/409) blir liggende som i PR #8 (kjent svakhet).
- Etter 200 beholdes et «bekreftet»-overlegg per nøkkel til neste shape-melding for samme nøkkel kommer. Svakheten (en eldre melding underveis) føres som funn.
- Shape-feil prøves igjen med samme ventetid (første forsøk etter 5 s, dobling til 60 s, altså høyst ett kall per tabell per 5 s) og blokkerer aldri skriving. Uten Electric i e2e går «Venter: N endringer» likevel til 0 fordi skriveruten finnes; det er ulikt PowerSync og skal stå i resultatfilen.
- Rene, DOM-frie filer er et krav (test-leder 3): (a) køens tilstandsmaskin (`enqueue`, `takeBatch`, `ackBatch` bare ved 200, `keepBatch` ved alt annet), (b) innfletting `applyIncoming(localRows, incomingRows, pendingKeys)` med `mergeTextStates` og `deleted_at`-filter, (c) tolking av Electric-meldinger (insert/update/delete, `up-to-date`, `must-refetch`). Ingen av dem importerer `window`, React eller `@electric-sql/*`. Test-leder setter filnavn i testplanen.
- Organisasjonsbytte: samme `trial_last_organization_id`-regel som PowerSync; lager, synkposisjon, kø og bilder tømmes (sikkerhet 2). `navigator.locks`: ikke nå (hold det enkelt), kjent svakhet.

### E. Bytte av kandidat og e2e (forenkler 2, 3, 7, 8 og test-leder 2, 6)
- Bytte = sett `localStorage.trial_sync_candidate` og `location.reload()`. Ingen riving av lager mens siden lever (forenkler 2).
- E2e-testen «bytte sletter ingenting lokalt» **beholdes** (test-leder over forenkler 3), fordi test-leder viste en billig vei: nøkkelen settes direkte, og testen viser at det å åpne Electric-lageret ikke tømmer PowerSync-databasen (organisasjonsregelen i pkt. D kunne ellers gjort nettopp det). Knappen testes for seg: tillatt på ny kontekst, sperret etter én endring.
- Omfang per kandidat som test-leder 6: delt «40 av 40», ny `e2e/fase-1-electricsql.spec.ts`, resten bare PowerSync. Ingen parametrisering av hele suiten.
- Håndheving av kandidatuavhengige sider: Vitest-test som leser filene (arkitekt 2d og test-leder), ikke ESLint-regel. Forenklerens poeng (ingen lint-regel for prøvekode) er dermed dekket, og testen holder i CI der en grep for hånd ikke gjør det.

### F. Drift og miljø (sikkerhet 4 og 5, arkitekt 5)
- `electricsql/electric:<fast 1.x-tag>` (sjekk arm64), `127.0.0.1:3010:3000`, volum for `ELECTRIC_STORAGE_DIR`, `ELECTRIC_SECRET` fra `.env`, `ELECTRIC_USAGE_REPORTING=false`, `depends_on` db healthy.
- `ELECTRIC_URL` og `ELECTRIC_SECRET` med samme localhost-vokter som `POWERSYNC_JWT_SECRET`, i egen liten funksjon i `server/electric-shape.ts` (ingen deling med `sync-token.ts`). Testverdiene inn i `webServer.env` i `playwright.config.ts` og i `ci.yml`.
- `docs/drift/electricsql.md` sier i tillegg: rollen i Azure har bare `SELECT` på de tre tabellene og `REPLICATION`, aldri superbruker, aldri lesetilgang til `user`, `session`, `verification` eller ansatte; Electrics shape-logg på disk er mellomlagring, ligger i Sweden Central og kan slettes uten tap (databasen er fasit, 10 år gjelder der); ingress intern i Container Apps; App Service tåler lang-polling fra proxyen; `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS` settes aldri i Azure.
- Ingen ADR nå. Ordlisten får `shape_state` i dette kortet; `outbox` står der fra før.

### G. Står fast
Kontraktsryddingen (A), proxy-ruten med `expectTenantIsolation` (regel 2), «nedlastede rader legges aldri over usendte lokale endringer», sperre på bytte når noe venter, og to-dagers grensen i pkt. 16 kuttes ikke.

## Åpne spørsmål
- Nr. 11 i `docs/09-apne-sporsmal.md`: ElectricSQL som leverandør (selvdrevet eller Electric Cloud, pris, databehandleravtale). Ikke blokkerende; alt kjører selvdrevet uten konto.
- Nr. 10 (PowerSync) står fortsatt åpent; begge trengs før ADR-en.

## Avgjørelser før bygging (prosjektleder, 28.10.2026, etter forarbeid og testplan)
Der testplanen (`fase1-kandidat-electricsql-testplan.md`) og signaturene i `sync/types.ts` / `sync/electricsql/types.ts` sier ulikt, gjelder dette. Begge biter og testskriver bygger mot disse navnene.

1. **Endringskøen (`sync/electricsql/outbox.ts`)** følger `OutboxMachine` i `sync/types.ts`: rene funksjoner over `OutboxState` – `enqueue(state, entry)`, `takeBatch(state, limit)`, `ackBatch(state)` (bare ved 200, tar bunten fra `state.inFlight`), `keepBatch(state)`, `pendingKeys(state, keyOf)` – pluss `createOutboxState(entries?: OutboxEntry[], nextSeq?: number): OutboxState` og `localRowKey(table, row)` (`LocalRowKey`). Testplanens `createOutbox(...)` med metoder brukes ikke. Testnavnene i 2.1 beholdes; testen «skjemaet sendes alltid før svarene som peker på det» erstattes av «createForm legger skjemaet i køen før første svar» i e2e (ren `seq`-rekkefølge, `createForm` legger alltid skjemaet i køen først). Står i PR-en.
2. **Innflettingen (`sync/electricsql/apply-incoming.ts`)** følger `ApplyIncoming` i `sync/types.ts`: `applyIncoming(table, localRows, changes, pendingKeys)` → `{ rows, skippedKeys }` (`changes` er `IncomingChange[]`). «Bekreftet»-settet eies av lageret: nøkler som er bekreftet (200) men ikke speilet fra serveren ennå, sendes inn som del av `pendingKeys`; første melding for en slik nøkkel hoppes over (den er som regel ekkoet av vår egen skriving) og nøkkelen tas ut av settet. Testplanens test «bekreftet overlegg beholdes til neste melding for samme nøkkel» skrives om til det: nøkkel i `pendingKeys` → raden urørt og i `skippedKeys`; nøkkel ikke i settet → patch. Svakheten (en eldre melding underveis) står i resultatfilen. Ingen `updated_at`-sammenligning.
3. **Meldingstolkingen (`sync/electricsql/shape-messages.ts`)**: `parseShapeMessages(table, body): ParsedShapeBody` (navnet fra testplanen, signaturen `ParseShapeBody` fra arkitekten: `{ changes, upToDate, mustRefetch }`), `readShapeHeaders(headers)` (`ReadShapeHeaders`) og `nextShapeParams(...)` (`NextShapeParams`). Nøkkelen i `IncomingChange.key` regnes av `localRowKey` fra kolonnene i `value`, aldri av Electrics `key`-tekst; `REPLICA IDENTITY FULL` (migrering 0002) gjør at også delete-meldinger har `trial_form_id` og `field_key`.
4. **Lesing fra Electric gjennom proxyen:** utvikler prøver først `ShapeStream` fra `@electric-sql/client` med innsatt `fetchClient` (så 5-sekundersregelen og proxy-adressen holdes). Holder ikke 5-sekundersregelen og 409-håndteringen i e2e innen en halv dag, brukes egen `fetch`-løkke med `nextShapeParams`, `readShapeHeaders`, `parseShapeMessages` og `retryDelayMs`, og pakken tas ut igjen. Valget og begrunnelsen står i resultatfilen («Virket Electric-klienten …»). Testene er like for begge veier.
5. **Organisasjonsbytte** eies av `sync/select-store.ts` for begge kandidater: ulik `trial_last_organization_id` → `clearElectricStorage()`, `clearLocalPhotos()` og ny `clearPowerSyncStorage()` (eksport fra `powersync/database.ts`: åpner, `disconnectAndClear()`, lukker) før den valgte kandidaten åpnes. Sjekken flyttes ut av `powersync/database.ts`. Det og flyttingen av testkroken er de eneste endringene der, i tillegg til kontraktsendringene (A).
6. **`markPhotoUploaded` i PowerSync-lageret** (funn 6): prøves som lokal skriving utenom køen (`UPDATE ps_data__trial_photos SET data = json_set(data, '$.uploaded_at', ?, '$.sha256', ?) WHERE id = ?` i en `writeTransaction`). Blir en PowerSync-e2e rød av det, beholdes dagens kode og kommentaren, og det står i PR-en som fortsatt funn. Høyst en halv dag.
7. **Resultatfilen** `fase1-prove-ab-electricsql.md` eies av bit 1. Bit 2 leverer svarene på de fire serverradene (proxy, publikasjon/rolle, side om side, Electric-bilde og lisens) i sin sluttmelding, og prosjektleder limer dem inn.
8. **`package.json`:** bit 2 setter versjonen (0.2.2 står allerede fra forarbeidet; ingen ny økning). Bit 1 er den eneste som legger til en avhengighet (og rører `pnpm-lock.yaml`).
9. **Testkroken** (`sync/test-hooks.ts`): `installTrialTestHooks(opened: OpenedTrialStore, testable: TrialSyncTestable, extras?: { db?: unknown; pendingOverride?: … })` + `createTextState` fra `text-merge.ts` på kroken. For ElectricSQL godtar `readRows` også `"shape_state"` og `"outbox"`. PowerSyncs `applySyncedRows` er vanlig SQL-upsert (går via `ps_crud`; bare Electric-e2e bruker den; står i PR-en).
