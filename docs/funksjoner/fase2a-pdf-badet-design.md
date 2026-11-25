# Design: PDF-en av badet i Byggcons profil (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-pdf-badet.md`. Kortet er fasit for regler, data, tilgang og tester. Testplanen ligger i `docs/funksjoner/fase2a-pdf-badet-testplan.md`.
- **Design:** Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/`). Luften fra A «Fjord» (`docs/design/bilder/A-*.png`) gjelder for skjermene. Funn 8 i `docs/kartlegging/analyse-ivit-leilighetsrapport-2026-10-27.md` gjelder for sideskiftene.
- **Dato:** 24.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** hvert avvik har samme oppsett hver gang. TG står alltid med tekst, og kortene deles ikke slik at de ser slurvete ut. Utkastet viser det som mangler, på riktig sted.
  - **De ansatte:** ett trykk gir PDF-en. Fra utkastet kommer takstmannen med ett klikk tilbake til feltet.
  - **KI i bunnen:** oppsettet er laget for at forhåndsvisningen i 2b skal kunne bruke samme gjengivelse. Det er ingen KI-merking i PDF-en (A542).

Alle mål i PDF-en er i punkter (pt) eller millimeter (mm). Alle mål på skjermen er i px, og 1 px tilsvarer 1 pt på iPad.

---

## 1. Profilen `byggcon_standard` (kodedata, `src/core/pdf/profiles.ts`)

Profilen har bare utseende: ingen selskapsnavn og ingen fagtekst. Fargene skrives som `#rrggbb` og er de samme som tokenene i `globals.css`. Profilen kan ikke lese `globals.css`, fordi `src/core/pdf` er et rent blad. Det må derfor finnes en test som viser at verdiene er like.

| Felt | Verdi |
|---|---|
| `code` / `version` | `byggcon_standard` / `1` |
| `orientation` | `portrait`, A4 (210 × 297 mm) |
| Marger | topp 18 mm, bunn 22 mm (bunntekst i 12 mm av dem), venstre og høyre 18 mm. Innholdsbredde 174 mm. |
| `colors.text` | `#0f1924` (night) |
| `colors.muted` | `#5d6774` (stone). Kontrast 5,7:1 mot hvit og 4,8:1 mot sand. |
| `colors.accent` | `#316aa0` (fjord). Bare streker, aldri tekst. |
| `colors.link` | `#255a8c` (fjord-dark). Kontrast 7,2:1 mot hvit. |
| `colors.panel` | `#eeebe3` (sand) |
| `colors.line` | `#c6c3bb` (line-strong). `line` er for svak på papir. |
| `colors.page` | `#ffffff`. Snow brukes ikke som sidefarge, fordi den bruker blekk og gjør filen større. |
| `colors.watermark` | `#e7e9ec` (night ca. 8 % på hvit). Night-tekst oppå holder 14:1 og stone-tekst 4,7:1. |
| `colors.tg` | Flate og tekst: `tg0`/`tg1` `#cdeedd`/`#155e3e`, `tg2` `#fbe7b5`/`#6b4405`, `tg3` `#f8d0cc`/`#8b2a1f`, `tgiu` `#e4e1d8`/`#4a463f`. Strek (venstrekant på avvikskort): `#1f8a5b`, `#b7791f`, `#c0392b`, `#6e6a62`. |
| `colors.marking` | `#c0392b` med hvit kant på 1 pt, slik at markeringen synes både på lyse og mørke bilder. |
| `fonts` | Brødtekst: Inter 400/500/600/700. Overskrifter: Schibsted Grotesk 600/700. Filene ligger i `public/fonts` (OFL). |
| `logo` | `public/brand/byggcon-logo.png` |
| `sections` | `cover`, `toc`, `summary` (reservert, hoppes over i 2a-2), `tg_explanation`, `room`, `missing` (bare i utkast) |
| `footer` | mal: `{company} · {orgNumber}` · `{assignmentNumber}` · `Side {page} av {pages}` |

**Testprofilen** finnes bare i testene. Den er liggende A4 med aksent `#1f5f4a` og annen panelflate (`#e6efe9`). Den har samme tekst, slik at testen kan vise at bare sidestørrelsen og fargene endres.

### 1.1 Skriftskala

| Rolle | Skrift | Størrelse / linjeavstand | Farge |
|---|---|---|---|
| Forsidetittel | Schibsted Grotesk 700 | 32 / 38 pt | text |
| Del (H1: «Innhold», «Slik leser du TG», «Bad · 1. etasje») | Schibsted Grotesk 700 | 20 / 26 pt, 10 pt luft under | text |
| Kontrollpunkt (H2) | Schibsted Grotesk 600 | 13,5 / 18 pt | text |
| Underoverskrift i kort (H3: «Årsak», «Tiltak») | Inter 600 | 10 / 14 pt | text |
| Brødtekst | Inter 400 | 10 / 14,5 pt | text |
| Etikett i svar og faktaboks | Inter 500 | 9,5 / 13 pt | muted |
| Bildetekst, bunntekst | Inter 400 | 8,5 / 12 pt | muted |
| TG-merke | Inter 600 | 9 pt, 16 pt høyt | tg-tekst på tg-flate |

Brødteksten er venstrejustert og ikke blokkjustert. Orddeling er på (`nb`) for brødtekst, men aldri for overskrifter, tall, kronebeløp, TG-merker og oppdragsnummer.

### 1.2 Former

- **Kort:** hvit flate, kant 0,75 pt i `line`, hjørner 9 pt (tilsvarer 12 px), indre luft 12 pt. Ingen skygge og ingen fargeoverganger.
- **Panel:** flate i `panel`, uten kant, hjørner 9 pt og indre luft 12 pt. Brukes til faktaboksen på forsiden og til TGIU.
- **TG-merke:** pille med hjørner 8 pt, 16 pt høy og 6 pt luft på sidene. Merket viser alltid tekst. Lang form i avvikskort og punkthode: «TG3 Store eller alvorlige avvik». Kort form er bare i innholdsfortegnelsen. TG0 og TG1 har samme farge, og teksten skiller dem.
- **«Ikke satt»** (bare i utkast): pille i samme størrelse som TG-merket, men hvit flate, stiplet kant på 1 pt i `text` og teksten «Ikke satt». Den skal ikke kunne forveksles med TGIU, som er grå og helt fylt.

---

## 2. Sidene i rekkefølge

### 2.1 Forside (`cover`)

```
┌──────────────────────────────────────────────┐
│ [logo 14 mm høy]                     UTKAST* │  * bare i utkast, Inter 700 10 pt, text
│                                              │
│                                              │  (luft 60 mm)
│ Tilstandsrapport                    (32 pt)  │
│ Storgata 12, 8006 Bodø*             (16 pt)  │  * oppdiktet eksempel
│ Gnr. 138, bnr. 2001                 (11 pt)  │  muted
│ ───────── 40 mm strek i accent, 2 pt         │
│                                              │
│ ┌ panel ───────────────────────────────────┐ │
│ │ Oppdragsnummer    26-1042                │ │  etikett muted 9,5 pt / verdi 11 pt 600
│ │ Befaringsdato     12.11.2026             │ │  etikettkolonne fast 45 mm
│ │ Utført av         Byggcon Nord AS        │ │  selskapets navn, ikke organisasjonens brand_name
│ └──────────────────────────────────────────┘ │
│                                              │
│ (bunntekst som på andre sider)               │
└──────────────────────────────────────────────┘
```

- Forsiden har ikke navn på eier, bestiller, megler eller takstmann, og ingen bilder før 2a-3.
- Er befaringsdatoen ikke satt, vises raden ikke. Funnet `inspection_date_missing` står da på siden «Ikke med i PDF-en».
- Mangler det juridiske selskapet, står «Utført av» ikke på forsiden. Bunnteksten sier fra (se 2.6).
- Forsiden har ikke vannmerke, fordi «UTKAST» står øverst til høyre. Alle andre sider har vannmerke (2.7).

### 2.2 Innholdsfortegnelse (`toc`)

- H1 «Innhold». Én linje per del og per kontrollpunkt med innhold, og innrykk på 12 pt for punktene.
- Linjen har teksten, deretter prikker i `line`, og sidetallet høyrestilt i fast kolonne på 12 mm. Hele linjen er en intern lenke (`GoTo`), også i endelig PDF, fordi den peker inne i dokumentet og ikke til skjemaet.
- Kontrollpunktene har kort TG-merke («TG3») foran sidetallet. Har punktet ingen TG, står det ikke noe merke der.
- Deler uten innhold er ikke med. Siden «Ikke med i PDF-en» er med bare i utkast.
- En linje i fortegnelsen deles aldri over to sider.

### 2.3 Slik leser du TG (`tg_explanation`)

- H1 «Slik leser du TG». Én rad per grad: TG-merke i lang form i en fast kolonne på 62 mm, og forklaringen fra `ReportPdfData` til høyre. Radene skilles med en strek på 0,5 pt i `line`.
- Rekkefølgen er TG0, TG1, TG2, TG3, TGIU. Deretter kommer setningen om HMS i brødtekst, uten merke.
- Delen holdes samlet på én side.

### 2.4 Badet (`room`)

H1 «Bad · 1. etasje» (romnavnet og etasjen fra dataene). Etter H1 kommer kontrollpunktene i malens rekkefølge.

**Kontrollpunkt:**

```
Våtromsmembran og tettesjikt                         [TG3 Store eller alvorlige avvik]
Rett i skjemaet ›   (bare utkast, link-farge 9 pt, understreket)
Beskrivelse i brødtekst …

┌ svar (fast tabell, ingen kant) ──────────────────────────────┐
│ Hull tatt                     Ja                              │  etikett 60 mm muted / verdi text
│ Fuktmåling                    12,4 vekt-%                     │  tall og enhet udelelig
└──────────────────────────────────────────────────────────────┘
[avvikskort …]
[TGIU-panel …]
```

- Punkthodet har H2 til venstre og TG-merket høyrestilt på samme linje. Blir tittelen lang, brytes den, og merket står på første linje. Merket kan aldri deles.
- Punktet har ikke TG-merke når `gives_tg = false`, og heller ikke når punktet bare har HMS-avvik og ikke krever TG.
- Svarene står i en fast tabell med 4 pt luft mellom radene. Tomme svar har ingen rad. Uten svar finnes ingen tabell.
- Det er 18 pt luft mellom punktene og en skillestrek på 0,5 pt i `line` over hvert punkt, unntatt det første.

**Avvikskort** (én enhet, se sideskift i 3):

```
┃┌──────────────────────────────────────────────────────────┐
┃│ [TG3 Store eller alvorlige avvik]      Rett i skjemaet › │  lenken bare i utkast
┃│ Avviksteksten i brødtekst …                               │
┃│                                                          │
┃│ Årsak        Fukt / lekkasje. Tekst …                    │  fast etikettkolonne 32 mm
┃│ Konsekvens   Tekst …                                     │
┃│ Tiltak       1. Første tiltak                            │  nummerert i lagret rekkefølge
┃│              2. Andre tiltak                             │
┃│ Kostnad      20 000–100 000 kr                           │  fra costDisplayText, udelelig
┃│                                                          │
┃│ [bilde 84 mm] [bilde 84 mm]                              │  to per rad, 6 mm mellomrom
┃│ Bildetekst    Bildetekst                                 │
┃└──────────────────────────────────────────────────────────┘
 venstrekant 3 pt i TG-strekfargen (HMS: ingen farget kant, bare line)
```

- Kortet er et kort som i 1.2. Venstrekanten på 3 pt har TG-strekfargen. Fargen er bare en ekstra hjelp, fordi TG alltid står i merket.
- **HMS-avvik:** i stedet for TG-merket står en flat pille i `panel` med teksten «HMS». Kanten er `line`, ikke farget.
- **Avvik `kind = tg` uten TG (utkast):** «Ikke satt»-pillen der TG-merket skulle stått.
- Etikettene «Årsak», «Konsekvens», «Tiltak» og «Kostnad» står i en fast kolonne på 32 mm (Inter 600 10 pt). Er feltet tomt, finnes ikke raden. Har avviket ingen tiltak, finnes ikke etiketten «Tiltak».
- Årsaken står som `<kriterium>. <tekst>`. «Annet» står aldri alene.
- **Bilder:** de står rett under radene. To bilder per rad, hvert 84 mm bredt og høyst 63 mm høyt (4:3), beskåret til midten innenfor rammen. Et bilde alene på en rad står til venstre i samme størrelse. Bildeteksten står under bildet (8,5 pt muted). Markeringen er et vektorlag oppå bildet: strek på 2 pt i `marking` med hvit kant på 1 pt, og formene sirkel, rektangel og pil. Bildet og bildeteksten deles aldri.

**TGIU-panel:**

```
┌ panel (sand) ────────────────────────────────────────────┐
│ [TGIU Ikke undersøkt]                                    │
│ Hva og hvorfor       Tekst …                             │  etikettkolonne 45 mm
│ Risiko               Tekst …                             │
│ Hva som må til       Tekst …                             │
│ Annen fuktkontroll   Tekst …     (bare wet_room.adjacent) │
│ Resultat             Tekst …                             │
│ Skadeutsatt konstr.  Tekst …                             │
│ Eier er informert om utvidet ansvar.  (bare når sann)    │
└──────────────────────────────────────────────────────────┘
```

- Etiketten er alltid «TGIU» og aldri «IU».
- Panelet holdes samlet.

### 2.5 Ikke med i PDF-en (`missing`, bare i utkast, F3)

- Siden kommer alltid sist. H1 er «Ikke med i PDF-en», og under står én linje i brødtekst: «Dette står ikke i rapporten ennå. Siden er bare med i utkastet.»
- **Først kommer funnene som gjelder hele rapporten.** Hvert funn er en linje med stoppikonet (8-kant, 10 pt, text) og teksten fra publiseringssjekken.
- **Deretter kommer «Punkter uten innhold»** (H2). Det er én linje per kontrollpunkt med etiketten fra malen og «Rett i skjemaet ›». Kodene vises aldri.
- Står det ingenting på siden, lages den ikke.

### 2.6 Bunntekst (hver side, også forsiden)

```
───────────────────────────────────────────────────────────────── 0,5 pt line
Byggcon Nord AS · org.nr. 912 345 678        26-1042          Side 3 av 7
```

- Bunnteksten er Inter 8,5 pt i muted, 6 pt under en strek over hele innholdsbredden.
- Den har tre faste kolonner: venstre 100 mm, midten 34 mm (sentrert) og høyre 40 mm (høyrestilt). Teksten deles aldri. Blir selskapsnavnet for langt, kortes det med «…», og org.nr. står alltid med.
- **Mangler selskapet,** står «Juridisk selskap mangler på oppdraget» i venstre kolonne i `text` og Inter 600. Det gjelder også PDF-en av en utgivelse.
- Bunnteksten er merket som gjenstand (artifact) i den taggede PDF-en, slik at skjermleseren ikke leser den på hver side.

### 2.7 Utkastmerking (bare `draft: true`)

- **Vannmerke:** «UTKAST» står diagonalt (45°) midt på siden, i Schibsted Grotesk 700 110 pt og fargen `watermark`. Det tegnes under innholdet og er merket som gjenstand. Det står på alle sider unntatt forsiden.
- **Topplinje:** «UTKAST – ikke send til kunde» øverst til venstre i Inter 700 8,5 pt `text`, på hver side, også på forsiden ved siden av logoen. Det er denne teksten som leses opp og som testene finner per side.
- Det er ikke brukt rødt, fordi rødt betyr TG3.

### 2.8 Merkene fra publiseringssjekken (bare utkast, F8)

Merkene har samme utseende som sperrene og advarslene på publiseringsskjermen (`blocker-item.tsx`): ikke rødt eller gult, fordi de fargene er TG.

| Funn | Plassering | Utseende |
|---|---|---|
| `mandatory_without_tg` | i stedet for TG-merket på punktet eller avviket | «Ikke satt»-pillen (1.2) |
| Andre sperrer | linje rett under punkthodet eller øverst i avvikskortet | 3 pt venstrekant i `text`, stoppikon, «Mangler: <tekst fra sjekken>» i Inter 600 9,5 pt |
| Advarsler | samme sted, under eventuelle «Mangler» | 3 pt venstrekant i `line`, i-ikon, «Sjekk: <tekst fra sjekken>» i Inter 400 9,5 pt |
| Funn på hele rapporten | øverst på siden «Ikke med i PDF-en» | som «Mangler» |

Hver linje har «Rett i skjemaet ›» til høyre (F4).

### 2.9 Lenker (F4, bare utkast)

- Teksten er «Rett i skjemaet ›» i Inter 500 9 pt i `link`, understreket.
- Lenkeflaten er minst 24 pt høy og like bred som teksten pluss 4 pt luft, slik at den er lett å treffe på iPad.
- Adressen har bare id-er. Lenken har alternativ tekst (`/Contents`) «Rett <punktets etikett> i skjemaet», slik at skjermleseren sier hvor den går.
- Endelig PDF har ingen slike lenker og ingen tekst «Rett i skjemaet».

---

## 3. Sideskift (F2)

1. Et avvikskort holdes samlet hvis det får plass på én side. Hvis det ikke får plass der det står, begynner det på neste side.
2. Er kortet lengre enn en side, kan det deles bare mellom radene (Årsak, Konsekvens, Tiltak, Kostnad, bilderaden). En rad holdes sammen med minst to linjer, og ingen rad står med etiketten alene. Fortsettelsen begynner med en linje i muted 8,5 pt: «<punktets etikett> · avvik, fortsetter». Kanten og venstrekanten fortsetter.
3. H1 og H2 holdes sammen med minst to linjer av det som følger. Ingen side slutter med en overskrift (strukturtest).
4. En bilderad, et TGIU-panel, en rad i svartabellen og en linje i innholdsfortegnelsen deles aldri.
5. Kostnad, TG-merker, tall med enhet og oppdragsnummer settes som udelelige enheter. Orddelingen hopper over dem.
6. Kolonnebreddene er faste (32, 45, 60 og 62 mm som over), så ingen etikett brytes fordi teksten ved siden av er lang.
7. Enker og foreldreløse linjer: minst to linjer øverst og nederst i brødtekst.

---

## 4. Universell utforming i PDF-en

- PDF-en er tagget hvis motoren støtter det, med `lang=nb`. Tittelen vises i stedet for filnavnet (`DisplayDocTitle`).
- Lesingen følger rekkefølgen forside, innhold, TG-forklaring, rom og utkastside. Vannmerke, bunntekst og pynt er gjenstander (artifacts).
- Overskriftene er ekte H1 og H2, slik at bokmerkene og skjermleseren kan bruke dem. Bokmerkene (outline) følger innholdsfortegnelsen.
- Bildene har alternativ tekst. Det er bildeteksten når den finnes, ellers «Bilde til avvik på <punktets etikett>».
- Kontrastkravet er minst 4,5:1 på all tekst, også muted-tekst på sand og oppå vannmerket (se tabellen i 1). TG står alltid med tekst.

---

## 5. Skjermene

### 5.1 Knappen «Lag PDF (utkast)» (`src/app/(ansatt)/oppdrag/[id]/draft-pdf-button.tsx`)

Én klientkomponent brukes på både badet og oppdraget. Tekstene ligger i `src/app/(ansatt)/oppdrag/[id]/pdf-texts.ts`. Knappen bruker `buttonVariants({ variant: "secondary", size: "md" })`, altså en pilleknapp med mørk kant og høyde 44 px. Den har et dokumentikon på 18 px (inline-SVG, `aria-hidden`) foran teksten. Den er aldri hovedknapp.

| Tilstand | Element | Tekst | Detaljer |
|---|---|---|---|
| Klar, ingenting venter | `<a href="/oppdrag/<id>/pdf" target="_blank" rel="noopener">` | «Lag PDF (utkast)» | Navnet er den synlige teksten. Etter teksten står et skjult tillegg: «(åpnes i ny fane)». |
| Venter på lagring | `<button>` | «Lagrer endringer …» | Fanen åpnes i samme trykk (`window.open("about:blank")`), og adressen settes når lagringen er ferdig. `aria-disabled="true"` |
| Lager | `<button disabled>` | «Lager PDF …» | Spinner på 16 px med `aria-hidden`. Statusen leses opp via `role="status"` (`sr-only`). Den fjernes når fanen er åpnet. |
| Uten nett | `<button disabled>` | «Lag PDF (utkast)» | Under knappen står «Krever nett. PDF-en kan lages når du er på nett igjen.» i 14 px `text-slate-700`, koblet med `aria-describedby`. |
| Lagring feilet | `<button>` | «Lag PDF (utkast)» | Fanen lukkes. Over knappen står en `Notice` med feiltonen: «Endringene ble ikke lagret. PDF-en ble ikke laget.» Fokus flyttes til meldingen. |

- **Badet** (`/oppdrag/[id]/rom/[roomId]`): knappen står i topplinjen til høyre, mellom fremdriften og «Se over og publiser», med 12 px mellomrom. I iPad-størrelse brytes topplinjen til en ny rad. Knappen står aldri i hovedknappfeltet nederst, og den dekker det ikke.
- **Oppdraget** (`/oppdrag/[id]`): knappen står i kortet der rapporten vises, ved siden av lenken til badet. Den vises bare når rapporten finnes og ikke er `superseded`.

### 5.2 «Åpne PDF» på utgivelser (F7)

- **Utgivelseskortet** (`releases-card.tsx`): hver `li` blir et rutenett med to kolonner, `<details>` (flex-1) og lenken. Lenken står utenfor `<summary>`, fordi en lenke inni `summary` gir uklar fokus og opplesing. Lenken står øverst til høyre på samme høyde som versjonsraden, med `pr-6 pt-1.5`.
- Lenken er `<a target="_blank" rel="noopener">` med `buttonVariants({ variant: "secondary", size: "md" })` og teksten «Åpne PDF». Tilgjengelig navn: «Åpne PDF av versjon <n> (åpnes i ny fane)».
- **Kvitteringen etter publisering** (`publiser/`): «Åpne PDF» står som sekundærknapp ved siden av hovedhandlingen i kvitteringen. Hovedhandlingen er fortsatt én.

### 5.3 Feilsidene fra ruten (statisk HTML, ingen skript)

Feilsidene er én enkel side med `<style>` i hodet. CSP tillater det i dag. Siden har snow-bakgrunn, et hvitt kort (hjørner 12 px, kant `#dfdcd4`, maks bredde 480 px, luft 32 px), Inter med systemskrift som reserve og `lang="nb"`.

| Svar | Overskrift (h1, 24 px) | Tekst | Lenke |
|---|---|---|---|
| 500 | «PDF-en kunne ikke lages. Prøv igjen.» | – | «Prøv igjen» (samme adresse, pilleknapp i night med hvit tekst, 44 px) |
| 404 | «Fant ikke rapporten» | «Den finnes ikke, eller du har ikke tilgang.» | «Til arbeidskøen» (sekundær) |
| 429 | «En PDF lages allerede. Vent litt og prøv igjen.» | – | «Prøv igjen» |

- Sidene skriver aldri ut verdier fra adressen eller feilen.
- Fokusringen er 2 px fjord med 2 px luft.

---

## 6. Tekster (samlet, til `pdf-texts.ts` og profilens oppsett)

| Nøkkel | Tekst |
|---|---|
| `cover.title` | Tilstandsrapport |
| `cover.assignmentNumber` / `inspectionDate` / `company` | Oppdragsnummer / Befaringsdato / Utført av |
| `toc.heading` | Innhold |
| `tgExplanation.heading` | Slik leser du TG |
| `deviation.cause` / `consequence` / `measures` / `cost` | Årsak / Konsekvens / Tiltak / Kostnad |
| `deviation.hms` | HMS |
| `deviation.continued` | `<etikett>` · avvik, fortsetter |
| `draft.banner` | UTKAST – ikke send til kunde |
| `draft.watermark` | UTKAST |
| `draft.notSet` | Ikke satt |
| `draft.missing` / `draft.check` | Mangler: … / Sjekk: … |
| `draft.link` | Rett i skjemaet › |
| `missing.heading` / `missing.intro` / `missing.empty` | Ikke med i PDF-en / Dette står ikke i rapporten ennå. Siden er bare med i utkastet. / Punkter uten innhold |
| `footer.noCompany` | Juridisk selskap mangler på oppdraget |
| `footer.page` | Side {x} av {y} |
| `meta.titleDraft` / `meta.titleRelease` | UTKAST – Tilstandsrapport {nr} / Tilstandsrapport {nr}, versjon {n} |
| `button.create` / `saving` / `creating` / `offline` | Lag PDF (utkast) / Lagrer endringer … / Lager PDF … / Krever nett. PDF-en kan lages når du er på nett igjen. |
| `button.saveFailed` | Endringene ble ikke lagret. PDF-en ble ikke laget. |
| `release.open` / `release.openLabel` | Åpne PDF / Åpne PDF av versjon {n} (åpnes i ny fane) |
| `error.500` / `error.404` / `error.429` / `error.retry` | se 5.3 |

---

## 7. Endringer i designsystemet

- **Ingen ny komponent i `src/shared/ui`.** Knappen gjenbruker `buttonVariants` og feilmeldingen gjenbruker `Notice`. TG-tekstene til PDF-en lages av den samme oversettelsen av koder som `TgBadge` bruker, og skrives ikke på nytt.
- **Én test** (`src/core/pdf/profile-tokens.test.ts`, eller i `src/app/(ansatt)/contrast.test.ts`) viser at fargene i `byggcon_standard` er de samme som tokenene i `globals.css`, og regner ut kontrasten i tabellen i 1.

## 8. Hva Ståle ser

Ståle ser utseendet når 2a-2 er ferdig («Ståle har sett den»). Ingen av valgene her endrer Ståles beslutninger. Fargene, størrelsene og rekkefølgen er data i profilen og kan justeres uten ombygging.
