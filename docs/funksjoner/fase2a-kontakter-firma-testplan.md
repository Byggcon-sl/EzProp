# Testplan: Kontakter og firma (meglere og meglerforetak)

- **Oppgavekort:** `docs/funksjoner/fase2a-kontakter-firma.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (ett register, ett firma per organisasjonsnummer; testene låser at dubletten stoppes med lenke til firmaet som finnes, og at søket finner megleren raskt, også på iPad), reklamasjoner (kilden står på hver kontakt; testene viser at kilden alltid er satt og vises, og at personopplysninger aldri havner i revisjonsloggen eller loggen) og KI først (kodene for kilde og firmatype er låste data som en senere KI-ordre kan bruke; testene viser at ingen kontaktdata går andre veier enn databasen).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: «Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`, notat «Vil ha rapport før kl. 12». «Fødselsnummer» er alltid `12345678901` (oppdiktet).

**Organisasjonsnumre i testene** (oppdiktet, starter med `000`, så de kan ikke finnes i Brønnøysund; kontrollert med modulus 11):

| nummer | gyldig | brukes til |
|---|---|---|
| `000000019` | ja | standard i fabrikken og firma A |
| `000000027` | ja | firma nummer to |
| `000000108` | ja | søk på nummer |
| `000000051` | ja | kontrollsiffer 1 (rest 10) |
| `000000018` | nei | feil kontrollsiffer |
| `000000060` | nei | kontrollsifferet blir 10 |

Ingen del virker uten nett (registeret brukes på kontoret og på PC med nett, som ordre), så det trengs ingen e2e uten nett. Ingen TG-regler; «regeltestene» er modulus 11 og skjemagrensene som testsaker (data i `it.each`).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1–5. Avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- `src/core/contacts/org-number.ts`: `isValidOrgNumber(value: string): boolean` (ren, fjerner mellomrom selv) og gjerne `normalizeOrgNumber(value)`; testene bruker bare `isValidOrgNumber` og skjemaet.
- `src/core/contacts/codes.ts`: `FIRM_TYPES = ["broker_firm", "insurer", "housing_association", "other"]`, `CONTACT_SOURCES = ["manual", "order"]` (`as const`), `firmTypeLabel(code)`, `contactSourceLabel(code)`.
- `src/core/contacts/schemas.ts`: `firmInputSchema` (`name`, `orgNumber`, `firmType`, `notes`) og `contactInputSchema` (`firstName`, `lastName`, `email`, `phone`, `firmId`, `notes`). `source` er ikke i skjemaet; tjenesten setter `manual`.
- `src/core/contacts/errors.ts`: `FirmDuplicateError` (med `firmId` og `firmName`), `FirmNotFoundError` («Firmaet finnes ikke.»).
- Tjenester fra `@/core/contacts`: `listFirms`, `getFirm`, `createFirm`, `updateFirm`, `listContacts`, `getContact`, `createContact`, `updateContact`, alle `(actor, organizationId, …)`.
- Fabrikker i `tests/factories.ts`: `createFirm(organizationId, { name?, orgNumber?, firmType?, notes?, deletedAt? })` og `createContact(organizationId, { firstName?, lastName?, email?, phone?, firmId?, notes?, source?, deletedAt? })`. Navnene kolliderer med tjenestene; importer tjenestene med alias i testene (`import * as contacts from "@/core/contacts"`).
- e2e: ny hjelper `fakeValidOrgNumber()` i `e2e/helpers.ts` (`000` + fem tilfeldige sifre + kontrollsiffer, nytt forsøk når sifferet blir 10). Den gamle `fakeOrgNumber()` er ikke gyldig etter modulus 11 og brukes ikke her.

## 1. Organisasjonsnummer, `src/core/contacts/org-number.test.ts` (ny, ren regeltest som data)

Én tabell med `it.each`, `{ input, valid, why }`:

1. `000000019`, `000000027`, `000000108`, `000000051` → gyldig.
2. `000000018` → ugyldig (feil kontrollsiffer).
3. `000000060` → ugyldig (kontrollsifferet blir 10).
4. `00000001` (8 sifre) og `0000000190` (10 sifre) → ugyldig.
5. `00000001A`, `ABCDEFGHI`, tom streng → ugyldig.
6. `000 000 019` og ` 000000019 ` → gyldig (mellomrom fjernes); `000-000-019` → ugyldig.
7. **fasit mot formelen:** testen har en egen liten referanseberegning (vektene 3, 2, 7, 6, 5, 4, 3, 2) og sjekker 50 tilfeldige 9-sifrede numre med fast frø mot `isValidOrgNumber`.

## 2. Faste koder, `src/core/contacts/codes.test.ts` (ny, ren enhetstest)

1. **`FIRM_TYPES` er låst:** nøyaktig de fire kodene i fast rekkefølge (regel 6, kommentar i testen).
2. **`CONTACT_SOURCES` er låst:** nøyaktig `manual` og `order`; `broker_system` finnes ikke ennå.
3. **etiketter:** `Meglerforetak`, `Forsikringsselskap`, `Sameie eller borettslag`, `Annet`; `Lagt inn for hånd`, `Fra en ordre`. Ukjent kode gir koden tilbake, aldri `undefined`.
4. **alle koder har etikett:** antall etiketter = antall koder (ny kode uten etikett gjør testen rød).
5. **kodene i databasen = kodene i koden:** CHECK-listene i migreringen leses fra databasen (`pg_get_constraintdef`) og sammenlignes med `FIRM_TYPES` og `CONTACT_SOURCES` (kan ligge i 4 i stedet).

## 3. Skjemaene, `src/core/contacts/schemas.test.ts` (ny, ren regeltest som data)

1. **grenser, ett `it.each` per grense** (n godtas, n+1 avvises):
   - 200: firmanavn.
   - 100: fornavn, etternavn (deler test).
   - 254: e-post.
   - 20: telefon.
   - 1000: notat på firma og kontakt (deler test).
2. **påkrevd:** tomt og bare mellomrom i firmanavn → «Skriv inn navnet.»; i fornavn → «Skriv inn fornavnet.».
3. **organisasjonsnummer:** tomt → `null`; `00000001` og `0000000190` → «Organisasjonsnummeret må ha 9 sifre.»; `000000018` → «Organisasjonsnummeret er ikke gyldig.»; `000 000 019` → lagres som `000000019`.
4. **firmatype:** mangler → `broker_firm`; hver av de fire kodene godtas; `bank` avvises.
5. **e-post:** `megler@example.com` ok; `ikke-epost` → «E-postadressen er ikke gyldig.».
6. **telefon:** `00000000` og `+47 000 00 000` ok; `00-00` og `abc` → «Telefonnummeret kan bare ha sifre, mellomrom og +.».
7. **fødselsnummer** (`it.each` over firmanavn, fornavn, etternavn og begge notatene): `12345678901` og `Notat 12345678901 her` → «Fødselsnummer skal ikke lagres her.»; 10 sifre godtas; telefonen er ikke berørt (`00000000` ok). Organisasjonsnummeret (9 sifre) utløser aldri meldingen.
8. **trimming og tomme felt:** verdiene trimmes; tom streng i etternavn, e-post, telefon, `firmId` og notat blir `null`.
9. **`firmId`:** ikke-uuid → valideringsfeil (eller `FirmNotFoundError` i tjenesten; testen følger det som bygges, men aldri databasefeil).
10. **`source` og `organizationId` i input ignoreres** (skjemaet tar dem ikke med).
11. **alle norske meldinger i kortet punkt 5 er brukt** i minst én test over («Firmaet finnes ikke.» dekkes i 5.3).

## 4. Databasen, `src/db/contacts-schema.test.ts` (ny, direkte innsetting)

1. **to aktive firma med samme nummer i samme organisasjon** → unik-feil.
2. **samme nummer i to organisasjoner** → lov.
3. **myk-slettet firma sperrer ikke:** slettet firma med `000000019` og nytt aktivt med samme nummer → lov.
4. **flere firma uten nummer** i samme organisasjon → lov.
5. **kontakt med firma fra en annen organisasjon** → avvist av den sammensatte fremmednøkkelen.
6. **ukjente koder:** `firm_type = "bank"` og `source = "import"` → avvist (CHECK).
7. **standardverdier:** firma uten `firm_type` får `broker_firm`; kontakt uten `source` får `manual`.
8. **indeksene finnes:** `firms_organization_id_org_number_idx` (unik, delvis), `(organization_id, name)` og `(organization_id, last_name, first_name)` (les fra `pg_indexes`).
9. **tenant-tabeller:** `firms` og `contacts` står i `tests/tenant-tables.ts` med radbyggerne og testfilene `src/core/contacts/firms.test.ts` og `src/core/contacts/contacts.test.ts`; `tests/tenant-isolation-all-tables.test.ts` er grønn med to tabeller mer enn før.
10. **migreringen er ren:** `pnpm db:generate` lager ingen ny fil, og nummeret er neste ledige (sjekkes i gjennomgangen, også mot `fase2a-utstedende-selskap`).

## 5. Kjernen, `src/core/contacts/firms.test.ts` og `src/core/contacts/contacts.test.ts` (nye, mot databasen)

### 5.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres med `access.inspectors_edit_all` **på** og **av**, for alle åtte tjenestene.

1. **lese** (`listFirms`, `getFirm`, `listContacts`, `getContact`): `inspector`, `office`, `manager`, `admin` lykkes i begge innstillingene.
2. **skrive** (`createFirm`, `updateFirm`, `createContact`, `updateContact`): på → alle fire roller lykkes. Av → `office`, `manager`, `admin` lykkes; `inspector` får `AccessDeniedError`, og antall rader i `firms`, `contacts` og `audit_log` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` kan alle fire skrivetjenestene.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller:** `AccessDeniedError` på alle åtte.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, innstillingen av, kan lese og skrive med alle åtte.

### 5.2 Tenant-isolasjon (regel 2; ni kall til `expectTenantIsolation`, minst ett per tjeneste)

1. **`listFirms`:** `seed` lager ett firma i A og B; `idOf = id`.
2. **`getFirm`:** `query` henter firmaet i `organizationId` og returnerer `[firma]`.
3. **`getFirm(...).contacts`:** `seed` lager firma med én kontakt i A og B; `query` returnerer `.contacts`.
4. **`createFirm`:** `query` lager et firma og returnerer `[rad]`, `idOf = organizationId` (mønsteret fra `createOrder`). Nummeret er det samme (`000000019`) i begge, så testen viser også at dublettsjekken er per organisasjon. Etterpå: B har nøyaktig ett firma.
5. **`updateFirm`:** `seed` lager ett firma i A og B; `query` endrer navnet til `Endret av ${actor.id}`. Etterpå: Bs firma har adminB sin id i navnet.
6. **`listContacts`:** `seed` lager én kontakt i A og B.
7. **`getContact`:** `query` returnerer `[kontakt]`.
8. **`createContact`** og **`updateContact`:** ett kall hver. `createContact` med `firmId` fra egen organisasjon. Etterpå: Bs kontakt er endret nøyaktig én gang, av B.

### 5.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id`:

1. **Bs firma-id** i `getFirm` og `updateFirm` → `AccessDeniedError`; Bs firma er uendret (navn, nummer, `updated_at`), ingen loggrad.
2. **Bs kontakt-id** i `getContact` og `updateContact` → `AccessDeniedError`; Bs kontakt er uendret.
3. **Bs `firmId`** i `createContact` → `FirmNotFoundError` («Firmaet finnes ikke.»), ingen kontakt; i `updateContact` på egen kontakt → `FirmNotFoundError`, `firm_id` uendret.
4. **`organizationId` og `source` i input ignoreres:** `createContact` med `organizationId: orgB.id` og `source: "order"` lagres i A med `source = "manual"`.
5. **tilfeldig uuid og `"ikke-en-id"`** som firma-id og kontakt-id → `AccessDeniedError`, aldri databasefeil.

### 5.4 Myk sletting

1. **slettet firma og slettet kontakt** (`deletedAt` satt): `get*` og `update*` → `AccessDeniedError`; raden er urørt.
2. **slettet firma som `firmId`** i `createContact` → `FirmNotFoundError`.
3. **listene og søket** viser ikke slettede firma eller kontakter; `getFirm(...).contacts` viser ikke slettede kontakter.
4. **kontakt i et slettet firma:** `getContact` gir ikke firmanavnet til det slettede firmaet (`firmName = null`), og `listContacts` viser ikke firmanavnet. (Avvik avgjøres i kortet hvis utvikler velger annet.)
5. **ingen tjeneste sletter permanent:** ingen `delete from firms|contacts` i `src/core/contacts` (sjekkes med `grep` i gjennomgangen).

### 5.5 Dubletter (D17)

1. **`createFirm` med nummer som finnes** → `FirmDuplicateError` med riktig `firmId` og `firmName`; antall firma uendret, ingen loggrad.
2. **`createFirm` med `000 000 019`** når `000000019` finnes → dublett (mellomrom fjernes før lagring).
3. **`updateFirm` til et nummer et annet firma har** → `FirmDuplicateError`; firmaet er uendret.
4. **`updateFirm` med sitt eget nummer** (bare navnet endres) → går gjennom.
5. **dublett mot slettet firma** finnes ikke: `createFirm` lykkes.
6. **dublett i en annen organisasjon** finnes ikke: `createFirm` lykkes (også dekket i 5.2.4).
7. **feilen avbryter transaksjonen ren:** etter `FirmDuplicateError` kan samme tjeneste kalles igjen med et nytt nummer og lykkes (ingen hengende transaksjon).
8. **ingen sperre mot like kontakter:** to kontakter med samme navn og e-post lagres begge.

### 5.6 Søk

1. **firma:** treffer på del av navn (uten hensyn til store og små bokstaver) og på del av nummeret (`000000108` med `0108`).
2. **kontakter:** treffer på fornavn, etternavn, e-post og firmanavn.
3. **`%` og `_` søker etter tegnet:** firma «Test_megling» og «Testxmegling»; søk `_` gir bare det første; søk `%` gir bare et navn med `%`.
4. **tomt søk og bare mellomrom** gir hele listen; søk over 100 tegn avvises eller kortes (testen følger det som bygges, aldri databasefeil).
5. **sortert på navn**, og **høyst 200 rader** (201 firma gir 200).
6. **søket filtrerer på organisasjonen:** søk som treffer et firma i B, gir tom liste i A.

### 5.7 Oppslag og faste felt

1. **`Object.keys`** på firma, kontakt, listeelementer og `getFirm(...).contacts` er faste lister; ingen `deletedAt`, `deletedBy`, `rowVersion`, `organizationId`, `createdBy`.
2. **`getContact`** har `source` og `firmName`; **`getFirm`** har kontaktene sortert på navn.
3. **`createContact`** lagrer alle feltene, `source = "manual"`, `organizationId = grant.organizationId`, `createdBy` = den ansatte.
4. **kilden er alltid satt:** hver kontakt fra tjenestene har `source` i `CONTACT_SOURCES` (akseptkriteriet).
5. **`updateContact` uten firma** (`firmId = null`) fjerner koblingen; `updated_at` endres.

### 5.8 Revisjonslogg

1. **én rad per skriving:** `createFirm`/`updateFirm` gir `firm` med `create`/`update`; `createContact`/`updateContact` gir `contact` med `create`/`update`; riktig `organizationId` og `entityId`.
2. **`changes`:** id-er, kodene (`firm_type`, `source`) og ved `update` navnene på feltene som ble endret (for eksempel `["notes"]`).
3. **ingen personopplysninger** (`it.each` over de fire skrivetjenestene): `JSON.stringify` av hele `audit_log`-raden inneholder ikke «Megler Test», «Testmegling AS», `000000019`, `megler@example.com`, `00000000` eller notatteksten.
4. **ingen rader i `events`** fra noen av tjenestene.
5. **ingen loggrad** ved avvist tilgang, valideringsfeil, `FirmNotFoundError` eller `FirmDuplicateError`.
6. **samme transaksjon** (egen fil `src/core/contacts/contacts-transaction.test.ts`, `vi.mock("@/core/audit")` som kaster én gang): `createFirm` kaster → ingen firma; `updateContact` kaster → kontakten er uendret.

## 6. Fabrikker, `tests/factories.test.ts` (utvides)

1. **`createFirm`** uten overstyring: «Testmegling AS», `broker_firm`, gyldig nummer etter modulus 11; to kall i samme organisasjon gir ikke unik-feil (fabrikken lager unike gyldige numre eller `null`, dokumentert).
2. **`createContact`** uten overstyring: «Megler Test», `source = "manual"`, `firmId = null`; overstyring (også `deletedAt` og `firmId`) brukes.
3. **`RESET_TABLES`** har `contacts` før `firms` (fremmednøkkelen), og testen som sammenligner med databasen er grønn.

## 7. Handlingene, `src/app/(ansatt)/kontakter/actions.test.ts` og `src/app/(ansatt)/firma/actions.test.ts` (nye, kjernen byttet ut som i `ordre/actions.test.ts`)

1. **`getEmployeeContext` gir `null`** (bruker uten ansattrad) → alle handlingene svarer `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** (firma-id, kontakt-id) → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` endrer ikke kallet.
4. **`AccessDeniedError`** → `NO_ACCESS`; **`ZodError`** → feil ved feltet med kortets tekster; **`FirmNotFoundError`** → «Firmaet finnes ikke.» ved firmafeltet; ukjent feil → `UNKNOWN_ERROR`.
5. **`FirmDuplicateError`** → «Et firma med dette organisasjonsnummeret finnes allerede: Testmegling AS.» og lenken `/firma/<id>` i svaret.
6. **«Ingen» i firmalisten** sendes som `firmId = null`.
7. **suksess** sender videre til `/kontakter/<id>` og `/firma/<id>`.
8. **loggkontrakt:** `JSON.stringify` av alle loggkall inneholder ikke navn, nummer, e-post, telefon eller notat, bare rute, bruker-id, id-er og feilnavn.

## 8. E2E, `e2e/fase-2a-kontakter-firma.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egne data med `uniqueSuffix()` og `fakeValidOrgNumber()` (databasen tømmes ikke).

1. **hele flyten** (akseptkriteriene): menyen «Firma» → «Nytt firma» → navn, nummer, type → «Lagre» → firmasiden → «Nytt firma» igjen med samme nummer (skrevet med mellomrom) → meldingen «Et firma med dette organisasjonsnummeret finnes allerede: …» → lenken åpner det første firmaet → menyen «Kontakter» → «Ny kontakt» med fornavn, etternavn, e-post, telefon, firmaet og notat → «Lagre» → siden viser «Kilde: Lagt inn for hånd» → listen, søk på etternavnet finner kontakten → åpne → endre notat → «Lagre» → nytt notat står → firmasiden viser kontakten med lenke.
2. **tomme lister og hjelpetekst:** søk på en tilfeldig tekst gir ingen rader; hjelpeteksten «Kort og saklig. Ikke skriv helseopplysninger eller fødselsnummer.» står ved notatet.
3. **feilmeldinger ved feltet, ingenting lagres:** tomt navn → «Skriv inn navnet.»; `000000018` → «Organisasjonsnummeret er ikke gyldig.»; tomt fornavn → «Skriv inn fornavnet.»; `abc` i telefon → telefonmeldingen; `12345678901` i notat → «Fødselsnummer skal ikke lagres her.».
4. **takstmann** (`logInAsInspector`, innstillingen på i seed) ser listen og kan åpne en kontakt. Takstmann med innstillingen av er for tungt i e2e; dekket av 5.1.2, 7.4 og `employee-context.test.ts` (`canEditOrders`), og i gjennomgangen sjekkes at sidene bare bruker `context.canEditOrders`.
5. **ukjent id** (tilfeldig uuid og `ikke-en-id`) på `/kontakter/<id>` og `/firma/<id>` → «Fant ikke siden» eller «Ingen tilgang», aldri 500.
6. **iPad-størrelse** (bare `ipad`, stående 834 × 1194): ingen vannrett rulling på `/kontakter`, `/kontakter/ny`, `/firma` og `/firma/<id>`; listene vises uten avkuttet tekst; knapper og felt minst 44 px høye; søkefeltet kan brukes med skjermtastatur (fokus og `type="search"`).

## 9. Personvern og KI (gjennomgang, ikke egen testfil)

1. **aldri til KI:** `src/core/contacts` importerer ingenting som sender data ut (ingen KI-modul finnes ennå; lint for modulgrenser og `grep` i gjennomgangen).
2. **loggeren** fjerner allerede felt med navn, e-post og telefon; 7.8 viser at handlingene uansett ikke sender verdiene.
3. **personvernerklæringen** (`docs/personvern/intern-personvernerklaering.md`) har `firms` og `contacts` med formål, hvem ser, kilde og «aldri til KI» (sjekkes i gjennomgangen).

## 10. Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Dublett kan ikke lagres, meldingen lenker | 4.1–4.3, 5.5, 7.5, e2e 8.1 |
| Ugyldig nummer avvises med norsk melding | 1, 3.3, e2e 8.3 |
| Kontakt har alltid kilde, skjermen viser den | 4.7, 5.3.4, 5.7.4, e2e 8.1 |
| Revisjonsloggen uten personopplysninger | 5.8.3, 7.8 |
| Annen organisasjon får ikke tilgang | 5.2 (ni kall), 5.3, 5.6.6, 4.5, 4.9 |
| Takstmann uten endringsrett ser, men endrer ikke | 5.1.1–5.1.2, 7.4, e2e 8.4 |
| Virker på iPad-størrelse | e2e 8.1 og 8.6 i `ipad` |
| Personvernerklæringen | 9.3 |
| lint, typecheck, test, test:e2e grønne | kjøres av test-leder før godkjenning |

**Avvises uten:** 5.1 (med admin-testen 5.1.5), 5.2 og 5.3. Regel 2 og 11 er ikke forhandlingsbare.
