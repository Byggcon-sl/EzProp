# Funksjon: Reklamasjonskoblingen (oppdrag → henvendelse eller reklamasjon → ny befaring)

- **Fase:** 2a – Rapporten på PC (punktet «Reklamasjonskoblingen» i `docs/07-utviklingsplan.md`)
- **Modul:** kjerne (`src/core/claims`, liten utvidelse av `createAssignment` i `src/core/assignments`, delen «Reklamasjoner» på `/oppdrag/[id]`, sidene under `/oppdrag/[id]/reklamasjoner`)
- **Branch:** `reklamasjonskobling` (bygger på `main`)
- **Status:** klar til bygging, runde 2 etter forhåndsvurdering (17.11.2026, prosjektleder)
- **Dato:** 17.11.2026
- **Grunnlag:** svar 10.11.2026 nr. 38 («Koblingen oppdrag → henvendelse/reklamasjon → ny befaring lages sammen med reklamasjonsskjemaet, før første ekte rapport»), Ståle 27.10.2026 (bare leder og admin ser reklamasjonssaker), kortet `docs/funksjoner/fase2a-reklamasjoner.md` (A125–A129).
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** hele kjeden fra opprinnelig oppdrag via klagen til ny befaring lagres som data, og overgangen fra henvendelse til krav lagres. Da kan vi senere telle hvor mange saker som krevde ny befaring, og lære hvilke punkter som gir saker. Tallene er samlede, aldri per ansatt (spørsmål 88, S11).
  - **De ansatte:** leder lager oppdraget for ny befaring fra saken på én skjerm, med adresse, eiendom og kontor fylt ut, befaringsdato og beskjed til takstmannen. Å knytte et oppdrag som finnes er ett trykk i en foreslått liste.
  - **KI i bunnen:** koblingen og typeovergangen er strukturerte koder for KI senere (se under).

## Problem
En reklamasjon fører ofte til en ny befaring. I dag lages det nye oppdraget løst fra saken, og ingenting viser at det hører til en klage på et tidligere oppdrag. Da kan leder ikke se hele saken samlet, og tallene for hovedmålet blir ufullstendige. Byggcon trenger også å føre **henvendelser** (kunden tar kontakt om noe i rapporten) som ikke er et krav ennå, men som kan bli det. Ståle sa ja til koblingen 10.11.2026 (nr. 38), og den skal finnes før første ekte rapport.

## KI i bunnen
- **Fra første dag gjør KI ingenting med sakene.** En reklamasjon er en juridisk sak leder fører selv, og friteksten kan inneholde helseopplysninger og navn. Det er for få saker til at et forslag har verdi. Ingen kall til `src/core/ai` i denne oppgaven.
- **Data som lagres for KI senere:** strukturert og uten fritekst: opprinnelig oppdrag (`claims.assignment_id`), sakstype (`inquiry`, `complaint`, `insurance_claim`, `other`), overgangen mellom typer med tidspunkt (revisjonsloggen), utfall og datoer, og oppdraget for ny befaring (`claim_reinspections`). Når rapporter og kontrollpunkter finnes, kan KI gjennom `src/core/ai` (bak KI-porten, med logg i `ai_usage_log`) bruke dette til robusthetsråd før publisering (S2, fase 4) og til å foreslå hvilket punkt en sak gjelder. Friteksten i saken sendes aldri til KI uten vask (regel 14).

## Brukerhistorier
- Som **leder** vil jeg **føre en henvendelse fra en kunde på oppdraget** slik at **den ikke går tapt, også om den aldri blir en reklamasjon**.
- Som **leder** vil jeg **lage oppdraget for ny befaring rett fra saken**, med befaringsdato og beskjed til takstmannen, slik at **adresse og eiendom kommer med, og saken og befaringen henger sammen**.
- Som **leder** vil jeg **få foreslått oppdrag på samme bolig** når den nye befaringen alt er bestilt, slik at jeg slipper å slå opp oppdragsnummeret.
- Som **leder** vil jeg **se på det nye oppdraget hvilken sak og hvilket oppdrag det kommer fra**, og **på saken hvilket oppdrag som er den nye befaringen**.
- Som **takstmann** skal jeg **ikke se reklamasjonssakene eller koblingen** (Ståle 27.10.2026). Jeg ser det nye oppdraget som et vanlig oppdrag.

## Omfang
**Med:**
1. **Ny sakstype `inquiry` («Henvendelse»)** i `CLAIM_TYPES` og i CHECK-regelen på `claims.claim_type`. Henvendelse er første trinn; leder kan endre typen til reklamasjon eller forsikringskrav når det blir et krav. Henvendelser telles ikke som reklamasjoner i tallet for hovedmålet (står i domenemodellen).
2. **Overgangen mellom sakstyper lagres** (forbedreren F4): når `claimType` endres, får revisjonsraden for `updateClaim` `claimTypeFrom` og `claimTypeTo` (faste koder, aldri fritekst) i tillegg til feltnavnene. Tidspunktet er radens tid. Ingen ny tabell.
3. **Ny tabell `claim_reinspections`** (migrering `0036`): kobler en sak til oppdraget for ny befaring. Felter under «Data». Myk sletting. En sak kan ha flere nye befaringer (for eksempel en tilleggsbefaring); et oppdrag kan være ny befaring for høyst én aktiv kobling.
4. **Utvidelse av `createAssignment`** (`src/core/assignments`, ADR 0013): `CreateAssignmentOptions` blir `{ now?: Date; executor?: DbExecutor; propertyId?: string | null }`, og `CreateAssignmentInput` får valgfritt `internalNote` (samme `assignmentNoteSchema` som `updateAssignmentNote`: høyst 200 tegn, sperre mot fødselsnummer). Med `executor` kjører stegene i kallerens transaksjon; tilgangssjekken `assignment.edit` gjøres fortsatt inne i funksjonen. `propertyId` slås opp med `grant.organizationId` og kommer aldri fra skjemaet. Ingen ny eksportert funksjon uten tilgangssjekk. «Nytt oppdrag» virker som før.
5. **Tjenester i `src/core/claims`** (filtrerer på `grant.organizationId`, Zod-skjema i `schemas.ts`, id-er og oppdragsnummer valideres før spørringen):
   - `createReinspectionAssignment(actor, organizationId, claimId, input)` – sjekker `claims.manage` først, så `assignment.edit` (via `createAssignment`), før noe leses eller skrives. Én transaksjon: `lockClaim`, les det opprinnelige oppdraget, `createAssignment` med `executor`, sett inn koblingen. Det nye oppdraget får fra det opprinnelige: adresse, gnr/bnr/snr, kommune, eiendom (`propertyId`), borettslag og kontor. Oppdragstypen er alltid `condition_report`. **Selskapet følger ansvarlig takstmann** (A65–A68), som for alle oppdrag. Fra skjemaet: ansvarlig takstmann (påkrevd), befaringsdato og internt notat (begge valgfrie). Kopieres **aldri**: bestiller (`orderedByText`), kontakt, firma, meglerens ordrenummer (`externalRef`), parter, teamet fra det opprinnelige oppdraget, pris, ordre og avtale. Ansvarlig takstmann blir eneste teammedlem, status er «bestilt».
     - **Dobbelttrykk:** engangsnøkkel som «Nytt oppdrag». Gir `createAssignment` `created: false`, gis koblingen tilbake **bare** hvis det oppdraget alt er knyttet til samme sak (aktiv kobling). Ellers feilen «finnes ikke» – aldri ny kobling til et fremmed, kansellert eller fjernet oppdrag.
     - **Samtidige kall:** med `executor` kan `createAssignment` ikke fange brudd på `assignments_organization_id_creation_key_idx` (transaksjonen er avbrutt). `createReinspectionAssignment` fanger 23505 utenfor transaksjonen, leser på nytt og følger regelen over.
   - `listReinspectionCandidates(actor, organizationId, claimId)` – `claims.manage` (forbedreren F1). Oppdrag i samme organisasjon på samme eiendom (`property_id`) eller samme adresse (samme normalisering som dublettvarselet, A286), laget etter det opprinnelige oppdraget, ikke fjernet, ikke kansellert, ikke det opprinnelige og uten aktiv kobling. Nyeste først, høyst 20. Gir bare id, oppdragsnummer, status, befaringsdato og ansvarlig takstmanns navn.
   - `linkReinspectionAssignment(actor, organizationId, claimId, target)` – `claims.manage`. `target` er `{ assignmentId }` (fra kandidatlisten) eller `{ assignmentNumber }` (søk, reserve). Begge slås opp med `grant.organizationId`. Ukjent oppdrag og oppdrag i en annen organisasjon gir samme «finnes ikke», aldri «allerede koblet». Låser saken (`lockClaim`) før innsetting; brudd på den unike indeksen (23505) ved samtidige kall oversettes til regelen `reinspection_one_active_claim`, eller gir den eksisterende koblingen tilbake hvis den gjelder samme sak.
   - `unlinkReinspectionAssignment(actor, organizationId, reinspectionId)` – `claims.manage`. Myk sletting av koblingen; oppdraget blir stående. Fjernet kobling, ukjent id og id i en annen organisasjon gir samme «finnes ikke».
   - `listReinspectionsForClaim(actor, organizationId, claimId)` og `getClaimForReinspectionAssignment(actor, organizationId, assignmentId)` – `claims.read`. Den siste gir bare id-er, oppdragsnummer og sakstype, aldri fritekst. Begge joiner alltid mot sak, opprinnelig oppdrag og nytt oppdrag som ikke er fjernet.
   - Fjernet sak, fjernet opprinnelig oppdrag eller sak i annen organisasjon gir «finnes ikke», samme svar for alle (som A125-kortet).
6. **`removeClaim` fjerner sakens aktive koblinger mykt** i samme transaksjon og med samme `deleted_at` (A424). Det finnes ingen gjenoppretting av saker i dag. Kommer den, hentes koblingene med samme `deleted_at` tilbake, unntatt der oppdraget har fått en annen aktiv kobling.
7. **Fjernet nytt oppdrag (papirkurven):** koblingen står og vises ikke. Den unike indeksen gjelder fortsatt, så oppdraget kan ikke knyttes til en annen sak mens det ligger i papirkurven; saken kan få andre nye befaringer. Gjenopprettes oppdraget, vises koblingen igjen. Vil leder bruke oppdraget for en annen sak: gjenopprett det og fjern koblingen først (A425).
8. **Revisjonslogg og hendelser uten lekkasje** (A426):
   - `claim_reinspection.linked` og `claim_reinspection.unlinked` føres som faste koder i `EVENT_TYPES` (`src/core/events/types.ts`). Kolonnen `events.assignment_id` er sakens **opprinnelige** oppdrag (som `claim.registered`), aldri det nye. Det nye oppdragets id står bare i `data`, sammen med `claimId` og `reinspectionId`. Ingen fritekst.
   - Revisjonsraden har `entityType: "claim_reinspection"`, aldri `"assignment"`, slik at `readBookingHistory` ikke viser den.
   - `assignment.created` og revisjonsraden for det nye oppdraget er helt like et vanlig «Nytt oppdrag» (ingen `claimId`, ingen egen `source`).
   - Kommentar i `src/core/events/types.ts`: `claim.*` og `claim_reinspection.*` krever `claims.read` ved lesing.
9. **Skjermer** (se under), bare for den som har `claims.read`; knappene bare for `claims.manage`. Sjekken står i `src/core/access`, ikke i sidene. Siden kaller ikke tjenestene uten `claims.read` (samme mønster som `loadClaims` med `context.canReadClaims` i `src/app/(ansatt)/oppdrag/[id]/page.tsx`): ingen tom ramme og ingen props om saken til klientkomponenter.
10. **Synk til iPad (fase 2b):** `claims` og `claim_reinspections` er aldri med i synksettet til enhetene. Står i domenemodellen.
11. **Oppdatert:** `tests/tenant-tables.ts` (ny tabell med radbygger), `tests/factories.ts` (`createClaimReinspection`, tabellen i `RESET_TABLES`), personvernerklæringen (se «Personvern»), domenemodellen 4.13 og ordlisten (avsnitt 8: henvendelse = `inquiry`, ny befaring = `reinspection`), testdataene (`pnpm db:seed:testdata`) med én henvendelse og én reklamasjon med ny befaring, planpunktet «Historikk på oppdraget» (filtrerer bort `claim.*` og `claim_reinspection.*` uten `claims.read`), og versjonen i `package.json`.

**Ikke med (bevisst utelatt):**
- Reklamasjonsmappen med alt samlet og egen liste over alle saker (fase 4, H6).
- Telling og visning av «reklamasjoner per 100 leverte rapporter», og alle tall om nye befaringer. Tall per ansatt bygges ikke før S11 er gjort (spørsmål 88).
- Kobling til rapport, utgivelse, kontrollpunkt og avvik (finnes ikke ennå, A128).
- Eget merke eller ny oppdragstype «ny befaring» som takstmannen ser. Det ville vist at det finnes en sak.
- Ny oppdragsstatus. De fire statusene fra 27.10.2026 gjelder også det nye oppdraget.
- Gjenoppretting av saker (finnes ikke i dag).
- Varsel, e-post eller SMS om saken eller den nye befaringen.
- Kopiering av rapportinnhold (bygninger, rom, funn) fra det opprinnelige oppdraget. Kommer med «ny rapport på samme bolig» når rapportene finnes.
- KI.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei, verken sak, kobling eller delen på det nye oppdraget (også med `access.inspectors_edit_all`, og også med `claims.manage` gitt som enkeltrettighet uten `claims.read`-rolle). Ser det nye oppdraget som et vanlig oppdrag. | nei |
| kontor | nei (som over) | nei |
| leder | ja (`claims.read`) | ja (`claims.manage`; å lage nytt oppdrag krever også `assignment.edit`, som leder har) |
| admin | ja | ja (admin har alltid alle rettigheter, regel 11), med innstillingen av og på |

Ingen nye rettigheter. Direkte adresse til en kobling, en sak eller `ny-befaring` gir «finnes ikke» (404) for den uten `claims.read`.

## Data
**Endret:** `claims.claim_type` får verdien `inquiry`. Migrering `0036` bytter CHECK-regelen med drop og add i samme migrering; den nye listen er større, så eksisterende rader består. `CLAIM_TYPES` og CHECK holdes like. Ingen kode endres eller fjernes (regel 6).

**Ny tabell `claim_reinspections`** med hele `baseColumns` (`id` UUID v7, `organization_id`, `created_at`, `updated_at`, `deleted_at`, `updated_by`, `deleted_by`, `row_version`):

| Felt | Type | Forklaring |
|---|---|---|
| `claim_id` | uuid, påkrevd | Saken. Sammensatt fremmednøkkel (`organization_id`, `claim_id`) mot `claims_organization_id_id_idx` |
| `assignment_id` | uuid, påkrevd | Oppdraget for ny befaring. Sammensatt fremmednøkkel (`organization_id`, `assignment_id`) mot `assignments_organization_id_id_idx` |
| `created_by` | uuid, påkrevd | Den ansatte som laget koblingen (som i `claims`), aldri fra skjemaet |

Ingen `ON DELETE CASCADE` (regel 3). Indekser: unik (`organization_id`, `assignment_id`) der `deleted_at is null` (et oppdrag hører til høyst én aktiv kobling) og vanlig indeks på (`organization_id`, `claim_id`). Det finnes ingen egen unik indeks på (`organization_id`, `claim_id`, `assignment_id`); den over dekker den (forbedreren F5, arkitekten). At `assignment_id` ikke er sakens opprinnelige oppdrag, sjekkes i tjenesten og testes.

Kjeden leses slik: opprinnelig oppdrag = `claims.assignment_id` → sak (`claims`) → ny befaring = `claim_reinspections.assignment_id`.

## Personvern
Ingen fritekst i tabellen. `created_by` er en ansatt. Raden knytter en klage til et oppdrag og dermed indirekte til kunden og til ansvarlig takstmann. Oppbevares i 10 år med myk sletting, leses bare av leder og admin, sendes ikke til KI og er ikke med i synk til iPad. Skrives slik i `docs/personvern/intern-personvernerklaering.md`.

## Skjermer
PC og iPad-størrelse, Fjord-designet, trykkflater minst 44 px, alt kan brukes med tastatur. Trenger ikke virke uten nett (lederarbeid på PC).
- **Saken (`/oppdrag/[id]/reklamasjoner/[claimId]`):** ny del «Ny befaring» under skjemaet. Liste med oppdragsnummer (lenke), status og befaringsdato. Knappene «Lag oppdrag for ny befaring» og «Knytt til oppdrag som finnes», og «Fjern koblingen» per rad med bekreftelse («Avbryt» lar den stå). Tomt: «Ingen ny befaring er knyttet til saken.»
- **«Knytt til oppdrag som finnes»** (forbedreren F1): viser først de foreslåtte oppdragene (`listReinspectionCandidates`) med oppdragsnummer, status, befaringsdato og takstmann, og knappen «Knytt til» per rad (ett trykk). Under står søk på oppdragsnummer som reserve. Ingen forslag: «Fant ingen nyere oppdrag på samme bolig. Søk på oppdragsnummer.»
- **«Lag oppdrag for ny befaring» (`/oppdrag/[id]/reklamasjoner/[claimId]/ny-befaring`):** det som fylles ut fra det opprinnelige oppdraget vises som tekst. Felt: ansvarlig takstmann (påkrevd, ingenting forhåndsvalgt), befaringsdato (valgfri) og «Internt notat til takstmannen» (valgfritt, tomt). Hjelpetekst under notatet: «Takstmannen og kontoret ser notatet. Skriv hva som skal sjekkes på befaringen. Ikke skriv navn, fødselsnummer eller helseopplysninger.» Valglisten for takstmann (forbedreren F3): den opprinnelige takstmannen først, merket «gjorde den opprinnelige befaringen», så takstmennene på leders kontor, så resten. Hovedhandling «Lag oppdraget». Etterpå sendes leder til det nye oppdraget med kvittering «Oppdraget for ny befaring er laget.» Én skjerm i stedet for tre (oppdrag, så notat, så befaringsdato).
- **Det opprinnelige oppdraget (`/oppdrag/[id]`):** i delen «Reklamasjoner» får hver sak lenke til ny befaring («Ny befaring: oppdrag 2026-0123»). Typen «Henvendelse» vises med eget merke.
- **Det nye oppdraget (`/oppdrag/[id]`):** for den med `claims.read` en kort del «Reklamasjon»: «Ny befaring for reklamasjon på oppdrag 2026-0042» med lenke til saken og til det opprinnelige oppdraget. Ingenting for andre, verken i HTML-en eller i RSC-svaret.
- **Skjemaet for ny sak:** «Henvendelse» står først i typevalget med hjelpetekst «Kunden har tatt kontakt, men har ikke fremmet krav. Endre typen hvis det blir et krav.»

## Regler
Valideringsregler med testsaker (navnene brukes i testene):
- `reinspection_not_original`: det nye oppdraget kan ikke være sakens opprinnelige oppdrag.
- `reinspection_one_active_claim`: et oppdrag kan ha høyst én aktiv kobling (også ved samtidige kall).
- `reinspection_same_organization`: sak og oppdrag i samme organisasjon, ingen av dem fjernet, og det opprinnelige oppdraget ikke fjernet. Samme «finnes ikke» som ukjent id.
- `reinspection_no_duplicate`: samme oppdrag knyttet to ganger til samme sak gir den eksisterende koblingen tilbake (håndteres i tjenesten).
- `reinspection_creation_key_reuse`: gjenbrukt engangsnøkkel gir bare tilbake en kobling som alt finnes mellom samme sak og samme oppdrag; ellers «finnes ikke».
- `claim_type_inquiry`: `inquiry` er gyldig type og kan endres til og fra de andre typene; overgangen står i revisjonsloggen.

## Testplan
**Integrasjon (`src/core/claims/reinspections.test.ts`):**
- `create_copies_only_listed_fields`: adresse, matrikkel, eiendom, borettslag og kontor kommer med; selskapet følger ansvarlig takstmann; ingen parter, bestiller, kontakt, firma, `externalRef`, pris, ordre eller avtale; ansvarlig er eneste teammedlem; status bestilt; befaringsdato og notat bare når de er fylt ut.
- `create_note_rejects_fnr`: notat med elleve sifre stopper før noe skrives.
- `create_double_submit_same_creation_key`: ett oppdrag og én kobling.
- `create_creation_key_reused_from_other_assignment` og `..._from_cancelled_assignment`: «finnes ikke», ingen ny kobling.
- `create_concurrent_promise_all`: to kall samtidig med samme nøkkel gir ett oppdrag, én kobling og ingen 500-feil.
- `create_rollback_on_link_failure`: feiler koblingen, finnes det ikke noe oppdrag uten kobling.
- `create_responsible_from_other_org_rejected`.
- `candidates_same_property_or_address`: med de riktige; uten fjernede, kansellerte, eldre, det opprinnelige og de som har aktiv kobling.
- `link_rules`: alle reglene over, med fjernet oppdrag, fjernet sak og fjernet opprinnelig oppdrag; `assignmentId` og `assignmentNumber`; nummer i annen organisasjon gir samme svar som ukjent nummer.
- `link_concurrent_promise_all`: to kall samtidig gir én kobling og ingen 500-feil.
- `unlink_soft_delete_keeps_row_and_assignment`, `unlink_twice_not_found`, `unlink_other_org_not_found`, `relink_after_unlink`.
- `remove_claim_removes_links`: samme `deleted_at`; det nye oppdraget viser ingen «Reklamasjon» og kan knyttes til en annen sak.
- `trash_hides_and_restore_shows`: fjernet nytt oppdrag skjuler koblingen og sperrer fortsatt; gjenoppretting viser den igjen.
- `claim_type_inquiry`: kan settes og endres til og fra; revisjonsraden har `claimTypeFrom` og `claimTypeTo`; ingen eksisterende kode endres.
- `no_leak_via_new_assignment`: les `events` og `audit_log` for det nye oppdragets id; ingen rad nevner sak eller kobling; `claim_reinspection.*` har opprinnelig oppdrag i `assignment_id`, entityType `claim_reinspection`, bare id-er.
- `composite_fk_rejects_cross_org_row`: databasen avviser en rad som blander to organisasjoner.
- `migration_check_constraint`: migreringen tåler saker som finnes fra før.
- `createAssignment` med og uten `executor` (eksisterende tester for «Nytt oppdrag» er grønne).

**Tilgang (alle seks tjenestene):** takstmann med `access.inspectors_edit_all` av og på får samme «finnes ikke» som ukjent id; takstmann med `claims.manage` som enkeltrettighet har fortsatt ikke tilgang der `claims.read` kreves; kontor (har `assignment.edit`) får «finnes ikke» overalt, også på `createReinspectionAssignment`; bruker med bare `claims.read` kan lese, ikke endre; admin med bare admin-rollen kan alt, med innstillingen av og på (regel 11).

**Tenant-isolasjon:** `expectTenantIsolation` for alle seks tjenestene; `claim_reinspections` i `tests/tenant-tables.ts` med radbygger; `createClaimReinspection` i `tests/factories.ts` og tabellen i `RESET_TABLES`.

**E2e (`e2e/fase-2a-reklamasjonskobling.spec.ts`, PC og iPad):** leder lager ny befaring med notat og dato og kommer til det nye oppdraget med kvittering; koblingen vises på saken, det opprinnelige og det nye oppdraget; leder knytter et foreslått oppdrag med ett trykk og et oppdrag funnet på nummer; fjerner koblingen med «Avbryt» og med bekreftelse; henvendelse registreres og endres til reklamasjon; takstmann (innstillingen av og på) og kontor ser verken «Reklamasjon», saks-id, opprinnelig oppdragsnummer eller lenke til saken i HTML-en og RSC-svaret, og får 404 på `ny-befaring`; trykkflater minst 44 px; skjemaet for ny befaring kan fylles og sendes med Tab og Enter.

## Akseptkriterier
- [ ] Leder og admin kan lage oppdrag for ny befaring fra en sak på én skjerm; det nye oppdraget har bare feltene i punkt 5, selskapet følger ansvarlig takstmann, og befaringsdato og notat lagres når de er fylt ut (test og e2e).
- [ ] Feiler lagringen av koblingen, blir det ikke stående noe oppdrag uten kobling (test).
- [ ] Leder får foreslått oppdrag på samme bolig og kan knytte ett med ett trykk; søk på nummer virker som reserve (test og e2e).
- [ ] Leder og admin kan fjerne koblingen; raden står med `deleted_at` (test).
- [ ] Koblingen vises på saken, på det opprinnelige oppdraget og på det nye oppdraget for leder og admin (e2e).
- [ ] Takstmann og kontor ser verken saken, koblingen eller delen «Reklamasjon» på det nye oppdraget, også med `access.inspectors_edit_all` på, og får «finnes ikke» på alle tjenestene og adressene (test og e2e).
- [ ] Hendelser og revisjonslogg for det nye oppdraget røper ikke saken (test `no_leak_via_new_assignment`).
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for alle seks tjenestene, og tabellen i `tests/tenant-tables.ts`).
- [ ] Reglene over har testsaker, også dobbelttrykk, samtidige kall, gjenbrukt engangsnøkkel og fjernet sak eller oppdrag.
- [ ] Fjernet sak fjerner koblingene; fjernet nytt oppdrag skjuler koblingen, og gjenoppretting viser den igjen (test).
- [ ] Revisjonsloggen og hendelsene inneholder ingen fritekst fra saken; typeovergangen står som koder (test).
- [ ] Henvendelse kan registreres og endres til reklamasjon (test og e2e).
- [ ] Virker på iPad-størrelse og med tastatur (e2e).
- [ ] ADR 0013, versjon, domenemodell, ordliste, personvernerklæring, testdata og planpunktet «Historikk på oppdraget» er oppdatert.
- [ ] KI: ingen KI i denne oppgaven (se «KI i bunnen»).

## Lagt til av forbedreren
Føres også i `docs/plan/forbedrerens-tillegg.md`.
- **F1 Foreslåtte oppdrag å knytte til** (punkt 5 og «Skjermer»): liste over nyere oppdrag på samme eiendom eller adresse, ett trykk. Fjernes ved å ta ut `listReinspectionCandidates` og listen; søk på nummer virker alene.
- **F2 Befaringsdato og internt notat i skjemaet for ny befaring:** én skjerm i stedet for tre. Fjernes ved å ta ut de to feltene; `internalNote` på `CreateAssignmentInput` kan stå.
- **F3 Rekkefølge i valglisten for takstmann:** opprinnelig takstmann først og merket, så leders kontor; ingenting forhåndsvalgt. Fjernes ved å sortere listen som på «Nytt oppdrag».
- **F4 Overgangen mellom sakstyper i revisjonsloggen:** `claimTypeFrom`/`claimTypeTo`. Fjernes ved å ta feltene ut av revisjonsraden.
- **F5 Én indeks mindre:** ingen unik (`organization_id`, `claim_id`, `assignment_id`). Ingen funksjon å fjerne.

## Avgjort av prosjektlederen ved uenighet
- **Internt notat i skjemaet (forbedreren F2 mot sikkerhet-personvern punkt 6):** feltet bygges. Notatet er der leder uansett gir takstmannen beskjed (A421), og uten feltet må leder åpne oppdraget og skrive det samme etterpå. Kravet fra sikkerhet-personvern tas inn ved at hjelpeteksten ikke oppfordrer til å skrive om klagen, men om hva som skal sjekkes, og advarer mot navn og helseopplysninger; fødselsnummer stoppes; ingen sak-id lagres på oppdraget; notatet går gjennom samme vask som andre notater før KI. Eksempelet «for eksempel i internt notat» er tatt ut av A421.
- **Takstmann forhåndsvelges ikke (forbedreren F3):** hvem som skal ta en ny befaring etter klage er et fagvalg. En fast regel blir et spørsmål til Ståle hvis det trengs; det stopper ikke oppgaven.
- **Selskap (kortet runde 1 mot arkitekten):** selskapet følger ansvarlig takstmann (A65–A68), ikke det opprinnelige oppdraget. Det er gjeldende regel for alle oppdrag.

## Beslutninger tatt av agentene (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A419 (lett å endre):** «Henvendelse» er en ny sakstype (`inquiry`) i samme tabell, ikke en egen tabell. Telles ikke som reklamasjon.
- **A420 (dyrt å endre):** Koblingen er en egen tabell `claim_reinspections` med myk sletting, ikke en kolonne på `assignments`.
- **A421 (lett å endre):** Takstmannen ser ikke at et oppdrag er ny befaring etter en reklamasjon. Leder gir selv beskjed om det som trengs for befaringen.
- **A422 (lett å endre):** Det nye oppdraget fylles ut med adresse, matrikkel, eiendom, borettslag og kontor; selskapet følger ansvarlig takstmann; ikke bestiller, kontakt, firma, meglerens ordrenummer, parter, team, pris, ordre eller avtale.
- **A423 (dyrt å endre):** Oppdrag og kobling lages i én transaksjon ved at `createAssignment` tar valgfri `executor` og `propertyId` (ADR 0013).
- **A424 (lett å endre):** `removeClaim` fjerner sakens koblinger mykt med samme tidspunkt.
- **A425 (lett å endre):** Kobling til et oppdrag i papirkurven står og sperrer, men vises ikke; gjenoppretting viser den igjen.
- **A426 (dyrt å endre):** Hendelser om koblingen festes til det opprinnelige oppdraget, revisjonsraden har egen `entityType`, og `claim.*`/`claim_reinspection.*` krever `claims.read` ved lesing.
- **A427 (lett å endre):** Foreslåtte oppdrag = samme eiendom eller adresse, nyere enn det opprinnelige, uten aktiv kobling, høyst 20 (forbedreren F1).
- **A428 (lett å endre):** Ingen takstmann forhåndsvelges; opprinnelig takstmann først og merket, så leders kontor (forbedreren F3).
- **A429 (lett å endre):** Typeovergangen lagres som `claimTypeFrom`/`claimTypeTo` i revisjonsloggen (forbedreren F4).
- **A430 (lett å endre):** `claims` og `claim_reinspections` er aldri med i synk til iPad.

## Roller
- **arkitekt:** ADR 0013 (transaksjon på tvers av `core/claims` og `core/assignments` via `executor`), skjema `src/db/schema/claim-reinspections.ts` med migrering `0036`, oppdatert kontrakt i `src/core/assignments/booking/contract.ts`, domenemodellen 4.13 og ordlisten.
- **utvikler** og **testskriver** i parallell. Biter som ikke henger sammen: (1) migrering, koder, `createAssignment`-utvidelsen og tjenestene i `src/core/claims`; (2) skjermene på saken og de to oppdragene. Testskriveren skriver testplanen over.
- **sikkerhet-personvern:** gjennomgang av lekkasje via det nye oppdraget, hendelsene og revisjonsloggen.
- **test-leder:** gjennomgang før merge. Godkjennes ikke uten testene for tilgang, tenant-isolasjon og lekkasje.

## Åpne spørsmål
- Ingen som stopper oppgaven. Spørsmål 88 til Ståle: tall per ansatt ut fra kjeden sak → oppdrag → takstmann venter på S11. Om takstmannen skal få vite at et oppdrag er ny befaring etter klage (A421), og hvem som betaler (A422), tas når reklamasjonsmappen bygges i fase 4.
