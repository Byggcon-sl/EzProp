# Testplan: Småfunn fra prøve E og rest fra PR #26 (liten oppgave e)

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-smafunn-prove-e.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-smafunn-prove-e` (bygger på `main`)
- **Laget av:** test-leder, 30.10.2026 (før koding)
- **Støtter hovedmål:** Reklamasjoner: rettingen som forkaster gamle øyeblikksbilder får en rask test, så en feil som kan vise gamle svar til takstmannen stopper `pnpm test`, og regel og melding kan ikke si forskjellige tall. Tid: færre doble tester gir kortere testkjøring. KI først: indirekte (reglene som data er grunnlaget for KI-forslag senere).

## Hva som skal vises

1. `localWriteGeneration` forkaster et øyeblikksbilde som ble lest før en nyere lokal skriving, og bruker et bilde uten nyere skriving.
2. Testsakene (`trial-rule-cases.ts`) er ikke med i appens pakke.
3. Grensetallene 7 og 42 står bare i regeldataene; meldingene er ordrett som før.
4. Ryddingen fjerner bare doble tester. Dekningen av 401, 403, annen organisasjon og tenant-isolasjon står igjen i `route.test.ts`.
5. `custom/reader.ts` og `electricsql/store.ts` logger bare feilmeldingen.

## 1. Enhetstester: `src/modules/offline-trial/sync/local/trial-store.test.ts` (utvides)

Bruker den falske `LocalDb` som finnes i filen (ingen `fake-indexeddb`, ingen ny avhengighet). Falske tidtakere, aldri ekte venting. Oppdiktede data.

| # | Testnavn | Hva den viser |
|---|---|---|
| W1 | «øyeblikksbilde lest før en nyere lokal skriving forkastes» | Lytter på skjemaet (`subscribe(FORM, listener)`). Lesingen av bildet holdes igjen (f.eks. `readonly`-transaksjonen venter på et løfte testen styrer). Mens den venter: en lokal skriving (`saveAnswer` eller tilsvarende) med ny verdi. Så slippes den gamle lesingen. Lytteren får **aldri** et bilde med den gamle verdien etter skrivingen; siste bilde lytteren får har den nye verdien. |
| W2 | «øyeblikksbilde uten nyere skriving brukes» | Samme oppsett uten skriving i mellomtiden: lytteren får bildet, med riktig verdi. Viser at vakten ikke sluker alle bilder. |
| W3 | «innkommende rader fra serveren teller som nyere skriving» | Som W1, men skrivingen er `mergeIncoming` (via leser-stubben) med minst én endring. Gammelt bilde forkastes. Valgfri hvis W1 og W2 er krevende å sette opp; da sjekkes det ved gjennomlesing at alle tre stedene (`write`, `mergeIncoming`, `resetTable`) øker telleren. |

**Kontroll av at testen biter (test-leder gjør det lokalt, ikke i PR-en):** fjern linjen `if (generation !== localWriteGeneration) return;` i `sendSnapshot`. W1 skal bli rød. W2 skal fortsatt være grønn. Testen skal ikke henge.

## 2. Logg-tester: bare feilmeldingen

Samme mønster som `expectOnlyText` i `trial-store.test.ts` (PR #26): ingen argument til `console.warn` er `instanceof Error` eller et objekt. Feilen kastes med en oppdiktet tekst som `"hemmelig-rad"`, og et objekt med radinnhold festet på feilen (`Object.assign(new Error("x"), { row: {...} })`) skal ikke havne i loggen.

| # | Fil | Testnavn | Hva den viser |
|---|---|---|---|
| L1 | `sync/custom/reader.test.ts` (utvides) | «loggen viser bare feilmeldingen når rader fra serveren ikke kan legges inn» | `context.mergeIncoming` kaster. Kallet med «Synk: kunne ikke legge inn rader fra serveren.» har bare tekst-argumenter; meldingen fra feilen er med. Hentingen gir fortsatt `failed` og markøren flyttes ikke (som før). |
| L2 | `sync/electricsql/` (ny test eller utvidet `shape-messages.test.ts`) | «Electric: loggen viser bare feilmeldingen når rader ikke kan legges inn» | Som L1 for formleseren i `store.ts` (ca. linje 197), med `fetch` stubbet til ett gyldig svar og `ctx.mergeIncoming` som kaster. Er formleseren ikke eksportert og det krever ny kode å teste den, godtas en kildetest i stedet: ingen `console.warn`/`console.error` i `electricsql/store.ts` og `custom/reader.ts` sender `error` som eget argument (regex på kildeteksten). Utvikleren eksporterer ikke noe nytt bare for testen uten å si det i PR-en. |
| L3 | samme som L2 | «ingen synkfil logger hele feilobjektet» | Valgfri kildetest over `src/modules/offline-trial/sync/**/*.ts` (ikke tester): ingen `console.(warn\|error\|log)(…, error)` der siste argument er feilvariabelen. Fanger at mønsteret kommer tilbake. |

**Kontroll:** sett `error` tilbake som argument i `reader.ts`. L1 skal bli rød.

## 3. Regeltester (testsaker som data)

| # | Fil | Testnavn / sjekk | Hva den viser |
|---|---|---|---|
| R1 | `rules/trial-rule-cases.test.ts` | alle eksisterende tester grønne | Alle 14 testsaker passerer fortsatt; importen er endret til `./trial-rule-cases` (og `./index` for motor og regler). |
| R2 | `rules/trial-rules.test.ts` | «meldingene er ordrett som i kortet» beholdes **uendret** | Teksten til takstmannen er lik som før (fast forventet tekst med 7 og 42 i testen, ikke bygget fra konstanten, ellers tester den ingenting). |
| R3 | `rules/trial-rules.test.ts` (ny eller erstatter «prøvetallene ligger i TRIAL_ONLY-konstanten») | «grensetallene står bare i regeldataene» | Leser `trial-rules.ts` som tekst, fjerner kommentarer: tallene `7` og `42` forekommer nøyaktig én gang hver (i `TRIAL_ONLY_LIMITS`). Ingen meldingsstreng inneholder et siffer som literal. |
| R4 | `rules/trial-rules.test.ts` | «meldingen følger grensen» | Med en kopi av regelen der `limit` er endret (eller ved å kalle meldingsbyggeren med et annet tall, hvis utvikleren lager en), viser meldingen det nye tallet. Hopper over hvis meldingene bygges ved import uten funksjon; da dekker R3. |
| R5 | `rules/trial-rules.test.ts` (ny) | «index eksporterer ikke testsakene» | `import * as rulesModule from "./index"`: `"trialRuleCases" in rulesModule` er `false`. |
| R6 | ny kildetest eller utvidet R5 | «ingen appfil importerer trial-rule-cases» | Går gjennom `src/**/*.{ts,tsx}` utenom `*.test.ts(x)`: ingen import av `trial-rule-cases`. `e2e/` er lov. |

**Kontroll:** legg `export * from "./trial-rule-cases"` tilbake i `index.ts`: R5 rød. Skriv `(7 år)` tilbake i en melding: R3 rød.

## 4. Rydding i overlappende tester

| # | Sjekk | Hva den viser |
|---|---|---|
| D1 | `e2e/fase-1-prove-e-regler.spec.ts` | Testene «ruten krever innlogging» og «ruten gir 403 for annen organisasjon» er fjernet. Importen av testsakene går til `rules/trial-rule-cases` direkte. Disse står igjen og er grønne på PC og iPad: «regelsvaret vises under begge feltene», «uten nett gir hver testsak riktig svar», «svaret endres uten ekstra trykk», «nettleser og server gir samme svar for alle testsakene», «regelsvaret etter omlasting uten nett». |
| D2 | `route.test.ts` står igjen med | «uten innlogging gir 401», «annen organisasjon gir 403», «organisasjon som ikke finnes gir 403», mykt slettet organisasjon og ansatt gir 403, «tilgang sjekkes før svar gis», `expectTenantIsolation`, «svaret mellomlagres ikke» (dekker `cache-control` som e2e-401 sjekket), «kroppen logges aldri». Ingen av disse fjernes. |
| D3 | 400-sakene i `route.test.ts` | Slått sammen, men disse typene står igjen: tekst i stedet for tall, ekstra felt i `answers`, ekstra felt i kroppen, manglende/ugyldig `organizationId`, `answers` feil type, kroppen ikke JSON. Rene varianter (f.eks. «tekst i stedet for tall (fukt)», «organizationId som tall», «answers er null» ved siden av «answers er tekst») kan fjernes. |
| D4 | Importsjekken i `evaluate-trial-rules.test.ts` | «motoren importerer bare fra egen mappe og answers» fjernes **bare** hvis utvikleren viser at lint (`eslint-rules/module-boundaries.js`) eller en annen test stopper en import utenfra i `rules/`. Ellers beholdes den. «motoren bruker ingen nettleser- eller server-API» og «skjemaet og ruten bruker samme motor» beholdes (lint dekker dem ikke). |
| D5 | Antall tester | Testrapporten oppgir antall Vitest- og e2e-tester før og etter. Nedgang skal kunne forklares med D1, D3 og D4. |

## 5. Tilgang per rolle

Ingen endring i `src/core/access` eller rollene. `route.test.ts` beholder testene for 401, 403 og annen organisasjon (D2), og eksisterende tester for takstmann og admin som får 200. Admin stenges ikke ute: testene der admin får svar fra ruten står igjen. Avvises hvis noen tilgangstest i `route.test.ts` forsvinner, eller hvis PR-en endrer `src/core/access`.

## 6. Tenant-isolasjon

Ingen ny spørring. `expectTenantIsolation` i `route.test.ts` står igjen og passerer. E2e-testen med en organisasjon som ikke finnes fjernes, fordi den ekte sjekken (to ekte organisasjoner) ligger i `route.test.ts`. Avvises hvis kallet til `expectTenantIsolation` fjernes eller endres slik at det ikke lenger bruker to ekte organisasjoner.

## 7. Myk sletting

Ingen endring i data. Testene for mykt slettet organisasjon og ansatt i `route.test.ts` står igjen (D2). Ruten skriver fortsatt ingenting («ruten skriver ingenting til databasen» står igjen).

## 8. E2e (PC og iPad-størrelse, også uten nett)

Ingen nye e2e-tester. De fem som står igjen i D1 kjøres i begge prosjektene (PC og iPad). Minst «uten nett gir hver testsak riktig svar» og «regelsvaret etter omlasting uten nett» viser regelsvaret under feltet uten nett, med tekst lik før (R2). Synk-e2e for de tre kandidatene skal være grønne uendret (endringen i loggen og testen for `localWriteGeneration` endrer ikke oppførsel).

## 9. Annet

- `package.json`: versjon 0.2.18.
- Ingen ny avhengighet, ingen migrering.
- Ingen kundeopplysninger i testdata; feiltekster og navn er oppdiktet.

## Kriterier for godkjenning

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` grønne.
- W1, L1, R3 og R5 blir røde når rettingen fjernes (kontrollen over).
- D2 og avsnitt 5–6 holder: ingen tilgangstest eller tenant-isolasjonstest er borte.
- Alle 14 testsaker passerer, og meldingsteksten er ordrett som før.
