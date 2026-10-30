# Funksjon: Organisasjon → selskap → kontor → ansatt

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/organization`, skjema i `src/db/schema`)
- **Branch:** `fase0b-organisasjon-selskap-kontor` (bygger på `main`)
- **Status:** klar til bygging (endret etter forenkler og test-leder 30.10.2026)
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
3. **`employees` får** `company_id` og `office_id`. `company_id` og `office_id` kan være tomme i databasen (den første admin finnes allerede uten selskap). Bare ett selskap per ansatt (Ståle 23.10.2026, svar 3).
4. **Databasen sikrer at selskap og kontor hører til samme organisasjon som den ansatte:** unik indeks `(organization_id, id)` på `companies` og `offices`, og sammensatt fremmednøkkel `(organization_id, company_id)` og `(organization_id, office_id)` fra `employees`.
5. **Sluttet uten innlogging (D18):** `employees.user_id` kan allerede være tom. Ny sjekk i databasen: er `user_id` tom, må `deactivated_at` være satt.
6. **Unikhet blant rader som ikke er slettet:** `org_number` per organisasjon, og kontornavn per organisasjon (delvise unike indekser med `WHERE deleted_at IS NULL`). `org_number` har sjekk på 9 siffer når den er fylt ut.
7. **Migrering** med `pnpm db:generate` (neste nummer etter `0003`). Ingen endring i eldre migreringer.
8. **Spørringer i `src/core/organization/`** (lesing, med tilgangssjekk først):
   - `listCompanies(actor, organizationId)`: selskaper som ikke er slettet, sortert på navn.
   - `listOffices(actor, organizationId)`: kontorer som ikke er slettet, sortert på `sort_order`, så navn.
   - `listEmployees(actor, organizationId, { includeDeactivated })`: ansatte som ikke er slettet, med selskapsnavn og kontornavn. Som standard bare aktive; med `includeDeactivated: true` også de som har sluttet (også uten innlogging). Én spørring med left join til `companies` og `offices`, der `deleted_at IS NULL` for selskap og kontor står i join-betingelsen (slettet selskap eller kontor gir tomt navn). `select` velger bare feltene som er lovet: `id`, `name`, `jobTitle`, `companyName`, `officeName`, `deactivatedAt` (står fast i testen). Ingen egen mapper eller DTO. Ingen e-post eller innloggings-id.
   - Alle kaller `requireOrganizationAccess(actor, organizationId, "organization.read")` og filtrerer på `grant.organizationId` fra tilgangssjekken, aldri direkte på `organizationId`-argumentet (sjekkes i gjennomgangen).
9. **Seed av Byggcon:** de fire selskapene og fem kontorene fra domenemodellen 4.1 (Byggcon AS, Byggcon Nord AS, Byggcon Helgeland AS, Byggcon Troms AS; Bodø, Mo i Rana, Mosjøen, Narvik, Tromsø), med bare navn og rekkefølge. Org.nr., adresse, forsikring og firmatekst står tomme og fylles ut av admin (beslutning A16). Seed tåler å kjøres flere ganger: kontorer settes inn med `ON CONFLICT DO NOTHING` mot den delvise unike indeksen på navn; for selskaper sjekkes `legal_name` før innsetting. Sjekken for selskaper ser på alle rader, også slettede, slik at seed aldri lager på nytt et selskap admin har slettet. (Et slettet kontor lages derimot på nytt, fordi den delvise indeksen bare gjelder aktive rader; se «Avgjort» under.) Ingen ny hjelpefunksjon for dette. Admin får ikke selskap eller kontor av seed.
10. **Testfabrikker** i `tests/factories.ts`: `createCompany`, `createOffice`, og `createEmployee` som kan ta selskap og kontor (valgfritt, så alle dagens kall, også i `tests/tenant-isolation.ts`, virker uendret). `resetDatabase` tømmer også `companies` og `offices`. Oppdiktede verdier (for eksempel org.nr. `000000001`, forsikringsselskapet «Testforsikring»).
11. **Ordlisten** (`docs/05-domenemodell.md` avsnitt 8): «Firmatekst» → `companies.company_text` og «Sluttet» → `employees.deactivated_at` (lagt inn av prosjektlederen i denne commiten).
12. Versjon i `package.json` økes (patch).
13. **CI** (`.github/workflows/ci.yml`): testjobben kjører `pnpm db:migrate` to ganger, slik at det prøves hver gang at migreringene tåler å kjøres på nytt.

**Ikke med (bevisst utelatt):**
- Admin-skjermbilder for å opprette eller endre selskaper, kontorer og ansatte (eget punkt i fase 0b). Derfor heller ingen skrivefunksjoner (opprett, endre, myk sletting) i `src/core/organization` ennå; de lages sammen med skjermene, med revisjonslogg.
- `logo_file_id`, `signature_file_id`, `photo_file_id` (venter på felles filtjeneste), `accounting_connection_id` (venter på tilkoblingslaget), `default_report_profile_id` (rapportprofiler kommer i fase 2a). Kolonnene legges til når tabellene de peker på finnes (beslutning A17).
- Sertifisering (`certifications`), enkeltrettigheter (`employee_permissions`), nye rettigheter eller roller. Eget punkt i fase 0b.
- Endringer i tilgangssjekken (`findGrant`). Den nekter allerede ansatte med `deactivated_at` og bruker uten ansatt-rad.
- Synk av selskaper og kontorer til iPaden (kommer med valgt synkløsning, fase 2b).
- Synkkandidatene, ADR 0004 og UU-funnene fra nattløkken (andre kjøringer jobber med dem).
- Validering av org.nr. med kontrollsiffer (MOD11). Kommer med admin-skjemaet.
- `phone` på `employees`. Telefon er en del av den felles profilen med Optiplan (punktet om innlogging i fase 0b, spørsmål nr. 4), og hvor den lagres avgjøres i innloggings-ADR-en. Legges til der eller med admin-skjermene. Ingen endring i domenemodellen.
- Ekstra indekser for ytelse (`(organization_id, legal_name)`, `(organization_id, sort_order)`, `employees.company_id`, `employees.office_id`). Få rader per organisasjon, og myk sletting gjør at det aldri blir `DELETE` som må slå opp i `employees`. De unike indeksene i punkt 4 og 6 beholdes, fordi de er dataregler.

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
- Endret: `employees` (`company_id`, `office_id`, sjekk på `user_id`/`deactivated_at`).
- `docs/05-domenemodell.md` 4.1: legg til en linje om at kolonnene i A17 kommer senere, og at `company_id`/`office_id` kan være tomme til admin har fylt dem ut.
- Ingen faste koder (`key`) tas i bruk.

## Skjermer
Ingen. Ingen e2e i denne oppgaven, fordi ingenting vises. iPad-størrelse prøves når admin-skjermene lages.

## Regler
Ingen fagregler. Databaseregler (sjekk og fremmednøkler) prøves med tester.

## Akseptkriterier
**Migrering**
- [ ] Migreringen kjører på tom database (CI) og på utviklingsdatabasen etter `pnpm db:seed` (admin uten selskap). PR-en viser at `pnpm db:migrate` er kjørt to ganger der uten feil.
- [ ] CI kjører `pnpm db:migrate` to ganger i testjobben.

**Spørringer** (`src/core/organization/*.test.ts`, mot testdatabasen)
- [ ] `listCompanies`, `listOffices` og `listEmployees` har hver sitt kall til `expectTenantIsolation`.
- [ ] Tilgang per rolle, for hver av de tre spørringene: takstmann, kontor og leder kan lese; en ansatt uten roller får `AccessDeniedError`.
- [ ] Slettede selskaper, kontorer og ansatte (`deleted_at`) vises ikke (test per spørring).
- [ ] En ansatt med slettet selskap eller slettet kontor vises med tomt selskaps- eller kontornavn (test).
- [ ] `listCompanies` sorterer på navn. `listOffices` sorterer på `sort_order` og så navn, prøvd med to kontorer med samme `sort_order` (test).
- [ ] `listEmployees` uten valg viser ikke ansatte som har sluttet; med `includeDeactivated: true` vises også en ansatt uten innlogging (test).
- [ ] Feltene i svaret fra `listEmployees` er nøyaktig de lovede (sammenligning av nøklene, ikke bare at `email` mangler).

**Databaseregler** (egen testfil)
- [ ] Ansatt med tom `user_id` uten `deactivated_at` avvises; tom `user_id` med `deactivated_at` godtas.
- [ ] Ansatt som peker på selskap i en annen organisasjon avvises, både ved innsetting og oppdatering. Det samme for kontor.
- [ ] To aktive selskaper med samme org.nr. i samme organisasjon avvises; det er lov når det ene er slettet.
- [ ] To aktive kontorer med samme navn i samme organisasjon avvises; det er lov når det ene er slettet.
- [ ] Org.nr. med 8 siffer, 10 siffer og bokstaver avvises; tom verdi og `000000001` godtas.

**Tilgang for den som har sluttet**
- [ ] Dekkes av eksisterende tester i `src/core/access/guards.test.ts`: «nekter når den ansatte er fjernet (myk sletting) eller har sluttet» og «nekter noen som ikke er ansatt, ukjent id og ugyldig id» (bruker uten ansatt-rad). Ingen ny test, `findGrant` endres ikke, så admin stenges ikke ute.

**Seed** (`src/db/seed/run.test.ts`)
- [ ] Seed gir fire selskaper og fem kontorer, og en kjøring til gir ingen nye rader.
- [ ] Et selskap som er slettet, lages ikke på nytt av seed.
- [ ] Admin får ikke selskap eller kontor av seed.

**Felles**
- [ ] `resetDatabase` tømmer `companies` og `offices`; dagens bruk av `createEmployee` virker uendret.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (ingen nye e2e).
- [ ] Ingen ny avhengighet. Versjonen er økt.

## Avgjort av prosjektlederen (30.10.2026)
- **Forenkler, alle fem punkter tatt inn.** `phone` ut (hører til felles profil og innloggings-ADR-en), ytelsesindekser ut (få rader, myk sletting), henvisning til eksisterende tilgangstest i stedet for ny, én spørring med left join uten mapper, enkel idempotens i seed.
- **Test-leder, alle ti punkter tatt inn.** Tilgang per rolle og tenant-isolasjon er krav for godkjenning.
- **Motstrid seed og slettede rader:** test-leder vil at seed aldri lager slettede rader på nytt; forenkler vil ha `ON CONFLICT DO NOTHING` mot den delvise indeksen for kontorer, som bare ser aktive rader. Avgjort: selskaper sjekkes mot alle rader (også slettede), fordi et slettet selskap kan stå på gamle rapporter og ikke skal dukke opp igjen. Kontorer bruker `ON CONFLICT DO NOTHING` som forenkler foreslår; et slettet kontor kan lages på nytt av seed. Det er ufarlig (kontoret har ingen forsikring eller firmatekst) og holder seed enkel. Testen for slettede rader gjelder derfor bare selskaper.
- **CI kjører migreringen to ganger:** én linje i CI, og gir sikkerhet for at migreringene tåler ny kjøring hver gang.

## Beslutninger tatt av agentene (autonom modus)
Føres i `docs/09-apne-sporsmal.md`. Numrene kan bli flyttet hvis en annen kjøring bruker samme nummer først.
- **A16:** Seed lager bare navnene på Byggcons fire selskaper og fem kontorer (fra domenemodellen 4.1). Org.nr., adresse, forsikring og firmatekst fylles ut av admin. Grunn: oppdiktede tall i seed ville havnet i drift; ekte tall skal admin legge inn selv (planens «ferdig når»).
- **A17:** Felt som peker på tabeller som ikke finnes ennå (logo, signatur, profilbilde, regnskapstilkobling, rapportprofil), legges til når tabellene lages. Grunn: det enkleste som virker, og ingen kolonner uten fremmednøkkel.

## Roller
- **utvikler:** skjema, migrering, spørringer, seed, fabrikker (én bit).
- **testskriver:** tester for spørringer, databaseregler og seed (egen bit, i parallell; avtal signaturene over).
- **sikkerhet-personvern:** tenant-isolasjon, sammensatte fremmednøkler, at `listEmployees` ikke lekker e-post.
- **test-leder:** godkjenner testdekning mot akseptkriteriene.

Ikke nødvendig: arkitekt (følger domenemodellen og eksisterende mønster), ux, ui (ingen skjermer), ki-ansvarlig, fagansvarlig (ingen fagtekst).

## Åpne spørsmål
- Ingen til Ståle. A16 og A17 er ført som beslutninger.
