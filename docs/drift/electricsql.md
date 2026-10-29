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

## B. I Azure-testmiljøet (fra PR #7)

**Ingenting rulles ut i denne oppgaven, og ingen Azure-kall er gjort.** Her står hva som skal settes opp. Selve oppsettet (Bicep) kommer i en egen liten PR, og Ståle eller prosjektlederen kjører den. Ingen konto hos Electric Cloud.

### 1. Databasen (Azure Database for PostgreSQL Flexible Server)

1. **Logisk replikering:** `wal_level` = `LOGICAL`, samme innstilling som for PowerSync (krever omstart av databaseserveren; gjøres én gang for begge).
2. **Egen rolle for Electric** med bare det den trenger: lese de tre trial-tabellene og følge endringene. **Aldri superbruker**, og **aldri** lesetilgang til `user`, `session`, `verification`, ansatte eller andre tabeller. Passordet lages tilfeldig og legges bare som hemmelighet i Azure, aldri i chat, kode eller repoet.

```sql
-- Kjøres som administrator, i databasen til appen.
CREATE ROLE electric_repl WITH LOGIN REPLICATION PASSWORD '<tilfeldig passord, settes inn av den som kjører>';
GRANT CONNECT ON DATABASE ezprop TO electric_repl;
GRANT USAGE ON SCHEMA public TO electric_repl;
GRANT SELECT ON trial_forms, trial_answers, trial_photos TO electric_repl;
```

3. **Publikasjonen** `electric_publication_default` og `REPLICA IDENTITY FULL` på de tre tabellene finnes allerede; de lages av migrering `0002`. Derfor trenger rollen verken å eie tabellene eller å endre publikasjonen. Electric settes til å bruke den ferdige publikasjonen (`ELECTRIC_MANUAL_TABLE_PUBLISHING=true`).
4. **Forbehold (åpent funn):** godtar ikke Electric-versjonen en ferdiglaget publikasjon, må rollen **eie** de tre tabellene, slik at Electric kan endre publikasjonen og replikaidentiteten selv. Det gir rollen mer makt enn vi vil, og må i så fall avgjøres av Ståle. Dette står åpent til Ståle har kjørt Electric på Macen og sett at den starter og leverer shapes uten feil om publikasjonen (se `docker compose logs electric`). Merk at Mac-prøven ikke viser om rettighetene holder, fordi databasebrukeren på Macen er superbruker; det må prøves i Azure med rollen over.
5. **Replikeringsplass:** Electric lager en replikeringsplass (`electric_slot_default`) i databasen. Står Electric stoppet lenge, holder databasen på endringsloggen og bruker mer disk. Skal Electric fjernes for godt, slettes plassen i samme PR som fjerner tjenesten:

```sql
SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE 'electric_slot%';
```

### 2. Electric som egen container (Azure Container Apps)

- **Bilde:** `electricsql/electric:1.8.1` (samme som på Macen).
- **Innkommende trafikk:** **intern**, målport `3000`. Electric skal **aldri** være åpen mot internett; bare appen skal nå den. Det betyr at appen (App Service) må kunne nå Container Apps-miljøet over et privat nett (VNet-integrasjon), eller at appen flyttes inn i samme miljø. Hvilken vei, avgjøres i Bicep-PR-en.
- **Antall kopier:** minst 1 og høyst 1 (Electric har én replikeringsplass og skal ikke skaleres til flere kopier).
- **Størrelse:** 0,5 vCPU og 1 GiB minne holder for to iPader.
- **Region:** samme som appen (Sweden Central). Data blir i EU/EØS.
- **Varig lagring:** en Azure Files-deling montert på mappen i `ELECTRIC_STORAGE_DIR` (f.eks. `/app/persistent`). Her lagrer Electric loggen over shapes. Det er **mellomlagring**: den kan slettes uten tap, fordi databasen er fasit (og det er i databasen de 10 årene gjelder). Uten varig lagring virker Electric også, men hver omstart gjør at alle iPadene henter alt på nytt.
- **Miljøvariabler for containeren:**

| Variabel | Verdi |
|---|---|
| `DATABASE_URL` | tilkoblingen til appens database med rollen `electric_repl`, med `sslmode=verify-full` (hemmelighet) |
| `ELECTRIC_SECRET` | samme verdi som appens `ELECTRIC_SECRET` (hemmelighet) |
| `ELECTRIC_USAGE_REPORTING` | `false` |
| `ELECTRIC_STORAGE_DIR` | mappen der Azure Files-delingen er montert, f.eks. `/app/persistent` |
| `ELECTRIC_MANUAL_TABLE_PUBLISHING` | `true` (bruk publikasjonen fra migrering `0002`) |

- Electric må nå databasen. Er databasen bare åpen for Azure-tjenester eller et privat nett, må containeren få lov på samme måte som appen (avgjøres i Bicep-PR-en).

### 3. Miljøvariabler i appen (App Service fra PR #7)

| Variabel | Verdi |
|---|---|
| `ELECTRIC_URL` | containerens **interne** adresse, f.eks. `http://<navn>.internal.<miljø>.<region>.azurecontainerapps.io` |
| `ELECTRIC_SECRET` | en ny, tilfeldig nøkkel på minst 32 tegn (`openssl rand -base64 48`), lagt inn som hemmelighet. **Aldri** utviklingsverdien fra `.env.example`; den nektes når adressen ikke er `localhost`. |

- Ingen av dem får forstavelsen `NEXT_PUBLIC_`; nøkkelen skal aldri til nettleseren.
- Nøkkelen sendes i adressen fra appen til Electric. Trafikken mellom appen og Electric skal derfor bare gå på privat nett (VNet), og ingen proxy mellom dem skal logge hele adressen (tilgangslogg med spørrestreng slås ikke på).
- `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS` settes **aldri** i Azure. Den er bare for de automatiske testene.
- **Lang-polling:** når iPaden er à jour, venter proxyen opptil ca. 20 sekunder på nye endringer fra Electric før den svarer (appen gir opp etter 30 sekunder). App Service tåler dette; tidsgrensen der er mye lengre (ca. 230 sekunder).

### 4. Anslått kostnad per måned

Med forbehold: priser fra Azures prisliste for Container Apps (forbruksplan) og Azure Files slik vi kjenner dem i oktober 2026, uten rabatter, og avhengig av hvor lenge tjenesten står på. Kostnaden for privat nett (VNet) mellom appen og containeren er ikke tatt med, fordi måten ikke er valgt ennå.

| Del | Anslag |
|---|---|
| Electric-containeren (0,5 vCPU, 1 GiB, på hele døgnet, fratrukket gratiskvoten) | ca. 300–450 kr |
| Azure Files for Electrics lagring (noen få GiB) | under 20 kr |
| Ekstra endringslogg i PostgreSQL (`REPLICA IDENTITY FULL`, egen replikeringsplass) | under 20 kr |
| **Sum** | **ca. 300–490 kr per måned** |

Kjører både PowerSync og Electric samtidig under prøvene, kommer kostnaden for PowerSync i tillegg (se `docs/drift/powersync.md`). Stoppes containeren mellom prøvene (0 kopier), koster den nesten ingenting i den tiden. Husk da merknaden om replikeringsplassen over.

### 5. Personvern og sikkerhet

- Det lokale lageret på iPaden (IndexedDB i nettleseren) er **bare beskyttet av iPadens egen kryptering** (kode på iPaden), som for PowerSync. Det er godt nok for prøven, der alle data er oppdiktede. Sperring av en mistet enhet kommer i fase 2b.
- Hver iPad får bare egen organisasjons rader. Organisasjonen i filteret kommer alltid fra tilgangssjekken i appen, aldri fra iPaden.
- Svarene fra proxyen merkes `Cache-Control: private, no-store`, så ingen mellomlager tar vare på dem.
- Electrics shape-logg på disk ligger i Sweden Central (Azure Files), og kan slettes uten tap.
- Appen logger bare rute, bruker-id, tabell og status for shape-kallene, aldri spørrestrengen (den har hemmeligheten) og aldri radene.
