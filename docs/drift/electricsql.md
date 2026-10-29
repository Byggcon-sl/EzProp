# Synktjenesten ElectricSQL (prøve fase 1, kandidat 2)

- **Gjelder:** oppgave 5 i fase 1, andre kandidat for drift uten nett (`docs/funksjoner/fase1-kandidat-electricsql.md`).
- **Dato:** 28.10.2026
- **Støtter hovedmål:** tid (befaring uten nett på iPad er den største tidsbesparelsen mot IVIT) og reklamasjoner (svar og bilder bekreftes av serveren før iPaden gir slipp på dem, og hver iPad får bare sin egen organisasjons data).

ElectricSQL («Electric») er den andre kandidaten vi prøver for synk mellom iPaden og PostgreSQL. Vi bruker den **selvdrevne, gratis utgaven** i Docker: bildet `electricsql/electric:1.8.1` (fast versjon, aldri `latest`). Lisensen er Apache-2.0. **Ingen konto hos Electric Cloud eller andre leverandører.** Om vi skal bruke Electric videre avgjøres i ADR-en etter prøvene (spørsmål nr. 10 i `docs/09-apne-sporsmal.md`).

Alt her er en prøve og kan kastes når ADR-en er skrevet.

## Hvordan det henger sammen

1. Electric **leser bare**. Den følger med på endringene i de tre tabellene `trial_forms`, `trial_answers` og `trial_photos` og deler dem ut som «shapes» (et utsnitt av en tabell).
2. iPaden snakker **aldri** med Electric direkte. Den spør appen: `GET /api/prove/synk/shape?organisasjon=<id>&tabell=<tabell>`. Appen sjekker tilgangen og bestemmer selv tabellen, filteret (egen organisasjon, ikke slettet), kolonnene og hemmeligheten. Fra iPaden tas bare posisjonen i strømmen med (`offset`, `handle`, `live`, `cursor`). Alt annet iPaden sender, overses.
3. Endringer fra iPaden går til appen som for PowerSync: `POST /api/prove/synk/endringer`. Appen sjekker tilgang og skriver til PostgreSQL. Electric ser endringen i databasen og sender den videre til de andre iPadene.
4. Bildefiler sendes rett til appen: `PUT /api/prove/bilder/<id>`, som før.
5. Synktokenet fra PowerSync (`/api/prove/synk/token`) brukes **ikke** av Electric. Innloggingen i appen er nok, fordi alt går gjennom appen.

Electric leser bare fra publikasjonen `electric_publication_default` (laget av migrering `0002`), med de tre trial-tabellene. Brukere, innlogging og engangskoder går aldri til tjenesten. Filstien til bildene (`storage_path`) og hvem som har endret (`created_by`, `updated_by`, `deleted_by`) sendes aldri til iPaden.

Electric og PowerSync kjører **side om side** på samme database. Hver har sin egen publikasjon (`electric_publication_default` og `powersync`) og sin egen replikeringsplass, så de forstyrrer ikke hverandre. Takstmannen velger kandidat på listen over testskjemaer.

## A. På Macen

### Hva `./start.sh` gjør

- Starter databasen i Docker med logisk replikering slått på (`wal_level=logical`), som for PowerSync.
- Legger inn `ELECTRIC_URL` og `ELECTRIC_SECRET` i `.env` hvis de mangler. Verdiene er utviklingsverdier fra `.env.example`. De er ikke hemmelige og virker bare når appen kjører på `localhost`.
- Oppdaterer databasen (migrering `0002` setter `REPLICA IDENTITY FULL` på de tre tabellene og lager publikasjonen).
- Starter Electric (steget «Starter synktjenesten (ElectricSQL)», etter PowerSync) og venter i opptil 60 sekunder på at den svarer. Nøkkelen fra `.env` gis videre til Electric av skriptet. Du trenger ikke gjøre noe selv.
- Skriver «ElectricSQL: http://localhost:3010» i oppsummeringen.

Electric bruker port **3010** på Macen (Electrics egen port 3000 er opptatt av appen). Den er bare tilgjengelig fra Macen selv (`127.0.0.1`). iPadene når den ikke over wifi, og skal heller ikke: de går alltid via appen. Prøve A og B kjøres derfor mot testmiljøet i Azure (del B).

Bruksdata til leverandøren er slått av (`ELECTRIC_USAGE_REPORTING=false` i `docker-compose.yml`).

### Slik ser du at Electric kjører

- Skriv `curl http://127.0.0.1:3010/v1/health` i Terminal. Svaret skal være `{"status":"active"}`. Får du «Connection refused», kjører ikke tjenesten. Står det `"starting"` eller `"waiting"`, vent litt og prøv igjen.
- Eller skriv `docker compose ps` i Terminal i EzProp-mappen. Linjen `electric` skal stå som «running» (eller «Up»).
- Ser noe galt ut: `docker compose logs electric` viser hva tjenesten sier. Kopier de siste linjene til Claude.

Appen virker også uten Electric: svarene lagres da på enheten og sendes til serveren som vanlig (skrivingen går ikke via Electric). Det som stopper, er at endringer fra andre iPader ikke kommer inn. Proxyen svarer da 502 («Synktjenesten svarer ikke»), og iPaden prøver igjen etter 5 sekunder, så sjeldnere opp til hvert minutt.

### Nullstille

- **Bare starte Electric på nytt:** `docker compose restart electric`.
- **Slette alle lokale testdata, også Electrics lagring:** `./start.sh --nullstill`. Da slettes hele databasen og Electrics lagring i Docker, og alt lages på nytt.
- **Electrics lagring kan slettes uten tap.** Den er bare mellomlagring (en logg over shapes). Databasen er fasit. Slettes lagringen, får iPaden beskjed om å hente alt på nytt (409 «must-refetch»), og endringer som ikke er sendt ennå blir liggende i køen på iPaden til de er lagret.
- I nettleseren: Electric-lageret på iPaden (`offline-trial-electric`) tømmes neste gang en annen organisasjon logger inn på samme enhet. For å tømme for hånd: Safari → Innstillinger → Safari → Avansert → Nettsteddata → slett for testmiljøet.

## B. I Azure-testmiljøet

Electric er bygget inn i oppsettet for testmiljøet (`infra/azure/main.bicep`), men står **av** til Ståle slår den på. **Hvordan du slår på, sjekker og slår av, og hva det koster, står ett sted: `docs/drift/testmiljo-azure.md`**, avsnittet «Synktjenestene for prøve A og B». Ingen konto hos Electric Cloud.

Her står bare hva som lages når bryteren `ENABLE_SYNC_TRIAL` er `true`.

### 1. Databasen

- **Logisk replikering:** `wal_level` = `logical`, samme innstilling som for PowerSync. Utrullingen starter databasen på nytt én gang hvis Azure sier at det trengs.
- **Egen databasebruker** `electric_repl`, laget av skriptet `scripts/azure/sync-trial-roles.ts` ved hver utrulling. Den kan bare lese de tre trial-tabellene og følge endringene. **Aldri superbruker**, og **aldri** lesetilgang til brukere, innlogging, ansatte eller andre tabeller. Skriptet sjekker dette til slutt og stopper hvis rollen kan lese noe annet. Passordet er secreten `ELECTRIC_DB_PASSWORD` og står aldri i repoet.
- **Publikasjonen** `electric_publication_default` og `REPLICA IDENTITY FULL` på de tre tabellene lages av migrering `0002`. Electric bruker den ferdige publikasjonen (`ELECTRIC_MANUAL_TABLE_PUBLISHING=true`), så rollen trenger verken å eie tabellene eller endre publikasjonen.
- **Forbehold (åpent funn):** godtar ikke Electric-versjonen en ferdiglaget publikasjon, må rollen **eie** de tre tabellene. Det gir rollen mer makt enn vi vil, og må i så fall avgjøres av Ståle. Mac-prøven viser ikke dette, fordi databasebrukeren på Macen er superbruker. Det ses først når tjenesten er slått på i Azure (Log stream på containeren).
- **Replikeringsplass:** Electric lager en replikeringsplass (`electric_slot_default`). Når bryteren slås av og utrullingen kjøres, rydder skriptet bort plasser som ikke er i bruk. Se «Slå av» i `docs/drift/testmiljo-azure.md` for hvorfor det er viktig.

### 2. Containeren (Azure Container Apps)

- **Bilde:** `electricsql/electric:1.8.1` (samme som på Macen).
- **Innkommende trafikk:** bare https, mot port `3000`, og **bare fra appens utgående adresser** (IP-sperre). Alle andre får 403. iPaden snakker aldri med Electric direkte; den går alltid via appen.
- **Forbehold om IP-sperren:** adressene App Service bruker ut mot internett, deles med andre Azure-kunder i samme region. IP-sperren er derfor bare et ekstra lag. **Den egentlige beskyttelsen er `ELECTRIC_SECRET`:** Electric svarer ikke uten riktig nøkkel, og `ELECTRIC_INSECURE` settes aldri.
- **Én kopi** (Electric har én replikeringsplass og skal ikke skaleres), 0,5 vCPU og 1 GiB minne, i Sweden Central (EU).
- **Lagring:** Electrics logg over shapes ligger i containeren og er bare mellomlagring. Databasen er fasit. Ved omstart henter iPadene alt på nytt (409 «must-refetch»), uten at noe går tapt.
- **Hemmeligheter** (tilkoblingen til databasen og `ELECTRIC_SECRET`) ligger som hemmeligheter i Container Apps, ikke som vanlige verdier. Tilkoblingen bruker `sslmode=verify-full`, og containeren når databasen gjennom den samme brannmurregelen for Azure-tjenester som appen (ADR 0002).
- Bruksdata til leverandøren er slått av (`ELECTRIC_USAGE_REPORTING=false`).

### 3. Appen

| Variabel | Verdi |
|---|---|
| `ELECTRIC_URL` | adressen til containeren (https). Brukes bare på serveren. |
| `ELECTRIC_SECRET` | fra secreten med samme navn |

- Begge settes bare når bryteren er på, og fjernes ved neste utrulling når den slås av.
- Ingen av dem får forstavelsen `NEXT_PUBLIC_`; nøkkelen skal aldri til nettleseren.
- Nøkkelen sendes i adressen fra appen til Electric. Trafikken går kryptert med https, og loggene i containeren lagres ikke.
- `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS` settes **aldri** i Azure. Den er bare for de automatiske testene.
- **Lang-polling:** når iPaden er à jour, venter proxyen opptil ca. 20 sekunder på nye endringer fra Electric før den svarer (appen gir opp etter 30 sekunder). App Service tåler dette; tidsgrensen der er mye lengre (ca. 230 sekunder).

### 4. Personvern og sikkerhet

- Bare oppdiktede data i testmiljøet (se `docs/drift/testmiljo-azure.md`).
- Det lokale lageret på iPaden (IndexedDB i nettleseren) er **bare beskyttet av iPadens egen kryptering** (kode på iPaden), som for PowerSync. Det er godt nok for prøven. Sperring av en mistet enhet kommer i fase 2b.
- Hver iPad får bare egen organisasjons rader. Organisasjonen i filteret kommer alltid fra tilgangssjekken i appen, aldri fra iPaden.
- Svarene fra proxyen merkes `Cache-Control: private, no-store`, så ingen mellomlager tar vare på dem.
- Appen logger bare rute, bruker-id, tabell og status for shape-kallene, aldri spørrestrengen (den har hemmeligheten) og aldri radene.
