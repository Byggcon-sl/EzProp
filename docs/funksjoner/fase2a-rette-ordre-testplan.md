# Testplan: Rette en ordre etter at den er lagret (T1)

- **Oppgavekort:** `docs/funksjoner/fase2a-rette-ordre.md`
- **Dato:** 12.11.2026 (test-leder, før bygging)
- **Støtter hovedmål:**
  - **De ansatte:** testene viser at en feil rettes med «Rett ordren» og «Lagre», for alle statuser, på PC og iPad, uten å avvise og legge inn på nytt.
  - **KI i bunnen:** testene låser at hver retting gir én loggrad med `changedFields` i fast rekkefølge. Det er grunnlaget for å måle KI-treff per felt når e-post-til-ordre kommer.
  - **Færre reklamasjoner:** ingen stille overskriving (versjonssjekk), oppdraget endres ikke, og det står hvem som endret hva og når.

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: «Testveien 12, 8000 Bodø» rettes til «Prøvegata 7, 8006 Bodø», bestiller «Megler Testesen», gnr/bnr `12`/`34` rettes til `56`/`78`, borettslag «Testtoppen borettslag», ekstern referanse `TEST-ORD-0001` rettes til `TEST-ORD-0002`. Fast tid: `TEST_NOW` fra `tests/factories.ts`.

Ingen fagregler og ingen KI-kall i oppgaven, så det trengs ingen regeltester (testsaker som data) og ingen KI-evaluering. Retting skjer med nett (kortet, «Ikke med»), så det trengs ingen e2e uten nett.

## Avtale om signaturer (utvikler og testskriver)

Testskriveren skriver mot dette. Avviker utvikleren, står det i kortet, og prosjektlederen retter testene ved sammenslåingen.

- `updateOrder(actor, organizationId, orderId, input, expectedRowVersion)` i `src/core/orders`, eksportert fra `index.ts`. Gir den oppdaterte ordren (samme form som `getOrder`) og `changedFields: string[]`.
- `listOrderHistory(actor, organizationId, orderId)` gir rader `{ id, action, changedFields: string[] | null, actorName: string | null, createdAt: Date }`, nyeste først.
- `OrderChangedError` i `src/core/orders/errors.ts`, melding «Ordren er endret av en annen. Last siden på nytt.».
- `orderFieldLabel(code)` i `src/core/orders/codes.ts` (eller `labels.ts`), og en fast liste `ORDER_EDITABLE_FIELDS` (`as const`) i den rekkefølgen `changedFields` bruker.
- `getOrder` gir `rowVersion: number`.
- `updateOrderAction` i `src/app/(ansatt)/ordre/actions.ts`.
- `ContactNotFoundError` gjenbrukes fra `src/core/contacts`.

## 1. Enhetstester (uten database)

Fil: `src/core/orders/codes.test.ts` (utvides) og `src/core/orders/schemas.test.ts` (utvides).

| Test | Viser |
|---|---|
| 1.1 `ORDER_EDITABLE_FIELDS` har nøyaktig de rettbare feltene, i fast rekkefølge | Ingen av `status`, `rejectReason`, `assignmentId`, `source`, `requestedReportType`, `organizationId` kan bli en feltkode. Endres listen, blir testen rød (regel 6). |
| 1.2 `orderFieldLabel` gir norsk etikett for hver kode i listen | Ingen kode står uten etikett; ingen etikett er lik koden (ikke engelsk i grensesnittet). |
| 1.3 `orderFieldLabel` på ukjent kode gir koden selv, aldri unntak | Gamle loggrader med en kode som er arkivert, viser fortsatt noe. |
| 1.4 rettingsskjemaet bruker `orderInputSchema` (samme objekt eller `.extend` av det) | Gjenbruk, ikke kopi. Samme norske feilmeldinger som «Ny ordre» for tom adresse, ugyldig gnr/bnr/snr og ugyldig dato. |
| 1.5 `OrderChangedError` har riktig melding og navn | Teksten brukeren ser. |

## 2. Integrasjonstester mot testdatabasen

Fil: `src/core/orders/update-order.test.ts` (ny). Ordren lages med `createOrder` fra `tests/factories.ts`, oppdrag med `createAssignment`, kontakter og firma med `createContact` og `createFirm`.

### 2.1 Tilgang per rolle (rettighetsmatrisen)

| Test | Viser |
|---|---|
| 2.1.1 kontor kan rette og se endringene | `assignment.edit` og `organization.read` virker for kontor. |
| 2.1.2 leder kan rette og se endringene | Som over. |
| 2.1.3 takstmann med `access.inspectors_edit_all` på kan rette | Dagens innstilling. |
| 2.1.4 takstmann med innstillingen av får `AccessDeniedError` ved retting, men kan se endringene; ordren er urørt, ingen loggrad, ingen hendelse | Lese og skrive er skilt; avslag endrer ingenting. |
| 2.1.5 takstmann med innstillingen av og enkeltrettigheten `assignment.edit` kan rette | Enkeltrettigheter virker som før. |
| 2.1.6 admin uten andre roller og med innstillingen av kan rette og se | **Admin stenges aldri ute** (regel 11). |
| 2.1.7 bruker uten ansattrad og ansatt uten roller får `AccessDeniedError` for både `updateOrder` og `listOrderHistory` | Ingen tilgang uten ansattforhold. |
| 2.1.8 deaktivert/myk-slettet ansatt får `AccessDeniedError` | Tidligere ansatte kan ikke rette. |

### 2.2 Tenant-isolasjon

| Test | Viser |
|---|---|
| 2.2.1 `expectTenantIsolation` for `updateOrder` | `query` retter én ordre per id fra `seed` og gir de rettede radene; A får bare A, B får bare B, kryss gir `AccessDeniedError`. |
| 2.2.2 `expectTenantIsolation` for `listOrderHistory` | Seed lager ordre med loggrader i begge organisasjoner; A ser bare A-rader. |
| 2.2.3 admin i A med `organizationId` = A og en ordre-id fra B gir `AccessDeniedError`; B-ordren, B-loggen og B-hendelsene er urørt | Filtrerer på `grant.organizationId` og ordre-id sammen, ikke bare id. |
| 2.2.4 `listOrderHistory` for A-ordre viser aldri loggrader fra B, selv når B har en rad med samme `entity_id` | Filter på `organization_id` i loggen, ikke bare `entity_id`. |
| 2.2.5 kobling til kontakt fra B gir `ContactNotFoundError`; A-ordren, loggen og hendelsene er urørt | IDOR via kontakt-id stoppes. |

### 2.3 Fremmed, ukjent, slettet og ugyldig id

| Test | Viser |
|---|---|
| 2.3.1 ukjent uuid gir `AccessDeniedError` | Ingen forskjell på «finnes ikke» og «ikke din». |
| 2.3.2 myk-slettet ordre gir `AccessDeniedError` for både `updateOrder` og `listOrderHistory`, og raden er fortsatt slettet | Myk sletting holder; retting vekker ikke opp en slettet ordre. |
| 2.3.3 ugyldig id (ikke uuid) gir `AccessDeniedError`, ikke databasefeil | Ingen 500. |
| 2.3.4 ukjent og myk-slettet kontakt i egen organisasjon gir `ContactNotFoundError`, ingenting endres | Akseptkriteriet om kontakt. |

### 2.4 Retting

| Test | Viser |
|---|---|
| 2.4.1 mottatt ordre: alle rettbare felt endres, og `getOrder` viser de nye verdiene | Hovedflyten. |
| 2.4.2 gjort-om ordre kan rettes; status `converted`, `assignmentId` og oppdragsnummer står; oppdraget (eiendom, parter, adresse, status, `row_version`) er uendret | A251, akseptkriterium 3. |
| 2.4.3 avvist ordre kan rettes; status `rejected` og avvisningsgrunnen står | A250. |
| 2.4.4 `status`, `rejectReason`, `assignmentId`, `source`, `requestedReportType` og `organizationId` i input blir aldri brukt | Felt utenfor skjemaet ignoreres eller avvises; verdiene i databasen er like før og etter. |
| 2.4.5 koble kontakt etter lagring: kontakt og kontaktens firma lagres | A87. |
| 2.4.6 bytte kontakt: nytt firma følger; kontakt uten firma gir firma `null`; kontakt med slettet firma gir firma `null` | Firmaet følger alltid kontakten. |
| 2.4.7 fjerne kontakt: begge kolonnene `null`, fritekst-bestilleren står | A87. |
| 2.4.8 `orderedByFirmId` fra input brukes aldri | Samme regel som ved oppretting. |
| 2.4.9 ugyldige verdier gir `ZodError` med samme meldinger som «Ny ordre», og ingenting endres (verdier, `row_version`, logg, hendelse) | Akseptkriterium 4. |
| 2.4.10 `updated_by` blir den som rettet, `created_by` og `created_at` er uendret, `row_version` øker med 1 | Sporingsfeltene stemmer. |
| 2.4.11 retting av tomt valgfritt felt til verdi og tilbake til tomt virker (tom streng blir `null`) | Felt kan fjernes, ikke bare endres. |

### 2.5 Versjonssjekk (A253)

| Test | Viser |
|---|---|
| 2.5.1 første retting rett etter oppretting med `rowVersion` fra `getOrder` godtas | Ingen falsk konflikt. |
| 2.5.2 to rettinger med samme `rowVersion`: den andre gir `OrderChangedError`, verdiene er fra den første, én loggrad | Ingen stille overskriving. |
| 2.5.3 retting med versjonen fra før avvisning gir `OrderChangedError`, ordren er avvist og uendret | Avvisning øker versjonen. |
| 2.5.4 retting med versjonen fra før konvertering gir `OrderChangedError` | Konvertering øker versjonen. |
| 2.5.5 to samtidige `updateOrder` (`Promise.allSettled`) med samme versjon: nøyaktig én lykkes, én gir `OrderChangedError`, én loggrad | `FOR UPDATE` virker, ikke bare sammenligningen. |
| 2.5.6 for høy versjon (ikke bare for lav) gir `OrderChangedError` | Likhetssjekk, ikke `<`. |

### 2.6 Revisjonslogg og hendelse (A252)

| Test | Viser |
|---|---|
| 2.6.1 én retting gir nøyaktig én loggrad: `entityType "order"`, `action "update"`, `entityId` = ordren, `organizationId` = A, `actor` = den som rettet | Hvem, når, hva. |
| 2.6.2 `changes` er nøyaktig `{ changedFields: [...] }` med feltkodene i rekkefølgen fra `ORDER_EDITABLE_FIELDS`, uansett rekkefølge i input | Fast form; ingen `from`/`to` (avgjort i forhåndsvurderingen). |
| 2.6.3 personopplysninger lekker ikke: JSON av loggraden og hendelsen inneholder ingen av de gamle eller nye verdiene (adresse, bestiller, gnr/bnr/snr, borettslag, ekstern referanse, kontaktens navn) | Leter etter de faktiske strengene, ikke bare nøklene. |
| 2.6.4 hendelsen `order.updated` med `data` lik `{ orderId, changedFields }`, i samme organisasjon | Fast kode for hendelsen. |
| 2.6.5 lagring uten endring (samme verdier, også med ulik trimming som gir samme lagrede verdi) gir ingen loggrad, ingen hendelse og samme `row_version` | Akseptkriterium 8. |
| 2.6.6 bare kontakten byttes: `changedFields` har kontaktfeltet (og firmafeltet hvis firma endres), ikke andre | Riktig felt-for-felt-sammenligning. |
| 2.6.7 ingen loggrad eller hendelse ved avslått tilgang, `ZodError`, `ContactNotFoundError` eller `OrderChangedError` | Feil gir ingen spor av en retting som ikke skjedde. |

Fil: `src/core/orders/orders-transaction.test.ts` (utvides, samme innpakking av `recordEvent` og `recordAuditEvent`):

| Test | Viser |
|---|---|
| 2.6.8 feiler loggen, er ordren uendret (verdier og `row_version`) og ingen hendelse | Samme transaksjon. |
| 2.6.9 feiler hendelsen, er ordren uendret og ingen loggrad | Samme transaksjon. |

### 2.7 Endringsloggen (`listOrderHistory`)

| Test | Viser |
|---|---|
| 2.7.1 ordre som er opprettet, rettet to ganger og gjort om gir fire rader, nyeste først, med `action` `create`, `update`, `update`, `convert` (eller kodene som finnes) | Alle handlinger uten filter. |
| 2.7.2 `actorName` er navnet til den ansatte; for en slettet bruker eller systemrad er den `null`, og raden står fortsatt | Left join, ingen rader forsvinner. |
| 2.7.3 rader for en annen ordre i samme organisasjon står ikke i listen | Filter på `entity_id`. |
| 2.7.4 rader med annen `entity_type` og samme `entity_id` står ikke i listen | Filter på `entity_type = 'order'`. |
| 2.7.5 svaret har faste felt (ingen `changes` rått, ingen avvisningsgrunn i en form som ikke skal vises) | Fast feltliste, som 4.4.5 for `getOrder`. |
| 2.7.6 `getOrder` gir `rowVersion`, og feltlisten i 4.4.5 oppdateres | Skjemaet får versjonen. |

## 3. Server action

Fil: `src/app/(ansatt)/ordre/actions.test.ts` (utvides, samme mønster med mocket `getEmployeeContext`).

| Test | Viser |
|---|---|
| 3.1 gyldig retting kaller `updateOrder` med `organizationId` fra innloggingen, aldri fra skjemaet | Regel 2. |
| 3.2 ordre-id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen | Samme mønster som de andre. |
| 3.3 `AccessDeniedError` gir `NO_ACCESS`; `OrderChangedError` gir meldingen «Ordren er endret av en annen. Last siden på nytt.»; `ZodError` gir feltfeil; `ContactNotFoundError` gir feltfeil ved kontakten | Riktig norsk melding per feil. |
| 3.4 loggeren får aldri skjemaverdier (adresse, bestiller, matrikkel) ved feil | Ingen personopplysninger i loggene (regel 8). |
| 3.5 `rowVersion` fra skjemaet som ikke er et heltall gir `OrderChangedError`-meldingen eller feltfeil, ikke 500 | Robust mot tuklet skjema. |

## 4. Tabelloversikt

- Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke. `tests/tenant-isolation-all-tables.test.ts` skal fortsatt være grønn.
- Hvis den nye testfilen `update-order.test.ts` har `expectTenantIsolation`, er regel 2 oppfylt for begge spørringene. Testlederen sjekker at kallet finnes for både `updateOrder` og `listOrderHistory`.

## 5. E2e (Playwright, prosjektene `pc` og `ipad`)

Fil: `e2e/fase-2a-rette-ordre.spec.ts` (ny). Bygger på hjelperne i `e2e/helpers.ts` (`logIn`) og samme mønster for å lage ordre som `e2e/fase-2a-ordre.spec.ts`.

| Test | Viser |
|---|---|
| 5.1 ny ordre → «Rett ordren» → endre adressen → «Lagre» → beskjeden «Ordren er rettet.», ny adresse vises, og «Endringer» har linjen «Rettet: adresse» med navn og tid | Akseptkriterier 1 og 9, på både `pc` og `ipad`. |
| 5.2 «Avbryt» lukker skjemaet uten lagring; ingen ny linje i «Endringer» | Ingen utilsiktet lagring. |
| 5.3 gjort-om ordre: «Rett ordren» viser linjen «Oppdraget endres ikke. …», retting lagres, lenken til oppdraget står, og oppdragssiden viser fortsatt den gamle adressen | A251 i grensesnittet. |
| 5.4 avvist ordre kan rettes | A250 i grensesnittet. |
| 5.5 tom adresse gir samme feilmelding ved feltet som «Ny ordre», med `aria-describedby`, og ingenting lagres | Akseptkriterium 4. |
| 5.6 to faner med samme ordre: lagre i den første, lagre i den andre gir «Ordren er endret av en annen. Last siden på nytt.» | Versjonssjekken når brukeren. |
| 5.7 koble bestilleren til en kontakt via kontaktvelgeren, lagre, og koblingen vises | A87 i grensesnittet. |
| 5.8 takstmann (innstillingen på) ser «Rett ordren» og kan lagre | Rollen i praksis. |
| 5.9 bruker uten ansattrad får «Ingen tilgang» og ser ingen adresse eller endringslogg | Tilgang i e2e. |
| 5.10 (bare `ipad`) i stående: ingen vannrett rulling i skjemaet og i «Endringer», skjemaet i én kolonne, knappene minst 44 px | iPad-størrelse. |
| 5.11 (bare `ipad`) skjemaet kan rettes og lagres med tastaturet alene | Tilgjengelighet. |

## 6. Det testlederen sjekker før godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- Hvert akseptkriterium i kortet er dekket av minst én test over (tabell i testrapporten).
- `expectTenantIsolation` finnes for `updateOrder` og `listOrderHistory`. Mangler en, avvises leveransen.
- Rettighetsmatrisen har admin med innstillingen av (2.1.6). Mangler den, avvises leveransen.
- 2.6.3 leter etter de faktiske verdiene i loggen og hendelsen, ikke bare etter nøkkelnavn.
- Ingen tilgangslogikk i `page.tsx` eller komponentene (bare `canEditOrders` for å vise knappen).
- Ingenting slettes permanent; slettet ordre forblir slettet (2.3.2).
- Versjonen i `package.json` er økt.
