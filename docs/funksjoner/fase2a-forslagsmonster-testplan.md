# Testplan: Forslagsmønsteret

- **Oppgavekort:** `docs/funksjoner/fase2a-forslagsmonster.md`
- **Grunnlag:** `docs/adr/0006-ki-i-bunnen.md`, testplanen for KI-modulen (`fase2a-ki-modul-logg-testplan.md`), A162, A164, A166–A168
- **Dato:** 10.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** e2e viser at takstmannen ser forslaget, velger med ett trykk, kan angre, og aldri mister sin egen tekst (heller ikke uten nett), på PC og iPad.
  - **KI i bunnen:** testene låser det ene forslagskortet og de tre tjenestene (`getSuggestionStatus`, `checkAiTextApproved`, rekkefølgen i `recordDecision`) som alle KI-funksjoner i 2a-2 bygger på.
  - **Færre reklamasjoner:** sperren slipper bare gjennom KI-tekst som er godkjent for akkurat det feltet (ad-6), og ingen organisasjon kan se eller avgjøre en annens forslag.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet (for eksempel «Taket er gammelt og har noen sprekker»). Ingen navn, adresser, e-post, telefon eller nøkler. Fast tid med `vi.useFakeTimers({ toFake: ["Date"] })` og `TEST_NOW`.

Ingen fagregler og ingen TG. «Regeltestene» er tabellene med testsaker (`it.each`): hva sperren godkjenner (avsnitt 4), hvilke knapper og tekster kortet viser per tilstand (avsnitt 7) og måltypene per leverandør (avsnitt 2).

## 0. Avtale om signaturer (utvikler og testskriver)

Avvik føres i kortet før testene skrives.

- `@/core/ai` eksporterer i tillegg: `getSuggestionStatus(grant, usageId)` → `{ status, outcome } | null` (eller nøytral `AiRequestRejectedError`; utvikler velger én og skriver det i kortet; testene sjekker at alle «ikke-finnes»-tilfellene gir **nøyaktig samme** svar) og `checkAiTextApproved(grant, items)` → `{ aiUsageId, target }[]` (de som ikke er godkjent). Konstant for taket, for eksempel `AI_APPROVAL_CHECK_MAX = 500`.
- `AI_FEATURES.language_polish.allowedTargets` = `[{ type: "answer", fieldKey: "text" }, { type: "ai_trial", fieldKey: "text" }]`.
- Forslagskortet `AiSuggestion` (`src/shared/ui/ai-suggestion.tsx`) får all tilstand som props (egen tekst, forslag, status lest fra serveren, utfall, `pending`, `online`, `aiEnabled`, `hasNewerSuggestion`) og handlingene som funksjoner. Merket `AiTextMark` (`src/shared/ui/ai-text-mark.tsx`) får `aiUsageId` og `status` fra serveren. Hvis knappene styres av en ren hjelpefunksjon (for eksempel `suggestionView(state)`), testes den i tillegg.
- Serverhandlingene ligger i `src/app/(ansatt)/prove/ki/actions.ts` og testes med samme mønster som `src/app/(ansatt)/employee-context.test.ts` (bare `@/core/auth/session` mockes).
- Ingen nye fabrikker trengs: `createAiUsageLog`, `createIntegrationConnection`, `createEmployee`, `grantPermission` og `enableAi` (testhjelperen fra KI-modulen) brukes.

## 1. Funksjonsdefinisjonen, `src/core/ai/features/features.test.ts` (endres)

1. **2.1 skrives om bevisst** (kortet, «Data»): `language_polish` har nøyaktig to lovlige mål, `answer/text` og `ai_trial/text`, skrevet inn i testen. Resten av 2.1 (rettighet, ledetekstversjon, én feltkode) uendret.
2. 2.2–2.5 (faste koder, ingen TG, sperrelisten, ledeteksten) er uendret og grønne.

## 2. Vakten for `ai_trial`, `src/core/ai/trial-target.test.ts` (ny, mot databasen, regeltest)

Tabell (`it.each`) med leverandør × mål → forventet:

1. **`fake` + `ai_trial/text`** → `outcome = ok`, én rad med `target_ref = { type: "ai_trial", id, fieldKey: "text" }`, `status = suggested`.
2. **annen leverandørkode på porten `ai`** (rå rad via `createIntegrationConnection`, for eksempel `anthropic`) + `ai_trial` → svaret «KI er av», **ingen rad** i `ai_usage_log`, `fakeAiProvider.complete` ikke kalt (spion), og `globalThis.fetch` ikke kalt (`tests/fake-fetch.ts`).
3. **ingen tilkobling** + `ai_trial` → «KI er av», ingen rad.
4. **`ai.enabled = false`** + `fake` + `ai_trial` → «KI er av», ingen rad.
5. **`ai_trial` med annet felt** (`fieldKey: "title"`, `"tg"`) → nøytralt avslag (`AiRequestRejectedError`), ingen rad.
6. **`answer/text` med `fake`** virker fortsatt (ingen regresjon).
7. **vakten ligger i kjernen:** samme forespørsel direkte mot `requestSuggestion` (uten siden) gir samme avslag som i 2.
8. **tenant:** org A har `fake`, org B har annen leverandør; B sin takstmann med `ai_trial` får «KI er av», og A sin tilkobling brukes aldri.

## 3. `getSuggestionStatus`, `src/core/ai/suggestion-status.test.ts` (ny, mot databasen)

1. **riktig status og utfall** for `suggested`, `accepted`, `rejected`, `edited`, og for `no_match` og `error` (status tom).
2. **returnerer bare status og utfall:** nøklene i svaret er nøyaktig `["outcome", "status"]` (sortert). `JSON.stringify(svar)` inneholder verken en unik markør satt i `output_text`, `employee_id` eller `decided_by`.
3. **nøytralt svar** (`it.each`), alle gir nøyaktig samme svar (samme verdi eller samme feilklasse og melding): id finnes ikke, rad i annen organisasjon, mykt slettet rad, ugyldig uuid (`"abc"`, `""`, uuid med ekstra tegn), og takstmann uten `report.edit` når raden finnes. Ugyldig uuid gir ikke databasefeil.
4. **ikke eierskapsfilter (A162):** takstmann B i samme organisasjon ser status på forslaget takstmann A ba om.
5. **ett forslag per kall:** funksjonen tar én id; ingen eksport som lister eller teller (sjekkes i avsnitt 8).
6. **tilgang** per rolle, se avsnitt 6.
7. **`expectTenantIsolation`** for spørringen (avsnitt 5).

## 4. Publiseringssperren `checkAiTextApproved`, `src/core/ai/approval-check.test.ts` (ny, mot databasen, regeltest)

Tabell (`it.each`) med én rad per tilfelle; hvert element sendes inn med sitt `target`, og forventet er «godkjent» (ikke i svaret) eller «stoppet» (i svaret med samme `target`):

1. `accepted`, `outcome = ok`, samme mål → **godkjent**.
2. `edited`, `outcome = ok`, samme mål → **godkjent**.
3. `suggested` → stoppet.
4. `rejected` → stoppet.
5. `outcome = no_match` → stoppet.
6. `outcome = error` → stoppet.
7. mykt slettet rad (`accepted`) → stoppet.
8. rad i annen organisasjon (`accepted`) → stoppet.
9. **ad-6:** samme type og id, **annet felt** → stoppet.
10. **ad-6:** samme type og felt, **annen id** → stoppet.
11. **ad-6:** samme id og felt, **annen type** (`answer` mot `ai_trial`) → stoppet.
12. mål som ikke står i `allowedTargets` (rad satt inn rått med `target_ref = { type: "report", fieldKey: "summary" }`, sendt inn med samme mål) → stoppet.
13. ugyldig uuid som `aiUsageId` → stoppet, ikke unntak.
14. ukjent id (gyldig uuid) → stoppet.
15. **id med store bokstaver** i `target.id` mot rad med små → godkjent (normalisert som `sameTarget`). Samme for `aiUsageId` med store bokstaver, hvis utvikler normaliserer den; ellers stoppet, og det står i kortet.

Uten tabell:

16. **tom liste** → tom liste, og ingen spørring mot databasen.
17. **samme id to ganger** (begge godkjent) → tom liste; samme id to ganger med ulikt felt → bare elementet med feil felt i svaret.
18. **blandet liste** (2 godkjent, 3 stoppet i tilfeldig rekkefølge) → nøyaktig de 3, hver med sin `target`.
19. **taket:** 500 elementer godtas; 501 gir avslag (feil), ingen delvis svar.
20. **ett oppslag for hele listen:** med 50 elementer kalles databasen én gang (`vi.spyOn(db, "select")` eller `db.execute`, det utvikler bruker; spion på objektet `db`, ikke på modulen). Testen sjekker at spionen faktisk ble kalt, så den ikke blir hul.
21. **leser aldri `output_text`:** svaret inneholder ikke markøren fra `output_text`; og den statiske sjekken i avsnitt 8.
22. **svaret skiller ikke grunner:** elementene i svaret har bare `aiUsageId` og `target`, ingen `reason`.
23. **uten `report.edit`** → `AccessDeniedError`, uansett innhold i listen (også tom liste).
24. **`expectTenantIsolation`** for spørringen (avsnitt 5).

## 5. Tenant-isolasjon, ett `expectTenantIsolation` per ny spørring

Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke, og `tests/tenant-isolation-all-tables.test.ts` skal være grønn uendret.

1. **`getSuggestionStatus`** (i `suggestion-status.test.ts`): B sin admin og takstmann får nøytralt svar for A sin rad, og A sin rad er uendret.
2. **`checkAiTextApproved`** (i `approval-check.test.ts`): A sin godkjente rad sendt inn av B kommer tilbake som stoppet.
3. **`recordDecision` med ny rekkefølge** (i `record-decision-order.test.ts`): B med KI-rettighet får `AiRequestRejectedError` for A sin rad; raden og `audit_log` i A uendret.
4. **serverhandlingene** (i `actions.test.ts`): `organizationId` i inndata fra klienten satt til A, økten i B → raden havner i B (eller avslag), aldri i A.
5. **`ensureSampleAi`**: rører bare organisasjonen med `sampleData` (avsnitt 9).

## 6. Tilgang per rolle

Fasit skrevet inn i testen, ikke regnet ut fra koden. Gjelder `getSuggestionStatus`, `checkAiTextApproved`, `recordDecision` og serverhandlingene (`requestSuggestion`-handlingen og avgjør-handlingen):

| Ansatt | Forventet |
|---|---|
| takstmann (`access.inspectors_edit_all` på) | lov |
| takstmann med innstillingen av (mister `report.edit`) | avslag |
| kontor (uten `report.edit`) | avslag |
| kontor med `report.edit` gitt (`grantPermission`) | lov |
| leder | lov |
| admin med bare rollen admin | lov (stenges aldri ute) |
| admin med innstillingen av | lov |
| deaktivert eller mykt slettet ansatt | avslag |
| ansatt i annen organisasjon | nøytralt avslag |

Tester:

1. Tabellen over (`it.each`) for hver av de fire tjenestene. Filer: `src/core/ai/access.test.ts` (utvides) og `src/app/(ansatt)/prove/ki/actions.test.ts`.
2. **Admin stenges aldri ute:** admin uten noen tildelte enkeltrettigheter kan be om forslag, avgjøre, angre, se status og kjøre sperren.

## 7. `recordDecision`, ny rekkefølge, `src/core/ai/record-decision-order.test.ts` (ny, mot databasen)

1. **uten noen KI-rettighet** (kontor uten `report.edit`): `AccessDeniedError` for rad som finnes, ukjent id, rad i annen organisasjon og ugyldig uuid. Samme feil i alle fire viser at raden ikke er lest først.
2. **med KI-rettighet, men ikke for funksjonen på raden:** rad satt inn rått med en oppdiktet funksjonskode som krever en annen rettighet, eller `vi.spyOn` på `getFeatureDefinition` som gir `report.publish` for testen. Takstmann med `report.edit` men uten den rettigheten får `AiRequestRejectedError` med **samme melding** som for ukjent id, annen organisasjon og mykt slettet rad (`it.each` over de fire).
3. **ved avslag** (1 og 2): raden er helt uendret (`status`, `decided_by`, `decided_at`, `row_version`), og ingen ny linje i `audit_log`.
4. **admin** kan alltid avgjøre og angre.
5. 7.1–7.11 i `record-decision.test.ts` er fortsatt grønne uendret.

## 8. Statiske kontroller, `src/core/ai/static-checks.test.ts` og `src/shared/ui` (utvides)

1. `src/shared/ui/ai-suggestion.tsx` og `src/shared/ui/ai-text-mark.tsx` finnes og importerer ikke `@/core/access`, `@/db` eller `@/core/ai` (relative stier som peker dit gir også rød).
2. Ingen fil i `src/app/(ansatt)/prove/ki/**` importerer fra `src/core/ai/providers` eller nevner portene `ai`/`speech_to_text` (bare `@/core/ai`).
3. Filene for statusoppslaget og sperren nevner ikke `outputText` eller `output_text`.
4. `@/core/ai` eksporterer ingen funksjon som lister eller teller forslag per ansatt (navn som `list*`, `count*`; spørsmål 57).
5. `ai_trial` står bare i `features.ts`, prøvesiden og testene (ikke i andre moduler).
6. Lint-regelen for modulgrenser og produktnavn er grønn (`pnpm lint`).

## 9. `ensureSampleAi`, `src/db/seed/sample-assignments.test.ts` (utvides)

1. **kalt direkte** for en organisasjon uten `sampleData` (nøkkelen mangler, `false`, strengen `"true"`): `settings` uendret (også `updated_at`), og ingen rad på porten `ai`.
2. **kalt direkte** for prøveorganisasjonen: `ai.enabled = true` og én `fake`-tilkobling.
3. **to kall** gir samme resultat (samme `settings`, én tilkobling, samme `row_version`), andre gang `{ setting: "existing", connection: "existing" }`.
4. **sjekken i samme spørring:** `sampleData` fjernes fra organisasjonen rett før kallet (etter at konteksten er laget); kallet endrer ingenting og lager ingen tilkobling.
5. Byggcon rørt av `pnpm db:seed`: fortsatt verken `ai.enabled` eller tilkobling (13.7 i forrige testplan, uendret).

## 10. Forslagskortet og KI-merket, `src/shared/ui/ai-suggestion.test.ts` og `ai-text-mark.test.ts` (nye, rene)

Rendres med `renderToStaticMarkup(createElement(...))` som `src/shared/ui/form.test.ts` (filene heter `.test.ts`, ellers plukker Vitest dem ikke opp). Tabell (`it.each`) tilstand → synlige knapper og tekst:

1. **`suggested`, `ok`:** egen tekst og forslag vises, merket «Forslag fra KI», knappene «Bruk», «Behold min tekst», «Nytt forslag»; ingen «Angre».
2. **`accepted`:** «Angre» synlig; «Nytt forslag» ikke vist.
3. **`rejected`:** «Angre» og «Nytt forslag» synlige.
4. **`accepted` eller `rejected` med `hasNewerSuggestion`:** «Angre» vises ikke.
5. **`pending`:** «KI jobber …», alle knappene har `disabled`; tekstfeltet for egen tekst er ikke `disabled`.
6. **`no_match`:** «KI hadde ikke noe forslag. Teksten din er uendret.»
7. **`error`:** «KI svarte ikke. Prøv igjen.»
8. **KI av:** «KI er av.» og ingen knapp for å be om forslag.
9. **uten nett:** «Krever nett. Teksten din er lagret og kan skrives videre.», knappen for forslag `disabled`.
10. **nytt forslag gav `no_match` eller `error` (A164):** det gamle forslaget vises fortsatt sammen med meldingen.
11. **escaping (A157):** forslaget `<img src=x onerror=alert(1)>` vises som tekst (`&lt;img`), aldri som element. Samme for egen tekst.
12. **ingen meny:** ingen `<select>`, `role="menu"` eller knapp med teksten «Mer».
13. **knappene ligger nederst i kortet** (i samme bunnområde i markupen, etter tekstene).
14. **norske tekster:** ingen engelske statuskoder (`accepted`, `rejected`, `suggested`) synlige i markupen.

KI-merket:

15. `accepted` med `aiUsageId` → «Tekst fra KI, godkjent»; `edited` med `aiUsageId` → samme tekst.
16. `suggested`, `rejected`, eller `accepted` uten `aiUsageId` → ingenting rendres.
17. Merket har ingen props for variant eller tekst (TypeScript: `// @ts-expect-error` ved forsøk).

## 11. Serverhandlingene, `src/app/(ansatt)/prove/ki/actions.test.ts` (ny, mot databasen)

1. **be om forslag** som takstmann i prøveorganisasjonen gir én rad med `target_ref.type = ai_trial` i riktig organisasjon, og svaret til klienten inneholder forslaget.
2. **organisasjons-id fra klienten ignoreres** (avsnitt 5.4). Ekstra felt som `employeeId` eller `decidedBy` i inndata ignoreres.
3. **Zod** (`it.each`): `requestId` og mål-id som ikke er uuid, tom eller for lang tekst (over `AI_FIELD_MAX_LENGTH`), ukjent avgjørelse → fast norsk feilmelding, ingen rad og ingen kall til leverandøren.
4. **to raske kall med samme `requestId`** (`Promise.all`) gir én rad og én linje i `audit_log`.
5. **to like avgjørelser** (`Promise.all` med «Bruk» to ganger) gir én statusendring og én linje i `audit_log`; den andre gir fast melding, ikke unntak med stakk.
6. **«Nytt forslag» (A164):** nytt kall på samme mål med `ok` setter det gamle til `rejected`; med `FAKE_NO_MATCH_INPUT` eller `FAKE_ERROR_INPUT` står det gamle som `suggested`.
7. **`audit_log`** for hele flyten (forslag, bruk, angre, behold, nytt forslag): linjene inneholder bare id-er og status. En unik markør i egen tekst og i forslaget finnes ikke i noen linje (`JSON.stringify` av alle rader).
8. **loggeren:** `console.error`/loggeren spioneres ved feil fra leverandøren; den får bare id og feilkode, aldri markøren.
9. **feil til klienten** er de faste meldingene; ingen `stack`, SQL eller engelsk tekst.
10. **tilgang** per tabellen i avsnitt 6.

## 12. E2E, `e2e/fase-2a-forslagsmonster.spec.ts` (ny)

Kjøres i prosjektene `pc` og `ipad` (1194 × 834, liggende). Testene merket «stående» setter `page.setViewportSize({ width: 834, height: 1194 })`. Innlogging som prøvetakstmannen (`SAMPLE_INSPECTOR`) i prøveorganisasjonen. Teksten er oppdiktet. Status lest fra databasen med samme mønster som `e2e/fase-2a-testoppdrag.spec.ts`.

1. **forslaget vises:** skriv setning, trykk «Foreslå bedre språk», kortet viser egen tekst og forslag med merket «Forslag fra KI». Den faste linjen «Bruk oppdiktet tekst …» står på siden.
2. **«Bruk»:** teksten i feltet byttes, siden viser «Logget: godtatt», merket «Tekst fra KI, godkjent» vises, og raden i databasen har `status = accepted` og `decided_by` satt.
3. **«Angre» etter «Bruk»:** egen tekst kommer tilbake, merket forsvinner, «Logget: forslag», raden `suggested`.
4. **«Behold min tekst»:** egen tekst uendret, «Logget: avvist», raden `rejected`; «Angre» setter tilbake til `suggested`.
5. **«Nytt forslag»:** gir ny rad; det gamle `rejected` i databasen. Med `FAKE_ERROR_INPUT` i feltet: «KI svarte ikke. Prøv igjen.», det gamle forslaget står igjen.
6. **feil:** `FAKE_ERROR_INPUT` gir «KI svarte ikke. Prøv igjen.», egen tekst uendret.
7. **KI er av:** egen organisasjon uten KI laget i `e2e/helpers.ts` (ny hjelper, oppdiktet navn og e-post på `example.invalid`) → «KI er av.», ingen rad i `ai_usage_log`.
8. **uten nett:** `context.setOffline(true)` → «Krever nett. Teksten din er lagret og kan skrives videre.», knappen sperret, det går an å skrive videre i feltet, og ingen spinner henger (vent maks 5 s). Tilbake på nett virker knappen.
9. **nettet faller midt i et forslag:** `page.route` på serverhandlingen holdes igjen, så `setOffline(true)` → samme tekst, egen tekst uendret, ingen tekst overskrevet.
10. **dobbelttrykk:** `dblclick` på «Foreslå bedre språk» og på «Bruk» gir én rad og én `audit_log`-linje per handling.
11. **trykkflater** (bare `ipad`): `boundingBox` for «Bruk» har høyde ≥ 56 og ≤ 72, de andre knappene ≥ 44 (CSS-piksler; 1 pt = 1 CSS-piksel i Safari på iPad).
12. **stående iPad:** egen tekst og forslaget står over hverandre (forslagets `y` > egen teksts `y + høyde`); liggende og PC side om side (samme `y`, ulik `x`).
13. **nettstatus synlig** på siden både på og uten nett.
14. **escaping:** forslag med `<b>fet</b>` vises som tekst (sjekk `innerText`, ingen `b`-element i kortet).
15. **tilgang:** innlogget som kontor uten `report.edit` → siden viser «Ingen tilgang» (eller `no-access.tsx`), ingen knapp. Admin kommer inn.

Hele `pnpm test:e2e` kjøres i `pc` og `ipad` for å vise at ingenting annet er brutt.

## 13. Endringer i eksisterende tester og hjelpere

1. `src/core/ai/features/features.test.ts` 2.1 (avsnitt 1), skrevet om, ikke slettet.
2. `src/core/ai/access.test.ts` utvides (avsnitt 6).
3. `src/db/seed/sample-assignments.test.ts` utvides (avsnitt 9).
4. `e2e/helpers.ts`: hjelper for organisasjon uten KI og innlogging som prøvetakstmann, hvis den ikke finnes.
5. `tests/tenant-tables.ts` og `RESET_TABLES` endres ikke.

## 14. Dokumenter (sjekkes for hånd i testrapporten)

- Versjonen i `package.json` er 0.5.1.
- Ordlisten i `docs/05-domenemodell.md`: forslagskort, KI-merke, statusoppslag, publiseringssperre for KI-tekst, `ai_trial`.
- A166–A168 i `docs/09-apne-sporsmal.md`, og setningen i spørsmål 57.
- Kommentaren «tjenesten sjekker bare det den får» står i koden ved `checkAiTextApproved`.

## Avklaringer til utvikler (føres i kortet før bygging)

- **A. Svar fra `getSuggestionStatus` ved «finnes ikke»:** `null` eller nøytral feil. Begge godtas, men det må være likt for alle fem tilfellene i 3.3, og manglende rettighet skal også gi det samme (kortet), ikke `AccessDeniedError`. Hvis utvikler vil ha `AccessDeniedError` for rollen uten `report.edit` i det hele tatt (som `recordDecision` trinn 1), føres det i kortet, og 3.3 deles.
- **B. Angre etter «Bruk» på prøvesiden:** egen tekst må tas vare på i nettleseren før byttet, ellers kan den ikke komme tilbake (e2e 3).
- **C. Tak over 500:** avslag som feil (ikke tom liste og ikke delvis svar), så publiseringen i 2a-2 aldri tror alt er godkjent.
- **D. Lite funn (ikke stopp):** prøvesiden lager ekte rader i `ai_usage_log` med 10 års oppbevaring. Det er riktig (all KI-bruk logges), men radene bør med i opprydningen når `ai_trial` arkiveres i 2a-2. Nevnes i PR-en.

## Godkjenning

Testrapporten avviser hvis noe av dette mangler: tilgangstabellen i avsnitt 6 for alle fire tjenestene, `expectTenantIsolation` for `getSuggestionStatus` og `checkAiTextApproved` (avsnitt 5), admin uten enkeltrettigheter (6.2), ad-6-tilfellene 4.9–4.11, rekkefølgen i `recordDecision` (7.1–7.3), vakten for `ai_trial` (2.2), markørtestene (3.2, 11.7) eller e2e uten nett (12.8).
