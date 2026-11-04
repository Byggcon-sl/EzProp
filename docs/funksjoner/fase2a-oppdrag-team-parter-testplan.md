# Testplan: Team og parter på oppdraget

- **Oppgavekort:** `docs/funksjoner/fase2a-oppdrag-team-parter.md`
- **Dato:** 04.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (teamet og partene står på oppdraget, mottar-valgene er forhåndsutfylt; testene låser forhåndsvalgene og at siden virker på iPad), reklamasjoner (bytter i teamet lagres med tid og grunn og skrives aldri over; testene viser at historikken blir stående og at det aldri er to aktive i samme rolle) og KI først (rollekodene og mottar-valgene er låste data som KI senere kan foreslå mot; testene viser at ingen personopplysninger havner i hendelser eller logg).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: «Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`, grunn «Ferie». Ingen ekte navn, adresser eller numre. «Fødselsnummer» i testene er alltid `12345678901` (oppdiktet, 11 sifre).

Fast tid: `TEST_NOW` fra `tests/factories.ts` (`2026-11-03T10:00:00Z`), og `LATER = TEST_NOW + 1 time` for bytter.

Ingen del av oppgaven virker uten nett (oppdraget settes opp på kontoret med nett), så det trengs ingen e2e uten nett. Ingen fagregler; «regeltestene» er dataregler som testsaker (`defaultReceives` fem saker, én aktiv per rolle, `to_at >= from_at`).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 3–5. Testskriveren skriver mot dette; avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- `src/core/assignments/codes.ts`: `TEAM_ROLES = ["responsible", "co_responsible", "inspector", "peer_reviewer", "office"]`, `PARTY_ROLES = ["broker", "seller", "buyer", "seller_representative", "invoice_recipient"]` (`as const`), `teamRoleLabel(code)`, `partyRoleLabel(code)`, `defaultReceives(role) → { report: boolean; invoice: boolean; messages: boolean }` (utvikler kan bruke `receivesReport`/`receivesInvoice`/`receivesMessages`; testen følger det som bygges, men alle tre nøklene skal finnes).
- `src/core/assignments/schemas.ts`: `partyInputSchema` (rolle, `name`, `firmName`, `email`, `phone`, `receivesReport`, `receivesInvoice`, `receivesMessages`) og `teamChangeReasonSchema` (eller tilsvarende navn for grunnen).
- `src/core/assignments/errors.ts`: `EmployeeNotFoundError` («Den ansatte finnes ikke.»).
- Tjenester fra `@/core/assignments`: `getAssignment`, `setTeamMember`, `addParty`, `updateParty`, `removeParty` med signaturene i kortet punkt 4.
- Fabrikker: `createTeamMember(organizationId, { assignmentId?, employeeId?, teamRole?, fromAt?, toAt?, handedOverReason?, deletedAt? })` (lager oppdrag og ansatt selv når de mangler, i samme organisasjon) og `createAssignmentParty(organizationId, { assignmentId?, role?, name?, … , deletedAt? })`.

## 1. Faste koder, `src/core/assignments/codes.test.ts` (utvides, ren enhetstest)

1. **`TEAM_ROLES` er låst:** nøyaktig de fem kodene i fast rekkefølge. Kommentar: koder endres aldri (regel 6).
2. **`PARTY_ROLES` er låst:** nøyaktig de fem kodene i fast rekkefølge; `client` og `other` finnes ikke.
3. **etiketter:** `teamRoleLabel` gir `Ansvarlig takstmann`, `Medansvarlig`, `Befaringstakstmann`, `Sidemann`, `Saksbehandler`; `partyRoleLabel` gir `Megler`, `Selger`, `Kjøper`, `Selgers representant`, `Fakturamottaker`. Ukjent kode gir koden tilbake, aldri `undefined`.
4. **`defaultReceives` som testsaker** (`it.each`, fem saker, A62):
   | rolle | rapport | faktura | kopi |
   |---|---|---|---|
   | `broker` | ja | nei | ja |
   | `seller` | ja | nei | ja |
   | `seller_representative` | ja | nei | ja |
   | `buyer` | ja | nei | nei |
   | `invoice_recipient` | nei | ja | nei |
5. **alle roller er dekket:** testsakene over har like mange rader som `PARTY_ROLES` (ny kode uten forhåndsvalg gjør testen rød).

## 2. Skjemaene, `src/core/assignments/schemas.test.ts` (ny, ren enhetstest)

1. **navn:** tom og bare mellomrom → «Skriv inn navnet.»; 200 tegn godtas, 201 avvises; trimmes.
2. **rolle:** mangler eller `"client"` → «Velg en rolle.»; hver av de fem kodene godtas.
3. **firma:** valgfritt (tom streng blir `null`); 200 ok, 201 avvist; trimmes.
4. **e-post:** valgfri; `megler@example.com` ok; `ikke-epost` → «E-postadressen er ikke gyldig.»; 254 tegn ok, 255 avvist.
5. **telefon:** valgfri; `00000000`, `+47 000 00 000` ok; `00-00`, `abc` → «Telefonnummeret kan bare ha sifre, mellomrom og +.»; 20 tegn ok, 21 avvist.
6. **mottar-valgene:** mangler → `false`; `"on"`/`true` → `true` (slik avkrysningen sender).
7. **fødselsnummer** (`it.each` over `name`, `firmName`, grunn): `12345678901` og `Megler 12345678901 Test` → «Fødselsnummer skal ikke lagres her.»; 10 sifre (`0000000000`) godtas i navn/firma; telefonen `00000000` er ikke berørt.
8. **grunn ved bytte:** valgfri (tom blir `null`); 300 ok, 301 avvist; trimmes.
9. **alle norske meldinger i kortet punkt 5 er dekket** (en egen test som samler de seks tekstene og sjekker at hver er brukt i minst én test over; «Den ansatte finnes ikke.» dekkes i 4.6).

## 3. Databasen, `src/db/assignment-team-parties-schema.test.ts` (ny, direkte innsetting)

1. **to aktive i samme rolle avvises** (unik delvis indeks): to rader `responsible` med `to_at = null` på samme oppdrag → unik-feil.
2. **avsluttet rad sperrer ikke:** én rad med `to_at` satt og én aktiv i samme rolle godtas.
3. **myk-slettet aktiv rad sperrer ikke** for en ny aktiv rad.
4. **samme ansatt i to ulike roller** (ansvarlig og befaringstakstmann) godtas.
5. **samme rolle på to ulike oppdrag** godtas.
6. **ansatt fra annen organisasjon** (`organization_id` A, `employee_id` fra B) avvises av den sammensatte fremmednøkkelen.
7. **oppdrag fra annen organisasjon** avvises, både i `assignment_team_members` og `assignment_parties`.
8. **ukjente koder:** `team_role = "owner"` og `role = "client"` avvises (CHECK).
9. **`to_at` før `from_at`** avvises; `to_at = from_at` godtas.
10. **standardverdier:** part satt inn uten mottar-felt har `receives_report`, `receives_invoice`, `receives_messages` = `false`.
11. **tenant-tabeller:** begge tabellene står i `tests/tenant-tables.ts` med radbyggerne `createTeamMember` og `createAssignmentParty` og testfilen `src/core/assignments/assignment-team-parties.test.ts`; `tests/tenant-isolation-all-tables.test.ts` er grønn (20 tabeller: 18 fra før pluss to).
12. **migreringen er ren:** `pnpm db:generate` lager ingen ny fil (sjekkes i gjennomgangen).

## 4. Kjernen, `src/core/assignments/assignment-team-parties.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres to ganger: med `access.inspectors_edit_all` **på** og **av**.

1. **lese** (`getAssignment`): `inspector`, `office`, `manager`, `admin` lykkes i begge innstillingene.
2. **skrive** (`setTeamMember`, `addParty`, `updateParty`, `removeParty`): med innstillingen på lykkes alle fire roller. Med innstillingen av lykkes `office`, `manager`, `admin`; `inspector` får `AccessDeniedError`, og antall rader i `assignment_team_members`, `assignment_parties`, `events` og `audit_log` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` kan alle fire skrivefunksjonene.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller:** `AccessDeniedError` på `getAssignment` og `addParty`.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, med innstillingen av, kan lese og bruke alle fire skrivefunksjonene.

### 4.2 Tenant-isolasjon (regel 2; åtte kall til `expectTenantIsolation`)

1. **`getAssignment`:** `seed` lager ett oppdrag i A og B; `query` returnerer `[oppdraget]`, `idOf = id`.
2. **`getAssignment(...).team`:** `seed` lager én teamrad i A og B; `query` returnerer `.team`; `idOf` = ansatt-id (eller rad-id hvis den returneres).
3. **`getAssignment(...).parties`:** `seed` lager én part i A og B; `idOf = id`.
4. **`getAssignment(...).teamCandidates`:** `seed` lager én ansatt i A og B (pluss adminene); `idOf = id`; Bs ansatte vises aldri hos A.
5. **`setTeamMember`:** `seed` lager oppdrag og ansatt i A og B; `query` setter ansvarlig og returnerer de aktive teamradene. Etterpå: B har nøyaktig én aktiv rad, og alle `events`/`audit_log`-rader for B har `organization_id = B`.
6. **`addParty`:** `query` legger til en part i `organizationId` og returnerer `[rad]`, `idOf = organizationId`-sjekk som i ordre (`createOrder`-mønsteret). Etterpå: B har nøyaktig én part.
7. **`updateParty`:** `seed` lager én part i A og B; `query` endrer navnet i egen organisasjon. Etterpå: Bs part er endret nøyaktig én gang.
8. **`removeParty`:** `seed` lager én part i A og B; `query` fjerner og returnerer `[{ id }]`. Etterpå: Bs part har `deleted_at` satt én gang, av B.

### 4.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id` som organisasjon:

1. **Bs `assignmentId`** i `getAssignment`, `setTeamMember`, `addParty` → `AccessDeniedError`; ingen ny rad i noen av tabellene, ingen hendelse.
2. **Bs `partyId`** i `updateParty` og `removeParty` → `AccessDeniedError`; Bs rad er uendret (navn, `deleted_at = null`, `row_version`/`updated_at`).
3. **Bs `employeeId`** i `setTeamMember` på eget oppdrag → `EmployeeNotFoundError`; ingen teamrad, ingen hendelse, den aktive raden (hvis satt) er urørt.
4. **`organizationId` i input ignoreres:** `addParty` med `organizationId: orgB.id` i input lagrer parten i A (eller avvises av skjemaet).
5. **tilfeldig uuid og `"ikke-en-id"`** som oppdrags-id, part-id og ansatt-id: `AccessDeniedError` eller `EmployeeNotFoundError`, aldri databasefeil.

### 4.4 Myk sletting

1. **slettet oppdrag** (`deletedAt` satt): alle fem funksjonene gir `AccessDeniedError` (også `updateParty`/`removeParty` på en part som hører til det slettede oppdraget).
2. **fjernet part:** `removeParty` setter `deleted_at` (og `deleted_by`); raden finnes fortsatt; `getAssignment` viser den ikke; `updateParty` og `removeParty` igjen gir `AccessDeniedError`.
3. **fjernet part kan legges inn igjen:** `addParty` med samme navn og rolle lager en ny rad; den gamle står med `deleted_at`.
4. **teamrader slettes aldri:** sett ansvarlig, bytt, sett «Ingen» → tre rader i alt for rollen (to avsluttet), null aktive, alle med `deleted_at = null`.
5. **myk-slettet teamrad vises ikke** i `getAssignment(...).team`.

### 4.5 `getAssignment`

1. **faste felt:** `Object.keys` på oppdraget, hvert teamelement, hver part og hver kandidat er faste lister; ingen `deletedAt`, `deletedBy`, `rowVersion`, `organizationId`, `createdBy`.
2. **team:** bare aktive rader (`to_at is null`, ikke slettet), med `employeeName` og `fromAt`.
3. **kandidater:** ansatte som har sluttet eller er slettet, er ikke med; sortert på navn.
4. **tomt oppdrag:** `team = []`, `parties = []`.
5. **`orderId` og `officeName`** er med (lenken «Ordren» og toppen på siden).
6. **ingen N+1:** oppdrag med fem teamrader og fem parter gir like mange spørringer som oppdrag med én av hver (tell spørringer med en enkel spion på executoren, eller sjekk i kodegjennomgangen hvis det ikke lar seg måle enkelt).

### 4.6 Team (`setTeamMember`)

1. **sette ansvarlig** på tomt oppdrag: én aktiv rad, `from_at = now`, én hendelse.
2. **bytte med grunn:** to rader; den gamle har `to_at = LATER` og `handed_over_reason = "Ferie"`; den nye er aktiv med `from_at = LATER`.
3. **samme ansatt igjen:** ingen ny rad, ingen hendelse, ingen loggrad.
4. **«Ingen» (`employeeId = null`)** når noen er satt: raden avsluttes, null aktive, én hendelse med `toEmployeeId = null`.
5. **«Ingen» når ingen er satt:** ingenting skjer, ingen hendelse.
6. **alle fem roller** (`it.each`) kan settes; én ansatt i to roller gir to aktive rader.
7. **ansatt som har sluttet** og **slettet ansatt:** `EmployeeNotFoundError`, ingen rad, ingen hendelse.
8. **grunn med 11 sifre** → feil «Fødselsnummer skal ikke lagres her.», ingen endring.
9. **samtidige bytter:** to `setTeamMember` på samme rolle og oppdrag med ulike ansatte i `Promise.all` lykkes begge uten unik-feil; etterpå nøyaktig én aktiv rad, én avsluttet rad (fra første), og to `assignment.team_changed`-hendelser (ev. tre rader totalt hvis noen var satt fra før; testen starter tom). Blir testen ustabil, slås den sammen med 3.1 og noteres.

### 4.7 Parter

1. **`addParty`** lagrer alle feltene, `organizationId = grant.organizationId`, `createdBy` = den ansatte.
2. **minimal part:** rolle og navn → `firmName`, `email`, `phone` er `null`; mottar som sendt.
3. **mottar lagres som sendt, ikke etter rollen:** megler med bare `receivesInvoice = true` lagres slik (forhåndsutfyllingen er bare i skjermen).
4. **samme person i to roller** gir to rader.
5. **`updateParty`** endrer rolle og mottar; `updatedAt` endres.
6. **valideringsfeil** gir `ZodError`, ingen rad, ingen hendelse.

### 4.8 Hendelser og revisjonslogg

1. **`setTeamMember`:** `assignment.team_changed` med `assignmentId` og `data = { teamRole, fromEmployeeId, toEmployeeId }`; revisjonslogg `assignment_team_member` med `end` (gammel rad) og `create` (ny rad) ved bytte.
2. **parter:** `assignment.party_added`, `assignment.party_updated`, `assignment.party_removed` med `data = { partyId, role }`; revisjonslogg `assignment_party` med `create`, `update`, `delete`; ved `update` står navnene på feltene som ble endret, ikke verdiene.
3. **ingen personopplysninger:** for hver av de fem funksjonene gjøres hele `events.data` og `audit_log.changes` om til tekst med `JSON.stringify`, og «Megler Test», «Testmegling AS», `megler@example.com`, `00000000` og «Ferie» står ikke der.
4. **ingen hendelse** ved avvist tilgang, valideringsfeil, `EmployeeNotFoundError` eller «samme ansatt igjen».
5. **samme transaksjon** (egen fil `src/core/assignments/assignment-team-parties-transaction.test.ts`, `vi.mock("@/core/events")`/`vi.mock("@/core/audit")` som kaster én gang): `setTeamMember` ved bytte kaster, og den gamle raden er fortsatt aktiv og ingen ny rad finnes; `addParty` kaster, og ingen part finnes; `removeParty` kaster, og parten har `deleted_at = null`.

## 5. Fabrikker, `tests/factories.test.ts` (utvides)

1. **`createTeamMember`** uten overstyring: aktiv `responsible`-rad, oppdrag og ansatt laget i samme organisasjon, `fromAt = TEST_NOW`; overstyring av `teamRole`, `toAt`, `handedOverReason`, `deletedAt` brukes.
2. **`createAssignmentParty`** uten overstyring: `broker`, «Megler Test», mottar alle `false` (eller etter `defaultReceives`, men fast og dokumentert); overstyring brukes.
3. **`RESET_TABLES`** inneholder `assignment_team_members` og `assignment_parties` (testen som sammenligner med databasen).

## 6. Handlingene, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (ny, kjernen byttet ut som i `ordre/actions.test.ts`)

1. **`getEmployeeContext` gir `null`** → alle fire handlingene svarer `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** (oppdrags-id, part-id, ansatt-id) → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` endrer ikke kallet; kjernen kalles med `ORG`.
4. **`AccessDeniedError`** → `NO_ACCESS`; **`EmployeeNotFoundError`** → «Den ansatte finnes ikke.»; **`ZodError`** → feil ved feltet med kortets tekster; ukjent feil → `UNKNOWN_ERROR`.
5. **«Ingen» i nedtrekkslisten** sendes til kjernen som `employeeId = null`.
6. **loggkontrakt:** loggeren får bare rute, bruker-id, id-er og feilnavn; `JSON.stringify` av alle loggkall inneholder ikke navn, e-post, telefon, firma eller grunn.

## 7. E2E, `e2e/fase-2a-oppdrag-team-parter.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egen ordre og eget oppdrag med `uniqueSuffix()` (databasen tømmes ikke mellom kjøringer).

1. **hele flyten:** ny ordre → «Gjør om til oppdrag» → lenken «Gjort om til oppdrag 2026-…» åpner `/oppdrag/<id>` → lenken «Ordren» går tilbake til ordren (begge veier).
2. **team:** fem linjer i fast rekkefølge med «Ikke satt»; velg admin som ansvarlig → «Lagre» → navnet står; bytt til en annen ansatt med grunn «Ferie» → nytt navn står; velg «Ingen» → «Ikke satt».
3. **parter:** tom liste viser «Ingen parter er lagt inn ennå.»; «Legg til part» → rolle «Megler» → «Rapport» og «Kopi av meldinger» er krysset av, «Faktura» ikke; bytt rolle til «Fakturamottaker» → bare «Faktura» er krysset av; tilbake til «Megler», fyll inn «Megler Test», «Testmegling AS», `megler@example.com`, `00000000` → «Lagre» → kortet viser alt.
4. **endre og fjerne:** «Endre» → nytt navn → «Lagre» → kortet viser nytt navn; «Fjern» → kortet er borte, og tom-teksten står igjen.
5. **feilmeldinger ved feltet:** tomt navn → «Skriv inn navnet.»; `abc` i telefon → telefonmeldingen; ingenting lagres.
6. **takstmann uten endringstilgang:** innstillingen av for en egen testorganisasjon er tungt i e2e, så dette dekkes i 4.1.2 og 6.4. I e2e: takstmann (`logInAsInspector`, innstillingen på) ser team og parter. Lar det seg gjøre enkelt, legges en sjekk til av at siden uten `canEditOrders` ikke viser «Lagre», «Legg til part», «Endre» eller «Fjern».
7. **ukjent oppdrags-id** (tilfeldig uuid og `ikke-en-id`) gir «Fant ikke siden» eller «Ingen tilgang», aldri 500.
8. **iPad-størrelse** (prosjektet `ipad`, stående): ingen vannrett rulling på `/oppdrag/<id>`, én kolonne, parter vises som kort, alle knapper minst 44 px høye.
9. **tastaturet alene:** skjemaet «Legg til part» kan fylles ut og sendes med Tab og Enter.

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- Alle åtte `expectTenantIsolation`-kall i 4.2 og IDOR-testene i 4.3.
- Rettighetsmatrisen kjørt med innstillingen på og av, og admin-testen 4.1.5.
- Myk sletting (4.4) og at teamrader aldri slettes.
- Personvern-testen 4.8.3 og loggkontrakten 6.6.
- Begge tabellene i `tests/tenant-tables.ts`.
- Ingen tilgangslogikk i siden eller handlingene utover `NO_ACCESS`-mappingen.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjonen økt.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Sette og bytte fem roller, grunn, «Ingen» | 4.6.1–4.6.6, 7.2 |
| Én aktiv per rolle, samtidige bytter | 3.1–3.3, 4.6.9 |
| Sluttet/slettet ansatt kan ikke velges | 4.5.3, 4.6.7 |
| Parter: legge til, endre, fjerne, forhåndsutfylt, myk sletting | 1.4, 4.4.2–4.4.3, 4.7, 7.3–7.4 |
| Lenker ordre ↔ oppdrag | 4.5.5, 7.1 |
| Hendelser og logg i samme transaksjon, uten personopplysninger | 4.8 |
| Innstillingen av: takstmann leser, ikke endrer; `NO_ACCESS` uten ansattrad | 4.1, 6.1 |
| Tenant-isolasjon og fremmed id | 3.6–3.7, 3.11, 4.2, 4.3 |
| iPad-størrelse | 7.8 |
| Kommandoene grønne, versjon økt | gjennomgangen |
