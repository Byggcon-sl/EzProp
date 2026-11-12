# Funksjon: Byggcon-profilen i EzProp

- **Fase:** 2a (prioritert av Ståle 12.11.2026, før neste punkt i 2a-2)
- **Modul:** kjerne / tema (`src/app/globals.css`, `src/app/layout.tsx`) og felleskomponentene (`src/shared/ui`)
- **Status:** godkjent etter runde 1 (forenkler, ux-ansvarlig, test-leder)
- **Branch:** `byggcon-profil` fra `main`
- **Støtter hovedmål:** De ansatte: samme uttrykk som byggcon.no og Optiplan, så de ansatte møter ett Byggcon og ikke to systemer med hver sin stil; rolig, høy kontrast for sollys på iPad. / KI i bunnen: KI-merket får et eget, tydelig uttrykk i den nye paletten, så KI-tekst alltid kan skilles fra takstmannens tekst og kontrolleres før den godtas. / Reklamasjoner: indirekte. TG vises alltid med tekst og med de samme tonene som i Optiplan, så TG ikke kan leses feil på grunn av farge.

## Problem
Ståle 12.11.2026: «vi har oppdatert designet på optiplan, får å reflektere vår design på hjemmesiden. Jeg ønsker at vi også gjør samme grep for EzProp.» EzProp bruker i dag det gamle Optiplan-uttrykket (Roboto, Byggcon-blå #326CA1, nordlysstripe og nordlysfiolett for KI, fargeovergang i KI-kortet). Gjøres det ikke nå, bygges skjermene og PDF-en i 2a-2 i den gamle profilen og må gjøres om senere.

## KI i bunnen
Oppgaven endrer bare utseendet. KI får ingen nye oppgaver og ingen nye data, og ingenting nytt går gjennom `src/core/ai`. Det som gjelder KI:
- **KI-merket og forslagskortet** (`src/shared/ui/ai-text-mark.tsx`, `ai-suggestion.tsx`) får et eget uttrykk i paletten uten nordlysfiolett og uten fargeovergang. Kravet står: KI-tekst skal kunne skilles fra takstmannens tekst med tekst («KI-forslag»), ikke bare med farge, og merket skal ikke ligne TG eller status.
- Godta, endre og avvis virker som før, og loggen i `ai_usage_log` er urørt (eksisterende tester skal fortsatt være grønne).

## Brukerhistorier
- Som **takstmann** vil jeg **at EzProp ser ut som byggcon.no og Optiplan** slik at jeg kjenner meg igjen og stoler på verktøyet.
- Som **takstmann på iPad** vil jeg **beholde de store trykkflatene og luften** slik at befaringen er like rask og trygg som før.
- Som **takstmann** vil jeg **se tydelig hva KI har foreslått** slik at jeg kontrollerer det før jeg godtar.

## Omfang
**Med:**
- **Temaet i `src/app/globals.css`**, samme grep som Optiplan (`docs/design/byggcon-profil/optiplan-globals.css.txt` som referanse, ikke kopi): paletten snow, sand, night, fjord, mørk fjord, stone, linje (12 % og 25 %); `brand`-skalaen følger fjord; `slate`-skalaen omdefineres til Byggcon-tonene (så de rundt 300 slate-klassene i sidene følger med uten håndredigering); `canvas` blir snow; `--radius-card` 12 px; skygge bare på lag som flyter over innholdet; fokusramme i mørk fjord. Kanten på skjemafelt minst 3:1 mot bakgrunnen.
- **Skrift:** Inter (400, 500, 600, 700) i brødtekst og Schibsted Grotesk (500, 600, 700) i overskrifter, lokale filer i `public/fonts` med `next/font/local` (ingen kall til Google). Roboto-filene og lisensteksten fjernes, `public/fonts/README.md` oppdateres med lisensene (SIL OFL 1.1, filene fra `docs/design/byggcon-profil/fonts/`).
- **Nordlysstripen** (`.aurora-bar` i `layout.tsx`) og alle `aurora`-farger fjernes. Ingen `gradient` igjen i `src/`.
- **Felleskomponentene** i `src/shared/ui`: `button.tsx` (pilleform; hovedknapp night med lys tekst, sekundær gjennomsiktig med mørk kant; ingen gul knapp; ghost-knappen bare til tredje handling, med kant eller understreking så den synes i sollys, og fortsatt `min-h-11`; deaktivert hovedknapp skal ha lesbar tekst, ikke `opacity-60` på night, ui-designer velger løsningen), `card.tsx` (tynn kant, 12 px, ingen skygge; framhevet flate i sand uten kant), `badge.tsx` (statusmerker er flate, uten kant og uten night-fyll, og lavere enn 44 px, så de ikke ligner en knapp), `notice.tsx`, `form.tsx` (felt med 8 px hjørner), `ai-text-mark.tsx` og `ai-suggestion.tsx` (KI-uttrykket).
- **TG-tokens i temaet** (`--color-tg-*` for TG0, TG1, TG2, TG3, TGIU) med samme toner som statusfargene i Optiplan (grønn, gul, rød, varm grå), hver med tekstfarge som gir minst 4,5:1. Dokumenteres i designprinsippene med regelen «TG alltid med tekst».
- **Synkstatusen** (`src/modules/offline-trial/sync-status.tsx`) får egne tokens i temaet (`--color-sync-*`) i stedet for hex skrevet rett inn. «Uten nett» får verken rød eller TG-gul tone (ingenting er tapt), og «Alt lagret» ikke TG0-grønn. Ikon og tekst er alltid med, så synkstatus aldri kan leses som TG.
- **Skriftlasting uten hopp:** `next/font/local` med `display: "swap"` og `adjustFontFallback` (standard), så knappene ikke flytter seg når skriften lastes, også uten nett med tom buffer. Bare Inter 400/600 og Schibsted Grotesk 600 lastes på forhånd (`preload`); resten lastes ved behov. Skriftene ligger i `/_next/static/media`, som `public/sw.js` allerede buffrer.
- **`.claude/agents/ui-designer.md`** oppdateres til Byggcon-profilen (ikke lenger «Byggcon-blå, Roboto, nordlys»).
- **Merkevarefargen** i `src/shared/config/brand.ts` (`themeColor` og manifest) settes til en farge fra paletten.
- **Høyden på trykkflater beholdes:** minst 44 pt, hovedknapper 56–72 pt (beslutningen 24.10.2026). Ingen klasser for høyde eller luft endres i sidene.
- **Små fargefeil i sidene** der en side bruker en farge som ikke lenger finnes (for eksempel `aurora`, `ai-*` som endrer navn), eller som får for lav kontrast etter byttet.
- **`docs/08-designprinsipper.md`** oppdateres: grunnmuren blir Byggcon-profilen (palett, skrift, former, TG-toner, KI-merket); luften og trykkflatene står.
- **Skjermbilder før og etter**, PC (1440 bred) og iPad stående (1024 × 1366), av innloggingssiden, dashbordet/arbeidskøen, ett oppdrag, et skjema og prøvesiden for KI (`/prove/ki`). Lagres i `docs/design/byggcon-profil/bilder/ezprop-for-*` og `ezprop-etter-*` (20 bilder). «Før»-bildene tas fra `main` før første endring i temaet, og viser bare oppdiktede data fra prøveorganisasjonen.
- Versjon 0.6.12 → 0.7.x (minor, synlig for alle; tar hensyn til at PR #166 også øker versjonen).
- Små funn fra nattløkken i samme område: hopplenken «Hopp til hovedinnhold» i `src/app/(ansatt)/layout.tsx` (punkt 5).

**Ikke med (bevisst utelatt):**
- Ingen endring i tetthet, luft, avstander eller størrelse på trykkflater. Optiplans tettere oppsett følges ikke.
- Ingen ny TG-komponent og ingen TG-visning i sidene. TG-merket bygges med «Badet på PC» i 2a-2 og bruker tokenene herfra.
- PDF-en. Den bygges i den nye profilen fra start i 2a-2 (ADR om PDF-motor).
- Mørk visning (fase 3).
- Ny logo, nye ikoner eller nye illustrasjoner. Ikonet i `apple-icon.tsx` får bare ny farge hvis det bruker `brand.color`.
- Omskriving av sider. Sidene følger temaet; bare fargefeil og kontrastbrudd rettes der.
- Nye avhengigheter (skriftene er filer, ikke pakker). `@axe-core/playwright` tas ikke inn i denne oppgaven.
- Innloggingssiden ut over farger og skrift (PR #166 eier oppsettet).
- Skjermbilder av iPad liggende (testlaget kan ta dem senere). Trykkflatene måles likevel i begge retninger i e2e.
- Nye ord i ordlisten. Fargenavnene er navn på tokens, ikke ord i domenet, og dokumenteres i `docs/08-designprinsipper.md`.
- Ny lint-regel for forbudte ord og en generell tolker for hele `globals.css`.

## Tilgang
Ingen endring. Utseendet er likt for alle roller.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen nye tabeller, felter eller migreringer. Ingen faste koder (`key`) tas i bruk. Ordlisten (`docs/05-domenemodell.md` avsnitt 8) endres ikke: fargenavnene (`snow`, `sand`, `night`, `fjord`, `stone`, `line`) er tokens og står i designprinsippene.

## Skjermer
Alle sider følger temaet. Antall trykk er uendret på iPad og PC. Hovedhandlingen på hver skjerm blir hovedknappen i night (pilleform); sekundære handlinger er gjennomsiktige med kant.

## Regler
Ingen regler eller TG-logikk endres.

## Akseptkriterier
- [ ] **Forbudte ord** (én vitest, ingen lint-regel): ingen `aurora`, `gradient` eller `roboto` (store og små bokstaver, også i filnavn) og ingen `fonts.googleapis`, `fonts.gstatic` eller `next/font/google` i `src/` og `public/`. Testen viser også at Inter- og Schibsted-filene ligger i `public/fonts`, og at `public/fonts/README.md` nevner SIL OFL 1.1 og ikke lenger sier at Roboto brukes i PDF.
- [ ] **Skrift** (e2e): `getComputedStyle` viser Inter på `body` og Schibsted Grotesk på `h1`, og `document.fonts.check` er sann. Byggingen virker uten internett.
- [ ] **Former** (e2e): knappen har `border-radius` minst halve høyden; kortet har 12 px hjørner, 1 px kant og `box-shadow: none`; skjemafeltet har 8 px hjørner.
- [ ] **Trykkflater** (e2e, `boundingBox`, iPad liggende 1194 × 834 og stående 1024 × 1366): hovedknappen i innloggingen, en knapp i et skjema, «Bruk», «Endre» og «Avvis» i KI-kortet og «Synk nå»/«Logg inn» i synkstatusen er minst 56 px; hopplenken og menypunkter minst 44 px. Den eksisterende e2e-testen uten nett er grønn.
- [ ] **Kontrast** (enhetstest i `src/app/(ansatt)/contrast.test.ts`, regner fra tokenene i `globals.css`, ingen ny avhengighet). Temaet leses først, og slate-verdiene fjernes fra `fixed`. `readThemeColors` feiler hvis en `--color-*` i `@theme` ikke er skrevet som `#rrggbb`. Parene som testes:
  - tekst (slate-600, slate-700, slate-900 og night) mot snow, hvit og sand: minst 4,5:1;
  - lys tekst mot night på hovedknappen, også deaktivert: minst 4,5:1;
  - kant på sekundærknapp og skjemafelt mot snow, hvit og sand: minst 3:1;
  - fokusramme (mørk fjord) mot snow, hvit, sand og night: minst 3:1;
  - hver `--color-tg-*` og `--color-sync-*`, tekst mot flate: minst 4,5:1;
  - KI-merket og forslagskortet: tekst mot flate minst 4,5:1, kant mot bakgrunn minst 3:1.
- [ ] **KI-merket** har eget uttrykk: KI-tokenene er ikke like noen TG-, synk- eller statustoken (enhetstest), og merket har teksten «KI» eller «KI-forslag» i HTML. Godta, endre og avvis og loggingen i `ai_usage_log` virker som før (eksisterende tester og e2e for `/prove/ki` grønne).
- [ ] **Låste tester oppdateres, ikke svekkes:** i `src/shared/ui/ai-suggestion.test.ts` byttes hex-verdiene til de nye tokenene, men kravene står: tekst minst 4,5:1, `min-h-14` og knappen «Bruk».
- [ ] **Felleskomponentene** har enhetstester: button (night og sekundær, ingen gul), card (vanlig og sand uten kant), badge (flat, uten kant), notice og form.
- [ ] **Merkevarefargen:** `brand.themeColor` og manifestet bruker en farge som finnes i paletten (enhetstest).
- [ ] **Hopplenken** (e2e, PC og iPad): første Tab viser «Hopp til hovedinnhold», og Enter flytter fokus til `main`.
- [ ] TG-tokenene finnes for TG0, TG1, TG2, TG3 og TGIU, og designprinsippene sier at TG alltid vises med tekst.
- [ ] `docs/08-designprinsipper.md` beskriver Byggcon-profilen (palett med tokens, skrift, former, TG-toner, synkstatus, KI-merket) og at luften og trykkflatene står. `.claude/agents/ui-designer.md` er oppdatert.
- [ ] **Skjermbilder:** `ezprop-for-*` og `ezprop-etter-*` finnes for PC og iPad i `docs/design/byggcon-profil/bilder/` (testen sjekker at filene finnes).
- [ ] **Tilgang og tenant-isolasjon:** diffen rører ikke `src/db`, `src/core/access` eller spørringer, så ingen ny `expectTenantIsolation`. `tests/tenant-isolation-all-tables.test.ts` og tilgangstestene er grønne. Admin kan fortsatt logge inn og åpne adminsidene.
- [ ] **Ytelse:** `pnpm size` viser at første lasting ikke blir merkbart tyngre (bare tre skriftvekter lastes på forhånd).
- [ ] Main (med PR #166 hvis den er merget) er flettet inn før PR, og hele e2e er kjørt på nytt etterpå. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` og `pnpm size` er grønne, og versjonen er 0.7.x.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` fra A214; høyeste nå er A213)
- TG-komponenten venter til «Badet på PC»; bare tokenene lages nå (lett å endre).
- Gråskalaen omdefineres i temaet i stedet for å bytte klasser i sidene, som i Optiplan (lett å endre).
- KI-merkets farge velges av ui-designer innenfor paletten (fjord-familien eller en egen dempet tone), alltid med teksten «KI» (lett å endre).

- Synkstatusen får egne tokens som verken ligner TG eller feil; «Uten nett» er en nøytral, rolig tone (lett å endre).
- Bare tre skriftvekter lastes på forhånd, resten ved behov (lett å endre).

## Avgjort ved uenighet (runde 1)
- **Skjermbilder av iPad liggende:** droppes (forenkler). Trykkflatene måles likevel både liggende og stående i e2e (test-leder, ux-ansvarlig), fordi det er billig og sikrer beslutningen 24.10.2026, mens 10 ekstra bilder ikke sier noe nytt.
- **Ordlisten:** ingen nye ord (forenkler). Fargenavnene er tokens, ikke domeneord; test-leders krav «bare hvis de brukes i koden» faller da bort.
- **Forbudte ord:** én vitest (forenkler), utvidet med test-leders sjekker for Google-skrift og lisens, fordi det er samme fil og få linjer.
- **Kontrasttesten:** smal liste over par (forenkler), men med test-leders to rettelser (temaet først, feil ved ikke-hex). Uten dem kan testen bli grønn på gamle verdier.

## Åpne spørsmål
- Ingen som stopper oppgaven.
