# Testplan: Felles filtjeneste for bilder og dokumenter

- **Oppgavekort:** `docs/funksjoner/fase0b-filtjeneste.md`
- **Dato:** 02.11.2026
- **Støtter hovedmål:** reklamasjoner (testene viser at en fil aldri skrives over, aldri slettes før oppbevaringstiden er ute, og at fingeravtrykket avslører endret innhold), tid (én testet port som alle senere funksjoner bruker). KI først: ingen KI i oppgaven. Testene sikrer at KI senere bare får filer fra organisasjonen den jobber for.

Alle integrasjonstester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Filer skrives bare i en midlertidig mappe (`mkdtemp` i `os.tmpdir()`, fjernes i `afterEach`), aldri i `var/files`. Testdata er oppdiktet: små byte-rekker eller `tests/jpeg-bytes.ts`, ingen ekte bilder. Azure testes bare med en falsk klient, aldri mot nett. Ingen ekte nøkler: hemmelige verdier i testene er tekster som `hemmelig-test-verdi` og `AccountKey=fiktivNokkel==`.

Ingen skjerm og ingen fagregler. Derfor ingen nye e2e-tester og ingen regeltester som data. De tekniske reglene (filtyper per `kind`, grenser for oppbevaringstid) testes som tabeller med fasit skrevet inn i testen, ikke importert fra koden.

## Avtale om signaturer (utvikler og testskriver)

Utvikler kan endre navn, men da i samme commit som testene, og slik at alt under fortsatt kan testes.

- `@/core/files` eksporterer: `saveFile`, `readFile`, `markFileDeleted`, `readFileRetention`, `createFileStorage`, `FILE_KINDS`, `ALLOWED_MIME_TYPES` (per `kind`), `MAX_FILE_BYTES`, typen `FileStorage`, og feilklassene `FileNotFoundError`, `FileValidationError`, `FileIntegrityError`, `FileRetentionError`, `FileAlreadyExistsError`, `FileStorageConfigError`, `FileStorageError`.
- `FileStorage` har bare `put(storageKey, bytes, mimeType): Promise<void>` og `get(storageKey): Promise<Uint8Array>`. Ingen slette-operasjon.
- `createLocalFileStorage(rootDir)` og `createAzureFileStorage(containerClient)` (klienten sendes inn). `createFileStorage(env: Record<string, string | undefined>)` velger adapter ut fra `FILE_STORAGE_DRIVER`.
- Tjenesten lager porten med `createFileStorage(process.env)` ved hvert kall (ingen mellomlagring), slik at testene kan sette `process.env.FILE_STORAGE_DIR` til den midlertidige mappen i `beforeEach`.
- `saveFile(actor, organizationId, { kind, mimeType, bytes })` gir `{ id, sha256, sizeBytes }`.
- `readFile(actor, organizationId, fileId)` gir `{ id, kind, mimeType, sizeBytes, sha256, bytes }`.
- `markFileDeleted(actor, organizationId, fileId)` gir den oppdaterte raden (minst `id` og `organizationId`).
- `readFileRetention(organizationId, settings: unknown)` gir `{ deviationOriginalYears, otherOriginalYears, displayYears }`. Samme mønster som `readInspectorsEditAll`.
- Den lokale adapteren eksporterer en ren funksjon `isInsideRoot(root, resolvedPath): boolean` (sjekken med `root + path.sep`), slik at den kan testes alene.
- **Fabrikk** i `tests/factories.ts`: `createFile(organizationId, overrides = {}, options: { storage?: FileStorage; bytes?: Uint8Array } = {})`. Lager raden direkte (uten tilgangssjekk) med `storage_key` = `<organizationId>/<kind>/<id>`. Får den `storage`, skrives også innholdet via porten, og `sha256`/`size_bytes` regnes av innholdet. Overstyringer: `kind`, `mimeType`, `retainUntil`, `deletedAt`, `storageKey`, `sha256`.
- `resetDatabase` tømmer også `files`.

## 1. Lokal adapter, `src/core/files/local-storage.test.ts` (ny, enhetstest)

1. **rundtur:** `put("org/photo/a", bytes, "image/jpeg")` og så `get` gir nøyaktig samme byte.
2. **lager mappen selv:** roten finnes ikke før første `put` (undermappe av `mkdtemp`), finnes etterpå.
3. **skriver aldri over:** `put` to ganger på samme nøkkel med ulikt innhold gir `FileAlreadyExistsError`; `get` gir fortsatt det første innholdet.
4. **ugyldige nøkler avvises** (`it.each`, fasit i testen): `"../x"`, `"a/../../x"`, `"a/.."`, `"/etc/passwd"`, `"a//b"`, `"/a"`, `"a/"`, `""`, `"a\\b"`. Både `put` og `get` avvises, og ingen fil er laget utenfor roten (sjekk at foreldremappen til roten er uendret).
5. **`isInsideRoot`:** `("/tmp/rot", "/tmp/rot/a/b")` er sann; `("/tmp/rot", "/tmp/rot")`, `("/tmp/rot", "/tmp/rotte/a")` og `("/tmp/rot", "/tmp/a")` er usanne. (Søskenmappe med samme begynnelse er grunnen til `path.sep`.)
6. **ukjent nøkkel ved `get`:** gir `FileNotFoundError` (eller adapterens egen feil), og meldingen inneholder ikke roten eller nøkkelen.

## 2. Azure-adapter, `src/core/files/azure-storage.test.ts` (ny, enhetstest, falsk klient)

Den falske klienten lagrer i et `Map`. Den skriver over **med mindre** kallet har `conditions: { ifNoneMatch: "*" }`; da kaster den en feil med `statusCode: 409`. Slik viser testen at adapteren faktisk sender betingelsen.

1. **rundtur:** `put` og `get` gir samme byte. Innholdstypen sendes med (`blobContentType`).
2. **skriver aldri over:** `put` to ganger gir `FileAlreadyExistsError`; det første innholdet står i den falske klienten.
3. **betingelsen sendes:** den falske klienten registrerer at hver opplasting hadde `ifNoneMatch: "*"`.
4. **feil pakkes inn:** den falske klienten kaster `new Error("AccountKey=fiktivNokkel==; sig=abc123")` → adapteren kaster `FileStorageError`; `message`, `String(error)` og `JSON.stringify(formatLogLine("error", "test", { error }))` (loggerens serialisering) inneholder verken `fiktivNokkel` eller `abc123`. `cause` er ikke den opprinnelige feilen.
5. **ingen nett:** testen setter ingen nettverkstilgang opp, og `@azure/storage-blob` importeres ikke i testen (bare typene, om nødvendig).

## 3. Valg av adapter, `src/core/files/config.test.ts` (ny, enhetstest)

`createFileStorage` får et `env`-objekt; `process.env` endres ikke.

1. **standard lokal:** `{}` gir lokal adapter (sjekkes med en `driver`-egenskap eller `instanceof`; ingen skriving i `var/files`).
2. **`FILE_STORAGE_DIR` brukes:** `{ FILE_STORAGE_DIR: tmp }` og `put` → filen ligger under `tmp`.
3. **azure uten tilkoblingsstreng:** kaster `FileStorageConfigError`, meldingen nevner `FILE_STORAGE_AZURE_CONNECTION_STRING`.
4. **azure uten container:** med `FILE_STORAGE_AZURE_CONNECTION_STRING: "hemmelig-test-verdi"` → kaster, meldingen nevner `FILE_STORAGE_AZURE_CONTAINER` og inneholder **ikke** `hemmelig-test-verdi`.
5. **ukjent driver** (`"s3"`): kaster `FileStorageConfigError` som nevner `FILE_STORAGE_DRIVER`, i stedet for å falle tilbake stille. (Tillegg fra test-leder: lukket ved feil.)

## 4. Oppbevaringstider, `src/core/files/retention.test.ts` (ny, enhetstest)

1. **standard 10/2/10:** `settings` = `{}`, `null`, `[]` og `"tekst"` gir `{ 10, 2, 10 }` uten advarsel.
2. **egne verdier:** `{ "photo.retention.deviation_original_years": 15, "photo.retention.other_original_years": 3, "photo.retention.display_years": 12 }` gir 15/3/12.
3. **fasit, ugyldig** (`it.each` over alle tre nøklene × `0`, `-1`, `2.5`, `"10"`, `null`, `NaN`, `101`): standardverdien for den nøkkelen, de andre to uendret, og `logger.warn` kalt én gang med et objekt som har **bare** `organizationId` og `key` (ikke verdien).
4. **fasit, gyldig** (`it.each` × `1`, `10`, `100`): verdien brukes, ingen advarsel.
5. **ukjente nøkler** i innstillingene påvirker ingenting og gir ingen advarsel.

## 5. Loggeren, `src/shared/lib/logger.test.ts` (utvides, eksisterende tester står)

1. **tilkoblingsstreng:** `scrubText("DefaultEndpointsProtocol=https;AccountName=fiktiv;AccountKey=fiktivNokkel==;EndpointSuffix=core.windows.net")` inneholder ikke `fiktivNokkel`.
2. **SAS:** `SharedAccessSignature=sv=2024&sig=abc;` og en adresse `https://fiktiv.blob.core.windows.net/c/b?sv=2024&sig=abc%2B123&se=2026` → verken `abc` eller `abc%2B123` står igjen; resten av adressen kan stå.
3. **nøkler i objekter:** `connectionString`, `CONNECTION_STRING`, `accountKey`, `account-key` og `sas` blir `[fjernet]`.
4. **ingen overvasking:** nøkkelen `sasquatch` og teksten `signatur` står urørt.

## 6. Tjenesten, `src/core/files/files.service.test.ts` (ny, integrasjonstest)

### 6.1 Lagre og hente

1. **rundtur:** takstmann i A, `saveFile` med JPEG-byte → `readFile` gir samme byte, samme `sha256` (regnet i testen med `node:crypto`) og `sizeBytes` = lengden.
2. **raden:** `organization_id` = A, `kind`, `mime_type`, `size_bytes`, `sha256` riktige, `retain_until` tom, `created_by` satt, `deleted_at` tom.
3. **`storage_key`:** er nøyaktig `` `${orgA}/photo/${id}` `` og filen ligger på `join(tmp, storage_key)`.
4. **rekkefølgen fil så rad, og feil uten sti:** en trigger i testen (`create trigger … before insert on files … raise exception`, fjernes i `finally`) får raden til å feile → `saveFile` kaster; ingen rad i `files`; én fil ligger i mappen (akseptert); feilmeldingen og `String(error)` inneholder ikke `tmp`-stien, `storage_key` eller verdien i `FILE_STORAGE_AZURE_CONNECTION_STRING` (satt til `hemmelig-test-verdi` i testen).
5. **endret innhold oppdages:** lagre, skriv andre byte rett i filen på disk, `readFile` → `FileIntegrityError`; meldingen har ingen sti.
6. **ekstra forsvar på prefikset:** rå `update` setter `storage_key` på en rad i A til B sin nøkkel (B har en fil der) → `readFile(adminA, orgA, idA)` gir feil (ikke funnet eller integritet) og gir **aldri** B sitt innhold.
7. **ikke-uuid som fil-ID:** `readFile(…, "ikke-en-id")` gir `FileNotFoundError`, ikke databasefeil.

### 6.2 Validering før skriving

Etter hver avvisning: ingen fil i mappen (tom `readdir` rekursivt) og ingen rad.

1. **25 MB:** nøyaktig `25 * 1024 * 1024` byte godtas; én byte mer gir `FileValidationError`. `MAX_FILE_BYTES` sammenlignes med tallet skrevet inn i testen.
2. **tom fil:** 0 byte gir `FileValidationError`.
3. **filtyper per `kind`** (`it.each`, fasit i testen): godtas `photo` × `image/jpeg`, `image/png`, `image/heic`, `image/webp`; `report_pdf` × `application/pdf`; `document` × `application/pdf`, `image/jpeg`, `image/png`. Avvises: `photo` × `application/pdf`; `report_pdf` × `image/jpeg`; `document` × `image/heic`; alle tre × `image/svg+xml`, `text/html`, `application/octet-stream`, `""`.
4. **ugyldig `kind`:** `"logo"`, `"signature"`, `"attachment"`, `""` avvises (finnes ikke ennå, regel 6).
5. **`FILE_KINDS`** er nøyaktig `["document", "photo", "report_pdf"]` sortert (fasit i testen).

### 6.3 Myk sletting

1. **merker, rører ikke filen:** admin, `markFileDeleted` → `deleted_at` og `deleted_by` satt; filen ligger fortsatt i mappen med samme innhold; `readFile` gir `FileNotFoundError` etterpå.
2. **revisjonslogg:** `auditRows(orgA)` har nøyaktig én ny rad for handlingen; detaljene har bare nøklene `fileId`, `kind`, `organizationId`; `JSON.stringify(rad)` inneholder ikke `storage_key`, `sha256`, `mime_type` eller `tmp`-stien.
3. **`retain_until` i fremtiden:** fil med `retain_until` = i morgen → admin får `FileRetentionError`, `deleted_at` fortsatt tom, ingen ny rad i revisjonsloggen.
4. **`retain_until` tom eller passert** (i går): tillatt.
5. **allerede merket:** andre kall gir `FileNotFoundError`, og `deleted_at`/`deleted_by` er uendret fra første kall.
6. **ingen sletting noe sted:** `FileStorage` har ingen `delete` (`// @ts-expect-error` på `storage.delete`, fanges av `pnpm typecheck`); raden finnes fortsatt etter merking (`select` uten filter på `deleted_at`).

### 6.4 Tilgang per rolle

1. **`it.each` over `inspector`, `office`, `manager`, `admin`:** `saveFile` og `readFile` lykkes.
2. **`it.each` over `inspector`, `office`, `manager`:** `markFileDeleted` gir `AccessDeniedError`, raden er uendret.
3. **`admin`:** `markFileDeleted` lykkes.
4. **to roller:** ansatt med `inspector` og `admin` kan merke.
5. **enkeltrettighet gir ikke sletting:** takstmann med `grantPermission(…, "organization.manage")` får fortsatt `AccessDeniedError` (ikke en rettighet som kan gis, A21).
6. **deaktivert ansatt** (`deactivated_at` satt) og **ansatt uten roller:** `AccessDeniedError` på alle tre, ingen fil, ingen rad, ingen endring.
7. **innlogget uten ansettelse i organisasjonen:** `AccessDeniedError` på alle tre.

### 6.5 Admin stenges aldri ute (regel 11)

1. `access.inspectors_edit_all` = `false` i `organizations.settings` → admin kan lagre, lese og merke. Kommentar i testen: skal aldri fjernes.
2. Admin uten sertifisering og uten enkeltrettigheter kan lagre, lese og merke.

### 6.6 Fremmed fil-ID i egen organisasjon

1. **lese:** fil i A; `readFile(adminB, orgB, idA)` → `FileNotFoundError`, ingen byte returneres.
2. **merke:** `markFileDeleted(adminB, orgB, idA)` → `FileNotFoundError`; raden i A har fortsatt `deleted_at` tom; ingen ny rad i revisjonsloggen i A eller B.
3. **samme med takstmann i B** (ikke bare admin) for `readFile`.

### 6.7 Tenant-isolasjon (regel 2), ett `expectTenantIsolation` per operasjon

`seed` lager to filer i hver organisasjon med `createFile(…, {}, { storage })`, slik at innholdet finnes i mappen.

1. **`readFile`:** `query(actor, orgId)` prøver `readFile` på **alle** id-er fra begge organisasjonene; `FileNotFoundError` gir ingen rad, ellers `{ id }`. `AccessDeniedError` slippes gjennom. Viser at fremmede id-er aldri leses, og at fremmed organisasjon nektes.
2. **`saveFile`:** `query` kaller `saveFile`, slår opp den nye raden på id (uten filter), og gir alle rader i `files` med **den radens** `organization_id`. Havner filen i feil organisasjon, inneholder svaret fremmede id-er og testen feiler.
3. **`markFileDeleted`:** `query` merker en av de seedede filene uten `retain_until` i organisasjonen (id fra et kart per organisasjon), og gir alle rader (også merkede) med den returnerte radens `organization_id`. Mot fremmed organisasjon: `AccessDeniedError`, og ingen rad er merket der (sjekkes etter kallet).
4. **intern oppslagsfunksjon:** finnes en egen funksjon som henter raden (for eksempel `findActiveFile(grant, fileId)`), får den sitt eget kall.

### 6.8 Databasen

1. **unik `(organization_id, storage_key)`:** to rå `insert` med samme par gir databasefeil; samme `storage_key` i en annen organisasjon godtas (viser at begrensningen er sammensatt).
2. **kolonnene:** `information_schema.columns` for `files` har `organization_id` (ikke tom), `deleted_at`, `deleted_by`, `retain_until` (kan være tom), `sha256`, `size_bytes`.
3. **`organization_id` påkrevd:** rå `insert` uten den gir databasefeil.
4. **`resetDatabase` tømmer `files`.**

## 7. Fabrikken, `tests/factories.test.ts` (utvides)

1. `createFile(orgA)` gir en rad med riktig `organization_id` og `storage_key`-format.
2. Med `storage`: filen finnes i porten, og `sha256` på raden stemmer med innholdet.

## 8. E2e

Ingen nye. `pnpm test:e2e` (PC og iPad-størrelse) skal være grønn uendret, særlig `e2e/fase-1-prove-d-bilder.spec.ts`. Ingen del virker uten nett, så ingen test uten nett.

## 9. Kontroller i gjennomgangen (test-leder)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- `git diff main -- src/modules/offline-trial` er tom (prøvekandidatene og `photo-storage.ts` uendret).
- `src/core/files` importerer ikke fra `src/modules`.
- `@azure/storage-blob` importeres bare i Azure-adapteren (`grep -rn "@azure/storage-blob" src`).
- Ingen `delete(files)` eller `unlink`/`rm` i `src/core/files`.
- Ingen ekte nøkler i `.env.example` (tomme verdier, heller ikke Azurite-nøkkelen) eller i testene.
- Ingen test skriver i `var/files`.
- Versjon 0.2.51 i `package.json` (eller neste ledige patch).
- **Avvises** hvis 6.4, 6.5, 6.6 eller alle tre kallene i 6.7 mangler.
