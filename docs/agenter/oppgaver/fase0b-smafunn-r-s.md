# Liten oppgave (r) og (s): småfunn fra PR #69 og nattløkken 03.11.2026

- **Fase:** 0b – Innlogging, organisasjon, roller og layout
- **Modul:** kjerne (`src/core/email`, `src/core/integrations`, `src/core/organization`, `src/shared/lib`), prøvekode (`src/modules/offline-trial/server`), `docs/05-domenemodell.md`
- **Status:** godkjent (oppgavekort laget av prosjektlederen 03.11.2026, autonom modus)
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

- **Punkt 20, eksakt sammenligning.** Alle tre som skriver `users.email`, gjør adressen til små bokstaver før lagring: Better Auth (e-post-OTP-rutene kaller `toLowerCase()`), seedet (`src/db/seed/run.ts`) og `employeeCreateSchema` (`src/core/organization/schemas.ts`). Konfliktmålet i INSERT er alt `users.email` eksakt. Derfor byttes `sql\`lower(${users.email}) = ${email}\`` med `eq(users.email, email)`, og kommentaren over funksjonen sier hvorfor det er trygt. Ingen uttrykksindeks.
- **Punkt 19, dokumentert unntak, ingen migrering.** Ingen spørring filtrerer `employee_permissions` på `organization_id` alene; alle går via `employee_id` og bruker den delvise unike indeksen. PR #68 droppet nettopp `employees_organization_id_idx` og `certifications_organization_id_idx` som overflødige, så en ny indeks ville gå motsatt vei. Unntaket skrives inn i `docs/05-domenemodell.md` ved `employee_permissions` (én setning: hvorfor ingen indeks på `organization_id`, og når det må vurderes på nytt: hvis en spørring filtrerer på organisasjon uten ansatt). `employee_roles_organization_id_idx` røres ikke (utenfor kortet; kan føres som funn hvis nattløkken mener den også er overflødig).
- **Punkt 18, rettes i produktkoden, ikke i testen.** `photo-storage.ts` skriver først til en midlertidig fil i samme mappe (`<fil>.tmp-<tilfeldig>`) og gir den nytt navn med `rename` når alt er skrevet. Da ser verken e2e-testen eller visningsruten en halvskrevet fil. Én liten hjelper i `photo-storage.ts`, brukt på begge skrivestedene (originalen og visningskopien). Hjelperen fjerner den midlertidige filen hvis skrivingen feiler. Testen (`waitForFile`) røres ikke. Prøvekoden gjøres om etter ADR 0004, men rettingen er åtte linjer og tar bort en falsk rød test nå.
- **(r) 1, typen fra skjemaet uten cast og uten dobbel validering.** Velg provider først, og valider med det konkrete skjemaet i hver gren (`microsoft365SettingsSchema.safeParse(row.settings)` i `microsoft365`-grenen), slik at `parsed.data` får typen fra Zod. `settingsSchemaFor` beholdes for admin-tjenesten. Skjemaet forblir uten eksport hvis det går (en `export type Microsoft365Settings = z.infer<…>` er greit hvis utvikleren trenger den).

## Omfang

**Med:**

*Produktkode (utvikler)*

- `src/core/email/resolve.ts`: `senderForConnection` uten håndskrevet type (se avgjørelsen over).
- `src/shared/lib/logger.ts`: ta bort de elleve eksakte ordene fra `SENSITIVE_KEY` som «slutter på»-alternativet alt dekker. Ingen andre nøkler endres; kommentaren over oppdateres.
- `src/core/organization/employees-admin.ts`: `findOrCreateUser` sammenligner med `eq(users.email, email)`; kommentar om at alle skrivere gjør adressen til små bokstaver.
- `src/modules/offline-trial/server/photo-storage.ts`: hjelper som skriver til midlertidig fil og gir nytt navn, brukt i `storeTrialPhoto` og for visningskopien.
- `docs/05-domenemodell.md`: unntaket for `employee_permissions` (punkt 19) i avsnittet om tabellen, og en rad i endringsloggen nederst.
- `package.json`: versjon `0.2.60`.

*Tester (testskriver)*

- `src/core/email/email.test.ts`: test 16 fjernes.
- `src/core/integrations/connections.test.ts`: test 9 i 3.12 fjernes.
- `src/core/files/config.test.ts` test 6: spionene på `put` og `get` fjernes; `fetchSpy`-sjekken står.
- `src/shared/lib/logger.test.ts`: ingen test fjernes. Regresjon: alle eksisterende saker for de elleve ordene (eksakt og med prefiks) er fortsatt grønne.
- `src/core/organization/employees-admin.test.ts`: test 2 («Ola@Eksempel.NO» treffer eksisterende innlogging) beholdes; ny test som viser at en innlogging laget av seedet/innloggingen (små bokstaver) treffes av skjemaet med store bokstaver og mellomrom, uten ny rad, og at spørringen ikke inneholder `lower(` (statisk sjekk av kildefilen, eller `EXPLAIN` mot testdatabasen som viser Index Scan på `users_email_unique` med `enable_seqscan = off`; test-leder velger).
- `src/modules/offline-trial/server/photo-storage.test.ts`: etter `storeTrialPhoto` og lagring av visningskopi ligger bare de endelige filene i mappen (ingen `.tmp-`-fil), innholdet er likt bytene som ble sendt; feilet skriving (f.eks. mappen er en fil) etterlater ingen midlertidig fil.

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

- [ ] `grep -c 'lower(' src/core/organization/employees-admin.ts` gir 0; test 2 i `employees-admin.test.ts` og den nye testen er grønne.
- [ ] `grep -c ' as {' src/core/email/resolve.ts` gir 0; `senderForConnection` validerer `settings` én gang per sending; alle tester i `resolve.test.ts` og `email.test.ts` grønne.
- [ ] `SENSITIVE_KEY` inneholder ikke lenger ordene `password`, `passord`, `secret`, `clientsecret`, `token`, `accesstoken`, `refreshtoken`, `sessiontoken`, `apikey`, `connectionstring`, `accountkey` som eksakte alternativ; `logger.test.ts` er grønn uten at noen test er fjernet eller endret.
- [ ] `photo-storage.ts` skriver via midlertidig fil og `rename` på begge skrivestedene; ny test viser ingen `.tmp-`-fil igjen etter suksess og etter feil.
- [ ] `docs/05-domenemodell.md` sier ved `employee_permissions` hvorfor det ikke er indeks på `organization_id`, og når det skal vurderes på nytt.
- [ ] Test 16 (`email.test.ts`), test 9 i 3.12 (`connections.test.ts`) og `put`/`get`-spionene i `config.test.ts` test 6 er borte. Ingen andre tester fjernes.
- [ ] Ingen fil under «Ikke med» er endret (`git diff --name-only main` viser ingen av dem).
- [ ] Versjon `0.2.60` i `package.json`.
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen ny spørring med `organizationId`, så ingen nytt `expectTenantIsolation`-kall; de eksisterende står urørt (test).
- [ ] Virker på iPad-størrelse: e2e pc og iPad grønne, «kopi som får 400 …» grønn i begge prosjektene (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.

## Roller

- **test-leder:** testplanen `docs/agenter/oppgaver/fase0b-smafunn-r-s-testplan.md` før koding (kart over hva som fjernes og hva som dekker det, den nye testen for punkt 20 og 18).
- **sikkerhet-personvern:** kort gjennomgang av `SENSITIVE_KEY` etter endringen (at ingen nøkkel som ble vasket før, slipper gjennom) og av oppslaget på `users.email`.
- **utvikler** og **testskriver** i parallell: utvikleren rører bare produktkode og `docs/05-domenemodell.md`, testskriveren bare testfiler. Ingen felles filer.

Ikke med: forenkler (oppgaven er selv en forenkling), ux-ansvarlig, ui-designer, fagansvarlig, arkitekt.

## Åpne spørsmål

- Ingen som stopper oppgaven. Til nattløkken: er `employee_roles_organization_id_idx` også overflødig, på samme grunnlag som punkt 19? (Ikke endret her.)
