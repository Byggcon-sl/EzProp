# Funksjon: Roller og rettigheter i én felles tilgangsmodul

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/access`, `src/core/organization`, skjema i `src/db/schema`)
- **Branch:** `fase0b-roller-rettigheter` (bygger på `main`)
- **Status:** klar til bygging, runde 1 innarbeidet (31.10.2026)
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
   I tillegg en egen liste **`grantablePermissions`** = `template.edit_structure`, `assignment.edit`, `report.edit`, `report.publish`. Bare disse kan gis som enkeltrettighet (A21). `organization.manage`, `staff.manage`, `claims.read`, `organization.read` og `invoice.send` kan ikke gis. `rolesHavePermission` gjøres intern (eksporteres ikke fra `@/core/access`); modulene bruker `grantHasPermission`.
2. **Ren funksjon** `effectivePermissions(roles, grantedPermissions, settings)` i `permissions.ts`: rettighetene fra rollene (med innstillingen) pluss enkeltrettighetene. Ingenting annet legges til automatisk. Navn i `grantedPermissions` som ikke står i `grantablePermissions` (ukjente, arkiverte, eller `organization.manage` satt rett inn i databasen) ignoreres uten krasj (fail-closed). Admin får alle uansett, uavhengig av `employee_permissions`. Enhetstester uten database.
3. **Tabellen `employee_permissions`** med `baseColumns` (organisasjons-id, myk sletting, `row_version`) og `employee_id`, `permission` (tekst). Hvem som ga rettigheten og når, står i `created_by` og `created_at` fra `baseColumns` og i revisjonsloggen; ingen egne kolonner for det. Én sammensatt fremmednøkkel `(organization_id, employee_id)` mot `employees` (krever unik indeks `(organization_id, id)` på `employees`, som for `companies`). Delvis unik indeks `(employee_id, permission) WHERE deleted_at IS NULL`. Migrering med `pnpm db:generate` (neste nummer etter `0004`). Rader slettes aldri og settes aldri tilbake: å ta bort setter `deleted_at` og `deleted_by`; å gi på nytt lager en ny rad.
4. **Innstillingen `access.inspectors_edit_all`**, standard **på**. Leses fra `organizations.settings` (jsonb som finnes i dag). Bare verdien `false` (boolean) slår den av. Mangler nøkkelen, eller er verdien noe annet (`null`, `"false"` som tekst, `0`, objekt), gjelder `true`. Finnes nøkkelen, men verdien ikke er boolean, logges en advarsel med bare organisasjons-id og nøkkel (ingen persondata), slik at en skrivefeil ved innstramming blir oppdaget. Ingen ny tabell (A18). Lesingen ligger i `src/core/access`.
5. **`requireOrganizationAccess`** henter roller, enkeltrettigheter og innstillingen i samme sjekk og regner ut `permissions` med `effectivePermissions`. Innstillingen leses fra `organizations.settings` i den samme spørringen som allerede joiner organisasjonen (ikke eget oppslag på id fra kalleren). Spørringene mot roller og `employee_permissions` filtrerer på både `employee_id` = den ansattes id og `organization_id` = organisasjonen fra den ansatt-raden, pluss `deleted_at IS NULL`. `EmployeeGrant` får feltet `permissions: readonly Permission[]`. Ny hjelper `grantHasPermission(grant, permission)`. Sjekken ser bare på rettigheten som blir spurt om; det finnes ingen egen kodevei for ansatte uten roller (se akseptkriteriene). Kallsignaturen er uendret, så modulene trenger ingen endring.
6. **Gi og ta bort enkeltrettigheter** (uten skjerm) i `src/core/organization/employee-permissions.ts`: `grantEmployeePermission(actor, organizationId, employeeId, permission)` og `revokeEmployeePermission(...)`.
   - Begge krever `organization.manage` (i praksis bare rollen admin, fordi `organization.manage` ikke kan gis).
   - Den ansatte må finnes i `grant.organizationId`, ikke være slettet og ikke deaktivert. Ellers `AccessDeniedError`.
   - Rettigheten valideres med Zod mot `grantablePermissions`.
   - Revisjonslogg (`action: "permission_change"`) skrives i samme transaksjon som raden. `organizationId` = `grant.organizationId`, `actorEmployeeId` = `grant.employeeId`, og `changes` inneholder bare `{ permission, employeeId, granted | revoked }`, aldri navn eller e-post.
   - **Gi en rettighet personen alt har:** ingen ny rad, ingen ny linje i revisjonsloggen, ingen feil. To kall samtidig gir én rad uten krasj (`onConflictDoNothing` mot den delvise unike indeksen). Funksjonen returnerer den aktive raden (ny eller eksisterende).
   - **Ta bort en rettighet som ikke er gitt:** ingen feil og ingen linje i revisjonsloggen.
   - Ingen `listEmployeePermissions` nå; den kommer med admin-skjermene.
7. **Tester** (testplanen fra test-leder, med endringene over):
   - `src/core/access/permissions.test.ts` (uten database): tabelltest 4 roller × innstilling på/av/mangler/ugyldige verdier (`null`, `"false"`, `0`, objekt gir på), alle ni rettigheter sjekket ja og nei. Innstillingen påvirker aldri `claims.read`, `organization.manage` eller `staff.manage`. Kontor har aldri `report.edit` eller `report.publish`. Leder får `template.edit_structure` bare når den er gitt. Enkeltrettighet virker også med innstillingen av. Ukjente navn og `organization.manage`/`staff.manage`/`claims.read` i `grantedPermissions` ignoreres. **«Admin stenges aldri ute, skal aldri fjernes»**: admin har alle rettigheter med innstillingen av, uten enkeltrettigheter og med ukjente navn.
   - `src/core/access/guards.test.ts` (database): per rolle med innstillingen på og av. **«Admin stenges aldri ute, skal aldri fjernes»**: innstillingen av, bare slettede rader i `employee_permissions`, admin får alt; `isAdmin` og `grantHasPermission` for admin er uavhengige av tabellen. Enkeltrettighet virker i neste kall og forsvinner etter myk sletting. Rad med ukjent navn eller `organization.manage` satt rett inn gir ingen rettighet og ingen krasj. Tenant: rettighet gitt i A virker ikke i B for samme bruker ansatt i begge, og innstillingen av i B påvirker ikke A. Ansatt uten roller med enkeltrettighet (se akseptkriteriene). Advarsel logges ved ugyldig innstillingsverdi, uten persondata. Eksisterende `toEqual` på grant oppdateres med `permissions`.
   - `src/core/organization/employee-permissions.test.ts` (database): `expectTenantIsolation` for `grantEmployeePermission` (seed gir rettigheten i A og B; spørringen gir den igjen og får tilbake samme rad, som også viser idempotensen) og for `revokeEmployeePermission` (fremmed organisasjon gir `AccessDeniedError`). Ansatt i annen organisasjon avvises; direkte insert med feil organisasjon avvises av databasen. Takstmann, kontor og leder (også leder med `template.edit_structure`) får `AccessDeniedError` på gi og ta bort. Revisjonslogg med riktige felt og bare tillatt innhold, i samme transaksjon. Idempotens og samtidige kall. Ta bort ikke-gitt. Gi, ta bort, gi igjen: ny rad, den gamle står med `deleted_at`. Ugyldig og ikke-tillatt rettighet (for eksempel `organization.manage`) avvises med Zod. Slettet og deaktivert ansatt avvises.
   - `tests/factories.test.ts`: `grantPermission` virker, og `resetDatabase` tømmer `employee_permissions`.
   - Ingen ny e2e; eksisterende går grønt i PC og iPad.
8. **Testfabrikk** `grantPermission(employee, permission)` i `tests/factories.ts`, og `resetDatabase` tømmer `employee_permissions`.
9. **Dokumenter:** `docs/05-domenemodell.md` avsnitt 4.1 (`employee_permissions` med de faktiske feltnavnene: hvem og når er `created_by` og `created_at`), avsnitt 5 (navnet `claims.view` rettes til `claims.read`, som koden bruker), avsnitt 8 (ordlisten: nye rettigheter). Beslutningene A18–A21 i `docs/09-apne-sporsmal.md`. Versjon i `package.json` økes (patch).

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
- `listEmployeePermissions` og en funksjon for å lese andres enkeltrettigheter (kommer med admin-skjermene).
- Egne kolonner `granted_by_employee_id` og `granted_at` (dekkes av `created_by`, `created_at` og revisjonsloggen).
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
- [ ] Andre enn admin kan ikke gi eller ta bort rettigheter. `organization.manage`, `staff.manage`, `claims.read`, `organization.read` og `invoice.send` kan ikke gis (Zod), og en slik rad satt rett inn i databasen gir ingen rettighet.
- [ ] Ansatt uten roller, men med enkeltrettigheten `template.edit_structure`: `requireOrganizationAccess(bruker, org, "template.edit_structure")` godtas, og `requireOrganizationAccess(bruker, org)` (`organization.read`) avvises. Ingen egen kodevei.
- [ ] Gi en rettighet personen alt har: ingen ny rad, ingen ny loggføring, ingen feil (også ved to samtidige kall). Ta bort en rettighet som ikke er gitt: ingen feil, ingen loggføring.
- [ ] Gi eller ta bort for en slettet eller deaktivert ansatt avvises.
- [ ] Ugyldig verdi i innstillingen gir «på» og en advarsel i loggen uten persondata.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for `grantEmployeePermission` og `revokeEmployeePermission`), og rettighet gitt i A virker ikke i B.
- [ ] Ingen slettet rad i `employee_permissions` gir rettighet.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne (ingen ny e2e; eksisterende må fortsatt gå, også i iPad-størrelse).
- [ ] Ingen ny avhengighet.

## Avgjort av agentene (autonom modus)
- **A18 (31.10.2026):** Innstillingen `access.inspectors_edit_all` lagres i `organizations.settings` (jsonb som finnes), standard på. Egen tabell `settings` med tre nivåer venter til en innstilling trenger selskap eller person. *Hvorfor:* enkleste som virker, bare organisasjonsnivå trengs nå (`docs/05-domenemodell.md` 4.12 og avsnitt 5, Ståle 27.10.2026). *Endres ved:* flytt nøkkelen til tabellen `settings` når den lages.
- **A19 (31.10.2026):** Publisere og overstyre sperre er én rettighet (`report.publish`) til fase 2a, fordi matrisen gir dem til de samme rollene. Ansvarlig og sertifisert sjekkes per rapport i fase 2a. *Endres ved:* ny rettighet `report.override_block` hvis Ståle vil skille dem.
- **A20 (31.10.2026):** Takstmann uten innstillingen har ingen rett til å endre før team på oppdraget finnes (fase 2a). *Hvorfor:* tryggeste standard når innstillingen slås av; matrisen sier «bare der den er i teamet». Innstillingen er på, så ingen merker det nå.
- **A21 (31.10.2026):** Bare `template.edit_structure`, `assignment.edit`, `report.edit` og `report.publish` kan gis som enkeltrettighet. *Hvorfor:* kan `organization.manage` gis, kan en som ikke er admin gi seg selv alt og omgå vernet rundt adminrollen. `claims.read` kan ikke gis fordi Ståle 27.10.2026 sa at bare leder og admin ser reklamasjonssaker; `staff.manage` følger lederrollen. *Endres ved:* legg koden til i `grantablePermissions`.

## Avgjort ved uenighet i runde 1 (prosjektleder)
- **Liste over rettigheter som kan gis:** sikkerhet-personvern foreslo også `claims.read` og `staff.manage`; test-leder foreslo dem utenfor. Valgt test-leders liste (A21), fordi `claims.read` til enkeltpersoner strider mot Ståles beslutning 27.10.2026, og den smaleste listen er tryggest. Den kan utvides med én linje.
- **Ansatt uten roller med en enkeltrettighet:** test-leder foreslo at `organization.read` alltid kreves i tillegg; forenkler foreslo ingen ekstra regel. Valgt forenkler: sjekken ser bare på rettigheten som spørres om. Én kodevei er lettere å teste og forstå, og skjermene som viser data krever `organization.read` uansett. Oppførselen står som akseptkriterium.
- **`listEmployeePermissions` kuttes** (forenkler). Test-leders krav om `expectTenantIsolation` oppfylles med `grantEmployeePermission` og `revokeEmployeePermission`, som tar `organizationId`.
- **`granted_by_employee_id` og `granted_at` kuttes** (forenkler). Testen for den andre fremmednøkkelen faller bort.
- **`retain_until`:** `baseColumns` har ikke dette feltet; myk sletting og ingen sletting dekker 10 års oppbevaring.

## Roller
- **utvikler:** rettigheter, `effectivePermissions`, skjema og migrering, tilgangssjekken, gi/ta bort, fabrikk, dokumenter.
- **testskriver** (i parallell): tabelltester per rolle og innstilling, admin aldri ute, tenant-isolasjon, revisjonslogg. Bygger på kontrakten i dette kortet (navnene i Omfang 2, 5 og 6).
- **sikkerhet-personvern:** gjennomgang av tilgangssjekken og at filtrering skjer på `grant.organizationId`.
- **test-leder:** testplan og godkjenning.

Ikke med: ux-ansvarlig, ui-designer (ingen skjermer), fagansvarlig (ingen fagtekst), KI-rolle, arkitekt (ingen ny arkitektur; følger matrisen og eksisterende mønster).

## Åpne spørsmål
- Ingen som stopper. A18–A21 føres i `docs/09-apne-sporsmal.md` og nevnes i PR-en.
