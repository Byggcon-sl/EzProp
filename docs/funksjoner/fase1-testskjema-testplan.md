# Testplan: Testoppsett for prøven uten nett (testskjema og app på hjemskjermen)

- **Oppgavekort:** `docs/funksjoner/fase1-testskjema.md`
- **Fase:** 1 – Prøve uten nett, første punkt
- **Branch:** `fase1-testskjema` (bygger på `main`)
- **Dato:** 28.10.2026
- **Laget av:** test-leder, før koding. Navnene er bindende for testskriver. Utvikler leser avsnittet «Krav til koden som testene bygger på».
- **Støtter hovedmål:** Tid og KI først. Testskjemaet er grunnlaget for befaring på iPad, der tiden skal halveres mot IVIT, og det er der KI-forslag senere skal vises og godkjennes av takstmannen. Testene sikrer at prøvene A–F kjøres på samme skjema for alle kandidatene, så valget i ADR-en blir etterprøvbart.

## 1. Hva som finnes fra før (og brukes)

- `tests/factories.ts`: `resetDatabase`, `createUser`, `createOrganization`, `createEmployee`. Brukes ikke i denne oppgaven (ingen nye spørringer), men nevnes så testskriver ikke lager egne.
- `tests/tenant-isolation.ts`: `expectTenantIsolation`. Brukes ikke, se avsnitt 4.
- `e2e/helpers.ts`: `logIn(page, ADMIN_EMAIL)` logger inn admin via `/dev/epost`. Alle innloggede e2e-tester bruker den.
- `playwright.config.ts`: prosjektene `pc` (Desktop Chrome) og `ipad` (1194 × 834, `hasTouch`). `workers: 1`, så testene deler innlogging trygt.
- `vitest.config.ts`: tar bare `src/**/*.test.ts` og `tests/**/*.test.ts`. **Ikke** `.test.tsx`. Derfor ingen komponenttest av `trial-form-view.tsx`; skjermen dekkes av e2e.
- `e2e/fase-0a.spec.ts`: mønster for «uinnlogget sendes til innlogging» og `request`-tester.

## 2. Enhetstester (Vitest, rene, ingen database)

### `src/modules/offline-trial/trial-form.test.ts`

| Testnavn | Viser |
|---|---|
| «har nøyaktig 40 felt med unike nøkler» | `trialForm` flatet ut gir 40 felt, og `new Set(keys).size === 40`. Vokter akseptkriterium 1. |
| «har fordelingen tekst 7, TG 7, valg 9, tall 9, tabell 1, bilde 7» | Teller per `type`. Fanger at utvikler bytter type på et felt. |
| «alle seks felttypene finnes» | `text`, `tg`, `choice`, `number`, `table`, `photo` er alle i bruk. |
| «har seks grupper med norsk overskrift» | Gruppene «Om boligen», «Utvendig», «Bad», «Kjøkken», «Teknisk», «Oppsummering», i den rekkefølgen. |
| «alle valgfelt har minst to valg med kode og norsk etikett» | Hvert `choice`-felt har `options.length >= 2`, koder i snake_case, etiketter ikke tomme. |
| «tabellen drill_measurements har kolonnene location, value, note» | Kolonnene i riktig rekkefølge, `value` har type `number`. |
| «nøklene er engelske snake_case» | Regex `^[a-z][a-z0-9_]*$` på alle felt-, valg- og kolonnenøkler. Vokter regel 6 (faste koder). |
| «nøklene stemmer med oppgavekortet» | Fast liste med de 40 nøklene fra tabellen i kortet, sammenlignet med `trialForm`. Kandidatene i oppgave 4 skal sammenlignes på samme nøkler, så de må ikke skli. |

### `src/modules/offline-trial/answers.test.ts`

| Testnavn | Viser |
|---|---|
| «countAnswered gir 0 for tomme svar» | `countAnswered(trialForm, {})` → 0. |
| «tom tekst og tekst med bare mellomrom teller ikke» | `""` og `"   "` → 0, `"a"` → 1. |
| «TG og valg teller når de er satt» | `roof_tg: "TG2"` → 1, `building_type: "detached"` → 1. |
| «tallet 0 teller som utfylt, null teller ikke» | `floors: 0` → 1, `floors: null` → 0. |
| «tom tabell teller ikke, én rad teller» | `drill_measurements: []` → 0, én rad → 1. |
| «tomt bildefelt teller ikke, ett bilde teller» | `cover_photo: []` → 0, `[{ id, name, sizeBytes }]` → 1. |
| «svar for nøkler som ikke finnes i skjemaet teller ikke» | `{ unknown_key: "x" }` → 0. Hindrer at telleren kan nå 40 på feil grunnlag. |
| «alle 40 utfylt gir 40» | Bygger svar for alle felt ut fra `trialForm` (løkke over typene) → 40. |
| «parseTrialNumber godtar komma og punktum, avviser tekst» | `"12,5"` → 12.5, `"12.5"` → 12.5, `"0"` → 0, `"abc"` → null, `""` → null, `" 7 "` → 7. |

### `src/shared/lib/uuid.test.ts` (uendret)

Skal være grønn uten endring etter byttet til `globalThis.crypto.randomUUID()`. Test-leder sjekker i `git diff` at filen ikke er rørt.

### `src/app/manifest.test.ts` (valgfri, billig)

| Testnavn | Viser |
|---|---|
| «manifestet har standalone, start_url /arbeidskoe, navn fra brand og lang nb» | Kaller standardeksporten fra `manifest.ts` og sjekker `display`, `start_url`, `name === brand.productName`, `lang === "nb"`, `theme_color === brand.color`. |

## 3. Integrasjonstester mot testdatabasen

Ingen nye. Oppgaven lager ingen tabeller, ingen migreringer og ingen spørringer. Test-leder bekrefter dette i rapporten med `git diff --stat main..fase1-testskjema -- src/db` (tom) og `grep -rn "organizationId\|from \"@/db" src/modules/offline-trial` (tom).

## 4. Tilgang, tenant-isolasjon, admin og myk sletting

| Krav | Dekning | Begrunnelse |
|---|---|---|
| Tilgang per rolle | E2e «uinnlogget sendes til innlogging fra /prove/testskjema». Alle fire roller skal inn (tabellen i kortet); bare admin finnes i seed, så e2e tester admin. | Siden bruker bare `requireActor`. Ingen rettighet sjekkes, ingen rolle stenges ute. |
| Tenant-isolasjon | **Ikke relevant.** Ingen spørring tar `organizationId`, ingen data lagres. Ingen `expectTenantIsolation` legges til. | Må stå med rene ord i PR-en. Test-leder godkjenner ikke uten. Hvis utvikler likevel legger til en spørring med `organizationId`, kreves `expectTenantIsolation` i samme PR. |
| Admin stenges aldri ute | E2e «admin finner lenken … og ser 0 av 40 felt utfylt». | Admin åpner siden fra arbeidskøen. |
| Myk sletting | **Ikke relevant.** «Slett rad N» sletter bare i minnet på siden, ingenting i databasen. | Nevnes i PR-en. |

## 5. Regeltester

Ingen. Regler kommer i prøve E (oppgave 4/5) og får da testsaker som data. Test-leder sjekker at modulen ikke inneholder TG-logikk (ingen avledning fra tall til TG).

## 6. E2e (Playwright): `e2e/fase-1-testskjema.spec.ts`

Kjører i både `pc` og `ipad`. Ingen test uten nett (bevisst, oppgave 4 og 5).

| Testnavn | Viser | Prosjekt |
|---|---|---|
| «uinnlogget sendes til innlogging fra /prove/testskjema» | `page.goto("/prove/testskjema")` → URL `/\/logg-inn$/`. Tilgang. | pc, ipad |
| «admin finner lenken Prøve uten nett: testskjema på arbeidskøen og ser 0 av 40 felt utfylt» | `logIn`, `getByRole("link", { name: "Prøve uten nett: testskjema" }).click()`, URL `/prove/testskjema`, tekst «0 av 40 felt utfylt». Admin stenges aldri ute. | pc, ipad |
| «alle seks gruppene og alle 40 etiketter vises» | Løkke over `trialForm` importert fra `../src/modules/offline-trial/trial-form`. Grupper: `getByRole("heading", { name })`. Tekst/tall/bilde: `getByLabel(label)` synlig. TG/valg: `getByRole("group", { name: label })` synlig. Tabell: `getByRole("button", { name: "Legg til rad" })`. | pc, ipad |
| «ingen nedtrekksmenyer» | `page.locator("select")` har 0 treff. Designprinsipp 6. | pc, ipad |
| «TG-knapp er minst 44 px høy» | `boundingBox()` på knappen `TG0` i gruppen «Tak – tilstandsgrad»: `height >= 44` og `width >= 44`. `test.skip(project !== "ipad")`. | ipad |
| «tallfelt har inputMode decimal» | Alle ni tallfelt: `getByLabel(label)` har attributt `inputmode="decimal"` og er `input[type=text]`. | pc, ipad |
| «valg er ett trykk og bare ett valg er trykket» | I gruppen «Lekkasjestopper»: trykk «Ja» → `Ja` har `aria-pressed="true"`, `Nei` har `"false"`. Trykk «Nei» → byttet. Teller går 0 → 1 → 1 (ikke 2). | pc, ipad |
| «TG er ett trykk og bare én TG er trykket» | Samme for gruppen «Tak – tilstandsgrad»: `TG2` så `TG3`. Nøyaktig én knapp i gruppen har `aria-pressed="true"`. | pc, ipad |
| «alle 40 felt fylles ut og telleren viser 40 av 40» | Løkke over `trialForm`: tekst `fill("Oppdiktet tekst")`; TG trykk `TG1`; valg trykk første valg; tall `fill("12,5")`; tabell «Legg til rad» to ganger, fyll «Sted, rad 1», «Verdi, rad 1», «Kommentar, rad 1» og «Sted, rad 2», «Slett rad 2» (én rad igjen); bilde `setInputFiles("e2e/fixtures/test-image.png")` i alle sju felt, og feltet viser «1 bilde» med filnavnet. Til slutt tekst «40 av 40 felt utfylt». Mellomsjekk: etter tabellen (to lagt til, én slettet) teller feltet fortsatt. | pc, ipad |
| «tall med bokstaver teller ikke» | `fill("abc")` i «Byggeår» → teller uendret; `fill("1985")` → +1. Viser at `parseTrialNumber` er koblet på skjermen. | pc, ipad |
| «manifest.webmanifest svarer 200 med standalone, start_url /arbeidskoe og navn fra brand» | `request.get("/manifest.webmanifest")`, status 200, JSON: `display === "standalone"`, `start_url === "/arbeidskoe"`, `name === brand.productName`, `lang === "nb"`, `icons[0].src` inneholder `/apple-icon`. `brand` importeres fra `../src/shared/config/brand`. | pc, ipad |
| «/apple-icon svarer 200 med image/png» | `request.get("/apple-icon")`, status 200, `content-type` begynner med `image/png`. | pc, ipad |
| «innloggingssiden har link rel=manifest og apple-mobile-web-app-capable» | Uinnlogget `goto("/logg-inn")`: `locator('link[rel="manifest"]')` har 1 treff, `locator('meta[name="apple-mobile-web-app-capable"][content="yes"]')` har 1 treff. | pc, ipad |

### Slik finner e2e feltene (bindende for utvikler og testskriver)

- Tekst, tall og bilde: `getByLabel(etikett)` (krever `<label htmlFor>`).
- TG og valg: `getByRole("group", { name: etikett })` (krever `<fieldset><legend>`), deretter `getByRole("button", { name })` inne i gruppen. Valgt knapp: `aria-pressed="true"`.
- Tabellceller: `getByLabel("Sted, rad 1")`, `getByLabel("Verdi, rad 1")`, `getByLabel("Kommentar, rad 1")`. Knapper: «Legg til rad», «Slett rad 1», «Slett rad 2».
- Bilde: `getByLabel("Forsidebilde")` er `input[type=file]`; etter valg vises «1 bilde» i samme felt (bruk `getByText("1 bilde")` innenfor feltets nærmeste container, f.eks. `data-field="cover_photo"`).
- Teller: `getByText(/^\d+ av 40 felt utfylt$/)`.

### Fixture

`e2e/fixtures/test-image.png`: ensfarget PNG under 5 kB, oppdiktet, lages av testskriver. Chromium bryr seg ikke om `capture`, så flere filer kan gis på én gang, men testen gir én fil per felt (prøve A tar bilder ett og ett).

## 7. Krav til koden som testene bygger på (til utvikler)

1. `trial-form.ts` og `answers.ts` er ren TypeScript uten React, `server-only` eller `@/db`, så e2e kan importere dem relativt (`../src/modules/offline-trial/trial-form`) og Vitest trenger ingen DOM.
2. Hvert felt rendres i en container med `data-field="<key>"`, så e2e kan avgrense «1 bilde» og tabellceller.
3. Telleren har nøyaktig tekst «N av 40 felt utfylt», og den oppdateres synkront ved `onChange`.
4. Lenken på arbeidskøen har nøyaktig tekst «Prøve uten nett: testskjema» og er en `<a>` (ikke knapp).
5. Siden `/prove/testskjema` ligger under `src/app/(ansatt)/` og kaller `requireActor()` først.
6. `uuid.ts` bruker `globalThis.crypto.randomUUID()`, ingen `node:crypto`.

## 8. Dekning av akseptkriteriene

| Akseptkriterium (fra kortet) | Test |
|---|---|
| 40 felt, unike nøkler, fordeling, seks typer | `trial-form.test.ts` (fire første) |
| `countAnswered` og `parseTrialNumber` | `answers.test.ts` |
| `uuidv7` uten `node:crypto`, `uuid.test.ts` uendret | `uuid.test.ts` + `git diff` |
| Admin åpner fra lenken, ser grupper, etiketter, «0 av 40» | E2e «admin finner lenken …», «alle seks gruppene …» |
| Uinnlogget → `/logg-inn` | E2e «uinnlogget sendes til innlogging …» |
| Alle 40 felt kan fylles ut i `pc` og `ipad`, telleren 40 | E2e «alle 40 felt fylles ut …» |
| Ingen `select`, `inputMode="decimal"`, 44 px | E2e «ingen nedtrekksmenyer», «tallfelt har inputMode decimal», «TG-knapp er minst 44 px høy» |
| Manifest 200 med riktig innhold, `/apple-icon` PNG | E2e de to `request`-testene |
| `<link rel="manifest">` og `apple-mobile-web-app-capable` | E2e «innloggingssiden har …» |
| Lint, typecheck, test, e2e grønne, `ipad` kjørte alt | Test-leder kjører og leser Playwright-listen |
| Tenant-isolasjon ikke relevant, står i PR-en | Test-leder leser PR-teksten |
| Virker på iPad-størrelse | `ipad`-prosjektet |
| Planen A–F klar for Ståle | Ikke testbar; prosjektleder legger den i PR-en |

## 9. Slik godkjenner test-leder

Kjører i denne rekkefølgen og stopper ved første røde:

```bash
pnpm lint
pnpm typecheck
pnpm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e
```

Godkjennes bare når alt dette stemmer:

- Alle fire kommandoer grønne. Playwright-listen viser hver e2e-test under både `[pc]` og `[ipad]` (unntatt 44 px-testen, som er hoppet over i `pc`).
- Utfyllingstesten når «40 av 40» i begge prosjekter.
- `uuid.test.ts` er uendret i `git diff main..fase1-testskjema`.
- Ingen `.test.tsx` som Vitest ikke plukker opp (de ville gitt falsk trygghet).
- Ingen `organizationId`, `@/db` eller TG-logikk i `src/modules/offline-trial`.
- Ingen tekst fra NS 3600, IVIT eller SmartTakst i etiketter (etikettene er de i kortet).
- PR-teksten sier med rene ord at tenant-isolasjon og myk sletting ikke gjelder, og hvorfor.
- `package.json` er 0.1.2.

Avvises hvis innloggingstesten mangler, om `ipad` ikke har kjørt alle testene, eller om PR-en mangler begrunnelsen for tenant-isolasjon.

## 10. Funn som ville vært alvorlige

- Telleren når 40 uten at alle felt er fylt (f.eks. ukjente nøkler teller) → alvorlig, prøve A ville gitt falskt resultat.
- `TrialAnswers` inneholder noe som ikke kan lagres (filobjekt, objekt-URL) → alvorlig, oppgave 4 må rive det ut.
- Nøkler avviker fra kortet → alvorlig, kandidatene kan ikke sammenlignes.
- Nedtrekksmeny, TG bare med farge, eller knapper under 44 px → lite i prøven, men rettes før PR (designprinsipp 6, 8, 11).
