# Testplan: Rett funn T-0001 – én avvist endring stopper synkkøen

- **Oppgavekort:** `docs/agenter/oppgaver/rett-t0001-synkko.md`
- **Funn:** `docs/agenter/testlag/funn/T-0001-synkko-stopper-ved-avvist-endring.md` (feil, alvorlig)
- **Fase:** 2a (retting fra testlaget)
- **Branch:** `rett-t0001-synkko` (bygger på `main`)
- **Laget av:** test-leder, 11.11.2026 (før koding)
- **Støtter hovedmål:** De ansatte: takstmannen mister ikke arbeid fra iPaden fordi ett felt har et usynlig tegn, og ser hvilket felt som ikke ble sendt. KI i bunnen: tekst med nulltegn gir forslag og rad i `ai_usage_log` i stedet for feil. Færre reklamasjoner: svarene kommer fram, så rapporten får ikke hull.

## Fast oppsett

- Integrasjonstester: `resetDatabase` i `beforeEach`, to organisasjoner (A og B) med fabrikkene i `tests/factories.ts`, admin og takstmann i A, admin i B.
- Den «giftige» teksten bygges i testen som `"Fukt\u0000 i kjeller"` og `"a\uD800b"` (ensomt surrogat). All tekst er oppdiktet.
- Ingen test skal kreve ekte KI-leverandør. Bare den falske leverandøren.
- Ingen ny spørring og ingen ny tabell, så `tests/tenant-tables.ts` og `tests/tenant-isolation-all-tables.test.ts` skal være uendret og grønne.

## 1. Enhetstester

### 1a. Vasken: `src/shared/lib/clean-text.test.ts` (ny)

| # | Testnavn | Hva den viser |
|---|---|---|
| 1 | «fjerner nulltegn i tekst» | `"a\u0000b"` blir `"ab"`. |
| 2 | «fjerner ensomme surrogater (høy og lav)» | `"a\uD800b"` og `"a\uDC00b"` blir `"ab"`; også sist og først i teksten. |
| 3 | «beholder emoji, linjeskift, tabulator, æøå og m²» | `"Bad 🛁\n\tæøå ÆØÅ 12 m²"` er helt uendret (`toBe`). |
| 4 | «går gjennom objekter og lister i flere nivåer» | `{ a: ["x\u0000", { b: "y\u0000" }] }` blir vasket på alle nivå. |
| 5 | «vasker nøkler i objekter» | `{ "k\u0000": 1 }` blir `{ k: 1 }`. |
| 6 | «rører ikke tall, true/false og null» | `0`, `-1.5`, `true`, `false`, `null` kommer ut identiske (også inne i objekter og lister). |
| 7 | «endrer ikke inndata» | Inndata fryses med `Object.freeze` (dypt) og sammenlignes med kopi etterpå. |
| 8 | «to vask gir samme resultat» | `strip(strip(x))` er lik `strip(x)` for alle eksemplene over. |
| 9 | «tekst med bare nulltegn blir tom tekst» | `"\u0000\u0000"` blir `""`. |
| 10 | «tekst uten slike tegn returneres lik» | Vanlig tekst gir samme streng (ingen unødig endring). |

### 1b. Oversetting av databasefeil: `src/app/api/prove/error-response.test.ts` (ny) eller testen ved siden av funksjonen som oversetter

| # | Testnavn | Hva den viser |
|---|---|---|
| 11 | «SQLSTATE i klasse 22 gir 400» | Feil med `code: "22003"`, `"22P02"` og `"22021"` (også pakket i `cause`, slik Drizzle gjør) gir 400. |
| 12 | «23514 (sjekkregel) gir 400» | `code: "23514"` gir 400. |
| 13 | «andre databasefeil gir 500» | `23505`, `08006` (brutt forbindelse), `40001` og feil uten SQLSTATE gir 500 som før. |
| 14 | «svaret på 400 har feil og endring, aldri teksten» | Kroppen er `{ feil, endring: { id, table, field_key } }`; den giftige teksten finnes ikke i `JSON.stringify(kropp)`. |
| 15 | «uendret for tilgang, konflikt og bildefeil» | `AccessDeniedError` 403, `TrialIdConflictError` 409, `TrialPhotoTooLargeError` 413, `TrialPhotoNotFoundError` 404, som i dag. |

### 1c. Køen: `src/modules/offline-trial/sync/local/outbox.test.ts` (utvides)

Køfunksjonene er rene. Testene går gjennom funksjonene som `trial-store.ts` bruker (navnet på ny funksjon for «legg til side» avgjøres av utvikleren; testene skal bruke den samme som `trial-store.ts` kaller).

| # | Testnavn | Hva den viser |
|---|---|---|
| 16 | «giftig endring først: legges til side, resten sendes og kvitteres» | Kø med 3 endringer, 400 med `endring` som peker på den første. Etter ny `takeBatch` + 200: de to andre er borte fra køen, den giftige ligger der med `setAside.at`. |
| 17 | «giftig endring i midten» | Samme som 16, peker på nummer 2. |
| 18 | «giftig endring sist» | Samme som 16, peker på nummer 3. |
| 19 | «alle køoppføringer med samme table+id i bunten legges til side» | To oppføringer for samme rad (laget mens den første var underveis) blir begge lagt til side; andre rader sendes. |
| 20 | «400 uten endring og bunt med én endring: legges til side» | Kø med én endring, 400 uten `endring`: oppføringen har `setAside`. |
| 21 | «400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side» | `keepBatch`-oppførsel; ingen oppføring har `setAside`. |
| 22 | «400 med endring som ikke finnes i bunten: nytt forsøk» | Peker serveren på en id som ikke er i bunten, legges ingenting til side (vern mot å kaste feil endring). |
| 23 | «401, 403, 409, 413, 500, 503 og nettfeil gir nytt forsøk» | Tabelltest (`it.each`) over statusene og `undefined`. Ingen oppføring får `setAside`, alle ligger i køen. |
| 24 | «lagt til side slettes aldri» | Etter 400 og flere runder med 200 for andre endringer ligger den giftige fortsatt i `entries`. |
| 25 | «lagt til side sendes ikke» | `takeBatch` tar den ikke med; tom kø ellers gir `null`. |
| 26 | «lagt til side overlever omlasting» | `createOutboxState(lagredeOppføringer)` beholder `setAside` og rekkefølgen. |
| 27 | «ventetallet teller ikke lagt til side» | Funksjonen som gir «Venter: N endringer» gir 2 når 3 ligger og 1 er lagt til side. |
| 28 | «ny endring i samme felt blir ny oppføring» | `enqueue` på samme `table`+`id` fletter ikke inn i den som er lagt til side; ny `seq`, gammel `data` uendret. |
| 29 | «pendingKeys har feltet så lenge det er lagt til side og ikke løst» | `localRowKey` for svaret er i `pendingKeys`. |
| 30 | «200 på senere endring i samme felt løser den gamle» | Etter 200 på ny oppføring med samme `localRowKey`: gammel har `setAside.resolved = true`, er ute av `pendingKeys`, men finnes fortsatt i `entries`. |
| 31 | «200 på et annet felt løser ikke» | `setAside.resolved` er ikke satt; feltet er fortsatt i `pendingKeys`. |
| 32 | «shouldAckBatch er uendret: bare 200 slipper bunten» | Eksisterende test står; 201 og 204 gir fortsatt ikke kvittering. |

### 1d. Synk nå og henting

| # | Fil | Testnavn | Hva den viser |
|---|---|---|---|
| 33 | `src/modules/offline-trial/sync/sync-now.test.ts` | «køen regnes som tømt når bare lagt-til-side-oppføringer står igjen» | `syncNow` løses (kaster ikke «Køen ble ikke sendt.»). |
| 34 | `src/modules/offline-trial/sync/local/apply-incoming.test.ts` | «serverens vaskede svar overskriver ikke felt som er lagt til side» | Med feltet i `pendingKeys` blir lokal tekst stående. |
| 35 | `src/modules/offline-trial/sync/local/apply-incoming.test.ts` | «hentet vasket svar lager ingen ny køoppføring» | Svar fra serveren uten nulltegn speiles lokalt uten `enqueue` (ingen evig løkke). |

### 1e. Statuslinjen: `src/modules/offline-trial/sync-status-text.test.ts` (utvides)

| # | Testnavn | Hva den viser |
|---|---|---|
| 36 | «Kunne ikke sendes: <feltnavn> med navn fra skjemaet» | Svar for `general_description` (eller tilsvarende kode) gir «Kunne ikke sendes: Generell beskrivelse». Navnet hentes fra skjemadefinisjonen, ikke fra koden. |
| 37 | «bilde gir ’bilde i <feltnavn>’» | `trial_photos` gir «Kunne ikke sendes: bilde i <feltnavn>». |
| 38 | «testskjemaet» | `trial_forms` gir «Kunne ikke sendes: testskjemaet». |
| 39 | «flere felt skilles med komma» | To felt gir «Kunne ikke sendes: A, B». Samme felt to ganger nevnes én gang. |
| 40 | «ingen melding når alt er løst» | Bare `resolved` gir ingen melding (`null`). |

## 2. Integrasjonstester (mot testdatabasen)

### 2a. Synken: `src/modules/offline-trial/server/apply-changes.test.ts` (utvides)

| # | Testnavn | Hva den viser |
|---|---|---|
| 41 | «nulltegn i Generell beskrivelse først i bunten gir tre lagrede svar uten nulltegn» | Bunt: tekstfelt med nulltegn (via `text_state`), byggeår 1985, samlet kommentar. Ingen unntak; tre rader i `trial_answers`; ingen `value` inneholder `\u0000`. |
| 42 | «ensomt surrogat i tekst og i jsonb-verdi fjernes» | Svar med tabell-/valgverdi (jsonb) som har `\uD800` lagres uten feil og uten tegnet. |
| 43 | «text_state lagres urørt og kan flettes etterpå» | Lagret `text_state` er lik den som ble sendt (byte for byte); `mergeTextStates(lagret, nyTilstand)` gir forventet tekst, og ny bunt med den nye tilstanden gir flettet `value` uten nulltegn. |
| 44 | «id, trial_form_id, field_key og text_state vaskes ikke» | `field_key` med nulltegn gir `InvalidTrialChangeError` (ukjent felt), ikke stille vask og lagring. Det samme for `id` med nulltegn. |
| 45 | «verdi databasen ikke tar gir feil som peker på endringen» | Nytt bilde med `size_bytes = 3_000_000_000` (SQLSTATE 22003): feilen bærer `id`, `table` og `field_key` for den operasjonen. |
| 46 | «én transaksjon: etter feil er ingen av de gode endringene lagret» | Bunt med to gode svar og bildet fra 45: 0 nye rader i `trial_answers` og `trial_photos`. |
| 47 | «sendt på nytt uten den giftige blir alle lagret» | Samme bunt uten bildet: de to svarene lagres. |
| 48 | «fremmed organisasjon gir AccessDeniedError også med giftig innhold» | Admin i B mot A med nulltegn i bunten: `AccessDeniedError`, ingen rader i noen organisasjon. Sjekkes før vask og før validering. |
| 49 | «admin kan synke tekst med nulltegn» | Admin i A får 200-resultat og vasket rad (regel 11). |
| 50 | «alle fire roller kan skrive vasket tekst» | Utvider eksisterende rolletest med én giftig verdi per rolle. |
| 51 | «logger aldri innholdet, heller ikke ved 400» | `logger`-spy: verken giftig tekst eller resten av bunten finnes i noe kall (utvider eksisterende «logger aldri innholdet»). |
| 52 | «myk sletting: ingenting slettes» | Etter 400 og ny bunt: ingen rader har fått `deleted_at`, og antallet rader er bare økt. |

### 2b. Ruten: `src/app/api/prove/synk/endringer/route.test.ts` (ny)

| # | Testnavn | Hva den viser |
|---|---|---|
| 53 | «nulltegn gir 200» | `POST` med bunten fra 41 gir 200. |
| 54 | «for stor size_bytes gir 400 med endring» | Svaret er 400 med `{ feil, endring: { id, table, field_key } }`, ikke 500. |
| 55 | «svaret og loggen har ikke teksten fra bunten» | Kroppen og `logger`-spy inneholder ingen tekst fra bunten. |
| 56 | «ikke innlogget 401, fremmed organisasjon 403 med giftig innhold» | 401 og 403 som før. |
| 57 | «annen databasefeil gir 500» | Tvunget feil (for eksempel trigger som kaster `unique_violation`, ryddes i `finally`) gir 500. |

### 2c. KI-modulen: `src/core/ai/request-suggestion.test.ts` (utvides; eksisterende tester røres ikke)

| # | Testnavn | Hva den viser |
|---|---|---|
| 58 | «tekst med nulltegn gir forslag og én rad i ai_usage_log» | Falsk leverandør, status `suggested`, én rad, ingen `\u0000` i raden. |
| 59 | «leverandøren får vasket tekst» | Ledeteksten fra `buildPrompt` (fanget i den falske leverandøren) har ikke nulltegnet. |
| 60 | «svar med nulltegn fra leverandøren lagres vasket» | Falsk leverandør gir `"Bedre\u0000 tekst"`; `output_text` i loggen og svaret er uten tegnet. |
| 61 | «input_summary regnes av vasket tekst» | Antall tegn i `input_summary` er lengden etter vask. |
| 62 | «tekst som er tom etter vask gir samme avslag som tom tekst» | `"\u0000\u0000"` gir samme avslag (samme kode) som `""`, ikke unntak, ikke 500; ingen leverandørkall. |
| 63 | «feltkodene vaskes ikke» | Feltkode med nulltegn gir samme avslag som ukjent felt i tillatt-listen i dag (trinn 3), ikke stille vask. |
| 64 | «rekkefølgen holder: tilgang sjekkes før vask» | Bruker i B mot A med nulltegn: `AccessDeniedError`, ingen rad i `ai_usage_log` i noen organisasjon. |
| 65 | «admin får forslag med giftig tekst» | Regel 11. |

Krav: `no-leak.test.ts`, `static-checks*.test.ts`, `access*.test.ts`, `record-decision*.test.ts` og testene for godtatt/endret/avvist er **uendret** (`git diff --stat src/core/ai/*.test.ts` viser bare `request-suggestion.test.ts`).

### 2d. KI-prøvesiden: `src/app/(ansatt)/prove/ki/actions.test.ts` (utvides)

| # | Testnavn | Hva den viser |
|---|---|---|
| 66 | «handlingen gir forslag for tekst med nulltegn» | Ikke «Noe gikk galt». |
| 67 | «fremmed organisasjon gir nei også med giftig tekst» | Tilgang før alt annet. |

## 3. Tilgang per rolle

Tilgangen er uendret, men skal vises med giftig innhold:

| Rolle | Synk (`applyTrialChanges`) | KI (`requestSuggestion`) | Test |
|---|---|---|---|
| takstmann | skriver, vasket | forslag, vasket | 50, 58 |
| kontor | skriver, vasket | som i dag | 50 |
| leder | skriver, vasket | som i dag | 50 |
| admin | skriver, vasket, ser meldingen | forslag | 49, 65, e2e (b) |
| annen organisasjon | 403 | nektet | 48, 56, 64, 67 |
| deaktivert ansatt | nektet | nektet | eksisterende test står |

Admin stenges aldri ute: ingen test skal vise at admin nektes i egen organisasjon.

## 4. Tenant-isolasjon

Ingen ny spørring, ingen ny tabell, så ingen ny `expectTenantIsolation`. Dekkes av 48, 56, 64 og 67 (fremmed organisasjon får 403 og ingen rader skrives i noen av organisasjonene). Test-leder sjekker i gjennomgangen at `git diff` ikke har nye `db.select`/`db.insert`/`db.update` mot nye tabeller, og at all skriving fortsatt bruker `grant.organizationId`. Finnes en ny spørring, avvises PR-en uten `expectTenantIsolation`.

## 5. Regeltester (regler som data)

Ingen. Oppgaven har ingen regler eller TG-logikk. `src/modules/offline-trial/rules/*.test.ts` skal være grønne uendret.

## 6. E2E: `e2e/fase-2a-rett-t0001-synkko.spec.ts` (ny), PC og iPad-størrelse

Kjøres i begge prosjektene i `playwright.config.ts` (PC og iPad Pro). Bruker `logIn`, `createTrialForm`, `indicator`, `pendingChanges`, `waitForTrialHook` og `readRowsViaHook` fra `e2e/helpers.ts`. Nulltegnet settes inn med `page.evaluate` (utklippstavle-lim eller `insertText`) siden tastaturet ikke gir det.

| # | Testnavn | Hva den viser |
|---|---|---|
| E1 | «(a) tekst med nulltegn i Generell beskrivelse: alle tre svarene kommer fram» | Nulltegn i Generell beskrivelse, Byggeår 1985, Samlet kommentar, «Synk nå». Statuslinjen blir «Alt er lagret», `pendingChanges` er 0, ingen «Kunne ikke sendes». Siden lastes på nytt: tre verdier vises. Ingen 500 i nettverket (`page.on("response")`). |
| E2 | «(b) 400 for én endring: meldingen viser feltet og de andre blir kvittert» | `page.route` på `/api/prove/synk/endringer` svarer 400 med `endring` som peker på Generell beskrivelse første gang. Statuslinjen viser «Kunne ikke sendes: Generell beskrivelse»; de to andre er lagret (ny innlasting eller les fra serveren); ventetallet teller ikke den giftige. |
| E3 | «(b2) meldingen står etter omlasting og forsvinner etter 200 på ny endring» | Etter E2: last siden på nytt, meldingen står fortsatt. Fjern `page.route`, skriv om feltet, synk: meldingen er borte og feltet lagret. |
| E4 | «(c) uten nett: skriv, kom på nett, samme resultat som (a)» | `context.setOffline(true)`, fyll ut som i E1, `setOffline(false)`: alle tre lagret, ingen melding. |
| E5 | «(d) 500 legger ingenting til side» | `page.route` gir 500: «Fikk ikke sendt. Prøver igjen automatisk.», ingen «Kunne ikke sendes». Fjern ruten: alt kommer fram. Viser at bare 400 legger til side. |
| E6 | «(e) /prove/ki med nulltegn gir forslag» | Lim inn tekst med nulltegn på `/prove/ki`, be om forslag: forslagskortet vises, ikke «Noe gikk galt». |

Krav: ingen fast `waitForTimeout`; vent på tekst i statuslinjen eller `pendingChanges`. Testen rydder `page.route` selv.

## 7. Myk sletting

- Server: 52 (ingen rader får `deleted_at`, ingen slettes).
- Lokalt: 24 og 30 (lagt til side slettes aldri, heller ikke når den er løst).
- Gjennomgang: ingen `objectStore.delete` for oppføringer med `setAside` i `trial-store.ts`.

## 8. Ting test-leder sjekker i gjennomgangen

- Vasken finnes bare i `src/shared/lib/clean-text.ts` og importeres i `apply-changes.ts` og `request-suggestion.ts` (ingen kopi).
- Kodekommentaren «Bare tegn databasen ikke tar. Ikke personvernvask, erstatter ikke «Vask før KI».» står.
- `console.warn` i `trial-store.ts` logger fortsatt bare status og antall, ikke data eller feltnavn ut over koden.
- Ordlisten i `docs/05-domenemodell.md` har `set aside` og `unstorable characters`.
- A169 og A170 i `docs/09-apne-sporsmal.md`.
- Funnfilen T-0001: status «rettet», `pr:` utfylt, logglinje. Ligger fortsatt i `funn/` (flyttes til `funn/lukket/` når testlaget har bekreftet).
- Versjon i `package.json` er økt (patch). Ingen nye avhengigheter.

## 9. Godkjenningskriterier

- `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` grønne (testsuiten kjøres i bakgrunnen, den tar over 10 minutter).
- Alle akseptkriteriene i oppgavekortet har minst én test over (kart: vask 1–10; synk 41–43; ingen evig løkke 35; 400 45, 54–55; 500 består 13, 57; én transaksjon 46–47; kø 16–31; statuslinje 36–40, E2–E3; KI 58–63; KI uendret 2c-krav; tilgang 48, 56, 64, 67; e2e E1–E4; ingenting slettes 24, 30, 52).
- Avvises hvis: 403-testene med giftig innhold mangler (48, 56, 64), eksisterende KI-tester er endret, eller en lagt-til-side-oppføring kan slettes.
