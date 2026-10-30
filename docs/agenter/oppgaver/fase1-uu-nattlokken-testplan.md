# Testplan: UU-funn 6–9 fra nattløkken 30.10.2026

- **Oppgavekort:** `docs/agenter/oppgaver/fase1-uu-nattlokken.md`
- **Fase:** 1 – Prøve uten nett
- **Branch:** `fase1-uu-nattlokken` (bygger på `main`)
- **Laget av:** test-leder, 30.10.2026 (før koding)
- **Støtter hovedmål:** Tid: synlige kolonnenavn og 44 px trykkflate gir færre feiltrykk på iPaden. Reklamasjoner: et felt med fokus dekkes aldri av statuslinjen, og verdier havner ikke i feil kolonne. KI først: indirekte (takstmannen må se hvert felt for å kontrollere KI-forslag senere).

## Hva som skal vises

1. Kolonnenavnet står synlig over tabellcellene (minst første rad), med god kontrast, også når cellen er fylt ut. Cellen har fortsatt navnet «Kolonne, rad N».
2. Et felt som får fokus med tastaturet, havner helt under den faste statuslinjen (WCAG 2.4.11), på `pc` og `ipad`.
3. «Til forsiden» på «Fant ikke siden» er minst 44 × 44 px.
4. Meldingen «Vent til alt er lagret på serveren før du bytter» står i en `role="status"`-region som finnes i DOM før teksten kommer, og som ikke tar plass når den er tom.

## Hvorfor bare e2e

Prosjektet har ingen DOM-miljø i Vitest (ingen jsdom eller Testing Library), og kortet tillater ingen ny avhengighet. Alt over er synlig oppførsel i nettleseren, så det testes med Playwright i begge prosjektene (`pc` og `ipad`, 1194 × 834 med berøring). Ingen nye enhetstester, integrasjonstester eller regeltester: ingen ny logikk, spørring eller regel.

## 1. E2e: `e2e/fase-1-testskjema.spec.ts` (kjører i `pc` og `ipad`)

Oppsett som i filen: `openTrialForm(page)` (admin, nytt testskjema). Tabellfeltet finnes med `fieldContainer(page, <key for tabellfeltet>)`. Oppdiktede verdier.

| # | Testnavn | Hva den viser |
|---|---|---|
| E1a | «tabellfeltet viser kolonnenavnet synlig over cellene i første rad, også etter utfylling» | Trykk «Legg til rad». For hver kolonne i tabellfeltet (fra `trialForm`, ikke hardkodet): teksten med kolonnenavnet (`exact: true`) er synlig i første rad. Fyll «Sted, rad 1» og «Verdi, rad 1»: kolonnenavnene er fortsatt synlige. Biter hvis navnet bare er plassholder (forsvinner ved verdi). |
| E1b | «kolonnenavnet over tabellcellene har kontrast minst 4,5:1» | Les `getComputedStyle(...).color` på etiketten for første kolonne, og første ikke-gjennomsiktige `backgroundColor` oppover i treet. Regn kontrast etter WCAG (relativ luminans) i en liten funksjon i testfilen. Forvent ≥ 4,5. Biter med `text-slate-400` (ca. 3:1). |
| E1c | «hver tabellcelle har fortsatt et tilgjengelig navn med kolonne og rad» | Legg til to rader. `getByLabel("<kolonne>, rad 1", { exact: true })` og `"<kolonne>, rad 2"` finner nøyaktig ett felt hver, for alle kolonnene. Den eksisterende testen «alle 40 felt fylles ut …» (`Sted, rad 1` osv.) skal stå uendret og grønn. Biter hvis `<label>` overstyrer navnet til bare «Sted». |
| E1d | «felt med fokus dekkes ikke av statuslinjen» | Rull helt ned (`window.scrollTo(0, document.body.scrollHeight)`). Gi fokus til et felt som nå ligger **over** synsfeltet (første tekst- eller tallfelt i andre gruppe), med `Shift+Tab` fra feltet under det, eller `locator.focus()`. Statuslinjen finnes som elementet med `sticky` øverst (bruk eksisterende `data-storage-level`-beholder eller legg til `data-testid="sticky-status-bar"` hvis utvikler vil; ingen ny produktfunksjon). Forvent `feltBox.y >= statusBox.y + statusBox.height` (avrund med 1 px slakk). Kjøres i begge prosjekter. **Viktig:** feltet må komme ovenfra. Et felt under synsfeltet rulles til nederkanten og kan aldri treffe statuslinjen, så testen ville vært grønn uten rettingen. |
| E1e | «felt med fokus dekkes ikke av statuslinjen når varselet om lagring vises» | Bare hvis det er enkelt med eksisterende oppsett (lav lagring eller feil i statuslinjen gjør linjen høyere): samme sjekk som E1d. Ellers dropp, og noter at 7rem er valgt med margin. Ikke bygg nytt oppsett for dette. |
| E1f | «Synkløsning har en tom statusregion når ingenting venter» | Gå til `/prove/testskjema` som admin uten ventende endringer, til synkstatusen er klar. I gruppen «Synkløsning»: `getByRole("status")` har antall 1 og tom tekst, og høyden fra `boundingBox` er 0 (eller regionen tar ingen marg). Avgrens alltid til gruppen, fordi synkstatusen øverst også kan ha `role="status"`. Biter hvis regionen bare legges inn når noe venter. |

**Kontroll av at testene biter (test-leder gjør det lokalt, ikke i PR-en):**
- Fjern `scroll-padding-top` i `globals.css`: E1d skal bli rød i minst ett prosjekt.
- Bytt etiketten til `placeholder` igjen: E1a rød.
- Gjør regionen betinget (`{waiting ? <p role="status">…</p> : null}`): E1f rød.

## 2. E2e: «Fant ikke siden» i `e2e/fase-0a.spec.ts` (kjører i `pc` og `ipad`)

| # | Testnavn | Hva den viser |
|---|---|---|
| E2a | «Til forsiden på Fant ikke siden er minst 44 × 44 px» | Logg inn som admin (eller gå uinnlogget hvis siden vises uten innlogging; sjekk hva mellomvaren gjør). Gå til en adresse som ikke finnes (`/finnes-ikke-e2e`). Overskriften «Fant ikke siden» vises. `getByRole("link", { name: "Til forsiden" }).boundingBox()`: `width >= 44` og `height >= 44`. Trykk lenken: havner på forsiden eller arbeidskøen (admin stenges ikke ute). |

## 3. E2e: meldingen leses opp, i synktestene (bare `pc`, som før, testplan 6.2)

Utvid de to eksisterende testene, ingen nye oppsett:

| # | Testnavn (eksisterende) | Tillegg |
|---|---|---|
| E3a | `fase-1-electricsql.spec.ts`: «velgeren er sperret med forklaring når noe venter på å bli sendt» | Før endringen sendes: `group(page, "Synkløsning").getByRole("status")` har antall 1 (finnes før teksten). Mens noe venter: samme region `toHaveText(WAIT_TEXT)`. Etter at køen er tom: regionen har fortsatt antall 1 og er tom (`toHaveText("")`), i stedet for at bare teksten har antall 0. |
| E3b | `fase-1-egenbygd.spec.ts`: tilsvarende test (rundt linje 1072) | Samme tre sjekker som E3a. |

## 4. Obligatorisk (alltid med)

| # | Hva | Hvordan |
|---|---|---|
| O1 | **Tilgang per rolle** | Ingen endring i tilgang. Eksisterende «uinnlogget sendes til innlogging fra /prove/testskjema» og «uinnlogget sendes til innlogging» skal stå grønne. Ingen ny side eller handling. |
| O2 | **Tenant-isolasjon** | Ingen ny spørring, så ingen ny `expectTenantIsolation`. Kontroll: `git diff main -- src/db src/core src/modules/**/*.ts` (utenom `.tsx`) skal ikke vise nye spørringer. Finnes én, avvises PR-en til test med isolasjon er lagt til. |
| O3 | **Admin stenges aldri ute** | Alle testene over kjører som admin (`ADMIN_EMAIL`), og E2a viser at admin kommer tilbake fra «Fant ikke siden». |
| O4 | **Myk sletting** | Ikke berørt (ingen data endres). Eksisterende test «Slett rad 2» skal stå grønn. |
| O5 | **Ingen ny avhengighet** | `git diff main -- package.json pnpm-lock.yaml` viser bare økt versjon (patch, 0.2.27 → 0.2.28 eller neste ledige etter fletting). |
| O6 | **Ikke rørt** | `git diff main --stat` viser ingen endring i synk-ADR-en, sammenligningen av kandidatene eller annet utenfor kortets omfang. |
| O7 | **Brand** | Ingen «EzProp» i `src/` (lint). |

## 5. Akseptkriterier mot tester

| Akseptkriterium | Tester |
|---|---|
| Kolonnenavn synlig, minst første rad, kontrast ≥ 4,5:1, også fylt ut | E1a, E1b |
| Tilgjengelig navn med kolonne og rad | E1c (og eksisterende utfyllingstest) |
| Felt med fokus dekkes ikke av statuslinjen (`pc` og `ipad`) | E1d (E1e hvis enkelt) |
| «Til forsiden» ≥ 44 × 44 px | E2a |
| `role="status"`-region finnes før teksten | E1f, E3a, E3b |
| Ingen ny avhengighet, alle sjekker grønne | O5, sluttkjøring |
| Annen organisasjon får ikke tilgang | O2 |
| Virker på iPad-størrelse | E1a–E1f og E2a i `ipad` |

## 6. Sluttkjøring

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (begge prosjekter). Uten nett: ingen ny oppførsel uten nett; eksisterende tester i `fase-1-powersync.spec.ts` m.fl. skal stå grønne. Godkjennes ikke hvis E1d er grønn uten rettingen (se kontrollen i avsnitt 1).
