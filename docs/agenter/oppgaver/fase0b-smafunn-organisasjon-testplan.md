# Testplan: Småfunn fra PR #41, organisasjon → selskap → kontor → ansatt (liten oppgave i)

- **Oppgavekort:** `docs/agenter/oppgaver/fase0b-smafunn-organisasjon.md`
- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Branch:** `fase0b-smafunn-organisasjon` (bygger på `main`)
- **Laget av:** test-leder, 30.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: tenant-testen dekker også listen med sluttede ansatte, og lesespørringene gir bare feltene skjermene trenger (ingen innloggings-id-er). Tid: ryddigere tester og enklere spørringer før admin-skjermene bygges. KI først: indirekte (faste feltlister viser hva som kan sendes videre).

## Hva som skal vises

1. Seed-testene skriver ingen logg til konsollen, og alle passerer fortsatt.
2. `listEmployees` med `includeDeactivated: true` lekker ikke mellom organisasjoner, og testen prøver faktisk grenen med sluttede ansatte.
3. `listCompanies` og `listOffices` gir nøyaktig den faste feltlisten, aldri sporingsfelt eller `organizationId`.
4. Join-ene i `listEmployees` uten organisasjonsfilter gir samme resultat som før (eksisterende tester uendret).
5. `ListEmployeesOptions` er ikke eksportert; typecheck og lint er grønne.

Fast oppsett: `resetDatabase` i `beforeEach`, fabrikkene i `tests/factories.ts`, oppdiktede navn.

## 1. Enhets-/integrasjonstester (mot testdatabasen)

### 1a. `src/db/seed/run.test.ts` (punkt 1)

| # | Testnavn | Hva den viser |
|---|---|---|
| 1 | `beforeEach` i `describe("seed")` med `vi.spyOn(console, "log").mockImplementation(() => {})` | Ingen seed-logg i testutskriften. `afterEach(vi.restoreAllMocks)` finnes fra før. |
| 2 | «lager Byggcon og admin, og kan kjøres to ganger uten duplikater» | **Uendret innhold.** Passerer med spy fra `beforeEach`. |
| 3 | «skriver aldri e-postadressen i loggen» | Leser fortsatt loggen. Enten bruker den spyen fra `beforeEach` (hentet via `vi.mocked(console.log)`) eller lager sin egen; begge er greit så lenge `firstRun` inneholder «opprettet» og `secondRun` «finnes fra før». Sjekken mot «@» må ikke bli tom: `expect(firstRun.length).toBeGreaterThan(0)` holdes implisitt av `some(... "opprettet")`. |
| 4 | `describe("seed av selskaper og kontorer")` | **Uendret.** Ingen tester fjernes. |

Godkjennes bare når `pnpm test` er sett uten seed-linjer («opprettet», «finnes fra før») i utskriften fra denne filen.

### 1b. `src/core/organization/employees.test.ts` (punkt 2 og 4)

| # | Testnavn | Hva den viser |
|---|---|---|
| 5 | «viser aldri ansatte fra en annen organisasjon, heller ikke med includeDeactivated» (ny) | Ett nytt kall til `expectTenantIsolation` med `query: (actor, organizationId) => listEmployees(actor, organizationId, { includeDeactivated: true })`. `seed` lager per organisasjon minst én aktiv ansatt og minst én sluttet ansatt uten innlogging (`userId: null`, `deactivatedAt` satt, D18), og **returnerer id-en til den sluttede** i `a`/`b`. Da krever hjelperen at den sluttede kommer med for egen organisasjon og aldri for den andre, så grenen er prøvd. |
| 6 | «viser aldri ansatte fra en annen organisasjon» | **Uendret** (uten valg). |
| 7 | «rollen %s kan lese de ansatte» (alle fire roller) | **Uendret.** Tilgang per rolle. |
| 8 | «ansatt uten roller får AccessDeniedError» | **Uendret**, dekker begge varianter. |
| 9 | «gir nøyaktig de lovede feltene, uten e-post eller innloggings-id» | **Uendret.** |
| 10 | «viser selskaps- og kontornavn, og null for en ansatt uten» | **Uendret.** Viser at join-ene fortsatt gir navn etter at organisasjonsfilteret er fjernet. |
| 11 | «slettet selskap eller kontor gir tomt navn, og den ansatte vises fortsatt» | **Uendret.** Viser at `isNull(deletedAt)` i join-ene er beholdt. |
| 12 | «viser ikke slettede ansatte, heller ikke med includeDeactivated» og «viser den som har sluttet bare med includeDeactivated, også uten innlogging» | **Uendret.** Myk sletting. |

Hvorfor organisasjonsfilteret i join-en kan fjernes, er allerede bevist i `src/db/schema/organization-structure.test.ts` («avviser innsetting/oppdatering med selskap/kontor fra en annen organisasjon»). Ingen ny test trengs for det; testene skal stå uendret.

### 1c. `src/core/organization/companies.test.ts` (punkt 3)

| # | Testnavn | Hva den viser |
|---|---|---|
| 13 | «gir nøyaktig de lovede feltene, uten sporingsfelt» (ny) | `Object.keys(row).sort()` er nøyaktig `address, city, companyText, id, legalName, liabilityInsurer, liabilityPolicyNumber, liabilityValidTo, orgNumber, postalCode, vatRegistered`. Minst én rad (`expect(rows.length).toBeGreaterThan(0)`). Da er `createdBy`, `updatedBy`, `deletedBy`, `organizationId`, `rowVersion` og tidsstempler utelukket. |
| 14 | «viser aldri selskaper fra en annen organisasjon» | **Uendret** `expectTenantIsolation`. `idOf: row.id` virker fortsatt. |
| 15 | «rollen %s kan lese selskapene», «ansatt uten roller …», «ansatt som har sluttet …», «viser ikke slettede selskaper», «sorterer på navn» | **Uendret.** |

### 1d. `src/core/organization/offices.test.ts` (punkt 3)

| # | Testnavn | Hva den viser |
|---|---|---|
| 16 | «gir nøyaktig de lovede feltene, uten sporingsfelt» (ny) | `Object.keys(row).sort()` er nøyaktig `address, id, name, sortOrder`. Minst én rad. |
| 17 | «viser aldri kontorer fra en annen organisasjon» | **Uendret** `expectTenantIsolation`. |
| 18 | «rollen %s kan lese kontorene», «ansatt uten roller …», «viser ikke slettede kontorer», «sorterer på rekkefølge og så navn» | **Uendret.** Sorteringen må fortsatt virke selv om `sortOrder` nå er i feltlisten. |

### 1e. Eksport og versjon (punkt 5)

| # | Sjekk | Hva den viser |
|---|---|---|
| 19 | `grep -rn ListEmployeesOptions src tests e2e` | Treff bare i `src/core/organization/employees.ts`, uten `export`. Ikke i `index.ts`. |
| 20 | `pnpm typecheck` og `pnpm lint` | Grønne. Ingen kode utenfor modulen brukte typen. |
| 21 | `package.json` | Versjon 0.2.32. |

## 2. Tilgang per rolle

Ingen endring i tilgangen. Dekket av de uendrede `it.each(roles)`-testene i alle tre testfilene (takstmann, kontor, leder, admin kan lese) og «ansatt uten roller får AccessDeniedError». Regel 11: ingen test viser at admin nektes i egen organisasjon; admin leser i test 5, 9–13 og 16.

## 3. Tenant-isolasjon

- `listCompanies`: test 14 (uendret).
- `listOffices`: test 17 (uendret).
- `listEmployees` uten valg: test 6 (uendret).
- `listEmployees` med `includeDeactivated: true`: test 5 (ny). Avvises hvis `seed` ikke returnerer id-en til en sluttet ansatt.

Ingen nye spørringer, så ingen andre kall trengs.

## 4. Regeltester

Ingen regler endres. Ingen regeltester.

## 5. Myk sletting

Dekket av uendrede tester: «viser ikke slettede selskaper/kontorer/ansatte» og «slettet selskap eller kontor gir tomt navn». Ingen kode sletter noe.

## 6. E2e (PC og iPad-størrelse, uten nett)

Ingen skjermendring; funksjonene brukes ikke av noen side ennå. Ingen nye e2e-tester. `pnpm test:e2e` skal være grønn på begge prosjektene (PC og iPad) som regresjon.

## 7. Kjøring før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Alle grønne.

## 8. Avvises hvis

- Test 5 mangler, eller `seed` ikke gir en sluttet ansatt per organisasjon som hjelperen krever tilbake.
- Felttestene 13 eller 16 mangler, eller bruker `toMatchObject`/`not.toHaveProperty` i stedet for nøyaktig nøkkelliste.
- Noen eksisterende test i de fire filene er endret eller fjernet (utover `beforeEach`-spyen i seed-testene).
- Filer fra `fase1-uu-nattlokken` er rørt.
