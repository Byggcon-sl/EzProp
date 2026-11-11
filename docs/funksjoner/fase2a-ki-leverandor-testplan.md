# Testplan: Beslutningsnotat om KI-leverandør og Anthropic-adapteren

- **Oppgavekort:** `docs/funksjoner/fase2a-ki-leverandor.md`
- **Dato:** 11.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** KI i bunnen (hovedsaken: testene låser at den ekte leverandøren bare slås på når alle låsene er på plass, at bare vasket tekst forlater oss, og at nøkkelen aldri lekker. Da kan 2a-2 bygges på ekte KI uten risiko). Reklamasjoner: avkortede svar og feil blir faste feilkoder, aldri halve setninger i en rapport. De ansatte: forslagsflyten er uendret, og eksisterende tester for godta, endre og avvis skal være grønne.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. **Ingen test gjør nettkall til Anthropic.** All HTTP er falsk (`fetch` sendt inn, eller `vi.stubGlobal("fetch", ...)` i integrasjonstestene). Nøkkelen er oppdiktet og tydelig merket: `sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q` (formen likner, så loggmønsteret prøves). Unike merker for lekkasjetester: `MERKE-LEVERANDORMELDING-K7Q` (i feilkropp fra falsk HTTP), `MERKE-MODELL-K7Q` (brukes som `settings.model`, så ingen ekte modell-id står i testene). Navn og adresser er oppdiktet og kommer fra `tests/known-values.ts`.

Ingen nye skjermer, så ingen ny e2e. Eksisterende e2e for `/prove/ki` og KI-køen kjøres på PC og iPad-størrelse, også uten nett, og skal være grønne uten endring. «Regeltestene» her er låsene i `resolveAiProvider` og feilkodetabellen i adapteren, skrevet som testsaker (`it.each`).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, «Grensesnitt» og Omfang 3–7. Avvik føres i kortet under «Avgjort etter gjennomgangen».

- `src/core/ai/providers/anthropic.ts`: `ANTHROPIC_PROVIDER_CODE`, `ANTHROPIC_SECRET_REF`, `AiPricing`, `AnthropicProviderOptions`, `createAnthropicProvider(options)`. Adressen, versjonshodet, grensen for tokens ut, standard tidsgrense og grensen for svarstørrelse eksporteres som konstanter, slik at testene kan sammenligne uten å skrive verdiene to steder.
- **`fetch` slås opp ved kallet** (`options.fetch ?? globalThis.fetch` inne i `complete`, ikke når adapteren lages). Ellers virker ikke `vi.stubGlobal` i integrasjonstestene.
- `provider-resolution.ts`: `ResolvedAiProvider` med `features: readonly string[] | null`.
- Lekkasjesjekken flyttes til én eksportert funksjon i `src/core/ai` (for eksempel `findPromptLeaks(text, known)` i egen fil). `evals/run.ts` importerer den derfra.
- Testhjelpere:
  - `tests/ai.ts`: `enableAi` får `settings?` og `secretRef?`, slik at en `anthropic`-tilkobling kan lages med gyldige eller ugyldige innstillinger. Ny `anthropicSettings(overrides?)` gir gyldige innstillinger: `{ model: "MERKE-MODELL-K7Q", features: ["language_polish"], pricing: { inputPerMillion: 30, outputPerMillion: 150, currency: "NOK" } }` (oppdiktede tall).
  - `tests/fake-anthropic.ts` (ny, eller utvidelse av `tests/fake-fetch.ts`): falsk `fetch` som registrerer hvert kall (adresse, metode, hoder med små bokstaver, kropp, `redirect`, `cache`, `signal`) og svarer etter en plan: vellykket svar med tekstblokker og `usage`, statuskode med kropp, kastet feil, eller et løfte som aldri løses (for tidsavbrudd).
  - `tests/setup-env.ts` (eller ny oppsettfil i `setupFiles`): pakker `globalThis.fetch` slik at kall til Anthropics vertsnavn kaster, og sletter `ANTHROPIC_API_KEY` fra miljøet. Testene setter nøkkelen med `vi.stubEnv` og rydder med `vi.unstubAllEnvs`.

## 1. Adapteren, `src/core/ai/providers/anthropic.test.ts` (ny, enhet, falsk `fetch`)

### 1.1 Forespørselen (A1)

1. **adresse og metode:** ett kall, `POST`, til den faste adressen (konstanten). Adressen endres ikke av noe i `options`.
2. **hodene:** `x-api-key` er nøkkelen, versjonshodet er satt, `content-type` er JSON. Ingen andre hoder har nøkkelen, og ingen hoder har id-er eller organisasjonsnavn.
3. **kroppen har bare modell, grense og melding:** `JSON.parse(body)` har nøyaktig nøklene for modell, grense for tokens ut og meldingene (sammenlign nøkkellisten, ikke bare innhold). Modellen er `MERKE-MODELL-K7Q`. Grensen er den faste konstanten. Ledeteksten er den som ble sendt inn, uendret.
4. **ingen identitet i kroppen eller hodene:** kroppen og alle hodene sett som tekst inneholder ikke nøkkelen, ikke `organizationId`, ansatt-id, oppdrags-id, `requestId` eller organisasjonsnavnet fra testen (alle er med i kallet til `requestSuggestion` i 3.4; her sjekkes at adapteren ikke har noe felt for dem). Ingen `metadata`-nøkkel.
5. **`redirect: "error"` og `cache: "no-store"`** står i `init`, og `signal` er et `AbortSignal`.
6. **nøkkelen ligger ikke på objektet:** `JSON.stringify(provider)`, `Object.keys(provider)` og `util.inspect(provider, { depth: 5 })` inneholder ikke nøkkelen. `provider.code === "anthropic"` og `provider.model === "MERKE-MODELL-K7Q"`.
7. **`fetch` slås opp ved kallet:** adapter laget uten `fetch`, deretter `vi.stubGlobal("fetch", falsk)` → den falske brukes.

### 1.2 Svaret (A2)

1. **vellykket svar:** én tekstblokk og `usage` med 120 inn og 40 ut gir teksten, `inputTokens = 120`, `outputTokens = 40`, `currency = "NOK"`.
2. **kostnad** (`it.each`): `(120 × 30 + 40 × 150) / 1 000 000`; null tokens gir 0; pris 0 gir 0; store tall gir riktig desimal uten avrunding til heltall. Sammenlign med `toBeCloseTo`.
3. **flere tekstblokker** settes sammen i rekkefølge; blokker av annen type (for eksempel `tool_use`, `thinking`) ignoreres.
4. **`no_match`:** tomt tekstsvar, bare mellomrom, og svaret som betyr «ingen endring» (samme regel som den falske leverandøren) gir `no_match`.

### 1.3 Feil (A3, regeltabell)

Én `it.each` med testsak → forventet kode. For hver rad sjekkes også: feilen (melding, `cause`, `String(error)`) og alle kall til en `console`-spion (`log`, `info`, `warn`, `error`, `debug`) inneholder verken `MERKE-LEVERANDORMELDING-K7Q` eller nøkkelen. `fetch` er kalt nøyaktig én gang (ingen nye forsøk).

| testsak | kode |
|---|---|
| tidsavbrudd (falske tidtakere, løftet løses aldri, tiden går forbi `timeoutMs`) | `timeout` |
| 429 | `rate_limited` |
| 500, 502, 503, 529 | `unavailable` |
| `fetch` kaster `TypeError` (nettverk) | `unavailable` |
| `fetch` kaster fordi adressen sender videre (`redirect: "error"`) | `unavailable` |
| 400, 401, 403 | `rejected` |
| 404, 418 | `unknown` |
| 200 med ugyldig JSON | `unknown` |
| 200 med uventet form (ingen `content`, `content` er ikke liste) | `unknown` |
| 200 der svaret stoppet på grensen for tokens ut (avkortet) | `unknown` |
| 200 uten `usage`, eller med `usage` uten tall | `unknown` |
| 200 med negative tokens | `unknown` |
| 200 med svar større enn grensen (oppgitt lengde, og strøm uten lengde som blir for lang) | `unknown` |

1. **ingen underkoder:** koden er alltid en av `AI_ERROR_CODES`, og feilen har ingen ekstra felt med leverandørens kode eller tekst.
2. **avkortet svar gir aldri tekst:** resultatet har ingen `text`, selv om tekstblokken finnes.
3. **tidsavbrudd avbryter kallet:** `signal.aborted === true` etter tidsavbruddet.

### 1.4 Loggeren (A4), `src/shared/lib/logger.test.ts`

1. **nøkkelformatet skjules:** loggmelding og felt med `sk-ant-api03-OPPDIKTET-TESTNOKKEL-K7Q` skrives uten nøkkelen. Vanlig tekst som begynner med `sk-` uten resten av formen skjules ikke (mønsteret er ikke for grådig).

## 2. Tilkoblingen, `src/core/integrations/connections.test.ts` (utvides, mot databasen)

1. **`anthropic` er kjent på porten `ai`** og står i listen over leverandører som krever hemmelighet. Ukjent kode på `ai` avvises som før.
2. **skjemaet** (`it.each` på `settingsSchemaFor("anthropic")`, regler som data):
   - godtatt: gyldige innstillinger; `features` mangler (blir tom liste); `features: []`.
   - avvist: `model` mangler, `""`, med mellomrom, `/`, over 100 tegn; `features` med ukjent kode; `pricing` mangler; `inputPerMillion` negativ, tekst eller `NaN`; `currency` annet enn `"NOK"`; ekstra felt i `pricing`; ekstra felt i `settings` (`baseUrl`, `apiKey`, `url`).
3. **`createConnection` og `updateConnection`:** `anthropic` med `secret_ref = ANTHROPIC_API_KEY` godtas av admin; annen `secret_ref` (for eksempel `MS_GRAPH_CLIENT_SECRET`, `ANTHROPIC_KEY`) avvises med `ConnectionValidationError` uten rad. `updateConnection` som bytter `secret_ref` bort fra `ANTHROPIC_API_KEY` avvises.
4. **`ANTHROPIC_API_KEY` står ikke på nektlisten** (`isValidSecretRef` gir `true`).
5. **listen over tilkoblinger viser aldri nøkkelens verdi** (`listConnections` med nøkkel satt i miljøet: verdien finnes ikke i svaret).
6. **tilgang per rolle** (kortet «Tilgang»): takstmann, kontor og leder får `AccessDeniedError` på `createConnection` med `anthropic`; admin uten andre roller lykkes (regel 11, admin stenges aldri ute).
7. **tenant-isolasjon:** `expectTenantIsolation` på `createConnection` med `anthropic` (`query` lager tilkoblingen og returnerer `[{ id }]`; etterpå har B nøyaktig én `ai`-tilkobling med `organization_id = B`).

## 3. Valg av leverandør og sperrene, mot databasen

### 3.1 Låsene, `src/core/ai/provider-resolution.test.ts` (utvides, R1)

Én `it.each`, én lås mangler om gangen, alt annet på plass. Forventet `disabled`, ingen unntak kastes ut, ingen `ai_usage_log`-rad, falsk `fetch` ikke kalt, og verken nøkkelen eller navnet `ANTHROPIC_API_KEY` står i noe som returneres eller i `console`-spionen.

| lås som mangler | resultat |
|---|---|
| `ai.enabled` mangler / `false` / `"true"` | `disabled` |
| ingen tilkobling | `disabled` |
| tilkoblingen er slettet mykt | `disabled` |
| tilkoblingen er inaktiv | `disabled` |
| ukjent leverandørkode | `disabled` |
| `model` mangler eller er tom (rå rad lagt inn direkte, forbi skjemaet) | `disabled` |
| `pricing` mangler eller er ugyldig (rå rad) | `disabled` |
| ekstra felt `baseUrl` i `settings` (rå rad) | `disabled` |
| `secret_ref` er en annen gyldig hemmelighet (rå rad) | `disabled` |
| `secret_ref` er på nektlisten, for eksempel `DATABASE_URL` (rå rad; `InvalidSecretRefError` fanges) | `disabled` |
| nøkkelen finnes ikke i miljøet (`SecretNotFoundError` fanges) | `disabled` |
| nøkkelen er `""` | `disabled` |
| nøkkelen er bare mellomrom | `disabled` (kortet sier «ikke-tom»; `readSecret` godtar i dag mellomrom, så sjekken må ligge i `resolveAiProvider`) |

1. **alt på plass:** `enabled`, `provider.code === "anthropic"`, `model === "MERKE-MODELL-K7Q"`, `features` lik listen fra innstillingene.
2. **`fake` som før (R5):** `enabled`, `provider === fakeAiProvider` (samme objekt), `features === null`.
3. **miljøet velger aldri** (A160, eksisterende 5.10 utvides): `ANTHROPIC_API_KEY` satt og `NODE_ENV=production`, men ingen tilkobling → `disabled`. Nøkkel satt og bare `fake`-tilkobling → `fake`.
4. **`readSecret` kalles bare med `ANTHROPIC_API_KEY`:** spion på modulen; aldri med verdien fra raden når den er en annen.

### 3.2 Sperren for ekte leverandør, `src/core/ai/request-suggestion.test.ts` (utvides, R2)

`it.each` over `ai_trial`, `answer` og fritekst uten oppdrag, med gyldig `anthropic`-tilkobling, nøkkel og funksjonen i `features`: resultatet er `blocked`, raden har `status = blocked`, falsk `fetch` er ikke kalt. Kontroll: det samme mot `fake` gir som før (ikke `blocked`).

1. **`isBlocked` bruker fast kode:** en adapter med `code: "fake"` som ikke er det samme objektet som `fakeAiProvider`, blir ikke sperret; alt annet enn `"fake"` blir sperret.

### 3.3 `settings.features` (R3)

1. **funksjon ikke i listen:** `features: ["phrase_suggestion"]` og forespørsel om `language_polish` → `disabled`, ingen rad, `fetch` ikke kalt.
2. **tom liste** og **manglende liste** (rå rad) → `disabled` for alle funksjoner.
3. **sperren kommer før vasken:** spion på vaskefunksjonen er ikke kalt.
4. **`fake` har ingen liste** og tar alle funksjoner som før.

### 3.4 Hele flyten med falsk HTTP (R4)

1. **vellykket kall:** forespørsel med oppdiktet navn, adresse, telefon og matrikkel i teksten. Kroppen som sendes inneholder ingen av verdiene (sjekk med verdiene fra `tests/known-values.ts`), bare plassholdere. Raden har `provider = anthropic`, `model = MERKE-MODELL-K7Q`, tokens fra svaret og kostnad etter `pricing`. Forslaget kan deretter godtas, endres og avvises med `recordDecision` som før.
2. **lekkasjesjekken stopper:** en ledetekst der en kjent verdi slipper gjennom vasken (lag den med en verdi vasken ikke kjenner, men lekkasjesjekken fanger, eller stub vasken) → `blocked`-rad, `fetch` ikke kalt.
3. **lekkasjesjekken er felles:** `evals/run.ts` importerer funksjonen fra det nye stedet (statisk test), og eksisterende evalueringstester er grønne.
4. **feil fra leverandøren:** 401 med `MERKE-LEVERANDORMELDING-K7Q` i kroppen → feilkoden `rejected` i raden; merket og nøkkelen står ikke i noen kolonne i `ai_usage_log`, ikke i `integration_connections.last_error`, og ikke i `console`-spionen. `last_error` er uendret.
5. **nøkkelen står ingen steder i databasen:** etter vellykket kall og etter feil: søk i alle tekst- og JSON-kolonner i `ai_usage_log`, `integration_connections` og `audit_log` etter nøkkelen gir null treff.

### 3.5 Tenant-isolasjon (R6, regel 2)

1. **`expectTenantIsolation` for veien med `anthropic`:** `seed` gir A en `anthropic`-tilkobling (nøkkel satt) og B en `fake`-tilkobling, begge med KI på. `query` kaller `requestSuggestion` med falsk HTTP og returnerer raden i `ai_usage_log` (`idOf = organizationId`). Etterpå: A sin rad har `provider = anthropic`, B sin rad har `provider = fake`, og falsk `fetch` er kalt bare for A.
2. **B uten noe får `disabled`:** A har alt på plass, B har bare `ai.enabled`. B får `disabled`, ingen rad i B, `fetch` ikke kalt. Speilvendt: B har alt, A har ingenting → A får `disabled`.
3. **organisasjons-id fra forespørselen brukes aldri:** `requestSuggestion` med grant for B og en forespørsel som nevner A sin id i et felt → tilkoblingen til B brukes.

### 3.6 Tilgang per rolle (R7)

1. **rolletabell som før** (eksisterende test, nå også med `anthropic`): takstmann, kontor, leder og admin kan be om forslag og gjøre beslutning med rettigheten; uten rettighet `AccessDeniedError`, ingen rad og intet `fetch`-kall.
2. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller kan slå KI av og på, lage `anthropic`-tilkoblingen og be om forslag.
3. **fjernet ansatt** får `AccessDeniedError` før noe `fetch`-kall.

## 4. Statiske tester

1. **S1, ingen modellnavn,** `tests/no-model-names.test.ts` (ny): leter i `src/`, `tests/`, `e2e/`, `docs/beslutningsnotat-ki-leverandor.md` og `docs/funksjoner/fase2a-ki-leverandor*.md`. Søkeordene bygges av biter i testen. Treffer prefikset til modell-id-ene og navnene på modellfamiliene, ikke ordene i filnavnet «CLAUDE.md» og mappen «.claude/». Egen kontrolltest: en tekst med et oppdiktet treff gir rødt, og «CLAUDE.md» gir grønt.
2. **S2, ingen nettkall:**
   - global sperre: `fetch` mot Anthropics vertsnavn i en test uten stub kaster en tydelig feil.
   - seed: `scripts`/seed-filen har ingen `anthropic`-tilkobling (kjør seed mot testdatabasen og tell rader med `provider = anthropic` → 0).
   - CI: `ANTHROPIC_API_KEY` står ikke med verdi i `.github/workflows/*.yml` for test-jobben, og `.env.example` har bare `ANTHROPIC_API_KEY=` (tom).
3. **S3, ingen ny avhengighet:** `package.json` har ingen ny avhengighet sammenlignet med `main` (sjekkes i gjennomgangen), og SDK-forbudet i 12.8 står fortsatt.
4. **S4, `runEvals` bare mot `fake`:** `runEvals` med en adapter der `code = "anthropic"` (laget med falsk `fetch`) kaster før noe kall; `fetch` er ikke kalt. `evals/` importerer ikke `@/db`, `provider-resolution` eller `providers/anthropic`.
5. **S5, tillatt-listen** (12.8 og E7.5 snevres inn, fjernes ikke): `fetch(` finnes bare i `src/core/ai/providers/anthropic.ts`; `readSecret` bare i `src/core/ai/provider-resolution.ts`; `client/` og `evals/` har ingen av delene; ingen `process.env` i `src/core/ai`. Egen kontroll: testen blir rød hvis `fetch(` legges i en annen fil (bruk en tekstprøve, ikke en ekte fil).
6. **eksisterende tester:** trial-target-testplan 2.2 og 2.8 og `other_provider` i `trial-target.test.ts` bruker en oppdiktet ukjent kode (for eksempel `unknown_vendor`) og er grønne.
7. **testmiljøet:** `tests/deploy-workflow.test.ts` sjekker at `ANTHROPIC_API_KEY` er med samme steder som `MS_GRAPH_CLIENT_SECRET` (arbeidsflyten og `main.bicep`), som hemmelighet, og at tom verdi er lov. `tests/start-script.test.ts` grønn hvis `start.sh` endres (bash 3.2).

## 5. Dokumentet, `tests/decision-note.test.ts` (ny, D1)

1. **notatet finnes** på `docs/beslutningsnotat-ki-leverandor.md`.
2. **sju deler:** overskrifter for modellvalg per funksjon, pris per rapport, EU/EØS, databehandleravtale, trening og lagring, tale til tekst, og hva Ståle må gjøre.
3. **EU/EØS i første avsnitt:** første avsnitt etter tittelen nevner «EU/EØS».
4. **«Dette er usikkert»** er en egen overskrift med minst ett listepunkt.
5. **ingen gjetteord** («antas», «trolig») og ingen modellnavn (dekkes av S1).
6. **datoer på priser:** pris-delen har minst én dato og ordene «må sjekkes på nytt».
7. Klarspråk, at tekst ikke er kopiert fra vilkårene, at trening og lagring holdes fra hverandre, og at ingen ansatte nevnes, sjekkes manuelt i gjennomgangen.

## 6. E2e (PC og iPad-størrelse, også uten nett)

Ingen nye skjermer. Disse skal være grønne uten endring, i begge prosjektene:

1. `e2e/fase-2a-forslagsmonster.spec.ts` og `-testplan.spec.ts` (`/prove/ki`, godta, endre, avvis).
2. `e2e/fase-2a-ki-ko.spec.ts` (KI-køen, også uten nett).
3. `e2e/fase-2a-rett-t0001-synkko.spec.ts`.

E2e-serveren får aldri `ANTHROPIC_API_KEY` (sjekk i `playwright.config.ts`/oppstarten at variabelen ikke settes), og databasen for e2e har ingen `anthropic`-tilkobling.

## 7. Godkjenning

Avvises hvis noe av dette mangler: tilgang per rolle med admin-testen (2.6, 3.6), tenant-isolasjon for veien med `anthropic` (3.5) og for `createConnection` (2.7), feilkodetabellen med lekkasjesjekk av melding og nøkkel (1.3), låsetabellen (3.1), sperren før vask og før kall (3.2, 3.3, 3.4.2), eller sperren mot ekte nettkall (S2). `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` må være grønne.
