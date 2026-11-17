# Testplan: Publisering av badet

- **Oppgavekort:** `docs/funksjoner/fase2a-publisering-badet.md` (godkjent etter forhåndsvurdering runde 1). Design: `docs/funksjoner/fase2a-publisering-badet-design.md`.
- **Dato:** 17.11.2026 (test-leder, før bygging). Utdyper testplanen i kortet (P1–P9, I1–I17, E1–E9); numrene der er beholdt og står i parentes, så sporingen mot kortet holder. Ved motstrid gjelder kortet.
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** hver sperre (årsak og konsekvens, kostnad på TG3, hulltaking, punkt uten TG, befaringsdato) har testsaker som data, og serveren prøves på at den aldri godtar en publisering der en sperre verken er rettet eller aktivt krysset bort med grunn. Overstyringen logges og kommer tilbake i ny versjon.
  - **De ansatte:** e2e låser trykktallene (2 uten mangler, 4 med én sperre), «Rett nå», «Gå til» og «Tilbake til publisering», og at ingenting den ansatte har valgt går tapt når listen endres.
  - **KI i bunnen:** testene låser at sjekken er ren kode uten KI, at ventende KI-forslag gir advarsel og holdes utenfor snapshot, at godkjent KI-tekst er merket, og at `source = 'ai'` aldri kan bli sperre.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Tiden styres med `TEST_NOW` og `todayInOslo(now)`; ingen test avhenger av klokka i dag. Testdata er oppdiktet (fabrikkene i `tests/factories.ts`, ingen ekte navn eller adresser). e2e kjøres i prosjektene `pc` og `ipad` (liggende 1194 × 834; stående med `setViewportSize({ width: 834, height: 1194 })`).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet. Avvik føres i kortet før testene skrives.

- `src/core/reports/logic/publish-check.ts`: `computePublishCheck(input: PublishCheckInput): PublishCheckFinding[]`, og en ren `canonicalFindings(findings)` (sortert kanonisk form uten overstyringer) som serveren hasher.
- `src/core/reports/logic/codes.ts`: `PUBLISH_CHECK_CODES`, `PUBLISH_BLOCKER_CODES`, `PUBLISH_OVERRIDE_REASON_CODES` (`no_access_or_refused`, `not_applicable_to_room`, `described_elsewhere`, `other`).
- `src/core/reports/logic/publish-check-texts.ts`: tekst per `checkCode` og `missing`.
- Tjenester i `src/core/reports`: `getPublishCheck`, `publishReport`, `startNewVersion`, `listReleases`, `isReportPublishedForAssignment`, og oppslaget av ventende KI-forslag (navnet settes av utvikler og føres her).
- `src/core/access`: `canSeeOverrideReasons(grant)`.
- `src/core/organization`: oppslaget av gyldig sertifisering for en ansatt på en norsk dato.
- Hjelper i tester: `buildPublishCheckInput(overrides)` (ren, i testfilen) og `createPublishableBathroom(organizationId, overrides)` for integrasjon (oppdrag, rapport med låst badmal, våtrom, punkter; legges i `tests/factories.ts` sammen med `createReportReleaseRow` og `createPublishCheckResultRow`).

## 1. Regeltester, testsaker som data (`src/core/reports/logic/publish-check.test.ts`, `it.each`)

Hver sak er en rad `{ name, input, expected: Array<{ checkCode, severity, target }> }`. Forventet liste sammenlignes eksakt (ikke `toContain`), slik at et ekstra funn også gjør testen rød. (P1)

### 1.1 `tg2_tg3_missing_cause_or_consequence`

1. TG2 med kriterium, årsak og konsekvens → ingen sperre.
2. TG2 uten kriterium → én sperre, `missing = criterion`.
3. TG2 med tom årsak / årsak som bare mellomrom og linjeskift → sperre, `missing = cause`.
4. TG2 med blank konsekvens → sperre, `missing = consequence`.
5. TG2 uten alle tre → tre funn (ett per `missing`), samme avvik som mål.
6. TG3 komplett med `band` → ingen.
7. TG3 med `approx` 37 500 → ingen sperre, advarsel `cost_amount_not_rounded`.
8. HMS-avvik uten konsekvens → ingen sperre, advarsel `hms_missing_consequence_or_measure`.
9. TG0/TG1-avvik (om modellen tillater) uten tekst → ingen sperre.
10. Mykt slettet TG2-avvik med mangler → ingenting.

### 1.2 `tg3_missing_cost`

1. TG3 med `cost_type = none` → sperre på avviket.
2. TG2 med `none` → ingen.
3. TG3 med `band` / `approx` → ingen.
4. TG3 uten årsak og uten kostnad → begge kodene, hver én gang.

### 1.3 `wet_or_below_ground_missing_hole`

1. Ubesvart, ingen TGIU → sperre på rommet, `missing = hole_drilling`.
2. Ubesvart, TGIU med utfylt grunn på tilliggende konstruksjoner → ingen (A445).
3. Ubesvart, TGIU med blank grunn på tilliggende → sperre (og `mandatory_without_tg` på punktet, se 1.4.5).
4. `not_done` uten grunn → sperre.
5. `other` med tom tekst og med bare mellomrom → sperre; `other` med tekst → ingen.
6. `owner_refused`, `no_access`, `concrete_or_masonry` → ingen.
7. `owner_refused` med TG2 direkte eller TG2-avvik → ingen sperre, advarsel `tgiu_suggested_not_set`.
8. `done_no_findings` og `done_with_findings` med måleverdi og enhet → ingen.
9. Samme uten måleverdi, og uten enhet → advarsel `hole_reading_missing`, aldri sperre (A446).
10. To våtrom, mangel i det andre → én sperre med riktig `roomId`.
11. Rom som ikke er våtrom (`isWetRoom = false`) med ubesvart hulltaking → ingen. (P5)

### 1.4 `mandatory_without_tg`

1. Punkt med TG0, TG1, eller avvik med valgt TG → ingen.
2. Tomt punkt med `requiresTg = true` → sperre, mål `checkpointKey` (uten `checkpoint_results`-id; punktet har ingen rad).
3. Punkt med bare HMS-avvik → sperre.
4. `requiresTg = false` uten TG (el, rekkverk, HMS-punkt) → ingen.
5. `tg_direct = IU` med grunn → ingen; med tom eller blank grunn → sperre og advarsel `tgiu_details_missing` (A443).
6. Komplett TG2-avvik pluss et avvik `kind = tg`, `tg = null` → sperre med avviket som mål (A444).
7. (P4) `checkpoint_done_without_tg` og `deviation_tg_not_chosen` står aldri på samme mål som sperren (sjekk over hele utdata for alle saker i 1.4).

### 1.5 `inspection_date_missing`

1. Befaringsdato mangler → én sperre på rapportnivå. Finnes → ingen.

### 1.6 Advarsler

1. Hver av de ni punktadvarslene fra «Badet på PC» føres videre med `severity = warning` (én sak per kode, gjenbruker inndata fra `warnings.test.ts`).
2. `ai_suggestion_pending`: antall > 0 → én advarsel per forslag med mål; 0 → ingen.
3. Ingen advarselskode gir noen gang `severity = blocker` (løkke over alle saker).
4. Alle funn har `source = 'rule'`.

### 1.7 Generelt

1. (P2) Samme inndata i omvendt og stokket rekkefølge (rom, punkter, avvik) gir identisk utdata; sorteringen er rom → punktets rekkefølge → `checkCode` → mål.
2. (P3) Slettede rom, punkter og avvik gir ingen funn (inndata kan ha `deletedAt`; `signals.ts` filtrerer, test i 4.3).
3. Alle koder i utdata finnes i `PUBLISH_CHECK_CODES`; alle sperrekoder finnes i `PUBLISH_BLOCKER_CODES`; hver kode og hver `missing` har tekst i `publish-check-texts.ts` (ny kode uten tekst gjør testen rød).
4. Teksten lages fra koden og inneholder aldri `{` eller `}`.

## 2. Enhet, rene funksjoner (uten database)

1. (P6) `canonicalFindings`: lik for samme funn i annen rekkefølge og med ulike overstyringer; ulik når et funn kommer til eller faller bort, eller når mål endres. Serverens SHA-256 av den gir samme fingeravtrykk (test i `publish.test.ts`).
2. (P7) Kanonisk snapshot og `content_hash`: lik uansett nøkkelrekkefølge i objektene; endres når en TG endres.
3. (P8) Begrunnelsen (`overrideInputSchema`, `it.each`): uten kode → avvist; `other` uten tekst, blank, «.», 9 tegn → avvist, 10 tegn → godtatt; fast grunn uten tekst → godtatt; over 1000 tegn → avvist; tekst trimmes; fødselsnummer (oppdiktet med gyldig kontrollsiffer, også med mellomrom) → avvist med `containsNationalId`; ukjent kode → avvist. Meldingene er norsk, aldri rå Zod-tekst.
4. (P9) Statisk importtest (`publish-check.static.test.ts`): `logic/publish-check.ts`, `logic/publish-check-texts.ts` og kanoniseringen importerer ikke `@/db`, `server-only`, `node:crypto`, `drizzle-orm` eller `@/core/ai`, og ingen våtromskoder (ADR 0013 punkt 14). Publiseringstjenesten importerer ikke `@/core/ai`.
5. `PUBLISH_CHECK_CODES` og `PUBLISH_OVERRIDE_REASON_CODES` er like i `logic/codes.ts` og `src/db/schema/reports.ts` (typesjekk som `OVERRIDE_REASON_CODES`), og listen inneholder alle sju sperrekodene fra domenemodellen 4.7, også `bra_missing`, `electrical_missing`, `not_applicable`-kodene som kommer i 2a-3.
6. Gyldig-til: befaringsdato 2026-02-28 → 2027-02-28; 2028-02-29 → 2029-02-28 (skuddår, fast regel i testen); tom dato → tom. Oppbevaring: utgivelse + 10 år, regnet i norsk tid.

## 3. Database (`src/db/schema/publish.test.ts`, rå innsetting)

(I9)

1. Hver CHECK i `publish_check_results` prøves med én godkjent og én avvist rad: ukjent `check_code`; overstyrt advarsel; sperre i utgivelse som ikke er overstyrt; overstyrt uten `overridden_by`/`overridden_at`/`override_reason_code`; ikke overstyrt med noen av de fire satt; `other` uten tekst; tekst over 1000 tegn; `source = 'ai'` med `severity = 'blocker'`.
2. `report_releases`: `version_number = 0` avvist; to rader med samme `(organization_id, report_id, version_number)` avvist; NOT NULL på `released_by`, `signed_by_employee_id`, `certification_id`, `company_id`, `content_hash`, `retain_until`.
3. Sammensatt fremmednøkkel: sjekkrad i organisasjon A som peker på utgivelse i B → avvist; sjekkrad med riktig organisasjon men annen `report_id` enn utgivelsen → avvist; `overridden_by` / `released_by` / `certification_id` fra annen organisasjon → avvist.
4. Begge tabellene står i `tests/tenant-tables.ts` med radbygger og testfil; `tenant-isolation-all-tables.test.ts` er grønn.
5. (I14) Migreringstest (`src/db/migration-0037-publisering.test.ts`, mønster fra `migration-0035-tilbud.test.ts`): database migrert til forrige nummer med rapporter i `draft` og `published` (rå SQL), så kjøres migreringen uten feil, og eksisterende rader er uendret. Nummeret sjekkes ved merge (kollisjon med `0037_ki-i-veien`): journalen har ett innslag per nummer.

## 4. Integrasjon (`src/core/reports/publish.test.ts` m.fl., testdatabasen)

### 4.1 Sjekk og publisering

1. `getPublishCheck` er ren lesing: ingen nye rader i `publish_check_results`, `audit_log` eller hendelser (tell før og etter, kall to ganger).
2. (I1) Sperre som ikke er krysset bort → avvist, ingen utgivelse, rapporten er `draft`.
3. (I1) Utdatert fingeravtrykk → svar med ny liste (ikke feil), ingen utgivelse; manglende fingeravtrykk → samme.
4. Overstyring av advarsel, ukjent kode, ukjent mål, og mål fra et annet rom → avvist, ingenting lagret.
5. Serveren stoler ikke på klienten: `reportId`, `organizationId`, `overriddenBy`, `releasedAt` og versjonsnummer sendt fra skjemaet ignoreres eller avvises; lagret `released_by` og `overridden_by` = `grant.employeeId`, tid fra serveren.
6. Vellykket publisering: versjon 1, snapshot med `schema_version`, malversjon, rom, punkter, TG, avvik, tiltak, kostnad, TGIU og regelbeslutninger; `content_hash` = SHA-256 av kanonisk snapshot; `valid_until` = befaringsdato + 1 år; `retain_until` = 10 år; `company_id` fra oppdraget; sjekkrader for **alle** funn (også advarsler) med `release_id`; `reports.status = published`.
7. (I2) Tvunget feil etter innsetting av utgivelsen (stubbet sjekkradinnsetting) → ingen utgivelse, ingen sjekkrader, rapporten `draft`, ingen hendelser.
8. (I3) To `publishReport` i `Promise.all` → én utgivelse, den andre avvist med tydelig melding.
9. (I4) Publisert rapport kan ikke publiseres igjen.
10. (I15) Rapport uten våtrom, og der badet er mykt slettet → «Rapporten har ikke noe våtrom å publisere.», ingen overstyring mulig.
11. (I13) Befaringsdato mangler: sperre; krysset bort → `valid_until` er null (aldri publiseringsdagen + 1 år).
12. Sertifisering: gyldig til i går (norsk tid) → avvist; utløpsdagen i dag → godtatt (siste gyldige dag); `TEST_NOW` rett før og etter midnatt i Oslo; to gyldige → den med lengst `valid_to`, så id. Utløpt sertifisering gir norsk melding.
13. Hendelser (A453): `report.published` for v1, `report.revised` for v2, `report.publish_override` én per krysset sperre; bare id-er, versjon og koder.

### 4.2 Lås etter publisering (I5)

`it.each` over hver skrivende tjeneste, mot en publisert rapport, med «Rapporten er publisert. Lag ny versjon for å rette.» og ingen endring i databasen:

1. `src/core/reports`: `startReport`, `saveField`, `addDeviation`, `removeDeviation`, `restoreDeviation`, `addMeasure`, `removeMeasure`, `decideSuggestion`, `setTgDirect`, `setCheckpointDone`, og «Rett nå»-skrivingene. En ny skrivetjeneste uten rad gjør testen rød (listen sammenlignes med eksportene i `index.ts`).
2. Synkruten for feltene (`rom/[roomId]/actions.ts`): avvisningen kommer som svar som fjerner endringen fra køen, ikke som feil som stopper køen (jf. T-0001).
3. `src/core/buildings`: `saveBuilding`, `removeBuilding`, `saveFloor`, `removeFloor`, `saveFloorArea`, `saveRoom`, `addRooms`, `removeRoom`, `restoreBuilding`, `restoreFloor`, `restoreRoom` på oppdrag med publisert rapport → avvist; på oppdrag uten rapport eller med `draft` → lov (ingen regresjon).
4. `isReportPublishedForAssignment`: sann bare for publisert; filtrerer på `grant.organizationId`.

### 4.3 Ny versjon (I6)

1. `startNewVersion` setter `draft`, skriver revisjonslogg, rører ikke utgivelse v1 eller sjekkradene (rader sammenlignes før og etter).
2. Neste publisering blir v2; `original_release_date` og `valid_until` kopieres fra v1, også om befaringsdatoen er endret.
3. En mangel som ikke er rettet, kommer tilbake som sperre uten overstyring; publisering uten ny overstyring avvises.
4. Forrige overstyring (kode og tekst for samme `checkCode` og mål) leveres med sjekken som forslag, men lagres aldri uten at den sendes aktivt med publiseringen.
5. `startNewVersion` på `draft` avvises.
6. Utgivelser og sjekkrader: ingen eksportert tjeneste oppdaterer eller sletter dem (statisk søk etter `update(reportReleases)`, `update(publishCheckResults)`, `delete(` og `deleted_at` i tjenestene); `listTrash` tar dem ikke med.

### 4.4 KI (I10, I11)

1. Ventende forslag: bare `outcome = 'ok'`, `status = 'suggested'`, `deleted_at is null`, på rapporten, etter forrige utgivelse → advarsel. `blocked`, `error`, `no_match`, slettet, annen rapport og eldre enn forrige utgivelse → ingen.
2. Ventende forslagstekst står ikke i snapshot. Godtatt og endret KI-tekst har `ai_usage_id` og status i snapshot, aldri forslagsteksten.
3. Publisering lager ingen nye rader i `ai_usage_log` (tell før og etter), og den falske KI-leverandøren blir ikke kalt (spion).
4. Behandling av forslag på publiser-siden går gjennom `decideSuggestion`/samme tjeneste som rommet (samme logging).

### 4.5 Personvern og logg (I12, I17)

1. Begrunnelsestekst med et unikt merke (oppdiktet) står i `publish_check_results.override_reason`, men ikke i `audit_log.changes`, hendelser, applikasjonsloggen (fanget logger) eller feilmeldinger.
2. Snapshot, utgivelse og sjekkrader inneholder ikke partsnavn, e-post, telefon, adresse, matrikkel eller noe fra `claims` (lag en reklamasjon og parter med merker, søk i JSON).
3. `listReleases` slår ikke opp i `claims` (statisk sjekk av spørringen, og test for takstmann og kontor).
4. Snapshot logges aldri (fanget logger ved publisering).

## 5. Tilgang per rolle og tenant-isolasjon (krav for godkjenning)

I `src/core/reports/publish-access.test.ts`.

1. **(I7) Rollematrisen** (`it.each`, rolle × handling: se sjekk, publisere, krysse bort, lage ny versjon, se utgivelser, se begrunnelsestekst):
   - takstmann med gyldig sertifisering: alt lov;
   - takstmann uten / med utløpt sertifisering: ser alt, publisering avvist;
   - kontor: ser sjekk og utgivelser med grunnkode, `overrideReason: null`; publisere, krysse bort og ny versjon avvist;
   - leder: som takstmann;
   - admin med sertifisering: alt;
   - **admin uten sertifisering: ser sjekk, utgivelser og begrunnelser, kan lage ny versjon, kan ikke publisere** (regel 11 og A29);
   - enkeltrettighet `report.publish` uten sertifisering: avvist; med sertifisering: lov;
   - `access.inspectors_edit_all` av: takstmann uten `report.edit` kan ikke lage ny versjon; admin kan fortsatt.
2. **Admin stenges aldri ute:** admin uten andre roller åpner publiser-siden og «Utgivelser» og lager ny versjon, også når alle takstmenn er sperret.
3. **(I16)** Kontor: testen leser det tjenesten (og serverhandlingen) returnerer, og teksten finnes ikke der; `canSeeOverrideReasons` sann for takstmann, leder, admin og usann for kontor (enhetstest i `src/core/access`).
4. **(I8) `expectTenantIsolation`**, ett kall per oppslag i samme testfil: `getPublishCheck`, `publishReport`, `startNewVersion`, `listReleases`, oppslaget av ventende KI-forslag, og `isReportPublishedForAssignment`.
5. **Id fra skjemaet styrer aldri organisasjonen:** bruker i B sender A sin `assignmentId`, `reportId` og mål-id-er → 404 (`AccessDeniedError`), ingen rader endret i A (tell før og etter). Oppdrag fra annet oppdrag i samme organisasjon og mykt slettet oppdrag → 404.
6. «Gå til»-lenken bygges på serveren fra id-er; en `href` eller sti sendt fra klienten brukes aldri (test på svaret fra `getPublishCheck`).
7. Ingen nye rettigheter i listen i `src/core/access` (bare hjelperen `canSeeOverrideReasons`).

## 6. E2E (`e2e/fase-2a-publisering-badet.spec.ts`, prosjektene `pc` og `ipad`)

Data: testen lager sitt eget oppdrag med badmal, våtrom og sertifisert takstmann i en egen prøveorganisasjon (direkte mot `e2eDatabaseUrl()`, oppdiktet), slik at den ikke avhenger av andre tester.

1. **(E1) Tellemerke:** «Se over og publiser» på rommet viser «2 må rettes, 3 bør sees over», også på iPad stående; tallet oppdateres etter en retting.
2. **(E2) «Gå til» og tilbake:** «Gå til» åpner riktig punkt med fokus; rommet viser «Tilbake til publisering (2 igjen)»; tilbake gir oppdatert liste.
3. **(E3) Trykktall:** uten mangler → publisert med 2 trykk; én sperre krysset bort med fast grunn → 4 trykk, ingen tekst; én sperre rettet med «Rett nå» → 4 trykk. Tellingen gjøres med en hjelper som teller `click`/`tap` i testen.
4. **(E4) Sperret knapp:** «Publiser (2 må rettes eller krysses bort)»; trykk flytter fokus til første sperre. Bryteren «Publiser likevel» er minst 44 pt og ikke en avkrysningsboks; grunnene vises under funnet, ingen dialog, ingen `select`. «Annet» krever tekst før knappen åpnes.
5. **(E5) Etter publisering:** «Versjon 1 er publisert», badet er bare lesbart (ingen redigerbare felt), «Lag ny versjon» er sekundærknapp og ikke ved siden av hovedhandlingen; ny versjon gir sperren tilbake med «I versjon 1 krysset du bort dette: …» og «Bruk samme begrunnelse», som må trykkes.
6. **(E6) «Utgivelser»:** leder ser versjon, hvem, når og begrunnelse; kontor ser grunnen men ikke teksten (teksten finnes ikke i HTML-en).
7. **(E7) Synk og nett:** med endringer i køen (lagring holdt igjen med `page.route`) står «Venter på synk (N endringer)» og knappen er sperret; `context.setOffline(true)` → «Publisering krever nett. Alt er lagret på enheten.», listen vises fortsatt og tellemerket virker lokalt.
8. **(E8) Universell utforming:** axe uten feil på publiser-siden med sperrer, med grunnvalg åpent, og etter publisering, på PC og iPad stående; hele flyten med Tab, mellomrom og Enter; fokus synlig; ingen vannrett rulling på iPad; knapper minst 44 pt, hovedknappen 56–72 pt.
9. **(E9) «Rett nå», KI og endret liste:** «Rett nå» for hulltaking, kostnadsintervall og TG (TG-knappene er aldri forhåndsvalgt) fjerner sperren uten sideskifte; ventende KI-forslag på siden kan godtas og avvises; endre data i en annen fane → «Listen er oppdatert», valgt grunn og påbegynt tekst står for samme funn, ny sperre merket «Ny siden du åpnet siden».
10. **Manglende rett:** takstmann uten gyldig sertifisering ser «Du kan ikke publisere: sertifiseringen din gikk ut …» øverst før klikk, og listen og «Gå til» virker.
11. **«Dette publiseres»** viser TG per rom og kostnad, og stemmer med snapshot etter publisering.
12. **404:** publiser-side for oppdrag i annen organisasjon og ugyldig id gir 404.

## 7. Øvrig

1. `package.json` 0.17.0 (eller høyere om main har gått forbi), vist i `/api/helse`.
2. `pnpm size` kjørt, publiser-ruten innenfor grensen.
3. Ingen ny avhengighet.
4. Domenemodellen 4.7, ordlisten og ADR 0015 er oppdatert (sjekkes ved gjennomgang).

## Godkjenning

Avvises hvis noe i avsnitt 5 (rollematrisen, admin stenges aldri ute, `expectTenantIsolation` for alle seks oppslag, id fra skjemaet) mangler eller er rødt. Avvises også hvis 4.1.4–4.1.5 (serveren stoler ikke på klienten), 4.1.7–4.1.8 (én transaksjon, én utgivelse), 4.2 (lås), 4.3.3 (mangelen kommer tilbake), 4.4.3 (ingen KI) eller 4.5.1 (ingen fritekst i logg) mangler. `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` må være grønne på `pc` og `ipad`.
