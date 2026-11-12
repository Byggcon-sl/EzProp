# 08 – Designprinsipper

Sist oppdatert: 12.11.2026. Kilder: `docs/kartlegging/design-retninger.md` (Ståle 24.10.2026), skissene i `docs/design/`, Byggcon-profilen i `docs/design/byggcon-profil/` (Ståle 12.11.2026: «samme grep» som Optiplan) og komponentspesifikasjonen `docs/funksjoner/fase2a-byggcon-profil-design.md`.

**Grunnmur: Byggcon-profilen.** Samme uttrykk som byggcon.no og Optiplan: rolige flater i snow og sand, tekst og hovedknapp i night, fjord som aksent. Oppsettet fra A «Fjord» står: luftig og kort-basert, også på PC. Mørk visning er et valg for brukeren, ikke standard (fase 3). Ingen kompakt visning i første versjon.

**Luften og trykkflatene står** (beslutningen 24.10.2026). Profilen bytter farger, skrift og former, ikke tetthet: minst 44 pt på alle trykkflater, hovedknapper 56–72 pt, samme avstander som før. Optiplans tettere oppsett følges ikke.

## Prinsipper

1. **Arbeidskø før statistikk.** Dashbordet viser først det som venter på deg.
2. **Oppdragets status er ryggraden:** bestilt → under arbeid → ferdig → fakturert. Neste steg vises alltid.
3. **Én hovedhandling per skjerm.** Den er hovedknappen i night.
4. **Systemet foreslår, takstmannen bestemmer.** TG-forslag med begrunnelse og kilde. KI-tekst merkes med KI-merket.
5. **Tall i stedet for ja/nei** for målinger.
6. **Trykkflater på iPad:** minst 44 pt, hovedknapper 56–72 pt. Ingen nedtrekksmenyer eller sveiping i befaringen. Store Ja/Nei-knapper nederst (fra C).
7. **Hovedknappene fast nederst** i tommelsonen.
8. **Kamera alltid ett trykk unna.** Bildet knyttes til punktet.
9. **Rolig, alltid synlig status for nett og lagring** (synkstatus, se under).
10. **Høy kontrast** for sollys og mørke rom.
11. **TG alltid med tekst**, aldri bare med farge.
12. **Samme data, to visninger:** iPad for befaring, PC for kontoret.
13. **Kontroll før levering underveis**, vist som et lite merke, ikke et panel som alltid er åpent.
14. **Skjulte hurtigtaster** på PC (TG og «/» for fraser, fra B). Panelet «Slik blir det i rapporten» når man skriver (fra C).
15. **Universell utforming (WCAG 2.1 AA):** fokusramme, skjermleser, kontrast minst 4,5:1 på tekst og 3:1 på kanter og fokusramme.

## Byggcon-profilen

Tokenene står i `@theme` i `src/app/globals.css`, alltid som `#rrggbb`. Kontrasten regnes ut fra temaet i `src/app/(ansatt)/contrast.test.ts`. Navnene er tokens, ikke ord i domenet.

### Palett

| Token | Hex | Brukes til |
|---|---|---|
| `snow` | `#f5f4f0` | bakgrunn bak kortene (`canvas`) |
| `sand` | `#eeebe3` | paneler, framhevede flater, merker |
| `night` | `#0f1924` | tekst, hovedknapp, valgt menypunkt |
| `fjord` | `#316aa0` | aksent, fokusramme, merkevarefargen |
| `fjord-dark` | `#255a8c` | lenketekst |
| `stone` | `#5d6774` | dempet tekst, deaktivert hovedknapp |
| `line` | `#dfdcd4` | tynne kanter og skillelinjer (night ca. 12 %) |
| `line-strong` | `#c6c3bb` | sterkere linje (night ca. 25 %) |
| `field` | `#7a828d` | kant på skjemafelt, minst 3:1 mot hvit, snow og sand |

Gråskalaen (`slate`) og `brand` er omdefinert til disse tonene i temaet, så sidene følger med uten at klassene byttes. Det finnes ingen gul i paletten og ingen gul knapp: gult betyr «følg med» (TG2).

### Skrift

- **Inter** i brødtekst, knapper og skjema (400, 500, 600, 700). Lastes på forhånd.
- **Schibsted Grotesk** i overskriftene `h1` og `h2` (500, 600, 700). Lastes ved behov. `h3` og mindre er Inter 600.
- Skriftene er lokale filer i `public/fonts` (SIL OFL 1.1), lastet med `next/font/local`. Ingen kall til Google, og ingen hopp i oppsettet når skriften kommer, også uten nett.

### Former

- **Pilleknapper.** Hovedknapp i night med hvit tekst. Sekundærknapp gjennomsiktig med mørk kant. Ghost bare til en tredje handling, med understreking så den synes i sollys. Deaktivert hovedknapp er stone med hvit tekst, ikke gjennomsiktig.
- **Kort med tynn kant og 12 px hjørner**, hvit flate og ingen skygge. Framhevet flate i sand uten kant.
- **Skjemafelt med 8 px hjørner** og kant i `field`.
- **Skygge bare på lag som flyter over innholdet** (menyer og dialoger).
- **Ingen nordlys og ingen fargeoverganger.**
- **Fokusramme i fjord** (2 px, med luft), synlig mot snow, hvit, sand og night (minst 3:1).

### Statustokens

Felles med Optiplan. Hver har flate, tekst og strek. Tekst mot flate er minst 4,5:1.

| Status | Flate | Tekst | Strek | Betyr |
|---|---|---|---|---|
| `ok` | `#cdeedd` | `#155e3e` | `#1f8a5b` | i orden |
| `watch` | `#fbe7b5` | `#6b4405` | `#b7791f` | følg med |
| `urgent` | `#f8d0cc` | `#8b2a1f` | `#c0392b` | feil eller noe som fjernes |
| `unknown` | `#e4e1d8` | `#4a463f` | `#6e6a62` | ukjent |

Statusmerker er flate (ingen kant) og lavere enn 44 px, så de ikke ligner knapper.

### TG-tonene

Samme toner som statusfargene i Optiplan: TG0 og TG1 grønn (`ok`), TG2 gul (`watch`), TG3 rød (`urgent`), TGIU varm grå (`unknown`). Tokenene heter `--color-tg0-bg`, `--color-tg0-text` osv. for `tg0`, `tg1`, `tg2`, `tg3` og `tgiu`.

**Regel: TG alltid med tekst.** Merket viser alltid «TG2» (og gjerne «Vesentlige avvik»), aldri bare fargen. TG0 og TG1 har samme tone; teksten skiller dem.

### Synkstatus

Synkstatusen har egne tokens (`--color-sync-saved-*`, `sync-pending`, `sync-offline`, `sync-waiting`) og er verken TG-grønn, TG-gul eller rød. «Alt er lagret» er en lys fjordtone, «Uten nett» en rolig grå (ingenting er tapt). Ikon og tekst står alltid med, så synkstatusen aldri kan leses som TG.

### KI-merket

KI har en egen dempet blågrønn tone, «hav» (`ai-50` flate, `ai-line` kant, `ai-700` «Bruk»-knappen og ikonet, `ai-900` tekst). Den ligner verken fjord, TG, synkstatus eller status, og har ingen fiolett og ingen fargeovergang.

- KI-merket er **det eneste merket med kant**.
- Det står **alltid ordet «KI»** («Forslag fra KI», «Tekst fra KI, godkjent»), sammen med gnisteikonet. KI-tekst skal kunne skilles fra takstmannens tekst uten å stole på farge.
- Forslagskortet er et vanlig kort; forslaget står i en boks i `ai-50` med kant i `ai-line`.

## Hva UI-designeren leverer

Skisse eller komponentspesifikasjon før koding, målt mot Byggcon-profilen over og skjermbildene i `docs/design/byggcon-profil/bilder/`. Luften og trykkflatene fra skissene `docs/design/bilder/A-*.png` står. Antall trykk før og etter anslås av ux-ansvarlig.
