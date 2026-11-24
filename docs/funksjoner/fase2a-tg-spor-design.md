# Design: «Hvorfor har dette punktet denne TG-en?» (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-tg-spor.md` (2a-2, fra forbedreren 23.11.2026). Ved motstrid gjelder oppgavekortet.
- **Fasit:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-konstr-pc.png`, `A-ipad-liggende.png`, `A-ipad-staende.png`), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/ezprop-etter-ki-pc.png` og `-ipad.png`), og mønstrene som finnes: `fase2a-forslagsmonster-design.md`, `fase2a-ki-i-veien-design.md`, `fase2a-badet-pc-design.md`.
- **Laget av:** ui-designer, 24.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** sporet viser forslag, valg, grunn og utgitt grad på ett sted, med TG alltid som tekst. Leder svarer kjøperen ut fra graden kjøperen faktisk fikk.
  - **De ansatte:** kortversjonen på Spor-knappen viser avvik fra reglene uten at noe åpnes; ett trykk gir hele kjeden; «Kopier spor» virker også uten KI.
  - **KI i bunnen:** forklaringsutkastet bruker samme KI-tone, gnisteikon og ordet «KI» som de andre KI-funksjonene, og «Kopier» er godkjenningen.

## 1. Designvalg (innenfor A, krever ikke godkjenning)

| # | Valg | Hvorfor |
|---|---|---|
| D1 | Sporet er en loddrett tidslinje (`<ol>`) med tynn strek i `line` til venstre og en liten prikk per linje. Prikken er pynt (`aria-hidden`); hendelsen står alltid som tekst. | Rolig og lett å lese ovenfra og ned. Ingen farge bærer mening. |
| D2 | Utgivelseslinjer står i flate `sand` over hele bredden. Linjer etter siste utgivelse får merket «Etter utgivelse» (`Badge neutral`). | Utgivelsen er skillet leder trenger ved en reklamasjon. Ikke gul: gult er TG2. |
| D3 | På PC (bredde minst 1280 px og fin peker) er panelet et sidepanel til høyre som ikke er modalt; innholdet får plass ved siden av. På iPad og smalere skjerm er det en modal `<dialog>`. | Kortet krever at PC-panelet ikke dekker avvikskortet, og at iPad får en vanlig dialog uten sveip. |
| D4 | «Kopier» for KI-utkastet har KI-fyll (`ai`, 56 pt). «Lag forklaring» er `secondary` med gnisteikon. «Kopier spor», «Forkast» og «Lukk» er `secondary`. | Samme regel som D3 i «KI i veien»: KI-fyll betyr «jeg tar KI-teksten». |
| D5 | Ingen hovedknapp i night i panelet. | Panelet er lesing; hovedhandlingen på skjermen er fortsatt «Ferdig med punktet». |
| D6 | Pilen i kortversjonen («TG3 → TG2») er `aria-hidden`, med `sr-only` «til». | Skjermleseren leser «TG3 til TG2», ikke «høyre pil». |
| D7 | Rollen står som tekst foran hendelsen («Takstmann godtok forslaget»). Ingen merker per rolle. | Rolle er ikke status. Færre merker gir roligere liste. |
| D8 | Dato og klokkeslett formateres med én felles funksjon `formatOsloDateTime` i `src/shared/lib/dates.ts` («24.11.2026 kl. 10.14»). De tre like kopiene i `publiser/page.tsx`, `publish-view.tsx` og `releases-card.tsx` tas i bruk av den når filene røres. | Samme format overalt, norsk tid. |

## 2. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `TgTrailButton` (Spor-knappen med kortversjon) | `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/tg-trail-button.tsx` | ny |
| `TgTrailPanel` (sidepanel eller dialog, laster sporet) | `src/app/(ansatt)/tg-trail/tg-trail-panel.tsx` | ny, brukes av badet og saken |
| `TgTrailList` (tidslinjen) | `src/app/(ansatt)/tg-trail/tg-trail-list.tsx` | ny |
| `TgExplanationDraft` (KI-utkastet i panelet) | `src/app/(ansatt)/tg-trail/tg-explanation-draft.tsx` | ny |
| `trailToPlainText` (teksten til «Kopier spor») | `src/app/(ansatt)/tg-trail/trail-text.ts` | ny, ren funksjon med test |
| `TG_TRAIL_TEXTS` (alle skjermtekster) | `src/app/(ansatt)/tg-trail/tg-trail-texts.ts` | ny |
| `ClaimTgTrailSection` («Hvorfor fikk punktene graden?») | `src/app/(ansatt)/oppdrag/[id]/reklamasjoner/[claimId]/claim-tg-trail-section.tsx` | ny |
| `DeviationCard`, `RuleSuggestionCard`, `RoomView` | eksisterende filer | endret (Spor-knappen, plass til sidepanelet) |
| Reklamasjonssiden | `reklamasjoner/[claimId]/page.tsx` | endret (delen under skjemaet, bredere side) |
| `formatOsloDateTime` | `src/shared/lib/dates.ts` | ny funksjon |

Ingen nye fargetokener, knappevarianter eller komponenter i `src/shared/ui`. Bruk `Card`, `Button`, `Badge`, `TgBadge`, `Notice`, `AiSparkIcon`, `AiTextMark`, `SuggestionBox`. Ingen faste hex-verdier. Tekstene for hendelsene lages i kjernen (`logic/labels.ts`, se kortet); skjermen setter bare sammen rolle, tid og tekst.

## 3. Spor-knappen: `TgTrailButton`

**Hvor:** i topplinjen på hvert avvikskort (venstre for «Språkvask avviket», samme linje) og nederst i regelforslagskortet (`RuleSuggestionCard`), høyrejustert. Punkt uten regelforslag og uten avvik har ingen knapp. HMS-avvik har knappen.

```
┌ Card avvik ────────────────────────────────────────────────────────────────────┐
│ Avvik 1  [TG2 Vesentlige avvik]   [⋮ Spor: TG3 → TG2 (dokumentasjon)] [✦ Språkvask avviket] │
```

- `Button variant="secondary" size="md"`. Ikon foran: tidslinje-ikon (tre prikker på en loddrett strek, inline SVG 16 px, `aria-hidden`).
- **Synlig tekst** (bygges av beslutningen rommet alt har, ingen spørring):

| Tilstand | Tekst |
|---|---|
| Grad endret fra forslaget | Spor: TG3 → TG2 (dokumentasjon) |
| Forslaget avvist | Spor: forslag avvist |
| Ellers (godtatt, åpent, bare avvik, HMS) | Spor |

  Kortgrunnene: `documentation_present` «dokumentasjon», `visible_damage` «synlig skade», `measured_again` «målt på nytt», `age_known_otherwise` «alder kjent», `other` «annen grunn», uten kode «grunn oppgitt». Ved «TG2 eller TG3» i forslaget står «Spor: TG2 eller TG3 → TG2 …» bare når valgt grad er utenfor forslaget; ellers «Spor».
- **Tilgjengelig navn:** synlig tekst først, så `sr-only` «, for {punkt}, nå {TG}». Eksempel: «Spor: TG3 til TG2 (dokumentasjon), for Sluk og fall, nå TG2». Starter alltid med «Spor» (WCAG 2.5.3).
- Bred tekst brytes ikke midt i: `whitespace-nowrap`; under 768 px står knappen på egen linje under kortoverskriften, høyrejustert.
- `aria-haspopup="dialog"`, `aria-expanded` når panelet er åpent for dette kortet. Når panelet er åpent for kortet, har knappen flaten `sand` (som valgt menypunkt), så det synes hvilket kort sporet gjelder.
- Uten nett: knappen vises og kan trykkes som vanlig (meldingen står i panelet, avsnitt 4).

## 4. Panelet: `TgTrailPanel`

### Plassering

- **PC (D3):** `<aside role="dialog" aria-modal="false" aria-labelledby>`, fast til høyre, `w-110` (440 px), full høyde under toppfeltet, hvit flate, kant `border-l border-line`, skygge `shadow-xl` (flyter). Når panelet er åpent, får innholdskolonnen `xl:pr-110`, og kortet som åpnet panelet rulles inn i synsfeltet (`scrollIntoView({ block: "nearest" })`). Avvikskortet er aldri under panelet.
- **iPad og under 1280 px:** innebygd `<dialog>` med `showModal`, `max-w-160 w-[calc(100%-2.5rem)]`, `max-h-[calc(100dvh-5rem)]`, 12 px hjørner, `p-6`, bakteppe `night/40`. Lukkes bare med «Lukk» eller Esc (tastatur), aldri med sveip eller trykk utenfor.
- Synkstatusen i toppfeltet dekkes ikke (A592): sidepanelet starter under toppfeltet; dialogen har luft over.
- Innholdet ruller inni panelet; knapperaden nederst står fast (`sticky bottom-0 bg-white border-t border-line pt-4`).

### Oppbygging

```
┌ Panel ─────────────────────────────────────────────────────────┐
│ Spor                                            (h2, Schibsted) │
│ Sluk og fall · Bad 1. etasje                       (text-sm)    │
│                                                                 │
│ ┌ sand, 12 px, p-4 ──────────────────────────────────────────┐  │
│ │ TG nå            [TG2 Vesentlige avvik]                    │  │
│ │ Dette avviket    [TG2 Vesentlige avvik]  (når ett avvik)   │  │
│ │ I utgitt rapport [TG3 Store eller alvorlige avvik]         │  │
│ │ Graden er endret etter at rapporten ble utgitt.            │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│ ol (tidslinje)                                                  │
│ │ ● Reglene                                                     │
│ │   Reglene foreslo TG3: vanntett sjikt fra før 2000            │
│ │   Årstall 1996 (byggeåret, anslått)                           │
│ │ ● 24.11.2026 kl. 10.14 · Takstmann                            │
│ │   Takstmann godtok forslaget. [TG3]                           │
│ │ ● 24.11.2026 kl. 10.15 · Takstmann                            │
│ │   Takstmann la til avviket «Sjikt fra før 2000» med TG3       │
│ ├──────────────────────────────────────────────────────────────┤│
│ │ ■ 24.11.2026 kl. 14.02   Utgitt versjon 1: TG3 i rapporten   ││  (sand)
│ ├──────────────────────────────────────────────────────────────┤│
│ │ ● 25.11.2026 kl. 09.30 · Leder        [Etter utgivelse]       │
│ │   Leder endret avviket fra TG3 til TG2                        │
│ │   Grunn: Alderen er kjent på annen måte                       │
│ │   «Kvittering fra 2012 er lagt fram.»                         │
│ │ ○ Forslaget er åpent igjen                                    │
│                                                                 │
│ ── Forklaring ─────────────────────────────────── (h3)          │
│ TgExplanationDraft (avsnitt 6)                                  │
│ ─────────────────────────────────────────────────────────────── │
│ [ Kopier spor ]                                      [ Lukk ]   │
└─────────────────────────────────────────────────────────────────┘
```

- **Overskrift:** `h2` «Spor» (Schibsted Grotesk 600, 24 px), `tabIndex={-1}`, får fokus når panelet åpnes. Under: punktnavn · romnavn (`text-sm text-slate-700`). Fra reklamasjonssaken også «Rapport versjon {n}».
- **Gradboksen** (flate `sand`, 12 px, `p-4`, `dl` med to kolonner): «TG nå», «Dette avviket» (bare når sporet gjelder ett avvik og graden er ulik punktets eller punktet har flere avvik), «I utgitt rapport» (bare når ulik TG nå). Alle med `TgBadge long`. HMS-avvik: «Dette avviket: HMS, uten TG». Når utgitt og nå er ulike, står setningen «Graden er endret etter at rapporten ble utgitt.» under (`text-sm`, ingen farge).

### Tidslinjen: `TgTrailList`

- `<ol aria-label="Hendelser, eldst først">`, `space-y-4`, `border-l-2 border-line pl-5 ml-2`. Hver `<li>` har prikk 10 px (`bg-slate-700`, rund, `aria-hidden`) på streken. Forslagslinjen og «åpent igjen» har hul prikk (ring `slate-700`), siden de ikke har tid.
- **Linje 1 (meta):** `<time dateTime="…">24.11.2026 kl. 10.14</time>` · rolle (`text-sm text-slate-700 tabular-nums`). Forslagslinjen: bare «Reglene». Merket «Etter utgivelse» til høyre når det gjelder.
- **Linje 2 (hendelse):** `text-base text-slate-900`. TG i hendelsen står som `TgBadge` kort form inni teksten, aldri bare farge.
- **Linje 3 (detalj, valgfri):** `text-sm text-slate-700`: måling og grense, årstall, grunn. Begrunnelsesteksten (når tjenesten har tatt den med) står i anførselstegn på egen linje, `whitespace-pre-wrap`, ingen kutt.
- **Utgivelseslinje (D2):** `li` med flate `sand`, `-ml-5 pl-5 py-3 rounded-r-xl`, firkantet prikk. Tekst `font-semibold`: «Utgitt versjon 1: TG3 i rapporten». Rettet versjon: «Utgitt versjon 2 (rettet): TG2 i rapporten».
- Slettede avvik står som hendelse («fjernet»); avvikstekst vises aldri.

### Hendelsestekster

| Hendelse | Linje 2 | Linje 3 |
|---|---|---|
| Forslag, én grad | Reglene foreslo TG3: {utfall} | Målt {verdi} {enhet} i {materiale} · grense {grense} {enhet} / Årstall {år} ({sjiktets eget / byggeåret, anslått}) |
| Forslag, `choose` | Reglene foreslo avvik: {utfall}, TG2 eller TG3 | som over |
| Godtatt | {Rolle} godtok forslaget. | – |
| Endret | {Rolle} endret til TG2. | Grunn: {etikett} + ev. «{tekst}» |
| Avvist | {Rolle} avviste forslaget. | Grunn: {etikett} + ev. «{tekst}» |
| Kode tom, bare tekst | (som over) | Grunn oppgitt + ev. «{tekst}» |
| Avvik lagt til | {Rolle} la til avviket «{utfall}» med TG3 | – |
| TG på avvik endret | {Rolle} endret avviket «{utfall}» fra TG3 til TG2 | – |
| Avvik fjernet | {Rolle} fjernet avviket «{utfall}» | – |
| Avvik hentet tilbake | {Rolle} hentet tilbake avviket «{utfall}» | – |
| TG satt direkte | {Rolle} satte TG1 på punktet / {Rolle} endret punktet fra TGIU til TG1 | – |
| Utgitt | Utgitt versjon {n}: TG3 i rapporten | – |
| Åpent igjen | Forslaget er åpent igjen. | Det er ikke avgjort ennå. |

Roller: Admin, Leder, Takstmann, Kontor, Ansatt. Eksempeltekstene er plassholdere; utfallsnavn, etiketter og forslagstekster kommer fra kjernen.

### Tilstander i panelet

| Tilstand | Hva vises |
|---|---|
| `loading` | Overskrift og gradboks (fra rommet), i stedet for listen «Henter sporet …» (`role="status"`). Ingen skjelett som hopper. |
| `ready` | Som over. |
| `empty` | «Ingen hendelser ennå.» (punkt med åpent forslag viser alltid minst forslagslinjen). |
| `offline` | `Notice` nøytral: «Sporet trenger nett. Det vises når iPaden er på nett igjen.» Laster selv når `online` kommer, mens panelet er åpent. «Kopier spor» er låst. |
| `error` | `Notice` nøytral: «Fikk ikke hentet sporet. Prøv igjen.» og `Button secondary` «Prøv igjen». |
| `not_found` | «Fant ikke sporet. Punktet kan være fjernet.» Bare «Lukk». |

## 5. Knapperaden nederst

DOM-rekkefølge og visuell rekkefølge er lik: «Kopier spor» til venstre, «Lukk» til høyre (`flex justify-between`). Begge `secondary`, `size="lg"` (56 pt). Under 480 px: under hverandre, full bredde.

- **«Kopier spor»** legger `trailToPlainText` på utklippstavlen. Etter vellykket kopiering: knappen viser «Kopiert» i 2 s (teksten byttes, bredden låst med `min-w`), og `aria-live` sier «Sporet er kopiert.». Feiler kopieringen: `Notice` «Fikk ikke kopiert. Merk teksten og kopier selv.» og et skrivebeskyttet `<textarea>` med teksten, markert.
- **Tekstformat** (ingen navn, begrunnelsestekst bare hvis tjenesten har tatt den med):

```
Spor for Sluk og fall, Bad 1. etasje
TG nå: TG2. I utgitt rapport: TG3.
Reglene: Reglene foreslo TG3: vanntett sjikt fra før 2000. Årstall 1996 (byggeåret, anslått).
24.11.2026 kl. 10.14, Takstmann: Takstmann godtok forslaget.
24.11.2026 kl. 14.02: Utgitt versjon 1: TG3 i rapporten.
25.11.2026 kl. 09.30, Leder (etter utgivelse): Leder endret avviket «Sjikt fra før 2000» fra TG3 til TG2. Grunn: Alderen er kjent på annen måte.
```

  TG skrives alltid som «TG2» (kort form); ingen symboler eller piler.
- **«Lukk»:** lukker. Esc gjør det samme på PC og med tastatur på iPad. Fokus går tilbake til Spor-knappen som åpnet panelet (fra saken: «Vis spor» på raden).

## 6. KI-utkastet: `TgExplanationDraft`

Står under tidslinjen med `h3` «Forklaring» (Inter 600, 16 px), skilt med `border-t border-line pt-6 mt-6`. Vises ikke for kontor eller den uten `report.edit` (fra saken: `claims.read` i tillegg), og ikke for HMS-avvik.

```
Forklaring                                                      (h3)
[✦ Lag forklaring]                                (secondary, 44 pt)
Et kort utkast fra KI som du kan bruke i et svar. Ingen navn eller tekst sendes.

etter svar:
┌ ai-50, kant ai-line, 12 px, p-4 ───────────────────────────────────┐
│ ✦ KI-utkast · laget 24.11.2026 kl. 10.20             (text-ai-900) │
│ [ textarea, min-h-32, hvit, kant field, 8 px ]                     │
│ Retter du teksten, blir den ikke lagret. Kopier den før du lukker. │
└────────────────────────────────────────────────────────────────────┘
[ Forkast ]                                         [ ✦ Kopier ]  (56 pt)
```

- **«Lag forklaring»:** `Button secondary md`, `AiSparkIcon` foran. Hjelpelinjen under (`text-sm text-slate-700`, `aria-describedby`).
- **Utkastet** står i redigerbart `<textarea>` inni KI-boksen, så takstmannen kan rette før kopiering. Etiketten «KI-utkast» med gnisteikon og ordet «KI» (KI-merket med kant), tid for når det ble laget.
- **«Kopier»** (`ai`, `lg`, 56 pt, gnisteikon): kopierer teksten i feltet. Først når kopieringen lyktes, sendes avgjørelsen: urørt tekst «godtatt», rettet tekst «endret» (bare flagget sendes, aldri teksten, A590). Feiler kopieringen, sendes ingenting, og meldingen fra avsnitt 5 vises. Etter kopiering: boksen viser `AiTextMark`-linjen «Tekst fra KI, kopiert» og knappen blir «Kopiert»; kan kopieres igjen uten ny logging.
- **«Forkast»** (`secondary`, `lg`): logger «avvist», tar bort boksen og viser «Lag forklaring» igjen. Fokus til «Lag forklaring».
- **Lukkes panelet uten valg:** ingenting logges. Neste gang står knappen som «Laget 24.11.2026 kl. 10.20, ikke avgjort» (`secondary`, gnisteikon) og åpner samme utkast uten nytt kall. Rettinger i feltet er da borte.
- DOM-rekkefølge i knapperaden: Kopier, Forkast (visuelt `flex-row-reverse`, Kopier til høyre i tommelsonen).

### Tilstander

| Tilstand | Hva vises |
|---|---|
| `idle` | «Lag forklaring» og hjelpelinjen. |
| `open_draft` | «Laget {tid}, ikke avgjort». |
| `working` | Knappen låst med teksten «Lager forklaring …», `aria-busy` på seksjonen. |
| `draft` | KI-boksen med feltet, «Kopier», «Forkast». |
| `used` | Boksen med «Tekst fra KI, kopiert», knappen «Kopiert»; under: `Button secondary md` «Lag ny forklaring». Knappen ved neste åpning: «Brukt» (låst, med «Lag ny forklaring» ved siden av). |
| `stopped` | `Notice` nøytral (`snow`): «KI-svaret ble stoppet fordi det nevnte en grad eller et tall som ikke står i sporet. Prøv igjen.» og «Prøv igjen». Stoppet tekst vises aldri. |
| `error` | «Fikk ikke laget forklaringen. Prøv igjen.» og «Prøv igjen». |
| `offline` | Knappen trykkbar, svarer «Trenger nett.» rett under. |
| `ai_off` | Knappen låst (stone), linjen «KI er ikke slått på. Bruk «Kopier spor».» |

## 7. Reklamasjonssaken: `ClaimTgTrailSection`

Siden går fra `max-w-2xl` til `max-w-190` (samme som badet) så listen og panelet får plass. Skjemaet beholder sin bredde (`max-w-2xl` på skjemaet selv). Delen står under skjemaet, skilt med `mt-12 border-t border-line pt-8`. Bare leder og admin; takstmann og kontor får ikke delen i HTML-en.

```
Hvorfor fikk punktene graden?                             (h2, Schibsted)
Rapport versjon 2 (rettet) · utgitt 12.11.2026            (text-sm)

[ Søk i rom og kontrollpunkt               ]   (felt, 44 pt, type="search")
7 punkter · 2 kan gjelde reklamasjonen                    (role="status")

── Kan gjelde reklamasjonen ─────────────────────────────── (h3)
┌ Card ─────────────────────────────────────────────────────────────────┐
│ Bad 1. etasje                                              (text-sm)   │
│ Sluk og fall                                         (font-semibold)   │
│ Nå [TG2 Vesentlige avvik] · I utgitt rapport [TG3]                     │
│ [Kan gjelde reklamasjonen] [Endret fra forslag: TG3 foreslått, satt TG2]│
│                                                  [⋮ Vis spor]  (44 pt)  │
└────────────────────────────────────────────────────────────────────────┘
── Endret fra forslag ── …
── Øvrige punkter (gruppert per rom, h4 per rom) ── …
```

- **Rekkefølge (forbedreren 3, ux 4):** «Kan gjelde reklamasjonen» først, så «Endret fra forslag», så resten gruppert per rom i rapportens rekkefølge. Et punkt står bare én gang (i første gruppe det hører til). Tom gruppe vises ikke.
- **Raden** er et `Card` (`p-4`, `space-y-2`): romnavn, punktnavn, «Nå» + `TgBadge long`, «I utgitt rapport» + `TgBadge` bare når ulik. Merkene er tekst: `Badge brand` «Kan gjelde reklamasjonen», `Badge neutral` «Endret fra forslag: TG3 foreslått, satt TG2» / «Forslag avvist». «Vis spor» (`secondary md`, tidslinje-ikon), tilgjengelig navn «Vis spor for Sluk og fall, Bad 1. etasje». Åpner samme `TgTrailPanel` (via `claim`).
- **Flere rapportversjoner:** velger over listen som knapperad (`ChoiceButtons`, ingen nedtrekk): «Versjon 2 (gjeldende)», «Versjon 1 (erstattet)». Standard er den utgitte versjonen kjøperen har fått sist. Bare én versjon: ingen velger.
- **Søk:** filtrerer i nettleseren på rom- og punktnavn mens man skriver, uten tegn-grense. Uten treff: «Ingen punkter passer søket.» Tellingen i `role="status"` oppdateres («3 av 7 punkter»).
- **Ingen punkter:** «Rapporten har ingen punkter med avvik, TG eller regelforslag.» Uten publisert rapport: «Oppdraget har ingen utgitt rapport ennå.»
- Teksten i «Bygningsdel» fra saken vises aldri i denne delen; bare merket.

## 8. Mål

| Ting | Mål |
|---|---|
| Spor-knappen, «Vis spor», «Lag forklaring», «Prøv igjen», «Lag ny forklaring», søkefeltet | min. 44 × 44 pt (`min-h-11 min-w-11`) |
| «Kopier», «Forkast», «Kopier spor», «Lukk» | min. 56 pt (`size="lg"`) |
| Sidepanel PC | 440 px bred, fra 1280 px og fin peker |
| Dialog iPad | maks 640 px bred, 20 px luft til kanten, `p-6` |
| Mellom linjer i tidslinjen | 16 px (`space-y-4`) |
| Avstand mellom knapper | 8 px, 12 px fra `md` |
| Hjørner | panel, gradboks, KI-boks og kort 12 px, felt 8 px, knapper og merker runde |
| Tekst | hendelse 16 px / 1,5; meta og detalj 14 px |
| «Kopiert» | 2 s, så tilbake; ingen animasjon med `prefers-reduced-motion` |

## 9. Universell utforming

- WCAG 2.1 AA. Ingen nye fargepar: `slate-900`/`slate-700` på hvit og `sand`, `ai-900` på `ai-50`, hvit på `ai-700` står i `contrast.test.ts`.
- TG alltid med tekst (`TgBadge`), KI alltid med ordet «KI» og gnisteikon, «Etter utgivelse», «Endret fra forslag» og «Kan gjelde reklamasjonen» er tekst. Prikkene i tidslinjen er pynt.
- Tidslinjen er en `<ol>`, hver tid er `<time dateTime>` med ISO-tid; skjermleseren får rekkefølgen fra lista.
- **Fokus:** åpning setter fokus på `h2` «Spor». iPad-dialogen holder fokus (`showModal`). PC-panelet er ikke modalt: Tab går fra panelets siste knapp videre i siden; Esc lukker fra hvor som helst i panelet, og fokus går tilbake til Spor-knappen. Etter «Forkast» til «Lag forklaring»; etter svar fra KI til feltet i KI-boksen.
- Ett `role="status" aria-live="polite"` per panel: «Henter sporet …», «Sporet er hentet, 6 hendelser.», «Sporet er kopiert.», «KI-utkast klart.», «Utkastet er forkastet.». Ett i saksdelen for tellingen. Aldri `assertive`.
- Uten nett-melding og feil er tekst i panelet, ikke bare ikon.
- axe uten brudd med åpent panel (tom, full, med KI-utkast) på PC, iPad liggende og stående, og på saksdelen.
- Mørk visning: bare tokens.

## 10. Tekster (samlet, `TG_TRAIL_TEXTS`)

| Sted | Tekst |
|---|---|
| Knapper | Spor · Vis spor · Lag forklaring · Laget {tid}, ikke avgjort · Brukt · Lag ny forklaring · Lager forklaring … · Kopier · Kopiert · Forkast · Kopier spor · Prøv igjen · Lukk |
| Kortversjon | Spor: TG3 → TG2 ({kortgrunn}) · Spor: forslag avvist |
| Kortgrunner | dokumentasjon · synlig skade · målt på nytt · alder kjent · annen grunn · grunn oppgitt |
| Gradboks | TG nå · Dette avviket · I utgitt rapport · HMS, uten TG · Graden er endret etter at rapporten ble utgitt. |
| Tidslinjen | Hendelser, eldst først · Reglene · Etter utgivelse · Grunn: · Grunn oppgitt · Forslaget er åpent igjen. · Det er ikke avgjort ennå. · Utgitt versjon {n}: {TG} i rapporten · Utgitt versjon {n} (rettet): {TG} i rapporten |
| Tilstander | Henter sporet … · Ingen hendelser ennå. · Sporet trenger nett. Det vises når iPaden er på nett igjen. · Fikk ikke hentet sporet. Prøv igjen. · Fant ikke sporet. Punktet kan være fjernet. |
| Kopiering | Sporet er kopiert. · Fikk ikke kopiert. Merk teksten og kopier selv. |
| KI | Forklaring · Et kort utkast fra KI som du kan bruke i et svar. Ingen navn eller tekst sendes. · KI-utkast · laget {tid} · Retter du teksten, blir den ikke lagret. Kopier den før du lukker. · Tekst fra KI, kopiert · KI-svaret ble stoppet fordi det nevnte en grad eller et tall som ikke står i sporet. Prøv igjen. · Fikk ikke laget forklaringen. Prøv igjen. · Trenger nett. · KI er ikke slått på. Bruk «Kopier spor». · KI-utkast klart. · Utkastet er forkastet. |
| Saken | Hvorfor fikk punktene graden? · Rapport versjon {n} · Søk i rom og kontrollpunkt · {n} punkter · {n} av {m} punkter · {n} kan gjelde reklamasjonen · Kan gjelde reklamasjonen · Endret fra forslag · Endret fra forslag: {TG} foreslått, satt {TG} · Forslag avvist · Øvrige punkter · Nå · Versjon {n} (gjeldende) · Versjon {n} (erstattet) · Ingen punkter passer søket. · Rapporten har ingen punkter med avvik, TG eller regelforslag. · Oppdraget har ingen utgitt rapport ennå. |

## 11. Ikke med

Spor i PDF-en, statistikk per person, egen side for sporet, lagring av forklaringen i saken (spørsmål 124), kobling av saken til punktet (eget planpunkt), filter på rolle eller tid, kompakt visning.

## 12. Sjekkliste for utvikler

- [ ] Spor-knappen på avvikskort og regelforslagskort; kortversjonen uten ekstra spørring; navnet starter med «Spor».
- [ ] PC: sidepanel til høyre som ikke dekker kortet; iPad: modal dialog som ikke sveipes bort; synkstatusen synes.
- [ ] Tidslinjen eldst øverst, `<time>`, rolle uten navn, utgivelser i `sand`, «Etter utgivelse».
- [ ] TG alltid med tekst; ingen avvikstekst i sporet.
- [ ] «Kopier spor» virker uten KI og for kontor; reserve med markert tekst når utklippstavlen feiler.
- [ ] KI: «Kopier» logger først etter vellykket kopiering, bare flagget; «Forkast» logger avvist; lukking logger ingenting; teksten sendes aldri.
- [ ] Saksdelen bare for leder og admin, grupper i riktig rekkefølge, søk og telling, velger for versjon.
- [ ] Målene i avsnitt 8 (e2e måler), Esc og fokus tilbake, axe uten brudd, ingen faste hex-verdier.
