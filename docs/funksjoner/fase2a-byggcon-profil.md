# Funksjon: Byggcon-profilen i EzProp

- **Fase:** 2a (prioritert av Ståle 12.11.2026, før neste punkt i 2a-2)
- **Modul:** kjerne / tema (`src/app/globals.css`, `src/app/layout.tsx`) og felleskomponentene (`src/shared/ui`)
- **Status:** utkast
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
- **Felleskomponentene** i `src/shared/ui`: `button.tsx` (pilleform; hovedknapp night med lys tekst, sekundær gjennomsiktig med mørk kant; ingen gul knapp), `card.tsx` (tynn kant, 12 px, ingen skygge; framhevet flate i sand uten kant), `badge.tsx`, `notice.tsx`, `form.tsx` (felt med 8 px hjørner), `ai-text-mark.tsx` og `ai-suggestion.tsx` (KI-uttrykket).
- **TG-tokens i temaet** (`--color-tg-*` for TG0, TG1, TG2, TG3, TGIU) med samme toner som statusfargene i Optiplan (grønn, gul, rød, varm grå), hver med tekstfarge som gir minst 4,5:1. Dokumenteres i designprinsippene med regelen «TG alltid med tekst».
- **Merkevarefargen** i `src/shared/config/brand.ts` (`themeColor` og manifest) settes til en farge fra paletten.
- **Høyden på trykkflater beholdes:** minst 44 pt, hovedknapper 56–72 pt (beslutningen 24.10.2026). Ingen klasser for høyde eller luft endres i sidene.
- **Små fargefeil i sidene** der en side bruker en farge som ikke lenger finnes (for eksempel `aurora`, `ai-*` som endrer navn), eller som får for lav kontrast etter byttet.
- **`docs/08-designprinsipper.md`** oppdateres: grunnmuren blir Byggcon-profilen (palett, skrift, former, TG-toner, KI-merket); luften og trykkflatene står.
- **Skjermbilder før og etter**, PC (1440 bred) og iPad (1024 × 1366 og liggende), av innloggingssiden, dashbordet/arbeidskøen, ett oppdrag, et skjema og prøvesiden for KI (`/prove/ki`). Lagres i `docs/design/byggcon-profil/bilder/ezprop-for-*` og `ezprop-etter-*`.
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

## Tilgang
Ingen endring. Utseendet er likt for alle roller.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen nye tabeller, felter eller migreringer. Ingen faste koder (`key`) tas i bruk. Ordlisten (`docs/05-domenemodell.md` avsnitt 8) får de nye navnene i paletten hvis de brukes i kode (`snow`, `sand`, `night`, `fjord`, `stone`, `line`).

## Skjermer
Alle sider følger temaet. Antall trykk er uendret på iPad og PC. Hovedhandlingen på hver skjerm blir hovedknappen i night (pilleform); sekundære handlinger er gjennomsiktige med kant.

## Regler
Ingen regler eller TG-logikk endres.

## Akseptkriterier
- [ ] Ingen `aurora`, `gradient` eller Roboto igjen i `src/` og `public/` (test eller lint som sjekker det).
- [ ] Inter i brødtekst og Schibsted Grotesk i overskrifter, lastet lokalt; byggingen virker uten internett.
- [ ] Knapper er pilleformede, kort har tynn kant og 12 px hjørner uten skygge, skjemafelt 8 px.
- [ ] Trykkflatene er uendret: hovedknapper minst 56 px høye og andre trykkflater minst 44 px på iPad-størrelse (e2e måler minst innlogging, en knapp i et skjema og KI-kortet).
- [ ] Kontrast minst 4,5:1 for tekst og 3:1 for kanter på felt og fokusramme i alle par i paletten som brukes (enhetstest som regner ut forholdet fra tokenene i `globals.css`), også TG-tokenene og KI-merket.
- [ ] KI-merket har eget uttrykk med tekst, skiller seg fra TG og status, og godta, endre og avvis virker som før (eksisterende tester og e2e for `/prove/ki` grønne).
- [ ] TG-tokenene finnes for TG0, TG1, TG2, TG3 og TGIU, og designprinsippene sier at TG alltid vises med tekst.
- [ ] `docs/08-designprinsipper.md` beskriver Byggcon-profilen og at luften og trykkflatene står.
- [ ] Skjermbilder før og etter på PC og iPad ligger i `docs/design/byggcon-profil/bilder/`.
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen nye spørringer; eksisterende tester for tenant-isolasjon grønne.
- [ ] Virker på iPad-størrelse (e2e).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` og `pnpm size` grønne. Main (med PR #166 hvis den er merget) flettet inn før PR.

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md` fra A224)
- TG-komponenten venter til «Badet på PC»; bare tokenene lages nå (lett å endre).
- Gråskalaen omdefineres i temaet i stedet for å bytte klasser i sidene, som i Optiplan (lett å endre).
- KI-merkets farge velges av ui-designer innenfor paletten (fjord-familien eller en egen dempet tone), alltid med teksten «KI» (lett å endre).

## Åpne spørsmål
- Ingen som stopper oppgaven.
