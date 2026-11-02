# Testplan: Felles filtjeneste for bilder og dokumenter

- **Oppgavekort:** `docs/funksjoner/fase0b-filtjeneste.md`
- **Dato:** 02.11.2026 (oppdatert etter runde 2 samme dag: én testfil per kildefil, ingen `*.plan.test.ts`, ingen røyktest, 6.1.6b og 6.8.1 utvidet, 6.8.2–6.8.4 ut, fabrikken får `deletedBy`)
- **Støtter hovedmål:** reklamasjoner (testene viser at en fil aldri skrives over, aldri slettes før oppbevaringstiden er ute, og at fingeravtrykket avslører endret innhold), tid (én testet port som alle senere funksjoner bruker, i stedet for egen lagring per funksjon). KI først: ingen KI i oppgaven, men testene sikrer at KI senere bare får filer fra organisasjonen den jobber for, gjennom samme tilgangssjekk som alle andre.

Alle integrasjonstester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Filer skrives bare i en midlertidig mappe (`mkdtemp` i `os.tmpdir()`, fjernes i `afterEach`), aldri i `var/files`. Testdata er oppdiktet: små byte-rekker eller `tests/jpeg-bytes.ts`, ingen ekte bilder. Azure testes bare med en falsk klient, aldri mot nett. Ingen ekte nøkler: hemmelige verdier i testene er tekster som `hemmelig-test-verdi` og `AccountKey=fiktivNokkel==`.

Ingen skjerm og ingen fagregler. Derfor ingen nye e2e-tester og ingen regeltester som data med testsaker i fil. De tekniske reglene (filtyper per `kind`, grenser for oppbevaringstid, ugyldige nøkler) testes som tabeller med fasit **skrevet inn i testen**, ikke importert fra koden, slik at testen feiler om koden endrer fasiten.

## Avtale om signaturer (slik koden er på branchen)

- `@/core/files` eksporterer: `saveFile`, `readFile`, `markFileDeleted`, `findActiveFile` (bare for tenant-testen), `readFileRetention`, `createFileStorage`, `createLocalFileStorage`, `createAzureFileStorage`, `isInsideRoot`, `FILE_KINDS`, `ALLOWED_MIME_TYPES`, `MAX_FILE_BYTES`, typene `FileStorage`, `FileKind`, `FileRetention`, `SaveFileInput`, og feilklassene `FileNotFoundError`, `FileValidationError`, `FileIntegrityError`, `FileRetentionError`, `FileAlreadyExistsError`, `FileStorageConfigError`, `FileStorageError`. (At `isInsideRoot`, `createAzureFileStorage`, `createLocalFileStorage` og `findActiveFile` eksporteres fra `index.ts`, er et lite funn til oppgaven etter PR-en, runde 2 punkt 8.)
- `FileStorage` har `driver: "local" | "azure"`, `put(storageKey, bytes, mimeType): Promise<void>` og `get(storageKey): Promise<Uint8Array>`. Ingen slette-operasjon.
- `assertValidStorageKey(storageKey)` i `storage.ts` avviser tom nøkkel, over 512 tegn, absolutt sti, tomme deler, `.`/`..`, bakstrek og andre tegn enn `A-Za-z0-9._-`. Nøkkelen står aldri i meldingen.
- `createLocalFileStorage(rootDir)`; `createAzureFileStorage(containerClient: AzureContainerClientLike)` (klienten sendes inn; `createAzureFileStorageFromConnectionString` er det eneste stedet `@azure/storage-blob` importeres); `createFileStorage(env)` velger adapter ut fra `FILE_STORAGE_DRIVER`, standard `local`, `DEFAULT_FILE_STORAGE_DIR = "var/files"`.
- Tjenesten lager porten med `createFileStorage(process.env)` ved hvert kall, slik at testene setter `process.env.FILE_STORAGE_DIR` til den midlertidige mappen i `beforeEach`.
- `saveFile(actor, organizationId, { kind, mimeType, bytes })` gir `{ id, sha256, sizeBytes }`. `readFile(actor, organizationId, fileId)` gir raden pluss `bytes`. `markFileDeleted(actor, organizationId, fileId)` gir den oppdaterte raden. `findActiveFile(grant, fileId)` gir den aktive raden i `grant.organizationId` eller `FileNotFoundError`.
- `readFileRetention(organizationId, settings: unknown)` gir `{ deviationOriginalYears, otherOriginalYears, displayYears }`, samme mønster som `readInspectorsEditAll`.
- Feilmeldingene er faste norske tekster uten sti, nøkkel eller hemmelighet (`errors.ts`). `FileStorageError` har ikke `cause`.
- **Fabrikk** i `tests/factories.ts`: `createFile(organizationId, overrides = {}, options: { storage?: FileStorage; bytes?: Uint8Array } = {})`. Overstyringer: `kind`, `mimeType`, `retainUntil`, `deletedAt`, **`deletedBy`** (runde 2 punkt 6, mangler på branchen i dag), `storageKey`, `sha256`. `resetDatabase` tømmer `files`.

## Testfiler (én per kildefil, runde 2 punkt 1–2)

| Kildefil | Testfil | Type |
|---|---|---|
| `local-storage.ts` (+ `storage.ts`) | `local-storage.test.ts` | enhet, `mkdtemp` |
| `azure-storage.ts` | `azure-storage.test.ts` | enhet, falsk klient |
| `config.ts` | `config.test.ts` | enhet |
| `retention.ts` | `retention.test.ts` | enhet |
| `service.ts` (+ `kinds.ts`, `errors.ts`, skjema og migrering) | `files.service.test.ts` | integrasjon mot testdatabasen |
| hele mappen | `static-checks.test.ts` | statisk |
| `src/shared/lib/logger.ts` | `src/shared/lib/logger.test.ts` | enhet (utvidet) |
| `tests/factories.ts` | `tests/factories.test.ts` | integrasjon (utvidet) |

Skal **ikke** finnes når PR åpnes: `*.plan.test.ts` (fem filer) og `src/core/files/service.test.ts`.

## 1. Lokal adapter, `local-storage.test.ts`

1. **rundtur:** `put("org/photo/a", bytes, "image/jpeg")` og så `get` gir nøyaktig samme byte (vanlig `Uint8Array`, ikke `Buffer`).
2. **lager mappen selv:** roten finnes ikke før første `put` (undermappe av `mkdtemp`), finnes etterpå.
3. **skriver aldri over:** `put` to ganger på samme nøkkel med ulikt innhold gir `FileAlreadyExistsError`; `get` gir fortsatt det første innholdet (flagget `wx`).
4. **ugyldige nøkler avvises** (`it.each`, fasit i testen): `"../x"`, `"a/../../x"`, `"a/.."`, `"/etc/passwd"`, `"a//b"`, `"/a"`, `"a/"`, `""`, `"a\\b"`, `"a/./b"`, nøkkel med mellomrom. Både `put` og `get` avvises med `FileValidationError`, meldingen inneholder ikke nøkkelen, og ingen fil er laget utenfor roten (foreldremappen til roten er uendret).
5. **`isInsideRoot`** (`it.each`): `("/tmp/rot", "/tmp/rot/a/b")` er sann; `("/tmp/rot", "/tmp/rot")`, `("/tmp/rot", "/tmp/rotte/a")` og `("/tmp/rot", "/tmp/a")` er usanne. Søskenmappe med samme begynnelse er grunnen til `root + path.sep`.
6. **ukjent nøkkel ved `get`:** `FileNotFoundError`, meldingen inneholder verken roten eller nøkkelen.

## 2. Azure-adapter, `azure-storage.test.ts` (falsk klient, aldri nett)

Den falske klienten lagrer i et `Map`. Den skriver over **med mindre** kallet har `conditions: { ifNoneMatch: "*" }`; da kaster den en feil med `statusCode: 409`. Slik viser testen at adapteren faktisk sender betingelsen, ikke bare at den falske klienten nekter.

1. **rundtur:** `put` og `get` gir samme byte; `blobHTTPHeaders.blobContentType` er innholdstypen.
2. **skriver aldri over:** andre `put` gir `FileAlreadyExistsError`; første innhold står i den falske klienten.
3. **betingelsen sendes:** den falske klienten registrerer `ifNoneMatch: "*"` på hver opplasting.
4. **feil pakkes inn uten hemmeligheter** (`put` og `get`): klienten kaster `new Error("AccountKey=fiktivNokkel==; sig=abc123")` → adapteren kaster `FileStorageError`; `message`, `String(error)`, `cause` og loggerens serialisering av feilen inneholder verken `fiktivNokkel` eller `abc123`.
5. **ukjent nøkkel** (klienten kaster `statusCode: 404`) gir `FileNotFoundError`.
6. **ugyldig nøkkel** avvises før klienten kalles (klienten registrerer ingen kall).

## 3. Valg av adapter, `config.test.ts`

`createFileStorage` får et `env`-objekt; `process.env` endres ikke.

1. **standard lokal:** `{}` og `{ FILE_STORAGE_DRIVER: "local" }` gir `driver === "local"`, og ingenting skrives i `var/files`.
2. **`FILE_STORAGE_DIR` brukes:** `{ FILE_STORAGE_DIR: tmp }` og `put` → filen ligger under `tmp`.
3. **azure uten tilkoblingsstreng:** `FileStorageConfigError`, meldingen nevner `FILE_STORAGE_AZURE_CONNECTION_STRING`.
4. **azure uten container:** med `FILE_STORAGE_AZURE_CONNECTION_STRING: "hemmelig-test-verdi"` → kaster, meldingen nevner `FILE_STORAGE_AZURE_CONTAINER` og inneholder **ikke** `hemmelig-test-verdi`.
5. **ukjent driver** (`"s3"`): `FileStorageConfigError` som nevner `FILE_STORAGE_DRIVER`; ingen stille fallback til lokal (lukket ved feil).

## 4. Oppbevaringstider, `retention.test.ts`

1. **standard 10/2/10:** `settings` = `{}`, `null`, `undefined`, `[]` og `"tekst"` gir `{ 10, 2, 10 }` uten advarsel.
2. **egne verdier:** 15/3/12 leses.
3. **fasit, ugyldig** (`it.each` over alle tre nøklene × `0`, `-1`, `2.5`, `"10"`, `null`, `NaN`, `101`): standardverdien for den nøkkelen, de andre to uendret, og `logger.warn` kalt én gang med et objekt som har **bare** `organizationId` og `key` (aldri verdien).
4. **fasit, gyldig** (`it.each` over alle tre nøklene × `1`, `10`, `100`): verdien brukes, ingen advarsel.
5. **ukjente nøkler** påvirker ingenting og gir ingen advarsel.

## 5. Loggeren, `src/shared/lib/logger.test.ts`

Bare i `describe("logger vasker Azure-hemmeligheter")`, nummerert 1–4. De fire Azure-testene inne i `describe("logger")` fjernes (runde 2 punkt 5). Eksisterende tester står.

1. **tilkoblingsstreng:** `AccountKey=fiktivNokkel==` vaskes; `AccountName=fiktiv` og `EndpointSuffix` kan stå.
2. **SAS:** `SharedAccessSignature=…` og `sig=abc%2B123` i en adresse vaskes; resten av adressen kan stå.
3. **nøkler i objekter:** `connectionString`, `CONNECTION_STRING`, `accountKey`, `account-key` og `sas` blir `[fjernet]`.
4. **ingen overvasking:** nøkkelen `sasquatch` og teksten `signatur` står urørt.

## 6. Tjenesten, `files.service.test.ts` (integrasjon)

### 6.1 Lagre og hente

1. **rundtur:** takstmann i A, `saveFile` med JPEG-byte → `readFile` gir samme byte, samme `sha256` (regnet i testen med `node:crypto`) og `sizeBytes` = lengden.
2. **raden:** `organization_id` = A, `kind`, `mime_type`, `size_bytes`, `sha256` riktige, `retain_until` tom, `created_by` = aktøren, `deleted_at` tom.
3. **`storage_key`:** nøyaktig `` `${orgA}/photo/${id}` ``, filen ligger på `join(tmp, storage_key)`, og nøkkelen inneholder ikke noe fra kallet utover `kind` (ingen filnavn kan sendes inn).
4. **fil først, så rad, og feil uten sti:** en trigger i testen (`before insert on files … raise exception`, fjernes i `finally`) får raden til å feile → `saveFile` kaster; ingen rad i `files`; én fil ligger i mappen (akseptert); `message` og `String(error)` inneholder ikke `tmp`-stien, `storage_key` eller `hemmelig-test-verdi` (satt i `FILE_STORAGE_AZURE_CONNECTION_STRING` under testen).
5. **endret innhold oppdages:** lagre, skriv andre byte rett i filen på disk, `readFile` → `FileIntegrityError`; meldingen har ingen sti.
6. **ekstra forsvar på prefikset**, to varianter:
   - **6a. bare nøkkelen byttet:** rå `update` setter `storage_key` på en rad i A til B sin nøkkel → `readFile(adminA, orgA, idA)` gir `FileNotFoundError` eller `FileIntegrityError`, aldri B sitt innhold.
   - **6b. nøkkel, fingeravtrykk og størrelse kopiert** (fra `files.service.plan.test.ts`, runde 2 punkt 1): fingeravtrykket stemmer, så bare prefikssjekken `storage_key` begynner med `grant.organizationId + "/"` kan stoppe → fortsatt feil, aldri B sitt innhold. Dette er testen som viser at prefikssjekken ikke er død kode.
7. **ikke-uuid som fil-ID:** `readFile` og `markFileDeleted` med `"ikke-en-id"` gir `FileNotFoundError`, ikke databasefeil.

### 6.2 Validering før skriving

Etter hver avvisning: ingen fil i mappen (`readdir` rekursivt er tom) og ingen rad.

1. **25 MB:** `MAX_FILE_BYTES === 25 * 1024 * 1024` (tallet skrevet inn i testen); nøyaktig 25 MB godtas; én byte mer gir `FileValidationError`.
2. **tom fil:** 0 byte gir `FileValidationError`.
3. **filtyper per `kind`** (`it.each`, fasit i testen): godtas `photo` × `image/jpeg`, `image/png`, `image/heic`, `image/webp`; `report_pdf` × `application/pdf`; `document` × `application/pdf`, `image/jpeg`, `image/png`. Avvises: `photo` × `application/pdf`; `report_pdf` × `image/jpeg`; `document` × `image/heic`; alle tre × `image/svg+xml`, `text/html`, `application/octet-stream`, `""`. `ALLOWED_MIME_TYPES` sammenlignes med fasiten.
4. **ugyldig `kind`:** `"logo"`, `"signature"`, `"attachment"`, `""` avvises (finnes ikke ennå, regel 6).
5. **`FILE_KINDS`** er nøyaktig `["document", "photo", "report_pdf"]`.

### 6.3 Myk sletting

1. **merker, rører ikke filen:** admin, `markFileDeleted` → `deleted_at` og `deleted_by` (= admins id) satt; filen ligger i mappen med samme innhold; `readFile` gir `FileNotFoundError` etterpå.
2. **revisjonslogg:** `auditRows(orgA)` har nøyaktig én rad for handlingen; detaljene har bare nøklene `fileId`, `kind`, `organizationId`; `JSON.stringify(rad)` inneholder ikke `storage_key`, `sha256`, `mime_type` eller `tmp`-stien.
3. **`retain_until` i fremtiden:** fil med `retain_until` = i morgen → admin får `FileRetentionError`, `deleted_at` fortsatt tom, ingen rad i revisjonsloggen.
4. **`retain_until` tom eller passert** (`it.each`: `null`, i går): tillatt.
5. **allerede merket:** fil laget med `createFile(orgA, { deletedAt, deletedBy })` → `markFileDeleted` gir `FileNotFoundError`, og `deleted_at`/`deleted_by` er nøyaktig det fabrikken satte (ingen omvei via første kall; trenger `deletedBy` i `FileOverrides`).
6. **ingen sletting noe sted:** `// @ts-expect-error` på `storage.delete` (fanges av `pnpm typecheck`); raden finnes fortsatt etter merking (`select` uten filter på `deleted_at`).

### 6.4 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`, `admin`:** `saveFile` og `readFile` lykkes.
2. **`it.each` over `inspector`, `office`, `manager`:** `markFileDeleted` gir `AccessDeniedError`, raden er uendret, ingen loggrad.
3. **`admin`:** `markFileDeleted` lykkes.
4. **to roller:** ansatt med `inspector` og `admin` kan merke.
5. **enkeltrettighet gir ikke sletting:** takstmann med `grantPermission(…, "organization.manage")` får fortsatt `AccessDeniedError` (rettigheten kan ikke gis, A21).
6. **6a. deaktivert ansatt** (også med admin-rolle) og **6b. ansatt uten roller:** `AccessDeniedError` på alle tre, ingen fil, ingen rad.
7. **innlogget uten ansettelse i organisasjonen:** `AccessDeniedError` på alle tre.

### 6.5 Admin stenges aldri ute (regel 11; kommentar i testen: skal aldri fjernes)

1. `access.inspectors_edit_all` = `false` i `organizations.settings` → admin kan lagre, lese og merke.
2. Admin uten sertifisering og uten enkeltrettigheter kan lagre, lese og merke.

### 6.6 Fremmed fil-ID i egen organisasjon

1. **lese:** fil i A; `readFile(adminB, orgB, idA)` → `FileNotFoundError`, ingen byte returneres.
2. **merke:** `markFileDeleted(adminB, orgB, idA)` → `FileNotFoundError`; raden i A har fortsatt `deleted_at` tom; ingen rad i revisjonsloggen i A eller B.
3. **takstmann i B** får det samme på `readFile`.

### 6.7 Tenant-isolasjon (regel 2), fire `expectTenantIsolation`-kall

`seed` lager to filer i hver organisasjon med `createFile(…, {}, { storage })`, slik at innholdet finnes i mappen.

1. **`readFile`:** `query(actor, orgId)` prøver `readFile` på **alle** id-er fra begge organisasjonene; `FileNotFoundError` gir ingen rad, ellers `{ id }`. `AccessDeniedError` slippes gjennom.
2. **`saveFile`:** `query` lagrer, slår opp den nye raden uten filter og gir alle rader med **den radens** `organization_id`. Havner filen i feil organisasjon, inneholder svaret fremmede id-er og testen feiler.
3. **`markFileDeleted`:** `query` merker en seedet fil uten `retain_until` i organisasjonen og gir alle rader (også merkede) med den returnerte radens `organization_id`. Etterpå: ingen rad i den andre organisasjonen er merket.
4. **`findActiveFile(grant, fileId)`:** `query` henter tilgangen med `requireOrganizationAccess` og prøver alle id-er.

### 6.8 Databasen

1. **unik `(organization_id, storage_key)`, sammensatt:** to rå `insert` med samme par gir databasefeil; samme `storage_key` i en annen organisasjon godtas.

6.8.2–6.8.4 (kolonner, `organization_id` påkrevd, `resetDatabase`) er tatt ut (runde 2 punkt 3): migrering og `RESET_TABLES` dekkes av `tests/factories.test.ts`, og at `deleted_at`/`deleted_by` finnes, vises av 6.3.

## 7. Fabrikken, `tests/factories.test.ts`

Én `describe` for `createFile` (på branchen står det to, linje 34 og 237; slås sammen i ryddingen).

1. `createFile(orgA)` gir en rad i A med `storage_key` = `<orgA>/photo/<id>`.
2. Med `storage` og egne byte: filen finnes i porten, `sha256` og `size_bytes` stemmer med innholdet.
3. `deletedAt` og `deletedBy` fra overstyringene står på raden.

## 8. Statiske kontroller, `static-checks.test.ts`

1. Mappen har kildefiler (ellers sier testene under ingenting).
2. Ingen `unlink`, `rm`, `rmdir`, `deleteIfExists` eller `.delete(files` i `src/core/files` (unntatt tester).
3. `@azure/storage-blob` importeres bare i `src/core/files/azure-storage.ts` (hele `src`).

Testen «importerer ikke fra modulene» fjernes (runde 2 punkt 4): lint-regelen for modulgrenser gjør jobben.

## 9. E2e

Ingen nye tester. `pnpm test:e2e` for begge prosjektene (`pc` og `ipad`) skal være grønn uendret, særlig `e2e/fase-1-prove-d-bilder.spec.ts` (viser at prøve D ikke er rørt). Ingen del av oppgaven har skjerm eller virker uten nett, så ingen test uten nett og ingen test på iPad-størrelse utover den eksisterende pakken.

## 10. Kontroller i gjennomgangen (test-leder)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- `git diff main -- src/modules/offline-trial` er tom.
- Filene `src/core/files/*.plan.test.ts` og `src/core/files/service.test.ts` finnes ikke; Azure-vaskingen står én gang i `logger.test.ts`; `static-checks.test.ts` har ikke modulimport-testen; `files.service.test.ts` har 6.1.6a og 6.1.6b, bare 6.8.1 under «databasen», og **fire** `expectTenantIsolation`-kall.
- `FileOverrides` har `deletedBy`, og 6.3.5 bruker den.
- Ingen ekte nøkler i `.env.example` (tomme verdier, heller ikke Azurite-nøkkelen) eller i testene; ingen test skriver i `var/files`.
- Versjon 0.2.51 i `package.json` (eller neste ledige patch over `main`); A39–A43 i `docs/09-apne-sporsmal.md`; domenemodellen (`files`, 4.8) og ordlisten oppdatert; `@azure/storage-blob` begrunnet i PR-en (A41).
- **Avvises** hvis 6.4, 6.5, 6.6 eller noen av de fire kallene i 6.7 mangler, eller hvis en testfil importerer fasiten (filtyper, grenser) fra koden i stedet for å ha den skrevet inn.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Rundtur med samme innhold og SHA-256 | 6.1.1–6.1.2 |
| Endret fil gir feil ved henting | 6.1.5 |
| Ugyldige nøkler og løst sti utenfor mappen | 1.4, 1.5, 2.6 |
| `put` skriver aldri over (lokal og Azure) | 1.3, 2.2, 2.3 |
| `storage_key` uten filnavn fra brukeren | 6.1.3 |
| 25 MB, én byte over, tom fil, ingenting skrives | 6.2.1–6.2.2 |
| Ugyldig `kind` og filtype avvises før skriving | 6.2.3–6.2.5 |
| Fil først, så rad; feil uten sti eller hemmelighet | 6.1.4 |
| Myk sletting, filen ligger, revisjonslogg minimal | 6.3.1–6.3.2, 6.3.6, 8.2 |
| `retain_until` i fremtiden stopper også admin | 6.3.3–6.3.4 |
| Rollematrise, to roller, deaktivert | 6.4 |
| Admin stenges aldri ute | 6.5 |
| Azure-adapter mot falsk klient, innstillinger, standard lokal | 2, 3 |
| Loggeren vasker Azure-hemmeligheter | 5, 2.4 |
| `readFileRetention` standard, egne verdier, fasit | 4 |
| Fremmed fil-ID i egen organisasjon | 6.6, 6.1.6a–6b |
| `expectTenantIsolation` per operasjon (og intern oppslagsfunksjon) | 6.7.1–6.7.4 |
| Unik `(organization_id, storage_key)`, annen organisasjon godtas | 6.8.1 |
| Lint, typesjekk, tester grønne, prøvekandidatene uendret | 10 |
| Ny avhengighet begrunnet | 10, 8.3 |
| iPad-størrelse: eksisterende e2e grønn | 9 |
