# Testplan: Oppbevaringstid for avviste KI-forslag som innstilling (K7)

- **Oppgavekort:** `docs/agenter/oppgaver/ki-oppbevaring-avviste.md`
- **Fase:** 2a («Fra Ståles svar 12.11.2026», siste punkt)
- **Branch:** `ki-oppbevaring-avviste` (bygger på main)
- **Laget av:** test-leder, 13.11.2026 (før bygging). Gjennomgått på nytt 13.11.2026 etter at main (0.11.2) ble flettet inn: kortet, A272–A275 og hjelperne i `tests/factories.ts` og `e2e/helpers.ts` stemmer med planen.
- **Støtter hovedmål:**
  - **KI i bunnen:** testene viser at loggen over forslag og beslutninger står minst så lenge innstillingen sier, regnet ut ett sted (`retainUntilFor`), og at ingenting slettes.
  - **De ansatte:** admin endrer tallet selv på PC eller iPad, med tydelig feilmelding og kvittering.
  - **Reklamasjoner:** godtatte og endrede forslag står alltid i 10 år, uansett vei (også via angre), så det kan vises hva KI foreslo og hva takstmannen bestemte.

## Felles for alle tester

- Fast tid: `created_at` settes alltid med `createAiUsageLog(..., { createdAt })` eller med falsk klokke (`vi.setSystemTime`). Forventet dato regnes med `addYears` fra `usage-log.ts`, aldri med egen regning i testen. Én kontrolltest (U4) sjekker også de faste datoene som tekst, så en feil i `addYears` ikke skjules.
- Forventet dato sammenlignes som ISO-tekst på hele tidsstempelet (ikke bare dato).
- `resetDatabase()` i `beforeEach`. Data er oppdiktet. Ingen navn, e-post eller adresser i forslagsteksten.
- Innstillingen settes i testene rett i `organizations.settings` (rå JSONB), så ugyldige verdier kan prøves. Hjelper `setOrgSettings(organizationId, settings)` legges i testfilen (ikke i `tests/factories.ts`, den trengs bare her).
- Ingen ny tabell: `tests/tenant-tables.ts` endres ikke, og `tests/tenant-isolation-all-tables.test.ts` skal være grønn uendret.

## 1. Enhetstester: `src/core/ai/retention.test.ts` (uten database)

| # | Testnavn | Hva den viser |
|---|---|---|
| U1 | `retainUntilFor: rejected bruker innstillingen` | `retainUntilFor("rejected", t, 2)` = `addYears(t, 2)`. |
| U2 | `retainUntilFor: alle andre statuser gir 10 år` | `suggested`, `accepted`, `edited` og `null` (sperret/feil uten status) gir `addYears(t, 10)` også når `rejectedYears` er 1. |
| U3 | `retainUntilFor: grensene 1 og 10` | `rejected` med 1 gir +1 år, med 10 gir +10 år. |
| U4 | `retainUntilFor: 29. februar gir 1. mars` | `created_at` 2028-02-29T12:00:00Z med 1 år gir 2029-03-01T12:00:00Z (fast tekst), og er lik `addYears`. Med 4 år gir 2032-02-29. |
| U5 | `readRejectedRetentionYears: gyldige tall` | 1, 5 og 10 gir samme tall; ingen advarsel (`logger.warn` ikke kalt). |
| U6 | `readRejectedRetentionYears: mangler gir 10 uten advarsel` | `{}` og settings uten nøkkelen gir 10, og `logger.warn` kalles ikke (avgjort i kortet, F1). |
| U7 | `readRejectedRetentionYears: ugyldige verdier gir 10 og advarsel uten verdien` (tabelltest) | 0, 11, 2.5, `"5"`, `null`, -1, `{}`, `[]`, `true`, `NaN`-lignende tekst, og `settings` = `null` og `settings` = tekst. Hver gir 10. `logger.warn` kalles med organisasjons-id og nøkkelen `ai.rejected_retention_years`; spionen sjekker at ingen argument (serialisert med `JSON.stringify`) inneholder den ugyldige verdien. |
| U8 | `saveAiRetentionSettings: Zod-skjemaet` (ren validering om skjemaet er eksportert, ellers i integrasjon I8) | `"3"` blir 3 (number), `" 3 "` godtas eller avvises likt med skjemaet i `form-parts`; `"0"`, `"11"`, `"2.5"`, `"abc"`, `""`, `"-1"`, `"1e1"` avvises. |

## 2. Integrasjonstester mot testdatabasen

### 2a. `src/core/ai/retention.test.ts`: lagring og lesing av innstillingen

| # | Testnavn | Hva den viser |
|---|---|---|
| I1 | `bare admin lagrer: takstmann, kontor og leder får AccessDeniedError` (tabelltest per rolle) | Ingen endring i `settings`, ingen rad i revisjonsloggen. |
| I2 | `admin med bare adminrollen lagrer (regel 11, skal aldri fjernes)` | Admin uten andre roller og uten egne tildelte rettigheter lagrer 3. Admin stenges aldri ute. |
| I3 | `leser for siden: bare admin` | Lesefunksjonen siden bruker (for eksempel `getAiRetentionSettings(actor, organizationId)`) gir `AccessDeniedError` for takstmann, kontor og leder, og verdien for admin. Finnes ingen egen lesefunksjon med tilgangssjekk, er det et alvorlig funn (siden må ikke lese `settings` uten `src/core/access`). |
| I4 | `lagrer som tall også når skjemaet sender tekst` | Input `"4"` gir `typeof settings["ai.rejected_retention_years"] === "number"` og verdien 4 (lest rått med SQL). |
| I5 | `beholder andre nøkler` | Før: `access.inspectors_edit_all`, `time_tracking.enabled`, `time_tracking.baseline`, `photo.retention.*` og en ukjent nøkkel. Etter lagring er alle like (dyp likhet), bare den nye nøkkelen er endret. |
| I6 | `nøkler sendt med i input kommer aldri inn` | Input med ekstra felt (`access.inspectors_edit_all: false`, `organizationId`) endrer ikke andre nøkler. |
| I7 | `revisjonslogg: én rad med nøkkel, gammel og ny verdi som tall` | 10 → 3 gir én rad via `auditRows`, med nøkkelen og `{ old: 10, new: 3 }` (eller tilsvarende felt), begge `typeof number`. Ingen andre nøkler fra `settings` i raden. |
| I8 | `ugyldig input avvises uten å gjengi det som ble skrevet` (tabelltest) | 0, 11, 2.5, «abc», tom verdi, -1: feilen har teksten «Skriv et helt antall år fra 1 til 10.», feilmeldingen og `logger`-kall inneholder ikke inputen, `settings` er uendret og ingen ny rad i revisjonsloggen. |
| I9 | `gammel verdi er 10 når det som stod var ugyldig eller manglet` (A275) | Lagret `"5"` (tekst) og manglende nøkkel: revisjonsloggen får gammel verdi 10, aldri `"5"` eller `null`. |
| I10 | `samme verdi som før: ingen skriving og ingen rad i revisjonsloggen` (A275) | Lagre 3 to ganger: én rad i revisjonsloggen totalt, `organizations.updated_at` uendret ved andre lagring, og funksjonen gir vanlig suksess. Også: ingenting lagret (standard 10) og lagre 10 gir ingen rad. Avgjør: ingen skriving da heller. |
| I11 | `samtidig lagring mister ingen nøkkel` | `Promise.all` med denne lagringen og lagring av `time_tracking.enabled` (`src/core/work-sessions/settings.ts`): begge nøklene står etterpå (radlåsen virker). |
| I12 | `tenant-isolasjon: lagring` | `expectTenantIsolation` der `query` lagrer en verdi med `organizationId` og returnerer organisasjonsraden (`[{ id }]`). Viser at admin i A med Bs id får `AccessDeniedError`. I tillegg: Bs `settings` og revisjonslogg er uendret etter forsøket. |
| I13 | `tenant-isolasjon: lesing` | `expectTenantIsolation` på lesefunksjonen fra I3. B har innstilling 2, A har 7: hver ser bare sin. |

### 2b. `src/core/ai/usage-log.test.ts` (tillegg): ny rad

| # | Testnavn | Hva den viser |
|---|---|---|
| L1 | `ny rad får alltid 10 år, uansett innstilling` | Med innstillingen 1: rad med utfall `ok`, `blocked` (`insertBlockedRow`) og feil får `retain_until` = `addYears(created_at, 10)`. |

### 2c. `src/core/ai/record-decision.test.ts` (tillegg): manuelle overganger

Innstillingen 2 i organisasjonen hvis ikke annet står. Rad laget med `createAiUsageLog` med fast `created_at`.

| # | Testnavn | Hva den viser |
|---|---|---|
| D1 | `avvist uten innstilling gir 10 år` | Ingen nøkkel: `reject` gir `addYears(created_at, 10)`. |
| D2 | `avvist med innstilling 2 gir 2 år` | `reject` gir `addYears(created_at, 2)`. |
| D3 | `godtatt og endret gir 10 år` | `accept` og `edit` gir `addYears(created_at, 10)`, også når raden ble laget med kort dato (rådata med `retain_until` = +2 år før overgangen). Viser at `record-decision.ts` nå setter `retain_until`. |
| D4 | `avvist → angre → godtatt gir 10 år` | `reject` (+2) → `undo` gir `suggested` og +10 → `accept` gir +10. Eneste angre-test (forenkler). |
| D7 | `grensene 1 og 10` | Innstilling 1 gir +1, innstilling 10 gir +10. |
| D9 | `A273: kortere og lengre virker bare fremover` | Rad R1 avvist med innstilling 10 (+10). Sett 2. R1 er fortsatt +10. Rad R2 avvist nå (+2). Sett 10. R2 er fortsatt +2. |
| D10 | `ugyldig innstilling i databasen gir 10 år` | `"5"` som tekst: avvist rad får +10, og advarsel logges uten verdien. |
| D11 | `innstillingen leses fra grant.organizationId` | Organisasjon A har 1, B har 10. Admin i B avviser en rad i B: +10. Admin i A avviser i A: +1. Ingen rad i A endres av avvisningen i B (`retain_until`, `status`, `updated_at` uendret). |
| D12 | `ingen rad slettes` | Etter alle overgangene i D1–D4, D7 og D9 (D5, D6 og D8 er tatt ut av forenkleren): antall rader i `ai_usage_log` er det samme, og ingen har fått `deleted_at`. |

### 2d. `src/core/ai/request-suggestion.test.ts` (tillegg): avvist fordi nytt forslag erstatter

| # | Testnavn | Hva den viser |
|---|---|---|
| S1 | `erstattet forslag får innstillingen` | Innstilling 2. Eldre `suggested` rad på samme mål. Nytt forslag (utfall `ok`): den gamle blir `rejected` med `addYears(created_at, 2)`. Det nye forslaget har +10. |
| S2 | `hver erstattet rad får sin egen dato` | To eldre `suggested` rader på samme mål med `created_at` 2026-11-01 og 2026-11-05: hver får +2 fra **egen** `created_at` (to ulike datoer). |
| S4 | `uten innstilling: erstattet rad får 10 år` | Ingen nøkkel gir +10. |
| S5 | `nytt forslag som ikke er brukbart avviser ingenting` | Utfall `blocked` eller feil: eldre rad er fortsatt `suggested` med uendret `retain_until` (avklaring A holder). |
| S6 | `rader på andre mål og i andre organisasjoner røres ikke` | Organisasjon B har en `suggested` rad på samme feature og et mål med samme id-mønster, og innstilling 1. Nytt forslag i A: Bs rad er uendret. As erstattede rad får As innstilling, ikke Bs. |
| S7 | `ingen rad slettes` | Antall rader øker med nøyaktig én (det nye forslaget), ingen `deleted_at`. |

### 2e. Eksisterende tester, uendret

`record-decision-order.test.ts`, `record-decision-order-testplan.test.ts`, `suggestion-status.test.ts`, `suggestion-status-testplan.test.ts`, `record-decision.test.ts` og `request-suggestion.test.ts` (eksisterende tester) skal være grønne **uten endring**. `git diff main` på disse filene skal bare vise nye tester, aldri endrede forventninger. `tests/tenant-isolation-all-tables.test.ts` grønn uendret.

## 3. Server action: `src/app/(ansatt)/admin/ki/actions.test.ts`

Samme mønster som `src/app/(ansatt)/admin/actions.test.ts` (kjernen og `getAdminContext` er byttet ut).

| # | Testnavn | Hva den viser |
|---|---|---|
| A1 | `ikke admin gir «ingen tilgang» uten kall til kjernen` | Takstmann, kontor og leder: `saveAiRetentionSettings` kalles ikke. |
| A2 | `organisasjonen kommer fra økten, aldri fra skjemaet` | `FormData` med `organizationId` fra en annen organisasjon: kjernen kalles med organisasjonen fra `getAdminContext`. |
| A3 | `tekst fra skjemaet sendes videre og lagres som tall` | `"3"` gir kall med verdien som blir 3, og kvittering. |
| A4 | `feil ved feltet uten å gjengi inputen` | Ugyldig verdi gir feltfeil «Skriv et helt antall år fra 1 til 10.»; tilstanden som returneres inneholder ikke inputen i meldingen. |
| A5 | `samme verdi gir vanlig kvittering` | Ingen feil vises når kjernen ikke skrev noe (A275). |

## 4. Regeltester

Ingen fagregler eller TG-logikk i denne oppgaven. Ingen testsaker som data. `retainUntilFor` er en ren funksjon og dekkes av U1–U4.

## 5. Statiske sjekker (test-leder kjører på ferdig branch)

| # | Sjekk | Godkjent når |
|---|---|---|
| ST1 | `grep -rn "retainUntil\|retain_until" src --include=*.ts \| grep -v test` | Alle steder som setter `retain_until` i `src/core/ai` bruker `retainUntilFor` (eller `retainUntilFrom` bare ved ny rad). Ingen `interval` i SQL for `retain_until`. |
| ST2 | `grep -rn "delete(aiUsageLog\|delete from ai_usage_log\|deletedAt" src/core/ai \| grep -v test` | Ingen ny permanent sletting og ingen ny myk sletting. |
| ST3 | `grep -rn "rejected_retention_years" src/app` | Siden og action leser ikke `settings` direkte; bare via `src/core/ai`. Ingen rollesjekk i komponenten. |
| ST4 | `git diff --stat main` | Ingen endring i `src/core/orders`, ordresidene, `src/db/migrations` eller `tests/tenant-tables.ts`. Versjon i `package.json` er én patch over main. |
| ST5 | `git diff main \| grep -iE 'claude\|opus\|sonnet\|gpt\|NS 3600'` | Ingen modellnavn, ingen fremmed fagtekst. |
| ST6 | Dokumentene | A157 merket «endret av Ståle 12.11.2026 (K7), se A272»; A272–A275 og spørsmål 81 står; ADR 0006, domenemodell 4.12 og innstillingslisten, ordlisten, skjemakommentaren i `src/db/schema/ai-usage-log.ts`, personvernerklæringen og T-0068 oppdatert. Personvernerklæringen lover ikke automatisk sletting. |

## 6. E2e: `e2e/fase-2a-ki-oppbevaring.spec.ts` (prosjektene `pc` og `ipad`)

Kjøres i serie (testene deler innstillingen). Verdien leses før og settes tilbake i `afterAll` (som `setInspectorsEditAll`/`restoreInspectorsEditAll`). Ingen testhjelper-endepunkt.

| # | Testnavn | Hva den viser |
|---|---|---|
| E1 | `admin ser fanen «KI» og hjelpeteksten` | Fanen «KI» i adminmenyen åpner `/admin/ki`. Hjelpeteksten inneholder «minst» og «Ingenting fjernes automatisk ennå». Siden har ikke ordene «slettes» eller «fjernes etter» som løfte. |
| E2 | `admin lagrer 3 og ser 3 etter omlasting` | Skriv 3, «Lagre», kvittering vises; `page.reload()` viser 3. Databasen har tallet 3 (`typeof` number via rå SQL). |
| E3 | `0 og 11 gir feilmelding ved feltet` | «Skriv et helt antall år fra 1 til 10.» knyttet til feltet (`aria-describedby` eller ved siden av). Verdien i databasen er uendret. |
| E4 | `leder ser verken fanen eller siden` | `logInAsManager`: ingen fane «KI»; direkte til `/admin/ki` gir ingen tilgang (samme svar som andre adminsider), feltet finnes ikke. |
| E5 | `takstmann ser verken fanen eller siden` | Som E4 med `logInAsInspector`. |
| E6 | `iPad: feltet og knappen kan brukes med berøring` (bare `ipad`) | Liggende og stående (834 × 1194): feltet og «Lagre» er synlige uten vannrett rulling, knappen er minst 44 px høy, tallfeltet har `inputmode="numeric"`. |

**Uten nett:** ikke aktuelt. `/admin/ki` er en admin-side som bare brukes på nett (kortet). Det skrives i testrapporten. Ingen e2e uten nett.

## 7. Dekning av akseptkriteriene

| Akseptkriterium (kortet) | Tester |
|---|---|
| Uten innstilling: avvist + 10 år | D1, S4, U6 |
| Innstilling 2: manuelt og ved nytt forslag + 2; godtatt, endret, sperret, feilet + 10 | D2, D3, S1, L1, U2 |
| Én angre-test: avvist 2 år → angre → godtatt gir + 10 | D4 |
| Hver erstattet rad egen dato | S2 |
| A273 bare fremover | D9 |
| Grensene, og 29. februar i enhetstesten | U3, U4, D7, ST1 |
| Ugyldige verdier i databasen gir 10 og advarsel uten verdien | U7, D10 |
| Lagring avviser ugyldig uten å gjengi | U8, I8, A4 |
| Beholder andre nøkler, tall, revisjonslogg, gammel 10, samme verdi ingen rad | I4, I5, I6, I7, I9, I10, I11 |
| Rolletilgang, admin alltid | I1, I2, I3, A1, E4, E5 |
| Tenant-isolasjon lagring og lesing, og avvisning i én organisasjon påvirker ikke en annen | I12, I13, D11, S6, A2 |
| Ingenting slettes | D12, S7, ST2 |
| Hjelpeteksten sier «minst» og ingen automatisk fjerning | E1 |
| Eksisterende tester grønne uendret | 2e |
| `/admin/ki` på PC og iPad | E1–E6 |
| Dokumenter | ST6 |
| `pnpm lint`, `typecheck`, `test`, `test:e2e` grønne | kjøres av test-leder til slutt |

## 8. Funn i kortet før bygging

Begge funnene er avgjort i kortet (13.11.2026): F1 ingen advarsel når nøkkelen mangler; F2 lesefunksjonen `getAiRetentionSettings` er med i omfanget.

- **F1 (lite, avgjort):** Mangler nøkkelen, gis 10 uten advarsel; bare ugyldig verdi gir advarsel. U6 sjekker at `logger.warn` ikke kalles.
- **F2 (lite, avgjort):** `getAiRetentionSettings` med tilgangssjekk er i omfanget. I3 og I13 bruker den. Leser siden `settings` uten den, avvises leveransen (ST3).
- **F3 (lite):** Kortet sier versjon «over 0.11.1»; main har nå 0.11.2. ST4 krever én patch over det main har når PR-en åpnes (0.11.3 i dag).

## 9. Godkjenning (til slutt)

Test-leder kjører `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e`, leser testene fra testskriver og godkjenner bare når I1–I3, I12, I13, D11 og S6 (tilgang og tenant-isolasjon) og D12/S7 (myk sletting) finnes og er grønne.
