# Funksjon: Levende forhåndsvisning av badet på PC

- **Fase:** 2a-2 Hele veien først, «Fra forbedreren», punktet «Levende forhåndsvisning av rapporten» (bygges etter «ADR: valg av PDF-motor», levert i PR #244).
- **Modul:** kjerne. Gjengivelsen til sider i `src/core/pdf` (rent blad, ADR 0016), dataene fra `getReportDraftPdfData` i `src/core/reports` (uendret leser). Ruten og skjermdelen under `src/app/(ansatt)/oppdrag/[id]/`.
- **Branch:** `levende-forhandsvisning` (bygger på `main`, versjon 0.20.1).
- **Status:** klar til bygging etter forhåndsvurdering runde 1 (forbedrer, arkitekt, ux-ansvarlig, ki-ansvarlig, sikkerhet-personvern, test-leder).
- **Dato:** 25.11.2026.
- **Beslutninger:** A603–A612 i `docs/09-apne-sporsmal.md`. A603–A609 sjekket som ledige 25.11.2026 av fire roller (main og åpne brancher bruker høyst A602). A610–A612 er nye etter runde 1. Utvikleren sjekker numrene på nytt rett før commit, og prosjektlederen rett før merge.
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen ser siden slik kunden og megleren får den mens hun skriver, uten å trykke «Lag PDF (utkast)», åpne en ny fane og lete etter avsnittet. Klikk i siden fører rett til feltet. «Neste mangel» tar henne gjennom alt som er galt, med ett trykk per punkt.
  - **Færre reklamasjoner:** feil som bare synes i den ferdige siden (avvik uten konsekvens, «Ikke satt», manglende kostnad, rar orddeling, tekst som blir for lang) ses mens rapporten skrives, ikke etter at den er sendt.
  - **KI i bunnen:** ventende KI-forslag vises i margen ved avsnittet de gjelder, i KI-tonen «hav», fra samme kilde som publiseringssjekken. Sidekartet er en stabil kobling fra avsnitt til felt-id som senere KI (for eksempel «Les som kjøperen») bygger på. Ingen KI i selve gjengivelsen.

## Problem
I dag må takstmannen trykke «Lag PDF (utkast)», vente, åpne PDF-en i en ny fane og finne igjen avsnittet for å se hvordan en endring blir. Det gjør hun sjelden, og feil som bare synes i den ferdige siden oppdages for sent. Lar vi være, blir PDF-utkastet en kontroll på slutten i stedet for et verktøy mens hun skriver.

Før: skriv i feltet → «Lag PDF (utkast)» → vent → ny fane → bla til avsnittet → tilbake til skjemaet → finn feltet (5 handlinger og et fanebytte, 30–60 s per kontroll). Etter: skriv i feltet → lagret → ruten viser ny side på riktig avsnitt (0 handlinger). Rette fra siden: 1 klikk. Anslag 2–4 min spart per rapport. IVIT har ingen slik visning.

## KI i bunnen
- **KI gjør ingenting i gjengivelsen.** Samme data og profil gir samme sider. Ingen kall til `src/core/ai`, ingen rad i `ai_usage_log`, 0 kr, ikke noe nytt evalueringssett. Statisk test: ruten, de nye filene i `src/core/pdf` og skjermdelen for forhåndsvisningen importerer ikke `@/core/ai`.
- **Ventende KI-forslag i margen (A607):** kilden er den samme som publiseringssjekken (`pendingAiSuggestions` i `src/core/reports`, som `publiser/ai-fields.ts` og `ai-target.ts` bruker), ikke tilstanden badskjermen har lastet. Det margen viser, er det publiseringen advarer om. Forslagene hentes gjennom `src/core/reports`, ikke `src/core/ai`, og sendes i JSON-svaret med bare `aiUsageId`, anker og funksjonskode, aldri forslagstekst.
  - Én ren funksjon fra forslagets mål (rom, punkt eller avvik, felt) til anker. Test: hver feltkode som kan få KI-forslag, har et anker. Mangler det, festes merkelappen til punktets anker; ingen forslag blir usynlige.
  - Merkelappen har teksten «KI-forslag venter» og `aria-label` med funksjon og felt (for eksempel «KI-forslag venter: språkvask, årsak»). Farge alene er ikke nok.
  - Klikk fører til forslaget i skjemaet, der takstmannen godtar, endrer eller avviser som før, og det logges som før.
  - Forslagsteksten går aldri inn i `ReportPdfData` eller sidene (T14 fra PDF-oppgaven står).
- **Data for KI:** ingen nye. Sidekartet er avledet, lagres ikke, og har bare id-er og faste koder (test), slik at det senere trygt kan brukes som inndata til KI.
- **Senere:** «Les som kjøperen» (eget planpunkt fra forbedreren) setter KI-spørsmål i margen via samme ankere. Med motoren i nettleseren (2b) kan visningen brukes på iPad uten nett.

## Brukerhistorier
- Som **takstmann på PC** vil jeg **slå på en rute ved siden av badet som viser rapportsidene** slik at **jeg ser hvordan teksten blir mens jeg skriver**.
- Som **takstmann** vil jeg **at visningen går til siden for feltet jeg står i** slik at **jeg slipper å bla**.
- Som **takstmann** vil jeg **klikke på et avsnitt i visningen og havne i feltet** slik at **jeg retter med én handling**.
- Som **takstmann** vil jeg **gå fra mangel til mangel med ett trykk** slik at **jeg ikke må lete etter «Ikke satt» og «Mangler»**.
- Som **takstmann** vil jeg **se i margen hvor KI-forslag venter** slik at **jeg ikke sender rapporten med forslag jeg har glemt**.

## Omfang
**Med:**

1. **Bryter «Forhåndsvisning» på badskjermen (A609):** vises bare når skjermen er minst 1280 px bred **og** har mus eller styreflate (`(min-width: 1280px) and (pointer: fine)`). iPad Pro på tvers (1194 px, berøring) får ingen bryter. Ekte bryter (`role="switch"`, navn og tilstand), trykkflate minst 44 pt, i verktøylinjen øverst (hovedknapper nederst gjelder befaringen på iPad). Av som standard første gang.
   - **Plass:** når ruten er på, foldes romlisten inn til en smal stripe som kan åpnes. Skjemaet har minst 600 px; ruten får resten, og siden skaleres til rutens bredde (ingen zoomknapper). Skillet mellom skjema og rute kan dras (også med piltaster, `role="separator"` med verdi), innenfor grensene.
   - **Lagret i nettleseren:** av/på og rutens bredde i `localStorage` under én fast nøkkel uten oppdrags-, rapport- eller ansatt-id. Ingenting annet.
2. **Sidene som bilder (A603):** serveren gjengir rapporten med samme `ReportPdfData` (`getReportDraftPdfData`, `draft: true`), `PdfProfile` (profilen PDF-utkastet bruker) og samme mal som `renderReportPdf`, men til **én selvstendig SVG per side**. Sidene vises som `<img>` (aldri som innebygd SVG i DOM-en). «UTKAST» og utkastmerkene («Ikke satt», «Mangler», «Sjekk», «Ikke med i PDF-en») er med.
   - Grensesnitt i `src/core/pdf` (rent blad):
     ```ts
     export type RenderedPages = { pages: { svg: string; hash: string; widthPt: number; heightPt: number }[]; pageMap: PdfPageMapEntry[]; imageCount: number };
     export type RenderReportPages = (data: ReportPdfData, profile: PdfProfile, options: RenderReportPdfOptions) => Promise<RenderedPages>;
     export type CreateReportPagesRenderer = (engine: PdfEngine) => RenderReportPages;
     ```
     `PdfEngineJob` får `output: "pdf" | "pages"`, og `PdfEngineResult` blir en union på samme felt. `hash` er et kort fingeravtrykk (SHA-256 av SVG-en) som klienten bruker til å bytte bare sidene som er endret.
   - **Ny avhengighet (regel 9):** de to pakkene vi har, gir bare `vector` og `pdf`. SVG krever `@myriaddreamin/typst-ts-renderer`, valgfri peer-avhengighet til `typst.ts`, samme utgiver og lisens. Godtatt av arkitekten på disse vilkårene:
     - låst til nøyaktig 0.7.0 (statisk test), uten installasjonsskript, uten nett- og filtilgang;
     - lastes bare i `src/core/pdf/typst-worker.mjs` (`pdfLeaf` holder);
     - føres i `serverExternalPackages` og `outputFileTracingIncludes` i `next.config.ts`;
     - `scripts/pdf-engine-trial.mjs` og steget i `deploy-azure.yml` prøver også SVG;
     - hver side er en selvstendig SVG uten eksterne referanser, `<script>`, `on*`-attributter eller `foreignObject` (test);
     - størrelse i pakken, tid og minne måles og føres i et tillegg til ADR 0016, skrevet av arkitekten i samme PR før merge. Begrunnes i PR-en.
3. **Sidekartet kommer fra gjengivelsen (A604):**
   - **Ankrene bygges i `layout.ts`** fra `checkpointId`, `deviationId` og `elementKey` i `ReportPdfData`, ikke fra `editPath` (som er `null` i utgivelser) og ikke fra de interne tellerne `a1`, `a2`.
   - **Fast kode og variabel nøkkel holdes adskilt (regel 6).** Ankeret er en struktur; kodene står i `src/core/pdf/codes.ts`:
     ```ts
     export const PDF_PAGE_ANCHOR_KINDS = ["checkpoint", "checkpoint.description", "checkpoint.answer", "deviation", "deviation.text", "deviation.cause", "deviation.consequence", "deviation.measures", "deviation.cost", "tgiu"] as const;
     export type PdfPageAnchor = { kind: PdfPageAnchorKind; checkpointId: string; deviationId: string | null; elementKey: string | null };
     export type PdfPageMapEntry = { anchor: PdfPageAnchor; page: number; x: number; y: number; w: number; h: number; mark: PdfDraftMarkKind | null };
     ```
     `elementKey` er feltets `field_key` for `checkpoint.answer`, ellers `null`. `mark` er utkastmerkets faste kode («Ikke satt», «Mangler», «Sjekk») når avsnittet har et, ellers `null`.
   - **Avsnitt over to sider:** `pageMap` kan ha flere rader med samme anker, én per side.
   - **Plasseringen** hentes med usynlige start- og sluttmerker (samme mønster som `<pdf-card-start>`/`<pdf-card-end>`) og `world.query`. Avsnittene pakkes ikke inn i bokser for å måles (det kan flytte linje- og sideskift).
   - **Utgivelsens PDF er beviselig urørt:** merkene skrives bare når oppsettet har `pageMap: true` (bare forhåndsvisningen). Ny test med fast SHA-256 for en fast utgivelsesprøve, tatt fra main før malen endres. Ny test: samme antall sider i forhåndsvisningen som i PDF-utkastet for samme data og profil.
   - **Bare id-er og faste koder:** test med regex på hele `pageMap` (UUID, kjente koder, `field_key` med malenes tegnsett), aldri tekst.
   - **Fra anker til felt:** en ren funksjon ved siden av `pdf-anchors.ts` gir punktet som skal åpnes og nøkkelen i lagringskøen (`field-save-store.ts`). Den sjekker ankeret mot det strenge mønsteret og finner feltet ved oppslag blant skjemaets kjente felt, aldri ved å sette ankeret inn i en selector eller adresse. Ukjent, arkivert eller ondsinnet anker gir `null` (test). Knappetekstene bygges av skjemadataene i klienten.
   - **Klienten importerer aldri verdier fra `@/core/pdf`** (inngangen drar inn `server-only`). Den bruker `import type` fra `@/core/pdf` og verdier fra rene filer uten importer (`src/core/pdf/codes.ts`, `src/core/pdf/page-map.ts`). Statisk test, på linje med testen for `@/core/ai`.
4. **Hopper til feltet takstmannen står i:** når fokus flytter seg til et nytt felt (aldri mens det skrives), ruller ruten til avsnittet, men bare hvis det er utenfor synsfeltet. Avsnittet markeres med tykk ramme og et merke ved siden av (synlig uten farge). Har feltet ikke noe avsnitt, blir visningen stående. Ruten flytter aldri fokus i skjemaet. Med redusert bevegelse: ingen myk rulling og ingen animasjon.
5. **Klikk i siden setter markøren i feltet:** klikk eller Enter på et avsnitt åpner punktet og gir feltet fokus, med samme logikk som lenkene fra PDF-utkastet (F4).
   - **Tastatur (A611):** avsnittene er knapper lagt over bildet etter `pageMap` (tekst som «Gå til årsak, avvik 2 under Membran»), men ruten er **ett tabulatorstopp**: piltaster flytter mellom avsnittene (roving tabindex), Home/End til første og siste. Ruten ligger etter skjemaet i fokusrekkefølgen, og har en lenke «Hopp over forhåndsvisningen» øverst.
   - **Kan ikke endre (A610):** er feltet skrivebeskyttet (`access.inspectors_edit_all` av, eller rapporten er publisert), får feltet likevel fokus og viser at det er skrivebeskyttet, som badskjermen gjør i dag. Ingen ny sperre eller ny melding.
6. **Neste mangel (lagt til av forbedreren):** øverst i ruten står antallet, for eksempel «3 ting å se på», og knappene «Forrige» og «Neste». Rekken er avsnittene med `mark` i `pageMap` pluss ventende KI-forslag, i sidens rekkefølge. Hvert trykk ruller til avsnittet og setter markøren i feltet. Er det ingen, står «Ingenting å se på». Ingen nye data.
7. **Oppdateres under ett sekund etter lagring (A605):**
   - Når lagringskøen melder `saved` for et felt i badet, venter ruten rundt 150 ms (flere lagringer gir én kjøring), og ber så om nye sider. Endringer som kommer mens en gjengivelse pågår, slås sammen til én ny gjengivelse etterpå. Svar som kommer i feil rekkefølge, forkastes.
   - **Rolig oppdatering (lagt til av forbedreren):** klienten bytter bare sidene med ny `hash`, holder rulleposisjonen fast og blinker ikke. Avsnittet for feltet som nettopp ble lagret, markeres kort (uten animasjon ved redusert bevegelse). Flytter endringen tekst over på en ny side, sier ruten fra i `aria-live` («Teksten gikk over til side 4»).
   - **Arbeidstråden:** vi starter med én ny tråd per gjengivelse, som ADR 0016 punkt 2. Se «Avgjort ved uenighet» for hvorfor. Når målingen viser at kravet ikke nås, tas en varm tråd i bruk på vilkårene der, med målte tall i ADR-tillegget.
   - **Krav og måling:** e2e lagrer 10 ganger etter én oppvarming, måler med performance-merker fra `saved` til det nye bildet er dekodet (`img.decode()`), og feiler hvis medianen er 1000 ms eller mer. Tallet føres i PR-en og i ADR-tillegget.
8. **Ruten** `src/app/(ansatt)/oppdrag/[id]/forhandsvisning/route.ts` (bare `GET`, `HEAD` gir 405): JSON med sidene, sidekartet og ventende KI-forslag (bare id, anker, funksjonskode).
   - **Rekkefølge:** innlogging → ansatt (`findEmployeeGrant`) → forhåndsvisningens tak per ansatt → tilgang og data (`getReportDraftPdfData`, rapport fra oppdraget med `grant.organizationId`) → felles tak → gjengivelse. Taket per ansatt står før datalesingen, så automatiske kall og nye forsøk koster ikke en full lesing fra databasen (løser småfunnet fra PR #244 for denne ruten).
   - **Svar:** egne JSON-svar med fast kode og fast norsk tekst: 401 (ikke innlogget, aldri 303), 404 (annen organisasjon, slettet, erstattet, ugyldig id, ansatt som har sluttet, uten ansettelse eller roller), 413 (over taket på sider eller svarstørrelse), 429 med `Retry-After`, 500. Samme svarhoder som PDF-ruten (`Cache-Control: no-store, private`, `nosniff`, `same-origin`). Det som er felles med PDF-rutene (taket, `errorFields`, `isNotFound`), trekkes ut av `pdf-response.ts`; PDF-rutene endrer ikke oppførsel.
   - Sidene sendes aldri fra en adresse med `image/svg+xml`; bare inni JSON. Tak på antall sider og svarstørrelse (konstanter i `codes.ts`).
   - Service workeren: ruten legges ved siden av `PDF_PATHS` i `public/sw.js`, så den alltid går til nettet (test).
9. **Tak (A606):** forhåndsvisningen har sitt eget tak på **1 pågående per prosess** (egen `createKeyedLimiter` med `maxTotal: 1`, nøkkel `preview:<employeeId>`), tatt før plassen i det felles taket på 2 (`pdfLimiter`). Da er det alltid minst én plass til PDF-ene. Konstanten står i `codes.ts`. 401 og 404 holder ikke plass etter svaret.
10. **Tilstander i ruten:** laster («Lager sidene …»), oppdateres (sidene står, med «Oppdateres …»), feil («Forhåndsvisningen kunne ikke lages.» med knappen «Prøv igjen»; skjemaet virker som før), uten nett («Forhåndsvisningen trenger nett. Skjemaet lagres som vanlig.»), **eldre enn skjemaet** («Viser sist lagrede tekst» når lagringskøen har felt som venter, er uten nett eller har feil; statusen kommer fra `field-save-store`). Statusmeldinger i et `aria-live="polite"`-område.
    - **Nye forsøk:** ved 429 og 500 prøver visningen i nettleseren igjen høyst 3 ganger med økende opphold (minst `Retry-After`), deretter feiltilstanden med «Prøv igjen». Forsøkene stopper når ruten slås av, fanen er skjult eller nettet er borte. «Oppdateres …» blir aldri stående for alltid.
    - Ved 401 og 404 tømmes ruten for sider; gamle sider blir ikke stående.
11. **Ingenting lagres (sidene har adresse og matrikkel fra forsiden):** verken sider, SVG eller sidekart lagres på serveren eller i nettleseren. SVG-en holdes bare i minnet, aldri i `localStorage`, `sessionStorage`, IndexedDB eller en mellomlagret spørring. Brukes `blob:`-adresser, kalles `URL.revokeObjectURL` når siden byttes, ruten slås av og komponenten fjernes. Statisk test: ruten og klientkoden logger ikke SVG eller sidekart.
12. **Måling uten persondata (A608):**
    - Én hendelse `report.live_preview_opened` når den ansatte slår bryteren på (ikke når siden lastes med «på» husket, ikke per gjengivelse). Den skrives av en serverhandling i badskjermens `actions.ts`: oppdragets id inn, tilgang med `findEmployeeGrant`, rapport-id og profilkode slått opp på serveren med `grant.organizationId`, aldri fra klienten, så `recordEvent`. Hendelsestypen og datatypen føres i tillatt-listen i `src/core/events/types.ts`. Egen `expectTenantIsolation` for skriveveien.
    - `recordEvent` lagrer `actor_id` som alle hendelser. Ingen visning eller statistikk teller den per person (arbeidsmiljøloven kap. 9).
    - Serverloggen per gjengivelse har bare antall sider og millisekunder, uten rapport-id. Feil logges som PDF-ruten (`errorFields`, uten `error.message`).
13. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): levende forhåndsvisning (`live preview`), sidekart (`page map`), anker (`page anchor`), sider som SVG (`RenderedPages`). Domenemodellen 4.3: ankerkodene sammen med `PdfProfile`.
14. `docs/plan/forbedrerens-tillegg.md`: raden for forhåndsvisningen og radene for tilleggene i denne oppgaven fylles inn med hvor i koden og hvordan de tas ut.
15. `package.json` 0.21.0 (minor, ny funksjon).

**Ikke med (bevisst utelatt):**
- Motoren i nettleseren og visning på iPad uten nett (2b). Ingen WASM til klienten nå.
- Hele rapporten (kommer når hele rapporten finnes i 2a-3; ruten og `hash` per side er laget for 30 sider eller mer, men viser badet nå).
- Valg av profil i ruten (2a-3, «Flere PDF-utgaver»).
- Redigering i selve siden. Klikk fører alltid til feltet i skjemaet.
- Forhåndsvisning av en utgivelse (der finnes «Åpne PDF»).
- Bilder i sidene ut over det PDF-utkastet alt viser.
- Endring av «Lag PDF (utkast)», PDF-ruten eller utgivelsens PDF.
- Ny KI-funksjon, nye KI-kall eller forslagstekst i sidene. «Les som kjøperen» er eget planpunkt.

**Senere (2a-3):** bilder blir base64 inne i SVG-en, så JSON-svaret kan bli titalls MB med bilder. Før «Bilder på PC» må forhåndsvisningen få egen grense eller nedskalerte bilder.

## Grensesnitt fra arkitekten (25.11.2026)
Utvikleren bygger mot disse. Begrunnelse og prøve står i tillegget til ADR 0016 (punkt 13–23).

- `src/core/pdf/codes.ts`: `PDF_ENGINE_OUTPUTS`, `PDF_PAGE_ANCHOR_KINDS`, `PDF_DRAFT_MARK_KINDS`, formkravene til et anker, `PDF_PAGE_HASH_LENGTH`, `PDF_PREVIEW_LIMITS`, `PDF_PREVIEW_MAX_CONCURRENT`, og feilkodene `too_many_pages` og `pages_too_large`.
- `src/core/pdf/types.ts`: `PdfPageAnchor`, `PdfPageMapEntry`, `RenderedPage`, `RenderedPages`, `RenderReportPages`, `CreateReportPagesRenderer`, `CleanPageSvg`, `IsSafePageSvg`, `BuildPdfPageMap`, `IsPdfPageAnchor`, `PdfEngineJob.output` og unionen `PdfEngineResult`.
- `src/app/(ansatt)/oppdrag/[id]/forhandsvisning/preview-contract.ts`: svaret, feilkodene, rekkefølgen i ruten, køen i nettleseren og nøkkelen i `localStorage`.
- `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/page-anchor-types.ts`: fra anker til felt, og fra KI-mål til anker.
- `src/core/events/types.ts`: `report.live_preview_opened` med `LIVE_PREVIEW_EVENT_DATA_FIELDS`.

**Avvik fra teksten over, funnet i prøven:**
- Typene for ankeret står i `types.ts` (kodene i `codes.ts`), som resten av `src/core/pdf`.
- `renderReportPages` tar `RenderReportPagesOptions` (som `RenderReportPdfOptions`, men med `PdfPagesLimits`), så taket på sider og størrelse sjekkes i gjengivelsen.
- Rendereren gir ikke selvstendige sider av seg selv, og legger alltid ved `foreignObject` og lenker. Sidene lages med en ny økt per side og ryddes og sjekkes etterpå (ADR-tillegget punkt 15 og 16). Består ikke en side sjekken, gir det `engine_failed`.
- Motoren gir rå merker (`PdfEnginePageMark`); sidekartet bygges av en ren funksjon i TypeScript, ikke i arbeidstråden.
- KI-forslaget i svaret har `featureCode` og `fieldKey` ved siden av `aiUsageId` og `anchor`.

## Tilgang
Samme som å se badet og lage PDF-utkastet (`organization.read` gjennom `getReportDraftPdfData`). Rapport-id finnes alltid fra oppdraget med `grant.organizationId`, aldri fra adressen. Ingen tilgangslogikk i ruten.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (som badet) | nei, visningen endrer ingenting |
| kontor | ja (som badet) | nei |
| leder | ja | nei |
| admin (også med bare admin-rollen) | ja | nei |

Reklamasjonsdata er aldri med. Annen organisasjon, slettet, erstattet og ugyldig id gir 404.

## Data
Ingen nye tabeller eller kolonner. Ny hendelseskode `report.live_preview_opened`. Nye faste ankerkoder (`PDF_PAGE_ANCHOR_KINDS` over), som aldri endres, bare arkiveres (regel 6). Føres i domenemodellen 4.3.

## Skjermer
- **PC (badskjermen, fra 1280 px med mus):** bryteren «Forhåndsvisning» i verktøylinjen øverst. Ruten: «Neste mangel» øverst, deretter sidene med avsnittsknapper og KI-merkelapper i margen. Romlisten foldes inn mens ruten er på.
- **iPad:** ingen endring i 2a-2.
- **Universell utforming:** ekte bryter og skille med navn og tilstand; ruten har overskrift og landemerke; ett tabulatorstopp med piltaster og lenke forbi; fokusring på avsnitt; `alt` «Side 2 av 5»; markering og KI-merkelapp synlige uten farge; virker med tastatur alene; redusert bevegelse respekteres.

## Regler
Ingen nye fagregler. Utkastmerkene kommer fra publiseringssjekken som i PDF-utkastet (ADR 0015 punkt 3).

## Avgjort ved uenighet (prosjektlederen)
- **Bredde for bryteren:** forbedrerens 1280 px og `(pointer: fine)` velges framfor ux-ansvarligs «fra `lg` når minstebredden får plass». Grunn: iPad Pro på tvers er 1194 px, så `lg` setter bryteren på iPaden, i strid med «iPad: ingen endring». Minstebredden på skjemaet blir 600 px (forbedreren), ikke 560 px, fordi romlisten foldes inn og plassen da finnes.
- **Varm tråd fra start (forbedreren) eller ny tråd per gjengivelse (arkitekt, sikkerhet):** vi starter med ny tråd per gjengivelse. ADR 0016 forkastet varm tråd fordi tilstand kunne følge med mellom organisasjoner, og det endres ikke uten målte tall. Kravet under 1 sekund står likevel, og e2e feiler om det ikke nås. Da innføres varm tråd i samme oppgave på disse vilkårene: bundet til én ansatt og én organisasjon og aldri gjenbrukt på tvers, egne inndata per jobb, samme `resourceLimits` og tidsgrense, avsluttet ved feil, tidsavbrudd, etter kort tomgang og etter et fast antall gjengivelser, og talt i taket. Føres i ADR-tillegget, og sikkerhet-personvern ser på den før merge. Forbedrerens 150 ms venting og «følg bare ved fokusbytte» tas med uansett.
- **Når hendelsen skrives:** sikkerhet-personvern («bare ved trykk på bryteren») velges framfor test-leder («én gang per innlasting»). Færre hendelser per person, og målet er å se om funksjonen tas i bruk, ikke hvor ofte den står på.
- **Logg per gjengivelse:** uten rapport-id (sikkerhet-personvern) framfor «rapport-id, sider, ms» (test-leder). Et tidsstemplet spor per lagring er i praksis et spor per takstmann.
- **Tastatur:** ux-ansvarlig ga to valg; vi tar begge delene som utfyller hverandre: ett tabulatorstopp med piltaster og en lenke forbi ruten.

## Lagt til av forbedreren
- **I oppgaven:** bryter bare fra 1280 px med mus, romlisten foldes inn, skillet kan dras og bredden huskes (Omfang 1); «Neste mangel» med teller og Forrige/Neste (Omfang 6); rolig oppdatering med `hash` per side, kort markering og melding når tekst går over til ny side (Omfang 7); 150 ms venting og følge bare ved fokusbytte (Omfang 7). Varm tråd fra start ble ikke tatt med, se over.
- **Nytt planpunkt:** «Les som kjøperen» (KI i margen) under «Fra forbedreren» i 2a-2.
- Alt føres i `docs/plan/forbedrerens-tillegg.md`. Alt tas ut ved å ta ut ruten; «Lag PDF (utkast)» står urørt.

## Akseptkriterier
- [ ] Bryteren vises i PC-størrelse med mus, slår ruten av og på, og valget og bredden huskes etter ny innlasting; `localStorage` har bare den ene faste nøkkelen (e2e).
- [ ] Bryteren vises ikke i 1194 × 834 med berøring, og badskjermen virker som før (e2e iPad-størrelse).
- [ ] Sidene viser det samme som PDF-utkastet for samme data og profil, med «UTKAST» på hver side (test: samme antall sider og samme ankere).
- [ ] Utgivelsens PDF er byte for byte uendret (fast SHA-256), og testene for like byte og visuell sammenligning av PDF-utkastet og utgivelsen er grønne.
- [ ] `pageMap` har bare id-er og faste koder (regex), og avsnitt over to sider gir én rad per side.
- [ ] Fra anker til felt: alle ankerkoder gir riktig punkt og nøkkel; ukjent, arkivert og ondsinnet anker gir `null`.
- [ ] Etter lagring viser ruten den nye teksten; median under 1000 ms over 10 lagringer etter oppvarming (e2e feiler ellers, tallet i PR-en).
- [ ] Køen: endringer slås sammen, svar i feil rekkefølge forkastes, ny gjengivelse starter først når den forrige er ferdig (enhetstest).
- [ ] Bare endrede sider byttes, rulleposisjonen står fast, og overgang til ny side meldes i `aria-live`.
- [ ] Fokus i årsak-feltet ruller ruten til avsnittet og markerer det med ramme og merke; med `reducedMotion` uten myk rulling (e2e).
- [ ] Klikk og Enter på avsnittet for årsak gir fokus i riktig felt (e2e); skrivebeskyttet felt får fokus og vises som skrivebeskyttet.
- [ ] «Neste mangel» viser riktig antall og hopper gjennom merkene og KI-forslagene i sidens rekkefølge.
- [ ] Ventende KI-forslag vises som «KI-forslag venter» i margen i tonen «hav», med `aria-label`; samme liste som publiseringssjekken; klikk fører til forslaget, der godta, endre og avvis logges som før (test mot falsk leverandør).
- [ ] Hver feltkode som kan få KI-forslag, har et anker (test).
- [ ] Forslagsteksten finnes verken i SVG-en, i `ReportPdfData` eller i JSON-svaret (test).
- [ ] Ingen KI-kall: statisk test, og mange kall til ruten gir 0 nye rader i `ai_usage_log` med falsk leverandør aktiv.
- [ ] Ingenting lagres: radantall i alle tabeller uendret utenom hendelsen, ingen nye midlertidige filer, heller ikke ved feil (test).
- [ ] SVG-en er bare `<img>` (ingen `svg`-element i DOM-en for siden), har ingen `<script>`, `on*`, `foreignObject` eller ekstern `href`, og `<script>`, `{{ }}` og `#import` i rapporttekst står som tekst (test).
- [ ] Annen organisasjon får 404 og ingen sider (`expectTenantIsolation` på ruten og på serverhandlingen for hendelsen).
- [ ] 404 for slettet og erstattet rapport, ugyldig id, sluttet ansatt, uten ansettelse og uten roller; slettede punkter og avvik finnes verken i sidene eller i `pageMap`; ingen reklamasjonsdata.
- [ ] Takstmann, kontor, leder og admin (også bare admin-rollen) får sider.
- [ ] Ikke innlogget gir 401 som JSON med fast tekst; `HEAD` gir 405; svarhodene som PDF-ruten; feiltekster uten verdier fra adressen; loggen uten `error.message` og uten rapport-id per gjengivelse.
- [ ] Taket: forhåndsvisning og «Lag PDF (utkast)» samtidig gir 200 på begge; to forhåndsvisninger samtidig gir én 429; to forhåndsvisninger kan aldri fylle det felles taket; 401 og 404 holder ikke plass.
- [ ] 429 og feil gir «Oppdateres …» og høyst 3 nye forsøk, deretter feiltekst med «Prøv igjen», aldri en feilside (e2e).
- [ ] Uten nett (`setOffline`): norsk melding, skjemaet lagrer fortsatt, og «Viser sist lagrede tekst» vises når et felt står i kø (e2e).
- [ ] Tab fra siste felt i skjemaet gir ett stopp i ruten (eller lenken forbi), ikke mange avsnittsknapper (e2e).
- [ ] Hendelsen skrives nøyaktig én gang per trykk på bryteren, med bare tillatte felt, og aldri ved 404, 429 eller feil.
- [ ] Service workeren mellomlagrer ikke ruten (test).
- [ ] Rendereren er låst til 0.7.0, lastes bare i arbeidstråden, og klienten importerer ingen verdier fra `@/core/pdf` (statiske tester); `pdfLeaf` holder.
- [ ] Universell utforming: axe uten funn på badskjermen med ruten på; hele veien med tastatur (e2e i PC-størrelse).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## Åpne spørsmål
Ingen som stopper bygging. Beslutningene føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte»):
- **A603** SVG per side som `<img>` fra serveren. Dyrt å endre (2b bygger på det).
- **A604** Sidekartet fra samme kjøring av motoren, ankeret som struktur med faste koder. Dyrt å endre (faste koder).
- **A605** Under ett sekund målt i e2e; 150 ms venting og sammenslåing; ny tråd per gjengivelse først, varm tråd bare med målte tall og vilkårene over. Lett å endre.
- **A606** Eget tak på 1 for forhåndsvisningen før datalesingen, i tillegg til det felles taket på 2. Lett å endre.
- **A607** Ventende KI-forslag fra publiseringssjekkens kilde som merkelapp i margen, uten forslagstekst. Lett å endre.
- **A608** Én hendelse ved trykk på bryteren; logg per gjengivelse uten rapport-id. Lett å endre.
- **A609** Bryteren fra 1280 px med mus, romlisten foldes inn, av som standard, valget og bredden i nettleseren. Lett å endre.
- **A610** Klikk til et felt man ikke kan endre gir fokus i skrivebeskyttet felt, ingen ny sperre. Lett å endre.
- **A611** Ruten er ett tabulatorstopp med piltaster og lenke forbi. Lett å endre.
- **A612** Forhåndsvisningen svarer med egne JSON-feil (401, 404, 413, 429, 500) og tak på sider og svarstørrelse. Lett å endre.
