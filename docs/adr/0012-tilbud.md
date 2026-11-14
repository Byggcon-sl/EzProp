# ADR 0012 – Tilbud: nytt navn i grensesnittet, samme tabell og koder, utløp regnes ut

Dato: 14.11.2026. Status: vedtatt av agentene i autonom modus (A318–A328 i `docs/09-apne-sporsmal.md`); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-tilbud.md`. Kilde: Ståle 13.11.2026: «Tilbud vil fungere som ett tilbud/lead, som deretter kan konverteres til oppdrag. Men det trenger ikke være "fremst" i løsningen.» Bygger på ADR 0011.

Støtter hovedmålene: **de ansatte** (kontoret møter ordet de selv bruker, og et tilbud blir oppdrag med ett trykk uten avskrift), **KI i bunnen** (tilbudet har de samme strukturerte feltene som oppdraget, med kilde, status og gyldighetsdato, så KI senere kan lage et tilbudsutkast fra en e-post uten ny datamodell) og **færre reklamasjoner** (adresse og matrikkel skrives én gang, og dublettvarselet ser også tilbud).

## Beslutninger

1. **«Tilbud» er navnet i grensesnittet. Koden beholder `order`.** Tabellen `orders`, kolonnene, modulen `src/core/orders`, tjenestene (`createOrder`, `updateOrder`, `rejectOrder`, `convertOrderToAssignment`), hendelseskodene (`order.received`, `order.rejected`, `order.updated`), revisjonskodene (`entityType: "order"`, handlingene `create`, `update`, `reject`, `convert`) og treff-typen `order` i dublettvarselet er de samme som før. Nye navn som bare gjelder tilbudet, heter `offer…`.
2. **Statuskodene er uendret:** `received`, `converted`, `rejected`, og CHECK-regelen `orders_status_check` er urørt. På skjermen vises `received` som «Åpent», `rejected` som «Avslått» og `converted` som «Gjort om til oppdrag». Ingen kode får ny betydning: en mottatt ordre og et åpent tilbud er samme sak (en mulig jobb som ikke er behandlet), og avvist og avslått er samme utfall. Derfor arkiveres ingen kode (regel 6).
3. **Ny kolonne `orders.valid_until`** («Gyldig til»): `date`, påkrevd, uten standardverdi i databasen. Det er siste dag tilbudet er åpent, som ren norsk dato. Forslaget for et nytt tilbud er i dag + 30 dager; tallet står ett sted, `OFFER_VALID_DAYS` i `src/core/orders/contract.ts`. Datoen kan være fra i dag til høyst 365 dager fram (`OFFER_VALID_UNTIL_MAX_DAYS`, A328).
4. **«Utløpt» lagres ikke som status** (A320). Regelen står ett sted i kjernen: `isOfferExpired(status, validUntil, today)` er sann når status er `received` og `validUntil < today`. Et SQL-uttrykk med samme regel brukes i listen, og en paritetstest kjører de samme sakene mot begge. Ingen bakgrunnsjobb. Et utløpt tilbud som får ny dato, er åpent igjen. Et utløpt tilbud kan gjøres om til oppdrag og avslås.
5. **Én klokke.** Dagens dato kommer fra `todayInOslo()` (`src/shared/lib/dates.ts`) og sendes som parameter, også til SQL. Aldri `now()` eller `current_date` i databasen, som kan stå i UTC.
6. **Egen type for visningsstatus:** `OfferDisplayStatus = "open" | "expired" | "converted" | "rejected"` (`src/core/orders/codes.ts`), brukt i filteret (`?status=`, pluss `all`) og etikettene. `expired` kan aldri skrives til `orders.status`.
7. **Migrering `0035_tilbud`:** legger til `valid_until` som valgfri, fyller alle rader (også mykt slettede, gjort om og avslåtte) med norsk dato for `received_at` + 30 dager, setter `NOT NULL` og lager indeksen `orders_organization_id_status_valid_until_idx` på `(organization_id, status, valid_until) where deleted_at is null`. Ingen rader slettes eller får ny status, og `row_version`, `updated_at` og `deleted_at` røres ikke. **Åpne ordre mottatt for mer enn 30 dager siden vises som «Utløpt» rett etter migreringen.** Det er ønsket: de er gamle og står i dag som «Mottatt» for alltid. De kan fortsatt gjøres om, avslås eller få ny dato.
8. **Ingen databaseregel mellom dato og status.** Datoen er påkrevd for alle rader, også gjort om og avslått, men betyr bare noe for `received`.
9. **Ny feltkode `validUntil`**, bare for tilbudet: `ORDER_EDITABLE_FIELDS` blir `[...BOOKING_EDITABLE_FIELDS, "validUntil"]`. Koden legges aldri i `src/core/assignments/booking/codes.ts`, så oppdraget godtar den ikke. `validUntil` kan bare endres når lagret status er `received`; ellers kastes `OfferValidUntilLockedError`. De andre feltene kan fortsatt endres i alle statuser (T1, A327).
10. **`valid_until` kopieres ikke til oppdraget.** `convertOrderToAssignment` kopierer bestillingsfeltene som i ADR 0011 punkt 3, og `assignments` får ikke kolonnen.
11. **Dublettvarselet** (A325): et tilbud med `received` og `valid_until >= today` gir treff uansett alder, som før. Et utløpt tilbud gir bare treff innenfor 90-dagersvinduet, som lukkede oppdrag. `duplicate-sql.ts` får `today` som parameter og sammenligner `valid_until` selv; importretningen fra ADR 0011 punkt 9 holdes (`orders` importerer fra `booking`, aldri motsatt). Derfor tar også `readBookingHistory` listen over tillatte feltkoder som parameter.
12. **Ingen ny hendelseskode** (A326). Omgjøringen logges som før: `assignment.created` med `orderId` og revisjonslogg `order`/`convert`.
13. **Tilbud er ikke i arbeidskøen.** Arbeidskøen leser bare `assignments`. En test låser det.
14. **Gamle adresser** (`/ordre`, `/ordre/ny`, `/ordre/<id>`) sender varig videre (308) til `/tilbud/...` med `redirects()` i Next-oppsettet, uten databaseoppslag og uten tilgangslogikk i sidene.
15. **Grensesnittet** står i `src/core/orders/contract.ts`: `IsOfferExpired`, `OfferDisplayStatusOf`, `OfferExpiredSql`, `OfferListFilterSql`, `OfferInput`, `ListOffers`, `CreateOffer`, `UpdateOffer`, `ConvertOfferToAssignment`, `RejectOffer`.

## Begrunnelse

- **Navnet er det de ansatte ser.** Gevinsten for kontoret ligger i menyen og tekstene. Nye navn på tabell, kolonner og koder gir dem ingenting.
- **Faste koder som beholdes, bevarer historien.** Hendelser, revisjonslogg og lenker fra oppdrag (`assignments.order_id`) peker på `order` i dag. Med samme koder er alt gammelt lesbart uten oversettelse, og ingen ekte data må skrives om.
- **Utløp som utregning kan ikke komme i utakt.** En lagret status `expired` trenger en jobb som går hver natt, og er feil fram til jobben har gått eller hvis den stopper. En dato sammenlignet med i dag er alltid riktig, og ny dato åpner tilbudet uten statusovergang.
- **Dato, ikke tidspunkt.** «Gyldig til 14.12» betyr ut den dagen i Norge. Ren dato og norsk «i dag» gir samme svar vinter og sommer.
- **Ingen standardverdi i databasen,** fordi databasen ikke skal ha egen klokke eller eget tall for 30 dager. Mangler datoen i en innsetting, feiler den tydelig.

## Det vi vet at dette koster

- Koden sier `order` der skjermen sier «Tilbud». Det står øverst i `src/core/orders/codes.ts`, `contract.ts` og i ordlisten, så nye utviklere finner det.
- `orders.status` alene sier ikke om et tilbud er åpent. All lesing som trenger «åpent», må bruke regelen (funksjonen eller SQL-uttrykket), aldri bare `status = 'received'`. Paritetstesten og filtertestene vokter det.
- Statistikk på «utløpt» må regnes med en dato, ikke telles fra en kolonne.
- Migreringen oppdaterer alle rader i `orders` og lager indeksen i samme transaksjon, med lås på tabellen mens den går. Tabellen er liten (ordre lages sjelden), så det tar under et sekund.

## Forkastet

- **Gi tabellen og modulen nytt navn (`offers`):** berører fremmednøkler, indekser, CHECK-navn, snapshot, alle spørringer og rundt femti filer, mot ekte data, uten gevinst for de ansatte. Hendelser og revisjonslogg ville fortsatt hatt `order`, så koden måtte kjent begge navnene.
- **Nye statuskoder (`open`, `declined`) og arkivere de gamle:** regel 6 krever arkivering bare når betydningen endres. Her er betydningen den samme, og gamle hendelser ville vist arkiverte koder.
- **`expired` som lagret status med nattjobb:** se begrunnelsen. Krever også en overgang tilbake når datoen endres, og en ny verdi i CHECK-regelen.
- **Ny tabell `offers` ved siden av `orders`:** to tabeller for samme ting, flytting av ekte data og en ny rad i tenant-testene.
- **`valid_until` som tidspunkt (`timestamptz`):** gir spørsmål om klokkeslett og tidssone som ingen ansatt har.
- **Valgfri `valid_until` (tom = utløper aldri):** da står tilbud åpne for alltid igjen, som er problemet oppgaven skal løse.
- **Standardverdi i databasen (`current_date + 30`):** to klokker og to steder for tallet 30.
- **Utfylling med dagens dato + 30 i migreringen:** alle gamle ordre ville sett nye ut i 30 dager, og svaret ville avhenge av når migreringen kjøres.
- **Ny hendelseskode `order.converted`:** omgjøringen logges allerede, og andelen tilbud som blir oppdrag kan leses fra `assignment.created` og statusen.

## Følger

- Migrering `0035_tilbud` (prøvd mot en database med åpne, avslåtte og mykt slettede rader, og mottak rundt midnatt norsk tid vinter og sommer). Nummeret sjekkes mot main rett før merge.
- Ingen ny tabell og ingen ny avhengighet. `tests/tenant-tables.ts` er uendret.
- Direkte innsettinger i `orders` må sette `valid_until`: `createOrder` (`src/core/orders/orders.ts`), `src/core/orders/history.test.ts`, `src/core/orders/possible-duplicates.test.ts`, `tests/factories.ts`, seed og testdata.
- Planpunktet «Tilbud med pris» (fase 3b) bruker `valid_until` og legger pris og sending oppå samme tabell.
- **Dyrt å endre:** punkt 1, 2, 3 og feltkoden `validUntil` (datamodell og faste koder). **Lett å endre:** 30 og 365 dager, dublettvilkåret, filtrene og grensesnittet.
