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
- I nettleseren: den lokale databasen i nettleseren tømmes ved utlogging.

## B. I Azure-testmiljøet (fra PR #7)

**Ingenting rulles ut fra skyen i denne oppgaven.** Her står hva som skal settes opp. Selve oppsettet (Bicep) kommer i en egen liten PR når PR #7 er merget. Ståle eller prosjektlederen kjører den. Ingen konto hos PowerSync Cloud.

### 1. Databasen (Azure Database for PostgreSQL Flexible Server)

1. **Logisk replikering:** sett serverparameteren `wal_level` til `LOGICAL` (Azure-portalen → databasen → Serverparametere). **Krever omstart av databaseserveren.** Gjør det utenom prøvetid.
2. **Egen database for PowerSync:** `powersync_storage`.
3. **Egen rolle for PowerSync** med bare det den trenger: lese de tre trial-tabellene og følge endringene. Passordet lages tilfeldig og legges bare som hemmelighet i Azure, aldri i chat, kode eller repoet.

```sql
-- Kjøres som administrator, i databasen til appen.
CREATE ROLE powersync_repl WITH LOGIN REPLICATION PASSWORD '<tilfeldig passord, settes inn av den som kjører>';
GRANT CONNECT ON DATABASE ezprop TO powersync_repl;
GRANT USAGE ON SCHEMA public TO powersync_repl;
GRANT SELECT ON trial_forms, trial_answers, trial_photos TO powersync_repl;

-- Databasen der PowerSync lagrer sin egen tilstand (eies av rollen, så den kan lage tabeller der).
GRANT powersync_repl TO CURRENT_USER;
CREATE DATABASE powersync_storage OWNER powersync_repl;
```

4. **Publikasjonen** `powersync` finnes allerede; den lages av migreringen `0001_prove-uten-nett`. Den har bare de tre trial-tabellene.
5. **Merk:** PowerSync lager en replikeringsplass (replication slot) i databasen. Står PowerSync stoppet lenge, holder databasen på endringsloggen og bruker mer disk. Skal PowerSync fjernes for godt, må plassen slettes (`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE 'powersync%';`). Det gjøres i samme PR som fjerner tjenesten.

### 2. PowerSync som egen container (Azure Container Apps)

- **Bilde:** `journeyapps/powersync-service:1.27.2` (samme som på Macen), kommando `start -r unified`.
- **Samme to konfigurasjonsfiler** som på Macen, `powersync/config.yaml` og `powersync/sync-rules.yaml`, lagt inn som hemmeligheter og montert som volum på `/config`. Miljøvariabelen `POWERSYNC_CONFIG_PATH=/config/config.yaml`.
- **Innkommende trafikk:** ekstern, bare https, målport `8080`. Containerens adresse blir `https://<navn>.<region>.azurecontainerapps.io`.
- **Antall kopier:** minst 1 og høyst 1 (iPadene holder en åpen kobling; tjenesten skal ikke skaleres ned til 0 under prøvene).
- **Størrelse:** 0,5 vCPU og 1 GiB minne holder for to iPader.
- **Region:** samme som appen (Sweden Central). Data blir i EU/EØS.
- **Miljøvariabler for containeren** (alle unntatt `PS_PG_SSLMODE` som hemmeligheter):

| Variabel | Verdi |
|---|---|
| `PS_DATA_SOURCE_URI` | tilkoblingen til appens database med rollen `powersync_repl` |
| `PS_STORAGE_URI` | tilkoblingen til `powersync_storage` med rollen `powersync_repl` |
| `PS_PG_SSLMODE` | `verify-full` |
| `PS_JWT_SECRET_BASE64` | samme nøkkel som appens `POWERSYNC_JWT_SECRET`, kodet som base64url: `node -e 'console.log(Buffer.from(process.argv[1]).toString("base64url"))' '<nøkkelen>'` |

- PowerSync må nå databasen. Er databasen bare åpen for Azure-tjenester, må containeren få lov på samme måte som appen (avgjøres i Bicep-PR-en).
- Bruksdata til leverandøren er slått av i `config.yaml` (`disable_telemetry_sharing: true`).

### 3. Miljøvariabler i appen (App Service fra PR #7)

| Variabel | Verdi |
|---|---|
| `POWERSYNC_URL` | containerens adresse, f.eks. `https://<navn>.<region>.azurecontainerapps.io` |
| `POWERSYNC_JWT_SECRET` | en ny, tilfeldig nøkkel på minst 32 tegn (`openssl rand -base64 48`), lagt inn som hemmelighet. **Aldri** utviklingsverdien fra `.env.example`; den nektes når adressen ikke er `localhost`. |
| `TRIAL_UPLOAD_DIR` | `/home/data/uploads/trial` (`/home` er varig lagring i App Service) |

### 4. Anslått kostnad per måned

Med forbehold: priser fra Azures prisliste for Container Apps (forbruksplan) slik vi kjenner dem i oktober 2026, uten rabatter, og avhengig av hvor lenge tjenesten står på.

| Del | Anslag |
|---|---|
| PowerSync-containeren (0,5 vCPU, 1 GiB, på hele døgnet, fratrukket gratiskvoten) | ca. 300–450 kr |
| Ekstra lagring og endringslogg i PostgreSQL | under 20 kr |
| **Sum** | **ca. 300–470 kr per måned** |

Stoppes containeren mellom prøvene (0 kopier), koster den nesten ingenting i den tiden. Husk da merknaden om replikeringsplassen over.

### 5. Personvern og sikkerhet

- Den lokale databasen på iPaden (SQLite i nettleseren) er **bare beskyttet av iPadens egen kryptering** (kode på iPaden). Det er godt nok for prøven, der alle data er oppdiktede. Sperring av en mistet enhet kommer i fase 2b.
- Adgangsbeviset har bare bruker-id og organisasjon, og varer én time.
- Synkreglene gir hver iPad bare egen organisasjons rader. Filstien til bildene (`storage_path`) sendes aldri til iPaden.
- Ingen hemmeligheter står i `powersync/config.yaml`; alt leses fra miljøet (`!env`).
