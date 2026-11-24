# Testplan: KI i veien (fraseforslag, språkvask og utkast til sammendrag på badet)

- **Oppgavekort:** `docs/funksjoner/fase2a-ki-i-veien.md`
- **Dato:** 17.11.2026 (test-leder, før bygging; rettet av prosjektlederen samme dag etter runde 2 og skjemacommiten 91bf859b, A460–A472)
- **Støtter hovedmål:**
  - **KI i bunnen (hovedsaken):** testene låser at alle tre funksjonene går gjennom `src/core/ai` med vask, forslag, beslutning og logg, at KI aldri setter TG eller publiserer, og at svar som endrer TG eller legger til tall stoppes før de vises.
  - **Færre reklamasjoner:** sammendraget får kodens grupper og rekkefølge, advarsel når funnene er endret, dekningssjekk for TG3, og evalueringssett som måler at ingen funn mangler eller legges til.
  - **De ansatte:** e2e viser to trykk fra «Forslag» til tekst i feltet, språkvask av hele avviket i ett kall, tekstsøk uten nett, og at skjermen virker på PC og iPad med tastatur og skjermleser.

All testdata er oppdiktet (oppdrag med gnr 999, «Åse Testesen», telefon `12345678`, e-post `ase.testesen@eksempel.no`, adresse «Testveien 1»). Vitest mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Numrene (K1.1 osv.) står først i testnavnet, så rapporten kan krysse av. Ingen nye `*-testplan.test.ts`; testene legges i filene for området. Hjelpere: `tests/ai.ts`, `tests/report-fixtures.ts` (`createBathroomFixture`, `startedBathroom`, `CP`), `tests/tenant-isolation.ts`, `tests/factories.ts`. Kortets avtale om signaturer gjelder; navn kan endres av utvikleren, og avvik føres i kortet.

**Merker i tester mot loggen:** tall- og tekstmerker som skal vises fraværende i `ai_usage_log`, må ikke kunne stå i en uuid eller et tidsstempel (bruk for eksempel «Mxq-merke-ÆØ» eller tall med mellomrom «77 7 2»), så testene ikke blir ustabile slik `booking-ai-no-leak.test.ts` 4.10.3.

## 1. Enhet, rene funksjoner (uten database)

### 1a Vaktene på svaret (`src/core/ai/guards.test.ts`)
Testsakene legges som data i `src/core/ai/guard-cases.ts` (`it.each`), og samme tabell brukes av evalueringen.

1. **K1.1 `extractTgMentions` er flyttet:** finnes i kjernen, og `evals/run.ts` importerer den derfra (statisk grep: ingen egen kopi i `evals/`). Gir «TG2», «TG 3», «tilstandsgrad 2», «TGIU», «TG IU» og «ikke undersøkt» (som TGIU); store og små bokstaver likt; «STG2» og «TG23» er ikke treff.
2. **K1.2 TG-vakt, `language_polish`:** TG som sto i inndata og står uendret i svaret: slipper gjennom. Ny TG i svaret: `tg_guard`. TG2 i inn, TG3 i ut: `tg_guard`. «ikke undersøkt» lagt til: `tg_guard`. TG fjernet fra svaret: `tg_guard` (endring).
3. **K1.3 TG-vakt, `summary_draft`:** enhver TG-nevnelse i KI-teksten stopper (også TG som sto i funnene som ble sendt, og «ikke undersøkt»). TGIU-linjene skrives av koden og går ikke gjennom vakten (A462), så et utkast med TGIU-funn stoppes ikke. To funn med TG byttet (F1 TG3 og F2 TG2 i inn, svaret omtaler F1 under G2-merket): `tg_guard`.
4. **K1.4 tallvakt:** for `language_polish` og `summary_draft` stopper nytt årstall, ny måleverdi («18 vekt-%»), ny lengde («3 mm»), nytt kronebeløp («40 000 kr») med `number_guard`. Tall som sto i inndata (også «40000» mot «40 000») slipper gjennom. «15,0» mot «15» stoppes (sifferrekker, vakten feiler lukket, A471). Tall i K-/F-/G-merkene regnes ikke som nye tall. For `summary_draft` sjekkes tall per funn: «15 vekt-%» fra F1 som står under F2, gir `number_guard` (A461). Når TG-vakten og tallvakten slår til samtidig, er koden `tg_guard`; rekkefølgen `tg_guard`, `coverage_guard`, `number_guard`, `placeholder_guard` (A471).
5. **K1.5 vaktene gjelder ikke `phrase_suggest`** (svaret er bare merker); en `output_text` med TG fra den falske leverandøren for `phrase_suggest` brukes aldri.
6. **K1.6 tom-tekst-vakt (T-0111):** `""`, `"   "`, `"\n\t "` og bare ikke-brytende mellomrom (U+00A0) regnes som tom for `language_polish`.
7. **K1.6a dekningsvakt (A461):** svar for `summary_draft` der et F-merke mangler (tre funn i én gruppe, to omtalt), er tomt eller er ukjent (`F9` når det finnes 3), gir `coverage_guard`. Alle F-merker med tekst slipper gjennom.
8. **K1.6b plassholdere (A466):** svar med samme plassholdere i samme rekkefølge per type byttes tilbake til de opprinnelige verdiene; lagt til, fjernet eller byttet rekkefølge på to `[navn]` gir `placeholder_guard`. Kjent overvask («Ås», «Berg», «1985 Bad») kommer tilbake som den sto.
9. **K1.6c nektelse (fag 5, spørsmål 103):** saker der «ikke», «ingen» eller «uten» faller bort står i `guard-cases.ts` som kjente saker; forventningen er at evalueringen merker dem som ikke bestått. Ingen vakt ennå.

### 1b Kandidatkontrakten (`src/core/ai/candidates.test.ts`)
1. **K1.7 streng tolking av svaret:** `["K2","K1"]` gir de to i den rekkefølgen; ukjent merke (`K9` når det finnes 4), doble merker, tomme strenger, ikke-streng og merker som ikke har formen `K<tall>` tas bort, og antallet bortkastede føres i `input_summary`. Mer enn 5 gyldige: de 5 første. 0 gyldige gir `no_match`. Svar som ikke er en liste gir `no_match` (eller feilkode etter ADR 0006 del 8), aldri unntak.
2. **K1.8 merkene byttes til `{ source, id }` i kjernen:** klienten får aldri K-merker i stedet for id-er, og merke-tabellen lages på nytt for hvert kall (samme kandidat kan ha ulikt merke i to kall).
3. **K1.9 kildekodene låst:** `template_outcome`, `template_measure`, `phrase` (reservert), i den rekkefølgen (regel 6).

### 1c Kandidatkilden og tekstsøket (`src/core/reports/logic/phrase-candidates.test.ts`)
1. **K1.10 rekkefølge før KI (A433):** avvikets eget utfall først, så samme punkt og samme TG, så resten av punktet, så resten av badet; innen hvert ledd malens rekkefølge.
2. **K1.11 samme felttype:** `cause_text` gir bare årsakstekster, `deviation_measure.text` bare standardtiltak; ingen blanding.
3. **K1.12 teksten i feltet tas ut** (sammenligning etter `normalizeSpaces`, store og små bokstaver likt).
4. **K1.13 arkiverte utfall og tiltak** og tekster fra en annen malversjon er ikke med.
5. **K1.14 grensen i `limits.ts` (A467):** kandidatkilden: et oppdiktet bad med flere kandidater enn `AI_CANDIDATES_MAX` gir nøyaktig grensen, de nærmeste leddene beholdes (punktets egne kuttes aldri før resten av badet), og antallet kuttet står i `input_summary`. Kjernen: en liste over grensen sendt rett til `requestSuggestion` gir `too_many_candidates` uten kall og uten loggrad (sikringen).
6. **K1.15 flettefelt:** kandidaten vises med verdiene satt inn (`fillMergeFields`); mangler en verdi, står den i `missing`, og teksten har ingen `{` eller `}`.
7. **K1.16 tekstsøket uten KI (A485):** samme søk som A382; «fukt» finner kandidater med fukt; tomt felt gir kandidatene i rekkefølgen fra K1.10 (høyst 5); æøå og store bokstaver likt; ingen treff gir tom liste. Funksjonen ligger i `logic/` og kan kjøres i nettleseren (statisk: ingen import av `server-only` eller `@/db`).
8. **K1.17 annen TG:** kandidat fra et utfall med annen TG enn avviket merkes, slik at skjermen viser advarselen `texts_written_for_other_tg`. HMS-tekster er aldri kandidater for et TG-avvik, og TG-tekster aldri for et HMS-avvik (A463, `it.each` begge veier).
9. **K1.17a «Mest brukt» (A468):** ved lik plass etter A433 kommer kandidaten med flest valg først; flest valg (minst to) gir merket; tallet er samlet per organisasjon, og funksjonen tar ingen ansatt-id. Tekstsøket (K1.16) bruker samme tall.
10. **K1.17b `new_measure`:** målet `deviation` / `new_measure` gir standardtiltakene som kandidater; bare `phrase_suggest` godtar målet (`language_polish` og `summary_draft` avviser).

### 1d Sammendraget (`src/core/reports/logic/summary.test.ts`)
1. **K1.18 grupper og rekkefølge (A434):** TG3, TG2, TGIU, HMS sist uten TG; innen gruppen malens rekkefølge på punktene, så avvikenes rekkefølge. Tomme grupper tas ikke med.
2. **K1.19 hva som er «godkjent funn»:** tas med: avvik med valgt TG2/TG3 (godtatt, endret eller lagt til selv), punkter med TGIU, HMS-avvik. Tas ikke med (`it.each`): avvik uten valgt TG, TG0, TG1, avvist regelforslag, ubesvart regelforslag, tomt punkt, mykt slettet avvik, mykt slettet tiltak.
3. **K1.20 TGIU:** bruker `tgiu_details.reason`; teksten fra koden sier aldri «uten funn». Hulltaking nektet av eier står som TGIU, aldri TG2.
4. **K1.21 overskriftene er kodens:** kjernen setter overskrift per G-merke og punktets navn først i hvert avsnitt (A462); svaret gir tekst per F-merke, og et manglende eller ukjent F-merke gir `coverage_guard` (K1.6a), ikke stille tap av funn. TGIU-linjene er punktets navn og `tgiu_details.reason`, skrevet av koden.
5. **K1.22 formatet:** `F1: punkt | tekster` under `G1…Gn`; romnavn, etasje, bygning, «eier informert», bildetekst, interne notater og kostnad står aldri i inndataen (tabell med oppdiktede merker per felt).
6. **K1.23 grense:** flere funn eller lengre tekst enn grensen for `summary_draft` gir feilkoden for «for mange funn» / «for lang tekst»; ingen funn kuttes stille.
7. **K1.24 «Funnene er endret» (A435):** `summary_basis` mot dagens funn: endret `row_version`, endret TG, nytt funn og fjernet funn gir advarsel med hvilke funn det gjelder; likt gir ingen. `summary_basis` har bare id, TG og `row_version` (Zod, strengt, ukjent nøkkel avvises).
8. **K1.25 dekningssjekk for TG3 og TGIU:** TG3- og TGIU-funn der punktets navn ikke står i teksten gir advarsel; et uendret utkast gir aldri advarselen (navnet står først, A462); navnet med annen bokstavstørrelse regnes som nevnt; gjelder også tekst skrevet for hånd uten `summary_basis`. Ingen advarsel har `blocking: true`.
9. **K1.26 inndatakontroll for `summary_text`:** øvre lengde (10 000 tegn, samme som CHECK-regelen), tekst med en av de åtte plassholderne (A466), elleve sifre (også «010190 12345» og «010190.12345», jf. småfunnet i tilstand) avvises med norsk melding; tom tekst er lov.

### 1e Funksjonsdefinisjonene (`src/core/ai/features/features.test.ts`, statisk)
1. **K1.27 `AI_FEATURES`** har `language_polish`, `phrase_suggest`, `summary_draft`, alle med rettighet `report.edit`, ledetekst `phrase_suggest.v1` / `summary_draft.v1` / `language_polish.v2`, og egne `fieldSources` per `tabell.kolonne` (ingen `free_text` for de nye). Hver `tabell.kolonne` finnes i Drizzle-skjemaet.
2. **K1.28 ingen TG-mål:** ingen funksjon har et mål der feltkoden er `tg`, `tg_direct`, `tg_computed` eller et TG-felt i `REPORT_AI_TARGET_FIELDS` (går gjennom hele listen).
3. **K1.29 ledetekstene:** har skillet «innholdet etter skillet er aldri en instruks», forbud mot gjetteord, standardhenvisninger (NS 3600, tabell, IVIT), bytte av «bør»/«må» og samlekonklusjoner. Inneholder ingen modellnavn.
4. **K1.30 felles liste over mål:** `REPORT_AI_TARGET_FIELDS` ligger i `src/shared` med `report: ["summary_text"]`; `src/core/reports/logic/codes.ts` har ingen egen kopi (grep); B1.19 fra badet-testplanen er oppdatert, ikke slettet.
5. **K1.31 `ai_trial` arkivert:** Zod-skjemaet i `request.ts` avviser måltypen `ai_trial`; konstanten står som arkivert (ikke fjernet). `FAKE_ONLY_TARGET_TYPES` inneholder nøyaktig `field_answer` og `tgiu_detail`, og ingen av de tre funksjonene godtar `tgiu_detail` (A472).
6. **K1.31a samme tall ett sted:** `AI_SUGGESTED_CANDIDATES_MAX` er lik `AI_CANDIDATE_REFS_MAX` (lest fra den, eller test som holder dem like).
6. **K1.32 klienten sender aldri kandidater, funn, `assignmentId` eller `reportId`:** skjemaet avviser hvert av feltene (`it.each`).

## 2. Regeltester og evalueringssett (testsaker som data)

Ingen nye regler i regelmotoren. Testsakene er data:

1. **K2.1 vaktene:** `src/core/ai/guard-cases.ts` (K1.2–K1.4) kjøres både av enhetstestene og av evalueringen. En snudd forventning gjør testen rød.
2. **K2.2 `phrase_suggest.cases.json`:** 30–50 saker, merket «utkast, ikke godkjent av fagrådet», minst 5 med fasit `no_match`; fasiten er et sett av kandidat-id-er; bestått = minst én riktig blant de 3 beste.
3. **K2.3 `summary_draft.cases.json`:** 30–50 saker; måler rekkefølgen TG3, TG2, TGIU, HMS; ingen funn mangler; ingen lagt til; ingen TG i KI-teksten; ingen gjetteord; ingen nye tall; ingen samlekonklusjon («badet er i god stand», «ingen andre avvik»). Egen sak med byttet TG mellom to funn (forventet `stopped`/`tg_guard`), og sak med hulltaking nektet av eier (TGIU, aldri TG2 eller «uten funn»).
4. **K2.4 `language_polish`-settet utvidet:** skrivefeil rettes; tall og enhet, «ikke», sted og «bør»/«må»/«snarest» beholdes; forbehold legges ikke til eller fjernes.
5. **K2.5 skjema for settene** (`evals/schema.test.ts`): nye filer valideres; sak uten merket utkast, uten fasit eller med ukjent kandidat-id avvises.
6. **K2.6 kopisjekken** leser de nye filene: ingen tekst fra `docs/kartlegging/`; gjetteordlisten fra maltesten og «NS 3600»/«IVIT» gir rød test (oppdiktet fixture).
7. **K2.7 `pnpm ai:eval phrase_suggest`, `summary_draft` og uten argument:** består mot falsk leverandør; utskriften sier at resultat mot falsk leverandør ikke viser kvalitet (T-0047); `EvalProviderNotAllowedError` mot ekte leverandør.
8. **K2.3a nye saker (fag):** `summary_draft`: tall flyttet mellom funn (stoppes), graderingsord funnet ikke har (består ikke), ett av tre funn i en gruppe mangler (`coverage_guard`). `language_polish`: «trolig» i inndata står urørt; KI som legger til «antas», består ikke; bortfalt nektelse består ikke (K1.6c).
9. **K2.8 TG kommer bare fra regelmotoren:** statisk test som erstatter «`src/core/reports` importerer ikke `src/core/ai`»: ingen fil i `src/core/reports` skriver `tg`, `tg_direct` eller oppretter avvik med verdi fra et KI-svar (grep etter kall til `requestSuggestion` i filer som også skriver TG), og `src/core/ai` importerer aldri `@/core/reports` eller `@/core/templates` (egen statisk test, arkitekt runde 2, punkt 7).

## 3. Database og migrering (`src/db/schema/*.test.ts`, testdatabasen)

1. **K3.1 nye kolonner:** `reports.summary_text`, `reports.summary_basis`, `ai_usage_log.candidate_refs`, `ai_usage_log.chosen_candidate` finnes, tom tillatt (`information_schema.columns`); `jsonb_typeof` sjekkes (liste / objekt).
2. **K3.2 CHECK for utfall:** `stopped` godtas med `error_code` `tg_guard`, `number_guard`, `coverage_guard` eller `placeholder_guard`; `stopped` uten `error_code` eller med annen kode avvises; `stopped` med `status` satt avvises.
3. **K3.2a CHECK for kandidater og sammendrag:** `candidate_refs` bare når utfallet er `ok`, bare som liste med 1–5 kandidater; en `no_match`-rad har tom `candidate_refs`; `chosen_candidate` krever status `accepted` og må stå i `candidate_refs`; `chosen_candidate` = `{}`, `{"id":"x"}` (uten `source`), ukjent `source` og en liste i stedet for objekt avvises (arkitekt runde 2, punkt 2); `summary_text` over 10 000 tegn og `summary_basis` over 200 funn avvises.
3. **K3.3 indeksen** `(organization_id, feature, target_ref)` for ikke-slettede rader finnes, også predikatet (`pg_indexes`).
4. **K3.4 migreringen** kjører på en database med data fra tidligere migreringer (rapporter, `ai_usage_log`-rader med `ai_trial`) uten feil og uten å endre noen eksisterende rad (sammenlign før og etter). Ingen `DELETE`, `UPDATE` på `ai_usage_log` eller `ON DELETE CASCADE` (grep). Neste ledige nummer (0037 eller senere) og ingen kollisjon med `reklamasjonskobling` (grep i `meta/_journal.json`).
5. **K3.5 gamle `ai_trial`-rader** kan leses av eksisterende oppslag (`getSuggestionStatus`) etter migreringen.
6. **K3.6 `tests/tenant-tables.ts`:** ingen ny tabell; `tenant-isolation-all-tables.test.ts` grønn.

## 4. Integrasjon (testdatabasen)

### 4a Fraseforslag (`src/core/reports/phrase-suggest.test.ts`)
1. **K4.1 vanlig flyt:** avvik med TG2 på `CP.membrane`, «Forslag» på `cause_text` gir 3–5 kandidater fra rapportens låste malversjon, rangert av falsk leverandør, med punkt, utfall, TG og `text_status`. Én loggrad: `feature = phrase_suggest`, `output_text` tom, `candidate_refs` = den viste listen, `input_summary` med bare antall, `report_id` og `assignment_id` utledet av kjernen.
2. **K4.2 færre enn 3 kandidater:** alle som passer vises.
3. **K4.3 0 kandidater:** «Ingen treff», ingen kall til leverandøren (spion på falsk leverandør) og ingen loggrad.
4. **K4.4 falsk leverandør gir `no_match`:** «Ingen treff» vises, raden logges som `no_match`.
5. **K4.5 tomt felt er lov** (test-leder 3): bruker avvikets faste koder; kall og loggrad.
6. **K4.6 låst malversjon:** publiser en ny malversjon med en ny tekst etter at rapporten er startet; teksten er ikke kandidat.
7. **K4.7 KI er av / ekte leverandør:** `phrase_suggest` og `summary_draft` gir «KI er av» med `enableAnthropic` til de står i `settings.features`; `language_polish` følger dagens regel. Ingen kall mot nettet (`tests/no-network.test.ts` grønn).

### 4b Språkvask (`src/core/reports/polish.test.ts` eller i `request-suggestion.test.ts`)
1. **K4.8 «Språkvask avviket» er ett kall:** avvik, årsak, konsekvens og to tiltak med tekst gir ett kall til leverandøren og én loggrad per felt med egen `target_ref` (`deviation`/`deviation_text`, `cause_text`, `consequence_text`, `deviation_measure`/`text`).
2. **K4.9 felt uten tekst tas ikke med:** tomt eller bare mellomrom gir ingen loggrad for feltet; alle tomme gir ingen kall og ingen loggrad (T-0111).
3. **K4.10 beskrivelsen** (`checkpoint_result`/`description_text`) har eget kall og egen rad.
4. **K4.11 stoppet svar:** falsk leverandør gir ny TG / nytt tall: resultatet er `{ kind: "stopped", usageId }`, raden har `outcome = stopped`, `error_code`, tokens og kostnad, `status` tom; teksten finnes ikke i svaret til klienten, ikke i `audit_log`, ikke i loggutskriften (spion på `logger`) og ikke gjennom `getSuggestionStatus`, `client/outcome.ts` eller admins oppslag av én rad (sikkerhet 4). Et avvik der bare konsekvensen stoppes, gir fire brukbare felt og én `stopped`-rad (A460). Et stoppet svar avviser ikke forrige åpne forslag på samme mål.
5. **K4.11a `RequestSuggestionBatch`:** gir avslag uten loggrad og uten kall ved mer enn `AI_BATCH_MAX_REQUESTS` (for eksempel 21 tiltak), annen funksjon enn `language_polish`, samme `requestId` eller samme mål to ganger, og mål fra to ulike rapporter. Feil eller stopp på ett felt stopper ikke de andre.
6. **K4.11b plassholdere (A466):** språkvask og sammendrag med kjent oppdiktet adresse og navn i teksten gir riktig tekst tilbake; leverandøren ser bare plassholdere; `output_text` har plassholderne.

### 4c Sammendrag (`src/core/reports/summary.test.ts`)
1. **K4.12 «Lag utkast»:** gir tekst under kodens overskrifter fra godkjente funn; `reports.summary_text` er uendret etter kallet (overskriver aldri).
2. **K4.13 «Bruk»:** lagrer `summary_text` og `summary_basis` med `row_version`-sjekk; konflikt gir `{ kind: "conflict", currentValue }`. Bare i `draft`: rapport i annen status gir avslag.
3. **K4.14 revisjonslogg:** én rad med feltkoden `summary_text`, uten tekst (sjekk at merket ikke finnes i `audit_log`).
4. **K4.15 ingen godkjente funn:** ingen kall, feilkode som skjermen oversetter til «Ingen avvik med TG ennå».
5. **K4.16 advarsel etter «Bruk»:** endre TG på et funn, legg til et nytt TG2, slett ett mykt; `getRoomView` (eller sammendragets lesing) gir advarselen med de tre funnene. Ingen sperre: `setCheckpointDone` og lagring virker.
6. **K4.17 stoppet utkast:** byttet TG gir `stopped`/`tg_guard`; manglende funn gir `stopped`/`coverage_guard`; `summary_text` uendret.
7. **K4.17a grunnlaget fra nettleseren (A470):** `summary_basis` med ukjent nøkkel, tekst, funn-id fra en annen rapport, `rowVersion` høyere enn dagens eller over `REPORT_SUMMARY_BASIS_MAX` funn avvises; `group` fra nettleseren overstyres av serveren. `usageId` med feil funksjon (`language_polish`) eller `target_ref` til en annen rapport i samme organisasjon gir «ikke funnet» og røres ikke.
8. **K4.17b samme transaksjon (A469):** feiler lagringen (konflikt på `row_version`), står loggraden fortsatt `suggested`; feiler beslutningen, er teksten ikke lagret. Gjelder både `ApplyPhrase` og `SaveSummary`.
9. **K4.17c «N avvik mangler TG og er ikke med.»** (A465) gis med riktig tall ved «Lag utkast»; ingen sperre.

### 4d Kjernen (`src/core/ai/*.test.ts`)
1. **K4.18 oppslag av målet:** for `deviation`, `deviation_measure`, `checkpoint_result` og `report`: riktig id gir kall; id fra annen organisasjon, mykt slettet målrad, mykt slettet rapport, rapport ikke i `draft`, og feltkode som ikke hører til måltypen gir «ikke funnet» / avslag med lik melding (`expectSameRejection`). `report_id`/`assignment_id` sendt fra klienten avvises (K1.32); verdiene i loggen kommer fra oppslaget. Ingen av de tre funksjonene kjører med `assignmentId = null`.
2. **K4.19 `recordDecision` med kandidat:** valgt kandidat som står i `candidate_refs` gir `accepted` og `chosen_candidate`; kandidat som ikke står i listen, kandidat fra annen organisasjons mal og kandidat på en `language_polish`-rad avvises; lukket liste gir `rejected`; ingen `phrase_suggest`-rad blir stående `suggested` etter lukk. Beslutning to ganger gir samme svar som i dag.
3. **K4.20 publiseringssperren:** `checkAiTextApproved` regner ikke `phrase_suggest`-rader som KI-tekst; `language_polish` og `summary_draft` som er `suggested` regnes som ikke godkjent; `stopped` regnes ikke som tekst i rapporten.
4. **K4.21 innsetting av fraseforslag:** valgt tekst lagres via `saveField` med `text_source = template` og malens `text_status`; tiltak legges til som nytt tiltak (likt «+ Standardtiltak»); ingen TG endres på avviket. Målet `deviation` / `new_measure`: oppslaget går til avviket, og et valg lager et nytt tiltak.
5. **K4.21a drift:** feil og tidsavbrudd hos leverandøren gir norsk melding og `error`-rad for alle tre funksjonene; samme `requestId` to ganger gir ikke nytt kall; loggerspionen ser ingen persondata i vanlig flyt.
6. **K4.21b ytelse:** kandidatkilden (med «Mest brukt») og funnene til sammendraget har et fast antall spørringer i et oppdiktet bad med ca. 60 utfall og 60 funn (ingen N+1).

### 4e Persondata (`src/core/ai/no-leak.test.ts`, utvidet)
1. **K4.22 vask av kandidater og funn:** oppdiktede navn, e-post, telefon, adresse og matrikkel (også «0012/34» og med mellomrom, jf. T-0094, T-0044) i avvikstekst, kandidattekst (oppdiktet malversjon), tiltak og TGIU-grunn når aldri leverandøren (spion på falsk leverandør); `redacted_count` stemmer med antall vasket; `findPromptLeaks` gir tomt for hele inndataen.
2. **K4.23 sendes ikke:** romnavn, etasje- og bygningsnavn, «eier informert», bildetekst, interne notater og kostnadsbeløp med unike merker står ikke i det leverandøren får (alle tre funksjonene). `findFieldSourceViolations` er grønn.
3. **K4.24 loggen:** `input_summary` for `phrase_suggest` har bare tall; `candidate_refs` og `chosen_candidate` har bare `{ source, id }` (ingen tekst, Zod-strengt).

## 5. Tilgang per rolle og tenant-isolasjon

### 5a Tilgang (`src/core/reports/ki-access.test.ts`, `it.each` over rolle × funksjon × handling)
Handlinger: be om fraseforslag, språkvask, utkast til sammendrag, `recordDecision`, lagre `summary_text`, lese sammendraget.
1. **K5.1 takstmann** i teamet: alt ja. Utenfor teamet med `access.inspectors_edit_all = true`: alt ja. Med innstillingen av: samme svar som `saveField` gir i dag (testen viser at KI ikke åpner mer enn vanlig redigering).
2. **K5.2 kontor:** leser sammendraget; alle KI-kall og lagring gir avslag uten loggrad.
3. **K5.3 leder** med `report.edit`: alt ja; uten: som kontor.
4. **K5.4 admin stenges aldri ute:** admin uten andre roller, utenfor teamet og med `access.inspectors_edit_all = false`, kan alt (regel 11). Statisk: `report.edit` er i admins rettigheter.
5. **K5.5 nei:** bruker uten ansatt-rad, deaktivert ansatt og ansatt i annen organisasjon gir avslag med lik melding og ingen loggrad.
6. **K5.6 reklamasjonssaker** berøres ikke (eksisterende tester grønne).
7. **K5.7 tilgang bare i `src/core/access`:** ingen rettighetssjekk i `src/app/(ansatt)/oppdrag/[id]/rom/` eller komponentene (grep etter `roles.includes` o.l.; lint grønn).

### 5b Tenant-isolasjon (ett `expectTenantIsolation` per ny spørring)
Hver gir verken rader eller tilgang for organisasjon B, og svaret er «ikke funnet»:
1. **K5.8** kandidatkilden (`listPhraseCandidates` eller tilsvarende).
2. **K5.9** funnene til sammendraget.
3. **K5.10** lesing av `summary_text`/`summary_basis`.
4. **K5.11** lagring av `summary_text` (B kan ikke skrive A sin rapport; A sin rad er uendret).
5. **K5.12** oppslaget av målet i `src/core/ai`, per måltype (4 rader, pluss `deviation` / `new_measure`).
5a. **K5.12a** tellingen for «Mest brukt» (A468): valg i organisasjon B teller aldri for A.
6. **K5.13** `recordDecision` på loggrad fra A med B sin grant.
7. **K5.14** kandidat-id fra B sin malversjon i A sitt valg.
8. **K5.15** serverinngangene for fraseforslag og sammendrag med A sin `requestId`/mål-id fra B.
9. **K5.16** spørringene filtrerer på `grant.organizationId` (statisk grep: ingen `organizationId` fra input i de nye filene).

### 5c Myk sletting
1. **K5.17** mykt slettet avvik, tiltak, punktresultat, utfall og rapport er aldri kandidat, funn eller mål (også `new_measure` på et mykt slettet avvik).
2. **K5.18** ingenting slettes permanent: ingen `delete(` mot `ai_usage_log`, `reports`, `deviations` i de nye filene (grep); `summary_text` tømmes ved å skrive tom tekst, ikke ved sletting av rad.

## 6. Prøvesiden og køen
1. **K6.1** `/prove/ki` gir 404 (e2e og `next-redirects`/rutetest); lenken finnes ikke i menyen.
2. **K6.2** `AI_CLIENT_IMPORTERS` i `eslint-rules/module-boundaries.js` har bare utloggingsknappen; en oppdiktet fixture under `rom/` som importerer `@/core/ai/client` gir lintfeil.
3. **K6.3** køens enhetstester i `src/core/ai/client` er grønne; `fase-2a-ki-ko.spec.ts` og forslagskortets e2e (`fase-2a-forslagsmonster*.spec.ts`) er erstattet eller flyttet til badskjermen, ikke bare slettet (rapporten lister hvilke tester som flyttet hvor).
4. **K6.4** versjon 0.17.0 i `package.json` og i `/api/helse`.

## 7. E2e (`e2e/fase-2a-ki-i-veien.spec.ts`)

Kjøres på PC (1280×800) og iPad Pro-størrelse (1024×1366 stående og 1366×1024 liggende), som prosjektene i `playwright.config.ts`. Innlogging med `chooseCodeLogin`, takstmann `INSPECTOR_EMAIL`, falsk leverandør.

1. **K7.1 fraseforslag:** trykk «Forslag til årsak» → listen rett under feltet (ikke sprettopp), først «Tekstsøk», så byttet én gang til «Sortert av KI»; 3–5 linjer à minst 44×44 px; velg → teksten står i feltet, merket «utkast», «Angre» synlig. **2 trykk** (telles i testen).
2. **K7.2 «Bytt ut teksten»** når feltet har egen tekst; «Angre» setter tilbake og forsvinner når feltet forlates.
3. **K7.3 tiltak:** valg legger til nytt tiltak, eksisterende tiltak er uendret.
4. **K7.4 annen TG:** valg av tekst fra TG3-utfall på TG2-avvik viser advarselen «Se over konsekvens og tiltak …».
5. **K7.5 «Ingen treff»** vises som tekst.
6. **K7.6 språkvask avviket:** ett nettverkskall (`countRequests`), før og etter per felt; «Bruk alle», «Bruk» per felt, «Behold min», «Nytt forslag», angre per felt. Teksten lagres (les tilbake etter ny innlasting). **2 trykk** til hele avviket er vasket.
7. **K7.7 stoppet svar:** oppdiktet inndata som får falsk leverandør til å legge til TG viser «KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret.» i `aria-live` ved feltet; feltet er uendret. Er bare konsekvensen stoppet, kan de fire andre feltene brukes.
8. **K7.8 sammendrag:** seksjonen «Sammendrag for hele rapporten» nederst; uten funn står «Ingen avvik med TG ennå»; med funn gir «Lag utkast» før og etter i forslagskortet, feltet er uendret til «Bruk»; overskriftene i rekkefølgen TG3, TG2, TGIU, HMS.
9. **K7.9 utdatert sammendrag:** etter «Bruk», endre TG på et avvik → «Funnene er endret etter sammendraget. Lag nytt utkast.» med funnet nevnt; TG3-punkt som ikke er nevnt gir advarsel; «Ferdig» virker fortsatt (ingen sperre).
10. **K7.10 uten nett** (`context.setOffline(true)`): «Forslag» viser «Uten KI: treff fra tekstsøk» med treff; ingen kall. Etterpå sjekkes databasen: ingen ny rad i `ai_usage_log`. «Språkvask avviket» og «Lag utkast» er trykkbare og svarer «Trenger nett. Teksten din er lagret.» ved feltet. Synkstatusen er synlig.
11. **K7.11 KI av for organisasjonen:** samme tekstsøk-reserve, ingen loggrad; «Språkvask avviket» og «Lag utkast» gir meldingen om at KI er av.
11a. **K7.11a meldinger:** «for mange funn» og «for lang tekst» vises gjennom serverinngangen og på skjermen; «Mest brukt» vises på riktig kandidat.
12. **K7.12 tastatur på PC:** «/» først i tomt felt og Ctrl+. åpner «Forslag»; «/» midt i tekst skrives som vanlig; piltaster og Enter velger; Escape lukker og gir fokus tilbake til feltet. Snarveiene står i «?»-listen.
13. **K7.13 skjermleser og universell utforming:** tilgjengelige navn («Forslag til avvik (/)» osv.), listen har `role="listbox"`/`option` eller tilsvarende, meldinger i `aria-live`; axe uten brudd på badskjermen med åpen forslagsliste, åpent forslagskort og sammendragsseksjonen.
14. **K7.14 fem kontroller per avvikskort:** telling av KI-kontroller i ett kort er 5 (1 «Språkvask avviket» + 4 «Forslag»).
15. **K7.15 kontor:** ser sammendraget, ser ingen «Forslag», «Språkvask» eller «Lag utkast».
16. **K7.16 `/prove/ki`** gir 404.
17. **K7.17 iPad stående:** listen og forslagskortet holder seg innenfor skjermbredden (ingen vannrett rulling), og knappene er minst 44×44.

## 8. Det rapporten sjekker til slutt
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm ai:eval` grønne.
- Hvert akseptkriterium i kortet har minst ett testnummer over (tabell i rapporten).
- Avslag uten tester for tilgang (5a) eller tenant-isolasjon (5b) gir avvisning.
- T-0046, T-0047 og T-0111 satt til «rettet» med PR-nummeret; T-0035 lukket som foreldet.

## Flyttet fra /prove/ki (23.11.2026)

Testskriveren, etter K6.3 og A487. Prøvesiden og KI-køen på prøvesiden er borte (køen kobles ikke til badskjermen, A441). Det som fortsatt gjelder for forslagskortet, KI-merket, profilen og universell utforming, prøves nå på badskjermen. Hjelperne i `e2e/helpers.ts` som bare disse brukte, er fjernet; nye felles hjelpere: `createSampleBathroom`, `openSampleBathroom`, `addRuleTg3Deviation`, `deviationCardOn`, `bathroomSaveState`.

**Flyttet (hvor nå):**

| Før (`/prove/ki`) | Nå (badskjermen) |
|---|---|
| Forslagsmønsteret 12.1–12.4 (forslaget vises, «Bruk», «Angre», «Behold min tekst», status i loggen) | `e2e/fase-2a-ki-i-veien.spec.ts` K7.6 (per felt, med `Bruk alle` og loggrad per felt) |
| 12.5 «Nytt forslag» avviser det gamle; 12.6 feil fra KI; «ingen forslag» | samme spec, «flyttet fra /prove/ki» 12.5/12.6 (feil og «Ingen endring.» per felt) |
| 12.7 og K8.7 KI av i organisasjonen | K7.11 |
| 12.8 og 12.13 uten nett (var kø) | K7.10 («Trenger nett. Teksten din er lagret.», ingen kall) |
| 12.9 nettet faller midt i et forslag | «flyttet» 12.9 (språkvask holdes igjen, så uten nett) |
| 12.10 dobbelttrykk gir én rad og én linje i `audit_log` | «flyttet» 12.10 |
| 12.11, K8.13 og profilen 5.3 punkt 3 trykkflater | K7.17 (stående iPad) og `fase-2a-byggcon-profil.spec.ts` 5.3 punkt 3 (forslagskortet for sammendraget) |
| 12.12 side om side / over hverandre | «flyttet» 12.12 |
| 12.14 forslaget som tekst, ikke HTML | «flyttet» 12.14 |
| 12.15 kontor uten `report.edit` | K7.15 |
| 12.15, V9.3 og K8.12 admin kommer inn | «flyttet» admin (bare rollen admin, `access.inspectors_edit_all` av) |
| V9.1 telefon og e-post vaskes | «flyttet» V9.1, nå etter A466: loggen har plassholderne, skjermen får verdiene tilbake |
| K8.8 T-0004 (skriver videre etter forslaget) | «flyttet» T-0004 |
| Profilen 4 og 5 (ingen fargeovergang) og 5.5 KI-merket | `fase-2a-byggcon-profil.spec.ts`, forslagskortet for sammendraget på badskjermen |
| Skjermbilde 5 «ki» | `byggcon-profil-skjermbilder.spec.ts`, badskjermen med utkast til sammendrag |
| T-0001 (e) nulltegn til KI | `fase-2a-rett-t0001-synkko.spec.ts` (e), «Språkvask avviket» |

**Fjernet (og hvorfor):**

- `e2e/fase-2a-forslagsmonster-testplan.spec.ts`: samme saker som `fase-2a-forslagsmonster.spec.ts`; det som gjelder, er flyttet over. Den faste linjen («Bruk oppdiktet tekst …») og «Logget: …» fantes bare på prøvesiden.
- `e2e/fase-2a-ki-ko.spec.ts` (K8.1–K8.6, K8.9–K8.11): gjaldt bare KI-køen på prøvesiden (kø uten nett, levering når nettet kommer, IndexedDB, utlogging, delt iPad, to faner). Køen kobles ikke til badskjermen (A441); den er dekket av enhetstestene i `src/core/ai/client` (K6.3).
- 12.1 «den faste linjen» og «Logget: …»-linjen: tekster bare prøvesiden hadde.
- Hjelperne `ensureNoAiInspector`, `logInAsNoAiInspector`, `NO_AI_*`, `aiUsageRowsWithMarker`, `aiRedactedCountsWithMarker`, `aiUsageRowsForTarget`, `auditLinesFor`, `aiQueueEntries`, `AI_QUEUE_*`, `logInAsSecondSampleInspector`, `SAMPLE_SECOND_INSPECTOR_EMAIL`, `logInAsSampleAdminOnly`, `sampleEmployeeId`, `aiUsageRowsById` og `aiUsageRowCountForEmployee`: ingen brukere igjen.
