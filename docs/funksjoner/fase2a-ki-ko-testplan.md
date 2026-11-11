# Testplan: KI-kø uten nett

- **Oppgavekort:** `docs/funksjoner/fase2a-ki-ko.md` (runde 2, 11.11.2026)
- **Dato:** 11.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** KI i bunnen (testene låser at køen går uendret gjennom `requestSuggestion`, at klienten aldri snakker med leverandøren, og at KI virker likt med og uten nett), de ansatte (ett trykk uten nett, teksten overlever ny lasting, ingen ser en annens tekst på delt iPad) og færre reklamasjoner (et sent forslag overskriver aldri nyere egen tekst, T-0004 og T-0005).

All testdata er oppdiktet (feltinnhold som «Fukt i kjellervegg ved sluk», e-post bare på `example.com`). Ingen navn, telefon, adresse eller matrikkel i køtekstene. Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`.

**Ingen nye `*-testplan.test.ts`.** Testene legges i filene for området; nye filer bare der koden er ny (`src/core/ai/client/*.test.ts`). Numrene (K1.1 osv.) står først i testnavnet, så rapporten kan krysse av mot akseptkriteriene.

**Vitest kjører bare `*.test.ts` og har ikke jsdom.** «Komponenttester» skrives som i `src/shared/ui/ai-suggestion.test.ts`: rene hjelpefunksjoner pluss `renderToStaticMarkup`. Derfor må utvikleren legge logikken for kortet (T-0004, T-0005) og utloggingen i rene funksjoner som kan testes uten DOM (se signaturene under). IndexedDB-utgaven prøves bare i e2e (ingen `fake-indexeddb`).

Ingen TG-regler. «Regeltestene» er utfallstabellen for `classifyQueueOutcome` og lesesjekken, skrevet som `it.each` med testsaker som data.

## Avtale om signaturer (utvikler og testskriver)

Navn kan endres av utvikleren; avvik føres i kortet.

- `src/core/ai/client/queue.ts`: `createAiQueue(store: AiQueueStore, owner: { organizationId, employeeId }, now?: () => Date)` med `enqueue(input) → { ok: true, entry } | { ok: false, message }`, `list()`, `remove(requestId)`, `clear()`, `processQueue(send, opts: { online: () => boolean, onResult, timeoutMs? })`.
- `src/core/ai/client/memory-store.ts` (eller eksportert fra `queue.ts`): `createMemoryAiQueueStore()` for enhetstester. Må kunne fylles med rå, ugyldige poster (for lesesjekken).
- `src/core/ai/client/outcome.ts`: `classifyQueueOutcome(result: AiQueueSendResult | { thrown: unknown } | { timedOut: true }, online: boolean) → "retry_later" | "done" | "server_error"`.
- `src/core/ai/client/allowed-fields.ts`: `CLIENT_ALLOWED_FIELDS: Record<AiFeatureCode, readonly string[]>`.
- `src/core/ai/limits.ts`: `AI_FIELD_MAX_LENGTH`.
- Kortet: en ren funksjon (i `ai-suggestion.tsx` eller `ai-trial-client.tsx`) som gir visningen gitt `sourceText` og `currentText`, f.eks. `suggestionView({..., sourceText, currentText})` → `{ stale: boolean, primaryAction: "use" | "new" }`, og `undoAfterEdit(currentText, appliedText) → "status_only" | "restore"`.
- Utlogging: ren funksjon `logOutAndClear({ clearQueue, signOut })` som `LogOutButton` kaller.
- Testkrok i e2e (bare med `NEXT_PUBLIC_E2E=1` eller tilsvarende som i dag): lese antall poster og innhold i `local-ai-queue`. Alternativt `page.evaluate` med rått IndexedDB-API i `e2e/helpers.ts` (`aiQueueEntries(page)`), som er å foretrekke fordi det ikke krever kode i produktet.

## 1. Køen, `src/core/ai/client/queue.test.ts` (ny, ren, minneutgaven)

1. **K1.1** `enqueue` gir en post; `list` gir den; `remove(requestId)` fjerner bare den; `clear` tømmer alt.
2. **K1.2 rekkefølge:** tre poster med ulik `queuedAt` kommer i tidsrekkefølge; to poster med lik `queuedAt` sorteres på `requestId`.
3. **K1.3 erstatning:** ny forespørsel på samme `targetType`, `targetId` og `fieldKey` gir fortsatt én post, med ny tekst og **ny** `requestId`. Annen `fieldKey` på samme mål gir to poster.
4. **K1.4 erstatning ved full kø:** med 50 poster går erstatning av en av dem, og køen har fortsatt 50.
5. **K1.5 grense på antall** (`it.each`): 49 → 50 går; nr. 51 (nytt mål) gir `ok: false` med fast norsk melding, og køen er uendret (ingen stille tap).
6. **K1.6 grense på lengde:** tekst på nøyaktig `AI_FIELD_MAX_LENGTH` tegn går; én over gir fast melding og ingen post. Meldingen inneholder ikke teksten.
7. **K1.7 `requestId` er v4:** ny post har UUID der versjonssifferet (posisjon 15) er `4`; to poster har ulike id-er.
8. **K1.8 lesesjekken sletter** (`it.each`, rå poster lagt rett i minnelageret, så `list()` kjøres): feil form (mangler `text`), ukjent `feature`, ukjent feltkode i `fields`, `__proto__` som nøkkel i `fields` (laget med `JSON.parse`), annen `organizationId`, annen `employeeId`, `queuedAt` eldre enn 7 dager (6 dager og 23 timer beholdes, 7 dager og 1 minutt slettes, med `now` gitt inn). For hver: posten er **borte fra lageret** (ikke bare skjult), og den sendes aldri av `processQueue` (spion på `send`, 0 kall).
9. **K1.9 gyldige poster blir stående** når ugyldige slettes i samme lesing.
10. **K1.10 ingen tekst ut:** når lageret kaster (minneutgave satt til å kaste en feil med teksten i meldingen), gir køen fast melding med bare feilnavnet; spion på `console.*` har 0 kall; teksten finnes ikke i meldingen.
11. **K1.11 IndexedDB mangler:** IndexedDB-utgaven laget med `globalThis.indexedDB` udefinert gir fast melding fra `enqueue` og tom `list`, ikke unntak. (Dette er den ene IndexedDB-testen som går i Vitest, fordi den ikke trenger et ekte lager.)

## 2. Utfall, `src/core/ai/client/outcome.test.ts` (ny, ren, testsaker som data)

`it.each`-tabell `[inn, online, forventet]`:

1. **K2.1 prøv senere:** `online` false (uansett svar); kastet `TypeError` med `online` true; tidsavbrudd.
2. **K2.2 ferdig:** `suggestion`, `no_match`, `error`, `disabled`, `failed`+`invalid`, `failed`+`no_access`.
3. **K2.3 serverfeil:** kastet `Error` (ikke `TypeError`) med `online` true; `failed`+`unknown`.
4. **K2.4 statisk:** `outcome.ts` inneholder ikke `navigator` (kildetekst lest med `readFileSync`).
5. **K2.5** ukjent `kind` (fremtidig svar) gir `server_error`, ikke `done` uten melding og ikke unntak.

## 3. Behandling, `src/core/ai/client/process-queue.test.ts` (ny, ren, falsk `send`)

`send` er en spion som gir svar fra en tabell per `requestId`. Ingen ekte leverandør; serverhandlingen etterlignes med `AiQueueSendResult`.

1. **K3.1 nettfeil stopper runden:** tre poster, `send` kaster `TypeError` på første: 1 kall, alle tre poster ligger igjen, `attempts` uendret.
2. **K3.2 tidsavbrudd 30 s:** med `vi.useFakeTimers()`, `send` som aldri svarer: etter 29 999 ms ingen avgjørelse; etter 30 000 ms stopper runden, posten ligger igjen. Standardverdien er 30 000 (sjekk at `timeoutMs` ikke er gitt).
3. **K3.3 ferdig fjerner og går videre:** tre poster med `suggestion`, `no_match`, `failed`+`no_access`: tre kall, køen tom, `onResult` kalt tre ganger med riktig `requestId` og svar (forslagsteksten uendret).
4. **K3.4 serverfeil og tre forsøk:** post A gir `failed`+`unknown`, post B gir `suggestion`. Runde 1: A får `attempts` 1, B sendes og fjernes. Runde 2 og 3: A får 2, så fjernes den etter tredje forsøk, og `onResult` får den faste meldingen «Noe gikk galt. Teksten din er uendret. Prøv igjen.»
5. **K3.5 én dårlig post stopper ikke resten:** A kaster `Error` hver gang; B og C sendes i samme runde.
6. **K3.6 låsen:** to `processQueue` startet samtidig (`Promise.all`) gir nøyaktig ett `send`-kall per post.
7. **K3.7 fjerning på `requestId`:** post med id X sendes; mens `send` venter, erstattes posten (ny id Y, ny tekst). Svaret på X fjerner ikke Y; Y ligger igjen og sendes neste runde. `onResult` for X er merket som eldre tekst (forslaget vises uten «Bruk», se K5.2).
8. **K3.8 bare tre felt sendes:** argumentet til `send` har nøyaktig nøklene `requestId`, `targetId`, `text` (`Object.keys` sortert), ikke `queuedAt`, `attempts`, `employeeId`, `organizationId`, `fields`.
9. **K3.9 tømming under behandling:** `send` venter; `clear()` kalles; så svarer `send`. `onResult` kalles ikke, og ingenting skrives tilbake til lageret (lageret er tomt etterpå, `attempts` ikke økt på noen post).
10. **K3.10 eier sjekkes før sending:** en post med annen `employeeId` ligger i lageret; `processQueue` sender den ikke og den er borte etterpå (samme vei som K1.8, men gjennom behandlingen).

## 4. Statiske sjekker

**`eslint-rules/module-boundaries.test.ts` (utvides, RuleTester):**

1. **K4.1 gyldig** i `src/core/ai/client/x.ts`: import fra `./queue`, `../limits`, `@/shared/...`, `zod`; `import type` fra `../types` og `../features`.
2. **K4.2 ugyldig** i `src/core/ai/client/x.ts`: verdi-import fra `../features`, `../types`, `..` (`src/core/ai/index.ts`), `../request-suggestion`, `@/db`, `server-only`, `@/modules/...`.
3. **K4.3 hvem får importere `@/core/ai/client`:** gyldig fra `src/app/(ansatt)/prove/ki/ai-trial-client.tsx` og `src/app/(ansatt)/log-out-button.tsx`; ugyldig fra en annen side i `src/app` og fra `src/modules/...`. Feilmeldingen nevner ADR 0006 del 10.

**`src/core/ai/static-checks.test.ts` (utvides):**

4. **K4.4** `src/core/ai/index.ts` eksporterer ikke noe fra `./client`.
5. **K4.5** ingen fil i `src/core/ai/client/` inneholder `.complete(`, `console.` eller `ai_trial`.
6. **K4.6 tillatt-listen:** for hver kode i `AI_FEATURES` er `CLIENT_ALLOWED_FIELDS[kode]` lik `AI_FEATURES[kode].allowedFields` (samme innhold, samme rekkefølge), og ingen ekstra koder.
7. **K4.7** `features.ts` (med ledetekstene) er ikke importert som verdi fra noen fil under `client/` (dekkes av K4.2, men sjekkes også her så feilen er lett å lese).
8. **K4.8 ingen tekst utenfor IndexedDB:** ingen fil i `client/` eller `ai-trial-client.tsx` bruker `localStorage`, `sessionStorage`, `history.pushState`/`replaceState` eller `searchParams` med køtekst (enkelt søk i kildeteksten etter `localStorage` og `sessionStorage` i `client/`).

**`src/core/ai/request.test.ts` (utvides):**

9. **K4.9** `AI_FIELD_MAX_LENGTH` fra `request.ts` er samme verdi som fra `limits.ts`, og `limits.ts` har ingen `import`.

## 5. Kortet (T-0004, T-0005), `src/shared/ui/ai-suggestion.test.ts` (utvides)

1. **K5.1 køtekst:** `AI_SUGGESTION_TEXTS.queued` er «Venter på KI. Forslaget kommer når nettet er tilbake.»; kortet i tilstand `queued` viser den, og ingen «Bruk».
2. **K5.2 T-0004:** forslag laget fra «A», feltet er nå «A og mer»: visningen er `stale`, kortet viser «Forslaget gjelder teksten før du skrev videre.», har «Nytt forslag» og **ikke** «Bruk». Feltet uendret: «Bruk» som før. Gjelder både vanlig og køet forslag (`it.each` over begge kilder).
3. **K5.3 T-0005:** etter «Bruk» er feltet endret: «Angre» gir `status_only`, meldingen «Statusen er satt tilbake. Teksten din er uendret.», og teksten som returneres er den endrede. Uendret felt: «Angre» gir gammel tekst tilbake som før.
4. **K5.4** eksisterende 10.9 («Krever nett …») tilpasses: på `/prove/ki` brukes `queued`, men teksten `offline` beholdes for andre bruk (eller fjernes; testen følger det utvikleren velger og står i kortet).

## 6. Serverhandlingen, `src/app/(ansatt)/prove/ki/actions.test.ts` (utvides, testdatabasen)

1. **K6.1 `reason` på `TrialFailure`** (`it.each`): innlogget uten ansattrad eller uten `report.edit` → `no_access` og **0 nye rader** i `ai_usage_log`; tom tekst eller tekst over `AI_FIELD_MAX_LENGTH` → `invalid`; `requestId` som allerede er brukt av en annen ansatt eller organisasjon (`AiRequestRejectedError`) → `invalid`; leverandør eller kjerne som kaster uventet (spion) → `unknown`. Meldingen er den samme faste norske teksten som før i alle fire.
2. **K6.2 utløpt økt** (`trialGrant` gir `null`) → `failed` + `no_access`, ingen rad.
3. **K6.3 ekstra felt i kallet:** kall med `organizationId` fra en annen organisasjon og `employeeId` fra en annen ansatt i tillegg til de tre feltene: raden har øktens `organization_id` og `employee_id`. (Utvider den eksisterende testen «organisasjons-id fra klienten ignoreres» med `employeeId`.)
4. **K6.4 forslag fra køen i samme forslagsflyt:** kall med en `requestId` laget slik køen lager den (v4), så «Bruk», «Behold min tekst» og «Angre» gjennom de eksisterende handlingene: status i `ai_usage_log` og linjer i `audit_log` er de samme som for et vanlig forslag.
5. **K6.5 admin stenges ikke ute:** admin uten andre roller sender en køet forespørsel og får `suggestion` (falsk leverandør).
6. **K6.6 rolle** (`it.each` over takstmann, leder, admin med `report.edit`; kontor uten): de med rettighet får `suggestion`, kontor uten får `no_access` og ingen rad. Ingen ny rettighet, så dette er samme sjekk som i dag, men låst for køens svarform.

**Pekes til i PR-en, ingen nye tester** (serveren er uendret, kortet): `src/core/ai/request-suggestion.test.ts` 6.11 (samme `requestId` etter hverandre), 6.12 (samtidig), V5.7 («KI er av» gir `disabled` og ingen rad), og `expectTenantIsolation` for `requestSuggestion` i samme fil (linje ca. 964 og 990). Test-leder godkjenner ikke hvis noen av disse er fjernet eller hoppet over.

## 7. Utlogging, `src/app/(ansatt)/log-out-button.test.ts` (ny, ren)

1. **K7.1** `logOutAndClear`: `clearQueue` kalles før `signOut`; begge kalles én gang.
2. **K7.2** `clearQueue` kaster eller avviser: `signOut` kalles likevel; ingen tekst i feilen som logges.
3. **K7.3 statisk:** `log-out-button.tsx` importerer køen bare med dynamisk `import(` (ingen statisk `import ... from "@/core/ai/client"`), så fellesbunten ikke vokser.

## 8. E2e, `e2e/fase-2a-ki-ko.spec.ts` (ny, prosjektene `pc` og `ipad`)

Nett av med `context.setOffline(true)`. Køen leses med `aiQueueEntries(page)` i `e2e/helpers.ts` (rått IndexedDB-API mot `local-ai-queue`/`ai_queue`). Rader sjekkes med `aiUsageRowsForTarget`. Falsk leverandør som i `fase-2a-forslagsmonster.spec.ts`. Eksisterende test 12.8 i `e2e/fase-2a-forslagsmonster.spec.ts` og `-testplan.spec.ts` («knappen sperret uten nett») skal endres til å vente «Venter på KI …»; den skal ikke slettes.

1. **K8.1 kø og levering:** takstmann åpner `/prove/ki`, skriver oppdiktet tekst, nett av, trykker «Foreslå bedre språk» én gang: kortet viser «Venter på KI. Forslaget kommer når nettet er tilbake.», køen har én post, 0 rader i `ai_usage_log`. Feltet kan skrives i. Nett på: forslaget vises uten trykk, køen er tom, én rad.
2. **K8.2 overlever ny lasting:** legg i kø uten nett, nett på igjen med ruten til serverhandlingen holdt igjen (`page.route` som venter), last siden på nytt: teksten står i feltet; slipp ruten: forslaget kommer og køen er tom. (Retter T-0035 punkt 4.)
3. **K8.3 erstatning:** uten nett, trykk, skriv mer, trykk igjen: én post med den nye teksten og en annen `requestId` enn første. Nett på: én rad, forslaget gjelder den nye teksten.
4. **K8.4 utlogging tømmer:** legg i kø, logg ut med knappen, logg inn igjen som samme person: køen er tom, 0 rader.
5. **K8.5 delt iPad, ny ansatt uten utlogging:** legg i kø som takstmann A, slett øktkaken (`context.clearCookies`), logg inn som ansatt B i samme organisasjon (`logInAsManager` eller egen oppdiktet takstmann), åpne `/prove/ki` med nett: A sin tekst vises ikke i feltet eller kortet, køen er tom, 0 rader i `ai_usage_log` for målet, og ingen rad med B som eier.
6. **K8.6 annen organisasjon på samme iPad:** som K8.5, men B er `NO_AI_INSPECTOR_EMAIL` i en annen organisasjon: køen er tom, 0 rader. (Tenant-isolasjon på enheten.)
7. **K8.7 KI av før nettet kommer:** legg i kø i Byggcon uten nett, slå av KI for organisasjonen i databasen (og slå den på igjen i `finally`), nett på: kortet viser «KI er av.», køen er tom, ingen `ok`-rad.
8. **K8.8 T-0004:** få et forslag, skriv videre i feltet: «Bruk» finnes ikke, «Nytt forslag» finnes, egen tekst står uendret.
9. **K8.9 IndexedDB-utgaven:** posten i `ai_queue` har `requestId`, `feature`, mål, `organizationId`, `employeeId`, `queuedAt`, `attempts`, og ingen tekst finnes i `localStorage`, `sessionStorage` eller `page.url()` (sjekk med `page.evaluate`). Konsollen (`page.on("console")`) har ingen linje med teksten.
10. **K8.10 request til serveren:** fang kallet til serverhandlingen etter at nettet er tilbake; kroppen inneholder ikke `queuedAt`, `employeeId` eller `organizationId`.
11. **K8.11 to faner:** samme kontekst, to sider med kø, nett på i begge: én rad i `ai_usage_log` for `requestId`.
12. **K8.12 admin:** admin legger i kø og får forslag når nettet er tilbake (admin stenges ikke ute).
13. **K8.13 iPad-størrelse:** på prosjektet `ipad` (stående): «Venter på KI»-linjen og «Nytt forslag» er synlige uten rulling sideveis, og trykkflatene er minst 44 px (samme mål som 12.11).

## 9. Det testplanen bevisst ikke tester

- Ny `expectTenantIsolation` og endring i `tests/tenant-tables.ts`: ingen ny tabell og ingen ny spørring (kortet). Dekkes av den eksisterende testen for `requestSuggestion` pluss K6.3, K8.5 og K8.6.
- Myk sletting: ingen ny tabell; raden i `ai_usage_log` slettes ikke av køen. Den lokale køen er mellomlagring og slettes hardt med vilje (kortet, Data). K1.8 viser at slettingen er ekte.
- Bakgrunnssynk med siden lukket, sperring av enheten og kryptering: utenfor omfang (fase 2b).

## Krav for godkjenning

- Alle K-tester over finnes og er grønne, sammen med `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` (begge prosjekter).
- Tilgang (K6.1, K6.5, K6.6, K8.12) og isolasjon (K6.3, K8.5, K8.6, pluss de eksisterende testene i avsnitt 6) må være med. Mangler noen av dem, avvises PR-en.
- Ingen eksisterende test for «uten nett» er slettet; de er endret til ny oppførsel.
- `package.json` er 0.5.14.
