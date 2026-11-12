# Funksjon: Reglene badet trenger

- **Fase:** 2a-2 Smal vei, andre punkt («Reglene badet trenger»)
- **Modul:** kjerne (ny `src/core/rules`: regelmotoren, levetider og terskler), malmotoren (`src/core/templates`, `src/db/schema/templates.ts`) og badmalen (`src/db/seed/templates/wet-room.ts`)
- **Branch:** `fase2a-regler-bad` (bygger på `main`, som har badmalen fra PR #159)
- **Status:** klar til bygging etter forhåndsvurdering (forenkler, arkitekt, fagansvarlig, test-leder). Avgjørelsene står under «Avgjort i forhåndsvurderingen».
- **Dato:** 12.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** våtrom gir flest reklamasjoner. Reglene foreslår TG ut fra membrantype, alder, dokumentasjon og fuktmåling, likt hver gang, og de foreslår TGIU når hull ikke er tatt. Det er det IVIT ikke gjør (`kartlegging-bad.md`, «Funn og svakheter i IVIT»). Et bad uten hulltaking kan ikke lenger ende med TG0 ved en feil (T-0003).
  - **De ansatte:** takstmannen slipper å slå opp levetider og grenser og huske unntakene. Han får et forslag med begrunnelse og godtar, endrer eller avviser det (skjermen kommer i neste punkt).
  - **KI i bunnen:** regelsvarene er strukturerte data med fast kode og begrunnelse (hvilken alder, hvilken kilde for alderen, hvilket trinn, hvilken måling). Det er dette KI senere bygger årsakstekst og sammendrag på. Reglene er faste og prøvd med testsaker, så KI trenger aldri å vurdere TG.

## Problem
Badmalen (PR #159) har punkter, felt og avvikstekster, men ingen regler. Uten regler må takstmannen selv vite at en foliemembran uten dokumentasjon er over levetiden etter 18 år, at sjikt fra før 2000 gir TG3, og at et bad uten hulltaking skal ha TGIU. Det er nettopp der feilene og reklamasjonene oppstår. Neste punkt (skjermen for badet) kan heller ikke vise TG-forslag før reglene finnes.

Svaret fra Ståle 10.11.2026 (spørsmål 59a) er i tillegg lest på ulike måter (T-0003). Det må bli én tydelig regel før noe bygges.

## KI i bunnen
- **KI setter aldri TG.** TG-forslag kommer bare fra regelmotoren (CLAUDE.md regel 14, ADR 0006). Regelmotoren kaller aldri KI, og regelsvarene går ikke gjennom KI.
- **Ingen KI-kall i denne oppgaven**, og ingenting legges til i `src/core/ai`.
- **Data som lagres for KI senere:** hvert regelsvar har regelkoden, tilstanden (`triggered` / `not_triggered` / `not_evaluated`), forslaget (utfallskode eller TGIU), punktet det gjelder og en strukturert begrunnelse: alder i år, årstallet som ble brukt og hvor det kom fra (sjiktets årstall / våtrommets byggeår), kilden for alderen (`build_year_source`), om dokumentasjon finnes, trinnet i levetidstabellen (kode) og målingen mot grensen (verdi, enhet, grense). Ingen fritekst og ingen persondata i begrunnelsen. Når skjermen og avvikene kommer, lagres dette sammen med `deviations.suggested_by_rule_id`, og KI kan bruke det til utkast til årsak og sammendrag (2a-2 «KI i veien»).
- Levetider og terskler får fast kode og `status` (`draft` / `approved`), så KI og PDF senere kan vise om et tall er godkjent av fagrådet.

## Tolkningen av svar 59a (T-0003), avgjort av agentene
Ståle 10.11.2026: «TG0 gis når vi ikke måler fukt, uavhengig av hvor gammelt badet er.» Lest sammen med forskriften (hulltaking ikke utført gir TGIU) og TG-vilkårene, betyr det: **når det er tatt hull og målt, og fukten ikke er forhøyet, gir alderen alene ikke TG2 på tilliggende konstruksjoner.** Tre tilfeller, hvert med testsak:

| Hulltaking (`wet_room.hole_drilling`) | Måling | Regelens forslag på `wet_room.adjacent` |
|---|---|---|
| `done_no_findings` eller `done_with_findings` | Under grensen | Ingen forslag. Ingen regel gir TG2 på tilliggende på grunn av alder. Takstmannen setter TG selv. |
| `done_no_findings` eller `done_with_findings` | Lik eller over grensen (vekt-%) | Utfallet «forhøyet fukt ved hulltaking» (`choose_tg2_tg3`, A207). Takstmannen velger TG2 eller TG3. Gjelder også `done_no_findings`. |
| `done_no_findings` eller `done_with_findings` | Måleverdi eller enhet tom, verdi negativ eller ikke et tall | Ikke vurdert. |
| `done_no_findings` eller `done_with_findings` | Målt i RF % | Ikke vurdert, med begrunnelseskoden `unit_not_supported`. |
| `not_done` (alle fire grunner, også `owner_refused`, og uten valgt grunn) | – | TGIU på punktet. Fuktregelen gir `not_triggered`. |
| tomt | – | Ikke vurdert. |

59a gjelder bare tilliggende konstruksjoner. Et bad fra 1985 med hull tatt og fukt under grensen gir ingen forslag på `wet_room.adjacent`, men regelen for sjikt fra før 2000 gir fortsatt TG3-forslag på `wet_room.membrane_drain`. Testsaken sjekker hvert kontrollpunkt for seg.

Regelen foreslår aldri TG0 (TG0 er ikke et utfall). Om TG0 kan gis på tilliggende konstruksjoner i et eldre bad når TG-vilkårene sier 0–5 år med dokumentasjon, står fortsatt åpent for fagrådet (spørsmål 72); det påvirker ikke reglene, bare hva takstmannen velger selv. Planlinjen skrives om til «målt uten forhøyet fukt», og svaret som anbefalte TG1 i `svar-claude-pa-vegne-av-stale-2026-11-10.md` merkes som erstattet av Ståles svar. Føres som beslutning i `docs/09-apne-sporsmal.md` (**lett å endre**: bare regeldata og testsaker).

## Brukerhistorier
- Som **takstmann** vil jeg **få et TG-forslag med begrunnelse når membranen er over levetiden, er fra før 2000 eller fukten er over grensen** slik at **jeg ikke glemmer noe og vurderer likt hver gang**.
- Som **takstmann** vil jeg **få forslag om TGIU når hull ikke er tatt** slik at **badet ikke får en TG som ikke er undersøkt**.
- Som **fagansvarlig (Ståle)** vil jeg **se levetidene, grensene og reglene som data merket «utkast»** slik at **fagrådet kan godkjenne dem før ekte bruk**.

## Omfang
**Med:**
1. **Regelmotoren i `src/core/rules`** som ren TypeScript uten database, server eller nettleser-API, slik at samme kode kjører på iPaden og på serveren. Grensesnittet (arkitekten):
   ```ts
   evaluateRules(input: {
     template: { kind: TemplateKind; reportType: string };
     document: Pick<TemplateDocument, "rules" | "rule_conditions" | "outcomes" | "element_options">;
     answers: Record<string, JsonValue>;   // feltkode -> verdi
     inspectionYear: number | null;
     lifespans: LifespanSet;               // { key, entries }
     thresholds: ThresholdSet;             // { key, entries }
   }): RuleResult[]

   runRuleTestCases(input: /* samme uten answers og inspectionYear, pluss rule_test_cases */): RuleTestCaseResult[]
   ```
   - `RuleResult`: `rule_key`, `state` (`triggered` / `not_triggered` / `not_evaluated`), `suggestion` (`{ kind: "outcome", checkpoint_key, question_key, outcome_key }`, `{ kind: "tgiu", checkpoint_key }` eller `null`), `reasons` (én variant per betingelsestype, bare koder og tall), `lifespan_set_key`, `threshold_set_key`. Bare faste koder, aldri id-er. `deviations.suggested_by_rule_id` slås opp ved lagring i neste punkt.
   - **Bare aktive regler og betingelser kjøres:** `active = false` eller `deleted_at` satt gir ingen svar.
   - **Bare formålene `suggest_outcome` og `suggest_tgiu`,** og bare når malen er `system` + `condition_report` (domenemodellen 4.5, beslutning 27.10.2026). Motoren sjekker dette selv; fra en egen mal gir de `not_evaluated`.
   - **Bare tre betingelsestyper:** `option_selected`, `number_vs_limit` (fast verdi eller `threshold_key`) og `age_vs_lifespan`, med grupper og `match` (`all` / `any`). Alle andre typer gir `not_evaluated`, aldri en stille «slår ikke til».
   - **Treverdilogikk:** `all`: én usann gir `not_triggered`, ellers gir én ukjent `not_evaluated`, ellers `triggered`. `any`: én sann gir `triggered`, ellers gir én ukjent `not_evaluated`, ellers `not_triggered`. Likt for grupper.
   - **Tomt eller ugyldig felt gir `not_evaluated`** (T-0015): tomt felt, årstall etter befaringsåret, negativ eller ikke-numerisk måling, måling uten enhet.
   - Motoren importerer aldri `data/`. Levetider og terskler kommer alltid inn som argument, så de kan bli tabeller i 2a-3 uten at motoren endres. Prøve E (`src/modules/offline-trial/rules`) står urørt og gjenbrukes ikke.
   - **Modulgrensen håndheves med lint** i `eslint-rules/module-boundaries.js`, slik som `core/ai/client`: `src/core/rules` får bare importere fra egen mappe og `@/shared`, og ellers bare `import type` (fra `@/core/templates` og `@/db/schema`). Ingen `zod`. `core/templates` importerer ikke `core/rules`.
2. **Levetider med trinn** som kodedata i `src/core/rules/data/lifespans.ts`, samme form som `lifespan_entries` i domenemodellen 4.5 (tallverdier er fakta fra NS 3600:2025 tillegg C, se `regelverk-krav.md`, «Aldersvilkår»). Settet har en fast kode (`LifespanSet.key`) som følger med i regelsvaret. Hver rad: `key`, `material_code` (samme koder som valgene i `wet_room.membrane_type`, eller tom = alle materialer), `component`, `from_year`, `to_year`, `min_age`, `documentation` (`with` / `without` / `any`), `outcome_kind` (`tg2` / `tg3`), `source_ref`, `sort_order` og `status` (samme koder som `TEXT_STATUSES`, her `draft`).
   - Med: de åtte membrantypene (smøremembran 22/15, folie 25/18, banemembran 30/20, membranplater 22/15, baderomskabin 20/15, baderomspanel 20/10, våtromstapet/maling 7, våtromsvinyl 20), og trinnet «før 2000»: én rad med `to_year = 1999`, `documentation = any`, tom `material_code` og `outcome_kind = tg3`.
   - **Grensene:** alder lik `min_age` gir trinnet (folie uten dokumentasjon: 17 år nei, 18 år ja). `to_year = 1999` betyr at 1999 er med og 2000 ikke.
   - **Strengeste trinn vinner.** En `age_vs_lifespan`-regel slår til når det strengeste trinnet som passer, har samme `outcome_kind` som regelens foreslåtte utfall. Motoren leser `outcomes` fra dokumentet. Sjikt fra 1990 gir derfor bare TG3, ikke TG2 i tillegg.
   - **Ukjent eller tom membrantype:** bare radene uten `material_code` gjelder. Med årstall før 2000 slår TG3-forslaget til (det er nettopp de gamle badene som har ukjent sjikt). Med årstall fra 2000 gir aldersregelen (TG2) `not_evaluated` med begrunnelseskoden `material_unknown`, og «før 2000»-regelen gir `not_triggered`.
   - **Årstallet:** fra feltet i `age_year_element_key` (`wet_room.membrane_year`), ellers feltet i `age_fallback_year_element_key` (`wet_room.build_year`), ellers `not_evaluated`. Begrunnelsen viser årstallet, hvilket felt det kom fra og verdien i `age_source_element_key` (`wet_room.build_year_source`). Anslått eller ukjent kilde stopper ikke forslaget.
   - **Dokumentasjon:** hvilke valg som betyr «uten dokumentasjon», står i `value` på betingelsen som liste av valgkoder. Motoren kjenner ikke kodene. Tomt felt gir trinnene for «uten» (forsiktig side), og begrunnelsen sier at dokumentasjon ikke er oppgitt. Listen er `["none", "other_written"]`, se A-beslutningen om dokumentasjon under.
   - Alder regnes mot befaringsåret, som tas inn som argument (ikke dagens dato inne i motoren), så testsakene er stabile.
3. **Én terskel** som kodedata i `src/core/rules/data/thresholds.ts`, samme form som `threshold_entries` i 4.5 (`key`, `description`, `unit`, `value`, `comparator`, `source_ref`, `status`), og settet har en fast kode (`ThresholdSet.key`):
   - `wet_room_hole_moisture_weight_percent`: **15 vekt-% i treverk**, `comparator = gte` (lik eller over gir forslag), `unit = weight_percent` (samme kode som valget), `status = draft`. `source_ref`: «bransjepraksis, ikke bekreftet mot kilde – fagrådet må bekrefte (spørsmål 71)». Ikke noe Byggforsk-blad eller NS-punkt.
   - Retningen står bare på terskelen. Når `threshold_key` er satt, er `operator` og `value` på betingelsen tomme.
   - Måling i RF % gir `not_evaluated` med koden `unit_not_supported` (bare én grense nå). Enheten leses fra feltet i `unit_element_key`.
   - Regelens `message` sier at grensen gjelder treverk, så takstmannen selv vurderer måling i andre materialer. Ingen nye felt.
4. **Fire regler i badmalen** (`rules`, `rule_conditions`, `rule_test_cases` i `wet-room.ts`), alle med `source_ref` og `message` (egne ord, ingen gjetteord, ingen henvisning til standard i teksten):
   | Kode | Formål | Når | Forslag |
   |---|---|---|---|
   | `wet_room.membrane_past_lifespan` | `suggest_outcome` | Strengeste trinn for alder er `tg2` | Nytt spørsmål `wet_room.membrane_drain.membrane_past_lifespan` med utfall `tg2` (se tekstkrav under) |
   | `wet_room.membrane_before_2000` | `suggest_outcome` | Strengeste trinn er «før 2000» (`tg3`). Leser bare årstallet, gjelder alle membrantyper. | `wet_room.membrane_drain.membrane_before_2000` (`tg3`, finnes) |
   | `wet_room.hole_moisture_over_limit` | `suggest_outcome` | Hull tatt (`done_no_findings` / `done_with_findings`), målt i vekt-%, lik eller over grensen | `wet_room.adjacent.elevated_moisture` (`choose_tg2_tg3`, finnes) |
   | `wet_room.hole_drilling_not_done` | `suggest_tgiu` | `wet_room.hole_drilling = not_done`, uansett grunn | TGIU på `wet_room.adjacent` |
   Regelen og utfallet står alltid på samme kontrollpunkt (T-0014).
   - **Tekstkrav for det nye utfallet `membrane_past_lifespan`** (fagansvarlig): kriterium `age_uncertain_function`. Teksten sier at funksjonen er usikker på grunn av alder, ikke at sjiktet er utslitt eller lekker (sidemannskontroll R2). Samme form som A213: «registrert som fra {årstall}». Tiltaket er nærmere undersøkelse og oppfølging, ikke utskifting. Ingen gjetteord, ingen henvisning til standard, `text_status = draft`. Bare dette ene utfallet, ingen varianter per membrantype.
5. **Testsaker per regel i malen** (kjøres av `runRuleTestCases` i Vitest, alle må bestå). Hver regel har minst: slår til, slår ikke til, ikke vurdert og kantverdi. Testene leser grensen fra `thresholds.ts`, ikke et tall skrevet inn. Minst disse:
   - **Alder:** folie uten dokumentasjon 17 år gir ikke forslag, 18 år gir TG2; folie 18 år med samsvarserklæring gir ikke forslag; tom dokumentasjon gir trinnet «uten»; `other_written` gir trinnet «uten»; ukjent type + 2005 gir `not_evaluated` med `material_unknown`; årstall etter befaringsåret gir `not_evaluated`; uten `membrane_year` brukes `build_year`, og begrunnelsen viser feltet og kilden; uten begge gir `not_evaluated`.
   - **Før 2000:** 1999 gir TG3; 2000 gir ikke TG3, men TG2 for alder der typen er kjent og over levetiden; 1990 gir bare TG3, ikke TG2 i tillegg; ukjent type + 1990 og tom type + 1990 gir TG3; bad fra 1990 med membran fra 2015 gir ikke TG3; anslått byggeår 1995 gir TG3, og begrunnelsen viser `estimated`.
   - **Fukt:** under grensen gir ikke forslag; lik grensen gir forslag; `done_no_findings` lik eller over grensen gir forslag; RF % gir `not_evaluated` med `unit_not_supported`; tom måleverdi, tom enhet, negativ verdi eller tekst gir `not_evaluated`; `not_done` med tom måling gir `not_triggered`.
   - **Hulltaking:** `not_done` med hver av de fire grunnene og uten grunn gir TGIU; tomt felt gir `not_evaluated`.
   - **59a (bad fra 1985, hull tatt, fukt under grensen):** ingen forslag på `wet_room.adjacent`, og TG3-forslaget på `wet_room.membrane_drain` kommer fortsatt.
6. **Datamodellen for regler** (A147 løses nå for det som trengs), én migrering `0029_regler-bad` (sjekk før merge at ingen annen branch har tatt 0029):
   - `rule_conditions`, nye kolonner, alle `text`, kan være tomme, med samme format-CHECK som `element_key`: `threshold_key`, `age_year_element_key`, `age_fallback_year_element_key`, `age_source_element_key`, `documentation_element_key`, `material_element_key`, `unit_element_key`. Ingen nye indekser.
   - `rule_test_cases`: ny `expected_state text not null` med CHECK (`triggered`, `not_triggered`, `not_evaluated`). Migreringen fyller den fra `expect_triggered` (true gir `triggered`, false gir `not_triggered`) og fjerner `expect_triggered` i samme migrering. Ny `inspection_year integer` (kan være tom, CHECK på rimelig årstall). Befaringsåret ligger ikke i `input`.
   - Dokumentformatet: `expected_state` erstatter `expect_triggered`. Med i `schemas.ts`, `getTemplateVersion`, kopien i `createDraftVersion`, tellingen «endret», `tests/template-document.ts` og `tests/factories.ts`.
   - `last_result` og `last_run_at` venter fortsatt (kontrollen før publisering, 2a-3).
7. **Kontroller i malmotoren** (del av T-0014, rene funksjoner i `document.ts` med egne tester, kjøres i `saveDraftContent`, norske feilmeldinger). Bare de som beskytter reglene som lages nå:
   - en `suggest_outcome`-regel må ha `suggested_outcome` (T-0014 punkt 3),
   - regelen og utfallet må høre til samme kontrollpunkt (punkt 4),
   - en `suggest_outcome`- eller `suggest_tgiu`-regel mot et punkt med `gives_tg = false` avvises (punkt 2),
   - når `threshold_key` er satt, er `operator` og `value` tomme, og `age_vs_lifespan` må ha `age_year_element_key` og `material_element_key`.
   T-0014 punkt 1 (TG-utfall på punkt uten TG) og punkt 5 (TG-regel uten annen betingelse enn `always`) tas i den automatiske kontrollen før publisering i 2a-3. T-0014 settes til «delvis rettet», og det står hvilke punkter som gjenstår.
8. **Små funn fra PR #159 som hører til reglene:** navnene på valgene for `wet_room.building_code` overlapper («1997–2010» og «TEK10»). Bare navnene rettes, kodene står (regel 6): «Før 1997», «TEK97 (1997–2010)», «TEK10 (2010–2017)», «TEK17 (fra 2017)», «Ukjent». Feltet vises ikke i rapporten (A212), og ingen regel leser det. Seed lager ny publisert versjon når innholdet er endret (finnes fra PR #159).
9. **Testlagsfunn:** T-0003 og T-0015 settes til «rettet» med PR-nummeret, T-0014 til «delvis rettet» (punkt 2, 3 og 4 rettet; 1 og 5 i 2a-3).
10. **ADR `docs/adr/0008-regelmotoren.md`:** plassering i `src/core/rules`, rent blad håndhevet med lint, treverdilogikk, svar med faste koder, levetider og terskler som kodedata med settkode til tabellene kommer i 2a-3. Forkastet: motoren inne i `core/templates` (drar med databasen), tabeller for levetider nå (ikke i fasen), gjenbruk av prøve E (modul, ikke kjerne).
11. **Dokumentasjon:** domenemodellen 4.5 (nye kolonner, `key` og `status` på levetidstrinn og terskler, settkode, at levetider og terskler er kodedata nå og blir tabeller i 2a-3 med samme koder), ordlisten (`evaluateRules`, regelsvar, levetidstrinn, terskelkode, settkode `lifespan set` / `threshold set`, `expected_state`, `not_evaluated`), planlinjen for 59a («målt uten forhøyet fukt») og én linje i `docs/plan/endringslogg.md`, beslutninger fra A214 i `docs/09-apne-sporsmal.md` (se under), `package.json` 0.6.6 → 0.7.0.

**Ikke med (bevisst utelatt):**
- **Skjerm** for badet, avvikskort, TGIU-feltene og visning av TG-forslag (neste punkt «Badet på PC»). Ingen lagring av regelsvar i rapporten ennå.
- **Levetider, terskler og kostnadsintervaller som databasetabeller** og redigering av dem (2a-3). Nå er de kodedata med fast kode.
- Levetider for andre bygningsdeler enn vanntett sjikt i våtrom (rør, avløp, tak osv.), og regler for andre rom (2a-3).
- **Terskelhøyde som regel** (`wet_room.low_threshold_height`, 25 mm, A211): planlinjen sier én målegrense, og grensen kommer fra NS 3600 tillegg A, som ikke er avgjort (`regelverk-krav.md` avsnitt 4). Den tas med fall og skjevhet under målingene i 2a-3. Feltet `wet_room.threshold_height_mm` og utfallet `low_threshold_height` står i malen som før, og takstmannen setter TG selv.
- Fallgrense og gulvskjevhet som regel: grensene er ikke avklart (tillegg A er åpent, R8 i sidemannskontrollen).
- Formålene `show` og `validate`, og de andre betingelsestypene (`build_year`, `field_filled`, snødekke, bygningstype, TG på annet punkt, bilde mangler, TGIU satt, romtype, under terreng). 2a-3.
- At publisering av en malversjon stoppes når en testsak feiler, og `last_result`/`last_run_at` (kontrollen før publisering, 2a-3). Nå sikres det av testen på malfilen.
- Informasjonstekst ut fra byggeår, loft, krypkjeller og radon (2a-3).
- Godkjenning av levetider og terskler (fagrådet, Ståle). Ingen `verified_by`.
- De andre små funnene fra PR #159 (`{sted}` i tekstene, to måleverdier i fallteksten, kopisjekk av `data/*.csv`, doble seed-tester, telleverket i `wet-room.ts`, omskriving av to spørsmål). De tas med skjermen for badet, der tekstene vises.
- KI-kall og nye KI-funksjoner.

## Tilgang
Ingen ny tilgang og ingen nye spørringer. Regelmotoren er en ren funksjon uten database. Reglene lagres med malen og følger malmotorens tilgang (`template.edit_structure` for å endre, `organization.read` for å lese). Nye kolonner ligger i tabeller som allerede er tenant-isolert.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (med malen) | nei |
| kontor | ja | nei |
| leder | ja | nei, uten `template.edit_structure` |
| admin | ja | ja (alltid) |

## Data
- **Endret:** `rule_conditions` (sju kolonner for terskel, alder og enhet), `rule_test_cases` (`expected_state` erstatter `expect_triggered`, ny `inspection_year`). Migrering `0029_regler-bad`. Ingen nye tabeller, så `tests/tenant-tables.ts` er uendret.
- **Endret i dokumentformatet:** `expect_triggered` erstattes av `expected_state`, og testsakene får `inspection_year`.
- **Nytt (kodedata, ikke tabeller):** `src/core/rules/data/lifespans.ts` og `thresholds.ts` med faste koder, settkode og `status = draft`.
- **Faste koder som tas i bruk:** de fire regelkodene, spørsmålet `wet_room.membrane_drain.membrane_past_lifespan` med utfallet `tg2`, terskelkoden `wet_room_hole_moisture_weight_percent`, settkodene, begrunnelseskodene (for eksempel `material_unknown`, `unit_not_supported`) og kodene på levetidstrinnene. De endres aldri etter merge (regel 6); `key_snapshot` i malens test utvides.

## Skjermer
Ingen.

## Regler
Se Omfang 4 og 5. Reglene er data i badmalen med testsaker, og kjøres av én motor i `src/core/rules`.

## Akseptkriterier
- [ ] `evaluateRules` og `runRuleTestCases` er rene funksjoner i `src/core/rules`. Lint stopper verdi-importer fra `@/db`, `@/core/templates`, `server-only`, `node:*` og `@/core/ai`.
- [ ] Samme input gir samme svar. Ukjent betingelsestype gir `not_evaluated`. `all` og `any` med grupper følger treverdilogikken. `suggest_outcome` og `suggest_tgiu` fra en egen mal kjøres ikke. Inaktive og myk-slettede regler og betingelser kjøres ikke.
- [ ] Hver av de fire reglene har testsaker for slår til, slår ikke til, ikke vurdert og kantverdi (Omfang 5). Alle består.
- [ ] Svar 59a: bad fra 1985 med hull tatt og fukt under grensen gir ingen forslag på `wet_room.adjacent`, men TG3-forslag på `wet_room.membrane_drain`; fukt lik eller over grensen gir `choose_tg2_tg3`, også ved `done_no_findings`; `not_done` med hver av de fire grunnene og uten grunn gir TGIU; tomt gir ikke vurdert.
- [ ] Sjikt fra 1990 gir bare TG3. 1999 gir TG3, 2000 gir det ikke. Ukjent eller tom membrantype + 1990 gir TG3. Bad fra 1990 med membran fra 2015 gir ikke TG3.
- [ ] Folie uten dokumentasjon: 17 år nei, 18 år TG2; med samsvarserklæring nei. Ukjent type etter 2000 og manglende årstall gir ikke vurdert. Begrunnelsen viser årstall, felt og kilde, og bare koder og tall (ingen fritekst eller persondata).
- [ ] Ingen regel foreslår TG0, og ingen regel kaller KI.
- [ ] Alle levetidsrader og terskelen har `status = draft` og `source_ref`; kodene er unike; hver `material_code` finnes som valg i `wet_room.membrane_type` (test). `key_snapshot` er utvidet.
- [ ] Kontrollene i Omfang 7 avviser feil mal med norsk melding (test på dokumenter laget for å feile), og badmalen består.
- [ ] Migreringen: nye kolonner har format-CHECK (ugyldig nøkkel stoppes), eksisterende testsaker beholder betydningen (`true` → `triggered`, `false` → `not_triggered`). Lagring, lesing og kopi til nytt utkast tar med de nye feltene, og «endret» ser dem. Seed lager ny publisert versjon med de rettede navnene, kodene uendret.
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen nye spørringer, men 4.2-testen for `getTemplateVersion` utvides med en regel som har `threshold_key` og alderfeltene. 4.1.2 og 4.1.5 (admin stenges aldri ute) er fortsatt grønne.
- [ ] Virker på iPad-størrelse: ingen skjerm. At motoren kan kjøre i nettleseren, sikres av lint-regelen. `pnpm test:e2e` er grønn på PC og iPad.
- [ ] KI-forslag: ingen i denne oppgaven.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Avgjort i forhåndsvurderingen (prosjektlederen)
- **Terskelhøyde tas ut (forenkleren, fagansvarlig punkt 6).** Planlinjen sier én målegrense for fukt, og 25 mm kommer fra tillegg A, som ikke er avgjort. Fire regler, én terskel. Til 2a-3 med fall og skjevhet.
- **Bare tre betingelsestyper (forenkleren).** `build_year` og `field_filled` trengs ikke av de fire reglene.
- **Sju nye kolonner, ikke færre (arkitekten foran forenkleren).** Motoren skal ikke ha feltkoder skrevet inn, så reserveårstallet, kilden og enheten må stå som data. `age_source_element_key` står allerede i domenemodellen 4.5. `unit_element_key` trengs for at RF % gir `not_evaluated` og ikke `not_triggered` (T-0015).
- **Kontrollene i malmotoren (test-leder foran forenkleren):** T-0014 punkt 2, 3 og 4, pluss arkitektens to formkontroller. Alle er små og beskytter reglene nå. Punkt 1 og 5 til 2a-3.
- **Ukjent membrantype og før 2000 (fagansvarlig og arkitekt er enige):** TG3-forslaget slår til; bare aldersregelen (TG2) blir ikke vurdert.
- **`expected_state` erstatter `expect_triggered` i samme migrering (arkitekten):** to kolonner for det samme gir to sannheter, og ingen data går tapt.
- **Navnene på byggeforskrift:** fagansvarligs forslag. Overlappen i årstall ved overgangene er reell (overgangsperioder), og feltet styrer ingen regel.

**Beslutninger som føres i `docs/09-apne-sporsmal.md` fra A214 i PR-en:**
- A214 tolkningen av 59a (tabellen over). **Lett å endre** (regeldata og testsaker).
- A215 fuktgrensen 15 vekt-% i treverk, lik eller over gir forslag, `status = draft`. Alternativet 20 vekt-% står i spørsmål 74. **Lett å endre** (ett tall).
- A216 grensene: alder lik `min_age` gir forslag, fukt lik grensen gir forslag (spørsmål 69 og 70 foreløpig avgjort slik). **Lett å endre.**
- A217 «med dokumentasjon» betyr samsvarserklæring eller våtromssertifikat. «Annen skriftlig dokumentasjon» og tomt felt gir trinnet «uten». Grunn: forsiktig side gir færre reklamasjoner, og takstmannen kan alltid endre forslaget. Fagansvarlig pekte på at kortets første valg ga lengre levetid. **Lett å endre** (verdilisten på betingelsen).
- A218 ukjent membrantype: før 2000 gir TG3-forslag; etter 2000 gir ikke vurdert, ikke korteste levetid. **Lett å endre.**
- A219 terskelhøyde utsatt til 2a-3 (ikke bindende etter tillegg A). **Lett å endre.**
- A220 det nye utfallet `wet_room.membrane_drain.membrane_past_lifespan` (TG2, `age_uncertain_function`). **Dyrt å endre** (fast kode).
- A221 regelmotoren i `src/core/rules` med svar i faste koder og kodedata med settkode (ADR 0008). **Dyrt å endre** (arkitektur, faste koder).
- A222 `expected_state` erstatter `expect_triggered`. **Dyrt å endre** (kolonne og dokumentformat).

## Åpne spørsmål
- Spørsmål 71 (fuktgrensen) og 72 (TG0 på tilliggende i eldre bad) står åpne for fagrådet. Reglene bygges med agentenes valg, merket utkast, og føres som beslutninger (lett å endre).
- Spørsmål 74 (ført 12.11.2026): fuktgrensen 15 eller 20 vekt-% og kilde, hva som teller som dokumentasjon, ukjent membrantype etter 2000, egen grense for RF %, og «lik grensen» for alder og fukt. Stopper ikke bygging.

## Roller
forenkler, arkitekt, fagansvarlig, test-leder (forhåndsvurdering), utvikler og testskriver (bygging), gjennomgang. Ki-ansvarlig trengs ikke: ingen KI-kall. Ikke ux, ui-designer eller sikkerhet-personvern: ingen skjerm, ingen nye spørringer, ingen persondata.
