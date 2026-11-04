# Testplan: Manuell ordre og oppdragsnummer

- **Oppgavekort:** `docs/funksjoner/fase2a-manuell-ordre.md`
- **Dato:** 03.11.2026 (test-leder, forhåndsvurdering runde 1)
- **Støtter hovedmål:** tid (fire trykk fra e-post til oppdragsnummer, nummeret kommer fra serveren uten oppslag), reklamasjoner (ordre og oppdrag er adskilt, avvisning har grunn, alt logges, ingen to oppdrag får samme nummer) og KI først (`source` som fast kode er kroken for e-post-til-ordre; testene låser at `manual`, `email` og `broker_system` finnes og at bare `manual` brukes nå).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: adresser som «Testveien 12, 8000 Bodø», bestiller «Megler Testesen, Testmegleren AS», gnr/bnr `12`/`34`, borettslag «Testtoppen borettslag», ekstern referanse `TEST-ORD-0001`. Ingen ekte navn, adresser eller matrikkelnumre.

Fast tid i testene: `NOW = new Date("2026-11-03T10:00:00Z")` (i dag = `2026-11-03` i Oslo, serien `2026-`). Årsskiftet: `new Date("2026-12-31T23:30:00Z")` er 01.01.2027 i Oslo → serien `2027-`.

Ingen del av oppgaven virker uten nett (ordre legges inn på kontoret med nett, D9), så det trengs ingen e2e uten nett.

## Avtale om signaturer (utvikler og testskriver)

Testskriveren skriver mot dette. Avviker utvikleren, står det i kortet under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.

- **Faste koder** i `src/core/orders/codes.ts` og `src/core/assignments/codes.ts`: `ORDER_SOURCES = ["manual", "email", "broker_system"]`, `ORDER_STATUSES = ["received", "converted", "rejected"]`, `ASSIGNMENT_TYPES = ["condition_report"]`, `ASSIGNMENT_STATUSES = ["ordered", "in_progress", "completed", "invoiced"]`, `NUMBER_SEQUENCE_SCOPES = ["assignment"]`, alle `as const`, med etikettfunksjoner `orderStatusLabel(code)` og `assignmentStatusLabel(code)`.
- **Zod** i `src/core/orders/schemas.ts`: `orderInputSchema(now: Date)` (fabrikk som tar `now`, slik at «Mottatt kan ikke være frem i tid.» kan testes med fast tid) og `rejectReasonSchema` (1–500 tegn, trimmet). Meldingene fra kortet: «Skriv inn adressen.», «Gårdsnummer kan bare ha sifre.», «Bruksnummer kan bare ha sifre.», «Seksjonsnummer kan bare ha sifre.», «Mottatt kan ikke være frem i tid.», «Skriv inn en grunn.».
- **Feilklasser** i `src/core/orders/errors.ts`: `OrderAlreadyHandledError` (melding «Ordren er allerede behandlet.») og `OfficeNotFoundError` (melding «Kontoret finnes ikke.»). Fremmed, ukjent, slettet eller ugyldig ordre-id gir `AccessDeniedError` (samme mønster som adminområdet, aldri «finnes ikke» som røper noe).
- **Tjenester** i `src/core/orders` (eksportert fra `src/core/orders/index.ts`), alle med `(actor, organizationId, …)` først:
  - `listOrders(actor, organizationId)` → rader med `id`, `receivedAt`, `source`, `externalRef`, `orderedByText`, `addressText`, `status`, `assignmentId`, `assignmentNumber` (tom når ikke konvertert). Ingen sporingsfelt.
  - `getOrder(actor, organizationId, orderId)` → alle feltene fra Omfang 1 pluss `assignmentNumber`; aldri `deletedBy`/`rowVersion`.
  - `createOrder(actor, organizationId, input, now?)` → raden. `input`: `addressText`, `receivedAt` (ISO-tekst eller `Date`), valgfri `externalRef`, `orderedByText`, `gnr`, `bnr`, `snr`, `housingAssociationName`, `sellerDeclarationReceived`, `note`, `requestedReportType` (standard `condition_report`).
  - `rejectOrder(actor, organizationId, orderId, reason)` → raden med `status = "rejected"`.
  - `convertOrderToAssignment(actor, organizationId, orderId, { officeId, now? })` → `{ assignment: { id, number, officeId, status, orderId }, order }`.
- **Oppdrag** i `src/core/assignments`: `nextAssignmentNumber(executor, grant, today)` → `string` (f.eks. `2026-00001`); `getAssignment(actor, organizationId, assignmentId)` → `id`, `number`, `officeId`, `orderId`, `assignmentType`, `status`, `statusChangedAt`, `externalRef`.
- **Organisasjonen i `/ordre`:** sidene og handlingene henter `{ actor, organizationId }` fra én funksjon `getEmployeeContext()` i `src/app/(ansatt)/employee-context.ts` (første organisasjon fra `listOrganizationsForActor`, ellers `null`). Handlingene i `src/app/(ansatt)/ordre/actions.ts`: `createOrderAction(previous, formData)`, `rejectOrderAction(previous, formData)`, `convertOrderAction(previous, formData)`; resultat og meldinger som adminområdet (`FormState`, `NO_ACCESS`, `UNKNOWN_ERROR`). `action-result.ts` og `form-state.ts` flyttes til `src/shared/ui` eller `src/app/(ansatt)/` når `/ordre` bruker dem; testene i `admin/actions.test.ts` skal fortsatt være grønne.
- **Fabrikker** i `tests/factories.ts`: `createOrder(organizationId, overrides?)` (standard: `received`, `manual`, oppdiktet adresse, `receivedAt = NOW`), `createAssignment(organizationId, overrides?)` (lager et kontor selv når `officeId` mangler; standard `number` fra en teller `TEST-00001`, `TEST-00002` …, så fabrikken aldri bruker nummerserien), `createNumberSequence(organizationId, overrides?)`. `RESET_TABLES` får `orders`, `assignments` og `number_sequences` (`tests/factories.test.ts` sjekker at alle tabeller i databasen står der).
- **Hendelser og logg:** `recordEvent` fra `@/core/events` og `recordAuditEvent` fra `@/core/audit`, kalt med transaksjonens `executor`. Testene for «samme transaksjon» (4.6) bytter ut `recordEvent` med `vi.mock`, så den må importeres fra modulen, ikke kopieres.

## 1. Faste koder og Zod, `src/core/orders/codes.test.ts` og `schemas.test.ts` (nye, rene enhetstester)

1. **kodene er låst:** `ORDER_SOURCES` er nøyaktig `manual`, `email`, `broker_system`; `ORDER_STATUSES` nøyaktig `received`, `converted`, `rejected`; `ASSIGNMENT_STATUSES` nøyaktig de fire fra 27.10.2026 i rekkefølgen bestilt → fakturert; `ASSIGNMENT_TYPES` og `NUMBER_SEQUENCE_SCOPES` har én kode hver. Kommentar: kodene endres aldri (regel 6); får en kode ny betydning, lages en ny.
2. **etiketter:** hver kode har norsk etikett (`Mottatt`, `Gjort om til oppdrag`, `Avvist`; `Bestilt`, `Under arbeid`, `Ferdig`, `Fakturert`); ukjent kode gir koden tilbake, aldri `undefined`.
3. **adresse** (`it.each`): tom, bare mellomrom → «Skriv inn adressen.»; 300 tegn godtas, 301 avvises; trimmes.
4. **gnr/bnr/snr** (`it.each`): `"12"` godtas; `"12a"`, `"1 2"`, `"-1"`, `"12345678901"` (11 tegn) avvises med feltets melding; tom streng blir `null`.
5. **lengder:** `externalRef`, `orderedByText`, `housingAssociationName` 200 ok / 201 avvist; `note` 2000 ok / 2001 avvist.
6. **mottatt:** `receivedAt = NOW` og `NOW − 1 dag` godtas; `NOW + 1 minutt` → «Mottatt kan ikke være frem i tid.»; ugyldig tekst (`"i går"`, `"2026-13-01"`) avvises; mangler → standard `now`.
7. **`sellerDeclarationReceived`:** mangler → `false`; `"on"`/`true` → `true` (slik avkrysningen sender).
8. **`requestedReportType`:** mangler → `condition_report`; `"bolig"` avvises; `source` kan ikke settes fra skjemaet (feltet finnes ikke i skjemaet, eller ignoreres: resultatet er alltid `manual`).
9. **avvisningsgrunn:** tom og bare mellomrom → «Skriv inn en grunn.»; 500 ok, 501 avvist; trimmes.

## 2. Nummerserien, `src/core/assignments/number-sequence.test.ts` (ny, mot databasen)

Alle kall skjer i `db.transaction` med et `grant` fra `requireOrganizationAccess(admin, org.id, "assignment.edit")`.

1. **første nummer i året lager serien:** ingen rad finnes → `2026-00001`; etterpå finnes én rad med `scope = assignment`, `prefix = 2026-`, `next_value = 2`, `padding = 5`.
2. **neste nummer:** andre kall gir `2026-00002`; ti kall gir `00001`–`00010` i rekkefølge.
3. **format:** hvert nummer matcher `^\d{4}-\d{5}$`; nummer 100 000 (sett `next_value = 100000` direkte) gir `2026-100000` uten å kaste (padding er minimum, ikke maksimum; utvikler bekrefter, ellers endres testen til det valget som tas og dokumenteres).
4. **året fra norsk tid:** `today = todayInOslo(new Date("2026-12-31T23:30:00Z"))` gir `2027-00001` mens 2026-serien står med sin `next_value`; to serier for samme organisasjon.
5. **to organisasjoner får hver sin serie:** A og B får begge `2026-00001`; tabellen har to rader med ulik `organization_id`.
6. **20 samtidige kall** (`Promise.all` over 20 transaksjoner) gir 20 ulike numre som er nøyaktig `00001`–`00020`, og `next_value` er 21 etterpå.
7. **`expectTenantIsolation` for `number_sequences`:** `seed` lager én serie i A og B med `createNumberSequence`; `query(actor, organizationId)` sjekker tilgang med `requireOrganizationAccess(actor, organizationId, "assignment.edit")`, henter neste nummer i en transaksjon og returnerer seriens rader for `grant.organizationId` (`idOf: row.id`). Viser at A aldri teller opp B sin serie. Dette er testfilen som føres i `tests/tenant-tables.ts` for `number_sequences`.
8. **tilgang:** kall med `grant` fra en takstmann med innstillingen av er ikke mulig, fordi `requireOrganizationAccess(…, "assignment.edit")` kaster før (vises i 4.1); `nextAssignmentNumber` selv stoler på `grant.organizationId` og tar aldri en id som parameter (test-leder sjekker signaturen i gjennomgangen).

## 3. Oppdrag, `src/core/assignments/assignments.test.ts` (ny)

1. **`getAssignment` per rolle** (`it.each` over `inspector` med innstillingen på og av, `office`, `manager`, `admin`): alle får raden (`organization.read`). Ansatt uten roller, deaktivert ansatt og bruker uten ansattrad får `AccessDeniedError`.
2. **`expectTenantIsolation` for `getAssignment`:** `seed` lager ett oppdrag i A og B; `query` henter oppdraget som hører til `organizationId`.
3. **fremmed og ukjent id:** oppdrags-id fra B, tilfeldig uuid og `"ikke-en-id"` gir `AccessDeniedError`, ingen databasefeil.
4. **slettet oppdrag** (`deletedAt` satt) gir `AccessDeniedError`.
5. **faste felt:** `Object.keys(row).sort()` er en fast liste uten `deletedBy`, `rowVersion`, `organizationId`.

## 4. Ordre, `src/core/orders/orders.test.ts` (ny)

### 4.1 Tilgang per rolle

1. **se** (`listOrders`, `getOrder`; `it.each` over `inspector` på/av, `office`, `manager`, `admin`): alle lykkes.
2. **endre** (`createOrder`, `rejectOrder`, `convertOrderToAssignment`; `it.each`): `office`, `manager`, `admin` og `inspector` med innstillingen på lykkes; `inspector` med innstillingen av får `AccessDeniedError`, og antall rader i `orders`, `assignments`, `events`, `audit_log` og `number_sequences` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` kan alle tre.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt:** `AccessDeniedError` på `listOrders` (ser ingenting) og på `createOrder`.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller og med innstillingen av kan se, legge inn, avvise og gjøre om.

### 4.2 Tenant-isolasjon (ett `expectTenantIsolation` per funksjon, fem her)

1. **`listOrders`:** `seed` lager to ordre i A og én i B (også én slettet i A, som aldri skal komme med, sjekkes etterpå).
2. **`getOrder`:** `query` henter ordren som hører til `organizationId`, returnerer `[row]`.
3. **`createOrder`:** `seed` returnerer organisasjons-id-ene (`a: [orgA.id]`); `query` lager en ordre i `organizationId` og returnerer `[row]` med `idOf: row.organizationId`. Etterpå: B har nøyaktig én ordre, og alle `events`/`audit_log`-rader i B har `organization_id = B`.
4. **`rejectOrder`:** `seed` lager én mottatt ordre i A og B; `query` avviser den i `organizationId`. Etterpå: B-raden er avvist nøyaktig én gang, `updatedAt` urørt av A.
5. **`convertOrderToAssignment`:** `seed` lager ordre og kontor i A og B; `query` konverterer og returnerer `[{ id: order.id }]`. Etterpå: hver organisasjon har ett oppdrag med `2026-00001` og én serie.

### 4.3 Fremmed id i egen organisasjon (regel 2)

1. **`getOrder`, `rejectOrder`, `convertOrderToAssignment` med ordre-id fra B** (admin A, `orgA`): `AccessDeniedError`; B-ordren står uendret som `received`, ingen rad i `events`, `audit_log`, `assignments` eller `number_sequences`.
2. **`convertOrderToAssignment` med `officeId` fra B:** `OfficeNotFoundError`; ordren står som `received`, ingen oppdrag, ingen serie, ingen hendelse.
3. **slettet kontor i egen organisasjon:** `OfficeNotFoundError`.
4. **tilfeldig uuid og `"ikke-en-id"`** som ordre-id og kontor-id: `AccessDeniedError` eller `OfficeNotFoundError`, aldri databasefeil.
5. **slettet ordre** (`deletedAt` satt): `getOrder`, `rejectOrder` og `convertOrderToAssignment` gir `AccessDeniedError`; `listOrders` viser den ikke.

### 4.4 Legge inn og liste

1. **`createOrder` lagrer alle feltene** (adresse, gnr, bnr, snr, borettslag, egenerklæring, bestiller, ekstern referanse, merknad, mottatt), setter `organizationId = grant.organizationId` (ikke en id fra input: send `organizationId: orgB.id` i input og vis at den ignoreres eller avvises), `source = manual`, `status = received`, `createdBy` = den ansatte.
2. **minimal ordre:** bare adresse → alle valgfrie felt `null`, `sellerDeclarationReceived = false`, `receivedAt = now`.
3. **valideringsfeil** gir `ZodError`, ingen rad, ingen hendelse, ingen loggrad.
4. **`listOrders` sorterer nyeste `receivedAt` først**; slettede rader er aldri med; `assignmentNumber` er fylt bare for konverterte.
5. **faste felt:** `Object.keys` i `listOrders` og `getOrder` er faste lister uten sporingsfelt.

### 4.5 Avvise og gjøre om (statusreglene som data)

1. **`rejectOrder` fra `received`:** `status = rejected`, `rejected_reason` lagret (trimmet), `assignmentId` tom. Raden slettes ikke (`deletedAt` er `null`), og den står fortsatt i `listOrders` (A55).
2. **`convertOrderToAssignment` fra `received`:** oppdraget har `number = 2026-00001`, `status = ordered`, `statusChangedAt` = `now`, `assignmentType = condition_report`, `officeId` = valgt kontor, `orderId` = ordren, `externalRef` kopiert; ordren har `status = converted` og `assignmentId` = oppdraget; svaret inneholder nummeret.
3. **overgangstabell** (`it.each` over `{ fra: converted | rejected, handling: reject | convert }`, fire saker): `OrderAlreadyHandledError`, ingen endring i `orders` (`updatedAt`, `rowVersion` like), ingen ny rad i `assignments`, `events`, `audit_log`; `next_value` uendret.
4. **to samtidige konverteringer av samme ordre** (`Promise.all` med to kall): nøyaktig ett lykkes, det andre gir `OrderAlreadyHandledError`; ett oppdrag, `next_value = 2` (taperen bruker ikke opp et nummer, ingen hull).
5. **20 samtidige konverteringer av 20 ordre:** 20 oppdrag med numrene `00001`–`00020` (sortert), alle ordre `converted`, hver med sin egen `assignmentId`, `next_value = 21`.
6. **årsskiftet via `now`:** én konvertering med `now = 2026-12-31T23:30:00Z` gir `2027-00001` etter at `2026-00001` finnes.
7. **to organisasjoner:** A og B får begge `2026-00001` (også dekket av 4.2.5).
8. **ordre uten ekstern referanse** gir oppdrag med `externalRef = null`.

### 4.6 Hendelser og revisjonslogg i samme transaksjon

1. **`createOrder`:** én `events`-rad `order.received` med `actorType = employee`, `actorId` = den ansatte, `assignmentId = null`, `data` uten personopplysninger (bare `orderId`); én `audit_log`-rad `entityType = order`, `action = create`, `entityId` = ordren.
2. **`rejectOrder`:** `order.rejected` med `data.reason`; `audit_log` `action = reject` med `changes.status` fra `received` til `rejected` og grunnen.
3. **`convertOrderToAssignment`:** `assignment.created` med `assignmentId` = oppdraget og `data = { number, orderId }`; `audit_log` har `order`/`convert` og `assignment`/`create` (to rader).
4. **ingen hendelse** ved avvist tilgang, valideringsfeil eller `OrderAlreadyHandledError`.
5. **feiler hendelsen, finnes ingenting** (i egen fil `src/core/orders/orders-transaction.test.ts`, se runde 2): `vi.mock("@/core/events")` og `vi.mock("@/core/audit")` med `recordEvent`/`recordAuditEvent` som kaster én gang: `createOrder` kaster, og `orders` er tom; `convertOrderToAssignment` kaster, ordren står som `received`, ingen oppdrag, `number_sequences` er uendret (ingen rad, eller samme `next_value`). Samme for `recordAuditEvent` i `rejectOrder`.
6. **`events.assignment_id` peker på et ekte oppdrag:** `assignment.created`-raden kan slås opp mot `assignments` med samme `organization_id` (fremmednøkkelen fra A33 er på plass; 6.9 viser at den avviser).

## 5. Fabrikker, `tests/factories.test.ts` (utvides)

1. **`createOrder`** uten overstyring gir `received`, `manual`, `receivedAt = NOW`, i organisasjonen; overstyring av `status`, `rejectedReason`, `assignmentId`, `deletedAt` brukes (for `converted` må testen sende med et oppdrag).
2. **`createAssignment`** lager kontor selv når `officeId` mangler, i samme organisasjon; to kall gir ulike `number`; overstyring av `officeId`, `orderId`, `number`, `deletedAt` brukes.
3. **`createNumberSequence`** gir `scope = assignment`, `prefix = 2026-`, `next_value = 1`, `padding = 5`.
4. **`RESET_TABLES`** inneholder `orders`, `assignments` og `number_sequences` (testen som sammenligner med databasen).

## 6. Databasen, `src/db/orders-schema.test.ts` (ny, direkte innsetting)

1. **`rejected` uten `rejected_reason`** avvises (CHECK).
2. **`converted` uten `assignment_id`** avvises.
3. **`assignment_id` på en `received`-ordre** avvises.
4. **`rejected` med `assignment_id`** avvises.
5. **ordre som peker på oppdrag i annen organisasjon** (`organization_id` A, `assignment_id` fra B) avvises av den sammensatte fremmednøkkelen.
6. **oppdrag med kontor fra annen organisasjon** avvises.
7. **to oppdrag med samme `number` i samme organisasjon** avvises; samme `number` i to organisasjoner godtas.
8. **ukjente koder:** `source = "fax"`, `status = "lost"`, `assignment_type = "valuation"`, `assignments.status = "cancelled"`, `scope = "invoice"` avvises.
9. **hendelse med `assignment_id` fra annen organisasjon** avvises (fremmednøkkelen på `events`, A33); hendelse med `assignment_id = null` godtas (som i dag).
10. **to serier med samme `(organization_id, scope, prefix)`** avvises; `next_value = 0` avvises hvis utvikler legger CHECK (ellers tas testen ut og noteres).
11. **`number_sequences` i `tests/tenant-tables.ts`** med radbygger `createNumberSequence` og testfil `src/core/assignments/number-sequence.test.ts`; `orders` → `src/core/orders/orders.test.ts`; `assignments` → `src/core/assignments/assignments.test.ts`. `tests/tenant-isolation-all-tables.test.ts` er grønn (18 tabeller: 15 fra før pluss de tre nye).
12. **migreringen er ren:** `pnpm db:generate` lager ingen ny fil (sjekkes i gjennomgangen).

## 7. Server actions, `src/app/(ansatt)/ordre/actions.test.ts` (ny, kjernen byttet ut som i `admin/actions.test.ts`)

1. **`getEmployeeContext` gir `null`** → alle tre handlingene svarer `NO_ACCESS` uten å kalle kjernen.
2. **organisasjonen kommer fra konteksten:** et skjema med feltet `organizationId = OTHER_ORG` endrer ingenting; kjernen kalles med `ORG`.
3. **`createOrderAction`:** `ZodError` fra kjernen gir feil ved feltet med kortets tekster; suksess sender videre til `/ordre/<id>`; `AccessDeniedError` gir `NO_ACCESS`; ukjent feil gir `UNKNOWN_ERROR` og logger bare feilnavn, rute og bruker-id (aldri adressen).
4. **`rejectOrderAction`:** tom grunn gir «Skriv inn en grunn.» uten kall til kjernen; `OrderAlreadyHandledError` gir meldingen «Ordren er allerede behandlet.»; ordre-id som ikke er uuid gir `NO_ACCESS` uten kall.
5. **`convertOrderAction`:** mangler kontor → melding ved feltet uten kall; `OfficeNotFoundError` → «Kontoret finnes ikke.»; suksess sender videre til `/ordre/<id>` (nummeret vises der).

## 8. E2E, `e2e/fase-2a-ordre.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed (Byggcon har fem kontorer fra seed, så «Gjør om til oppdrag» virker). Hver test lager sin egen ordre med `uniqueSuffix()` i adressen, fordi e2e-databasen ikke tømmes mellom kjøringer. Tom liste («Ingen ordre er lagt inn ennå.») testes ikke i e2e (andre kjøringer har lagt inn rader); den dekkes av en enhetstest av listekomponenten hvis utvikler lager en, ellers av 4.4.4 med tom organisasjon.

1. **menypunktet «Ordre»** finnes i hovedmenyen og er aktivt på `/ordre`.
2. **ny ordre → gjør om → nummeret vises:** «Ny ordre» → fyll adresse, gnr, bnr, snr, borettslag, bestiller, kryss av egenerklæring → «Lagre» → `/ordre/<uuid>` viser alle feltene og merket «Mottatt» → «Gjør om til oppdrag» → velg kontor «Bodø» → «Gjør om til oppdrag» → siden viser «Gjort om til oppdrag» og et nummer som matcher `/\d{4}-\d{5}/`; knappene er borte; listen viser nummeret på raden. Nummeret sammenlignes ikke med `00001` (databasen er delt).
3. **ny ordre → avvis med grunn:** «Avvis» → «Bekreft» uten grunn gir «Skriv inn en grunn.» og ingen endring; med grunn «Feil registrering» → merket «Avvist» og grunnen vises; knappene er borte. «Avbryt» i bekreftelsen endrer ingenting.
4. **feilmeldinger ved feltet:** tom adresse → «Skriv inn adressen.»; gnr `12a` → «Gårdsnummer kan bare ha sifre.»; mottatt frem i tid → «Mottatt kan ikke være frem i tid.»; feltet har `aria-describedby` til meldingen; ingenting lagres (listen har ikke adressen).
5. **takstmann ser ordren og kan legge inn** (`logInAsInspector`, innstillingen er på i seed): `/ordre` viser listen; ny ordre kan lagres. Takstmann uten `assignment.edit` testes bare i kjernen (4.1.2), fordi innstillingen deles av hele e2e-databasen.
6. **bruker uten ansattrad:** ny innlogging med `signInWithCode` for en oppdiktet adresse uten ansattrad → `/ordre` gir «Ingen tilgang» eller 404, aldri 500, og HTML-en inneholder ingen adresse fra listen.
7. **iPad (bare prosjektet `ipad`):** «Ny ordre», «Lagre», «Gjør om til oppdrag» og «Avvis» er minst 44 px; skjemaet fylles og sendes med tastaturet alene; i stående (834x1194) har `/ordre`, `/ordre/ny` og `/ordre/<id>` ingen vannrett rulling; skjemaet står i én kolonne.
8. **ukjent ordre-id** (`/ordre/<tilfeldig uuid>`) gir «Fant ikke siden» eller «Ingen tilgang», aldri 500.

## 9. Sjekker i gjennomgangen (test-leder)

1. Hver spørring som tar `organizationId` har ett `expectTenantIsolation` (2.7, 3.2, 4.2.1–4.2.5: sju kall). `nextAssignmentNumber` tar `grant`, ikke id, og dekkes av 2.7.
2. `grep` i `src/core/orders` og `src/core/assignments`: all filtrering bruker `grant.organizationId`; ingen `organizationId` fra parameterlisten brukes etter `requireOrganizationAccess`.
3. Ingen tilgangslogikk i `src/app/(ansatt)/ordre/*` (ingen import av `requireOrganizationAccess` eller rollenavn der; bare `getEmployeeContext` og kjernen).
4. `src/core/access` er uendret (diff), rollematrisen i `guards.test.ts` og `permissions.test.ts` urørt.
5. `number_sequences` oppdateres bare i `nextAssignmentNumber`, og bare med `INSERT … ON CONFLICT … DO UPDATE … RETURNING` i transaksjonen som lager oppdraget (`grep` etter `numberSequences` utenfor filen).
6. `FOR UPDATE` på ordreraden i `convertOrderToAssignment` kommer før nummeret hentes (4.5.4 er rød ellers).
7. Ingen ekte adresser, navn eller matrikkelnumre i testdata eller e2e; `ordered_by_text` har ingen ledetekst som ber om mer enn navn og firma.
8. `RESET_TABLES`, `tests/tenant-tables.ts` og `tests/tenant-isolation-all-tables.test.ts` dekker de tre tabellene.
9. Versjon 0.2.69; A51–A55 i `docs/09-apne-sporsmal.md`; domenemodellen 4.3 og ordlisten oppdatert; planen satt til «i arbeid fra 03.11.2026».
10. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Legge inn ordre med alle feltene, se i liste og på egen side | 4.4.1–4.4.2, 8.2 |
| Gjør om: nummer `ÅÅÅÅ-NNNNN`, status Bestilt, kontor, kobling begge veier, ordren viser nummeret | 2.1–2.3, 4.5.2, 8.2 |
| Avvis krever grunn, viser grunnen; behandlet ordre kan ikke behandles igjen | 1.9, 4.5.1, 4.5.3, 7.4, 8.3 |
| 20 samtidige gir 20 påfølgende; to av samme ordre gir ett oppdrag | 2.6, 4.5.4, 4.5.5 |
| Serie per år og organisasjon, norsk tid | 2.4, 2.5, 4.5.6, 4.5.7 |
| Hendelser og revisjonslogg i samme transaksjon | 4.6.1–4.6.5 |
| Takstmann med innstillingen av ser, men endrer ikke; kontor, leder, admin alt; uten ansattrad ingenting | 4.1.1–4.1.5, 3.1, 8.5, 8.6 |
| Databasen avviser (CHECK, sammensatte fremmednøkler, unikt nummer, ukjente koder) | 6.1–6.10 |
| Tenant-isolasjon per spørring og de tre tabellene i registeret | 2.7, 3.2, 4.2, 4.3, 6.11 |
| iPad-størrelse | 8.2, 8.3, 8.7 |
| Alt grønt, versjon 0.2.69 | 9.9, 9.10 |

## Endringer etter prosjektlederens avgjørelser (03.11.2026, runde 1)

Prosjektlederen tok alle forslagene fra forenkler, sikkerhet-personvern og test-leder (se «Avgjørelser etter forhåndsvurderingen» i oppgavekortet). Der dette avsnittet sier noe annet enn teksten over, gjelder dette avsnittet.

- **Avsnitt 3 går ut.** `getAssignment` og `src/core/assignments/assignments.test.ts` lages ikke. `assignments` føres i `tests/tenant-tables.ts` med testfilen `src/core/orders/orders.test.ts` (4.2.5 lager radene). `src/core/assignments` har bare `codes.ts` og `number-sequence.ts`.
- **1.1:** `ORDER_SOURCES` er nøyaktig `manual`, `email` (ikke `broker_system`).
- **1.5 og 4.4.1:** `note` finnes ikke på ordren. **4.4.1** uten merknad.
- **1.8:** `requestedReportType` og `source` kan ikke settes fra skjemaet (feltene ignoreres eller avvises; resultatet er alltid `condition_report` og `manual`). Ingen nedtrekksliste i e2e 8.2.
- **Nytt 1.10:** `orderedByText` og avvisningsgrunn med 11 sifre på rad (`"Ola 12345678901"`) avvises med «Fødselsnummer skal ikke lagres her.»; 10 sifre godtas. `addressText` og `externalRef` har ikke sperren.
- **2.3 og 6.10 er avgjort:** `padding` er minimum (nummer 100 000 gir `2026-100000` uten feil); `next_value = 0` avvises av CHECK.
- **4.1.1–4.1.2:** rollematrisen kjøres én gang for lesing (`listOrders`) og én gang for skriving (`createOrder`). For `rejectOrder` og `convertOrderToAssignment` holder `expectTenantIsolation` (4.2.4, 4.2.5) pluss én nekt for takstmann med innstillingen av (ingen rad endret, ingen hendelse, serien uendret). 4.1.3–4.1.5 står.
- **4.5.2 og 4.5.8:** oppdraget har ikke `externalRef` eller `statusChangedAt`. 4.5.8 går ut. Svaret fra `convertOrderToAssignment` er `{ assignment: { id, number, officeId, status, orderId }, order }`.
- **4.6.1:** `order.received` har `data = { orderId, source }`; `audit_log.changes = { status: "received", source, requestedReportType }`, aldri adresse eller bestiller.
- **4.6.2:** `order.rejected` har `data = { orderId }` (ikke grunnen); `audit_log.changes = { status: { from: "received", to: "rejected" }, rejectedReason }`.
- **4.6.3:** `audit_log` for `order`/`convert` har `changes = { status: { from, to }, assignmentId, number }`; `assignment`/`create` har `{ number, status: "ordered", officeId }`.
- **Felles skjemadeler:** `action-result.ts`, `form-state.ts` og `form-parts.tsx` flyttes til `src/app/(ansatt)/`. `errorResult` tar de kjente feilene som parameter. `admin/actions.test.ts` retter prosjektlederen ved sammenslåingen.
- **Konteksten:** `getEmployeeContext()` i `src/app/(ansatt)/employee-context.ts` gir `{ actor, organizationId, canEditOrders }` eller `null`, bygget på `findEmployeeGrant(actor)` i `src/core/organization`. **Nytt 7.6** (`src/app/(ansatt)/employee-context.test.ts`): grant uten `assignment.edit` gir `canEditOrders = false`; ingen organisasjon gir `null`. «Siden uten knappene» dekkes av 7.6 og 4.1.2, ikke e2e.
- **7.3:** testen for ukjent feil sjekker at logglinjen ikke inneholder adressen, bestilleren eller grunnen fra skjemaet (bare `route`, `userId`, id-er og `errorName`).
- **8.3:** ingen bekreftelsesdialog og ingen «Avbryt». «Avvis» med tom grunn gir «Skriv inn en grunn.» og ingen endring; med grunn «Feil registrering» → merket «Avvist» og grunnen vises.
- **9.1:** seks `expectTenantIsolation`-kall (2.7, 4.2.1–4.2.5).
- **Dekningstabellen:** rad «Takstmann …» uten 3.1; rad «Tenant-isolasjon …» uten 3.2; ny rad «Taperen bruker ikke opp et nummer» → 4.5.4; ny rad «Hendelser og logg uten personopplysninger» → 4.6.1–4.6.3; ny rad «Ukjent feil logges uten skjemaverdier» → 7.3; ny rad «`next_value = 0` avvises» → 6.10.

## Endringer etter test-leders gjennomgang av testplanen (04.11.2026, runde 2)

Prosjektlederen tok alle sju rettelsene. Der dette avsnittet sier noe annet enn teksten over (også runde 1), gjelder dette avsnittet.

1. **6.11:** 18 tabeller i `tests/tenant-tables.ts` (15 fra før pluss `orders`, `assignments` og `number_sequences`). Rettet i teksten.
2. **4.2.1 `listOrders` og 4.2.2 `getOrder`:** `seed` lager i både A og B en ordre som er gjort om til oppdrag, med et ekte oppdrag (`createAssignment` med `orderId`, og ordren `converted` med `assignmentId`). A og B får ulike nummer (fabrikken teller `TEST-0000N`). Etterpå: A sine rader har bare A sitt `assignmentNumber`, aldri B sitt; B sitt nummer finnes ikke noe sted i A sitt svar. Slik er koblingen (left join mot `assignments`) testet for tenant-isolasjon. Testskriveren sjekker at joinen også filtrerer `assignments.organization_id` (en ordre i A kan ikke peke på et oppdrag i B på grunn av den sammensatte fremmednøkkelen i avsnitt 6, så testen viser at svaret bare bygger på A sine rader).
3. **4.6.5 i egen fil:** `src/core/orders/orders-transaction.test.ts` med `vi.mock("@/core/events")` og `vi.mock("@/core/audit")`. Mocken kaller den ekte funksjonen (`vi.importActual`) og kaster bare der testen ber om det (`mockImplementationOnce`). `orders.test.ts` bruker de ekte modulene uten mock. Utvikleren importerer `recordEvent` fra `@/core/events` og `recordAuditEvent` fra `@/core/audit`, aldri med relativ sti (test-leder sjekker dette i gjennomgangen, nytt 9.11). Filen trenger ikke `expectTenantIsolation` (den tester ingen ny spørring).
4. **8.2 og 8.7:** ingen «Bekreft». Man velger kontor og trykker «Gjør om til oppdrag». 8.7 gjelder «Ny ordre», «Lagre», «Gjør om til oppdrag» og «Avvis». Rettet i teksten.
5. **Forhåndsvalgt kontor (nytt 7.7):** ren hjelpefunksjon `officeChoice(offices, employeeOfficeId)` i `src/app/(ansatt)/ordre/office-choice.ts`, testet i `src/app/(ansatt)/ordre/office-choice.test.ts` (ingen database, ingen komponenttest; repoet har ikke testbibliotek for React, og vi legger ikke til et). Svar: `{ offices, defaultOfficeId: string | null, emptyMessage: string | null }`. Saker:
   1. den ansattes kontor står i listen → `defaultOfficeId` er det kontoret;
   2. den ansatte har ikke kontor (`null`) → `defaultOfficeId = null`;
   3. den ansattes kontor står ikke i listen (slettet, så `listOffices` har ikke med det) → `defaultOfficeId = null`;
   4. tom liste → `emptyMessage = "Legg inn et kontor i admin først."` og `defaultOfficeId = null`;
   5. liste med kontorer → `emptyMessage = null`.
   Kontorlisten hentes med `listOffices` (har tenant-test fra før). Den ansattes kontor kommer fra `getEmployeeContext()`, som nå også gir `officeId` (se kortet). **7.6 utvides:** ansatt med kontor gir `officeId` = kontoret; ansatt uten kontor gir `officeId = null`. Det kommer ingen ny spørring som tar `organizationId`, så antallet `expectTenantIsolation` er fortsatt seks. Lager utvikleren likevel en ny spørring, trenger den sitt eget kall.
6. **Samtidighet (2.6, 4.5.5):** databaseklienten har `max: 10`, så 20 transaksjoner kjører høyst ti om gangen. Testene står, men får lengre tidsgrense (`{ timeout: 30_000 }`). **4.5.4:** de to kallene startes samtidig i én `Promise.all([convert(...), convert(...)])`, uten `await` imellom (bruk `Promise.allSettled` for å lese begge utfallene).
7. **9.5:** `grep` etter `numberSequences` og `number_sequences` gjøres bare i `src/` og utenom `*.test.ts` (2.3 setter `next_value` direkte i testen, og fabrikken `createNumberSequence` skriver til tabellen).
8. **Nytt 9.11:** `grep` i `src/core/orders`: `recordEvent` og `recordAuditEvent` importeres fra `@/core/events` og `@/core/audit`, ikke med relativ sti.
9. **Dekningstabellen:** ny rad «Kontoret er forhåndsvalgt; uten kontorer vises beskjeden» → 7.6, 7.7, 8.2. Raden «Tenant-isolasjon …» får med «4.2.1–4.2.2 med konvertert ordre i begge organisasjoner».

