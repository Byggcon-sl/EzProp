# Funksjon: Testdata, del 2 (badet fylt ut i testoppdragene)

- **Fase:** 2a-2 Hele veien først, under punktet «Badet på PC» (A300, A359)
- **Modul:** seed (`src/db/seed/testdata*.ts`), bruker kjernetjenestene i `src/core/reports` og regelmotoren i `src/core/rules` uten å endre dem
- **Branch:** `testdata-del-2` (bygger på `main` etter PR #224 og PR #203)
- **Status:** utkast
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
- **Scenarioer som data** (ny ren fil, for eksempel `src/db/seed/testdata-bath.data.ts`): et lite sett faste bad-scenarioer bygd på inndataene i malens `rule_test_cases` (`src/db/seed/templates/wet-room.ts`), ikke på egne TG-er. Hvert scenario er svar per kontrollpunkt (feltkoder og verdier) og hvilke forslag takstmannen godtar, endrer eller avviser. Scenarioet velges per oppdrag med den seedede tilfeldighetsgeneratoren, slik at to kjøringer gir samme resultat. Dekker minst:
  - folie uten dokumentasjon, eldre enn levetiden → TG2-forslag godtatt;
  - sjikt fra før 2000 → TG3-forslag godtatt, med kostnadsanslag;
  - hulltaking ikke utført med grunn → TGIU med begrunnelse;
  - hulltaking uten funn under grensen → TG0-forslag godtatt;
  - forhøyet fukt → «velg TG2 eller TG3», ett scenario med hvert valg;
  - ett forslag som er endret og ett som er avvist, med begrunnelseskode;
  - ett bad helt uten avvik (alle punkt ferdige);
  - ett bad med «Ukjent» byggeår (T-0051, ikke vurdert).
- **Målinger per kontrollpunkt:** fuktmåling med enhet, terskelhøyde og andre tallfelt malen har, lagret som svar med `saveField`.
- **Byggeåret for våtrommet** (`wet_room.build_year` og `wet_room.build_year_source`) fylles fra datafilen i del 1 (`yearRenovated`, ellers eiendommens `buildYear`). Aldersreglene treffer da som årstallene i del 1 er valgt for.
- **Avvikene:** TG fra regelforslaget eller fra utfallet i malen. Når utfallet er «velg TG2 eller TG3», står valget i scenarioet og må være et av de to lovlige. TG2 og TG3 har årsak og konsekvens fra malens tekster (`text_source = template`, enkelte `edited`). TG3 har kostnadsanslag med en av de faste kostnadsintervallene. Utfall av typen HMS får ingen TG.
- **Tekstene er utkast:** alle tekster kommer fra malen, som alt har `text_status = draft` («utkast, ikke godkjent av fagrådet»). Tekst som seed endrer (`edited`), får samme merking i datafilen og ingen ny fagformulering utover korte varianter av malens tekst.
- **Statusen på rapporten følger oppdraget:** «ferdig» og «fakturert» har alle kontrollpunkt ferdige; «under arbeid» har noen punkt igjen.
- **Tåler å kjøres to ganger** uten nye rader (slår opp rapport og avvik på nøkkel, som del 1).
- **Bare når `APP_ENVIRONMENT` er development eller test** (samme vakt som del 1, `testdata-guard.ts`).
- **Planen:** linjen for del 2 rettes slik at bilder og byggeår-kolonnen står der de hører hjemme (se «Ikke med»), med én linje i `docs/plan/endringslogg.md`. Punktet «Badet på PC» krysses av i PR-en.

**Ikke med (bevisst utelatt):**
- **Bilder** (A427). Datamodellen har ingen kobling fra fil til rom, kontrollpunkt eller avvik. Bilder uten kobling gir ingenting å prøve på skjermen. De legges inn i samme seed-steg når «Bilder på PC» (2a-2) lager bildemodellen; delpunktet der utvides fra «de fire testoppdragene» til også testdataene.
- **Byggeår på eiendommen som kolonne** (A428). Kolonnen finnes ikke, og planen sier «når kolonnen finnes». Byggeåret for våtrommet står som svar i badet (over).
- **El, rekkverk og andre romtyper.** Bare badmalen finnes. Kravet «el, rekkverk og HMS får ingen TG» gjelder her som en test: ingen avvik utenfor badmalen, og HMS-utfall har `tg` tom. Resten kommer med malene i 2a-3.
- **KI-forslag i testdataene** (ingen rader i `ai_usage_log`, se «KI i bunnen»).
- **Nye regler, nye avvikstekster eller endringer i malen og kjernetjenestene.** Finnes det et hull i tjenestene, føres det som funn, ikke rettes her.
- **Ny migrering.**

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
- [ ] `pnpm db:seed:testdata` gir rapport i hvert våtrom i oppdrag med status «under arbeid», «ferdig» og «fakturert», og ingen i «bestilt».
- [ ] Hvert avvik med TG har enten en rad i `rule_suggestion_decisions` med `deviation_id` eller kommer fra et utfall i malen med fast TG; en test viser at ingen TG er skrevet forbi tjenestene.
- [ ] Testdataene har minst ett bad med hver av: TG2, TG3, TGIU, TG0, «ikke vurdert», forslag endret, forslag avvist, og bad uten avvik.
- [ ] Alle TG3 har kostnadsanslag med fast intervallkode; alle TG2 og TG3 har årsak og konsekvens.
- [ ] HMS-utfall har ingen TG, og ingen avvik ligger utenfor badmalen.
- [ ] To kjøringer på rad gir like mange rader (ingen dubletter) og samme TG per bad.
- [ ] Seed stopper med tydelig melding når `APP_ENVIRONMENT` ikke er development eller test, før noe skrives.
- [ ] Ingen tekstfelt i rapportdataene inneholder navn, adresse, e-post, telefon eller matrikkel fra testdataene (test).
- [ ] Bruker i annen organisasjon ser ingen av rapportene (`expectTenantIsolation` på oppslaget testen bruker).
- [ ] E2e: et testoppdrag «under arbeid» åpnes på PC og iPad-størrelse, og badet viser TG3 med kostnad og fremdrift «x av 8».
- [ ] Versjonen i `package.json` er økt (patch).

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md` av utvikleren)
- **A427 (lett å endre):** Bilder i testdataene kommer med «Bilder på PC», ikke nå, fordi bildemodellen ikke finnes. Delpunktet under «Bilder på PC» utvides til testdataene.
- **A428 (lett å endre):** Byggeår som kolonne på eiendommen kommer ikke her. Byggeåret for våtrommet legges som svar i badet.
- **A429 (lett å endre):** Seed skriver ingen KI-rader i `ai_usage_log`. Falsk historikk ville forstyrret tallene for godtatt og avvist.
- **A430 (lett å endre):** Scenarioene bygger på malens testsaker og velges per oppdrag med fast tilfeldighet; «velg TG2 eller TG3» bestemmes i scenarioet.

## Roller
- **utvikler:** scenariofilen og seed-steget.
- **testskriver** (parallelt): akseptkriteriene som tester, uavhengig av seed-koden.
- **ki-ansvarlig:** vurderer oppgaven på nytt (planen) før byggingen, og PR-en før merge.
- **fagansvarlig:** sjekker at scenarioene og valgene av TG, årsak, konsekvens og kostnad er faglig rimelige (utkast).

## Åpne spørsmål
- Ingen som stopper oppgaven.
