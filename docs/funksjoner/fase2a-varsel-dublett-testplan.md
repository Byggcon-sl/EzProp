# Testplan: Varsel om mulig dublett på ordren (T3)

- **Oppgavekort:** `docs/funksjoner/fase2a-varsel-dublett.md`
- **Dato:** 13.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** de ansatte (testene låser at kontoret får et tydelig varsel med lenke, og at varselet aldri stopper lagring eller knapper), KI i bunnen (kjernetjenesten `findPossibleDuplicateOrdersFor` testes med ordrefelt som ikke er lagret, slik at e-post-til-ordre kan bruke den uendret; ingen adresse eller matrikkel i logg eller til KI), færre reklamasjoner (regelen er låst med testsaker, slik at doble oppdrag på samme bolig oppdages).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Tid styres med faste tidspunkt ut fra `TEST_NOW` (03.11.2026 10:00 UTC); ingen test avhenger av klokka i dag. Testdata er oppdiktet: adresser som «Testveien 12, 8000 Bodø», «Storgata 1A, 8006 Bodø» (oppdiktet bruk), matrikler som 9999/123.

Ingen TG-regler. «Regeltestene» er normaliseringen og tidsvinduet, som tabeller med testsaker (`it.each`). Ordre er kontorarbeid med nett, så det er ingen e2e uten nett (kortet: «Uten nett» ikke med). e2e kjøres i prosjektene `pc` og `ipad`.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1. Avvik føres i kortet.

- `src/core/orders/duplicates.ts` (navn fritt i mappen): `normalizeAddressKey(text) → string | null`, `normalizeCadastreNumber(text) → string | null`, `MAX_DUPLICATE_WINDOW_DAYS = 90`, en ren `isWithinDuplicateWindow(a, b) → boolean` (navn fritt) og en ren `duplicateReasons(a, b) → ("address" | "cadastre")[]` (navn fritt).
- SQL-uttrykkene i én fil i `src/core/orders` (for eksempel `duplicate-sql.ts`), brukt både av spørringen og av migreringen (samme tekst).
- `findPossibleDuplicateOrdersFor(actor, organizationId, { addressText, gnr, bnr, snr, receivedAt, excludeOrderId? }) → { items: PossibleDuplicateOrder[], hasMore: boolean }`.
- `findPossibleDuplicateOrders(actor, organizationId, orderId)` med samme svar.
- `DUPLICATE_REASONS = ["address", "cadastre"]` i `src/core/orders/codes.ts`.
- Varselet som egen komponent ved ordresiden (for eksempel `possible-duplicates-notice.tsx`), slik at den kan prøves uten hele siden.

## 1. Normaliseringen, `src/core/orders/duplicates.test.ts` (ny, ren)

### 1.1 Adresse (`normalizeAddressKey`, `it.each`)

1. **«Storgata 1A, 8006 Bodø» = «storgata 1 a» = «Storgata 1a» = «STORGATA 1-A.»** → samme nøkkel `storgata1a`.
2. **med og uten postnummer etter komma** → samme nøkkel.
3. **bare delen før første komma:** «Storgata 1A, H0101, 8006 Bodø» = «Storgata 1A».
4. **adresse uten komma** brukes i sin helhet.
5. **æ, ø og å beholdes:** «Øvre gate 2» ≠ «Ovre gate 2»; «Ærfuglveien 3» gir nøkkel som starter med `æ`.
6. **store Æ/Ø/Å blir små** («ØVRE GATE 2» = «øvre gate 2»).
7. **tom nøkkel gir `null`:** `""`, `"   "`, `","`, `" , 8006 Bodø"`, `"-."` → `null`.
8. **ulik husbokstav eller nummer:** «Storgata 1A» ≠ «Storgata 1B»; «Storgata 1» ≠ «Storgata 11».

### 1.2 Matrikkel (`normalizeCadastreNumber`, `it.each`)

1. **«012» = «12» = « 12 »** → `12`.
2. **mellomrom inni tas bort:** «1 2» → `12`.
3. **ikke utfylt gir `null`:** `null`, `""`, `"  "`, `"0"`, `"000"`.

### 1.3 Grunner (`duplicateReasons`, `it.each`)

1. **ulik adresse, samme gnr/bnr/snr** → `["cadastre"]`.
2. **samme adresse, ulik matrikkel** → `["address"]`.
3. **begge like** → `["address", "cadastre"]` (fast rekkefølge).
4. **`gnr` «0» eller «000» på begge, ellers like** → ingen `cadastre`.
5. **bare `gnr` utfylt på begge** (bnr tom) → ingen `cadastre`.
6. **`snr` tom mot `snr` «0»** → like (`cadastre`).
7. **samme gnr/bnr, ulikt `snr`** (2 mot 3) → ingen `cadastre`.
8. **samme gnr/bnr, ett `snr` tomt og ett «2»** → ingen `cadastre`.
9. **begge adresser tomme** → aldri `address`.

### 1.4 Tidsvinduet (`isWithinDuplicateWindow`, `it.each`)

1. **nøyaktig 90 × 24 timer mellom** → treff (grensen teller med), begge veier (før og etter).
2. **90 døgn og 1 sekund** → ikke treff.
3. **91 døgn** → ikke treff.
4. **over skifte til sommertid:** `a = 2026-01-15T10:00Z`, `b = a + 2160 timer` → treff; `b + 1 s` → ikke treff (fast varighet, ikke kalenderdøgn).
5. **`MAX_DUPLICATE_WINDOW_DAYS` er 90** (låser konstanten).

### 1.5 Faste koder

1. **`DUPLICATE_REASONS` er nøyaktig `["address", "cadastre"]`** (regel 6: en kode som fjernes eller endres gjør testen rød).

## 2. Paritet TS mot SQL, `src/core/orders/duplicates-parity.test.ts` (ny, mot databasen)

1. **adresse:** hele tabellen fra 1.1 kjøres gjennom `normalizeAddressKey` og gjennom SQL-uttrykket (`select <uttrykk> from (values …)`). Like svar for hver rad; `null` i TS = `null` eller tom tekst i SQL (avtales én av dem, og testen krever den).
2. **matrikkel:** hele tabellen fra 1.2 gjennom `normalizeCadastreNumber` og SQL-uttrykket. Like svar.
3. **samme tekst i indeks og spørring:** `pg_indexes.indexdef` for de to nye indeksene inneholder uttrykket fra SQL-filen (sammenlignet etter at PostgreSQL har skrevet det om; testen leser uttrykket via `pg_get_indexdef` og kjører det på samme testsaker, og svarene må være like).
4. **bare IMMUTABLE:** migreringen kjører uten feil (indeks med ikke-IMMUTABLE funksjon feiler i PostgreSQL); dekkes av at testdatabasen er migrert.

## 3. Kjernen, `src/core/orders/duplicates-db.test.ts` (ny, mot databasen)

Oppsett: organisasjon A med kontor, admin og takstmann. «Denne» ordren er mottatt `TEST_NOW`. Hver testsak lager den andre ordren med `createOrder` (og `createAssignment` ved gjort om).

### 3.1 Regelen mot databasen (`it.each`, samme saker som kortet)

1. **samme adresse, ulik skrivemåte** (alle variantene fra 1.1.1–1.1.3) → ett treff, `reasons = ["address"]`.
2. **«Øvre gate 2» mot «Ovre gate 2»** → ingen treff.
3. **tom adresse** kan ikke lagres (NOT NULL), men adresse «,» eller « , 8006 Bodø» på begge → ingen treff.
4. **ulik adresse, samme gnr/bnr/snr, «012» mot «12»** → treff `["cadastre"]`.
5. **gnr «0»/«000», bare gnr, ulikt snr, tomt mot «2»** → ingen treff på matrikkel.
6. **`snr` tom mot «0»** → treff `["cadastre"]`.
7. **begge like** → ett treff (ikke to rader), `reasons = ["address", "cadastre"]`.
8. **den andre er avvist** → ingen treff.
9. **den andre er gjort om, oppdraget kansellert** (`assignments.deleted_at` satt) → ingen treff.
10. **gjort om, oppdrag `ordered` og `in_progress`** → treff, med oppdragsnummer og oppdragsstatus i svaret.
11. **gjort om, oppdrag `completed` og `invoiced`, 90 døgn før** → treff; **90 døgn og 1 s / 91 døgn før** → ingen treff.
12. **mottatt 200 døgn før og fortsatt `received`** → treff.
13. **gjort om med oppdrag `in_progress`, 200 døgn før** → treff (åpent oppdrag).
14. **mottatt 90 døgn etter denne og avsluttet** → treff; 91 døgn etter → ingen treff.
15. **sommertid:** denne mottatt `2026-01-15T10:00Z`, den andre `+ 2160 timer` og `completed` → treff; `+ 2160 timer + 1 s` → ingen treff (SQL gir samme svar som 1.4.4).
16. **myk-slettet annen ordre** (`deleted_at` satt) → aldri treff.
17. **ordren selv** (via `excludeOrderId`) → aldri treff.

### 3.2 Svaret

1. **feltene i `PossibleDuplicateOrder`:** `id`, `receivedAt`, `addressText`, ordrestatus, oppdragsnummer og oppdragsstatus (`null` når ikke gjort om), `reasons`. Nøklene er en fast liste (ingen `gnr`/`bnr`/`snr`, ingen kontaktfelt).
2. **11 treff, tre med lik `received_at`** → 10 i svaret, `hasMore = true`, sortert `received_at` nyeste først og så `id`; samme rekkefølge ved to kall.
3. **nøyaktig 10 treff** → 10, `hasMore = false`.
4. **ingen treff** → tom liste, `hasMore = false`.

### 3.3 `findPossibleDuplicateOrdersFor` med ordrefelt som ikke er lagret (KI i bunnen)

1. **uten `excludeOrderId`**, adresse lik en lagret ordre → treff (slik e-post-til-ordre vil kalle den).
2. **ingen ordre lagres eller endres** av kallet (antall rader i `orders`, `events` og `audit_log` uendret).
3. **inndata valideres:** ugyldig `receivedAt` eller `excludeOrderId` som ikke er uuid → feil fra Zod eller `AccessDeniedError`, aldri databasefeil (avtales i koden; testen krever at det ikke kastes en rå PostgreSQL-feil).

### 3.4 `findPossibleDuplicateOrders` (innpakningen)

1. **ordren selv er avvist** → tom liste, selv om en annen åpen ordre har samme adresse.
2. **ordren er gjort om** → treff som vanlig, ordren selv ikke med.
3. **ukjent uuid, `"ikke-en-id"`, myk-slettet ordre** → `AccessDeniedError`, aldri databasefeil.
4. **ordren ble endret** (adresse rettet med `updateOrder`) → treffene følger den nye adressen; rettes den tilbake, forsvinner treffet (låser akseptkriteriet om T1 i kjernen).

### 3.5 Tilgang per rolle (`it.each`, begge tjenestene)

1. **`inspector`, `office`, `manager`, `admin`** får svar.
2. **admin med bare adminrollen** får svar (regel 11).
3. **ingen ansattrad, deaktivert ansatt, myk-slettet ansatt, ansatt uten roller** → `AccessDeniedError`.
4. **`access.inspectors_edit_all = false`** endrer ikke lesingen (takstmann får fortsatt svar).

### 3.6 Tenant-isolasjon (regel 2)

1. **`expectTenantIsolation` for `findPossibleDuplicateOrdersFor`:** `seed` lager to ordre med samme adresse i A og to i B; `query` kaller tjenesten med adressen; `idOf = id`.
2. **`expectTenantIsolation` for `findPossibleDuplicateOrders`:** samme oppsett; `query` slår opp en av organisasjonens egne ordre (via en hjelper i testen som finner en ordre i `organizationId`).
3. **samme adresse og matrikkel i A og B:** A får ingen treff fra B, B ingen fra A (begge veier, både adresse og matrikkel).
4. **IDOR:** admin i A med `orgA.id` og Bs `orderId` → `AccessDeniedError`, ingen treff.
5. **feil organisasjon i argumentet:** admin i A med `orgB.id` → `AccessDeniedError` (filteret er `grant.organizationId`).

### 3.7 Logg uten persondata

1. **vanlig kall med treff:** spion på `logger` (alle nivåer). Ingen loggrad inneholder adressen, normalisert adressenøkkel, `gnr`, `bnr` eller `snr` (oppdiktede, unike verdier som er lette å finne i teksten).
2. **feilgrenen:** databasefeil tvunget (spion som kaster fra spørringen) → feilen logges uten de samme verdiene, og uten den rå SQL-teksten med parametre.

### 3.8 Ytelse (A291)

1. **adresse:** `EXPLAIN` av spørringen for adresse med `set local enable_seqscan = off` i en transaksjon → planen har ingen `Seq Scan on orders` og nevner den nye adresseindeksen.
2. **matrikkel:** det samme for matrikkelen og matrikkelindeksen.
3. **testen bruker den ekte spørringen** (bygget av samme funksjon som tjenesten), ikke en kopi.

### 3.9 Myk sletting

1. **ingen eksportert funksjon i den nye filen sletter permanent** (kildetekst-sjekk som i de andre modulene, ingen `db.delete`/`tx.delete`/`DELETE FROM`).

## 4. Migreringen, `tests/migrations` eller i 3.8 (mot databasen)

1. **migreringen kjører på en database med eksisterende ordre** (også ordre med tom `gnr`, adresse bare «,») uten feil.
2. **de to indeksene finnes** i `pg_indexes` med `organization_id` som første kolonne.
3. **`tests/tenant-tables.ts` er uendret** (ingen ny tabell), og `tests/tenant-isolation-all-tables.test.ts` er grønn.

## 5. Varselet på siden, komponenttest (ny, ved `src/app/(ansatt)/ordre/[id]/`)

1. **ingen treff** → ingenting vises.
2. **ett treff** → `h2` «Mulig dublett», teksten fra kortet, `role="status"`, ikon med `aria-hidden` og tekst ved siden av (ikke bare farge).
3. **treff-linjen:** adresse, «mottatt dd.mm.åååå» i Oslo-tid (treff mottatt `2026-11-11T23:30Z` vises som 12.11.2026), statusord fra `OrderStatusBadge`, «oppdrag <nummer>» når gjort om, grunn «samme adresse», «samme matrikkel» eller begge.
4. **lenken** går til `/ordre/<id>` for den andre ordren.
5. **`hasMore = true`** → «Viser de 10 nyeste.»; ellers ikke.
6. **koder blir ord:** alle verdier i `DUPLICATE_REASONS` har tekst (ny kode uten tekst gjør testen rød).

## 6. Siden, `src/app/(ansatt)/ordre/[id]/page`-test eller i e2e

1. **feil i oppslaget** (tjenesten kaster) → siden vises med ordren og knappene, uten varsel, og feilen logges uten verdier (kan også dekkes i e2e med en tvunget feil hvis komponenttest av siden ikke finnes; utvikler velger, testskriver dekker én av dem).

## 7. e2e, `e2e/fase-2a-varsel-dublett.spec.ts` (ny, prosjektene `pc` og `ipad`)

Ordre lages direkte i testdatabasen (som i `fase-2a-rette-ordre.spec.ts`) med oppdiktede, unike adresser per test, slik at testene ikke ser hverandres ordre.

1. **7.1 «Ny ordre» med samme adresse som en åpen ordre** (annen skrivemåte) → etter «Lagre» står «Mulig dublett» med lenke; ordren er lagret (vises i ordrelisten).
2. **7.2 lenken åpner den andre ordren**, og der står varselet med lenke tilbake.
3. **7.3 rekkefølge:** etter «Endre ordren» → «Lagre» står «Endringene er lagret.» over varselet, og varselet over «Gjort om til oppdrag» (sjekket med `boundingBox().y`).
4. **7.4 rette adressen** til en annen ordres adresse → varselet vises; rette tilbake → varselet borte.
5. **7.5 varselet stopper ingenting:** «Gjør om til oppdrag» virker med varselet synlig, uten ekstra trykk eller dialog; det samme for «Avvis» (egen ordre) og «Endre ordren».
6. **7.6 avvist ordre** med samme adresse som en åpen → ingen varsel på den avviste; den åpne viser ikke den avviste som treff.
7. **7.7 matrikkel:** ulik adresse, samme gnr/bnr → varselet med «samme matrikkel».
8. **7.8 11 treff** → 10 linjer og «Viser de 10 nyeste.».
9. **7.9 kontoret og takstmannen** ser varselet (logget inn som `INSPECTOR_EMAIL` og en kontorbruker).
10. **7.10 annen organisasjon:** ordre i en oppdiktet organisasjon B med samme adresse vises aldri som treff.
11. **7.11 skjermleser og kontrast:** varselet har `role="status"`, `h2` «Mulig dublett», og tekstkontrasten mot bakgrunnen er minst 4,5:1 (samme `contrastRatio` som i `fase-1-testskjema.spec.ts`; ingen ny avhengighet, se merknad under).
12. **7.12 tastatur:** lenkene kan nås med Tab og åpnes med Enter, og har synlig fokus.

**Bare `ipad` (stående og liggende):**

13. **7.13 ingen vannrett rulling** med 10 treff og lange adresser (`scrollWidth <= clientWidth`).
14. **7.14 lenkene er minst 44 px høye**.

## Merknader til utvikler og prosjektleder

- **Axe (lite):** kortet sier «axe i e2e», men `@axe-core/playwright` er ikke avhengighet i repoet. Testplanen bruker den egne kontrastsjekken og rolle-/overskriftsjekker (7.11) i stedet, så det ikke trengs en ny avhengighet (regel 9). Skal axe inn, må PR-en begrunne det.
- **Myk-slettet ordre (lite):** `orders` har `deleted_at` fra `baseColumns`; 3.1.16 og 3.4.3 forutsetter det. Rett testen hvis kolonnen heter noe annet.
- **Versjon:** 0.10.18 → 0.10.19 i `package.json` (regel 13).

## Godkjenning

Test-leder godkjenner ikke uten 3.5 (tilgang per rolle, admin), 3.6 (tenant-isolasjon for begge tjenestene, også egen test med samme adresse i A og B), 3.7 (logg) og 2 (paritet).
