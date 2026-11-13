# Funksjon: Varsel om mulig dublett på ordren

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», punktet T3
- **Modul:** kjerne (`src/core/orders`), siden `/ordre/[id]`
- **Branch:** `varsel-dublett` (bygger på `main`, 13.11.2026)
- **Status:** klar for bygging (13.11.2026, prosjektleder, etter forhåndsvurdering fra forenkler, ux-ansvarlig, ki-ansvarlig og test-leder). Versjon 0.10.18 → 0.10.19 (sjekk `package.json` på main ved start). Neste migrering er 0033 hvis den trengs (sjekk `drizzle/` ved start).
- **Kilde:** `docs/kartlegging/svar-fra-stale-2026-11-12.md`, T3 (forslag 62): «Ja, nå. Fast regel uten KI, og varselet stopper ikke lagringen.» Planteksten: «samme adresse eller matrikkel og overlappende tid».
- **Støtter hovedmål:**
  - **De ansatte:** kontoret ser med en gang at samme bolig er bestilt før (for eksempel to meglere i samme firma som sender samme bestilling, eller en ordre som er lagt inn to ganger). I dag oppdages det først når to takstmenn står på samme adresse, eller når fakturaen går ut to ganger.
  - **KI i bunnen:** regelen er en fast tjeneste i kjernen som e-post-til-ordre (KI lager ordreforslag, krok A1) skal kalle på samme måte senere. Treffene gir et ja/nei-signal per ordre som kan brukes uten å sende adresser til KI.
  - **Færre reklamasjoner:** færre doble oppdrag på samme bolig, og mindre risiko for to rapporter med ulikt innhold om samme bolig.

## Problem
Samme bestilling kan komme inn flere ganger (e-post sendt to ganger, megler og selger bestiller hver for seg, eller ny bestilling mens det første oppdraget pågår). EzProp sier ikke fra. Ståle vil ha et varsel, men lagringen skal aldri stoppes.

## KI i bunnen
- **Ingen KI i denne oppgaven** (Ståle: «fast regel uten KI»). Regelen er ren kode med testsaker.
- **Fra første dag for KI:** kjernetjenesten `findPossibleDuplicateOrdersFor` tar ordrefeltene (også for et ordreforslag som ikke er lagret ennå) og gir treff med grunn (`address`, `cadastre`). `findPossibleDuplicateOrders` er en tynn innpakning for en lagret ordre. Når e-post-til-ordre kommer, kaller KI-flyten den samme tjenesten før forslaget vises, slik at kontoret ser varselet på forslaget. Ingen egen KI-variant av regelen.
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
   - **Adresse:** delen før første komma i `address_text`, med små bokstaver og bare bokstaver og tall (mellomrom, punktum, bindestrek og andre tegn tas bort). Æ, ø og å beholdes («Øvre gate» er ikke lik «Ovre gate»). «Storgata 1A, 8006 Bodø» = «storgata 1 a» = «Storgata 1a». Adresse uten komma brukes i sin helhet. Tom nøkkel (tom adresse, bare komma eller mellomrom) gir aldri treff.
   - **Matrikkel:** samme `gnr` og `bnr`, og samme `snr`. Mellomrom og innledende nuller tas bort («012» = «12»). `gnr` eller `bnr` som er tom eller bare nuller («0», «000»), regnes som ikke utfylt og gir aldri treff på matrikkel. `snr` tom og `snr` «0» regnes begge som «ingen seksjon» og er like.
   - **Normaliseringen står ett sted per språk:** TS-funksjonene (`normalizeAddressKey`, `normalizeCadastreNumber`) og SQL-uttrykkene står i `src/core/orders`. SQL-uttrykkene skrives ett sted (én fil) og brukes både i spørringen og, med nøyaktig samme tekst, i uttrykksindeksene i migreringen. Bare IMMUTABLE-funksjoner (`lower`, `split_part`, `regexp_replace`, `ltrim`). En paritetstest kjører samme tabell med testsaker gjennom TS og SQL og krever like svar.
3. **Overlappende tid:** den andre ordren er ikke avvist, oppdraget er ikke kansellert (`assignments.deleted_at` er tom), og **enten** den er fortsatt åpen (status «mottatt», eller oppdraget er «bestilt» eller «under arbeid»), **eller** avstanden mellom de to ordrenes `received_at` er høyst 90 døgn, før eller etter. Avstanden måles mellom de to ordrene, ikke fra i dag. 90 døgn = 90 × 24 timer (fast varighet, `interval '2160 hours'` i SQL), slik at TS og SQL gir samme svar også over skifte mellom sommer- og vintertid. Grensen teller med (nøyaktig 90 døgn gir treff). Konstanten `MAX_DUPLICATE_WINDOW_DAYS = 90` står ett sted.

Ordren selv gir aldri treff. Er ordren selv avvist, gir tjenesten tom liste (sjekkes i tjenesten, ikke bare på siden). Regelen ser bare på ordrene (ikke på eiendommen på oppdraget, A285).

## Omfang
**Med:**
1. **Tjenestene i `src/core/orders`:**
   - **`findPossibleDuplicateOrdersFor(actor, organizationId, { addressText, gnr, bnr, snr, receivedAt, excludeOrderId? })`** er kjernen. Den gjør `requireOrganizationAccess(..., "organization.read")` (samme rettighet som å lese ordren) og filtrerer på `grant.organizationId`, aldri på en id fra adressen eller skjemaet. Den tar ordrefeltene, slik at e-post-til-ordre kan kalle den for et forslag som ikke er lagret.
   - **`findPossibleDuplicateOrders(actor, organizationId, orderId)`** er en tynn innpakning: leser ordren (fremmed, ukjent, myk-slettet eller ikke-uuid id gir `AccessDeniedError`), gir tom liste når ordren er avvist, og kaller `findPossibleDuplicateOrdersFor` med `excludeOrderId = orderId`.
   - Svar (`PossibleDuplicateOrder`): `id`, `receivedAt`, `addressText`, ordrestatus, oppdragsnummer og oppdragsstatus (når gjort om), og `reasons` (`address`, `cadastre` eller begge). Adressen er med for å vises på skjermen i samme organisasjon (se A290); den logges aldri og sendes aldri til KI.
   - Henter 11 treff og gir høyst 10, med et flagg `hasMore` når det finnes flere. Rekkefølge: `received_at` nyeste først, så `id` (fast rekkefølge ved lik tid).
   - **Ytelse:** én migrering (0033, sjekk neste nummer ved start) med uttrykksindeks på `(organization_id, <normalisert adresse>)` og på `(organization_id, <normalisert gnr>, <normalisert bnr>)`, med nøyaktig samme uttrykk som spørringen. Testen kjører `EXPLAIN` med `enable_seqscan = off` og viser at det ikke er Seq Scan på `orders`, både for adresse og for matrikkel (A291).
   - Rene funksjoner for regelen (normalisering og tidsvindu) med tabelltester, så regelen kan prøves uten database.
2. **Skjermen `/ordre/[id]`:**
   - Når regelen gir treff, står et varsel øverst på siden. Rekkefølge: først kvitteringen «Endringene er lagret.» (når den vises), så varselet, og begge over kortet «Gjort om til oppdrag». Varselet har overskriften **«Mulig dublett»** som ekte `h2` og én tekst: «Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.»
   - Under står én linje per treff med lenke: adressen til den andre ordren, mottatt-dato (samme datoformat og Oslo-tid som ellers på ordresiden), status med de samme ordene som `OrderStatusBadge`, oppdragsnummer når den er gjort om, og grunnen («samme adresse», «samme matrikkel» eller begge). Eksempel: «Storgata 1A, 8006 Bodø – mottatt 12.11.2026 – Gjort om, oppdrag A-2026-0042 – samme adresse». Lenken går til den andre ordren; derfra er oppdraget ett trykk unna. Lenkene er minst 44 px høye.
   - Er det flere enn 10 treff, står «Viser de 10 nyeste.» under listen.
   - Varselet er en advarsel (gul, `role="status"`, med ikon og tekst, ikke bare farge). Det stopper ingenting: «Gjør om til oppdrag», «Avvis» og «Endre ordren» virker som før, uten ekstra trykk.
   - Ingen egen logikk for «etter Lagre» eller `?endret=1`: varselet vises alltid når regelen gir treff, og dermed også rett etter lagring på «Ny ordre» og etter «Endre ordren».
   - Feiler oppslaget, vises ordren som vanlig uten varsel, og feilen logges uten verdier. Ordresiden skal aldri bli utilgjengelig på grunn av varselet.
3. **Dokumenter:** domenemodellen 4.3 (regelen for mulig dublett), ordlisten (`findPossibleDuplicateOrders`, `PossibleDuplicateOrder`, `normalizeAddressKey`, «mulig dublett»), beslutningene A285–A291 i `docs/09-apne-sporsmal.md`, planen krysses av.

**Ikke med (bevisst utelatt):**
- KI-vurdering av dubletter (Ståle: fast regel uten KI).
- Sperre eller bekreftelse før lagring. Varselet kommer etter lagring (A288).
- Knapp for «Ikke dublett» eller å skjule varselet (krever lagring og logg, A288).
- Sammenligning med eiendommen og matrikkelen på oppdraget (A285).
- Varsel i ordrelisten, i arbeidskøen eller på oppdragssiden.
- Kommunenummer i matrikkelen (ordren har ikke kommune, A286).
- Like kontakter og firma (den opprinnelige teksten i forslag 62) og samme kontakt to ganger som part (T-0055). Kontakter og firma står alt som eget punkt i planen, rett etter T3 (A289); T-0055 tas med neste oppgave om parter.
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
Ingen nye tabeller eller felt, så `tests/tenant-tables.ts` endres ikke. Én migrering med to uttrykksindekser for oppslaget (se punkt 1). Ingen permanent sletting. Nye faste koder: grunnene `address` og `cadastre` (endres aldri, regel 6).

## Testdata
Bare oppdiktede adresser og matrikler.

## Regler
Ikke fagregler. Testsakene for regelen (tabelltest):
- Samme adresse med ulik skrivemåte (store/små bokstaver, «1A» / «1 A», med og uten postnummer etter komma, punktum og bindestrek) → treff `address`.
- Æ, ø og å beholdes: «Øvre gate 2» er ikke lik «Ovre gate 2». Adresse uten komma virker. Adresse som er tom, bare komma eller bare mellomrom → ingen nøkkel, aldri treff.
- Ulik adresse, samme `gnr`/`bnr`/`snr` → treff `cadastre`; «012» og «12» er like, mellomrom tas bort.
- `gnr` «0» eller «000» → ikke utfylt, aldri treff på matrikkel. `snr` tom = `snr` «0».
- Samme `gnr`/`bnr`, ulikt `snr` (eller ett tomt og ett utfylt) → ikke treff på matrikkel.
- Bare `gnr` utfylt → ikke treff på matrikkel.
- Begge like → `reasons` har begge.
- Den andre er avvist → ikke treff. Oppdraget kansellert (`assignments.deleted_at` satt) → ikke treff. Gjort om med oppdrag bestilt eller under arbeid → treff.
- Den andre er mottatt 200 døgn før og fortsatt åpen → treff. Ferdig eller fakturert med 90 døgn mellom `received_at` → treff; med 90 døgn og 1 sekund eller 91 døgn → ikke treff. Mottatt 90 døgn etter denne → treff. Grensen prøves også over skifte til sommertid (90 × 24 timer).
- Ordren selv og myk-slettede ordre → aldri treff. Ordren selv avvist → tom liste.
- 11 treff, noen med lik `received_at` → 10 vises, nyeste først, så `id`; `hasMore` er sann.

## Akseptkriterier
- [ ] Regelen gir riktig svar på alle testsakene over (ren funksjon og mot databasen).
- [ ] Ny ordre med samme adresse som en åpen ordre viser «Mulig dublett» med lenke til den andre ordren rett etter «Lagre»; ordren er lagret.
- [ ] Endret adresse på en ordre (T1) som nå ligner en annen, viser varselet etter «Lagre»; endres adressen tilbake, forsvinner varselet.
- [ ] Varselet stopper ikke «Gjør om til oppdrag», «Avvis» eller «Endre ordren». Avviste ordre viser aldri varsel.
- [ ] Høyst 10 treff, nyeste først og fast rekkefølge ved lik tid, med adresse, status og oppdragsnummer når ordren er gjort om; «Viser de 10 nyeste.» når det er flere.
- [ ] Paritetstest: samme tabell med testsaker gir likt svar i TS og SQL (adresse og matrikkel).
- [ ] Varselet står under «Endringene er lagret.» og over «Gjort om til oppdrag», med `h2` «Mulig dublett».
- [ ] Rettighetsmatrisen over (tabelltest mot både `findPossibleDuplicateOrdersFor` og `findPossibleDuplicateOrders`). Admin stenges aldri ute.
- [ ] Bruker i annen organisasjon får ikke tilgang og får aldri treff fra en annen organisasjon (`expectTenantIsolation` for begge tjenestene, og egen test der organisasjon B har en ordre med samme adresse og matrikkel: A får ingen treff fra B, og B ingen fra A).
- [ ] Applikasjonsloggen har ingen adresse eller matrikkel, heller ikke i feilgrenen (test spionerer på `logger`).
- [ ] Feil i oppslaget gir ordresiden uten varsel, ikke feilside.
- [ ] Oppslaget kan bruke indeks for både adresse og matrikkel (`EXPLAIN` med `enable_seqscan = off`, ingen Seq Scan på `orders`).
- [ ] e2e på `pc` og `ipad` (`e2e/fase-2a-varsel-dublett.spec.ts`): to ordre med samme adresse → varselet med lenke vises, lenken åpner den andre ordren; ordren kan gjøres om til oppdrag med varselet synlig; på iPad ingen vannrett rulling og lenkene er minst 44 px.
- [ ] Universell utforming: varselet leses av skjermleser (`role="status"`), har tekst og ikon, og kontrasten holder (axe i e2e).
- [ ] KI-forslag: ingen i denne oppgaven (fast regel).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A285 (lett å endre):** regelen ser bare på ordrene (adresse og matrikkel på ordren), ikke på eiendommen på oppdraget. Alle oppdrag lages fra en ordre, og ordren kan alltid rettes (T1). Endres ved å legge eiendommen og matrikkelen på oppdraget til i spørringen.
- **A286 (lett å endre):** adresse = gate og nummer før første komma, normalisert; matrikkel = `gnr` + `bnr` + `snr`, uten kommune fordi ordren ikke har kommune. Kan gi et falskt varsel når samme gnr/bnr finnes i to kommuner, men det er bare et varsel. Endres når ordren får kommunenummer.
- **A287 (lett å endre):** «overlappende tid» = den andre er fortsatt åpen, eller kom inn høyst 90 dager før eller etter. Avviste ordre og kansellerte oppdrag teller ikke. Endres ved å bytte konstanten.
- **A288 (lett å endre):** varselet vises på ordresiden etter lagring og så lenge det gjelder, uten knapp for «ikke dublett». Ståle: varselet stopper ikke lagringen. Endres ved å legge til et valg som lagres og logges.
- **A289 (lett å endre):** forslag 62 handlet først om like kontakter og firma, mens planpunktet T3 gjelder ordre. Varsel om like kontakter og firma står alt som eget punkt i planen rett etter T3, så denne oppgaven tar det ikke med og legger ikke til noe planpunkt.
- **A290 (lett å endre):** treff-linjen viser den andre ordrens adresse, så kontoret slipper å åpne hvert treff for å se om det er samme bolig. Adressen vises bare på skjermen i samme organisasjon, og logges eller sendes aldri til KI. Endres ved å ta adressen ut av svaret.
- **A291 (lett å endre):** 90 døgn måles som fast varighet (90 × 24 timer) mellom de to ordrenes `received_at`, og grensen teller med. Ytelsen prøves med `EXPLAIN` og `enable_seqscan = off` i stedet for 30 000 rader, fordi det er raskt og stabilt i CI og viser at indeksen med samme uttrykk kan brukes.

## Avgjort i forhåndsvurderingen (prosjektleder, 13.11.2026)
- **Signatur (ki-ansvarlig):** tatt inn. Kjernen tar ordrefeltene (`findPossibleDuplicateOrdersFor`), innpakningen tar `orderId`. Ellers må tjenesten bygges om når e-post-til-ordre kommer.
- **Adresse i svaret (ux-ansvarlig mot test-leder):** ux vinner. Test-leder ville ha svar uten adressefelt; ux-ansvarlig viser at kontoret ellers må trykke inn på hvert treff. Adressen er samme organisasjon og vises uansett på den andre ordren. Personvernet ivaretas ved at loggen og KI aldri får den (testet med logger-spion). A290.
- **Ytelsestest (forenkler mot test-leder):** `EXPLAIN` med `enable_seqscan = off`, ikke 30 000 rader. Viser det samme (indeksen med samme uttrykk kan brukes) uten treg og ustabil CI. Uttrykksindeksen må bruke nøyaktig samme uttrykk og bare IMMUTABLE-funksjoner. A291.
- **Én tekst i varselet (forenkler):** tatt inn. Én tekst for både mottatt og gjort om.
- **Ingen logikk for `?endret=1` (forenkler):** tatt inn.
- **A289 (forenkler):** skrevet om til henvisning; planpunktet finnes alt.
- **Tidsvindu, gnr «0», egen avvist ordre, fast rekkefølge (test-leder):** tatt inn i regelen og testsakene over.
- **Rekkefølge, `h2`, statusord, datoformat, 11/10 treff (ux-ansvarlig):** tatt inn.
