# Testplan: Reglene badet trenger

- **Oppgavekort:** `docs/funksjoner/fase2a-regler-bad.md`
- **Dato:** 12.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** hver regel låses med testsaker for slår til, slår ikke til, ikke vurdert og kantverdi. Et bad uten hulltaking kan ikke ende med noe annet enn TGIU-forslag (T-0003), og tomme eller ugyldige felt gir aldri et stille «ingen avvik» (T-0015).
  - **De ansatte:** testene sikrer at forslaget og begrunnelsen er like hver gang, slik at takstmannen kan stole på dem.
  - **KI i bunnen:** testene låser at regelsvarene bare har faste koder og tall (grunnlag for KI senere), at ingen regel kaller KI og at ingen regel foreslår TG0.

Rene tester (motor, data, malfil, kontroller, lint) kjører uten database. Tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`, som i `src/core/templates/templates.test.ts`. Testdata er oppdiktet. Befaringsåret i testene er fast (2026), aldri dagens dato. **Grensene leses alltid fra `thresholds.ts` og `lifespans.ts`**, aldri som tall skrevet inn i testen (unntak: testen i 2.3 som låser at utkastverdiene er de avtalte).

## 0. Avtale om signaturer (utvikler og testskriver)

Navn kan endres, men avvik føres i kortet.

- `src/core/rules/index.ts`: `evaluateRules(input) → RuleResult[]` og `runRuleTestCases(input) → RuleTestCaseResult[]` (grensesnittet i kortet, Omfang 1).
- `RuleTestCaseResult`: `{ rule_key, test_case_key | name, expected_state, actual_state, passed, result: RuleResult }`.
- `src/core/rules/data/lifespans.ts`: `WET_ROOM_LIFESPANS: LifespanSet` (`{ key, entries }`).
- `src/core/rules/data/thresholds.ts`: `WET_ROOM_THRESHOLDS: ThresholdSet` (`{ key, entries }`) og konstanten for terskelkoden `wet_room_hole_moisture_weight_percent`.
- Begrunnelseskodene eksporteres som konstant (for eksempel `RULE_REASON_CODES`), så testene ikke skriver strenger for hånd.
- Kontrollene i `src/core/templates/document.ts` er rene funksjoner med egne navn, for eksempel `checkRuleSuggestsOutcome`, `checkRuleOutcomeSameCheckpoint`, `checkRuleCheckpointGivesTg`, `checkRuleConditionShape`. De kjøres i `saveDraftContent` og gir `TemplateValidationError` med norsk melding.
- Testhjelper i `tests/template-document.ts`: et lite dokument med én regel av hver av de tre betingelsestypene (brukes av 1, 5 og 6).

## 1. Regelmotoren, `src/core/rules/evaluate.test.ts` (ny, ren)

Bygges med små dokumenter laget i testen (ikke badmalen), så motoren prøves uten feltkoder fra malen.

### 1.1 Form og determinisme
1. **same_input_same_output:** samme input to ganger gir like svar (`toEqual`), og input er ikke endret etterpå (`structuredClone` før og etter).
2. **no_date_inside:** med `vi.useFakeTimers` satt til 2030 og 2020 gir samme input samme svar (motoren bruker bare `inspectionYear`).
3. **result_shape_codes_only:** hvert `RuleResult` har bare `rule_key`, `state`, `suggestion`, `reasons`, `lifespan_set_key`, `threshold_set_key`. Ingen verdi i svaret er en UUID (regex), og `reasons` har bare koder (strenger i kodeformat) og tall. Ingen fritekst: ingen streng med mellomrom.
4. **one_result_per_active_rule:** ett svar per aktiv regel, i `sort_order`.

### 1.2 Hvilke regler kjøres
5. **inactive_rule_skipped:** `active = false` gir ikke noe svar.
6. **deleted_rule_skipped:** regel med `deleted_at` gir ikke noe svar.
7. **inactive_or_deleted_condition_ignored:** betingelse med `active = false` eller `deleted_at` påvirker ikke svaret (regelen med bare den betingelsen igjen vurderes på de andre).
8. **custom_template_not_evaluated:** `suggest_outcome` og `suggest_tgiu` med `template.kind = custom` gir `not_evaluated` og `suggestion = null`. Samme med `system` men annen `reportType` enn `condition_report`.
9. **other_purpose_not_evaluated:** `show` og `validate` gir `not_evaluated` (eller ingen svar, men aldri `triggered`).
10. **unknown_condition_type_not_evaluated:** hver av de andre typene i skjemaet (`build_year`, `field_filled`, `always` osv., `it.each`) gir `not_evaluated`, aldri `not_triggered`.

### 1.3 Treverdilogikk (`it.each`-tabell)
11. **match_all:** (sann, sann) → `triggered`; (sann, usann) → `not_triggered`; (usann, ukjent) → `not_triggered`; (sann, ukjent) → `not_evaluated`.
12. **match_any:** (usann, sann) → `triggered`; (ukjent, sann) → `triggered`; (usann, usann) → `not_triggered`; (usann, ukjent) → `not_evaluated`.
13. **groups:** gruppe `any` inne i `all` og omvendt følger samme tabell (minst fire rader, også ukjent inne i gruppe).
14. **no_conditions:** regel uten aktive betingelser gir `not_evaluated` (ikke `triggered`).

### 1.4 `option_selected`
15. valgt kode i listen → sann; annen kode → usann; tomt felt → ukjent; kode som ikke finnes blant valgene → ukjent.

### 1.5 `number_vs_limit`
16. **fixed_value:** `gte`/`gt`/`lte`/`lt`/`eq` med fast verdi, under, lik og over (`it.each`).
17. **threshold_key:** grensen og retningen hentes fra terskelsettet; samme svar som fast verdi med samme tall.
18. **unknown_threshold_key:** kode som ikke finnes i settet gir `not_evaluated` med egen begrunnelseskode.
19. **invalid_reading:** tom, `null`, negativ, `NaN`, tekst (`"14,5"`, `"abc"`) gir `not_evaluated`.
20. **unit:** enhet tom gir `not_evaluated`; enhet ulik terskelens `unit` gir `not_evaluated` med `unit_not_supported`; lik enhet vurderes.
21. **reasons_measurement:** begrunnelsen har verdi, enhet, grense, `comparator` og terskelkoden.

### 1.6 `age_vs_lifespan`
22. **boundary_min_age:** alder = `min_age - 1` usann, `min_age` sann (avledet fra settet i testen).
23. **year_range:** `to_year = 1999` tar med 1999, ikke 2000; `from_year` tilsvarende.
24. **strictest_wins:** når både `tg2`- og `tg3`-trinn passer, slår bare regelen med `tg3`-utfall til; `tg2`-regelen gir `not_triggered`.
25. **documentation_list:** valg i `value`-listen gir trinnet `without`; annet valg gir `with`; tomt felt gir `without` og begrunnelsen sier «ikke oppgitt» (kode).
26. **material_empty_rows_only:** tom eller ukjent materialkode bruker bare rader uten `material_code`. Ingen rad passer → `not_evaluated` med `material_unknown`.
27. **year_source:** `age_year_element_key` brukes først, så `age_fallback_year_element_key`, ellers `not_evaluated`. Begrunnelsen viser årstallet, feltkoden det kom fra og verdien i `age_source_element_key`.
28. **future_year:** årstall etter `inspectionYear` gir `not_evaluated`. `inspectionYear = null` gir `not_evaluated`.
29. **engine_knows_no_codes:** motoren fungerer med andre feltkoder og valgkoder enn badmalens (et oppdiktet dokument med `x.year`, `x.material`), så ingen kode er skrevet inn i motoren.
30. **set_keys_in_result:** `lifespan_set_key` og `threshold_set_key` i svaret er settkodene fra input.

### 1.7 Forslag
31. **suggestion_outcome:** `suggest_outcome` som slår til gir `{ kind: "outcome", checkpoint_key, question_key, outcome_key }` med koder fra dokumentet.
32. **suggestion_tgiu:** `suggest_tgiu` gir `{ kind: "tgiu", checkpoint_key }`.
33. **no_suggestion_when_not_triggered:** `not_triggered` og `not_evaluated` gir `suggestion = null`.

## 2. Levetider og terskel, `src/core/rules/data/data.test.ts` (ny, ren)

1. **keys_unique_and_format:** alle `key` i levetidssettet og terskelsettet er unike og følger kodeformatet. Settkodene er satt.
2. **all_draft_with_source:** hver rad har `status = draft` og ikke-tom `source_ref`. Terskelens `source_ref` nevner ikke NS-punkt eller Byggforsk-blad.
3. **agreed_values (låser utkastet):** de åtte membrantypene har levetidene i kortet (Omfang 2, it.each med/uten dokumentasjon), «før 2000» er én rad med `to_year = 1999`, `documentation = any`, tom `material_code`, `outcome_kind = tg3`. Terskelen er 15, `gte`, `weight_percent`.
4. **material_codes_exist:** hver `material_code` finnes som valg under `wet_room.membrane_type` i badmalen. `unknown` brukes ikke som `material_code`.
5. **threshold_unit_exists:** terskelens `unit` finnes som valg under `wet_room.hole_moisture_unit`.
6. **without_not_longer_than_with:** for hver type er `min_age` uten dokumentasjon ≤ med dokumentasjon.
7. **no_imports_of_data_in_engine:** ingen fil i `src/core/rules` utenom `data/` og testfiler importerer fra `./data` (lest som tekst).

## 3. Badmalen, `src/db/seed/templates/wet-room.test.ts` (endret, ren)

1. **1.26 no_rules erstattes** av **1.26 four_rules:** nøyaktig de fire regelkodene i kortet, med formål og kontrollpunkt som i tabellen (Omfang 4). Hver har `source_ref` og `message`.
2. **1.6 key_snapshot utvides** med de fire regelkodene, spørsmålet `wet_room.membrane_drain.membrane_past_lifespan` og utfallet `tg2`, terskelkoden, settkodene og levetidskodene. Ingen eksisterende kode er borte.
3. **rule_outcome_same_checkpoint:** regel og foreslått utfall står på samme kontrollpunkt (T-0014).
4. **messages_clean:** regelmeldinger og den nye utfallsteksten består `checkGuessWordsAndReferences`, `checkTextLength` og kopisjekken mot researchen (1.21, 1.22). Fuktregelens melding nevner treverk.
5. **new_outcome_text:** `membrane_past_lifespan` har kriterium `age_uncertain_function`, `text_status = draft`, inneholder `{årstall}`-flettefeltet slik A213 gjør, og har ikke ordene «utslitt», «lekker» eller «skift» i tiltaket.
6. **documentation_value_list:** betingelsen i aldersregelen har `value = ["none", "other_written"]`, og begge kodene finnes under `wet_room.documentation_type`.
7. **threshold_condition_shape:** fuktregelen bruker `threshold_key`, og `operator` og `value` er tomme.
8. **building_code_labels:** navnene er «Før 1997», «TEK97 (1997–2010)», «TEK10 (2010–2017)», «TEK17 (fra 2017)», «Ukjent», og kodene er uendret (`before_1997`, `from_1997_to_2010`, `tek10`, `tek17`, `unknown`).
9. **no_tg0:** ingen regel peker på et utfall med TG0, og ingen testsak forventer TG0.
10. **no_threshold_height_rule:** ingen regel leser `wet_room.threshold_height_mm` (A229).
11. **1.28 kontrollene kan feile** utvides med de nye kontrollene i 5 (hver med et dokument som skal feile).

## 4. Regeltestene (testsaker som data), `src/db/seed/templates/wet-room.rules.test.ts` (ny, ren)

1. **all_test_cases_pass:** `runRuleTestCases` på badmalen med `WET_ROOM_LIFESPANS` og `WET_ROOM_THRESHOLDS` gir `passed = true` for alle (`it.each` over testsakene, navnet i testtittelen).
2. **coverage_per_rule:** hver av de fire reglene har minst én testsak med `expected_state` `triggered`, én `not_triggered` og én `not_evaluated`, og minst én kantverdi (testsakens navn eller merke).
3. **test_cases_can_fail:** en kopi av malen med én testsak der `expected_state` er snudd gir `passed = false` (viser at kjøreren ikke godtar alt).
4. **inspection_year_set:** hver testsak har `inspection_year`, og `input` har ikke befaringsåret.

Testsakene som minst skal finnes i malen (kortet Omfang 5). Testen i 4.5 sjekker hver av dem med `evaluateRules` direkte, slik at de ikke bare står i data:

| Nr | Regel | Inndata (befaringsår 2026) | Forventet |
|---|---|---|---|
| A1 | `membrane_past_lifespan` | folie, `none`, 2009 (17 år) | `not_triggered` |
| A2 | | folie, `none`, 2008 (18 år) | `triggered`, `tg2` |
| A3 | | folie, `declaration_of_conformity`, 2008 | `not_triggered` |
| A4 | | folie, dokumentasjon tom, 2008 | `triggered`, begrunnelse «ikke oppgitt» |
| A5 | | folie, `other_written`, 2008 | `triggered` |
| A6 | | `unknown`, 2005 | `not_evaluated`, `material_unknown` |
| A7 | | folie, 2027 | `not_evaluated` |
| A8 | | folie, `membrane_year` tom, `build_year` 2008, kilde `owner_stated` | `triggered`, begrunnelsen viser `wet_room.build_year` og `owner_stated` |
| A9 | | begge årstall tomme | `not_evaluated` |
| B1 | `membrane_before_2000` | folie, 1999 | `triggered`, `tg3` |
| B2 | | folie, `none`, 2000 | `not_triggered`; `membrane_past_lifespan` `triggered` |
| B3 | | folie, 1990 | `triggered`; `membrane_past_lifespan` `not_triggered` (bare TG3) |
| B4 | | `unknown`, 1990 og tom type, 1990 | `triggered` |
| B5 | | `build_year` 1990, `membrane_year` 2015 | `not_triggered` |
| B6 | | `build_year` 1995, kilde `estimated`, `membrane_year` tom | `triggered`, begrunnelsen viser `estimated` |
| B7 | | begge årstall tomme | `not_evaluated` |
| F1 | `hole_moisture_over_limit` | `done_with_findings`, grensen − 0,1, vekt-% | `not_triggered` |
| F2 | | `done_with_findings`, lik grensen, vekt-% | `triggered`, `elevated_moisture` |
| F3 | | `done_no_findings`, lik grensen | `triggered` |
| F4 | | `done_with_findings`, RF % | `not_evaluated`, `unit_not_supported` |
| F5 | | måleverdi tom / enhet tom / −1 / tekst | `not_evaluated` (fire saker) |
| F6 | | `not_done`, måling tom | `not_triggered` |
| F7 | | `hole_drilling` tomt | `not_evaluated` |
| H1 | `hole_drilling_not_done` | `not_done` + `owner_refused` / `no_access` / `concrete_or_masonry` / `other` / uten grunn | `triggered`, TGIU på `wet_room.adjacent` (fem saker) |
| H2 | | `done_no_findings` | `not_triggered` |
| H3 | | tomt | `not_evaluated` |

5. **each_listed_case_exists:** hver rad i tabellen over finnes som testsak i malen (sjekk på inndata og forventet tilstand), og gir samme svar med `evaluateRules` direkte.
6. **59a_per_checkpoint (T-0003, kan ikke fjernes):** bad med `build_year` 1985, membran tom, `done_no_findings`, måling under grensen i vekt-%: ingen `triggered` med `checkpoint_key = wet_room.adjacent`, og `membrane_before_2000` gir TG3-forslag på `wet_room.membrane_drain`. Samme med `done_with_findings`.
7. **59a_no_age_rule_on_adjacent:** ingen regel i malen med `checkpoint_key = wet_room.adjacent` har en `age_vs_lifespan`-betingelse.
8. **no_tgiu_and_outcome_together:** for `not_done` gir ingen regel et utfallsforslag på `wet_room.adjacent` samtidig med TGIU.
9. **reasons_no_personal_data:** for alle testsakene er `JSON.stringify(result.reasons)` uten `@`, uten sifferfølger på 8 eller flere og uten mellomrom (bare koder og tall).

## 5. Kontrollene i malmotoren, `src/core/templates/document.test.ts` (ny eller utvidet, ren)

Hver kontroll: gir ingen feil på badmalen og det lille dokumentet, og gir norsk feilmelding på et dokument laget for å feile.
1. **suggest_outcome_without_outcome:** `suggest_outcome` uten `suggested_outcome` avvises (T-0014 punkt 3).
2. **outcome_other_checkpoint:** regelen på ett punkt, utfallet på et annet, avvises (punkt 4).
3. **rule_on_non_tg_checkpoint:** `suggest_outcome` og `suggest_tgiu` mot punkt med `gives_tg = false` avvises (punkt 2), begge formål.
4. **threshold_with_operator_or_value:** `threshold_key` satt sammen med `operator` eller `value` avvises.
5. **age_without_required_keys:** `age_vs_lifespan` uten `age_year_element_key` eller uten `material_element_key` avvises.
6. **messages_norwegian:** feilmeldingene er norske (ingen engelske ord som «rule», «outcome»), og nevner regelkoden.

I `src/core/templates/templates.test.ts` (mot databasen):
7. **4.5.14 save_rejects_bad_rules:** `saveDraftContent` med hvert av de fem feilene gir `TemplateValidationError`, ingen rader lagret og ingen loggrad (som 4.5.12).

## 6. Migrering og dokumentformat (mot databasen)

I `src/db/templates-schema.test.ts`:
1. **0030_columns_format_check:** hver av de sju nye kolonnene i `rule_conditions` godtar en gyldig kode og `null`, og avviser en ugyldig kode (`"Ugyldig Kode"`) med CHECK-feil (`it.each` over kolonnene).
2. **expected_state_check:** `expected_state` er `NOT NULL` og godtar bare `triggered`, `not_triggered`, `not_evaluated`. `expect_triggered` finnes ikke lenger.
3. **inspection_year_check:** tomt godtas, urimelig årstall (for eksempel 1700 og 3000) avvises.
4. **migration_keeps_meaning:** migreringen kjørt på en database med `expect_triggered = true` og `false` gir `triggered` og `not_triggered` (egen test som kjører migreringen 0029 → 0030 på et eget skjema, eller SQL-en fra migreringen mot rader satt inn før; testskriver velger, men testen må vise begge verdiene).
5. **migration_number_free:** bare én migrering med prefiks `0030` i `drizzle/` (sjekkes også av gjennomgangen før merge).

I `src/core/templates/templates.test.ts`:
6. **2.18 save_and_read_rule_fields:** `saveDraftContent` lagrer de sju kolonnene, `expected_state` og `inspection_year`; `getTemplateVersion` gir dem tilbake likt.
7. **2.19 copy_rule_fields:** `createDraftVersion` kopierer de nye feltene.
8. **2.20 idempotent_and_changed:** samme dokument to ganger gir 0/0/0; bare `threshold_key` endret gir 0/1/0; bare `expected_state` endret på en testsak gir 0/1/0.
9. **2.13 wet_room_template_saves** utvides: hele badmalen med reglene lagres, publiseres og leses tilbake med fire regler og alle testsakene.

I `src/core/templates/schemas.test.ts`:
10. **expected_state_schema:** ukjent verdi avvises med norsk melding; `expect_triggered` i dokumentet avvises eller ignoreres (ikke stille lagret).

## 7. Tilgang og tenant-isolasjon (mot databasen)

Ingen nye spørringer og ingen nye tabeller. Derfor:
1. **4.2.2 utvides (kan ikke fjernes):** dokumentet i `expectTenantIsolation` for `getTemplateVersion` får en regel med `threshold_key`, alle alderfeltene og en testsak med `expected_state` og `inspection_year`. Organisasjon B får verken rader eller tilgang.
2. **4.1.2** (takstmann uten rettighet får nei på alle fire endringstjenestene) kjøres med et dokument som har regler, og ingen rader endres.
3. **4.1.5 og 2.16** (admin stenges aldri ute) er uendret og grønne; 2.16 kjøres med badmalen med reglene.
4. **4.1 lese per rolle:** takstmann og kontor leser malen med reglene (`getTemplateVersion`), og leder uten `template.edit_structure` får nei på `saveDraftContent`.
5. **tenant_tables_unchanged:** `tests/tenant-isolation-all-tables.test.ts` er grønn uten endring i `tests/tenant-tables.ts`.
6. **4.5.13** (`organization_id` = `grant.organizationId` på nye rader) gjelder også `rule_conditions` og `rule_test_cases` med de nye kolonnene.

Myk sletting: dekket av 1.2 (motoren hopper over `deleted_at`) og 4.5.4 (fjernet regel er myk slettet, også med de nye kolonnene).

## 8. Modulgrensen, `eslint-rules/module-boundaries.test.ts` (utvidet, ren)

1. **rules_value_imports_blocked:** fra `src/core/rules/*` stoppes verdi-import fra `@/db`, `@/db/schema`, `@/core/templates`, `@/core/ai`, `server-only`, `node:fs` og `zod`.
2. **rules_type_imports_allowed:** `import type` fra `@/core/templates` og `@/db/schema` godtas; import fra `@/shared` og egen mappe godtas.
3. **templates_cannot_import_rules:** `src/core/templates/*` kan ikke importere `@/core/rules`.
4. **offline_trial_untouched:** ingen fil i `src/core/rules` importerer fra `src/modules/offline-trial`.
5. `pnpm lint` er grønn på hele repoet.

## 9. Seed, `src/db/seed/run.test.ts` (utvidet, mot databasen)

1. **seed_new_version_on_change:** etter seed av forrige malinnhold (v1 fra PR #159) gir ny seed en ny publisert versjon med reglene og de nye navnene på byggeforskrift; v1 er utgått og urørt.
2. **seed_idempotent:** seed to ganger gir ingen ny versjon.
3. **codes_unchanged:** valgkodene for `wet_room.building_code` er de samme i v1 og v2.

## 10. KI og TG0

1. **no_ai_in_rules:** ingen fil i `src/core/rules` (lest som tekst) importerer fra `@/core/ai` eller inneholder `fetch(`. Lint (8.1) håndhever det samme.
2. **no_tg0_suggestion:** for alle testsakene i 4 er `suggestion.outcome_key` aldri et utfall med TG0, og `suggestion.kind` er bare `outcome` eller `tgiu` (dekket av 3.9 og 4).
3. `tests/no-model-names.test.ts` er grønn.

## 11. E2e, PC og iPad

Ingen skjerm i denne oppgaven, så ingen ny e2e. At motoren kan kjøre i nettleseren uten nett sikres av lint (8) og av at motoren ikke har verdi-importer. Krav: `pnpm test:e2e` er grønn i prosjektene `pc` og `ipad`, og ingen eksisterende e2e er endret eller hoppet over. E2e uten nett for TG-forslag kommer med skjermen for badet (neste punkt).

## 12. Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Ren funksjon, lint stopper importer | 1.1, 2.7, 8.1–8.4, 10.1 |
| Determinisme, ukjent type, treverdilogikk, egen mal, inaktive og slettede | 1.1–1.14 |
| Testsaker per regel | 4.1–4.5 |
| Svar 59a | 4.6, 4.7, 4.8, F1–F7, H1–H3 |
| Før 2000 | B1–B7, 1.24 |
| Alder og begrunnelse | A1–A9, 1.22–1.28, 4.9 |
| Ingen TG0, ingen KI | 3.9, 10.1, 10.2 |
| Levetider og terskel som utkast, `key_snapshot` | 2.1–2.6, 3.2 |
| Kontrollene i malmotoren | 5.1–5.7, 3.11 |
| Migrering, lagring, kopi, «endret», seed | 6.1–6.10, 9.1–9.3 |
| Tilgang og tenant-isolasjon | 7.1–7.6 |
| iPad-størrelse og e2e | 11 |
| Lint, typecheck, test, e2e grønne | kjøres av test-leder til slutt |

## 13. Godkjennes ikke uten

- 7.1 (utvidet `expectTenantIsolation` for `getTemplateVersion`), 7.2 og 7.3 (admin stenges aldri ute).
- 4.6 og 4.7 (svar 59a per kontrollpunkt, T-0003) og H1 (alle fire grunner og uten grunn gir TGIU).
- 1.10 og 1.11–1.13 (ukjent gir aldri stille `not_triggered`, T-0015).
- 3.1 (1.26 no_rules er erstattet, ikke bare slettet) og 3.2 (`key_snapshot` utvidet).
- 8.1 (lint stopper verdi-importer i motoren).
- At testene leser grensene fra `thresholds.ts` og `lifespans.ts` (gjennomgås i koden).
