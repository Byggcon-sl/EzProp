# Funksjon: Nøkkelboks for hemmeligheter

- **Fase:** 0b (Innlogging og sikkerhet)
- **Modul:** kjerne (`src/core/integrations/secrets.ts`, `src/shared/config/env.ts`, ny `src/shared/config/secret-reference.ts`) og infrastruktur (`infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`, `.github/workflows/ci.yml`)
- **Status:** klart til bygging (oppgavekort laget av prosjektlederen 03.11.2026, autonom modus; oppdatert etter forhåndsvurdering runde 1 fra forenkler, arkitekt, sikkerhet-personvern og test-leder samme dag)
- **Branch:** `fase0b-nokkelboks` fra `main`. Versjon **0.2.58** (én patch over `main` 0.2.57; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch).
- **Planpunkt:** «Nøkkelboks for hemmeligheter (for eksempel Azure Key Vault, samme oppsett som Optiplan). Ingen nøkler i koden eller databasen, bare navnet på hemmeligheten (`secret_ref`). (Innspill P12)»
- **Støtter hovedmål:**
  - **Reklamasjoner (trygg drift):** hemmelighetene (databasepassord, innloggingsnøkkel, klienthemmeligheten for e-post) ligger i én låst boks, ikke som klartekst i appinnstillingene der alle med lesetilgang til ressursgruppen ser dem (spørsmål nr. 9). En nøkkel på avveie er en reklamasjon og et personvernbrudd på én gang.
  - **Tid (for Ståle):** hemmeligheten legges inn ett sted. Utrullingen legger den i nøkkelboksen, og appen henter den derfra. Ingen manuell kopiering til appinnstillinger eller andre steder når flere tjenester kommer (fillagring, KI, regnskap).
  - **KI først:** ikke relevant for selve oppgaven, men KI-tilkoblingene i fase 2 og 3 får nøklene sine samme vei (`readSecret`), så ingen ny vei må bygges da.

## Problem

I testmiljøet ligger alle hemmelighetene i klartekst i App Service sine appinnstillinger (ADR 0002, «kjente avveininger»). Alle med lesetilgang til ressursgruppen `rg-ezprop-test` kan lese dem. Domenemodellen og tilkoblingslaget (PR #64) er bygget for at `secret_ref` bare er et **navn**, og at `readSecret` er eneste vei til verdien, men i dag er «boksen» bare miljøvariabler. Lar vi være, må hver ny tilkobling (fillagring i Azure, KI, eAccounting) legge nøkkelen sin i klartekst i appinnstillingene, og «Minimum før ekte data» kan ikke krysses av.

Ståle er borte, og ingenting som koster penger kan slås på. Derfor bygges nøkkelboksen som **bare kode og infrastruktur som er av som standard**: en merge til `main` lager ingen nye ressurser, og Ståle slår bryteren på selv når han er tilbake.

## KI først

Nei. Dette er infrastruktur og sikkerhet; det er ingen takstmannsoppgave KI kan forberede. Oppgaven er likevel en forutsetning for KI først: KI-leverandørens nøkkel skal aldri ligge i kode, database eller logg, og `readSecret` er veien KI-tilkoblingen i fase 2 skal bruke.

## Brukerhistorier

- Som **Ståle (admin og drift)** vil jeg **legge en hemmelighet inn ett sted og slå på nøkkelboksen med én bryter** slik at ingen hemmelighet ligger i klartekst i Azure-portalen, og slik at jeg ikke må gjøre noe i Azure selv utover å slå bryteren på.
- Som **sikkerhetsansvarlig** vil jeg **at verdien av en hemmelighet aldri står i logg, feilmelding, database eller utdata fra utrullingen** slik at en feil i drift ikke lekker nøkler.
- Som **utvikler av senere tilkoblinger** vil jeg **at `readSecret` virker likt lokalt (miljøvariabler) og i Azure (nøkkelboksen)** slik at ingen tilkobling trenger å vite hvor hemmeligheten ligger.

## Omfang

**Med:**

1. **Nøkkelboksen i Bicep, av som standard.** Ny parameter `enableKeyVault bool = false` i `infra/azure/main.bicep`, satt fra GitHub-variabelen `ENABLE_KEY_VAULT` i `deploy-azure.yml` (nøyaktig `true` betyr på, alt annet av; samme mønster som `ENABLE_SYNC_TRIAL`: `enableKeyVault=$NOKKELBOKS` i parameterne til både validering og utrulling). Med bryteren av lages ingen ny ressurs, og appinnstillingene er som i dag. Med bryteren på lages ett Key Vault i samme region som resten (navn `kv-ezprop-<miljø>`, `sku standard`, `tenantId: subscription().tenantId`, `enableSoftDelete: true`, `enablePurgeProtection: true`, `enableRbacAuthorization: false`, `accessPolicies: []` på selve boksen, ingen `networkAcls` med `Deny`). Alle ressurser av typen `Microsoft.KeyVault/*` har `= if (enableKeyVault …)`.
2. **Appen får systemtildelt identitet, alltid på.** `identity: { type: 'SystemAssigned' }` på App Service **uten betingelse**. Identiteten er gratis og lager ingen ressurs i ressursgruppen; en betinget identitet ville slettes og få ny id hver gang bryteren slås av og på, og tilgangen måtte lages på nytt. Testen «med bryteren av: samme ressurstyper» holder (ingen ny ubetinget ressurs).
3. **Tilgang: tilgangspolicy med bare `get`, som egen ressurs.** Ressursen `Microsoft.KeyVault/vaults/accessPolicies@2023-07-01` med navn `add`, `= if (enableKeyVault)`, gir `app.identity.principalId` `permissions: { secrets: ['get'] }` og ingenting annet (ingen `list`, `set`, `delete`, `purge`; ingen `keys` eller `certificates`). Ikke RBAC: rolletildeling krever Owner eller User Access Administrator, altså noe nytt fra Ståle; GitHub-innloggingen har Contributor og kan skrive policyer. RBAC og privat nettverk føres som steg mot produksjon i ADR 0005. Egen ressurs (ikke inline på boksen) fordi boksen og appen ellers avhenger av hverandre i en sirkel (appinnstillingene peker på boksen, policyen peker på appen). `app.identity.principalId` brukes bare i denne ressursen.
4. **Hemmelighetene går gjennom boksen når bryteren er på.** Tre hemmeligheter, som ressursen `Microsoft.KeyVault/vaults/secrets` med navnene `database-url` (`= if (enableKeyVault)`), `better-auth-secret` (`= if (enableKeyVault)`) og `ms-graph-client-secret` (`= if (enableKeyVault && emailConfigured)`). Navnene i boksen finnes bare i Bicep (Key Vault tillater bare bokstaver, tall og bindestrek); `secret_ref` i appen er fortsatt navnet på miljøvariabelen. Utrullingen legger verdiene fra GitHub-secrets inn i boksen, og appinnstillingene `DATABASE_URL`, `BETTER_AUTH_SECRET` og `MS_GRAPH_CLIENT_SECRET` får referansen `@Microsoft.KeyVault(SecretUri=${secret.properties.secretUri})` (uten versjon, så ny verdi ved neste utrulling virker uten endring i innstillingene). Med bryteren av står verdiene som i dag. Verdier som ikke er hemmelige (`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MAIL_FROM`, `BETTER_AUTH_URL`) står alltid som før. App Service løser referansene ved oppstart, så verdiene kommer inn som vanlige miljøvariabler, og **`readSecret` er uendret og eneste vei**. Ingen egen kodevei mot Key Vault (ingen `SECRETS_DRIVER`, ingen REST-klient, ingen ny avhengighet). Appen kjører på App Service, ikke i Container Apps, så referanseformen er App Service sin.
   - **Synknøklene (`POWERSYNC_JWT_SECRET`, `ELECTRIC_SECRET`) går ikke gjennom boksen.** ADR 0004 har foreløpig valgt egenbygd, og synktjenestene skal fjernes etter Ståles godkjenning. To brytere sammen gir fire kombinasjoner å teste for kode som trolig slettes. Én setning i ADR 0005: «synknøklene legges i boksen hvis synktjenesten blir værende». Siden de aldri blir referanser, trengs ingen vakt i `src/modules/offline-trial`.
5. **Vakt mot referanser som ikke er løst, ett sted.** Når App Service ikke får hentet en hemmelighet (identiteten mangler tilgang, boksen er borte), står referanseteksten `@Microsoft.KeyVault(…)` igjen som verdi i miljøvariabelen. Ny fil `src/shared/config/secret-reference.ts` med `export const KEY_VAULT_REFERENCE_PREFIX = "@Microsoft.KeyVault("` og `export function isUnresolvedSecretReference(value: string): boolean` (trimmet verdi, uten hensyn til store og små bokstaver; dekker begge formene App Service bruker, `SecretUri=` og `VaultName=…;SecretName=`). Ligger i `shared` fordi `shared` aldri importerer fra `core`. Brukes to steder:
   - `readSecret` kaster `SecretNotFoundError(secretRef)` (meldingen har bare navnet, som i dag; ingen ny feilklasse) i stedet for å gi referanseteksten videre som verdi;
   - `env.ts` stopper appen ved start med `.refine(...)` på `DATABASE_URL` og `BETTER_AUTH_SECRET` og meldingen «<NAVN> er en referanse til nøkkelboksen som ikke ble hentet. Sjekk identiteten og tilgangen i Azure.» (i dag ville en uløst referanse på 32+ tegn bli godtatt som nøkkel). `MS_GRAPH_CLIENT_SECRET` dekkes av `readSecret`. Meldingen inneholder aldri verdien eller adressen.
6. **Verdien står aldri i logg, feilmelding, database eller utdata.** Ingen ny `output` i Bicep (ingen leser boksens navn, og færre utdata er mindre å vokte). Utrullingsloggen skriver bare navn (ingen `set -x`, ingen `echo` av hemmeligheter). Referanseteksten er ikke hemmelig (boksnavn og hemmelighetsnavn), og feilen fra `readSecret` har bare navnet, så `src/shared/lib/logger.ts` røres ikke.
7. **CI bygger og sjekker den bygde malen.** jq-steget «Sjekk at synkressursene har betingelsen enableSyncTrial» i `ci.yml` utvides (eller får et søskensteg) til å kreve `parameters('enableKeyVault')` i `condition` på alle ressurser av typen `Microsoft.KeyVault/`. Det er CI som er sjekken av den bygde malen; Vitest sjekker bare teksten.
8. **Dokumentasjon:**
   - **ADR 0005** `docs/adr/0005-nokkelboks-key-vault.md` (maks en halv side, skrives av arkitekten): hvorfor Key Vault-referanser på App Service og ikke egen kodevei, hvorfor av som standard, hvorfor GitHub-secrets fortsatt er kilden (Ståle legger inn ett sted; boksen fylles av utrullingen), hva som endres når hemmelighetene senere legges direkte i boksen (steg to: GitHub-secrets fjernes, utrullingen slutter å skrive), tilgangspolicy nå og RBAC og privat nettverk som steg mot produksjon, at policyen lages etter appen og referansene kan stå røde til appen er startet på nytt, at purge-beskyttelse ikke kan slås av og at navnet `kv-ezprop-<miljø>` er låst i 90 dager hvis boksen slettes (bruk «Recover»). Forkastet: egen kodevei (REST eller `@azure/keyvault-secrets`), RBAC i test, Container Apps-secrets (appen kjører på App Service), hemmeligheter lagt direkte i boksen nå. Nevner at Optiplans oppsett ikke var tilgjengelig (som ADR 0002), så dette er en antakelse Ståle kan sammenligne. Én setning om synknøklene (punkt 4).
   - `docs/drift/testmiljo-azure.md`: `ENABLE_KEY_VAULT` i listen over GitHub-variabler, og nytt avsnitt «Nøkkelboks for hemmeligheter» med hva Ståle gjør selv: sett `ENABLE_KEY_VAULT` til `true`, kjør utrullingen, sjekk under Configuration i portalen at referansene har grønt hakemerke; er de røde etter første utrulling, start appen på nytt (tilgangen lages etter appen, og App Service løser referansene ved oppstart); slå av: sett variabelen til noe annet og kjør utrullingen (boksen slettes ikke av utrullingen; slettes den i portalen, ligger den i myk sletting i 90 dager og sperrer navnet, bruk «Recover» i stedet for å lage ny). Utrullingen eier tilgangslisten på boksen; tilganger lagt til i portalen forsvinner ved neste utrulling (Ståle trenger ikke lese verdiene i boksen, de ligger i GitHub). Kostnad: tilnærmet null (betaling per 10 000 oppslag; appen leser ved oppstart). Punktet «Nøkkelboks for hemmeligheter (fase 0b)» under «Hva som ikke er med ennå» byttes med «Nøkkelboksen er bygget, av til Ståle slår den på (`ENABLE_KEY_VAULT`)».
   - `docs/05-domenemodell.md` ved `secret_ref`: én setning: navnet er navnet på miljøvariabelen; i Azure fylles miljøvariabelen fra nøkkelboksen ved oppstart, i utvikling fra `.env`; navnet i boksen finnes bare i Bicep. Ordlisten (avsnitt 8) får raden «nøkkelboks» hvis den mangler.
   - `docs/06-arkitektur.md` regel 8: én setning ved `readSecret` (miljøvariabler lokalt; i Azure fylles de fra nøkkelboksen ved oppstart).
   - `docs/adr/0002-testmiljo-azure.md`: én linje under «kjente avveininger» som peker til ADR 0005.
   - Spørsmål nr. 9 i `docs/09-apne-sporsmal.md` får merknaden «nøkkelboksen er bygget (PR), slås på av Ståle».
9. **Tester** (se «Akseptkriterier» og testplanen): statiske tester i `tests/deploy-workflow.test.ts` på Bicep, arbeidsflyten og CI, enhetstester for `secret-reference.ts`, `readSecret` og `env.ts`. `ALLOWED_VARS` i testen får `ENABLE_KEY_VAULT`.
10. **Versjon** `package.json` 0.2.58.

**Ikke med (bevisst utelatt):**

- **Å slå på noe i Azure.** Bryteren er av, ingen ressurs lages, ingen kostnad. Ståle slår på selv (føres under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`).
- Egen kodevei mot Key Vault (REST-klient, `SECRETS_DRIVER`, `@azure/keyvault-secrets`). Trengs ikke når App Service løser referansene. Blir det nødvendig senere (for eksempel hemmeligheter per organisasjon lagt inn fra admin-skjermen), er det en egen oppgave; `readSecret` er stedet.
- Synknøklene gjennom boksen (punkt 4).
- Tilgangslogg for boksen (diagnostikk til Log Analytics koster penger; valgfritt punkt for Ståle).
- Lesetilgang for Ståle selv i boksen (ville kreve hans objekt-id som GitHub-variabel; verdiene ligger i GitHub).
- Hemmeligheter per organisasjon lagt inn fra admin-skjermen (fase 3, sammen med tilkoblinger for regnskap).
- Tofaktor (fase 4), privat nettverk mellom app og database, egen databasebruker for appen (står i «Hva som ikke er med ennå»).
- Fjerning av GitHub-secrets som kilde (steg to, etter at Ståle har sett at boksen virker; beskrives i ADR-en).
- Rotasjon av hemmeligheter, utløpsdatoer, varsler.
- Endringer i `.env.example` (ingen ny variabel; annen kjøring i filen), `src/shared/lib/logger.ts`, `src/core/integrations/connections.ts`, `src/core/email`, `src/core/files` (se «Hensyn»).
- Nøkkelboks for produksjon (eget miljønavn, samme mal; produksjon rulles ut av Ståle).

## Avgjørelser etter runde 1 (prosjektlederen 03.11.2026)

| Uenighet | Avgjort | Hvorfor |
|---|---|---|
| Synknøklene i boksen (arkitekt og sikkerhet: med, med vakt i `offline-trial`; forenkler: ut) | **Ut** | Synktjenestene skal fjernes (ADR 0004). Fire brytersammensetninger for kode som trolig slettes. Når de aldri blir referanser, trengs ingen vakt i `offline-trial`. Én setning i ADR-en. |
| Identiteten betinget (forenkler) eller alltid på (arkitekt) | **Alltid på** | Gratis, ingen ressurs; betinget identitet får ny id hver gang og bryter tilgangen. |
| Hvor vakten ligger (sikkerhet: i `env.ts`; arkitekt: egen fil i `shared`) | **Egen fil `src/shared/config/secret-reference.ts`** | `shared` kan ikke importere fra `core`, og `core` skal ikke importere hele `env.ts`. Én kopi. |
| Hvilke felt i `env.ts` (sikkerhet: fire; arkitekt: to) | **To** (`DATABASE_URL`, `BETTER_AUTH_SECRET`) | De to er de eneste som ellers ville bli godtatt som nøkkel. `MS_GRAPH_CLIENT_SECRET` dekkes av `readSecret`; synknøklene går ikke gjennom boksen. |
| Bicep-`output` med boksens navn (arkitekt: ja; forenkler: nei) | **Nei** | Ingen leser det. |
| Logger-test (test-leder C7) | **Kuttet** | Referanseteksten er ikke hemmelig; feilen fra `readSecret` har bare navnet. Testen på `readSecret` sjekker at meldingen ikke har adressen. |
| `az bicep build` i Vitest | **Kuttet**; CI sin jq-sjekk utvides | `az` finnes ikke i Vitest. CI-jobben er sjekken av den bygde malen. |
| Tilgangspolicy eller RBAC | **Policy, egen ressurs `add`** | Krever ingenting nytt av Ståle; unngår sirkel i Bicep. |
| «Tilgangslogg» og «bare TLS 1.2» i kortet | **Tatt ut** | Koster penger (diagnostikk) / finnes ikke som egenskap. |

## Hensyn (fra oppgaveteksten)

- Branchen `fase0b-smafunn-filtjeneste-tilkobling` (annen kjøring) endrer `src/core/integrations/connections.ts`, `src/core/email`, `src/core/files`, `src/shared/lib/logger.ts` og `.env.example`. Denne oppgaven rører **ingen** av dem. Den rører `secrets.ts` (ikke `connections.ts`), `env.ts`, ny `secret-reference.ts`, Bicep, arbeidsflytene, tester og dokumenter.
- Ingen hemmeligheter i repoet, heller ikke i tester: oppdiktede verdier merkes tydelig som ikke hemmelige.

## Tilgang

Ingen nye rettigheter i appen. Ingen skjerm. Ingen fil i `src/core/access` røres. Tilgangen til nøkkelboksen gjelder appens identitet (bare `get`) og Ståle i Azure-portalen.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

## Data

Ingen nye tabeller, ingen migrering. `secret_ref` på `integration_connections` er uendret: bare navnet på miljøvariabelen (`/^[A-Z][A-Z0-9_]{1,127}$/`). Navnet i boksen avledes bare i Bicep og finnes aldri i kode eller database. Domenemodellen får presiseringen i omfang 8.

## Skjermer

Ingen.

## Regler

Ingen.

## Akseptkriterier

**Infrastruktur (statiske tester i `tests/deploy-workflow.test.ts`, bygger på hjelperne som finnes der):**

- [ ] A1: `main.bicep` har `param enableKeyVault bool = false`.
- [ ] A2: Alle ressurser av typen `Microsoft.KeyVault/` har `= if (enableKeyVault` (boksen, policyen `add`, og de tre hemmelighetene `database-url`, `better-auth-secret`, `ms-graph-client-secret`); med bryteren av finnes ingen ny ubetinget ressurstype (eksisterende test).
- [ ] A3: App Service har `identity: { type: 'SystemAssigned' }`, ubetinget.
- [ ] A4: Policyen gir bare `secrets: ['get']` (ingen `list`, `set`, `delete`, `purge`, `keys`, `certificates`), det finnes ingen `roleAssignments`-ressurs, og `app.identity.principalId` forekommer bare i policy-ressursen.
- [ ] A5: Med bryteren på nevner verdien (direkte eller via `var`, `resolvesTo`) til `DATABASE_URL`, `BETTER_AUTH_SECRET` og `MS_GRAPH_CLIENT_SECRET` både `enableKeyVault` og `@Microsoft.KeyVault(SecretUri=`; `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MAIL_FROM`, `BETTER_AUTH_URL`, `POWERSYNC_JWT_SECRET` og `ELECTRIC_SECRET` gjør det ikke.
- [ ] A6: Med bryteren av bruker de tre innstillingene samme verdi som før (`databaseUrl`, `betterAuthSecret`, `msGraphClientSecret`).
- [ ] A7: Boksen har `enableSoftDelete: true`, `enablePurgeProtection: true`, `enableRbacAuthorization: false`, `name: 'standard'`, `accessPolicies: []`, og ingen `privateEndpoint` eller `networkAcls` med `Deny`.
- [ ] A8: Ingen ny `output`; ingen `output` inneholder en `@secure()`-parameter eller en variabel bygget av en (`resolvesTo`), og ingen nevner `vault.azure.net` eller `secretUri`.
- [ ] A9: `ci.yml` krever `parameters('enableKeyVault')` i `condition` på alle `Microsoft.KeyVault/`-ressurser i den bygde malen.
- [ ] A10: Navnene på hemmelighetene i boksen er små bokstaver, tall og bindestrek.
- [ ] CI-jobben «Bicep for testmiljøet» er grønn (bygg og lint; fanger også en eventuell sirkel i avhengighetene).

**Arbeidsflyten (statisk):**

- [ ] B1: `deploy-azure.yml` setter `enableKeyVault=` fra `vars.ENABLE_KEY_VAULT == 'true'` i parameterne til både validering og utrulling (samme mønster som `ENABLE_SYNC_TRIAL`).
- [ ] B2: Ingen `set -x` og ingen `echo` av hemmeligheter i nye eller endrede steg (eksisterende test).
- [ ] B3: `ALLOWED_VARS` har `ENABLE_KEY_VAULT`, og `docs/drift/testmiljo-azure.md` nevner variabelen (eksisterende tester).

**Kode (Vitest):**

- [ ] C1: `isUnresolvedSecretReference` er sann for `@Microsoft.KeyVault(SecretUri=https://kv-x.vault.azure.net/secrets/x/)` og `@Microsoft.KeyVault(VaultName=kv-x;SecretName=x)`, også med mellomrom foran og annen bokstavstørrelse; usann for en vanlig verdi som bare inneholder «KeyVault» inni, og for tom streng.
- [ ] C2: `readSecret("MS_GRAPH_CLIENT_SECRET")` med en uløst referanse (begge formene) kaster `SecretNotFoundError`; meldingen inneholder navnet og verken `@Microsoft.KeyVault`, `vault.azure.net` eller `https://`. Vanlige verdier leses som før (eksisterende tester i `secrets.test.ts` grønne).
- [ ] C3: `getEnv()` avviser `BETTER_AUTH_SECRET` som uløst referanse (lengre enn 32 tegn, så dagens skjema ville godtatt den) med melding som inneholder «BETTER_AUTH_SECRET» og ikke adressen; samme for `DATABASE_URL`. Gyldige verdier godtas som før (`resetEnvCache` mellom).
- [ ] Bruker i annen organisasjon får ikke tilgang (test): ikke relevant, ingen ny spørring og ingen ny tabell. `tests/tenant-isolation-all-tables.test.ts` er uendret og grønn.
- [ ] Virker på iPad-størrelse (e2e): ingen skjerm. e2e kjøres som vanlig og er grønn.

**Dokumenter (statisk, describe «dokumentasjon for nøkkelboksen»):**

- [ ] D1: ADR 0005 finnes og nevner App Service-referanser, av som standard, GitHub-secrets som kilde, RBAC som steg mot produksjon, omstart etter første utrulling, purge-beskyttelse og 90 dager, og at Optiplans oppsett er en antakelse.
- [ ] D2: `testmiljo-azure.md` har avsnittet «Nøkkelboks for hemmeligheter» (slå på, hakemerke, omstart, slå av, «Recover»), og punktet under «Hva som ikke er med ennå» er byttet.
- [ ] D3: ADR 0002 peker til ADR 0005; domenemodellen ved `secret_ref` nevner nøkkelboksen; regel 8 i arkitekturen er oppdatert; spørsmål nr. 9 har merknaden.
- [ ] Punktet er krysset av i `docs/07-utviklingsplan.md` med «bare kode, av som standard, Ståle slår på».
- [ ] Det Ståle gjør selv står under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`: slå på `ENABLE_KEY_VAULT`, kjøre utrullingen, se grønt hakemerke, starte appen på nytt hvis rødt, se at innlogging virker; valgfritt: slå på diagnostikk for boksen (koster litt); bekrefte om Optiplan gjør det likt; om GitHub-secrets skal fjernes som kilde (steg to).
- [ ] Beslutningen føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte», neste ledige A-nummer): Key Vault-referanser på App Service, av som standard, tilgangspolicy med bare `get`, GitHub-secrets som kilde i første omgang, synknøklene utenfor.

**Kan ikke testes automatisk (Ståle sjekker selv):** at App Service faktisk løser referansene (grønt hakemerke under Configuration), og at appen starter og innloggingen virker med bryteren på.

## Roller

- **forenkler:** runde 1 levert; runde 2 sjekker at bygget holder seg til kortet (ingen output, ingen logger-endring, ingen `.env.example`).
- **arkitekt:** skriver ADR 0005 (omfang 8) i runde 2, og sjekker Bicep-strukturen (policy som egen ressurs, `secretUri` uten versjon).
- **sikkerhet-personvern:** går gjennom at verdien aldri lekker (Bicep-utdata, utrullingslogg, `readSecret`, `env.ts`), at identiteten bare kan lese, at `principalId` ikke brukes andre steder, og at ingenting slås på.
- **test-leder:** skriver `docs/funksjoner/fase0b-nokkelboks-testplan.md` etter akseptkriteriene A1–A10, B1–B3, C1–C3, D1–D3.
- **utvikler:** Bicep, arbeidsflytene (`deploy-azure.yml`, `ci.yml`), `secret-reference.ts`, `secrets.ts`, `env.ts`, dokumentene utenom ADR-en, versjonen.
- **testskriver:** testene (Bicep statisk, CI-sjekken, `secret-reference.ts`, `readSecret`, `env.ts`, dokumenter).

Ikke med: ux-ansvarlig og ui-designer (ingen skjerm), fagansvarlig (ingen fagstoff).

## Deling i biter (uavhengige, i parallell)

- **Utvikler:** omfang 1–7, 8 (utenom ADR 0005) og 10.
- **Arkitekt:** ADR 0005.
- **Testskriver:** omfang 9 etter testplanen; testene skrives mot grensesnittet i akseptkriteriene (`isUnresolvedSecretReference` i `src/shared/config/secret-reference.ts`, `readSecret` kaster `SecretNotFoundError`, `getEnv` kaster ved uløst referanse, Bicep-tekst med `enableKeyVault`).

## Åpne spørsmål

- Ingen som stopper PR-en. Til Ståle når han er tilbake (føres i tilstandsfilen): slå på `ENABLE_KEY_VAULT` i testmiljøet og se at appen starter og innloggingen virker; valgfritt slå på diagnostikk for boksen (koster litt); bekrefte om Optiplan bruker Key Vault på samme måte (ADR 0002 og 0005 er antakelser); om GitHub-secrets skal fjernes som kilde etterpå (steg to).
