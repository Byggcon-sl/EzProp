# Funksjon: Søk i ordrelisten og i arbeidskøen (T2)

- **Fase:** 2a (punkt fra Ståles svar 12.11.2026, T2: «Ja, nå»)
- **Modul:** kjerne (`src/core/orders`, `src/core/assignments`, felles søkehjelper i `src/shared/lib`)
- **Branch:** `sok-ordre-arbeidsko` (bygger på main)
- **Status:** utkast (13.11.2026, prosjektleder)
- **Støtter hovedmål:** De ansatte: kontoret finner ordren eller oppdraget med én søking når megleren ringer, uansett om de husker adressen, nummeret, megleren eller gnr/bnr. / KI i bunnen: søket bruker de samme strukturerte feltene som KI skal bruke senere, og søketeksten sendes aldri til KI. / Reklamasjoner: mindre fare for at kontoret retter eller svarer på feil oppdrag.

## Problem
Ordrelisten (`/ordre`) har ikke søk og viser alle ordrer uten grense. Med ca. 2000 ordre i året blir den fort uoversiktlig og treg. Arbeidskøen søker bare på oppdragsnummer og adresse, så kontoret finner ikke oppdraget når megleren oppgir sitt eget ordrenummer, sitt navn eller matrikkelen. Lar vi være, må kontoret bla eller gå via andre sider, og det er lett å velge feil oppdrag.

## KI i bunnen
- KI gjør ingenting i selve søket nå. Søket er en fast spørring i databasen, virker likt hver gang og trenger ikke KI. Søk med vanlig språk og «globalt søk» hører til «Søk og arkiv» i en senere fase.
- Søketeksten kan inneholde navn, adresse og matrikkel. Den sendes **aldri** til KI, logges ikke i `ai_usage_log` og skrives ikke i revisjonsloggen eller hendelser.
- Søket bruker de strukturerte feltene (adresse, nummer, parter, matrikkel) som allerede ligger med organisasjons-id. Ingen nye data lagres.

## Brukerhistorier
- Som **kontor** vil jeg **søke i ordrelisten på adresse, megler, meglerens ordrenummer eller gnr/bnr** slik at **jeg finner ordren mens megleren er i telefonen**.
- Som **takstmann** vil jeg **søke i arbeidskøen på det samme** slik at **jeg finner oppdraget uten å bla**.
- Som **kontor eller leder** vil jeg **se at søket har treff i en annen fane** slik at **jeg ikke tror oppdraget mangler** (T-0029).

## Omfang
**Med:**
1. **Felles søkehjelper** i `src/shared/lib/` (for eksempel `like-pattern.ts`): trimmer, kutter til 100 tegn og escaper `\`, `%` og `_`. `src/core/contacts/search.ts` og `work-queue.ts` bruker den i stedet for egne kopier. Ingen endring i hva kontaktsøket finner.
2. **Søkefeltene, likt i begge lister** (ett felt, `?q=`, delvis treff uten forskjell på store og små bokstaver):
   - adresse: `orders.address_text` og eiendommens `properties.address`
   - oppdragsnummer: `assignments.number`
   - ordrenummer (meglerens referanse): `orders.external_ref`
   - oppdragsgiver og parter: `orders.ordered_by_text`, og `assignment_parties.name` og `firm_name` (ikke slettet)
   - matrikkel: `gnr/bnr`, `gnr/bnr/fnr` og `gnr/bnr/fnr/snr` fra ordren og fra `cadastral_units` (ikke slettet). «12/34» finner 12/34 og 12/34/0/5. Mellomrom rundt «/» tåles.
   - Alle undertabeller hentes med `EXISTS` og filtreres på `grant.organizationId` og `deleted_at is null`. Ingen doble rader.
3. **Ordrelisten (`/ordre`):** søkefelt med `SearchBox` («Søk på adresse, nummer, megler eller gnr/bnr»), `listOrders(actor, organizationId, { query })`. Høyst 50 rader (`ORDER_LIST_LIMIT`), nyeste først, som i dag. Er det flere: «Viser 50 av N. Bruk søket for å finne flere.» (samme mønster som arbeidskøen). Tom liste med søk: «Ingen ordre passer søket.»
4. **Arbeidskøen:** samme søkefelter som over (utvider `workQueueWhere`). Tellingene per fane følger søket som i dag.
5. **T-0029 (lite, arbeidskø):** (a) er fanen tom og andre faner har treff for søket, står det «Ingen treff i denne fanen. Treff i: Ferdig (1).» med lenker til fanene. (b) Ansatte uten takstmann-rolle (kontor, leder, admin) får «Alle» som standard når `?mine=` ikke står i adressen. Takstmenn får «Mine» som i dag.
6. **Nattløkkens punkt 3 (fokusringen):** regelen `[tabindex="-1"]:focus { outline: none }` i `src/app/globals.css` avgrenses til `#hovedinnhold`. Kortet i arbeidskøen får synlig fjord-ring når siden hopper tilbake til det etter lagret notat.
7. **Nattløkkens punkt 5 (indeks for `ILIKE '%tekst%'`):** **ADR 0010 «Søk uten egne søkeindekser foreløpig»**. Beslutning: beholde `ILIKE` uten pg_trgm nå. Begrunnelse: ca. 2000 ordre i året (20 000 på ti år) er lite for PostgreSQL; spørringen er alltid avgrenset på organisasjon med indeks; pg_trgm må slås på som utvidelse i Azure (serverparameter, endring i drift som Ståle eier). ADR-en sier når vi bytter: når søket i ordrelisten eller arbeidskøen tar over 200 ms på testdataene i nattløkken, eller ved «Søk og arkiv». Nattløkken får én linje i sjekklisten: mål søketiden med `EXPLAIN ANALYZE` på 20 000 oppdiktede ordre. Ingen egen ytelsestest i CI. Ført som «lett å endre».
8. **Nattløkkens punkt 6 (sidegrense):** ordrelisten får grensen i punkt 3. `listAgreements` og sertifiseringslistene er ikke med (små lister, egen oppgave ved behov).
9. Versjon 0.10.7 → 0.10.8 (eller neste ledige patch etter main). Ordlisten i `docs/05-domenemodell.md` (avsnitt 8): `ORDER_LIST_LIMIT`, `likePattern`. Beslutningene føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene …»).

**Ikke med (bevisst utelatt):**
- Rette en ordre etter lagring (T1) og T-0031 («kansellert» i ordrelisten). Det gjøres på branchen `rette-ordre-etter-lagring`. Ikke rør `updateOrder`, ordresiden eller ordreskjemaet. Rører begge `listOrders` eller `ordre/page.tsx`, flettes main inn før merge.
- pg_trgm, nye indekser og søk som tåler skrivefeil.
- Globalt søk, søk i kontakter/firma utover den felles hjelperen, lagrede filtre, eksport («Søk og arkiv», senere fase).
- Søk på e-post og telefon til parter (personopplysninger som ikke trengs for å finne oppdraget).
- Bla-sider («neste side») i ordrelisten. Søket er veien til eldre ordre.
- Sidegrense på `listAgreements` og sertifiseringslistene.
- Varsel om dublett (T3), flere rom (T4).
- T-0009, T-0027 (oppdragssiden) og T-0030 (kontakter): andre områder.
- KI i søket.

## Tilgang
| Rolle | Se og søke | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | ingen endring |
| kontor | ja | ingen endring |
| leder | ja | ingen endring |
| admin | ja | ingen endring |

All filtrering på `grant.organizationId`. Søket gir aldri treff fra en annen organisasjon, heller ikke via parter, eiendom eller matrikkel som tilfeldigvis har samme tekst.

## Data
Ingen nye tabeller, felt eller migreringer. Ingen nye faste koder.

## Skjermer
- **Ordrelisten (PC og iPad):** søkefelt øverst under overskriften, «Søk»-knapp. Hovedhandling: finne og åpne ordren. Før: bla i hele listen. Etter: skriv, trykk Søk, trykk raden (2 trykk + skriving).
- **Arbeidskøen:** samme søkefelt som i dag, nye treff. Tom fane med treff andre steder viser lenker til fanene (1 trykk).

## Regler
Ingen fagregler. Søkeregelen (felter og matrikkelformat) testes med enhetstester.

## Akseptkriterier
- [ ] Ordrelisten finner på adresse, oppdragsnummer, ordrenummer, oppdragsgiver, partsnavn, partens firma og matrikkel (`12/34`, `12 / 34`, `12/34/0/5`) (test per felt).
- [ ] Arbeidskøen finner på de samme feltene, og tellingene per fane stemmer med søket (test).
- [ ] `%`, `_` og `\` i søket er vanlige tegn (test).
- [ ] Slettede parter, slettet matrikkel og slettede ordre gir ikke treff (test).
- [ ] Bruker i annen organisasjon får ikke tilgang, og like tekster i en annen organisasjon gir ikke treff (`expectTenantIsolation` for `listOrders` med søk og for arbeidskøen med søk).
- [ ] Ordrelisten viser høyst 50 rader og meldingen «Viser 50 av N …» når det er flere (test).
- [ ] Tom fane med treff i andre faner viser lenkene (T-0029 a), og kontor/leder/admin starter på «Alle» (T-0029 b) (test og e2e). T-0029 settes til «rettet» med PR-nummeret.
- [ ] Kortet i arbeidskøen har synlig fokusring etter lagret notat; hopplenken til `#hovedinnhold` har fortsatt ingen ring (e2e).
- [ ] ADR 0010 finnes, og nattløkkens punkt 3, 5 og 6 er merket ryddet i tilstandsfilen.
- [ ] Søketeksten havner ikke i revisjonslogg, hendelser eller `ai_usage_log` (test).
- [ ] Virker på iPad-størrelse (e2e: søk i ordrelisten og arbeidskøen).
- [ ] `pnpm lint`, `typecheck`, `test` og `test:e2e` grønne. Versjonen er økt.

## Åpne spørsmål
- Ingen som stopper. Beslutningene (ADR 0010, grense 50, «Alle» som standard for kontor/leder/admin, ingen søk på e-post/telefon) føres som «lett å endre» i `docs/09-apne-sporsmal.md`.

## Roller
arkitekt (ADR 0010, felles hjelper, spørringen), ux (søkefelt, tom fane, fokusring), sikkerhet-personvern (tenant-isolasjon i undertabellene, søketekst i adressen og loggene), utvikler og testskriver i parallell. KI-rollen sjekker bare at søketeksten ikke går til KI.

Bitene som kan bygges hver for seg:
- A: felles hjelper + søket i `listOrders` + ordrelisten med grense.
- B: søket i arbeidskøen + T-0029.
- C: fokusringen + ADR 0010.
