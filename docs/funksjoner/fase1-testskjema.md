# Funksjon: Testoppsett for prøven uten nett (testskjema og app på hjemskjermen)

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (ny, kastes etter fase 1 eller gjøres om til feltkomponenter i fase 2b)
- **Status:** utkast (oppgavekort 28.10.2026)
- **Branch:** `fase1-testskjema` (bygger på `main`)
- **Dato:** 28.10.2026
- **Plan:** `docs/07-utviklingsplan.md` fase 1, første punkt: «Testoppsett: to iPad Pro, appen lagt på hjemskjermen (PWA), et testskjema med ca. 40 felt (tekst, TG, valg, tall, tabell) og bildefelt»
- **Støtter hovedmål:** Tid: grunnlaget for befaring på iPad, som er den største tidsbesparelsen mot IVIT (alt skrives én gang, på stedet). / Reklamasjoner: indirekte, prøvene A–F skal vise at ingenting går tapt mellom befaring og rapport. / KI først: prøven er uten KI, men plattformen som velges i fase 1 er den KI-forslag senere skal vises i på iPaden (se under).

## Problem
Fase 1 skal finne ut om befaring uten nett i nettleseren på iPad Pro holder mål, før noe stort bygges (sidemannskontrollen T1 og P20–P23). For å prøve kandidatene (PowerSync, ElectricSQL, egenbygd) trenger vi tre ting som er like for alle: et lite testskjema med de felttypene en ekte befaring har, en app som kan legges på hjemskjermen (Safari kan slette lagrede data for nettsider som ikke ligger der), og en plan som sier hva hver prøve skal vise og hvordan kandidatene sammenlignes. Uten dette blir prøvene ulike fra kandidat til kandidat, og valget i ADR-en blir synsing.

## KI først
Nei, ikke i denne oppgaven. Dette er teknisk grunnarbeid (skjema, installering, plan). KI kommer ikke inn før grunnmuren står (beslutning 25.10.2026). Oppgaven støtter likevel «KI først» på sikt: skjemaet og synkløsningen som velges, er der KI-forslag (TG, tekst) senere skal vises og godkjennes av takstmannen på iPaden. Skjemaet skal derfor ha de felttypene KI senere fyller ut (tekst, TG, valg, tall).

## Brukerhistorier
- Som **takstmann** vil jeg **fylle ut et skjema med tekst, TG, valg, tall, tabell og bilder på iPaden** slik at **prøvene i fase 1 ligner en ekte befaring**.
- Som **Ståle (produkteier)** vil jeg **legge appen på hjemskjermen på to iPader** slik at **prøvene kjøres slik takstmennene skal bruke appen**.
- Som **prosjektleder** vil jeg **ha en plan for prøvene A–F og faste kriterier** slik at **kandidatene sammenlignes likt og valget kan begrunnes i ADR-en**.

## Omfang
**Med:**

1. **Testskjemaet som data.** `src/modules/offline-trial/trial-form.ts` eksporterer `trialForm`: grupper med felt, hvert felt med `key` (fast, engelsk), `label` (norsk), `type` og eventuelle valg/kolonner. Typene følger `field_type` i domenemodellen: `text`, `tg`, `choice`, `number`, `table`, `photo`. (`tg` er ikke en egen felttype i den ekte malen, der TG settes på kontrollpunktet. I testskjemaet er det en felttype, fordi prøvene trenger et felt der «siste endring vinner».) Feltene står i tabellen under: 40 felt, 6 grupper. Etikettene er vanlige ord, ingen tekst fra NS 3600, IVIT eller SmartTakst.
2. **Svar som felles form.** `TrialAnswers = Record<fieldKey, TrialValue>` der `TrialValue` er `string` (tekst), `"TG0" | "TG1" | "TG2" | "TG3" | "TGIU"`, `string` (valgt kode), `number`, `TrialTableRow[]` (tabell) eller `TrialPhoto[]` (bilde: `{ id, name, sizeBytes, previewUrl }`). Kandidatene i oppgave 4 skal lagre og synke akkurat denne formen, så skjemaet må ikke vite hvor svarene bor.
3. **Skjermen.** `src/modules/offline-trial/trial-form-view.tsx` (klientkomponent) tar `form`, `answers` og `onChange(fieldKey, value)`. Siden `src/app/(ansatt)/prove/testskjema/page.tsx` er tynn: krever innlogget ansatt (`requireActor`), holder svarene i minnet på siden i denne oppgaven, og viser «N av 40 felt utfylt» øverst. Lenke «Prøve uten nett: testskjema» på arbeidskøen, så den er lett å finne på iPaden.
   - Tekst: tekstområde, 3 linjer, vokser.
   - TG: fem knapper på rad (`TG0`, `TG1`, `TG2`, `TG3`, `TGIU`), valgt knapp tydelig markert med tekst og farge (aldri bare farge).
   - Valg: knapper på rad, ikke nedtrekksmeny (designprinsipp 6).
   - Tall: `input type="text" inputMode="decimal"` med enhet etter feltet, godtar komma og punktum.
   - Tabell: kolonner som definert, knapp «Legg til rad», hver rad kan slettes. Maks 20 rader.
   - Bilde: `input type="file" accept="image/*" capture="environment" multiple`, så Safari åpner kameraet direkte. Viser små forhåndsvisninger og antall. Bildene holdes bare i minnet (objekt-URL), ikke lastet opp.
   - Trykkflater minst 44 pt, hovedknapper 56 pt. Alle felt har `label` koblet med `htmlFor`/`id`, så e2e kan bruke `getByLabel`. Fungerer på PC og iPad-størrelse.
4. **App på hjemskjermen.** `src/app/manifest.ts` (Next.js metadata-rute): navn og kortnavn fra `brand`, `start_url: "/arbeidskoe"`, `display: "standalone"`, `theme_color`/`background_color` Byggcon-blå `#326CA1` (legges i `brand.ts` som `brand.color`), `lang: "nb"`. Ikoner lages av `src/app/icon.tsx` (512 px) og `src/app/apple-icon.tsx` (180 px) med `ImageResponse` fra `next/og` (ingen ny avhengighet): blå flate med produktnavnets to første bokstaver i hvitt. `metadata.appleWebApp = { capable: true, title: brand.productName, statusBarStyle: "default" }` i `src/app/layout.tsx`. `scripts/session-start.sh` og `start.sh` trenger ingen endring.
5. **Plan for prøvene A–F og kriteriene** står i dette dokumentet (avsnittene under). Det er dette som legges fram for Ståle.
6. **Tester** (se testplan): enhetstest av `trialForm` og e2e i PC- og iPad-størrelse som fyller ut alle 40 feltene.
7. Ordliste i `docs/05-domenemodell.md` avsnitt 8: «prøve uten nett» → `offline-trial`, «testskjema» → `trial form`. Kryss av punktet i `docs/07-utviklingsplan.md`. Øk patch-versjon i `package.json` (0.1.1 → 0.1.2).

**Ikke med (bevisst utelatt):**
- Ingen lagring uten nett, ingen service worker, ingen synk, ingen PowerSync/ElectricSQL/Yjs. Det er oppgave 4 og 5. Appen på hjemskjermen trenger nett i denne oppgaven, og det er greit.
- Ingen lagring på serveren. Svarene lever i minnet på siden og forsvinner når siden lastes på nytt. Hver kandidat i oppgave 4 legger til sin lagring bak `answers`/`onChange`.
- Ingen nye tabeller, ingen migreringer, ingen nye avhengigheter.
- Ingen opplasting, komprimering, rotering eller HEIC-til-JPEG av bilder (prøve D).
- Ingen regler eller TG-logikk (prøve E). Skjemaet har bare tallfeltene prøve E trenger (byggeår, alder på bereder, fuktmåling).
- Ingen synkstatus eller nettindikator (eget punkt i fase 1).
- Ingen kobling til den ekte malmotoren, kontrollpunkter, oppdrag eller rapporter. Testskjemaet er ikke en systemmal.
- Ingen ny tilgangslogikk. Siden krever innlogging som alle sider under `(ansatt)`; alle roller får åpne den.
- Ingen Safari-test i e2e (Playwright bruker Chromium i iPad-størrelse). Safari på ekte iPad testes for hånd av Ståle i prøvene.
- Selve iPadene og hvor prøveappen kjører: Ståle (se åpne spørsmål).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (eget skjema i minnet) | ja |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja |

Ingen data lagres, ingen `organizationId` i spørringer, så ingen ny tenant-isolasjonstest. Det skal stå i PR-en. E2e sjekker at siden krever innlogging.

## Data
Ingen nye eller endrede tabeller. Faste koder i testskjemaet (`key`) er prefiks-frie engelske navn som i tabellen under; de holdes uendret gjennom hele fase 1, slik at kandidatene kan sammenlignes på samme data. Bildene har id laget på enheten (`uuid v7` fra `src/shared/lib/uuid.ts`).

### Feltene (40)

| Gruppe | Key | Etikett | Type | Detaljer |
|---|---|---|---|---|
| Om boligen | `building_year` | Byggeår | number | heltall |
| | `building_type` | Boligtype | choice | `detached` Enebolig, `apartment` Leilighet, `row_house` Rekkehus |
| | `floors` | Antall etasjer | number | |
| | `usable_area` | Bruksareal | number | m² |
| | `general_description` | Generell beskrivelse | text | |
| | `cover_photo` | Forsidebilde | photo | |
| Utvendig | `roof_tg` | Tak – tilstandsgrad | tg | |
| | `roof_description` | Tak – beskrivelse | text | |
| | `roof_covering` | Taktekking | choice | `tiles` Takstein, `metal` Metall, `felt` Papp, `other` Annet |
| | `roof_covering_age` | Taktekkingens alder | number | år |
| | `roof_photo` | Tak – bilde | photo | |
| | `walls_tg` | Yttervegger – tilstandsgrad | tg | |
| | `walls_description` | Yttervegger – beskrivelse | text | |
| | `walls_photo` | Yttervegger – bilde | photo | |
| Bad | `bathroom_tg` | Bad – tilstandsgrad | tg | |
| | `bathroom_description` | Bad – beskrivelse | text | |
| | `bathroom_age` | Badets alder | number | år |
| | `floor_slope` | Fall mot sluk | choice | `yes` Ja, `no` Nei, `not_measured` Ikke målt |
| | `membrane_visible` | Membran synlig i sluk | choice | `yes` Ja, `no` Nei |
| | `moisture_floor` | Fuktmåling gulv | number | % |
| | `moisture_wall` | Fuktmåling vegg | number | % |
| | `bathroom_photo` | Bad – bilde | photo | |
| | `drain_photo` | Sluk – bilde | photo | |
| | `drill_measurements` | Hulltakingsmålinger | table | kolonner: `location` Sted (text), `value` Verdi (number, %), `note` Kommentar (text) |
| Kjøkken | `kitchen_tg` | Kjøkken – tilstandsgrad | tg | |
| | `kitchen_description` | Kjøkken – beskrivelse | text | |
| | `kitchen_ventilation` | Avtrekk | choice | `external` Ut av boligen, `carbon_filter` Kullfilter, `none` Ingen |
| | `leak_stopper` | Lekkasjestopper | choice | `yes` Ja, `no` Nei |
| | `kitchen_photo` | Kjøkken – bilde | photo | |
| Teknisk | `water_heater_tg` | Varmtvannsbereder – tilstandsgrad | tg | |
| | `water_heater_age` | Berederens alder | number | år |
| | `water_heater_location` | Berederens plassering | choice | `bathroom` Bad, `laundry` Vaskerom, `storage` Bod, `other` Annet |
| | `water_heater_photo` | Bereder – bilde | photo | |
| | `electrical_tg` | Elektrisk anlegg – tilstandsgrad | tg | |
| | `electrical_description` | Elektrisk anlegg – beskrivelse | text | |
| | `fuse_box_photo` | Sikringsskap – bilde | photo | |
| | `compliance_declaration` | Samsvarserklæring foreligger | choice | `yes` Ja, `no` Nei, `unknown` Ukjent |
| Oppsummering | `summary` | Samlet kommentar | text | |
| | `rooms_inspected` | Antall rom befart | number | |
| | `recommendation_tg` | Samlet inntrykk – tilstandsgrad | tg | |

Fordeling: tekst 7, TG 7, valg 9, tall 9, tabell 1, bilde 7. Et felt regnes som utfylt når det har en verdi (tekst ikke tom, tabell minst én rad, bilde minst ett).

## Skjermer
iPad (liggende, 1194 × 834) og PC. Én skjerm: gruppene under hverandre med overskrift, teller «N av 40 felt utfylt» fast øverst. Hovedhandling: fylle ut feltene. Ingen lagre-knapp (svarene lagres ikke i denne oppgaven). Antall trykk: TG og valg er ett trykk, bilde to (knapp + kamera). Ingen skisse fra ui-designer: skjemaet er et prøveverktøy, og kravene over (trykkflater, knapper i stedet for nedtrekk, TG med tekst) dekker designprinsippene 6, 8 og 11.

## Regler
Ingen i denne oppgaven. Prøve E får to regler som data med testsaker: alder mot levetid (`water_heater_age`) og målegrense (`moisture_floor`). Skjemaet har feltene klare.

## Akseptkriterier
- [ ] `trialForm` har nøyaktig 40 felt med unike `key`, fordelt som i tabellen, og alle seks typene finnes (enhetstest).
- [ ] Innlogget ansatt åpner `/prove/testskjema` fra lenken på arbeidskøen og ser alle 40 feltene med norske etiketter.
- [ ] Uinnlogget sendes til `/logg-inn`.
- [ ] Alle 40 felt kan fylles ut i e2e, i både `pc` og `ipad`: tekst skrives, TG og valg trykkes, tall skrives (komma godtas), én tabellrad legges til og én slettes, bilde velges med `setInputFiles` (oppdiktet liten PNG i `e2e/fixtures/`). Telleren viser «40 av 40 felt utfylt» til slutt.
- [ ] Ingen nedtrekksmenyer. TG-knapper og valgknapper er minst 44 pt høye (e2e måler `boundingBox` på én TG-knapp i `ipad`).
- [ ] `/manifest.webmanifest` svarer 200 med `display: "standalone"`, `start_url: "/arbeidskoe"` og navn fra `brand` (e2e med `request`). `/apple-icon` og `/icon` svarer 200 med `image/png`.
- [ ] `<link rel="manifest">` og `apple-mobile-web-app-capable` finnes i HTML-en på innloggingssiden (e2e).
- [ ] `pnpm lint` (modulgrense og produktnavn), `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): ikke relevant, ingen data lagres og ingen spørring tar `organizationId`. Står i PR-en.
- [x] Virker på iPad-størrelse (e2e): dekket av `ipad`-prosjektet over.
- [ ] Planen for prøvene A–F og kriteriene (under) er klare til å legges fram for Ståle i PR-en.

## Testplan (utkast fra prosjektleder, testskriver fyller ut)
- `src/modules/offline-trial/trial-form.test.ts`: 40 felt, unike nøkler, typefordeling, alle valg har kode og etikett, tabellen har tre kolonner.
- `src/modules/offline-trial/answers.test.ts`: `countAnswered(form, answers)` teller riktig for tom tekst, tom tabell, tomt bildefelt, tall `0` (regnes som utfylt).
- `e2e/fase-1-testskjema.spec.ts`: krever innlogging; fyller ut alle 40 felt og ser «40 av 40 felt utfylt»; måler høyden på én TG-knapp i `ipad`; manifest og ikoner svarer; HTML har manifest-lenke.
- Oppdiktet bilde: `e2e/fixtures/test-bilde.png` (ensfarget, under 5 kB).

## Plan for prøvene A–F (legges fram for Ståle)

Forutsetninger for alle prøver: to iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm), samme testskjema, bare oppdiktede data (ingen ekte adresser eller navn). Hver prøve kjøres likt for hver kandidat, og resultatet føres i en tabell i ADR-en: bestått / delvis / ikke bestått, med det som gikk galt.

| Prøve | Nivå | Slik gjøres den | Bestått når |
|---|---|---|---|
| **A – én takstmann uten nett** | må | Flymodus på. 30 minutter: alle 40 felt fylles ut, 200 bilder tas i bildefeltene. Appen lukkes helt og åpnes igjen. iPaden startes på nytt. Flymodus av. | Alle svar og alle 200 bilder er på serveren, ingenting mangler eller er dobbelt. Kjøres tre ganger. |
| **B – to i samme skjema** | bør | Begge iPader med nett, samme skjema. Begge skriver i `roof_description` samtidig. Begge setter `roof_tg` og `moisture_floor` samtidig med ulik verdi. | Teksten flettes (begge bidrag er med). TG og tall: siste endring vinner, og den andre iPaden viser varsel om at verdien ble endret av en annen. |
| **C – lagring i Safari** | må | Mål hvor mye plass appen får. Fyll ut og ta bilder uten nett, la iPaden ligge i 7 dager uten bruk, åpne igjen. Fyll opp lagringen med bilder til den er full. | Data overlever omstart og 7 dager. Når plassen er brukt opp, får takstmannen en tydelig melding før noe går tapt. |
| **D – bilder** | må | Ta bilder liggende og stående, i HEIC. Last opp med appen åpen, bryt nettet midt i, slå på igjen. Sammenlign fingeravtrykk (hash) på iPad og server. | Riktig rotering, JPEG på serveren, opplasting fortsetter der den slapp, samme fingeravtrykk. |
| **E – regler uten nett** | må | To regler som data: bereder eldre enn levetid gir forslag om TG2; fuktmåling over grense gir advarsel. Kjøres uten nett på iPaden og på serveren med samme testsaker. | Samme svar begge steder for alle testsakene. |
| **F – innlogging som har gått ut** | må | Logg inn, sett innloggingen som utløpt (kort levetid i prøven), flymodus på, fyll ut og ta bilder. Flymodus av. | Skjemaet kan åpnes og fullføres uten nett. Når nettet kommer, bes takstmannen logge inn på nytt, og alt synkes etterpå uten tap. |

Rekkefølge: A og C først (de avgjør om nettleser på iPad holder i det hele tatt), så D, E og F, og B til slutt. Prøve A på to iPader flere ganger er kravet for «ferdig» i fase 1.

## Kriterier for å sammenligne kandidatene

Kandidater: **PowerSync**, **ElectricSQL** og **egenbygd** (lokal database i nettleseren og en endringskø som sendes når nettet kommer). Tekstfletting med Yjs eller tilsvarende prøves med den kandidaten som består A.

| Kriterium | Slik måles det | Vekt |
|---|---|---|
| **Virker prøvene** | Antall prøver bestått (A–F). A og C må bestås, ellers er kandidaten ute. | Port, deretter 40 % |
| **Arbeid** | Dager brukt på å få kandidaten gjennom A–F, og hvor mye kode vi selv må eie (linjer og hvor vanskelig den er å forstå). Skjemaet er likt, så forskjellen er synklaget. | 20 % |
| **Drift i EU/EØS** | Kan alt kjøre i EU/EØS (egen server eller leverandørens), finnes databehandleravtale, og hva sendes til leverandøren. | 15 % |
| **Pris** | Kostnad per måned for 10 takstmenn og 2 000 rapporter i året, pluss det det koster om vi må bytte senere. | 10 % |
| **Modenhet** | Alder, utgivelser siste år, åpen kode, kjente brukere i produksjon, hvor godt Safari på iPad er støttet, og om Postgres og Drizzle støttes direkte. | 15 % |

Hvert kriterium får 1–3 poeng med begrunnelse. Summen avgjør ikke alene: ADR-en skal også si hva som ikke virket, og hva som ville gjøre at vi bytter. Ståle godkjenner ADR-en innen demoen i kjelleren.

## Roller
- **utvikler**: to biter som ikke henger sammen, kan bygges i parallell eller etter hverandre:
  - Bit 1: `src/modules/offline-trial/` (skjema som data, `countAnswered`, visning), siden `/prove/testskjema` og lenken på arbeidskøen.
  - Bit 2: `src/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx`, `appleWebApp` i layout, `brand.color`.
- **testskriver**: testplanen over, i parallell med utvikleren. Bruker nøklene og etikettene i tabellen, så testene kan skrives før skjermen finnes.
- **test-leder**: godkjenner til slutt, ser at e2e faktisk kjører i `ipad` og at telleren når 40.
- **prosjektleder**: oppgavekort, PR, tilstand, plan, ordliste.

Ikke med: arkitekt (modulnavn og svarform er avgjort her; arkitekten kommer inn i oppgave 4 og ADR-en), ux-ansvarlig og ui-designer (prøveverktøy, kravene står i «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst, bare feltnavn), sikkerhet-personvern (ingen lagring, ingen ny tilgang, kamera er alt tillatt i `Permissions-Policy`), forenkler (omfanget er minst mulig, se «ikke med»).

## Åpne spørsmål
- Til Ståle (lagt i `docs/09-apne-sporsmal.md` nr. 6): hvor skal prøveappen kjøre slik at iPadene når den? Lagring uten nett i Safari krever https. Alternativ 1: Ståles Mac på samme wifi med et lokalt sertifikat (gratis, litt oppsett). Alternativ 2: en liten testserver i EU/EØS (koster litt per måned, virker overalt, også i kjelleren uten wifi). Trengs før oppgave 4 testes på ekte iPad.
- Ingen andre.
