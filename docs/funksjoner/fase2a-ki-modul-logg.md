# Funksjon: KI-modulen og loggen

- **Fase:** 2a-1 KI-grunnmuren (andre punkt)
- **Modul:** kjerne (`src/core/ai`), tabell i `src/db/schema`, leverandørkode i `src/core/integrations/ports.ts`
- **Status:** utkast
- **Branch:** `fase2a-ki-modul-logg`
- **Bygger på:** `fase2a-adr-ki-i-bunnen` (ADR 0006, ikke merget ennå)
- **Grunnlag:** `docs/adr/0006-ki-i-bunnen.md` del 1, 3, 4, 5 og «Avgrensning for 2a-1» under Konsekvenser. `docs/05-domenemodell.md` 4.12.
- **Støtter hovedmål:**
  - **KI i bunnen:** bygger den ene veien inn til KI og loggen som viser nytten. Alle KI-funksjoner i 2a-2 og senere bygges oppå denne.
  - **De ansatte:** alt kan bygges og prøves mot en falsk leverandør, så de ansatte får prøvd KI-forslag i testmiljøet uten kostnad og uten at data sendes ut.
  - **Reklamasjoner:** loggen viser hvem som godtok hvilket forslag, og når. Det er grunnlaget for sperren mot publisering med KI-tekst som ikke er godkjent (neste punkt).

## Problem
ADR 0006 beskriver KI-grunnmuren på papir. Ingen kode finnes. Uten modulen, tabellen og den falske leverandøren kan ingen av de neste punktene (forslagsmønsteret, vask, evalueringssett, kø) eller KI-funksjonene i 2a-2 bygges eller prøves. Lar vi være, vil hver funksjon lage sin egen vei til KI.

## KI i bunnen
- **Oppgaven er KI-grunnmuren i kode.** All KI går gjennom `src/core/ai` med to funksjoner: `requestSuggestion(grant, request)` og `recordDecision(grant, usageId, decision)`. Begge tar `EmployeeGrant` fra `requireOrganizationAccess`, aldri en organisasjons-ID fra kalleren.
- **Data som lagres for KI:** én rad i `ai_usage_log` per kall: funksjon, leverandør, modell, ledetekstversjon, mål (`target_ref`), hvilke felt som var grunnlaget (bare koder), utfall, forslaget, status (foreslått, godtatt, endret, avvist), hvem som avgjorde og når, mengde og kostnad. Dette er grunnlaget for å måle nytten og for læring i 3a.
- **Ingen ekte KI kjører.** Bare den falske leverandøren `fake`, med null kostnad og uten nettverkskall.
- KI setter aldri TG, publiserer aldri og sender aldri (ADR 0006 del 7). Ingenting i denne oppgaven gjør noe av det.

## Brukerhistorier
- Som **utvikler** vil jeg kalle `requestSuggestion` og `recordDecision` fra `src/core/ai`, slik at hver ny KI-funksjon bygges likt og logges.
- Som **takstmann** vil jeg at forslaget jeg godtar, endrer eller avviser, blir registrert med mitt navn fra innloggingen, slik at det alltid er klart hva som er KI og hva som er mitt.
- Som **Ståle** vil jeg at alt kan prøves uten kostnad før jeg velger leverandør (S8).

## Omfang
**Med:**
1. **Tabellen `ai_usage_log`** (skjema i `src/db/schema/ai-usage-log.ts` og migrering), med feltene i ADR 0006 del 5:
   - felles kolonner fra `src/db/schema/common.ts` (`organization_id`, sporingsfelt, `deleted_at`/`deleted_by`, `row_version`)
   - `id` er forespørselens UUID fra kalleren (`requestId`)
   - `employee_id`, `feature`, `provider`, `model`, `prompt_version`, `assignment_id` (kan være tom), `report_id` (kan være tom), `target_ref` (jsonb: type, id, feltkode), `source_fields` (bare feltkoder), `input_summary` (bare feltnavn og antall, aldri tekst), `outcome`, `error_code`, `output_text`, `status`, `decided_by`, `decided_at`, `tokens_in`, `tokens_out`, `cost`, `currency`, `retain_until` (10 år)
   - sammensatte fremmednøkler med `organization_id` til `employees` (både `employee_id` og `decided_by`) og `assignments`
   - sjekk i databasen: `status` og `output_text` er tomme når `outcome` ikke er `ok`, og `status` er satt når `outcome` er `ok`
   - ført i `tests/tenant-tables.ts` med radbygger og testfil
2. **`src/core/ai`** med offentlig flate i `index.ts` (typene og de to funksjonene fra ADR 0006 del 1):
   - `requestSuggestion`: sjekker at funksjonen finnes, at `ai.enabled` er på, at den ansatte har rettigheten funksjonen krever, og at alle feltkoder i `fields` står på funksjonens tillatt-liste (ukjent felt gir feil, ingen rad, ingen kall). Er KI av: svaret `disabled`, ingen rad. Finner leverandøren, bygger ledeteksten, kaller leverandøren og skriver én rad. Samme `requestId` på nytt gir svaret fra første gang uten nytt kall; en id som finnes hos en annen organisasjon eller ansatt, avvises. Nytt forslag på samme mål setter det forrige til `rejected` hvis det fortsatt var `suggested`.
   - `recordDecision`: `accepted`, `edited`, `rejected` og `undo` (tilbake til `suggested`, `decided_by` og `decided_at` tømmes). Bare på rader med utfall `ok` i egen organisasjon. Krever samme rettighet som å be om forslaget. `decided_by` settes fra `grant`. Hver statusendring skrives i `audit_log` med bare id, gammel og ny status.
   - Alle spørringer filtrerer på `grant.organizationId`.
3. **Én funksjonsdefinisjon:** `language_polish` (prøvefunksjonen i «Ferdig når» for 2a-1): fast kode, rettighet (`report.edit`), tillatt-liste med én feltkode for teksten, ledetekstversjon `language_polish.v1`. Ledeteksten er en kort, egen formulering i `src/core/ai`. Treffgrense står i definisjonen, men brukes ikke før evalueringssettet bygges.
4. **Falsk leverandør `fake`** (`AiProvider` fra ADR 0006 del 2): forutsigbare svar, null kostnad, ingen nettverkskall. Samme inndata gir samme svar. Faste prøveverdier gir `no_match` og `error`, slik at alle utfall kan prøves. `fake` føres i `PROVIDERS_BY_PORT.ai`.
5. **Valg av leverandør:** aktiv rad i `integration_connections` med `port = ai`. Uten aktiv rad: `fake` i utvikling og test (`NODE_ENV` er ikke `production`), ellers er KI av. Leverandøren velges aldri fra miljøvariabler.
6. **Seed:** slår på `ai.enabled` i `organizations.settings` og lager en aktiv tilkobling med `fake` for Byggcon i utvikling og test. Tåler å kjøres to ganger. `start.sh` oppdateres hvis oppsettet endres.
7. **Lint-regel og statisk test** (mønster fra `src/core/integrations/static-checks.test.ts`): bare `src/core/ai` bruker portene `ai` og `speech_to_text`; ingen `.delete(` på `aiUsageLog`; ledetekst, inndata og svar skrives aldri til `logger`; `src/core/ai` importerer ikke fra moduler (regel 4).
8. **Ingen logging av innhold:** feil fra leverandøren logges bare med funksjon, leverandørkode, `error_code` og id.
9. `docs/05-domenemodell.md` (4.12 og ordlisten) oppdateres om noe avviker fra ADR-en. Versjon i `package.json` økes (minor: ny tabell og ny kjernemodul).

**Ikke med (bevisst utelatt):**
- Ingen skjermer, knapper eller visning av forslag (neste punkt: forslagsmønsteret).
- Ingen ekte leverandør, ingen SDK, ingen nøkkel (S8).
- Ingen admin-skjerm for KI av/på eller tilkobling. Settes bare med seed.
- Ingen vask av fritekst (mønstre og kjente verdier). Bare tillatt-listen som avviser ukjente felt. Vasken er eget punkt.
- Ingen evalueringssett eller `pnpm ai:eval` (eget punkt).
- Ingen KI-kø (eget punkt).
- Ingen sperre på `settings.features` (etter S8).
- Ingen samlede tall eller visning for leder og admin, og ingen spørring per ansatt (spørsmål 57).
- Ingen publiseringssperre og ingen `ai_usage_id` på andre tabeller (kommer med forslagsmønsteret og når tabellene bygges).
- Ingen fremmednøkkel til `reports`: tabellen finnes ikke ennå. `report_id` er en tom-bar uuid uten fremmednøkkel til `reports` bygges (A158).
- Tale til tekst (2b). Porten `speech_to_text` sperres bare i lint og statisk test.

## Tilgang
Ingen ny rettighet (A156). All tilgang sjekkes i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Egne forslag via `requestSuggestion`-svaret | Be om og avgjøre forslag der de har `report.edit` (for `language_polish`) |
| kontor | Ingenting for `language_polish` | Ingenting for `language_polish` (mangler `report.edit`) |
| leder | Som takstmann der rollen har `report.edit` | Som takstmann |
| admin | Som takstmann; stenges aldri ute | Som takstmann |

## Data
- Ny tabell `ai_usage_log` (se Omfang 1). Oppdater `docs/05-domenemodell.md` 4.12 hvis noe avviker.
- Ny innstilling: `ai.enabled` i `organizations.settings` (standard av).
- Nye faste koder: funksjon `language_polish`, leverandør `fake` (port `ai`), ledetekstversjon `language_polish.v1`, utfall `ok`/`no_match`/`error`, status `suggested`/`accepted`/`edited`/`rejected`, feilkoder `timeout`/`rate_limited`/`unavailable`/`rejected`/`unknown`.
- Tabellen regnes som personopplysninger (A157): myk sletting, `retain_until` 10 år.

## Skjermer
Ingen.

## Regler
Ingen fagregler. Tillatt-listen per funksjon er data i funksjonsdefinisjonen, med test.

## Akseptkriterier
- [ ] Migreringen lager `ai_usage_log` med feltene over, sammensatte fremmednøkler og sjekken for utfall og status (skjematest).
- [ ] `requestSuggestion` mot `fake` gir et forslag med status `suggested` og skriver én rad med funksjon, leverandør, modell, ledetekstversjon, kostnad 0 og `source_fields` uten verdier.
- [ ] De faste prøveverdiene gir `no_match` og `error`; da er `status` og `output_text` tomme, og `error_code` er en fast kode.
- [ ] Et felt som ikke står på tillatt-listen, gir feil: ingen rad og intet kall til leverandøren (test med spion på `fake`).
- [ ] KI av (`ai.enabled` av): svaret er `disabled`, ingen rad, intet kall. Forslag som finnes, kan fortsatt avgjøres og angres.
- [ ] Samme `requestId` to ganger gir samme svar, én rad og ett kall. Samme id fra en annen ansatt eller organisasjon avvises.
- [ ] Nytt forslag på samme mål setter det forrige `suggested`-forslaget til `rejected`.
- [ ] `recordDecision` støtter `accepted`, `edited`, `rejected` og `undo`; `decided_by` kommer fra `grant`; hver endring står i `audit_log` uten forslagstekst.
- [ ] Rolle uten `report.edit` (kontor) får avslag på både `requestSuggestion` og `recordDecision` for `language_polish`. Admin får det til.
- [ ] Bruker i annen organisasjon får ikke tilgang: `expectTenantIsolation` for hver spørring, og `ai_usage_log` står i `tests/tenant-tables.ts`.
- [ ] Ingen sletting: statisk test mot `.delete(` på `aiUsageLog`; myk sletting virker.
- [ ] Bygg for drift uten aktiv tilkobling gir `disabled`; miljøvariabler kan ikke velge leverandør (test).
- [ ] Lint-regel og statisk test stopper bruk av portene `ai` og `speech_to_text` utenfor `src/core/ai` (test med en fil som bryter regelen).
- [ ] Ledetekst, inndata og svar skrives aldri til `logger` (test på feilveien).
- [ ] Seed slår på `ai.enabled` og lager tilkoblingen med `fake`, og tåler å kjøres to ganger.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Ingen ny avhengighet.
- [ ] Virker på iPad-størrelse (e2e): ikke relevant, ingen skjerm.

## Beslutninger tatt i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A158:** `report_id` får ingen fremmednøkkel før `reports` er bygget; den legges til i samme oppgave som bygger `reports`. **Lett å endre.**
- **A159:** Første funksjonsdefinisjon er `language_polish` med rettigheten `report.edit` og én feltkode på tillatt-listen. Ledeteksten er en kort egen formulering, versjon `language_polish.v1`. **Lett å endre.**

## Åpne spørsmål
- Ingen nye. Spørsmål 54–58 (personvern) står fortsatt til Ståle og stopper ikke denne oppgaven, fordi bare `fake` brukes.

## Roller
- **utvikler** (to i parallell): (a) tabell, migrering, `tests/tenant-tables.ts`, seed; (b) `src/core/ai` (funksjonsdefinisjon, `fake`, valg av leverandør, de to funksjonene), lint-regel og statisk test.
- **testskriver:** testplan `docs/funksjoner/fase2a-ki-modul-logg-testplan.md` og testene etter akseptkriteriene.
- **sikkerhet-personvern:** gjennomgang av tenant-isolasjon, tillatt-liste, ingen innhold i logger, ingen leverandør fra miljøvariabler.
- Ikke med: arkitekt (ADR 0006 er skrevet), UX, UI, fag.
