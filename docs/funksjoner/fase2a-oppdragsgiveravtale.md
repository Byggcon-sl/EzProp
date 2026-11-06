# Funksjon: Avtale med oppdragsgiver (for eksempel Fremtind)

- **Fase:** 2a – Rapporten på PC (punktet «Avtale med oppdragsgiver» under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/agreements`), sidene `/admin/avtaler` og `/oppdrag/[id]`
- **Branch:** `fase2a-oppdragsgiveravtale` (bygger på `main`)
- **Status:** klar til bygging (06.11.2026, prosjektleder; rettet etter forenkler og test-leder runde 1)
- **Dato:** 06.11.2026
- **Støtter hovedmål:** Tid: avtalen foreslås på oppdraget når bestilleren hører til avtalefirmaet, så takstmannen trykker én gang i stedet for å huske hvilke premisser og hvilket oppsett kunden skal ha. Reklamasjoner: premisseteksten for avtalen ligger ett sted og blir ikke glemt eller skrevet ulikt fra rapport til rapport. KI først: se under.

## Problem
Byggcon har faste oppdragsgivere (i dag bare Fremtind) som skal ha egen premissetekst og eget utseende på rapporten (Ståle 23.10, 24.10 og 25.10.2026, spørsmål 11 og 14: «Første versjon: egen rapportprofil og premissetekst per avtale. Egne kontrollpunkter senere.»). I dag finnes ingen avtale i EzProp. Lar vi være, må takstmannen huske dette selv for hver rapport, og PDF-punktet senere har ingen avtale å hente premissene og profilen fra.

## KI først
Ikke KI, men automatikk: systemet foreslår avtalen ut fra hvilket firma bestilleren hører til, og takstmannen godtar med ett trykk. Valget er en fast kobling (firma → avtale), ikke et skjønn, så KI trengs ikke. Senere kan KI lese bestillings-e-posten og foreslå avtalen før oppdraget lages (e-post-til-ordre, eget planpunkt).

## Brukerhistorier
- Som **admin** vil jeg **legge inn avtalen med Fremtind med periode og premissetekst** slik at **alle rapporter for Fremtind får riktige premisser**.
- Som **takstmann** vil jeg **se et forslag om avtale på oppdraget når bestilleren er fra Fremtind** slik at **jeg slipper å huske det**.
- Som **kontor** vil jeg **velge eller fjerne avtalen på oppdraget for hånd** slik at **feil forslag kan rettes**.

## Omfang
**Med:**
1. **Tabell `client_agreements`** (migrering `0021_oppdragsgiveravtale.sql` via `pnpm db:generate`):
   - `id`, `organization_id`, `firm_id` (påkrevd, sammensatt fremmednøkkel `(organization_id, firm_id)` → `firms`), `name` (påkrevd, 1–120 tegn), `valid_from` (dato, påkrevd), `valid_to` (dato, kan være tom = løpende; må være lik eller etter `valid_from`, sjekk i Zod og i databasen), `premise_text` (tekst, kan være tom, maks 10 000 tegn), `report_profile_code` (tekst, kan være tom, maks 60 tegn, A109), `created_at`, `updated_at`, `deleted_at`.
   - Unik `(organization_id, id)` for sammensatte fremmednøkler. Indeks på `(organization_id, firm_id) WHERE deleted_at IS NULL`.
2. **Kolonne `assignments.client_agreement_id`** (kan være tom), sammensatt fremmednøkkel `(organization_id, client_agreement_id)` → `client_agreements (organization_id, id)`, navn `assignments_client_agreement_fk`.
3. **Kjernen `src/core/agreements`** (all tilgang via `requireOrganizationAccess`, alle spørringer filtrerer på `grant.organizationId`):
   - `listAgreements` og `getAgreement` (`organization.read`), med firmaets navn. Slettede vises ikke i listen.
   - `createAgreement`, `updateAgreement`, `deleteAgreement` (myk sletting) med `organization.manage` (admin, A108). Firmaet må finnes og ikke være slettet i samme organisasjon. Revisjonslogg `entityType: "client_agreement"` med `create`, `update`, `delete`; bare id-er og feltnavn, ikke premisseteksten i loggen.
   - `updateAgreement` og `deleteAgreement` på en avtale som allerede er slettet gir `NotFoundError`, og ingen ny rad i revisjonsloggen.
   - `isAgreementActive(agreement, today)`: `valid_from <= today` og `valid_to` tom eller `>= today`. `today` er en dato-streng fra `todayInOslo(now)` (`src/shared/lib/dates.ts`).
   - `setAssignmentAgreement(actor, organizationId, assignmentId, agreementId | null, now = new Date())` med `assignment.edit`. Avtalen hentes med `grant.organizationId`; finnes den ikke i organisasjonen, gir det `NotFoundError` (avvises i kjernen, ikke bare av databasen). Slettet, utløpt eller ikke påbegynt avtale avvises med norsk feilmelding («Avtalen gjelder ikke i dag.» / «Avtalen er fjernet.»). `null` (fjerne) er alltid lov. Oppdragsraden låses (`FOR UPDATE`). Hendelsen `assignment.agreement_changed` med `{ fromAgreementId, toAgreementId }` og revisjonslogg, bare når verdien faktisk endres.
   - `suggestAgreementForAssignment(actor, organizationId, assignmentId, now = new Date())`: finner bestillerens firma bare fra `orders.ordered_by_firm_id` via `assignments.order_id`. Mangler ordren eller firmaet, eller er firmaet slettet, gis ikke forslag, og avtalen velges for hånd. Forslag gis bare når oppdraget ikke har avtale, og firmaet har **nøyaktig én** avtale som ikke er slettet og gjelder i dag (A110).
   - `getAssignment` tar med avtalen (id, navn, periode, `deletedAt`) også når den er slettet eller utløpt.
4. **Admin-sidene `/admin/avtaler`, `/admin/avtaler/ny` og `/admin/avtaler/[id]`:** liste (navn, firma, periode, «Utløpt» som merke), skjema med firma (velger fra firmaregisteret), navn, gyldig fra/til, premissetekst (stort tekstfelt) og rapportprofil (kort tekstfelt med hjelpetekst «Navn på PDF-profilen. Brukes når PDF-en kommer.»). «Fjern avtalen» med bekreftelse (myk sletting). Lenke fra admin-menyen.
5. **Oppdragssiden `/oppdrag/[id]`:** kortet «Avtale» under «Utstedende selskap»:
   - Avtale satt: navnet og perioden, og «Bytt» / «Fjern». En slettet eller utløpt avtale vises med merket «Slettet» eller «Utløpt» (A111).
   - Ingen avtale, men forslag finnes: «Forslag: Fremtind (bestilleren er fra Fremtind)» og knappen «Bruk avtalen».
   - Velger: bare avtaler som ikke er slettet og gjelder i dag (`todayInOslo`), pluss «Ingen avtale». Kjernen avviser det samme (punkt 3).
6. **Tester** (testskriver). Alle tester som avhenger av dagen, sender inn fast `now`.
   - Enhet (uten database): `agreementSchema` avviser `valid_to` før `valid_from` med norsk melding og godtar tom `valid_to`; grenser: tomt navn, 121 tegn navn, 10 001 tegn premissetekst og 61 tegn rapportprofil avvises, 120 / 10 000 / 60 godtas. `isAgreementActive`: dagen før start, startdagen, siste dag, dagen etter, tom `valid_to`.
   - Kjernen: admin oppretter, endrer og myk-sletter (`deleted_at` satt, raden finnes, ikke i listen); takstmann, kontor og leder får `AccessDeniedError` på create/update/delete; admin får lov, også uten sertifisering; alle roller kan liste og hente; firma fra annen organisasjon eller slettet firma avvises; revisjonsloggen for create/update/delete har bare id-er og feltnavn (premisseteksten finnes ikke i loggraden); databasen avviser `valid_to < valid_from` uten Zod (CHECK); update/delete av slettet avtale gir `NotFoundError` og ingen ny loggrad.
   - `setAssignmentAgreement`: sette, bytte, fjerne (hendelsen `assignment.agreement_changed` med riktige `fromAgreementId`/`toAgreementId`, én loggrad); samme verdi to ganger gir ingen ny hendelse eller loggrad; slettet, utløpt og ikke påbegynt avtale avvises; avtale fra annen organisasjon avvises i kjernen; takstmann kan velge med `access.inspectors_edit_all` på og får `AccessDeniedError` når den er av; kontor, leder og admin kan alltid; hendelseskoden står i `EVENT_TYPES`.
   - Forslaget: én gyldig avtale gir forslag; ingen forslag når det ikke finnes avtale, det finnes to gyldige, avtalen er utløpt, ikke startet, slettet, oppdraget har avtale, oppdraget mangler ordre, ordren mangler firma, eller firmaet er slettet.
   - Tenant-isolasjon: `expectTenantIsolation` for `listAgreements`, `getAgreement`, `suggestAgreementForAssignment`, `getAssignment`, `createAgreement`, `updateAgreement`, `deleteAgreement` og `setAssignmentAgreement`. Fremmednøkkeltest: databasen nekter `firm_id` og `client_agreement_id` fra en annen organisasjon. `client_agreements` føres i `tests/tenant-tables.ts` med radbygger, og `createClientAgreement` legges i `tests/factories.ts`.
   - Visning: komponent- eller enhetstest for kortet «Avtale» som viser merket «Utløpt» og merket «Slettet».
   - e2e (PC og iPad-størrelse), én ny fil `e2e/fase-2a-oppdragsgiveravtale.spec.ts`: admin lager avtale for et firma, ordre med bestiller fra firmaet gjøres om til oppdrag, forslaget vises, «Bruk avtalen» setter den, «Fjern» tar den bort; til-dato før fra-dato gir norsk feilmelding; en bruker som ikke er admin ser ikke «Lagre avtalen» og kan ikke lagre på `/admin/avtaler`. Uten nett er ikke med (oppdragssiden er ikke en del av befaringen uten nett).
7. **Dokumenter og versjon:** `docs/05-domenemodell.md` (4.3 «Bygget i fase 2a», hendelseslisten, endringsloggen, `report_profile_code` i stedet for `report_profile_id` inntil videre), ordlisten (`client agreement`, `report_profile_code`), planen krysses av, `package.json` 0.3.1 → 0.3.2, A108–A112 i `docs/09-apne-sporsmal.md`, admin-raden i rollematrisen nevner avtaler (står der allerede).

**Ikke med (bevisst utelatt):**
- PDF, tabellen `report_profiles` og bruk av premisseteksten i rapporten (kommer med PDF-punktene). Teksten lagres bare.
- Kopi av premissetekst eller profil til rapporten eller utgivelsen ved publisering.
- `price_note`, `price_list_id`, prislister og `notes` på avtalen (fase 3 og senere).
- Egne kontrollpunkter eller egen malversjon per avtale (senere, `template_version_id`).
- Krav om sertifisering per avtale, kontaktpersoner på avtalen og volum per avtale (funksjonskartet; senere).
- Automatisk setting av avtalen når ordren gjøres om til oppdrag. Det blir et forslag på oppdragssiden (A110).
- Avtale i oppdragslisten/arbeidskøen og filter på avtale.
- Liste over avtaler på firmasiden.
- Advarsel før publisering om utløpt avtale (hører til sperrer og advarsler).
- Ferdige premissetekster i seed-data. Ingen tekst fra NS 3600, IVIT eller SmartTakst; admin skriver teksten selv.

## Tilgang
| Rolle | Se | Endre avtalen | Velge avtale på oppdraget |
|---|---|---|---|
| takstmann | ja (`organization.read`) | nei | ja (`assignment.edit`, når `access.inspectors_edit_all` er på) |
| kontor | ja | nei | ja |
| leder | ja | nei | ja |
| admin | ja | ja (`organization.manage`) | ja |

Ingen ny rettighet. Ingen id fra skjemaet brukes til filtrering; avtale, firma og oppdrag hentes alltid med `grant.organizationId`. Admin stenges ikke ute.

## Data
- Ny tabell `client_agreements` (se Omfang 1). Føres i `tests/tenant-tables.ts`.
- Ny kolonne `assignments.client_agreement_id`.
- Ny hendelseskode `assignment.agreement_changed`.
- Revisjonslogg `client_agreement`.
- Ingen nye faste koder (`key`). `report_profile_code` er fritekst til `report_profiles` finnes (A109).

## Skjermer
- PC (admin): `/admin/avtaler` med liste og skjema. Hovedhandling: «Lagre avtalen».
- PC og iPad (oppdrag): kortet «Avtale». Hovedhandling: «Bruk avtalen». Trykk: 1 når forslaget er riktig (før: ingen støtte, takstmannen måtte huske det).

## Regler
Fast regel i koden (ikke mal-regel): forslag gis bare når bestillerens firma har nøyaktig én avtale som gjelder i dag (`valid_from <= i dag` og `valid_to` tom eller `>= i dag`, norsk dato) og oppdraget ikke har avtale.

## Akseptkriterier
- [ ] Admin kan opprette, endre og fjerne (myk sletting) en avtale med firma, navn, periode, premissetekst og rapportprofil.
- [ ] Andre roller kan se avtalene, men ikke endre dem.
- [ ] `valid_to` før `valid_from` avvises med norsk feilmelding.
- [ ] Oppdraget kan få avtale valgt for hånd, byttet og fjernet; hendelse og revisjonslogg kommer bare ved endring.
- [ ] Slettet, utløpt eller ikke påbegynt avtale kan ikke velges på oppdraget (kjernen avviser med norsk feilmelding).
- [ ] Takstmannen kan velge avtale bare når `access.inspectors_edit_all` er på.
- [ ] Forslaget vises når bestillerens firma har nøyaktig én gyldig avtale, og «Bruk avtalen» setter den med ett trykk.
- [ ] Slettet eller utløpt avtale på et oppdrag vises med merke.
- [ ] Bruker i annen organisasjon får ikke tilgang, verken ved lesing eller skriving, og id-er fra en annen organisasjon stoppes av databasen (test).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A108–A112)
- **A108:** Bare admin oppretter, endrer og fjerner avtaler (`organization.manage`); alle ser dem, og alle med `assignment.edit` kan velge avtale på oppdraget. Kilde: rollematrisen i domenemodellen (admin: «avtaler»), Ståle 23.10.2026 spørsmål 11 («flere kan legges til uten utvikler»). Endres i kjernen ved å bytte rettighet.
- **A109:** Rapportprofilen er foreløpig en kort tekst (`report_profile_code`) og ikke en kobling til `report_profiles`, fordi PDF-profilene ikke finnes ennå. Når PDF-punktet lager `report_profiles`, legges `report_profile_id` til og teksten brukes til å koble. Kilde: Ståle 25.10.2026 spørsmål 14, «det enkleste som virker». Endres i PDF-punktet.
- **A110:** Avtalen foreslås på oppdragssiden og settes ikke automatisk. Forslag bare når firmaet har nøyaktig én gyldig avtale. Feil avtale gir feil premisser i rapporten (reklamasjoner), og takstmannen skal kontrollere og godkjenne (KI først-prinsippet). Firma hentes bare fra ordrens bestillerfirma (`orders.ordered_by_firm_id`); megler-parten brukes ikke. Mangler firmaet, velges avtalen for hånd. Endres ved å sette avtalen ved «gjør om til oppdrag», eller ved å legge til megler-parten som reserve.
- **A111:** En utløpt eller slettet avtale blir stående på oppdrag som allerede har den, med merke. Oppdraget ble bestilt under avtalen, og den skal ikke byttes i stillhet. Nye valg viser bare gyldige avtaler, og kjernen avviser slettet, utløpt eller ikke påbegynt avtale ved nytt valg (færrest feil premisser). Kilde: domenemodellen 4.3, regelen om myk sletting. Endres i velgeren.
- **A112:** Premisseteksten lagres som ren tekst (maks 10 000 tegn) og logges ikke i revisjonsloggen (bare at feltet er endret). Ingen ferdige premissetekster legges i seed-data; admin skriver Byggcons egne. Kilde: CLAUDE.md regel 7 (egne formuleringer, ingen tekst fra NS 3600/IVIT/SmartTakst). Endres ved å legge til eget utkast merket «utkast, ikke godkjent av fagrådet».

## Roller
- **utvikler:** punkt 1–5 og 7.
- **testskriver** (i parallell, bare testfiler): punkt 6.
- **sikkerhet** (kort gjennomgang): ny tabell med `organization_id`, ny rettighetsbruk og sammensatte fremmednøkler.

Ingen arkitekt (tabell og kolonne etter kjent mønster fra kontakter og selskap), ingen UX/UI-rolle (enkle skjema og ett kort etter eksisterende mønster på admin- og oppdragssidene), ingen KI, ingen fagrolle (premisseteksten skrives av admin, ingen fagtekst lages).

## Byggingen deles i to biter som ikke henger sammen
- **Bit A (utvikler):** migrering, skjema, kjernen `src/core/agreements`, hendelseskode, `getAssignment` med avtalen, sidene, dokumenter, versjon.
- **Bit B (testskriver):** testene i punkt 6, skrevet mot kortet (funksjonsnavnene i punkt 3, hendelsen `assignment.agreement_changed`, `tests/tenant-tables.ts`).

## Endringer etter forhåndsvurdering (runde 1, prosjektleder 06.11.2026)
- **Forenkler kutt 1, tatt:** megler-parten som reserve er fjernet. Oppgaven sier «når bestilleren hører til avtalefirmaet», og det er `orders.ordered_by_firm_id`. Færre oppslag og mindre risiko for feil forslag. Test-leders punkt 3 om rekkefølge mellom ordre og megler faller dermed bort; det som står igjen er at slettet firma og manglende ordre/firma ikke gir forslag.
- **Forenkler kutt 2, ikke tatt:** CHECK-regelen på datoene beholdes, fordi `certifications` allerede har samme regel (`certifications_valid_range_check`). Forenkleren åpnet selv for det.
- **Test-leder 1:** `now` sendes inn i `setAssignmentAgreement` og `suggestAgreementForAssignment`, og dagen regnes med `todayInOslo(now)`.
- **Test-leder 2:** kjernen avviser utløpt og ikke påbegynt avtale, ikke bare slettet. Samme regel som velgeren.
- **Test-leder 4:** update/delete av slettet avtale gir `NotFoundError` og ingen loggrad.
- **Test-leder 5:** tenant-isolasjon også for skrivefunksjonene og `getAssignment`.
- Testplanen fra test-leder er tatt inn i punkt 6, inkludert visningstest for merkene og ekstra e2e-saker.

## Åpne spørsmål
- Ingen som stopper. A108–A112 kan endres av Ståle når han er tilbake.
