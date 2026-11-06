# Funksjon: Tidsmåling per oppdrag og fase

- **Fase:** 2a – Rapporten på PC (punktet «Tidsmåling per rapport fra første ekte rapport» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/work-sessions`), oppdragssidene `/oppdrag/[id]` og `/oppdrag/[id]/bygninger`, ny side `/statistikk/tid`
- **Branch:** `fase2a-tidsmaling` (bygger på `main`)
- **Status:** klar til bygging (06.11.2026, prosjektleder)
- **Dato:** 06.11.2026
- **Støtter hovedmål:** Tid: dette er målestokken for hovedmålet «50 % mindre tid». Uten den kan ingen si om EzProp sparer tid mot IVIT. Reklamasjoner: ikke direkte. KI først: se under.

## Problem
Hovedmålet er 50 % mindre tid per rapport, målt mot IVIT (Ståle 28.10.2026). Hendelsesloggen gir tidspunkter, men ikke hvor lenge noen faktisk har jobbet (domenemodellen 4.13). Ståle har målt tiden i IVIT for hånd på 10 oppdrag. Lar vi være, har vi ingen tall å sammenligne med når betaen starter, og første ekte rapporter går tapt som måling.

## KI først
Ikke KI, men automatikk: tiden måles uten at takstmannen gjør noe. Takstmannen fører ingen timer. Senere kan KI bruke tallene til å vise hvor tiden går (for eksempel at kontorarbeidet tar mest tid), men det er ikke med nå.

## Brukerhistorier
- Som **takstmann** vil jeg **at tiden måles av seg selv mens jeg jobber i oppdraget** slik at **jeg slipper å føre timer**.
- Som **leder** vil jeg **se samlet tid per fase for ferdige oppdrag, ved siden av nullpunktet fra IVIT** slik at **jeg ser om vi nærmer oss målet**.
- Som **admin** vil jeg **legge inn nullpunktet fra IVIT og kunne slå målingen av** slik at **sammenligningen blir riktig og vi kan stoppe målingen om de ansatte ønsker det**.

## Omfang
**Med:**
1. **Tabell `work_sessions`** (migrering `0022_tidsmaling.sql` via `pnpm db:generate`):
   - `id`, `organization_id`, `assignment_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, assignment_id)` → `assignments`), `employee_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, employee_id)` → `employees`), `phase` (tekst, CHECK `preparation`, `inspection`, `office`, `delivery`), `started_at`, `ended_at` (påkrevd, CHECK `ended_at >= started_at`), `source` (tekst, CHECK bare `auto` nå), `created_at`, `updated_at`, `deleted_at`.
   - Indeks `(organization_id, assignment_id, employee_id, ended_at)` for oppslaget i punkt 3 og summeringen i punkt 4.
   - `report_id` og `device_id` legges ikke inn ennå: tabellene `reports` og `devices` finnes ikke (A120).
2. **Fasen regnes ut fra oppdraget** i en ren funksjon `phaseForAssignment({ status, inspectionAt }, now)` (A119):
   - `ordered` → `preparation`.
   - `in_progress`: befaringsdato tom eller senere enn dagen i dag (Oslo-tid, `todayInOslo`) → `preparation`; samme dag som befaringen → `inspection`; etter befaringsdagen → `office`.
   - `completed` og `invoiced` → `delivery`.
   - Statusendring og endret befaringsdato gir dermed ny fase ved neste aktivitet. Det er slik økten følger statusendringene.
3. **Automatisk registrering** `recordWorkActivity(actor, organizationId, assignmentId, now = new Date())` i `src/core/work-sessions`:
   - Tilgang `organization.read` via `requireOrganizationAccess`. Oppdraget hentes med `grant.organizationId`; finnes det ikke, eller er det kansellert (slettet), gir det `NotFoundError` / ingen økt.
   - Gjør ingenting når innstillingen `time_tracking.enabled` i `organizations.settings` er av (A121). Standard: på.
   - I én transaksjon med oppdragsraden låst (`FOR UPDATE`): finn den ansattes siste økt på oppdraget som ikke er slettet. Er `ended_at` høyst 10 minutter før `now` og fasen er den samme → sett `ended_at = now`. Ellers → ny rad med `started_at = ended_at = now`, `source = auto`.
   - Pausen på 10 minutter er en konstant i kjernen (`IDLE_GAP_MINUTES = 10`), domenemodellen 4.13.
   - Ingen hendelse og ingen revisjonslogg per aktivitet (for mye støy).
4. **Måleren på siden:** en liten klientkomponent `WorkSessionTracker` på `/oppdrag/[id]` og `/oppdrag/[id]/bygninger`. Den kaller en serverhandling (eller `POST /api/oppdrag/[id]/aktivitet`) én gang når siden åpnes, og deretter høyst én gang per 60 sekunder, men bare når fanen er synlig og det har vært tastatur-, mus- eller berøringsaktivitet siden forrige kall. Ingen synlig del på skjermen. Feil i kallet vises ikke og stopper ikke siden.
5. **Samlet visning `/statistikk/tid`** for leder og admin (ny rettighet `statistics.read`, gis til `manager`; admin har alle):
   - `getTimeStatistics(actor, organizationId, { from, to })` summerer `ended_at - started_at` for økter som ikke er slettet, på oppdrag med status `completed` eller `invoiced` som ble opprettet i perioden (A122), gruppert **bare per fase**. Ingen gruppering eller filter på ansatt, og `employee_id` returneres aldri (arbeidsmiljøloven kapittel 9, `docs/06-arkitektur.md`).
   - Tabell: fase, snitt minutter per oppdrag, antall oppdrag, og nullpunktet fra IVIT i egen kolonne med forskjell i prosent. Rad «Totalt». Periode som to datofelt, standard siste 365 dager.
   - Tekst over tabellen: «Tiden måles automatisk mens oppdraget er åpent. Tallene vises bare samlet, aldri per person.»
   - Lenke i menyen bare for dem som har `statistics.read`.
6. **Nullpunktet, det enkleste som virker (A123):** admin legger inn minutter per fase fra IVIT, antall oppdrag målingen bygger på, og kilde (fritekst, høyst 200 tegn) i et lite skjema på samme side. Lagres i `organizations.settings` under `time_tracking.baseline` (Zod: heltall 0–10 000 per fase, antall 1–10 000). Revisjonslogg `organization.settings` med feltnavn. Samme skjema har bryteren «Mål tid» (`time_tracking.enabled`) med teksten «Slå av hvis de ansatte ikke ønsker måling (arbeidsmiljøloven kapittel 9).» Begge krever `organization.manage`.
7. **Tester** (testskriver). Alle tester som avhenger av tid, sender inn fast `now`.
   - Enhet: `phaseForAssignment` for alle fire statuser, befaring i går, i dag, i morgen og tom, og befaring rett før og etter midnatt Oslo-tid. Baseline-skjemaet: grensene 0 / 10 000 / 10 001 og negative tall.
   - Kjernen: første aktivitet lager økt; aktivitet etter 9 min 59 s forlenger; etter 10 min 1 s lager ny økt; ny fase etter statusendring lager ny økt selv innen 10 minutter; to ansatte på samme oppdrag får hver sin økt; to samtidige kall gir én økt (låsen); måling av gir ingen rad; kansellert oppdrag gir ingen rad; slettet økt tas ikke med.
   - Statistikk: summer og snitt per fase med oppdiktede økter; oppdrag som ikke er ferdige telles ikke; perioden virker; svaret har ingen felt med ansatt; takstmann og kontor får `AccessDeniedError`; leder og admin får lov; bare admin kan lagre nullpunkt og bryter.
   - Tenant-isolasjon: `expectTenantIsolation` for `recordWorkActivity`, `getTimeStatistics` og lagring av nullpunktet. `work_sessions` føres i `tests/tenant-tables.ts` med radbygger, og `createWorkSession` legges i `tests/factories.ts`. Fremmednøkkeltest: databasen nekter `assignment_id` og `employee_id` fra en annen organisasjon.
   - e2e (PC og iPad-størrelse), `e2e/fase-2a-tidsmaling.spec.ts`: takstmann åpner et oppdrag og aktivitet blir registrert (sjekk via statistikken etter at oppdraget er satt til ferdig, eller via en testhjelper); leder ser `/statistikk/tid` uten navn på personer; takstmann ser ikke menylenken og får «ingen tilgang» på siden; admin lagrer nullpunkt og ser forskjellen i prosent.
8. **Dokumenter og versjon:** `docs/05-domenemodell.md` (4.13 «Bygget i fase 2a»: `work_sessions` uten `report_id`/`device_id`, `baseline_metrics` erstattet av innstillingen inntil videre; endringsloggen), ordlisten (`work session`, `phaseForAssignment`, `statistics.read`, `time_tracking.enabled`, `time_tracking.baseline`), rettighetsmatrisen (`statistics.read` for leder og admin), `docs/personvern/intern-personvernerklaering.md` avsnittet om tidsmåling (hva som lagres, at det vises samlet, bryteren), planen krysses av, `package.json` 0.3.5 → 0.3.6, A119–A123 i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Tabellen `baseline_metrics` og import av nullpunkt fra fil. Nullpunktet er fem tall i innstillingene til tabellen trengs (også for reklamasjoner).
- Visning, filter eller eksport per person, og «min egen tid». Krever enighet med de ansatte (arbeidsmiljøloven kapittel 9).
- Manuell føring eller retting av økter (`source = manual`), og skjerm for å se enkeltøkter.
- `report_id` og `device_id` (kommer når rapporter og enheter finnes), måling på iPad og uten nett (fase 2b).
- Fordeling per rapporttype (bare én rapporttype finnes). Kolonnen kommer med rapportene.
- Måling på andre sider enn oppdragssiden og bygningssiden (ordre, kontakter, arbeidskø). Rapportsidene får måleren når de bygges.
- Fase «levering» fra publisering eller sending (finnes ikke ennå). Til da er levering = status ferdig eller fakturert (A119).
- Grafer, KI-analyse av tiden og varsler.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ingenting (tiden måles) | – |
| kontor | Ingenting (tiden måles) | – |
| leder | `/statistikk/tid`, bare samlet per fase | – |
| admin | `/statistikk/tid` | Nullpunkt og bryteren «Mål tid» |

Alle som har `organization.read` og åpner et oppdrag, får tiden målt når bryteren er på.

## Data
- Ny tabell `work_sessions` (punkt 1), med organisasjons-ID, myk sletting og tenant-test.
- Nye nøkler i `organizations.settings`: `time_tracking.enabled` (boolsk, standard på) og `time_tracking.baseline` (`{ preparation, inspection, office, delivery, sampleSize, source }`).
- Ny rettighet `statistics.read`.
- Faste koder: fasene `preparation`, `inspection`, `office`, `delivery`; `source` `auto`.

## Skjermer
- Oppdragssiden og bygningssiden: ingen endring som synes.
- `/statistikk/tid`: én tabell og to datofelt. For admin et lite skjema under tabellen. PC og iPad-størrelse.
- Trykk for takstmannen: 0 (før: føre tid for hånd, slik Ståle gjør i IVIT).

## Regler
Ingen TG-regler. Faseregelen (punkt 2) er en ren funksjon med testsaker.

## Akseptkriterier
- [ ] Åpner en takstmann et oppdrag og jobber i det, lagres en økt med riktig fase uten at takstmannen gjør noe.
- [ ] Pause over 10 minutter eller ny fase gir ny økt; aktivitet innen 10 minutter forlenger økten.
- [ ] Fasen følger status og befaringsdato etter regelen i punkt 2.
- [ ] Leder og admin ser snitt minutter per fase for ferdige oppdrag, og nullpunktet med forskjell i prosent. Ingenting vises per person.
- [ ] Takstmann og kontor ser ikke statistikken (test og e2e).
- [ ] Admin kan lagre nullpunktet og slå målingen av; av betyr at ingen nye økter lagres.
- [ ] Økter slettes aldri permanent (`deleted_at`).
- [ ] Bruker i annen organisasjon får ikke tilgang (test), og `work_sessions` står i `tests/tenant-tables.ts`.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A119** Fasen regnes ut fra status og befaringsdato (punkt 2), ikke valgt av takstmannen. Grunn: null trykk (tidsmålet), og befaring på PC skjer ikke i fase 2a. Kilde: domenemodellen 4.13, hovedmål 28.10.2026, statusflyten (A74–A77). Endres i `phaseForAssignment`; levering flyttes til publisering når den finnes.
- **A120** `report_id` og `device_id` venter til tabellene finnes; økten knyttes til oppdraget. Kilde: domenemodellen 4.13. Endres med en migrering som legger til kolonnene.
- **A121** Målingen er på som standard, med bryter for admin. Grunn: bare Ståle bruker systemet i betaen og er med i målingen (svar 27, 27.10.2026), og tallene vises bare samlet (`docs/06-arkitektur.md`). Før flere tas med, drøfter Ståle målingen med de ansatte. Endres med bryteren.
- **A122** Statistikken teller bare ferdige og fakturerte oppdrag, og perioden gjelder datoen oppdraget ble opprettet (enkleste som virker, siden `status_changed_at` ikke finnes). Kilde: A74–A77. Endres i `getTimeStatistics`.
- **A123** Nullpunktet lagres som innstilling (minutter per fase, antall, kilde) og ikke i tabellen `baseline_metrics` ennå. Grunn: «det enkleste som trengs for sammenligning»; tabellen kommer når nullpunktet for reklamasjoner også skal inn. Kilde: domenemodellen 4.13, LES-MEG-kartlegging (Ståles måling i IVIT, 10 oppdrag).

## Åpne spørsmål
- Ståle har tallene fra sin måling i IVIT (10 oppdrag). De legges inn i skjemaet når han er tilbake (føres under «Trenger Ståle når han er tilbake»).
- Drøfting med de ansatte før flere enn Ståle måles (står allerede i `docs/06-arkitektur.md`).
