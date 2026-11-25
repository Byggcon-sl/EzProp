# Funksjon: Gå gjennom tekstene i badet

- **Fase:** 2a-2 Hele veien først, punktet «Gå gjennom tekstene i badet» under «Fra forbedreren» (A441)
- **Modul:** kjerne (`src/core/reports`: serverinngangen `reviewRoomTexts` som samler feltene i badet, og lagringsinngangen `applyReviewedTexts` som lagrer flere valg i én transaksjon; `src/core/ai`: bare bruk av `requestSuggestionBatch`, `recordDecisionIn`, vasken og evalueringssettet), felles ordmarkering i `src/shared`, skjerm under `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/`
- **Branch:** `ga-gjennom-tekstene` (bygger på `main`, etter PR #232 «KI i veien» og PR #244 «PDF av badet»)
- **Status:** klar til bygging etter forhåndsvurdering runde 1 (prosjektlederen 25.11.2026)
- **Dato:** 25.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** hele badet språkvaskes med ett trykk og kontrolleres i én liste på et par minutter, med tastaturet, i stedet for felt for felt (åtte til tolv «Språkvask avviket»-trykk per bad). Avbryter han, fortsetter han der han slapp.
  - **KI i bunnen:** samme KI-funksjon (`language_polish`) brukes på hele rommet, med vask, vakter og logg per felt. KI forbereder, takstmannen kontrollerer og velger per felt.
  - **Færre reklamasjoner:** et tydelig og ensartet språk i alle tekstene før publisering, uten at TG, tall eller forbehold endres (vaktene i kjernen). Felt der «ikke», «bør» eller lignende er endret, må kontrolleres ett og ett, og knappen viser hvor mange nye tekster som ikke er gjennomgått.

## Problem
Etter «KI i veien» kan takstmannen språkvaske ett avvik eller én beskrivelse om gangen. Når badet ferdigstilles på PC, må han åpne hvert avvikskort og trykke for seg. Det tar tid, og felt blir glemt, så rapporten får ujevnt språk. Lar vi være, brukes språkvasken bare på noen felt, og de dårligste tekstene (de glemte) går til kunden.

## KI i bunnen
- **Hva KI gjør fra første dag:** ett trykk på «Gå gjennom tekstene» sender alle tekstfelt i rommet som har innhold, til `language_polish` gjennom `src/core/ai`. KI foreslår en språkvasket tekst per felt. Takstmannen ser før og etter med endringene markert og velger «Bruk», «Rett før bruk» eller «Behold» per felt, eller «Bruk alle uten merknad». KI setter aldri TG, lagrer aldri selv og endrer aldri et felt uten at takstmannen har valgt det.
- **Feltene som tas med:** `deviation` / `deviation_text`, `cause_text`, `consequence_text`; `deviation_measure` / `text`; `checkpoint_result` / `description_text`. Samme mål og faste koder som «KI i veien» (A350/A356). Ikke TGIU-feltene, svar på felt (`field_answer`) eller sammendraget (har egen knapp). Avvik, tiltak og punktresultat som er mykt slettet (`deleted_at` satt), tas ikke med.
- **Tekstene leses fra databasen,** aldri fra nettleseren. Skjermen lagrer det som venter i lagringskøen før kallet, slik at det er den nyeste teksten som vaskes.
- **Urørte standardtekster hoppes over (A603):** et felt der teksten er nøyaktig en av malens tekster for samme felttype i rommet (samme sjekk som «Utkast»-merket, `templateTextStatusMatcher`), sendes ikke. Tomme felt (bare mellomrom) sendes ikke (T-0111).
- **Kall og logg:** serveren deler feltene i bolker på høyst `AI_BATCH_MAX_REQUESTS` og kaller `requestSuggestionBatch` per bolk. Hvert felt får eget leverandørkall, egen loggrad i `ai_usage_log` med sin `target_ref`, og vaktene (TG-vakt, tallvakt, plassholdervakt) per felt (A460). Et stoppet felt vises med grunnen; de andre kan brukes. KI-feil (`ai_error`) i ett felt stopper ikke de andre.
- **Ingen dobbelt arbeid (A608):** en åpen `language_polish`-rad uten beslutning for samme felt gjenbrukes når feltet ikke er endret etter at raden ble laget (målradens `updated_at` er ikke nyere enn radens `created_at`). Bare nye og endrede felt sendes til KI. Forespørsels-id per felt avledes av gjennomgangs-id-en fra skjermen og feltets mål, så et dobbelttrykk eller nytt forsøk gir de samme radene og ingen nye kall.
- **Beslutninger (A607):** nettleseren sender bare valget (`use`, `edit` med tekst, `keep`, `undo`). Serveren avgjør `accepted` eller `edited` ved å sammenligne lagret tekst med forslaget (som `recordPolishDecision`, A525). Ved «Bruk» skriver serveren selv forslaget, med plassholderne byttet tilbake på serveren (vasken kjøres på nytt på den uendrede teksten for å finne de opprinnelige verdiene). «Behold» lagrer `rejected`. Beslutning og tekst lagres i samme transaksjon (`recordDecisionIn`). Lukkes listen uten valg, står forslaget uten beslutning, som i dag.
- **Merknad på skjermen (A610):** ordmarkeringen gir felt der «ikke», «ingen», «uten», «bør», «må» eller «kan» er fjernet, lagt til eller byttet, en synlig merknad, for eksempel «Sjekk: «ikke» er fjernet». Slike felt tas ikke med i «Bruk alle uten merknad». Merknaden er en fast regel på skjermen, ikke en KI-vakt og ikke en fagregel, og den stopper ikke forslaget.
- **Ingen persondata til KI:** vasken i kjernen gjelder som for språkvask i dag. Plassholdere byttes tilbake bare i teksten til klienten og i teksten serveren skriver ved «Bruk» (A466). Flere fritekster per trykk betyr at de kjente hullene i vasken («Vask før KI» i `docs/agenter/tilstand.md`) treffer oftere; de må være lukket før funksjonen slås på mot ekte KI (sammen med spørsmål 103).
- **KI-køen i nettleseren brukes ikke** (A441, ADR 0006 del 10). Uten nett svarer knappen «Trenger nett» med forklaring.
- **Evalueringssettet:** `src/core/ai/evals/language_polish.cases.json` utvides med minst seks flerfeltssaker fra ett bad, merket med gruppen `room_review`, slik at `pnpm ai:eval language_polish` viser treffet for dem for seg: et avvik med fire felt og tiltak, et felt med «ikke påvist», et med tall og enhet, et med forbehold som skal stå, ett der KI legger til et tall og skal stoppes av tallvakten, og ett der KI bytter «bør» med «må». Det siste er en **kjent sak uten vakt** (som K1.6c: `expected` null, telles ikke som bestått) og knyttes til spørsmål 103. Kjente saker uten vakt teller aldri som bestått. `pnpm ai:eval language_polish` skal være grønn mot den falske leverandøren.

## Brukerhistorier
- Som **takstmann** vil jeg **språkvaske alle tekstene i badet med ett trykk** slik at **jeg kan kontrollere hele rommet i én liste før jeg publiserer**.
- Som **takstmann** vil jeg **se nøyaktig hva KI har endret i hvert felt, og hvilket avvik og hvilken TG teksten hører til** slik at **jeg raskt ser om meningen er den samme**.
- Som **takstmann** vil jeg **bruke alle forslagene jeg ikke har merknader til, med ett trykk, og angre hele bolken med ett trykk** slik at **jeg bare bruker tid på de feltene der jeg er uenig**.
- Som **takstmann** vil jeg **kunne avbryte, rette et avvik og komme tilbake** slik at **jeg ikke mister det jeg har gått gjennom**.

## Omfang
**Med:**
- **Serverinngang `reviewRoomTexts`** i `src/core/reports` (`report.edit` via `requireOrganizationAccess`). Inndata: bare romreferansen og én gjennomgangs-id (uuid fra skjermen), med streng Zod; ingen tekst og ingen målliste fra nettleseren. Slår opp rommet og rapporten med `grant.organizationId`, krever rapport under arbeid (`draft`; publisert gir «Rapporten er publisert. Lag ny versjon for å endre.», ADR 0015 punkt 15), leser feltene fra databasen (`deleted_at is null`), hopper over tomme og urørte standardtekster, gjenbruker åpne forslag (A608) og kaller KI per bolk for resten. Svar: liste per kontrollpunkt (punktets navn, rekkefølge fra malen og TG til lesing) med felt, feltnavn, tekst før, forslag eller status (`suggestion`, `unchanged`, `stopped` med grunn, `no_match`, `ai_off`, `ai_error`), merknad (A610), `usageId` og `rowVersion` for raden.
- **Tak (A604):** høyst `ROOM_TEXT_REVIEW_MAX_FIELDS` = 120 felt per gjennomgang (ny konstant i `limits.ts`). Over taket: tydelig melding «Rommet har for mange tekster til én gjennomgang. Bruk språkvask per avvik.», aldri stille kutt, ingen kall.
- **Lagringsinngang `applyReviewedTexts`** i `src/core/reports` (`report.edit`), én transaksjon (`withRoomWrite`). Inndata: en liste med `{ usageId, choice: "use" | "edit" | "keep" | "undo", text?, rowVersion }`, med tak på `ROOM_TEXT_REVIEW_MAX_FIELDS` og streng Zod. For hvert valg:
  - Serveren slår opp loggraden med `grant.organizationId` og **utleder selv hvor teksten skrives** (tabell, rad, felt) fra `target_ref`. Nettleseren sender aldri mål.
  - Raden må være `language_polish`, samme organisasjon og rapport, målet må ligge i dette rommet (A470), `deleted_at is null` på loggraden, og `outcome = ok`. For `use`, `edit` og `keep` må `status = suggested`; for `undo` må den være `accepted` eller `edited` (tilstandsmaskinen i `record-decision.ts`). Stoppet, `no_match`, sperret eller alt avgjort rad gir avslag, også for «Rett før bruk».
  - Målraden må være levende (`deleted_at is null`). Hjelperne i `decide-ai.ts` godtar mykt slettede rader (riktig for «Angre» der), og brukes derfor ikke uendret til skriving.
  - Samme `usageId` to ganger i listen gir avslag for hele listen.
  - Teksten lagres med samme inndatakontroll som `saveField` (lengde, plassholdersperre, elleve sifre).
  - **`rowVersion` (A605):** er feltets rad endret etter gjennomgangen (høyere `row_version` enn sendt), lagres ikke det feltet; svaret sier hvilke felt det gjelder, og de andre lagres. Avvik, årsak og konsekvens ligger på samme rad: serveren regner videre fra sin egen skriving i transaksjonen, slik at felt to og tre ikke hoppes over som «endret av andre».
  - Er rapporten publisert når listen kommer (publisering mens gjennomgangen kjørte), avvises hele listen med publisert-meldingen, og ingen tekst og ingen beslutning lagres.
  - Feiler noe annet midt i listen, rulles hele transaksjonen tilbake.
- **Knapp i topplinjen på badskjermen** «Gå gjennom tekstene», bare når takstmannen har `report.edit` og rapporten er under arbeid. Ett trykk starter gjennomgangen, uten bekreftelse. Knappen er sperret mens gjennomgangen kjører. Fremdrift «Går gjennom 14 tekster …» med `aria-live`, og listen fylles bolk for bolk.
- **Antall på knappen (A614):** knappen viser hvor mange felt med innhold som er nye eller endret etter siste gjennomgang, for eksempel «Gå gjennom tekstene · 4 nye». Er alt gjennomgått: «Alle tekster gjennomgått» (knappen kan fortsatt trykkes). Er det åpne forslag igjen: «Fortsett gjennomgangen (6 igjen)». Tallet regnes ut når siden lastes, fra `ai_usage_log` (eksisterende indeks på organisasjon og rapport) og feltenes `updated_at`, uten KI-kall og uten ny kolonne. Ingen sperre og ingen advarsel ved publisering.
- **Gjennomgangslisten** som panel på badskjermen (ikke ny side, A606): på brede PC-skjermer til høyre, med avvikslisten synlig ved siden av; på iPad-størrelse over hele bredden med «Lukk» øverst. Lukkes med Esc eller «Lukk», og fokus går tilbake til knappen.
  - Gruppert per kontrollpunkt i malens rekkefølge. Hver gruppe viser TG-merket til lesing og lenken «Vis i badet», som ruller til avvikskortet og markerer det mens panelet står åpent.
  - Per felt: feltnavn, før og etter med ordmarkering (fjernet gjennomstreket, lagt til uthevet, med tekst for skjermleser «fjernet» / «lagt til», ikke bare farge), eventuell merknad (A610), og «Bruk», «Rett før bruk», «Behold».
  - «Rett før bruk» åpner tekstfeltet i panelet. Ordmarkeringen mot den opprinnelige teksten oppdateres mens han skriver.
  - Stoppede felt viser grunnen («Forslaget endret TG og vises ikke» osv.) og ingen «Bruk».
  - **Forslag uten endring (A609):** gir KI samme tekst tilbake, eller bare endrer mellomrom, vises feltet ikke med valg, men telles i en lukket linje øverst: «Allerede i orden (9)». Det krever ikke valg, telles ikke i «Igjen», og det lagres ingen beslutning.
  - **Fast nederst i panelet:** telleren «Brukt X · Beholdt Y · Igjen Z» og «Bruk alle uten merknad (N)», minst 56 pt høy. N teller bare felt med reell endring, uten merknad og uten valg; stoppede felt, felt med merknad og felt uten endring er ikke med.
  - **Angre:** per felt etter «Bruk» (`undo`, som i «KI i veien»), og én «Angre» i bekreftelsen etter «Bruk alle», som angrer hele bolken i én transaksjon (A612). Teksten før står bare i panelet og sendes tilbake til feltet; den lagres ikke andre steder.
  - **Fokus og tastatur (A611):** etter hvert valg («Bruk», «Behold», «Rett før bruk» → lagre) går fokus til neste felt som ikke er avgjort, og `aria-live` sier hvilket felt det er. Når fokus står på et felt i listen og ikke i et tekstfelt, virker snarveiene B (Bruk), H (Behold), R (Rett før bruk) og U (Angre) på det feltet. De føres i «?»-listen i `shortcuts.ts`. Tab og Enter virker som før.
  - **Ferdig:** når alle felt er avgjort, viser panelet «Alle tekster er gjennomgått» med de neste stegene: «Lag PDF (utkast)» og publiseringssjekken.
  - Lukkes panelet og åpnes igjen mens takstmannen er på siden, vises den samme listen uten nye kall. Lastes siden på nytt, gir knappen den samme listen fra de åpne forslagene (A608).
- **Ordmarkering:** liten funksjon i `src/shared` som sammenligner ord for ord (lengste felles delsekvens), uten ny avhengighet, med enhetstester. Den gir også merknaden (A610).
- **Uten nett:** knappen står trykkbar og svarer «Trenger nett. Tekstene dine er lagret.» rett ved knappen (A439), uten kall og uten loggrad. Mister appen nett mens listen er åpen, står valgene merket i panelet som «Ikke lagret ennå – trenger nett», og «Lagre valgene» sender dem med ett trykk når nettet er tilbake, gjennom `applyReviewedTexts` (A613). Valgene legges ikke i køen uten nett.
- **KI av** (funksjonen slått av eller blokkert): «KI er slått av. Tekstene dine er uendret.» Ingen tekst lagres.
- **Publiseringssjekken (A608, A609):** `pendingAiSuggestionsOf` teller bare det nyeste åpne forslaget per felt, og ikke forslag som er like teksten i feltet (mellomrom regnes ikke). Ingen forslag avvises på vegne av takstmannen.
- **Logging:** ingen før- eller ettertekst i loggeren, i feilmeldinger eller i revisjonsloggen; bare id-er, feltkoder og antall. Telleren «Brukt X · Beholdt Y · Igjen Z» lever bare på skjermen og lagres eller logges aldri per ansatt (spørsmål 57). Radene får `retain_until` som i dag, og «Behold» følger `ai.rejected_retention_years`.
- **Evalueringssettet** utvides som over.

**Ikke med (bevisst utelatt):**
- Gjennomgang av hele rapporten med flere rom: kommer når rapporten har flere rom (2a-3). Inngangen tar ett rom.
- Sammendraget, TGIU-feltene og svar på felt: sammendraget har egen «Lag utkast», og KI skal ikke i TGIU-feltene (A472).
- Fraseforslag (`phrase_suggest`) i gjennomgangen: bare språkvask.
- KI-utkast til tomme årsaker, konsekvenser og tiltak: eget planpunkt «Fyll hullene i badet» (forbedreren 25.11.2026).
- Nye tabeller, kolonner, indekser eller migreringer.
- KI-køen i nettleseren og gjennomgang uten nett (A441).
- Ny ledetekst, ny KI-funksjon eller ny vakt: `language_polish` og vaktene brukes som de er. En vakt mot «bør» → «må» og bortfalt «ikke» venter på spørsmål 103 og 105c.
- Varsel eller sperre ved publisering om tekster som ikke er gjennomgått.
- Statistikk over hvor mye som brukes eller beholdes per ansatt (spørsmål 57).
- Å slå på ekte KI-leverandør (Ståle, etter bestått evaluering og spørsmål 103).
- Nedtrekksmeny eller sveiping i listen.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | knappen og listen i rapporter i egen organisasjon (`access.inspectors_edit_all` PÅ: alle; AV: som dagens regel for `report.edit`) | be om gjennomgang, bruke, rette, beholde, angre |
| kontor | ikke knappen; serveren avviser begge inngangene | nei |
| leder | som takstmann hvis rollen har `report.edit` | som takstmann |
| admin | alt | alt (stenges aldri ute, regel 11) |

Tilgangen sjekkes bare i `src/core/access`, og på serveren for begge inngangene, ikke bare på knappen. Spørringer filtrerer på `grant.organizationId`. `expectTenantIsolation` på `reviewRoomTexts` og `applyReviewedTexts`. Rom, rapport og loggrad fra en annen organisasjon gir «ikke funnet», ingen KI-kall og ingen loggrad. Reklamasjonssaker følger dagens regel (bare leder og admin); det testes, ikke antas.

## Data
- Ingen nye tabeller, kolonner eller indekser. Bruker `ai_usage_log` (én rad per felt, `feature = language_polish`, `target_ref` per felt), `deviations`, `deviation_measures` og `checkpoint_results` (`row_version`, `updated_at`).
- Ny konstant `ROOM_TEXT_REVIEW_MAX_FIELDS` i `src/core/ai/limits.ts`.
- Evalueringsskjemaet (`src/core/ai/evals/schema.ts`) får et valgfritt felt for gruppe, slik at `room_review` kan vises for seg.
- `tests/tenant-tables.ts` er uendret (ingen ny tabell); alle-tabeller-testen skal være grønn.
- Ordlisten (`docs/05-domenemodell.md` avsnitt 8): «gjennomgang av tekstene» = `room text review`; «gjennomgangs-id» = `reviewId`.

## Skjermer
- **PC (hovedsaken) og iPad-størrelse:** knappen i topplinjen på badskjermen; panelet som beskrevet over. Knapper minst 44 × 44 pt, «Bruk alle uten merknad» minst 56 pt.
- **Flyt på PC:** knappen → «Går gjennom 14 tekster …» → panel per kontrollpunkt (TG, «Vis i badet», felt med før/etter og valg) → fast nederst telleren og «Bruk alle uten merknad (N)» → «Alle tekster er gjennomgått» → Esc/Lukk.
- **Trykk:** før, ett «Språkvask avviket» per avvik pluss ett per beskrivelse og ett «Bruk alle» per kort (typisk 10–15 trykk og mye scrolling, 8–12 minutter per bad). Etter: 2 trykk («Gå gjennom tekstene» og «Bruk alle uten merknad») pluss ett per felt med merknad, typisk 4–6 trykk og 2–4 minutter. Anslag; e2e teller trykkene.

## Regler
Ingen nye fagregler og ingen nye vakter. Vaktene i kjernen (TG-vakt, tallvakt, plassholdervakt) gjelder per felt og har testsaker fra før; flerfeltssakene i evalueringssettet legges til. Merknaden (A610) er en hjelp på skjermen, ikke en regel.

## Akseptkriterier
- [ ] Ett trykk på «Gå gjennom tekstene» gir en liste gruppert per kontrollpunkt (med TG til lesing og «Vis i badet») med før og etter for hvert felt med innhold; tomme felt, urørte standardtekster og mykt slettede avvik, tiltak og punkter er ikke med og gir ingen loggrad.
- [ ] Hvert felt har egen rad i `ai_usage_log` med riktig `target_ref`; et stoppet felt vises med grunn og kan ikke brukes, de andre kan. KI-feil i ett felt stopper ikke de andre.
- [ ] Åpnes gjennomgangen på nytt (lukk og åpne, ny lasting eller dobbelttrykk), gjenbrukes åpne forslag for felt som ikke er endret, uten nye KI-kall; bare nye og endrede felt sendes. Et forslag fra et annet rom, en annen rapport eller en annen organisasjon gjenbrukes aldri.
- [ ] Forslag uten endring (eller bare mellomrom) står i «Allerede i orden (N)», krever ikke valg og får ingen beslutning, og publiseringssjekken teller dem ikke som ventende.
- [ ] «Bruk», «Rett før bruk», «Behold», angre per felt, «Bruk alle uten merknad» og «Angre» på hele bolken virker. Serveren avgjør `accepted` eller `edited` ut fra teksten; «Bruk» lagrer nøyaktig forslaget med plassholderne byttet tilbake, og en fremmed tekst kan ikke føres som `accepted`. Hvert valg lagres i samme transaksjon som teksten.
- [ ] `applyReviewedTexts` avviser: dobbel `usageId`, en `usageId` som alt er avgjort (unntatt `undo`), rad med annen status enn `suggested` (stoppet, `no_match`, sperret, `ai_error`), annen funksjon (`summary_draft`, `phrase_suggest`), annet rom eller rapport, annen organisasjon og mykt slettet mål. Hele transaksjonen ruller tilbake, uten nye KI-kall.
- [ ] Et felt som er endret etter gjennomgangen, overskrives ikke; takstmannen får beskjed om hvilket felt, og de andre lagres. Avvik med flere felt på samme rad lagres alle.
- [ ] Publiseres rapporten mellom gjennomgang og lagring, avvises hele listen med publisert-meldingen, og ingen tekst og ingen beslutning lagres.
- [ ] Felt der «ikke», «ingen», «uten», «bør», «må» eller «kan» er fjernet, lagt til eller byttet, har merknad og er ikke med i «Bruk alle uten merknad».
- [ ] Endringene er markert ord for ord, og markeringen kan leses av skjermleser (ikke bare farge).
- [ ] KI endrer aldri TG: svar som nevner ny TG eller nye tall vises ikke (test mot falsk leverandør), og TG i `checkpoint_results` er uendret etter «Bruk alle».
- [ ] Etter et valg går fokus til neste felt som ikke er avgjort; B, H, R og U virker bare med fokus på et felt i listen, aldri i et tekstfelt, og står i «?»-listen.
- [ ] Knappen viser antall nye eller endrede felt, «Fortsett gjennomgangen (N igjen)» eller «Alle tekster gjennomgått», uten KI-kall.
- [ ] Publisert rapport: knappen vises ikke, og serveren avviser begge inngangene.
- [ ] Over 120 felt gir tydelig melding og ingen kall.
- [ ] Uten nett svarer knappen «Trenger nett. Tekstene dine er lagret.», uten kall og uten loggrad. Mister appen nett med listen åpen, står valgene som «Ikke lagret ennå – trenger nett» og lagres med «Lagre valgene» når nettet er tilbake; ingenting går tapt.
- [ ] KI av eller blokkert gir «KI er slått av. Tekstene dine er uendret.», og ingen tekst lagres.
- [ ] Bruker i annen organisasjon får ikke tilgang, verken til rommet eller til loggrader (`expectTenantIsolation` på begge inngangene).
- [ ] Kontor ser ikke knappen og avvises på serveren; admin kan alltid; `access.inspectors_edit_all` PÅ og AV og reklamasjonssak er testet.
- [ ] Ingen tekst fra feltene i loggeren, feilmeldinger eller revisjonsloggen (`src/core/reports/logging.test.ts` utvidet med begge inngangene).
- [ ] `pnpm ai:eval language_polish` er grønn med flerfeltssakene i gruppen `room_review`; den kjente saken «bør» → «må» telles ikke som bestått.
- [ ] E2e på PC og iPad-størrelse som i testplanen under.
- [ ] Ingen nye avhengigheter. Versjonen i `package.json` er økt.

## Testplan (test-leder, runde 1, med prosjektlederens rettelser)
**Enhetstester:**
- `review-fields.test.ts`: feltutvalget (med: avvik, årsak, konsekvens, tiltak, beskrivelse; ikke med: TGIU, `field_answer`, sammendraget, mykt slettede rader). Tomme felt og bare mellomrom hoppes over. Urørte standardtekster hoppes over, en rettet standardtekst er med.
- `review-batches.test.ts`: bolker ved 1, ved `AI_BATCH_MAX_REQUESTS` og ved `AI_BATCH_MAX_REQUESTS`+1. Taket: 120 felt er lov, 121 gir meldingen og ingen kall. Forespørsels-id per felt er lik for samme gjennomgangs-id og mål, og ulik ellers.
- `src/shared` `word-diff.test.ts`: like tekster, tom før eller etter, æøå, tegnsetting, ord som flyttes, bare mellomrom endret (gir «uten endring»), merknad for de seks ordene, og en lang tekst (4000 tegn) innen en tidsgrense. Utdata har tekst for skjermleser.
- Gruppering og rekkefølge per kontrollpunkt følger malen. «Bruk alle»-utvalget utelater stoppede felt, felt med merknad og felt uten endring.
- `shortcuts.test.ts`: B, H, R, U bare i panelet og aldri i tekstfelt.

**Integrasjonstester mot testdatabasen, med falsk leverandør:**
- `reviewRoomTexts`: takstmann ok, kontor nektes, admin ok, leder med og uten `report.edit`, innstillingen PÅ og AV, reklamasjonssak; `expectTenantIsolation` (rom fra annen organisasjon gir «ikke funnet», null kall, null loggrader); publisert rapport avvises; én loggrad per felt med riktig `target_ref`; ingen loggrad for felt som hoppes over; stoppet felt (TG-vakt, tallvakt) gir `stopped` med grunn; over taket ingen kall; KI av gir `ai_off`; ingen persondata i leverandørkallet; gjenbruk av åpne forslag uten nye kall, og nytt kall når feltet er endret; samme gjennomgangs-id to ganger gir ingen nye rader; rad fra annet rom eller annen organisasjon gjenbrukes aldri.
- `applyReviewedTexts`: `expectTenantIsolation` (`usageId` fra annen organisasjon); `usageId` fra annet rom eller annen rapport (A470); annen funksjon; dobbel eller alt avgjort `usageId`; rad med `stopped`, `no_match`, `ai_error`; `use` lagrer forslaget med plassholdere byttet tilbake og gir `accepted`; `edit` med tekst lik forslaget gir `accepted`, ellers `edited`; `edit` går gjennom inndatakontrollen (lengde, plassholdersperre, elleve sifre); `rowVersion`: endret felt hoppes over og nevnes, de andre lagres, og tre felt på samme avviksrad lagres alle; hele listen i én transaksjon (tvunget feil midt i gir ingen delvis lagring); mykt slettet mål; publisering i mellomtiden; TG uendret; angre per felt, angre hele bolken, og angre og avvis.
- `pendingAiSuggestionsOf`: bare nyeste åpne forslag per felt, og forslag lik teksten telles ikke.
- `logging.test.ts`: ingen feltekst i loggen fra begge inngangene.

**Evaluering:** minst seks flerfeltssaker i `room_review`; `pnpm ai:eval language_polish` grønn; den kjente saken uten vakt telles ikke som bestått.

**E2e på PC og iPad-størrelse:** gjennomgang med gruppering, TG og «Vis i badet»; ordmarkeringen synlig og med tekst for skjermleser; «Allerede i orden»; «Bruk alle uten merknad», ett «Behold», ett felt med merknad, ett stoppet felt uten «Bruk»; angre hele bolken; tastatur (Tab, Enter, Esc, B/H/R/U, fokus til neste felt og tilbake til knappen); axe uten alvorlige funn; knapper minst 44 × 44 og hovedknappen 56; trykktelling (2 trykk pluss merknadene); lukk og åpne gir samme liste uten nytt kall; antall på knappen; uten nett (`context.setOffline`): melding, ingen kall til serveren, ingen loggrad; mister nett med listen åpen: «Ikke lagret ennå», så «Lagre valgene»; publisert rapport og innlogget som kontor: knappen vises ikke.

Til slutt: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, ingen nye avhengigheter, versjonen økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A603 (lett å endre):** urørte standardtekster fra malen sendes ikke til språkvask; samme sjekk som «Utkast»-merket. Kilde: planpunktet; fag 3 i «KI i veien».
- **A604 (lett å endre):** tak på 120 felt per gjennomgang, delt i bolker på `AI_BATCH_MAX_REQUESTS`. Kilde: `limits.ts`, ADR 0006-tillegget del 4.
- **A605 (lett å endre):** lagringen skjer i én transaksjon, men et felt som er endret etter gjennomgangen, hoppes over med beskjed, mens de andre lagres. Kilde: `row_version`-mønsteret i «Badet på PC».
- **A606 (lett å endre):** gjennomgangen er et panel på badskjermen: til høyre på brede PC-skjermer, over hele bredden på iPad-størrelse. Kilde: planpunktet; ux runde 1.
- **A607 (lett å endre):** nettleseren sender bare valget; serveren avgjør `accepted` eller `edited` og skriver selv forslaget ved «Bruk». Kilde: A525; sikkerhet-personvern og test-leder runde 1.
- **A608 (lett å endre):** åpne forslag gjenbrukes for uendrede felt, forespørsels-id-ene er faste per gjennomgang og felt, og publiseringssjekken teller bare nyeste åpne forslag per felt. Ingen forslag avvises på vegne av takstmannen. Kilde: forbedreren, ux og sikkerhet-personvern runde 1.
- **A609 (lett å endre):** forslag uten endring vises samlet og lukket som «Allerede i orden (N)», uten valg og uten beslutning, og telles ikke som ventende i publiseringssjekken. Kilde: forbedreren og ux runde 1.
- **A610 (lett å endre):** merknad på skjermen når «ikke», «ingen», «uten», «bør», «må» eller «kan» er endret; slike felt er ikke med i «Bruk alle uten merknad». Ingen ny vakt før spørsmål 103 og 105c er besvart. Kilde: ki-ansvarlig runde 1; funn T-0144.
- **A611 (lett å endre):** snarveiene B, H, R og U virker bare i gjennomgangspanelet med fokus på et felt, og aldri i tekstfelt. A383 («ingen énkastsnarvei for Godta eller Avvis») gjelder fortsatt for TG- og regelforslag på badskjermen; her velger takstmannen ett bestemt felt han har foran seg. Kilde: forbedreren og ux runde 1.
- **A612 (lett å endre):** «Angre» etter «Bruk alle» angrer hele bolken i én transaksjon. Kilde: ux runde 1.
- **A613 (lett å endre):** valg som ikke kan lagres uten nett, holdes på skjermen og lagres med «Lagre valgene»; de legges ikke i køen uten nett (A441). Lastes siden på nytt før det, står forslagene åpne og kommer tilbake uten nye kall (A608). Kilde: ux runde 1.
- **A614 (lett å endre):** antall nye eller endrede tekster vises på knappen, regnet ut fra loggen og `updated_at`; ingen sperre eller advarsel ved publisering. Kilde: forbedreren runde 1.

## Avgjort ved uenighet (prosjektlederen 25.11.2026)
- **«Bør» → «må»:** kortet lovet at saken «stoppes», og test-leder ba om en integrasjonstest for en slik vakt. Vakten finnes ikke, og en ny vakt er en fagbeslutning (spørsmål 103 og 105c). Ki-ansvarlig har rett: saken føres som kjent sak uten vakt, og risikoen ved «Bruk alle» tas med merknaden på skjermen (A610). Integrasjonstesten for «bør → må gir stopped» utgår; i stedet testes merknaden i enhetstest og e2e.
- **Valgene fra nettleseren:** sikkerhet-personvern (`use`/`keep`) og test-leder («fremmed tekst med accepted») sier det samme. Inndata blir `use`, `edit`, `keep`, `undo`, og serveren avgjør. Ki-ansvarlig ble bedt om å si om et felt med vasket innhold kan føres som «endret» når det brukes uendret: det skjer ikke, fordi serveren selv bytter plassholderne tilbake ved «Bruk» og sammenligner med den tilbakebyttede teksten.
- **Gjentatte trykk og eldre forslag:** forbedreren (gjenbruk), ux (samme liste uten nye kall) og sikkerhet-personvern (faste id-er, ingen stille avvisning) dekkes samlet av A608. Eldre åpne forslag får ingen beslutning, men publiseringssjekken teller bare det nyeste per felt.
- **«Uten endring» (ux) og «Allerede i orden» (forbedreren):** samme forslag. Teksten blir «Allerede i orden (N)», fordi den sier hva takstmannen trenger å vite.
- **Hvor «Bruk alle» står:** ux sin plassering (fast nederst, designprinsipp 7) gjelder. Kortet sa «øverst».

## Lagt til av forbedreren
Ført i `docs/plan/forbedrerens-tillegg.md` 25.11.2026.
1. **Fortsett der du slapp, uten nye KI-kall** (A608): åpne forslag for uendrede felt gjenbrukes, og knappen viser «Fortsett gjennomgangen (N igjen)». Fjernes ved å ta ut gjenbruket i `reviewRoomTexts` (alle felt sendes på nytt).
2. **Skjul forslag uten endring** (A609): «Allerede i orden (N)». Fjernes ved å vise dem som vanlige felt.
3. **Tastaturflyt på PC** (A611): fokus til neste felt og snarveiene B, H, R, U. Fjernes ved å ta snarveiene ut av panelet og `SHORTCUT_LIST`.
4. **Sammenheng:** TG til lesing og «Vis i badet» per kontrollpunkt, levende ordmarkering ved «Rett før bruk», og «Alle tekster er gjennomgått» med neste steg. Fjernes i panelkomponenten.
5. **Antall på knappen** (A614). Fjernes ved å vise fast knappetekst.
6. **Nytt planpunkt:** «Fyll hullene i badet» (KI-utkast til tom årsak, konsekvens og tiltak på TG2 og TG3), lagt inn i planen under «Fra forbedreren» i 2a-2. Bygges ikke i denne oppgaven.

## Roller
- **ux:** panelet, ordmarkeringen, tastatur og skjermleser, uten-nett-oppførsel.
- **ki-ansvarlig:** flerfeltssakene og gruppen `room_review` i evalueringssettet, at vaktene gjelder per felt, og merknaden (A610).
- **sikkerhet-personvern:** kontrollen av loggrad, `target_ref` og status i lagringsinngangen, at tekstene leses fra databasen, og at ingenting nytt går til KI eller i loggen.
- **utvikler** og **testskriver** i parallell, i to biter: (1) kjernen (`reviewRoomTexts`, `applyReviewedTexts`, gjenbruk og faste id-er, taket, endringen i `pendingAiSuggestionsOf`, evalueringssettet); (2) skjermen og ordmarkeringen med merknaden, som bygger på kjernens typer i `src/core/reports/types.ts`.

## Åpne spørsmål
Ingen som stopper oppgaven. Spørsmål 103 (utvidet til «bør», «må» og «kan») og 105c gjelder her før ekte KI slås på, sammen med hullene i vasken («Vask før KI» i tilstandsfilen).
