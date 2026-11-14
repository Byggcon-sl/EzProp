# Testplan: Badet på PC

- **Oppgavekort:** `docs/funksjoner/fase2a-badet-pc.md` (design: `fase2a-badet-pc-design.md`)
- **Dato:** 14.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** testene låser forskriftens struktur (TG, årsak, konsekvens, tiltak, kostnad; TGIU med begrunnelse), at reglene foreslår likt hver gang, at regler aldri setter TG selv, og at hver beslutning om et regelforslag logges.
  - **De ansatte:** e2e viser to trykk fra forslag til ferdig avvik, lagring per felt uten tapt tekst, og at skjermen virker på PC og iPad (liggende og stående), med tastatur og skjermleser.
  - **KI i bunnen:** testene låser de faste kodene (beslutning, `text_source`, `cost_type`, intervallkoder, `AiTargetRef`) og krokene (`ai_usage_id`, `ai_usage_log.report_id`), og at regelforslag ikke går gjennom KI.

All testdata er oppdiktet (oppdrag med gnr 999, «Åse Testesen», telefon `12345678`). Vitest mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Numrene (B1.1 osv.) står først i testnavnet, så rapporten kan krysse av. Ingen nye `*-testplan.test.ts`; testene legges i filene for området.

## Avtale om signaturer (utvikler og testskriver)

Navn kan endres av utvikleren; avvik føres i kortet.

- `src/core/reports/logic/`: `computeCheckpointTg(directTg, deviations) → "0" | "1" | "2" | "3" | "IU" | null`, `costWarning(amount) → "not_rounded" | null`, `parseCostAmount(input) → ok | error`, `COST_BANDS` (fem koder), `fillMergeFields(text, values) → { text, missing[] }`, `measureForTg(measures, tg)`, `checkpointWarnings(state) → Warning[]` (faste koder), `checkpointStatus(state)`, `RULE_REASON_TEXTS` (oversettelsen), `ruleResultSchema` (Zod, strengt).
- `src/core/reports/`: `startReport(actor, assignmentId)`, `getRoomView(actor, assignmentId, roomId)`, `saveField(actor, change)` med `change = { table, rowId, field, value, seenValue }`, `addDeviation`, `removeDeviation`, `addMeasure`, `removeMeasure`, `decideRuleSuggestion(actor, { reportId, checkpointResultId, ruleKey, decision, chosenTg?, chosenOutcomeKey?, overrideReason? })`, `setTgDirect`, `saveTgiuDetails`, `markCheckpointDone`.
- Svar ved konflikt: `{ kind: "conflict", currentValue }`. Svar ved gammelt forslag: feil med koden `suggestion_no_longer_applies`.

## 1. Enhet, rene funksjoner (`src/core/reports/logic/*.test.ts`, uten database)

`it.each`-tabeller der det passer.

1. **B1.1 tg_computed:** tom liste og `tg_direct` tom gir tom; TG2 + TG3 gir 3; slettet TG3 + TG2 gir 2; bare HMS (uten TG) + `tg_direct` 1 gir 1; avvik med TG går foran `tg_direct` 0/1.
2. **B1.2 TG0 er aldri et utfall:** ingen utfall i badmalen har TG0; `choose_tg2_tg3` uten valgt TG er ugyldig (feilkode, ikke stille TG).
3. **B1.3 TGIU og TG2/TG3:** `setTgDirect("IU")` på punkt med TG2-avvik gir krav om aktivt valg (kode `tgiu_conflicts_with_deviation`); HMS sammen med TGIU er lov.
4. **B1.4 TG-avvik på punkt med TG0/TG1** gir tømt `tg_direct` i resultatet av den rene overgangen.
5. **B1.5 kostnadsadvarsel:** 37 500 og 15 000 gir `not_rounded`; 40 000, 10 000 og 1 000 000 gir ingen. Beløpet rundes aldri om av funksjonen (inn = ut).
6. **B1.6 kostnad avvises:** 0, -10 000, 12 500,5, «10 000,00», tom og tekst avvises med norsk melding; «40 000» og «40000» godtas.
7. **B1.7 intervallene:** nøyaktig fem faste koder i fast rekkefølge, grensene under 20 000, 20 000–100 000, 100 000–200 000, 200 000–500 000, over 500 000; etikettene har merket utkast; kodene er uendret (låst liste i testen, regel 6).
8. **B1.8 flettefelt:** `{årstall}`, `{måleverdi}`, `{enhet}`, `{sted}` fylles fra svarene; uten verdi står ingen `{` eller `}` i teksten og feltet står i `missing`; to måleverdier i fallteksten fylles begge.
9. **B1.9 tiltak per TG (T-0060):** utfall `choose_tg2_tg3` med TG2 gir «bør»-tiltaket, TG3 gir «må»-tiltaket; utfall med bare én tekst og annen TG gir advarselen `review_text_for_tg`.
10. **B1.10 advarslene på punktet** (`it.each`, én rad per advarsel, og én rad som viser at den **ikke** kommer når alt er fylt ut): velg TG mangler; TG2/TG3 uten årsak, uten konsekvens, uten tiltak; TG3 uten kostnad (også `cost_type = none`); HMS uten konsekvens eller tiltak; TGIU-opplysning mangler; hulltaking ikke utført og annet enn TGIU på `wet_room.adjacent`; T-0059 («uten funn» og måling lik eller over grensen); forslag som ikke lenger gjelder. Ingen advarsel har `blocking: true`.
11. **B1.11 TGIU-opplysninger etter grunn:** alle TGIU krever de tre feltene; på `wet_room.adjacent` i tillegg annen fuktkontroll, resultat og skadeutsatt konstruksjon; når grunnen er «eier nektet» i tillegg «eier informert». Ingen falske advarsler: TGIU på et annet punkt ber ikke om fuktkontroll; eier ikke nektet ber ikke om «eier informert».
12. **B1.12 status per punkt:** ikke startet / i arbeid / ferdig / TGIU; slettede rader telles ikke; «x av 8 ferdig» teller bare `done`.
13. **B1.13 oversettelsen:** hver kode som kan stå i `reasons` fra reglene i badmalen har norsk tekst i `RULE_REASON_TEXTS` (testen går gjennom alle regler og testsaker og samler kodene); «ikke vurdert» gir tekst om hva som mangler.
14. **B1.14 regelsvarets skjema:** `ruleResultSchema` godtar svar fra alle testsakene; avviser ukjent nøkkel, fritekst-streng utenfor faste koder, og svar over øvre størrelse.
15. **B1.15 rent blad:** filene i `logic/` importerer bare egen mappe, `@/shared`, `@/core/rules` og `import type` (lint-regelen finnes og fanger en oppdiktet ulovlig import i en fixture).

## 2. Regeltester (testsaker som data)

Testsakene legges som data i malens `rule_test_cases` (`src/db/seed/templates/wet-room.ts`) og kjøres av `runRuleTestCases` (`src/core/rules/test-cases.ts`) i `wet-room.rules.test.ts`. Kortet sier «i `src/core/rules/test-cases.ts`», men den filen er kjøreren; testsakene hører til malen. Utvikler retter kortet.

1. **B2.1** Sjikt 1990, folie uten dokumentasjon → ett forslag, TG3 (`membrane_before_2000`), ikke TG2-forslaget i tillegg.
2. **B2.2** Folie uten dokumentasjon 2008, befaringsår 2026 → TG2-forslag (`membrane_past_lifespan`); 2009 → ikke forslag (kant).
3. **B2.3** Hull «ikke utført», grunn tom → TGIU-forslag; grunn «eier nektet» → TGIU-forslag (`hole_drilling_not_done`).
4. **B2.4** Hull «uten funn» 14,9 vekt-% → TG0-forslag (`hole_no_elevated_moisture`); 15 → forhøyet fukt, velg TG2 eller TG3 (`hole_moisture_over_limit`), og ikke TG0-forslag.
5. **B2.5 T-0051:** `build_year_source = unknown` uten årstall → «ikke vurdert»; valget heter «Ukjent» i malen, koden `unknown` er uendret.
6. **B2.6** Samme svar med to måleverdier gir samme forslag som med én over grensen.
7. **B2.7** `readYear` avviser urimelige årstall (1799, 2100, 0, «abc»), godtar 1900 og befaringsåret.
8. **B2.8** Egen-nøkkel-sjekk i `context.answers` og `checkDocumentKeys` for de sju feltkodene på betingelsene: en oppdiktet mal med ukjent feltkode i en betingelse avvises.
9. **B2.9** Alle testsakene i malen er grønne (`passed`), og en snudd forventning gir `passed = false` (testene kan feile).
10. **B2.10 malen:** ny publisert versjon fra seed; ingen faste koder endret eller fjernet sammenlignet med forrige versjon (`key`-listen før og etter); `applies_to_tg` bare på utfall av typen `choose_tg2_tg3` (`checkDocument` avviser ellers); tekstene har `text_status = draft`.

## 3. Database (`src/db/schema/reports.test.ts`, testdatabasen)

1. **B3.1** Sammensatte fremmednøkler avviser kobling på tvers av organisasjoner (`it.each` per kobling): rapport → oppdrag, rapport → malversjon, barnetabellene → rapport, `decided_by`/`done_by` → ansatt, `ai_usage_id` → `ai_usage_log`, `ai_usage_log.report_id` → rapport.
2. **B3.2** Unike nøkler holder med tomme kolonner: to `field_answers` for samme romfelt (`report_building_id` og `checkpoint_result_id` tomme, `repeat_index` 0) avvises; to `checkpoint_results` for samme punkt og rom avvises; to `tgiu_details` per punkt avvises. Mykt slettet rad hindrer ikke ny.
3. **B3.3** Én aktiv rapport per oppdrag (delvis unik indeks); `superseded` og mykt slettet teller ikke.
4. **B3.4 CHECK** (`it.each`): `tg_direct` bare 0, 1, IU; `deviations.tg` bare 2/3, tom for `hms`; `cost_type` band krever kode, approx krever beløp over 0, none ingen; `decision`, `text_source`, `jsonb_typeof` på `suggestion` og `reasons`; `applies_to_tg` 2 eller 3.
5. **B3.5 myk sletting:** ingen `ON DELETE CASCADE` i migreringen (kildesjekk), og ingen fremmednøkkel sletter rader.
6. **B3.6 migreringen** kjører på en database med data fra tidligere migreringer (oppdrag, rom, `ai_usage_log`-rader) uten feil og uten å endre eksisterende rader.
7. **B3.7 `tests/tenant-tables.ts`:** alle sju nye tabeller er ført med radbygger og testfil; `tenant-isolation-all-tables.test.ts` grønn.

## 4. Integrasjon (`src/core/reports/*.test.ts`, testdatabasen)

### 4a Start og lesing
1. **B4.1** `startReport` med `report.edit` lager én rapport, `status = draft`, låst til publisert systemmal for tilstandsrapport.
2. **B4.2** To samtidige kall (`Promise.all`) gir én rapport og samme id tilbake til begge.
3. **B4.3** Ny malversjon publiseres etter start: rapporten står på sin gamle versjon, og skjermdataene kommer fra den.
4. **B4.4** Uten publisert systemmal: tydelig norsk feilmelding, ingen rad.
5. **B4.5** `getRoomView` skriver aldri (telling av rader før og etter, også for kontor når rapporten ikke finnes: svaret er «ikke startet»).
6. **B4.6** Svaret til nettleseren har bare maldokumentet og svarene for rommet: ingen parter, adresse, matrikkel eller kontakter (sjekk med oppdiktede verdier i oppdraget).
7. **B4.7** Befaringsåret: oppdragets befaringstid brukes; uten den dagens år i norsk tid (falsk klokke 31.12 kl. 23.30 UTC gir neste år); året står i lagret regelsvar og i svaret til skjermen med kilde.

### 4b Lagring per felt
8. **B4.8** Hvert felt lagres for seg; `row_version` øker.
9. **B4.9 konflikt:** to endringer av samme felt med samme `seenValue` gir `conflict` med nyeste verdi til den andre; ingen stille overskriving.
10. **B4.10 ingen falsk konflikt:** ulike felt på samme avvik fra to «faner» gir ingen konflikt.
11. **B4.11** Ukjent eller arkivert feltkode, felt fra annen malversjon og ulovlig tabell/felt avvises.
12. **B4.12** Lengdegrense og fødselsnummer (elleve sifre) avvises i alle fritekstfelt (`it.each`: avvik, årsak, konsekvens, tiltak, `cost_text`, `override_reason`, `description_text`, `tgiu_details`-feltene, tekstsvar). Mønsteret ligger ett sted (test: `src/core/orders/schemas.ts` bruker det felles).
13. **B4.13** `ai_usage_id` fra klienten ignoreres eller avvises; bare serveren setter det.

### 4c Regelforslag (alle tre typer)
14. **B4.14 regler setter aldri TG:** lagring av felt som utløser alle fem reglene gir ingen avvik, ingen `tg_direct`, `tg_computed` tom og ingen beslutningsrad.
15. **B4.15 Godta `outcome`** (sjikt 1990): avvik med standardtekstene fra den låste malversjonen, `text_source = template`, `suggested_by_rule_id` satt, beslutningsrad `accepted` med serverens `suggestion`, `reasons`, settkodene og befaringsåret, `deviation_id` satt.
16. **B4.16 Godta `tgiu`** gir `tg_direct = IU` og rad `accepted`. **Godta `tg0`** (14,9) gir `tg_direct = 0` og rad `accepted`.
17. **B4.17 Endre og Avvis** uten begrunnelse avvises (ingen rad); med begrunnelse `changed` (med `chosen_tg`/`chosen_outcome_key`) og `rejected`. Ny beslutning på samme forslag er ny rad; ingen rad oppdateres (sjekk at første rad er uendret).
18. **B4.18 serveren stoler ikke på klienten:** forfalsket `suggestion`/`reasons` i kallet blir ikke lagret (serverens egne lagres); ukjent `rule_key` avvises; regel som ikke slår til på lagrede svar gir `suggestion_no_longer_applies`.
19. **B4.19 forslag som ikke lenger gjelder:** godta TG3, rett årstallet til 2015: avviket står, advarselen kommer, ingen rad slettes.
20. **B4.20 TGIU og TG-avvik:** godta TG3 på punkt med TGIU gir krav om aktivt valg, TGIU står til takstmannen velger; fjernet TGIU slettes mykt (`tgiu_details.deleted_at`). TG-avvik på punkt med TG1 tømmer `tg_direct`.
21. **B4.21 bør/må ved Endre:** endre utfallet `choose_tg2_tg3` til TG2 gir «bør»-tiltaket, TG3 «må»-tiltaket.

### 4d Avvik, tiltak, TGIU, ferdig
22. **B4.22** Avvik og tiltak fjernes mykt; slettede vises ikke og telles ikke; tak på 50 avvik og 20 tiltak per punkt gir norsk feilmelding.
23. **B4.23** Kostnad: fem intervaller kan lagres; eget beløp 37 500 lagres uendret med advarsel; 0, negativt og ikke-heltall avvises på serveren.
24. **B4.24** TGIU-opplysningene lagres og leses tilbake; advarslene følger grunnen (som B1.11, nå gjennom tjenesten).
25. **B4.25** «Ferdig med punktet» lagres med `done_by`/`done_at` også med advarsler, og svaret peker på neste punkt som ikke er ferdig.

### 4e Logg, personvern og statiske sjekker
26. **B4.26 fritekstmarkør:** en unik oppdiktet markør i alle fritekstfelt og i `override_reason` finnes ikke i `audit_log`, fanget applikasjonslogg eller `reasons`; revisjonsradene har bare id-er, koder, feltkoder, TG og tall.
27. **B4.27 feilgrener:** en framprovosert databasefeil logger ikke feltverdi eller parametre.
28. **B4.28 statisk:** ingen `.delete(` i `src/core/reports`; `src/core/reports` importerer ikke `src/core/ai`; ingen kall til `requestSuggestion`; klientkomponentene under ruten importerer bare `@/core/reports/logic`, ikke indeksen.
29. **B4.29 gjetteord og kopitest** dekker oversettelsesfilen, de nye tiltakstekstene og intervalletikettene (eksisterende test utvides med filene).
30. **B4.30** `source_ref` flettes aldri inn i avvikstekst, årsak, konsekvens eller tiltak (Godta med regel som har kilde).

## 5. Tilgang per rolle og tenant-isolasjon (krav for godkjenning)

I `src/core/reports/access.test.ts` (eller tjenestefilene):

1. **B5.1 tilgangsmatrisen** (`it.each`, rolle × `access.inspectors_edit_all` på/av × hver skrivende handling: start, felt, avvik, tiltak, beslutning, TGIU, TG direkte, ferdig, fjern):
   - takstmann: på → lov; av → avvist uten enkeltrettighet, lov med `report.edit` som enkeltrettighet.
   - kontor: avvist på serveren for alle handlinger, begge innstillinger; kan lese.
   - leder: lov.
   - **admin: alltid lov, også når innstillingen er av** (regel 11).
2. **B5.2 admin stenges aldri ute:** admin uten andre roller kan starte rapporten, godta, endre og avvise forslag og merke ferdig, og ser skjermen også når alle takstmenn er sperret.
3. **B5.3 `expectTenantIsolation`** per spørring som tar `organizationId` (én kall per spørring, i samme testfil): `getRoomView`, rapportoppslag, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`, `rule_suggestion_decisions`, oppslag av publisert systemmal, og `ai_usage_log.report_id`.
4. **B5.4 404 i kjeden** (`AccessDeniedError`, samme svar): rom fra annen organisasjon; rom fra annet oppdrag i samme organisasjon; rom som ikke er våtrom; mykt slettet rom, etasje, bygning eller oppdrag; rapport fra annen organisasjon med gyldig id.
5. **B5.5 id fra skjemaet styrer aldri organisasjonen:** kall fra B med A sin `reportId`, `checkpointResultId`, `deviationId` og `rowId` i `saveField` gir 404 og ingen endring i A (rader telles før og etter).
6. **B5.6** `requireUuid` før Zod: ugyldig id gir 404, ikke databasefeil.
7. **B5.7** Ingen nye rettigheter: listen i `src/core/access` er uendret, og `report.read` finnes ikke.

## 6. E2E (`e2e/fase-2a-badet-pc.spec.ts`, prosjektene `pc` og `ipad`)

Data: testen lager sitt eget oppdrag med våtrom i en egen prøveorganisasjon med publisert badmal (direkte mot `e2eDatabaseUrl()`, oppdiktet), slik at den ikke avhenger av andre tester. Prosjektet `ipad` er liggende (1194 × 834); stående prøves med `page.setViewportSize({ width: 834, height: 1194 })` i egne tester.

1. **B6.1 hovedflyt (PC):** «Bygninger og rom» → «Fyll ut badet» → åtte punkter og «0 av 8 ferdig»; fyll sjikt 1990 og folie uten dokumentasjon → forslag «TG3» med begrunnelse og befaringsår; Godta → avvikskort med standardtekst, fokus på kortet, `aria-live` sier «Avvik lagt til, TG3»; velg intervall; Ferdig → neste punkt som ikke er ferdig åpnes, «1 av 8 ferdig», TG3 som tekst i listen. Etter omlasting står alt.
2. **B6.2 Endre og Avvis:** Endre-knappen sperret til begrunnelse er fylt ut, med forklaring; lagret som `changed` (sjekk i databasen). Avvis likeså → `rejected`. Avvis står ikke rett ved Godta (avstand målt med `boundingBox`).
3. **B6.3 bør/må:** forhøyet fukt (15) → velg TG2 → «bør»-tiltak; bytt til TG3 → «må»-tiltak.
4. **B6.4 TGIU:** hull ikke utført, eier nektet → TGIU-forslag → Godta → advarsel om manglende opplysninger, inkludert «eier informert»; fyll ut → advarselen borte.
5. **B6.5 T-0059 og hulltaking:** «uten funn» med 15 gir advarsel med forslag om «Utført med funn»; TG1 på tilliggende med hull ikke utført gir advarsel; ingen av dem sperrer Ferdig.
6. **B6.6 kostnad:** eget beløp 37 500 gir advarsel under feltet mens man skriver, 40 000 ikke; 0 gir feilmelding; alle fem intervallene kan velges.
7. **B6.7 lagringsfeil:** `page.route` med `abort` på lagringskallet → «Ikke lagret – prøv igjen» i feltet og toppen, teksten står; fjern ruten → lagres, «Lagret».
8. **B6.8 uten nett:** `context.setOffline(true)` → «Uten nett – endringene dine er ikke lagret ennå», teksten står; tilbake på nett → lagres. Ingen rapportdata i localStorage eller IndexedDB (sjekk med `page.evaluate`).
9. **B6.9 to faner:** samme felt endret i to sider gir «Endret av andre» med nyeste verdi i den andre; ulike felt på samme avvik gir ingen konflikt.
10. **B6.10 kontor:** ser «Rapporten er ikke startet» uten knapper; etter start ser kontoret skjermen skrivebeskyttet (ingen redigerbare felt, ingen Godta).
11. **B6.11 admin:** admin kommer inn og kan godta et forslag når `access.inspectors_edit_all` er av.
12. **B6.12 iPad liggende og stående:** hele flyten fra Godta til Ferdig; stående har «Punkter (3 av 8)»-panelet og «Forrige punkt»/«Neste punkt» (minst 56 px); ingen vannrett rulling (`scrollWidth <= clientWidth`) på begge; alle knapper minst 44 px, Godta og Ferdig minst 56 px; ingen `select` på siden.
13. **B6.13 tastatur:** hele hovedflyten bare med Tab, mellomrom og Enter; fokus synlig.
14. **B6.14 axe** uten feil på punktet med forslag, avvikskort og advarsler, på PC og iPad stående. TG har alltid tekst, ikke bare farge.
15. **B6.15 flettefelt:** ingen `{` eller `}` synlig i avvikskortet når en verdi mangler; manglende verdi er merket.
16. **B6.16 404:** adresse med rom fra annet oppdrag og med ugyldig id gir 404-siden.

## 7. Øvrig

1. **B7.1** `package.json` 0.12.0 (eller høyere om en annen branch er merget først), og `/api/helse` viser den.
2. **B7.2** `pnpm size` er kjørt og ruten er innenfor grensen.
3. **B7.3** Ingen ny avhengighet i `package.json`.

## Godkjenning

Avvises hvis noe i avsnitt 5 (tilgang, admin, tenant-isolasjon), B4.14 (regler setter aldri TG), B4.18 (serveren stoler ikke på klienten), B4.26 (ingen fritekst i loggene) eller B4.28 (ingen `delete`, ingen KI) mangler eller er rødt. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` må være grønne på `pc` og `ipad`.
