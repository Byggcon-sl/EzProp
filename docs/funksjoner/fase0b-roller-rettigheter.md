# Funksjon: Roller og rettigheter i én felles tilgangsmodul

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/access`, `src/core/organization`, skjema i `src/db/schema`)
- **Branch:** `fase0b-roller-rettigheter` (bygger på `main`)
- **Status:** utkast (31.10.2026)
- **Støtter hovedmål:**
  - **Reklamasjoner:** bare de som skal, kan publisere, endre systemmalen og se reklamasjonssaker. Tilgangen står ett sted og er testet per rolle, slik at en feil i ett skjermbilde ikke åpner for feil person.
  - **Tid:** ingen venting på at noen «får tilgang». Alle takstmenn kan endre alt fra start (Ståle 27.10.2026), og alle kan sende fakturagrunnlag. Strammes det inn, er det én innstilling, ikke ny kode.
  - **KI først:** se under.

## Problem
I dag har tilgangsmodulen fire rettigheter (`organization.read`, `organization.manage`, `claims.read`, `staff.manage`) og ingen måte å gi enkeltrettigheter på. Fase 2a trenger å skille mellom å se, endre oppdrag, endre rapportinnhold, publisere og endre systemmalen (maltilgang for fagansvarlig). Ståles beslutning 27.10.2026 (alle takstmenn endrer alt) må være en innstilling som er lett å slå av. Lar vi være, havner tilgangsregler spredt i skjermene i fase 2a, og det blir dyrt å stramme inn.

## KI først
KI har ingen rolle i selve tilgangsmodulen. Men den er forutsetningen for KI senere: KI-forslag skal aldri kunne publiseres uten en person med rettigheten `report.publish` (KI publiserer aldri selv). Ingen KI i denne oppgaven.

## Brukerhistorier
- Som **admin** vil jeg kunne gi én ansatt maltilgang uten å gjøre personen til admin, slik at fagansvarlig kan rette systemmalen.
- Som **takstmann** vil jeg kunne se og endre alle oppdrag og sende fakturagrunnlag uten å be om tilgang.
- Som **leder** vil jeg at innstrammingen er én innstilling, slik at jeg ikke trenger utviklere hvis «alle endrer alt» blir et problem.
- Som **admin** vil jeg aldri kunne bli stengt ute, uansett innstilling eller enkeltrettigheter.

## Omfang
**Med:**
1. **Rettighetene i `src/core/access/permissions.ts`** (bare det fase 0b–2a trenger). Eksisterende beholdes uendret (faste koder):
   | Rettighet | Hva | Takstmann | Kontor | Leder | Admin |
   |---|---|---|---|---|---|
   | `organization.read` | Se oppdrag og data | ja | ja | ja | ja |
   | `organization.manage` | Ansatte, roller, rettigheter, selskaper, kontorer, innstillinger | nei | nei | nei | ja |
   | `claims.read` | Se reklamasjonssaker | nei | nei | ja | ja |
   | `staff.manage` | Krav om sidemannskontroll, rutiner for alle, sperring av enheter | nei | nei | ja | ja |
   | `assignment.edit` (ny) | Endre ordre, oppdrag, parter, befaringstid, dokumenter | **ja når `access.inspectors_edit_all` er på** | ja | ja | ja |
   | `report.edit` (ny) | Endre rapportinnhold | **ja når `access.inspectors_edit_all` er på** | nei | ja | ja |
   | `report.publish` (ny) | Publisere og overstyre sperre (ansvarlig og sertifisert sjekkes i fase 2a) | ja | nei | ja | ja |
   | `template.edit_structure` (ny) | Endre struktur i systemmalen (maltilgang) | nei (kan gis) | nei | nei (kan gis) | ja |
   | `invoice.send` (ny) | Sende fakturagrunnlag (alle, 27.10.2026) | ja | ja | ja | ja |
   Hver rettighet har en kort norsk kommentar. Admin har alltid `[...permissions]`.
2. **Ren funksjon** `effectivePermissions(roles, grantedPermissions, settings)` i `permissions.ts`: roller + enkeltrettigheter + innstilling. Ukjente rettighetsnavn fra databasen ignoreres (arkiverte koder). Admin får alle uansett. Enhetstester uten database.
3. **Tabellen `employee_permissions`** med `baseColumns` (organisasjons-id, myk sletting, `row_version`) og `employee_id`, `permission` (tekst), `granted_by_employee_id`, `granted_at` (standard nå). Sammensatt fremmednøkkel `(organization_id, employee_id)` og `(organization_id, granted_by_employee_id)` mot `employees` (krever unik indeks `(organization_id, id)` på `employees`, som for `companies`). Delvis unik indeks `(employee_id, permission) WHERE deleted_at IS NULL`. Migrering med `pnpm db:generate` (neste nummer etter `0004`).
4. **Innstillingen `access.inspectors_edit_all`**, standard **på**. Leses fra `organizations.settings` (jsonb som finnes i dag); mangler nøkkelen eller er verdien ikke `true`/`false`, gjelder `true`. Ingen ny tabell (beslutning A18, se under). Lesingen ligger i `src/core/access`.
5. **`requireOrganizationAccess`** henter enkeltrettigheter (ikke slettede, samme organisasjon) og innstillingen i samme sjekk, og regner ut `permissions` med `effectivePermissions`. `EmployeeGrant` får feltet `permissions: readonly Permission[]`. Ny hjelper `grantHasPermission(grant, permission)`. En ansatt uten roller men med en enkeltrettighet får den rettigheten (og `organization.read` må fortsatt finnes for å se noe). Kallsignaturen er uendret, så modulene trenger ingen endring.
6. **Gi og ta bort enkeltrettigheter** (uten skjerm) i `src/core/organization/employee-permissions.ts`: `grantEmployeePermission(actor, organizationId, employeeId, permission)` og `revokeEmployeePermission(...)` (myk sletting), begge krever `organization.manage`, sjekker at den ansatte finnes i `grant.organizationId`, validerer rettigheten med Zod mot listen, og skriver revisjonslogg (`action: "permission_change"`) i samme transaksjon. Å gi en rettighet personen alt har, gjør ingenting (ingen feil). `listEmployeePermissions(actor, organizationId, employeeId)` krever `organization.manage`.
7. **Tester:**
   - Per rolle: hva den kan og ikke kan, med innstillingen på og av (tabelltest).
   - **Admin stenges aldri ute:** admin har alle rettigheter med innstillingen av, uten enkeltrettigheter, og med slettede enkeltrettigheter. Testen merkes «skal aldri fjernes».
   - Enkeltrettighet: takstmann får `template.edit_structure` når den er gitt, mister den når den er tatt bort (myk sletting), og rettigheten gitt i organisasjon A virker ikke i B.
   - Innstillingen påvirker aldri `claims.read`, `organization.manage` eller `staff.manage`.
   - Ukjent verdi i innstillingen eller ukjent rettighetsnavn i tabellen gir ingen krasj.
   - `expectTenantIsolation` for `listEmployeePermissions`, og at `grantEmployeePermission` ikke kan gi rettighet til en ansatt i en annen organisasjon (avvises også av databasen).
   - Gi/ta bort skriver revisjonslogg; bare admin kan gi.
8. **Testfabrikk** `grantPermission(employee, permission)` i `tests/factories.ts`, og `resetDatabase` tømmer `employee_permissions`.
9. **Dokumenter:** `docs/05-domenemodell.md` avsnitt 4.1 (`employee_permissions` med de faktiske feltnavnene), avsnitt 5 (navnet `claims.view` rettes til `claims.read`, som koden bruker), avsnitt 8 (ordlisten: nye rettigheter). Beslutning A18 i `docs/09-apne-sporsmal.md`. Versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Admin-skjermer for roller, enkeltrettigheter og innstillinger (eget punkt i planen).
- En funksjon for å endre innstillingen `access.inspectors_edit_all` (kommer med admin-skjermene, med revisjonslogg). Til da endres den med én oppdatering i databasen.
- Egen tabell `settings` med organisasjon, selskap og person som nivåer (lages når første innstilling trenger selskap eller person).
- Team på oppdraget og regelen «endre bare der du er i teamet» når innstillingen er av (fase 2a, når oppdrag med team finnes). Til da har takstmann uten innstillingen ingen rett til å endre.
- Sidemann som ikke retter (rolle på oppdraget, fase 2a).
- Sjekk av ansvarlig og sertifisering ved publisering (eget punkt: sertifisering med utløpsdato, og fase 2a).
- Rettigheter for senere faser (prisliste, avtaler, tilkoblinger, enheter, egne rutiner, kunde og megler).
- Registrering av reklamasjoner (egen rettighet når punktet kommer i fase 2a).
- Endring av roller og vern mot å fjerne siste admin (hører til admin-skjermene).
- Ingen endring i `offline-trial`-modulen utover det typene krever.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Alt unntatt reklamasjonssaker | Oppdrag og rapporter når innstillingen er på; aldri rettigheter |
| kontor | Alt unntatt reklamasjonssaker | Oppdrag, ikke rapportinnhold; aldri rettigheter |
| leder | Alt, også reklamasjoner | Oppdrag og rapporter; ikke rettigheter |
| admin | Alt | Alt, også gi og ta bort enkeltrettigheter. Stenges aldri ute. |

## Data
- Ny tabell `employee_permissions` (se Omfang 3). Ny unik indeks `employees (organization_id, id)`.
- Ingen ny kolonne i `organizations`; nøkkelen `access.inspectors_edit_all` i `organizations.settings`.
- Faste koder som tas i bruk: `assignment.edit`, `report.edit`, `report.publish`, `template.edit_structure`, `invoice.send`, innstillingen `access.inspectors_edit_all`.

## Skjermer
Ingen.

## Regler
Ingen fagregler. Rettighetsmatrisen er kode med tabelltester.

## Akseptkriterier
- [ ] Rettighetene i tabellen over finnes, og hver rolle har en test som viser hva den kan og ikke kan, med innstillingen på og av.
- [ ] Innstillingen mangler → takstmann kan endre (standard på). Innstillingen `false` → takstmann kan se, publisere og sende fakturagrunnlag, men ikke `assignment.edit` eller `report.edit`.
- [ ] Admin har alle rettigheter i alle tilfeller (test som aldri skal fjernes).
- [ ] Admin kan gi og ta bort en enkeltrettighet, det står i revisjonsloggen, og effekten vises i neste `requireOrganizationAccess`.
- [ ] Andre enn admin kan ikke gi eller ta bort rettigheter.
- [ ] Bruker i annen organisasjon får ikke tilgang (test med `expectTenantIsolation`), og rettighet gitt i A virker ikke i B.
- [ ] Ingen slettet rad i `employee_permissions` gir rettighet.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (ingen ny e2e; eksisterende må fortsatt gå, også i iPad-størrelse).
- [ ] Ingen ny avhengighet.

## Avgjort av agentene (autonom modus)
- **A18 (31.10.2026):** Innstillingen `access.inspectors_edit_all` lagres i `organizations.settings` (jsonb som finnes), standard på. Egen tabell `settings` med tre nivåer venter til en innstilling trenger selskap eller person. *Hvorfor:* enkleste som virker, bare organisasjonsnivå trengs nå (`docs/05-domenemodell.md` 4.12 og avsnitt 5, Ståle 27.10.2026). *Endres ved:* flytt nøkkelen til tabellen `settings` når den lages.
- **A19 (31.10.2026):** Publisere og overstyre sperre er én rettighet (`report.publish`) til fase 2a, fordi matrisen gir dem til de samme rollene. Ansvarlig og sertifisert sjekkes per rapport i fase 2a. *Endres ved:* ny rettighet `report.override_block` hvis Ståle vil skille dem.
- **A20 (31.10.2026):** Takstmann uten innstillingen har ingen rett til å endre før team på oppdraget finnes (fase 2a). *Hvorfor:* tryggeste standard når innstillingen slås av; matrisen sier «bare der den er i teamet». Innstillingen er på, så ingen merker det nå.

## Roller
- **utvikler:** rettigheter, `effectivePermissions`, skjema og migrering, tilgangssjekken, gi/ta bort, fabrikk, dokumenter.
- **testskriver** (i parallell): tabelltester per rolle og innstilling, admin aldri ute, tenant-isolasjon, revisjonslogg. Bygger på kontrakten i dette kortet (navnene i Omfang 2, 5 og 6).
- **sikkerhet-personvern:** gjennomgang av tilgangssjekken og at filtrering skjer på `grant.organizationId`.
- **test-leder:** testplan og godkjenning.

Ikke med: ux-ansvarlig, ui-designer (ingen skjermer), fagansvarlig (ingen fagtekst), KI-rolle, arkitekt (ingen ny arkitektur; følger matrisen og eksisterende mønster).

## Åpne spørsmål
- Ingen som stopper. A18–A20 føres i `docs/09-apne-sporsmal.md` og nevnes i PR-en.
