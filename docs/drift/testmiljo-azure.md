# Testmiljø i Azure

Dette er testmiljøet for EzProp i Azure (Sweden Central, EU), med egen app og egen database. Det skal **bare ha oppdiktede data** til alle punktene under «Minimum før ekte data» i `docs/07-utviklingsplan.md` er krysset av.

Oppsettet er laget ut fra det vi vet om Optiplan (Azure, Sweden Central, Microsoft 365, Better Auth). Optiplans kode var ikke tilgjengelig da dette ble laget, så det er en **antakelse**. Sammenlign gjerne med Optiplans `infra/azure` og `deploy-azure.yml`.

Ingenting rulles ut før secrets er lagt inn. Til da hopper arbeidsflyten «Utrulling til Azure» over utrullingen uten feil.

Stegene under gjør du selv, i denne rekkefølgen.

## a) Ressursgruppe og tilgang for GitHub (én gang)

1. I Azure-portalen: lag ressursgruppen `rg-ezprop-test` i regionen **Sweden Central**.
2. I Microsoft Entra ID → App registrations: lag en ny app-registrering, for eksempel «GitHub EzProp test».
3. I app-registreringen → Certificates & secrets → **Federated credentials** → Add credential (OIDC):
   - Utsteder (issuer): `https://token.actions.githubusercontent.com`
   - Subject, nøyaktig: `repo:Byggcon-sl/EzProp:ref:refs/heads/main`
   - Audience: `api://AzureADTokenExchange`
4. I ressursgruppen `rg-ezprop-test` → Access control (IAM) → Add role assignment: gi app-registreringen rollen **Contributor**. Gjør det **bare på ressursgruppen**, ikke på abonnementet (der ligger Optiplan).

Ingen client secret trengs. GitHub logger inn med federated credential.

## b) Secrets og variabler i GitHub

Gå til repoet i GitHub → Settings → Secrets and variables → Actions.

**Secrets** (fanen Secrets). Bruk nøyaktig disse navnene:

| Navn | Hva du legger inn |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID fra app-registreringen |
| `AZURE_TENANT_ID` | Directory (tenant) ID fra app-registreringen |
| `AZURE_SUBSCRIPTION_ID` | Abonnements-ID der `rg-ezprop-test` ligger |
| `POSTGRES_ADMIN_PASSWORD` | Lag med `openssl rand -hex 24` i Terminal. Bare bokstaver og tall, fordi passordet står i en adresse. |
| `BETTER_AUTH_SECRET` | Lag med `openssl rand -base64 32` i Terminal |

Valgfrie secrets for e-post via Microsoft 365. Sendingen er bygget (fase 0b), men den er bare prøvd mot en falsk Microsoft-tjeneste, ikke mot Byggcons ekte konto. Du kan legge dem inn nå. Legg inn **alle fire sammen**. Legger du inn bare noen av dem, starter ikke appen.

| Navn | Hva du legger inn |
|---|---|
| `MS_GRAPH_TENANT_ID` | Directory (tenant) ID for Byggcons Microsoft 365 |
| `MS_GRAPH_CLIENT_ID` | Application (client) ID fra app-registreringen for e-post |
| `MS_GRAPH_CLIENT_SECRET` | Klienthemmeligheten (client secret) fra samme app-registrering |
| `MAIL_FROM` | Postboksen e-posten sendes fra, for eksempel `noreply@byggcon.no` |

Før du legger dem inn, sjekk dette i Microsoft 365 (samme app-registrering som Optiplan, hvis du bekrefter at den skal brukes):

1. App-registreringen har rettigheten **`Mail.Send`** som **applikasjonsrettighet** (Application permission), og en administrator har gitt samtykke (Grant admin consent).
2. Det finnes en **tilgangspolicy i Exchange Online** som begrenser appen til postboksen i `MAIL_FROM`. Den lages i PowerShell med `New-ApplicationAccessPolicy`. **Uten policyen kan appen sende e-post fra alle postbokser i Byggcon.**
3. Det koster ingenting ekstra. Postboksen og app-registreringen finnes fra før.

Etter at de fire er lagt inn og utrullingen har gått: prøv én innlogging i testmiljøet med en annen adresse enn din egen. Kommer ikke koden, se feilen i serverloggen (Log stream), eller i kolonnen `last_error` i tabellen `integration_connections` hvis en tilkobling er lagt inn der.

**Slik virker e-posten:**

1. På Macen (`DEV_MAILBOX=1`): ingen e-post sendes. Kodene vises på `/dev/epost`.
2. I testmiljøet uten de fire secretene: koden til første admin skrives i serverloggen. Andre får ingen kode.
3. I testmiljøet med de fire secretene: e-posten sendes via Microsoft 365 fra postboksen i `MAIL_FROM`.
4. Senere kan en tilkobling i tabellen `integration_connections` overstyre dette for én organisasjon.

**Variabler** (fanen Variables):

| Navn | Hva du legger inn |
|---|---|
| `SEED_ADMIN_EMAIL` | Din jobbadresse. Blir første admin. |
| `APP_HOSTNAME` | La stå tom til DNS er klar (se punkt f). Forslag: `ezprop-test.byggcon.no`. |
| `ENABLE_KEY_VAULT` | Nøkkelboksen for hemmeligheter (ADR 0005). La stå tom eller `false` til du vil slå den på, se avsnittet «Nøkkelboks for hemmeligheter». |

Databasebrukeren heter `ezprop_admin`. Den settes av oppsettet, og du trenger ikke legge den inn.

## c) Merge og første utrulling

Merge PR-en til `main`. Gå til Actions i GitHub og se at arbeidsflyten «Utrulling til Azure» blir grønn.

Dette skjer, i rekkefølge:

1. Appen bygges.
2. Appen og databasen lages (første gang) eller oppdateres.
3. Databasen migreres.
4. Første admin legges inn (adressen i `SEED_ADMIN_EMAIL`).
5. Appen rulles ut.
6. Helsesjekken sjekkes. Den må svare med riktig commit.

Første kjøring tar lengre tid, fordi databasen lages. Du kan kjøre arbeidsflyten på nytt uten ny merge: Actions → «Utrulling til Azure» → «Run workflow».

## d) Første innlogging

1. Åpne `https://app-ezprop-test.azurewebsites.net/logg-inn`.
2. Skriv adressen fra `SEED_ADMIN_EMAIL`.
3. Hent koden i Azure-portalen: App Service `app-ezprop-test` → **Log stream** (eller `az webapp log tail` i Terminal). Linjen begynner med `[innlogging]`.

Merk: alle som har lesetilgang til ressursgruppen kan lese koden og logge inn som første admin (spørsmål nr. 9). Det er greit så lenge det bare er oppdiktede data. Andre brukere kan ikke logge inn før de fire secretene for Microsoft 365 er lagt inn (se punkt b).

Helsesjekken: `https://app-ezprop-test.azurewebsites.net/api/helse` viser versjon og commit.

Hvis helsesjekken ikke svarer: appen lytter på `HOSTNAME`, og oppsettet setter den til `0.0.0.0`. Sjekk at den står i App Service → Environment variables.

## e) iPad Pro

Åpne adressen i Safari på iPaden. Trykk Del → «Legg til på Hjem-skjerm». Åpne appen fra hjemskjermen. Når den åpner, er oppgaven ferdig.

## f) Egen adresse (når spørsmål nr. 6 er besvart)

1. Hos den som har domenet byggcon.no, legg inn:
   - CNAME `ezprop-test` → `app-ezprop-test.azurewebsites.net`
   - TXT `asuid.ezprop-test` → verifikasjons-id fra Azure (App Service → Custom domains)
2. I Azure-portalen: App Service → Custom domains → Add → velg managed certificate (gratis).
3. Sett variabelen `APP_HOSTNAME` i GitHub (for eksempel `ezprop-test.byggcon.no`), og kjør arbeidsflyten på nytt.

**Merk:** når `APP_HOSTNAME` er satt, virker innlogging bare på den adressen, ikke lenger på `app-ezprop-test.azurewebsites.net`.

## Kostnad

Anslag per måned ved dagens kurs:

- App Service B1: ca. 130–150 kr
- PostgreSQL B1ms med 32 GB: ca. 180–220 kr
- Til sammen: ca. 350–450 kr

Dette er et anslag. Sammenlign med Optiplans faktura.

## Synktjenestene (fjernet)

PowerSync og ElectricSQL er fjernet 10.11.2026 (ADR 0004, egenbygd synk er valgt). Utrullingen lager ingen synktjenester lenger, og variabelen `ENABLE_SYNC_TRIAL` og de fire secrets `POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET` og `ELECTRIC_DB_PASSWORD` brukes ikke. Du kan slette dem i GitHub (Settings → Secrets and variables → Actions). Synktjenestene ble aldri slått på i testmiljøet, så det er ingenting å slette i Azure.

## Nøkkelboks for hemmeligheter

**Hva dette er:** en nøkkelboks (Azure Key Vault) i ressursgruppen. I testmiljøet heter den `kv-ezprop-test` (navnet er alltid `kv-ezprop-<miljø>`). Når den er på, ligger databasepassordet (`DATABASE_URL`), innloggingsnøkkelen (`BETTER_AUTH_SECRET`) og klienthemmeligheten for e-post (`MS_GRAPH_CLIENT_SECRET`) i boksen, ikke i klartekst i appinnstillingene. Appinnstillingene viser da bare en henvisning til boksen. Appen får en egen identitet som bare kan lese fra boksen. Se ADR 0005.

Du legger fortsatt verdiene inn i GitHub-secrets, som før. Utrullingen legger dem i boksen. Du trenger ikke legge dem inn noe annet sted.

**Kostnad:** tilnærmet null. Azure tar betalt per 10 000 oppslag, og appen leser bare når den starter. Med bryteren av: ingenting.

Boksen står **av** til du slår den på. En merge til `main` lager ingenting nytt så lenge den er av.

### Slå på

1. **Sett variabelen** `ENABLE_KEY_VAULT` til `true` (GitHub → Settings → Secrets and variables → Actions → fanen Variables). Nøyaktig `true`, med små bokstaver. Alt annet, også tom, betyr av.
2. **Kjør utrullingen:** Actions → «Utrulling til Azure» → «Run workflow». Eller vent til neste merge til `main`.

### Sjekke

1. **Se etter grønt hakemerke:** i Azure-portalen, åpne App Service (`app-ezprop-test`) → Configuration (Environment variables). `DATABASE_URL`, `BETTER_AUTH_SECRET` og `MS_GRAPH_CLIENT_SECRET` skal ha et grønt hakemerke og teksten «Key vault reference».
2. **Er de røde rett etter første utrulling:** start appen på nytt (knappen «Restart» på App Service). Tilgangen til boksen lages etter appen, og App Service henter verdiene når appen starter. Etter omstart skal hakemerket være grønt.
3. **Logg inn** i testmiljøet og se at det virker.

### Slå av

1. **Sett variabelen** `ENABLE_KEY_VAULT` til noe annet enn `true`, for eksempel `false`.
2. **Kjør utrullingen** på nytt. Verdiene står da som før i klartekst i appinnstillingene.

Utrullingen sletter ikke boksen. Sletter du den selv i portalen, ligger den i myk sletting i 90 dager og sperrer navnet så lenge. Vil du ha den tilbake, bruk «Recover» på den slettede boksen i stedet for å lage en ny. Purge-beskyttelsen kan ikke slås av.

**Merk:** utrullingen eier tilgangslisten på boksen. Tilganger du legger til selv i portalen, forsvinner ved neste utrulling. Du trenger ikke lese verdiene i boksen; de ligger i GitHub.

## Slette miljøet

`az group delete --name rg-ezprop-test`

Alt i gruppen slettes, også databasen. Koden ligger fortsatt i GitHub, så miljøet kan lages på nytt.

## Hva som ikke er med ennå

Alt dette skal på plass før ekte data:

- E-post via Microsoft 365 prøvd mot ekte konto (sendingen er bygget, venter på at de fire secretene legges inn)
- Nøkkelboksen er bygget, av til Ståle slår den på (`ENABLE_KEY_VAULT`, se avsnittet «Nøkkelboks for hemmeligheter»)
- Privat nettverk mellom app og database
- Egen databasebruker for appen
