# Funksjon: Rydding av innloggingsdata

- **Fase:** 2a (punktet «Rydding av innloggingsdata» under «Publisering, PDF og sending»)
- **Modul:** kjerne (`src/core/auth`)
- **Status:** utkast
- **Branch:** `rydd-innloggingsdata` (bygger på `main`)
- **Støtter hovedmål:** De ansatte: innloggingen holder seg rask og trygg, og det ligger ikke gamle koder og økter igjen som kan misbrukes. Færre reklamasjoner: ikke direkte. KI i bunnen: ikke berørt (se under).
- **Grunnlag:** svar 10.11.2026, nr. 15 og 18 (`docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md`): tellere for innloggingssperren slettes etter 24 timer, økter og koder kan slettes helt, utløpte koder etter 24 timer og utløpte økter etter 30 dager.

## Problem
Tabellene `login_attempts`, `verifications` og `sessions` vokser for alltid. Hver kodebestilling, hvert feilforsøk og hver innlogging legger igjen en rad. Det er unødvendig lagring av innloggingsdata (personvern: dataminimering), og spørringene i innloggingssperren blir tregere over tid. Lar vi være, har vi etter ti år millioner av rader som ingen trenger.

## KI i bunnen
KI har ingen oppgave her. Dette er ren drift og rydding av tekniske innloggingsdata, som ikke er fagdata og ikke skal brukes av KI. Ingen data lagres for KI, og ingenting går gjennom `src/core/ai`.

## Brukerhistorier
- Som **admin/drift** vil jeg at utløpte innloggingsdata ryddes automatisk hver dag, slik at vi ikke lagrer mer enn nødvendig og innloggingen holder seg rask.

## Omfang
**Med:**
- Én ryddefunksjon i `src/core/auth` (for eksempel `purgeExpiredAuthData(now)`) som i én transaksjon sletter:
  - `login_attempts` med `created_at` eldre enn 24 timer (sperrevinduet er 15 minutter og tilbakeblikket 2 timer, så 24 timer berører aldri en aktiv sperre),
  - `verifications` med `expires_at` eldre enn 24 timer,
  - `sessions` med `expires_at` eldre enn 30 dager.
- Grensene som navngitte konstanter med kilde (svar 10.11.2026, nr. 15 og 18).
- Idempotent: to kjøringer etter hverandre gir samme resultat, andre kjøring sletter 0.
- Logging av antall slettede rader per tabell og tidsbruk, uten e-post, hash, token, IP eller bruker-id.
- Kommando `pnpm auth:cleanup` (kjører funksjonen én gang og avslutter med feilkode ved feil).
- Planlagt kjøring én gang i døgnet. Det finnes ingen bakgrunnsjobb i repoet fra før. Anbefalt løsning (arkitekten bekrefter i ADR): et internt endepunkt beskyttet med egen hemmelighet (konstant-tids-sammenligning, svarer 404 eller 401 uten hemmelighet), kalt av en planlagt GitHub Actions-arbeidsflyt. Arbeidsflyten hopper over uten feil når hemmeligheten eller adressen mangler, samme mønster som «Utrulling til Azure». Koster ingenting ekstra i Azure.
- ADR i `docs/adr/` (neste nummer): hvorfor innloggingsdata er bevisst unntak fra myk sletting (regel 3). Det er tekniske innloggingsdata uten organisasjons-ID, ikke fagdata, og Ståles svar nr. 18 (a) sier at de kan slettes helt. Også: valg av kjøremåte.
- Driftsdokumentasjon i `docs/drift/testmiljo-azure.md` (eget avsnitt): hva jobben gjør, hvilken hemmelighet Ståle legger inn, hvordan den kjøres manuelt, hvordan man ser i loggen at den gikk, og hva man gjør hvis den feiler.
- Tester (Vitest mot testdatabasen):
  - gamle tellere, utløpte koder og utløpte økter slettes ved grensene (like før og like etter 24 timer / 30 dager),
  - gyldige koder, gyldige økter og økter som er utløpt mindre enn 30 dager urørt,
  - tellere yngre enn 24 timer urørt, og en aktiv sperre virker fortsatt etter rydding,
  - idempotens (andre kjøring sletter 0),
  - ingen andre tabeller berøres, særlig `users`, `accounts`, `employees` og fagdata i to organisasjoner,
  - økter for brukere i to ulike organisasjoner behandles bare etter utløpstid, aldri etter organisasjon,
  - loggen inneholder bare antall (ingen persondata),
  - endepunktet avviser kall uten eller med feil hemmelighet.
- Versjonsnummer økes (patch). Ordlisten oppdateres (`auth_cleanup` / «rydding av innloggingsdata»).

**Ikke med (bevisst utelatt):**
- Sletting av brukere, kontoer (`accounts`), ansatte eller noe som helst fagdata. Myk sletting gjelder fortsatt for alt annet.
- Rydding av `ai_usage_log`, revisjonslogg, filer eller andre tabeller.
- Å slå på noe i Azure (Functions, Logic Apps, Container Apps-jobber, WebJobs med kostnad). Ståle legger inn hemmeligheten selv.
- Skjerm i admin for å se eller starte ryddingen.
- Endring av hvor lenge økter og koder varer (30 dager og kodens levetid står som før).
- Felles innlogging med Optiplan (venter på S6).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | nei | nei |
| kontor | nei | nei |
| leder | nei | nei |
| admin | nei (bare i driftsloggen) | nei |

Jobben kjøres av systemet, ikke av en innlogget bruker. Endepunktet går utenom `requireOrganizationAccess` fordi det ikke gjelder én organisasjon; det beskyttes av driftshemmeligheten og gjør bare den faste slettingen. Tabellene har ingen `organization_id` (samme unntak som Better Auths tabeller), så de føres ikke i `tests/tenant-tables.ts`.

## Data
Ingen nye tabeller eller kolonner. Mulig ny indeks på `verifications.expires_at` og `sessions.expires_at` hvis det trengs for fart (migrering, tåler ekte data). Ingen faste koder. Ny miljøvariabel for driftshemmeligheten i `.env.example` (valgfri; uten den er endepunktet av).

## Skjermer
Ingen.

## Regler
Ingen TG-regler. Grensene (24 timer, 30 dager) er konstanter med testsaker.

## Akseptkriterier
- [ ] Gamle tellere og utløpte koder eldre enn 24 timer slettes, utløpte økter eldre enn 30 dager slettes (test ved grensene).
- [ ] Gyldige koder og økter, og nyere tellere, berøres ikke; en aktiv sperre virker etter rydding (test).
- [ ] Andre tabeller og andre organisasjoners data berøres ikke (test med to organisasjoner).
- [ ] Idempotent: andre kjøring sletter 0 (test).
- [ ] Loggen har bare antall og tid, ingen persondata (test).
- [ ] Endepunktet avviser kall uten eller med feil hemmelighet (test).
- [ ] `pnpm auth:cleanup` virker lokalt.
- [ ] Planlagt arbeidsflyt hopper over uten feil når hemmeligheten mangler.
- [ ] ADR om unntaket fra myk sletting og valg av kjøremåte.
- [ ] Driftsdokumentasjon i `docs/drift/testmiljo-azure.md`, og «Trenger Ståle» i tilstandsfilen sier hvilken hemmelighet han legger inn.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne. Versjon økt.
- Bruker i annen organisasjon får ikke tilgang: gjelder ikke (ingen organisasjonsdata); erstattet av testen over om at andre organisasjoners data ikke berøres.
- Virker på iPad-størrelse: gjelder ikke (ingen skjerm).
- KI-forslag: gjelder ikke.

## Beslutninger i autonom modus (føres i `docs/09-apne-sporsmal.md`, neste ledige A-nummer etter A308)
- Kjøremåte: planlagt GitHub Actions som kaller et beskyttet internt endepunkt, i stedet for en Azure-tjeneste som koster. **Lett å endre.**
- Grensen for koder måles fra `expires_at` (ikke `created_at`), for økter fra `expires_at`, for tellere fra `created_at`. **Lett å endre.**

## Roller
- `arkitekt`: ADR (unntak fra myk sletting, kjøremåte og sikring av endepunktet).
- `sikkerhet`: endepunkt utenfor vanlig tilgangssjekk, hemmelighet, logging uten persondata.
- `utvikler` og `testskriver` i parallell.

## Åpne spørsmål
- Ingen som stopper bygging.
