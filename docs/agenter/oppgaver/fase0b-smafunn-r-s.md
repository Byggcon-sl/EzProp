# Liten oppgave (r) og (s): småfunn fra PR #69 og nattløkken 03.11.2026

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/email`, `src/core/integrations`, `src/core/organization`, `src/shared/lib`), prøvekode (`src/modules/offline-trial/server`), `docs/05-domenemodell.md`
- **Status:** godkjent (oppgavekort laget av prosjektlederen 03.11.2026, autonom modus; oppdatert etter forhåndsvurdering fra forenkler og test-leder samme dag, se «Avgjørelser etter forhåndsvurderingen»)
- **Branch:** `fase0b-smafunn-r-s` (bygger på `main`), versjon `0.2.60`
- **Støtter hovedmål:** Reklamasjoner: en halvskrevet bildefil kan aldri leses av testen eller visningsruten; typesjekken sier fra hvis Microsoft 365-innstillingene får et nytt felt; loggvasken blir enklere å lese og dermed lettere å holde riktig. Tid: oppslaget på innlogging ved ny ansatt bruker indeksen; færre doble tester gir raskere CI og mindre å vedlikeholde. KI først: ikke direkte (grunnmur).

## Problem

Gjennomgangen av PR #69 og nattløkken 03.11.2026 fant seks små ting som ikke er feil for brukeren i dag, men som gjør koden dyrere å holde riktig eller gir falske røde tester:

*(r) Fra gjennomgangen av PR #69*

1. `senderForConnection` i `src/core/email/resolve.ts` caster `parsed.data` til en håndskrevet type (`{ from; tenantId; clientId }`). Får skjemaet et nytt felt, sier ikke typesjekken fra.
2. Test 16 i `src/core/email/email.test.ts` («ingen nettkall der sending ikke skjer») dekkes helt av test 13 (13b og 13c beholdes).
3. Test 9 i gruppen 3.12 i `src/core/integrations/connections.test.ts` («ingen rad i revisjonsloggen etter suksess og feil») gjentar `email.test.ts` 8.2 test 1, 2 og 5.
4. `vi.spyOn(storage, "put"/"get")` med `not.toHaveBeenCalled()` i `src/core/files/config.test.ts` test 6 beviser ingenting: testen kaller dem aldri selv.
5. De eksakte ordene `password`, `passord`, `secret`, `clientsecret`, `token`, `accesstoken`, `refreshtoken`, `sessiontoken`, `apikey`, `connectionstring` og `accountkey` i `SENSITIVE_KEY` i `src/shared/lib/logger.ts` er overflødige etter at «slutter på»-alternativet kom i PR #69. (`!organizationId` i `sendEmail` er en bevisst typevakt, ikke et funn.)

*(s) Fra nattløkken 03.11.2026*

6. **Punkt 20:** `findOrCreateUser` i `src/core/organization/employees-admin.ts` slår opp med `lower(users.email) = …`. EXPLAIN gir Seq Scan; den unike indeksen på `users.email` kan ikke brukes på uttrykket.
7. **Punkt 19:** `employee_permissions` har ingen indeks som begynner med `organization_id`, bare den delvise unike `(employee_id, permission) WHERE deleted_at IS NULL`. Ikke et ytelsesproblem i dag (`findGrant` og `selectAdminEmployees` filtrerer på `employee_id` og går på indeks).
8. **Punkt 18:** e2e-testen «kopi som får 400 viser Bare originalen er lagret …» i `e2e/fase-1-prove-d-bilder.spec.ts` er ustabil: `waitForFile` ser at filen finnes, og `sha256File` leser den før `writeFile` i `photo-storage.ts` er ferdig. Samme vindu finnes for visningsruten som leser visningskopien.

Lar vi være: falske røde e2e-kjøringer som skjuler ekte feil, en type som kan gli fra skjemaet, et oppslag som blir tregere for hver innlogging, og doble tester som må endres to steder.

## KI først

Nei. Retting og rydding i grunnmuren; ingenting her som KI kan forberede for takstmannen.

## Brukerhistorier

- Som **utvikler** vil jeg at e2e for prøve D er grønn hver gang den kjøres, slik at rød e2e alltid betyr en ekte feil.
- Som **admin** vil jeg at ny ansatt med en e-post som alt har innlogging, kobles til den eksisterende innloggingen like raskt uansett hvor mange innlogginger som finnes.
- Som **utvikler** vil jeg at et nytt felt i Microsoft 365-innstillingene gir typefeil der feltet skal brukes, slik at det ikke glemmes.

## Avgjørelser i kortet (prosjektlederen, 03.11.2026)

Alle tre er tekniske valg innenfor planen, ikke fag; de føres her og i PR-en, ikke i `docs/09-apne-sporsmal.md`.

- **Punkt 20, eksakt sammenligning.** Bare to steder skriver `users.email`, og begge gjør adressen til små bokstaver før lagring: seedet (`src/db/seed/run.ts`, `trim().toLowerCase()`) og `employeeCreateSchema` (`src/core/organization/schemas.ts`). Better Auth skriver aldri `users` (`disableSignUp: true` i `src/core/auth/auth.ts`); den første versjonen av dette kortet sa feil at e-post-OTP-rutene gjør det (rettet etter test-leders funn). Konfliktmålet i INSERT er alt `users.email` eksakt. Derfor byttes `sql\`lower(${users.email}) = ${email}\`` med `eq(users.email, email)`, og kommentaren over funksjonen sier hvem som skriver feltet, at de gjør adressen til små bokstaver, og at delt innlogging med Optiplan (ADR i fase 0b) må holde samme regel. Ingen uttrykksindeks.
- **Punkt 19, dokumentert unntak, ingen migrering.** Ingen spørring filtrerer `employee_permissions` på `organization_id` alene; alle går via `employee_id` og bruker den delvise unike indeksen. PR #68 droppet nettopp `employees_organization_id_idx` og `certifications_organization_id_idx` som overflødige, så en ny indeks ville gå motsatt vei. Unntaket skrives inn i `docs/05-domenemodell.md` ved `employee_permissions` (én setning: hvorfor ingen indeks på `organization_id`, og når det må vurderes på nytt: hvis en spørring filtrerer på organisasjon uten ansatt). `employee_roles_organization_id_idx` røres ikke (utenfor kortet; kan føres som funn hvis nattløkken mener den også er overflødig).
- **Punkt 18, rettes i produktkoden, ikke i testen.** `photo-storage.ts` skriver først til en midlertidig fil i samme mappe (`<fil>.tmp-<tilfeldig>`) og gir den nytt navn med `rename` når alt er skrevet. Da ser verken e2e-testen eller visningsruten en halvskrevet fil. Én liten hjelper i `photo-storage.ts`, brukt på begge skrivestedene (originalen og visningskopien). Feiler `rename`, fjerner hjelperen den midlertidige filen (`rm` med `force`) og kaster feilen videre; se begrunnelsen under. Testen (`waitForFile`) røres ikke. Prøvekoden gjøres om etter ADR 0004, men rettingen er rundt ti linjer og tar bort en falsk rød test nå.
- **(r) 1, typen fra skjemaet uten cast og uten dobbel validering.** Velg provider først, og valider med det konkrete skjemaet i hver gren: `microsoft365SettingsSchema.safeParse(row.settings)` i `microsoft365`-grenen, slik at `parsed.data` får typen fra Zod, og **det tomme skjemaet fortsatt i grenene `server_log` og `dev_mailbox`** (ellers forsvinner valideringen stille for de to; ny test 8c i `resolve.test.ts` låser det). `settingsSchemaFor` beholdes for admin-tjenesten. Skjemaet forblir uten eksport hvis det går (en `export type Microsoft365Settings = z.infer<…>` er greit hvis utvikleren trenger den).

## Avgjørelser etter forhåndsvurderingen (prosjektlederen, 03.11.2026)

Forenkler og test-leder var uenige på tre punkter. Avgjort slik, og begrunnet her (gjentas i PR-en):

1. **Punkt 20, ny test: test-leders 2b beholdes, forenklers kutt avvises.** Forenkler har rett i at «små bokstaver i basen treffes av store bokstaver og mellomrom» alt er test 2, og i at statisk sjekk av kildefilen og `EXPLAIN` er for mye for én linje; begge er ute. Men 2b (rad med store bokstaver lagt inn utenom skriverne treffes *ikke*, ny rad lages) er den eneste testen som går rød hvis noen setter `lower(` tilbake, og den koster én databasetest uten mocking. En endring i oppførsel skal ha én test som skiller før og etter.
2. **Punkt 18, opprydding ved feil: beholdes, men bare én test (T3). T4 kuttes; T1, T2 og T5 blir påstander i tester som finnes.** Forenkler har rett i at en etterlatt `.tmp-`-fil aldri leses. Men oppryddingen er tre linjer, og uten den blir påstanden «mappen inneholder nøyaktig `[<id>]`» usann etter en feilet skriving, som gir en ny ustabil test senere. Test-leder har rett i at «mappen er en fil» (kortets første forslag) feiler i `mkdir` og ikke viser noe; T3 bruker en mappe på den endelige stien, så `rename` feiler med `EISDIR`. T4 kuttes fordi begge skrivestedene går gjennom samme hjelper, og grep-kriteriet «`writeFile` bare i hjelperen» låser det. T1, T2 og T5 legges som én ekstra påstand hver i testene som finnes (`storeTrialPhoto` linje 98, `storeTrialDisplayCopy` linje 601, «samme fil to ganger» i `photo-storage.test.ts`), slik forenkler foreslo.
3. **Rollen sikkerhet-personvern tas ut** (forenklers forslag, test-leder uenig i ingenting her). Regex-endringen er låst av E1–E3 og de eksisterende testene i `logger.test.ts`; `eq` mot `lower(` på `users.email` har ingen sikkerhetsside (samme transaksjon, samme konfliktmål, bare bak `organization.manage`). Ikke flere roller enn nødvendig.

Tatt inn uten uenighet: premisset om Better Auth rettet (se punkt 20 over); presiseringen for `server_log`/`dev_mailbox` i (r) 1 med test 8c; (r) 5 får én ny tabelltest (E1–E3) for de elleve ordene, siden seks av dem ikke har noen eksakt-sak i dag, og kriteriet sier nå «ingen test fjernet eller endret; nye er lov».

## Omfang

**Med:**

*Produktkode (utvikler)*

- `src/core/email/resolve.ts`: `senderForConnection` uten håndskrevet type (se avgjørelsen over).
- `src/shared/lib/logger.ts`: ta bort de elleve eksakte ordene fra `SENSITIVE_KEY` som «slutter på»-alternativet alt dekker. Ingen andre nøkler endres; kommentaren over oppdateres.
- `src/core/organization/employees-admin.ts`: `findOrCreateUser` sammenligner med `eq(users.email, email)`; kommentar som sier at seedet og `employeeCreateSchema` er de eneste som skriver `users.email`, at begge gjør adressen til små bokstaver, at Better Auth aldri skriver `users` (`disableSignUp`), og at delt innlogging med Optiplan må holde samme regel.
- `src/modules/offline-trial/server/photo-storage.ts`: hjelper som skriver til `<fil>.tmp-<tilfeldig>` i samme mappe og gir nytt navn med `rename`, brukt i `storeTrialPhoto` og for visningskopien; feiler `rename`, fjernes den midlertidige filen (`rm` med `force`) og feilen kastes videre. `writeFile` finnes bare i hjelperen.
- `docs/05-domenemodell.md`: unntaket for `employee_permissions` (punkt 19) i avsnittet om tabellen, og en rad i endringsloggen nederst.
- `package.json`: versjon `0.2.60`.

*Tester (testskriver)*

- `src/core/email/email.test.ts`: test 16 fjernes.
- `src/core/integrations/connections.test.ts`: test 9 i 3.12 fjernes.
- `src/core/files/config.test.ts` test 6: spionene på `put` og `get` fjernes; `fetchSpy`-sjekken står.
- `src/shared/lib/logger.test.ts`: ingen test fjernes eller endres. Ny tabelltest (E1–E3 i testplanen): de elleve ordene vaskes eksakt og med prefiks i begge skrivemåter, og `tokens`, `secretRef`, `secret_ref`, `passordHint`, `apiKeys` vaskes ikke.
- `src/core/organization/employees-admin.test.ts`: test 2 («Ola@Eksempel.NO» treffer eksisterende innlogging) beholdes; ny test 2b: en rad i `users` lagt inn direkte med `db.insert(users)` og `Kari@Eksempel.NO` (utenom skriverne) treffes *ikke* av `createEmployee` med `kari@eksempel.no`; det lages ny rad med små bokstaver, den ansatte peker på den nye, raden med store bokstaver er uendret. Ingen statisk sjekk av kildefilen, ingen `EXPLAIN`; `grep -c 'lower('` kjøres av test-leder i rapporten.
- `src/core/email/resolve.test.ts`: ny test 8c: `server_log`-rad med `settings: { x: 1 }` gir `connectionId` satt, `send` avvises, ingen logglinje.
- `src/modules/offline-trial/server/photo-storage.test.ts`: én ekstra påstand i testene som finnes for `storeTrialPhoto`, `storeTrialDisplayCopy` og «samme fil to ganger» (mappen inneholder nøyaktig de endelige filene, ingen oppføring med `.tmp-`); én ny test T3: en mappe på den endelige stien gjør at `rename` feiler (`EISDIR`), kallet avvises, raden har ikke `uploaded_at`, og ingen `.tmp-`-fil ligger igjen.

**Ikke med (bevisst utelatt):**

- Nøkkelboksen (egen branch `fase0b-nokkelboks`, annen kjøring).
- `.github/workflows/ci.yml`, `deploy-azure.yml`, `src/core/secrets.ts`, `src/shared/config/env.ts`.
- Ny indeks eller migrering (punkt 19 løses med dokumentasjon). `employee_roles_organization_id_idx` vurderes ikke.
- Uttrykksindeks på `lower(email)`.
- Endringer i `e2e/`; `waitForFile` står som den er.
- N+1 i `applyTrialChanges` og det doble oppslaget i `storeTrialPhoto` (nattløkken punkt 14, etter ADR 0004).
- Resten av småfunnene i liten oppgave (k), (l) og (m).
- Ingen ny funksjon, ingen ny avhengighet, ingen ny tabell.

## Tilgang

Uendret. Ingen endring i `src/core/access`. `findOrCreateUser` kalles bare fra `createEmployee`, som alt krever `organization.manage`.

## Data

Ingen nye tabeller eller felter. Ingen migrering. `docs/05-domenemodell.md` får unntaket for `employee_permissions` og en rad i endringsloggen.

## Skjermer

Ingen.

## Regler

Ingen.

## Akseptkriterier

- [ ] `grep -c 'lower(' src/core/organization/employees-admin.ts` gir 0; test 2 og 2b i `employees-admin.test.ts` er grønne.
- [ ] `grep -c ' as {' src/core/email/resolve.ts` gir 0; `senderForConnection` validerer `settings` én gang per sending, også for `server_log` og `dev_mailbox` (test 8c); alle tester i `resolve.test.ts` og `email.test.ts` grønne.
- [ ] `SENSITIVE_KEY` inneholder ikke lenger ordene `password`, `passord`, `secret`, `clientsecret`, `token`, `accesstoken`, `refreshtoken`, `sessiontoken`, `apikey`, `connectionstring`, `accountkey` som eksakte alternativ; `logger.test.ts` er grønn uten at noen eksisterende test er fjernet eller endret; nye tester (E1–E3) er lov.
- [ ] `photo-storage.ts` skriver via midlertidig fil og `rename` på begge skrivestedene (`writeFile` bare i hjelperen); påstandene i de eksisterende testene og T3 viser ingen `.tmp-`-fil igjen etter suksess og etter feil; «kopi som får 400 …» grønn tre ganger på rad i begge e2e-prosjektene.
- [ ] `docs/05-domenemodell.md` sier ved `employee_permissions` hvorfor det ikke er indeks på `organization_id`, og når det skal vurderes på nytt.
- [ ] Test 16 (`email.test.ts`), test 9 i 3.12 (`connections.test.ts`) og `put`/`get`-spionene i `config.test.ts` test 6 er borte. Ingen andre tester fjernes.
- [ ] Ingen fil under «Ikke med» er endret (`git diff --name-only main` viser ingen av dem).
- [ ] Versjon `0.2.60` i `package.json`.
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen ny spørring med `organizationId`, så ingen nytt `expectTenantIsolation`-kall; de eksisterende står urørt (test).
- [ ] Virker på iPad-størrelse: e2e pc og iPad grønne, «kopi som får 400 …» grønn i begge prosjektene (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## Roller

- **test-leder:** testplanen `docs/agenter/oppgaver/fase0b-smafunn-r-s-testplan.md` (levert før koding; justert av prosjektlederen etter avgjørelsene over) og testrapporten med grep-kriteriene.
- **utvikler** og **testskriver** i parallell: utvikleren rører bare produktkode og `docs/05-domenemodell.md`, testskriveren bare testfiler. Ingen felles filer.

Ikke med: sikkerhet-personvern (tatt ut etter forhåndsvurderingen, se over), forenkler (gjorde forhåndsvurderingen; oppgaven er selv en forenkling), ux-ansvarlig, ui-designer, fagansvarlig, arkitekt.

## Åpne spørsmål

- Ingen som stopper oppgaven. Til nattløkken: er `employee_roles_organization_id_idx` også overflødig, på samme grunnlag som punkt 19? (Ikke endret her.)
- Til nattløkken, funnet av test-leder (ikke endret her, ført som punkt 22 i tilstandsfilen): innloggingsskjemaet (`src/app/logg-inn/login-form.tsx`) sender e-posten som skrevet, bare `trim()`. Hvis Better Auth sammenligner eksakt mot `users.email`, finner «Ola@Eksempel.no» ikke innloggingen `ola@eksempel.no`. Må sjekkes i innloggings-ADR-en (fase 0b); enkleste retting er `toLowerCase()` i skjemaet, men det hører til innloggingsoppgaven, ikke denne.
