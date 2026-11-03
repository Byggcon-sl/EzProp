# Funksjon: Liten oppgave (o), (p) og (q) – småfunn fra filtjenesten (PR #62), tilkoblingslaget (PR #64) og tenant-testen (PR #66)

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/files`, `src/core/email`, `src/core/integrations`, `src/shared/lib/logger.ts`, `tests/`)
- **Status:** klar (runde 1 fra sikkerhet-personvern og test-leder innarbeidet 03.11.2026)
- **Branch:** `fase0b-smafunn-filtjeneste-tilkobling` (bygger på `main`; PR #62, #64 og #66 er merget)
- **Versjon:** 0.2.56 → 0.2.57
- **Støtter hovedmål:** Reklamasjoner: en tilkobling admin har slått av, slås ikke på igjen av en sending som pågikk, og admin ser den ekte sendefeilen (ikke en databasefeil som kom etterpå); loggen viser hvorfor en fil ikke kunne lagres eller leses, uten hemmeligheter; vakten i tenant-testen sier hvilken tabell som mangler i stedet for et tall. Tid: færre doble tester og én hjelper i stedet for to kopier gir mindre å vedlikeholde og raskere CI. KI først: ikke direkte (se under).

## Problem
Gjennomgangene av PR #62 (felles filtjeneste), PR #64 (tilkoblingslag med første tilkobling e-post) og PR #66 (test av tenant-isolasjon for alle nye tabeller) fant små ting som ikke stoppet mergen, men som skal rettes før laget brukes av innlogging og rapporter i fase 2. Funnene står ordrett i `docs/agenter/tilstand.md` under «Små oppgaver» (o), (p) og (q). Rekkefølge: reelle feil først, så manglende tester, så rydding.

**Reelle feil**

*(p) Tilkoblingslaget*
1. `sendEmail` (`src/core/email/index.ts`) setter `status = active` uten vilkår etter vellykket sending, og filtrerer ikke på `deleted_at`. Setter admin raden til `disabled` eller sletter den mens en sending pågår, overstyres valget. Kortet for PR #64 (Omfang 64) sier «`status` settes til `active` om den sto i `error`».
2. I feilgrenen i `sendEmail` kastes databasefeilen i stedet for sendefeilen hvis skrivingen av `last_error` svikter. Admin ser da feil årsak.
3. `CLIENT_SECRET`-mønsteret i `src/shared/lib/logger.ts` mangler `i`-flagget (Azure-mønstrene har `gi`), så `Client_Secret=…` slipper gjennom.
4. `microsoft365SettingsSchema` har ingen øvre lengde på `clientId` og `from`.

*(o) Filtjenesten*
5. `SENSITIVE_KEY` i `logger.ts` treffer ikke `FILE_STORAGE_AZURE_CONNECTION_STRING` som feltnavn (etter normalisering `filestorageazureconnectionstring`; listen har bare `connectionstring`).
6. `saveFile` logger ikke den opprinnelige databasefeilen (loggeren vasker alt etter `params:`), og `readFile` logger ikke når størrelse eller fingeravtrykk ikke stemmer. Da er det ingenting å feilsøke på.

**Manglende tester**

*(o)*
7. Ingen test for `FILE_STORAGE_DRIVER=azure` med begge innstillingene satt.
8. Test 6.4.2 i `files.service.test.ts` sjekker ikke «ingen loggrad» for takstmann, kontor og leder.

**Rydding**

*(q) Tenant-testen*
9. U1 i `tests/tenant-isolation-all-tables.test.ts` bruker `RESET_TABLES.length - 6` som fasit for antallet tabeller. En glemt tabell gir «forventet 13, fikk 14», ikke navnet.

*(p)*
10. `isUniqueViolation` i `src/core/integrations/connections.ts` er en kopi av hjelperen i `src/core/organization/errors.ts`.
11. `senderForConnection` i `resolve.ts` validerer `settings` for `microsoft365` to ganger (`settingsSchemaFor(...).safeParse` og `microsoft365SettingsSchema.parse`), så begge må eksporteres bare for det.
12. `findActiveConnection` har en ubrukt `executor`-parameter. To overflødige sjekker i `sendEmail` (`.slice(0, MAX_LAST_ERROR)` etter `scrubText` som alt kutter til 500, og `|| !options.organizationId`). Ubrukt type `IntegrationConnectionRecord` i `src/db/schema/integration-connections.ts`.
13. `src/core/integrations/integrations.dev.test.ts` (utviklerens røyktest) gjentar testskriverens tester. Doble tester: 1b/1c/1e/1f i `email.test.ts` mot fasiten i `resolve.test.ts` 7.1.1; `ports.test.ts` test 4 dekkes av typen; ni like saker for `server_log` på hver port i `connections.test.ts` 3.2; statisk test 7 i `static-checks.test.ts` søker i kildeteksten etter nektlisten. `tests/fake-fetch.ts` har svarlister, funksjonssvar og fire eksporterte konstanter ingen test bruker.

*(o)*
14. `toPlainBytes` i `storage.ts` kopierer hele innholdet bare for påstanden «ikke Buffer». Overflødig `SELECT … FOR UPDATE` i `markFileDeleted`. Ubrukte eksporter: `FileRecord` (`src/db/schema/files.ts`), `isInsideRoot`, `createAzureFileStorage`, `createLocalFileStorage` og `DEFAULT_FILE_STORAGE_DIR` (fra `src/core/files/index.ts` og `config.ts`); `findActiveFile` beholdes eksportert (tenant-testen bruker den, godtatt i PR #66). Doble tester: 6.2.5 sammenligner konstantene med seg selv, 6.3.6 dekkes av typen og 6.3.1, Azure test 6 gjentar nøkkelkontrollen, retention test 3–4 kjører fasiten for alle tre nøklene. `.env.example` har `FILE_STORAGE_DRIVER=local` og `FILE_STORAGE_DIR=var/files` som aktive linjer selv om begge er standard.

Lar vi være: feil status på en tilkobling admin har slått av, feil feilmelding til admin, en hemmelighet som kan slippe gjennom loggen, og flere kopier og doble tester å vedlikeholde før fase 2 bygger på laget.

## KI først
Nei. Dette er retting og opprydding i grunnmuren. Ingen oppgave her som KI kan forberede for takstmannen. Indirekte: tilkoblingslaget er veien KI-tjenestene senere kobles på (porten `ai`), og riktig status og riktig feilmelding på tilkoblingene er det admin trenger for å se når en KI-tjeneste svikter.

## Brukerhistorier
- Som **admin** vil jeg at en tilkobling jeg har slått av, blir stående av, slik at en sending som pågikk ikke slår den på igjen bak ryggen min.
- Som **admin** vil jeg se den ekte sendefeilen i `last_error`, slik at jeg retter riktig ting.
- Som **Byggcon** vil jeg at loggen aldri viser tilkoblingsstrengen til fillagringen eller klienthemmeligheten, uansett hvordan feltet er skrevet.
- Som **utvikler** vil jeg at en glemt tabell i tenant-testen gir meldingen «tabellen X mangler i RESET_TABLES», ikke et tall.

## Omfang
**Med:**

*Reelle feil først*

1. **`recordConnectionResult` i `src/core/integrations/connections.ts`** (fra den parallelle varianten, den eneste delen som tas inn). Signatur: `recordConnectionResult(organizationId: string, connectionId: string, result: { ok: true } | { ok: false; error: string }): Promise<void>`. Skriver til raden med `id = connectionId`, `organization_id = organizationId`, **`deleted_at` tom og `status` ulik `disabled`** (samme vilkår som `findActiveConnection`). Da går `status` bare fra `error` til `active`, aldri fra `disabled`, og en slettet rad røres ikke. `ok: true`: `last_ok_at = now()`, `last_error = null`, `status = active`. `ok: false`: `last_error = scrubText(error)` (uten ekstra `.slice`; `scrubText` kutter til 500 tegn selv), `status = error`. **Kaster aldri.** Svikter skrivingen, logges `logger.error("Kunne ikke oppdatere status på en tilkobling", { connectionId, error })` (aldri mottaker, emne eller tekst i loggen), og funksjonen returnerer. Eksporteres **ikke** fra `src/core/integrations/index.ts` (som `findActiveConnection`); `src/core/email/index.ts` importerer den fra `@/core/integrations/connections`. Navnet legges til i statisk test 5 i `static-checks.test.ts` (holdes inne i laget, aldri fra `src/app` eller `src/modules`).
2. **`sendEmail`** bruker `recordConnectionResult` i stedet for `db.update`. Flyten: `await sender.send(email)` i `try`; i `catch`: `await recordConnectionResult(orgId, connectionId, { ok: false, error: message })` og så `throw error` (den opprinnelige sendefeilen, alltid); etter `try`: `await recordConnectionResult(orgId, connectionId, { ok: true })`. Siden hjelperen aldri kaster, kan en databasefeil ikke overskygge sendefeilen, og en vellykket sending feiler ikke fordi statusskrivingen sviktet (e-posten er alt sendt). Vilkåret `if (!connectionId || !options.organizationId)` forenkles: `resolveEmailSender` gir `connectionId` bare når `organizationId` er satt, så bare `connectionId` sjekkes (se punkt 12). `MAX_LAST_ERROR`, `db`, `integrationConnections`, `and`/`eq` og `scrubText` forsvinner fra `src/core/email/index.ts`.
3. **`logger.ts`:** `CLIENT_SECRET` blir `/(client_secret)=[^&\s]+/gi` og erstattes med `"$1=" + REDACTED`, slik at skrivemåten beholdes (`Client_Secret=abc` → `Client_Secret=[fjernet]`, `CLIENT_SECRET=abc` → `CLIENT_SECRET=[fjernet]`). `SENSITIVE_KEY` utvides slik at nøkler som **slutter på** `connectionstring`, `accountkey`, `clientsecret`, `secret`, `token`, `password`, `passord` eller `apikey` treffes (for eksempel `(?:.*(?:connectionstring|accountkey|clientsecret|secret|token|password|passord|apikey))$` i stedet for bare de eksakte ordene), slik at `FILE_STORAGE_AZURE_CONNECTION_STRING`, `MS_GRAPH_CLIENT_SECRET` og `MS_GRAPH_ACCESS_TOKEN` fjernes som feltnavn. Normaliseringen (små bokstaver, `-`/`_` fjernet) gjør `secretRef`/`secret_ref` til `secretref`, som ikke slutter på `secret`, så navnet på hemmeligheten forblir lov. Ingen andre nøkler i listen endres.
4. **`microsoft365SettingsSchema`:** `clientId` får `.max(128)`, `from` får `.max(254)` (lengste gyldige e-postadresse). Tall som fakta i koden, ingen ny konstant utenfor skjemaet.
5. **`saveFile`** logger `{ organizationId, error }` (loggeren vasker `params:` og hemmeligheter selv, og `serializeError` vasker meldingen), fortsatt med fast tekst og fortsatt `throw new Error("Kunne ikke lagre filen.")`. **`readFile`** logger `logger.error("Fil lest fra lagringen stemmer ikke med raden", { organizationId: grant.organizationId, fileId })` før `FileIntegrityError` kastes. Ingen lagringsnøkkel, filnavn eller innhold i loggen.

*Manglende tester*

6. **`config.test.ts`:** `FILE_STORAGE_DRIVER=azure` med oppdiktet tilkoblingsstreng (`DefaultEndpointsProtocol=https;AccountName=oppdiktet;AccountKey=…;EndpointSuffix=core.windows.net`) og `FILE_STORAGE_AZURE_CONTAINER=filer` gir en port med `driver === "azure"` uten at noe nett brukes (ingen `put`/`get` kalles). `FILE_STORAGE_DRIVER=tull` gir `FileStorageConfigError`. (Mangler «tull»-testen alt, legges den til; finnes den, pekes det på den.)
7. **`files.service.test.ts` 6.4.2:** `it.each` over `inspector`, `office`, `manager` sjekker også at `audit_log` har **null** rader for organisasjonen etter det nektede `markFileDeleted`-kallet.
8. **Tester for `recordConnectionResult` og `sendEmail`** (i `connections.test.ts` og `email.test.ts` 8.2): (a) rad i `error` → vellykket sending gir `active`, `last_ok_at` satt, `last_error` null; (b) rad i `disabled` → vellykket sending endrer **ingenting** (status, `last_ok_at` og `last_error` som før); (c) slettet rad (`deleted_at` satt) → ingenting endres; (d) feil ved sending når raden er `disabled` → ingenting endres, feilen kastes videre; (e) skrivingen av `last_error` svikter (for eksempel `vi.spyOn` på `db.update` som kaster, eller en stub som gjør hjelperen rød) → **sendefeilen** kastes videre, og loggen har én `error`-rad med fast tekst; (f) `last_error` fra en 600 tegn lang feilmelding er høyst 500 tegn pluss « …» (som `scrubText` gir); (g) skrivingen av `last_ok_at` svikter **etter** vellykket sending → `sendEmail` resolver uten feil (e-posten er sendt), og loggen har én `error`-rad; (h) `recordConnectionResult` er en ny spørring som tar `organizationId`, og får ett `expectTenantIsolation`-kall (CLAUDE.md regel 2), etter mønsteret for `findActiveConnection` (3.9.3): seed legger rader i `error` i A og B, `query` henter grant og kaller `recordConnectionResult(grant.organizationId, id, { ok: true })` for alle seedede id-er og returnerer radene som ble `active`; i tillegg håndtesten «A sender med B sin `connectionId`, B-raden er uendret». Den eksisterende testen for «vellykket sending setter `active` fra `error`» beholdes eller slås sammen med (a). Testene for `clientId`/`from` har positiv kontroll: 128 tegn og 254 tegn (gyldig adresseform, for eksempel `"a".repeat(242) + "@example.com"`) godtas, 129 og 255 avvises.
9. **`logger.test.ts`:** `Client_Secret=abc` og `CLIENT_SECRET=abc` i tekst vaskes med skrivemåten beholdt; feltnavnene `FILE_STORAGE_AZURE_CONNECTION_STRING`, `fileStorageAzureConnectionString`, `MS_GRAPH_CLIENT_SECRET` og `MS_GRAPH_ACCESS_TOKEN` gir `[fjernet]`; `secretRef`, `secret_ref` og `clientId` fjernes **ikke** (navnet på hemmeligheten er lov, kortet for PR #64), så mønsteret skal treffe «slutter på secret», ikke «inneholder secret». `U1`-endringen under får egen selvtest.

*Rydding*

10. **U1 i `tests/tenant-isolation-all-tables.test.ts`:** erstatt `expect(tenantTableNames).toHaveLength(RESET_TABLES.length - 6)` med en ren hjelper i testfilen, `compareTableLists(schemaNames, resetNames)` → `{ missingInResetTables, missingInSchema }`, der `schemaNames` er `[...tenantTableNames, ...globalTableNames]`. U1 krever at begge listene er tomme, så meldingen peker på tabellnavnet som mangler i `RESET_TABLES` eller i skjemaet. Selvtester: U1b mater hjelperen med ett ekstra skjemanavn og sjekker at navnet står i `missingInResetTables`; U1c mater den med ett ekstra `RESET_TABLES`-navn og sjekker `missingInSchema`. (Å teste Vitests egen diff-melding er ikke en test.) Tallet 6 forsvinner fra U1 (U2 låser fortsatt de seks globale ved navn).
11. **Én `isUniqueViolation`:** hjelperen i `src/core/organization/errors.ts` har alt indeksnavnet som parameter. Kopien i `connections.ts` fjernes, og `createConnection` kaller `isUniqueViolation(error, UNIQUE_INDEX)` fra `@/core/organization/errors`. (Begge ligger i `src/core`, så modulgrensen brytes ikke. Flytting til `src/shared` gjøres ikke nå; det er ett import-sted.)
12. **`resolve.ts`:** `senderForConnection` validerer én gang: `const parsed = settingsSchemaFor(row.provider)?.safeParse(row.settings)`; feiler den, `ConnectionValidationError` som før; for `microsoft365` brukes `parsed.data` direkte. `microsoft365SettingsSchema` eksporteres ikke lenger (`settingsSchemaFor` beholdes eksportert, brukt av `resolve.ts`). `findActiveConnection` mister `executor`-parameteren (og `DbExecutor`-importen hvis den blir ubrukt). `IntegrationConnectionRecord` fjernes fra skjemafilen. `|| !options.organizationId` i `sendEmail` fjernes (se punkt 2).
13. **Doble tester i tilkoblingslaget (endelig liste, avgjort av test-leder 03.11.2026):** `integrations.dev.test.ts` fjernes helt (alt dekkes av `logger.test.ts` 4, `resolve.test.ts` 2 og `connections.test.ts` 3.7/3.9). `email.test.ts` 1b/1c/1e/1f fjernes (fasiten står i `resolve.test.ts` 7.1.1); 1a og 1d beholdes. `ports.test.ts` test 4 fjernes (typen `Record<IntegrationPort, …>` holder). `connections.test.ts` 3.2: de ni like sakene for `server_log` på feil port erstattes av **én** sak (`server_log` på `accounting` avvises); «ukjent leverandør `sendgrid` på `email`» og «`microsoft365` på `accounting`» beholdes. `static-checks.test.ts` test 7 fjernes (`secrets.test.ts` 8 dekker alt nektlisten ved oppførsel for alle fem navnene); test 5 utvides med `recordConnectionResult`. `tests/fake-fetch.ts` reduseres til det testene bruker: svarlistene, funksjonssvarene og de fire eksporterte konstantene (`TOKEN_URL_PREFIX`, `SEND_URL_PREFIX`, `DEFAULT_TOKEN_REPLY`, `DEFAULT_SEND_REPLY`) fjernes eller gjøres interne (grep bekreftet at ingen test bruker dem); `graph.test.ts`, `email.test.ts` og `resolve.test.ts` skal fortsatt være grønne. Nye tester i `connections.test.ts` samles i gruppen «3.12 recordConnectionResult» (sakene (a)–(f) i punkt 8, pluss «`db.update` kaster → returnerer uten å kaste, én `logger.error` med fast tekst, uten mottaker/emne/tekst i feltene»), tenant-testen som 3.9.4 (`expectTenantIsolation`) og 3.9.5 (håndtest). I `email.test.ts` 8.2: ny 13 (`disabled` rad: suksess og feil endrer ingenting, feilen kastes videre), ny 14 (`db.update` kaster i feilgrenen → `EmailSendError` kastes, én `error`-loggrad), ny 15 (`db.update` kaster etter vellykket sending → `sendEmail` resolver, én `error`-loggrad). `logger.error` spioneres på som retention-testene gjør med `warn`; feltene sjekkes via `formatLogLine`.
14. **Filtjenesten:** `toPlainBytes` fjernes; adapterne returnerer `Uint8Array` direkte (`new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)` for lokal, uten kopi), og testen «ikke Buffer» endres til å sjekke `bytes instanceof Uint8Array` og innholdet. `markFileDeleted`: `.for("update")` **beholdes** (sikkerhet-personvern, runde 1: under READ COMMITTED kan `retain_until` endres av en annen transaksjon mellom SELECT og UPDATE, og UPDATE-en med `where deleted_at is null` går likevel gjennom; låsen er det som gjør «les `retain_until`, så merk slettet» atomisk. Ingen skriver `retain_until` i dag, men utregningen kommer i fase 2, og 10 års oppbevaring er regel 3. Én linje, ingen kostnad). Testskriveren legger til 6.3.7: to samtidige `markFileDeleted`-kall gir én vellykket, én `FileNotFoundError` og nøyaktig én loggrad. Ubrukte eksporter fjernes fra `src/core/files/index.ts`: `createAzureFileStorage`, `createLocalFileStorage`, `isInsideRoot`; testene importerer dem fra `./azure-storage` og `./local-storage` i stedet. `DEFAULT_FILE_STORAGE_DIR` blir ikke-eksportert konstant i `config.ts`. `FileRecord` fjernes fra `src/db/schema/files.ts`. Doble tester (endelig liste, avgjort av test-leder 03.11.2026 mot testplanen i `docs/funksjoner/fase0b-filtjeneste-testplan.md`): 6.3.6 fjernes (typen, `static-checks` 2 og 6.3.1 dekker det); Azure test 6 reduseres til én sak («`../x`», klienten ukalt) i stedet for seks; retention 3 kjører alle ugyldige verdier for én nøkkel pluss én ugyldig verdi for hver av de to andre, retention 4 tilsvarende; **6.2.5 beholdes** (den låser faste koder mot bokstavelige verdier, som `ports.test.ts` 1–3, ikke mot seg selv; funnet i (o) var upresist). Hvert akseptkriterium i kortet for PR #62 skal fortsatt ha minst én test. `local-storage.test.ts` 1 og `azure-storage.test.ts` 1: «ikke Buffer» → `instanceof Uint8Array` og likt innhold; `tests/factories.test.ts` importerer `createLocalFileStorage` fra `@/core/files` og flyttes til `@/core/files/local-storage`. `files.service.test.ts` 6.1.4 utvides: spion på `logger.error`, én rad, feltene `organizationId` og `error`, `formatLogLine`-linjen inneholder «params: [fjernet]» og verken `SECRET`, `tmp` eller lagringsnøkkelen (Drizzle 0.45 gir «params:» i `DrizzleQueryError`); 6.1.5 utvides: én `error`-rad med `{ organizationId, fileId }`, uten lagringsnøkkel. `config.test.ts`: ny «6. azure med begge satt gir `driver === "azure"` uten nett» (spion på `globalThis.fetch` ukalt); «tull» legges som `it.each`-sak i eksisterende test 5.
15. **`.env.example`:** `FILE_STORAGE_DRIVER=local` og `FILE_STORAGE_DIR=var/files` kommenteres ut (`# FILE_STORAGE_DRIVER=local`, `# FILE_STORAGE_DIR=var/files`) med én linje som sier at dette er standard. `start.sh` leser ikke disse, og endres ikke (kontrolleres med grep).
16. Versjon 0.2.57 i `package.json`. Planen: underpunkt under filtjenesten, tilkoblingslaget og tenant-testen i `docs/07-utviklingsplan.md` krysses av med dato og sti til dette kortet.

**Ikke med (bevisst utelatt):**
- Ny funksjon, ny tabell, ny migrering, ny avhengighet. Egen indeks `integration_connections_organization_id_idx` fra den parallelle varianten tas **ikke** med (den delvise unike indeksen `(organization_id, port) WHERE deleted_at IS NULL` starter alt med `organization_id`; ingen begrunnelse for en til).
- Resten av den parallelle varianten: `settings.ts` for leverandørskjemaene, typene i `src/core/email/types.ts`, `isIntegrationPort`/`isProviderForPort` i `ports.ts`. Ingen nytte nå, bare flytting.
- Det som er merket «huskes i fase 2» i (o): `mimeType` sjekket mot innholdet, `nosniff` og `Content-Disposition` i visningsruten, og utregning av `retain_until` ved utgivelse. Står i tilstandsfilen og tas når visningsruten og utgivelsen bygges.
- Flytting av `isUniqueViolation` til `src/shared`. Ett import-sted på tvers er nok nå.
- Token-mellomlager, nytt forsøk ved sending, eller endring i hva `scrubText` ellers vasker.
- Skjermer for tilkoblinger (admin-skjermen kommer i fase 3), e-post til ekte mottakere, det Ståle må gjøre for Microsoft 365 og Azure (står under «Trenger Ståle når han er tilbake»).
- Små oppgaver (k), (l), (m) og (n). Egne oppgaver.

## Tilgang
Uendret. Ingen nye spørringer med tilgangssjekk; `recordConnectionResult` er intern som `findActiveConnection` (uten actor), kalles bare med `grant.organizationId` eller organisasjonen laget selv kjenner, og filtrerer på `organization_id`. Ingen endring i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen tabeller eller felter endres. Ingen migrering. Faste koder uendret. Ordlisten endres ikke.

## Skjermer
Ingen. Ingen synlig endring for brukerne.

## Regler
Ingen. Statusreglene for tilkoblinger er som i kortet for PR #64: `error` → `active` ved vellykket sending, `active`/`error` → `error` ved feil, `disabled` og slettet røres aldri av laget.

## Akseptkriterier
- [ ] Vellykket sending gjennom en tilkobling i `error` gir `active`, `last_ok_at` satt og `last_error` null (Vitest).
- [ ] Vellykket eller feilet sending gjennom en tilkobling som er `disabled` eller slettet, endrer ingenting på raden (Vitest, to tilstander × to utfall).
- [ ] Svikter skrivingen av `last_error`, kastes sendefeilen videre, og loggen får én fast `error`-rad (Vitest).
- [ ] Svikter statusskrivingen etter vellykket sending, gir `sendEmail` ikke feil (e-posten er sendt), og loggen får én fast `error`-rad (Vitest).
- [ ] `recordConnectionResult` kaster aldri, og eksporteres ikke fra `src/core/integrations/index.ts` eller `src/core/email/index.ts` (statisk test 5 utvidet).
- [ ] `scrubText("Client_Secret=abc")` gir `Client_Secret=[fjernet]` og `scrubText("CLIENT_SECRET=abc")` gir `CLIENT_SECRET=[fjernet]`; feltene `FILE_STORAGE_AZURE_CONNECTION_STRING`, `MS_GRAPH_CLIENT_SECRET` og `MS_GRAPH_ACCESS_TOKEN` gir `[fjernet]`; `secretRef`, `secret_ref` og `clientId` vaskes ikke (Vitest).
- [ ] `clientId` på 129 tegn og `from` på 255 tegn avvises av `createConnection` for `microsoft365`; `clientId` på 128 tegn og `from` på 254 tegn (gyldig adresseform) godtas (Vitest).
- [ ] `saveFile` med databasefeil logger én rad med `error`-felt der meldingen er vasket (`params: [fjernet]`); `readFile` med feil fingeravtrykk logger én rad uten lagringsnøkkel (Vitest, lytt på `logger`).
- [ ] `FILE_STORAGE_DRIVER=azure` med begge innstillingene gir `driver === "azure"` uten nett; `tull` gir `FileStorageConfigError` (Vitest).
- [ ] 6.4.2: takstmann, kontor og leder får `AccessDeniedError`, raden er uendret og `audit_log` har null rader (Vitest).
- [ ] U1 bruker en ren hjelper `compareTableLists` og krever at både `missingInResetTables` og `missingInSchema` er tomme; selvtestene U1b og U1c viser at ett ekstra navn på hver side navngis i resultatet (Vitest).
- [ ] Bare én `isUniqueViolation` i `src/` (grep), med indeksnavn som parameter.
- [ ] `settings` for `microsoft365` valideres én gang i `resolve.ts`; `microsoft365SettingsSchema` eksporteres ikke (grep).
- [ ] `integrations.dev.test.ts` er borte; de doble testene i punkt 13 og 14 er fjernet, og hvert akseptkriterium i kortene for PR #62 og PR #64 har fortsatt minst én test (test-leder bekrefter).
- [ ] `toPlainBytes`, `IntegrationConnectionRecord`, `FileRecord` og de ubrukte eksportene i punkt 12 og 14 er borte (grep); `findActiveFile` og `.for("update")` i `markFileDeleted` står; 6.3.7 viser at to samtidige `markFileDeleted` gir én vellykket, én `FileNotFoundError` og én loggrad (Vitest).
- [ ] `.env.example` har ingen aktive `FILE_STORAGE_DRIVER`- eller `FILE_STORAGE_DIR`-linjer; `start.sh` er uendret.
- [ ] `git diff` har ingen ny migrering, ingen endring i `src/db/schema` utover fjernede typer, og ingen endring i `src/core/access`.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): de eksisterende `expectTenantIsolation`-kallene for `findActiveConnection`, `listConnections`, `readFile` og `markFileDeleted` står; `recordConnectionResult` får ett eget `expectTenantIsolation`-kall (3.9.4, CLAUDE.md regel 2) og håndtesten som viser at en rad i organisasjon B ikke endres når A sender med B sin `connectionId` (3.9.5).
- [ ] Virker på iPad-størrelse (e2e): ingen ny skjerm; den eksisterende e2e-kjøringen (pc og iPad) er grønn.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- [ ] Versjon 0.2.57. Planen krysset av.

## Roller
- **utvikler:** all kode utenom testfiler: punkt 1–5, 11, 12, 14 (kodedelen), 15 og 16 (`connections.ts`, `email/index.ts`, `resolve.ts`, `logger.ts`, `files/service.ts`, `storage.ts`, `local-storage.ts`, `azure-storage.ts`, `files/index.ts`, `config.ts`, skjemafilene, `.env.example`, `package.json`, planen). Rører **ingen** `*.test.ts` og ingenting i `tests/`.
- **testskriver:** alle testfiler: punkt 6–10 og 13, testdelen av 14, og tilpasning av importer når eksporter fjernes (`local-storage.test.ts`, `azure-storage.test.ts`). Skriver de nye testene mot teksten i dette kortet (røde til utviklerens kode er på plass). Går i parallell med utvikleren; bitene henger ikke sammen fordi de aldri rører samme fil.
- **test-leder:** har avgjort den endelige listen over doble tester (punkt 13 og 14, runde 1, 03.11.2026). Kjører alle fire sjekkene til slutt og bekrefter i sluttrapporten at hvert akseptkriterium i kortene for PR #62 og PR #64 fortsatt har minst én test, og kjører grep-kriteriene.
- **sikkerhet-personvern:** forhåndsvurdering levert (runde 1, 03.11.2026, ingen alvorlige funn; tre små funn innarbeidet). Kort gjennomgang av den ferdige koden for punkt 3, 5 og 9.

Ikke med: forenkler (omfanget er gitt av funnene), ux-ansvarlig, ui-designer, fagansvarlig, arkitekt (ingen skjerm, ingen fagtekst, ingen ny struktur).

## Beslutninger (autonom modus)
- **Status etter sending:** vilkåret «ikke slettet og ikke `disabled`» i `recordConnectionResult`, som i `findActiveConnection`. Da går `status` bare `error` → `active`, og admins valg om `disabled` eller sletting står. Kilde: kortet for PR #64 (Omfang 64, «`active` om den sto i `error`»), A44–A48. Ingen ny beslutning til `docs/09-apne-sporsmal.md`; dette er retting etter det kortet alt sier.
- **Statusskriving som svikter stopper aldri sendingen:** e-posten er sendt eller feilen er kjent; loggen får en fast rad. Enkleste som virker, og admin ser alltid den ekte sendefeilen. Føres ikke som egen beslutning (teknisk valg innenfor kortet for PR #64).
- **Runde 1 (03.11.2026), prosjektleder avgjør:** (1) `Client_Secret` beholder skrivemåten (`$1=`-varianten), så kriteriet og koden stemmer; begge varianter er like trygge. (2) `.for("update")` i `markFileDeleted` beholdes; funnet i (o) var feil (se punkt 14). (3) Suffiksene `token`, `password`, `passord` og `apikey` tas inn i samme regex-endring (LITE 3 fra sikkerhet-personvern): det er samme linje, og en nøkkel som `MS_GRAPH_ACCESS_TOKEN` skal ikke slippe gjennom som feltnavn bare fordi den har prefiks. Normaliseringen gjør at verken `secretRef` eller `clientId` treffes. (4) `recordConnectionResult` får eget `expectTenantIsolation`-kall (regel 2). (5) 6.2.5 beholdes (test-leder). Ingen av dette er fag, pris, personvern eller ny funksjon; ingenting til `docs/09-apne-sporsmal.md`.

## Åpne spørsmål
- Ingen nye til Ståle.
