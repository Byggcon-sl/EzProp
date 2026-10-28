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

Valgfrie secrets. Legg inn **alle fire sammen**, og først når du har sagt ja til e-post via Microsoft 365 (spørsmål nr. 6). Selve sendingen bygges i fase 0b.

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

## Slette miljøet

`az group delete --name rg-ezprop-test`

Alt i gruppen slettes, også databasen. Koden ligger fortsatt i GitHub, så miljøet kan lages på nytt.

## Hva som ikke er med ennå

Alt dette skal på plass før ekte data:

- E-post via Microsoft 365 (fase 0b)
- Nøkkelboks for hemmeligheter (fase 0b)
- Privat nettverk mellom app og database
- Egen databasebruker for appen
