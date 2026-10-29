# Funksjon: Tredje kandidat for drift uten nett – egenbygd synk (lokal database og endringskø) koblet til testskjemaet

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (fra oppgave 3–5). Ingen nye tabeller, ingen migrering.
- **Status:** forarbeidet er levert (arkitekt 29.10.2026, se «Forarbeid levert»). Neste: testplan, så bygging.
- **Branch:** `fase1-kandidat-egenbygd`, **bygger på `fase1-kandidat-electricsql` (PR #10)**. PR åpnes mot `fase1-kandidat-electricsql` til PR #10 er merget, deretter mot `main`.
- **Dato:** 29.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, punktet «Kandidater satt opp mot samme testskjema …», delpunktet **«Kandidat 3, egenbygd (lokal database og endringskø), på samme skjema og samme protokoll»**. Når dette er levert, krysses hovedpunktet av (alle tre kandidater satt opp).
- **Testplan:** `docs/funksjoner/fase1-kandidat-egenbygd-testplan.md` (skrives av test-leder før koding; navnene der er bindende for testskriver).
- **Protokoll og resultat for prøve A og B:** `docs/funksjoner/fase1-prove-ab-egenbygd.md` (ligger klar fra prosjektleder, samme struktur som for PowerSync og ElectricSQL; utvikler fyller inn det tekniske, Ståle tallene).
- **Støtter hovedmål:** Tid: befaring uten nett på iPad er den største tidsbesparelsen mot IVIT; den egenbygde løsningen er sammenligningsgrunnlaget som viser hva de to verktøyene faktisk sparer oss for. / Reklamasjoner: ingenting går tapt mellom befaring og rapport (en endring slippes fra iPaden bare når serveren har svart 200, samme krav som for de to andre). / KI først: ikke KI i oppgaven, men synklaget som velges, er der KI-forslag senere vises og godkjennes på iPaden, også uten nett.

## Problem
PR #8 (PowerSync) og PR #10 (ElectricSQL) viser to verktøy. ElectricSQL-kandidaten viste at vi uansett eier lokal lagring, endringskø og innfletting selv (1 213 linjer på klienten), og at Electric bare gir oss lesingen. Da må ADR-en kunne svare på: **hva gir verktøyene oss som vi ikke klarer enkelt selv?** Uten en egenbygd kandidat på samme skjema og samme protokoll kan vi ikke svare på det med tall, og vi risikerer å ta inn en ekstra tjeneste i drift (en container til i Azure, en leverandør til) uten å vite om den trengs.

Kandidat 3 er den enkleste løsningen som oppfyller kravene: lokal lagring i IndexedDB, egen endringskø som overlever lukking og omstart, skriving via ruten vi har, og lesing via én enkel egen rute som gir «endringer siden sist». **Ingen ny tjeneste, ingen ny avhengighet, ingen databaseendring.**

Oppgaven er **en prøve, ikke en produktfunksjon**. Alt i `sync/custom/` og den nye ruten får hodekommentaren «Prøve fase 1, kastes eller gjøres om etter ADR».

## KI først
Nei. Teknisk grunnarbeid (lokal lagring, synk, fletting). KI kommer ikke inn før grunnmuren står (beslutning 25.10.2026). Oppgaven forbereder «KI først» som oppgave 4 og 5: svar per felt med enhet og versjon er formen KI-forslag senere lagres i, og tekstflettingen (Yjs) lar et KI-utkast og takstmannens egne ord leve i samme felt.

## Brukerhistorier
- Som **takstmann** vil jeg **fylle ut testskjemaet og ta bilder i flymodus, lukke appen og starte iPaden på nytt** slik at **alt ligger på serveren når nettet kommer**, uansett hvilken kandidat som er valgt.
- Som **takstmann** vil jeg **velge «Egenbygd» under «Synkløsning» på listen** slik at **prøve A og B kjøres likt for alle tre kandidater**.
- Som **Ståle** vil jeg **kjøre den egenbygde kandidaten uten å starte noe ekstra** (ingen Docker-tjeneste, ingen container i Azure) slik at **prøvene kan kjøres med en gang testmiljøet er oppe**.
- Som **prosjektleder** vil jeg **ha resultatfil med samme tabeller som for de to andre** slik at **sammenligningen og ADR-en blir tall mot tall**.

## Omfang

Arbeidet deles i **to biter som ikke henger sammen i kode**, etter et lite forarbeid fra arkitekt. Kontrakten mellom bitene (hente-ruten) står under «Data» og er bindende.

**Med:**

### Forarbeid – gjenbruk og lesevei (arkitekt, før bitene starter)
Avgjort i runde 1 (arkitekt 29.10.2026, se «Beslutninger i runde 1»).

1. **Felles kode flyttes til `sync/local/` («lokal kjerne»)**, uten logikkendring:
   - `git mv electricsql/outbox.ts → local/outbox.ts` og `electricsql/apply-incoming.ts → local/apply-incoming.ts`, med testfilene. Bare importstiene endres. `custom/` importerer aldri fra `electricsql/`.
   - `electricsql/storage.ts` blir `local/idb.ts` med `createLocalDb({ name, version, stateStore: { name, keyPath } })`. Den gir `open`, `close`, `clear`, `inTransaction`, `readAll`, `requestResult` og `syncedStoreOf`; singletonen ligger per instans. Electric bruker `{ name: "offline-trial-electric", stateStore: { name: "shape_state", keyPath: "table" } }`, altså samme navn, nøkkel og versjon som i dag, så ingen data på enheten flyttes. `clearElectricStorage` beholdes som tynn innpakning, så select-store og e2e ikke endres.
   - Kjernen i lageret skilles ut i `local/trial-store.ts`: `createLocalTrialStore({ db, deviceId, organizationId, reader })`. Dit flyttes radomforming, lyttere, `serial`, `writeLocal`, tekstforsinkelsen på 300 ms, sendingen av køen, «bekreftet»-settet, `mergeIncoming`, `adoptServerIds` og alle metodene i `TrialSyncStore`. Bare skjemaleseren (shape-løkken, `resetTable`, shape-tolkning) blir igjen i `electricsql/store.ts`.
   - Grensesnittet mellom kjerne og leser:
     `interface LocalTrialReader { start(ctx: LocalReadContext): void; wake(): void; stop(): void }`
     `interface LocalReadContext { organizationId: string; isClosed(): boolean; isOnline(): boolean; mergeIncoming(table: TrialTableName, changes: readonly IncomingChange[], stateRow: Record<string, unknown> | null): Promise<void>; resetTable(table: TrialTableName, stateKey: string): Promise<void>; deleteState(key: string): Promise<void>; notifyStatus(): void; afterAck(listener: () => void): void }`
   - **Krav:** alle Vitest- og e2e-tester for ElectricSQL og PowerSync er grønne **uendret**. «Uendret» betyr samme testnavn og samme forventninger; bare importstier kan endres i filer som er flyttet. **Fallback:** blir en Electric-test rød og ikke rettet innen to timer, legges kjernen tilbake der den var, og `custom/store.ts` skrives etter samme mønster som kopi. Det føres i resultatfilen.
2. **Leseveien («endringer siden sist») uten databaseendring.** Funn: `updated_at` settes av databasens `now()` (start av transaksjonen) ved innsetting og av appserverens klokke ved oppdatering (`src/db/schema/common.ts`). En skriving kan derfor få en tid før en rad som allerede er hentet. Løsningen er en markør per tabell med overlapp:
   - Markøren er base64url-JSON `{ v: 1, t: { trial_forms: { u, id }, trial_answers: { u, id }, trial_photos: { u, id } } }`. `u` er `updated_at` som tekst med mikrosekunder, lest fra PostgreSQL (`updated_at::text` eller `to_char` med `US`), **aldri gjennom JS `Date`** (da mistes mikrosekundene og sidene kan gå i ring). Markøren har ingen organisasjons-ID og ingen signatur: spørringen filtrerer alltid på `grant.organizationId`.
   - Spørringen per tabell: `organization_id = grant.organizationId AND (updated_at, id) > (u, id)`, sortert på `updated_at, id`. Myk slettede rader er med. Bare kolonnene i `localColumnsOf(table)`.
   - Grensen 500 gjelder hele svaret. Tabellene leses i fast rekkefølge: forms, answers, photos. En tabell som ikke ble nådd, beholder markøren sin. `ferdig: true` bare når alle tre ga færre rader enn plassen som var igjen.
   - **Overlapp 60 s:** når en tabell er ferdig lest, settes markøren til `(største u minus 60 s, nil-uuid)`. Hver henting leser da de siste 60 s på nytt; det er ufarlig fordi `applyIncoming` tåler samme rad flere ganger. Mens sidene leses (`ferdig: false`), brukes ren keyset uten overlapp, så sidene ikke kan gå i ring. 60 s dekker lange transaksjoner og klokkeforskjell mellom app og database. Overlappet og blandingen av klokker føres i resultatfilen.
   - Ugyldig markør (Zod: `v`, gyldig tid, uuid; også søppel, feil base64 og for lang tekst) gir 400 `{ feil }` via ny `InvalidTrialCursorError` i `server/errors.ts`, aldri 500. Klienten sletter bare markøren og henter fra start; synkede rader og køen røres ikke.
   - Funn til ADR-en, ikke noe vi gjør nå: det finnes ingen indeks på `(organization_id, updated_at, id)`. Greit med prøvens datamengder; produksjon trenger en migrering.
3. **Valg av kandidat og grenser:**
   - `TRIAL_SYNC_CANDIDATES = ["powersync", "electricsql", "custom"]`. Standardvalget forblir `powersync`. `select-store.ts` får `openCustom` (dynamisk import). `clearIfOtherOrganization` tømmer også `offline-trial-custom`, **inkludert hentemarkøren** (en markør fra organisasjon A skal aldri brukes for B).
   - `sync/candidate-boundaries.test.ts`: mønsteret utvides til `sync/(powersync|electricsql|custom|local)` for sidene, `photo-uploader.ts` og `sync-indicator.tsx`. Testen for «rene filer» og testen for hodekommentar utvides til `sync/local/` og `sync/custom/`. Testen for dynamisk import i select-store får `custom/`.

### Bit 1 – Klient: det egenbygde lageret og velgeren
4. **Ingen nye avhengigheter.**
5. `src/modules/offline-trial/sync/custom/store.ts`: `createCustomTrialStore(deviceId, organizationId)` = `createLocalTrialStore` med `createLocalDb({ name: "offline-trial-custom", stateStore: { name: "sync_state", keyPath: "key" } })` og en egen hente-leser (`custom/reader.ts`, `LocalTrialReader`). Oppfyller `TrialSyncStore` og `TrialSyncTestable`. Skriving, kø og sending kommer fra den lokale kjernen (en bunt tas ut **bare** ved 200). `sync_state` har radene `{ key: "cursor", value }` og `{ key: "outbox_next_seq", nextSeq }`.
   - Leseren fletter tabellene etter hverandre med `mergeIncoming` og skriver `cursor` bare sammen med den siste tabellen. Stopper enheten midt i, hentes radene på nytt, og det er ufarlig.
   - Innkommende rader sendes som `kind: "update"`; `applyIncoming` fjerner rader med `deleted_at` lokalt, og en rad med usendt lokal endring røres ikke (bare tekst flettes). Radene normaliseres med `normalizeShapeRow` eller en felles normaliserer i `sync/local/`.
6. **Henting:** med nett hentes endringer **høyst én gang per 5 s** (vanlig takt mens appen er åpen, så prøve B ser den andres endring innen ca. 5 s). Ved feil prøves det igjen med økende ventetid 5, 10, 20, 40, 60 s (tak 60), tilbake til 5 etter en vellykket henting. Ved `ferdig: false` hentes neste side med en gang. Etter at en bunt er sendt (200) hentes det ved neste takt (`afterAck`). Takten og ventetiden ligger i **en ren funksjon** (`custom/pull-schedule.ts`) med egen Vitest-test. Henting blokkerer aldri skriving. Ingen lang-polling, ingen websocket, ingen service worker-endring.
7. **Samme oppførsel som de to andre** for det prøvene måler: svar upsertes på `(trial_form_id, field_key)`; tekstfelt skriver `value` og `text_state` ca. 300 ms etter siste tastetrykk; bildefelt bygges av `trial_photos`-rader; bildefilen lagres i `offline-trial-photos` som før; `markPhotoUploaded` skriver bare lokalt; «Endret av en annen» vises når en rad med annen `device_id` kommer inn.
8. **Velgeren** på listen `/prove/testskjema` får en tredje knapp **«Egenbygd»** (minst 44 pt), samme regler som i dag (bytte bare når alt er lagret, `location.reload()`, ingenting slettes ved bytte).
9. **Testkroken** (`sync/test-hooks.ts`) virker for `custom` som for `electricsql`: `readRows` tar `TrialTableName | "sync_state" | "outbox"`, og `sync_state` leses uten raden `outbox_next_seq` (samme mønster som Electric).

### Bit 2 – Server: hente-ruten
10. `src/modules/offline-trial/server/changes-since.ts`: `listTrialChangesSince(actor: Actor, organizationId: string, cursor: string | null): Promise<{ endringer: Record<TrialTableName, Record<string, unknown>[]>; markor: string; ferdig: boolean }>`. Først `requireOrganizationAccess(actor, organizationId, "organization.read")`, så markøren og spørringen fra forarbeidet pkt. 2, filtrert på `grant.organizationId` (aldri en id fra adressen eller markøren). **Også myk slettede** rader (med `deleted_at`, så iPaden fjerner dem; serveren beholder dem, regel 3). Bare kolonnene i `localColumnsOf(table)`: aldri `storage_path`, `created_by`, `updated_by`, `deleted_by`. Svaret er i snake_case og samme form som `normalizeShapeRow` venter: tid som ISO-tekst, `value` som JSON-tekst, `size_bytes` som tall.
11. Tynn rute `src/app/api/prove/synk/hent/route.ts` (`dynamic = "force-dynamic"`), importerer bare fra modulens `server/`: `getCurrentActor` (401), kaller `listTrialChangesSince`, svarer JSON med `Cache-Control: private, no-store` på **alle** svar (også 400, 401 og 403). `InvalidTrialCursorError` gir 400 (`{ feil }`). Ingen tilgangslogikk i ruten. Logging: bare `route`, `userId`, antall rader og status, aldri radene.
12. `expectTenantIsolation` på `listTrialChangesSince` (fremmed organisasjon gir `AccessDeniedError`; rader fra organisasjon B kommer aldri med for A, heller ikke med en markør laget for B).

### Begge biter
13. **Resultatfilen** `docs/funksjoner/fase1-prove-ab-egenbygd.md`: utvikler fyller inn «Teknisk som utvikleren fyller inn», også det som ikke virket, og **hvor mange linjer vi eier selv**, delt i det som er gjenbrukt fra ElectricSQL og det som er nytt. Linjene telles på samme måte som i Electric-filen.
14. **Grense for arbeidet:** klarer ikke utvikler å få lesing, kø og innfletting til å virke sammen innen **én arbeidsdag** etter at forarbeidet ligger klart (det meste er gjenbruk), leveres det som står, knappen viser «Egenbygd (ikke klar)», og det står tydelig i resultatfilen og PR-en. Det er et resultat for ADR-en, ikke en mangel ved PR-en.
15. Versjon `0.2.2 → 0.2.3` i `package.json`. Ordlisten i `docs/05-domenemodell.md` avsnitt 8 er oppdatert i dette kortet (hentemarkør, egenbygd kandidat, lokal kjerne).

**Ikke med (bevisst utelatt):**
- **Selve prøvene A og B** på ekte iPad: Ståle kjører dem i testmiljøet. Kandidat 3 trenger ingen ekstra container, så den kan prøves så snart appen er oppe i Azure.
- **Sammenligning og ADR**: egne punkter i fase 1.
- **Prøve C–F**, fullt synkstatus-punkt («lagret kl.», «Synk nå»), `DELETE` i synkkontrakten, konfliktlogg, fletting for tabell/TG/valg/tall: som i oppgave 4 og 5.
- **Ingen endring i skriveruten** `POST /api/prove/synk/endringer`, i `applyTrialChanges`, `storeTrialPhoto` eller i tabellene. Ingen migrering.
- **Ingen ny tjeneste** (ingen Docker-tjeneste, ingen endring i `docker-compose.yml`, `start.sh` eller Azure-oppsettet), ingen websocket, ingen lang-polling, ingen push.
- **Ingen nye avhengigheter.**
- **Ingen ny kø- eller flettekode** der ElectricSQL-kandidatens kode kan brukes.
- **Ingen endring i oppførselen til PowerSync- eller ElectricSQL-lageret.** Bare flyttingen til `sync/local/` i forarbeidet.
- **Ingen indeks eller migrering** for hentespørringen (funn til ADR-en).
- **Ingen `navigator.locks`** (én fane sender køen): kjent svakhet, som for Electric.
- **Ingen rate limit på hente-ruten** (prøveverktøy bak innlogging).
- **Ingen nye skjermer** utover knappen «Egenbygd». Skjemaet ser likt ut for alle tre.
- **Ingen småfunn fra PR #8** og ingen Bicep for PowerSync/Electric; egne små oppgaver.
- **Ingen Safari i e2e.**

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | alle testskjemaer i egen organisasjon | ja |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja (stenges aldri ute) | ja |

Uendret fra oppgave 4 og 5. Hente-ruten kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og filtrerer på `grant.organizationId`; klienten kan ikke påvirke hvilken organisasjon radene kommer fra, heller ikke gjennom markøren.

## Data
Ingen nye tabeller, ingen migrering. `trial_forms`, `trial_answers` og `trial_photos` brukes uendret.

**Ny rute (kontrakt mellom bit 1 og 2):**

| Rute | Inn | Ut |
|---|---|---|
| `GET /api/prove/synk/hent?organisasjon=<id>&siden=<markør>` | innlogget; `siden` utelates ved første henting | `200` `{ endringer: { trial_forms: [...], trial_answers: [...], trial_photos: [...] }, markor: "<ny markør>", ferdig: true \| false }` med radene i snake_case og bare kolonnene i `localColumnsOf(table)`, myk slettede med `deleted_at`; alltid `Cache-Control: private, no-store`. `400` `{ feil }` ugyldig markør, `401`, `403` fremmed organisasjon |

Markørens form avgjøres av arkitekt i forarbeidet (pkt. 2) og er en tekst klienten bare lagrer og sender tilbake.

Markøren er base64url-JSON `{ v: 1, t: { <tabell>: { u, id } } }` (forarbeidet pkt. 2). For klienten er den en tekst den bare lagrer og sender tilbake.

**Lokal lagring (IndexedDB `offline-trial-custom`):** samme lagre som Electric (`synced_trial_forms`, `synced_trial_answers`, `synced_trial_photos`, `outbox`), pluss lageret `sync_state` (keyPath `key`, radene `cursor` og `outbox_next_seq`; erstatter `shape_state`). Bildefilene ligger som før i `offline-trial-photos`.

**Faste koder:** feltnøklene fra oppgave 3 (40 stk.) uendret. Ingen nye koder. `custom` er en verdi for innstillingen `trial_sync_candidate` i nettleseren, ikke en kode i datamodellen.

## Skjermer
iPad (liggende, 1194 × 834) og PC. Én endring:
- **Liste** (`/prove/testskjema`): velgeren «Synkløsning» får tredje knapp **«Egenbygd»**, samme oppførsel som de to andre. Er kandidaten ikke klar (pkt. 14): «Egenbygd (ikke klar)».
- **Skjemaet**: uendret.

Ingen skisse fra ui-designer eller ux-ansvarlig: prøveverktøy, tekstene står her.

## Regler
Ingen regler eller TG-logikk (prøve E).

## Akseptkriterier
- [ ] Med «Egenbygd» valgt kan et nytt testskjema lages fra listen, åpnes, og alle 40 felt fylles ut i e2e i `pc` og `ipad`; telleren viser «40 av 40 felt utfylt». Samme delte test er grønn for PowerSync og ElectricSQL.
- [ ] Svarene og et valgt bilde overlever at siden lastes på nytt i e2e med «Egenbygd» valgt.
- [ ] Uten nett i e2e (`context.setOffline(true)`) åpner skjemaet fra hurtiglageret, nye svar kan skrives, og indikatoren viser «Uten nett»; med nett igjen når den «Alt er lagret på serveren».
- [ ] Endringskøen: 500 og avbrutt kall via `page.route` beholder bunten, og den tømmes etter `unroute` (e2e); køen overlever omlasting (e2e).
- [ ] **To enheter (e2e, to nettleserkontekster mot samme server):** en tekst skrevet på den ene vises på den andre uten omlasting; samtidig tekst i samme felt gir begge bidrag; TG skrevet på begge gir samme verdi på begge og «Endret av en annen» hos den som tapte. Rekkefølgen på sendingen styres med `setOffline` per kontekst, så det er fast hvem som taper. Dette er prøve B i det små, og det kan vi vise i skyen for denne kandidaten fordi den ikke trenger noen ekstra tjeneste.
- [ ] Henting: Vitest for den rene funksjonen i `custom/pull-schedule.ts` (5, 10, … tak 60, tilbake til 5 etter suksess, neste takt etter 200 på en bunt, neste side med en gang ved `ferdig: false`). E2e teller kall mot `/api/prove/synk/hent` (`page.clock` eller tidsvindu med slingringsmonn; grensen står i testplanen). 400 (ugyldig markør) i e2e: neste henting går uten `siden`, og køen er urørt.
- [ ] Nedlastede rader legges aldri over usendte lokale endringer, og innkommende `text_state` flettes (dekket av de flyttede enhetstestene for `applyIncoming`). Ny enhetstest for hente-leseren: en rad med `deleted_at` fra hente-ruten fjernes lokalt, og en slik rad med usendt lokal endring røres ikke.
- [ ] Organisasjonsbytte tømmer hentemarkøren (e2e for organisasjonsbytte utvidet med `custom`).
- [ ] `listTrialChangesSince`: **ingen rad hoppes over** (integrasjonstest med to tilkoblinger: tx1 setter inn uten commit, tx2 skriver og committer, det hentes og markøren flyttes forbi; tx1 committer, og neste henting gir tx1-raden; i tillegg en oppdatering med `updated_at` bakover i tid innenfor 60 s som kommer med); myk slettede rader kommer med; nøklene i hver rad er nøyaktig `localColumnsOf(table)`; 501 eller flere rader med samme `updated_at` gir `ferdig: false` og resten i neste svar uten at noen blir borte (duplikater er lov); en markør laget for B og sendt av A gir 0 B-rader; forfalsket markør (fremtidig tid, fremmed id, søppel, for lang tekst, feil base64) gir 400 eller bare egne rader, aldri 500; `it.each` over alle fire roller slipper inn, deaktivert nektes (admin stenges aldri ute); fremmed organisasjon gir `AccessDeniedError` med `expectTenantIsolation`. Ruten: alltid `Cache-Control: private, no-store`. E2e `request`: 401 uinnlogget, 403 for `?organisasjon=<tilfeldig uuid>`, 400 for ugyldig markør.
- [ ] Velgeren: tre knapper; valget «Egenbygd» overlever omlasting; bytte er sperret når noe venter; bytte sletter ingenting lokalt for noen kandidat.
- [ ] Bytte av organisasjon på samme enhet tømmer også `offline-trial-custom` (samme e2e som for de to andre, utvidet med `custom`).
- [ ] `sync/candidate-boundaries.test.ts` viser at sidene, `sync/photo-uploader.ts` og `sync-indicator.tsx` ikke importerer fra `sync/custom/` eller `sync/local/`.
- [ ] Alle e2e- og Vitest-tester for PowerSync og ElectricSQL er grønne uendret (samme testnavn og forventninger; bare importstier i flyttede filer). `createLocalDb` har en test med to databaser som ikke ser hverandre.
- [ ] Skriveveien er uendret: `git diff fase1-kandidat-electricsql` viser ingen endring i `applyTrialChanges` eller `POST /api/prove/synk/endringer`.
- [ ] Ingen nye avhengigheter (`package.json` har samme `dependencies` og `devDependencies` som `fase1-kandidat-electricsql`).
- [ ] Det tekniske avsnittet i `docs/funksjoner/fase1-prove-ab-egenbygd.md` er fylt inn, også det som ikke virket og linjene vi eier selv (gjenbrukt og nytt hver for seg).
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dekket av `expectTenantIsolation` på `listTrialChangesSince`.
- [ ] Virker på iPad-størrelse (e2e): `ipad`-prosjektet har kjørt alle e2e-testene, også ny `e2e/fase-1-egenbygd.spec.ts`.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.3.
- [ ] Ingen modellnavn i commit-meldingene (`git log fase1-kandidat-electricsql..HEAD`).

## Roller
- **arkitekt**: forarbeidet (pkt. 1–3): hva som gjenbrukes og hvordan, markøren for «endringer siden sist» uten databaseendring. Ingen ADR nå.
- **sikkerhet-personvern**: hente-ruten er en ny spørring med `organizationId` og en markør fra klienten (kan markøren brukes til å lese en annen organisasjons rader, kolonner som ikke skal ut, lagring på iPaden). Kort gjennomgang i runde 1 og `/security-review` på PR-en.
- **test-leder**: skriver `fase1-kandidat-egenbygd-testplan.md` før koding (gjenbruk av Electric-testene der det går) og godkjenner til slutt.
- **utvikler**: bit 1 (klient) og bit 2 (server) i parallell etter forarbeidet.
- **testskriver**: etter testplanen, i parallell med utvikler.
- **prosjektleder**: oppgavekort, resultatmal, ordliste, tilstand, PR.

Ikke med: ux-ansvarlig og ui-designer (prøveverktøy; én knapp, teksten står under «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst), forenkler (oppgaven er allerede den enkleste kandidaten og gjenbruker det meste).

## Beslutninger i runde 1 (prosjektleder, 29.10.2026)
- **Arkitektens forarbeid tas inn som det står**, også utskillingen av kjernen til `sync/local/trial-store.ts`. Begrunnelse: kjernen eier vi uansett, og når den ligger felles, viser linjetallet rett hva hvert verktøy sparer oss for (Electric gir skjemaleseren, egenbygd får hentelesingen). Prosjektleders forslag om å importere fra `electricsql/` er valgt bort, fordi det knytter kandidat 3 til en kandidat som kanskje kastes. Fallback med kopi står i forarbeidet pkt. 1.
- **Markør med overlapp på 60 s** i stedet for `xmin` eller sekvens/trigger. `xmin` er presis, men har wraparound, krever cast og gir full skanning; sekvens og trigger er en databaseendring, som er forbudt i oppgaven.
- **Myk sletting på klienten (uenighet arkitekt/test-leder):** arkitekten har rett i at `applyIncoming` allerede fjerner rader med `deleted_at`, og de flyttede testene dekker det. Test-leder har rett i at veien fra hente-ruten til `applyIncoming` er ny. Avgjørelse: ingen ny flettekode, men én ny enhetstest for hente-leseren, også for en rad med usendt lokal endring.
- **Ventetiden** skal ligge i en ren funksjon med egen test, så e2e ikke blir avhengig av tilfeldig timing.
- **Hentemarkøren tømmes ved organisasjonsbytte** sammen med resten av `offline-trial-custom`.
- Ingen ADR nå. Ingen spørsmål til Ståle: ingenting her gjelder fag, pris, personvern eller nye funksjoner.

## Forarbeid levert (arkitekt, 29.10.2026)
Pkt. 1 og 2 er gjort; pkt. 3 er delvis gjort. Vitest (336) og e2e for testskjema og ElectricSQL (pc og ipad) er grønne uten endring i testnavn eller forventninger.
- **Flyttet til `sync/local/`:** `outbox.ts`, `apply-incoming.ts` og testene deres (`git mv`, bare importstier endret). Ny `local/idb.ts` (`createLocalDb`), `local/trial-store.ts` (`createLocalTrialStore`, kjernen fra `electricsql/store.ts` uten logikkendring) og `local/types.ts` (kontrakten mellom kjerne og leser, og `OutboxBatchBody`, flyttet fra `electricsql/types.ts`).
- **Felles normaliserer:** `local/normalize-row.ts` (`normalizeLocalRow`), flyttet uendret fra `electricsql/shape-messages.ts`. `normalizeShapeRow` er nå et alias for den, så Electric er uendret.
- **`electricsql/store.ts`** inneholder bare skjemaleseren (`createShapeReader`) og `createElectricTrialStore` = kjernen + leseren. `electricsql/storage.ts` er en tynn innpakning (`electricDb`, `clearElectricStorage`) med samme navn, versjon og `shape_state` som før.
- **Ett tillegg i `LocalReadContext`:** `storedState` (radene i tilstandslageret ved åpning, uten `outbox_next_seq`). Electric leste dem før løkkene startet; slik er det fortsatt. Den egenbygde leseren finner markøren der.
- **Kontrakt for bit 1:** `sync/custom/types.ts` (databaseoppsett, `sync_state`, markørraden, `PullResponseBody`, takten `NextPullDelay` med utfallene `ok`, `more`, `failed`, `invalid-cursor`, `acked`, og signaturene for `createPullReader`, `createCustomTrialStore` og `clearCustomStorage`).
- **Kontrakt for bit 2:** `server/types.ts` (`TRIAL_PULL_LIMIT` 500, `TRIAL_PULL_OVERLAP_MS` 60 000, `TRIAL_PULL_CURSOR_MAX_LENGTH` 1 024, tabellrekkefølgen, `NIL_UUID`, `TrialPullCursor`, `TrialChangesSinceResult`, `ListTrialChangesSince`, koding og tolking av markøren) og `InvalidTrialCursorError` i `server/errors.ts`.
- **Kandidatgrensene:** mønsteret dekker `sync/(powersync|electricsql|custom|local)`. Nye tester: de rene filene i `sync/local/`, at `sync/local/` og `sync/custom/` aldri importerer fra `electricsql/` eller `powersync/`, og hodekommentaren i begge mappene.
- **Overlatt til bit 1 (pkt. 3):** `"custom"` i `TRIAL_SYNC_CANDIDATES`, knappen «Egenbygd», `openCustom` og tømmingen av `offline-trial-custom` i `select-store.ts`, og `custom/` i testen for dynamisk import. De henger sammen med lageret og skjermen, og må komme i samme endring, ellers peker knappen på et lager som ikke finnes.
- **Overlatt til testskriver:** testen for `createLocalDb` med to databaser som ikke ser hverandre. Vitest har ingen IndexedDB og vi tar ikke inn en ny avhengighet, så den går i e2e (`page.evaluate`).
- Ingen migrering, ingen ny avhengighet, ingen ADR.

## Avgjørelser etter gjennomgangen (prosjektleder, 29.10.2026)
Test-leder fant at takten i koden avviker fra testplanen 2.1 på fire punkter. Koden gjelder, og testplanen leses slik:
- **Svar 200 på en sendt bunt (`acked`) nullstiller feiltelleren.** Serveren svarte, så nettet virker. Én test sjekker det eksakte tallet.
- **`wake` (nettet er tilbake, appen kommer fram) henter med en gang,** også under 5 s etter forrige henting. Det skjer sjelden og gir raskere oppdatering når takstmannen trenger den.
- **`acked` gir alltid 5 s,** ikke «5 s minus tiden siden forrige henting». En henting som alt er planlagt tidligere, flyttes aldri bakover.
- **To ugyldige markører på rad** gir ingen løkke: 400 uten `siden` regnes som feil og får vanlig feilventetid.
- **«Med en gang» (ventetid 0) går uten tidtaker,** via et løfte. En tidtaker på 0 ms kan bli forsinket (i falske tidtakere i Vitest blir den 1 ms). En teller sørger for at en avlyst henting ikke går.
- **Testene skrevet to ganger** (utvikler og testskriver) slås sammen i filene med navnene fra testplanen; `.impl`-filene slettes.
- **Modellnavn i commit-meldinger:** eldre commits på branchen skrives ikke om (de ligger også på `main` og i PR #10). Nye commits har det ikke.

## Åpne spørsmål
- Ingen nye til Ståle. Kandidat 3 har ingen leverandør, ingen lisens utover det vi har og ingen ekstra drift. Nr. 10 (PowerSync) og nr. 11 (ElectricSQL) står fortsatt åpne før ADR-en.
