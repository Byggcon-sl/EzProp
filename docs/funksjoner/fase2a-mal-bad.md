# Funksjon: Malen for ett bad (våtrom) i malmotoren

- **Fase:** 2a-2 Smal vei, første punkt («Malen for ett bad»)
- **Modul:** kjerne (`src/core/templates`, tabellene i `src/db/schema/templates.ts`) og seed (`src/db/seed`)
- **Branch:** `fase2a-mal-bad` (bygger på `main`)
- **Status:** klar til bygging
- **Dato:** 12.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen får ett ferdig bad med faste punkter, valg og korte avvikstekster å starte fra, i stedet for å skrive alt selv. Det er grunnlaget for skjermen for badet (neste punkter).
  - **KI i bunnen:** hvert punkt, felt, spørsmål og utfall får en fast kode, og tekstene lagres strukturert (årsak, konsekvens, tiltak hver for seg) med status «utkast». Det er dataene KI senere velger fra (frasebank, språkvask, sammendrag). KI lager ikke ny tekst for å fylle hull.
  - **Færre reklamasjoner:** våtrom er der flest reklamasjoner kommer. Malen tar inn det IVIT mangler: membrantype og alder som egne felt, fallmåling og høyde ved terskel som tall, og hulltaking med egne målefelt (`docs/kartlegging/kartlegging-bad.md`, «Funn og svakheter i IVIT»).

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
1. **Malinnholdet som data** i én fil, for eksempel `src/db/seed/templates/wet-room.ts`, i dokumentformatet fra `src/core/templates/schemas.ts` (flate lister med koder). Én seksjon `wet_room` med `repeat = per_room` og `room_type_groups = ["wet_room"]`.
2. **Åtte kontrollpunkter** (etter `kartlegging-bad.md` og leilighetsmalen godkjent i fagråd runde 1), alle `scope = room`, `group = room`, `room_type_groups = ["wet_room"]`:
   | Kode | Navn | Felt (kode, type) |
   |---|---|---|
   | `wet_room.general` | Generelt | `wet_room.built_year` (tall), `wet_room.age_source` (valg: dokumentasjon / opplyst av eier / anslått), `wet_room.building_code` (valg: før 1997 / 1997–2010 / TEK10 / TEK17 / ukjent) |
   | `wet_room.documentation` | Dokumentasjon for våtrom | `wet_room.documentation_type` (valg: ingen / samsvarserklæring / våtromssertifikat / annen skriftlig dokumentasjon) |
   | `wet_room.walls_ceiling` | Overflater vegger og himling | `wet_room.ceiling_type` (valg) |
   | `wet_room.floor` | Overflater gulv | `wet_room.floor_type` (valg), `wet_room.floor_heating` (valg), `wet_room.fall_direction_1_mm` og `wet_room.fall_direction_2_mm` (tall, mm), `wet_room.threshold_height_mm` (tall, mm fra topp slukrist til topp membran ved terskel) |
   | `wet_room.membrane_drain` | Vanntett sjikt, membran og sluk | `wet_room.membrane_type` (valg: smøremembran / folie / banemembran / plater med tettesystem / ukjent, med `material_code`), `wet_room.membrane_visible` (avkrysning), `wet_room.membrane_year` (tall), `wet_room.drain_type` (valg) |
   | `wet_room.fixtures` | Sanitærutstyr og innredning | – |
   | `wet_room.ventilation` | Ventilasjon | `wet_room.ventilation_type` (valg: balansert / mekanisk avtrekk / naturlig / ingen) |
   | `wet_room.adjacent` | Tilliggende konstruksjoner våtrom | `wet_room.hole_drilling` (valg: utført uten funn / utført med funn / ikke utført), `wet_room.moisture_reading` (tall, med enhet), `wet_room.moisture_location` (tekst), `wet_room.air_temperature` (tall, °C), `wet_room.construction` (tekst), `wet_room.owner_consent` (avkrysning), `wet_room.hole_drilling_reason` (tekst, begrunnelse når hull ikke er tatt) |
   `wet_room.general`, `wet_room.membrane_drain` og `wet_room.adjacent` er `mandatory = true`. Alle har `gives_tg = true`. Kontrollpunktene peker på hverandre med `related_checkpoint_keys` der de hører sammen (membran og sluk med gulv og tilliggende).
3. **Rundt 25 avviksspørsmål** (de vanligste per punkt etter `kartlegging-bad.md`, minst to per punkt unntatt `wet_room.adjacent`), med **ett utfall hvert** (`tg2`, `tg3` eller `choose_tg2_tg3`). Spørsmålene som kommer an på ventilasjonstype, tas ikke med nå. Hvert utfall har:
   - `deviation_text` (avvik: hva som er sett),
   - `default_cause_text` (ny, årsak: hvorfor TG-en) og `default_cause_criterion`,
   - `default_consequence_text`,
   - ett eller to `standard_measures` (tiltak),
   - `source_ref` (kilde i bakgrunnen, for eksempel «NS 3600:2025 tillegg C»),
   - `text_status = draft`.
   **Tekstene er Byggcons egne og korte** (svar 1 i `svar-claude-pa-vegne-av-stale-2026-11-10.md`): én til to setninger per felt, «bør» ved TG2 og «må» ved TG3, ingen gjetteord («antas», «trolig»), ingen henvisning til TEK, NS eller Byggforsk i teksten. Flettefelt som `{årstall}` og `{måleverdi}` er lov. **Ingen tekst fra NS 3600, IVIT eller SmartTakst, og ingen tekst kopiert fra `docs/kartlegging/`** (regel 7): prøveeksemplene der er bare mønster for lengde og tone.
4. **Merket «utkast, ikke godkjent av fagrådet» i data:** ny kolonne `text_status` (`draft` eller `approved`, standard `draft`, CHECK) på `outcomes` og `standard_measures`, og ny kolonne `default_cause_text` på `outcomes`. Én migrering (`0028_mal-tekststatus`). Begge feltene i dokumentformatet (`schemas.ts`), i `getTemplateVersion`, i kopien i `createDraftVersion` og i tellingen «endret» (A144). Ingen tjeneste setter `approved` ennå.
5. **El-forhold gir ikke TG i våtrommet.** Varmgang på armatur eller el-punkter legges som utfall `hms` under `wet_room.fixtures`, ikke TG3 (`kartlegging-bad.md` punkt 5, NS 3600:2025+AC).
6. **Seed:** `pnpm db:seed:testoppdrag` lager malfamilien «Tilstandsrapport bolig» (`kind = system`, `report_type = condition_report`) i **prøveorganisasjonen**, lagrer badet med `saveDraftContent` og publiserer versjon 1 med `publishVersion`. Kjøres den to ganger, skjer ingenting (samme innhold gir ingen ny versjon). Er innholdet endret i filen, lages et nytt utkast som lagres og publiseres. Ikke i Byggcon-organisasjonen ennå.
7. **Tester:**
   - Malfilen består `parseTemplateDocument` (alle koder henger sammen, ingen `tgiu`, ingen arkiverte koder).
   - En ren datatest av malfilen: alle utfall og tiltak har `text_status = draft`; alle TG2/TG3-utfall har avvik, årsak og konsekvens; TG3-utfall har minst ett tiltak; ingen tekst inneholder «antas», «trolig», «NS 3600», «TEK», «Byggforsk», «IVIT» eller «SmartTakst»; ingen utfall `tg2`/`tg3` på punkt med `gives_tg = false` (del av T-0014, tas med her fordi det gjelder malen); alle koder starter med `wet_room.`.
   - Migreringen: `text_status` avviser ukjente verdier (CHECK), standard er `draft`.
   - `saveDraftContent` og `getTemplateVersion`: de nye feltene lagres, leses og kopieres til nytt utkast; samme dokument to ganger gir 0/0/0; endret `text_status` alene teller som «endret».
   - Seed: kjøres to ganger gir én familie og én publisert versjon; malen finnes bare i prøveorganisasjonen (`expectTenantIsolation` for seed-spørringen som finner familien).
8. Domenemodellen 4.5 (de to nye kolonnene) og ordlisten (`text_status`, `default_cause_text`, kodene `wet_room.*`). `package.json`: ny patch-versjon.

**Ikke med (bevisst utelatt):**
- **Regler** (alder mot levetid, fuktgrense, våtrom før 2000, hulltaking nektet gir TGIU) og testsakene deres. Det er neste punkt («Reglene badet trenger»). `rules`, `rule_conditions` og `rule_test_cases` er tomme i malen. Spørsmålet om svar 59a (T-0003, spørsmål 72) avgjøres der.
- **Skjerm** for badet, avvikskort og TGIU på punktet (punkt 3 i 2a-2).
- Levetider, terskler og kostnadsintervaller som tabeller (2a-3).
- Resten av tilstandsrapporten (andre rom, utvendig, tekniske installasjoner). Kommer som ny versjon av samme familie i 2a-3.
- Godkjenning av tekster (å sette `approved`), og visning av merket i grensesnittet.
- Spørsmålene som kommer an på ventilasjonstype, og flere tekstvarianter per spørsmål.
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

Seed kjører med admin i prøveorganisasjonen og går gjennom tjenestene i `src/core/templates` (ingen tilgangslogikk i seed).

## Data
- **Endret:** `outcomes` får `default_cause_text` (tekst, valgfri) og `text_status` (`draft` / `approved`, ikke tom, standard `draft`). `standard_measures` får `text_status`. Migrering `0028_mal-tekststatus`. Ingen nye tabeller, så `tests/tenant-tables.ts` er uendret.
- **Faste koder som tas i bruk:** familien «Tilstandsrapport bolig», seksjonen `wet_room`, de åtte kontrollpunktene og feltene i tabellen over, valgkodene under hvert felt, spørsmålskoder som `wet_room.membrane_drain.leak_at_penetration` og utfallskoder `tg2`/`tg3`/`choose`/`hms` under spørsmålet. Kodene endres aldri etter merge (regel 6).

## Skjermer
Ingen.

## Regler
Ingen regler kjøres eller lagres. Strukturreglene i malmotoren gjelder, pluss datatesten i Omfang 7.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A200–A205)
- **A200 – Merket «utkast, ikke godkjent av fagrådet» er en kolonne `text_status` per utfall og per tiltak**, ikke på malversjonen. Da kan fagrådet godkjenne tekst for tekst, og KI kan senere velge bare godkjente. Kilde: CLAUDE.md (autonom modus, fagtekster), malmotorkortet (Data). **Dyrt å endre** (migrering og data).
- **A201 – Utfallet får eget felt for årsak (`default_cause_text`)** ved siden av kriteriet, fordi avviket har `cause_text` og `cause_criterion` (domenemodellen 4.7) og forskriften krever årsak per avvik. **Lett å endre** (valgfri kolonne).
- **A202 – Badet har åtte kontrollpunkter som i kartleggingen, med egne felt for membrantype, alder, fall, terskelhøyde og hulltaking.** Kilde: `kartlegging-bad.md` («Funn og svakheter», «Forslag til datamodell»), fagråd runde 1 (S3). **Dyrt å endre** (faste koder).
- **A203 – Rundt 25 avviksspørsmål med én tekst hver, ikke alle 47 fra IVIT.** Smal vei først; flere spørsmål og varianter kommer med bredden. Kilde: svar 1 (korte tekster, én grunntekst), planen 2a-2. **Lett å endre.**
- **A204 – Varmgang på el-punkter er HMS, ikke TG3.** Kilde: `kartlegging-bad.md` punkt 5 (NS 3600:2025+AC: el-forhold uten TG). **Lett å endre.**
- **A205 – Malen legges bare i prøveorganisasjonen**, som publisert versjon 1 av familien «Tilstandsrapport bolig». Byggcon-organisasjonen får den når fagrådet har godkjent tekstene. Kilde: autonom modus (ingen ekte data), A140. **Lett å endre.**

## Oppdeling (kan bygges i parallell)
1. **Utvikler A (kjernen):** migrering `0028_mal-tekststatus`, `schemas.ts`, `templates.ts` (lagre, lese, kopiere, telle), domenemodell og ordliste. Pusher `schemas.ts` først.
2. **Utvikler B (innhold og seed):** `src/db/seed/templates/wet-room.ts` med kontrollpunkter, felt, valg, spørsmål og tekster (etter fagrollens liste og tekster), og `ensureSampleTemplate` i `sample-assignments.ts`. Starter når `schemas.ts` er pushet.
3. **Fag (domene):** liste over spørsmålene og de korte tekstene til utvikler B, og kontroll av at ingen tekst er kopiert.
4. **Testskriver:** testene i Omfang 7. Datatesten av malfilen kan skrives mot `parseTemplateDocument` før innholdet er ferdig.

## Akseptkriterier
- [ ] `pnpm db:seed:testoppdrag` lager én publisert malversjon med de åtte kontrollpunktene for våtrom i prøveorganisasjonen; to kjøringer gir ingen ny versjon (test).
- [ ] Alle utfall og tiltak i malen har `text_status = draft`, og alle TG2/TG3-utfall har avvik, årsak og konsekvens; TG3 har minst ett tiltak (test).
- [ ] Ingen tekst i malen har gjetteord eller henvisning til NS, TEK, Byggforsk, IVIT eller SmartTakst; ingen TG-utfall på punkt uten TG (test).
- [ ] `text_status` og `default_cause_text` lagres, leses, kopieres til nytt utkast og telles riktig; ukjent `text_status` avvises (test).
- [ ] Bruker i annen organisasjon får ikke tilgang: malen finnes bare i prøveorganisasjonen (`expectTenantIsolation`), og `tenant-isolation-all-tables` er grønn.
- [ ] Virker på iPad-størrelse: ikke aktuelt (ingen skjermer). `pnpm test:e2e` er grønn som før.
- [ ] KI-forslag: ikke aktuelt i denne oppgaven (ingen KI-kall). Dataene er strukturert slik «KI i veien» trenger.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne. Versjonen i `package.json` er økt.

## Roller
utvikler (to biter), testskriver, domene (fagtekstene). Arkitekt for migreringen og formen på `text_status` (A200, dyr å endre). Ikke ux, ui, sikkerhet-personvern eller ki-ansvarlig: ingen skjerm, ingen ny tilgang, ingen persondata og ingen KI-kall.

## Åpne spørsmål
- Ingen som stopper oppgaven. Spørsmål 72 (svar 59a, T-0003) må avgjøres før reglene, ikke før malen.
