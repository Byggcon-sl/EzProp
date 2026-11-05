# Testplan: Statusflyten for oppdrag, kansellering og merket «Rettet»

- **Oppgavekort:** `docs/funksjoner/fase2a-statusflyt.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (ett trykk flytter oppdraget fram; testene låser at hovedknappen alltid er neste status, og at siden virker på iPad), reklamasjoner (hver overgang og kansellering lagres med hvem, når og grunn, og ingenting slettes; testene viser at hendelse og revisjonslogg kommer nøyaktig én gang, i samme transaksjon) og KI først (overgangstabellen er låst som testsaker, så den senere automatikken fra `report.sent` og faktura kan bruke de samme funksjonene trygt).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet: grunn «Feiltrykk» og «Kunden trakk bestillingen». Ingen ekte navn eller adresser. Fast tid: `TEST_NOW` fra `tests/factories.ts`.

Ingen migrering og ingen ny tabell, så `tests/tenant-tables.ts` endres ikke. Statusendring gjøres på kontoret med nett, så det trengs ingen e2e uten nett. Ingen fagregler; «regeltestene» er overgangstabellen som testsaker (16 kombinasjoner pluss kansellering og «Rettet»).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 2–5. Avvik føres i kortet.

- `src/core/assignments/status-flow.ts`: `allowedTransitions(status) → { next: AssignmentStatus | null; previous: AssignmentStatus | null }`, `canCancel(status) → boolean`, `isCorrected({ status, highestSentReleaseVersion }) → boolean`. En hjelper som avgjør én overgang (for eksempel `transitionKind(from, to) → "forward" | "back" | null`) kan brukes; testen følger det som bygges, men tabellen under skal kunne testes direkte.
- `src/core/assignments/schemas.ts`: skjema for grunn (1–500 tegn, trimmes) og for input til de to funksjonene.
- `src/core/assignments/errors.ts`: `AssignmentStatusConflictError` («Statusen er endret av noen andre. Last siden på nytt.») og en feil for ulovlig overgang (navn etter utvikler, med norsk melding).
- Tjenester fra `@/core/assignments`: `changeAssignmentStatus(actor, organizationId, assignmentId, { expectedStatus, toStatus, reason? })` og `cancelAssignment(actor, organizationId, assignmentId, { expectedStatus, reason })`, begge returnerer minst `{ id, status }` (eller oppdraget), så `expectTenantIsolation` kan bruke `idOf`.
- Fabrikk: `createAssignment(organizationId, { status, deletedAt })` finnes alt; ingen nye fabrikker.

## 1. Overgangene, `src/core/assignments/status-flow.test.ts` (ny, ren enhetstest)

1. **alle 16 overganger** (`it.each` over tabellen, én rad per fra/til): forventet `fram`, `tilbake (grunn påkrevd)` eller `ulovlig`.
   | fra \ til | ordered | in_progress | completed | invoiced |
   |---|---|---|---|---|
   | ordered | ulovlig | fram | ulovlig | ulovlig |
   | in_progress | tilbake | ulovlig | fram | ulovlig |
   | completed | ulovlig | tilbake | ulovlig | fram |
   | invoiced | ulovlig | ulovlig | tilbake | ulovlig |
2. **tabellen dekker alt:** antall rader = `ASSIGNMENT_STATUSES.length ** 2` (ny status uten testsaker gjør testen rød).
3. **`allowedTransitions`** for hver status: `ordered → { next: in_progress, previous: null }`, `invoiced → { next: null, previous: completed }` osv.
4. **`canCancel`** (`it.each`): `ordered` og `in_progress` gir `true`; `completed` og `invoiced` gir `false`.
5. **`isCorrected`** (`it.each`): `completed` + 2 → `true`; `completed` + 5 → `true`; `completed` + 1 → `false`; `completed` + `null` → `false`; `ordered`, `in_progress`, `invoiced` + 2 → `false`.

## 2. Skjemaene, `src/core/assignments/schemas.test.ts` (utvides)

1. **grunn:** tom og bare mellomrom avvises med norsk melding; 1 tegn godtas; 500 godtas, 501 avvises; trimmes.
2. **`toStatus` og `expectedStatus`:** ukjent kode (`"cancelled"`, `"done"`) avvises; de fire kodene godtas.
3. **grunn ved fram** er valgfri og lagres ikke som krav (tom gir `undefined`/`null`).

## 3. Kjernen, `src/core/assignments/status.test.ts` (ny, mot databasen)

### 3.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres med `access.inspectors_edit_all` **på** og **av**, for både `changeAssignmentStatus` og `cancelAssignment`.

1. **på:** `inspector`, `office`, `manager`, `admin` lykkes.
2. **av:** `office`, `manager`, `admin` lykkes; `inspector` får `AccessDeniedError`, og status, `deleted_at`, antall `events` og `audit_log` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` lykkes.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller:** `AccessDeniedError`, ingen endring.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av, kan flytte fram, tilbake og kansellere.

### 3.2 Tenant-isolasjon (regel 2; to kall til `expectTenantIsolation`)

1. **`changeAssignmentStatus`:** `seed` lager ett oppdrag `ordered` i A og B; `query` flytter til `in_progress` og returnerer `[oppdraget]`, `idOf = id`. Etterpå: Bs oppdrag er endret nøyaktig én gang, og alle `events`/`audit_log`-rader for B har `organization_id = B`.
2. **`cancelAssignment`:** samme oppsett; `query` kansellerer med grunn og returnerer `[oppdraget]`. Etterpå: Bs oppdrag har `deleted_at` satt én gang, av B.

### 3.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id` som organisasjon:

1. **Bs `assignmentId`** i begge funksjonene → `AccessDeniedError`; Bs oppdrag er uendret (`status`, `deleted_at`, `updated_at`), ingen hendelse, ingen loggrad.
2. **tilfeldig uuid og `"ikke-en-id"`** → `AccessDeniedError`, aldri databasefeil.
3. **`organizationId` i input ignoreres** (ekstra felt i input endrer ikke hvilken organisasjon som brukes).

### 3.4 Overganger mot databasen

1. **fram ett steg** fra hver status (`it.each`: ordered → in_progress → completed → invoiced): `status` endret, `updated_at = now`, `updated_by` = den ansatte.
2. **tilbake med grunn** («Feiltrykk»): status ett steg tilbake; grunnen står i hendelsen.
3. **tilbake uten grunn** (mangler, tom, bare mellomrom) → feil, ingen endring, ingen hendelse.
4. **hopp** (`ordered → completed`, `ordered → invoiced`, `invoiced → ordered`) → feil for ulovlig overgang med norsk melding, ingen endring.
5. **til samme status** (`in_progress → in_progress`) → ulovlig, ingen hendelse.
6. **feil `expectedStatus`** (oppdraget er `in_progress`, kallet sier `ordered`) → `AssignmentStatusConflictError` med kortets tekst, ingen endring.
7. **samtidige kall:** to `changeAssignmentStatus` fra `ordered` til `in_progress` i `Promise.all` → nøyaktig ett lykkes, det andre får `AssignmentStatusConflictError`; én hendelse, én loggrad. (Viser at `FOR UPDATE` og konfliktsjekken virker.)

### 3.5 Kansellering og myk sletting

1. **fra `ordered` og fra `in_progress`** (`it.each`): `deleted_at` og `deleted_by` satt, `updated_at`/`updated_by` satt, `status` uendret; raden finnes fortsatt i tabellen.
2. **grunnen lagres bare i hendelsen:** `assignment.cancelled` har `data = { status, reason: "Kunden trakk bestillingen" }`; grunnen står ikke i `audit_log.changes`.
3. **fra `completed` og `invoiced`** → feil med norsk melding, `deleted_at = null`, ingen hendelse.
4. **uten grunn** (mangler, tom, 501 tegn) → feil, ingen endring.
5. **kansellert oppdrag er borte for `getAssignment`** → `AccessDeniedError`.
6. **kansellert oppdrag kan ikke endres igjen:** `changeAssignmentStatus` og en ny `cancelAssignment` på samme oppdrag → `AccessDeniedError` («ikke funnet»), ingen ny hendelse.
7. **ordren beholdes:** ordren som ble gjort om har fortsatt `status = converted` og `assignment_id` = oppdraget.
8. **teamrader og parter på oppdraget** slettes ikke (antall rader og `deleted_at = null` uendret).

### 3.6 Hendelser og revisjonslogg

1. **fram:** én `assignment.status_changed` med `assignmentId` og `data = { from, to }` (ingen `reason`-nøkkel eller `reason` tom); én revisjonslogg `entityType: "assignment"`, `action: "update"`, `changes = { status: { from, to } }`.
2. **tilbake:** `data = { from, to, reason: "Feiltrykk" }`; revisjonsloggen har ikke grunnen.
3. **kansellering:** én `assignment.cancelled` og én revisjonslogg `action: "delete"`.
4. **nøyaktig én av hver** per vellykket kall, og **ingen** ved avvist tilgang, valideringsfeil, ulovlig overgang, konflikt eller «ikke funnet».
5. **samme transaksjon** (egen fil `src/core/assignments/status-transaction.test.ts`, `vi.mock("@/core/events")`/`vi.mock("@/core/audit")` som kaster én gang): `changeAssignmentStatus` kaster, og statusen er uendret; `cancelAssignment` kaster, og `deleted_at = null`.

### 3.7 `getAssignment` og `getOrder`

1. **`corrected`:** `getAssignment` gir `corrected: false` for alle fire statuser; nøkkellisten i den faste felt-testen utvides med `corrected` (og ellers ingen nye nøkler).
2. **`getOrder(...).assignmentCancelled`:** `false` for ordre med aktivt oppdrag; `true` etter `cancelAssignment`; `false` for ordre uten oppdrag. Nøkkellisten i `orders.test.ts` utvides med feltet.
3. **tenant-isolasjon for `getOrder`** er dekket fra før; joinen endres, så testen skal fortsatt være grønn.

## 4. Handlingene, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (utvides, kjernen byttet ut)

1. **`getEmployeeContext` gir `null`** → begge nye handlingene svarer `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` endrer ikke kallet.
4. **feilkart:** `AccessDeniedError` → `NO_ACCESS`; `AssignmentStatusConflictError` → kortets tekst; ulovlig overgang → norsk melding; `ZodError` → melding ved grunnfeltet; ukjent feil → `UNKNOWN_ERROR`.
5. **kansellering lykkes** → `redirect` til `/arbeidskoe` med meldingen «Oppdrag <nr> er kansellert.».
6. **loggkontrakt:** `JSON.stringify` av alle loggkall inneholder ikke grunnen.

## 5. E2E, `e2e/fase-2a-oppdrag-team-parter.spec.ts` (utvides, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egen ordre og eget oppdrag med `uniqueSuffix()`.

1. **hele flyten:** nytt oppdrag viser merket «Bestilt» og hovedknappen «Sett til Under arbeid» → trykk → merket «Under arbeid», hovedknappen «Sett til Ferdig» → «Tilbake til Bestilt» → skriv «Feiltrykk» → «Lagre» → «Bestilt» → «Kanseller oppdraget» → skriv grunn → «Kanseller» → havner på `/arbeidskoe` med «Oppdrag <nr> er kansellert.».
2. **tom grunn:** «Tilbake til …» og «Lagre» uten grunn gir norsk melding i kortet; statusen er uendret etter omlasting.
3. **Ferdig og Fakturert:** flytt til «Ferdig» → «Kanseller oppdraget» vises ikke; flytt til «Fakturert» → ingen hovedknapp, bare «Tilbake til Ferdig».
4. **ordresiden etter kansellering:** «Gjort om til oppdrag <nr> (kansellert)» står, og det er ingen lenke.
5. **kansellert oppdrag direkte** (`/oppdrag/<id>`) gir «Fant ikke siden» eller «Ingen tilgang», aldri 500.
6. **konflikt:** åpne oppdraget i to faner, flytt fram i den ene, trykk i den andre → konfliktmeldingen vises, ingenting lagres dobbelt.
7. **iPad-størrelse** (prosjektet `ipad`, stående): kortet «Status» står øverst, ingen vannrett rulling, hovedknapp, «Tilbake til …», «Kanseller oppdraget» og «Kanseller» er minst 44 px høye.
8. **tastaturet alene:** «Tilbake til …», grunnfeltet og «Lagre» kan nås og sendes med Tab og Enter.

«Rettet»-merket kan ikke vises i e2e før utgivelsene finnes (`corrected` er alltid `false`); det dekkes av 1.5 og 3.7.1. En komponenttest er ikke påkrevd.

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- Begge `expectTenantIsolation`-kallene (3.2) og IDOR-testene (3.3).
- Rettighetsmatrisen med innstillingen på og av, og admin-testen 3.1.5.
- Myk sletting: raden finnes, ordren og teamet er urørt (3.5.1, 3.5.7, 3.5.8).
- Tabellstyrt test over alle 16 overganger (1.1, 1.2).
- Samme transaksjon (3.6.5) og samtidige kall (3.4.7).
- Ingen tilgangslogikk i siden eller handlingene utover visning ut fra `canEditOrders` og `NO_ACCESS`-mappingen.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjon 0.2.77.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Ett trykk fram; status, hendelse og logg i samme transaksjon | 3.4.1, 3.6.1, 3.6.5, 5.1 |
| Tilbake krever grunn; grunnen i hendelsen | 2.1, 3.4.2–3.4.3, 3.6.2, 5.2 |
| Hopp og utdatert status nektes med norsk melding | 1.1, 3.4.4–3.4.7, 4.4, 5.6 |
| Kansellering med grunn, `deleted_at`, usynlig, ingenting slettes | 3.5.1–3.5.2, 3.5.4–3.5.8, 5.1, 5.5 |
| Ferdig og Fakturert kan ikke kanselleres | 1.4, 3.5.3, 5.3 |
| Ordresiden viser «(kansellert)» uten lenke | 3.7.2, 5.4 |
| «Rettet» bare når `isCorrected` er sann | 1.5, 3.7.1 |
| Uten `assignment.edit` nektes; admin alltid lov | 3.1, 4.1 |
| Annen organisasjon får ikke tilgang | 3.2, 3.3 |
| iPad-størrelse | 5.7 |
| Kommandoene grønne, versjon 0.2.77 | gjennomgangen |
