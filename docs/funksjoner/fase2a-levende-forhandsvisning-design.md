# Design: Levende forhåndsvisning av badet på PC (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-levende-forhandsvisning.md`. Kortet er fasit for data, tilgang, tak, svar og tester. Ved motstrid gjelder kortet.
- **Fasit for utseende:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-konstr-pc.png`), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/`). Sidene selv er PDF-utkastet fra `docs/funksjoner/fase2a-pdf-badet-design.md` og endres ikke her.
- **Laget av:** ui-designer, 25.11.2026.
- **Beslutninger:** ingen nye A-numre. Alt under er utforming innenfor A603–A612 (kortet). Numrene A603–A612 er tatt av denne branchen; neste ledige er A613 (tilstandsfilen 25.11.2026).
- **Støtter hovedmål:**
  - **De ansatte:** siden står ved siden av feltet, følger med når hun bytter felt, og ett klikk fører tilbake til feltet. Ingen ny fane, ingen bla.
  - **Færre reklamasjoner:** «Ikke satt», «Mangler» og «Sjekk» ses mens hun skriver, og «Neste mangel» tar henne gjennom dem.
  - **KI i bunnen:** ventende KI-forslag står i margen i tonen «hav», utenfor siden, så de ikke glemmes. Ingen KI i gjengivelsen.

Alle mål er i px (1 px = 1 pt på iPad). Bare tokens som finnes i `globals.css`; ingen nye farger, ingen faste hex-verdier i komponentene.

---

## 1. Avvik fra A

- **Romlisten foldes inn** til en stripe mens ruten er på (A609, godkjent av prosjektlederen i kortet). Med ruten av er badet som i dag.
- Ruten står der A har høyre kolonne på PC (bilder, fraser). Ingen andre avvik.

## 2. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `Switch` får valgfri `className` (så den kan være smal i verktøylinjen, `w-auto`) | `src/shared/ui/switch.tsx` | endret, bakoverkompatibel |
| `LivePreviewToggle` (bryteren i verktøylinjen) | `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/live-preview-toggle.tsx` | ny |
| `LivePreviewPane` (ruten: hode, sider, status) | `…/[roomId]/live-preview-pane.tsx` | ny |
| `PreviewPage` (ett `<img>` med avsnittsknapper og margmerker) | `…/[roomId]/preview-page.tsx` | ny |
| `PaneSeparator` (skillet som kan dras) | `…/[roomId]/pane-separator.tsx` | ny |
| `CollapsedRoomList` (stripen) | `…/[roomId]/collapsed-room-list.tsx` | ny |
| `live-preview-texts.ts` (alle tekstene i avsnitt 10) | `…/[roomId]/live-preview-texts.ts` | ny |
| `room-view.tsx` (oppsett med og uten rute) | `…/[roomId]/room-view.tsx` | endret |

Gjenbrukes: `Switch`, `Button`/`buttonVariants`, `Badge`, `Notice`, KI-merkets ikon fra `AiTextMark`. Ingen ny komponent i `src/shared/ui` utover `className` på `Switch`: komponentene over hører bare til badskjermen. Når hele rapporten får ruten (2a-3), flyttes de til `src/app/(ansatt)/oppdrag/[id]/`.

## 3. Bryteren «Forhåndsvisning» (`LivePreviewToggle`)

```
┌ Toppfelt (som i dag) ───────────────────────────────────────────────────────────────────────┐
│ ‹  Oppdrag 26-1042 · Tilstandsrapport     Forhåndsvisning [●○] Av   [Lag PDF (utkast)]  …   │
│    Våtrom › Bad, 1. etasje                                                [Lagret 10:42]    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Står først i høyregruppen i toppfeltet, foran «Lag PDF (utkast)». «Lag PDF (utkast)» flyttes ikke og endres ikke.
- `Switch` med `id="live-preview-switch"`, etikett «Forhåndsvisning», tilstanden «Av»/«På» som tekst (som i dag). `className="w-auto"`. Høyde minst 44 px. `aria-controls="live-preview"` når ruten finnes.
- **Vises bare** når `matchMedia("(min-width: 1280px) and (pointer: fine)")` er sann. Serveren og første gjengivelse viser ingenting (ingen hopp på iPad). Endres mediet mens ruten er på (vinduet gjøres smalt), tas ruten bort og romlisten kommer tilbake; valget i nettleseren står.
- Vises der «Lag PDF (utkast)» vises (samme vilkår), og ikke før rapporten er startet.
- Trykk på: ruten åpnes, fokus **blir på bryteren** (ruten tar aldri fokus selv), og `aria-live` sier «Forhåndsvisningen er slått på.». Hendelsen skrives bare ved trykk (A608).
- Trykk av: ruten fjernes, `blob:`-adresser frigis, romlisten kommer tilbake, `aria-live` sier «Forhåndsvisningen er slått av.».

## 4. Oppsett med ruten på (fra 1280 px)

```
┌ Toppfelt (sticky) ──────────────────────────────────────────────────────────────────────────┐
└─────────────────────────────────────────────────────────────────────────────────────────────┘
┌──┐┌ Punktet (snow) ─────────────────────┐ ┊ ┌ Ruten (sand) ────────────────────────────────┐
│≡ ││ Vanntett sjikt, membran og sluk      │ ┊ │ Forhåndsvisning  [Utkast]                    │
│3/8││ …kortene som i dag…                 │ ┊ │ Viser sist lagrede tekst · Oppdateres …      │
│  ││                                      │ ┊ │ 3 ting å se på        [‹ Forrige] [Neste ›]  │
│  ││                                      │ ⁞ ├──────────────────────────────────────────────┤
│  ││                                      │ ┊ │ Side 2 av 5                                  │
│  ││                                      │ ┊ │  ▶┌───────────────────────┐ ┌──────────────┐ │
│  ││                                      │ ┊ │   │ (sidebilde, hvitt)     │ │✦ KI-forslag  │ │
│  ││                                      │ ┊ │   │   ┏━━━━━━━━━━━━━━━━┓   │ │  venter      │ │
│  ││                                      │ ┊ │   │   ┃ Årsak  …       ┃   │ └──────────────┘ │
│  ││                                      │ ┊ │   │   ┗━━━━━━━━━━━━━━━━┛   │                  │
│  │├──────────────────────────────────────┤ ┊ │   └───────────────────────┘                  │
│  ││ Nedre linje      [Ferdig med punktet]│ ┊ │ Side 3 av 5 …                                │
└──┘└──────────────────────────────────────┘ ┊ └──────────────────────────────────────────────┘
 56          minst 600                      16              standard: resten, høyst 820
```

- **Rekkefølge i DOM-en og i fokus:** stripe → skjema (med nedre linje) → skille → rute. Ruten ligger etter skjemaet (A611).
- **Stripe** (`CollapsedRoomList`): 56 px bred, flate `sand`, sticky som listen i dag. Én knapp (44 × 56 px): listeikon (`aria-hidden`) og «3/8» i `text-sm` under. Tilgjengelig navn «Vis punktene, 3 av 8 ferdig». Åpner den samme `<dialog>` som «Punkter» på iPad (`listDialog`). Ingen ny liste.
- **Skjema:** samme kolonne som i dag (`max-w-190`, sentrert), minst 600 px.
- **Rute:** sticky under toppfeltet (`top-28`, `h-[calc(100dvh-7rem)]`), egen rulling for sidene. Flate `sand`, ingen kant og ingen skygge (den flyter ikke). Sidene er hvite på sand.
- **Bredde:** tilgjengelig = vindusbredde − 56 − 16. Standard rutebredde = `min(820, tilgjengelig − 600)`. Minst 400, høyst `tilgjengelig − 600`. Den lagrede bredden klemmes inn i grensene ved innlasting og når vinduet endres. Ved 1280 px gir det rute 608 og skjema 600; ved 1440 px rute 768.

## 5. Skillet (`PaneSeparator`)

- 16 px bred trykkflate over hele rutens høyde. Synlig: strek på 1 px i `line-strong` midt i, og et grep på 4 × 32 px i `stone` med 2 px hjørner midt på høyden. Peker `col-resize`.
- `role="separator"`, `aria-orientation="vertical"`, `aria-controls="live-preview"`, `aria-label="Bredde på forhåndsvisningen"`, `aria-valuemin`/`aria-valuemax`/`aria-valuenow` i px, `aria-valuetext="608 piksler"`. `tabIndex=0`, fokusring 2 px `fjord` med 2 px luft.
- Mus: dra. Tastatur: venstre pil gjør ruten 32 px bredere, høyre pil smalere (skillet flytter seg samme vei som pilen), med Shift 128 px. Home = bredest, End = smalest. Bredden lagres når draget slipper eller etter tastetrykk (ett `localStorage`-skriv per slipp, ikke per piksel).
- Ingen animasjon på bredden.

## 6. Ruten (`LivePreviewPane`)

`<aside id="live-preview" aria-labelledby="live-preview-heading">` (landemerke «complementary»).

### 6.1 Hode (sticky øverst i ruten, flate `sand`, kant `line` under, luft 12 px)

1. Lenken «Hopp over forhåndsvisningen» først, `sr-only` til den får fokus (da synlig som sekundær pilleknapp). Flytter fokus til et tomt mål sist i ruten (`tabIndex=-1`), slik at neste Tab går videre ut av ruten.
2. `h2` «Forhåndsvisning» (Schibsted Grotesk, `text-lg font-semibold`) og `Badge` «Utkast» ved siden av (flat, sand-tone, uten kant).
3. Statuslinje (`text-sm text-slate-700`, én linje, tom når alt er i orden): se 6.4.
4. «Neste mangel»: teksten til venstre, `Button variant="secondary" size="md"` «‹ Forrige» og «Neste ›» til høyre (44 px). Se 7.

### 6.2 Sidene (`PreviewPage`)

- Over hver side: «Side 2 av 5» i `text-sm text-stone`, `aria-hidden` (bildet sier det samme).
- Siden: `<img alt="Side 2 av 5">` med `width:100%` og `aspect-ratio: widthPt / heightPt` satt før bildet er lastet, så ingenting hopper. Hvit, kant 1 px `line-strong`, ingen hjørner (det er et ark, ikke et kort), ingen skygge. Høyst 794 px bred (A4 i 100 % på skjerm); bredere rute gir luft på sidene.
- Avstand mellom sidene 24 px. Luft i ruten: 12 px på sidene.
- **Venstre marg 20 px** for «her»-pilen (6.3). **Høyre marg 104 px** for KI-merkene (8), alltid der, så siden ikke hopper når et forslag kommer eller går. Mellomrom 8 px mellom siden og høyre marg.
- Sidene er aldri innebygd SVG i DOM-en, bare `<img>` (kortet).

### 6.3 Avsnittsknappene (laget over bildet etter `pageMap`)

Ett `<button type="button">` per rad i `pageMap`, posisjonert absolutt i prosent av sidens størrelse (`x/widthPt`, `y/heightPt` …), slik at de følger skaleringen. Ukjent anker (funksjonen gir `null`) gir ingen knapp.

| Tilstand | Utseende |
|---|---|
| Hvilende | usynlig (gjennomsiktig, ingen kant). Peker `pointer`. |
| Hover | kant 1 px `fjord` og flate `fjord` 6 % (`bg-fjord/6`), hjørner 4 px |
| Fokus (tastatur) | ring 2 px `fjord` med 2 px luft |
| Her skriver du (feltet med fokus i skjemaet) | ring 3 px `night` og pil ▶ i `night` i venstre marg på samme høyde (`aria-hidden`). Knappen får `aria-current="location"`. Synlig uten farge: tykk ramme og pil. |
| Nettopp lagret | flate `sand` 60 % i 1,2 s, så bort med 300 ms uttoning. Redusert bevegelse: vises i 1,2 s og fjernes uten uttoning. |

- **Navn** (bygges i klienten av skjemadataene, aldri av ankeret alene):

| `kind` | Navn |
|---|---|
| `checkpoint` | «Gå til {punkt}» |
| `checkpoint.description` | «Gå til beskrivelsen under {punkt}» |
| `checkpoint.answer` | «Gå til {feltets etikett} under {punkt}» |
| `deviation` | «Gå til avvik {n} under {punkt}» |
| `deviation.text` | «Gå til avviksteksten, avvik {n} under {punkt}» |
| `deviation.cause` / `consequence` / `measures` / `cost` | «Gå til årsak / konsekvens / tiltak / kostnad, avvik {n} under {punkt}» |
| `tgiu` | «Gå til TGIU under {punkt}» |

  Har raden `mark`, legges merket til: «…, Ikke satt», «…, Mangler» eller «…, Sjekk». Avsnitt over to sider: andre del får «…, fortsetter».
- **Klikk eller Enter/mellomrom:** samme vei som lenkene i PDF-utkastet (F4): punktet åpnes, feltet får fokus. Skrivebeskyttet felt får fokus og vises skrivebeskyttet som i dag (A610).
- **Følge feltet:** når fokus i skjemaet går til et nytt felt, rulles ruten slik at avsnittet står med 48 px luft over seg, men bare hvis det er utenfor synsfeltet. Myk rulling; med `prefers-reduced-motion` uten myk rulling. Ruten flytter aldri fokus.

### 6.4 Tilstander

Alle statusmeldinger går gjennom ett `role="status" aria-live="polite"`-område i ruten (`sr-only`), i tillegg til den synlige statuslinjen.

| Tilstand | Statuslinjen | I sideområdet |
|---|---|---|
| Laster første gang | «Lager sidene …» | Ett tomt ark i A4-forhold, hvit med kant, uten animasjon |
| Oppdateres | «Oppdateres …» | Sidene står som før, ingen dimming og ingen blinking |
| Eldre enn skjemaet (felt i kø, uten nett eller med feil i lagringskøen) | «Viser sist lagrede tekst» | Sidene står |
| Uten nett | – | `Notice` (nøytral): «Forhåndsvisningen trenger nett. Skjemaet lagres som vanlig.» Sidene som er lastet, står, med «Viser sist lagrede tekst». |
| Feil (500 etter 3 forsøk, 429 etter 3 forsøk) | – | `Notice` (feiltone): «Forhåndsvisningen kunne ikke lages.» og `Button variant="secondary"` «Prøv igjen». Sidene som er lastet, står. Fokus flyttes ikke. |
| For stor (413) | – | `Notice`: «Rapporten er for stor til forhåndsvisningen. Bruk «Lag PDF (utkast)».» |
| Ikke innlogget (401) | – | Sidene tømmes. `Notice`: «Du er ikke logget inn. Logg inn igjen for å se forhåndsvisningen.» |
| Ikke funnet (404) | – | Sidene tømmes. `Notice`: «Fant ikke rapporten.» |
| Tekst gikk over til ny side | – (bare `aria-live`) | «Teksten gikk over til side 4.» |

- «Oppdateres …» står aldri lenger enn forsøkene varer (kortet 10). Bare sider med ny `hash` byttes; rulleposisjonen holdes fast ved å huske avsnittet øverst i synsfeltet.

## 7. «Neste mangel»

- Teksten (`text-sm font-medium text-slate-900`): «3 ting å se på», «1 ting å se på», eller «Ingenting å se på». Etter første trykk: «2 av 3 ting å se på».
- Rekken: rader med `mark` pluss ventende KI-forslag, i sidens rekkefølge (side, så y, så x). «Neste» etter siste går til første, «Forrige» før første går til siste.
- Hvert trykk: ruten ruller til avsnittet (regel som 6.3), avsnittet får «her»-markeringen, og feltet i skjemaet får fokus. `aria-live`: «2 av 3: Mangler, årsak, avvik 1 under Vanntett sjikt».
- Med 0 er knappene `disabled` (stone, ikke gjennomsiktig).

## 8. KI-merket i margen

```
 ┌──────────────┐
 │ ✦ KI-forslag │   flate ai-50, kant 1 px ai-line, tekst ai-900, ikon ai-700
 │   venter     │   hjørner 8 px, luft 6 × 8 px, text-sm font-semibold
 └──────────────┘   minst 44 px høy, 96 px bred, i høyre marg
```

- `<button>` i høyre marg, toppkant på høyde med ankerets `y`. Flere på samme høyde stables nedover med 4 px mellom. Merket står helt utenfor arket.
- Teksten «KI-forslag venter» med gnisteikonet (`aria-hidden`), alltid ordet «KI». `aria-label`: «KI-forslag venter: {funksjon}, {felt}», for eksempel «KI-forslag venter: språkvask, årsak».
- Klikk eller Enter: punktet åpnes, og forslagskortet i skjemaet får fokus (kortets overskrift med `tabIndex=-1`). Godta, endre og avvis skjer der som før.
- Fokusring 2 px `fjord` med 2 px luft (kontrast mot sand og ai-50 er over 3:1).
- Forslagsteksten vises aldri i ruten.

## 9. Tastatur og skjermleser

- **Tab-rekkefølge i ruten:** «Hopp over forhåndsvisningen» → «‹ Forrige» → «Neste ›» → «Prøv igjen» (bare ved feil) → sidegruppen (ett stopp) → målet sist i ruten.
- **Sidegruppen** (`role="group"`, `aria-label="Sidene i rapporten"`): roving tabindex over avsnittsknappene og KI-merkene i sidens rekkefølge (KI-merket rett etter sitt avsnitt). Pil ned/høyre: neste. Pil opp/venstre: forrige. Home/End: første og siste. Page Down/Page Up: første avsnitt på neste/forrige side. Enter/mellomrom: aktiverer. Første gang gruppen får fokus, er det avsnittet med «her»-markeringen, ellers det første på synlig side.
- Fokusert avsnitt rulles inn i synsfeltet (uten myk rulling ved redusert bevegelse).
- Alt virker med tastatur alene; ingen funksjon krever mus, unntatt å dra skillet (har piltaster).

## 10. Tekster (`live-preview-texts.ts`)

| Nøkkel | Tekst |
|---|---|
| `toggle.label` | Forhåndsvisning |
| `toggle.on` / `toggle.off` (aria-live) | Forhåndsvisningen er slått på. / Forhåndsvisningen er slått av. |
| `pane.heading` / `pane.draftBadge` | Forhåndsvisning / Utkast |
| `pane.skip` | Hopp over forhåndsvisningen |
| `pane.pagesGroup` | Sidene i rapporten |
| `pane.pageLabel` | Side {x} av {y} |
| `separator.label` / `separator.value` | Bredde på forhåndsvisningen / {n} piksler |
| `list.open` | Vis punktene, {done} av {total} ferdig |
| `status.loading` / `updating` / `stale` | Lager sidene … / Oppdateres … / Viser sist lagrede tekst |
| `status.offline` | Forhåndsvisningen trenger nett. Skjemaet lagres som vanlig. |
| `status.error` / `retry` | Forhåndsvisningen kunne ikke lages. / Prøv igjen |
| `status.tooLarge` | Rapporten er for stor til forhåndsvisningen. Bruk «Lag PDF (utkast)». |
| `status.unauthorized` / `notFound` | Du er ikke logget inn. Logg inn igjen for å se forhåndsvisningen. / Fant ikke rapporten. |
| `status.movedToPage` | Teksten gikk over til side {n}. |
| `issues.count` / `issues.position` / `issues.none` | {n} ting å se på / {i} av {n} ting å se på / Ingenting å se på |
| `issues.previous` / `issues.next` | ‹ Forrige / Neste › |
| `anchor.*` | se tabellen i 6.3 |
| `mark.notSet` / `missing` / `check` | Ikke satt / Mangler / Sjekk |
| `anchor.continued` | fortsetter |
| `ai.label` / `ai.ariaLabel` | KI-forslag venter / KI-forslag venter: {funksjon}, {felt} |

Funksjons- og feltnavn i KI-merket hentes fra de samme tekstene som forslagskortet bruker, ikke skrevet på nytt.

## 11. Universell utforming, kontrast og bevegelse

- Bryter og skille har navn og tilstand. Ruten er et navngitt landemerke med `h2`.
- Kontrast: tekst i ruten er night/slate-700 på sand (over 4,5:1). Fokusring `fjord` mot sand, hvit og ai-50 er over 3:1. «Her»-ringen i night mot hvitt ark er 18:1.
- Markering, «her» og KI-merket er synlige uten farge (tykk ramme, pil, ordet «KI»).
- `prefers-reduced-motion`: ingen myk rulling, ingen uttoning.
- Mørk visning finnes ikke ennå (fase 3); arket er alltid hvitt.
- axe uten funn med ruten på, og full vei med tastatur (kortets akseptkriterier).

## 12. Lagret i nettleseren

Én fast nøkkel i `localStorage`, `live-preview` (uten oppdrags-, rapport- eller ansatt-id, og uten produktnavnet, regel 10), med verdien `{"on":true,"width":608}`. Ingenting annet lagres (kortet 11).

## 13. Hvordan det tas ut

Ta bort `LivePreviewToggle`, `LivePreviewPane`, `PreviewPage`, `PaneSeparator`, `CollapsedRoomList`, tekstfilen og oppsettgrenen i `room-view.tsx`. `className` på `Switch` kan stå. «Lag PDF (utkast)» er urørt.
