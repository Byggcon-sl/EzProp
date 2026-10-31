# Testplan: Sertifisering med utløpsdato

- **Oppgavekort:** `docs/funksjoner/fase0b-sertifisering.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (ingen kan få `report.publish` uten gyldig sertifisering, og admin ser i tide hvem som må fornye) og tid (fornyelse er én ny rad, ingen regneark). KI først: ingen KI i oppgaven; testene viser at regelen er en ren datoregel som senere kan brukes når KI fyller ut fra beviset.

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: navn som «Kari Testdatter», e-post på `eksempel.no`, sertifikatnummer `TEST-CERT-0001`, utsteder «Testsertifisering AS». Ingen ekte navn eller numre.

## Avtale om signaturer (utvikler og testskriver)

- Funksjonene eksporteres fra `@/core/organization` og tar `(actor, organizationId, …)` først: `listCertificationsForEmployee(actor, organizationId, employeeId)`, `createCertification(actor, organizationId, input)`, `deleteCertification(actor, organizationId, certificationId)`, `listExpiringCertifications(actor, organizationId, options?)`. Endelige navn kan avvike; testskriver følger det utvikler eksporterer, og test-leder sjekker at alle fire er dekket.
- **Datoregelen er en ren funksjon** i `src/core/access` (for eksempel `isCertificationValid(cert, today)`) og en hjelper for «i dag i norsk tid» (`todayInOslo(now: Date): string`, `YYYY-MM-DD`). Begge tar dato inn, så testene ikke trenger falsk klokke. Der klokken brukes (i `findGrant` og listen), brukes `vi.useFakeTimers({ toFake: ["Date"] })` med `vi.setSystemTime`.
- **Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`** (samme mønster som resten av admin).
- Valideringsfeil er `ZodError`, med meldingene «Velg dato for gyldig til.» og «Gyldig fra kan ikke være etter gyldig til.».
- **Ny fabrikk** `createCertification(employee, overrides?)` i `tests/factories.ts`: standard `area: "condition_report"`, `validTo` ett år frem. `resetDatabase` tømmer også `certifications` (tabellen legges i `truncate`-listen).
- Konstanten for 60 dager eksporteres ett sted og brukes av testene, men grensesakene skrives med faste datoer (ikke regnet fra konstanten), slik at en endring av konstanten vises som rød test.

## 1. Datoregelen (regeltester som data), `src/core/access/certification.test.ts` (ny)

Fast «i dag» = `2026-10-31`. Én tabell (`it.each`) med `{ navn, validFrom, validTo, deletedAt, forventet }`:

1. **utløper i dag** (`validTo 2026-10-31`): gyldig.
2. **utløp i går** (`validTo 2026-10-30`): ugyldig.
3. **starter i morgen** (`validFrom 2026-11-01`, `validTo 2028-01-01`): ugyldig.
4. **starter i dag** (`validFrom 2026-10-31`): gyldig.
5. **uten gyldig fra** (`validFrom null`, `validTo 2027-10-31`): gyldig.
6. **slettet** (`deletedAt` satt, ellers gyldig): ugyldig.

Norsk tid (`todayInOslo`), egen tabell:

7. `2026-10-30T22:30:00Z` (00:30 i Oslo, vintertid +1): gir `2026-10-31`.
8. `2026-10-31T22:59:59Z`: gir `2026-10-31`; `2026-10-31T23:00:00Z`: gir `2026-11-01`.
9. Sommertid: `2026-06-30T22:30:00Z` gir `2026-07-01` (+2).
10. **Utløp ved midnatt i Oslo:** sertifisering med `validTo 2026-10-31` er gyldig kl. `2026-10-31T22:59:59Z` og ugyldig kl. `2026-10-31T23:00:00Z` (viser at UTC-dato ikke brukes).

## 2. Sjekken i tilgangsmodulen, `src/core/access/guards.test.ts` (utvides) og `certification-access.test.ts` (ny)

Systemtid låst til `2026-10-31T10:00:00Z` i blokken.

### 2.1 report.publish krever gyldig sertifisering

1. **`it.each` over `inspector`, `manager`, `admin`** × tilstand `uten sertifisering` / `utgått i går` / `starter i morgen` / `slettet`: `requireOrganizationAccess(…, "report.publish")` gir `AccessDeniedError`, og `grant.permissions` fra `organization.read` inneholder ikke `report.publish`.
2. **Samme roller med gyldig sertifisering** (utløper i dag og ett år frem): `report.publish` lykkes.
3. **Enkeltrettighet:** `office` med enkeltrettighet `report.publish` (`grantPermission`) uten sertifisering: nektet. Med gyldig sertifisering: lykkes.
4. **Innstillingen `access.inspectors_edit_all` av og på** (`it.each`): resultatet for `report.publish` er det samme; `report.edit` og `assignment.edit` følger innstillingen som før (sertifiseringen rører dem ikke).
5. **Bare `report.publish` tas bort:** for hver rolle uten sertifisering er `grant.permissions` lik `effectivePermissions(...)` minus `report.publish`, verken mer eller mindre (sammenlign sortert liste).
6. **Fornyet:** gammel utgått rad + ny gyldig rad gir `report.publish`. Gammel gyldig + ny slettet gir fortsatt `report.publish`.
7. **Sertifisering i feil organisasjon teller ikke:** samme bruker er ansatt i A og B (to ansatt-rader); gyldig sertifisering bare i B. Grant i A har ikke `report.publish`, grant i B har den. Viser at spørringen filtrerer på organisasjonen fra ansatt-raden.
8. **Sertifisering på en annen ansatt i samme organisasjon teller ikke** (kollegaens gyldige rad gir ikke meg rettigheten).
9. **Utløp ved midnatt i Oslo i findGrant:** systemtid `2026-10-31T22:59:59Z` med `validTo 2026-10-31` gir `report.publish`; `2026-10-31T23:00:00Z` gir det ikke.

### 2.2 Admin stenges aldri ute (regel 11). Testene skal aldri fjernes; kommentar øverst i blokken sier det.

1. **Admin uten sertifisering** har `organization.manage`, `staff.manage` og alle andre admin-rettigheter unntatt `report.publish` (sammenlign med fast liste).
2. **Admin med utgått sertifisering:** det samme.
3. **Admin uten sertifisering kan kjøre adminfunksjonene:** `listEmployeesForAdmin`, `createCertification` på seg selv og `listExpiringCertifications` lykkes.
4. **Admin uten sertifisering kan gi seg selv sertifisering**, og neste `requireOrganizationAccess(…, "report.publish")` lykkes (ingen høna-og-egget-situasjon).
5. **Leder uten sertifisering** beholder sine leder-rettigheter (reklamasjonssaker o.l.) unntatt `report.publish`.

### 2.3 Eksisterende tester

1. Testene i `guards.test.ts` og `permissions.test.ts` som forventer `report.publish` for en rolle, får en gyldig sertifisering via `createCertification` (kortet, Omfang 8). `permissions.test.ts` (ren funksjon, uten database) skal stå uendret: `effectivePermissions` rører ikke sertifisering.
2. Ingen eksisterende test slettes eller får svakere forventning; test-leder sammenligner diff-en.

## 3. Spørringene, `src/core/organization/certifications.test.ts` (ny)

### 3.1 Tilgang per rolle

1. **`it.each` over de fire funksjonene × `inspector`/`office`/`manager`:** `AccessDeniedError`; antall rader i `certifications` og `audit_log` er uendret.
2. **Ansatt uten roller, admin som har sluttet og slettet admin:** `AccessDeniedError` på alle fire.
3. **Enkeltrettighet hjelper ikke:** takstmann med `report.publish` eller `template.edit_structure` får fortsatt `AccessDeniedError`.
4. **Takstmann kan ikke registrere sertifisering på seg selv** (`createCertification` med egen `employeeId`): `AccessDeniedError`.
5. **Admin lykkes** på alle fire (positiv kontroll).

### 3.2 Tenant-isolasjon (ett `expectTenantIsolation` per funksjon, fire totalt)

1. **`listCertificationsForEmployee`:** `seed` lager en ansatt med én sertifisering i A og B og husker ansatt-id per organisasjon; `query` lister for den ansatte som hører til `organizationId`; `idOf: row.id`.
2. **`createCertification`:** `seed` lager en ansatt i A og B; `query` oppretter for den ansatte i `organizationId` og returnerer `[row]`; `idOf: row.organizationId`. Etterpå: B har nøyaktig én sertifisering, og den har `organization_id` = B.
3. **`deleteCertification`:** `seed` lager en sertifisering i A og B; `query` sletter raden i `organizationId` og returnerer `[row]`. Etterpå: B-raden har `deleted_at`, og A-raden er urørt etter B sitt kall.
4. **`listExpiringCertifications`:** `seed` lager en utgått sertifisering i A og B; vanlig lesing, `idOf: row.certificationId` (eller ansatt-id, det utvikler returnerer).

### 3.3 Fremmed id i egen organisasjon (regel 2)

1. **`it.each` over** `listCertificationsForEmployee`, `createCertification` (ansatt-id), `deleteCertification` (sertifiserings-id): admin A kaller med `orgA` og id fra B → `AccessDeniedError`. B-radene er uendret, ingen rad og ingen loggrad i A eller B.
2. **Samme med `"ikke-en-id"` og en tilfeldig uuid:** `AccessDeniedError`, ingen databasefeil.
3. **Slettet ansatt** i egen organisasjon: `createCertification` og `listCertificationsForEmployee` gir `AccessDeniedError`.
4. **Ansatt som har sluttet** i egen organisasjon: `createCertification` lykkes eller avvises (utvikler velger, kortet sier ikke noe); testen låser valget og listen «går ut snart» viser henne uansett ikke (4.6).
5. **Allerede slettet sertifisering:** `deleteCertification` gir `AccessDeniedError` og endrer ikke `deleted_at`.
6. **`organizationId` i skjemadata ignoreres:** et ekstra felt `organizationId: orgB` i input til `createCertification` gir rad i A (eller `ZodError` ved streng parsing), aldri rad i B.

### 3.4 Lagring, validering og myk sletting

1. **`createCertification` lagrer alle feltene:** område, utsteder, nummer, gyldig fra, gyldig til; `organizationId` er `grant.organizationId`, `createdBy` er actor.
2. **Bare påkrevd felt:** bare `validTo` (område forhåndsvalgt) lykkes; de valgfrie er `null`.
3. **Zod, regeltester som data (`it.each`):** manglende `validTo` → «Velg dato for gyldig til.»; `validFrom 2027-01-02` og `validTo 2027-01-01` → «Gyldig fra kan ikke være etter gyldig til.»; `validFrom = validTo` godtas; ugyldig dato `"2026-13-01"` og `"ikke-dato"` avvises; ukjent område `"electric"` avvises; tom streng i valgfrie felt lagres som `null`. Ingen rad og ingen loggrad når valideringen stopper.
4. **Område er fast kode:** listen over områder har nøyaktig `condition_report` med etiketten «Tilstandsrapport bolig» (enhetstest på listen, slik at endring av koden blir rød, regel 6).
5. **Myk sletting:** `deleteCertification` setter `deleted_at` og `deleted_by` (eller tilsvarende); raden finnes fortsatt i tabellen. Antall rader i `certifications` går aldri ned.
6. **Liste for én ansatt:** viser ikke slettede rader, sortert med nyeste `validTo` først (eller det utvikler velger; testen låser rekkefølgen), og har riktig merke: «Utgått», «Går ut snart» eller ingen.
7. **Fornyelse er ny rad:** to rader for samme ansatt og område er lov; den gamle står som historikk.

### 3.5 Database (integrasjon, direkte `db.insert`)

1. **Sammensatt fremmednøkkel:** sertifisering med `organization_id` = A og `employee_id` fra B avvises av databasen (forvent feil med kode `23503`).
2. **Sjekkregel:** `valid_from > valid_to` avvises (kode `23514`); `valid_from = valid_to` og `valid_from null` godtas.
3. **`valid_to` er påkrevd:** `null` avvises (kode `23502`).

### 3.6 Revisjonslogg

1. **`createCertification`** gir én rad `certification.created` med `organizationId` = A, riktig entitets-id og actor.
2. **`deleteCertification`** gir én rad `certification.deleted`.
3. **Avviste kall** (tilgang, fremmed id, validering) gir ingen loggrad.
4. **Ingen persontekst i logglinjer** utover det de andre adminhandlingene logger (samme mønster som 3.9 i admin-testplanen).

## 4. Listen «går ut snart» (regeltester som data), samme fil

Systemtid låst til `2026-10-31T10:00:00Z`. Én tabell over ansatte med faste datoer:

1. **utgått i går** (`validTo 2026-10-30`): i listen, merket «Utgått».
2. **utløper i dag:** i listen, merket «Går ut snart».
3. **60 dager frem** (`validTo 2026-12-30`): i listen.
4. **61 dager frem** (`validTo 2026-12-31`): ikke i listen.
5. **fornyet** (utgått rad + ny rad til 2028): ikke i listen.
6. **fornyet, men den nye er slettet:** i listen (slettet rad teller ikke).
7. **bare slettet rad:** ikke i listen (ingen sertifisering å vise).
8. **ansatt som har sluttet** (`deactivated_at`) med utgått sertifisering: ikke i listen.
9. **slettet ansatt** med utgått sertifisering: ikke i listen.
10. **sortering:** tidligst `validTo` først; to ansatte med samme dato har stabil rekkefølge (navn).
11. **én rad per ansatt og område:** ansatt med to gamle utgåtte og ingen ny gir én linje (den nyeste).
12. **tom liste:** returnerer `[]` (meldingen testes i e2e).
13. **Svarets nøkler:** `Object.keys(row).sort()` er en fast liste; ingen `userId`, `email` eller `organizationId`.

## 5. Tilgang til sidene, `src/app/(ansatt)/admin/actions.test.ts` (utvides)

1. **Server-handlingene** for «Legg til sertifisering» og «Fjern» kaller kjernen med organisasjonen fra `findAdminOrganizationId`, aldri en id fra skjemaet. En `organizationId` eller `employeeId` fra B i skjemadata gir feilsvar, ingen rad.
2. **Takstmann, kontor og leder** får feilsvar fra handlingene og «Ingen tilgang» fra `/admin/sertifiseringer` (testes i kjernen i 3.1; e2e 6.4 sjekker siden).

## 6. E2E, `e2e/fase-0b-sertifisering.spec.ts` (ny), prosjektene `pc` og `ipad`

Brukeren `ADMIN_EMAIL` fra seed har ingen sertifisering ved start. Testene bruker en ny oppdiktet ansatt per test (unik e-post), så de ikke påvirker hverandre. Ingen offline-test: adminområdet er bare på nett.

1. **Admin legger til en sertifisering og ser den:** Admin → Ansatte → ny ansatt → seksjonen «Sertifiseringer» → «Legg til sertifisering»: område er forhåndsvalgt «Tilstandsrapport bolig», fyller «Gyldig til» (20 dager frem) og nummer → «Lagre». Raden vises med «Går ut snart». Deretter fanen «Sertifiseringer» i adminmenyen: den ansatte står i listen, og navnet lenker til den ansatte.
2. **Fornyelse fjerner fra listen:** legg til en ny sertifisering ett år frem på samme ansatt; den ansatte står ikke lenger i `/admin/sertifiseringer`, og begge radene vises på den ansatte.
3. **Fjern med bekreftelse:** «Fjern» → bekreft → raden er borte fra skjermen. «Avbryt» i bekreftelsen lar raden stå.
4. **Feilmeldinger:** «Lagre» uten «Gyldig til» viser «Velg dato for gyldig til.»; «Gyldig fra» etter «Gyldig til» viser «Gyldig fra kan ikke være etter gyldig til.». Feltet har `aria-invalid` og meldingen er koblet med `aria-describedby`.
5. **Admin uten sertifisering kommer inn i adminområdet** (regel 11): `ADMIN_EMAIL` åpner `/admin`, `/admin/ansatte` og `/admin/sertifiseringer` uten «Ingen tilgang».
6. **Takstmann får ikke åpnet `/admin/sertifiseringer`:** takstmann laget i test 1-mønsteret logger inn og går direkte til adressen → «Ingen tilgang» (eller 404), og «Admin» finnes ikke i hovedmenyen.
7. **Tom liste:** når ingen går ut innen 60 dager vises «Ingen sertifiseringer går ut de neste 60 dagene.» (kjøres bare hvis databasen er tom for slike; ellers sjekkes meldingen i en komponenttest i stedet. Utvikler velger; test-leder sjekker at meldingen er dekket ett sted).
8. **iPad:** i `ipad` er skjemaet uten vannrett rulling, «Lagre», «Legg til sertifisering» og «Fjern» er minst 44 × 44 punkter (`expectAtLeast44` fra admin-spec, flyttes til `e2e/helpers.ts` hvis den brukes i to filer), og datofeltet kan fylles med tastatur. Også iPad stående (samme `describe`-mønster som `fase-0b-admin.spec.ts`).

## 7. Det test-leder sjekker i gjennomgangen (ikke automatiske tester)

1. Sjekken ligger bare i `src/core/access` (i `findGrant`), ikke i sider eller komponenter.
2. Spørringen i `findGrant` filtrerer på `employee.organizationId` og `employee.id` fra ansatt-raden, med `deleted_at is null`.
3. Ingen ny avhengighet for tidssone (bruk `Intl.DateTimeFormat` med `timeZone: "Europe/Oslo"`).
4. Migreringen har sammensatt fremmednøkkel, sjekkregel og indeks på `(organization_id, employee_id)`.
5. `resetDatabase` tar med `certifications`.
6. Ordlisten (avsnitt 8), domenemodellen 4.1, A29–A32 i `docs/09-apne-sporsmal.md` og versjon 0.2.44 er oppdatert.
7. «EzProp» står ikke i nye filer i `src/`; testdata er oppdiktet.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Legge til og fjerne, myk sletting | 3.4.1, 3.4.5, e2e 6.1, 6.3 |
| Revisjonslogg | 3.6 |
| `report.publish` per rolle og enkeltrettighet | 2.1.1–2.1.9 |
| Admin stenges ikke ute | 2.2, e2e 6.5 |
| Grensesaker i norsk tid | 1.1–1.10, 2.1.9, 4.1–4.4 |
| Listen: utgått, 60 dager, fornyet, sluttet, slettet | 4.1–4.11, e2e 6.1–6.2 |
| Takstmann, kontor, leder nektet | 3.1, 5.2, e2e 6.6 |
| Databasen avviser feil organisasjon og datoer | 3.5 |
| Tenant-isolasjon per spørring | 3.2 (fire), 2.1.7, 3.3 |
| iPad-størrelse | e2e 6.1–6.8 i `ipad` |
| lint, typecheck, test, test:e2e grønne | testrapporten |
