# Testplan: Malen for ett bad (våtrom) i malmotoren

- **Oppgavekort:** `docs/funksjoner/fase2a-mal-bad.md`
- **Dato:** 12.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** testene låser at badet alltid har de åtte punktene, feltene og korte tekstene takstmannen starter fra, og at seed gir samme mal hver gang på testoppdragene.
  - **KI i bunnen:** testene låser de faste kodene (`key_snapshot`), at tekstene er delt i felt og har `text_status`, og at merket «utkast» følger med når en versjon kopieres. Det er dataene KI skal velge fra senere.
  - **Færre reklamasjoner:** testene sikrer at hulltaking, fall, terskel og membran er egne felt, at dokumentasjon bare gir TG2, at sjikt før 2000 bare gir ett avvik, og at ingen tekst har gjetteord eller er kopiert.

Alle databasetester bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet. «Regeltestene» i denne oppgaven er datatester (`it.each`) over malfilen; malen har ingen regler ennå (`no_rules`). Det er ingen skjerm, så ingen nye e2e-tester og ingen test uten nett. Testnavnene under er de som skal stå i `it(...)` (eventuelt med nummer foran, som i `templates.test.ts`).

## Avtale om signaturer (utvikler og testskriver)

Navnene kan endres, men avvik føres i kortet.

- `src/db/seed/templates/wet-room.ts`: `export const wetRoomTemplate: TemplateDocumentInput`.
- Kontrollene som rene funksjoner (i `src/db/seed/templates/wet-room.checks.ts` eller i testfilen): hver tar et dokument og gir en liste med feil (tom liste = bestått). Minst `checkNoTgOnNonTgCheckpoint`, `checkOutcomeTexts`, `checkGuessWordsAndReferences`, `checkTextLength`, `checkMeasureModal` (bør/må).
- `src/core/templates`: `isSameTemplateContent(a, b): boolean`, eksportert fra `index.ts`. `TEXT_STATUSES` og `TextStatus` fra `src/db/schema/templates.ts`.
- `src/db/seed/sample-assignments.ts`: `ensureSampleTemplate(db, document = wetRoomTemplate)` gir `"created" | "existing" | "skipped"` (samme typer som de andre `ensureSample*`), og resultatet står i `SampleSeedSummary`.
- Testhjelpen `buildTemplateDocument` i `tests/template-document.ts` brukes til de små dokumentene som skal feile.

## 1. Datatest av malfilen, `src/db/seed/templates/wet-room.test.ts` (ny, uten database)

1. `parses_without_issues`: `parseTemplateDocument(wetRoomTemplate)` og `checkDocumentKeys` gir ingen feil.
2. `section_wet_room_per_room`: nøyaktig én seksjon, koden `wet_room`, `repeat = per_room`, `room_type_groups = ["wet_room"]`.
3. `has_eight_room_checkpoints`: de åtte kodene i kortet (`general`, `documentation`, `walls_ceiling`, `floor`, `membrane_drain`, `fixtures`, `ventilation`, `adjacent`), alle `scope = room`, `group = room`, `room_type_groups = ["wet_room"]`, `gives_tg = true`. Bare `general`, `membrane_drain` og `adjacent` er `mandatory`.
4. `related_checkpoints`: `membrane_drain` peker på `floor` og `adjacent`; alle `related_checkpoint_keys` finnes i malen.
5. `keys_prefixed_wet_room`: alle koder på kontrollpunkt, felt og spørsmål starter med `wet_room.`. Seksjonen, valg og utfall er unntatt.
6. `key_snapshot`: fast liste (i testfilen, ikke generert) over alle koder: seksjon, punkt, felt, valg per felt, spørsmål og utfall per spørsmål. Endres listen, skal PR-en si hvilken kode som er arkivert (regel 6).
7. `fields_types_units` (`it.each` over feltene i Omfang 2): riktig punkt, type og enhet (`mm/m` på begge fallfeltene, `mm` på terskel, `°C` på lufttemperatur). Fallfeltene har ingen `min_value`. Alle felt har `required = false`.
8. `choice_codes`: valgene til `build_year_source`, `building_code`, `documentation_type`, `ventilation_type`, `hole_drilling`, `hole_moisture_unit`, `hole_drilling_reason` og `construction_damage_prone` er nøyaktig som i kortet. Alle valgkoder følger kodeformatet (små bokstaver, tall, `_`).
9. `membrane_material_codes`: de ni membranvalgene finnes, `material_code` er lik verdien og i kodeformatet, og ingen felt heter `membrane_visible`.
10. `no_consent_field`: ingen felt med `consent` i koden (avgjort i kortet).
11. `questions_per_checkpoint`: minst to spørsmål per punkt unntatt `adjacent`, nøyaktig ett på `adjacent`, 20–30 i alt, nøyaktig ett utfall per spørsmål.
12. `documentation_only_tg2`: alle utfall under `wet_room.documentation` er `tg2`.
13. `pre_2000_once_under_membrane`: spørsmålet om sjikt før 2000 finnes én gang, under `wet_room.membrane_drain`, og ingen andre spørsmål nevner år 2000.
14. `adjacent_moisture_choose`: spørsmålet under `wet_room.adjacent` har utfall `choose_tg2_tg3`.
15. `electrical_is_hms`: varmgang ligger under `wet_room.fixtures` med `kind = hms`, og ingen TG-utfall nevner el, elektrisk eller varmgang.
16. `no_tgiu_outcome`: ingen utfall er `tgiu` (dekkes også av skjemaet, men prøves på malen).
17. `outcome_texts_complete` (`it.each` over utfallene): `tg2`, `tg3` og `choose_tg2_tg3` har avvik, årsak (`default_cause_text`), kriterium, konsekvens og minst ett tiltak. `hms` har avvik, konsekvens og minst ett tiltak.
18. `all_texts_draft`: alle utfall og tiltak har `text_status = draft`.
19. `tg2_bor_tg3_ma`: tiltak ved `tg2` har «bør» og ikke «må»; ved `tg3` og `choose_tg2_tg3` «må».
20. `texts_short`: høyst to setninger og 300 tegn i hvert rapporttekstfelt.
21. `no_guess_words_or_references`: bare rapporttekstene (`deviation_text`, `default_cause_text`, `default_consequence_text`, tiltakstekst). Ordgrenser, ikke delord. «TEK» og «NS» skiller store og små bokstaver. Ordene: antas, trolig, sannsynligvis, antagelig, muligens, formentlig, «ser ut til», TEK, NS, Byggforsk, IVIT, SmartTakst.
22. `no_text_copied_from_research`: leser alle `.md`-filer i `docs/kartlegging/` og feiler hvis en rapporttekst deler 8 ord på rad med en av dem (små bokstaver, tegnsetting fjernet).
23. `source_ref_set`: hvert utfall har `source_ref`, og ingen rapporttekst inneholder teksten i `source_ref`.
24. `merge_fields_only_known`: flettefelt i tekstene (`{...}`) er bare `{årstall}` og `{måleverdi}` (eller listen utvikleren fører i malfilen).
25. `no_tg0_hint`: ingen `default_value`, hjelpetekst eller valgnavn nevner TG0.
26. `no_rules`: `rules`, `rule_conditions` og `rule_test_cases` er tomme eller mangler.
27. `no_personal_data`: ingen e-post, telefonnummer (8 sifre, `+47`) eller 11 sifre på rad i malfilen.

**Kontrollene skal kunne feile** (`it.each`, ett lite dokument fra `buildTemplateDocument` per kontroll):

28. `check_fails_on_bad_document`: hver kontroll i signaturavtalen gir minst én feil på et dokument laget for å feile (TG-utfall på punkt med `gives_tg = false`; TG3 uten årsak; «trolig» i avvik; tre setninger; «må» i TG2-tiltak; HMS uten konsekvens). Samme kontroll gir ingen feil på malen.

## 2. Kjernen og migreringen

I `src/core/templates/schemas.test.ts` (uten database):

1. `text_status_default_draft`: utfall og tiltak uten `text_status` får `draft` etter `parseTemplateDocument`.
2. `text_status_approved_accepted`: `approved` godtas (A209).
3. `unknown_text_status_rejected_by_schema`: `"godkjent"`, `""` og `null` avvises med feil på riktig sti.
4. `default_cause_text_optional`: utfall uten `default_cause_text` godtas; tom streng behandles som i `optionalText()`.
5. `is_same_template_content` (`it.each`): samme dokument gir `true`; samme innhold med listene i annen rekkefølge gir `true`; endret avvikstekst, `default_cause_text`, `text_status` på utfall, `text_status` på tiltak eller ett felt mer gir `false`. Funksjonen endrer ikke argumentene.

I `src/core/templates/templates.test.ts` (mot testdatabasen):

6. `migration_text_status_check`: direkte innsetting med ukjent `text_status` avvises av `outcomes_text_status_check` og `standard_measures_text_status_check`; rad uten verdi får `draft`. Rader laget med `createOutcomeRow` og `createStandardMeasureRow` (som ikke kjenner kolonnen) får `draft`.
7. `save_and_read_new_fields`: `saveDraftContent` lagrer `default_cause_text` og `text_status` på utfall og `text_status` på tiltak; `getTemplateVersion` gir dem tilbake.
8. `copy_to_new_draft`: publiser en versjon med `default_cause_text` utfylt og `text_status = approved` på både utfall og tiltak; `createDraftVersion` gir de samme verdiene i utkastet.
9. `idempotent_save`: samme dokument to ganger gir 0/0/0 (også med de nye feltene).
10. `text_status_only_counts_changed`: bare `text_status` endret på ett utfall gir 0/1/0; bare `text_status` endret på ett tiltak gir ett fjernet og ett lagt til (A142), og det gamle tiltaket har `deleted_at`.
11. `default_cause_text_counts_changed`: bare `default_cause_text` endret gir 0/1/0.
12. `published_version_untouched`: etter nytt utkast med endret `text_status` og publisering er versjon 1 `retired`, og radene i versjon 1 har fortsatt sin gamle `text_status` og ingen `deleted_at` (myk sletting, ingenting overskrevet).
13. `wet_room_template_saves`: hele `wetRoomTemplate` lagres med `saveDraftContent` uten feil, og `publishVersion` godtar den (malen består strukturkontrollene i motoren, ikke bare skjemaet).

**Tilgang per rolle** (utvid tabellen i 4.1 med et dokument som har de nye feltene):

14. `role_read_new_fields` (`it.each`): takstmann, kontor og leder leser `text_status` og `default_cause_text` med `getTemplateVersion`.
15. `role_cannot_save_new_fields`: takstmann og leder uten `template.edit_structure`, og kontor, får `AccessDeniedError` på `saveDraftContent` med endret `text_status`, og ingen rader endres.
16. `admin_always_saves` (regel 11, skal aldri fjernes): admin uten enkeltrettigheter lagrer endret `text_status` og publiserer.

**Tenant-isolasjon:**

17. De seks eksisterende `expectTenantIsolation`-kallene i 4.2 står uendret og er grønne. 4.2.2 (`getTemplateVersion`) bruker et dokument med de nye feltene, så det vises at `text_status` og `default_cause_text` ikke lekker til en annen organisasjon.
18. `tenant-isolation-all-tables` er grønn uten endring i `tests/tenant-tables.ts` (ingen ny tabell).

## 3. Seed, `src/db/seed/sample-assignments.test.ts` (mot databasen)

`beforeEach`: `resetDatabase`, `runSeed(env)`, så prøveorganisasjonen som i de eksisterende testene.

1. `seed_creates_published_v1`: én familie «Tilstandsrapport bolig» med `kind = system` og `report_type = condition_report`, én versjon med status `published`, åtte kontrollpunkter, og alle utfall og tiltak i databasen har `text_status = draft`.
2. `seed_matches_template_file`: `isSameTemplateContent(getTemplateVersion(...).document, parseTemplateDocument(wetRoomTemplate))` er `true`.
3. `seed_twice_no_new_version`: to kjøringer gir én familie, én versjon, ingen utkast, resultatet `existing` andre gang, og ingen nye rader i `audit_log` eller `events` for malen.
4. `seed_changed_document_new_version`: kjør med et endret dokument som argument (én avvikstekst endret). Gir v2 `published`, v1 `retired`, og v1 sitt innhold er urørt.
5. `seed_existing_draft`: finnes et utkast fra før (laget med `createDraftVersion`), kaster ikke seed en uventet feil; oppførselen (bruke utkastet eller melde tydelig på norsk) står i kortet og testes.
6. `seed_only_sample_org` (`it.each` som i `sample-ai-testplan.test.ts`): `sampleData` mangler, `false`, `"true"` og `1` gir `skipped` og ingen malrader. Byggcon-organisasjonen har ingen familie etter `pnpm db:seed:testoppdrag`.
7. `seed_family_not_visible_in_other_org`: en annen organisasjon (med egen admin) ser ingen familie med `listTemplateFamilies`, og `getTemplateVersion` med prøveorganisasjonens versjons-id gir nei.
8. `seed_uses_services`: familien og versjonen har `created_by` / `published_by` lik admin i prøveorganisasjonen (viser at tjenestene i `src/core/templates` er brukt, ikke rå innsetting).
9. `seed_other_parts_unchanged`: de eksisterende seed-testene (fire testoppdrag, idempotens, Byggcon urørt) er grønne. Telletabellen i 2.2 i `fase2a-testoppdrag-testplan.md` utvides med malens tabeller.

**Krav til tenant-isolasjon i seed:** seed skal ikke ha egen spørring. Leser `ensureSampleTemplate` selv `organizations.settings` for å sjekke `sampleData`, skal den bruke samme hjelper som `ensureSampleAi`, ellers trengs et eget `expectTenantIsolation`-kall for den spørringen. Testleder avviser hvis det finnes en ny spørring på `organization_id` uten slikt kall.

## 4. e2e

Ingen nye tester (ingen skjerm). `pnpm test:e2e` skal være grønn i prosjektene `pc` og `ipad` som før. Hvis e2e-oppsettet kjører `db:seed:testoppdrag`, skal det ikke bli tregere enn 10 sekunder ekstra (seed lagrer rundt 200 rader én gang).

## 5. Sjekk før merge (ikke automatisk)

- Migreringen heter `0028_mal-tekststatus`, og ingen annen åpen branch har tatt 0028.
- `package.json` er 0.6.4.
- Fagrollen har lest alle tekstene (stil, kort, ingen kopi). Testen i 1.22 er vern, ikke fasit.
- Ingen modellnavn, ingen «EzProp» i `src/` utenom `brand.ts`.

## Akseptkriterier mot tester

| Akseptkriterium | Tester |
|---|---|
| Seed lager én publisert versjon, ingenting i Byggcon, idempotent, endret gir v2 | 3.1–3.6 |
| `draft` på alt, tekster komplette, dokumentasjon bare TG2 | 1.12, 1.17, 1.18, 3.1 |
| Ingen gjetteord, henvisninger eller kopi; ingen TG på punkt uten TG, prøvd på dokument som feiler | 1.21, 1.22, 1.28 |
| Nye felt lagres, leses, kopieres, telles; ukjent verdi avvises av skjema og database | 2.3, 2.6–2.12 |
| Annen organisasjon får ikke tilgang | 2.17, 2.18, 3.7 |
| Tilgang per rolle, admin kan alltid lagre | 2.14–2.16 |
| iPad-størrelse: ikke aktuelt, e2e grønn | 4 |
| Lint, typecheck, test, e2e grønne, versjon 0.6.4 | sluttkjøring, 5 |

## Godkjennes ikke uten

2.14–2.17 (tilgang og tenant-isolasjon), 2.16 (admin), 2.12 (myk sletting og urørt publisert versjon), 1.6 (`key_snapshot`), 1.28 (kontrollene kan feile) og 3.6–3.7.
