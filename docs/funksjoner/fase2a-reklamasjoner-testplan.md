# Testplan: Reklamasjoner med enkelt skjema

- **Oppgavekort:** `docs/funksjoner/fase2a-reklamasjoner.md`
- **Dato:** 06.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** reklamasjoner (hovedsaken: hver sak lagres med dato, utfall og beløp på oppdraget, så tallet per 100 leverte rapporter kan regnes ut; testene låser at ingenting slettes permanent og at bare leder og admin ser sakene), tid (skjemaet har fem felt og ligger på oppdraget; e2e viser at registrering går på PC og iPad uten omveier) og KI først (sakene er grunnlaget KI senere skal lære av; testene viser at fritekst med mulige personopplysninger aldri havner i hendelser eller revisjonslogg, så hendelsene kan brukes trygt).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet: klager «Kjøper Test», beskrivelse «Fukt i kjeller ikke nevnt», bygningsdel «Kjeller, yttervegg». For loggtestene brukes unike merker som ikke kan forekomme tilfeldig: `MERKE-KLAGER-7Q2`, `MERKE-BESKRIVELSE-7Q2`, `MERKE-BYGNINGSDEL-7Q2`. Ingen ekte navn, adresser eller numre.

Fast tid: `TEST_NOW` fra `tests/factories.ts` (`2026-11-03T10:00:00Z`, 03.11 kl. 11.00 i Oslo). For datogrensen brukes to egne tidspunkter (vintertid, UTC+1): `LATE_EVENING = 2026-11-03T22:30:00Z` (03.11 kl. 23.30 i Oslo) og `AFTER_MIDNIGHT = 2026-11-03T23:30:00Z` (04.11 kl. 00.30 i Oslo).

Sidene trenger ikke virke uten nett (lederarbeid på PC, kortet «Skjermer»), så det trengs ingen e2e uten nett. Ingen fagregler og ingen TG-logikk; «regeltestene» er valideringsreglene som testsaker (`it.each`).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, Omfang 1–3. Avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- `src/core/claims/codes.ts` (eller i `schemas.ts`): `CLAIM_TYPES = ["complaint", "insurance_claim", "other"]` og `CLAIM_OUTCOMES = ["open", "rejected", "upheld", "settled", "withdrawn"]` (`as const`), med etikettfunksjoner (`claimTypeLabel`, `claimOutcomeLabel`).
- `src/core/claims/schemas.ts`: `claimInputSchema` (for registrering og endring). Hver regel har en fast feilkode i `path`/`params` eller en egen norsk melding, slik at testsakene kan peke på regelen: `claimant_required`, `received_at_not_future`, `amount_only_upheld_or_settled`, `text_limits`, `enum_values`. Datoen i dag sendes inn som argument eller leses fra en klokke som testene kan sette (ikke `new Date()` direkte i skjemaet).
- Tjenester fra `@/core/claims`: `listClaimsForAssignment`, `getClaim`, `createClaim`, `updateClaim`, `removeClaim` med signaturene i kortet. Alle returnerer minst `{ id }` (eller saken / listen), så `expectTenantIsolation` kan bruke `idOf`.
- Feil: rolle uten rettighet, annen organisasjon, fjernet oppdrag og fjernet eller fremmed sak gir alle `AccessDeniedError` (samme svar, sidene viser «finnes ikke» / 404). Ugyldig part gir en egen feil (for eksempel `ClaimantPartyNotFoundError`, norsk melding) eller en valideringsfeil; navn etter utvikler.
- Fabrikk i `tests/factories.ts`: `createClaim(organizationId, { assignmentId?, claimType?, receivedAt?, claimantPartyId?, claimantText?, description?, buildingPartText?, outcome?, amount?, closedAt?, deletedAt?, createdBy? })`. Lager oppdrag i samme organisasjon når det mangler. `claims` står i `RESET_TABLES` før `assignments`.

## 1. Rettighetene, `src/core/access/permissions.test.ts` og `guards.test.ts` (utvides, enhet og database)

1. **`claims.manage` finnes** i `permissions`, rett etter `claims.read`. Den faste listen i testen oppdateres (koden endres aldri, regel 6).
2. **rolletabellen** (`it.each`, innstillingen på og av):
   | rolle | `claims.read` | `claims.manage` |
   |---|---|---|
   | `inspector` | nei | nei |
   | `office` | nei | nei |
   | `manager` | ja | ja |
   | `admin` | ja | ja |
3. **innstillingen påvirker aldri** `claims.read` eller `claims.manage` (testen «4. innstillingen påvirker aldri …» utvides med `claims.manage`).
4. **ikke enkeltrettighet:** `claims.manage` står ikke i `grantablePermissions`; `effectivePermissions(["inspector"], ["claims.manage", "claims.read"], …)` gir ingen av dem. Mot databasen: `grantPermission(takstmann, "claims.manage")` gir fortsatt `AccessDeniedError` i `requireOrganizationAccess(…, "claims.manage")`.
5. **sertifisering:** `withPublishRequiringCertification(…, false)` for leder tar bare bort `report.publish`; `claims.read` og `claims.manage` står.
6. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av og uten sertifisering, har `claims.read` og `claims.manage`.
7. **flere roller:** `inspector` + `manager` gir begge rettighetene; `inspector` + `office` gir ingen.

## 2. Valideringsreglene, `src/core/claims/schemas.test.ts` (ny, ren enhetstest, regler som data)

Hver regel er en tabell med testsaker (`it.each`): input, forventet godtatt/avvist og forventet regelkode. En egen test sjekker at alle fem regelkodene finnes i minst én avvist testsak.

1. **`claimant_required`:**
   - bare part (gyldig uuid) → godtatt; bare fritekst «Kjøper Test» → godtatt; begge → godtatt.
   - ingen av dem, fritekst tom streng, fritekst bare mellomrom → avvist.
2. **`received_at_not_future`** (dagens dato i Europe/Oslo sendes inn):
   - `TEST_NOW`: `2026-11-03` godtatt, `2026-11-02` godtatt, `2026-11-04` avvist.
   - `LATE_EVENING` (03.11 i Oslo): `2026-11-04` avvist.
   - `AFTER_MIDNIGHT` (04.11 i Oslo, men fortsatt 03.11 i UTC): `2026-11-04` godtatt, `2026-11-05` avvist.
   - ugyldig dato (`"2026-02-30"`, `"i går"`, tom) → avvist med norsk melding.
3. **`amount_only_upheld_or_settled`:**
   - `upheld` + 50 000 og `settled` + 0 → godtatt; `upheld`/`settled` uten beløp → godtatt.
   - `open`, `rejected`, `withdrawn` + 10 000 → avvist.
   - negativt (-1) og desimal (100,5) → avvist, uansett utfall.
   - **gjenåpning:** `open` + beløp (endring fra `settled` + 20 000) → avvist med samme regelkode.
4. **`text_limits`:**
   - beskrivelse: tom og bare mellomrom avvist; 1 tegn og 2 000 tegn godtatt; 2 001 avvist; trimmes.
   - klager-fritekst og bygningsdel: 200 tegn godtatt, 201 avvist; tom streng blir `null`; trimmes.
5. **`enum_values`:** hver av de tre typene og fem utfallene godtas; `"internal"`, `"closed"`, `""` og manglende type avvises. Utfall som mangler gir `open`.
6. **`closed_at` og `created_by` fra klienten** strippes av skjemaet (finnes ikke i resultatet).
7. **`organizationId` i input** strippes eller avvises (aldri brukt).
8. **faste koder:** `CLAIM_TYPES` og `CLAIM_OUTCOMES` er låst i fast rekkefølge; etikettene er norske («Reklamasjon», «Forsikringskrav», «Annet»; «Åpen», «Avvist», «Medhold», «Forlik», «Trukket»). Ukjent kode gir koden tilbake, aldri `undefined`.

## 3. Databasen, `src/db/claims-schema.test.ts` (ny, direkte innsetting)

1. **sak med oppdrag fra annen organisasjon** avvises av sammensatt fremmednøkkel (`organization_id`, `assignment_id`).
2. **part fra annen organisasjon** avvises av sammensatt fremmednøkkel (hvis den finnes; ellers dekkes 4.5 i tjenesten).
3. **ukjent `claim_type` eller `outcome`** avvises (CHECK eller enum).
4. **standardverdier:** sak satt inn uten utfall har `outcome = 'open'`, `closed_at = null`, `deleted_at = null`.
5. **negativt beløp** avvises (CHECK `amount >= 0`).
6. **tenant-tabellen:** `claims` står i `tests/tenant-tables.ts` med radbyggeren `createClaim` og testfilen `src/core/claims/claims.test.ts`; `tests/tenant-isolation-all-tables.test.ts` er grønn (én tabell mer enn før).
7. **migreringen er ren:** `0023_reklamasjoner` finnes, og `pnpm db:generate` lager ingen ny fil (sjekkes i gjennomgangen).

## 4. Kjernen, `src/core/claims/claims.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres med `access.inspectors_edit_all` **på** og **av**, for alle fem tjenestene.

1. **`manager` og `admin`** lykkes med alle fem.
2. **`inspector` og `office`** får `AccessDeniedError` på alle fem, også på `getClaim` med en ekte sak-id i egen organisasjon. Antall rader i `claims`, `events` og `audit_log` er uendret, og saken er urørt.
3. **enkeltrettighet hjelper ikke:** takstmann med `grantPermission(…, "claims.manage")` og `grantPermission(…, "claims.read")` får fortsatt `AccessDeniedError` på alle fem.
4. **takstmann med `assignment.edit`** (enkeltrettighet, innstillingen av) får `AccessDeniedError` (viser at reklamasjon ikke følger oppdragsretten).
5. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller:** `AccessDeniedError` på `listClaimsForAssignment` og `createClaim`.
6. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av, kan registrere, lese, endre, lukke, gjenåpne og fjerne.

### 4.2 Tenant-isolasjon (regel 2; fem kall til `expectTenantIsolation`)

1. **`listClaimsForAssignment`:** `seed` lager ett oppdrag med én sak i A og B; `query` lister for oppdraget i egen organisasjon; `idOf = id`.
2. **`getClaim`:** `seed` lager én sak i A og B; `query` returnerer `[saken]`.
3. **`createClaim`:** `seed` lager ett oppdrag i A og B; `query` registrerer en sak og returnerer `[saken]`, `idOf` som i ordre (`createOrder`-mønsteret). Etterpå: B har nøyaktig én sak, og alle `events`/`audit_log`-rader for B har `organization_id = B`.
4. **`updateClaim`:** `seed` lager én sak i A og B; `query` lukker med utfall `rejected`. Etterpå: Bs sak er endret nøyaktig én gang, av B.
5. **`removeClaim`:** `seed` lager én sak i A og B; `query` fjerner og returnerer `[{ id }]`. Etterpå: Bs sak har `deleted_at` satt én gang, av B.

### 4.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id` som organisasjon:

1. **Bs `assignmentId`** i `listClaimsForAssignment` og `createClaim` → `AccessDeniedError`; ingen ny rad, ingen hendelse.
2. **Bs `claimId`** i `getClaim`, `updateClaim`, `removeClaim` → `AccessDeniedError`; Bs sak er uendret (alle felt, `deleted_at = null`, `updated_at`).
3. **`organizationId`, `createdBy`, `closedAt` i input ignoreres:** `createClaim` med `organizationId: orgB.id`, `createdBy: <annen ansatt>` og `closedAt` lagrer i A, med `created_by` = den innloggede, og `closed_at = null` når utfallet er `open`.
4. **tilfeldig uuid og `"ikke-en-id"`** som oppdrags-id, sak-id og part-id: `AccessDeniedError` eller part-feilen, aldri databasefeil.

### 4.4 Fjernet oppdrag og myk sletting

1. **fjernet oppdrag** (`deletedAt` satt): `createClaim` og `listClaimsForAssignment` gir `AccessDeniedError`, samme feil som 4.3.1 (samme `name` og melding). Ingen ny rad.
2. **`removeClaim`** setter `deleted_at` (og `deleted_by` hvis kolonnen finnes); raden står i databasen med alle felt urørt.
3. **fjernet sak vises ikke** i `listClaimsForAssignment`; `getClaim`, `updateClaim` og `removeClaim` på den gir `AccessDeniedError`.
4. **ingen permanent sletting:** etter registrering, endring, lukking og fjerning er antall rader i `claims` det samme som antall registreringer.

### 4.5 Klageren (part eller fritekst)

`it.each` over `createClaim` og `updateClaim`:

1. **part på samme oppdrag** godtas; `claimant_party_id` lagres.
2. **part på et annet oppdrag i samme organisasjon** avvises; ingen endring.
3. **part i annen organisasjon** avvises; ingen endring.
4. **fjernet part** (`deletedAt` satt) avvises; ingen endring.
5. **bare fritekst** godtas; `claimant_party_id = null`.
6. **endring som tar bort både part og fritekst** avvises (`claimant_required`).

### 4.6 Lukking, gjenåpning og `closed_at`

1. **ny sak** har `outcome = open`, `closed_at = null`.
2. **lukke** (`open` → `upheld` + 50 000): `closed_at = now` (fast klokke), beløpet lagres.
3. **endre utfall mellom lukkede** (`upheld` → `settled`): `closed_at` beholder første tidspunkt (eller settes på nytt; testen følger kortet: «settes når utfallet går fra `open`», så den skal stå urørt).
4. **gjenåpne uten beløp** (`rejected` → `open`): `closed_at = null`.
5. **gjenåpne med beløp** (`settled` + 20 000 → `open`, beløpet står): avvist med `amount_only_upheld_or_settled`; saken er urørt i databasen (utfall, beløp, `closed_at`).
6. **`closedAt` fra klienten** ignoreres både ved registrering og endring.
7. **registrere direkte lukket** (`createClaim` med `rejected`): `closed_at = now`.

### 4.7 Revisjonslogg og hendelse (personvern)

Bruk merkene `MERKE-KLAGER-7Q2`, `MERKE-BESKRIVELSE-7Q2`, `MERKE-BYGNINGSDEL-7Q2`.

1. **registrere, endre alle tre fritekstene, lukke og fjerne:** `JSON.stringify(auditRows(org))` og alle `events`-rader for organisasjonen inneholder ingen av merkene.
2. **loggen har feltnavn:** endringsraden for `updateClaim` nevner `description`, `claimantText` og `buildingPartText` (eller snake_case) som endrede felt, uten verdier.
3. **`claim.registered`:** nøyaktig én hendelse per registrering, og `Object.keys(payload)` er nøyaktig `["claimId", "assignmentId", "claimType", "receivedAt"]` (sortert sammenligning). Ingen hendelse ved avvist registrering.
4. **revisjonsrad per handling:** registrere, endre og fjerne gir hver nøyaktig én rad i `audit_log` i samme transaksjon (avvist handling gir ingen).
5. **logger:** spion på `logger` under en mislykket registrering (ugyldig part) viser at ingen logglinje inneholder merkene.

### 4.8 Lesing

1. **faste felt:** `Object.keys` på saken fra `getClaim` og på hvert element i listen er faste lister; ingen `organizationId`, `deletedAt`, `deletedBy`.
2. **sortering:** listen er sortert på `received_at` nyest først (eller det utvikler velger; testen låser valget).
3. **partnavn:** når klageren er en part, er partens navn med i listen (ingen N+1: sjekkes i kodegjennomgangen).
4. **tomt oppdrag:** `[]`.

## 5. Sidene, e2e `e2e/fase-2a-reklamasjoner.spec.ts` (ny, prosjektene `pc` og `ipad`)

Hver test lager egne data med `uniqueSuffix()`. Lederen er `logInAsManager` (rollen `manager`), så testen viser at rettigheten gjelder leder og ikke bare admin.

1. **leder registrerer:** åpner oppdraget, ser delen «Reklamasjoner», trykker «Registrer reklamasjon». Datoen står til i dag. Velger part fra oppdraget, skriver beskrivelse, «Lagre». Saken står i listen med dato, type, kort beskrivelse og merket «Åpen».
2. **hjelpeteksten** «Skriv kort hva som påstås. Ikke skriv fødselsnummer eller helseopplysninger.» vises under beskrivelsen.
3. **feilmeldinger:** «Lagre» uten klager og uten beskrivelse gir norske meldinger ved feltene; ingen sak lagres.
4. **fritekst i stedet for part:** skriver «Kjøper Test» som klager; saken lagres.
5. **lukke med utfall og beløp:** åpner saken, velger «Forlik», skriver 20 000, «Lagre». Merket blir «Lukket (Forlik)».
6. **beløpsfeltet skjules** når «Åpen» eller «Avvist» er valgt, og tømmes når «Åpen» velges etter «Forlik» (gjenåpning lagres uten feil, merket blir «Åpen»).
7. **fjerne:** «Fjern», bekreft; saken er borte fra listen. Avbryt i bekreftelsen fjerner ingenting.
8. **takstmann** (`logInAsInspector`, med `setInspectorsEditAll(true)` og `(false)`, gjenopprett etterpå med `restoreInspectorsEditAll`): ser ikke delen «Reklamasjoner» eller knappen; direkte adresse til `/oppdrag/[id]/reklamasjoner/ny` og `/oppdrag/[id]/reklamasjoner/[claimId]` gir «finnes ikke» (404), samme side som for en tilfeldig uuid.
9. **kontor** (`logInAsOffice`): samme som 8.
10. **iPad** (bare `ipad`, liggende og stående `834×1194`): skjemaet får plass uten vannrett rulling, «Lagre» er synlig uten å rulle forbi tastaturet, trykkflater er minst 44 px, og hele flyten i 1 og 5 virker med trykk.
11. **tastatur** (bare `pc`): skjemaet kan fylles og lagres med Tab og Enter; fokus går til første feil ved feilmelding.

## 6. Utenfor tester, sjekkes i gjennomgangen

- `package.json` har ny patch-versjon.
- `docs/personvern/intern-personvernerklaering.md` har tabellen `claims` med fritekstfeltene beskrevet.
- `docs/05-domenemodell.md` 4.13 og ordlisten (avsnitt 8) har `claim`, `claimant`, `claim_type`, `outcome`, `claims.manage`.
- A125–A129 står i `docs/09-apne-sporsmal.md`.
- Ingen tilgangslogikk i sider eller komponenter: sidene spør `src/core/access` (eller tjenesten) og viser 404 ved `AccessDeniedError`. `grep` etter `roles.includes("manager")` og lignende i `src/app`.
- Modulgrensene holder: `src/core/claims` importerer bare fra `src/core`, `src/shared`, `src/db` og egen mappe.

## Ikke testet nå (bevisst)

- Telling «reklamasjoner per 100 leverte rapporter» (ingen visning, rapporter finnes ikke ennå).
- Kobling til rapport, utgivelse, kontrollpunkt og avvik.
- Uten nett (sidene skal ikke virke uten nett).

## Krav før godkjenning

1. Rettighetsmatrisen i 1 og 4.1 med innstillingen på og av, og testen som viser at `claims.manage` ikke kan gis som enkeltrettighet.
2. `expectTenantIsolation` for alle fem tjenestene (4.2) og `claims` i `tests/tenant-tables.ts`.
3. Admin-testene (1.6 og 4.1.6) finnes og er grønn.
4. Myk sletting (4.4) og fjernet oppdrag gir samme svar som fremmed oppdrag.
5. Loggtestene i 4.7 med merkene.
6. Valideringsreglene som testsaker i 2, med datogrensen i Europe/Oslo og gjenåpning med beløp.
7. E2e 8 og 9 (takstmann og kontor ser ingenting) grønn i både `pc` og `ipad`.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.
