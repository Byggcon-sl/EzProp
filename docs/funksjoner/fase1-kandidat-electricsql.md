# Funksjon: Andre kandidat for drift uten nett – ElectricSQL koblet til testskjemaet

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (fra oppgave 3 og 4). Ingen nye tabeller.
- **Status:** utkast (oppgavekort 28.10.2026, prosjektleder). Går til runde 1 hos forenkler, arkitekt, sikkerhet-personvern og test-leder før koding.
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
1. `src/modules/offline-trial/sync/types.ts` ryddes så den er **lik for alle kandidater**: `getAnswers(formId)` fjernes (ingen side bruker den; PowerSync-lageret mister metoden). Det legges til én metode for å følge synkstatus, f.eks. `onStatusChange(listener: () => void): () => void` (arkitekt setter navnet), så måleindikatoren ikke lenger lytter på PowerSyncs egne tabeller (`ps_crud`) i `trial-sync-provider.tsx`. Alt annet i kontrakten står.
2. **Sidene og bildekøen skal være uavhengige av kandidat:** `src/app/(ansatt)/prove/testskjema/**` og `sync/photo-uploader.ts` importerer **ikke** fra `@powersync/*`, `@electric-sql/*`, `sync/powersync/` eller `sync/electricsql/`. De bruker bare `TrialSyncStore` og én fil som velger kandidat (f.eks. `sync/select-store.ts`). I dag bruker listen og skjemasiden `useQuery` fra `@powersync/react` direkte; det byttes til `store.subscribe` / `store.listForms`. Bildekøen får det den trenger fra lageret (f.eks. `listPendingPhotos()` og `markPhotoUploaded(id, sha256)`, arkitekt setter navn). Dette er prisen for at kriteriet «Arbeid» skal være rettferdig, og det gjelder også kandidat 3.
3. Arkitekten avgjør **hvordan ElectricSQL settes opp** og skriver det inn i dette kortet under «Avgjørelser etter runde 1»:
   - **Lesing:** Electric «shapes» for `trial_forms`, `trial_answers` og `trial_photos`, alltid gjennom en proxy-rute i appen (pkt. 9), aldri direkte fra iPaden til Electric.
   - **Skriving:** `POST /api/prove/synk/endringer` fra PR #8 **uendret**. Klienten trenger derfor en egen endringskø lokalt som overlever lukking og omstart; vi eier den selv.
   - **Lokal lagring på iPaden** (må overleve lukking og omstart, prøve A). Arkitekten velger mellom (a) PGlite med Electrics synk-tillegg (full Postgres i nettleseren, tung, men Electrics egen vei) og (b) egen, liten lagring i IndexedDB av shape-radene pluss lagret posisjon (`offset`/`handle`), så synken fortsetter der den slapp. Andre biblioteker bare hvis arkitekten viser at de lagrer varig i Safari. Det som velges, og hvorfor, står i resultatfilen; linjene vi eier selv, telles der.
   - **Innlogging mot Electric:** iPaden snakker bare med appen (samme sesjon som de andre `/api/prove/`-rutene). Synktokenet fra PR #8 (`GET /api/prove/synk/token`) brukes derfor trolig ikke av denne kandidaten; arkitekten bekrefter, og det står i resultatfilen som et funn (mindre å eie).

### Bit 1 – Klient: ElectricSQL-lageret og valg av kandidat
4. **Nye avhengigheter:** `@electric-sql/client` (Apache-2.0) og, hvis arkitekten velger (a) i pkt. 3, `@electric-sql/pglite` og `@electric-sql/pglite-sync` (Apache-2.0). Ingen `@electric-sql/react` med mindre utvikler viser at den sparer kode. Lisensene sjekkes mot `package.json` i pakkene og dateres i resultatfilen. Begrunnelsen gjentas i PR-en.
5. `src/modules/offline-trial/sync/electricsql/store.ts`: `createElectricTrialStore(deviceId, organizationId)` som oppfyller `TrialSyncStore`. Leser de tre shapene gjennom proxy-ruten, skriver lokalt først, legger endringer i den lokale køen og sender dem buntvis til `POST /api/prove/synk/endringer` når nettet finnes. En bunt tas ut av køen **bare** når serveren svarte 200 (samme regel som PowerSync-koblingen). Avviste bunter (400/409) blir liggende, som i PR #8 (kjent svakhet, ikke løst her).
6. **Samme oppførsel som PowerSync-lageret** for det prøvene måler: `trial_answers` upsert på `(trial_form_id, field_key)`; tekstfelt skriver `value` og `text_state` ca. 300 ms etter siste tastetrykk, lager aldri tilstand fra en gammel `value`, og fletter innkommende `text_state` lokalt med `text-merge.ts` (gjenbruk, ingen ny flettekode); bildefelt bygges av `trial_photos`-rader med `rowsToAnswers`; bildefilen lagres i `offline-trial-photos` (IndexedDB) med `photo-store.ts` som før. Nedlastede rader skal aldri legges over lokale endringer som ikke er sendt ennå.
7. **Valg av kandidat:** listen `/prove/testskjema` får en liten velger «Synkløsning» med to knapper, **«PowerSync»** og **«ElectricSQL»** (minst 44 pt). Valget lagres i `localStorage` (nøkkel `trial_sync_candidate`, verdier `powersync` | `electricsql`, standard `powersync`) og gjelder til det byttes. Bytte er bare tillatt når indikatoren viser «Alt er lagret på serveren»; ellers er den andre knappen slått av med teksten **«Vent til alt er lagret på serveren før du bytter»**. Hver kandidat har sin egen lokale lagring; ingenting slettes ved bytte. Velgeren står på listen, ikke i skjemaet, så skjemaet er likt for begge.
8. **Testkrok** (`NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`): `window.__offlineTrial` får `candidate`, `store` og `deviceId`, og én kandidatuavhengig måte å skrive rader inn i den lokale lagringen «som om de kom fra synk» (arkitekt setter form), så e2e-testene for «Endret av en annen» og «overlever omlasting» kan kjøres for begge kandidater uten tjeneste.

### Bit 2 – Server: proxy-rute, Electric i Docker og drift
9. `src/modules/offline-trial/server/electric-shape.ts`: `buildTrialShapeRequest(actor, organizationId, table, clientParams)` → `requireOrganizationAccess(actor, organizationId, "organization.read")` → bare de tre `trial_`-tabellene (alt annet `InvalidTrialChangeError`, 400) → bygger forespørselen til Electric med `where organization_id = $1 AND deleted_at IS NULL` der `$1` er **`grant.organizationId`** sendt som parameter, aldri limt inn i teksten og aldri fra klienten; `columns` for `trial_photos` uten `storage_path`; slipper bare gjennom Electrics egne spørreparametre fra klienten (`offset`, `handle`, `live`, `cursor`), aldri `where`, `columns` eller `table`; legger på Electrics hemmelighet (`ELECTRIC_SECRET`) på serversiden. Tynn rute `src/app/api/prove/synk/shape/route.ts`: `getCurrentActor` (401), kaller funksjonen, videresender svar og Electrics svarhoder, `Cache-Control: no-store` på feil. Ingen tilgangslogikk i ruten. Logging: bare tabellnavn og status, aldri radene.
10. `tests/`: `expectTenantIsolation` for `buildTrialShapeRequest` (fremmed organisasjon gir `AccessDeniedError`; `where` har alltid `grant.organizationId`). Enhetstester på at klientens `where`/`columns`/`table` aldri når Electric, og at `storage_path` aldri står i `columns`.
11. **Electric lokalt (Docker, selvdrevet):** `docker-compose.yml` får tjenesten `electric` (offisielt bilde `electricsql/electric`, **fast versjonstag**, aldri `latest`), bundet til `127.0.0.1` på en port som **ikke** er 3000 (Electrics standard krasjer med appen; utvikler velger f.eks. 3010), `depends_on: db: condition: service_healthy`, eget volum for Electrics lagring, `ELECTRIC_SECRET` fra `.env` (utviklingsverdi, ikke hemmelig, bare for localhost, samme mønster som `POWERSYNC_JWT_SECRET`). Databasen har allerede `wal_level=logical`. Electric og PowerSync kjører **side om side** på samme database (hver sin publikasjon og replikeringsplass); utvikler avklarer om Electric kan bruke en publikasjon fra migreringen (bare de tre tabellene, aldri `FOR ALL TABLES`) eller må lage sin egen med rettigheten den trenger, og skriver det i driftsdokumentet. Bruksdata til leverandøren slås av hvis bildet har en slik bryter.
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
- **Ingen service worker-endring** utover å hurtiglagre det den nye klienten trenger (f.eks. wasm hvis PGlite velges). Hurtiglagring av shape-svar i service workeren: nei; det er lageret som eier dataene.
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
| `GET /api/prove/synk/shape?organisasjon=<id>&tabell=<trial_forms\|trial_answers\|trial_photos>&offset=…&handle=…&live=…&cursor=…` | innlogget | Electrics svar (kropp og svarhoder) videresendt uendret; `400` ukjent tabell eller ulovlig parameter, `401`, `403` fremmed organisasjon, `502` når Electric ikke svarer (ingen `Cache-Control` som lar nettleseren lagre feilsvar) |

**Endret klientkontrakt (`sync/types.ts`, arkitekt):** `getAnswers` fjernes; én metode for å følge synkstatus legges til; bildekøen får det den trenger fra lageret. Ellers lik. PowerSync-lageret og sidene oppdateres til den nye kontrakten i samme PR (det er den eneste endringen i `sync/powersync/`).

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
- [ ] Velgeren: valget overlever omlasting; med endringer som venter er den andre knappen slått av med riktig tekst; bytte sletter ingenting lokalt (svar skrevet med PowerSync er der igjen når det byttes tilbake).
- [ ] «Endret av en annen» vises med ElectricSQL valgt når en `trial_answers`-rad med `device_id = "annen-enhet"` skrives via testkroken.
- [ ] Tekstfelt: innkommende `text_state` flettes lokalt med `mergeTextStates` (enhetstest på lagerets rene del), og en lokal endring som ikke er sendt, overskrives aldri av en nedlastet rad (enhetstest).
- [ ] Endringskøen: en bunt fjernes bare etter 200 fra serveren; feil status eller manglende svar beholder bunten; køen overlever omlasting (e2e).
- [ ] `buildTrialShapeRequest`: `where` bruker alltid `grant.organizationId` som parameter, aldri fra spørrestrengen; klientens `where`, `columns` og `table` når aldri Electric; `trial_photos` uten `storage_path`; ukjent tabell gir 400 og ingen kall mot Electric; fremmed organisasjon gir `AccessDeniedError` (`expectTenantIsolation`). E2e `request`: 401 uinnlogget, 403 for `?organisasjon=<tilfeldig uuid>`.
- [ ] `sync/types.ts` har ikke `getAnswers`; `src/app/(ansatt)/prove/testskjema/**` og `sync/photo-uploader.ts` importerer ikke fra `@powersync/*`, `@electric-sql/*`, `sync/powersync/` eller `sync/electricsql/` (sjekk med `grep` i testplanen, eller lint-regel hvis arkitekt vil).
- [ ] `docker compose config` er gyldig der Docker finnes; `electric` er bundet til `127.0.0.1` med fast versjonstag; `start.sh` er gyldig bash 3.2 (`bash -n`) og kjører med `EZPROP_SKIP_DOCKER=1`.
- [ ] `docs/drift/electricsql.md` og det tekniske avsnittet i `docs/funksjoner/fase1-prove-ab-electricsql.md` er fylt inn, også det som ikke virket og linjene vi eier selv.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dekket av `expectTenantIsolation` på `buildTrialShapeRequest`.
- [ ] Virker på iPad-størrelse (e2e): `ipad`-prosjektet har kjørt alle e2e-testene.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.2.
- [ ] Ingen modellnavn i commit-meldingene (`git log fase1-kandidat-powersync..HEAD`).

## Roller
- **arkitekt**: forarbeidet (pkt. 1–3): kontrakten, oppsettet av Electric (shapes via proxy, lokal lagring, kø) og om synktokenet brukes. Ingen ADR nå.
- **sikkerhet-personvern**: proxy-ruten er ny angrepsflate mot en intern tjeneste (parametre som slippes gjennom, `where` som parameter, hemmelighet bare på serversiden, Electric aldri åpen utad). Kjører `/security-review` på PR-en når bit 2 er skrevet.
- **test-leder**: skriver `fase1-kandidat-electricsql-testplan.md` før koding og godkjenner til slutt.
- **utvikler**: bit 1 (klient) og bit 2 (server, Docker, drift) i parallell etter forarbeidet.
- **testskriver**: etter testplanen, i parallell med utvikler.
- **prosjektleder**: oppgavekort, resultatmal, spørsmål nr. 11, ordliste, tilstand, PR.

Ikke med: ux-ansvarlig og ui-designer (prøveverktøy; tekstene står under «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst).

## Avgjørelser etter runde 1 (prosjektleder)
Fylles inn etter runde 1.

## Åpne spørsmål
- Nr. 11 i `docs/09-apne-sporsmal.md`: ElectricSQL som leverandør (selvdrevet eller Electric Cloud, pris, databehandleravtale). Ikke blokkerende; alt kjører selvdrevet uten konto.
- Nr. 10 (PowerSync) står fortsatt åpent; begge trengs før ADR-en.
