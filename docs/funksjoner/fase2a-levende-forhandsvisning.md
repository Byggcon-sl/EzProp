# Funksjon: Levende forhåndsvisning av badet på PC

- **Fase:** 2a-2 Hele veien først, «Fra forbedreren», punktet «Levende forhåndsvisning av rapporten» (bygges etter «ADR: valg av PDF-motor», levert i PR #244).
- **Modul:** kjerne. Gjengivelsen til sider i `src/core/pdf` (rent blad, ADR 0016), dataene fra `getReportDraftPdfData` i `src/core/reports` (uendret leser). Ruten og skjermdelen under `src/app/(ansatt)/oppdrag/[id]/`.
- **Branch:** `levende-forhandsvisning` (bygger på `main`, versjon 0.20.1).
- **Status:** utkast til forhåndsvurdering.
- **Dato:** 25.11.2026.
- **Beslutninger:** A603–A609 i `docs/09-apne-sporsmal.md` (A603 er neste ledige i main; åpne brancher bruker høyst A602, sjekket 25.11.2026).
- **Støtter hovedmål:**
  - **De ansatte:** takstmannen ser siden slik kunden og megleren får den mens hun skriver, uten å trykke «Lag PDF (utkast)», åpne en ny fane og lete etter avsnittet. Klikk i siden fører rett til feltet.
  - **Færre reklamasjoner:** feil som bare synes i den ferdige siden (avvik uten konsekvens, «Ikke satt», manglende kostnad, rar orddeling, tekst som blir for lang) ses mens rapporten skrives, ikke etter at den er sendt.
  - **KI i bunnen:** ventende KI-forslag vises i margen ved siden av avsnittet de gjelder, i KI-tonen «hav», så takstmannen ser hva som venter på henne før rapporten går ut. Visningen bruker den samme strukturerte rapportformen (`ReportPdfData` fra snapshotet) som KI leser. Ingen KI i selve gjengivelsen.

## Problem
I dag må takstmannen trykke «Lag PDF (utkast)», vente, åpne PDF-en i en ny fane og finne igjen avsnittet for å se hvordan en endring blir. Det gjør hun sjelden, og feil som bare synes i den ferdige siden oppdages for sent. Lar vi være, blir PDF-utkastet en kontroll på slutten i stedet for et verktøy mens hun skriver.

## KI i bunnen
- **KI gjør ingenting i gjengivelsen.** Visningen er den samme rene gjengivelsen som PDF-utkastet: samme data og profil gir samme sider. Ingen kall til `src/core/ai`, ingen rad i `ai_usage_log`, 0 kr. Statisk test: ruten og de nye filene i `src/core/pdf` importerer ikke `@/core/ai`.
- **Ventende KI-forslag i margen (A607):** forslagene badskjermen allerede har lastet (fraseforslag, språkvask, regelforslag som venter), vises som en liten merkelapp «KI-forslag venter» i margen ved avsnittet de hører til, i tonen «hav» (`ai-50`, `ai-line`, `ai-900`), tydelig utenfor siden. Klikk fører til forslaget i skjemaet, der takstmannen godtar, endrer eller avviser som før (logges som før i `ai_usage_log`). Forslagsteksten går aldri inn i `ReportPdfData` eller sidene (T14 fra PDF-oppgaven står).
- **Data for KI:** ingen nye. Sidekartet er avledet og lagres ikke.
- **Senere:** med motoren i nettleseren (2b) kan samme visning brukes på iPad uten nett, og KI-forslag kan vises på samme måte der.

## Brukerhistorier
- Som **takstmann på PC** vil jeg **slå på en rute ved siden av badet som viser rapportsidene** slik at **jeg ser hvordan teksten blir mens jeg skriver**.
- Som **takstmann** vil jeg **at visningen går til siden for feltet jeg står i** slik at **jeg slipper å bla**.
- Som **takstmann** vil jeg **klikke på et avsnitt i visningen og havne i feltet** slik at **jeg retter med én handling**.
- Som **takstmann** vil jeg **se i margen hvor KI-forslag venter** slik at **jeg ikke sender rapporten med forslag jeg har glemt**.

## Omfang
**Med:**

1. **Bryter «Forhåndsvisning» på badskjermen (PC, bredde fra `lg`)**: slår ruten av og på. Valget huskes per nettleser i `localStorage` (ingen data om rapporten, bare av/på). Av som standard første gang. Ruten tar høyre del av skjermen; skjemaet får resten og er fortsatt fullt brukbart. På smalere skjerm (iPad-størrelse) vises ikke bryteren i 2a-2.
2. **Sidene som bilder (A603):** serveren gjengir rapporten med samme `ReportPdfData` (`getReportDraftPdfData`, `draft: true`), `PdfProfile` (`byggcon_standard`, eller oppdragets profil når valget finnes i 2a-3) og samme mal som `renderReportPdf`, men til **SVG per side** i stedet for PDF. Sidene vises som `<img>` (aldri som innebygd SVG i DOM-en), slik at ingenting i siden kan kjøre som skript. Stemplet «UTKAST» og utkastmerkene («Ikke satt», «Mangler», «Sjekk», siden «Ikke med i PDF-en») er med, som i utkastet.
   - Ny funksjon i grensesnittet: `renderReportPages(data, profile, options): Promise<RenderedPages>` med `pages: { svg: string; widthPt: number; heightPt: number }[]` og `pageMap` (se 3). Samme `createReportPdfRenderer`-mønster: ren del i `render.ts`, motordel i arbeidstråden.
   - SVG krever motorens renderer (`@myriaddreamin/typst-ts-renderer`, samme utgiver og lisens som motoren, låst til 0.7.0). Arkitekten bekrefter i et tillegg til ADR 0016 at den er lukket på samme måte (ingen nett, ingen filer, ingen skript i SVG-en), måler størrelsen i pakken og tiden, og begrunner avhengigheten etter regel 9. Finnes en vei uten ny avhengighet i de to pakkene vi alt har, velges den.
3. **Sidekartet kommer fra gjengivelsen (A604):** malen merker hvert avsnitt som kan rettes med et anker (`punkt-<id>`, `avvik-<id>` som i dag, og nye for avviksfeltene: tekst, årsak, konsekvens, tiltak, kostnad; punktets beskrivelse; svar på felt; TGIU). I samme kjøring spør motoren etter plasseringen (side, x, y, bredde, høyde i punkter). `pageMap` er en liste `{ anchor, page, x, y, w, h }`. Ankrene har bare id-er og faste feltkoder, aldri tekst. Ankerne endrer ikke det som vises i PDF-en; den eksisterende testen for like byte og den visuelle sammenligningen av PDF-utkastet og utgivelsen skal fortsatt holde.
   - Fra anker til felt i skjemaet: en ren funksjon ved siden av `pdf-anchors.ts` (samme mønster, utvidet med feltkode) gir punktet som skal åpnes og nøkkelen til feltet i lagringskøen (`field-save-store.ts`).
4. **Hopper til feltet takstmannen står i:** når et felt i skjemaet får fokus, ruller ruten til siden og avsnittet for feltet (fra `pageMap`) og markerer avsnittet med en tydelig ramme utenfor teksten. Har feltet ikke noe avsnitt (for eksempel et tomt svar som ikke kommer i rapporten), blir visningen stående.
5. **Klikk i siden setter markøren i feltet:** klikk på et merket avsnitt åpner punktet i skjemaet og gir feltet fokus, med samme logikk som lenkene fra PDF-utkastet (F4). Avsnittene er også knapper for tastatur og skjermleser (usynlige knapper lagt over bildet etter `pageMap`, med tekst som «Gå til årsak, avvik 2 under Membran»).
6. **Oppdateres under ett sekund etter lagring (A605):** når lagringskøen melder `saved` for et felt i badet, ber ruten om nye sider. Endringer som kommer mens en gjengivelse pågår, slås sammen til én ny gjengivelse etterpå, og eldre svar forkastes. Krav: medianen fra `saved` til nye sider vises er under 1 sekund for badet i testdataene (målt i e2e og ført i PR-en). Er kravet ikke nådd med én ny arbeidstråd per gjengivelse, vurderer arkitekten en varm tråd per ansatt med kort levetid, og fører valget i ADR 0016 (ADR-en sier at dette vurderes her).
7. **Ruten** `src/app/(ansatt)/oppdrag/[id]/forhandsvisning/route.ts` (bare `GET`, oppdragets id, `HEAD` 405): JSON med sidene og sidekartet. Samme innlogging, tilgang, 404-regler, svarhoder (`Cache-Control: no-store, private`, `nosniff`, `same-origin`), feiltekster uten verdier fra adressen, logging uten persondata og tak som PDF-ruten (`pdf-response.ts` gjenbrukes der det går). Service workeren mellomlagrer ikke ruten.
8. **Tak (A606):** forhåndsvisningen deler taket på 2 samtidige gjengivelser per prosess med PDF-ene, og har sin egen nøkkel per ansatt (`preview:<employeeId>`), så den aldri stopper «Lag PDF (utkast)» for samme ansatt. Får ruten 429, prøver ruten igjen stille etter et kort opphold og viser «Oppdateres …»; den viser aldri en feilside midt i skrivingen.
9. **Tilstander i ruten:** laster («Lager sidene …»), oppdateres (sidene står, med «Oppdateres …»), feil («Forhåndsvisningen kunne ikke lages. Prøv igjen.» med knapp; skjemaet virker som før), uten nett («Forhåndsvisningen trenger nett. Skjemaet lagres som vanlig.»). Statusmeldinger i et `aria-live="polite"`-område.
10. **Måling uten persondata (A608):** én hendelse `report.live_preview_opened` når ruten slås på (rapport-id, profilkode), ingen hendelse per gjengivelse. Varighet per gjengivelse logges bare som maskintid i serverloggen (rapport-id, antall sider, millisekunder). Aldri telt per ansatt (arbeidsmiljøloven kap. 9).
11. **Ingenting lagres:** verken sider, SVG eller sidekart lagres på serveren eller i nettleseren. Bare av/på-valget i `localStorage`.
12. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): levende forhåndsvisning (`live preview`), sidekart (`page map`), side som SVG (`RenderedPages`).
13. `docs/plan/forbedrerens-tillegg.md`: raden for forhåndsvisningen oppdateres fra «ikke bygget» til hvor i koden og hvordan den tas ut (ta ut bryteren, ruten og `renderReportPages`; «Lag PDF (utkast)» står urørt).
14. `package.json` 0.21.0 (minor, ny funksjon).

**Ikke med (bevisst utelatt):**
- Motoren i nettleseren og visning på iPad uten nett (2b). Ingen WASM til klienten nå.
- Hele rapporten (kommer når hele rapporten finnes i 2a-3; ruten er laget for det, men viser badet nå).
- Valg av profil i ruten (2a-3, «Flere PDF-utgaver»). Ruten bruker profilen PDF-utkastet bruker.
- Redigering i selve siden. Klikk fører alltid til feltet i skjemaet («Rette rapporten fra forhåndsvisningen» er et eget punkt senere).
- Forhåndsvisning av en utgivelse (der finnes «Åpne PDF»).
- Bilder i sidene ut over det PDF-utkastet alt viser (bilder på PC er 2a-3).
- Endring av «Lag PDF (utkast)», PDF-ruten eller utgivelsens PDF, utover ankrene i malen som ikke synes.
- Ny KI-funksjon, nye KI-kall eller forslagstekst i sidene.

## Tilgang
Samme som å se badet og lage PDF-utkastet (`organization.read` gjennom `getReportDraftPdfData`). Rapport-id finnes alltid fra oppdraget med `grant.organizationId`, aldri fra adressen.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (som badet) | nei, visningen endrer ingenting |
| kontor | ja (som badet) | nei |
| leder | ja | nei |
| admin | ja | nei |

Reklamasjonsdata er aldri med (som PDF-utkastet). Annen organisasjon, slettet, erstattet og ugyldig id gir 404.

## Data
Ingen nye tabeller eller kolonner. Ny hendelseskode `report.live_preview_opened`. Nye faste ankerkoder for avsnitt i malen (`deviation.cause`, `deviation.consequence`, `deviation.measures`, `deviation.cost`, `deviation.text`, `checkpoint.description`, `checkpoint.answer.<field_key>`, `tgiu`), som aldri endres, bare arkiveres (regel 6). Føres i domenemodellen 4.3 sammen med `PdfProfile`.

## Skjermer
- **PC (badskjermen):** bryteren «Forhåndsvisning» i verktøylinjen øverst. Hovedhandling i ruten: klikk på avsnitt for å gå til feltet. Før: «Lag PDF (utkast)» → ny fane → bla til avsnittet → tilbake til skjemaet (4 handlinger og et fanebytte). Etter: 0 handlinger for å se, 1 klikk for å komme til feltet.
- **iPad:** ingen endring i 2a-2.
- Universell utforming: bryteren er en ekte bryter med navn og tilstand; ruten har overskrift og landemerke; avsnittsknappene har fokusring og tekst; sidebildene har `alt` («Side 2 av 5»); ingen informasjon bare i farge; virker med tastatur alene; respekterer redusert bevegelse (ingen myk rulling).

## Regler
Ingen nye fagregler. Utkastmerkene kommer fra publiseringssjekken som i PDF-utkastet (ADR 0015 punkt 3).

## Akseptkriterier
- [ ] Bryteren slår ruten av og på ved siden av badet på PC, og valget huskes i nettleseren.
- [ ] Sidene viser det samme som PDF-utkastet for samme data og profil, med «UTKAST» (test: samme antall sider og samme ankere som PDF-en).
- [ ] Etter at et felt er lagret, viser ruten den nye teksten; median under 1 sekund for badet i testdataene (e2e, målt tall i PR-en).
- [ ] Fokus i et felt ruller ruten til avsnittet og markerer det.
- [ ] Klikk eller Enter på et avsnitt åpner punktet og gir riktig felt fokus (e2e: årsak i et avvik).
- [ ] Ventende KI-forslag vises som merkelapp i margen i tonen «hav», utenfor siden, og fører til forslaget; forslagsteksten finnes ikke i sidene (test).
- [ ] Ingen KI-kall og ingen rad i `ai_usage_log` fra ruten (statisk test og integrasjonstest).
- [ ] Ingenting lagres: ingen nye rader utenom hendelsen `report.live_preview_opened` (test).
- [ ] SVG-en vises bare som `<img>`, og tekst som ligner kode i rapporten står som tekst (test med `<script>`, `{{ }}`, `#import`).
- [ ] Ankerne endrer ikke PDF-utkastet eller utgivelsens PDF slik det vises (eksisterende tester grønne).
- [ ] Bruker i annen organisasjon får 404 og ingen sider (`expectTenantIsolation`).
- [ ] Ikke innlogget gir 401; `HEAD` gir 405; svarhodene som PDF-ruten.
- [ ] Taket: «Lag PDF (utkast)» virker mens forhåndsvisningen oppdateres for samme ansatt; 429 gir «Oppdateres …», aldri feilside.
- [ ] Feil og uten nett vises med norsk tekst, og skjemaet virker som før.
- [ ] Universell utforming: axe uten funn på badskjermen med ruten på; hele veien med tastatur (e2e i PC-størrelse).
- [ ] KI-forslag i margen kan følges til forslaget, der det godtas, endres og avvises og logges som før (test mot falsk leverandør).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; lint-regelen `pdfLeaf` holder.

## Åpne spørsmål
Ingen som stopper bygging. Beslutningene A603–A609 føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte»):
- **A603** SVG per side som `<img>` fra serveren (ikke PDF i innebygd visning, som ikke kan gi klikk til felt eller hopp til avsnitt). Dyrt å endre (2b bygger på det).
- **A604** Sidekartet med ankere per felt fra samme kjøring av motoren, med faste ankerkoder. Dyrt å endre (faste koder).
- **A605** Under ett sekund målt fra `saved`; sammenslåing av endringer; varm tråd bare hvis målingen krever det, ført i ADR 0016. Lett å endre.
- **A606** Felles tak med PDF-ene, egen nøkkel per ansatt for forhåndsvisningen. Lett å endre.
- **A607** Ventende KI-forslag som merkelapp i margen, uten forslagstekst i sidene. Lett å endre.
- **A608** Én hendelse når ruten slås på, ingen per gjengivelse. Lett å endre.
- **A609** Bryteren bare på PC (fra `lg`), av som standard, valget i `localStorage`. Lett å endre.
