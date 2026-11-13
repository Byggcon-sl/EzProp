# Testplan: Endre en ordre etter at den er lagret (T1)

- **Oppgavekort:** `docs/funksjoner/fase2a-rette-ordre.md` (runde 3 og 4 tatt inn)
- **Dato:** 13.11.2026 (test-leder, før bygging). Erstatter utkastet på `rette-ordre-testplan-reserve` (runde 2): `changedFields` er byttet til `fields` (liste) og `values` med `from`/`to`; ordene er «Endre ordren», «Endringene er lagret.» og «Endret»; e2e for avvist ordre og for takstmann med innstillingen av er kuttet (runde 4).
- **Støtter hovedmål:**
  - **De ansatte:** testene viser at en feil på ordren endres med «Endre ordren» og «Lagre» for alle statuser, på PC og iPad, uten å avvise og legge inn på nytt, og at ingenting som er skrevet går tapt ved konflikt.
  - **KI i bunnen:** testene låser at hver lagring gir én loggrad med `fields` (feltkoder i fast rekkefølge). Det er grunnlaget for treffprosent per felt når e-post-til-ordre kommer, uten å lese verdiene.
  - **Færre reklamasjoner:** ingen stille overskriving (`row_version`), oppdraget endres ikke, og det står hvem som endret hva og når.

Alle Vitest-tester går mot testdatabasen (`TEST_DATABASE_URL`) med `resetDatabase` i `beforeEach`. Testdata er oppdiktet: «Testveien 12, 8000 Bodø» endres til «Prøvegata 7, 8006 Bodø»; bestiller (fritekst) «Megler Testesen»; gnr/bnr `12`/`34` endres til `56`/`78`; borettslag «Testtoppen borettslag»; ekstern referanse `TEST-ORD-0001` endres til `TEST-ORD-0002`; e-post på `example.com`. Fast tid: `TEST_NOW`.

**Ingen regeltester og ingen KI-evaluering:** oppgaven har ingen fagregler og ingen KI-kall (kortet, «KI i bunnen» og «Regler»). **Ingen e2e uten nett:** endring krever nett; at skjemaet beholder teksten uten nett, testes i e2e 5.6 med `context.setOffline(true)`.

**Reklamasjonssaker:** unntaket i regel 12 gjelder reklamasjoner, ikke ordre. Ingen egen test her; eksisterende reklamasjonstester skal være grønne.

## Avtale om signaturer (utvikler og testskriver)

Testskriveren skriver mot dette. Avviker utvikleren, står det i kortet, og testene rettes ved sammenslåingen.

- `updateOrder(actor, organizationId, orderId, input, expectedRowVersion)` i `src/core/orders`, eksportert fra `index.ts`. Gir den oppdaterte ordren (samme form som `getOrder`, med `rowVersion`).
- `listOrderHistory(actor, organizationId, orderId)` gir rader i fast form: `{ id, action, actorName: string | null, occurredAt: Date, fields: string[], values: { field, from, to }[] }` (eller tilsvarende fast form; aldri rå `changes`). Kontaktverdier er navn eller «(fjernet kontakt)».
- `OrderChangedError` i `src/core/orders/errors.ts`, melding «Ordren er endret av en annen. Last siden på nytt.».
- `ORDER_EDITABLE_FIELDS` (`as const`, rekkefølgen i kortet) og `orderFieldLabel(code)` i `src/core/orders/codes.ts`.
- `getOrder` gir `rowVersion: number`.
- `updateOrderAction` i `src/app/(ansatt)/ordre/actions.ts`.
- `ContactNotFoundError` gjenbrukes fra `src/core/contacts`.
- Hendelsen `order.updated` med `data: { orderId, fields }`.

## 1. Enhetstester (uten database)

Filer: `src/core/orders/codes.test.ts`, `src/core/orders/schemas.test.ts`, `src/core/events/types.test.ts`, `src/app/(ansatt)/admin/labels.test.ts` (alle utvides).

| Test | Viser |
|---|---|
| 1.1 `ORDER_EDITABLE_FIELDS` er nøyaktig `receivedAt, externalRef, orderedByText, orderedByContactId, orderedByFirmId, addressText, gnr, bnr, snr, housingAssociationName, sellerDeclarationReceived`, i den rekkefølgen | Ingen av `status`, `rejectReason`, `assignmentId`, `source`, `requestedReportType`, `organizationId` kan bli feltkode. Endres listen, blir testen rød (regel 6). |
| 1.2 `orderFieldLabel` gir norsk etikett for hver kode i listen (løkke over hele listen); ingen etikett er lik koden | Akseptkriteriet om etiketter. |
| 1.3 `orderFieldLabel` på ukjent kode gir koden selv, også for `__proto__`/`toString` | Gamle loggrader viser fortsatt noe, ingen unntak. |
| 1.4 skjemaet for endring er `orderInputSchema` (samme objekt eller avledet med `.extend`/`.pick`); tom adresse, ugyldig gnr/bnr/snr og ugyldig dato gir samme norske meldinger som «Ny ordre» | Gjenbruk, ikke kopi. |
| 1.5 `OrderChangedError` har riktig melding og navn | Teksten brukeren ser. |
| 1.6 `order.updated` står i hendelsestypene (`types.test.ts`) | Fast kode for hendelsen. |
| 1.7 `formatAuditChanges` for `order`/`update` med `{ fields: ["addressText","orderedByContactId"], values: {...} }` gir «Endret: Adresse, Bestiller …» og **ingen** av verdiene i `values` | `/admin/logg` viser bare feltetiketter (sikkerhet-personvern). |
| 1.8 `auditFieldLabels` har etikett for hver kode i `ORDER_EDITABLE_FIELDS` | Ingen engelsk feltkode i adminloggen. |

## 2. Integrasjonstester mot testdatabasen

Fil: `src/core/orders/update-order.test.ts` (ny). Ordre med `createOrder`, oppdrag med `createAssignment`, kontakter og firma med `createContact` og `createFirm`, ansatte med `createEmployee`, enkeltrettigheter med `grantPermission`.

### 2.1 Tilgang per rolle (rettighetsmatrisen, tabelltest)

Én `it.each` over rollene mot både `updateOrder` og `listOrderHistory`.

| Test | Viser |
|---|---|
| 2.1.1 kontor kan endre og se endringene | `assignment.edit` og `organization.read` for kontor. |
| 2.1.2 leder kan endre og se endringene | Som over. |
| 2.1.3 takstmann med `access.inspectors_edit_all` på kan endre | Dagens innstilling. |
| 2.1.4 takstmann med innstillingen av: `updateOrder` gir `AccessDeniedError`, `listOrderHistory` virker; ordren, `row_version`, loggen og hendelsene er urørt | Lese og skrive er skilt; avslag endrer ingenting. |
| 2.1.5 takstmann med innstillingen av og enkeltrettigheten `assignment.edit` kan endre | Enkeltrettigheter virker som før. |
| 2.1.6 **admin uten andre roller og med innstillingen av** kan endre og se | Admin stenges aldri ute (regel 11). Mangler testen, avvises leveransen. |
| 2.1.7 bruker uten ansattrad og ansatt uten roller får `AccessDeniedError` på begge | Ingen tilgang uten ansattforhold. |
| 2.1.8 deaktivert ansatt får `AccessDeniedError` på begge | Tidligere ansatte kan ikke endre eller lese. |

### 2.2 Tenant-isolasjon

| Test | Viser |
|---|---|
| 2.2.1 `expectTenantIsolation` for `updateOrder`: `seed` lager én ordre i A og én i B og husker id-ene; `query` endrer egen ordre (med `rowVersion` fra `getOrder`) og gir raden; kryss gir `AccessDeniedError` | Regel 2 for den nye skrivespørringen. |
| 2.2.2 `expectTenantIsolation` for `listOrderHistory`: `seed` lager og endrer én ordre i hver organisasjon; `query` gir loggradene; A ser bare A | Regel 2 for den nye lesespørringen. |
| 2.2.3 bruker i A med A sin organisasjons-id og ordre-id fra B får `AccessDeniedError` på begge; B-ordren, `row_version`, B-loggen og B-hendelsene er urørt | Filter på `grant.organizationId` og id sammen. |
| 2.2.4 en loggrad i B med `entity_type = 'order'` og samme `entity_id` som A-ordren (satt inn direkte) vises aldri i `listOrderHistory` for A | Filter på `organization_id` i loggen, ikke bare `entity_id`. |
| 2.2.5 en loggrad i A med `values.orderedByContactId.to` lik en kontakt-id fra B (satt inn direkte) vises som «(fjernet kontakt)», aldri med B-navnet | Kontaktnavn slås opp med `grant.organizationId`. |
| 2.2.6 kontakt fra B til ordre i A gir `ContactNotFoundError`; A-ordren, `row_version`, loggen og hendelsene er urørt | IDOR via kontakt-id stoppes. |

### 2.3 Fremmed, ukjent, slettet og ugyldig id

| Test | Viser |
|---|---|
| 2.3.1 ukjent uuid gir `AccessDeniedError` på begge | Ingen forskjell på «finnes ikke» og «ikke din». |
| 2.3.2 myk-slettet ordre gir `AccessDeniedError` på begge, og `deleted_at` står | Myk sletting holder; endring vekker ikke opp en slettet ordre. |
| 2.3.3 ikke-uuid id gir `AccessDeniedError`, ikke databasefeil | Ingen 500. |
| 2.3.4 ukjent og myk-slettet kontakt i egen organisasjon gir `ContactNotFoundError`; ingen endring, ingen loggrad, `row_version` lik | Akseptkriteriet om kontakt. |

### 2.4 Endring

| Test | Viser |
|---|---|
| 2.4.1 mottatt ordre: alle felt i listen endres, og `getOrder` viser de nye verdiene | Hovedflyten. |
| 2.4.2 gjort-om ordre kan endres; status `converted` og `assignmentId` står; oppdraget (nummer, status, eiendom, parter, `row_version`) er likt før og etter | A251, akseptkriterium 3. |
| 2.4.3 avvist ordre kan endres; status `rejected` og avvisningsgrunnen står | A250. |
| 2.4.4 `status`, `rejectReason`, `assignmentId`, `source`, `requestedReportType` og `organizationId` i input blir aldri brukt | Verdiene i databasen er like før og etter. |
| 2.4.5 koble kontakt etter lagring: kontakt og kontaktens firma lagres | A87. |
| 2.4.6 bytte kontakt: nytt firma følger; kontakt uten firma gir firma `null`; kontakt med slettet firma gir firma `null` | Firmaet følger alltid kontakten. |
| 2.4.7 fjerne kontakt: begge kolonnene `null`, fritekst-bestilleren står | A87. |
| 2.4.8 `orderedByFirmId` fra input brukes aldri | Samme regel som ved oppretting. |
| 2.4.9 ugyldige verdier gir `ZodError` med samme meldinger som «Ny ordre»; verdier, `row_version`, logg og hendelser er urørt | Akseptkriterium 4. |
| 2.4.10 `updated_by` blir den som endret; `created_by` og `created_at` er uendret; `row_version` øker med 1 | Sporingsfeltene stemmer. |
| 2.4.11 valgfritt felt fra tomt til verdi og tilbake til tomt (tom streng blir `null`) | Felt kan fjernes, ikke bare endres. |
| 2.4.12 eiendom som ikke er lagret på oppdraget: forhåndsutfyllingen (`getAssignmentProperty`) viser den nye adressen etter endring av ordren; lagret eiendom står uendret | «Oppdateres på samme måte, eller det vises tydelig» (kortet, punkt 4). |

### 2.5 Låsen med `row_version` (A253)

| Test | Viser |
|---|---|
| 2.5.1 første endring rett etter oppretting med `rowVersion` fra `getOrder` godtas | Ingen falsk konflikt. |
| 2.5.2 to endringer etter hverandre med samme `rowVersion`: den andre gir `OrderChangedError`; verdiene er fra den første; én loggrad | Ingen stille overskriving. |
| 2.5.3 versjonen fra før avvisning gir `OrderChangedError`; ordren er uendret | Avvisning øker versjonen. |
| 2.5.4 versjonen fra før konvertering gir `OrderChangedError` | Konvertering øker versjonen. |
| 2.5.5 to samtidige `updateOrder` (`Promise.allSettled`) med samme versjon: nøyaktig én lykkes, én gir `OrderChangedError`, én loggrad | `FOR UPDATE` virker, ikke bare sammenligningen. |
| 2.5.6 for høy versjon gir `OrderChangedError` | Likhetssjekk, ikke `<`. |

### 2.6 Revisjonslogg, hendelse og applikasjonslogg (A252)

| Test | Viser |
|---|---|
| 2.6.1 én lagring gir nøyaktig én loggrad: `entityType "order"`, `action "update"`, `entityId` = ordren, `organizationId` = A, `actor_employee_id` = den som endret, `occurred_at` satt | Hvem og når. |
| 2.6.2 `changes` er nøyaktig `{ fields: [...], values: {...} }`; `fields` i rekkefølgen fra `ORDER_EDITABLE_FIELDS` uansett rekkefølge i input; `values` har én `{ from, to }` per kode i `fields`, ingen andre nøkler | Fast form, bare endrede felt, bare koder fra listen. |
| 2.6.3 bestilleren lagres som id-er i `values` (ikke kontaktnavn); `receivedAt` som ISO-tekst; tom verdi som `null` | Formatet i kortet. |
| 2.6.4 hendelsen `order.updated` har `data` lik `{ orderId, fields }`, i samme organisasjon; JSON av hendelsen inneholder ingen av de gamle eller nye verdiene (adresse, fritekst-bestiller, gnr/bnr/snr, borettslag, ekstern referanse, kontaktnavn) | Leter etter de faktiske strengene, ikke bare nøklene. |
| 2.6.5 lagring uten endring (også med ulik trimming som gir samme lagrede verdi) gir ingen loggrad, ingen hendelse og samme `row_version` | Akseptkriterium 8. |
| 2.6.6 bare kontakten byttes: `fields` er `["orderedByContactId", "orderedByFirmId"]` når firmaet også endres, ellers bare kontakten | Riktig sammenligning felt for felt. |
| 2.6.7 ingen loggrad og ingen hendelse ved avslått tilgang, `ZodError`, `ContactNotFoundError` og `OrderChangedError` | Feil gir ingen spor av en endring som ikke skjedde. |
| 2.6.8 `vi.spyOn(logger, …)` på alle nivåer: ved vellykket lagring og i hver feilgren (Zod-feil, `OrderChangedError`, `ContactNotFoundError`, databasefeil via innpakning) inneholder ingen logglinje adresse, fritekst-bestiller, matrikkel, borettslag eller ekstern referanse | Verdiene sendes aldri til `logger` (kortet, punkt 1). |
| 2.6.9 meldingen i hver kastet feil inneholder ingen av verdiene | Feilmeldinger lekker ikke. |
| 2.6.10 testene i `orders.test.ts` 4.6 (oppretting, avvisning, konvertering uten adresse, bestiller eller matrikkel) er uendret og grønne | Ingen verdier i loggen for andre handlinger. Testlederen sjekker diffen. |

Fil: `src/core/orders/orders-transaction.test.ts` (utvides, samme innpakning av `recordEvent` og `recordAuditEvent`).

| Test | Viser |
|---|---|
| 2.6.11 feiler loggen, er ordren uendret (verdier og `row_version`) og ingen hendelse | Samme transaksjon. |
| 2.6.12 feiler hendelsen, er ordren uendret og ingen loggrad | Samme transaksjon. |

### 2.7 Endringene (`listOrderHistory`)

| Test | Viser |
|---|---|
| 2.7.1 ordre som er opprettet, endret to ganger og gjort om gir rader for alle fire handlinger, nyeste først, med én etikett per handling | Alle handlinger, uten filter. |
| 2.7.2 en endring gir én verdi-linje per felt med `from` og `to`; kontakt vises med navnet fra kontaktregisteret; slettet kontakt som «(fjernet kontakt)» | Gammel og ny verdi i fast form. |
| 2.7.3 `actorName` er navnet til den ansatte, også når den ansatte er myk-slettet; raden står | Left join, ingen rader forsvinner. |
| 2.7.4 rader for en annen ordre i samme organisasjon og rader med annen `entity_type` og samme `entity_id` står ikke i listen | Filter på `entity_id` og `entity_type`. |
| 2.7.5 loggrad (satt inn direkte) med ukjent feltkode i `fields`/`values`, `values` som ikke er objekt eller mangler `from`/`to`: ukjente koder hoppes over, ingen unntak | `values` leses med Zod; bare kjente koder slipper gjennom. |
| 2.7.6 svaret har faste nøkler (ingen `changes`, ingen `organizationId`) | Fast form, som 4.4.5 for `getOrder`. |
| 2.7.7 201 loggrader gir høyst 200, de nyeste | Grensen. |
| 2.7.8 `getOrder` gir `rowVersion`; feltlisten i 4.4.5 oppdateres med `rowVersion` og ingenting annet | Skjemaet får versjonen. |

## 3. Server action

Fil: `src/app/(ansatt)/ordre/actions.test.ts` (utvides, samme mønster med mocket `getEmployeeContext`).

| Test | Viser |
|---|---|
| 3.1 gyldig lagring kaller `updateOrder` med `organizationId` fra innloggingen, aldri fra skjemaet (skjemaet sender en fremmed `organizationId`) | Regel 2. |
| 3.2 ordre-id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen | Samme mønster som de andre. |
| 3.3 `AccessDeniedError` gir `NO_ACCESS`; `OrderChangedError` gir «Ordren er endret av en annen. Last siden på nytt.»; `ZodError` gir feltfeil; `ContactNotFoundError` gir feltfeil ved kontakten | Riktig norsk melding per feil. |
| 3.4 `rowVersion` fra skjemaet som ikke er et heltall gir konfliktmeldingen eller feltfeil, ikke 500 | Robust mot tuklet skjema. |
| 3.5 spion på `logger` i hver gren over: ingen skjemaverdier (adresse, bestiller, matrikkel, borettslag, ekstern referanse) | Regel 8, også i feilgrenene. |

## 4. Tabelloversikt

- Ingen ny tabell; `tests/tenant-tables.ts` endres ikke, og `tests/tenant-isolation-all-tables.test.ts` skal være grønn.
- Testlederen sjekker at `expectTenantIsolation` kalles for både `updateOrder` (2.2.1) og `listOrderHistory` (2.2.2). Mangler en, avvises leveransen.

## 5. E2e (Playwright, prosjektene `pc` og `ipad`)

Fil: `e2e/fase-2a-rette-ordre.spec.ts` (ny). Bruker `logIn`, `logInAsOffice` og `uniqueSuffix` fra `e2e/helpers.ts` og samme måte å lage ordre på som `e2e/fase-2a-ordre.spec.ts`. Adressen får `uniqueSuffix()` så testene ikke krasjer med hverandre.

| Test | Viser |
|---|---|
| 5.1 ny ordre → «Endre ordren» → fokus på skjemaets overskrift → endre adressen → «Lagre» → «Endringene er lagret.»; ny adresse vises; «Endringer» har «Endret», navnet, tidspunkt og «Adresse: <gammel> → <ny>» | Akseptkriterium 1 og «Endringer» i grensesnittet. |
| 5.2 mens skjemaet er åpent, er skjemaene for «Gjør om» og «Avvis» skjult (bare én «Lagre») | Én lagreknapp på siden. |
| 5.3 «Avbryt» lukker skjemaet uten lagring; adressen og «Endringer» er som før | Ingen utilsiktet lagring. |
| 5.4 gjort-om ordre: «Endre ordren» viser «Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.»; endringen lagres; lenken til oppdraget og oppdragsnummeret står uendret | A251 i grensesnittet. |
| 5.5 koble bestilleren til en kontakt med kontaktvelgeren, lagre; navnet vises på ordren og i «Endringer» | A87 i grensesnittet. |
| 5.6 to faner med samme ordre: lagre i den første; i den andre gir lagring «Ordren er endret av en annen. Last siden på nytt.» øverst, knappen «Last siden på nytt», og teksten som er skrevet står igjen. Deretter `setOffline(true)` og lagre: «Du er uten nett. Endringen er ikke lagret.», teksten står igjen | Ingenting går tapt (bare melding, knapp og tekst sjekkes; samtidighet dekkes av 2.5.5). |
| 5.7 tom adresse gir samme feilmelding ved feltet som «Ny ordre», med `aria-describedby`; ingenting lagres | Akseptkriterium 4. |
| 5.8 kontor (`logInAsOffice`) ser «Endre ordren» og kan lagre | Rollen som bruker funksjonen mest. |
| 5.9 bruker uten ansattrad som åpner `/ordre/<id>` får «Ingen tilgang» og ser ingen adresse, ingen «Endre ordren» og ingen «Endringer» | Tilgang i e2e. |
| 5.10 (bare `ipad`) stående: «Endre ordren», «Lagre», «Avbryt» og «Last siden på nytt» er minst 44 px høye; «Lagre» minst 56 px | Størrelsene i kortet. |
| 5.11 (bare `ipad`) stående: ingen vannrett rulling med skjemaet åpent og i «Endringer»; skjemaet i én kolonne; linjene i «Endringer» kan leses (ikke avkuttet) | iPad-størrelse. |
| 5.12 (bare `ipad`) skjemaet kan endres og lagres med tastaturet alene | Tilgjengelighet. |

## 6. Dekning av akseptkriteriene

| Akseptkriterium (kortet) | Tester |
|---|---|
| Mottatt, gjort om og avvist kan endres | 2.4.1–2.4.3, 5.1, 5.4 |
| Bestilleren kobles, byttes, fjernes; firmaet følger | 2.4.5–2.4.8, 5.5 |
| Status m.m. og oppdraget uendret | 2.4.2, 2.4.4, 5.4 |
| Samme norske feilmeldinger | 1.4, 2.4.9, 5.7 |
| `OrderChangedError` og samtidig lagring | 2.5.1–2.5.6, 3.3, 5.6 |
| `ContactNotFoundError` | 2.2.6, 2.3.4 |
| Slettet, ukjent, ikke-uuid id | 2.3.1–2.3.3, 3.2 |
| Lagring uten endring | 2.6.5 |
| Loggraden (`fields`, `values`, hvem, når) | 2.6.1–2.6.3, 2.6.6 |
| Ingen verdier i applikasjonslogg, hendelse og feilmeldinger | 2.6.4, 2.6.8, 2.6.9, 3.5 |
| `order.updated` i hendelsestypene | 1.6, 2.6.4 |
| `/admin/logg` uten verdier | 1.7, 1.8 |
| `orderFieldLabel` for hele listen | 1.2 |
| «Endringer» på ordresiden | 2.7.1–2.7.7, 5.1 |
| Rettighetsmatrisen | 2.1.1–2.1.8 |
| Tenant-isolasjon | 2.2.1–2.2.6 |
| 4.6 uendret | 2.6.10 |
| e2e `pc` og `ipad` | 5.1–5.12 |
| lint, typecheck, test, test:e2e | testrapporten |

## 7. Det testlederen sjekker før godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- Hvert akseptkriterium er dekket (tabellen over, i testrapporten).
- `expectTenantIsolation` for `updateOrder` og `listOrderHistory`, og 2.2.3 med fremmed ordre-id under egen organisasjon. Mangler en, avvises leveransen.
- Admin med innstillingen av (2.1.6). Mangler den, avvises leveransen.
- 2.6.4, 2.6.8 og 3.5 leter etter de faktiske verdiene, ikke bare nøkkelnavn.
- Ingen tilgangslogikk i `page.tsx` eller komponentene (bare `canEditOrders` for å vise knappen).
- Ingenting slettes permanent; slettet ordre forblir slettet (2.3.2).
- A55 og A87 er merket som endret av T1, A249–A254 og spørsmål 78 er ført i `docs/09-apne-sporsmal.md`.
- Versjonen i `package.json` er økt (0.10.3 → 0.10.4).
