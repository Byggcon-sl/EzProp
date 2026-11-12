# Funksjon: Endre en ordre etter at den er lagret

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», første gjenstående punkt (T1)
- **Modul:** kjerne (`src/core/orders`, `src/core/audit`), siden `/ordre/[id]`
- **Branch:** `rette-ordre-etter-lagring` (bygger på `main`)
- **Status:** klar for bygging (12.11.2026, prosjektleder). Runde 3: forhåndsvurderingen fra ux, sikkerhet-personvern og test-leder er tatt inn (se nederst). Versjon 0.10.3 → 0.10.4.
- **Kilde:** `docs/kartlegging/svar-fra-stale-2026-11-12.md`, T1 (spørsmål 60): «ja, full redigeringstilgang. alltid». Også etter at ordren er blitt oppdrag. Endrer A55 og A87. «Gammel og ny verdi» i loggen kommer fra oppgaveteksten, ikke fra Ståle (se A252 og spørsmål 78).
- **Støtter hovedmål:**
  - **De ansatte:** en skrivefeil i adressen eller bestilleren rettes på stedet med tre trykk (rundt 20–40 sekunder). I dag må kontoret avvise ordren og legge den inn på nytt (rundt 15 trykk, 2–4 minutter og en dobbel ordre i listen).
  - **KI i bunnen:** hver endring lagres med feltkodene som ble endret. Når KI senere lager ordreforslag fra e-post (`source = email`), kan treffprosenten per felt regnes ut fra feltkodene alene, uten å lese verdiene.
  - **Færre reklamasjoner:** riktig bestiller og adresse, og det står hvem som endret hva.

## Problem
En ordre kan ikke endres etter lagring (A55), og bestilleren kan ikke kobles etterpå (A87). Feil rettes ved å avvise og lage ny ordre. Det gir doble ordre i listen, ekstra arbeid for kontoret, og ingen sporbar sammenheng mellom den gale og den riktige. Ståle har sagt at alle skal kunne endre alltid.

## Ord
Ordet «Rettet» brukes allerede om rapporter fra versjon 2 (regel 12). På ordren brukes derfor **«Endre ordren»**, **«Endringene er lagret.»** og **«Endret»**, aldri «rett»/«rettet» i grensesnittet.

## KI i bunnen
- **Ingen nytt KI-kall i denne oppgaven.** Endringen er en ren skjemaendring; KI skal ikke endre ordren selv (den ansatte har siste ord).
- **Data for KI senere:** revisjonsloggen får én rad per lagring med feltkodene (`fields`). Treffprosent per felt for e-post-til-ordre (krok A1) regnes ut fra feltkodene, aldri fra verdiene.
- Ingenting sendes til KI. Senere KI-bruk av loggen går gjennom `src/core/ai` og vasken og får bare feltkodene (regel 14).
- Applikasjonsloggen (`logger`) og hendelsen `order.updated` får bare feltkoder og id-er, aldri verdier.

## Brukerhistorier
- Som **kontor** vil jeg **endre adressen, matrikkelen eller bestilleren på en lagret ordre** slik at **jeg slipper å avvise den og legge den inn på nytt**.
- Som **takstmann** vil jeg **endre en ordre også etter at den er blitt oppdrag** slik at **ordren stemmer med det vi faktisk fikk bestilt**.
- Som **leder** vil jeg **se hvem som har endret ordren og når** slik at **feil på den ordren kan følges opp**. Loggen vises bare per ordre. Oppsummering eller statistikk per ansatt er ikke med, og krever drøfting med de ansatte først (arbeidsmiljøloven kap. 9, som K8).

## Felt som kan endres (fast liste, i denne rekkefølgen)
`receivedAt`, `externalRef`, `orderedByText`, `orderedByContactId`, `orderedByFirmId`, `addressText`, `gnr`, `bnr`, `snr`, `housingAssociationName`, `sellerDeclarationReceived`.

Dette er de eneste feltkodene som kan stå i `fields` og i `values`. `orderedByText` (fritekst om hvem som bestilte) kan inneholde et navn, og `addressText` en adresse; begge er med i spørsmål 78 til Ståle. Feltkodene er navnene i koden og endres aldri (regel 6).

## Omfang
**Med:**
1. **Tjenesten `updateOrder(actor, organizationId, orderId, input, expectedRowVersion)`** i `src/core/orders`:
   - `requireOrganizationAccess(..., "assignment.edit")` først, samme rettighet som å legge inn ordre (A249). Filtrerer på `grant.organizationId`. Fremmed, ukjent, myk-slettet eller ikke-uuid id gir `AccessDeniedError`.
   - Feltene i listen over. Samme Zod-regler som `orderInputSchema` (gjenbruk, ikke kopi). Kobling til kontakt: firmaet følger kontakten, som ved oppretting.
   - Virker for alle statuser: mottatt, gjort om og avvist (A250). Status, avvisningsgrunn, `assignment_id`, `source` og `requested_report_type` endres ikke.
   - Låser raden (`FOR UPDATE`) og avviser lagring hvis `row_version` ikke er lik det skjemaet ble åpnet med: `OrderChangedError` («Ordren er endret av en annen. Last siden på nytt.») (A253). `row_version` øker ved hver endring, også ved avvisning og konvertering.
   - Kontakt fra annen organisasjon, ukjent eller myk-slettet kontakt gir `ContactNotFoundError`, og ingenting endres.
   - Lagring uten endring: ingen rad i `audit_log`, ingen hendelse, `row_version` uendret.
   - Revisjonsloggen i samme transaksjon, i **samme format som resten av systemet** (`fields` er en liste med feltkoder, slik work-queue, claims, properties, buildings og employees-admin gjør):
     ```
     entityType: "order", action: "update",
     changes: { fields: ["addressText", …], values: { addressText: { from, to }, … } }
     ```
     Feltkodene i fast rekkefølge, bare endrede felt. Verdiene ligger samlet under `values`, slik at de kan tømmes med én endring hvis Ståle sier nei (spørsmål 78); `fields` står da igjen. Bestilleren lagres som id-er, ikke navn. Datoer som ISO-tekst.
   - **Applikasjonsloggen:** `updateOrder` og `updateOrderAction` sender aldri `input`, `changes`, raden, Zod-feilen med inndata eller feilmeldinger med verdier til `logger`. Bare feltkoder, id-er og feilkoder. Grunn: `SENSITIVE_KEY` i `src/shared/lib/logger.ts` fanger ikke `addressText`, `orderedByText`, `housingAssociationName` eller `externalRef`, og adresser vaskes ikke i tekst. Vernet er at verdiene aldri sendes.
   - `getOrder` gir også `rowVersion` (kommentaren oppdateres).
   - Hendelsen `order.updated` (`data: { orderId, fields }`, ingen verdier) via `recordEvent`, ført i `src/core/events/types.ts`.
2. **`listOrderHistory(actor, organizationId, orderId)`** i `src/core/orders`, med `organization.read`:
   - Sjekker først at ordren finnes, ikke er myk-slettet og ligger i `grant.organizationId`; ellers `AccessDeniedError`.
   - Leser `audit_log` filtrert på `grant.organizationId`, `entity_type = 'order'` og `entity_id`; navn på ansatt med left join (myk-slettet ansatt vises fortsatt). Nyeste først, høyst 200 rader.
   - Returnerer en fast form, aldri rå `changes`: `values` leses med Zod, og bare kjente feltkoder fra listen slipper gjennom.
   - Navn på kontakt slås opp med `grant.organizationId`; slettet eller ukjent kontakt gir «(fjernet kontakt)».
   - Én etikett per handling (opprettet, endret, avvist, gjort om) pluss `orderFieldLabel` for feltene.
3. **`/admin/logg`:** for `order`/`update` vises bare «Endret: Adresse, Bestiller …» (feltetikettene). `formatAuditChanges` leser `fields` som før og hopper over `values` fordi det ikke er `{from, to}`. Etikettene for ordrefeltene legges i `auditFieldLabels` (fra `orderFieldLabel`-listen, ikke en kopi hvis det lar seg gjøre uten modulimport på tvers). Verdiene vises bare på ordresiden.
4. **Skjermen `/ordre/[id]`:**
   - Knappen **«Endre ordren»** rett under ordrekortet, sekundær, minst 44 pt, når `canEditOrders` (alle statuser). «Gjør om til oppdrag» er fortsatt hovedknappen på en mottatt ordre.
   - Knappen åpner skjemaet på samme side, forhåndsutfylt, med kontaktvelgeren som på «Ny ordre». Fokus flyttes til skjemaets overskrift. Mens skjemaet er åpent, skjules skjemaene for «Gjør om» og «Avvis», så det er bare én lagreknapp på siden.
   - «Lagre» (primær, 56 pt) og «Avbryt» (sekundær, minst 44 pt) står nederst i skjemaet, ikke i en fast bunnlinje (tastaturet på iPad dekker den).
   - «Lagre» går tilbake til visningen med beskjeden «Endringene er lagret.» «Avbryt» lukker uten lagring.
   - **Ingenting går tapt:** ved `OrderChangedError` og ved tapt nett beholder skjemaet det som er skrevet, og meldingen står øverst. `OrderChangedError` får knappen «Last siden på nytt» (minst 44 pt; en iPad-PWA har ingen synlig oppdateringsknapp). Uten nett: «Du er uten nett. Endringen er ikke lagret.»
   - For en ordre som er gjort om, står over skjemaet: «Oppdraget endres ikke. Eiendom og bestiller på oppdraget endres på oppdraget.» Lenken til oppdraget finnes alt og gjenbrukes (A251).
   - Delen **«Endringer»** under ordren: én linje per hendelse, nyeste først, med dato og klokkeslett, navn og handling («Endret» for endringer). Én underlinje per felt: «Adresse: Storgata 1 → Storgata 11». Tom verdi «(tom)», ja/nei «Ja»/«Nei», bestilleren med navnet fra kontaktregisteret (eller «(fjernet kontakt)»).
5. **Server action** `updateOrderAction` i `src/app/(ansatt)/ordre/actions.ts`, samme mønster som de andre (ikke-uuid gir `NO_ACCESS`; logglinjer uten skjemaverdier, også i feilgrenene).
6. **Beslutningene:** A55 og A87 får en linje om at de er endret av T1 (12.11.2026). A249–A253 føres i `docs/09-apne-sporsmal.md`. Spørsmål 78 til Ståle er ført.
7. **Dokumenter:** domenemodellen 4.3 (ordren kan endres; `update` er eneste ordrehandling med verdier i loggen) og 4.12 (`values` med `from`/`to` for ordre). Kommentarene i `src/core/orders/orders.ts`, `src/core/audit/index.ts` og `src/db/schema/audit.ts` oppdateres på samme måte. Ordlisten: `updateOrder`, `OrderChangedError`, `listOrderHistory`, `orderFieldLabel`, `order.updated`. Planen krysses av.

**Ikke med (bevisst utelatt):**
- Endring av oppdraget når ordren endres (A251).
- Nytt notatfelt på ordren.
- Bytte av oppdragstype eller ønsket rapport (bare `condition_report` finnes).
- Angre en avvisning eller konvertering, eller endre status.
- Verdier i loggen for oppretting, avvisning og konvertering. Testene i `src/core/orders/orders.test.ts` (4.6) som viser at disse ikke har adresse, bestiller eller matrikkel i hendelser og logg, står uendret.
- Egen side eller eksport av loggen, og oppsummering per ansatt.
- Endring av kontakter, oppdrag eller eiendom fra ordresiden.
- Endring uten nett (ordre er kontorarbeid med nett, som oppretting). Skjemaet mister likevel ikke det som er skrevet.
- KI-forslag til endring.
- Søk og dublettvarsel (T2 og T3, egne punkter).

## Tilgang
| Rolle | Se ordre og endringer | Endre |
|---|---|---|
| takstmann | ja | ja, når `access.inspectors_edit_all` er på (i dag på); av gir `AccessDeniedError`, men lesing virker |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja, også med innstillingen av |
| uten ansattrad / deaktivert | nei | nei |

All sjekk i `src/core/access` via `requireOrganizationAccess`. `canEditOrders` styrer bare visning av knappen.

## Data
Ingen migrering. Nye faste koder: handlingen `update` på `order` i revisjonsloggen og hendelsen `order.updated`. `audit_log` står allerede i `tests/tenant-tables.ts`.

## Testdata
Bare oppdiktede adresser og navn, e-post på `example.com`.

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] En mottatt, en gjort om og en avvist ordre kan endres, og endringen vises etter lagring.
- [ ] Bestilleren kan kobles, byttes og fjernes etter lagring; firmaet følger kontakten.
- [ ] Status, avvisningsgrunn, `assignment_id`, `source` og `requested_report_type` endres ikke; oppdraget (nummer, eiendom, parter) er uendret etter endring av en gjort-om ordre.
- [ ] Ugyldige verdier gir de samme norske feilmeldingene som «Ny ordre» (samme schema).
- [ ] Gammel `rowVersion` (etter en annen endring, avvisning eller konvertering) gir `OrderChangedError` og ingen endring. Første endring etter oppretting godtas. To samtidige lagringer med samme `rowVersion`: nøyaktig én lykkes.
- [ ] Kontakt fra annen organisasjon, ukjent eller myk-slettet kontakt gir `ContactNotFoundError`; ingen endring, ingen loggrad, `row_version` lik.
- [ ] Myk-slettet ordre, ukjent id og ikke-uuid id gir `AccessDeniedError`; action gir `NO_ACCESS`.
- [ ] Lagring uten endring: ingen rad i `audit_log`, ingen hendelse, `row_version` uendret.
- [ ] Revisjonsloggen får én rad per lagring: `fields` med feltkoder i fast rekkefølge, `values` med `from`/`to` for hvert endret felt, `actor_employee_id` og `occurred_at`. Bare koder fra den faste listen.
- [ ] Applikasjonsloggen, hendelsen `order.updated` og kastede feilmeldinger har ingen adresse, navn, matrikkel, borettslag eller ekstern referanse. Testen spionerer på `logger` i tjenesten og i action-en, også i feilgrenene (Zod-feil, `OrderChangedError`, `ContactNotFoundError`, databasefeil).
- [ ] `order.updated` står i `src/core/events/types.ts`, og `types.test.ts` er oppdatert.
- [ ] `/admin/logg` viser en ordreendring som «Endret: <feltetiketter>», uten verdier (test på `formatAuditChanges`).
- [ ] `orderFieldLabel` har etikett for hver feltkode i listen (testen går gjennom hele listen).
- [ ] «Endringer» på ordresiden viser hvem, når, hvilke felt og gammel og ny verdi, nyeste først; ukjente nøkler hoppes over; myk-slettet ansatt vises med navn; høyst 200 rader.
- [ ] Rettighetsmatrisen over (tabelltest mot `updateOrder` og `listOrderHistory`).
- [ ] Tenant-isolasjon: `expectTenantIsolation` for `updateOrder` (innpakning som endrer én egen ordre og returnerer raden) og `listOrderHistory`. I tillegg: bruker i A med A sin organisasjons-id og ordre-id fra B får `AccessDeniedError` på begge, og B sin ordre og logg er uendret.
- [ ] Testene i 4.6 for oppretting, avvisning og konvertering står uendret og er grønne.
- [ ] Ingen KI-kall og ingen rad i `ai_usage_log` fra endring (test).
- [ ] e2e på `pc` og `ipad` (`e2e/fase-2a-rette-ordre.spec.ts`): ny ordre → «Endre ordren» → endre adresse → «Lagre» → «Endringene er lagret.» → «Endringer» viser gammel og ny adresse, navn og tidspunkt; gjort-om ordre kan endres, oppdragsnummeret er uendret og linjen «Oppdraget endres ikke…» vises; «Avbryt» lagrer ingenting; to faner gir «Ordren er endret av en annen. Last siden på nytt.» med knappen «Last siden på nytt», og det som er skrevet står igjen; takstmann med innstillingen av ser ikke knappen; på iPad er knappene minst 44 px, ingen vannrett rulling i stående, og «Endringer» kan leses.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A249 (lett å endre):** endring krever `assignment.edit`, samme som å legge inn ordre. Ståle sa «full redigeringstilgang», og rettigheten finnes.
- **A250 (lett å endre):** alle statuser kan endres, også avvist («alltid»). Status og grunn endres ikke her.
- **A251 (lett å endre):** endring av ordren endrer ikke oppdraget. Å skrive over oppdragets eiendom og parter stille kan gi feil i rapporten.
- **A252 (dyrt å endre, agentenes valg):** revisjonsloggen får gammel og ny verdi per felt under `values`; applikasjonsloggen og hendelsene får bare feltkoder. Kilden er oppgaveteksten («hvem, når, gammel og ny verdi»), **ikke** et svar fra Ståle; han sa bare «full redigeringstilgang. alltid» og planen «endringene logges». Dyrt fordi `audit_log` aldri endres eller ryddes (A58), så en feil adresse eller et feil navn blir stående i loggen i 10 år, og innsyn, retting og sletting (GDPR art. 15–17) må da dekke loggen. Bygges i test med oppdiktede data. Spørsmål 78 må være besvart før ekte data, og står som linje under DPIA-punktet (K3) i «Minimum før ekte data». Sier Ståle nei, tømmes `values` med én endring.
- **A253 (lett å endre):** samtidige lagringer stoppes med `row_version`, ikke «siste vinner». `updated_at` er valgt bort fordi databasen lagrer mikrosekunder og en JS-dato millisekunder.

## Forhåndsvurdering (12.11.2026)
- **Runde 1 og 2:** `row_version` i stedet for `updated_at`; `getOrder` gir `rowVersion`; historikken uten filter og uten egen visning per handling; lenken til oppdraget gjenbrukes. Oppgaven krever gammel og ny verdi, så verdiene lagres i revisjonsloggen.
- **Runde 3, godtatt fra ux-ansvarlig:** ordene «Endre ordren» / «Endringene er lagret.» / «Endret» (ikke «Rettet», som er rapportversjon 2); plassering og størrelse på knappene; Lagre og Avbryt nederst i skjemaet; fokus til overskriften; ingenting går tapt ved konflikt eller tapt nett, med «Last siden på nytt».
- **Runde 3, godtatt fra sikkerhet-personvern:** A252 merket som agentenes valg med kilde; spørsmål 78 til Ståle; linje under DPIA-punktet i planen; verdiene samlet under `values`; fast feltliste med `orderedByText`; `/admin/logg` viser bare feltetiketter; krav om at verdier aldri sendes til `logger`, testet også i feilgrenene; `listOrderHistory` sjekker ordren først, returnerer fast form og har grense; testene i 4.6 står uendret; loggen vises bare per ordre (arbeidsmiljøloven kap. 9); oppdiktede testdata.
- **Runde 3, godtatt fra test-leder:** `fields` som liste med feltkoder, slik resten av systemet gjør (`changedFields` utgår, også i hendelsen); de manglende kriteriene (ugyldig/slettet id, lagring uten endring, hendelsestypen, `/admin/logg`); egen test for fremmed ordre-id under egen organisasjon og innpakning for `expectTenantIsolation`; testplanen følges.
- **Uenighet avgjort:** test-leder foreslo `<feltkode>: { from, to }` direkte i `changes`, som `/admin/logg` viser med verdier. Sikkerhet-personvern vil ikke ha verdiene i adminloggen. Avgjort: `fields` som liste (test-leder) og verdiene under `values` (sikkerhet). Da viser adminloggen bare feltetikettene uten egen kode, og verdiene kan tømmes ett sted.
- **e2e for avvist ordre:** ikke med. Avvist ordre bruker samme skjema og samme tjeneste som mottatt; enhetstesten dekker statusen, og e2e for mottatt og gjort-om dekker skjermen.
- **Kontakt fra B til ordre i A:** dekkes av kriteriet om `ContactNotFoundError` (kontakt fra annen organisasjon).

## Roller
utvikler (kjerne + side + action), testskriver (i parallell: tilgang, isolasjon, logg, e2e), sikkerhet-personvern (gjennomgang av logg og applikasjonslogg), ux (kort: knappene og «Endringer» på iPad). Ikke arkitekt, ui eller fag: ingen migrering, skjemaet gjenbrukes, ingen fagstoff.

## Åpne spørsmål
- **Spørsmål 78 til Ståle** (personvern, stopper ikke bygging, må besvares før ekte data): skal revisjonsloggen ha gammel og ny verdi, og hvordan skal innsyn, retting og sletting dekke loggen?
