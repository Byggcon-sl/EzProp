# ADR 0016 – PDF-motor: Typst som WASM i en arbeidstråd

Dato: 24.11.2026. Status: vedtatt av agentene i autonom modus (A534, A530, A539 i `docs/09-apne-sporsmal.md`); Ståle kan endre. **Dyrt å endre:** alle PDF-oppsett i 2a-3 bygges på motoren. Oppgavekort: `docs/funksjoner/fase2a-pdf-badet.md`. Bygger på ADR 0015 (utgivelser og snapshot), ADR 0006 (KI i bunnen) og ADR 0004 (drift uten nett).

Støtter hovedmålene: **færre reklamasjoner** (samme data gir samme PDF, byte for byte, så leder kan vise teksten og TG slik de ble publisert; forside og selskapsnavn følger dagens opplysninger til endelig PDF lagres i 2a-3; norsk orddeling, hele avvikskort og riktig bunntekst gir en rapport uten slurv), **de ansatte** (utkastet er klart på under ett sekund, og motoren kan senere vise rapporten ved siden av skjemaet og på iPad uten nett) og **KI i bunnen** (motoren er lukket og ren: ingen KI, ingen nett, ingen ny databehandler; rapporten har én strukturert form, snapshotet, som både PDF-en og KI senere kan lese).

## Beslutninger

1. **Motoren er Typst 0.14, kjørt som WASM** med pakkene `@myriaddreamin/typst.ts` 0.7.0 og `@myriaddreamin/typst-ts-web-compiler` 0.7.0 (begge Apache-2.0, låst versjon). Ingen egen tjeneste, ingen nettleser på serveren, ingen binærfil per plattform.
2. **Motoren kjører i en egen arbeidstråd** (`node:worker_threads`), én ny tråd per PDF. Tråden avsluttes når PDF-en er ferdig, ved feil og ved tidsavbrudd. Da stopper tidsgrensen faktisk motoren, minnet gis tilbake etter hver PDF, og ingen tilstand deles mellom to PDF-er eller to organisasjoner. Kostnaden er rundt 0,4 sekunder per PDF (se målingene). En varm tråd vurderes først med «Levende forhåndsvisning».
3. **Motoren er lukket.** WASM-utgaven har ingen filtilgang og ingen pakkehenting før noen gir den det, og det gjør vi aldri: ingen `withAccessModel`, ingen `withPackageRegistry`, standardskriftene fra CDN slås av (`disableDefaultFontAssets()` og `loadFonts(..., { assets: false })`), og `fetch` settes til en funksjon som avviser i tråden. Skrifter, logo og bilder går inn som byte.
4. **Rapportdata blir aldri kode.** Malen er fast kode i repoet (en tekstkonstant i `src/core/pdf`, ikke en fil som leses). Dataene går inn som JSON i `sys.inputs.data` og settes som tekstverdier. Malen bruker aldri `eval`, og aldri `@preview`-pakker (statisk test).
5. **`src/core/pdf` er et rent blad** med grensesnittet i `types.ts`: `renderReportPdf(data, profile, options)` er eneste vei til motoren. Filene:
   - `codes.ts`, `types.ts`: faste koder og typer.
   - `render.ts`: `createReportPdfRenderer(engine)`. Ren: sjekker grensene og bildene, bygger inndata til malen, kaller motoren. Kan brukes i nettleseren i 2b med en annen `PdfEngine`.
   - `engine.node.ts`: `PdfEngine` for serveren. Starter `typst-worker.mjs` med filstien `path.join(process.cwd(), "src/core/pdf/typst-worker.mjs")` og avslutter tråden ved tidsavbrudd.
   - `typst-worker.mjs`: eneste fil som laster motorpakken. Ren JavaScript, så Next ikke pakker den.
   - `assets.node.ts`: eneste fil med `node:fs`. Leser `public/fonts` og `public/brand` én gang per prosess.
   - Lint-regelen `pdfLeaf` (`eslint-rules/module-boundaries.js`): bare egen mappe og `@/shared`; `node:`-moduler og `server-only` bare i `*.node.ts`; ingen pakker ellers. `reportsToPdfTypeOnly`: `core/reports` bruker bare `import type` fra `core/pdf`. Det er ruten som kaller gjengivelsen.
   - Motoren er et bibliotek, ikke en leverandør, og står ikke i `INTEGRATION_PORTS`.
6. **`ReportPdfData` bygges av én ren funksjon fra snapshotet** (`buildReportPdfData` i `src/core/reports`, F6). Utkastet lager snapshotet fra dagens data; en utgivelse bruker `report_releases.snapshot`. Endelig PDF i 2a-3 bygges med samme funksjon. Kildene:

   | Felt i `ReportPdfData` | Kilde |
   |---|---|
   | `reportId` | snapshotet (`report.report_id`) |
   | `kind`, `versionNumber` | utgivelsesraden (`version_number`), ellers utkast |
   | `rooms[].title`, `buildingName`, `floorName`, `roomType` | snapshotet |
   | `checkpoints[].label`, `tg`, `descriptionText` | snapshotet (`SnapshotCheckpoint`; TG er regnet der) |
   | `answers[].label`, valgtekst og tall | snapshotet (`SnapshotAnswer`) |
   | hvilke svar som er med, og enheten | den låste malversjonen (`show_in_report`, `unit`) via `snapshot.report.template_version_id` (`PdfTemplateLabels`) |
   | `deviations[]` tekst, årsak, konsekvens, tiltak, kostnad | snapshotet; flettefelt fylles fra snapshotets feltsvar (`mergeFieldsText`, `mergeSourcesFor`); kostnadstekst fra `costDisplayText`; etiketter fra kodedata i `logic/labels.ts` |
   | `tgiu` | snapshotet (`SnapshotTgiu`) |
   | `tgExplanation` | kodedata i `src/core/reports/tg-explanation.ts` (A533) |
   | `cover` (oppdragsnummer, adresse, matrikkel) | hentet ved gjengivelse fra oppdraget, med `grant.organizationId` |
   | `cover.inspectionDate` | snapshotet (`report.inspection_date`) |
   | `company` | utkast: `assignments.company_id`; utgivelse: `report_releases.company_id`. Navn og org.nr. hentes ved gjengivelse |
   | `generatedAt` (i `options`) | utkast: nå; utgivelse: `released_at` |
   | `missing`, `notes`, `tgNotSet`, `editPath` | bare utkast: funnene fra `computePublishCheck` og id-er |

   Snapshotet har med vilje ikke adresse, matrikkel, oppdragsnummer eller selskapets navn. Det betyr at forsiden og selskapsnavnet på en eldre utgivelse følger dagens rader, ikke radene fra publiseringen. Ingen ny kolonne nå (A455); lagring av endelig PDF i 2a-3 låser også disse. `ReportPdfData` har ingen andre felt som bare finnes i levende rader.
7. **Samme resultat hver gang.** `generatedAt` settes inn i dokumentet (`set document(date: …)`), og motoren leser aldri klokken. Samme data og profil gir like byte, også med annen tidssone og locale (målt). Kravet i oppgavekortet er derfor like byte, ikke bare lik struktur.
8. **Profilene er kodedata** (`PdfProfile`, A530) med `code`, `version` og `orientation` fra første dag. Retning settes per side i malen (`set page(flipped: …)`), så stående og liggende kan blandes i samme dokument. Bunnteksten er en liste med faste deler, ikke en tekst med flettefelt.
9. **Tak og grenser (A539), i `src/core/pdf/codes.ts`:**
   - én pågående PDF per ansatt og høyst **2 samtidig per prosess** (`src/shared/lib/keyed-limiter.ts`, nøkkel `grant.employeeId`); ellers 429;
   - tidsgrense **20 sekunder**, så avsluttes tråden;
   - høyst **60 bilder**, **25 MB** bilder til sammen og **2400 punkter** på lengste side per bilde.

   Taket gjelder **per prosess**. Testmiljøet har én instans (B1, 1,75 GB). Med flere instanser ganges det felles taket med antall instanser, og det må vurderes på nytt før skalering. Taket deles av alle organisasjoner, og må vurderes før selskap nummer to tas inn. Bildegrensene er foreløpige: de settes endelig etter målingen med ekte visningskopier i 2a-3 (se «Det som ikke er målt»).
10. **Ingen midlertidige filer.** Alt skjer i minnet. Ingen temp-mappe, og ingenting å rydde ved oppstart.
11. **I pakken:** `next.config.ts` har `serverExternalPackages` for de to pakkene og `outputFileTracingIncludes` for arbeidstråden, motorens CJS-filer og WASM-filen. `public` (skrifter og logo) kopieres inn av `deploy-azure.yml` som før. Utrullingen kjører `scripts/pdf-engine-trial.mjs` fra den ferdige pakken før zip, og stopper hvis arbeidstråden, WASM-filen, skriftene eller logoen mangler, eller hvis et krav i prøven ikke holder. `start.sh` trenger ingen endring: `pnpm install` henter pakkene, og WASM er lik på Mac og Linux. Ingen nye Azure-ressurser.
12. **Feil fra motoren** blir til en fast kode (`PDF_RENDER_ERROR_CODES`). Meldingen fra motoren logges aldri og sendes aldri ut, fordi den kan sitere rapporttekst.

## Prøven

Skript: `scripts/pdf-engine-trial.mjs`. Kjørt 24.11.2026 på linux-x64 (Ubuntu, glibc 2.39), Node 22, fra `.next/standalone` bygget og flatet ut slik `deploy-azure.yml` gjør det (`node-linker=hoisted`, `cp -r public`, `cp -RL`). Innholdet er oppdiktet: innholdsfortegnelse, smal kolonne, seks avvikskort, to bilder med markering, en liggende side og vannmerket «UTKAST» (4 sider).

| Måling (valgt motor, fra `.next/standalone`) | Resultat |
|---|---|
| Orddeling bokmål, 4,2 cm kolonne | Virker. «Fuktsikringsdokumen-tasjonen», «membran-underlagskonstruksjo-nen», «våtromsgulvkon-struksjonen», «gulvvarmeforde-lingsskapet». Uten orddeling stikker ordene ut av kolonnen. Mønstrene ligger i WASM-filen, så resultatet er uavhengig av Linux-bildet |
| Like byte | Ja: to ganger i samme tråd, og i ny tråd med `TZ=Asia/Tokyo` og japansk locale. Også likt den ferdigbygde Typst-motoren for Node (samme SHA-256) |
| Tagget PDF, språk | `Tagged: yes`, `/Lang (nb)`, `CreationDate` lik inndata |
| Tid for badet | Oppstart av motoren 0,12 s + første PDF 0,2–0,3 s. Neste PDF i samme tråd 0,01 s |
| Minne for badet | Hele prosessen 250–260 MB med to tråder (Node alene rundt 60 MB) |
| 50 ulike bilder (PNG 1600 × 1200, 7,3 MB inn) | 1,6 s, PDF på 7,8 MB, hele prosessen rundt 800 MB |
| Fil utenfor roten (`#read("/etc/passwd")`) | Avvist |
| Pakke fra nettet (`#import "@preview/…"`) | Avvist |
| Nettverkskall under gjengivelsen | 0 (alle `fetch` sperret og telt) |
| Tekst som ligner kode (`<script>`, `{{ }}`, `#import`, `#read(...)`, `$ … $`) | Står som vanlig tekst |
| Tidsavbrudd | En mal som ikke blir ferdig, stoppet etter 1,5 s ved å avslutte tråden |
| Størrelse i pakken | WASM 28,3 MB + 0,7 MB JavaScript. Hele pakken 106 MB, zip 38 MB |
| `pnpm audit --prod` | Ingen kjente sårbarheter |

De to andre motorene og den ferdigbygde Typst-motoren ble kjørt på samme maskin med samme innhold, men **fra en egen mappe, ikke fra `.next/standalone`** (de er ikke avhengigheter i prosjektet). Chromium var den som alt står på maskinen for e2e-testene.

## Sammenligning

| Krav | Typst WASM (valgt) | Typst ferdigbygd for Node | Chromium med Playwright | pdfmake (rent JS) |
|---|---|---|---|---|
| Stående og liggende per side | Ja (målt) | Ja | Ja (målt, `@page`) | Ja |
| Flere profiler fra samme data | Ja, profilen er inndata | Ja | Ja, CSS | Ja |
| Markering som vektorlag | Ja (målt) | Ja | Ja, SVG | Ja, `canvas` |
| Innholdsfortegnelse med sidetall | Ja (målt) | Ja | Ikke målt. Må regnes i to runder | Ja |
| Interne og eksterne lenker | Ja | Ja | Ja | Ja |
| Orddeling bokmål | Ja (målt) | Ja (målt) | Ja i dette bygget (målt). Avhenger av ordbokfilene i nettleseren som rulles ut | **Nei.** Deler ord midt i en stavelse (målt) |
| Like byte | Ja (målt) | Ja (målt) | Bare innenfor samme sekund: datoen tas fra klokken | Ja (målt) |
| Tagget PDF, `nb` | Ja (målt) | Ja | Ja (målt) | **Ikke tagget** (målt) |
| iPad uten nett, SVG per side | Ja: samme WASM-fil i nettleseren. SVG målt i Node (6 sider på 0,05 s med `typst-ts-renderer`) | Nei, bare Node | Nei | I nettleseren ja, ingen SVG |
| B1 Linux, zip | 29 MB i pakken, ingen systembiblioteker | 51 MB, riktig binærfil per plattform | 280–390 MB, hentes fra egen CDN ved installasjon, trenger systembiblioteker | 12 MB |
| Lukket motor | Ja, av konstruksjon (målt) | **Hentet en pakke fra nettet** og la den i `~/.cache/typst` da malen ba om det (målt). Kan ikke slås av | Sandkassen startet ikke i containeren (målt); måtte kjøres uten | Leser lokale filer om ikke annet er satt |
| Data blir aldri kode | JSON-inndata | JSON-inndata | Krever HTML-escaping overalt | Objekter |
| Tid, badet | 0,3–0,4 s | 0,05 s | 0,5 s oppstart + 0,2–0,3 s | 0,1–0,2 s |
| Minne, badet | rundt 200 MB over Node | rundt 45 MB | 775 MB (nettleserprosessene) | rundt 55 MB |
| 50 bilder | 1,6 s, 800 MB | 0,5 s, 460 MB | 4,1 s, 870 MB | 0,3 s, 185 MB |
| Avbrudd | Avslutt tråden (målt) | Egen tråd må til | Drep prosessen | Egen tråd må til |
| Lisens | Apache-2.0 | Apache-2.0 | BSD med flere | MIT |
| Leverandørkjede | To pakker fra registeret, ingen installasjonsskript, ingen telemetri | Binærfil fra registeret | Binærfil utenfor pakkeregisteret | Fra registeret |
| Ny databehandler eller KI-leverandør | Nei | Nei | Nei | Nei |

`@react-pdf/renderer` ble ikke prøvd: pakken lot seg ikke installere fra registeret (en underpakke manglet).

## Hvorfor

- **Kvaliteten avgjør.** Bare Typst og Chromium gir norsk orddeling og tagget PDF. pdfmake gir verken eller, og faller på «ingen slurv» og universell utforming.
- **Chromium er for tung og for åpen** for B1: tre ganger minnet for et bad, flere hundre MB som hentes utenfor pakkeregisteret, sandkassen måtte av, og datoen kan ikke styres. Den kan heller ikke kjøre på iPad uten nett.
- **WASM foran ferdigbygd Typst**, selv om den ferdigbygde er raskere: WASM-utgaven er lukket av konstruksjon, mens den ferdigbygde hentet en pakke fra nettet i prøven. WASM er også samme fil på Mac, i CI, i Azure og i nettleseren, og ga byte for byte samme PDF. 0,4 sekunder er langt under kravet på 5.
- **Valget stenger ikke for 2b.** Samme mal og samme motor kan kjøre i nettleseren på iPad. Forhåndsvisningen og senere KI-forslag i margen kan bruke SVG per side fra samme gjengivelse.

## Det som ikke er målt

- **Azure App Service.** Prøven er kjørt på linux-x64 fra pakken slik den rulles ut, ikke i selve App Service. Utrullingen kjører prøven fra pakken, og røyktesten etter utrulling føres i testrapporten.
- **iPad.** At WASM-filen (28 MB) lastes, mellomlagres og kjører i Chrome på iPad, er ikke prøvd. Det måles i 2b eller med «Levende forhåndsvisning», det som kommer først.
- **Ekte bilder.** De 50 bildene var ukomprimerte testbilder. Med 2 samtidige PDF-er på 800 MB hver er B1 for liten. Derfor er bildegrensen 25 MB nå, og tak og grenser måles på nytt med ekte visningskopier (JPEG) før «Bilder på PC» i 2a-3 slås på.
- **Innholdsfortegnelse i Chromium** og sandkassen i App Service er ikke prøvd, siden Chromium falt på andre krav.

## Forkastet

- **Chromium/Playwright** og **pdfmake**: se over.
- **Ferdigbygd Typst for Node** (`@myriaddreamin/typst-ts-node-compiler`): raskest, men henter pakker fra nettet uten at det kan slås av, og kan ikke kjøre på iPad.
- **Ekstern gjengivelsestjeneste:** ny databehandler og kostnad.
- **Varm arbeidstråd som gjenbrukes:** 0,01 s per PDF, men minnet i WASM krymper aldri, og tilstand kunne følge med fra én PDF til den neste.
- **Malen som fil (`.typ`) lest fra disk:** enda en sti som må finnes i pakken. En tekstkonstant følger koden.
- **`PublishSource` som inndata til `buildReportPdfData`:** ville gitt to former for «hele rapporten» (prosjektleder 24.11.2026, F6).

## Konsekvenser

- To nye avhengigheter (regel 9), 29 MB i pakken.
- Oppsett skrives i Typst-språket, ikke HTML og CSS. Designsystemets farger og skrifter føres inn i profilen for hånd.
- Oppgradering av motoren kan endre bytene i PDF-en av en gammel utgivelse. Versjonen er låst, og oppgradering er en egen oppgave med sammenligning av en fast prøve-PDF. Fra 2a-3 lagres endelig PDF, så det kunden fikk, endres aldri.
- Typst 0.14 lager tagget PDF, men full PDF/UA er ikke prøvd. Det vurderes med endelig PDF i 2a-3.
