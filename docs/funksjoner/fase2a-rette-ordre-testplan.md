# Testplan: Endre en ordre etter at den er lagret

- **Oppgavekort:** `docs/funksjoner/fase2a-rette-ordre.md`
- **Grunnlag:** T1 i `docs/kartlegging/svar-fra-stale-2026-11-12.md`, beslutningene A55, A87 og A249–A253, spørsmål 78
- **Dato:** 12.11.2026 (test-leder, før bygging). Oppdatert 13.11.2026 etter runde 4 i kortet: firma-id fra skjemaet ignoreres, tom `receivedAt` beholder verdien, ingen lokal lagring av skjemaverdier, konflikt prøves i action og ren hjelper (ikke to faner i e2e), takstmann-knappen prøves i tilgangsmatrisen (ikke e2e), T-0031 med, versjon 0.10.5. Henvisningene «AK n» er nummeret på akseptkriteriet i kortet (1–26, ovenfra).
- **Støtter hovedmål:**
  - **De ansatte:** testene viser at en lagret ordre kan endres på stedet i alle statuser, på PC og iPad, uten at noe som er skrevet går tapt ved konflikt eller tapt nett.
  - **KI i bunnen:** testene låser at hver lagring gir én loggrad med feltkodene i fast rekkefølge (grunnlaget for treffprosent per felt for e-post-til-ordre senere), og at endringen ikke kaller KI.
  - **Færre reklamasjoner:** testene viser at det alltid står hvem som endret hva og når, at oppdraget ikke endres stille, og at ingen annen organisasjon kan lese eller endre ordren.

Alle Vitest-tester mot databasen bruker `TEST_DATABASE_URL` og `resetDatabase` i `beforeEach`. Testdata er oppdiktet (for eksempel «Testveien 12, 8000 Bodø» → «Testveien 14, 8000 Bodø», «Kari Testesen», e-post på `example.com`). Fast tid med `vi.useFakeTimers({ toFake: ["Date"] })` og `vi.setSystemTime(TEST_NOW)` der tidspunkt sjekkes.

Ingen fagregler og ingen TG. «Regeltestene» er tabellene med testsaker (`it.each`): feltlisten, rettighetsmatrisen, valideringen og visningen av verdier.

## 0. Avtale om signaturer (utvikler og testskriver)

Fra kortet. Avvik føres i kortet.

- `updateOrder(actor, organizationId, orderId, input, expectedRowVersion)` og `listOrderHistory(actor, organizationId, orderId)` eksporteres fra `@/core/orders`, sammen med `OrderChangedError`, `orderFieldLabel` og den faste feltlisten (for eksempel `ORDER_EDITABLE_FIELDS`).
- `ContactNotFoundError` er den som allerede brukes ved oppretting (samme klasse).
- `getOrder` returnerer `rowVersion`.
- **`row_version` på ordre økes i dag ikke** av `rejectOrder` og `convertOrderToAssignment`. Det må legges inn (kortet punkt 1), og testes i 2.10.
- Feil i samme transaksjon prøves som i `src/core/orders/orders-transaction.test.ts`: `vi.mock("@/core/audit", …)` med `mockRejectedValueOnce`, i den samme filen (ikke ny mock i `orders.test.ts`).
- Testene for ordreendring står i en egen fil, `src/core/orders/update-order.test.ts`, så 4.6 i `orders.test.ts` står uendret (kortet, «Ikke med»).
- Prosjektet har ingen komponenttester (Vitest kjører bare `*.test.ts` uten DOM). Derfor legges meldingen for feilkoden i skjemaet i en **ren hjelper** (for eksempel `orderFormError(code)` → `{ message, reload: boolean }`) i en `.ts`-fil ved skjemaet, så den kan prøves uten DOM (avsnitt 10).

## 1. Feltlisten og etikettene, `src/core/orders/codes.test.ts` (utvides, ren, regeltest)

Fasiten skrives inn i testen, ikke importert fra koden (regel 6).

1. **feltlisten er fast:** listen er nøyaktig `receivedAt, externalRef, orderedByText, orderedByContactId, orderedByFirmId, addressText, gnr, bnr, snr, housingAssociationName, sellerDeclarationReceived`, i denne rekkefølgen.
2. **`orderFieldLabel` har etikett for hver kode** (`it.each` over hele listen): ikke tom, norsk tekst, ikke lik koden.
3. **ukjent kode** gir koden tilbake eller en nøytral tekst, aldri unntak.
4. **ordet «rett»/«rettet»** finnes ikke i noen etikett (ordet er reservert for rapportversjon 2).

## 2. `updateOrder`, `src/core/orders/update-order.test.ts` (ny, mot databasen)

**Vellykket endring (AK 1)**
1. `it.each` over statusene `received`, `converted` (med `assignmentId`), `rejected` (med grunn): endre `addressText` → ny verdi i returen og i `getOrder`; `row_version` økt med 1; `updated_at` satt.
2. **alle felt i listen** kan endres i én lagring; alle står i returen.
3. **tomme valgfrie felt:** `externalRef`, `gnr/bnr/snr`, `housingAssociationName` kan tømmes; `addressText` kan ikke (samme regel som oppretting).

**Bestilleren (AK 2 og 3)**
4. **koble** kontakt på ordre uten bestiller → `orderedByContactId` satt, `orderedByFirmId` = kontaktens firma.
5. **bytte** til kontakt i et annet firma → firmaet følger.
6. **bytte** til kontakt uten firma → `orderedByFirmId` tom.
7. **fjerne** kontakten → begge tomme; `orderedByText` står urørt hvis den ikke er sendt med endret.
8. **firma-id fra skjemaet ignoreres (AK 3):** `it.each` over (a) firma i en annen organisasjon, (b) et annet firma i egen organisasjon, (c) firma-id sendt uten kontakt. Resultat: `orderedByFirmId` er kontaktens firma (a, b) eller uendret/`null` (c), aldri id-en fra skjemaet; ingen feil. Når bare firma-id er sendt og ingenting annet er endret: ingen loggrad, `row_version` lik.

**Hva som ikke endres (AK 5)**
9. `it.each`: input med `status`, `rejectReason`, `assignmentId`, `source`, `requestedReportType`, `organizationId`, `deletedAt` → feltene er uendret i databasen (avvist av Zod eller ignorert, men aldri skrevet).
10. **`row_version` ved andre handlinger:** `rejectOrder` og `convertOrderToAssignment` øker `row_version`. Den gamle verdien gir deretter `OrderChangedError`.
11. **oppdraget er uendret** etter endring av gjort-om ordre: nummer, `property_id`, parter (`assignment_parties`), `row_version` og `updated_at` på oppdraget er like før og etter (sammenlign hele raden).

**Validering (AK 6, regeltest)**
12. `it.each` med de samme sakene som `schemas.test.ts` for `orderInputSchema` (tom adresse, `receivedAt` i fremtiden, `gnr` som ikke er tall, for lang tekst …) → samme norske meldinger som «Ny ordre»; ingen endring, ingen loggrad, `row_version` lik.
13. **gjenbruk, ikke kopi:** `updateOrder` og `createOrder` gir samme `issues`-meldinger for samme ugyldige input (sammenligning i testen).

**Samtidighet (AK 7, A253)**
14. **første endring etter oppretting** med `rowVersion` fra `getOrder` godtas.
15. **gammel `rowVersion`** etter en annen endring → `OrderChangedError` med teksten «Ordren er endret av en annen. Last siden på nytt.»; raden, loggen og hendelsene er uendret.
16. **gammel `rowVersion` etter avvisning** og **etter konvertering** → `OrderChangedError`.
17. **to samtidige lagringer** (`Promise.all`) med samme `rowVersion` og ulike verdier → nøyaktig én lykkes, den andre gir `OrderChangedError`; én loggrad; `row_version` økt med 1.

**Kontakt (AK 8)**
18. `it.each`: kontakt i en annen organisasjon, ukjent UUID, myk-slettet kontakt → `ContactNotFoundError`; ingen endring, ingen loggrad, ingen hendelse, `row_version` lik.

**Fremmed, ukjent og slettet ordre (AK 9)**
19. `it.each`: myk-slettet ordre, ukjent UUID, ikke-uuid (`"abc"`, `""`) → `AccessDeniedError`, ikke databasefeil; ingen loggrad.

**Lagring uten endring (AK 4 og 10)**
20. samme verdier som lagret (også dato med samme tidspunkt og tom tekst mot `null`) → ingen rad i `audit_log`, ingen hendelse, `row_version` og `updated_at` uendret.
20b. **tom `receivedAt` ved endring** (ordre lagret med `receivedAt` en annen dag enn `TEST_NOW`): lagring der `receivedAt` er tom og resten likt → `received_at` uendret, ingen loggrad, ingen hendelse, `row_version` lik. Samme med en annen endring (adresse) → `fields` er bare `["addressText"]`, ikke `receivedAt`.
20c. **oppretting er uendret:** `createOrder` med tom `receivedAt` gir fortsatt «nå» (`TEST_NOW`); viser at schemaet for oppretting ikke endret oppførsel.

**Revisjonsloggen (AK 11, A252)**
21. **én rad per lagring** med `entity_type = order`, `action = update`, `entity_id`, `actor_employee_id` = grant sin, `occurred_at` = `TEST_NOW`.
22. **`fields`** er en liste med bare de endrede feltkodene, i fast rekkefølge, også når input sendes i annen rekkefølge.
23. **`values`** har nøyaktig de samme nøklene som `fields`, hver med `{ from, to }`; tom verdi er `null`; dato som ISO-tekst; bestilleren som id, aldri navn (navnet på kontakten finnes ikke i `changes`).
24. **ingen andre nøkler** i `changes` enn `fields` og `values`; ingen nøkkel utenfor feltlisten.
25. **samme transaksjon** (i `orders-transaction.test.ts`): `recordAuditEvent` feiler én gang → ordren er uendret, `row_version` lik, ingen hendelse.

**Hendelsen (AK 12 og 13)**
26. `order.updated` registreres én gang per lagring med `data` nøyaktig `{ orderId, fields }`; ingen verdier.
27. `src/core/events/types.test.ts`: `order.updated` står i listen over typer.

**Ingen KI (AK 20)**
28. endring gir ingen rad i `ai_usage_log`, og `fakeAiProvider.complete` er ikke kalt (spion).

## 3. Ingen verdier på avveie (AK 12), `src/core/orders/update-order-no-leak.test.ts` (ny, mot databasen)

Én tabelltest per lag (tjenesten og action-en), feilgrenene som rader.

Unike markører i hvert verdi-felt (for eksempel `addressText = "MARKOR-ADR-91c2 1"`, `orderedByText = "MARKOR-NAVN-91c2"`, `externalRef`, `housingAssociationName`, `gnr = 9173`). `vi.spyOn` på alle nivåene i `logger` (`src/shared/lib/logger.ts`).

1. **vellykket lagring:** ingen markør i noe `logger`-kall eller i `events.data`.
2. **feilgrenene** (`it.each`): Zod-feil (markør i ugyldig verdi), `OrderChangedError`, `ContactNotFoundError`, databasefeil (tvunget med mock i transaksjonsfilen) → ingen markør i `logger`, i feilmeldingen (`error.message`) eller i hendelser.
3. **action-en** (`src/app/(ansatt)/ordre/actions.test.ts`): `updateOrderAction` i de samme grenene + `NO_ACCESS` → ingen markør i `logger`; returen har bare feilkode og meldinger per felt (ikke inndata ekko utover det skjemaet viser).
4. **markøren finnes** i `audit_log.changes.values` (viser at testen ikke er hul).

## 4. `listOrderHistory` (AK 16), `src/core/orders/order-history.test.ts` (ny, mot databasen)

1. **hendelser i rekkefølge:** opprettet, endret, avvist eller gjort om på samme ordre → nyeste først, én etikett per handling.
2. **form:** hver linje har tid, navn, handling og for `update` en liste `{ field, label, from, to }`; aldri rå `changes`.
3. **ukjente nøkler hoppes over:** rå loggrad (via `recordAuditEvent` eller direkte innsetting) med `values.secretField` og `fields` med ukjent kode → bare kjente koder vises; ingen unntak.
4. **ødelagt `values`** (tekst i stedet for objekt, `from` mangler) → linjen vises med feltetiketter uten verdier, ingen unntak.
5. **myk-slettet ansatt** vises med navnet.
6. **kontaktnavn:** bestiller-id slås opp; myk-slettet eller ukjent kontakt → «(fjernet kontakt)»; kontakt med samme id-format fra annen organisasjon gir «(fjernet kontakt)» (oppslaget bruker `grant.organizationId`).
7. **grense:** 205 loggrader → 200 linjer, de nyeste.
8. **bare denne ordren:** loggrader for en annen ordre i samme organisasjon og for andre `entity_type` med samme `entity_id` tas ikke med.
9. `it.each`: myk-slettet ordre, ukjent UUID, ikke-uuid → `AccessDeniedError`.

## 5. Visning av verdier og adminloggen (ren, regeltest)

1. **verdiformat** (`it.each`, hjelperen som lager «Adresse: X → Y»): `null`/tom → «(tom)», `true` → «Ja», `false` → «Nei», ISO-dato → norsk dato og klokkeslett, tall som tall.
2. **`formatAuditChanges`** (`src/app/(ansatt)/admin/labels.test.ts`): rad med `fields: ["addressText","orderedByContactId"]` og `values` med markører → «Endret: Adresse, Bestiller …»; ingen markør i teksten (AK 14).
3. **`auditFieldLabels`:** har den etikett for ordrefeltene, prøves hver kode mot fasiten i 1.1; ellers viser testen at ukjent kode gir feltkoden som reserve (kortet godtar det).

## 6. Tilgang per rolle (AK 17), `src/core/orders/update-order-access.test.ts` (ny, mot databasen)

`it.each` over variantene, for **både** `updateOrder` og `listOrderHistory`. Nekt gir `AccessDeniedError`, ingen endring, ingen loggrad, `row_version` lik.

| Variant | `listOrderHistory` | `updateOrder` |
|---|---|---|
| takstmann, `access.inspectors_edit_all` på (standard) | ja | ja |
| takstmann, innstillingen av | ja | nei |
| kontor | ja | ja |
| leder | ja | ja |
| admin, innstillingen av | ja | ja |
| bruker uten ansattrad | nei | nei |
| deaktivert ansatt | nei | nei |
| myk-slettet ansatt | nei | nei |

I tillegg:
1. **admin stenges aldri ute:** admin uten andre roller, innstillingen av, uten enkeltrettigheter → kan endre og lese historikk.
2. **kontor med `assignment.edit` fjernet** (hvis rettigheten kan trekkes per ansatt) → nekt; med enkeltrettigheten gitt til en rolle uten den (`grantPermission`) → lov. Viser at sjekken går på rettigheten via `requireOrganizationAccess`, ikke på roller.
3. **`canEditOrders`** i sidekonteksten følger samme svar som `updateOrder` for hver variant (bare visning, men samme kilde). Dette erstatter e2e-testen «takstmann ser ikke knappen» (runde 4).
4. **statisk:** `updateOrder` og `listOrderHistory` kaller `requireOrganizationAccess`; ingen rollesjekk i `src/app/(ansatt)/ordre/[id]/*` (grep i testen, som eksisterende mønster).

## 7. Tenant-isolasjon (AK 18), ett `expectTenantIsolation` per spørring

1. **`updateOrder`** (i `update-order.test.ts`): `seed` lager én ordre i A og én i B; `query` henter `rowVersion` med `getOrder`, endrer `externalRef` på hver egen ordre og returnerer radene. B sine rader kommer aldri tilbake for A.
2. **`listOrderHistory`** (i `order-history.test.ts`): `seed` lager ordre og loggrad i A og B; `query` returnerer historikklinjene (med `orderId`). Bare egne.
3. **direkte på tvers:** ansatt i A kaller `updateOrder` med A sin organisasjons-id og B sin ordre-id → `AccessDeniedError`; B sin ordre (hele raden, også `row_version`) og B sin `audit_log` er uendret. Samme for `listOrderHistory` → `AccessDeniedError`, ingen linjer.
4. **organisasjons-id fra B** med ansatt i A → `AccessDeniedError` (tilgangssjekken).
5. **kontakt fra B** på ordre i A → `ContactNotFoundError` (2.18).
6. **firma fra B** sendt som `orderedByFirmId` på ordre i A → ignoreres (2.8 a); B sitt firma blir aldri koblet.
7. **T-0031:** `listOrders` med kansellert oppdrag i B og A: A ser bare sine egne, og `assignmentCancelled` gjelder egen rad (koblingen til oppdraget bruker `grant.organizationId`). Eksisterende `expectTenantIsolation` for `listOrders` står og er grønn.
8. `tests/tenant-isolation-all-tables.test.ts` er grønn (ingen ny tabell; `audit_log` står alt i `tests/tenant-tables.ts`).

## 8. Myk sletting

1. Endring av myk-slettet ordre → `AccessDeniedError` (2.19).
2. Historikk for myk-slettet ordre → `AccessDeniedError` (4.9).
3. Myk-slettet kontakt kan ikke kobles (2.18), men vises som «(fjernet kontakt)» i gamle linjer (4.6).
4. Statisk: ingen `.delete(` på `orders` eller `auditLog` i `src/core/orders`.

## 9. Eksisterende tester står (AK 19)

1. `src/core/orders/orders.test.ts` 4.1–4.6 og 5 kjører uendret og er grønne. Testskriver endrer ikke filen, bortsett fra at `getOrder` nå også gir `rowVersion` (bare hvis en test sammenligner hele objektet).
2. `e2e/fase-2a-ordre.spec.ts` 8.1–8.8 er grønne.

## 10. Server action, `src/app/(ansatt)/ordre/actions.test.ts` (utvides)

1. ikke-uuid id → `NO_ACCESS`, tjenesten er ikke kalt.
2. `AccessDeniedError` → `NO_ACCESS`; `OrderChangedError` → egen kode med norsk melding; `ContactNotFoundError` og Zod-feil → meldinger per felt.
3. **konflikt beholder det som er skrevet (AK 22):** ved `OrderChangedError`, `ContactNotFoundError` og Zod-feil har tilstanden fra action-en alle innsendte verdier, slik at skjemaet fylles ut på nytt (samme mønster som «Ny ordre»).
4. **ren hjelper for meldingen (AK 22):** `orderFormError("ORDER_CHANGED")` (navnet avtales) gir «Ordren er endret av en annen. Last siden på nytt.» og `reload: true`; de andre kodene gir `reload: false`. Knappeteksten «Last siden på nytt» prøves i e2e 11.5.
5. tapt nett er ikke en action-sak (dekkes i e2e 11.6).
6. logglinjer uten skjemaverdier (avsnitt 3.3).
7. **ingen lokal lagring (AK 23), statisk:** skjemafilene for endring under `src/app/(ansatt)/ordre/[id]/` nevner ikke `localStorage`, `sessionStorage`, `indexedDB` eller `history.pushState`/`replaceState` (grep i testen).

## 11. e2e (AK 21), `e2e/fase-2a-rette-ordre.spec.ts` (ny, prosjektene `pc` og `ipad`)

Oppdiktede adresser. Hver test lager egne data, ingen avhengighet mellom testene.

1. **endre mottatt ordre:** ny ordre → «Endre ordren» → fokus på skjemaets overskrift → endre adresse → «Lagre» → «Endringene er lagret.» → ny adresse i ordrekortet → «Endringer» viser «Endret», navnet på den innloggede, dato og klokkeslett, og «Adresse: gammel → ny».
2. **endre gjort-om ordre:** gjør om → «Endre ordren» → linjen «Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.» vises → lagre → oppdragsnummeret og lenken til oppdraget er uendret; oppdragssiden viser fortsatt gammel adresse.
3. **én lagreknapp:** mens skjemaet er åpent, finnes ikke skjemaene for «Gjør om» og «Avvis».
4. **«Avbryt»** lukker skjemaet; ingenting endret; ingen ny linje i «Endringer».
5. **konflikt i én fane:** åpne skjemaet, skriv ny adresse; endre så ordren på serveren uten fanen (for eksempel «Avvis» i en egen `page` i samme kontekst, eller en hjelper som øker `row_version`) → «Lagre» → meldingen øverst, knappen «Last siden på nytt» finnes, og det som er skrevet står igjen. Ingen to-faner-redigering (runde 4). Blir oppsettet tungt, holder 10.3–10.4 for AK 22, og testen kan utgå med en linje i rapporten.
6. **uten nett:** `context.setOffline(true)` før «Lagre» → «Du er uten nett. Endringen er ikke lagret.»; feltene beholder verdiene; tilbake på nett → «Lagre» virker.
6b. **ingen lokal lagring (AK 23):** etter utfylling med en markør i adressen (uten lagring): markøren finnes ikke i `localStorage`, `sessionStorage`, navnene på IndexedDB-basene eller `page.url()`.
7. **bestiller:** koble kontakt med kontaktvelgeren og lagre → bestilleren vises; «Endringer» viser kontaktnavnet.
8. *(utgår, runde 4: dekket av 6.3 og rettighetsmatrisen.)*
9. **ingen «Rettet»:** teksten «Rettet» finnes ikke på ordresiden.

**iPad (prosjektet `ipad`, stående)**
10. «Endre ordren», «Lagre», «Avbryt» og «Last siden på nytt» er minst 44 px høye; «Lagre» minst 56 px.
11. ingen vannrett rulling på `/ordre/<id>` med skjemaet åpent og med «Endringer» med lange verdier.
12. «Lagre» og «Avbryt» står i skjemaet (ikke `position: fixed`), og er synlige etter rulling til bunnen.
13. «Endringer» kan leses: linjene bryter, ingen tekst kuttes (bredde innenfor visningsflaten).
14. skjemaet kan fylles ut og lagres med tastaturet alene (Tab og Enter).

**T-0031 (AK 24, prosjektet `pc`)**
15. gjør om en ordre, kanseller oppdraget med grunn, gå til `/ordre` → raden viser «kansellert» og oppdragsnummeret uten lenke, som ordresiden.

## 11b. T-0031 i tjenesten, `src/core/orders/orders.test.ts` (ny `describe`, 4.6 urørt)

1. `listOrders` gir `assignmentCancelled: true` for ordre med myk-slettet oppdrag, `false` for aktivt oppdrag og for ordre uten oppdrag.

## 12. Dokumentasjon (sjekkes ved gjennomgang, ikke med test)

1. A55 og A87 i `docs/09-apne-sporsmal.md` har linjen om at de er endret av T1 (12.11.2026); A249–A253 er ført; spørsmål 78 er ført.
2. Domenemodellen 4.3 og 4.12, ordlisten (`updateOrder`, `OrderChangedError`, `listOrderHistory`, `orderFieldLabel`, `order.updated`), planen krysset av, versjon 0.10.5 i `package.json` (AK 25).
3. Ingen modellnavn, ingen ekte adresser eller navn i testdata.

## Krav for godkjenning

`pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne (AK 26). Avsnitt 6 og 7 skal finnes og være grønne; mangler de, avvises leveransen. Mangler 2.8 (firma-id fra annen organisasjon) eller 20b (tom `receivedAt`), regnes det som alvorlig funn.
