# Testplan: Svarene i reglene og bygningene (F1–F7, F9)

- **Oppgavekort:** `docs/funksjoner/fase2a-svar-regler-bygninger.md`
- **Fasit:** `docs/kartlegging/svar-fra-stale-2026-11-12.md`
- **Dato:** 12.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** Færre reklamasjoner (testene låser at TG0 bare foreslås når hull er tatt uten funn og målt under grensen, at lik grensen alltid gir forslag, og at kryperom og kjeller får riktig arealtype og etasje). De ansatte (etasjenummer, «under terreng» og arealtype fylles ut og kan endres). KI i bunnen (regelsvaret er bare koder og tall som KI bygger på senere; ingen KI-kall).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet. Numrene (R1.1 osv.) står først i testnavnet, så rapporten kan krysse av.

**Ingen nye testfiler** unntatt der kortet sier ny funksjon i ny fil. Testene legges i filene som finnes for området. E2e: den eksisterende `e2e/fase-2a-bygninger-areal-rom.spec.ts` utvides (kortet).

## Avtale om signaturer (utvikler og testskriver)

- `src/core/rules/codes.ts`: `TG_SUGGESTION_PURPOSES` (eller tilsvarende) med `suggest_tgiu`, `suggest_outcome`, `suggest_tg0`.
- `src/core/rules/types.ts`: `RuleSuggestion` med `{ kind: "tg0"; checkpoint_key }`; `ConditionReasonBase.negated: boolean`.
- Dokumentformatet: `negate` på betingelsen, `.default(false)` i Zod, slik at lagrede utkast og publiserte versjoner uten feltet fortsatt leses.
- `src/core/templates/schemas.ts`: ny ren funksjon ved siden av `checkNoTgLogicInCustom` (for eksempel `checkNoBlockerInCustom(kind, doc): TemplateIssue[]`).
- `src/core/buildings/codes.ts`: `suggestFloor(name, existingLevels)` og `FLOOR_NAME_SUGGESTIONS`.

Avvik i navn føres i kortet.

## 1. Regelmotoren, `src/core/rules/evaluate.test.ts`

1. **R1.1 negate_flips:** betingelse med `negate = true`: sann blir usann, usann blir sann (`it.each` over terskel, fast grense og valg).
2. **R1.2 negate_keeps_unknown:** tom måling, annen enhet, ukjent terskelkode og tekst gir fortsatt `not_evaluated` med samme kode som uten `negate`.
3. **R1.3 negate_in_reasons:** begrunnelsen har `negated: true` og `truth` etter snuing; uten `negate` står `negated: false`.
4. **R1.4 negate_default_false:** betingelse uten feltet oppfører seg som før (alle eksisterende tester grønne uten endring i inndata).
5. **R1.5 suggestion_tg0:** regel med `suggest_tg0` som slår til gir `{ kind: "tg0", checkpoint_key }`; ikke slått til eller ikke vurdert gir `null`.
6. **R1.6 tg0_only_from_purpose:** erstatter «forslaget er aldri TG0 og bare outcome eller tgiu». TG0 kommer bare fra `suggest_tg0`; `suggest_outcome` og `suggest_tgiu` gir aldri `tg0`.
7. **R1.7 tg0_target_missing:** `suggest_tg0` uten `target_checkpoint_key` gir `not_evaluated` med koden `target_missing` (som TGIU).
8. **R1.8 purposes_match_schema:** listen i `src/core/rules/codes.ts` er lik `TG_RULE_PURPOSES` i `src/db/schema/templates.ts` (samme koder, samme rekkefølge). Ny kode i én av dem gjør testen rød.
9. **R1.9 result_shape_codes_only** (1.1.3) kjøres også med en `suggest_tg0`-regel: ingen id-er og ingen fritekst.

## 2. Regeldata, `src/core/rules/data/data.test.ts`

1. **R2.1 source_ns3600:** `SOURCE_RULE_MOISTURE` og `SOURCE_RULE_AGE` inneholder «NS 3600:2025», «Ståle 12.11.2026» og «utkast, ikke godkjent av fagrådet». Testen som forbød «NS» i kilden skrives om.
2. **R2.2 source_short:** kildeteksten er høyst 200 tegn (lengdegrense, ingen tekst fra standarden).
3. **R2.3 agreed_values** (2.3) står: terskelen er fortsatt 15 vekt-%, `gte`; alderstabellen er uendret (øyeblikksbilde av tallene).
4. **R2.4 no_guess_words:** ingen kilde eller melding i data eller i badmalen har «antas», «trolig», «sannsynligvis» eller «levetid».

## 3. Badmalen, `src/db/seed/templates/wet-room.rules.test.ts` og `wet-room.test.ts`

Testsakene ligger som data i `wet-room.ts` og kjøres av motoren. Testene her viser at de finnes og passerer.

1. **R3.1 all_test_cases_pass** (4.1) med de nye sakene.
2. **R3.2 tg0_rule_exists:** regelen `wet_room.hole_no_elevated_moisture` finnes, formål `suggest_tg0`, mål `wet_room.adjacent`, `suggested_outcome = null`, merket utkast, kilde «Ståles beslutning 12.11.2026 (F1)», ikke «NS».
3. **R3.3 tg0_same_threshold:** TG0-regelen og `hole_moisture_over_limit` bruker samme `threshold_key`; TG0-regelens målebetingelse har `negate = true`. Ingen ny terskel i `thresholds.ts`.
4. **R3.4 testsaker for TG0** (kortets liste, hver som egen testsak i malen):
   - 59a: bad fra 1985, uten funn, 14,9 vekt-% → TG0 på tilliggende; TG3-forslag på membran og sluk står.
   - kant: uten funn, 15,0 → ikke TG0, `hole_moisture_over_limit` slår til.
   - kant: uten funn, 14,9 → TG0, `hole_moisture_over_limit` slår ikke til.
   - med funn, 14,9 → ikke TG0 (A238).
   - uten funn, RF % 85 / tom måling / tom enhet / negativ / tekst → TG0-regelen `not_evaluated`.
   - uten funn, 0 vekt-% → TG0.
   - ikke tatt → ikke TG0, TGIU slår til.
   - tom hulltaking → `not_evaluated`.
5. **R3.5 never_both_or_none:** for 14,9 og 15,0 (og 14,95 om felttypen tillater det) slår nøyaktig én av TG0-regelen og `hole_moisture_over_limit` til, når hulltaking er «uten funn» og enheten vekt-%.
6. **R3.6 no_conflict_on_checkpoint:** ingen testsak gir `tg0` og `outcome` eller `tgiu` på samme kontrollpunkt (gjennom alle testsakene i malen).
7. **R3.7 edge_per_rule (F4, F5):** hver aktiv regel i badmalen har minst én testsak med «kant» i navnet. For alder: lik tabellverdien for hvert materiale med og uten dokumentasjon → TG2, én under → ikke. For år: 1999 → TG3, 2000 → ikke. For fukt: 15,0 → ja, 14,9 → nei.
8. **R3.8 gte_everywhere:** alle terskler og aldersbetingelser i badmalen bruker «lik eller over» (`gte` / `min_age`); ingen `gt` (A226 bekreftet).
9. **R3.9 59a_names:** testsakene for 59a og 4.7 er omdøpt; 4.7 «ingen regel på tilliggende leser alder» står og gjelder også TG0-regelen.
10. **R3.10 suggestions_allowed** (erstatter 10.2 `no_tg0_suggestion`): forslagene er utfall med TG2/TG3, TGIU, og TG0 bare på `wet_room.adjacent`.
11. **R3.11 messages:** `membrane_before_2000` har meldingen «Sjiktet er fra før 2000.» uten byggeår; `membrane_past_lifespan` har årsaken «funksjonen er usikker på grunn av alder» og kilden fra alderstabellen; `hole_drilling_not_done` nevner begrunnelse og risikovurdering og har kilden fra kortet punkt 2; TG0-meldingen sier at forslaget forutsetter måling i treverk.
12. **R3.12 keys_unchanged (regel 6):** øyeblikksbilde av alle regelkoder, utfallskoder og feltkoder fra før PR-en finnes fortsatt, uendret. Bare den nye koden er lagt til.
13. **R3.13 reasons_no_personal_data** (4.9) kjøres også for TG0-sakene.

## 4. Malkontroller, `src/core/templates/schemas.test.ts` og `document.test.ts`

1. **R4.1 tg0_needs_gives_tg:** `suggest_tg0` med mål uten `gives_tg` avvises; uten mål avvises; med `suggested_outcome` satt avvises.
2. **R4.2 tg0_not_in_custom:** `suggest_tg0` i egen mal avvises av `checkNoTgLogicInCustom`; i systemmalen godtas.
3. **R4.3 givesTgSuggestion:** `suggest_tg0` regnes som TG-forslag (dekker `checkRuleCheckpointGivesTg` og `checkRuleConditionShape`).
4. **R4.4 F9 blocker_in_custom:** `validate` med `severity = blocker` i egen mal gir feil med norsk melding som nevner regelkoden; `warning` godtas; systemmalen godtar `blocker` (`it.each` over malsort og alvorlighet).
5. **R4.5 F9 wired:** kildesjekk eller enhetstest som viser at den nye funksjonen kalles på samme sted som `checkNoTgLogicInCustom` i `templates.ts` (begge lagringsveiene).
6. **R4.6 checkDocumentKeys:** ukjent feltkode avvises, én sak per felt: `age_year_element_key`, `age_fallback_element_key` (eller tilsvarende `age_*`), `documentation_element_key`, `material_element_key`, `unit_element_key`. Kjent kode godtas.
7. **R4.7 negate_parse:** dokument uten `negate` parses til `false`; `negate: "ja"` avvises; `same-content.test.ts`: to dokumenter som bare skiller seg i `negate` er ikke like.

## 5. Database og migrering

`src/db/templates-schema.test.ts` og `src/db/buildings-schema.test.ts`:

1. **M5.1 purpose_check:** innsetting med `suggest_tg0` godtas; ukjent formål avvises.
2. **M5.2 negate_column:** `rule_conditions.negate` er `boolean not null default false`; innsetting uten verdi gir `false`; `null` avvises.
3. **M5.3 area_type_check:** `rooms.area_type = 'not_bra'` godtas; ukjent kode avvises.
4. **M5.4 migration_0031:** én fil med nummeret 0031; journalen er i rekkefølge med like mange øyeblikksbilder som oppføringer.
5. **M5.5 roundtrip** (`src/core/templates/templates.test.ts`, mot testdatabasen): et utkast med `suggest_tg0` og `negate = true` lagres med `saveDraftContent`, publiseres og leses tilbake likt.
6. **M5.6 seed:** `pnpm db:seed` to ganger gir badmalen med TG0-regelen én gang og `negate = true` i databasen (`wet-room.test.ts` eller `sample-template.test.ts`).

## 6. Bygningene, `src/core/buildings/codes.test.ts`, `schemas.test.ts`, `buildings.test.ts`

1. **B6.1 area_types:** `AREA_TYPES` er `bra_i, bra_e, bra_b, not_bra` i fast rekkefølge; etiketten er «Ikke del av BRA». Erstatter 1.1.
2. **B6.2 room_suggestions:** `crawl_space` og `unfinished_attic` foreslår `not_bra`; `basement_room` foreslår `bra_i`. Testsakene 1.6/1.7 og tellingen «de andre 29 gir bra_i» rettes.
3. **B6.3 crawl_space_not_below_ground:** `crawl_space` har `defaultBelowGround: false` og står ikke i `USUALLY_BELOW_GROUND`; i en etasje under terreng gir `suggestBelowGround` fortsatt `true` (A239).
4. **B6.4 sums_unchanged:** summene (`sumFloorArea` og per bygning) er like med og uten rom merket `not_bra`; `AreaSum` har ingen ny nøkkel.
5. **B6.5 schema_accepts_not_bra:** Zod-skjemaet for rom godtar `not_bra` og avviser ukjent kode.
6. **B6.6 suggestFloor** (`it.each`):
   - «Kjeller», «Underetasje», «kjeller», «  UNDERETASJE  » → `{ level: -1, belowGround: true }`.
   - «Kjeller» når -1 alt finnes → -1 (to etasjer på -1 er lov).
   - «Loft» med `[]` → 1; `[-1]` → 1; `[-1, 1, 2]` → 3; `[0]` → 1; `[19]` → 20; `[20]` → 20; `belowGround: false`.
   - «1. etasje», «Loftet», «Kjelleren», «» og fritekst → `null`.
7. **B6.7 floor_suggestions_list:** `FLOOR_NAME_SUGGESTIONS` står i `codes.ts`; kildesjekk: `buildings-editor.tsx` har ikke egen liste og importerer ikke fra `service.ts`.
8. **B6.8 save_not_bra** (`buildings.test.ts`, mot testdatabasen): rom med `not_bra` lagres og leses tilbake; etasje med -1 og `below_ground = true` lagres to ganger i samme bygning.
9. **B6.9 levels_without_deleted:** etasjelisten som skjermen får (og som går inn i `suggestFloor`), har ikke myk-slettede etasjer. Bruk eksisterende test om den finnes, ellers én ny: slett etasje 3, «Loft» gir 3.

## 7. Tilgang, tenant-isolasjon, admin og myk sletting

Ingen nye spørringer og ingen ny tilgangsregel (kortet). Derfor ingen nye `expectTenantIsolation`-kall, men følgende må være grønt og leses av test-leder:

1. **T7.1** `tests/tenant-isolation-all-tables.test.ts` grønn (ingen ny tabell).
2. **T7.2** `src/app/(ansatt)/oppdrag/[id]/bygninger/actions-access.test.ts` grønn; tilgangstestene for `saveDraftContent` og `publishVersion` i `templates.test.ts` grønne.
3. **T7.3 admin_not_locked_out:** admin lagrer rom med `not_bra` og etasje -1 (én ny sak i `buildings.test.ts`, eller utvid B6.8 til å kjøre som admin og som takstmann med `access.inspectors_edit_all`).
4. **T7.4 rolle:** takstmann uten skriverett kan ikke lagre `not_bra` (eksisterende NO_ACCESS-test dekker handlingen; ingen ny test hvis den kaller samme handling).
5. **T7.5 myk sletting:** B6.9; ingen `DELETE` i ny kode (kildesjekk eller gjennomlesing).
6. **Hvis utvikleren likevel legger til en spørring med `organizationId`:** nytt kall til `expectTenantIsolation` i samme testfil, ellers avvises PR-en.

## 8. E2e, `e2e/fase-2a-bygninger-areal-rom.spec.ts` (PC og iPad)

Kjøres i begge prosjektene. Valget i navnefeltet gjøres med `fill` på feltet med datalisten (gir samme `input`-hendelse som et ekte valg), ikke ved å sette verdien med skript.

1. **E8.1 kjeller:** ny etasje, velg «Kjeller» → nummer -1 og «Under terreng» krysset av. Endre nummer til -2, lagre, last på nytt → -2 og under terreng står.
2. **E8.2 manual_not_overwritten:** etter E8.1-endringen til -2 overskrives ikke nummeret så lenge navnet ikke endres (fokus inn og ut av navnefeltet).
3. **E8.3 underetasje:** «Underetasje» → -1 og under terreng.
4. **E8.4 loft:** med etasjene -1 og 1, velg «Loft» → 2 og «Under terreng» ikke krysset av.
5. **E8.5 fritekst:** «Mellometasje» → nummeret er som før (`nextLevel`), «under terreng» uendret.
6. **E8.6 kryperom:** romtype «Kryperom» → arealtype «Ikke del av BRA» valgt; kan byttes til BRA-i før lagring; lagret verdi står etter ny lasting.
7. **E8.7** 7.1–7.10 grønne uten endring i forventningene (sum 180,1, kjelleren øverst). `buildFullTree` må tåle at «Kjeller» nå fyller ut -1 selv.
8. **E8.8 iPad:** 7.9 (ingen vannrett rulling, minst 44 px) gjelder også etter endringen.
9. **Uten nett:** bygningsskjermen er ikke en del av lagringen uten nett ennå. Ingen ny test; `fase-1-prove-e-regler.spec.ts` (motoren på iPaden) skal være grønn med `negate` i motoren.

## 9. Ingen KI

1. **K9.1** `data.test.ts` 10.1 (`no_ai_in_rules`) grønn; ingen import av `@/core/ai` i endrede filer i `src/core/rules`, `src/core/buildings` og badmalen.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| TG0 ved hull uten funn og under grensen; 15,0 og «med funn» gir ikke TG0 | R1.5, R3.2–R3.5 |
| `negate` snur, «ikke vurdert» står; TG0 bare fra `suggest_tg0` | R1.1–R1.6 |
| Ingen TG0 og annet forslag på samme punkt | R3.6 |
| Lik grensen gir forslag, kant per regel | R3.7, R3.8 |
| `suggest_tg0` krever TG-punkt, avvises i egne maler; F9 | R4.1–R4.5 |
| Kilder NS 3600:2025, utkast, 15 står, kort tekst | R2.1–R2.3 |
| `checkDocumentKeys` per felt | R4.6 |
| Arealtyper, kryperom, summer, migrering | B6.1–B6.5, M5.1–M5.4 |
| `suggestFloor` | B6.6 |
| PC og iPad | E8.1–E8.8 |
| Tilgang og tenant grønne; prøve E grønn | T7.1–T7.5, E8.9 |
| Ingen KI; bare koder og tall | K9.1, R1.9, R3.13 |
| T-0010, T-0016 rettet; A234–A240 ført | gjennomlesing i rapporten |

## Kjøring før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Test-leder avviser hvis T7-testene er røde eller mangler, hvis en fast kode er endret (R3.12), eller hvis en kanttestsak mangler for en regel (R3.7).
