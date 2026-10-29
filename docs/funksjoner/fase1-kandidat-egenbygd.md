# Funksjon: Tredje kandidat for drift uten nett – egenbygd synk (lokal database og endringskø) koblet til testskjemaet

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (fra oppgave 3–5). Ingen nye tabeller, ingen migrering.
- **Status:** utkast 29.10.2026. Neste: runde 1 (arkitekt, sikkerhet-personvern, test-leder), så testplan, så bygging.
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

### Forarbeid – gjenbruk og lesevei (arkitekt, før koding)
1. **Gjenbruk fra ElectricSQL-kandidaten**, bestemt av arkitekt (standardforslag fra prosjektleder, kan endres med begrunnelse):
   - Endringskøen `sync/electricsql/outbox.ts` (ren tilstandsmaskin) og innflettingen `sync/electricsql/apply-incoming.ts` brukes **som de er**, importert fra `sync/custom/`. Ingen ny kø- eller flettekode.
   - Den lokale lagringen `sync/electricsql/storage.ts` gjøres om så navnet på databasen er et argument (én liten endring), og kandidat 3 får sin **egen** database `offline-trial-custom` med `synced_*`-lagrene, `outbox` og et lager for hentemarkøren. Hver kandidat har sin egen lagring; bytte sletter ingenting.
   - Sendingen av køen (bunter, ventetid, «bekreftet»-settet) i `sync/electricsql/store.ts`: arkitekt avgjør om den skilles ut i en felles fil som begge lagrene bruker, eller om `sync/custom/store.ts` skrives med samme mønster. Målet er færrest mulige nye linjer uten å endre Electric-lagerets oppførsel (alle Electric-tester skal være grønne uendret).
   - Flytter arkitekt felles filer ut av `sync/electricsql/` (for eksempel til `sync/local/`), gjøres det i forarbeidet, før bitene starter.
2. **Leseveien:** «endringer siden sist» for de tre `trial_*`-tabellene, hentet av iPaden. Arkitekt avgjør markøren (forslag: `updated_at` + `id` per tabell, med et overlapp bakover så en skriving som ble lagret sent ikke hoppes over; innflettingen tåler samme rad flere ganger). Kravet er: **ingen rad hoppes over** når to skrivinger skjer samtidig, og myk slettede rader kommer med som sletting. **Ingen databaseendring** (ingen ny kolonne, ingen sekvens, ingen trigger). Viser det seg umulig uten, stoppes arbeidet og det føres som funn.
3. **Valg av kandidat:** `TRIAL_SYNC_CANDIDATES` får verdien `custom`; `select-store.ts` får `openCustom`; organisasjonsbytte tømmer også `offline-trial-custom` (samme regel som for de to andre). `sync/candidate-boundaries.test.ts` utvides så sidene og bildekøen heller ikke importerer fra `sync/custom/`.

### Bit 1 – Klient: det egenbygde lageret og velgeren
4. **Ingen nye avhengigheter.**
5. `src/modules/offline-trial/sync/custom/store.ts`: `createCustomTrialStore(deviceId, organizationId)` som oppfyller `TrialSyncStore` og `TrialSyncTestable`. Skriver lokalt først, legger endringen i køen i samme transaksjon, sender bunter til `POST /api/prove/synk/endringer` (uendret) bare med nett, og tar en bunt ut **bare** ved 200 (som Electric-lageret). Henter endringer fra den nye ruten og fletter dem inn med `applyIncoming`; nedlastede rader legges aldri over usendte lokale endringer; tekstfelt flettes med `mergeTextStates`.
6. **Henting:** med nett hentes endringer **høyst én gang per 5 s** (vanlig takt mens appen er åpen, så prøve B ser den andres endring innen ca. 5 s), og ved feil prøves det igjen med økende ventetid 5–60 s. Henting blokkerer aldri skriving. Etter at en bunt er sendt (200) hentes det med en gang neste gang takten tillater det. Ingen lang-polling, ingen websocket, ingen service worker-endring.
7. **Samme oppførsel som de to andre** for det prøvene måler: svar upsertes på `(trial_form_id, field_key)`; tekstfelt skriver `value` og `text_state` ca. 300 ms etter siste tastetrykk; bildefelt bygges av `trial_photos`-rader; bildefilen lagres i `offline-trial-photos` som før; `markPhotoUploaded` skriver bare lokalt; «Endret av en annen» vises når en rad med annen `device_id` kommer inn.
8. **Velgeren** på listen `/prove/testskjema` får en tredje knapp **«Egenbygd»** (minst 44 pt), samme regler som i dag (bytte bare når alt er lagret, `location.reload()`, ingenting slettes ved bytte).
9. **Testkroken** (`sync/test-hooks.ts`) virker for `custom` som for `electricsql` (`applySyncedRows`, `readRows`, også for `outbox` og markørlageret).

### Bit 2 – Server: hente-ruten
10. `src/modules/offline-trial/server/changes-since.ts`: `listTrialChangesSince(actor, organizationId, cursor)` → `requireOrganizationAccess(actor, organizationId, "organization.read")` → rader fra de tre tabellene der `organization_id = grant.organizationId` (aldri en id fra adressen), endret etter markøren, **også myk slettede** (med `deleted_at`, så iPaden fjerner dem; serveren beholder dem, regel 3), sortert stabilt, høyst 500 rader per svar, med ny markør og `ferdig: true|false`. Bare de samme kolonnene som Electric-shapene (`localColumnsOf(table)`): aldri `storage_path`, `created_by`, `updated_by`, `deleted_by`.
11. Tynn rute `src/app/api/prove/synk/hent/route.ts` (`dynamic = "force-dynamic"`): `getCurrentActor` (401), kaller `listTrialChangesSince`, svarer JSON med `Cache-Control: private, no-store`. Ugyldig markør gir 400 (`{ feil }`), og klienten henter da fra start. Ingen tilgangslogikk i ruten. Logging: bare `route`, `userId`, antall rader og status, aldri radene.
12. `expectTenantIsolation` på `listTrialChangesSince` (fremmed organisasjon gir `AccessDeniedError`; rader fra organisasjon B kommer aldri med for A, heller ikke med en markør laget for B).

### Begge biter
13. **Resultatfilen** `docs/funksjoner/fase1-prove-ab-egenbygd.md`: utvikler fyller inn «Teknisk som utvikleren fyller inn», også det som ikke virket, og **hvor mange linjer vi eier selv**, delt i det som er gjenbrukt fra ElectricSQL og det som er nytt. Linjene telles på samme måte som i Electric-filen.
14. **Grense for arbeidet:** klarer ikke utvikler å få lesing, kø og innfletting til å virke sammen innen **én arbeidsdag** etter at forarbeidet ligger klart (det meste er gjenbruk), leveres det som står, knappen viser «Egenbygd (ikke klar)», og det står tydelig i resultatfilen og PR-en. Det er et resultat for ADR-en, ikke en mangel ved PR-en.
15. Versjon `0.2.2 → 0.2.3` i `package.json`. Ordlisten i `docs/05-domenemodell.md` avsnitt 8 er oppdatert i dette kortet (hentemarkør, egenbygd kandidat).

**Ikke med (bevisst utelatt):**
- **Selve prøvene A og B** på ekte iPad: Ståle kjører dem i testmiljøet. Kandidat 3 trenger ingen ekstra container, så den kan prøves så snart appen er oppe i Azure.
- **Sammenligning og ADR**: egne punkter i fase 1.
- **Prøve C–F**, fullt synkstatus-punkt («lagret kl.», «Synk nå»), `DELETE` i synkkontrakten, konfliktlogg, fletting for tabell/TG/valg/tall: som i oppgave 4 og 5.
- **Ingen endring i skriveruten** `POST /api/prove/synk/endringer`, i `applyTrialChanges`, `storeTrialPhoto` eller i tabellene. Ingen migrering.
- **Ingen ny tjeneste** (ingen Docker-tjeneste, ingen endring i `docker-compose.yml`, `start.sh` eller Azure-oppsettet), ingen websocket, ingen lang-polling, ingen push.
- **Ingen nye avhengigheter.**
- **Ingen ny kø- eller flettekode** der ElectricSQL-kandidatens kode kan brukes.
- **Ingen endring i oppførselen til PowerSync- eller ElectricSQL-lageret.** Bare den flyttingen arkitekten bestemmer i forarbeidet.
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

**Lokal lagring (IndexedDB `offline-trial-custom`):** samme lagre som Electric (`synced_trial_forms`, `synced_trial_answers`, `synced_trial_photos`, `outbox`), pluss ett lager for hentemarkøren (navn settes av arkitekt; erstatter `shape_state`). Bildefilene ligger som før i `offline-trial-photos`.

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
- [ ] **To enheter (e2e, to nettleserkontekster mot samme server):** en tekst skrevet på den ene vises på den andre uten omlasting; samtidig tekst i samme felt gir begge bidrag; TG skrevet på begge gir samme verdi på begge og «Endret av en annen» hos den som tapte. Dette er prøve B i det små, og det kan vi vise i skyen for denne kandidaten fordi den ikke trenger noen ekstra tjeneste.
- [ ] Henting: høyst ett kall mot `/api/prove/synk/hent` per 5 s (e2e teller kall), økende ventetid ved feil, og 400 (ugyldig markør) gir ny henting fra start uten at køen røres.
- [ ] Nedlastede rader legges aldri over usendte lokale endringer, og innkommende `text_state` flettes (dekket av de gjenbrukte enhetstestene for `applyIncoming`; ny enhetstest bare for det som er nytt i kandidat 3).
- [ ] `listTrialChangesSince`: ingen rad hoppes over ved samtidige skrivinger (integrasjonstest som skriver mens det hentes, eller som viser overlappet); myk slettede rader kommer med som sletting; `storage_path`, `created_by`, `updated_by`, `deleted_by` er aldri med; mer enn 500 endringer gir `ferdig: false` og resten i neste svar; `it.each` over alle fire roller slipper inn, deaktivert nektes (admin stenges aldri ute); fremmed organisasjon gir `AccessDeniedError` med `expectTenantIsolation`. Ruten: alltid `Cache-Control: private, no-store`. E2e `request`: 401 uinnlogget, 403 for `?organisasjon=<tilfeldig uuid>`, 400 for ugyldig markør.
- [ ] Velgeren: tre knapper; valget «Egenbygd» overlever omlasting; bytte er sperret når noe venter; bytte sletter ingenting lokalt for noen kandidat.
- [ ] Bytte av organisasjon på samme enhet tømmer også `offline-trial-custom` (samme e2e som for de to andre, utvidet med `custom`).
- [ ] `sync/candidate-boundaries.test.ts` viser at sidene og `sync/photo-uploader.ts` ikke importerer fra `sync/custom/`.
- [ ] Alle e2e- og Vitest-tester for PowerSync og ElectricSQL er grønne uendret.
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

## Åpne spørsmål
- Ingen nye til Ståle. Kandidat 3 har ingen leverandør, ingen lisens utover det vi har og ingen ekstra drift. Nr. 10 (PowerSync) og nr. 11 (ElectricSQL) står fortsatt åpne før ADR-en.
