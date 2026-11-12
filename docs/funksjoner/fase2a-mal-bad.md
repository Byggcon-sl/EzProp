# Funksjon: Malen for ett bad (våtrom) i malmotoren

- **Fase:** 2a-2 Smal vei, første punkt («Malen for ett bad»)
- **Modul:** kjerne (`src/core/templates`, tabellene i `src/db/schema/templates.ts`) og seed (`src/db/seed`)
- **Branch:** `fase2a-mal-bad` (bygger på `main`)
- **Status:** klar til bygging (forhåndsvurdert runde 1 av arkitekt, fagansvarlig og test-leder 12.11.2026; rettingene er ført inn)
- **Dato:** 12.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen får ett ferdig bad med faste punkter, valg og korte avvikstekster å starte fra, i stedet for å skrive alt selv. Det er grunnlaget for skjermen for badet (neste punkter).
  - **KI i bunnen:** hvert punkt, felt, spørsmål og utfall får en fast kode, og tekstene lagres strukturert (årsak, konsekvens, tiltak hver for seg) med status «utkast». Det er dataene KI senere velger fra (frasebank, språkvask, sammendrag). KI lager ikke ny tekst for å fylle hull.
  - **Færre reklamasjoner:** våtrom er der flest reklamasjoner kommer. Malen tar inn det IVIT mangler: membrantype og alder som egne felt, fallmåling og høyde ved terskel som tall, og hulltaking med egne målefelt og de opplysningene rapporten må ha når hull ikke er tatt (`docs/kartlegging/kartlegging-bad.md`, «Funn og svakheter i IVIT»; `docs/kartlegging/regelverk-krav.md`).

## Problem
Malmotoren (PR #119) kan lagre en mal, men det finnes ingen mal. Uten et ekte bad i malmotoren kan ikke reglene (neste punkt), skjermen for badet, publiseringssperren og PDF-en bygges eller prøves. Lar vi være, stopper hele den smale veien i 2a-2.

## KI i bunnen
- **Ingen KI-kall i denne oppgaven.** Oppgaven lager dataene KI skal bruke fra «KI i veien» (punkt 4 i 2a-2).
- **Data som lagres for KI:**
  - Faste koder på alt (regel 6), så KI-forslag, reklamasjoner og statistikk kan kobles til samme punkt over mange år.
  - Avviksteksten delt i felt: avvik, årsak (tekst og kriterium), konsekvens og tiltak. Da kan KI senere foreslå og språkvaske ett felt om gangen.
  - Status per tekst (`draft` = «utkast, ikke godkjent av fagrådet»). KI-funksjonen «forslag fra frasebanken» skal senere bare velge godkjente tekster i ekte bruk; i testmiljøet kan den bruke utkast.
  - Kilden står i `source_ref` (bakgrunn), aldri i teksten.
- Ingenting sendes til KI, og ingen nye funksjoner eller tillatte felt legges i `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg **at badet har de punktene og valgene jeg trenger** (membrantype, alder, fall, hulltaking) slik at **jeg slipper å skrive det samme hver gang og ikke glemmer noe**.
- Som **fagansvarlig (Ståle)** vil jeg **se hvilke tekster som er utkast** slik at **jeg kan godkjenne dem før ekte bruk**.
- Som **utvikler og testlaget** vil vi **ha badet i prøveorganisasjonen etter `pnpm db:seed:testoppdrag`** slik at **reglene, skjermen og PDF-en kan prøves på testoppdragene**.

## Omfang
**Med:**
1. **Malinnholdet som data** i én fil, `src/db/seed/templates/wet-room.ts`, i dokumentformatet fra `src/core/templates/schemas.ts` (flate lister med koder). Én seksjon med koden `wet_room` (uten punktum), `repeat = per_room` og `room_type_groups = ["wet_room"]`.
2. **Åtte kontrollpunkter** (etter `kartlegging-bad.md` og leilighetsmalen godkjent i fagråd runde 1), alle `scope = room`, `group = room`, `room_type_groups = ["wet_room"]`, `gives_tg = true`. **Alle felt har `required = false`** i denne versjonen (Tillegg A er ikke avgjort, `regelverk-krav.md` avsnitt 4; hva som må fylles ut, avgjøres med publiseringssperren). Valgkoder står i parentes; de er lokale under feltet (A141), små bokstaver, tall og `_`.

   | Kode | Navn | Felt (kode, type, enhet) |
   |---|---|---|
   | `wet_room.general` | Generelt | `wet_room.build_year` (tall, årstall for når våtrommet ble bygget eller sist pusset opp), `wet_room.build_year_source` (valg: `documented` dokumentert / `owner_stated` opplyst av eier / `estimated` anslått / `unknown` ukjent, byggeåret for bygningen brukes), `wet_room.building_code` (valg: `before_1997` / `from_1997_to_2010` / `tek10` / `tek17` / `unknown`) |
   | `wet_room.documentation` | Dokumentasjon for våtrom | `wet_room.documentation_type` (valg: `none` ingen / `declaration_of_conformity` samsvarserklæring / `wet_room_certificate` våtromssertifikat / `other_written` annen skriftlig dokumentasjon) |
   | `wet_room.walls_ceiling` | Overflater vegger og himling | `wet_room.ceiling_type` (valg) |
   | `wet_room.floor` | Overflater gulv | `wet_room.floor_type` (valg), `wet_room.floor_heating` (valg), `wet_room.fall_direction_1` og `wet_room.fall_direction_2` (tall, enhet `mm/m`, fall mot sluk per meter; **negativ verdi = motfall**, ingen `min_value`) |
   | `wet_room.membrane_drain` | Vanntett sjikt, membran og sluk | `wet_room.threshold_height_mm` (tall, `mm`, høyden fra slukristen opp til membranen ved terskelen; under samme punkt som spørsmålet, A211), `wet_room.membrane_type` (valg med `material_code`, se under), `wet_room.membrane_year` (tall, årstall for det vanntette sjiktet; tomt = samme som `wet_room.build_year`), `wet_room.drain_type` (valg) |
   | `wet_room.fixtures` | Sanitærutstyr og innredning | – |
   | `wet_room.ventilation` | Ventilasjon | `wet_room.ventilation_type` (valg: `balanced` balansert / `mechanical_extract` mekanisk avtrekk / `natural` naturlig / `none` ingen) |
   | `wet_room.adjacent` | Tilliggende konstruksjoner våtrom | se egen liste under |

   **Valgene for `wet_room.membrane_type`** (verdi og `material_code` er like, og følger kodeformatet: små bokstaver, tall og `_`; de er i praksis faste koder mot levetidstabellen i 2a-3): `liquid_membrane` smøremembran, `foil` folie, `sheet_membrane` banemembran, `membrane_boards` membranplater (plater med tettesystem), `bathroom_cabin` baderomskabin, `bathroom_panel` baderomspanel, `wet_room_wallpaper_paint` våtromstapet eller malingssystem, `wet_room_vinyl` våtromsvinyl, `unknown` ukjent. Om sjiktet er synlig eller skjult følger av typen; det er **ikke** eget felt (fjernet `membrane_visible`, ellers kan to felt si imot hverandre).

   **Feltene under `wet_room.adjacent`** (enkeltfelt nå, se A202):
   - `wet_room.hole_drilling` (valg: `done_no_findings` utført uten funn / `done_with_findings` utført med funn / `not_done` ikke utført)
   - `wet_room.hole_moisture_reading` (tall), `wet_room.hole_moisture_unit` (valg: `weight_percent` vekt-% / `relative_humidity` RF %), `wet_room.hole_moisture_location` (tekst), `wet_room.hole_air_temperature` (tall, `°C`), `wet_room.hole_construction` (tekst, oppbygging der hullet er tatt)
   - Når hull ikke er tatt: `wet_room.hole_drilling_reason` (valg: `owner_refused` eier ga ikke samtykke / `no_access` ikke tilgang / `concrete_or_masonry` betong eller mur / `other` annet), `wet_room.hole_drilling_reason_note` (tekst), `wet_room.owner_informed` (avkrysning: eier er informert om utvidet ansvar), `wet_room.other_moisture_method` (tekst), `wet_room.other_moisture_result` (tekst), `wet_room.not_investigated_risk` (tekst, risiko ved at forholdet ikke er undersøkt), `wet_room.construction_damage_prone` (valg: `yes` / `no`, om konstruksjonen er skadeutsatt)
   - Eget felt for samtykke lages ikke. «Eier nektet» står i `hole_drilling_reason`, og er hull tatt, er samtykke gitt. En avkrysning kunne ikke skille «nektet» fra «ikke spurt» (fagansvarlig).

   `wet_room.general`, `wet_room.membrane_drain` og `wet_room.adjacent` er `mandatory = true`. Kontrollpunktene peker på hverandre med `related_checkpoint_keys` der de hører sammen (membran og sluk med gulv og tilliggende).
3. **Rundt 25 avviksspørsmål** (de vanligste per punkt etter `kartlegging-bad.md`), med koder som `wet_room.membrane_drain.leak_at_penetration` og **ett utfall hvert**:
   - Minst to spørsmål per punkt unntatt `wet_room.adjacent`, og 20–30 i alt. Spørsmålene som kommer an på ventilasjonstype, tas ikke med nå.
   - `wet_room.documentation` har **bare `tg2`** som utfall (manglende dokumentasjon kan ikke gi TG3).
   - **«Vanntett sjikt fra før år 2000»** er ett spørsmål under `wet_room.membrane_drain`, formulert om sjiktet (`membrane_year`), ikke om rommet. Det står bare der, så samme forhold ikke gir to TG3. (Bad fra 1990 med ny membran fra 2015 skal ikke få TG3.)
   - `wet_room.adjacent` har ett spørsmål: **forhøyet fukt ved hulltaking**, utfall `choose_tg2_tg3` (A207). Ellers har «utført med funn» ingen tekst å lande på.
   - Varmgang på armatur eller el-punkter er utfall **`hms`** under `wet_room.fixtures`, ikke TG (A204). Ingen TG-utfall for el.
   - Ingen `tgiu` som utfall (TGIU settes på punktet via regel i neste oppgave). Ingen standard-TG, hjelpetekst eller standardverdi som antyder TG0 ved «utført uten funn» (spørsmål 72 er åpent).

   **Tekstene per utfall:** `deviation_text` (avvik), `default_cause_text` (ny, årsak) og `default_cause_criterion`, `default_consequence_text`, `standard_measures` (tiltak), `source_ref` (kilde i bakgrunnen, for eksempel «NS 3600:2025 tillegg C»), `text_status = draft`. Krav:
   - `tg2`, `tg3` og `choose_tg2_tg3`: avvik, årsak, konsekvens og minst ett tiltak. `choose_tg2_tg3` regnes som TG3 i sjekkene.
   - `hms`: avvik, konsekvens og minst ett tiltak (NS 3600 pkt. 13).
   - Høyst to setninger per tekstfelt og høyst 300 tegn. «Bør» i tiltak ved TG2, «må» i tiltak ved TG3 og `choose_tg2_tg3`.
   - Ingen gjetteord (antas, trolig, sannsynligvis, antagelig, muligens, formentlig, «ser ut til») og ingen henvisning til TEK, NS, Byggforsk, IVIT eller SmartTakst i rapporttekstene. Flettefelt som `{årstall}` og `{måleverdi}` er lov.
   - **Tekstene er Byggcons egne og korte** (svar 1 i `svar-claude-pa-vegne-av-stale-2026-11-10.md`). **Ingen tekst fra NS 3600, IVIT eller SmartTakst, og ingen tekst kopiert fra `docs/kartlegging/`** (regel 7): prøveeksemplene der er bare mønster for lengde og tone.
   - TG3-utfall uten kostnadsanslag er **bevisst** nå. Forskriften § 2-22 krever kostnadsanslag ved TG3; det kommer med kostnadsintervallene i 2a-3 og må med i publiseringssperren.
4. **Merket «utkast, ikke godkjent av fagrådet» i data** (A200), form etter arkitekten:
   - `src/db/schema/templates.ts`: `export const TEXT_STATUSES = ["draft", "approved"] as const` og `type TextStatus`. Kolonnen `text("text_status").notNull().default("draft")` på `outcomes` og `standard_measures`, med CHECK `outcomes_text_status_check` og `standard_measures_text_status_check` laget med `inList`. Ny kolonne `default_cause_text` (tekst, valgfri) på `outcomes`. Eksisterende rader får `draft`.
   - Én migrering `0028_mal-tekststatus`. Sjekk før merge at ingen annen branch har tatt 0028.
   - `schemas.ts`: `text_status: oneOf(TEXT_STATUSES).default("draft")` og `default_cause_text: optionalText()`. Dokumentformatet godtar `approved` (A209); malfilen har bare `draft` (test).
   - Med i `getTemplateVersion`, i kopien i `createDraftVersion` og i tellingen «endret» (A144). Utfall: endret `text_status` alene gir 0/1/0. Standardtiltak har ingen kode og erstattes samlet (A142), så der gir samme endring fjernet + lagt til.
5. **Ren sammenligning i kjernen:** `export function isSameTemplateContent(a: TemplateDocument, b: TemplateDocument): boolean` i `src/core/templates`, eksportert fra `index.ts`. Uavhengig av rekkefølgen i listene; bruker `canonical` og sorteringen som finnes i `templates.ts`.
6. **Seed** (`ensureSampleTemplate(db, document = wetRoomTemplate)` i `sample-assignments.ts`, kalt fra `pnpm db:seed:testoppdrag`):
   - Kjører bare i organisasjoner med `settings.sampleData = true`, sjekket i funksjonen selv. Hopper over Byggcon-organisasjonen og andre uten merket.
   - Finner familien «Tilstandsrapport bolig» (`kind = system`, `report_type = condition_report`) med `listTemplateFamilies`. Ingen rå spørring i seed. Finnes den ikke, lages den med `createTemplateFamily`.
   - Leser siste publiserte versjon med `getTemplateVersion(...).document` og sammenligner med dokumentet etter `parseTemplateDocument`, med `isSameTemplateContent`. Like: ingenting skjer (ikke noe tomt utkast). Ulike eller ingen versjon: `createDraftVersion`, `saveDraftContent`, `publishVersion`.
   - Dokumentet tas inn som argument, så testen kan prøve et endret innhold uten å endre malfilen.
   - Kjører med admin i prøveorganisasjonen og går gjennom tjenestene i `src/core/templates` (ingen tilgangslogikk i seed).
   - **Merket sjekkes med samme vilkår som `ensureSampleAi`** (`IS_SAMPLE_ORGANIZATION` i `sample-assignments.ts`), gjennom en liten hjelper `isSampleOrganization(organizationId)` som begge bruker. Ingen ny lesing av `organizations.settings` med eget vilkår (test-leder, alvorlig).
   - **Finnes det allerede et utkast** i familien (for eksempel etter en avbrutt kjøring, eller fordi `createTemplateFamily` lager tomt utkast v1): er innholdet likt siste publiserte versjon, gjøres ingenting, og utkastet står. Ellers brukes utkastet som finnes (lagres med dokumentet og publiseres), i stedet for `createDraftVersion`, som ellers ville feile. I prøveorganisasjonen er det bare seed som lager malutkast (prosjektleder 12.11.2026, lett å endre).
   - Svaret er `created`, `existing` eller `skipped` (uten merket), som for de andre delene, og skrives i loggen uten tekster fra malen.
7. **Kontrollene på malen som rene funksjoner** (i testfilen eller en liten hjelpefil ved siden av malfilen), slik at hver kan prøves på et lite dokument som skal feile før den kjøres på malen. Gjelder særlig «ingen TG-utfall på punkt med `gives_tg = false`» (del av T-0014), som ellers ikke viser noe når alle åtte punktene gir TG.
8. **Tester:** se «Testplan» under.
9. **Dokumentasjon:** domenemodellen 4.5 (de to nye kolonnene, `TEXT_STATUSES`, eksemplet `wet_room.membrane` byttes til `wet_room.membrane_drain`, og at hulltakingsmålingene er enkeltfelt nå og blir `table` i 2a-3 med arkivering av kodene). Ordlisten (`text_status`, `default_cause_text`, `isSameTemplateContent`, kodene `wet_room.*`). `package.json` fra 0.6.3 til 0.6.4.

**Ikke med (bevisst utelatt):**
- **Regler** (alder mot levetid, fuktgrense, sjikt før 2000, hulltaking ikke utført gir TGIU) og testsakene deres. Det er neste punkt («Reglene badet trenger»). `rules`, `rule_conditions` og `rule_test_cases` er tomme i malen. Spørsmål 71 og 72 må avgjøres der, ikke her.
- **Skjerm** for badet, avvikskort og TGIU på punktet (punkt 3 i 2a-2).
- Levetider, terskler og kostnadsintervaller som tabeller, og kostnadsanslag ved TG3 (2a-3).
- Hulltakingsmålingene som `table`-felt med flere rader (2a-3, A202).
- Resten av tilstandsrapporten (andre rom, utvendig, tekniske installasjoner). Kommer som ny versjon av samme familie i 2a-3.
- **Godkjenning av tekster:** ingen godkjenningstjeneste. Publiserte versjoner endres aldri, så å godkjenne en tekst betyr nytt utkast og ny publisert versjon; da viser rapporten hvilken status teksten hadde. Hvem som godkjente og når, og at en godkjent tekst går tilbake til `draft` når den endres, hører til godkjenningstjenesten senere. Ingen visning av merket i grensesnittet.
- Spørsmålene som kommer an på ventilasjonstype, og flere tekstvarianter per spørsmål.
- Eget vanntett sjikt for vegg og gulv (A206).
- Kobling fra oppdrag eller rapport til malversjonen («Rapporten låst til malversjonen», eget punkt).
- Malen i Byggcon-organisasjonen (først når fagrådet har godkjent tekstene).
- De andre kontrollene i T-0014 (TG-forslag uten betingelse, regel og utfall på ulike punkter). De tas med reglene eller kontrollen før publisering.
- KI-kall og nye KI-funksjoner.

## Tilgang
Ingen ny tilgang. Malmotorens regler gjelder (`docs/funksjoner/fase2a-malmotor.md`).

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | nei, uten `template.edit_structure` |
| kontor | ja | nei |
| leder | ja | nei, uten `template.edit_structure` |
| admin | ja | ja (alltid) |

## Data
- **Endret:** `outcomes` får `default_cause_text` og `text_status`; `standard_measures` får `text_status` (se Omfang 4). Migrering `0028_mal-tekststatus`. Ingen nye tabeller, så felles kolonner, organisasjons-ID, myk sletting og `row_version` er uendret, og `tests/tenant-tables.ts` er uendret.
- **Faste koder som tas i bruk:** familien «Tilstandsrapport bolig», seksjonen `wet_room`, de åtte kontrollpunktene, feltene og valgkodene i Omfang 2, spørsmålskodene `wet_room.<punkt>.<spørsmål>` og utfallskodene `tg2`/`tg3`/`choose`/`hms` under spørsmålet. Kodene endres aldri etter merge (regel 6); testen `key_snapshot` vokter dem.

## Skjermer
Ingen.

## Regler
Ingen regler kjøres eller lagres. Strukturreglene i malmotoren gjelder, pluss kontrollene i testplanen.

## Testplan
**Datatest av malfilen** (`src/db/seed/templates/wet-room.test.ts`, uten database):
- `parses_without_issues`: `parseTemplateDocument` og `checkDocumentKeys` gir ingen feil.
- `has_eight_room_checkpoints`: de åtte kodene, alle med `scope = room`, `group = room`, `room_type_groups = ["wet_room"]`; `general`, `membrane_drain` og `adjacent` er `mandatory`.
- `section_wet_room_per_room`: én seksjon `wet_room` med `repeat = per_room`.
- `keys_prefixed_wet_room`: alle koder på kontrollpunkt, felt og spørsmål starter med `wet_room.`. Gjelder ikke seksjonen (`wet_room`), valg og utfall (lokale koder).
- `key_snapshot`: fast liste over alle koder (vern for regel 6).
- `fields_types_units`: feltene i Omfang 2 finnes med riktig type og enhet (`mm/m` for fall, `mm` for terskel, `°C` for temperatur), ingen `min_value` på fall, alle `required = false`.
- `membrane_material_codes`: alle membranvalg har `material_code` i kodeformatet, og ingen felt heter `membrane_visible`.
- `questions_per_checkpoint`: minst to per punkt unntatt `adjacent`, ett på `adjacent`, 20–30 i alt, nøyaktig ett utfall per spørsmål.
- `documentation_only_tg2`: alle utfall under `wet_room.documentation` er `tg2`.
- `pre_2000_once_under_membrane`: spørsmålet om sjikt før 2000 finnes bare under `wet_room.membrane_drain`.
- `outcome_texts_complete`: kravene for `tg2`, `tg3`, `choose_tg2_tg3` og `hms` i Omfang 3.
- `all_texts_draft`: alle utfall og tiltak har `text_status = draft`.
- `tg2_bor_tg3_ma`: tiltak ved TG2 inneholder «bør», ved TG3 og `choose_tg2_tg3` «må».
- `texts_short`: høyst to setninger og 300 tegn per tekstfelt.
- `no_guess_words_or_references`: gjelder **bare rapporttekstene** (`deviation_text`, `default_cause_text`, `default_consequence_text`, `standard_measures.text`), ikke valgnavn eller `source_ref`. Ordgrenser; «TEK» og «NS» skiller store og små bokstaver, så «teknisk» og «arkitekt» ikke treffer. Ordene i Omfang 3.
- `no_text_copied_from_research`: leser alle `.md`-filer i `docs/kartlegging/` og feiler hvis en rapporttekst deler 8 ord på rad med en av dem. Fagrollen kontrollerer i tillegg selv.
- `source_ref_set`: hvert utfall har `source_ref`.
- `electrical_is_hms`: varmgang ligger under `wet_room.fixtures` med `kind = hms`, og det finnes ingen TG-utfall for el.
- `no_tg0_hint`: ingen `default_value` eller hjelpetekst nevner TG0.
- `no_tg_on_non_tg_checkpoint`: kontrollen feiler på et dokument laget for å feile, og malen består.
- `no_rules`: `rules`, `rule_conditions` og `rule_test_cases` er tomme.

**Kjernen og migreringen** (`templates.test.ts` eller egen fil, mot testdatabasen):
- `migration_text_status_check`: ukjent verdi avvises av CHECK, rad uten verdi får `draft`, eksisterende rader får `draft`. Både `outcomes` og `standard_measures`.
- `save_and_read_new_fields`: `saveDraftContent` lagrer feltene, `getTemplateVersion` returnerer dem.
- `copy_to_new_draft`: `createDraftVersion` kopierer feltene. Bruker `default_cause_text` med innhold og `text_status = approved`, så standardverdien ikke skjuler en kopi som mangler.
- `idempotent_save`: samme dokument to ganger gir 0/0/0.
- `text_status_only_counts_changed`: utfall gir 0/1/0; tiltak gir fjernet + lagt til (A142).
- `unknown_text_status_rejected_by_schema`: dokumentformatet avviser ukjente verdier.
- `is_same_template_content`: like dokumenter i ulik rekkefølge gir `true`; endret tekst eller `text_status` gir `false`.
- Tilgang per rolle: takstmann, kontor og leder kan lese de nye feltene; takstmann og leder uten `template.edit_structure` kan ikke lagre; admin kan alltid lagre.
- Tenant-isolasjon: de eksisterende `expectTenantIsolation`-kallene i `templates.test.ts` er grønne, også for `getTemplateVersion` med de nye feltene.
- Myk sletting: et utfall som fjernes, får `deleted_at`. Etter at endret innhold er publisert, er versjon 1 `retired` og innholdet i versjon 1 urørt.

**Seed** (`sample-assignments.test.ts`):
- `seed_creates_published_v1`: én familie (`kind = system`, `report_type = condition_report`), én publisert versjon, åtte kontrollpunkter.
- `seed_twice_no_new_version`: to kjøringer gir én familie, én versjon, ikke noe utkast og ingen nye rader i revisjonsloggen for innholdet.
- `seed_changed_document_new_version`: endret dokument (argument) gir v2 `published` og v1 `retired`.
- `seed_only_sample_org`: seed hopper over organisasjoner uten `sampleData` og lager ingenting i Byggcon-organisasjonen.
- `seed_family_not_visible_in_other_org`: familien finnes ikke i en annen organisasjon via `listTemplateFamilies` (A208). Seed har ingen egen spørring, så `listTemplateFamilies` sin eksisterende `expectTenantIsolation` dekker den.
- `tenant-isolation-all-tables` er grønn (ingen ny tabell).

**e2e:** ingen nye tester (ingen skjerm). `pnpm test:e2e` skal være grønn som før.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A200–A209)
- **A200 – Merket «utkast, ikke godkjent av fagrådet» er en kolonne `text_status` per utfall og per tiltak**, ikke på malversjonen. Fagrådet kan godkjenne tekst for tekst, og KI kan senere velge bare godkjente. Publiserte versjoner endres aldri, så godkjenning betyr ny publisert versjon; rapporten viser da hvilken status teksten hadde. Kilde: CLAUDE.md (autonom modus, fagtekster), domenemodellen 4.5. **Dyrt å endre** (migrering og data).
- **A201 – Utfallet får eget felt for årsak (`default_cause_text`)** ved siden av kriteriet, fordi avviket har `cause_text` og `cause_criterion` (domenemodellen 4.7) og forskriften krever årsak per avvik. **Lett å endre** (valgfri kolonne).
- **A202 – Badet har åtte kontrollpunkter som i kartleggingen, med egne felt for membrantype, alder, fall, terskelhøyde og hulltaking.** Hulltakingsmålingene er **enkeltfelt nå** (én måling per bad), selv om domenemodellen 4.5/4.7/4.11 sier `table`: betingelsene `number_vs_limit` og `field_filled` leser ett felt, og formatet på `table_columns` er ikke bestemt. Tabellen kommer i 2a-3, og kodene `wet_room.hole_moisture_*`, `hole_air_temperature` og `hole_construction` arkiveres da. Kilde: `kartlegging-bad.md`, fagråd runde 1 (S3), arkitektens vurdering. **Dyrt å endre** (faste koder).
- **A203 – Rundt 25 avviksspørsmål med én tekst hver, ikke alle 47 fra IVIT.** Smal vei først. Kilde: svar 1, planen 2a-2. **Lett å endre.**
- **A204 – Varmgang på el-punkter er HMS, ikke TG3.** Kilde: `kartlegging-bad.md` punkt 5, forskriften § 2-18. **Lett å endre.**
- **A205 – Malen legges bare i prøveorganisasjonen** som publisert versjon 1 av familien «Tilstandsrapport bolig». Kilde: autonom modus, A140. **Lett å endre.**
- **A206 – Ett vanntett sjikt per våtrom, ikke eget for vegg og gulv.** De fleste bad har ett system; smal vei først. Trengs det, legges to nye felt til og `wet_room.membrane_type` arkiveres. Kilde: `kartlegging-bad.md`, svar 1. **Lett å endre** (nytt felt, ingen data i ekte bruk ennå).
- **A207 – Forhøyet fukt ved hulltaking gir valget TG2 eller TG3 (`choose_tg2_tg3`), ikke alltid TG3.** Takstmannen vurderer omfang og skade; KI og regler setter aldri TG. Fuktgrensene kommer med reglene (spørsmål 71). Kilde: `regelverk-krav.md`, `kartlegging-bad.md`. **Lett å endre** (utfallet i malen).
- **A208 – Fall registreres som mm per meter med fortegn** (negativ = motfall), og fuktmålingen har eget valg for enhet (vekt-% eller RF %). Ingen ekstra felt for målelengde. Kilde: fagansvarlig, `kartlegging-bad.md`. **Dyrt å endre** (faste koder og enhet).
- **A209 – Dokumentformatet godtar `approved`, uten egen godkjenningstjeneste.** Å godkjenne er en strukturendring som admin (eller den med `template.edit_structure`) kan gjøre i et utkast. Malfilen har bare `draft` (test). Seed finner familien med tjenesten `listTemplateFamilies` og lager nytt utkast bare når `isSameTemplateContent` sier at innholdet er endret. Kilde: arkitekt og test-leder, runde 1. **Lett å endre.**

### Avgjort ved uenighet i forhåndsvurderingen
- **Samtykke til hulltaking:** arkitekten foreslo `wet_room.hole_owner_consent`, fagansvarlig ville skille «nektet» fra «ikke spurt». Valgt: ikke eget felt; `hole_drilling_reason = owner_refused` dekker nektet, og tatt hull betyr samtykke. Færre felt og ingen motstrid.
- **Alderskilde:** arkitekten ville følge ordlisten (`documented`, `owner_stated`, `estimated`), fagansvarlig ville ha «ukjent». Valgt: ordlistens tre pluss `unknown`, fordi reglene bruker byggeåret når alderen er ukjent.
- **`approved` i dokumentformatet:** test-leder ba om ett valg. Valgt arkitektens form (godtatt i formatet, A209), fordi en senere godkjenningstjeneste da ikke krever endring av formatet.
- **Tenant-isolasjon for seed:** test-leder ba om `expectTenantIsolation` på seed-spørringen; arkitekten ville ha ingen rå spørring. Valgt: ingen rå spørring, tjenesten er allerede dekket, og seed-testen viser at familien ikke finnes i en annen organisasjon.

## Oppdeling (kan bygges i parallell)
1. **Utvikler A (kjernen):** migrering `0028_mal-tekststatus`, `schemas.ts`, `templates.ts` (lagre, lese, kopiere, telle), `isSameTemplateContent`, domenemodell og ordliste. Pusher `schemas.ts` først.
2. **Utvikler B (innhold og seed):** `src/db/seed/templates/wet-room.ts` (etter fagrollens liste og tekster) og `ensureSampleTemplate`. Starter når `schemas.ts` er pushet.
3. **Fag (domene):** spørsmålene og de korte tekstene til utvikler B, og kontroll av stil og at ingen tekst er kopiert (runde 2 når malfilen finnes).
4. **Testskriver:** testplanen. Datatesten kan skrives mot `parseTemplateDocument` før innholdet er ferdig.

## Akseptkriterier
- [ ] `pnpm db:seed:testoppdrag` lager én publisert malversjon med de åtte kontrollpunktene for våtrom i prøveorganisasjonen og ingenting i Byggcon-organisasjonen; to kjøringer gir ingen ny versjon og ikke noe utkast; endret innhold gir v2 (test).
- [ ] Alle utfall og tiltak i malen har `text_status = draft`; TG2, TG3 og `choose_tg2_tg3` har avvik, årsak, konsekvens og tiltak; HMS har avvik, konsekvens og tiltak; dokumentasjon gir bare TG2 (test).
- [ ] Ingen rapporttekst har gjetteord, henvisning til NS, TEK, Byggforsk, IVIT eller SmartTakst, eller 8 ord på rad fra `docs/kartlegging/`; ingen TG-utfall på punkt uten TG, prøvd på et dokument som skal feile (test).
- [ ] `text_status` og `default_cause_text` lagres, leses, kopieres til nytt utkast og telles riktig for utfall og tiltak; ukjent `text_status` avvises av skjemaet og av databasen (test).
- [ ] Bruker i annen organisasjon får ikke tilgang: de eksisterende `expectTenantIsolation`-kallene er grønne, malen finnes ikke i en annen organisasjon, og `tenant-isolation-all-tables` er grønn.
- [ ] Tilgang per rolle for de nye feltene er testet, og admin kan alltid lagre.
- [ ] Virker på iPad-størrelse: ikke aktuelt (ingen skjermer). `pnpm test:e2e` er grønn som før.
- [ ] KI-forslag: ikke aktuelt i denne oppgaven (ingen KI-kall). Dataene er strukturert slik «KI i veien» trenger.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne. Versjonen i `package.json` er 0.6.4.

## Roller
utvikler (to biter), testskriver, domene (fagtekstene). Arkitekt for migreringen og formen på `text_status` (A200, dyr å endre). Ikke ux, ui, sikkerhet-personvern eller ki-ansvarlig: ingen skjerm, ingen ny tilgang, ingen persondata og ingen KI-kall.

## Åpne spørsmål
- Ingen som stopper oppgaven. Spørsmål 71 (fuktgrense og levetider fra fagråd runde 1) og 72 (svar 59a, T-0003) må avgjøres før reglene, ikke før malen.
- Fagansvarliges spørsmål om vegg og gulv (A206) og om forhøyet fukt alltid er TG3 (A207) er avgjort av agentene og ført som A-beslutninger; Ståle kan endre dem.
