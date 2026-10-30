# Testplan: Prøve C – lagring i Safari

- **Oppgavekort:** `docs/funksjoner/fase1-prove-c-lagring.md` (pkt.-numrene viser til «Omfang»)
- **Fase:** 1 – Prøve uten nett, punktet «Prøve C»
- **Branch:** `fase1-prove-c-lagring` (bygger på `main`)
- **Dato:** 30.10.2026
- **Laget av:** test-leder, før koding. Testnavn, filnavn og markører er bindende for testskriver. Utvikler leser avsnitt 6 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** **Reklamasjoner** (testene viser at et svar eller bilde som ikke ble lagret på iPaden, alltid gir en synlig melding og et merke på feltet, og at meldingen ikke forsvinner før feltet faktisk er lagret; ingenting går tapt i stillhet). **Tid** (testene viser at varig lagring bes om og ny lagring skjer automatisk, uten trykk). **KI først:** ikke KI her; dette er lagringsgrunnlaget som KI-forslag senere bygger på.

Ekte omstart, 7 dager uten bruk og full plass på ekte iPad er **ikke** del av de automatiske testene. De dekkes av resultatmalen `docs/funksjoner/fase1-prove-c-lagring-resultat.md`, som Ståle fyller ut når han er tilbake.

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`, `tests/offline-trial.ts`: brukes ikke i nye Vitest-tester (ingen database i denne oppgaven).
- `tests/tenant-isolation.ts`: **ikke** brukt. Ingen nye spørringer (se 4).
- `e2e/helpers.ts`: `logIn`, `logInAsInspector`, `createTrialForm`, `waitForTrialHook`, `useCandidate`, `syncStatus`, `fixtures/test-image.png`. Utvides med hjelperne i 5.1. Eksisterende hjelpere endres ikke.
- Mønsteret for «ny lasting uten nett» med reserve (`e2e/fase-1-powersync.spec.ts`, «reload uten nett» / `caches.match`) brukes i 5.3.

### 1.1 Tillatte endringer i eksisterende tester (alt annet er «uendret»)

| Fil | Endring | Hvorfor |
|---|---|---|
| `e2e/helpers.ts` | bare nye hjelpere (5.1) | pkt. 2–5 |
| `src/modules/offline-trial/sync/candidate-boundaries.test.ts` | bare nye tester (2.2) | `storage-health.ts` skal være kandidatuavhengig |

Endres en forventning i en eksisterende test, er det et funn. Alle dagens e2e skal være grønne uendret, også når Chromium i testen har lite ledig plass (se 6, K6).

## 2. Enhetstester (Vitest, ingen database, ingen DOM)

Falsk `navigator.storage` settes med `vi.stubGlobal("navigator", …)` og fjernes i `afterEach` (`vi.unstubAllGlobals()`), og `resetPersistRequestForTests()` kjøres i `beforeEach`. Ingen test avhenger av rekkefølge.

### 2.1 `src/modules/offline-trial/storage-health.test.ts`

Grensen er en teknisk innstilling, ikke fag, men testes som data (`it.each`-tabell), som regeltestene.

| Testnavn | Viser |
|---|---|
| «LOW_STORAGE_FREE_BYTES er 500 MB» | konstanten === `500 * 1024 * 1024`. Endres grensen, må testen endres bevisst. |
| «storageLevel følger grensen på 500 MB ledig» | tabell: ledig = grense − 1 byte → `low`; 499,99 MB → `low`; nøyaktig 500 MB → `ok`; 2 GB → `ok`; `usage` = `quota` (0 ledig) → `low`; `usage` > `quota` → `low`. **Obligatorisk.** |
| «storageLevel uten tall gir unknown» | `usage` mangler, `quota` mangler, begge mangler, `quota` 0 → `unknown`. |
| «readStorageHealth med fullt API» | `estimate` → `{ usage, quota }`, `persisted` → `true`/`false` → `persisted: "yes"`/`"no"`, riktig nivå. |
| «readStorageHealth uten persisted()» | `persisted: "unsupported"`, nivå regnes fortsatt ut fra `estimate`. |
| «readStorageHealth uten navigator.storage» | `persisted: "unsupported"`, nivå `unknown`. Kaster ikke. **Obligatorisk.** |
| «readStorageHealth når estimate() kaster eller avviser» | både synkron `throw` og avvist løfte → nivå `unknown`, `resolves` (kaster aldri videre). **Obligatorisk.** |
| «readStorageHealth når persisted() avviser» | `persisted: "unsupported"`, kaster ikke. |
| «storageHealthText viser MB avrundet og varig lagring» | `usage` 123,4 MB, `quota` 2048 MB, `yes` → teksten har «123» og «2048» (eller formatet utvikler velger, men hele MB uten desimaler) og «Varig lagring: ja»; `no` → «nei». |
| «storageHealthText uten API gir ikke støttet» | `unsupported`/`unknown` → «Varig lagring: ikke støttet», og ingen «NaN» eller «undefined» i teksten. |
| «requestPersistentStorage kaller persist() når persisted() er false» | `persist` kalt 1 gang; `persist` → `true` gir `yes`, `false` gir `no`. |
| «requestPersistentStorage kaller ikke persist() når persisted() er true» | `persist` kalt 0 ganger, svar `yes`. |
| «requestPersistentStorage gir ett persist() ved to kall i samme innlasting» | to kall rett etter hverandre (uten `await` mellom) og to kall etter hverandre → `persist` kalt 1 gang totalt; begge svarene er like. **Obligatorisk.** |
| «resetPersistRequestForTests nullstiller vakten» | kall, nullstill, kall → `persist` kalt 2 ganger. |
| «requestPersistentStorage uten API gir unsupported» | uten `navigator.storage`, og uten `persist` → `unsupported`, kaster ikke. |
| «requestPersistentStorage når persist() avviser» | → `no` eller `unsupported` (utvikler velger, testen låser valget), kaster ikke. |
| «isQuotaError gjenkjenner full plass» | tabell: `DOMException("x", "QuotaExceededError")`, `{ name: "NS_ERROR_DOM_QUOTA_REACHED" }`, `DOMException` med `code` 22 → `true`. |
| «isQuotaError avviser andre feil» | `new Error("x")`, `DOMException("x", "NotFoundError")`, `null`, `undefined`, tekst, `{}` → `false`. |
| «storageErrorMessage ett svar» | ordrett: «Svaret i «<feltnavn>» ble ikke lagret på iPaden. Lukk ikke appen. Trykk «Prøv igjen».» |
| «storageErrorMessage flere svar» | 3 svar → «3 svar ble ikke lagret på iPaden, sist «<siste feltnavn>». Lukk ikke appen. Trykk «Prøv igjen».» Samme felt to ganger telles én gang. |
| «storageErrorMessage bilde» | ordrett: «Bildet i «<feltnavn>» ble ikke lagret på iPaden. Ta bildet på nytt.» Ingen «Prøv igjen» i teksten. |
| «storageErrorMessage svar og bilde blandet» | én tekst som nevner både svaret og bildet med feltnavn. |
| «storageErrorMessage sier at plassen er brukt opp bare ved full plass» | med `QuotaExceededError` i minst én feil → slutter med «Plassen på iPaden er brukt opp.»; med vanlig `Error` → teksten finnes ikke. **Obligatorisk.** |
| «storageErrorMessage har aldri verdien» | feilene har svarverdien «Oppdiktet-svar-7391» og bildenavnet «oppdiktet-bilde-7391.jpg» på feilobjektet → ingen av dem i teksten. **Obligatorisk.** |
| «storageErrorLog gir bare navn og melding» | `DOMException("Kvoten er full", "QuotaExceededError")` → nøyaktig `{ name: "QuotaExceededError", message: "Kvoten er full" }` (`toStrictEqual`, ingen andre nøkler). |
| «storageErrorLog tar ikke med svar eller bildedata» | `Error` med egne egenskaper `value`, `file`, `blob`, `cause` (som har svaret) → `JSON.stringify(resultat)` har ikke «Oppdiktet-svar-7391». **Obligatorisk.** |
| «storageErrorLog for noe som ikke er Error» | tekst, `null`, `{ value: "…" }` → `{ name: "ukjent feil", … }` eller `message: "ukjent feil"` (utvikler velger; testen låser) og aldri innholdet. |
| «ingen gjetteord i tekstene» | ingen tekst fra modulen inneholder «antas», «trolig», «sannsynligvis». |
| «ingen tekst sier at synk frigjør plass» | varseltekst og feiltekster har ikke «frigjør» eller «rydd» (synk frigjør ikke plass før fase 2b). |

### 2.2 Nye tester i `src/modules/offline-trial/sync/candidate-boundaries.test.ts`

| Testnavn | Viser |
|---|---|
| «storage-health.ts importerer ikke fra noen kandidat og ikke React» | ingen spesifikator treffer `CANDIDATE_SPECIFIER`, ingen `react`. (Den bruker `navigator.`, så `expectPure` brukes ikke.) |
| «storage-health.ts har hodekommentaren» | inneholder `HEADER`. |
| «loggen ved lagringsfeil bruker storageErrorLog» | `trial-form-page.tsx` og `trial-sync-provider.tsx`: hvert `console.error(`/`console.warn(` som gjelder lagring, har `storageErrorLog(`; ingen `console.error(…, error)` med det rå feilobjektet. **Obligatorisk** (loggregelen; sikkerhet-personvern er ikke med i oppgaven). |
| «testkroken for lagring leses bare med miljøvariabelen» | filen som leser `window.__offlineTrialStorage`, bruker samme vakt som `sync/test-hooks.ts` (`NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1"`). |

## 3. Integrasjonstester (testdatabasen)

**Ingen.** Oppgaven har ingen ny spørring, rute, tabell eller migrering. Se 4 for hvordan det sjekkes.

## 4. Tilgang, tenant-isolasjon, admin, myk sletting

| Krav | Hvordan det vises |
|---|---|
| Tenant-isolasjon | Ingen ny spørring, så `expectTenantIsolation` trengs ikke. **Godtas bare hvis** `git diff --stat main...HEAD -- src/db src/app/api server src/core/access drizzle` er tom. Test-leder sjekker dette ved godkjenning; noe der → avvist. |
| Tilgang per rolle | Prøvesidene har dagens tilgangssjekk (uendret). Dagens e2e «uinnlogget sendes til innlogging fra /prove/testskjema» dekker uinnlogget. Ny e2e: takstmann (ikke admin) ser boksen (5.2). Admin brukes i resten. Kontor og leder bruker samme side og sjekk; ingen egen test (ingen ny tilgangsregel). |
| Admin stenges aldri ute | Ingen ny tilgangsregel. Alle e2e i 5 kjører som admin unntatt rolletesten, så admin er dekket. |
| Myk sletting | Gjelder ikke: ingen nye data, ingenting slettes. Ingen test. |
| Ingen kundeopplysninger i logg | 2.1 «storageErrorLog …» og e2e «loggen har aldri svaret» (5.4). |

## 5. E2e (Playwright, `e2e/fase-1-prove-c-lagring.spec.ts`)

Prosjektene `pc` og `ipad` (Chromium). Standardkandidaten PowerSync med mindre annet står. Admin er innlogget, og hver test lager eget testskjema (`createTrialForm`). Testene leser markørene (`data-storage-level`, `data-storage-persisted`, `data-field-saved`), `role` og `data-testid`, ikke bare norsk tekst. Feilteksten sjekkes med `toContainText` på feltnavnet og «Plassen på iPaden er brukt opp.»; ordrett tekst testes i Vitest.

**Regel for stabile tester:** hver test som ikke selv tester lite plass, setter overstyringen `estimate: { usage: 10 MB, quota: 4 GB }` med `addInitScript`, slik at ekte, lav kvote i Chromium uten skjerm aldri gir varselet ved et uhell. Unntak: testen med ekte tall (5.2 første rad).

### 5.1 Nye hjelpere i `e2e/helpers.ts`

| Hjelper | Gjør |
|---|---|
| `setStorageOverride(page \| context, value)` | `addInitScript` som setter `window.__offlineTrialStorage = value` før siden lastes. |
| `updateStorageOverride(page, patch)` | endrer `window.__offlineTrialStorage` på åpen side (`page.evaluate`), for eksempel `{ fail: "answer" }`, `{ fail: null }`, nytt `estimate`. |
| `storageBox(page)` | `page.getByTestId("storage-health")` (boksen på listen). |
| `storageWarning(page)` | `page.getByTestId("storage-low-warning")` (har `role="status"`). |
| `storageError(page)` | `page.getByTestId("storage-error")` (har `role="alert"`). |
| `fieldSaved(page, label)` | feltbeholderen for etiketten, med `data-field-saved`. |
| `MB` | `1024 * 1024`. |

### 5.2 Boksen på listen og varig lagring

| Testnavn | Viser |
|---|---|
| «boksen viser plass og varig lagring med ekte tall» | uten overstyring: boksen er synlig under velgeren for synkløsning, har tall i MB og «Varig lagring:». `data-storage-persisted` er `yes` eller `no`. `data-storage-level` er lik `storageLevel` regnet fra `navigator.storage.estimate()` i samme side (importert fra `storage-health.ts`), så testen ikke feiler fordi Chromium uten skjerm gir liten kvote. **Avvik fra kortet** (kortet sier `ok`): kvoten i Chromium uten skjerm kan være under 500 MB, og da er `low` riktig. |
| «boksen viser ok med 2 GB ledig» | overstyring `{ usage: 100 MB, quota: 2148 MB }` → `data-storage-level="ok"`, tallene 100 og 2148 vises. |
| «boksen viser lite plass med 100 MB ledig» | overstyring `{ usage: 1948 MB, quota: 2048 MB }` → `data-storage-level="low"`. |
| «uten navigator.storage viser boksen ikke støttet og skjemaet virker» | `addInitScript` sletter `navigator.storage` (`Object.defineProperty(navigator, "storage", { value: undefined })`) → `data-storage-persisted="unsupported"`, `data-storage-level="unknown"`, teksten «ikke støttet», ingen «NaN». Åpne skjemaet: ingen `storage-low-warning`, ingen `storage-error`; et svar lagres og står etter ny lasting. **Obligatorisk.** |
| «persist() kalles én gang per innlasting når persisted() er false» | `addInitScript` pakker inn `navigator.storage.persisted` (→ `false`) og `persist` (teller kall i `window.__persistCalls`). Listen åpnes: 1 kall. Ny innlasting: 1 kall igjen (ny innlasting). Skjemaet åpnet direkte: 1 kall. |
| «persist() kalles ikke når persisted() er true» | samme innpakning med `persisted` → `true`: 0 kall på listen og skjemaet. |
| «takstmann ser boksen» | `logInAsInspector`, `/prove/testskjema` → boksen synlig med markørene. |
| «boksen har ingen knapp» | ingen `button` inne i `storage-health` («Mål på nytt» er tatt ut). |
| «skjemaet viser ingen tall om plass» | skjemaet med 2 GB ledig: ingen `storage-health`, ingen tekst «MB» i den faste linjen. |

### 5.3 Data overlever lukking

| Testnavn | Viser |
|---|---|
| «svar og bilde lagret uten nett står der etter at siden er lukket og åpnet uten nett» | Skjemaet åpnes med nett (så service worker og hurtiglager er klare). `setOffline(true)`. Skriv et tekstsvar, et tall og ett bilde (`Forsidebilde`, `fixtures/test-image.png`). Vent til feltene har `data-field-saved="yes"`. `page.close()`. Ny side i **samme kontekst**, fortsatt uten nett, `goto` skjemaet: svarene og bildet står der, telleren er lik. Feiler navigasjonen uten nett (service worker), brukes reserven: slå på nett, men `context.route("**/api/prove/**", r => r.abort())`, åpne og sjekk det samme; vei skrives som `annotation` («uten nett» / «reserve»). **Obligatorisk.** |
| «svar står der etter ny innlasting med lite plass-varsel» | 100 MB ledig, skriv svar, `reload` → svaret står der og varselet vises igjen. |

Ekte omstart av iPaden og 7 dager kan ikke testes i nettleser. Står i resultatmalen (C2, C3).

### 5.4 Lite plass og lagring som feiler (skjemaet)

| Testnavn | Viser |
|---|---|
| «lite plass ved åpning gir varsel som ikke sperrer» | overstyring 100 MB ledig før lasting → `storageWarning` synlig med `role="status"`, inne i den faste linjen øverst (samme sticky-beholder som `syncStatus`), tekst «Lite plass igjen på iPaden». Et svar og et bilde lagres (`data-field-saved="yes"`), telleren øker. **Obligatorisk.** |
| «nok plass gir ikke varsel» | 2 GB ledig → `storageWarning` finnes ikke. |
| «lite plass oppdaget ved bilde uten ny innlasting» | åpne med 2 GB ledig (ingen varsel), `updateStorageOverride` til 100 MB ledig, ta et bilde → varselet kommer uten `reload`. Bildet lagres. |
| «lite plass oppdaget etter feil» | 2 GB ledig, `updateStorageOverride({ estimate: 100 MB ledig, fail: "answer" })`, skriv svar → både `storage-error` og `storageWarning` vises (målt på nytt etter feilen). |
| «svar som feiler gir én melding med feltnavn, verdi og merke» | `fail: "answer"`, skriv «Oppdiktet-svar-7391» i et tekstfelt → én `storage-error` med `role="alert"`, inneholder feltnavnet og «Plassen på iPaden er brukt opp.». Verdien står i feltet. Feltet har `data-field-saved="no"` og synlig «ikke lagret». Knappene «Prøv igjen» og «Lukk» finnes. **Obligatorisk.** |
| «flere svar som feiler samles i én melding» | fortsatt `fail: "answer"`, skriv i et felt til → fortsatt nøyaktig **ett** `role="alert"` fra lagring (`storage-error` count 1), teksten har «2 svar» og navnet på siste felt. Begge feltene `data-field-saved="no"`. |
| «Prøv igjen lagrer de feilede svarene og fjerner meldingen» | etter de to feilene: `fail: null`, trykk «Prøv igjen» → meldingen borte, begge feltene `data-field-saved="yes"`, `reload` → begge svarene står der. **Obligatorisk.** |
| «ny lagring skjer automatisk når et annet svar lagres» | `fail: "answer"`, skriv i felt A → melding. `fail: null`, skriv i felt B (uten å trykke noe) → meldingen forsvinner, A og B `data-field-saved="yes"`, `reload` → A står der. **Obligatorisk.** |
| «meldingen blir stående når et annet felt lagres men det feilede fortsatt mangler» | `fail: "answer"`, skriv A → melding. Ta et bilde i «Forsidebilde» (`fail` gjelder bare svar, så bildet lagres og har `data-field-saved="yes"`) → meldingen står fortsatt, A har `data-field-saved="no"`. Viser at «et annet felt lagres» ikke er nok. (Kroken kan ikke la bare ett svarfelt feile, så et bilde brukes som «annet felt».) **Obligatorisk.** |
| «Lukk fjerner meldingen men merket blir stående» | `fail: "answer"`, skriv A → melding, trykk «Lukk» → `storage-error` borte, A har fortsatt `data-field-saved="no"` og «ikke lagret». `fail: null`, skriv i A på nytt → `data-field-saved="yes"`, merket borte. |
| «bilde som feiler gir egen melding uten Prøv igjen» | `fail: "photo"`, ta bilde i «Forsidebilde» → `storage-error` med feltnavnet og «Ta bildet på nytt», **ingen** «Prøv igjen»-knapp, «Lukk» finnes. Bildefeltet `data-field-saved="no"`. `fail: null`, ta nytt bilde i samme felt → meldingen borte, `data-field-saved="yes"`. **Obligatorisk.** |
| «svar og bilde som feiler samles i én melding» | `fail: "both"`, skriv svar og ta bilde → ett `storage-error`, nevner begge feltnavnene. |
| «Prøv igjen og Lukk er minst 44 høye med minst 8 mellom» | bare `ipad` (`test.skip` ellers): `boundingBox().height >= 44` for begge, avstanden mellom boksene `>= 8`. |
| «meldingen dekker ikke feltet han skriver i» | `ipad`: etter to feil er den faste linjen ikke høyere enn før feil nr. 2 (samme `boundingBox().height` ± 1). |
| «loggen har aldri svaret» | samle `page.on("console")` og `page.on("pageerror")`. `fail: "answer"`, skriv «Oppdiktet-svar-7391» → minst én konsollmelding om lagring, og ingen melding inneholder «Oppdiktet-svar-7391». **Obligatorisk.** |
| «uten testkrok påvirker ingenting lagringen» | ingen `__offlineTrialStorage` satt (ingen `addInitScript`) → svar lagres, ingen `storage-error`. Viser at kroken ikke slår på feil av seg selv. |

### 5.5 Ikke testet automatisk (bevisst)

- Ekte iPad, Safari/WebKit, hjemskjerm, ekte omstart, 7 dager, ekte full disk: resultatmalen C1–C4.
- Feil i ElectricSQL og egenbygd: feilen settes inn og fanges i skjermlaget, likt for alle tre (prosjektlederens avgjørelse ved gjennomgangen). Én e2e med PowerSync holder. Unntak: «svar og bilde lagret uten nett står der …» (5.3) er så viktig for reklamasjonsmålet at testskriver **kan** legge den inn med `useCandidate` for alle tre hvis tiden i CI tillater det (under 30 s ekstra); ellers bare PowerSync.

## 6. Krav til koden som testene bygger på (utvikler)

| Nr. | Krav |
|---|---|
| K1 | `src/modules/offline-trial/storage-health.ts` eksporterer `readStorageHealth`, `requestPersistentStorage`, `resetPersistRequestForTests`, `storageLevel`, `storageHealthText`, `isQuotaError`, `storageErrorMessage`, `storageErrorLog`, `LOW_STORAGE_FREE_BYTES`. Ingen React, ingen kandidatimport, hodekommentaren `Prøve fase 1, kastes eller gjøres om etter ADR`. `navigator` leses inne i funksjonene (ikke ved import), så Vitest kan stubbe den. |
| K2 | Boksen: `data-testid="storage-health"` med `data-storage-level` og `data-storage-persisted`. Skjemaet: samme to markører på den faste linjen (eller et element i den). |
| K3 | Varselet: `data-testid="storage-low-warning"`, `role="status"`, inne i den faste linjen. Feilmeldingen: `data-testid="storage-error"`, `role="alert"`, inne i den faste linjen, høyst én om gangen. |
| K4 | Hvert felt, også bildefelt, har `data-field-saved="yes|no"` på feltbeholderen som `fieldContainer` i dagens e2e finner (samme element som har feltets etikett). |
| K5 | Testkroken `window.__offlineTrialStorage` leses ved **hver** måling og **hver** lagring (ikke bufret), bare når `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1"`. `fail` kaster `new DOMException("…", "QuotaExceededError")` før `store.setAnswer`/`store.addPhoto` kalles. `estimate` erstatter bare `estimate()`; `persisted`/`persist` er ekte. |
| K6 | Varselet og feilmeldingen bruker egne `data-testid`, ikke `sync-status-message`, og legger ikke `role="status"` inne i `fieldContainer`, så dagens e2e (som filtrerer `getByRole("status")` på «Endret av en annen») ikke påvirkes. |
| K7 | Vellykket `setAnswer` for et felt fjerner det feltet fra feillisten; meldingen forsvinner først når listen er tom (eller ved «Lukk»). En vellykket lagring av et annet svar starter ny lagring av svar i feillisten (verdiene fra `pending`). |
| K8 | Ingen endring i `src/db`, `src/app/api`, `server/`, `src/core/access`, `drizzle/`. Ingen ny avhengighet i `package.json`. Versjonen økes (patch). |

## 7. Dekning av akseptkriteriene

| Akseptkriterium (kortet) | Tester |
|---|---|
| `storageLevel` low/ok/unknown | 2.1 «storageLevel …» (tre rader) |
| Uten `navigator.storage` | 2.1 «readStorageHealth uten navigator.storage», «storageHealthText uten API»; 5.2 «uten navigator.storage …» |
| `persist()` én gang, bare når `false` | 2.1 «requestPersistentStorage …» (fire rader); 5.2 to rader om `persist()` |
| Listen viser plass og varig lagring (PC og iPad) | 5.2 «boksen viser …» (tre rader), begge prosjekter |
| Data overlever lukking uten nett | 5.3 |
| Lite plass ved åpning og ved bilde, ingen sperre | 5.4 tre første rader |
| Én melding med feltnavn, `role="alert"`, samlet, verdi og merke | 5.4 «svar som feiler …», «flere svar …» |
| Meldingen forsvinner riktig | 5.4 «Prøv igjen …», «ny lagring skjer automatisk …», «meldingen blir stående …», «Lukk …» |
| Bilde som feiler | 5.4 «bilde som feiler …» |
| Full plass i meldingen | 2.1 «… bare ved full plass»; 5.4 «svar som feiler …» |
| 44 pt og 8 pt | 5.4 «Prøv igjen og Lukk …» (ipad) |
| Loggen bare navn og melding | 2.1 «storageErrorLog …»; 2.2 «loggen ved lagringsfeil …»; 5.4 «loggen har aldri svaret» |
| Ingen avhengigheter, rute, migrering | 4 (git diff), K8 |
| Resultatmalen | Test-leder leser `fase1-prove-c-lagring-resultat.md`: C1–C4, per kandidat, bestått / delvis / ikke bestått, iPad-modell/versjoner/ledig plass/hjemskjerm, setningen om at omstart og 7 dager ikke kan testes automatisk, merknaden om at synk ikke frigjør plass. Ingen modellnavn, ingen kundedata. |
| `pnpm lint`, `typecheck`, `test`, `test:e2e` grønne, versjon økt | kjøres av test-leder ved godkjenning |

## 8. Godkjenning

Test-leder **avviser** hvis noe av dette mangler eller er rødt:

- Testene merket **Obligatorisk** i 2 og 5.
- `git diff` i 4 er ikke tom (da kreves `expectTenantIsolation` og tilgangstester).
- En eksisterende test er endret utover 1.1.
- En test bruker `waitForTimeout` i stedet for å vente på markør eller tekst.
- Testdata er ikke oppdiktet, eller loggen eller en melding viser svarverdien.

Funn som ikke stopper (merkes «lite»): MB-formatet, rekkefølgen av svar og bilde i samlet melding, plassering av boksen innenfor listen.
