# Funksjon: Oppdragslisten som arbeidskø

- **Fase:** 2a – Rapporten på PC
- **Modul:** kjerne / `src/core/assignments` (spørringene), siden `/arbeidskoe`
- **Status:** klar til bygging etter forhåndsvurdering runde 1 (autonom modus, beslutningene A99–A104)
- **Branch:** `fase2a-arbeidsko` (bygger på `main`)
- **Støtter hovedmål:** Tid: takstmannen ser med én gang hva som venter, finner et oppdrag med søk i stedet for å bla, og slipper å holde oversikten i hodet eller på lapper. Reklamasjoner: frister som er passert og oppdrag uten befaringsdato blir synlige, så ingenting blir liggende. KI først: køen er stedet der KI-forslag til godkjenning skal stå senere (se under).

## Problem
Startsiden er i dag en tom arbeidskø. Oppdrag finnes (ordre, team, status), men det er ingen liste over dem. Uten en liste må takstmannen huske oppdragsnummeret eller gå via ordren. I IVIT er faner etter fase med antall og kort notat per oppdragsrad ønsket av Byggcon (`docs/kartlegging/ivit-detaljer.md`, «Faner etter fase med antall» høy, «Kort notat per oppdragsrad» middels). Spectora har hurtigfilter i oppdragslisten (`spectora-detaljer.md`). Funksjonskartet sier «arbeidskø som startside (fase 2)».

## KI først
Ikke KI i denne oppgaven. Køen er en ren oversikt over data som allerede finnes. Den er bygget slik at KI-forslag til godkjenning (for eksempel «utkast til sammendrag klart») senere kan vises som et merke på kortet, men det kommer med KI-funksjonene. Notatet skrives av takstmannen; et KI-laget notat gir ingen tidsgevinst før det finnes rapportinnhold å oppsummere.

## Brukerhistorier
- Som **takstmann** vil jeg **se mine oppdrag under arbeid som startside** slik at jeg vet hva jeg skal gjøre i dag uten å lete.
- Som **takstmann** vil jeg **søke på adresse eller oppdragsnummer** slik at jeg finner et oppdrag med noen tastetrykk.
- Som **takstmann** vil jeg **skrive et kort notat på oppdraget rett i listen** (for eksempel «venter på nøkkel») slik at jeg og kollegaene ser status uten å åpne oppdraget.
- Som **kontor/leder** vil jeg **se antall oppdrag per status** slik at jeg ser hvor mye som ligger i hver fase.

## Omfang
**Med:**
- Tre nye kolonner på `assignments`: `inspection_at` (avtalt befaring, tidspunkt, kan være tomt), `due_date` (frist for levering, dato, kan være tomt) og `internal_note` (kort intern merknad, høyst 200 tegn, A101). Feltnavnene står allerede i domenemodellen 4.2. Én migrering.
- **Befaring og frist settes for hånd** på oppdragssiden `/oppdrag/[id]` i et lite skjema «Befaring og frist» (to felt og «Lagre»). Når befaringene (`inspections`) kommer, fylles `inspection_at` derfra (A100).
- **Arbeidskøen på `/arbeidskoe`** (startsiden):
  - Fire faner i fast rekkefølge: Bestilt, Under arbeid, Ferdig, Fakturert, hver med antall. Antallet følger hurtigfilteret og søket, så tallene stemmer med det som vises.
  - Valgt fane står i adressen (`?status=in_progress`). Uten valg vises **Under arbeid** (A99).
  - Hurtigfilter: **Mine** (jeg er med i teamet, uansett rolle; slettede teammedlemmer teller ikke) og **Alle**. Standard er **Mine** (A102). Står i adressen (`?mine=0`). Den ansatte for «Mine» hentes fra tilgangssjekken (`grant.employeeId`), aldri fra adressen eller skjemaet.
  - Ugyldig `?status=` gir standardfanen og ugyldig `?mine=` gir «Mine». Ingen feilside.
  - Søk i ett felt på oppdragsnummer og adresse (eiendommens adresse, ellers adressen fra ordren). Delvis treff, store og små bokstaver likt. `%` og `_` i søket tolkes som vanlige tegn. Står i adressen (`?q=`).
  - Ett kort per oppdrag: oppdragsnummer og adresse (lenke til `/oppdrag/[id]`), merker for status (og «Rettet» når funksjonen fra statusflyten sier det), befaring (dato og klokkeslett, eller «Befaring ikke avtalt»), frist (dato; merket «Forfalt» når fristen er passert og status er Bestilt eller Under arbeid) og ansvarlig takstmann (navn, eller «Ingen ansvarlig»).
  - Notatet vises på kortet og kan redigeres der: `<details>` med «Notat» åpner et lite tekstfelt med «Lagre» og «Avbryt». Vanlig skjema med server action, ingen egen klientkomponent. «Avbryt» lukker bare `<details>`. Virker uten JavaScript. Tomt notat lagres som tomt (null).
  - Sortering: oppdrag med befaring eller frist først, etter nærmeste dato (befaring, ellers frist); deretter nyeste oppdragsnummer først (A103). Gjøres i én `ORDER BY COALESCE(inspection_at, due_date) NULLS LAST, number DESC`, ingen sortering i TypeScript.
  - Høyst 50 kort per fane. Er det flere, står «Viser 50 av N. Bruk søket for å finne flere.» (A104). N tas fra antallet for fanen, ikke fra en egen spørring.
  - Tomtilstand: én felles tekst med fanens navn («Ingen oppdrag med status Under arbeid.»), og lenke til «Ny ordre» i fanen Bestilt.
  - Kansellerte oppdrag (myk sletting) vises aldri.
  - Kvitteringen etter kansellering (`?kansellert=`) beholdes.
- Skjemaet «Befaring og frist» har bare to felt med Zod-typer, begge kan tømmes. Ingen ekstra regler (for eksempel at fristen må komme etter befaringen).
- Revisjonslogg for endring av notat, befaring og frist, med den revisjonsloggen som finnes. Ingen ny hjelpekode.
- Merket «Rettet» bruker funksjonen i `src/core/assignments/status-flow.ts`. Ingen ny logikk.
- Notatet stoppes hvis det ser ut som et fødselsnummer, med den kontrollen som finnes. Et avvist fødselsnummer havner aldri i revisjonsloggen.
- Ordlisten og domenemodellen oppdateres. Versjon i `package.json` økes.

**Ikke med (bevisst utelatt):**
- Kalender, befaringsavtaler og tabellen `inspections`. Bare `inspection_at` som tall på oppdraget.
- Lederdashbord, statistikk, Excel-eksport, arkiv med lagrede filtre og hurtigperioder.
- Flere hurtigfiltre (i dag, i morgen, per kontor, per takstmann med avatarer), valg av kolonner og egen sortering.
- Radmeny (kopier oppdrag, bytt takstmann, last ned PDF) og masseendring.
- Bytte status fra køen. Status endres fortsatt på oppdragssiden.
- Globalt søk på matrikkel, kontakter eller megler.
- Varsler, lest/ulest og KI-forslag i køen.
- Sider eller «vis flere» utover 50 kort.
- iPad uten nett (fase 2b).

## Tilgang
Lesing bruker `organization.read`, endring bruker `assignment.edit`, begge via `requireOrganizationAccess`. Alle spørringer filtrerer på `grant.organizationId`.

| Rolle | Se | Endre (notat, befaring, frist) |
|---|---|---|
| takstmann | alle oppdrag (27.10.2026) | ja, så lenge `access.inspectors_edit_all` er på |
| kontor | alle oppdrag | ja |
| leder | alle oppdrag | ja |
| admin | alle oppdrag | ja |

«Mine» er et filter, ikke en tilgangsregel.

## Data
- `assignments.inspection_at` `timestamptz` null, `assignments.due_date` `date` null, `assignments.internal_note` `text` null (høyst 200 tegn, sjekkes med Zod).
- Ingen nye tabeller. Ingen nye faste koder. Statuskodene er de fire fra statusflyten.
- Spørringene i `src/core/assignments`: `listWorkQueue(grant, { status, mineOnly, query })`, `countWorkQueueByStatus(grant, { mineOnly, query })`, `updateAssignmentNote(grant, assignmentId, note)`, `setAssignmentSchedule(grant, assignmentId, { inspectionAt, dueDate })`. «Mine» bruker `grant.employeeId`.
- Filteret (organisasjon, ikke kansellert, «Mine», søk) lages ett sted og brukes av begge lesespørringene. Antallet hentes med én spørring gruppert på status.
- Endringene finner oppdraget med både `assignmentId` og `grant.organizationId`, og bare ikke-kansellerte oppdrag. Ellers «ikke funnet».
- Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke.
- Migreringen får neste ledige nummer på `main` når PR-en lages (PR #98 bruker 0019; lag på nytt med `pnpm db:generate` hvis den er merget først).

## Skjermer
- **PC (hovedskjerm) og iPad-størrelse.** Design A «Fjord»: luftige kort, merkene på én linje som brytes på smal skjerm. Fanene er lenker (ikke skjult tilstand), så tilbake-knappen virker.
- Hovedhandling: åpne oppdraget. Før: oppdraget fantes bare via ordren (`/ordre` → ordre → lenke), 3 trykk og leting. Etter: startsiden → kort, 1 trykk; med søk ett felt og 1 trykk.
- Notat: 1 trykk for å åpne, skriv, 1 trykk for å lagre, uten å forlate køen.

## Regler
Ingen faglige regler. «Forfalt» er én liten ren funksjon `isOverdue` (frist før dagens dato i Europe/Oslo og status Bestilt eller Under arbeid), med enhetstester. Ingen egen modul eller innstilling.

## Akseptkriterier
- [ ] Startsiden viser fire faner med riktig antall per status for organisasjonen, og «Under arbeid» er valgt uten parameter.
- [ ] «Mine» viser bare oppdrag der innlogget ansatt er med i teamet; «Alle» viser alle. Antallene i fanene følger filteret og søket.
- [ ] «Mine» filtrerer på den innloggede ansatte fra tilgangssjekken (`grant.employeeId`). Ingen funksjon tar en ansatt-id som parameter.
- [ ] Ugyldig `?status=` gir «Under arbeid», ugyldig `?mine=` gir «Mine».
- [ ] Søk på del av oppdragsnummer og del av adresse (eiendom eller ordre) gir treff uavhengig av store og små bokstaver. `%` og `_` tolkes som vanlige tegn.
- [ ] Kortet viser oppdragsnummer, adresse, statusmerke, befaring, frist (med «Forfalt» når passert og ikke ferdig) og ansvarlig takstmann.
- [ ] Notatet kan lagres, endres og tømmes fra køen (tomt lagres som null), avvises over 200 tegn og når det ser ut som et fødselsnummer, og endringen står i revisjonsloggen uten avvist fødselsnummer.
- [ ] Befaring og frist kan settes og tømmes på oppdragssiden.
- [ ] Kansellerte oppdrag vises ikke og telles ikke.
- [ ] Høyst 50 kort, med tekst om hvor mange som finnes.
- [ ] Bruker uten `assignment.edit` kan se køen, men ikke lagre notat, befaring eller frist (test: takstmann med `access.inspectors_edit_all` av får `AccessDeniedError`, men kan lese). Admin kan alltid endre.
- [ ] Bruker i annen organisasjon får ikke tilgang og ser ingen oppdrag: `expectTenantIsolation` for `listWorkQueue`.
- [ ] Isolasjon for antallene: egen test der A har oppdrag og B ingen; B sine antall er 0 i alle fire faner, og en bruker i A som spør med B sin id får `AccessDeniedError` (`expectTenantIsolation` passer ikke, siden svaret er tall og ikke rader).
- [ ] Isolasjon for endringene: `updateAssignmentNote` og `setAssignmentSchedule` med en oppdrags-id fra en annen organisasjon gir «ikke funnet» eller tilgang nektet, og raden i den andre organisasjonen er uendret. Det samme for et kansellert oppdrag.
- [ ] Virker på PC og iPad-størrelse (e2e): én test i begge størrelsene som åpner køen, bytter fane, søker og lagrer notat.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A99** Standardfanen er «Under arbeid», fordi det er der takstmannens arbeid ligger (IVIT-fanene Befaringer og Ferdigstilling). Kan endres med én konstant.
- **A100** Befaringstid og frist settes for hånd på oppdraget til befaringene finnes, slik at merkene har data nå (domenemodellen 4.2 har feltene). Kan erstattes av data fra `inspections` uten at køen endres.
- **A101** Notatet er høyst 200 tegn og internt (aldri i rapport eller PDF), som «kort notat per oppdragsrad» i IVIT-ønskelisten. Grensen er én konstant.
- **A102** Hurtigfilteret står på «Mine» som standard, fordi startsiden skal vise det som venter på takstmannen selv; «Alle» er ett trykk unna (alle ser alt, 27.10.2026).
- **A103** Sortering etter nærmeste befaring eller frist, så det som haster står øverst.
- **A104** Høyst 50 kort per fane, med søk for resten. Arkiv og lagrede filtre kommer senere.

## Testplan (fra test-leder, runde 1)
**Enhetstester:** `isOverdue` (frist i går, i dag, i morgen; grensen ved midnatt i Europe/Oslo med UTC-tid nær midnatt; bare Bestilt og Under arbeid kan bli forfalt). Zod for notat (200 tegn ok, 201 avvist, fødselsnummer avvist, tom tekst gir null) og for befaring og frist (kan tømmes). Tolking av adressen (`status`, `mine`, `q`, med standard ved ugyldige verdier).

**Integrasjonstester** (`src/core/assignments/work-queue.test.ts`): antall per status, også med «Mine» og søk. «Mine» tar med alle roller i teamet, men ikke slettede teammedlemmer. Søk på del av nummer, eiendomsadresse og ordreadresse, store og små bokstaver, `%` og `_`. Sortering (A103): befaring før frist, nærmeste dato først, rader uten dato sist etter nyeste nummer. Kansellerte vises og telles ikke. 51 rader gir 50 kort og N = 51. Notat, befaring og frist lagres, endres og tømmes, med rad i revisjonsloggen. Tilgang per rolle og admin med innstillingen av. Isolasjon som i akseptkriteriene. Den nye migreringen kjøres mot testdatabasen.

**E2e** (`e2e/arbeidsko.spec.ts`, PC og iPad): én gjennomgang (åpne kø med «Under arbeid» valgt og antall i fanene, bytt fane og tilbake, søk, Mine/Alle, åpne og lagre notat, Avbryt lar notatet stå). I tillegg: sett befaring og frist på `/oppdrag/[id]` og se merkene i køen; tomtilstand med lenke til «Ny ordre» i Bestilt; notat uten JavaScript i ett prosjekt. Uten nett testes i fase 2b.

**Ikke testet nå:** at notatet aldri kommer i rapport eller PDF (A101) testes når PDF finnes. «Rettet» er alltid usant i dag; test bare at merket vises når funksjonen gir sant.

## Avgjort i forhåndsvurderingen (prosjektleder, 05.11.2026)
- Alle forslagene fra forenkler og test-leder er tatt inn. De trekker i samme retning og gjør kortet både enklere og tryggere.
- Forenkler ville ha én e2e-test; test-leder listet flere steg. Avgjørelse: én gjennomgang i begge størrelsene for hovedflyten, pluss tre korte tester for det gjennomgangen ikke dekker (befaring og frist, tomtilstand, uten JavaScript). Grunn: hovedflyten holdes samlet, men det som kan gå i stykker hver for seg, får egen test.
- Felles tomtekst i stedet for egen tekst per fane: mindre tekst å vedlikeholde, og fanenavnet forklarer nok.
- Signaturer følger `status.ts`: `(actor, organizationId, …)` med `requireOrganizationAccess` inne i funksjonen (`organization.read` for lesing, `assignment.edit` for endring); ingen funksjon tar ansatt-id, «Mine» bruker `grant.employeeId`.
- Valgt under bygging (utvikler, 05.11.2026): «Mine» teller bare aktive teamrader (ikke slettet og ikke avsluttet med `to_at`), som teamet på oppdragssiden; den som har overlevert oppdraget, ser det under «Alle». Samme notat, befaring eller frist på nytt skriver ingenting og gir ingen rad i revisjonsloggen. Befaring uten tidssone fra skjemaet leses som norsk tid; tolkingen er flyttet fra ordreskjemaet til `src/shared/lib/dates.ts` (`parseOsloDateTime`) og brukes av begge.

## Åpne spørsmål
- Ingen som stopper oppgaven. Ingenting om fag, pris, personvern eller nye funksjoner ble reist i forhåndsvurderingen.
