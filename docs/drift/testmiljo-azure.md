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

Valgfri secret for KI. Tom eller mangler betyr KI av. Nøkkelen alene slår ikke på noe: en organisasjon må i tillegg ha tilkoblingen `anthropic` og KI på i innstillingene. Bruk den bare med testdata til databehandleravtalen er på plass (se `docs/beslutningsnotat-ki-leverandor.md`). Bruken koster penger per kall.

| Navn | Hva du legger inn |
|---|---|
| `ANTHROPIC_API_KEY` | API-nøkkelen fra Byggcons konto hos Anthropic (console.anthropic.com → API keys) |

Valgfrie secrets for «Logg inn med Microsoft» (ADR 0008). Legg inn **alle tre sammen**. Mangler én, vises bare innlogging med kode; appen stopper ikke. Oppskriften står i punkt g.

| Navn | Hva du legger inn |
|---|---|
| `MS_LOGIN_TENANT_ID` | Directory (tenant) ID for Byggcons Microsoft-katalog |
| `MS_LOGIN_CLIENT_ID` | Application (client) ID fra app-registreringen for innlogging (ikke den for e-post) |
| `MS_LOGIN_CLIENT_SECRET` | Klienthemmeligheten (Value) fra samme app-registrering |

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

## g) Logg inn med Microsoft 365

Med dette kommer de ansatte inn med Byggcon-kontoen sin (`@byggcon.no`) med ett trykk, uten kode. Koden virker fortsatt som reserve, så ingen stenges ute. Det koster ingenting. Bare personer som allerede er lagt inn som ansatt i EzProp, slipper inn.

1. **Lag en egen app-registrering.** Gå til portal.azure.com → Microsoft Entra ID → App registrations → New registration.
   - Name: for eksempel `EzProp innlogging test`.
   - Supported account types: **Accounts in this organizational directory only** (bare Byggcons katalog, én tenant). Ikke velg «any organizational directory» eller personlige kontoer.
   - Redirect URI: velg **Web** og skriv `https://app-ezprop-test.azurewebsites.net/api/auth/callback/microsoft`.
   - Trykk Register. Bruk ikke app-registreringen for e-post (`MS_GRAPH_*`); den har andre rettigheter.
2. **Skriv ned to verdier** fra Overview: «Application (client) ID» og «Directory (tenant) ID».
3. **Sjekk rettighetene:** API permissions. Bare `openid`, `profile` og `email` (Microsoft Graph, Delegated). Fjern `User.Read` hvis den står der, og legg ikke til andre. Trykk «Grant admin consent for Byggcon», så slipper de ansatte å godkjenne selv.
4. **Lag klienthemmelighet:** Certificates & secrets → New client secret. Velg utløp (høyst 24 måneder). Kopier **Value** med en gang (den vises bare én gang). **Skriv ned utløpsdatoen** i kalenderen. Når hemmeligheten går ut, virker bare innlogging med kode til du lager en ny og legger den inn i GitHub.
5. **Legg inn tre secrets i GitHub** (Settings → Secrets and variables → Actions → Secrets) med nøyaktig disse navnene: `MS_LOGIN_TENANT_ID` (Directory (tenant) ID), `MS_LOGIN_CLIENT_ID` (Application (client) ID) og `MS_LOGIN_CLIENT_SECRET` (Value fra punkt 4). Lim dem bare inn i GitHub, aldri i chat eller e-post.
6. **Kjør utrullingen:** Actions → «Utrulling til Azure» → «Run workflow».
7. **Prøv:** åpne `https://app-ezprop-test.azurewebsites.net/logg-inn`. Trykk «Logg inn med Microsoft» og logg inn med Byggcon-kontoen din. Du skal komme rett inn. Prøv også «Logg inn med kode i stedet», så du vet at reserven virker.

Får du «Du har ikke tilgang med denne kontoen»: sjekk at personen er lagt inn som ansatt i EzProp med samme e-postadresse som i Microsoft. Vises ikke knappen: sjekk at alle tre secrets er lagt inn, og se etter en advarsel i serverloggen (Log stream).

**Merk:** setter du `APP_HOSTNAME` (punkt f), må tilbakeadressen i app-registreringen endres til `https://<adressen>/api/auth/callback/microsoft`.

## Hvis Azure mangler kapasitet («No available instances»)

Utrullingen kan stoppe med `Conflict` og «No available instances to satisfy this request» på `plan-ezprop-test`. Det betyr at Microsoft er tom for ledige maskiner for appen i den delen av datasenteret ressursgruppen ligger i. Det er ikke en feil i oppsettet. Prøv først igjen senere. Hjelper ikke det, flytt til en ny ressursgruppe:

1. Slett den gamle gruppen `rg-ezprop-test` i portalen (Resource groups → rg-ezprop-test → Delete resource group). Da frigjøres navnet på databasen, som må være unikt i hele Azure.
2. Lag en ny gruppe i Sweden Central med et nytt navn, for eksempel `rg-ezprop-test2`. Bruk et nytt navn, ikke det gamle.
3. Gi `GitHub EzProp test` rollen Contributor på den nye gruppen (som i punkt a4).
4. I GitHub: lag variabelen `AZURE_RESOURCE_GROUP` med det nye navnet (Settings → Secrets and variables → Actions → Variables).
5. Kjør «Utrulling til Azure» på nytt.

Adressen blir den samme: `https://app-ezprop-test.azurewebsites.net`.

## Hvis databasen ikke kan lages («SkuNotAvailable»)

Utrullingen kan stoppe med `SkuNotAvailable` på `psql-ezprop-test`: «Specified SKU is not supported in this region». Da tilbyr ikke Azure den minste databasestørrelsen (`Standard_B1ms`) i Sweden Central for dette abonnementet. Velg én av disse med GitHub-variabler (Settings → Secrets and variables → Actions → Variables):

- `POSTGRES_LOCATION` = `norwayeast`: samme størrelse og pris, men databasen ligger i Norge. Appen blir i Sweden Central. Litt lengre vei mellom app og database, men det merkes ikke i testmiljøet.
- `POSTGRES_SKU` = `Standard_B2s`: større database i Sweden Central. Koster ca. 400–500 kr mer i måneden.

Slett først databasen som feilet: ressursgruppen → `psql-ezprop-test` → Delete. Kjør så «Utrulling til Azure» på nytt. Lovlige regioner for databasen er `swedencentral`, `norwayeast`, `northeurope` og `westeurope` (alle i EU/EØS).

## Kostnad

Anslag per måned ved dagens kurs:

- App Service B1: ca. 130–150 kr
- PostgreSQL B1ms med 32 GB: ca. 180–220 kr
- Til sammen: ca. 350–450 kr

Dette er et anslag. Sammenlign med Optiplans faktura.

## Synktjenestene (fjernet)

PowerSync og ElectricSQL er fjernet 10.11.2026 (ADR 0004, egenbygd synk er valgt). Utrullingen lager ingen synktjenester lenger, og variabelen `ENABLE_SYNC_TRIAL` og de fire secrets `POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET` og `ELECTRIC_DB_PASSWORD` brukes ikke. Du kan slette dem i GitHub (Settings → Secrets and variables → Actions). Synktjenestene ble aldri slått på i testmiljøet, så det er ingenting å slette i Azure.

## Nøkkelboks for hemmeligheter

**Hva dette er:** en nøkkelboks (Azure Key Vault) i ressursgruppen. I testmiljøet heter den `kv-ezprop-test` (navnet er alltid `kv-ezprop-<miljø>`). Når den er på, ligger databasepassordet (`DATABASE_URL`), innloggingsnøkkelen (`BETTER_AUTH_SECRET`), klienthemmeligheten for e-post (`MS_GRAPH_CLIENT_SECRET`), klienthemmeligheten for Microsoft-innloggingen (`MS_LOGIN_CLIENT_SECRET`, når den er lagt inn) og nøkkelen til KI-leverandøren (`ANTHROPIC_API_KEY`, når den er lagt inn) i boksen, ikke i klartekst i appinnstillingene. Appinnstillingene viser da bare en henvisning til boksen. Appen får en egen identitet som bare kan lese fra boksen. Se ADR 0005.

Du legger fortsatt verdiene inn i GitHub-secrets, som før. Utrullingen legger dem i boksen. Du trenger ikke legge dem inn noe annet sted.

**Kostnad:** tilnærmet null. Azure tar betalt per 10 000 oppslag, og appen leser bare når den starter. Med bryteren av: ingenting.

Boksen står **av** til du slår den på. En merge til `main` lager ingenting nytt så lenge den er av.

### Slå på

1. **Sett variabelen** `ENABLE_KEY_VAULT` til `true` (GitHub → Settings → Secrets and variables → Actions → fanen Variables). Nøyaktig `true`, med små bokstaver. Alt annet, også tom, betyr av.
2. **Kjør utrullingen:** Actions → «Utrulling til Azure» → «Run workflow». Eller vent til neste merge til `main`.

### Sjekke

1. **Se etter grønt hakemerke:** i Azure-portalen, åpne App Service (`app-ezprop-test`) → Configuration (Environment variables). `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MS_GRAPH_CLIENT_SECRET`, `MS_LOGIN_CLIENT_SECRET` og `ANTHROPIC_API_KEY` (de tre siste når de er lagt inn) skal ha et grønt hakemerke og teksten «Key vault reference».
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
- Logg inn med Microsoft 365 prøvd mot ekte konto (bygget, venter på at de tre secretene `MS_LOGIN_*` legges inn, se punkt g)
- Nøkkelboksen er bygget, av til Ståle slår den på (`ENABLE_KEY_VAULT`, se avsnittet «Nøkkelboks for hemmeligheter»)
- Privat nettverk mellom app og database
- Egen databasebruker for appen
