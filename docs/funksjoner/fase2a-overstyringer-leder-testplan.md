# Testplan: Overstyringer for leder

- **Oppgavekort:** `docs/funksjoner/fase2a-overstyringer-leder.md` (design: `fase2a-overstyringer-leder-design.md`)
- **Dato:** 24.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** testene låser at rød markering bare kommer når reklamasjonen gjelder samme kontrollpunkt og samme utgivelse som kunden fikk, at ingenting telles dobbelt ved ny versjon, og at slettede rader ikke forfalsker tallene.
  - **KI i bunnen:** `override_summary` går gjennom `src/core/ai` med forslag, beslutning og logg; bare koder, etiketter, punktnavn og tall går til KI, aldri begrunnelsestekst, navn eller reklamasjonstekst; vaktene stopper nye tall, TG og gjetteord.
  - **De ansatte:** e2e viser to trykk fra siden til utgivelsen, godta/endre/avvis, tydelig melding uten nett, og at siden virker på PC og iPad med tastatur og skjermleser.

All testdata er oppdiktet (gnr 999, «Åse Testesen», `ase.testesen@eksempel.no`, telefon `12345678`, «Testveien 1»). Vitest mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Numrene (O1.1 osv.) står først i testnavnet, så rapporten kan krysse av. Testene legges i filene for området, ingen nye `*-testplan.test.ts`. Hjelpere: `tests/factories.ts` (`createClaim`, `createAssignment`, `createEmployee`, `createAiUsageLog`), `tests/publish-fixtures.ts` (`createPublishableBathroom`, `releasesOf`, `checkRowsOf`), `tests/ai.ts` (`employeeWithGrant`, `enableAi`, `expectSameRejection`), `tests/tenant-isolation.ts`, `e2e/helpers.ts` (`logInAsManager`, `logInAsInspector`, `OFFICE_EMAIL`). Navn på funksjoner kan endres av utvikleren; avvik føres i kortet.

**Ny testhjelper (testskriver):** `createOverrideRelease(f, { checkCode, checkpointKey, reasonCode, releasedAt, createdAt, version })` i `tests/publish-fixtures.ts`, som lager utgivelse og overstyrt sperre med gitt tid uten å gå via skjermen. Tider settes eksplisitt i UTC med kjent Oslo-dato; ingen test bruker `new Date()` uten fast klokke (`vi.setSystemTime`), så dag 89/90/91 og månedsgrensen ikke blir ustabile.

**Merker for lekkasje:** strenger som ikke kan stå i en uuid eller et tidsstempel, for eksempel «Mxq-grunn-ÆØ», «Mxq-krav-ÆØ», «Mxq-del-ÆØ», og navnet «Mxqline Testesen».

## 1. Enhet, rene funksjoner (uten database)

### 1a Tellingen (`src/core/reports/logic/overrides.test.ts`)
1. **O1.1 `computeOverrideShare`:** 7 av 18 gir 39 (heltall, avrunding som kortet sier, fast i testen); 0 rapporter gir `null` uten deling på null; `reportCount` 4 gir `sharePercent: null` og bare antall; 5 gir prosent (grensen).
2. **O1.2 endring fra måneden før:** `deltaCount` og `deltaPoints` regnes riktig ved økning, nedgang og likt; ny kode som ikke fantes måneden før gir `previousCount: 0`; måneden før under 5 rapporter gir `previousSharePercent: null` og `deltaPoints: null`.
3. **O1.3 `buildOverrideSummaryInput`:** zod `strict` avviser ukjent nøkkel (`overrideReason`, `employeeName`, `assignmentId`, `it.each`); kode som ikke følger kodemønsteret (mellomrom, æøå, over lengdegrensen, «Mxq-grunn-ÆØ») avvises; alle tall er heltall eller `null` (desimaltall og streng avvises).
4. **O1.4 etiketter:** `publish-check-labels.ts` og grunn-etikettene gir norsk etikett for hver kjent kode (går gjennom hele `PUBLISH_BLOCKER_CODES` og `PUBLISH_OVERRIDE_REASON_CODES`); ukjent kode gir den trygge teksten, aldri selve koden eller `undefined`.

### 1b Markeringen (`src/core/reports/logic/claim-marker.test.ts`)
Testsakene er data (`claim-marker-cases.ts`, `it.each`); samme tabell brukes i integrasjonstesten O3.6.
1. **O1.5 `classifyClaimMarker`, alle sakene fra «Regler»:** reklamasjon før utgivelsen → ingen; samme Oslo-dag → rød; utgivelse 23:30 Oslo og reklamasjon neste dag → rød; utgivelse 23:30 Oslo der UTC-datoen er dagen før (vintertid og sommertid) → rød; annet punkt → ingen; uten punkt → nøytral; slettet sak → ingen; annet oppdrag → ingen; v1 og v2 med samme overstyring, reklamasjon etter v2 → v2 rød, v1 ingen; reklamasjon mellom v1 og v2 → v1 rød, v2 ingen; overstyring uten `checkpointKey` («Hele rapporten») → aldri rød eller nøytral, også når reklamasjonen mangler punkt.
2. **O1.6 rød vinner over nøytral:** to reklamasjoner på oppdraget, én med samme punkt og én uten → rød.

### 1c Kontrollpunkt i reklamasjonen (`src/core/claims/logic/checkpoint-match.test.ts`)
1. **O1.7 `rankCheckpointMatch`:** «våtrom, hull i membran» mot punktene gir tydelig treff på hull i våtrom; tom tekst, bare stoppord og to like gode treff gir ingen forhåndsvalg; æøå og store bokstaver likt. Funksjonen tar ingen ansatt-id og importerer ikke `@/core/ai` (statisk).
2. **O1.8 rekkefølgen i menyen:** bortkryssede punkter øverst merket «Krysset bort ved publisering», så resten gruppert på rom eller kapittel; «Ikke valgt» øverst og valgt når det ikke er tydelig treff.

### 1d Lederens tekst (`src/core/reports/logic/summary-text.test.ts`)
1. **O1.9 `validateSummaryText`, én test per tilfelle:** over 2000 tegn; elleve sifre på rad (også «010190 12345» og «010190.12345»); e-post; telefon (`12345678`, «+47 123 45 678»); navnet på en ansatt (med annen bokstavstørrelse, og som del av fullt navn). Hver gir norsk melding, for eksempel «Oppsummeringen kan ikke inneholde navn på ansatte.». 2000 tegn og tall som «7 av 18» og «39 %» godtas; tom tekst godtas ikke ved manuell lagring.
2. **O1.10 meldingen lekker ikke:** feilen nevner aldri navnet eller tallet som ble funnet.

### 1e Funksjonsdefinisjonen (`src/core/ai/features/features.test.ts` og `static-checks.test.ts`, statisk)
1. **O1.11 `override_summary`** finnes i `AiFeatureCode` og `AI_FEATURES` med `permission: "claims.read"`, ledetekst `override_summary.v1`, `allowedFields: []`, `fieldSources: {}` og `serverSources.override_stats` med nøyaktig kildene i kortet (A573). Hver `tabell.kolonne` finnes i Drizzle-skjemaet.
2. **O1.12 «aldri til KI»:** `never-fields.ts` inneholder `publish_check_results.override_reason`, `publish_check_results.overridden_by`, `claims.created_by`, `claims.description`, `claims.claimant_text`, `claims.building_part_text`; ingen av dem står i en `serverSources` (går gjennom alle funksjoner).
3. **O1.13 måltypen:** `override_summary` står i `RESOLVED_AI_TARGET_TYPES`, ikke i `FAKE_ONLY_TARGET_TYPES`; feltkoden er bare `text`; ingen funksjon har et TG-mål.
4. **O1.14 modulgrenser:** `src/core/ai` importerer aldri `@/core/reports` eller `@/core/claims`; `src/core/reports/overrides.ts` henter aldri kolonnene `override_reason`, `overridden_by` eller reklamasjonstekstene (grep i spørringen); ledeteksten har ingen modellnavn og forbyr gjetteord og TG.
5. **O1.15 grensene:** konstantene i `limits.ts` er 5 per leder per time og 20 per organisasjon per døgn (A575).

## 2. Regeltester og evalueringssett (testsaker som data)

Ingen nye regler i regelmotoren. Testsakene er data:
1. **O2.1 `classifyClaimMarker`-sakene** (O1.5) ligger som data og brukes både av enhetstesten og integrasjonstesten. En snudd forventning gjør begge røde.
2. **O2.2 `src/core/ai/evals/override_summary.cases.json`:** minst 30 saker med fasit, merket «utkast, ikke godkjent av fagrådet». Med: null utgivelser (KI kalles ikke), under 5 rapporter (bare antall, ingen «%»), én dominerende grunn, mange koder, mange røde, nøytrale tall, økning, nedgang, ny kode, tall som må stå uendret, ingen gjetteord, ingen TG, ingen navn, fritekst som ikke lekker, og de tre falske feilinngangene (`[fake: legg til tall]` → `number_guard`, `[fake: legg til TG]` → `tg_guard`, `[fake: feil]` → feilkode).
3. **O2.3 skjema for settet** (`evals/schema.test.ts`): sak uten fasit, uten utkastmerke eller med grunnlag som ikke består zod `strict` avvises.
4. **O2.4 kopisjekken og modellnavn:** settet og ledeteksten har ingen tekst fra `docs/kartlegging/`, ingen «NS 3600»/«IVIT» og ingen modellnavn.
5. **O2.5 `pnpm ai:eval override_summary`** består mot falsk leverandør (egen gren i `run.ts`), og `EvalProviderNotAllowedError` mot ekte leverandør.

## 3. Database og migrering (`src/db/schema/*.test.ts`, testdatabasen)
1. **O3.1 migrering 0039 tåler ekte data:** kjør migreringene til 0038, lag reklamasjoner og overstyringer, kjør 0039: alle reklamasjoner har `checkpoint_key = null`, ingen rader endret eller slettet (telling før og etter).
2. **O3.2 CHECK på `claims.checkpoint_key`:** gyldig nøkkel og `null` godtas; mellomrom, store bokstaver og tom streng avvises av databasen.
3. **O3.3 `override_summaries`:** CHECK på `month` (`2026-13`, `2026-1`, `26-01` avvises), `text` høyst 2000, `status` og `source` i listen; unik på (organisasjon, måned) der `deleted_at is null` (ny rad etter myk sletting er lov); føres i `tests/tenant-tables.ts`, så `tenant-isolation-all-tables.test.ts` er grønn.
4. **O3.4 `ai_usage_log`:** CHECK-reglene godtar `override_summary` som funksjon og måltype med `report_id` og `assignment_id` lik `null`, og avviser `override_summary` med `report_id` satt (hvis kortet krever det).

## 4. Integrasjon mot testdatabasen

### 4a Listen (`src/core/reports/overrides.test.ts`)
1. **O4.1 bare overstyrte sperrer:** ikke overstyrt sperre, overstyrt advarsel og sperre uten overstyring er ikke med.
2. **O4.2 90 dager i Oslo-dato:** fast klokke; `created_at` på dag 89 og 90 med, dag 91 ikke; rad laget 23:30 Oslo der UTC-datoen er dagen før, telles på Oslo-dagen.
3. **O4.3 to nivåer:** gruppe per (`check_code`, `checkpoint_key`), grunner som underlinjer; «Hele rapporten» når `checkpointKey` mangler; punktnavn fra malversjonen til rapporten (også arkivert punkt).
4. **O4.4 telling av unike rapporter:** v1 og v2 av samme rapport med samme overstyring gir antall 1 i gruppen og to linjer med «v2» på den andre.
5. **O4.5 sortering:** grupper med røde øverst og `open: true`; deretter flest først; linjer på dato, aldri på person (to like datoer med ulike takstmenn gir samme rekkefølge uansett hvem).
6. **O4.6 rød og nøytral fra databasen:** alle sakene i O2.1 kjøres mot ekte rader (`it.each`), inkludert reklamasjon i annen organisasjon med samme `checkpoint_key` → ingen.
7. **O4.7 myk sletting, én test hver:** slettet utgivelse, rapport, oppdrag, resultatrad og reklamasjon holdes utenfor listen, antall og markering.
8. **O4.8 svaret har ingen persondata:** serialiser hele `OverrideOverview` og sjekk at «Mxq-grunn-ÆØ», «Mxq-krav-ÆØ», «Mxq-del-ÆØ», «Mxqline Testesen», ansatt-id-ene, adresse og matrikkel ikke finnes; nøklene `overriddenBy` og `overrideReason` finnes ikke.
9. **O4.9 tom tilstand:** ingen overstyringer gir tom liste (siden viser «Ingen sperrer er krysset bort de siste 90 dagene.»).
10. **O4.10 ytelse:** 2 000 overstyringer fordelt på 300 rapporter og 50 reklamasjoner; `listPublishOverrides` under fast tidsgrense (satt i testen, romslig for CI); EXPLAIN viser `publish_check_results_overridden_idx` og at koblingen mot `claims` bruker `claims_organization_id_assignment_id_idx`. Ingen spørring per rad (telling av spørringer eller grep etter løkke med `await` i tjenesten).

### 4b Tallene til KI (`src/core/reports/override-stats.test.ts`)
1. **O4.11 måned på `released_at` i Oslo-tid:** utgivelse 31.10 kl. 23:30 Oslo hører til oktober; skiftet til vintertid (siste søndag i oktober) og sommertid (siste søndag i mars) testes.
2. **O4.12 nevneren:** unike rapporter publisert i måneden, også de uten overstyring; v1 i oktober og v2 i november telles i begge måneder.
3. **O4.13 bare fire tillatte måneder:** inneværende og tre siste hele; `2025-01`, `2026-13`, fremtidig måned og streng med organisasjons-id avvises med samme feil.
4. **O4.14 grunnlaget har ingen persondata:** samme merker som O4.8 er fraværende i `buildOverrideStats` og i `ai_usage_log.input_summary`.
5. **O4.15 myk sletting** gjelder også tallene (samme fem saker som O4.7).

### 4c Oppsummeringen (`src/core/reports/override-summary.test.ts`)
1. **O4.16 lage:** leder trykker for siste hele måned → raden i `override_summaries` lages eller hentes, KI-målet er `{ type: "override_summary", id, fieldKey: "text" }`, loggraden har `feature = 'override_summary'`, `report_id` og `assignment_id` `null`.
2. **O4.17 null utgivelser:** måned uten utgivelser kaller ikke KI og lager ingen loggrad.
3. **O4.18 godta → endre → avvis i rekkefølge:** godtatt tekst lagres med `ai_usage_log_id`; endret tekst skriver over `override_summaries.text`, men aldri `ai_usage_log.output_text`; avvis setter ikke tekst og fjerner ikke tidligere godtatt; siste beslutning gjelder på `getOverrideSummary`.
4. **O4.19 manuell tekst:** `saveOverrideSummary` lagrer med `source = 'manual'`; tekst som feiler O1.9 avvises og lagres ikke.
5. **O4.20 åpent forslag gjenbrukes:** leder B får samme åpne forslag som leder A ba om, og kan avgjøre det.
6. **O4.21 mållåsen og grensene:** to trykk samtidig for samme måned gir ett forslag; sjette forespørsel fra samme leder innen en time og 21. i organisasjonen innen et døgn avvises med norsk melding og uten loggrad for kall.
7. **O4.22 KI-feil:** `[fake: feil]` gir «Oppsummeringen kunne ikke lages nå. Prøv igjen senere.»; listen virker fortsatt; KI-porten av gir samme oppførsel uten kall.
8. **O4.23 vakter:** `[fake: legg til tall]` stoppes med `number_guard`, `[fake: legg til TG]` med `tg_guard`; gjetteord og navn på ansatt stoppes. Stoppede forslag vises ikke.
9. **O4.24 logging:** revisjonsloggen og applikasjonsloggen har bare id, måned og status, aldri teksten (merke i lederens tekst er fraværende).

### 4d Lekkasje (`src/core/ai/no-leak.test.ts`)
1. **O4.25 lekkasjetest mot falsk leverandør:** markørstrenger i `override_reason`, `claims.description`, `claims.claimant_text`, `claims.building_part_text`, ansattnavn, oppdragsnummer og oppdrags-id; ingen av dem finnes i det leverandøren mottok eller i `ai_usage_log`. `override_summary` er med i løkken over alle funksjoner.
2. **O4.26 `isBlocked` (A568):** med ekte leverandør slått på i testen (falsk transport): `override_summary` med tomme `allowedFields`/`fieldSources` er lov; en oppdiktet funksjon med organisasjonsmål og en `fieldSources`-kilde blokkeres fortsatt; andre mål uten oppdrag blokkeres som før (eksisterende tester uendret).

### 4e Kontrollpunkt på reklamasjonen (`src/core/claims/checkpoint.test.ts`)
1. **O4.27 `listClaimCheckpointOptions`:** bortkryssede punkter fra utgivelsene på oppdraget øverst; bare punktene fra den ene rapporten når oppdraget har én; forhåndsvalg ved tydelig treff, ellers «Ikke valgt».
2. **O4.28 lagring:** kjent kode og tom verdi godtas; ukjent kode, kode fra annen organisasjons malversjon og kode fra annet oppdrag gir **samme** feil (`expectSameRejection`); arkivert kode på eldre sak vises med navnet fra malversjonen.
3. **O4.29 linjen på saken:** etter lagring med punkt som ble krysset bort, gir saken data for «Denne sperren ble krysset bort ved publisering (dato, grunn)», uten navn og uten fritekst.

## 5. Tilgang per rolle (`src/core/reports/overrides-access.test.ts`, `src/core/claims/checkpoint.test.ts`)
Én `it.each` over rollene takstmann, takstmann med `access.inspectors_edit_all`, kontor, takstmann med kontor, leder, admin, admin uten lederrolle.
1. **O5.1 se siden og tallene** (`listPublishOverrides`, `buildOverrideStats`, `getOverrideSummary`): leder og admin ja; takstmann (også med `inspectors_edit_all`) og kontor nei, med samme avvisning som ukjent organisasjon.
2. **O5.2 lage oppsummering** (`requestOverrideSummary`, `claims.read`): som O5.1.
3. **O5.3 godta, endre, avvise, angre og manuell tekst** (`claims.manage`): leder og admin ja; takstmann og kontor som kjenner `usageId` får samme avvisning som for ukjent id på status, godta, endre, avvis og angre.
4. **O5.4 kontrollpunkt på reklamasjon** (`listClaimCheckpointOptions`, lagring med `checkpoint_key`): bare leder og admin.
5. **O5.5 admin stenges aldri ute (regel 11):** admin uten lederrolle og eneste aktive admin har full tilgang til alt over; ingen ny rettighet krever en rolle admin ikke har (test over `ROLE_PERMISSIONS`).
6. **O5.6 deaktivert leder** og slettet ansatt får ingen tilgang.
7. **O5.7 lenken i oppdragslisten:** synlighetsfunksjonen gir lenken bare ved `claims.read` (testet i tjenesten, ikke i komponenten).

## 6. Tenant-isolasjon (`expectTenantIsolation` i hver testfil)
Organisasjon B har samme `check_code`, `checkpoint_key`, grunn og måned som A.
1. **O6.1 `listPublishOverrides`:** leder i B ser ingen rader fra A, og kall med A-s organisasjons-id gir avvisning.
2. **O6.2 `buildOverrideStats`:** tellingen i A påvirkes ikke av rapporter i B (nevneren og antall).
3. **O6.3 `getOverrideSummary` og `requestOverrideSummary`:** B får verken A-s tekst eller A-s åpne forslag; usageId fra A avvises i B som ukjent id.
4. **O6.4 `saveOverrideSummary`:** kan ikke skrive A-s rad; måned med A-s `override_summaries.id` i målet avvises.
5. **O6.5 `resolve-target` for `override_summary`:** raden slås opp på `grant.organizationId` og `deleted_at is null`; A-s id fra B gir samme svar som ukjent id; slettet rad gir samme svar.
6. **O6.6 `listClaimCheckpointOptions` og lagring:** B ser ikke A-s punkter og kan ikke lagre A-s kode.
7. **O6.7 markeringen:** reklamasjon i B med samme `checkpoint_key` gir aldri rødt i A (dekket i O4.6, kalt eksplisitt her).
8. **O6.8 navnekontrollen i O1.9:** navn på ansatt i B stoppes ikke i A (navnene hentes med `grant.organizationId`), og A-s navn stoppes.
9. **O6.9 tabellisten:** `override_summaries` står i `tests/tenant-tables.ts` med radbygger og testfil.

## 7. E2e (`e2e/fase-2a-overstyringer-leder.spec.ts`, prosjekt PC 1280×800 og iPad Pro 1024×1366 stående og 1366×1024 liggende)
Testdata lages med egen seed-hjelper i spec-filen (oppdiktet), med én rød, én nøytral og én vanlig gruppe.
1. **O7.1 to trykk til utgivelsen:** leder: oppdragslisten → «Overstyringer» → åpne gruppe → lenke til utgivelsen åpnes. Rød gruppe er åpen fra start.
2. **O7.2 rød og nøytral med tekst og ikon:** «Reklamasjon på samme punkt» med ikon; «Reklamasjon på oppdraget, punkt ikke valgt» med lenken «Velg kontrollpunkt» som åpner redigeringen av reklamasjonen.
3. **O7.3 «v2»** står ved datoen for andre versjon; ingen navn, adresse eller fritekst på siden (søk etter merkene).
4. **O7.4 månedsknappene:** fire knapper, siste hele måned valgt; «Tall for hele måneden» vises.
5. **O7.5 godta, endre, avvis:** «Lag oppsummering» → forslag → «Godta» lagrer og viser teksten; ny runde «Endre» lagrer endret tekst; «Avvis» setter ikke tekst. Last siden på nytt: teksten står.
6. **O7.6 lederens tekst med navn** gir feilmeldingen på norsk ved feltet.
7. **O7.7 KI-feil og port av:** feilmeldingen vises og listen virker.
8. **O7.8 «Ingen tilgang»:** takstmann og kontor ser ikke lenken, og direkte adresse gir «Ingen tilgang». Admin ser siden.
9. **O7.9 tom tilstand:** organisasjon uten overstyringer viser «Ingen sperrer er krysset bort de siste 90 dagene.».
10. **O7.10 måned uten utgivelser:** «Ingen rapporter ble publisert i denne måneden.», og ingen KI-kall (teller i falsk leverandør eller loggen).
11. **O7.11 kontrollpunkt i skjemaet:** «Kontrollpunkt» viser bortkryssede punkter øverst med merket; forhåndsvalg ved tydelig treff; lagring viser «Denne sperren ble krysset bort ved publisering» på saken.
12. **O7.12 uten nett:** `context.setOffline(true)` etter at siden er lastet: tydelig melding i stedet for tom side, «Lag oppsummering» grået ut med «Krever nett», synkstatusen vises. Tilbake på nett: knappen virker.
13. **O7.13 universell utforming:** axe uten feil på siden, i åpen gruppe og i reklamasjonsskjemaet; gruppene er knapper med `aria-expanded` som skifter; hele flyten O7.1 og O7.5 med bare tastatur.
14. **O7.14 trykkflater:** alle knapper og lenker minst 44 px; «Lag oppsummering» og «Godta» minst 56 px på iPad; ingen vannrett rulling på iPad stående.

## 8. Kommandoer før godkjenning
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm ai:eval override_summary`. Versjon økt i `package.json`, ordlisten oppdatert.

## 9. Avvises hvis
- Noen av O5 eller O6 mangler, eller en ny spørring med `organizationId` ikke har `expectTenantIsolation` i sin testfil.
- O4.8, O4.14 eller O4.25 mangler (fritekst og navn til siden eller KI).
- O5.5 mangler (admin stengt ute).
- O4.7 og O4.15 mangler (myk sletting).
