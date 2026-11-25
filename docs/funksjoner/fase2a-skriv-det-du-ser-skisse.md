# Skisse: «Skriv det du ser» i «+ Avvik» (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-skriv-det-du-ser.md` (fasit for regler, data, tester og tekster i grensesnittet). Står noe ulikt her og der, gjelder kortet.
- **Design:** A «Fjord» for luft og trykkflater (`docs/design/bilder/A-*.png`), Byggcon-profilen for uttrykket (`docs/design/byggcon-profil/bilder/`). KI-tonen og knappene er de samme som i «KI i veien» (`docs/funksjoner/fase2a-ki-i-veien-design.md`) og forslagskortet (`src/shared/ui/ai-suggestion.tsx`).
- **Dato:** 24.11.2026
- **Støtter hovedmål:**
  - **KI i bunnen:** «Finn med KI» ligger rett under feltet der takstmannen alt skriver. KI forbereder valget, takstmannen velger. Samme KI-tone og samme spark-ikon som resten av KI.
  - **De ansatte:** tre trykk fra notat til avvik, ett til for «Legg notatet til». Ingenting flytter seg under fingeren, og uten nett gir «Nærmeste treff» nesten samme hjelp.
  - **Færre reklamasjoner:** treffet viser punktnavnet først og TG med tekst, så han ser hvilken bygningsdel og hvilket alvor han velger. «Registrert fra før» hindrer doble avvik.

## 1. Komponenter

Gjenbruk fra `src/shared/ui`: `Button` (`secondary`, `ghost`, `primary`, `AI_BUTTON_VARIANT` brukes ikke her, se 4.2), `Input`, `FormMessage`, `Warning`, `TgBadge`, `Badge`, `AiSparkIcon`, `Card`. Ingen ny avhengighet. **Ingen ny komponent i `src/shared/ui`**: treffene er en liste med knapper i rommets mappe, og det finnes ingen annen skjerm som trenger dem nå.

Nye og endrede filer (bare i rommets mappe `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/`):

| Fil | Innhold |
|---|---|
| `add-deviation-panel.tsx` (endres) | Feltet, «Finn med KI», KI-treffene, tekstsøket, «Nærmeste treff (uten KI)», punktlisten. Notatet løftes til rommets tilstand (se 6). |
| `outcome-match-hits.tsx` (ny, klient) | Gruppen «Forslag fra KI (velg ett)»: liste med opptil tre treffknapper og meldingene. Ren visning, tilstand og handlinger kommer inn som props. |
| `outcome-hit-button.tsx` (ny, klient) | Én treffknapp: punktnavn, avvikstekst, TG-merke, eventuelt «Registrert fra før». Brukes av KI-treffene, tekstsøket og «Nærmeste treff», så de tre ser like ut. |
| `note-offer.tsx` (ny, klient) | Tilbudet under avviksteksten i avvikskortet: notatet, «Legg notatet til», «Bruk bare notatet», «Angre». |
| `outcome-match-model.ts` (ny, ren) | `outcomeMatchView(state)`: hvilke meldinger og knapper som vises (som `suggestionView`). Testes for seg. |
| `room-messages.ts` (endres) | Alle nye tekster i `OUTCOME_MATCH_TEXTS` (avsnitt 7). |

`room-model.ts` får `outcomeTgLabel(kind)` som gir teksten i merket (avsnitt 4.3). `OUTCOME_MATCH_MAX` og `OUTCOME_MATCH_NOTE_MAX` leses fra `@/shared` (kortet, «Grensene skjermen bruker»).

## 2. Oppsett, iPad stående (bredde 768–1024 px)

Panelet står der det står i dag (sand-flaten under punktet, `rounded-card bg-sand p-5 space-y-4`). Rekkefølgen ovenfra er fast, og tab-rekkefølgen følger den: felt, «Finn med KI», KI-treff, tekstsøkets treff, «Avbryt».

```
┌ Legg til avvik ─────────────────────────────────────────── (h3) ┐
│ Skriv hva du ser, eller søk                              (label) │
│ [ sprekk i flis ved sluket, litt løs                         ×]  │  Input, min-h-14
│ 34 av 500 tegn                          (bare over 400 tegn)     │
│                                                                  │
│ ( ✦ Finn med KI )                                                │  secondary lg, 56 pt
│                                                                  │
│ ┌ ✦ Forslag fra KI (velg ett) ────────────────────────────────┐ │  ai-50, border-l-4 ai-line
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ Gulv                                           [TG2]     │ │ │  treff 1, min-h-14
│ │ │ Sprekker i fliser eller fuger.                           │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ Vegger og himling                              [TG2]     │ │ │  treff 2
│ │ │ Sprekker i fliser eller fuger.                           │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ Gulv                       [Registrert fra før] [TG3]    │ │ │  treff 3
│ │ │ Fuktskade i gulvet.                                      │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ KI foreslår, du velger. Ingen er valgt på forhånd.          │ │  text-sm
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Søketreff                                                (h4)   │
│ 0 treff for teksten din.                          (aria-live)   │
│                                                                  │
│                                                   Avbryt (ghost) │
└──────────────────────────────────────────────────────────────────┘
```

Teksten i eksempelet er oppdiktet og bare plassholder; skjermen viser alltid malens egen tekst.

**Plassering uten hopp:** KI-gruppen settes inn der knappen står, mellom feltet og tekstsøket. Tekstsøkets treff flyttes ned én gang, når svaret kommer, og aldri mens takstmannen trykker: knappene i tekstsøket er sperret (`pointer-events-none`) i 300 ms etter at KI-gruppen er satt inn, så et trykk som var på vei, ikke treffer et annet treff. Knappen «Finn med KI» står igjen under gruppen som «Finn på nytt» (avsnitt 3.4).

**iPad med tastatur oppe:** feltet og knappen er de to første elementene i panelet. Når panelet åpnes, rulles panelets overskrift til toppen (`scrollIntoView({ block: "start" })`), så knappen står over tastaturet. Fokus i feltet (kortet, «Skjermer»).

**PC (1024 px og mer):** samme rekkefølge, `max-w-3xl` som rommet. Treffknappene får full bredde i gruppen; ingen kolonner, fordi punktnavnet og TG skal stå på samme sted i alle treff.

## 3. Tilstander i «+ Avvik»

`outcomeMatchView` gir én av tilstandene under. Meldingene står i en `role="status" aria-live="polite"`-linje i KI-gruppen (én linje, ikke én per melding).

| # | Tilstand | Hva som vises | Knappen |
|---|---|---|---|
| 3.1 | Tomt felt | Punktlisten for det åpne punktet (som i dag). | «Finn med KI», sperret (`disabled`), ingen melding. |
| 3.2 | Tekst, nett og KI på | Tekstsøkets treff mens han skriver (som i dag). | «Finn med KI» aktiv. |
| 3.3 | Venter på svar | Knappen viser «Finner …» med `aria-busy="true"`, sperret. Ingen spinner over treffene. | Sperret. Etter cirka 8 s uten svar: 3.7. |
| 3.4 | Treff (1–3) | KI-gruppen med treffene, ingen markert. Under: «Finn på nytt» (`secondary md`). | «Finn på nytt». |
| 3.5 | Teksten endret etter svaret | Treffene står, men grå (`text-slate-500`, kant `border-line`), og linjen «Teksten er endret – finn på nytt». Treffene kan fortsatt velges (de er malens utfall), men skjermleseren hører linjen først. | «Finn på nytt» aktiv. |
| 3.6 | Ingen utfall passer | Nøytral melding i snow-flaten: «Ingen utfall passer. Bruk søket eller punktlisten.» Ingen TG, ingen «ikke avvik». Notatet står. | «Finn på nytt». |
| 3.7 | KI svarte ikke | Varselflate (`bg-watch-fill text-watch-text`): «KI svarte ikke. Bruk søket.» | «Prøv igjen» (samme `requestId`). |
| 3.8 | KI er av | Ingen knapp. Linje i `text-sm text-slate-700`: «KI er av. Bruk søket.» | Skjult. |
| 3.9 | Uten nett | Ingen knapp. Linje: «Uten nett: bare tekstsøk.» | Skjult. |
| 3.10 | For langt notat | Under feltet, `FormMessage`: «Notatet er for langt for KI (høyst 500 tegn).» Tegntelleren blir rød tekst (ikke bare farge, tallet står). | Sperret. |
| 3.11 | For mange utfall | Melding: «For mange utfall i dette rommet for KI. Bruk søket.» | Skjult til rommet byttes. |
| 3.12 | Fødselsnummer | `FormMessage` under feltet: «Notatet ser ut til å ha et fødselsnummer. Ta det bort før du bruker KI.» Sifrene gjentas aldri. | Sperret til teksten er endret. |
| 3.13 | Utdatert | Etter valg som gir `suggestion_outdated`: treffene fjernes, melding: «Forslagene er utdatert. Trykk «Finn med KI» på nytt.» | «Finn med KI». |

**Tegntelleren** vises først over 400 tegn, så den ikke forstyrrer vanlige notater. `aria-describedby` på feltet peker på telleren og eventuell feilmelding.

**Enter i feltet:** med null tekstsøktreff, nett og KI på kjøres «Finn med KI». Ellers gjør Enter det samme som i dag. Pil ned fra feltet går til første KI-treff hvis gruppen vises, ellers til første søketreff.

**Escape og «Avbryt»** lukker panelet. Notatet blir stående i rommets tilstand (avsnitt 6). Er KI-treff åpne, kalles avvisningen i bakgrunnen; svaret vises ikke (ingen melding om noe takstmannen ikke ba om).

## 4. Treffknappen (`outcome-hit-button.tsx`)

### 4.1 Oppbygging

```
┌──────────────────────────────────────────────────────────────┐
│ Punktnavn                    [Registrert fra før]  [TG2]     │  linje 1
│ Malens avvikstekst, med … for flettefelt.                    │  linje 2
└──────────────────────────────────────────────────────────────┘
```

- **Element:** `<button type="button">` med hele flaten som trykkflate. Ikke `Button`-pillen: to linjer tekst i en pille leses dårlig. Klasser: `flex w-full min-h-14 flex-col items-stretch gap-1 rounded-card border border-line bg-white px-4 py-3 text-left hover:bg-snow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord disabled:text-slate-500`.
- **Linje 1:** punktnavnet `text-sm font-semibold text-slate-900`, til venstre. Er det et annet punkt enn det åpne, står det likevel bare navnet (ingen pil eller ikon); skjermleseren får «annet punkt» (4.4). Merkene til høyre (`ml-auto flex gap-2`).
- **Linje 2:** malens avvikstekst `text-base leading-snug text-slate-900 break-words`, med `outcomeName` (flettefelt som «…»).
- **Høyde:** minst 56 pt (`min-h-14`) på iPad; vokser med teksten. Avstand mellom treff `space-y-2` (8 px), så to treff aldri ligger kant i kant.

### 4.2 Hvorfor ikke KI-fargen på knappen

Treffet er malens utfall, ikke KI-tekst. Knappen er derfor hvit som tekstsøkets treff, og KI-tonen ligger på gruppen rundt (avsnitt 5). Da ser takstmannen at teksten er Byggcons, og at det er KI som har plukket den. `AI_BUTTON_VARIANT` brukes bare for «Bruk» i forslagskortet og ikke her.

### 4.3 TG-merket

TG står alltid med tekst (`TgBadge`, kort form med `aria-label` i lang form):

| `kind` | Merket |
|---|---|
| `tg2` | `TgBadge tg="2"` («TG2») |
| `tg3` | `TgBadge tg="3"` («TG3») |
| `choose_tg2_tg3` | `Badge` nøytral: «Velg TG2 eller TG3» (ingen TG-farge, for ingen TG er valgt) |
| `hms` | `Badge` nøytral: «HMS» |

`outcomeTgLabel(kind)` i `room-model.ts` gir teksten; `outcomeTgText` brukes videre andre steder.

### 4.4 «Registrert fra før»

- Merket `Badge` med tonen `neutral` og teksten «Registrert fra før», foran TG-merket.
- Knappen åpner det eksisterende avvikskortet (fokus på overskriften «Avvik N») i stedet for å lage nytt. Er treffet fra KI, kalles avvisningen.
- Skjermleser: knappens tilgjengelige navn bygges slik, i én `aria-label`: «{punktnavn}: {avvikstekst}. [Registrert fra før.] {TG lang form}. [Annet punkt.] [Åpner avvik N.]». Merkene inni har `aria-hidden` når `aria-label` er satt, så ingenting leses to ganger. Synlig tekst står i samme rekkefølge i koden (punkt, avvikstekst, merkene; rutenettet legger merkene øverst til høyre), så navnet inneholder det som står på knappen (WCAG 2.5.3; rettet 25.11.2026 etter axe i e2e).

### 4.5 Etter trykk

- Alle treffknapper og «Finn på nytt» sperres mens valget lagres (`aria-busy` på gruppen).
- **«Velg TG2 eller TG3»:** avviket lages som i dag uten TG, og fokus går til TG-valget i avvikskortet (`deviationTgChoiceId`). Ingen forhåndsvalg, også når notatet sier «TG3».
- **TGIU-konflikt:** samme blokk som i dag (`Warning` med «Fjern TGIU og legg til avviket» / «Behold TGIU»), vist over KI-gruppen. Treffene står til han har valgt.
- **Lagret:** panelet lukkes, punktet der avviket ble laget åpnes (`openCheckpoint` med `checkpointKey` fra serveren), fokus til avvikets overskrift, og melding «Avvik lagt til, TG2» (eksisterende `deviationAdded`). Tilbudet om notatet står i kortet (avsnitt 6).

## 5. KI-gruppen (`outcome-match-hits.tsx`)

- `<section aria-labelledby>` med `rounded-card border border-l-4 border-ai-line bg-ai-50 p-4 space-y-3`. Ingen fargeovergang.
- Overskrift `h4`: spark-ikon (`AiSparkIcon text-ai-700`, `aria-hidden`) og «Forslag fra KI (velg ett)», `text-base font-semibold text-ai-900`.
- Listen `<ul role="list">` med treffknappene i rekkefølgen KI ga. Ingen nummerering, ingen «beste treff»-merke, ingen prosent eller poeng (det ville sett ut som et råd om alvor, spørsmål 120).
- Hjelpelinjen under listen: «KI foreslår, du velger. Ingen er valgt på forhånd.» `text-sm text-slate-700`.
- Når svaret kommer: fokus blir i feltet eller på knappen (ikke flyttet), og `aria-live` sier «3 forslag fra KI. Ingen er valgt.» eller «Ingen utfall passer.». Fokus flyttes ikke, så takstmannen kan skrive videre.
- Kontrast: `text-ai-900` på `bg-ai-50` og `text-slate-900` på hvit er over 7:1. Grå tilstand (3.5) bruker `text-slate-500` på hvit (4,7:1).

## 6. Notatet etter valget (`note-offer.tsx`)

Notatet ligger i rommets klienttilstand (`room-context`), ikke i panelet, slik at det står mens rommet er åpent (A566). Det tømmes når rommet forlates (avmontering av rommets layout) og ved utlogging. Aldri `localStorage`, IndexedDB eller adressen.

Tilbudet vises i avvikskortet rett under avviksteksten, bare for avviket som nettopp ble laget fra et notat:

```
┌ Avvik 2 ─────────────────────────────────────────────────── [TG2] ┐
│ Avvik                                                              │
│ [ Sprekker i fliser eller fuger.                               ]   │  malens tekst
│                                                                    │
│ ┌ Notatet ditt ──────────────────────────────────────────────────┐│  snow, kant line
│ │ «sprekk i flis ved sluket, litt løs»                            ││
│ │ ( Legg notatet til )   ( Bruk bare notatet )                    ││  primary lg / secondary md
│ └─────────────────────────────────────────────────────────────────┘│
│ ...                                                                │
```

| Tilstand | Vises |
|---|---|
| Før trykk | Flaten «Notatet ditt» (`rounded-card border border-line bg-snow p-4 space-y-3`), notatet i anførselstegn (`text-base text-slate-900`), «Legg notatet til» (`Button` `primary` `lg`, 56 pt) og «Bruk bare notatet» (`secondary` `md`, 44 pt). Ingen KI-tone: notatet er takstmannens egne ord. |
| Flettefelt i malens tekst | «Bruk bare notatet» vises ikke. Linjen «Malens tekst har en måling eller et årstall, så notatet kan bare legges til.» `text-sm text-slate-700`. |
| Etter «Legg notatet til» eller «Bruk bare notatet» | Flaten byttes ut med linjen «Notatet er lagt til.» eller «Notatet er brukt som avvikstekst.» (`role="status"`), «Angre» (`secondary md`) og «Språkvask avviket» (eksisterende knapp, flyttet hit) side om side. Fokus til «Angre». |
| Etter «Angre» | Linjen «Malens tekst er satt tilbake.» og knappene «Legg notatet til» / «Bruk bare notatet» igjen. Fokus til «Legg notatet til». |
| Lukket kort eller nytt avvik | Tilbudet forsvinner uten å endre noe. Malens tekst står (ingen trykk nødvendig). |
| Lagringsfeil | `FormMessage` med feilen fra feltlagringen; teksten i feltet er uendret. |

- «Angre» har ingen tidsgrense og står så lenge kortet er åpent (WCAG 2.2.1).
- Tilbudet står aldri over kameraknappen eller «+ Avvik»; det ligger inne i avvikskortet og tar ingen fast plass på skjermen.
- Lagringen går gjennom den vanlige feltlagringen; skjermen viser lagret-status som andre felt (`SaveState`).

## 7. Tekster (`OUTCOME_MATCH_TEXTS` i `room-messages.ts`)

| Nøkkel | Tekst |
|---|---|
| `fieldLabel` | Skriv hva du ser, eller søk |
| `find` | Finn med KI |
| `finding` | Finner … |
| `findAgain` | Finn på nytt |
| `retry` | Prøv igjen |
| `groupHeading` | Forslag fra KI (velg ett) |
| `groupHelp` | KI foreslår, du velger. Ingen er valgt på forhånd. |
| `ranked(n)` | `${n} forslag fra KI. Ingen er valgt.` (1: «1 forslag fra KI.») |
| `noMatch` | Ingen utfall passer. Bruk søket eller punktlisten. |
| `error` | KI svarte ikke. Bruk søket. |
| `aiOff` | KI er av. Bruk søket. |
| `offline` | Uten nett: bare tekstsøk. |
| `noteTooLong` | Notatet er for langt for KI (høyst 500 tegn). |
| `noteCount(n, max)` | `${n} av ${max} tegn` |
| `nationalId` | Notatet ser ut til å ha et fødselsnummer. Ta det bort før du bruker KI. |
| `tooManyCandidates` | For mange utfall i dette rommet for KI. Bruk søket. |
| `stale` | Teksten er endret – finn på nytt |
| `outdated` | Forslagene er utdatert. Trykk «Finn med KI» på nytt. |
| `searchHeading` | Søketreff |
| `nearestHeading` | Nærmeste treff (uten KI) |
| `registered` | Registrert fra før |
| `opensDeviation(n)` | `Åpner avvik ${n}.` |
| `otherCheckpoint` | Annet punkt. |
| `chooseTg` | Velg TG2 eller TG3 |
| `hms` | HMS |
| `noteHeading` | Notatet ditt |
| `addNote` | Legg notatet til |
| `useNoteOnly` | Bruk bare notatet |
| `noteOnlyBlocked` | Malens tekst har en måling eller et årstall, så notatet kan bare legges til. |
| `noteAdded` | Notatet er lagt til. |
| `noteUsed` | Notatet er brukt som avvikstekst. |
| `undo` | Angre |
| `templateRestored` | Malens tekst er satt tilbake. |

Ingen tekst nevner diktering, mikrofon eller tale (spørsmål 121). Eksempler i tester og e2e uten gjetteord («trolig», «antas»).

## 8. Uten nett og KI av: «Nærmeste treff (uten KI)»

- Vises når tekstsøket gir null treff og det er uten nett eller KI er av. Ingen trykk trengs (vises mens han skriver, med 250 ms ro).
- Samme oppsett som KI-gruppen, men uten KI-tone: `rounded-card border border-line bg-white p-4`, overskrift `h4` «Nærmeste treff (uten KI)» uten spark-ikon. Opptil tre treffknapper (avsnitt 4), samme «Registrert fra før».
- Linjen «Uten nett: bare tekstsøk.» står over, så han forstår hvorfor KI-knappen mangler. Synkstatusen i toppen er som ellers.
- Ingen treff over grensen: «Ingen avvik passer.» som i dag.
- «Forslag» uten nett (T-0146) bruker samme rangering; visningen der endres ikke ut over at treffene kommer.

## 9. Mørk visning

Bruker bare tokenene (`bg-sand`, `bg-snow`, `bg-ai-50`, `border-ai-line`, `border-line`, TG-tokenene), så mørk visning følger av `globals.css` uten egne klasser. Treffknappen bruker `bg-white` med kant `border-line`, samme klasser som `Card` (`tone="default"`), så den følger kortene når mørk visning kommer. Ingen egne `dark:`-klasser.

## 10. Universell utforming

- Alle trykkflater minst 44 pt; «Finn med KI», treffene og «Legg notatet til» 56 pt.
- Fokusring `outline-fjord` 2 px med 2 px avstand på alle knapper, også treffknappen.
- `aria-live="polite"` for svaret, `aria-busy` på knappen og gruppen mens det lagres. Ingen `assertive`.
- TG aldri bare farge: tekst i merket og lang form for skjermleser.
- Gruppen «Forslag fra KI» og «Nærmeste treff» er `section` med overskrift, så de finnes i overskriftslisten.
- `prefers-reduced-motion`: ingen animasjon på gruppen (bare «Finner …»-teksten, uten puls).
- axe uten funn på PC og iPad-størrelse i alle tilstandene i avsnitt 3 og 6 (e2e).

## 11. Mål i e2e (for testskriveren)

- `data-testid`: `outcome-match-find`, `outcome-match-group`, `outcome-match-hit` (med `data-checkpoint` og `data-registered`), `outcome-match-message`, `outcome-nearest-group`, `note-offer`, `note-offer-add`, `note-offer-only`, `note-offer-undo`.
- Høyde: `outcome-match-find` og `outcome-match-hit` ≥ 56 px i iPad-størrelse.
- Ingen treff har `aria-pressed`, `aria-selected` eller `aria-current` når svaret kommer (ingen forhåndsvalgt).

## 12. Avvik fra A

Ingen. Oppsettet er sand-panelet fra «+ Avvik» (A382), KI-tonen fra «KI i veien», og pilleknappene og kortene fra Byggcon-profilen. Treffknappen er et kort med tynn kant og 12 px hjørner (ikke pille), som A bruker for rader med to linjer.
