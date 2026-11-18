# Funksjon: PDF-motor (ADR) og PDF-utkast av badet i Byggcons profil

- **Fase:** 2a-2 Hele veien først, punkt 4 («ADR: valg av PDF-motor, og PDF-en av badet i Byggcons profil, i ferdig kvalitet»)
- **Modul:** kjerne. Ny `src/core/pdf` er et rent blad (motoren bak eget grensesnitt, profilene, oppsettet). Rapportdataene lages i `src/core/reports` i egne filer (`pdf-data.ts`, `pdf-data-build.ts`, `tg-explanation.ts`). Knapp og rute under `src/app/(ansatt)/oppdrag/[id]/`.
- **Branch:** `pdf-motor-badet` (bygger på `main`, 50fad3e)
- **Status:** godkjent for bygging etter forhåndsvurdering runde 1 (prosjektleder 18.11.2026)
- **Dato:** 18.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** PDF-en er det kunden og megleren leser. Den viser hvert avvik med TG, årsak, konsekvens, tiltak og kostnad på samme måte hver gang, TGIU med alle opplysningene, og forklaringen av TG. Ingen interne koder, ingen tomme sider, ingen overskrift alene nederst på en side. I utkastet ser takstmannen det som mangler, før rapporten går ut.
  - **De ansatte:** ett trykk på «Lag PDF (utkast)» gir rapporten slik den blir (IVIT: tre trykk og leting i nedlastingene). Fra utkastet kommer takstmannen med ett klikk tilbake til feltet som skal rettes. Utkast fyller ikke opp arkivet.
  - **KI i bunnen:** rapportdataene samles i én strukturert modell med faste koder (`ReportPdfData`), bygget av en ren funksjon. Ingen KI i gjengivelsen; ventende KI-forslag kommer aldri med. Motoren velges også ut fra om den kan kjøre i nettleseren på iPad (2b), slik at forhåndsvisningen og senere KI-forslag i margen kan bruke samme gjengivelse.

## Problem
Badet kan fylles ut på PC (PR #224), men det finnes ingen PDF. Uten PDF kan ikke «hele veien» i 2a-2 fullføres, Ståle kan ikke se og godkjenne utseendet, og valget av PDF-motor er ikke tatt. Velges motoren feil, må alt som bygges i 2a-3 (full rapport, 50 bilder, flere profiler, liggende) bygges om. Derfor ADR først, så PDF-en av badet.

## KI i bunnen
- **KI lager aldri PDF-en og endrer aldri tekst i den.** PDF-en er en ren gjengivelse av lagrede data: samme data og samme profil gir samme fil. Ingen KI-kall i `src/core/pdf`; statisk test viser at modulen ikke importerer `src/core/ai`.
- **Strukturerte data:** `ReportPdfData` har faste koder (punkt, utfall, TG, kostnadstype, TGIU-grunn) ved siden av teksten som vises. Persondata (adresse, matrikkel) ligger bare i `cover`. Om KI i 2a-3 skal bruke denne formen eller snapshotet fra publiseringen (ADR 0015), er ikke avgjort; vi lager ikke to «hele rapporten»-former uten at det avgjøres der (arkitekt punkt 4).
- **Bare besluttet tekst:** PDF-en viser bare tekst som er lagret i rapporten. Ventende forslag i `ai_usage_log`, regelforslag som ikke er godtatt, regelbegrunnelser og kilder kommer aldri med. Hvordan godtatt KI-tekst merkes før publisering, avgjøres i «KI i veien» og «Publisering av badet» (andre brancher); denne oppgaven rører ikke det.
- **Måling:** hvert utkast gir én hendelse `report.draft_pdf_created` med bare rapport-id, profilkode, antall sider, antall bilder og millisekunder. Raden har `actor_id`, så bruken vises aldri per person (arbeidsmiljøloven kap. 9), bare samlet bak `statistics.read`.

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
   - lisens, og ny avhengighet begrunnet etter regel 9.

   **Prøven:** arkitekten lager et lite prøveskript og kjører det fra `.next/standalone` på linux-x64, slik pakken rulles ut. Det måler orddeling (bokmål, smal kolonne), like byte to ganger, tid og minne for badet. Resultatene står i ADR-en. ADR-en sier hvordan motorens binærfiler og skriftene kommer med i zip-pakken (`outputFileTracingIncludes`, `serverExternalPackages`), hva som må med i `deploy-azure.yml` og `start.sh`, og om valget stenger for PDF på iPad uten nett i 2b. ADR-en sier også at `ReportPdfData` bygges av en ren funksjon, slik at det låste snapshotet (ADR 0015) kan bli kilden for endelig PDF i 2a-3.

2. **Grensesnittet** i `src/core/pdf`: `renderReportPdf(data: ReportPdfData, profile: PdfProfile, options: { draft: boolean; generatedAt: Date; appBaseUrl?: string }): Promise<RenderedPdf>` (`bytes`, `pageCount`, `imageCount`). Motoren får alt som inndata: den leser aldri klokke, tilfeldige tall, database, filtjeneste eller nett. Bilder og logo går inn som byte.
   - `src/core/pdf` er et rent blad: eier `ReportPdfData`, `PdfProfile` og `renderReportPdf`, og importerer verken `core/reports`, `core/access`, `core/files`, `core/ai` eller `db`. `core/reports` importerer bare typene (`import type`). Ny lint-regel i `eslint-rules/module-boundaries.js`, samme mønster som `reportsLogicLeaf`.
   - Motorpakken importeres i én fil (statisk test).
   - Gjengivelsen skjer i minnet, eller i en egen midlertidig mappe som slettes i `finally`, også ved feil og tidsavbrudd.
   - Motoren er et bibliotek, ikke en leverandør, og skal ikke inn i `INTEGRATION_PORTS`.

3. **Profilene som kodedata:** `PdfProfile` har `code`, `version` (fra første dag, D8 `report_profile_version`), `name`, `orientation` (`portrait` eller `landscape`), farger, skrifter, logo som fast fil (`public/brand/byggcon-logo.png`), forsideoppsett, rekkefølge på delene og bunntekst-mal. Profilen har aldri selskapsnavn eller fagtekst. `byggcon_standard` (stående) er standard og koblingen mot `client_agreements.report_profile_code` (A115). En andre profil finnes bare i testene (liggende, andre farger). Tabellen `report_profiles` og valg av profil kommer med «Flere PDF-utgaver» i 2a-3. Farger, skrifter og rekkefølge på delene føres i tabellen for `report_profiles` i `docs/05-domenemodell.md` 4.3.

4. **Rapportdataene** i `src/core/reports`, i egne filer og med én eksportlinje i `index.ts` (så fletting med `publisering-badet` og `ki-i-veien` går greit):
   - `getReportPdfData(actor, organizationId, reportId)` kaller selv `requireOrganizationAccess(..., "organization.read")` og `requireUuid`, og filtrerer alle ledd (rapport, oppdrag, bygning, etasje, rom, kontrollpunkt, avvik, tiltak, TGIU, selskap) på `grant.organizationId` og `deleted_at is null`. Selskapet hentes via oppdraget, aldri fra en id i adressen. Fremmed, slettet, erstattet (`superseded`) og ugyldig id gir samme 404.
   - `buildReportPdfData(rows)` er en ren funksjon atskilt fra databaselesingen.
   - Etiketter fra den låste malversjonen og oversettelsesfilen, aldri koder.
   - Punktets TG kommer fra `computeCheckpointTg` (høyeste TG blant avvikene, ellers `tg_direct`). `src/core/pdf` regner aldri TG, og det lages ingen samlet TG for rommet (A487).
   - Kostnad fra `costDisplayText` som eneste kilde (hardt mellomrom som tusenskille finnes allerede i `formatWholeNumber`). `cost_type = none` gir ingen kostnadslinje. `cost_text` vises når den finnes. Kostnad på TG2 vises når den er satt.
   - Tekstene går gjennom `mergeFieldsText`; manglende verdi blir «[årstall mangler]» o.l., aldri `{…}`.
   - Årsakskriteriet vises med etiketten fra `CAUSE_CRITERION_LABELS` sammen med årsaksteksten; «Annet» vises ikke alene.
   - Tiltak i lagret rekkefølge; uten tiltak ingen overskrift.
   - HMS-avvik (`kind = hms`) har ingen TG: ingen TG-merke, men konsekvens og tiltak vises. Et punkt med bare HMS-avvik har ingen TG.
   - TGIU: alle utfylte felt i `tgiu_details`, med samme regel som skjermen (hva og hvorfor, risiko, hva som må til, annen fuktkontroll og resultat, skadeutsatt konstruksjon på `wet_room.adjacent`, at eier er informert om utvidet ansvar når eier nektet hulltaking). Etiketten er «TGIU», aldri «IU».
   - **TG-forklaringen er innhold:** kodedata med tekststatus («utkast, ikke godkjent av fagrådet», A483) i `src/core/reports/tg-explanation.ts`, sendt i `ReportPdfData`. Den følger regelverk-krav.md avsnitt 2: TG0 normalt ingen avvik, tilnærmet ny og dokumentert utførelse (ordet «normalt» så F1 ikke motsies); TG1 mindre avvik og normal slitasje, eller ny uten dokumentasjon; TG2 vesentlige avvik, tegn på skade, behov for tiltak snart, eller usikker funksjon på grunn av alder; TG3 store eller alvorlige avvik, funksjonssvikt, fare for liv og helse, med kostnadsanslag; TGIU ikke undersøkt, og rapporten sier hva og hvorfor; én setning om at HMS-forhold beskrives uten TG. Egne ord, ingen henvisning til NS 3600, ingen gjetteord. Teksten tas med i gjetteord- og kopitesten. Merket «utkast» står i dataene, ikke i PDF-teksten.
   - Aldri med i `ReportPdfData`: noe fra `claims`, ventende KI-forslag, regelforslag som ikke er godtatt, regelbegrunnelser (`reasons`), kilder (`TG_LABEL_SOURCE`, regelens kilde), overstyringsgrunner, `text_source`.
   - Selskap mangler (`assignments.company_id` eller `companies.org_number` tom): utkastet lages, og bunnteksten sier «Juridisk selskap mangler på oppdraget». `organizations.brand_name` brukes aldri som juridisk selskap (A488).

5. **PDF-en av badet i Byggcons profil:**
   - **Forside:** «Tilstandsrapport», adresse og matrikkel, oppdragsnummer, befaringsdato, logoen fra profilen og selskapets navn. Ingen navn på eier, bestiller eller megler. Ingen bilder på forsiden før forsidebilde finnes (2a-3).
   - **Innholdsfortegnelse** med sidetall. Deler som ikke finnes, står ikke der.
   - **Forklaring av TG** (fra `ReportPdfData`, se 4).
   - **Badet:** romnavn og etasje, hvert kontrollpunkt med TG og beskrivelse, avvik med TG, avvikstekst, årsak, konsekvens, tiltak og kostnad, og TGIU. Deler uten innhold gir aldri egne sider eller tomme overskrifter.
   - **Bare i utkastet** (A486): et punkt med innhold men uten TG viser «Ikke satt» (`TG_NOT_SET_LABEL`) på én linje; TG2/TG3 uten årsak eller konsekvens og TG3 uten kostnad viser «Mangler» der teksten skulle stått. Dette er en ren gjengivelse, ikke en sperre (sperren hører til `publisering-badet`).
   - **Bilder med markering når den finnes:** visningskopi, bildetekst, markering som vektorlag over bildet, rett under avviket bildet hører til. Badet har ingen bilder i databasen før «Bilder på PC» (2a-3), så bildedelen prøves med oppdiktede bilder i testene. Bare JPEG og PNG kjent på innholdet (ikke filnavn), største mål i punkter, og avvisning av EXIF (også PNG `eXIf`), XMP, IPTC og kommentarfelt før motoren. Tillatt-listen for JPEG (A12) flyttes fra `src/modules/offline-trial/server/photo-storage.ts` til `src/core/files` og brukes begge steder (ikke kopi). Markeringen går inn som tall og faste former (koordinater, type, farge fra profilen), aldri som SVG eller HTML fra klienten; ugyldige koordinater avvises.
   - **Bunntekst på hver side:** juridisk selskap (navn og organisasjonsnummer fra oppdragets selskap), oppdragsnummer og «side x av y».
   - **Utkast:** «UTKAST» som vannmerke på hver side. Ingen PDF og intet innhold lagres (Ståle 16.11.2026); bare hendelsesraden (se KI i bunnen).
   - **PDF-ens egenskaper:** tittel «UTKAST – Tilstandsrapport <oppdragsnummer>», språk `nb`, tagget om motoren kan, ingen adresse, ingen ansattnavn i forfatter- eller programfeltet, faste datoer fra `generatedAt`.
   - **Sideskift** (se Lagt til av forbedreren F2).

6. **Knapp «Lag PDF (utkast)»** på badet og på oppdraget (PC), og ruten:
   - Ruten (bare `GET`) svarer `application/pdf`, `Content-Disposition: inline; filename="utkast-<oppdragsnummer>.pdf"` (nummeret bare sifre og bindestrek), `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`. Service workeren mellomlagrer ikke ruten.
   - Ved feil svarer ruten med en enkel side på norsk (ikke JSON, ikke tom fane): «PDF-en kunne ikke lages. Prøv igjen.» med knappen «Prøv igjen». Ved 404 eller manglende tilgang: «Fant ikke rapporten».
   - **Vern mot overbelastning:** høyst én pågående PDF per ansatt og et lite felles tak (verdien settes i ADR-en ut fra målingen), tidsavbrudd, grense for antall bilder og samlet størrelse inn i motoren. For mange gir 429 med «En PDF lages allerede. Vent litt og prøv igjen.»
   - Ruten kaller `getReportPdfData`, så `renderReportPdf`, så hendelsen.

7. **Tilgang** via `src/core/access`: samme som å se badet på skjermen (`organization.read`, samme sjekk som `getRoomView`). PDF-en inneholder aldri reklamasjonsdata og gir samme svar med og uten reklamasjon på oppdraget (A481, endret, se Avgjørelser).

8. **Logging uten persondata:** feil i motoren logges bare med rapport-id, profilkode og egen feilkode eller feilnavn, aldri `error.message` eller stack fra motoren (de kan sitere rapporttekst).

9. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): PDF-profil (`PdfProfile`), rapportdata for PDF (`ReportPdfData`), PDF-utkast (`draft`), TG-forklaring (`TgExplanation`). Domenemodellen 4.3: profilene er kodedata til 2a-3, med farger, skrifter, rekkefølge, `version` og `orientation`.

10. `package.json` versjon 0.18.0 (ny modul).

**Ikke med (bevisst utelatt):**
- Lagring av endelig PDF, versjonslogg og sletting bare av admin (2a-3, «Endelig rapport lagres som ferdig PDF»). `report_pdf` i filmodulen brukes ikke.
- Tabellen `report_profiles`, admin-skjerm for profiler og valg av profil (2a-3, «Flere PDF-utgaver»).
- Hele rapporten (om Byggcon, sammendrag, arealer, dokumentasjon, forutsetninger, signatur) (2a-3).
- Testutskriften med 50 bilder og kravet om under 8 MB (2a-3).
- Bildetabellen `photos`, opplasting og markering på skjermen (2a-3, «Bilder på PC»).
- Samlet TG for rommet (A487, spørsmål 92a).
- Den levende forhåndsvisningen (eget planpunkt under «Fra forbedreren»).
- Publiseringssperren (branch `publisering-badet`) og KI i veien (branch `ki-i-veien`). Ingen filer der røres; nye filer i `src/core/reports` i stedet for endringer i `types.ts`, `room-view.ts`, `reports.ts` og `write.ts`.
- PDF på iPad uten nett (2b).
- Sending av PDF på e-post.

## Lagt til av forbedreren
Ståle 14.11.2026, «Forbedreren» i `CLAUDE.md`. Ført i `docs/plan/forbedrerens-tillegg.md`.

- **F1 To nye krav i ADR-en og to målinger i prøven** (i oppgaven): kan motoren kjøre i nettleseren på iPad uten nett og lage SVG til forhåndsvisning; tagget PDF med `nb`. Prøven måler orddeling i Azure-bildet og like byte. Står i Omfang 1. Arkitekten velger, men ADR-en viser målingene. Fjernes ved å ta kravene ut av tabellen.
- **F2 Sideskift som ikke ser slurvete ut** (i oppgaven, funn 8 i `analyse-ivit-leilighetsrapport-2026-10-27.md`): et avvikskort (TG-merke, tekst, årsak, konsekvens, tiltak, kostnad) holdes samlet; er det lengre enn en side, holdes en overskrift sammen med minst to linjer. Bildene står rett under avviket. Faste kolonnebredder. Kostnaden og «TG» med tallet deles aldri over to linjer (hardt mellomrom fra `formatWholeNumber`, og kostnadsteksten settes som en udelelig enhet i motoren, uten egen formatering). Strukturtest: ingen side slutter med en overskrift. Fjernes ved å ta ut reglene for sideskift i oppsettet.
- **F3 Siden «Ikke med i PDF-en»** (i oppgaven): siste side i utkastet, med UTKAST-stempel, lister badets kontrollpunkter uten innhold (ingen TG, ingen beskrivelse, ingen avvik, ingen TGIU), med etiketter og uten koder. Finnes aldri i endelig PDF. Ren gjengivelse, ingen sperre. Fjernes ved å ta ut delen `missing` i oppsettet.
- **F4 Lenker fra utkastet til skjemaet** (i oppgaven): i utkastet lenker hvert kontrollpunkt og hvert avvik til `/oppdrag/[id]/rom/[roomId]#punkt-<checkpointId>` (avvik: `#avvik-<deviationId>`), med adressen fra `appBaseUrl`. Badet-skjermen får ankrene om de mangler. Lenkene har bare id-er. Endelig PDF har ingen interne lenker (test). Fjernes ved å sette `appBaseUrl` til tom.
- **F5 Levende forhåndsvisning** (nytt planpunkt i 2a-2 «Fra forbedreren»): bygges ikke i denne oppgaven.

## Tilgang
| Rolle | Lage utkast | Endre |
|---|---|---|
| takstmann | Ja (`organization.read`), også på oppdrag med reklamasjon (PDF-en har ingen reklamasjonsdata) | – (PDF endrer ingenting) |
| kontor | Ja (`organization.read`), som takstmann | – |
| leder | Ja | – |
| admin | Ja, alltid, også med bare admin-rollen og når `access.inspectors_edit_all` er av (regel 11) | – |
| ikke innlogget | Nei (401 eller videresending) | – |
| sluttet / uten `organization.read` | Nei (404) | – |

## Data
- **Ingen migrering.** Ingen nye tabeller eller kolonner. `tests/tenant-tables.ts` endres ikke.
- Ny hendelsestype `report.draft_pdf_created` i `src/core/events/types.ts` (og testen som teller typene, og testen for forbudte felt). `events.report_id` har ingen fremmednøkkel, så id-en tas fra oppslaget med `grant.organizationId`.
- Faste koder: profilkoden `byggcon_standard` (regel 6: endres aldri, arkiveres), `orientation` `portrait`/`landscape`, delkodene `cover`, `toc`, `tg_explanation`, `room`, `missing`.
- Ny avhengighet: motoren som ADR-en velger, begrunnet i PR-en (regel 9). Skriftene i `public/fonts` (OFL). Logo fra `public/brand/byggcon-logo.png`.

## Skjermer
Flyt: [badet] → trykk «Lag PDF (utkast)» → knappen viser «Lager PDF …» → PDF-en åpnes i ny fane → lukk fanen, og du er tilbake på badet. Ett trykk (IVIT: tre).
- **PC, badet** (`/oppdrag/[id]/rom/[roomId]`): knappen i toppen ved siden av fremdriften. Sekundær knapp (ikke hovedknappen), minst 44 pt høy, tekst og ikon. I iPad-størrelse dekker den ikke hovedknappene nederst.
- **PC, oppdraget** (`/oppdrag/[id]`): samme knapp der rapporten vises, når rapporten finnes.
- **Ulagrede endringer:** finnes felt som ikke er lagret ennå (lagres automatisk eller venter i køen), viser knappen først «Lagrer endringer …» og venter til de er lagret, før PDF-en lages.
- **Ny fane som ikke blokkeres:** uten ventende lagring er knappen en vanlig lenke (`a href` til ruten, `target="_blank"`, `rel="noopener"`). Med ventende lagring åpnes fanen i samme trykk, og adressen settes når lagringen er ferdig (Safari på iPad blokkerer `window.open` etter `fetch`).
- Mens PDF-en lages: «Lager PDF …», sperret, med status for skjermleser; fjernes når fanen er åpnet.
- **Uten nett:** knappen vises, men er sperret med «Krever nett. PDF-en kan lages når du er på nett igjen.» Synkstatusen synes ved siden av.
- **PDF-en:** universell utforming så langt motoren gir det (tagget, `nb`, tittel, lesbar kontrast, TG med både tekst og farge).

## Regler
Ingen nye fagregler. Rene funksjoner med tabelltester:
- Tomme deler og punkter gir ingen egne sider eller tomme overskrifter.
- Kostnad bare fra `costDisplayText`: intervall som «20 000–100 000 kr», «Under 20 000 kr», «Over 500 000 kr»; eget beløp som «ca. 40 000 kr» (ikke rundet av PDF-en). Hardt mellomrom som tusenskille. Tabelltest med 0, 10 000, 1 234 567, intervall og manglende verdi.
- Orddeling deler aldri tall og kronebeløp.
- **Mønsterlisten for interne koder** (testen leser hele PDF-teksten): uuid; snake_case med punktum (`wet_room.`, `\b[a-z]+_[a-z_]+\.[a-z_]+`); `tg0`–`tg3` med små bokstaver; `{`-flettefelt; `cause_criterion`-koder; `text_source`; `cost_type`- og intervallkoder (`approx`, `band`, `under_20000` …); regelkoder; `[object Object]`, `undefined`, `null`, `NaN`.

## Testsaker fra fagansvarlig (inndata → forventet i PDF-teksten)
- **T1** TG3-avvik, intervall `from_20000_to_100000` → «TG3», «20 000–100 000 kr».
- **T2** intervall `under_20000` og `over_500000` → «Under 20 000 kr», «Over 500 000 kr».
- **T3** eget beløp 40 000 → «ca. 40 000 kr»; 37 500 → «ca. 37 500 kr».
- **T4** TG3 uten kostnad → ingen kostnadstall; i utkastet «Mangler».
- **T5** TG2-avvik med årsak, konsekvens og to tiltak → alle med, tiltak i lagret rekkefølge.
- **T6** punkt med TG2- og TG3-avvik → punktet viser TG3.
- **T7** HMS-avvik alene → ingen «TG» på avviket eller punktet; konsekvens og tiltak vises.
- **T8** `wet_room.adjacent` med TGIU, eier nektet → «TGIU» og alle sju opplysningene; ingen TG2.
- **T9** TGIU på annet punkt → hva/hvorfor, risiko, hva som må til; ingen linjer om fuktkontroll eller eier.
- **T10** TG0 direkte på `wet_room.adjacent` → «TG0», ingen avviksdel.
- **T11** TG1 med beskrivelse, uten avvik → TG1 og beskrivelsen, ingen tomme overskrifter.
- **T12** punkt med beskrivelse uten TG → «Ikke satt» på én linje; punkt helt uten innhold → bare på siden «Ikke med i PDF-en».
- **T13** avvikstekst med `{årstall}` uten verdi → «[årstall mangler]», ingen krøllparenteser.
- **T14** åpent regelforslag og ventende KI-forslag (merketekst i `ai_usage_log`) → ingen spor.
- **T15** mykt slettet avvik og TGIU → ikke med, påvirker ikke punktets TG.
- **T16** hele PDF-teksten → ingen «NS 3600»-punkt/tabell, ingen «§» i avviksdelen, ingen «antas»/«trolig», ingen faste koder.

## Akseptkriterier
**ADR og grensesnitt**
- [ ] ADR 0016 sammenligner minst tre motorer mot alle kravene i Omfang 1, viser målingene fra prøven kjørt fra `.next/standalone` på linux-x64 (orddeling bokmål, like byte, tid og minne), velger én med begrunnelse for ny avhengighet, og sier hvordan motoren og skriftene kommer med i zip-pakken, tak for samtidige PDF-er og tidsgrense, og hva valget betyr for iPad uten nett i 2b.
- [ ] `renderReportPdf` er eneste vei til motoren; motorpakken importeres i én fil; `src/core/pdf` importerer ikke `core/ai`, `core/reports`, `core/access`, `core/files` eller `db` (lint-regel og statisk test).
- [ ] Motoren leser aldri klokke eller tilfeldige tall: `generatedAt` styrer datoene.

**Samme resultat**
- [ ] Samme data og profil to ganger i samme prosess, og én gang med annen `TZ` og locale, gir like byte. Kan motoren ikke det (begrunnet i ADR-en), gir de lik struktur: antall sider, sidestørrelse og retning per side, teksten per side i rekkefølge, antall bilder og skriftene; `CreationDate`, `ModDate` og dokument-id er faste.
- [ ] Testprofilen (liggende, andre farger) gir annen sidestørrelse og andre farger, men samme tekst.

**Innhold**
- [ ] PDF-en av badet fra et testoppdrag har forside, innholdsfortegnelse, TG-forklaring, kontrollpunkter, avvik med TG, årsak, konsekvens, tiltak og kostnad, TGIU og bunntekst med juridisk selskap og riktig «side x av y» på hver side (strukturtest).
- [ ] T1–T16 består.
- [ ] To selskaper i samme organisasjon: bunnteksten viser oppdragets selskap (navn og org.nr.). Selskap mangler: teksten om at det mangler, aldri `brand_name`.
- [ ] Endres eller arkiveres en etikett i malen etterpå, bruker PDF-en etiketten fra den låste versjonen.
- [ ] Tomme deler: rapport uten avvik, uten TGIU, uten bilder og med rom uten innhold gir riktig antall sider; delens overskrift står ikke i PDF-en eller innholdsfortegnelsen.
- [ ] Ingen side slutter med en overskrift (F2).
- [ ] Siden «Ikke med i PDF-en» finnes med `draft: true` og mangler med `draft: false` (F3).
- [ ] Utkastet har lenker til skjemaet med bare id-er; med `draft: false` har PDF-en ingen interne lenker (F4).
- [ ] Ingen interne koder etter mønsterlisten i Regler.
- [ ] Norsk orddeling virker for bokmål (test med langt ord i smal kolonne, ellers målingen i ADR-en), og deler ikke tall eller kronebeløp.
- [ ] PDF-ens egenskaper: tittel med «UTKAST», `lang=nb`, tagget om motoren støtter det, ingen adresse eller ansattnavn i metadata.

**Bilder**
- [ ] Bilder med markering i riktig rekkefølge, rett under avviket, med bildetekst; markeringen er et vektorlag (sjekk i strukturen).
- [ ] JPEG med GPS i EXIF, JPEG med XMP og PNG med `eXIf` avvises før motoren; markering med ugyldige koordinater avvises.

**Sikkerhet og lagring**
- [ ] Malinjeksjon: rapporttekst med `<script>`, `<img src=http://…>`, `img onerror`, `</style>`, CSS `url()` og `@import`, `{{ }}`, Typst `#import`/`#read(...)` og `file:///etc/passwd` står som vanlig tekst; ingen nettverkskall og ingen fillesing under gjengivelsen (forespørsler blokkeres og telles).
- [ ] «UTKAST» på hver side. Ingen nye rader i `files`, ingen nye filer i lagringsmappen eller temp-mappen (også ved feil og tidsavbrudd), og hendelsen nøyaktig én gang med bare de tillatte feltene.
- [ ] Feil fremkalt i motoren: loggen har rapport-id og feilkode; merketekster i adresse, avvikstekst og bildetekst står verken i loggen eller i svaret.
- [ ] To samtidige utkast for samme ansatt gir 429 med teksten i Omfang 6.

**Tilgang og tenant**
- [ ] `expectTenantIsolation` for `getReportPdfData`; rutetest der en ansatt i organisasjon B bruker rapport-id-en til A og får 404; testen viser at spørringen filtrerer på `grant.organizationId`.
- [ ] To PDF-er for to organisasjoner samtidig (`Promise.all`): hver har bare sitt eget merke.
- [ ] Rollematrise for `getReportPdfData` og ruten: takstmann, kontor, leder og admin (også bare admin-rollen, og med `access.inspectors_edit_all` av), med og uten reklamasjon på oppdraget gir samme svar; ikke innlogget gir 401 eller videresending; sluttet og uten `organization.read` avvises.
- [ ] `ReportPdfData` inneholder aldri noe fra `claims` (test).
- [ ] Myk sletting: slettet rapport gir 404; slettet rom, kontrollpunkt, avvik, tiltak og TGIU kommer ikke med. Erstattet og ugyldig id gir 404.

**Ruten og skjermen**
- [ ] Ruten: bare `GET`, `application/pdf`, svarhodene i Omfang 6, filnavn uten adresse, ugyldig id gir 404; service workeren mellomlagrer ikke ruten.
- [ ] E2e på PC og i iPad-størrelse: knappen på badet og på oppdraget, «Lager PDF …» med status for skjermleser, PDF i ny fane (sjekk content-type), axe uten funn, knappen dekker ikke hovedknappene.
- [ ] E2e: skriv i et felt, trykk straks; teksten står i PDF-en.
- [ ] E2e uten nett (`context.setOffline`): knappen er sperret med forklaringen.
- [ ] E2e med svar 500 fra ruten: siden «PDF-en kunne ikke lages. Prøv igjen.» med «Prøv igjen».
- [ ] Utkast av badet tar under 5 sekunder i CI; millisekundene står i hendelsen.

**Utrulling**
- [ ] CI viser at motoren og skriftene kommer med i zip-bygget (`deploy-azure.yml`); røyktest etter utrulling i testmiljøet føres i testrapporten. Ingen nye Azure-ressurser. `start.sh` oppdateres om oppsettet endres.

## Avgjørelser ved uenighet (prosjektleder 18.11.2026)
- **Reklamasjon:** kortet sa «takstmann og kontor får ikke PDF av reklamasjonssak», og ux ville skjule knappen. Arkitekt og sikkerhet viser at reklamasjoner er egne rader i `claims`, at badet på skjermen ikke er sperret for slike oppdrag, og at en 404 ville røpe at saken finnes. **Valgt:** samme tilgang som skjermen, aldri reklamasjonsdata i PDF-en, samme svar med og uten reklamasjon. Regel 12 gjelder selve reklamasjonssaken, som ikke er i PDF-en. Ux punkt 4 faller bort. A481 endret.
- **`ReportPdfData` som KI-grunnlag i 2a-3:** ux og test-leder skrev det som gitt; arkitekten vil stryke det. **Valgt:** strøket som løfte. Det avgjøres med snapshotet (ADR 0015) for å unngå to «hele rapporten»-former.
- **Tomme punkter:** fagansvarlig ville vise alle punkter i utkastet med «Ikke satt»; forbedreren ville ha egen side for punkter uten innhold. **Valgt:** begge, delt: punkt med noe innhold men uten TG får «Ikke satt» på sin plass; punkt helt uten innhold står på siden «Ikke med i PDF-en». Slik ser utkastet ut som kundens PDF, og ingenting glemmes (A486).
- **Kostnadseksempel og tusenskille:** fagansvarlig har rett, «kr 10 000–50 000» finnes ikke; `costDisplayText` er eneste kilde og bruker allerede hardt mellomrom. Forbedrerens krav om at beløpet ikke deles, løses i oppsettet uten egen formatering.
- **Knapp som lenke eller knapp:** ux punkt 1 (vent på lagring) og punkt 2 (vanlig lenke) trekker hver sin vei. **Valgt:** lenke når ingenting venter; ellers fanen åpnet i samme trykk og adressen satt etter lagring.

## Beslutninger (autonom modus, ført i `docs/09-apne-sporsmal.md`)
- **A480** Profilene er kodedata i `src/core/pdf` til «Flere PDF-utgaver» i 2a-3; med `version` og `orientation` fra første dag. Lett å endre.
- **A481 (endret 18.11.2026)** Utkast-PDF krever `organization.read`, samme sjekk som badet på skjermen. Ingen reklamasjonsdata i PDF-en, og samme svar med og uten reklamasjon. Lett å endre.
- **A482** Bildedelen prøves med oppdiktede bilder i testene til `photos` finnes; markering som vektorlag. Lett å endre.
- **A483** TG-forklaringen er egen tekst, merket «utkast, ikke godkjent av fagrådet», i `src/core/reports` (innhold, ikke profil); TG0 med «normalt». Lett å endre.
- **A484** Valg av PDF-motor (ADR 0016). Dyrt å endre.
- **A485** Filnavnet har bare oppdragsnummeret. Lett å endre.
- **A486** Utkastet viser det som mangler («Ikke satt», «Mangler») og siden «Ikke med i PDF-en»; endelig PDF viser bare det kunden skal ha. Lett å endre.
- **A487** PDF-en viser TG per kontrollpunkt, ingen samlet TG for badet. Lett å endre (spørsmål 92a).
- **A488** Mangler oppdraget juridisk selskap, lages utkastet med teksten «Juridisk selskap mangler på oppdraget»; `brand_name` brukes aldri som juridisk selskap. Lett å endre.
- **A489** Vern mot overbelastning: én pågående PDF per ansatt, lite felles tak og tidsavbrudd (tallene i ADR 0016), 429 med forklaring. Lett å endre.

## Roller
- **arkitekt:** ADR 0016 med prøven fra `.next/standalone`, grensesnittet, lint-regelen og utrullingen i Azure.
- **utvikler** (to i parallell etter ADR-en): (a) `src/core/pdf` med motor, profil, oppsett, sideskift, utkastsiden og lenkene; (b) `getReportPdfData`/`buildReportPdfData`, TG-forklaringen, flytting av JPEG-listen til `src/core/files`, ruten, knappene, vern mot overbelastning og hendelsen.
- **testskriver** (parallelt): struktur- og snapshottester, T1–T16, tilgangsmatrise og tenant-isolasjon, injeksjon, e2e.
- **ui-designer:** oppsettet i Byggcon-profilen (forside, avvikskort, TG-farger, bunntekst, sideskift).
- **fagansvarlig:** TG-forklaringen og T1–T16 i gjennomgangen.
- **sikkerhet-personvern:** lukket motor, GPS og EXIF, svarhoder, logging, tilgang; `/security-review` i gjennomgangen.

## Åpne spørsmål
- Spørsmål 92 i `docs/09-apne-sporsmal.md` (fag, stopper ikke bygging): (a) samlet TG for badet, (b) ordlyden for TG0 når F1 gir TG0 på eldre bad, (c) om utkastet skal vise «Ikke satt»/«Mangler». Agentene har valgt A487, A483 og A486 til Ståle svarer.
- Utseendet ser Ståle når 2a-2 er ferdig («Ståle har sett den»).
