# Funksjon: Admin – selskaper, kontorer, ansatte og roller

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/organization`, skjema i `src/db/schema`), skjermer i `src/app/(ansatt)/admin`
- **Branch:** `fase0b-admin-organisasjon` (bygger på `main`)
- **Status:** klar til bygging (31.10.2026, etter gjennomgang av sikkerhet-personvern og test-leder)
- **Støtter hovedmål:**
  - **Reklamasjoner:** riktig utstedende selskap, ansvarsforsikring og firmatekst ligger klart til rapporten i fase 2a. En ansatt som har sluttet, kan ikke logge inn, men står fortsatt på gamle rapporter. Hver endring står i revisjonsloggen.
  - **Tid:** admin legger inn og endrer folk, roller og selskaper selv, uten utvikler og uten å vente. Ny ansatt kan logge inn med engangskode med en gang.
  - **KI først:** se under.

## Problem
Selskaper, kontorer, ansatte og roller finnes i databasen (PR #41 og #50), men kan bare legges inn med seed eller direkte i databasen. «Ferdig når» for fase 0b krever at admin har lagt inn Byggcon med selskapene, kontorene og noen ansatte. Lar vi være, må en utvikler gjøre hver endring, og feil i selskap eller forsikring havner rett i rapporten i fase 2a.

## KI først
Nei, ikke nå. Dette gjøres sjelden (noen få ganger i året), og takstmannens tid berøres ikke. Senere kan KI eller tilkoblingslaget fylle ut selskapsdata fra Brønnøysundregistrene, men det krever tilkoblingslaget (eget punkt) og er ikke med her. Oppgaven er en forutsetning for KI først: bare personer med `report.publish` kan publisere, og det er rollene admin gir her.

## Brukerhistorier
- Som **admin** vil jeg opprette og endre selskaper med org.nr., adresse, firmatekst og ansvarsforsikring, slik at rapporten får riktig utsteder.
- Som **admin** vil jeg opprette og endre kontorer, slik at ansatte kan knyttes til riktig kontor.
- Som **admin** vil jeg legge inn en ny ansatt med navn, e-post, stilling, selskap, kontor og roller, slik at personen kan logge inn med engangskode samme dag.
- Som **admin** vil jeg gi og ta bort roller og enkeltrettigheter (for eksempel maltilgang).
- Som **admin** vil jeg markere at en ansatt har sluttet (og angre det), slik at personen ikke kan logge inn, men fortsatt står på gamle rapporter.
- Som **admin** vil jeg aldri kunne stenge meg selv eller organisasjonen ute.

## Omfang
**Med:**

1. **Adminområdet `/admin`** inne i rammen (`src/app/(ansatt)/layout.tsx`), med tre sider:
   - `/admin/selskaper`: liste over selskaper (juridisk navn, org.nr., forsikring gyldig til). «Nytt selskap» og «Endre» åpner et skjema med alle feltene i `companies` (juridisk navn, org.nr., MVA-registrert, adresse, postnummer, sted, firmatekst, forsikringsselskap, polisenummer, gyldig til).
   - `/admin/kontorer`: liste (navn, adresse, rekkefølge). «Nytt kontor» og «Endre» med feltene navn, adresse, rekkefølge.
   - `/admin/ansatte`: liste med navn, stilling, selskap, kontor, roller og «Sluttet» (ansatte som har sluttet vises nederst, tydelig merket). «Ny ansatt» og en egen side `/admin/ansatte/[id]` med opplysninger, roller, enkeltrettigheter og knappen «Har sluttet» / «Angre sluttet».
   - Menypunktet **«Admin»** vises bare for den som har `organization.manage`. Andre som åpner `/admin` direkte, får «Ingen tilgang» (eller 404), aldri data.
   - Organisasjonen er den første fra `listOrganizationsForActor` der personen har `organization.manage`. Tilgangen avgjøres alltid av `requireOrganizationAccess`.
   - **Menyen er ikke vern.** Hver side i `/admin` gjør tilgangssjekken før data hentes. Hver server action er et åpent endepunkt: den henter organisasjons-id-en på serveren (`listOrganizationsForActor` + tilgangssjekk), aldri fra et skjult felt, og kaller bare funksjonene i `src/core/organization`, som selv gjør `requireOrganizationAccess(…, "organization.manage")`.
   - Id-er fra adressen og skjemaet (`employeeId`, `companyId`, `officeId`) sjekkes med `isUuid` og slås opp med `grant.organizationId`. Ugyldig id og id fra en annen organisasjon gir samme svar («Ingen tilgang» eller 404), aldri en 500-feil.
2. **Funksjoner i `src/core/organization`** (kontrakten utvikler og testskriver bygger mot). Alle tar `(actor, organizationId, …)`, krever `organization.manage` via `requireOrganizationAccess`, filtrerer og skriver med `grant.organizationId`, validerer med Zod og skriver revisjonslogg i samme transaksjon:
   - `createCompany`, `updateCompany(…, companyId, input)`
   - `createOffice`, `updateOffice(…, officeId, input)`
   - `listEmployeesForAdmin` (som `listEmployees`, med e-post, roller og enkeltrettigheter; bare for `organization.manage`), `getEmployeeForAdmin(…, employeeId)`. Den eksisterende `listEmployees` gir fortsatt **ikke** e-post.
   - `createEmployee(…, { name, email, jobTitle, companyId, officeId, roles })`
   - `updateEmployee(…, employeeId, { name, jobTitle, companyId, officeId })`
   - `setEmployeeRoles(…, employeeId, roles)`: legger til nye og tar bort (myk sletting) de som ikke er med
   - `deactivateEmployee(…, employeeId)` og `reactivateEmployee(…, employeeId)`
   - Enkeltrettigheter bruker `grantEmployeePermission` og `revokeEmployeePermission` som finnes.
   - Selskap og kontor som oppgis på en ansatt, må finnes i `grant.organizationId` og ikke være slettet. Id fra skjemaet brukes aldri uten denne sjekken (databasen har i tillegg sammensatt fremmednøkkel).
3. **Ny ansatt og innlogging:** e-posten trimmes og gjøres om til små bokstaver. Finnes det alt en innlogging (`users`) med den e-posten, kobles den ansatte til den; ellers lages en ny. Navnet på en eksisterende innlogging endres ikke. Finnes det alt en ansatt i **samme** organisasjon med den innloggingen, gis feilen «Det finnes alt en ansatt med denne e-posten». Meldingen sier aldri noe om andre organisasjoner: svaret er det samme om e-posten finnes i `users` fra før eller ikke, og navnet på den eksisterende innloggingen vises ikke for admin. E-post leses fra `users` bare for ansatte i `grant.organizationId`. **Ingen e-post sendes** (ingen kall til `src/core/email`). Personen logger inn på `/logg-inn` med engangskode som før.
4. **Admin stenges aldri ute:** den siste aktive admin i organisasjonen kan ikke miste rollen admin og kan ikke markeres som sluttet. Meldingen: «Organisasjonen må ha minst én admin.» Test som aldri skal fjernes.
   - **Lås:** hver funksjon som kan fjerne en admin (`setEmployeeRoles`, `deactivateEmployee`) starter transaksjonen med `pg_advisory_xact_lock` på organisasjonen (nøkkel avledet av `grant.organizationId`), og teller først etterpå. Lås på radene i `employee_roles` holder ikke: «sluttet» endrer `employees.deactivated_at`, ikke rollen, så to samtidige kall kan begge telle den andre som admin.
   - **Aktiv admin** = rollen `admin` med `deleted_at IS NULL`, og ansatt-raden har `deleted_at IS NULL`, `deactivated_at IS NULL` og `user_id IS NOT NULL`.
   - Endringen, sjekken og revisjonsloggen skjer i samme transaksjon. Stoppes endringen, skrives ingen loggrad.
5. **Roller med myk sletting:** `employee_roles` sin unike indeks `(employee_id, role)` gjøres delvis (`WHERE deleted_at IS NULL`), slik at en rolle kan tas bort og gis på nytt med en ny rad (samme mønster som `employee_permissions`). Migrering med `pnpm db:generate`. Ingen rader slettes.
6. **Sluttet:** `deactivateEmployee` setter `deactivated_at`. Personen avvises i neste tilgangssjekk (finnes alt i `findGrant`). Innloggingen selv stoppes ikke (felles innlogging med Optiplan, `users`-raden finnes), og økter slettes ikke: personen får en kode, men ser «Ingen tilgang» eller ingen organisasjon. `reactivateEmployee` nullstiller feltet, bare når den ansatte har innlogging (`user_id`). Ingen permanent sletting noe sted.
7. **Revisjonslogg:** `action` er `create` / `update` / `role_change` / `permission_change` / `deactivate` / `reactivate` (bruk de navnene `src/core/audit` alt støtter der de finnes). For ansatte inneholder `changes` bare id-er, rollenavn, rettighetsnavn og navnene på feltene som er endret, **aldri navn, e-post, stilling eller annen persontekst** (gjelder også `role_change` og `permission_change`). For selskap og kontor kan verdiene stå.
   - **Feillogg:** valideringsfeil og databasefeil logges bare med feilkode og id-er, aldri med innholdet fra skjemaet. Loggeren vasker e-post, men ikke navn.
8. **Feilmeldinger på norsk**, ved feltet: org.nr. må være 9 siffer, e-post må være gyldig, navn må fylles ut, «Gyldig til» må være en dato. Skjemaene virker med tastatur og har trykkflater på minst 44 px (`docs/08-designprinsipper.md`).
9. **Tester:**
   - **Testfiler:** `src/core/organization/companies.test.ts`, `offices.test.ts`, `employees-admin.test.ts`; `src/core/access/guards.test.ts` uendret (sjekk at sluttet ansatt og fjernet rolle slår ut i neste tilgangssjekk); `e2e/fase-0b-admin.spec.ts`; en migreringstest for den delvise unike indeksen (ny rad tillatt etter myk sletting, to aktive rader stoppes).
   - **Tilgang per rolle:** takstmann, kontor og leder får `AccessDeniedError` på alle funksjonene.
   - **`expectTenantIsolation` per ny funksjon.** Lesefunksjoner som vanlig. Skrivefunksjoner: `seed` legger en rad i A og B og husker hvilken id som hører til hvilken organisasjon; `query` kjører skrivefunksjonen på egen rad og returnerer raden; etterpå kontrolleres det at B-raden er uendret i databasen.
   - **Fremmed id i egen organisasjon (regel 2):** admin A kaller med orgA og en id fra B på `updateCompany`, `updateOffice`, `getEmployeeForAdmin`, `updateEmployee`, `setEmployeeRoles`, `deactivateEmployee`, `reactivateEmployee`, `grantEmployeePermission` og `revokeEmployeePermission`. Alle gir `AccessDeniedError` (eller ikke funnet), og B-raden er uendret. Det samme for en id som ikke er uuid.
   - **Selskap og kontor på ansatt:** fra en annen organisasjon avvises, og et slettet selskap eller kontor (`deleted_at`) i egen organisasjon avvises også.
   - **Siste admin (aldri fjernes, kommentar i testen):** `setEmployeeRoles(…, [])` og `setEmployeeRoles(…, ["inspector"])` på siste admin avvises; admin kan ikke markere seg selv som sluttet; to admin som fjerner hverandre samtidig (`Promise.all`) gir nøyaktig ett vellykket kall og minst én aktiv admin etterpå. Varianter: to roller tas bort, to admin slutter, én mister rollen mens en annen slutter. En admin som har sluttet eller er slettet, regnes ikke med. Med to aktive admin er det lov å ta rollen fra én. Når sjekken stopper en endring, finnes ingen loggrad.
   - **`reactivateEmployee`:** avvises når den ansatte mangler `user_id`. Etter angring virker `requireOrganizationAccess` igjen.
   - **E-post:** «  Ola@Eksempel.NO » treffer eksisterende innlogging; navnet på innloggingen er uendret. Duplikat i samme organisasjon gir samme feilmelding uansett om e-posten finnes i en annen organisasjon. `listEmployees` gir ikke e-post; bare `listEmployeesForAdmin` og `getEmployeeForAdmin` gjør det. Ingen rad i utviklingspostkassen og ingen kall til `src/core/email` (spion).
   - **Zod:** ukjent rolle og en rettighet som ikke kan gis avvises; det samme org.nr. med 8 eller 10 siffer eller bokstaver, tomt navn, ugyldig e-post og ugyldig dato for «Gyldig til».
   - **Revisjonslogg:** `JSON.stringify(changes)` inneholder ikke den ansattes navn, e-post eller stilling for `create`, `update`, `role_change`, `permission_change`, `deactivate` og `reactivate`.
   - **Myk sletting:** etter fjern–gi–fjern av en rolle finnes to rader med `deleted_at`; antall rader i `employees` og `employee_roles` går aldri ned.
   - **e2e (PC og iPad-størrelse):** admin oppretter et selskap med forsikring, et kontor og en ansatt med rollen takstmann; den nye ansatte logger inn med koden fra utviklingspostkassen og ser arbeidskøen uten menypunktet «Admin»; admin markerer personen som sluttet, og personen ser «Ingen tilgang» eller ingen organisasjon (også en økt som alt er åpen, ved neste side). E-post og navn lages per kjøring (tilfeldig ending, `@eksempel.no`). Seed-admin markeres aldri som sluttet. Takstmann som åpner `/admin`, `/admin/ansatte` og `/admin/ansatte/[id]` får ingen e-post eller andre data. På iPad-størrelse er «Lagre» og «Har sluttet» minst 44 px, og ett skjema sendes med tastaturet alene.
   - **Testdata er oppdiktet:** navn og e-post på `eksempel.no`/`example.no`, org.nr. og polisenumre som ikke finnes.
10. **Dokumenter:** `docs/05-domenemodell.md` (4.1: delvis unik indeks på `employee_roles`; avsnitt 8: ordlisten for nye funksjonsnavn), beslutningene i `docs/09-apne-sporsmal.md`, planen krysses av, versjon i `package.json` økes (patch).

**Ikke med (bevisst utelatt):**
- Slette eller arkivere selskaper og kontorer fra skjermen (A28).
- Endre e-posten til en ansatt (hører til ADR-en for felles innlogging med Optiplan). Feil e-post: marker som sluttet og legg inn på nytt.
- Telefon, signatur, profilbilde og logo (telefon hører til innloggings-ADR-en; filene venter på filtjenesten).
- Sertifisering med utløpsdato (eget punkt i planen).
- Skjerm for innstillingen `access.inspectors_edit_all` (ingen har bedt om å stramme inn; kan legges til som én bryter senere).
- Invitasjon på e-post eller SMS. Ingen e-post sendes.
- Velge mellom flere organisasjoner (det finnes én).
- Søk, filter og import av ansatte fra IVIT.
- Vern mot at to admin endrer samme rad samtidig (`row_version`); siste lagring gjelder.
- Henting av selskapsdata fra Brønnøysundregistrene (tilkoblingslaget, senere).
- Endringer i tilgangsmodulen `src/core/access` utover det som trengs for å skjule menypunktet (ingen nye rettigheter).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | Ikke adminområdet (menypunktet vises ikke) | Ingenting her |
| kontor | Ikke adminområdet | Ingenting her |
| leder | Ikke adminområdet | Ingenting her |
| admin | Alt i adminområdet, også e-post til ansatte | Selskaper, kontorer, ansatte, roller, enkeltrettigheter, sluttet. Stenges aldri ute. |

## Data
- Endret indeks: `employee_roles_employee_id_role_idx` blir delvis (`WHERE deleted_at IS NULL`). Ny migrering.
- Ingen nye tabeller eller kolonner.
- Faste koder som tas i bruk: ingen nye. Rollene `inspector`, `office`, `manager`, `admin` og rettighetene fra PR #50.

## Skjermer
PC og iPad, i rammen Fjord. Én hovedhandling per skjerm: «Nytt selskap», «Nytt kontor», «Ny ansatt», og «Lagre» i skjemaene. Ny ansatt med rolle: 1 trykk på «Admin», 1 på «Ansatte», 1 på «Ny ansatt», fyll ut, 1 på «Lagre» (før: utvikler i databasen). Ui-designer lager en kort skisse i `docs/funksjoner/fase0b-admin-organisasjon-skisse.md` (lister og skjema, PC og iPad stående) før skjermene bygges.

## Regler
Ingen fagregler. Regelen «minst én admin» er kode med tester (Omfang 4).

## Akseptkriterier
- [ ] Admin kan opprette og endre et selskap med alle feltene, også firmatekst og ansvarsforsikring.
- [ ] Admin kan opprette og endre et kontor.
- [ ] Admin kan opprette en ansatt med selskap, kontor og roller, og personen kan logge inn med engangskode uten at det sendes noen ekstra e-post.
- [ ] Admin kan gi og ta bort roller og enkeltrettigheter; effekten vises i neste tilgangssjekk, og alt står i revisjonsloggen uten persontekst.
- [ ] Admin kan markere en ansatt som sluttet og angre; den som har sluttet, kan ikke logge inn og står fortsatt i databasen. Ingenting slettes permanent.
- [ ] Siste admin kan ikke miste rollen eller markeres som sluttet, heller ikke ved to samtidige endringer (test som aldri skal fjernes).
- [ ] Takstmann, kontor og leder ser ikke menypunktet «Admin» og får ingen data fra `/admin` eller funksjonene.
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for hver ny funksjon), og selskap eller kontor fra en annen organisasjon kan ikke knyttes til en ansatt.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Ingen ny avhengighet.

## Avgjort av agentene (autonom modus)
Føres i `docs/09-apne-sporsmal.md` («Avgjort av agentene mens Ståle var borte») og nevnes i PR-en. A22 er hoppet over fordi nummeret kan være satt av i en annen branch.
- **A24 (31.10.2026):** Adminområdet og menypunktet «Admin» er bare for `organization.manage` (rollen admin). Leder ser ikke adminområdet. *Hvorfor:* rettighetsmatrisen (`docs/05-domenemodell.md` avsnitt 5) og A21. *Endres ved:* gi leder lesetilgang med en egen rettighet.
- **A25 (31.10.2026):** Organisasjonen må alltid ha minst én aktiv admin. *Hvorfor:* «Admin stenges aldri ute» (CLAUDE.md regel 11). *Endres ikke.*
- **A26 (31.10.2026):** Ny ansatt kobles til en eksisterende innlogging med samme e-post; ingen invitasjon sendes; e-post kan ikke endres i skjermen før ADR-en for felles innlogging med Optiplan. *Hvorfor:* felles bruker med Optiplan (Ståle 28.10.2026), ingen e-post til ekte mottakere i autonom modus, det enkleste som virker. *Endres ved:* ADR-en for felles innlogging.
- **A27 (31.10.2026):** En rolle tas bort med myk sletting og gis på nytt som ny rad (delvis unik indeks). *Hvorfor:* regel 3 (ingenting slettes) og samme mønster som enkeltrettigheter (PR #50).
- **A28 (31.10.2026):** Selskaper og kontorer kan opprettes og endres, ikke slettes eller arkiveres fra skjermen. *Hvorfor:* de fire selskapene og fem kontorene er faste (seed, A16), og et slettet selskap kan ikke stå på gamle rapporter uten mer logikk. *Endres ved:* legg til arkivering når det trengs.
- **«Angre sluttet» er med** (del av A26-oppgaven): uten den må en feilmarkert ansatt legges inn på nytt, og den unike indeksen `(user_id, organization_id)` hindrer det.

## Avgjort av prosjektlederen (gjennomgang 31.10.2026)
- Begge innspillene (sikkerhet-personvern og test-leder) er tatt inn. Ingen uenighet mellom dem.
- Låsen i Omfang 4 er endret fra radlås til `pg_advisory_xact_lock` per organisasjon. *Hvorfor:* radlås dekker ikke «sluttet», som endrer en annen tabell.
- e2e sjekker «Ingen tilgang» i stedet for at innloggingen feiler. *Hvorfor:* felles innlogging med Optiplan gjør at koden fortsatt sendes; avvisningen skjer i tilgangssjekken.
- Lik tidsbruk ved duplikat e-post testes ikke. *Hvorfor:* bare admin i egen organisasjon kan kalle funksjonen, og svaret er alltid det samme. Det enkleste som virker.
- Ingen nye spørsmål til Ståle.

## Roller
- **forenkler:** kutter omfang før bygging.
- **ui-designer:** kort skisse av lister og skjema i Fjord (PC og iPad stående).
- **sikkerhet-personvern:** tilgang via `src/core/access`, filtrering på `grant.organizationId`, e-post bare til admin, revisjonslogg uten persontekst, ingen lekkasje om andre organisasjoner.
- **test-leder:** testplan `docs/funksjoner/fase0b-admin-organisasjon-testplan.md` og godkjenning.
- **utvikler** (to biter i parallell): (1) kjerne: funksjonene i Omfang 2–7, migreringen og dokumentene; (2) skjermer og menypunkt mot kontrakten i Omfang 2, etter skissen.
- **testskriver** (i parallell): databasetestene og e2e i Omfang 9, mot kontrakten i Omfang 2.

Ikke med: ux-ansvarlig (vanlige lister og skjema, ingen ny flyt for takstmannen), fagansvarlig (ingen fagtekst; firmateksten skrives av admin), KI-rolle, arkitekt (følger eksisterende mønster).

## Åpne spørsmål
- Ingen som stopper. A24–A28 føres som beslutninger.
