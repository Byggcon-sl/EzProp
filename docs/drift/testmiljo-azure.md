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

Valgfrie secrets. **Ikke legg dem inn ennå.** Sendingen via Microsoft 365 bygges først i fase 0b (etter at du har svart på spørsmål nr. 6). Legger du inn de fire før det, prøver appen å sende e-post via Microsoft 365, får feil, og ingen kan logge inn, heller ikke du. Når den tid kommer: legg inn **alle fire sammen**.

- `MS_GRAPH_TENANT_ID`
- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_CLIENT_SECRET`
- `MAIL_FROM`

**Variabler** (fanen Variables):

| Navn | Hva du legger inn |
|---|---|
| `SEED_ADMIN_EMAIL` | Din jobbadresse. Blir første admin. |
| `APP_HOSTNAME` | La stå tom til DNS er klar (se punkt f). Forslag: `ezprop-test.byggcon.no`. |

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

Merk: alle som har lesetilgang til ressursgruppen kan lese koden og logge inn som første admin (spørsmål nr. 9). Det er greit så lenge det bare er oppdiktede data. Andre brukere kan ikke logge inn før Microsoft 365 er koblet til.

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

## Synktjenestene for prøve A og B

**Kostnad:** ca. 700–850 kr per måned når synktjenestene er på, i tillegg til dagens testmiljø. Når de er av, koster de 0 kr.

Anslaget bygger på Azures prisliste for Container Apps (forbruksplan, oktober 2026, uten rabatter). Hver container har 0,5 vCPU og 1 GiB minne og står på hele døgnet. Gratiskvoten gjelder per abonnement, så den trekkes fra bare én gang:

- PowerSync-containeren: ca. 350 kr per måned (gratiskvoten trukket fra)
- Electric-containeren: ca. 400 kr per måned
- Ekstra endringslogg i databasen: noen få kroner

Det er ingen kostnad for privat nett, fillagring eller logglagring, fordi ingen av delene brukes. Står tjenestene på bare noen dager, blir det tilsvarende mindre. Se også spørsmål nr. 12 i `docs/09-apne-sporsmal.md`.

**Hva dette er:** prøve A og B skal kjøres på ekte iPad for alle tre kandidatene. Kandidat 3 (egenbygd) går bare gjennom appen og virker uten noe mer. PowerSync og ElectricSQL trenger hver sin lille tjeneste (container) i Azure ved siden av appen, i Sweden Central (EU). Disse står **av** til du slår dem på. En merge til `main` lager ingenting nytt så lenge de er av.

**Bare oppdiktede adresser, navn og bilder i prøve A og B, aldri ekte kunder.** Testmiljøet oppfyller ikke «Minimum før ekte data» i `docs/07-utviklingsplan.md`.

### Slå på

1. **Lag fire nye secrets** i GitHub → Settings → Secrets and variables → Actions → fanen Secrets. Lag hver verdi i Terminal med `openssl rand -hex 32`. Det gir en ny, tilfeldig verdi hver gang. Bruk en ny verdi for hver av de fire:

   | Navn | Hva det er |
   |---|---|
   | `POWERSYNC_JWT_SECRET` | Nøkkelen appen og PowerSync deler |
   | `POWERSYNC_DB_PASSWORD` | Passordet til PowerSyncs databasebruker |
   | `ELECTRIC_SECRET` | Nøkkelen appen og Electric deler |
   | `ELECTRIC_DB_PASSWORD` | Passordet til Electrics databasebruker |

   De to databasepassordene må bare ha bokstaver og tall, og minst 24 tegn. `openssl rand -hex 32` gir 64 tegn med bare bokstaver og tall, så det holder. De to nøklene `POWERSYNC_JWT_SECRET` og `ELECTRIC_SECRET` må ha minst 32 tegn. `openssl rand -hex 32` gir 64 tegn, så det holder også. Mangler en secret, eller er et passord feil, stopper utrullingen med en melding som sier hvilket navn det gjelder.

2. **Sett variabelen** `ENABLE_SYNC_TRIAL` til `true` (fanen Variables). Nøyaktig `true`, med små bokstaver. Alt annet, også tom, betyr av.
3. **Kjør utrullingen:** Actions → «Utrulling til Azure» → «Run workflow».
4. **Vent noen minutter** etter at utrullingen er grønn. Første gang:
   - Databasen må få innstillingen `wal_level` satt til logisk replikering. Utrullingen gjør det selv, og starter databasen på nytt **én gang** hvis Azure sier at det trengs. Appen er borte i et par minutter mens det skjer. Det står i loggen til utrullingen.
   - Containerne kan starte på nytt et par ganger før databasebrukerne deres finnes. Det er normalt.

### Sjekke

1. **PowerSync svarer:** i portalen, gå til ressursgruppen `rg-ezprop-test` og åpne Container App-en for PowerSync. Kopier adressen («Application Url») og legg til `/probes/liveness`. Åpne den i nettleseren. Du skal få et kort svar, ikke en feilside.
2. **Electric er stengt for andre enn appen:** åpne Electric-adressen («Application Url» på Container App-en for Electric) med `/v1/health` på mobilen, på **mobilnett** (ikke wifi). Du skal få **403** eller ingen svar. Det viser at sperren virker: bare appen slipper inn.
3. **Kjør prøve A og B i appen** på iPaden, etter beskrivelsene i `docs/funksjoner/`. Velg kandidat på listen over testskjemaer.

Ser noe galt ut: åpne Container App-en i portalen → Log stream, og kopier de siste linjene til Claude. Loggene lagres ikke, de vises bare mens du ser på.

### Slå av

Gjør alle tre stegene, i denne rekkefølgen:

1. **Slett i portalen:** i ressursgruppen `rg-ezprop-test`, slett de to Container App-ene (PowerSync og Electric) og deretter Container Apps-miljøet (Container Apps Environment). Utrullingen sletter dem ikke selv.
2. **Sett variabelen** `ENABLE_SYNC_TRIAL` til noe annet enn `true`, for eksempel `false`.
3. **Kjør utrullingen** på nytt. Den fjerner synkinnstillingene i appen og rydder bort replikeringsplassene i databasen.

**Hvorfor steg 3 er viktig:** hver synktjeneste har en replikeringsplass i databasen. Når tjenesten er borte, men replikeringsplassen står igjen, tar databasen vare på alle endringer i påvente av at tjenesten kommer tilbake. Da fylles databasedisken, og hele testmiljøet stopper. Utrullingen med bryteren av sletter replikeringsplassene som ikke er i bruk.

Innstillingen `wal_level` settes ikke tilbake. Det er ufarlig og koster ingenting. De fire secrets kan stå, eller du kan slette dem.

## Slette miljøet

`az group delete --name rg-ezprop-test`

Alt i gruppen slettes, også databasen. Koden ligger fortsatt i GitHub, så miljøet kan lages på nytt.

## Hva som ikke er med ennå

Alt dette skal på plass før ekte data:

- E-post via Microsoft 365 (fase 0b)
- Nøkkelboks for hemmeligheter (fase 0b)
- Privat nettverk mellom app og database
- Egen databasebruker for appen
