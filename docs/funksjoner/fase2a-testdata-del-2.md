# Funksjon: Testdata, del 2 (badet fylt ut i testoppdragene)

- **Fase:** 2a-2 Hele veien først, under punktet «Badet på PC» (A300, A359)
- **Modul:** seed (`src/db/seed/testdata*.ts`), bruker kjernetjenestene i `src/core/reports` og regelmotoren i `src/core/rules` uten å endre dem
- **Branch:** `testdata-del-2` (bygger på `main` etter PR #224 og PR #203)
- **Status:** klar for bygging (rettet etter forhåndsvurdering runde 1: forbedrer, fagansvarlig, test-leder)
- **Dato:** 17.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** testmiljøet får bad som ser ut som ekte befaringer (svar, målinger, avvik med TG, årsak, konsekvens, tiltak og kostnad). Da kan de ansatte og testlaget prøve badskjermen, og senere PDF-en, på realistiske rapporter i stedet for tomme skjemaer.
  - **KI i bunnen:** testdataene gir strukturerte avvik med faste koder og regelbeslutninger i samme form som ekte data. Det er grunnlaget «KI i veien» og evalueringene prøves mot.
  - **Færre reklamasjoner:** TG kommer bare fra reglene og malen, slik at testdataene viser de samme TG-ene som systemet vil foreslå i drift. Feil i reglene blir synlige i testmiljøet før ekte bruk.

## Problem
Del 1 (PR #203) la inn oppdrag, eiendommer, bygninger og rom, men ingen rapportsvar. Badskjermen (PR #224) åpner derfor alltid et tomt bad. Testlaget og Ståle kan ikke se hvordan et ferdig bad, en TG3 med kostnad eller en TGIU ser ut uten å fylle alt inn for hånd. Planpunktet «Badet på PC» krysses ikke av før dette er levert (A359).

## KI i bunnen
- **Ingen KI-kall i seed.** TG, TGIU og TG0 kommer fra regelmotoren og fra utfallene i malen, aldri fra KI (regel 14, ADR 0009). Seed skriver ingen rader i `ai_usage_log`; falsk KI-historikk ville gitt feil statistikk for godtatt/avvist.
- **Data som lagres for KI:** hvert avvik har faste koder (kontrollpunkt, spørsmål, utfall, `kind`, `tg`, `cause_criterion`, `cost_type`, `cost_band_key`, `text_source`), og hvert regelforslag har en rad i `rule_suggestion_decisions` med beslutning (`accepted` / `changed` / `rejected`) og begrunnelseskode. Det er nøyaktig formen KI-funksjonene i 2a-2 og 2b skal lese.
- **Alt går gjennom tjenestene** (`startReport`, `saveField`, `decideSuggestion`, `createDeviationFromOutcome`, `setTgDirect`, `setCheckpointDone`) med takstmannen på oppdraget som aktør. Da gjelder tilgang, tenant-isolasjon, revisjonslogg og ingen-persondata-reglene også for testdataene.
- **ki-ansvarlig vurderer oppgaven på nytt** (planen): om dataene dekker det «KI i veien» trenger (blant annet en andel avvik med endret tekst, `text_source = edited`, og regelforslag som er avvist med begrunnelse), og at ingenting i testdataene ligner persondata i tekstfelt.

## Brukerhistorier
- Som **takstmann i testmiljøet** vil jeg **åpne et bad i et oppdrag som er under arbeid og se svar, målinger og avvik** slik at **jeg kan prøve skjermen på noe som ligner en ekte befaring**.
- Som **testlaget** vil jeg **ha bad med TG2, TG3, TGIU, TG0 og «ikke vurdert»** slik at **alle tilstandene på skjermen kan prøves uten å fylle ut for hånd**.

## Omfang
**Med:**
- **Rapport for badene i testoppdragene** med status «under arbeid», «ferdig» og «fakturert» som har minst ett våtrom (del 1). Oppdrag med status «bestilt» får ingen rapport. Rapporten startes med `startReport`, låst til publisert systemmal.
- **Scenarioer som data** (ny ren fil `src/db/seed/testdata-bath.data.ts`): faste bad-scenarioer bygd på inndataene i malens `rule_test_cases` (`src/db/seed/templates/wet-room.ts`), ikke på egne TG-er. Hvert scenario har svar per kontrollpunkt (feltkoder og verdier), hvilke forslag som godtas, endres eller avvises (med begrunnelseskode), valget ved «velg TG2 eller TG3», og **forventet resultat** (se «Scenariofilen er fasit» under).
- **Pliktige scenarioer, fast fordelt** (forbedrer 1, test-leder 2, A430). De pliktige scenarioene legges i fast rekkefølge på de første badene som passer (oppdrag sortert på oppdragsnummer, status og byggeår må passe scenarioet). Den seedede tilfeldigheten brukes bare for resten av badene, og bare blant scenarioer som passer badets år. Pliktige:
  1. **Visningsbad** (forbedrer 2), status «under arbeid», se under.
  2. **TG2 for alder:** folie, ingen dokumentasjon, badets år = befaringsår − 18 eller eldre, men 2000 eller senere → TG2-forslaget `membrane_past_lifespan` godtatt, kostnad «none». Status ferdig eller fakturert.
  3. **TG3 før 2000:** badets år før 2000, sjiktår tomt → TG3-forslaget `membrane_before_2000` godtatt, med kostnadsintervall. Ingen TG2 for alder i tillegg. Status ferdig eller fakturert.
  4. **TGIU, komplett:** hulltaking ikke utført, grunnen «eier ga ikke samtykke» → TGIU på tilliggende med alle fem opplysningene (begrunnelse, eier informert om utvidet ansvar avkrysset, annen fuktundersøkelse med metode og resultat, risiko, om konstruksjonen er skadeutsatt) og rad i `tgiu_details` (`reason`, `risk_assessment`, `how_to_examine`). Status ferdig eller fakturert.
  5. **TG0:** hull utført uten funn, under 15 vekt-% (for eksempel 11) → TG0-forslaget godtatt, bare på `wet_room.adjacent`.
  6. **Forhøyet fukt med TG2** og 7. **med TG3:** hull «utført med funn», enhet vekt-%, verdi 15 eller høyere → `elevated_moisture` med valget i scenarioet. Tiltaket følger valgt TG (`applies_to_tg`). TG3 får kostnad. Ingen egen tallgrense mellom TG2 og TG3.
  8. **Endret forslag:** TG0-forslaget på tilliggende endret til TG1 (eneste lovlige endring i testdataene, fagansvarlig 5).
  9. **Avvist forslag:** status «under arbeid», punktet står ikke ferdig, slik at ingen ferdig rapport har en TG som strider mot et regelforslag. Valgt: TG0-forslaget på tilliggende avvist med koden `measured_again` (A432).
  10. **Bad uten avvik:** et bad der ingen regel slår til (for eksempel det som er to år gammelt i del 1), alle punkt ferdige med TG1.
  11. **«Ukjent» byggeår** (T-0051): `build_year` tomt, kilde `unknown`, `membrane_year` tomt (testsak B2.5). Bare på «under arbeid». Punktet «Vanntett sjikt, membran og sluk» står ikke ferdig og får verken TG1 eller TGIU. «Ikke vurdert» betyr her: ingen regelforslag for alder på badet og punktet ikke ferdig.
  12. **HMS:** `wet_room.fixtures` / `signs_of_overheating` (kind `hms`) med konsekvens og tiltak og `tg` tom. Punktet får TG1 direkte (A431).
  Pliktige scenarioer kan dele bad når de ikke strider mot hverandre (HMS kan for eksempel ligge i badet med TG2 for alder).
- **Visningsbadet** (forbedrer 2): ett oppdrag «under arbeid» der badet viser det meste på én skjerm: TG3 før 2000 med kostnad, et TG2-utfall med fast TG i malen (for eksempel `weak_extract` på ventilasjon) med endret tekst (`edited`), TGIU med alle opplysningene, HMS uten TG, og noen punkt som står igjen. Avvist forslag ligger i scenario 9 på et annet bad, fordi TG0-forslaget ikke kan komme på samme tilliggende punkt som TGIU (avgjort av prosjektlederen, se under). E2e og testlaget finner badet med en oppslagsfunksjon (`findShowcaseBathReport`) som søker på innholdet (under arbeid, TG3 og TGIU i samme bad, organisasjonen Byggcon), ikke på rekkefølge eller antall.
- **Byggeår og befaringsår** (fagansvarlig 2–3, forbedrer 3):
  - `wet_room.build_year` betyr året rommet ble bygget eller fikk nytt vanntett sjikt. `yearRenovated` i del 1 regnes som full fornyelse med nytt sjikt, kilde `owner_stated`. Uten `yearRenovated` brukes eiendommens `buildYear`, kilde `documented`. Scenario 11 bruker `unknown`. `wet_room.membrane_year` står tomt, så regelen bruker byggeåret (testsak A8 og B6).
  - Befaringsåret leses fra oppdragets befaringsdato (`inspectionYearOf`, kilde «assignment»), aldri fast 2026 og aldri «i dag». Alle oppdrag med rapport må ha befaringsdato; ellers stopper seed med feil.
  - Del 1 får en garanti som `ensureBathroomAges`: badene med årsprofilene de pliktige scenarioene trenger, finnes i oppdrag med riktig status. En test viser at det finnes minst like mange passende bad som pliktige scenarioer.
  - Seed sjekker hvert forslag før det godtas: mangler forslaget, eller svarer `decideSuggestion` `no_longer_applies`, stopper seed med en tydelig feil. Ingen stille hopp.
- **Alle ferdige punkt har TG** (fagansvarlig 1, forskriften § 2-22, sperrekrav 1, A431): punkt uten avvik med TG får TG1 med `setTgDirect`. TG0 bare på `wet_room.adjacent` og bare ved godtatt TG0-forslag. TG1 direkte settes aldri på et punkt der en regel har et åpent forslag.
- **Hulltaking i alle ferdige bad** (forskriften § 2-2, sperrekrav 4): hvert bad i «ferdig» og «fakturert» har enten hull tatt med måling, eller «ikke utført» med grunn og TGIU.
- **Målinger:** fuktmåling med enhet, fall og terskelhøyde, lagret med `saveField`. Fall og terskelhøyde har ingen regel og ingen avgjort grense (regelverk-krav.md avsnitt 4): verdier uten avvik er tydelig uproblematiske, `insufficient_fall` bare ved motfall (negativ verdi), og `low_threshold_height` lages ikke. Måling i RF % gir ingen forslag (ikke vurdert).
- **Avvikene:** TG fra regelforslaget eller fra utfallet i malen. Ved «velg TG2 eller TG3» står valget (2 eller 3) i scenarioet. TG2 og TG3 har årsak og konsekvens fra malen (`text_source = template`, noen `edited`). TG3 har fast kostnadsintervall per utfall i datafilen, merket utkast; TG2 får ikke kostnad. Bruker et scenario eget beløp, er det rundet til nærmeste 10 000. HMS får ingen TG.
- **Ikke lov i testdataene** (fagansvarlig 5): TGIU-forslaget avvises eller endres aldri; alders-TG2 endres aldri til TG3; før 2000-forslaget endres ikke til TG2 og avvises ikke; ingen TG3 på «Dokumentasjon for våtrom».
- **Tekstene er utkast:** malens tekster har alt `text_status = draft`. Endrede tekster (`edited`) er høyst tre varianter som beholder årsak, konsekvens og flettefelt. Fritekst som ikke finnes i malen (TGIU-begrunnelse, risiko, «hva må til for å undersøke», målested, oppbygging, annen fuktundersøkelse) har én eller to korte varianter per felt i datafilen, med egne ord, merket «utkast, ikke godkjent av fagrådet», uten gjetteord («antas», «trolig»), uten henvisning til standarden og uten person- eller adresseopplysninger. Gjetteord-, kopi- og persondatatestene leser datafilen.
- **Scenariofilen er fasit** (forbedrer 5): hvert scenario har forventede avviksnøkler, TG eller «ingen TG», `text_source` (`template` eller `edited`) og **planlagte bilder per avvik** som korte beskrivelser (for eksempel «nærbilde av sluk», «fuktmåler mot vegg»). Ingen filer, ingen persondata, ingen KI-kall. «Bilder på PC» lager bildene ut fra beskrivelsene, og evalueringene og ki-ansvarlig kan bruke scenarioene som fasit.
- **«Under arbeid» ser ut som en avbrutt befaring** (forbedrer 4): punktene fylles i malens rekkefølge, resten står helt urørt, uten halve svar. Tidsstemplene spres ikke (se «Avgjort ved uenighet»).
- **Statusen på rapporten følger oppdraget:** «ferdig» og «fakturert» har 8 av 8 punkt ferdige; «under arbeid» har færre.
- **Ny kjøring** (test-leder 5, A434): finnes rapporten for våtrommet alt, hopper seed over hele badet og skriver antallet i oppsummeringen. Svar som er lagt inn for hånd, overskrives aldri. Et avvik med `deleted_at` gjenopprettes ikke og lages ikke på nytt. Ingenting slettes permanent.
- **Bare når `APP_ENVIRONMENT` er development eller test** (samme vakt som del 1, `testdata-guard.ts`), før noe skrives.
- **Planen:** linjen for del 2 og delpunktet under «Bilder på PC» er rettet (endringsloggen 17.11.2026). Punktet «Badet på PC» krysses av i PR-en.

**Ikke med (bevisst utelatt):**
- **Bilder** (A427). Datamodellen har ingen kobling fra fil til rom, kontrollpunkt eller avvik. Bildene lages i samme seed-steg når «Bilder på PC» lager bildemodellen, ut fra de planlagte bildene i scenariofilen. Delpunktet under «Bilder på PC» er utvidet.
- **Byggeår på eiendommen som kolonne** (A428). Kolonnen finnes ikke. Byggeåret for våtrommet står som svar i badet.
- **El, rekkverk og andre romtyper.** Bare badmalen finnes. Dekkes her av testen «ingen avvik utenfor badmalen» og «HMS uten TG». Resten kommer med malene i 2a-3.
- **KI-forslag i testdataene** (ingen rader i `ai_usage_log`, A429).
- **Nye regler, nye avvikstekster eller endringer i malen og kjernetjenestene.** Hull i tjenestene føres som funn.
- **Ny migrering.**
- **Tidsstempler spredt over befaringsdagen.** Krever at kjernetjenestene tar imot et eget tidspunkt (de bruker `new Date()`), eller skriving forbi tjenestene. Begge er utenfor oppgaven.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | som badskjermen (PR #224) | som badskjermen |
| kontor | som badskjermen | som badskjermen |
| leder | som badskjermen | som badskjermen |
| admin | som badskjermen | som badskjermen |

Seed skriver som takstmannen på oppdraget (`inspectorActor`), aldri med admin og aldri forbi `src/core/access`.

## Data
Ingen nye tabeller eller kolonner. Nye rader i `reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details` og `rule_suggestion_decisions`, bare i organisasjonen Byggcon og bare i testdata. `TESTDATA_TABLES` og oppsummeringen fra `pnpm db:seed:testdata` utvides med disse tabellene. Faste koder som brukes: bare de som finnes i malen og i ADR 0013.

## Skjermer
Ingen nye. Badskjermen (PR #224) viser dataene.

## Regler
Ingen nye regler. Scenarioene bruker inndataene fra malens testsaker, og en test kjører regelmotoren på hvert scenario og sjekker at forslaget er det testsaken forventer.

## Akseptkriterier
- [ ] `pnpm db:seed:testdata` gir rapport låst til publisert systemmal i hvert våtrom i oppdrag med status «under arbeid», «ferdig» og «fakturert», og ingen i «bestilt».
- [ ] Alle tolv pliktige scenarioer er brukt minst én gang, med fast fordeling; samme frø gir samme fordeling (test på datafilen og i databasen).
- [ ] Hvert scenario kjørt gjennom regelmotoren gir forslaget malens testsak forventer, både med befaringsåret og med klokken flyttet to år fram.
- [ ] TG bare gjennom tjenestene: hvert avvik med TG har en rad i `rule_suggestion_decisions` med samme `deviation_id`, eller kommer fra et utfall med fast TG, eller fra «velg TG2 eller TG3» med TG 2 eller 3 og en rad fra `setTgDirect` i revisjonsloggen. TG1 direkte bare på punkt uten avvik med TG og uten åpent forslag. En statisk test viser at seed-filene ikke skriver til `deviations`, `checkpoint_results` eller `rule_suggestion_decisions` med `insert` eller `update`.
- [ ] Hele datasettet: ingen TG3 uten kostnadsintervall, ingen TG2 eller TG3 uten årsak og konsekvens, ingen TG2 med kostnad, ingen TG0 utenfor tilliggende, ingen TG3 på dokumentasjon, ingen TG på HMS (testen feiler ved 0 HMS-avvik), ingen avvik utenfor badmalen, ingen ferdig punkt uten TG.
- [ ] «Ferdig» og «fakturert» har 8 av 8 punkt ferdige, hulltaking med måling eller TGIU med grunn, og ingen av advarslene `tg3_on_age_only`, `tgiu_suggested_not_set`, `tgiu_details_missing` og `checkpoint_done_without_tg`. «Under arbeid» har færre enn 8, og punktene som står igjen, har ingen svar.
- [ ] Testsakene fra fagansvarlig består (alder −18 gir TG2, −17 gir ingenting, 1999 gir TG3 uten TG2, 2000 gir TG2, hull nektet gir TGIU uten TG2, 14,9 vekt-% gir TG0 bare på tilliggende, 15 vekt-% gir fukt med riktig tiltak, RF % og «Ukjent» gir ikke vurdert).
- [ ] `build_year` og `build_year_source` stemmer med `yearRenovated` (`owner_stated`) eller `buildYear` (`documented`), og `membrane_year` er tomt.
- [ ] To kjøringer på rad gir like mange rader per tabell og samme TG per bad. En rapport som er endret for hånd, og et avvik som er myk-slettet, røres ikke ved ny kjøring.
- [ ] Seed stopper med tydelig melding når `APP_ENVIRONMENT` ikke er development eller test, eller mangler, før noe skrives (0 nye rader).
- [ ] Ingen rader i `ai_usage_log` fra seed. Aktøren i revisjonsloggen er takstmannen på oppdraget, aldri admin.
- [ ] Ingen tekst i datafilen eller rapportdataene har navn, adresse, e-post, telefon eller matrikkel fra testdataene, gjetteord eller tekst fra standarden (test med `tests/redaction.ts` og `tests/known-values.ts`).
- [ ] Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget), og en annen organisasjon har samme radtall før og etter seed. Takstmann, kontor, leder og admin åpner en seedet rapport slik badskjermen tillater.
- [ ] `TESTDATA_TABLES` og oppsummeringen viser de nye tabellene og antall bad som er hoppet over.
- [ ] E2e (PC og iPad-størrelse): visningsbadet, funnet med `findShowcaseBathReport`, viser TG3 med kostnad, TGIU og fremdrift «x av 8» med x < 8 og totalen 8. Badet uten avvik vises riktig.
- [ ] Versjonen i `package.json` er økt (patch). A427–A435 er ført i `docs/09-apne-sporsmal.md`.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md` av utvikleren)
- **A427 (lett å endre):** Bilder i testdataene kommer med «Bilder på PC», ikke nå, fordi bildemodellen ikke finnes. Scenariofilen har planlagte bilder som beskrivelser.
- **A428 (lett å endre):** Byggeår som kolonne på eiendommen kommer ikke her. Byggeåret for våtrommet legges som svar i badet.
- **A429 (lett å endre):** Seed skriver ingen KI-rader i `ai_usage_log`. Falsk historikk ville forstyrret tallene for godtatt og avvist.
- **A430 (lett å endre):** De tolv pliktige scenarioene fordeles fast på de første badene som passer (sortert på oppdragsnummer); tilfeldigheten brukes bare for resten. «Velg TG2 eller TG3» bestemmes i scenarioet.
- **A431 (lett å endre):** Seed setter TG1 med `setTgDirect` på ferdige punkt uten avvik med TG (også punkt med bare HMS-avvik). Dette er den eneste TG-en seed setter uten regel eller utfall. Kilde: forskriften § 2-22 (alle punkt skal ha TG), sperrekrav 1.
- **A432 (lett å endre):** Endret forslag i testdataene er TG0 → TG1 på tilliggende; avvist forslag er TG0-forslaget på tilliggende med `measured_again`, på et bad under arbeid der punktet ikke er ferdig. Begge går i den forsiktige retningen og gir ingen ferdig rapport med TG mot et regelforslag.
- **A433 (lett å endre):** `yearRenovated` i del 1 betyr nytt vanntett sjikt, kilde `owner_stated`; ellers eiendommens byggeår med kilde `documented`. `membrane_year` står tomt.
- **A434 (lett å endre):** Ny kjøring hopper over bad som alt har rapport, uten å overskrive, og myk-slettede avvik lages ikke på nytt.
- **A435 (lett å endre):** Kostnadsintervallet for TG3 er fast per utfall i datafilen og merket utkast, til fagrådet har svart (spørsmål nr. 92).

## Avgjort ved uenighet (prosjektlederen)
- **Avvist forslag ligger ikke i visningsbadet** (forbedrer 2 mot fagansvarlig 5). Det eneste forslaget som kan avvises trygt, er TG0 på tilliggende, og det kommer bare når hullet er tatt. Visningsbadet har TGIU på samme punkt fordi hull ikke er tatt. TGIU er viktigere å vise; det avviste forslaget ligger i et annet bad under arbeid.
- **Tidsstemplene spres ikke over befaringsdagen** (forbedrer 4). Tjenestene setter tiden selv, og kortet sier at verken kjernetjenestene endres eller noe skrives forbi dem (test-leder 4b). Rekkefølgen og «avbrutt befaring» er med.
- **Befaringsår fra oppdraget, ikke fast alder i scenarioet** (forbedrer 3 mot fagansvarlig 2). Begge vil ha stabil TG. Byggeåret kommer fra del 1, og befaringsåret fra oppdraget, så TG-en endrer seg ikke med tiden når dataene først er lagret. Testen med klokken flyttet to år fram viser at ingenting bruker «i dag».
- **Bilder og byggeårskolonnen** står utenfor (test-leder godtok). Planlinjen, endringsloggen og delpunktet under «Bilder på PC» er rettet i denne committen.

## Lagt til av forbedreren
- Fast dekning av de pliktige scenarioene (forbedrer 1).
- Visningsbadet med det meste i én rapport og fast oppslag (forbedrer 2).
- TG som ikke endrer seg med tiden, med test der klokken flyttes (forbedrer 3).
- «Under arbeid» som avbrutt befaring i malens rekkefølge (forbedrer 4, uten spredte tidsstempler).
- Scenariofilen som fasit med forventede utfall og planlagte bilder (forbedrer 5).
- Nytt planpunkt i 2a-2 «Fra forbedreren»: **Øvingsbad for nye takstmenn** (bygges i tur, ikke her).

## Roller
- **utvikler:** scenariofilen og seed-steget.
- **testskriver** (parallelt): akseptkriteriene som tester, uavhengig av seed-koden.
- **ki-ansvarlig:** vurderer oppgaven på nytt (planen) før byggingen, og PR-en før merge.
- **fagansvarlig:** sjekker at scenarioene og valgene av TG, årsak, konsekvens og kostnad er faglig rimelige (utkast).

## Åpne spørsmål
- Nr. 92 i `docs/09-apne-sporsmal.md` (kostnadsintervall for sjikt fra før 2000 og forhøyet fukt med TG3, og at alderstabellen og 15 vekt-% er ukontrollerte utkast). Stopper ikke oppgaven.
