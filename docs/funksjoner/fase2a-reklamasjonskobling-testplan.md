# Testplan: Reklamasjonskoblingen (oppdrag → henvendelse eller reklamasjon → ny befaring)

- **Oppgavekort:** `docs/funksjoner/fase2a-reklamasjonskobling.md`
- **Dato:** 17.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** færre reklamasjoner (testene låser at kjeden opprinnelig oppdrag → sak → ny befaring lagres som data med myk sletting, og at overgangen fra henvendelse til krav står som faste koder, så sakene kan telles og læres av), de ansatte (e2e viser at leder lager oppdraget for ny befaring på én skjerm og knytter et foreslått oppdrag med ett trykk, på PC og iPad) og KI i bunnen (testene viser at hendelser og revisjonslogg har strukturerte koder og id-er uten fritekst, slik at KI senere kan bruke dem trygt; ingen KI-kall i oppgaven).

Alle Vitest-tester mot databasen går mot `TEST_DATABASE_URL` med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: adresse «Testveien 1, 8000 Testby», gnr/bnr 1/2, klager «Kjøper Test», beskrivelse «Fukt i kjeller ikke nevnt». For lekkasjetestene brukes unike merker: `MERKE-BESKRIVELSE-R38`, `MERKE-KLAGER-R38`, `MERKE-NOTAT-R38`. Fast tid: `TEST_NOW` og `vi.setSystemTime` der rekkefølge og tidspunkt betyr noe (kandidatlisten, `deleted_at`). Ingen KI-kall og ingen nett.

Skjermene er lederarbeid med nett og trenger ikke virke uten nett (kortet «Skjermer»), så det trengs ingen e2e uten nett. Synk til iPad er ikke med (A430); det låses med en enhetstest. Ingen fagregler og ingen TG-logikk; «regeltestene» er valideringsreglene i kortet (`reinspection_*`, `claim_type_inquiry`) som tabeller med fasit **i testen**, ikke importert fra koden.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, Omfang 4–5. Avvik føres i kortet under «Avgjort av prosjektlederen».

- Fra `@/core/claims`: `createReinspectionAssignment(actor, organizationId, claimId, input)`, `listReinspectionCandidates(actor, organizationId, claimId)`, `linkReinspectionAssignment(actor, organizationId, claimId, target)`, `unlinkReinspectionAssignment(actor, organizationId, reinspectionId)`, `listReinspectionsForClaim(actor, organizationId, claimId)`, `getClaimForReinspectionAssignment(actor, organizationId, assignmentId)`.
- `input` for ny befaring: `{ responsibleEmployeeId, inspectionDate?, internalNote?, creationKey }`. `target`: `{ assignmentId } | { assignmentNumber }`.
- Svarene har `organizationId` på radene (eller på objektet), slik at `expectTenantIsolation` kan sammenligne. `createReinspectionAssignment` gir minst `{ reinspection: { id, organizationId, claimId, assignmentId }, assignmentId, created }`. `linkReinspectionAssignment` gir `{ reinspection, created }` (`created: false` ved `reinspection_no_duplicate`).
- Rolle uten rettighet, annen organisasjon, ukjent id, fjernet sak, fjernet opprinnelig oppdrag og fjernet kobling gir **samme** `AccessDeniedError` (siden viser 404 / «finnes ikke»). Brudd på `reinspection_not_original` og `reinspection_one_active_claim` gir egne feil med fast kode (for eksempel `ReinspectionRuleError` med `rule`), norsk melding. Navn etter utvikler, men koden er regelnavnet.
- `createAssignment(actor, organizationId, input, { now?, executor?, propertyId? })`; `CreateAssignmentInput.internalNote?`.
- Fabrikk i `tests/factories.ts`: `createClaimReinspection(organizationId, { claimId?, assignmentId?, createdBy?, deletedAt?, deletedBy? })`. Lager sak og oppdrag i samme organisasjon når de mangler. `claim_reinspections` står i `RESET_TABLES` **før** `claims` og `assignments`. Test i `tests/factories.test.ts`.
- E2e-hjelpere i `e2e/helpers.ts` (bare om de trengs): `insertClaimRow` får `claimType` som valg; `reinspectionRowsFor(claimId)` leser koblingene (også fjernede) direkte i databasen; `insertAssignmentAtSameAddress(assignmentId)` lager et nyere oppdrag på samme eiendom.

## Testfiler

| Kildefil | Testfil | Type |
|---|---|---|
| `src/db/schema/claim-reinspections.ts`, migrering `0036` | `src/db/claim-reinspections-schema.test.ts` (ny), `src/db/claims-schema.test.ts` (utvides) | integrasjon, databasen |
| `src/core/claims/codes.ts`, `schemas.ts` | `src/core/claims/schemas.test.ts` og `codes`-testen (utvides) | enhet, regler som data |
| `src/core/claims` (nye tjenester) | `src/core/claims/reinspections.test.ts` (ny) | integrasjon |
| samme, tilgang | `src/core/claims/reinspections-access.test.ts` (ny) | integrasjon |
| samme, samtidighet, tilbakerulling og engangsnøkkel | `src/core/claims/reinspections-transaction.test.ts` (ny) | integrasjon |
| samme, lekkasje i hendelser og revisjonslogg | `src/core/claims/reinspections-no-leak.test.ts` (ny) | integrasjon |
| `src/core/claims/claims.ts` (`removeClaim`, `updateClaim`) | `src/core/claims/claims.test.ts` (utvides) | integrasjon |
| `src/core/assignments/create.ts` | `create-assignment.test.ts`, `create-assignment-transaction.test.ts`, `create-assignment-access.test.ts` (utvides) | integrasjon |
| `src/core/events/types.ts` | eksisterende test for hendelsestyper (utvides) | enhet |
| synksettet | test for tabellene i synk (utvides, eller ny i `src/core/sync`) | enhet |
| server-handlingene | `src/app/(ansatt)/oppdrag/[id]/reklamasjoner/actions.test.ts` (ny eller utvides) | integrasjon |
| siden for oppdraget | `src/app/(ansatt)/oppdrag/[id]/reinspection-view.test.ts` (ny) | integrasjon |
| `tests/tenant-tables.ts` | `tests/tenant-isolation-all-tables.test.ts` (blir rød uten ny rad) | integrasjon |
| skjermene | `e2e/fase-2a-reklamasjonskobling.spec.ts` (ny); `e2e/fase-2a-reklamasjoner.spec.ts` (utvides med henvendelse) | e2e, PC og iPad |

## 1. Datamodellen, `claim-reinspections-schema.test.ts` og `claims-schema.test.ts`

1. `table_has_base_columns`: `claim_reinspections` har `id`, `organization_id`, `claim_id`, `assignment_id`, `created_by`, `created_at`, `updated_at`, `deleted_at`, `updated_by`, `deleted_by`, `row_version`; `organization_id`, `claim_id`, `assignment_id`, `created_by` er `not null`.
2. `composite_fk_rejects_cross_org_row`: rå `insert` med sak i org A og oppdrag i org B avvises av databasen (23503). Tilsvarende sak i org B og `organization_id` A.
3. `no_on_delete_cascade`: fremmednøklene har `ON DELETE NO ACTION`/`RESTRICT` (les `pg_constraint`); permanent sletting av saken med en kobling avvises (regel 3).
4. `unique_active_assignment`: to aktive rader med samme (`organization_id`, `assignment_id`) avvises (23505); én aktiv og én med `deleted_at` er lov; to fjernede er lov.
5. `index_on_claim`: indeksen (`organization_id`, `claim_id`) finnes (les `pg_indexes`).
6. `migration_check_constraint`: CHECK på `claims.claim_type` godtar `inquiry`, `complaint`, `insurance_claim`, `other` og avviser `unknown`. Saker som finnes fra før (alle tre gamle typer, også fjernede) består etter migreringen (kjør migreringen på en database med rader, eller test drop/add-SQL-en mot rader i en transaksjon).
7. `check_matches_codes`: verdiene i CHECK (lest fra `pg_constraint`) er nøyaktig `CLAIM_TYPES`.

## 2. Regler som data, `schemas.test.ts` og codes (enhet)

1. `claim_type_codes_stable`: `CLAIM_TYPES` er nøyaktig `["inquiry", "complaint", "insurance_claim", "other"]` (fast liste i testen). Ingen gammel kode er endret eller fjernet (regel 6). `claimTypeLabel("inquiry")` er «Henvendelse».
2. `claim_type_inquiry` (`it.each`): `claimInputSchema` godtar alle fire typer og avviser ukjent.
3. `reinspection_input_schema` (`it.each`, fasit i testen):
   | input | gyldig | regel |
   |---|---|---|
   | takstmann-id (uuid), ingen dato, intet notat | ja | |
   | uten takstmann | nei | påkrevd |
   | takstmann-id som ikke er uuid | nei | id-format |
   | befaringsdato `2026-13-01` | nei | dato |
   | notat 200 tegn | ja | |
   | notat 201 tegn | nei | lengde |
   | notat med elleve sifre (oppdiktet fødselsnummer-lignende) | nei | `no_national_id` |
   | notat med bare mellomrom | ja, lagres som tomt | |
4. `link_target_schema`: `{ assignmentId }` med uuid og `{ assignmentNumber }` på formen `ÅÅÅÅ-NNNNN` godtas; begge samtidig, ingen av dem, ugyldig uuid og ugyldig nummer avvises **før** spørringen (spioner på databasen eller bruk en id som ville gitt 22P02).
5. `event_types_registered`: `claim_reinspection.linked` og `claim_reinspection.unlinked` står i `EVENT_TYPES`.
6. `sync_excludes_claims` (A430): `claims` og `claim_reinspections` står ikke i listen over tabeller som synkes til enhetene.

## 3. Tjenestene, `reinspections.test.ts` (integrasjon)

### 3.1 `createReinspectionAssignment`
1. `create_copies_only_listed_fields`: opprinnelig oppdrag med adresse, gnr/bnr/snr, kommune, eiendom, borettslag, kontor, bestiller, kontakt, firma, `externalRef`, parter, team på to, pris, ordre og avtale. Nytt oppdrag har adresse, matrikkel, kommune, `propertyId`, borettslag og kontor likt; type `condition_report`; status `ordered`; ansvarlig er eneste teammedlem; **ingen** bestiller, kontakt, firma, `externalRef`, parter, pris, ordre eller avtale. Hvert felt sjekkes for seg.
2. `create_company_follows_responsible`: ansvarlig takstmann i et annet selskap enn det opprinnelige oppdraget → nytt oppdrag har takstmannens selskap.
3. `create_date_and_note_only_when_filled`: med dato og notat lagres begge; uten er begge `null`.
4. `create_note_rejects_fnr`: notat med elleve sifre → feil, ingen nye rader i `assignments`, `claim_reinspections`, `events` eller `audit_log`.
5. `create_ignores_form_fields`: ekstra felt i input (`propertyId`, `organizationId`, `officeId`, `address` fra org B) brukes aldri; det nye oppdraget får verdiene fra det opprinnelige oppdraget og `grant.organizationId`.
6. `create_responsible_from_other_org_rejected`: takstmann fra org B → feil, ingenting skrevet.
7. `create_on_removed_claim_not_found` og `create_on_removed_original_not_found`: samme `AccessDeniedError` som ukjent id.
8. `create_new_number`: det nye oppdraget får neste oppdragsnummer i serien, ikke det opprinnelige.

### 3.2 `listReinspectionCandidates` (A427)
1. `candidates_same_property_or_address`: med oppdrag på samme `property_id`, og oppdrag uten eiendom på samme normaliserte adresse (store/små bokstaver, ekstra mellomrom). Uten: eldre enn det opprinnelige, det opprinnelige selv, fjernet, kansellert, med aktiv kobling (til denne eller en annen sak), annen adresse, annen organisasjon på samme adresse.
2. `candidates_include_after_unlink`: oppdrag med fjernet kobling kommer med igjen.
3. `candidates_order_and_limit`: 22 treff gir 20, nyeste først.
4. `candidates_fields_only`: hver rad har bare id, oppdragsnummer, status, befaringsdato og ansvarlig takstmanns navn (fast nøkkelliste i testen; ingen adresse, parter eller notat).

### 3.3 `linkReinspectionAssignment` og regler (`it.each`, fasit i testen)
| tilfelle | `target` | forventet |
|---|---|---|
| nyere oppdrag samme org | `assignmentId` | kobling, `created: true`, hendelse `claim_reinspection.linked` |
| samme | `assignmentNumber` | kobling |
| `reinspection_not_original` | sakens opprinnelige oppdrag | regelfeil, ingen rad |
| `reinspection_one_active_claim` | oppdrag med aktiv kobling til sak 2 | regelfeil, ingen rad |
| `reinspection_no_duplicate` | samme oppdrag til samme sak igjen | eksisterende kobling, `created: false`, ingen ny hendelse |
| `reinspection_same_organization` | oppdrag i org B (id) | «finnes ikke» |
| samme | oppdragsnummer som bare finnes i org B | samme feil og melding som ukjent nummer |
| ukjent id / ukjent nummer | | «finnes ikke» |
| fjernet oppdrag | id | «finnes ikke» |
| fjernet sak | | «finnes ikke» |
| fjernet opprinnelig oppdrag | | «finnes ikke» |
| kansellert oppdrag | id | «finnes ikke», ingen rad (samme som kandidatlisten og engangsnøkkelregelen; velger utvikleren annet, føres det i kortet og testen endres) |

Feilen for «finnes ikke» er identisk (klasse og melding) i alle «finnes ikke»-radene, så svaret røper ikke om oppdraget finnes i en annen organisasjon.

### 3.4 `unlinkReinspectionAssignment` og visning
1. `unlink_soft_delete_keeps_row_and_assignment`: raden står med `deleted_at` og `deleted_by`; oppdraget er urørt; hendelse `claim_reinspection.unlinked`.
2. `unlink_twice_not_found`, `unlink_unknown_not_found`, `unlink_other_org_not_found` (samme feil).
3. `relink_after_unlink`: samme oppdrag kan knyttes på nytt (til samme eller annen sak); ny rad, den gamle står fjernet.
4. `list_for_claim_hides_removed`: `listReinspectionsForClaim` viser ikke fjernede koblinger og ikke koblinger der det nye oppdraget er fjernet.
5. `get_claim_for_assignment_fields_only`: `getClaimForReinspectionAssignment` gir bare id-er, oppdragsnummer (opprinnelig) og sakstype; ingen beskrivelse, klager, bygningsdel, beløp (fast nøkkelliste). Gir `null` (eller «finnes ikke») for vanlig oppdrag uten kobling.

### 3.5 Fjerning og papirkurv (A424, A425)
1. `remove_claim_removes_links`: sak med to koblinger → `removeClaim` gir sak og begge koblinger **nøyaktig samme** `deleted_at` og `deleted_by`; allerede fjernet kobling beholder sitt gamle tidspunkt; det nye oppdraget gir ingen sak i `getClaimForReinspectionAssignment` og kan knyttes til en annen sak.
2. `remove_claim_rollback`: feiler fjerningen av koblingene (tving feil), står saken uendret.
3. `trash_hides_and_restore_shows`: fjern det nye oppdraget → koblingen vises ikke i `listReinspectionsForClaim` og ikke på saken; `linkReinspectionAssignment` med samme oppdrag til en annen sak gir `reinspection_one_active_claim` (eller «finnes ikke», som avtalt; testen låser det); saken kan få en annen ny befaring; gjenopprett oppdraget → koblingen vises igjen.

### 3.6 Sakstype og overgang (F4, A429)
1. `claim_type_inquiry`: sak kan registreres som `inquiry`; endres til `complaint`, så `insurance_claim`, så tilbake til `inquiry`.
2. `claim_type_transition_in_audit`: hver endring av type gir revisjonsrad med `claimTypeFrom` og `claimTypeTo` (koder); endring uten typebytte har ikke feltene; ingen fritekst i raden.

### 3.7 `createAssignment` utvidet (ADR 0013)
1. Eksisterende tester for «Nytt oppdrag» er grønne uendret.
2. `create_with_executor_rolls_back`: kall med `executor` i en transaksjon som kastes etterpå → ingen oppdrag, ingen nummer brukt opp (eller nummerhull etter avtale i ADR), ingen hendelse.
3. `create_with_executor_checks_access`: `assignment.edit` sjekkes også med `executor` (takstmann uten rett avvises).
4. `create_internal_note`: `internalNote` lagres; samme regler som `updateAssignmentNote` (200 tegn, fødselsnummer).
5. `create_property_id_option`: `propertyId` fra annen organisasjon avvises/ignoreres; lest med `grant.organizationId`.

## 4. Transaksjon og samtidighet, `reinspections-transaction.test.ts`

1. `create_double_submit_same_creation_key`: to kall etter hverandre med samme nøkkel → ett oppdrag, én kobling, andre svar `created: false` med samme ids.
2. `create_concurrent_promise_all`: to kall i `Promise.all` med samme nøkkel → ett oppdrag, én kobling, ingen avvist promise med 500/23505.
3. `create_creation_key_reused_from_other_assignment`: nøkkel brukt på «Nytt oppdrag» uten kobling → «finnes ikke», ingen kobling (`reinspection_creation_key_reuse`).
4. `create_creation_key_reused_from_cancelled_assignment` og `..._from_removed_assignment`: samme.
5. `create_creation_key_reused_other_claim`: nøkkel brukt for ny befaring på sak 1, så brukt på sak 2 → «finnes ikke», ingen ny kobling.
6. `create_rollback_on_link_failure`: tving feil ved innsetting av koblingen (for eksempel en annen aktiv kobling som kolliderer, eller spion som kaster) → ingen oppdrag, ingen teammedlem, ingen hendelse `assignment.created`, ingen revisjonsrad.
7. `link_concurrent_promise_all`: samme oppdrag til samme sak to ganger samtidig → én kobling, begge kall lykkes. Samme oppdrag til to ulike saker samtidig → én kobling, det andre kallet får `reinspection_one_active_claim`, ingen 500.

## 5. Lekkasje, `reinspections-no-leak.test.ts` (A426)

Sak med merkene i beskrivelse og klager; ny befaring med notatmerket.
1. `no_leak_via_new_assignment`: alle rader i `events` og `audit_log` som nevner det nye oppdragets id (i `assignment_id`, `entity_id` eller `data`/`changes`) er bare `assignment.created`-hendelsen og oppdragets egen revisjonsrad, og disse er **like** et vanlig «Nytt oppdrag» (samme nøkler, ingen `claimId`, ingen `source`).
2. `reinspection_events_on_original`: `claim_reinspection.linked`/`unlinked` har `assignment_id` = det opprinnelige oppdraget; `data` har bare `claimId`, `reinspectionId`, `assignmentId` (fast nøkkelliste); revisjonsraden har `entityType: "claim_reinspection"`.
3. `booking_history_hides_reinspection`: `readBookingHistory` for begge oppdragene viser ingen rad om saken eller koblingen.
4. `no_free_text_anywhere`: ingen av merkene `MERKE-BESKRIVELSE-R38` og `MERKE-KLAGER-R38` finnes i `events` eller `audit_log` (søk i JSON-tekst). `MERKE-NOTAT-R38` finnes bare der et vanlig notat også ville stått.
5. `no_ai_calls`: `ai_usage_log` er tom etter hele flyten.

## 6. Tilgang, `reinspections-access.test.ts` (alle seks tjenestene, `it.each`)

Rollene: takstmann (innstillingen `access.inspectors_edit_all` av og på), takstmann med `claims.manage` gitt som enkeltrettighet, kontor, bruker med bare `claims.read` (lag rollen med `grantPermission` eller en rolle som bare har lesing, etter hva tilgangsmodulen tillater), leder, admin med bare admin-rollen (innstillingen av og på).

| tjeneste | takstmann (av/på) | takstmann + `claims.manage` | kontor | bare `claims.read` | leder | admin |
|---|---|---|---|---|---|---|
| `createReinspectionAssignment` | finnes ikke | finnes ikke | finnes ikke | finnes ikke | ja | ja |
| `listReinspectionCandidates` | finnes ikke | finnes ikke | finnes ikke | finnes ikke | ja | ja |
| `linkReinspectionAssignment` | finnes ikke | finnes ikke | finnes ikke | finnes ikke | ja | ja |
| `unlinkReinspectionAssignment` | finnes ikke | finnes ikke | finnes ikke | finnes ikke | ja | ja |
| `listReinspectionsForClaim` | finnes ikke | finnes ikke | finnes ikke | ja | ja | ja |
| `getClaimForReinspectionAssignment` | finnes ikke | finnes ikke | finnes ikke | ja | ja | ja |

- «finnes ikke» er samme feil som ukjent id, og ingen rad er skrevet (tell `assignments`, `claim_reinspections`, `events`, `audit_log` før og etter).
- `access_checked_before_read`: avvist kall gjør ingen spørring mot `claims` (spion på databasen, eller vis at ugyldig/ukjent claimId og gyldig gir samme feil og samme antall spørringer).
- `admin_never_locked_out` (regel 11, skal aldri fjernes): admin uten andre roller kan alle seks, også når `access.inspectors_edit_all` er av og uten sertifisering.
- `manager_without_assignment_edit` (hvis rollen kan settes slik): `createReinspectionAssignment` avvises uten at saken leses.
- `deactivated_employee`: deaktivert leder avvises.
- Server-handlingene i `reklamasjoner/actions.ts` (`actions.test.ts`): hver ny handling avviser takstmann og kontor med samme svar som ukjent id, og tar `organizationId` fra tilgangssjekken, aldri fra skjemaet (send inn org B-id i skjemaet; raden havner i org A eller avvises).

## 7. Tenant-isolasjon

1. `expectTenantIsolation` én gang per tjeneste (seks kall) i `reinspections.test.ts`: org B ser verken rader eller får tilgang; for skrivende tjenester viser testen at kall mot org A sin sak med org B-admin gir «finnes ikke» og ingen rad i noen organisasjon.
2. `claim_reinspections` i `tests/tenant-tables.ts` med radbygger og testfilen sin; `tenant-isolation-all-tables.test.ts` grønn.
3. Kandidatlisten tar ikke med oppdrag i org B på samme adresse (3.2.1).
4. `createClaimReinspection` i `tests/factories.ts`, tabellen i `RESET_TABLES`, test i `tests/factories.test.ts` (lager sak og oppdrag i samme organisasjon; `deletedAt` virker).

## 8. Siden, `reinspection-view.test.ts` (integrasjon, rendrer server-komponenten eller laster data)

1. `new_assignment_shows_section_for_manager`: det nye oppdraget har delen «Reklamasjon» med teksten «Ny befaring for reklamasjon på oppdrag …» og lenker til saken og det opprinnelige oppdraget.
2. `new_assignment_no_section_without_claims_read`: for takstmann (av/på) og kontor kalles ikke `getClaimForReinspectionAssignment` (spion), og ingen props om saken sendes til klientkomponenter.
3. `original_assignment_lists_reinspection_link` og `inquiry_badge`: «Ny befaring: oppdrag …» per sak, merket «Henvendelse».

## 9. E2e, `e2e/fase-2a-reklamasjonskobling.spec.ts` (PC og iPad Pro-størrelse)

Leder (`logInAsManager`), takstmann (`logInAsInspector`, `setInspectorsEditAll` av og på, gjenopprettes i `afterAll`), kontor (`logInAsOffice`). Data lages med hjelperne, oppdiktet.

1. `leder lager ny befaring med notat og dato`: fra saken → «Lag oppdrag for ny befaring» → adresse og eiendom vises som tekst; opprinnelig takstmann står først med merket «gjorde den opprinnelige befaringen»; ingen takstmann er forhåndsvalgt; fyll dato og notat → «Lag oppdraget» → på det nye oppdraget med kvitteringen «Oppdraget for ny befaring er laget.»; dato og notat vises.
2. `dobbelttrykk gir ett oppdrag`: to raske trykk på «Lag oppdraget» → én kobling i databasen (`reinspectionRowsFor`).
3. `koblingen vises på tre steder`: saken (oppdragsnummer som lenke, status, dato), det opprinnelige oppdraget («Ny befaring: oppdrag …»), det nye oppdraget (delen «Reklamasjon» med to lenker som virker).
4. `knytt foreslått oppdrag med ett trykk`: nyere oppdrag på samme eiendom står i listen; «Knytt til» → vises under «Ny befaring».
5. `knytt oppdrag funnet på nummer`: ingen forslag → teksten «Fant ingen nyere oppdrag på samme bolig. Søk på oppdragsnummer.»; søk på nummer → koblet. Ukjent nummer gir «finnes ikke»-meldingen.
6. `fjern koblingen`: «Fjern koblingen» → «Avbryt» lar den stå; bekreft → borte fra listen, tom-teksten «Ingen ny befaring er knyttet til saken.»; raden står i databasen med `deleted_at`.
7. `henvendelse registreres og endres til reklamasjon`: «Henvendelse» står først i typevalget med hjelpeteksten; merket «Henvendelse» på oppdraget; endres til «Reklamasjon» og merket skifter.
8. `takstmann og kontor ser ingenting` (takstmann med innstillingen av og på, kontor): på det nye oppdraget finnes verken «Reklamasjon», saks-id, opprinnelig oppdragsnummer i sammenheng med sak, eller lenke til `/reklamasjoner/` i HTML-en (`page.content()`) og i RSC-svaret (fang svarene på navigasjonen og søk i teksten); `GET` på `/oppdrag/[id]/reklamasjoner/[claimId]`, `.../ny-befaring` gir 404; det nye oppdraget vises ellers som et vanlig oppdrag.
9. `trykkflater og tastatur`: knappene «Lag oppdrag for ny befaring», «Knytt til oppdrag som finnes», «Knytt til», «Fjern koblingen», «Lag oppdraget» er minst 44×44 px på iPad-størrelse; skjemaet for ny befaring fylles og sendes med Tab og Enter, med synlig fokus.
10. `feilmelding uten takstmann`: «Lag oppdraget» uten valgt takstmann gir norsk feilmelding ved feltet, fokus flyttes dit, ingenting lagres.
11. `universell utforming`: aXe-sjekk (samme oppsett som andre spec-er, hvis det finnes) på saken og skjemaet for ny befaring uten alvorlige brudd.

`e2e/fase-2a-reklamasjoner.spec.ts` beholdes grønn uendret, bortsett fra at typevalget nå har «Henvendelse» først.

## 10. Testdata og dokumentasjon (sjekkes i gjennomgangen, ikke egne tester)

- `pnpm db:seed:testdata` gir én henvendelse og én reklamasjon med ny befaring; `e2e/fase-2a-testdata.spec.ts` eller testdata-testen utvides med telling.
- ADR 0013, domenemodellen 4.13, ordlisten (`inquiry`, `reinspection`), personvernerklæringen, planpunktet «Historikk på oppdraget», `docs/plan/forbedrerens-tillegg.md` (F1–F5), A419–A430 i `docs/09-apne-sporsmal.md`, versjonen i `package.json`.

## Kobling til akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Ny befaring på én skjerm, bare listede felt, selskap, dato og notat | 3.1.1–3.1.3, 9.1 |
| Ingen oppdrag uten kobling | 4.6, 3.7.2 |
| Foreslåtte oppdrag, ett trykk, søk som reserve | 3.2, 3.3, 9.4, 9.5 |
| Fjern kobling, raden står | 3.4.1, 9.6 |
| Vises på tre steder | 8.1, 8.3, 9.3 |
| Takstmann og kontor ser ingenting, «finnes ikke» | 6, 8.2, 9.8 |
| Ingen lekkasje via nytt oppdrag | 5.1–5.4 |
| Tenant-isolasjon | 7 |
| Reglene med testsaker, dobbelttrykk, samtidighet, engangsnøkkel, fjernet | 2, 3.3, 4 |
| Fjernet sak og papirkurv | 3.5 |
| Ingen fritekst, typeovergang som koder | 3.6.2, 5.4 |
| Henvendelse | 2.1, 2.2, 3.6.1, 9.7 |
| iPad og tastatur | 9.9–9.11 |
| Dokumentasjon | 10 |
| Ingen KI | 5.5 |

## Godkjenning (test-leder)

Avvises uten: tilgangstabellen i 6 for alle seks tjenestene med innstillingen av og på, `admin_never_locked_out`, seks `expectTenantIsolation`-kall og raden i `tests/tenant-tables.ts`, `no_leak_via_new_assignment`, og e2e 9.8 (HTML og RSC).
