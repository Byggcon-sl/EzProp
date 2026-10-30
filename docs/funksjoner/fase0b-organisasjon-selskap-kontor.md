# Funksjon: Organisasjon → selskap → kontor → ansatt

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/organization`, skjema i `src/db/schema`)
- **Branch:** `fase0b-organisasjon-selskap-kontor` (bygger på `main`)
- **Status:** utkast
- **Støtter hovedmål:**
  - **Reklamasjoner:** riktig utstedende selskap, ansvarsforsikring og firmatekst skal kunne hentes fra data, ikke skrives for hånd i hver rapport. Feil selskap eller utgått forsikring i rapporten er en kjent kilde til klager. Ansatte som har sluttet, står fortsatt riktig på gamle rapporter (innspill D18).
  - **Tid:** når selskap og forsikring ligger ett sted, fylles bunntekst og side 2 i rapporten ut automatisk senere (fase 2a). Takstmannen skriver det aldri.
  - **KI først:** se under.

## Problem
Datamodellen sier organisasjon → selskap → kontor → ansatt (`docs/05-domenemodell.md` 4.1, Ståle 23.10 og 25.10.2026: «full selskapsstruktur fra start, datamodellen skal være riktig fra start»). I dag finnes bare organisasjonen og de ansatte. Uten selskap og kontor kan vi ikke bygge admin-skjermene, sertifisering, utstedende selskap eller fakturagrunnlag per selskap. Lar vi være, må alt dette bygges om senere.

## KI først
KI har ingen rolle i selve tabellene. Men strukturen er det KI senere bruker for å forberede rapporten uten at takstmannen gjør noe: utstedende selskap settes fra ansvarlig takstmanns ansettelse (Ståle 23.10.2026, svar 1), og firmatekst og forsikring hentes inn. Ingen KI i denne oppgaven.

## Brukerhistorier
- Som **admin** vil jeg at selskapene og kontorene til Byggcon finnes i systemet, slik at jeg senere kan knytte ansatte til dem (skjermene er et eget punkt).
- Som **takstmann** vil jeg at rapporten senere viser riktig selskap og ansvarsforsikring uten at jeg skriver det.
- Som **leder** vil jeg at en ansatt som har sluttet, fortsatt står på gamle rapporter, men aldri kan logge inn.

## Omfang
**Med:**
1. **Tabellen `companies`** med `baseColumns` (organisasjons-id, myk sletting, `row_version`) og feltene fra domenemodellen 4.1: `legal_name` (påkrevd), `org_number`, `vat_registered` (standard `true`), `address`, `postal_code`, `city`, `company_text` (firmatekst), `liability_insurer`, `liability_policy_number`, `liability_valid_to` (dato). Alle unntatt `legal_name` kan være tomme, slik at admin fyller dem ut senere.
2. **Tabellen `offices`** med `baseColumns` og `name` (påkrevd), `address`, `sort_order` (standard 0). Kontor går på tvers av selskapene (ingen `company_id` på kontoret).
3. **`employees` får** `company_id`, `office_id` og `phone`. `company_id` og `office_id` kan være tomme i databasen (den første admin finnes allerede uten selskap). Bare ett selskap per ansatt (Ståle 23.10.2026, svar 3).
4. **Databasen sikrer at selskap og kontor hører til samme organisasjon som den ansatte:** unik indeks `(organization_id, id)` på `companies` og `offices`, og sammensatt fremmednøkkel `(organization_id, company_id)` og `(organization_id, office_id)` fra `employees`.
5. **Sluttet uten innlogging (D18):** `employees.user_id` kan allerede være tom. Ny sjekk i databasen: er `user_id` tom, må `deactivated_at` være satt.
6. **Unikhet blant rader som ikke er slettet:** `org_number` per organisasjon, og kontornavn per organisasjon (delvise unike indekser med `WHERE deleted_at IS NULL`). `org_number` har sjekk på 9 siffer når den er fylt ut.
7. **Indekser** `(organization_id, legal_name)` og `(organization_id, sort_order)` (funn 13 fra nattløkken), og indeks på `employees.company_id` og `employees.office_id`.
8. **Migrering** med `pnpm db:generate` (neste nummer etter `0003`). Ingen endring i eldre migreringer.
9. **Spørringer i `src/core/organization/`** (lesing, med tilgangssjekk først):
   - `listCompanies(actor, organizationId)`: selskaper som ikke er slettet, sortert på navn.
   - `listOffices(actor, organizationId)`: kontorer som ikke er slettet, sortert på `sort_order`, så navn.
   - `listEmployees(actor, organizationId, { includeDeactivated })`: ansatte som ikke er slettet, med selskapsnavn og kontornavn. Som standard bare aktive; med `includeDeactivated: true` også de som har sluttet (også uten innlogging). Ingen e-post eller innloggingsdata i svaret.
   - Alle kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og filtrerer på `grant.organizationId`. Selskap eller kontor som er slettet, vises ikke på den ansatte (tomt navn).
10. **Seed av Byggcon:** de fire selskapene og fem kontorene fra domenemodellen 4.1 (Byggcon AS, Byggcon Nord AS, Byggcon Helgeland AS, Byggcon Troms AS; Bodø, Mo i Rana, Mosjøen, Narvik, Tromsø), med bare navn og rekkefølge. Org.nr., adresse, forsikring og firmatekst står tomme og fylles ut av admin (beslutning A13). Seed tåler å kjøres flere ganger (finnes navnet, lages ikke ny rad). Admin får ikke selskap eller kontor av seed.
11. **Testfabrikker** i `tests/factories.ts`: `createCompany`, `createOffice`, og `createEmployee` som kan ta selskap og kontor. Oppdiktede verdier (for eksempel org.nr. `000000001`, forsikringsselskapet «Testforsikring»).
12. **Ordlisten** (`docs/05-domenemodell.md` avsnitt 8): «Firmatekst» → `companies.company_text` og «Sluttet» → `employees.deactivated_at` (lagt inn av prosjektlederen i denne commiten).
13. Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Admin-skjermbilder for å opprette eller endre selskaper, kontorer og ansatte (eget punkt i fase 0b). Derfor heller ingen skrivefunksjoner (opprett, endre, myk sletting) i `src/core/organization` ennå; de lages sammen med skjermene, med revisjonslogg.
- `logo_file_id`, `signature_file_id`, `photo_file_id` (venter på felles filtjeneste), `accounting_connection_id` (venter på tilkoblingslaget), `default_report_profile_id` (rapportprofiler kommer i fase 2a). Kolonnene legges til når tabellene de peker på finnes (beslutning A14).
- Sertifisering (`certifications`), enkeltrettigheter (`employee_permissions`), nye rettigheter eller roller. Eget punkt i fase 0b.
- Endringer i tilgangssjekken (`findGrant`). Den nekter allerede ansatte med `deactivated_at` og bruker uten ansatt-rad.
- Synk av selskaper og kontorer til iPaden (kommer med valgt synkløsning, fase 2b).
- Synkkandidatene, ADR 0004 og UU-funnene fra nattløkken (andre kjøringer jobber med dem).
- Validering av org.nr. med kontrollsiffer (MOD11). Kommer med admin-skjemaet.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | selskaper, kontorer, ansatte (`organization.read`) | nei (ingen skriving i denne oppgaven) |
| kontor | som takstmann | nei |
| leder | som takstmann | nei |
| admin | som takstmann | senere, i admin-skjermene (`organization.manage`) |

Ingen ny rettighet. Admin stenges ikke ute.

## Data
- Nye tabeller: `companies`, `offices`.
- Endret: `employees` (`company_id`, `office_id`, `phone`, sjekk på `user_id`/`deactivated_at`).
- `docs/05-domenemodell.md` 4.1: legg til en linje om at kolonnene i A14 kommer senere, og at `company_id`/`office_id` kan være tomme til admin har fylt dem ut.
- Ingen faste koder (`key`) tas i bruk.

## Skjermer
Ingen. Ingen e2e i denne oppgaven, fordi ingenting vises. iPad-størrelse prøves når admin-skjermene lages.

## Regler
Ingen fagregler. Databaseregler (sjekk og fremmednøkler) prøves med tester.

## Akseptkriterier
- [ ] Migreringen kjører på tom database og på en database med dagens data (admin uten selskap). `pnpm db:migrate` to ganger gir ingen feil.
- [ ] `listCompanies`, `listOffices` og `listEmployees` har hver sitt kall til `expectTenantIsolation`.
- [ ] Slettede selskaper, kontorer og ansatte (`deleted_at`) vises ikke (test per spørring).
- [ ] `listEmployees` uten valg viser ikke ansatte som har sluttet; med `includeDeactivated: true` vises også en ansatt uten innlogging (test).
- [ ] Databasen avviser en ansatt med tom `user_id` uten `deactivated_at` (test).
- [ ] Databasen avviser en ansatt som peker på selskap eller kontor i en annen organisasjon (test).
- [ ] Databasen avviser to aktive selskaper med samme org.nr. i samme organisasjon, men tillater det når det ene er slettet (test).
- [ ] Org.nr. som ikke er 9 siffer avvises (test).
- [ ] En ansatt som har sluttet, eller en bruker uten ansatt-rad, får `AccessDeniedError` (test, finnes kanskje fra før; da holder det å vise til den).
- [ ] Seed gir fire selskaper og fem kontorer, og en kjøring til gir ingen nye rader (test i `src/db/seed/run.test.ts`).
- [ ] Svaret fra `listEmployees` har ingen e-post eller innloggings-id (test).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.
- [ ] Ingen ny avhengighet. Versjonen er økt.

## Beslutninger tatt av agentene (autonom modus)
Føres i `docs/09-apne-sporsmal.md`. Numrene kan bli flyttet hvis en annen kjøring bruker samme nummer først.
- **A13:** Seed lager bare navnene på Byggcons fire selskaper og fem kontorer (fra domenemodellen 4.1). Org.nr., adresse, forsikring og firmatekst fylles ut av admin. Grunn: oppdiktede tall i seed ville havnet i drift; ekte tall skal admin legge inn selv (planens «ferdig når»).
- **A14:** Felt som peker på tabeller som ikke finnes ennå (logo, signatur, profilbilde, regnskapstilkobling, rapportprofil), legges til når tabellene lages. Grunn: det enkleste som virker, og ingen kolonner uten fremmednøkkel.

## Roller
- **utvikler:** skjema, migrering, spørringer, seed, fabrikker (én bit).
- **testskriver:** tester for spørringer, databaseregler og seed (egen bit, i parallell; avtal signaturene over).
- **sikkerhet-personvern:** tenant-isolasjon, sammensatte fremmednøkler, at `listEmployees` ikke lekker e-post.
- **test-leder:** godkjenner testdekning mot akseptkriteriene.

Ikke nødvendig: arkitekt (følger domenemodellen og eksisterende mønster), ux, ui (ingen skjermer), ki-ansvarlig, fagansvarlig (ingen fagtekst).

## Åpne spørsmål
- Ingen til Ståle. A13 og A14 er ført som beslutninger.
