# Funksjon: Oppdragslisten som arbeidskø

- **Fase:** 2a – Rapporten på PC
- **Modul:** kjerne / `src/core/assignments` (spørringene), siden `/arbeidskoe`
- **Status:** utkast (autonom modus, beslutningene A99–A104)
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
  - Hurtigfilter: **Mine** (jeg er med i teamet, uansett rolle) og **Alle**. Standard er **Mine** (A102). Står i adressen (`?mine=0`).
  - Søk i ett felt på oppdragsnummer og adresse (eiendommens adresse, ellers adressen fra ordren). Delvis treff, store og små bokstaver likt. Står i adressen (`?q=`).
  - Ett kort per oppdrag: oppdragsnummer og adresse (lenke til `/oppdrag/[id]`), merker for status (og «Rettet» når funksjonen fra statusflyten sier det), befaring (dato og klokkeslett, eller «Befaring ikke avtalt»), frist (dato; merket «Forfalt» når fristen er passert og status er Bestilt eller Under arbeid) og ansvarlig takstmann (navn, eller «Ingen ansvarlig»).
  - Notatet vises på kortet og kan redigeres der: «Notat»-knapp åpner et lite tekstfelt med «Lagre» og «Avbryt». Virker uten JavaScript som vanlig skjema.
  - Sortering: oppdrag med befaring eller frist først, etter nærmeste dato (befaring, ellers frist); deretter nyeste oppdragsnummer først (A103).
  - Høyst 50 kort per fane. Er det flere, står «Viser 50 av N. Bruk søket for å finne flere.» (A104).
  - Tomtilstand per fane med tekst som forklarer hva som skal stå der, og lenke til «Ny ordre» i fanen Bestilt.
  - Kansellerte oppdrag (myk sletting) vises aldri.
  - Kvitteringen etter kansellering (`?kansellert=`) beholdes.
- Revisjonslogg for endring av notat, befaring og frist, på samme måte som andre endringer på oppdraget.
- Notatet stoppes hvis det ser ut som et fødselsnummer, med samme kontroll som ellers i grunnen.
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
- Spørringene i `src/core/assignments` (forslag): `listWorkQueue(grant, { status, mineOnly, query, employeeId })`, `countWorkQueueByStatus(grant, { mineOnly, query, employeeId })`, `updateAssignmentNote(grant, assignmentId, note)`, `setAssignmentSchedule(grant, assignmentId, { inspectionAt, dueDate })`.
- Migreringen får neste ledige nummer på `main` når PR-en lages (PR #98 bruker 0019; lag på nytt med `pnpm db:generate` hvis den er merget først).

## Skjermer
- **PC (hovedskjerm) og iPad-størrelse.** Design A «Fjord»: luftige kort, merkene på én linje som brytes på smal skjerm. Fanene er lenker (ikke skjult tilstand), så tilbake-knappen virker.
- Hovedhandling: åpne oppdraget. Før: oppdraget fantes bare via ordren (`/ordre` → ordre → lenke), 3 trykk og leting. Etter: startsiden → kort, 1 trykk; med søk ett felt og 1 trykk.
- Notat: 1 trykk for å åpne, skriv, 1 trykk for å lagre, uten å forlate køen.

## Regler
Ingen faglige regler. «Forfalt» er en enkel visningsregel i koden (frist før dagens dato i Europe/Oslo og status Bestilt eller Under arbeid), med enhetstester.

## Akseptkriterier
- [ ] Startsiden viser fire faner med riktig antall per status for organisasjonen, og «Under arbeid» er valgt uten parameter.
- [ ] «Mine» viser bare oppdrag der innlogget ansatt er med i teamet; «Alle» viser alle. Antallene i fanene følger filteret og søket.
- [ ] Søk på del av oppdragsnummer og del av adresse (eiendom eller ordre) gir treff uavhengig av store og små bokstaver.
- [ ] Kortet viser oppdragsnummer, adresse, statusmerke, befaring, frist (med «Forfalt» når passert og ikke ferdig) og ansvarlig takstmann.
- [ ] Notatet kan lagres og endres fra køen, avvises over 200 tegn og når det ser ut som et fødselsnummer, og endringen står i revisjonsloggen.
- [ ] Befaring og frist kan settes og tømmes på oppdragssiden.
- [ ] Kansellerte oppdrag vises ikke og telles ikke.
- [ ] Høyst 50 kort, med tekst om hvor mange som finnes.
- [ ] Bruker uten `assignment.edit` kan se køen, men ikke lagre notat, befaring eller frist (test).
- [ ] Bruker i annen organisasjon får ikke tilgang og ser ingen oppdrag eller antall (`expectTenantIsolation` for hver ny spørring).
- [ ] Virker på PC og iPad-størrelse (e2e): åpne køen, bytt fane, søk, lagre notat.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`)
- **A99** Standardfanen er «Under arbeid», fordi det er der takstmannens arbeid ligger (IVIT-fanene Befaringer og Ferdigstilling). Kan endres med én konstant.
- **A100** Befaringstid og frist settes for hånd på oppdraget til befaringene finnes, slik at merkene har data nå (domenemodellen 4.2 har feltene). Kan erstattes av data fra `inspections` uten at køen endres.
- **A101** Notatet er høyst 200 tegn og internt (aldri i rapport eller PDF), som «kort notat per oppdragsrad» i IVIT-ønskelisten. Grensen er én konstant.
- **A102** Hurtigfilteret står på «Mine» som standard, fordi startsiden skal vise det som venter på takstmannen selv; «Alle» er ett trykk unna (alle ser alt, 27.10.2026).
- **A103** Sortering etter nærmeste befaring eller frist, så det som haster står øverst.
- **A104** Høyst 50 kort per fane, med søk for resten. Arkiv og lagrede filtre kommer senere.

## Åpne spørsmål
- Ingen som stopper oppgaven.
