# Funksjon: Test av tenant-isolasjon for alle nye tabeller

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (bare tester og testhjelpere i `tests/`)
- **Status:** utkast (oppgavekort, 02.11.2026)
- **Branch:** `fase0b-tenant-test-alle-tabeller` (bygger på `main`)
- **Dato:** 02.11.2026
- **Støtter hovedmål:** Reklamasjoner: en lekkasje mellom organisasjoner er den alvorligste feilen systemet kan ha; én samlet test og en vakt gjør at den aldri når testmiljøet ubemerket. / Tid: ingen direkte. / KI først: nei (se under). Planen krever punktet: fase 0b, «Test av tenant-isolasjon for alle nye tabeller», og «ferdig når»: en automatisk test viser at en annen organisasjon ikke ser noe av Byggcons data.

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
   - finner alle tabeller med kolonnen `organization_id` **fra Drizzle-skjemaet** (`import * as schema from "@/db/schema"`, `getTableColumns`/`getTableName`), ikke fra en håndskrevet liste. I dag er det 13: `audit_log`, `certifications`, `companies`, `employee_permissions`, `employee_role_assignments`, `employees`, `events`, `files`, `integration_connections`, `offices`, `trial_answers`, `trial_forms`, `trial_photos`. De seks uten (`organizations`, `users`, `sessions`, `accounts`, `verifications`, `login_attempts`) hoppes over, og testen viser at det er nøyaktig disse seks (en ny tabell uten `organization_id` må da føres opp bevisst).
   - for **hver** tabell kjører `expectTenantIsolation` med en generisk lesespørring (definert i testen): `requireOrganizationAccess(actor, organizationId)` og så `select` fra tabellen filtrert på `grant.organizationId`. `seed` legger inn én oppdiktet rad per organisasjon med radbyggeren fra punkt 2. Det viser for alle tabeller at mekanismen holder: raden hører til én organisasjon, A ser bare A, B ser bare B, og fremmed id nektes, også for admin.
   - feiler med tydelig norsk melding (`mangler radbygger for tabellen <navn>`) når en tabell med `organization_id` ikke har radbygger.
2. **Testhjelper** `tests/tenant-rows.ts`: én radbygger per tabell, `insertMinimalRow(tableName, organizationId): Promise<string>` (returnerer id). Legger inn det minste som trengs av foreldre-rader i samme organisasjon (for eksempel `employees` før `certifications`, `trial_forms` før `trial_answers`, bruker før `employees` der det trengs). Bruker fabrikkene i `tests/factories.ts` der de finnes. Bare oppdiktede verdier, ingen kundedata, ingen fagtekst.
3. **Statisk vakt** i samme testfil, med registeret `tests/tenant-tables.ts`:
   - registeret er en liste `{ table: string; testFile: string | null; reason?: string }`. `testFile` peker på testfilen som beviser **produktkodens** lesespørring for tabellen (for eksempel `src/core/organization/companies.test.ts` for `companies`). `testFile: null` er lov bare med `reason`, og bare når produktkoden ikke har noen lesespørring mot tabellen (i dag: `events`, som bare har `recordEvent`).
   - vakten feiler når: (a) en tabell med `organization_id` i skjemaet mangler i registeret, (b) registeret nevner en tabell som ikke finnes i skjemaet, (c) `testFile` ikke finnes eller ikke inneholder teksten `expectTenantIsolation(`, (d) `testFile` er `null`, men en fil i `src/` som ikke er test leser fra tabellen (`from(<eksportnavn>)`). Feilmeldingen sier hvilken tabell og hva som skal gjøres.
   - vakten leser filer med `node:fs` (samme mønster som `sync-token.test.ts`), ingen ny avhengighet.
4. Én setning i `CLAUDE.md` under «Tilgang»: ny tabell med `organization_id` må føres i `tests/tenant-tables.ts` med testfilen sin.
5. Kryss av punktet i `docs/07-utviklingsplan.md` fase 0b. Øk patch-versjon i `package.json` (0.2.53 → 0.2.54).

**Ikke med (bevisst utelatt):**
- Ingen produktkode. Ingen endring i `src/core/access`, ingen ny lesespørring for `events` (kommer når noe trenger den), ingen migrering, ingen ny avhengighet.
- Ingen lint-regel. Vakten er en Vitest-test som kjører i CI sammen med de andre; det holder, og lint-regler for testinnhold blir fort skjøre.
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

Ingen produktfunksjon. Testen bruker admin i begge organisasjonene (via `expectTenantIsolation`), fordi admin aldri stenges ute og isolasjonen må holde selv for admin.

## Data
Ingen nye eller endrede tabeller. `docs/05-domenemodell.md` endres ikke. Ordlisten: ingen nye ord («tenant-isolasjon» står der fra før).

## Skjermer
Ingen.

## Regler
Ingen regler som data. Testen og vakten er selv testsakene.

## Akseptkriterier
- [ ] `tests/tenant-isolation-all-tables.test.ts` finner tabellene fra Drizzle-skjemaet, og `pnpm test` viser én bestått sak per tabell med `organization_id` (13 i dag), navngitt med tabellnavnet.
- [ ] For hver tabell: A ser bare A, B ser bare B, og fremmed organisasjons-id gir `AccessDeniedError` begge veier (via `expectTenantIsolation`).
- [ ] Listen over tabeller uten `organization_id` er nøyaktig `accounts`, `login_attempts`, `organizations`, `sessions`, `users`, `verifications`; en ny tabell uten kolonnen gir rød test til den er ført opp.
- [ ] En tabell uten radbygger gir rød test med melding som nevner tabellnavnet (selvtest: kall radbyggeren med et oppdiktet tabellnavn).
- [ ] Vakten er rød når en tabell mangler i `tests/tenant-tables.ts`, når en registrert testfil mangler `expectTenantIsolation(`, og når en tabell med `testFile: null` leses fra produktkoden (selvtest mot et oppdiktet register i minnet, ikke mot ekte filer).
- [ ] `events` står i registeret med `testFile: null` og begrunnelse, og vakten er grønn fordi ingen fil i `src/` utenfor tester leser fra `events`.
- [ ] Ingen endringer i `src/` utenom eventuelt kommentarer. Ingen ny avhengighet.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): dette **er** testen.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.
- [ ] Virker på iPad-størrelse (e2e): ikke relevant, ingen skjerm.

## Biter som bygges i parallell
- **utvikler:** `tests/tenant-rows.ts` (radbyggerne, med foreldre-rader), `tests/tenant-tables.ts` (registeret med de 13 tabellene og riktig testfil per tabell), setningen i `CLAUDE.md`, versjon, avkryssing i planen.
- **testskriver:** `tests/tenant-isolation-all-tables.test.ts` (den samlede testen og vakten, med selvtester) mot grensesnittet over: `insertMinimalRow(tableName, organizationId): Promise<string>` og `tenantTables: { table, testFile, reason? }[]`. Skriver mot grensesnittet, slik at bitene ikke henger sammen.

## Roller
- **utvikler** og **testskriver** i parallell (bitene over).
- **sikkerhet-personvern:** gjennomgår at testen faktisk beviser isolasjon for alle tabellene, og at vakten ikke kan omgås (for eksempel med `testFile: null` uten grunn).
- **test-leder:** testplan og godkjenning; godkjenner ikke før de 13 sakene er sett kjøre.
- **prosjektleder:** kort, PR, tilstand, plan.

Ikke med: arkitekt (ingen skjema eller grensesnitt i produktet), ux/ui (ingen skjerm), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagstoff), forenkler (omfanget er alt minst mulig, «ikke med» står over).

## Åpne spørsmål
- Ingen for Ståle. Ingen beslutning om fag, pris, personvern eller ny funksjon.
