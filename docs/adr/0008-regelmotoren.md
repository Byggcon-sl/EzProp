# ADR 0008 – Regelmotoren: ett rent blad i `src/core/rules`, svar i faste koder

Dato: 12.11.2026. Status: vedtatt av agentene i autonom modus (A221, A222); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-regler-bad.md`. Bygger på malmotoren (`0024_malmotor`, A136–A147) og ADR 0006 (KI i bunnen) og 0007 (tekststatus).

Støtter hovedmålene: **færre reklamasjoner** (TG-forslag kommer likt hver gang fra regler med testsaker, og «ikke vurdert» blir aldri stille til «slår ikke til»), **de ansatte** (samme forslag på iPaden uten nett og på PC, med begrunnelse) og **KI i bunnen** (regelsvaret er strukturerte koder og tall som KI senere kan bygge årsakstekst og sammendrag på; KI setter aldri TG og kalles aldri av motoren).

## Beslutninger

1. **Regelmotoren ligger i `src/core/rules`** som rene funksjoner: `evaluateRules` og `runRuleTestCases`. Typene står i `src/core/rules/types.ts` (`EvaluateRules`, `RunRuleTestCases`), kodene i `src/core/rules/codes.ts`. Ingen database, ingen server- eller nettleser-API, ingen dagens dato. Befaringsåret tas inn som argument.
2. **Rent blad, håndhevet med lint** (`eslint-rules/module-boundaries.js`, meldingen `rulesLeaf`): filene i `src/core/rules` får bare importere fra egen mappe og `@/shared`, og bare `import type` fra `@/core/templates` og `@/db/schema`. Ingen pakker (heller ikke `zod`, `server-only` eller `node:*`). Testfiler er unntatt. `src/core/templates` får ikke importere `src/core/rules` (`templatesToRules`), så det ikke oppstår en sirkel.
3. **Samme kode på iPaden og på serveren.** Det finnes én motor. Regelen i `CLAUDE.md` (regel 5) er dermed en egenskap ved koden, ikke en avtale.
4. **Inndata er maldokumentet, ikke databaserader.** Motoren leser `rules`, `rule_conditions`, `outcomes` og `element_options` fra `TemplateDocument`, svarene som `feltkode → verdi`, og levetider og terskler som argument. Den bruker bare faste koder, aldri id-er.
5. **Tre tilstander:** `triggered`, `not_triggered` og `not_evaluated` (`RULE_RESULT_STATES` i `src/db/schema/templates.ts`). Treverdilogikk: med `all` gir én usann `not_triggered`, ellers gir én ukjent `not_evaluated`, ellers `triggered`; med `any` gir én sann `triggered`, ellers gir én ukjent `not_evaluated`, ellers `not_triggered`. Grupper (`group_no`) slås sammen på samme måte. Tomt eller ugyldig felt, og en betingelsestype motoren ikke kjører, gir alltid `not_evaluated`.
6. **Motoren avgjør selv hva som kjøres.** Bare aktive regler og betingelser. Bare formålene `suggest_outcome` og `suggest_tgiu`, og bare når malen er `system` + `condition_report`. Bare betingelsestypene `option_selected`, `number_vs_limit` og `age_vs_lifespan` nå (`SUPPORTED_CONDITION_TYPES`). Alt annet gir `not_evaluated` med en kode.
7. **Regelsvaret (`RuleResult`) har bare faste koder og tall:** regelkoden, tilstanden, forslaget (utfall med tre koder, eller TGIU på et kontrollpunkt), én begrunnelse per betingelse (én variant per betingelsestype), og kodene på levetids- og terskelsettet som ble lest. Ingen fritekst, ingen id-er, ingen persondata. Valgkoder i begrunnelsen tas bare med når de finnes som valg i malen. Motoren foreslår aldri TG0.
8. **Levetider og terskler er kodedata nå** (`src/core/rules/data/lifespans.ts` og `thresholds.ts`), med samme form som `lifespan_entries` og `threshold_entries` i domenemodellen 4.5. Hver rad har fast `key` og `status` (`draft` = «utkast, ikke godkjent av fagrådet»). Hvert sett har en fast settkode (`LifespanSet.key`, `ThresholdSet.key`). Motoren importerer aldri `data/`; den som kaller, sender settene inn. Når tabellene kommer i 2a-3, fylles de med de samme kodene, og motoren endres ikke.
9. **Feltkodene står i malen, ikke i motoren.** `rule_conditions` har fått `threshold_key`, `age_year_element_key`, `age_fallback_year_element_key`, `age_source_element_key`, `documentation_element_key`, `material_element_key` og `unit_element_key` (alle valgfrie, med samme format-CHECK som `element_key`). Retningen på en terskel står bare på terskelen; har betingelsen `threshold_key`, er `operator` og `value` tomme. For `age_vs_lifespan` er `value` listen over valgkodene som betyr «uten dokumentasjon».
10. **Strengeste trinn vinner.** En `age_vs_lifespan`-betingelse er sann når det strengeste levetidstrinnet som passer, har samme `outcome_kind` som regelens foreslåtte utfall. Ett sjikt gir derfor ett forslag, ikke både TG2 og TG3.
11. **`rule_test_cases.expected_state` erstatter `expect_triggered`** (A222), og testsaken har fått `inspection_year`. Migrering `0029_regler-bad` fyller `expected_state` fra den gamle kolonnen (`true` → `triggered`, `false` → `not_triggered`) og fjerner den i samme migrering. Dokumentformatet følger med.
12. **Kodene endres aldri** (regel 6): tilstandene, begrunnelseskodene, settkodene, kodene på levetidstrinn og terskler. Nye koder legges til i listene.

## Forkastet

- **Motoren inne i `src/core/templates`:** malmotoren importerer databasen og tilgangssjekken. Da kan ikke motoren kjøre i nettleseren uten å dra dem med.
- **Motoren i `src/shared`:** `shared` skal ikke kjenne domenet, og kan ikke bruke typene fra malmotoren.
- **Gjenbruk av prøve E (`src/modules/offline-trial/rules`):** den er en modul, ikke kjerne, og har et eget, smalere regelformat. Den står urørt.
- **Levetider og terskler som tabeller nå:** står ikke i fasen (2a-3). Kodedata med faste koder gir samme form uten skjermer, tilgang og tenant-tester.
- **To tilstander (ja/nei):** «ikke vurdert» kan da ikke testes, og et tomt felt ser ut som «alt i orden» (T-0015).
- **Både `expect_triggered` og `expected_state`:** to kolonner for det samme gir to sannheter.
- **Feltkoder skrevet inn i motoren** (for eksempel `wet_room.build_year`): da må motoren endres for hvert nytt rom.
- **Fritekst i begrunnelsen:** kan inneholde persondata, og kan ikke oversettes, telles eller brukes trygt av KI.
- **En regelpakke fra andre** (for eksempel et bibliotek for JSON-regler): ny avhengighet, og treverdilogikken og levetidstrinnene måtte uansett bygges utenpå.

## Følger

- Skjermen for badet (neste punkt) kaller `evaluateRules` med svarene i rommet og viser forslagene. Regelsvaret lagres sammen med `deviations.suggested_by_rule_id`, som slås opp fra regelkoden ved lagring.
- Kontrollen før publisering (2a-3) kaller `runRuleTestCases` og fyller `last_result` og `last_run_at`. Til da sikres testsakene av en Vitest-test på malfilen.
- Nye betingelsestyper og formålene `show` og `validate` legges til i motoren uten å endre svaret: de går fra `not_evaluated` til en egen begrunnelsesvariant.
- **Dyrt å endre:** plasseringen, formen på regelsvaret og de faste kodene, når regelsvar først er lagret i rapporter. **Lett å endre:** tallene i levetidene og tersklene, og reglene i malen (data og testsaker).
