# Design: KI i veien (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-ki-i-veien.md` (2a-2, «KI i veien»), testplanen `docs/funksjoner/fase2a-ki-i-veien-testplan.md` (avsnitt 7)
- **Fasit:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-konstr-pc.png`, `A-ipad-liggende.png`, `A-ipad-staende.png`; boksen «Forslag fra KI · bygget på frasebanken» i sidepanelet), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/funksjoner/fase2a-byggcon-profil-design.md`), og det som finnes: `docs/funksjoner/fase2a-forslagsmonster-design.md` og `docs/funksjoner/fase2a-badet-pc-design.md`. Ved motstrid gjelder oppgavekortet.
- **Laget av:** ui-designer, 17.11.2026
- **Støtter hovedmål:**
  - **KI i bunnen:** alle tre funksjonene bruker samme KI-tone, samme gnisteikon, ordet «KI» og samme forslagskort, så KI kjennes igjen overalt og aldri forveksles med regelforslag eller TG.
  - **De ansatte:** fem KI-kontroller per avvikskort, forslagslisten rett under feltet uten sprettopp, to trykk fra «Forslag» til tekst, ingenting hopper i oppsettet, og samme oppførsel uten nett.
  - **Færre reklamasjoner:** TG står alltid som tekst i listen og i utkastet, stoppede KI-svar sier hvorfor rett ved feltet, og sammendraget sier fra når det ikke lenger stemmer med funnene.

## 1. Avvik og designvalg (krever ikke godkjenning, avvik fra A er ikke med)

| # | Valg | Hvorfor |
|---|---|---|
| D1 | Én tekst for «uten nett» i alle KI-kort: `AI_SUGGESTION_TEXTS.offline` blir «Trenger nett. Teksten din er lagret.» (kortets A439). | To ulike tekster for samme ting forvirrer. Testene som leser den gamle teksten, rettes i samme PR. |
| D2 | Forslagslisten er en synlig liste med knapper (`<ul>` med `<button>`, piltaster med flyttbar `tabindex`), ikke `role="listbox"`. | Samme mønster som søket i «+ Avvik» (A382), så takstmannen lærer én liste. Testplanen K7.13 tillater «tilsvarende». |
| D3 | Alle knapper som **ber KI om noe** («Språkvask avviket», «Språkvask», «Lag utkast») er `secondary` med gnisteikon. Bare «Bruk» og «Bruk alle» har KI-fyll (`ai`). «Forslag» har ikke gnisteikon. | KI-fyllet betyr «dette setter KI-tekst inn». «Forslag» gir malens egne tekster og virker uten KI, så det skal ikke se ut som KI-tekst. |
| D4 | Merket «Utkast» står ved etiketten på alle tekstfelt der teksten er malens standardtekst med `text_status = draft`, ikke bare etter et fraseforslag. | Én regel for samme status. Merket forsvinner av seg selv når fagrådet godkjenner tekstene (2a-3). |
| D5 | Stoppede KI-svar vises i nøytral flate (`snow`), ikke gul. | Gult betyr TG2. Et stoppet svar er ingen fare: teksten er uendret. |

## 2. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `AiSuggestion`: utfallet `stopped` og tekst D1 | `src/shared/ui/ai-suggestion.tsx` | endret |
| `AiSuggestionGroup` (før og etter for flere felt) | `src/shared/ui/ai-suggestion-group.tsx` | ny |
| `ReportTextField`: plass i etikettlinjen, «Utkast»-merket, plass for «Angre» | `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/report-text-field.tsx` | endret |
| `PhraseButton` og `PhraseList` (fraseforslag) | samme mappe, `phrase-suggestions.tsx` | ny |
| `PolishDeviation` (knapp + gruppekort i avvikskortet) | `polish-deviation.tsx` | ny |
| `ReportSummarySection` | `report-summary-section.tsx` | ny |
| `DeviationCard`, `CheckpointPanel`, `RoomView` | eksisterende filer | endret (kobler inn de nye delene) |
| Snarveiene | `shortcuts.ts` | endret (én linje) |

Ingen nye fargetokener og ingen nye knappevarianter. Bruk `Card`, `Button`, `Badge`, `TgBadge`, `Warning`, `FormMessage`, `AiTextMark` og `AiSparkIcon`. Ingen faste hex-verdier. Komponentene i `src/shared/ui` importerer ikke `src/core`, `src/db` eller moduler. Alle tekster samles i `room-messages.ts` (skjermen) og `AI_SUGGESTION_TEXTS` (kortene).

## 3. Avvikskortet med KI (A436)

```
┌ Card (hvit, kant line, 12 px) ─────────────────────────────────────────────────┐
│ Avvik 1   [TG2 Vesentlige avvik]                    [✦ Språkvask avviket]      │
│ Utfall: For lite fall til sluk · Fra forslag fra reglene                       │
│                                                                                 │
│ ┌ AiSuggestionGroup (vises etter trykk) ──────────────────────────────────────┐ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
│ TG          ( TG2 ) ( TG3 )                                                     │
│ Avvik  [Utkast]                                            [≡ Forslag]          │
│ [ textarea ]                                                        Lagret      │
│   PhraseList (rett under feltet når den er åpen)                                │
│ Årsak       ( kriterium ) …                                                     │
│ Årsak                                                      [≡ Forslag]          │
│ [ textarea ]                                                                    │
│ Konsekvens                                                 [≡ Forslag]          │
│ [ textarea ]                                                                    │
│ Tiltak                                                     [≡ Forslag]          │
│   PhraseList (rett under overskriften når den er åpen)                          │
│ 1. [ textarea ]                        [Opp] [Ned] [Fjern tiltak]               │
│ [ + Tiltak ]  [ + Standardtiltak ]                                              │
│ …                                                                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Fem KI-kontroller per kort** (K7.14): én «Språkvask avviket» og fire «Forslag». Ingen andre.
- **«Språkvask avviket»:** `Button variant="secondary" size="md"`, `AiSparkIcon` foran (`text-ai-700`, `aria-hidden`), høyrejustert i kortets topplinje. Under 768 px bredde brytes den til egen linje under overskriften, høyrejustert. HMS-avvik har samme knapp.
- **«Forslag»:** `Button variant="secondary" size="md"`, `px-3`, linjeikon (tre korte streker, inline SVG, `aria-hidden`) og det synlige ordet «Forslag». Står til høyre i etikettlinjen. Tilgjengelig navn: «Forslag til avvik (/)», «Forslag til årsak (/)», «Forslag til konsekvens (/)», «Forslag til tiltak (/)». Det synlige ordet står i navnet (WCAG 2.5.3). `aria-expanded` og `aria-controls` peker på listen.
- **Etikettlinjen:** `flex items-end justify-between gap-3`, etiketten til venstre. Knappen står alltid der (også med tom tekst), så ingenting hopper når fokus flyttes.
- Kontor og andre uten `report.edit` ser ingen av knappene (K7.15).

## 4. Fraseforslag: `PhraseList` (A433, A437, A468)

### Oppbygging

```
┌ flate sand, 12 px, p-4 (samme flate som «+ Avvik») ────────────────────────────┐
│ [✦] Sortert av KI                                      4 forslag  (text-sm)     │
│ ┌ knapp (hvit, kant line, 12 px, p-4) ─────────────────────────────────────────┐│
│ │ Fallet mot sluket er mindre enn anbefalt, så vann kan bli stående.  (16 px) ││
│ │ Sluk og fall · For lite fall   [TG2]  [Utkast]  [Mest brukt]      Sett inn  ││
│ └──────────────────────────────────────────────────────────────────────────────┘│
│ ┌ … 2–4 til ─┐                                                                  │
│                                                                    [ Lukk ]     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Står i flyten rett under feltet (for tiltak: rett under overskriften «Tiltak»), aldri som sprettopp eller dialog. Full bredde i kortet; ingen vannrett rulling ned til 768 px (K7.17).
- **Overskriften** (`text-sm font-medium`) sier hvor listen kommer fra, alltid med tekst:
  - «Tekstsøk» (`text-slate-700`, uten ikon): vises med en gang.
  - «Sortert av KI» (`text-ai-900`, `AiSparkIcon` i `text-ai-700`): når KI-rangeringen er kommet.
  - «Uten KI: treff fra tekstsøk» (`text-slate-700`): uten nett, KI av, eller KI svarte ikke.
  - Til høyre antall: «4 forslag» / «3 treff».
- **Hver kandidat** er én knapp: `w-full text-left rounded-xl border border-line bg-white p-4 min-h-11`, hover `bg-snow`, fokus fjordrammen. Innhold:
  1. Teksten slik den havner i feltet, med flettefeltene satt inn (`text-base text-slate-900 whitespace-pre-wrap`). Hele teksten vises, ingen kutt.
  2. Metalinje (`text-sm text-slate-700`, `flex flex-wrap gap-2`): punkt · utfall, `TgBadge` kort form (eller `Badge` «HMS»), `Badge tone="neutral"` «Utkast», og `Badge tone="neutral"` «Mest brukt» når kandidaten har flest valg (minst to). Helt til høyre handlingsordet i `font-semibold`: «Sett inn» (tomt felt eller malens tekst), «Bytt ut teksten» (feltet har egen tekst fra takstmannen), «Legg til som tiltak» (tiltak).
  3. Mangler en flettefeltverdi: `[årstall mangler]` i teksten og linjen «Fyll inn årstall i teksten.» (`text-sm`, samme tekst som `Warning` i kortet) i knappen.
- Knappens tilgjengelige navn: handlingsordet, så teksten, så metalinjen: «Bytt ut teksten: Fallet mot sluket …, Sluk og fall, For lite fall, TG2 Vesentlige avvik, utkast, mest brukt».
- «Mest brukt» har `sr-only`-tillegget «i organisasjonen». Tallet vises aldri, og aldri hvem.
- **«Lukk»:** `Button variant="secondary" size="md"` nederst til høyre. Esc gjør det samme.

### Tilstander

| Tilstand | Hva vises |
|---|---|
| `searching` (åpnet) | Tekstsøket med en gang under «Tekstsøk». Uten treff: «Ingen treff i tekstsøket. KI ser etter …» (`motion-safe:animate-pulse` på prikkene). |
| `swapping` (ca. 150 ms) | Listen byttes én gang til KI-rekkefølgen. `aria-busy="true"` og `pointer-events-none` på listen i byttet; ingen trykk tas imot. |
| `ranked` | «Sortert av KI», 1–5 kandidater. |
| `no_match` | «Ingen treff. KI fant ingen tekst som passer.» som tekst i flaten. Bare «Lukk». |
| `fallback` | Uten nett, KI av eller KI-feil: tekstsøket blir stående under «Uten KI: treff fra tekstsøk». Ingen feilmelding ut over overskriften. Uten treff: «Ingen treff.» |
| `limit` | Over grensen fra serveren: tekstsøket blir stående, med linjen «Teksten er for lang for KI. Treffene er fra tekstsøk.» |

### Etter valg (A437)

- Listen lukkes. Avvik, årsak og konsekvens: teksten erstattes. Tiltak: nytt tiltak nederst i listen.
- Under feltet (tiltak: under det nye tiltaket), i plassen for «Angre»: linjen «Teksten er satt inn.» / «Teksten er byttet ut.» / «Tiltaket er lagt til.» (`text-sm`) og `Button variant="secondary" size="md"` «Angre». Den står til fokus går til et annet felt eller punkt. «Angre» på tiltak fjerner det nye tiltaket.
- Fokus går til feltet (tiltak: det nye feltet), markøren til slutt i teksten.
- Hører teksten til en annen TG enn avviket, vises advarselen som finnes («Se over konsekvens og tiltak. Teksten hører til TG3.»).
- Feltet beholder merket «Utkast» (D4). Ingen `AiTextMark`: teksten er malens, ikke KI-tekst.

### Tastatur og skjermleser

- «/» først i tomt felt (tegnet skrives ikke) og Ctrl+. i feltet åpner listen. «/» i tekst skrives som vanlig. Ny linje i `SHORTCUTS`: «/ først i tomt felt, eller Ctrl + .» → «Forslag til feltet».
- Når listen åpnes, går fokus til første kandidat. ↑/↓ flytter mellom kandidatene (flyttbar `tabindex`, bare én kandidat i tabulatorrekkefølgen), Home/End til første og siste, Enter og mellomrom velger, Tab går til «Lukk», Esc lukker og gir fokus tilbake dit listen ble åpnet fra (feltet eller «Forslag»).
- Byttes listen mens fokus står i den, får samme kandidat fokus på sin nye plass; finnes den ikke lenger, første kandidat.
- `role="status" aria-live="polite"` i listen: «3 treff fra tekstsøk.», «Sortert av KI. 4 forslag.», «Ingen treff.», «Uten KI: 3 treff fra tekstsøk.», «Teksten er byttet ut. Angre står under feltet.»

## 5. Språkvask: `AiSuggestionGroup` (A436, A460)

### Oppbygging

```
┌ Card ───────────────────────────────────────────────────────────────────────────┐
│ ✦ Forslag fra KI · språkvask av avvik 1                                 (h4)    │
│ ── Avvik ────────────────────────────────────────────────────────────────────── │
│ Din tekst                         │ Forslag fra KI                              │
│ (egen tekst)                      │ ┌ ai-50, kant ai-line, l-4 ──────────────┐  │
│                                   │ └────────────────────────────────────────┘  │
│                                            [ Behold min ]  [  Bruk  ]           │
│ ── Årsak ─────────────────────── Ingen endring.                                 │
│ ── Konsekvens ── KI-svaret ble stoppet fordi det endret TG eller la til tall.   │
│                  Teksten din er uendret.                                        │
│ ── Tiltak 1 ── …                                                                │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ [ Nytt forslag ]  [ Behold min tekst ]                        [   Bruk alle   ] │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Står øverst i avvikskortet, rett under topplinjen, så svaret kommer der trykket var. Beskrivelsen på punktet bruker samme komponent med én rad, rett under feltet.
- **Én rad per felt med tekst**, i kortets rekkefølge: Avvik, Årsak, Konsekvens, Tiltak 1 … Feltnavnet som `h5` (`text-sm font-semibold`), skilt med `border-t border-line pt-4`. Raden bruker `suggestionView` og `SuggestionBox` fra `ai-suggestion.tsx`, så tilstandene er de samme som i `AiSuggestion`.
- **Kolonner:** to fra 1024 px, én under (egen tekst øverst).
- **Per rad:** «Bruk» (`ai`, `md`), «Behold min» (`secondary`, `md`); etter valg «Angre» (`secondary`, `md`). Rader uten endring fra KI viser bare «Ingen endring.» uten knapper. Etter «Bruk» står `AiTextMark` over forslaget, og feltet får `AiTextMark` når serveren har bekreftet.
- **Bunnlinjen:** «Bruk alle» (`ai`, `lg`, 56 pt) til høyre, gjelder radene som er åpne; «Behold min tekst» (`secondary md`) avviser alle åpne; «Nytt forslag» (`secondary md`) ber om nytt for alle felt med tekst. DOM-rekkefølge: Bruk alle, Behold min tekst, Nytt forslag (visuelt `flex-row-reverse`).
- **Ingen åpne rader igjen:** bunnlinjen viser bare «Nytt forslag». Kortet står til punktet forlates.
- `busy` låser alle knapper i kortet.

### Tilstander per rad (i tillegg til dem i forslagsmønsteret)

| Utfall | Tekst i raden | Knapper i raden |
|---|---|---|
| `stopped` (`tg_guard`, `number_guard`) | KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret. | ingen |
| `stopped` (`placeholder_guard`) | KI-svaret ble stoppet fordi det endret skjulte opplysninger. Teksten din er uendret. | ingen |
| uendret | Ingen endring. | ingen |
| for lang | Teksten er for lang for språkvask. Grensen er {n} tegn. | ingen |

Et stoppet felt stopper ikke de andre (A460). Stoppet tekst vises aldri. Flaten er `snow` (D5).

### Før og uten kall

- Ingen felt med tekst: ingen kall; linjen «Det er ingen tekst å språkvaske.» ved knappen.
- Uten nett: knappen er trykkbar og svarer «Trenger nett. Teksten din er lagret.» rett under knappen (A439). KI av: «KI er av.» Ingen kort åpnes.
- Mens KI jobber: kortet vises med «KI jobber …» i hver rad, knappen viser «Språkvasker …» og er låst.

### Skjermleser og fokus

- Kortet er `<section aria-labelledby>`. Ett `role="status" aria-live="polite"` for kortet: «Språkvask klar: 3 forslag, 1 stoppet.», «Avvik: forslaget er brukt.», «Alle forslag er brukt.», «Angret».
- Når svaret kommer, går fokus til kortets overskrift (`tabIndex={-1}`). Etter «Bruk» i en rad går fokus til «Angre» i raden; etter «Bruk alle» til «Nytt forslag».

## 6. `AiSuggestion` (endret)

- `AiSuggestionCardOutcome` får `"stopped"`, og staten får `stoppedText?: string` (teksten velges av skjermen etter vaktkoden; komponenten kjenner ikke kodene).
- `stopped` vises som meldingsboks `neutral` med teksten, knappen «Nytt forslag». Et forrige forslag som står igjen, vises som før med meldingen som linje under (som A164).
- D1: `offline` blir «Trenger nett. Teksten din er lagret.»

## 7. `ReportTextField` (endret)

- Ny prop `labelAction?: ReactNode`: står til høyre i etikettlinjen («Forslag», «Språkvask»).
- Ny prop `draftMark?: boolean`: `Badge tone="neutral"` «Utkast» rett etter etiketten, med `sr-only` «, standardtekst som ikke er godkjent ennå» (D4).
- Ny prop `undo?: ReactNode`: plassen for linjen med «Angre» (avsnitt 4), mellom lagrestatusen og forslagslisten.
- `aiSuggestion` brukes til `PhraseList` eller `AiSuggestionGroup`.
- Lagring av tekst med plassholder (`[navn]`, `[adresse]` …) gir feilen i feltet: «Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.» Teksten blir stående i feltet.

## 8. `ReportSummarySection` (A434, A435, A461, A462, A465)

Nederst i punktkolonnen på badskjermen, etter «Å se over» og over nedre linje. Skilt fra punktet med `mt-12 border-t border-line pt-8`, så den ikke leses som en del av punktet.

```
Sammendrag for hele rapporten                                     (h2, Schibsted)

┌ Warning ────────────────────────────────────────────────────────────────────┐
│ Se over: Funnene er endret etter sammendraget. Lag nytt utkast.             │
│  • Vanntett sjikt, membran og sluk: TG endret til TG3      (lenke)          │
│  • Sluk og fall: nytt funn                                 (lenke)          │
└─────────────────────────────────────────────────────────────────────────────┘
┌ Warning ── Se over: Vanntett sjikt, membran og sluk har TG3 og er ikke nevnt ┐
┌ Card ───────────────────────────────────────────────────────────────────────┐
│ Sammendrag                                         [✦ Lag utkast]           │
│ [ textarea, min-h-40 ]                                          Lagret      │
│ Ingen avvik med TG ennå.            (ved knappen, når det gjelder)          │
└─────────────────────────────────────────────────────────────────────────────┘
  Se over: 2 avvik mangler TG og er ikke med.     (etter «Lag utkast»)
  AiSuggestion · «Forslag fra KI · utkast til sammendrag»
```

- **Feltet:** `ReportTextField` med etiketten «Sammendrag», `labelAction` = «Lag utkast» (`secondary md`, gnisteikon), `min-h-40`, grensen fra `limits.ts`, telling av tegn og fødselsnummer-sperren som i andre felt.
- **«Lag utkast»** overskriver aldri. Utkastet vises i `AiSuggestion` under feltet med «Din tekst» og forslaget; bare «Bruk» bytter teksten (med «Angre»). Forslaget vises med `whitespace-pre-wrap`, så kodens overskrifter og avsnitt står på egne linjer. Overskriftene har alltid TG med tekst, for eksempel «TG3 Store eller alvorlige avvik», «TG2 Vesentlige avvik», «TGIU Ikke undersøkt», «HMS» (samme lange former som `TgBadge`). Avsnittene starter med punktets navn.
- **Ingen godkjente funn:** knappen er låst (`disabled`, stone-fyll) og «Ingen avvik med TG ennå.» står rett under, koblet med `aria-describedby`.
- **Avvik uten TG** (A465): etter trykk står `Warning` «2 avvik mangler TG og er ikke med.» over forslagskortet, med «Rett nå» som går til første avvik uten TG.
- **Funnene er endret:** `Warning` over kortet med lista over funn som er endret, nye eller fjernet. Hvert funn er en lenke som åpner punktet (uten ny innlasting) og legger fokus på avvikskortet. Tekstene: «{punkt}: nytt funn», «{punkt}: TG endret til TG3», «{punkt}: funnet er fjernet», «{punkt}: teksten er endret».
- **Ikke nevnt:** én `Warning` per TG3- eller TGIU-punkt som ikke står i teksten: «{punkt} har TG3 og er ikke nevnt i sammendraget.» / «… har TGIU og …». Gjelder også tekst skrevet for hånd.
- Advarslene sperrer aldri, og «Ferdig med punktet» virker som før.
- **Stoppet eller feil** (meldingsboks i `AiSuggestion`, `neutral`): `coverage_guard` «Utkastet ble stoppet fordi et funn manglet. Prøv igjen.»; `tg_guard` og `number_guard` «KI-svaret ble stoppet fordi det endret TG eller la til tall. Sammendraget ditt er uendret.»; `placeholder_guard` «KI-svaret ble stoppet fordi det endret skjulte opplysninger. Sammendraget ditt er uendret.»; for mange funn «Rapporten har flere enn {n} funn. Utkastet kan ikke lages. Skriv sammendraget selv.»
- **Uten nett / KI av:** som språkvask: «Trenger nett. Teksten din er lagret.» / «KI er av.» rett under knappen.
- **Kontor:** overskriften, teksten skrivebeskyttet (eller «Ikke skrevet ennå.») og advarslene. Ingen knapper.
- `role="status" aria-live="polite"` i seksjonen: «Utkast klart», «Sammendraget er brukt», «Funnene er endret etter sammendraget».

## 9. Tekster (samlet)

| Sted | Tekst |
|---|---|
| Knapper | Forslag · Språkvask avviket · Språkvask · Lag utkast · Bruk · Bruk alle · Behold min · Behold min tekst · Nytt forslag · Angre · Lukk |
| Tilgjengelige navn | Forslag til avvik (/) · Forslag til årsak (/) · Forslag til konsekvens (/) · Forslag til tiltak (/) |
| Listens overskrift | Tekstsøk · Sortert av KI · Uten KI: treff fra tekstsøk |
| Merker | Utkast · Mest brukt |
| Handlingsord i kandidat | Sett inn · Bytt ut teksten · Legg til som tiltak |
| Etter valg | Teksten er satt inn. · Teksten er byttet ut. · Tiltaket er lagt til. |
| Ingen treff | Ingen treff. KI fant ingen tekst som passer. · Ingen treff i tekstsøket. KI ser etter … · Ingen treff. |
| Kortets overskrift | Forslag fra KI · språkvask av avvik {n} · Forslag fra KI · språkvask · Forslag fra KI · utkast til sammendrag |
| Stoppet (tall/TG) | KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret. |
| Stoppet (plassholder) | KI-svaret ble stoppet fordi det endret skjulte opplysninger. Teksten din er uendret. |
| Stoppet (dekning) | Utkastet ble stoppet fordi et funn manglet. Prøv igjen. |
| Uten nett | Trenger nett. Teksten din er lagret. |
| KI av | KI er av. |
| Tomt | Det er ingen tekst å språkvaske. · Ingen endring. |
| For lang | Teksten er for lang for språkvask. Grensen er {n} tegn. · Teksten er for lang for KI. Treffene er fra tekstsøk. |
| Sammendrag | Sammendrag for hele rapporten · Ingen avvik med TG ennå. · {n} avvik mangler TG og er ikke med. · Funnene er endret etter sammendraget. Lag nytt utkast. · {punkt} har TG3 og er ikke nevnt i sammendraget. · Rapporten har flere enn {n} funn. Utkastet kan ikke lages. Skriv sammendraget selv. · Ikke skrevet ennå. |
| Plassholder | Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi. |

Eksempeltekstene i skissene er plassholdere; kandidattekstene kommer fra malen.

## 10. Mål

| Ting | Mål |
|---|---|
| «Bruk alle», «Bruk» i sammendragskortet | min. 56 pt (`min-h-14`) |
| «Forslag», «Språkvask …», «Lag utkast», «Bruk» per rad, «Behold min», «Angre», «Lukk» | min. 44 × 44 pt (`min-h-11 min-w-11`) |
| Kandidat i listen | min. 44 pt høy, full bredde, `p-4` |
| Mellomrom mellom kandidater | 8 px (`space-y-2`), 12 px fra `md` |
| Avstand mellom knapper | 8 px (`gap-2`), 12 px fra `md` |
| Hjørner | kort og kandidater 12 px, felt 8 px, knapper og merker runde |
| Brødtekst | 16 px, linjehøyde 1,5; metalinje og meldinger 14 px |
| To kolonner i forslagskortene | fra 1024 px (`lg`) |
| Bytte av liste | ca. 150 ms, ingen animasjon med `prefers-reduced-motion` |

## 11. Universell utforming

- WCAG 2.1 AA. Ingen nye fargepar; alle brukte par står i `contrast.test.ts` fra før (`ai-900`/`slate-900` på `ai-50`, hvit på `ai-700`, `night` på `sand`, `slate-700` på hvit og `sand`).
- Ingen informasjon bare i farge: KI har gnisteikon og ordet «KI», TG står alltid som tekst, «Utkast» og «Mest brukt» er tekst.
- Ett `aria-live="polite"` per liste, per gruppekort og for sammendraget; aldri `assertive`, ingen melding som forsvinner av seg selv.
- Hele flyten med tastatur, ingen fokusfelle. Esc lukker listen og gir fokus tilbake.
- axe uten brudd med åpen liste, åpent gruppekort og sammendragsseksjonen (K7.13), på PC, iPad liggende og stående.
- Mørk visning: bare tokens, ingen egne farger.

## 12. Ikke med

Markering av hvilke ord språkvasken endret, KI-knapper i TGIU-feltene, sammendraget på rapportoversikten (2a-3), visning av KI-loggen for leder, kostnad i sammendraget, mørk visning og kompakt visning.

## 13. Sjekkliste for utvikler

- [ ] Fem KI-kontroller per avvikskort (1 «Språkvask avviket» + 4 «Forslag»), ingen for kontor.
- [ ] Forslagslisten står i flyten rett under feltet, byttes én gang og tar ikke imot trykk under byttet.
- [ ] Kandidatteksten er kjernens egen, med flettefeltene satt inn; aldri `{…}`.
- [ ] TG står som tekst i listen og i utkastets overskrifter.
- [ ] «Forslag» har ikke gnisteikon; KI-utløsere er `secondary` med gnisteikon; bare «Bruk» og «Bruk alle» har `ai`-fyll.
- [ ] Stoppet tekst vises aldri; meldingen står ved feltet, i `snow`, og de andre feltene kan brukes.
- [ ] «Lag utkast» overskriver aldri; bare «Bruk» bytter teksten.
- [ ] Uten nett: «Forslag» gir tekstsøk, språkvask og utkast svarer «Trenger nett. Teksten din er lagret.»
- [ ] «/», Ctrl+., piltaster, Home/End, Enter, Esc som i avsnitt 4; snarveien står i «?»-listen.
- [ ] Knappemålene i avsnitt 10 (e2e måler), ingen vannrett rulling på iPad stående.
- [ ] Ingen faste hex-verdier; `src/shared/ui` importerer ikke `src/core` eller `src/db`.
