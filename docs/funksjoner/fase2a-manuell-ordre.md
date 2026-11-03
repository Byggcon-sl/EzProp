# Funksjon: Manuell ordre og oppdragsnummer

- **Fase:** 2a – Rapporten på PC (første punkt under «Oppdrag og eiendom», to planpunkter som hører sammen)
- **Modul:** kjerne (`src/core/orders`, `src/core/assignments`, `src/core/access`, siden `/ordre` i rammen Fjord)
- **Branch:** `fase2a-manuell-ordre` (bygger på `main`)
- **Status:** klar for bygging (03.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: kontoret legger inn en bestilling fra e-posten én gang, med feltene som ellers må letes frem senere (gnr/bnr, seksjon, borettslag, egenerklæring), og oppdraget får nummer uten at noen slår opp «neste ledige» i et regneark. Reklamasjoner: ordre og oppdrag er to ting, som i IVIT, så en avvist bestilling blir stående med grunn, og alt som skjer logges fra første dag. KI først: feltet `source` og den faste koden `email` er kroken som senere lar KI lage ordreforslag fra e-posten (krok A1), som kontoret bare kontrollerer og godkjenner. Ingen KI nå.

## Problem
Byggcon får bestillinger på e-post fra meglere og selgere. I dag legges de inn i IVIT. EzProp har ingen ordre, ingen oppdrag og ingen nummerserie, så ingenting i fase 2a (team, parter, eiendom, rapport) har noe å henge på. Uten eget ordreobjekt kan en bestilling som avvises, ikke spores, og uten nummerserie på serveren kan to kontorer gi samme nummer (innspill D9). Ståle 25.10.2026 (svar 15): «Manuell registrering holder. API kan komme senere.»

## KI først
Ikke nå. Første steg er at kontoret skriver inn feltene selv. Kroken for det neste steget legges inn: `orders.source` er en fast kode (`manual` nå, `email` og `broker_system` finnes i listen, brukes ikke ennå). Når e-posttilkoblingen (fase 0b) brukes til å lese innboksen, kan KI lage en ordre med `source = email` som kontoret ser gjennom og godkjenner, uten ombygging av tabellen. Ingen KI-funksjon, ingen `raw_payload` og ingen lesing av e-post i denne oppgaven.

## Brukerhistorier
- Som **kontor** vil jeg **legge inn en bestilling fra e-posten med adresse, gnr/bnr, seksjon, borettslag og om egenerklæringen er mottatt** slik at **alt fra bestillingen er samlet på ett sted før oppdraget starter**.
- Som **kontor** vil jeg **gjøre en ordre om til et oppdrag med ett trykk, og få oppdragsnummeret med en gang** slik at **jeg kan svare megleren og slipper å finne neste nummer selv**.
- Som **kontor** vil jeg **avvise en ordre med en grunn** slik at **vi senere kan se hva vi sa nei til og hvorfor**.
- Som **takstmann** vil jeg **se ordrene og oppdragsnumrene** slik at **jeg vet hva som er på vei** (alle takstmenn ser alt, 27.10.2026).

## Omfang
**Med:**
1. **Tabellen `orders`** (migrering), etter domenemodellen 4.3, med de egne feltene fra planpunktet. Alle rader har `organization_id`, sporingsfelt og `deleted_at` (myk sletting, `baseColumns`).
   - `received_at` (påkrevd, standard nå), `source` (fast kode: `manual`, `email`, `broker_system`; bare `manual` brukes nå; CHECK i databasen), `external_ref` (valgfri, ordrenummer fra megler), `ordered_by_text` (valgfri tekst: hvem som bestilte, navn og firma slik det sto i e-posten; kontakter og firma er eget planpunkt), `address_text` (påkrevd), `requested_report_type` (fast kode, bare `condition_report` nå, CHECK), `gnr`, `bnr`, `snr` (seksjonsnummer; alle valgfri tekst, bare sifre), `housing_association_name` (borettslag eller sameie, valgfri tekst), `seller_declaration_received` (ja/nei, standard nei), `note` (valgfri intern merknad), `status` (`received`, `converted`, `rejected`; CHECK), `rejected_reason` (tekst), `assignment_id` (peker på oppdraget).
   - Databasen sikrer: `status = rejected` krever `rejected_reason`, `status = converted` krever `assignment_id`, og `assignment_id` er tomt ellers (CHECK). `assignment_id` har sammensatt fremmednøkkel `(assignment_id, organization_id)` → `assignments(id, organization_id)`, så en ordre aldri kan peke på et oppdrag i en annen organisasjon.
   - Adresse og matrikkel lagres som tekst på ordren til planpunktet «Eiendom og matrikkel» kommer (A50). Det punktet flytter dem til `properties` og `cadastral_units`.
2. **Tabellen `assignments`** (samme migrering), minimal: `number` (påkrevd, unik per organisasjon: unik indeks på `(organization_id, number)`), `external_ref` (kopi fra ordren), `office_id` (påkrevd; sammensatt fremmednøkkel til `offices(id, organization_id)`), `order_id` (sammensatt fremmednøkkel til `orders`, valgfri: oppdrag kan senere lages direkte), `assignment_type` (fast kode, bare `condition_report` nå, CHECK), `status` (de fire fra 27.10.2026: `ordered`, `in_progress`, `completed`, `invoiced`; CHECK; bare `ordered` settes nå), `status_changed_at`, `internal_note` (valgfri). Sporingsfelt og `deleted_at` fra `baseColumns`.
   - `company_id`, `property_id`, `client_agreement_id`, `report_profile_id`, `inspection_at`, `due_date` og `cancelled_reason` legges til av planpunktene som bruker dem (samme mønster som A17 i fase 0b).
   - Fremmednøkkelen fra `events.assignment_id` (sammensatt med `organization_id`) og indeksen `(organization_id, assignment_id)` på `events` legges inn i samme migrering, slik A33 sa.
3. **Tabellen `number_sequences`** (samme migrering): `organization_id`, `scope` (fast kode, bare `assignment` nå), `prefix` (for eksempel `2026-`), `next_value`, `padding` (5). Unik på `(organization_id, scope, prefix)`. Ingen myk sletting trengs (serien er en teller), men `organization_id` og tenant-test som alle andre tabeller.
   - **Neste nummer hentes med lås i databasen:** én setning `INSERT … ON CONFLICT (organization_id, scope, prefix) DO UPDATE SET next_value = next_value + 1 RETURNING …` inne i transaksjonen som lager oppdraget. Postgres låser raden, så to samtidige konverteringer aldri får samme nummer. Første oppdrag i et år lager serien selv (A51). Funksjonen `nextAssignmentNumber(executor, grant, today)` i `src/core/assignments/number-sequence.ts` returnerer `2026-00001`; året er fra `todayInOslo(now)` (`src/shared/lib/dates.ts`), som sendes inn, så testene kan styre årsskiftet.
   - Numre lages bare på serveren (D9). Det står i kommentaren og i domenemodellen.
4. **Faste koder ett sted** i koden: `ORDER_SOURCES`, `ORDER_STATUSES`, `ASSIGNMENT_TYPES`, `ASSIGNMENT_STATUSES`, `NUMBER_SEQUENCE_SCOPES`, med norske etiketter (`Mottatt`, `Gjort om til oppdrag`, `Avvist`; `Bestilt`, `Under arbeid`, `Ferdig`, `Fakturert`). Kodene endres aldri (regel 6).
5. **Tjenester i `src/core/orders`** (alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; ingen id fra skjemaet brukes til filtrering):
   - `listOrders(actor, organizationId)` og `getOrder(actor, organizationId, orderId)`: `organization.read`. Nyeste `received_at` først; slettede rader er aldri med. Listen har faste feltlister (ingen sporingsfelt ut til skjermen).
   - `createOrder(actor, organizationId, input)`: `assignment.edit`. Zod-skjema i `src/core/orders/schemas.ts` (adresse påkrevd, høyst 300 tegn; gnr/bnr/snr bare sifre, høyst 10 tegn; `external_ref`, `ordered_by_text`, `housing_association_name` høyst 200 tegn; `note` høyst 2000 tegn; `received_at` kan ikke være frem i tid). Skriver hendelsen `order.received` (`recordEvent`, `assignmentId` tom) og revisjonsloggen (`entityType: "order"`, `action: "create"`) i samme transaksjon.
   - `rejectOrder(actor, organizationId, orderId, reason)`: `assignment.edit`. Bare fra `received`; grunn påkrevd (1–500 tegn). Setter `status = rejected` og `rejected_reason`. Skriver `order.rejected` og revisjonsloggen (`action: "reject"`, gammel og ny status, grunnen). En ordre som alt er avvist eller gjort om, gir feilen «Ordren er allerede behandlet.» (egen feilklasse, ingen endring).
   - `convertOrderToAssignment(actor, organizationId, orderId, { officeId, now? })`: `assignment.edit`. Bare fra `received`. I én transaksjon: lås ordreraden (`FOR UPDATE`, så to samtidige konverteringer av samme ordre gir ett oppdrag og én feil «Ordren er allerede behandlet.»), sjekk at kontoret finnes i organisasjonen og ikke er slettet (ellers «Kontoret finnes ikke.»), hent neste nummer (punkt 3), lag oppdraget (`status = ordered`, `status_changed_at = nå`, `assignment_type = condition_report`, `external_ref` kopiert fra ordren, `order_id = ordren`), sett ordren til `converted` med `assignment_id`, skriv hendelsene `assignment.created` (med `assignmentId`, `data: { number, orderId }`) og revisjonsloggen (`order` `action: "convert"` og `assignment` `action: "create"`). Returnerer oppdraget med nummer.
   - Kjernen for oppdrag (`src/core/assignments`): bare `nextAssignmentNumber` og `getAssignment(actor, organizationId, assignmentId)` (`organization.read`, brukes av ordresiden for å vise nummeret). Ingen liste, ingen endring av oppdrag.
6. **Skjermene** (PC først, må virke i iPad-størrelse; rammen Fjord, samme skjemadeler som adminområdet; deler som gjenbrukes utenfor `admin/`, flyttes til `src/shared/ui`):
   - Menypunktet **«Ordre»** i hovedmenyen (`src/app/(ansatt)/layout.tsx`), mellom «Arbeidskø» og det som finnes, synlig for alle med ansattrad.
   - `/ordre`: liste med adresse, mottatt (dato), hvem som bestilte, status som merke, og oppdragsnummeret når ordren er gjort om. Tom liste: «Ingen ordre er lagt inn ennå.» Knappen «Ny ordre». Ingen faner, ingen filtre, ingen søk (kommer med arbeidskøen).
   - `/ordre/ny`: skjemaet med feltene fra punkt 1 (mottatt forhåndsutfylt med nå, rapporttype forhåndsvalgt, egenerklæring som avkrysning). Ett trykk på «Lagre» går til ordresiden. Feilmeldinger på norsk: «Skriv inn adressen.», «Gårdsnummer kan bare ha sifre.», «Mottatt kan ikke være frem i tid.»
   - `/ordre/[id]`: alle feltene, status, og to handlinger når status er «Mottatt»: **«Gjør om til oppdrag»** (velg kontor; forhåndsvalgt er kontoret til den innloggede ansatte når det finnes; er det ingen kontorer i organisasjonen, vises «Legg inn et kontor i admin først.» i stedet for knappen) og **«Avvis»** (grunn påkrevd, med bekreftelse). Etter konvertering viser siden «Gjort om til oppdrag 2026-00001». Etter avvisning vises grunnen. Brukere uten `assignment.edit` ser siden uten knappene.
   - Server actions ligger i `src/app/(ansatt)/ordre/actions.ts`, med samme mønster for resultat og feilmelding som adminområdet (`action-result.ts`, `form-state.ts`). Ingen tilgangslogikk i sider eller komponenter.
7. **Tester** (testskriver, etter testplanen fra test-leder): fabrikkene `createOrder` og `createAssignment` i `tests/factories.ts` (med egne tester i `factories.test.ts`); de tre tabellene i `tests/tenant-tables.ts`; `expectTenantIsolation` for hver spørring som tar `organizationId` (`listOrders`, `getOrder`, `createOrder`, `rejectOrder`, `convertOrderToAssignment`, `getAssignment`, `nextAssignmentNumber`); rettighetene (takstmann med innstillingen på/av, kontor, leder, admin, bruker uten ansattrad); nummerserien (20 samtidige konverteringer gir 20 ulike numre `00001`–`00020`; årsskiftet gir ny serie `2027-00001` mens 2026-serien står; format `^\d{4}-\d{5}$`; to organisasjoner har hver sin serie); status- og CHECK-reglene; hendelsene og revisjonsloggen; e2e på `pc` og `ipad`: ny ordre → gjør om → nummeret vises; ny ordre → avvis med grunn.
8. **Dokumenter:** domenemodellen 4.3 får «Bygget i fase 2a» (hva som er med, hva som venter, og hvorfor), ordlisten (avsnitt 8) får de nye ordene, planen krysses av for begge punktene, beslutningene A50–A54 føres i `docs/09-apne-sporsmal.md`. Versjon 0.2.62 → 0.2.65 (0.2.63 og 0.2.64 er tatt av PR #74 og en tilstands-PR).

**Ikke med (bevisst utelatt):**
- Team på oppdraget, parter, kontakter og firma (egne planpunkter). Derfor ingen `company_id` (settes fra ansvarlig takstmann i eget punkt), ingen `ordered_by_contact_id`/`ordered_by_firm_id` (tekstfeltet `ordered_by_text` til da).
- Eiendom, matrikkel, boligtype og eierform som egne tabeller (eget planpunkt). Adresse og matrikkel er tekst på ordren til da (A50). Feste- og bruksenhetsnummer, andelsnummer og organisasjonsnummer for borettslaget kommer med `cadastral_units`.
- Statusflyten videre (`in_progress`, `completed`, `invoiced`), kansellering med `cancelled_reason`, merket «Rettet», befaringstid og frist (eget planpunkt). Oppdraget får bare `ordered`.
- Oppdragsliste, arbeidskø med faner, søk, filtre og en egen side for oppdraget (eget planpunkt). Nummeret vises på ordresiden.
- Avtaler, prislister, rapportprofiler (egne planpunkter) og `external_references` (fase 3, A48).
- Redigering av en ordre etter at den er lagret, og angre avvisning. Feil rettes med ny ordre; den gale avvises med grunnen «Feil registrering». Myk sletting av ordre fra skjermen.
- E-post til megler eller selger (velkomst-e-posten er første rutine, fase 3), ordrebekreftelse, varsler.
- Lesing av e-post, KI-forslag, `raw_payload`, API for meglersystem (svar 15, 25.10.2026).
- Innstilling for nummerformat eller startnummer per takstmann (IVIT har «startsekvens per takstmann»; EzProp bruker én serie for hele organisasjonen, D9, domenemodellen 4.3).
- Nye avhengigheter.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ja, alle ordre og oppdragsnumre (`organization.read`, A18–A21) | Legge inn, avvise og gjøre om når `access.inspectors_edit_all` er på (`assignment.edit`); ellers ikke |
| kontor | Ja | Ja (`assignment.edit`) |
| leder | Ja | Ja |
| admin | Ja | Ja (admin stenges aldri ute) |

Rettigheten `assignment.edit` finnes alt («Endre ordre, oppdrag, parter, befaringstid, dokumenter», rettighetsmatrisen avsnitt 5). Ingen ny rettighet og ingen endring i `src/core/access`.

## Data
- Nye tabeller `orders`, `assignments`, `number_sequences` (Omfang 1–3). Alle med `organization_id`; `orders` og `assignments` med myk sletting. Fremmednøkkel fra `events.assignment_id` (A33).
- Nye faste koder: `orders.source` (`manual`, `email`, `broker_system`), `orders.status` (`received`, `converted`, `rejected`), `orders.requested_report_type` og `assignments.assignment_type` (`condition_report`), `assignments.status` (`ordered`, `in_progress`, `completed`, `invoiced`), `number_sequences.scope` (`assignment`).
- Hendelser (`events`, 4.9): `order.received`, `order.rejected`, `assignment.created`. Revisjonslogg (`audit_log`): `order` med `create`, `reject`, `convert`; `assignment` med `create`.
- Oppdater `docs/05-domenemodell.md` 4.3 og ordlisten.

## Skjermer
- **PC og iPad.** Tre sider i rammen Fjord: `/ordre` (liste), `/ordre/ny` (skjema), `/ordre/[id]` (ordren med handlingene). Hovedhandling: «Ny ordre» → fyll inn → «Lagre» → «Gjør om til oppdrag» → nummeret vises. Fire trykk fra e-post til oppdragsnummer. I IVIT er det en lengre vei med egne skjermer for ordre og oppdrag og nummer som må slås opp; tallet måles i nullpunktet.
- iPad-størrelse: skjemaet i én kolonne, knappene minst 44 px høye, menyen som rad under topplinjen (som rammen gjør i dag).

## Regler
Ingen fagregler (ikke TG-logikk). Dataregler som testes: statusovergangene (`received` → `converted` eller `rejected`, aldri videre), CHECK-reglene i databasen, nummerformatet, samtidighet (20 konverteringer, og to konverteringer av samme ordre), årsskiftet, og at bare sifre godtas i gnr/bnr/snr.

## Akseptkriterier
- [ ] Kontor kan legge inn en ordre med adresse, gnr/bnr, seksjon, borettslag, egenerklæring mottatt, hvem som bestilte og mottatt-dato, og se den i listen og på egen side.
- [ ] «Gjør om til oppdrag» lager et oppdrag med nummer `ÅÅÅÅ-NNNNN` (første i året blir `-00001`), status «Bestilt», valgt kontor og kobling begge veier (`orders.assignment_id`, `assignments.order_id`); ordren får status «Gjort om til oppdrag» og viser nummeret.
- [ ] «Avvis» krever grunn, setter status «Avvist» og viser grunnen. Avvist eller konvertert ordre kan ikke avvises eller konverteres igjen (feilmelding, ingen endring).
- [ ] 20 samtidige konverteringer i samme organisasjon gir 20 ulike, påfølgende numre; to samtidige konverteringer av samme ordre gir ett oppdrag.
- [ ] Nummerserien er per år og organisasjon: året fra norsk tid; ny serie ved årsskiftet; to organisasjoner får begge `-00001`.
- [ ] Hendelsene `order.received`, `order.rejected` og `assignment.created` og radene i revisjonsloggen skrives i samme transaksjon som endringen (feiler skrivingen, finnes verken ordre, oppdrag eller hendelse).
- [ ] Takstmann med `access.inspectors_edit_all` av ser ordrene, men får ikke lagt inn, avvist eller gjort om (test i kjernen); kontor, leder og admin kan alt; bruker uten ansattrad ser ingenting.
- [ ] Databasen avviser: `rejected` uten grunn, `converted` uten `assignment_id`, `assignment_id` på en ordre som ikke er `converted`, oppdrag med kontor fra en annen organisasjon, ordre som peker på oppdrag i en annen organisasjon, to oppdrag med samme nummer i samme organisasjon, ukjent `source`/`status`/`assignment_type`.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for hver spørring som tar `organizationId`; de tre tabellene i `tests/tenant-tables.ts`).
- [ ] Virker på iPad-størrelse (e2e: ny ordre → gjør om → nummeret vises; ny ordre → avvis; i `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.65.

## Beslutninger (autonom modus, ført i `docs/09-apne-sporsmal.md` som A50–A54)
- **A50:** Adresse, gnr/bnr, seksjon, borettslag og hvem som bestilte lagres som tekst på ordren til planpunktene for eiendom/matrikkel og kontakter/firma kommer. Kilde: 4.3 («slik bestillingen sa det»), planpunktet, regel 1. Endres ved at de senere punktene flytter feltene.
- **A51:** Én nummerserie per organisasjon og år (`scope = assignment`, `prefix = ÅÅÅÅ-`, 5 sifre), laget av det første oppdraget i året, med lås i databasen (upsert med `RETURNING`). Året regnes i norsk tid når oppdraget lages. Ingen startsekvens per takstmann (IVIT). Kilde: D9, 4.3. Endres ved å gi serien en innstilling for prefiks eller startverdi.
- **A52:** Se ordre krever `organization.read`; legge inn, avvise og gjøre om krever `assignment.edit`. Ingen ny rettighet. Kilde: rettighetsmatrisen avsnitt 5 (kontor: «Ordre, oppdrag …»; `assignment.edit`: «Endre ordre …»), A18–A21.
- **A53:** Oppdraget som lages, er minimalt: nummer, kontor (valgt i dialogen, forhåndsvalgt fra den ansattes kontor), type `condition_report`, status `ordered`, kopi av `external_ref`. Utstedende selskap, eiendom og team kommer i sine planpunkter. Kilde: planen fase 2a, A17-mønsteret. Endres ved å legge til feltene når punktene bygges.
- **A54:** Avvisning er en status med grunn, ikke myk sletting; avviste ordre blir stående i listen. En ordre kan ikke endres etter at den er lagret; feil rettes med ny ordre. Kilde: 4.3 (`rejected`, `rejected_reason`; «kan avvises»), regel 3, regel 1. Endres ved å bygge redigering senere.

## Roller
- **utvikler:** migrering, skjema, faste koder, tjenestene i `src/core/orders` og `src/core/assignments`, sidene og handlingene, menypunktet, dokumentene og versjonen.
- **testskriver** (i parallell, bare testfiler og fabrikker): fabrikker, tenant-registeret, tilgang og tenant-isolasjon, nummerserien med samtidighet og årsskifte, CHECK-reglene, hendelser og revisjonslogg, e2e.
- **sikkerhet-personvern:** tre nye tabeller med `organization_id`, sammensatte fremmednøkler, at ingen id fra skjemaet brukes til filtrering, og at ordren ikke lagrer mer personopplysninger enn bestillingen trenger (`ordered_by_text` er fri tekst: ingen fødselsnummer, ingen veiledning til å skrive inn mer enn navn og firma).
- **test-leder:** testplanen `docs/funksjoner/fase2a-manuell-ordre-testplan.md` før bygging, og godkjenning før PR.
- **forenkler:** runde 1 på kortet (kan noe kuttes uten at akseptkriteriene ryker?).

Ikke med: ux-ansvarlig og ui-designer (rammen Fjord og skjemadelene finnes; sidene følger adminområdet), fagansvarlig (ingen fagtekster), arkitekt (ingen ny ADR; nummerserien er beskrevet i domenemodellen).

## Byggingen deles i to biter som ikke henger sammen
1. **utvikler:** `src/db/schema/orders.ts`, `assignments.ts`, `number-sequences.ts` (+ `index.ts`, migrering), `src/core/orders/*`, `src/core/assignments/*`, `src/app/(ansatt)/ordre/*`, `layout.tsx` (menypunkt), `docs/05-domenemodell.md`, `docs/07-utviklingsplan.md`, `docs/09-apne-sporsmal.md`, `package.json`.
2. **testskriver:** `tests/factories.ts`, `tests/factories.test.ts`, `tests/tenant-tables.ts`, `src/core/orders/*.test.ts`, `src/core/assignments/*.test.ts`, `src/app/(ansatt)/ordre/actions.test.ts`, `e2e/fase-2a-ordre.spec.ts`.
   Testskriveren skriver mot grensesnittet i dette kortet (funksjonsnavn, parametre og feiltekster i Omfang 5). Avviker utvikleren fra det, står det i kortet under «Avgjørelser etter gjennomgangen», og prosjektlederen retter testene ved sammenslåingen.

## Åpne spørsmål
- Ingen som stopper oppgaven. Til Ståle når han er tilbake (ikke blokkerende): om feste- og bruksenhetsnummer skal med på ordren alt nå, eller først med matrikkelen; og om oppdragsnummeret skal ha et annet format enn `2026-00123` (D9 er tatt inn, men formatet er Claudes forslag).
