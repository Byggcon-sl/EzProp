# Funksjon: Team og parter på oppdraget

- **Fase:** 2a – Rapporten på PC (tredje punkt under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/assignments`, siden `/oppdrag/[id]` i rammen Fjord)
- **Branch:** `fase2a-oppdrag-team-parter` (bygger på `main`)
- **Status:** utkast (04.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: teamet og partene står på oppdraget fra første dag, så ingen leter i e-posten etter hvem som er megler, hvem som skal ha rapporten og hvem som skal ha fakturaen; valgene om hva parten mottar er forhåndsutfylt etter rollen. Reklamasjoner: det står alltid hvem som var ansvarlig, sidemann og befaringstakstmann, og bytter i teamet lagres med tid og grunn i stedet for å skrives over (sporbarhet ved reklamasjon om fem år, innspill P3). Sidemann som er den samme som ansvarlig gir advarsel. KI først: rollen og «hva parten mottar» er data som rutinene og KI senere kan lese (hvem får rapporten, hvem får påminnelse); feltene er laget slik at en KI-ordre fra e-post (krok A1) senere kan foreslå partene, og kontoret bare godkjenner. Ingen KI nå.

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
2. **Tabellen `assignment_parties`** (samme migrering), enkel utgave av domenemodellen 4.2 (A60): `baseColumns`, `assignment_id` (påkrevd, sammensatt fremmednøkkel som over), `role` (fast kode, CHECK: `client`, `seller`, `broker`, `buyer`, `seller_representative`, `invoice_recipient`, `other`), `name` (påkrevd, høyst 200 tegn), `firm_name` (valgfri, høyst 200 tegn; for eksempel meglerforetaket), `email` (valgfri, gyldig e-post, høyst 254 tegn), `phone` (valgfri, bare sifre, mellomrom og `+`, høyst 20 tegn), `receives_report`, `receives_invoice`, `receives_messages` (ja/nei, standard nei). Indeks `(organization_id, assignment_id)`.
   - `contact_id`, `firm_id`, `receives_survey` og `is_primary` legges til av planpunktet «Kontakter og firma» og rutinene (A17-mønsteret). Da kobles fritekstpartene til kontakter.
   - En person med to roller blir to rader (domenemodellen 4.2).
   - Fjerning av en part er myk sletting (`deleted_at`).
3. **Faste koder** i `src/core/assignments/codes.ts`: `TEAM_ROLES` og `PARTY_ROLES` (`as const`), med `teamRoleLabel` (`Ansvarlig takstmann`, `Medansvarlig`, `Befaringstakstmann`, `Sidemann`, `Saksbehandler`) og `partyRoleLabel` (`Oppdragsgiver`, `Selger`, `Megler`, `Kjøper`, `Selgers representant`, `Fakturamottaker`, `Annen`). Og `defaultReceives(role)` (ren funksjon, A62): oppdragsgiver, selger, megler og selgers representant → rapport og kopi av meldinger; kjøper → rapport; fakturamottaker → faktura; annen → ingenting. Kodene endres aldri (regel 6).
4. **Tjenester i `src/core/assignments`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; ingen id fra skjemaet brukes til filtrering; fremmed, ukjent, slettet eller ugyldig oppdrags-id eller part-id gir `AccessDeniedError`):
   - `getAssignment(actor, organizationId, assignmentId)`: `organization.read`. Returnerer oppdraget (`id`, `number`, `status`, `officeName`, `orderId`), aktivt team (`teamRole`, `employeeId`, `employeeName`, `fromAt`), aktive parter (alle feltene over unntatt sporingsfelt) og `teamCandidates` (ansatte i organisasjonen som ikke er slettet og ikke har sluttet: `id`, `name`, sortert på navn). Faste feltlister. Ingen N+1 (én spørring per liste).
   - `setTeamMember(actor, organizationId, assignmentId, { teamRole, employeeId: string | null, reason?: string, now? })`: `assignment.edit`. I én transaksjon: lås oppdragsraden (`FOR UPDATE`, filtrert på `grant.organizationId` og `deleted_at is null`), sjekk at den ansatte finnes i organisasjonen, ikke er slettet og ikke har sluttet (ellers `EmployeeNotFoundError`, «Den ansatte finnes ikke.»), avslutt den aktive raden for rollen (`to_at = now`, `handed_over_reason = reason`), og lag ny rad når `employeeId` er satt. Samme ansatt som den aktive gir ingen endring (ingen hendelse). `employeeId = null` fjerner personen fra rollen. Grunnen: 0–300 tegn, trimmet, avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»).
   - `addParty(actor, organizationId, assignmentId, input)`, `updateParty(actor, organizationId, partyId, input)`, `removeParty(actor, organizationId, partyId)`: `assignment.edit`. Zod-skjema `partyInputSchema` i `src/core/assignments/schemas.ts` (reglene i punkt 2; `name` og `firmName` avviser 11 sifre på rad). `updateParty` og `removeParty` finner oppdraget via partens rad (filtrert på organisasjonen), og oppdraget må ikke være slettet.
   - **Hendelser og revisjonslogg** i samme transaksjon (`recordEvent`, `recordAuditEvent`): `assignment.team_changed` (`data: { teamRole, fromEmployeeId, toEmployeeId }`), `assignment.party_added`, `assignment.party_updated`, `assignment.party_removed` (`data: { partyId, role }`). Revisjonsloggen: `assignment_team_member` med `create`/`end`, `assignment_party` med `create`/`update`/`delete`, `changes` med id-er, rollekoder, «mottar»-valgene og navnene på feltene som ble endret, **aldri navn, firma, e-post, telefon eller grunn** (raden er kilden; loggen vises på `/admin/logg`).
   - **Advarsel, aldri sperre** (regel 12): `getAssignment` returnerer `warnings: string[]`, i dag bare «Sidemannen er den samme som ansvarlig takstmann.» når samme ansatt har begge rollene aktivt. Ren funksjon `teamWarnings(team)` med egne tester.
5. **Skjermen `/oppdrag/[id]`** (PC først, må virke i iPad-størrelse; rammen Fjord, skjemadelene i `src/app/(ansatt)/`):
   - Topp: oppdragsnummer, status som merke, kontor, lenke «Ordren» til `/ordre/[orderId]` når den finnes. Ordresiden får lenke fra «Gjort om til oppdrag 2026-00001» til oppdragssiden. Ingen nytt menypunkt (oppdragslisten er eget planpunkt).
   - **«Team»:** én linje per rolle (fem linjer i fast rekkefølge) med navnet eller «Ikke satt». Med `canEditOrders`: nedtrekksliste med `teamCandidates` og «Ingen», feltet «Grunn ved bytte» (valgfritt, hjelpetekst «For eksempel ferie, sykdom eller kapasitet.») og knappen «Lagre» per linje. Advarslene vises over teamet som gul boks.
   - **«Parter»:** liste med rolle, navn, firma, e-post, telefon og hva parten mottar («Rapport», «Faktura», «Kopi av meldinger»). Tom liste: «Ingen parter er lagt inn ennå.» Med `canEditOrders`: skjemaet «Legg til part» (rolle først; avkrysningene forhåndsutfylles fra `defaultReceives` når rollen velges, og kan endres), og «Endre» og «Fjern» per part. «Fjern» uten egen dialog, som avvisning av ordre (A55-mønsteret); parten kan legges inn igjen. Navnefeltet forhåndsutfylles med ordrens «Hvem bestilte» når oppdraget ikke har parter ennå (sparer skriving; kontoret retter).
   - Server actions i `src/app/(ansatt)/oppdrag/[id]/actions.ts`: `setTeamMemberAction`, `addPartyAction`, `updatePartyAction`, `removePartyAction`; samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som ordre (bare rute, bruker-id, id-er og feilnavn, aldri skjemaverdier). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Kjente feil: `EmployeeNotFoundError`. Ingen tilgangslogikk i siden.
   - Feilmeldinger på norsk: «Skriv inn navnet.», «Velg en rolle.», «E-postadressen er ikke gyldig.», «Telefonnummeret kan bare ha sifre, mellomrom og +.», «Fødselsnummer skal ikke lagres her.», «Den ansatte finnes ikke.»
6. **Tester** (testskriver): fabrikkene `createTeamMember` og `createAssignmentParty` i `tests/factories.ts` (med tester i `factories.test.ts`); `RESET_TABLES` får de to tabellene; begge i `tests/tenant-tables.ts` med `src/core/assignments/assignment-team-parties.test.ts`; `expectTenantIsolation` for `getAssignment`, `setTeamMember`, `addParty`, `updateParty` og `removeParty` (fem kall); rettighetsmatrisen én gang for lesing (`getAssignment`) og én gang for skriving (`setTeamMember`), pluss nekt uten `assignment.edit` for de tre partfunksjonene; databasen avviser to aktive i samme rolle, ansatt fra en annen organisasjon, oppdrag fra en annen organisasjon, ukjent rolle, `to_at` før `from_at`; bytte lager ny rad og avslutter den gamle (to rader etterpå, én aktiv); samme ansatt gir ingen endring; ansatt som har sluttet gir `EmployeeNotFoundError`; to samtidige `setTeamMember` på samme rolle gir én aktiv; hendelser og revisjonslogg i samme transaksjon og uten navn, e-post, telefon eller grunn; `defaultReceives` og `teamWarnings`; handlingene med kjernen byttet ut; e2e i `pc` og `ipad`: ordre → gjør om → åpne oppdraget → sett ansvarlig → legg til megler (rapport forhåndskrysset) → endre → fjern. **Testdata er oppdiktet** («Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`).
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
- Nye faste koder: `team_role` (fem), `assignment_parties.role` (sju).
- Hendelser: `assignment.team_changed`, `assignment.party_added`, `assignment.party_updated`, `assignment.party_removed`. Revisjonslogg: `assignment_team_member` (`create`, `end`), `assignment_party` (`create`, `update`, `delete`). Ingen personopplysninger i hendelser eller logg.
- Oppdater `docs/05-domenemodell.md` 4.2, 4.3 og ordlisten.

## Skjermer
- **PC og iPad.** Én ny side `/oppdrag/[id]`, nådd fra ordresiden. Hovedhandlinger: velg person i rollen → «Lagre» (to trykk per rolle); «Legg til part» → rolle → navn, e-post, telefon (mottar er forhåndsutfylt) → «Lagre». Tallet mot IVIT måles i nullpunktet.
- iPad-størrelse: én kolonne, knapper minst 44 px, partene som kort i stedet for tabell under 768 px.

## Regler
Ingen fagregler. Dataregler med tester: én aktiv per rolle, bytte avslutter gammel rad, `to_at >= from_at`, `defaultReceives` per rolle (sju testsaker), `teamWarnings` (sidemann = ansvarlig gir advarsel, ellers ingen).

## Akseptkriterier
- [ ] Kontor kan sette og bytte alle fem rollene i teamet på oppdragssiden; bytte lagrer tid og valgfri grunn på den gamle raden, og den nye blir aktiv. «Ingen» fjerner personen fra rollen.
- [ ] Databasen tillater bare én aktiv person per rolle per oppdrag; to samtidige bytter gir én aktiv.
- [ ] Ansatte som har sluttet eller er slettet, kan ikke velges (ikke i listen, og kjernen avviser).
- [ ] Sidemann som er den samme som ansvarlig gir advarsel på siden, men lagres.
- [ ] Kontor kan legge til, endre og fjerne parter med rolle, navn, firma, e-post, telefon og hva parten mottar; mottar-valgene forhåndsutfylles etter rollen. Fjernet part er myk-slettet.
- [ ] Ordresiden lenker til oppdraget, og oppdragssiden lenker til ordren.
- [ ] Hendelser og revisjonslogg skrives i samme transaksjon som endringen og inneholder aldri navn, firma, e-post, telefon eller grunn.
- [ ] Takstmann med `access.inspectors_edit_all` av ser teamet og partene, men får ikke endret (test i kjernen); bruker uten ansattrad får `NO_ACCESS`.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for de fem funksjonene; begge tabellene i `tests/tenant-tables.ts`).
- [ ] Virker på iPad-størrelse (e2e i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjonen er økt.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A60–A63)
- **A60:** Partene lagres som fritekst på oppdraget (navn, firma, e-post, telefon) til planpunktet «Kontakter og firma» kommer; da får tabellen `contact_id`/`firm_id` og fritekstpartene kobles. Rollelisten er hele listen fra domenemodellen 4.2 (sju koder). «Mottar» er tre valg nå: rapport, faktura, kopi av meldinger. Kilde: oppgaven, domenemodellen 4.2, Ståle 24.10.2026 (faktura til fritt valgt mottaker), regel 1. Endres ved å legge til feltene når kontaktregisteret bygges.
- **A61:** Én aktiv person per rolle i teamet, også for befaringstakstmann og sidemann. Historikk ved at gamle rader får `to_at`. Kilde: domenemodellen 4.3 («én aktiv ansvarlig», «historikken beholdes»), grunnmuren (fem roller), det enkleste som virker. Endres ved å fjerne den unike indeksen for enkeltroller.
- **A62:** Forhåndsvalg for hva parten mottar: oppdragsgiver, selger, megler og selgers representant får rapport og kopi av meldinger; kjøper får rapport; fakturamottaker får faktura; annen ingenting. Kontoret kan endre. Kilde: domenemodellen 4.2, svarene 24.10.2026 (oppdragsgiver er megler eller selger), mål tid (færre trykk). Endres i `defaultReceives`.
- **A63:** Team-sjekken for endring når `access.inspectors_edit_all` er av, bygges ikke i denne oppgaven; A20 gjelder til den er bygget som egen liten oppgave i `src/core/access`. Innstillingen er på, så ingen merker det. Kilde: A20, regel 1.

## Roller
- **utvikler:** migrering og skjema, koder, `schemas.ts`, tjenestene i `src/core/assignments`, siden og handlingene, lenkene mellom ordre og oppdrag, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): punkt 6.
- **sikkerhet-personvern:** gjennomgang før PR: to nye tabeller med `organization_id` og sammensatte fremmednøkler, at partenes personopplysninger ikke havner i hendelser, revisjonslogg eller applikasjonslogg, og at ingen id fra skjemaet brukes til filtrering.

Ikke med: arkitekt (ingen ny ADR), ux-ansvarlig og ui-designer (siden følger ordre- og adminsidene i rammen Fjord), fagansvarlig (ingen fagtekster; forhåndsvalgene er avgjort i A62), KI.

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/assignment-team-members.ts`, `assignment-parties.ts` (+ `index.ts`, migrering), `src/core/assignments/*` (ikke `*.test.ts`), `src/app/(ansatt)/oppdrag/[id]/*` (ikke `*.test.ts`), lenken i `src/app/(ansatt)/ordre/[id]/page.tsx`, `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/assignments/assignment-team-parties.test.ts`, `src/core/assignments/codes.test.ts` (nye koder, `defaultReceives`, `teamWarnings`), `src/db/assignment-team-parties-schema.test.ts`, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts`, `e2e/fase-2a-oppdrag-team-parter.spec.ts`.
   Testskriveren skriver mot signaturene i dette kortet. Avviker utvikleren, står det under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.
