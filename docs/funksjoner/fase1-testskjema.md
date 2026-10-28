# Funksjon: Testoppsett for prøven uten nett (testskjema og app på hjemskjermen)

- **Fase:** 1 – Prøve uten nett
- **Modul:** `src/modules/offline-trial` (ny, kastes etter fase 1 eller gjøres om til feltkomponenter i fase 2b)
- **Status:** klart for utvikler og testskriver (oppgavekort 28.10.2026, revidert samme dag etter forenkler og test-leder)
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

1. **Testskjemaet som data.** `src/modules/offline-trial/trial-form.ts` eksporterer `trialForm`: grupper med felt, hvert felt med `key` (fast, engelsk snake_case), `label` (norsk), `type` og eventuelle valg/kolonner. Typene følger `field_type` i domenemodellen: `text`, `tg`, `choice`, `number`, `table`, `photo`. (`tg` er ikke en egen felttype i den ekte malen, der TG settes på kontrollpunktet. I testskjemaet er det en felttype, fordi prøve B trenger et felt der «siste endring vinner».) Feltene står i tabellen under: 40 felt, 6 grupper. Etikettene er vanlige ord, ingen tekst fra NS 3600, IVIT eller SmartTakst.
2. **Svar som felles form.** `TrialAnswers = Record<fieldKey, TrialValue>` der `TrialValue` er `string` (tekst), `"TG0" | "TG1" | "TG2" | "TG3" | "TGIU"`, `string` (valgt kode), `number`, `TrialTableRow[]` (tabell) eller `TrialPhoto[]` (bilde: `{ id, name, sizeBytes }`). Kandidatene i oppgave 4 skal lagre og synke akkurat denne formen, så skjemaet må ikke vite hvor svarene bor, og formen inneholder bare det som kan lagres (ingen objekt-URL-er eller filobjekter). Modulen eksporterer også to rene funksjoner: `countAnswered(form, answers): number` og `parseTrialNumber(input: string): number | null` («12,5» → 12.5, «abc» → null = ikke utfylt, «0» → 0 = utfylt).
3. **Skjermen.** `src/modules/offline-trial/trial-form-view.tsx` (klientkomponent) tar `form`, `answers` og `onChange(fieldKey, value)`. Siden `src/app/(ansatt)/prove/testskjema/page.tsx` er tynn: krever innlogget ansatt (`requireActor`), holder svarene i minnet på siden i denne oppgaven, og viser telleren øverst med nøyaktig tekst «N av 40 felt utfylt». Lenke «Prøve uten nett: testskjema» på arbeidskøen, så den er lett å finne på iPaden.
   - Tekst: `<textarea rows={3}>` med `<label htmlFor>`.
   - TG: fem knapper på rad (`TG0`, `TG1`, `TG2`, `TG3`, `TGIU`) inne i `<fieldset><legend>etikett</legend>`. Valgt knapp har `aria-pressed="true"` og er tydelig markert med tekst og farge (aldri bare farge).
   - Valg: knapper på rad i `<fieldset><legend>`, `aria-pressed` som for TG. Ikke nedtrekksmeny (designprinsipp 6).
   - Tall: `input type="text" inputMode="decimal"` med `<label htmlFor>` og enhet etter feltet. Verdien går gjennom `parseTrialNumber`, så komma og punktum godtas.
   - Tabell: kolonner som definert. Knapp «Legg til rad». Hver celle har `aria-label` «Kolonne, rad N» (f.eks. «Sted, rad 1»), og hver rad har knappen «Slett rad N».
   - Bilde: `input type="file" accept="image/*" capture="environment" multiple` med `<label htmlFor>`, så Safari åpner kameraet direkte. Viser antall med fast tekst «1 bilde» / «2 bilder» og filnavnene. Ingen forhåndsvisning, ingen opplasting; bare `{ id, name, sizeBytes }` legges i svarene. (Vil utvikleren likevel vise forhåndsvisning, holdes den i visningen, aldri i `TrialAnswers`.)
   - Alle trykkflater minst 44 pt. Fungerer på PC og iPad-størrelse.
4. **App på hjemskjermen.** `src/app/manifest.ts` (Next.js metadata-rute): navn og kortnavn fra `brand`, `start_url: "/arbeidskoe"`, `display: "standalone"`, `theme_color`/`background_color` Byggcon-blå `#326CA1` (legges i `brand.ts` som `brand.color`), `lang: "nb"`, `icons` peker på `/apple-icon` (180 × 180). Ikonet lages av `src/app/apple-icon.tsx` med `ImageResponse` fra `next/og` (ingen ny avhengighet, ingen binærfil): blå flate med produktnavnets to første bokstaver i hvitt. Ingen egen `icon.tsx`: bare Safari på iPad bruker appen, og Safari henter ikonet fra `apple-icon`. `metadata.appleWebApp = { capable: true, title: brand.productName, statusBarStyle: "default" }` i `src/app/layout.tsx`. `scripts/session-start.sh` og `start.sh` trenger ingen endring.
5. **Id på enheten.** `src/shared/lib/uuid.ts` bytter `randomUUID` fra `node:crypto` til `globalThis.crypto.randomUUID()`, som virker både i Node 22 og i Safari 15.4+. Da kan `uuidv7` brukes i klientkomponenten for bilde-id. `uuid.test.ts` skal være grønn uendret.
6. **Plan for prøvene A–F og kriteriene** står i dette dokumentet (avsnittene under). Det er dette som legges fram for Ståle.
7. **Tester** (se testplan): enhetstester av `trialForm`, `countAnswered` og `parseTrialNumber`, og e2e i PC- og iPad-størrelse som fyller ut alle 40 feltene.
8. Kryss av punktet i `docs/07-utviklingsplan.md`. Øk patch-versjon i `package.json` (0.1.1 → 0.1.2). Ordlisten har allerede «prøve uten nett» → `offline-trial` og «testskjema» → `trial form` (`docs/05-domenemodell.md` avsnitt 8); det bekreftes i PR-en, ikke noe arbeid.

**Ikke med (bevisst utelatt):**
- Ingen lagring uten nett, ingen service worker, ingen synk, ingen PowerSync/ElectricSQL/Yjs. Det er oppgave 4 og 5. Appen på hjemskjermen trenger nett i denne oppgaven, og det er greit.
- Ingen lagring på serveren. Svarene lever i minnet på siden og forsvinner når siden lastes på nytt. Hver kandidat i oppgave 4 legger til sin lagring bak `answers`/`onChange`.
- Ingen nye tabeller, ingen migreringer, ingen nye avhengigheter.
- Ingen forhåndsvisning av bilder i svarene, ingen opplasting, komprimering, rotering eller HEIC-til-JPEG (prøve D).
- Ingen autovoksende tekstområder og ingen grense på antall tabellrader (ingen prøve trenger det).
- Ingen egen `icon.tsx` (se pkt. 4).
- Ingen regler eller TG-logikk (prøve E). Skjemaet har bare tallfeltene prøve E trenger (byggeår, alder på bereder, fuktmåling).
- Ingen synkstatus eller nettindikator (eget punkt i fase 1).
- Ingen kobling til den ekte malmotoren, kontrollpunkter, oppdrag eller rapporter. Testskjemaet er ikke en systemmal.
- Ingen ny tilgangslogikk. Siden krever innlogging som alle sider under `(ansatt)`; alle roller får åpne den.
- Ingen Safari-test i e2e (Playwright bruker Chromium i iPad-størrelse). Safari på ekte iPad testes for hånd av Ståle i prøvene.
- Selve iPadene og hvor prøveappen kjører: Ståle (se åpne spørsmål).

## Avgjørelser i revisjonen 28.10.2026
Forenkler og test-leder ba om endringer før utvikler starter. Alle er tatt inn:
- Fra forenkler: `previewUrl` ut av `TrialPhoto` (kan ikke lagres eller synkes, oppgave 4 måtte ellers rive det ut), tekstområdet vokser ikke, ingen grense på 20 rader, ingen 56 pt-knapper (skjemaet har ingen hovedknapp), ordliste-punktet er alt gjort. Valgfritt punkt om `icon.tsx`: prosjektleder avgjør at den droppes. Begrunnelse: bare Safari på iPad bruker appen i fase 1, Safari bruker `apple-icon`, og én ikonrute er mindre å vedlikeholde. Manifestet peker på `/apple-icon`.
- Fra test-leder: tabelltesten gir én rad igjen (to lagt til, én slettet), ellers ville telleren stoppet på 39; faste tilgjengelige navn (`fieldset`/`legend`, `aria-pressed`, «Sted, rad 1», «Slett rad 1», «Legg til rad», «1 bilde», «N av 40 felt utfylt»); `parseTrialNumber` som ren funksjon; `uuid.ts` byttes til `globalThis.crypto.randomUUID()`; fixture heter `test-image.png`.
- Merknad til testskriver (fra forenkler): `capture="environment"` sammen med `multiple` gir ett bilde per kameraåpning i Safari på iPad. Det er riktig for prøve A (200 bilder tas ett og ett) og er ikke en feil. I e2e gis flere filer på én gang med `setInputFiles`; det er greit, Chromium bryr seg ikke om `capture`.
- Ingen av endringene kutter noe fra gjeldende fase eller Ståles beslutninger. Ingen spørsmål til Ståle kom ut av revisjonen.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (eget skjema i minnet) | ja |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja |

Siden bruker bare `requireActor` (innlogget), ikke `requireOrganizationAccess`, fordi ingen organisasjonsdata vises eller lagres. Ingen spørring tar `organizationId`, så tenant-isolasjon er ikke relevant og ingen `expectTenantIsolation` legges til. Begge deler skal stå med rene ord i PR-en. E2e sjekker at uinnlogget sendes til `/logg-inn`, og at admin finner lenken (admin stenges aldri ute).

## Data
Ingen nye eller endrede tabeller. Faste koder i testskjemaet (`key`) er prefiks-frie engelske navn i snake_case som i tabellen under; de holdes uendret gjennom hele fase 1, slik at kandidatene kan sammenlignes på samme data. Bildene har id laget på enheten (`uuidv7` fra `src/shared/lib/uuid.ts`, etter byttet i omfang pkt. 5).

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

Fordeling: tekst 7, TG 7, valg 9, tall 9, tabell 1, bilde 7. Et felt regnes som utfylt når det har en verdi: tekst som ikke er tom eller bare mellomrom, TG eller valg satt, tall som er et tall (`0` teller, `null` teller ikke), tabell med minst én rad, bilde med minst ett bilde.

## Skjermer
iPad (liggende, 1194 × 834) og PC. Én skjerm: gruppene under hverandre med overskrift, teller «N av 40 felt utfylt» fast øverst. Hovedhandling: fylle ut feltene. Ingen lagre-knapp (svarene lagres ikke i denne oppgaven). Antall trykk: TG og valg er ett trykk, bilde to (knapp + kamera). Ingen skisse fra ui-designer: skjemaet er et prøveverktøy, og kravene over (trykkflater, knapper i stedet for nedtrekk, TG med tekst) dekker designprinsippene 6, 8 og 11.

## Regler
Ingen i denne oppgaven. Prøve E får to regler som data med testsaker: alder mot levetid (`water_heater_age`) og målegrense (`moisture_floor`). Skjemaet har feltene klare.

## Akseptkriterier
- [ ] `trialForm` har nøyaktig 40 felt med unike `key` i engelsk snake_case, fordelt som i tabellen, og alle seks typene finnes (enhetstest).
- [ ] `countAnswered` og `parseTrialNumber` oppfører seg som beskrevet under «Feltene» og omfang pkt. 2 (enhetstest).
- [ ] `uuidv7` virker uten `node:crypto`, og `uuid.test.ts` er grønn uendret.
- [ ] Innlogget ansatt (admin i e2e) åpner `/prove/testskjema` fra lenken «Prøve uten nett: testskjema» på arbeidskøen og ser alle seks gruppene og alle 40 etikettene, og telleren «0 av 40 felt utfylt».
- [ ] Uinnlogget sendes til `/logg-inn`.
- [ ] Alle 40 felt kan fylles ut i e2e, i både `pc` og `ipad`: tekst skrives, TG og valg trykkes (bare én knapp i gruppen har `aria-pressed="true"`), tall skrives med komma, to tabellrader legges til og én slettes (én står igjen), bilde velges med `setInputFiles` (`e2e/fixtures/test-image.png`, ensfarget, under 5 kB) i alle sju bildefelt og feltet viser «1 bilde». Telleren viser «40 av 40 felt utfylt» til slutt.
- [ ] Ingen nedtrekksmenyer (`select` har 0 treff). Tallfelt har `inputMode="decimal"`. TG-knapper er minst 44 px høye (e2e måler `boundingBox` på én TG-knapp i `ipad`).
- [ ] `/manifest.webmanifest` svarer 200 med `display: "standalone"`, `start_url: "/arbeidskoe"` og navn fra `brand` (e2e med `request`). `/apple-icon` svarer 200 med `image/png`.
- [ ] `<link rel="manifest">` og `apple-mobile-web-app-capable` finnes i HTML-en på innloggingssiden (e2e, uinnlogget).
- [ ] `pnpm lint` (modulgrense og produktnavn), `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne, og `ipad`-prosjektet har kjørt alle e2e-testene.
- [ ] Bruker i annen organisasjon får ikke tilgang (test): ikke relevant, ingen data lagres og ingen spørring tar `organizationId`. Står i PR-en sammen med at siden bare bruker `requireActor`.
- [x] Virker på iPad-størrelse (e2e): dekket av `ipad`-prosjektet over.
- [ ] Planen for prøvene A–F og kriteriene (under) er klare til å legges fram for Ståle i PR-en.

## Testplan (fra test-leder, navnene er bindende for testskriver)

Enhetstester (Vitest, rene, ingen database):
- `src/modules/offline-trial/trial-form.test.ts`
  - «har nøyaktig 40 felt med unike nøkler»
  - «har fordelingen tekst 7, TG 7, valg 9, tall 9, tabell 1, bilde 7»
  - «alle seks felttypene finnes»
  - «alle valgfelt har minst to valg med kode og norsk etikett»
  - «tabellen drill_measurements har kolonnene location, value, note»
  - «nøklene er engelske snake_case» (regex, vokter regel 6 om faste koder)
- `src/modules/offline-trial/answers.test.ts`
  - «countAnswered gir 0 for tomme svar»
  - «tom tekst og tekst med bare mellomrom teller ikke»
  - «tallet 0 teller som utfylt, null teller ikke»
  - «tom tabell teller ikke, én rad teller»
  - «tomt bildefelt teller ikke, ett bilde teller»
  - «alle 40 utfylt gir 40»
  - «parseTrialNumber godtar komma og punktum, avviser tekst»
- `src/app/manifest.test.ts` (valgfri, billig): «manifestet har standalone, start_url /arbeidskoe, navn fra brand og lang nb».

Integrasjonstester mot testdatabasen: ingen nye (ingen nye spørringer eller tabeller). Tenant-isolasjon: ikke relevant, står i PR-en.

Regeltester: ingen (regler kommer i prøve E, oppgave 4/5).

E2e (Playwright, kjører i både `pc` og `ipad`): `e2e/fase-1-testskjema.spec.ts`
- «uinnlogget sendes til innlogging fra /prove/testskjema» (tilgang)
- «admin finner lenken Prøve uten nett: testskjema på arbeidskøen og ser 0 av 40 felt utfylt» (admin stenges aldri ute)
- «alle seks gruppene og alle 40 etiketter vises» (løkke over `trialForm` importert fra modulen, så listen holdes i synk)
- «ingen nedtrekksmenyer» (`locator("select")` har 0 treff)
- «TG-knapp er minst 44 px høy» (`boundingBox` i `ipad`; `test.skip` i `pc`)
- «tallfelt har inputMode decimal»
- «valg er ett trykk og bare ett valg er trykket» (`aria-pressed` bytter mellom Ja og Nei)
- «alle 40 felt fylles ut og telleren viser 40 av 40» (tekst, TG, valg, tall med komma, to tabellrader lagt til og én slettet, bilde via `setInputFiles` med `e2e/fixtures/test-image.png` i alle sju bildefelt; bildefelt viser «1 bilde»)
- «manifest.webmanifest svarer 200 med standalone, start_url /arbeidskoe og navn fra brand» (`request`)
- «/apple-icon svarer 200 med image/png» (`request`)
- «innloggingssiden har link rel=manifest og apple-mobile-web-app-capable» (uinnlogget)

Slik finner e2e feltene: tekst, tall og bilde med `getByLabel(etikett)`; TG og valg med `getByRole("group", { name: etikett })` og deretter `getByRole("button", { name })` inne i gruppen; tabellceller med `getByLabel("Sted, rad 1")` osv.; knappene «Legg til rad» og «Slett rad 1».

Uten nett: ikke i denne oppgaven (bevisst, oppgave 4 og 5).

Test-leder til slutt: kjører `pnpm lint`, `typecheck`, `test` og `test:e2e`, sjekker at `ipad`-prosjektet faktisk kjørte alle testene og at utfyllingstesten når 40. Godkjenner ikke hvis innloggingstesten mangler eller PR-en ikke sier hvorfor tenant-isolasjon ikke gjelder.

## Plan for prøvene A–F (legges fram for Ståle)

Forutsetninger for alle prøver: to iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm), samme testskjema, bare oppdiktede data (ingen ekte adresser eller navn). Hver prøve kjøres likt for hver kandidat, og resultatet føres i en tabell i ADR-en: bestått / delvis / ikke bestått, med det som gikk galt. Bildefeltet åpner kameraet direkte og gir ett bilde per åpning; det er med vilje (slik tas bilder på befaring) og ikke en feil.

| Prøve | Nivå | Slik gjøres den | Bestått når |
|---|---|---|---|
| **A – én takstmann uten nett** | må | Flymodus på. 30 minutter: alle 40 felt fylles ut, 200 bilder tas i bildefeltene, ett og ett. Appen lukkes helt og åpnes igjen. iPaden startes på nytt. Flymodus av. | Alle svar og alle 200 bilder er på serveren, ingenting mangler eller er dobbelt. Kjøres tre ganger. |
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
  - Bit 1: `src/modules/offline-trial/` (skjema som data, `countAnswered`, `parseTrialNumber`, visning), siden `/prove/testskjema`, lenken på arbeidskøen og byttet i `src/shared/lib/uuid.ts`.
  - Bit 2: `src/app/manifest.ts`, `apple-icon.tsx`, `appleWebApp` i layout, `brand.color`.
- **testskriver**: testplanen over, i parallell med utvikleren. Bruker nøklene, etikettene og de tilgjengelige navnene i dette kortet, så testene kan skrives før skjermen finnes.
- **test-leder**: godkjenner til slutt, ser at e2e faktisk kjører i `ipad` og at telleren når 40.
- **prosjektleder**: oppgavekort, PR, tilstand, plan.

Ikke med: arkitekt (modulnavn og svarform er avgjort her; arkitekten kommer inn i oppgave 4 og ADR-en), ux-ansvarlig og ui-designer (prøveverktøy, kravene står i «Skjermer»), ki-ansvarlig (ingen KI), fagansvarlig (ingen fagtekst, bare feltnavn), sikkerhet-personvern (ingen lagring, ingen ny tilgang, kamera er alt tillatt i `Permissions-Policy`). Forenkler og test-leder har vurdert kortet (se «Avgjørelser i revisjonen»).

## Åpne spørsmål
- Til Ståle (lagt i `docs/09-apne-sporsmal.md` nr. 6): hvor skal prøveappen kjøre slik at iPadene når den? Lagring uten nett i Safari krever https. Alternativ 1: Ståles Mac på samme wifi med et lokalt sertifikat (gratis, litt oppsett). Alternativ 2: en liten testserver i EU/EØS (koster litt per måned, virker overalt, også i kjelleren uten wifi). Trengs før oppgave 4 testes på ekte iPad.
- Ingen andre.
