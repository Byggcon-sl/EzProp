# Funksjon: Utstedende selskap settes automatisk fra ansvarlig takstmann

- **Fase:** 2a – Rapporten på PC (fjerde punkt under «Oppdrag og eiendom»)
- **Modul:** kjerne (`src/core/assignments`, siden `/oppdrag/[id]`)
- **Branch:** `fase2a-utstedende-selskap` (bygger på `main`)
- **Status:** klar til bygging (05.11.2026, prosjektleder)
- **Dato:** 05.11.2026
- **Støtter hovedmål:** Tid: ingen velger selskap for hånd; det følger av hvem som er ansvarlig, også ved bytte. Reklamasjoner: rapport, PDF-bunntekst, ansvarsforsikring og faktura (senere) kommer alltid fra riktig juridisk selskap, og bytter lagres med hendelse og revisjonslogg, så det kan spores hvem som sto ansvarlig for hva. KI først: se under.

## Problem
Byggcon har flere selskaper. Utstedende selskap er selskapet der ansvarlig takstmann er ansatt (beslutning 23.10 og 25.10.2026, domenemodellen 4.3). I dag har oppdraget ikke noe selskap. Lar vi være, må noen velge det for hånd senere, og det blir feil når ansvarlig byttes. Feil selskap på rapporten gir feil forsikring og feil faktura.

## KI først
Ikke KI, men automatikk: systemet setter selskapet selv, og takstmannen ser det på oppdragssiden. Det er en fast regel, ikke et skjønn, så KI trengs ikke.

## Brukerhistorier
- Som **kontor** vil jeg **at oppdraget får riktig selskap når jeg setter ansvarlig takstmann** slik at **jeg slipper å velge det selv**.
- Som **leder** vil jeg **se hvilket selskap som utsteder rapporten, og når det ble byttet** slik at **forsikring og faktura går til riktig selskap**.

## Omfang
**Med:**
1. **Migrering** (`0015_utstedende-selskap.sql` via `pnpm db:generate`): `assignments.company_id` (uuid, kan være tom) med sammensatt fremmednøkkel `(organization_id, company_id)` → `companies (organization_id, id)`, navn `assignments_company_fk`. I samme migrering én `UPDATE` som setter `company_id` på eksisterende oppdrag fra aktiv ansvarlig (bare testdata finnes; ingen sletting).
2. **Regelen i `setTeamMember`** (`src/core/assignments/team.ts`), i samme transaksjon og etter låsen: når `teamRole === "responsible"` og teamet faktisk endres, settes `assignments.company_id` til den nye ansvarliges `employees.company_id` (hentes i samme oppslag som sjekker den ansatte, filtrert på `grant.organizationId`). Ansvarlig fjernet, eller ny ansvarlig uten selskap: `company_id` blir tom (A66). Andre roller rører aldri selskapet.
3. **Hendelse og revisjonslogg**, bare når selskapet faktisk endres: hendelsen `assignment.company_changed` med `data: { fromCompanyId, toCompanyId }` (ny kode i `src/core/events/types.ts`), og revisjonslogg `entityType: "assignment"`, `action: "update"`, `changes: { companyId: { from, to } }`. Bare id-er.
4. **`getAssignment`** returnerer `companyName` (`companies.legal_name`, left join filtrert på `grant.organizationId`; også et slettet selskap vises, fordi det var det som gjaldt).
5. **Oppdragssiden** `/oppdrag/[id]`: én linje under «Kontor»: «Utstedende selskap: <navn>». Tomt: «Utstedende selskap: Ikke satt» og en kort forklaring «Settes fra ansvarlig takstmann. Har den ansvarlige ikke selskap, legger admin det inn under Ansatte.»
6. **Tester** (testskriver):
   - `setTeamMember` med ansvarlig i selskap A setter A; bytte til ansvarlig i selskap B setter B; fjerne ansvarlig gir tom; ansvarlig uten selskap gir tom; bytte av sidemann, medansvarlig osv. endrer ikke selskapet.
   - Hendelse og revisjonslogg kommer bare når selskapet endres (bytte mellom to i samme selskap gir `team_changed`, men ingen `company_changed`), og har bare id-er.
   - Tenant-isolasjon: `getAssignment` gir aldri selskapsnavnet fra en annen organisasjon (`expectTenantIsolation`), og databasen nekter `company_id` fra en annen organisasjon (fremmednøkkeltest).
   - Migreringen: eksisterende oppdrag med aktiv ansvarlig får selskapet.
   - e2e (PC og iPad-størrelse): sett ansvarlig på oppdragssiden, se at selskapets navn står.
7. **Dokumenter og versjon:** `docs/05-domenemodell.md` (4.3 «Bygget i fase 2a», hendelseslisten, endringsloggen), ordlisten (`issuing company` → `company_id`), plan krysses av, `package.json` 0.2.74 → 0.2.75, A65–A67 i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- Manuell overstyring av utstedende selskap, og «forslag om nytt selskap» med bekreftelse (domenemodellen nevner forslag; A65).
- Oppdatering av eksisterende oppdrag når admin endrer den ansattes selskap senere (A67).
- Kopi til rapporten (`reports.company_id`) og utgivelsen; det kommer med publisering.
- Faktura, eAccounting-klient, rapportprofil eller firmatekst fra selskapet.
- Advarsel før publisering om manglende selskap (hører til sperrer og advarsler).
- Visning av selskapshistorikk på skjermen (hendelsene finnes; vises senere).
- Selskap i oppdragslisten (eget planpunkt).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (`organization.read`) | indirekte, ved å sette ansvarlig (`assignment.edit`) |
| kontor | ja | indirekte, som over |
| leder | ja | indirekte, som over |
| admin | ja | indirekte, som over |

Ingen ny rettighet. Ingen id fra skjemaet brukes til filtrering; selskapet hentes fra den ansattes rad i `grant.organizationId`.

## Data
- `assignments.company_id` (ny, kan være tom, sammensatt fremmednøkkel). Ingen ny tabell, så `tests/tenant-tables.ts` endres ikke.
- Ny hendelseskode `assignment.company_changed`.

## Skjermer
PC og iPad: ingen ny handling. Én ny linje på `/oppdrag/[id]`. Trykk: 0 (før: ville vært 2–3 for å velge selskap for hånd).

## Regler
Fast regel i koden (ikke en mal-regel): utstedende selskap = selskapet til aktiv ansvarlig takstmann, satt i det øyeblikket ansvarlig settes eller byttes.

## Akseptkriterier
- [ ] Settes eller byttes ansvarlig, får oppdraget den ansattes selskap i samme transaksjon.
- [ ] Ansvarlig fjernet eller uten selskap gir tomt selskap og teksten «Ikke satt» med forklaring.
- [ ] Andre roller i teamet endrer ikke selskapet.
- [ ] `assignment.company_changed` og revisjonslogg kommer bare ved faktisk endring, bare med id-er.
- [ ] Selskapets navn vises på oppdragssiden.
- [ ] Bruker i annen organisasjon får ikke tilgang, og `company_id` fra en annen organisasjon stoppes av databasen (test).
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` er grønne.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` som A65–A67)
- **A65:** Selskapet settes automatisk uten bekreftelse og uten manuell overstyring. Domenemodellen sier «foreslås» ved bytte; vi setter det direkte, og byttet vises med hendelse og logg. Kilde: beslutningen 23.10/25.10.2026 (utstedende selskap er der ansvarlig er ansatt), mål tid, det enkleste som virker. Endres ved å legge til et valg på oppdragssiden.
- **A66:** Ansvarlig fjernet, eller ny ansvarlig uten selskap, gir tomt selskap (ikke det gamle). Et gammelt selskap som står igjen, ville vært feil i stillhet. Kilde: samme beslutning, mål reklamasjoner. Endres i `setTeamMember`.
- **A67:** Selskapet settes bare når ansvarlig settes eller byttes, ikke når admin senere endrer den ansattes selskap. Oppdrag i arbeid skal ikke bytte selskap uten at noen gjør noe på oppdraget. Kilde: domenemodellen 4.3, det enkleste som virker. Endres ved å la endring av ansatt oppdatere åpne oppdrag.

## Roller
- **utvikler:** punkt 1–5 og 7.
- **testskriver** (i parallell, bare testfiler): punkt 6.

Ingen arkitekt (én kolonne etter kjent mønster), ingen UX/UI (én tekstlinje på en eksisterende side), ingen fagrolle (regelen er bestemt av Ståle), ingen egen sikkerhetsgjennomgang (ingen ny tabell, ingen personopplysninger; tenant-isolasjon og fremmednøkkel dekkes av testene).

## Byggingen deles i to biter som ikke henger sammen
- **Bit A (utvikler):** migrering, skjema, `team.ts`, hendelseskode, `getAssignment`, siden, dokumenter, versjon.
- **Bit B (testskriver):** testene i punkt 6, skrevet mot kortet (`setTeamMember`, `getAssignment.companyName`, hendelsen `assignment.company_changed`).

## Åpne spørsmål
- Ingen som stopper. A65–A67 kan endres av Ståle når han er tilbake.
