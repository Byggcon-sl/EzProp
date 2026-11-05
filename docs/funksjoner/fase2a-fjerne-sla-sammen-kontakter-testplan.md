# Testplan: Fjerne og slå sammen like kontakter og firma

- **Oppgavekort:** `docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (testene låser at en fjernet eller sammenslått kontakt ikke gir ekstra treff i søket og kontaktvelgeren, og at flyten er 2 trykk for fjerning og 4–5 for sammenslåing på PC og iPad), reklamasjoner (ingen part eller ordre peker på en fjernet kontakt etter sammenslåing, og ingen kan endre data i en annen organisasjon, så rapport og varsler går til riktig mottaker) og KI først (ingen KI nå; testene viser at personopplysninger aldri havner i revisjonsloggen eller serverloggen).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet, som i kontaktregisteret: «Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`, organisasjonsnummer fra `nextFakeOrgNumber()`, notat «Testnotat». Fast tid: `TEST_NOW`.

Ingen fagregler eller TG-logikk, så ingen regeltester (tjenestereglene har testsaker under). Kontaktregisteret er bare på nett i fase 2a, så ingen e2e uten nett. Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke, og `tests/tenant-isolation-all-tables.test.ts` skal være grønn uten endring.

**Ett sett med tester** (erfaring fra PR #97 og #98): testskriver lager filene under. Utvikler lager ingen egne testfiler for det samme.

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, Omfang 1–3. Avvik føres i kortet før testene skrives om.

- Rettighet `contacts.manage` i `src/core/access/permissions.ts`: i `permissionsForRole("manager")`, ikke i `grantablePermissions`. Admin har alle.
- Fra `src/core/contacts/index.ts`:
  - `removeContact(actor, organizationId, contactId) → Promise<void>`
  - `removeFirm(actor, organizationId, firmId) → Promise<{ contactCount: number }>`
  - `mergeContacts(actor, organizationId, { keepId, removeId }) → Promise<{ partyCount: number; orderCount: number }>`
  - `mergeFirms(actor, organizationId, { keepId, removeId }) → Promise<{ contactCount: number; partyCount: number; orderCount: number }>`
  - `MergeSameRecordError` (melding «Velg to ulike kontakter.» / «Velg to ulike firma.»).
- Fremmed, ukjent, fjernet eller ugyldig id gir `AccessDeniedError`.
- Revisjonslogg: `contact.removed { contactId }`, `firm.removed { firmId, contactCount }`, `contact.merged { keepId, removeId, partyCount, orderCount }`, `firm.merged { keepId, removeId, contactCount, partyCount, orderCount }`.
- Server actions i `src/app/(ansatt)/kontakter/actions.ts` og `src/app/(ansatt)/firma/actions.ts` (navn velger utvikler, f.eks. `removeContactAction`, `mergeContactsAction`, `removeFirmAction`, `mergeFirmsAction`). Flagget for knappene heter `canManageContacts` og regnes ut på serveren, som `canEditOrders`.
- Sider: `/kontakter/[id]/sla-sammen` og `/firma/[id]/sla-sammen`.

## 1. Rettigheter, `src/core/access/permissions.test.ts` (utvidelse) — kort 4a

1. **`manager_has_contacts_manage`:** `effectivePermissions` for leder inneholder `contacts.manage`.
2. **`admin_always_has_contacts_manage`** (regel 11): admin har den, også med `access.inspectors_edit_all` av og på, og når admin ikke har andre roller.
3. **`inspector_lacks_contacts_manage`** (`it.each` over innstillingen av/på): takstmann har den ikke.
4. **`office_lacks_contacts_manage`:** kontor har den ikke.
5. **`contacts_manage_not_grantable`:** `grantPermission(…, "contacts.manage")` til takstmann gir ingen ny rettighet, og `isGrantablePermission("contacts.manage")` er `false`.
6. **`permission_list_snapshot`:** listen over rettigheter per rolle er oppdatert (eksisterende test følger med), så en ny rolle ikke får `contacts.manage` ved et uhell.

## 2. Kjernen, `src/core/contacts/remove-merge.test.ts` (ny)

### 2.1 Tenant-isolasjon — kort 4b

`expectTenantIsolation` én gang per tjeneste (fire kall). `seed` lager én kontakt eller ett firma per organisasjon (to per organisasjon ved sammenslåing) og returnerer id-en til raden som fjernes. `query` henter id-ene fra `seed` for egen organisasjon (via en variabel i testen), kjører tjenesten og returnerer `[{ id }]` for raden som ble fjernet. Viser at A aldri endrer B, og at bruker i A får `AccessDeniedError` mot organisasjon B.

1. **`removeContact_tenant_isolation`**
2. **`removeFirm_tenant_isolation`**
3. **`mergeContacts_tenant_isolation`**
4. **`mergeFirms_tenant_isolation`**

### 2.2 Tilgang per rolle — kort 4c

`it.each` over rollene og de fire tjenestene.

1. **`inspector_denied`** (innstillingen av og på): `AccessDeniedError`; kontakter, firma, parter, ordrer og `audit_log` er uendret.
2. **`office_denied`:** samme.
3. **`manager_allowed`** og **`admin_allowed`:** lykkes.
4. **`deleted_employee_denied`:** leder med slettet ansattkobling (`deleted_at`) får `AccessDeniedError`.
5. **`admin_never_locked_out`:** admin uten lederrolle lykkes på alle fire.

### 2.3 IDOR i egen organisasjon — kort 4d

Admin i A, id-er fra B. Egne saker for kontakt og firma. Etter hver sak: `deleted_at` og `updated_at` på kontakter og firma, `contact_id`/`firm_id` på parter og `ordered_by_contact_id`/`ordered_by_firm_id` på ordrer er uendret i **begge** organisasjoner (hjelpefunksjon `snapshotContactGraph()` sammenlignes før og etter).

1. **`mergeContacts_foreign_keepId`**
2. **`mergeContacts_foreign_removeId`**
3. **`mergeContacts_both_foreign`**
4. **`removeContact_foreign_id`**
5. **`mergeFirms_foreign_keepId`**
6. **`mergeFirms_foreign_removeId`**
7. **`mergeFirms_both_foreign`**
8. **`removeFirm_foreign_id`**

Alle gir `AccessDeniedError` og ingen rad i `audit_log`.

### 2.4 Feilsaker — kort 4e

1. **`unknown_uuid_denied`** (`it.each` over de fire): tilfeldig uuid gir `AccessDeniedError`, ingenting endret.
2. **`already_removed_removeId_denied`** og **`already_removed_keepId_denied`** (kontakt og firma, hver for seg): `AccessDeniedError`; partene og ordrene til den aktive er uendret.
3. **`removeContact_twice_denied`** og **`removeFirm_twice_denied`:** andre forsøk gir `AccessDeniedError`, og `deleted_at` er fortsatt tidspunktet fra første gang.
4. **`merge_same_record`:** `keepId === removeId` gir `MergeSameRecordError` med riktig melding, for kontakt og for firma; ingenting endret.
5. **`failed_attempts_not_audited`:** etter alle sakene i 2.3 og 2.4 finnes ingen `contact.*`- eller `firm.*`-rad i `audit_log`.
6. **`audit_failure_rolls_back`** (mønsteret i `contacts-transaction.test.ts`): feiler skrivingen til revisjonsloggen, er verken `deleted_at` satt eller koblinger flyttet (én test for `mergeContacts`, én for `mergeFirms`).

### 2.5 Fjerning — kort 4j og myk sletting

1. **`removeContact_sets_deleted_at_row_kept`:** raden finnes fortsatt med `deleted_at` og `updated_by` satt (myk sletting, ingen `delete`).
2. **`removeContact_keeps_links`:** parter og ordrer som peker på kontakten, har fortsatt `contact_id`, `firm_id` og friteksten.
3. **`removed_contact_hidden`:** finnes ikke i `listContacts`, søket (`search`) eller `searchContactsAction`; `getContact` gir ikke treff (siden gir 404, se 3.6).
4. **`removeFirm_sets_deleted_at_row_kept`:** samme for firma.
5. **`removeFirm_returns_active_contact_count`:** to aktive og én fjernet kontakt i firmaet gir `contactCount: 2`.
6. **`removeFirm_contacts_kept_without_firm`:** kontaktene er aktive, `firm_id` står (urørt), og `listContacts`/`getContact` viser dem uten firmanavn.
7. **`removed_firm_hidden`:** finnes ikke i firmasøket eller firmavelgeren.
8. **`removeFirm_frees_org_number`:** et nytt firma kan få samme organisasjonsnummer etterpå (som i dag ved myk sletting).

### 2.6 Sammenslåing av kontakter — kort 4f

1. **`moves_parties_and_orders`:** parter og ordrer på `removeId` peker på `keepId` etterpå; returverdien har riktige `partyCount` og `orderCount`.
2. **`firm_follows_kept_contact`:** fjernet kontakt i firma X, beholdt i firma Y: flyttede rader får `firm_id`/`ordered_by_firm_id` = Y.
3. **`kept_without_firm_gives_null`** og **`kept_with_removed_firm_gives_null`** (`it.each`): flyttede rader får `null`.
4. **`moves_soft_deleted_parties`:** myk-slettet part som peker på `removeId`, flyttes også (og er fortsatt myk-slettet).
5. **`free_text_unchanged`:** navn, firma, e-post og telefon i friteksten på parter og ordrer er uendret.
6. **`removed_soft_deleted_kept_unchanged`:** `removeId` har `deleted_at`; `keepId` har samme `updated_at`, navn, e-post, telefon, notat og firma som før.
7. **`other_rows_untouched`:** parter og ordrer som peker på en tredje kontakt i samme organisasjon, og rader i organisasjon B, er uendret.
8. **`no_row_points_to_removed`:** etterpå finnes ingen rad i `assignment_parties` eller `orders` med `removeId`.

### 2.7 Sammenslåing av firma — kort 4g

1. **`moves_contacts_parties_orders`:** `contacts.firm_id`, `assignment_parties.firm_id` og `orders.ordered_by_firm_id` flyttes; returverdien har riktige tall.
2. **`moves_soft_deleted_contacts`:** myk-slettet kontakt i firmaet som fjernes, flyttes også.
3. **`kept_firm_unchanged`:** navn, organisasjonsnummer og `updated_at` på firmaet som beholdes er uendret.
4. **`removed_firm_soft_deleted`:** `removeId` har `deleted_at`, raden finnes.
5. **`org_number_reusable`:** etterpå kan et nytt firma få organisasjonsnummeret til det fjernede.
6. **`contact_link_still_consistent`:** en part koblet til en kontakt i det fjernede firmaet har etterpå `contact_id` uendret og `firm_id` = firmaet som beholdes.
7. **`no_row_points_to_removed_firm`:** ingen rad i `contacts`, `assignment_parties` eller `orders` har `removeId`.

### 2.8 Revisjonslogg uten personopplysninger — kort 4i

1. **`audit_codes_and_actor`** (`it.each` over de fire): riktig hendelseskode, `actor_user_id` og `organization_id`.
2. **`audit_counts_correct`:** `partyCount`, `orderCount` og `contactCount` stemmer med det som faktisk ble flyttet (også myk-slettede rader).
3. **`audit_metadata_exact_keys`:** nøklene i `metadata` er nøyaktig de i signaturavtalen.
4. **`audit_contains_no_pii`:** `JSON.stringify` av hele `metadata` for alle fire inneholder ikke fornavn, etternavn, firmanavn, e-post, telefon, notat eller organisasjonsnummer.

## 3. Samtidighet, `src/core/contacts/remove-merge-concurrency.test.ts` (ny) — kort 4h

Mønsteret i `contacts-transaction.test.ts` (to tilkoblinger, `Promise.allSettled`).

1. **`merge_contacts_A_to_B_and_B_to_A`:** nøyaktig én lykkes, den andre får `AccessDeniedError`; nøyaktig én av kontaktene er fjernet; ingen part eller ordre peker på en fjernet kontakt; én `contact.merged` i `audit_log`.
2. **`merge_firms_A_to_B_and_B_to_A`:** samme for firma (også `contacts.firm_id`).
3. **`remove_and_merge_same_contact`:** `removeContact(B)` og `mergeContacts(keep A, remove B)` samtidig: ingen rad peker på en fjernet kontakt etterpå, og ingen unntak annet enn `AccessDeniedError`.

## 4. Handlinger og sider — kort 4k

Filer: `src/app/(ansatt)/kontakter/actions.test.ts` og `src/app/(ansatt)/firma/actions.test.ts` (utvidelse), og en sidetest per side der mønsteret finnes fra før.

1. **`invalid_id_no_core_call`** (`it.each` over de fire handlingene, også `keepId` og `removeId` hver for seg): `"abc"` og `""` gir «Kontakten finnes ikke.» / «Firmaet finnes ikke.», og kjernen kalles ikke (spion).
2. **`same_record_message`:** `MergeSameRecordError` blir meldingen fra kortet, ikke 500.
3. **`access_denied_message`:** `AccessDeniedError` fra kjernen gir «finnes ikke»-meldingen, ikke 500 og ikke detaljer.
4. **`logger_contract`:** ved feil får loggeren bare rute, bruker-id, id-er og feilnavn; aldri navn, e-post, telefon, notat eller organisasjonsnummer.
5. **`canManageContacts_per_role`** (`it.each`): `true` for leder og admin, `false` for takstmann (innstillingen av og på) og kontor.
6. **`merge_page_404_without_permission`:** `/kontakter/[id]/sla-sammen` og `/firma/[id]/sla-sammen` kaller `notFound()` for takstmann og kontor, og for fjernet eller fremmed id.
7. **`merge_search_excludes_self_and_removed`:** søket på sammenslåingssiden gir høyst 10 treff, aldri den åpne kontakten (eller firmaet), aldri fjernede, bare egen organisasjon.

## 5. E2E, `e2e/fase-2a-fjerne-sla-sammen-kontakter.spec.ts` (ny, kjøres i `pc` og `ipad`) — kort 4l

Testskriver lager `ensureManager`/`logInAsManager` i `e2e/helpers.ts` med oppdiktet e-post (f.eks. `leder@example.com`), samme mønster som `ensureInspector`/`logInAsInspector`. Data med `uniqueSuffix()`.

1. **`5.1 leder fjerner en kontakt`:** åpne `/kontakter/<id>`, «Fjern», bekreftelsen viser navnet og teksten fra kortet; «Avbryt» lar kontakten stå; «Fjern» igjen og bekreft. Tilbake på listen med «<navn> er fjernet.». Søket finner den ikke, og `/kontakter/<id>` gir 404.
2. **`5.2 leder fjerner et firma`:** bekreftelsen viser «1 kontakter er koblet …» (eller riktig tall); etter fjerning står kontakten uten firma på `/kontakter/<id>`.
3. **`5.3 leder slår sammen to kontakter`:** to like kontakter, den ene er part på et oppdrag. «Slå sammen med …», søk, velg, de to vises side om side med antall oppdrag; bytt «Behold denne» til den andre og tilbake; «Slå sammen». Siden for den som beholdes viser «Kontaktene er slått sammen.»; oppdraget lenker til den som beholdes; søket gir ett treff.
4. **`5.4 leder slår sammen to firma`:** kontakten i firmaet som fjernes, står etterpå i firmaet som beholdes.
5. **`5.5 takstmann ser ingen knapper`:** `logInAsInspector`; «Fjern» og «Slå sammen med …» finnes ikke på `/kontakter/<id>` og `/firma/<id>`; `/kontakter/<id>/sla-sammen` gir 404.
6. **`5.6 iPad-størrelse`** (i `ipad`-prosjektet, inne i 5.1 og 5.3): ingen vannrett rulling på bekreftelsen og sammenslåingssiden med to kort side om side; knappene er minst 44 px høye; flyten nås med Tab og Enter på PC.

## Krav til godkjenning

- Avvises hvis 1 (rettigheter), 2.1 (`expectTenantIsolation` for alle fire), 2.2 (tilgang per rolle) eller 2.3 (IDOR) mangler.
- Avvises hvis noen test bruker `delete` i oppsettet for å vise fjerning, eller hvis 2.5.1/2.5.4 (raden finnes) mangler.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Lager utvikleren en migrering for indeks, er den kjørt mot testdatabasen.
- `tests/tenant-tables.ts` er uendret, og `tenant-isolation-all-tables.test.ts` er grønn.
- Ingen KI: sjekk ved gjennomgangen at ingen KI-kall leser `contacts` eller `firms`.

| Akseptkriterium | Dekket av |
|---|---|
| Leder og admin fjerner kontakt og firma med bekreftelse; borte fra liste, søk og velger | 2.5.3, 2.5.7, 5.1, 5.2 |
| Sammenslåing flytter parter, ordrer og kontakter; den andre er myk-slettet | 2.6, 2.7, 5.3, 5.4 |
| Ingenting slettes permanent | 2.5.1, 2.5.4, 2.6.6, 2.7.4 |
| Takstmann og kontor: avslag, ingen knapper, 404 på sammenslåing | 2.2.1–2.2.2, 4.5, 4.6, 5.5 |
| Bare leder og admin har `contacts.manage` | 1.1–1.6 |
| Annen organisasjon får ikke tilgang; fremmede id-er endrer ingenting | 2.1, 2.3 |
| Revisjonslogg bare med id-er og antall; mislykkede forsøk logges ikke | 2.8, 2.4.5, 2.4.6 |
| A→B og B→A samtidig: nøyaktig én lykkes | 3.1, 3.2 |
| Virker på iPad-størrelse | 5.6 og hele 5 i `ipad` |
| Lint, typecheck, test og e2e grønne | testrapporten |
