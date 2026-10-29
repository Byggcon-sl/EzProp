# Testplan: Småfunn fra synkstatus (etter PR #21)

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-smafunn-synkstatus.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-smafunn-synkstatus` (bygger på `main`)
- **Laget av:** test-leder, 29.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: «Synk nå» er det takstmannen bruker for å sikre at ingenting bare ligger på iPaden, og en feil der skal stoppe `pnpm test` før prøve A og B. Tid: e2e-hjelperen kan ikke skrive i feil database eller bruke slettede ansatte, så testene er til å stole på. KI først: indirekte (synken er grunnlaget for KI-forslag på iPaden).

## Hva som skal vises

1. «Synk nå» i den lokale kjernen sender køen med en gang, forbi ventetiden etter en feil, og mister ingenting ved feil.
2. Loggen i `trial-store.ts` skriver aldri et helt feilobjekt.
3. `ensureInspector` skriver bare til lokal database eller testdatabasen, og bruker aldri slettede eller deaktiverte ansatte eller slettede roller. Den gjenoppretter ingenting.
4. Ryddingen (`failChangesOnce`, `as PullOutcome`) endrer ingen oppførsel.

## 1. Enhetstester: `src/modules/offline-trial/sync/local/trial-store.test.ts` (ny)

Oppsett for alle: `createLocalTrialStore` med en håndskrevet falsk `LocalDb` i testfilen (ingen `fake-indexeddb`, ingen ny avhengighet). Køen legges inn som `OutboxEntry`-rader før åpning. `reader` er en stub uten tidtakere, `reader.syncNow` er `vi.fn`. `fetch` byttes med `vi.stubGlobal("fetch", vi.fn())`. Nett med `vi.stubGlobal("navigator", { onLine: true/false })`. `vi.useFakeTimers()` der det trengs; aldri ekte venting. `afterEach`: `vi.unstubAllGlobals()`, `vi.useRealTimers()`, `vi.restoreAllMocks()`, og lageret lukkes. Alle data er oppdiktet (ingen ekte adresser eller navn).

| # | Testnavn | Hva den viser |
|---|---|---|
| T1a | «Synk nå sender køen med en gang etter en feil, forbi ventetiden» | Første `fetch` gir 503: køen står og venter. `syncNow()` uten å flytte tiden: `fetch` kalt 2 ganger, resultat `"ok"`, køen tom (`readRows("outbox")` er `[]`). Deretter `vi.advanceTimersByTime` forbi `retryDelayMs`: ingen nye `fetch`-kall, og `vi.getTimerCount()` er 0 (eller bare varslingstidtakeren `setTimeout(0)`). |
| T1b | «Synk nå gir failed ved 500, og køen står» | `fetch` gir 500. `syncNow()` gir `"failed"`. Køen har samme antall rader og samme innhold som før. |
| T1c | «Synk nå uten nett gir offline og sender ingenting» | `navigator.onLine = false`. `syncNow()` gir `"offline"`, `fetch` er ikke kalt, køen står. |
| T1d | «Synk nå henter etter at køen er sendt» | `fetch` gir 200. `reader.syncNow` er kalt én gang, og etter siste `fetch` (`mock.invocationCallOrder`). Kan slås sammen med T1a. |
| T1e | «loggen viser bare feilmeldingen, aldri feilobjektet» | `db.inTransaction` kaster `new Error("hemmelig-innhold")` ved kvittering. `vi.spyOn(console, "warn")`: kallet med «Synk: sendingen stoppet.» har ingen argumenter som er `instanceof Error` eller objekter; meldingen er en streng. Hvis enkelt: samme sjekk for «kunne ikke lese listen» og «kunne ikke lese skjemaet» (`readAll` kaster). Ellers sjekkes de to ved gjennomlesing. |
| T1f | «Synk nå ved nettfeil gir failed, og køen står» | `fetch` kaster `TypeError`. `syncNow()` gir `"failed"`, køen står. |

**Kontroll av at testen biter (test-leder gjør det lokalt, ikke i PR-en):** legg inn `if (retryWaiting) return;`-lignende venting i `sendNow` (følger ventetiden). T1a skal da bli rød (resultat `"failed"` eller færre `fetch`-kall), ikke henge. Å bare fjerne `clearTimeout` viser ingenting og teller ikke. Testen skal heller ikke henge hvis tiden ikke flyttes: `runSyncNow` har egen frist.

## 2. Enhetstester: `tests/e2e-database-guard.test.ts` (ny)

Tester den rene funksjonen `assertLocalOrTestDatabase(url, testUrl)` i `e2e/database-guard.ts`. Oppdiktede adresser og passord.

| # | Testnavn | Hva den viser |
|---|---|---|
| G1 | «godtar localhost, 127.0.0.1 og [::1]» (`it.each`) | Kaster ikke for `postgres://u:p@localhost:5432/x`, `…@127.0.0.1…`, `…@[::1]…`. |
| G2 | «godtar nøyaktig TEST_DATABASE_URL» | Ekstern vert som er lik `testUrl` tegn for tegn godtas. |
| G3 | «annen vert kaster uten å vise vert eller passord» | `postgres://u:hemmelig-pw@db.eksempel.no/x` kaster `Error`; meldingen inneholder verken `hemmelig-pw`, `db.eksempel.no` eller hele adressen. |
| G4 | «adresse som ikke kan leses kaster uten å vise adressen» | `ikke-en-adresse-hemmelig` kaster; meldingen inneholder ikke strengen. |
| G5 | «localhost.eksempel.no kaster» | Ingen prefiks- eller delstreng-match. |
| G6 | «nesten lik TEST_DATABASE_URL kaster» | Ekstern vert med annet databasenavn eller passord enn `testUrl` kaster (nøyaktig likhet, ikke bare vert). |
| G7 | «tom testUrl godtar ikke ekstern vert» | `testUrl` `undefined` eller `""` gjør ikke en ekstern adresse lovlig. |

## 3. Integrasjonstester mot testdatabasen: `tests/e2e-ensure-inspector.test.ts` (ny)

`setup-env` setter `DATABASE_URL` til testdatabasen, og den er lik `TEST_DATABASE_URL`, så vakten slipper gjennom. `beforeEach`: `resetDatabase()`. Data via `tests/factories.ts`: organisasjon, admin med `ADMIN_EMAIL` (rolle `admin`), og eventuelt takstmann med `INSPECTOR_EMAIL`. Slettet/deaktivert settes med `db.update(...).set({ deletedAt/deactivatedAt })`.

**Risiko å sjekke først:** `e2e/helpers.ts` importerer `expect` fra `@playwright/test` som verdi. Lar ikke filen seg importere i Vitest, meldes det til prosjektlederen (ingen flytting av kode utenfor oppgavekortet uten avklaring).

| # | Testnavn | Hva den viser |
|---|---|---|
| I1 | «lager takstmannen med rollen inspector i adminens organisasjon» | Uten takstmann fra før: etter kallet finnes én aktiv ansatt med `INSPECTOR_EMAIL` og én aktiv `inspector`-rolle, i adminens organisasjon. Regresjon for dagens oppførsel. |
| I2 | «to kall gir ingen dobbeltrader» | Andre kall endrer ingenting (samme antall rader i `users`, `employees`, `employee_roles`). |
| I3 | «slettet takstmann gir klar feil og ingen rader endres» | Ansatt med `deleted_at`: kaster `Error` med melding som sier hva som må gjøres. Antall rader og `deleted_at` er uendret; ingen ny ansatt eller rolle. |
| I4 | «deaktivert takstmann gir klar feil og ingen rader endres» | Som I3 med `deactivated_at`; `deactivated_at` er uendret. |
| I5 | «slettet inspector-rolle gir klar feil og gjenopprettes ikke» | Aktiv ansatt, rollen `inspector` med `deleted_at`: kaster; rollens `deleted_at` er uendret, ingen ny rolle. |
| I6 | «slettet admin brukes ikke» | Organisasjon A med slettet admin (`ADMIN_EMAIL`), organisasjon B med aktiv admin: takstmannen lages i B, aldri i A. Bare slettet admin: kaster «Fant ikke admin …», ingen rader skrevet. |
| I7 | «adresse som ikke er lokal eller testdatabasen stopper før tilkobling» | `DATABASE_URL` byttes midlertidig (`vi.stubEnv`) til en oppdiktet ekstern vert: kaster vaktens feil, ingen tilkobling (testen fullfører raskt, ingen nettverksfeil). Gjenopprettes i `afterEach` (`vi.unstubAllEnvs()`). |

## 4. Rydding (punkt 4)

| # | Sjekk | Hva den viser |
|---|---|---|
| R1 | `grep -rn failChangesOnce e2e src tests` er tom | Funksjonen er fjernet. `CHANGES_PATH` står, fordi `e2e/fase-1-synkstatus.spec.ts` bruker den. |
| R2 | `grep -n "as PullOutcome" src/modules/offline-trial/sync/custom/pull-schedule.test.ts` er tom | Casten er borte; `SYNC_NOW` er en typet `PullEvent`, og `run` tar `readonly PullEvent[]`. `pnpm typecheck` grønn. Den utdaterte kommentaren om `as PullOutcome` (linje ca. 127) er fjernet eller rettet. |
| R3 | `pull-schedule.ts` er uendret (`git diff main -- …pull-schedule.ts` tom) | Ingen endring i oppførsel. |
| R4 | `grep -n "console\.\(warn\|error\)" trial-store.ts` | Ingen kall sender `error` (hele objektet) som argument. |

## 5. Tilgang per rolle

Ingen endring. Ingen ny rettighet, side eller handling i appen; `src/core/access` røres ikke. `ensureInspector` er en testhjelper, ikke appkode. Admin berøres ikke (I6 viser at seed-adminen brukes som før), så regel 11 holdes. Avvises hvis PR-en endrer noe i `src/core/access` eller rolletabellene.

## 6. Tenant-isolasjon

Ingen ny spørring i appen tar `organizationId`, så ingen nytt kall til `expectTenantIsolation`. Det nærmeste er I6: takstmannen lages bare i organisasjonen til en aktiv admin. Den falske `LocalDb` i T1 bruker én oppdiktet organisasjon. Avvises hvis PR-en likevel legger til en spørring med `organizationId` uten test.

## 7. Myk sletting

I3–I5 viser at `ensureInspector` verken sletter, gjenoppretter eller endrer `deleted_at`/`deactivated_at`. T1b, T1e og T1f viser at køen ikke tømmes ved feil (ingenting går tapt lokalt).

## 8. Regeltester

Ingen. Oppgaven rører ingen fagregler, TG-logikk eller faste koder.

## 9. E2e (PC og iPad-størrelse)

Ingen nye e2e-tester. Hele `pnpm test:e2e` skal være grønn i begge prosjektene (PC og iPad), særlig `e2e/fase-1-synkstatus.spec.ts` (bruker `logInAsInspector`, `CHANGES_PATH` og «Synk nå» uten nett). CI bruker `localhost` i `DATABASE_URL`, så vakten slipper gjennom; hvis e2e i CI stopper på vakten, er det et **alvorlig** funn.

## 10. Kjøres til slutt (test-leder)

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. I tillegg: kontrollen i avsnitt 1 (testen biter), at versjonen er 0.2.13, og at `package.json` ikke har nye avhengigheter.

## Avvisningsgrunner

- **Alvorlig:** T1a mangler eller biter ikke; I3–I5 mangler; vakten viser adresse, vert eller passord i feilmeldingen; `ensureInspector` gjenoppretter eller rydder rader; ny avhengighet (f.eks. `fake-indexeddb`); ekte venting eller ekte nett i enhetstestene.
- **Lite:** T1e dekker bare én av tre advarsler (de to andre sjekket ved gjennomlesing er godt nok); G6/G7 mangler; utdatert kommentar i `pull-schedule.test.ts`.
