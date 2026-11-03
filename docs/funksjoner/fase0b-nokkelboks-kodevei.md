# Funksjon: Nøkkelboks steg 2 – kilde bak `readSecret` (port `SecretStore` med miljøvariabler og Azure Key Vault)

- **Fase:** 0b (Innlogging og sikkerhet)
- **Modul:** kjerne (`src/core/integrations`), litt infrastruktur (`infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`) og dokumenter
- **Status:** klart til bygging (oppgavekort laget av prosjektlederen 03.11.2026, autonom modus)
- **Branch:** `fase0b-nokkelboks-kodevei` fra `origin/fase0b-nokkelboks`. **Bygger på** steg 1 (branch `fase0b-nokkelboks`, ADR 0005, beslutning A49; bygges av en annen kjøring, siste push 03.11.2026 kl. 03:47 UTC, PR ikke åpnet ennå). PR-en åpnes mot `fase0b-nokkelboks` så lenge den ikke er merget, ellers mot `main`. Versjon: én patch over det branchen vi bygger på har når PR-en åpnes (`main` er 0.2.59, så tidligst **0.2.60**; bruk neste ledige).
- **Planpunkt:** «Nøkkelboks for hemmeligheter (for eksempel Azure Key Vault, samme oppsett som Optiplan). Ingen nøkler i koden eller databasen, bare navnet på hemmeligheten (`secret_ref`). (Innspill P12)» – steg 2 av samme punkt.
- **Støtter hovedmål:**
  - **Reklamasjoner (trygg drift):** hemmelighetene for tilkoblingene ligger ett sted (boksen) og leses ved navn. Ingen nøkkel i kode, database, Bicep-utdata, logg eller feilmelding. En nøkkel på avveie er en reklamasjon og et personvernbrudd på én gang.
  - **Tid (for Ståle og admin):** en ny tilkobling (regnskap i fase 3, KI i fase 2) trenger ingen kodeendring og ingen ny utrulling: Ståle legger hemmeligheten i boksen, admin skriver navnet i tilkoblingen. Ett oppsett, som Optiplan.
  - **KI først:** ikke selve oppgaven, men KI-tilkoblingen i fase 2 får nøkkelen sin denne veien (`readSecret`).

## Problem

Steg 1 (ADR 0005) legger appens egne hemmeligheter (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `MS_GRAPH_CLIENT_SECRET`) i boksen og lar App Service fylle miljøvariablene ved oppstart. Det virker bare for hemmeligheter som er kjent **når Bicep skrives**: hver ny `secret_ref` krever en ny ressurs i Bicep, en ny GitHub-secret og en ny utrulling, altså en kodeendring. Planpunktet sier at tilkoblingene bare skal ha **navnet**, og tilkoblingslaget (PR #64) er bygget slik at admin skriver `secret_ref` i tabellen. I dag kan admin skrive et navn, men verdien finnes bare hvis en utvikler har lagt den i Bicep først. Lar vi være, må hver tilkobling i fase 2 og 3 (KI, eAccounting med tre klienter) gå om Bicep, og «samme oppsett som Optiplan» blir ikke sant for tilkoblingene.

Løsningen: `readSecret` får en **kilde** bak seg (port `SecretStore` med bare `get`). Standard er miljøvariabler (som i dag). Med `SECRET_STORE_DRIVER=azure_key_vault` leses verdien rett fra boksen, med appens egen identitet (ingen nøkkel i repoet). Alt er bare kode og av som standard; ingenting slås på nå.

## KI først

Nei. Dette er infrastruktur og sikkerhet; ingen takstmannsoppgave KI kan forberede. Oppgaven er en forutsetning: KI-leverandørens nøkkel i fase 2 skal aldri ligge i kode, database eller logg, og skal kunne byttes uten utrulling.

## Brukerhistorier

- Som **Ståle (drift)** vil jeg **legge en hemmelighet i boksen og slå på lesingen med én innstilling** slik at jeg ikke trenger en utvikler eller ny utrulling for hver tilkobling.
- Som **admin** vil jeg **skrive navnet på hemmeligheten i tilkoblingen** slik at appen henter verdien selv, og jeg aldri ser eller lagrer verdien.
- Som **sikkerhetsansvarlig** vil jeg **at verdien aldri står i logg, feilmelding eller database, og at boksen bare kan leses, aldri endres, av appen** slik at en feil i drift ikke lekker nøkler.
- Som **utvikler av senere tilkoblinger** vil jeg **at `readSecret` virker likt lokalt og i Azure** slik at ingen tilkobling vet hvor hemmeligheten ligger.

## Omfang

**Med:**

1. **Port `SecretStore`** i ny fil `src/core/integrations/secret-store.ts`: `{ driver: "env" | "azure_key_vault"; get(secretRef: string): Promise<string | undefined> }`. Bare `get`; ingen `set`, `list` eller `delete` (appen skal aldri kunne skrive til boksen). `undefined` betyr «finnes ikke eller er tom». Porten får navnet slik `readSecret` har sjekket det (mønster og nektliste); adapteren gjør selv om navnet til sin form.
2. **Adapter for miljøvariabler** (`createEnvSecretStore(env)` i samme fil eller `env-secret-store.ts`): leser `env[secretRef]`. En uløst referanse til boksen (`isUnresolvedSecretReference` fra steg 1) regnes som «finnes ikke», som i dag. Ingen nettkall.
3. **Adapter for Azure Key Vault** i ny fil `src/core/integrations/azure-key-vault.ts`, etter mønsteret i `src/core/files/azure-storage.ts`:
   - `createAzureKeyVaultSecretStore(client: KeyVaultClientLike)` der `KeyVaultClientLike = { getSecret(name: string): Promise<{ value?: string }> }`. Den ekte `SecretClient` passer (typekontroll nederst i filen, som i filtjenesten); testene sender inn en falsk klient uten nett.
   - `createAzureKeyVaultSecretStoreFromUrl(vaultUrl)` lager `new SecretClient(vaultUrl, new ManagedIdentityCredential())`. **Bare arbeidsidentitet** (systemtildelt identitet fra steg 1), ikke `DefaultAzureCredential`: den leser også `AZURE_CLIENT_SECRET` fra miljøet og `az login` lokalt, og vi vil ikke ha en nøkkelvei vi ikke har bedt om. Lokalt brukes miljøvariabler.
   - **Én fast omforming av navnet** `toKeyVaultSecretName(secretRef)`: små bokstaver og `_` → `-` (`MS_GRAPH_CLIENT_SECRET` → `ms-graph-client-secret`, samme navn som Bicep i steg 1 bruker). Omformingen er entydig på det tillatte alfabetet (store bokstaver, tall, `_`), så to ulike `secret_ref` kan aldri treffe samme navn i boksen (test). Key Vault tillater 1–127 tegn av `a–z`, `0–9` og `-`; passer ikke det omformede navnet, gir adapteren `undefined` uten nettkall (et `secret_ref` på 128 tegn kan ikke finnes i boksen).
   - **Feil:** 404 fra boksen → `undefined`. Alt annet (ikke nett, 401/403 fordi identiteten mangler tilgang, 429, boksen borte) → ny `SecretStoreError` i `src/core/integrations/errors.ts` med fast tekst og bare navnet («Nøkkelboksen svarte ikke for hemmeligheten <NAVN>.»). Den opprinnelige feilen (kan ha adresse, token eller svar) sendes aldri videre og logges ikke.
   - Dette er den eneste filen som importerer `@azure/keyvault-secrets` og `@azure/identity`.
4. **Valg av kilde** inne i `secrets.ts` (eneste fil i laget som leser `process.env`, statisk kontroll 4 er uendret): `SECRET_STORE_DRIVER` tom eller `env` → miljøvariabler; `azure_key_vault` → krever `SECRET_STORE_AZURE_KEY_VAULT_URL` (`https://<navn>.vault.azure.net/`); alt annet eller manglende adresse → `SecretStoreConfigError` som nevner variabelnavnet, aldri verdien. **Ingen stille fallback** til miljøvariabler når boksen er valgt (samme regel som A40 i filtjenesten). Kilden lages én gang og brukes siden; `resetSecretStore()` eksporteres for tester (leser miljøet på nytt og tømmer mellomlageret).
5. **`readSecret` blir asynkron** (`Promise<string>`), i samme rekkefølge som i dag: navnet sjekkes (mønster og nektliste, `InvalidSecretRefError`) **før** noen kilde leses, deretter mellomlageret, deretter `store.get`; `undefined` eller tom streng → `SecretNotFoundError(secretRef)`. Nektlisten er uendret, og den gjelder også boksen: `DATABASE_URL` og `BETTER_AUTH_SECRET` ligger i boksen etter steg 1, men kan aldri leses gjennom laget. De to kallene i `src/core/email/resolve.ts` får `await` (de står alt i `async send`). Testene i `secrets.test.ts` bruker alt `await`.
6. **Mellomlager i minnet, kort levetid:** `withSecretCache(store, ttlMs)` som liten innpakning rundt porten, brukt bare for boksen (miljøvariabler er gratis å lese, og testene bytter dem med `vi.stubEnv`). Levetid 5 minutter (`SECRET_CACHE_TTL_MS`, én konstant). Bare vellykkede treff lagres, aldri «finnes ikke» og aldri feil. Nøkkel i mellomlageret er `secretRef`. Tømmes med `resetSecretStore()`. Ingen bakgrunnsjobb; utløp sjekkes ved oppslag.
7. **Slå på i testmiljøet uten kodeendring** (lite tillegg i Bicep, oppå steg 1): GitHub-variabelen `SECRET_STORE_DRIVER` (bare `azure_key_vault` betyr på; alt annet, også tom, betyr av) → parameter `secretStoreDriver string = ''` i `main.bicep` → appinnstillingene `SECRET_STORE_DRIVER` og `SECRET_STORE_AZURE_KEY_VAULT_URL` (`vault.properties.vaultUri`), begge bare når `enableKeyVault` **og** driveren er `azure_key_vault`; ellers settes de ikke. Ingen ny ressurs, ingen ny tilgang (policyen fra steg 1 gir alt `secrets: ['get']`), ingen ny `output`. `ALLOWED_VARS` i `tests/deploy-workflow.test.ts` får `SECRET_STORE_DRIVER`. Med variabelen tom er alt som i steg 1.
8. **Verdien står aldri i logg eller feilmelding.** `src/shared/lib/logger.ts` røres ikke (den vasker alt nøkler som slutter på `secret`, `token`, `connectionstring`); adapteren logger ingenting selv. `last_error` på tilkoblingen får teksten fra `SecretStoreError`/`SecretNotFoundError` (bare navnet), som i dag.
9. **Dokumentasjon:**
   - **ADR 0006** `docs/adr/0006-nokkelboks-kodevei.md` (maks en halv side, arkitekten): hvorfor en kodevei i tillegg til referansene i ADR 0005 (hemmeligheter som ikke er kjent ved utrulling; admin skriver navnet), port med bare `get`, bare arbeidsidentitet, omforming av navnet, mellomlager 5 minutter, ingen stille fallback, av som standard. Forkastet: `DefaultAzureCredential`, egen REST-klient mot boksen (token fra IMDS for hånd), fallback til miljøet, mellomlager for miljøvariabler, hemmeligheter per organisasjon i tabellen (fase 3), nøkkelboks per organisasjon. Én linje i ADR 0005 under «Forkastet: egen kodevei»: «bygget som steg 2 for tilkoblingenes hemmeligheter, se ADR 0006».
   - `docs/drift/testmiljo-azure.md`: nytt underavsnitt «Steg 2: appen leser tilkoblingenes hemmeligheter rett fra boksen» under «Nøkkelboks for hemmeligheter», i klarspråk, under «Trenger Ståle»: (1) boksen må være på (`ENABLE_KEY_VAULT=true`, steg 1); (2) legg hemmeligheten inn i boksen i portalen (Key Vault → Secrets → Generate/Import) med navnet i små bokstaver og bindestrek (eksempel: `secret_ref` `EACCOUNTING_API_KEY` heter `eaccounting-api-key` i boksen); (3) sett GitHub-variabelen `SECRET_STORE_DRIVER` til `azure_key_vault` og kjør utrullingen; (4) sjekk: en tilkobling med riktig navn sender, feil navn gir «Fant ikke hemmeligheten …» i `last_error`; (5) slå av: tøm variabelen og kjør utrullingen. Appen får ikke lese boksen uten tilgangen fra steg 1; mangler den, står «Nøkkelboksen svarte ikke …» i `last_error`. Kostnad: tilnærmet null (betaling per 10 000 oppslag; mellomlageret gjør at hver tilkobling spør høyst hvert 5. minutt). Punktet «Nøkkelboksen er bygget, av til Ståle slår den på» utvides med steg 2.
   - `.env.example`: to utkommenterte linjer `# SECRET_STORE_DRIVER=env` og `# SECRET_STORE_AZURE_KEY_VAULT_URL=` med én forklarende kommentar (boksen brukes ikke lokalt).
   - `docs/05-domenemodell.md` ved `secret_ref` (avsnitt 4.10 og ordlisten): én setning om at navnet i boksen er samme navn i små bokstaver med bindestrek, og at omformingen gjøres ett sted i koden. Ordlisten (avsnitt 8) får `SecretStore` (kilde for hemmeligheter) og `secret store driver` hvis de mangler.
   - `docs/06-arkitektur.md` regel 8: én setning ved `readSecret` (kilde bak porten: miljøvariabler eller boksen).
   - `docs/07-utviklingsplan.md`: planlinjen for nøkkelboksen får «steg 2 (kodevei) levert …, ADR 0006».
   - `docs/09-apne-sporsmal.md`: beslutningen føres i «Avgjort av agentene mens Ståle var borte» med neste ledige nummer (A49 er brukt av steg 1; bruk A50 hvis ledig, ellers neste).
   - `docs/agenter/tilstand.md`: «Trenger Ståle når han er tilbake» får punktet om steg 2 (se drift). Oppdateres når PR-en åpnes, oppå tilstandsfilen på `main` (branchen vi bygger på har en eldre utgave).
10. **Ny avhengighet, begrunnes i PR-en (regel 9):** `@azure/keyvault-secrets` (`SecretClient`) og `@azure/identity` (`ManagedIdentityCredential`), begge Microsofts offisielle klienter, låst til én versjon som `@azure/storage-blob` (A41). Alternativet, egen REST-klient med token fra IMDS for hånd, er mer kode og mer risiko. Brukes bare i `azure-key-vault.ts`; statisk test viser at ingen annen fil importerer dem.
11. **Tester** (se «Akseptkriterier» og testplanen).
12. **Versjon** i `package.json` (se øverst).

**Ikke med (bevisst utelatt):**

- **Å slå på noe i Azure.** Driveren er av, ingen ressurs lages, ingen kostnad. Ståle slår på selv (føres under «Trenger Ståle når han er tilbake»).
- Endring i steg 1: Bicep-ressursene, referansene i appinnstillingene, `secret-reference.ts` og `env.ts` røres ikke (bare de to nye appinnstillingene i punkt 7 kommer i tillegg). **Appens egne hemmeligheter** (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `POWERSYNC_JWT_SECRET`, `ELECTRIC_SECRET`, `FILE_STORAGE_AZURE_CONNECTION_STRING`) leses fortsatt bare fra miljøet (`env.ts` / direkte), aldri gjennom porten; nektlisten er uendret.
- Å skrive, liste eller slette hemmeligheter fra appen eller fra admin-skjermen. Hemmeligheter per organisasjon lagt inn fra admin (fase 3, med regnskap).
- `DefaultAzureCredential`, klienthemmelighet eller sertifikat for å logge inn mot boksen. Lokal utvikling mot en ekte boks.
- Fallback til miljøvariabler når boksen er valgt men ikke svarer. Mellomlager for miljøvariabler. Mellomlager på disk eller i databasen. Forhåndslasting ved oppstart. Bakgrunnsjobb som fornyer mellomlageret.
- Rotasjon, versjoner av hemmeligheter (adapteren leser alltid nyeste), utløpsdatoer, varsler, tilgangslogg for boksen (diagnostikk koster penger).
- Nøkkelboks per organisasjon eller per selskap (én boks per miljø, som i steg 1). Nøkkelboks for produksjon (samme mal, eget miljønavn; Ståle ruller ut).
- Endringer i `src/core/access`, `src/shared/lib/logger.ts`, `src/core/files`, `src/core/email/graph.ts`, `connections.ts` (bortsett fra `await` der `readSecret` kalles, hvis noe), migreringer eller tabeller.
- Tofaktor (fase 4), privat nettverk mot boksen, RBAC (steg mot produksjon, ADR 0005).

## Tilgang

Ingen nye rettigheter i appen, ingen skjerm, ingen fil i `src/core/access` røres. Tilgangen til boksen gjelder appens identitet (bare `get`, fra steg 1) og Ståle i Azure-portalen. Nektlisten i `readSecret` gjelder uansett kilde.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – (skriver bare `secret_ref` i tilkoblingen, som før) | – |

## Data

Ingen nye tabeller, ingen migrering. `secret_ref` på `integration_connections` er uendret (`/^[A-Z][A-Z0-9_]{1,127}$/`, bare navnet). Nytt i domenemodellen: én setning om navnet i boksen (omfang 9). Faste koder som tas i bruk: driverne `env` og `azure_key_vault` (verdier for `SECRET_STORE_DRIVER`; endres aldri, arkiveres).

## Skjermer

Ingen.

## Regler

Ingen.

## Akseptkriterier

**Port, adaptere og `readSecret` (Vitest, `src/core/integrations/`):**

- [ ] A1: `readSecret` sjekker navnet (mønster og nektliste) **før** noen kilde leses: med en falsk kilde som teller kall gir ugyldig navn og navn på nektlisten `InvalidSecretRefError` og null kall, uansett driver. Alle eksisterende tester i `secrets.test.ts` er grønne.
- [ ] A2: Standard (ingen `SECRET_STORE_DRIVER`) og `env` gir miljøvariabler: samme oppførsel som i dag, også for uløste referanser (steg 1). `resetSecretStore()` mellom testene.
- [ ] A3: `toKeyVaultSecretName`: `MS_GRAPH_CLIENT_SECRET` → `ms-graph-client-secret`, `A_1` → `a-1`, `AB` → `ab`; resultatet matcher `^[a-z0-9-]{1,127}$` for alle gyldige `secret_ref` opp til 127 tegn; 128 tegn gir ikke et gyldig navn; omformingen er entydig (to ulike gyldige `secret_ref` gir alltid ulike navn, vist ved at omformingen kan snus for de tillatte tegnene).
- [ ] A4: Boksadapteren med falsk klient: treff gir verdien; 404 gir `undefined` (så `readSecret` gir `SecretNotFoundError` med bare navnet); 401, 403, 429, 500 og nettfeil (`fetch failed`/`ENOTFOUND`) gir `SecretStoreError` hvis melding inneholder navnet og verken verdien, adressen (`vault.azure.net`), `https://`, `Bearer` eller teksten fra den opprinnelige feilen; feil på tom verdi (`value: ""`) gir `undefined`; et navn som ikke passer boksens regler gir `undefined` uten kall på klienten.
- [ ] A5: Den ekte `SecretClient` oppfyller `KeyVaultClientLike` (typekontroll i adapterfilen, `pnpm typecheck`).
- [ ] A6: Valg av kilde: `SECRET_STORE_DRIVER=azure_key_vault` uten `SECRET_STORE_AZURE_KEY_VAULT_URL` gir `SecretStoreConfigError` som nevner variabelnavnet; `tull` gir `SecretStoreConfigError`; `azure_key_vault` med oppdiktet adresse lager kilden med `driver === "azure_key_vault"` uten nettkall (kallet skjer først ved `get`). Ingen stille fallback til miljøet når boksen er valgt: en hemmelighet som bare finnes i miljøet, finnes ikke.
- [ ] A7: Mellomlageret: to kall på samme navn innen 5 minutter gir ett kall på klienten; etter 5 minutter (`vi.useFakeTimers`) nytt kall; `undefined` og feil lagres ikke (neste kall spør igjen); `resetSecretStore()` tømmer; to ulike navn deler ikke verdi. Miljøvariabler mellomlagres ikke (ny verdi med `vi.stubEnv` leses straks).
- [ ] A8: Statisk: `@azure/keyvault-secrets` og `@azure/identity` importeres bare i `src/core/integrations/azure-key-vault.ts`; `process.env` leses i laget bare i `secrets.ts` (kontroll 4, uendret); `ManagedIdentityCredential` brukes, `DefaultAzureCredential` forekommer ikke i `src/`; ingen `.setSecret(`, `.beginDeleteSecret(` eller `listPropertiesOfSecrets(` i `src/`.
- [ ] A9: `src/core/email/resolve.ts`: `sendEmail` gjennom tilkoblingslaget virker med asynkron `readSecret` (eksisterende tester i `email.test.ts` og `resolve.test.ts` grønne); manglende hemmelighet gir fortsatt avvist sending med `last_error` som bare har navnet.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): ikke relevant, ingen ny spørring og ingen ny tabell. `tests/tenant-isolation-all-tables.test.ts` er uendret og grønn.
- [ ] Virker på iPad-størrelse (e2e): ingen skjerm. e2e kjøres som vanlig og er grønn.

**Infrastruktur (statisk, `tests/deploy-workflow.test.ts`):**

- [ ] B1: `main.bicep` har `param secretStoreDriver string = ''`; appinnstillingene `SECRET_STORE_DRIVER` og `SECRET_STORE_AZURE_KEY_VAULT_URL` finnes bare med betingelse på både `enableKeyVault` og `secretStoreDriver == 'azure_key_vault'`; adressen hentes fra `vaultUri`, ikke skrevet for hånd; ingen ny ressurs, ingen ny `output`, ingen ny `accessPolicies`/`roleAssignments`.
- [ ] B2: `deploy-azure.yml` setter `secretStoreDriver=` fra `vars.SECRET_STORE_DRIVER` i både validering og utrulling; `ALLOWED_VARS` har `SECRET_STORE_DRIVER`; driftsdokumentet nevner variabelen. Ingen `set -x`, ingen `echo` av hemmeligheter (eksisterende test). Med variabelen tom er den bygde malen lik steg 1 (eksisterende tester for steg 1 grønne).
- [ ] CI-jobben «Bicep for testmiljøet» er grønn.

**Dokumenter (statisk):**

- [ ] D1: ADR 0006 finnes og nevner: kodevei for tilkoblingenes hemmeligheter, port med bare `get`, arbeidsidentitet, omforming av navnet, 5 minutter, ingen fallback, av som standard, forkastede valg; ADR 0005 peker til ADR 0006.
- [ ] D2: `testmiljo-azure.md` har underavsnittet om steg 2 med slå på, legge inn, sjekke og slå av; `.env.example` har de to utkommenterte linjene; domenemodellen og arkitekturen er oppdatert; planlinjen er oppdatert; beslutningen er ført i `docs/09-apne-sporsmal.md`.
- [ ] Det Ståle gjør selv står under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`.
- [ ] PR-en begrunner de to nye avhengighetene (regel 9), øker versjonen og sier hvilket hovedmål den støtter.

**Kan ikke testes automatisk (Ståle sjekker selv):** at appens identitet faktisk får lese fra den ekte boksen, og at en tilkobling sender med en hemmelighet lagt inn i portalen. Adapteren er testet bare mot en falsk klient.

## Roller

- **forenkler (runde 1):** sjekker at kortet ikke bygger mer enn planpunktet trenger: én port, to adaptere, én omforming, ett mellomlager, to appinnstillinger. Kandidater for kutt: punkt 7 (Bicep) hvis det kan gjøres like enkelt på annen måte uten kodeendring for Ståle.
- **arkitekt:** skriver ADR 0006 og sjekker grensesnittet til porten (bare `get`, asynkron `readSecret`, mellomlageret som innpakning, ingen import av Azure utenfor adapterfilen).
- **sikkerhet-personvern:** går gjennom at verdien aldri lekker (feilmeldinger fra adapteren, `last_error`, Bicep), at bare arbeidsidentitet brukes, at nektlisten gjelder også boksen, at omformingen er entydig, at appen bare kan lese, og at ingenting slås på.
- **test-leder:** skriver `docs/funksjoner/fase0b-nokkelboks-kodevei-testplan.md` etter A1–A9, B1–B2, D1–D2.
- **utvikler:** porten, adapterne, `secrets.ts`, `errors.ts`, `index.ts`, `resolve.ts` (`await`), Bicep og arbeidsflyten (punkt 7), dokumentene utenom ADR 0006, `.env.example`, avhengighetene, versjonen.
- **testskriver:** testene etter testplanen (port, adaptere med falsk klient, mellomlager, valg av kilde, statiske kontroller, Bicep og arbeidsflyt, dokumenter).

Ikke med: ux-ansvarlig og ui-designer (ingen skjerm), fagansvarlig (ingen fagstoff).

## Deling i biter (uavhengige, i parallell)

- **Utvikler, bit 1 (kode):** omfang 1–6, 8, 10, 12, `index.ts` og `resolve.ts`.
- **Utvikler, bit 2 (infrastruktur og dokumenter):** omfang 7 og 9 (utenom ADR 0006). Rører ikke filene i bit 1.
- **Arkitekt:** ADR 0006 og linjen i ADR 0005.
- **Testskriver:** omfang 11 etter testplanen, mot grensesnittet i kortet: `SecretStore` med `driver` og `get`, `createEnvSecretStore(env)`, `createAzureKeyVaultSecretStore(client)`, `toKeyVaultSecretName(secretRef)`, `withSecretCache(store, ttlMs)`, `SECRET_CACHE_TTL_MS`, `readSecret(secretRef): Promise<string>`, `resetSecretStore()`, `SecretStoreError`, `SecretStoreConfigError`; alle eksportert fra `src/core/integrations/index.ts`.

## Samkjøring med steg 1 (prosjektlederen)

- Steg 1 bygges av en annen kjøring på `fase0b-nokkelboks` (siste push 03.11.2026 kl. 03:47 UTC). Denne branchen er laget oppå den og rører ikke steg 1 sine filer utenom `main.bicep` (to appinnstillinger og én parameter), `deploy-azure.yml` (én parameterlinje), `secrets.ts` (kilden bak), ADR 0005 (én linje) og driftsdokumentet (ett underavsnitt).
- Før hvert av de siste stegene (sammensetting, test-leder, PR) sjekkes `origin/fase0b-nokkelboks`: er steg 1 merget, flettes `main` inn og PR-en åpnes mot `main`; er PR-en for steg 1 åpen, åpnes denne mot `fase0b-nokkelboks` med «Bygger på» i teksten; har steg 1 ingen PR 3 timer etter siste push (kl. 06:47 UTC), tar denne kjøringen over, åpner PR-en for steg 1 først og denne oppå.
- Beslutningsnummer: A49 er brukt av steg 1. Denne bruker A50; må det nummereres om ved fletting, gjøres det av prosjektlederen.

## Åpne spørsmål

- Ingen som stopper PR-en. Til Ståle når han er tilbake (føres i tilstandsfilen): om Optiplan leser hemmeligheter i kode fra boksen (slik steg 2 gjør) eller bare via referanser (steg 1); hvilken av de to veiene produksjon skal bruke for `MS_GRAPH_CLIENT_SECRET` (begge virker; nektlisten hindrer ingen av dem); om han vil ha diagnostikk på boksen (koster litt).
