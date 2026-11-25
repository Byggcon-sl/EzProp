# Funksjon: Gå gjennom tekstene i badet

- **Fase:** 2a-2 Hele veien først, punktet «Gå gjennom tekstene i badet» under «Fra forbedreren» (A441)
- **Modul:** kjerne (`src/core/reports`: ny serverinngang som samler feltene i badet og ny inngang som lagrer flere valg i én transaksjon; `src/core/ai`: bare bruk av `requestSuggestionBatch`, `recordDecisionIn` og evalueringssettet), felles ordmarkering i `src/shared`, skjerm under `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/`
- **Branch:** `ga-gjennom-tekstene` (bygger på `main`, etter PR #232 «KI i veien» og PR #244 «PDF av badet»)
- **Status:** utkast (prosjektlederen 25.11.2026)
- **Dato:** 25.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** hele badet språkvaskes med ett trykk og kontrolleres i én liste på et par minutter, i stedet for felt for felt (åtte til tolv «Språkvask avviket»-trykk per bad).
  - **KI i bunnen:** samme KI-funksjon (`language_polish`) brukes på hele rommet, med vask, vakter og logg per felt. KI forbereder, takstmannen kontrollerer og velger per felt.
  - **Færre reklamasjoner:** et tydelig og ensartet språk i alle tekstene før publisering, uten at TG, tall, «ikke» eller forbehold endres (vaktene i kjernen).

## Problem
Etter «KI i veien» kan takstmannen språkvaske ett avvik eller én beskrivelse om gangen. Når badet ferdigstilles på PC, må han åpne hvert avvikskort og trykke for seg. Det tar tid, og felt blir glemt, så rapporten får ujevnt språk. Lar vi være, brukes språkvasken bare på noen felt, og de dårligste tekstene (de glemte) går til kunden.

## KI i bunnen
- **Hva KI gjør fra første dag:** ett trykk på «Gå gjennom tekstene» sender alle tekstfelt i rommet som har innhold, til `language_polish` gjennom `src/core/ai`. KI foreslår en språkvasket tekst per felt. Takstmannen ser før og etter med endringene markert og velger «Bruk» eller «Behold» per felt, eller «Bruk alle uten merknad». KI setter aldri TG, lagrer aldri selv og endrer aldri et felt uten at takstmannen har valgt det.
- **Feltene som tas med:** `deviation` / `deviation_text`, `cause_text`, `consequence_text`; `deviation_measure` / `text`; `checkpoint_result` / `description_text`. Samme mål og faste koder som «KI i veien» (A350/A356). Ikke TGIU-feltene, svar på felt (`field_answer`) eller sammendraget (har egen knapp).
- **Urørte standardtekster hoppes over (A603):** et felt der teksten er nøyaktig en av malens tekster for samme felttype i rommet (samme sjekk som «Utkast»-merket, `templateTextStatusMatcher`), sendes ikke. Tomme felt (bare mellomrom) sendes ikke (T-0111).
- **Kall og logg:** serveren deler feltene i bolker på høyst `AI_BATCH_MAX_REQUESTS` og kaller `requestSuggestionBatch` per bolk. Hvert felt får eget leverandørkall, egen loggrad i `ai_usage_log` med sin `target_ref`, og vaktene (TG-vakt, tallvakt, plassholdervakt) per felt (A460). Et stoppet felt vises med grunnen; de andre kan brukes.
- **Beslutninger:** «Bruk» lagrer `accepted` (eller `edited` hvis takstmannen retter forslaget før lagring), «Behold» lagrer `rejected`, begge i samme transaksjon som teksten (`recordDecisionIn`). Lukkes listen uten valg, står forslaget uten beslutning, som i dag.
- **Ingen persondata til KI:** vasken i kjernen gjelder som for språkvask i dag. Plassholdere byttes tilbake bare i teksten til klienten (A466).
- **KI-køen i nettleseren brukes ikke** (A441, ADR 0006 del 10). Uten nett svarer knappen «Trenger nett» med forklaring.
- **Evalueringssettet:** `src/core/ai/evals/language_polish.cases.json` utvides med flerfeltseksempler fra ett bad (minst seks saker: et avvik med fire felt og tiltak, et felt med «ikke påvist», et med tall og enhet, et med forbehold som skal stå, ett der KI bytter «bør» med «må» og skal stoppes, og ett der KI legger til et tall og skal stoppes). `pnpm ai:eval language_polish` skal være grønn mot den falske leverandøren.

## Brukerhistorier
- Som **takstmann** vil jeg **språkvaske alle tekstene i badet med ett trykk** slik at **jeg kan kontrollere hele rommet i én liste før jeg publiserer**.
- Som **takstmann** vil jeg **se nøyaktig hva KI har endret i hvert felt** slik at **jeg raskt ser om meningen er den samme**.
- Som **takstmann** vil jeg **bruke alle forslagene jeg ikke har merknader til, med ett trykk** slik at **jeg bare bruker tid på de feltene der jeg er uenig**.

## Omfang
**Med:**
- **Serverinngang `reviewRoomTexts`** i `src/core/reports` (`report.edit` via `requireOrganizationAccess`): slår opp rommet og rapporten med `grant.organizationId`, krever rapport under arbeid (`draft`; publisert gir «Rapporten er publisert. Lag ny versjon for å endre.», ADR 0015 punkt 15), samler feltene over, hopper over tomme og urørte standardtekster, og kaller KI per bolk. Svar: liste per kontrollpunkt (punktets navn og rekkefølge fra malen) med felt, feltnavn, tekst før, forslag eller status (`suggestion`, `stopped` med grunn, `no_match`, `ai_off`, `ai_error`), `usageId` og `rowVersion` for raden.
- **Tak (A604):** høyst `ROOM_TEXT_REVIEW_MAX_FIELDS` = 120 felt per gjennomgang (ny konstant i `limits.ts`). Over taket: tydelig melding «Rommet har for mange tekster til én gjennomgang. Bruk språkvask per avvik.», aldri stille kutt.
- **Lagringsinngang `applyReviewedTexts`** i `src/core/reports`: tar en liste med `{ usageId, decision: "accepted" | "edited" | "rejected", text? }`, én transaksjon (`withRoomWrite`), kontrollerer for hvert valg at loggraden er `language_polish`, hører til rapporten under arbeid og at `target_ref` peker på et felt i dette rommet (A470), og lagrer teksten med samme inndatakontroll som `saveField` (lengde, plassholdersperre, elleve sifre). Er feltet endret etter gjennomgangen (`rowVersion` høyere), lagres ikke det feltet; svaret sier hvilke felt det gjelder, og de andre lagres (A605).
- **Knapp øverst på badskjermen** «Gå gjennom tekstene», bare når takstmannen har `report.edit` og rapporten er under arbeid. Ett trykk starter gjennomgangen, uten bekreftelse. Fremdrift «Går gjennom 14 tekster …» med `aria-live`.
- **Gjennomgangslisten** som panel på badskjermen (ikke ny side): gruppert per kontrollpunkt, per felt feltnavn, før og etter med ordmarkering (fjernet gjennomstreket, lagt til uthevet, med tekst for skjermleser «fjernet» / «lagt til», ikke bare farge), «Bruk», «Rett før bruk», «Behold». Stoppede felt viser grunnen («Forslaget endret TG og vises ikke» osv.) og ingen «Bruk». Øverst: «Bruk alle uten merknad (N)», som bruker alle forslag uten valg, og teller «Brukt X · Beholdt Y · Igjen Z». Angre per felt etter «Bruk» (som i «KI i veien», `undo` / `undo_and_reject`).
- **Ordmarkering:** liten funksjon i `src/shared` som sammenligner ord for ord (lengste felles delsekvens), uten ny avhengighet, med enhetstester.
- **Uten nett:** knappen står trykkbar og svarer «Trenger nett. Tekstene dine er lagret.» rett ved knappen (A439). Mister den nett mens listen er åpen, kan valg ikke lagres; «Bruk» svarer det samme, og ingenting går tapt.
- **KI av** (funksjonen slått av eller blokkert): «KI er slått av. Tekstene dine er uendret.»
- **Evalueringssettet** utvides som over.
- **Tester:** enhet (feltutvalg, urørte standardtekster, bolkdeling, taket, ordmarkering), integrasjon (tilgang, tenant-isolasjon, publisert rapport, stoppet felt, `target_ref` fra annet rom, endret felt etter gjennomgang, «Bruk alle» i én transaksjon), e2e på PC og iPad-størrelse.

**Ikke med (bevisst utelatt):**
- Gjennomgang av hele rapporten med flere rom: kommer når rapporten har flere rom (2a-3). Inngangen tar ett rom.
- Sammendraget, TGIU-feltene og svar på felt: sammendraget har egen «Lag utkast», og KI skal ikke i TGIU-feltene (A472).
- Fraseforslag (`phrase_suggest`) i gjennomgangen: bare språkvask.
- Nye tabeller, kolonner eller migreringer.
- KI-køen i nettleseren og gjennomgang uten nett (A441).
- Ny ledetekst eller ny KI-funksjon: `language_polish` brukes som den er.
- Varsel eller sperre ved publisering om tekster som ikke er gjennomgått.
- Statistikk over hvor mye som brukes eller beholdes per ansatt (spørsmål 57).
- Å slå på ekte KI-leverandør (Ståle, etter bestått evaluering og spørsmål 103).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | knappen og listen i rapporter i egen organisasjon | be om gjennomgang, bruke, rette, beholde (`report.edit`; `access.inspectors_edit_all`) |
| kontor | ikke knappen | nei |
| leder | som takstmann hvis rollen har `report.edit` | som takstmann |
| admin | alt | alt (stenges aldri ute, regel 11) |

Tilgangen sjekkes bare i `src/core/access`. Spørringer filtrerer på `grant.organizationId`. `expectTenantIsolation` på `reviewRoomTexts` og `applyReviewedTexts` (rom og loggrad fra en annen organisasjon gir «ikke funnet» og ingen KI-kall). Reklamasjonssaker berøres ikke.

## Data
- Ingen nye tabeller eller kolonner. Bruker `ai_usage_log` (én rad per felt, `feature = language_polish`, `target_ref` per felt), `deviations`, `deviation_measures` og `checkpoint_results`.
- Ny konstant `ROOM_TEXT_REVIEW_MAX_FIELDS` i `src/core/ai/limits.ts`.
- Ordlisten (`docs/05-domenemodell.md` avsnitt 8): «gjennomgang av tekstene» = `room text review`.

## Skjermer
- **PC (hovedsaken) og iPad-størrelse:** knappen i topplinjen på badskjermen; panelet åpnes over avvikslisten og kan lukkes med Esc. Tastatur: Tab gjennom feltene, Enter på «Bruk». Knapper minst 44 × 44 pt.
- **Trykk:** før, ett «Språkvask avviket» per avvik pluss ett per beskrivelse og ett «Bruk alle» per kort (typisk 10–15 trykk og mye scrolling). Etter: 2 trykk («Gå gjennom tekstene» og «Bruk alle uten merknad») pluss ett per felt med merknad. Anslag, ikke målt; e2e teller trykkene.

## Regler
Ingen nye fagregler. Vaktene i kjernen (TG-vakt, tallvakt, plassholdervakt) gjelder per felt og har testsaker fra før; flerfeltssakene i evalueringssettet legges til.

## Akseptkriterier
- [ ] Ett trykk på «Gå gjennom tekstene» gir en liste gruppert per kontrollpunkt med før og etter for hvert felt med innhold; tomme felt og urørte standardtekster fra malen er ikke med og gir ingen loggrad.
- [ ] Hvert felt har egen rad i `ai_usage_log` med riktig `target_ref`; et stoppet felt vises med grunn og kan ikke brukes, de andre kan.
- [ ] «Bruk», «Rett før bruk», «Behold», angre og «Bruk alle uten merknad» virker, og hvert valg logges som `accepted`, `edited` eller `rejected` i samme transaksjon som teksten.
- [ ] Et felt som er endret etter gjennomgangen, overskrives ikke; takstmannen får beskjed om hvilket felt.
- [ ] Endringene er markert ord for ord, og markeringen kan leses av skjermleser (ikke bare farge).
- [ ] KI endrer aldri TG; svar som nevner ny TG eller nye tall vises ikke (test mot falsk leverandør).
- [ ] Publisert rapport: knappen vises ikke, og serveren avviser kallet.
- [ ] Over 120 felt gir tydelig melding og ingen kall.
- [ ] Uten nett svarer knappen «Trenger nett. Tekstene dine er lagret.», uten kall og uten loggrad.
- [ ] Bruker i annen organisasjon får ikke tilgang, verken til rommet eller til loggrader (`expectTenantIsolation`).
- [ ] Kontor ser ikke knappen; admin kan alltid.
- [ ] `pnpm ai:eval language_polish` er grønn med flerfeltssakene.
- [ ] E2e på PC og iPad-størrelse: gjennomgang, «Bruk alle uten merknad», ett «Behold», ett stoppet felt, og uten nett.
- [ ] Ingen nye avhengigheter.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A603 (lett å endre):** urørte standardtekster fra malen sendes ikke til språkvask; samme sjekk som «Utkast»-merket. Kilde: planpunktet; fag 3 i «KI i veien» (malens tekster er allerede gjennomarbeidet).
- **A604 (lett å endre):** tak på 120 felt per gjennomgang, delt i bolker på `AI_BATCH_MAX_REQUESTS`. Et stort bad har sjelden over 40 felt. Kilde: `limits.ts`, ADR 0006-tillegget del 4.
- **A605 (lett å endre):** «Bruk alle uten merknad» lagres i én transaksjon, men et felt som er endret etter gjennomgangen, hoppes over med beskjed, mens de andre lagres. Kilde: `row_version`-mønsteret i «Badet på PC»; best for de ansatte (ingenting går tapt).
- **A606 (lett å endre):** gjennomgangen er et panel på badskjermen, ikke en egen side, slik at takstmannen ser avvikene ved siden av. Kilde: planpunktet («øverst på badskjermen»); ux i «KI i veien».

## Roller
- **ux:** panelet, ordmarkeringen, tastatur og skjermleser, uten-nett-oppførsel.
- **ki-ansvarlig:** flerfeltssakene i evalueringssettet og at vaktene gjelder per felt.
- **sikkerhet-personvern:** kontrollen av loggrad og `target_ref` i lagringsinngangen, og at ingenting nytt går til KI.
- **utvikler** og **testskriver** i parallell, i to biter: (1) kjernen (`reviewRoomTexts`, `applyReviewedTexts`, taket, evalueringssettet); (2) skjermen og ordmarkeringen, som bygger på kjernens typer i `src/core/reports/types.ts`.

## Åpne spørsmål
Ingen som stopper oppgaven. Spørsmål 103 (vakt mot bortfalt nektelse) gjelder også her før ekte KI slås på.
