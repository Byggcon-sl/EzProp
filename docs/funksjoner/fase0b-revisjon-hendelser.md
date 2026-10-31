# Funksjon: Revisjonslogg og hendelseslogg

- **Fase:** 0b – Innlogging, organisasjon, roller og layout (punktet «Revisjonslogg og hendelseslogg» under Grunnmur)
- **Modul:** kjerne (`src/core/audit`, ny `src/core/events`)
- **Status:** utkast
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
1. **Tabellen `events`** (`src/db/schema/events.ts`, migrering 0008) med `baseColumns` (organisasjons-ID), `type` (tekst, påkrevd), `assignment_id` og `report_id` (uuid, kan være tomme, **ingen fremmednøkkel ennå**, tabellene kommer i fase 2a), `occurred_at`, `actor_type` (`employee`, `system`, `integration`, sjekk i databasen), `actor_id` (uuid, kan være tom for `system`), `data` (jsonb, standard `{}`). Indeks på `(organization_id, occurred_at)` og `(organization_id, assignment_id)`. Raden slettes aldri (heller ikke mykt); det står i kommentaren.
2. **Hendelsestypene som faste koder ett sted:** `src/core/events/types.ts` med alle kodene fra 4.9 og norsk navn (`EVENT_TYPES`, typen `EventType`). Ny kode legges bare til her; en kode endres aldri (regel 6).
3. **`recordEvent(executor, grant, input)`** i `src/core/events/index.ts`: samme mønster som `recordAuditEvent`. Organisasjonen og den ansatte (`actor_type = employee`, `actor_id = grant.employeeId`) kommer fra tilgangssjekken. `type` må være en kjent kode (TypeScript-typen og en sjekk som kaster ved ukjent kode). Kalles i samme transaksjon som endringen.
4. **Revisjonsloggen for admin:** ny fane «Logg» i adminområdet, `/admin/logg`. Enkel liste over de siste 100 endringene i organisasjonen: tidspunkt, hvem (navnet på den ansatte, «Ukjent» hvis tom), hva (norsk navn på `entity_type` og `action`, koden hvis navnet mangler) og endrede felt som «felt: fra → til». Bruker `listAuditEvents` (utvides med navnet på den ansatte og grensen 100). Tilgang som resten av adminområdet.
5. **Tester:** `recordEvent` lagrer på organisasjonen fra tilgangssjekken og avviser ukjent kode; `expectTenantIsolation` for `listAuditEvents` (finnes, beholdes og dekker navneoppslaget); takstmann og kontor får ikke se `/admin/logg` (e2e, pc og ipad); admin ser en endring han nettopp gjorde (e2e).
6. Ordlisten (avsnitt 8), domenemodellen 4.9 (ingen fremmednøkkel ennå, `actor_id` kan være tom), planen krysses av, versjon 0.2.48.

**Ikke med (bevisst utelatt):**
- Lesing av hendelser (`listEvents`) og skjerm for hendelser. Kommer med oppdragssiden i fase 2a, når det finnes oppdrag å vise dem på.
- Hendelser fra `system` og `integration` (ingen funksjon for dem nå). Kommer med første rutine eller tilkobling.
- Skriving av noen hendelse fra eksisterende kode. Ingen av typene i 4.9 skjer før fase 2a (oppdrag) eller fase 3 (`certification.expiring`).
- Søk, filter, sider, eksport og detaljvisning i revisjonsloggen. Bare siste 100.
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

- [ ] Tabellen `events` finnes med migrering 0008, med `organization_id` og tomme `assignment_id`/`report_id` tillatt.
- [ ] Alle hendelsestypene fra 4.9 står i `src/core/events/types.ts` og ingen andre steder.
- [ ] `recordEvent` lagrer organisasjonen og den ansatte fra tilgangssjekken, og avviser en ukjent kode (test).
- [ ] Admin ser de siste endringene på `/admin/logg` med navn, hva og når (e2e, pc og ipad).
- [ ] Takstmann får ikke se `/admin/logg` (e2e).
- [ ] Bruker i annen organisasjon ser ingen rader fra loggen (`expectTenantIsolation`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon 0.2.48.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A33:** `events` får ingen fremmednøkler til oppdrag og rapport før tabellene finnes i fase 2a; de legges til i samme migrering som tabellene. Hvorfor: punktet skal ligge klart før fase 2a, og det enkleste som virker. Kilde: domenemodellen 4.9, planen fase 0b. Kan endres i fase 2a.
- **A34:** Revisjonsloggen vises bare for admin, som én liste over de siste 100 endringene, uten filter. Hvorfor: gir svar på «hvem endret hva» nå (beslutning 27.10.2026 om at alle kan endre alt), med minst mulig kode. Kilde: domenemodellen 4.12, `svar-fra-stale-2026-10-27.md`. Kan utvides med filter per oppdrag i fase 2a.

## Roller

- **forenkler:** kutter omfanget før bygging.
- **sikkerhet-personvern:** ny tabell med organisasjons-ID, og en skjerm som viser endringer med personopplysninger.
- **test-leder:** testplan og godkjenning.
- **utvikler:** bit 1, tabell, migrering, `src/core/events`, `listAuditEvents` med navn, skjermen `/admin/logg`, dokumenter.
- **testskriver:** bit 2, enhetstester for `recordEvent` og `listAuditEvents`, e2e for `/admin/logg`.

Ikke med: ux-ansvarlig og ui-designer (én liste i et mønster som finnes), fagansvarlig (ingen fagtekster), arkitekt (følger domenemodellen og mønsteret i `src/core/audit`).

## Åpne spørsmål

- Ingen som stopper oppgaven.
