# Testplan: Nøkkelboks for hemmeligheter

- **Oppgavekort:** `docs/funksjoner/fase0b-nokkelboks.md`
- **Dato:** 03.11.2026 (runde 2, før koding, test-leder)
- **Støtter hovedmål:** reklamasjoner (ingen hemmelighet i klartekst i Azure-portalen, og en uløst referanse stopper appen i stedet for å bli brukt som nøkkel) og tid (Ståle legger inn hemmeligheten ett sted; testene viser at én bryter styrer alt).

Alt i denne oppgaven er **av som standard**. Testene kan ikke slå på noe i Azure. Derfor er testene av to slag: **statiske tester** på teksten i `main.bicep`, `deploy-azure.yml`, `ci.yml` og dokumentene (samme mønster og hjelpere som i `tests/deploy-workflow.test.ts`), og **enhetstester** for de tre kodeendringene (`secret-reference.ts`, `readSecret`, `getEnv`). Den bygde ARM-malen sjekkes bare av CI-jobben «Bicep for testmiljøet» (`az bicep build` + jq); den jobben må være grønn før godkjenning.

**Tilgang og tenant-isolasjon:** ingen ny spørring, ingen ny tabell, ingen ny rettighet, ingen fil i `src/core/access` røres. Beviset er at `tests/tenant-isolation-all-tables.test.ts` og `src/core/access/*.test.ts` er uendret (`git diff main -- tests/tenant-tables.ts tests/tenant-isolation-all-tables.test.ts src/core/access` er tom) og grønne. Admin stenges ikke ute av noe nytt. **e2e:** ingen skjerm; `pnpm test:e2e` kjøres som vanlig (pc og iPad) og skal være grønn uten endringer i `e2e/`.

**Testdata:** alle verdier er oppdiktet og tydelig ikke hemmelige, for eksempel `hemmelig-test-verdi` og adressen `https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/`. Ingen ekte boksnavn, ingen ekte id-er.

## Fem punkter utvikleren låser (form, ikke innhold; ikke blokkerende, gjør som anbefalt hvis ikke annet sies i PR-en)

Hjelperne i `tests/deploy-workflow.test.ts` ser bare på tekst. Disse fem formene gjør at testene kan være presise:

1. **Alle Key Vault-ressurser som egne `resource`-blokker på øverste nivå**, med `parent: vault` for policyen og de tre hemmelighetene (ikke nøstet inne i boksen). `resourceBlocks` finner bare blokker som starter med `resource … '<type>@<versjon>'` i kolonne 0. Navnet på hemmeligheten står som fast tekst (`name: 'database-url'`), ikke som `'${kvName}/database-url'`.
2. **Betingelsen på ressursen skrives `= if (enableKeyVault)`** og for `ms-graph-client-secret` `= if (enableKeyVault && emailConfigured)`. Testen godtar `enableKeyVault` som første ledd, med eller uten `&&`.
3. **Verdien til `DATABASE_URL`, `BETTER_AUTH_SECRET` og `MS_GRAPH_CLIENT_SECRET` er en betinget på formen `enableKeyVault ? '@Microsoft.KeyVault(SecretUri=${<ressurs>.properties.secretUri})' : <verdien som i dag>`**, med `enableKeyVault` først og dagens verdi (`databaseUrl`, `betterAuthSecret`, `msGraphClientSecret`) sist. Uttrykket står enten rett i `value:` eller i én `var` (ett nivå). Står uttrykket over flere linjer, samler testen linjene til og med `}` (innstilling) eller til neste tomme linje / neste `var` (variabel). Ikke to parallelle lister (`enableKeyVault ? [liste A] : [liste B]`); da kan testen ikke vise at bryteren av gir samme verdi som før.
4. **`secretUri`, aldri `secretUriWithVersion`.** Kortet sier «uten versjon»; testen sjekker at teksten `secretUriWithVersion` ikke finnes.
5. **Boksens navn i en `var kvName = 'kv-ezprop-${environmentName}'`**, slik at den eksisterende testen «ressursnavn bruker environmentName» kan utvides med `kvName`.

For `output`-linjer virker ikke `resolvesTo` (den krever `:`), så testskriveren lager en liten hjelper `outputValue(line)` som tar identifikatoren etter `=` og slår opp `var`-definisjonen (test 1.8).

## Testfiler

| Kildefil | Testfil | Type |
|---|---|---|
| `infra/azure/main.bicep` | `tests/deploy-workflow.test.ts`, ny describe «nøkkelboksen i infrastrukturen (main.bicep)» | statisk |
| `.github/workflows/deploy-azure.yml` | samme fil, ny describe «nøkkelboksen i utrullingen (deploy-azure.yml)» | statisk |
| `.github/workflows/ci.yml` | samme fil, describe «Bicep i CI (ci.yml)» utvides | statisk |
| `src/shared/config/secret-reference.ts` | ny `src/shared/config/secret-reference.test.ts` | enhet + én statisk |
| `src/core/integrations/secrets.ts` | `src/core/integrations/secrets.test.ts` utvides (test 9–11) | enhet |
| `src/shared/config/env.ts` | `src/shared/config/env.test.ts` utvides | enhet |
| dokumentene (omfang 8) | `tests/deploy-workflow.test.ts`, ny describe «dokumentasjon for nøkkelboksen» | statisk |

Eksisterende tester som **må forbli grønne uten endring** (de er den egentlige vakten mot at mergen lager noe): «alle nye ressurser har betingelsen enableSyncTrial» (listen over ubetingede ressurstyper er uendret, så identiteten lager ingen ny ressurs), «alle passord og hemmeligheter er @secure() og uten standardverdi», «ingen verdier for hemmeligheter», «ingen hemmelige utdata», «appinnstillingene er riktige», «synkinnstillingene i appen er betinget». Endres noen av dem, skal PR-en si hvorfor.

## 1. Infrastruktur, describe «nøkkelboksen i infrastrukturen (main.bicep)»

`const kv = resourceBlocks(bicep).filter((r) => r.type.startsWith("Microsoft.KeyVault/"))`.

1. **bryteren finnes og er av som standard** (A1): `bicep` inneholder `param enableKeyVault bool = false`, og nøyaktig én `param enableKeyVault`.
2. **alle Key Vault-ressurser har betingelsen enableKeyVault** (A2): `kv` har nøyaktig fem blokker: én `Microsoft.KeyVault/vaults`, én `Microsoft.KeyVault/vaults/accessPolicies`, tre `Microsoft.KeyVault/vaults/secrets`. Første linje i hver matcher `/=\s*if\s*\(\s*enableKeyVault\b/`. Policyen og de tre hemmelighetene har `parent:`. (Listen over ubetingede ressurstyper sjekkes av den eksisterende testen.)
3. **appen har systemtildelt identitet, ubetinget** (A3): blokken `Microsoft.Web/sites` har `identity:` med `type: 'SystemAssigned'` (regex over flere linjer), og første linje har ikke `= if (`. `identity:` står ikke inne i en betinget variabel (teksten mellom `resource app` og blokkens `}` inneholder den).
4. **policyen gir bare get** (A4): blokken med type `…/accessPolicies` har `name: 'add'`, `objectId: app.identity.principalId`, `tenantId: subscription().tenantId`, `permissions:` med `secrets: ['get']` (regex som tåler mellomrom), og inneholder ikke `keys:`, `certificates:`, `storage:`, `'list'`, `'set'`, `'delete'`, `'purge'`, `'all'`, `'recover'`, `'backup'`, `'restore'`. `bicep` inneholder ikke `Microsoft.Authorization/roleAssignments` og ikke `roleDefinitionId`. Alle linjer i filen som inneholder `principalId` ligger innenfor policy-blokken (`start` til `start + lines.length - 1`); det finnes minst én.
5. **de tre hemmelighetene går gjennom boksen når bryteren er på** (A5): for hver av `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MS_GRAPH_CLIENT_SECRET` hentes verdien (direkte eller via én `var`, punkt 3 over) og den inneholder både `enableKeyVault` og `@Microsoft.KeyVault(SecretUri=` og `.properties.secretUri`. `bicep` inneholder ikke `secretUriWithVersion`. For hver av `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MAIL_FROM`, `BETTER_AUTH_URL`, `SEED_ADMIN_EMAIL`, `APP_VERSION`, `POWERSYNC_JWT_SECRET`, `ELECTRIC_SECRET`, `POWERSYNC_URL`, `ELECTRIC_URL` inneholder verdien verken `enableKeyVault` eller `@Microsoft.KeyVault(`.
6. **bryteren av gir samme verdi som før** (A6): de samme tre uttrykkene matcher `/enableKeyVault\s*\?[\s\S]*:\s*(databaseUrl|betterAuthSecret|msGraphClientSecret)\s*\}?\s*$/` med riktig navn for riktig innstilling, og `var databaseUrl = 'postgres://…sslmode=verify-full'` er uendret (den eksisterende testen for sertifikatsjekk).
7. **boksen er låst riktig og uten nettverk** (A7): blokken `Microsoft.KeyVault/vaults` har `enableSoftDelete: true`, `enablePurgeProtection: true`, `enableRbacAuthorization: false`, `name: 'standard'`, `family: 'A'`, `tenantId: subscription().tenantId`, `accessPolicies: []`, `location: location`, og navnet løses (`resolvesTo`) til `${environmentName}` og starter med `kv-ezprop-`. `bicep` inneholder ikke `privateEndpoint`, `privateLink`, `'Deny'` eller `enabledForDeployment: true`. Den eksisterende testen «ressursnavn bruker environmentName» får `kvName` i listen.
8. **ingen ny utdata og ingen hemmelig utdata** (A8): `output`-linjene er nøyaktig `postgresServerName`, `postgresHost`, `appName`, `appUrl` (fire, i den rekkefølgen). Ingen `output`-linje, eller `var`-en den peker på (`outputValue`), inneholder `vault.azure.net`, `secretUri`, `identity`, `principalId` eller navnet på en `@secure()`-parameter (navnene hentes fra filen som i testen «alle passord og hemmeligheter er @secure()»).
9. **navnene i boksen er små bokstaver, tall og bindestrek** (A10): `name:`-linjen i de tre `…/secrets`-blokkene matcher `/^\s*name:\s*'[a-z0-9-]+'$/`, og settet er nøyaktig `database-url`, `better-auth-secret`, `ms-graph-client-secret`. Hver `properties:` har `value:` lik henholdsvis `databaseUrl`, `betterAuthSecret`, `msGraphClientSecret` (ikke en fast tekst; den eksisterende testen «ingen verdier for hemmeligheter» dekker fast tekst).
10. **ingen hemmelighet i boksen uten bryteren og e-post** : blokken med `ms-graph-client-secret` har `emailConfigured` i betingelsen; de to andre har ikke.
11. **ingen egen kodevei og ingen ny avhengighet**: `package.json` har ikke `@azure/keyvault-secrets` eller `@azure/identity`; `src/` inneholder ikke `SECRETS_DRIVER`, `vault.azure.net` (utenom tester) eller `keyvault` i import-setninger. (Dekker «Ikke med» i kortet og regel 9.)

## 2. Arbeidsflyten, describe «nøkkelboksen i utrullingen (deploy-azure.yml)»

1. **bryteren er på bare når ENABLE_KEY_VAULT er nøyaktig true** (B1): speil av «synkbryteren er på bare når ENABLE_SYNC_TRIAL er nøyaktig true»: minst én linje `vars.ENABLE_KEY_VAULT == 'true'` eller bash `= "true"`; ingen `!=`, `contains(`, `-n` mot variabelen; `parameterSources` for både `az deployment group validate` og `az deployment group create` matcher `/enableKeyVault=/`. `ENABLE_KEY_VAULT` står i `env:` i steget «Infrastruktur (Bicep)» (`stepOf` + `subBlock(step, "env")`), ikke i `run`.
2. **ingen nye hemmeligheter og ingen nye utskrifter** (B2): `secretNames(workflow)` er uendret (nøyaktig `ALLOWED_SECRETS`); den eksisterende testen «ingen set -x og ingen echo av hemmeligheter» er grønn; ingen linje med `echo` inneholder `KEY_VAULT`, `KeyVault` eller `vault.azure.net` utenom å skrive at bryteren er på/av uten verdi.
3. **ALLOWED_VARS og driftsdokumentet** (B3): `ALLOWED_VARS` i testen blir `["SEED_ADMIN_EMAIL", "APP_HOSTNAME", "ENABLE_SYNC_TRIAL", "ENABLE_KEY_VAULT"]`; de eksisterende testene «bruker bare de dokumenterte navnene» og «driftsdokumentet nevner alle secrets og variabler» viser at variabelen brukes og er dokumentert.
4. **ingen nytt steg som leser fra boksen**: `workflow` inneholder ikke `az keyvault secret show`, `secret list` eller `--query value` (utrullingen skriver til boksen bare gjennom Bicep; ingen `az keyvault` i det hele tatt).

## 3. CI, describe «Bicep i CI (ci.yml)» (utvides)

1. **CI krever enableKeyVault på alle Key Vault-ressurser i den bygde malen** (A9): `ci` inneholder `Microsoft.KeyVault/` og `parameters('enableKeyVault')` i et jq-uttrykk i jobben med `az bicep build` (samme jobb-avgrensning som «CI bygger og linter Bicep uten innlogging»), og en tellesjekk med minst 5 (`-lt 5` eller tilsvarende) så en tom select ikke blir grønn. Jobben bruker fortsatt ingen `secrets.`.

## 4. `src/shared/config/secret-reference.test.ts`

Fasit skrevet inn i testen; `it.each`.

1. **sanne referanser** (C1): `@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/)`, `@Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)`, samme med to mellomrom foran og linjeskift bak, `@microsoft.keyvault(secreturi=https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/)` (små bokstaver), `@MICROSOFT.KEYVAULT(VaultName=x;SecretName=y;SecretVersion=z)` → `true`.
2. **usanne verdier**: `""`, `"   "`, `hemmelig-test-verdi`, `postgres://ezprop:ezprop@localhost:5432/ezprop`, `verdi med @Microsoft.KeyVault( inni`, `Microsoft.KeyVault(SecretUri=…)` (uten `@`), `@Microsoft.KeyVault` (uten parentes), `@Microsoft.KeyVaultX(` → `false`.
3. **konstanten**: `KEY_VAULT_REFERENCE_PREFIX === "@Microsoft.KeyVault("`.
4. **ett sted** (statisk): blant alle `.ts`/`.tsx`-filer under `src/` som ikke er tester, er `src/shared/config/secret-reference.ts` den eneste som inneholder teksten `Microsoft.KeyVault(`; `secrets.ts` og `env.ts` importerer `isUnresolvedSecretReference` fra `@/shared/config/secret-reference` (eller relativ sti i `shared`).

## 5. `src/core/integrations/secrets.test.ts` (utvides)

`vi.stubEnv` og `vi.unstubAllEnvs` som i dag. `REFERENCE_URI = "@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/)"`, `REFERENCE_NAME = "@Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)"`.

9. **uløst referanse regnes som mangler** (C2, `it.each` over begge formene og `"  " + REFERENCE_URI`): `MS_GRAPH_CLIENT_SECRET` satt til referansen → `SecretNotFoundError`; `message` inneholder `MS_GRAPH_CLIENT_SECRET`; `message` og `String(error)` inneholder verken `@Microsoft.KeyVault`, `vault.azure.net`, `https://`, `kv-oppdiktet` eller `SecretUri`.
10. **ugyldig navn sjekkes før referansen**: navn `lowercase` satt til referansen → `InvalidSecretRefError` (ikke `SecretNotFoundError`), og meldingen har ikke referansen.
11. **vanlige verdier leses som før**: en verdi som inneholder `KeyVault` inni (`abc-KeyVault-xyz`) og en verdi som starter med `@` men ikke er referanse (`@oppdiktet`) leses uendret. Testene 1–8 er uendret og grønne.

## 6. `src/shared/config/env.test.ts` (utvides)

`resetEnvCache()` etter hver `stubEnv`, `vi.unstubAllEnvs` i `afterEach` som i dag. Begge referanseformene er lengre enn 32 tegn, så dagens `min(32)` ville godtatt dem.

1. **BETTER_AUTH_SECRET som uløst referanse stopper oppstarten** (C3, `it.each` over `SecretUri=` og `VaultName=`): `getEnv()` kaster; `message` inneholder `BETTER_AUTH_SECRET` og `referanse til nøkkelboksen`; `message` inneholder verken `vault.azure.net`, `kv-oppdiktet`, `https://` eller `@Microsoft.KeyVault`.
2. **DATABASE_URL som uløst referanse stopper oppstarten** (C3): samme for `DATABASE_URL` (`setup-env.ts` setter den; testen overstyrer med `vi.stubEnv` og tømmer hurtiglageret).
3. **begge uløst gir melding som nevner begge**: ett kall, `message` inneholder både `BETTER_AUTH_SECRET` og `DATABASE_URL` (Zod samler alle feil).
4. **gyldige verdier godtas som før**: etter test 1–2, med `vi.unstubAllEnvs` og `resetEnvCache`, `getEnv()` kaster ikke, og `BETTER_AUTH_SECRET` er verdien fra `setup-env.ts`. En `BETTER_AUTH_SECRET` på 40 tegn som inneholder `KeyVault` inni godtas.
5. **MS_GRAPH_CLIENT_SECRET som referanse stopper ikke oppstarten**: alle fire Graph-verdier satt, klienthemmeligheten lik referansen → `getEnv()` kaster ikke (vakten for den ligger i `readSecret`, test 5.9). Dette låser kortets valg om to felt.

## 7. Dokumenter, describe «dokumentasjon for nøkkelboksen»

1. **ADR 0005 finnes og dekker valgene** (D1): `docs/adr/0005-nokkelboks-key-vault.md` finnes og inneholder `App Service`, `@Microsoft.KeyVault(`, `av som standard`, `GitHub`, `RBAC`, `start`/`omstart` (regex `/start(et|es)? (appen )?på nytt|omstart/i`), `purge`, `90 dager`, `Optiplan`, `antakelse`, `synk` (setningen om synknøklene), `ENABLE_KEY_VAULT`. Høyst 60 linjer (kortet sier maks en halv side).
2. **driftsdokumentet forklarer slå på, sjekk og slå av** (D2): `docs/drift/testmiljo-azure.md` inneholder overskriften `Nøkkelboks for hemmeligheter`, `ENABLE_KEY_VAULT`, `true`, `hakemerke`, regex for omstart som over, `Recover`, `90 dager`, `kv-ezprop-`, og en linje under «Hva som ikke er med ennå» som inneholder både `Nøkkelboks` og `ENABLE_KEY_VAULT`; ingen linje under samme overskrift inneholder `Nøkkelboks for hemmeligheter (fase 0b)`.
3. **henvisningene** (D3): `docs/adr/0002-testmiljo-azure.md` inneholder `ADR 0005`; i `docs/05-domenemodell.md` finnes en linje som inneholder `secret_ref`, `miljøvariabel` og `nøkkelboks` (regex `/n[øo]kkelboks/i`) og `Bicep`; i `docs/06-arkitektur.md` inneholder regel 8 (linjen som starter med `8. **Tilkoblinger`) `nøkkelboksen` og `oppstart`; i `docs/09-apne-sporsmal.md` inneholder raden for spørsmål nr. 9 (`/^\|\s*9\s*\|/`) `nøkkelboksen er bygget`, og en `A`-rad under «Avgjort av agentene mens Ståle var borte» inneholder `Key Vault` og `enableKeyVault` eller `ENABLE_KEY_VAULT`.

## 8. Sjekkliste for testrapporten (ikke automatisert)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; CI-jobben «Bicep for testmiljøet» grønn på PR-en (fanger sirkel i avhengighetene og `BCP318`-feil på betingede ressurser).
- `git diff main --stat` rører ikke `.env.example`, `src/shared/lib/logger.ts`, `src/core/integrations/connections.ts`, `src/core/email/`, `src/core/files/`, `src/core/access/`, `e2e/`, `src/db/`.
- Ingen ny avhengighet i `package.json` og `pnpm-lock.yaml`; versjonen er 0.2.58 (eller neste ledige patch).
- `docs/07-utviklingsplan.md`: punktet er krysset av med «bare kode, av som standard, Ståle slår på». `docs/agenter/tilstand.md`: det Ståle gjør selv står under «Trenger Ståle når han er tilbake».
- Ingen oppdiktet verdi i tester ligner en ekte adresse (`kv-oppdiktet`, ikke `kv-ezprop-test`).

**Kan ikke testes automatisk (Ståle):** at App Service løser referansene (grønt hakemerke under Configuration), og at appen starter og innloggingen virker med bryteren på.
