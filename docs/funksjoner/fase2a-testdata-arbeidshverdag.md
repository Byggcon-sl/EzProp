# Funksjon: Testdata som ligner en ekte arbeidshverdag

- **Fase:** 2a (prioritert av Ståle 13.11.2026, tas før resten av 2a)
- **Modul:** `src/db/seed` (testdata), `.github/workflows/deploy-azure.yml` (kall fra utrullingen)
- **Status:** klar for bygging (runde 1 fra forenkler, ki-ansvarlig, fagansvarlig, sikkerhet-personvern og test-leder er tatt inn 13.11.2026)
- **Branch:** `testdata-arbeidshverdag` (bygger på `main`)
- **Støtter hovedmål:**
  - **De ansatte:** når de logger inn i testmiljøet, ser de med en gang en full arbeidsdag (arbeidskø, ordre, oppdrag i alle statuser, kalender over flere måneder, reklamasjoner, tidsstatistikk). Da kan de prøve og si fra om systemet uten å lage alt selv først.
  - **KI i bunnen:** realistiske, oppdiktede navn, adresser, matrikkel og telefonnumre i partene gir vasken før KI (`src/core/ai/redaction.ts`, `redact-text.ts`) noe ekte-lignende å prøve seg på, uten risiko. En test viser at vasken treffer.
  - **Færre reklamasjoner:** reklamasjonssakene, listene, søket, statistikken og ytelsen prøves med en mengde data som ligner drift, slik at feil finnes før lansering. Dataene lærer ikke bort feil fag (arealtype, eierform og reklamasjoner følger reglene under).

## Problem
Testmiljøet har i dag bare fire testoppdrag i en egen prøveorganisasjon (`pnpm db:seed:testoppdrag`). De ansatte logger inn i Byggcon-organisasjonen og ser nesten ingenting. Ståle 13.11.2026: «Legg inn testdata og fiktive navn, eiendommer, bilder med mer for å teste løsningen. Reelle data kommer i produksjonsmiljøet.» Uten slike data må hver tester lage oppdrag for hånd, og lister, søk, statistikk og ytelse blir aldri prøvd med en mengde som ligner drift.

## KI i bunnen
- KI lager ikke testdataene. Et fast skript med fast frø gjør dem like hver gang og testbare, og koster 0 kr.
- Ingen nye KI-kall, ingen nye rader i `ai_usage_log`, ingen ny kode i `src/core/ai`. Idempotenstesten teller `ai_usage_log` før og etter.
- Vasken prøves på testdataene: én test henter et TD-oppdrag med parter, kontakt og matrikkel, lager vaskekonteksten slik den lages i dag, og viser at partens navn, e-post, telefon, adresse og «gnr 9012/34» blir byttet ut med plassholdere.
- Når 2a-2 «Badet på PC» utvider testdataene med funn og bilder, vurderer ki-ansvarlig oppgaven på nytt (evalueringssettene kan da bruke dem).

## Brukerhistorier
- Som **takstmann** vil jeg **se egne oppdrag med befaringstider denne og neste uke** i testmiljøet, slik at jeg kan prøve arbeidskøen og oppdragssiden som en vanlig dag.
- Som **kontor** vil jeg **se ordre, oppdrag i alle statuser og fakturerte oppdrag over flere måneder**, slik at jeg kan prøve søk, filtre og arbeidsflyten.
- Som **leder** vil jeg **se reklamasjonssaker og tidsstatistikk** med data fra flere takstmenn og kontorer. Reklamasjonssakene vises per oppdrag; det finnes ingen samlet liste (funn F2).
- Som **admin** vil jeg **kjøre skriptet på nytt** uten at noe dobles, og vite at det aldri kan kjøres i produksjon.

## Omfang
**Med:**
- Nytt skript `pnpm db:seed:testdata` (`src/db/seed/testdata-index.ts`, `testdata.ts`, data i `testdata.data.ts`, vakten i `testdata-guard.ts`, frøgeneratoren i `seeded-random.ts`). Bygger på `runSeed` (organisasjonen Byggcon, selskapene og kontorene) og mønsteret i `sample-assignments.ts` (sjekk først, lag bare det som mangler).
- **Organisasjonen:** dataene legges i organisasjonen fra `pnpm db:seed` (Byggcon), den de ansatte logger inn i. Ikke i prøveorganisasjonen.
- **Selskaper og kontorer:** de som `runSeed` lager. Ingen nye.
- **Ansatte:** 12 oppdiktede ansatte fordelt på selskapene og kontorene, i **alle roller unntatt admin** (A268). Alle roller i `employeeRoles` (`src/db/schema/organizations.ts`) unntatt `admin` brukes; testen leser konstanten, slik at en ny rolle gjør den rød. Etternavnene tas fra en fast, oppdiktet liste i `testdata.data.ts`, slik at de er lette å kjenne igjen i ansattlisten. Ingen deler fullt navn eller e-postdomene med `SEED_ADMIN_NAME`/`SEED_ADMIN_EMAIL`. De kan ikke logge inn (e-post på `testdata.invalid`, ingen `sessions` eller `accounts`).
- **Sertifiseringer** (`certifications`), fordi publiseringssperren i `src/core/access/guards.ts` bruker dem: takstmennene har gyldig sertifisering på befaringsdagen for sine ferdige oppdrag, og én takstmann har utløpt sertifisering, slik at bortfallet av `report.publish` kan prøves. Oppdiktet utsteder og nummer (A271).
- **Kontakter og firma:** 4–5 oppdiktede meglerfirma med meglere, og selgere og kjøpere som parter på oppdragene. Firmanavnene ligner ikke ekte kjeder (test mot en kort liste med kjente kjedenavn i testen). Organisasjonsnummer står tomt.
- **Eiendommer:** rundt 50 av de tre slagene planen nevner: **enebolig** (rekkehus og tomannsbolig er varianter av bolig, `housing_type` `terraced`/`semi_detached`), **leilighet** i sameie eller borettslag, og **fritidsbolig**. Med matrikkel, kommune og areal (bygninger, etasjer, rom og `floor_areas`). **Byggeår** står bare i datafilen, som i testoppdragene, fordi datamodellen ikke har kolonnen; det vises ikke i testmiljøet før kolonnen finnes (A264). Årstallene velges nå slik at de senere treffer aldersreglene (bad fra før 2000, bad på 0–5 år, og alder rundt tersklene).
- **Fellesarealer** (`common_areas`) bare på sameie og borettslag, fordi oppdragssiden viser dem i dag.
- **Bygninger, etasjer, rom og arealmålinger** (`report_buildings`, `floors`, `rooms`, `floor_areas`) på oppdragene som er befart. Arealmålingene er «målingene» i denne leveransen.
- **Oppdrag i alle fire statuser** (bestilt, under arbeid, ferdig, fakturert) og noen ordre som ikke er gjort om ennå, spredd over rundt fire måneder bakover og fire uker fremover, med befaringstid, frist, team (ansvarlig, sidemann, kontor) og parter. Fakturert oppdrag er fakturagrunnlaget som finnes i datamodellen i dag.
- **Tidsregistrering** (`work_sessions`) på ferdige og fakturerte oppdrag, bare på de oppdiktede ansatte.
- **Reklamasjoner:** 4–5 saker (`claims`) med utfallene åpen, avvist, medhold, forlik og trukket.
- **Oppdiktede verdier som ikke kan forveksles med ekte (A265):**
  - e-post på domenet `testdata.invalid` (RFC 2606: `.invalid` kan aldri motta post),
  - telefon i formen `+47 000 NN NNN`, eksportert som `TESTDATA_PHONE_PATTERN = /^\+47 000 \d{2} \d{3}$/` fra `testdata.data.ts`. Begrunnelse som står i koden: i den norske nummerplanen (Nkom) starter åttesifrede nummer på 2–9; nummer som starter på 0 er femsifrede tjenestenummer, så `000 NN NNN` er ikke et abonnentnummer. Mønsteret passer valideringen i `src/core/contacts/schemas.ts` (sifre, mellomrom og +, under 20 tegn), og vasken fanger det (10 sifre, `+47` normaliseres bort til 8 sifre, over grensen på 5). Ikke kontrollert mot nummerplanen i denne kjøringen, derfor ført til kontroll (A265),
  - gårdsnummer 9001–9099, både i `cadastral_units.gnr` og i `orders.gnr` der ordren har matrikkel. Bare kommunene i den faste listen brukes. At ingen av dem har så høye gårdsnummer (sammenslåtte kommuner kan ha det), er ikke kontrollert mot matrikkelen og er ført til kontroll (A265),
  - gatenavn fra en fast liste med oppdiktede navn, ekte postnummer og kommune i Nordland og Troms (for at kart og kommune skal se riktige ut),
  - fritekst (ordrenotat, reklamasjonstekst, `orderedByText`) har aldri elleve sifre på rad, ingen helseopplysninger eller andre særlige kategorier, og ingen tekst fra `docs/kartlegging/`.
- **Fast tilfeldighetsfrø** (egen liten generator i koden, ingen ny pakke).
- **Datoanker:** datoene regnes fra én dag, og den lagres ikke noe eget sted (ingen ny tabell, kolonne, innstilling eller fil). Ankeret er datoen for `created_at` på ordren `TD-0001` hvis den finnes (den lages alltid først), ellers dagens dato. Senere kjøringer flytter derfor ingenting.
- **Idempotent:** andre kjøring skriver ingenting. Hver rad kjennes igjen slik (alltid filtrert på Byggcon-organisasjonens id):

  | Rad | Kjennes igjen på |
  |---|---|
  | brukere, ansatte, kontakter | e-post på `@testdata.invalid` |
  | firma | navnet fra den faste listen og `firm_type` |
  | eiendom og matrikkel | kommune + gnr + bnr (+ fnr/snr) |
  | ordre | `external_ref` `TD-0001` osv. (kolonnen er ikke unik i databasen; oppslaget filtrerer på organisasjonen) |
  | oppdrag, team, parter | via ordren |
  | bygninger, etasjer, rom, areal | finnes det en bygning på oppdraget, hoppes hele treet over |
  | `work_sessions` | finnes det økter på oppdraget, hoppes de over |
  | reklamasjon | finnes det en sak på oppdraget, hoppes den over |

  En rad som er mykt slettet, teller som «finnes»: den gjenopplives ikke, og det lages ingen kopi. En avbrutt kjøring fylles ut av neste.
- **Aktør:** oppdrag, ordre, statusbytter og reklamasjoner lages gjennom tjenestene i `src/core`, med en oppdiktet ansatt med riktig rolle som aktør (kontor lager ordre og oppdrag, ansvarlig takstmann bytter status, leder registrerer reklamasjoner). Admin fra `SEED_ADMIN_EMAIL` er aldri aktør, så revisjonsloggen ikke viser ham som den som har gjort hundrevis av handlinger. «Fakturert» nås bare gjennom gyldige statusbytter. Tidspunktene som tjenestene setter til «nå» (mottatt, statusbytter, hendelser), flyttes bakover til planlagt dato rett etter kallet, i samme transaksjon og bare på TD-rader.
- **Ekte arbeid røres ikke:** skriptet endrer, kobler til eller legger roller på ingen ansatte, kontakter eller ordre som fantes fra før, og setter aldri `deleted_at`.
- **Produksjonsvakt med to sperrer, begge før første skriving (A266):**
  1. `APP_ENVIRONMENT` må være nøyaktig `development` eller `test`. `production`, tom, manglende, `Production`, ` test ` og ukjent verdi stopper.
  2. Verten i `DATABASE_URL` må være `localhost`, `127.0.0.1`, `[::1]` eller starte med `psql-ezprop-test.` (med punktum; Azure-serveren for test er `psql-ezprop-test.postgres.database.azure.com`, `postgresServerName` i `infra/azure/main.bicep`). Punktumet gjør at for eksempel `psql-ezprop-testprod…` stoppes (funn F3 i testplanen). Alt annet stopper.

  Meldingen er norsk og skriver aldri ut adressen, verten eller passordet. Ingen transaksjon åpnes og ingen nummer tas fra nummerserien før begge er sjekket. `.env.example` får `APP_ENVIRONMENT=development`; `start.sh` oppdateres hvis den trengs (bash 3.2, test i `tests/start-script.test.ts`).
- **Utrullingen til testmiljøet** kaller `pnpm db:seed:testdata` etter `pnpm db:seed:testoppdrag` i steget «Migrering og seed», med `APP_ENVIRONMENT: ${{ env.ENVIRONMENT_NAME }}` (ikke fast tekst, slik at en kopi for produksjon ikke arver «test»). `docs/drift/testmiljo-azure.md` sier at en produksjonsutrulling aldri skal ha steget, og at et forsøk på å be om kode til en `.invalid`-adresse via Microsoft 365 gir en returmelding til `MAIL_FROM` (ufarlig).
- **Logging:** bare antall og `TD-`-nøkler, aldri navn, e-post, telefon eller gatenavn.
- Dokumentasjon: avsnittet i `docs/drift/testmiljo-azure.md`, kommandoen i `CLAUDE.md`, `APP_ENVIRONMENT` og «testdata» i ordlisten. Versjon i `package.json` økes (minor).

**Ikke med (bevisst utelatt):**
- **Bilder, funn, avvik, TG og målinger per kontrollpunkt, og byggeår i databasen** (A264). `files` har ingen kobling til rom eller avvik, tabellene for rapportsvar og avvikskort finnes ikke, og det finnes ingen byggeår-kolonne. TG lagt rett i data uten regelmotoren ville brutt regel 5. Dette blir del 2 av planpunktet og legges under 2a-2 «Badet på PC».
- **Video.** Kommer senere, etter planen.
- `client_agreements`: står ikke i planpunktet og trengs ikke for noe akseptkriterium.
- Nye tabeller, nye kolonner eller migreringer.
- Endring av `pnpm db:seed:testoppdrag` og prøveorganisasjonen. Garasjen i `sample:detached-garage` (ført som BRA-b) rettes ikke her; den føres som A269.
- Sletting eller rydding av testdata (regel 3). Et «nullstill testdata»-skript er ikke med.
- Innlogging for de oppdiktede ansatte, og oppdiktet admin.
- Kjøring mot produksjon på noen måte.

## Faglige krav til dataene (fagansvarlig)
- **Arealtype** følger `suggestAreaType` i `src/core/buildings/codes.ts`, ikke testoppdragene: garasje og utebod er BRA-e, BRA-b bare for innglasset balkong (A269). Etasjens BRA-e og BRA-b har rom med samme arealtype. ALH bare på loft og hems, aldri i BRA. Kryperom og uinnredet loft er `not_bra`. «Under terreng» stemmer med etasjen (unntaket for kryperom gjelder). Hver bolig har minst ett bad og ett kjøkken (eller stue/kjøkken). Metode `drawing` bare der det er naturlig (fellesbod), ellers `laser`. Størrelser: leilighet ca. 35–120 m², enebolig ca. 90–250 m², fritidsbolig ca. 30–120 m².
- **Eierform og matrikkel henger sammen:** sameie har seksjonsnummer og ingen andel; borettslag har lagets navn og andelsnummer og ingen seksjon; enebolig og varianter er selveier; fritidsbolig er selveier, noen med festenummer (`fnr`). Borettslagsnavn ligner ikke ekte lag.
- **Reklamasjoner:** bare på ferdige eller fakturerte oppdrag; mottatt etter at oppdraget ble ferdig; beløp bare ved medhold og forlik; bygningsdelene spres (våtrom, tak, drenering, areal). Beskrivelsene er egne ord, uten gjetteord, uten TG-påstander, uten trekk fra ekte saker i `docs/kartlegging/`, og ingen tekst framstiller «eier nektet hulltaking gir TG2» som riktig.
- **Tid og team:** ferdige og fakturerte oppdrag har befaring i fortiden og før ferdig-tidspunktet; bestilte kan ha befaring fram i tid; egenerklæring er mottatt på ferdige oppdrag (står bare i datafila, som byggeår, til datamodellen har et felt for det, A272); sidemann er aldri samme person som ansvarlig; alt ligger innenfor fire måneder (gyldighet ett år brytes ikke).
- **Tidsregistrering:** befaring 1–3 timer og rapportskriving 2–5 timer, leilighet lavest og enebolig med kjeller høyest. Tallene er oppdiktede og sier ingenting om faktisk tidsbruk i Byggcon.

## Tilgang
Ingen nye rettigheter. Dataene vises etter dagens regler i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som i dag (alle oppdrag, `access.inspectors_edit_all`), ikke reklamasjoner | som i dag |
| kontor | som i dag | som i dag |
| leder | som i dag, også reklamasjoner | som i dag |
| admin | alt | alt; kjører skriptet |

## Data
Ingen nye tabeller eller felter. Tabeller som fylles: `users`, `employees`, `employee_roles`, `certifications`, `firms`, `contacts`, `orders`, `assignments`, `assignment_team_members`, `assignment_parties`, `properties`, `cadastral_units`, `common_areas`, `report_buildings`, `floors`, `rooms`, `floor_areas`, `work_sessions`, `claims`, samt `events`, `audit_log` og `number_sequences` gjennom tjenestene. Grunndata (brukere, ansatte, roller, sertifiseringer) kan legges inn direkte, som i `runSeed`. Ordlisten får `APP_ENVIRONMENT` og «testdata».

## Skjermer
Ingen nye skjermer. Eksisterende skjermer får innhold: arbeidskøen (med statusfanene), ordrelisten (med søk), oppdragssiden, bygninger og rom, reklamasjonssakene på hvert oppdrag, tidsstatistikk og søket. Det finnes ingen samlet reklamasjonsliste og ikke statusfilter i ordrelisten, og de lages ikke her (funn F1 og F2).

## Regler
Ingen nye regler. Ingen TG settes.

## Akseptkriterier
- [ ] `pnpm db:seed:testdata` etter `pnpm db:seed` gir i Byggcon-organisasjonen: 10–15 oppdiktede ansatte i alle roller unntatt admin, 4–5 meglerfirma med meglere, 45–55 eiendommer av alle tre slagene (enebolig, leilighet i sameie og i borettslag, fritidsbolig) med matrikkel og areal, oppdrag i alle fire statuser og ordre som ikke er gjort om, fra minst 3 måneder bakover til minst 3 uker fremover, og 4–5 reklamasjoner med utfallene åpen, avvist, medhold, forlik og trukket.
- [ ] Hvert oppdrag har ansvarlig, sidemann (en annen person), kontor og parter. Befarte oppdrag har bygning, etasje, rom og `floor_areas`; ferdige og fakturerte har `work_sessions` med bare oppdiktede ansatte.
- [ ] De faglige kravene over holder (test per punkt: arealtype, ALH, `not_bra`, terreng, bad og kjøkken, metode, størrelser, eierform og matrikkel, reklamasjonsdatoer og beløp, rekkefølge i tid, sertifisering på befaringsdagen).
- [ ] Andre kjøring skriver ingenting: likt antall rader i alle tabellene i «Data», også `events`, `audit_log`, `number_sequences`, `users` og `ai_usage_log`. Også etter at klokka er flyttet 30 dager fram (ingen datoer flytter seg).
- [ ] En avbrutt kjøring (bare ansatte finnes) fylles ut av neste uten kopier. En mykt slettet TD-rad gjenopplives ikke og får ingen kopi.
- [ ] To tomme databaser gir like nøkler og feltverdier (id og tidsstempler holdt utenfor).
- [ ] Vakten stopper før noen skriving ved hver ugyldig `APP_ENVIRONMENT` og ved ukjent databasevert, også med `APP_ENVIRONMENT=test` (radtall og nummerserie uendret), med norsk melding uten adresse.
- [ ] Alt havner i organisasjonen fra `pnpm db:seed`, ingenting i prøveorganisasjonen. En annen organisasjon med like nøkler (TD-`external_ref`, samme e-post) tolkes ikke som «finnes» og endres ikke. `expectTenantIsolation` på hver ny oppslagsspørring i skriptet.
- [ ] Ekte arbeid røres ikke: en ordre, kontakt og ansatt uten TD er uendret, og seed-admin har samme roller og er aktiv etter kjøring. Ingen oppdiktet ansatt har rollen `admin`, rader i `sessions` eller `accounts`, eller deler navn eller e-postdomene med seed-admin.
- [ ] Ingen ekte-lignende data: alle e-poster ender på `@testdata.invalid`, alle telefonnumre følger `TESTDATA_PHONE_PATTERN`, alle gnr (eiendom og ordre) er 9001–9099, organisasjonsnummer er tomme, postnummer og kommune er gyldige par i Nordland og Troms, ingen fritekst har elleve sifre på rad, og firma- og borettslagsnavn treffer ikke listen over kjente kjeder.
- [ ] Vasken bytter ut partens navn, e-post, telefon, adresse og «gnr 9012/34» i en tekst om et TD-oppdrag (ingen KI-kall).
- [ ] Tilgang med testdata: takstmann, kontor, leder og admin ser oppdragene som i dag; bare leder og admin ser reklamasjonene.
- [ ] Skriptet logger bare antall og `TD-`-nøkler (test fanger stdout/stderr: ingen `@`, navn eller gatenavn fra datafila).
- [ ] Arbeidskø- og ordrelisteoppslaget i tjenestene svarer på under 2 sekunder med full testdata (integrasjonstest).
- [ ] Én e2e-spesifikasjon (PC og iPad-størrelse): arbeidskøen viser TD-oppdrag med befaring denne uken for en takstmann, ordrelisten viser TD-ordre i alle ordrestatuser (den har bare søk, ikke statusfilter), statusfilteret prøves i arbeidskøens faner (`?status=`) og viser bare oppdrag med valgt status, leder ser reklamasjonssakene på oppdraget (de vises per oppdrag, det finnes ingen samlet liste) og takstmannen får ikke tilgang, tidsstatistikken viser tall.
- [ ] Utrullingen kaller skriptet etter `db:seed:testoppdrag` med `APP_ENVIRONMENT: ${{ env.ENVIRONMENT_NAME }}`; ingen annen arbeidsflyt kaller det; `.env.example` har `APP_ENVIRONMENT=development` (utvidet `tests/deploy-workflow.test.ts`). CI er grønn.
- [ ] Ingen nye avhengigheter.

## Testplan (test-leder runde 1, med prosjektlederens avgjørelser)
Den fulle testplanen står i `docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md`. Funnene F1–F4 derfra er rettet i dette kortet (13.11.2026).

**Signaturer** (avtalt mellom utvikler og testskriver i testplanen, avsnittet «Avtale om signaturer»; avvik føres her):
- `seeded-random.ts`: `createSeededRandom(seed)` med `next()`, `int(min, max)` og `pick(list)`. Ingen `Math.random` i `testdata*.ts`.
- `testdata-guard.ts`: `assertTestdataAllowed(env)` kaster `TestdataGuardError` med norsk melding. Ren funksjon uten database.
- `testdata.data.ts`: de faste listene (`TESTDATA_EMPLOYEES`, `TESTDATA_FIRMS`, `TESTDATA_PROPERTIES`, `TESTDATA_ORDERS`), `TESTDATA_EMAIL_DOMAIN`, `TESTDATA_PHONE_PATTERN`, `TESTDATA_GNR_RANGE`, `TESTDATA_MUNICIPALITIES` og `TESTDATA_SEED`.
- `testdata.ts`: `runTestdataSeed(env, now?)` gir en oppsummering med antall per tabell og `TD-`-nøkler. Oppslagene for «finnes fra før» eksporteres for tenant-testen (`findTestdataOrders`, `findTestdataEmployees`, `findTestdataFirms`, `findTestdataProperties`).
- `testdata-index.ts`: inngangen for `pnpm db:seed:testdata`. Vakten kalles før databasen åpnes.

- **Enhet:** `seeded-random` (samme frø gir samme rekkefølge, annet frø gir annen), `testdata-guard` (alle verdiene i vakten), `testdata.data` (sjekkene under «Ingen ekte-lignende data» og de faglige kravene som kan sjekkes på datafila).
- **Integrasjon** (`TEST_DATABASE_URL`): punktene i akseptkriteriene om innhold, idempotens, avbrutt kjøring, myk sletting, determinisme, vakt, tenant, ekte arbeid, vask, tilgang, logging og ytelse.
- **E2E:** én fil, `e2e/fase-2a-testdata.spec.ts`. Den kjører seed-funksjonen i `beforeAll` via `e2e/helpers.ts` mot `DATABASE_URL` etter `assertLocalOrTestDatabase` (`e2e/database-guard.ts`), med `APP_ENVIRONMENT=test`. Uten nett: ingen nye skjermer; finnes arbeidskøen i hurtiglageret i dag, sjekkes at den vises med testdata.

## Avgjørelser ved uenighet (prosjektleder 13.11.2026)
- **Ytelse:** forenkler ville ha ytelse og iPad i én e2e-test; test-leder ville måle i integrasjonstest fordi tidtaking i e2e på CI er ustabil. Avgjort: ytelsen måles i en integrasjonstest på tjenestefunksjonene, og alt e2e samles i én spesifikasjon. Det gir stabile tester og bare ett nytt e2e-sett.
- **Sertifiseringer:** forenkler ville kutte dem hvis de ikke trengs. De trengs: publiseringssperren leser dem, og fagansvarlig vil kunne prøve bortfallet av `report.publish`. Beholdt, men bare det som trengs (gyldig for ansvarlige, én utløpt).
- **Fellesarealer:** forenkler ville kutte dem hvis ingen skjerm viser dem. Oppdragssiden viser dem i dag. Beholdt, bare på sameie og borettslag.
- **Rekkehus:** ikke eget slag i kriteriet; brukes som variant av bolig. Kortet og planen sier det samme.
- **Test mot `docs/kartlegging/`:** test-leder ville skanne mappen, forenkler ville kutte det. Kuttet: navn og gater kommer bare fra de faste oppdiktede listene i `testdata.data.ts`, og de faste sjekkene (`.invalid`, telefonmønster, gnr, elleve sifre, kjedenavn) holder. Å lese researchmappen i en test er skjørt.
- **Datoanker:** lagres ikke (forenkler, sikkerhet-personvern, test-leder er enige om at det leses av TD-radene). Avgjort: `created_at` på `TD-0001`.
- **Admin i testdataene:** planen sier «alle roller», men en oppdiktet admin teller med i `countActiveAdmins` og kan svekke regel 11. Avgjort: ingen oppdiktet admin (A268).

## Plan
Planpunktet deles i to (én linje i `docs/plan/endringslogg.md`, med henvisning til A264):
- **Del 1** (denne PR-en) krysses av: «Testdata som ligner en ekte arbeidshverdag».
- **Del 2** flyttes til 2a-2 «Badet på PC» i samme PR: testdataene utvides med bilder laget av skriptet (uten personer), funn, TG og målinger per kontrollpunkt, og byggeår når kolonnen finnes. TG og funn kommer fra regelmotoren og malens testsaker, aldri skrevet fritt i seed; tekstene merkes «utkast, ikke godkjent av fagrådet». TG3 har kostnadsanslag, TG2 og TG3 årsak og konsekvens, og el, rekkverk og HMS får ingen TG. ki-ansvarlig vurderer på nytt.

## Beslutninger i autonom modus (ført i `docs/09-apne-sporsmal.md`, A264–A272)
- **A264 (lett å endre):** Bilder, funn, TG, målinger per kontrollpunkt og byggeår i databasen legges inn som del 2 under 2a-2 «Badet på PC», ikke nå. Datamodellen har ikke plass, og oppgaven sier «bare der datamodellen har plass». Byggeår står i datafilen til da.
- **A265 (lett å endre):** Oppdiktede kontaktdata: e-post på `testdata.invalid`, telefon `+47 000 NN NNN` (åttesifrede abonnentnummer starter på 2–9 i nummerplanen; minst 5 sifre og `+47`/`0047` normaliseres av vasken), gnr 9001–9099 i både eiendom og ordre. **Til kontroll:** at serien `000` ikke kan tildeles (Nkom) og at ingen av kommunene i listen har gnr over 9000. Endres i `testdata.data.ts`.
- **A266 (dyrt å endre):** Produksjonsvakten har to sperrer: `APP_ENVIRONMENT` (development, test, production; ikke `NODE_ENV`, fordi testmiljøet også kjører med `NODE_ENV=production`) og databaseverten (lokal eller starter med `psql-ezprop-test.`, med punktum, funn F3). Begge må holde før første skriving.
- **A267 (dyrt å endre):** Testdataene ligger i Byggcon-organisasjonen som de ansatte logger inn i, ved siden av ekte arbeid i testmiljøet, merket med `TD-`/`testdata.invalid`. Følge: testmiljøets database kan aldri løftes til produksjon; produksjon starter med tom database (regel 3 og 8). **Ståle bør bekrefte dette før ekte data.**
- **A268 (lett å endre):** Ingen oppdiktet ansatt får rollen admin (regel 11, `countActiveAdmins`). Avviker fra «alle roller» i planteksten; rollen dekkes av admin fra `pnpm db:seed`.
- **A269 (lett å endre):** Frittstående garasje og utebod er BRA-e i testdataene, som romtypens standard. Testoppdraget `sample:detached-garage` fører garasjen som BRA-b og rettes i en egen liten oppgave. **Til kontroll mot NS 3940:2023** (ikke tilgjengelig i denne kjøringen).
- **A270 (lett å endre):** Ytelsen (under 2 s) måles i integrasjonstest på tjenestene, ikke i e2e.
- **A271 (lett å endre):** Sertifiseringene i testdataene har oppdiktet utsteder og nummer, ikke ekte utstedernavn.
- **A272 (lett å endre):** «Egenerklæring mottatt» står bare i datafila, som byggeår, til datamodellen har et felt for det.

## Roller
utvikler (skript, vakt, utrulling), testskriver (testplanen over), sikkerhet-personvern (vakten, at ingenting ligner ekte data, admin og ekte ansatte urørt), fagansvarlig (de faglige kravene), ki-ansvarlig (vasketesten).

## Åpne spørsmål
- Ingen som stopper oppgaven. Til Ståle når han er tilbake: A267 (testdatabasen kan ikke bli produksjon) og kontrollene i A265 og A269.
