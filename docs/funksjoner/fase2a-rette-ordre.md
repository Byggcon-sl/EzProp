# Funksjon: Rette en ordre etter at den er lagret

- **Fase:** 2a – Rapporten på PC, delen «Fra Ståles svar 12.11.2026», første gjenstående punkt (T1)
- **Modul:** kjerne (`src/core/orders`, `src/core/audit`), siden `/ordre/[id]`
- **Branch:** `rette-ordre-etter-lagring` (bygger på `main`)
- **Status:** klar for bygging, rettet etter forhåndsvurdering runde 1 (12.11.2026, prosjektleder)
- **Kilde:** `docs/kartlegging/svar-fra-stale-2026-11-12.md`, T1 (spørsmål 60): «ja, full redigeringstilgang. alltid». Også etter at ordren er blitt oppdrag. Endrer A55 og A87.
- **Støtter hovedmål:**
  - **De ansatte:** en skrivefeil i adressen eller bestilleren rettes på stedet. I dag må kontoret avvise ordren med «Feil registrering» og legge den inn på nytt (A55, A87).
  - **KI i bunnen:** hver retting lagres per felt (hvilket felt, hvem, når). Når KI senere lager ordreforslag fra e-post (`source = email`), viser loggen hvilke felt de ansatte måtte rette, og det kan måles.
  - **Færre reklamasjoner:** riktig bestiller og adresse fra start, og det står hvem som endret hva.

## Problem
En ordre kan ikke endres etter lagring (A55), og bestilleren kan ikke kobles etterpå (A87). Feil rettes ved å avvise og lage ny ordre. Det gir doble ordre i listen, ekstra arbeid for kontoret, og ingen sporbar sammenheng mellom den gale og den riktige. Ståle har sagt at alle skal kunne rette alltid.

## KI i bunnen
- **Ingen nytt KI-kall i denne oppgaven.** Retting er en ren skjemaendring; det finnes ingen tekst for KI å foreslå her, og en KI som retter ordren selv er ikke ønsket (den ansatte har siste ord).
- **Data for KI senere:** revisjonsloggen får én rad per lagring med listen over feltkoder som ble endret (`changedFields`). Når e-post-til-ordre kommer (krok A1), kan treffprosenten for KI per felt regnes ut fra denne loggen, uten personopplysninger.
- Ingen verdier fra ordren (adresse, navn, matrikkel) skrives i loggen, og ingenting sendes til KI. Alt KI-arbeid går fortsatt gjennom `src/core/ai`.

## Brukerhistorier
- Som **kontor** vil jeg **rette adressen, matrikkelen eller bestilleren på en lagret ordre** slik at **jeg slipper å avvise den og legge den inn på nytt**.
- Som **takstmann** vil jeg **rette en ordre også etter at den er blitt oppdrag** slik at **ordren stemmer med det vi faktisk fikk bestilt**.
- Som **leder** vil jeg **se hvem som har endret ordren og når** slik at **jeg kan følge opp feil**.

## Omfang
**Med:**
1. **Tjenesten `updateOrder(actor, organizationId, orderId, input, expectedRowVersion)`** i `src/core/orders`:
   - `requireOrganizationAccess(..., "assignment.edit")` først, samme rettighet som å legge inn ordre (A249). Filtrerer på `grant.organizationId`; fremmed, ukjent, slettet eller ugyldig id gir `AccessDeniedError`.
   - Felt som kan rettes (de samme som på «Ny ordre»): mottatt, ekstern referanse, hvem som bestilte (tekst), kobling til kontakt (firma følger kontakten, som ved oppretting), adresse, gnr, bnr, snr, borettslag/sameie, egenerklæring mottatt. Samme Zod-regler som `orderInputSchema` (gjenbruk, ikke kopi).
   - Virker for alle statuser: mottatt, gjort om til oppdrag og avvist (A250). Status, avvisningsgrunn, `assignment_id`, `source` og `requested_report_type` kan ikke endres her.
   - Låser raden (`FOR UPDATE`) og avviser lagring hvis `row_version` ikke er lik det skjemaet ble åpnet med: `OrderChangedError` («Ordren er endret av en annen. Last siden på nytt.») (A253). `row_version` finnes alt i `baseColumns` og øker ved hver endring, også ved avvisning og konvertering.
   - Kobling til en kontakt fra en annen organisasjon, en ukjent eller en myk-slettet kontakt gir `ContactNotFoundError`, og ingenting endres (samme sjekk som ved oppretting).
   - Ingen endring i feltene gir ingen lagring og ingen logglinje.
   - Skriver revisjonsloggen i samme transaksjon: `entityType: "order"`, `action: "update"`, `changes: { changedFields: [...] }` med feltkodene (`addressText`, `gnr`, …), fast rekkefølge. Ingen verdier for noe felt, samme regel for alle. Aldri adresse, navn, matrikkel, borettslag eller ekstern referanse som verdi (A252).
   - `getOrder` gir også `rowVersion` (versjonen er ikke et sporingsfelt; kommentaren i `getOrder` oppdateres), slik at skjemaet sender den med.
   - Hendelsen `order.updated` (`data: { orderId, changedFields }`) via `recordEvent`.
2. **Endringsloggen på ordren:** `listOrderHistory(actor, organizationId, orderId)` i `src/core/orders` (lesing med `organization.read`; leser `audit_log` filtrert på `grant.organizationId`, `entity_type = 'order'` og `entity_id`; navnet på den ansatte med left join som `listAuditEvents`). Viser alle rader for ordren uten filter per handling (opprettet, rettet, avvist, gjort om), nyeste først. Én enkel etikett per handling pluss `orderFieldLabel` for rettinger; ingen egen visning per handlingstype.
3. **Skjermen `/ordre/[id]`:** knappen **«Rett ordren»** (når `canEditOrders`, alle statuser) åpner skjemaet på samme side, forhåndsutfylt, med kontaktvelgeren som på «Ny ordre». «Lagre» går tilbake til visningen med beskjeden «Ordren er rettet.» «Avbryt» lukker uten lagring. Under ordren: delen **«Endringer»** med én linje per hendelse: dato og klokkeslett, navn, og hva (for eksempel «Rettet: adresse, gårdsnummer»). Feltkodene får norske etiketter ett sted (`orderFieldLabel`).
   - For en ordre som er gjort om, står en kort linje over skjemaet: «Oppdraget endres ikke. Eiendom og bestiller på oppdraget rettes på oppdraget.» Lenken til oppdraget finnes alt på ordresiden og gjenbrukes; ingen ny visningslogikk (A251).
4. **Server action** `updateOrderAction` i `src/app/(ansatt)/ordre/actions.ts`, samme mønster som de andre (ikke-uuid gir `NO_ACCESS`; logglinjer uten skjemaverdier).
5. **Beslutningene:** A55 og A87 får en linje om at de er endret av T1 (12.11.2026). Nye beslutninger A249–A253 i `docs/09-apne-sporsmal.md`, merket «lett å endre» / «dyrt å endre».
6. **Dokumenter:** domenemodellen 4.3 (ordren kan rettes, loggen), ordlisten (`updateOrder`, `OrderChangedError`, `changedFields`, `listOrderHistory`), planen krysses av, versjon 0.10.0 → 0.10.1.

**Ikke med (bevisst utelatt):**
- Endring av oppdraget når ordren rettes (A251). Oppdragets eiendom og parter har egne skjermer.
- Nytt notatfelt på ordren. Finnes ikke i datamodellen, og et fritt notat blir stedet der personopplysninger fra e-posten havner (som i fase 2a-manuell ordre).
- Bytte av oppdragstype eller ønsket rapport: det finnes bare `condition_report`.
- Angre en avvisning eller en konvertering, eller endre status.
- Gamle og nye verdier i loggen, for alle felt (A252). Kan legges til senere.
- Retting uten nett (ordre er en kontoroppgave med nett, som oppretting).
- KI-forslag til retting.
- Søk og dublettvarsel (T2 og T3, egne punkter).

## Tilgang
| Rolle | Se ordre og endringer | Rette |
|---|---|---|
| takstmann | ja | ja, når `access.inspectors_edit_all` er på (i dag på) |
| kontor | ja | ja |
| leder | ja | ja |
| admin | ja | ja |

All sjekk i `src/core/access` via `requireOrganizationAccess`. Ingen tilgangslogikk i siden; `canEditOrders` styrer bare visning av knappen.

## Data
Ingen migrering. Bruker `orders` og `audit_log` som de er. Nye faste koder: handlingen `update` på `order` i revisjonsloggen og hendelsen `order.updated`. Feltkodene i `changedFields` er navnene på feltene i koden og endres aldri (regel 6).

## Skjermer
PC først, må virke i iPad-størrelse. Før: avvis + ny ordre (rundt 15 felt og 4 trykk). Etter: «Rett ordren», rett feltet, «Lagre» (2 trykk + skrivingen).

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] En mottatt, en gjort om og en avvist ordre kan rettes, og endringen vises etter lagring.
- [ ] Bestilleren kan kobles til en kontakt, byttes og fjernes etter lagring; firmaet følger kontakten.
- [ ] Status, avvisningsgrunn og oppdragskobling endres ikke, og oppdraget er uendret etter retting av en gjort-om ordre.
- [ ] Ugyldige verdier gir de samme norske feilmeldingene som «Ny ordre».
- [ ] Lagring etter at en annen har endret ordren (også etter avvisning eller konvertering) gir «Ordren er endret av en annen. Last siden på nytt.» og ingen endring. Første retting rett etter oppretting godtas.
- [ ] Kobling til kontakt fra annen organisasjon, ukjent eller slettet kontakt gir `ContactNotFoundError`, og ingenting endres.
- [ ] Revisjonsloggen får én rad med feltkodene; ingen adresse, navn, matrikkel eller ekstern referanse i loggen eller hendelsen (test som leter etter verdiene).
- [ ] Lagring uten endring gir ingen logglinje.
- [ ] «Endringer» på ordresiden viser hvem, når og hvilke felt, nyeste først.
- [ ] Rettighetsmatrisen: takstmann med innstillingen på/av, kontor, leder, admin, bruker uten ansattrad.
- [ ] Bruker i annen organisasjon får ikke tilgang: `expectTenantIsolation` for `updateOrder` og `listOrderHistory`.
- [ ] Virker på iPad-størrelse (e2e: ny ordre → rett adresse → «Endringer» viser linjen; på `pc` og `ipad`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A249 (lett å endre):** retting krever `assignment.edit`, samme som å legge inn ordre. I praksis alle ansatte i dag. Ståle sa «full redigeringstilgang», og rettigheten finnes allerede.
- **A250 (lett å endre):** alle statuser kan rettes, også avvist («alltid»). Status og grunn rettes ikke her.
- **A251 (lett å endre):** retting av ordren endrer ikke oppdraget. Ordren er bestillingen slik den kom; oppdraget har egen eiendom og egne parter som kan ha blitt rettet der. Å skrive over dem stille kan gi feil i rapporten.
- **A252 (dyrt å endre for rettinger som alt er gjort):** loggen har bare feltkoder, ingen verdier for noe felt. Følger regelen fra manuell ordre (logg og hendelser får aldri adresse, navn eller matrikkel). Verdier kan legges til senere, men ikke for gamle rettinger.
- **A253 (lett å endre):** samtidige rettinger stoppes med sjekk av `row_version`, ikke «siste vinner». Ingen stille overskriving. `updated_at` er valgt bort: databasen lagrer mikrosekunder, en JS-dato bare millisekunder, så likhetssjekken ville avvist ekte rettinger.

## Forhåndsvurdering runde 1 (12.11.2026)
- **Godtatt fra test-leder:** `row_version` i stedet for `updated_at` (alvorlig, se A253); `getOrder` gir `rowVersion`; eget kriterium for `ContactNotFoundError` ved retting. Testplanen til test-leder følges.
- **Godtatt fra forenkler:** ingen `from`/`to` i loggen (bare `changedFields`, samme regel for alle felt); historikken uten filter og uten egen visning per handling; eksisterende lenke til oppdraget gjenbrukes.
- **Uenighet avgjort:** test-leders testplan ber om `from`/`to` for mottatt og egenerklæring. Forenkler vinner: ingen akseptkriterier krever det, og «hvem, når, hva» oppfylles av `changedFields`. Testen sjekker i stedet at loggen bare har `changedFields`.
- **Beholdt:** versjonssjekken, hendelsen `order.updated`, rettighetsmatrisen og `expectTenantIsolation` for begge spørringene (regel 2).

## Roller
utvikler (kjerne + side + action), testskriver (i parallell: tilgang, isolasjon, logg uten personopplysninger, e2e), sikkerhet-personvern (gjennomgang av loggens innhold og rettigheten). Ikke arkitekt, ux, ui, fag eller ki-ansvarlig: ingen ny arkitektur, skjemaet gjenbrukes, og KI brukes ikke direkte.

## Åpne spørsmål
- Ingen som stopper. A252 står som «dyrt å endre» slik at Ståle ser den.
