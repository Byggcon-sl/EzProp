# Funksjon: PDF-motor (ADR) og PDF-utkast av badet i Byggcons profil

- **Fase:** 2a-2 Hele veien først, punkt 4 («ADR: valg av PDF-motor, og PDF-en av badet i Byggcons profil, i ferdig kvalitet»)
- **Modul:** kjerne. Ny `src/core/pdf` er et rent blad (motoren bak eget grensesnitt, profilene, oppsettet). Rapportdataene lages i `src/core/reports` i egne filer (`pdf-data.ts`, `pdf-data-build.ts`, `tg-explanation.ts`). Knapp og rute under `src/app/(ansatt)/oppdrag/[id]/`.
- **Branch:** `pdf-motor-badet` (bygger på `main`; main flettet inn 24.11.2026 med publisering av badet, utgivelser og ADR 0015)
- **Status:** godkjent for bygging. Forhåndsvurdering runde 1 tatt inn 18.11.2026. Overtatt 24.11.2026 med main flettet inn (publisering, utgivelser, ADR 0015, «KI i veien»); ny forhåndsvurdering samme dag (forbedrer, arkitekt, ki-ansvarlig, fagansvarlig, sikkerhet-personvern, test-leder) er tatt inn, se «Avgjørelser 24.11.2026». Main (`6f4ce32e`, versjon 0.19.4) flettet inn på nytt 24.11.2026 kl. 11 UTC; forhåndsvurdering runde 2 (forbedrer, sikkerhet-personvern, test-leder) er tatt inn, se «Avgjørelser 24.11.2026, runde 2». Beslutningene er A530–A542 og A600–A602, spørsmål 122 (flyttet fra 92, som `testdata-del-2` bruker). Versjon 0.20.0 (minor over main 0.19.7, større leveranse).
- **Dato:** 18.11.2026 (oppdatert 24.11.2026)
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** PDF-en er det kunden og megleren leser. Den viser hvert avvik med TG, årsak, konsekvens, tiltak og kostnad på samme måte hver gang, TGIU med alle opplysningene, og forklaringen av TG. Ingen interne koder, ingen tomme sider, ingen overskrift alene nederst på en side. I utkastet ser takstmannen det som mangler, før rapporten går ut.
  - **De ansatte:** ett trykk på «Lag PDF (utkast)» gir rapporten slik den blir (IVIT: tre trykk og leting i nedlastingene). Fra utkastet kommer takstmannen med ett klikk tilbake til feltet som skal rettes. Utkast fyller ikke opp arkivet.
  - **KI i bunnen:** rapportdataene samles i én strukturert modell med faste koder (`ReportPdfData`), bygget av en ren funksjon. Ingen KI i gjengivelsen; ventende KI-forslag kommer aldri med. Motoren velges også ut fra om den kan kjøre i nettleseren på iPad (2b), slik at forhåndsvisningen og senere KI-forslag i margen kan bruke samme gjengivelse.

## Problem
Badet kan fylles ut på PC (PR #224), men det finnes ingen PDF. Uten PDF kan ikke «hele veien» i 2a-2 fullføres, Ståle kan ikke se og godkjenne utseendet, og valget av PDF-motor er ikke tatt. Velges motoren feil, må alt som bygges i 2a-3 (full rapport, 50 bilder, flere profiler, liggende) bygges om. Derfor ADR først, så PDF-en av badet.

## KI i bunnen
- **KI lager aldri PDF-en og endrer aldri tekst i den.** PDF-en er en ren gjengivelse av lagrede data: samme data og samme profil gir samme fil. Ingen KI-kall i `src/core/pdf`; statisk test viser at modulen ikke importerer `src/core/ai`.
- **Én form for «hele rapporten» (F6):** `ReportPdfData` bygges alltid fra `ReportSnapshot` (ADR 0015, `src/core/reports/publish-types.ts`). Utkastet lager snapshotet fra dagens data med `buildReportSnapshot(loadPublishSource(...))`; en utgivelse bruker det lagrede snapshotet. Det finnes derfor bare én strukturert form som KI senere kan lese, og ingen ny. Om KI i 2a-3 bruker snapshotet, avgjøres der; denne oppgaven lover ingenting om det.
- **Strukturerte data:** `ReportPdfData` har faste koder (punkt, utfall, TG, kostnadstype, TGIU-grunn) ved siden av teksten som vises. Persondata (adresse, matrikkel) ligger bare i `cover`, som aldri går til KI.
- **Bare besluttet tekst:** snapshotet har bare lagret tekst. Ventende KI-forslag (fraseforslag, språkvask, utkast til sammendrag), avviste forslag, regelforslag som ikke er godtatt, regelbegrunnelser og kilder kommer aldri med (T14). Godtatt KI-tekst vises som vanlig lagret tekst.
- **KI-merking (avgjort på main, A355 og `SnapshotAiMark`):** PDF-en viser ingen KI-merking i 2a-2. `ReportPdfData` tar ikke med `ai_usage_id`, `ai`-merkene fra snapshotet eller `text_source`. Om kundens PDF skal merke tekst fra KI, er fag og personvern og avgjøres med endelig PDF i 2a-3 (spørsmål 122e). Merkingen ligger allerede i snapshotet, så det krever ingen ombygging.
- **Ingen KI i gjengivelsen:** ingen KI-kall, ingen rad i `ai_usage_log`, ingen evalueringssett, 0 kr. Statisk test: verken `src/core/pdf` eller `pdf-data.ts`, `pdf-data-build.ts`, `release-pdf.ts` og `tg-explanation.ts` i `src/core/reports` importerer `@/core/ai`.
- **Måling:** hvert utkast gir én hendelse `report.draft_pdf_created`, og hver PDF av en utgivelse `report.release_pdf_created`, med bare rapport-id, profilkode, antall sider, antall bilder og millisekunder (utgivelsen også versjonsnummer). Raden har `actor_id` fordi `recordEvent` alltid lagrer den: den er spor av hvem som hentet ut en PDF med adresse. Den vises og telles aldri per ansatt (arbeidsmiljøloven kap. 9), bare samlet bak `statistics.read`. Test: ingen spørring grupperer disse hendelsene på `actor_id`. `durationMs` er maskintid, ikke arbeidstid.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Lag PDF (utkast)» på badet og få PDF-en slik kunden får den** slik at **jeg ser feil før rapporten går ut**.
- Som **takstmann** vil jeg **se i utkastet hvilke punkter som mangler noe, og klikke meg rett til feltet** slik at **jeg ikke glemmer noe og retter raskt**.
- Som **leder** vil jeg **at PDF-en alltid har bunntekst med riktig juridisk selskap** slik at **rapporten er riktig overfor kunden og forsikringen**.
- Som **Ståle** vil jeg **at samme rapport kan få ulik layout og farger senere** slik at **vi kan tilpasse PDF-en til en kunde eller et segment** (Ståle 16.11.2026; bygges i 2a-3, men motoren velges for det nå).

## Omfang
**Med:**

1. **ADR 0016 «PDF-motor»** (`docs/adr/0016-pdf-motor.md`; 0015 er tatt av `publisering-badet`). Sammenligner minst tre motorer i en tabell:
   - Chromium/Playwright med HTML og CSS for utskrift (Paged Media),
   - Typst (som Node-pakke med ferdigbygd motor, uten egen tjeneste),
   - et rent JS-bibliotek (for eksempel pdfmake eller react-pdf).

   **Kravene i tabellen:**
   - stående og liggende i samme dokument (per side), flere profiler fra samme data, bilder med markering som eget vektorlag, innholdsfortegnelse med sidetall, interne og eksterne lenker;
   - norsk orddeling for bokmål, **målt i Linux-bildet slik det rulles ut**, ikke bare lokalt (Chromium uten skjerm mangler ofte ordbøkene, og da gjør `hyphens: auto` ingenting);
   - samme resultat hver gang: like byte med fast dato, eller begrunnet hvorfor ikke (Chromium setter dato og tilfeldige id-er);
   - tagget PDF og språket satt til `nb`;
   - kan kjøre i nettleseren på iPad uten nett (WASM), og lage SVG per side til forhåndsvisning (trengs i 2b og for den levende forhåndsvisningen under «Fra forbedreren»);
   - kjører i Azure-testmiljøet (App Service B1 Linux, zip-utrulling, 1,75 GB minne) uten tjenester som koster ekstra; for Chromium vurderes størrelse, systembiblioteker på App Service og minne særskilt;
   - lukket motor (sikkerhet): kjører i samme prosess eller container, ingen ekstern gjengivelsestjeneste (ellers ny databehandler og spørsmål til Ståle), ingen nettverkskall under gjengivelsen, skrifter og logo bare fra repoet (aldri CDN), ingen fillesing utenfor en fast mappe. Chromium: JavaScript av, alle forespørsler blokkert, sandkassen på; trengs `--no-sandbox` i App Service, teller det som tung ulempe. Typst: data bare som JSON-inndata (`sys.inputs`), ingen `eval` av rapporttekst, låst rotmappe;
   - rapportdata kan aldri bli kode i malen;
   - tid og minne for badet (målt) og for 50 bilder (anslag nå, måling i 2a-3), grense for samtidige PDF-er og tidsgrense, så B1 ikke går tom for minne;
   - lisens, og ny avhengighet begrunnet etter regel 9;
   - leverandørkjede: låst versjon, ingen nedlasting av binærfiler utenfor pakkeregisteret ved installasjon (Chromium via Playwright hentes fra egen CDN, og det teller), ingen telemetri, `pnpm audit` uten funn;
   - ingen ny KI-leverandør og ingen ny databehandler (motoren kjører lokalt);
   - avbrudd: hvordan tidsgrensen faktisk stopper motoren. En synkron WASM-motor i samme tråd kan ikke avbrytes; da kjøres den i en egen arbeidstråd (`worker_threads`) som avsluttes ved tidsavbrudd;
   - midlertidige filer: gjengivelse i minnet foretrekkes. Trengs en temp-mappe, får den tilfeldig navn og rettighet 0700, slettes i `finally`, og rester ryddes ved oppstart (en drept prosess kjører ikke `finally`).

   **Tak og flere instanser:** ADR-en setter tallene for A539 (én pågående PDF per ansatt, felles tak, tidsgrense, bildegrenser) og sier at taket gjelder per prosess (én instans på B1). Med flere instanser ganges det felles taket med antall instanser; det må vurderes på nytt før skalering. Taket deles av alle organisasjoner, og det må vurderes før selskap nummer to tas inn.

   **Skrifter, logo og binærfiler i pakken:** ADR-en sier hvordan stien finnes i `.next/standalone`. `public` kopieres inn av `deploy-azure.yml` (steget med `cp -r public .next/standalone/public`), ikke av Next. Motorens binærfil (WASM eller annen) tas med via `outputFileTracingIncludes` eller `serverExternalPackages`. CI-testen viser at filene finnes i zip-bygget.

   **Hullet mellom `ReportPdfData` og `ReportSnapshot` (arkitekt punkt 4):** ADR-en har en tabell med hvert felt i `ReportPdfData` og kilden: snapshotet, den låste malversjonen (`snapshot.report.template_version_id`: etiketter, `show_in_report`, enheter, valgtekster), utgivelsesraden (`company_id`, `released_at`, `version_number`), eller hentet ved gjengivelse (forsiden: oppdragsnummer, adresse, matrikkel; selskapets navn og org.nr. via `company_id`). Snapshotet har med vilje ikke adresse, matrikkel, oppdragsnummer eller selskapets navn og org.nr. Flettefeltene i avvikstekstene fylles fra snapshotets feltsvar med `mergeFieldsText` og `mergeSourcesFor`. Krav: `ReportPdfData` har ingen felt som bare finnes i levende rader, utenom `cover` og utkastdelene (`missing`, `findings`, lenkene). Ingen ny kolonne nå (A455).

   **Prøven:** arkitekten lager et lite prøveskript og kjører det fra `.next/standalone` på linux-x64, slik pakken rulles ut. Det måler orddeling (bokmål, smal kolonne), like byte to ganger, tid og minne for badet. Resultatene står i ADR-en. ADR-en sier hvordan motorens binærfiler og skriftene kommer med i zip-pakken (`outputFileTracingIncludes`, `serverExternalPackages`), hva som må med i `deploy-azure.yml` og `start.sh`, og om valget stenger for PDF på iPad uten nett i 2b. Valget mellom WASM og nettleser begrunnes opp mot 2b, der forhåndsvisningen og senere KI-forslag i margen skal bruke samme gjengivelse. ADR-en sier at `ReportPdfData` bygges av én ren funksjon fra snapshotet, slik at endelig PDF i 2a-3 bygges med samme funksjon fra `report_releases.snapshot`.

2. **Grensesnittet** i `src/core/pdf`: `renderReportPdf(data: ReportPdfData, profile: PdfProfile, options: { draft: boolean; generatedAt: Date; appBaseUrl?: string; assets: PdfAssets; limits: PdfLimits }): Promise<RenderedPdf>` (`bytes`, `pageCount`, `imageCount`). `PdfAssets` har skrifter og logo som byte; `PdfLimits` har tidsgrense, høyeste antall bilder og samlet bildestørrelse. Motoren får alt som inndata: den leser aldri klokke, tilfeldige tall, database, filtjeneste eller nett. Bilder, skrifter og logo går inn som byte (i `PdfAssets`). Tidsgrense og bildegrenser går inn som tall.
   - `src/core/pdf` er et rent blad: eier `ReportPdfData`, `PdfProfile` og `renderReportPdf`, og importerer verken `core/reports`, `core/access`, `core/files`, `core/ai` eller `db`. `core/reports` importerer bare typene (`import type`). Ny lint-regel i `eslint-rules/module-boundaries.js`, samme mønster som `reportsLogicLeaf`. Unntak: `src/shared` er lov.
   - **Skrifter og logo (arkitekt punkt 7):** `renderReportPdf` er ren og leser aldri filer. Én egen fil, `src/core/pdf/assets.node.ts`, leser skriftene og logoen fra den faste mappen (`public/fonts`, `public/brand`) og er eneste sted i `src/core/pdf` med `node:fs` (statisk test). Da kan samme gjengivelse brukes i nettleseren i 2b.
   - **Bildesjekken (arkitekt punkt 8, sikkerhet punkt 5):** tillatt-listen for JPEG (`isAllowedMarker`/`hasMetadataSegment`, A12) og PNG-sjekken flyttes til en ren funksjon i `src/shared/images/`, brukt av `src/modules/offline-trial`, `src/core/pdf` og senere `core/files`. Ingen kopi.
   - **Vernet mot overbelastning (A539)** ligger ikke i `src/core/pdf`, fordi det teller per ansatt: en generisk teller med nøkkel og injiserbar klokke i `src/shared/lib/keyed-limiter.ts`, brukt av rutene med `grant.employeeId` som nøkkel.
   - Motorpakken importeres i én fil (statisk test).
   - Gjengivelsen skjer i minnet, eller i en egen midlertidig mappe (se kravet i ADR-en) som slettes i `finally`, også ved feil og tidsavbrudd.
   - Motoren er et bibliotek, ikke en leverandør, og skal ikke inn i `INTEGRATION_PORTS`.

3. **Profilene som kodedata:** `PdfProfile` har `code`, `version` (fra første dag, D8 `report_profile_version`), `name`, `orientation` (`portrait` eller `landscape`), farger, skrifter, logo som fast fil (`public/brand/byggcon-logo.png`), forsideoppsett, rekkefølge på delene og bunntekst-mal. Profilen har aldri selskapsnavn eller fagtekst. `byggcon_standard` (stående) er standard og koblingen mot `client_agreements.report_profile_code` (A115). En andre profil finnes bare i testene (liggende, andre farger). Tabellen `report_profiles` og valg av profil kommer med «Flere PDF-utgaver» i 2a-3. Farger, skrifter og rekkefølge på delene føres i tabellen for `report_profiles` i `docs/05-domenemodell.md` 4.3.

4. **Rapportdataene** i `src/core/reports`, i egne filer (`pdf-data.ts`, `pdf-data-build.ts`, `release-pdf.ts`, `tg-explanation.ts`) og med én eksportlinje i `index.ts`. `signals.ts`, `snapshot.ts` og publiseringen endres ikke, bare importeres.
   - **Én leser (arkitekt punkt 1):** `getReportDraftPdfData(actor, organizationId, assignmentId)` kaller selv `requireOrganizationAccess(..., "organization.read")` og `requireUuid`, finner oppdragets gjeldende rapport (ikke `superseded`, ikke slettet) med `grant.organizationId`, og kaller `loadPublishSource` (som alt leser hele rapporten med `grant.organizationId`, myk sletting og låst malversjon). Den har bare én egen spørring: forsiden (oppdragsnummer, adresse, matrikkel, befaringsdato) og selskapet via `assignments.company_id`, filtrert på `grant.organizationId` og `deleted_at is null` på oppdrag, rapport og selskap. Oppslaget fra oppdrag til rapport gjøres her, aldri i ruten (sikkerhet punkt 2). `organizationId` kommer fra økten. Fremmed, slettet, erstattet og ugyldig id gir samme 404. Svaret er `{ data: ReportPdfData; reportId; employeeId }` (`grant.employeeId` er nøkkelen til telleren).
   - **Én byggefunksjon fra snapshotet (F6):** `buildReportPdfData(input: { snapshot: ReportSnapshot; template: PdfTemplateLabels; cover: PdfCoverRow; company: PdfCompanyRow | null; findings: readonly PublishCheckFinding[] | null; options: { draft: boolean } }): ReportPdfData` er ren. Utkastet gir `snapshot = buildReportSnapshot(source)` og `findings = computePublishCheck(buildPublishCheckInput(source)).findings`; utgivelsen gir det lagrede snapshotet og `findings = null`. Med `draft: false` tas `findings`, `missing` og lenkene aldri med. `PdfTemplateLabels` er etiketter, valgtekster, enheter og `show_in_report` fra den låste malversjonen (`snapshot.report.template_version_id`).
   - Etiketter fra den låste malversjonen og oversettelsesfilen, aldri koder.
   - **Svar på felt (fagansvarlig punkt 1, A540):** svar på felt med `show_in_report = true` står under punktet, med etikett og valgtekst fra den låste malversjonen, tall med komma og enhet (for eksempel «12,4 vekt-%»). Felt med `show_in_report = false` (for eksempel `wet_room.building_code`, A212) kommer aldri med. Tomme svar gir ingen linje. Slik viser PDF-en om hull er tatt, måleverdien og grunnen når hull ikke er tatt (forskriften § 2-2).
   - Punktets TG er `SnapshotCheckpoint.tg`, som snapshotet regner med `computeCheckpointTg` (høyeste TG blant avvikene, ellers `tg_direct`). `src/core/pdf` regner aldri TG, og det lages ingen samlet TG for rommet (A537).
   - Kostnad fra `costDisplayText` som eneste kilde (hardt mellomrom som tusenskille finnes allerede i `formatWholeNumber`). `cost_type = none` gir ingen kostnadslinje. `cost_text` vises når den finnes. Kostnad på TG2 vises når den er satt.
   - Tekstene går gjennom `mergeFieldsText`; manglende verdi blir «[årstall mangler]» o.l., aldri `{…}`.
   - Årsakskriteriet vises med etiketten fra `CAUSE_CRITERION_LABELS` sammen med årsaksteksten; «Annet» vises ikke alene.
   - Tiltak i lagret rekkefølge; uten tiltak ingen overskrift.
   - HMS-avvik (`kind = hms`) har ingen TG: ingen TG-merke, men konsekvens og tiltak vises. Et punkt med bare HMS-avvik har ikke TG-merke; krever punktet TG (`gives_tg = true`), viser utkastet «Ikke satt» fordi sperren `mandatory_without_tg` slår til (se Omfang 5, «Bare i utkastet»). Et punkt med `gives_tg = false` får aldri TG og aldri «Ikke satt».
   - TGIU: alle utfylte felt i `tgiu_details`, med samme regel som skjermen (hva og hvorfor, risiko, hva som må til, annen fuktkontroll og resultat, skadeutsatt konstruksjon på `wet_room.adjacent`). Setningen om at eier er informert om utvidet ansvar står bare når `owner_informed` er sann; usann eller tom gir ingen slik setning. Etiketten er «TGIU», aldri «IU».
   - **TG-forklaringen er innhold:** kodedata med tekststatus («utkast, ikke godkjent av fagrådet», A533) i `src/core/reports/tg-explanation.ts`, sendt i `ReportPdfData`. Den følger regelverk-krav.md avsnitt 2: TG0 normalt ingen avvik, tilnærmet ny og dokumentert utførelse (ordet «normalt» så F1 ikke motsies); TG1 mindre avvik og normal slitasje, eller ny uten dokumentasjon; TG2 vesentlige avvik, tegn på skade, behov for tiltak snart, eller usikker funksjon på grunn av alder; TG3 store eller alvorlige avvik, funksjonssvikt, fare for liv og helse, med kostnadsanslag; TGIU ikke undersøkt, og rapporten sier hva og hvorfor; én setning om at HMS-forhold beskrives uten TG. Egne ord, ingen henvisning til NS 3600, ingen gjetteord. Teksten tas med i gjetteord- og kopitesten. Merket «utkast» står i dataene, ikke i PDF-teksten.
   - Aldri med i `ReportPdfData`: noe fra `claims`; ventende eller avviste KI-forslag; `ai_usage_id`, `ai`-merkene og `text_source`; `reports.summary_text` og `summary_basis` (sammendraget er 2a-3); regelforslag som ikke er godtatt og `rule_decisions` fra snapshotet; regelbegrunnelser (`reasons`); kilder (`TG_LABEL_SOURCE`, regelens kilde, punktets `regulation_ref`); hjelpetekster (`help_text`); `publish_check_results`, overstyringer og overstyringsgrunner ved publisering. Hver av dem har en merketekst-test (nøkkelsøk i `ReportPdfData` og søk i PDF-teksten).
   - Selskap mangler (`assignments.company_id` eller `companies.org_number` tom): utkastet lages, og bunnteksten sier «Juridisk selskap mangler på oppdraget». `organizations.brand_name` brukes aldri som juridisk selskap (A538).

5. **PDF-en av badet i Byggcons profil:**
   - **Forside:** «Tilstandsrapport», adresse og matrikkel, oppdragsnummer, befaringsdato, logoen fra profilen og selskapets navn. Ingen navn på eier, bestiller eller megler. Ingen bilder på forsiden før forsidebilde finnes (2a-3).
   - **Innholdsfortegnelse** med sidetall. Deler som ikke finnes, står ikke der.
   - **Forklaring av TG** (fra `ReportPdfData`, se 4).
   - **Badet:** romnavn og etasje, hvert kontrollpunkt med TG, beskrivelse og svar på felt som skal i rapporten, avvik med TG, avvikstekst, årsak, konsekvens, tiltak og kostnad, og TGIU. Deler uten innhold gir aldri egne sider eller tomme overskrifter.
   - **Bare i utkastet, hentet fra publiseringssjekken** (A536, F8; ADR 0015 punkt 3: hver regel står ett sted): utkastet lager ingen egne regler for hva som mangler. `buildReportPdfData` får funnene fra `computePublishCheck` og plasserer hvert funn ved målet sitt (kontrollpunkt eller avvik), med samme tekst som på publiseringsskjermen (`publish-check-texts.ts`):
     - sperren `mandatory_without_tg` gir «Ikke satt» (`TG_NOT_SET_LABEL`) der TG skulle stått, på punktet eller avviket (avvik med `kind = tg` uten valgt TG teller ikke i punktets TG);
     - de andre sperrene (`tg2_tg3_missing_cause_or_consequence`, `tg3_missing_cost`, `wet_or_below_ground_missing_hole`, og TGIU uten hva og hvorfor) gir «Mangler: <tekst fra sjekken>»;
     - advarsler fra sjekken gir «Sjekk: <tekst fra sjekken>» (for eksempel HMS uten konsekvens eller tiltak, TG2/TG3 uten tiltak, måleverdi som mangler). Advarselen om ventende KI-forslag viser bare sjekkens faste tekst, aldri forslaget;
     - funn på hele rapporten (for eksempel `inspection_date_missing`) står øverst på siden «Ikke med i PDF-en».

     Utkastet og sperren sier da alltid det samme, og F4-lenken fører rett til feltet. Ren gjengivelse, ingen ny fagregel og ingen sperre.
   - **Publisert rapport (A541):** «Lag PDF (utkast)» virker også når rapporten er `published`. Utkastet leser de låste radene og har fortsatt «UTKAST». `superseded` gir 404.
   - **Bilder med markering når den finnes:** visningskopi, bildetekst, markering som vektorlag over bildet, rett under avviket bildet hører til. Badet har ingen bilder i databasen før «Bilder på PC» (2a-3), så bildedelen prøves med oppdiktede bilder i testene. Bare JPEG og PNG kjent på innholdet (ikke filnavn), største mål i punkter, og avvisning av EXIF (også PNG `eXIf`), XMP, IPTC og kommentarfelt før motoren. Tillatt-listen for JPEG (A12) flyttes fra `src/modules/offline-trial/server/photo-storage.ts` til `src/shared/images/` og brukes begge steder (ikke kopi, se Omfang 2). Markeringen går inn som tall og faste former (koordinater, type, farge fra profilen), aldri som SVG eller HTML fra klienten; ugyldige koordinater avvises.
   - **Bunntekst på hver side:** juridisk selskap (navn og organisasjonsnummer fra oppdragets selskap), oppdragsnummer og «side x av y».
   - **Utkast:** «UTKAST» som vannmerke på hver side. Ingen PDF og intet innhold lagres (Ståle 16.11.2026); bare hendelsesraden (se KI i bunnen).
   - **PDF-ens egenskaper:** tittel «UTKAST – Tilstandsrapport <oppdragsnummer>», språk `nb`, tagget om motoren kan, ingen adresse, ingen ansattnavn i forfatter- eller programfeltet, faste datoer fra `generatedAt`.
   - **Sideskift** (se Lagt til av forbedreren F2).

6. **Knapp «Lag PDF (utkast)»** på badet og på oppdraget (PC), og ruten `src/app/(ansatt)/oppdrag/[id]/pdf/route.ts` (oppdragets id; rapporten finnes i `core/reports`):
   - Ruten (bare `GET`) svarer `application/pdf`, `Content-Disposition: inline; filename="utkast-<oppdragsnummer>.pdf"` (nummeret bare sifre og bindestrek), `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`. Service workeren mellomlagrer ikke ruten.
   - Ruten sjekker selv innlogging (layouten i `(ansatt)` beskytter ikke `route.ts`); ikke innlogget gir 401 eller videresending.
   - Ved feil svarer ruten med en enkel side på norsk (ikke JSON, ikke tom fane): «PDF-en kunne ikke lages. Prøv igjen.» med «Prøv igjen». Ved 404 eller manglende tilgang: «Fant ikke rapporten». Feilsidene (404, 429, 500) er faste tekster: ingen verdi fra adressen eller feilen skrives ut, og «Prøv igjen» er en vanlig lenke uten innebygd skript.
   - **Rekkefølge og vern mot overbelastning (A539):** innlogging, så tilgang og data (`getReportDraftPdfData`), så taket (`keyed-limiter` med `grant.employeeId`), så gjengivelse, så hendelsen. Ikke innlogget og 404 tar aldri plass i taket. Høyst én pågående PDF per ansatt og et lite felles tak (verdien i ADR-en), tidsavbrudd, grense for antall bilder og samlet størrelse inn i motoren. For mange gir 429 med «En PDF lages allerede. Vent litt og prøv igjen.»
   - **`appBaseUrl` (F4)** kommer bare fra serveroppsettet (`BETTER_AUTH_URL` i `src/shared/config/env.ts`), aldri fra `Host` eller `X-Forwarded-Host`.

6b. **«Åpne PDF» på hver utgivelse (F7, A541):** `releases-card.tsx` og skjermen etter publisering (`publiser/`) får lenken «Åpne PDF» per utgivelse. Ruten `src/app/(ansatt)/oppdrag/[id]/utgivelser/[releaseId]/pdf/route.ts`:
   - `getReleasePdfData(actor, organizationId, assignmentId, releaseId)` i `src/core/reports/release-pdf.ts`: `organization.read`, `requireUuid` på begge id-er, utgivelsen hentes med `grant.organizationId` og må høre til oppdragets rapport. Spørringen krever `deleted_at is null` på oppdrag, rapport og utgivelse (`report_releases` har ingen CHECK, så filteret står i spørringen), og selskapet hentes fra `report_releases.company_id` med `grant.organizationId`. Finnes ikke selskapet, vises teksten om at selskap mangler, aldri `brand_name`. Fremmed, ukjent, slettet og ugyldig id gir 404.
   - PDF-en bygges fra utgivelsens lagrede snapshot med `draft: false`: uten UTKAST, uten siden «Ikke med i PDF-en», uten «Ikke satt»/«Mangler»/«Sjekk» og uten interne lenker. Etiketter fra snapshotets låste malversjon, bunnteksten fra utgivelsens `company_id`, og `generatedAt` = `released_at`. Ved en reklamasjon kan leder vise **teksten og TG slik de ble publisert**. Forsiden (adresse, matrikkel, oppdragsnummer) og selskapets navn og org.nr. følger dagens opplysninger til endelig PDF lagres i 2a-3; lenketeksten lover ikke mer enn det (sikkerhet runde 2 punkt 1).
   - Ingenting lagres (lagring av endelig PDF kommer i 2a-3). Filnavnet er `tilstandsrapport-<oppdragsnummer>-v<versjon>.pdf`. Tittel i PDF-en: «Tilstandsrapport <oppdragsnummer>, versjon <n>».
   - Samme svarhoder, innlogging, tak, feilsider og 429 som utkastet. Hendelsen `report.release_pdf_created`.
   - TG-forklaringen er fortsatt utkast til fagrådet har godkjent den (A533). PDF-en sendes ikke noe sted; utsending er manuell og kommer senere.

7. **Tilgang** via `src/core/access`: samme som å se badet på skjermen (`organization.read`, samme sjekk som `getRoomView`). PDF-en inneholder aldri reklamasjonsdata og gir samme svar med og uten reklamasjon på oppdraget (A531, endret, se Avgjørelser).

8. **Logging uten persondata:** feil logges bare med rapport-id, profilkode og feilnavn eller `PdfRenderError.code`, aldri `error.message` eller stack. Det gjelder også feil utenfor motoren (`getReportDraftPdfData`, `getReleasePdfData`, `buildReportPdfData`, databasefeil med parametre), fordi de kan sitere adresse eller rapporttekst. Feilsidene går gjennom de vanlige sikkerhetshodene (CSP med `frame-ancestors 'none'`) og har `Cache-Control: no-store, private`.

9. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): PDF-profil (`PdfProfile`), rapportdata for PDF (`ReportPdfData`), PDF-utkast (`draft`), PDF av utgivelse (`release PDF`), TG-forklaring (`TgExplanation`). Domenemodellen 4.3: profilene er kodedata til 2a-3, med farger, skrifter, rekkefølge, `version` og `orientation`.

10. `package.json` versjon 0.19.5 (én patch over main 0.19.4).

**Ikke med (bevisst utelatt):**
- Lagring av endelig PDF, versjonslogg og sletting bare av admin (2a-3, «Endelig rapport lagres som ferdig PDF»). `report_pdf` i filmodulen brukes ikke. PDF av en utgivelse lages på nytt hver gang (F7).
- Tabellen `report_profiles`, admin-skjerm for profiler og valg av profil (2a-3, «Flere PDF-utgaver»).
- Hele rapporten (om Byggcon, arealer, dokumentasjon, forutsetninger, signatur) (2a-3). Utgaven av standarden og oversikten over dokumentasjon hører til der («med fra start» i regelverk-krav.md avsnitt 4).
- **Sammendraget** (`reports.summary_text`, laget med «KI i veien») kommer ikke i PDF-en før 2a-3. Delkoden `summary` er reservert i listen nå, så rekkefølgen i profilen ikke må endres senere (regel 6).
- KI-merking i PDF-en (spørsmål 122e).
- Testutskriften med 50 bilder og kravet om under 8 MB (2a-3).
- Bildetabellen `photos`, opplasting og markering på skjermen (2a-3, «Bilder på PC»).
- Samlet TG for rommet (A537, spørsmål 122a).
- Den levende forhåndsvisningen (eget planpunkt under «Fra forbedreren»).
- Endringer i publiseringen og «KI i veien» (begge merget i main). Unngå unødige endringer i `types.ts`, `room-view.ts`, `reports.ts`, `write.ts`, `signals.ts` og `snapshot.ts`; nye filer i `src/core/reports` i stedet. De eksisterende publiserings- og KI-i-veien-testene (også `publish-model` og e2e for publisering) er grønne uten endring.
- PDF på iPad uten nett (2b).
- Sending av PDF på e-post.

## Lagt til av forbedreren
Ståle 14.11.2026, «Forbedreren» i `CLAUDE.md`. Ført i `docs/plan/forbedrerens-tillegg.md`.

- **F1 To nye krav i ADR-en og to målinger i prøven** (i oppgaven): kan motoren kjøre i nettleseren på iPad uten nett og lage SVG til forhåndsvisning; tagget PDF med `nb`. Prøven måler orddeling i Azure-bildet og like byte. Står i Omfang 1. Arkitekten velger, men ADR-en viser målingene. Fjernes ved å ta kravene ut av tabellen.
- **F2 Sideskift som ikke ser slurvete ut** (i oppgaven, funn 8 i `analyse-ivit-leilighetsrapport-2026-10-27.md`): et avvikskort (TG-merke, tekst, årsak, konsekvens, tiltak, kostnad) holdes samlet; er det lengre enn en side, holdes en overskrift sammen med minst to linjer. Bildene står rett under avviket. Faste kolonnebredder. Kostnaden og «TG» med tallet deles aldri over to linjer (hardt mellomrom fra `formatWholeNumber`, og kostnadsteksten settes som en udelelig enhet i motoren, uten egen formatering). Strukturtest: ingen side slutter med en overskrift. Fjernes ved å ta ut reglene for sideskift i oppsettet.
- **F3 Siden «Ikke med i PDF-en»** (i oppgaven): siste side i utkastet, med UTKAST-stempel, lister badets kontrollpunkter uten innhold (ingen TG, ingen beskrivelse, ingen avvik, ingen TGIU), med etiketter og uten koder. Finnes aldri i endelig PDF. Ren gjengivelse, ingen sperre. Fjernes ved å ta ut delen `missing` i oppsettet.
- **F4 Lenker fra utkastet til skjemaet** (i oppgaven): i utkastet lenker hvert kontrollpunkt og hvert avvik til `/oppdrag/[id]/rom/[roomId]#punkt-<checkpointId>` (avvik: `#avvik-<deviationId>`), med adressen fra `appBaseUrl`. Badet-skjermen får ankrene om de mangler. Lenkene har bare id-er. Endelig PDF har ingen interne lenker (test). Fjernes ved å sette `appBaseUrl` til tom.
- **F5 Levende forhåndsvisning** (nytt planpunkt i 2a-2 «Fra forbedreren»): bygges ikke i denne oppgaven.
- **F6 Én rapportform: `ReportPdfData` bygges fra `ReportSnapshot`** (i oppgaven, 24.11.2026; KI i bunnen og færre reklamasjoner): utkastet lager snapshotet fra dagens data, utgivelsen bruker det lagrede. Én form for «hele rapporten»; snapshotet har aldri ventende KI-forslag, regelbegrunnelser eller reklamasjonsdata, så T14 og «aldri `claims`» holder av formen. Står i Omfang 4. Fjernes ved å la `buildReportPdfData` lese radene fra `PublishSource` direkte.
- **F7 «Åpne PDF» på hver utgivelse** (i oppgaven, 24.11.2026; de ansatte og færre reklamasjoner): ferdig-kriteriet i 2a-2 er at badet publiseres og blir til en PDF. PDF-en lages fra utgivelsens snapshot uten UTKAST, med fast `generatedAt` = publiseringstidspunktet, så leder kan vise teksten og TG slik de ble publisert (forside og selskapsnavn følger dagens opplysninger til 2a-3). Ingenting lagres. Står i Omfang 6b. Fjernes ved å ta ut lenken i `releases-card.tsx` og `publiser/` og ruten `utgivelser/[releaseId]/pdf`.
- **F8 «Mangler» i utkastet hentes fra publiseringssjekken** (i oppgaven, 24.11.2026; færre reklamasjoner og de ansatte): utkastet viser funnene fra `computePublishCheck` med samme tekst som publiseringsskjermen, i stedet for egne regler. Takstmannen ser i PDF-en nøyaktig det som stopper publiseringen. Ingen ny fagregel; A536 står, bare kilden er endret. Står i Omfang 5. Fjernes ved å sende `findings: null` til `buildReportPdfData`.
- Versjonen rettet til 0.19.5 etter ny innfletting av main 0.19.4 (forbedrer punkt 4, rettet igjen 24.11.2026 runde 2).

## Tilgang
| Rolle | Lage utkast | Endre |
|---|---|---|
| takstmann | Ja (`organization.read`), også på oppdrag med reklamasjon (PDF-en har ingen reklamasjonsdata) | – (PDF endrer ingenting) |
| kontor | Ja (`organization.read`), som takstmann | – |
| leder | Ja | – |
| admin | Ja, alltid, også med bare admin-rollen og når `access.inspectors_edit_all` er av (regel 11) | – |
| ikke innlogget | Nei (401 eller videresending) | – |
| sluttet / uten `organization.read` | Nei (404) | – |

Rapportens status: `draft` og `published` gir utkast med «UTKAST» (published leser de låste radene); `superseded` gir 404. «Åpne PDF» på en utgivelse har samme tilgang som utkastet (`organization.read`, også bare admin og med `access.inspectors_edit_all` av); utgivelse i en annen organisasjon eller på et annet oppdrag gir 404.

## Data
- **Ingen migrering.** Ingen nye tabeller eller kolonner. `tests/tenant-tables.ts` endres ikke.
- Nye hendelsestyper `report.draft_pdf_created` og `report.release_pdf_created` i `src/core/events/types.ts` (og testen som teller typene, og testen for forbudte felt). `events.report_id` har ingen fremmednøkkel, så id-en tas fra oppslaget med `grant.organizationId`.
- Faste koder: profilkoden `byggcon_standard` (regel 6: endres aldri, arkiveres), `orientation` `portrait`/`landscape`, delkodene `cover`, `toc`, `summary` (reservert, brukes fra 2a-3), `tg_explanation`, `room`, `missing`.
- Ingen tenant-tabell endres. Nye spørringer med `organizationId` (`getReportDraftPdfData`, `getReleasePdfData`) har hvert sitt kall til `expectTenantIsolation`.
- Ny avhengighet: motoren som ADR-en velger, begrunnet i PR-en (regel 9). Skriftene i `public/fonts` (OFL). Logo fra `public/brand/byggcon-logo.png`.

## Skjermer
Flyt: [badet] → trykk «Lag PDF (utkast)» → knappen viser «Lager PDF …» → PDF-en åpnes i ny fane → lukk fanen, og du er tilbake på badet. Ett trykk (IVIT: tre).
- **PC, badet** (`/oppdrag/[id]/rom/[roomId]`): knappen i toppen ved siden av fremdriften. Sekundær knapp (ikke hovedknappen), minst 44 pt høy, tekst og ikon. I iPad-størrelse dekker den ikke hovedknappene nederst.
- **PC, oppdraget** (`/oppdrag/[id]`): samme knapp der rapporten vises, når rapporten finnes.
- **Utgivelser (F7):** hver rad i utgivelseskortet på oppdraget og skjermen etter publisering har lenken «Åpne PDF» (vanlig `<a>`, aldri `next/link`, så ingenting hentes på forhånd; ny fane, minst 44 pt, tilgjengelig navn «Åpne PDF av versjon <n>»).
- **Ulagrede endringer:** finnes felt som ikke er lagret ennå (lagres automatisk eller venter i køen), viser knappen først «Lagrer endringer …» og venter til de er lagret, før PDF-en lages.
- **Ny fane som ikke blokkeres:** uten ventende lagring er knappen en vanlig lenke (`a href` til ruten, `target="_blank"`, `rel="noopener"`). Med ventende lagring åpnes fanen i samme trykk, og adressen settes når lagringen er ferdig (Safari på iPad blokkerer `window.open` etter `fetch`).
- Mens PDF-en lages: «Lager PDF …», sperret, med status for skjermleser; fjernes når fanen er åpnet.
- **Uten nett:** både «Lag PDF (utkast)» og «Åpne PDF» vises, men er sperret med «Krever nett. PDF-en kan lages når du er på nett igjen.» Synkstatusen synes ved siden av. Samme oppførsel i e2e.
- **PDF-en:** universell utforming så langt motoren gir det (tagget, `nb`, tittel, lesbar kontrast, TG med både tekst og farge).

## Regler
Ingen nye fagregler. Rene funksjoner med tabelltester:
- Tomme deler og punkter gir ingen egne sider eller tomme overskrifter.
- Kostnad bare fra `costDisplayText`: intervall som «20 000–100 000 kr», «Under 20 000 kr», «Over 500 000 kr»; eget beløp som «ca. 40 000 kr» (ikke rundet av PDF-en). Hardt mellomrom som tusenskille. Tabelltest med 0, 10 000, 1 234 567, intervall og manglende verdi.
- Orddeling deler aldri tall og kronebeløp.
- **Mønsterlisten for interne koder** (testen leser hele PDF-teksten): uuid; snake_case med punktum (`wet_room.`, `\b[a-z]+_[a-z_]+\.[a-z_]+`); `tg0`–`tg3` med små bokstaver; `{`-flettefelt; `cause_criterion`-koder; `text_source`; `cost_type`- og intervallkoder (`approx`, `band`, `under_20000` …); regelkoder; sjekkens funnkoder (`mandatory_without_tg` …); `[object Object]`, `undefined`, `null`, `NaN`.
- **Plassholdere fra KI** (A466, «KI i veien»): de åtte plassholderne (`[navn]`, `[e-post]`, `[adresse]` osv., listen i koden fra «KI i veien») står aldri i PDF-teksten. Lagringen avviser dem allerede; testen sikrer mot gamle data. Holdes atskilt fra «[årstall mangler]» fra `mergeFieldsText` (T13), som er lov.

## Testsaker fra fagansvarlig (inndata → forventet i PDF-teksten)
- **T1** TG3-avvik, intervall `from_20000_to_100000` → «TG3», «20 000–100 000 kr».
- **T2** intervall `under_20000` og `over_500000` → «Under 20 000 kr», «Over 500 000 kr».
- **T3** eget beløp 40 000 → «ca. 40 000 kr»; 37 500 → «ca. 37 500 kr».
- **T4** TG3 uten kostnad → ingen kostnadstall; i utkastet «Mangler» med sjekkens tekst for `tg3_missing_cost`.
- **T5** TG2-avvik med årsak, konsekvens og to tiltak → alle med, tiltak i lagret rekkefølge.
- **T6** punkt med TG2- og TG3-avvik → punktet viser TG3.
- **T7** HMS-avvik alene → ingen TG-merke på avviket eller punktet; konsekvens og tiltak vises. Krever punktet TG, står «Ikke satt» i utkastet (fra `mandatory_without_tg`) og ingenting i PDF-en av utgivelsen.
- **T8** `wet_room.adjacent` med TGIU, eier nektet → «TGIU» og alle sju opplysningene; ingen TG2.
- **T9** TGIU på annet punkt → hva/hvorfor, risiko, hva som må til; ingen linjer om fuktkontroll eller eier.
- **T10** TG0 direkte på `wet_room.adjacent` → «TG0», ingen avviksdel.
- **T11** TG1 med beskrivelse, uten avvik → TG1 og beskrivelsen, ingen tomme overskrifter.
- **T12** punkt med `gives_tg = true`, beskrivelse og uten TG → «Ikke satt» på én linje (fra `mandatory_without_tg`); punkt helt uten innhold → bare på siden «Ikke med i PDF-en».
- **T13** avvikstekst med `{årstall}` uten verdi → «[årstall mangler]», ingen krøllparenteser.
- **T14** åpent regelforslag og ventende KI-forslag av alle tre slag (fraseforslag, språkvask, utkast til sammendrag, med merketekst i `ai_usage_log`), og `reports.summary_text` med merketekst → ingen spor i `ReportPdfData` eller PDF-teksten.
- **T15** mykt slettet avvik og TGIU → ikke med, påvirker ikke punktets TG.
- **T16** hele PDF-teksten → ingen «NS 3600»-punkt/tabell, ingen «§» i avviksdelen, ingen «antas»/«trolig», ingen faste koder, ingen KI-plassholdere.
- **T17** hull tatt uten funn, måling 12,4 vekt-% → svaret om hulltaking og «12,4» med enheten står under punktet.
- **T18** felt med `show_in_report = false` har svar med merketekst → merketeksten finnes ikke i PDF-en.
- **T19** hull ikke tatt, grunn valgt → grunnen står med etikett. Uten grunn → «Mangler» i utkastet (sjekkens tekst for `wet_or_below_ground_missing_hole`).
- **T20** TGIU uten «hva og hvorfor» → «Mangler» i utkastet. TGIU med `owner_informed` usann → ingen setning om at eier er informert.
- **T21** punkt med `gives_tg = false` og beskrivelse → ingen TG og ikke «Ikke satt».
- **T22** avvik med `kind = tg` uten valgt TG → «Ikke satt» på avviket i utkastet, og avviket teller ikke i punktets TG.
- **T23** punktets `regulation_ref` (for eksempel «§ 2-2») og `help_text` med merketekst → står ikke i PDF-en.
- **T24** (F8, tabelltest) hvert funn fra `computePublishCheck` på et kontrollpunkt eller avvik står i utkastet på samme mål med samme tekst som publiseringsskjermen, og ingen andre steder; et utkast uten funn har verken «Ikke satt», «Mangler» eller «Sjekk». Hvert punkt med `mandatory_without_tg` står enten som «Ikke satt» eller på siden «Ikke med i PDF-en».
- **T25** (F6) samme rapport gir lik PDF-tekst fra dagens data (`draft: false`) og fra snapshotet som ble lagret rett etter publisering.
- **T26** (F7) en eldre utgivelse viser sin gamle tekst, sin gamle TG og sitt selskap (fra `report_releases.company_id`) etter at rapporten er endret og publisert på nytt; to kall uten endring i adresse eller selskap gir like byte (eller lik struktur, se Akseptkriterier). Like byte kreves ikke etter endret adresse eller selskapsnavn.

## Akseptkriterier
**ADR og grensesnitt**
- [ ] ADR 0016 sammenligner minst tre motorer mot alle kravene i Omfang 1, viser målingene fra prøven kjørt fra `.next/standalone` på linux-x64 (orddeling bokmål, like byte, tid og minne), velger én med begrunnelse for ny avhengighet, og sier hvordan motoren og skriftene kommer med i zip-pakken, tak for samtidige PDF-er og tidsgrense, og hva valget betyr for iPad uten nett i 2b.
- [ ] ADR 0016 har tabellen over `ReportPdfData` mot snapshot/malversjon/utgivelsesrad/gjengivelse, kravene om leverandørkjede, avbrudd, midlertidige filer og «ingen ny KI-leverandør», og sier at taket gjelder per prosess.
- [ ] `renderReportPdf` er eneste vei til motoren; motorpakken importeres i én fil; `src/core/pdf` importerer ikke `core/ai`, `core/reports`, `core/access`, `core/files` eller `db` (lint-regel og statisk test); `node:fs` bare i `assets.node.ts`; `pdf-data.ts`, `pdf-data-build.ts`, `release-pdf.ts` og `tg-explanation.ts` importerer ikke `@/core/ai`.
- [ ] `buildReportPdfData` tar `ReportSnapshot` som inndata (F6), og T25 består.
- [ ] Motoren leser aldri klokke eller tilfeldige tall: `generatedAt` styrer datoene.

**Samme resultat**
- [ ] Samme data og profil to ganger i samme prosess, og én gang med annen `TZ` og locale, gir like byte. Kan motoren ikke det (begrunnet i ADR-en), gir de lik struktur: antall sider, sidestørrelse og retning per side, teksten per side i rekkefølge, antall bilder og skriftene; `CreationDate`, `ModDate` og dokument-id er faste.
- [ ] Testprofilen (liggende, andre farger) gir annen sidestørrelse og andre farger, men samme tekst.

**Innhold**
- [ ] PDF-en av badet fra et testoppdrag har forside, innholdsfortegnelse, TG-forklaring, kontrollpunkter, avvik med TG, årsak, konsekvens, tiltak og kostnad, TGIU og bunntekst med juridisk selskap og riktig «side x av y» på hver side (strukturtest).
- [ ] T1–T26 består.
- [ ] Svar på felt med `show_in_report = true` står med etikett, valgtekst og enhet; `show_in_report = false` aldri (A540).
- [ ] Utkastet og publiseringssjekken sier det samme (T24), og ingen egne regler for «Mangler» finnes i `pdf-data-build.ts` (gjennomgang).
- [ ] To selskaper i samme organisasjon: bunnteksten viser oppdragets selskap (navn og org.nr.). Selskap mangler: teksten om at det mangler, aldri `brand_name`.
- [ ] Endres eller arkiveres en etikett i malen etterpå, bruker PDF-en etiketten fra den låste versjonen.
- [ ] Tomme deler: rapport uten avvik, uten TGIU, uten bilder og med rom uten innhold gir riktig antall sider; delens overskrift står ikke i PDF-en eller innholdsfortegnelsen.
- [ ] Ingen side slutter med en overskrift (F2).
- [ ] Siden «Ikke med i PDF-en» finnes med `draft: true` og mangler med `draft: false` (F3).
- [ ] Utkastet har lenker til skjemaet med bare id-er; med `draft: false` har PDF-en ingen interne lenker (F4).
- [ ] Ingen interne koder etter mønsterlisten i Regler.
- [ ] Norsk orddeling virker for bokmål (test med langt ord i smal kolonne, ellers målingen i ADR-en), og deler ikke tall eller kronebeløp.
- [ ] PDF-ens egenskaper: tittel med «UTKAST» (utgivelse: med versjon, uten «UTKAST»), `lang=nb`, tagget om motoren støtter det, ingen adresse, matrikkel eller ansattnavn i Info-feltene eller XMP-pakken.

**Bilder**
- [ ] Bilder med markering i riktig rekkefølge, rett under avviket, med bildetekst; markeringen er et vektorlag (sjekk i strukturen).
- [ ] JPEG med GPS i EXIF, JPEG med XMP og PNG med `eXIf` avvises før motoren; markering med ugyldige koordinater avvises.

**Sikkerhet og lagring**
- [ ] Malinjeksjon: rapporttekst med `<script>`, `<img src=http://…>`, `img onerror`, `</style>`, CSS `url()` og `@import`, `{{ }}`, Typst `#import`/`#read(...)` og `file:///etc/passwd` står som vanlig tekst; ingen nettverkskall og ingen fillesing under gjengivelsen (forespørsler blokkeres og telles).
- [ ] «UTKAST» på hver side. Ingen nye rader i `files`, ingen nye filer i lagringsmappen eller temp-mappen (også ved feil og tidsavbrudd), og hendelsen nøyaktig én gang med bare de tillatte feltene.
- [ ] Feil fremkalt i motoren: loggen har rapport-id og feilkode; merketekster i adresse, avvikstekst og bildetekst står verken i loggen eller i svaret.
- [ ] To samtidige utkast for samme ansatt gir 429 med teksten i Omfang 6, og et utkast og en utgivelse samtidig for samme ansatt gir også én 429. Det felles taket (2 per prosess, ADR 0016) gir 429 for en tredje ansatt. Ikke innlogget, 401 og 404 tar aldri plass i taket. Tidsavbrudd stopper motoren (test med injisert klokke).
- [ ] `createKeyedLimiter` er bygd: `release()` i `finally` i begge rutene, også ved feil, tidsavbrudd, krasj i tråden og når klienten bryter forbindelsen; `staleAfterMs` over 20 sekunder.
- [ ] Arbeidstråden har `resourceLimits` (minst `maxOldGenerationSizeMb`). Krasjer tråden eller går den tom for minne, avsluttes den, ruten gir 500-siden uten motorens melding, og plassen i taket frigjøres (vist i rutetesten, ikke bare i `keyed-limiter.test.ts`).
- [ ] Fillesing vist på trådens side: filoppslaget i Typst svarer bare fra det faste kartet over skrifter, logo og bilder; `#read` eller `#import` av en sti utenfor gir feil eller tom tekst, aldri filinnhold.
- [ ] `HEAD` på begge rutene svarer 405 uten gjengivelse, uten hendelse og uten plass i taket (egen `HEAD`-eksport, enhetstest).
- [ ] Statisk test: service workeren sender aldri `/oppdrag/<id>/pdf` eller `/oppdrag/<id>/utgivelser/<id>/pdf` til `respondWith`.
- [ ] Svarhodet `Cross-Origin-Resource-Policy: same-origin`; feilsidene skriver ingen verdi fra adressen eller feilen; et forfalsket `Host`-hode endrer ikke lenkene i PDF-en.
- [ ] Ingen spørring grupperer `report.draft_pdf_created` eller `report.release_pdf_created` på `actor_id`, heller ikke statistikkspørringene som finnes i dag.
- [ ] Testen for forbudte felt dekker begge hendelsestypene: bare rapport-id, profilkode, sider, bilder, millisekunder og versjonsnummer; ingen adresse, oppdragsnummer, filnavn eller selskapsnavn.
- [ ] Feil fra `getReportDraftPdfData`, `getReleasePdfData` og `buildReportPdfData` (også databasefeil) logges uten `error.message` og stack. Feilsidene har CSP med `frame-ancestors 'none'` og `Cache-Control: no-store, private`.

**Tilgang og tenant**
- [ ] `expectTenantIsolation` for `getReportDraftPdfData` og `getReleasePdfData`; rutetester der en ansatt i organisasjon B bruker oppdrags- og utgivelses-id-en til A og får 404; en utgivelse på et annet oppdrag i samme organisasjon gir 404; testene viser at spørringene filtrerer på `grant.organizationId`.
- [ ] Rapport med status `published` gir utkast med «UTKAST» fra de låste radene; `superseded` gir 404 i `pdf-data.test.ts` og rutetesten (ikke i e2e, se runde 2).
- [ ] To PDF-er for to organisasjoner samtidig (`Promise.all`): hver har bare sitt eget merke.
- [ ] Rollematrise for `getReportDraftPdfData`, `getReleasePdfData` og rutene: takstmann, kontor, leder og admin (også bare admin-rollen, og med `access.inspectors_edit_all` av), med og uten reklamasjon på oppdraget gir samme svar; ikke innlogget gir 401 eller videresending; sluttet og uten `organization.read` avvises.
- [ ] `ReportPdfData` inneholder aldri noe fra `claims` (test).
- [ ] Myk sletting: slettet rapport, slettet oppdrag og slettet utgivelse gir 404 i begge rutene; slettet rom, kontrollpunkt, avvik, tiltak og TGIU kommer ikke med. Erstattet og ugyldig id gir 404.

**Ruten og skjermen**
- [ ] Ruten: bare `GET` (statisk sjekk: ingen `POST`, `PUT`, `PATCH` eller `DELETE` eksportert; 405 for `POST` prøves i e2e), `application/pdf`, svarhodene i Omfang 6, filnavn uten adresse, ugyldig id gir 404; service workeren mellomlagrer ikke ruten.
- [ ] E2e på PC og i iPad-størrelse: knappen på badet og på oppdraget, «Lager PDF …» med status for skjermleser, PDF i ny fane (sjekk content-type), axe uten funn, knappen dekker ikke hovedknappene.
- [ ] E2e: skriv i et felt, trykk straks; teksten står i PDF-en.
- [ ] E2e (F7): publiser badet, trykk «Åpne PDF» på utgivelsen og på skjermen etter publisering; PDF i ny fane uten «UTKAST», filnavn med versjon.
- [ ] E2e uten nett (`context.setOffline`): både «Lag PDF (utkast)» og «Åpne PDF» er sperret med «Krever nett. PDF-en kan lages når du er på nett igjen.»
- [ ] E2e leser PDF-en fra svaret (`page.waitForResponse` eller `request.get` med samme økt), ikke fra fanens innhold.
- [ ] E2e med svar 500 fra ruten: siden «PDF-en kunne ikke lages. Prøv igjen.» med «Prøv igjen».
- [ ] Utkast av badet tar under 5 sekunder i CI; millisekundene står i hendelsen.

**Utrulling**
- [ ] CI viser at motoren og skriftene kommer med i zip-bygget (`deploy-azure.yml`); røyktest etter utrulling i testmiljøet føres i testrapporten. Ingen nye Azure-ressurser. `start.sh` oppdateres om oppsettet endres.

## Avgjørelser ved uenighet (prosjektleder 18.11.2026)
- **Reklamasjon:** kortet sa «takstmann og kontor får ikke PDF av reklamasjonssak», og ux ville skjule knappen. Arkitekt og sikkerhet viser at reklamasjoner er egne rader i `claims`, at badet på skjermen ikke er sperret for slike oppdrag, og at en 404 ville røpe at saken finnes. **Valgt:** samme tilgang som skjermen, aldri reklamasjonsdata i PDF-en, samme svar med og uten reklamasjon. Regel 12 gjelder selve reklamasjonssaken, som ikke er i PDF-en. Ux punkt 4 faller bort. A531 endret.
- **`ReportPdfData` som KI-grunnlag i 2a-3:** ux og test-leder skrev det som gitt; arkitekten vil stryke det. **Valgt:** strøket som løfte. Det avgjøres med snapshotet (ADR 0015) for å unngå to «hele rapporten»-former.
- **Tomme punkter:** fagansvarlig ville vise alle punkter i utkastet med «Ikke satt»; forbedreren ville ha egen side for punkter uten innhold. **Valgt:** begge, delt: punkt med noe innhold men uten TG får «Ikke satt» på sin plass; punkt helt uten innhold står på siden «Ikke med i PDF-en». Slik ser utkastet ut som kundens PDF, og ingenting glemmes (A536).
- **Kostnadseksempel og tusenskille:** fagansvarlig har rett, «kr 10 000–50 000» finnes ikke; `costDisplayText` er eneste kilde og bruker allerede hardt mellomrom. Forbedrerens krav om at beløpet ikke deles, løses i oppsettet uten egen formatering.
- **Knapp som lenke eller knapp:** ux punkt 1 (vent på lagring) og punkt 2 (vanlig lenke) trekker hver sin vei. **Valgt:** lenke når ingenting venter; ellers fanen åpnet i samme trykk og adressen satt etter lagring.

## Avgjørelser 24.11.2026 (prosjektleder, etter forhåndsvurderingen med main flettet inn)
- **Hvilken form `buildReportPdfData` tar:** arkitekten foreslo `PublishSource`, forbedreren `ReportSnapshot`. **Valgt: snapshotet (F6).** Begge løser «én leser», men bare snapshotet gir én form for hele rapporten og gjør at utkast og utgivelse bruker samme byggefunksjon. Arkitektens krav står: lesingen går gjennom `loadPublishSource`, og ADR-en har tabellen over feltene som ikke er i snapshotet.
- **Hvor «Mangler» kommer fra:** arkitekten pekte på `computeCheckpointWarnings`, fagansvarlig og forbedreren på hele publiseringssjekken. **Valgt: `computePublishCheck`.** Bare den har sperrene for hulltaking og TGIU uten grunn (fagansvarlig punkt 3) og `mandatory_without_tg` (test-leder punkt 4); punktadvarslene er med i den. Sperrer gir «Mangler», advarsler «Sjekk» (fagansvarlig anbefalte det, ikke krav), så utkastet viser det samme som publiseringsskjermen.
- **Bildesjekken:** arkitekten foreslo `src/shared/images/`, sikkerhet `src/shared/lib`. **Valgt: `src/shared/images/`**, egen mappe fordi det blir flere bildefunksjoner i 2a-3.
- **Telleren:** ut av `src/core/pdf`, generisk i `src/shared/lib/keyed-limiter.ts` med `grant.employeeId` som nøkkel (arkitekt punkt 9, sikkerhet punkt 6).
- **Ruten:** tar oppdragets id, ikke rapportens; oppslaget til rapporten gjøres i `core/reports` (sikkerhet punkt 2). Én rute for utkast (`/oppdrag/[id]/pdf`), siden badet er hele rapporten nå.
- **Nummer i spørsmål 122:** fagansvarlig og ki-ansvarlig ville begge bruke «d». **Valgt:** 122d er svar med `show_in_report` (fag), 122e er KI-merke i kundens PDF (fag og personvern), 122f er ordlyden «Vet ikke» i kundens PDF.

## Avgjørelser 24.11.2026, runde 2 (prosjektleder, etter ny innfletting av main)
- **Nummeret på fagspørsmålet:** forbedreren foreslo 122, test-leder 114 «eller første ledige». **Valgt: 122.** 114–119 kan være tatt av brancher som ikke er sjekket; 122 er ledig på main (til 110), `testdata-del-2` (111–113) og `skriv-det-du-ser` (120–121). Ett trygt nummer er bedre enn å flytte en gang til.
- **«Nøyaktig hva kunden fikk» (sikkerhet punkt 1):** riktig. Forsiden og selskapets navn leses fra dagens rader. **Valgt:** ordlyden er rettet til «teksten og TG slik de ble publisert»; forsiden og selskapsnavnet følger dagens opplysninger til endelig PDF lagres i 2a-3. T26 krever ikke like byte etter endret adresse eller selskap. Ført som lite funn inn mot 2a-3 («Endelig rapport lagres som ferdig PDF»).
- **Uten nett (test-leder punkt 6):** én oppførsel: begge knappene er sperret med samme tekst. Lenken «Åpne PDF» som virket uten nett ville gi en feilside i ny fane, og det er verre for den ansatte enn en sperret knapp med forklaring.
- **`superseded` i e2e (test-leder punkt 7):** strøket i e2e. Ruten tar oppdragets id og finner den gjeldende rapporten, så knappen kan ikke peke på en erstattet rapport. 404 for `superseded` står i `pdf-data.test.ts` og rutetesten.
- **405 (test-leder punkt 9, sikkerhet punkt 4):** statisk sjekk for `POST`/`PUT`/`PATCH`/`DELETE`, egen `HEAD` som svarer 405 uten gjengivelse (enhetstest), og 405 for `POST` i e2e. Uten egen `HEAD` ville Next svare HEAD med GET-behandleren, lage en PDF og ta plass i taket.
- **Arbeidstråden:** får `resourceLimits` (`maxOldGenerationSizeMb`). WASM-minnet stoppes ikke av det, men en feil i JS-delen tar ikke hele serveren. Krasj og minnestopp gir 500-siden og frigjør plassen. Det felles taket på 2 deles av alle organisasjoner; det står i ADR 0016 og vurderes før selskap nummer to.
- **Hva som må avklares før produksjon (sikkerhet, merknad):** PDF-en av en utgivelse er uten «UTKAST», men TG-forklaringen er ikke godkjent av fagrådet, og spørsmål 122a og 122e er åpne. Det er greit i testmiljøet med oppdiktede data. Ført under «Trenger Ståle når han er tilbake».
- Ingen nye forbedrertillegg i runde 2: forbedrerens to punkter er rettinger av versjon og spørsmålsnummer, ikke nye funksjoner.

## Beslutninger (autonom modus, ført i `docs/09-apne-sporsmal.md`)
- **A530** Profilene er kodedata i `src/core/pdf` til «Flere PDF-utgaver» i 2a-3; med `version` og `orientation` fra første dag. Lett å endre.
- **A531 (endret 18.11.2026)** Utkast-PDF krever `organization.read`, samme sjekk som badet på skjermen. Ingen reklamasjonsdata i PDF-en, og samme svar med og uten reklamasjon. Lett å endre.
- **A532** Bildedelen prøves med oppdiktede bilder i testene til `photos` finnes; markering som vektorlag. Lett å endre.
- **A533** TG-forklaringen er egen tekst, merket «utkast, ikke godkjent av fagrådet», i `src/core/reports` (innhold, ikke profil); TG0 med «normalt». Lett å endre.
- **A534** Valg av PDF-motor (ADR 0016). Dyrt å endre.
- **A535** Filnavnet har bare oppdragsnummeret. Lett å endre.
- **A536 (endret 24.11.2026)** Utkastet viser det som mangler («Ikke satt», «Mangler», «Sjekk») og siden «Ikke med i PDF-en»; kilden er funnene fra publiseringssjekken, ikke egne regler (F8). Endelig PDF viser bare det kunden skal ha. Lett å endre.
- **A537** PDF-en viser TG per kontrollpunkt, ingen samlet TG for badet. Lett å endre (spørsmål 122a).
- **A538** Mangler oppdraget juridisk selskap, lages utkastet med teksten «Juridisk selskap mangler på oppdraget»; `brand_name` brukes aldri som juridisk selskap. Lett å endre.
- **A539** Vern mot overbelastning: én pågående PDF per ansatt, lite felles tak og tidsavbrudd (tallene i ADR 0016), 429 med forklaring. Taket er per prosess. Lett å endre.
- **A540 (ny 24.11.2026)** Alle svar på felt med `show_in_report = true` står i PDF-en med etikett, valgtekst og enhet; `show_in_report = false` aldri. Lett å endre (spørsmål 122d).
- **A541 (ny 24.11.2026)** Utkast kan lages også av en publisert rapport (med «UTKAST», fra de låste radene); `superseded` gir 404. Hver utgivelse kan åpnes som PDF fra snapshotet, uten UTKAST, med `generatedAt` = publiseringstidspunktet, uten lagring (F7). Lett å endre.
- **A542 (ny 24.11.2026)** PDF-en viser ingen KI-merking i 2a-2, og `ReportPdfData` tar ikke med `ai_usage_id` eller `text_source`. Lett å endre (spørsmål 122e).
- **A600 (ny 24.11.2026, overtakelsen kl. 21 UTC)** KI-plassholdere i gamle tekster tas ut av PDF-en, også av en utgivelse; «[årstall mangler]» står. Lett å endre.
- **A601 (ny 24.11.2026)** Arbeidstråden får minnegrense 256 MB; måles med 60 bilder i 2a-3. Lett å endre.
- **A602 (ny 24.11.2026)** Mangler malversjonen til en utgivelse, lages PDF-en uten svar på felt i stedet for feilside. Lett å endre.

## Roller
- **arkitekt:** ADR 0016 med prøven fra `.next/standalone`, grensesnittet, lint-regelen og utrullingen i Azure.
- **utvikler** (to i parallell etter ADR-en): (a) `src/core/pdf` med motor, profil, `assets.node.ts`, oppsett, sideskift, utkastsiden og lenkene, og bildesjekken i `src/shared/images/`; (b) `getReportDraftPdfData`, `getReleasePdfData`, `buildReportPdfData` fra snapshotet med funnene fra sjekken, TG-forklaringen, rutene, knappene og «Åpne PDF», telleren i `src/shared/lib` og hendelsene.
- **testskriver** (parallelt): struktur- og snapshottester, T1–T26, tilgangsmatrise og tenant-isolasjon, injeksjon, e2e.
- **ui-designer:** oppsettet i Byggcon-profilen (forside, avvikskort, TG-farger, bunntekst, sideskift).
- **fagansvarlig:** TG-forklaringen og T1–T26 i gjennomgangen.
- **sikkerhet-personvern:** lukket motor, GPS og EXIF, svarhoder, logging, tilgang; `/security-review` i gjennomgangen.

## Åpne spørsmål
- Spørsmål 122 i `docs/09-apne-sporsmal.md` (fag, stopper ikke bygging): (a) samlet TG for badet, (b) ordlyden for TG0 når F1 gir TG0 på eldre bad, (c) om utkastet skal vise «Ikke satt»/«Mangler», (d) alle svar med `show_in_report` eller bare hulltaking og fuktmåling, (e) om kundens PDF skal merke tekst fra KI, (f) ordlyden «Vet ikke» for skadeutsatt konstruksjon i kundens PDF. Agentene har valgt A537, A533, A536, A540 og A542 til Ståle svarer. (a) og (e) må være besvart før endelig PDF til kunde i 2a-3.
- Utseendet ser Ståle når 2a-2 er ferdig («Ståle har sett den»).
