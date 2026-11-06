# Testplan: Avtale med oppdragsgiver (for eksempel Fremtind)

- **Oppgavekort:** `docs/funksjoner/fase2a-oppdragsgiveravtale.md`
- **Dato:** 06.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at forslaget kommer når bestillerens firma har nøyaktig én gyldig avtale, og at «Bruk avtalen» setter den med ett trykk, også på iPad), reklamasjoner (testene viser at slettet, utløpt eller ikke påbegynt avtale aldri kan velges, at feil forslag aldri gis ved tvil (to avtaler), og at en avtale som er satt blir stående med merke i stedet for å byttes i stillhet) og KI først (forslaget er en fast kobling som takstmannen godkjenner; testene viser at ingenting settes automatisk ved «gjør om til oppdrag»).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet: firmaet «Testforsikring AS» (`000000019`), avtalen «Testavtale forsikring», premisseteksten «Premiss for test. Ikke ekte tekst.», rapportprofilen `test-profil`. Ingen tekst fra NS 3600, IVIT eller SmartTakst.

**Fast tid:** alle tester som avhenger av dagen sender inn `now`. Standard er `TEST_NOW` (`2026-11-03T10:00:00Z`, i Oslo `2026-11-03`). Tidssonegrensen testes med `2026-11-03T23:30:00Z` (Oslo: `2026-11-04`).

Ingen del virker uten nett (oppdragssiden og admin brukes med nett), så det er ingen e2e uten nett. Ingen TG-regler; «regeltestene» er skjemagrensene, `isAgreementActive` og forslagsregelen som testsaker i `it.each`-tabeller.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet punkt 3. Avvik føres i kortet.

- `src/core/agreements/schemas.ts`: `agreementSchema` (`firmId`, `name`, `validFrom`, `validTo`, `premiseText`, `reportProfileCode`). Tom streng i `validTo`, `premiseText` og `reportProfileCode` blir `null`.
- `src/core/agreements/active.ts` (ren): `isAgreementActive({ validFrom, validTo }, today: string): boolean`.
- Fra `@/core/agreements`: `listAgreements`, `getAgreement`, `createAgreement`, `updateAgreement`, `deleteAgreement`, `setAssignmentAgreement`, `suggestAgreementForAssignment`, alle `(actor, organizationId, …)`; de to siste tar `now` til slutt.
- Feil: `NotFoundError` for ukjent, fremmed eller slettet avtale; egen feil (for eksempel `AgreementNotUsableError`) med meldingene «Avtalen gjelder ikke i dag.» og «Avtalen er fjernet.».
- `EVENT_TYPES` får `assignment.agreement_changed`.
- Fabrikk i `tests/factories.ts`: `createClientAgreement(organizationId, { firmId?, name?, validFrom?, validTo?, premiseText?, reportProfileCode?, deletedAt? })`. Uten `firmId` lager den et firma selv. Standard periode: `validFrom = "2026-01-01"`, `validTo = null`.
- `tests/tenant-tables.ts`: `client_agreements` med radbygger og testfilen `src/core/agreements/agreements.test.ts`.

## 1. Skjemaet, `src/core/agreements/schemas.test.ts` (ny, ren regeltest som data)

1. **grenser** (`it.each`, n godtas, n+1 avvises): navn 120/121, premisseteksten 10 000/10 001, rapportprofilen 60/61.
2. **påkrevd:** tomt navn og bare mellomrom → norsk melding; mangler `validFrom` → norsk melding; mangler `firmId` → norsk melding.
3. **periode** (`it.each`): `validTo` dagen før `validFrom` → norsk melding ved `validTo`; lik dag → godtas; tom `validTo` → `null` (løpende).
4. **datoformat:** `2026-13-01` og `ikke-dato` avvises med norsk melding, aldri databasefeil.
5. **trimming og tomme felt:** navn trimmes; tom premissetekst og tom rapportprofil blir `null`.
6. **`organizationId` i input ignoreres** (skjemaet tar den ikke med).

## 2. Gyldig i dag, `src/core/agreements/active.test.ts` (ny, ren regeltest som data)

`it.each` med `{ validFrom, validTo, today, active }`, avtale `2026-03-01`–`2026-10-31`:

1. dagen før start (`2026-02-28`) → nei.
2. startdagen → ja.
3. siste dag (`2026-10-31`) → ja.
4. dagen etter (`2026-11-01`) → nei.
5. tom `validTo`, i dag langt fram (`2036-01-01`) → ja.
6. én-dags avtale (`validFrom = validTo = today`) → ja.
7. **tidssone:** `todayInOslo(new Date("2026-10-31T23:30:00Z"))` gir `2026-11-01`, og avtalen er da ikke gyldig (viser at kjernen bruker norsk dato, ikke UTC).

## 3. Databasen, `src/db/client-agreements-schema.test.ts` (ny, direkte innsetting)

1. **CHECK:** `valid_to < valid_from` avvises uten Zod; lik dag og `null` godtas.
2. **fremmednøkkel firma:** `firm_id` fra en annen organisasjon avvises av `(organization_id, firm_id)`.
3. **fremmednøkkel på oppdraget:** `assignments.client_agreement_id` med avtale fra en annen organisasjon avvises (`assignments_client_agreement_fk`).
4. **påkrevd:** `name`, `valid_from`, `firm_id` kan ikke være `null`.
5. **indeksene finnes:** unik `(organization_id, id)` og delvis indeks `(organization_id, firm_id) WHERE deleted_at IS NULL` (les fra `pg_indexes`).
6. **tenant-tabellene:** `tests/tenant-isolation-all-tables.test.ts` er grønn med `client_agreements` ført opp.
7. **migreringen er ren:** `pnpm db:generate` lager ingen ny fil; filen heter `0021_oppdragsgiveravtale.sql` (sjekkes i gjennomgangen).

## 4. Kjernen, `src/core/agreements/agreements.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (`it.each`, rettighetsmatrise)

1. **lese** (`listAgreements`, `getAgreement`): `inspector`, `office`, `manager`, `admin` lykkes.
2. **skrive** (`createAgreement`, `updateAgreement`, `deleteAgreement`): `inspector`, `office`, `manager` får `AccessDeniedError`; antall rader i `client_agreements` og `audit_log` er uendret; avtalen er urørt.
3. **takstmann med `access.inspectors_edit_all` på** får fortsatt `AccessDeniedError` på skriving (innstillingen gjelder ikke avtaler).
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt:** `AccessDeniedError` på alle fem.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller og uten sertifisering kan lese, opprette, endre og slette.

### 4.2 Tenant-isolasjon (regel 2; ett `expectTenantIsolation` per tjeneste)

1. **`listAgreements`:** én avtale i A og B.
2. **`getAgreement`:** returnerer `[avtale]`.
3. **`createAgreement`:** `query` lager avtale for eget firma og returnerer `[rad]`, `idOf = organizationId`. Etterpå: B har nøyaktig én avtale.
4. **`updateAgreement`:** endrer navnet til `Endret av ${actor.id}`. Etterpå: Bs avtale er endret bare av B.
5. **`deleteAgreement`:** `query` sletter og returnerer raden. Etterpå: hver avtale slettet bare av egen organisasjon.

### 4.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id`:

1. **Bs avtale-id** i `getAgreement`, `updateAgreement`, `deleteAgreement` → `NotFoundError` eller `AccessDeniedError`; Bs avtale uendret (`updated_at`, `deleted_at`), ingen loggrad.
2. **Bs `firmId`** i `createAgreement` og `updateAgreement` → avvist i kjernen med norsk feil (ikke databasefeil), ingen rad.
3. **slettet firma** som `firmId` → avvist på samme måte.
4. **`organizationId: orgB.id` i input** ignoreres; raden lagres i A.
5. **tilfeldig uuid og `"ikke-en-id"`** → `NotFoundError`/`AccessDeniedError`, aldri databasefeil.

### 4.4 Opprette, endre, myk sletting

1. **opprette** lagrer alle feltene, `organizationId = grant.organizationId`.
2. **endre** lagrer nye verdier og oppdaterer `updated_at`.
3. **slette:** `deleted_at` satt, raden finnes fortsatt, vises ikke i `listAgreements`; `getAgreement` følger kortet (vises med `deletedAt` eller `NotFoundError`, testen følger det som bygges).
4. **slettet avtale:** `updateAgreement` og `deleteAgreement` → `NotFoundError`, ingen ny loggrad, `deleted_at` uendret.
5. **ingen permanent sletting:** ingen `delete from client_agreements` / `db.delete(clientAgreements)` i `src/core/agreements` (grep i gjennomgangen).
6. **listen** har firmanavnet og er sortert (navn), og viser utløpte avtaler (merket gjøres i siden).

### 4.5 Revisjonslogg

1. **én rad per skriving:** `client_agreement` med `create`, `update`, `delete`; riktig `organizationId` og `entityId`.
2. **`update`** har navnene på feltene som ble endret (for eksempel `["premiseText"]`).
3. **premisseteksten logges aldri** (`it.each` over de tre): `JSON.stringify` av loggraden inneholder ikke «Premiss for test».
4. **ingen loggrad** ved avvist tilgang, valideringsfeil eller `NotFoundError`.

## 5. Avtalen på oppdraget, `src/core/agreements/assignment-agreement.test.ts` (ny, mot databasen)

### 5.1 Sette, bytte, fjerne

1. **sette:** `client_agreement_id` satt; én hendelse `assignment.agreement_changed` med `{ fromAgreementId: null, toAgreementId: X }`; én loggrad.
2. **bytte** X → Y: hendelse med `{ X, Y }`, én loggrad.
3. **fjerne** (`null`): hendelse med `{ X, null }`; lov også når X er slettet eller utløpt.
4. **samme verdi to ganger** (X → X og `null` → `null`): ingen ny hendelse, ingen ny loggrad.
5. **`EVENT_TYPES`** har `assignment.agreement_changed` (kan ligge i `src/core/events/types.test.ts`).

### 5.2 Avvisning i kjernen (`it.each`, regeltest som data)

| avtale | forventet |
|---|---|
| slettet | «Avtalen er fjernet.» |
| utløpt (`validTo` i går) | «Avtalen gjelder ikke i dag.» |
| ikke påbegynt (`validFrom` i morgen) | «Avtalen gjelder ikke i dag.» |
| fra organisasjon B | `NotFoundError` (avvist i kjernen før databasen) |
| tilfeldig uuid | `NotFoundError` |

For hver: `client_agreement_id` uendret, ingen hendelse, ingen loggrad.

### 5.3 Tilgang per rolle

1. **takstmann** med `access.inspectors_edit_all` på → lykkes; av → `AccessDeniedError`, ingenting endret.
2. **kontor, leder, admin** lykkes med innstillingen av.
3. **admin stenges aldri ute:** admin uten andre roller, innstillingen av, lykkes.
4. **slettet oppdrag** eller oppdrag fra B → `NotFoundError`/`AccessDeniedError`.

### 5.4 Tenant-isolasjon

1. `expectTenantIsolation` for **`setAssignmentAgreement`** (oppdrag og avtale i hver organisasjon; `query` setter avtalen og returnerer oppdraget).
2. `expectTenantIsolation` for **`suggestAgreementForAssignment`** (forslaget i A peker aldri på en avtale i B).
3. `expectTenantIsolation` for **`getAssignment`** med avtalen (i `src/core/assignments/assignments.test.ts` eller her).
4. **blandet:** oppdrag i A, avtale i B, kalt som admin i A → avvist; samme med oppdrag i B og avtale i A.

### 5.5 Samtidighet

1. To samtidige `setAssignmentAgreement` på samme oppdrag (X og Y): sluttverdien er én av dem, og hendelsene henger sammen (den andre har `fromAgreementId` lik den første sin `toAgreementId`). Viser `FOR UPDATE`.

### 5.6 `getAssignment` med avtalen

1. har `agreement` med `id`, `name`, `validFrom`, `validTo`, `deletedAt`; `null` uten avtale.
2. slettet og utløpt avtale tas med (A117).
3. ingen premissetekst i oppdraget (hentes ikke før PDF).

## 6. Forslaget, `src/core/agreements/suggest.test.ts` (ny, regeltest som data mot databasen)

`it.each` med oppsett og forventet svar. Ordre med `orderedByFirmId` = firma F, gjort om til oppdrag med `createAssignment` + `orderId`.

| oppsett | forslag |
|---|---|
| F har én gyldig avtale | ja, den avtalen |
| F har ingen avtale | nei |
| F har to gyldige avtaler | nei |
| F har én gyldig og én utløpt | ja, den gyldige |
| F har én gyldig og én slettet | ja, den gyldige |
| eneste avtale er utløpt | nei |
| eneste avtale er ikke påbegynt | nei |
| eneste avtale er slettet | nei |
| oppdraget har allerede avtale | nei |
| oppdraget har ingen ordre | nei |
| ordren har ikke bestillerfirma | nei |
| F er slettet | nei |
| avtalen tilhører et annet firma | nei |
| megler-parten er F, men ikke bestilleren | nei (A116) |

Pluss:

1. **tidssone:** avtale som starter `2026-11-04`, `now = 2026-11-03T23:30:00Z` → forslag.
2. **tilgang:** alle fire roller kan hente forslaget (lesing); uten ansattrad → `AccessDeniedError`.
3. **ingen skriving:** forslaget endrer ikke oppdraget, ingen hendelse, ingen loggrad.
4. **ingen automatikk:** `convertOrderToAssignment` med bestiller fra F gir oppdrag med `client_agreement_id = null` (i `src/core/orders`-testene eller her).

## 7. Visning, `src/app/(ansatt)/oppdrag/[id]/agreement-card.test.tsx` (ny, komponent- eller enhetstest)

1. avtale satt og gyldig: navn og periode, «Bytt» og «Fjern», ingen merke.
2. utløpt avtale: merket «Utløpt».
3. slettet avtale: merket «Slettet».
4. ingen avtale, forslag finnes: «Forslag: <navn> (bestilleren er fra <firma>)» og «Bruk avtalen».
5. ingen avtale, ingen forslag: velgeren med «Ingen avtale».
6. velgeren viser bare gyldige avtaler (gitt en liste med gyldig, utløpt, slettet og ikke påbegynt).
7. bruker uten rett til å endre (takstmann med innstillingen av): ingen «Bytt», «Fjern» eller «Bruk avtalen».

## 8. Handlingene, `src/app/(ansatt)/admin/avtaler/actions.test.ts` og handlingen for oppdraget (nye, kjernen byttet ut som i `ordre/actions.test.ts`)

1. `getEmployeeContext` gir `null` → `NO_ACCESS` uten kall til kjernen.
2. id som ikke er uuid → `NO_ACCESS` uten kall.
3. `organizationId` i skjemaet endrer ikke kallet (organisasjonen kommer fra konteksten).
4. `AccessDeniedError` → `NO_ACCESS`; `ZodError` → feil ved feltet; «Avtalen gjelder ikke i dag.» og «Avtalen er fjernet.» vises; ukjent feil → `UNKNOWN_ERROR`.
5. «Ingen avtale» sendes som `null`.
6. loggkontrakt: loggkallene inneholder ikke premisseteksten.

## 9. E2E, `e2e/fase-2a-oppdragsgiveravtale.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Egne data med `uniqueSuffix()` og `fakeValidOrgNumber()` (databasen tømmes ikke). Hver test lager sitt eget firma, så forslaget aldri ser to avtaler fra andre tester.

1. **hele flyten:** admin-menyen «Avtaler» → «Ny avtale» → firma, navn, gyldig fra i dag, til tom, premissetekst, rapportprofil → «Lagre avtalen» → listen viser avtalen → ny ordre med bestiller fra firmaet → «Gjør om til oppdrag» → kortet «Avtale» viser «Forslag: …» → «Bruk avtalen» → navn og periode vises, `assignmentEventCount(id, "assignment.agreement_changed") = 1` → «Fjern» → «Ingen avtale», tellingen 2.
2. **velg for hånd:** oppdrag uten bestillerfirma → ingen forslag → velg avtalen i velgeren → vises.
3. **feil periode:** til-dato før fra-dato → norsk feilmelding ved feltet, ingenting lagret.
4. **fjerne avtalen** i admin med bekreftelse → borte fra listen; et oppdrag som har den viser merket «Slettet».
5. **ikke-admin:** `logInAsInspector` ser `/admin/avtaler` som «Ingen tilgang» eller uten «Lagre avtalen»; direkte POST til lagre-handlingen gir ingen ny avtale (sjekk i databasen).
6. **takstmann med innstillingen på** kan bruke forslaget på oppdraget (`setInspectorsEditAll(true)`, gjenopprettes med `restoreInspectorsEditAll`).
7. **ukjent id** på `/admin/avtaler/<uuid>` og `/admin/avtaler/ikke-en-id` → «Fant ikke siden» eller «Ingen tilgang», aldri 500.
8. **iPad-størrelse** (bare `ipad`, stående 834 × 1194): ingen vannrett rulling på `/oppdrag/<id>` med kortet «Avtale» og på `/admin/avtaler/ny`; «Bruk avtalen», «Bytt», «Fjern» og velgeren minst 44 px høye; premisseteksten kan skrives med skjermtastatur uten at «Lagre avtalen» skjules.

## 10. Fabrikker, `tests/factories.test.ts` (utvides)

1. `createClientAgreement` uten overstyring gir gyldig avtale i dag (`TEST_NOW`) med eget firma; overstyring (også `deletedAt`, `validTo`) brukes.
2. `RESET_TABLES` har `client_agreements` etter `assignments` og før `firms` (fremmednøklene), og testen som sammenligner med databasen er grønn.

## 11. Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Admin kan opprette, endre og fjerne (myk sletting) | 4.4.1–4.4.4, 4.1.5, e2e 9.1, 9.4 |
| Andre roller ser, men endrer ikke | 4.1.1–4.1.3, 8.4, e2e 9.5 |
| `valid_to` før `valid_from` avvises på norsk | 1.3, 3.1, e2e 9.3 |
| Velge, bytte, fjerne; hendelse og logg bare ved endring | 5.1, e2e 9.1, 9.2 |
| Slettet, utløpt, ikke påbegynt kan ikke velges | 5.2, 7.6 |
| Takstmann bare med innstillingen på | 5.3.1, 7.7, e2e 9.6 |
| Forslag ved nøyaktig én gyldig avtale; ett trykk | 6, 7.4, e2e 9.1 |
| Slettet/utløpt avtale vises med merke | 5.6.2, 7.2, 7.3, e2e 9.4 |
| Annen organisasjon får ikke tilgang; databasen stopper fremmede id-er | 4.2, 4.3, 5.4, 3.2, 3.3 |
| Virker på iPad-størrelse | e2e 9.8 (og hele filen kjøres i `ipad`) |
| `lint`, `typecheck`, `test`, `test:e2e` grønne | test-leders sluttkjøring |

## 12. Sjekkes i gjennomgangen (ikke egen testfil)

1. All tilgang via `requireOrganizationAccess` i `src/core/agreements`; ingen tilgangslogikk i sidene.
2. Alle spørringer filtrerer på `grant.organizationId`, aldri på id fra skjemaet.
3. `src/core/agreements` importerer ikke fra modulene (lint).
4. Ingen premissetekst i seed-data.
5. Admin stenges ikke ute (4.1.5 og 5.3.3 finnes og er grønne).
6. `package.json` 0.3.2, A114–A118 i `docs/09-apne-sporsmal.md`, ordlisten og domenemodellen oppdatert.

Godkjennes ikke uten 4.1, 4.2, 4.3, 5.3 og 5.4.
