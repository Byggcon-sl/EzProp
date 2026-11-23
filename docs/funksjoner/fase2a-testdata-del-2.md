# Funksjon: Testdata, del 2 (badet fylt ut i testoppdragene)

- **Fase:** 2a-2 Hele veien først, under punktet «Badet på PC» (A300, A359)
- **Modul:** seed (`src/db/seed/testdata*.ts`), bruker kjernetjenestene i `src/core/reports` og regelmotoren i `src/core/rules` uten å endre dem
- **Branch:** `testdata-del-2` (bygger på `main` etter PR #224 og PR #203)
- **Status:** klar for bygging (rettet etter forhåndsvurdering runde 1: forbedrer, fagansvarlig, test-leder). Kontrollert mot main 23.11.2026 (main flettet inn, ingen endringer som gjør kortet feil). Runde 2 23.11.2026: forbedrerens tre tillegg og fagansvarliges åtte rettinger er tatt inn; beslutningene er omnummerert fra A473–A481 til A501–A509 fordi A480 og A481 alt var brukt på en annen branch. Bygges nå.
- **Dato:** 17.11.2026, kontrollert 23.11.2026
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
- **Pliktige scenarioer, fast fordelt** (forbedrer 1, test-leder 2, A504). De pliktige scenarioene legges i fast rekkefølge på de første badene som passer (oppdrag sortert på oppdragsnummer, status og byggeår må passe scenarioet). Den seedede tilfeldigheten brukes bare for resten av badene, og bare blant scenarioer som passer badets år. Pliktige:
  1. **Visningsbad** (forbedrer 2), status «under arbeid», se under.
  2. **TG2 for alder:** folie, ingen dokumentasjon, badets år = befaringsår − 18 eller eldre, men 2000 eller senere → TG2-forslaget `membrane_past_lifespan` godtatt, kostnad «none». Status ferdig eller fakturert.
  3. **TG3 før 2000:** badets år før 2000, sjiktår tomt → TG3-forslaget `membrane_before_2000` godtatt, med kostnadsintervall. Ingen TG2 for alder i tillegg. Status ferdig eller fakturert.
  4. **TGIU, komplett** (eier nektet) (testlagets funn T-0114, middels, gjelder skjermen og rettes ikke her: opplysningene spørres både i registreringen og i TGIU-delen; seed fyller begge steder med samme tekst, slik at testdataene ikke viser to ulike svar): hulltaking ikke utført, grunnen «eier ga ikke samtykke» → TGIU på tilliggende med alle fem opplysningene (begrunnelse, eier informert om utvidet ansvar avkrysset, annen fuktundersøkelse med metode og resultat, risiko, om konstruksjonen er skadeutsatt) og rad i `tgiu_details` (`reason`, `risk_assessment`, `how_to_examine`). Status ferdig eller fakturert.
  5. **TG0:** hull utført uten funn, under 15 vekt-% (for eksempel 11) → TG0-forslaget godtatt, bare på `wet_room.adjacent`.
  6. **Forhøyet fukt med TG2** og 7. **med TG3:** hull «utført med funn», enhet vekt-%, verdi 15 eller høyere → `elevated_moisture` med valget i scenarioet. Tiltaket følger valgt TG (`applies_to_tg`). TG3 får kostnad. Ingen egen tallgrense mellom TG2 og TG3.
  8. **Endret forslag:** TG0-forslaget på tilliggende endret til TG1 (eneste lovlige endring i testdataene, fagansvarlig 5).
  9. **Avvist forslag:** status «under arbeid», punktet står ikke ferdig, slik at ingen ferdig rapport har en TG som strider mot et regelforslag. Valgt: TG0-forslaget på tilliggende avvist med koden `measured_again` (A506).
  10. **Bad uten avvik:** et bad der ingen regel for alder eller fukt slår til (for eksempel det som er to år gammelt i del 1), med dokumentasjon (samsvarserklæring eller våtromssertifikat). Hull tatt uten funn under 15 vekt-%, så TG0-forslaget kommer på tilliggende og godtas. Resultat: sju punkt med TG1 og tilliggende med TG0, ingen avvik (fagansvarlig runde 2, punkt 1).
  11. **«Ukjent» byggeår** (T-0051): `build_year` tomt, kilde `unknown`, `membrane_year` tomt (testsak B2.5). Bare på «under arbeid». Punktet «Vanntett sjikt, membran og sluk» står ikke ferdig og får verken TG1 eller TGIU. «Ikke vurdert» betyr her: ingen regelforslag for alder på badet og punktet ikke ferdig.
  12. **HMS:** `wet_room.fixtures` / `signs_of_overheating` (kind `hms`) med konsekvens og tiltak og `tg` tom. Punktet får TG1 direkte (A505).
  I den tilfeldige delen finnes også **TGIU der hullet ikke kunne tas** (grunnen `concrete_or_masonry`): TGIU med begrunnelse, risiko og «hva må til», og «eier informert om utvidet ansvar» står tomt (fagansvarlig runde 2, punkt 7).
  Pliktige scenarioer kan dele bad når de ikke strider mot hverandre (HMS kan for eksempel ligge i badet med TG2 for alder).
- **Visningsbadet** (forbedrer 2): ett oppdrag «under arbeid» der badet viser det meste på én skjerm: TG3 før 2000 med kostnad, et TG2-utfall med fast TG i malen (for eksempel `weak_extract` på ventilasjon) med endret tekst (`edited`), TGIU med alle opplysningene, HMS uten TG, og noen punkt som står igjen. Avvist forslag ligger i scenario 9 på et annet bad, fordi TG0-forslaget ikke kan komme på samme tilliggende punkt som TGIU (avgjort av prosjektlederen, se under). E2e og testlaget finner badet med en oppslagsfunksjon (`findShowcaseBathReport`) som søker på innholdet (under arbeid, TG3 og TGIU i samme bad, organisasjonen Byggcon), ikke på rekkefølge eller antall.
- **Byggeår og befaringsår** (fagansvarlig 2–3, forbedrer 3):
  - `wet_room.build_year` betyr året rommet ble bygget eller fikk nytt vanntett sjikt. `yearRenovated` i del 1 regnes som full fornyelse med nytt sjikt, kilde `owner_stated`. Uten `yearRenovated` brukes eiendommens `buildYear`, kilde `documented`. Scenario 11 bruker `unknown`. `wet_room.membrane_year` står tomt, så regelen bruker byggeåret (testsak A8 og B6).
  - Befaringsåret leses fra oppdragets befaringsdato (`inspectionYearOf`, kilde «assignment»), aldri fast 2026 og aldri «i dag». Alle oppdrag med rapport må ha befaringsdato; ellers stopper seed med feil.
  - Del 1 får en garanti som `ensureBathroomAges`: badene med årsprofilene de pliktige scenarioene trenger, finnes i oppdrag med riktig status. En test viser at det finnes minst like mange passende bad som pliktige scenarioer.
  - Seed sjekker hvert forslag før det godtas: mangler forslaget, eller svarer `decideSuggestion` `no_longer_applies`, stopper seed med en tydelig feil. Ingen stille hopp.
- **Alle ferdige punkt har TG** (fagansvarlig 1, forskriften § 2-22, sperrekrav 1, A505): punkt uten avvik med TG får TG1 med `setTgDirect`. TG0 bare på `wet_room.adjacent` og bare ved godtatt TG0-forslag. TG1 direkte settes aldri på et punkt der en regel har et åpent forslag.
- **Uventet forslag stopper seed** (fagansvarlig runde 2, punkt 6): slår en regel til som scenarioet ikke har i `expected` (for eksempel smøremembran 15 år i badet uten avvik), stopper seed med en tydelig norsk feil, og transaksjonen for badet rulles tilbake. Seed setter da ikke TG1 og hopper ikke stille over. Det samme gjelder forslag som mangler (over).
- **Dokumentasjon «Ingen» i ferdige bad** (fagansvarlig runde 2, punkt 2, A510): når `wet_room.documentation_type` er `none` eller tomt i et ferdig eller fakturert bad, får «Dokumentasjon for våtrom» utfallet `missing_membrane_documentation` (fast TG2 i malen, kostnad «none»), ikke TG1. Gjelder blant annet scenario 2 og 3. Utkast i forsiktig retning til Ståle har svart (spørsmål nr. 106).
- **Hulltaking i alle ferdige bad** (forskriften § 2-2, sperrekrav 4): hvert bad i «ferdig» og «fakturert» har enten hull tatt med måling i vekt-%, eller «ikke utført» med grunn og TGIU.
- **«Eier informert om utvidet ansvar»** krysses bare av når grunnen er `owner_refused`. Ved `no_access`, `concrete_or_masonry` og `other` står feltet tomt (fagansvarlig runde 2, punkt 7; samme krav som advarselen `tgiu_details_missing` bruker).
- **Målinger:** fuktmåling med enhet, fall og terskelhøyde, lagret med `saveField`. Fall og terskelhøyde har ingen regel og ingen avgjort grense (regelverk-krav.md avsnitt 4): verdier uten avvik er tydelig uproblematiske, `insufficient_fall` bare ved motfall (negativ verdi), og `low_threshold_height` lages ikke. Måling i RF % gir ingen forslag (ikke vurdert), og brukes derfor bare i bad «under arbeid» der tilliggende ikke står ferdig. Ingen ferdig tilliggende med RF % og TG1 (fagansvarlig runde 2, punkt 4, A511, spørsmål nr. 107).
- **Vekt-% betyr treverk** (fagansvarlig runde 2, punkt 3, spørsmål 77 e): i scenarioer med vekt-% (TG0, forhøyet fukt, endret og avvist forslag) beskriver fritekstene for målested og oppbygging treverk (for eksempel svill eller stender i vegg mot bad), aldri betong eller mur.
- **Avvikene:** TG fra regelforslaget eller fra utfallet i malen. Ved «velg TG2 eller TG3» står valget (2 eller 3) i scenarioet. TG2 og TG3 har årsak og konsekvens fra malen (`text_source = template`, noen `edited`). TG3 har fast kostnadsintervall per utfall i datafilen, merket utkast (A509): `membrane_before_2000` får `from_200000_to_500000` fordi tiltaket er full fornyelse av våtrommet, og `elevated_moisture` med TG3 får `from_100000_to_200000` fordi tiltaket er å åpne og utbedre den fuktskadde delen. TG2 får ikke kostnad. Bruker et scenario eget beløp, er det rundet til nærmeste 10 000. HMS får ingen TG.
- **Ikke lov i testdataene** (fagansvarlig 5): TGIU-forslaget avvises eller endres aldri; alders-TG2 endres aldri til TG3; før 2000-forslaget endres ikke til TG2 og avvises ikke; ingen TG3 på «Dokumentasjon for våtrom»; ingen «utført uten funn» med 15 vekt-% eller mer (det gir advarselen `no_findings_with_reading_over_limit`, fagansvarlig runde 2, punkt 5); ingen vekt-%-tekst som beskriver betong eller mur; ingen RF % på en ferdig tilliggende.
- **Tekstene er utkast:** malens tekster har alt `text_status = draft`. Endrede tekster (`edited`) er høyst tre varianter som beholder årsak, konsekvens og flettefelt. Fritekst som ikke finnes i malen (TGIU-begrunnelse, risiko, «hva må til for å undersøke», målested, oppbygging, annen fuktundersøkelse) har én eller to korte varianter per felt i datafilen, med egne ord, merket «utkast, ikke godkjent av fagrådet», uten gjetteord («antas», «trolig»), uten henvisning til standarden og uten person- eller adresseopplysninger. Gjetteord-, kopi- og persondatatestene leser datafilen.
- **Scenariofilen er fasit** (forbedrer 5): hvert scenario har forventede avviksnøkler, TG eller «ingen TG», `text_source` (`template` eller `edited`) og **planlagte bilder per avvik** som korte beskrivelser (for eksempel «nærbilde av sluk», «fuktmåler mot vegg»). Ingen filer, ingen persondata, ingen KI-kall. «Bilder på PC» lager bildene ut fra beskrivelsene, og evalueringene og ki-ansvarlig kan bruke scenarioene som fasit.
- **«Under arbeid» ser ut som en avbrutt befaring** (forbedrer 4, presisert av prosjektlederen 23.11.2026, A512): punktene 1 til k fylles i malens rekkefølge og settes ferdige. Eneste unntak er tilliggende konstruksjoner (punkt 8 av 8): hulltaking og fuktmåling gjøres tidlig på befaringen, så tilliggende kan ha svar, regelforslag, beslutning og TGIU uten å stå ferdig, selv om punktene før står urørt. Alle andre punkt etter k står helt urørt, uten halve svar. Tidsstemplene spres ikke (se «Avgjort ved uenighet»).
- **Én transaksjon per bad** (forbedrer runde 2, tillegg 3): hvert bad skrives i sin egen transaksjon gjennom tjenestene. Feiler ett bad, rulles bare det tilbake, og feilen stopper kjøringen med tydelig melding.
- **Scenariokart i oppsummeringen** (forbedrer runde 2, tillegg 1): oppsummeringen fra `pnpm db:seed:testdata` får én linje per pliktig scenario med norsk scenarionavn, oppdragsnummer og romnavn (for eksempel «Visningsbad: oppdrag 2026-0012, Bad 1»), fra samme kilde som `assignBathScenarios`, og antall bad som ble fylt ut. Ingen `@`, navn eller adresse.
- **Feltnotat per forventet avvik** (forbedrer runde 2, tillegg 2): hvert avvik i `expected` har ett kort `fieldNote` med egne ord, slik takstmannen ville skrevet eller diktert på stedet (for eksempel «sprekk i flis ved sluk, løs flis»). Notatet står bare i datafilen, ikke i databasen, og går gjennom de samme testene for gjetteord, kopi fra standarden og persondata som de andre fritekstene. Scenarioene blir da et ferdig evalueringssett (notat gir utfallskode) for «Skriv det du ser» og «KI i veien», uten KI-kall.
- **Statusen på rapporten følger oppdraget:** «ferdig» og «fakturert» har 8 av 8 punkt ferdige; «under arbeid» har færre.
- **Ny kjøring** (test-leder 5, A508): finnes rapporten for våtrommet alt, hopper seed over hele badet og skriver antallet i oppsummeringen. Svar som er lagt inn for hånd, overskrives aldri. Et avvik med `deleted_at` gjenopprettes ikke og lages ikke på nytt. Ingenting slettes permanent.
- **Bare når `APP_ENVIRONMENT` er development eller test** (samme vakt som del 1, `testdata-guard.ts`), før noe skrives.
- **Planen:** linjen for del 2 og delpunktet under «Bilder på PC» er rettet (endringsloggen 17.11.2026). Punktet «Badet på PC» krysses av i PR-en.

**Ikke med (bevisst utelatt):**
- **Bilder** (A501). Datamodellen har ingen kobling fra fil til rom, kontrollpunkt eller avvik. Bildene lages i samme seed-steg når «Bilder på PC» lager bildemodellen, ut fra de planlagte bildene i scenariofilen. Delpunktet under «Bilder på PC» er utvidet.
- **Byggeår på eiendommen som kolonne** (A502). Kolonnen finnes ikke. Byggeåret for våtrommet står som svar i badet.
- **El, rekkverk og andre romtyper.** Bare badmalen finnes. Dekkes her av testen «ingen avvik utenfor badmalen» og «HMS uten TG». Resten kommer med malene i 2a-3.
- **KI-forslag i testdataene** (ingen rader i `ai_usage_log`, A503).
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
- [ ] Alle tolv pliktige scenarioer er brukt minst én gang, med fast fordeling; samme frø gir samme fordeling (test på datafilen og i databasen). Oppsummeringen viser scenariokartet (scenarionavn, oppdragsnummer, rom) og antall bad fylt ut, uten `@`, navn eller adresse.
- [ ] Badet uten avvik har sju punkt med TG1 og tilliggende med TG0 fra et godtatt forslag, og dokumentasjon lagt fram.
- [ ] Et forslag scenarioet ikke venter, stopper seed med tydelig feil og ruller tilbake badet (test med smøremembran uten dokumentasjon, 15 år, i scenarioet uten avvik).
- [ ] Ferdige bad med dokumentasjon «Ingen» eller tom har `missing_membrane_documentation` med TG2 og uten kostnad (A510).
- [ ] «Eier informert» er avkrysset bare ved `owner_refused`; TGIU med `concrete_or_masonry` har feltet tomt og ingen advarsel `tgiu_details_missing`.
- [ ] Datatesten feiler for vekt-%-tekst med betong eller mur, for RF % på ferdig tilliggende med TG1, og for «utført uten funn» med 15 vekt-% eller mer.
- [ ] Hver `fieldNote` i `expected` består testene for gjetteord, kopi fra standarden og persondata.
- [ ] Integrasjonstesten måler hele `seedTestdata` og feiler over 60 sekunder.
- [ ] Hvert scenario kjørt gjennom regelmotoren gir forslaget malens testsak forventer, både med befaringsåret og med klokken flyttet to år fram.
- [ ] TG bare gjennom tjenestene: hvert avvik med TG har en rad i `rule_suggestion_decisions` med samme `deviation_id`, eller kommer fra et utfall med fast TG, eller fra «velg TG2 eller TG3» med TG 2 eller 3 og en rad fra `setTgDirect` i revisjonsloggen. TG1 direkte bare på punkt uten avvik med TG og uten åpent forslag. En statisk test viser at seed-filene ikke skriver til `deviations`, `checkpoint_results` eller `rule_suggestion_decisions` med `insert` eller `update`.
- [ ] Hele datasettet: ingen TG3 uten kostnadsintervall, ingen TG2 eller TG3 uten årsak og konsekvens, ingen TG2 med kostnad, ingen TG0 utenfor tilliggende, ingen TG3 på dokumentasjon, ingen TG på HMS (testen feiler ved 0 HMS-avvik), ingen avvik utenfor badmalen, ingen ferdig punkt uten TG.
- [ ] «Ferdig» og «fakturert» har 8 av 8 punkt ferdige, hulltaking med måling eller TGIU med grunn, og ingen av advarslene `tg3_on_age_only`, `tgiu_suggested_not_set`, `tgiu_details_missing` og `checkpoint_done_without_tg`. «Under arbeid» har færre enn 8, og punktene som står igjen, har ingen svar (unntak: tilliggende kan ha hulltaking, forslag og TGIU uten å stå ferdig, A512).
- [ ] Testsakene fra fagansvarlig består (alder −18 gir TG2, −17 gir ingenting, 1999 gir TG3 uten TG2, 2000 gir TG2, hull nektet gir TGIU uten TG2, 14,9 vekt-% gir TG0 bare på tilliggende, 15 vekt-% gir fukt med riktig tiltak, RF % og «Ukjent» gir ikke vurdert).
- [ ] `build_year` og `build_year_source` stemmer med `yearRenovated` (`owner_stated`) eller `buildYear` (`documented`), og `membrane_year` er tomt.
- [ ] To kjøringer på rad gir like mange rader per tabell og samme TG per bad. En rapport som er endret for hånd, og et avvik som er myk-slettet, røres ikke ved ny kjøring.
- [ ] Seed stopper med tydelig melding når `APP_ENVIRONMENT` ikke er development eller test, eller mangler, før noe skrives (0 nye rader).
- [ ] Ingen rader i `ai_usage_log` fra seed. Aktøren i revisjonsloggen er takstmannen på oppdraget, aldri admin.
- [ ] Ingen tekst i datafilen eller rapportdataene har navn, adresse, e-post, telefon eller matrikkel fra testdataene, gjetteord eller tekst fra standarden (test med `tests/redaction.ts` og `tests/known-values.ts`).
- [ ] Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget), og en annen organisasjon har samme radtall før og etter seed. Takstmann, kontor, leder og admin åpner en seedet rapport slik badskjermen tillater.
- [ ] `TESTDATA_TABLES` og oppsummeringen viser de nye tabellene og antall bad som er hoppet over.
- [ ] E2e (PC og iPad-størrelse): visningsbadet, funnet med `findShowcaseBathReport`, viser TG3 med kostnad, TGIU og fremdrift «x av 8» med x < 8 og totalen 8. Badet uten avvik vises riktig.
- [ ] Versjonen i `package.json` er økt (patch). A501–A512 er ført i `docs/09-apne-sporsmal.md`.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md` av utvikleren)
- **A501 (lett å endre):** Bilder i testdataene kommer med «Bilder på PC», ikke nå, fordi bildemodellen ikke finnes. Scenariofilen har planlagte bilder som beskrivelser.
- **A502 (lett å endre):** Byggeår som kolonne på eiendommen kommer ikke her. Byggeåret for våtrommet legges som svar i badet.
- **A503 (lett å endre):** Seed skriver ingen KI-rader i `ai_usage_log`. Falsk historikk ville forstyrret tallene for godtatt og avvist.
- **A504 (lett å endre):** De tolv pliktige scenarioene fordeles fast på de første badene som passer (sortert på oppdragsnummer); tilfeldigheten brukes bare for resten. «Velg TG2 eller TG3» bestemmes i scenarioet.
- **A505 (lett å endre):** Seed setter TG1 med `setTgDirect` på ferdige punkt uten avvik med TG (også punkt med bare HMS-avvik). Dette er den eneste TG-en seed setter uten regel eller utfall. Kilde: forskriften § 2-22 (alle punkt skal ha TG), sperrekrav 1.
- **A506 (lett å endre):** Endret forslag i testdataene er TG0 → TG1 på tilliggende; avvist forslag er TG0-forslaget på tilliggende med `measured_again`, på et bad under arbeid der punktet ikke er ferdig. Begge går i den forsiktige retningen og gir ingen ferdig rapport med TG mot et regelforslag.
- **A507 (lett å endre):** `yearRenovated` i del 1 betyr nytt vanntett sjikt, kilde `owner_stated`; ellers eiendommens byggeår med kilde `documented`. `membrane_year` står tomt.
- **A508 (lett å endre):** Ny kjøring hopper over bad som alt har rapport, uten å overskrive, og myk-slettede avvik lages ikke på nytt.
- **A509 (lett å endre):** Kostnadsintervallet for TG3 er fast per utfall i datafilen og merket utkast, til fagrådet har svart (spørsmål nr. 92). Sjikt fra før 2000: 200 000–500 000, fordi tiltaket er full fornyelse av våtrommet (de to laveste intervallene er ikke rimelige, fagansvarlig runde 2). Forhøyet fukt med TG3: 100 000–200 000 (åpne og utbedre den fuktskadde delen).
- **A510 (lett å endre):** Dokumentasjon «Ingen» eller tom i et ferdig bad gir utfallet `missing_membrane_documentation` (TG2 fra malen, uten kostnad), ikke TG1. Forsiktig retning: uten papirer kan sjiktet ikke kontrolleres. Spørsmål nr. 106.
- **A511 (lett å endre):** Fukt målt i RF % brukes bare i bad under arbeid der tilliggende ikke står ferdig, fordi ingen regel gir forslag og TG1 da ville vært uten faglig grunnlag. Spørsmål nr. 107.
- **A512 (lett å endre):** «Under arbeid» fylles i malens rekkefølge, men tilliggende konstruksjoner (punkt 8) kan ha hulltaking, forslag og TGIU uten å stå ferdig, fordi hullet tas tidlig på befaringen. Trengs for visningsbadet og scenario 9.

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
- Scenariokart i oppsummeringen: scenarionavn, oppdragsnummer og rom per pliktig scenario, og antall bad fylt ut (forbedrer runde 2, tillegg 1, 23.11.2026).
- Feltnotat per forventet avvik i scenariofilen, som evalueringssett for «Skriv det du ser» og «KI i veien» (forbedrer runde 2, tillegg 2, 23.11.2026).
- Én transaksjon per bad og tidsgrense på 60 sekunder for hele kjøringen i integrasjonstesten (forbedrer runde 2, tillegg 3, 23.11.2026).
- Nytt planpunkt i 2a-2 «Fra forbedreren»: **Øvingsbad for nye takstmenn** (bygges i tur, ikke her).

## Roller
- **utvikler:** scenariofilen og seed-steget.
- **testskriver** (parallelt): akseptkriteriene som tester, uavhengig av seed-koden.
- **ki-ansvarlig:** vurderer oppgaven på nytt (planen) før byggingen, og PR-en før merge.
- **fagansvarlig:** sjekker at scenarioene og valgene av TG, årsak, konsekvens og kostnad er faglig rimelige (utkast).

## Avgjort ved uenighet, runde 2 (prosjektlederen 23.11.2026)
- Fagansvarliges punkt 1, 3, 5, 6 og 7 er rene rettinger og tatt inn som de står. Punkt 2, 4 og 8 er tatt inn som utkast i forsiktig retning (A510, A511, A509) med spørsmål til Ståle.
- Rekkefølgen for «under arbeid» er presisert med unntaket for tilliggende (A512) i stedet for å flytte TGIU og det avviste forslaget ut av badene under arbeid. Visningsbadet og scenario 9 er viktigere enn en streng rekkefølge, og unntaket ligner en ekte befaring.
- Scenario 10 heter fortsatt «Bad uten avvik»: TG0 på tilliggende er ikke et avvik.

## Åpne spørsmål
- Nr. 106 og 107 i `docs/09-apne-sporsmal.md` (dokumentasjon «Ingen» og TG ved måling i RF %). Stopper ikke oppgaven.
- Nr. 92 i `docs/09-apne-sporsmal.md` (kostnadsintervall for sjikt fra før 2000 og forhøyet fukt med TG3, og at alderstabellen og 15 vekt-% er ukontrollerte utkast). Stopper ikke oppgaven.
