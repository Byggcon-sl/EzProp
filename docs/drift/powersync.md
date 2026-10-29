# Synktjenesten PowerSync (prøve fase 1)

- **Gjelder:** oppgave 4 i fase 1, første kandidat for drift uten nett (`docs/funksjoner/fase1-kandidat-powersync.md`).
- **Dato:** 28.10.2026
- **Støtter hovedmål:** tid (befaring uten nett på iPad er den største tidsbesparelsen mot IVIT) og reklamasjoner (svar og bilder bekreftes av serveren før iPaden gir slipp på dem).

PowerSync er tjenesten som holder den lokale databasen på iPaden i takt med PostgreSQL. Vi bruker den **selvdrevne, gratis utgaven** i Docker: bildet `journeyapps/powersync-service:1.27.2` (fast versjon, aldri `latest`). **Ingen konto hos PowerSync Cloud eller andre leverandører.** Om vi skal bruke PowerSync videre, og i så fall selvdrevet eller som skytjeneste, avgjøres i ADR-en etter prøvene (spørsmål nr. 10 i `docs/09-apne-sporsmal.md`).

Alt her er en prøve og kan kastes når ADR-en er skrevet.

## Hvordan det henger sammen

1. iPaden henter et kortvarig adgangsbevis (JWT, gyldig én time) fra appen: `GET /api/prove/synk/token`. Beviset har bare bruker-id og organisasjon, aldri navn eller e-post.
2. iPaden kobler seg til PowerSync med beviset og får bare radene til sin egen organisasjon (synkreglene i `powersync/sync-rules.yaml`).
3. Endringer fra iPaden går **ikke** gjennom PowerSync, men til appen: `POST /api/prove/synk/endringer`. Appen sjekker tilgang og skriver til PostgreSQL. PowerSync leser endringen fra databasen og sender den videre til de andre iPadene.
4. Bildefiler sendes rett til appen: `PUT /api/prove/bilder/<id>`. iPaden sletter sin kopi først når serveren har svart med samme fingeravtrykk (SHA-256).

PowerSync leser bare de tre tabellene `trial_forms`, `trial_answers` og `trial_photos` (publikasjonen `powersync`, laget av migreringen). Brukere, innlogging og engangskoder går aldri til tjenesten.

## A. På Macen

### Hva `./start.sh` gjør

- Starter databasen i Docker med logisk replikering slått på (`wal_level=logical`). Dette trengs for at PowerSync kan følge med på endringer.
- Lager databasen `powersync_storage` hvis den mangler. Der lagrer PowerSync sin egen tilstand.
- Legger inn `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET` og `TRIAL_UPLOAD_DIR` i `.env` hvis de mangler. Verdiene er utviklingsverdier fra `.env.example`. De er ikke hemmelige og virker bare når appen kjører på `localhost`.
- Oppdaterer databasen (migreringene lager tabellene og publikasjonen).
- Starter PowerSync (steget «Starter synktjenesten») og venter i opptil 60 sekunder på at den svarer. Nøkkelen fra `.env` kodes om til formatet PowerSync vil ha (base64url) av en linje i skriptet. Du trenger ikke gjøre noe selv.
- Skriver «PowerSync: http://localhost:8080» i oppsummeringen.

PowerSync er bare tilgjengelig fra Macen selv (`127.0.0.1`). iPadene når den ikke over wifi. Prøve A og B kjøres derfor mot testmiljøet i Azure (del B).

### Slik ser du at PowerSync kjører

- Åpne **http://localhost:8080/probes/liveness** i nettleseren på Macen. Du skal få et kort svar (JSON), ikke en feilside. Får du «kan ikke koble til», kjører ikke tjenesten.
- Eller skriv `docker compose ps` i Terminal i EzProp-mappen. Linjen `powersync` skal stå som «running» (eller «Up»).
- Ser noe galt ut: `docker compose logs powersync` viser hva tjenesten sier. Kopier de siste linjene til Claude.

Appen virker også uten PowerSync: svarene lagres da bare på enheten og venter («Venter: N endringer») til tjenesten svarer.

### Nullstille

- **Bare starte PowerSync på nytt:** `docker compose restart powersync`.
- **Slette alle lokale testdata, også PowerSyncs tilstand:** `./start.sh --nullstill`. Da slettes hele databasen i Docker, og alt lages på nytt.
- I nettleseren: den lokale databasen tømmes **ikke** ved utlogging ennå (kjent svakhet, se resultatfilen). Den tømmes neste gang en annen organisasjon logger inn på samme enhet. For å tømme for hånd: Safari → Innstillinger → Safari → Avansert → Nettsteddata → slett for testmiljøet, eller fjern appen fra hjemskjermen og legg den til igjen.

## B. I Azure-testmiljøet

PowerSync er bygget inn i oppsettet for testmiljøet (`infra/azure/main.bicep`), men står **av** til Ståle slår den på. **Hvordan du slår på, sjekker og slår av, og hva det koster, står ett sted: `docs/drift/testmiljo-azure.md`**, avsnittet «Synktjenestene for prøve A og B». Ingen konto hos PowerSync Cloud.

Her står bare hva som lages når bryteren `ENABLE_SYNC_TRIAL` er `true`.

### 1. Databasen

- **Logisk replikering:** `wal_level` settes til `logical` av oppsettet. Utrullingen starter databasen på nytt én gang hvis Azure sier at det trengs. Innstillingen settes ikke tilbake når bryteren slås av; det er ufarlig.
- **Egen databasebruker** `powersync_repl`, laget av skriptet `scripts/azure/sync-trial-roles.ts` ved hver utrulling. Den har lesetilgang (SELECT) bare til de tre trial-tabellene. REPLICATION-egenskapen, som tjenesten trenger for å følge endringene, gir likevel mulighet til å lese hele databasen via replikeringsprotokollen, uavhengig av lesetilgangen. Skriptets sjekk til slutt dekker lesetilgangen, ikke dette. Det er akseptert for testmiljøet, der det bare finnes oppdiktede data. For produksjon avgjøres det i synk-ADR-en. Aldri superbruker. Passordet er secreten `POWERSYNC_DB_PASSWORD` og står aldri i repoet.
- **Egen database** `powersync_storage` der PowerSync lagrer sin egen tilstand. Den eies av `powersync_repl`, og Electrics bruker kan ikke koble til den.
- **Publikasjonen** `powersync` lages av migreringen `0001_prove-uten-nett`, som før.
- **Replikeringsplass:** PowerSync lager en replikeringsplass i databasen. Når bryteren slås av og utrullingen kjøres, rydder skriptet bort plasser som ikke er i bruk. Se «Slå av» i `docs/drift/testmiljo-azure.md` for hvorfor det er viktig.

### 2. Containeren (Azure Container Apps)

- **Bilde:** `journeyapps/powersync-service:1.27.2` (samme som på Macen), kommando `start -r unified`.
- **Konfigurasjon:** de samme to filene som på Macen, `powersync/config.yaml` og `powersync/sync-rules.yaml`, lastes fra repoet og monteres på `/config`.
- **Innkommende trafikk:** fra internett, bare https, mot port `8080`. iPadene kobler seg til denne adressen med adgangsbeviset fra appen.
- **Én kopi**, 0,5 vCPU og 1 GiB minne, i Sweden Central (EU).
- **Hemmeligheter** (tilkoblingene til databasen og nøkkelen) ligger som hemmeligheter i Container Apps, ikke som vanlige verdier. Nøkkelen kodes om til formatet PowerSync vil ha (base64url) av oppsettet.
- Tilkoblingene til databasen bruker `sslmode=verify-full`. Containeren når databasen gjennom den samme brannmurregelen for Azure-tjenester som appen (ADR 0002).
- Ingen logger lagres. Bruksdata til leverandøren er slått av i `config.yaml` (`disable_telemetry_sharing: true`).

### 3. Appen

Når bryteren er på, får appen `POWERSYNC_URL` (adressen til containeren) og `POWERSYNC_JWT_SECRET` (fra secreten med samme navn). `TRIAL_UPLOAD_DIR` er alltid `/home/data/uploads/trial`. Når bryteren slås av, fjernes de to første ved neste utrulling.

### 4. Personvern og sikkerhet

- Bare oppdiktede data i testmiljøet (se `docs/drift/testmiljo-azure.md`).
- Den lokale databasen på iPaden (SQLite i nettleseren) er **bare beskyttet av iPadens egen kryptering** (kode på iPaden). Det er godt nok for prøven. Sperring av en mistet enhet kommer i fase 2b.
- Adgangsbeviset har bare bruker-id og organisasjon, og varer én time.
- Synkreglene gir hver iPad bare egen organisasjons rader. Filstien til bildene (`storage_path`) sendes aldri til iPaden.
- Ingen hemmeligheter står i `powersync/config.yaml`; alt leses fra miljøet (`!env`).
