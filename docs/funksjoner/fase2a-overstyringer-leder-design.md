# Design: Overstyringer for leder (komponentspesifikasjon)

- **Hører til:** `docs/funksjoner/fase2a-overstyringer-leder.md` (2a-2, «Fra forbedreren»). Bygger på `docs/funksjoner/fase2a-publisering-badet-design.md` (sperrer, grunner, «Utgivelser») og forslagskortet i `docs/funksjoner/fase2a-forslagsmonster-design.md`.
- **Fasit:** oppsett og luft fra A «Fjord» (`docs/design/bilder/A-oppdrag.png`, `A-dashbord.png`, `A-ipad-staende.png`), uttrykket fra Byggcon-profilen (`docs/08-designprinsipper.md`, `docs/design/byggcon-profil/bilder/`).
- **Laget av:** ui-designer, 24.11.2026. Ved motstrid gjelder oppgavekortet.
- **Støtter hovedmål:**
  - **De ansatte:** leder ser mønstrene på én side, to trykk fra siden til utgivelsen. Ingen tabeller å tolke, ingen filtre å stille inn.
  - **KI i bunnen:** månedsoppsummeringen står øverst og lages med ett trykk; leder bruker, retter eller avviser den i det samme forslagskortet som ellers i EzProp.
  - **Færre reklamasjoner:** sperrer som ble krysset bort og senere ga reklamasjon på samme punkt, står øverst, åpne og røde, med tekst og ikon.

## 1. Avvik fra A (innenfor det A tillater)

- **Én kolonne**, ingen sideliste, maks 760 px (`max-w-190`), sentrert på `snow`. Samme som publiser-siden.
- **Rød tone brukes her** (`urgent`), men aldri alene og aldri som TG: alltid teksten «Reklamasjon på samme punkt» og varseltrekanten. Siden viser ingen TG.
- **Reklamasjonsskjemaet** får en nedtrekksmeny («Kontrollpunkt»). Det er et kontorskjema på PC, ikke befaringen, og skjemaet bruker allerede `Select` (prinsipp 6 gjelder befaringen).
- Ingen andre avvik. Krever ikke godkjenning fra prosjektlederen.

## 2. Hva som lages

| Komponent | Fil | Ny eller endret |
|---|---|---|
| Side `/oppdrag/overstyringer` | `src/app/(ansatt)/oppdrag/overstyringer/page.tsx` + `overrides-view.tsx` | ny |
| `MonthPicker` (fire månedsknapper) | `overstyringer/month-picker.tsx` (bruker `ChoiceButtons`) | ny |
| `OverrideSummaryCard` (KI-oppsummeringen) | `overstyringer/override-summary-card.tsx` (bruker `AiSuggestion`, `AiTextMark`) | ny |
| `OverrideGroup` (nivå 1, knapp som åpner) | `overstyringer/override-group.tsx` | ny |
| `OverrideReasonBlock` (nivå 2, grunn) | `overstyringer/override-reason-block.tsx` | ny |
| `OverrideReleaseRow` (én utgivelse) | `overstyringer/override-release-row.tsx` | ny |
| `ClaimMarker` (rød og nøytral markering) | `overstyringer/claim-marker.tsx` | ny |
| Tekster for siden | `overstyringer/override-texts.ts` (ren) | ny |
| Etiketter for sperrekoder | `src/shared/config/publish-check-labels.ts` (ren, trygg tekst for ukjent kode) | ny |
| Lenke «Overstyringer» | `src/app/(ansatt)/arbeidskoe/page.tsx` | endret |
| Feltet «Kontrollpunkt» | `src/app/(ansatt)/oppdrag/[id]/reklamasjoner/claim-form.tsx` | endret |
| Linjen «Denne sperren ble krysset bort …» | `src/app/(ansatt)/oppdrag/[id]/reklamasjoner/[claimId]/page.tsx` | endret |

Gjenbruk: `Card`, `Button`, `Badge`, `ChoiceButtons`, `Notice`, `Warning`, `Field`, `Select`, `Textarea`, `FormMessage`, `AiSuggestion`, `AiTextMark`, `SaveState`. Ingen ny komponent i `src/shared/ui`. Ingen nye fargetokener, ingen faste hex-verdier, ingen fargeoverganger.

## 3. Oppsett

### PC og iPad liggende (fra 1024 px)

```
┌ Toppfelt (hvit, kant under) ──────────────────────────────────────────────┐
│ ‹ Arbeidskø                                           [Alt er lagret]      │
│ Overstyrte sperrer, siste 90 dager                    (h1)                 │
│ Sperrer som ble krysset bort ved publisering. Ingen navn vises.  (text-sm) │
└───────────────────────────────────────────────────────────────────────────┘
        Månedsoppsummering                                   (h2)
        ( ✓ Oktober 2026 ) ( September ) ( August ) ( November, så langt )
        ┌ OverrideSummaryCard ───────────────────────────────────────────┐
        │ Tall for hele måneden · 18 rapporter publisert                  │
        │ … (tilstand, avsnitt 5)                                         │
        └─────────────────────────────────────────────────────────────────┘

        Sperrer som er krysset bort (4 grupper · 23 rapporter)  (h2)
        ┌ OverrideGroup (åpen, har røde) ────────────────────────────────┐
        │ ▲ Hulltaking mangler · Vanntett sjikt, membran og sluk          │
        │   9 rapporter · ⚠ 2 med reklamasjon på samme punkt              │
        │   ── Ikke tilgang eller nektet av eier · 7 rapporter · ⚠ 2 ──   │
        │   ▌⚠ 26-1042 · 14.10.2026 · v2   Reklamasjon på samme punkt  › │
        │    26-1031 · 09.10.2026          Reklamasjon på oppdraget,     │
        │                                  punkt ikke valgt · Velg … ›   │
        │    26-0998 · 02.10.2026                                       › │
        │   ── Annet · 2 rapporter ──                                     │
        │    …                                                            │
        └─────────────────────────────────────────────────────────────────┘
        ┌ OverrideGroup (lukket) ────────────────────────────────────────┐
        │ ▼ TG3 uten kostnad · Bad 2. etg, avvik            5 rapporter  │
        └─────────────────────────────────────────────────────────────────┘
```

- Rekkefølge ovenfra: toppfelt, oppsummering, gruppene. KI-oppsummeringen står først fordi den er det leder tar med i fagmøtet; listen er grunnlaget.
- 24 px mellom de to delene (`space-y-6`), 12 px mellom gruppene (`space-y-3`).
- Toppfelt: tilbakelenke «‹ Arbeidskø» (44 × 44 pt), `h1`, linjen under, samlet `SaveState` (nett og synk) til høyre som på de andre sidene. Ingen hovedknapp i toppfeltet.
- Ingen nedre linje. Siden har én hovedhandling, «Lag oppsummering», og den står i kortet.

### iPad stående (under 1024 px)

Samme rekkefølge, full bredde med 20 px marg. Månedsknappene brytes til to rader à to (`grid grid-cols-2 gap-3`), hver minst 56 pt høy. Linjene i gruppene stables: oppdragsnummer og dato på første linje, markeringen på andre.

## 4. `MonthPicker`

- `ChoiceButtons` med `legend` «Velg måned» (`legendHidden`, `h2` «Månedsoppsummering» står over).
- Fire valg i denne rekkefølgen: **siste hele måned (valgt fra start)**, de to hele månedene før den, og til slutt inneværende måned med teksten «November 2026, så langt». Det leder oftest trenger, står først. Etiketter: «Oktober 2026», «September 2026», «August 2026». Månedsnavn med liten forbokstav i løpende tekst, stor i knappen.
- Pillene får `min-h-14` (56 pt) på denne siden (klasse på omsluttende element, ikke ny variant). Valgt pille har hakeikon (fra `ChoiceButtons`).
- Bytte av måned henter oppsummeringen for måneden (ren lesing). Listen under endres ikke (den er alltid siste 90 dager).
- Adressen får `?maned=2026-10`, så tilbakeknappen og lenker virker. Ukjent eller ikke tillatt måned gir siste hele måned uten feilmelding (serveren avgjør).

## 5. `OverrideSummaryCard`

`<section aria-labelledby>` med skjult overskrift «Oppsummering for oktober 2026». Første linje i kortet, alltid (`text-sm text-slate-700`):

«Tall for hele måneden · 18 rapporter publisert». Under 5 rapporter legges til: «· Under 5 rapporter: bare antall, ingen prosent».

### Tilstander

Statusen leses fra serveren (`getOverrideSummary` og statusoppslaget i KI-loggen), aldri bare fra lokal tilstand.

| Tilstand | Hva vises | Knapper |
|---|---|---|
| `no_releases` (0 rapporter) | `Notice`-flate uten hake: «Ingen rapporter ble publisert i denne måneden.» KI kalles ikke. | ingen |
| `empty` (ingen tekst) | Flate `sand`, ingen kant, 12 px hjørner, `p-6`. Gnisteikon og «KI kan lage en kort oppsummering fra tallene. Ingen navn og ingen begrunnelser sendes. Du godkjenner før den lagres.» | «Lag oppsummering» (`primary lg`, 56 pt, minst 280 px på PC, full bredde på iPad stående) · «Skriv selv» (`ghost md`) |
| `working` | `AiSuggestion` i `working`: «KI jobber …». | alle låst |
| `suggested` | `AiSuggestion` med `source` «månedsoppsummering». «Din tekst» er lagret tekst for måneden, eller «Ingen tekst ennå.» (`text-slate-500`). | Bruk · Behold min tekst · Nytt forslag (som overalt) |
| `accepted` / `edited` | Hvitt `Card`. `AiTextMark` «Tekst fra KI, godkjent» over teksten. Teksten `text-base leading-relaxed whitespace-pre-wrap`. | «Endre tekst» (`secondary md`) · «Nytt forslag» (`ghost md`) |
| `manual` | Som over, uten KI-merket. Linje over teksten: «Skrevet uten KI» (`text-sm text-slate-600`). | «Endre tekst» · «Lag oppsummering med KI» (`ghost md`) |
| `rejected` uten tidligere tekst | Som `empty`, med linjen «Forslaget ble avvist. Ingen tekst er lagret.» over knappene. | som `empty` |
| `rejected` med tidligere tekst | Den lagrede teksten vises som i `accepted`/`edited`/`manual`. Linje: «Forslaget ble avvist. Teksten under er uendret.» | som den lagrede teksten |
| `editing` | `Field` + `Textarea` «Oppsummering for oktober 2026» (`min-h-32`), fylt med gjeldende tekst. Hjelpetekst: «Ikke skriv navn, e-post eller telefonnummer. Høyst 2 000 tegn.» Tegnteller fra 1 600 tegn: «1 640 av 2 000 tegn». | «Lagre tekst» (`primary lg`) · «Avbryt» (`ghost md`) |
| `error` | Under knappene: `FormMessage` «Oppsummeringen kunne ikke lages nå. Prøv igjen senere.» Listen virker. | som før |
| `limit` | `FormMessage` «Du har laget mange oppsummeringer den siste timen. Prøv igjen senere.» (eller «… i dag.» for organisasjonsgrensen) | som før |
| `stopped` (vakt i kjernen) | `AiSuggestion` med `stoppedText` «KI-svaret ble stoppet fordi det ikke stemte med tallene. Prøv igjen eller skriv selv.» | Nytt forslag · «Skriv selv» |
| `ai_off` | I `empty`-flaten: «KI er av.» i stedet for KI-teksten. «Lag oppsummering» vises ikke. | «Skriv selv» (`secondary md`) |
| `offline` | «Lag oppsummering» får `aria-disabled="true"` (stone-flate) og teksten «Krever nett» under knappen. «Lagre tekst» likedan. Lagret tekst vises fortsatt hvis den er lastet. | låst |

### Godta, endre, avvis (samme mønster som sammendraget)

Oppgavekortets tre handlinger er de vanlige knappene i forslagskortet, så leder lærer ingenting nytt:

| Oppgavekortet | Knapp | Hva skjer |
|---|---|---|
| Godta | «Bruk» (`variant="ai" size="lg"`, 56 pt, hovedknapp i kortet) | KI-teksten lagres i `override_summaries.text`, status `accepted`. Kortet går til `accepted` med «Angre». |
| Endre | «Endre tekst» etter «Bruk» → `editing` → «Lagre tekst» | Status `edited`. KI-forslaget i loggen røres ikke. |
| Avvis | «Behold min tekst» | Status `rejected`. Ingen tekst lagres. |

- «Angre» følger forslagskortet (bare når det ikke finnes et nyere forslag).
- «Skriv selv» åpner `editing` med tomt felt; «Lagre tekst» gir `manual`.
- En annen leder kan avgjøre et åpent forslag; kortet viser da forslaget i `suggested` for alle med tilgang.
- **Feil i lederens tekst** (fra serveren, `FormMessage` under feltet, `aria-invalid`, fokus til feltet, teksten beholdes):
  - «Oppsummeringen kan ikke inneholde navn på ansatte.»
  - «Oppsummeringen kan ikke inneholde e-postadresser.»
  - «Oppsummeringen kan ikke inneholde telefonnumre.»
  - «Teksten ser ut til å inneholde et fødselsnummer. Fjern det.»
  - «Teksten er for lang. Grensen er 2 000 tegn.»
  - Generell: «Teksten ble ikke lagret. Prøv igjen.»
- Kvittering etter lagring: statusområdet sier «Oppsummeringen er lagret.» Ingen melding som forsvinner av seg selv.

## 6. Gruppene

### Overskrift og tomt

- `h2` «Sperrer som er krysset bort» med tallet i parentes: «(4 grupper · 23 rapporter)».
- **Tom liste:** `Card` med hakeikon og «Ingen sperrer er krysset bort de siste 90 dagene.» Månedsoppsummeringen står fortsatt over.
- **Feil ved lasting:** `Warning` «Listen kunne ikke hentes. Last siden på nytt.» med knappen «Last på nytt» (`secondary md`).

### `OverrideGroup` (nivå 1: kode og kontrollpunkt)

```
┌ hvitt kort, kant line, 12 px hjørner ────────────────────────────────────┐
│ [button aria-expanded, hele raden, min-h-14, px-6 py-4]                   │
│ Hulltaking mangler · Vanntett sjikt, membran og sluk     (text-base 600)  │
│ 9 rapporter   [⚠ 2 med reklamasjon på samme punkt]      ˅ (chevron)       │
├───────────────────────────────────────────────────────────────────────────┤
│ (innhold: OverrideReasonBlock …)                                          │
└───────────────────────────────────────────────────────────────────────────┘
```

- `<h3>` rundt en `<button type="button" aria-expanded aria-controls>`; hele overskriftsraden er trykkflaten (minst 56 pt høy, full bredde). Chevron til høyre (`aria-hidden`, roterer uten animasjon ved `prefers-reduced-motion`).
- Linje 1: kodeetiketten (avsnitt 9) · punktnavnet fra malversjonen. Overstyring uten punkt: «· Hele rapporten».
- Linje 2 (`text-sm text-slate-700`): «9 rapporter» (unike rapporter, «1 rapport» i entall). Har gruppen røde: `Badge tone="danger"` med trekant: «2 med reklamasjon på samme punkt». Har gruppen nøytrale: `Badge tone="neutral"` «1 reklamasjon uten punkt».
- Venstrekant 4 px `urgent-line` når gruppen har røde; ellers ingen venstrekant. Kanten er pynt, merket bærer meningen.
- **Åpen fra start** når gruppen har røde. Rekkefølge: grupper med røde først (flest røde øverst), så resten etter antall rapporter, flest først; likt antall sorteres på etiketten. Siden sorterer aldri på person.
- `aria-label` på knappen: «Hulltaking mangler, Vanntett sjikt, membran og sluk. 9 rapporter, 2 med reklamasjon på samme punkt.»

### `OverrideReasonBlock` (nivå 2: grunn)

- Alltid synlig når gruppen er åpen. Ikke en egen knapp (to nivåer, to trykk).
- `<h4>` (`text-sm font-semibold`, `px-6 pt-4`): grunnetiketten fra `PUBLISH_OVERRIDE_REASON_LABELS` («Ikke tilgang eller nektet av eier», «Gjelder ikke dette rommet», «Beskrevet et annet sted i rapporten», «Annet»), deretter «· 7 rapporter» og eventuelt det røde merket i liten form («⚠ 2»), med `aria-label` «2 med reklamasjon på samme punkt».
- Grunnene sortert som gruppene: røde først, så antall.
- Under grunnen «Annet» står en linje: «Begrunnelsen står i utgivelsen.» (`text-sm text-slate-600`). Ingen fritekst på siden.
- Under: `<ul>` med `OverrideReleaseRow`, skilt med `border-t border-line`.

### `OverrideReleaseRow` (én utgivelse)

```
▌⚠ 26-1042 · 14.10.2026 · v2     [⚠ Reklamasjon på samme punkt]       ›
```

- Hele raden er én lenke (`<a>`, minst 56 pt høy, `px-6`) til utgivelsen (`href` bygget på serveren). Lenketekst for skjermleser: «Oppdrag 26-1042, publisert 14.10.2026, versjon 2. Reklamasjon på samme punkt. Åpne utgivelsen.»
- Innhold: oppdragsnummer (`font-medium`), dato (Oslo-dato, `dd.mm.åååå`), og «v2» når versjonen ikke er 1. Pil `›` til høyre (`aria-hidden`).
- Sortert på dato, nyeste først. Aldri navn, adresse eller fritekst.
- Markering: `ClaimMarker` (avsnitt 7) etter datoen på PC, på egen linje på iPad stående.
- Fokusramme i `fjord` rundt hele raden.

## 7. `ClaimMarker`

| Type | Utseende | Tekst | Lenke |
|---|---|---|---|
| `same_checkpoint` (rød) | `Badge tone="danger"` med trekantikon (`aria-hidden`). Raden får venstrekant 4 px `urgent-line`. Ingen rød flate på hele raden (for mye rødt); bare kant og merke. | «Reklamasjon på samme punkt» | ingen egen (raden er lenken) |
| `no_checkpoint` (nøytral) | `Badge tone="neutral"` med informasjonsikon (sirkel med «i», `aria-hidden`). | «Reklamasjon på oppdraget, punkt ikke valgt» | «Velg kontrollpunkt ›» (`text-fjord-dark underline`, min. 44 pt) til redigeringen av reklamasjonen |
| ingen | ingenting | — | — |

- Nøytral rad med «Velg kontrollpunkt»: to lenker i samme rad går ikke. Raden deles: venstre del (nummer, dato, versjon, merke) er lenken til utgivelsen, «Velg kontrollpunkt» er egen lenke til høyre, før pilen. Begge minst 44 × 44 pt, 12 px mellomrom.
- Har oppdraget flere reklamasjoner, vises én markering: rød vinner over nøytral.
- Rødt står aldri uten tekst. Trekanten er samme form som i `Warning`, men i `urgent-text`.
- Kontrast: `urgent-text` på `urgent-fill` (merket) og `urgent-line` som kant mot hvit (3:1, ikke eneste kjennetegn) legges i `contrast.test.ts` hvis de ikke står der.

## 8. Tilgang, uten nett og lasting

- **Uten `claims.read`** (takstmann, kontor, også med `access.inspectors_edit_all`): siden viser standard «Ingen tilgang» (samme komponent som andre sider). Lenken i arbeidskøen vises ikke.
- **Lenken i arbeidskøen:** `buttonVariants({ variant: "secondary", size: "md" })`-lenke «Overstyringer» i toppen ved siden av «Nytt oppdrag» (til venstre for den; «Nytt oppdrag» er fortsatt eneste hovedknapp). På iPad stående brytes den til egen linje.
- **Uten nett:** over oppsummeringen en `Warning` (sand): «Siden trenger nett. Det som vises, kan være gammelt.» Har siden ikke lastet: bare denne meldingen og tilbakelenken, aldri en tom side. «Lag oppsummering» og «Lagre tekst» låst med «Krever nett». Synkstatus i toppfeltet som på de andre sidene.
- **Lasting:** listen og tallene kommer fra serveren ved første visning (ingen spinner). Månedsbytte: kortet viser «Henter …» (`text-sm`) og knappene er låst til svaret er her.
- **KI-porten av:** listen virker som vanlig; kortet i `ai_off`.

## 9. Etiketter for sperrekoder (`src/shared/config/publish-check-labels.ts`)

Korte, faste etiketter for gruppeoverskriften og KI-grunnlaget. Funntekstene i `publish-check-texts.ts` er lengre og gjelder ett funn; disse gjelder en gruppe.

| Kode | Etikett |
|---|---|
| `wet_or_below_ground_missing_hole` | Hulltaking mangler |
| `tg3_missing_cost` | TG3 uten kostnad |
| `tg2_tg3_missing_cause_or_consequence` | TG2 eller TG3 uten årsak eller konsekvens |
| `mandatory_without_tg` | Punkt uten TG |
| `inspection_date_missing` | Befaringsdato mangler |
| ukjent kode | Annen sperre |

Ukjent kode viser aldri selve koden eller tekst fra data. TG står alltid som tekst.

## 10. Reklamasjonsskjemaet: «Kontrollpunkt»

- Nytt `Field` «Kontrollpunkt» rett under «Bygningsdel eller kontrollpunkt». Den gamle etiketten endres til «Bygningsdel (fritekst)», så de to feltene ikke forveksles.
- `Select` med `<optgroup>`:
  1. «Krysset bort ved publisering» (bare når slike finnes): punktene som ble krysset bort i utgivelsene på oppdraget, tekst «Vanntett sjikt, membran og sluk (Bad 1. etg)».
  2. Én `optgroup` per rom eller kapittel, med de øvrige punktene.
  - Første valg alltid «Ikke valgt» (verdi tom).
- **Forhåndsvalg:** når serveren har et tydelig treff, er det valgt, og under feltet står hjelpeteksten «Foreslått fra bygningsdelen. Sjekk at det stemmer.» Ellers «Ikke valgt» og hjelpeteksten «Velg punktet hvis du vet det. Da ser leder om sperren ble krysset bort.» Forhåndsvalget er ikke KI og merkes ikke som KI.
- Feil fra serveren: «Kontrollpunktet finnes ikke i rapporten på dette oppdraget.» (samme tekst for ukjent kode, annen organisasjon og annet oppdrag).
- **På saken etter lagring** (`[claimId]/page.tsx`), når punktet ble krysset bort i en utgivelse før reklamasjonen: `Warning` (sand) «Denne sperren ble krysset bort ved publisering 14.10.2026 (versjon 2): Ikke tilgang eller nektet av eier.» med lenken «Se utgivelsen ›». Ingen fritekst.
- Arkivert kode på eldre sak: valget står med navnet fra malversjonen og «(arkivert)».

## 11. Tekster samlet (`override-texts.ts`)

| Sted | Tekst |
|---|---|
| `h1` / `document.title` | Overstyrte sperrer, siste 90 dager / «Overstyringer – {produktnavn}» |
| Linje under `h1` | Sperrer som ble krysset bort ved publisering. Ingen navn vises. |
| `h2` oppsummering | Månedsoppsummering |
| Grunnlag | Tall for hele måneden · {n} rapporter publisert |
| Lite grunnlag | Under 5 rapporter: bare antall, ingen prosent |
| Ingen utgivelser | Ingen rapporter ble publisert i denne måneden. |
| Tom oppsummering | KI kan lage en kort oppsummering fra tallene. Ingen navn og ingen begrunnelser sendes. Du godkjenner før den lagres. |
| Knapper | Lag oppsummering · Skriv selv · Endre tekst · Lagre tekst · Avbryt · Lag oppsummering med KI |
| Forslagskortet | som `AI_SUGGESTION_TEXTS` (Bruk · Behold min tekst · Nytt forslag · Angre), kilde «månedsoppsummering» |
| Uten KI | Skrevet uten KI |
| Avvist | Forslaget ble avvist. Ingen tekst er lagret. / Forslaget ble avvist. Teksten under er uendret. |
| KI-feil | Oppsummeringen kunne ikke lages nå. Prøv igjen senere. |
| Grense | Du har laget mange oppsummeringer den siste timen. Prøv igjen senere. / … i dag. Prøv igjen i morgen. |
| Stoppet | KI-svaret ble stoppet fordi det ikke stemte med tallene. Prøv igjen eller skriv selv. |
| Lagret | Oppsummeringen er lagret. |
| `h2` liste | Sperrer som er krysset bort ({g} grupper · {n} rapporter) |
| Tom liste | Ingen sperrer er krysset bort de siste 90 dagene. |
| Uten punkt | Hele rapporten |
| Rød | Reklamasjon på samme punkt / {n} med reklamasjon på samme punkt |
| Nøytral | Reklamasjon på oppdraget, punkt ikke valgt / Velg kontrollpunkt / {n} reklamasjon(er) uten punkt |
| «Annet» | Begrunnelsen står i utgivelsen. |
| Uten nett | Siden trenger nett. Det som vises, kan være gammelt. / Krever nett |
| Listefeil | Listen kunne ikke hentes. Last siden på nytt. |

Ingen gjetteord. Entall og flertall: «1 rapport», «2 rapporter».

## 12. Mål

| Ting | Mål |
|---|---|
| Hovedknapper («Lag oppsummering», «Bruk», «Lagre tekst») | min. 56 pt (`min-h-14`), min. 280 px på PC, full bredde på iPad stående |
| Månedsknapper | min. 56 pt høy |
| Gruppeknapp og utgivelsesrad | min. 56 pt høy, full kortbredde |
| Andre knapper og lenker («Skriv selv», «Endre tekst», «Velg kontrollpunkt», «‹ Arbeidskø») | min. 44 × 44 pt |
| Avstand mellom knapper | 8 px, 12 px fra `md` |
| Kortets indre marg | 24 px, 20 px under 768 px |
| Venstrekant ved rødt | 4 px `urgent-line` |
| Hjørner | kort 12 px, felt 8 px, knapper og merker runde |
| Innholdsbredde | maks 760 px |
| Trykk | arbeidskø → utgivelse: 3 (Overstyringer, åpne gruppe, utgivelse); fra siden 2; røde grupper er åpne, så 1. Oppsummering: 2 (Lag oppsummering, Bruk). |

## 13. Universell utforming

- WCAG 2.1 AA, axe uten feil på PC, iPad liggende og stående.
- Overskrifter: `h1` siden, `h2` «Månedsoppsummering» og listen, `h3` gruppene (med knappen inni), `h4` grunnene.
- Gruppene: `<button aria-expanded aria-controls>`; innholdet har `id` og er `hidden` når lukket.
- Ett `role="status" aria-live="polite"` for siden (måned hentet, oppsummering lagret, avvist, feil). Forslagskortet har sitt eget som før. Ingen `assertive`.
- Fokus: månedsbytte → blir på valgt pille; «Lag oppsummering» → blir på knappen til forslaget er klart, så «Bruk»; «Bruk» og «Behold min tekst» → «Angre»; «Endre tekst» og «Skriv selv» → tekstfeltet; «Lagre tekst» → teksten (`tabIndex={-1}`); feil → feltet eller meldingen.
- Ingen informasjon bare i farge: rødt har tekst og trekant, nøytralt har tekst og «i», KI-tekst har ordet «KI».
- Alt virker med tastatur; ingen fokusfelle.
- Mørk visning: bare tokens.

## 14. Ikke med (som oppgavekortet)

Filter eller visning per takstmann og navn (spørsmål 100), «Annet»-teksten (spørsmål 123), advarsler, automatisk kjøring og varsel, eksport, andre perioder, egne filter, andel per bad, linjen ved kryssboksen i publiseringen.

## 15. Sjekkliste for utvikler

- [ ] Ingen navn, ansatt-id, adresse eller fritekst på siden eller i kortet.
- [ ] Rødt har alltid teksten «Reklamasjon på samme punkt» og trekant; nøytralt har «Velg kontrollpunkt».
- [ ] Røde grupper står øverst og er åpne; resten sortert på antall. Aldri sortering på person.
- [ ] Gruppene er `button` med `aria-expanded`; to nivåer, to trykk til utgivelsen.
- [ ] Oppsummeringen bruker `AiSuggestion` og `AiTextMark` uendret; «Bruk» = godta, «Endre tekst» = endre, «Behold min tekst» = avvis.
- [ ] Merket «Tekst fra KI, godkjent» bare ved `accepted`/`edited` fra serveren; `manual` har «Skrevet uten KI».
- [ ] «Lag oppsummering» vises ikke når måneden har 0 rapporter eller KI er av; låst med «Krever nett» uten nett.
- [ ] Lenken «Overstyringer» i arbeidskøen bare med `claims.read`; «Nytt oppdrag» er fortsatt eneste hovedknapp der.
- [ ] Etiketter for ukjent kode gir «Annen sperre», aldri rå tekst.
- [ ] E2e måler hovedknapper (56 pt), månedsknapper og rader (56 pt), andre trykkflater (44 pt) på PC, iPad liggende og stående; axe uten feil.
