# Funksjon: Team og parter på oppdraget

- **Fase:** 2a – Rapporten på PC (tredje punkt under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/assignments`, siden `/oppdrag/[id]` i rammen Fjord)
- **Branch:** `fase2a-oppdrag-team-parter` (bygger på `main`)
- **Status:** klar til bygging (04.11.2026, prosjektleder; rettet etter forenkler og test-leder)
- **Støtter hovedmål:** Tid: teamet og partene står på oppdraget fra første dag, så ingen leter i e-posten etter hvem som er megler, hvem som skal ha rapporten og hvem som skal ha fakturaen; valgene om hva parten mottar er forhåndsutfylt etter rollen. Reklamasjoner: det står alltid hvem som var ansvarlig, sidemann og befaringstakstmann, og bytter i teamet lagres med tid og grunn i stedet for å skrives over (sporbarhet ved reklamasjon om fem år, innspill P3). KI først: rollen og «hva parten mottar» er data som rutinene og KI senere kan lese (hvem får rapporten, hvem får påminnelse); feltene er laget slik at en KI-ordre fra e-post (krok A1) senere kan foreslå partene, og kontoret bare godkjenner. Ingen KI nå.

## Problem
Oppdraget fra forrige punkt har bare nummer, kontor og status. Det står ikke hvem som skal gjøre jobben, hvem som signerer, hvem som er sidemann, eller hvem som er megler, selger, kjøper og fakturamottaker. Uten dette kan ikke utstedende selskap settes fra ansvarlig (neste punkt), velkomst-e-posten og påminnelsene (fase 3) vet ikke hvem de skal til, og ved reklamasjon kan vi ikke vise hvem som hadde ansvaret. Ståle 24.10.2026: oppdragsgiver er megler eller selger, faktura til fritt valgt mottaker. Grunnmuren (`grunnmur-samarbeid-og-flere-selskaper.md`) har de fem rollene i teamet.

## KI først
Ikke nå. Kontoret velger teamet og skriver inn partene selv. Kroken er at partene har faste rollekoder og tre faste «mottar»-valg som forhåndsutfylles etter rollen (A62). Når e-post-til-ordre bygges, kan KI foreslå partene med samme koder, og kontoret godkjenner. Partene sendes aldri til KI (personopplysninger, domenemodellen 4.2).

## Brukerhistorier
- Som **kontor** vil jeg **sette ansvarlig takstmann, medansvarlig, befaringstakstmann, sidemann og saksbehandler på oppdraget** slik at **alle vet hvem som gjør hva**.
- Som **kontor** vil jeg **legge inn megler, selger, kjøper, representant og fakturamottaker med navn, e-post og telefon, og krysse av for hva hver skal motta** slik at **rapport og faktura går til riktige folk senere**.
- Som **leder** vil jeg **at bytte av ansvarlig lagres med tid og grunn, ikke skrives over** slik at **jeg kan svare på en reklamasjon om hvem som hadde ansvaret**.
- Som **takstmann** vil jeg **se teamet og partene på oppdraget** slik at **jeg vet hvem jeg skal ringe** (alle takstmenn ser alt, 27.10.2026).

## Omfang
**Med:**
1. **Tabellen `assignment_team_members`** (migrering), etter domenemodellen 4.3: `baseColumns` (organisasjon, sporingsfelt, `deleted_at`), `assignment_id` (påkrevd; sammensatt fremmednøkkel `(organization_id, assignment_id)` → `assignments`), `employee_id` (påkrevd; sammensatt fremmednøkkel `(organization_id, employee_id)` → `employees`), `team_role` (fast kode, CHECK: `responsible`, `co_responsible`, `inspector`, `peer_reviewer`, `office`), `from_at` (påkrevd), `to_at` (tom = aktiv), `handed_over_reason` (valgfri tekst, høyst 300 tegn). CHECK `to_at is null or to_at >= from_at`.
   - **Én aktiv person per rolle per oppdrag** (A61): unik delvis indeks på `(organization_id, assignment_id, team_role)` der `to_at is null and deleted_at is null`. Samme ansatt kan ha flere roller (for eksempel ansvarlig og befaringstakstmann).
   - **Historikken beholdes:** bytte eller fjerning setter `to_at` (og eventuelt grunn) på den gamle raden; det lages aldri en ny versjon av samme rad, og ingenting slettes. `deleted_at` brukes ikke fra skjermen (står der fordi alle tabeller har myk sletting).
   - Indeks `(organization_id, assignment_id)`.
2. **Tabellen `assignment_parties`** (samme migrering), enkel utgave av domenemodellen 4.2 (A60): `baseColumns`, `assignment_id` (påkrevd, sammensatt fremmednøkkel som over), `role` (fast kode, CHECK: `broker`, `seller`, `buyer`, `seller_representative`, `invoice_recipient`), `name` (påkrevd, høyst 200 tegn), `firm_name` (valgfri, høyst 200 tegn; for eksempel meglerforetaket), `email` (valgfri, gyldig e-post, høyst 254 tegn), `phone` (valgfri, bare sifre, mellomrom og `+`, høyst 20 tegn), `receives_report`, `receives_invoice`, `receives_messages` (ja/nei, standard nei). Indeks `(organization_id, assignment_id)`.
   - `contact_id`, `firm_id`, `receives_survey` og `is_primary` legges til av planpunktet «Kontakter og firma» og rutinene (A17-mønsteret). Da kobles fritekstpartene til kontakter.
   - En person med to roller blir to rader (domenemodellen 4.2).
   - Fjerning av en part er myk sletting (`deleted_at`).
3. **Faste koder** i `src/core/assignments/codes.ts`: `TEAM_ROLES` og `PARTY_ROLES` (`as const`), med `teamRoleLabel` (`Ansvarlig takstmann`, `Medansvarlig`, `Befaringstakstmann`, `Sidemann`, `Saksbehandler`) og `partyRoleLabel` (`Megler`, `Selger`, `Kjøper`, `Selgers representant`, `Fakturamottaker`, i denne faste rekkefølgen). Og `defaultReceives(role)` (ren funksjon, A62): megler, selger og selgers representant → rapport og kopi av meldinger; kjøper → rapport; fakturamottaker → faktura. Kodene endres aldri (regel 6).
4. **Tjenester i `src/core/assignments`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; ingen id fra skjemaet brukes til filtrering; fremmed, ukjent, slettet eller ugyldig oppdrags-id eller part-id gir `AccessDeniedError`):
   - `getAssignment(actor, organizationId, assignmentId)`: `organization.read`. Returnerer oppdraget (`id`, `number`, `status`, `officeName`, `orderId`), aktivt team (`teamRole`, `employeeId`, `employeeName`, `fromAt`), aktive parter (alle feltene over unntatt sporingsfelt) og `teamCandidates` (ansatte i organisasjonen som ikke er slettet og ikke har sluttet: `id`, `name`, sortert på navn). Faste feltlister. Ingen N+1 (én spørring per liste).
   - `setTeamMember(actor, organizationId, assignmentId, { teamRole, employeeId: string | null, reason?: string, now? })`: `assignment.edit`. I én transaksjon: lås oppdragsraden (`FOR UPDATE`, filtrert på `grant.organizationId` og `deleted_at is null`), sjekk at den ansatte finnes i organisasjonen, ikke er slettet og ikke har sluttet (ellers `EmployeeNotFoundError`, «Den ansatte finnes ikke.»), avslutt den aktive raden for rollen (`to_at = now`, `handed_over_reason = reason`), og lag ny rad når `employeeId` er satt. Samme ansatt som den aktive gir ingen endring (ingen hendelse). `employeeId = null` fjerner personen fra rollen. Grunnen: 0–300 tegn, trimmet, avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»).
   - `addParty(actor, organizationId, assignmentId, input)`, `updateParty(actor, organizationId, partyId, input)`, `removeParty(actor, organizationId, partyId)`: `assignment.edit`. Zod-skjema `partyInputSchema` i `src/core/assignments/schemas.ts` (reglene i punkt 2; `name` og `firmName` avviser 11 sifre på rad). `updateParty` og `removeParty` finner oppdraget via partens rad (filtrert på organisasjonen), og oppdraget må ikke være slettet.
   - **Hendelser og revisjonslogg** i samme transaksjon (`recordEvent`, `recordAuditEvent`): `assignment.team_changed` (`data: { teamRole, fromEmployeeId, toEmployeeId }`), `assignment.party_added`, `assignment.party_updated`, `assignment.party_removed` (`data: { partyId, role }`). Revisjonsloggen: `assignment_team_member` med `create`/`end`, `assignment_party` med `create`/`update`/`delete`, `changes` med id-er, rollekoder, «mottar»-valgene og navnene på feltene som ble endret, **aldri navn, firma, e-post, telefon eller grunn** (raden er kilden; loggen vises på `/admin/logg`).
5. **Skjermen `/oppdrag/[id]`** (PC først, må virke i iPad-størrelse; rammen Fjord, skjemadelene i `src/app/(ansatt)/`):
   - Topp: oppdragsnummer, status som merke, kontor, lenke «Ordren» til `/ordre/[orderId]` når den finnes. Ordresiden får lenke fra «Gjort om til oppdrag 2026-00001» til oppdragssiden. Ingen nytt menypunkt (oppdragslisten er eget planpunkt).
   - **«Team»:** én linje per rolle (fem linjer i fast rekkefølge) med navnet eller «Ikke satt». Med `canEditOrders`: nedtrekksliste med `teamCandidates` og «Ingen», feltet «Grunn ved bytte» (valgfritt, hjelpetekst «For eksempel ferie, sykdom eller kapasitet.») og knappen «Lagre» per linje.
   - **«Parter»:** én enkel liste med ett kort per part i alle skjermstørrelser (ingen egen tabell for PC), med rolle, navn, firma, e-post, telefon og hva parten mottar («Rapport», «Faktura», «Kopi av meldinger»). Tom liste: «Ingen parter er lagt inn ennå.» Med `canEditOrders`: skjemaet «Legg til part» (rolle først; avkrysningene forhåndsutfylles fra `defaultReceives` når rollen velges, og kan endres), og «Endre» og «Fjern» per part. «Fjern» uten egen dialog, som avvisning av ordre (A55-mønsteret); parten kan legges inn igjen. Navnefeltet står tomt (ingen utfylling fra ordren).
   - Server actions i `src/app/(ansatt)/oppdrag/[id]/actions.ts`: `setTeamMemberAction`, `addPartyAction`, `updatePartyAction`, `removePartyAction`; samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som ordre (bare rute, bruker-id, id-er og feilnavn, aldri skjemaverdier). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Kjente feil: `EmployeeNotFoundError`. Ingen tilgangslogikk i siden.
   - Feilmeldinger på norsk: «Skriv inn navnet.», «Velg en rolle.», «E-postadressen er ikke gyldig.», «Telefonnummeret kan bare ha sifre, mellomrom og +.», «Fødselsnummer skal ikke lagres her.», «Den ansatte finnes ikke.»
6. **Tester** (testskriver). **Testdata er oppdiktet** («Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`).
   - **Fabrikker:** `createTeamMember` og `createAssignmentParty` i `tests/factories.ts` (med tester i `factories.test.ts`); `RESET_TABLES` får de to tabellene; begge i `tests/tenant-tables.ts` med `src/core/assignments/assignment-team-parties.test.ts`.
   - **Enhetstester (`codes.test.ts`):** `defaultReceives` for hver av de fem rollene (fem testsaker); kodene og etikettene står i fast rekkefølge.
   - **Skjemaene (`src/core/assignments/schemas.test.ts`):** `partyInputSchema` og grunnen. Grenser: navn og firma 200/201 tegn, e-post 254/255 tegn og ugyldig e-post, telefon 20/21 tegn og bokstaver i telefon, grunn 300/301 tegn. 11 sifre på rad i navn, firma og grunn gir «Fødselsnummer skal ikke lagres her.» Verdiene trimmes. Alle de norske feilmeldingene i punkt 5 er dekket.
   - **Database (`src/db/assignment-team-parties-schema.test.ts`):** to aktive i samme rolle avvises; en aktiv rad som er myk-slettet sperrer ikke for en ny; samme ansatt kan ha to ulike roller. Databasen avviser ansatt fra en annen organisasjon, oppdrag fra en annen organisasjon (begge tabellene), ukjent `team_role`, ukjent rolle på part og `to_at` før `from_at`.
   - **Tenant-isolasjon (regel 2):** `expectTenantIsolation` for `getAssignment`, `setTeamMember`, `addParty`, `updateParty` og `removeParty` (fem kall), pluss egne kall der query er `getAssignment(...).teamCandidates`, `.team` og `.parties` med `idOf = id` (rader fra B vises ikke hos A).
   - **Fremmed id i egen organisasjon (IDOR):** A med egen org-id og Bs `assignmentId` gir `AccessDeniedError` for `getAssignment`, `setTeamMember` og `addParty`. A med egen org-id og Bs `partyId` gir `AccessDeniedError` for `updateParty` og `removeParty`, og Bs rad er uendret (navn, `deleted_at`). `setTeamMember` med `employeeId` fra B gir `EmployeeNotFoundError`, og ingen rad og ingen hendelse blir laget.
   - **Rettigheter:** rettighetsmatrisen for lesing (`getAssignment`) og skriving (`setTeamMember`, `addParty`, `updateParty`, `removeParty`), kjørt både med `access.inspectors_edit_all` på og av. Med av: admin, leder og kontor kan endre; takstmann kan lese, men ikke endre (admin stenges aldri ute, regel 11).
   - **Myk sletting:** et slettet oppdrag gir `AccessDeniedError` i alle fem funksjonene. En fjernet part finnes fortsatt med `deleted_at`, vises ikke i `getAssignment`, og `updateParty` eller `removeParty` på samme part igjen gir `AccessDeniedError`. Teamrader slettes aldri: etter bytte og «Ingen» har rollen null aktive rader, og radene finnes fortsatt.
   - **Team:** bytte gir to rader, den gamle med `to_at = now` og grunnen; samme ansatt igjen gir ingen ny rad og ingen hendelse; «Ingen» når ingen er satt gir ingen hendelse; ansatt som har sluttet eller er slettet, er ikke i `teamCandidates` og gir `EmployeeNotFoundError`. **Samtidige bytter:** to samtidige `setTeamMember` på samme rolle lykkes begge uten unik-feil; etterpå finnes nøyaktig én aktiv rad, én avsluttet rad og to hendelser. (Blir testen ustabil, kan den slås sammen med databasetesten «to aktive i samme rolle avvises».)
   - **Hendelser og logg:** skrives i samme transaksjon; hele JSON-en for hendelsen og revisjonsloggen gjøres om til tekst, og navn, firma, e-post, telefon og grunn står ikke der. En avvist endring skriver verken rad eller hendelse.
   - **Handlingene (`actions.test.ts`, kjernen byttet ut):** id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen; bruker uten ansattrad gir `NO_ACCESS`; `EmployeeNotFoundError` gir norsk melding; loggeren får aldri skjemaverdier.
   - **E2E i `pc` og `ipad`:** ordre → gjør om → åpne oppdraget → sett ansvarlig → legg til megler → endre → fjern. Ordre og oppdrag lenker til hverandre begge veier. Rollen «Megler» krysser av for rapport og kopi; byttes rollen til «Fakturamottaker», er bare faktura krysset av. Takstmann uten endringstilgang ser ikke skjemaene (siden får `canEditOrders = false`; kan prøves i kjernen og handlingene hvis e2e blir tungt).
7. **Dokumenter:** domenemodellen 4.2 og 4.3 får «Bygget i fase 2a» (hva som er med, hva som venter), ordlisten får de nye ordene, planpunktet krysses av, beslutningene A60–A63 føres i `docs/09-apne-sporsmal.md`. Versjon 0.2.71 → 0.2.72 (eller neste ledige ved PR).

**Ikke med (bevisst utelatt):**
- Kontakter og firma som register (`contacts`, `firms`), søk etter tidligere parter, dubletter, `contact_id`/`firm_id`, `source` og samtykke (eget planpunkt). Partene er fritekst på oppdraget til da (A60).
- `receives_survey` og `is_primary` (rutiner og undersøkelser kommer senere).
- E-post, SMS eller annen sending til partene. Ingen velkomst-e-post, ingen kopi (fase 3). «Mottar»-valgene lagres bare.
- Utstedende selskap fra ansvarlig takstmann (neste planpunkt), og sjekk av sertifisering når ansvarlig velges (sjekkes ved publisering, fase 0b).
- Endringstilgang «bare der du er i teamet» når `access.inspectors_edit_all` er av. A20 står: da har takstmann ikke `assignment.edit` i det hele tatt. Team-sjekken i `src/core/access` er en egen liten oppgave (A63).
- Endring av kontor, status eller andre felt på oppdraget. Oppdragsliste, arbeidskø og menypunkt «Oppdrag».
- Visning av tidligere teammedlemmer på skjermen (historikken ligger i tabellen og revisjonsloggen; vises når reklamasjonsskjemaet eller historikk per objekt bygges).
- Flere aktive personer i samme rolle (for eksempel to befaringstakstmenn).
- Egen bekreftelsesdialog ved «Fjern», angre.
- Advarsel når sidemann er den samme som ansvarlig (hører til sidemannskontrollen i fase 3).
- Utfylling av partens navn fra ordrens «Hvem bestilte» (kan komme med e-post-til-ordre, krok A1).
- Nye avhengigheter, ny rettighet.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ja, alle oppdrag (`organization.read`) | Når `access.inspectors_edit_all` er på (`assignment.edit`); ellers ikke (A20, A63) |
| kontor | Ja | Ja (`assignment.edit`: «ordre, oppdrag, parter …») |
| leder | Ja | Ja |
| admin | Ja | Ja (admin stenges aldri ute) |

Ingen endring i `src/core/access`.

## Data
- Nye tabeller `assignment_team_members` og `assignment_parties` (Omfang 1–2), begge med `organization_id`, myk sletting og sammensatte fremmednøkler.
- Nye faste koder: `team_role` (fem), `assignment_parties.role` (fem).
- Hendelser: `assignment.team_changed`, `assignment.party_added`, `assignment.party_updated`, `assignment.party_removed`. Revisjonslogg: `assignment_team_member` (`create`, `end`), `assignment_party` (`create`, `update`, `delete`). Ingen personopplysninger i hendelser eller logg.
- Oppdater `docs/05-domenemodell.md` 4.2, 4.3 og ordlisten.

## Skjermer
- **PC og iPad.** Én ny side `/oppdrag/[id]`, nådd fra ordresiden. Hovedhandlinger: velg person i rollen → «Lagre» (to trykk per rolle); «Legg til part» → rolle → navn, e-post, telefon (mottar er forhåndsutfylt) → «Lagre». Tallet mot IVIT måles i nullpunktet.
- iPad-størrelse: én kolonne, knapper minst 44 px. Partene vises som kort i alle størrelser (én visning).

## Regler
Ingen fagregler. Dataregler med tester: én aktiv per rolle, bytte avslutter gammel rad, `to_at >= from_at`, `defaultReceives` per rolle (fem testsaker).

## Akseptkriterier
- [ ] Kontor kan sette og bytte alle fem rollene i teamet på oppdragssiden; bytte lagrer tid og valgfri grunn på den gamle raden, og den nye blir aktiv. «Ingen» fjerner personen fra rollen.
- [ ] Databasen tillater bare én aktiv person per rolle per oppdrag; to samtidige bytter lykkes begge og gir én aktiv og én avsluttet rad.
- [ ] Ansatte som har sluttet eller er slettet, kan ikke velges (ikke i listen, og kjernen avviser).
- [ ] Kontor kan legge til, endre og fjerne parter med rolle, navn, firma, e-post, telefon og hva parten mottar; mottar-valgene forhåndsutfylles etter rollen. Fjernet part er myk-slettet.
- [ ] Ordresiden lenker til oppdraget, og oppdragssiden lenker til ordren.
- [ ] Hendelser og revisjonslogg skrives i samme transaksjon som endringen og inneholder aldri navn, firma, e-post, telefon eller grunn.
- [ ] Med `access.inspectors_edit_all` av kan admin, leder og kontor endre, og takstmann ser teamet og partene, men får ikke endret (test i kjernen); bruker uten ansattrad får `NO_ACCESS`.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for de fem funksjonene og for team, parter og `teamCandidates`; begge tabellene i `tests/tenant-tables.ts`). Fremmed oppdrags-, part- eller ansatt-id i egen organisasjon avvises uten endring.
- [ ] Virker på iPad-størrelse (e2e i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A60–A63)
- **A60:** Partene lagres som fritekst på oppdraget (navn, firma, e-post, telefon) til planpunktet «Kontakter og firma» kommer; da får tabellen `contact_id`/`firm_id` og fritekstpartene kobles. Rollelisten er de fem rollene i planpunktet: megler, selger, kjøper, selgers representant og fakturamottaker. «Oppdragsgiver» og «annen» tas ikke med nå (oppdragsgiver er megler eller selger, Ståle 24.10.2026); en ny kode er lett å legge til senere, mens en kode aldri kan endres (regel 6). «Mottar» er tre valg nå: rapport, faktura, kopi av meldinger. Kilde: oppgaven, domenemodellen 4.2, Ståle 24.10.2026 (faktura til fritt valgt mottaker), regel 1. Endres ved å legge til feltene når kontaktregisteret bygges.
- **A61:** Én aktiv person per rolle i teamet, også for befaringstakstmann og sidemann. Historikk ved at gamle rader får `to_at`. Kilde: domenemodellen 4.3 («én aktiv ansvarlig», «historikken beholdes»), grunnmuren (fem roller), det enkleste som virker. Endres ved å fjerne den unike indeksen for enkeltroller.
- **A62:** Forhåndsvalg for hva parten mottar: megler, selger og selgers representant får rapport og kopi av meldinger; kjøper får rapport; fakturamottaker får faktura. Kontoret kan endre. Kilde: domenemodellen 4.2, svarene 24.10.2026 (oppdragsgiver er megler eller selger), mål tid (færre trykk). Endres i `defaultReceives`.
- **A63:** Team-sjekken for endring når `access.inspectors_edit_all` er av, bygges ikke i denne oppgaven; A20 gjelder til den er bygget som egen liten oppgave i `src/core/access`. Innstillingen er på, så ingen merker det. Kilde: A20, regel 1.

## Roller
- **utvikler:** migrering og skjema, koder, `schemas.ts`, tjenestene i `src/core/assignments`, siden og handlingene, lenkene mellom ordre og oppdrag, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): punkt 6.
- **sikkerhet-personvern:** gjennomgang før PR: to nye tabeller med `organization_id` og sammensatte fremmednøkler, at partenes personopplysninger ikke havner i hendelser, revisjonslogg eller applikasjonslogg, og at ingen id fra skjemaet brukes til filtrering.

Ikke med: arkitekt (ingen ny ADR), ux-ansvarlig og ui-designer (siden følger ordre- og adminsidene i rammen Fjord), fagansvarlig (ingen fagtekster; forhåndsvalgene er avgjort i A62), KI.

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/assignment-team-members.ts`, `assignment-parties.ts` (+ `index.ts`, migrering), `src/core/assignments/*` (ikke `*.test.ts`), `src/app/(ansatt)/oppdrag/[id]/*` (ikke `*.test.ts`), lenken i `src/app/(ansatt)/ordre/[id]/page.tsx`, `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/assignments/assignment-team-parties.test.ts`, `src/core/assignments/codes.test.ts` (nye koder, `defaultReceives`), `src/core/assignments/schemas.test.ts`, `src/db/assignment-team-parties-schema.test.ts`, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts`, `e2e/fase-2a-oppdrag-team-parter.spec.ts`.
   Testskriveren skriver mot signaturene i dette kortet. Avviker utvikleren, står det under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.

## Avgjørelser etter gjennomgangen (prosjektleder, 04.11.2026)
- **Forenkler, alle fire kutt tatt:** (1) advarselen sidemann = ansvarlig (`teamWarnings`, `warnings`, gul boks, tester og akseptkriterium) er fjernet; den hører til sidemannskontrollen i fase 3, og planpunktet nevner den ikke. (2) Ingen utfylling av navn fra ordren; det kobler siden til ordredata uten at planen ber om det. (3) Rollekodene `client` og `other` er fjernet; planen har fem partsroller, og oppdragsgiver er megler eller selger (24.10.2026). En kode kan legges til, men aldri endres (regel 6), så det er tryggest å starte smalt. A60 og A62 er justert. (4) Partene vises som kort i alle størrelser; én visning å bygge og teste. Dermed faller test-lederens punkt «kort under 768 px» bort.
- **Test-leder, alle seks MÅ ENDRES tatt** (IDOR, isolasjon for listene, `schemas.test.ts`, forventet resultat ved samtidige bytter, myk sletting, rettigheter med innstillingen av). Testplanen er tatt inn i punkt 6, uten testene for `teamWarnings`, navneutfylling og den gule advarselen, som forenkleren kuttet. `defaultReceives` har fem testsaker, ikke sju.
- Ingen spørsmål om fag, pris eller personvern oppsto; ingenting nytt i `docs/09-apne-sporsmal.md` utover A60–A63, som utvikleren fører.
