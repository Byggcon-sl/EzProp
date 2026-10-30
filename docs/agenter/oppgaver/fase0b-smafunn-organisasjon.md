# Funksjon: Småfunn fra PR #41, organisasjon → selskap → kontor → ansatt (liten oppgave i)

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/organization`, `src/db/seed`)
- **Status:** godkjent (prosjektleder, autonom modus)
- **Branch:** `fase0b-smafunn-organisasjon` fra `main`. Bygger på: ingenting (PR #41 er merget).
- **Støtter hovedmål:** Reklamasjoner: lesespørringene gir bare feltene skjermene trenger, og testen for annen organisasjon dekker også listen med ansatte som har sluttet. Det holder grunnmuren tett før admin-skjermene bygges oppå. Tid: ryddigere tester og enklere spørringer gjør neste punkt (admin: opprette selskaper, kontorer og ansatte) raskere å bygge. KI først: indirekte (se under).

## Problem
Gjennomgangen av PR #41 fant små ting som ikke stoppet mergen:

1. **Seed-testene.** De doble testene for selskap og kontor er allerede borte på `main` (sjekket 30.10.2026). Det som står igjen: de to testene i `describe("seed")` i `src/db/seed/run.test.ts` kaller `runSeed` uten å fange `console.log`, så testkjøringen skriver seed-logg til konsollen. Den første testen har ingen spy i det hele tatt.
2. **Tenant-test.** `expectTenantIsolation` for `listEmployees` kjøres bare uten valg. Med `includeDeactivated: true` slipper filteret på `deactivated_at`, og den grenen er ikke prøvd mot en annen organisasjon.
3. **Feltliste.** `listCompanies` og `listOffices` bruker `select()` uten feltliste. Da går sporingsfeltene `created_by`, `updated_by` og `deleted_by` (innloggings-id-er), `organization_id`, `row_version` og tidsstempler ut til alle med lesetilgang. Ingen lekkasje til andre organisasjoner, men dårlig dataminimering.
4. **Join.** `listEmployees` filtrerer på `organizationId` også i join-ene mot `companies` og `offices`. De sammensatte fremmednøklene (`organization_id`, `company_id`/`office_id`) sikrer allerede at selskap og kontor hører til samme organisasjon som den ansatte, og den ansatte filtreres på `grant.organizationId`.
5. **Eksport.** `ListEmployeesOptions` eksporteres fra `employees.ts` og `index.ts` uten at noen andre bruker typen.

Lar vi være: admin-skjermene i neste punkt arver `select()` uten feltliste, og en endring i filteret for sluttede ansatte kan slippe gjennom uten at tenant-testen fanger den.

## KI først
Ikke direkte. Dette er rydding i grunnmuren. Faste feltlister gjør det tydelig hva som kan sendes videre, også til KI senere: bare feltene som trengs, aldri innloggings-id-er.

## Brukerhistorier
- Som **admin** vil jeg **at listene over selskaper og kontorer bare viser det som trengs** slik at **innloggings-id-er ikke spres til alle ansatte**.
- Som **utvikler/agent** vil jeg **at tenant-testen dekker begge varianter av ansattlisten** slik at **en feil i filteret oppdages med en gang**.

## Omfang
**Med:**
- `src/db/seed/run.test.ts`: fang `console.log` (spy med tom implementasjon) for testene i `describe("seed")`, for eksempel i en `beforeEach` slik som i `describe("seed av selskaper og kontorer")`. Testen «skriver aldri e-postadressen i loggen» skal fortsatt lese loggen. Ingen andre endringer i seed-testene, og ingen tester fjernes (de doble er allerede borte).
- `src/core/organization/employees.test.ts`: ett nytt kall til `expectTenantIsolation` med `query: (actor, organizationId) => listEmployees(actor, organizationId, { includeDeactivated: true })`. Seed-funksjonen skal lage minst én ansatt som har sluttet (`deactivatedAt` satt, gjerne uten innlogging, D18) i hver organisasjon, slik at testen faktisk prøver grenen.
- `listCompanies`: fast feltliste `id`, `legalName`, `orgNumber`, `vatRegistered`, `address`, `postalCode`, `city`, `companyText`, `liabilityInsurer`, `liabilityPolicyNumber`, `liabilityValidTo`.
- `listOffices`: fast feltliste `id`, `name`, `address`, `sortOrder`.
- Én test per funksjon (i `companies.test.ts` og `offices.test.ts`) som sjekker at radene har nøyaktig disse feltene, samme mønster som «gir nøyaktig de lovede feltene» i `employees.test.ts`. Doc-kommentaren på hver funksjon sier at den aldri gir sporingsfelt.
- `listEmployees`: fjern `eq(companies.organizationId, …)` og `eq(offices.organizationId, …)` fra join-ene. `isNull(deletedAt)` i join-ene og `eq(employees.organizationId, grant.organizationId)` i `where` beholdes. Kort kommentar ved join-en om at de sammensatte fremmednøklene sikrer samme organisasjon.
- `ListEmployeesOptions`: ikke eksportert fra `employees.ts` eller `index.ts` (typen står igjen lokalt).
- Versjon i `package.json`: 0.2.31 → 0.2.32.

**Ikke med (bevisst utelatt):**
- Nye funksjoner, nye felt, nye skjermer, migrering eller endring i tilgangsmodulen.
- Admin-skjermene for selskaper, kontorer og ansatte (eget punkt i fase 0b).
- Skjematestene som går litt utover akseptkriteriene (standardverdier, flytting med selskapet). De prøver regler som er i omfanget og blir stående.
- UU-funnene fra nattløkken (branch `fase1-uu-nattlokken`). Ikke rør de filene.
- Ny avhengighet eller endring i Azure.

## Tilgang
Uendret. Alle tre funksjonene bruker fortsatt `requireOrganizationAccess(actor, organizationId, "organization.read")` og filtrerer på `grant.organizationId`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | selskaper, kontorer og ansatte (uten sporingsfelt) | ingenting (uendret) |
| kontor | som takstmann | ingenting (uendret) |
| leder | som takstmann | ingenting (uendret) |
| admin | som takstmann | ingenting her (admin-skjermene er eget punkt) |

## Data
Ingen nye tabeller eller felt. Ingen migrering. Ingen nye faste koder. Ordlisten trenger ikke endres.

## Skjermer
Ingen. Funksjonene brukes ikke av noen side ennå.

## Regler
Ingen nye regler.

## Akseptkriterier
- [ ] `pnpm test` skriver ingen seed-logg til konsollen fra `src/db/seed/run.test.ts`, og alle seed-testene passerer.
- [ ] `employees.test.ts` har et `expectTenantIsolation`-kall med `includeDeactivated: true`, og seed i testen har minst én sluttet ansatt per organisasjon.
- [ ] `listCompanies` og `listOffices` gir nøyaktig feltene over (test), aldri `createdBy`, `updatedBy`, `deletedBy` eller `organizationId`.
- [ ] Join-ene i `listEmployees` har ikke organisasjonsfilter; eksisterende tester (også for slettet selskap/kontor og annen organisasjon) passerer uendret.
- [ ] `ListEmployeesOptions` eksporteres ikke; `pnpm typecheck` og `pnpm lint` er grønne.
- [ ] Bruker i annen organisasjon får ikke tilgang (eksisterende og ny `expectTenantIsolation`).
- [ ] Virker på iPad-størrelse: ingen skjermendring; `pnpm test:e2e` er grønn.
- [ ] Versjon 0.2.32.

## Åpne spørsmål
- Ingen. Ingen beslutninger som må føres i «Avgjort av agentene».

## Roller
- `utvikler`: punkt 3, 4 og 5 (spørringene og eksporten), versjon.
- `testskriver` (parallelt): punkt 1 og 2, og felttestene for `listCompanies`/`listOffices` (skrives mot feltlisten i dette kortet).
- Gjennomgang: `forenkler` og `sikkerhet-personvern` (dataminimering og tenant-test). Ingen arkitekt, UX, UI, KI eller fag.
