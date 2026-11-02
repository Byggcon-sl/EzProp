# Funksjon: Felles filtjeneste for bilder og dokumenter

- **Fase:** 0b (Grunnmur)
- **Modul:** kjerne (`src/core/files`)
- **Status:** levert som PR 02.11.2026 (runde 2 innarbeidet, alle sjekker grønne: lint, typesjekk, 2109 Vitest, e2e pc og iPad 384 bestått; test-leder godkjente testrapporten). Små funn fra gjennomgangen står i PR-en og i liten oppgave (o) i `docs/agenter/tilstand.md`.
- **Branch:** `fase0b-filtjeneste` fra `main`. Versjon **0.2.51** (én patch over `main`: PR #60 ga 0.2.49, PR #61 med tilstandsfilen gir 0.2.50; står `main` på en annen versjon når PR-en åpnes, brukes neste ledige patch). Bekreftet av prosjektlederen 02.11.2026 kl. 16:50 UTC mot oppgaveteksten: omfang, «ikke med» og KI først stemmer; bare versjonen er rettet.
- **Støtter hovedmål:**
  - **Reklamasjoner:** bilder og dokumenter ligger trygt i 10 år med fingeravtrykk og myk sletting. Ved en reklamasjon kan vi vise nøyaktig hvilket bilde som var med, og at det ikke er endret.
  - **Tid:** én felles tjeneste som alle senere funksjoner (bilder, PDF, logo, signatur, vedlegg) bruker, i stedet for egen lagring per funksjon. Takstmannen merker ingenting, men alt senere går fortere å bygge.
  - **KI først:** KI-tjenestene (bildebeskrivelse, utkast til avvik) henter bildene fra samme sted med samme tilgangssjekk. Se under.

## Problem

I dag lagres bildene fra prøve D direkte i en mappe på serveren (`src/modules/offline-trial/server/photo-storage.ts`). Det går ikke i drift: filene må ligge i fillagring i EU/EØS, de skal beholdes i 10 år, og Ståle vil kunne flytte dem til et lokalt arkiv hos Byggcon senere (27.10.2026, spørsmål 10). Lar vi være, bygger hver funksjon i fase 2 sin egen lagring, og en flytting blir en ombygging.

## KI først

KI kan ikke gjøre lagringen, men tjenesten forbereder KI: alle filer har type, størrelse og fingeravtrykk i metadata, og leses gjennom én funksjon med tilgangssjekk. Når KI senere skal beskrive bilder eller foreslå avvik (fase 2b og 3), henter den bildet herfra, og bare for organisasjonen den jobber for. Ingenting KI-spesifikt bygges nå.

## Brukerhistorier

- Som **utvikler av senere funksjoner** vil jeg **lagre og hente filer gjennom én port** slik at bildene, PDF-ene og logoene havner samme sted, med samme tilgang og oppbevaring.
- Som **Ståle (admin)** vil jeg **at filene kan flyttes til et lokalt arkiv** uten ombygging, og at **oppbevaringstidene er innstillinger** jeg kan endre.
- Som **leder ved en reklamasjon** vil jeg **at et bilde aldri forsvinner** før oppbevaringstiden er ute.

## Omfang

**Med:**

1. **Porten** `FileStorage` i `src/core/files` med to operasjoner på selve filinnholdet: `put(storageKey, bytes, mimeType)` og `get(storageKey)`. Porten har ingen slette-operasjon (regel 3). `put` skriver **aldri over** en fil som finnes: lokal adapter bruker flagget `wx`, Azure bruker `conditions: { ifNoneMatch: "*" }`. Finnes nøkkelen, gir `put` feil og det første innholdet står uendret.
2. **Adapter for lokal mappe** (utvikling og test). Mappen settes med `FILE_STORAGE_DIR` (standard `var/files`). Nøkkelen kan ikke gå ut av mappen: `..`, absolutt sti, tomme deler og bakstrek avvises, og i tillegg kontrolleres det at `path.resolve(root, key)` ligger innenfor `root + path.sep`. Adapteren lager mappen selv ved første skriving. Tester bruker en midlertidig mappe (`mkdtemp`), aldri `var/files`.
3. **Adapter for Azure Blob Storage, bare kode.** Slås på med `FILE_STORAGE_DRIVER=azure` og `FILE_STORAGE_AZURE_CONNECTION_STRING` + `FILE_STORAGE_AZURE_CONTAINER`. Standard er `local`. Ingen ressurser i Azure, ingen endring i `infra/` eller utrullingen. Klienten sendes inn som parameter og testes med en falsk klient, aldri mot nett. Mangler innstillingene når `azure` er valgt, kaster funksjonen som lager adapteren en tydelig feil som nevner variabelnavnet, men aldri verdien. Ingen egen sjekk ved oppstart. Feil fra Azure-klienten pakkes inn i en egen feil uten den opprinnelige meldingen (den kan inneholde nøkler). `@azure/storage-blob` importeres bare i adapteren.
4. **Tabellen `files`** (metadata, ny migrering) etter domenemodellen: `organization_id`, `storage_key`, `kind`, `mime_type`, `size_bytes`, `sha256`, `retain_until` (kan være tom), felles kolonner med `deleted_at`/`deleted_by`. Unik på `(organization_id, storage_key)`.
5. **Tjenesten** i `src/core/files` (det modulene kaller):
   - `saveFile(actor, organizationId, { kind, mimeType, bytes })`: tilgangssjekk, validering med Zod (ugyldig `kind` eller filtype avvises før noe skrives), regner SHA-256, lager `storage_key` = `<organizationId>/<kind>/<fileId>` (aldri filnavn fra brukeren), skriver filen via porten **og så** raden. Gir tilbake id, sha256 og størrelse. Feiler skrivingen av raden etter at filen er lagret, blir filen liggende uten rad. Det er akseptert (ingenting slettes, og filen kan ikke nås uten rad). Feilen som kastes, inneholder ikke sti eller hemmeligheter.
   - `readFile(actor, organizationId, fileId)`: tilgangssjekk, finner raden med `grant.organizationId`, kontrollerer at `storage_key` begynner med `grant.organizationId + "/"` (ekstra forsvar), henter innholdet og kontrollerer fingeravtrykket. Slettet rad, eller en fil-ID fra en annen organisasjon, gir «ikke funnet».
   - `markFileDeleted(actor, organizationId, fileId)`: setter `deleted_at`/`deleted_by`. Filen i lagringen røres ikke. Avvises hvis `retain_until` er i fremtiden, også for admin. Tillatt når `retain_until` er tom eller passert. Skriver én rad i revisjonsloggen med bare `fileId`, `kind` og `organizationId` (ingen filnavn, ikke innhold). En fil-ID fra en annen organisasjon gir «ikke funnet» og endrer ingenting.
   - Største filstørrelse: konstant 25 MB ett sted (samme som prøve D). Nøyaktig 25 × 1024 × 1024 byte godtas, én byte mer avvises. Tom fil (0 byte) avvises.
   - Gyldige filtyper er en fast liste per `kind`: `photo` = `image/jpeg`, `image/png`, `image/heic`, `image/webp`; `report_pdf` = `application/pdf`; `document` = `application/pdf`, `image/jpeg`, `image/png`. Ikke `image/svg+xml`, `text/html` eller annet som kan kjøre kode når filen vises. Ukjent type avvises.
6. **Oppbevaringstider som innstillinger** i `organizations.settings`, lest med én funksjon (`readFileRetention`) med standardverdier og advarsel i loggen ved ugyldig verdi, samme mønster som `access.inspectors_edit_all`. Nøklene er de tre i domenemodellen 4.8:
   - `photo.retention.deviation_original_years` = 10
   - `photo.retention.other_original_years` = 2
   - `photo.retention.display_years` = 10

   Gyldig verdi er et heltall fra 1 til og med 100. Alt annet gir standardverdien og en advarsel i loggen med bare organisasjon og nøkkel. Fasit for testen: `0`, `-1`, `2.5`, `"10"` (tekst), `null`, `NaN` og `101` er ugyldige; `1`, `10` og `100` er gyldige. Minstetiden er Ståles valg og hardkodes ikke utover dette. Utregning av `retain_until` (og nøkkel for PDF og dokumenter) kommer i fase 2 sammen med utgivelsen.
7. **Gjenbruk fra prøve D:** fingeravtrykk (SHA-256) og grensen på 25 MB følger samme mønster. Prøvekandidatene og `photo-storage.ts` **røres ikke**; de flyttes til tjenesten når synkløsningen er godkjent (ADR 0004).
8. **Loggeren vasker Azure-hemmeligheter** (`src/shared/lib/logger.ts`): `scrubText` vasker `AccountKey=[^;]+`, `SharedAccessSignature=[^;]+` og `sig=[^&\s]+`; `SENSITIVE_KEY` får `connectionstring`, `accountkey` og `sas`. Test i `logger.test.ts`.
9. Tester (se akseptkriterier og testplan), fabrikken `createFile(organizationId, overrides)` i `tests/factories.ts`, `.env.example` (tomme verdier, heller ikke Azurite-nøkkelen, og merknad om at kontoen skal ligge i Sweden Central, containeren være privat og at Microsofts databehandleravtale gjelder), `docs/05-domenemodell.md` (files og innstillingene), ordlisten, `docs/06-arkitektur.md` (porten, region og privat container, og at en senere visningsrute skal sende `Content-Disposition` og `X-Content-Type-Options: nosniff`). `start.sh` endres ikke; `var/` står allerede i `.gitignore`.

**Ikke med (bevisst utelatt):**

- Skjermer, opplastingsrute eller API-rute. Ingen bruker filene ennå; første bruker er bilder i fase 2.
- Flytting av prøve D-bildene eller endring av prøvekandidatene.
- Tabellen `photos`, visningskopi, miniatyrer, rotering og HEIC (fase 2b).
- `exists` i porten, `retainUntil(from, years)`, nøkkelen `file.retention.default_years` og `kind`-kodene `logo`, `signature` og `attachment`. De legges til når en funksjon trenger dem (fase 2).
- Utregning av `retain_until` ved utgivelse, og opprydding når oppbevaringstiden er ute (ingen sletting av filinnhold i det hele tatt nå).
- Adapter for lokalt arkiv hos Byggcon (porten gjør det mulig; selve adapteren lages når Ståle ber om det).
- `integration_connections` og tilkoblingslaget (eget punkt i fase 0b). Valg av adapter skjer med miljøvariabel inntil da.
- Lagringskonto, container eller nøkler i Azure, endring i Bicep eller utrulling, Key Vault (eget punkt). Alt som koster penger.
- Innstillinger på selskap- og personnivå, og skjerm for å endre innstillingene.
- Fjerning av EXIF og GPS fra bilder (fase 2b, sammen med `photos`).
- Virusskanning, kryptering utover det lagringen gir, deling med lenke.

## Tilgang

All sjekk i `src/core/access` via `requireOrganizationAccess`. Spørringer filtrerer på `grant.organizationId`.

| Rolle | Se (hente fil) | Lagre fil | Merke som slettet |
|---|---|---|---|
| takstmann | ja (`organization.read`) | ja | nei |
| kontor | ja | ja | nei |
| leder | ja | ja | nei |
| admin | ja | ja | ja (`organization.manage`) |

Lagre krever `organization.read` (alle ansatte laster opp bilder og dokumenter; den som kaller fra en modul gjør sin egen fagsjekk, for eksempel `report.edit`). Merke som slettet krever `organization.manage`, og aldri før `retain_until` er passert. Admin stenges ikke ute.

## Data

- Ny tabell **`files`** (se Omfang 4) med migrering. `kind` er en fast liste: `photo`, `report_pdf`, `document` (faste koder, regel 6; flere legges til når de trengs).
- Nye innstillingsnøkler i `organizations.settings` (Omfang 6). Ingen migrering av eksisterende rader; standardverdiene gjelder når nøkkelen mangler.
- Oppdater `docs/05-domenemodell.md` (`files`, innstillingene) og ordlisten (`file storage`, `storage key`, `retain until`).

## Skjermer

Ingen.

## Regler

Ingen fagregler. Tekniske regler med tester: nøkkelen kan ikke gå ut av mappen; `put` skriver aldri over; fingeravtrykket må stemme ved henting; `retain_until` i fremtiden hindrer myk sletting; fast liste over filtyper per `kind`.

## Akseptkriterier

- [x] `saveFile` + `readFile` gir samme innhold og samme SHA-256, med lokal mappe (Vitest mot testdatabasen og en midlertidig mappe).
- [x] Endret fil i lagringen gir feil ved henting (fingeravtrykket stemmer ikke).
- [x] Nøkkel med `..`, absolutt sti, tomme deler eller bakstrek avvises av den lokale adapteren, og en løst sti utenfor mappen avvises.
- [x] `put` to ganger på samme nøkkel gir feil, og det første innholdet står uendret (lokal og falsk Azure-klient).
- [x] `storage_key` er `<org>/<kind>/<fileId>` og inneholder aldri filnavn fra brukeren.
- [x] Fil over 25 MB avvises før noe skrives (ingen fil i mappen, ingen rad). Nøyaktig 25 MB godtas. Tom fil avvises.
- [x] Ugyldig `kind` og ugyldig filtype (for eksempel `image/svg+xml`, `text/html`) avvises før noe skrives.
- [x] Feiler skrivingen av raden etter at filen er lagret, finnes ingen rad, og feilen inneholder ikke sti eller hemmeligheter.
- [x] `markFileDeleted` setter `deleted_at`/`deleted_by`, filen ligger fortsatt i mappen, og `readFile` gir «ikke funnet» etterpå. Revisjonsloggen har én rad med bare `fileId`, `kind` og `organizationId`.
- [x] `markFileDeleted` avvises når `retain_until` er i fremtiden, også for admin. Tillatt når `retain_until` er tom eller passert.
- [x] Rollematrise: takstmann, kontor og leder kan lagre og lese, men ikke merke som slettet. Admin kan alt. En ansatt med både takstmann og admin kan merke. En deaktivert ansatt nektes alt.
- [x] Admin stenges ikke ute: admin kan lagre, lese og merke også når `access.inspectors_edit_all` er false.
- [x] Azure-adapteren lagrer og henter mot en falsk klient (ingen nett). `FILE_STORAGE_DRIVER=azure` uten tilkoblingsstreng eller uten container gir feil som nevner variabelnavnet; med `CONNECTION_STRING=hemmelig-test-verdi` og manglende container inneholder meldingen ikke verdien. Standard er lokal adapter.
- [x] Loggeren vasker `AccountKey=`, `SharedAccessSignature=` og `sig=` i tekst, og nøklene `connectionString`, `accountKey` og `sas` i objekter.
- [x] `readFileRetention` gir 10/2/10 uten innstillinger, leser egne verdier, og faller tilbake til standard med advarsel (bare organisasjon og nøkkel) for alle ugyldige verdier i fasiten under Omfang 6.
- [x] **Fremmed fil-ID i egen organisasjon:** en bruker i B som kaller `readFile(actorB, orgB, fileIdFraA)` eller `markFileDeleted(actorB, orgB, fileIdFraA)`, får «ikke funnet», og raden i A er uendret (`deleted_at` fortsatt tom).
- [x] `expectTenantIsolation` kalles én gang for **hver** operasjon, med egen innpakning: `readFile` (gir `[{id}]` for hver lagret id), `saveFile` (lagrer og gir raden), `markFileDeleted` (merker en fil uten `retain_until` og gir raden). Finnes en intern funksjon som henter raden, får den også sitt eget kall.
- [x] Unik på `(organization_id, storage_key)` er testet, og samme nøkkel i en annen organisasjon godtas. At migreringen har `deleted_at`/`deleted_by`, vises av testene for `markFileDeleted` (ingen egen kolonnetest; migreringer og `resetDatabase` dekkes av `tests/factories.test.ts`).
- [x] Lint (inkludert modulgrensene), typesjekk og alle tester grønne. Prøvekandidatene er uendret.
- [x] Ny avhengighet (`@azure/storage-blob`) er begrunnet i PR-en.
- [x] Virker på iPad-størrelse: ikke relevant (ingen skjerm); eksisterende e2e skal fortsatt være grønn.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)

- **A39:** Porten har ingen slette-operasjon. «Slette» er bare `deleted_at` på raden; filinnholdet blir liggende. Opprydding etter oppbevaringstiden lages senere og må godkjennes. Kilde: regel 3, Ståles svar 25.10.2026 nr. 9 (minst 10 år), domenemodellen 4.12 («Ingenting med `retain_until` i fremtiden kan slettes, heller ikke av admin»).
- **A40:** Adapteren velges med miljøvariabel (`FILE_STORAGE_DRIVER`, standard `local`) til tilkoblingslaget med `integration_connections` kommer. Azure-adapteren er bare kode; Ståle slår den på når lagringskontoen finnes. Kilde: Ståles svar 27.10.2026 nr. 10 (eget lag, mulig lokalt arkiv), autonom modus (ingenting som koster penger).
- **A41:** Én ny avhengighet, `@azure/storage-blob` (Microsofts offisielle klient), i stedet for egen signering mot REST-grensesnittet. Enklere og sikrere. Kan byttes uten at resten av koden endres, fordi den bare brukes i adapteren.
- **A42:** Oppbevaringstidene ligger i `organizations.settings` med standard 10 år for avviksoriginaler, 2 år for andre originaler og 10 år for visningskopier (de tre nøklene i domenemodellen 4.8). Gyldig verdi er heltall 1–100; ellers brukes standard med advarsel. Nøkkel for PDF og dokumenter lages i fase 2 med utgivelsen. Kilde: Ståles svar 25.10.2026 nr. 9 og 27.10.2026 nr. 10, domenemodellen 4.8. Endres ved å skrive ny verdi i innstillingene.
- **A43:** Alle ansatte kan lagre og hente filer; bare admin kan merke en fil som slettet. Kilde: Ståles svar 27.10.2026 (alle takstmenn ser alt), regel 3. Kan strammes inn i `src/core/access`.

## Testplan (testskriver følger denne)

**Enhetstester** (`src/core/files/*.test.ts`, midlertidig mappe med `mkdtemp`):
- local-storage: avviser `..`, absolutt sti, tom del, bakstrek og løst sti utenfor mappen; put/get rundtur; put to ganger gir feil og første innhold står.
- azure-storage med falsk klient: put/get rundtur; put to ganger gir feil; Azure-feil pakkes inn uten opprinnelig melding.
- config: standard lokal; azure uten tilkoblingsstreng kaster; azure uten container kaster; hemmelig verdi står ikke i meldingen.
- readFileRetention: standard 10/2/10; egne verdier; tabelltest med fasiten (0, -1, 2.5, "10", null, NaN, 101 ugyldig; 1, 10, 100 gyldig).
- logger: vasking av Azure-hemmeligheter.

**Integrasjonstester mot testdatabasen** (`files.service.test.ts`): alle akseptkriteriene over som gjelder tjenesten, med fabrikken `createFile` (med `deletedAt` og `deletedBy` i `FileOverrides`) og `auditRows`.

**Én testfil per kildefil** (`local-storage`, `azure-storage`, `config`, `retention`, `files.service`, `static-checks`, pluss `logger.test.ts`). Ingen `*.plan.test.ts`, ingen røyktest ved siden av. Samme mønster som PR #55 for admin.

**E2e:** ingen nye. Hele pakken (PC og iPad-størrelse) skal være grønn.

**Kontroller i gjennomgangen:** `git diff main -- src/modules/offline-trial` er tom; `src/core/files` importerer ikke fra `src/modules` (lint-regelen for modulgrenser, ingen egen test); `@azure/storage-blob` importeres bare i adapteren (`static-checks.test.ts`); ingen ekte nøkler i `.env.example` eller testene; versjon 0.2.51. Test-leder godkjenner ikke uten kriteriet om fremmed fil-ID og tenant-isolasjon for alle tre operasjonene.

## Endringer etter gjennomgang (runde 1, avgjort av prosjektlederen)

- **Forenkler, alle seks kutt tatt:** `exists`, `retainUntil` og `file.retention.default_years` ut (ingen bruker dem nå; lages i fase 2 med utgivelsen). `kind` bare `photo`, `report_pdf`, `document` (faste koder kan ikke tas tilbake, regel 6). `start.sh` endres ikke (adapteren lager mappen; `var/` er allerede i `.gitignore`). Ingen egen oppstartssjekk; funksjonen som lager adapteren kaster. Testplanens punkter for `exists` og `retainUntil` er derfor tatt ut.
- **Sikkerhet-personvern, alle sju punkt tatt:** ingen overskriving, vasking i loggeren, ekstra sjekk av nøkkelprefiks og løst sti, fast liste over filtyper, grenser for oppbevaringstid, EU/EØS-merknad og privat container, og minimal revisjonslogg. Region og databehandleravtale kan ikke sjekkes i koden og føres under «Trenger Ståle når han er tilbake».
- **Test-leder, alle fem punkt tatt:** fremmed fil-ID, tenant-isolasjon per operasjon, fasit for oppbevaringstid (0 er ugyldig, øvre grense 100 år, samme som sikkerhet-personvern foreslo), grensen på 25 MB og tom fil, og rekkefølgen fil først, så rad.
- Ingen uenighet mellom rollene som måtte avgjøres. Grensen 1–100 år og filtypelisten er tekniske vern, ikke fagvalg; standardverdiene er fortsatt Ståles.

## Endringer etter gjennomgang (runde 2, avgjort av prosjektlederen 02.11.2026)

Forenkler og test-leder ba om det samme: doble tester. Ingen uenighet om koden. Alt under gjøres av utvikler og testskriver på branchen før PR; test-leder godkjenner ikke hvis tenant-kallene eller rollematrisen faller bort.

1. **Doble testfiler slås sammen, én fil per kildefil.** `*.test.ts` (testskriverens) er grunnlaget, fordi de er mest komplette (fire `expectTenantIsolation`-kall, «ukjent driver», 6a/6b/7 for deaktivert, uten roller og ikke ansatt). Fra `*.plan.test.ts` tas bare det som mangler: `files.service.plan` 6.1.6 andre variant («nøkkel, fingeravtrykk og størrelse kopiert: bare prefikssjekken stopper») inn som 6.1.6b ved siden av dagens 6.1.6, og 6.8.1 utvides til å vise at samme nøkkel i en annen organisasjon godtas. Deretter slettes `retention.plan.test.ts`, `local-storage.plan.test.ts`, `azure-storage.plan.test.ts`, `config.plan.test.ts` og `files.service.plan.test.ts`.
2. **`src/core/files/service.test.ts` (røyktesten) fjernes helt.** Alt den tester, står i `files.service.test.ts` og `retention.test.ts`.
3. **`files.service.test.ts` 6.8.2–6.8.4 fjernes** (kolonnene finnes, `organization_id` påkrevd, `resetDatabase` tømmer `files`). Det tester migreringen og `RESET_TABLES`, som `tests/factories.test.ts` alt dekker. Bare 6.8.1 (unik indeks) står. Akseptkriteriet er justert tilsvarende.
4. **`static-checks.test.ts`:** testen «importerer ikke fra modulene» fjernes (lint-regelen for modulgrenser, regel 4, gjør jobben). «Ingen sletting» og «Azure-import bare i adapteren» står.
5. **`src/shared/lib/logger.test.ts`:** Azure-vaskingen står to ganger. Behold `describe("logger vasker Azure-hemmeligheter")` (nummerert 1–4, samsvarer med testplanens punkt 5) og fjern de fire Azure-testene inne i `describe("logger")`.
6. **Fabrikken:** `FileOverrides` i `tests/factories.ts` får `deletedBy?: string | null`, så 6.3.5 («allerede merket») kan vise at `deleted_by` står urørt uten omvei.
7. **Azure-adapteren står (A41 gjelder).** Forenkler pekte på at oppgaveteksten sier «bare grensesnittet og innstillingen forberedes», mens kortet bygger hele adapteren med `@azure/storage-blob`. Avgjort: adapteren beholdes, fordi (a) den er alt bygget og testet mot en falsk klient, isolert til én fil, og kan fjernes uten at noe annet endres; (b) den viser at porten faktisk holder for en annen lagring enn mappe (ingen overskriving med `ifNoneMatch: "*"`), slik at laget ikke bare er en påstand; (c) å ta den ut nå er mer arbeid enn å la den stå. Prisen er én ny avhengighet, som begrunnes i PR-en (regel 9), og at adapteren **ikke er prøvd mot ekte Azure**. Det føres under «Trenger Ståle når han er tilbake»: adapteren prøves mot lagringskontoen før `FILE_STORAGE_DRIVER=azure` slås på i testmiljøet. Ingen beslutning i `docs/09-apne-sporsmal.md` endres.
8. **Ikke gjort nå, små funn i PR-en:** `src/core/files/index.ts` eksporterer `isInsideRoot`, `createAzureFileStorage`, `createLocalFileStorage` og `findActiveFile`, som bare testene bruker (`findActiveFile` er godtatt for tenant-testen). Tas i den lille oppgaven etter PR-en, samme mønster som (k) for `@/core/access`.

Etter ryddingen kjøres lint, typesjekk, Vitest og hele e2e på nytt før PR.

## Roller

- **forenkler** (runde 1 og 2)
- **utvikler** (bit 1: port, adaptere, skjema, migrering, tjeneste, innstillinger, dokumenter)
- **testskriver** (bit 2, i parallell: tester etter akseptkriteriene, fabrikk for `files`, tenant-isolasjon)
- **sikkerhet-personvern** (sti utenfor mappen, hemmeligheter i miljøvariabler og feilmeldinger, tilgang, ingen sletting)
- **test-leder** (testplan og gjennomgang)

Ikke med: ux, ui (ingen skjerm), fagansvarlig (ingen fagtekst), arkitekt (porten står allerede i domenemodellen og arkitekturen; ingen ADR trengs), KI.

## Åpne spørsmål

- Ingen som stopper PR-en. Når Ståle er tilbake (føres under «Trenger Ståle når han er tilbake»): lagringskonto i Azure i Sweden Central (koster penger), privat container, at Microsofts databehandleravtale for Azure dekker lagringen, hvor nøkkelen skal ligge (Key Vault, eget punkt), og at Azure-adapteren prøves mot den ekte kontoen før den slås på (den er bare testet mot en falsk klient).
