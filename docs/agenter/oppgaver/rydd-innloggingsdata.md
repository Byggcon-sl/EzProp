# Funksjon: Rydding av innloggingsdata

- **Fase:** 2a (punktet «Rydding av innloggingsdata» under «Publisering, PDF og sending»)
- **Modul:** kjerne (`src/core/auth`, hemmelighetssjekken i `src/core/access`)
- **Status:** klar for bygging (runde 1 med forenkler, arkitekt og sikkerhet-personvern innarbeidet 14.11.2026)
- **Branch:** `rydd-innloggingsdata` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: innloggingen holder seg rask og trygg, og det ligger ikke gamle koder og økter igjen som kan misbrukes. Vi lagrer bare det vi trenger. Færre reklamasjoner: ikke direkte. KI i bunnen: ikke berørt (se under).
- **Grunnlag:** svar 10.11.2026, nr. 15 og 18 (`docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md`). Svarene er skrevet av prosjektlederen på oppdrag fra Ståle, har status «til gjennomgang», og er ført inn i planen 10.11.2026. De sier: tellere for innloggingssperren slettes etter 24 timer, økter og koder kan slettes helt, utløpte koder etter 24 timer og utløpte økter etter 30 dager.

## Problem
Tabellene `login_attempts`, `verifications` og `sessions` vokser for alltid. Hver kodebestilling, hvert feilforsøk og hver innlogging legger igjen en rad, og `sessions` har IP-adresse og nettleser, `verifications.identifier` kan ha e-post. Det er unødvendig lagring av persondata (dataminimering), og innloggingssperren blir tregere over tid.

## KI i bunnen
KI har ingen oppgave her. Dette er ren drift og rydding av tekniske innloggingsdata, som ikke er fagdata og ikke skal brukes av KI. Ingenting går gjennom `src/core/ai`.

## Brukerhistorier
- Som **admin/drift** vil jeg at utløpte innloggingsdata ryddes automatisk hver dag, slik at vi ikke lagrer mer enn nødvendig og innloggingen holder seg rask.

## Omfang
**Med:**

1. **Ryddefunksjonen** i egen fil `src/core/auth/auth-cleanup.ts`. Den importerer bare `@/db/client`, `@/db/schema` og loggeren, aldri `./auth` (Better Auth skal ikke startes). Grensesnitt:
   - `LOGIN_ATTEMPT_RETENTION_MS` og `EXPIRED_VERIFICATION_RETENTION_MS` = 24 timer, `EXPIRED_SESSION_RETENTION_MS` = 30 dager, med kilde (svar 10.11.2026, nr. 15 og 18) i kommentar.
   - `type AuthCleanupResult = { loginAttempts: number; verifications: number; sessions: number; durationMs: number }`
   - `purgeExpiredAuthData(now: Date = new Date()): Promise<AuthCleanupResult>`. `now` finnes bare for tester; endepunktet sender aldri inn tid.
   - Én transaksjon som sletter:
     - `login_attempts` med `created_at` strengt eldre enn `now − 24 t` (også `login_succeeded`-rader; ufarlig, sperren ser bare 2 timer tilbake),
     - `verifications` med `expires_at` strengt eldre enn `now − 24 t`,
     - `sessions` med `expires_at` strengt eldre enn `now − 30 d`.
   - En rad nøyaktig på grensen står. Appens klokke brukes (samme som setter `created_at` og `expires_at`).
   - Bare faste vilkår på tid. Aldri vilkår på bruker, e-post-hash eller organisasjon. Bare disse tre tabellene.
   - Idempotent: andre kjøring sletter 0.
   - Logging: én infolinje med antall per tabell, tidsbruk og utfall. Ved feil: feillinje med referansekode, uten parametre fra databasefeilen (ingen e-post, hash, token, IP, user agent eller bruker-id).

2. **Hemmelighetssjekken** i `src/core/access` (regel 2: tilgang sjekkes bare der):
   - `verifyOperationsSecret(authorizationHeader: string | null): boolean`.
   - Leser `Authorization: Bearer <hemmelighet>`. Hasher begge sider (SHA-256) og sammenligner med `timingSafeEqual`, slik at lengde og innhold ikke lekker. Usann når hemmeligheten ikke er satt.

3. **Endepunktet** `POST /api/intern/rydd-innloggingsdata` i `src/app`:
   - Kaller bare `verifyOperationsSecret` og `purgeExpiredAuthData`. Ingen databasekode i ruten.
   - Bare POST. Andre metoder avvises (405 fra Next, også med riktig hemmelighet).
   - **404** når hemmeligheten ikke er satt, mangler i kallet eller er feil. Samme svar, så endepunktet ikke røpes (se «Avgjort ved uenighet»).
   - Tar ingen inndata. Body og adresseparametre leses ikke; grenser og tid kan aldri styres utenfra.
   - Svar 200 med bare `{ loginAttempts, verifications, sessions, durationMs }`. Feil gir 500 uten detaljer. `dynamic = "force-dynamic"` og `Cache-Control: no-store` på alle svar.
   - Avvist kall logges som advarsel uten headere og uten IP.

4. **Hemmelighetens vei** til appen (ellers når den aldri fram):
   - `AUTH_CLEANUP_SECRET` i `src/shared/config/env.ts`: valgfri, minst 32 tegn, med samme `notUnresolvedReference`-vakt som de andre, slik at en uløst nøkkelboks-referanse stenger endepunktet. Egen hemmelighet, aldri `BETTER_AUTH_SECRET`.
   - `.env.example`: tom linje med forklaring (uten verdi er endepunktet av).
   - `infra/azure/main.bicep` og `.github/workflows/deploy-azure.yml`: samme mønster som `ANTHROPIC_API_KEY` (parameter, betinget hemmelighet i nøkkelboksen, appinnstilling).

5. **Planlagt arbeidsflyt** `.github/workflows/rydd-innloggingsdata.yml`:
   - `schedule` én gang i døgnet (natt) og `workflow_dispatch` for manuell kjøring.
   - `permissions: {}`. Hemmeligheten via `env`, aldri på kommandolinjen, ingen `set -x`. `curl --fail --silent --show-error -X POST` uten å skrive ut headere.
   - Adressen er en fast variabel for testmiljøet. Produksjon legges ikke inn av agentene.
   - Hopper over uten feil når hemmelighet eller adresse mangler (samme mønster som «Utrulling til Azure»).
   - Samme GitHub-secret som utrullingen bruker.

6. **ADR 0012** `docs/adr/0012-rydding-av-innloggingsdata.md` (0011 er tatt av `0011-rapportens-datamodell.md` på en branch som ikke er merget). Skal ha:
   - Unntaket fra myk sletting (regel 3) gjelder bare `login_attempts`, `verifications` og `sessions`: tekniske innloggingsdata uten `organization_id`, ikke fagdata. `users`, `accounts` og alt med `organization_id` slettes aldri hardt.
   - Ærlig hjemmel: svar gitt på Ståles oppdrag, status «til gjennomgang», ført inn i planen 10.11.2026. Ført som A-beslutning med «hvordan det kan endres». Regel 3 i `CLAUDE.md` skrives ikke om.
   - Oppbevaringstidene og hvorfor de er trygge (sperrevindu 15 min, tilbakeblikk 2 t; økter varer 30 dager og fornyes ved bruk, så en økt slettes tidligst rundt 60 dager etter siste bruk).
   - Ingen indeks og ingen migrering: etter første kjøring har tabellene bare 24 timer / rundt 60 dager med rader, og jobben går én gang i døgnet. Vurderes på nytt hvis ryddingen måles treg.
   - Kjøremåte: planlagt GitHub Actions som kaller endepunktet; kjernen vet ikke hvem som kaller, så kalleren kan byttes uten kodeendring. Forkastet: tidsur inne i appen (kjører i bygg og tester, skjult for drift), arbeidsflyt rett mot databasen (daglig åpning av brannmuren og databasepassord), Azure Functions eller Logic Apps (koster), rydding ved innlogging (tregere innlogging, ikke planlagt). Ikke noe generelt jobbrammeverk.
   - Drift: planlagte kjøringer i GitHub kan bli forsinket eller falle ut (ufarlig, idempotent). GitHub slår av planlagte kjøringer etter lang tid uten aktivitet i repoet; slik ser man det og slår dem på igjen. Kostnad: noen sekunder av de inkluderte Actions-minuttene per døgn, ingenting i Azure.
   - Forbehold om felles innlogging med Optiplan (S6): i dag har EzProp egen database (ADR 0002), selv om ADR 0008 skriver at tabellene «deles med Optiplan». Blir `sessions` og `verifications` delt, må ryddingen vurderes på nytt før den kjøres mot delte tabeller.

7. **Driftsdokumentasjon** i `docs/drift/testmiljo-azure.md` (eget avsnitt): hva jobben gjør, hvilken GitHub-secret Ståle legger inn (bare som GitHub-secret, aldri i chat, e-post eller repo), at utrullingen må kjøres på nytt etterpå, hvordan den kjøres manuelt (`workflow_dispatch`), hvordan man ser at den gikk (Actions-loggen og appens logg), hva man gjør ved feil, hvordan hemmeligheten byttes, og at produksjon trenger egen adresse og egen hemmelighet som Ståle setter opp ved utrulling.

8. **Dokumenter som i dag sier det motsatte**, rettes i samme PR:
   - `docs/05-domenemodell.md`: raden for `login_attempts` («Radene endres aldri», rundt linje 1982) får «slettes etter 24 timer»; avsnittet om felles kolonner får unntaket med henvisning til ADR 0012; ordlisten får `auth_cleanup` / «rydding av innloggingsdata» og `operations secret` / «driftshemmelighet».
   - `docs/06-arkitektur.md` (myk sletting, 10 år, rundt linje 85): henvisning til ADR 0012.
   - Oppbevaringstidene (24 t, 24 t, 30 dager etter utløp) føres der behandlingene av innloggingsdata beskrives, så de kan inn i behandlingsprotokollen.
   - Kommentarene i `src/core/auth/login-throttle.ts` og `src/db/schema/auth.ts` («ingenting slettes»).

9. **Tester** (Vitest mot testdatabasen). Bruk oppdiktede e-poster på `example.com`. Jobben sletter globalt i den delte testdatabasen, så testene lager egne rader med tider langt fra «nå» og sjekker bare egne rader:
   - Grensene: rad like før og like etter 24 t / 30 d; rad nøyaktig på grensen står.
   - Gyldige koder, gyldig Microsoft-runde (state-rad i `verifications`), gyldige økter, økt som er fornyet (`expires_at` flyttet fram) og økter utløpt mindre enn 30 dager står.
   - Tellere yngre enn 24 timer står, og en aktiv sperre virker fortsatt etter rydding (én test).
   - Idempotens: andre kjøring sletter 0.
   - To organisasjoner, lett form: `users`, `accounts` (med tokens) og `employees` er urørt for brukere i begge, og øktene deres ryddes bare etter utløpstid. Ingen fagdata bygges opp.
   - Loggen har bare antall og tid, også i feilgrenen (databasefeil med parametre): ingen e-post, hash, token, IP, user agent eller bruker-id.
   - `verifyOperationsSecret`: usann uten satt hemmelighet, uten header, med feil header, med feil lengde; sann med riktig.
   - Endepunktet: 404 uten satt hemmelighet, uten header og med feil hemmelighet; GET med riktig hemmelighet avvises; ekstra felt i body endrer ikke grensene; svaret har bare antall og `no-store`.
   - `env`: hemmelighet kortere enn 32 tegn og uløst nøkkelboks-referanse avvises.

10. Versjonsnummer økes (patch).

**Ikke med (bevisst utelatt):**
- Sletting av brukere, kontoer (`accounts`), ansatte eller noe som helst fagdata. Myk sletting gjelder fortsatt for alt annet.
- Rydding av `ai_usage_log`, revisjonslogg, filer eller andre tabeller.
- Å slå på noe i Azure (Functions, Logic Apps, Container Apps-jobber, WebJobs). Ståle legger inn hemmeligheten selv.
- Skjerm i admin for å se eller starte ryddingen.
- Egen kommando (`pnpm auth:cleanup`). Manuell kjøring går via `workflow_dispatch` (se «Avgjort ved uenighet»).
- Ny indeks eller migrering.
- Endring av hvor lenge økter og koder varer.
- Felles innlogging med Optiplan (venter på S6).
- Innloggingshistorikk for sikkerhetshendelser (spørsmål til Ståle, se under).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei | nei |
| kontor | nei | nei |
| leder | nei | nei |
| admin | nei (bare i driftsloggen) | nei |

Jobben kjøres av systemet, ikke av en innlogget bruker. Endepunktet går utenom `requireOrganizationAccess` fordi det ikke gjelder én organisasjon; det beskyttes av driftshemmeligheten, sjekket i `src/core/access`, og gjør bare den faste slettingen. Tabellene har ingen `organization_id` (samme unntak som Better Auths tabeller), så de føres ikke i `tests/tenant-tables.ts`. Admin stenges ikke ute (regel 11): ingen tilgangsregel for brukere endres.

## Data
Ingen skjemaendring og ingen migrering. Én ny valgfri miljøvariabel, `AUTH_CLEANUP_SECRET`. Ingen faste koder.

## Skjermer
Ingen.

## Regler
Ingen TG-regler. Grensene (24 timer, 30 dager) er konstanter med testsaker.

## Akseptkriterier
- [ ] Tellere og utløpte koder eldre enn 24 timer og utløpte økter eldre enn 30 dager slettes; rad på grensen står (test).
- [ ] Gyldige koder (også Microsoft-runde), gyldige og fornyede økter og nyere tellere står; en aktiv sperre virker etter rydding (test).
- [ ] `users`, `accounts` og `employees` i to organisasjoner urørt, økter ryddes bare etter tid (test).
- [ ] Idempotent: andre kjøring sletter 0 (test).
- [ ] Loggen har bare antall og tid, også ved feil (test).
- [ ] Endepunktet svarer 404 uten satt hemmelighet, uten header og med feil hemmelighet; bare POST; tar ingen inndata; `no-store` (test).
- [ ] Hemmelighetssjekken ligger i `src/core/access` og bruker hash + `timingSafeEqual` (test).
- [ ] `AUTH_CLEANUP_SECRET` valideres (minst 32 tegn, ingen uløst referanse) og føres gjennom Bicep og utrullingen.
- [ ] Planlagt arbeidsflyt med `workflow_dispatch`, `permissions: {}`, hopper over uten feil når hemmelighet eller adresse mangler.
- [ ] ADR 0012 med innholdet over.
- [ ] Driftsdokumentasjon i `docs/drift/testmiljo-azure.md`; domenemodell, arkitektur og kodekommentarer rettet.
- [ ] «Trenger Ståle når han er tilbake» i tilstandsfilen: legg inn GitHub-secret og kjør utrullingen på nytt; bekreft unntaket fra myk sletting før ekte data.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon økt.
- Bruker i annen organisasjon får ikke tilgang: gjelder ikke (ingen organisasjonsdata); erstattet av testen med to organisasjoner.
- Virker på iPad-størrelse: gjelder ikke (ingen skjerm).
- KI-forslag: gjelder ikke.

## Avgjort ved uenighet (prosjektleder, 14.11.2026)
- **Indeks:** forenkler og arkitekt ville kutte, sikkerhet-personvern ville ha indeks. Kuttet. Jobben går én gang i døgnet, tabellene holdes små av ryddingen, og ingen behov er målt. En migrering uten målt nytte er unødvendig risiko. Vurderes på nytt i ADR-en hvis ryddingen måles treg.
- **Statuskode:** forenkler ville ha 404 når av og 401 ved feil hemmelighet; arkitekt og sikkerhet-personvern ville ha 404 i alle tilfeller. Valgt 404 i alle tilfeller: endepunktet røpes ikke, og det er fortsatt én fast oppførsel å teste.
- **Kommando `pnpm auth:cleanup`:** kuttet etter forenkleren. Endepunktet når databasen fra innsiden av Azure, og `workflow_dispatch` dekker manuell kjøring. Én vei å teste og dokumentere. Lokal kjøring dekkes av testene. Arkitektens krav om egen fil uten import av `./auth` beholdes, så en kommando kan legges til senere som tynn innpakning.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`, «Avgjort av agentene mens Ståle var borte»)
- A309: Unntak fra myk sletting for `login_attempts`, `verifications` og `sessions`, bygd på svar 10.11.2026 nr. 15 og 18 (gitt på Ståles oppdrag, til gjennomgang). Kan endres ved å slå av arbeidsflyten eller fjerne hemmeligheten. **Dyrt å endre** (slettede rader kommer ikke tilbake).
- A310: Kjøremåte: planlagt GitHub Actions som kaller et beskyttet internt endepunkt, i stedet for en Azure-tjeneste som koster. **Lett å endre.**
- A311: Grensen for koder og økter måles fra `expires_at`, for tellere fra `created_at`. **Lett å endre.**
- A312: Ingen indeks; endepunktet svarer 404 på alt som ikke er godkjent. **Lett å endre.**

## Spørsmål til Ståle (stopper ikke bygging)
- Føres i `docs/09-apne-sporsmal.md` (personvern): trengs innloggingshistorikk for å undersøke sikkerhetshendelser? Etter rydding finnes bare `users.last_login_at` og driftsloggen. Jobben bygges som planlagt.

## Roller
- `arkitekt`: ADR 0012.
- `utvikler`: bit A – `auth-cleanup.ts`, `verifyOperationsSecret`, ruten, `env.ts`, `.env.example`. Bit B – arbeidsflyt, Bicep, utrulling, driftsdokumentasjon, retting av dokumenter og kommentarer.
- `testskriver` i parallell med utvikleren, mot grensesnittet over.
- `sikkerhet-personvern`: gjennomgang av endepunkt, arbeidsflyt og logging før PR.
