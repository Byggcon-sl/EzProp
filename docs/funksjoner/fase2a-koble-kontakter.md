# Funksjon: Koble partene og bestilleren til kontakter og firma

- **Fase:** 2a – Rapporten på PC (punktet «Koble partene på oppdraget og bestilleren til kontakter og firma» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/assignments`, `src/core/orders`, lesing fra `src/core/contacts`; sidene `/oppdrag/[id]`, `/ordre/ny` og `/ordre/[id]`)
- **Branch:** `fase2a-koble-kontakter` (bygger på `main`, der kontaktregisteret fra PR #95 og partene fra PR #87 er merget)
- **Status:** klar til bygging (05.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: megleren søkes opp med noen bokstaver, og navn, firma, e-post og telefon fylles ut av seg selv i stedet for å skrives på nytt på hvert oppdrag. Reklamasjoner: færre skrivefeil i e-post og navn, så rapporten går til riktig person. KI først: koblingen er kroken for at e-post-til-ordre (krok A1) senere kan foreslå en kjent kontakt som bestiller og part, og kontoret bare godkjenner. Ingen KI nå.

## Problem
Kontaktregisteret finnes (A79–A83), men partene på oppdraget og bestilleren på ordren er fortsatt fritekst (A51, A60). Samme megler skrives inn for hånd på hvert oppdrag. Vi kan ikke se hvilke oppdrag en megler har vært med på, og fase 3 (rutiner, utsending) og fase 4 (adresseboka med tall) trenger koblingen. Lar vi være, blir registeret et sidespor som ingen bruker.

## KI først
Ikke nå. Kontakter er personopplysninger og sendes **aldri** til KI (domenemodellen 4.2). Søket skjer i vår egen database. Kroken: når e-post-til-ordre kommer, kan den foreslå `ordered_by_contact_id` ut fra avsenderen, og kontoret godkjenner. Takstmannen eller kontoret velger alltid selv.

## Brukerhistorier
- Som **kontor** vil jeg **søke opp megleren når jeg legger til en part** slik at **navn, firma, e-post og telefon fylles ut uten at jeg skriver dem**.
- Som **kontor** vil jeg **velge bestilleren fra registeret når jeg legger inn en ordre** slik at **vi vet hvilken megler som bestilte**.
- Som **takstmann** vil jeg **se at en part er koblet til en kontakt og åpne kontakten** slik at **jeg ser notatet om megleren**.

## Omfang
**Med:**
1. **Migrering** (neste ledige nummer på `origin/main` rett før PR; en annen kjøring lager `bygninger-areal-rom` samtidig, nummereres om ved behov):
   - `assignment_parties`: `contact_id` (uuid, valgfri) og `firm_id` (uuid, valgfri). Sammensatte fremmednøkler `(organization_id, contact_id)` → `contacts (organization_id, id)` og `(organization_id, firm_id)` → `firms (organization_id, id)`. Indeks `(organization_id, contact_id)`.
   - `orders`: `ordered_by_contact_id` og `ordered_by_firm_id` (uuid, valgfri), med de samme sammensatte fremmednøklene. Indeks `(organization_id, ordered_by_contact_id)`.
   - Ingen CHECK om «minst én av kontakt og firma»: fritekst uten kobling skal fortsatt være lov (A60, eksisterende rader).
2. **Én verdi inn, firmaet følger kontakten.** Skjemaene får bare `contactId` (valgfri uuid, tom blir `null`). Kjernen slår opp kontakten (filtrert på `grant.organizationId`, ikke slettet) i samme transaksjon og setter `firm_id`/`ordered_by_firm_id` til kontaktens `firm_id` (eller `null`). Fremmed, ukjent eller slettet kontakt gir `ContactNotFoundError` («Kontakten finnes ikke.»), og ingenting lagres. Ingen egen firmavelger.
   - Oppslaget er en liten intern hjelper `findContactForLink(tx, organizationId, contactId)` i `src/core/contacts` (eksportert fra `index.ts`), som returnerer `{ id, firmId }` eller `null`. Den tar `organizationId` fra grant hos den som kaller.
3. **Fritekstfeltene beholdes og er det som vises.** Velges en kontakt på skjermen, fylles navn, firma, e-post og telefon ut fra kontakten (i skjemaet, før lagring), og brukeren kan rette dem. Kjernen lagrer det som sendes; den overskriver ikke fritekst. Endres kontakten senere, endres ikke partene (øyeblikksbilde, se beslutning 2).
4. **Tjenestene:**
   - `addParty` og `updateParty` tar `contactId`. `contactId` og `firmId` kommer med i `PARTY_FIELDS`, og som id-er er de loggbare (fra/til i revisjonsloggen). Hendelsene `assignment.party_*` er uendret (`{ partyId, role }`).
   - `createOrder` tar `contactId` (feltnavn i skjemaet `orderedByContactId`). Ordren kan fortsatt ikke endres etterpå (A55). Revisjonsloggen får `orderedByContactId` og `orderedByFirmId` (id-er).
   - `getAssignment` (partene) og `getOrder` returnerer `contactId`/`firmId` og navnet på den koblede kontakten (venstre-kobling filtrert på `grant.organizationId`; slettet kontakt gir ingen lenke, men friteksten står).
   - **Søket:** ny server action `searchContactsAction(query)` i `src/app/(ansatt)/kontakter/` som kaller den eksisterende `listContacts` og returnerer høyst 10 treff med `id`, navn, firmanavn, e-post og telefon. Under 2 tegn gir tom liste uten kall. Ingen ny kjernefunksjon; `listContacts` har allerede tenant-test.
5. **Skjermene** (PC først, må virke i iPad-størrelse; rammen Fjord; ingen ny avhengighet):
   - Felles klientkomponent `ContactPicker` i `src/app/(ansatt)/kontakter/contact-picker.tsx`: søkefelt «Søk i kontakter» med treffliste under (navn, firma). Trykk på et treff velger kontakten, fyller feltene og viser «Koblet til <navn>» med knappen «Fjern kobling». Skjult felt `contactId`. Ingen treff: «Ingen kontakter passer. Skriv inn opplysningene under, eller legg inn kontakten i registeret.» med lenke til `/kontakter/ny`. Tastatur: piltaster og Enter i trefflisten, Escape lukker.
   - **Partsskjemaet** på `/oppdrag/[id]` (legg til og endre): `ContactPicker` øverst. **Partskortet** viser lenken «Kontakt i registeret» til `/kontakter/[id]` når parten er koblet.
   - **`/ordre/ny`:** `ContactPicker` over feltet «Bestilt av». Valgt kontakt fyller «Bestilt av» med «Navn, Firma». **`/ordre/[id]`** viser lenke til kontakten når ordren er koblet.
   - Server actions: `contactId` som ikke er uuid gir feltfeilen «Kontakten finnes ikke.» uten kall til kjernen. Loggkontrakten som før (bare rute, bruker-id, id-er og feilnavn).
6. **Tester** (testskriver; oppdiktede data som i kontaktregisteret):
   - Database: part og ordre med kontakt fra en annen organisasjon avvises av fremmednøkkelen (direkte innsetting).
   - **Tenant-isolasjon og IDOR (regel 2):** `addParty`, `updateParty` og `createOrder` med Bs `contactId` gir `ContactNotFoundError`, og ingen rad lagres eller endres. `getAssignment` og `getOrder` viser aldri navnet på en kontakt fra en annen organisasjon. `expectTenantIsolation` for `findContactForLink`. `searchContactsAction` gir bare treff fra egen organisasjon.
   - Firma følger kontakten: kontakt med firma gir `firm_id`; uten firma gir `null`; fjernet kobling gir begge `null`. Slettet kontakt kan ikke velges.
   - Fritekst overskrives ikke av kjernen; endring av kontakten etterpå endrer ikke parten.
   - **Logg:** revisjonslogg og hendelser som tekst inneholder aldri navn, e-post eller telefon fra kontakten eller parten; id-ene står der.
   - Handlingene: ugyldig `contactId` gir feltfeil; søk under 2 tegn gir tom liste; loggeren får aldri skjemaverdier eller søketekst.
   - **E2E i `pc` og `ipad`:** legg inn kontakt med firma → på oppdraget: legg til part, søk, velg → feltene er fylt → lagre → partskortet lenker til kontakten. Ny ordre: velg bestiller → ordresiden lenker til kontakten.
7. **Dokumenter:** domenemodellen 4.2 og 4.3 («Bygget i fase 2a», fjern fra «Venter»), ordlisten (`ContactPicker`, `findContactForLink`, `searchContactsAction`, `ContactNotFoundError`), personvernerklæringen (koblingen mellom oppdrag/ordre og kontakt, aldri til KI), planpunktet krysses av, beslutningene i `docs/09-apne-sporsmal.md` med neste ledige A-numre på `origin/main` rett før PR (sjekk også `fase2a-bygninger-areal-rom`). Versjon 0.2.82 → 0.2.83 (eller neste ledige).

**Ikke med (bevisst utelatt):**
- **Lage ny kontakt fra parten eller ordren** (og kilden `order`). Brukeren lenkes til `/kontakter/ny`. Kommer med e-post-til-ordre.
- **Bestilleren blir automatisk megler-part** når ordren gjøres om til oppdrag. God tidsbesparelse, men eget småpunkt; foreslås i `docs/09-apne-sporsmal.md`.
- Egen firmavelger og part som bare er et firma (uten kontakt).
- Kobling av ordre etter at den er lagret (A55).
- Automatisk oppdatering av partene når kontakten endres.
- Liste over oppdrag per kontakt eller firma (adresseboka, fase 4).
- Fjerning og sammenslåing av kontakter (eget planpunkt).
- `receives_survey`, `is_primary`, rollekodene `client` og `other`.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | ja når `access.inspectors_edit_all` er på (`assignment.edit`) |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja |

Ingen ny rettighet. Søket krever `organization.read` (via `listContacts`).

## Data
Fire nye valgfrie kolonner med sammensatte fremmednøkler (punkt 1). Ingen nye tabeller, ingen nye faste koder.

## Skjermer
Legge til megler som part i dag: 4 felt skrevet for hånd. Etter: skriv 2–3 bokstaver, ett trykk på treffet, «Lagre». Samme for bestiller på ny ordre.

## Regler
Ingen TG-regler.

## Beslutninger tatt av prosjektlederen (autonom modus, føres i `docs/09-apne-sporsmal.md`)
1. **Firmaet på parten og ordren følger kontakten.** Bare `contactId` sendes inn; kjernen setter firmaet. Enkleste vei, ingen motstrid mellom kontakt og firma. Kilde: planpunktet, domenemodellen 4.2 (`contacts.firm_id`). Endres ved å legge til egen firmavelger.
2. **Fritekstfeltene er et øyeblikksbilde.** Det som sto på oppdraget da rapporten ble laget, endres ikke når kontakten endres senere; rapporten viser alltid det som ble lagret. Kilde: regel 3 (sporbarhet), A60. Endres ved å lage «oppdater fra kontakten».
3. **Kobling er valgfri.** Fritekst uten kontakt er fortsatt lov, slik at kontoret ikke må legge inn en kjøper i registeret. Kilde: A60, D17 (kilde og formål for personopplysninger). Endres ved å kreve kontakt for enkelte roller.
4. **Ordren kobles bare når den legges inn** (A55 står).

## Akseptkriterier
- [ ] Velges en kontakt, fylles navn, firma, e-post og telefon ut, og parten lagres med `contact_id` og kontaktens `firm_id` (test og e2e)
- [ ] Ny ordre kan lagres med bestiller fra registeret, og ordresiden lenker til kontakten (test og e2e)
- [ ] Kontakt fra en annen organisasjon kan ikke kobles, verken via tjenesten eller direkte i databasen (test, IDOR og fremmednøkkel)
- [ ] Søket viser bare kontakter i egen organisasjon (test)
- [ ] Revisjonslogg og hendelser har aldri navn, e-post eller telefon (test)
- [ ] Parter uten kobling virker som før (test)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Roller
- **utvikler** og **testskriver** i parallell. Biter som ikke henger sammen: (a) migrering, skjema og kjernen (`assignments`, `orders`, `findContactForLink`) med database- og tenant-tester, (b) `ContactPicker`, søkehandlingen og skjermene med e2e, (c) dokumentene.
- **sikkerhet-personvern**: personopplysninger kobles på tvers av tabeller (tenant, logg uten verdier, aldri til KI). Feiler den på kvoten, kjører prosjektlederen gjennomgangen for hånd etterpå.
- Ikke arkitekt (kolonnene står i domenemodellen, mønsteret med sammensatte fremmednøkler finnes), ikke UX/UI (søk og liste i samme stil som `/kontakter`, beskrevet over), ikke fag, ikke KI.

## Åpne spørsmål
- Ingen som stopper punktet. Forslaget «bestilleren blir megler-part automatisk» føres som forslag.
