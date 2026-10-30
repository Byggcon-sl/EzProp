# Funksjon: UU-funn 6–9 fra nattløkken 30.10.2026

- **Fase:** 1 – Prøve uten nett
- **Modul:** `offline-trial` (`trial-form-view.tsx`), sidene for prøven (`src/app/(ansatt)/prove/testskjema/trial-form-list.tsx`), `src/app/not-found.tsx`, `src/app/globals.css`
- **Status:** godkjent (prosjektleder 30.10.2026)
- **Branch:** `fase1-uu-nattlokken`, bygger på `main`
- **Støtter hovedmål:** Tid: større trykkflate og synlige kolonnenavn gir færre feiltrykk og mindre leting på iPaden. Reklamasjoner: et felt med fokus skjules aldri bak den faste statuslinjen, så takstmannen ser hva han skriver i, og verdier havner ikke i feil kolonne. KI først: indirekte, se under.

## Problem
Nattløkken 30.10.2026 (`docs/agenter/tilstand.md`, «Oppgaver fra nattløkken», nr. 6–9) fant fire små brudd på universell utforming:

6. Tabellceller i testskjemaet (`TableCellInput`) viser kolonnenavnet bare som blek plassholdertekst (ca. 3:1 kontrast), og den forsvinner når cellen har en verdi. Takstmannen ser ikke hvilken kolonne han skriver i.
7. Statuslinjen øverst er klistret fast (`sticky top-0`) på testskjemasiden og i listen. Når et felt får fokus (tabulator, neste-knapp på iPad-tastaturet), kan nettleseren rulle det inn under linjen (WCAG 2.4.11).
8. Lenken «Til forsiden» på siden «Fant ikke siden» har en trykkflate under 44 px.
9. Meldingen «Vent til alt er lagret på serveren før du bytter» i `CandidatePicker` leses ikke opp av skjermleser.

Lar vi det være, blir de samme feilene kopiert inn i den ekte malen og skjermene i fase 2.

## KI først
Nei. Dette er rettinger i grensesnittet. Det er ingenting KI kan forberede her. Synlige etiketter og felt som ikke skjules er likevel en forutsetning for at takstmannen senere kan kontrollere KI-forslag felt for felt.

## Brukerhistorier
- Som **takstmann** vil jeg se kolonnenavnet over hver tabellcelle, også når den er fylt ut, slik at jeg ikke skriver i feil kolonne.
- Som **takstmann** vil jeg at feltet jeg skriver i, alltid er synlig under statuslinjen.
- Som **takstmann med skjermleser** vil jeg høre hvorfor knappene for synkløsning er sperret.

## Omfang
**Med:**
1. **Etikett på tabellceller** (`TableCellInput` i `trial-form-view.tsx`): en synlig, liten etikett med kolonnenavnet over feltet (for eksempel `text-xs font-medium text-slate-700`, minst 4,5:1 mot `bg-slate-50`). Enkleste løsning: etikett i hver rad (`<label>` rundt eller med `htmlFor`), så den alltid står ved feltet når radene brytes på iPad. Er det for mye støy, holder det med første rad (kortet krever minst første rad). Det tilgjengelige navnet skal fortsatt si rad («Kolonne, rad 2»): behold `aria-label` eller lag navnet slik at raden er med. Plassholderen kan fjernes eller beholdes; den er ikke lenger eneste visning av navnet.
2. **`scroll-padding-top` på `html`** i `src/app/globals.css`, lik høyden på statuslinjen. Statuslinjen har varierende høyde (varsel om lav lagringsplass og feil kan komme i tillegg). Enkleste som virker: en fast verdi som dekker vanlig høyde med margin (for eksempel `scroll-padding-top: 7rem`), med en kort kommentar om hvorfor. Er det enkelt, kan verdien i stedet settes som CSS-variabel fra høyden på statuslinjen; ikke bygg en måler med `ResizeObserver` hvis den faste verdien holder i e2e-testen.
3. **«Til forsiden»** i `src/app/not-found.tsx`: `inline-flex min-h-11 min-w-11 items-center` (behold `mt-6`, farge og understrek).
4. **Meldingen i `CandidatePicker`** (`trial-form-list.tsx`): opplest med `role="status"` (gir `aria-live="polite"`). Beholderen skal stå i DOM hele tiden og bare teksten byttes, fordi en levende region som legges inn samtidig med teksten ofte ikke leses opp. Tom beholder skal ikke ta plass (for eksempel ingen marg når den er tom).
5. **Tester (e2e, `pc` og `ipad`)**, i eksisterende filer der det passer (`e2e/fase-1-testskjema.spec.ts`, `e2e/fase-0a.spec.ts` eller filen som allerede tester siden):
   - a. Tabellfeltet: etiketten med kolonnenavnet er synlig i første rad, også etter at cellen er fylt ut, og `getByLabel("<kolonne>, rad 1")` (eller tilsvarende) finner feltet.
   - b. Statuslinjen: et felt langt nede får fokus med tastaturet (`focus()` eller Tab) og ligger helt under statuslinjen (feltets `top` ≥ statuslinjens `bottom` fra `boundingBox`).
   - c. «Fant ikke siden»: lenken «Til forsiden» er minst 44 × 44 px.
   - d. `CandidatePicker`: elementet med `role="status"` finnes, og inneholder meldingen når noe venter (bruk eksisterende oppsett i synktestene som får endringer til å vente, hvis det er enkelt; ellers holder det at regionen finnes og at teksten er der i én eksisterende test).
6. Versjon i `package.json` økes (patch), kryss i planen og tilstandsfilen oppdatert (nr. 6–9 merket rettet).

**Ikke med (bevisst utelatt):**
- Ingen ny avhengighet. `@axe-core/playwright` (nr. 5) er en egen oppgave.
- Ingen ny funksjon, ingen ny design av statuslinjen eller tabellfeltet utover etiketten.
- Ikke rør synk-ADR-en, sammenligningen av kandidatene eller branchen `fase1-sammenligning-adr`.
- Ingen andre UU-rettinger enn nr. 6–9, og ingen gjennomgang av alle sider.
- Ingen endring i data, regler eller tilgang.

## Tilgang
Ingen endring. Sidene har samme tilgang som før.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
Ingen nye tabeller, felter eller faste koder.

## Skjermer
- Testskjema (iPad og PC): tabellfeltet får kolonnenavn over cellene; felt med fokus havner under statuslinjen. Antall trykk uendret.
- Listen over testskjema: meldingen om å vente leses opp.
- «Fant ikke siden»: større trykkflate på lenken.

## Regler
Ingen.

## Akseptkriterier
- [ ] Kolonnenavnet står synlig over tabellcellene (minst første rad), med kontrast minst 4,5:1, også når cellen er fylt ut (e2e)
- [ ] Hver celle har fortsatt et tilgjengelig navn med kolonne og rad (e2e)
- [ ] Et felt som får fokus, dekkes ikke av statuslinjen (e2e, `pc` og `ipad`)
- [ ] «Til forsiden» er minst 44 × 44 px (e2e)
- [ ] «Vent til alt er lagret på serveren før du bytter» står i en `role="status"`-region som finnes i DOM før teksten vises (e2e eller enhetstest)
- [ ] Ingen ny avhengighet; `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen ny spørring, så ingen ny isolasjonstest trengs (eksisterende tester står)
- [ ] Virker på iPad-størrelse (e2e)

## Åpne spørsmål
- Ingen. Ingen fag-, pris- eller personvernspørsmål.
