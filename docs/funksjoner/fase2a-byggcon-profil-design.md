# Komponentspesifikasjon: Byggcon-profilen i EzProp

- **Oppgavekort:** `docs/funksjoner/fase2a-byggcon-profil.md` (fase 2a, prioritert av Ståle 12.11.2026)
- **Laget av:** ui-designer, 12.11.2026
- **Grunnlag:** `docs/design/byggcon-profil/` (palett, skrifter, Optiplans tema og skjermbilder)
- **Støtter hovedmål:** De ansatte: ett Byggcon-uttrykk i byggcon.no, Optiplan og EzProp, høy kontrast i sollys, samme luft og trykkflater som før. / KI i bunnen: KI-merket og forslagskortet får en egen tone som ikke ligner TG, synk eller status, og står alltid med ordet «KI». / Reklamasjoner: TG-tonene er like i begge systemene og står alltid med tekst, så TG ikke leses feil.

Alle kontrasttall under er regnet ut med WCAG-formelen (relativ luminans) og skal bekreftes av `contrast.test.ts`.

## 1. Avvik fra oppgavekortet (designvalg, må føres som A-beslutning)

| # | Kortet sier | Spesifikasjonen sier | Hvorfor |
|---|---|---|---|
| D1 | Fokusramme i mørk fjord (#255A8C), minst 3:1 også mot night | Fokusramme i **fjord #316AA0** | Mørk fjord mot night er bare **2,5:1** og stryker på kravet. Fjord gir 5,2:1 på snow, 4,8:1 på sand, 5,7:1 på hvit og 3,1:1 på night. Én farge klarer alle fire. |
| D2 | Bare Inter 400/600 og Schibsted 600 lastes på forhånd | **Inter (alle fire vektene) lastes på forhånd, Schibsted Grotesk lastes ved behov** | `next/font/local` styrer `preload` per skriftfamilie, ikke per vekt. Deles Inter i to familier, finner nettleseren ikke vekt 500 (bruker 400). Brødtekst og knapper trenger Inter straks; overskrifter tåler et kort bytte (`adjustFontFallback` holder målene). Skriftene ligger i bufferen til `sw.js` etter første besøk. |
| D3 | Lys tekst mot night på hovedknappen, «også deaktivert» | Deaktivert hovedknapp er **stone (slate-500) med hvit tekst**, 5,7:1 | Night med `opacity-60` gir uleselig tekst. Stone ser tydelig avslått ut og er lesbar. Testparet blir `white` mot `slate-500`. |
| D4 | – | «Nytt forslag» i KI-kortet blir `secondary` (ikke `ghost` + egen ring) | Knappen er hovedhandling når forslaget gjelder eldre tekst (T-0004). Da skal den se ut som en knapp, ikke en lenke. |

## 2. Tokens i `src/app/globals.css` (`@theme`)

Alle `--color-*` skrives som `#rrggbb` (kontrasttesten krever det). Ingen `rgb()` med gjennomsiktighet, ingen `var()` i fargetokens.

### 2.1 Paletten

| Token | Verdi | Brukes til |
|---|---|---|
| `--color-snow` | `#f5f4f0` | bakgrunn (= `canvas`, `slate-50`) |
| `--color-sand` | `#eeebe3` | paneler, framhevede flater, merker (= `slate-100`) |
| `--color-night` | `#0f1924` | tekst, hovedknapp, valgt menypunkt (= `slate-900`) |
| `--color-fjord` | `#316aa0` | aksent, fokusramme (= `brand-600`) |
| `--color-fjord-dark` | `#255a8c` | lenketekst (= `brand-700`) |
| `--color-stone` | `#5d6774` | dempet tekst, deaktivert hovedknapp (= `slate-500`) |
| `--color-line` | `#dfdcd4` | kanter og skillelinjer, night ca. 12 % (= `slate-200`) |
| `--color-line-strong` | `#c6c3bb` | sterkere linje, ca. 25 % (= `slate-300`) |
| `--color-canvas` | `#f5f4f0` | bakgrunnen bak kortene |
| `--color-field` | `#7a828d` | kant på skjemafelt: 3,9:1 hvit, 3,5:1 snow, 3,3:1 sand |

Ingen gul («sun») i paletten: gult betyr TG2 / «følg med».

### 2.2 Brand og slate (omdefineres, sidene følger med)

`brand`: 50 `#eef3f8`, 100 `#dbe6f1`, 200 `#b9cde2`, 400 `#6e97bf`, 600 `#316aa0`, 700 `#255a8c`, 900 `#16324f`.

`slate`: 50 `#f5f4f0`, 100 `#eeebe3`, 200 `#dfdcd4`, 300 `#c6c3bb`, 400 `#858d98` (bare pynt), 500 `#5d6774`, 600 `#414b58`, 700 `#303a47`, 800 `#1d2732`, 900 `#0f1924`, 950 `#0a1119`.

Kontrollerte tekstpar: slate-500 mot sand 4,8:1 · slate-600 mot sand 7,4:1 · slate-700 mot sand 9,7:1 · night mot sand 14,9:1.

### 2.3 Status (felles med Optiplan) og TG

Statustokens (brukes av merker, varsler, feilmeldinger):

| Token | Flate | Tekst | Kant/strek | Tekst mot flate |
|---|---|---|---|---|
| `ok` | `#cdeedd` | `#155e3e` | `#1f8a5b` | 6,2:1 |
| `watch` | `#fbe7b5` | `#6b4405` | `#b7791f` | 7,0:1 |
| `urgent` | `#f8d0cc` | `#8b2a1f` | `#c0392b` | 6,1:1 |
| `unknown` | `#e4e1d8` | `#4a463f` | `#6e6a62` | 7,2:1 |

Navn: `--color-ok-fill`, `--color-ok-text`, `--color-ok-line` osv.

TG-tokens (samme hex, skrevet ut på nytt, ingen `var()`):

| TG | `--color-tg{n}-bg` | `--color-tg{n}-text` | Tone |
|---|---|---|---|
| TG0 | `#cdeedd` | `#155e3e` | grønn |
| TG1 | `#cdeedd` | `#155e3e` | grønn |
| TG2 | `#fbe7b5` | `#6b4405` | gul |
| TG3 | `#f8d0cc` | `#8b2a1f` | rød |
| TGIU | `#e4e1d8` | `#4a463f` | varm grå |

Navn: `tg0`, `tg1`, `tg2`, `tg3`, `tgiu`. TG0 og TG1 har samme tone, som i Optiplan; teksten skiller dem. **Regel: TG vises alltid med tekst («TG2» og gjerne «Vesentlige avvik»), aldri bare farge.** Ingen TG-komponent nå (kommer med «Badet på PC»).

`urgent-line` `#c0392b` brukes også som fyll på knapper som fjerner noe, med hvit tekst (5,4:1). `urgent-text` på hvit 8,6:1.

### 2.4 Synkstatus

Ikke TG-grønn, ikke TG-gul, ikke rød. Ikon og tekst er alltid med.

| Tilstand (`SyncStatusKind`) | Token | Flate | Tekst | Kontrast |
|---|---|---|---|---|
| `allSaved` «Alt lagret» | `sync-saved` | `#dbe6f1` | `#16324f` | 10,4:1 |
| `pending` og `signInRequired` | `sync-pending` | `#eeebe3` | `#0f1924` | 14,9:1 |
| `offline` «Uten nett» | `sync-offline` | `#dfdcd4` | `#303a47` | 8,4:1 |
| `awaitingServer` | `sync-waiting` | `#eef3f8` | `#255a8c` | 6,4:1 |
| tom (før første lesing) | – | `bg-sync-offline-bg` | – | – |

Navn: `--color-sync-saved-bg`, `--color-sync-saved-text` osv. `PILL_CLASSES` i `sync-status.tsx` bruker bare disse; ingen hex i filen.

### 2.5 KI («hav», egen dempet tone)

En dempet blågrønn som skiller seg fra fjord (synk/brand), fra TG-grønn og fra alle statusflater. Ingen fiolett, ingen fargeovergang.

| Token | Verdi | Brukes til | Kontrast |
|---|---|---|---|
| `--color-ai-50` | `#e8f1f1` | flate i merket og forslagsboksen | – |
| `--color-ai-line` | `#4d7f84` | kant på merket og forslagsboksen | 4,5:1 hvit, 4,1:1 snow, 3,8:1 sand, 3,9:1 ai-50 |
| `--color-ai-700` | `#255a60` | «Bruk»-knappen, gnisteikonet | hvit tekst 7,8:1 |
| `--color-ai-900` | `#173f44` | tekst i merket og overskriften «Forslag fra KI», hover på «Bruk» | mot ai-50 10,0:1 |

`--color-ai-200` fjernes (erstattes av `ai-line`). Enhetstest: ingen KI-verdi er lik noen `tg*`, `sync-*` eller statusverdi.

Det som gjør KI gjenkjennelig, uten å stole på farge: gnisteikonet, ordet «KI» i teksten, og at **KI-merket er det eneste merket med kant** (statusmerker er flate).

### 2.6 Former, skygge og skrift

| Token | Verdi |
|---|---|
| `--radius-card` | `0.75rem` (12 px) |
| `--shadow-pop` | `0 0 0 1px #dfdcd4, 0 8px 24px rgb(15 25 36 / 0.1)` (bare menyer og dialoger) |
| `--shadow-xs`, `--shadow-sm` | `0 0 #0000` (knapper og felt har ikke skygge) |
| `--font-sans` | `var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` |
| `--font-display` | `var(--font-schibsted), var(--font-inter), ui-sans-serif, system-ui, sans-serif` |

`--shadow-card` og `.aurora-bar` fjernes. Ingen `aurora-*`.

### 2.7 Grunnregler (`@layer base`)

- `h1, h2 { font-family: var(--font-display); }` (h3 og under: Inter 600).
- `:focus-visible { outline-2 outline-offset-2 outline-fjord }` (D1).
- `[tabindex="-1"]:focus { outline: none; }` (målet for hopplenken).
- `body { bg-canvas text-slate-900 antialiased }` (som før).

## 3. Skrift (`src/app/layout.tsx`)

- `inter = localFont({ src: [400, 500, 600, 700], variable: "--font-inter", display: "swap", preload: true })` (D2).
- `schibsted = localFont({ src: [500, 600, 700], variable: "--font-schibsted", display: "swap", preload: false })`.
- `adjustFontFallback` står på standard. `<html className={`${inter.variable} ${schibsted.variable}`}>`.
- Filene fra `docs/design/byggcon-profil/fonts/` til `public/fonts/`, med OFL-tekstene. Roboto-filene ut.
- Linjen `<div className="aurora-bar" />` fjernes.

## 4. Felleskomponenter (`src/shared/ui`)

Høyder endres ikke: `md` = `min-h-11` (44 px), `lg` = `min-h-14` (56 px). Ingen klasser for luft eller avstand endres.

### 4.1 `button.tsx`

Grunnklasse: `inline-flex items-center justify-center gap-1.5 rounded-full text-base font-semibold transition-colors disabled:pointer-events-none` (ingen `disabled:opacity-60`).

| Variant | Hvile | Hover | Deaktivert |
|---|---|---|---|
| `primary` | `bg-night text-white` (17,7:1) | `bg-slate-800` | `bg-slate-500 text-white` (5,7:1) (D3) |
| `secondary` | `bg-transparent text-slate-900 ring-1 ring-slate-700 ring-inset` (kant 10,5:1 på snow) | `bg-slate-100` | `text-slate-500 ring-slate-300` |
| `ghost` (bare tredje handling) | `text-slate-900 underline underline-offset-4 decoration-1` | `bg-slate-100` | `text-slate-500` |
| `ai` (bare «Bruk») | `bg-ai-700 text-white` (7,8:1) | `bg-ai-900` | `bg-slate-500 text-white` |

Ingen gul knapp. `font-semibold` fordi 600 er lastet straks og leses bedre i sollys. Pilleform: `border-radius` er minst halve høyden.

### 4.2 `card.tsx`

```
tone: "default" | "sand"   (standard "default")
default: rounded-card border border-line bg-white p-6
sand:    rounded-card bg-sand p-6            (ingen kant)
```
Ingen skygge. Tilstander: ingen. Dokumentasjonskommentar: «Kort med tynn kant og 12 px hjørner (Byggcon-profilen).»

### 4.3 `badge.tsx`

`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap`, ingen kant, ingen night-fyll. 24 px høy, så det ikke ligner en knapp.

| Tone | Klasser | Kontrast |
|---|---|---|
| `neutral` | `bg-sand text-slate-700` | 9,7:1 |
| `brand` | `bg-brand-50 text-brand-700` | 6,4:1 |
| `warning` | `bg-watch-fill text-watch-text` | 7,0:1 |
| `danger` | `bg-urgent-fill text-urgent-text` | 6,1:1 |

### 4.4 `notice.tsx`

`rounded-xl bg-sand px-4 py-3 text-sm text-slate-900`, med et lite hakeikon (`aria-hidden`) foran teksten. Ikke grønn: kvitteringen skal ikke konkurrere med TG0. `role="status"` som før.

### 4.5 `form.tsx`

- Felt (`Input`, `Textarea`, `Select`): `rounded-lg` (8 px) i stedet for `rounded-xl`; `border-field`; `focus:border-fjord`; `aria-invalid:border-urgent-line` (5,4:1).
- Deaktivert felt: `disabled:bg-sand disabled:text-slate-600`.
- `FieldError`: `text-urgent-text`.
- `FormMessage`: `rounded-xl bg-urgent-fill px-3 py-2 text-sm text-urgent-text`.
- Etikett og `legend`: `text-slate-700 font-medium` (som før). Avkrysning og radio: `accent-fjord`.

### 4.6 `ai-text-mark.tsx`

`inline-flex h-6 items-center gap-1 rounded-full bg-ai-50 px-2.5 text-xs font-medium whitespace-nowrap text-ai-900 ring-1 ring-ai-line ring-inset`. Gnisteikon i `text-ai-700`. Teksten «Tekst fra KI, godkjent» står.

### 4.7 `ai-suggestion.tsx`

- Kortet: `Card` (default).
- Overskrift «Forslag fra KI · …»: `text-ai-900`, gnisteikon `text-ai-700`.
- Forslagsboksen: `rounded-xl border border-ai-line border-l-4 bg-ai-50 p-4 text-slate-900` (15,4:1). Ingen `bg-gradient-*`.
- Avvist forslag (`dimmed`): `text-slate-600` i stedet for `opacity-70` (7,7:1 mot ai-50).
- Meldingsboks `warning`: `bg-watch-fill text-watch-text`; `neutral`/`working`: `bg-snow text-slate-900`.
- Knapper: «Bruk» `ai`, `lg`; «Angre» og «Behold min tekst» `secondary`, `md`; «Nytt forslag» `secondary`, `md` (D4, fjern `ring-1 ring-slate-300 ring-inset`).
- Skillelinjen over knappene: `border-line`.

## 5. Fargefeil i sidene (bare klasser, ingen omskriving)

| Fil | Fra | Til |
|---|---|---|
| `src/app/layout.tsx` | `aurora-bar` | fjernes |
| `src/app/(ansatt)/arbeidskoe/queue-toolbar.tsx` | `shadow-card` på valgt segment | `ring-1 ring-line` |
| `src/app/(ansatt)/layout.tsx` | `lg:shadow-card` | `lg:ring-1 lg:ring-line` |
| `src/app/(ansatt)/layout.tsx` / `nav-link.tsx` | valgt menypunkt i `brand-*` (hvis det er slik nå) | `bg-night text-white` |
| `src/modules/offline-trial/sync-status.tsx` | hex i `PILL_CLASSES` og `bg-[#e2e8f0]` | `sync-*`-tokens (2.4) |
| `src/modules/offline-trial/trial-form-view.tsx` | `bg-red-50 text-red-800` | `bg-urgent-fill text-urgent-text` |
| `src/app/(ansatt)/prove/testskjema/[id]/trial-form-page.tsx` | `bg-[#fbe7b5] text-[#6b4405]`; `bg-red-50 text-red-800` | `bg-watch-fill text-watch-text`; `bg-urgent-fill text-urgent-text` |
| `src/app/(ansatt)/oppdrag/[id]/bygninger/buildings-editor.tsx` | `bg-amber-50 text-amber-900` | `bg-watch-fill text-watch-text` |
| `src/app/(ansatt)/prove/ki/ai-trial-client.tsx` | `bg-emerald-600` (prikk for nett) | `bg-fjord` (teksten ved siden av bærer meningen) |
| `src/app/(ansatt)/oppdrag/[id]/status-card.tsx`, `remove-merge-actions.tsx` | `bg-red-700 hover:bg-red-800`; `text-red-800` | `bg-urgent-line text-white hover:bg-urgent-text`; `text-urgent-text` |
| `src/app/(ansatt)/remove-merge-actions.tsx` | `Card className="ring-red-200"` | `className="border-urgent-line"` |
| `src/app/(ansatt)/kontakter/contact-picker.tsx` | `text-red-800` | `text-urgent-text` |
| `agreement-card.tsx`, `admin/avtaler/agreement-form.tsx` | egen feltklasse med `rounded-xl`, `aria-invalid:border-red-700` | `rounded-lg`, `aria-invalid:border-urgent-line` |

`rg -i "aurora|gradient|roboto|#[0-9a-f]{6}" src --glob '*.tsx'` skal etterpå bare treffe `apple-icon.tsx` (`#FFFFFF`).

## 6. Hopplenken (`src/app/(ansatt)/layout.tsx`)

- Første element i `body`-innholdet: `<a href="#hovedinnhold">Hopp til hovedinnhold</a>`.
- Skjult til den får fokus: `sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-night focus:px-5 focus:font-semibold focus:text-white`.
- Målet: `<main id="hovedinnhold" tabIndex={-1}>`. Enter flytter fokus til `main` (ingen synlig ramme, regel 2.7).

## 7. Merkevarefargen (`src/shared/config/brand.ts`)

`color: "#316AA0"` (fjord). Brukes i `viewport.themeColor`, manifestet og bakgrunnen i `apple-icon.tsx` (hvit på fjord 5,7:1). Nesten lik den gamle Byggcon-blå, så ikonet på hjemskjermen ser kjent ut. Kommentaren blir «Fjord fra Byggcon-profilen».

## 8. Kontrastpar til `contrast.test.ts`

Temaet leses først; `fixed` har bare `white: #ffffff`.

| Par | Krav | Regnet |
|---|---|---|
| slate-600, slate-700, slate-900 mot snow, white, sand | 4,5 | minst 7,4 |
| white mot night (hovedknapp) | 4,5 | 17,7 |
| white mot slate-500 (deaktivert hovedknapp, D3) | 4,5 | 5,7 |
| white mot ai-700 («Bruk») | 4,5 | 7,8 |
| white mot urgent-line (fjern-knapp) | 4,5 | 5,4 |
| slate-700 (kant sekundærknapp) mot snow, white, sand | 3 | minst 9,7 |
| field mot snow, white, sand | 3 | minst 3,3 |
| fjord (fokus, D1) mot snow, white, sand, night | 3 | minst 3,1 |
| hver `tg*-text` mot `tg*-bg` | 4,5 | minst 6,1 |
| hver `sync-*-text` mot `sync-*-bg` | 4,5 | minst 6,4 |
| ai-900 mot ai-50; slate-900 mot ai-50 | 4,5 | 10,0; 15,4 |
| ai-line mot ai-50, white, snow, sand | 3 | minst 3,8 |
| slate-500 mot snow, white, sand (dempet tekst) | 4,5 | minst 4,8 |

## 9. Til skjermbildene

Samme fem skjermer før og etter: innlogging, arbeidskøen, ett oppdrag, testskjemaet med synkstatus, `/prove/ki` med et forslag vist. PC 1440 × 900 og iPad stående 1024 × 1366. Bare oppdiktede data.
