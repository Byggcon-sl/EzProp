# ADR 0003 – Synktjenestene for prøven i Azure-testmiljøet (PowerSync og ElectricSQL)

Dato: 29.10.2026. Status: vedtatt for fase 1, bare testmiljøet. Oppgavekort: `docs/funksjoner/fase1-synk-i-azure.md`. Bygger på ADR 0002.

Støtter hovedmålet **tid**: prøve A og B må kjøres på ekte iPad mot testmiljøet før vi velger synkløsning, og befaring uten nett er den største tidsbesparelsen mot IVIT. **Reklamasjoner:** prøvene viser om noe går tapt mellom iPad og server før ekte rapporter bygges oppå. **KI først:** nei, dette er drift.

Dette er ikke valget av synkløsning. Det kommer i en egen ADR etter prøvene A–F.

## Beslutninger

1. **Bryter, av som standard.** `enableSyncTrial bool = false` i `infra/azure/main.bicep`. Alle nye ressurser har `if (enableSyncTrial)`. Med `false` rulles nøyaktig de samme ressursene ut som i dag, så en merge til `main` koster ingenting nytt. Bryteren styres av GitHub-variabelen `ENABLE_SYNC_TRIAL`; bare nøyaktig `true` slår på. Variabel, ikke secret, fordi verdien ikke er hemmelig og Ståle skal kunne se den.
2. **Container Apps på forbruksplan, én kopi hver.** Ett Container Apps-miljø og to containere: PowerSync (`journeyapps/powersync-service:1.27.2`) og Electric (`electricsql/electric:1.8.1`), samme faste versjoner som i `docker-compose.yml`. 0,5 vCPU / 1 GiB, `minReplicas = maxReplicas = 1` (begge holder en replikeringsstrøm åpen og tåler ikke å skalere til null eller til to). Ferdige images fra leverandøren, så ingen Dockerfile eller registry hos oss; avviket fra ADR 0002 (App Service) gjelder bare disse to tjenestene.
3. **PowerSync-konfig som secret-volum.** `powersync/config.yaml` og `powersync/sync-rules.yaml` lastes med `loadTextContent` og monteres på `/config`. Samme filer som lokalt, så synkreglene er like på Macen og i Azure.
4. **Nettverk, valg (b): offentlig https med IP-sperre for Electric.** PowerSync har åpen https-inngang; iPaden kobler seg dit med en kortlivet JWT fra appen. Electric har https-inngang som bare slipper inn appens utgående adresser (`possibleOutboundIpAddresses`, `/32`, IPv6 filtrert bort), og krever i tillegg `ELECTRIC_SECRET`. `ELECTRIC_INSECURE` settes aldri. iPaden går aldri rett til Electric, bare gjennom `/api/prove/synk/shape` (som før).
   - **Forbehold:** App Service-adressene deles med andre Azure-kunder. IP-sperren er derfor et ekstra lag; `ELECTRIC_SECRET` er den egentlige beskyttelsen.
5. **Rekkefølge uten løkke.** Appen trenger adressene til containerne, og Electric trenger appens IP-er. Adressene bygges av miljøets domene (`https://<navn>.<defaultDomain>`), så appen avhenger bare av Container Apps-miljøet, og Electric avhenger av appen. Appinnstillingene står i `siteConfig.appSettings` med et betinget array; ingen egen `sites/config 'appsettings'`-ressurs (den overskriver alt).
6. **Samme JWT-nøkkel i app og PowerSync.** Bicep regner ut `PS_JWT_SECRET_BASE64` som base64url av UTF-8-bytene i `POWERSYNC_JWT_SECRET`, samme bytes som appen signerer med. Kontrakten for testen er `ToPowerSyncJwtKey` i `scripts/azure/sync-trial-roles.types.ts`.
7. **Hemmeligheter.** Fire nye GitHub-secrets (`POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET`, `ELECTRIC_DB_PASSWORD`) blir `@secure()`-parametere med tom standardverdi, så utrullingen virker uten dem når bryteren er av. `scripts/azure/check-sync-secrets.sh` stopper utrullingen når bryteren er på og noe mangler. I containerne går alle hemmeligheter via `secretRef`, aldri `value`. Ingen output inneholder dem.
8. **Egne databaseroller med minst mulig rett.** `powersync_repl` og `electric_repl` (LOGIN REPLICATION, bare SELECT på `trial_forms`, `trial_answers`, `trial_photos`), og databasen `powersync_storage` eid av `powersync_repl`. Lages av `scripts/azure/sync-trial-roles.ts` fra arbeidsflyten, ikke i Bicep (der ville admin eid databasen) og ikke av Ståle. Skriptet er TypeScript med driveren som finnes fra før, så det kan testes direkte fra Vitest; passord settes inn med `format(%L)` på serveren og står aldri i filen. Kontrakten er `ApplySyncTrialRoles` i `scripts/azure/sync-trial-roles.types.ts`.
9. **`wal_level = logical` og omstart fra arbeidsflyten.** Settes i Bicep med betingelse, kjedet etter `allowAzureServices` (parallelle endringer på serveren gir ServerIsBusy). Arbeidsflyten starter databasen på nytt bare når Azure melder `isConfigPendingRestart = true`, og det står i loggen. Ståle skal ikke gjøre manuelle steg i portalen. `wal_level` settes ikke tilbake når bryteren slås av; det er ufarlig.
10. **Rydding når bryteren slås av.** Bicep sletter ikke ressurser. Ståle sletter Container Apps-miljøet i portalen (står i `docs/drift/testmiljo-azure.md`), og neste utrulling fjerner appinnstillingene og sletter ubrukte replikeringsplasser (`powersync%`, `electric_slot%`). Ellers holder databasen på WAL og disken fylles.
11. **Logger lagres ikke.** Container Apps-miljøet har ingen Log Analytics. Ståle bruker loggstrømmen i portalen under prøven. Uten lagrede logger kan ingen hemmelighet havne i en logg som blir liggende.
12. **Databasen nås gjennom den eksisterende regelen «Azure-tjenester»** (ADR 0002), med `sslmode=verify-full`. Ingen ny åpning.

## Kostnad

Anslag med bryteren på: ca. 700–850 kr per måned i tillegg til dagens testmiljø (gratiskvoten for Container Apps gjelder per abonnement, så den første containeren blir billigere enn den andre). Ingen kostnad for VNet, Azure Files eller logg. Med bryteren av: 0 kr. Spørsmål nr. 12 i `docs/09-apne-sporsmal.md`.

## Forkastet

- **VNet, subnett og privat DNS (valg a).** Beste isolasjon, men krever et Container Apps-miljø med eget nettverk (dyrere og lenger å sette opp), VNet-integrasjon for appen og privat tilgang til databasen. Hører til «Minimum før ekte data», ikke en prøve med oppdiktede data.
- **Azure Files til lagring i containerne.** PowerSync lagrer i `powersync_storage` i PostgreSQL og Electric bygger opp igjen fra databasen; mellomlager i containeren holder.
- **Log Analytics.** Koster, og ville lagret logger som kan inneholde tilkoblingsinformasjon. Loggstrømmen holder for en prøve.
- **PowerSync Cloud og Electric Cloud.** Ny leverandør og ny avtale før vi vet hvilken kandidat vi velger (spørsmål nr. 10 og 11).
- **Alltid på.** Koster hver måned også når ingen prøver.
- **Roller og `powersync_storage` i Bicep.** Bicep kan ikke lage databaseroller, og en database laget der eies av admin.
- **Ståle starter databasen på nytt i portalen.** Et manuelt steg der prøven kan stoppe.
- **PowerSync-konfig som miljøvariabler.** Ikke prøvd i 1.27.2; secret-volumet er kjent å virke.
- **Egen tjeneste for kandidat 3 (egenbygd).** Går gjennom appen og trenger ingenting nytt.

## Konsekvenser

- Ingen ny produktkode, ingen migrering og ingen ny avhengighet.
- Ståle slår på og av selv etter `docs/drift/testmiljo-azure.md`. Bare oppdiktede data i prøven.
- Valget av synkløsning etter prøvene avgjør om noe av dette lever videre. Velges PowerSync eller Electric, lages en ny ADR for produksjon med privat nettverk og nøkkelboks.
