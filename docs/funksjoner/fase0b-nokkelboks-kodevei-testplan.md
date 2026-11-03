# Testplan: Nøkkelboks steg 2 – kilde bak `readSecret`

- **Oppgavekort:** `docs/funksjoner/fase0b-nokkelboks-kodevei.md`
- **Status:** utsatt sammen med kortet (prosjektlederen 03.11.2026, beslutning A50). Brukes når steg 2 bygges med den første tilkoblingen som trenger det; se «Tas med når steg 2 bygges» i kortet for hva som strykes.
- **Dato:** 03.11.2026 (runde 1, før koding, test-leder)
- **Støtter hovedmål:** reklamasjoner (verdien står aldri i logg, feilmelding, `last_error` eller Bicep-utdata; appen kan bare lese boksen; nektlisten gjelder også boksen) og tid (en ny tilkobling trenger ingen utrulling; testene viser at én innstilling styrer kilden og at alt er av som standard).

Alt er **av som standard**. Ingen test slår på noe i Azure, og ingen test gjør nettkall. Boksadapteren testes bare mot en **falsk klient**; den ekte `SecretClient` lages i én test (A6) men får aldri `get`. Testene er av tre slag: **enhetstester** for porten, adapterne, mellomlageret, valget av kilde og `readSecret`; **statiske tester** på `main.bicep`, `deploy-azure.yml`, `package.json`, `src/` og dokumentene (samme hjelpere som i `tests/deploy-workflow.test.ts`); og **eksisterende integrasjonstester** for e-post gjennom tilkoblingslaget (mot testdatabasen), som må være grønne med asynkron `readSecret`.

**Tilgang og tenant-isolasjon:** ingen ny spørring, ingen ny tabell, ingen ny rettighet, ingen fil i `src/core/access` røres. Beviset er at `git diff <basis> -- tests/tenant-tables.ts tests/tenant-isolation-all-tables.test.ts src/core/access src/db` er tom, og at `tests/tenant-isolation-all-tables.test.ts` og `src/core/access/*.test.ts` er grønne. Admin stenges ikke ute av noe nytt (ingen ny tilgangsregel). Basis er `fase0b-nokkelboks` så lenge PR #73 er åpen, ellers `main`. **e2e:** ingen skjerm; `pnpm test:e2e` kjøres som vanlig (pc og iPad) uten endringer i `e2e/` og uten `SECRET_STORE_DRIVER` satt, og skal være grønn (viser at standardkilden virker hele veien til innlogging).

**Testdata:** alle verdier er oppdiktet og tydelig ikke hemmelige: `hemmelig-test-verdi`, navn som `ORG_HEMMELIGHET` og `FINNES_IKKE`, adressen `https://kv-oppdiktet.vault.azure.net/` (aldri `kv-ezprop-test`). Falske feil fra «boksen» får en melding med en oppdiktet adresse og `Bearer oppdiktet-token`, slik at testene kan vise at ingenting av det lekker.

## Punkter utvikleren låser (form, ikke innhold)

Disse gjør at testene kan skrives uten nett og uten å gjette på formen. De er ikke blokkerende; gjør som anbefalt hvis ikke PR-en sier hvorfor noe annet.

1. **Testsøm for kilden.** `readSecret` kan ikke testes med driveren `azure_key_vault` mot den ekte klienten (den går mot IMDS på `169.254.169.254` og henger). Derfor eksporteres fra `secrets.ts`: `createSecretStore(env: Record<string, string | undefined>): SecretStore` (ren funksjon, samme mønster som `createFileStorage(env)` i `src/core/files/config.ts`), og `resetSecretStore(store?: SecretStore)`: uten argument glemmes kilden og lages på nytt fra `process.env` ved neste `readSecret`; med argument brukes kilden som sendes inn. Mellomlageret legges på **ut fra `store.driver`** (`azure_key_vault` → med mellomlager, `env` → uten), også for en kilde som sendes inn. Slik kan en falsk kilde som teller kall brukes for A1, A6 og A7.
2. **Miljøadapteren leser levende.** `secrets.ts` sender selve `process.env`-objektet til `createEnvSecretStore(process.env)`, ikke en kopi, og adapteren leser `env[secretRef]` ved hvert `get`. Da virker `vi.stubEnv` uten `resetSecretStore()` (A7, siste setning). `SECRET_STORE_DRIVER` og adressen leses først ved første `readSecret` etter `resetSecretStore()` (lat), ikke ved import.
3. **Mellomlageret bruker `Date.now()`** (ikke `performance.now()` eller `process.hrtime`), slik at `vi.useFakeTimers()` og `vi.advanceTimersByTime` flytter klokken. Ett `Map<string, { value: string; expiresAt: number }>`; en avvist `get` eller `undefined` skrives aldri inn. `SECRET_CACHE_TTL_MS = 5 * 60 * 1000` eksporteres.
4. **404 fra boksen gjenkjennes på `statusCode === 404` eller `code === "SecretNotFound"`** (formen `RestError` fra Azure har). Den falske klienten kaster `Object.assign(new Error("…"), { statusCode, code })`, som i `src/core/files/azure-storage.test.ts`. Tekst i `SecretStoreError` er nøyaktig «Nøkkelboksen svarte ikke for hemmeligheten <NAVN>.» og `cause` settes **ikke** (den opprinnelige feilen skal ikke henge ved).
5. **Rekkefølgen i `readSecret`:** navnesjekk (`InvalidSecretRefError`) → kilden lages hvis den mangler (`SecretStoreConfigError` kommer altså fra `readSecret`, etter navnesjekken) → mellomlager → `store.get`. `createSecretStore(env)` kaster `SecretStoreConfigError` direkte, så valget kan testes uten `readSecret`.
6. **Bicep-form:** `param secretStoreDriver string = ''` i kolonne 0; én egen `var secretStoreAppSettings = (enableKeyVault && secretStoreDriver == 'azure_key_vault') ? [ { name: 'SECRET_STORE_DRIVER', value: secretStoreDriver } { name: 'SECRET_STORE_AZURE_KEY_VAULT_URL', value: vault!.properties.vaultUri } ] : []` (samme form som `syncTrialAppSettings`), lagt sist i `concat(...)` på `appSettings`. Ikke to parallelle lister, ingen fast tekst med `vault.azure.net`.
7. **Arbeidsflyt-form:** `SECRET_STORE_DRIVER: ${{ vars.SECRET_STORE_DRIVER }}` i `env:` på steget «Infrastruktur (Bicep)», og linjen `"secretStoreDriver=$SECRET_STORE_DRIVER"` i `PARAMETERE`. Ingen bash-sammenligning (Bicep sammenligner med `== 'azure_key_vault'`), ingen `echo` av verdien.
8. **Ordet `DefaultAzureCredential` finnes ikke noe sted i `src/`**, heller ikke i kommentarer (skriv «standardlegitimasjonen» i kommentarer). `vault.azure.net` finnes ikke i produktfiler under `src/` (adressen kommer bare fra miljøet; `.env.example` og driftsdokumentet kan vise formen). Den eksisterende testen 11 «ingen egen kodevei og ingen ny avhengighet» i `tests/deploy-workflow.test.ts` **blir rød og skrives om** til sin motsats (avsnitt 2, test 1.9); PR-en sier det.
9. **Testene kaller aldri `get` på en kilde laget med den ekte klienten.** A6 sjekker bare `driver` og at konstruktøren ikke kaster.
10. **Eksporter fra `src/core/integrations/index.ts`:** `readSecret`, `resetSecretStore`, `createSecretStore`, `createEnvSecretStore`, `createAzureKeyVaultSecretStore`, `createAzureKeyVaultSecretStoreFromUrl`, `toKeyVaultSecretName`, `withSecretCache`, `SECRET_CACHE_TTL_MS`, typen `SecretStore`, `InvalidSecretRefError`, `SecretNotFoundError`, `SecretStoreError`, `SecretStoreConfigError`. (`KeyVaultClientLike` eksporteres fra adapterfilen; testene bruker `Parameters<typeof createAzureKeyVaultSecretStore>[0]` som i filtjenesten.)

## Testfiler

| Kildefil | Testfil | Type |
|---|---|---|
| `src/core/integrations/secret-store.ts` (port, miljøadapter, mellomlager) | ny `src/core/integrations/secret-store.test.ts` | enhet |
| `src/core/integrations/azure-key-vault.ts` | ny `src/core/integrations/azure-key-vault.test.ts` | enhet, falsk klient |
| `src/core/integrations/secrets.ts` (valg av kilde, `readSecret`) | `src/core/integrations/secrets.test.ts` utvides (test 12–18) | enhet |
| `src/core/integrations/static-checks.test.ts` | utvides (test 7–9) | statisk |
| `src/core/email/resolve.ts` | `src/core/email/resolve.test.ts` og `email.test.ts` uendret, grønne; én ny test 8d i `resolve.test.ts` | integrasjon (testdatabasen) |
| `infra/azure/main.bicep` | `tests/deploy-workflow.test.ts`, ny describe «nøkkelboksen som kilde i infrastrukturen (main.bicep)» | statisk |
| `.github/workflows/deploy-azure.yml` | samme fil, ny describe «nøkkelboksen som kilde i utrullingen (deploy-azure.yml)» | statisk |
| dokumentene (omfang 9) | samme fil, ny describe «dokumentasjon for nøkkelboksen som kilde» | statisk |

Eksisterende tester som **må forbli grønne uten endring** (vakten mot at mergen slår på noe): alle i describe «nøkkelboksen i infrastrukturen (main.bicep)» test 1–10, «nøkkelboksen i utrullingen (deploy-azure.yml)», «alle nye ressurser har betingelsen enableSyncTrial», «ingen hemmelige utdata», «synkinnstillingene i appen er betinget», «ingen set -x og ingen echo av hemmeligheter», `secrets.test.ts` 1–11, alle i `resolve.test.ts` og `email.test.ts`, og `static-checks.test.ts` 1–6 (særlig 4: `process.env` bare i `secrets.ts`). Eneste bevisste endring: test 11 i «nøkkelboksen i infrastrukturen» (punkt 8 over) og `ALLOWED_VARS`.

## 1. Port, miljøadapter og mellomlager, `secret-store.test.ts`

Hjelper i testen: `fakeStore(driver, values: Record<string, string | undefined>, failFor?: string[])` som teller kall per navn og avviser med en vanlig `Error("oppdiktet feil")` for navn i `failFor`.

1. **miljøadapteren leser verdien fra objektet den får**: `createEnvSecretStore({ ORG_HEMMELIGHET: "hemmelig-test-verdi" })` → `get("ORG_HEMMELIGHET")` gir verdien; `driver === "env"`.
2. **tom, manglende og uløst referanse gir undefined** (`it.each`): `""`, mangler, `@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/oppdiktet/)`, `@Microsoft.KeyVault(VaultName=kv-oppdiktet;SecretName=oppdiktet)` → `undefined`. En vanlig verdi som starter med `@` (`@oppdiktet`) leses.
3. **miljøadapteren leser levende**: samme objekt endres etter at adapteren er laget; neste `get` gir den nye verdien (ingen kopi, ingen mellomlager).
4. **porten har bare get**: `Object.keys(createEnvSecretStore({}))` er nøyaktig `["driver", "get"]` (sortert); det samme for `withSecretCache(fakeStore(...), 1000)` og for boksadapteren (avsnitt 2, test 1). Viser at ingen `set`, `list` eller `delete` finnes på porten.
5. **mellomlageret gir ett kall på to oppslag** (A7): `withSecretCache(fakeStore("azure_key_vault", { A_1: "x" }), SECRET_CACHE_TTL_MS)`; to `get("A_1")` → begge `"x"`, kilden kalt én gang. `driver` er uendret `"azure_key_vault"`.
6. **utløp etter levetiden** (A7): `vi.useFakeTimers()`; `get`, `vi.advanceTimersByTime(SECRET_CACHE_TTL_MS - 1)`, `get` → fortsatt ett kall; `advanceTimersByTime(1)`, `get` → to kall. `vi.useRealTimers()` i `afterEach`.
7. **undefined lagres ikke** (A7): kilde uten `A_1`; to `get` → to kall; så settes verdien i kildens objekt, tredje `get` gir verdien.
8. **feil lagres ikke** (A7): kilde med `failFor: ["A_1"]`; `get` avvises (samme feil som kilden ga, uendret); fjern feilen; neste `get` kaller kilden igjen og gir verdien.
9. **to navn deler ikke verdi**: `A_1` og `A_2` med ulike verdier; hver gir sin; kilden kalt én gang per navn.
10. **konstanten**: `SECRET_CACHE_TTL_MS === 300_000`.

## 2. Boksadapteren med falsk klient, `azure-key-vault.test.ts`

`createFakeKeyVaultClient(secrets: Record<string, string | undefined>, failWith?: () => unknown)` med `getSecret(name)` som teller kall (`calls: string[]`), gir `{ value }` for kjente navn, kaster `{ statusCode: 404, code: "SecretNotFound" }` for ukjente, eller `failWith()` når satt. `@azure/keyvault-secrets` importeres ikke i testen.

1. **treff gir verdien, og navnet omformes før kallet** (A4): `secrets = { "ms-graph-client-secret": "hemmelig-test-verdi" }`; `get("MS_GRAPH_CLIENT_SECRET")` → verdien; `calls` er `["ms-graph-client-secret"]` (aldri navnet med store bokstaver). `driver === "azure_key_vault"`. `Object.keys` er `["driver", "get"]`.
2. **404 gir undefined** (A4): ukjent navn → `undefined`, ett kall. Også `{ statusCode: 404 }` uten `code` og `{ code: "SecretNotFound" }` uten `statusCode` (`it.each`).
3. **tom verdi gir undefined** (A4): `{ value: "" }` og `{}` (uten `value`) → `undefined`.
4. **andre feil gir SecretStoreError uten lekkasje** (A4, `it.each` over `statusCode` 401, 403, 429, 500, og nettfeil `new Error("fetch failed")` og `Object.assign(new Error("getaddrinfo ENOTFOUND kv-oppdiktet.vault.azure.net"), { code: "ENOTFOUND" })`): feilen har en melding som inneholder `https://kv-oppdiktet.vault.azure.net/secrets/ms-graph-client-secret` og `Bearer oppdiktet-token` og `hemmelig-test-verdi`. `get` avvises med `SecretStoreError`; `message` er nøyaktig «Nøkkelboksen svarte ikke for hemmeligheten MS_GRAPH_CLIENT_SECRET.»; `message`, `String(error)` og `JSON.stringify(formatLogLine("error", "test", { error }))` (fra `@/shared/lib/logger`) inneholder verken `vault.azure.net`, `https://`, `Bearer`, `oppdiktet-token`, `hemmelig-test-verdi` eller `getaddrinfo`; `error.cause` er `undefined`.
5. **ugyldig navn for boksen gir undefined uten kall** (A4): `"A".repeat(128)` (128 tegn, for langt for boksen), `"MS GRAPH"` (mellomrom), `"ms.graph"` → `undefined`, `calls` tom.
6. **toKeyVaultSecretName, faste eksempler** (A3, `it.each`): `MS_GRAPH_CLIENT_SECRET` → `ms-graph-client-secret`, `A_1` → `a-1`, `AB` → `ab`, `A__B` → `a--b`, `A_` → `a-`, `EACCOUNTING_API_KEY` → `eaccounting-api-key`.
7. **toKeyVaultSecretName passer boksens regler for alle gyldige secret_ref** (A3): for 200 tilfeldige navn fra alfabetet `A–Z`, `0–9`, `_` (første tegn bokstav, lengde 2–128, fast frø eller deterministisk liste) matcher resultatet `/^[a-z0-9-]{1,127}$/` når navnet er høyst 127 tegn; `"A".repeat(128)` gir et navn på 128 tegn, som ikke matcher.
8. **omformingen er entydig** (A3): testen definerer motsatsen `fromKeyVaultSecretName = (name) => name.toUpperCase().replaceAll("-", "_")` og viser rundtur (`from(to(ref)) === ref`) for listen i test 6 og de 200 navnene i test 7; og at to ulike navn aldri gir samme resultat (sett av resultater har samme størrelse som sett av navn).
9. **fra adresse lages kilden uten nettkall** (A6, en del av): `createAzureKeyVaultSecretStoreFromUrl("https://kv-oppdiktet.vault.azure.net/")` kaster ikke, `driver === "azure_key_vault"`, `typeof get === "function"`. **`get` kalles ikke.**

## 3. Valg av kilde og `readSecret`, `secrets.test.ts` (utvides)

`afterEach`: `vi.unstubAllEnvs()` og deretter `resetSecretStore()`. Testene 1–11 er uendret. Nye:

12. **standard og env gir miljøvariabler** (A2, `it.each` over `SECRET_STORE_DRIVER` ikke satt, `""`, `"env"`, `" env "`): `createSecretStore(env)` gir `driver === "env"`; `readSecret(NAME)` etter `vi.stubEnv` gir verdien.
13. **azure_key_vault uten adresse gir SecretStoreConfigError** (A6): `createSecretStore({ SECRET_STORE_DRIVER: "azure_key_vault" })` kaster `SecretStoreConfigError`; `message` inneholder `SECRET_STORE_AZURE_KEY_VAULT_URL`. Det samme med adressen `""`.
14. **ukjent driver gir SecretStoreConfigError** (A6): `"tull"` og `"azure"` → `SecretStoreConfigError`; `message` inneholder `SECRET_STORE_DRIVER`, ikke `tull`.
15. **feil i oppsettet kommer fra readSecret, etter navnesjekken** (A1, A6): `vi.stubEnv("SECRET_STORE_DRIVER", "tull")`, `resetSecretStore()`: `readSecret("lowercase")` → `InvalidSecretRefError`; `readSecret(NAME)` → `SecretStoreConfigError`.
16. **azure_key_vault med adresse lager boksadapteren uten kall** (A6): `createSecretStore({ SECRET_STORE_DRIVER: "azure_key_vault", SECRET_STORE_AZURE_KEY_VAULT_URL: "https://kv-oppdiktet.vault.azure.net/" })` gir `driver === "azure_key_vault"`. **`get` kalles ikke.**
17. **ingen stille fallback til miljøet** (A6): `resetSecretStore(fakeStore("azure_key_vault", {}))` (tom kilde) og `vi.stubEnv(NAME, SECRET)`: `readSecret(NAME)` → `SecretNotFoundError` med navnet i meldingen, aldri `SECRET`.
18. **navnet sjekkes før kilden, uansett driver** (A1, `it.each` over driver `env` og `azure_key_vault`): `resetSecretStore(fakeStore(driver, { [NAME]: SECRET }))`; `readSecret("lowercase")`, `readSecret("")`, `readSecret("BETTER_AUTH_SECRET")`, `readSecret("DATABASE_URL")` → `InvalidSecretRefError` og **null kall** på kilden. Deretter `readSecret(NAME)` → `SECRET` og ett kall (viser at kilden faktisk er i bruk).
19. **nektlisten gjelder boksen selv når boksen har verdien** (A1): `fakeStore("azure_key_vault", { DATABASE_URL: "postgres://oppdiktet", BETTER_AUTH_SECRET: "x" })` → `InvalidSecretRefError`, null kall, meldingen uten `postgres://`.
20. **mellomlager bare for boksen, gjennom readSecret** (A7): med `fakeStore("azure_key_vault", { [NAME]: SECRET })`: to `readSecret(NAME)` → ett kall; `vi.useFakeTimers()` og `advanceTimersByTime(SECRET_CACHE_TTL_MS)` → nytt kall; `resetSecretStore(sammeKilde)` → nytt kall (tømt). Med `fakeStore("env", …)`: to `readSecret` → to kall.
21. **miljøvariabler mellomlagres ikke** (A7): standard driver; `vi.stubEnv(NAME, "første")`, `readSecret` → `første`; `vi.stubEnv(NAME, "andre")` uten `resetSecretStore()`; `readSecret` → `andre`.
22. **SecretStoreError fra kilden går uendret ut av readSecret**: `fakeStore` som avviser med `new SecretStoreError(NAME)` → `readSecret` avvises med samme feil (ikke pakket inn i `SecretNotFoundError`), meldingen har navnet.
23. **readSecret er asynkron**: `readSecret(NAME)` uten `await` er et `Promise` (`instanceof Promise`), også når navnet er ugyldig (avvist promise, ikke synkront kast). Viser at kallere alltid kan bruke `await`/`catch` likt.

## 4. Statiske kontroller, `static-checks.test.ts` (utvides)

7. **Azure-pakkene importeres bare i azure-key-vault.ts** (A8): blant produktfiler under `src/` (ikke tester) er `src/core/integrations/azure-key-vault.ts` den eneste som matcher `/from\s+["']@azure\/(keyvault-secrets|identity)["']/`, og den importerer begge. `package.json` har begge i `dependencies` med fast versjon (ikke `^` eller `~`), som `@azure/storage-blob`.
8. **bare arbeidsidentitet, og appen kan bare lese** (A8): `azure-key-vault.ts` inneholder `ManagedIdentityCredential`; ingen fil under `src/` (heller ikke tester) inneholder `DefaultAzureCredential`, `ClientSecretCredential`, `AzureCliCredential`, `.setSecret(`, `.beginDeleteSecret(`, `.purgeDeletedSecret(`, `listPropertiesOfSecrets(` eller `.updateSecretProperties(`.
9. **adressen til boksen står ikke i koden** (A8): ingen produktfil under `src/` inneholder `vault.azure.net`; `SECRET_STORE_AZURE_KEY_VAULT_URL` leses (`process.env`) bare i `secrets.ts` (test 4 dekker allerede at `process.env` ikke leses andre steder i laget; denne sjekker hele `src/`).

## 5. E-post gjennom laget med asynkron `readSecret`, `resolve.test.ts` (én ny test) og `email.test.ts` (uendret)

Eksisterende: `resolve.test.ts` 7.1.2 (hemmeligheten leses gjennom `readSecret`, aldri fra env), 7.2.1, 7.2.8a (`FINNES_IKKE` → `SecretNotFoundError`), 7.2.8b; `email.test.ts` 8.2 (manglende hemmelighet gir `status = error` og `last_error` med `FINNES_IKKE`, aldri verdien). Alle må være grønne uten endring (A9).

8d. **boksen svarer ikke: send avvises med SecretStoreError, fetchFn ukalt, connectionId satt** (A9): aktiv `microsoft365`-tilkobling med `secretRef: "ORG_HEMMELIGHET"`, `resetSecretStore(fakeStore("azure_key_vault", {}, ["ORG_HEMMELIGHET"]))` der kilden avviser med `new SecretStoreError("ORG_HEMMELIGHET")`; `resolveEmailSender({ organizationId, fetchFn })` gir `connectionId === row.id`; `send` avvises med `SecretStoreError`; `fetchFn` er ukalt; meldingen inneholder `ORG_HEMMELIGHET` og ikke `vault.azure.net`. `afterEach`: `resetSecretStore()`. (Viser at `senderForConnection` som `async` fortsatt gir avvist sending, ikke en kastet feil ut av `resolveEmailSender`.)

## 6. Infrastruktur, describe «nøkkelboksen som kilde i infrastrukturen (main.bicep)»

1. **parameteren finnes og er tom som standard** (B1): `bicep` inneholder `param secretStoreDriver string = ''`, nøyaktig én `param secretStoreDriver`, og ingen `@secure()` rett over (driveren er ikke hemmelig).
2. **de to appinnstillingene finnes bare med begge betingelsene** (B1): `appSettingExpression(bicep, "SECRET_STORE_DRIVER")` og `…("SECRET_STORE_AZURE_KEY_VAULT_URL")` er definert; `varDefinition(bicep, "secretStoreAppSettings")` matcher `/\(?\s*enableKeyVault\s*&&\s*secretStoreDriver\s*==\s*'azure_key_vault'\s*\)?\s*\?[\s\S]*:\s*\[\s*\]\s*$/`; `concat(` på `appSettings` inneholder `secretStoreAppSettings`. Begge `name:`-linjene ligger innenfor den variabelen (mellom `var secretStoreAppSettings` og neste tomme linje).
3. **adressen hentes fra boksen, ikke skrevet for hånd** (B1): innstillingen `SECRET_STORE_AZURE_KEY_VAULT_URL` har `value: vault!.properties.vaultUri` (regex som tåler `!`); `bicep` inneholder ikke `vault.azure.net`. `SECRET_STORE_DRIVER` har `value: secretStoreDriver`.
4. **ingen ny ressurs, utdata eller tilgang** (B1): `resourceBlocks(bicep).filter(type startsWith "Microsoft.KeyVault/")` har fortsatt nøyaktig fem blokker; `output`-linjene er fortsatt nøyaktig de fire fra steg 1; antall `accessPolicies:` og `permissions:` er uendret (sammenlign med tallet steg 1-testen bruker); `secrets: ['get']` står fortsatt, og `'list'` finnes ikke.
5. **med driveren tom er alt som i steg 1**: `secretStoreDriver` forekommer bare i `param`-linjen og i `var secretStoreAppSettings` (alle linjer med ordet ligger der); ingen `if (` på ressursnivå nevner `secretStoreDriver`. (Den bygde malen sjekkes av CI-jobben «Bicep for testmiljøet», som må være grønn.)

## 7. Arbeidsflyten, describe «nøkkelboksen som kilde i utrullingen (deploy-azure.yml)»

1. **variabelen sendes rett til Bicep** (B2): `parameterSources(workflow, "az deployment group validate")` og `…create` matcher `/secretStoreDriver=/`; `subBlock(stepOf(...), "env")` for steget «Infrastruktur (Bicep)» matcher `/^\s*SECRET_STORE_DRIVER:\s*\$\{\{\s*vars\.SECRET_STORE_DRIVER\s*\}\}/m`; `run` inneholder ikke `${{ … SECRET_STORE_DRIVER`.
2. **ingen tolkning i bash og ingen utskrift**: ingen linje i `run` matcher `/SECRET_STORE_DRIVER[^\n]*(==|!=|=\s*"true")/` utenom parameterlinjen; ingen `echo`-linje inneholder `SECRET_STORE` eller `KEY_VAULT_URL`.
3. **ALLOWED_VARS og driftsdokumentet** (B2): `ALLOWED_VARS` blir `["SEED_ADMIN_EMAIL", "APP_HOSTNAME", "ENABLE_SYNC_TRIAL", "ENABLE_KEY_VAULT", "SECRET_STORE_DRIVER"]`; de eksisterende testene «bruker bare de dokumenterte navnene» og «driftsdokumentet nevner alle secrets og variabler» er grønne. `secretNames(workflow)` er uendret.
4. **ingen nytt steg som leser fra boksen**: `workflow` inneholder ikke `az keyvault` (uendret fra steg 1).

I tillegg skrives steg 1-testen 11 om (punkt 8 over): **«kodeveien er bygget, og bare i adapterfilen»**: `package.json` inneholder `@azure/keyvault-secrets` og `@azure/identity`; i `src/` matcher `/^\s*import[^;]*keyvault/im` bare `src/core/integrations/azure-key-vault.ts`; `SECRETS_DRIVER` (det gamle navnet) finnes ikke, men `SECRET_STORE_DRIVER` finnes i `secrets.ts`; `vault.azure.net` finnes ikke i produktfiler.

## 8. Dokumenter, describe «dokumentasjon for nøkkelboksen som kilde»

1. **ADR 0006 finnes og dekker valgene** (D1): `docs/adr/0006-nokkelboks-kodevei.md` finnes, høyst 60 linjer, og inneholder `SecretStore`, `get`, `ManagedIdentityCredential` eller `arbeidsidentitet`, `toKeyVaultSecretName` eller `bindestrek`, `5 minutter`, `fallback`, `av som standard`, `SECRET_STORE_DRIVER`, `DefaultAzureCredential` (under forkastet), `REST`, `ADR 0005`. `docs/adr/0005-nokkelboks-key-vault.md` inneholder `ADR 0006`.
2. **driftsdokumentet forklarer steg 2** (D2): `docs/drift/testmiljo-azure.md` inneholder `SECRET_STORE_DRIVER`, `azure_key_vault`, `ENABLE_KEY_VAULT`, `små bokstaver`, `bindestrek`, `eaccounting-api-key`, `Fant ikke hemmeligheten`, `Nøkkelboksen svarte ikke`, `Generate/Import` eller `Secrets`, og en linje under «Hva som ikke er med ennå» som inneholder både `Nøkkelboks` og `SECRET_STORE_DRIVER`. Teksten om steg 2 kommer **etter** overskriften «Nøkkelboks for hemmeligheter» og før «Slette miljøet» (`after`).
3. **.env.example** (D2): inneholder linjene `# SECRET_STORE_DRIVER=env` og `# SECRET_STORE_AZURE_KEY_VAULT_URL=` (begge utkommentert, ingen aktiv `SECRET_STORE_`-linje).
4. **domenemodell, arkitektur, plan og beslutning** (D2): `docs/05-domenemodell.md` har en linje med `secret_ref` og `bindestrek` og `små bokstaver`, og ordlisten (avsnitt 8) inneholder `SecretStore`; regel 8 i `docs/06-arkitektur.md` (linjen som starter med `8. **Tilkoblinger`) inneholder `SecretStore` eller `kilde` og `SECRET_STORE_DRIVER`; `docs/07-utviklingsplan.md` har planlinjen for nøkkelboksen med `steg 2` og `ADR 0006`; `docs/09-apne-sporsmal.md` har en `A`-rad under «Avgjort av agentene mens Ståle var borte» som inneholder `SecretStore` eller `readSecret` og `SECRET_STORE_DRIVER`.

## 9. Sjekkliste for testrapporten (ikke automatisert)

- `pnpm lint`, `pnpm typecheck` (A5: typekontrollen i adapterfilen), `pnpm test`, `pnpm test:e2e` grønne; CI-jobben «Bicep for testmiljøet» grønn på PR-en.
- `git diff <basis> --stat` rører ikke `src/core/access/`, `src/db/`, `src/shared/lib/logger.ts`, `src/shared/config/`, `src/core/files/`, `src/core/email/graph.ts`, `e2e/`, `tests/tenant-tables.ts`, `tests/tenant-isolation-all-tables.test.ts`. I `src/core/integrations/connections.ts` er eneste endring eventuelt `await`.
- `package.json`: nøyaktig to nye avhengigheter, fast versjon, begrunnet i PR-en; `pnpm-lock.yaml` oppdatert; versjon 0.2.63 (eller neste ledige).
- Ingen oppdiktet verdi i tester ligner en ekte adresse (`kv-oppdiktet`, ikke `kv-ezprop-test`); ingen ekte tenant-id eller klient-id.
- `docs/agenter/tilstand.md`: det Ståle gjør selv står under «Trenger Ståle når han er tilbake».
- Kjent, ikke testet: to samtidige `readSecret` på samme navn før første svar gir to kall på boksen (ufarlig, ingen krav i kortet).

**Kan ikke testes automatisk (Ståle):** at appens identitet får lese fra den ekte boksen, og at en tilkobling sender med en hemmelighet lagt inn i portalen. Adapteren er testet bare mot en falsk klient.
