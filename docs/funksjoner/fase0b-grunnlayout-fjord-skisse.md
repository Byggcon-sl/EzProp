# Skisse: Grunnlayout i design A «Fjord» (ramme og tom arbeidskø)

- **Oppgavekort:** `docs/funksjoner/fase0b-grunnlayout-fjord.md` (runde 2)
- **Fra:** ui-designer, 31.10.2026
- **Målt mot:** `docs/design/bilder/A-dashbord.png` (PC), `A-ipad-liggende.png`, `A-ipad-staende.png` og målene i `docs/design/retning-A.html` (`.top`, `.nav`, `.co`)
- **Støtter hovedmål:** Tid (arbeidskøen først, samme ramme på alle enheter, 1 trykk til testskjemaet). Reklamasjoner (høy kontrast, trykkflater på minst 44 px, færre feiltrykk). KI først (fast plass for «venter på deg», der KI-forslag til godkjenning kommer senere).

Bare lys visning. Mørk visning er tatt ut av kortet (avgjørelse 1, kommer i fase 3). Ingen nye komponenter i `src/shared/ui`. Gjenbruk `Card` og `Button` som de er.

## 1. Oppbygning

```
<body>  (bg-canvas, aurora-bar fra rotlayouten, uendret)
  <header>                 topplinje, hvit, kant under, IKKE sticky
  <div>                    rammen
    <nav aria-label="Hovedmeny">   fast til venstre fra lg, rad under topplinjen under lg
    <div>                  innholdsflate; siden selv har <main>
```

- **Innholdsflaten er en `<div>`, ikke `<main>`.** Arbeidskøen og alle sidene i `/prove` har allerede sin egen `<main>`. To `<main>` inni hverandre gir feil landemerker for skjermleser.
- **Topplinjen er ikke sticky, og ingen del av rammen har egen rulling** (`overflow-auto`, `h-dvh` med rulling). Statuslinjen i `/prove` er `sticky top-0` og må fortsatt legge seg øverst i vinduet, og `scroll-padding-top` i `globals.css` regner bare med den. Hele siden ruller som i dag.

### PC og iPad liggende (fra `lg`, 1024 px)

```
+--------------------------------------------------------------------------+
| aurora-bar 4 px                                                          |
+--------------------------------------------------------------------------+
| [Ez] EzProp                                          (IS)  [ Logg ut ]   |  56 px, hvit
+---------------------+----------------------------------------------------+
| > Arbeidskø         |  Arbeidskø                       (h1)              |
|                     |  Hei, Ingrid.                                      |
| PRØVER              |                                                    |
|   Testskjema uten   |  +----------------------------------------------+  |
|   nett              |  | Ingenting venter på deg                      |  |
|                     |  | Oppdrag og befaringer kommer her når         |  |
|                     |  | rapportdelen er bygget.                      |  |
|                     |  +----------------------------------------------+  |
| +-----------------+ |                                                    |
| | Du jobber for   | |                                                    |
| | Byggcon         | |                                                    |
| +-----------------+ |                                                    |
+---------------------+----------------------------------------------------+
   232 px, canvas            canvas, maks bredde 72rem
```

### iPad stående (under `lg`, 834 px)

```
+--------------------------------------------------+
| [Ez] EzProp                    (IS)  [ Logg ut ] |  56 px, hvit
+--------------------------------------------------+
| [ Arbeidskø ]   Prøver: [ Testskjema uten nett ] |  rad, canvas
| Du jobber for Byggcon                            |  liten tekst
+--------------------------------------------------+
| Arbeidskø                                        |
| Hei, Ingrid.                                     |
| +----------------------------------------------+ |
| | Ingenting venter på deg                      | |
| +----------------------------------------------+ |
```

Ingen menyknapp, ikke noe panel (avgjørelse 2). Raden får `flex-wrap`, så den bryter pent hvis teksten blir større.

## 2. Komponenter og mål

Alt i `src/app/(ansatt)/layout.tsx`. Tailwind-klassene er forslag; målene er det som gjelder.

### Topplinje (`<header>`, landemerke «banner»)

| Del | Mål og stil | Merknad |
|---|---|---|
| Linjen | høyde 56 px (`h-14`), `bg-white`, `border-b border-slate-200`, marg 20 px (`px-5`), `flex items-center gap-4` | Ikke sticky |
| Logo | rute 30x30 px, `rounded-lg bg-brand-600`, hvite bokstaver «Ez» 15 px fet, `aria-hidden` | Som `.logo b` |
| Produktnavn | `brand.productName`, 19 px (`text-lg`), fet, `text-brand-900`, `tracking-tight` | Lenke til `/arbeidskoe`, minst 44 px høy (`min-h-11 inline-flex items-center`). Bokstavene i logoen tas ikke fra produktnavnet i koden; bruk `brand.productName.slice(0, 2)` |
| Fyll | `flex-1` | Her kommer søk, synk-merke og bytte til Optiplan senere. Ingen plassholder nå |
| Initialer | sirkel 32 px, `rounded-full bg-brand-600 text-white`, 12 px fet, `aria-hidden="true"` | Første bokstav i de to første ordene i `actor.name`, store bokstaver. Tomt navn: første bokstav i e-posten. Rett etter: `<span class="sr-only">Innlogget som {actor.name}</span>` |
| «Logg ut» | dagens `LogOutButton` (`Button variant="secondary"`, `min-h-11`) | Flyttes fra `arbeidskoe/` til `(ansatt)/` sammen med layouten |

Sirkelen er ikke en knapp, så den trenger ikke 44 px.

### Meny (`<nav aria-label="Hovedmeny">`)

**Fra `lg`:** bredde 232 px (`w-58`), `bg-canvas` (ingen egen flate, som skissen), `px-3 py-4`, `flex flex-col gap-0.5`, minst like høy som vinduet minus topplinjen (`lg:min-h-[calc(100dvh-60px)]`) så organisasjonskortet står nederst.

**Under `lg`:** `flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-200`.

| Del | Fra `lg` | Under `lg` |
|---|---|---|
| Menypunkt | `flex items-center gap-2.5 min-h-11 px-3 rounded-[10px] text-sm text-slate-700`, ikon 18 px foran | `inline-flex items-center gap-2 min-h-11 px-4 rounded-[10px] bg-white ring-1 ring-slate-200 text-sm text-slate-700` |
| Aktivt punkt (`aria-current="page"`) | `bg-brand-100 text-brand-900 font-medium` | samme, uten ring |
| Hover | `hover:bg-white` | `hover:bg-brand-50` |
| Fokus | arver `:focus-visible` fra `globals.css` (2 px `outline-brand-600`, avstand 2 px). Ikke overstyr med `outline-none` | samme |
| Gruppenavn «Prøver» | `<p>` (ikke overskrift), 12 px (`text-xs`), store bokstaver, `tracking-wider`, **`text-slate-600`**, `px-3 pt-3.5 pb-1.5` | `text-sm text-slate-600`, vanlig skrift, «Prøver:» rett foran punktet |

Menypunktene står i en `<ul>` med `<li>` (skjermleseren sier antall). Gruppen «Prøver» er sin egen `<ul>` med `aria-labelledby` til gruppenavnet.

**Avvik fra skissen, med vilje:** skissen har menypunkter på 38 px og gruppenavn i `--muted` (#64748b). 38 px er under kravet på 44 px, og #64748b på `canvas` gir bare 4,08:1. Vi bruker 44 px og `slate-600`.

Ikoner som enkel SVG i layoutfilen, 18x18, `stroke="currentColor"`, `stroke-width="1.8"`, `fill="none"`, `aria-hidden="true"`:
- Arbeidskø: hus (som «Oversikt» i skissen).
- Testskjema uten nett: dokument med linjer.

Aktivt punkt: layouten er en serverkomponent og kjenner ikke stien. Bruk en liten klientdel med `usePathname()` bare for `aria-current`, eller sett `aria-current` ut fra stien i en lenke-komponent i samme fil. Utvikleren velger det enkleste; ingen egen tilstand utover stien. «Arbeidskø» er aktiv på `/arbeidskoe`. «Testskjema uten nett» er aktiv på `/prove/testskjema` og alt under.

### «Du jobber for»

Vises bare når `organizationLabel(...)` ikke er `null`.

| | Fra `lg` | Under `lg` |
|---|---|---|
| Plass | nederst i menyen (`mt-auto`) | egen linje under raden, i samme `<nav>` (`basis-full`) |
| Stil | kort: `bg-white rounded-xl px-3 py-2.5 shadow-card` | ren tekst, ingen flate |
| Tekst | «Du jobber for» 12 px `text-slate-600`, så navnet på egen linje 14 px fet `text-slate-900` | «Du jobber for **Byggcon**», 14 px `text-slate-600`, navnet `text-slate-900 font-medium` |

Kontor («· Bodø» i skissen) tas ikke med nå.

### Innholdsflate

`<div class="flex-1 min-w-0">` med innhold `mx-auto w-full max-w-6xl px-5 py-6 lg:px-8 lg:py-8`. Siden bestemmer selv bredden inni (testskjemaet beholder `max-w-3xl`).

## 3. Startsiden `/arbeidskoe`

| Del | Tekst | Stil |
|---|---|---|
| `<main>` | | ingen egen marg (flaten gir den), `max-w-3xl` |
| Overskrift `h1` | «Arbeidskø» | 24 px (`text-2xl`) `font-semibold text-slate-900` |
| Hilsen | «Hei, {actor.name}.» | 16 px `text-slate-600`, `mt-1` |
| Kort, ansatt | `h2` «Ingenting venter på deg», så «Oppdrag og befaringer kommer her når rapportdelen er bygget.» | `Card` som i dag, `mt-6`. Setningen «Du jobber for …» fjernes fra kortet; den står nå i menyen |
| Kort, ikke ansatt | `h2` «Du er ikke registrert som ansatt», teksten som i dag | uendret |
| Lenken til testskjemaet | fjernes fra siden | står i menyen |

Produktnavnet over overskriften fjernes; det står i topplinjen.

Sidetittel (`metadata`) er uendret: «Arbeidskø – {produktnavn}».

## 4. Fargepar (lys visning) for kontrasttesten

Alle er regnet med WCAG-formelen og skal stå i `contrast.test.ts`. Krav: tekst minst 4,5:1, fokusring minst 3:1.

| Tekst / ring | Bakgrunn | Brukes til | Kontrast |
|---|---|---|---|
| `slate-900` #0f172a | `canvas` #eef2f7 | h1, navn i org-linjen (smal) | ca. 15,9:1 |
| `slate-900` #0f172a | hvit | korttekst, org-navn i kortet | ca. 17,9:1 |
| `slate-700` #334155 | `canvas` | menypunkt | ca. 8,9:1 |
| `slate-700` #334155 | hvit | menypunkt i raden (smal) | ca. 10,4:1 |
| `slate-600` #475569 | `canvas` | hilsen, «Prøver», «Du jobber for» | ca. 6,5:1 |
| `slate-600` #475569 | hvit | brødtekst i kortet, «Du jobber for» i kortet | ca. 7,6:1 |
| `brand-900` #16314d | `brand-100` #d6e4f2 | aktivt menypunkt | ca. 10,3:1 |
| `brand-900` #16314d | hvit | produktnavn | ca. 13,3:1 |
| hvit | `brand-600` #326ca1 | logo, initialer | ca. 5,5:1 |
| `brand-700` #285786 | `canvas` | Byggcon-blå som tekst (lenker) | ca. 6,4:1 |
| `brand-700` #285786 | hvit | Byggcon-blå som tekst (lenker) | ca. 7,5:1 |
| `brand-600` #326ca1 (ring) | `canvas` | fokusring | ca. 4,7:1 |
| `brand-600` #326ca1 (ring) | hvit | fokusring | ca. 5,5:1 |

Regler som følger av tabellen:
- **Byggcon-blå som tekst er `brand-700`, ikke `brand-600`.** `brand-600` som tekst på `canvas` gir bare ca. 4,7:1, for tett på grensen.
- **`slate-500` (#64748b) brukes ikke som tekst på `canvas`** (ca. 4,1:1, under kravet).
- Ingen endring i fargevariablene i `globals.css` trengs. Kommentaren der om at mørk visning «kommer i fase 0b» rettes til «fase 3».

`contrast.test.ts` leser verdiene for `canvas` og `brand-*` fra `globals.css`. Slate-fargene er Tailwinds egne og skrives inn som tall i testen.

## 5. Tastatur og skjermleser

- Tab-rekkefølge: produktnavn → «Logg ut» → «Arbeidskø» → «Testskjema uten nett» → innholdet. Topplinjen står først i koden på alle bredder.
- Landemerker: `banner` (topplinjen), `navigation` «Hovedmeny», `main` (fra siden). Ikke flere.
- Ingen «Hopp til innholdet»-lenke nå: tre lenker før innholdet og landemerkene er nok (WCAG 2.4.1). Vurderes når menyen vokser.
- Ingen informasjon bare med farge: aktivt punkt har både flate, fet skrift og `aria-current`.

## 6. Tilstander

| Tilstand | Hva vises |
|---|---|
| Ansatt i én organisasjon | ramme, «Du jobber for Byggcon», kortet «Ingenting venter på deg» |
| Ansatt i flere | «Du jobber for A, B» |
| Ingen ansattrad, sluttet eller slettet | ramme uten «Du jobber for», kortet «Du er ikke registrert som ansatt» |
| Ikke innlogget | sendes til `/logg-inn` (som i dag), ingen ramme |
| `/logg-inn`, `/dev/epost`, ikke funnet | ingen ramme (ligger utenfor `(ansatt)`) |

Ingen laste- eller feiltilstand: rammen tegnes på serveren.

## 7. Ikke med

Søk, varsler, «Alt er lagret», bytte EzProp/Optiplan, «Nytt oppdrag», «Kalender», tallkort, «Venter på deg»-panel, «Teamet i dag», tall ved menypunktene, kontor i org-linjen, mørk visning, menyknapp. Alt dette står i skissen, men hører til senere punkter i planen.
