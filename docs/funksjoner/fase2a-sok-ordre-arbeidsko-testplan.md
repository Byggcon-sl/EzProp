# Testplan: Søk i ordrelisten og i arbeidskøen (T2)

- **Oppgavekort:** `docs/funksjoner/fase2a-sok-ordre-arbeidsko.md`
- **Dato:** 13.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** de ansatte (testene låser at kontoret finner riktig ordre eller oppdrag med ett søk, uansett hvilket felt megleren oppgir, og at kontoret starter på «Alle»), reklamasjoner (matrikkel sammenlignes del for del, så «12/34» aldri gir 112/34; ingen treff fra andre organisasjoner) og KI i bunnen (testene viser at søketeksten aldri går til KI eller loggene).

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet (adresser som «Fjordgata 7», meglere som «Megler Test», gnr/bnr 12/34 og 999). Ingen ekte navn, adresser eller matrikler.

Ingen TG-regler. «Regeltestene» er søkeregelen: `parseCadastralQuery` og feltmatrisen (hvilke felt som gir treff), begge som tabeller med testsaker (`it.each`). Søket trenger nett (listene hentes fra serveren), så det er ingen e2e uten nett; testrapporten sier at befaringen og synken ikke berøres. E2e kjøres i prosjektene `pc` og `ipad`.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet. Avvik føres i kortet.

- `src/shared/lib/like-pattern.ts`: `SEARCH_QUERY_MAX_LENGTH = 100`, `likePattern(query) → string | null`.
- `src/core/assignments/search.ts`: `parseCadastralQuery(query) → { gnr, bnr, fnr?, snr? } | null`, `orderFieldsMatch(query) → SQL | undefined`, `assignmentFieldsMatch(organizationId, query) → SQL | undefined`.
- `src/core/orders`: `listOrders(actor, organizationId, { query? }) → { items, total }`, `ORDER_LIST_LIMIT = 50`.
- `src/core/assignments`: `defaultMineOnly(roles) → boolean`, `parseWorkQueueParams(params, { defaultMineOnly })`, `queueHref(...)` skriver alltid `mine=1` eller `mine=0`.
- Teksten «Viser 50 av N. Bruk søket for å finne flere.» og «Treff i: …»-lenkene lages helst i rene hjelpere (navn fritt, for eksempel `orderListSummary(shown, total)` og `otherTabsWithHits(counts, currentTab)`), slik at de kan testes uten nettleser.
- Fabrikkene finnes: `createOrder`, `createAssignment`, `createAssignmentParty`, `createProperty` (gir også `cadastral_units`), `auditRows`, `createAiUsageLog`. Ingen nye tabeller, så `tests/tenant-tables.ts` endres ikke.

## 1. Søkehjelperen, `src/shared/lib/like-pattern.test.ts` (ny, ren)

1. **tom tekst gir `null`:** `undefined`, `null`, `""`, `"   "`.
2. **trimmer:** `"  Fjord  "` → `"%Fjord%"`.
3. **kutter ved 100 tegn:** 150 tegn inn gir mønster med høyst 100 tegn søketekst (pluss `%` foran og bak); tekst som blir tom etter kutt og trim gir `null`.
4. **escaper** (`it.each`): `%` → `\%`, `_` → `\_`, `\` → `\\`, og blandet `"50%_\\"`. `\` escapes først, så `%` ikke blir dobbelt-escapet.
5. **vanlig tekst endres ikke** utover `%` foran og bak; store og små bokstaver beholdes (ILIKE tar seg av resten).
6. **`src/core/contacts/search.test.ts` og kontakt-/firmatestene er uendret grønne** etter byttet (ingen ny test, men test-leder sjekker at ingen eksisterende test er slettet eller svekket).

## 2. Matrikkelsøket, `src/core/assignments/search.test.ts` (ny, ren, regeltest)

Tabell med testsaker (`it.each`):

1. **tolkes:** `"12/34"` → `{ gnr: "12", bnr: "34" }`; `"12 / 34"` → samme; `"12/34/0/5"` → `{ gnr: "12", bnr: "34", fnr: "0", snr: "5" }`; `"12/34/5"` → `fnr: "5"`; `" 12/34 "` (mellomrom rundt) → samme som `"12/34"`.
2. **gir `null`, ingen krasj:** `"12/"`, `"/34"`, `"12"`, `"abc"`, `"12/abc"`, `"12/34/0/5/6"`, `"12//34"`, `"-12/34"`, `"12,5/34"`, `""`.
3. **ledende nuller:** `"012/34"` tolkes (dokumenter i testen om gnr blir `"012"` eller `"12"`; integrasjonstesten i 3.4 viser hva som gir treff).
4. **`orderFieldsMatch("")` og `assignmentFieldsMatch(org, "")` gir `undefined`** (intet filter).

## 3. Ordrelisten, `src/core/orders/order-search.test.ts` (ny, mot databasen)

### 3.1 Treff per felt (`it.each`, én rad per felt, ordre og «støy»-ordre i samme organisasjon)

For hvert felt: én ordre som treffer, én som ikke gjør. Søket er en del av teksten med andre store/små bokstaver enn i databasen (for eksempel `"FJORDG"` mot `"Fjordgata 7"`).

1. `orders.address_text`
2. `properties.address` (ordren konvertert, oppdraget har eiendom)
3. `assignments.number`
4. `orders.external_ref`
5. `orders.ordered_by_text`
6. `assignment_parties.name`
7. `assignment_parties.firm_name`
8. matrikkel fra ordren (`gnr`, `bnr`, `snr`)
9. matrikkel fra `cadastral_units`

### 3.2 Ingen doble rader

1. **to parter på samme oppdrag treffer** (`"Hansen"` i begge) → ordren én gang, `total = 1`.
2. **part og adresse treffer samtidig** → én rad.
3. **to matrikkelrader på samme eiendom treffer** → én rad.

### 3.3 Matrikkel del for del

1. `"12/34"` finner ordre med gnr 12/bnr 34, og oppdrag med `cadastral_units` 12/34/0/5; finner **ikke** 112/34, 12/345, 2/34 eller 12/3.
2. `"12/34/0/5"` finner 12/34/0/5 og 12/34 med tomt `fnr` og snr 5; finner ikke 12/34/0/6 eller 12/34/1/5.
3. `"12/34/0/5"` mot ordre (ingen `fnr`): gnr/bnr/snr like → treff; `fnr` på søket ignoreres for ordren.
4. tomt `fnr` (`""` og `null`) regnes som 0; mellomrom i lagrede verdier (`" 12"`) trimmes.
5. **tekstsøket går i tillegg:** `"12/34"` finner også en ordre med adressen «Gate 12/34» (delvis tekst i adressen).

### 3.4 Spesialtegn og felt som ikke søkes

1. `"%"`, `"_"`, `"\"` gir ikke alle ordre (0 treff når ingen felt har tegnet; treff bare der tegnet står bokstavelig).
2. **e-post og telefon til en part gir ikke treff** (parten har `email` og `phone` med oppdiktede verdier; søk på dem → 0).
3. **101 tegn** der de første 100 treffer → treff (kuttes, krasjer ikke).

### 3.5 Slettet og kansellert

1. slettet part (`deleted_at`) → ingen treff på navn eller firma.
2. slettet matrikkelrad → ingen treff på matrikkel.
3. slettet eiendom → ingen treff på eiendommens adresse eller matrikkel.
4. slettet ordre → ikke i listen, verken med eller uten søk.
5. **ordre med kansellert oppdrag:** står i listen uten søk, og søk på oppdragsnummer, partsnavn og eiendommens adresse finner den.

### 3.6 Grense, sortering og total

1. **51 ordre uten søk** → 50 rader, `total = 51`, nyeste `received_at` først; den eldste mangler.
2. **lik `received_at`** → `id desc` avgjør, og rekkefølgen er lik ved to kall.
3. **søk med 51 treff og 3 som ikke treffer** → 50 rader, `total = 51`.
4. **under grensen** → alle rader, `total` = antall rader.
5. **tom organisasjon og søk uten treff** → `{ items: [], total: 0 }`.
6. `ORDER_LIST_LIMIT === 50`.
7. **raden har `externalRef`** (ordrenummeret) og fortsatt fast feltliste uten sporingsfelt (utvid 4.4.5 i `orders.test.ts` hvis den låser feltene).
8. **meldingen** (ren hjelper): `(50, 51)` → «Viser 50 av 51. Bruk søket for å finne flere.»; `(12, 12)` → ingen melding.

### 3.7 Tilgang per rolle

1. **takstmann, kontor, leder og admin** (`it.each`) kan søke og får samme treff.
2. **admin uten andre roller** kan søke (admin stenges ikke ute).
3. **ansatt uten roller** og **bruker uten ansattrad** → `AccessDeniedError`.
4. **ansatt i B mot A sin id** → `AccessDeniedError`.

### 3.8 Tenant-isolasjon

1. **`expectTenantIsolation` for `listOrders` med søk** (`it.each` over feltene adresse, ordrenummer, `ordered_by_text`, partsnavn, firma, eiendommens adresse, matrikkel): `seed` legger **samme tekst i A og B** i feltet; `query = (actor, org) => listOrders(actor, org, { query }).then(r => r.items)`. Viser at A aldri får B sin ordre selv når teksten er lik.
2. **`total` lekker ikke:** A og B har like mange treff; A sin `total` = antall i A.
3. **kryss-kobling (laget direkte med fabrikk, forbi tjenesten):** en part i B med `assignment_id` til et oppdrag i A, en matrikkelrad i B med `property_id` til eiendommen i A, og en eiendom i B som et oppdrag i A peker på. Søk i A på B-tekstene → 0 treff. Viser at hver `EXISTS` har `organization_id`.
4. **organisasjonen kommer fra tilgangssjekken:** søket bruker `grant.organizationId` (kodegjennomgang; spørringen tar ikke organisasjon fra adressen eller skjemaet).

## 4. Arbeidskøen, `src/core/assignments/work-queue-search.test.ts` (ny, mot databasen)

Eksisterende 2.4 i `work-queue.test.ts` beholdes og skal fortsatt være grønn.

1. **treff per felt** (`it.each`, samme ni felt som 3.1, der ordrefeltene nås via `orders.id = assignments.order_id` og via `orders.assignment_id = assignments.id`).
2. **ingen doble kort** når to parter eller to matrikkelrader treffer.
3. **matrikkel del for del:** samme saker som 3.3.1.
4. **spesialtegn, e-post og telefon:** samme som 3.4.
5. **slettet part, matrikkel, eiendom** gir ingen treff; **kansellert oppdrag** finnes aldri, heller ikke ved søk på nummeret.
6. **tellingene per fane følger søket:** oppdrag «Fjordgata» i Bestilt (1) og Ferdig (2), annet i Under arbeid; søk «fjordgata» → Bestilt 1, Under arbeid 0, Ferdig 2.
7. **«Treff i andre faner»** (ren hjelper): tom fane + tellinger → lenker bare til faner med treff, i fanerekkefølgen, med antall; tom fane uten treff andre steder → ingen lenker.
8. **«Mine» og søk sammen:** `mineOnly = true` + søk gir bare egne treff, og tellingene følger.
9. **tilgang per rolle:** takstmann, kontor, leder og admin kan søke; admin uten andre roller kan søke; ansatt uten roller → `AccessDeniedError`.
10. **tenant-isolasjon:** `expectTenantIsolation` for arbeidskøen med søk, `it.each` over feltene som i 3.8.1 (samme tekst i A og B); kryss-koblingen fra 3.8.3; tellingene i A teller aldri B-rader.

## 5. Standardvalg og lenker, `src/core/assignments/work-queue-params.test.ts` (endres, ingenting slettes)

1. **`defaultMineOnly`** (`it.each`): `["inspector"]` → sann; `["office"]`, `["manager"]`, `["admin"]` → usann; `["inspector", "manager"]` → sann; `["admin", "inspector"]` → sann; `[]` → usann.
2. **`parseWorkQueueParams` uten `mine`:** følger `defaultMineOnly` (sann og usann). Testen «mine mangler gir Mine» (1.2.1) endres til å sende `{ defaultMineOnly: true }`, og får en søster med `false` → Alle.
3. **`mine=0` og `mine=1` overstyrer** begge standardene (fire saker).
4. **ugyldig `mine`** (`"ja"`, liste) → standarden, ingen krasj.
5. **rollene i adressen ignoreres:** `roles=inspector` eller `defaultMineOnly=1` i adressen endrer ingenting (1.2.6 utvides).
6. **`queueHref`** skriver alltid `mine=1` eller `mine=0`, tar med `q` (URL-kodet, også `%`, `&`, æøå) og fanen; tomt `q` gir ikke `q=` i adressen.
7. **kalleren bruker grant:** kodegjennomgang av siden: `defaultMineOnly(grant.roles)`, aldri rolle fra adressen.

## 6. Loggene, `src/core/orders/order-search.test.ts` (én test)

1. **søket lager ingen rader:** tell `audit_log`, `events` og `ai_usage_log` før og etter `listOrders` med søk og arbeidskøen med søk (tekst med oppdiktet navn og matrikkel) → uendret.
2. **ingen `console` med søketekst** (kodegjennomgang ved godkjenning: `q`/`query` sendes ikke til `console`, `logger`, hendelser, revisjonslogg eller `src/core/ai`).

## 7. E2e, `e2e/fase-2a-sok-ordre-arbeidsko.spec.ts` (ny, prosjektene `pc` og `ipad`)

Én felles spesifikasjon. Testdata legges inn via skjema eller seed med oppdiktede verdier.

1. **ordrelisten:** logg inn som kontor; søkefeltet har etikett «Søk på adresse, nummer, megler eller gnr/bnr» og har **ikke** fokus når siden åpnes; søk på ordrenummeret → raden viser ordrenummeret → trykk raden → ordresiden åpnes. «Tøm søk» viser hele listen igjen.
2. **ingen treff:** søk «finnesikke» → «Ingen ordre passer søket.»
3. **arbeidskøen:** kontoret starter på «Alle» (uten `mine` i adressen); søk på partsnavn → kortet vises.
4. **tom fane med treff andre steder:** stå i «Under arbeid», søk på adresse som bare finnes i Ferdig → «Ingen treff i denne fanen. Treff i: Ferdig (1).» → trykk lenken → fanen Ferdig med kortet, søket står fortsatt i feltet.
5. **«Mine» huskes:** kontoret velger «Mine», søker, bytter fane → «Mine» er fortsatt valgt (adressen har `mine=1`).
6. **iPad:** lenkene «Treff i: …» og «Tøm søk» er minst 44 px høye; ingen vannrett rulling med søkefeltet.

Endring i `e2e/fase-2a-arbeidsko.spec.ts` (4.1, ingen ny test):

7. **fokusringen:** etter lagret notat har kortet synlig ring (`getComputedStyle(...).outlineStyle !== "none"` og bredde over 0).
8. **hopplenken:** etter «Gå til hovedinnhold» har `#hovedinnhold` fokus og fortsatt ingen ring.

## 8. Godkjenning (test-leder, etter bygging)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjonen er økt.
- Hver ny spørring (`listOrders` med søk, arbeidskøen med søk) har `expectTenantIsolation` i sin testfil, med samme tekst i A og B. Mangler den, avvises PR-en.
- Tilgang per rolle er testet for begge listene, og admin uten andre roller kan søke.
- Ingen eksisterende test er slettet; 1.2.1 er endret, ikke fjernet.
- Kodegjennomgang: hver `EXISTS` har `organization_id`, `deleted_at is null` og kobling på id; søketeksten logges ikke.
- ADR 0010 finnes; nattløkkens punkt 3, 5 og 6 er merket ryddet; T-0029 er «rettet» med PR-nummeret; A254 og videre er ført.
- Testrapporten sier at søket trenger nett, og at befaringen og synken ikke berøres.
