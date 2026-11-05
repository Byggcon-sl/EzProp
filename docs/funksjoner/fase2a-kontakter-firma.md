# Funksjon: Kontakter og firma (meglere og meglerforetak)

- **Fase:** 2a – Rapporten på PC (punktet «Kontakter og firma» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/contacts`, sidene `/kontakter` og `/firma` i rammen Fjord)
- **Branch:** `fase2a-kontakter-firma` (bygger på `main`)
- **Status:** klar til bygging (05.11.2026, prosjektleder)
- **Støtter hovedmål:** Tid: meglerne og meglerforetakene ligger i ett register med navn, e-post og telefon, så kontoret slipper å lete i gamle e-poster; ett firma per organisasjonsnummer gjør at samme meglerforetak ikke legges inn tre ganger. Reklamasjoner: kilden for opplysningene står på hver kontakt (personvern, innspill D17), og notatene om megleren («vil ha rapport før kl. 12») er felles for alle i stedet for i hodet til én takstmann. KI først: registeret er grunnlaget for at e-post-til-ordre (krok A1) og bestillingsskjemaet (fase 3) senere kan foreslå en eksisterende kontakt, og kontoret bare godkjenner. Ingen KI nå.

## Problem
Partene på oppdraget er i dag fritekst (A60). Samme megler skrives inn på nytt på hvert oppdrag, med skrivefeil og ulike varianter av foretaksnavnet. Det finnes ikke noe sted å skrive at en megler har spesielle ønsker, og vi vet ikke hvor opplysningene om en person kom fra, som personvernreglene krever (D17). Uten registeret kan heller ikke rutinene (fase 3), adresseboka med tall og CRM-et (fase 4) bygges.

## KI først
Ikke nå. Kontaktene er personopplysninger og sendes **aldri** til KI (domenemodellen 4.2). Kroken er at kontakt og firma har faste koder for kilde (`source`) og firmatype, slik at en senere KI-ordre kan foreslå en eksisterende kontakt (søk lokalt i databasen, ikke i KI) og merke nye kontakter med kilde `order`. Takstmannen eller kontoret godkjenner alltid.

## Brukerhistorier
- Som **kontor** vil jeg **legge inn et meglerforetak med organisasjonsnummer én gang** slik at **alle bruker samme firma**, og få beskjed hvis det allerede finnes.
- Som **kontor** vil jeg **legge inn en megler med navn, e-post, telefon, firma og et kort notat** slik at **alle vet hvem det er og hva hun ønsker**.
- Som **takstmann** vil jeg **søke opp en megler og se telefon og notat** slik at **jeg kan ringe uten å spørre kontoret**.
- Som **leder** vil jeg **at det står hvor opplysningene kom fra** slik at **vi kan svare hvis en megler spør hvorfor vi har opplysningene**.

## Omfang
**Med:**
1. **Tabellen `firms`** (ny migrering, neste ledige nummer), etter domenemodellen 4.2: `baseColumns` (organisasjon, sporingsfelt, `deleted_at`), `name` (påkrevd, høyst 200 tegn), `org_number` (valgfri, nøyaktig 9 sifre, lagret uten mellomrom), `firm_type` (påkrevd, CHECK: `broker_firm`, `insurer`, `housing_association`, `other`; standard `broker_firm`), `notes` (valgfri, høyst 1000 tegn).
   - **Ingen dubletter:** unik delvis indeks på `(organization_id, org_number)` der `org_number is not null and deleted_at is null`. Tjenesten sjekker først og gir `FirmDuplicateError` med id og navn på firmaet som finnes; databasen er vakten ved samtidige lagringer (unik-feil gjøres om til samme feil).
   - Organisasjonsnummeret kontrolleres med kontrollsifferet (modulus 11) som ren funksjon `isValidOrgNumber` i `src/core/contacts/org-number.ts`, med testsaker. Mellomrom fjernes før kontroll og lagring.
   - Indeks `(organization_id, name)`.
2. **Tabellen `contacts`** (samme migrering): `baseColumns`, `first_name` (påkrevd, høyst 100 tegn), `last_name` (valgfri, høyst 100 tegn), `email` (valgfri, gyldig, høyst 254 tegn), `phone` (valgfri, sifre, mellomrom og `+`, høyst 20 tegn), `firm_id` (valgfri; sammensatt fremmednøkkel `(organization_id, firm_id)` → `firms`), `notes` (valgfri, høyst 1000 tegn), `source` (påkrevd, CHECK: `manual`, `order`; standard `manual`).
   - Skjermen setter alltid `manual`. `order` brukes når ordre og parter kobles til kontakter (eget punkt). `broker_system` legges til som ny kode når API mot meglersystem kommer (regel 6: kodene endres aldri, nye legges til).
   - Ingen sperre mot like kontakter (D17 gjelder organisasjonsnummer). Indeks `(organization_id, last_name, first_name)`.
3. **Faste koder** i `src/core/contacts/codes.ts`: `FIRM_TYPES` med etiketter (`Meglerforetak`, `Forsikringsselskap`, `Sameie eller borettslag`, `Annet`) og `CONTACT_SOURCES` med etiketter (`Lagt inn for hånd`, `Fra en ordre`).
4. **Tjenester i `src/core/contacts`** (eksportert fra `index.ts`; alle kaller `requireOrganizationAccess` først og filtrerer på `grant.organizationId`; fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`; faste feltlister, ingen `select()` uten feltliste):
   - `listFirms(actor, organizationId, { query? })` og `listContacts(actor, organizationId, { query? })`: `organization.read`. Sortert på navn. Søket (valgfritt, trimmet, høyst 100 tegn) treffer navn og organisasjonsnummer for firma, og navn, e-post og firmanavn for kontakter (`ILIKE` med parameter, tegnene `%` og `_` escapes). Høyst 200 rader.
   - `getFirm` (med kontaktene i firmaet) og `getContact` (med firmanavnet): `organization.read`.
   - `createFirm`, `updateFirm`, `createContact`, `updateContact`: `assignment.edit` (samme rettighet som parter på oppdraget). `firmId` på kontakten må finnes i organisasjonen og ikke være slettet (ellers `FirmNotFoundError`, «Firmaet finnes ikke.»).
   - Zod-skjemaene `firmInputSchema` og `contactInputSchema` i `schemas.ts`. Navn og notat avviser 11 sifre på rad («Fødselsnummer skal ikke lagres her.»). Verdiene trimmes; tomme valgfrie felt blir `null`.
   - **Revisjonslogg** i samme transaksjon (`recordAuditEvent`): `firm` og `contact` med `create`/`update`, `changes` med id-er, kodene (`firm_type`, `source`) og **navnene** på feltene som ble endret, aldri navn, organisasjonsnummer, e-post, telefon eller notat. Ingen hendelser i `events` (de gjelder oppdrag og rapport).
5. **Sidene** (PC først, må virke i iPad-størrelse; rammen Fjord; skjemadelene i `src/app/(ansatt)/`, samme mønster som ordre):
   - Nye menypunkter «Kontakter» og «Firma» under «Ordre».
   - `/kontakter`: søkefelt og liste (navn, firma, e-post, telefon). Tom: «Ingen kontakter er lagt inn ennå.» Knappen «Ny kontakt» med `canEditOrders`.
   - `/kontakter/ny` og `/kontakter/[id]`: skjema med fornavn, etternavn, e-post, telefon, firma (nedtrekksliste med firmaene, og «Ingen»), notat og kilden vist som tekst («Kilde: Lagt inn for hånd»). Hjelpetekst ved notat: «Kort og saklig. Ikke skriv helseopplysninger eller fødselsnummer.» Uten `canEditOrders` vises opplysningene uten skjema.
   - `/firma`: søkefelt og liste (navn, organisasjonsnummer, type). Tom: «Ingen firma er lagt inn ennå.» Knappen «Nytt firma».
   - `/firma/ny` og `/firma/[id]`: navn, organisasjonsnummer, type og notat; på `/firma/[id]` også listen over kontaktene i firmaet med lenke.
   - Dublett: «Et firma med dette organisasjonsnummeret finnes allerede: <navn>.» med lenke til firmaet.
   - Server actions i hver mappe sin `actions.ts`: samme `FormState`, `NO_ACCESS`, `UNKNOWN_ERROR` og loggkontrakt som ordre (bare rute, bruker-id, id-er og feilnavn, aldri skjemaverdier). Id som ikke er uuid gir `NO_ACCESS` uten kall til kjernen. Ingen tilgangslogikk i sidene.
   - Feilmeldinger: «Skriv inn navnet.», «Skriv inn fornavnet.», «Organisasjonsnummeret må ha 9 sifre.», «Organisasjonsnummeret er ikke gyldig.», «E-postadressen er ikke gyldig.», «Telefonnummeret kan bare ha sifre, mellomrom og +.», «Fødselsnummer skal ikke lagres her.», «Firmaet finnes ikke.»
6. **Tester** (testskriver). Testdata er oppdiktet («Megler Test», «Testmegling AS», `megler@example.com`, telefon `00000000`, organisasjonsnumre som er gyldige etter modulus 11 men oppdiktede).
   - Fabrikker `createFirm` og `createContact` i `tests/factories.ts` (med tester), `RESET_TABLES`, og begge tabellene i `tests/tenant-tables.ts`.
   - `isValidOrgNumber`: gyldig, feil kontrollsiffer, 8 og 10 sifre, bokstaver, mellomrom, og nummer der kontrollsifferet blir 10 (ugyldig).
   - Skjemaene: grensene for hvert felt (n og n+1 tegn), 11 sifre i navn og notat, trimming, tom streng blir `null`.
   - Database: to aktive firma med samme organisasjonsnummer i samme organisasjon avvises; samme nummer i to organisasjoner er lov; et myk-slettet firma sperrer ikke; flere firma uten nummer er lov; kontakt med firma fra en annen organisasjon avvises; ukjent `firm_type` og `source` avvises.
   - **Tenant-isolasjon (regel 2):** `expectTenantIsolation` for alle åtte tjenestene. **IDOR:** A med egen org-id og Bs firma- eller kontakt-id gir `AccessDeniedError` i `get*` og `update*`, og Bs rad er uendret; `createContact` med Bs `firmId` gir `FirmNotFoundError` og ingen rad.
   - **Dubletter:** `createFirm` og `updateFirm` med nummer som finnes gir `FirmDuplicateError` med riktig id; to samtidige `createFirm` med samme nummer gir én rad og én `FirmDuplicateError`.
   - **Søk:** treffer på navn, nummer, e-post og firmanavn; `%` og `_` søker etter tegnet; slettede rader vises ikke.
   - **Rettigheter:** lesing og skriving, med `access.inspectors_edit_all` på og av (admin stenges aldri ute).
   - **Logg:** hele JSON-en i revisjonsloggen gjøres om til tekst, og navn, nummer, e-post, telefon og notat står ikke der.
   - **Handlingene:** id som ikke er uuid og bruker uten ansattrad gir `NO_ACCESS`; dublett gir meldingen med lenke; loggeren får aldri skjemaverdier.
   - **E2E i `pc` og `ipad`:** nytt firma → samme nummer igjen gir dublettmelding → ny kontakt i firmaet → søk finner kontakten → endre notat → firmasiden viser kontakten.
7. **Dokumenter:** domenemodellen 4.2 får «Bygget i fase 2a» (med nå, venter), ordlisten får de nye ordene, den interne personvernerklæringen (`docs/personvern/intern-personvernerklaering.md`) får `firms` og `contacts` (formål, hvem ser, kilde, aldri til KI), planpunktet krysses av, beslutningene føres i `docs/09-apne-sporsmal.md` med neste ledige numre (sjekk mot `fase2a-utstedende-selskap`, som kan ta numre samtidig). Versjon 0.2.74 → 0.2.75 (eller neste ledige ved PR). Er migreringsnummeret tatt av en annen PR når denne skal merges, nummereres migreringen om.

**Ikke med (bevisst utelatt):**
- **Kobling av partene på oppdraget** (`assignment_parties.contact_id`/`firm_id`), søk etter kontakt fra oppdragssiden og `orders.ordered_by_contact_id`/`ordered_by_firm_id`. En annen kjøring jobber i `src/core/assignments` nå. Føres som eget punkt i planen.
- Fjerning (myk sletting fra skjermen) og sammenslåing av like kontakter. Eget småpunkt; kolonnen `deleted_at` er på plass.
- `marketing_consent` (D17: «ikke i bruk nå»; legges til når markedsføring bygges, A17-mønsteret).
- `invoice_email` og `address` på firma (kommer med fakturagrunnlaget).
- Oppslag i Brønnøysundregistrene (fase 3), adresseboka med tall og CRM (fase 4), import fra IVIT.
- Innlogging for meglere (fase 4b).
- Egen side for innsyn eller utlevering av opplysninger til en kontakt.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | ja når `access.inspectors_edit_all` er på (`assignment.edit`), ellers nei |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja |

Bare ansatte i organisasjonen. Ingen kunder eller meglere logger inn.

## Data
Nye tabeller `firms` og `contacts` (punkt 1 og 2). Faste koder: `firm_type` (`broker_firm`, `insurer`, `housing_association`, `other`) og `contacts.source` (`manual`, `order`). Oppdater domenemodellen 4.2 og ordlisten.

## Skjermer
PC først, må virke i iPad-størrelse. Hovedhandling: søk og åpne kontakt (ett trykk fra menyen, så søk). Ny megler: meny → «Ny kontakt» → fyll ut → «Lagre». I dag: fritekst på hvert oppdrag på nytt.

## Regler
Ingen TG-regler. Kontrollen av organisasjonsnummer (modulus 11) er en ren funksjon med testsaker.

## Beslutninger tatt av prosjektlederen (autonom modus, føres i `docs/09-apne-sporsmal.md`)
1. **Organisasjonsnummeret er valgfritt, men unikt når det er fylt ut**, og kontrolleres med kontrollsifferet. Sameier, borettslag og utenlandske firma kan mangle det i øyeblikket; kontrollen hindrer at en skrivefeil gir en dublett. Kilde: D17, domenemodellen 4.2.
2. **Kilde bare på kontakter, med kodene `manual` og `order`.** Firma er ikke personopplysninger; kilden for firma kommer med Brønnøysund-oppslaget. Kilde: D17, domenemodellen 4.2.
3. **Ingen sperre mot like kontakter**, bare mot like organisasjonsnumre. To meglere kan hete det samme. Kilde: planpunktet og D17.
4. **Samme rettigheter som parter på oppdraget:** alle ansatte ser, `assignment.edit` endrer. Kilde: Ståle 27.10.2026 (alle ser alt), A53.
5. **Fjerning og samtykke til markedsføring venter.** Holder punktet lite; ingenting bruker dem ennå.

## Akseptkriterier
- [ ] Et firma med et organisasjonsnummer som finnes, kan ikke lagres; meldingen lenker til firmaet (test og e2e)
- [ ] Ugyldig organisasjonsnummer avvises med norsk melding (test)
- [ ] En kontakt har alltid kilde, og skjermen viser den (test og e2e)
- [ ] Revisjonsloggen har aldri navn, nummer, e-post, telefon eller notat (test)
- [ ] Bruker i annen organisasjon får ikke tilgang, verken til lister, oppslag eller endring (test, `expectTenantIsolation` og IDOR)
- [ ] Takstmann uten endringsrett ser registeret, men ikke skjemaene (test)
- [ ] Virker på iPad-størrelse (e2e)
- [ ] Personvernerklæringen har de to nye tabellene
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne

## Roller
- **utvikler** og **testskriver** i parallell. Bitene som ikke henger sammen: (a) migrering, skjema og `src/core/contacts` med enhets- og databasetester, (b) sidene og handlingene, (c) dokumentene (domenemodell, ordliste, personvernerklæring).
- **sikkerhet-personvern**: kontakter er personopplysninger (tenant-isolasjon, logg uten verdier, aldri til KI, personvernerklæringen).
- **test-leder**: testplan og gjennomgang før PR.
- Ikke arkitekt (tabellene står i domenemodellen, mønsteret finnes fra ordre og parter), ikke UX/UI (samme liste- og skjemamønster som ordre), ikke fag (ingen fagtekster eller TG).

## Åpne spørsmål
- Ingen som stopper punktet. Beslutningene over føres i tabellen «Avgjort av agentene mens Ståle var borte».
