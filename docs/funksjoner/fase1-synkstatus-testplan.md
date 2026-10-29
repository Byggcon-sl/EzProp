# Testplan: Synkstatus som alltid vises

- **Oppgavekort:** `docs/funksjoner/fase1-synkstatus.md` (pkt.-numrene under viser til «Omfang», «A1–A7» til «Avgjørelser før bygging»)
- **Fase:** 1 – Prøve uten nett, punktet «Synkstatus som alltid vises: antall endringer og bilder som venter, «lagret kl.», og «Synk nå»»
- **Branch:** `fase1-synkstatus` (bygger på `main`)
- **Dato:** 29.10.2026
- **Laget av:** test-leder, før koding. Testnavnene og filnavnene er bindende for testskriver. Utvikler leser avsnitt 7 («Krav til koden som testene bygger på»).
- **Støtter hovedmål:** Reklamasjoner (testene viser at «Alt er lagret» og «Lagret kl.» bare vises når serveren faktisk har bekreftet alt, så takstmannen aldri drar fra en befaring i tro på noe som ikke stemmer). Tid (testene viser at «Synk nå» sender med en gang og hopper over ventetiden etter feil). KI først: ikke KI her; synkstatusen er grunnlaget for at KI-forslag fra serveren senere kan vises på iPaden.

Prøve A og B på ekte iPad er **ikke** del av planen (Ståle, `docs/funksjoner/fase1-prove-ab-*.md`). Planen dekker det som kan vises i Vitest og Playwright (Chromium, prosjektene `pc` og `ipad`).

## 0. Viktig for e2e: hva hver kandidat kan nå i skyen

| Kandidat | Sending (`/api/prove/synk/endringer`) | Henting | Kan vise «Alt er lagret» i e2e? |
|---|---|---|---|
| PowerSync | bare hvis `syncNow` selv kaller opplastingen (krav K3) | nei, ingen PowerSync-tjeneste | **nei** |
| ElectricSQL | ja | nei, shape-ruten svarer 502 | **nei** |
| Egenbygd | ja | ja (`/api/prove/synk/hent`) | **ja** |

Følgen: tester som krever «Alt er lagret» eller nytt «Lagret kl.» ende til ende kjøres **bare med egenbygd**. For PowerSync og ElectricSQL viser e2e det motsatte, som er like viktig for reklamasjonsmålet: uten bekreftet henting står det aldri «Alt er lagret», selv når køen er tom (regelen om `serverConfirmed`). Visningen av et lagret «Lagret kl.» testes for alle tre ved at tidspunktet legges i `localStorage` før lasting.

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`, `tests/offline-trial.ts` (`setupOrganization`, `ALL_ROLES`): brukes uendret. Ingen nye fabrikker i Vitest.
- `tests/tenant-isolation.ts`: **ikke** brukt i nye tester. Oppgaven har ingen nye spørringer (se 4).
- `e2e/helpers.ts`: `logIn`, `createTrialForm`, `waitForTrialHook`, `useCandidate`, `pendingChanges`, `countRequests`, `recordPulls`, `PULL_PATH`. Utvides (avsnitt 5.1), eksisterende hjelpere endres ikke, unntatt `indicator()` (1.1).
- Dagens e2e for de tre kandidatene og testskjemaet: skal fortsatt være grønne med bare endringene i 1.1.

### 1.1 Tillatte endringer i eksisterende tester (alt annet er «uendret»)

| Fil | Endring | Hvorfor |
|---|---|---|
| `e2e/helpers.ts` | `indicator()` peker på tilstandslinjen i den nye synkstatusen (`data-testid="sync-status-state"`); kommentaren oppdateres | pkt. 1: indikatoren erstattes |
| `e2e/fase-1-powersync.spec.ts`, `-electricsql.spec.ts`, `-egenbygd.spec.ts` | konstantene `ANY_STATUS`, `NO_PHOTOS_WAITING`, `ALL_SAVED`: «Alt er lagret på serveren» → «Alt er lagret»; `ANY_STATUS` og `NO_PHOTOS_WAITING` får også «Venter på kontakt med serveren» | ny tekst og ny tilstand (pkt. 2, «Regler») |
| De samme filene | steder som venter på `ALL_SAVED` med PowerSync eller ElectricSQL (finnes de, er de allerede feil i dag) | regelen om `serverConfirmed` |
| `sync/candidate-boundaries.test.ts` | fillisten: `sync-indicator.tsx` → `sync-status.tsx`, og nye rene filer (2.6) | pkt. 1 og 9 |
| `sync/select-store.test.ts` | bare nye tester (2.5), ingen endring i dagens | pkt. 7 |
| `sync/custom/pull-schedule.test.ts` | bare nye rader (2.4), ingen endring i dagens | K4 |

Endres en forventning utover dette, er det et funn.

## 2. Enhetstester (Vitest, rene funksjoner, ingen database, ingen DOM)

Alle tidspunkt er faste (`new Date("2026-10-29T13:32:00Z")` = 14:32 i Oslo), og tidssonen sendes inn som `"Europe/Oslo"` (A4). Ingen test bruker `Date.now()` eller maskinens tidssone.

### 2.1 `src/modules/offline-trial/sync-status-text.test.ts` (tekstene, «Regler»)

Ren fil `sync-status-text.ts` med `syncStatusText(status)`, `savedAtText(savedAt, now, timeZone)`, `nextSavedAt(status, previous, now)`, `SYNC_NOW_OFFLINE_MESSAGE`, `SYNC_NOW_FAILED_MESSAGE`. Testene skrives som tabeller (`it.each`), så reglene er data.

| Testnavn | Viser |
|---|---|
| «uten nett gir Uten nett uansett hva som venter» | `online: false` med (0,0), (3,2), og med `serverConfirmed: true` → «Uten nett». |
| «bekreftet og ingenting venter gir Alt er lagret» | `online`, `serverConfirmed`, (0,0) → «Alt er lagret». |
| «ingenting venter men ikke bekreftet gir Venter på kontakt med serveren» | `online`, `serverConfirmed: false`, (0,0) → «Venter på kontakt med serveren». Dekker ny enhet og Wi-Fi uten internett. |
| «noe venter gir Venter med antall, også når bekreftet» | (3,2) → «Venter: 3 endringer, 2 bilder», likt med og uten `serverConfirmed`. |
| «entall og flertall» | (1,0) → «Venter: 1 endring, 0 bilder»; (2,1) → «Venter: 2 endringer, 1 bilde»; (0,1) → «Venter: 0 endringer, 1 bilde». |
| «Alt er lagret vises aldri uten bekreftelse» | Tabell over alle 16 kombinasjoner av `online` × `serverConfirmed` × (0 / >0 endringer) × (0 / >0 bilder): «Alt er lagret» bare i den ene raden. **Obligatorisk.** |
| «samme dag gir Lagret kl. HH:MM» | lagret 14:32, nå 16:00 samme dag → «Lagret kl. 14:32». |
| «annen dag gir dato også» | lagret 28.10. 14:32, nå 29.10. 09:00 → «Lagret 28.10. kl. 14:32». |
| «aldri lagret gir Ikke lagret på serveren ennå» | `savedAt` `null` → «Ikke lagret på serveren ennå». |
| «grensen rundt midnatt følger Oslo, ikke UTC» | lagret 28.10. 23:59 Oslo (22:59Z), nå 29.10. 00:01 Oslo → «Lagret 28.10. kl. 23:59»; lagret 29.10. 00:01 Oslo (28.10. 23:01Z), nå 29.10. 08:00 → «Lagret kl. 00:01». |
| «24 timer med to sifre» | lagret 09:05 → «kl. 09:05»; 21:07 → «kl. 21:07». |
| «ugyldig tidspunkt gir Ikke lagret på serveren ennå» | `savedAt` som ikke kan leses (tom tekst, «tull») → samme som aldri. Ødelagt `localStorage` gir aldri feil klokkeslett. |
| «nextSavedAt gir nytt tidspunkt bare når bekreftet og ingenting venter» | `online`, `serverConfirmed`, (0,0) → `now` (ISO). **Obligatorisk.** |
| «nextSavedAt beholder forrige når noe venter, uten nett eller uten bekreftelse» | tabell: (1,0), (0,1), `online: false`, `serverConfirmed: false` → `previous`, både med `previous` satt og `null`. |
| «beskjeden uten nett, ordrett» | `SYNC_NOW_OFFLINE_MESSAGE` === «Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.» |
| «beskjeden ved feil, ordrett» | `SYNC_NOW_FAILED_MESSAGE` === «Fikk ikke sendt. Prøver igjen automatisk.» |
| «ingen gjetteord i tekstene» | ingen av tekstene inneholder «antas», «trolig», «sannsynligvis». |

### 2.2 `src/modules/offline-trial/sync/sync-now.test.ts` (felles runde for alle kandidater, pkt. 3–5, 8, A2–A3)

Ren fil `sync/sync-now.ts` (krav K1): `runSyncNow({ isOnline, round, timeoutMs })` → `Promise<TrialSyncRoundResult>`, og `singleFlight(fn)`. Testes med falske funksjoner og `vi.useFakeTimers()`.

| Testnavn | Viser |
|---|---|
| «uten nett gir offline straks og kaller ikke runden» | `isOnline: () => false` → `"offline"`, `round` kalt 0 ganger, ingen tidtaker startet. **Obligatorisk.** |
| «vellykket runde gir ok» | `round` løses → `"ok"`. |
| «feil i runden gir failed og kaster ikke» | `round` avvises med `Error` → `"failed"`; `await expect(...).resolves`. **Obligatorisk.** |
| «runden kaster synkront gir failed og kaster ikke» | `round` kaster før løftet → `"failed"`. |
| «tidsavbrudd etter 15 s gir failed» | `round` løses aldri; etter 14 999 ms ikke ferdig, etter 15 000 ms `"failed"`. |
| «tidsavbrudd er 15 000 ms» | konstanten `SYNC_NOW_TIMEOUT_MS` === 15000. |
| «to kall rett etter hverandre gir én runde» | `singleFlight(round)` kalt to ganger før første er ferdig → `round` kalt én gang, begge får samme resultat. **Obligatorisk.** |
| «nytt kall etter ferdig runde gir ny runde» | kall, vent, kall → `round` kalt to ganger. |
| «nytt kall etter feil gir ny runde» | første avvises, andre kall → ny runde (låsen slippes også ved feil og tidsavbrudd). |

### 2.3 `src/modules/offline-trial/sync-status.test.ts` (logikken bak knappen, pkt. 3–6)

Hvis knappelogikken legges i en ren funksjon eller tilstandsmaskin (f.eks. `syncButtonState`), testes den her. Ingen DOM (vi har ikke jsdom, og ingen ny avhengighet).

| Testnavn | Viser |
|---|---|
| «knappen viser Synker … under runden og kan ikke trykkes» | tilstand `running` → etikett «Synker …», `disabled: true`. |
| «ok gir Synk nå og ingen beskjed» | `running` + `"ok"` → «Synk nå», ingen beskjed. |
| «offline gir Synk nå og beskjeden uten nett» | → `SYNC_NOW_OFFLINE_MESSAGE`. |
| «failed gir Synk nå og feilbeskjeden» | → `SYNC_NOW_FAILED_MESSAGE`. |
| «ny vellykket runde fjerner gammel feilbeskjed» | `failed` så `ok` → ingen beskjed. |

Velger utvikler å holde dette i komponenten, flyttes testene til e2e (5.3) og står som «ikke aktuelt» i rapporten. Det godkjennes bare hvis 5.3 dekker alle fire utfallene.

### 2.4 Kandidatenes `syncNow` (pkt. 3, 8; akseptkriteriene «per kandidat»)

IndexedDB og PowerSync-SDK-en kan ikke kjøres i Vitest (ingen `fake-indexeddb`). Derfor deles det slik: det felles (nett, tidsavbrudd, kaster aldri, én runde) testes i 2.2; det kandidatspesifikke testes der det er rent, og ellers i e2e (5.3).

| Fil | Testnavn | Viser |
|---|---|---|
| `sync/custom/pull-schedule.test.ts` | «sync-now gir henting med en gang, også rett etter forrige henting» | ny hendelse `"sync-now"` (krav K4) 1 s etter forrige → `delayMs` 0. |
| samme | «sync-now under feilventetid gir henting med en gang og nullstiller ikke feiltelleren» | 3× `failure` (20 s), `sync-now` → 0; ny `failure` → 40000. |
| samme | «sync-now uten nett planlegger ingen henting» | `offline`, så `sync-now` → `null`. |
| samme | «wake er uendret: aldri tettere enn 5 s» | dagens test står; ny rad bekrefter at bare `sync-now` har unntaket. |
| `sync/local/outbox.test.ts` (eller ny `sync/local/outbox-sync-now.test.ts`) | «sync-now sender køen med en gang og hopper over ventetiden etter feil» | køen etter to feil (neste forsøk om 10 s): `syncNow`-hendelsen gir forsøk nå; feiltelleren nullstilles ikke før 200. |
| `sync/electricsql/…` | «Electric: syncNow sender køen og ber om henting med en gang» | bare hvis delen er ren; ellers e2e 5.3. |
| `sync/powersync/connector.test.ts` (ny) | «PowerSync: syncNow kaller opplastingen direkte, uten tjenesten» | falsk `db` med én transaksjon og falsk `fetch` 200 → én POST til `/api/prove/synk/endringer`, transaksjonen fullført; 500 → ikke fullført, resultat `"failed"`. |
| `sync/select-store.test.ts` | se 2.5 | |

### 2.5 `sync/select-store.test.ts` og `localStorage`-nøklene (pkt. 7, A6)

| Testnavn | Viser |
|---|---|
| «nøklene for Lagret kl. er trial_saved_at_ og kandidaten» | `savedAtKey("powersync")` === `"trial_saved_at_powersync"`, likt for `electricsql` og `custom`; én nøkkel per verdi i `TRIAL_SYNC_CANDIDATES`. |
| «bytte av organisasjon tømmer Lagret kl. for alle tre kandidatene» | falsk `localStorage` med alle tre nøklene og `trial_last_organization_id` = A; `clearIfOtherOrganization(B)` (eller den eksporterte delen som tømmer nøklene) → alle tre fjernet, uansett valgt kandidat. **Obligatorisk.** |
| «samme organisasjon tømmer ikke Lagret kl.» | A → A: nøklene står. |

Kan `clearIfOtherOrganization` ikke kalles i Vitest (dynamiske importer av IndexedDB-moduler), skilles nøkkeltømmingen ut i en ren funksjon (`clearSavedAt(storage)`) som kalles derfra, og en lesetest i 2.6 viser at den kalles. Dekkes da også av e2e 5.3 «bytte av organisasjon».

### 2.6 `sync/candidate-boundaries.test.ts` (grenser)

| Testnavn | Viser |
|---|---|
| (dagens tester) | fillisten oppdatert (1.1). |
| «synkstatusen kjenner ingen kandidat» | `sync-status.tsx`, `sync-status-text.ts` og `sync/sync-now.ts` importerer ikke fra `sync/powersync`, `sync/electricsql`, `sync/custom` eller `@powersync/*`/`@electric-sql/*`. Statusen leses bare via `TrialSyncStore`. |
| «sync-indicator.tsx er fjernet» | filen finnes ikke, og ingen fil i `src/` importerer den. |
| «Lagret kl. regnes ut ett sted» | bare `sync-status-text.ts` inneholder `nextSavedAt`; ingen kandidatfil skriver `trial_saved_at_` (bare `sync-status.tsx` og `select-store.ts`). |

## 3. Regeltester

Ingen fagregler, ingen TG-logikk, ingen faste koder (`key`). Tekstreglene i kortet («Regler») er skrevet som tabeller med testsaker i 2.1 og 2.2, så de er data.

## 4. Integrasjon, tilgang og tenant-isolasjon

Ingen nye spørringer, ruter eller tilgangsregler. Derfor ingen nye kall til `expectTenantIsolation`. Det godkjennes bare når alt under er oppfylt (test-leder sjekker ved godkjenning):

| Sjekk | Hvordan | Viser |
|---|---|---|
| Ingen endring i server, database eller tilgang | `git diff --stat main...HEAD -- src/app/api src/db src/core/access drizzle` er tom | ingen ny spørring som trenger tenant-test; admin kan ikke stenges ute |
| Ingen migrering, ingen ny avhengighet | `git diff main...HEAD -- package.json` viser bare versjonen; ingen ny fil under migreringsmappen | pkt. 10, regel 9 |
| Eksisterende tenant-tester består uendret | `trial-queries.test.ts`, `changes-since.test.ts`, `electric-shape.test.ts` (alle har `expectTenantIsolation`), `apply-changes.test.ts` (alle fire roller via `ALL_ROLES`) | «Synk nå» bruker de samme rutene og sjekkene; annen organisasjon får verken rader eller tilgang |
| Myk sletting | ikke relevant: ingenting slettes på serveren. «Lagret kl.» i `localStorage` er ikke data om befaringen. | |

Tilgang per rolle i e2e: 5.4 (takstmann og admin). Kontor og leder bruker samme sider og ruter; at rutene godtar alle fire rollene, er dekket av `apply-changes.test.ts` (`ALL_ROLES`).

## 5. E2e (Playwright, `pc` og `ipad`)

Ny fil **`e2e/fase-1-synkstatus.spec.ts`**. Tester merket «hver kandidat» skrives med `for (const candidate of ["powersync", "electricsql", "custom"] as const)` og `useCandidate`, og navnet slutter på « (${candidate})». Tester merket «iPad» kjøres bare i prosjektet `ipad`; resten i begge.

Klokke: alle tester som leser et klokkeslett, kjører med `test.use({ timezoneId: "Europe/Oslo" })` og `page.clock.setFixedTime(...)` (**ikke** `page.clock.install`, som stopper tidtakerne synken trenger). Nytt klokkeslett settes med et nytt `setFixedTime` før trykket.

### 5.1 Nye hjelpere i `e2e/helpers.ts`

- `syncStatus(page)`: hele linjen (`data-testid="sync-status"`); `savedAt(page)`: «Lagret kl.»-teksten (`sync-status-saved-at`); `syncNowButton(page)`: `getByRole("button", { name: /^(Synk nå|Synker …)$/ })`; `syncMessage(page)`: `aria-live`-feltet (`sync-status-message`).
- `setSavedAt(context, candidate, iso)`: `addInitScript` som legger `trial_saved_at_<candidate>` i `localStorage`.
- `CHANGES_PATH = "/api/prove/synk/endringer"` og `failChangesOnce(page, n = 1)`: `page.route` som svarer 500 på de `n` første POST-ene, så slipper resten gjennom.
- `logInAsInspector(page)`: sørger for en oppdiktet takstmann (`takstmann.e2e@eksempel.no`, rolle `inspector`) i Byggcon-organisasjonen i databasen fra `DATABASE_URL` (idempotent, ingen sletting), og logger inn med kode fra `/dev/epost`. Ingen ekte navn eller adresser.

### 5.2 Visning (pkt. 1–2)

| Testnavn | Kandidat | Viser |
|---|---|---|
| «synkstatusen vises på listen Testskjema med tilstand, Lagret kl. og Synk nå (${candidate})» | hver | alle tre delene synlige på `/prove/testskjema`; ny enhet → «Ikke lagret på serveren ennå». |
| «synkstatusen står i synsfeltet etter rulling til bunnen av testskjemaet (${candidate})» | hver | rull til siste felt; `syncStatus` og `syncNowButton` er `toBeInViewport()`. |
| «antallene stemmer med store.status() (${candidate})» | hver | fyll ut 3 felt og legg til 1 bilde uten nett; teksten «Venter: N endringer, M bilder» lik `store.status()` fra testkroken. **Akseptkriterium.** |
| «Uten nett vises med tekst, ikke bare farge» | custom | `context.setOffline(true)` → tilstanden har teksten «Uten nett»; `syncStatus` har ulik tekst fra «Alt er lagret». |
| «gammel måleindikator finnes ikke lenger» | custom | `getByTestId("sync-indicator")` har 0 treff på listen og skjemaet. |
| «Synk nå er minst 56 høy på iPad» | custom, iPad | `boundingBox().height >= 56` og bredde ≥ 56, på listen og på skjemaet. **Akseptkriterium.** |

### 5.3 «Synk nå» og «Lagret kl.» (pkt. 3–7)

| Testnavn | Kandidat | Viser |
|---|---|---|
| «Synk nå sender køen med en gang etter feil, uten å vente på neste forsøk (${candidate})» | hver | `failChangesOnce(page, 2)` (neste automatiske forsøk om ≥ 10 s); fyll ut et felt; vent til to 500 er registrert; trykk «Synk nå» → ny POST til `/endringer` innen 3 s (`countRequests`), og `pendingChanges` går til 0. **Akseptkriterium per kandidat.** Kortet sier én 500; to gir sikker margin mellom 3 s og ventetiden, så testen ikke blir ustabil. |
| «Synk nå som feiler gir Synk nå igjen, feilbeskjed og uendret Lagret kl. (${candidate})» | hver | `setSavedAt(…, 14:32)`; `page.route` svarer 500 på alle POST til `/endringer`; ett felt fylt ut; trykk → knappen viser «Synker …» og er `disabled`, så «Synk nå» igjen; `syncMessage` har «Fikk ikke sendt. Prøver igjen automatisk.»; `savedAt` er fortsatt «Lagret kl. 14:32». **Akseptkriterium per kandidat.** |
| «Synk nå uten nett gir beskjeden og sender ingenting (${candidate})» | hver | `countRequests(page, "**/api/prove/**")`; `setOffline(true)`; tilstand «Uten nett»; trykk → `syncMessage` har «Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.»; ingen nye forespørsler til `/api/prove/` i 5 s; ingen `pageerror`. Feltet har `aria-live`. **Akseptkriterium.** |
| «to raske trykk gir én runde (${candidate})» | hver | treg rute for `/endringer` (svar etter 1 s); `dblclick` eller to `click` uten venting → én POST til `/endringer` fra trykkene. |
| «uten bekreftet henting står det aldri Alt er lagret (${candidate})» | powersync, electricsql | etter «Synk nå» og tom kø: tilstand «Venter på kontakt med serveren» eller «Venter: …», aldri «Alt er lagret»; `savedAt` uendret. Viser regelen om `serverConfirmed` i ekte bruk. **Akseptkriterium «Wi-Fi uten internett».** |
| «Wi-Fi uten internett gir aldri Alt er lagret» | custom | `page.route("**/api/prove/**", r => r.abort())` mens `navigator.onLine` er sant; tom kø; vent 10 s → aldri «Alt er lagret», `savedAt` «Ikke lagret på serveren ennå». |
| «Lagret kl. vises etter at alt er sendt» | custom | `setFixedTime(14:32)`; fyll ut et felt; vent på «Alt er lagret» → `savedAt` «Lagret kl. 14:32». |
| «Lagret kl. står der etter ny lasting uten nett (${candidate})» | hver | custom: etter testen over; powersync/electricsql: `setSavedAt(14:32)`. Last siden på nytt uten nett → «Lagret kl. 14:32» og «Uten nett». Vei: `setOffline(true)` før `reload` hvis appen lastes fra tjenestearbeideren; ellers `page.route("**/api/**", abort)` og `setOffline(true)` rett etter lasting. Veien skrives som `testInfo.annotations` (som i PowerSync-testene). **Akseptkriterium.** |
| «Lagret på en annen dag viser dato» | custom | `setSavedAt(28.10. 14:32)`, `setFixedTime(29.10. 09:00)`, uten nett → «Lagret 28.10. kl. 14:32». |
| «trykk når alt er lagret gir nytt klokkeslett» | custom | «Alt er lagret» med «Lagret kl. 14:32»; `setFixedTime(14:47)`; trykk → minst én forespørsel til `PULL_PATH`, så «Lagret kl. 14:47». **Akseptkriterium.** |
| «bytte av organisasjon tømmer Lagret kl. for alle tre kandidatene» | custom valgt | `setSavedAt` for alle tre; `simulateOrganizationChange`; last på nytt → «Ikke lagret på serveren ennå», og `localStorage` har ingen av de tre nøklene (`page.evaluate`). **Akseptkriterium.** |

### 5.4 Roller

| Testnavn | Viser |
|---|---|
| «takstmann ser synkstatusen og bruker Synk nå (custom)» | `logInAsInspector`; samme flyt som «Lagret kl. vises etter at alt er sendt» → POST til `/endringer` svarer 200 og «Alt er lagret». **Akseptkriterium.** |
| «admin ser synkstatusen og bruker Synk nå (custom)» | samme med `logIn` (admin). Admin stenges ikke ute. |

## 6. Hva som ikke testes (bevisst)

- Safari og ekte iPad: Ståle i prøve A og B.
- PowerSync- og Electric-tjenesten: finnes ikke i e2e i skyen (avsnitt 0). Den Azure-oppgaven røres ikke.
- Kontor og leder i e2e: ingen ny tilgangsregel, rutene er dekket for alle roller i Vitest (4).
- Skjermlesing ut over at feltet har `aria-live` og riktig tekst.

## 7. Krav til koden som testene bygger på (utvikler)

- **K1** Felles ren fil `src/modules/offline-trial/sync/sync-now.ts` med `runSyncNow`, `singleFlight` og `SYNC_NOW_TIMEOUT_MS = 15_000`. Alle tre kandidatenes `syncNow` bruker den, så nett-sjekk, tidsavbrudd og «kaster aldri» er likt.
- **K2** Ren fil `src/modules/offline-trial/sync-status-text.ts` med `syncStatusText`, `savedAtText`, `nextSavedAt` og de to beskjedene. Komponenten `sync-status.tsx` erstatter `sync-indicator.tsx` (filen slettes).
- **K3** PowerSync: `syncNow` kaller opplastingen (`connector.uploadData`) selv, i tillegg til å be SDK-en hente. Uten det sender PowerSync ingenting i e2e (ingen tjeneste), og akseptkriteriet «sender køen med en gang» kan ikke vises. Lar det seg ikke gjøre, skal det stå i PR-en, og prosjektlederen avgjør før testene skrives om.
- **K4** Egenbygd: `pull-schedule.ts` får hendelsen `"sync-now"` med `delayMs` 0 (bare `"wake"` har 5 s-grensen). Endringskøen får tilsvarende «send nå».
- **K5** `serverConfirmed` settes per kandidat ut fra egne svar fra serveren, aldri fra `navigator.onLine`: PowerSync bare etter vellykket opplasting **og** vellykket henting fra tjenesten; ElectricSQL bare etter 200 fra shape-ruten; egenbygd etter 200 fra `/hent` med ferdig hentet.
- **K6** `data-testid`: `sync-status`, `sync-status-state`, `sync-status-saved-at`, `sync-status-message` (med `aria-live="polite"`). Knappen har tilgjengelig navn «Synk nå» / «Synker …».
- **K7** Tømming av `trial_saved_at_*` i en ren funksjon som `clearIfOtherOrganization` kaller (2.5).

## 8. Kobling til akseptkriteriene

| Akseptkriterium | Tester |
|---|---|
| Vises på skjema og liste for alle tre, også rullet ned | 5.2 de to første |
| Antall stemmer med `store.status()` | 5.2 «antallene stemmer» |
| «Lagret kl.» etter sending, og etter ny lasting uten nett | 5.3 «vises etter at alt er sendt», «står der etter ny lasting uten nett» |
| «Synk nå» med nett sender med en gang etter feil, per kandidat | 5.3 første; 2.2; 2.4 |
| «Synk nå» uten nett: beskjed, ingen fetch, kaster ikke | 5.3 «uten nett»; 2.2 «uten nett gir offline» |
| Feil med nett: knapp tilbake, beskjed, «Lagret kl.» uendret, per kandidat | 5.3 «som feiler»; 2.2; 2.3 |
| «Lagret kl.» bare ved bekreftelse; Wi-Fi uten internett og ny enhet aldri «Alt er lagret» | 2.1 «aldri uten bekreftelse», `nextSavedAt`; 5.3 «uten bekreftet henting», «Wi-Fi uten internett» |
| Trykk når alt er lagret gir nytt klokkeslett | 5.3 «trykk når alt er lagret» |
| To raske trykk gir én runde | 2.2 `singleFlight`; 5.3 «to raske trykk» |
| Knappen minst 56 på iPad | 5.2 «minst 56 høy» |
| Organisasjonsbytte tømmer for alle tre | 2.5; 5.3 «bytte av organisasjon» |
| Virker for takstmann | 5.4 |
| Annen organisasjon får ikke tilgang | 4 (diff tom, eksisterende tenant-tester grønne) |
| iPad og PC | hele avsnitt 5 kjøres i `pc` og `ipad` |
| Lint, typesjekk, Vitest og e2e grønne | test-leders sluttsjekk |

## 9. Godkjenning (test-leder, etter bygging)

Avvises hvis: en test merket **Obligatorisk** eller **Akseptkriterium** mangler; diffen i avsnitt 4 ikke er tom; en eksisterende test er endret utover 1.1; en e2e-test bruker `page.clock.install` eller maskinens tidssone; eller `pnpm lint`, `pnpm typecheck`, `pnpm test` eller `pnpm test:e2e` ikke er grønne.
