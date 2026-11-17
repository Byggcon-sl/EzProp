# Testplan: Testdata, del 2 (badet fylt ut i testoppdragene)

- **Oppgavekort:** `docs/funksjoner/fase2a-testdata-del-2.md`
- **Dato:** 17.11.2026 (test-leder, før bygging)
- **Branch:** `testdata-del-2`
- **Støtter hovedmål:**
  - **De ansatte:** testene låser at testmiljøet alltid har bad som ligner ekte befaringer (TG2, TG3 med kostnad, TGIU, TG0, HMS, «ikke vurdert»), slik at skjermen kan prøves uten utfylling for hånd, og at skriptet aldri rører ekte arbeid eller admin.
  - **KI i bunnen:** testene viser at dataene har faste koder og regelbeslutninger i samme form som ekte data, at ingen KI-rader lages, og at ingen fritekst ligner persondata.
  - **Færre reklamasjoner:** regeltestene viser at hver TG kommer fra regelmotoren eller malen, aldri skrevet fritt, og at ingen ferdig rapport bryter sperrekravene (TG på alle punkt, TG3 med kostnad, TG2/TG3 med årsak og konsekvens, ingen TG på HMS).

## Felles for alle tester

- Vitest mot `TEST_DATABASE_URL`. `resetDatabase` i `beforeEach`, så `runSeed(env)`, publisert systemmal (som i drift) og `seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED })` (del 1). `console.log` dempes, unntatt i loggtestene.
- Fast tid fra `TEST_NOW`. Testen «klokken flyttet to år fram» bruker `vi.setSystemTime` bare i den ene testen og tilbakestiller etterpå.
- `countRows()` (i testfilen) utvides med `reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`, `rule_suggestion_decisions`, `audit_log`, `ai_usage_log`.
- «Regeltester» er tabelltester (`it.each`) over scenariofilen, over regelmotoren (`src/core/rules`) og over radene i databasen. Ingen TG skrives i testene; forventet TG leses fra scenariofilen og malens testsaker.
- E2e kjøres i prosjektene `pc` og `ipad` (liggende 1194 × 834). Stående iPad prøves med `setViewportSize`. Radtall sjekkes aldri som faste tall i e2e, fordi andre tester deler databasen.

## Avtale om signaturer (utvikler og testskriver)

Forslag. Avvik føres i kortet, og testskriver følger kortet.

- `src/db/seed/testdata-bath.data.ts` (ren): `TESTDATA_BATH_SCENARIOS` (liste med `key`, `mandatory: boolean`, `allowedStatuses`, krav til badets år, svar per kontrollpunkt, beslutninger per regelforslag med begrunnelseskode, valg ved «velg TG2 eller TG3», `expected` med avviksnøkler, TG eller `null`, `text_source` og `plannedPhotos: string[]` per avvik), `MANDATORY_BATH_SCENARIO_KEYS` (tolv, i fast rekkefølge), `TG3_COST_BANDS` per utfall, `TESTDATA_BATH_FREE_TEXTS` (fritekst-varianter), `TESTDATA_DRAFT_LABEL = "utkast, ikke godkjent av fagrådet"`.
- `src/db/seed/testdata-bath.ts`: `assignBathScenarios({ baths, seed })` (ren, gir fordeling), `seedTestdataBaths({ db, now, seed })` (kalles fra `seedTestdata` etter del 1), `findTestdataBathReports(db, organizationId)`, `findShowcaseBathReport(db, organizationId)`, `ensureBathroomAges` (garanti i del 1).
- Oppsummeringen fra `seedTestdata` har de nye tabellene og `bathsSkipped`.

## 1. Scenariofilen, `src/db/seed/testdata-bath.data.test.ts` (ny, ren, regeltester)

### 1.1 Dekning og fordeling (akseptkriterium 2)
1. **tolv pliktige scenarioer finnes** og har nøklene i kortet, i fast rekkefølge.
2. **hvert pliktig scenario har `expected`** med avviksnøkler, TG eller `null`, `text_source` og minst ett planlagt bilde per avvik.
3. **samme frø gir samme fordeling** (`assignBathScenarios` to ganger, `toEqual`).
4. **pliktige går til de første badene som passer**, sortert på oppdragsnummer; annet frø endrer bare resten.
5. **ingen scenario på bad med feil status eller feil år** (`it.each` over hele fordelingen med del 1-planen).
6. **nok passende bad:** del 1-planen har minst like mange bad med riktig status og år som det finnes pliktige scenarioer (garantien `ensureBathroomAges`).
7. **«bestilt» får ingen scenario.**
8. **visningsbadet** er «under arbeid» og har TG3 før 2000 med kostnad, ett utfall med fast TG2 og `edited`, TGIU komplett, HMS uten TG og punkt som står igjen.

### 1.2 Regelmotoren på hvert scenario (akseptkriterium 3 og 7)
9. **hvert scenario gir forslaget malens testsak forventer:** svarene kjøres gjennom regelmotoren med befaringsåret; regel og utfall er lik `expected` (`it.each` over scenarioer).
10. **samme resultat med klokken flyttet to år fram** (`vi.setSystemTime`), fordi befaringsåret kommer fra oppdraget.
11. **testsakene fra fagansvarlig** (`it.each`): alder −18 gir TG2; −17 gir ingenting; 1999 gir TG3 uten TG2; 2000 gir TG2; hull nektet gir TGIU uten TG2; 14,9 vekt-% gir TG0 bare på `wet_room.adjacent`; 15 vekt-% gir `elevated_moisture` og tiltaket følger valgt TG (`applies_to_tg`); RF % gir ikke vurdert; «Ukjent» (B2.5) gir ikke vurdert.
12. **scenarioene bruker inndata fra malens `rule_test_cases`:** hvert alders- og fuktscenario peker på en testsak som finnes (A2, A8, B1, B2, B2.5, B3, B6 eller tilsvarende), og testsaken består.
13. **fall og terskel:** ingen scenario har `low_threshold_height`; `insufficient_fall` bare med negativ fallverdi.

### 1.3 Faglige grenser i dataene (akseptkriterium 5, fagansvarlig 5)
14. **ingen TG3 uten kostnadsintervall** og ingen TG2 med kostnad i `expected`.
15. **eget beløp er rundet til nærmeste 10 000** der det brukes.
16. **ingen TG0 utenfor `wet_room.adjacent`, ingen TG3 på «Dokumentasjon for våtrom».**
17. **HMS (`kind = hms`) har `tg: null`**, konsekvens og tiltak.
18. **forbudte beslutninger finnes ikke:** TGIU-forslaget avvises eller endres aldri; alders-TG2 endres aldri til TG3; før 2000-forslaget endres eller avvises aldri; eneste `changed` er TG0 → TG1; eneste `rejected` er TG0 med `measured_again` på et punkt som ikke står ferdig.
19. **bare koder fra malen og ADR 0013:** hver kontrollpunkt-, felt-, valg-, utfalls- og regelkode finnes i `wetRoomTemplate` (ingen arkiverte, ingen nye).
20. **ingen avvik utenfor badmalen** (ingen el, rekkverk eller andre romtyper).
21. **`TG3_COST_BANDS`** finnes for `membrane_before_2000` og `elevated_moisture` og er merket utkast.

### 1.4 Tekstene (akseptkriterium 11)
22. **høyst tre `edited`-varianter**, og hver beholder årsak, konsekvens og alle flettefelt fra malteksten.
23. **frie tekster er merket utkast**, har én eller to varianter per felt og er korte.
24. **ingen gjetteord** («antas», «trolig», «sannsynligvis») i noen streng i datafilen.
25. **ingen tekst fra standarden:** ingen «NS 3600», «NS 3424», «TEK» med paragraf, eller setninger over 8 ord som står i de låste referansetekstene (samme sjekk som eksisterende kopitest).
26. **ingen persondata:** ingen streng har `@`, telefonmønster, gnr/bnr, gatenavn eller navn fra `testdata.data.ts`, eller ord fra `tests/known-values.ts`.
27. **planlagte bilder er korte beskrivelser** uten personer («person», «eier», «ansikt» stopper) og uten filnavn.

## 2. Seed-steget mot databasen, `src/db/seed/testdata-bath.test.ts` (ny, integrasjon)

### 2.1 Rapportene (akseptkriterium 1, 6, 8)
1. **rapport i hvert våtrom** i «under arbeid», «ferdig» og «fakturert»; ingen rapport i «bestilt».
2. **rapporten er låst til publisert systemmal** (samme mal-id og versjon som `loadLockedTemplate` gir).
3. **«ferdig» og «fakturert» har 8 av 8 punkt ferdige**; «under arbeid» har færre.
4. **«under arbeid» er en avbrutt befaring:** punktene som er fylt, kommer først i malens rekkefølge; punktene etter har ingen `field_answers`, ingen `checkpoint_results` med svar og ingen avvik.
5. **hulltaking i alle ferdige bad:** måling med enhet, eller «ikke utført» med grunn og TGIU.
6. **ingen advarsel** `tg3_on_age_only`, `tgiu_suggested_not_set`, `tgiu_details_missing` eller `checkpoint_done_without_tg` på ferdige og fakturerte (beregnet med `src/core/reports/logic/warnings.ts`).
7. **byggeåret:** `build_year` og `build_year_source` stemmer med `yearRenovated` (`owner_stated`) eller eiendommens `buildYear` (`documented`); scenario 11 har tomt år og `unknown`; `membrane_year` er tomt overalt.
8. **befaringsdato mangler:** et oppdrag «under arbeid» uten befaringsdato gir feil med norsk melding, og ingen rapport lages for det.
9. **alle pliktige scenarioer finnes i databasen** minst én gang, og fordelingen er lik den rene `assignBathScenarios`.

### 2.2 TG bare gjennom tjenestene (akseptkriterium 4)
10. **hvert avvik med TG har kilde:** en rad i `rule_suggestion_decisions` med samme `deviation_id`, eller et utfall med fast TG, eller «velg TG2 eller TG3» med TG 2 eller 3 og en `setTgDirect`-rad i `audit_log`.
11. **TG1 direkte bare der det er lov:** punktet har ingen avvik med TG og ingen åpent regelforslag.
12. **TG0 bare ved godtatt TG0-forslag** og bare på `wet_room.adjacent`.
13. **statisk sjekk:** kildeteksten i `src/db/seed/testdata*.ts` har ingen `insert(` eller `update(` mot `deviations`, `checkpointResults`, `ruleSuggestionDecisions`, `deviationMeasures`, `tgiuDetails`, `fieldAnswers` eller `reports`, og ingen rå SQL mot dem.
14. **forslag som mangler eller `no_longer_applies`:** med en påtvunget endring i svarene stopper seed med tydelig norsk feil, og transaksjonen for badet rulles tilbake (ingen halv rapport).

### 2.3 Hele datasettet (akseptkriterium 5)
`it.each` over alle avvik i Byggcon etter kjøringen:
15. ingen TG3 uten kostnadsintervall.
16. ingen TG2 eller TG3 uten årsak og konsekvens.
17. ingen TG2 med kostnad.
18. ingen TG0 utenfor tilliggende.
19. ingen TG3 på «Dokumentasjon for våtrom».
20. **ingen TG på HMS, og testen feiler ved 0 HMS-avvik.**
21. ingen avvik med kode utenfor badmalen.
22. ingen ferdig punkt uten TG.
23. **`text_source`:** bare `template` eller `edited`, og minst ett av hver.
24. **TGIU har alle fem opplysningene** og en rad i `tgiu_details` med `reason`, `risk_assessment` og `how_to_examine`.
25. **for KI:** minst ett `changed` og ett `rejected` med begrunnelseskode i `rule_suggestion_decisions`.

### 2.4 Ny kjøring og myk sletting (akseptkriterium 9, A480)
26. **andre kjøring skriver ingenting:** `countRows()` er lik, samme TG per bad, `updated_at` uendret på alle rapportrader, og oppsummeringen viser antall bad hoppet over.
27. **svar endret for hånd** (via `saveField` som e2e-takstmannen) står uendret etter ny kjøring.
28. **myk-slettet avvik** gjenopprettes ikke og lages ikke på nytt; `deleted_at` er uendret.
29. **skriptet setter aldri `deleted_at`** på eksisterende rader (sammenlign før og etter) og sletter ingenting permanent (radtall går aldri ned i noen tabell).

### 2.5 Vakten (akseptkriterium 10)
30. **`APP_ENVIRONMENT` er `production`, tom eller mangler** (`it.each`): norsk feil, `countRows()` uendret (0 nye rader i alle sju tabeller), ingen transaksjon åpnet (spion på `db.transaction`).

### 2.6 KI og revisjonslogg (akseptkriterium 11)
31. **ingen rader i `ai_usage_log`** fra seed; den falske leverandøren har null kall.
32. **aktøren i `audit_log`** for rapportradene er takstmannen på oppdraget, aldri seed-admin og aldri en annen ansatt.
33. **ingen persondata i loggen:** fanget stdout og `audit_log`-detaljer har ingen `@`, navn, gatenavn eller gnr/bnr fra testdataene.

### 2.7 Tenant-isolasjon (akseptkriterium 13)
34. **`expectTenantIsolation` på `findTestdataBathReports`** og **på `findShowcaseBathReport`** (én `it` per spørring).
35. **annen organisasjon er urørt:** med prøveorganisasjonen (`runSampleSeed`) og en egen organisasjon med publisert badmal og eget bad kjørt først, har de samme radtall i de sju tabellene før og etter.
36. **annen organisasjon med rapport på et rom** tolkes ikke som «finnes» for Byggcon (hoppet-over-tellingen gjelder bare Byggcon).
37. **`getRoomView` fra annen organisasjon** på en seedet rapport gir ikke tilgang (`AccessDeniedError` eller ikke funnet), og ingen data lekker i feilen.
38. **ingen ny tabell:** `tests/tenant-tables.ts` og `tests/tenant-isolation-all-tables.test.ts` er uendret og grønne.

### 2.8 Tilgang per rolle (akseptkriterium 13)
`it.each` over takstmann, kontor, leder og admin i Byggcon.
39. **alle fire åpner en seedet rapport** med `getRoomView` slik badskjermen tillater (kontor skrivebeskyttet).
40. **takstmann kan endre** når `access.inspectors_edit_all` er på; **kontor kan ikke** godta eller avvise forslag.
41. **admin stenges ikke ute:** admin kan godta et forslag i visningsbadet også når `access.inspectors_edit_all` er av, og `requireOrganizationAccess(admin, byggcon, p)` gir tilgang for hver rettighet i `PERMISSIONS` etter kjøringen.
42. **seed-admin er urørt:** roller, aktiv og `activeAdminCount` er like før og etter.

## 3. Akseptkriteriene uavhengig av seed-koden, `src/db/seed/testdata-bath.acceptance.test.ts` (ny, testskriver)

Skrives av `testskriver` parallelt, bare mot det offentlige grensesnittet (`seedTestdata`, oppsummeringen og databasen). Én `it` per akseptkriterium 1–14, med samme navn som i kortet. Overlapp med seksjon 2 er bevisst.

## 4. Oppsummering og `TESTDATA_TABLES`, utvidelse av `src/db/seed/testdata-index.test.ts`

1. **`TESTDATA_TABLES` har de sju nye tabellene** (akseptkriterium 14).
2. **oppsummeringen viser antall per ny tabell og bad hoppet over**, uten `@`, navn eller adresse.

## 5. E2e, `e2e/fase-2a-testdata-del-2.spec.ts` (ny, pc og ipad)

`beforeAll` som i `e2e/fase-2a-testdata.spec.ts`: `assertLocalOrTestDatabase`, `seedTestdataForE2e()`. Visningsbadet finnes med `findShowcaseBathReport` (eksporteres via `e2e/helpers.ts`), aldri med rekkefølge eller antall.

1. **visningsbadet (takstmann):** viser TG3 med kostnadsintervall, TGIU med opplysningene, HMS uten TG-merke, TG2 med endret tekst, og fremdrift «x av 8» med x < 8 og totalen 8.
2. **badet uten avvik:** alle punkt ferdige med TG1, ingen avvikskort, ingen advarsler.
3. **ferdig bad:** 8 av 8, ingen av de fire advarslene vises.
4. **«Ukjent» byggeår:** punktet for sjikt står ikke ferdig og viser «ikke vurdert».
5. **avvist forslag:** badet med `measured_again` viser forslaget som avvist med grunnen, og punktet står ikke ferdig.
6. **kontor:** åpner visningsbadet skrivebeskyttet med kostnaden; ingen Godta/Avvis.
7. **leder og admin:** åpner visningsbadet; admin kan godta med `access.inspectors_edit_all` av (gjenopprettes etterpå).
8. **iPad liggende og stående** (bare i prosjektet `ipad`): visningsbadet uten vannrett rulling, knapper minst 44 × 44 px, TG3-kortet og TGIU synlige uten overlapp.
9. **uten nett:** visningsbadet lastet, nettet av: innholdet står, og ingen rapportdata lagres lokalt (samme sjekk som B6.8).
10. **axe uten feil** på visningsbadet (PC og iPad stående).
11. **ingen persondata på skjermen** i avvikstekstene ut over det som står i oppdragets eget hode (ingen `@` eller telefonnummer i avvikskortene).

## 6. Øvrig

1. `package.json`: versjonen er økt (patch).
2. A473–A481 står i `docs/09-apne-sporsmal.md` i tabellen «Avgjort av agentene mens Ståle var borte» (enkel test eller sjekk i gjennomgangen).
3. **Bilder** (A473) og **byggeår som kolonne** (A474) er utenfor; dekkes bare av test 1.2 og 1.27 (planlagte bilder som beskrivelser) og 2.1.7 (byggeår som svar i badet). Når «Bilder på PC» bygges, får den test for at bildene lages ut fra `plannedPhotos`, uten personer.

## Godkjenning

Test-leder avviser hvis noe av dette mangler: 2.7 (tenant-isolasjon på begge oppslag og urørt annen organisasjon), 2.8 (tilgang per rolle og admin ikke utestengt), 2.4 (myk sletting), 2.2.13 (statisk sjekk av skriving forbi tjenestene) eller 2.3.20 (HMS uten TG, rød ved 0).
