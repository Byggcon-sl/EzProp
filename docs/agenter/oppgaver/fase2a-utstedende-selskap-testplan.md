# Testplan: Utstedende selskap settes automatisk fra ansvarlig takstmann

- **Oppgavekort:** `docs/agenter/oppgaver/fase2a-utstedende-selskap.md`
- **Fase:** 2a – Rapporten på PC
- **Branch:** `fase2a-utstedende-selskap` (bygger på `main`)
- **Laget av:** test-leder, 05.11.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner (rapport, forsikring og faktura kommer alltid fra riktig selskap, og hvert bytte har spor). Tid (ingen velger selskap for hånd; 0 trykk). KI først: ikke direkte (fast regel, ikke skjønn).

## Fast oppsett

- `resetDatabase` i `beforeEach`. Fabrikkene i `tests/factories.ts`: `createOrganization`, `createCompany`, `createEmployee(user, org, roles, { companyId })`, `createAssignment`, `createTeamMember`, `auditRows`, `TEST_NOW`.
- To selskaper i organisasjon A: «Selskap A1 AS» og «Selskap A2 AS». Ett i organisasjon B: «Selskap B AS». Alle navn er oppdiktet.
- Ansatte i A: `respA1` og `respA1b` (begge i A1), `respA2` (i A2), `noCompany` (uten selskap), `sidemann` (i A2).
- Selskapet leses direkte fra `assignments.company_id` i testen, i tillegg til `getAssignment(...).companyName`, så både lagring og visning er dekket.
- Testdata er oppdiktet. Ingen kundeopplysninger.

## 1. Skjema og migrering

Fil: `src/db/assignment-team-parties-schema.test.ts` (eksisterende), ny `describe("3.x utstedende selskap")`.

| # | Testnavn | Hva den viser |
|---|---|---|
| 1.1 | «company_id kan være tom» | `createAssignment` uten selskap gir `company_id = null`. Gamle oppdrag virker (A67). |
| 1.2 | «company_id fra egen organisasjon godtas» | Insert/update med selskap i A på oppdrag i A går. |
| 1.3 | «company_id fra en annen organisasjon avvises av assignments_company_fk» | Insert og update med Bs selskap på As oppdrag feiler med fremmednøkkelen `assignments_company_fk` (samme mønster som 3.6 og `employees_company_fk`). Tenant-isolasjon i databasen. |
| 1.4 | «ukjent company_id avvises» | Tilfeldig uuid feiler med samme fremmednøkkel. |

## 2. Regelen i `setTeamMember` (regeltester som tabell)

Fil: `src/core/assignments/assignment-team-parties.test.ts`, ny `describe("4.9 utstedende selskap")`. Regelen er fast kode, ikke mal-regel, men testes som data: én tabell `it.each` med (før, handling, forventet `company_id`, forventet `company_changed`).

| # | Før (ansvarlig / selskap) | Handling | Forventet selskap | `company_changed`? |
|---|---|---|---|---|
| 2.1 | ingen / tom | sett ansvarlig `respA1` | A1 | ja (null → A1) |
| 2.2 | `respA1` / A1 | bytt til `respA2` | A2 | ja (A1 → A2) |
| 2.3 | `respA1` / A1 | bytt til `respA1b` (samme selskap) | A1 | nei (men `team_changed` ja) |
| 2.4 | `respA1` / A1 | «Ingen» (fjern ansvarlig) | tom | ja (A1 → null), A66 |
| 2.5 | `respA1` / A1 | bytt til `noCompany` | tom | ja (A1 → null), A66 |
| 2.6 | `noCompany` / tom | bytt til `respA2` | A2 | ja (null → A2) |
| 2.7 | ingen / tom | sett `noCompany` | tom | nei |
| 2.8 | `respA1` / A1 | samme ansatt igjen | A1 | nei, og ingen `team_changed` |
| 2.9 | `respA1` / A1 | sett sidemann, medansvarlig, befaringstakstmann og saksbehandler til `sidemann` (A2), én om gangen | A1 etter hver | nei |
| 2.10 | `respA1` / A1 | fjern sidemann | A1 | nei |

Egne tester utenom tabellen:

| # | Testnavn | Hva den viser |
|---|---|---|
| 2.11 | «selskapet leses fra den ansattes rad nå, ikke fra skjemaet» | Input har ikke noe selskapsfelt; et ekstra felt `companyId` (Bs eller A2) i input ignoreres. Selskapet blir A1. |
| 2.12 | «admin endrer den ansattes selskap senere: oppdraget beholder det gamle» (A67) | `respA1` settes (A1), så `employees.company_id` → A2. Oppdraget har fortsatt A1, ingen hendelse. Settes ansvarlig på nytt (bytt bort og tilbake), blir det A2. |
| 2.13 | «samtidige bytter av ansvarlig: selskapet følger den som er aktiv til slutt» | To parallelle `setTeamMember` (`respA1` og `respA2`). Etterpå er `company_id` lik selskapet til den aktive ansvarlige, og antall `company_changed` stemmer med antall faktiske endringer. |
| 2.14 | «Bs ansatt-id gir EmployeeNotFoundError og selskapet er urørt» | Utvider 4.3.3: `company_id` uendret, ingen `company_changed`. |
| 2.15 | «avvist tilgang og valideringsfeil endrer ikke selskapet» | Takstmann uten `assignment.edit`, ukjent rolle, grunn med 11 sifre: `company_id` uendret, ingen hendelse. |

## 3. Hendelse og revisjonslogg

Fil: samme, `describe("4.8 hendelser og revisjonslogg")`, nye tester.

| # | Testnavn | Hva den viser |
|---|---|---|
| 3.1 | «assignment.company_changed har { fromCompanyId, toCompanyId } og bare id-er» | Ved 2.2: én hendelse med `assignmentId`, `data` har nøyaktig de to nøklene, verdiene er uuid eller null. Ingen navn. |
| 3.2 | «revisjonslogg: entityType assignment, action update, changes { companyId: { from, to } }» | Én rad, `entityId` = oppdraget, nøyaktig den formen. Ingen `legalName`. |
| 3.3 | «ingen company_changed og ingen assignment-loggrad når selskapet ikke endres» | 2.3, 2.7, 2.8, 2.9: antall `assignment.company_changed` og `auditRows` med `entityType = "assignment"` er 0. |
| 3.4 | «4.8.3 utvides: ingen personopplysninger eller selskapsnavn i events.data / audit_log.changes» | Søker etter navn på ansatte og selskaper i alle rader etter en runde med 2.1–2.5. |

Fil: `src/core/events/types.test.ts`: listen over hendelseskoder får `assignment.company_changed`.

Fil: `src/core/assignments/assignment-team-parties-transaction.test.ts`, ny test:

| # | Testnavn | Hva den viser |
|---|---|---|
| 3.5 | «kaster recordEvent for company_changed, rulles hele byttet tilbake» | Ingen ny teamrad, den gamle er aktiv, `company_id` uendret. Samme for `recordAuditEvent` med `entityType = "assignment"`. Viser «samme transaksjon». |

## 4. Tilgang per rolle

Fil: `src/core/assignments/assignment-team-parties.test.ts`, `describe("4.1 tilgang per rolle")`.

| # | Testnavn | Hva den viser |
|---|---|---|
| 4.1 | «kontor, leder, admin og takstmann (innstillingen på) setter ansvarlig og får selskapet» | `it.each` over rollene: selskapet blir A1. |
| 4.2 | «takstmann med inspectors_edit_all av: AccessDeniedError, selskapet urørt» | Men `getAssignment(...).companyName` kan leses (`organization.read`). |
| 4.3 | «admin uten andre roller og med innstillingen av setter ansvarlig og får selskapet» | Regel 11: admin stenges aldri ute. |
| 4.4 | «alle fire roller ser companyName» | `getAssignment` gir samme navn for takstmann, kontor, leder og admin. |
| 4.5 | «bruker uten ansattrad / ansatt uten roller får AccessDeniedError, og ingen companyName lekker» | Utvider 4.1.4. |

## 5. Tenant-isolasjon

Fil: samme, `describe("4.2 tenant-isolasjon")`.

| # | Testnavn | Hva den viser |
|---|---|---|
| 5.1 | «getAssignment(...).companyName viser aldri selskap fra en annen organisasjon» | **Ett kall til `expectTenantIsolation`.** `seed`: per organisasjon ett selskap med unikt navn («Selskap A AS» / «Selskap B AS»), en ansatt i det, oppdrag, `setTeamMember` ansvarlig. `query`: `[await getAssignment(...)]` med oppdraget for organisasjonen (ellers `randomUUID()`). `idOf`: `row.companyName`. Seed returnerer navnene. |
| 5.2 | «setTeamMember skriver bare company_id på oppdrag i egen organisasjon» | Utvider 4.2.5: As kall rører aldri Bs oppdrag (`company_id` i B uendret). |
| 5.3 | «organizationId fra skjemaet brukes ikke» | `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` har allerede «organizationId i skjemaet endrer ikke kallet». Ingen ny action, så ingen ny test der, men sjekk at testen fortsatt er grønn. |

## 6. Myk sletting og `getAssignment`

| # | Testnavn | Hva den viser |
|---|---|---|
| 6.1 | «4.5.1 faste feltlister utvides med companyName» | Feltlisten på oppdraget har `companyName` (og ingen andre nye felt eller sporingsfelt). |
| 6.2 | «oppdrag uten selskap gir companyName = null» | |
| 6.3 | «myk-slettet selskap vises fortsatt med navn» | Sett `companies.deleted_at`: `companyName` er fortsatt navnet (kortet punkt 4). |
| 6.4 | «4.5.6 ingen N+1 holder med selskapet» | Antall spørringer i `getAssignment` er uendret (left join, ikke eget oppslag). |
| 6.5 | «4.4.4 teamrader slettes aldri» holder med selskapsbytter | Ingen rader slettet; `company_id` endres med `update`, aldri `delete`. |

## 7. e2e (PC og iPad-størrelse)

Fil: `e2e/fase-2a-oppdrag-team-parter.spec.ts` (eksisterende, kutt 2). Kjører i prosjektene `pc` og `ipad`.

| # | Testnavn | Hva den viser |
|---|---|---|
| 7.2 (utvidet) | «team: … sett, bytt med grunn og fjern ansvarlig» | Før ansvarlig: «Utstedende selskap: Ikke satt» og forklaringen «Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn under Ansatte.» Etter at takstmannen (med selskap) er satt: «Utstedende selskap: <navn>». Etter «Ingen»: «Ikke satt» igjen. Linjen står under «Kontor». |
| 7.8 (utvidet) | «stående iPad: ingen vannrett rulling» | Ingen vannrett rulling med selskapslinjen, også med langt selskapsnavn. |

**Merk (oppsett):** Admin og takstmannen fra seed/`ensureInspector` har ikke selskap i dag. For at navnet skal vises, trenger e2e en ansatt med selskap. Minste løsning: `ensureInspector` (eller en ny liten hjelper i `e2e/helpers.ts`) setter `company_id` til «Byggcon Nord AS» fra seed bare når den er tom. Uten dette kan e2e bare vise «Ikke satt», og akseptkriteriet «navnet vises» er ikke dekket. Det er ikke et nytt testoppsett, bare én idempotent oppdatering.

Ingen e2e uten nett: oppdragssiden settes opp på kontoret med nett (som resten av filen).

## 8. Kommandoer før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. `tests/tenant-isolation-all-tables.test.ts` skal være grønn uten endring (ingen ny tabell).

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Settes/byttes ansvarlig, får oppdraget den ansattes selskap i samme transaksjon | 2.1, 2.2, 2.6, 2.13, 3.5 |
| Ansvarlig fjernet eller uten selskap gir tomt og «Ikke satt» med forklaring | 2.4, 2.5, 2.7, 6.2, 7.2 |
| Andre roller endrer ikke selskapet | 2.9, 2.10 |
| `company_changed` og revisjonslogg bare ved faktisk endring, bare id-er | 2.3, 2.8, 3.1–3.4 |
| Selskapets navn vises på oppdragssiden | 6.1, 6.3, 7.2 |
| Annen organisasjon får ikke tilgang; databasen stopper fremmed `company_id` | 1.3, 1.4, 2.14, 5.1, 5.2 |
| Virker på iPad-størrelse | 7.2 (ipad), 7.8 |
| Lint, typecheck, test, e2e grønne | 8 |

## Spørsmål til prosjektleder (stopper ikke)

- Den ansvarliges selskap er myk-slettet: skal `setTeamMember` likevel sette det? Kortet sier ikke. Forslag: sett det som står på den ansatte (fast regel), og la advarselen før publisering ta det. Testskriver tester ikke dette før det er avgjort.
