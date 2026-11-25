# Testplan: Levende forhåndsvisning av badet på PC

- **Oppgavekort:** `docs/funksjoner/fase2a-levende-forhandsvisning.md`
- **Dato:** 25.11.2026 (test-leder, før bygging)
- **Branch:** `levende-forhandsvisning` (fra `main`, 0.20.1 → 0.21.0)
- **Beslutninger:** A603–A612. Sjekket 25.11.2026 mot alle brancher på origin: bare `levende-forhandsvisning` bruker A603–A612. Utvikleren sjekker igjen rett før commit.
- **Støtter hovedmål:**
  - **De ansatte:** e2e viser at siden følger feltet, at ett klikk fører til feltet, at «Neste mangel» virker, og at skjemaet virker som før når visningen feiler, er av eller er uten nett.
  - **Færre reklamasjoner:** testene låser at visningen viser det samme som PDF-utkastet (samme sider, samme merker), at utgivelsens PDF er byte for byte uendret, og at ventende KI-forslag ikke blir usynlige.
  - **KI i bunnen:** testene viser at gjengivelsen aldri kaller KI, at margen viser samme liste som publiseringssjekken, og at sidekartet bare har id-er og faste koder, så det trygt kan brukes som inndata senere.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Tid er fast (`TEST_NOW`). Badet bygges med `createBathroomFixture`/`startedBathroom`, `answer`, `answerHole` og `createStaff` i `tests/report-fixtures.ts`; organisasjoner og ansatte med `tests/factories.ts`. Alle data er oppdiktede («Prøvevegen 1», `nextFakeOrgNumber()`). Testene bruker den falske KI-leverandøren.

Test-id-er: `LF<avsnitt>.<nr>`. Hver test har id-en først i navnet, slik at testrapporten kan krysse av akseptkriteriene (tabellen i avsnitt 12).

## Avtale om signaturer (utviklere og testskriver)

Fra kortet, Omfang 2–3 og 8. Avvik føres i kortet før testene skrives.

- `src/core/pdf`: `RenderedPages`, `RenderReportPages`, `CreateReportPagesRenderer` som i kortet. `PdfEngineJob.output: "pdf" | "pages"`, `PdfEngineResult` er union på `output`.
- `src/core/pdf/codes.ts`: `PDF_PAGE_ANCHOR_KINDS`, `PdfPageAnchor`, `PdfPageMapEntry`, tak (`PREVIEW_MAX_PAGES`, `PREVIEW_MAX_RESPONSE_BYTES`, `PREVIEW_MAX_IN_FLIGHT = 1`; navn fritt, men konstanter, ikke tall i ruten). Ingen importer i filen.
- `src/core/pdf/page-map.ts`: ren fil uten importer (mønsteret for gyldig anker og hjelpere klienten trenger).
- Ren funksjon fra anker til felt ved siden av `rom/[roomId]/pdf-anchors.ts` (navn fritt, for eksempel `pageAnchorTarget(anchor, knownFields)`), gir `{ checkpointId, saveKey } | null`.
- Ren funksjon fra KI-forslagets mål til anker (navn fritt, for eksempel `aiSuggestionAnchor(target)`).
- Køen for nye gjengivelser i klienten som ren klasse eller funksjon med injisert klokke og henter (navn fritt, for eksempel `PreviewRefreshQueue`), slik at den kan enhetstestes uten nettleser.
- **Merk:** kortet skriver `pendingAiSuggestions` i `src/core/reports`; i main heter funksjonen `pendingAiSuggestionsOf` (`src/core/reports/signals.ts`). Testene bruker den som finnes, og kortet rettes.

## 1. Gjengivelsen til sider (`src/core/pdf`, integrasjon med motoren)

Fil: `src/core/pdf/render-pages.test.ts` (motoren i arbeidstråd, som `render.test.ts`).

- **LF1.1** Samme `ReportPdfData` og `PdfProfile` gir like mange sider i `renderReportPages` som i `renderReportPdf` med `draft: true` (bad med 8 punkter, 3 avvik, TGIU).
- **LF1.2** Hver side har «UTKAST» (tekst i SVG-en), og utkastmerkene «Ikke satt», «Mangler», «Sjekk» står der de står i PDF-utkastet (samme sidenummer).
- **LF1.3** Samme inndata to ganger gir samme `hash` per side (deterministisk); endret tekst i ett avvik endrer bare `hash` på siden(e) med avviket.
- **LF1.4** `hash` er SHA-256 av SVG-en (heks, fast lengde).
- **LF1.5** `widthPt`/`heightPt` er A4 i profilens enhet.
- **LF1.6** Sikker SVG (tabell, `it.each` over alle sider): ingen `<script`, ingen attributt som begynner på `on`, ingen `foreignObject`, ingen `href`/`xlink:href` som ikke begynner på `#` eller `data:`, ingen `@import` eller `url(http`.
- **LF1.7** Rapporttekst med `<script>alert(1)</script>`, `{{ x }}`, `#import "x"`, `]`, `\` og `"` i årsak gir sider der teksten står som tekst (escapet) og ingen av punktene i LF1.6 brytes.
- **LF1.8** Over taket på sider gir egen feil med fast kode (ikke motorfeil) og ingen delvis `RenderedPages`.
- **LF1.9** Feil i motoren (ødelagt mal) gir egen feil med fast kode; `error.message` lekker ikke rapporttekst.
- **LF1.10** Ingen midlertidige filer: antall filer i `os.tmpdir()` og i prosjektets `var/` er likt før og etter 5 gjengivelser, også når gjengivelsen feiler.
- **LF1.11** Arbeidstråden avsluttes etter hver gjengivelse (ny tråd per jobb, ADR 0016 punkt 2): antall aktive tråder er likt før og etter. Innføres varm tråd (A605), erstattes testen av LF1.12–LF1.14.
- **LF1.12** (bare med varm tråd) Tråden er bundet til én ansatt og én organisasjon: jobb for organisasjon B får aldri samme tråd som A.
- **LF1.13** (bare med varm tråd) Tråden avsluttes ved feil, tidsavbrudd, etter tomgang og etter fast antall gjengivelser (falsk klokke).
- **LF1.14** (bare med varm tråd) Data fra jobb 1 finnes ikke i svaret på jobb 2 (to rapporter med ulike merketekster).

## 2. Utgivelsen er urørt (regresjon)

Fil: `src/core/pdf/render-unchanged.test.ts`.

- **LF2.1** Fast utgivelsesprøve (fast `generatedAt`, fast data, `draft: false`) gir SHA-256 lik verdien tatt fra main **før** malen endres. Verdien skrives inn i testen i første commit, før `layout.ts` og malen røres.
- **LF2.2** Samme for PDF-utkastet (`draft: true`) med `pageMap` av: byte for byte likt main.
- **LF2.3** Malen med `pageMap: true` skriver start- og sluttmerker; med `pageMap: false` finnes ingen merker i oppsettet (ren test på `layout.ts`).
- **LF2.4** Eksisterende tester for like byte og visuell sammenligning av PDF-utkastet og utgivelsen (`render.test.ts`, `fase-2a-pdf-badet*.spec.ts`) er grønne uten endring i forventningene.

## 3. Sidekartet (regeltester som data)

Filer: `src/core/pdf/page-map.test.ts` (rent), `src/core/pdf/render-pages.test.ts` (med motoren).

- **LF3.1** Tabell over alle `PDF_PAGE_ANCHOR_KINDS`: bad som har alle avsnittstypene gir minst én rad per kode, med riktig `checkpointId`, `deviationId` (bare `deviation*`) og `elementKey` (bare `checkpoint.answer`, ellers `null`).
- **LF3.2** Ankrene bygges fra `checkpointId`, `deviationId`, `elementKey`: samme bad gjengitt som utgivelse (der `editPath` er `null`) gir samme ankere når `pageMap: true`; ingen anker har `a1`/`a2`-tellere.
- **LF3.3** Avsnitt over to sider (lang årsak) gir to rader med samme anker, én per side, med stigende `page`.
- **LF3.4** `mark` er satt bare der utkastet har merke, og er en av de faste kodene; ellers `null`.
- **LF3.5** Bare id-er og faste koder: regex over hele `JSON.stringify(pageMap)`; hver strengverdi er UUID, en kode i `PDF_PAGE_ANCHOR_KINDS`, en merkekode, eller `field_key` med malenes tegnsett. Rapporten har oppdiktet adresse, matrikkel og årsakstekst med kjente merker; ingen av dem finnes i `pageMap`.
- **LF3.6** `x`, `y`, `w`, `h` er endelige tall innenfor siden; `w`, `h` > 0; rekkefølgen i `pageMap` følger siden (side, så `y`).
- **LF3.7** Slettede punkter og avvik (`deleted_at`) finnes verken i sidene eller i `pageMap`.
- **LF3.8** Merkene endrer ikke linje- eller sideskift: tekstposisjonene i SVG-en for et fast bad er like med og uten `pageMap` (eller: samme sideantall og samme `hash` når merkene er fjernet fra sammenligningen; testskriveren velger den sikreste).
- **LF3.9** Fast kode endres aldri (regel 6): øyeblikksbilde av `PDF_PAGE_ANCHOR_KINDS` i rekkefølge; testen sier at koder bare legges til eller arkiveres.

## 4. Fra anker til felt, og fra KI-forslag til anker (rene funksjoner, tabeller)

Filer: `rom/[roomId]/pdf-anchors.test.ts` (utvides), ny `rom/[roomId]/page-anchor-target.test.ts`, `src/core/reports/ai-anchor.test.ts` (eller der funksjonen legges).

- **LF4.1** `it.each` over alle ankerkoder: riktig punkt og riktig nøkkel i lagringskøen (samme nøkkel som `field-save-store.ts` bruker for feltet).
- **LF4.2** Ukjent kode, arkivert punkt, `elementKey` som ikke finnes i skjemaet, `deviationId` fra et annet punkt, slettet avvik: `null`.
- **LF4.3** Ondsinnede ankere gir `null` og kaster ikke: `"]'\"><script>`, `../../`, `__proto__`, `constructor`, CSS-selector-tegn (`#a, .b`), 10 000 tegn, ikke-UUID, `null`, tall, objekt med ekstra nøkler.
- **LF4.4** Statisk test: funksjonen og forhåndsvisningskomponentene bruker ikke ankeret i `querySelector`, `getElementById` med sammensatt streng, `href`, `router.push` eller mal-streng til adresse (søk i kildeteksten).
- **LF4.5** Hver feltkode som kan få KI-forslag (lista hentes fra KI-modulens målkoder, ikke skrevet av i testen) gir et anker. Mangler avsnitt for feltet, gir funksjonen punktets anker. Ingen kode gir `null`.
- **LF4.6** Knappetekstene («Gå til årsak, avvik 2 under Membran») bygges av skjemadataene; tabell over alle ankerkoder gir ikke-tom norsk tekst uten id-er.

## 5. Ruten `GET /oppdrag/[id]/forhandsvisning` (integrasjon mot testdatabasen)

Fil: `src/app/(ansatt)/oppdrag/[id]/forhandsvisning/route.test.ts`. Innlogget bruker settes som i `pdf/route.test.ts`.

### 5a. Tilgang per rolle

- **LF5.1** `it.each(["inspector", "office", "manager", "admin"])`: 200 med sider, `pageMap` og forslag.
- **LF5.2** Ansatt med bare admin-rollen: 200 (regel 11, admin stenges aldri ute).
- **LF5.3** Takstmann med `access.inspectors_edit_all` av: 200 (lesing er som badet).
- **LF5.4** Ikke innlogget: 401 som JSON med fast kode og fast norsk tekst, aldri 303 eller HTML.
- **LF5.5** Ansatt som har sluttet, bruker uten ansettelse, ansatt uten roller: 404.
- **LF5.6** Reklamasjonsdata: oppdrag med reklamasjonssak gir sider uten noe fra reklamasjonen (merketekst i reklamasjonen finnes ikke i JSON-en).

### 5b. Tenant-isolasjon

- **LF5.7** `expectTenantIsolation` på ruten: ansatt i organisasjon B med alle roller, oppdrags-id fra A, gir 404 og ingen sider; samme for admin i B.
- **LF5.8** Id fra adressen brukes aldri som organisasjon: rapporten slås opp fra oppdraget med `grant.organizationId` (testen setter en rapport i B med samme oppdragsnummer og viser at A får sin egen).
- **LF5.9** Slettet oppdrag, slettet rapport, erstattet rapport, ugyldig id (ikke UUID, tom, 1000 tegn): 404 med samme tekst; feilteksten inneholder ikke verdien fra adressen.

### 5c. Svar og hoder

- **LF5.10** `HEAD`, `POST`, `PUT`, `DELETE` gir 405.
- **LF5.11** Hodene: `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` (som PDF-ruten), `Content-Type: application/json`. Aldri `image/svg+xml`.
- **LF5.12** JSON-formen valideres med Zod i testen: `pages[]`, `pageMap[]`, `aiSuggestions[]` med bare `aiUsageId`, `anchor`, `featureCode`. Ingen andre felt.
- **LF5.13** 413 over sidetaket og over svarstørrelsen (tak satt lavt via konstant eller injisert verdi).
- **LF5.14** Feil i gjengivelsen gir 500 med fast tekst; loggen har `errorFields` og ikke `error.message` og ikke rapport-id.
- **LF5.15** Vellykket gjengivelse logger bare antall sider og millisekunder, uten rapport-id, oppdrags-id eller ansatt-id (spion på loggeren).
- **LF5.16** PDF-rutene endrer ikke oppførsel etter uttrekket fra `pdf-response.ts`: eksisterende `pdf/route.test.ts` og `utgivelser/.../pdf` sine tester er grønne uendret.

### 5d. Tak (A606)

- **LF5.17** To forhåndsvisninger samtidig for samme ansatt: én 200, én 429 med `Retry-After`.
- **LF5.18** Forhåndsvisning og «Lag PDF (utkast)» samtidig: 200 på begge.
- **LF5.19** To forhåndsvisninger fra to ulike ansatte samtidig og så en PDF: forhåndsvisningene kan aldri fylle det felles taket på 2 (taket for forhåndsvisning er 1 per prosess); PDF-en får 200.
- **LF5.20** Taket per ansatt tas før datalesingen: med taket opptatt gir nytt kall 429 uten spørring mot rapporttabellene (spion på `getReportDraftPdfData` eller tellende database-hjelper).
- **LF5.21** 401 og 404 holder ikke plass etter svaret: 404 etterfulgt av gyldig kall gir 200; feil i gjengivelsen frigjør plassen.

### 5e. Ingen KI, ingenting lagres

- **LF5.22** 20 kall til ruten med falsk leverandør aktiv: 0 nye rader i `ai_usage_log`; falsk leverandør ble aldri kalt.
- **LF5.23** Radantall i alle tabeller (`RESET_TABLES`) er likt før og etter 5 kall, også når ett kall gir 500 og ett 429.
- **LF5.24** Forslagsteksten (kjent merke i den falske leverandørens svar) finnes verken i `ReportPdfData`, i noen SVG eller i JSON-svaret.

### 5f. Ventende KI-forslag

- **LF5.25** Forslagslisten i svaret er den samme som publiseringssjekken gir (`pendingAiSuggestionsOf`) for samme rapport: like `aiUsageId`-er, også etter at ett forslag er godtatt og ett avvist (de forsvinner).
- **LF5.26** Fraseforslag telles ikke (A524), som i publiseringssjekken.
- **LF5.27** Forslag i organisasjon B kommer aldri med i svaret til A (del av `expectTenantIsolation`).

## 6. Serverhandlingen for hendelsen (A608)

Fil: `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (utvides) eller egen `live-preview-event.test.ts`.

- **LF6.1** Ett kall gir nøyaktig én `report.live_preview_opened` med rapport-id og profilkode slått opp på serveren; bare tillatte felt (tillatt-listen i `src/core/events/types.ts`).
- **LF6.2** Klienten kan ikke styre rapport-id eller profil: ekstra felt i inndata ignoreres eller avvises; hendelsen har serverens verdier.
- **LF6.3** `expectTenantIsolation` på skriveveien: ansatt i B med oppdrags-id fra A gir ingen hendelse og feil uten detaljer.
- **LF6.4** Ikke innlogget, sluttet ansatt, slettet oppdrag: ingen hendelse.
- **LF6.5** Alle fire roller og bare admin-rollen kan skrive hendelsen.
- **LF6.6** Ingen visning eller spørring teller hendelsen per person: statisk søk etter `live_preview_opened` utenfor typefilen, handlingen og testene gir ingen treff med `actor_id`/`group by`.

## 7. Klienten (enhetstester uten nettleser)

Filer ved siden av komponentene, `*.test.ts`.

- **LF7.1** Køen: tre `saved` innen 150 ms gir én forespørsel (falsk klokke).
- **LF7.2** Endringer mens en gjengivelse pågår gir nøyaktig én ny forespørsel etter at den første er ferdig; aldri to samtidig.
- **LF7.3** Svar i feil rekkefølge (svar 1 kommer etter svar 2) forkastes; sidene fra svar 2 står.
- **LF7.4** Bare sider med ny `hash` byttes (komponentnøkkel eller teller for bytte).
- **LF7.5** Ny side oppstår (sideantall fra 3 til 4, avsnittet for siste lagrede felt flyttet): melding «Teksten gikk over til side 4» til `aria-live`.
- **LF7.6** 429 og 500: høyst 3 nye forsøk, opphold øker og er minst `Retry-After`; så feiltilstand. Stopper når ruten slås av, `document.hidden`, eller `navigator.onLine` er usann.
- **LF7.7** 401 og 404 tømmer sidene og stopper forsøk.
- **LF7.8** «Viser sist lagrede tekst» når lagringskøen har ventende felt, er uten nett eller har feil (statusen fra `field-save-store`).
- **LF7.9** `blob:`-adresser frigjøres: `URL.revokeObjectURL` kalles for hver gammel side ved bytte, ved av og ved fjerning (spion), og antall levende adresser er lik antall sider.
- **LF7.10** «Neste mangel»: rekken er `mark`-rader pluss KI-forslag sortert på side og `y`; «Forrige» fra første og «Neste» fra siste går rundt eller står (velg og test); ingen gir «Ingenting å se på».
- **LF7.11** `localStorage`: bare én fast nøkkel, verdien har bare av/på og bredde (Zod); ugyldig verdi gir standard (av, standardbredde) uten feil.

## 8. Statiske tester

Fil: `src/core/pdf/static-checks.test.ts` og `rom/[roomId]/static-checks.test.ts` (utvides), `pdf/service-worker.test.ts`.

- **LF8.1** Ruten, de nye filene i `src/core/pdf` og forhåndsvisningskomponentene importerer ikke `@/core/ai`.
- **LF8.2** Klientfilene importerer ingen verdier fra `@/core/pdf` (bare `import type`); verdier bare fra `src/core/pdf/codes.ts` og `src/core/pdf/page-map.ts`, som ikke har importer.
- **LF8.3** `@myriaddreamin/typst-ts-renderer` er låst til nøyaktig `0.7.0` i `package.json` og lockfila, og importeres bare i `src/core/pdf/typst-worker.mjs`; `pdfLeaf`-regelen holder.
- **LF8.4** Pakken har ikke `preinstall`/`install`/`postinstall` (les `node_modules/.../package.json`).
- **LF8.5** `next.config.ts` har pakken i `serverExternalPackages` og `outputFileTracingIncludes`.
- **LF8.6** `public/sw.js`: ruten står ved siden av `PDF_PATHS` og går alltid til nettet; ingen `cache.put` for den.
- **LF8.7** Ruten og klientkoden logger ikke SVG, `pageMap` eller forslag (ingen `console.*`/logger med de variablene); SVG skrives aldri til `localStorage`, `sessionStorage`, `indexedDB` eller `caches`.
- **LF8.8** Ingen `dangerouslySetInnerHTML` og ingen `<svg` for sidene i forhåndsvisningskomponentene; sidene er `<img>`.
- **LF8.9** `package.json` har versjon `0.21.0`.

## 9. E2e i PC-størrelse

Fil: `e2e/fase-2a-levende-forhandsvisning.spec.ts`, prosjekt `pc` (Desktop Chrome, 1280 × 720, mus). Data som i `fase-2a-pdf-badet.spec.ts`: prøveorganisasjonen fra `pnpm db:seed:testoppdrag`, eget oppdrag med ett bad per test (`uniqueSuffix()`). Første steg i hver test sjekker med `matchMedia` at forutsetningen (`(min-width: 1280px) and (pointer: fine)`) faktisk holder, så testen ikke blir grønn av feil grunn.

- **LF9.1** Bryteren «Forhåndsvisning» har `role="switch"`, navn og `aria-checked`, trykkflate minst 44 × 44 px; av første gang.
- **LF9.2** På: ruten vises med overskrift og landemerke, romlisten foldes inn til en stripe som kan åpnes, skjemaet er minst 600 px bredt. Av: alt som før.
- **LF9.3** Valget og bredden huskes etter ny innlasting; `localStorage` har nøyaktig én ny nøkkel, uten oppdrags-, rapport- eller ansatt-id i nøkkel eller verdi.
- **LF9.4** Skillet har `role="separator"` med verdi; piltaster og dra endrer bredden innenfor grensene; skjemaet går aldri under 600 px.
- **LF9.5** Sidene er `<img>` med `alt` «Side N av M»; ingen `svg`-element for siden i DOM-en; «UTKAST» står i bildet (sjekket via JSON-svaret).
- **LF9.6** Etter lagring av årsak viser ruten den nye teksten (ny `hash` på siden; teksten finnes i den nye SVG-en i svaret).
- **LF9.7** Krav under ett sekund: én oppvarming, så 10 lagringer; performance-merke ved `saved` og etter `img.decode()`; median under 1000 ms, ellers rød. Medianen skrives til testvedlegget og føres i PR-en og ADR-tillegget.
- **LF9.8** Rulleposisjonen står fast når en side lenger ned byttes; sidene som ikke er endret, beholder samme `img`-element (samme `src`).
- **LF9.9** Fokus i årsak-feltet ruller ruten til avsnittet bare hvis det er utenfor synsfeltet, markerer med ramme og merke (synlig uten farge: ramme tykkere enn 2 px og et tekstmerke), og flytter ikke fokus fra feltet.
- **LF9.10** Mens det skrives i feltet, ruller ruten ikke (bare ved fokusbytte).
- **LF9.11** `reducedMotion: "reduce"`: ingen myk rulling (`scroll-behavior` er `auto`) og ingen animasjon på markeringen.
- **LF9.12** Klikk på avsnittet for årsak gir fokus i årsak-feltet i riktig avvik; Enter på samme avsnitt likeså.
- **LF9.13** Skrivebeskyttet: takstmann med `inspectors_edit_all` av, og publisert rapport: klikk gir fokus i feltet, feltet viser at det er skrivebeskyttet, ingen ny melding og ingen lagring.
- **LF9.14** «Neste mangel»: teller «3 ting å se på» for et bad med to «Ikke satt» og ett ventende KI-forslag; «Neste» tre ganger går i sidens rekkefølge og setter markøren i feltet hver gang; bad uten mangler gir «Ingenting å se på».
- **LF9.15** KI-forslag i margen: falsk språkvask på årsak gir merkelappen «KI-forslag venter» utenfor siden, med `aria-label` «KI-forslag venter: språkvask, årsak» og tonen «hav» (klassen eller tokenet, ikke farge alene). Klikk fører til forslaget; «Avvis» logges i `ai_usage_log` som før, og merkelappen forsvinner etter neste oppdatering.
- **LF9.16** Feil: ruten svarer 500 (`page.route`): «Oppdateres …», høyst 3 nye forsøk (tellet), så «Forhåndsvisningen kunne ikke lages.» med «Prøv igjen»; skjemaet lagrer fortsatt; aldri en feilside.
- **LF9.17** 429 med `Retry-After: 1`: nytt forsøk tidligst etter 1 s.
- **LF9.18** Uten nett (`context.setOffline(true)`): «Forhåndsvisningen trenger nett. Skjemaet lagres som vanlig.»; et felt skrevet uten nett gir «Viser sist lagrede tekst»; tilbake på nett gir ny gjengivelse.
- **LF9.19** Tastatur: Tab fra siste felt i skjemaet gir lenken «Hopp over forhåndsvisningen» og så ett stopp i ruten; piltaster og Home/End flytter mellom avsnittene; neste Tab forlater ruten (antall Tab-stopp i ruten = 1 + lenken).
- **LF9.20** axe uten funn på badskjermen med ruten på (`expectNoAxeViolations` fra `e2e/helpers.ts`), også i feiltilstanden og uten nett-tilstanden.
- **LF9.21** Hendelsen: ett trykk på bryteren gir én `report.live_preview_opened`; innlasting med «på» husket gir ingen; av og på igjen gir én til.
- **LF9.22** Ingenting lagres i nettleseren: etter en økt med ruten på finnes ingen SVG i `localStorage`, `sessionStorage`, IndexedDB eller `caches` (søk etter `<svg` og «UTKAST»).
- **LF9.23** Sletting: avvik fjernet i skjemaet forsvinner fra sidene og fra `pageMap` etter neste oppdatering.
- **LF9.24** «Lag PDF (utkast)» virker som før med ruten på (eksisterende hjelper `waitForPdfTab`).

## 10. E2e i iPad-størrelse

Samme fil, prosjekt `ipad` (1194 × 834, berøring), og egne kontekster.

- **LF10.1** iPad Pro 11" liggende (prosjektet `ipad`): ingen bryter, ingen rute, ingen kall til forhåndsvisningsruten (`countRequests`), badskjermen virker som før (lagre årsak, «Lag PDF (utkast)»).
- **LF10.2** iPad Pro 12,9" liggende (`browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: true })`): over 1280 px, men berøring: ingen bryter. Testen sjekker først at `matchMedia("(pointer: fine)")` er usann i konteksten; er den sann i Chromium-emuleringen, skal testen feile med forklaring, ikke hoppe over.
- **LF10.3** «På» husket i `localStorage` fra PC, så åpnet i iPad-størrelse: ingen rute og ingen kall.
- **LF10.4** Uten nett i iPad-størrelse: badskjermen som før, ingen melding fra forhåndsvisningen.

## 11. Utenfor e2e, men sjekkes i gjennomgangen

- Arkitektens ADR-tillegg (størrelse, tid, minne, median fra LF9.7) finnes før merge.
- `docs/plan/forbedrerens-tillegg.md`, ordlisten og domenemodellen 4.3 er oppdatert.
- Fjernbarhet: å ta ut ruten, komponenten og bryteren lar alle andre tester stå grønne (gjennomgangen sjekker at ingen andre filer importerer forhåndsvisningen, utenom badskjermen på ett sted).

## 12. Akseptkriterier mot tester

| Akseptkriterium (kortet) | Tester |
|---|---|
| Bryter på PC, huskes, én nøkkel | LF9.1–LF9.4, LF7.11 |
| Ingen bryter på iPad | LF10.1–LF10.3 |
| Samme som PDF-utkastet, UTKAST | LF1.1, LF1.2, LF3.1 |
| Utgivelsens PDF uendret | LF2.1–LF2.4 |
| `pageMap` bare id-er og koder, to sider | LF3.3, LF3.5 |
| Fra anker til felt, ondsinnet gir `null` | LF4.1–LF4.4 |
| Under ett sekund | LF9.6, LF9.7 |
| Køen | LF7.1–LF7.3 |
| Bare endrede sider, rulling, `aria-live` | LF7.4, LF7.5, LF9.8 |
| Fokus ruller og markerer, redusert bevegelse | LF9.9–LF9.11 |
| Klikk og Enter, skrivebeskyttet | LF9.12, LF9.13 |
| Neste mangel | LF7.10, LF9.14 |
| KI-forslag i margen, samme liste | LF5.25, LF5.26, LF9.15 |
| Anker for alle KI-feltkoder | LF4.5 |
| Ingen forslagstekst | LF5.24 |
| Ingen KI-kall | LF8.1, LF5.22 |
| Ingenting lagres | LF1.10, LF5.23, LF8.7, LF9.22 |
| Sikker SVG, bare `<img>` | LF1.6, LF1.7, LF8.8, LF9.5 |
| Tenant-isolasjon (rute og hendelse) | LF5.7–LF5.9, LF5.27, LF6.3 |
| 404-tilfellene, slettet, ingen reklamasjon | LF5.5, LF5.6, LF5.9, LF3.7, LF9.23 |
| Alle roller, bare admin | LF5.1–LF5.3, LF6.5 |
| 401, 405, hoder, logg | LF5.4, LF5.10, LF5.11, LF5.14, LF5.15 |
| Taket | LF5.17–LF5.21 |
| 429 og feil i nettleseren | LF7.6, LF9.16, LF9.17 |
| Uten nett | LF7.8, LF9.18, LF10.4 |
| Ett tabulatorstopp | LF9.19 |
| Hendelsen én gang per trykk | LF6.1–LF6.4, LF9.21 |
| Service workeren | LF8.6 |
| Renderer låst, bare i tråden, klientimporter | LF8.2–LF8.5 |
| Universell utforming | LF9.1, LF9.4, LF9.5, LF9.19, LF9.20 |
| Kommandoene grønne | testrapporten |

## 13. Krav før godkjenning

Test-leder avviser hvis noe av dette mangler: LF5.1–LF5.3 (alle roller og bare admin), LF5.7 og LF6.3 (`expectTenantIsolation` på ruten og på skriveveien), LF2.1 (fast SHA-256 tatt fra main før malendring), LF4.3 (ondsinnede ankere), LF5.22–LF5.24 (ingen KI, ingenting lagres, ingen forslagstekst), LF9.7 (målt median) og LF10.1–LF10.2 (iPad urørt).

## Funn fra test-leder ved planleggingen

- **Lite:** kortet skriver `pendingAiSuggestions`; funksjonen i main heter `pendingAiSuggestionsOf` (`src/core/reports/signals.ts`). Rett kortet.
- **Lite, men viktig for «iPad: ingen endring»:** iPad Pro 12,9" er 1366 px bred liggende, så bare `(pointer: fine)` holder bryteren borte. Med Magic Keyboard med styreflate kan iPadOS melde `pointer: fine`, og da vises bryteren på iPaden. LF10.2 dekker berøring; ux-ansvarlig og arkitekten avgjør om det skal legges til en sjekk til (for eksempel `(hover: hover)` og ikke `any-pointer: coarse`), og fører det i A609.
- **Lite:** prosjektet `pc` er nøyaktig 1280 px bredt, så PC-testene ligger på grensen; LF9.2 viser at skjemaet får 600 px og ruten resten ved 1280 px med romlisten foldet inn.
