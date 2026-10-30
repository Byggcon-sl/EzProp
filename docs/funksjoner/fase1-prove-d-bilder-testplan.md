# Testplan: Prøve D – bilder

- **Oppgavekort:** `docs/funksjoner/fase1-prove-d-bilder.md` (pkt.-numrene viser til «Omfang», AK til «Akseptkriterier»)
- **Fase:** 1 – Prøve uten nett, punktet «Prøve D»
- **Branch:** `fase1-prove-d-bilder` (bygger på `main`)
- **Dato:** 30.10.2026
- **Laget av:** test-leder, før koding. Testnavn, filnavn og markører er bindende for testskriver. Utvikler leser avsnitt 6 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** **Reklamasjoner** (testene viser at originalen kommer fram med samme fingeravtrykk, at iPaden aldri sletter før serveren har bekreftet, at visningskopien står riktig vei og aldri har GPS eller annen metadata, og at en annen organisasjon aldri får se eller skrive et bilde). **Tid** (testene viser at alt skjer av seg selv: opplasting når nettet kommer, nytt forsøk etter brudd, ingen knapp). **KI først:** ikke KI her; KI får ikke bildene i denne oppgaven.

Ekte HEIC fra kameraet, ekte rotering på iPad, flymodus og brudd midt i en fil er **ikke** del av de automatiske testene. De dekkes av resultatmalen `docs/funksjoner/fase1-prove-d-bilder-resultat.md` (D1–D5), som Ståle fyller ut når han er tilbake.

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts` (`resetDatabase`, `createOrganization`, `createUser`, `createEmployee`) og `tests/offline-trial.ts` (`ALL_ROLES`, `setupOrganization`, `createDeactivatedEmployee`, `putTrialForm`, `photoOp`): brukes i integrasjonstestene (3).
- `tests/tenant-isolation.ts` (`expectTenantIsolation`): brukes to ganger (3.3).
- Mønsteret i `src/modules/offline-trial/server/photo-storage.test.ts`: `mkdtemp` + `vi.stubEnv("TRIAL_UPLOAD_DIR", …)`, `listAll(uploadDir)` for å vise at ingen fil er skrevet.
- Mønsteret i `src/app/api/prove/regler/route.test.ts`: bare `@/core/auth/session` mockes (`getCurrentActor`); tilgangssjekken kjøres ekte mot testdatabasen.
- `e2e/helpers.ts`: `logIn`, `logInAsInspector`, `createTrialForm`, `waitForTrialHook`, `useCandidate`, `readRowsViaHook`, `syncStatus`, `countRequests`, `localPhotoFileCount`, `fixtures/test-image.png` (64x64 PNG).

### 1.1 Tillatte endringer i eksisterende tester (alt annet er «uendret»)

| Fil | Endring | Hvorfor |
|---|---|---|
| `e2e/helpers.ts` | `localPhotoFileCount` teller bare **originaler** (nøkler i `photos` som ikke slutter på `:display`); doc-kommentaren sier det. Nye hjelpere (5.1). | **Funn før koding (alvorlig hvis det ikke gjøres):** kopien lages før originalen sendes (pkt. 2). Dagens tester i `fase-1-egenbygd`, `fase-1-electricsql` og `fase-1-powersync` venter på `localPhotoFileCount(page) === 1` mens bilderuten er sperret. Med kopien i samme lager blir tallet 2, og testene feiler. Testene selv endres ikke. |
| `src/modules/offline-trial/server/photo-storage.test.ts` | bare nye tester (3.1, 3.2) | pkt. 3 |
| `src/modules/offline-trial/sync/photo-uploader.test.ts` | bare nye tester (2.3). Dagens tester for `sendPhoto` og `photoUploadTimeoutMs` står uendret. | pkt. 2 |
| `src/modules/offline-trial/sync/candidate-boundaries.test.ts` | bare nye tester (2.4) | `display-copy.ts` skal være kandidatuavhengig |

Endres en forventning i en eksisterende test, er det et funn. Alle dagens e2e skal være grønne uendret (unntatt hjelperen over), selv om hver bildeopplasting nå også gir en PUT til `/visning`.

## 2. Enhetstester (Vitest, ingen database)

### 2.1 `src/modules/offline-trial/sync/display-copy.test.ts`

Skaleringen er en teknisk regel, ikke fag, men testes som data (`it.each`-tabell), som regeltestene.

| Testnavn | Viser |
|---|---|
| «konstantene er 2000 punkter og kvalitet 0,8» | `DISPLAY_MAX_EDGE_PX === 2000`, `DISPLAY_JPEG_QUALITY === 0.8`. Endres de, må testen endres bevisst (A8). |
| «displaySize følger lengste side på 2000» | **Obligatorisk.** Én tabell: 4032x3024 → 2000x1500 · 3024x4032 → 1500x2000 · 3000x1000 → 2000x667 · 1000x3000 → 667x2000 · 4000x4000 → 2000x2000 · 2000x1500 → 2000x1500 (nøyaktig grensen) · 2001x1 → 2000x1 (aldri 0) · 64x64 → 64x64 (ikke forstørret) · 1x1 → 1x1. |
| «displaySize gir null for ugyldige mål» | tabell: (0, 100), (100, 0), (-1, 100), (`NaN`, 100), (100, `Infinity`), maxEdge 0 → `null`. |
| «displaySize gir alltid hele tall» | for alle radene over: `Number.isInteger` på bredde og høyde. |
| «makeDisplayCopy gir null og logger bare feilnavnet når dekoding feiler» | **Obligatorisk.** `vi.stubGlobal("createImageBitmap", () => Promise.reject(new DOMException("oppdiktet-bilde-7391.heic kan ikke leses", "InvalidStateError")))`. Blob med navn/innhold «oppdiktet-bilde-7391». Svar `null`. `console.warn`/`console.error` (spy) er kalt med noe som har «InvalidStateError», og `JSON.stringify` av alle argumentene har ikke «oppdiktet-bilde-7391». Kaster ikke. |
| «makeDisplayCopy gir null når nettleseren mangler createImageBitmap eller canvas» | uten `createImageBitmap` (stubbet til `undefined`) → `null`, kaster ikke. |
| «makeDisplayCopy ber om retning fra bildet» | stubbet `createImageBitmap` kalles med `{ imageOrientation: "from-image" }` som andre argument (spy). Deretter kan stubben avvise; testen ser bare på argumentet. |

Selve tegningen (canvas, JPEG, rotering) testes i e2e (5.3), der det finnes en ekte nettleser.

### 2.2 `hasMetadataSegment` (i `src/modules/offline-trial/server/photo-storage.test.ts`, egen `describe`, ingen database brukt)

JPEG-bytene bygges i testen med en liten hjelper `jpeg(...segments)` (`FF D8`, felt med merke og lengde, `FF DA`, noen bytes, `FF D9`). Ingen fixtur.

| Testnavn | Viser |
|---|---|
| «hasMetadataSegment godtar JPEG uten metadatafelt» | **Obligatorisk.** Tabell, alle `false`: bare `APP0` (JFIF) · `APP0` + `APP2` (fargeprofil) · `APP0` + `DQT` + `SOF0` + `DHT` · ingen `APPn` i det hele tatt. |
| «hasMetadataSegment avviser APP1 og APP13» | **Obligatorisk.** Tabell, alle `true`: `APP1` «Exif\0\0» etter `APP0` · `APP1` med XMP-hode (`http://ns.adobe.com/xap/1.0/\0`) · `APP13` (`Photoshop 3.0`) · `APP1` som første felt · `APP1` etter `APP2`. |
| «hasMetadataSegment ser ikke etter bildedataene» | `APP0`, `FF DA`, og deretter bytene `FF E1` inne i bildedataene → `false` (funksjonen stopper ved `FF DA`). |
| «hasMetadataSegment avviser ødelagte filer» | **Obligatorisk.** Tabell, alle `true` (regnes som avvist): tom fil · bare `FF D8` · uten `FF D8` først (PNG-hode) · avkuttet midt i et lengdefelt · lengde som peker forbi slutten · lengde 0 og lengde 1 (mindre enn 2) · ingen `FF DA` før slutten · fyllbytes `FF FF` uten merke til slutten. |
| «hasMetadataSegment henger aldri» | 1 MB tilfeldige bytes som starter med `FF D8` og 1 MB med bare `FF` → svarer innen testens tidsgrense (`it(…, { timeout: 2000 })`), gir `true` eller `false` uten å kaste. |

### 2.3 Bildekøen, nye tester i `src/modules/offline-trial/sync/photo-uploader.test.ts`

Vitest har ingen IndexedDB, og vi legger ikke til en avhengighet for det. Derfor: `vi.mock("./photo-store")` med et lager i minnet (`Map<string, Blob>` for `photos`, `Set<string>` for `confirmed`) som implementerer `getLocalPhoto`, `putLocalPhoto`, `deleteLocalPhoto`, `listLocalDisplayCopyIds`, `confirmLocalPhoto`, `listConfirmedPhotoIds`; `vi.mock("./display-copy")` med en `makeDisplayCopy` testen styrer; `fetch` stubbes og svarer per adresse (original eller `/visning`) med en kø av svar; et falskt `TrialSyncStore` med `listPendingPhotos` og `markPhotoUploaded` (som kaller `confirmLocalPhoto`). `navigator.onLine` er `true` med mindre annet står. Fingeravtrykket i svaret regnes med `crypto.subtle` fra samme bytes, så «likt» er ekte.

| Testnavn | Viser |
|---|---|
| «kopien lages fra originalen før originalen sendes, og originalen sendes før kopien» | **Obligatorisk.** Én ventende rad. Rekkefølgen av kall: `makeDisplayCopy` (med originalens blob) → `putLocalPhoto("<id>:display", …)` → PUT `/api/prove/bilder/<id>?…` → PUT `/api/prove/bilder/<id>/visning?organisasjon=…`. |
| «kopien slettes lokalt bare ved likt fingeravtrykk» | **Obligatorisk.** Svar 200 med lik sha → `deleteLocalPhoto("<id>:display")` kalt, nøkkelen borte. Originalen er bekreftet (`confirmed` har `<id>`, ikke `<id>:display`). |
| «ulikt fingeravtrykk, 404, 500, nettfeil og tidsavbrudd gir nytt forsøk neste runde» | **Obligatorisk.** Tabell over svaret på kopien: 200 med annen sha · 404 · 500 · `fetch` avviser · `sendPhoto` gir `undefined`. Etter runde 1: kopien ligger fortsatt. Runde 2 (original allerede bekreftet, så den sendes ikke): én ny PUT til `/visning` for samme id, ingen PUT til originalen. |
| «400 på kopien sletter den lokalt uten nytt forsøk» | **Obligatorisk** (AK 7). Svar 400 → `deleteLocalPhoto("<id>:display")`. Runde 2 og 3: null PUT til `/visning` for den id-en. Originalen er bekreftet og påvirkes ikke. |
| «makeDisplayCopy som gir null stopper ikke originalen eller neste bilde» | **Obligatorisk.** To ventende rader; `makeDisplayCopy` gir `null` for den første. Begge originalene sendes og bekreftes, kopi bare for den andre. Ingen `<første>:display` i lageret. |
| «makeDisplayCopy som kaster stopper ikke originalen eller neste bilde» | som over, men `makeDisplayCopy` kaster `new Error("x")`. Runden avviser ikke (`resolves`). |
| «kopien lages ikke på nytt når den finnes» | `<id>:display` ligger i lageret fra før, originalen venter → `makeDisplayCopy` kalt 0 ganger, den eksisterende kopien sendes. |
| «bekreftet original uten kopi gir ingen ny kopi» | `confirmed` har `<id>`, `photos` har ikke `<id>`, ingen ventende rad → `makeDisplayCopy` kalt 0 ganger, ingen PUT. (Appen ble lukket mellom bekreftelse og kopi; telles i D4.) |
| «visningskopien er aldri en rad og telles ikke som ventende» | lageret har bare `<id>:display` (ingen ventende rad) → `listPendingPhotos` er urørt, `uploadPendingPhotos` returnerer 0 (antall bekreftede originaler), og kopien sendes. Viser at kopier ikke kommer i «Venter: N bilder» og ikke i `released`. |
| «visningskopien havner aldri i confirmed» | etter en vellykket runde: `listConfirmedPhotoIds()` har `<id>` og ingen nøkkel med `:display`. |
| «kopiene sendes ikke uten nett» | `navigator.onLine = false` og en kopi i lageret → null `fetch`. |
| «nøkkel med ugyldig id sendes ikke» | `listLocalDisplayCopyIds` gir `"ikke-en-uuid"` → ingen PUT (samme `isUuid`-vakt som originalen). |
| «sendPhoto til visningsruten sender JPEG og samme tidsavbrudd» | den nye adressen (`/api/prove/bilder/<id>/visning?organisasjon=<org>`) får `Content-Type: image/jpeg`, `method: "PUT"`, `credentials: "same-origin"`; tidsavbruddet gir `undefined` som dagens test (`vi.useFakeTimers`). Ingen `skjema`/`navn` i adressen til kopien. |

### 2.4 Nye tester i `src/modules/offline-trial/sync/candidate-boundaries.test.ts`

| Testnavn | Viser |
|---|---|
| «display-copy.ts importerer ikke fra noen kandidat og ikke React» | ingen spesifikator treffer `CANDIDATE_SPECIFIER`, ingen `react`. |
| «display-copy.ts har hodekommentaren» | inneholder `HEADER`. |
| «photo-uploader.ts importerer fortsatt ingen kandidat» | finnes den fra før, er den uendret; ellers ny. |

## 3. Integrasjonstester (testdatabasen)

`resetDatabase()` i `beforeEach`; egen `mkdtemp`-mappe som `TRIAL_UPLOAD_DIR` per test. Originalen legges inn med `storeTrialPhoto` (ekte rute til raden, `sha256` og `uploaded_at`). Alle data er oppdiktet. JPEG-kopien i testene er bytes fra hjelperen i 2.2 (`APP0` + bildedata), ikke et ekte bilde.

### 3.1 `storeTrialDisplayCopy` og `storeTrialPhoto` (i `photo-storage.test.ts`, `describe("storeTrialDisplayCopy")`)

| Testnavn | Viser |
|---|---|
| «lagrer kopien som <id>.display.jpg under TRIAL_UPLOAD_DIR/<organizationId> og svarer sha256» | **Obligatorisk.** Fil på `uploadDir/<org>/<id>.display.jpg`, bytene like, `sha256` i svaret lik `createHash` av bytene. Originalfilen `uploadDir/<org>/<id>` er uendret (samme sha som før). |
| «annen type enn image/jpeg gir InvalidTrialChangeError uten fil» | tabell: `image/png`, `image/heic`, `image/jpeg; charset=x`(utvikler velger om parametre godtas; testen låser valget), `""`, `text/plain` → avvist, ingen `.display.jpg`. |
| «fil uten FF D8 først gir InvalidTrialChangeError uten fil» | PNG-hode → avvist. |
| «kopi med APP1 eller APP13 gir InvalidTrialChangeError uten fil» | **Obligatorisk** (AK 6). `APP1` Exif med oppdiktet GPS-felt, `APP1` XMP, `APP13` → avvist, ingen fil. |
| «ødelagt eller avkuttet kopi gir InvalidTrialChangeError, aldri annen feil» | **Obligatorisk.** Avkuttet fil og lengde forbi slutten → `InvalidTrialChangeError` (blir 400, ikke 500). |
| «for stor kopi gir TrialPhotoTooLargeError uten fil» | `TRIAL_PHOTO_MAX_BYTES` stubbet lavt. |
| «ugyldig id gir TrialPhotoNotFoundError uten fil» | `"../x"`, `"ikke-en-uuid"` → 404-feil, `listAll(uploadDir)` har ingen ny fil. |
| «404 når raden ikke finnes, er slettet, mangler sha256 eller uploaded_at» | **Obligatorisk** (AK 6, 8). Tabell: ukjent uuid · rad med `deleted_at` satt (oppdatert direkte i testen etter `storeTrialPhoto`) · rad laget av synken (`applyTrialChanges` med `photoOp`) uten fil, så `sha256`/`uploaded_at` er tomme → alle `TrialPhotoNotFoundError` med **samme melding**, ingen `.display.jpg`. |
| «storeTrialPhoto gir 404 for slettet rad» | **Obligatorisk** (AK 8, retting i pkt. 3). Rad med `deleted_at` → `TrialPhotoNotFoundError`, filen på disk og `sha256`/`uploaded_at` i raden er uendret. |
| «den ferdige stien til kopien ligger alltid under TRIAL_UPLOAD_DIR/<organizationId>» | etter vellykket lagring: `path.relative(uploadDir, fil)` starter med `<grant.organizationId>/` og har ingen `..`. |
| «kopien endrer ikke raden» | `trial_photos`-raden (`sha256`, `storage_path`, `uploaded_at`, `updated_at`) er lik før og etter. Ingen ny kolonne, ingen migrering. |

### 3.2 `readTrialDisplayCopy` (`describe("readTrialDisplayCopy")`)

| Testnavn | Viser |
|---|---|
| «gir bytene til kopien» | etter `storeTrialDisplayCopy` → samme bytes. |
| «uten kopi gir 404 med Bildet er ikke lastet opp ennå.» | original lastet opp, ingen kopi → feilen som ruten gjør om til 404 med `{ feil: "Bildet er ikke lastet opp ennå." }` (se K4). |
| «slettet rad gir 404 selv om filen finnes» | **Obligatorisk** (AK 8). Kopi lagret, så `deleted_at` satt → 404. Filen er fortsatt på disk (ingenting slettes permanent). |
| «ukjent og ugyldig id gir 404» | uuid som ikke finnes, `"../x"` → 404, ingen fil lest utenfor mappen. |

### 3.3 Tenant-isolasjon (obligatorisk, AK 10)

Begge funksjonene tar én id, så de pakkes inn (som kortet sier). **Innpakningen må bare fange `TrialPhotoNotFoundError`; `AccessDeniedError` skal gå videre**, ellers viser ikke steg 3 og 4 i `expectTenantIsolation` noe. Testskriver får ikke fange `Error` generelt.

| Testnavn | Viser |
|---|---|
| «storeTrialDisplayCopy: tenant-isolasjon» | `expectTenantIsolation`: `seed` lager ett skjema og to bilder med original i både A og B (`storeTrialPhoto`), returnerer id-ene. `query(actor, org)` prøver `storeTrialDisplayCopy` for **alle** id-ene fra A og B og returnerer de id-ene som lyktes. A får bare sine, B bare sine; fremmed organisasjons-id gir `AccessDeniedError`. Etterpå: ingen `.display.jpg` under `uploadDir/<A>` for B sine id-er og omvendt. |
| «readTrialDisplayCopy: tenant-isolasjon» | samme oppsett, men `seed` lagrer også kopiene; `query` prøver `readTrialDisplayCopy` for alle id-ene. |
| «egen organisasjons-id med bilde-id fra B gir samme 404 som finnes ikke» | **Obligatorisk.** Bruker A, `organizationId` = A, bilde-id fra B (har original og kopi i B): PUT gir `TrialPhotoNotFoundError` med samme melding som ukjent uuid; filen til B (`uploadDir/<B>/<id>.display.jpg`) har samme bytes som før; ingen fil under `uploadDir/<A>`. GET gir samme svar som ukjent uuid. |

### 3.4 Ruten, `src/app/api/prove/bilder/[id]/visning/route.test.ts`

Bare `@/core/auth/session` mockes. `PUT` og `GET` kalles direkte med `Request` og `params: Promise.resolve({ id })`.

| Testnavn | Viser |
|---|---|
| «ikke innlogget gir 401 på PUT og GET uten fil» | **Obligatorisk.** `getCurrentActor` → `null` → 401, `{ feil: "Du må logge inn." }`, ingen fil skrevet, kroppen ikke lest. |
| «de fire rollene får PUT og GET» | **Obligatorisk** (AK 11). `it.each(ALL_ROLES)`: takstmann, kontor, leder, admin i egen organisasjon → PUT 200 med `{ sha256 }`, GET 200 med samme bytes. Admin er med i tabellen (admin stenges aldri ute). |
| «deaktivert ansatt nektes PUT og GET» | **Obligatorisk.** `createDeactivatedEmployee` → 403, ingen fil. |
| «fremmed organisasjon i adressen gir 403» | bruker i A, `?organisasjon=<B>` → 403 på begge. |
| «PUT svarer 400 for feil type, uten FF D8, med metadata og ødelagt fil» | statuskodene fra 3.1 gjennom ruten: 400 (aldri 500), `{ feil }` uten innhold fra filen. |
| «PUT svarer 413 for stor fil» | `Content-Length` over grensen → 413. |
| «PUT og GET svarer 404 for ugyldig id, slettet rad og original som ikke er mottatt» | tabell → 404. |
| «GET gir bildet med riktige hoder» | **Obligatorisk.** 200, `Content-Type: image/jpeg`, `Cache-Control` inneholder `private` og `no-store`, `Content-Disposition` starter med `inline`. (`X-Content-Type-Options` kommer fra `next.config.ts` og sjekkes i e2e, 5.6.) |
| «GET uten kopi gir 404 med Bildet er ikke lastet opp ennå.» | `{ feil: "Bildet er ikke lastet opp ennå." }`, `Cache-Control` `private, no-store`. |
| «loggen har aldri filinnholdet» | `logger.error` og `console.*` spionert; PUT med bytes som har teksten «Oppdiktet-innhold-7391» og 500 framprovosert (for eksempel `TRIAL_UPLOAD_DIR` til en fil i stedet for en mappe) → ingen loggmelding har teksten. |

## 4. Tilgang, tenant-isolasjon, admin, myk sletting

| Krav | Hvordan det vises |
|---|---|
| Tilgang per rolle | 3.4 «de fire rollene …» (alle fire får PUT og GET), «deaktivert ansatt …», «ikke innlogget …». Sjekken er `requireOrganizationAccess(…, "organization.read")` i serverfunksjonene; ruten har ingen egen tilgangslogikk (sjekkes ved gjennomlesing: ingen rolle-sjekk i `route.ts` eller `trial-form-view.tsx`). |
| Tenant-isolasjon | 3.3: ett `expectTenantIsolation` per ny funksjon, pluss testen med bilde-id fra B. Spørringene filtrerer på `grant.organizationId`, og stien bygges fra `grant.organizationId`, aldri fra `?organisasjon=` (3.1 «den ferdige stien …»). |
| Admin stenges aldri ute | admin er en rad i rolle-tabellen (3.4); e2e kjører som admin unntatt 5.6 der takstmann brukes. `expectTenantIsolation` bruker admin. |
| Myk sletting | slettet rad gir 404 for original og kopi (3.1, 3.2); filen på disk slettes aldri (3.2 «slettet rad …»). Ingen kode i oppgaven sletter noe på serveren (sjekkes ved gjennomlesing: ingen `rm`/`unlink`/`delete(` i `photo-storage.ts` eller ruten). Lokalt på iPaden slettes kopien bare ved likt fingeravtrykk eller 400 (2.3). |
| Ingen kundeopplysninger i logg | 2.1 «makeDisplayCopy … logger bare feilnavnet», 3.4 «loggen har aldri filinnholdet», 5.7. |

## 5. E2e (Playwright, `e2e/fase-1-prove-d-bilder.spec.ts`)

Prosjektene `pc` og `ipad` (Chromium). Kandidaten egenbygd (`useCandidate(context, "custom")`), siden den ikke trenger synktjenester. Admin er innlogget, og hver test lager eget testskjema (`createTrialForm`). Bildefeltet er «Forsidebilde». Hver test har sin egen kontekst (ny IndexedDB). Ingen `waitForTimeout`; vent med `expect.poll` på tilstand (lokale nøkler, rader fra kroken, filer på disk).

**Serveren sjekkes slik:** organisasjons-id og bilde-id leses fra kroken (`readRowsViaHook(page, "trial_photos", formId)`). Filene leses fra disk: `path.resolve("var/uploads/trial", org, id)` og `…/<id>.display.jpg` (samme `TRIAL_UPLOAD_DIR` som i `playwright.config.ts`; testen bruker konstanten, ikke en ny sti). Fingeravtrykket regnes i testen med `node:crypto` fra fixture-bytene, aldri fra noe appen har regnet.

### 5.1 Nye hjelpere i `e2e/helpers.ts`

| Hjelper | Gjør |
|---|---|
| `localPhotoFileCount(page)` (endret) | teller bare originaler (nøkler uten `:display`). Se 1.1. |
| `localDisplayCopyCount(page)` | antall nøkler i `photos` som slutter på `:display`. Åpner ikke en database som ikke finnes (som i dag). |
| `localConfirmedKeys(page)` | alle nøkler i lageret `confirmed`. |
| `trialUploadPath(organizationId, photoId, display?)` | sti på disk til original eller kopi. |
| `sha256File(path)` / `sha256Bytes(buffer)` | `node:crypto`, heks. |
| `jpegMarkers(bytes)` | egen, liten gjennomgang av JPEG-merkene fram til `FF DA` (uavhengig av `hasMetadataSegment` i produktkoden, så testen ikke sjekker koden med seg selv). Gir listen av merker, eller kaster ved ødelagt fil. |
| `decodeInPage(page, url)` | i siden: `fetch(url)` → `createImageBitmap` → `OffscreenCanvas` → `{ width, height, pixel(x, y) }` for noen punkter testen ber om. |
| `viewFromServerLink(page, fileName)` | `page.getByRole("link", { name: "Vis fra serveren" })` i raden for filnavnet. |

### 5.2 Uten nett

| Testnavn | Viser |
|---|---|
| «bilder valgt uten nett lastes opp når nettet kommer tilbake, med samme fingeravtrykk» | **Obligatorisk** (AK 3). Skjemaet åpnes med nett, `context.setOffline(true)`, velg `test-photo-rotated.jpg` og `test-image.png`. `localPhotoFileCount` = 2, ingen fil på disk. `setOffline(false)`. Poll: `localPhotoFileCount` = 0 og `localDisplayCopyCount` = 0. På disk: originalene har `sha256File` lik `sha256Bytes(fixture)`, raden fra kroken har samme `sha256`. Synkstatusen viser `0 bilder`. |

### 5.3 Rotering og metadata

| Testnavn | Viser |
|---|---|
| «visningskopien står riktig vei og har ingen metadata (EXIF-retning 6)» | **Obligatorisk** (AK 1). Velg `test-photo-rotated.jpg` (lagret 64x32, retning 6, rødt felt 16x16 oppe til venstre i de lagrede pikslene, GPS 0,0). Vent til `<id>.display.jpg` finnes. Originalen på disk: samme sha som fixturen (uendret, også GPS-feltet er der: `jpegMarkers` har `APP1`). Kopien: starter med `FF D8`, `jpegMarkers` har verken `APP1` (`FF E1`) eller `APP13` (`FF ED`), bytene har ikke teksten «Exif». `decodeInPage(GET-ruten)`: bredde 32, høyde 64 (byttet). Pikselen ved (28, 4) er rød (r > 200, g < 60, b < 60), pikselen ved (4, 4) er ikke rød. |
| «PNG blir JPEG i kopien» | `test-image.png` → kopien starter med `FF D8`, `Content-Type` `image/jpeg` fra GET. |

### 5.4 Størrelse

| Testnavn | Viser |
|---|---|
| «et bilde på 3000x1000 får kopi på 2000x667» | **Obligatorisk** (AK 2). Bildet lages i siden (`OffscreenCanvas` 3000x1000, `convertToBlob({ type: "image/jpeg" })`, base64 tilbake), `setInputFiles({ name: "stort.jpg", mimeType: "image/jpeg", buffer })`. Kopien dekodes til 2000x667. Originalen på disk har samme sha som bufferen. |
| «et lite bilde forstørres ikke» | `test-image.png` (64x64) → kopien 64x64. |

### 5.5 Brudd og fortsettelse

| Testnavn | Viser |
|---|---|
| «brudd i opplastingen: hvert bilde kommer fram én gang og bekreftede sendes ikke igjen» | **Obligatorisk** (AK 4). Tell PUT med `page.on("request")`, skilt på adresse: original (`/api/prove/bilder/<id>?`) og kopi (`/api/prove/bilder/<id>/visning?`), per bilde-id. `page.route("**/api/prove/bilder/**", …)`: første bilde slippes gjennom; velg bilde 1, vent til det er bekreftet (`localConfirmedKeys` har id-en og originalen finnes på disk). Så `abort()` for alle PUT til bilde 2 (original og kopi); velg bilde 2, vent til minst én PUT for bilde 2 er avbrutt og `localPhotoFileCount` = 1. Slipp nettet fram (`unroute`). Poll til `localPhotoFileCount` = 0 og `localDisplayCopyCount` = 0. Da: PUT-tallet for originalen til bilde 1 er **nøyaktig 1** (aldri sendt igjen); bilde 2 har ≥ 2 forsøk på originalen; etter at bilde 2 er bekreftet, kommer det ingen nye PUT for noen av dem i to nye runder (poll på at tellerne er like etter `PHOTO_UPLOAD_INTERVAL_MS * 2`, med `expect.poll` på en tidsstempel, ikke `waitForTimeout`). På serveren: kroken gir én rad per bilde-id (2 rader), disk har én original og én kopi per bilde, originalene har sha lik fixturene. `abort()` bryter før kroppen er sendt; det godtas (A9), og det ekte bruddet midt i en fil prøves i D3. |

### 5.6 HEIC og «Vis fra serveren»

| Testnavn | Viser |
|---|---|
| «HEIC som Chromium ikke kan dekode lastes opp uendret uten kopi, og neste bilde går gjennom» | **Obligatorisk** (AK 5). Velg `test-photo.heic` (`mimeType: "image/heic"`) og `test-photo-rotated.jpg` i samme valg. Poll til `localPhotoFileCount` = 0. HEIC: originalen på disk har sha lik fixturen, PUT til originalen hadde `Content-Type: image/heic`, ingen `.display.jpg`, ingen PUT til `/visning` for den id-en, `localDisplayCopyCount` = 0. JPEG-en: original og kopi finnes. GET for HEIC-ens id gir 404 med «Bildet er ikke lastet opp ennå.» (det D4 teller). |
| «Vis fra serveren åpner bildet i ny fane» | **Obligatorisk** (AK 9). Etter opplasting: `context.waitForEvent("page")` mens lenken trykkes. Ny fane: svar 200, `content-type` `image/jpeg`, `x-content-type-options: nosniff`, `cache-control` med `no-store`. Lenken har `target="_blank"` og `rel` med `noopener`. |
| «Vis fra serveren er minst 44 høy på iPad» | bare `ipad` (`test.skip` ellers): `boundingBox().height >= 44` og bredde `>= 44`. |
| «takstmann ser lenken og får åpnet bildet» | `logInAsInspector`, last opp ett bilde, lenken åpner 200 `image/jpeg`. Viser at prøvesidene ikke er stengt for takstmann. |
| «uinnlogget gir 401 på visningsruten» | bare `pc`: `request.put` og `request.get` uten innlogging → 401. |
| «annen organisasjon i adressen gir 403 på visningsruten» | bare `pc`: innlogget admin, `?organisasjon=<tilfeldig uuid>` → 403 på PUT og GET. |

### 5.7 Lokal lagring og logg

| Testnavn | Viser |
|---|---|
| «visningskopien telles ikke i Venter og havner aldri i confirmed» | sperr bare `**/visning**` (`abort()`); last opp ett bilde → originalen bekreftet, `localDisplayCopyCount` = 1, synkstatusen slutter på `0 bilder`, `localConfirmedKeys` har ingen nøkkel med `:display`. Slipp sperren → `localDisplayCopyCount` = 0. |
| «innlogging i annen organisasjon tømmer også visningskopiene» | skriv `<uuid>:display` og en original rett i lageret `photos` med `page.evaluate`, sett `TRIAL_LAST_ORGANIZATION_KEY` i `localStorage` til en annen uuid, last siden på nytt → `localPhotoFileCount` = 0 og `localDisplayCopyCount` = 0 (`clearLocalPhotos`). Erstatter Vitest-saken i kortet (Vitest har ingen IndexedDB). |
| «loggen har aldri filnavnet» | samle `page.on("console")` og `pageerror`; last opp HEIC-fixturen med navnet «oppdiktet-bilde-7391.heic» → ingen melding har «oppdiktet-bilde-7391». |

## 6. Krav til koden som testene bygger på

| Nr. | Krav |
|---|---|
| K1 | `display-copy.ts` eksporterer `DISPLAY_MAX_EDGE_PX`, `DISPLAY_JPEG_QUALITY`, `displaySize(width, height, maxEdge?) → { width, height } \| null` og `makeDisplayCopy(original: Blob) → Promise<Blob \| null>`. `makeDisplayCopy` kaster aldri; ved feil logges bare `error.name` (og en fast tekst). |
| K2 | `photo-store.ts` eksporterer `deleteLocalPhoto(key)` og `listLocalDisplayCopyIds() → Promise<string[]>`; nøkkelen bygges med én eksportert funksjon `displayCopyKey(photoId)` (`<photoId>:display`), brukt både i køen og i e2e-hjelperne (verdien skrives i hjelperne, ikke importert, fordi e2e ikke laster modulen). |
| K3 | `server/photo-storage.ts` eksporterer `hasMetadataSegment(bytes: Uint8Array): boolean` (true = avvis, også for ødelagt fil), `storeTrialDisplayCopy(actor, organizationId, photoId, contentType, bytes) → Promise<{ sha256 }>` og `readTrialDisplayCopy(actor, organizationId, photoId) → Promise<Uint8Array>`. Feil: `InvalidTrialChangeError` (400), `TrialPhotoNotFoundError` (404), `TrialPhotoTooLargeError` (413), `AccessDeniedError` (403). |
| K4 | **Funn før koding:** `trialErrorResponse` gir alltid «Fant ikke bildet.» for 404. GET uten kopi skal gi «Bildet er ikke lastet opp ennå.» (D4 i resultatmalen leser den teksten). Utvikler velger én av to og testene låser det: (a) `readTrialDisplayCopy` kaster `TrialPhotoNotFoundError("Bildet er ikke lastet opp ennå.")` og `trialErrorResponse` bruker meldingen til feilen, eller (b) ruten gir teksten selv. Uansett: ukjent id og bilde-id fra en annen organisasjon gir **samme** status og tekst. |
| K5 | `sendPhoto` får adressen (eller en markør for visningsruten) som eneste nye parameter; kopien sendes med `Content-Type: image/jpeg` og bare `organisasjon` i spørrestrengen. |
| K6 | Lenken «Vis fra serveren» er en `<a>` med `href` til GET-ruten, `target="_blank"`, `rel="noopener noreferrer"`, minst 44x44 (`min-h-11 min-w-11`), i raden for filnavnet. Ingen tilgangslogikk i komponenten. |
| K7 | Ingen endring i `src/core/auth`, mellomvare, økt eller service worker, og ingen filer som branchen `fase1-prove-f-innlogging` jobber med. |
| K8 | Ingen ny avhengighet i `package.json` (heller ikke for test). Versjon 0.2.22 → 0.2.23. |

## 7. Fixturene (`e2e/fixtures/`, sjekkes inn)

Alle er oppdiktet: ingen ekte bilder, ingen personer, GPS 0,0. Laget én gang av testskriver med verktøy i en midlertidig mappe utenfor repoet (for eksempel Python med Pillow eller ImageMagick som allerede finnes på maskinen). Ingen skript i repoet, ingen ny avhengighet. Oppskriften skrives i en kommentar øverst i spec-filen, så de kan lages på nytt.

| Fil | Innhold | Sjekk testskriver gjør før innsjekking |
|---|---|---|
| `test-photo-rotated.jpg` | 64x32 lagrede piksler, hvit bakgrunn, rødt felt 16x16 i (0,0). EXIF: `Orientation` = 6, GPS-IFD med `GPSLatitude` 0/0/0 N og `GPSLongitude` 0/0/0 E, ingen dato, ingen modell, ingen serienummer. Noen få kB. | `exiftool`/Pillow viser bare feltene over. |
| `test-photo.heic` | Liten fil (under 1 kB) som starter med en `ftyp`-boks med merket `heic`, resten oppdiktet. Chromium kan ikke dekode den. | `createImageBitmap` avviser den i Chromium (sees i 5.6). |
| `test-image.png` | finnes (64x64 PNG), uendret. | |

## 8. Akseptkriteriene og testene

| AK | Dekket av |
|---|---|
| 1 Kopien er JPEG uten metadata og står riktig vei | 5.3 «visningskopien står riktig vei …» (pc og ipad) |
| 2 Lengste side høyst 2000, lite bilde forstørres ikke | 2.1 «displaySize følger …», 5.4 |
| 3 Samme fingeravtrykk, også uten nett | 5.2 |
| 4 Brudd: hvert bilde én gang, bekreftet sendes ikke igjen | 5.5 |
| 5 HEIC lastes opp uendret, neste går gjennom | 5.6 «HEIC …» |
| 6 Server avviser APP1/APP13/ødelagt (400), 404 for rad som mangler, er slettet, ikke mottatt | 2.2, 3.1, 3.4 |
| 7 Avvist kopi slettes lokalt, ikke nytt forsøk | 2.3 «400 på kopien …» |
| 8 Slettet bilde gir 404 for original og kopi | 3.1 «storeTrialPhoto gir 404 …», 3.1 og 3.2 «slettet rad …» |
| 9 «Vis fra serveren» i ny fane, `image/jpeg`, 44 pt på iPad | 5.6 |
| 10 Annen organisasjon får ikke PUT eller GET | 3.3 (to `expectTenantIsolation` + bilde-id fra B), 5.6 «annen organisasjon …» |
| 11 Fire roller får PUT og GET; deaktivert og ikke innlogget nektes | 3.4 |
| 12 Ingen endring i auth, mellomvare, økt, service worker | avsnitt 9 |
| 13 Resultatmal, A7–A10, ordliste, plan, versjon | avsnitt 9 |
| 14 Lint, typecheck, test, test:e2e grønne | avsnitt 9 |

## 9. Sjekk ved godkjenning (test-leder)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` kjøres og er grønne (begge prosjektene).
- `git diff --stat main...HEAD -- src/core/auth src/db drizzle public/sw.js src/app/service-worker-registration.tsx src/app/logg-inn src/app/dev` er tom (det finnes ingen mellomvarefil; kommer det en, er det også et funn). Noe der → avvist (prøve F og «ingen migrering»).
- `git diff main...HEAD -- package.json` viser bare versjonen (0.2.23), ingen ny avhengighet.
- Ingen `rm`, `unlink`, `rmdir` eller `.delete(` mot serverfiler eller `trial_photos` i nye linjer.
- Ingen tilgangslogikk i `route.ts` eller `trial-form-view.tsx` (bare kall til serverfunksjonene).
- Fixturene har bare feltene i 7 (testskriver viser utskriften i PR-en).
- `docs/funksjoner/fase1-prove-d-bilder-resultat.md` finnes med D1–D5 og punktene «Før» fra kortet; A7–A10 står i `docs/09-apne-sporsmal.md`; «visningskopi» → `display copy` i ordlisten; «Stedstjenester av» og «rydd testbildene» står under «Trenger Ståle når han er tilbake».
- Mangler en test merket **Obligatorisk** for tilgang eller tenant-isolasjon (3.3, 3.4), avvises leveransen.

## 10. Ikke testet automatisk (står i resultatmalen)

- Ekte HEIC fra kameraet i Safari, og om Safari gjør HEIC om til JPEG i filvelgeren (D2).
- Rotering for ekte bilder liggende, stående og opp ned (D1).
- Brudd midt i en fil på ekte nett og flymodus (D3); `abort()` i e2e bryter før kroppen er sendt.
- Om Safari lager kopier serveren avviser (D4).
- Tid for 20 bilder (D5).
