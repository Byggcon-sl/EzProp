# Testplan: Eiendom og matrikkel på oppdraget

- **Oppgavekort:** `docs/funksjoner/fase2a-eiendom-matrikkel.md`
- **Dato:** 05.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:** tid (eiendommen er forhåndsutfylt fra ordren; testene låser at gnr, bnr, seksjonsnummer, borettslag og adresse kommer med, og at siden virker på iPad), reklamasjoner (boligtype og eierform er låste koder i skjema og database, og `hasCommonAreas` har testsaker, så leiligheter aldri mangler fellesdeler) og KI først (feltene har samme form som et senere oppslag, `data_source = manual`; testene viser at adresse, matrikkel og fritekst aldri havner i hendelser eller logg).

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: «Testveien 1», postnummer `0000`, poststed «Testby», kommunenummer `0000`, kommune «Testkommune», gnr `999`, bnr `999`, fnr `0`, snr `9`, «Borettslaget Test», organisasjonsnummer `000000000`, andelsnummer `0-0`, forretningsfører «Forvalter Test», notater «Sett trapperom og kjeller». «Fødselsnummer» i testene er alltid `12345678901` (oppdiktet, 11 sifre). Fast tid: `TEST_NOW` fra `tests/factories.ts`.

Ingen del av oppgaven virker uten nett (eiendommen legges inn på kontoret med nett), så det trengs ingen e2e uten nett. Ingen fagregler; regeltesten er dataregelen `hasCommonAreas` som testsaker (1.4).

## Avtale om signaturer (utvikler og testskriver)

Fra kortet, punkt 1–8. Testskriveren skriver mot dette; avvik føres i kortet under «Avgjørelser etter gjennomgangen».

- `src/core/properties/codes.ts`: `HOUSING_TYPES = ["detached", "semi_detached", "terraced", "apartment", "apartment_in_house", "holiday_home", "farm", "other"]`, `OWNERSHIP_FORMS = ["freehold", "section", "cooperative", "share"]`, `YES_NO_UNKNOWN = ["yes", "no", "unknown"]` (`as const`), `housingTypeLabel(code)`, `ownershipFormLabel(code)`, `yesNoUnknownLabel(code)` (eller tilsvarende navn), `hasCommonAreas({ housingType, ownershipForm }) → boolean`.
- `src/core/properties/schemas.ts`: `propertyInputSchema` (`address`, `postalCode`, `city`, `municipalityNumber`, `municipalityName`, `housingType`, `ownershipForm`, `gnr`, `bnr`, `fnr`, `snr`, `associationName`, `associationOrgNumber`, `shareNumber`) og `commonAreasInputSchema` (`managingAgent`, `conditionReportStatus`, `maintenancePlanStatus`, `notes`).
- `src/core/properties/errors.ts`: `CommonAreasNotApplicableError` («Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.»).
- Tjenester fra `@/core/properties`: `getAssignmentProperty`, `saveAssignmentProperty`, `saveCommonAreas` med signaturene i kortet punkt 7.
- Fabrikker: `createProperty(organizationId, { housingType?, ownershipForm?, address?, gnr?, bnr?, …, assignmentId?, deletedAt? })` lager eiendom og én matrikkelrad (og setter `assignments.property_id` når `assignmentId` er gitt), returnerer `{ property, cadastralUnit }`; `createCommonAreas(organizationId, { assignmentId?, managingAgent?, conditionReportStatus?, maintenancePlanStatus?, notes?, deletedAt? })` lager oppdrag med leilighet-eiendom selv når `assignmentId` mangler.

## 1. Faste koder, `src/core/properties/codes.test.ts` (ny, ren enhetstest)

1. **`HOUSING_TYPES` er låst:** nøyaktig de åtte kodene i fast rekkefølge. Kommentar: koder endres aldri (regel 6).
2. **`OWNERSHIP_FORMS` er låst:** nøyaktig `freehold`, `section`, `cooperative`, `share`; `bond` finnes ikke (A69).
3. **etiketter:** `housingTypeLabel` gir de åtte norske etikettene i kortet punkt 5; `ownershipFormLabel` gir `Selveier`, `Eierseksjon i sameie`, `Andel i borettslag`, `Aksjeleilighet`; ja/nei gir `Ja`, `Nei`, `Vet ikke`. Ukjent kode gir koden tilbake, aldri `undefined`.
4. **`hasCommonAreas` som testsaker** (`it.each`, A72):
   | boligtype | eierform | fellesdeler |
   |---|---|---|
   | hver av de åtte med `freehold` | `freehold` | bare `apartment` = ja, de sju andre = nei (inkludert `apartment_in_house`) |
   | `detached` | `section` / `cooperative` / `share` | ja |
   | `terraced` | `section` / `cooperative` / `share` | ja |
   | `apartment` | `section` / `cooperative` / `share` | ja |
5. **alle koder er dekket:** testsakene med `freehold` har like mange rader som `HOUSING_TYPES`, og testsakene for `detached` har én rad per eierform utenom `freehold` (ny kode uten testsak gjør testen rød).

## 2. Skjemaene, `src/core/properties/schemas.test.ts` (ny, ren enhetstest)

1. **adresse:** tom og bare mellomrom → «Skriv inn adressen.»; 200 tegn ok, 201 avvist; trimmes.
2. **postnummer og kommunenummer:** valgfrie (tom blir `null`); 3 sifre og 5 sifre → «Postnummeret må ha fire sifre.» / «Kommunenummeret må ha fire sifre.»; 4 sifre ok; `00a0` avvist.
3. **poststed og kommunenavn:** valgfrie; 100 ok, 101 avvist; trimmes.
4. **boligtype og eierform:** mangler, tom og ukjent (`"villa"`, `"bond"`) → «Velg boligtype.» / «Velg eierform.»; alle gyldige koder godtas (`it.each` over listene).
5. **gnr og bnr:** tomme → «Skriv inn gårdsnummer.» / «Skriv inn bruksnummer.»; 1 og 5 sifre ok, 6 sifre avvist; `12a` → «Gårdsnummer kan bare ha sifre.» (og tilsvarende for bruks-).
6. **fnr og snr:** valgfrie (tom blir `null`); 1–5 sifre ok, 6 avvist; bokstaver → «Festenummer kan bare ha sifre.» / «Seksjonsnummer kan bare ha sifre.».
7. **borettslag/sameie:** valgfritt; 200 ok, 201 avvist; trimmes.
8. **organisasjonsnummer:** valgfritt; 8 og 10 sifre → «Organisasjonsnummeret må ha ni sifre.»; `000000000` ok.
9. **andelsnummer:** valgfritt; `0-0` og 20 tegn ok; 21 tegn avvist; `A12` → «Andelsnummeret kan bare ha sifre og bindestrek.».
10. **fellesdeler:** forretningsfører valgfri, 200/201; notater valgfrie, 2000/2001; ja/nei/vet ikke mangler → `unknown`; ukjent kode avvist.
11. **fødselsnummer** (`it.each` over `address`, `city`, `municipalityName`, `associationName`, `managingAgent`, `notes`): `12345678901` og `Testveien 12345678901` → «Fødselsnummer skal ikke lagres her.»; 10 sifre godtas i fritekst.
12. **`organizationId`, `id`, `propertyId`, `dataSource` i input** fjernes eller avvises (skjemaet er strengt eller stripper; aldri med i resultatet).
13. **alle norske meldinger i kortet punkt 8 er dekket** (en test som samler tekstene og sjekker at hver er brukt over).

## 3. Databasen, `src/db/properties-schema.test.ts` (ny, direkte innsetting)

1. **CHECK:** `housing_type = "villa"`, `ownership_form = "bond"`, `data_source = "kartverket"`, `condition_report_status = "maybe"` og `maintenance_plan_status = "maybe"` avvises.
2. **standardverdier:** `data_source = manual`; fellesdeler uten ja/nei-felt får `unknown` på begge.
3. **matrikkelrad mot eiendom i annen organisasjon** (`organization_id` A, `property_id` fra B) avvises av den sammensatte fremmednøkkelen.
4. **`assignments.property_id` mot eiendom i annen organisasjon** avvises.
5. **fellesdeler på oppdrag i annen organisasjon** avvises.
6. **to aktive fellesdelsrader for samme oppdrag** → unik-feil; en myk-slettet rad og én aktiv godtas.
7. **påkrevde felt:** `address`, `housing_type`, `ownership_form`, `gnr`, `bnr`, `property_id`, `assignment_id` er `NOT NULL`.
8. **oppdrag uten eiendom** (`property_id = null`) godtas (eldre oppdrag).
9. **tenant-tabeller:** `properties`, `cadastral_units` og `common_areas` står i `tests/tenant-tables.ts` med radbyggere og testfilen `src/core/properties/properties.test.ts`; `tests/tenant-isolation-all-tables.test.ts` er grønn (tre flere tabeller enn før).
10. **migreringen er ren:** `0016` finnes, og `pnpm db:generate` lager ingen ny fil (sjekkes i gjennomgangen).

## 4. Kjernen, `src/core/properties/properties.test.ts` (ny, mot databasen)

### 4.1 Tilgang per rolle (rettighetsmatrise, `it.each`)

Kjøres to ganger: med `access.inspectors_edit_all` **på** og **av**.

1. **lese** (`getAssignmentProperty`): `inspector`, `office`, `manager`, `admin` lykkes i begge innstillingene.
2. **skrive** (`saveAssignmentProperty`, `saveCommonAreas`): med innstillingen på lykkes alle fire roller. Med innstillingen av lykkes `office`, `manager`, `admin`; `inspector` får `AccessDeniedError`, og antall rader i `properties`, `cadastral_units`, `common_areas`, `events` og `audit_log` er uendret, og `assignments.property_id` er uendret.
3. **enkeltrettighet:** takstmann med innstillingen av og `grantPermission(…, "assignment.edit")` kan begge skrivefunksjonene.
4. **ingen ansattrad, deaktivert ansatt, slettet ansatt, ansatt uten roller:** `AccessDeniedError` på `getAssignmentProperty` og `saveAssignmentProperty`.
5. **admin stenges aldri ute** (regel 11, testen skal aldri fjernes): admin uten andre roller, med innstillingen av, kan lese og bruke begge skrivefunksjonene.

### 4.2 Tenant-isolasjon (regel 2; tre kall til `expectTenantIsolation`, ett per funksjon)

1. **`getAssignmentProperty`:** `seed` lager oppdrag med eiendom (og fellesdeler) i A og B; `query` returnerer `[property]` (og fellesdelene sjekkes i samme test); `idOf = id`. Bs adresse, eiendoms-id og fellesdels-id står aldri i As svar.
2. **`saveAssignmentProperty`:** `seed` lager oppdrag i A og B; `query` lagrer eiendom i egen organisasjon og returnerer `[{ id }]`. Etterpå: Bs oppdrag har sin egen eiendom (eller ingen), og alle nye `properties`/`cadastral_units`/`events`/`audit_log`-rader for A har `organization_id = A`.
3. **`saveCommonAreas`:** `seed` lager oppdrag med leilighet-eiendom i A og B; `query` lagrer fellesdeler og returnerer `[{ id }]`. Etterpå: B har nøyaktig sin egen rad, urørt.

### 4.3 Fremmed id i egen organisasjon (IDOR)

Admin i A, med `orgA.id` som organisasjon:

1. **Bs `assignmentId`** i alle tre funksjonene → `AccessDeniedError`; Bs eiendom, matrikkelrad og fellesdeler er uendret (`updated_at`, verdier), og ingen ny rad eller hendelse finnes.
2. **`organizationId` eller `propertyId` i input ignoreres:** `saveAssignmentProperty` med `propertyId` = Bs eiendom lager eller endrer bare As egen eiendom; Bs eiendom er urørt.
3. **tilfeldig uuid og `"ikke-en-id"`** som oppdrags-id: `AccessDeniedError`, aldri databasefeil.

### 4.4 Myk sletting

1. **slettet oppdrag:** alle tre funksjonene gir `AccessDeniedError`.
2. **myk-slettet eiendom** som oppdraget peker på: `getAssignmentProperty` gir `property = null` (og `prefill`), og `saveAssignmentProperty` lager ny eiendom i stedet for å endre den slettede (eller avvises; testen følger kortet etter gjennomgangen). Den slettede raden finnes fortsatt.
3. **ingenting slettes:** bytt fra leilighet/borettslag til enebolig/selveier → fellesdelsraden står fortsatt med `deleted_at = null`, men `getAssignmentProperty` gir `commonAreas = null` (eller skjermen skjuler den; kortet sier «vises ikke»). Bytt tilbake → de gamle verdiene vises igjen.
4. **myk-slettet fellesdelsrad** vises ikke; `saveCommonAreas` lager ny rad.

### 4.5 `getAssignmentProperty`

1. **faste felt:** `Object.keys` på `property` og `commonAreas` er faste lister; ingen `deletedAt`, `deletedBy`, `rowVersion`, `organizationId`, `createdBy`.
2. **uten eiendom, med ordre:** ordre med `addressText = "Testveien 1"`, `gnr = "999"`, `bnr = "999"`, `snr = "9"`, `housingAssociationName = "Borettslaget Test"` → `prefill` har nøyaktig de fem verdiene; `property = null`; adressen er ikke delt opp (A73).
3. **uten eiendom, uten ordre:** `prefill` har tomme verdier.
4. **med eiendom:** `prefill` er tom eller mangler; `property` har feltene og én matrikkelrad.
5. **flere matrikkelrader** (satt inn direkte): svaret har én, og hvilken er fast (eldste) (A70).
6. **ordre i en annen organisasjon** som oppdraget (umulig via fremmednøkkel) testes ikke; i stedet: ordre som er myk-slettet gir tom `prefill`.

### 4.6 Lagring

1. **første lagring:** lager én eiendom og én matrikkelrad, setter `assignments.property_id`, `data_source = manual`, `createdBy` = den ansatte; én hendelse `assignment.property_saved` med `created = true`.
2. **andre lagring:** samme `property_id`, samme matrikkelrad-id, nye verdier; ingen nye rader; hendelse med `created = false`.
3. **lagring uten endring:** ingen hendelse, ingen loggrad, `updated_at` uendret.
4. **valgfrie felt tømmes:** postnummer satt, så tomt → `null`.
5. **valideringsfeil** gir `ZodError`, ingen rad, ingen hendelse.
6. **`saveCommonAreas` på enebolig/selveier** → `CommonAreasNotApplicableError`, ingen rad. Uten eiendom → samme feil.
7. **`saveCommonAreas` på hver gyldig kombinasjon** (`apartment`/`freehold`, `detached`/`section`, `terraced`/`cooperative`, `detached`/`share`) lykkes.
8. **`saveCommonAreas` to ganger:** én rad, oppdatert; `created = false` andre gang; ingen endring → ingen hendelse.
9. **samtidig første lagring:** to `saveAssignmentProperty` på samme oppdrag i `Promise.all` gir én eiendom og én `property_id` (låsen `FOR UPDATE`); to samtidige `saveCommonAreas` gir én aktiv rad og ingen unik-feil til brukeren. Blir testen ustabil, noteres det.

### 4.7 Hendelser og revisjonslogg

1. **`saveAssignmentProperty`:** `assignment.property_saved` med `assignmentId` og `data = { propertyId, created }`; revisjonslogg `property` og `cadastral_unit` med `create`, deretter `update` med navnene på feltene som ble endret.
2. **`saveCommonAreas`:** `assignment.common_areas_saved` med `data = { commonAreasId, created }`; revisjonslogg `common_areas`.
3. **ingen adresse eller fritekst:** for begge funksjonene, både `create` og `update`, gjøres hele `events.data` og `audit_log.changes` om til tekst med `JSON.stringify`, og «Testveien 1», «Testby», «Testkommune», `999`, «Borettslaget Test», `000000000`, `0-0`, «Forvalter Test» og «Sett trapperom» står ikke der. (gnr/bnr `999` velges så de ikke kolliderer med id-er.)
4. **ingen hendelse** ved avvist tilgang, valideringsfeil, `CommonAreasNotApplicableError` eller lagring uten endring.
5. **samme transaksjon** (egen fil `src/core/properties/properties-transaction.test.ts`, `vi.mock("@/core/events")`/`vi.mock("@/core/audit")` som kaster én gang): første `saveAssignmentProperty` kaster → ingen eiendom, ingen matrikkelrad, `property_id = null`; `saveCommonAreas` kaster → ingen rad.

## 5. Fabrikker, `tests/factories.test.ts` (utvides)

1. **`createProperty`** uten overstyring: eiendom (`detached`, `freehold`, «Testveien 1», `manual`) og én matrikkelrad (gnr/bnr `999`) i samme organisasjon; med `assignmentId` settes `property_id`; overstyring brukes.
2. **`createCommonAreas`** uten overstyring: lager oppdrag med `apartment`/`cooperative`-eiendom og en rad med `unknown`/`unknown`; overstyring brukes.
3. **`RESET_TABLES`** inneholder `properties`, `cadastral_units` og `common_areas` i rekkefølge som tåler fremmednøklene.

## 6. Handlingene, `src/app/(ansatt)/oppdrag/[id]/actions.test.ts` (utvides, kjernen byttet ut)

1. **`getEmployeeContext` gir `null`** → `savePropertyAction` og `saveCommonAreasAction` svarer `NO_ACCESS` uten kall til kjernen.
2. **id som ikke er uuid** → `NO_ACCESS` uten kall til kjernen.
3. **organisasjonen kommer fra konteksten:** skjemafelt `organizationId = OTHER_ORG` og `propertyId` endrer ikke kallet; kjernen kalles med `ORG` og oppdrags-id fra adressen.
4. **`AccessDeniedError`** → `NO_ACCESS`; **`CommonAreasNotApplicableError`** → norsk melding; **`ZodError`** → feil ved feltet med kortets tekster; ukjent feil → `UNKNOWN_ERROR`.
5. **loggkontrakt:** `JSON.stringify` av alle loggkall inneholder ikke adresse, gnr/bnr, borettslag, organisasjonsnummer, andelsnummer, forretningsfører eller notater.

## 7. E2E, `e2e/fase-2a-eiendom-matrikkel.spec.ts` (ny, prosjektene `pc` og `ipad`)

Admin fra seed. Hver test lager egen ordre og eget oppdrag med `uniqueSuffix()` (databasen tømmes ikke mellom kjøringer).

1. **forhåndsutfylling:** ny ordre med adresse «Testveien 1», gnr `999`, bnr `999`, seksjonsnummer `9`, borettslag «Borettslaget Test» → «Gjør om til oppdrag» → «Eiendom» står over «Team», viser «Fylt ut fra ordren. Kontroller før du lagrer.» og feltene har ordrens verdier; postnummer og poststed er tomme; boligtype og eierform har ikke noe valgt.
2. **påkrevd:** «Lagre eiendom» uten boligtype og eierform → «Velg boligtype.» og «Velg eierform.» ved feltene; ingenting lagres.
3. **leilighet i borettslag:** velg «Leilighet» og «Andel i borettslag» → «Lagre eiendom» → «Fellesdeler» vises → fyll inn «Forvalter Test», «Ja», «Vet ikke», notat → «Lagre fellesdeler» → last siden på nytt → alle verdier står, forhåndslinjen er borte.
4. **bytte til enebolig:** endre til «Enebolig» og «Selveier» → «Lagre eiendom» → «Fellesdeler» er borte. Bytt tilbake til «Leilighet» → «Fellesdeler» vises igjen med de gamle verdiene (ingenting slettet).
5. **feilmeldinger ved feltet:** gnr `12a` → «Gårdsnummer kan bare ha sifre.»; postnummer `123` → «Postnummeret må ha fire sifre.»; `12345678901` i adressen → «Fødselsnummer skal ikke lagres her.».
6. **takstmann:** `logInAsInspector` (innstillingen på) ser «Eiendom». Visningen uten `canEditOrders` (tekst, ingen «Lagre eiendom») dekkes i 4.1.2 og 6.4; legges til i e2e hvis det er enkelt.
7. **ukjent oppdrags-id** gir «Fant ikke siden» eller «Ingen tilgang», aldri 500.
8. **iPad-størrelse** (prosjektet `ipad`, stående): ingen vannrett rulling på `/oppdrag/<id>`, eiendomsskjemaet i én kolonne, «Lagre eiendom» og «Lagre fellesdeler» og nedtrekkslistene minst 44 px høye.
9. **tastaturet alene:** eiendomsskjemaet kan fylles ut og sendes med Tab, piltaster og Enter; feltene har synlige etiketter (`getByLabel`).

## Hva test-leder sjekker i gjennomgangen (avvises hvis det mangler)

- Alle tre `expectTenantIsolation`-kall i 4.2 og IDOR-testene i 4.3.
- Rettighetsmatrisen kjørt med innstillingen på og av, og admin-testen 4.1.5.
- Myk sletting (4.4): fellesdeler blir stående ved bytte av boligtype.
- Personvern-testen 4.7.3 og loggkontrakten 6.5.
- Alle tre tabellene i `tests/tenant-tables.ts`, og database-testene for sammensatte fremmednøkler (3.3–3.5).
- `hasCommonAreas`-testsakene dekker alle koder (1.4–1.5).
- Ingen tilgangslogikk i siden eller handlingene utover `NO_ACCESS`-mappingen; ingen id fra skjemaet brukes til filtrering.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne; versjonen er 0.2.77 (neste ledige); migrering `0016`.

## Dekning av akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Kontor legger inn og endrer eiendom med alle feltene | 2.1–2.9, 4.6.1–4.6.4, 7.3 |
| Forhåndsutfylt fra ordren | 4.5.2–4.5.3, 7.1 |
| Boligtype og eierform påkrevd, bare faste koder | 1.1–1.2, 2.4, 3.1, 7.2 |
| Fellesdeler bare for leilighet, eierseksjon, borettslag, aksje | 1.4–1.5, 4.6.6–4.6.7, 7.3–7.4 |
| Hendelser og logg i samme transaksjon, uten adresse og fritekst | 4.7 |
| Takstmann ser; med innstillingen av ikke endre | 4.1, 6.1, 7.6 |
| Tenant-isolasjon og fremmed id | 3.3–3.5, 3.9, 4.2, 4.3 |
| iPad-størrelse | 7.8 |
| Kommandoene grønne, versjon økt | gjennomgangen |
