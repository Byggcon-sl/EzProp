# ADR 0005 – Nøkkelboks for hemmeligheter: Azure Key Vault med referanser fra App Service, av som standard

Dato: 03.11.2026. Status: vedtatt av agentene i autonom modus, bare testmiljøet; Ståle slår bryteren på selv. Oppgavekort: `docs/funksjoner/fase0b-nokkelboks.md`. Bygger på ADR 0002 (testmiljøet) og tilkoblingslaget i PR #64 (`readSecret`).

Støtter hovedmålet **reklamasjoner** (trygg drift): hemmelighetene ligger i én låst boks, ikke i klartekst i appinnstillingene der alle med lesetilgang til ressursgruppen ser dem (spørsmål nr. 9). **Tid** for Ståle: hemmeligheten legges inn ett sted. **KI først:** nei, men KI-nøklene i fase 2 og 3 går samme vei (`readSecret`).

## Viktig antakelse

Som i ADR 0002 var Optiplans oppsett ikke tilgjengelig. At Optiplan bruker Key Vault med referanser fra App Service er en antakelse Ståle kan sammenligne; avvik rettes i egen PR.

## Beslutninger

1. **Key Vault-referanser i App Service, ingen egen kodevei.** Bryteren på: appinnstillingene `DATABASE_URL`, `BETTER_AUTH_SECRET` og `MS_GRAPH_CLIENT_SECRET` får verdien `@Microsoft.KeyVault(SecretUri=…)` (uten versjon, så ny verdi virker ved neste utrulling uten endring i innstillingene). App Service henter verdiene ved oppstart, og de kommer inn som vanlige miljøvariabler. `readSecret` er uendret og eneste vei, og `env.ts` leser som før. Ingen `SECRETS_DRIVER`, ingen REST-klient, ingen ny avhengighet.
2. **Av som standard.** `enableKeyVault bool = false` i `infra/azure/main.bicep`, styrt av GitHub-variabelen `ENABLE_KEY_VAULT` (bare nøyaktig `true` slår på; samme mønster som `ENABLE_SYNC_TRIAL`, ADR 0003). Alle `Microsoft.KeyVault/*`-ressurser har `= if (enableKeyVault …)`. En merge til `main` lager ingen ny ressurs og koster ingenting.
3. **GitHub-secrets er fortsatt kilden.** Ståle legger hemmeligheten inn ett sted (GitHub). Utrullingen skriver den inn i boksen som `Microsoft.KeyVault/vaults/secrets` (`database-url`, `better-auth-secret`, `ms-graph-client-secret`; navnene i boksen finnes bare i Bicep). **Steg to**, etter at Ståle har sett at boksen virker: hemmelighetene legges direkte i boksen, GitHub-secrets fjernes og utrullingen slutter å skrive dem. Da endres bare Bicep og arbeidsflyten; appen merker ingenting.
4. **Systemtildelt identitet på appen, alltid på.** Gratis og ingen ressurs i ressursgruppen. Betinget identitet ville fått ny id hver gang bryteren slås av og på, og tilgangen måtte lages på nytt.
5. **Tilgang som tilgangspolicy med bare `get`, egen ressurs.** `Microsoft.KeyVault/vaults/accessPolicies` med navn `add` gir appens identitet `secrets: ['get']` og ingenting annet. Policy, ikke RBAC: rolletildeling krever Owner eller User Access Administrator, altså noe nytt fra Ståle, mens GitHub-innloggingen (Contributor) kan skrive policyer. Egen ressurs fordi boksen og appen ellers avhenger av hverandre i en sirkel (innstillingene peker på boksen, policyen peker på appen). Utrullingen eier tilgangslisten; tilganger lagt til i portalen forsvinner ved neste utrulling.
6. **Boksen:** `kv-ezprop-<miljø>`, `standard`, myk sletting og purge-beskyttelse på (kan ikke slås av igjen; slettes boksen, er navnet låst i 90 dager, bruk «Recover»), ingen `networkAcls` med `Deny`. Ingen ny `output` (ingen leser boksens navn, og færre utdata er mindre å vokte).
7. **Vakt mot uløste referanser, ett sted.** Får ikke App Service hentet verdien (identiteten mangler tilgang, boksen er borte), står referanseteksten igjen som verdi. `isUnresolvedSecretReference` i `src/shared/config/secret-reference.ts` kjenner den igjen (begge formene App Service bruker). `readSecret` kaster da `SecretNotFoundError` (bare navnet i meldingen), og `env.ts` stopper appen ved start for `DATABASE_URL` og `BETTER_AUTH_SECRET` uten å gjenta verdien eller adressen. Ligger i `shared` fordi `shared` aldri importerer fra `core`, og `core` ikke skal importere hele `env.ts`.
8. **Rekkefølge ved første utrulling.** Policyen lages etter appen, og App Service løser referansene ved oppstart. Referansene kan derfor stå røde under Configuration etter første utrulling; da startes appen på nytt (står i `docs/drift/testmiljo-azure.md`).
9. **Synknøklene (`POWERSYNC_JWT_SECRET`, `ELECTRIC_SECRET`) går ikke gjennom boksen.** De legges i boksen hvis synktjenesten blir værende etter ADR 0004.

## Kostnad

Tilnærmet null (betaling per 10 000 oppslag; appen leser ved oppstart). Med bryteren av: 0 kr.

## Forkastet

- **Egen kodevei mot Key Vault** (REST med `fetch` eller `@azure/keyvault-secrets`). Mer kode og en avhengighet for noe plattformen gjør gratis, og to veier til samme hemmelighet. Blir hemmeligheter per organisasjon lagt inn fra admin-skjermen (fase 3), er det en egen oppgave; `readSecret` er stedet. Vurdert på nytt 03.11.2026 som «steg 2» og utsatt til den første tilkoblingen som trenger en hemmelighet som ikke er kjent ved utrulling (A50, `docs/funksjoner/fase0b-nokkelboks-kodevei.md`).
- **RBAC i test.** Krever rettigheter Ståle må gi. Steg mot produksjon sammen med privat nettverk (ADR 0002, «Minimum før ekte data»).
- **Container Apps-secrets.** Appen kjører på App Service, ikke i Container Apps.
- **Hemmeligheter lagt direkte i boksen nå.** Ståle er borte, og utrullingen skal virke uten manuelle steg i portalen. Steg to.
- **Betinget identitet.** Ny id hver gang bryteren slås av og på.
- **Diagnostikk til Log Analytics for boksen.** Koster penger; valgfritt for Ståle.

## Konsekvenser

- Ingen migrering, ingen ny tabell, ingen ny avhengighet, ingen skjerm. `secret_ref` er fortsatt bare navnet på miljøvariabelen.
- Ståle slår på selv (`ENABLE_KEY_VAULT`), ser grønt hakemerke under Configuration, og starter appen på nytt hvis referansene er røde. Står under «Trenger Ståle når han er tilbake» i `docs/agenter/tilstand.md`.
- Før produksjon: RBAC, privat nettverk og steg to (boksen som eneste kilde). Egen ADR.
