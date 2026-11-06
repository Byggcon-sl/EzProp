# Testplan: Tidsmåling per oppdrag og fase

- **Oppgavekort:** `docs/funksjoner/fase2a-tidsmaling.md`
- **Dato:** 06.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at tiden måles uten et eneste trykk, at fasen blir riktig og at snittet regnes likt hver gang, slik at sammenligningen med IVIT er til å stole på), reklamasjoner (ikke direkte) og KI først (ikke KI; automatikk som gjør at takstmannen slipper å føre timer).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Alle tester som avhenger av tid, sender inn fast `now` (utgangspunkt `TEST_NOW` = 03.11.2026 kl. 10:00 UTC = 11:00 Oslo-tid). Testdata er oppdiktet: kilde «Oppdiktet måling, 3 oppdrag», ingen ekte navn eller adresser.

Ingen TG-regler. «Regeltestene» er faseregelen `phaseForAssignment` og utregningen i statistikken, begge som tabeller med testsaker (`it.each`). Måling på iPad og uten nett er ikke med (fase 2b), så det er ingen e2e uten nett; e2e kjøres i prosjektene `pc` og `ipad`.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1–6. Avvik føres i kortet.

- `src/core/work-sessions/phase.ts`: `phaseForAssignment({ status, inspectionAt }, now) → WorkPhase`, `WORK_PHASES = ["preparation", "inspection", "office", "delivery"]`, `IDLE_GAP_MINUTES = 10`.
- `src/core/work-sessions/activity.ts` (navn fritt): `shouldSendActivity({ lastSentAt, lastActivityAt, visible, now }) → boolean` (ren, brukes av `WorkSessionTracker`).
- `src/core/work-sessions/statistics.ts`: ren utregning, for eksempel `summarizeTimeStatistics(rows, baseline) → { assignmentCount, phases: [{ phase, averageSeconds, baselineMinutes, differencePercent }], total }`, der `differencePercent` er `number | null` (`null` vises som «–»). Navnet følger det som bygges.
- Tjenester fra `@/core/work-sessions`: `recordWorkActivity(actor, organizationId, assignmentId, now?)`, `getTimeStatistics(actor, organizationId)`, `saveTimeTrackingSettings(actor, organizationId, input)` (navn fritt), `readTimeTrackingEnabled(organizationId, settings)`.
- Skjema (Zod) for nullpunkt og bryter i `src/core/work-sessions/schemas.ts`.
- Serverhandling `recordWorkActivityAction(assignmentId)` ved oppdragssiden.
- Fabrikk `createWorkSession(organizationId, { assignmentId, employeeId, phase, startedAt, endedAt, deletedAt })` i `tests/factories.ts`; `work_sessions` i `RESET_TABLES` og i `tests/tenant-tables.ts`.
- Intern testhjelper (bare i testen) som gir id-ene til oppdragene som telles i statistikken, brukt som `query` i `expectTenantIsolation`.

## 1. Faseregelen, `src/core/work-sessions/phase.test.ts` (ny, ren)

Tabell med testsaker (`it.each`), `now = TEST_NOW` (03.11 11:00 Oslo):

1. **`ordered`** med tom befaring, befaring i går, i dag, i morgen → `preparation`.
2. **`in_progress` + tom befaring** → `preparation`.
3. **`in_progress` + befaring i morgen** (04.11 09:00 Oslo) → `preparation`.
4. **`in_progress` + befaring i dag**, både før og etter `now` (03.11 08:00 og 15:00 Oslo) → `inspection`.
5. **`in_progress` + befaring i går** (02.11 14:00 Oslo) → `office`.
6. **`completed` og `invoiced`** med alle befaringsvarianter → `delivery`.
7. **midnatt Oslo-tid:** befaring `2026-11-02T23:30Z` (03.11 00:30 Oslo) → `inspection`; befaring `2026-11-02T22:59Z` (02.11 23:59 Oslo) → `office`.
8. **`now` rundt midnatt:** befaring 03.11 09:00 Oslo; `now = 2026-11-03T22:59Z` → `inspection`; `now = 2026-11-03T23:01Z` → `office`.
9. **sommertid:** befaring `2026-06-14T22:30Z` (15.06 00:30 Oslo, UTC+2), `now = 2026-06-15T08:00Z` → `inspection` (viser at Oslo-tid og ikke UTC brukes).
10. **tabellen dekker alle statuser:** hver kode i `ASSIGNMENT_STATUSES` har minst én rad (ny status uten testsak gjør testen rød).
11. **resultatet er alltid en kode i `WORK_PHASES`**.

## 2. Når måleren sender, `shouldSendActivity` (ny, ren)

1. **første kall** (`lastSentAt = null`, synlig) → sendes.
2. **første kall med skjult fane** → sendes ikke.
3. **59 s etter forrige kall** med aktivitet → sendes ikke.
4. **60 s etter** med aktivitet etter forrige kall → sendes.
5. **60 s etter uten aktivitet** (`lastActivityAt <= lastSentAt` eller `null`) → sendes ikke.
6. **60 s etter med aktivitet, skjult fane** → sendes ikke.
7. **aktivitet nøyaktig lik `lastSentAt`** → regnes som ingen ny aktivitet.

## 3. Skjema for nullpunkt og bryter, `src/core/work-sessions/schemas.test.ts` (ny)

1. **minutter per fase** (`it.each` over alle fire faser): −1 avvises, 0 godtas, 10 000 godtas, 10 001 avvises, 12.5 avvises, tekst avvises, alle med norsk melding.
2. **kilde:** tom godtas, 200 tegn godtas, 201 avvises; trimmes.
3. **bryteren** må være boolsk.
4. **ukjente nøkler** (for eksempel `access.inspectors_edit_all`, `organizationId`) tas ikke med i resultatet.

## 4. Utregningen, `src/core/work-sessions/statistics.test.ts` (ny, ren, A124)

Tabell med testsaker (`it.each`), sekunder inn, fasitsvar ut:

1. **fasitsvar:** oppdrag X: forberedelse 600 s, befaring 3 600 s; oppdrag Y: kontor 1 800 s, levering 300 s. Antall = 2; snitt: forberedelse 300, befaring 1 800, kontor 900, levering 150; totalt 3 150 s.
2. **totalt = summen av snittene** (egenskap sjekket i alle radene).
3. **fase uten økt** bidrar med 0, men nevneren er fortsatt antall oppdrag som telles.
4. **forskjell med fortegn:** snitt 30 min mot nullpunkt 60 → −50; snitt 90 mot 60 → +50; avrunding til helt tall (snitt 20 mot 30 → −33).
5. **nullpunkt mangler eller er 0** → `null` (vises «–»), aldri `Infinity`/`NaN`.
6. **totalt-nullpunktet** = summen av de fire fasene; er summen 0 → `null`.
7. **ingen oppdrag som telles** → tomt resultat (antall 0), ingen deling på 0.
8. **minutter avrundes først ved visning:** 89 s og 91 s gir 1 og 2 minutter i visningsfunksjonen; utregningen er i sekunder.
9. **svaret har ingen ansattfelt:** nøklene i resultatet er en fast liste (ingen `employeeId`, `employee`, `name`).

## 5. Kjernen, `src/core/work-sessions/record.test.ts` (ny, mot databasen)

### 5.1 Registrering og økter

1. **første aktivitet** lager én økt med `started_at = ended_at = now`, riktig fase, `organization_id` og `employee_id` fra grant.
2. **9 min 59 s senere, samme fase** → samme rad forlenges (`ended_at = now`), ingen ny rad.
3. **10 min 1 s senere** → ny rad.
4. **akkurat 10 min** → forlenges (grensen er «høyst 10 minutter»).
5. **statusendring innen 10 min** (`in_progress` → `completed`) → ny økt i `delivery`, den gamle er uendret.
6. **endret befaringsdato** til i dag innen 10 min → ny økt i `inspection`.
7. **over midnatt Oslo-tid:** befaring 03.11; aktivitet `2026-11-03T22:55Z` (`inspection`) og `2026-11-03T23:02Z` → ny økt i `office`.
8. **siste økt er slettet** (`deleted_at` satt, innen 10 min) → ny rad; den slettede er uendret.
9. **to ansatte på samme oppdrag** → hver sin økt.
10. **samme ansatt på to oppdrag** → hver sin økt.
11. **samtidige kall:** to `recordWorkActivity` med samme `now` fra to databaseforbindelser i `Promise.all` → nøyaktig én rad (låsen virker).
12. **`ended_at < started_at`** kan ikke lagres (CHECK i databasen, direkte insert gir feil).
13. **ukjent fase** (`"travel"`) kan ikke lagres (CHECK).
14. **ingen hendelse og ingen revisjonslogg** per aktivitet (antall `events`/`audit_log` uendret).

### 5.2 Bryteren

1. **`time_tracking.enabled = false`** → ingen rad, ingen feil.
2. **nøkkelen mangler** → måling på (rad lages).
3. **verdien er ikke boolsk** (`"nei"`, `0`, `null`) → måling på (`readTimeTrackingEnabled`, `it.each`).
4. **bryteren av, så på igjen** → måling fortsetter med ny rad.

### 5.3 Oppdraget

1. **kansellert (slettet) oppdrag** → ikke-funnet-feil, ingen rad.
2. **tilfeldig uuid og `"ikke-en-id"`** → ikke-funnet-feil, aldri databasefeil, ingen rad.

### 5.4 Tilgang per rolle (`it.each`)

1. **`inspector`, `office`, `manager`, `admin`** får registrert tid (alle har `organization.read`).
2. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller** → `AccessDeniedError`, ingen rad.
3. **admin med bare adminrollen** får registrert tid (regel 11).

### 5.5 Tenant-isolasjon (regel 2)

1. **`expectTenantIsolation`:** `seed` lager oppdrag og kaller `recordWorkActivity` i A og B; `query` kaller `recordWorkActivity` og leser deretter øktene til den innloggede organisasjonen; `idOf = id`.
2. **IDOR:** admin i A med `orgA.id` og Bs `assignmentId` → ikke-funnet-feil, ingen ny rad i A eller B, Bs økter uendret.
3. **fremmednøkler:** direkte insert med `assignment_id` fra B og `organization_id` A gir feil; det samme for `employee_id` fra B.

### 5.6 Myk sletting

1. **ingen eksportert funksjon i `src/core/work-sessions` sletter permanent** (kildetekst-sjekk for `db.delete`/`tx.delete`/`DELETE FROM`, som i de andre modulene).

## 6. Serverhandlingen, `src/app/(ansatt)/oppdrag/[id]/work-session-action.test.ts` (ny)

1. **uten innlogging** (`getEmployeeContext` gir `null`) → avvises uten kall til kjernen, ingen rad.
2. **id som ikke er uuid** → avvises uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** kjernen kalles med `organizationId` fra den innloggede ansatte, selv om argumentet eller adressen peker på en annen organisasjon.
4. **oppdrags-id fra annen organisasjon** → ingen rad (mot databasen eller med kjernen, så lenge resultatet sjekkes).
5. **feil i kjernen** kastes ikke videre til siden (handlingen svarer stille, og loggen inneholder ikke oppdrags-id sammen med navn).

## 7. Statistikken, `src/core/work-sessions/statistics-db.test.ts` (ny, mot databasen)

### 7.1 Fasitsvar (A122, A124)

1. **fasitsvar** med oppdiktede økter (samme tall som 4.1, lagt inn med `createWorkSession`) → samme svar som den rene funksjonen.
2. **oppdrag `ordered` og `in_progress`** med økter telles ikke.
3. **`invoiced`** telles.
4. **slettede økter** telles ikke; **ferdig oppdrag der alle økter er slettet** telles ikke i antallet.
5. **slettede oppdrag** telles ikke.
6. **ferdig oppdrag uten økter** telles ikke i antallet.
7. **flere ansatte på samme oppdrag** → tiden summeres per oppdrag, oppdraget telles én gang.
8. **nullpunkt fra innstillingen** kommer med i svaret; mangler det → forskjell `null`.
9. **ingen ansattfelt:** nøklene i svaret (også nøstet) er en fast liste; `JSON.stringify(svaret)` inneholder ingen ansatt-id eller navn.

### 7.2 Tilgang per rolle

1. **`inspector` og `office`** → `AccessDeniedError`.
2. **`manager` og `admin`** → svar.
3. **admin med bare adminrollen** → svar (regel 11, testen skal aldri fjernes).
4. **enkeltrettighet:** takstmann med `grantPermission(…, "statistics.read")` → fortsatt `AccessDeniedError` (A21).

### 7.3 Tenant-isolasjon

1. **`expectTenantIsolation`:** `seed` lager ett ferdig oppdrag med én økt i A og i B; `query` er testhjelperen som gir id-ene til oppdragene som telles for den innloggede organisasjonen; `idOf = id`.
2. **tallprøve:** A har 30 minutter, B har 90; A ser antall 1 og totalt 30 min, B ser 90.

## 8. Innstillingene, `src/core/work-sessions/settings.test.ts` (ny, mot databasen)

1. **bare admin lagrer:** `manager`, `inspector`, `office` → `AccessDeniedError`, `settings` uendret.
2. **admin med bare adminrollen** lagrer (regel 11).
3. **sammenslåing:** sett `access.inspectors_edit_all = false` og en annen nøkkel (`"test.annet": "x"`) først; lagre nullpunkt og bryter; begge er uendret, og bare `time_tracking.enabled` og `time_tracking.baseline` er endret.
4. **bryteren alene** endrer ikke nullpunktet, og omvendt.
5. **ugyldig input** (fra 3.1/3.2) → valideringsfeil, `settings` uendret.
6. **revisjonslogg:** én rad `organization.settings` med feltnavnene som ble endret; ingen ved avvist tilgang eller valideringsfeil.
7. **tenant-isolasjon:** `expectTenantIsolation` der `query` lagrer og returnerer organisasjonsraden; etterpå er Bs `settings` endret bare av B.
8. **samtidig lagring:** bryter og nullpunkt lagret i `Promise.all` → begge nøklene står etterpå (ingen tapt oppdatering).

## 9. Rettighet og meny

1. **`src/core/access/guards.test.ts`:** matrisen utvides med `statistics.read`: `manager` og `admin` ja, `inspector` og `office` nei, med `access.inspectors_edit_all` både på og av.
2. **`src/core/access/permissions.test.ts`:** `statistics.read` er ikke i listen over rettigheter som kan gis enkeltvis; rad i `employee_permissions` gir ingen rettighet.
3. **menylenken** (`it.each` over fire roller, i testen av layout/meny): «Statistikk» bare for leder og admin.

## 10. Tabeller og fabrikker

1. **`tests/tenant-isolation-all-tables.test.ts`** er grønn med `work_sessions` i `tests/tenant-tables.ts` (radbygger og testfil `record.test.ts`).
2. **`createWorkSession`** lager rad i riktig organisasjon og bruker oppdrag og ansatt fra samme organisasjon som standard.

## 11. E2E, `e2e/fase-2a-tidsmaling.spec.ts` (ny, prosjektene `pc` og `ipad`)

Bruker `logIn` (admin), `logInAsInspector` og `logInAsManager` fra `e2e/helpers.ts`. Ingen testhjelper-endepunkt. Hver test lager eget oppdrag med `uniqueSuffix()`. Fordi andre spesifikasjoner også kan lage ferdige oppdrag, sjekkes **endringen** i antall (les antallet før og etter), ikke et fast tall. Testene som endrer bryteren, kjøres i serie (`test.describe.configure({ mode: "serial" })`) og setter bryteren tilbake til på i `afterAll`.

1. **måling uten trykk:** takstmann åpner et oppdrag `in_progress`, beveger musen/trykker en tast; leder setter oppdraget til «Ferdig»; `/statistikk/tid` viser antall +1, teksten «Tallene vises bare samlet, aldri per person.», og siden inneholder verken takstmannens navn eller e-post.
2. **måling av:** admin slår av «Mål tid»; takstmann åpner et annet oppdrag og er aktiv; leder setter det til ferdig; antallet er uendret. Admin slår målingen på igjen.
3. **ingen tilgang:** takstmann ser ikke menylenken «Statistikk», og `/statistikk/tid` direkte gir «Ingen tilgang» (aldri 500, ingen tall i HTML).
4. **nullpunkt:** admin lagrer minutter per fase og kilde; etter omlasting står tallene i skjemaet, og forskjell i prosent med fortegn vises (eller «–» for fase med 0).
5. **ugyldig nullpunkt:** 10 001 eller desimaltall gir norsk melding ved feltet; ingenting lagres.
6. **leder** ser tabellen, men ikke skjemaet for nullpunkt og bryter.
7. **iPad-størrelse** (prosjektet `ipad`, stående): ingen vannrett rulling på `/statistikk/tid`; bryter, tallfelt og «Lagre» er minst 44 px høye; tabellen er lesbar uten zoom.
8. **oppdragssiden er uendret:** måleren gir ingen synlig del og ingen feilmelding, også når serverhandlingen feiler (blokker kallet med `page.route` eller tilsvarende, og sjekk at siden virker).

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- `expectTenantIsolation` for `recordWorkActivity` (5.5.1), `getTimeStatistics` (7.3.1) og lagring av innstillinger (8.7), IDOR (5.5.2) og fremmednøkkeltestene (5.5.3).
- `work_sessions` i `tests/tenant-tables.ts`, og `tenant-isolation-all-tables` grønn.
- Admin-testene med bare adminrollen (5.4.3, 7.2.3, 8.2) og at `statistics.read` ikke kan gis enkeltvis (7.2.4, 9.2).
- Sammenslått lagring som beholder `access.inspectors_edit_all = false` (8.3).
- Ingen ansattfelt i statistikken (4.9, 7.1.9, e2e 1).
- Myk sletting (5.1.8, 5.6) og at slettede økter og oppdrag ikke telles (7.1.4–7.1.5).
- Låsen (5.1.11) og fast `now` i alle tidstester.
- Ingen tilgangslogikk i siden, komponenten eller handlingen utover å videreformidle `AccessDeniedError`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjon 0.3.6.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Økt lagres med riktig fase uten at takstmannen gjør noe | 5.1.1, 6.3, 11.1 |
| Pause over 10 min eller ny fase gir ny økt; innen 10 min forlenger | 5.1.2–5.1.7 |
| Fasen følger status og befaringsdato | 1.1–1.11 |
| Snitt per fase etter A124, nullpunkt og forskjell, «–», ingenting per person | 4.1–4.9, 7.1, 11.1, 11.4 |
| Lagring endrer bare `time_tracking.*` | 8.3, 8.4, 8.8 |
| Admin med bare adminrollen ser statistikken; `statistics.read` ikke enkeltvis | 7.2.3, 7.2.4, 9.2 |
| Takstmann og kontor ser ikke statistikken | 7.2.1, 9.1, 9.3, 11.3 |
| Admin lagrer nullpunkt og slår målingen av; av = ingen nye økter | 5.2, 8.1–8.6, 11.2, 11.4 |
| Økter slettes aldri permanent | 5.1.8, 5.6 |
| Annen organisasjon får ikke tilgang; `work_sessions` i `tenant-tables` | 5.5, 7.3, 8.7, 10.1 |
| iPad-størrelse | 11.7 |
| Kommandoene grønne | gjennomgangen |

## Merknader til kortet (lite)

- Kortet sier `NotFoundError` for oppdrag som ikke finnes. `expectTenantIsolation` krever `AccessDeniedError` når organisasjons-id-en er fremmed; det gir `requireOrganizationAccess` uansett. For fremmed eller slettet oppdrag i egen organisasjon godtas modulens ikke-funnet-feil, så lenge ingen rad lages og det aldri blir databasefeil.
- E2e kan ikke kreve «1 oppdrag» som fast tall, fordi andre spesifikasjoner deler databasen. Testen sjekker økningen i stedet (11).
