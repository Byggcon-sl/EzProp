# ADR 0013 – Reklamasjonskoblingen: egen koblingstabell, og oppdrag og kobling i én transaksjon

Dato: 17.11.2026. Status: vedtatt av agentene i autonom modus (A419–A430 i `docs/09-apne-sporsmal.md`); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-reklamasjonskobling.md`. Kilde: Ståles svar 10.11.2026 nr. 38 («Koblingen oppdrag → henvendelse/reklamasjon → ny befaring lages sammen med reklamasjonsskjemaet, før første ekte rapport») og Ståle 27.10.2026 (bare leder og admin ser reklamasjonssaker). Bygger på ADR 0011.

Støtter hovedmålene: **færre reklamasjoner** (hele kjeden fra opprinnelig oppdrag via saken til ny befaring er data, så vi senere kan telle og lære av sakene), **de ansatte** (leder lager oppdraget for ny befaring fra saken på én skjerm, uten avskrift) og **KI i bunnen** (kjeden og typeovergangen er strukturerte koder uten fritekst, klare for robusthetsråd i fase 4; ingen KI-kall nå).

## Beslutninger

1. **Kjeden leses i én retning:** opprinnelig oppdrag = `claims.assignment_id` → sak (`claims`) → ny befaring = `claim_reinspections.assignment_id`. Det opprinnelige oppdraget lagres ikke en gang til i koblingen.
2. **Koblingen er en egen tabell, `claim_reinspections`** (A420), med hele `baseColumns`, `claim_id`, `assignment_id` og påkrevd `created_by` (ansatt-id, som i `claims`). Ingen fritekst. `assignments` får ingen ny kolonne.
3. **Sammensatte fremmednøkler** (`organization_id`, `claim_id`) mot `claims_organization_id_id_idx` og (`organization_id`, `assignment_id`) mot `assignments_organization_id_id_idx`. Databasen avviser dermed en rad som blander to organisasjoner. Ingen `ON DELETE CASCADE` (regel 3).
4. **Et oppdrag hører til høyst én aktiv kobling:** unik delindeks på (`organization_id`, `assignment_id`) der `deleted_at is null`. En sak kan ha flere nye befaringer. Det lages ingen egen unik indeks på (`organization_id`, `claim_id`, `assignment_id`); den over dekker den (F5). Vanlig indeks på (`organization_id`, `claim_id`) for oppslag fra saken.
5. **At det nye oppdraget ikke er sakens opprinnelige oppdrag, sjekkes i tjenesten** (`reinspection_not_original`) og testes. En CHECK-regel kan ikke lese en annen tabell, og en trigger ville lagt regel i databasen som ikke kjører likt andre steder.
6. **Myk sletting i tre tilfeller:** (a) «Fjern koblingen» setter `deleted_at` på koblingen; oppdraget står. (b) `removeClaim` fjerner sakens aktive koblinger i samme transaksjon og med samme `deleted_at` som saken (A424), slik at en senere gjenoppretting av saker kan finne dem igjen. (c) Havner det nye oppdraget i papirkurven, står koblingen urørt: den vises ikke (all lesing joiner mot oppdrag som ikke er fjernet), men den unike indeksen sperrer fortsatt (A425). Gjenopprettes oppdraget, vises koblingen igjen.
7. **«Henvendelse» er en ny sakstype, `inquiry`,** i samme tabell (A419). CHECK-regelen `claims_claim_type_check` byttes med drop og add i migrering `0036`; listen er bare utvidet, så eksisterende rader består. Ingen kode endres eller arkiveres (regel 6). `inquiry` står først i `CLAIM_TYPES` fordi den står først i typevalget; rekkefølgen i listen er visning, ikke betydning. Henvendelser telles ikke som reklamasjoner i tallet for hovedmålet.
8. **Overgangen mellom sakstyper lagres i revisjonsloggen** (A429): raden for `updateClaim` får `claimTypeFrom` og `claimTypeTo` (faste koder) når typen endres. Ingen ny tabell og ingen ny hendelse.
9. **Oppdrag og kobling lages i én transaksjon ved at `createAssignment` tar kallerens transaksjon** (A423). `CreateAssignmentOptions` blir `{ now?, executor?, propertyId? }`, og `CreateAssignmentInput` får valgfritt `internalNote`:
   - Med `executor` kjører alle stegene i kallerens transaksjon. `createAssignment` åpner ingen egen og fanger ikke 23505 på engangsnøkkelen (transaksjonen er da avbrutt); `createReinspectionAssignment` fanger den utenfor transaksjonen, leser på nytt og følger regelen `reinspection_creation_key_reuse`.
   - Tilgangssjekken `assignment.edit` gjøres fortsatt inne i `createAssignment`. Det finnes ingen eksportert variant uten tilgangssjekk.
   - `propertyId` slås opp med `grant.organizationId` og kommer aldri fra skjemaet.
   - Uten `options` virker «Nytt oppdrag» som før.
10. **Importretningen er `core/claims` → `core/assignments`,** aldri motsatt. `core/assignments` vet ikke at saker finnes. Det nye oppdraget er et vanlig oppdrag: `assignment.created` og revisjonsraden er helt like et «Nytt oppdrag» (ingen `claimId`, ingen egen `source`, ingen ny oppdragstype eller status).
11. **Hendelser og revisjonslogg lekker ikke saken via det nye oppdraget** (A426). To nye faste koder i `EVENT_TYPES`: `claim_reinspection.linked` og `claim_reinspection.unlinked`. `events.assignment_id` er sakens **opprinnelige** oppdrag (som for `claim.registered`); det nye oppdragets id står bare i `data` (`{ claimId, reinspectionId, reinspectionAssignmentId }`). Revisjonsraden har `entityType: "claim_reinspection"`, aldri `"assignment"`, så `readBookingHistory` ikke viser den. `claim.*` og `claim_reinspection.*` krever `claims.read` ved lesing; planpunktet «Historikk på oppdraget» filtrerer dem bort for andre.
12. **Tilgang uten nye rettigheter:** lesing krever `claims.read`, endring `claims.manage`, og å lage oppdraget også `assignment.edit`. «Finnes ikke» er `AccessDeniedError` med samme svar for uten tilgang, ukjent id, annen organisasjon og fjernet sak, oppdrag eller kobling. Admin har alltid tilgang (regel 11). Innstillingen `access.inspectors_edit_all` påvirker ikke dette.
13. **`claims` og `claim_reinspections` er aldri med i synksettet til enhetene** (A430). Takstmannen skal ikke ha radene på iPaden, heller ikke skjult.
14. **Grensesnittet** står i `src/core/claims/contract.ts` (`CreateReinspectionAssignment`, `ListReinspectionCandidates`, `LinkReinspectionAssignment`, `UnlinkReinspectionAssignment`, `ListReinspectionsForClaim`, `GetClaimForReinspectionAssignment`, regelkodene `REINSPECTION_RULES`) og i `src/core/assignments/booking/contract.ts` (utvidelsen av `createAssignment`). Feilene `ReinspectionIsOriginalAssignmentError` og `ReinspectionAlreadyLinkedError` står i `src/core/claims/errors.ts`.

## Begrunnelse

- **Egen tabell holder saken borte fra oppdraget.** `assignments` leses av alle takstmenn, synkes til iPad i fase 2b og står i mange spørringer. En kolonne der ville krevd at hvert lesested husket å ta den bort for dem uten `claims.read`. En egen tabell som bare `src/core/claims` leser, feiler lukket: glemmer noen den, vises ingenting.
- **Egen tabell gir flere befaringer per sak og historikk.** En tilleggsbefaring er vanlig. Myk sletting på koblingen viser også at en kobling ble fjernet og av hvem.
- **Én transaksjon gir aldri et oppdrag uten kobling.** To transaksjoner etter hverandre ville etterlatt et løst oppdrag med brukt oppdragsnummer hvis koblingen feilet, og leder ville ikke sett hvorfor.
- **`executor` er mønsteret kjernen alt bruker** (`recordEvent`, `recordAuditEvent`, `nextAssignmentNumber` tar `DbExecutor`). Én `createAssignment` betyr ett sted for nummer, selskap, team, hendelse og revisjonslogg.
- **Hendelsen på det opprinnelige oppdraget** gjør at historikken for det nye oppdraget er ren uten filter, mens historikken for det opprinnelige oppdraget allerede må filtrere `claim.registered`.

## Det vi vet at dette koster

- `createAssignment` har nå to veier for feilhåndtering av engangsnøkkelen (med og uten `executor`). Begge har tester, også samtidige kall.
- En kaller som sender `executor`, har ansvaret for å fange 23505 utenfor transaksjonen. Det står i kontrakten, og i dag er det én kaller.
- Regelen «ikke det opprinnelige oppdraget» håndheves ikke av databasen. Den er dekket av tjenesten og en test, og alle skrivinger går gjennom `src/core/claims`.
- Et oppdrag i papirkurven kan ikke knyttes til en annen sak før det er gjenopprettet og koblingen fjernet. Det er sjeldent, og alternativet (å slippe indeksen) ville gitt to saker på samme oppdrag ved gjenoppretting.
- Tall om nye befaringer må joine tre tabeller. Det er lesing for statistikk i fase 4, ikke i arbeidsflyten.

## Forkastet

- **Kolonne `assignments.reinspection_of_claim_id`:** lekker saken til alle som leser oppdraget og til synken, tåler bare én sak per oppdrag uten historikk, og krever filter på hvert lesested.
- **Kolonne `claims.reinspection_assignment_id`:** bare én ny befaring per sak, og ingen spor når koblingen byttes.
- **Egen tabell `inquiries` for henvendelser:** to tabeller, to skjemaer og en flytting av rader når henvendelsen blir et krav. Én tabell med type gir overgangen som en vanlig endring.
- **Lagre opprinnelig oppdrag også i koblingen:** to kilder for samme opplysning som kan komme i utakt.
- **Ny oppdragstype eller merke «ny befaring» på oppdraget:** viser takstmannen at det finnes en sak (Ståle 27.10.2026). Tas opp igjen med reklamasjonsmappen i fase 4 hvis Ståle vil.
- **Egen funksjon `createAssignmentInTransaction` uten tilgangssjekk, eksportert fra `core/assignments`:** en vei rundt `assignment.edit` som andre kan ta i bruk.
- **To transaksjoner med opprydding ved feil:** oppryddingen kan selv feile, og nummeret er brukt.
- **Savepoint rundt `createAssignment` for å fange 23505 inne i kallerens transaksjon:** mer å forstå enn å fange feilen utenfor og lese på nytt, og samme resultat.
- **Trigger eller CHECK med funksjon for «ikke det opprinnelige oppdraget»:** regel i databasen som ikke kan testes som de andre reglene.
- **Egen tabell for typeoverganger:** revisjonsloggen har alt tidspunkt, hvem og feltnavn; to koder til er nok.
- **`ON DELETE CASCADE` fra sak til kobling:** ingenting slettes permanent (regel 3).

## Følger

- Migrering `0036_reklamasjonskobling`: ny tabell med indekser og fremmednøkler, og byttet CHECK-regel på `claims.claim_type`. Ingen rader endres. Nummeret sjekkes mot main rett før merge.
- Ny tabell med `organization_id`: `tests/tenant-tables.ts` får radbygger, `tests/factories.ts` får `createClaimReinspection` og tabellen i `RESET_TABLES` (før `claims` og `assignments` i rekkefølgen for tømming).
- Ingen ny avhengighet og ingen ny rettighet.
- Personvernerklæringen, domenemodellen 4.13 og 4.9, ordlisten og testdataene oppdateres i samme oppgave.
- **Dyrt å endre:** punkt 1–4 (datamodell), kodene `inquiry`, `claim_reinspection.linked` og `claim_reinspection.unlinked`, `entityType` `claim_reinspection` og punkt 9 (kontrakten for `createAssignment`). **Lett å endre:** hvilke felt som kopieres, kandidatlisten, rekkefølgen i typevalget, punkt 6 b og c, og punkt 8.
