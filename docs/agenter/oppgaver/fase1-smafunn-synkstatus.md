# Funksjon: Småfunn fra synkstatus (etter PR #21)

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (`sync/local/trial-store.ts`, `sync/custom/pull-schedule.test.ts`) og e2e (`e2e/helpers.ts`, ny `e2e/database-guard.ts`)
- **Status:** godkjent (prosjektleder 29.10.2026)
- **Branch:** `fase1-smafunn-synkstatus`, bygger på `main`
- **Støtter hovedmål:** Reklamasjoner: «Synk nå» er det takstmannen bruker for å sikre at ingenting bare ligger på iPaden; nå testes det også uten nettleser, så en feil oppdages før prøve A og B. Tid: færre ustabile tester og ingen e2e-hjelper som kan skrive i feil database. KI først: indirekte, synken er grunnlaget for at KI-forslag senere kan vises og godkjennes på iPaden.

## Problem
Gjennomgangen av PR #21 (synkstatus som alltid vises) fant små ting som ikke stoppet merge:

1. «Synk nå» i den lokale kjernen (`createLocalTrialStore`, `syncNow` og `sendNow` i `trial-store.ts`, brukt av kandidat 2 og 3) testes bare med e2e. Det finnes ingen enhetstest som viser at køen sendes med en gang, forbi ventetiden etter en feil.
2. `ensureInspector` i `e2e/helpers.ts` ser ikke på `deleted_at`/`deactivated_at` for takstmannen og rollen hans, og skriver i hvilken database som helst som står i `DATABASE_URL` eller `.env`.
3. `console.warn("Synk: sendingen stoppet.", error)` i `trial-store.ts` skriver hele feilobjektet til konsollen. Loggen skal bare vise meldingen.
4. `failChangesOnce` i `e2e/helpers.ts` brukes ikke, og `"sync-now" as PullOutcome` i `pull-schedule.test.ts` er en unødvendig typekonvertering (`sync-now` er en `PullEvent`).

## KI først
Nei. Dette er tester og rydding. Det finnes ingenting takstmannen skal kontrollere eller godkjenne her.

## Brukerhistorier
- Som **utvikler** vil jeg at en feil i «Synk nå» stopper `pnpm test`, slik at den ikke først vises på iPaden.
- Som **utvikler** vil jeg at e2e aldri skriver i en annen database enn den lokale eller testdatabasen.

## Omfang
**Med:**
1. **Enhetstest for «Synk nå» i lageret** (ny fil `src/modules/offline-trial/sync/local/trial-store.test.ts`). Testene bruker `createLocalTrialStore` med en `LocalDb` laget i testen (i minnet), en enkel `reader` og en byttet ut `fetch`. Testsaker:
   - a. Etter et svar som ikke er 200 venter køen på neste forsøk. `syncNow()` sender med en gang og gir `"ok"` når serveren svarer 200; køen er tom etterpå. Tiden flyttes **ikke** fram før `syncNow()` er ferdig: `fetch` er da kalt 2 ganger og resultatet er `"ok"` (`runSyncNow` har egen tidsfrist, så om tiden flyttes fram, blir en feil til `"failed"` i stedet for at testen henger). Etterpå flyttes tiden forbi ventetiden: ingen flere `fetch`-kall, og `vi.getTimerCount()` er 0 (eller bare varslingstidtakeren, `setTimeout(0)`).
   - b. `syncNow()` gir `"failed"` når serveren svarer 500, og køen står (ingenting går tapt).
   - c. Uten nett (`navigator.onLine` usann) gir `syncNow()` `"offline"`, og `fetch` kalles ikke.
   - d. `reader.syncNow` kalles i runden etter at køen er sendt (`fetch` før `reader.syncNow`). Blir testfilen for stor, kan 1d slås sammen med 1a.
   - e. `db.inTransaction` kaster `new Error("hemmelig-innhold")`. Første `console.warn` ved «Synk: sendingen stoppet.» får bare meldingen eller en fast tekst; ingen argument er `instanceof Error` (`vi.spyOn(console, "warn")`). De to «kunne ikke lese»-advarslene sjekkes ved gjennomlesing, eller med lignende test hvis det er enkelt.
   - f. `fetch` kaster (nettfeil): `syncNow()` gir `"failed"`, og køen står.
   - Bruk falske tidtakere (`vi.useFakeTimers`) der det trengs, aldri ekte venting.
   - Nett styres med `vi.stubGlobal("navigator", { onLine: … })`. I Node er `navigator.onLine` ikke satt, så uten dette regnes lageret som uten nett. `afterEach`: `vi.unstubAllGlobals()` og `vi.useRealTimers()`.
   - **Falsk `LocalDb`, ingen ny avhengighet:** håndskrevet i testfilen. Legg køen inn som `OutboxEntry`-rader i det falske lageret før `createLocalTrialStore`, så den leses inn ved åpning; da trenger transaksjonen bare å etterligne `objectStore().delete` med en forespørsel som får `onsuccess`. `reader` er en enkel stub uten egne tidtakere, `reader.syncNow` er en `vi.fn`. `fake-indexeddb` legges **ikke** inn (prøvekoden kastes eller gjøres om etter ADR-en). Blir den falske databasen for stor, gjøres testen mindre.
2. **`ensureInspector` i `e2e/helpers.ts`:**
   - a. Bare lokal database eller testdatabasen: før den kobler til, sjekkes adressen med en ren funksjon `assertLocalOrTestDatabase(url, testUrl)` i ny fil `e2e/database-guard.ts`. Vertsnavnet leses med `new URL(...).hostname`. Tillatt er `localhost`, `127.0.0.1` eller `[::1]` (`hostname` gir IPv6 med klammer), eller nøyaktig samme adresse som `TEST_DATABASE_URL`. Ellers kaster den en klar feil uten å vise adressen, verten eller passordet («e2e skriver bare til lokal database eller testdatabasen»). Ingen egen hjelpemodul utover denne filen, ingen innstilling, ingen liste over flere verter.
   - b. Slettede ansatte brukes aldri: søket etter den ansatte og rollen ser på `deleted_at is null` (og `deactivated_at is null` for den ansatte). Finnes takstmannen bare som slettet eller deaktivert, eller rollen `inspector` bare som slettet, kaster den en klar feil som sier hva som må gjøres. Indeksene på bruker+organisasjon og ansatt+rolle gjelder også slettede rader, så i dag hopper `on conflict do nothing` over i stillhet. Admin med `deleted_at` brukes ikke. Bare filtrer og kast: ingen kode som gjenoppretter, sletter eller rydder.
   - c. Kommentaren over funksjonen oppdateres.
3. **Loggen i `trial-store.ts`:** `console.warn` ved «Synk: sendingen stoppet.» viser bare `error.message` når feilen er en `Error`, ellers en fast tekst. Aldri hele objektet. De to eldre advarslene i samme fil («kunne ikke lese listen», «kunne ikke lese skjemaet») rettes likt, så filen følger én regel.
4. **Rydding:** fjern `failChangesOnce` fra `e2e/helpers.ts` (og `CHANGES_PATH` hvis den da ikke brukes). I `pull-schedule.test.ts`: bytt `"sync-now" as PullOutcome` med en typet konstant (`PullEvent`), og la hjelpefunksjonen `run` ta `PullEvent`. Ingen endring i `pull-schedule.ts`.
5. **Tester for punkt 2:**
   - `tests/e2e-database-guard.test.ts` (enhetstest av `assertLocalOrTestDatabase`): `localhost`, `127.0.0.1` og `[::1]` godtas; nøyaktig `TEST_DATABASE_URL` godtas; annen vert kaster uten å vise vert eller passord; adresse som ikke kan leses kaster uten å vise adressen; `localhost.eksempel.no` kaster.
   - Integrasjonstest mot testdatabasen for `ensureInspector` (`setup-env` setter `DATABASE_URL` til testdatabasen), oppdiktede data via `tests/factories.ts`: ansatt med `deleted_at` gir klar feil og ingen rader endres; ansatt med `deactivated_at` gir det samme; rollen `inspector` med `deleted_at` gir klar feil; `deleted_at` er uendret etterpå; admin med `deleted_at` brukes ikke.
6. Versjon i `package.json`: 0.2.12 → 0.2.13.

**Ikke med (bevisst utelatt):**
- Ingen nye funksjoner og ingen endring i hvordan synkstatus eller «Synk nå» virker.
- Ingen endring i PowerSync-kandidaten. At PowerSyncs egen ventetid hoppes over, kan ikke vises uten en PowerSync-tjeneste i e2e; det tas i prøve A og B.
- De eldre databasetestene som feilet én gang på tid (`changes-since`, `trial-queries`) og den økte fristen i én egenbygd-e2e-test røres ikke.
- Forenklerens punkter (dobbel sperre mot to raske trykk, `syncButtonState`, strukturtester som leser kildefiler, egne ikoner og farger) røres ikke. Prøven kastes eller gjøres om etter ADR-en.
- Ingen migrering, ingen ny spørring som tar `organizationId`, ingen nye spørsmål til Ståle.

## Tilgang
Ingen endring. Ingen ny spørring i appen som tar `organizationId`, så ingen ny tenant-isolasjonstest. Admin berøres ikke.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | – | – |
| kontor | – | – |
| leder | – | – |
| admin | – | – |

## Data
Ingen endring i tabeller eller faste koder.

## Skjermer
Ingen.

## Regler
Ingen fagregler.

## Akseptkriterier
- [ ] `trial-store.test.ts` har testsakene 1a–1f, kjører uten nettleser og uten ekte venting, og feiler hvis `sendNow` følger ventetiden (sjekk lokalt ved å legge inn `if (retryWaiting) return false`-lignende venting i `sendNow`; å fjerne `clearTimeout` alene viser ingenting, fordi den gamle tidtakeren går mot tom kø).
- [ ] `ensureInspector` kaster før tilkobling når adressen ikke er lokal eller `TEST_DATABASE_URL`, uten å vise adressen. Vist med `tests/e2e-database-guard.test.ts`.
- [ ] `ensureInspector` bruker aldri en slettet eller deaktivert ansatt eller en slettet rolle, og gjenoppretter ingenting. Vist med integrasjonstest mot testdatabasen.
- [ ] Ingen `console.warn`/`console.error` i `trial-store.ts` skriver et helt feilobjekt.
- [ ] `failChangesOnce` finnes ikke lenger, og `pull-schedule.test.ts` har ingen `as PullOutcome` (grep); `pnpm typecheck` viser at `run` tar `PullEvent`.
- [ ] Ingen nye avhengigheter.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.13.

## Roller
- **utvikler:** punkt 2, 3, 4 og 6.
- **testskriver (i parallell):** punkt 1 og 5 (nye testfiler). Signaturen `assertLocalOrTestDatabase(url, testUrl)` og at `ensureInspector` kaster en `Error`, er kontrakten mellom bitene. Kontrakten er dagens `createLocalTrialStore`, `LocalDb` og `LocalTrialReader`; ingen endring i kode utenfor testfilen. Finner testskriveren en feil i `syncNow`, meldes den til prosjektlederen og rettes ikke i samme bit.
- Ingen arkitekt, UX, UI, KI, fag eller sikkerhet-personvern: ingen nye valg. Punkt 2a og 3 gjør det tryggere, og er rett frem.

## Endringer etter gjennomgang (prosjektleder 29.10.2026)
- **Forenkler:** `fake-indexeddb` er tatt ut. Prøvekoden kastes eller gjøres om etter ADR-en, så en ny avhengighet er ikke verdt det. 2a holdes enkel (`hostname` mot tre verter eller `TEST_DATABASE_URL`), 2b bare filtrerer og kaster.
- **Test-leder:** kontrollen i 1a er endret, fordi å fjerne `clearTimeout` ga grønn test uansett. 2a fikk en ren funksjon med enhetstest (`e2e/` er ikke med i vitest), 2b fikk integrasjonstest, og 1e (logg) og 1f (nettfeil) er lagt til. Den rene funksjonen i egen fil er ikke i strid med forenklerens «ingen hjelpemodul»: den er nødvendig for at sjekken kan testes, og har ingen innstilling.
- Ingen uenighet som måtte avgjøres utover dette.

## Åpne spørsmål
- Ingen nye. Nr. 10, 11 og 12 gjelder fortsatt.
