# Design: Forslagsmønsteret (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-forslagsmonster.md` (2a-1)
- **Fasit:** design A «Fjord», `docs/design/retning-A.html` (boksen «Forslag fra KI · bygget på frasebanken» i sidepanelet), `docs/design/bilder/A-*.png`, `docs/08-designprinsipper.md`
- **Laget av:** ui-designer, 10.11.2026
- **Støtter hovedmål:** De ansatte: ett kort med samme utseende og samme knapper overalt, så takstmannen lærer det én gang. / KI i bunnen: kortet og merket brukes av alle KI-funksjoner i 2a-2 (frasebank, språkvask, sammendrag). / Reklamasjoner: KI-tekst er alltid tydelig merket, og merket vises bare når serveren har bekreftet godkjenning.

## 1. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `AiSuggestion` (forslagskortet) | `src/shared/ui/ai-suggestion.tsx` | ny |
| `AiTextMark` (KI-merket) | `src/shared/ui/ai-text-mark.tsx` | ny |
| `Button`, ny variant `ai` | `src/shared/ui/button.tsx` | endret (én variant) |
| Fargetokener for KI | `src/app/globals.css` | endret (tre tokener) |
| Prøvesiden | `src/app/(ansatt)/prove/ki/page.tsx` + klientdel | ny |

Ingen andre nye komponenter. Gjenbruk `Card`, `Button`, `Badge` og `FormMessage`/`Notice` der de passer.

## 2. Fargetokener (globals.css, `@theme`)

KI-farge er nordlysfiolett, som i A. Den brukes bare for KI, aldri for TG eller status.

```css
--color-ai-50: #f3ecf8;   /* bakgrunn i kortet, gradient fra brand-50 */
--color-ai-200: #d9d2ea;  /* kantlinje rundt forslaget */
--color-ai-700: #6b3a8c;  /* knappen «Bruk», ikon */
--color-ai-900: #5b2a7a;  /* overskrift «Forslag fra KI», merketekst */
```

Kontrast (målt mot WCAG, minst 4,5:1):
- Hvit tekst på `ai-700` #6b3a8c: ca. 8,6:1.
- `ai-900` #5b2a7a på `ai-50` #f3ecf8: ca. 9:1.
- `slate-900` på gradienten `brand-50 → ai-50`: over 14:1.

Fokus: eksisterende `:focus-visible` (2 px, `brand-600`, offset 2) gjelder også `ai`-knappen. Ikke overstyr.

Mørk visning finnes ikke ennå i `globals.css`. Når den kommer, får tokenene mørke par; ingenting i komponentene skal ha faste hex-verdier.

## 3. `Button`, variant `ai`

```ts
ai: "bg-ai-700 text-white shadow-sm hover:bg-ai-900"
```

Brukes bare til «Bruk» i forslagskortet. Størrelse `lg` (`min-h-14` = 56 pt). Alt annet bruker eksisterende varianter.

## 4. `AiSuggestion` (forslagskortet)

### Props (komponenten vet ingenting om tilgang, lagring eller nett)

```ts
type AiSuggestionState =
  | { kind: "working" }                                   // «KI jobber …»
  | { kind: "suggested"; suggestion: string }
  | { kind: "accepted"; suggestion: string; canUndo: boolean }
  | { kind: "rejected"; suggestion: string; canUndo: boolean }
  | { kind: "no_match" }
  | { kind: "error" }
  | { kind: "ai_off" }
  | { kind: "offline" };

type AiSuggestionProps = {
  ownText: string;
  state: AiSuggestionState;
  /** Gammelt forslag som står igjen når et nytt ga no_match eller feil (A164). */
  previous?: { suggestion: string; status: "suggested" | "rejected" };
  busy: boolean;             // et kall pågår: alle knapper låst
  source?: string;           // f.eks. «språkvask». Vises etter «Forslag fra KI · »
  onUse(): void;
  onKeep(): void;
  onNew(): void;
  onUndo(): void;
};
```

Importerer aldri `@/core/access`, `@/core/ai` eller `@/db` (akseptkriterium, statisk sjekk). Typene for status lages lokalt i komponenten eller i `src/shared`.

### Oppbygging

```
┌ Card ───────────────────────────────────────────────────────────┐
│  Din tekst                     │  [*] Forslag fra KI · språkvask │
│  ───────────                   │  ┌ gradient brand-50→ai-50 ──┐  │
│  (ownText, slate-900)          │  │ (forslag, ren tekst)       │  │
│                                │  └────────────────────────────┘  │
│ ─────────────────────────────────────────────────────────────── │
│  [ Behold min tekst ] [ Nytt forslag ]            [   Bruk   ]   │
└─────────────────────────────────────────────────────────────────┘
```

- **Kolonner:** to like kolonner fra bredde 1024 px (PC og iPad Pro liggende); én kolonne under det (iPad stående): egen tekst øverst, forslaget under. Tailwind: `grid gap-4 lg:grid-cols-2`.
- **Overskrifter:** «Din tekst» (`text-sm font-medium text-slate-600`). «Forslag fra KI» med gnisteikon (`#spark` fra A, `aria-hidden`), `text-sm font-medium text-ai-900`. Kilden står etter et midtpunkt: «Forslag fra KI · språkvask».
- **Forslagsboksen:** `rounded-xl border border-ai-200 bg-gradient-to-br from-brand-50 to-ai-50 p-4 text-base leading-relaxed`. Teksten settes som React-tekst (escapet), aldri `dangerouslySetInnerHTML`. `whitespace-pre-wrap`.
- **Egen tekst:** vanlig tekst på hvit bakgrunn, ingen ramme. Slik er forskjellen tydelig uten farge alene (overskrift + boks).
- **Knappelinjen:** fast nederst i kortet, skilt med `border-t border-slate-200 pt-4`. På iPad står «Bruk» til høyre (tommelsone, høyrehånd) og fyller halve bredden i én kolonne. Rekkefølge i DOM og tabulator: Bruk, Behold min tekst, Nytt forslag (hovedhandling først for skjermleser), visuelt `flex-row-reverse`.
  - «Bruk»: `Button variant="ai" size="lg"` (56 pt).
  - «Behold min tekst»: `variant="secondary" size="md"` (44 pt).
  - «Nytt forslag»: `variant="ghost" size="md"` (44 pt), med en tynn ring så den ser ut som en knapp (`ring-1 ring-slate-300 ring-inset`).
  - «Angre»: `variant="secondary" size="md"`, med tekst, aldri bare ikon.
- Ingen meny, ingen «mer»-knapp, ingen sveiping, ingen melding som forsvinner av seg selv.

### Tilstander

| `state.kind` | Hva vises | Knapper |
|---|---|---|
| `working` | Forslagsboksen viser «KI jobber …» med tre rolige prikker (`motion-safe:animate-pulse`). | Alle låst (`disabled`, `aria-disabled`). |
| `suggested` | Forslaget. | Bruk · Behold min tekst · Nytt forslag |
| `accepted` | Forslagsboksen viser forslaget med `AiTextMark` over. Egen-tekst-kolonnen viser egen tekst nedtonet (`text-slate-500`) med overskriften «Din tekst før». | Angre (hvis `canUndo`) |
| `rejected` | Forslaget nedtonet (`opacity-70`) med linjen «Du beholdt din tekst.» | Angre (hvis `canUndo`) · Nytt forslag |
| `no_match` | Boksen uten gradient, `bg-slate-50`: «KI hadde ikke noe forslag. Teksten din er uendret.» | Nytt forslag |
| `error` | `bg-amber-50 text-amber-900`: «KI svarte ikke. Prøv igjen.» | Nytt forslag (tekst «Prøv igjen» er unødvendig, samme handling) |
| `ai_off` | `bg-slate-50`: «KI er av.» | Ingen |
| `offline` | `bg-slate-50`: «Krever nett. Teksten din er lagret og kan skrives videre.» | Ingen (alle låst) |

- Når `previous` er satt (nytt forslag ga `no_match` eller `error`): det gamle forslaget vises som før, og meldingen står som én linje under boksen. Knappene følger statusen til `previous`.
- `busy = true` låser alle knapper i alle tilstander. Etter et trykk låses knappen før kallet sendes (ett valg, én rad).
- `canUndo = false` (nyere forslag finnes, A162): «Angre» vises ikke i det hele tatt (ikke grå), så ingen trykker på noe som ikke virker.

### Skjermleser og fokus

- Kortet er `<section aria-labelledby>` med en skjult overskrift «Forslag fra KI».
- Et område med `role="status"` `aria-live="polite"` sier statusendringen: «KI jobber», «Forslag klart», «Forslaget er brukt», «Du beholdt din tekst», «Angret», og meldingene i tabellen over. Ikke `assertive`.
- Etter «Bruk» og «Behold min tekst» flyttes fokus til «Angre». Etter «Angre» flyttes fokus til «Bruk». Etter «Nytt forslag» blir fokus på knappen til forslaget er klart, deretter til «Bruk».
- Gnisteikonet er `aria-hidden`. Ordet «KI» står alltid i teksten.

## 5. `AiTextMark` (KI-merket)

- Fast tekst: «Tekst fra KI, godkjent». Ingen props for tekst eller farge.
- Utseende: `Badge`-form (`h-6 rounded-full px-2.5 text-xs font-medium`), `bg-ai-50 text-ai-900 ring-1 ring-ai-200 ring-inset`, gnisteikon foran (`aria-hidden`).
- Props: `{ status: "accepted" | "edited" | string; aiUsageId?: string }`. Vises bare når `aiUsageId` finnes og `status` er `accepted` eller `edited`. Ellers `null`. Statusen skal komme fra serveren (statusoppslaget), ikke fra lokal tilstand.
- Står rett over teksten det gjelder, venstrejustert.

## 6. Prøvesiden `/prove/ki`

Én hovedhandling: «Foreslå bedre språk». Følger sideoppsettet i A (lys bakgrunn `canvas`, hvitt kort, maks bredde som andre ansattsider).

```
Prøv KI: språkvask                                 ● På nett · lagret
Bruk oppdiktet tekst. Ikke skriv navn, adresse eller
kundeopplysninger. Forslaget lagres i KI-loggen.

┌ Card ──────────────────────────────────────────────────┐
│ Setning                                                │
│ ┌──────────────────────────────────────────────────┐   │
│ │ textarea, 3 linjer, min-h 6rem                   │   │
│ └──────────────────────────────────────────────────┘   │
│                                  [ Foreslå bedre språk ]│
└────────────────────────────────────────────────────────┘

<AiSuggestion …>   (vises etter første forslag)

Logget: forslag | godtatt | avvist      (text-sm text-slate-600)
```

- **Tittel:** «Prøv KI: språkvask».
- **Fast linje:** under tittelen, `text-sm text-slate-600`, nøyaktig teksten fra oppgavekortet.
- **Nettstatus:** øverst til høyre, rolig: grønn prikk + «På nett», eller grå prikk + «Uten nett». Alltid tekst, ikke bare farge. `role="status"`.
- **Tekstfeltet:** etikett «Setning» (synlig `<label>`). Kan alltid skrives i, også mens KI jobber og uten nett.
- **«Foreslå bedre språk»:** `Button variant="primary" size="lg"` (Byggcon-blå, 56 pt), til høyre under feltet. Låst når feltet er tomt, mens KI jobber, uten nett (med forklaringen «Krever nett …» under) og når KI er av (med «KI er av.»). Den er sidens eneste hovedknapp; «Bruk» i kortet er hovedknapp inne i kortet.
- **Loggstatus:** linjen «Logget: forslag», «Logget: godtatt» eller «Logget: avvist», lest fra statusoppslaget etter hvert valg. Står under kortet, `role="status"`.
- Når KI er av for organisasjonen: kortet med feltet vises, knappen er låst, og «KI er av.» står under den. Ingen feilside.

## 7. Mål

| Ting | Mål |
|---|---|
| Hovedknapp («Bruk», «Foreslå bedre språk») | min. høyde 56 pt (`min-h-14`) |
| Andre knapper | min. høyde 44 pt (`min-h-11`), min. bredde 44 pt |
| Avstand mellom knapper | minst 8 pt (`gap-2`), 12 pt på iPad (`md:gap-3`) |
| Brødtekst | 16 pt (`text-base`), linjehøyde 1,5 |
| Kortets indre marg | 24 pt (`p-6`, som `Card`) |
| Bryter til to kolonner | 1024 px (`lg`) |

## 8. Tekster (samlet, A167)

| Sted | Tekst |
|---|---|
| Hovedknapp på siden | Foreslå bedre språk |
| Kortets overskrift | Forslag fra KI · språkvask |
| Egen tekst | Din tekst / Din tekst før |
| Knapper | Bruk · Behold min tekst · Nytt forslag · Angre |
| Arbeider | KI jobber … |
| Ingen forslag | KI hadde ikke noe forslag. Teksten din er uendret. |
| Feil | KI svarte ikke. Prøv igjen. |
| Av | KI er av. |
| Uten nett | Krever nett. Teksten din er lagret og kan skrives videre. |
| Etter behold | Du beholdt din tekst. |
| Merket | Tekst fra KI, godkjent |
| Logg | Logget: forslag / Logget: godtatt / Logget: avvist |
| Fast linje | Bruk oppdiktet tekst. Ikke skriv navn, adresse eller kundeopplysninger. Forslaget lagres i KI-loggen. |

## 9. Ikke med (som oppgavekortet)

«Endre og bruk», «Ingen treff» for frasebanken, visning av publiseringssperren, mørk visning for kortet, animasjoner utover den rolige prikken.

## 10. Sjekkliste for utvikler

- [ ] Ingen faste hex-verdier i komponentene; bare tokenene i avsnitt 2.
- [ ] Forslaget vises som ren tekst.
- [ ] «Bruk» er 56 pt, andre knapper minst 44 pt (e2e måler).
- [ ] `AiSuggestion` og `AiTextMark` importerer ikke `@/core/access`, `@/core/ai` eller `@/db`.
- [ ] `aria-live="polite"` og fokusflyt som i avsnitt 4.
- [ ] Kontrast sjekket med verktøy mot tallene i avsnitt 2.
