# Funksjon: Fjerne og slå sammen like kontakter og firma

- **Fase:** 2a – Rapporten på PC (punktet «Fjerne (myk sletting fra skjermen) og slå sammen like kontakter og firma» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/contacts`, ny rettighet i `src/core/access`); sidene `/kontakter/[id]` og `/firma/[id]`
- **Branch:** `fase2a-fjerne-sla-sammen-kontakter` (bygger på `main`)
- **Status:** utkast (05.11.2026)
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
4. **Tester** (utvikler og testskriver i parallell, se «Biter»):
   - Tilgang per rolle: takstmann (både med og uten `access.inspectors_edit_all`) og kontor får `AccessDeniedError` på alle fire, og ingenting endres. Leder og admin lykkes.
   - `expectTenantIsolation` for hver av de fire funksjonene. IDOR: `keepId` eller `removeId` fra en annen organisasjon gir `AccessDeniedError`, og ingen rad i noen organisasjon endres.
   - Sammenslåing: parter og ordrer flyttes, firma følger kontakten som beholdes, myk-slettede parter flyttes også, den fjernede har `deleted_at`, den som beholdes er uendret. Firma: kontakter, parter og ordrer flyttes. Samme id to ganger avvises. Allerede fjernet avvises.
   - Fjerning: fjernet kontakt vises ikke i `listContacts`, søket eller kontaktvelgeren, og `/kontakter/[id]` gir 404. Fjernet firma: kontaktene står uten firma.
   - Revisjonsloggen inneholder ingen navn, e-post, telefon eller notat (test som leter etter verdiene i `audit_log`).
   - Unikhet: når et firma med organisasjonsnummer er fjernet, kan et nytt med samme nummer legges inn (indeksen gjelder bare aktive; test finnes, utvides ikke om den dekker dette).
   - e2e (PC og iPad): leder fjerner en kontakt med bekreftelse; leder slår sammen to kontakter og ser at oppdraget står på den som beholdes; takstmann ser ingen knapper.
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
2. **Testskriver:** testene for kjernen (tilgang, tenant-isolasjon, IDOR, flytting, revisjonslogg) mot signaturene over, og e2e-testen. Ingen andre testfiler for det samme (erfaring fra PR #97 og #98: ett sett med tester).

## Akseptkriterier
- [ ] Leder og admin kan fjerne en kontakt og et firma med bekreftelse; de vises ikke lenger i listen, søket eller kontaktvelgeren (test og e2e)
- [ ] Leder og admin kan slå sammen to kontakter og to firma; parter, ordrer og (for firma) kontakter flyttes til den som beholdes, og den andre er myk-slettet (test)
- [ ] Ingenting slettes permanent (test som viser at raden finnes med `deleted_at`)
- [ ] Takstmann og kontor får avslag på alle fire, og ser ingen knapper (test og e2e)
- [ ] Bruker i annen organisasjon får ikke tilgang, og id-er fra en annen organisasjon endrer ingenting (`expectTenantIsolation` og IDOR-test)
- [ ] Revisjonsloggen har bare id-er og antall, ingen personopplysninger (test)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` med neste ledige numre fra A108)
1. **Ny rettighet `contacts.manage` for leder og admin**, ikke `staff.manage` (som gjelder ansatte) eller `assignment.edit` (som kontor og takstmenn har). Oppgaven sier leder og admin; fjerning og sammenslåing endrer mange oppdrag på én gang. Kan endres ved å gi rettigheten til flere roller i `permissionsForRole`.
2. **Fjerning lar koblingene stå**, sammenslåing flytter dem. Friteksten på oppdraget er det som vises (A84–A92), så fjerning ødelegger ingen rapport, og historikken beholdes.
3. **Fjernet firma: kontaktene beholdes uten firma** (ingen sperre). Det enkleste som virker, og samme filter som i dag.
4. **Den som beholdes, endres ikke** ved sammenslåing. Felt-for-felt er mer arbeid og flere feilkilder; leder retter etterpå.
5. **Sammenslåing flytter også myk-slettede parter**, slik at ingen rad peker på en fjernet kontakt.

## Åpne spørsmål
- Ingen som stopper oppgaven.
