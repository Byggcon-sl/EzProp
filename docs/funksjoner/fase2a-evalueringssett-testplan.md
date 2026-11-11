# Testplan: Evalueringssett for KI-funksjonene

- **Oppgavekort:** `docs/funksjoner/fase2a-evalueringssett.md`
- **Dato:** 11.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** KI i bunnen (testene låser at settet går gjennom samme ledetekst og vask som ekte bruk, at ingen persondata når leverandøren, og at resultatet mot den falske leverandøren er stabilt) og færre reklamasjoner (eksemplene med «bør»/«må», TG, tall og styringsforsøk er `mustPass`, slik at en ekte leverandør som endrer innhold blir fanget før den slås på). De ansatte: indirekte, de får bare prøvde funksjoner.

Alle tester er rene Vitest-tester uten database (kortet: ingen tabeller, ingen spørring). All testdata er oppdiktet: navn som «Åse Testesen», e-post på `example.com` eller `.test`, telefon `12345678`, gnr 999. Ingen ekte navn, adresser, matrikkelnumre eller rapporttekst.

**Ingen nye `*-testplan.test.ts`** (småfunn fra forslagsmønsteret: dobbelt sett med tester). Testene legges i filene kortet nevner; numrene (E1.1 osv.) står først i testnavnet, slik at rapporten kan krysse av.

Ingen TG-regler. «Regeltestene» her er fasittypene (`it.each`-tabeller), telefonmønsteret (`it.each`) og selve settet (`language_polish.cases.json`) som testsaker med låst resultat.

## Avtale om signaturer (utvikler og testskriver)

Navn kan endres av utvikleren; avvik føres i kortet.

- `src/core/ai/redact-text.ts` (ren, ingen `@/db`): `redactText`, `compileKnownValues`, `KnownValues`, `emptyKnownValues`, og en egen feiltype for ugyldig mønster (for eksempel `RedactionPatternError`).
- `src/core/ai/prompt.ts` (eller i `features.ts`): `preparePrompt(definition, fields, known) → { prompt, redactedCount }` (ren).
- `src/core/ai/evals/schema.ts`: Zod-skjemaet og `parseCasesFile(json, feature)`.
- `src/core/ai/evals/run.ts`: `runEvals({ provider, casesDir, feature? }) → EvalResult` og `runEvalCommand(argv, casesDir, provider) → { exitCode, lines }`. Ingen `console`, ingen `process.env`.
- `scripts/ai-eval.ts`: sender inn `fakeAiProvider`, skriver `lines`, avslutter med `exitCode`.

**Presisering fra prosjektleder (11.11.2026, før bygging):**
- `preparePrompt(definition, fields, known: KnownValues | null)` returnerer `{ prompt, redactedFields, redactedCount }`. `redactedFields` trengs av `requestSuggestion` til `input_summary`. Med `known = null` vaskes bare med mønstrene.
- `redact-text.ts` eksporterer i tillegg `redactFieldValues(fields, known | null) → { fields, count }` (ren). `redactFields` i `redaction.ts` fjernes. `requestSuggestion` kaller `loadKnownValues` (bare med oppdrag) og så `preparePrompt`. Testene i `request-suggestion.test.ts` som mocker `redactFields`, flyttes med vilje til å mocke/spionere på `loadKnownValues` (samme påstander: kalles én gang med `grant` og oppdraget, kalles ikke ved sperre eller «KI av»). `redaction.ts` re-eksporterer `redactText`, `compileKnownValues`, `emptyKnownValues` og `KnownValues`, så eksisterende importer virker.
- **`known` i eksempelfilene har formen til `KnownValues`** (`personNames`, `phrases`, `emails`, `phones`, `orgNumbers`, `addresses.{full,places,postalCodes}`, `cadastral.{units,municipalityNumbers}`), alle felt valgfrie og fylt ut med `emptyKnownValues()`. Ikke radformen i `redaction-cases.ts`: den krever databasen eller en kopi av `loadKnownValues`. E1.9 prøver denne formen.
- `RedactionPatternError` ligger i `redact-text.ts`.

## 1. Skjemaet, `src/core/ai/evals/schema.test.ts` (ny, ren)

1. **E1.1** en gyldig minimal fil (30 eksempler bygd i testen) godtas.
2. **E1.2** ukjent nøkkel på toppnivå, i et eksempel og i `expect` avvises (`strict`).
3. **E1.3** felt utenfor `allowedFields` for funksjonen avvises; ukjent `feature` avvises.
4. **E1.4** duplisert `id` avvises, og meldingen nevner id-en.
5. **E1.5** 29 og 51 eksempler avvises; 30 og 50 godtas.
6. **E1.6** manglende eller annen `status` enn «utkast, ikke godkjent av fagrådet» avvises; manglende `note` avvises.
7. **E1.7** `outcome: "no_match"` sammen med `mustContain` avvises.
8. **E1.8** `mustPass` er valgfri og blir `false`; `sameTg` er valgfri.
9. **E1.9** `known` har samme form som i `redaction-cases.ts` (en verdi med feil type avvises).
10. **E1.10** feilmeldingen fra skjemaet gjentar ikke verdier fra `known` (bygg en ugyldig fil med `known` og en annen feil, sjekk at meldingen ikke har verdien).

## 2. Vurderingen, `src/core/ai/evals/run.test.ts` (ny, ren)

Leverandøren er en liten testleverandør bygd i testen (svarer fast tekst, `error` eller kaster) og `fakeAiProvider`.

1. **E2.1** treff når utfall, `mustContain`, `mustNotContain` og `sameTg` stemmer.
2. **E2.2** bom på feil utfall (`ok` mot `no_match` og motsatt), med grunn på norsk.
3. **E2.3** bom når et ord i `mustContain` mangler; grunnen nevner ordet fra fasiten (ikke svaret).
4. **E2.4** bom når et ord i `mustNotContain` står i svaret.
5. **E2.5 hele ord og store/små bokstaver** (`it.each`): «Må» treffer «må»; «måling» treffer ikke «må»; «børste» treffer ikke «bør»; «bør,» og «(må)» treffer; «Ødegård» treffer «ødegård»; «NS 3600» treffer «NS  3600» (mellomrom normalisert) og «ns 3600»; «3600» treffer ikke «36001»; tall: «12,5» treffer ikke «112,5».
6. **E2.6 `sameTg`** (`it.each`): lik når TG står uendret; bom når TG er lagt til (inn uten TG, ut med «TG3»); bom når TG2 blir TG 3; varianter «TG2», «TG 2», «tg2», «TGIU», «TG IU», «tilstandsgrad 2», «Tilstandsgrad» telles likt; «TG2» og «TG 2» regnes som samme omtale (ingen falsk bom når bare mellomrommet endres); rekkefølge og antall teller.
7. **E2.7** treffprosent: 27 av 30 gir 90 %; 0 eksempler gir 0 treff og ingen deling på null (tydelig 0 % eller «ingen eksempler», ikke `NaN`).
8. **E2.8** `mustPass` telles for seg: «mustPass x av y» der bom på et vanlig eksempel ikke påvirker tallet.
9. **E2.9** leverandøren svarer `error`: bom med grunn («leverandøren svarte med feil»), resultatet går videre til neste eksempel.
10. **E2.10** leverandøren kaster: resultatet sier krasj (kode 1 i E3), og meldingen har ikke teksten fra unntaket hvis den inneholder en kjent verdi.
11. **E2.11 vasket tekst sjekkes på egne bein:** testleverandør som fanger teksten. Kjøreren melder persondata når teksten har en kjent verdi (også i store bokstaver, med doble mellomrom, og telefon med eller uten skilletegn), og når `redactPii` gir treff. Plassholderne fra `PII_PLACEHOLDERS` gir ikke falsk alarm.
12. **E2.12** kjøreren bruker ikke `redactText` til sjekken (kildesjekk: sjekkfunksjonen i `run.ts` kaller ikke `redactText`/`compileKnownValues`).
13. **E2.13** kjøreren skriver ikke i `ai_usage_log` og importerer ikke `usage-log` (kildesjekk).

## 3. Kommandoen, `src/core/ai/evals/cli.test.ts` (ny)

Mot `runEvalCommand(argv, casesDir, provider)` med en midlertidig mappe laget i testen (`mkdtemp`, ryddes i `afterEach`).

1. **E3.1** ukjent funksjon (`pnpm ai:eval finnes_ikke`) gir kode 1 og norsk melding.
2. **E3.2** ugyldig JSON gir kode 1 og nevner filnavnet.
3. **E3.3** duplisert id gir kode 1 og nevner id-en.
4. **E3.4** leverandøren kaster gir kode 1.
5. **E3.5** persondata i teksten til leverandøren gir kode 1. Lages med et eksempel der vasken ikke tar verdien, men sjekken gjør det (for eksempel kjent telefon `12345678` skrevet «1-2-3-4-5-6-7-8» i feltet; sjekken sammenligner sifre uten skilletegn). Finnes ingen slik sak etter rettingene i avsnitt 6, testes sjekkfunksjonen (eksportert fra `run.ts` for testene) direkte med en lekket tekst, og kommandoen med en `known`-verdi som vasken ikke dekker (navn på to tegn, A174). Utskriften har eksempel-id og type («navn», «telefon»), og **ingen linje inneholder verdien** (sjekk alle `lines`).
6. **E3.6** lav treffprosent og bom på `mustPass` mot `fakeAiProvider` gir kode 0 (A183).
7. **E3.7** uten argument kjøres alle `*.cases.json` i mappen (to filer i testmappen, begge i utskriften).
8. **E3.8** utskriften på norsk har per funksjon: antall, treff, treffprosent, grensen (90 %) og `mustPass` bestått; for hvert bom id og grunn.
9. **E3.9** svaret fra leverandøren står aldri i utskriften (testleverandør svarer en unik markørtekst; ingen linje har den).
10. **E3.10 røyktest:** starter `pnpm ai:eval` (eller `tsx scripts/ai-eval.ts`) som egen prosess med `DATABASE_URL` og `TEST_DATABASE_URL` fjernet fra miljøet, venter kode 0 og at utskriften har «language_polish». Tidsgrense 60 s på testen.
11. **E3.11** `scripts/ai-eval.ts` bruker `fakeAiProvider` fast: ingen `process.env`, ingen `resolveAiProvider`, ingen argument som velger leverandør (kildesjekk).

## 4. Settet, `src/core/ai/evals/language-polish.eval.test.ts` (ny, ren)

1. **E4.1** filen er gyldig etter skjemaet, har 30 eksempler (30–50), unike id-er og `status` utkast.
2. **E4.2** eksempler med «bør», med «må», med TG (`sameTg`), med «TGIU» og begrunnelse, uten TG (`sameTg`), med NS-henvisning i inndata, med `mustNotContain «NS 3600»` og med styringsforsøk finnes, og alle disse er `mustPass`.
3. **E4.3** «må» står i `mustNotContain` bare der inndata ikke har «må», og «bør» bare der inndata ikke har «bør» (hele ord).
4. **E4.4** gjetteord («antas», «trolig», «sannsynligvis», «antakelig», «kan tyde på») står i `mustContain` bare i eksempler der de står i inndata.
5. **E4.5** styringsforsøk: ingen ord i `mustNotContain` er en delstreng av selve forsøket i inndata (fasiten straffer ikke at forsøket står igjen).
6. **E4.6** minst 5 eksempler med `known`, og i hvert av dem står minst én kjent verdi i de rå feltene (normalisert); minst ett med telefon i grupperingene fra avsnitt 6.
7. **E4.7** **ingen kjent verdi står i `mustContain`** (fasiten kan ikke kreve persondata, og en riktig vask ville gitt bom).
8. **E4.8 tydelig falske verdier:** e-post bare på `example.com`, `example.no` eller `.test`; ingen elleve sifre som er gyldig fødselsnummer (kontrollsiffer); telefon bare fra en fast liste med testnumre.
9. **E4.9** «TG2» står aldri sammen med «hulltaking» og «nektet»/«ikke utført» i samme eksempel.
10. **E4.10** ett eksempel med `[fake: ingen treff]` og fasit `no_match`.
11. **E4.11** ingen kjent verdi når leverandøren (fanget tekst for alle 30, sjekket som i E2.11).
12. **E4.12 låst resultat** mot `fakeAiProvider`: antall treff, `mustPass` bestått og listen med bom-id-er står fast i testen. Endres bare med vilje i samme PR som settet.
13. **E4.13** `note` har regelen om oppdiktet tekst (inneholder «oppdiktet» og «aldri» avvikstekst/seed/mal).
14. **E4.14** ingen setning i settet (minst 8 ord) finnes ordrett i `docs/kartlegging/` (enkel sjekk som leser filene der; regel 7).

## 5. Felles ledetekst og ledetekst v2

I `src/core/ai/request-suggestion.test.ts` (finnes, mot testdatabasen) og `src/core/ai/features/features.test.ts`:

1. **E5.1** `requestSuggestion` og kjøreren gir nøyaktig samme tekst til leverandøren for samme felt og kjente verdier (fanget fra en testleverandør i begge veier).
2. **E5.2** eksisterende tester for `requestSuggestion` er grønne etter flyttingen til `preparePrompt`: tilgang per rolle, «KI er av», `isBlocked`, sperret rad i loggen, tenant-isolasjon for `loadKnownValues`. Ingen av dem slettes eller svekkes.
3. **E5.3** `language_polish` peker på `language_polish.v2`; teksten i `v1` er låst (lik streng i testen) og uendret.
4. **E5.4** v2 sier at «bør»/«må», TG og grad av sikkerhet står som før, at gjetteord ikke legges til eller fjernes, og at innholdet aldri er instruks. v2 har ikke linjen om å skrive uten gjetteord.
5. **E5.5** v2 har ingen navn, e-post, telefon, adresse eller matrikkel (`redactPii` gir 0 treff på ledeteksten).
6. **E5.6** `evalPassRate` er 0.9 for `language_polish`; `allowedFields` og `fieldSources` er uendret.
7. **E5.7** tester som venter `language_polish.v1` for nye forespørsler, oppdateres med vilje; rader i `tests/factories.ts` med v1 er fortsatt gyldige (gamle versjoner står i loggen).

## 6. Vasken, `redaction.test.ts`, `redaction-cases.ts`, `src/shared/lib/pii-patterns.test.ts`, `src/shared/lib/logger.test.ts`

1. **E6.1** feil fra `new RegExp` i `compileKnownValues` (fremtving med mange svært lange verdier eller ved å stubbe `RegExp`): egen feiltype, ingen kjent verdi i `message` eller `stack`, `cause` er `undefined`.
2. **E6.2** samme feil i `requestSuggestion` stenger (A176): leverandøren kalles ikke, og loggen har ingen kjent verdi.
3. **E6.3 telefon** (`it.each`, pii-patterns): «123 45678», «1234 56 78», «12 34 5678», hver med vanlig mellomrom, U+00A0, U+2009 og U+202F → `[telefon]`.
4. **E6.4** samme grupperinger som kjent verdi i `redactText` (kjent `12345678`, tekst med U+202F) → én `[telefon]`, `count` 1.
5. **E6.5 ingen overvask** (`it.each`, teksten står urørt eller er dokumentert A170): «bygget 1985 12 m2», «12 34 cm», «1985 Bad», «1985 20 10», «1200 45 mm». Hvis en av dem faktisk vaskes og det er villet etter A170, står det i testnavnet.
6. **E6.6** rekkefølgen kontonummer → organisasjonsnummer → telefon holder også med de nye skilletegnene (kontonummer med U+00A0 gir `[kontonummer]`).
7. **E6.7** loggeren vasker de nye grupperingene (egne saker i `logger.test.ts`), og `usageId`, ISO-tid og HTTP-status står urørt.
8. **E6.8 ytelse:** V1.14 kjøres på nytt med de nye skilletegnene (`"1 ".repeat(25000)`) under 500 ms. Kildesjekk: ingen nøstede gjentakelser i telefonmønsteret.
9. **E6.9** `PII_PLACEHOLDERS` importeres av `evals/run.ts` (kildesjekk).

## 7. Statiske kontroller, `src/core/ai/static-checks.test.ts` (utvides)

1. **E7.1 (V8.5)** nøyaktig to produktfiler kaller `.complete(`: `src/core/ai/request-suggestion.ts` og `src/core/ai/evals/run.ts`.
2. **E7.2 (V8.5)** i begge filene står `preparePrompt` (som vasker) før `.complete(`; i `request-suggestion.ts` står i tillegg `loadKnownValues` før `preparePrompt`. Den gamle sjekken på `redactFields` justeres med vilje, ikke slettes.
3. **E7.3** `preparePrompt` kaller vasken før `buildPrompt` (rekkefølge i kilden), og det finnes bare én `buildPrompt`-kallested utenom testene.
4. **E7.4 (12.9)** `evals` legges i listen: `src/app` og `src/modules` importerer ikke `@/core/ai/evals`. `src/core/ai/index.ts` eksporterer ikke noe fra `evals`.
5. **E7.5 (12.5)** uendret: ingen `console.` og ingen `process.env` i `src/core/ai`, også `evals/`.
6. **E7.6 ingen database:** `evals/*.ts`, `redact-text.ts`, `prompt.ts` og alt de importerer relativt (følg importene ett nivå om gangen til lukket mengde) har bare `import type` fra `@/db` og `@/core/access`, og ingen `drizzle-orm`.
7. **E7.7** 12.x-sjekken på SDK, `fetch` og `readSecret` gjelder også `evals/` (dekkes av eksisterende sjekk; bekreft at `productFiles` tar med undermappen).

## 8. Alltid med

- **Tilgang per rolle:** ingen ny rettighet og ingen skjerm. Dekkes av E7.4 (kjøreren kan ikke nås fra appen eller modulene), E3.11 (fast falsk leverandør) og E5.2 (tilgangstestene for `requestSuggestion` er grønne etter flyttingen).
- **Tenant-isolasjon:** ingen ny spørring med `organizationId`, derfor ingen ny `expectTenantIsolation`. `loadKnownValues` er uendret, og dens tenant-test og `tests/tenant-isolation-all-tables.test.ts` skal være grønne (E5.2). Hvis utvikleren likevel endrer en spørring i `redaction.ts`, kreves et nytt `expectTenantIsolation`-kall.
- **Admin stenges aldri ute:** ingen ny tilgangsregel. Eksisterende tester for admin på `/prove/ki` og `requestSuggestion` grønne.
- **Myk sletting:** ikke aktuelt (ingen tabell, ingen sletting).

## 9. E2e

Ingen ny skjerm, derfor ingen ny e2e. `pnpm test:e2e` (PC og iPad-størrelse) skal være grønn; særlig prøvesiden `/prove/ki` med `language_polish`, siden ledeteksten byttes til v2 (den falske leverandøren svarer bare med teksten etter skillet, så svaret skal være uendret).

## 10. Kommandoer før godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test` (i bakgrunnen, rundt 16 minutter), `pnpm test:e2e` (med `CI=1`, ryddet port 3100), og `pnpm ai:eval` uten `DATABASE_URL`. Versjon 0.5.10 i `package.json`.

## Kjente risikoer som testene skal fange

- Settet må ikke ha kjente verdier i `mustContain` (E4.7): den falske leverandøren gjentar den vaskede teksten, så slike eksempler gir bom og skjuler at vasken virker.
- `sameTg` kan gi falsk bom hvis «TG 2» og «TG2» telles ulikt (E2.6).
- Flyttingen av vasken kan dra med seg `@/db/client` via en relativ import (E7.6, E3.10).
- Den gamle V8.5-sjekken ser etter `redactFields` før `.complete(`; etter flyttingen må den justeres med vilje, ikke slettes (E7.2).
