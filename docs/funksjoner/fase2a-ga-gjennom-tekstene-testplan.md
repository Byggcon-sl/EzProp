# Testplan: Gå gjennom tekstene i badet

- **Oppgavekort:** `docs/funksjoner/fase2a-ga-gjennom-tekstene.md` (A441, A603–A614)
- **Dato:** 25.11.2026 (test-leder, før bygging; bygger på testplanen i kortet, runde 1 med prosjektlederens rettelser)
- **Støtter hovedmål:**
  - **KI i bunnen (hovedsaken):** testene låser at hvert felt går gjennom `src/core/ai` med vask, vakter og egen loggrad, at serveren selv leser tekstene og avgjør `accepted` eller `edited`, og at KI aldri setter TG eller lagrer uten valg.
  - **Færre reklamasjoner:** stoppede felt kan ikke brukes, felt med endret «ikke», «bør» o.l. må velges ett og ett, og TG er uendret etter «Bruk alle».
  - **De ansatte:** e2e teller trykkene (2 pluss merknadene), viser tastaturflyten på PC, panelet på iPad-størrelse, og at ingenting går tapt uten nett.

All testdata er oppdiktet (bad fra `createBathroomFixture` / `startedBathroom`, «Åse Testesen», telefon `12345678`, «Testveien 1», gnr 999). Vitest mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`, og falsk KI-leverandør (`tests/ai.ts`: `enableAi`, `fakeAiProvider`, `fakeErrorInputs`, `allAiRows`). Numrene (GT1.1 osv.) står først i testnavnet, så rapporten kan krysse av. Ingen nye `*-testplan.test.ts`; testene legges i filene for området. Merker som skal være fraværende i loggen, må ikke kunne stå i en uuid eller et tidsstempel (for eksempel «Mxq-merke-ÆØ» eller «77 7 2»).

`AI_BATCH_MAX_REQUESTS` er 23 i dag. Testene leser konstanten, de skriver ikke tallet.

## 1. Enhet, rene funksjoner (uten database)

### 1a Feltutvalget (`src/core/reports/logic/review-fields.test.ts`)
1. **GT1.1 felt som er med:** `deviation` / `deviation_text`, `cause_text`, `consequence_text`; `deviation_measure` / `text`; `checkpoint_result` / `description_text` (`it.each`, faste koder som A350/A356).
2. **GT1.2 felt som aldri er med:** TGIU-feltene (`tgiu_detail`), `field_answer`, `report.summary_text`, og ingen TG-felt (`tg`, `tg_direct`, `tg_computed`). Testen går gjennom `REPORT_AI_TARGET_FIELDS` og viser at utvalget er en delmengde uten TG-felt.
3. **GT1.3 tomt:** `null`, `""`, `"   "`, `"\n\t "` og bare U+00A0 hoppes over (T-0111).
4. **GT1.4 urørt standardtekst (A603):** tekst nøyaktig lik en malens tekst for samme felttype hoppes over (samme svar som `templateTextStatusMatcher`); én bokstav rettet, eller tekst lagt til, er med. Malens tekst for en annen felttype (årsakstekst i konsekvensfeltet) regnes ikke som urørt.
5. **GT1.5 mykt slettet:** avvik, tiltak og punktresultat med `deleted_at` er ikke med; tiltak under et mykt slettet avvik er heller ikke med.
6. **GT1.6 gruppering og rekkefølge:** gruppert per kontrollpunkt i malens rekkefølge; innen punktet beskrivelsen, så avvikene i sin rekkefølge, hvert med avvik, årsak, konsekvens og tiltak. TG følger med til lesing.

### 1b Bolker, tak og faste id-er (`src/core/reports/logic/review-batches.test.ts`)
1. **GT1.7 bolker:** 1 felt gir 1 bolk; `AI_BATCH_MAX_REQUESTS` felt gir 1 bolk; `AI_BATCH_MAX_REQUESTS + 1` gir 2; 120 gir `ceil(120 / AI_BATCH_MAX_REQUESTS)`. Ingen felt mistes eller dobles (summen og settet av mål er likt).
2. **GT1.8 tak (A604):** `ROOM_TEXT_REVIEW_MAX_FIELDS` er 120 og ligger i `src/core/ai/limits.ts`; 120 er lov, 121 gir feilen med teksten «Rommet har for mange tekster til én gjennomgang. Bruk språkvask per avvik.».
3. **GT1.9 forespørsels-id (A608):** samme `reviewId` og samme mål gir samme id; annen `reviewId`, annen rad eller annen feltkode gir ulik id. Id-en er gyldig etter kjernens Zod.

### 1c Ordmarkering og merknad (`src/shared/.../word-diff.test.ts`)
1. **GT1.10 sammenligning ord for ord:** like tekster gir ingen endring; tom før gir alt «lagt til»; tom etter gir alt «fjernet»; æøå, store bokstaver og tegnsetting («fuktskade,» mot «fuktskade.»); ord som flyttes gir fjernet og lagt til.
2. **GT1.11 uten endring (A609):** bare mellomrom eller linjeskift endret gir «uten endring».
3. **GT1.12 merknad (A610), `it.each` over «ikke», «ingen», «uten», «bør», «må», «kan»:** fjernet, lagt til og byttet («bør» → «må») gir merknad med ordet, for eksempel «Sjekk: «ikke» er fjernet». Ordet med stor forbokstav regnes likt. Ordet som del av et annet ord («kanal», «ikkje» i navn, «uteliggende») gir ikke merknad. Endringer i andre ord gir ikke merknad.
4. **GT1.13 skjermleser:** hvert fjernet og lagt til ledd har tekst «fjernet» / «lagt til» i utdata, ikke bare et stilmerke.
5. **GT1.14 ytelse:** to tekster på 4000 tegn sammenlignes innen 50 ms (CI-margin), uten unntak.
6. **GT1.15 ingen avhengighet:** statisk test: filen importerer ingen pakke utenfra og ikke `server-only` eller `@/db`.

### 1d Utvalget for «Bruk alle» og telleren (panelets logikk, ren funksjon)
1. **GT1.16 «Bruk alle uten merknad (N)»:** N teller bare felt med reell endring, uten merknad og uten valg. Ikke med: `stopped`, `no_match`, `ai_error`, `ai_off`, felt med merknad, felt uten endring, felt som er avgjort.
2. **GT1.17 telleren «Brukt X · Beholdt Y · Igjen Z»:** «Allerede i orden» og stoppede felt telles ikke i «Igjen»; angre flytter feltet tilbake til «Igjen».
3. **GT1.18 neste felt (A611):** etter et valg er neste felt det første ikke avgjorte etter dette i rekkefølgen; finnes ingen etter, det første før; finnes ingen, «Alle tekster er gjennomgått».
4. **GT1.19 knappeteksten (A614):** «Gå gjennom tekstene · 4 nye», «Fortsett gjennomgangen (6 igjen)», «Alle tekster gjennomgått» ut fra tallene fra serveren (`it.each`).

### 1e Snarveier (`src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/shortcuts.test.ts`)
1. **GT1.20** B, H, R, U står i `SHORTCUT_LIST` med norsk forklaring; de virker bare når fokus står på et felt i panelet; i `textarea`, `input` og `contenteditable` gjør de ingenting; med Ctrl, Alt eller Meta gjør de ingenting. Eksisterende snarveier er uendret (A383 gjelder fortsatt for TG- og regelforslag).

### 1f Inndata (`src/core/reports/schemas.test.ts`)
1. **GT1.21 `reviewRoomTexts`:** bare `roomId` og `reviewId` (uuid); ukjent nøkkel, tekst, målliste, `assignmentId`, `reportId` og `organizationId` avvises (`it.each`).
2. **GT1.22 `applyReviewedTexts`:** `choice` bare `use`, `edit`, `keep`, `undo`; `text` kreves for `edit` og avvises for de andre; `rowVersion` er et heltall ≥ 0; mer enn `ROOM_TEXT_REVIEW_MAX_FIELDS` valg avvises; tom liste avvises; `target`, `table`, `field`, `decision` og `accepted` fra nettleseren avvises (ukjent nøkkel).

## 2. Regeltester og evalueringssett (testsaker som data)

Ingen nye fagregler og ingen nye vakter. Testsakene er data:

1. **GT2.1 skjemaet** (`src/core/ai/evals/schema.test.ts`): valgfritt felt `group` for `language_polish`; `room_review` godtas; ukjent gruppe avvises; saker uten gruppe er gyldige som før.
2. **GT2.2 flerfeltssakene** i `language_polish.cases.json`, minst seks med `group: "room_review"`, merket «utkast, ikke godkjent av fagrådet»: (a) avvik med fire felt og tiltak; (b) «ikke påvist» som skal stå; (c) tall og enhet som skal stå; (d) forbehold som skal stå; (e) KI legger til et tall og stoppes av tallvakten (`number_guard`); (f) «bør» → «må», kjent sak uten vakt (`expected: null`), knyttet til spørsmål 103.
3. **GT2.3 telling:** `pnpm ai:eval language_polish` viser `room_review` for seg; sak (f) telles aldri som bestått (test i `run.test.ts` med en oppdiktet fil der en kjent sak uten vakt «består» på tekst, og rapporten likevel ikke teller den).
4. **GT2.4 grønn mot falsk leverandør:** `language-polish.eval.test.ts` kjører hele settet; utskriften sier at resultat mot falsk leverandør ikke viser kvalitet (T-0047).
5. **GT2.5 kopisjekken** leser de nye sakene: ingen tekst fra `docs/kartlegging/`, ingen «NS 3600»/«IVIT», ingen gjetteord i fasiten.
6. **GT2.6 vaktene per felt:** de eksisterende tabellene i `guard-cases.ts` er uendret og grønne; ingen ny vakt er lagt til (statisk: listen over vaktkoder er den samme).

## 3. Integrasjon mot testdatabasen, med falsk leverandør

### 3a `reviewRoomTexts` (`src/core/reports/review-texts.test.ts`)
**Tilgang (alltid med):**
1. **GT3.1 roller (`it.each`):** takstmann ok; kontor nektes; leder med `report.edit` ok og uten nektes; admin ok. Nektet gir null leverandørkall og null nye rader i `ai_usage_log`.
2. **GT3.2 `access.inspectors_edit_all`:** PÅ: takstmann som ikke er på oppdraget, ok. AV: samme takstmann nektes, takstmann på oppdraget ok (dagens regel for `report.edit`).
3. **GT3.3 admin stenges aldri ute (regel 11):** ansatt med bare rollen admin, innstillingen AV, ikke på oppdraget: ok.
4. **GT3.4 reklamasjonssak:** oppdrag med åpen sak (`createClaim`): rapporten følger dagens `report.edit`-regel (leder og admin ok; takstmann etter innstillingen), og saken er byte for byte uendret etter kallet.
5. **GT3.5 tenant-isolasjon:** `expectTenantIsolation` på `reviewRoomTexts`: rom fra annen organisasjon gir «ikke funnet» (samme feil som et rom som ikke finnes), null kall, null loggrader. Admin i annen organisasjon får heller ikke tilgang.
6. **GT3.6 publisert:** rapport som ikke er `draft` gir «Rapporten er publisert. Lag ny versjon for å endre.», null kall.

**Innhold og logg:**
7. **GT3.7 én loggrad per felt:** bad med to punkter, tre avvik (ett med alle fire felt og to tiltak) og en beskrivelse: antall rader = antall felt med innhold, hver med `feature = language_polish` og riktig `target_ref` (type, id, feltkode). Svaret er gruppert per punkt i malens rekkefølge med TG.
8. **GT3.8 hoppes over, ingen loggrad:** tomt felt, bare mellomrom, urørt standardtekst, mykt slettet avvik, tiltak og punktresultat, TGIU-felt, `field_answer` og sammendraget.
9. **GT3.9 tekstene leses fra databasen:** teksten som sendes til leverandøren er den lagrede (fang leverandørkallet); en tekst som bare finnes i klienten kan ikke sendes (inngangen tar ikke tekst, jf. GT1.21).
10. **GT3.10 vaktene per felt:** falsk leverandør gir ny TG i ett felt og nytt tall i et annet: de feltene får `stopped` med `tg_guard` / `number_guard` og grunn, resten `suggestion`. Ingen `output_text` for stoppede felt i svaret.
11. **GT3.11 KI-feil i ett felt:** `fakeErrorInputs` i ett felt gir `ai_error` der, og de andre får forslag.
12. **GT3.12 uten endring:** leverandøren gir samme tekst eller bare endret mellomrom: status `unchanged`; ingen beslutning lagres.
13. **GT3.13 `no_match` og KI av:** `fakeNoMatchInput` i ett felt gir `no_match` der og forslag i de andre. KI av (`enableAi` av, og blokkert funksjon) gir `ai_off` for alle felt, ingen tekst endret, null leverandørkall.
14. **GT3.14 tak:** 121 felt med innhold gir meldingen, null kall, null loggrader. 120 felt gir `ceil(120 / AI_BATCH_MAX_REQUESTS)` kall til `requestSuggestionBatch` (spion).
15. **GT3.15 ingen persondata:** felt med oppdiktet navn, telefon, e-post, adresse og matrikkel: leverandørkallet og `ai_usage_log` har plassholderne; svaret til klienten har verdiene tilbake.
16. **GT3.16 gjenbruk (A608):** andre kall med ny `reviewId` og uendrede felt gir samme `usageId`-er og null nye leverandørkall. Et felt endret etter forrige gjennomgang (`updated_at` nyere enn radens `created_at`) sendes på nytt; bare det.
17. **GT3.17 samme `reviewId` to ganger (dobbelttrykk, også samtidig med `Promise.all`):** ingen nye rader, ingen nye kall.
18. **GT3.18 gjenbruk på tvers stenges:** åpen `language_polish`-rad for samme rad-id, men i et annet rom, en annen rapport eller en annen organisasjon, gjenbrukes aldri; rad som er avgjort, mykt slettet eller har annen funksjon (`phrase_suggest`, `summary_draft`) gjenbrukes aldri.
19. **GT3.19 antall på knappen (A614):** funksjonen som teller nye, endrede og åpne felt gir riktige tall før, under og etter en gjennomgang, uten leverandørkall; og den filtrerer på `grant.organizationId` (`expectTenantIsolation`).

### 3b `applyReviewedTexts` (`src/core/reports/review-texts.test.ts`)
**Tilgang (alltid med):**
1. **GT3.20 roller og innstilling:** som GT3.1–GT3.4 (kontor nektes, admin ok med bare rollen admin, PÅ og AV, reklamasjonssak). Nektet gir ingen endret tekst og ingen beslutning.
2. **GT3.21 tenant-isolasjon:** `expectTenantIsolation` med `usageId` fra annen organisasjon: «ikke funnet», ingenting lagret, og den andre organisasjonens rad og tekst er uendret.

**Valg og kontroll:**
3. **GT3.22 `use`:** lagrer nøyaktig forslaget med plassholderne byttet tilbake på serveren; beslutningen er `accepted`; tekst og beslutning i samme transaksjon; `row_version` økt én gang per rad.
4. **GT3.23 `edit`:** tekst lik forslaget (etter tilbakebytte) gir `accepted`; annen tekst gir `edited`. En fremmed tekst kan aldri føres som `accepted`.
5. **GT3.24 `edit` inndatakontroll:** for lang tekst, tekst med en plassholder og elleve sifre («010190 12345») avvises med samme melding som `saveField`; ingenting lagret.
6. **GT3.25 `keep`:** teksten uendret, beslutning `rejected`, `retain_until` etter `ai.rejected_retention_years`.
7. **GT3.26 `undo`:** etter `use` og `edit` setter teksten tilbake og flytter beslutningen etter tilstandsmaskinen i `record-decision.ts`; `undo` på `suggested` eller `rejected` avvises.
8. **GT3.27 angre hele bolken (A612):** én liste med `undo` for alle feltene fra «Bruk alle» lagres i én transaksjon.
9. **GT3.28 avslag for hele listen (`it.each`):** dobbel `usageId`; alt avgjort `usageId` (unntatt `undo`); rad med `stopped`, `no_match`, sperret, `ai_error`; annen funksjon (`summary_draft`, `phrase_suggest`); annet rom; annen rapport (A470); mykt slettet loggrad; mykt slettet mål. Etter avslag: ingen tekst og ingen beslutning endret i noen av feltene i listen, null leverandørkall.
10. **GT3.29 «Rett før bruk» på stoppet felt:** `edit` på en `stopped`-rad avvises.
11. **GT3.30 `rowVersion` (A605):** ett felt endret av andre etter gjennomgangen hoppes over og står i svaret; de andre lagres. Avvik, årsak og konsekvens på samme avviksrad i samme liste lagres alle tre.
12. **GT3.31 én transaksjon:** tvunget feil midt i listen (feil i skriving av felt nummer to) gir ingen delvis lagring av tekst eller beslutning.
13. **GT3.32 publisert i mellomtiden:** rapporten publiseres mellom `reviewRoomTexts` og `applyReviewedTexts`: hele listen avvises med publisert-meldingen, ingen tekst og ingen beslutning lagret.
14. **GT3.33 TG uendret:** TG (`tg`, `tg_direct`, valgt TG på avvik) i `checkpoint_results` og `deviations` er lik før og etter «Bruk alle» og etter angre.
15. **GT3.34 revisjonslogg:** én linje per beslutning, uten tekst.

### 3c Publiseringssjekken (`src/core/reports/signals.test.ts` eller `publish.test.ts`)
1. **GT3.35 `pendingAiSuggestionsOf`:** to åpne forslag for samme felt telles som ett (det nyeste); forslag lik teksten i feltet (mellomrom regnes ikke) telles ikke; «Allerede i orden» telles ikke. Ingen forslag avvises på vegne av takstmannen (ingen beslutning skrevet av sjekken).

### 3d Logging og grenser
1. **GT3.36 `src/core/reports/logging.test.ts`:** begge inngangene, også ved feil og avslag: ingen før- eller ettertekst (merket «Mxq-merke-ÆØ») i loggeren, feilmeldingene eller `audit_log`; bare id-er, feltkoder og antall.
2. **GT3.37 modulgrenser:** statisk: `src/core/ai` importerer ikke `@/core/reports`; ingen fil i `src/core/reports` skriver TG fra et KI-svar (eksisterende K2.8 grønn med de nye filene).
3. **GT3.38 ingen ny tabell:** `tests/tenant-isolation-all-tables.test.ts` grønn med `tests/tenant-tables.ts` uendret; ingen ny migrering.

## 4. E2e (Playwright, prosjektene `pc` og `ipad`)

Fil: `e2e/fase-2a-ga-gjennom-tekstene.spec.ts`. Falsk KI-leverandør, oppdiktet bad. Kall til serveren telles med `countRequests`; loggrader leses fra testdatabasen.

1. **GT4.1 hovedflyten (pc og ipad):** «Gå gjennom tekstene» → «Går gjennom N tekster …» (`aria-live`) → panelet med grupper per kontrollpunkt, TG til lesing og «Vis i badet» (ruller til avvikskortet og markerer det); ordmarkering synlig, med skjult tekst «fjernet»/«lagt til»; «Allerede i orden (N)» lukket.
2. **GT4.2 valgene:** «Bruk alle uten merknad» bruker ikke feltet med merknad og ikke det stoppede feltet; ett felt «Behold»; feltet med merknad «Bruk» for seg; det stoppede feltet viser grunnen og har ingen «Bruk». Tekstene på badskjermen og i databasen er som valgt; TG uendret.
3. **GT4.3 «Rett før bruk»:** tekstfeltet åpnes i panelet, markeringen oppdateres mens det skrives, lagring gir `edited`.
4. **GT4.4 angre:** per felt etter «Bruk», og «Angre» i bekreftelsen etter «Bruk alle» setter alle tekstene tilbake.
5. **GT4.5 trykktelling:** fra knappen til ferdig: 2 trykk pluss ett per felt med merknad; «Alle tekster er gjennomgått» med «Lag PDF (utkast)» og publiseringssjekken.
6. **GT4.6 lukk og åpne, ny lasting:** samme liste, null nye KI-kall (ingen nye loggrader); etter ny lasting viser knappen «Fortsett gjennomgangen (N igjen)».
7. **GT4.7 antall på knappen:** etter en rettet tekst «· 1 nye»; etter alt avgjort «Alle tekster gjennomgått».
8. **GT4.8 tastatur (pc):** Tab og Enter; B, H, R, U på feltet med fokus; i tekstfeltet skriver B bare bokstaven; fokus går til neste ikke avgjorte felt og `aria-live` sier hvilket; Esc lukker og fokus går tilbake til knappen; snarveiene står i «?»-listen.
9. **GT4.9 iPad-størrelse (ipad, liggende 1194 × 834 og stående 834 × 1194 med `setViewportSize`):** panelet over hele bredden med «Lukk» øverst; ingen vannrett rulling; alle knapper minst 44 × 44; «Bruk alle uten merknad» minst 56 høy og fast nederst, synlig uten rulling; trykk (`tap`) virker. På pc står panelet til høyre med avvikslisten synlig.
10. **GT4.10 universell utforming:** axe uten alvorlige eller kritiske funn med panelet åpent, på pc og ipad; panelet har navn og rolle; markeringen leses uten farge.
11. **GT4.11 uten nett (`context.setOffline(true)`, pc og ipad):** knappen er trykkbar og svarer «Trenger nett. Tekstene dine er lagret.» ved knappen; null kall til serveren, null nye loggrader, ingenting lagt i lagringskøen for KI.
12. **GT4.12 mister nett med listen åpen:** valgene står som «Ikke lagret ennå – trenger nett»; ingenting sendt; etter `setOffline(false)` lagrer «Lagre valgene» alt med ett trykk; tekstene i databasen er som valgt.
13. **GT4.13 KI av:** «KI er slått av. Tekstene dine er uendret.»; ingen tekst endret.
14. **GT4.14 publisert rapport:** knappen vises ikke. **GT4.15 innlogget som kontor:** knappen vises ikke. **GT4.16 admin med bare rollen admin og innstillingen AV:** knappen vises og gjennomgangen virker.
15. **GT4.17 forslaget vises som tekst:** et KI-svar med `<b>` vises som tegn, aldri som HTML.
16. **GT4.18 lagringskøen tømmes først:** tekst skrevet like før trykket er den som vises som «før» i panelet.

## 5. Til slutt (test-leder)
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` og `pnpm ai:eval language_polish` grønne.
- Testene fra `testskriver` leses: tilgang (GT3.1–GT3.4, GT3.20) og tenant-isolasjon (GT3.5, GT3.19, GT3.21) skal finnes for begge inngangene, ellers avvises leveransen.
- Ingen nye avhengigheter, ingen migrering, versjonen i `package.json` er økt.
- Rapporten krysser av hvert akseptkriterium i kortet mot numrene her.

| Akseptkriterium i kortet | Tester |
|---|---|
| Liste per punkt, tomme/urørte/slettede ikke med | GT1.1–GT1.6, GT3.7, GT3.8, GT4.1 |
| Loggrad per felt, stoppet felt, KI-feil | GT3.7, GT3.10, GT3.11, GT4.2 |
| Gjenbruk uten nye kall, aldri på tvers | GT1.9, GT3.16–GT3.18, GT4.6 |
| «Allerede i orden» | GT1.11, GT3.12, GT3.35, GT4.1 |
| Valgene, server avgjør, samme transaksjon | GT3.22–GT3.27, GT4.2–GT4.4 |
| Avslag i `applyReviewedTexts` | GT1.22, GT3.28, GT3.29 |
| Endret felt overskrives ikke | GT3.30 |
| Publisert i mellomtiden | GT3.32 |
| Merknad og «Bruk alle» | GT1.12, GT1.16, GT4.2 |
| Ordmarkering for skjermleser | GT1.13, GT4.1, GT4.10 |
| KI endrer aldri TG | GT1.2, GT3.10, GT3.33, GT3.37 |
| Fokus og snarveier | GT1.18, GT1.20, GT4.8 |
| Antall på knappen | GT1.19, GT3.19, GT4.7 |
| Publisert: ingen knapp, avvist | GT3.6, GT3.32, GT4.14 |
| Over 120 felt | GT1.8, GT3.14 |
| Uten nett | GT4.11, GT4.12 |
| KI av | GT3.13, GT4.13 |
| Annen organisasjon | GT3.5, GT3.21 |
| Roller, innstilling, reklamasjonssak, admin | GT3.1–GT3.4, GT3.20, GT4.14–GT4.16 |
| Ingen tekst i logg | GT3.36 |
| Evalueringssettet | GT2.1–GT2.6 |
| E2e PC og iPad | GT4.1–GT4.18 |
| Ingen nye avhengigheter, versjon | avsnitt 5 |
