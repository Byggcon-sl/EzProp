# Testplan: Tilbud i stedet for ordre

- **Oppgavekort:** `docs/funksjoner/fase2a-tilbud.md`
- **Dato:** 14.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** de ansatte (testene låser at «Gjør om til oppdrag» er ett trykk uten rulling på iPad, at menyen viser det kontoret bruker, og at åpne tilbud ikke drukner i gamle), KI i bunnen (statuskodene, `source`, `validUntil` og hendelsene låses, så et senere tilbudsutkast fra e-post bruker samme datamodell; vernet av fritekstfeltene står uendret), færre reklamasjoner (alle bestillingsfelt kopieres ved omgjøring, og dublettvarselet tar med åpne og nylig utløpte tilbud).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Tiden styres med faste tidspunkt ut fra `TEST_NOW` (03.11.2026 10:00 UTC) og `todayInOslo(now)`; ingen test avhenger av klokka i dag. Testdata er oppdiktet (adresser som «Testveien 12, 8000 Bodø», matrikkel 9999/123). e2e kjøres i prosjektene `pc` og `ipad`.

Ingen TG-regler. «Regeltestene» er utløpsregelen og datogrensene for `validUntil`, som tabeller med testsaker (`it.each`), med paritet mellom TS og SQL.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet. Avvik føres i kortet.

- `src/core/orders`: `OFFER_VALIDITY_DAYS = 30` (navn fritt, én konstant), `isOfferExpired(status, validUntil, today): boolean`, `offerDisplayStatus(status, validUntil, today): OfferDisplayStatus` (navn fritt), SQL-uttrykket for utløp i én fil, brukt av listen og tellingen.
- `listOrders(actor, organizationId, { query?, status?: OfferDisplayStatus | "all", today })` (navn på valget fritt; standard `open`).
- `ORDER_EDITABLE_FIELDS = [...BOOKING_EDITABLE_FIELDS, "validUntil"]`.
- `readBookingHistory(..., allowedFields)` tar listen som parameter.
- `src/core/assignments/booking/duplicate-sql.ts` får `today` som parameter.
- Videresending i `next.config.ts` med `redirects()` (`permanent: true` gir 308).

## 1. Enhet (rene, uten database)

### 1.1 Utløpsregelen, `src/core/orders/offer-status.test.ts` (ny, `it.each`)

1. **`received`, `validUntil` = i går** → utløpt; visningsstatus `expired`.
2. **`received`, `validUntil` = i dag** → ikke utløpt; `open`.
3. **`received`, `validUntil` = i morgen** → `open`.
4. **`rejected` og `converted` med `validUntil` for ett år siden** → aldri utløpt; `rejected` / `converted`.
5. **midnatt norsk tid, vinter:** `now = 2026-01-14T23:30Z` (00:30 15.01 i Oslo), `validUntil = 2026-01-14` → utløpt; `now = 2026-01-14T22:30Z` (23:30 14.01) → ikke utløpt.
6. **midnatt norsk tid, sommer:** `now = 2026-06-14T22:30Z` (00:30 15.06) → utløpt med `validUntil = 2026-06-14`; `now = 2026-06-14T21:30Z` → ikke utløpt.
7. **`OFFER_VALIDITY_DAYS` er 30** (låser konstanten).
8. **`OfferDisplayStatus` har nøyaktig `open`, `expired`, `converted`, `rejected`**, og `expired` finnes ikke i `ORDER_STATUSES` (kan ikke skrives til `orders.status`).

### 1.2 Etiketter, `src/core/orders/codes.test.ts` (utvides) og `src/app/(ansatt)/tilbud/offer-status-badge.test.ts` (ny)

1. **`received` → «Åpent», `rejected` → «Avslått», `converted` → «Gjort om til oppdrag», `expired` → «Utløpt»**. Hver verdi i `OfferDisplayStatus` har tekst (ny kode uten tekst gjør testen rød).
2. **utløpt merke viser «Utløpt 14.11.2026»** (datoen i norsk form) og har tekst, ikke bare farge.
3. **statuskodene er uendret:** `ORDER_STATUSES` er nøyaktig `["received", "converted", "rejected"]` (regel 6).
4. **hendelseskodene er uendret:** `order.received`, `order.rejected`, `order.updated` finnes; `order.converted` finnes ikke (A326).

### 1.3 Feltkoder, `src/core/orders/codes.test.ts`

1. **`validUntil` finnes i `ORDER_EDITABLE_FIELDS`** og **ikke i `BOOKING_EDITABLE_FIELDS`**.
2. **`ORDER_EDITABLE_FIELDS` inneholder alle `BOOKING_EDITABLE_FIELDS`** i samme rekkefølge, pluss `validUntil` sist.
3. **norsk etikett:** `orderFieldLabel("validUntil")` er «Gyldig til», og etiketten i adminloggen (`src/app/(ansatt)/admin/labels.ts`) gir samme tekst.

### 1.4 Zod for `validUntil`, `src/core/orders/schemas.test.ts` (utvides, `it.each`, `today = 2026-11-03`)

1. **i går** → «Gyldig til kan ikke være før i dag.».
2. **i dag** og **i dag + 365** → godtatt.
3. **i dag + 366** → «Gyldig til kan være høyst ett år fram.».
4. **ugyldig dato:** `2026-02-30`, `2026-13-01`, `03.11.2026`, `""`, `"abc"` → avvist med norsk melding, aldri rå Zod-tekst.
5. **skuddår:** `2028-02-29` godtatt når innenfor grensene.
6. **ny tilbudsform er forhåndsutfylt:** standardverdien er `today + 30` (`2026-12-03`).

### 1.5 Vern for fritekst (uendret), `src/core/ai` sine eksisterende tester

1. **`NEVER_FIELDS`** inneholder fortsatt avslagsgrunnen og bestillingsfeltene; testen står uendret og er grønn.
2. **`validUntil` er ikke fritekst** og legges ikke i listen (ingen ny endring av vernet).

### 1.6 Tekst og lenker, `src/app/(ansatt)/tilbud/no-ordre-text.test.ts` (ny, kildetekst-sjekk)

1. **ingen synlig «ordre» / «Ordre»** i strenger under `src/app/(ansatt)/tilbud/`, `src/app/(ansatt)/layout.tsx`, `possible-duplicates-notice.tsx` og `oppdrag/[id]/page.tsx`, unntatt «meglerens ordrenummer» (liste over tillatte unntak i testen).
2. **ingen lenke eller `revalidatePath` til `/ordre`** i `src/` (unntak: `next.config.ts` sine videresendinger). Treffer i dag bl.a. `firma/actions.ts`, `kontakter/actions.ts`, `oppdrag/[id]/actions.ts`, `oppdrag/[id]/page.tsx`, `src/core/organization/employees.ts`.
3. **mappen `src/app/(ansatt)/ordre/` finnes ikke lenger** (sidene er flyttet, ikke kopiert).

### 1.7 Videresending, `tests/next-redirects.test.ts` (ny, leser `next.config.ts`)

1. **`/ordre` → `/tilbud`, `/ordre/ny` → `/tilbud/ny`, `/ordre/:id` → `/tilbud/:id`**, alle `permanent: true`.
2. **ingen databaseimport** i `next.config.ts` (videresendingen slår ikke opp noe).

## 2. Migreringen, `src/db/migration-0035-tilbud.test.ts` (ny, mønster fra `migration-0034-booking.test.ts`)

Oppsett: testdatabasen migreres til 0034, rader settes inn med rå SQL, så kjøres 0035.

1. **åpne, avviste, gjort om og mykt slettede rader** får alle `valid_until = (received_at at time zone 'Europe/Oslo')::date + 30`.
2. **`received_at = 2026-03-10T23:30Z`** (norsk dato 11.03) → `valid_until = 2026-04-10`; **`2026-07-10T22:30Z`** (sommer, 11.07 i Oslo) → `2026-08-10`.
3. **status, `row_version`, `updated_at`, `deleted_at`, `rejected_reason`, `assignment_id`** og alle bestillingsfelt er uendret for hver rad (sammenlignet felt for felt før og etter).
4. **antall rader er likt** før og etter; ingen rader slettet.
5. **`valid_until` er `NOT NULL`** og **har ingen standardverdi** (`information_schema.columns`); innsetting uten `valid_until` feiler.
6. **ingen ny CHECK** mellom dato og status; CHECK på `status` er uendret.
7. **indeksen finnes:** `(organization_id, status, valid_until) where deleted_at is null` i `pg_indexes`, `organization_id` først.
8. **tom tabell:** migreringen kjører uten feil når `orders` er tom.
9. **gammel åpen rad** (`received_at` 60 dager før `TEST_NOW`) er utløpt etter migreringen (låser ADR-setningen om at gamle åpne blir «Utløpt»).
10. **`src/db/orders-schema.test.ts`** oppdateres: kolonnen, typen `date` og indeksen.
11. **`tests/tenant-tables.ts` er uendret**, og `tests/tenant-isolation-all-tables.test.ts` er grønn.

## 3. Kjernen mot databasen

Oppsett: organisasjon A med kontor, admin, leder, kontor og takstmann; organisasjon B likt. Tilbud lages med `createOrder` fra `tests/factories.ts`, som får `validUntil` (standard `todayInOslo(TEST_NOW) + 30`) og overstyring.

### 3.1 Paritet TS mot SQL, `src/core/orders/offer-status-parity.test.ts` (ny)

1. **alle sakene fra 1.1** kjøres gjennom `isOfferExpired` og gjennom SQL-uttrykket (`select <uttrykk> from (values …)`) med `today` som parameter. Like svar.
2. **SQL-teksten inneholder ikke `now()`, `current_date` eller `localtimestamp`** (én klokke, fra parameteren).

### 3.2 Listen og filtrene, `src/core/orders/offer-list.test.ts` (ny)

Seed: ett tilbud per visningsstatus (åpent, utløpt, avslått, gjort om), pluss ett mykt slettet i hver status.

1. **standard (ingen `status`) = `open`:** bare det åpne, ikke utløpt.
2. **`expired`, `rejected`, `converted`:** nøyaktig det ene tilbudet i hver.
3. **`all`:** de fire, ingen mykt slettede.
4. **mykt slettet vises ikke i noe filter** (`it.each` over alle fem).
5. **ukjent `status` (`"slettet"`, `"expired'--"`)** → standard `open` eller Zod-feil, aldri databasefeil.
6. **søket sammen med filter:** søk på adressen til det utløpte i `open` → ingen treff; i `expired` → ett treff; i `all` → ett treff.
7. **`total` og `orderListSummary`** følger filteret.
8. **grensedag:** `validUntil = today` er i `open`, ikke i `expired`.
9. **«Gyldig til»** er med i hver rad (`OrderListItem.validUntil`).
10. **T-0031:** tilbud gjort om til oppdrag som er kansellert → raden har oppdragets status «Kansellert» (feltet i `OrderListItem`), ikke bare «Gjort om til oppdrag». Funnet settes til «rettet».
11. **ytelse:** `EXPLAIN` av standardlisten med `set local enable_seqscan = off` bruker den nye indeksen (ingen `Seq Scan on orders`).

### 3.3 Lage tilbud, `src/core/orders/orders.test.ts` (utvides)

1. **`createOrder` med `validUntil`** lagrer datoen; `source = manual`; hendelsen `order.received` som før.
2. **`validUntil` i går eller i dag + 366** → avvist, ingen rad, ingen hendelse.
3. **uten `validUntil`** → Zod-feil (påkrevd i kjernen; skjemaet forhåndsutfyller).

### 3.4 Gjør om til oppdrag, `src/core/orders/convert-offer.test.ts` (ny) og `convert-copies-booking.test.ts` (utvides)

1. **åpent tilbud** → oppdrag med alle bestillingsfelt (eksisterende test står), `order.status = converted`, `assignment.created` med `orderId`, revisjon `order`/`convert`.
2. **utløpt tilbud** → gjøres om på samme måte.
3. **`valid_until` kopieres ikke:** `assignments` har ingen kolonne `valid_until` (`information_schema`), og svaret har ikke feltet.
4. **avslått** og **allerede gjort om** → `OrderAlreadyHandledError`, ingen nytt oppdrag, ingen hendelse.
5. **to samtidige kall** (`Promise.allSettled`) → nøyaktig ett oppdrag, ett `assignment.created`, ett kall feiler med `OrderAlreadyHandledError`.
6. **mykt slettet tilbud** → `AccessDeniedError` (som ukjent id), ingen oppdrag.
7. **uten kontor** (admin uten kontor) med `officeId` valgt → virker; med kontor fra organisasjon B → `OfficeNotFoundError`.
8. **ingen ny hendelseskode:** antall `event_type` etter omgjøring er `assignment.created` (og eventuelt eksisterende), aldri `order.converted`.

### 3.5 Avslå, `src/core/orders/orders.test.ts` (utvides)

1. **uten grunn** (`""`, `"   "`) → avvist, status uendret.
2. **åpent og utløpt** → `rejected` med grunnen, `order.rejected`.
3. **avslått eller gjort om** → `OrderAlreadyHandledError`.
4. **mykt slettet** → `AccessDeniedError`.

### 3.6 Endre `validUntil`, `src/core/orders/update-order.test.ts` (utvides) og `history.test.ts`

1. **utløpt tilbud får ny dato** (i dag + 10) → visningsstatus `open`; raden er i `open`-listen igjen.
2. **historikken:** endringen står i `readBookingHistory` for tilbudet med feltkode `validUntil`, gammel og ny dato, hvem og når.
3. **`readBookingHistory` for et oppdrag** viser aldri `validUntil` (listen sendes inn).
4. **avslått og gjort-om tilbud:** endring av `validUntil` → «Gyldig til kan bare endres på åpne og utløpte tilbud.»; ingen endring lagret, `row_version` uendret.
5. **avslått og gjort-om tilbud:** endring av adressen (uten ny dato) → lagres (T1, A327).
6. **utløpt tilbud, annet felt endres, `validUntil` uendret (i fortiden)** → lagres; grensene sjekkes bare ved ny dato.
7. **ny dato i går / i dag + 366** → feilmeldingene fra 1.4, ingenting lagret.
8. **`updateAssignmentBooking` med `validUntil`** → feltet avvises eller ignoreres (låser at det bare finnes på tilbud).
9. **utdatert `row_version`** → `OrderChangedError` som i dag.
10. **mykt slettet** → `AccessDeniedError`.

### 3.7 Arbeidskøen, `src/core/assignments/work-queue.test.ts` (utvides)

1. **et åpent og et utløpt tilbud** (ikke gjort om) → `listWorkQueue` gir ingen rad for dem og `countWorkQueueByStatus` er uendret (alle statuser 0 når ingen oppdrag finnes).
2. **gjort-om tilbud** → bare oppdraget teller, én gang.

### 3.8 Dublettvarselet, `src/core/assignments/booking/duplicates-cross-table.test.ts` og `src/core/orders/duplicates-db.test.ts` (utvides, `it.each`)

1. **åpent tilbud mottatt 200 dager før, ikke utløpt** (`validUntil` fram i tid) → treff.
2. **utløpt tilbud mottatt 89 dager før** → treff; **91 dager før** → ikke treff (90-dagersvinduet, A325).
3. **grensedag:** `validUntil = today` regnes som åpent (treff uansett alder).
4. **mykt slettet tilbud** → aldri treff.
5. **avslått tilbud** → ingen treff (uendret).
6. **`duplicate-sql.ts` importerer ikke fra `src/core/orders`** (kildetekst-sjekk; ADR 0011 punkt 9).
7. **`today` kommer som parameter**, ikke `now()` (kildetekst-sjekk som 3.1.2).

### 3.9 Tilgang per rolle (`it.each`, alle tjenestene: liste med hvert filter, `getOrder`, `createOrder`, `updateOrder` med `validUntil`, `convertOrderToAssignment`, `rejectOrder`)

1. **`inspector`, `office`, `manager`, `admin`** får lese og endre.
2. **admin med bare adminrollen og uten kontor** kan lage, endre, gjøre om (med valgt kontor) og avslå (regel 11).
3. **ingen ansattrad, deaktivert ansatt, myk-slettet ansatt, ansatt uten roller, ansatt uten `assignment.edit`** → `AccessDeniedError` på endring; lesing som i dag.
4. **`access.inspectors_edit_all = false`** endrer ikke dette (tilbud følger `assignment.edit`, som i dag); testen låser dagens oppførsel.

### 3.10 Tenant-isolasjon (regel 2), `src/core/orders/offer-tenant.test.ts` (ny)

1. **`expectTenantIsolation` for `listOrders`**, ett kall per filter (`open`, `expired`, `rejected`, `converted`, `all`), med tilbud i riktig status i både A og B.
2. **`expectTenantIsolation` for `getOrder`.**
3. **`expectTenantIsolation` for `updateOrder` med `validUntil`.**
4. **`expectTenantIsolation` for `convertOrderToAssignment`.**
5. **`expectTenantIsolation` for `rejectOrder`.**
6. **`expectTenantIsolation` for dublettspørringen** med utløpte tilbud (samme adresse i A og B).
7. **IDOR:** admin i A med `orgA.id` og et tilbud-id fra B → `AccessDeniedError` for lese, endre, gjøre om og avslå; Bs tilbud er uendret (`row_version`, status).
8. **feil organisasjon i argumentet:** admin i A med `orgB.id` → `AccessDeniedError`.

### 3.11 Logg og myk sletting

1. **logg uten persondata:** spion på `logger` ved omgjøring, avslag og endring av `validUntil`, også i feilgrenen (`OrderAlreadyHandledError`, tvunget databasefeil): ingen adresse, `gnr`/`bnr`/`snr`, avslagsgrunn eller bestillernavn i loggen.
2. **ingen permanent sletting:** kildetekst-sjekk av `src/core/orders` (ingen `db.delete`/`tx.delete`/`DELETE FROM`).

## 4. Skjermene, komponent- og handlingstester

### 4.1 `src/app/(ansatt)/tilbud/actions.test.ts` (flyttet fra `ordre/actions.test.ts`, utvidet)

1. **«Gjør om til oppdrag»** sender til `/oppdrag/<id>` med kvitteringen «Oppdraget er laget.».
2. **avslå uten grunn** → feltfeil, teksten står igjen.
3. **endring av `validUntil` med feil** → feilmelding ved feltet, og ingen «Lagret.».
4. **T-0089 («Lagret.»-delen):** etter en lagring som lyktes og så en som feiler, vises bare feilmeldingen; kvitteringen kommer ikke tilbake ved omlasting (ingen `?endret=1` igjen i adressen etter visning, eller tilsvarende). Lagring der ingenting ble endret (tom «Mottatt») gir ikke «Endringene er lagret.». Funnet settes til «rettet» (den delen).
5. **ingen tilgangslogikk i handlingene** utover kall til kjernen (kildetekst-sjekk: ingen `roles.includes`, ingen sammenligning med `organizationId` fra skjemaet).

### 4.2 `src/app/(ansatt)/tilbud/[id]/page.test.ts` (flyttet og utvidet)

1. **rekkefølge:** tittel, statusmerke, «Gjør om til oppdrag», «Avslå tilbud», så detaljkortet (rekkefølgen i HTML).
2. **knappene vises** for åpent og utløpt; **ikke** for avslått og gjort om.
3. **kontorvalget vises** bare når den ansatte ikke har kontor; ellers er kontoret forhåndsvalgt (A295).
4. **utløpt:** «Utløpt 14.11.2026» i merket.

### 4.3 `src/app/(ansatt)/oppdrag/[id]`: «Laget fra tilbud» og T-0075

1. **oppdrag laget fra tilbud** viser «Laget fra tilbud» med lenke til `/tilbud/<id>`.
2. **T-0075:** teksten på endre-skjemaet for et gjort-om tilbud sier det som faktisk skjer (ingen påstand om at oppdraget ikke endres eller at bestilleren endres på oppdraget). Testen låser den nye teksten. Funnet settes til «rettet».

### 4.4 Menyen, `src/app/(ansatt)/layout.test.ts` eller e2e 5.1

1. **rekkefølge:** Nytt oppdrag, Arbeidskø, Kontakter, Firma, Tilbud, Statistikk.
2. **ingen «Nytt tilbud» i menyen.**

## 5. e2e, `e2e/fase-2a-tilbud.spec.ts` (ny, `pc` og `ipad`)

`fase-2a-ordre.spec.ts`, `fase-2a-rette-ordre.spec.ts` og `fase-2a-sok-ordre-arbeidsko.spec.ts` gjøres om til tilbud (nye navn: `fase-2a-tilbud-grunn.spec.ts`, `fase-2a-rette-tilbud.spec.ts`, `fase-2a-sok-tilbud-arbeidsko.spec.ts`; testene beholder innholdet, med ny tekst og nye adresser). Tilbud lages direkte i testdatabasen der status eller dato må styres, med unike oppdiktede adresser per test.

1. **5.1 menyen:** «Tilbud» står under «Firma» og over «Statistikk», er aktivt på `/tilbud` og `/tilbud/<id>`; ingen synlig «ordre» på `/tilbud`, `/tilbud/ny`, `/tilbud/<id>` (unntak «meglerens ordrenummer»).
2. **5.2 videresending:** `request.get("/ordre", { maxRedirects: 0 })` gir 308 med `location` `/tilbud`; det samme for `/ordre/ny` og `/ordre/<id>`.
3. **5.3 annen organisasjons id:** `/ordre/<id i B>` → 308 til `/tilbud/<id>` → samme «Fant ikke siden» / «Ingen tilgang» som en ukjent id; ingen adresse fra B synlig.
4. **5.4 nytt tilbud:** knappen «Nytt tilbud» på listen, «Gyldig til» forhåndsutfylt med i dag + 30, lagres og vises i «Åpne».
5. **5.5 gjør om med ett trykk:** fra tilbudssiden, ett trykk, havner på oppdraget med «Oppdraget er laget.»; adresse, matrikkel og bestiller står på oppdraget; «Laget fra tilbud» lenker tilbake; tilbudet står som «Gjort om til oppdrag».
6. **5.6 dobbelttrykk:** `dblclick` på «Gjør om til oppdrag» → nøyaktig ett oppdrag (telt i databasen), knappen er låst mens lagringen pågår.
7. **5.7 admin uten kontor:** kontorvalget vises ved knappen, velg kontor, omgjøring virker.
8. **5.8 avslå med grunn:** tomt felt gir feilmelding ved feltet; med grunn → «Avslått», knappene borte; tilbudet står i «Avslått» og ikke i «Åpne».
9. **5.9 utløpt tilbud:** står i «Utløpt» med «Utløpt [dato]», ikke i «Åpne»; kan gjøres om og avslås.
10. **5.10 ny dato:** utløpt tilbud → «Endre» → «Gyldig til» i dag + 10 → «Lagre» → tilbake i «Åpne», og «Endringer» viser datoendringen.
11. **5.11 filter i adressen:** trykk «Utløpt» → adressen har `?status=…`; åpne et tilbud; «Tilbake» → samme filter valgt og samme liste. Søk + filter virker sammen.
12. **5.12 arbeidskøen:** et åpent og et utløpt tilbud vises ikke i arbeidskøen, og tellingen i fanene er uendret.
13. **5.13 takstmann og kontor** ser listen og kan gjøre om (logget inn som `INSPECTOR_EMAIL` og en kontorbruker).
14. **5.14 bruker uten ansattrad** får «Ingen tilgang» på `/tilbud` og `/tilbud/<id>`, ingen adresse synlig.
15. **5.15 uten nett:** `context.setOffline(true)` på «Nytt tilbud», «Avslå tilbud» og «Endre» → nettmeldingen vises, og det som er skrevet står igjen; med nett igjen kan det lagres.
16. **5.16 tilgjengelighet:** `h1` «Tilbud», filterknappene er knapper/lenker med `aria-current` (eller `aria-pressed`) på valgt, kontrasten på statusmerkene er minst 4,5:1 (egen `contrastRatio`, som i `fase-1-testskjema.spec.ts`); se merknad om axe.
17. **5.17 tastatur:** filter, «Gjør om til oppdrag» og «Avslå tilbud» kan nås med Tab og brukes med Enter, med synlig fokus.

**Bare `ipad` (stående og liggende):**

18. **5.18 ingen rulling til hovedknappen:** «Gjør om til oppdrag» er helt synlig i visningsvinduet uten rulling på `/tilbud/<id>` (også med dublettvarsel og lang adresse), og er minst 56 px høy.
19. **5.19 filterknappene** og «Avslå tilbud» er minst 44 px høye.
20. **5.20 ingen vannrett rulling** på `/tilbud`, `/tilbud/ny`, `/tilbud/<id>` (`scrollWidth <= clientWidth`).
21. **5.21 flyten på iPad:** lag tilbud, gjør om med ett trykk, og avslå et annet tilbud, i stående.

## 6. Testdata og fabrikker

1. **`tests/factories.test.ts`:** `createOrder` gir `validUntil` = `todayInOslo(TEST_NOW) + 30` som standard og tar overstyring.
2. **`pnpm db:seed:testdata`** (eksisterende test for testdata utvides): minst ett åpent, ett utløpt, ett avslått og ett gjort-om tilbud; det utløpte er utløpt uansett dag (datoen regnes fra dagens dato); alle adresser oppdiktet.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| ADR 0012 | 1.1.8, 1.2.3–4, 3.1, 3.4.8, 3.8 (gjennomgang av ADR-en i rapporten) |
| Migrering 0035 | 2.1–2.11 |
| Menyen, ingen «ordre» | 1.6, 4.4, 5.1 |
| 308 uten oppslag | 1.7, 5.2, 5.3 |
| Gjør om øverst, ett trykk, alt fylt inn | 3.4.1, 4.1.1, 4.2.1, 5.5, 5.18 |
| Admin uten kontor | 3.4.7, 3.9.2, 5.7 |
| To raske trykk | 3.4.5, 5.6 |
| Avslå krever grunn | 3.5, 5.8 |
| Utløpt | 1.1, 3.2, 3.4.2, 3.5.2, 3.6.1, 5.9, 5.10 |
| `validUntil` bare åpne/utløpte, grenser, historikk | 1.4, 3.6 |
| Filter 44 pt i adressen | 5.11, 5.19 |
| Utenfor arbeidskøen | 3.7, 5.12 |
| Dublettvarselet | 3.8 |
| Myk sletting | 3.2.4, 3.4.6, 3.5.4, 3.6.10, 3.8.4, 3.11.2 |
| Annen organisasjon | 3.10, 5.3 |
| Nettfeil | 5.15 |
| iPad og axe | 5.16–5.21 |
| Vern for fritekst | 1.5 |
| T-0031, T-0075, T-0089 | 3.2.10, 4.3.2, 4.1.4 |

## Merknader til utvikler og prosjektleder

- **Nettmeldingen (lite):** kortet sier «Ingen nett. Prøv igjen.», men endre-skjemaet bruker i dag `ORDER_OFFLINE_MESSAGE` = «Du er uten nett. Endringen er ikke lagret.» (`src/app/(ansatt)/ordre/order-values.ts`), og «Ny ordre» og «Avvis» har ingen egen nettmelding. Velg én tekst for alle tre skjemaene og før den i kortet; 5.15 krever samme tekst i alle tre og at skrevet tekst står igjen.
- **Axe (lite):** `@axe-core/playwright` er ikke avhengighet i repoet. 5.16 bruker den egne kontrastsjekken og rolle-/overskriftsjekker, så ingen ny avhengighet trengs (regel 9). Skal axe inn, må PR-en begrunne det.
- **Lenker til `/ordre` utenfor sidene (lite):** `firma/actions.ts`, `kontakter/actions.ts`, `oppdrag/[id]/actions.ts`, `oppdrag/[id]/page.tsx`, `possible-duplicates-notice.tsx` og `src/core/organization/employees.ts` nevner `/ordre` i dag. 1.6.2 blir rød til alle er rettet.
- **Versjon:** minor, 0.13.1 → 0.14.0 i `package.json` (regel 13).

## Godkjenning

Test-leder godkjenner ikke uten 3.9 (tilgang per rolle, admin uten kontor), 3.10 (tenant-isolasjon for liste med hvert filter, side, endring, omgjøring, avslag og dublett), 2 (migrering mot ekte-lignende rader), 3.1 (paritet), 3.4.5 og 5.6 (ett oppdrag ved dobbelttrykk) og 5.18 (ingen rulling på iPad).
