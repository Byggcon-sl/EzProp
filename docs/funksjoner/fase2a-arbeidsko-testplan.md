# Testplan: Oppdragslisten som arbeidskø

- **Oppgavekort:** `docs/funksjoner/fase2a-arbeidsko.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at startsiden viser «Mine» under arbeid, at søket finner oppdraget med del av nummer eller adresse, og at notatet lagres uten å forlate køen, på PC og iPad), reklamasjoner (testene låser at «Forfalt» vises riktig, også rundt midnatt i Europe/Oslo, og at oppdrag uten befaring vises tydelig, så ingenting blir liggende) og KI først (filteret og kortet er låst med tester, så et senere KI-merke kan legges på uten å endre køen).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet (adresser som «Testveien 12, 8000 Bodø», notat som «Venter på nøkkel»). Ingen ekte navn, adresser eller fødselsnumre; fødselsnummer-testen bruker elleve sifre som ikke er et gyldig nummer. Fast tid: `TEST_NOW` fra `tests/factories.ts`.

Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke. `tests/tenant-isolation-all-tables.test.ts` skal fortsatt være grønn. Ingen fagregler; «regeltestene» er `isOverdue` og tolkingen av adressen som testsaker (`it.each`). Uten nett testes i fase 2b.

## Avtale om signaturer (utvikler og testskriver)

Avvik føres i kortet.

- **Signaturene følger mønsteret i `status.ts`:** `listWorkQueue(actor, organizationId, { status, mineOnly, query })`, `countWorkQueueByStatus(actor, organizationId, { mineOnly, query })`, `updateAssignmentNote(actor, organizationId, assignmentId, note)`, `setAssignmentSchedule(actor, organizationId, assignmentId, { inspectionAt, dueDate })`. Tilgangssjekken (`organization.read` for lesing, `assignment.edit` for endring) gjøres inne i funksjonen med `requireOrganizationAccess`, slik at testene kan vise at takstmann med `access.inspectors_edit_all` av blir avvist. Kortet skriver `grant` som første parameter; tar utvikleren `grant`, må handlingen hente det med riktig rettighet, og testene i punkt 3.1 flyttes til handlingene. Uansett: **ingen funksjon tar en ansatt-id** som parameter; «Mine» bruker `grant.employeeId`.
- `listWorkQueue` returnerer `{ items, total }` eller bare `items`; hvert element har minst `id`, `number`, `address`, `status`, `corrected`, `inspectionAt`, `dueDate`, `responsibleName`, `internalNote`. `idOf = row.id`.
- `countWorkQueueByStatus` returnerer `{ ordered, in_progress, completed, invoiced }` med alle fire nøkler (0 når tomt).
- `src/core/assignments/work-queue-params.ts` (navn etter utvikler): `parseWorkQueueParams(searchParams) → { status, mineOnly, query }`.
- `src/core/assignments/overdue.ts` (eller i `status-flow.ts`): `isOverdue({ dueDate, status }, now) → boolean`.
- `src/core/assignments/schemas.ts`: `assignmentNoteSchema`, `assignmentScheduleSchema`. Konstantene `WORK_QUEUE_LIMIT = 50`, `NOTE_MAX_LENGTH = 200`, `DEFAULT_WORK_QUEUE_STATUS = "in_progress"` eksporteres, så testene bruker dem.
- Fabrikk: `createAssignment(organizationId, { inspectionAt, dueDate, internalNote, deletedAt, status })` virker uten endring etter migreringen. `createTeamMember`, `createProperty`, `createOrder` finnes. Ingen nye fabrikker.

## 1. Regeltester (rene enhetstester)

### 1.1 `isOverdue`, `src/core/assignments/overdue.test.ts` (ny)

1. **frist i går, status `ordered` og `in_progress`** → `true`.
2. **frist i dag** → `false` (forfalt først dagen etter).
3. **frist i morgen** → `false`.
4. **ingen frist** (`null`) → `false`.
5. **`completed` og `invoiced` med frist i går** → `false`.
6. **midnatt i Europe/Oslo** (`it.each`): frist `2026-11-04`, `now = 2026-11-04T22:59:59Z` (23:59 Oslo) → `false`; `now = 2026-11-04T23:00:00Z` (00:00 Oslo 5.11) → `true`. Det samme ved sommertid (`2026-06-30`, `21:59:59Z` → `false`, `22:00:00Z` → `true`).
7. **tabellen dekker alle statuser:** testen går over `ASSIGNMENT_STATUSES`, så en ny status uten testsak gjør testen rød.

### 1.2 Tolking av adressen, `work-queue-params.test.ts` (ny)

1. **ingen parametre** → `{ status: "in_progress", mineOnly: true, query: "" }` (A99, A102).
2. **de fire statusene** (`it.each`) gir seg selv.
3. **ugyldig `status`** (`"cancelled"`, `"IN_PROGRESS"`, `""`, liste med to verdier) → `in_progress`, aldri feil.
4. **`mine=0`** → `false`; **`mine=1`**, **`mine=ja`**, mangler, liste → `true`.
5. **`q`** trimmes; over 100 tegn kuttes eller avvises uten feilside (følg det som bygges, men aldri kast).
6. **`organizationId`, `employeeId` i adressen** ignoreres (finnes ikke i resultatet).

### 1.3 Skjemaene, `src/core/assignments/schemas.test.ts` (utvides)

1. **notat:** 200 tegn godtas, 201 avvises med norsk melding; trimmes; tom tekst og bare mellomrom gir `null`.
2. **notat med fødselsnummer** (elleve sifre på rad, også med mellomrom rundt) avvises med samme melding som partene; ti sifre (telefon) godtas.
3. **befaring og frist:** begge kan være tomme (gir `null`); gyldig dato og tidspunkt godtas; `"2026-13-40"` og fritekst avvises med norsk melding; ingen regel om rekkefølge (frist før befaring godtas).

## 2. Integrasjonstester, `src/core/assignments/work-queue.test.ts` (ny, mot databasen)

### 2.1 Migreringen

1. **kolonnene finnes:** `inspection_at` (`timestamptz`, null), `due_date` (`date`, null), `internal_note` (`text`, null) på `assignments`; eksisterende rader får `null`.

### 2.2 Faner og antall

1. **antall per status:** 2 bestilt, 3 under arbeid, 1 ferdig, 0 fakturert gir `{ 2, 3, 1, 0 }`; alle fire nøkler finnes.
2. **antall følger «Mine» og søk:** samme oppsett med «Mine» og med `q` gir tall som er lik lengden av `listWorkQueue` for hver status.
3. **kansellerte (`deleted_at`) telles ikke og vises ikke**, i alle fire faner.
4. **én spørring for antall:** (valgfritt, hvis enkelt) spion på `db` viser ett kall.

### 2.3 «Mine»

1. **med i teamet med hver rolle** (`it.each` over team-rollene) → vises.
2. **ikke i teamet** → vises ikke med «Mine», vises med «Alle».
3. **slettet teamrad** (`deletedAt` satt) → vises ikke med «Mine».
4. **avsluttet teamrad** (`toAt` i fortiden, hvis teamet bruker det for overlevering) → følg kortets regel «med i teamet»; testen dokumenterer valget.
5. **flere teamrader for samme ansatt** på samme oppdrag → oppdraget vises én gang (ingen dobbel rad, antall teller én).
6. **«Mine» bruker innlogget ansatt:** to ansatte, hver med eget oppdrag; hver ser bare sitt.

### 2.4 Søk

1. **del av oppdragsnummer** (`"0004"`) → treff.
2. **del av eiendomsadresse**, store og små bokstaver (`"testVEIEN"`) → treff.
3. **adresse fra ordren** når eiendom mangler → treff.
4. **eiendomsadressen vinner:** oppdrag med eiendom «Fjordgata 1» og ordreadresse «Testveien 12» viser «Fjordgata 1» på kortet.
5. **`%` og `_`** (`it.each`): `"%"` og `"_"` gir bare rader som faktisk har tegnet, ikke alle.
6. **æøå** (`"Bodø"`, `"BODØ"`) → treff.
7. **tomt søk** gir alle.
8. **søk treffer ikke andre organisasjoner** (dekkes i 2.8).

### 2.5 Kortet

1. **feltene:** nummer, adresse, status, `inspectionAt`, `dueDate`, `internalNote`, ansvarlig takstmann (navn fra aktiv `responsible`), `corrected`.
2. **ingen ansvarlig** → `responsibleName = null`; slettet ansvarlig teller ikke.
3. **`corrected`** kommer fra `isCorrected` i `status-flow.ts` (i dag `false`); med `vi.spyOn` som gir `true` står det `true`.
4. **feltlisten er fast:** nøklene sammenlignes med en fast liste (ingen e-post, telefon eller parter lekker til kortet).

### 2.6 Sortering og grense

1. **A103:** oppdrag med befaring 6.11, frist 5.11 (uten befaring), befaring 10.11 og to uten dato (nummer 0001 og 0002) gir rekkefølgen frist 5.11, befaring 6.11, befaring 10.11, 0002, 0001.
2. **befaring brukes før frist** på samme oppdrag (befaring 20.11, frist 6.11 sorteres etter 20.11).
3. **51 oppdrag** i samme fane → 50 rader, antall 51.
4. **50 oppdrag** → 50 rader, antall 50 (ingen «Viser»-tekst; sjekkes i e2e/side).

### 2.7 Endringer: notat, befaring og frist

1. **notat lagres, endres, tømmes:** etterpå er `internal_note` lik teksten, ny tekst, `null`. `updated_at`/`updated_by` satt.
2. **notat over 200 tegn og med fødselsnummer** → `ZodError`, raden uendret, **ingen rad i revisjonsloggen**, og `JSON.stringify(auditRows(org))` inneholder ikke sifrene.
3. **befaring og frist settes og tømmes** (begge, én av dem, ingen).
4. **revisjonslogg:** én rad per vellykket endring, `entityType: "assignment"`, `action: "update"`, `changes` med `from`/`to` for feltet som endret seg.
5. **ingen endring** (samme notat på nytt) → følg det som finnes i revisjonsloggen; testen dokumenterer valget.
6. **kansellert oppdrag** → «ikke funnet» (`AccessDeniedError` eller egen feil), raden uendret, ingen loggrad.
7. **tilfeldig uuid og `"ikke-en-id"`** → «ikke funnet», aldri databasefeil.

### 2.8 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres med `access.inspectors_edit_all` **på** og **av**.

1. **lesing:** `inspector`, `office`, `manager`, `admin` kan kalle `listWorkQueue` og `countWorkQueueByStatus` med innstillingen både på og av.
2. **endring, på:** alle fire roller kan lagre notat og befaring/frist.
3. **endring, av:** `office`, `manager`, `admin` lykkes; `inspector` får `AccessDeniedError` for begge endringene, raden er uendret, ingen loggrad, og samme takstmann kan fortsatt lese køen.
4. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` lykkes.
5. **ingen ansattrad, deaktivert, slettet, uten roller:** `AccessDeniedError` for alle fire funksjoner.
6. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av, kan lese og endre.

### 2.9 Tenant-isolasjon (regel 2)

1. **`listWorkQueue`, `expectTenantIsolation`:** `seed` lager ett oppdrag `in_progress` i A og B med admin som teammedlem; `query = (actor, org) => listWorkQueue(actor, org, { status: "in_progress", mineOnly: false, query: "" })`.
2. **`listWorkQueue` med «Mine», `expectTenantIsolation`:** samme, `mineOnly: true` (viser at teamraden ikke krysser organisasjoner).
3. **`countWorkQueueByStatus`, egen test:** A har oppdrag i alle fire statuser, B ingen. B sine antall er 0 i alle fire. Admin i A med `orgB.id` → `AccessDeniedError`. Med søk som treffer A sin adresse er B sine antall fortsatt 0.
4. **søk krysser ikke:** samme adresse i A og B; søk fra A gir bare A sin rad.
5. **`updateAssignmentNote` og `setAssignmentSchedule`, `expectTenantIsolation`:** `query` endrer sitt eget oppdrag og returnerer `[oppdraget]`. Etterpå: B sin rad er endret av B, og alle loggrader for B har `organization_id = B`.
6. **fremmed id (IDOR):** admin i A, `orgA.id`, med B sin `assignmentId` → «ikke funnet» eller `AccessDeniedError`; B sin rad har uendret `internal_note`, `inspection_at`, `due_date`, `updated_at`, og ingen loggrad.
7. **`organizationId` i input ignoreres** (ekstra felt i input endrer ikke hvilken organisasjon som brukes).

## 3. Handlingene og sidene

### 3.1 `src/app/(ansatt)/arbeidskoe/actions.test.ts` (ny) og `oppdrag/[id]/actions.test.ts` (utvides)

1. **`getEmployeeContext` gir `null`** → `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` og `employeeId` endrer ikke kallet.
4. **feilkart:** `AccessDeniedError` → `NO_ACCESS`; `ZodError` → melding ved feltet; ukjent feil → `UNKNOWN_ERROR`.
5. **etter lagring** sendes brukeren tilbake til køen med samme `status`, `mine` og `q` (bare egne verdier fra tolkingen i 1.2, ingen åpen omdirigering).
6. **loggkontrakt:** `JSON.stringify` av alle loggkall inneholder ikke notatteksten.

### 3.2 Siden `/arbeidskoe` (komponenttest eller del av e2e)

1. **«Viser 50 av 51. Bruk søket for å finne flere.»** vises ved 51; ingen tekst ved 50.
2. **tomtekst** «Ingen oppdrag med status Under arbeid.»; i Bestilt også lenke «Ny ordre».
3. **kvitteringen `?kansellert=`** vises fortsatt.
4. **«Befaring ikke avtalt»**, **«Ingen ansvarlig»** og **«Forfalt»** vises når data sier det.

## 4. E2E, `e2e/fase-2a-arbeidsko.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egne oppdrag med `uniqueSuffix()` og søker på suffikset, så testene ikke påvirker hverandre. Antall sjekkes som endring før og etter, ikke som faste tall.

1. **gjennomgang (begge størrelser):** `/arbeidskoe` uten parametre → «Under arbeid» er valgt og «Mine» er på, alle fire faner har antall → bytt til «Bestilt» (adressen får `?status=ordered`) → tilbake-knappen gir «Under arbeid» igjen → «Alle» → søk på suffikset → kortet vises med nummer, adresse, statusmerke, «Befaring ikke avtalt» og ansvarlig → «Notat» → skriv «Venter på nøkkel» → «Lagre» → notatet står på kortet etter omlasting, søk og fane beholdt → «Notat» → endre tekst → «Avbryt» → det gamle notatet står → tøm og lagre → notatet er borte.
2. **befaring og frist:** på `/oppdrag/[id]` sett befaring og frist i går (status Under arbeid) → «Lagre» → i køen står dato og klokkeslett og merket «Forfalt»; tøm begge → «Befaring ikke avtalt», ingen frist.
3. **tomtilstand:** søk på et suffiks som ikke finnes i «Bestilt» → tomteksten og lenken «Ny ordre» som går til ny ordre.
4. **uten JavaScript** (bare `pc`, `javaScriptEnabled: false`): åpne «Notat», lagre, notatet står etterpå.
5. **notat med fødselsnummer** (elleve oppdiktede sifre) → norsk feilmelding ved feltet, ingenting lagret.
6. **iPad-størrelse** (stående): ingen vannrett rulling, fanene og merkene brytes over flere linjer, faner, «Notat», «Lagre», «Avbryt» og kortlenken er minst 44 px høye.
7. **takstmann med innstillingen av** (hvis e2e har en takstmann-bruker, ellers dekket av 2.8): ser køen, «Lagre» gir «Ingen tilgang».

## 5. Til slutt

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjonen i `package.json` er økt. `tests/tenant-isolation-all-tables.test.ts` er grønn uten endring i `tests/tenant-tables.ts`.

**Avvises uten** testene i 2.8 (med admin-testen) og alle punktene i 2.9.

**Ikke testet nå:** at notatet aldri kommer i rapport eller PDF (A101) testes når PDF finnes. Uten nett testes i fase 2b.
