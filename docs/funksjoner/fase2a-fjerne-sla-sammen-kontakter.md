# Funksjon: Fjerne og slå sammen like kontakter og firma

- **Fase:** 2a – Rapporten på PC (punktet «Fjerne (myk sletting fra skjermen) og slå sammen like kontakter og firma» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/contacts`, ny rettighet i `src/core/access`); sidene `/kontakter/[id]` og `/firma/[id]`
- **Branch:** `fase2a-fjerne-sla-sammen-kontakter` (bygger på `main`)
- **Status:** klar for bygging (05.11.2026, rettet etter test-leder)
- **Støtter hovedmål:** Tid: én kontakt per megler gjør at søket i kontaktvelgeren gir ett treff, ikke tre like, og ingen må lure på hvilken som er riktig. Reklamasjoner: rapporten og varslene går til den riktige og oppdaterte kontakten, ikke en gammel dublett med feil e-post. KI først: se under; ingen KI nå.

## Problem
Kontaktregisteret (A79–A83) har ingen sperre mot like kontakter, og firma uten organisasjonsnummer kan legges inn flere ganger. Partene og bestilleren kobles nå til kontaktene (A84–A92). Når samme megler står to ganger, spres oppdragene på to kontakter, og fase 3 (utsending) og fase 4 (adresseboka med tall) teller feil. Feilregistrerte kontakter kan heller ikke fjernes fra skjermen i dag. Lar vi være, blir registeret rotete, og ingen stoler på det.

## KI først
Ikke nå. Kontakter er personopplysninger og sendes aldri til KI (domenemodellen 4.2). Kroken for senere: en enkel regel (samme e-post, telefon eller organisasjonsnummer) kan foreslå «Dette ser ut som samme kontakt» og la leder godkjenne sammenslåingen. Det er en regel i vår egen database, ikke KI, og det bygges ikke nå (se «Ikke med»).

## Brukerhistorier
- Som **leder** vil jeg **fjerne en kontakt eller et firma som er lagt inn ved en feil** slik at **den ikke dukker opp i søket**.
- Som **leder** vil jeg **slå sammen to like kontakter (eller to like firma)** slik at **alle oppdrag og ordrer står på den ene, og den andre forsvinner fra listene**.
- Som **admin** vil jeg **se i revisjonsloggen hvem som fjernet eller slo sammen, og når** slik at **vi kan rette opp ved feil**.

## Omfang
**Med:**
1. **Ny rettighet `contacts.manage`** i `src/core/access/permissions.ts`: «Fjerne og slå sammen kontakter og firma. Leder og admin.» Gis til `manager` (og admin får alle). Ikke i `grantablePermissions`. Takstmann og kontor har den ikke, uansett `access.inspectors_edit_all`.
2. **Tjenester i `src/core/contacts`** (eksportert fra `index.ts`). Alle kaller `requireOrganizationAccess(actor, organizationId, "contacts.manage")` først og filtrerer på `grant.organizationId`. Fremmed, ukjent, allerede fjernet eller ugyldig id gir `AccessDeniedError`, og ingenting endres. Alt skjer i én transaksjon, og radene som endres låses (`for update`).
   - `removeContact(actor, organizationId, contactId)`: setter `deleted_at` og `updated_by`. Koblingene på parter og ordrer står urørt (historikk; friteksten er det som vises). Revisjonslogg `contact.removed` med `{ contactId }`.
   - `removeFirm(actor, organizationId, firmId)`: setter `deleted_at`. Kontaktene i firmaet beholdes og står uten firma på skjermen (samme filter som `firmJoin` i dag). Returnerer antall aktive kontakter som var koblet, slik at bekreftelsen kan vise det. Revisjonslogg `firm.removed` med `{ firmId, contactCount }`.
   - `mergeContacts(actor, organizationId, { keepId, removeId })`: `keepId` og `removeId` må være ulike, begge aktive og i organisasjonen. Flytter `assignment_parties.contact_id` og `orders.ordered_by_contact_id` fra `removeId` til `keepId`, og setter `firm_id`/`ordered_by_firm_id` på de flyttede radene til firmaet til kontakten som beholdes (firmaet følger kontakten, som i A84–A92; slettet firma gir `null`). Myk-sletter `removeId`. Kontakten som beholdes, endres ikke. Revisjonslogg `contact.merged` med `{ keepId, removeId, partyCount, orderCount }`.
   - `mergeFirms(actor, organizationId, { keepId, removeId })`: samme krav. Flytter `contacts.firm_id`, `assignment_parties.firm_id` og `orders.ordered_by_firm_id` fra `removeId` til `keepId`, og myk-sletter `removeId`. Firmaet som beholdes, endres ikke (heller ikke organisasjonsnummeret). Revisjonslogg `firm.merged` med `{ keepId, removeId, contactCount, partyCount, orderCount }`.
   - Flyttingen gjelder alle rader i organisasjonen som peker på den som fjernes, også myk-slettede parter, slik at ingen rad peker på en fjernet kontakt etter en sammenslåing.
   - **Revisjonsloggen får bare id-er og antall**, aldri navn, e-post, telefon, notat eller organisasjonsnummer.
   - Feil: `keepId === removeId` gir `MergeSameRecordError` («Velg to ulike kontakter.» / «Velg to ulike firma.»).
3. **Skjermene** (PC først, må virke i iPad-størrelse; rammen Fjord; ingen ny avhengighet). Knappene vises bare når den innloggede har `contacts.manage` (flagget kommer fra serveren, som `canEditOrders` i dag; ingen tilgangslogikk i komponenten).
   - **`/kontakter/[id]` og `/firma/[id]`:** knappen «Fjern» (sekundær, rød tekst). Trykk viser bekreftelse på siden: «Fjerne <navn>? Kontakten vises ikke lenger i listen og søket. Oppdrag og ordrer beholder navnet som står på dem.» For firma i tillegg: «<n> kontakter er koblet til firmaet. De beholdes, men står uten firma.» Knappene «Fjern» og «Avbryt». Etter fjerning: tilbake til listen med beskjeden «<navn> er fjernet.»
   - **Slå sammen:** knappen «Slå sammen med …» på samme sider åpner `/kontakter/[id]/sla-sammen` (og `/firma/[id]/sla-sammen`). Søkefelt (den eksisterende søkefunksjonen, høyst 10 treff, den åpne kontakten vises ikke i treffene). Når den andre er valgt: de to vises side om side (navn, firma, e-post, telefon, antall oppdrag og ordrer; for firma: navn, organisasjonsnummer, antall kontakter, oppdrag og ordrer). Valg «Behold denne» på hver (standard: den åpne). Knappen «Slå sammen» med teksten «<navn> fjernes. Oppdrag og ordrer flyttes til <navn>.» Etter sammenslåing: til siden for den som beholdes, med beskjeden «Kontaktene er slått sammen.»
   - Server actions: id som ikke er uuid gir «Kontakten finnes ikke.» / «Firmaet finnes ikke.» uten kall til kjernen. Loggkontrakten som før (bare rute, bruker-id, id-er og feilnavn).
4. **Tester** (utvikler og testskriver i parallell, se «Biter»). Ett sett med tester per funksjon. Punktene a, b og d må være med, ellers avviser test-leder.
   a. **Rettigheter** (enhetstest av `effectivePermissions`): leder og admin har `contacts.manage`. Takstmann har den ikke, verken med eller uten `access.inspectors_edit_all`. Kontor har den ikke. `grantPermission(…, "contacts.manage")` gir takstmann ingenting (ikke i `grantablePermissions`). Admin har den alltid (regel 11).
   b. **Tenant-isolasjon:** `expectTenantIsolation` for hver av de fire tjenestene. Den er laget for lesing, så den brukes slik: `seed` legger inn én kontakt eller ett firma per organisasjon (to per organisasjon ved sammenslåing) og returnerer id-en til raden som endres. `query` kjører tjenesten mot egen organisasjon og returnerer `[{ id }]` for raden som ble endret (den fjernede). Testen dekker da at bruker i A får avslag mot organisasjon B. Det virkelige IDOR-tilfellet testes for seg (c).
   c. **Tilgang per rolle:** takstmann (med og uten `access.inspectors_edit_all`) og kontor får `AccessDeniedError` på alle fire, og ingenting endres. Leder og admin lykkes.
   d. **IDOR** (egen organisasjon, id fra en annen), egne saker for kontakt og for firma: fremmed `keepId`, fremmed `removeId`, begge fremmede, og fremmed id til `removeContact`/`removeFirm`. Etter hver sak sjekkes at radene i begge organisasjoner er uendret: `deleted_at` og `updated_at` på kontakter og firma, `contact_id`/`firm_id` på parter og `ordered_by_contact_id`/`ordered_by_firm_id` på ordrer.
   e. **Feilsaker:** tilfeldig uuid som ikke finnes. Allerede fjernet `keepId` og allerede fjernet `removeId`, hver for seg. `MergeSameRecordError` for både kontakt og firma. Ingen mislykket forsøk gir rad i `audit_log`.
   f. **Sammenslåing av kontakter:** parter og ordrer flyttes til den som beholdes. Har den fjernede et annet firma enn den som beholdes, blir `firm_id`/`ordered_by_firm_id` firmaet til den som beholdes. Har den som beholdes et fjernet firma eller ikke noe firma, blir verdien `null`. Myk-slettede parter flyttes også. Fritekstfeltene på parter og ordrer er uendret. Den fjernede har `deleted_at`, den som beholdes er uendret.
   g. **Sammenslåing av firma:** kontakter, parter og ordrer flyttes, også myk-slettede kontakter i firmaet som fjernes. Organisasjonsnummeret til firmaet som beholdes er uendret. Etterpå kan et nytt firma få organisasjonsnummeret til det fjernede firmaet.
   h. **Samtidighet** (mønsteret i `contacts-transaction.test.ts`): kjør A→B og B→A samtidig. Nøyaktig én lykkes, og ingen rad peker på en fjernet kontakt etterpå.
   i. **Revisjonslogg:** riktig hendelseskode, bruker og organisasjon, og riktige tall (`partyCount`, `orderCount`, `contactCount`). Testen leter etter navn, e-post, telefon, notat og organisasjonsnummer som tekst i hele `metadata` og finner ingen.
   j. **Fjerning:** fjernet kontakt finnes ikke i `listContacts`, søket eller kontaktvelgeren, og `/kontakter/[id]` gir 404. Fjernet firma finnes ikke i firmasøket eller firmavelgeren, og kontaktene i firmaet vises uten firma. Egen test viser at raden fortsatt finnes med `deleted_at` (myk sletting).
   k. **Server actions og sider:** id som ikke er uuid gir riktig melding, og kjernen kalles ikke (spion). Loggen har bare rute, bruker-id, id-er og feilnavn. Flagget for knappene regnes ut på serveren og testes for hver rolle. `/kontakter/[id]/sla-sammen` og `/firma/[id]/sla-sammen` gir 404 for den som mangler `contacts.manage` (ikke bare skjulte knapper).
   l. **e2e (PC og iPad):** leder fjerner en kontakt med bekreftelse; leder fjerner et firma og ser at kontakten står uten firma; leder slår sammen to kontakter og ser at oppdraget står på den som beholdes; takstmann ser ingen knapper. Testskriver lager `ensureManager`/`logInAsManager` i `e2e/helpers.ts` med en oppdiktet e-post, etter samme mønster som `ensureInspector`/`logInAsInspector`.
   m. Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke. Lager utvikleren en migrering for en indeks, kjøres `pnpm db:migrate "$TEST_DATABASE_URL"` før testene.
5. **Dokumenter:** domenemodellen 4.2 (fjerning og sammenslåing), avsnitt 5 (ny rettighet), ordlisten (`contacts.manage`, `removeContact`, `mergeContacts`, «slå sammen» = merge, «behold» = keep), `docs/02-roller-og-tilgang.md` (tabellen), den interne personvernerklæringen (sletting og sammenslåing er myk, logges uten personopplysninger), planpunktet krysses av, beslutningene i `docs/09-apne-sporsmal.md`. Versjon 0.3.1 → 0.3.2 (eller neste ledige ved PR).
6. **Ingen migrering** ventet: `deleted_at` og alle koblingene finnes. Trenger utvikleren en indeks for `orders.ordered_by_firm_id` eller `assignment_parties.firm_id`, tas den med og begrunnes (neste ledige nummer etter 0020).

**Ikke med (bevisst utelatt):**
- Angre fjerning eller sammenslåing fra skjermen. Kan gjøres av admin i databasen ut fra revisjonsloggen; egen knapp kommer bare hvis behovet viser seg.
- Felt-for-felt-sammenslåing (velge e-post fra den ene og telefon fra den andre) eller sammenslåing av notater. Den som beholdes, endres ikke; rett den etterpå på vanlig måte.
- Sammenslåing av mer enn to om gangen.
- Automatiske forslag om dubletter (regel eller KI). Kroken står under «KI først».
- Endring av friteksten på parter og ordrer. Navnet som står på et oppdrag, er et øyeblikksbilde (A84–A92).
- Endring av lenken «Kontakt i registeret» på oppdragssiden for en fjernet kontakt (gir 404 som i dag). Etter sammenslåing peker lenken på den som beholdes.
- Liste over fjernede kontakter, eller en egen side for papirkurv.
- Fjerning og sammenslåing på iPad uten nett (kontaktregisteret er bare på nett i fase 2a).
- Oppslag i Brønnøysundregistrene (eget punkt senere i planen).

## Tilgang
| Rolle | Se | Fjerne og slå sammen |
|---|---|---|
| takstmann | ja (som i dag) | nei |
| kontor | ja | nei |
| leder | ja | ja (`contacts.manage`) |
| admin | ja | ja (alltid) |

## Data
Ingen nye tabeller eller kolonner. Ny rettighet `contacts.manage` (fast kode). Nye hendelseskoder i revisjonsloggen: `contact.removed`, `contact.merged`, `firm.removed`, `firm.merged`. Oppdater `docs/05-domenemodell.md` 4.2 og avsnitt 5.

## Skjermer
PC først, må virke i iPad-størrelse. Fjerne: 2 trykk (Fjern, bekreft). Slå sammen: åpne, søk, velg, (eventuelt bytt hvem som beholdes), bekreft: 4–5 trykk og noen bokstaver. I dag finnes ingen måte.

## Regler
Ingen fagregler. Tjenestereglene over har testsaker.

## Biter (kan bygges i parallell)
1. **Utvikler:** rettigheten, de fire tjenestene, feilklassen, server actions og de to skjermene.
2. **Testskriver:** testene i Omfang 4 (a–l) mot signaturene over, `ensureManager`/`logInAsManager` og e2e-testene. Ingen andre testfiler for det samme (erfaring fra PR #97 og #98: ett sett med tester).

## Akseptkriterier
- [ ] Leder og admin kan fjerne en kontakt og et firma med bekreftelse; de vises ikke lenger i listen, søket eller kontaktvelgeren (test og e2e)
- [ ] Leder og admin kan slå sammen to kontakter og to firma; parter, ordrer og (for firma) kontakter flyttes til den som beholdes, og den andre er myk-slettet (test)
- [ ] Ingenting slettes permanent (test som viser at raden finnes med `deleted_at`)
- [ ] Takstmann og kontor får avslag på alle fire, ser ingen knapper og får 404 på sidene for sammenslåing (test og e2e)
- [ ] Bare leder og admin har `contacts.manage`, også med `access.inspectors_edit_all` og `grantPermission` (enhetstest)
- [ ] Bruker i annen organisasjon får ikke tilgang, og id-er fra en annen organisasjon endrer ingenting (`expectTenantIsolation` og IDOR-test)
- [ ] Revisjonsloggen har bare id-er og riktige antall, ingen personopplysninger; mislykkede forsøk logges ikke (test)
- [ ] To samtidige sammenslåinger A→B og B→A: nøyaktig én lykkes (test)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` med neste ledige numre fra A108)
1. **Ny rettighet `contacts.manage` for leder og admin**, ikke `staff.manage` (som gjelder ansatte) eller `assignment.edit` (som kontor og takstmenn har). Oppgaven sier leder og admin; fjerning og sammenslåing endrer mange oppdrag på én gang. Kan endres ved å gi rettigheten til flere roller i `permissionsForRole`.
2. **Fjerning lar koblingene stå**, sammenslåing flytter dem. Friteksten på oppdraget er det som vises (A84–A92), så fjerning ødelegger ingen rapport, og historikken beholdes.
3. **Fjernet firma: kontaktene beholdes uten firma** (ingen sperre). Det enkleste som virker, og samme filter som i dag.
4. **Den som beholdes, endres ikke** ved sammenslåing. Felt-for-felt er mer arbeid og flere feilkilder; leder retter etterpå.
5. **Sammenslåing flytter også myk-slettede parter og kontakter**, slik at ingen rad peker på en fjernet kontakt eller et fjernet firma.
6. **Sidene for sammenslåing gir 404** for den som mangler `contacts.manage`, som ellers når noe ikke finnes for brukeren. Avslag med egen melding er ikke nødvendig; ingen vanlig bruker kommer dit uten knappen.

## Endringer etter test-leder (05.11.2026)
Alle 13 punktene er tatt inn i Omfang 4 og akseptkriteriene. Uenighet: ingen. Punkt 11 (side for takstmann) avgjort som 404, se beslutning 6. e2e for firma er tatt med, ikke fjernet fra kriteriet, fordi «kontakten står uten firma» er det leder faktisk må se.

## Åpne spørsmål
- Ingen som stopper oppgaven.
