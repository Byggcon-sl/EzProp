# ADR 0002 – Testmiljø i Azure: App Service, PostgreSQL Flexible Server og utrulling fra GitHub

Dato: 28.10.2026. Status: vedtatt som forberedelse (Ståle 28.10.2026: «samme Azure-miljø som Optiplan, egen app og egen database, utrulling fra GitHub ved merge til main»). Ståle bekrefter at valgene ligner Optiplan; avvik rettes i egen PR.

Støtter hovedmålet **tid**: prøvene A–F i fase 1 kjøres på ekte iPad Pro over https, og uten dem kan ikke synkløsningen (den største tidsbesparelsen mot IVIT) velges. **KI først:** nei i denne beslutningen, men testmiljøet er der KI-forslag senere vises og godkjennes på iPaden.

## Viktig antakelse

Optiplans repo (`infra/azure`, `deploy-azure.yml`) var ikke tilgjengelig da dette ble skrevet. Mønsteret er bygd ut fra det vi vet om Optiplan: Azure, Sweden Central (EU), Microsoft 365 for e-post, Better Auth, GitHub Actions. Alt under er derfor en antakelse Ståle kan sammenligne med Optiplan. Bruker Optiplan Container Apps, Key Vault eller en annen innloggingsmåte for GitHub, byttes det i en egen PR; appen selv er lik uansett.

## Beslutninger

1. **App Service (Linux, B1), ikke Container Apps.** Appen rulles ut som én zip av Next sitt standalone-bygg (`.next/standalone` med `server.js` øverst), startet med `node server.js`. Ingen Dockerfile, ingen container-registry, ingen bygging på serveren (`SCM_DO_BUILD_DURING_DEPLOYMENT=false`). Gratis sertifikat for egen adresse, og loggen kan leses i nettleseren (Log stream), som er der Ståle henter første innloggingskode.
2. **PostgreSQL Flexible Server 16, Burstable B1ms, 32 GB, i samme region, uten geo-kopi.** Egen database for EzProp, ikke delt med Optiplan. Bare TLS (`require_secure_transport=on`). Appen kobler til med `sslmode=verify-full`, fordi `postgres`-pakken slår av sertifikatsjekken ved `require`.
3. **Infrastruktur som kode i én Bicep-fil** (`infra/azure/main.bicep`) på ressursgruppenivå. Alle ressursnavn bygges av `environmentName` (`plan-ezprop-<miljø>`, `app-ezprop-<miljø>`, `psql-ezprop-<miljø>`), så `prod` kan legges til senere uten kollisjon. Hemmeligheter er `@secure()`-parametere uten standardverdi; filen inneholder aldri verdier, og `output` gir bare servernavn og adresse.
4. **Innlogging fra GitHub til Azure med OIDC (federated credential), ikke lagret passord.** GitHub-identiteten får «Contributor» bare på ressursgruppen `rg-ezprop-test`, som Ståle lager selv. En kompromittert arbeidsflyt når da ikke Optiplans ressurser.
5. **Utrulling fra GitHub Actions ved merge til `main`** (`.github/workflows/deploy-azure.yml`), også manuelt (`workflow_dispatch`). Jobben hopper over uten feil når Azure-nøklene mangler, så ingenting rulles ut før Ståle har lagt dem inn. Rekkefølge: bygg med oppdiktede verdier → Bicep valideres og rulles ut → migrering og seed fra kjøreren → zip → App Service → helsesjekk som krever riktig commit i `versjon`.
6. **Migrering kjøres fra arbeidsflyten, ikke ved oppstart av appen.** Standalone-bygget tar ikke med `tsx` og migreringsfilene, og en feilslått migrering skal stoppe utrullingen før ny kode kjører. Kjøreren slipper inn gjennom en midlertidig brannmurregel (`github-runner`) for sin egen IP, som alltid slettes etterpå.
7. **Egen adresse er en innstilling, ikke infrastruktur.** `APP_HOSTNAME` (GitHub-variabel, forslag `ezprop-test.byggcon.no`) styrer bare `BETTER_AUTH_URL`. Selve bindingen og det gratis sertifikatet legger Ståle inn i Azure-portalen når DNS er klart. Binding i Bicep krever to kjøringer (TXT-post først) og gir rød utrulling uten gevinst.
8. **Innlogging før e-post er koblet til:** når de fire Microsoft 365-verdiene mangler, skrives engangskoden for første admin (`SEED_ADMIN_EMAIL`) som én linje i serverloggen. Ingen andre kan logge inn. Når verdiene settes, bytter appen automatisk til Microsoft 365 (Graph-adapteren bygges i fase 0b).
9. **Helsesjekken viser commit.** Arbeidsflyten setter `APP_VERSION` til kort commit-id, og `/api/helse` svarer `<versjon> (<commit>)`. Utrullingen er rød hvis commit-id mangler i svaret.

## Kjente avveininger (står også i «Minimum før ekte data»)

- **Brannmurregelen «Azure-tjenester» (0.0.0.0) åpner databasen for alle Azure-kunders IP-adresser,** ikke bare vår app. Akseptert i test fordi databasen krever TLS og et langt tilfeldig passord, og bare inneholder oppdiktede data. Før ekte data: privat nettverk eller VNet-integrasjon mellom app og database, og regelen fjernes.
- **Appen bruker administratorbrukeren på databasen.** Enklest nå (én bruker, ett passord). Før ekte data lages en egen bruker uten eierrettigheter til appen; administrator brukes bare til migrering.
- **Hemmelighetene ligger i GitHub-secrets og i App Service sine appinnstillinger,** ikke i Key Vault. Alle med lesetilgang til ressursgruppen i Azure-portalen kan lese dem og innloggingskoden i loggen (spørsmål nr. 9). Key Vault kommer i fase 0b.
- **Bicep kompileres ikke i skymiljøet** (ingen `az`/`bicep`), og ingenting rulles ut herfra. Første grønne kjøring hos Ståle er den egentlige testen. Mottiltak: `az deployment group validate` før `create`, tekst-tester i `tests/deploy-workflow.test.ts`, og `workflow_dispatch` så Ståle kan kjøre på nytt uten ny merge.
- **`HOSTNAME=0.0.0.0` settes som appinnstilling.** Next sin `server.js` lytter på `HOSTNAME` hvis den er satt, og containeren i App Service setter den til sitt eget navn. `0.0.0.0` gjør at helsesjekken alltid når fram.

## Forkastet

- **Container Apps.** Krever Dockerfile, registry og bygg av image i hver utrulling; mer å feilsøke for Ståle, uten gevinst for én liten app. Byttes bare hvis Optiplan bruker det.
- **Ressursgruppen lages av arbeidsflyten** (`az group create`). Ville krevd rettigheter på abonnementet der Optiplan ligger. Ståle lager gruppen én gang selv.
- **Hostname-binding og managed certificate i Bicep.** To-kjørings-problem og rød utrulling til DNS er riktig.
- **Migrering ved oppstart av appen.** Standalone-bygget mangler verktøyene, og feil ville vist seg først etter at ny kode kjører.
- **Secrets som Azure-passord (`creds:`/`AZURE_CREDENTIALS`) i GitHub.** OIDC gir kortlivede tokens og ingenting å lekke.
- **`sslmode=require`.** Slår av sertifikatsjekken i `postgres`-pakken.
- **Lagre `DATABASE_URL` som egen GitHub-secret.** Bygges i stedet av servernavn og passord i Bicep og i kjøreren (maskert), så det finnes bare ett passord å bytte.
- **Graph-adapteren nå.** Spørsmål nr. 6 (e-post via Microsoft 365 fra start?) er åpent, og Optiplans adapter er ikke tilgjengelig. Egen liten PR i fase 0b.

## Konsekvenser

- Ståle må gjøre fire ting selv før første utrulling: ressursgruppe, innlogging for GitHub (OIDC), secrets og variabler i GitHub, og merge. Stegene står i `docs/drift/testmiljo-azure.md`.
- Anslått kostnad ca. 350–450 kr per måned (B1 + B1ms) ved dagens kurs; Ståle sammenligner med Optiplans faktura.
- Et `prod`-miljø senere er samme Bicep med `environmentName=prod`, egen ressursgruppe og egne secrets, pluss punktene i «Minimum før ekte data».
- Felles innlogging med Optiplan (fase 0b) påvirkes ikke: egen database og egen `BETTER_AUTH_URL` nå, egen ADR da.
