# Testplan: Koble partene og bestilleren til kontakter og firma

- **Oppgavekort:** `docs/funksjoner/fase2a-koble-kontakter.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at et valgt treff fyller navn, firma, e-post og telefon, og at flyten virker med Tab og Enter på PC og iPad), reklamasjoner (koblingen kan ikke peke på en kontakt i en annen organisasjon eller en slettet kontakt, så rapporten går til riktig person) og KI først (koblingen er kroken for e-post-til-ordre; testene viser at kontaktdata aldri havner i hendelser, logg eller KI).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet, som i kontaktregisteret: «Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`, organisasjonsnummer fra `nextFakeOrgNumber()`. Fast tid: `TEST_NOW`.

Ingen fagregler eller TG-logikk, så ingen regeltester. Ingen del virker uten nett (kontoret legger inn parter og ordre på PC), så ingen e2e uten nett. Ingen nye tabeller, så `tests/tenant-tables.ts` endres ikke, og `tests/tenant-isolation-all-tables.test.ts` skal være grønn uten endring.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1–5. Avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- Kolonner: `assignment_parties.contact_id`, `assignment_parties.firm_id`, `orders.ordered_by_contact_id`, `orders.ordered_by_firm_id` (uuid, valgfrie). Drizzle-navn `contactId`, `firmId`, `orderedByContactId`, `orderedByFirmId`.
- `src/core/contacts`: `findContactForLink(tx, organizationId, contactId) → Promise<{ id: string; firmId: string | null } | null>` og `ContactNotFoundError` («Kontakten finnes ikke.»), begge eksportert fra `index.ts`.
- `partyInputSchema` får `contactId` (valgfri uuid; tom og manglende blir `null`). `orderInputSchema` får `orderedByContactId` (samme regler). Ugyldig uuid gir «Kontakten finnes ikke.».
- `addParty`, `updateParty`, `createOrder`: signaturen er uendret, feltet kommer i `input`.
- `getAssignment` (hver part) og `getOrder` returnerer `contactId`/`firmId` og `orderedByContactId`/`orderedByFirmId` (rene kolonner).
- `searchContactsAction(query: string)` i `src/app/(ansatt)/kontakter/actions.ts` → høyst 10 treff `{ id, name, firmName, email, phone }`.
- Fabrikker: `createAssignmentParty` får `contactId?` og `firmId?` i `PartyOverrides`. `createOrder` tar allerede alle kolonner.

## 1. Databasen, `src/core/assignments/assignment-contact-link-db.test.ts` (ny)

Direkte innsetting med `db.insert`, uten tjenestene. Forventet feil er fremmednøkkelbrudd (`23503`).

1. **`fk_rejects_foreign_contact_on_party`:** part i organisasjon A med `contact_id` fra B avvises.
2. **`fk_rejects_foreign_firm_on_party`:** part i A med `firm_id` fra B avvises.
3. **`fk_rejects_foreign_contact_on_order`:** ordre i A med `ordered_by_contact_id` fra B avvises.
4. **`fk_rejects_foreign_firm_on_order`:** ordre i A med `ordered_by_firm_id` fra B avvises.
5. **`fk_accepts_own_contact_and_firm`:** samme innsetting med id-er fra A lykkes (viser at 1–4 feiler på grunn av organisasjonen, ikke av noe annet).
6. **`migration_keeps_existing_rows_null`:** part og ordre laget uten de nye feltene har `null` i alle fire kolonnene.
7. **`no_check_requires_link`:** part og ordre med bare fritekst og alle fire kolonnene `null` kan lagres (ingen CHECK, A60).

## 2. `findContactForLink`, `src/core/contacts/link.test.ts` (ny)

1. **egen kontakt med firma:** gir `{ id, firmId }` med kontaktens firma.
2. **egen kontakt uten firma:** gir `{ id, firmId: null }`.
3. **slettet kontakt:** gir `null`.
4. **kontakt med slettet firma:** gir `{ id, firmId: null }`.
5. **ukjent uuid:** gir `null`.
6. **`expectTenantIsolation`:** `seed` lager én kontakt i A og én i B. `query` henter grant med `requireOrganizationAccess(actor, organizationId)` og kaller `findContactForLink(tx, grant.organizationId, id)` for alle seedede id-er i én transaksjon, og returnerer treffene som ikke er `null`. Viser at A aldri får B sin kontakt og omvendt, og at fremmed organisasjons-id gir `AccessDeniedError`.

## 3. Skjemaene (utvidelse av `src/core/assignments/schemas.test.ts` og `src/core/orders/schemas.test.ts`)

1. **`contactId` på parten:** gyldig uuid godtas; tom streng, bare mellomrom og manglende felt gir `null`; `"abc"` og `"1"` gir «Kontakten finnes ikke.».
2. **`orderedByContactId` på ordren:** de samme fire tilfellene.

## 4. Kjernen, partene (`src/core/assignments/assignment-contact-link.test.ts`, ny)

1. **`addParty_with_contact_sets_firm`** (`it.each`): kontakt med firma gir `contact_id` og kontaktens `firm_id`; kontakt uten firma gir `contact_id` og `firm_id = null`.
2. **`addParty_contact_with_deleted_firm_sets_firm_null`:** `contact_id` satt, `firm_id = null`.
3. **`addParty_foreign_contact_throws_ContactNotFoundError_and_no_row`** (IDOR): kontakt fra B gir `ContactNotFoundError`; ingen part, ingen hendelse og ingen revisjonsrad i A.
4. **`addParty_deleted_contact_throws_and_no_row`:** samme for slettet kontakt i egen organisasjon.
5. **`addParty_without_contact_free_text_only`:** uten `contactId` lagres bare friteksten, begge kolonnene `null`.
6. **`updateParty_sets_link`:** part uten kobling får kontakt; `contact_id` og `firm_id` settes, `fields` i revisjonsloggen har `contactId` og `firmId` med fra/til (id-er).
7. **`updateParty_foreign_contact_unchanged_row`** (IDOR): kontakt fra B gir `ContactNotFoundError`; raden er uendret, også `row_version` og `updated_at`; ingen hendelse.
8. **`updateParty_clear_link_sets_both_null`:** `contactId: ""` fjerner koblingen.
9. **`updateParty_omitted_contactId_sets_both_null`:** `contactId` mangler i `input`; begge blir `null`.
10. **`updateParty_same_link_no_change`:** samme kontakt og samme fritekst gir `changed: false` og ingen hendelse.
11. **`free_text_not_overwritten`:** `addParty` og `updateParty` med kontakt og fritekst som avviker fra kontakten lagrer friteksten slik den ble sendt.
12. **`getAssignment_returns_link`:** koblet part gir `contactId`/`firmId`; ukoblet part gir `null`.
13. **`removed_party_not_updatable`:** myk slettet part kan ikke kobles (`AccessDeniedError` som i dag), og raden har fortsatt `deleted_at`.

## 5. Kjernen, ordren (`src/core/orders/orders.test.ts`, utvidelse)

1. **`createOrder_with_contact`:** `ordered_by_contact_id` og kontaktens firma lagres; revisjonsloggen har `orderedByContactId` og `orderedByFirmId`.
2. **`createOrder_contact_without_firm`:** firma `null`.
3. **`createOrder_foreign_contact_throws_and_no_order`** (IDOR): `ContactNotFoundError`, ingen ordre, ingen hendelse, ingen revisjonsrad.
4. **`createOrder_deleted_contact_throws_and_no_order`.**
5. **`createOrder_without_contact`:** som før, begge kolonnene `null`.
6. **`getOrder_returns_link`:** koblet ordre gir id-ene, ukoblet gir `null`.

## 6. Tilgang per rolle (`assignment-contact-link.test.ts` og `orders.test.ts`)

`it.each` over rollene. Gjelder `addParty`, `updateParty` og `createOrder`, alle med `contactId`.

1. **takstmann, `access.inspectors_edit_all` av:** `AccessDeniedError`, ingen rad lagret eller endret.
2. **takstmann med innstillingen på, kontor, leder, admin:** lykkes.
3. **admin stenges aldri ute:** admin lykkes også når innstillingen er av.
4. **ansatt med slettet ansattkobling** (`deleted_at` satt): `AccessDeniedError`.
5. **ansatt i en annen organisasjon:** `AccessDeniedError` på oppdrag, part og ordre i A.

## 7. Logg og personvern (`assignment-contact-link.test.ts`)

1. **`audit_and_events_contain_no_pii`:** etter `addParty`, `updateParty`, `removeParty` og `createOrder` med kontakt: alle rader i revisjonsloggen og hendelsene for organisasjonen, serialisert med `JSON.stringify`, inneholder aldri kontaktens fornavn, etternavn, e-post eller telefon, eller partens fritekst. Id-ene står der.
2. **`party_events_shape_unchanged`:** `assignment.party_added` og `assignment.party_updated` har nøyaktig nøklene `partyId` og `role`.
3. **Transaksjon:** feiler revisjonsloggen ved `addParty` med kontakt, finnes ingen part (utvidelse av `assignment-team-parties-transaction.test.ts` med samme mønster).

## 8. Handlingene (`src/app/(ansatt)/oppdrag/[id]/actions.test.ts`, `src/app/(ansatt)/ordre/actions.test.ts`, `src/app/(ansatt)/kontakter/actions.test.ts`)

1. **`invalid_contactId_field_error_no_core_call`:** `contactId = "abc"` på legg til part, endre part og ny ordre gir feltfeilen «Kontakten finnes ikke.», og kjernen kalles ikke.
2. **`ContactNotFoundError_becomes_field_error`:** feilen fra kjernen vises ved feltet, ikke som 500.
3. **`search_under_2_chars_empty_no_call`:** `""`, `" "` og `"a"` gir tom liste, og `listContacts` kalles ikke.
4. **`search_returns_max_10_own_org_only`:** 12 kontakter i A som passer, og 1 i B som passer: 10 treff, alle fra A, med `id`, navn, firmanavn, e-post og telefon.
5. **`search_no_access_gives_no_hits`:** ansatt uten tilgang til organisasjonen og ansatt med slettet ansattkobling får ingen treff (ingen unntak ut av handlingen).
6. **`logger_never_gets_form_values_or_query`:** ved feil får loggeren bare rute, bruker-id, id-er og feilnavn; aldri søketeksten, navn, e-post eller telefon.

## 9. Parter uten kobling virker som før

1. Testene fra PR #87 (`assignment-team-parties.test.ts`, `assignment-team-parties-transaction.test.ts`, `e2e/fase-2a-oppdrag-team-parter.spec.ts`) og ordretestene går grønt **uten endring** i forventningene. Endringer der godtas bare for nye felt i oppsettet, ikke i det som sjekkes.
2. Partskortet uten kobling viser friteksten uten lenken «Kontakt i registeret» (dekkes i e2e, punkt 10, etter «Fjern kobling»).

## 10. E2E, `e2e/fase-2a-koble-kontakter.spec.ts` (ny, kjøres i `pc` og `ipad`)

**`10.1 kontakt fra registeret som part og bestiller`**, én sammenhengende test:

1. Admin logger inn. Lager firma og kontakt med `uniqueSuffix()` (via skjermen `/kontakter/ny` eller direkte i e2e-databasen).
2. Oppdrag åpnes (via ordre → gjør om, som 7.1). «Legg til part».
3. Søk på en tekst som ikke finnes: «Ingen kontakter passer …» vises, og lenken går til `/kontakter/ny`.
4. Søk på 2–3 bokstaver av kontakten. Treffet nås med Tab og velges med Enter.
5. Navn, firma, e-post og telefon er fylt ut; «Koblet til <navn>» vises.
6. Lagre. Partskortet viser lenken «Kontakt i registeret» til `/kontakter/<id>`.
7. Endre parten, «Fjern kobling», lagre. Lenken er borte, friteksten står.
8. `/ordre/ny`: velg samme kontakt i søket; «Bestilt av» er «Navn, Firma». Lagre.
9. `/ordre/<id>` lenker til `/kontakter/<id>`.
10. iPad: ingen vannrett rulling på oppdragssiden og `/ordre/ny` med trefflisten åpen; treffknappene er minst 44 px høye.

## Krav til godkjenning

- Alle akseptkriteriene i kortet er dekket av punktene over (tabell under).
- Avvises hvis testene for tilgang per rolle (6), IDOR (4.3, 4.7, 5.3) eller `expectTenantIsolation` for `findContactForLink` (2.6) mangler.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- Ingen KI: `grep` i PR-en etter KI-kall som leser `contacts`, `contact_id`, `firm_id` eller søkeresultatet (sjekk ved gjennomgangen, ingen test).

| Akseptkriterium | Dekket av |
|---|---|
| Valgt kontakt fyller feltene; lagres med `contact_id` og `firm_id` | 4.1, 4.6, 10.1 (4–6) |
| Ny ordre med bestiller fra registeret, lenke på ordresiden | 5.1, 5.6, 10.1 (8–9) |
| Fremmed kontakt kan ikke kobles (tjeneste og database) | 1.1–1.4, 4.3, 4.7, 5.3, 2.6 |
| Søket viser bare egen organisasjon | 8.4, 8.5, 2.6 |
| Ingen navn, e-post eller telefon i logg og hendelser | 7.1, 7.2, 8.6 |
| Parter uten kobling virker som før | 1.6, 1.7, 4.5, 5.5, 9, 10.1 (7) |
| Tilgang per rolle, admin alltid | 6.1–6.5 |
| Slettet firma og tom/manglende `contactId` | 2.4, 4.2, 4.8, 4.9 |
| Ingen kontaktdata til KI | sjekk ved gjennomgangen |
| iPad-størrelse | 10.1 i `ipad`, punkt 10 |
