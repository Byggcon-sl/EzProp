# Testplan: KI-modulen og loggen

- **Oppgavekort:** `docs/funksjoner/fase2a-ki-modul-logg.md`
- **Grunnlag:** `docs/adr/0006-ki-i-bunnen.md` del 1–5 og «Avgrensning for 2a-1»
- **Dato:** 10.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **KI i bunnen:** testene låser den ene veien inn til KI (tilgang, tillatt-liste, leverandør bare fra tilkoblingen) og at hvert kall og hver avgjørelse logges likt. Alle KI-funksjoner i 2a-2 arver dette.
  - **De ansatte:** testene viser at alt virker mot `fake` uten kostnad, og at seed gir KI i prøveorganisasjonen uten å røre Byggcon.
  - **Færre reklamasjoner:** testene viser at hvem som godtok hva, og når, alltid står i loggen og i `audit_log`, og at et forslag aldri kan avgjøres av en annen organisasjon.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet (for eksempel teksten «Taket er gammelt og har noen sprekker»). Ingen ekte navn, adresser eller nøkler. Tester som trenger fast tid, bruker `vi.useFakeTimers({ toFake: ["Date"] })` med `vi.setSystemTime(TEST_NOW)`, slik at databaseklienten ikke stopper.

Ingen fagregler og ingen TG. «Regeltestene» er de faste tabellene med testsaker (`it.each`): validering av forespørselen, svarene fra `fake` og tabellen over lovlige statusendringer. Ingen skjerm, så ingen nye e2e-tester (avsnitt 15).

## 0. Avtale om signaturer (utvikler og testskriver)

Fra kortet og ADR 0006 del 1–2. Avvik føres i kortet.

- `@/core/ai` (`index.ts`): `requestSuggestion(grant, request)`, `recordDecision(grant, usageId, decision)` og typene fra ADR 0006 del 1. Ingenting som lister eller teller rader per ansatt.
- Funksjonsdefinisjonen eksporteres for testene, for eksempel `AI_FEATURES` (eller `getFeatureDefinition(code)`) med `code`, `permission`, `allowedFields`, `allowedTargets` (`{ type, fieldKey }[]`), `promptVersion`.
- Falsk leverandør som et objekt testene kan spionere på, for eksempel `fakeAiProvider` i `src/core/ai/providers/fake.ts`, og de faste prøveverdiene som konstanter, for eksempel `FAKE_NO_MATCH_INPUT` og `FAKE_ERROR_INPUT` (en per feilkode eller én med kjent kode), og `FAKE_THROW_INPUT` hvis unntak prøves via inndata. Ellers bruker testen `vi.spyOn(fakeAiProvider, "complete").mockRejectedValue(...)`.
- Feiltyper: `AccessDeniedError` fra `@/core/access` når rettigheten mangler. Én egen feil (for eksempel `AiRequestRejectedError`) med **én fast norsk melding** for alle andre avslag (ukjent funksjon, felt, mål, `reportId`, `candidates`, lengde, `requestId`, oppdrag, id hos en annen) og én (for eksempel `AiDecisionError`) for ugyldig statusendring. Nøytralt betyr: samme klasse og samme melding uansett grunn, så svaret ikke røper om id-en finnes hos en annen.
- Fabrikk `createAiUsageLog(organizationId, overrides)` i `tests/factories.ts` (rå innsetting, standard `outcome = ok`, `status = suggested`, `provider = fake`, `model = fake-v1`, `retainUntil` satt). `ai_usage_log` i `RESET_TABLES` og i `tests/tenant-tables.ts`.
- **Feil i samme transaksjon (6.24):** tjenesten kaller `recordAuditEvent` importert fra `@/core/audit` (ikke fra en fil inne i audit-mappen), og med transaksjonen `tx` som første argument. Testen tvinger feilen med samme mønster som `src/core/orders/orders-transaction.test.ts`: `vi.mock("@/core/audit", async (importOriginal) => ({ ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) }))`, og `vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error("audit nede"))` rett før kallet. Testen ligger i egen fil, `src/core/ai/request-suggestion-transaction.test.ts`, så mocken ikke treffer andre tester. `vi.spyOn` på modulobjektet brukes ikke (det virker ikke med ES-moduler), og heller ikke spion på `db` (tjenesten skriver gjennom `tx`). Testen sjekker også at mocken faktisk ble kalt én gang, så den ikke blir hul.
- Testhjelper (bare i testene) `enableAi(organizationId, { enabled, provider, status, deletedAt })` som setter `settings.ai.enabled` og lager tilkoblingen med `createIntegrationConnection({ port: "ai", provider: "fake" })`.

## 1. Skjema og migrering, `src/db/schema/ai-usage-log.test.ts` (ny, mot databasen)

1. **kolonnene finnes** med riktige typer: `cost` er `numeric` (ikke `real`/`double`), `target_ref`, `source_fields` og `input_summary` er `jsonb`, `retain_until` er `not null`, `report_id` og `assignment_id` kan være tomme.
2. **`employee_id` fra en annen organisasjon** avvises av databasen (sammensatt fremmednøkkel).
3. **`decided_by` fra en annen organisasjon** avvises.
4. **`assignment_id` fra en annen organisasjon** avvises.
5. **`report_id` kan være tom**, og har ingen fremmednøkkel (A158).
6. **sjekken, godtas:** `outcome = ok` med `status = suggested` og `output_text`.
7. **sjekken, avvises** (`it.each`): `ok` uten `status`; `no_match` med `status`; `no_match` med `output_text`; `error` med `status`; `error` med `output_text`.
8. **sjekken, godtas:** `no_match` og `error` med tom `status` og tom `output_text`.
9. **ugyldige koder avvises** hvis det er sjekk eller enum på `outcome`, `status`, `error_code` (en ukjent tekst gir feil).
10. **myk sletting:** `deleted_at` og `deleted_by` finnes; ingen `ON DELETE CASCADE` fra `employees` eller `assignments` som kan fjerne rader.

## 2. Funksjonsdefinisjonen, `src/core/ai/features/*.test.ts` (ny, ren)

Fasiten er skrevet inn i testen, ikke importert fra koden (regel 6).

1. **`language_polish` finnes** med `permission = "report.edit"`, `promptVersion = "language_polish.v1"`, nøyaktig én feltkode på tillatt-listen og nøyaktig ett lovlig mål.
2. **kodene er faste:** listen over funksjonskoder er nøyaktig `["language_polish"]`; ny funksjon uten testsak gjør testen rød.
3. **ingen TG som mål** (for hver definisjon): ingen `allowedTargets.fieldKey` er `tg` eller starter med `tg_`; heller ikke på tillatt-listen.
4. **sperrelisten** (fast i testen, fra ADR 0006 del 6, også i formen `tabell.kolonne` og kolonnenavnet alene): ingen definisjon har et slikt felt på tillatt-listen. Testen prøver også sjekken mot en oppdiktet definisjon i minnet med `email` og `tg_value`, så den ikke kan være hul.
5. **ledeteksten** for `language_polish.v1` finnes, er ikke tom og inneholder ingen av ordene «antas» eller «trolig» (regel 7).

## 3. Falsk leverandør, `src/core/ai/providers/fake.test.ts` (ny, ren, regeltest)

Tabell med testsaker (`it.each`), inndata → forventet svar:

1. **vanlig tekst** → `outcome = ok`, ikke tom tekst, `cost = 0`, `currency = "NOK"`, `tokensIn` og `tokensOut` ≥ 0.
2. **samme inndata to ganger** → nøyaktig samme svar.
3. **ulik inndata** → ulikt svar (forutsigbart, ikke fast tekst for alt).
4. **prøveverdien for ingen treff** → `outcome = no_match`, `cost = 0`.
5. **prøveverdien for feil** → `outcome = error` med `errorCode` i `["timeout", "rate_limited", "unavailable", "rejected", "unknown"]`.
6. **`code` er `"fake"`**, og modellen som brukes, er `fake-v1`.
7. **ingen nettverkskall:** `globalThis.fetch` erstattes med en spion som kaster (`tests/fake-fetch.ts`); alle tilfellene over går gjennom og spionen kalles aldri.

## 4. Validering av forespørselen, `src/core/ai/request.test.ts` (ny, ren, regeltest)

Tabell med testsaker (`it.each`) mot skjemaet (Zod) som `requestSuggestion` bruker. Gyldig utgangspunkt: UUID, `language_polish`, lovlig mål, `fields = { text: "…" }`, `reportId = null`, ingen `candidates`.

1. **gyldig forespørsel** godtas.
2. **`requestId`** som ikke er UUID, tom eller mangler → avvist.
3. **`feature`** ukjent (`"tg_suggest"`, `""`) → avvist.
4. **`target`** med ekstra nøkkel (for eksempel `organizationId`), `id` som ikke er UUID, ulovlig `type`, ulovlig `fieldKey`, `fieldKey = "tg"` og `"tg_value"` → avvist.
5. **`reportId`** satt til en UUID → avvist; `null` godtas.
6. **`candidates`** mangler eller `[]` → godtas; med ett element → avvist.
7. **`fields`**: verdi på 5 000 tegn godtas, 5 001 avvises; felt utenfor tillatt-listen (`email`, `address`) avvises; ikke-tekst-verdi avvises.
8. **ukjente nøkler på toppnivå** (`organizationId`, `employeeId`, `provider`) avvises eller ignoreres; de brukes aldri (vises i avsnitt 6.15).

## 5. Valg av leverandør, `src/core/ai/provider-resolution.test.ts` (ny, mot databasen)

Tabell (`it.each`), alle med en takstmann som har `report.edit`. Forventet svar og at `fake` ikke kalles:

1. `ai.enabled` mangler, aktiv `fake`-tilkobling → `disabled`.
2. `ai.enabled = false`, aktiv tilkobling → `disabled`.
3. `ai.enabled = "true"` (tekst, ikke boolsk) → `disabled`.
4. `ai.enabled = true`, ingen tilkobling → `disabled`.
5. `ai.enabled = true`, tilkobling med status `disabled` → `disabled`.
6. `ai.enabled = true`, mykt slettet tilkobling → `disabled`.
7. `ai.enabled = true`, ukjent leverandørkode (`"openai"`, rå rad via fabrikken) → `disabled`.
8. `ai.enabled = true`, aktiv `fake` → forslag.
9. `ai.enabled = true`, `fake` med status `error` → forslag (som `findActiveConnection`, kortet punkt 7).
10. **miljøvariabel:** `vi.stubEnv("AI_PROVIDER", "fake")` og `vi.stubEnv("NODE_ENV", "development")` uten tilkobling → fortsatt `disabled`; med tilkobling og `AI_PROVIDER = "openai"` → fortsatt `fake`.
11. **i alle `disabled`-tilfellene:** ingen rad i `ai_usage_log`, ingen linje i `audit_log`.
12. **tilkoblingen i en annen organisasjon teller ikke:** B har aktiv `fake` og `ai.enabled`, A har ingenting → A får `disabled`.
13. **innstillingen i en annen organisasjon teller ikke:** B har `ai.enabled = true`, A har aktiv `fake` men `ai.enabled = false` → A får `disabled`.

## 6. `requestSuggestion`, `src/core/ai/request-suggestion.test.ts` (ny, mot databasen)

**Vellykket kall**
1. **forslag:** svaret er `{ kind: "suggestion", usageId = requestId, status: "suggested", text, candidateId: null }`. Én rad med `feature`, `provider = fake`, `model = fake-v1`, `prompt_version = language_polish.v1`, `cost = 0` (som tall eller `"0"`), `currency = NOK`, `employee_id` fra grant, `target_ref` lik målet, `assignment_id` som sendt, `report_id` tom.
2. **`source_fields`** er nøyaktig `["text"]`; **`input_summary`** har bare feltnavn og antall tegn (for eksempel `{ text: 37 }`), ingen tekst.
3. **`retain_until`** er opprettet + 10 år (fast tid `TEST_NOW`), og en egen sak med opprettet 29.02.2028 følger samme regel som `src/core/files/retention.ts`.
4. **`assignmentId = null`** godtas og gir rad med tom `assignment_id`.

**Utfall uten forslag**
5. **ingen treff:** svaret `{ kind: "no_match", usageId }`; raden har `outcome = no_match`, tom `status` og `output_text`.
6. **feil fra leverandøren:** svaret `{ kind: "error", usageId }`; `error_code` er den faste koden fra `fake`.
7. **unntak i leverandøren** (`mockRejectedValue(new Error("hemmelig-markør"))`): svaret `error`, `error_code = unknown`, ingen unntak ut til kalleren, og teksten «hemmelig-markør» finnes ikke i raden eller i `logger`.

**Avslag før kallet** (`it.each`, hver sak: riktig feiltype og melding, `fake` ikke kalt, 0 rader i `ai_usage_log`, 0 nye linjer i `audit_log`)
8. ukjent funksjon; felt utenfor tillatt-listen; ulovlig mål; TG-felt som mål; `reportId` satt; `candidates` med innhold; verdi på 5 001 tegn; ugyldig `requestId`.
9. **ukjent oppdrag** (tilfeldig UUID) og **mykt slettet oppdrag** → samme nøytrale avslag som sakene over (samme klasse og melding), ikke en databasefeil.
10. **oppdrag i en annen organisasjon** → samme nøytrale avslag.

**Samme `requestId` igjen**
11. **etter hverandre:** andre kall gir likt svar, `fake` kalt én gang, én rad, ingen ny linje i `audit_log`.
12. **samtidig** (`Promise.all` med to like kall): én rad, like svar. Antall kall til `fake` sjekkes ikke (A163).
13. **samme id, annen funksjon eller annet mål** (annen `target.id` eller `fieldKey`) → nøytralt avslag; den første raden er uendret.
14. **samme id fra en annen ansatt i samme organisasjon** → nøytralt avslag; raden er uendret og teksten røpes ikke i feilen.
15. **samme id fra en annen organisasjon** → nøytralt avslag; A sin rad er uendret (alle kolonner, også `row_version`), og B får ikke ny rad.
16. **gjentatt kall for et `no_match`- eller `error`-svar** gir samme svar uten nytt kall.
17. **gjentatt kall etter at KI er slått av** gir det lagrede svaret (oppslaget kommer før KI av/på i rekkefølgen). Se avklaring B.
18. **gjentatt kall uten rettighet** (takstmann som har mistet `report.edit`) → `AccessDeniedError`, også når raden finnes.

**Nytt forslag på samme mål**
19. **forrige `suggested`-forslag** på samme mål (laget av en annen takstmann) settes til `rejected`, med `decided_by` = den som ba om det nye og `decided_at` satt; én linje i `audit_log` med bare id, gammel og ny status.
20. **forslag som allerede er `accepted`, `edited` eller `rejected`** røres ikke.
21. **samme mål i en annen organisasjon** (samme `target_ref`-verdier) røres ikke.
22. **mykt slettet `suggested`-forslag** på samme mål røres ikke.
23. **annet mål** (samme type og id, annen `fieldKey`; eller annen id) røres ikke.
24. **samme transaksjon** (i `src/core/ai/request-suggestion-transaction.test.ts`, se avsnitt 0): et `suggested`-forslag finnes på målet; `recordAuditEvent` gir feil én gang (`mockRejectedValueOnce`). Kallet gir feil eller `error`-svar, `recordAuditEvent` er kalt én gang, det forrige forslaget er fortsatt `suggested` (uendret `row_version`, tom `decided_by`), og den nye raden med denne `requestId` finnes ikke.
25. **nytt kall gir `no_match` eller `error`:** det forrige `suggested`-forslaget på samme mål står urørt (fortsatt `suggested`, tom `decided_by` og `decided_at`, uendret `row_version`), og det kommer ingen ny linje i `audit_log`. Den nye raden med `no_match` eller `error` finnes (`it.each` over de to utfallene).

## 7. `recordDecision`, `src/core/ai/record-decision.test.ts` (ny, mot databasen)

**Tabellen over lovlige endringer** (`it.each`, 16 ruter, utgangsrad laget med `createAiUsageLog`):

| Fra \ avgjørelse | `accepted` | `edited` | `rejected` | `undo` |
|---|---|---|---|---|
| `suggested` | → `accepted` | → `edited` | → `rejected` | feil |
| `accepted` | ingen endring | feil | feil | → `suggested` |
| `edited` | feil | ingen endring | feil | → `suggested` |
| `rejected` | feil | feil | ingen endring | → `suggested` |

For hver rute sjekkes:
1. **lov:** ny status, `decided_by = grant.employeeId`, `decided_at` fra serverens klokke, `row_version` økt, én linje i `audit_log` med `changes` lik `{ status: { from, to } }` (eller tilsvarende) og uten `output_text`.
2. **ingen endring:** ingen feil, raden uendret (også `decided_at`), ingen ny linje i `audit_log`.
3. **feil:** riktig feiltype, raden uendret, ingen linje i `audit_log`.
4. **`undo`** tømmer `decided_by` og `decided_at`.
5. **`undo` fra `rejected` når det finnes et nyere `suggested`-forslag på samme mål** → feil. Når det nyere forslaget er mykt slettet → lov. Når det nyere er på et annet mål → lov. Når det nyere har `outcome = no_match` eller `error` → lov. Når det nyere ligger i en annen organisasjon (samme `target_ref`) → lov. Når det andre forslaget er eldre (`created_at` før) → lov. «Nyere» avgjøres på serverens `created_at`, ikke på id-en (avklaring D).
6. **en annen ansatt med `report.edit`** (leder, eller takstmann med innstillingen på) kan avgjøre et forslag en annen ba om; `decided_by` er den som avgjorde.
7. **`decided_by` kan ikke styres:** funksjonen tar ingen ansatt-id; testen viser at verdien er grant sin.
8. **rader med `outcome = no_match` og `error`** → feil, ingen endring.
9. **ukjent `usageId`** og **ugyldig UUID** → nøytralt avslag.
10. **KI av** (`ai.enabled = false`, tilkoblingen slettet) → avgjørelser og angre virker fortsatt.
11. **markør:** `output_text` med en unik markør finnes ikke i noen linje i `audit_log`.

## 8. Tilgang per rolle, `src/core/ai/access.test.ts` (ny, mot databasen)

`it.each` over de fem variantene, for **både** `requestSuggestion` og `recordDecision`. Nekt gir `AccessDeniedError`, ingen rad, ingen endring, `fake` ikke kalt, ingen linje i `audit_log`.

| Variant | Be om | Avgjøre og angre |
|---|---|---|
| takstmann, `access.inspectors_edit_all` på (standard) | ja | ja |
| takstmann, innstillingen av | nei | nei |
| kontor | nei | nei |
| leder | ja | ja |
| admin, innstillingen av | ja | ja |

I tillegg:
1. **admin stenges aldri ute:** admin uten andre roller, med innstillingen av og med `report.edit` ikke gitt som enkeltrettighet, kan både be om og avgjøre.
2. **kontor med enkeltrettigheten `report.edit`** (`grantPermission`) kan be om og avgjøre (rettigheten sjekkes med `grantHasPermission`, ikke på roller).
3. **ansatt som er mykt slettet eller deaktivert** etter at forslaget ble laget: `requireOrganizationAccess` avviser; ingen endring.
4. **rettigheten følger funksjonen på raden:** `recordDecision` slår opp funksjonen fra raden, ikke fra kalleren (statisk: signaturen har ingen `feature`).

## 9. Tenant-isolasjon, ett `expectTenantIsolation` per spørring

Hver spørring får ett kall i testfilen der den testes. `query` lager grant med `requireOrganizationAccess(actor, organizationId, "report.edit")` og kaller tjenesten; radene som returneres, er det tjenesten leste eller endret.

1. **oppslag på `requestId`** (gjentatt kall): `seed` lager forslag i A og B; `query` gjentar kallet med samme id og returnerer raden fra svaret. B sine id-er kommer aldri tilbake.
2. **oppslag av oppdrag:** `seed` lager oppdrag i A og B; `query` ber om forslag med hvert oppdrag og returnerer de godtatte oppdragene. Oppdrag i B gir avslag for A.
3. **settet som avviser forrige forslag:** `seed` lager `suggested`-forslag på samme `target_ref` i A og B; `query` lager nytt forslag og returnerer radene som ble `rejected`. Bare egne.
4. **lesing og endring i `recordDecision`:** `seed` lager forslag i A og B; `query` prøver å godta hvert og returnerer radene som ble endret. B sine er urørt etter at A har prøvd.
5. **lesing av `ai.enabled`:** `seed` slår KI på og lager `fake`-tilkobling i **begge** organisasjonene (hjelperen krever minst én egen rad i både A og B, ellers kaster den `TenantIsolationError`). `query` ber om forslag i egen organisasjon og returnerer `usageId` fra svaret. Tilfellet «bare B har KI på, A får `disabled`» prøves som vanlige tester i 5.12 og 5.13.
6. **oppslag av tilkobling:** samme `seed` som 9.5 (KI på og aktiv `fake` i begge); `query` returnerer `usageId` fra forslaget i egen organisasjon. Tilfellet «bare B har tilkobling, A får `disabled`» prøves som vanlig test i 5.12.
7. `ai_usage_log` står i `tests/tenant-tables.ts` med radbygger og testfil, så `tests/tenant-isolation-all-tables.test.ts` er grønn.
8. **direkte på tvers:** B sin admin kaller `recordDecision` med A sin `usageId` → nøytralt avslag, A sin rad uendret (alle kolonner).

## 10. Myk sletting

1. `recordDecision` på mykt slettet rad → nøytralt avslag, ingen endring, ingen linje i `audit_log`.
2. Mykt slettet `suggested`-forslag blir ikke satt til `rejected` av nytt forslag (6.22).
3. Samme `requestId` på en mykt slettet rad gir det nøytrale avslaget (samme klasse og melding som i 6.8), raden returneres ikke, og det lages ingen ny rad (fortsatt én rad med id-en, fortsatt slettet). `fake` er ikke kalt.
4. Statisk: ingen `.delete(` på `aiUsageLog` (avsnitt 12).

## 11. Ingen innhold på avveie, `src/core/ai/no-leak.test.ts` (ny, mot databasen)

En unik markør (for eksempel `MARKOR-7f3a`) i `fields.text`. `vi.spyOn` på alle nivåene i `logger` (`src/shared/lib/logger.ts`).

1. **vellykket kall:** markøren finnes bare i `output_text` (hvis `fake` gjentar den) og ingen annen kolonne (`JSON.stringify` av hele raden minus `output_text`), ikke i `audit_log` og ikke i noe kall til `logger`.
2. **feilveien** (`fake` gir `error`, og `fake` kaster med markøren i meldingen): markøren finnes ikke i raden, `audit_log` eller `logger`. Loggkallet har bare funksjon, leverandørkode, `error_code` og id.
3. **avslag** (felt utenfor tillatt-listen med markøren som verdi): markøren finnes ikke i feilmeldingen eller i `logger`.
4. **`recordDecision`:** markør i `output_text` finnes ikke i `audit_log` eller `logger`.

## 12. Statiske kontroller, `src/core/ai/static-checks.test.ts` (ny)

Samme mønster som `src/core/integrations/static-checks.test.ts`.

1. `src/core/ai` har kildefiler (ellers sier testene under ingenting).
2. **portene `"ai"` og `"speech_to_text"`** (som strengliteral, begge typer anførselstegn) står bare i `src/core/ai/**`, `src/core/integrations/ports.ts`, `src/db/seed/sample-assignments.ts` og testfiler.
3. **mønsteret er ikke hult:** testen prøver regex-en mot en tekst i minnet (`findActiveConnection(orgId, "ai")` → treff; `"aim"` og `"air"` → ikke treff).
4. ingen `.delete(` på `aiUsageLog` i `src/`.
5. ingen `console.` og ingen `process.env` i `src/core/ai` (utenom testfiler).
6. `PROVIDERS_BY_PORT.ai` er nøyaktig `["fake"]`, og `PROVIDERS_BY_PORT.speech_to_text` er `[]`.
7. `src/core/ai/index.ts` eksporterer ikke noe som lister eller teller rader per ansatt (navn som `list*`, `count*`, `*ByEmployee`, `*Statistics`).
8. ingen import av SDK-er eller `readSecret` i `src/core/ai` (ingen ekte leverandør ennå).

## 13. Seed, `src/db/seed/sample-assignments.test.ts` (utvides)

1. **første kjøring:** prøveorganisasjonen får `settings.ai.enabled = true` og én aktiv rad `port = ai`, `provider = fake`.
2. **andre kjøring:** ingen ny rad, ingen endring (sammenlign rad og `row_version`), samme `settings`.
3. **admin har satt `ai.enabled = false`:** seed slår det ikke på igjen.
4. **deaktivert rad** (`status = disabled`) og **mykt slettet rad** på porten `ai`: seed lager ikke ny rad og endrer ikke den som finnes.
5. **rad med annen leverandørkode** på porten `ai`: røres ikke, og det lages ingen `fake` ved siden av.
6. **andre nøkler i `settings`** (`access.inspectors_edit_all = false`, `sampleData`, en oppdiktet nøkkel) er uendret etter seed.
7. **Byggcon** (og en organisasjon uten `sampleData`) får verken `ai.enabled` eller tilkobling, heller ikke av `pnpm db:seed` (`src/db/seed/run.test.ts`).
8. **etter seed** gir `requestSuggestion` for prøvetakstmannen et forslag (helhetstest).

## 14. Endringer i eksisterende tester og hjelpere

1. `src/core/integrations/ports.test.ts` test 2: `ai` får `["fake"]`, de åtte andre fortsatt `[]`. Testen skrives om, ikke slettes.
2. `tests/factories.ts`: `createAiUsageLog`, og `ai_usage_log` i `RESET_TABLES` før `employees` og `assignments`.
3. `tests/tenant-tables.ts`: ny rad for `ai_usage_log`.
4. `tests/factories.test.ts`: fabrikken lager rad i riktig organisasjon.
5. Hvis `start.sh` endres: `tests/start-script.test.ts` grønn.

## 15. E2E

Ingen skjerm, så ingen nye e2e-tester (kortet). Hele `pnpm test:e2e` kjøres i prosjektene `pc` og `ipad` for å vise at ingenting er brutt, særlig `e2e/fase-2a-testoppdrag.spec.ts` (seed med KI-tillegget). Ingen prøve uten nett: KI-kall uten nett hører til KI-køen (eget punkt).

## 16. Dokumenter (sjekkes for hånd i testrapporten)

- `docs/personvern/intern-personvernerklaering.md`: rad for `ai_usage_log`, setningen om `audit_log`.
- `docs/personvern/sletting-av-betadata.md`: tabellen er med.
- `docs/05-domenemodell.md` 4.12 og ordlisten stemmer med skjemaet.
- A158–A163 står i `docs/09-apne-sporsmal.md`. Versjonen i `package.json` er 0.4.5 (én patch over `main`, 0.4.4).

## Avklaringer til utvikler (føres i kortet før bygging)

- **A. Nytt kall med `no_match` eller `error`:** kortet sier at forrige `suggested` settes til `rejected` når ny rad settes inn, men ikke om det gjelder alle utfall. Forslag fra test-leder: **bare når det nye utfallet er `ok`.** Ellers mister takstmannen et brukbart forslag fordi neste kall feilet, og det finnes ikke noe nyere forslag å bruke. Avgjort i kortet (A164): bare ved `ok`. Test 6.25 er skrevet etter det.
- **B. Gjentatt kall etter at KI er slått av:** kortets rekkefølge (oppslag i trinn 5 før KI av i trinn 6) gir det lagrede svaret. Test 6.17 låser det.
- **C. Gjentatt `requestId` når raden er mykt slettet:** kortet sier bare at raden ikke returneres. Forslag: nøytralt avslag (ny rad med samme id kan ikke lages, fordi id-en er primærnøkkel). Avgjort i kortet (A164): nøytralt avslag. Test 10.3 er skrevet etter det.
- **D. «Nyere forslag» ved `undo`:** sammenlign på serverens `created_at`, ikke på id-en (som kommer fra enheten), og bare rader med `outcome = ok` som ikke er slettet.
- **E. Lite funn (ikke stopp):** med `fake` i `PROVIDERS_BY_PORT.ai` kan admin lage en `fake`-tilkobling i Byggcon via `createConnection`. Det koster ingenting og sender ingenting ut, så det godtas. Nevnes i PR-en.

## Godkjenning

Testrapporten avviser hvis noe av dette mangler: tilgang for de fem variantene på begge funksjonene (avsnitt 8), `expectTenantIsolation` for hver av de seks spørringene (avsnitt 9), testen for admin uten andre rettigheter (8.1), myk sletting (avsnitt 10) eller markørtesten (avsnitt 11).
