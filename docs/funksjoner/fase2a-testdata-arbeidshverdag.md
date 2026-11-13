# Funksjon: Testdata som ligner en ekte arbeidshverdag

- **Fase:** 2a (prioritert av Ståle 13.11.2026, tas før resten av 2a)
- **Modul:** `src/db/seed` (testdata), `.github/workflows/deploy-azure.yml` (kall fra utrullingen)
- **Status:** utkast
- **Branch:** `testdata-arbeidshverdag` (bygger på `main`)
- **Støtter hovedmål:**
  - **De ansatte:** når de logger inn i testmiljøet, ser de med en gang en full arbeidsdag (arbeidskø, ordre, oppdrag i alle statuser, kalender over flere måneder, reklamasjoner, tidsstatistikk). Da kan de prøve og si fra om systemet uten å lage alt selv først.
  - **KI i bunnen:** realistiske, oppdiktede navn, adresser, matrikkel og telefonnumre i partene gir vasken før KI (`src/core/ai/redaction.ts`) og evalueringene noe ekte-lignende å prøve seg på, uten risiko.
  - **Færre reklamasjoner:** reklamasjonssakene og ytelsen kan prøves med en mengde data som ligner drift (rundt 50 eiendommer, flere måneder), slik at feil i lister, søk og statistikk finnes før lansering.

## Problem
Testmiljøet har i dag bare fire testoppdrag i en egen prøveorganisasjon (`pnpm db:seed:testoppdrag`). De ansatte logger inn i Byggcon-organisasjonen og ser nesten ingenting. Ståle 13.11.2026: «Legg inn testdata og fiktive navn, eiendommer, bilder med mer for å teste løsningen. Reelle data kommer i produksjonsmiljøet.» Uten slike data må hver tester lage oppdrag for hånd, og lister, søk, statistikk og ytelse blir aldri prøvd med en mengde som ligner drift.

## KI i bunnen
- KI lager ikke testdataene. Dataene lages av et fast skript med fast tilfeldighetsfrø, slik at de er like hver gang og kan testes.
- Dataene er laget slik at KI-veien kan prøves: partene har oppdiktede navn, e-post, telefon og adresser, og eiendommene har matrikkel. Vasken skal fjerne disse før noe sendes til KI. Testdataene brukes av ki-ansvarlig til å sjekke at vasken treffer på realistiske data (ingen ekte data trengs).
- Ingen nye KI-kall, ingen nye rader i `ai_usage_log`. Alt KI går fortsatt gjennom `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg **se egne oppdrag med befaringstider denne og neste uke** i testmiljøet, slik at jeg kan prøve arbeidskøen og oppdragssiden som en vanlig dag.
- Som **kontor** vil jeg **se ordre, oppdrag i alle statuser og fakturerte oppdrag over flere måneder**, slik at jeg kan prøve søk, filtre og arbeidsflyten.
- Som **leder** vil jeg **se reklamasjonssaker og tidsstatistikk** med data fra flere takstmenn og kontorer.
- Som **admin** vil jeg **kjøre skriptet på nytt** uten at noe dobles, og vite at det aldri kan kjøres i produksjon.

## Omfang
**Med:**
- Nytt skript `pnpm db:seed:testdata` (`src/db/seed/testdata-index.ts` og `testdata.ts`, data i `testdata.data.ts`). Bygger på `runSeed` (organisasjonen Byggcon, selskapene og kontorene) og mønsteret i `sample-assignments.ts` (sjekk først, lag bare det som mangler).
- **Organisasjonen:** dataene legges i organisasjonen fra `pnpm db:seed` (Byggcon), den de ansatte logger inn i. Ikke i prøveorganisasjonen.
- **Selskaper og kontorer:** de som `runSeed` lager. Ingen nye.
- **Ansatte:** 12 oppdiktede ansatte fordelt på selskapene og kontorene, i alle rollene (takstmann, kontor, leder, admin og de andre rollene som finnes i dag), med sertifiseringer der tabellen finnes. De kan ikke logge inn (e-post på et domene som ikke kan motta post).
- **Kontakter og firma:** 4–5 oppdiktede meglerfirma med meglere, og selgere og kjøpere som parter på oppdragene.
- **Eiendommer:** rundt 50, fordelt på eneboliger, rekkehus, leiligheter i sameie (seksjon) og borettslag (andel, med borettslagets navn og andelsnummer), og fritidsboliger. Med matrikkel, byggeår, kommune og fellesarealer der det passer.
- **Bygninger, etasjer, rom og arealmålinger** (`report_buildings`, `floors`, `rooms`, `floor_areas`) på oppdragene som er befart. Arealmålingene er «målingene» i denne leveransen.
- **Oppdrag i alle fire statuser** (bestilt, under arbeid, ferdig, fakturert) og noen ordre som ikke er gjort om ennå, spredd over rundt fire måneder bakover og fire uker fremover, med befaringstid, frist, team (ansvarlig, sidemann, kontor) og parter. Fakturert oppdrag er fakturagrunnlaget som finnes i datamodellen i dag.
- **Tidsregistrering** (`work_sessions`) på ferdige og fakturerte oppdrag, slik at tidsstatistikken viser noe.
- **Reklamasjoner:** 3–4 saker (`claims`) med ulike utfall (åpen, avvist, medhold, forlik).
- **Oppdiktede verdier som ikke kan forveksles med ekte:**
  - e-post på domenet `testdata.invalid` (`.invalid` kan aldri motta post),
  - telefonnumre som ikke kan tildeles i Norge (se A265),
  - gårdsnummer 9001–9099 (finnes ikke i noen kommune),
  - gatenavn fra en fast liste med oppdiktede navn, ekte postnummer og kommune i Nordland og Troms (for at kart og kommune skal se riktige ut),
  - organisasjonsnummer på meglerfirma står tomt.
- **Fast tilfeldighetsfrø** (egen liten generator i koden, ingen ny pakke). Datoene regnes fra dagen for første kjøring og flyttes ikke ved senere kjøringer.
- **Idempotent:** andre kjøring skriver ingenting. Hver rad kjennes igjen på en fast nøkkel (`orders.external_ref` med prefikset `TD-`, og tilsvarende for kontakter, eiendommer og ansatte).
- **Produksjonsvakt:** skriptet stopper med tydelig melding før noe skrives, med mindre miljøvariabelen `APP_ENVIRONMENT` er `development` eller `test`. Mangler den, stopper skriptet også. `.env.example` får `APP_ENVIRONMENT=development`; `start.sh` oppdateres hvis den trengs.
- **Utrullingen til testmiljøet** kaller `pnpm db:seed:testdata` etter `pnpm db:seed:testoppdrag`, med `APP_ENVIRONMENT: test` i steget «Migrering og seed».
- **Tester:** idempotens (to kjøringer gir samme antall rader), produksjonsvakt (`production`, tom og ukjent verdi stopper før noen skriving), tenant-isolasjon (alt havner i Byggcon-organisasjonen, ingenting i en annen), og «ingen ekte-lignende data» (alle e-poster ender på `.invalid`, alle telefonnumre følger det sperrede mønsteret, alle gårdsnummer er 9001–9099, ingen navn eller adresser fra `docs/kartlegging/`).
- Dokumentasjon: kort avsnitt i `docs/drift/testmiljo-azure.md` og kommandoen i `CLAUDE.md`. Versjon i `package.json` økes.

**Ikke med (bevisst utelatt):**
- **Bilder.** Datamodellen har i dag ingen plass som knytter en fil til rom eller avvik (`files` har bare nøkkel og type). Bilder uten personer, laget av skriptet som PNG, legges inn sammen med 2a-2 «Badet på PC», når avvikskort og bildekobling finnes (A264). Ingen løse bildefiler uten kobling nå.
- **Funn, avvik, TG og målinger per kontrollpunkt.** Tabellene for rapportsvar og avvikskort finnes ikke ennå. De fylles i samme oppgave som bygger dem (A264). Ingen bruk av `trial_*`-tabellene (prøveskjemaet fra fase 1).
- **Video.** Kommer senere, etter planen.
- Nye tabeller, nye kolonner eller migreringer.
- Endring av `pnpm db:seed:testoppdrag` og prøveorganisasjonen.
- Sletting eller rydding av testdata (regel 3). Et «nullstill testdata»-skript er ikke med.
- Innlogging for de oppdiktede ansatte.
- Kjøring mot produksjon på noen måte.

## Tilgang
Ingen nye rettigheter. Dataene vises etter dagens regler i `src/core/access`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som i dag (alle oppdrag, `access.inspectors_edit_all`) | som i dag |
| kontor | som i dag | som i dag |
| leder | som i dag, også reklamasjoner | som i dag |
| admin | alt | alt; kjører skriptet |

## Data
Ingen nye tabeller eller felter. Tabeller som fylles: `users`, `employees`, `employee_roles`, `certifications`, `firms`, `contacts`, `client_agreements` (hvis naturlig), `orders`, `assignments`, `assignment_team_members`, `assignment_parties`, `properties`, `cadastral_units`, `common_areas`, `report_buildings`, `floors`, `rooms`, `floor_areas`, `work_sessions`, `claims`, `events` og `audit_log` (gjennom tjenestene). Oppdrag, ordre, statusbytter og reklamasjoner lages gjennom tjenestene i `src/core` (nummerserie, hendelser og kontroller gjelder). Grunndata (ansatte, roller) kan legges inn direkte, som i `runSeed`. Ordlisten får `APP_ENVIRONMENT` og «testdata».

## Skjermer
Ingen nye skjermer. Eksisterende skjermer får innhold: arbeidskøen, ordrelisten, oppdragssiden, bygninger og rom, reklamasjoner, tidsstatistikk og søket.

## Regler
Ingen nye regler. Ingen TG settes.

## Akseptkriterier
- [ ] `pnpm db:seed:testdata` etter `pnpm db:seed` gir i Byggcon-organisasjonen: 10–15 oppdiktede ansatte i alle rollene, 4–5 meglerfirma med meglere, rundt 50 eiendommer av alle fire slagene med matrikkel, byggeår og areal, oppdrag i alle fire statuser fordelt over flere måneder, og 3–4 reklamasjoner.
- [ ] Andre kjøring skriver ingenting (test teller rader før og etter).
- [ ] Skriptet stopper før noen skriving når `APP_ENVIRONMENT` er `production`, tom eller ukjent (test).
- [ ] Alt havner i organisasjonen fra `pnpm db:seed`; en annen organisasjon får ingen rader og ingen tilgang (`expectTenantIsolation`).
- [ ] Alle e-poster ender på `.invalid`, alle telefonnumre følger det sperrede mønsteret, alle gårdsnummer er 9001–9099 (test).
- [ ] Utrullingen kaller skriptet med `APP_ENVIRONMENT: test`; CI er grønn.
- [ ] Skriptet logger bare antall og nøkler (`TD-…`), aldri navn eller e-post.
- [ ] Arbeidskøen og ordrelisten åpnes på under 2 sekunder med testdataene (e2e eller måling i test).
- [ ] Virker på iPad-størrelse (e2e: arbeidskøen viser testoppdrag).
- [ ] Ingen nye avhengigheter.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`, neste ledige nummer, foreløpig A264–A267)
- **A264 (lett å endre):** Bilder, funn, TG og målinger per kontrollpunkt legges inn i testdataene av oppgaven som bygger avvikskort og bildekobling (2a-2 «Badet på PC»), ikke nå. Grunn: datamodellen har ikke plass ennå, og oppgaven sier «bare der datamodellen har plass». Planpunktet krysses av når denne PR-en er levert, og 2a-2 «Badet på PC» får en linje om å utvide testdataene.
- **A265 (lett å endre):** Oppdiktede kontaktdata: e-post på `testdata.invalid`, telefonnumre i et mønster som ikke kan tildeles (utvikler velger mønster som passer dagens validering i `src/core/contacts`, og skriver det i koden), gårdsnummer 9001–9099.
- **A266 (dyrt å endre):** Produksjonsvakten er en egen miljøvariabel `APP_ENVIRONMENT` (development, test, production) som må være satt, ikke `NODE_ENV` (testmiljøet kjører også med `NODE_ENV=production`). Manglende verdi stopper skriptet.
- **A267 (lett å endre):** Testdataene ligger i Byggcon-organisasjonen som de ansatte logger inn i, ved siden av ekte arbeid de ansatte gjør i testmiljøet. Alt er merket med `TD-` i fast nøkkel, slik at det kan kjennes igjen.

## Roller
utvikler (skript, vakt, utrulling), testskriver (idempotens, vakt, tenant, ekte-lignende data), sikkerhet-personvern (produksjonsvakten og at ingenting ligner ekte data), fagansvarlig (at eiendommer, byggeår, arealer, romtyper og reklamasjoner ser realistiske ut), ki-ansvarlig (kort sjekk at partsdataene kan brukes til å prøve vasken).

## Åpne spørsmål
- Ingen som stopper oppgaven.
