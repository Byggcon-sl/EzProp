# Design: Publisering av badet (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-publisering-badet.md` (2a-2, «Publisering av badet»). Bygger på `docs/funksjoner/fase2a-badet-pc-design.md` (PR #224) og forslagskortet i `docs/funksjoner/fase2a-forslagsmonster-design.md`.
- **Fasit:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-oppdrag.png`, `A-konstr-pc.png`, `A-ipad-liggende.png`, `A-ipad-staende.png`), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/`).
- **Laget av:** ui-designer, 17.11.2026. Ved motstrid gjelder oppgavekortet.
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** alt som mangler i badet står i én liste før rapporten går ut. En sperre kan bare passeres med en aktiv bryter og en grunn, og det synes i utgivelsen.
  - **De ansatte:** én side, ingen dialoger, «Rett nå» rett i listen, faste grunner med ett trykk. Uten mangler: 2 trykk.
  - **KI i bunnen:** ventende KI-forslag behandles på siden med det samme forslagskortet som på rommet. KI har ingen knapp som setter TG, krysser bort eller publiserer.

## 1. Avvik fra A (innenfor det A tillater)

- **Én kolonne**, ingen sideliste. Publiser-siden er en gjennomgang ovenfra og ned, som oppdragssiden i A. Innholdet er maks 760 px bredt (`max-w-190`), sentrert på `snow`.
- **Sperrer har ikke rød tone.** Rødt er TG3 i profilen. En sperre er et hvitt kort med tykk venstrekant i `night` og ordet «Må rettes» (avsnitt 6). Advarsler bruker `Warning` i `sand` som på rommet.
- Ingen andre avvik. Krever ikke godkjenning fra prosjektlederen.

## 2. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| `Switch` (bryter med tekst) | `src/shared/ui/switch.tsx` | ny, generell |
| Tekster for funn, grunner og «missing» | `src/core/reports/logic/publish-check-texts.ts` | ny, ren (samme fil i nettleser og server) |
| `PublishPage` | `src/app/(ansatt)/oppdrag/[id]/publiser/page.tsx` + `publish-view.tsx` | ny |
| `PublishSummary` («Dette publiseres») | `publiser/publish-summary.tsx` | ny |
| `FindingList` (to grupper) | `publiser/finding-list.tsx` | ny |
| `BlockerItem` | `publiser/blocker-item.tsx` | ny |
| `OverrideReasons` | `publiser/override-reasons.tsx` | ny |
| `QuickFix` («Rett nå» i linjen) | `publiser/quick-fix.tsx` | ny |
| `WarningItem` | `publiser/warning-item.tsx` (bruker `Warning`) | ny |
| `PublishBar` (nedre linje) | `publiser/publish-bar.tsx` | ny |
| `PublishLink` (knapp med tellemerke) | `rom/[roomId]/publish-link.tsx` | ny |
| `BackToPublishBar` | `rom/[roomId]/back-to-publish-bar.tsx` | ny |
| Lesbar visning etter publisering | `rom/[roomId]/room-view.tsx` | endret |
| `ReleasesCard` («Utgivelser») | `src/app/(ansatt)/oppdrag/[id]/releases-card.tsx` | ny |

Gjenbruk: `Card`, `Button`, `Badge`, `TgBadge`, `ChoiceButtons`, `SaveState`, `Warning`, `Notice`, `Field`, `Textarea`, `FormMessage`, `AiSuggestion`, `AiTextMark`. **Ingen `Select`, ingen nedtrekk, ingen dialog** på siden.

Ingen nye fargetokener. Bare `snow`, `sand`, `night`, `fjord`, `stone`, `line`, `field`, `tg*-*`, `sync-*`, `ai-*` (bare i forslagskortet). Ingen faste hex-verdier.

## 3. Oppsett

### PC og iPad liggende (fra 1024 px)

```
┌ Toppfelt (hvit, kant under, sticky) ─────────────────────────────────────────┐
│ ‹ Oppdraget   Oppdrag 26-1042 · Tilstandsrapport           [Alt er lagret]    │
│               Se over og publiser                (h1)                         │
└──────────────────────────────────────────────────────────────────────────────┘
        ┌ (F5, bare ved behov) Notice: Du kan ikke publisere: … ┐
        ┌ Dette publiseres (sand, ingen kant) ──────────────────────────────┐
        │ Versjon 1 · Gyldig til 03.11.2027                                  │
        │ Bad, 1. etasje   [TG3] ×1 (kostnad 50 000–100 000 kr)              │
        │                  [TG2] ×2   [TGIU] ×1   [TG1] ×4   [TG0] ×1        │
        └────────────────────────────────────────────────────────────────────┘
        Må rettes eller krysses bort (2)                    (h2)
        Bad, 1. etasje                                       (h3)
        ┌▌BlockerItem ───────────────────────────────────────────────────────┐
        ┌▌BlockerItem ───────────────────────────────────────────────────────┐
        Bør sees over (3)                                    (h2)
        ┌ Warning ┐ ┌ Warning ┐ ┌ KI-forslag (AiSuggestion) ┐
┌ PublishBar (hvit, kant over, sticky nederst) ────────────────────────────────┐
│ Venter på synk (3 endringer)          [ Publiser (2 må rettes eller krysses bort) ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Kortene står under hverandre med 16 px mellomrom (`space-y-4`), 24 px mellom gruppene (`space-y-6`). Innholdet får `pb-32`, så siste kort ikke skjules av nedre linje.
- Toppfelt som på rommet: tilbakelenke «‹ Oppdraget» (44 × 44 pt), oppdragsnummer, `h1` «Se over og publiser», samlet `SaveState` til høyre. Ingen adresse og ingen parter.

### iPad stående (under 1024 px)

Samme rekkefølge, full bredde med 20 px marg. Nedre linje: statustekst over knappen, knappen i full bredde. Høyde 112 px pluss `env(safe-area-inset-bottom)`.

## 4. Øverst: rett og sertifisering (F5)

Vises bare når den ansatte ikke kan publisere. `Notice` i `sand`, `role="status"`, før «Dette publiseres»:

| Når | Tekst |
|---|---|
| Mangler `report.publish` (kontor) | «Du kan se sjekken, men ikke publisere eller krysse bort. En takstmann publiserer.» |
| Sertifiseringen gikk ut | «Du kan ikke publisere: sertifiseringen din gikk ut 01.11. En kollega med gyldig sertifisering kan publisere.» |
| Ingen sertifisering registrert | «Du kan ikke publisere: du har ingen gyldig sertifisering. En kollega med gyldig sertifisering kan publisere.» |

Listen, «Gå til» og «Rett nå» virker fortsatt (med `report.edit`). Uten `report.publish` vises verken bryter eller grunnvalg; sperren står som tekst. Kontor ser heller ikke «Rett nå».

## 5. `PublishSummary` («Dette publiseres», F4)

- Flate `sand`, 12 px hjørner, `p-6` (`p-5` under 768 px), ingen kant. `h2` «Dette publiseres».
- Linje 1 (`text-sm text-slate-700`): «Versjon 1 · Gyldig til 03.11.2027». Uten befaringsdato: «Versjon 1 · Gyldig til: mangler (befaringsdato er ikke satt)». Versjon 2 og senere: «Versjon 2 · Gyldig til 03.11.2027 (som versjon 1)».
- Per våtrom én rad (`<dl>`): romnavn og etasje (`dt`, `font-medium`), og TG-tellingen (`dd`): `TgBadge` kort form fulgt av «×N», fra høyeste TG ned. TG3 får kostnaden i parentes («kostnad 50 000–100 000 kr» eller «ca. 40 000 kr», samme oversettelse av `cost_type` som rommet). Punkt uten TG telles ikke her; de står som sperrer.
- Bygges av samme funksjon som snapshot (oppgavekortet F4), så det som står her er det som lagres.
- Skjermleser: hver `TgBadge` har lang form i `aria-label`; «×2» leses som «2 punkter» (`<span aria-label>`).

## 6. `FindingList` og `BlockerItem`

### Gruppene

- `h2` «Må rettes eller krysses bort (2)», tallet er sperrer som verken er rettet eller krysset bort. Under: `h3` per rom («Bad, 1. etasje»), og «Rapporten» for `inspection_date_missing`, som står først.
- Ingen sperrer: `h2` beholdes, under står «Ingen sperrer.» med hakeikon (`text-base`).
- `h2` «Bør sees over (3)» med advarslene. Ingen advarsler: gruppen vises ikke.
- Rekkefølgen er den faste sorteringen fra `computePublishCheck`. Siden sorterer aldri på nytt.

### `BlockerItem`

```
┌▌ (hvitt kort, kant line, 12 px hjørner, venstrekant 4 px night) ─────────────┐
│ ⛔ Må rettes                                      [Ny siden du åpnet siden]  │
│ Avvik 1 (TG3) mangler kostnad.                        (text-base font-medium)│
│ Vanntett sjikt, membran og sluk                       (text-sm text-slate-700)│
│                                                                                │
│ [ Rett nå ]  [ Gå til ]                                                        │
│ ─────────────────────────────────────────────────────────────────────────────  │
│ Publiser likevel   (○——)  Av                                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

- `<article aria-labelledby>` med overskrift = funnteksten. Ikonet er en åttekant med strek i `night` (`aria-hidden`); «Må rettes» står som synlig tekst (`text-sm font-semibold`). Venstrekanten er ikke eneste kjennetegn.
- **Funnteksten** lages fra `checkCode` og `missing` av `publish-check-texts.ts` (avsnitt 11), aldri lagret tekst. Linje 2 er punktnavnet (ikke for `inspection_date_missing`).
- **Knapper** (`gap-2`, `md:gap-3`): «Rett nå» (`secondary md`) bare der rettingen er opplagt (avsnitt 7); «Gå til» (`secondary md`, minst 44 pt, lenke formet som knapp, `href` bygget på serveren). Skjermleser: «Gå til: Vanntett sjikt, membran og sluk».
- **Bryteren** (`Switch`, avsnitt 8) under en skillelinje `line`: etikett «Publiser likevel». Bare for den som kan publisere.
- **Merket «Ny siden du åpnet siden»** (`Badge tone="brand"`) når funnet kom med en oppdatert liste (avsnitt 10).

### Tilstander for `BlockerItem`

| Tilstand | Hva vises | Teller i knappen |
|---|---|---|
| `open` | Som over, bryteren av. | ja |
| `fixing` | «Rett nå» er trykket: `QuickFix` åpner seg under knappene på samme flate (avsnitt 7). «Rett nå» blir «Lukk» (`ghost`). | ja |
| `saving` | Valget i `QuickFix` lagres: knappene låst, teksten «Lagrer …». | ja |
| `fixed` | Kortet blir én linje (hvit, kant `line`, ingen venstrekant): hakeikon, «Rettet: Avvik 1 har kostnad 50 000–100 000 kr.» Linjen står til listen hentes på nytt, så forsvinner den. | nei |
| `overriding` | Bryteren på, ingen grunn valgt: `OverrideReasons` under bryteren. Hjelpetekst «Velg en grunn.» | ja |
| `overridden` | Bryteren på og gyldig grunn: venstrekanten blir `line-strong`, «Må rettes» byttes med «Krysset bort» (`Badge tone="neutral"`, hakeikon). Grunnvalget står åpent så det kan endres. | nei |
| `previous_override` | Versjon 2+: over bryteren står «I versjon 1 krysset du bort dette: Ikke tilgang eller nektet av eier» (og egen tekst i anførselstegn, maks to linjer) med knappen «Bruk samme begrunnelse» (`secondary md`). Trykk slår på bryteren og fyller grunn og tekst. Ingenting skjer uten trykk. | ja, til trykket |
| `error` | `FormMessage` under knappene (avsnitt 12). Valgt grunn og tekst beholdes. | som før |

Uten `report.edit`: ingen «Rett nå». Uten `report.publish`: ingen bryter.

## 7. `QuickFix` («Rett nå», F2)

Åpnes på samme flate, rett under knappene. Ingen dialog. Fokus går til første valg. Hvert valg lagres straks med de samme skrivetjenestene som rommet; ingen «Lagre»-knapp. Etter lagring hentes listen på nytt (ren lesing) og kortet går til `fixed`.

| Funn | Hva `QuickFix` viser |
|---|---|
| `wet_or_below_ground_missing_hole` | `ChoiceButtons` «Hulltaking» med svarene fra malfeltet. Velges «Ikke utført»: `ChoiceButtons` «Grunn» med grunnvalgene fra malen. Velges «Annet»: `Textarea` «Forklar» (lagres når feltet forlates, som `ReportTextField`). |
| `tg3_missing_cost` | `ChoiceButtons` «Kostnad» med de fem intervallene. «Eget beløp» står ikke her; for det brukes «Gå til». |
| `mandatory_without_tg`, punkt uten TG | `ChoiceButtons` «TG for punktet»: TG0, TG1, TGIU. Ingenting forhåndsvalgt. Hjelpetekst: «Har punktet avvik med TG, bruk «Gå til».» TGIU gir et nytt funn (TGIU mangler grunn) med «Gå til». |
| `mandatory_without_tg`, avvik uten TG | `ChoiceButtons` «TG for avvik 2»: TG2, TG3. Ingenting forhåndsvalgt. |
| `mandatory_without_tg`, TGIU uten grunn | Ingen «Rett nå» (krever tekst). Bare «Gå til». |
| `tg2_tg3_missing_cause_or_consequence` | Ingen «Rett nå». Bare «Gå til» (fokus på feltet som mangler). |
| `inspection_date_missing` | Ingen «Rett nå». «Gå til» åpner oppdragets befaringsdato. |

- KI foreslår aldri noe i `QuickFix`, og ingen TG står forhåndsvalgt.
- Statusområdet sier «Rettet. 1 igjen som må rettes.» Fokus går til neste sperre som ikke er håndtert, eller til hovedknappen når ingen står igjen.
- Feil ved lagring: `FormMessage` «Endringen ble ikke lagret. Prøv igjen.» Valget står, og kortet blir i `fixing`.
- Er TGIU satt på punktet og takstmannen velger TG2/TG3 på et avvik, gjelder konfliktvalget fra badets design (avsnitt 8, `tgiu_conflict`) i linjen.

## 8. `Switch` og `OverrideReasons` (F1)

### `Switch` (`src/shared/ui/switch.tsx`)

```ts
type SwitchProps = {
  id: string; label: ReactNode; checked: boolean; onChange(checked: boolean): void;
  disabled?: boolean; describedBy?: string;
};
```

- `<button type="button" role="switch" aria-checked>` med synlig etikett (`<label>`-kobling via `aria-labelledby`). Hele raden (etikett, bryter og tilstandstekst) er trykkflaten: `min-h-11`, full bredde i kortet.
- Bryter 52 × 32 px, rund. Av: hvit flate, `ring-1 ring-field`, hvit knott med kant `field`. På: `bg-night`, hvit knott med hakeikon. Tilstandsteksten «Av» / «På» står etter bryteren (`text-sm`), så tilstanden aldri bare er farge eller plassering.
- Fokusramme i `fjord` (2 px, offset 2) rundt hele raden. Mellomrom og Enter veksler.
- Importerer ingenting fra `src/core`.

### `OverrideReasons`

Vises rett under bryteren når den er på. Fokus går til første grunn.

- `ChoiceButtons` «Hvorfor publiserer du likevel?» med fire valg (tekstene i `publish-check-texts.ts`, koder fra `PUBLISH_OVERRIDE_REASON_CODES`):
  - «Ikke tilgang eller nektet av eier» (`no_access_or_refused`)
  - «Gjelder ikke dette rommet» (`not_applicable_to_room`)
  - «Beskrevet et annet sted i rapporten» (`described_elsewhere`)
  - «Annet» (`other`)
- **«Annet»:** `Field` + `Textarea` «Skriv grunnen» (påkrevd, `min-h-24`), fokus dit når valget gjøres. Hjelpetekst: «Minst 10 tegn. Ikke skriv navn eller kontaktopplysninger.»
- **De andre:** knappen «Legg til en forklaring (valgfri)» (`ghost`) åpner samme tekstfelt med hjelpeteksten «Ikke skriv navn eller kontaktopplysninger.»
- Tegnteller fra 800 tegn: «820 av 1 000 tegn».
- Feil i feltet (`aria-invalid`, vises når feltet forlates og ved trykk på Publiser):
  - «Annet» under 10 tegn eller blankt: «Skriv minst 10 tegn.»
  - Over 1000 tegn: «Teksten er for lang. Grensen er 1 000 tegn.»
  - Fødselsnummer: «Teksten ser ut til å inneholde et fødselsnummer. Fjern det.»
- Slås bryteren av, skjules grunnvalget, men valgt grunn og tekst huskes på siden til den lukkes. Ingenting lagres før «Publiser».
- Grunnene gjelder bare denne versjonen. Det står i hjelpeteksten under bryteren: «Gjelder bare versjon 1. Mangelen kommer tilbake i neste versjon hvis den ikke er rettet.»

## 9. Advarsler («Bør sees over»)

- `WarningItem` = `Warning` med funnteksten, punktnavnet som linje 2, og `action` med «Rett nå» (som rommets `warningFix`) og «Gå til». Advarsler har ingen bryter og krever ingen bekreftelse.
- **`ai_suggestion_pending`** (F4): i stedet for `Warning` vises en kort tekst «Forslag fra KI som ikke er behandlet. Det kommer ikke med i rapporten.» med feltets navn og punktet, og under den det vanlige forslagskortet (`AiSuggestion`) med samme knapper, statuser og logging som på rommet («Bruk», «Behold min tekst», «Nytt forslag», «Angre»). Oppgavekortets «Endre» er «Gå til» (feltet åpnes på rommet); «Avvis» er «Behold min tekst». Det er de samme handlingene, ikke nye. KI-merket med ordet «KI» og `ai-*`-tonen gjelder som ellers. Ingen nye KI-kall uten at den ansatte trykker «Nytt forslag».
- Når et forslag er behandlet, faller advarselen bort når listen hentes på nytt; statusområdet sier «Forslaget er behandlet.»

## 10. Listen er oppdatert (F3)

- Når serveren svarer med en ny liste (endret eller manglende fingeravtrykk), eller når den ansatte kommer tilbake etter «Gå til»: `Notice` øverst i listen, `role="status"`, med fokus (`tabIndex={-1}`): «Listen er oppdatert. 1 ny sperre.» / «Listen er oppdatert. Ingen nye sperrer.»
- Valgt bryter, grunn og påbegynt tekst beholdes for funn med samme `checkCode` og samme mål. Nye sperrer får merket «Ny siden du åpnet siden». Funn som er borte, forsvinner uten egen melding (tallene i overskriftene endres).
- Publiseres det ikke fordi listen var endret, sier `FormMessage` over hovedknappen: «Noe er endret siden du åpnet siden. Se over listen og trykk Publiser igjen.»

## 11. Funntekstene (`publish-check-texts.ts`)

Endelige tekster. «Avvik 1» er avviksnummeret på punktet; TG står alltid som tekst.

| Kode og `missing` | Tekst |
|---|---|
| `tg2_tg3_missing_cause_or_consequence` / `criterion` | Avvik 1 (TG2) mangler årsakskriterium. |
| … / `cause` | Avvik 1 (TG2) mangler årsak. |
| … / `consequence` | Avvik 1 (TG2) mangler konsekvens. |
| `tg3_missing_cost` | Avvik 1 (TG3) mangler kostnad. |
| `wet_or_below_ground_missing_hole` / `unanswered` | Hulltaking er ikke besvart. |
| … / `not_done_no_reason` | Hulltaking er ikke utført, og grunnen mangler. |
| … / `other_without_note` | Hulltaking: «Annet» mangler forklaring. |
| `mandatory_without_tg` / punkt | Punktet mangler TG. |
| … / TGIU uten grunn | TGIU mangler grunn: hva er ikke undersøkt, og hvorfor. |
| … / avvik | Avvik 2 mangler TG. Velg TG2 eller TG3. |
| `inspection_date_missing` | Oppdraget mangler befaringsdato. Uten den får rapporten ingen «gyldig til»-dato. |
| `hole_reading_missing` | Hulltaking er utført, men måleverdi eller enhet mangler. |
| `ai_suggestion_pending` | Forslag fra KI som ikke er behandlet. Det kommer ikke med i rapporten. |
| Øvrige advarsler | Samme tekster som på rommet (badets design avsnitt 13). |

Ingen gjetteord. Romnavn og punktnavn hentes ved visning, aldri lagret i teksten.

## 12. `PublishBar` (hovedknappen)

- Fast nederst, hvit flate, kant `line` øverst, høyde 96 px (PC og iPad liggende), innhold høyrejustert. Til venstre: statuslinjen (`text-sm`, `role="status"`).
- Hovedknappen: `Button size="lg"` (56 pt), minst 280 px bred på PC, full bredde på iPad stående.
- Er knappen sperret, brukes `aria-disabled="true"` med stone-flate (ikke `disabled`), så trykk virker og forklarer. Tekst og oppførsel i denne rekkefølgen (første som gjelder):

| Når | Statuslinje | Knappetekst | Trykk |
|---|---|---|---|
| Mangler rett eller sertifisering | — | ingen hovedknapp; teksten fra avsnitt 4 står i linjen | — |
| Uten nett | «Publisering krever nett. Alt er lagret på enheten.» (`sync-offline`) | Publiser versjon 1 (sperret) | fokus til statuslinjen |
| Synkkøen har endringer | «Venter på synk (3 endringer)» (`sync-pending`) | Publiser versjon 1 (sperret) | fokus til statuslinjen |
| Sperrer igjen | — | Publiser (2 må rettes eller krysses bort) | fokus til første sperre som ikke er håndtert; statusområdet sier «2 må rettes eller krysses bort.» |
| Grunn mangler eller feil i tekst | — | Publiser (1 mangler grunn) | fokus til grunnvalget eller tekstfeltet som mangler |
| Klar | «Alt er lagret» | Publiser versjon 1 | publiserer |
| Publiserer | — | Publiserer … (låst) | — |

- Ingen bekreftelsesdialog: siden er gjennomgangen.
- Feil fra serveren (`FormMessage` over knappen, fokus dit):
  - «Rapporten ble ikke publisert. Prøv igjen.»
  - «Rapporten er alt publisert.» (med lenke «Se utgivelsene»)
  - Listen er endret: teksten i avsnitt 10.
- Uten våtrom: hele innholdet erstattes av et `Card` «Rapporten har ikke noe våtrom å publisere.» og lenken «Til bygninger og rom». Ingen nedre linje.

## 13. Etter publisering

- **Publiser-siden:** innholdet erstattes av `Notice` med fokus: `h2` «Versjon 1 er publisert», linjen «17.11.2026 kl. 14.05 · Gyldig til 03.11.2027 · 1 sperre krysset bort», og lenkene «Til oppdraget» (`primary lg`) og «Se badet» (`secondary md`). Uten befaringsdato: «Gyldig til: mangler».
- **Rommet:** toppfeltet viser «Publisert versjon 1» (`Badge tone="neutral"`) i stedet for lagrestatus. Under toppfeltet en linje i `sand`: «Rapporten er publisert. Lag ny versjon for å rette.» med «Lag ny versjon» (`secondary md`, bare med `report.edit`). Alle felt vises som tekst, som kontorvisningen i badets design avsnitt 4. Ingen nedre linje med «Ferdig med punktet».
- **«Lag ny versjon»** står aldri ved siden av en hovedknapp. Ingen dialog (eldre utgivelser røres ikke). Knappen viser «Lager ny versjon …» mens kallet går. Etterpå er badet redigerbart, linjen blir «Du retter versjon 2. Versjon 1 er uendret.», og statusområdet sier det samme. Feil: «Ny versjon ble ikke laget. Prøv igjen.»
- Får en skriving i et åpent felt avvisning fordi rapporten er publisert: feltets `FormMessage` «Rapporten er publisert. Lag ny versjon for å rette.» Teksten beholdes i feltet.

## 14. Rommet: `PublishLink` og `BackToPublishBar`

### `PublishLink`

- Lenke formet som `Button variant="secondary" size="md"` i toppfeltet til høyre, før `SaveState`. På iPad stående på egen linje under punktnavnet, sammen med «Punkter (3 av 8)».
- Tekst: «Se over og publiser», og etter den tellemerket som `Badge tone="neutral"`: «2 må rettes · 3 bør sees over». Ingen mangler: «Ingen mangler». Bare advarsler: «3 bør sees over». Tallene regnes lokalt med `computePublishCheck` (ren kode) og oppdateres når et felt er lagret.
- `aria-label`: «Se over og publiser. 2 må rettes, 3 bør sees over.» Endringer i tallet leses ikke opp (unngå støy); de står i lenketeksten.
- Vises ikke når rapporten er publisert.

### `BackToPublishBar`

- Vises når rommet er åpnet med «Gå til» fra publiser-siden (`?fra=publiser`). Fast linje rett over nedre linje (`sticky`), flate `sand`, høyde 64 px, kant `line` øverst.
- Innhold: «Tilbake til publisering (2 igjen)» som `Button variant="primary" size="md"`-lenke. Tallet er sperrer som ikke er rettet, regnet lokalt. Ingen igjen: «Tilbake til publisering (alt rettet)».
- På publiser-siden etter retur: avsnitt 10, og fokus på funnet man gikk fra (eller neste hvis det er rettet).

## 15. `ReleasesCard` («Utgivelser» på oppdraget)

- `Card` med `h2` «Utgivelser». Vises når minst én utgivelse finnes. Nyeste først.
- Per versjon en `<details>` (native, `summary` minst 44 pt, chevron `aria-hidden`):
  - `summary`: «Versjon 2» (`font-medium`), «17.11.2026 kl. 14.05 · {navn}» og «1 sperre krysset bort» eller «Ingen sperrer krysset bort». Ansatt som har sluttet: navnet og `Badge` «Sluttet».
  - Innhold: «Gyldig til 03.11.2027» (eller «mangler»), «Første utgivelse 05.11.2026» for versjon 2+, og listen over sperrer som ble krysset bort: funnteksten (fra koden), punktnavnet fra snapshot, «Grunn: Ikke tilgang eller nektet av eier» og egen tekst i anførselstegn.
  - Kontor (`overrideReason: null`): grunnen vises, teksten erstattes av «Begrunnelsen vises for takstmann, leder og admin.»
- Ingen knapper for endring eller sletting. «Lag ny versjon» står her også (`secondary md`, nederst i kortet, bare med `report.edit` og når rapporten er publisert).

## 16. Mål

| Ting | Mål |
|---|---|
| Hovedknapp (Publiser, Til oppdraget) | min. 56 pt (`min-h-14`), min. 280 px bred på PC |
| Bryterraden «Publiser likevel» | min. 44 pt høy, full kortbredde; selve bryteren 52 × 32 px |
| «Rett nå», «Gå til», grunnvalg, «Bruk samme begrunnelse», `summary` | min. 44 × 44 pt |
| Avstand mellom knapper | 8 px, 12 px fra `md` |
| Kortets indre marg | 24 px, 20 px under 768 px |
| Venstrekant på sperre | 4 px `night`; `line-strong` når krysset bort |
| Hjørner | kort 12 px, felt 8 px, knapper, merker og bryter runde |
| Innholdsbredde | maks 760 px |
| Trykk | uten mangler 2 (Se over og publiser, Publiser); én sperre rettet 4; én sperre krysset bort med fast grunn 4 (Se over, bryter, grunn, Publiser) |

## 17. Universell utforming

- WCAG 2.1 AA. Nye kombinasjoner legges i `src/app/(ansatt)/contrast.test.ts`: hvit knott mot `night` (bryter på, 3:1 for ikke-tekst), kant `field` mot hvit (bryter av), `line-strong` venstrekant er pynt (ikke eneste kjennetegn).
- Overskriftsnivåer: `h1` siden, `h2` gruppene og «Dette publiseres», `h3` rommene. Funnene er `<article>` i en `<ul>`.
- Ett `role="status" aria-live="polite"` for siden (rettet, oppdatert liste, sperret knapp) og ett i nedre linje for synk. Ingen `assertive`, ingen melding som forsvinner av seg selv.
- Fokusflyt: sperret hovedknapp → første sperre som ikke er håndtert; bryter på → første grunn; «Annet» → tekstfeltet; «Rett nå» → første valg; rettet → neste sperre eller hovedknappen; ny liste → `Notice`; etter publisering → `Notice` «Versjon 1 er publisert».
- Alt virker med tastatur. Ingen fokusfelle. `document.title`: «Se over og publiser – Oppdrag 26-1042».
- Ingen informasjon bare i farge: «Må rettes», «Krysset bort», «Av/På», TG og synk har alltid tekst.
- `prefers-reduced-motion`: bryteren bytter uten animasjon.
- Mørk visning: bare tokens, ingen egne farger.

## 18. Ikke med (som oppgavekortet)

PDF, sending, «Gjelder ikke», `bra_missing` og `electrical_missing`, KI-sjekk av tekst, sidemannskontroll, kommentar til ny versjon, publisering uten nett, lederoversikt over overstyringer.

## 19. Sjekkliste for utvikler

- [ ] Ingen dialog, ingen `Select`, ingen nedtrekk på publiser-siden.
- [ ] Sperrer bruker ikke `urgent`/TG3-tonen; advarsler bruker `Warning` (`sand`).
- [ ] «Publiser likevel» er `Switch` med `role="switch"`, ikke avkrysningsboks; raden er minst 44 pt.
- [ ] Ingen TG forhåndsvalgt i «Rett nå»; ingen KI i sjekken, i `QuickFix` eller i grunnvalget.
- [ ] Funntekster lages fra kode ved visning (`publish-check-texts.ts`), aldri lagret.
- [ ] Sperret hovedknapp bruker `aria-disabled`, sier hvorfor med tall, og flytter fokus til første sperre.
- [ ] «Bruk samme begrunnelse» må trykkes; ingen grunn følger med av seg selv til ny versjon.
- [ ] Kontor ser grunnkoden, ikke teksten, og ingen bryter eller «Rett nå».
- [ ] Tellemerket på rommet og `BackToPublishBar` regnes lokalt med `computePublishCheck`.
- [ ] Lesbar visning etter publisering; «Lag ny versjon» aldri ved en hovedknapp.
- [ ] `src/shared/ui/switch.tsx` importerer ikke `src/core`, `src/db` eller moduler.
- [ ] E2e måler hovedknappen (56 pt), bryterraden og «Gå til» (44 pt) på PC, iPad liggende og stående; axe uten feil.
