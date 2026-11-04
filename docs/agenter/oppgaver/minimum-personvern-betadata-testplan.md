# Testplan: Intern personvernerklæring og regel for sletting av betadata

- **Oppgavekort:** `docs/agenter/oppgaver/minimum-personvern-betadata.md`
- **Fase:** Minimum før ekte data
- **Branch:** `minimum-personvern-betadata` (bygger på main)
- **Laget av:** test-leder, 04.11.2026 (før skriving)
- **Støtter hovedmål:** Reklamasjoner: sjekkene sikrer at erklæringen lover 10 års oppbevaring der koden og Ståles svar gjør det, og at sletteregelen aldri åpner for permanent sletting av ekte data. Tid: én fast regel for prøvedata, så ingen rydder for hånd. KI først: agentene sjekker dokumentene mot koden; daglig leder bare leser og godkjenner.

## Hvorfor ingen nye automatiske tester

Leveransen er bare dokumenter. Ingen ny spørring, ingen ny tabell, ingen ny tilgangsregel og ingen regel som data. Derfor:

- **Tilgang per rolle:** ingen endring. Ingen ny test.
- **Tenant-isolasjon:** ingen ny spørring, så ingen nytt `expectTenantIsolation`-kall. `tests/tenant-tables.ts` endres ikke. `tests/tenant-isolation-all-tables.test.ts` skal fortsatt være grønn og viser at ingen tabell er lagt til i det stille.
- **Regeltester:** ingen regler. Ingen testsaker.
- **Admin stenges aldri ute / myk sletting:** ingen kode. Sjekkes i teksten (M6, M7). Kravene til tester når oppryddingen bygges, står under «Senere».
- **E2e:** bare versjonssjekken, fordi versjonen vises i `/api/helse`.

## 1. Eksisterende automatiske tester som må være grønne

| # | Test | Hva den viser |
|---|---|---|
| 1 | `src/core/health/health.test.ts` | `/api/helse` gir `versjon` lik `package.json` (0.2.70). Testen leser versjonen fra `package.json`, så den skal ikke endres. |
| 2 | `e2e/fase-0a.spec.ts` (PC og iPad-størrelse) | Helsesiden svarer med riktig versjon i begge prosjektene i Playwright. Uendret test. |
| 3 | `tests/tenant-isolation-all-tables.test.ts` | Alle tabeller med `organization_id` står fortsatt i `tests/tenant-tables.ts` med testfil. Viser at ingen tabell eller migrering har sneket seg inn. |
| 4 | Hele `pnpm test` | Ingen regresjon. |
| 5 | `pnpm lint` | Produktnavnregelen og modulgrensene er urørt (ingen filer i `src/` endres). |
| 6 | `pnpm typecheck` | Ingen kodeendring som bryter typene. |

Uten nett-delen av e2e er ikke relevant: ingen skjerm endres.

## 2. Manuell sjekkliste (test-leder kjører den på ferdig branch)

| # | Sjekk | Hvordan | Godkjent når |
|---|---|---|---|
| M1 | Begge filene finnes og er merket | `head -5 docs/personvern/intern-personvernerklaering.md docs/personvern/sletting-av-betadata.md` | Begge har «utkast, ikke godkjent av Ståle» øverst. |
| M2 | Alle 19 tabeller er med | `grep -rhzoE 'pgTable\(\s*"[a-z_]+"' src/db/schema \| tr '\0' '\n' \| grep -oE '"[a-z_]+"' \| sort -u` og sammenlign med tabellen i erklæringen | Alle 19 navn står (users, sessions, accounts, verifications, login_attempts, organizations, companies, offices, employees, employee_roles, employee_permissions, certifications, files, events, audit_log, integration_connections, trial_forms, trial_answers, trial_photos). Ingen ekstra som ikke finnes. Tabeller uten personopplysninger er merket «ingen personopplysninger». |
| M3 | Én samlet rad for fase 2a | Les erklæringen | Én rad, ingen tabellnavn eller detaljer fra `fase2a-manuell-ordre`. |
| M4 | Tidene stemmer med koden | Sammenlign med `src/core/auth/auth.ts` (økt 30 dager, `updateAge` 1 døgn), `src/core/auth/otp-email.ts` (`OTP_MINUTES = 10`), `src/core/auth/login-throttle.ts` (`THROTTLE_WINDOW_MS` 15 min), `src/core/files/retention.ts` (avviksoriginal 10 år, andre originaler 2 år, komprimert 10 år) | Tallene er like. «Noen minutter» godtas ikke hvis et tall oppgis; da må det være 10. |
| M5 | Ingen påstått opprydding | Les «hvor lenge» | Det skilles mellom «koden gjør nå» og «foreslått, bygges senere». `login_attempts`, utløpte økter og `verifications` står som «ligger til de ryddes, rydding er ikke bygd». `retain_until` beskrives som ikke regnet ut ennå (fase 2). |
| M6 | iPad-lagring er med og riktig | Sammenlign med `src/modules/offline-trial/sync/` (`clearLocalPhotos`, `clearElectricStorage` kalles bare i `select-store.ts`, ikke fra `src/app/(ansatt)/log-out-button.tsx`) | IndexedDB nevnes. Det står at lokal lagring **ikke** tømmes ved utlogging i dag. Tapt iPad står som åpent spørsmål. |
| M7 | Myk sletting, `trial_*` eneste unntak | Les sletteregelen | Alt utenom `trial_forms`, `trial_answers`, `trial_photos` ryddes bare med `deleted_at`. Unntaket begrunnes med oppdiktede data og merknaden 28.10.2026, og sies å ikke være presedens. Filinnhold slettes ikke (`files.ts`: innholdet blir liggende). |
| M8 | Logg ryddes aldri | Les sletteregelen | `audit_log` og `events` ryddes aldri, heller ikke mykt (samsvarer med kommentaren i `src/db/schema/events.ts`). |
| M9 | Bare prøveorganisasjonen ryddes | Les sletteregelen | Merking er én måte: egen prøveorganisasjon med eksisterende organisasjons-ID, ingen nye felt. Det står at prøvedata aldri plukkes ut av ekte oppdrag etter innhold. |
| M10 | Admin stenges aldri ute | Les sletteregelen | Bare admin kan rydde. Oppryddingen myk-sletter aldri admin-brukeren eller admins ansatt-rad i den ekte organisasjonen. |
| M11 | Tilgang beskrevet som i dag | Sammenlign kolonnen «hvem ser det» med `docs/02-roller-og-tilgang.md` | `access.inspectors_edit_all`, reklamasjonssaker bare leder og admin, revisjonslogg bare leder og admin (`staff.manage`). Ingen nye regler. |
| M12 | Ordtelling | `wc -w` på erklæringen minus tabellen | Høyst cirka 900 ord utenom tabellen. |
| M13 | Beslutninger fra A56 | `grep -nE '\| A5[0-9]' docs/09-apne-sporsmal.md` | Nye rader starter på A56, ingen A51–A55 i denne branchen. Kontaktperson (rollen daglig leder) er en A-rad. Rydding av innloggingsforsøk/økter og iPad ved utlogging/tapt iPad står som åpne spørsmål. |
| M14 | Ingen kundeopplysninger, navn eller hemmeligheter | `git diff main -- docs/personvern` og les | Bare roller («daglig leder», «admin»). Ingen e-postadresser, navn, nøkler. |
| M15 | Ingen modellnavn, ingen fremmed fagtekst | `git diff main \| grep -iE 'claude\|opus\|sonnet\|gpt\|NS 3600\|IVIT\|SmartTakst'` | Ingen treff utover henvisning til at tekst derfra ikke brukes. |
| M16 | Ikke rørt fase2a-filer | `git diff --stat main` og `ls src/db/migrations \| grep 0013` | Bare `docs/` og `package.json` endret. Ingen migrering 0013. Versjon 0.2.70. |
| M17 | Plan og tilstand | `git diff main -- docs/07-utviklingsplan.md docs/agenter/tilstand.md` | De to punktene i «Minimum før ekte data» er krysset av med lenke til filene. Tilstandsfilen er oppdatert. |

## 3. Senere (når oppryddingen bygges, ikke i denne PR-en)

Disse testene kreves før oppryddingen godkjennes. De står her så kortet for byggingen kan arve dem.

| Testnavn | Hva den viser |
|---|---|
| «bare admin kan rydde prøveorganisasjonen» | Takstmann og leder får `AccessDeniedError`; admin får lov. |
| «rydder aldri en annen organisasjon» | `expectTenantIsolation` for spørringen som finner rader å rydde; ekte organisasjon urørt. |
| «myk-sletter, sletter aldri permanent» | Radene har `deleted_at` etter rydding og finnes fortsatt (unntatt `trial_*`). |
| «audit_log og events er urørt etter rydding» | Antall rader før og etter er likt. |
| «admin stenges aldri ute etter rydding» | Admin logger inn og har tilgang i den ekte organisasjonen etterpå. |
| e2e «rydding på PC og iPad-størrelse» | Bare hvis det lages en skjerm. |

## Godkjenning

Avvises hvis M2, M4, M5, M7, M8, M10 eller M16 feiler (alvorlig: feil om hva som lagres, eller åpning for permanent sletting). M12 og M17 regnes som små funn.
