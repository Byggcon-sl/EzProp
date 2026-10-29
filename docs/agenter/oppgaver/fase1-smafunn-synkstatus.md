# Funksjon: Småfunn fra synkstatus (etter PR #21)

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (`sync/local/trial-store.ts`, `sync/custom/pull-schedule.test.ts`) og e2e (`e2e/helpers.ts`)
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
   - a. Etter et svar som ikke er 200 venter køen på neste forsøk. `syncNow()` sender med en gang (uten å vente på tidtakeren) og gir `"ok"` når serveren svarer 200; køen er tom etterpå.
   - b. `syncNow()` gir `"failed"` når serveren svarer 500, og køen står (ingenting går tapt).
   - c. Uten nett (`navigator.onLine` usann) gir `syncNow()` `"offline"`, og `fetch` kalles ikke.
   - d. `reader.syncNow` kalles i runden etter at køen er sendt.
   - Bruk falske tidtakere (`vi.useFakeTimers`) der det trengs, aldri ekte venting.
   - Nett styres med `vi.stubGlobal("navigator", { onLine: … })`. I Node er `navigator.onLine` ikke satt, så uten dette regnes lageret som uten nett.
   - **Avgjørelse om avhengighet:** prøv først en håndskrevet falsk `LocalDb` i testfilen. Blir den lengre enn ca. 100 linjer, eller må den etterligne mye av IndexedDB, kan `fake-indexeddb` legges inn som **devDependency** (bare i testfilen), med begrunnelse i PR-en (regel 9). Ingen andre nye avhengigheter.
2. **`ensureInspector` i `e2e/helpers.ts`:**
   - a. Bare lokal database eller testdatabasen: før den kobler til, sjekkes adressen. Tillatt er vert `localhost`, `127.0.0.1` eller `::1`, eller nøyaktig samme adresse som `TEST_DATABASE_URL`. Ellers kaster den en klar feil uten å vise adressen eller passordet («e2e skriver bare til lokal database eller testdatabasen»).
   - b. Slettede ansatte brukes aldri: søket etter den ansatte og rollen ser på `deleted_at is null` (og `deactivated_at is null` for den ansatte). Finnes takstmannen bare som slettet eller deaktivert, kaster den en klar feil som sier hva som må gjøres. Den gjenoppretter ikke og sletter ikke noe (unikt indeks på bruker og organisasjon gjør at det ikke kan lages en ny rad).
   - c. Kommentaren over funksjonen oppdateres.
3. **Loggen i `trial-store.ts`:** `console.warn` ved «Synk: sendingen stoppet.» viser bare `error.message` når feilen er en `Error`, ellers en fast tekst. Aldri hele objektet. De to eldre advarslene i samme fil («kunne ikke lese listen», «kunne ikke lese skjemaet») rettes likt, så filen følger én regel.
4. **Rydding:** fjern `failChangesOnce` fra `e2e/helpers.ts` (og `CHANGES_PATH` hvis den da ikke brukes). I `pull-schedule.test.ts`: bytt `"sync-now" as PullOutcome` med en typet konstant (`PullEvent`), og la hjelpefunksjonen `run` ta `PullEvent`. Ingen endring i `pull-schedule.ts`.
5. Versjon i `package.json`: 0.2.12 → 0.2.13.

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
- [ ] `trial-store.test.ts` har testsakene 1a–1d, kjører uten nettleser og uten ekte venting, og feiler hvis `sendNow` ikke hopper over ventetiden (sjekk ved å kommentere ut `clearTimeout` lokalt).
- [ ] `ensureInspector` kaster før tilkobling når adressen ikke er lokal eller `TEST_DATABASE_URL`, uten å vise adressen. Den bruker aldri en slettet eller deaktivert ansatt eller en slettet rolle, og gjenoppretter ingenting.
- [ ] Ingen `console.warn`/`console.error` i `trial-store.ts` skriver et helt feilobjekt.
- [ ] `failChangesOnce` finnes ikke lenger, og `pull-schedule.test.ts` har ingen `as PullOutcome`.
- [ ] Eventuell ny devDependency er begrunnet i PR-en.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne. Versjon 0.2.13.

## Roller
- **utvikler:** punkt 2, 3, 4 og 5.
- **testskriver (i parallell):** punkt 1 (ny testfil). Kontrakten er dagens `createLocalTrialStore`, `LocalDb` og `LocalTrialReader`; ingen endring i kode utenfor testfilen. Finner testskriveren en feil i `syncNow`, meldes den til prosjektlederen og rettes ikke i samme bit.
- Ingen arkitekt, UX, UI, KI, fag eller sikkerhet-personvern: ingen nye valg. Punkt 2a og 3 gjør det tryggere, og er rett frem.

## Åpne spørsmål
- Ingen nye. Nr. 10, 11 og 12 gjelder fortsatt.
