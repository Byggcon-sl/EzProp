# Funksjon: Revisjonslogg og hendelseslogg

- **Fase:** 0b – Innlogging, organisasjon, roller og layout (punktet «Revisjonslogg og hendelseslogg» under Grunnmur)
- **Modul:** kjerne (`src/core/audit`, ny `src/core/events`)
- **Status:** klar til bygging (etter forenkler og test-leder 31.10.2026)
- **Branch:** `fase0b-revisjon-hendelser` fra `main` (versjon 0.2.48; PR #58 med 0.2.47 venter)
- **Støtter hovedmål:**
  - **Reklamasjoner:** når alle takstmenn kan endre alt (27.10.2026), må det alltid gå an å se hvem som endret hva og når. Ved en reklamasjon er loggen beviset.
  - **Tid:** de automatiske rutinene i 4.9 («dagen før befaring», «rapport sendt») starter på hendelser. Uten hendelsesloggen kan ingen rutine bygges, og takstmannen må gjøre alt for hånd.
  - **KI først:** hendelsene og revisjonsloggen er dataene KI senere bruker til å forberede neste steg (for eksempel foreslå oppfølging når en befaring er avsluttet) og til å måle hva som endres etter KI-forslag.

## Problem

Revisjonsloggen finnes allerede (`audit_log`, `src/core/audit`) og skrives av adminhandlingene, men ingen kan lese den i appen. Hendelsesloggen (`events`, domenemodellen 4.9) finnes ikke. Fase 2a (oppdrag og rapport) og fase 3 (rutiner, varsler) skal skrive hendelser fra første dag. Lar vi være, blir hendelsene laget på hver sin måte i hver modul, og koder for hendelsestyper spres i koden.

## Hva som mangler mot domenemodellen

| Del | 4.9 / 4.12 sier | Finnes i dag | Gjøres nå |
|---|---|---|---|
| `audit_log` | alle felt | Ja (tabell, skriving, lesing for leder og admin, tenant-test) | Bare en enkel liste for admin |
| `events` | `type`, `assignment_id`, `report_id`, `occurred_at`, `actor_type`, `actor_id`, `data` | Nei | Tabell, migrering, skriving |
| Hendelsestypene | lang liste med koder | Nei | Faste koder ett sted |
| Felles funksjon for hendelser | – | Nei | `recordEvent` i `src/core/events` |

## KI først

KI har ingen rolle i selve loggen. Loggen er grunnlaget KI senere leser (hendelser som utløser forslag, revisjonslogg som viser hva takstmannen endret etter et KI-forslag). KI skriver aldri direkte i revisjonsloggen som en ansatt; når KI-funksjoner kommer, logges de i `ai_usage_log` og godkjenningen av takstmannen i revisjonsloggen.

## Brukerhistorier

- Som **admin** vil jeg **se hvem som har endret hva, og når**, slik at jeg kan svare på «hvem gjorde dette?» uten å spørre utviklerne.
- Som **utvikler av fase 2a og 3** vil jeg **skrive en hendelse med én funksjon og en fast kode**, slik at rutiner og varsler kan bygges på hendelsene senere.

## Omfang

**Med:**
1. **Tabellen `events`** (`src/db/schema/events.ts`, migrering 0008; PR #58 lager ingen migrering, sjekket 31.10.2026) med `baseColumns` (organisasjons-ID), `type` (tekst, påkrevd), `assignment_id` og `report_id` (uuid, kan være tomme, **ingen fremmednøkkel ennå**, tabellene kommer i fase 2a), `occurred_at`, `actor_type` (`employee`, `system`, `integration`, sjekk i databasen), `actor_id` (uuid, kan være tom for `system`), `data` (jsonb, standard `{}`). Bare indeksen `(organization_id, occurred_at)`. Indeksen på `(organization_id, assignment_id)` kommer med fremmednøkkelen i fase 2a (A33). **Myk sletting:** `baseColumns` beholdes, som i `audit_log`, slik at alle tabeller har samme kolonner. `deleted_at`/`deleted_by` forblir alltid tomme; kommentaren i skjemaet sier at raden aldri slettes eller endres, heller ikke mykt.
2. **Hendelsestypene som faste koder ett sted:** `src/core/events/types.ts` med alle kodene fra 4.9 som en `as const`-liste (`EVENT_TYPES`) og typen `EventType`. Ingen norske navn nå; de står i 4.9 og legges inn når hendelser vises (fase 2a). Ny kode legges bare til her; en kode endres aldri (regel 6).
3. **`recordEvent(executor, grant, input)`** i `src/core/events/index.ts`: samme mønster som `recordAuditEvent`. Organisasjonen og den ansatte (`actor_type = employee`, `actor_id = grant.employeeId`) kommer fra tilgangssjekken; input har ikke noe `organizationId`-felt. `type` har typen `EventType`, så ukjente koder stoppes av typecheck (ingen kjøresjekk). Kalles i samme transaksjon som endringen.
4. **Revisjonsloggen for admin:** ny fane «Logg» i adminområdet, `/admin/logg`. Enkel liste over de siste 50 endringene i organisasjonen (dagens standardgrense i `listAuditEvents`): tidspunkt, hvem (navnet på den ansatte, «Ukjent» hvis tom), hva (norsk navn på `entity_type` og `action` for verdiene som finnes i dag, ellers koden) og endrede felt som «felt: fra → til». `listAuditEvents` utvides bare med navnet på den ansatte (**left join**, så rader uten ansatt ikke forsvinner). Siden bruker `getAdminContext` (krever `organization.manage`) og organisasjonen derfra, som resten av adminområdet.
5. **Tester:** se Testplan under.
6. Ordlisten (avsnitt 8), domenemodellen 4.9 (ingen fremmednøkkel ennå, `actor_id` kan være tom), planen krysses av, versjon 0.2.48.

**Ikke med (bevisst utelatt):**
- Lesing av hendelser (`listEvents`) og skjerm for hendelser. Kommer med oppdragssiden i fase 2a, når det finnes oppdrag å vise dem på.
- Hendelser fra `system` og `integration` (ingen funksjon for dem nå). Kommer med første rutine eller tilkobling.
- Skriving av noen hendelse fra eksisterende kode. Ingen av typene i 4.9 skjer før fase 2a (oppdrag) eller fase 3 (`certification.expiring`).
- Søk, filter, sider, eksport og detaljvisning i revisjonsloggen. Bare siste 50.
- Revisjonslogg for leder i appen (kjernen tillater det, skjermen ligger i adminområdet).
- `automation_rules`, `action_runs`, `notifications` og rutinene.
- `device_id` i loggene (kommer med `devices`).
- Logg for innlogging og lesing (hvem så hva). Tas med «Minimum før ekte data» om det trengs.

## Tilgang

| Rolle | Se revisjonsloggen | Skrive hendelser |
|---|---|---|
| takstmann | Nei | Ja, gjennom handlinger de har lov til |
| kontor | Nei | Ja, gjennom handlinger de har lov til |
| leder | Nei i skjermen (kjernen tillater `staff.manage`) | Ja, gjennom handlinger |
| admin | Ja, `/admin/logg` | Ja, gjennom handlinger |

Ingen nye rettigheter. Ingen endring i `src/core/access`. Ingen kan endre eller slette en rad i loggene fra appen.

## Data

- Ny tabell `events` (se Omfang 1). Faste koder: alle hendelsestypene i 4.9, `actor_type` = `employee` | `system` | `integration`.
- `audit_log` uendret.
- `changes` og `data` skal aldri inneholde passord, nøkler eller mer personopplysninger enn nødvendig (kommentar i koden, sjekkes av sikkerhet-personvern).

## Skjermer

PC og iPad. `/admin/logg`: én tabell (liste på iPad stående) i samme mønster som `/admin/sertifiseringer` (`admin-list.tsx`). Ingen knapper. Fra adminområdet: 1 trykk på fanen «Logg».

## Regler

Ingen fagregler. Hendelsestypene er faste koder, ikke regler.

## Akseptkriterier

- [ ] Tabellen `events` finnes med migrering 0008, med `organization_id` og tomme `assignment_id`/`report_id` tillatt. Databasen avviser `actor_type` utenfor de tre verdiene (test).
- [ ] `EVENT_TYPES` har nøyaktig kodene fra 4.9, uten duplikater, alle på formen «ord.ord_med_understrek» (enhetstest). At kodene ikke står andre steder, sjekkes ved gjennomlesing (grep).
- [ ] `recordEvent` tar bare `EventType`, og lagrer organisasjonen og den ansatte fra tilgangssjekken med `actor_type = employee` (integrasjonstest). Input har ikke `organizationId` (`@ts-expect-error`-test).
- [ ] Ingen kode i `src/core/events` eller `src/core/audit` endrer eller sletter rader i loggene (gjennomlesing).
- [ ] Admin ser endringen han nettopp gjorde på `/admin/logg` med navn, hva, når og «felt: fra → til» (e2e, pc og ipad). Admin stenges aldri ute.
- [ ] Takstmann får «Ingen tilgang» eller 404 på `/admin/logg` og ser ingen rader (e2e).
- [ ] Leder og kontor slipper ikke inn på `/admin/logg`: `findAdminOrganizationId` gir `null` for dem (integrasjonstest). I kjernen får takstmann og kontor `AccessDeniedError` fra `listAuditEvents`, leder og admin får lese.
- [ ] Rad uten ansatt vises med «Ukjent» (left join, integrasjonstest).
- [ ] Bruker i annen organisasjon ser ingen rader, og ingen navn på ansatte i den andre organisasjonen (`expectTenantIsolation` mot den utvidede `listAuditEvents`, med ansatte i begge organisasjonene).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon 0.2.48.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A33:** `events` får ingen fremmednøkler til oppdrag og rapport før tabellene finnes i fase 2a; de legges til i samme migrering som tabellene. Hvorfor: punktet skal ligge klart før fase 2a, og det enkleste som virker. Kilde: domenemodellen 4.9, planen fase 0b. Kan endres i fase 2a.
- **A34:** Revisjonsloggen vises bare for admin, som én liste over de siste 50 endringene, uten filter. Hvorfor: gir svar på «hvem endret hva» nå (beslutning 27.10.2026 om at alle kan endre alt), med minst mulig kode. Kilde: domenemodellen 4.12, `svar-fra-stale-2026-10-27.md`. Kan utvides med filter per oppdrag i fase 2a.

## Testplan (testskriver, bit 2)

**`src/core/events/events.test.ts`** (mot testdatabasen):
- `recordEvent` lagrer `organization_id` og `actor_id` fra grant, `actor_type = employee`.
- Tomme `assignment_id` og `report_id` godtas, `data` blir `{}` som standard.
- Databasen avviser `actor_type` utenfor `employee`, `system`, `integration`.
- `recordEvent` i en transaksjon som rulles tilbake lagrer ingenting.
- `@ts-expect-error`: input med `organizationId` eller ukjent `type` gir typefeil.
- `EVENT_TYPES`: nøyaktig kodene fra 4.9, unike, riktig format.

**`src/core/audit/audit.test.ts`** (utvides):
- Navnet på den ansatte kommer med; rad med tom `actor_employee_id` kommer med, uten navn (left join).
- Nyeste først, og standardgrensen 50 brukes.
- Admin og leder kan lese; takstmann og kontor får `AccessDeniedError`.
- `expectTenantIsolation` mot den utvidede spørringen; seed lager rader med ansatte i begge organisasjonene, og navnet fra organisasjon B kommer aldri med.

**Visningstekster** (`labels.test.ts` ved siden av siden): norsk navn for dagens `entity_type`/`action`, koden når navnet mangler; «felt: fra → til», også med tomme verdier.

**E2e** (`e2e/fase-0b-logg.spec.ts`, kjøres i pc og ipad via `pnpm test:e2e`):
- Admin endrer stilling på en ansatt, trykker «Logg» (1 trykk) og ser navn, hva, når og endringen.
- iPad stående: ingen vannrett rulling.
- Takstmann får «Ingen tilgang» eller 404 og ser ingen rader (legg også `/admin/logg` i listen i test 4 i `fase-0b-admin.spec.ts`).

## Avgjort av prosjektlederen ved uenighet (31.10.2026)

- **Kjøresjekk for ukjent kode (forenkler kutter, test-leder vil teste):** kuttes. Alle kall er serverkode i TypeScript, så `EventType` stopper ukjente koder ved typecheck. Testen blir en `@ts-expect-error`-test i stedet. Mindre kode, samme vern.
- **Grense 100 (kortet) mot 50 (forenkler):** 50, som finnes i dag. Testen sjekker standardgrensen, ikke 100.
- **Norske navn på hendelsestyper:** kuttes nå (forenkler). Enhetstesten sjekker koder og format, ikke navn.
- **E2e for kontor og leder (test-leder) mot ingen kontor-e2e (forenkler):** siden bruker samme `getAdminContext` som resten av adminområdet. E2e kjøres for admin og takstmann. Leder og kontor dekkes med integrasjonstest av `findAdminOrganizationId` og av tilgangstestene i kjernen. Det er raskere og tester samme sperre; test-leders krav om tilgang per rolle er dermed dekket.
- **Myk sletting (test-leder punkt 4):** `baseColumns` beholdes som i `audit_log`; kolonnene forblir tomme, med kommentar.
- **Indeks på `assignment_id`:** kuttes til fase 2a (forenkler).

## Roller

- **forenkler:** kutter omfanget før bygging.
- **sikkerhet-personvern:** ny tabell med organisasjons-ID, og en skjerm som viser endringer med personopplysninger.
- **test-leder:** testplan og godkjenning.
- **utvikler:** bit 1, tabell, migrering, `src/core/events`, `listAuditEvents` med navn, skjermen `/admin/logg`, dokumenter.
- **testskriver:** bit 2, enhetstester for `recordEvent` og `listAuditEvents`, e2e for `/admin/logg`.

Ikke med: ux-ansvarlig og ui-designer (én liste i et mønster som finnes), fagansvarlig (ingen fagtekster), arkitekt (følger domenemodellen og mønsteret i `src/core/audit`).

## Åpne spørsmål

- Ingen som stopper oppgaven.
