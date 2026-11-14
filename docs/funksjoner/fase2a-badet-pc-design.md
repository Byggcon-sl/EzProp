# Design: Badet på PC (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-badet-pc.md` (2a-2, punkt 3)
- **Fasit:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-konstr-pc.png`, `A-ipad-liggende.png`, `A-ipad-staende.png`), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/`, `docs/funksjoner/fase2a-byggcon-profil-design.md`)
- **Laget av:** ui-designer, 14.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** skjermen viser forskriftens struktur (TG, årsak, konsekvens, tiltak, kostnad; TGIU med begrunnelse) som faste felt, og mangler står som advarsel på punktet og i listen før rapporten går ut.
  - **De ansatte:** ett skjermbilde for hele badet, to trykk fra regelforslag til ferdig avvik, ingen «Lagre»-knapp, lagrestatus alltid synlig.
  - **KI i bunnen:** tekstfeltene bygges med plass til KI-merket (`AiTextMark`) og forslagskortet (`AiSuggestion`), så «KI i veien» bare kobler seg på. Regelforslag er ikke KI og har ikke KI-tonen.

## 1. Avvik fra A (innenfor det A tillater)

- **Ingen høyre sidekolonne** (bilder, fraser, kommentarer): bilder, frasebank og KI kommer i egne punkter. Midtkolonnen får bredden.
- **Ingen faner øverst** (Eiendom, Bygninger …) og ingen «Send til sidemann»: ikke i planen nå.
- **Forslagsboksen fra A er gul.** Her er den `sand` med TG-merket inni, så gult bare betyr TG2 (profilen: «gult betyr følg med»).
- **Avviksspørsmål med Ja/Nei fra A** erstattes av «+ Avvik» med utfallene som knapper (oppgavekortet). Ja/Nei-knappene kommer med befaringsvisningen i 2b.
- Ingen andre avvik fra A. Krever ikke godkjenning fra prosjektlederen.

## 2. Hva som lages

Få nye byggeklosser. Tre er generelle og legges i `src/shared/ui`; resten hører bare til skjermen og legges i rutemappen.

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `TgBadge` (TG-merket, A246) | `src/shared/ui/tg-badge.tsx` | ny |
| `ChoiceButtons` (valg som pilleknapper) | `src/shared/ui/choice-buttons.tsx` | ny |
| `SaveState` (lagrestatus per felt og samlet) | `src/shared/ui/save-state.tsx` | ny |
| `Warning` (advarsel som ikke sperrer) | `src/shared/ui/warning.tsx` | ny |
| `RoomPage` (oppsett, toppfelt, nedre linje) | `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/page.tsx` + `room-view.tsx` | ny |
| `CheckpointList` | samme mappe, `checkpoint-list.tsx` | ny |
| `CheckpointPanel` | `checkpoint-panel.tsx` | ny |
| `RuleSuggestionCard` | `rule-suggestion-card.tsx` | ny |
| `DeviationCard` | `deviation-card.tsx` | ny |
| `CostField` | `cost-field.tsx` | ny |
| `TgiuSection` | `tgiu-section.tsx` | ny |
| `ReportTextField` (tekstfelt med plass til KI-merket) | `report-text-field.tsx` | ny |
| `AddDeviationPanel` | `add-deviation-panel.tsx` | ny |
| Lenken «Fyll ut badet» | siden «Bygninger og rom» | endret |

Gjenbruk `Card`, `Button`, `Badge`, `Field`, `Input`, `Textarea`, `Checkbox`, `ChoiceGroup`, `FormMessage` og `Notice`. **`Select` brukes ikke** på denne skjermen (prinsipp 6).

Ingen nye fargetokener. Bare tokenene som finnes: `tg*-bg/-text`, `sync-*`, `ok/watch/urgent/unknown`, `sand`, `snow`, `night`, `fjord`, `line`, `field`. Ingen faste hex-verdier i komponentene.

## 3. Oppsett

### PC og iPad liggende (fra 1024 px, `lg`)

```
┌ Toppfelt (hvit, kant under, sticky) ──────────────────────────────────────────────┐
│ ‹  Oppdrag 26-1042 · Tilstandsrapport                    [Lagret 10:42]            │
│    Våtrom › Bad, 1. etasje                                                          │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Liste (sand-flate) ─────┐ ┌ Punktet (snow) ──────────────────────────────────────┐
│ Badet                    │ │ Vanntett sjikt, membran og sluk          TG for      │
│ 3 av 8 ferdig            │ │ Ses sammen med: Overflater gulv,          punktet:   │
│ ▓▓▓▓▓▓░░░░░░░ (fremdrift)│ │ Tilliggende konstruksjoner våtrom          [TG3]     │
│                          │ │                                                       │
│ Generelt         Ferdig  │ │ ┌ Forslag fra reglene (sand) ───────────────────────┐│
│                  [TG1]   │ │ │ [TG3] Vanntett sjikt fra før 2000 uten dokumentas.││
│ Dokumentasjon … I arbeid │ │ │ Hvorfor: …   Befaringsår 2026 (fra oppdraget)     ││
│ …                        │ │ │ [  Godta  ]  [ Endre ]                 [ Avvis ]   ││
│▌Vanntett sjikt … I arbeid│ │ └───────────────────────────────────────────────────┘│
│  [TG3] · 1 å se over     │ │ ┌ Registrering (Card) ┐                               │
│ …                        │ │ ┌ TG uten avvik (Card): [TG0] [TG1] [TGIU] ┐          │
│                          │ │ ┌ Avvik 1 (DeviationCard) ┐                          │
│                          │ │ [ + Avvik ]                                          │
│                          │ │ ┌ Beskrivelse av punktet (ReportTextField) ┐         │
│                          │ │ ┌ Å se over (advarsler) ┐                             │
│                          │ ├──────────────────────────────────────────────────────┤
│                          │ │ Nedre linje (sticky):          [ Ferdig med punktet ]│
└──────────────────────────┘ └──────────────────────────────────────────────────────┘
```

- **Liste:** 320 px fra 1280 px (`xl:w-80`), 280 px mellom 1024 og 1280 (`lg:w-70`). Egen rulling (`sticky top-[toppfelt] h-[calc(100dvh-toppfelt)] overflow-y-auto`). Flate `sand`, ingen kant.
- **Punktet:** innhold maks 760 px (`max-w-190`), sentrert i resten av bredden. Kortene står under hverandre med 16 px mellomrom (`space-y-4`), 24 px på PC (`xl:space-y-6`). Ingen vannrett rulling ned til 768 px bredde.
- **Nedre linje:** sticky nederst i punktkolonnen, hvit flate, kant `line` øverst, høyde 88 px, innhold høyrejustert. Punktkolonnen får `pb-28` så siste kort ikke skjules.

### iPad stående (under 1024 px)

```
┌ Toppfelt ───────────────────────────────────────────┐
│ ‹ Våtrom › Bad, 1. etasje · punkt 5 av 8  [Lagret]  │
│ Vanntett sjikt, membran og sluk                      │
│ [ Punkter (3 av 8) ]                                 │
└──────────────────────────────────────────────────────┘
  (kortene som over, full bredde, 20 px marg)
┌ Nedre linje (fast) ─────────────────────────────────┐
│ [ ‹ Forrige punkt ] [ Ferdig med punktet ] [ Neste ›]│
└──────────────────────────────────────────────────────┘
```

- Listen er skjult. **«Punkter (3 av 8)»** (`Button variant="secondary" size="md"`) åpner hele listen som panel fra venstre (`<dialog>` med `showModal()`, bredde 360 px eller full bredde under 480 px, skygge fordi det flyter, lukkeknapp «Lukk» øverst, Esc lukker). Valg av punkt lukker panelet og setter fokus på punktets overskrift.
- Nedre linje: tre knapper, alle 56 pt (`size="lg"`), «Ferdig med punktet» i midten som hovedknapp (`primary`), «Forrige punkt» og «Neste punkt» `secondary`. Forrige er låst på første punkt, Neste på siste. Neste går til neste punkt i rekkefølgen (ikke neste som ikke er ferdig).
- Høyde 96 px pluss `env(safe-area-inset-bottom)`.

## 4. Toppfelt

- Tilbakelenke «‹ Oppdraget» (44 × 44 pt, tekst for skjermleser «Tilbake til oppdraget») til `/oppdrag/[id]`.
- Linje 1: oppdragsnummer og «Tilstandsrapport» (`text-sm text-stone`). Ingen adresse, ingen parter (oppgavekortet punkt 9: nettleseren får ikke parter eller adresse).
- Linje 2: «Våtrom › {romnavn}» som `h1` (Schibsted Grotesk, `text-xl font-semibold`).
- Til høyre: samlet `SaveState` (avsnitt 10).
- Under (`text-sm text-stone`, én linje): «Reglene regner med befaringsår 2026 (fra befaringstiden i oppdraget).» eller «… befaringsår 2026 (dagens år, befaringstiden er ikke satt).»
- Kontor og andre uten `report.edit`: `Notice`-lik linje i sand under toppfeltet: «Du kan se badet, men ikke endre det.» Alle felt vises som tekst (ikke låste felt), ingen knapper for endring, ingen nedre linje. Listen og Forrige/Neste virker.

## 5. Før rapporten finnes

Siden skriver aldri ved lesing.

- **Med `report.edit`:** `Card` med `h2` «Rapporten er ikke startet», teksten «Når du starter, låses rapporten til malen som gjelder nå.» og `Button size="lg"` «Start rapporten». Etter start vises badet med første punkt åpent, fokus på punktets overskrift.
- **Uten `report.edit`:** samme kort uten knapp: «Rapporten er ikke startet. En takstmann starter den.»
- **Ingen publisert mal:** `FormMessage`: «Det finnes ingen publisert mal for tilstandsrapport. Be en administrator om å publisere malen.»
- Knappen låses mens kallet går (tekst «Starter …»). Feil: `FormMessage` «Rapporten ble ikke startet. Prøv igjen.»

## 6. `CheckpointList`

```
Badet                        (h2, Schibsted Grotesk)
3 av 8 ferdig                (text-sm text-slate-700)
[▓▓▓▓▓▓░░░░░░░░░]            (<progress max=8 value=3>, 8 px høy, fjord på line)

<nav aria-label="Kontrollpunkter">
  <ol>
    <li><a aria-current="page|undefined"> … </a></li>
```

Hver rad er en lenke (`<a href="?punkt=<key>">`), minst 56 pt høy, `px-4 py-3`, hjørner 12 px. Innhold:

- Linje 1: punktnavnet (`text-base font-medium`), og til høyre `TgBadge` (kort form) når punktet har TG.
- Linje 2 (`text-sm text-slate-700`): status som tekst, og etter et midtpunkt antall advarsler og forslagsmerket når de finnes: «I arbeid · 2 å se over · Forslag gjelder ikke lenger».
- Statustekster: «Ikke startet», «I arbeid», «Ferdig», «TGIU – ikke ferdig». Ferdig-raden får et hakeikon (`aria-hidden`) foran statusen.
- Valgt punkt: hvit flate, kant 2 px `night` (`ring-2 ring-night ring-inset`), `aria-current="page"`. Hover: hvit flate.
- Ingen farge alene: status, TG og advarsler står alltid som tekst.
- Fremdriften regnes bare av rader som ikke er slettet (oppgavekortet punkt 7). Teksten bruker samme tall som `<progress>`; `<progress>` får `aria-label="Fremdrift"` og `aria-valuetext="3 av 8 ferdig"`.

## 7. `CheckpointPanel` (rekkefølge ovenfra)

1. **Overskrift:** punktnavnet som `h2` (`tabIndex={-1}`, får fokus ved bytte). Under: «Ses sammen med: Overflater gulv, Tilliggende konstruksjoner våtrom» som lenker (fra malens koblinger). Til høyre: «TG for punktet» (`text-sm`) og `TgBadge` lang form, eller «Ikke satt» (`text-slate-700`). TG-en er `tg_computed` regnet av den rene funksjonen.
2. **Regelforslag:** ett `RuleSuggestionCard` per forslag som gjelder punktet, og «ikke vurdert»-linjer (avsnitt 8).
3. **Registrering** (`Card`, `h3` «Registrering»): feltene fra malen for punktet, i malens rekkefølge. Felttyper:
   - Valg: `ChoiceButtons` (enkeltvalg) eller `Checkbox` i `ChoiceGroup` (flervalg).
   - Tall og årstall: `Input inputMode="numeric"` med enheten som tekst etter feltet («vekt-%», «mm/m»), bredde 160 px. Ingen +/−-knapper på PC.
   - Tekst: `ReportTextField`.
   - Hvert felt har `SaveState` per felt (avsnitt 10).
4. **TG uten avvik** (`Card`, `h3` «TG uten avvik»): `ChoiceButtons` med «TG0», «TG1», «TGIU». Hjelpetekst: «Har punktet avvik, gjelder TG fra avvikene.» Når punktet har avvik med TG2/TG3, er TG0 og TG1 låst med forklaringen «Punktet har avvik med TG. Fjern avvikene for å sette TG0 eller TG1.» Knapp «Fjern TG» (`ghost`) når en verdi er valgt.
5. **TGIU** (`TgiuSection`, bare når `tg_direct = IU`).
6. **Avvik:** `DeviationCard` per avvik, nummerert «Avvik 1», «Avvik 2».
7. **«+ Avvik»** (`Button variant="secondary" size="lg"`, venstrejustert) som åpner `AddDeviationPanel` på samme flate. Låst ved 50 avvik med teksten «Punktet har 50 avvik, som er grensen.»
8. **Beskrivelse av punktet** (`ReportTextField`, etikett «Beskrivelse av punktet (valgfri)»).
9. **Å se over** (avsnitt 13): samlet liste over advarslene på punktet, rett over nedre linje.

## 8. `RuleSuggestionCard`

Regelforslag er ikke KI: **aldri ordet «KI», aldri gnisteikonet, aldri `ai-*`-tokenene.** Overskriften er alltid «Forslag fra reglene».

### Oppbygging (tilstand `suggested`)

```
┌ section, flate sand, 12 px hjørner, p-5, ingen kant ───────────────────────┐
│ Forslag fra reglene                                    (text-sm, stone)    │
│ [TG3 Store eller alvorlige avvik]  Vanntett sjikt fra før 2000             │
│                                     uten dokumentasjon      (text-base 600)│
│ Hvorfor: Sjiktet er fra 1990. Det er ikke lagt fram dokumentasjon.          │
│ Befaringsår 2026 · Kilde: {source_ref}                     (text-sm)       │
│                                                                             │
│ [     Godta     ]  [ Endre ]                                   [ Avvis ]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Forslagstypen** står i klartekst: `outcome` viser TG og utfallets navn; `tgiu` viser `TgBadge` «TGIU» og «Sett TGIU på punktet»; `tg0` viser «TG0» og «Sett TG0 på punktet». Utfall med «velg TG2 eller TG3» viser to merker: «TG2 eller TG3».
- **Hvorfor:** begrunnelsen oversatt fra koder i `reasons` (én oversettelsesfil i `src/core/reports/logic/`). Tall med enhet, aldri råkoder.
- **Kilde** (`source_ref`) vises bare her, i dempet tekst. Den flettes aldri inn i avvikstekstene.
- **Knapper:** DOM- og tabulatorrekkefølge Godta, Endre, Avvis.
  - «Godta»: `Button size="lg"` (56 pt), minst 160 px bred.
  - «Endre»: `variant="secondary" size="md"`.
  - «Avvis»: `variant="secondary" size="md"`, skjøvet helt til høyre (`ml-auto`), minst 48 px fra Endre. Under 480 px bredde står Avvis på egen linje under.
- Ved «velg TG2 eller TG3» erstattes Godta av to hovedknapper «Godta som TG2» og «Godta som TG3» (begge `size="lg"`, `gap-3`), så forslaget er ferdig på ett trykk etter valget (oppgavekortets tre trykk).
- Hele kortet er `<section aria-labelledby>`. Et felles `role="status" aria-live="polite"`-område på punktet sier «Nytt forslag fra reglene: TG3, …» når et forslag kommer etter lagring av et felt.

### Tilstander

| Tilstand | Hva vises | Knapper |
|---|---|---|
| `suggested` | Som over. | Godta · Endre · Avvis |
| `changing` | Samme kort. Under begrunnelsen: `ChoiceButtons` «Velg TG» (TG2, TG3 for utfall; TG0, TG1, TGIU for `tgiu`/`tg0`) og, når spørsmålet har flere utfall, `ChoiceButtons` «Annet utfall». `Textarea` «Begrunnelse for endringen» (påkrevd, `min-h-24`). | «Lagre endringen» (`primary lg`), låst til begrunnelse og et valg som skiller seg fra forslaget finnes, med hjelpeteksten «Skriv en begrunnelse for å lagre.» · «Avbryt» (`ghost`) |
| `rejecting` | `Textarea` «Hvorfor avviser du forslaget?» (påkrevd). | «Avvis forslaget» (`primary lg`), låst til begrunnelsen er fylt ut, med samme hjelpetekst · «Avbryt» (`ghost`) |
| `accepted` | Kortet krymper til én linje i hvit flate med kant `line`: hakeikon, «Godtatt: TG3 – Vanntett sjikt fra før 2000 …» og lenke «Gå til avvik 1» (for `outcome`). | Ingen |
| `changed` | Én linje: «Endret: forslag TG3, du valgte TG2.» og «Begrunnelse: …» (den ansattes egen tekst, trimmet til to linjer). | Ingen |
| `rejected` | Én linje: «Avvist: TG3 – … » og begrunnelsen. | Ingen |
| `stale` | `Warning`: «Forslaget gjelder ikke lenger. Feltet det bygde på er endret. Avviket du godtok, står fortsatt.» Avviket fjernes aldri av seg selv. | Lenke «Gå til avvik 1» når det finnes |
| `not_evaluated` | Linje i hvit flate med kant `line`, ikon «i»: «Ikke vurdert: Fyll ut årstall for sjiktet.» Lenken «Gå til feltet» flytter fokus til feltet. | Ingen |
| `busy` | Alle knapper låst, valgt knapp viser «Lagrer …». | Låst |
| `error` | `FormMessage` under knappene. Tekstene i avsnitt 14. Begrunnelsen beholdes. | Som før feilen |

- Endre og Avvis skjer på samme flate, ikke i dialog. Fokus går til første valg (`changing`) eller tekstfeltet (`rejecting`). Avbryt setter fokus tilbake på knappen som åpnet.
- **Godta på punkt med TGIU** (forslag `outcome` med TG2/TG3): kortet går til tilstanden `tgiu_conflict` før noe lagres: `Warning` «Punktet har TGIU. Et avvik med TG3 kan ikke stå sammen med TGIU.» og knappene «Fjern TGIU og legg til avviket» (`primary lg`) og «Behold TGIU» (`secondary md`, avbryter). Samme valg vises når takstmannen legger til avvik med TG2/TG3 fra «+ Avvik». HMS-avvik gir ikke konflikten.
- Etter Godta (`outcome`) flyttes fokus til overskriften i det nye avvikskortet, og statusområdet sier «Avvik lagt til, TG3». Etter Godta (`tgiu`) går fokus til TGIU-kortets overskrift («TGIU satt på punktet»). Etter Godta (`tg0`): «TG0 satt på punktet», fokus på «Ferdig med punktet».

## 9. `DeviationCard`

```
┌ Card (hvit, kant line, 12 px) ──────────────────────────────────────────────────┐
│ Avvik 1                              [TG3 Store eller alvorlige avvik]  (h3)    │
│ Utfall: Vanntett sjikt fra før 2000 · Fra forslag fra reglene   (text-sm)       │
│                                                                                  │
│ TG            ( TG2 ) (•TG3 )                                                    │
│ Avvik         [ textarea ]                                         Lagret       │
│ Årsak         ( kriterium 1 ) ( kriterium 2 ) …                                  │
│               [ textarea: Årsak ]                                               │
│ Konsekvens    [ textarea ]                                                      │
│ Tiltak        1. [ textarea ]                  [Opp] [Ned] [Fjern tiltak]       │
│               [ + Tiltak ]  [ + Standardtiltak ]                                │
│ Kostnad       CostField                                                         │
│ Måling        15 vekt-% (fra Hulltaking)                                        │
│ ──────────────────────────────────────────────────────────────────────────────── │
│                                                              [ Fjern avviket ]  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Feltene står under hverandre (etikett over felt, `Field`), ikke i to kolonner. Etikettene: «TG», «Avvik», «Årsak», «Konsekvens», «Tiltak», «Kostnad», «Kostnad, forklaring (valgfri)».
- **TG:** `ChoiceButtons` «TG2», «TG3». Ved «velg TG2 eller TG3» uten valg står `Warning` «Velg TG2 eller TG3.» rett under. Byttes TG bort fra utfallets TG og malen ikke har bør/må-tiltak, står `Warning` «Se over konsekvens og tiltak. Teksten hører til TG3.» Har malen begge, byttes tiltaket stille og statusområdet sier «Tiltaket er byttet til teksten for TG2.»
- **HMS-avvik:** ingen TG-valg; i stedet `Badge tone="neutral"` «HMS» i overskriften.
- **Årsak:** `ChoiceButtons` med årsakskriteriene fra `src/core/reports/logic/` (navn som tekst), og `ReportTextField` «Årsak» under.
- **Tekstfeltene** er `ReportTextField`. Standardtekst fra malen står ferdig utfylt. Flettefelt uten verdi står som `[årstall mangler]` i teksten (markøren lages av den rene funksjonen; aldri `{…}`), og feltet får `Warning` «Fyll inn årstall i teksten.»
- **Tiltak:** nummerert liste (`<ol>`). Rekkefølge med knappene «Flytt opp» og «Flytt ned» (44 × 44 pt, ikon med tekst for skjermleser), ingen dra-og-slipp. «Fjern tiltak» (`ghost`). «+ Tiltak» (`secondary md`) legger til tomt felt og flytter fokus dit. «+ Standardtiltak» (`secondary md`) åpner malens tiltak for utfallet som en liste med `Radio` og knappen «Legg til» på samme flate. Tak 20: knappene låses med teksten «Avviket har 20 tiltak, som er grensen.»
- **Måling:** skrivebeskyttet linje når fuktregelen har gitt måleverdi.
- **«Fjern avviket»** (`ghost`, nederst til høyre, skilt med linje): ingen dialog. Kortet erstattes av en linje «Avvik 1 er fjernet.» med knappen «Angre» (`secondary md`) til punktet forlates. Fokus går til «Angre». Myk sletting på serveren.
- `aria-labelledby` på kortet peker på «Avvik 1»; TG-merket står i overskriften så skjermleseren leser «Avvik 1, TG3».

## 10. `SaveState` (lagrestatus)

Bruker bare `sync-*`-tokenene. Ikon og tekst står alltid sammen; aldri TG-farger.

| Status | Tekst per felt | Tekst samlet (toppfelt) | Tone |
|---|---|---|---|
| `saved` | Lagret | Alt er lagret · 10:42 | `sync-saved` |
| `saving` | Lagrer … | Lagrer … | `sync-pending` |
| `failed` | Ikke lagret – prøv igjen | 1 felt er ikke lagret – prøv igjen | `sync-waiting` (tekst) + knapp |
| `offline` | Uten nett | Uten nett – endringene dine er ikke lagret ennå | `sync-offline` |

- **Per felt:** liten linje under feltet, høyrejustert, `text-sm`, ingen flate (bare ikon og tekst i `-text`-tonen). Vises fra første endring. «Lagret» blir stående.
- **Samlet:** pille i toppfeltet (`h-8 rounded-full px-3 text-sm`, flate og tekst fra tokenet), `role="status" aria-live="polite"`. Bare samlet status leses opp, ikke hvert felt.
- **`failed`:** «Prøv igjen» (`secondary md`) ved feltet og i toppfeltet. Feltet beholder teksten. Lagringen prøves igjen av seg selv når nettet kommer tilbake.
- **Konflikt («Endret av andre»):** under feltet, flate `sand`, 12 px hjørner, p-4:
  «Noen andre har endret dette feltet. Nyeste verdi:» og verdien (tekst, maks 6 linjer med «Vis alt»). Knappene «Bruk nyeste» (`primary md`) og «Behold min og lagre» (`secondary md`). Ingenting overskrives før et valg er tatt. Fokus går til meldingen (`tabIndex={-1}`), og statusområdet sier «Endret av andre».

## 11. `CostField`

- `ChoiceButtons` «Kostnad» med sju valg i to linjer: de fem intervallene (etikettene fra `cost-bands.ts`, f.eks. «Under 20 000», «20 000–100 000» …), «Eget beløp» og «Ingen».
- **Eget beløp:** `Input inputMode="numeric"` med «kr» etter, bredde 200 px, autofokus når valget gjøres. Tusenskille med mellomrom vises når feltet forlates; rundes aldri av automatisk.
  - Ikke rundet til nærmeste 10 000: `Warning` rett under mens det skrives (forsinket 300 ms): «Beløpet er ikke rundet til nærmeste 10 000. Nærmeste er 40 000.» Med knappen «Bruk 40 000» (`secondary md`). Aldri dialog, aldri sperre.
  - 0, negativt eller desimaltall: feilen i `Field` (`aria-invalid`): «Skriv et helt beløp over 0.» Lagres ikke.
- **Ingen** ved TG3: `Warning` «TG3 skal ha kostnad.» (advarsel nå).
- Under valget: `Input` «Kostnad, forklaring (valgfri)».

## 12. `TgiuSection`

`Card` med overskrift «TGIU – ikke undersøkt» (`h3`) og `TgBadge` «TGIU». Feltene (`ReportTextField`, alle med `SaveState`):

1. «Hva er ikke undersøkt, og hvorfor?»
2. «Risiko»
3. «Hva må til for å undersøke?»
4. Bare på tilliggende konstruksjoner: «Annen fuktkontroll og resultat» og «Skadeutsatt konstruksjon».
5. Bare når eier har nektet hulltaking: `Checkbox` «Eier er informert om utvidet ansvar».

Manglende opplysning gir `Warning` under feltet: «Fyll ut dette for TGIU.» Feltene som ikke gjelder grunnen, vises ikke (ingen falske advarsler). «Fjern TGIU» (`ghost`) nederst; samme oppførsel som «Fjern avviket» (angre-linje).

## 13. Advarsler (`Warning` og «Å se over»)

Advarsler sperrer aldri. De har **ikke** TG-tonene (gult er TG2): flate `sand`, trekantikon i `night` (`aria-hidden`), ordet «Se over:» foran som tekst for skjermleser, `text-sm text-slate-900`.

- **Ved feltet:** `Warning` rett under feltet det gjelder, koblet med `aria-describedby`.
- **«Å se over»** på punktet: `Card` med `h3` «Å se over (2)» og en liste med lenker som flytter fokus til feltet. Vises bare når det finnes advarsler. `role="status" aria-live="polite"` på antallet.
- **I listen:** «2 å se over» i statuslinjen.
- **Etter «Ferdig med punktet»** med advarsler: ingen dialog. Punktet markeres ferdig, neste punkt som ikke er ferdig åpnes, og statusområdet sier «Punktet er ferdig, med 2 ting å se over. Åpnet: Ventilasjon.» Advarslene står fortsatt i listen.

Advarselstekstene (endelige tekster i oversettelsesfilen, `src/core/reports/logic/`):

| Når | Tekst |
|---|---|
| Velg TG2 eller TG3 uten valg | Velg TG2 eller TG3. |
| TG2/TG3 uten årsak, konsekvens eller tiltak | Avviket mangler årsak. / … konsekvens. / … tiltak. |
| TG3 uten kostnad | TG3 skal ha kostnad. |
| HMS uten konsekvens eller tiltak | HMS-avviket mangler konsekvens. / … tiltak. |
| TGIU-opplysning mangler | Fyll ut dette for TGIU. |
| Hulltaking ikke utført, ikke TGIU på tilliggende konstruksjoner | Hulltaking er ikke utført. Punktet bør ha TGIU. |
| «Utført uten funn» med måling over grensen (T-0059) | Målingen er på eller over grensen. Endre til «Utført med funn»? med knappen «Endre til utført med funn» (`secondary md`) |
| Forslag gjelder ikke lenger | Et forslag fra reglene gjelder ikke lenger. |
| Flettefelt mangler | Fyll inn {navn} i teksten. |

## 14. Felles byggeklosser i `src/shared/ui`

### `TgBadge`

```ts
type TgBadgeProps = { tg: "0" | "1" | "2" | "3" | "IU"; long?: boolean };
```

- Form som `Badge` (`h-6 rounded-full px-2.5 text-xs font-semibold`), flate `tg*-bg`, tekst `tg*-text`. Ingen kant.
- Kort form: «TG0», «TG1», «TG2», «TG3», «TGIU». Lang form: «TG2 Vesentlige avvik» osv. (TG0 «Ingen avvik», TG1 «Mindre avvik», TG2 «Vesentlige avvik», TG3 «Store eller alvorlige avvik», TGIU «Ikke undersøkt»).
- Kort form får `aria-label` med lang form, så skjermleseren alltid får hele meningen.
- Importerer ingenting fra `src/core`.

### `ChoiceButtons`

```ts
type ChoiceButtonsProps = {
  id: string; legend: string; hint?: ReactNode; error?: string;
  options: { value: string; label: ReactNode; disabled?: boolean }[];
  value: string | null; onChange(value: string): void; disabled?: boolean;
};
```

- Bygget på ekte radioknapper i `<fieldset>` med `<legend>` (som `ChoiceGroup`), så piltaster og skjermleser virker uten egen kode. Selve `<input type="radio">` er visuelt skjult (`sr-only peer`); etiketten er pillen.
- Pille: `min-h-11 min-w-11 px-4 rounded-full text-base font-medium`. Ikke valgt: hvit, `ring-1 ring-slate-700 ring-inset`. Valgt: `bg-night text-white` med hakeikon foran (`aria-hidden`), så valget ikke bare er farge. Låst: `text-slate-500 ring-slate-300`.
- Fokus: `peer-focus-visible:` fokusramme i fjord (2 px, offset 2) på pillen.
- Mellomrom `gap-2`, `md:gap-3`; brytes over flere linjer (`flex flex-wrap`).
- Erstatter nedtrekkslister i hele rapporten.

### `SaveState`

```ts
type SaveStateProps = { status: "saved" | "saving" | "failed" | "offline"; savedAt?: Date; scope: "field" | "total"; failedCount?: number; onRetry?(): void };
```

Tekstene og tonene i avsnitt 10. `scope="total"` har `role="status"`. Ingen kobling til lagringen; den får bare statusen.

### `Warning`

```ts
type WarningProps = { id?: string; children: ReactNode; action?: ReactNode };
```

Utseende i avsnitt 13. Ikke `role="alert"` (sperrer ikke, skal ikke avbryte); oppleses via `aria-describedby` eller statusområdet på punktet.

## 15. `ReportTextField`

Felles for avvik, årsak, konsekvens, tiltak, beskrivelse av punktet og TGIU-feltene.

- `Field` + `Textarea` (`min-h-24`, vokser med innholdet til 12 linjer), `SaveState` under til høyre, `Warning` under ved behov.
- Over feltet, venstrejustert, en plass for `AiTextMark` (vises bare når serveren sier `aiUsageId` og status `accepted`/`edited`; tom nå). Under feltet en plass for `AiSuggestion` (tom nå). Ingen KI-knapp i denne oppgaven.
- Lagrer per felt når feltet forlates og etter 800 ms uten tasting.
- Teller tegn når 80 % av grensen er brukt: «1 640 av 2 000 tegn». Over grensen: feil «Teksten er for lang. Grensen er 2 000 tegn.»
- Fødselsnummer (elleve sifre): feil «Teksten ser ut til å inneholde et fødselsnummer. Fjern det.» Lagres ikke; teksten beholdes i feltet.

## 16. `AddDeviationPanel`

Åpnes av «+ Avvik» på samme flate, rett over knappen (ingen dialog). Fokus til første utfall.

```
┌ flate sand, p-5 ──────────────────────────────────────────────┐
│ Legg til avvik                                          (h3)  │
│ Er det tegn på fukt eller lekkasje rundt sluket?   (spørsmål) │
│   [ Fuktskade ved sluk · TG3 ] [ Misfarging · TG2 eller TG3 ] │
│ Er fallet til sluk for lite?                                  │
│   [ For lite fall · TG2 ]                                     │
│                                                    [ Avbryt ] │
└───────────────────────────────────────────────────────────────┘
```

- Spørsmålene fra malen for punktet som overskrifter (`h4`, `text-base font-medium`), utfallene som knapper (`secondary md`) med TG som tekst i knappen.
- Ett trykk på et utfall lager avviket med standardtekstene, lukker panelet og setter fokus på det nye kortet («Avvik lagt til, TG2»). Ved «TG2 eller TG3» lages avviket uten TG, og TG-valget i kortet får fokus.
- Ved TGIU på punktet og utfall med TG: konfliktvalget fra avsnitt 8 vises i panelet først.
- Eksempeltekstene i skissen er plassholdere; tekstene kommer fra malen.

## 17. «Ferdig med punktet»

- `Button size="lg"` (56 pt), minst 240 px bred på PC. Kan alltid trykkes (også med advarsler).
- Ferdig punkt: knappen blir «Åpne punktet igjen» (`secondary lg`), og listen viser «Ferdig».
- Etter trykk: neste punkt som ikke er ferdig åpnes, adressen får `?punkt=<key>`, fokus på `h2`. Statusområdet: «Punktet er ferdig. 4 av 8 ferdig. Åpnet: Ventilasjon.»
- Alle ferdig: punktet blir stående, og et `Notice` øverst i punktkolonnen sier «Alle 8 punktene er ferdige.» Fokus på det.

## 18. «Fyll ut badet» i «Bygninger og rom»

På hver rad for våtrom: lenke formet som `Button variant="secondary" size="md"` med teksten «Fyll ut badet» (eller «Se badet» uten `report.edit`). Andre romtyper får ingen lenke nå.

## 19. Mål

| Ting | Mål |
|---|---|
| Hovedknapp (Godta, Godta som TG2/TG3, Ferdig med punktet, Start rapporten, Lagre endringen, Avvis forslaget, Forrige/Neste på iPad stående) | min. høyde 56 pt (`min-h-14`) |
| Andre knapper, pilleknapper, radioknapper, lenkerader | min. 44 × 44 pt (`min-h-11 min-w-11`) |
| Rad i punktlisten | min. 56 pt |
| Avstand Endre → Avvis | min. 48 px |
| Avstand mellom knapper | 8 px (`gap-2`), 12 px fra `md` |
| Kortets indre marg | 24 px (`p-6`), 20 px under 768 px |
| Hjørner | kort 12 px, felt 8 px, knapper og merker runde |
| Brødtekst | 16 px, linjehøyde 1,5; hjelpetekst 14 px |
| Brytere | to kolonner fra 1024 px (`lg`), bredere liste fra 1280 px (`xl`) |
| Innholdsbredde i punktet | maks 760 px |

## 20. Universell utforming

- WCAG 2.1 AA. Kontrasten i tokenene er regnet i `src/app/(ansatt)/contrast.test.ts`; nye kombinasjoner legges til der: `night` på `sand` (advarsel), hvit på `night` (valgt pille), `sync-*-text` på hvit (status per felt uten flate).
- Hele flyten med tastatur: Tab gjennom listen, punktet, kortene og nedre linje. Ingen fokusfelle utenom panelet på iPad stående.
- Ett `role="status" aria-live="polite"`-område per punkt for forslag, advarsler, avvik lagt til og ferdig; ett i toppfeltet for samlet lagring. Ingen `assertive`. Ingen melding som forsvinner av seg selv.
- Ved bytte av punkt: fokus på `h2`, `document.title` blir «{punktnavn} – Badet».
- Ingen informasjon bare i farge: TG, status, lagring, advarsler og valgt pille har alltid tekst eller ikon med tekst.
- `prefers-reduced-motion`: ingen animasjon ut over at kort vises.
- Mørk visning: ingen egne farger i komponentene, bare tokens, så den kan legges på senere (fase 3).

## 21. Ikke med (som oppgavekortet)

Bilder, frasebank, KI-knapper, «Gjelder ikke», fritt avvik uten spørsmål, publiseringssperre, PDF, hurtigtaster, kompakt visning, mørk visning, befaringsvisning uten nett, kommentarer og sidemann.

## 22. Sjekkliste for utvikler

- [ ] Ingen `Select` og ingen nedtrekksmeny på skjermen.
- [ ] Ingen faste hex-verdier; bare tokenene i avsnitt 2.
- [ ] Regelforslag har aldri ordet «KI», gnisteikonet eller `ai-*`-tokens.
- [ ] Advarsler bruker `sand`, ikke `watch`/TG-tonene; lagring bruker bare `sync-*`.
- [ ] `TgBadge` viser alltid tekst; kort form har `aria-label` med lang form.
- [ ] Hovedknapper 56 pt, alle andre trykkflater minst 44 pt (e2e måler).
- [ ] Avvis står ikke ved Godta (min. 48 px, egen linje på smal skjerm).
- [ ] Fokusflyt etter Godta, Ferdig, Fjern og bytte av punkt som i avsnitt 8, 9 og 17.
- [ ] Flettefelt vises aldri som `{…}`.
- [ ] Komponentene i `src/shared/ui` importerer ikke `src/core`, `src/db` eller moduler; klientkomponentene i rutemappen importerer bare `src/core/reports/logic/`, ikke indeksen.
- [ ] axe uten feil på PC, iPad liggende og iPad stående.
