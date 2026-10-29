# Testplan: Prøve E – regler uten nett

- **Oppgavekort:** `docs/funksjoner/fase1-prove-e-regler.md` (pkt.-numrene under viser til «Omfang», «AK» til «Akseptkriterier»)
- **Fase:** 1 – Prøve uten nett, punktet «Prøve E – regler uten nett»
- **Branch:** `fase1-prove-e-regler` (bygger på `main`)
- **Dato:** 29.10.2026
- **Laget av:** test-leder, før koding. Testnavnene og filnavnene er bindende for testskriver. Utvikler leser avsnitt 7 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Reklamasjoner (testene viser at iPaden og serveren gir nøyaktig samme svar for hver testsak, også ved grensen, komma, negativt tall og ugyldig tekst, så rapporten aldri kan si noe annet enn det takstmannen så på stedet). Tid (testene viser at svaret kommer under feltet uten nett og uten ekstra trykk). KI først: ikke KI her; testene låser at motoren er ren og felles, slik at KI-forslag senere kan kobles inn ved siden av og kontrolleres på samme måte.

Kjøringen på ekte iPad (Safari, flymodus) er **ikke** del av de automatiske testene. Den gjør Ståle etter resultatmalen `docs/funksjoner/fase1-prove-e-regler-resultat.md` (avsnitt 6). Planen dekker det som kan vises i Vitest og Playwright (Chromium, prosjektene `pc` og `ipad`).

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts` og `tests/offline-trial.ts` (`setupOrganization`, `ALL_ROLES`, `createDeactivatedEmployee`): brukes uendret. Ingen nye fabrikker.
- `tests/tenant-isolation.ts`: **ikke** brukt. Oppgaven har ingen databasespørring (pkt. 4). Legger utvikleren likevel til en spørring som tar `organizationId`, kreves ett kall til `expectTenantIsolation` i testfilen, ellers avvises PR-en.
- `e2e/helpers.ts`: `logIn`, `createTrialForm`, `useCandidate`. Utvides med to små hjelpere (5.1). Eksisterende hjelpere endres ikke.
- `src/modules/offline-trial/answers.test.ts`: får bare nye testsaker (2.4). Dagens tester og `answers.ts` endres ikke.
- Alle dagens Vitest- og e2e-tester skal være grønne uendret. Endres en eksisterende forventning, er det et funn.

## 2. Enhetstester (Vitest, rene funksjoner, ingen database, ingen DOM)

Testsakene leses **alltid** fra dataene i `src/modules/offline-trial/rules/` (felles fasit, pkt. 2). Ingen test skriver av tabellen på nytt, med ett unntak: 2.2 «testsakene er de fjorten fra oppgavekortet» som låser at dataene ikke endres i det stille.

### 2.1 `src/modules/offline-trial/rules/trial-rules.test.ts` (reglene som data, pkt. 1, AK 1–2)

| Testnavn | Viser |
|---|---|
| «det finnes nøyaktig to prøveregler med faste koder» | kodene er `trial_water_heater_age` og `trial_moisture_floor_limit`, ingen andre, ingen duplikat. |
| «reglene leser riktig felt og har riktig type» | `trial_water_heater_age` → `field: "water_heater_age"`, `kind: "age_vs_lifespan"`; `trial_moisture_floor_limit` → `field: "moisture_floor"`, `kind: "number_vs_limit"`. |
| «feltene finnes i testskjemaet som tallfelt» | begge `field` finnes i `listTrialFields(trialForm)` med `type: "number"`. Fanger feilstavet felt. |
| «prøvetallene ligger i TRIAL_ONLY-konstanten» | `limit` for de to reglene er lik verdiene i den eksporterte `TRIAL_ONLY_…`-konstanten, og er 7 og 42. |
| «hver regel er merket som oppdiktet prøveverdi» | `source_ref === "oppdiktet prøveverdi"` for begge. |
| «kildefilen merker tallene som oppdiktet» | kildeteksten til regelfila inneholder «Oppdiktet prøveverdi, ikke fag». |
| «alle meldinger starter med Prøveregel» | hver melding (over, ikke over, ikke vurdert) for begge regler starter med «Prøveregel». |
| «meldingene er ordrett som i kortet» | de fem meldingene i pkt. 1 er eksakt like (tabell). |
| «ingen gjetteord eller vurderingsord i meldingene» | ingen melding inneholder «antas», «trolig», «avvik», «TG», «bør» (uavhengig av store og små bokstaver; «TG» som eget ord). **Obligatorisk (AK 2).** |
| «ingen TG eller utfall i reglene» | ingen regel har nøkler som `tg`, `suggest_tgiu`, `suggest_outcome`, `outcome`, `show`, `validate`. |

### 2.2 `src/modules/offline-trial/rules/trial-rule-cases.test.ts` (testsakene som data, pkt. 2, AK 4)

| Testnavn | Viser |
|---|---|
| «testsakene er de fjorten fra oppgavekortet» | tabell med (regel, navn, inndata, forventet) for alle 14 rader i pkt. 2 er lik dataene. Låser fasiten. **Obligatorisk.** |
| «inndata er tekst, aldri tall» | `typeof input === "string"` for alle testsaker. |
| «hver regel har saker for alle tre tilstander» | for hver regel finnes minst én sak med `triggered`, `not_triggered` og `not_evaluated`. |
| «hver regel har lik grensen, negativt tall og ugyldig tekst» | navnene «lik grensen», «negativt tall», «ugyldig tekst» finnes for begge regler. |
| «testsakene går gjennom kjeden og gir forventet tilstand» | `it.each` over alle testsaker: tekst → `parseTrialNumber` → `evaluateTrialRules(trialRules, { [field]: tall })` → tilstanden for regelen er `expect_state`. Testnavnet tar med regel og saksnavn. **Obligatorisk (AK 4).** |
| «meldingen passer tilstanden» | for hver testsak: `triggered` gir «over …», `not_triggered` gir «ikke over …», `not_evaluated` gir «Prøveregel: ikke vurdert». |

### 2.3 `src/modules/offline-trial/rules/evaluate-trial-rules.test.ts` (motoren, pkt. 3, AK 3)

| Testnavn | Viser |
|---|---|
| «over betyr strengt større enn» | for begge regler: `limit` → `not_triggered`, `limit + 0.01` → `triggered`, `limit - 0.01` → `not_triggered`. |
| «null, manglende felt og negativt tall gir ikke vurdert» | `{}`, `{ field: null }`, `{ field: -1 }`, `{ field: -0.01 }` → `not_evaluated` for begge. |
| «null er en gyldig måling» | `0` → `not_triggered` for begge (ikke `not_evaluated`). |
| «verdi som ikke er et endelig tall gir ikke vurdert» | `NaN`, `Infinity`, tekst «7» (feil type i svarene) → `not_evaluated`, kaster ikke. |
| «svarer for hver regel i rekkefølge, med kode» | resultatet har én oppføring per regel med `key`, `state`, `message`. |
| «andre felt påvirker ikke svaret» | ekstra nøkler i `answers` (for eksempel `roof_tg`) endrer ingenting. |
| «samme inndata gir samme svar to ganger» | to kall med samme objekt gir likt resultat (ingen tilstand), og `answers` er uendret etterpå (`Object.freeze` på inndata kaster ikke). |
| «motoren importerer bare fra egen mappe og answers» | leser kildefilen til motoren: alle `import` er relative innenfor `rules/` eller peker på `../answers`. **Obligatorisk (AK 3).** |
| «motoren bruker ingen nettleser- eller server-API» | kildeteksten (uten kommentarer) inneholder ikke `window`, `document`, `fetch`, `localStorage`, `navigator`, `fs`, `process`, `@/db`, `require(`, `Date.now`, `Math.random`. **Obligatorisk (AK 3).** |
| «skjemaet og ruten bruker samme motor» | kildeteksten til visningskomponenten (pkt. 5) og til ruten (pkt. 4) importerer `evaluateTrialRules` fra samme modulsti. Ingen kopi av motoren noe annet sted (søk etter `function evaluateTrialRules` gir én treff i `src/`). |

### 2.4 `src/modules/offline-trial/answers.test.ts` (bare nye saker, pkt. 8, AK 9)

| Testnavn | Viser |
|---|---|
| «parseTrialNumber leser verdiene prøvereglene bruker» | «42» → 42, «42,0» → 42, «42.01» → 42.01, «7,5» → 7.5, «-1» → -1. |
| «parseTrialNumber avviser ugyldig tekst fra prøvereglene» | «12,» → `null`, «1e3» → `null`. |

`answers.ts` skal være uendret i diffen (`git diff main -- src/modules/offline-trial/answers.ts` tom). Feiler en sak, stopper utvikleren og melder fra (pkt. 8).

## 3. Visningen (pkt. 5)

Ingen komponenttest i Vitest: prosjektet har ingen DOM i Vitest (ingen jsdom), og det skal ikke komme en ny avhengighet for dette (samme valg som `sync-status.test.ts`). Visningen dekkes i e2e (5.2): markørene, `aria-live`, at svaret endres ved hver endring, og at ingen forespørsel går til serveren. Hvis komponenten får logikk utover å vise `{ key, state, message }` fra motoren, flyttes logikken til en ren funksjon i `rules/` og testes i 2.3.

## 4. Integrasjonstester (Vitest mot testdatabasen, ruten, pkt. 4, AK 5, 7, 8)

### 4.1 `src/app/api/prove/regler/route.test.ts`

Ruten kalles direkte (`POST(new Request(...))`). Innloggingen styres ved å mocke bare `getCurrentActor` i `@/core/auth/session` (`vi.mock`); aktørene lages med `setupOrganization` og `createDeactivatedEmployee` mot testdatabasen, så tilgangssjekken i `src/core/access` kjøres ekte. Ingen annen mock.

| Testnavn | Viser |
|---|---|
| «uten innlogging gir 401» | `getCurrentActor` → `null` → 401 og `{ feil: "Du må logge inn." }`. |
| «alle fire roller får 200 i egen organisasjon» | `it.each(ALL_ROLES)`: takstmann, kontor, leder og admin → 200 med svar for begge regler. **Obligatorisk (AK 8, admin stenges aldri ute).** |
| «annen organisasjon gir 403» | ansatt i A sender `organizationId` for B → 403, ingen regelsvar i kroppen. **Obligatorisk (tenant).** |
| «organisasjon som ikke finnes gir 403» | tilfeldig gyldig uuid → 403 (ikke 404, ikke 200). |
| «mykt slettet ansatt gir 403» | `createDeactivatedEmployee` i egen organisasjon → 403. **Obligatorisk.** |
| «ugyldig innhold gir 400» | `it.each`: tekst i stedet for tall (`"7"`), ekstra felt i `answers`, ekstra felt i kroppen, manglende `organizationId`, `organizationId` som ikke er uuid, `answers` mangler eller er ikke objekt, kroppen er ikke JSON, kroppen er en liste. Alle → 400 med `{ feil }`. |
| «tilgang sjekkes før svar gis» | gyldig kropp for annen organisasjon gir 403, aldri 200, også når `answers` er gyldig. Ugyldig kropp for annen organisasjon gir 400 eller 403, aldri 200. |
| «null og manglende felt gir ikke vurdert» | `answers: {}` og `answers: { water_heater_age: null, moisture_floor: null }` → 200, begge `not_evaluated`. |
| «negativt tall gir ikke vurdert, ikke 400» | `-1` for begge felt → 200, `not_evaluated`. |
| «ruten svarer likt motoren for alle testsakene» | én løkke over alle testsakene: tekst → `parseTrialNumber` → JSON-kropp → ruten. Svaret for regelen er likt `evaluateTrialRules` og likt `expect_state`. Feiler på første ulike sak med saksnavnet. **Obligatorisk (AK 5).** |
| «svaret mellomlagres ikke» | `Cache-Control: private, no-store` på 200 og på feilsvar. |
| «kroppen logges aldri, heller ikke ved 400» | spion på `console.*`, `logger.*`, `process.stdout.write` og `process.stderr.write` (samme mønster som `apply-changes.test.ts`). Send en gyldig kropp og en ugyldig kropp med en kjent markørtekst (for eksempel `"markor-7f3a"` i et ekstra felt); markøren og tallene finnes ikke i noe som logges. **Obligatorisk (AK 7).** |
| «ruten skriver ingenting til databasen» | antall rader i `trial_forms`, `trial_answers` og `audit_log` (eller tilsvarende tabeller som finnes) er likt før og etter et vellykket kall. |

Tenant-isolasjon: dekket av «annen organisasjon gir 403» og «tilgang sjekkes før svar gis», fordi ruten ikke leser data. Se 1 om `expectTenantIsolation`.

## 5. E2E (Playwright, prosjektene `pc` og `ipad`)

### 5.1 Nye hjelpere i `e2e/helpers.ts`

- `ruleResult(page, ruleKey)`: `page.locator('[data-rule-key="<ruleKey>"]')`.
- `numberInput(page, fieldKey)`: tallfeltet for en feltkode, slik testskjema-testene allerede finner det (ingen ny `data-testid` hvis feltet kan finnes på etiketten).

### 5.2 `e2e/fase-1-prove-e-regler.spec.ts`

Logger inn som admin (`logIn`), bruker `useCandidate(context, "custom")` (eneste kandidat som virker fullt uten synktjeneste i e2e), og lager skjemaet med `createTrialForm`. Testsakene importeres fra `../src/modules/offline-trial/rules/…` (samme fasit). Testene leser `data-rule-state`, aldri den norske teksten.

| Testnavn | Prosjekt | Viser |
|---|---|---|
| «regelsvaret vises under begge feltene» | pc, ipad | med nett: to linjer med `data-rule-key` for de to reglene, begge `not_evaluated` på tomt skjema, `aria-live="polite"`. |
| «uten nett gir hver testsak riktig svar» | pc, ipad | `context.setOffline(true)`; for hver testsak: fyll inn teksten i feltet, les `data-rule-state` = `expect_state`. Teller forespørsler til `/api/prove/regler` (0). Nettet på igjen i `finally`. **Obligatorisk (AK 6).** |
| «svaret endres uten ekstra trykk» | ipad | uten nett: skriv «6» → `not_triggered`, endre til «8» → `triggered` uten å trykke noe annet enn i feltet. |
| «nettleser og server gir samme svar for alle testsakene» | **bare pc** (`test.skip` ellers, med begrunnelse) | uten nett: les `data-rule-state` per testsak (som over). Så nettet på, og samme testsaker til `/api/prove/regler` med `page.request.post` (innlogget, egen organisasjon). Hver sak: nettleser = server = `expect_state`. Feiler på første ulike sak med navnet. **Obligatorisk (AK 6).** |
| «ruten krever innlogging» | bare pc | `request.post` uten økt → 401. |
| «ruten gir 403 for annen organisasjon» | bare pc | innlogget admin sender tilfeldig uuid som `organizationId` → 403. |
| «regelsvaret etter omlasting uten nett» | pc, ipad | **Bare hvis** egenbygd kan lastes på nytt uten nett (samme vei som `fase-1-egenbygd.spec.ts`, «reload uten nett»). Fyll «7,5», nett av, last på nytt, `data-rule-state="triggered"`. Virker ikke omlasting, brukes `test.skip` med begrunnelse, og PR-en sier at det ikke er dekket (pkt. 6). |

Roller i e2e: bare admin. De fire rollene dekkes i 4.1 (ekte tilgangssjekk mot testdatabasen). `ensureInspector` brukes ikke (kjent småfunn fra synkstatus-PR-en).

## 6. Resultatmalen (pkt. 7, AK 10)

`docs/funksjoner/fase1-prove-e-regler-resultat.md` skrives av testskriver. Test-leder sjekker for hånd og med én test:

| Testnavn | Fil | Viser |
|---|---|---|
| «resultatmalen har samme testsaker som dataene» | `src/modules/offline-trial/rules/trial-rule-cases.test.ts` | leser malen og finner, for hver testsak, en tabellrad med saksnavnet, inndataen og forventet svar på norsk («over prøvegrensen», «ikke over prøvegrensen», «ikke vurdert»). Fanger at malen og dataene glir fra hverandre. |

Sjekkes for hånd: trinn for flymodus, avkryssing per sak, rad for iPad-modell, iPadOS- og Safari-versjon, ingen kundeopplysninger, ingen fagtekst.

## 7. Krav til koden som testene bygger på

- **K1** Reglene, `TRIAL_ONLY_…`-konstanten og testsakene eksporteres fra `src/modules/offline-trial/rules/` (for eksempel `trialRules`, `trialRuleCases`). Testsakene har `rule_key`, `name`, `input` (tekst), `expect_state`.
- **K2** `evaluateTrialRules(rules, answers)` ligger i egen fil i `rules/` og returnerer `{ key, state, message }[]`. Ingen standardargument som leser globale verdier.
- **K3** Visningen er en egen komponent (for eksempel `trial-rule-result.tsx`) med `data-rule-key`, `data-rule-state` og `aria-live="polite"`. Endringen i `trial-form-view.tsx` er bare å sette den inn under de to feltene.
- **K4** Ruten `src/app/api/prove/regler/route.ts` henter aktøren med `getCurrentActor`, validerer med Zod `.strict()` (kropp og `answers`), kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og bruker `trialErrorResponse` / `notLoggedIn`. Ingen `console` eller `logger` med kroppen. Ingen `@/db`-import.
- **K5** Ingen ny avhengighet, ingen migrering. Versjonen i `package.json` økes (patch).

## 8. Kjøring og godkjenning

Test-leder kjører til slutt `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e`, leser testene og sjekker:

- alle testnavn merket **obligatorisk** finnes og er grønne;
- 401, 403 (annen organisasjon og mykt slettet) og 200 for alle fire roller finnes (uten dem avvises PR-en);
- ingen `expectTenantIsolation` trengs, med mindre en spørring er lagt til (da kreves den);
- `answers.ts`, `sync-status.tsx` og synkkandidatene er uendret;
- ingen test bruker `waitForTimeout` for å vente på regelsvaret (bruk `expect(...).toHaveAttribute`);
- ingen tekst fra NS 3600, IVIT eller SmartTakst, og ingen ekte tall (20 år, 15 %) i kode, testdata eller malen.

Myk sletting: ruten sletter og lagrer ingenting; dekket av «ruten skriver ingenting til databasen» og «mykt slettet ansatt gir 403».
