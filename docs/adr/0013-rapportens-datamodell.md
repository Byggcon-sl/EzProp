# ADR 0013 – Rapportens datamodell og logg for regelforslag

Dato: 14.11.2026. Status: vedtatt av agentene i autonom modus (A345–A347, A351–A354); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-badet-pc.md`. Bygger på malmotoren (`0024_malmotor`), ADR 0004 (drift uten nett), ADR 0006 (KI i bunnen) og ADR 0009 (regelmotoren).

Støtter hovedmålene: **færre reklamasjoner** (TG, årsak, konsekvens, tiltak og kostnad lagres i fast form, databasen stopper ugyldige kombinasjoner, og hver beslutning om et regelforslag står i en logg som bare får nye rader, slik at TG-en kan forklares i ti år), **de ansatte** (lagring per felt uten «Lagre»-knapp, og to faner eller to kolleger overskriver ikke hverandre stille) og **KI i bunnen** (alt er strukturerte data med faste koder, og svar og avvik har plass til `ai_usage_id` fra første dag; KI og regler setter aldri TG).

## Beslutninger

1. **Sju tabeller i migrering `0035_badet-pc`** (`src/db/schema/reports.ts`): `reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details` og `rule_suggestion_decisions`. Alle har de felles kolonnene (`organization_id`, myk sletting, `row_version`). Id-er lages i nettleseren (UUID v7).
2. **Rapporten er låst til malversjonen** (`reports.template_version_id`) fra den startes. Svar, kontrollpunkt, avvik og regel peker på radene i den låste versjonen (`element_id`, `checkpoint_id`, `deviation_question_id`, `outcome_id`, `suggested_by_rule_id`). Publiserte malversjoner endres aldri, så id-ene er stabile.
3. **Én gjeldende rapport per oppdrag** sikres av en delvis unik indeks (`reports_one_current_per_assignment_idx`: `deleted_at is null and status <> 'superseded'`). Start er `insert … on conflict do nothing`, så to samtidige kall gir én rapport. Bygninger og rom får ikke `report_id` nå (A94, A347): tjenesten følger rom → etasje → bygning → oppdrag → rapport.
4. **Barn av rapporten har `report_id`, og nøkkelen mot forelderen har tre kolonner:** `(organization_id, report_id, parent_id)`. Et avvik kan dermed verken henge på et kontrollpunkt i en annen organisasjon eller i en annen rapport, og `report_id` på barnet kan ikke bli feil. Den unike indeksen `(organization_id, report_id, id)` er også indeksen for oppslag per rapport (A351).
5. **Unike nøkler med tomme kolonner bruker uttrykksindeks:** `coalesce(kolonne, NIL_UUID)` i en delvis unik indeks (`where deleted_at is null`) på `field_answers` og `checkpoint_results`. To svar på samme felt i samme rom med tom bygning er dermed dubletter (A352).
6. **TG for kontrollpunktet lagres ikke** (A342). `computeCheckpointTg` i `src/core/reports/logic` regner den fra avvikene og `tg_direct` hver gang. TG2 og TG3 finnes bare på avvik; `tg_direct` er `0`, `1` eller `IU` (CHECK).
7. **`deviations.kind` er `tg` eller `hms`, og TG står bare i `tg`** (A353). `tg` er 2, 3 eller tom; tom betyr at takstmannen ikke har valgt ennå («velg TG2 eller TG3») og gir advarsel. HMS har aldri TG (CHECK). Domenemodellen hadde `tg2`/`tg3`/`hms`, som sa det samme to steder.
8. **Kostnaden er ett felt i tre kolonner** med CHECK: `band` krever `cost_band_key`, `approx` krever `cost_amount` over 0 (hele kroner), `none` har ingen av delene. Intervallene er kodedata med faste koder i `src/core/reports/logic/cost-bands.ts`; tabell kommer i 2a-3 med de samme kodene. Eget beløp rundes aldri av automatisk.
9. **`rule_suggestion_decisions` er eneste fasit for regelforslag** (A345). Tabellen får bare nye rader. Avviket har bare `suggested_by_rule_id`; `suggestion_status` og `suggestion_override_reason` på avviket lages ikke. Raden har regelkoden, serverens eget regelsvar (`suggestion`, `reasons`, settkodene, `inspection_year`), beslutningen (`accepted` / `changed` / `rejected`), valgt TG og utfall, begrunnelsen, avviket som ble laget, og hvem og når. CHECK: endret og avvist krever begrunnelse, og avvist har verken TG, utfall eller avvik.
10. **Serveren regner forslaget selv** (A346). Klienten sender regelkode, beslutning, valg og begrunnelse. Serveren kjører `evaluateRules` på lagrede svar og lagrer sitt eget regelsvar. `suggestion` har samme form som `RuleSuggestion` i regelmotoren (holdt lik av en typesjekk i `src/core/reports/types.ts`), og `reasons` er `RuleResult.reasons`. Befaringsåret er egen kolonne (A354).
11. **Beslutningskodene er skilt fra KI-kodene:** regelforslag bruker `accepted` / `changed` / `rejected`, KI-tekst bruker `suggested` / `accepted` / `edited` / `rejected` i `ai_usage_log`. Regelsvar går aldri gjennom `src/core/ai`.
12. **Skriveformen er én endring per felt** (A347, `ReportFieldChange`): tabell, rad, felt, ny verdi og verdien klienten så. Serveren sammenligner med feltets nåverdi (`is not distinct from`); ulik verdi gir «Endret av andre» med nyeste verdi, uten lagring. `row_version` øker fortsatt, men brukes ikke som konfliktsjekk. Formen er den samme som endringene i ADR 0004, slik at køen uten nett i 2b sender de samme endringene. Det som har følger utover ett felt (TG direkte, ferdig, nytt avvik, beslutning), er egne handlinger.
13. **Krokene for KI:** `ai_usage_id` på `field_answers` og `deviations` med sammensatt fremmednøkkel mot `ai_usage_log`, satt og tømt bare av serveren. `ai_usage_log.report_id` har fått sammensatt fremmednøkkel mot `reports` (A158). KI-målkodene står i `REPORT_AI_TARGET_FIELDS` (A350).
14. **Rene funksjoner i `src/core/reports/logic`** er et rent blad, håndhevet med lint (`reportsLogicLeaf` i `eslint-rules/module-boundaries.js`): bare egen mappe, `@/shared` og `@/core/rules`, og bare `import type` fra `@/core/reports`, `@/core/templates` og `@/db/schema`. Ingen pakker. Klientkomponenter importerer herfra, aldri fra indeksen til `@/core/reports`.
15. **`standard_measures.applies_to_tg`** (2, 3 eller tom) i malformatet gir bør-tiltak ved TG2 og må-tiltak ved TG3 på utfall av typen «velg TG2 eller TG3» (T-0060).
16. **Kodene endres aldri** (regel 6): statusene, `tg_direct`, `kind`, `cost_type`, `text_source`, beslutningskodene, `suggestion.kind`, intervallkodene og advarselskodene. Nye koder legges til i listene.

## Forkastet

- **Felt på avviket som fasit for forslaget** (`suggestion_status`, `suggestion_override_reason`): et avvist forslag har ikke noe avvik, og godtatt TGIU og TG0 er ikke avvik. Loggen ville blitt ufullstendig.
- **Klienten sender forslaget:** et forfalsket forslag kunne da stå i loggen som regelens.
- **`report_id` på bygninger og rom nå:** bygninger og rom finnes før rapporten, og det er én gjeldende rapport per oppdrag. Kolonnen kan legges til når et oppdrag kan ha flere rapporter.
- **`field_clock` og `text_crdt` nå:** hører til synk mellom enheter (2b). De kommer som nye kolonner som kan være tomme, uten å endre data.
- **`row_version` per rad som konfliktsjekk:** to faner som endrer ulike felt på samme avvik, ville fått konflikt uten grunn.
- **Lagret `tg_computed`:** to sannheter som kan komme i utakt. Kan legges til som kolonne senere hvis lister over mange rapporter trenger det.
- **`unique nulls not distinct`:** en unik skranke kan ikke være delvis (`where deleted_at is null`), og myk sletting krever det.
- **`kind` = `tg2` / `tg3` / `hms`:** samme opplysning som `tg`, og avvik som venter på valgt TG får ingen gyldig verdi.
- **Befaringsåret inne i `reasons`:** `reasons` er regelmotorens liste urørt. Egen kolonne kan kontrolleres og spørres på.
- **Kostnadsintervall som tabell nå:** står i 2a-3. Kodedata med faste koder gir samme form uten skjermer og tilgangstester.

## Følger

- Utvikleren bygger tjenesten mot typene i `src/core/reports/types.ts` og de rene funksjonene mot `src/core/reports/logic/types.ts`.
- `tests/tenant-tables.ts` peker på `src/core/reports/reports.test.ts` for de sju tabellene. Vakten er rød til testfilen finnes med `expectTenantIsolation` per spørring.
- Migreringen tømmer `ai_usage_log.report_id` der den er satt, før fremmednøkkelen legges på. KI-modulen har avvist alle forespørsler med rapport-id, så ingen ekte verdi går tapt.
- Erstatter omtalen av `suggestion_status` og `suggestion_override_reason` på avviket i ADR 0004 («Forslag») og følgen om lagring av regelsvar i ADR 0009: beslutningen står i `rule_suggestion_decisions`.
- «KI i veien» (neste punkt) trenger ingen ny migrering for svar og avvik. Skal KI-tekst merkes på tiltak og på beskrivelsen av kontrollpunktet, legges `ai_usage_id` til der som ny kolonne som kan være tom.
- Publiseringssperren og PDF-en leser de samme tabellene. Advarselskodene `tg2_tg3_missing_cause_or_consequence`, `tg3_missing_cost` og `cost_amount_not_rounded` er de samme som `check_code` i domenemodellen.
- **Dyrt å endre:** beslutningstabellen som eneste fasit, at serveren regner forslaget, skriveformen per felt, nøklene med tre kolonner, de unike nøklene og de faste kodene, når rapporter først er lagret. **Lett å endre:** grensene og etikettene på intervallene, hvilke advarsler som vises, og hvilke TGIU-opplysninger som kreves.
