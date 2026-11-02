# Funksjon: Test av tenant-isolasjon for alle nye tabeller

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (bare tester og testhjelpere i `tests/`)
- **Status:** godkjent for bygging (oppgavekort 02.11.2026, runde 1 innarbeidet samme dag)
- **Branch:** `fase0b-tenant-test-alle-tabeller` (bygger på `main`)
- **Dato:** 02.11.2026
- **Støtter hovedmål:** Reklamasjoner: en lekkasje mellom organisasjoner er den alvorligste feilen systemet kan ha; én samlet test og en vakt gjør at den aldri når testmiljøet ubemerket. / Tid: ingen direkte. / KI først: nei (se under). Planen krever punktet: fase 0b, «Test av tenant-isolasjon for alle nye tabeller», og «ferdig når»: en automatisk test viser at en annen organisasjon ikke ser noe av Byggcons data.

## Avgjørelser etter runde 1 (prosjektlederen, 02.11.2026)

Forenkler, sikkerhet-personvern og test-leder har lest kortet. Ingen alvorlige funn, ingen spørsmål til Ståle. Dette er endret:

1. **Tabellnavnet er `employee_roles`**, ikke `employee_role_assignments` (alle tre). Databasenavnet står i `pgTable("employee_roles", …)` i `src/db/schema/employees.ts`; eksportnavnet er `employeeRoleAssignments`. Testen og registeret bruker alltid databasenavnet fra `getTableName()`. Tallet 13 og navnene skal komme fra skjemaet i testen, ikke fra dette kortet.
2. **Ett register i stedet for to filer** (forenkler). `tests/tenant-rows.ts` og `tests/tenant-tables.ts` slås sammen til `tests/tenant-tables.ts` med én linje per tabell: `{ table, insertRow, testFile, reason? }`. Da er det ett sted å føre opp en ny tabell, og én feil for én glipp. Test-lederens grensesnitt `insertMinimalRow(tableName, organizationId)` beholdes som en liten hjelper i samme fil som slår opp i registeret.
3. **Vakten er en ren funksjon** (forenkler og test-leder): `checkTenantRegistry({ tables, registry, readText })` returnerer en liste norske feilmeldinger (tom liste = grønn). Den ekte testen sender inn `node:fs`; selvtestene sender inn oppdiktede filinnhold. Ingen mocking av `node:fs`.
4. **Vakt-punkt (d) kuttes** (forenkler; sikkerhet-personvern og test-leder ville heller skjerpe det). Avgjørelse: kutt. Begrunnelse: et tekstsøk etter lesespørringer i `src/` (`from(`, `join(`, `db.query.`, rå SQL, omdøpte importer) blir enten skjørt eller stort, og gir falsk trygghet uansett. Det vakt-punktet skulle beskytte (at produktkodens spørring har test) dekkes i dag av regel 2 i gjennomgangen, som før. Selve isolasjonen for `events` bevises uansett av den samlede testen, og det er den planen krever. Regelen «`testFile: null` bare med `reason`» beholdes, og begrunnelsen skal si når tabellen får testfil (første lesespørring). Selvtestene U9 og U11 fra testplanen faller dermed bort.
5. **Vakten kan ikke omgås på (c)** (sikkerhet-personvern og test-leder): `testFile` må ligge under `src/`, slutte på `.test.ts` og ikke på `.dev.test.ts`, finnes, og inneholde `expectTenantIsolation(`. Filer under `tests/` avvises (de generiske hjelperne og den samlede testen inneholder teksten uten å bevise noen produktspørring). Registeret peker på hovedtestfilen for modulen som leser tabellen, ikke på `integrations.dev.test.ts` eller `admin-core.test.ts` (begge er ført for fjerning i liten oppgave (p) og (m)). Kravet om at testfilen nevner eksportnavnet tas ikke med: testfilene importerer funksjonene, ikke tabellen, så det ville gitt falsk rødt.
6. **Radbyggerne holder seg til oppdiktede og ufarlige verdier** (sikkerhet-personvern): `integration_connections` med port `email`, leverandør `server_log` og tomme `settings` (ingenting som ligner `clientId` eller `clientSecret`); `files` med oppdiktet `storage_key` og sjekksum, ingen skriving til disk, `retain_until` null; `login_attempts` får ingen rad (global tabell uten organisasjons-ID). Den generiske lesespørringen filtrerer på `grant.organizationId` fra `requireOrganizationAccess` (standardrettigheten `organization.read`), aldri på parameteren.
7. **Presiseringer** (test-leder): sakene navngis `isolasjon: <databasenavn>`; de seks globale tabellene sorteres og sammenlignes med `toEqual`; ny sak I15 viser at radbyggeren legger raden i oppgitt organisasjon (så seed ikke lykkes ved en tilfeldighet).

## Problem
Regel 2 i `CLAUDE.md` sier at hver spørring skal ha en test som viser at andre organisasjoner ikke får data. I dag ligger de testene spredt i 15 testfiler, én per modul. Ingen test svarer samlet på spørsmålet i planen: «ser en annen organisasjon noe som helst av Byggcons data, i noen tabell?» Og ingenting stopper en ny tabell med `organization_id` fra å komme inn uten en slik test; det er en gjennomgangsregel for test-leder, ikke kode. Lar vi være, vokser risikoen for hver tabell som kommer i fase 2 (oppdrag, rapporter, bilder, maler).

## KI først
Nei. Dette er testverktøy for utviklerne, ikke en oppgave for takstmannen. KI er ikke med.

## Brukerhistorier
- Som **test-leder** vil jeg **kjøre én test som går gjennom alle tabeller med `organization_id`** slik at **jeg kan si med sikkerhet at en annen organisasjon ikke ser noe av Byggcons data**.
- Som **utvikler** vil jeg **få rød test når jeg lager en ny tabell med `organization_id` uten tenant-test** slik at **regel 2 håndheves av koden, ikke av hukommelsen**.

## Omfang
**Med:**
1. **Én samlet test** `tests/tenant-isolation-all-tables.test.ts` som:
   - finner alle tabeller med kolonnen `organization_id` **fra Drizzle-skjemaet** (`import * as schema from "@/db/schema"`, gå gjennom `Object.values(schema)`, bruk `getTableColumns`/`getTableName`), ikke fra en håndskrevet liste. I dag er det 13 (alle via `baseColumns`): `audit_log`, `certifications`, `companies`, `employee_permissions`, `employee_roles`, `employees`, `events`, `files`, `integration_connections`, `offices`, `trial_answers`, `trial_forms`, `trial_photos`. De seks uten (`accounts`, `login_attempts`, `organizations`, `sessions`, `users`, `verifications`) hoppes over, og testen viser at det er nøyaktig disse seks, sortert og sammenlignet med `toEqual` (en ny tabell uten `organization_id` må da føres opp bevisst).
   - for **hver** tabell kjører `expectTenantIsolation` i én sak navngitt `isolasjon: <databasenavn>` (`it.each`), med en generisk lesespørring definert i testen: `requireOrganizationAccess(actor, organizationId)` (standardrettigheten `organization.read`) og så `select` fra tabellen filtrert på `grant.organizationId`, aldri på parameteren. `seed` legger inn én oppdiktet rad per organisasjon med `insertMinimalRow` fra punkt 2. Det viser for alle tabeller at mekanismen holder: raden hører til én organisasjon, A ser bare A, B ser bare B, og fremmed id nektes, også for admin.
   - feiler med tydelig norsk melding (`mangler radbygger for tabellen <navn> (legg den til i tests/tenant-tables.ts)`) når en tabell med `organization_id` ikke står i registeret.
2. **Ett register** `tests/tenant-tables.ts` (erstatter de to filene i første utkast):
   - `tenantTables: TenantTableEntry[]` der `TenantTableEntry = { table: string; insertRow: (organizationId: string) => Promise<string>; testFile: string | null; reason?: string }`. `table` er databasenavnet. `insertRow` legger inn det minste som trengs av foreldre-rader i samme organisasjon (for eksempel `employees` før `certifications` og `employee_roles`, `trial_forms` før `trial_answers` og `trial_photos`, bruker før `employees` der det trengs) og returnerer id-en til raden. Bruker fabrikkene i `tests/factories.ts` der de finnes. Bare oppdiktede verdier (se avgjørelse 6), ingen kundedata, ingen fagtekst, ingen hemmeligheter, ingen skriving til disk.
   - `insertMinimalRow(tableName: string, organizationId: string): Promise<string>` slår opp i registeret og kaster feilen i punkt 1 når tabellen mangler.
   - `testFile` peker på testfilen som beviser **produktkodens** lesespørring for tabellen, hovedtestfilen per modul (for eksempel `src/core/organization/companies.test.ts` for `companies`, `src/core/organization/employees-admin.test.ts` for `employee_roles`, `src/core/files/files.service.test.ts` for `files`, `src/core/integrations/connections.test.ts` for `integration_connections`). `testFile: null` er lov bare med `reason`, og bare når produktkoden ikke har noen lesespørring mot tabellen (i dag: `events`, som bare har `recordEvent`; begrunnelsen sier at testfil føres opp ved første lesespørring).
   - `checkTenantRegistry(input: { tables: string[]; registry: TenantTableEntry[]; readText: (path: string) => string | null }): string[]`, en ren funksjon uten egen fillesing. `tables` er databasenavnene fra skjemaet, `readText` gir filinnhold eller `null` når filen ikke finnes. Returnerer norske feilmeldinger, tom liste = grønn. Feiler når: (a) en tabell i `tables` mangler i registeret, (b) registeret nevner en tabell som ikke finnes i `tables`, (c) `testFile` ikke ligger under `src/`, ikke slutter på `.test.ts`, slutter på `.dev.test.ts`, ikke finnes, eller ikke inneholder teksten `expectTenantIsolation(`, (e) `testFile` er `null` uten `reason`. Hver melding sier hvilken tabell og hva som skal gjøres.
3. **Vakten kjøres** i `tests/tenant-isolation-all-tables.test.ts` mot det ekte registeret og de ekte filene (`readFileSync` fra `node:fs`, samme mønster som `sync-token.test.ts`; ingen ny avhengighet), og selvtestes med oppdiktede registre og filinnhold i minnet.
4. Én setning i `CLAUDE.md` under «Tilgang»: ny tabell med `organization_id` må føres i `tests/tenant-tables.ts` med radbygger og testfilen sin.
5. Kryss av punktet i `docs/07-utviklingsplan.md` fase 0b. Øk patch-versjon i `package.json` (0.2.53 → 0.2.54).

**Ikke med (bevisst utelatt):**
- Ingen produktkode. Ingen endring i `src/core/access`, ingen ny lesespørring for `events` (kommer når noe trenger den), ingen migrering, ingen ny avhengighet.
- Ingen lint-regel. Vakten er en Vitest-test som kjører i CI sammen med de andre; det holder, og lint-regler for testinnhold blir fort skjøre.
- Ingen søk i `src/` etter lesespørringer mot tabeller med `testFile: null` (avgjørelse 4).
- Ingen endring i de eksisterende tenant-testene i modulene. De beholdes som bevis for produktspørringene; den samlede testen kommer i tillegg.
- Ingen skrivetest (oppdatering/sletting på tvers av organisasjoner). Som i kortet for hjelperen: det tas når skriveoperasjoner tar `organizationId` fra adresse eller skjema.
- Ingen e2e. Ingen skjerm.
- Ikke tabellene uten `organization_id` (`users`, `sessions`, `accounts`, `verifications`, `login_attempts`, `organizations`): de er bevisst globale (innlogging og sperre skjer før organisasjonen er kjent, se `src/db/schema/auth.ts`). Testen viser bare at listen over dem er nøyaktig den vi kjenner.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

Ingen produktfunksjon. Testen bruker admin i begge organisasjonene (via `expectTenantIsolation`), fordi admin aldri stenges ute og isolasjonen må holde selv for admin. `expectTenantIsolation` viser også at en bruker uten ansattrad i organisasjonen nektes.

## Data
Ingen nye eller endrede tabeller. `docs/05-domenemodell.md` endres ikke. Ordlisten: ingen nye ord («tenant-isolasjon» står der fra før). Radene legges inn med `deleted_at = null`; ingen egen sak for myk sletting trengs.

## Skjermer
Ingen.

## Regler
Ingen regler som data. Testen og vakten er selv testsakene.

## Grensesnitt mellom utvikler og testskriver (så de kan jobbe i parallell)

Alt i `tests/tenant-tables.ts` (utvikleren), brukt fra `tests/tenant-isolation-all-tables.test.ts` (testskriveren):

```ts
export type TenantTableEntry = {
  table: string; // databasenavnet, f.eks. "employee_roles"
  insertRow: (organizationId: string) => Promise<string>; // id til raden
  testFile: string | null; // f.eks. "src/core/organization/companies.test.ts"
  reason?: string; // påkrevd når testFile er null
};
export const tenantTables: TenantTableEntry[];
export function insertMinimalRow(tableName: string, organizationId: string): Promise<string>;
export function checkTenantRegistry(input: {
  tables: string[];
  registry: TenantTableEntry[];
  readText: (path: string) => string | null;
}): string[]; // norske feilmeldinger, tom = grønn
```

## Testplan (test-leder, 02.11.2026, med kuttene i avgjørelse 4)

Alt i `tests/tenant-isolation-all-tables.test.ts`.

Enhet, uten database:
- U1 `finner alle tabeller med organization_id fra skjemaet`: 13 i dag, hentet med `getTableColumns`, ingen håndskrevet liste.
- U2 `tabellene uten organization_id er nøyaktig de seks kjente`: sortert, `toEqual`; ny global tabell gir rød.
- U3 `vakten er grønn mot det ekte registeret og de ekte filene`.
- U4 `vakten er rød når en tabell mangler i registeret` (melding nevner tabellen og `tests/tenant-tables.ts`).
- U5 `vakten er rød når registeret nevner en tabell som ikke finnes`.
- U6 `vakten er rød når testFile ikke finnes` (`readText` gir `null`).
- U7 `vakten er rød når testFile mangler expectTenantIsolation(`.
- U8 `vakten er rød når testFile er null uten reason`.
- U10 `vakten er rød når testFile peker på en fil under tests/, ikke slutter på .test.ts, eller slutter på .dev.test.ts` (tre varianter).
- U12 `events står med testFile null og begrunnelse`.

Integrasjon, mot testdatabasen (`resetDatabase` i `beforeEach`):
- I1–I13 `isolasjon: <tabellnavn>`: `it.each` over tabellene fra skjemaet, hver med `expectTenantIsolation` (A ser bare A, B ser bare B, fremmed id gir `AccessDeniedError` begge veier, og det gjelder admin).
- I14 `radbygger for ukjent tabell feiler med tabellnavnet i meldingen`.
- I15 `radbyggeren legger raden i oppgitt organisasjon`: `organization_id` på raden er lik id-en som ble sendt inn, for hver tabell.

Tilgang per rolle: ikke relevant (ingen skjerm). Regeltester og e2e: ingen nye, men `pnpm test:e2e` kjøres som vanlig. `fileParallelism: false` i `vitest.config.ts` gjør at samletesten ikke kolliderer med de andre databasetestene.

## Akseptkriterier
- [ ] `tests/tenant-isolation-all-tables.test.ts` finner tabellene fra Drizzle-skjemaet, og `pnpm test` viser én bestått sak per tabell med `organization_id` (13 i dag), navngitt `isolasjon: <databasenavn>`.
- [ ] For hver tabell: A ser bare A, B ser bare B, og fremmed organisasjons-id gir `AccessDeniedError` begge veier (via `expectTenantIsolation`).
- [ ] Listen over tabeller uten `organization_id` er nøyaktig `accounts`, `login_attempts`, `organizations`, `sessions`, `users`, `verifications` (sortert, `toEqual`); en ny tabell uten kolonnen gir rød test til den er ført opp.
- [ ] Radbyggeren legger raden i oppgitt organisasjon for hver tabell (I15), og en tabell uten radbygger gir rød test med melding som nevner tabellnavnet og `tests/tenant-tables.ts` (I14).
- [ ] `checkTenantRegistry` er en ren funksjon og er rød i hvert av tilfellene (a), (b), (c) og (e) i Omfang 2, vist med oppdiktede registre og filinnhold i minnet (U4–U8, U10). U10 viser at vakten ikke kan omgås med en fil under `tests/`.
- [ ] `events` står i registeret med `testFile: null` og begrunnelse, og vakten er grønn mot det ekte registeret og de ekte filene (U3, U12).
- [ ] Ingen endringer i `src/` utenom eventuelt kommentarer. Ingen ny avhengighet.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dette **er** testen.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.
- [ ] Virker på iPad-størrelse (e2e): ikke relevant, ingen skjerm.

## Biter som bygges i parallell
- **utvikler:** `tests/tenant-tables.ts` (registeret med de 13 tabellene, radbyggere med foreldre-rader, riktig testfil per tabell, `insertMinimalRow` og `checkTenantRegistry`), setningen i `CLAUDE.md`, versjon, avkryssing i planen. Sjekk tabellnavnene mot skjemaet ved bygging (`employee_roles`, ikke indeksnavnet).
- **testskriver:** `tests/tenant-isolation-all-tables.test.ts` (den samlede testen, kjøring av vakten mot ekte filer, og selvtestene etter testplanen) mot grensesnittet over. Skriver mot grensesnittet, slik at bitene ikke henger sammen.

## Roller
- **utvikler** og **testskriver** i parallell (bitene over).
- **sikkerhet-personvern:** gjennomgår at testen faktisk beviser isolasjon for alle tabellene, at radbyggerne bare har oppdiktede og ufarlige verdier, og at vakten ikke kan omgås (`testFile` under `tests/`, `null` uten grunn).
- **test-leder:** testplan og godkjenning; godkjenner ikke før de 13 sakene og alle selvtestene er sett kjøre grønt, og U10 beviser at vakten ikke kan omgås.
- **prosjektleder:** kort, PR, tilstand, plan.

Ikke med: arkitekt (ingen skjema eller grensesnitt i produktet), ux/ui (ingen skjerm), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagstoff). Forenkler har hatt runde 1; omfanget er nå minst mulig.

## Åpne spørsmål
- Ingen for Ståle. Ingen beslutning om fag, pris, personvern eller ny funksjon.
