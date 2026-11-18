# Testplan: PDF-motor (ADR 0016) og PDF-utkast av badet i Byggcons profil

- **Oppgavekort:** `docs/funksjoner/fase2a-pdf-badet.md`
- **Dato:** 18.11.2026 (test-leder, før bygging)
- **Branch:** `pdf-motor-badet`
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** testene låser at PDF-en viser hvert avvik med TG, årsak, konsekvens, tiltak og kostnad likt hver gang, at TGIU har alle opplysningene, at ingen interne koder, tomme sider eller overskrifter alene nederst slipper gjennom, og at utkastet viser det som mangler.
  - **De ansatte:** e2e viser ett trykk fra badet til PDF i ny fane, også rett etter at et felt er skrevet, på PC og i iPad-størrelse.
  - **KI i bunnen:** testene viser at `ReportPdfData` bygges av en ren funksjon med faste koder, at ingen KI-modul brukes i gjengivelsen, og at ventende KI-forslag aldri kommer med.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Alle tester som avhenger av tid sender inn fast `generatedAt` (`TEST_NOW` = 03.11.2026 kl. 10:00 UTC). Alle data er oppdiktede: adresser som «Prøvevegen 1», selskap «Testselskap takst AS» med `nextFakeOrgNumber()`, ingen ekte navn. Badet bygges med `createBathroomFixture`/`startedBathroom` i `tests/report-fixtures.ts`. Bilder er oppdiktede byte fra `tests/jpeg-bytes.ts` (og en ny PNG-bygger ved siden av).

Ingen nye fagregler. «Regeltestene» er de rene funksjonene (`buildReportPdfData`, kostnadsteksten, TG-forklaringen, bildesjekken, oppsettet) som tabeller med testsaker (`it.each`), og T1–T16 fra fagansvarlig som data. Uten nett-e2e gjelder bare at knappen er sperret (PDF på iPad uten nett er 2b).

## Avtale om signaturer (utviklere og testskriver)

Fra kortet, Omfang 2–6. Avvik føres i kortet.

- `src/core/pdf/index.ts`: `renderReportPdf(data: ReportPdfData, profile: PdfProfile, options: { draft: boolean; generatedAt: Date; appBaseUrl?: string }): Promise<RenderedPdf>`, `RenderedPdf = { bytes: Uint8Array; pageCount: number; imageCount: number }`. Eksporterer også typene `ReportPdfData`, `PdfProfile`, `PDF_PROFILES`, `DEFAULT_PDF_PROFILE_CODE = "byggcon_standard"`, `PDF_SECTION_CODES = ["cover", "toc", "tg_explanation", "room", "missing"]`.
- Ren oppsettsfunksjon (navn fritt, for eksempel `layoutSections(data, profile, { draft })`) som gir listen over deler og overskrifter som faktisk skal med. Testes uten motoren.
- Bildesjekken (navn fritt, for eksempel `validatePdfImage(bytes)` og `validateMarkup(markup, size)`) kaster egne feil med fast kode, ikke motorfeil.
- Felles JPEG-tillatt-liste i `src/core/files` (flyttet fra `src/modules/offline-trial/server/photo-storage.ts`).
- `src/core/reports/pdf-data.ts`: `getReportPdfData(actor, organizationId, reportId): Promise<ReportPdfData>`.
- `src/core/reports/pdf-data-build.ts`: `buildReportPdfData(rows): ReportPdfData` (ren).
- `src/core/reports/tg-explanation.ts`: `TG_EXPLANATION` (kodedata med `status: "draft"`).
- Rute: `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/pdf/route.ts` eller tilsvarende (bare `GET`). Navnet følger det som bygges; testene importerer `GET`.
- Vern mot overbelastning som egen liten enhet (for eksempel `src/core/pdf/limiter.ts` eller i ruten) med injiserbar klokke, slik at 429 og tidsavbrudd kan testes uten å vente.
- Hendelsen `report.draft_pdf_created` i `src/core/events/types.ts` med feltene `reportId`, `profileCode`, `pageCount`, `imageCount`, `durationMs`.
- **Testhjelper `tests/pdf-inspect.ts`** (testskriver): `inspectPdf(bytes) → { info: { title, author, producer, creator, creationDate, modDate, id }, lang, tagged, pages: [{ width, height, text, lines, links, images, vectorPaths }], fonts }`. Leseren velges etter ADR-en; trengs en ny utviklingsavhengighet for å lese PDF (for eksempel en ren JS-leser), begrunnes den i PR-en (regel 9). Hjelperen har egen selvtest med en kjent liten PDF.
- **Testhjelper `expectNoInternalCodes(text)`** i `tests/pdf-inspect.ts` med mønsterlisten fra kortet (Regler). Egen selvtest: hvert mønster fanger et eksempel, og vanlig norsk tekst («TG2», «20 000–100 000 kr», «Våtrom») slipper gjennom.

## 1. ADR 0016 (gjennomgang, ikke automatisk test utover 1.1)

Test-leder sjekker ved godkjenning at ADR-en har: tabell med minst tre motorer mot hvert krav i Omfang 1; målingene fra `.next/standalone` på linux-x64 (orddeling bokmål i smal kolonne, like byte to ganger, tid og minne for badet); valgt motor med lisens og begrunnelse etter regel 9; hvordan motor og skrifter kommer med i zip-pakken; tak for samtidige PDF-er og tidsgrense; hva valget betyr for iPad uten nett i 2b; at `ReportPdfData` bygges av en ren funksjon.

1.1 **`tests/deploy-workflow.test.ts`** (utvides): `deploy-azure.yml` sjekker at motoren og skriftene finnes i zip-bygget (filene som ADR-en peker på), og `next.config` har `outputFileTracingIncludes`/`serverExternalPackages` for motoren hvis ADR-en krever det. `tests/start-script.test.ts` er grønn hvis `start.sh` endres (bash 3.2).

## 2. Grenser og statiske sjekker

### 2.1 Lint-regel, `eslint-rules/module-boundaries.test.ts` (utvides)
1. Fil i `src/core/pdf` som importerer `@/core/ai`, `@/core/reports`, `@/core/access`, `@/core/files` eller `@/db` → feil med ny melding (egen `messageId`, samme mønster som `reportsLogicLeaf`).
2. Fil i `src/core/pdf` som importerer `@/shared/...` eller egen mappe → ok.
3. `src/core/reports/pdf-data*.ts` med `import type { ReportPdfData } from "@/core/pdf"` → ok; vanlig verdiimport fra `@/core/pdf` i `src/core/reports` → feil.
4. Modul i `src/modules/*` som importerer `@/core/pdf` → følger dagens regler (kjerne er lov).

### 2.2 Statisk test, `src/core/pdf/static-checks.test.ts` (ny)
1. **Motorpakken importeres i én fil:** søk i hele `src/` etter pakkenavnet; nøyaktig én treff, i `src/core/pdf`.
2. **Ingen KI:** ingen fil i `src/core/pdf` nevner `core/ai`, `ai_usage_log` eller KI-porten.
3. **Ingen klokke eller tilfeldighet:** ingen `Date.now(`, `new Date()` uten argument, `Math.random`, `crypto.randomUUID`, `performance.now` i `src/core/pdf` (unntatt måling av millisekunder i ruten, som ligger utenfor).
4. **Ingen nett eller filer utenfor fast mappe:** ingen `fetch(`, `http`, `https`, `net` i `src/core/pdf`; fillesing bare fra `public/fonts` og `public/brand` (leses inn før motoren og sendes som byte).
5. **Ikke en leverandør:** motoren står ikke i `INTEGRATION_PORTS` (`src/core/integrations`).
6. **Skrifter og logo fra repoet:** profilen peker på filer som finnes i `public/fonts` og `public/brand/byggcon-logo.png`; ingen `http`-adresse i profilene; skriftlisensen (OFL) ligger ved skriftene.
7. **Ingen modellnavn** (dekkes av `tests/no-model-names.test.ts`).

## 3. Rene funksjoner og testsaker (Vitest, uten database)

### 3.1 `buildReportPdfData`, `src/core/reports/pdf-data-build.test.ts` (ny, tabell T1–T16)
Rader inn (som fra databasen), `ReportPdfData` ut. Hver T har én rad i `it.each`; teksten sjekkes også i PDF-en i 4.3.
1. **T1** TG3, intervall `from_20000_to_100000` → TG 3 og kostnadsteksten «20 000–100 000 kr» (hardt mellomrom, U+00A0).
2. **T2** `under_20000` og `over_500000` → «Under 20 000 kr», «Over 500 000 kr».
3. **T3** eget beløp 40 000 og 37 500 → «ca. 40 000 kr», «ca. 37 500 kr» (ikke avrundet av PDF-delen).
4. **T4** TG3 uten kostnad → ingen kostnadstekst; `missing`-markering for kostnad (vises bare i utkast).
5. **T5** TG2 med årsak, konsekvens og to tiltak → alle med, tiltak i lagret rekkefølge (rekkefølgen i radene stokkes i inndata, `sort_order` styrer).
6. **T6** punkt med TG2- og TG3-avvik → punktets TG 3 (fra `computeCheckpointTg`).
7. **T7** bare HMS-avvik → ingen TG på avviket og punktet; konsekvens og tiltak med.
8. **T8** `wet_room.adjacent` med TGIU og eier nektet hulltaking → TGIU og alle sju opplysningene; ingen TG2.
9. **T9** TGIU på annet punkt → hva/hvorfor, risiko, hva som må til; ingen fuktkontroll- eller eierlinjer.
10. **T10** TG0 direkte på `wet_room.adjacent` → TG 0, ingen avvik.
11. **T11** TG1 med beskrivelse uten avvik → TG 1 og beskrivelsen, tom avviksliste.
12. **T12** beskrivelse uten TG → `tg: null` (vises «Ikke satt» i utkast); punkt helt uten innhold → bare i `missing`.
13. **T13** avvikstekst med `{årstall}` uten verdi → «[årstall mangler]», ingen `{` eller `}`.
14. **T14** åpent regelforslag og ventende KI-forslag med merketekst → merketeksten finnes ikke noe sted i `JSON.stringify(data)`.
15. **T15** mykt slettet avvik og TGIU i radene → ikke med, og punktets TG regnes uten dem.
16. **T16** hele `JSON.stringify` av teksten (ikke kodene) → ingen «NS 3600», ingen «§» i avviksdelen, ingen «antas»/«trolig».
17. **Årsakskriteriet:** etiketten fra `CAUSE_CRITERION_LABELS` står sammen med årsaksteksten; «Annet» alene vises ikke (tabell over alle kriteriene, så et nytt kriterium uten rad gjør testen rød).
18. **`cost_type = none`** → ingen kostnadslinje; `cost_text` med i tillegg når den finnes; kostnad på TG2 med når satt.
19. **Etiketter fra låst malversjon:** rader med etikett fra låst versjon og en nyere/arkivert etikett → den låste brukes.
20. **Persondata bare i `cover`:** adresse og matrikkel finnes bare under `cover`; ingen eier-, bestiller-, megler- eller ansattnavn noe sted.
21. **Aldri med:** felt fra `claims`, `reasons`, `TG_LABEL_SOURCE`, regelens kilde, overstyringsgrunn, `text_source` (nøkkelsøk i hele objektet, og merketekster lagt i disse feltene i inndata finnes ikke i utdata).
22. **Selskap:** selskap med navn og org.nr. → i `footer`; `company_id` mangler eller `org_number` tom → `footer` sier «Juridisk selskap mangler på oppdraget»; `brand_name` (merketekst) står aldri i `footer`.
23. **Ren:** samme rader to ganger → `toEqual`; inndata er uendret etterpå (`structuredClone` før og etter).

### 3.2 Kostnadsteksten (utvider `src/core/reports/logic/cost.test.ts` om nødvendig)
Tabell: 0, 10 000, 1 234 567, alle intervallkoder og manglende verdi. Tusenskille er U+00A0. PDF-delen formaterer aldri selv (statisk: `src/core/pdf` har ingen `toLocaleString`/`Intl.NumberFormat`).

### 3.3 TG-forklaringen, `src/core/reports/tg-explanation.test.ts` (ny)
1. Har TG0, TG1, TG2, TG3 og TGIU i den rekkefølgen, pluss én setning om HMS uten TG.
2. TG0-teksten inneholder «normalt»; TG3 nevner kostnadsanslag; TGIU sier at rapporten forteller hva og hvorfor.
3. `status` er «utkast, ikke godkjent av fagrådet» i dataene, og merket står ikke i teksten som går til PDF-en.
4. Teksten er med i gjetteord- og kopitesten (eksisterende test utvides til å lese filen): ingen «antas», «trolig», «NS 3600», «§».
5. Etiketten er «TGIU», aldri «IU» alene.

### 3.4 Bildesjekken, `src/core/pdf/images.test.ts` (ny)
1. JPEG og PNG kjent på innholdet godtas; GIF, WebP, SVG, HTML med `.jpg`-navn og tomme byte avvises med fast kode.
2. **JPEG med GPS i EXIF** (`APP1_EXIF`), **JPEG med XMP** (`APP1_XMP`), **IPTC** (`APP13`), **kommentarfelt** (COM) avvises før motoren.
3. **PNG med `eXIf`-, `iTXt`/`tEXt`-chunk med XMP** avvises.
4. Ren visningskopi (`cleanDisplayCopy`) godtas.
5. Tillatt-listen for JPEG er den samme konstanten i `src/core/files` som `offline-trial` bruker (statisk: ingen kopi igjen i `photo-storage.ts`); eksisterende `offline-trial`-tester er grønne.
6. **Markering:** gyldige former (koordinater 0–1 eller innenfor bildets mål, kjent type) godtas; negative, større enn bildet, `NaN`, `Infinity`, ukjent type, streng i stedet for tall, og SVG- eller HTML-tekst avvises. Fargen kommer fra profilen, ikke fra markeringen.
7. Største mål i punkter: et bilde 8000×6000 skaleres ned til feltet, aldri utenfor siden.
8. Grenser: flere bilder enn grensen eller større samlet størrelse enn grensen → egen feil før motoren.

### 3.5 Oppsettet, `src/core/pdf/layout.test.ts` (ny, uten motor)
1. **Tomme deler:** rapport uten avvik, uten TGIU, uten bilder, og rom uten innhold → overskriftene for de delene er ikke i listen og ikke i innholdsfortegnelsen (`it.each` over kombinasjonene).
2. **`missing`** finnes med `draft: true` og bare når det finnes punkter uten innhold; aldri med `draft: false`.
3. **«Ikke satt»/«Mangler»** bare med `draft: true`; med `draft: false` står verken ordene eller tomme plasser.
4. **Lenker (F4):** med `draft: true` og `appBaseUrl` → hvert punkt `.../oppdrag/<id>/rom/<roomId>#punkt-<checkpointId>`, hvert avvik `#avvik-<deviationId>`; lenkene har bare id-er (regex: bare uuid, `/`, `#` og faste ord). Med `draft: false` eller tom `appBaseUrl` → ingen interne lenker.
5. **Rekkefølge** følger `profile` sin delrekkefølge; testprofilen med annen rekkefølge gir annen rekkefølge men samme tekst.

### 3.6 Profilene, `src/core/pdf/profiles.test.ts` (ny)
1. `byggcon_standard` finnes, er standard, `orientation: "portrait"`, har `version`.
2. Ingen profil har selskapsnavn, org.nr. eller fagtekst (søk etter «AS», sifre i org.nr.-format, «TG»-forklaring).
3. Profilkoder er unike og følger `^[a-z][a-z0-9_]*$`; låst liste over kjente koder (regel 6: en kode som forsvinner, gjør testen rød).
4. Testprofilen (liggende, andre farger) finnes bare i testene (statisk: ikke i `src/`).

### 3.7 Vern mot overbelastning, `src/core/pdf/limiter.test.ts` (ny, falsk klokke)
1. Én pågående per ansatt: andre kall for samme ansatt mens det første går → avvist (429-type).
2. To ansatte samtidig → begge slipper til opp til felles tak; ett over taket → avvist.
3. Plassen frigjøres etter suksess, etter feil og etter tidsavbrudd (ingen lekkasje: 20 feil på rad, så et vellykket kall).
4. Tidsavbrudd etter grensen fra ADR-en gir egen feilkode.

## 4. Gjengivelsen (Vitest mot motoren, uten database)

`src/core/pdf/render.test.ts` (ny). Inndata: en fast `ReportPdfData`-fixture for badet (`tests/pdf-fixtures.ts`, oppdiktet) med alle delene, pluss varianter. Lest med `inspectPdf`.

### 4.1 Struktur
1. **Alle deler:** forside («Tilstandsrapport», adresse, matrikkel, oppdragsnummer, befaringsdato, logo som bilde, selskapets navn), innholdsfortegnelse med sidetall som stemmer med siden overskriften står på, TG-forklaring, badet med romnavn og etasje, punkter, avvik med TG, årsak, konsekvens, tiltak og kostnad, TGIU.
2. **Bunntekst på hver side:** selskapsnavn og org.nr., oppdragsnummer og «side x av y» der x = sidenummer og y = `pageCount` (sjekkes for alle sider).
3. **Ingen navn på eier, bestiller eller megler** (merketekster i fixturen utenfor `cover`) og ingen bilder på forsiden utover logoen.
4. `RenderedPdf.pageCount` og `imageCount` stemmer med det `inspectPdf` finner.

### 4.2 Samme resultat
1. **Samme data og profil to ganger i samme prosess** → like byte (`sha256`). Hvis ADR-en begrunner at motoren ikke kan gi like byte: lik struktur (antall sider, sidestørrelse og retning per side, tekst per side i rekkefølge, antall bilder, skrifter), og `CreationDate`, `ModDate` og dokument-id er faste og avledet av `generatedAt`.
2. **Annen `TZ` og locale** (`vi.stubEnv("TZ", "Pacific/Auckland")`, `LANG=en_US.UTF-8`; eller egen barneprosess hvis motoren leser miljøet ved start) → samme resultat som 4.2.1.
3. **Annen `generatedAt`** → bare datofeltene endres (strukturen ellers lik).
4. **Snapshot:** tekst per side i rekkefølge for fixturen lagres som inline-snapshot (`toMatchInlineSnapshot` eller fil under `__snapshots__`), slik at endringer i utseendet synes i PR-en.
5. **Testprofilen** (liggende, andre farger) → annen sidestørrelse (bredde > høyde), andre farger i innholdsstrømmen, men samme tekst per del.

### 4.3 Innhold og T1–T16 i PDF-teksten
1. T1–T16 kjøres igjen som `it.each`, nå mot teksten i PDF-en (samme forventninger som 3.1, gjennom motoren).
2. **Ingen interne koder:** `expectNoInternalCodes` på all tekst fra alle sider, for fixturen og alle variantene.
3. **TG med både tekst og farge:** hvert TG-merke har teksten «TG2» o.l. (ikke bare farge).
4. **Orddeling:** et langt bokmålsord (for eksempel «Våtromsmembranoppbygningen» eller «fuktsikringskonstruksjonen») i en smal kolonne blir delt med bindestrek på en lovlig plass; kronebeløp («20 000–100 000 kr») og «TG 3»/«TG3» deles aldri over to linjer (sjekk på linjenivå). Kan motoren ikke dele i testmiljøet, skal testen feile, ikke hoppes over (målingen i ADR-en avgjør hvilken).
5. **Sideskift (F2):** ingen side slutter med en overskrift (siste tekstlinje på hver side er ikke en kjent overskrift); et avvikskort som får plass på én side står på én side; et kort lengre enn en side har overskriften sammen med minst to linjer; bildene står etter sitt avvik og før neste avvik.
6. **Tomme deler** gir riktig antall sider: rapport uten avvik, uten TGIU, uten bilder og med rom uten innhold → `pageCount` som forventet, overskriftene finnes ikke i teksten eller innholdsfortegnelsen.
7. **Utkast:** «UTKAST» på hver side med `draft: true`; ikke på noen side med `draft: false`. Siden «Ikke med i PDF-en» finnes bare med `draft: true` og lister punktene uten innhold med etiketter (F3).
8. **Lenker (F4)** som i 3.5.4, nå lest fra lenkeannotasjonene i PDF-en.

### 4.4 Bilder
1. To avvik med to og ett bilde → bildene i riktig rekkefølge rett under sitt avvik, med bildetekst.
2. **Markering som vektorlag:** for bilde med markering finnes vektorbaner (`vectorPaths`) over bildets område på samme side; bilde uten markering har ingen.
3. Bildet som går inn i PDF-en har ingen EXIF/XMP (les bildestrømmene i PDF-en og søk etter `Exif`, `GPS`, `<x:xmpmeta`).

### 4.5 Egenskaper
1. Tittel «UTKAST – Tilstandsrapport <oppdragsnummer>» (uten «UTKAST» når `draft: false`).
2. `lang = nb`; tagget (`MarkInfo/Marked true` og `StructTreeRoot`) hvis ADR-en sier motoren kan.
3. Forfatter, program og emne har ingen adresse, matrikkel eller ansattnavn (merketekster).
4. Skriftene er innebygd (ingen systemskrift).

### 4.6 Malinjeksjon og lukket motor
1. Rapporttekst (avvikstekst, årsak, bildetekst, adresse) med `<script>alert(1)</script>`, `<img src=http://127.0.0.1:9/x>`, `<img src=x onerror=…>`, `</style>`, `url(http://…)`, `@import`, `{{7*7}}`, Typst `#import "x"` og `#read("/etc/passwd")`, `file:///etc/passwd` → står som vanlig tekst i PDF-en; «49» står ikke der; innholdet i `/etc/passwd` står ikke der.
2. **Ingen nettverkskall:** en lokal HTTP-server på tilfeldig port teller forespørsler; etter gjengivelsen med adressene over er telleren 0. For Chromium: også telleren for blokkerte forespørsler i motoren.
3. **Ingen fillesing utenfor fast mappe:** spioner på `fs` (eller kjør med en rotmappe uten tilgang) og vis at ingen sti utenfor motormappen, `public/fonts` og `public/brand` leses.
4. **Temp-mappe:** antall filer i `os.tmpdir()` (og motorens egen mappe) er likt før og etter, også når gjengivelsen kaster og ved tidsavbrudd.

## 5. Rapportdataene mot databasen

`src/core/reports/pdf-data.test.ts` (ny).

### 5.1 Tenant-isolasjon (regel 2)
1. **`expectTenantIsolation`** for `getReportPdfData`: organisasjon B kaller med rapport-id-en til A → `AccessDeniedError`/404-feil, ingen rader.
2. **Filtrerer på `grant.organizationId`:** ansatt i A kaller med `organizationId` = B og rapport-id fra B → avvist av tilgangssjekken; kall med `organizationId` = A og rapport-id fra B → 404 (viser at spørringen ikke stoler på id-en alene).
3. **Hvert ledd:** rapport i A, men oppdrag, bygning, etasje, rom, avvik, tiltak, TGIU eller selskap med samme id-er lagt inn i B (direkte innsetting) → ingenting fra B kommer med (merketekst i B finnes ikke i resultatet).
4. **Selskap via oppdraget:** to selskaper i samme organisasjon; bunnteksten viser oppdragets selskap (navn og org.nr.), ikke det andre.
5. **To organisasjoner samtidig** (`Promise.all`, gjennom `getReportPdfData` og `renderReportPdf`): hver PDF har bare sitt eget merke.
6. **Ingen ny tabell:** `tests/tenant-tables.ts` er uendret, og `tests/tenant-isolation-all-tables.test.ts` er grønn.

### 5.2 Tilgang per rolle (`it.each`)
1. Takstmann, kontor, leder, admin → får data.
2. Bare admin-rollen, og admin med `access.inspectors_edit_all` av → får data (regel 11).
3. Takstmann og kontor med `access.inspectors_edit_all` av → får data (lesing som skjermen; samme utfall som `getRoomView` for samme ansatt, sjekket i samme test).
4. Hver rolle **med og uten reklamasjon** på oppdraget (`createClaim`) → samme svar (`toEqual`), og ingen tekst fra reklamasjonen i resultatet.
5. Sluttet ansatt og ansatt uten `organization.read` → avvist.
6. `getReportPdfData` kaller `requireOrganizationAccess` med `organization.read` (spion), og `requireUuid` på rapport-id.

### 5.3 Myk sletting og ugyldig id (regel 3)
1. Slettet rapport → 404. Erstattet (`superseded`) rapport → 404. Ugyldig id (`"abc"`, tom, sql-tegn) → 404. Fremmed id → samme feil og samme melding som slettet.
2. Slettet rom, kontrollpunkt, avvik, tiltak og TGIU → ikke med; punktets TG regnes uten slettede avvik (T15 mot databasen).
3. Slettet oppdrag eller selskap → rapporten 404 / bunnteksten «Juridisk selskap mangler på oppdraget».
4. Ingen rader endres: antall rader og `updated_at` i alle rapporttabellene er like før og etter.

### 5.4 Låst malversjon
1. Lag rapport, endre etiketten på et punkt i malen (ny versjon) og arkiver en annen → PDF-dataene bruker etikettene fra den låste versjonen.

## 6. Ruten og hendelsen

`src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/pdf/route.test.ts` (ny, mot databasen; navnet følger ruten).

### 6.1 Svar
1. `GET` som takstmann → 200, `application/pdf`, `Content-Disposition: inline; filename="utkast-<oppdragsnummer>.pdf"`, `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`; filnavnet har bare sifre og bindestrek (oppdragsnummer med merketegn i fixturen renses).
2. Bare `GET`: ruten eksporterer ikke `POST`, `PUT`, `PATCH`, `DELETE` (statisk), og Next gir 405.
3. **Ikke innlogget** → 401 eller videresending til innlogging, ingen PDF.
4. **Organisasjon B** med rapport-id-en til A → 404 med siden «Fant ikke rapporten» (HTML, norsk).
5. Ugyldig og slettet id → samme 404-side.
6. **Feil i motoren** (motoren mocket til å kaste med merketekst i meldingen) → 500 med siden «PDF-en kunne ikke lages. Prøv igjen.» og knappen «Prøv igjen»; HTML, ikke JSON.
7. **To samtidige** for samme ansatt (motoren holdt igjen med et løfte) → én 200 og én 429 med «En PDF lages allerede. Vent litt og prøv igjen.»
8. **Tidsavbrudd** (falsk klokke eller motor som aldri svarer) → feilsiden, plassen i vernet frigjøres.

### 6.2 Ingen lagring (Ståle 16.11.2026)
1. Antall rader i `files` er likt før og etter; ingen nye filer i lagringsmappen (`var/uploads` i test) eller temp-mappen; gjelder også 6.1.6 og 6.1.8.
2. Ingen rader i noen rapporttabell endres.

### 6.3 Hendelsen
1. Vellykket utkast → nøyaktig én `report.draft_pdf_created` med `organization_id` fra grant, `actor_id`, `report_id`, og bare feltene `reportId`, `profileCode`, `pageCount`, `imageCount`, `durationMs`.
2. Feil, 404 og 429 → ingen hendelse.
3. `src/core/events/types.test.ts`: ny type telles, og testen for forbudte felt dekker den (ingen adresse, tekst, navn).
4. Hendelsen vises ikke per person: statistikken bak `statistics.read` viser bare samlet antall (eksisterende test utvides hvis hendelsen tas med i statistikken).

### 6.4 Logging uten persondata
1. Feil fremkalt i motoren med merketekster i adresse, avvikstekst og bildetekst → loggen (spion på loggeren) har rapport-id, profilkode og feilkode/feilnavn; ingen av merketekstene, ingen `error.message`, ingen stack; svaret har heller ingen av dem.

### 6.5 Service worker
1. Statisk test på service workeren: PDF-ruten (`/pdf`) er unntatt fra mellomlagring (samme mønster som andre `no-store`-ruter).

## 7. E2e (Playwright, prosjektene `pc` og `ipad`)

`e2e/fase-2a-pdf-badet.spec.ts` (ny). Bruker `logIn` fra `e2e/helpers.ts` og testoppdraget fra `pnpm db:seed:testdata` eller en egen oppsettshjelper; alle data oppdiktede.

1. **Knappen på badet:** «Lag PDF (utkast)» i toppen ved siden av fremdriften; sekundær stil; minst 44 pt høy; har tekst og ikon.
2. **Knappen på oppdraget** der rapporten vises; finnes ikke når rapporten ikke finnes.
3. **Ett trykk → ny fane:** `context.waitForEvent("page")`; svaret har `content-type: application/pdf`; originalfanen står fortsatt på badet.
4. **«Lager PDF …»** vises og er sperret mens PDF-en lages (ruten holdt igjen med `page.route`), med `role="status"`/`aria-live` for skjermleser; borte når fanen er åpnet.
5. **Skriv og trykk straks:** skriv en merketekst i et beskrivelsesfelt og trykk knappen før autolagringen; knappen viser «Lagrer endringer …», og PDF-en i den nye fanen inneholder merketeksten (hent byte fra fanen og les teksten med `inspectPdf`). Viser også at fanen ikke blokkeres (åpnet i samme trykk).
6. **Uten nett** (`context.setOffline(true)`): knappen er sperret med «Krever nett. PDF-en kan lages når du er på nett igjen.»; synkstatusen synes. På nett igjen → knappen virker.
7. **Svar 500** (`page.route` gir 500 fra ruten): fanen viser «PDF-en kunne ikke lages. Prøv igjen.» og knappen «Prøv igjen», som laster ruten på nytt.
8. **iPad-størrelse:** knappen dekker ikke hovedknappene nederst (boksene overlapper ikke), og alt kan nås uten vannrett rulling.
9. **Axe** uten funn på badet og oppdraget med knappen synlig, og på feilsiden.
10. **Tid:** utkastet av badet svarer på under 5 sekunder i CI (måles i testen; `durationMs` i hendelsen er satt).
11. **Lenke fra utkastet (F4):** lenken til et punkt i PDF-en (lest med `inspectPdf`) åpnet i nettleseren lander på badet med ankeret `#punkt-<id>` synlig.

## 8. Tester som ikke skal røres

Publiseringssperren (`publisering-badet`) og KI i veien (`ki-i-veien`) har egne brancher. Denne branchen endrer ikke `src/core/reports/types.ts`, `room-view.ts`, `reports.ts` eller `write.ts` (sjekkes i gjennomgangen med `git diff --stat main`), og eksisterende tester for badet (`src/core/reports/*.test.ts`, `e2e/fase-2a-badet-pc.spec.ts`) er grønne uten endring, bortsett fra at ankrene `#punkt-`/`#avvik-` kan legges til på skjermen.

## 9. Godkjenning

Test-leder godkjenner ikke uten:
- 5.1 (tenant-isolasjon med `expectTenantIsolation`, filtrering på `grant.organizationId`, `Promise.all`), 5.2 (rollematrise med admin, `access.inspectors_edit_all` av og reklamasjon), 5.3 (myk sletting) og 6.1.3–6.1.5 (ruten uten innlogging og fra annen organisasjon).
- 4.2 (samme resultat), 4.3.2 (ingen interne koder), 4.6 (injeksjon og lukket motor), 6.2 (ingen lagring) og 6.4 (logging).
- Grønn `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` (begge prosjektene), og ADR 0016 med målingene fra `.next/standalone`.
- Røyktest etter utrulling i testmiljøet føres i testrapporten (etter merge).
