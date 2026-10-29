# Funksjon: Synktjenestene i Azure-testmiljøet (PowerSync og ElectricSQL)

- **Fase:** 1 – Prøve uten nett (forberedelse til prøve A og B)
- **Modul:** drift (`infra/azure`, `.github/workflows`, `docs/drift`). Ingen ny produktkode.
- **Status:** utkast
- **Branch:** `fase1-synk-i-azure` (bygger på `main`)
- **Dato:** 29.10.2026
- **Støtter hovedmål:** Tid: prøve A og B må kjøres på ekte iPad mot testmiljøet før vi velger synkløsning; valget avgjør om befaring uten nett (den største tidsbesparelsen mot IVIT) holder. / Reklamasjoner: prøvene viser om noe går tapt mellom iPad og server, før ekte rapporter bygges oppå. / KI først: nei (se under).

## Problem
Kandidat 1 (PowerSync) og kandidat 2 (ElectricSQL) kjører i dag bare på Macen (`127.0.0.1`). iPadene når dem ikke, så Ståle kan ikke kjøre prøve A og B for disse to. Kandidat 3 (egenbygd) går bare gjennom appen og trenger ingen ny tjeneste. Lar vi være, kan bare én av tre kandidater prøves på ekte iPad, og ADR-en får et svakt grunnlag.

Nye Azure-ressurser koster penger hver måned. Derfor skal alt nytt være **av som standard**, slik at en merge til `main` ikke lager noe nytt før Ståle selv slår det på.

## KI først
Nei. Dette er drift av testmiljøet. KI er ikke med. Det som støttes, er grunnlaget for befaring på iPad der KI-forslag senere vises og godkjennes.

## Brukerhistorier
- Som **Ståle** vil jeg **slå på synktjenestene med én innstilling i GitHub** slik at **jeg kan kjøre prøve A og B for alle tre kandidatene på ekte iPad**, og slå dem av igjen etterpå så de ikke koster penger.
- Som **takstmann i prøven** vil jeg **velge kandidat på listen over testskjemaer og jobbe uten nett** slik at **vi ser hvilken løsning som holder**.

## Omfang
**Med:**
1. **Bryter i Bicep:** ny parameter `enableSyncTrial bool = false` i `infra/azure/main.bicep` (samme fil og samme mønster, Sweden Central). Alle nye ressurser og appinnstillinger for synk lages bare når den er `true`. Med `false` skal utrullingen gi nøyaktig de samme ressursene som i dag.
2. **Bryter i GitHub:** variabelen `ENABLE_SYNC_TRIAL` (Settings → Variables, ikke secret). Tom eller annet enn `true` betyr av. `deploy-azure.yml` sender den videre til Bicep.
3. **Nye secrets (bare navn i repoet):** `POWERSYNC_JWT_SECRET`, `POWERSYNC_DB_PASSWORD`, `ELECTRIC_SECRET`, `ELECTRIC_DB_PASSWORD`. Er bryteren på og én mangler, stopper utrullingen med en norsk melding som sier hvilken (aldri verdien).
4. **Databasen (bare når bryteren er på):**
   - serverparameteren `wal_level = logical` i Bicep;
   - omstart av databaseserveren når `wal_level` ikke er `logical` ennå (arkitekten avgjør om arbeidsflyten gjør det selv én gang, eller om Ståle gjør det i portalen; testmiljøet har bare oppdiktede data);
   - rollene `powersync_repl` og `electric_repl` og databasen `powersync_storage`, laget av arbeidsflyten etter migreringen med et skript som tåler å kjøres flere ganger (samme rettigheter som i `docs/drift/powersync.md` og `docs/drift/electricsql.md`, aldri superbruker, aldri tilgang til andre tabeller enn de tre `trial_*`). Ståle skal ikke kjøre SQL selv.
5. **Container Apps (bare når bryteren er på):** ett Container Apps-miljø (forbruksplan) med to containere:
   - **PowerSync** `journeyapps/powersync-service:1.27.2`, kommando `start -r unified`, ekstern https-inngang mot port 8080, 0,5 vCPU / 1 GiB, nøyaktig 1 kopi. `powersync/config.yaml` og `powersync/sync-rules.yaml` lastes inn fra repoet (ikke kopiert for hånd) og monteres på `/config`. Miljøvariablene som i `docs/drift/powersync.md` del B.2, hemmeligheter som Container Apps-secrets.
   - **Electric** `electricsql/electric:1.8.1`, 0,5 vCPU / 1 GiB, nøyaktig 1 kopi, `ELECTRIC_USAGE_REPORTING=false`, `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`. **Bare appen skal nå den.** Arkitekten velger den enkleste måten som oppfyller det, og sikkerhet-personvern godkjenner: (a) intern inngang og VNet-integrasjon for App Service, eller (b) ekstern https-inngang med IP-sperre som bare slipper inn appens utgående adresser, i tillegg til `ELECTRIC_SECRET`. Valget og begrunnelsen skrives i PR-en og i `docs/drift/electricsql.md`.
   - Begge når databasen gjennom den eksisterende brannmurregelen for Azure-tjenester (kjent avveining i ADR 0002; ingen ny åpning).
6. **Appen:** når bryteren er på, får App Service `POWERSYNC_URL`, `POWERSYNC_JWT_SECRET`, `ELECTRIC_URL`, `ELECTRIC_SECRET`. `TRIAL_UPLOAD_DIR=/home/data/uploads/trial` settes **alltid** (også for kandidat 3), fordi standardmappen ligger i det som skrives over ved hver utrulling.
7. **Dokumentasjon for Ståle:** `docs/drift/testmiljo-azure.md` får et nytt avsnitt «Slå på synktjenestene for prøve A og B» (lage fire secrets, sette variabelen, kjøre utrullingen på nytt, sjekke at det virker), «Slå dem av igjen» (hva som slettes i portalen, og at replikeringsplassene må fjernes), og kostnaden. `docs/drift/powersync.md` og `docs/drift/electricsql.md` del B skrives om fra «kommer i egen PR» til det som faktisk er bygget.
8. **Kostnad:** anslag per måned når bryteren er på, i PR-en og i `docs/drift/testmiljo-azure.md` (utgangspunkt: ca. 300–450 kr per container, til sammen ca. 600–950 kr i tillegg til dagens ca. 350–450 kr; utvikler sjekker tomgangspris og eventuelle kostnader for logg og nettverk og retter tallene).
9. **Spørsmål nr. 12** i `docs/09-apne-sporsmal.md`: vil Ståle slå på synktjenestene i testmiljøet (kostnad per måned, hvor lenge)? Ikke blokkerende for PR-en, siden alt er av.
10. **Sjekk i CI:** `az bicep build` (eller tilsvarende) på `main.bicep`, slik at feil i malen oppdages før merge. Ingen innlogging i Azure.
11. Versjon i `package.json`: 0.2.5 → 0.2.6.

**Ikke med (bevisst utelatt):**
- Ingen utrulling til Azure og ingen Azure-kall fra agentene. Ståle slår på selv.
- Ingen ny produktkode, ingen migrering, ingen endring i synkreglene eller i appens synklogikk.
- Ingen tjeneste for kandidat 3 (egenbygd).
- Ingen Azure Files for Electric. Lagringen er mellomlager; en omstart betyr bare at iPadene henter alt på nytt.
- Ingen automatisk sletting når bryteren slås av (Bicep sletter ikke ressurser). Dokumenteres som et steg for Ståle.
- Ingen egen adresse (domene) for containerne, ingen nøkkelboks (fase 0b), ingen privat nettverk mellom app og database («Minimum før ekte data»).
- Ingen konto hos PowerSync Cloud eller Electric Cloud.
- Ingen produksjonsmiljø.

## Tilgang
Ingen ny tilgangslogikk. Tilgang til synkdata går som før gjennom `src/core/access` i appen og synkreglene. Hver iPad får bare egen organisasjons rader.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som i dag (testskjema) | som i dag |
| kontor | som i dag | som i dag |
| leder | som i dag | som i dag |
| admin | som i dag | som i dag |

## Data
Ingen nye tabeller. Nye databaseroller `powersync_repl` og `electric_repl` og databasen `powersync_storage` i testmiljøet (bare når bryteren er på). Ingen faste koder. Ordlisten: «synkbryter» → `enableSyncTrial`.

## Skjermer
Ingen nye. Takstmannen velger kandidat på listen over testskjemaer som før.

## Regler
Ingen.

## Akseptkriterier
- [ ] `main.bicep` bygger uten feil, både med `enableSyncTrial=false` og `true` (sjekk i CI).
- [ ] Med `enableSyncTrial=false` lager malen ingen nye ressurser og ingen nye appinnstillinger utover `TRIAL_UPLOAD_DIR` (vist i PR-en, f.eks. med den kompilerte malen der alle nye ressurser har betingelse).
- [ ] Uten variabelen `ENABLE_SYNC_TRIAL` i GitHub er utrullingen den samme som i dag; uten Azure-nøkler hoppes den over som før.
- [ ] Med bryteren på og en secret som mangler, stopper arbeidsflyten med en norsk melding som sier hvilken.
- [ ] Ingen verdier for hemmeligheter i repoet, i Bicep-utdata eller i loggene (bare navn).
- [ ] Electric kan ikke nås fra internett uten å gå via appen (valgt løsning dokumentert og godkjent av sikkerhet-personvern).
- [ ] Databaserollene har bare lesetilgang til de tre `trial_*`-tabellene og replikering; skriptet tåler å kjøres to ganger.
- [ ] `docs/drift/testmiljo-azure.md`, `powersync.md` og `electricsql.md` sier i klarspråk hva Ståle gjør for å slå på, sjekke og slå av, og hva det koster per måned.
- [ ] Spørsmål nr. 12 ligger i `docs/09-apne-sporsmal.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (ingen endring i appen, men versjonsnummeret er økt).
- [ ] Bruker i annen organisasjon får ikke tilgang: uendret, dekket av eksisterende tester for synkreglene og shape-proxyen.
- [ ] Virker på iPad-størrelse: uendret (ingen nye skjermer).

## Åpne spørsmål
- Nr. 12 (nytt): vil Ståle slå på synktjenestene i testmiljøet, og hvor lenge? Ikke blokkerende.
- Nr. 10 og 11 (leverandørvalg) gjelder fortsatt før ADR-en. Ikke blokkerende.
- Forbeholdet i `docs/drift/electricsql.md` (om Electric godtar en ferdiglaget publikasjon uten å eie tabellene) avklares først når Ståle har slått på tjenesten i Azure.

## Roller
- **arkitekt:** nettverk for Electric (a eller b), omstart for `wal_level`, hvordan rollene lages i arbeidsflyten, logg for Container Apps-miljøet.
- **sikkerhet-personvern:** secrets, at Electric bare nås fra appen, rettighetene til databaserollene, at ingenting hemmelig havner i logg eller utdata.
- **utvikler:** Bicep, arbeidsflyt, skript og dokumentasjon. Én bit (det henger sammen).
- **test-leder:** godkjenner før PR.
- Ingen testskriver (ingen ny appkode å teste; sjekken er Bicep-bygget i CI). Ingen UX, UI, KI eller fag.
