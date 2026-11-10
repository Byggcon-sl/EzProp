# Funksjon: KI-modulen og loggen

- **Fase:** 2a-1 KI-grunnmuren (punkt 1 etter ADR 0006)
- **Modul:** kjerne / `src/core/ai`
- **Status:** utkast
- **Branch:** `fase2a-ki-modul-logg` (bygger på `main`)
- **Grunnlag:** ADR 0006 (`docs/adr/0006-ki-i-bunnen.md`), beslutningene A148–A157, «KI i bunnen» i `docs/07-utviklingsplan.md`, `docs/05-domenemodell.md` 4.10 og 4.12, liten oppgave (ad) i `docs/agenter/tilstand.md`
- **Støtter hovedmål:** KI i bunnen: én vei inn for all KI og en logg som viser hva KI foreslo og hva den ansatte gjorde, fra første dag. De ansatte: alt kan bygges og prøves uten kostnad og uten at noe sendes ut. Reklamasjoner: loggen viser hvilke tekster som kom fra KI og hvem som godkjente dem, og KI kan aldri sette TG.

## Problem
Alle KI-funksjonene i 2a-2 og senere (frasebank, språkvask, sammendrag, diktat) trenger samme grunnmur: ett sted der personvern og tilgang sjekkes, ett sted der leverandøren byttes, og én logg. Uten den bygger hver funksjon sin egen vei, og vi kan ikke vise at KI hjelper eller at ingen persondata går ut. Uten en falsk leverandør kan ingenting prøves før Ståle har valgt leverandør og sagt ja til kostnaden (S8).

## KI i bunnen
- **Hva KI gjør fra første dag:** ingenting ekte. Modulen kjører bare mot den falske leverandøren (`fake`): forutsigbare svar, null kostnad, ingen nettverkskall. Prøvefunksjonen `language_polish` (språkvask av én setning) defineres, slik at hele veien kan prøves i neste punkt (forslagsmønsteret).
- **Data som lagres for KI:** én rad i `ai_usage_log` per kall: funksjon, leverandør, modell, ledetekstversjon, mål (type, id, feltkode), feltkodene som var grunnlaget (aldri verdiene), utfall, forslagstekst, status (foreslått, godtatt, endret, avvist), hvem som avgjorde og når, mengde og kostnad. Dette er grunnlaget for nytte- og kostnadstall og for læring i fase 3a.
- **Alt gjennom `src/core/ai`:** de to funksjonene `requestSuggestion` og `recordDecision` er eneste vei inn. Bare `src/core/ai` kan bruke porten `ai`. Håndheves med lint-regel og statisk test.

## Brukerhistorier
- Som **utvikler av en KI-funksjon** vil jeg **be om et forslag med én funksjon og få et forutsigbart svar fra den falske leverandøren** slik at **funksjonen kan bygges og testes uten kostnad**.
- Som **takstmann** vil jeg **at mitt valg (godta, endre, avvise, angre) blir lagret med meg som avgjører** slik at **det alltid er klart at jeg har siste ord**.
- Som **admin** vil jeg **at KI er av til den er slått på, og at en ekte leverandør aldri kan velges fra miljøet** slik at **ingen data sendes ut ved en feil**.

## Omfang
**Med:**
- `src/core/ai/index.ts` med `requestSuggestion(grant, request)` og `recordDecision(grant, usageId, decision)` etter ADR 0006 del 1. Begge tar `EmployeeGrant`; spørringer filtrerer på `grant.organizationId`.
- Funksjonsdefinisjon for `language_polish`: fast kode, rettighet (`report.edit` eller `assignment.edit`), tillatt-liste med feltkoder, ledetekstversjon `v1`, treffgrense. Felt utenfor tillatt-listen gir feil, og ingenting sendes.
- Ledeteksten for `language_polish` versjonert i `src/core/ai` (egen formulering, ingen tekst fra NS 3600, IVIT eller SmartTakst).
- `AiProvider`-grensesnittet og den falske leverandøren `fake`: samme inndata gir samme svar, faste prøveverdier gir `no_match` og `error`, kostnad 0.
- `PROVIDERS_BY_PORT.ai = ["fake"]` i `src/core/integrations/ports.ts`.
- **Én vei til leverandøren** (funn ad-10): leverandøren kommer bare fra en aktiv rad i `integration_connections` (`port = ai`), sammen med `ai.enabled = true` i `organizations.settings`. Ingen reserve fra `NODE_ENV` eller miljøvariabler. Mangler en av låsene, er svaret `disabled`, og det lages ingen rad.
- **Seed** (funn ad-5): `pnpm db:seed` slår på `ai.enabled` og lager tilkobling med `fake` bare når `NODE_ENV` ikke er `production`. I drift lager seed aldri KI-tilkobling eller slår på KI. Test for begge.
- Tabellen `ai_usage_log` med migrering etter ADR 0006 del 5: `organization_id`, felles kolonner (myk sletting, `row_version`), `employee_id`, `feature`, `provider`, `model`, `prompt_version`, `assignment_id`, `report_id`, `target_ref`, `source_fields`, `input_summary`, `outcome`, `error_code`, `output_text`, `status`, `decided_by`, `decided_at`, `tokens_in`, `tokens_out`, `cost`, `currency`, `retain_until` (10 år). Sammensatte fremmednøkler med `organization_id` til `employees` og `assignments`. `report_id` får ingen fremmednøkkel før tabellen `reports` finnes.
- **Samme id gir ikke nytt kall:** `requestId` (UUID v7) blir radens id. Nytt forsøk med samme id i samme organisasjon og av samme ansatt gir svaret fra første gang. Finnes id-en hos en annen organisasjon eller ansatt, avvises forespørselen.
- **Status og angre** (funn ad-2): `recordDecision` setter `accepted`, `edited` eller `rejected` med `decided_by` og `decided_at` fra `grant`. `undo` setter raden tilbake til `suggested` og tømmer `decided_by`/`decided_at`, også fra `rejected`. **Nytt forslag avviser ikke det gamle automatisk**; det gamle blir stående som `suggested` (gir rene tall, og sperren trenger det ikke). Hver statusendring skrives i `audit_log` med bare id, gammel og ny status.
- **Sperret forespørsel** (funn ad-1): fritekst uten oppdrag mot en leverandør som ikke er `fake` gir svaret `{ kind: "blocked" }`, uten rad og uten kall, og er dermed skilt fra `disabled`. Kan ikke skje før en ekte leverandør finnes, men koden og testen legges nå.
- Leverandørfeil logges med `logger` bare med funksjon, leverandørkode, `error_code` og id. Ledetekst, inndata og svar skrives aldri til `logger`.
- Lint-regel og statisk test: bare `src/core/ai` importerer `src/core/ai/providers` og bruker porten `ai`; `src/core/ai` importerer aldri fra `src/modules`; klientdelen importerer aldri leverandører, nøkler eller `readSecret`.
- `ai_usage_log` i `tests/tenant-tables.ts`, `expectTenantIsolation` for hver spørring, tester per rolle (takstmann, kontor, leder, admin), admin ikke stengt ute, myk sletting.
- ADR 0006 rettet for funnene ad-1, ad-2, ad-10, ad-11 (detaljtypene i ADR-en er retning; koden er fasit) og ad-12 (dobbel parentes om `PROVIDER_CODES.ai`). Domenemodellen 4.12 og ordlisten oppdatert (`blocked`, `fake`, `AiProvider`).
- Rad om `ai_usage_log` i den interne personvernerklæringen (ADR 0006 del 5).
- Versjon én patch over `main` (0.4.4 → 0.4.5).

**Ikke med (bevisst utelatt):**
- Visning av forslag, knappene «bruk, behold, nytt forslag», angre i skjermen, merking av KI-tekst og publiseringssperren (neste punkt: forslagsmønsteret; funn ad-6 tas der).
- Vask med mønstre og oppdragets kjente verdier (punktet «Vask før KI»; funn ad-3, ad-4 og ad-7 tas der). Her håndheves bare tillatt-listen, og bare `fake` finnes.
- Evalueringssett og `pnpm ai:eval` (eget punkt).
- KI-kø på iPaden (eget punkt, brukes i 2b).
- Ekte leverandør, adaptere, nøkler, `readSecret` for KI og sperren `settings.features` (etter S8; funn ad-9 er dermed utsatt, ikke bygget).
- Admin-skjerm for KI av/på og leverandør, samlede tall for leder og admins oppslag av én rad (funn ad-8 tas når tallene bygges).
- `ai_usage_id` på andre tabeller (kommer når hver tabell bygges).
- Tale til tekst (`speech_to_text`) og bilder (fase 2b).
- Ingen nye avhengigheter (UUID v7 lages med det som finnes, eller i Postgres). Ingen kostnad.

## Tilgang
Ingen ny rettighet (A156). Tilgang sjekkes i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Egne forslag på oppdrag de kan endre | Be om og avgjøre forslag der de har `report.edit` eller `assignment.edit` |
| kontor | Samme, der de har `assignment.edit` | Samme |
| leder | Ingenting per ansatt i denne oppgaven | Forslag i reklamasjonssaker (`claims.manage`) når slike funksjoner kommer |
| admin | Ingen visning i denne oppgaven; aldri stengt ute fra å avgjøre der admin har rettigheten | KI av/på og tilkobling via seed/data (`organization.manage`); skjermen kommer senere |

## Data
- Ny tabell `ai_usage_log` (se omfang), i `tests/tenant-tables.ts`. Migrering `0025_ki-modul-logg`.
- `organizations.settings` får nøkkelen `ai.enabled` (standard av).
- `PROVIDERS_BY_PORT.ai`: ny fast kode `fake`.
- Faste koder: `language_polish`; status `suggested`, `accepted`, `edited`, `rejected`; utfall `ok`, `no_match`, `error`; svartype `blocked`.
- Oppdater `docs/05-domenemodell.md` 4.12 og ordlisten.

## Skjermer
Ingen. Skjermene kommer i forslagsmønsteret.

## Regler
Ingen TG-regler. KI kan aldri ha et TG-felt som mål: en funksjonsdefinisjon med TG-felt på tillatt-listen eller som mål gir feil (test).

## Akseptkriterier
- [ ] `requestSuggestion` med `language_polish` mot `fake` gir et forslag og én rad i `ai_usage_log` med status `suggested`, utfall `ok`, kostnad 0, riktig leverandør, modell og ledetekstversjon.
- [ ] Faste prøveverdier gir `no_match` og `error`; da er `status` og `output_text` tomme, og `error_code` er en fast kode.
- [ ] Samme `requestId` to ganger gir ett kall og én rad. Samme id fra en annen organisasjon eller ansatt avvises.
- [ ] Felt utenfor tillatt-listen gir feil, og leverandøren kalles ikke.
- [ ] KI av (`ai.enabled` av eller ingen aktiv tilkobling) gir `disabled`, ingen rad og ingen kall. Eksisterende forslag kan fortsatt avgjøres og angres.
- [ ] Fritekst uten oppdrag mot en leverandør som ikke er `fake` gir `blocked`, ingen rad og ingen kall.
- [ ] `recordDecision` setter status, `decided_by` og `decided_at` fra `grant`; `undo` setter tilbake til `suggested` (også fra `rejected`); hver endring står i `audit_log` uten forslagstekst.
- [ ] Nytt forslag på samme felt endrer ikke det gamle.
- [ ] Ansatt uten rettighet til feltet får ikke be om eller avgjøre forslag (test per rolle). Admin stenges ikke ute.
- [ ] Bruker i annen organisasjon får verken rader eller tilgang (`expectTenantIsolation` for hver spørring; tabellen i `tests/tenant-tables.ts`).
- [ ] Myk sletting: slettede rader kommer ikke med, og ingenting slettes permanent. `retain_until` er 10 år.
- [ ] Seed slår på KI med `fake` i utvikling og test, aldri i drift (test).
- [ ] En ekte leverandør kan ikke velges fra miljøvariabler (test).
- [ ] Ledetekst, inndata og svar havner aldri i `logger` (test).
- [ ] Lint-regel og statisk test stopper import av leverandørene og porten `ai` utenfor `src/core/ai`, og import fra `src/modules` i `src/core/ai`.
- [ ] Virker på iPad-størrelse (e2e): ingen skjerm i denne oppgaven; eksisterende e2e er grønne.
- [ ] KI-forslag kan godtas, endres og avvises, og logges (test mot falsk leverandør).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne. Versjon 0.4.5.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- A158: Én vei til leverandøren, bare fra `integration_connections` pluss `ai.enabled`; ingen reserve fra `NODE_ENV` (funn ad-10). **Lett å endre.**
- A159: Nytt forslag avviser ikke det gamle automatisk; angre gjelder også avviste forslag (funn ad-2). **Lett å endre.**
- A160: Sperret forespørsel gir eget svar `blocked` uten rad (funn ad-1). **Lett å endre.**
- A161: `report_id` uten fremmednøkkel til `reports` er bygget; nøkkelen legges da. **Lett å endre.**

## Åpne spørsmål
- Ingen nye til Ståle. Spørsmål 54–58 fra ADR 0006 står fortsatt, og ingen av dem stopper dette punktet (bare `fake` brukes).

## Roller
utvikler og testskriver i parallell (biter: 1) skjema, migrering og `usage-log.ts`; 2) leverandørgrensesnitt, `fake`, funksjonsdefinisjon og `requestSuggestion`/`recordDecision`; 3) seed, lint-regel og statisk test), ki-ansvarlig (at ADR 0006 følges, ledetekst og `fake`), sikkerhet-personvern (tenant-isolasjon, logger, ingen vei ut fra miljøet, personvernerklæringen).
