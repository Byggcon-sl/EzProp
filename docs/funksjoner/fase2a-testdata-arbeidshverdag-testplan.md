# Testplan: Testdata som ligner en ekte arbeidshverdag (del 1)

- **Oppgavekort:** `docs/funksjoner/fase2a-testdata-arbeidshverdag.md`
- **Dato:** 13.11.2026 (test-leder, før bygging)
- **Branch:** `testdata-arbeidshverdag`
- **Støtter hovedmål:**
  - **De ansatte:** testene låser at testmiljøet alltid har en full, lik arbeidsdag (alle statuser, flere måneder, reklamasjoner, tid), og at skriptet aldri rører ekte arbeid, admin eller innstillinger.
  - **KI i bunnen:** vasketesten viser at oppdiktede, ekte-lignende parter blir vasket før KI, uten KI-kall og uten nye rader i `ai_usage_log`.
  - **Færre reklamasjoner:** faglige regeltester sikrer at dataene ikke lærer bort feil fag (arealtype, eierform, reklamasjonsdatoer), og ytelsestesten finner trege lister før lansering.

## Felles for alle tester

- Vitest mot `TEST_DATABASE_URL`, `resetDatabase` i `beforeEach`, så `runSeed(env)` (Byggcon og admin finnes, som i drift). `console.log` dempes som i `src/db/seed/run.test.ts`, unntatt i loggtestene (seksjon 7), som fanger den.
- Fast tid: `seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED })`. Ingen falsk systemklokke.
- `APP_ENVIRONMENT=test` settes i testmiljøet for Vitest (`tests/setup-env.ts`) og for e2e-hjelperen. Vakttestene setter verdien selv per tilfelle og tilbakestiller etterpå.
- Testhjelper `countRows()` (i testfilen) gir antall rader per tabell i «Data» i kortet, pluss `events`, `audit_log`, `number_sequences` (og verdien), `users`, `sessions`, `accounts`, `ai_usage_log`, `organizations`, `integration_connections`.
- «Regeltester» her er tabelltester (`it.each`) over planen fra `buildTestdataPlan` og over radene i databasen. Ingen TG og ingen regelmotor (kortet: ingen nye regler).
- E2e kjøres i prosjektene `pc` og `ipad`.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet. Avvik føres i kortet.

- `src/db/seed/seeded-random.ts`: `createSeededRandom(seed: number)` med `next()`, `int(min, max)`, `pick(list)`.
- `src/db/seed/testdata.data.ts`: faste lister (etternavn, fornavn, gatenavn, postnummer og kommune, meglerfirma, borettslagsnavn), `TESTDATA_PHONE_PATTERN`, `TESTDATA_EMAIL_DOMAIN = "testdata.invalid"`, `TESTDATA_SEED`, `TESTDATA_GNR_MIN = 9001`, `TESTDATA_GNR_MAX = 9099`.
- `src/db/seed/testdata.ts`: `buildTestdataPlan({ seed, anchor })` (ren), `seedTestdata({ db, now, seed })` → sammendrag med antall laget og hoppet over per tabell. Kaster egne feil med norsk melding: organisasjonen mangler, bruker i annen organisasjon.
- `src/db/seed/testdata-guard.ts`: `assertTestdataAllowed(env)` (eller tilsvarende), kalt først i `seedTestdata`. Felles `LOCAL_HOSTS` (flyttes fra `e2e/database-guard.ts` til en felles konstant som begge bruker).
- `src/db/seed/testdata-index.ts`: inngangen for `pnpm db:seed:testdata`, med `runTestdataCli(deps)` eller tilsvarende som kan kalles i test (fanger feil, skriver bare feiltype, SQLSTATE og TD-nøkkel, gir kode 1).
- Oppslagene i skriptet som tar `organizationId` (for eksempel `findTestdataOrders`, `findTestdataContacts`, `findTestdataFirms`, `findTestdataProperties`, `findTestdataEmployees`, `findAnchorOrder`) eksporteres for testene.

## 1. Frøgeneratoren, `src/db/seed/seeded-random.test.ts` (ny, ren)

1. **samme frø gir samme rekkefølge:** 1000 trekk med frø 42 er like to ganger.
2. **annet frø gir annen rekkefølge:** frø 42 og 43 gir ulike første 20 trekk.
3. **`int(min, max)` holder seg innenfor** (begge ender med, 10 000 trekk) og treffer begge ender.
4. **`pick` på tom liste kaster**, ikke `undefined`.
5. **ingen `Math.random`:** kildeteksten i `seeded-random.ts`, `testdata.ts` og `testdata.data.ts` bruker ikke `Math.random` eller `Date.now` (statisk sjekk).

## 2. Planen og datafila, `src/db/seed/testdata.data.test.ts` (ny, ren, regeltester)

`plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW })`.

### 2.1 Like data
1. **samme frø og anker gir lik plan** (`toEqual`, hele objektet).
2. **annet anker flytter bare datoene:** samme nøkler, navn og areal; datoene flyttet med differansen.
3. **annet frø gir annen plan**, men samme antall i hver gruppe (tallene i akseptkriteriet holder for flere frø: `it.each` over fem frø).

### 2.2 Mengde (akseptkriterium 1)
4. **10–15 ansatte, 12 i dagens plan**, alle roller i `employeeRoles` unntatt `admin` brukt. Testen leser konstanten, slik at en ny rolle gjør den rød. Ingen ansatt har `admin` (A304).
5. **4–5 meglerfirma**, hvert med minst én megler.
6. **45–55 eiendommer**, alle tre slag: enebolig (med minst én `terraced` og én `semi_detached`), leilighet i sameie, leilighet i borettslag, fritidsbolig.
7. **alle fire statuser** blant oppdragene, og minst én ordre som ikke er gjort om.
8. **tidsspenn:** eldste dato minst 3 måneder før ankeret, seneste befaring minst 3 uker etter, ingen dato over 4 måneder bak eller 5 uker fram.
9. **4–5 reklamasjoner** med alle fem utfall (`open`, `rejected`, `upheld`, `settled`, `withdrawn`).
10. **`external_ref` er unike og har formen `TD-NNNN`**; `TD-0001` står først i planen.

### 2.3 Ingen ekte-lignende data (akseptkriterium «Ingen ekte-lignende data»)
11. **alle etternavn** (ansatte, meglere, selgere, kjøpere) står i den faste listen.
12. **alle e-poster ender på `@testdata.invalid`**; søk med regex i `JSON.stringify(plan)` finner ingen andre.
13. **alle telefonnumre følger `TESTDATA_PHONE_PATTERN`**, og hvert nummer går gjennom telefonvalideringen i `src/core/contacts/schemas.ts`.
14. **alle gnr i 9001–9099**, både eiendom og ordre med matrikkel.
15. **postnummer og kommune er gyldige par i Nordland og Troms** (fra den faste listen; testen sjekker at hvert par i planen står i listen, og at kommunenumrene starter med 18 eller 55).
16. **organisasjonsnummer er tomme** på alle firma.
17. **ingen fritekst har elleve sifre på rad** (regex over alle strenger i planen).
18. **firma- og borettslagsnavn treffer ikke kjente kjeder** (kort liste i testen, uten skille på store og små bokstaver, også som delstreng).
19. **ingen ansatt deler fullt navn eller e-postdomene med `SEED_ADMIN_NAME`/`SEED_ADMIN_EMAIL`** (leses fra testmiljøet og fra `.env.example`).
20. **ingen gjetteord eller TG i fritekst:** ingen streng har «antas», «trolig», «sannsynligvis», «TG0–TG3» eller «TGIU». Ingen reklamasjonstekst sier at nektet hulltaking gir TG2.

### 2.4 Faglige krav (fagansvarlig, én test per punkt)
21. **arealtype følger `suggestAreaType`** for hver romtype i planen (garasje og utebod BRA-e, BRA-b bare for innglasset balkong).
22. **etasjens arealtyper stemmer med rommene:** etasje med BRA-e eller BRA-b har rom med samme arealtype.
23. **ALH bare på loft og hems**, aldri regnet inn i BRA på samme etasje.
24. **kryperom og uinnredet loft er `not_bra`.**
25. **«under terreng» stemmer med etasjen** (kjeller ja, ellers nei; unntaket for kryperom slik `suggestBelowGround` gir det).
26. **hver bolig har minst ett bad og ett kjøkken** (eller stue/kjøkken).
27. **metode `drawing` bare på fellesbod**, ellers `laser`.
28. **størrelser:** leilighet 35–120 m², enebolig 90–250 m², fritidsbolig 30–120 m² (sum BRA per eiendom).
29. **eierform og matrikkel:** sameie har `snr` og ingen andel; borettslag har lagets navn og andelsnummer og ingen `snr`; enebolig og varianter er selveier; fritidsbolig er selveier, minst én med `fnr`.
30. **fellesarealer bare på sameie og borettslag.**
31. **byggeår i datafila treffer aldersreglene:** minst ett bad fra før 2000, minst ett på 0–5 år, minst ett innenfor ±2 år av en levetidsterskel. Byggeår skrives ikke til databasen (A300).
32. **reklamasjoner:** bare på ferdige eller fakturerte oppdrag; mottatt etter ferdig-dato; beløp bare ved medhold og forlik (og da > 0); bygningsdelene spres (minst tre ulike).
33. **tid og team:** ferdige og fakturerte har befaring før ferdig-dato og i fortiden; egenerklæring mottatt på ferdige; sidemann er aldri ansvarlig; alt innenfor fire måneder (gyldighet ett år brytes ikke).
34. **tidsregistrering:** befaring 1–3 t, rapportskriving 2–5 t; snittet for leilighet er lavere enn for enebolig med kjeller; bare på oppdiktede ansatte.
35. **sertifiseringer:** hver ansvarlig takstmann på ferdige og fakturerte oppdrag har gyldig sertifisering på befaringsdagen; nøyaktig én takstmann har utløpt sertifisering (utløpt før ankeret); utsteder og nummer er oppdiktet (A307).
36. **skjemaene godtar planen:** eiendom, bygning, etasje, areal, rom, kontakt, firma og reklamasjon går gjennom appens Zod-skjemaer uten feil (`it.each`).
37. **kodelistene:** hver romtype, arealtype, metode, partsrolle, status, boligtype og eierform finnes i kodelisten sin.

## 3. Produksjonsvakten, `src/db/seed/testdata-guard.test.ts` (ny, ren) (A302)

Én test per tilfelle (`it.each`). Hver feil har norsk melding, og meldingen inneholder verken adressen, verten, brukernavnet eller passordet (testen sjekker alle fire delene av adressen).

### 3.1 `APP_ENVIRONMENT`
1. godtar `development` og `test`.
2. stopper `production`, tom, manglende, `Production`, `TEST`, ` test `, `test\n`, `staging`, `dev`.

### 3.2 Verten i `DATABASE_URL` (med `APP_ENVIRONMENT=test`)
3. godtar `localhost`, `127.0.0.1`, `[::1]` og `psql-ezprop-test.postgres.database.azure.com`.
4. stopper `psql-ezprop-test-prod.postgres.database.azure.com`.
5. stopper `psql-ezprop-test.example.com`.
6. stopper `psql-ezprop-prod.postgres.database.azure.com`.
7. stopper `PSQL-EZPROP-PROD.postgres.database.azure.com` (store bokstaver).
8. godtar `PSQL-EZPROP-TEST.postgres.database.azure.com` (samme server, tolkeren gjør om til små).
9. stopper komma i vertsdelen: `localhost,psql-ezprop-prod.postgres.database.azure.com`.
10. stopper adresse som ikke kan tolkes, tom og manglende `DATABASE_URL`.
11. stopper `?host=` og `?PGHOST=` i spørredelen (også med lokal vert foran).
12. stopper `psql-ezprop-test.postgres.database.azure.com.evil.no` og vert med punktum til slutt.
13. **leser samme verdi som klienten:** vakten bruker `getEnv().DATABASE_URL` (statisk sjekk av kilden, og test der `process.env.DATABASE_URL` er ugyldig gir stopp).
14. **`LOCAL_HOSTS` er felles:** `e2e/database-guard.ts` og vakten importerer samme konstant (statisk sjekk), og `tests/e2e-database-guard.test.ts` er fortsatt grønn.

## 4. Seed-steget mot databasen, `src/db/seed/testdata.test.ts` (ny, integrasjon)

### 4.1 Første kjøring (akseptkriterium 1 og 2)
1. **alt ligger i Byggcon** (`brand.companyName`): antall ansatte, firma, eiendommer, ordre, oppdrag og reklamasjoner som i planen.
2. **hvert oppdrag har ansvarlig, sidemann (annen person), kontor og parter.**
3. **befarte oppdrag har bygning, etasje, rom og `floor_areas`**; bestilte uten befaring har ingen.
4. **ferdige og fakturerte har `work_sessions`**, og hver økt tilhører en oppdiktet ansatt (e-post på `testdata.invalid`).
5. **fakturert nås gjennom gyldige statusbytter:** hendelsene for hvert fakturert oppdrag viser bestilt → under arbeid → ferdig → fakturert, i økende tid.
6. **laget gjennom tjenestene:** `events` finnes for opprettelse, omgjøring og statusbytte; aktøren er en oppdiktet ansatt med riktig rolle (kontor lager, ansvarlig bytter status, leder registrerer reklamasjon). Admin fra `SEED_ADMIN_EMAIL` er aldri aktør i `events` eller `audit_log`.
7. **domenetidspunktene er flyttet bakover:** `orders.received_at`, statusdatoene på `assignments`, `claims.received_at` og `events.occurred_at` på TD-rader stemmer med planen.
8. **revisjonsloggen er urørt:** `audit_log.received_at` og `occurred_at` på TD-radene ligger mellom start og slutt på kjøringen (ikke planlagt dato). Statisk sjekk: kildeteksten i `testdata.ts` har ingen `update(auditLog)` eller `UPDATE audit_log`.
9. **sertifiseringer:** publiseringssperren i `src/core/access/guards.ts` gir `report.publish` for en ansvarlig takstmann med gyldig sertifisering og nekter for takstmannen med utløpt.
10. **radene stemmer med planen** i nøkler og feltverdier, uten id og tidsstempler (determinisme mot databasen).
11. **ingen innlogging:** ingen oppdiktet ansatt har rader i `sessions` eller `accounts`, og ingen har rollen `admin`.
12. **ingen KI:** `ai_usage_log` har samme antall rader før og etter.

### 4.2 Idempotens (akseptkriterium 4)
13. **andre kjøring skriver ingenting:** `countRows()` og verdien i `number_sequences` er like; `updated_at` er uendret på alle TD-rader.
14. **andre kjøring med `now` 30 dager fram** endrer ingenting og flytter ingen datoer (ankeret er `created_at` på `TD-0001`).
15. **tredje kjøring** gir det samme som andre.

### 4.3 Avbrutt kjøring og myk sletting (akseptkriterium 6 og «Myk sletting»)
16. **bare ansatte finnes** (kjøring avbrutt etter ansatte): neste kjøring fyller ut resten, og antall rader blir likt en full første kjøring, uten kopier.
17. **avbrutt midt i oppdragene** (påtvunget feil etter `TD-0020`): neste kjøring fyller ut fra der den stoppet; ingen dobbel ordre, ingen hull i nummerserien utover det den avbrutte transaksjonen eventuelt brukte (rullet tilbake).
18. **mykt slettet TD-ordre** gjenopplives ikke og får ingen kopi.
19. **mykt slettet TD-kontakt** gjenopplives ikke og får ingen kopi.
20. **mykt slettet oppdiktet ansatt** gjenopplives ikke og får ingen kopi.
21. **skriptet setter aldri `deleted_at`:** ingen rad får `deleted_at` under kjøringen (sammenlign før og etter), og kildeteksten har ingen skriving til `deleted_at`.

### 4.4 Organisasjonen mangler og bruker i annen organisasjon
22. **Byggcon mangler:** feilen har meldingen «Kjør pnpm db:seed først.» og `countRows()` er uendret (også nummerserien).
23. **TD-e-post er bruker hos en ansatt i en annen organisasjon:** feilen er norsk og inneholder ikke e-postadressen; `countRows()` er uendret; brukeren har ingen ansatt i Byggcon; den andre organisasjonens ansatt har samme roller og `updated_at`.
24. **TD-e-post er bruker uten ansatt noe sted:** oppførselen står i kortet (brukeren gjenbrukes og kobles til Byggcon); testen låser den valgte oppførselen.

### 4.5 Vakten i seed-steget
25. **vakten kjøres før første skriving** (`it.each` over et utvalg fra seksjon 3: `production`, tom, prod-vert, komma, `?host=`): feil med norsk melding, `countRows()` og nummerserien uendret, og ingen transaksjon åpnet (spion på `db.transaction`).

### 4.6 Tenant-isolasjon (akseptkriterium «Alt havner i organisasjonen fra pnpm db:seed»)
26. **prøveorganisasjonen er urørt:** med `runSampleSeed` kjørt først har prøveorganisasjonen samme radtall før og etter.
27. **annen organisasjon med ordre `TD-0001`** tolkes ikke som «finnes»: Byggcon får sin egen `TD-0001`, og den andre ordren er uendret (`updated_at`, `row_version`).
28. **annen organisasjon med kontakt med samme TD-e-post** tolkes ikke som «finnes» og endres ikke.
29. **annen organisasjon med firma med samme navn og type** tolkes ikke som «finnes» og endres ikke.
30. **annen organisasjon med eiendom med samme kommune + gnr + bnr** tolkes ikke som «finnes» og endres ikke.
31. **ankeret leses bare i Byggcon:** `TD-0001` i en annen organisasjon med `created_at` 60 dager tilbake flytter ikke Byggcons datoer.
32. **`expectTenantIsolation` på hver ny oppslagsspørring** som tar `organizationId` (én `it` per spørring: ordre, kontakter, firma, eiendommer, ansatte, ankeret). Testfilen ligger i samme mappe som `testdata.ts`.
33. **ingen ny tabell:** `tests/tenant-tables.ts` og `tests/tenant-isolation-all-tables.test.ts` er uendret og grønne.

### 4.7 Ekte arbeid og admin røres ikke (akseptkriterium «Ekte arbeid røres ikke»)
34. **en ordre, kontakt og ansatt uten TD** (laget før kjøringen) har samme verdier, `updated_at` og `row_version` etter.
35. **seed-admin** har samme roller, er aktiv, og `countActiveAdmins` (`activeAdminCount`) er lik før og etter.
36. **admin ser fortsatt reklamasjonene** (`claims.read` via tjenesten).
37. **`organizations.settings`** (`time_tracking.enabled`, `time_tracking.baseline`, `ai.enabled`, `access.inspectors_edit_all`) er like før og etter, både når de er av og når de er på.
38. **`integration_connections`** er like før og etter.

### 4.8 Tilgang per rolle med testdata (akseptkriterium «Tilgang med testdata»)
Brukere: en oppdiktet ansatt med hver rolle (takstmann, kontor, leder) og seed-admin. `it.each` over rollene.
39. **takstmann, kontor, leder og admin ser TD-oppdragene** i `listWorkQueue` og `listOrders` (samme antall som i dag for rollen).
40. **bare leder og admin ser reklamasjonene** i `claims.read`-tjenesten; takstmann og kontor får `AccessDeniedError`.
41. **takstmann og kontor kan ikke endre en reklamasjon**; leder og admin kan.
42. **takstmannen med utløpt sertifisering** mangler `report.publish`, men har lesetilgang som før.
43. **admin stenges ikke ute:** etter kjøringen gir `requireOrganizationAccess(admin, byggcon, p)` tilgang for hver rettighet i `PERMISSIONS`.

### 4.9 Vasken (akseptkriterium «Vasken»), `src/db/seed/testdata-redaction.test.ts` (ny, integrasjon)
44. henter et TD-oppdrag med selger, kjøper, kontakt og matrikkel, lager vaskekonteksten med `loadKnownValues` som i dag, og kjører `redactText` på en tekst som nevner partens navn, e-post, telefon (`+47 000 NN NNN`), gateadresse og «gnr 9012/34». Ingen av verdiene står igjen; alle er byttet med plassholdere.
45. **ingen KI-kall:** falsk leverandør har null kall, og `ai_usage_log` er uendret.

### 4.10 Ytelse (akseptkriterium «Ytelse», A306)
Etter full kjøring og én oppvarmingskjøring per kall. Grense 2000 ms per kall, målt med `performance.now()`.
46. `listWorkQueue` uten filter, med søketekst (et etternavn fra listen) og med statusfilter.
47. `countWorkQueueByStatus` uten filter og med søketekst.
48. `listOrders` uten filter, med søketekst og med statusfilter.

## 5. Inngangen og loggen, `src/db/seed/testdata-index.test.ts` (ny, integrasjon)

1. **vellykket kjøring logger bare antall og `TD-`-nøkler:** fanget stdout og stderr har ingen `@`, ingen fornavn, etternavn eller gatenavn fra datafila, ingen telefonnummer.
2. **påtvunget databasefeil** (for eksempel brudd på en sjekk midt i en TD-ordre): utskriften har feiltype, SQLSTATE og TD-nøkkel, og ingen `@`, navn, gatenavn, vert, spørringsparametre eller stakk. Kode 1.
3. **vaktfeil:** utskriften er den norske meldingen, uten adresse eller vert. Kode 1.
4. **inngangen sender `new Date()` og det faste frøet** (statisk sjekk eller spion).

## 6. Utrulling, oppsett og dokumentasjon (utvidede, rene tester)

### 6.1 `tests/deploy-workflow.test.ts`
1. steget «Migrering og seed» kaller `pnpm db:seed:testdata` **etter** `pnpm db:seed:testoppdrag`.
2. steget har `APP_ENVIRONMENT: ${{ env.ENVIRONMENT_NAME }}`, ikke fast tekst.
3. `SEED_ADMIN_EMAIL` skrives ikke ut i steget (ingen `echo` av variabelen).
4. ingen annen arbeidsflyt i `.github/workflows/` kaller `db:seed:testdata`.

### 6.2 Øvrig
5. `.env.example` har `APP_ENVIRONMENT=development` (test i `tests/start-script.test.ts` eller ny liten test).
6. `start.sh` virker med bash 3.2 dersom den endres (eksisterende test i `tests/start-script.test.ts`).
7. `package.json` har skriptet `db:seed:testdata` som peker på `testdata-index.ts`, og versjonen er økt (minor).
8. **ingen nye avhengigheter:** `dependencies` og `devDependencies` er like `main` (sjekkes i gjennomgangen, ikke som test).
9. `tests/no-model-names.test.ts` og produktnavnsregelen i lint er grønne for de nye filene.

## 7. E2e, `e2e/fase-2a-testdata.spec.ts` (ny, prosjektene `pc` og `ipad`)

`beforeAll`: `assertLocalOrTestDatabase`, så `seedTestdata` via en hjelper i `e2e/helpers.ts` med `APP_ENVIRONMENT=test` (vakten kjører også). Innlogging med `chooseCodeLogin`. De oppdiktede ansatte kan ikke logge inn, så e2e bruker egne innloggingsbrukere med riktig rolle i Byggcon (som i `e2e-ensure-inspector`), ikke TD-ansatte.

1. **takstmann ser arbeidskøen** (`/arbeidskoe`) med minst ett TD-oppdrag med befaring denne uken.
2. **kontor ser ordrelisten** (`/ordre`) med alle fire statuser, og statusfilteret gir bare valgt status.
3. **søket finner et TD-oppdrag** på et etternavn fra datafila.
4. **leder ser reklamasjonene** på oppdragssiden (`/oppdrag/[id]`, delen «Reklamasjoner») for et TD-oppdrag med sak, og kan åpne saken.
5. **takstmann ser ikke reklamasjonsdelen** på samme oppdrag, og direkte adresse `/oppdrag/[id]/reklamasjoner/[claimId]` gir ingen tilgang.
6. **admin ser reklamasjonene** (admin stenges ikke ute).
7. **tidsstatistikken** (`/statistikk/tid`) viser tall for leder når tidsmåling er slått på av testen selv (skriptet slår den ikke på).
8. **bygninger og rom** (`/oppdrag/[id]/bygninger`) viser etasjer, rom og areal for et befart TD-oppdrag.
9. **uten nett, bare `ipad`:** åpne `/arbeidskoe` med nett, slå av nettet (`context.setOffline(true)`), last siden på nytt: TD-oppdragene vises. Slå på nett igjen til slutt.
10. **tilgjengelighet:** axe-sjekk på arbeidskøen og ordrelisten med full testdata gir ingen alvorlige brudd.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Mengde og slag | 2.4–2.10, 4.1 |
| Team, bygning, `work_sessions` | 4.2–4.4, 2.33–2.34 |
| Faglige krav | 2.21–2.37, 4.9 |
| Andre kjøring skriver ingenting | 4.13–4.15 |
| Revisjonsloggen urørt | 4.8 |
| Avbrutt kjøring, myk sletting | 4.16–4.21 |
| Like data | 1.1–1.2, 2.1–2.3, 4.10 |
| Byggcon mangler | 4.22 |
| Bruker i annen organisasjon | 4.23–4.24 |
| Vakten | 3.1–3.14, 4.25, 5.3 |
| Tenant | 4.26–4.33 |
| Ekte arbeid røres ikke | 4.34–4.38, 4.11 |
| Ingen ekte-lignende data | 2.11–2.20 |
| Vasken | 4.44–4.45 |
| Tilgang med testdata | 4.39–4.43, e2e 4–6 |
| Myk sletting | 4.18–4.21 |
| Logging | 5.1–5.3 |
| Ytelse | 4.46–4.48 |
| E2e PC og iPad, uten nett | e2e 1–10 |
| Utrulling | 6.1–6.4 |
| Ingen nye avhengigheter | 6.8 |

## Merknader til kortet (lite, ikke stopp)

- **Reklamasjonslisten:** det finnes ingen egen side for alle reklamasjoner; de vises i delen «Reklamasjoner» på oppdragssiden. E2e prøver den delen og den direkte adressen til saken. Kortets «leder ser reklamasjonslisten» tolkes slik.
- **Bruker uten ansatt noe sted (4.24):** kortet sier ikke hva som skjer når en TD-e-post finnes som bruker uten ansatt. Utvikleren velger og skriver det i kortet; testen låser valget.
- **Tidsstatistikken:** skriptet slår ikke på tidsmåling, så e2e slår den på selv for sin egen kjøring. Testmiljøet viser derfor ingen tall før admin slår den på. Bør stå i driftsavsnittet.
- **Delt testdatabase:** full kjøring av testdata tar tid og gir mange rader. Testfilene som kjører `seedTestdata` bør bruke `describe.sequential` og ikke kjøre parallelt med andre filer mot samme database (kjent kilde til tilfeldige røde kjøringer).

## Godkjenningskrav for test-leder

Avvises hvis noe av dette mangler: vakten (seksjon 3, alle tilfeller), tenant-testene 4.26–4.33 med `expectTenantIsolation` per oppslag, tilgang per rolle 4.39–4.43, admin urørt 4.35–4.36 og 4.43, myk sletting 4.18–4.21, og e2e uten nett i iPad-størrelse.
