# Funksjon: Reklamasjonskoblingen (oppdrag → henvendelse eller reklamasjon → ny befaring)

- **Fase:** 2a – Rapporten på PC (punktet «Reklamasjonskoblingen» i `docs/07-utviklingsplan.md`)
- **Modul:** kjerne (`src/core/claims`, delen «Reklamasjoner» på `/oppdrag/[id]`, sidene under `/oppdrag/[id]/reklamasjoner`)
- **Branch:** `reklamasjonskobling` (bygger på `main`)
- **Status:** klar til bygging (17.11.2026, prosjektleder)
- **Dato:** 17.11.2026
- **Grunnlag:** svar 10.11.2026 nr. 38 («Koblingen oppdrag → henvendelse/reklamasjon → ny befaring lages sammen med reklamasjonsskjemaet, før første ekte rapport»), Ståle 27.10.2026 (bare leder og admin ser reklamasjonssaker), kortet `docs/funksjoner/fase2a-reklamasjoner.md` (A125–A129).
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** hele kjeden fra opprinnelig oppdrag via klagen til ny befaring lagres som data. Da kan vi telle hvor mange saker som krevde ny befaring, hva den kostet i tid, og senere lære hvilke punkter som gir saker.
  - **De ansatte:** leder lager oppdraget for ny befaring med ett trykk fra saken, med adresse, eiendom, kontor og selskap fylt ut. Ingen ny innskriving, og ingen leting etter hvilket oppdrag som hører til hvilken sak.
  - **KI i bunnen:** koblingen er strukturert grunnlag for KI senere (se under).

## Problem
En reklamasjon fører ofte til en ny befaring. I dag lages det nye oppdraget løst fra saken, og ingenting viser at det hører til en klage på et tidligere oppdrag. Da kan leder ikke se hele saken samlet, tiden på ny befaring blir ikke knyttet til reklamasjonen, og tallene for hovedmålet blir ufullstendige. Byggcon trenger også å føre **henvendelser** (kunden tar kontakt om noe i rapporten) som ikke er et krav ennå, men som kan bli det. Ståle sa ja til koblingen 10.11.2026 (nr. 38), og den skal finnes før første ekte rapport.

## KI i bunnen
- **Fra første dag gjør KI ingenting med sakene.** En reklamasjon er en juridisk sak leder fører selv, og friteksten kan inneholde helseopplysninger og navn. Det er for få saker til at et forslag har verdi. Ingen kall til `src/core/ai` i denne oppgaven.
- **Data som lagres for KI senere:** koblingen er strukturert og uten fritekst: opprinnelig oppdrag (`claims.assignment_id`), sakstype (`inquiry`, `complaint`, `insurance_claim`, `other`), utfall og datoer, og oppdraget for ny befaring (`claim_reinspections`). Når rapporter og kontrollpunkter finnes, kan KI gjennom `src/core/ai` (bak KI-porten, med logg i `ai_usage_log`) bruke dette til robusthetsråd før publisering (S2, fase 4) og til å foreslå hvilket punkt en sak gjelder. Friteksten i saken sendes aldri til KI uten vask (regel 14).

## Brukerhistorier
- Som **leder** vil jeg **føre en henvendelse fra en kunde på oppdraget** slik at **den ikke går tapt, også om den aldri blir en reklamasjon**.
- Som **leder** vil jeg **lage oppdraget for ny befaring rett fra saken** slik at **adresse og eiendom kommer med, og saken og befaringen henger sammen**.
- Som **leder** vil jeg **se på det nye oppdraget hvilken sak og hvilket oppdrag det kommer fra**, og **på saken hvilket oppdrag som er den nye befaringen**.
- Som **takstmann** skal jeg **ikke se reklamasjonssakene eller koblingen** (Ståle 27.10.2026). Jeg ser det nye oppdraget som et vanlig oppdrag.

## Omfang
**Med:**
1. **Ny sakstype `inquiry` («Henvendelse»)** i `CLAIM_TYPES` og i CHECK-regelen på `claims.claim_type`. Henvendelse er første trinn; leder kan endre typen til reklamasjon eller forsikringskrav når det blir et krav. Henvendelser telles ikke som reklamasjoner i tallet for hovedmålet (står i domenemodellen).
2. **Ny tabell `claim_reinspections`** (migrering, neste nummer etter `0035`): kobler en sak til oppdraget for ny befaring. Felter under «Data». Myk sletting. En sak kan ha flere nye befaringer (for eksempel en tilleggsbefaring); et oppdrag kan være ny befaring for høyst én aktiv sak.
3. **Tjenester i `src/core/claims`** (alle krever `claims.manage` for endring og `claims.read` for lesing, filtrerer på `grant.organizationId`, Zod-skjema i `schemas.ts`):
   - `createReinspectionAssignment(actor, organizationId, claimId, options)` – `claims.manage` **og** `assignment.edit`. Lager et nytt oppdrag med `createAssignment` fra `@/core/assignments`, fylt ut fra det opprinnelige oppdraget: adresse, gnr/bnr/fnr/snr, eiendom, borettslag, kontor, selskap og oppdragstype. Bestiller, parter, team, befaringsdato, pris, ordre og avtale kopieres **ikke** (leder eller kontoret fyller ut). Ansvarlig takstmann velges i skjemaet før lagring (påkrevd av `createAssignment`). Koblingen lagres i samme transaksjon. Tåler dobbelttrykk (engangsnøkkel, som «Nytt oppdrag»).
   - `linkReinspectionAssignment(actor, organizationId, claimId, assignmentNumber)` – knytter et oppdrag som alt finnes (søkt opp på oppdragsnummer) til saken. Oppdraget må være i samme organisasjon, ikke fjernet, ikke det opprinnelige oppdraget og ikke allerede ny befaring for en annen aktiv sak.
   - `unlinkReinspectionAssignment(actor, organizationId, reinspectionId)` – myk sletting av koblingen. Oppdraget blir stående.
   - `listReinspectionsForClaim(actor, organizationId, claimId)` og `getClaimForReinspectionAssignment(actor, organizationId, assignmentId)` (sak og opprinnelig oppdrag for visning på det nye oppdraget) – `claims.read`.
   - Fjernet sak, fjernet opprinnelig oppdrag eller sak i annen organisasjon gir «finnes ikke», samme svar for alle (som A125-kortet).
4. **Revisjonslogg og hendelse:** `claim_reinspection.linked` og `claim_reinspection.unlinked` med bare `claimId`, `assignmentId` og `reinspectionId`. Aldri fritekst fra saken.
5. **Skjermer** (se under), bare for den som har `claims.read`; knappene bare for `claims.manage`. Sjekken står i `src/core/access`, ikke i sidene.
6. **Papirkurven:** blir det nye oppdraget fjernet, vises koblingen ikke, men raden står. Gjenopprettes oppdraget, vises koblingen igjen. Koblingen selv legges ikke i papirkurven (den fjernes og lages på nytt fra saken).
7. **Oppdatert:** `tests/tenant-tables.ts` (ny tabell med radbygger), `tests/factories.ts` (`createClaimReinspection`, tabellen i `RESET_TABLES`), personvernerklæringen (ny tabell, ingen persondata), domenemodellen 4.13 og ordlisten (avsnitt 8: henvendelse = `inquiry`, ny befaring = `reinspection`), testdataene (`pnpm db:seed:testdata`) med én henvendelse og én reklamasjon med ny befaring, og versjonen i `package.json`.

**Ikke med (bevisst utelatt):**
- Reklamasjonsmappen med alt samlet og egen liste over alle saker (fase 4, H6).
- Telling og visning av «reklamasjoner per 100 leverte rapporter» og tid brukt på nye befaringer.
- Kobling til rapport, utgivelse, kontrollpunkt og avvik (finnes ikke ennå, A128).
- Eget merke eller ny oppdragstype «ny befaring» som takstmannen ser. Det ville vist at det finnes en sak.
- Ny oppdragsstatus. De fire statusene fra 27.10.2026 gjelder også det nye oppdraget.
- Varsel, e-post eller SMS om saken eller den nye befaringen.
- Kopiering av rapportinnhold (bygninger, rom, funn) fra det opprinnelige oppdraget. Kommer med «ny rapport på samme bolig» når rapportene finnes.
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei, verken sak, kobling eller delen på det nye oppdraget (også med `access.inspectors_edit_all`). Ser det nye oppdraget som et vanlig oppdrag. | nei |
| kontor | nei (som over) | nei |
| leder | ja (`claims.read`) | ja (`claims.manage`; å lage nytt oppdrag krever også `assignment.edit`, som leder har) |
| admin | ja | ja (admin har alltid alle rettigheter, regel 11) |

Ingen nye rettigheter. Direkte adresse til en kobling eller sak gir «finnes ikke» for den uten `claims.read`.

## Data
**Endret:** `claims.claim_type` får verdien `inquiry` (CHECK-regelen og `CLAIM_TYPES`). Ingen kode endres eller fjernes (regel 6).

**Ny tabell `claim_reinspections`** (`organization_id`, `created_at`, `updated_at`, `deleted_at` som de andre):

| Felt | Type | Forklaring |
|---|---|---|
| `claim_id` | uuid, påkrevd | Saken. Sammensatt fremmednøkkel (`organization_id`, `claim_id`) |
| `assignment_id` | uuid, påkrevd | Oppdraget for ny befaring. Sammensatt fremmednøkkel (`organization_id`, `assignment_id`) |
| `created_by` | uuid | Den som laget koblingen, aldri fra skjemaet |

Indekser: unik (`organization_id`, `assignment_id`) der `deleted_at is null` (et oppdrag hører til høyst én aktiv sak), unik (`organization_id`, `claim_id`, `assignment_id`) der `deleted_at is null`, og indeks på (`organization_id`, `claim_id`). CHECK i databasen hindrer ikke at `assignment_id` er lik sakens opprinnelige oppdrag; det sjekkes i tjenesten og testes.

Kjeden leses slik: opprinnelig oppdrag = `claims.assignment_id` → sak (`claims`) → ny befaring = `claim_reinspections.assignment_id`.

## Skjermer
PC og iPad-størrelse, Fjord-designet. Trenger ikke virke uten nett (lederarbeid på PC).
- **Saken (`/oppdrag/[id]/reklamasjoner/[claimId]`):** ny del «Ny befaring» under skjemaet. Liste med oppdragsnummer (lenke), status og befaringsdato. Knappene «Lag oppdrag for ny befaring» og «Knytt til oppdrag som finnes», og «Fjern koblingen» per rad med bekreftelse. Tomt: «Ingen ny befaring er knyttet til saken.»
- **«Lag oppdrag for ny befaring» (`/oppdrag/[id]/reklamasjoner/[claimId]/ny-befaring`):** kort skjema med det som fylles ut fra det opprinnelige oppdraget vist som tekst, og valg av ansvarlig takstmann. Hovedhandling «Lag oppdraget». Etterpå sendes leder til det nye oppdraget med kvittering «Oppdraget for ny befaring er laget.» To trykk pluss valg av takstmann.
- **Det opprinnelige oppdraget (`/oppdrag/[id]`):** i delen «Reklamasjoner» får hver sak lenke til ny befaring («Ny befaring: oppdrag 2026-0123»). Typen «Henvendelse» vises med eget merke.
- **Det nye oppdraget (`/oppdrag/[id]`):** for den med `claims.read` en kort del «Reklamasjon»: «Ny befaring for reklamasjon på oppdrag 2026-0042» med lenke til saken og til det opprinnelige oppdraget. Ingenting for andre.
- **Skjemaet for ny sak:** «Henvendelse» står først i typevalget med hjelpetekst «Kunden har tatt kontakt, men har ikke fremmet krav. Endre typen hvis det blir et krav.»

## Regler
Valideringsregler med testsaker (navnene brukes i testene):
- `reinspection_not_original`: det nye oppdraget kan ikke være sakens opprinnelige oppdrag.
- `reinspection_one_active_claim`: et oppdrag kan være ny befaring for høyst én aktiv sak.
- `reinspection_same_organization`: sak og oppdrag i samme organisasjon, ingen av dem fjernet.
- `reinspection_no_duplicate`: samme oppdrag kan ikke knyttes to ganger til samme sak (dobbelttrykk gir den eksisterende koblingen tilbake).
- `claim_type_inquiry`: `inquiry` er gyldig type og kan endres til og fra de andre typene.

## Akseptkriterier
- [ ] Leder og admin kan lage oppdrag for ny befaring fra en sak; det nye oppdraget har adresse, eiendom, kontor, selskap og oppdragstype fra det opprinnelige, og ingen parter, team, pris eller ordre (test og e2e).
- [ ] Leder og admin kan knytte et oppdrag som finnes, og fjerne koblingen; raden står med `deleted_at` (test).
- [ ] Koblingen vises på saken, på det opprinnelige oppdraget og på det nye oppdraget for leder og admin (e2e).
- [ ] Takstmann og kontor ser verken saken, koblingen eller delen «Reklamasjon» på det nye oppdraget, også med `access.inspectors_edit_all` på, og får «finnes ikke» på alle tjenestene og adressene (test og e2e).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for alle fem tjenestene, og tabellen i `tests/tenant-tables.ts`).
- [ ] Reglene over har testsaker, også dobbelttrykk og fjernet sak eller oppdrag.
- [ ] Fjernet nytt oppdrag skjuler koblingen; gjenoppretting viser den igjen (test).
- [ ] Revisjonsloggen og hendelsene inneholder ingen fritekst fra saken (test).
- [ ] Henvendelse kan registreres og endres til reklamasjon (test og e2e).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] Versjon, domenemodell, ordliste, personvernerklæring og testdata er oppdatert.

## Beslutninger tatt av agentene (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A419 (lett å endre):** «Henvendelse» er en ny sakstype (`inquiry`) i samme tabell, ikke en egen tabell. Samme skjema, samme tilgang, og typen endres når det blir et krav. Telles ikke som reklamasjon. Kilde: svar 10.11.2026 nr. 38 («henvendelse/reklamasjon»), domenemodellen 4.13. Kan endres ved å arkivere koden og flytte radene.
- **A420 (dyrt å endre):** Koblingen til ny befaring er en egen tabell `claim_reinspections` med myk sletting, ikke en kolonne på `assignments`. Da står ingenting om saken på oppdraget som takstmannen leser, og en sak kan ha flere befaringer. Kilde: Ståle 27.10.2026 (bare leder og admin ser reklamasjonssaker), regel 3.
- **A421 (lett å endre):** Takstmannen ser ikke at et oppdrag er ny befaring etter en reklamasjon. Leder gir beskjed selv (for eksempel i internt notat). Kilde: Ståle 27.10.2026. Kan endres ved å vise en nøytral lenke til det opprinnelige oppdraget for alle.
- **A422 (lett å endre):** Det nye oppdraget fylles ut med adresse, eiendom, kontor, selskap og oppdragstype; ikke bestiller, parter, team, pris, ordre eller avtale. Hvem som betaler for en ny befaring etter klage, er en egen vurdering for leder. Kilde: hovedmål 1 (mindre innskriving), A125-kortet.

## Roller
- **arkitekt:** ny tabell med sammensatte nøkler og delvise unike indekser, kall fra `src/core/claims` til `createAssignment` i samme transaksjon. Kort vurdering, ingen ADR med mindre transaksjonen krever endring i `createAssignment`.
- **utvikler** og **testskriver** i parallell. Biter som ikke henger sammen: (1) migrering, koder og tjenester i `src/core/claims`; (2) skjermene på saken og de to oppdragene. Testskriveren skriver tilgang, tenant-isolasjon, reglene og e2e mot kortet.
- **sikkerhet-personvern:** unntaket fra «alle ser alt» må ikke lekke via det nye oppdraget, revisjonsloggen eller hendelsene.
- **test-leder:** gjennomgang før merge.

## Åpne spørsmål
- Ingen som stopper oppgaven. Om takstmannen skal få vite at et oppdrag er ny befaring etter klage (A421), og hvem som betaler (A422), tas når reklamasjonsmappen bygges i fase 4.
