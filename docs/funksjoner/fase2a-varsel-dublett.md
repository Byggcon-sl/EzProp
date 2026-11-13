# Funksjon: Varsel om mulig dublett på ordren

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», punktet T3
- **Modul:** kjerne (`src/core/orders`), siden `/ordre/[id]`
- **Branch:** `varsel-dublett` (bygger på `main`, 13.11.2026)
- **Status:** klar for bygging (13.11.2026, prosjektleder). Versjon 0.10.18 → 0.10.19 (sjekk `package.json` på main ved start). Neste migrering er 0033 hvis den trengs (sjekk `drizzle/` ved start).
- **Kilde:** `docs/kartlegging/svar-fra-stale-2026-11-12.md`, T3 (forslag 62): «Ja, nå. Fast regel uten KI, og varselet stopper ikke lagringen.» Planteksten: «samme adresse eller matrikkel og overlappende tid».
- **Støtter hovedmål:**
  - **De ansatte:** kontoret ser med en gang at samme bolig er bestilt før (for eksempel to meglere i samme firma som sender samme bestilling, eller en ordre som er lagt inn to ganger). I dag oppdages det først når to takstmenn står på samme adresse, eller når fakturaen går ut to ganger.
  - **KI i bunnen:** regelen er en fast tjeneste i kjernen som e-post-til-ordre (KI lager ordreforslag, krok A1) skal kalle på samme måte senere. Treffene gir et ja/nei-signal per ordre som kan brukes uten å sende adresser til KI.
  - **Færre reklamasjoner:** færre doble oppdrag på samme bolig, og mindre risiko for to rapporter med ulikt innhold om samme bolig.

## Problem
Samme bestilling kan komme inn flere ganger (e-post sendt to ganger, megler og selger bestiller hver for seg, eller ny bestilling mens det første oppdraget pågår). EzProp sier ikke fra. Ståle vil ha et varsel, men lagringen skal aldri stoppes.

## KI i bunnen
- **Ingen KI i denne oppgaven** (Ståle: «fast regel uten KI»). Regelen er ren kode med testsaker.
- **Fra første dag for KI:** tjenesten `findPossibleDuplicateOrders` tar en ordre (eller ordrefeltene) og gir treff med grunn (`address`, `cadastre`). Når e-post-til-ordre kommer, kaller KI-flyten den samme tjenesten før forslaget vises, slik at kontoret ser varselet på forslaget. Ingen egen KI-variant av regelen.
- **Data som lagres for KI:** ingen nye. Treffene beregnes hver gang og lagres ikke.
- **Ingenting sendes til KI.** Adresse og matrikkel sendes aldri til KI (regel 14). Senere KI-bruk går gjennom `src/core/ai`.
- Applikasjonsloggen får bare antall treff og id-er, aldri adresse eller matrikkel.

## Brukerhistorier
- Som **kontor** vil jeg **se et tydelig varsel med lenke når jeg har lagret en ordre som ligner en annen** slik at **jeg kan avvise den doble før det blir to oppdrag**.
- Som **takstmann** vil jeg **se varselet når jeg retter adressen på en ordre** slik at **jeg oppdager at boligen alt er på et annet oppdrag**.

## Regelen (fast, uten KI)
En annen ordre er en **mulig dublett** når alt dette gjelder:
1. Samme organisasjon (`grant.organizationId`), ikke myk-slettet, og ikke ordren selv.
2. **Samme adresse eller samme matrikkel:**
   - **Adresse:** delen før første komma i `address_text`, med små bokstaver og bare bokstaver og tall (mellomrom, punktum og bindestrek tas bort). «Storgata 1A, 8006 Bodø» = «storgata 1 a» = «Storgata 1a». Normaliseringen står **ett sted** og brukes både i spørringen og i testene. Tom adresse etter normalisering gir aldri treff.
   - **Matrikkel:** samme `gnr` og `bnr` (begge utfylt), og samme `snr` (tom = tom). Tall sammenlignes uten innledende nuller og mellomrom («012» = «12»).
3. **Overlappende tid:** den andre ordren er ikke avvist, oppdraget er ikke kansellert (`assignments.deleted_at` er tom), og **enten** den er fortsatt åpen (status «mottatt», eller oppdraget er «bestilt» eller «under arbeid»), **eller** den kom inn høyst 90 dager før eller etter denne (`received_at`). 90 dager står som én navngitt konstant.

Avviste ordre og ordren selv viser aldri varsel. Regelen ser bare på ordrene (ikke på eiendommen på oppdraget, A285).

## Omfang
**Med:**
1. **Tjenesten `findPossibleDuplicateOrders(actor, organizationId, orderId)`** i `src/core/orders`:
   - `requireOrganizationAccess(..., "organization.read")` først, samme rettighet som å lese ordren. Fremmed, ukjent, myk-slettet eller ikke-uuid id gir `AccessDeniedError`.
   - Filtrerer på `grant.organizationId`, aldri på en id fra adressen.
   - Returnerer høyst 10 treff, nyeste først: `id`, `receivedAt`, ordrestatus, oppdragsnummer og oppdragsstatus (når gjort om), og `reasons` (`address`, `cadastre` eller begge). Adressen returneres ikke (siden har den alt for ordren selv; lenken viser resten).
   - Ytelse: spørringen bruker indeks og tåler 30 000 ordre i organisasjonen (10 år). Trengs det en uttrykksindeks for den normaliserte adressen og en indeks på `(organization_id, gnr, bnr)`, lages de i én migrering. Testen måler med `EXPLAIN` eller med 30 000 rader at det ikke blir full skanning.
   - Ren funksjon for regelen (normalisering og tidsvindu) med tabelltester, så regelen kan prøves uten database.
2. **Skjermen `/ordre/[id]`:**
   - Når ordren er «mottatt» eller «gjort om» og regelen gir treff, står et varsel øverst på siden, under overskriften: **«Mulig dublett»** og «Samme adresse eller matrikkel som en annen ordre. Sjekk før du gjør den om til oppdrag.» (ved gjort om: «Sjekk at boligen ikke har to oppdrag.»). Under står én linje per treff med lenke til ordren («Ordre mottatt 12.11.2026, Gjort om til oppdrag A-2026-0042, samme adresse»). Lenkene er minst 44 pt høye.
   - Varselet er en advarsel (gul, `role="status"`, med ikon og tekst, ikke bare farge). Det stopper ingenting: «Gjør om til oppdrag», «Avvis» og «Endre ordren» virker som før.
   - Varselet vises etter «Lagre» på «Ny ordre» (siden åpnes på ordren som før) og etter «Endre ordren» (`?endret=1`), og ellers så lenge regelen gir treff.
   - Feiler oppslaget, vises ordren som vanlig uten varsel, og feilen logges uten verdier. Ordresiden skal aldri bli utilgjengelig på grunn av varselet.
3. **Dokumenter:** domenemodellen 4.3 (regelen for mulig dublett), ordlisten (`findPossibleDuplicateOrders`, `PossibleDuplicateOrder`, `normalizeAddressKey`, «mulig dublett»), beslutningene A285–A289 i `docs/09-apne-sporsmal.md`, planen krysses av.

**Ikke med (bevisst utelatt):**
- KI-vurdering av dubletter (Ståle: fast regel uten KI).
- Sperre eller bekreftelse før lagring. Varselet kommer etter lagring (A288).
- Knapp for «Ikke dublett» eller å skjule varselet (krever lagring og logg, A288).
- Sammenligning med eiendommen og matrikkelen på oppdraget (A285).
- Varsel i ordrelisten, i arbeidskøen eller på oppdragssiden.
- Kommunenummer i matrikkelen (ordren har ikke kommune, A286).
- Like kontakter og firma (den opprinnelige teksten i forslag 62) og samme kontakt to ganger som part (T-0055). Kontakter og firma er eget punkt i planen (A289); T-0055 tas med neste oppgave om parter.
- Uten nett (ordre er kontorarbeid med nett).

## Tilgang
| Rolle | Se varselet | Endre |
|---|---|---|
| takstmann | ja | ingen ny handling |
| kontor | ja | ingen ny handling |
| leder | ja | ingen ny handling |
| admin | ja | ingen ny handling |
| uten ansattrad / deaktivert | nei | nei |

All sjekk i `src/core/access`. Varselet viser bare ordre fra samme organisasjon.

## Data
Ingen nye tabeller eller felt. Eventuelt én migrering med indekser for oppslaget (se punkt 1). Nye faste koder: grunnene `address` og `cadastre` (endres aldri, regel 6).

## Testdata
Bare oppdiktede adresser og matrikler.

## Regler
Ikke fagregler. Testsakene for regelen (tabelltest):
- Samme adresse med ulik skrivemåte (store/små bokstaver, «1A» / «1 A», med og uten postnummer etter komma) → treff `address`.
- Ulik adresse, samme `gnr`/`bnr`/`snr` → treff `cadastre`; «012» og «12» er like.
- Samme `gnr`/`bnr`, ulikt `snr` (eller ett tomt) → ikke treff på matrikkel.
- Bare `gnr` utfylt → ikke treff på matrikkel.
- Begge like → `reasons` har begge.
- Den andre er avvist → ikke treff. Oppdraget kansellert → ikke treff.
- Den andre er mottatt for 200 dager siden og fortsatt åpen → treff. Ferdig eller fakturert og mottatt for 91 dager siden → ikke treff; for 90 dager siden → treff. Mottatt 90 dager etter denne → treff.
- Ordren selv og myk-slettede ordre → aldri treff.

## Akseptkriterier
- [ ] Regelen gir riktig svar på alle testsakene over (ren funksjon og mot databasen).
- [ ] Ny ordre med samme adresse som en åpen ordre viser «Mulig dublett» med lenke til den andre ordren rett etter «Lagre»; ordren er lagret.
- [ ] Endret adresse på en ordre (T1) som nå ligner en annen, viser varselet etter «Lagre»; endres adressen tilbake, forsvinner varselet.
- [ ] Varselet stopper ikke «Gjør om til oppdrag», «Avvis» eller «Endre ordren». Avviste ordre viser aldri varsel.
- [ ] Høyst 10 treff, nyeste først, med oppdragsnummer når ordren er gjort om.
- [ ] Rettighetsmatrisen over (tabelltest mot `findPossibleDuplicateOrders`).
- [ ] Bruker i annen organisasjon får ikke tilgang og får aldri treff fra en annen organisasjon (`expectTenantIsolation`, og egen test der organisasjon B har en ordre med samme adresse).
- [ ] Applikasjonsloggen har ingen adresse eller matrikkel, heller ikke i feilgrenen (test spionerer på `logger`).
- [ ] Feil i oppslaget gir ordresiden uten varsel, ikke feilside.
- [ ] Oppslaget bruker indeks med 30 000 ordre (test).
- [ ] e2e på `pc` og `ipad` (`e2e/fase-2a-varsel-dublett.spec.ts`): to ordre med samme adresse → varselet med lenke vises, lenken åpner den andre ordren; ordren kan gjøres om til oppdrag med varselet synlig; på iPad ingen vannrett rulling og lenkene er minst 44 px.
- [ ] Universell utforming: varselet leses av skjermleser (`role="status"`), har tekst og ikon, og kontrasten holder (axe i e2e).
- [ ] KI-forslag: ingen i denne oppgaven (fast regel).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A285 (lett å endre):** regelen ser bare på ordrene (adresse og matrikkel på ordren), ikke på eiendommen på oppdraget. Alle oppdrag lages fra en ordre, og ordren kan alltid rettes (T1). Endres ved å legge eiendommen og matrikkelen på oppdraget til i spørringen.
- **A286 (lett å endre):** adresse = gate og nummer før første komma, normalisert; matrikkel = `gnr` + `bnr` + `snr`, uten kommune fordi ordren ikke har kommune. Kan gi et falskt varsel når samme gnr/bnr finnes i to kommuner, men det er bare et varsel. Endres når ordren får kommunenummer.
- **A287 (lett å endre):** «overlappende tid» = den andre er fortsatt åpen, eller kom inn høyst 90 dager før eller etter. Avviste ordre og kansellerte oppdrag teller ikke. Endres ved å bytte konstanten.
- **A288 (lett å endre):** varselet vises på ordresiden etter lagring og så lenge det gjelder, uten knapp for «ikke dublett». Ståle: varselet stopper ikke lagringen. Endres ved å legge til et valg som lagres og logges.
- **A289 (lett å endre):** forslag 62 handlet først om like kontakter og firma, mens planpunktet T3 gjelder ordre. Varsel om like kontakter og firma blir eget punkt i samme del av planen, rett etter T3. Kilde: forslag 62 og Ståles «ja, nå».
