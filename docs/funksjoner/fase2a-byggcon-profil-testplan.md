# Testplan: Byggcon-profilen i EzProp

- **Oppgavekort:** `docs/funksjoner/fase2a-byggcon-profil.md`
- **Dato:** 12.11.2026 (test-leder, før bygging; avvikene D1–D4 fra designspesifikasjonen `docs/funksjoner/fase2a-byggcon-profil-design.md` er tatt inn av prosjektlederen 12.11.2026)
- **Støtter hovedmål:** de ansatte (testene låser at trykkflatene og luften på iPad står, at skriften virker uten nett og at kontrasten holder i sollys), KI i bunnen (testene viser at KI-merket har eget uttrykk med teksten «KI» og at godta/behold/nytt forslag og `ai_usage_log` virker som før) og færre reklamasjoner (TG-tokenene har lesbar tekst og kan ikke forveksles med synkstatus eller KI).

Oppgaven endrer bare utseendet. Ingen nye tabeller, spørringer, tilgangsregler eller TG-regler. Testdata er oppdiktet (prøveorganisasjonen og e2e-brukerne i `e2e/helpers.ts`). Ingen ny avhengighet (ingen `@axe-core/playwright`).

## Avtale om navn (utvikler og testskriver)

- Ny vitest for forbudte ord: `tests/byggcon-profile.test.ts`.
- Kontrast: `src/app/(ansatt)/contrast.test.ts` (utvides). `readThemeColors(css?: string)` tar valgfri tekst, slik at feilen ved ikke-hex kan testes med en liten streng.
- Felleskomponenter: `src/shared/ui/button.test.ts`, `card.test.ts`, `badge.test.ts`, `notice.test.ts` (nye), `form.test.ts`, `ai-text-mark.test.ts`, `ai-suggestion.test.ts` (endres). Samme stil som `form.test.ts` (`renderToStaticMarkup`, klassene leses fra markupen).
- Merkevarefargen: `src/app/manifest.test.ts` (utvides).
- E2e: `e2e/fase-2a-byggcon-profil.spec.ts`. Kjører i begge prosjektene (`pc` og `ipad` = 1194 × 834). Stående iPad (1024 × 1366) i egen `test.describe` med `test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true })`.
- **Skriftnavn:** `next/font/local` gir familienavn som `__inter_abc123`. E2e sjekker derfor `fontFamily` mot `/inter/i` og `/schibsted/i`, og `document.fonts.check` bruker det første familienavnet fra `getComputedStyle`, ikke en fast streng. Variablene i `layout.tsx` må hete noe med `inter` og `schibsted`.
- **KI-kortets knapper** heter i koden «Bruk», «Behold min tekst» og «Nytt forslag» (ikke «Endre»/«Avvis» som i kortet). Testene bruker navnene i koden. «Bruk» er hovedknapp (`lg`, minst 56 px); de andre minst 44 px, som den låste testen i `ai-suggestion.test.ts`. Kortet sier «Ingen klasser for høyde endres», så kravet om 56 px på alle tre i akseptkriteriene leses som en skrivefeil (lite funn, rettes i kortet).

## 1. Forbudte ord og skriftfiler, `tests/byggcon-profile.test.ts` (ny, ren)

Går gjennom alle filer under `src/` og `public/` (tekst og filnavn). Testfilen selv ligger i `tests/` og telles ikke.

1. **ingen nordlys, overgang eller Roboto:** `/aurora|gradient|roboto/i` finnes verken i innhold eller filnavn. Feilmeldingen lister fil og linje.
2. **ingen Google-skrift:** `fonts.googleapis`, `fonts.gstatic` og `next/font/google` finnes ikke.
3. **skriftfilene finnes:** `public/fonts` har Inter 400, 500, 600, 700 og Schibsted Grotesk 500, 600, 700 (filnavn som i `docs/design/byggcon-profil/fonts/`), og ingen `Roboto-*`.
4. **lisensen:** `public/fonts/README.md` nevner «SIL OFL 1.1», Inter og Schibsted Grotesk, og nevner ikke Roboto eller PDF-bruk av Roboto. Lisensfilene (`OFL-*.txt`) ligger ved siden av.
5. **forhåndslasting (D2 i designspesifikasjonen, A242):** `src/app/layout.tsx` har nøyaktig ett `preload: true` (Inter-familien, alle fire vektene) og `preload: false` for Schibsted Grotesk (leses som tekst). `next/font/local` styrer forhåndslasting per familie, ikke per vekt. Ingen `display` annet enn `"swap"`, og `adjustFontFallback` er ikke satt til `false`.
6. **ingen fast hex i synkstatusen:** `src/modules/offline-trial/sync-status.tsx` har ingen `#[0-9a-f]{3,6}` (bruker `--color-sync-*`).

## 2. Kontrast, `src/app/(ansatt)/contrast.test.ts` (utvides, ren)

Temaet leses først; `slate-*` fjernes fra `fixed` og leses fra `@theme` (de omdefinerte tonene).

1. **`readThemeColors` feiler ved ikke-hex:** `--color-x: oklch(...)` eller `--color-x: #abc;` i en `@theme`-streng gir feil med navnet på variabelen. Hele `globals.css` leses uten feil.
2. **paletten finnes:** `snow`, `sand`, `night`, `fjord`, mørk fjord (navnet ui-designer velger), `stone`, `line` (12 %) og `line-strong` (25 %) som `#rrggbb` (linjene som ferdig blandet hex mot snow, ikke `rgba`).
3. **`canvas` er snow** og `brand-*`/`slate-*` finnes og er ikke de gamle verdiene (`#326ca1` og Tailwinds `#0f172a`, `#334155`, `#475569` er borte).
4. **tekst** (`it.each`): slate-600, slate-700, slate-900 og night mot snow, hvit og sand: minst 4,5:1.
5. **hovedknapp:** lys tekst mot night minst 4,5:1; deaktivert hovedknapp er hvit mot slate-500 (stone, D3, A243), minst 4,5:1.
6. **kanter** (`it.each`): kanten på sekundærknapp og skjemafelt mot snow, hvit og sand: minst 3:1.
7. **fokusramme (D1, A241):** fjord (`#316aa0`) mot snow, hvit, sand og night: minst 3:1. Mørk fjord brukes ikke til fokus (2,5:1 mot night).
8. **TG** (`it.each` over `tg0`, `tg1`, `tg2`, `tg3`, `tgiu`): alle fem finnes, hver med tekst- og flatetoken, tekst mot flate minst 4,5:1.
9. **synk** (`it.each` over alle `--color-sync-*` par): tekst mot flate minst 4,5:1.
10. **KI:** KI-merkets tekst mot flate og forslagskortets tekst mot flate minst 4,5:1; kanten på merket/kortet mot snow og hvit minst 3:1.
11. **KI, TG og synk er ulike:** ingen KI-token har samme hex som noen `tg-*`, `sync-*`, `ok-*`/`watch-*`/`urgent-*`/`unknown-*` (statustokens). Ingen `sync-*` flate er lik `tg0`, `tg2` eller `tg3` flate.
12. eksisterende par for adminområdet og «Forfalt» står, men leses fra temaet der fargen nå er omdefinert.

## 3. Felleskomponentene (ren, markup)

`button.test.ts` (ny):
1. hovedknappen har night-flate, lys tekst og `rounded-full`; `lg` har `min-h-14`, `md` `min-h-11` (uendret).
2. sekundærknappen er gjennomsiktig med kant og `rounded-full`.
3. ingen variant gir gul eller `amber`-flate; ingen `gradient` eller `shadow` i noen variant.
4. ghost-knappen har kant eller understreking og `min-h-11`.
5. deaktivert hovedknapp bruker ikke `opacity-` på night (egne farger i stedet).
6. fokus: knappene arver fokusrammen i fjord fra `:focus-visible` i `globals.css` (D1); ingen variant setter `outline-none` uten egen ramme.

`card.test.ts` (ny):
1. vanlig kort: 1 px kant, `rounded-card` (12 px), ingen `shadow`.
2. framhevet kort: sand, uten kant, ingen `shadow`.

`badge.test.ts` (ny):
1. alle varianter (`it.each`): ingen `border`, ingen night-fyll, ingen `min-h-11`/`min-h-14` (lavere enn 44 px), og teksten står i markupen.

`notice.test.ts` (ny):
1. hver variant har tekst og riktig rolle (`status`/`alert` som i dag), ingen `gradient`, ingen `shadow`.

`form.test.ts` (endres, ingen krav svekkes):
1. felt (`Input`, `Textarea`, `Select`) har `rounded-lg` (8 px) og kanttokenet fra 2.6.
2. eksisterende tester (44 px rad, `aria-invalid`, hjelpetekst) står.

`ai-text-mark.test.ts` og `ai-suggestion.test.ts` (endres, ikke svekkes):
1. merket har teksten «KI» eller «KI-forslag» i markupen, og ingen `aurora`/`gradient`.
2. hex-verdiene i «tokenene finnes og har kontrast» byttes til de nye tokenene; kravene står: tekst minst 4,5:1, `min-h-14` på «Bruk», de andre minst 44 pt.
3. «komponentene har ingen faste hex-verdier» står.
4. alle eksisterende tester 10.1–10.17 er grønne uten andre endringer enn farge-/tokennavn.

## 4. Merkevarefargen, `src/app/manifest.test.ts` (utvides)

1. `brand.themeColor` og `theme_color`/`background_color` i manifestet er en verdi fra paletten (leses fra `@theme` i `globals.css`), ikke `#326CA1`.
2. `apple-icon.tsx` bruker `brand.color` eller en palettfarge (ingen fast gammel blå).

## 5. E2e, `e2e/fase-2a-byggcon-profil.spec.ts` (PC og iPad)

### 5.1 Skrift
1. **skriften er lastet:** på `/arbeidskoe` er `fontFamily` på `body` `/inter/i` og på `h1` `/schibsted/i`; `document.fonts.check("16px <første familie>")` er sann etter `document.fonts.ready`.
2. **ingen kall ut:** ingen forespørsel mot andre verter enn appen under hele testen (`page.on("request")`), særlig ikke `fonts.googleapis`/`fonts.gstatic`.
3. **uten nett, iPad:** etter første besøk av `/prove/testskjema` (service worker aktiv), gå uten nett (`context.setOffline(true)`), last siden på nytt: skriftene er fortsatt Inter/Schibsted (fra bufferen), og høyden på hovedknappen er lik før og etter `document.fonts.ready` (ingen hopp).

### 5.2 Former
1. hovedknappen i innloggingen og en knapp på `/arbeidskoe`: `border-radius` ≥ halve høyden.
2. et kort (testid eller rolle i arbeidskøen/oppdraget): `border-radius: 12px`, `border-width: 1px`, `box-shadow: none`.
3. et skjemafelt (`/prove/testskjema`): `border-radius: 8px`.
4. ingen element på `/arbeidskoe`, ett oppdrag, `/prove/testskjema` og `/prove/ki` har `background-image` med `gradient` (`getComputedStyle` over alle elementer).
5. nordlysstripen er borte: ingen `.aurora-bar`.

### 5.3 Trykkflater (iPad liggende 1194 × 834 og stående 1024 × 1366, `boundingBox`)
1. «Send meg en kode» og «Logg inn» i innloggingen: høyde ≥ 56.
2. hovedknappen i testskjemaet: ≥ 56.
3. KI-kortet på `/prove/ki` (prøvetakstmannen): «Bruk» ≥ 56; «Behold min tekst» og «Nytt forslag» ≥ 44.
4. «Synk nå» (og «Logg inn» i synkstatusen når økten er utløpt, med `expireOwnSession`): ≥ 56.
5. menypunkter og lenker i topplinjen: ≥ 44 × 44 (som `fase-0b-grunnlayout.spec.ts`).
6. hopplenken når den har fokus: ≥ 44.

### 5.4 Hopplenken (PC og iPad)
1. første `Tab` fra toppen på `/arbeidskoe` gir synlig lenke «Hopp til hovedinnhold» (i visningen, ikke klippet bort).
2. `Enter` flytter fokus til `main` (`document.activeElement` er `main` eller inne i det), og neste `Tab` går til første lenke/knapp i innholdet, ikke i menyen.
3. fokusrammen er synlig: `outline-style` ikke `none` og `outline-width` ≥ 2px.

### 5.5 KI-merket (prøvetakstmannen, `/prove/ki`)
1. forslaget viser merket med teksten «KI» / «Forslag fra KI», og merkets bakgrunnsfarge er ulik TG- og synkfargene (leses fra CSS-variablene i siden).
2. eksisterende `fase-2a-forslagsmonster.spec.ts` og `fase-2a-forslagsmonster-testplan.spec.ts` er grønne uten endring i logikken (godta, behold, nytt forslag, `ai_usage_log`, uten nett).

### 5.6 Synkstatus
1. «Uten nett»: bakgrunnen er ikke `tg2`/`tg3`/`danger`; ikon og tekst finnes.
2. «Alt er lagret»: bakgrunnen er ikke `tg0`; ikon og tekst finnes.

## 6. Tilgang per rolle og admin

Utseendet er likt for alle; ingen tilgangslogikk endres.

1. **admin stenges ikke ute (e2e):** admin logger inn, havner på `/arbeidskoe`, og åpner `/admin` og en underside (for eksempel selskaper) med overskrift synlig.
2. **rollene ser samme profil (e2e, `it.each` over takstmann, kontor, leder):** innlogging virker, `/arbeidskoe` åpnes, og 5.1 punkt 1 holder.
3. **tilgangstestene er urørte:** alle tester i `src/core/access` og e2e for reklamasjonssaker (bare leder/admin) er grønne.

## 7. Tenant-isolasjon

Ingen ny spørring, så ingen ny `expectTenantIsolation`. Det sjekkes i stedet ved gjennomgangen:

1. `git diff --name-only main...byggcon-profil -- src/db src/core/access` er tom, og ingen `actions.ts`, `route.ts` eller fil i `src/core` er endret.
2. Ingen ny `select`/`insert`/`update` i diffen (`git diff main... | grep -E "^\+.*(db\.|sql\`)"` er tom).
3. `tests/tenant-isolation-all-tables.test.ts` og `tests/tenant-isolation.test.ts` er grønne.

Finnes en ny spørring i diffen, avvises PR-en til den har sin egen `expectTenantIsolation`.

## 8. Regeltester og myk sletting

- Ingen regler eller TG-logikk endres. TG-tokenene testes som data i 2.8 (`it.each` over de fem nivåene). Regeltestene for systemmalen (`src/db/seed/sample-template.test.ts` og prøve E) er grønne uten endring.
- Ingen sletting berøres. Eksisterende tester for myk sletting er grønne.

## 9. Skjermbilder og dokumentasjon

1. **filene finnes** (i `tests/byggcon-profile.test.ts`): 20 bilder i `docs/design/byggcon-profil/bilder/`: `ezprop-for-*` og `ezprop-etter-*` for innlogging, arbeidskø, oppdrag, skjema og `/prove/ki`, hver i `-pc` og `-ipad`. Ingen fil er tom.
2. «Før»-bildene er tatt fra `main` før temaet ble endret (sjekkes i gjennomgangen: gammel blå og nordlysstripen synes). Bildene viser bare oppdiktede data (sjekkes for hånd).
3. `docs/08-designprinsipper.md` nevner snow, sand, night, fjord, Inter, Schibsted Grotesk, 12 px, «TG alltid med tekst», synkstatus og KI-merket, og sier at luften og trykkflatene står (tekstsjekk i samme vitest). `.claude/agents/ui-designer.md` nevner ikke lenger Roboto eller nordlys.

## 10. Kjøring og godkjenning

1. Flett inn `main` (med PR #166 hvis merget) før PR. Kjør `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm size` og hele `pnpm test:e2e` på nytt etter flettingen.
2. **Ytelse:** `pnpm size` før (fra `main`) og etter; egen JS per side øker ikke (skriftene er filer, ikke JS). Bare Inter-filene lastes på forhånd (D2); størrelsen noteres i rapporten.
3. Versjonen i `package.json` er 0.7.x og vises i `/api/helse`.
4. **Avvises hvis:** et kontrastpar under kravet, en trykkflate under 44/56 px, en låst test er svekket (ikke bare byttet hex), en ny spørring uten tenant-test, admin kommer ikke inn, eller `aurora`/`gradient`/`roboto` finnes i `src/` eller `public/`.
