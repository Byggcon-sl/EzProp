# Testplan: «Nytt oppdrag» er hovedveien

- **Oppgavekort:** `docs/funksjoner/fase2a-nytt-oppdrag.md` (design: `fase2a-nytt-oppdrag-design.md`)
- **Dato:** 14.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** e2e låser at kø → skjema → lagret oppdrag går med to trykk og ett sidebytte, på PC og iPad, med forhåndsvalg og tastatur.
  - **KI i bunnen:** testene låser at bestillingsfeltene står strukturert på oppdraget med `source`, og at ingen av de nye kolonnene kan nå KI (vasken og `never-fields`, også for oppdrag uten ordre og eiendom).
  - **Færre reklamasjoner:** dublettregelen prøves som testsaker på tvers av ordre og oppdrag, og paritetstesten viser at koden og SQL-en svarer likt.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet: adresser som `Testveien 12, 8000 Bodø`, `Prøvegata 3`, gnr/bnr `9001/1`. Loggtestene bruker merker som ikke kan forekomme tilfeldig: `MERKE-ADR-N7Q`, `MERKE-BEST-N7Q`, `MERKE-REF-N7Q`, `MERKE-BRL-N7Q`, gnr `7771`, bnr `7772`, snr `7773`.

Tjenesten `createAssignment` fra `@/core/assignments` har samme navn som fabrikken i `tests/factories.ts`. Testfilene importerer tjenesten som `createAssignmentService` (alias), så fabrikken beholder navnet.

## 0. Avtale om grensesnitt (utvikler A, utvikler B og testskriver)

Fra kortet, Omfang 4. Avvik føres i kortet under «Avgjort etter gjennomgangen».

- `src/core/assignments/booking/`: `bookingFieldsSchema` (felles Zod for adresse, matrikkel, bestiller, meglerens ordrenummer, borettslag), `normalizeAddressKey`, `normalizeCadastreNumber`, `duplicate-sql.ts` med indeksnavn som konstanter, og `BOOKING_HISTORY_FIELDS`. `src/core/orders` importerer herfra; ingen kopi.
- `createAssignmentInputSchema`: bookingfeltene + `officeId`, `responsibleEmployeeId`, `inspectionAt?`, `creationKey?`, `receivedAt?`. `reportType` godtar bare `condition_report`. Ukjente nøkler (`organizationId`, `number`, `status`, `source`, `issuingCompanyId`, `orderedByFirmId`) strippes.
- `createAssignment(actor, organizationId, input)` → `{ id, number }`.
- `updateAssignmentBooking(actor, organizationId, assignmentId, input, expectedRowVersion)` → `{ id, rowVersion }`. Kaster `AssignmentChangedError` ved feil `row_version`.
- `listAssignmentBookingHistory(actor, organizationId, assignmentId)` → rader med `id`, `changedBy`, `changedAt`, `fields`.
- `findPossibleDuplicatesFor(actor, organizationId, target)` der `target` er `{ kind: "draft", addressText, gnr, bnr }`, `{ kind: "order", id }` eller `{ kind: "assignment", id }` → `{ type: "order" | "assignment", id, number, status, addressText, reason: "address" | "cadastre" }[]`.
- Fremmed og ukjent id gir `AssignmentNotFoundError` med samme melding. Ugyldig kontor, ansvarlig, kontakt gir `BookingReferenceError` med feltnavnet (`officeId`, `responsibleEmployeeId`, `orderedByContactId`), samme melding for fremmed og ukjent.
- `getEmployeeContext()` får `canCreateAssignments` regnet ut i `src/core/access`.
- **Testhjelpere (bare tillegg):**
  - `tests/factories.ts`: `createAssignment` får standard `addressText: "Testveien 12, 8000 Bodø"` og `receivedAt: TEST_NOW` (kolonnene blir `NOT NULL`). Nye overrides virker uendret.
  - `tests/factories.ts`: `bookingInput(overrides?)` gir gyldig input til `createAssignment`-tjenesten (krever `officeId` og `responsibleEmployeeId`).
  - `tests/known-values.ts`: `seedKnownValues` kan legge verdiene på oppdraget (`onAssignment: true`) og lage oppdraget uten ordre og eiendom.
  - `tests/duplicate-cases.ts`: nye tabelltilfeller `CROSS_TABLE_CASES` (se 2).
  - E2e-hjelperne og spec-ene som setter inn rader direkte i `assignments` (`e2e/helpers.ts`, `fase-2a-sok-ordre-arbeidsko`, `fase-2a-arbeidsko-testplan`, `fase-2a-tidsmaling`, `fase-2a-varsel-dublett`) og `src/db/orders-schema.test.ts`, `src/db/assignment-team-parties-schema.test.ts` får `address_text` med, ellers blir de røde etter migreringen.
- Seed-filene (`src/db/seed/`) endres ikke. `src/db/seed/sample-assignments.test.ts` skal være grønn uten endring (regresjon via `convertOrderToAssignment`).

## 1. Enhet (ingen database)

### 1.1 Felles bestillingsregler, `src/core/assignments/booking/schemas.test.ts` (ny)
1. **ordre og oppdrag godtar og avviser det samme** (`it.each` over én liste med inndata): samme resultat og samme feilsti fra `orderInputSchema` og `createAssignmentInputSchema` for bookingfeltene.
2. **påkrevd adresse:** tom, bare mellomrom og over maks lengde avvises med meldingen ved `addressText`.
3. **matrikkel:** gnr/bnr/snr bare sifre, `bnr` uten `gnr` avvises (samme regel som ordren i dag).
4. **elleve sifre avvises** (`it.each` over `addressText`, `orderedByText`, `externalRef`, `housingAssociationName` × `"12345678901"`, `"123456 78901"`, `"Ref 01020312345"`) for både ordre og oppdrag. Ti og tolv sifre godtas (telefon, ordrenummer). Feilmeldingen inneholder aldri verdien.
5. **`reportType`:** bare `condition_report`; annet avvises.
6. **`inspectionAt`:** valgfri; tom gir `null`; ugyldig dato avvises.
7. **`creationKey`:** valgfri uuid; annet avvises.
8. **felter som aldri tas fra skjemaet** (`organizationId`, `number`, `status`, `source`, `issuingCompanyId`, `orderedByFirmId`) finnes ikke i det parsede resultatet.

### 1.2 `src/core/ai/never-fields` og vasken, `src/core/ai/redaction.test.ts` (utvidet) og `static-checks.test.ts`
1. **alle nye kolonner står i `NEVER_FIELDS`:** testen leser kolonnene på `assignments` fra Drizzle-skjemaet og krever at `address_text`, `ordered_by_text`, `ordered_by_contact_id`, `ordered_by_firm_id`, `external_ref`, `gnr`, `bnr`, `snr`, `housing_association_name` er med.
2. **`redaction-cases.ts`** får saker der verdiene bare finnes på oppdraget (se 4.10).

### 1.3 Loggeren, `src/shared/lib/logger.test.ts` (utvidet)
1. **nye sensitive nøkler fjernes** (`it.each`): `addressText`, `orderedByText`, `gnr`, `bnr`, `snr`, `externalRef`, `housingAssociationName`, også nøstet i `input` og `values`.

### 1.4 Menyen og knappen, `src/core/access/guards.test.ts` (utvidet)
1. **`canCreateAssignments`** (`it.each`): takstmann med innstilling på → ja, av → nei; kontor, leder → ja; admin → ja både på og av (regel 11, skal aldri fjernes).

## 2. Regeltester (testsaker som data)

`tests/duplicate-cases.ts` får `CROSS_TABLE_CASES`: `[navn, rader, mål, forventede treff]`. Brukes av `src/core/assignments/booking/duplicates.test.ts` (ren) og `duplicates-parity.test.ts` (SQL), flyttet fra `src/core/orders`.

1. **oppdrag mot ordre:** nytt oppdrag med samme adresse som en åpen ordre → ett treff, `type: "order"`, `reason: "address"`.
2. **oppdrag mot oppdrag:** samme adresse → treff `type: "assignment"`; ulik adresse, samme gnr/bnr → `reason: "cadastre"`.
3. **ordre mot oppdrag:** åpen ordre ser et oppdrag laget direkte.
4. **seg selv:** et oppdrag gir aldri treff på seg selv; en ordre heller ikke.
5. **oppdrag fra ordre:** ordren (gjort om) og oppdraget gir ett treff til en tredje, ikke to. Fra oppdraget gir ordren det kom fra ikke treff.
6. **kansellert oppdrag og avvist ordre** teller ikke.
7. **mykt slettet** ordre og oppdrag teller ikke.
8. **grensen på 90 dager (A291):** 89 og 90 dager → treff, 91 → ikke (samme grense og målepunkt for begge tabellene).
9. **paritet:** for hver sak gir den rene funksjonen og `possibleDuplicatesQuery` (to delspørringer med `UNION ALL`) samme id-er i samme rekkefølge.
10. **`EXPLAIN`-testen** viser at begge uttrykksindeksene på `assignments` og de to på `orders` brukes (indeksnavn fra konstantene).
11. **uttrykkene er like:** tekstene i `duplicate-sql.ts` står ordrett i 0033 (orders) og 0034 (assignments).

## 3. Databasen og migreringen

### 3.1 Skjema, `src/db/assignments-booking-schema.test.ts` (ny, direkte innsetting)
1. **`address_text` og `received_at` er `NOT NULL`;** `received_at` har standard `now()`.
2. **CHECK `source`:** `manual` og `email` godtas, annet avvises.
3. **sammensatte fremmednøkler:** oppdrag i A med `ordered_by_contact_id` eller `ordered_by_firm_id` fra B avvises.
4. **`creation_key` unik per organisasjon:** samme nøkkel to ganger i A avvises; samme nøkkel i A og B godtas; flere `null` godtas.
5. **`tests/tenant-isolation-all-tables.test.ts` er grønn uten endring** i `tests/tenant-tables.ts` (ingen ny tabell).

### 3.2 Migreringen 0034, `src/db/migrations/0034-booking.test.ts` (ny)
Lager en egen tom database (`ezprop_mig_<tilfeldig>`, testbrukeren har CREATEDB), kjører migreringene til og med 0033 fra en kopi av mappen med journalen kuttet, setter inn rader med rå SQL, kjører så hele mappen. Databasen slettes i `afterAll`.
1. **oppdrag fra ordre (`orders.assignment_id`)** har samme adresse, gnr, bnr, snr, bestiller (tekst, kontakt, firma), meglerens ordrenummer, borettslag, mottatt og `source` som ordren etter migreringen.
2. **oppdrag med `order_id` satt** fylles på samme måte.
3. **to ordre på samme oppdrag** (en slettet mykt): ordren som ikke er slettet brukes; ellers den eldste.
4. **oppdrag uten ordre, med eiendom:** `address_text` fra eiendommen, `received_at = created_at`.
5. **oppdrag uten ordre og uten eiendom:** migreringen feiler med meldingen «Migrering 0034 stoppet: 1 oppdrag …», meldingen har ingen adresse eller id, og **ingenting er endret** (kolonnene finnes ikke, journalen har ikke 0034). Etter at eiendom legges inn, går migreringen gjennom.
6. **`row_version` og `updated_at`** er uendret på oppdragene.
7. **tenant:** en ordre i B kopieres aldri til et oppdrag i A, selv med samme `assignment_id` lagt inn feilaktig.
8. **kjører to ganger uten feil** (journalen hindrer dobbeltkjøring).

## 4. Kjernen mot databasen

### 4.1 `createAssignment`, rett vei, `src/core/assignments/create-assignment.test.ts` (ny)
1. **lager oppdraget:** status `ordered`, `assignment_type = condition_report`, nummer fra `nextAssignmentNumber`, `order_id = null`, `property_id = null`, `source = manual`, kontor og ansvarlig som valgt, befaringstid når satt (og `null` når ikke), bookingfeltene lagret.
2. **ansvarlig blir teammedlem** med samme rolle og samme utstedende selskap som `setTeamMember` gir.
3. **firmaet settes fra kontakten** (kontakt i firma X → `ordered_by_firm_id = X`), også når skjemaet sender et annet firma.
4. **hendelsen `assignment.created`** med `{ number, orderId: null }`, én rad.
5. **revisjonsloggen** har én rad med id og feltkoder, ingen verdier.
6. **`organization_id`** på oppdrag, teammedlem, hendelse og loggrad er `grant.organizationId`.
7. **samme `creation_key` to ganger** (etter hverandre og i `Promise.all`) gir samme id og nummer, ett oppdrag, én hendelse, og nummerserien er økt én gang.
8. **uten `creation_key`:** to kall gir to oppdrag med to nummer.

### 4.2 Avvisninger, samme fil
Hver sak: tydelig feil på riktig felt, og antall rader i `assignments`, `assignment_team_members`, `events`, `audit_log` og nummerserien er uendret (`it.each`).
1. kontor fra organisasjon B; kontor arkivert; kontor slettet mykt; tilfeldig uuid som kontor.
2. ansvarlig fra B; deaktivert; slettet mykt; uten rollen takstmann (kontor, leder); tilfeldig uuid.
3. kontakt fra B; kontakt slettet mykt; tilfeldig uuid.
4. **fremmed og ukjent id gir nøyaktig samme melding** (sammenlign feilmeldingene parvis).
5. ugyldig input (tom adresse, elleve sifre) → valideringsfeil, ingen rader.

### 4.3 Transaksjon, `src/core/assignments/create-assignment-transaction.test.ts` (ny)
1. **feiler hendelsen,** lagres ingenting: midlertidig trigger på `events` som kaster ved `assignment.created`; ingen rader i noen av tabellene i 4.2, nummerserien uendret. Triggeren fjernes i `finally`.
2. **feiler revisjonsloggen,** lagres ingenting (trigger på `audit_log`).
3. **feiler teammedlemmet,** lagres ingenting.

### 4.4 Tilgang per rolle, `src/core/assignments/create-assignment-access.test.ts` (ny)
1. **rolletabell** (`it.each`, `access.inspectors_edit_all` på og av) mot `createAssignment` og `updateAssignmentBooking`:
   | ansatt | på | av |
   |---|---|---|
   | takstmann | ja | `AccessDeniedError`, ingen rader |
   | kontor | ja | ja |
   | leder | ja | ja |
   | admin uten andre roller | ja | ja |
2. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller og uten sertifisering lager og endrer oppdrag med innstillingen av.
3. **fjernet, deaktivert og manglende ansatt** får `AccessDeniedError` på alle fire tjenestene.
4. **`listAssignmentBookingHistory` og `findPossibleDuplicatesFor`** krever bare `organization.read`: takstmann med innstilling av får lese.
5. **takstmann med innstilling på kan velge en annen takstmann** som ansvarlig (kortet: «alle takstmenn kan endre alt»).

### 4.5 Tenant-isolasjon, ett `expectTenantIsolation` per ny eller endret spørring
Fil i parentes.
1. `createAssignment` (`create-assignment.test.ts`): `query` lager et oppdrag med kontor og ansvarlig fra egen `seed`; etterpå har B nøyaktig ett nytt oppdrag, og alle rader for det har `organization_id = B`.
2. `updateAssignmentBooking` (`update-booking.test.ts`).
3. `listAssignmentBookingHistory` (`update-booking.test.ts`).
4. `findPossibleDuplicatesFor` med utkast, ordre og oppdrag som mål (`booking/duplicates-db.test.ts`): samme adresse i A og B gir aldri treff på tvers.
5. utvidet søk (`search.test.ts`): oppdrag laget direkte med samme adresse og bestiller i A og B.
6. arbeidskøen (`work-queue-search.test.ts`).
7. valglistene i skjemaet: kontor (`listOffices` for skjemaet), aktive takstmenn, kontaktvelgeren og firma (`booking-options.test.ts`, ny).
8. sammenslåing av kontakter og firma på oppdrag (`remove-merge.test.ts`): sammenslåing i A rører ikke oppdrag i B.

### 4.6 Fremmed id med egen grant (IDOR), `update-booking.test.ts` og `booking/duplicates-db.test.ts`
Admin i A med `orgA.id`:
1. **Bs `assignmentId`** i `updateAssignmentBooking`, `listAssignmentBookingHistory` og `findPossibleDuplicatesFor` → `AssignmentNotFoundError`; Bs rad er uendret (alle felt, `row_version`, `updated_at`).
2. **tilfeldig uuid og `"ikke-en-id"`** → samme feil og melding, aldri databasefeil.
3. **oppdrag slettet mykt** → samme feil.

### 4.7 Endring etter lagring og historikk, `src/core/assignments/update-booking.test.ts` (ny)
1. **alle statuser** (`it.each` over `ordered`, `in_progress`, `completed`, `invoiced`, og med merket «Rettet»): adressen kan endres, `row_version` øker med én.
2. **feil `row_version`** → `AssignmentChangedError`, ingen felt endret, ingen hendelse.
3. **samtidig endring:** to kall med samme `row_version` i `Promise.all` → én lagret, én `AssignmentChangedError`.
4. **hendelsen `assignment.booking_updated`** med `{ assignmentId, fields }`; `fields` er bare feltkodene som faktisk ble endret. Ingen endring → ingen hendelse og ingen loggrad.
5. **revisjonsloggen** `assignment`/`update` i samme form som for ordren (verdier under `values`): testen sammenligner nøklene med en tilsvarende ordreendring (felles funksjon, spørsmål 79).
6. **historikken** viser hvem, når og feltkoder, nyeste først, bare for dette oppdraget.
7. **kontakt i endring:** firma settes fra kontakten; kontakt fra B avvises.
8. **en gjort-om ordre kan fortsatt rettes** (Ståle T1), men oppdraget endres ikke (A251): adressen på oppdraget er uendret etter `updateOrder`.

### 4.8 Søk og arbeidskø, `search.test.ts`, `work-queue-search.test.ts` (utvidet)
1. **oppdrag laget direkte** finnes på adresse, gnr/bnr, bestillertekst, kontaktens navn og meglerens ordrenummer.
2. **adressen på kortet:** eiendommens når den finnes, ellers oppdragets.
3. **oppdrag fra ordre** finnes som før, og vises én gang (ikke to treff fra ordre og oppdrag).
4. **mykt slettede og kansellerte** følger reglene som før.
5. **ytelse:** søket med 5 000 oppdrag i A går under grensen i ADR 0010, og `EXPLAIN` bruker indeksen på `organization_id`.

### 4.9 Regresjon for ordre, `src/core/orders/orders.test.ts` og `update-order.test.ts` (utvidet)
1. **`convertOrderToAssignment` kopierer bookingfeltene** (alle tolv) til oppdraget i samme transaksjon; `order_id` satt; `assignment.created` med `orderId`.
2. **feiler kopien,** gjøres ordren ikke om (trigger, ingenting endret).
3. **alle eksisterende ordretester er grønne uten endring** i forventningene (bortsett fra der fabrikken trenger `addressText`).
4. **sample-seed:** `src/db/seed/sample-assignments.test.ts` grønn uten endring.

### 4.10 Vasken før KI, `src/core/ai/redaction.test.ts` (utvidet)
1. **oppdrag uten ordre og uten eiendom** (`order_id` og `property_id` tomme): adresse, gnr/bnr/snr, borettslag, meglerens ordrenummer, bestillertekst, kontaktens og firmaets navn fra oppdraget blir vasket bort fra teksten som går til den falske leverandøren.
2. **oppdrag fra ordre der ordren er rettet etter omgjøring:** både ordrens og oppdragets verdi vaskes.
3. **ingen av de nye kolonnene** står i noe kall til den falske leverandøren (`tests/fake-anthropic.ts`), sjekket mot merkene.

### 4.11 Sammenslåing, `src/core/contacts/remove-merge.test.ts` (utvidet)
1. **kontakt slås sammen:** `ordered_by_contact_id` flyttes på både ordre og oppdrag, `row_version` øker, én loggrad per endret rad.
2. **firma slås sammen:** `ordered_by_firm_id` flyttes på begge.
3. **telling i `merge-view.ts`** teller oppdrag med bestilleren.
4. **det kjente lille funnet for ordre** (`row_version` og loggrad manglet) har egen test som var rød før rettingen.

### 4.12 Logger, hendelser og revisjonslogg uten verdier, `src/core/assignments/booking-no-leak.test.ts` (ny)
Bruker merkene øverst og `tests/known-values.ts`. Fanger loggeren.
1. **oppretting lykkes:** ingen merke i `events`, `audit_log` (hele JSON) eller logglinjene.
2. **oppretting feiler** (fremmed kontor, trigger på `events`, valideringsfeil): ingen merke i logglinjene; Zod-feil og input sendes ikke til loggeren.
3. **dublettoppslag feiler** (databasefeil fremprovosert): ingen merke i logglinjene.
4. **dublettsvaret** har bare `type`, `id`, `number`, `status`, `addressText`, `reason`; aldri matrikkel, bestiller, kontakt eller reklamasjon (nøklene sjekkes eksakt).

### 4.13 Myk sletting
1. **ingen tjeneste i oppgaven sletter rader:** antall rader i `assignments`, `orders`, `contacts`, `firms` går aldri ned i noen test over (sjekkes i `afterEach` i de nye filene).

## 5. E2e (PC og iPad-størrelse), `e2e/fase-2a-nytt-oppdrag.spec.ts` (ny)

Kjøres i prosjektene `pc` og `ipad`, med egne iPad-tester i stående og liggende. Bruker `logIn`, `logInAsOffice`, `logInAsInspector`, `logInAsManager`, `setInspectorsEditAll` og `restoreInspectorsEditAll` fra `e2e/helpers.ts`. Unike adresser med `uniqueSuffix()`.

**PC og iPad:**
1. **kø → skjema → oppdrag:** kontoret trykker «Nytt oppdrag» i arbeidskøen, fyller adresse, trykker «Lagre»; havner på `/oppdrag/<id>` med «Oppdrag NNN er lagret» (`role="status"`); oppdraget står i køen under «Bestilt». Telle trykk: 2 når forhåndsvalgene holder.
2. **menyen:** «Nytt oppdrag» er første menypunkt, før «Arbeidskø», og åpner `/oppdrag/ny`.
3. **tom kø:** i fanen «Bestilt» uten oppdrag står «Nytt oppdrag» (sekundær), ikke «Ny ordre».
4. **forhåndsvalg:** takstmann ser seg selv som ansvarlig og sitt kontor valgt; kontoret ser sitt kontor valgt og må velge ansvarlig fra listen med søk. Rapporttype står som fast tekst «Tilstandsrapport».
5. **feilmeldinger:** tom adresse og elleve sifre i bestiller gir melding ved feltet, fokus på første feil, ingen ny rad (database sjekkes).
6. **dublettvarsel i skjemaet:** forlat adressefeltet med en adresse som finnes på et annet oppdrag → varsel over «Lagre» med lenke; ingen «Lagre likevel»; «Lagre» virker. Oppslaget går som POST og adressen står aldri i en URL (alle forespørsler fanges).
7. **dublettvarsel på matrikkel:** ulik adresse, samme gnr/bnr → «samme matrikkel».
8. **dublettvarsel på oppdragssiden** etter lagring, med lenke til det andre.
9. **endre og historikk:** «Endre» på kortet «Bestilling», endre adressen, lagre; «Endringer» viser hvem, når og feltet.
10. **konflikt i to faner:** endre i fane 1, lagre i fane 2 → konfliktmelding, teksten i fane 2 står igjen, ingenting overskrevet.
11. **uten nett** (`context.setOffline(true)` etter at skjemaet er fylt): «Lagre» gir «Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.»; alt står; ingen nye rader; `localStorage`, IndexedDB og synkkøen (`pendingQueue`) er tomme for skjemaet. Tilbake på nett → «Lagre» gir ett oppdrag.
12. **dobbelt trykk:** `dblclick` og to raske klikk på «Lagre» (med treg respons via `page.route`) gir ett oppdrag og ett nummer; knappen er låst mens lagringen pågår.
13. **takstmann med innstillingen av:** ingen knapp i køen, ikke i menyen, og `/oppdrag/ny` gir tydelig «Ingen tilgang»; innstillingen settes tilbake i `finally`.
14. **admin med innstillingen av** ser knappen og lager oppdrag.
15. **bruker uten ansattrad** får «Ingen tilgang» på `/oppdrag/ny` og ser ingen kontor- eller takstmannsliste.
16. **gjort-om ordre:** ordresiden viser lenke til oppdraget med teksten om at rettelser gjøres der.
17. **gammel vei virker:** «Ny ordre» → «Gjør om til oppdrag» gir oppdrag med samme adresse og bestiller på kortet «Bestilling».
18. **tastatur og etiketter:** hele skjemaet fylles og sendes med Tab, piltaster (radioknapper) og Enter; alle felt har etikett (`getByLabel`); synlig fokus.

**Bare iPad (stående og liggende):**
19. **ingen nedtrekksliste** (`select`) på `/oppdrag/ny`.
20. **trykkflater:** kontorvalg og andre knapper minst 44 px, «Lagre» minst 56 px.
21. **ingen vannrett rulling** på `/arbeidskoe`, `/oppdrag/ny` og `/oppdrag/<id>`; knappen i køen bryter under hilsenen i stående.
22. **kontrast** på varsel og knapp minst 4,5:1.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| ADR 0011, ingen fast kode endret | gjennomgang; 2.11, 3.2 |
| Knapp i kø, tom kø og meny; oppdrag uten ordre | 1.4, 4.1.1–4.1.4, e2e 1–3 |
| Avvisninger, fremmed = ukjent | 4.2, 4.6 |
| Én transaksjon | 4.3 |
| Takstmann med innstilling av; admin alltid | 1.4, 4.4, e2e 13–14 |
| Dublettvarsel, POST, smalt svar | 2, 4.5.4, 4.12.4, e2e 6–8 |
| Dobbelt trykk | 4.1.7, e2e 12 |
| Uten nett | e2e 11 |
| Endring i alle statuser, konflikt, historikk | 4.7, e2e 9–10 |
| Søk og arbeidskø | 4.8 |
| Migreringen | 3.2 |
| Regresjon for ordre, kopi ved omgjøring | 4.9, e2e 16–17 |
| Sammenslåing | 4.11 |
| Elleve sifre | 1.1.4, e2e 5 |
| Ingen nye kolonner til KI | 1.2, 4.10 |
| Logger uten verdier | 1.3, 4.12 |
| Tenant-isolasjon for hver ny spørring | 4.5 (åtte kall), 3.1.3, 3.2.7 |
| E2e PC og iPad | 5 |
| Minor-versjon, seed uendret | gjennomgang (`git diff main -- src/db/seed package.json`), 4.9.4 |
| Ingen KI-forslag | gjennomgang: ingen kall til `src/core/ai` fra de nye tjenestene |
| Grønne kommandoer | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` |

## Godkjennes ikke uten

- 4.5 (alle åtte `expectTenantIsolation`) og 4.6 (fremmed id).
- 4.4.1, 4.4.2 og 1.4 (tilgang per rolle, admin stenges aldri ute).
- 4.2 og 4.3 (ingenting lagres ved avvisning eller feil).
- 3.2.5 (migreringen stopper uten endring) og 3.2.1 (ekte data uendret).
- 4.10 (vasken for oppdrag uten ordre og eiendom).
- 4.13 (ingen hard sletting).
- e2e 11 og 12 (uten nett og dobbelt trykk).
