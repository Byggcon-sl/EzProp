# Funksjon: Tilbud i stedet for ordre

- **Fase:** 2a (prioritert av Ståle 13.11.2026: «rett på oppdrag, tilbud ved behov»)
- **Modul:** kjerne (`src/core/orders`, `src/core/assignments`), skjermene under `src/app/(ansatt)/`
- **Status:** klar for bygging (rettet etter forhåndsvurdering runde 1: arkitekt, ux-ansvarlig, test-leder)
- **Branch:** `tilbud-i-stedet-for-ordre` (bygger på main, der «Nytt oppdrag», PR #209 og ADR 0011, er merget)
- **Støtter hovedmål:**
  - **De ansatte:** menyen viser det kontoret gjør 98–99 av 100 ganger (Nytt oppdrag, Arbeidskø). Tilbud ligger lenger ned, og et tilbud blir oppdrag med ett trykk uten avskrift.
  - **KI i bunnen:** tilbudet har de samme strukturerte bestillingsfeltene som oppdraget, med kilde (`source`) og en tydelig status. Kroken «e-post blir oppdragsforslag eller tilbud» (planpunktet «KI: e-post blir oppdragsforslag») kan da lage et tilbudsutkast uten ny datamodell.
  - **Færre reklamasjoner:** alt fylles inn fra tilbudet, så adresse, matrikkel og bestiller skrives ikke inn på nytt (færre skrivefeil). Åpne tilbud, og utløpte tilbud fra de siste 90 dagene, er med i dublettvarselet.

## Problem

Ståle 13.11.2026: «Det er svært sjelden vi oppretter ordre, men stort sett går vi rett på oppdrag. [...] Tilbud vil fungere som ett tilbud/lead, som deretter kan konverteres til oppdrag. Men det trenger ikke være "fremst" i løsningen.» I dag heter dette «Ordre», står høyt i menyen og har ingen utløpsdato. Kontoret får et begrep og et menypunkt de nesten aldri bruker, og en mulig jobb som aldri ble noe, blir stående som «Mottatt» for alltid.

## KI i bunnen

- **Ingen KI-kall i denne oppgaven.** Det er ingenting å foreslå her ennå: tilbudet lages for hånd, og «Gjør om til oppdrag» kopierer feltene uten å gjette.
- **Data som lagres for KI senere:** de samme bestillingsfeltene som oppdraget (ADR 0011), `source` (`manual` nå, `email` når KI lager utkast fra e-post), status, `validUntil` og avslagsgrunn. Hendelsene er de som finnes i dag: `order.received`, `order.rejected`, `order.updated`, og omgjøring som `assignment.created` med `orderId` (pluss revisjonslogg `order`/`convert`). **Ingen ny hendelseskode** (A326): andelen tilbud som blir oppdrag leses fra `assignment.created` og statusen.
- **Vern:** avslagsgrunnen og bestillingsfeltene er fritekst og står allerede i `NEVER_FIELDS` / sperren mot elleve sifre (A299). Ingen nye fritekstfelt (`validUntil` er en dato). Alt KI senere gjør her, går gjennom `src/core/ai`.

## Brukerhistorier

- Som **kontor** vil jeg **gå rett på «Nytt oppdrag»** og bare sjelden lage et tilbud, slik at menyen ikke viser noe jeg nesten aldri bruker øverst.
- Som **kontor** vil jeg **gjøre et tilbud om til oppdrag med ett trykk**, slik at jeg slipper å skrive adresse, matrikkel og bestiller på nytt.
- Som **kontor** vil jeg **avslå et tilbud med grunn**, slik at vi ser hvorfor jobben ikke ble noe.
- Som **leder** vil jeg **se at gamle tilbud er utløpt**, slik at listen over åpne tilbud bare viser det som fortsatt kan bli jobb.
- Som **takstmann** vil jeg **ikke se tilbud i arbeidskøen**, fordi de ikke er arbeid ennå.

## Omfang

**Med:**

1. **ADR 0012 «Tilbud»** (arkitekt): navn og datamodell.
   - Tabellen `orders`, modulen `src/core/orders`, hendelseskodene (`order.received`, `order.rejected`, `order.updated`), revisjonskodene (`entityType: "order"`, `action: "convert"` m.fl.) og statuskodene (`received`, `converted`, `rejected`) **beholdes**. «Tilbud» er navnet i grensesnittet. `received` vises som «Åpent», `rejected` som «Avslått», `converted` som «Gjort om til oppdrag». Ingen kode får ny betydning, så ingen arkivering trengs (regel 6).
   - **Ny kolonne `valid_until`:** `date("valid_until", { mode: "string" }).notNull()`, uten standardverdi i databasen. De 30 dagene står ett sted, som konstant i `src/core/orders`. Nye tilbud får i dag + 30 dager som forslag i skjemaet.
   - **«Utløpt» lagres ikke som status** (A320). Regelen står ett sted i kjernen: `isOfferExpired(status: OrderStatus, validUntil: string, today: string): boolean` (sant når status er `received` og `validUntil < today`), og et SQL-uttrykk med samme regel og paritetstest. Dagens dato kommer fra `todayInOslo()` (`src/shared/lib/dates.ts`) og sendes som parameter til SQL, aldri `now()` i databasen. Ingen bakgrunnsjobb. Et tilbud som får ny dato, er åpent igjen.
   - **Egen type for visningsstatus:** `OfferDisplayStatus = "open" | "expired" | "converted" | "rejected"`, brukt i filteret og etikettene. `expired` kan aldri skrives til `orders.status`, og CHECK-regelen er uendret.
   - **Dublettvilkåret for utløpte tilbud** (A325): et utløpt tilbud regnes som ikke åpent og gir bare treff innenfor 90-dagersvinduet, som lukkede oppdrag. Et åpent tilbud som ikke er utløpt, gir treff uansett alder, som i dag.
   - ADR-en sier at åpne ordre eldre enn 30 dager blir «Utløpt» rett etter migreringen. Det er ønsket: de er gamle og står i dag som «Mottatt» for alltid.
2. **Migrering 0035** som tåler ekte data (sjekk at nummeret er ledig rett før merge):
   - Legg til `valid_until` som valgfri.
   - Fyll alle rader, også mykt slettede, gjort om og avslåtte, med `(received_at at time zone 'Europe/Oslo')::date + 30`.
   - Sett `NOT NULL`.
   - Ingen rader slettes eller får ny status. `row_version`, `updated_at` og `deleted_at` røres ikke (det finnes ingen triggere). Ingen CHECK mellom dato og status.
   - Indeks `(organization_id, status, valid_until) where deleted_at is null` for standardlisten «Åpne» og tellingen.
3. **Skjermene omdøpt:** `/ordre` → `/tilbud`, `/ordre/ny` → `/tilbud/ny`, `/ordre/[id]` → `/tilbud/[id]`. Gamle adresser sender varig videre (308) med `redirects()` i Next-oppsettet, uten databaseoppslag. Da røper `/ordre/<id>` ikke om et tilbud finnes i en annen organisasjon, og sidene får ingen tilgangslogikk. All tekst på skjermene, feilmeldinger, historikk og hendelsestekster sier «tilbud», «Åpent», «Avslått», «Utløpt», «Gjort om til oppdrag». Lenker fra oppdraget, søket og dublettvarselet peker til `/tilbud/...`. Kortet med grunn-feltet heter «Avslå tilbudet».
4. **Menyen:** «Tilbud» flyttes under «Kontakter» og «Firma» (rett over «Statistikk»). «Nytt tilbud» er en knapp på tilbudslisten, ikke i menyen.
5. **Tilbudslisten:** filterknapper «Åpne» (standard: åpne og ikke utløpt), «Utløpt», «Avslått», «Gjort om til oppdrag» og «Alle». Knappene er minst 44 pt, ikke nedtrekksliste. Valgt filter står i adressen (`?status=…`), så «Tilbake» virker. «Gyldig til» vises i listen. Søket fra T2 virker sammen med filtrene.
6. **«Gjør om til oppdrag» med ett trykk** på tilbudssiden (også når tilbudet er utløpt):
   - Hovedknapp (56 pt) rett under tittel og status, over detaljkortet, ikke inne i endre-delen. På iPad trengs ingen rulling.
   - Kontoret er forhåndsvalgt (den ansattes kontor, A295). Har den ansatte ikke kontor (for eksempel admin uten kontor), vises kontorvalget ved knappen, og det virker. Admin stenges aldri ute.
   - Knappen er låst mens lagringen pågår (`SubmitButton`), og kjernen låser raden (`for update`, `OrderAlreadyHandledError`). To raske trykk gir nøyaktig ett oppdrag.
   - Etter lagring havner brukeren på det nye oppdraget med kvitteringen «Oppdraget er laget.». Oppdraget viser «Laget fra tilbud» med lenke til `/tilbud/[id]`.
   - `convertOrderToAssignment` kopierer bestillingsfeltene som før (ADR 0011 punkt 3), men **ikke** `valid_until`. `assignments` får ikke kolonnen.
7. **Avslå med grunn:** som `rejectOrder` i dag (påkrevd grunn). Knappen «Avslå tilbud» står under hovedknappen og ser sekundær ut. Kan gjøres på åpent og utløpt tilbud. Avslått eller gjort-om tilbud kan ikke avslås eller gjøres om (`OrderAlreadyHandledError`).
8. **Endre «Gyldig til»** på åpent eller utløpt tilbud, med historikk som de andre feltene:
   - Feltkoden er **`validUntil`** (camelCase, som `receivedAt` og `addressText`). Den blir fast ved merge.
   - `ORDER_EDITABLE_FIELDS` i `src/core/orders/codes.ts` blir en egen liste: `[...BOOKING_EDITABLE_FIELDS, "validUntil"]`. `validUntil` legges aldri i `src/core/assignments/booking/codes.ts`, så `updateAssignmentBooking` godtar ikke feltet.
   - `readBookingHistory` (`src/core/assignments/booking/history.ts`) tar listen over tillatte feltkoder som parameter, så datoendringer vises under «Endringer» på tilbudet. Importretningen fra ADR 0011 punkt 9 holdes: `orders` importerer fra `booking`, aldri motsatt.
   - Endring av `validUntil` på et gjort-om eller avslått tilbud avvises med meldingen «Gyldig til kan bare endres på åpne og utløpte tilbud.». De andre feltene kan fortsatt endres i alle statuser (T1, A327).
   - **Gyldige datoer** (A328), både for nytt tilbud og endring: en ekte dato (`ÅÅÅÅ-MM-DD`), ikke før dagens dato og høyst 365 dager fram. Ved endring sjekkes grensene bare når datoen faktisk endres, så et utløpt tilbud kan få andre felt rettet uten ny dato. Feilmeldinger: «Gyldig til kan ikke være før i dag.» og «Gyldig til kan være høyst ett år fram.»
9. **Dublettvarselet:** `src/core/assignments/booking/duplicate-sql.ts` får `today` som parameter og sammenligner `valid_until` selv (importerer ikke utløpsregelen fra `src/core/orders`). Tilbud med `received` og `valid_until >= today` gir treff uansett alder; utløpte tilbud bare innenfor 90-dagersvinduet (A325). Mykt slettede tilbud gir aldri treff.
10. **Tilbud teller ikke i arbeidskøen:** arbeidskøen leser bare `assignments`. En test låser det (et åpent eller utløpt tilbud gir verken rad eller telling).
11. **Uten nett:** tilbud er kontorarbeid på nett og påvirker ikke befaringen uten nett. Ved nettfeil kommer «Ingen nett. Prøv igjen.», og det som er skrevet i skjemaet (Nytt tilbud, avslagsgrunn, endring) står igjen, som i dag.
12. **Små funn i samme område** (tas med fordi skjermene uansett skrives om), hver med egen test: T-0031 (listen viser ikke at oppdraget er kansellert), T-0075 (teksten om bestiller på oppdraget stemmer ikke) og T-0089-delen som gjelder «Lagret.» på endre-skjemaet. Settes til «rettet» med PR-nummer.
13. **Direkte innsettinger får `valid_until`:** `tests/factories.ts`, `src/core/orders/history.test.ts`, `src/core/orders/possible-duplicates.test.ts`, seed og testdata. `src/db/orders-schema.test.ts` oppdateres.
14. **Testdataene** (`pnpm db:seed:testdata`): et par oppdiktede tilbud med ulik status, også ett utløpt. Datoene regnes fra dagens dato, så det utløpte alltid er utløpt.
15. **Docs:** ADR 0012; `docs/05-domenemodell.md` avsnitt 8 (`order` = tilbud i grensesnittet, `validUntil`, `OfferDisplayStatus`) og 4.3 (utløpsregelen og det nye dublettvilkåret); `docs/02-roller-og-tilgang.md` hvis teksten nevner ordre; planen og tilstandsfilen.

**Ikke med (bevisst utelatt):**

- Pris, prisliste, tilbuds-PDF og sending til kunde (planpunktet «Tilbud med pris», fase 3b). `valid_until` lages nå og brukes der.
- Faste koder for avslagsgrunn. Grunnen er fritekst som i dag (A323). Forslag 85 i `docs/09-apne-sporsmal.md`.
- Omdøping av tabellen, modulen, kolonner eller hendelseskoder i koden (dyrt og risikabelt mot ekte data, ingen gevinst for de ansatte).
- Ny hendelseskode `order.converted` (A326).
- Bakgrunnsjobb eller varsel når et tilbud går ut på dato.
- Knappen «Forleng 30 dager» på utløpte tilbud (forslag 86) og lenken «Lag tilbud i stedet» fra «Nytt oppdrag» (forslag 87). Bygges ikke uten Ståles ja.
- KI som lager tilbud fra e-post (eget planpunkt).
- Bestillingsskjema for meglere (fase 3b).

## Tilgang

Som for ordre i dag; ingen nye rettigheter.

| Rolle | Se | Endre (lage, endre, gjøre om, avslå) |
|---|---|---|
| takstmann | ja (alle i organisasjonen) | ja (`assignment.edit`) |
| kontor | ja | ja (`assignment.edit`) |
| leder | ja | ja |
| admin | ja | ja (stenges aldri ute, også uten kontor) |

Alle spørringer filtrerer på `grant.organizationId`. Annen organisasjon får verken liste (hvert filter), side, endring av `validUntil`, omgjøring eller avslag (`expectTenantIsolation` for hver). Deaktivert ansatt og ansatt uten `assignment.edit` avvises. Gammel adresse `/ordre/<id>` for et tilbud i en annen organisasjon gir samme «ikke funnet» som i dag (videresendingen slår ikke opp i databasen).

**Myk sletting:** et mykt slettet tilbud vises ikke i noe filter (heller ikke «Utløpt» eller «Alle»), kan ikke gjøres om, avslås eller endres, og gir ikke treff i dublettvarselet.

## Data

- `orders.valid_until` (`date`, `NOT NULL` etter migrering 0035, uten standardverdi). Ingen ny tabell; `tests/tenant-tables.ts` er uendret.
- Statuskoder og CHECK uendret: `received`, `converted`, `rejected`. «Utløpt» er avledet (`OfferDisplayStatus`).
- Ny feltkode `validUntil`, bare i `ORDER_EDITABLE_FIELDS`.
- Ny indeks `(organization_id, status, valid_until) where deleted_at is null`.

## Skjermer

PC og iPad (samme skjermer). Bare kontorarbeid på nett.

Flyt: Meny › Tilbud › [Åpne] › trykk på tilbudet › tilbudssiden:
- [Gjør om til oppdrag] (hovedknapp øverst) › siden for det nye oppdraget
- [Avslå tilbud] (sekundær, under) › skriv grunn › [Avslå]
- [Endre] › Gyldig til › [Lagre]

- **Meny:** «Tilbud» under «Firma». Før: «Ordre» som punkt 3, 1 trykk. Etter: punkt 5, 1 trykk.
- **Tilbudslisten** (`/tilbud`): hovedhandling «Nytt tilbud». Filterknapper, standard «Åpne».
- **Nytt tilbud** (`/tilbud/ny`): samme felt som før + «Gyldig til» (forhåndsutfylt med i dag + 30).
- **Tilbudet** (`/tilbud/[id]`): statusmerke, og «Utløpt [dato]» når det er utløpt. «Gjør om til oppdrag» før: 1 trykk, men knappen står under detaljkortet og endre-delen, så på iPad må man rulle. Etter: 1 trykk uten rulling, og brukeren havner på oppdraget. Begge knappene virker også når tilbudet er utløpt.

## Regler

Utløpsregelen er ikke en fagregel, men står som ren funksjon med testsaker: åpent og `validUntil` i går → utløpt; i dag → ikke utløpt; avslått eller gjort om → aldri utløpt; dato rundt midnatt norsk tid, både vinter (UTC+1) og sommer (UTC+2). SQL-uttrykket har paritetstest mot de samme sakene.

## Testplan

**Enhet:** `isOfferExpired` (sakene over); etikettene Åpent, Avslått, Gjort om til oppdrag, Utløpt; Zod-skjemaet for `validUntil` (i går, i dag, i dag + 365, i dag + 366, ugyldig dato); `validUntil` finnes i `ORDER_EDITABLE_FIELDS` og ikke i `BOOKING_EDITABLE_FIELDS`; norsk etikett for `validUntil` i adminloggen; `NEVER_FIELDS` og sperren mot elleve sifre uendret.

**Integrasjon (testdatabasen):**
- Ny `migration-0035-tilbud.test.ts` etter mønster fra `migration-0034-booking.test.ts`: åpne, avviste, omgjorte og mykt slettede rader, og rader med `received_at` kl. 23:30 UTC (norsk dato er neste dag). Viser norsk dato + 30, `NOT NULL`, og uendret status, `row_version`, `updated_at` og `deleted_at`.
- Paritet mellom SQL-uttrykket og `isOfferExpired`.
- Listefiltrene og søket sammen med filtrene; myk sletting i alle filtre.
- Omgjøring av utløpt tilbud virker; av avslått gir `OrderAlreadyHandledError`; to samtidige omgjøringer gir ett oppdrag; `valid_until` kopieres ikke.
- Avslag uten grunn avvises; avslag av utløpt tilbud virker.
- Ny dato gjør tilbudet åpent igjen og står i historikken; endring av `validUntil` på avslått og omgjort tilbud avvises; andre felt kan endres der.
- Arbeidskøen: åpent og utløpt tilbud gir verken rad eller telling.
- Dublettvarselet: åpent tilbud (gammelt) gir treff; utløpt tilbud innenfor 90 dager gir treff; utløpt tilbud utenfor 90 dager gir ikke treff; mykt slettet gir ikke treff.
- Tilgang og `expectTenantIsolation` som under «Tilgang».

**E2e (PC og iPad):** menyen viser «Tilbud» under «Firma» og ingen synlig «ordre» (unntak «meglerens ordrenummer»); 308 for `/ordre`, `/ordre/ny`, `/ordre/<id>`; lag tilbud med forhåndsutfylt dato; gjør om med ett trykk og se bestillingsfeltene på oppdraget; avslå med grunn; utløpt tilbud ute av «Åpne», inne i «Utløpt»; filter i adressen og «Tilbake»; axe på `/tilbud` og `/tilbud/[id]`. `fase-2a-ordre.spec.ts`, `fase-2a-rette-ordre.spec.ts` og `fase-2a-sok-ordre-arbeidsko.spec.ts` gjøres om til tilbud.

## Akseptkriterier

- [ ] ADR 0012 vedtatt: navn i grensesnitt, koder og tabell beholdt, `valid_until`, utløp avledet med én klokke, `OfferDisplayStatus`, dublettvilkåret, ingen ny hendelseskode.
- [ ] Migrering 0035 kjører mot en database med ekte-lignende ordre (åpne, avviste, gjort om, mykt slettede), og ingen rader mister data, får ny status eller endret `row_version`/`updated_at`/`deleted_at`.
- [ ] Menyen viser «Tilbud» under «Firma», ikke «Ordre». Ingen synlig tekst sier «ordre» om dette (unntak: «meglerens ordrenummer»).
- [ ] `/ordre`, `/ordre/ny` og `/ordre/<id>` sender videre (308) til `/tilbud/...` uten databaseoppslag.
- [ ] «Gjør om til oppdrag» står øverst, er ett trykk med forhåndsvalgt kontor, fyller alle bestillingsfeltene, åpner oppdraget med «Oppdraget er laget.» og lenken «Laget fra tilbud».
- [ ] Uten kontor (admin) vises kontorvalget, og omgjøring virker.
- [ ] To raske trykk gir nøyaktig ett oppdrag.
- [ ] Avslå krever grunn; avslått tilbud kan ikke gjøres om.
- [ ] Åpent tilbud med passert `validUntil` vises som «Utløpt [dato]», er ute av standardlisten og kan få ny dato, gjøres om eller avslås.
- [ ] `validUntil` kan bare endres på åpne og utløpte tilbud, innenfor i dag til i dag + 365, og endringen står i historikken.
- [ ] Filtrene er knapper på minst 44 pt, og valgt filter står i adressen.
- [ ] Et åpent eller utløpt tilbud gir verken rad eller telling i arbeidskøen (test).
- [ ] Dublettvarselet: åpne tilbud uansett alder, utløpte bare innenfor 90 dager, slettede aldri.
- [ ] Mykt slettet tilbud vises ikke og kan ikke endres, gjøres om eller avslås.
- [ ] Bruker i annen organisasjon får ikke tilgang til liste, side, endring, omgjøring eller avslag (test med `expectTenantIsolation`).
- [ ] Nettfeil gir «Ingen nett. Prøv igjen.», og skrevet tekst står igjen.
- [ ] Virker på iPad-størrelse (e2e: lage tilbud, gjøre om med ett trykk, avslå) og består axe.
- [ ] Ingen KI-forslag her; vernet for fritekstfeltene er uendret (test i `NEVER_FIELDS` står).
- [ ] T-0031, T-0075 og «Lagret.»-delen av T-0089 rettet, hver med egen test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon økt (minor).

## Avgjort ved uenighet (prosjektlederen)

- **Dublett og utløpte tilbud:** ux-ansvarlig og test-leder ville ha med alle utløpte tilbud fordi status fortsatt er `received`; arkitekten ville bare ha dem med innenfor 90 dager. Valgt: arkitektens forslag (A325). Et tilbud som gikk ut for ett år siden, ville ellers varsle for alltid, og varsler som alltid kommer, blir oversett. Utløpte tilbud fra de siste 90 dagene, de som realistisk kan bli jobb igjen, er fortsatt med.
- **Hendelseskode:** test-leder åpnet for ny kode `order.converted`. Valgt: ingen ny kode (A326), fordi omgjøringen allerede logges som `assignment.created` med `orderId`, og det enkleste som virker holder.

## Åpne spørsmål

Avgjort av prosjektlederen i autonom modus: A318–A328 i `docs/09-apne-sporsmal.md`. Forslag til Ståle (bygges ikke): 85 faste koder for avslagsgrunn, 86 «Forleng 30 dager», 87 «Lag tilbud i stedet».
