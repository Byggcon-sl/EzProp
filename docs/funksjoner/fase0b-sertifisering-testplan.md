# Testplan: Sertifisering med utløpsdato

- **Oppgavekort:** `docs/funksjoner/fase0b-sertifisering.md`
- **Dato:** 31.10.2026
- **Støtter hovedmål:** reklamasjoner (ingen kan publisere uten gyldig sertifisering, og admin ser i god tid hvem som må fornye) og tid (fornyelse er én ny rad, ingen regneark). KI først: ingen KI i oppgaven; testene viser at regelen er ren og lik på begge sider, slik at KI senere kan fylle ut skjemaet og admin bare godkjenner.

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: navn som «Kari Testdatter», e-post på `eksempel.no`, sertifikatnummer `TEST-CERT-0001`, utsteder «Testsertifisering AS». Ingen ekte navn eller numre.

Fast dato i regeltestene: `NOW = new Date("2026-10-31T10:00:00Z")` (i dag = `2026-10-31` i Oslo). Grensen ved midnatt: `new Date("2026-10-30T23:30:00Z")` (= 31.10 i Oslo).

Ingen del av oppgaven virker uten nett (bare adminområdet), så det trengs ingen e2e uten nett.

## Avtale om signaturer (utvikler og testskriver)

- `todayInOslo(now?: Date): string` i `src/shared/lib/dates.ts`. `todayInNorway` finnes ikke lenger i `src/app`.
- `isCertificationValid(cert: { validFrom: string | null; validTo: string; deletedAt?: Date | null }, today: string): boolean` og `expiresWithin(cert, today, days): boolean` i `src/core/organization/certification-rules.ts`. Konstanten `EXPIRING_SOON_DAYS = 60` ligger samme sted.
- `withPublishRequiringCertification(permissions: readonly Permission[], hasValidCertification: boolean): Permission[]` i `src/core/access/permissions.ts`.
- **Rettelse til kortet (Omfang 4):** oppslaget i `findGrant` legges i en egen funksjon `employeeHasValidCertification(employee: { id: string; organizationId: string }, today: string): Promise<boolean>` i `src/core/access/guards.ts` (eksportert fra filen, ikke fra `@/core/access`). `findGrant` kaller den med `todayInOslo()`. Uten dette kan ikke SQL-varianten av regelen testes med fast dato.
- I `src/core/organization`, alle med `(actor, organizationId, …)` først:
  - `listCertificationsForEmployee(actor, organizationId, employeeId, now?)` → rader med `id`, `area`, `issuer`, `certificateNumber`, `validFrom`, `validTo`, `status: "valid" | "expiring" | "expired" | "not_started"`.
  - `addCertification(actor, organizationId, input)` → raden. `input`: `employeeId`, `area`, `validTo`, valgfri `validFrom`, `issuer`, `certificateNumber`.
  - `removeCertification(actor, organizationId, certificationId)` → raden med `deletedAt` satt.
  - `listExpiringCertifications(actor, organizationId, now?)` → rader med `certificationId`, `employeeId`, `employeeName`, `area`, `validTo`, `status: "expired" | "expiring"`, sortert på `validTo`.
- Alle fire krever `organization.manage`. Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError` (samme mønster som resten av admin). Valideringsfeil er `ZodError` med meldingene fra kortet.
- Fabrikk: `createCertification(employee: { id; organizationId }, overrides?: { organizationId?; employeeId?; validFrom?; validTo?; area?; deletedAt? })`. Standard: `area: "condition_report"`, `validFrom: today`, `validTo: today + 1 år` (i Oslo). `resetDatabase` tømmer `certifications`.

## 1. Datoregelen, `src/core/organization/certification-rules.test.ts` (ny, regeltester som data)

En tabell `cases` med `{ name, validFrom, validTo, deletedAt, today, valid, expiringIn60 }`, kjørt med `it.each`. Samme tabell brukes i 3.1 mot databasen.

1. **utløper i dag er gyldig:** `validTo = 2026-10-31` → gyldig, i listen («Går ut snart»).
2. **utløpte i går er ugyldig:** `validTo = 2026-10-30` → ugyldig, i listen («Utgått»).
3. **starter i morgen er ugyldig:** `validFrom = 2026-11-01`, `validTo = 2027-11-01` → ugyldig.
4. **starter i dag er gyldig:** `validFrom = 2026-10-31`.
5. **`validFrom` tom er gyldig:** `validFrom = null`, `validTo = 2027-01-01`.
6. **60 dager frem er i listen:** `validTo = 2026-12-30` → gyldig, `expiresWithin(…, 60)` er `true`.
7. **61 dager frem er ikke i listen:** `validTo = 2026-12-31` → gyldig, `expiresWithin` er `false`.
8. **slettet teller ikke:** gyldige datoer, `deletedAt` satt → ugyldig og ikke i listen.
9. **midnatt i Oslo mot UTC:** `today = todayInOslo(new Date("2026-10-30T23:30:00Z"))` er `2026-10-31`; `validTo = 2026-10-30` → ugyldig.
10. **sommertid:** `todayInOslo(new Date("2026-06-30T22:30:00Z"))` er `2026-07-01`.
11. **`todayInOslo` uten argument** gir dagens dato på formen `ÅÅÅÅ-MM-DD` (regex).
12. **`labels.test.ts`** bruker `todayInOslo` fra `@/shared/lib/dates`; testen for nyttårsaften står og er grønn.

## 2. Sjekken som ren funksjon, `src/core/access/permissions.test.ts` (utvides, matrisen urørt)

Rollematrisen og fasitene i filen endres ikke (test-leder sammenligner diffen: bare nye tester lagt til nederst).

1. **`withPublishRequiringCertification(alle ni, false)`** gir de åtte andre, uten `report.publish`.
2. **med `true`** gir listen uendret (samme innhold og rekkefølge).
3. **uten `report.publish` i listen** og `false`: listen er uendret.
4. **rører ingen andre rettigheter** (`it.each` over hver rolles fasit × `false`): resultatet er fasiten minus `report.publish`.
5. **admin uten sertifisering beholder `organization.manage` og `staff.manage`** (regel 11, kommentar: testen skal aldri fjernes).
6. **muterer ikke input** (`Object.freeze` på listen inn).

## 3. Sjekken i `findGrant`, `src/core/access/guards.test.ts` (utvides)

Rollematrisen fra fase 0b står med samme fasit. Oppsettet får `createCertification` (gyldig) for hver ansatt, slik at `report.publish` fortsatt er tillatt for takstmann, leder og admin.

### 3.1 SQL og TypeScript er enige (regeltest)

1. **`employeeHasValidCertification` mot tabellen i 1** (`it.each`, én ansatt per sak, `today` fra tabellen): svaret er likt `isCertificationValid`. Dekker alle grensesakene, også midnatt (9).
2. **flere rader:** én utgått og én gyldig → `true`; to utgåtte → `false`; ingen rad → `false`.
3. **sertifisering for en annen ansatt i samme organisasjon** gir `false`.

### 3.2 Tilgang per rolle, med ekte klokke (datoene relativt til `todayInOslo()`)

1. **`it.each` over `inspector`, `manager`, `admin`:** uten sertifisering → `requireOrganizationAccess(…, "report.publish")` gir `AccessDeniedError`; utgått (`validTo` = i går) → `AccessDeniedError`; gyldig (`validTo` = i dag) → lykkes, og `grant.permissions` inneholder `report.publish`.
2. **innstillingen `access.inspectors_edit_all` av:** takstmann med gyldig sertifisering har fortsatt `report.publish`; uten har han det ikke.
3. **enkeltrettighet:** en takstmann uten sertifisering med `grantPermission(…, "report.publish")` får ikke `report.publish`; med gyldig sertifisering får han den.
4. **kontor får aldri `report.publish` fra rollen**, heller ikke med gyldig sertifisering. Gir admin kontor enkeltrettigheten (A21), gjelder sertifiseringskravet som for alle andre: uten gyldig sertifisering nei, med gyldig ja.
5. **fjernet sertifisering virker i neste kall:** gyldig → `removeCertification` → neste `requireOrganizationAccess(…, "report.publish")` gir `AccessDeniedError`.
6. **fornyelse virker i neste kall:** utgått → `addCertification` med ny `validTo` → `report.publish` tillatt.
7. **ingen annen rettighet påvirkes:** for hver rolle er `grant.permissions` uten sertifisering lik fasiten minus `report.publish`.

### 3.3 Admin stenges aldri ute (regel 11). Testene skal aldri fjernes; kommentar øverst i blokken sier det.

1. **admin uten sertifisering:** `requireOrganizationAccess` med `organization.manage`, `staff.manage` og `organization.read` lykkes.
2. **admin med bare utgått sertifisering:** det samme.
3. **admin uten sertifisering kan bruke adminfunksjonene:** `listEmployeesForAdmin`, `addCertification` (på seg selv) og `listExpiringCertifications` lykkes.
4. **admin kan registrere sin egen sertifisering** og får `report.publish` i neste kall (ingen høna-og-egget-sperre).

### 3.4 Tenant-isolasjon i sjekken

1. **sertifisering i B gir ikke `report.publish` i A:** samme bruker er takstmann i A og B; gyldig sertifisering bare i B → `report.publish` i A gir `AccessDeniedError`, i B lykkes.
2. **rad med `organization_id` A og ansatt fra B kan ikke finnes:** databasen avviser den (se 6.1), så sjekken trenger ikke å stole på `employee_id` alene. I gjennomgangen sjekker test-leder at oppslaget filtrerer på både `employee.id` og `employee.organizationId` fra ansatt-raden.

## 4. Spørringene, `src/core/organization/certifications.test.ts` (ny)

### 4.1 Tilgang per rolle

1. **`it.each` over funksjon (alle fire) × `inspector`/`office`/`manager`:** `AccessDeniedError`, og antall rader i `certifications` og `audit_log` er uendret.
2. **takstmann med enkeltrettigheten `report.publish` og gyldig sertifisering** får fortsatt `AccessDeniedError` (rettigheten gir ikke `organization.manage`).
3. **ansatt uten roller og admin som har sluttet** får `AccessDeniedError`.
4. **admin lykkes** (positiv kontroll for alle fire).

### 4.2 Tenant-isolasjon (ett `expectTenantIsolation` per funksjon, fire totalt)

1. **`listCertificationsForEmployee`:** `seed` lager en ansatt med én sertifisering i A og B; `query` henter for den ansatte som hører til `organizationId`.
2. **`addCertification`:** `seed` lager en ansatt i A og B og returnerer deres id-er; `query` legger til for den ansatte i `organizationId` og returnerer `[row]`, `idOf: row.organizationId`. Etterpå: B har nøyaktig én rad.
3. **`removeCertification`:** `seed` lager én sertifisering i A og B; `query` fjerner den i `organizationId` og returnerer `[row]`. Etterpå: B-raden har `deletedAt` satt én gang (ikke endret av A).
4. **`listExpiringCertifications`:** `seed` lager en utgått sertifisering i A og B; `idOf: row.certificationId`.

### 4.3 Fremmed id i egen organisasjon (regel 2)

1. **`addCertification` med `employeeId` fra B** (admin A, `orgA`): `AccessDeniedError`, ingen rad i A eller B, ingen loggrad.
2. **`removeCertification` med sertifiserings-id fra B:** `AccessDeniedError`; B-raden er uendret (`deletedAt` er `null`, `updatedAt` likt).
3. **`listCertificationsForEmployee` med ansatt-id fra B:** `AccessDeniedError` (ikke tom liste).
4. **`"ikke-en-id"` og en tilfeldig uuid** på alle tre: `AccessDeniedError`, ingen databasefeil.
5. **slettet ansatt og ansatt som har sluttet** i egen organisasjon: `addCertification` gir `AccessDeniedError` for slettet. For den som har sluttet: lov (historikk), utvikler velger; testen dokumenterer valget.
6. **`removeCertification` på en alt fjernet rad** gir `AccessDeniedError`; `deletedAt` endres ikke.

### 4.4 Legge til, fjerne og liste

1. **`addCertification` lagrer alle feltene** og setter `organizationId = grant.organizationId`, `createdBy` = admin.
2. **`removeCertification` er myk sletting:** raden står i databasen med `deletedAt`; antall rader i `certifications` går aldri ned i filen.
3. **fornyelse er ny rad:** etter fornyelse har den ansatte to rader i `listCertificationsForEmployee`; den gamle er merket `expired`.
4. **`listCertificationsForEmployee`** viser ikke slettede rader, og `status` følger tabellen i 1 (med `now` = `NOW`).
5. **svaret har faste nøkler:** `Object.keys(row).sort()` lik en fast liste; ingen `organizationId` eller `userId` i listesvarene.

### 4.5 Listen «går ut snart» (`now` = `NOW`)

1. **utgått og innen 60 dager vises,** 61 dager vises ikke; sortert på `validTo`, tidligst først.
2. **fornyet vises ikke:** gammel rad utgått, ny rad gyldig i ett år.
3. **fornyet med `validFrom` frem i tid vises ikke:** gammel rad går ut om 10 dager, ny rad `validFrom` = om 11 dager, `validTo` om ett år.
4. **nyeste per område er senest `validTo`, ikke sist opprettet:** opprett først rad med `validTo` om ett år, deretter en eldre utgått rad → personen vises ikke.
5. **slettet rad teller ikke:** den eneste gyldige raden er slettet, og den utgåtte vises; og en slettet utgått rad alene gir ingen linje.
6. **ansatt med `deactivated_at`** vises ikke.
7. **ansatt med `deleted_at`** vises ikke.
8. **én linje per ansatt og område**, også med flere utgåtte rader.
9. **ansatt uten sertifisering vises ikke** (listen gjelder bare utløp).
10. **tom liste** gir `[]` (siden viser teksten, se e2e 7.3).
11. **midnatt:** `now = 2026-10-30T23:30:00Z`, `validTo = 2026-10-30` → `status: "expired"`.

### 4.6 Validering (regeltester som data, `it.each`)

1. **`validTo` mangler** → `ZodError` med «Velg dato for gyldig til.».
2. **`validFrom` etter `validTo`** → «Gyldig fra kan ikke være etter gyldig til.».
3. **`validFrom` lik `validTo`** godtas.
4. **ugyldig dato** (`"31.13.2026"`, `"2026-02-30"`, `"ikke-dato"`) avvises.
5. **ukjent område** (`"bolig"`, tom streng) avvises; `condition_report` godtas.
6. **for lang tekst** i nummer og utsteder (over grensen utvikler setter) avvises.
7. Ingen rad og ingen loggrad når valideringen stopper.

### 4.7 Revisjonslogg

1. **`addCertification`** gir én rad `certification.created` med riktig `organizationId`, `entityId` og aktør.
2. **`removeCertification`** gir én rad `certification.deleted`.
3. **ingen loggrad** ved avvist tilgang eller valideringsfeil.

## 5. Område som fast kode

1. **`CERTIFICATION_AREAS`** har nøyaktig én kode, `condition_report`, med etiketten «Tilstandsrapport bolig» (test i `certification-rules.test.ts`).
2. **Schemaet bruker samme liste** (Zod-enum bygget fra konstanten; 4.6.5 viser det).

## 6. Databasen, `src/db/certifications-schema.test.ts` (ny, direkte innsetting)

1. **ansatt fra en annen organisasjon** (`organization_id` A, `employee_id` fra B) avvises av den sammensatte fremmednøkkelen.
2. **`valid_from` etter `valid_to`** avvises av CHECK.
3. **`valid_to` mangler** avvises (NOT NULL).
4. **`valid_from` tom** godtas.
5. **migreringen er ren:** `pnpm db:generate` gir ingen ny fil etter at migreringen er lagt inn (sjekkes i gjennomgangen).

## 7. Fabrikk, `tests/factories.test.ts` (utvides)

1. **`createCertification` uten overstyring** gir en gyldig rad i dag (`isCertificationValid` er `true`), `validTo` ett år frem, i samme organisasjon som den ansatte.
2. **overstyring av `validTo`, `validFrom`, `organizationId` og `employeeId`** brukes.
3. **`resetDatabase` tømmer `certifications`.**

## 8. E2E, `e2e/fase-0b-sertifisering.spec.ts` (ny, prosjektene `pc` og `ipad`)

Ekte klokke: datoene settes relativt til i dag (`todayInOslo()` + dager). Hver test lager en ansatt med `uniqueSuffix()` og leter etter navnet, siden e2e-databasen ikke tømmes mellom kjøringer.

1. **admin legger til en sertifisering og ser den i listen:** åpner ny ansatt, ser merknaden «Krever gyldig sertifisering.» ved «Publisere rapport», fyller «Gyldig til» = om 30 dager i «Legg til sertifisering», trykker «Lagre». Raden står i seksjonen «Sertifiseringer» med «Går ut snart». På `/admin/sertifiseringer` står navnet, og det lenker til den ansatte.
2. **fjerne med bekreftelse:** «Fjern» → bekreft → raden er borte fra seksjonen og fra `/admin/sertifiseringer`. «Avbryt» i bekreftelsen fjerner ingenting.
3. **utgått vises som «Utgått»** (gyldig til = i går) både på den ansatte og i listen; fornyelse med gyldig til om ett år tar navnet ut av listen.
4. **feilmeldinger ved feltet:** tom «Gyldig til» gir «Velg dato for gyldig til.»; «Gyldig fra» etter «Gyldig til» gir «Gyldig fra kan ikke være etter gyldig til.». Feltet har `aria-describedby` til meldingen, og ingenting lagres.
5. **takstmann får ikke se listen:** `logInAsInspector`, `/admin/sertifiseringer` gir «Ingen tilgang» eller 404, aldri 500, og HTML-en har ingen sertifiseringsdata.
6. **admin uten sertifisering kommer inn i adminområdet:** seed-admin (uten sertifisering) åpner `/admin/ansatte` og `/admin/sertifiseringer` (regel 11).
7. **iPad (bare prosjektet `ipad`):** «Legg til sertifisering», «Lagre» og «Fjern» er minst 44 px; skjemaet fylles og sendes med tastaturet alene; i stående (834x1194) har ansattskjermen og `/admin/sertifiseringer` ingen vannrett rulling.
8. **fanen «Sertifiseringer»** vises i adminområdet og er aktiv på siden.

Tom liste («Ingen sertifiseringer går ut de neste 60 dagene.») testes ikke i e2e, fordi andre kjøringer kan ha lagt inn rader; den dekkes av en komponenttest eller enhetstest av siden hvis utvikler lager en, ellers av 4.5.10.

## 9. Sjekker i gjennomgangen (test-leder)

1. Ingen `CURRENT_DATE`, `now()` eller `current_timestamp` i spørringene for gyldighet og listen (`grep` i `src/core/access` og `src/core/organization`).
2. `src/core` importerer ikke fra `src/app`; `todayInNorway` finnes ikke lenger.
3. `effectivePermissions` er uendret (diff), og rollematrisen i `permissions.test.ts` er urørt.
4. Hver ny spørring som tar `organizationId` har ett `expectTenantIsolation` (fire i 4.2).
5. Ingen ekte navn, e-poster eller sertifikatnumre i testdata.
6. Versjon 0.2.46 i `package.json`; A29–A32 i `docs/09-apne-sporsmal.md`; ordlisten og domenemodellen 4.1 oppdatert.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Legge til og fjerne (myk sletting) | 4.4.1–4.4.2, 8.1–8.2 |
| Revisjonslogg | 4.7 |
| `report.publish` per rolle og enkeltrettighet | 3.2.1–3.2.3, 3.2.5–3.2.6 |
| Admin uten sertifisering kommer inn | 2.5, 3.3, 8.6 |
| Grensesakene med fast dato i norsk tid | 1, 3.1, 4.5.11, 9.1 |
| Egen ren funksjon, matrisen urørt | 2, 9.3 |
| Kontor aldri, B gir ikke A | 3.2.4, 3.4.1 |
| Listen (fornyet, `validFrom` frem, sluttet, slettet) | 4.5 |
| Fremmed `employeeId` og sertifiserings-id | 4.3.1–4.3.2 |
| Takstmann, kontor og leder stoppes i kjernen | 4.1 |
| Databasen avviser | 6.1–6.3 |
| `expectTenantIsolation` per spørring | 4.2 |
| iPad-størrelse | 8.1, 8.7 |
| Alt grønt | 9.7 |
