# Funksjon: Nøkkelboks for hemmeligheter

- **Fase:** 0b (Innlogging og sikkerhet)
- **Modul:** kjerne (`src/core/integrations/secrets.ts`, `src/shared/config/env.ts`) og infrastruktur (`infra/azure/main.bicep`, `.github/workflows/deploy-azure.yml`)
- **Status:** utkast (oppgavekort laget av prosjektlederen 03.11.2026, autonom modus)
- **Branch:** `fase0b-nokkelboks` fra `main`. Versjon **0.2.58** (én patch over `main` 0.2.57; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch).
- **Planpunkt:** «Nøkkelboks for hemmeligheter (for eksempel Azure Key Vault, samme oppsett som Optiplan). Ingen nøkler i koden eller databasen, bare navnet på hemmeligheten (`secret_ref`). (Innspill P12)»
- **Støtter hovedmål:**
  - **Reklamasjoner (trygg drift):** hemmelighetene (databasepassord, innloggingsnøkkel, klienthemmeligheten for e-post) ligger i én låst boks med tilgangslogg, ikke som klartekst i appinnstillingene der alle med lesetilgang til ressursgruppen ser dem (spørsmål nr. 9). En nøkkel på avveie er en reklamasjon og et personvernbrudd på én gang.
  - **Tid (for Ståle):** hemmeligheten legges inn ett sted. Utrullingen legger den i nøkkelboksen, og appen henter den derfra. Ingen manuell kopiering til appinnstillinger, Container Apps eller andre steder når flere tjenester kommer (fillagring, KI, regnskap).
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

1. **Nøkkelboksen i Bicep, av som standard.** Ny parameter `enableKeyVault bool = false` i `infra/azure/main.bicep`, satt fra GitHub-variabelen `ENABLE_KEY_VAULT` i `deploy-azure.yml` (nøyaktig `true` betyr på, alt annet av; samme mønster som `ENABLE_SYNC_TRIAL`). Med bryteren av skal den bygde malen være uendret i virkning: ingen nye ressurser, samme appinnstillinger som i dag. Med bryteren på lages ett Key Vault i Sweden Central (navn `kv-ezprop-<miljø>`, standard-SKU, myk sletting på, purge-beskyttelse på, bare TLS 1.2).
2. **Appen får systemtildelt identitet** (`identity: { type: 'SystemAssigned' }` på App Service). Identiteten får **bare lese hemmeligheter** (`get`), aldri liste, skrive eller slette. Arkitekten velger mellom tilgangspolicy på boksen (virker med rettighetene GitHub-innloggingen har i dag, Contributor på ressursgruppen) og RBAC-rollen «Key Vault Secrets User» (krever at Ståle gir GitHub-innloggingen rett til å tildele roller, én gang). Foretrukket: **det som ikke krever noe nytt av Ståle** i test; RBAC noteres som steg for produksjon i ADR-en.
3. **Hemmelighetene går gjennom boksen når bryteren er på.** Utrullingen legger verdiene fra GitHub-secrets inn i boksen (Bicep-ressursen `vaults/secrets`), og appinnstillingene viser til boksen med Key Vault-referanse (`@Microsoft.KeyVault(SecretUri=…)`) i stedet for verdien. Dette gjelder alle verdier som i dag kommer fra `@secure()`-parametere: `DATABASE_URL` (inneholder passordet), `BETTER_AUTH_SECRET`, `MS_GRAPH_CLIENT_SECRET` (når e-post er satt opp) og synknøklene (når synkbryteren er på). Verdier som ikke er hemmelige (`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MAIL_FROM`, `BETTER_AUTH_URL`) står som før. App Service løser referansene ved oppstart, så verdiene kommer inn som vanlige miljøvariabler, og **`readSecret` er uendret og eneste vei**. Ingen egen kodevei mot Key Vault (ingen `SECRETS_DRIVER`, ingen REST-klient, ingen ny avhengighet). Det er det enkleste som virker, fordi appen kjører på App Service, ikke i Container Apps (oppgaveteksten nevnte Container Apps-secrets; mønsteret er det samme, bare med App Service sin referanseform).
4. **Vakt mot referanser som ikke er løst.** Når App Service ikke får hentet en hemmelighet (identitet mangler tilgang, boksen er borte), står referanseteksten `@Microsoft.KeyVault(…)` igjen som verdi i miljøvariabelen. Da skal:
   - `readSecret` kaste `SecretNotFoundError` med bare navnet (meldingen sier at hemmeligheten ikke ble hentet fra nøkkelboksen), aldri gi referanseteksten videre som verdi;
   - `env.ts` stoppe appen ved start med en norsk melding som nevner variabelnavnet hvis `BETTER_AUTH_SECRET` eller `DATABASE_URL` begynner med `@Microsoft.KeyVault(` (i dag ville en uløst referanse på 32+ tegn bli godtatt som nøkkel). Meldingen inneholder aldri verdien.
5. **Verdien står aldri i logg, feilmelding, database eller utdata.** Bicep-utdata (`output`) får ingen nye hemmeligheter (bare boksens navn når den finnes). Utrullingsloggen skriver bare navn. Loggeren vasker alt `readSecret` kan kaste. Rør `src/shared/lib/logger.ts` bare hvis en test viser at referanseteksten eller en ny verdi slipper gjennom (en annen kjøring jobber i den filen; se «Hensyn» under).
6. **Dokumentasjon:**
   - **ADR 0005** i `docs/adr/` (kort): hvorfor Key Vault-referanser på App Service og ikke egen kodevei, hvorfor av som standard, hvorfor GitHub-secrets fortsatt er kilden (Ståle legger inn ett sted; boksen fylles av utrullingen), hva som endres når hemmelighetene senere skal legges direkte i boksen (GitHub-secrets fjernes, utrullingen slutter å skrive), og RBAC og privat nettverk som steg mot produksjon. Nevner at Optiplans oppsett ikke var tilgjengelig (som ADR 0002), så dette er en antakelse Ståle kan sammenligne.
   - `docs/drift/testmiljo-azure.md`: nytt avsnitt «Nøkkelboks for hemmeligheter» med hva Ståle gjør selv (sett `ENABLE_KEY_VAULT` til `true`, kjør utrullingen, sjekk i portalen at appinnstillingene viser et grønt hakemerke på referansene; slå av: sett variabelen til noe annet og kjør utrullingen, boksen slettes ikke av utrullingen og må slettes i portalen hvis den skal bort; myk sletting holder den 90 dager). Kostnad: tilnærmet null (betaling per 10 000 oppslag; appen leser ved oppstart). Fjern punktet under «Hva som ikke er med ennå» og erstatt det med «Nøkkelboksen er bygget, av til Ståle slår den på».
   - `docs/05-domenemodell.md` ved `secret_ref`: navnet er navnet på miljøvariabelen; i Azure er miljøvariabelen en referanse til nøkkelboksen, i utvikling en verdi i `.env`. Ordlisten (avsnitt 8) får raden «nøkkelboks» hvis den mangler.
   - `docs/06-arkitektur.md` regel 8: setningen om `readSecret` oppdateres (miljøvariabler lokalt; i Azure fylles de fra nøkkelboksen ved oppstart).
   - `docs/adr/0002-testmiljo-azure.md`: én linje under «kjente avveininger» som peker til ADR 0005.
   - `.env.example`: én til to kommentarlinjer ved `MS_GRAPH_CLIENT_SECRET` om at nøkkelboksen i Azure fyller miljøvariabelen (ingen ny variabel, ingen `SECRETS_DRIVER`). Hold endringen minst mulig (annen kjøring i filen).
   - Spørsmål nr. 9 i `docs/09-apne-sporsmal.md` får merknaden «nøkkelboksen er bygget (PR), slås på av Ståle».
7. **Tester** (se «Akseptkriterier»): statiske tester i `tests/deploy-workflow.test.ts` på Bicep og arbeidsflyten, enhetstester for `readSecret` og `env.ts`. CI-jobben «Bicep for testmiljøet» bygger og linter malen som før.
8. **Versjon** `package.json` 0.2.58.

**Ikke med (bevisst utelatt):**

- **Å slå på noe i Azure.** Bryteren er av, ingen ressurs lages, ingen kostnad. Ståle slår på selv (føres under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`).
- Egen kodevei mot Key Vault (REST-klient, `SECRETS_DRIVER`, `@azure/keyvault-secrets`). Trengs ikke når App Service løser referansene. Blir det nødvendig senere (for eksempel hemmeligheter per organisasjon som legges inn fra admin-skjermen), er det en egen oppgave; `readSecret` er stedet.
- Hemmeligheter per organisasjon lagt inn fra admin-skjermen (fase 3, sammen med tilkoblinger for regnskap).
- Tofaktor (fase 4), privat nettverk mellom app og database, egen databasebruker for appen (står i «Hva som ikke er med ennå»).
- Fjerning av GitHub-secrets som kilde (steg to, etter at Ståle har sett at boksen virker; beskrives i ADR-en).
- Rotasjon av hemmeligheter, utløpsdatoer på hemmeligheter, varsler.
- Endringer i `src/core/integrations/connections.ts`, `src/core/email`, `src/core/files` (en annen kjøring jobber der; se «Hensyn»).
- Nøkkelboks for produksjon (eget miljønavn, samme mal; produksjon rulles ut av Ståle).

## Hensyn (fra oppgaveteksten)

- Branchen `fase0b-smafunn-filtjeneste-tilkobling` (annen kjøring) endrer `src/core/integrations/connections.ts`, `src/core/email`, `src/core/files`, `src/shared/lib/logger.ts` og `.env.example`. Denne oppgaven rører **bare** `secrets.ts` (ikke `connections.ts`), `env.ts`, Bicep, arbeidsflyten, tester og dokumenter, pluss minst mulig i `.env.example`. `logger.ts` røres bare hvis en test viser lekkasje.
- Ingen hemmeligheter i repoet, heller ikke i tester: oppdiktede verdier merkes tydelig som ikke hemmelige.

## Tilgang

Ingen nye rettigheter i appen. Ingen skjerm. Tilgangen til nøkkelboksen gjelder appens identitet (bare `get`) og Ståle i Azure-portalen.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

## Data

Ingen nye tabeller, ingen migrering. `secret_ref` på `integration_connections` er uendret: bare navnet. Domenemodellen får presiseringen i omfang 6.

## Skjermer

Ingen.

## Regler

Ingen.

## Akseptkriterier

**Infrastruktur (statiske tester i `tests/deploy-workflow.test.ts`, bygger på hjelperne som finnes der):**

- [ ] `main.bicep` har parameteren `enableKeyVault` med standard `false`, og `deploy-azure.yml` setter den fra `vars.ENABLE_KEY_VAULT == 'true'` (samme form som `enableSyncTrial`).
- [ ] Key Vault-ressursen og hemmelighetene i den er betinget av `enableKeyVault`; med bryteren av finnes ingen `Microsoft.KeyVault`-ressurs i den bygde malen. (Bygg med `az bicep build` der det er tilgjengelig; ellers statisk sjekk av `if (enableKeyVault)` på hver Key Vault-ressurs.)
- [ ] App Service har `identity.type = 'SystemAssigned'`. Identiteten får bare `get` (tilgangspolicy) eller bare rollen «Key Vault Secrets User» (RBAC), aldri `list`, `set` eller `delete`.
- [ ] Med bryteren på viser appinnstillingene `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MS_GRAPH_CLIENT_SECRET` (når e-post er satt) og synknøklene (når synk er på) til boksen med `@Microsoft.KeyVault(SecretUri=`, og verdien står ikke i innstillingen. Med bryteren av er innstillingene som i dag.
- [ ] Ingen `output` i Bicep inneholder en `@secure()`-parameter eller en variabel som bygges av en (hjelperen `resolvesTo` i testen). Utrullingsloggen skriver bare navn.
- [ ] Boksen har myk sletting og purge-beskyttelse på, og `publicNetworkAccess` som i dag (ingen privat nettverk; «ikke med»).
- [ ] CI-jobben «Bicep for testmiljøet» er grønn (bygg og lint).

**Kode (Vitest):**

- [ ] `readSecret("MS_GRAPH_CLIENT_SECRET")` med verdien `@Microsoft.KeyVault(SecretUri=https://kv-x.vault.azure.net/secrets/x/)` kaster `SecretNotFoundError`; meldingen inneholder navnet og aldri referanseteksten eller noen adresse. Vanlige verdier leses som før (eksisterende tester i `secrets.test.ts` er grønne).
- [ ] `env.ts` avviser `BETTER_AUTH_SECRET` og `DATABASE_URL` som begynner med `@Microsoft.KeyVault(` med en norsk melding som nevner variabelnavnet, ikke verdien. Gyldige verdier godtas som før.
- [ ] Loggeren vasker en feilmelding fra `readSecret` slik at ingen verdi vises (eksisterende tester i `logger.test.ts` dekker navn; én ny test bare hvis referanseteksten slipper gjennom).
- [ ] Bruker i annen organisasjon får ikke tilgang (test): ikke relevant, ingen ny spørring og ingen ny tabell. `tests/tenant-isolation-all-tables.test.ts` er uendret og grønn.
- [ ] Virker på iPad-størrelse (e2e): ingen skjerm. e2e kjøres som vanlig og er grønn.

**Dokumenter:**

- [ ] ADR 0005 finnes, og `docs/drift/testmiljo-azure.md`, `docs/05-domenemodell.md`, `docs/06-arkitektur.md`, `docs/adr/0002-testmiljo-azure.md` og `.env.example` er oppdatert som i omfang 6.
- [ ] Punktet er krysset av i `docs/07-utviklingsplan.md` med «bare kode, av som standard, Ståle slår på».
- [ ] Det Ståle gjør selv står under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`.
- [ ] Beslutningen føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte», neste ledige A-nummer): Key Vault-referanser på App Service, av som standard, GitHub-secrets som kilde i første omgang.

## Roller

- **forenkler:** sjekker at omfanget er minst mulig (ingen egen kodevei, ingen nye variabler ut over bryteren).
- **arkitekt:** avgjør tilgangsform (policy eller RBAC), navn og form på referansene, og skriver ADR 0005. Bekrefter at Key Vault-referanser på App Service dekker behovet uten kode mot Key Vault.
- **sikkerhet-personvern:** går gjennom at verdien aldri lekker (Bicep-utdata, utrullingslogg, `readSecret`, `env.ts`, loggeren), at identiteten bare kan lese, og at ingenting slås på.
- **test-leder:** testplan etter akseptkriteriene; statiske Bicep-tester i `tests/deploy-workflow.test.ts`.
- **utvikler:** Bicep, arbeidsflyten, `secrets.ts`, `env.ts`, dokumentene, versjonen.
- **testskriver:** testene (Bicep statisk, `readSecret`, `env.ts`, eventuelt loggeren).

Ikke med: ux-ansvarlig og ui-designer (ingen skjerm), fagansvarlig (ingen fagstoff).

## Deling i biter (uavhengige, i parallell)

- **Utvikler:** omfang 1–6 og 8.
- **Testskriver:** omfang 7 etter testplanen; testene skrives mot grensesnittet i akseptkriteriene (`readSecret` kaster `SecretNotFoundError`, `env.ts` kaster ved uløst referanse, Bicep-tekst med `enableKeyVault`).

## Åpne spørsmål

- Ingen som stopper PR-en. Til Ståle når han er tilbake (føres i tilstandsfilen): slå på `ENABLE_KEY_VAULT` i testmiljøet og se at appen starter og innloggingen virker; bekrefte om Optiplan bruker Key Vault på samme måte (ADR 0002 og 0005 er antakelser); om GitHub-secrets skal fjernes som kilde etterpå (steg to).
