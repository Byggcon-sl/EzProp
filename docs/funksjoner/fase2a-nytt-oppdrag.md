# Funksjon: «Nytt oppdrag» er hovedveien

- **Fase:** 2a – Rapporten på PC, delen «Prioritert av Ståle 13.11.2026: rett på oppdrag, tilbud ved behov», første punkt
- **Modul:** kjerne (`src/core/assignments` eier bestillingsreglene, `src/core/orders` importerer derfra, `src/core/ai` for vasken og listen over felt som aldri sendes, `src/core/contacts` for sammenslåing), sidene `/oppdrag/ny`, `/oppdrag/[id]`, `/arbeidskoe` og menyen i `(ansatt)/layout.tsx`
- **Branch:** `nytt-oppdrag-hovedvei` (bygger på `main`, 14.11.2026)
- **Status:** klar for bygging etter forhåndsvurdering runde 1 (14.11.2026: arkitekt, ux, sikkerhet-personvern, test-leder). Versjon: øk minor i `package.json` (sjekk `main` ved start).
- **Kilde:** Ståle i chat 13.11.2026: «Det er svært sjelden vi oppretter ordre, men stort sett går vi rett på oppdrag. Jeg ønsker at vi i utgangspunktet skal gå rett på oppdrag, men ha mulighet for å opprette ett tilbud.»
- **Støtter hovedmål:**
  - **De ansatte:** ett skjema og ett trykk på «Lagre» gir et oppdrag. I dag må kontoret lage ordre, åpne den, velge kontor og trykke «Gjør om til oppdrag» (rundt 6–8 trykk mer og en ekstra side). 98–99 av 100 oppdrag går denne veien.
  - **KI i bunnen:** bestillingsopplysningene lagres strukturert på oppdraget med kilde (`manual`), slik at KI senere kan fylle det samme skjemaet som forslag (e-post til oppdrag, krok A1) uten ombygging.
  - **Færre reklamasjoner:** dublettvarselet virker på oppdraget, slik at samme eiendom ikke takseres to ganger ved en feil, og riktig adresse og matrikkel står fra start.

## Problem
I dag lages et oppdrag bare ved å gjøre om en ordre. Ståle sier at ordre nesten aldri brukes i praksis. Mellomsteget koster tid, gir dobbel registrering og en liste («Ordre») som ikke speiler arbeidsdagen. Lar vi være, må kontoret fortsette med to steg for hvert oppdrag, og neste punkt (Tilbud) får ingen hovedvei å vise til.

## KI i bunnen
- **Ingen nytt KI-kall i denne oppgaven.** Skjemaet er raskt å fylle for hånd, og dublettvarselet er en fast regel uten KI (Ståle 12.11.2026, T3). KI setter aldri noe på oppdraget selv.
- **Data for KI senere:** bestillingsopplysningene lagres som egne felt med kilde (`source`, nå bare `manual`). Når e-post til oppdrag kommer (krok A1), lager KI et forslag til akkurat disse feltene gjennom `src/core/ai`, og den ansatte godtar, endrer eller avviser i det samme skjemaet. Revisjonsloggen får feltkodene ved endring, slik at treffprosent per felt kan regnes ut uten å lese verdiene.
- **Vern (hardt krav):** `loadKnownValues` i `src/core/ai/redaction.ts` leser adresse, matrikkel, borettslag, meglerens ordrenummer og bestiller (tekst, kontakt og firma) fra oppdraget, ikke bare fra ordren og eiendommen. Alle nye kolonner føres i `src/core/ai/never-fields.ts`. Test med oppdrag der `order_id` og `property_id` er tomme. Endringen gjennomgås av sikkerhet-personvern (A175).

## Brukerhistorier
- Som **kontor** vil jeg **trykke «Nytt oppdrag» i arbeidskøen og fylle ett skjema** slik at **oppdraget står i køen som «Bestilt» med én gang**.
- Som **takstmann** vil jeg **lage et oppdrag selv med meg som ansvarlig og befaringstid** slik at **jeg slipper å gå via kontoret**. Gjelder når `access.inspectors_edit_all` er på (i dag standard).
- Som **kontor** vil jeg **få varsel om et mulig dobbelt oppdrag på samme adresse eller matrikkel mens jeg fyller ut** slik at **vi ikke takserer samme bolig to ganger**.
- Som **leder** vil jeg **rette adresse eller bestiller etter lagring og se hvem som endret** slik at **feil kan følges opp**.

## Omfang
**Med:**
1. **ADR 0011 (eller neste ledige nummer): oppdrag uten ordre.** Avgjør punktene under (forhåndsvurdert av arkitekt og sikkerhet-personvern):
   - **Oppdraget eier bestillingsopplysningene for alle oppdrag** (A292). Alle lesesteder bytter fra `orders` til `assignments`: arbeidskøen, søket, eiendomsforslaget, vasken før KI, avtaleforslaget, sammenslåing av kontakter og firma, tellingen i `merge-view.ts`, dublettregelen og historikken. Ordren beholder sin kopi som «slik bestillingen kom». Forkastes med begrunnelse: lesing med forrang (oppdrag, ellers ordre), skjult ordre, og eiendom med en gang (krever boligtype og eierform i skjemaet).
   - **Én kilde for persondata** (sikkerhet-personvern punkt 4): rettelse av opplysningene om et oppdrag skjer på oppdraget. En ordre som er gjort om kan fortsatt rettes (Ståle T1), men det flytter ikke oppdraget (A251). Ordresiden viser lenke til oppdraget med teksten at rettelser for oppdraget gjøres der. ADR-en begrunner kopien i migreringen (punkt under) med at én lesekilde gir færre feil og at ordren er bestillingsdokumentet.
   - **Ingen skjult ordre.** `assignments.order_id` er tom for oppdrag laget direkte.
   - **Faste koder endres ikke** (regel 6). Ny hendelseskode `assignment.booking_updated` er et tillegg.
   - **Stenger ikke for Tilbud:** `convertOrderToAssignment` kopierer bestillingsfeltene til oppdraget i samme transaksjon. Et tilbud fyller da de samme feltene.
   - **Importretning:** felles Zod-regler for adresse, matrikkel og bestiller, normaliseringen, dublettregelen, `duplicate-sql.ts` og feltlisten for historikk flyttes til `src/core/assignments/booking/`. `src/core/orders` importerer derfra (ingen kopi, ingen sirkel). Bare rene Zod-regler kan ligge i `src/shared` hvis klienten trenger dem.
2. **Kolonner på `assignments`** (samme navn og Zod-regler som på ordren): `received_at`, `source` (CHECK `manual`, `email`), `external_ref`, `ordered_by_text`, `ordered_by_contact_id`, `ordered_by_firm_id`, `address_text`, `gnr`, `bnr`, `snr`, `housing_association_name`, `seller_declaration_received` (ikke i skjemaet, men følger med fra ordren), og `creation_key` (uuid, valgfri, unik per organisasjon, vern mot dobbel lagring). Sammensatte fremmednøkler `(organization_id, …)` til `contacts` og `firms`, med indekser. Ingen ny tabell.
3. **Migrering 0034 (tåler ekte data):** legger til kolonnene som valgfrie, fyller dem fra ordren i samme migrering (`orders.id = assignments.order_id or orders.assignment_id = assignments.id`, eldste ordre først), og setter så `address_text` og `received_at` til `NOT NULL` (`received_at` fra ordren, ellers `created_at`). Et oppdrag uten ordre skal ikke finnes i dag. Finnes det likevel, fylles `address_text` fra eiendommen; mangler den også, stopper migreringen med en tydelig melding og antall rader, og ingenting endres (A296). To uttrykksindekser for dublett på `assignments` skrives for hånd som i 0033, med indeksnavn som konstanter.
4. **Tjenester** i `src/core/assignments` (grensesnitt utvikler og testskriver bygger mot):
   - `createAssignment(actor, organizationId, input)`: `requireOrganizationAccess(..., "assignment.edit")`. Kontor, ansvarlig og kontakt slås opp med `grant.organizationId` i samme transaksjon. Firmaet settes fra kontakten, aldri fra skjemaet. Ansvarlig må være aktiv ansatt med rollen takstmann. Nummer fra `nextAssignmentNumber`, status `ordered`, `source` `manual`, utstedende selskap fra ansvarlig (samme regel som `setTeamMember`), valgfri `inspection_at`. `organizationId`, `number`, `status`, `source` og selskap tas aldri fra skjemaet. Samme `creation_key` to ganger gir det første oppdraget tilbake, aldri et nytt nummer. Alt i én transaksjon med hendelsen `assignment.created` (`{ number, orderId: null }`) og revisjonslogg uten verdier.
   - `updateAssignmentBooking(actor, organizationId, assignmentId, input, expectedRowVersion)`: `FOR UPDATE`, egen feil ved endret `row_version`, hendelse `assignment.booking_updated` (`{ assignmentId, fields }`), revisjonslogg `assignment`/`update` i samme form som for ordren (A252, verdier samlet under `values`, felles funksjon med ordren slik at Ståles svar på spørsmål 79 rettes ett sted).
   - `listAssignmentBookingHistory(actor, organizationId, assignmentId)`.
   - `findPossibleDuplicatesFor(...)`: treff på både ordre og oppdrag med type, id, nummer, status, adresse og grunn. Aldri matrikkel, bestiller, kontakter eller reklamasjonsopplysninger i svaret. Rettighet `organization.read`.
   - Ingen eksporterte spørrehjelpere uten tilgangssjekk.
   - Fremmed og ukjent id gir samme feil.
5. **Dublettspørringen:** `possibleDuplicatesQuery` deles i to delspørringer med `UNION ALL` (ordre som ikke er gjort om og ikke avvist, og oppdrag), med samme uttrykkstekst fra `duplicate-sql.ts`. Unngår «ambiguous column» når kolonnene har samme navn. `EXPLAIN`-testen og paritetstesten utvides til begge tabellene.
6. **Skjemaet `/oppdrag/ny`** (ux): feltrekkefølge adresse, matrikkel, bestiller (kontaktvelger og fritekst), befaringstid, kontor, ansvarlig. Under et synlig avsnitt «Mer om bestillingen» nederst: mottatt (nåtid som standard), meglerens ordrenummer, borettslag eller sameie. Rapporttype vises som fast tekst «Tilstandsrapport». Kontor som store radioknapper (minst 44 pt), den ansattes kontor forhåndsvalgt. Ansvarlig: den innloggede forhåndsvalgt hvis hen er takstmann, ellers liste med søk. Ingen nedtrekksliste på iPad. `OrderFields` gjenbrukes med rekkefølge som kan settes. «Lagre» er hovedknapp nederst (56 pt på iPad) og låses mens lagringen pågår. Feilmeldinger ved feltet, fokus til første feil. Etter lagring: `/oppdrag/[id]` med «Oppdrag NNN er lagret» (`role="status"`).
7. **Dublettvarsel mens du fyller ut:** hentes når adresse- eller matrikkelfeltet forlates, med POST eller server action (aldri i adressen), og vises over «Lagre» med lenke til treffet. Ingen «Lagre likevel» (A288). Vises også på oppdragssiden.
8. **Uten nett:** oppretting krever nett (D9). Mister iPaden nettet eller feiler lagringen, står alt igjen i skjemaet med «Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.» Ingen lokal kø, ingen utkast i localStorage eller IndexedDB, ingenting i synkkøen.
9. **Knappen «Nytt oppdrag»** som hovedknapp øverst til høyre i arbeidskøen (også i tom kø, i stedet for «Ny ordre») og som første punkt i menyen, før «Arbeidskø». Vises bare for den som har `assignment.edit`.
10. **Endre etter lagring på oppdragssiden:** kortet «Bestilling» med «Endre» og «Endringer» (historikk), i alle statuser, med `row_version`-kontroll.
11. **Søk og arbeidskø:** finner oppdrag laget direkte på adresse, matrikkel, bestiller og meglerens ordrenummer. Adressen på kortet kommer fra eiendommen, ellers fra oppdraget (oppdraget har alltid adresse etter migreringen).
12. **Sammenslåing av kontakter og firma** (`src/core/contacts/remove-merge.ts`) flytter bestilleren også på `assignments`, øker `row_version` og skriver loggrad. Det kjente lille funnet for ordre rettes samtidig.
13. **Sperre mot fødselsnummer** (elleve sifre) på alle fritekstfelt i det felles skjemaet: `addressText`, `orderedByText`, `externalRef` og `housingAssociationName`. Gjelder både ordre og oppdrag.
14. **Logger:** loggerens liste over sensitive nøkler utvides med `addressText`, `orderedByText`, `gnr`, `bnr`, `snr`, `externalRef` og `housingAssociationName`. Input, rad og Zod-feil sendes aldri til loggeren.
15. **Dokumentasjon:** `docs/05-domenemodell.md` (4.3: «Bestilleren leses fra oppdraget», nye felt, hendelse, ordliste), ADR, beslutninger A292–A299, spørsmål 79 utvidet til oppdraget, `start.sh` hvis oppsettet endres.

**Ikke med (bevisst utelatt):**
- «Ordre» blir «Tilbud», flytting i menyen, gjøre om tilbud med ett trykk, avslag og utløp (neste planpunkt). Menypunktet «Ordre» og `/ordre/ny` står som i dag.
- Endring av seed-filene for testdata (PR #203 seeder ordre gjennom `createOrder` og `convertOrderToAssignment`, som fortsatt virker). Bare tillegg i `tests/factories.ts`.
- KI-forslag fra e-post (krok A1) og bestillingsskjema for meglere (fase 3b).
- Frist, intern merknad, parter og avtale i skjemaet. De settes på oppdragssiden som i dag.
- Nye rapporttyper. Bare `condition_report` finnes.
- Oppslag mot Kartverket eller annet register.
- Oppretting uten nett (D9).
- Statistikk per person på `received_at` eller `created_by` (arbeidsmiljøloven kap. 9).

## Tilgang
| Rolle | Se | Lage og endre bestilling |
|---|---|---|
| takstmann | alle oppdrag i organisasjonen | bare når `access.inspectors_edit_all` er på (`assignment.edit`). Når den er av: knappen vises ikke, `/oppdrag/ny` gir tydelig avvisning, tjenesten kaster feil |
| kontor | alle | ja |
| leder | alle | ja |
| admin | alle | ja, også når innstillingen er av (regel 11) |

All tilgang i `src/core/access`. Spørringer filtrerer på `grant.organizationId`, aldri på id fra adressen eller skjemaet.

## Data
Se Omfang punkt 2 og 3. Faste koder som tas i bruk: `ordered`, `condition_report`, `manual`, `address`, `cadastre` (alle finnes). Ny hendelseskode `assignment.booking_updated`. Ingen ny tabell, så `tests/tenant-tables.ts` er uendret. Ingen ny avhengighet. Ordlisten oppdateres (`creation_key`, `booking`).

## Skjermer
- **Arbeidskøen:** «Nytt oppdrag» som hovedknapp. I dag ca. 9–11 trykk og 3 sidebytter via ordre; etter 2 trykk (4 hvis en annen ansvarlig velges) og ett sidebytte. Ca. 1,5 min spart per oppdrag (ux).
- **Menyen:** «Nytt oppdrag» øverst.
- **`/oppdrag/ny`:** se Omfang punkt 6–8.
- **`/oppdrag/[id]`:** kortet «Bestilling», historikk og dublettvarsel.
- **`/ordre/[id]` for gjort-om ordre:** lenke til oppdraget for retting.
- Universell utforming: etiketter, tastaturrekkefølge, kontrast, varsel med `role="status"`.

## Regler
Dublettregelen er fast kode med testsaker i `tests/duplicate-cases.ts` (ikke regelmotoren). Avgrensning:
- Et oppdrag varsler ikke om seg selv.
- Et oppdrag laget fra en ordre og ordren selv gir ett treff, ikke to (delspørringen for ordre tar bare ordre som ikke er gjort om).
- Kansellerte oppdrag og avviste ordre teller ikke.
- Mykt slettede rader teller ikke.
- Grensen på 90 dager som i A291.
Testsakene dekker oppdrag mot ordre, oppdrag mot oppdrag, ordre mot oppdrag, seg selv, oppdrag fra ordre, kansellert og slettet, og grensen. Paritetstesten viser at koden og SQL-en gir samme svar for begge tabellene.

## Akseptkriterier
- [ ] ADR 0011 skrevet med punktene i Omfang 1; ingen fast kode er endret.
- [ ] «Nytt oppdrag» står i arbeidskøen (også tom kø) og øverst i menyen, og lager oppdrag med status «Bestilt», nummer, kontor, ansvarlig og eventuelt befaringstid, uten ordre (`order_id` tom), `source` `manual`, og `assignment.created` med `orderId: null`.
- [ ] Hvert av disse avvises med tydelig feilmelding, og ingenting lagres: kontor eller ansatt i en annen organisasjon; kontor som er arkivert eller mykt slettet; ansatt som er deaktivert eller slettet; ansvarlig uten rollen takstmann; kontakt eller firma fra en annen organisasjon. Fremmed og ukjent id gir samme feil.
- [ ] Feiler hendelsen eller revisjonsloggen, lagres ingenting (én transaksjon).
- [ ] Takstmann med `access.inspectors_edit_all` av ser ikke knappen, får avvisning på `/oppdrag/ny`, og tjenesten kaster feil. Admin kan alltid lage oppdrag.
- [ ] Dublettvarsel vises i skjemaet når adresse- eller matrikkelfeltet forlates, og på oppdraget, etter avgrensningen under «Regler». Det stopper aldri lagringen. Oppslaget går med POST, og svaret har bare id, nummer, status, adresse og grunn.
- [ ] Dobbelt trykk på «Lagre» gir ett oppdrag og ett nummer (knappen låses, og samme `creation_key` gir det første oppdraget).
- [ ] Uten nett: skjemaet sier tydelig fra, alt som er skrevet står igjen, ingenting lagres og ingenting havner i synkkøen eller lokal lagring.
- [ ] Bestillingsfeltene kan endres etter lagring i alle statuser; feil `row_version` gir konfliktmelding uten stille overskriving; historikken viser feltkoder og hvem som endret.
- [ ] Søket og arbeidskøen finner oppdrag laget direkte på adresse, matrikkel, bestiller og meglerens ordrenummer.
- [ ] Migreringen: et oppdrag laget fra ordre har samme adresse, matrikkel og bestiller før og etter; oppdrag uten ordre og uten eiendom stopper migreringen med tydelig melding uten endring.
- [ ] Oppdrag laget fra ordre virker som før (regresjonstest). `convertOrderToAssignment` kopierer bestillingsfeltene. Ordreflyten er uendret bortsett fra lenken til oppdraget på en gjort-om ordre.
- [ ] Sammenslåing av kontakter og firma flytter bestilleren på både ordre og oppdrag, øker `row_version` og logger.
- [ ] Elleve sifre avvises i alle fritekstfeltene, for både ordre og oppdrag.
- [ ] Nye kolonner sendes aldri til KI: test mot `never-fields` og vasken, også med oppdrag der `order_id` og `property_id` er tomme.
- [ ] Logger, hendelser og revisjonslogg for oppretting har bare id-er og feltkoder. Test med `tests/known-values.ts` viser at ingen verdi fra skjemaet står i logglinjene når lagring og dublettoppslag feiler.
- [ ] `expectTenantIsolation` for hver ny spørring: oppretting, endring, historikk, dublett, utvidet søk og arbeidskø, og valglistene i skjemaet (kontor, takstmenn, kontakter, firma).
- [ ] E2e på PC og iPad-størrelse: kø til skjema til oppdrag i køen; knapp i tom kø og i menyen; forhåndsvalg; dublettvarsel; endre og historikk; konflikt i to faner; uten nett (`context.setOffline`); dobbelt trykk; takstmann med innstillingen av; tastaturrekkefølge og etiketter.
- [ ] `package.json` økt med minor. Seed-filene er ikke endret.
- [ ] KI-forslag: ingen i denne oppgaven (se «KI i bunnen»).

## Testplan (fra test-leder)
- **Enhet:** felles Zod-regler (ordre og oppdrag godtar og avviser det samme), skjema for oppretting (bare `condition_report`, gyldig valgfri befaringstid), `never-fields` og `redaction.test.ts`.
- **Regel:** `tests/duplicate-cases.ts` og `duplicates-parity.test.ts` som under «Regler».
- **Integrasjon:** `createAssignment` (rett vei, transaksjon, avvisninger), tilgangsmatrise (takstmann med innstilling på og av, kontor, leder, admin), endring og historikk, søk og arbeidskø, regresjon for ordre, logger og hendelser, migrering, sammenslåing.
- **Tenant-isolasjon:** som i akseptkriteriet.
- **E2e:** som i akseptkriteriet.

## Roller
arkitekt (ADR og datamodell), ux (skjema, trykk), ui (skjema og kort), sikkerhet-personvern (gjennomgang av vasken, `NEVER_FIELDS` og logger i runde 2, med /security-review), utvikler og testskriver i parallell. Ikke fag.

**Oppdeling for parallell bygging:**
- Utvikler A: migrering, skjema i `src/db`, `booking/` i kjernen, tjenestene, dublettspørringen, vasken, sammenslåing, logger.
- Utvikler B (etter at grensesnittene i Omfang 4 er på plass): `/oppdrag/ny`, knapp i kø og meny, kortet «Bestilling» på oppdraget, lenke på ordresiden.
- Testskriver: testsaker for dublett, integrasjon, tenant-isolasjon og e2e mot grensesnittene i Omfang 4.

## Avgjort ved uenighet (prosjektleder 14.11.2026)
- **Kopiere ordredata inn i gamle oppdrag** (arkitekt ja, sikkerhet «bare med begrunnelse»): ja. Begrunnelse: én lesekilde for alle oppdrag fjerner ni steder som ellers må lese to kilder, og hindrer at vasken før KI glipper. Ingen nye persondata oppstår; det er de samme opplysningene om det samme oppdraget. Retting skjer på oppdraget. Ført som A292 og A293.
- **Alle nye kolonner valgfrie** (test-leder) mot **`address_text` og `received_at` påkrevd** (arkitekt): påkrevd etter utfylling. Et oppdrag uten adresse kan ikke takseres, og dublettvarselet trenger den. De øvrige kolonnene er valgfrie. Kriteriet for migreringen er omformulert.
- **Adresse i køen** (test-leder: eiendom, oppdrag, ordre): eiendom, ellers oppdrag, fordi oppdraget alltid har adresse etter migreringen.
- **Ordreflyten «uendret»** omformulert: eneste endring er lenken til oppdraget på en gjort-om ordre.

## Beslutninger (autonom modus)
A292–A299 i `docs/09-apne-sporsmal.md`. Spørsmål 79 (verdier i revisjonsloggen) er utvidet til oppdraget og står fortsatt åpent for Ståle; det stopper ikke bygging.

## Åpne spørsmål
- Ingen som stopper. Navn og plassering av «Tilbud» avgjøres i neste punkt.
