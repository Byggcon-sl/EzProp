# Design: Papirkurv og «Angre» (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-papirkurv.md` (A410–A417)
- **Grunnlag:** `docs/08-designprinsipper.md` (Byggcon-profilen), `docs/design/bilder/A-oppdrag.png` og `A-ipad-*.png` (luft og trykkflater), `docs/design/byggcon-profil/bilder/` (uttrykket)
- **Dato:** 16.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** et feiltrykk koster ett trykk på «Angre» (56 pt, i tommelsonen). «Fjern» er fortsatt ett trykk uten dialog. Papirkurven ligger sammenfoldet og tar ikke plass før den trengs.
  - **KI i bunnen:** ingen KI og derfor intet KI-merke. Meldingen og papirkurven bruker samme kjernefunksjon, så hendelsene (`how: "undo"` eller `"trash"`) blir rene data for senere analyse.
  - **Færre reklamasjoner:** ingenting forsvinner uten spor. Papirkurven viser hvem som fjernet hva, og når.

**Nye delte komponenter:** to, `UndoToast` (med `UndoToastProvider` og `useUndoToast`) og `Disclosure`. Resten bygges av `Card`, `Button`, `buttonVariants`, `FormMessage`, `SubmitButton` og `FormErrors`.

## 1. Hva som lages

| Del | Fil (forslag) | Ny eller endret |
|---|---|---|
| Angre-meldingen | `src/shared/ui/undo-toast.tsx` (`UndoToastProvider`, `useUndoToast`, `UndoToast`) | ny |
| Sammenfoldet del | `src/shared/ui/disclosure.tsx` (`<details>`/`<summary>` med Byggcon-stil) | ny |
| Utheving etter gjenoppretting | `src/shared/lib/use-restored-focus.ts` (fokus, rulling, utheving) | ny |
| Provider | `src/app/(ansatt)/layout.tsx` (rundt `main`) | endret |
| Papirkurvlisten | `src/app/(ansatt)/oppdrag/[id]/trash-list.tsx` (`TrashList`, `TrashItem`) | ny |
| «Fjern» på bygning, etasje og rom | `oppdrag/[id]/bygninger/buildings-editor.tsx` (`RemoveForm`) | endret |
| «Fjern» på part | `oppdrag/[id]/party-card.tsx` (`RemovePartyForm`) | endret |
| Papirkurven på sidene | `oppdrag/[id]/bygninger/page.tsx`, `oppdrag/[id]/page.tsx` (ved partene) | endret |
| Token for utheving | `src/app/globals.css`: `--color-restored: var(--color-sand)` og `--fixed-bottom-bar-height: 0px` | endret |

Ingen nye farger. Ingen ny avhengighet.

## 2. «Fjern»

Som i dag: `SubmitButton variant="secondary" size="md"` med teksten «Fjern», ingen dialog.

- Mens kallet går: teksten «Fjerner …» og `aria-disabled`. Raden blir stående til serveren har svart.
- Lykkes kallet: `RemoveForm` kaller `useUndoToast().show(...)` med svaret fra kjernen (id, type, visningsnavn, antall i gruppen). Raden forsvinner med revalideringen.
- Feil: `FormErrors` over knappen, som i dag. Meldingene om at etasjen eller bygningen ikke er tom, forsvinner (A414).
- Meldingen ligger i provideren, ikke i `RemoveForm`. Skjemaet forsvinner sammen med raden, men meldingen blir stående når siden lastes på nytt.

## 3. Angre-meldingen (`UndoToast`)

### 3.1 Oppsett

```
                ┌─────────────────────────────────────────────────────────┐
                │ [søppelkasse]  2. etasje og 4 rom er fjernet.  [ Angre ] [×] │
                │                Du finner det også i papirkurven.             │
                │                Mer i papirkurven                             │  <- bare når en melding er erstattet
                └─────────────────────────────────────────────────────────┘
   ─────────── (eventuelle faste hovedknapper nederst står under, udekket) ───────────
```

- **Lag som flyter over innholdet:** hvit flate, kant i `line`, `rounded-card` (12 px), skygge som menyene (`shadow-lg`). Ingen fargeovergang. Ikke mørk flate: «Angre» skal være samme hovedknapp i night som ellers.
- **Plassering:** `fixed`, midtstilt vannrett, `bottom: calc(16px + env(safe-area-inset-bottom) + var(--fixed-bottom-bar-height))`. Bredde `min(36rem, 100vw − 32px)`. Sider med faste hovedknapper nederst setter `--fixed-bottom-bar-height` til høyden på linjen, så meldingen aldri dekker dem. Ingen av sidene i denne oppgaven har en slik linje i dag, så verdien er 0.
- **Lag:** `z-40`, under modale dialoger (`<dialog>` ligger i det øverste laget). Mens en modal dialog er åpen, gjør Cmd/Ctrl+Z ingenting.
- **Innhold, venstre til høyre:**
  1. Ikon: søppelkasse, 20 px, strek 1,8, `stone`, `aria-hidden`.
  2. Tekst: linje 1 i Inter 500, 16 px, `night`. Linje 2 i 14 px `stone`.
  3. **«Angre»:** `Button variant="primary" size="lg"` (56 px, pille). `aria-keyshortcuts="Meta+Z Control+Z"`. Hurtigtasten vises ikke (skjulte hurtigtaster, prinsipp 14).
  4. **Lukk (×):** ikonknapp 44 × 44 px, gjennomsiktig, ikon 20 px i `night`, `aria-label="Lukk meldingen"`.
- **Smal skjerm (iPad stående, under 480 px bredde):** teksten over, «Angre» og × på egen rad under, «Angre» til venstre. Ingen vannrett rulling.
- **«Mer i papirkurven»:** ghost-knapp (understreket, minst 44 px høy). Vises bare når en ny sletting har erstattet en melding. Trykk åpner papirkurven på siden (`Disclosure` får `open`), ruller dit og flytter fokus til overskriften. På en side uten papirkurv vises den ikke.

### 3.2 Tilstander

| Tilstand | Hva vises | Tid |
|---|---|---|
| Fjernet | Ikon, tekst, «Angre», × | 10 s, så lukkes den |
| Pause | Uendret | Tiden står mens musa er over meldingen eller fokus er i den (`focus-within`), mens fanen er skjult og mens et kall går |
| Henter tilbake | «Angre» blir «Henter tilbake …», `aria-disabled`. Raden kommer ikke tilbake før serveren har svart | står |
| Feil | Under linje 2: `FormMessage`-boks (`urgent-fill`, tekst `urgent-text`, ikon) med `role="alert"`. Knappen heter igjen «Angre» | står til den lukkes eller en ny sletting kommer. Ingen tidsgrense |
| Hentet tilbake | Meldingen bytter til et svar uten «Angre» (ikon: hake, `stone`), se 3.4 | 10 s, med samme pause og × |
| Erstattet | Ny tekst for den nye slettingen, «Mer i papirkurven» vises, tiden starter på nytt | 10 s |

- **Én melding om gangen.** Ny sletting erstatter meldingen, og «Angre» gjelder bare den siste. Meldinger stables ikke.
- **Ingen nedtelling på skjermen** (ingen stolpe eller animasjon). Papirkurven er den varige veien (WCAG 2.2.1).
- Meldingen lukkes når den ansatte går til en annen side (`pathname` endres), men ikke når samme side lastes på nytt.
- **Persondata:** provideren holder bare id, type og visningsnavn i minnet. Ikke i adressen, `localStorage`, `sessionStorage` eller loggeren.

### 3.3 Tekster når noe er fjernet

| Hva | Linje 1 |
|---|---|
| Rom | Rommet «Bad» er fjernet. |
| Tom etasje | Etasjen «2. etasje» er fjernet. |
| Etasje med rom | 2. etasje og 4 rom er fjernet. (1 rom: «2. etasje og 1 rom er fjernet.») |
| Tom bygning | Bygningen «Hovedhus» er fjernet. |
| Bygning med innhold | Hovedhus med 2 etasjer og 9 rom er fjernet. (Tellingen nevner bare det som finnes: «Hovedhus med 1 etasje er fjernet.») |
| Part | Parten «Ola Testmann» er fjernet. |

Linje 2 er alltid «Du finner det også i papirkurven.» Navn i anførselstegn er rommets navn eller romtype, etasjens navn, bygningens navn og partens navn.

### 3.4 Tekster etter «Angre» og «Gjenopprett»

| Utfall | Tekst |
|---|---|
| Vanlig | Rommet «Bad» er hentet tilbake. (Etasjen …, Bygningen …, Parten …) |
| Gruppe | 2. etasje og 4 rom er hentet tilbake. |
| A410, overordnet ledd med | Rommet kom tilbake, sammen med etasjen «1. etasje». / … sammen med etasjen «1. etasje» og bygningen «Hovedhus». |
| A411, ny arealrad finnes | Etasjen kom tilbake med arealet som er ført nå. Det gamle arealet er tatt vare på, men ikke hentet tilbake. |
| A415, kobling borte | Parten kom tilbake, men kontakten den var koblet til, er fjernet. (Firma: «… men firmaet den var koblet til, er fjernet.») |
| Allerede aktiv | Rommet «Bad» er allerede tilbake. |
| Feil (alle typer) | Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven. (etasjen, bygningen, parten) |
| Feil uten nett | Som over, med «Du er uten nett.» foran. |

Avslag fra kjernen gir samme feiltekst. Teksten sier ingenting om hvorfor (kjernen skiller ikke ukjent, annen organisasjon og kansellert, A417).

### 3.5 Tastatur og skjermleser

- Linje 1 og 2 står i et element med `role="status"` (`aria-live="polite"`, `aria-atomic="true"`). Knappene står utenfor, så de ikke leses opp hver gang.
- Fokus flyttes **ikke** til meldingen når den vises (den ansatte skal kunne jobbe videre). Den nås med Tab i vanlig rekkefølge: meldingen ligger sist i DOM-en i `main`.
- **Cmd/Ctrl+Z** utløser «Angre» mens meldingen har «Angre», men ikke når fokus står i `input`, `textarea`, `select` eller `contenteditable`, og ikke mens en modal dialog er åpen. Gjentatt trykk mens kallet går gjør ingenting.
- **Esc** lukker meldingen når fokus er i den.
- Fokusramme i fjord (2 px, med luft) på alle knapper, som ellers.

## 4. Papirkurven (`TrashList` i `Disclosure`)

### 4.1 Plassering

- **Bygningsskjermen:** nederst, under «Sum BRA totalt». Viser bygninger, etasjer og rom.
- **Oppdraget:** rett under partene, før neste kort. Viser parter.
- Tom papirkurv vises ikke. Kansellert oppdrag: ikke vist (A416).
- `id="papirkurv-bygninger"` og `id="papirkurv-parter"`, som «Mer i papirkurven» bruker.

### 4.2 `Disclosure` (ny i `src/shared/ui`)

```
┌───────────────────────────────────────────────────────────┐
│ [søppelkasse] Papirkurv (3)                          [v]  │   <- summary, minst 44 px
├───────────────────────────────────────────────────────────┤
│ (linjene, se 4.3)                                          │
└───────────────────────────────────────────────────────────┘
```

- Bygget på `<details>`/`<summary>`. Det gir tastatur og skjermleser uten egen kode. Kort med tynn kant (`Card`, `p-0`), 12 px hjørner.
- `summary`: minst 44 px, `px-6`, Inter 600 16 px i `night`, ikon 20 px i `stone`, pil til høyre som snus når delen er åpen. Pilen dreies uten overgang ved `prefers-reduced-motion`. Fokusramme i fjord.
- Tallet i parentes er antall linjer (en slettegruppe teller én).
- Lukket som standard. Props: `title`, `open?`, `onOpenChange?`, `id`. Gjenbrukes senere til bilder og avvikskort.

### 4.3 En linje (`TrashItem`)

```
Bad                                                   [ Gjenopprett ]
Hovedhus › 1. etasje
Fjernet av Kari Testesen i dag 14:02
─────────────────────────────────────────────────────────────────────
2. etasje (4 rom)                                     [ Gjenopprett ]
Hovedhus · BRA 64,0 m²
Fjernet av Kari Testesen i går 09:15
Vis rommene (4)                                       <- ghost, åpner underlisten
   Bad              Hovedhus › 2. etasje (fjernet)    [ Gjenopprett ]
   Soverom 1        …                                  [ Gjenopprett ]
─────────────────────────────────────────────────────────────────────
Ola Testmann                                          [ Gjenopprett ]
Kjøper · Testfirma AS
Fjernet av Per Prøvesen 12.11.2026 08:30
```

- `<ul>`, én `<li>` per linje, skillelinje `border-t border-line`, `py-4`, `px-6`. Nyeste først.
- **Linje 1:** rommets navn eller romtype, etasjens navn, bygningens navn eller partens navn. Inter 500 16 px `night`, `break-words`. Gruppe: «2. etasje (4 rom)», «Hovedhus (2 etasjer, 9 rom)».
- **Linje 2 (14 px `stone`):** hvor det lå, `Bygning › Etasje`. Et ledd som også er fjernet, får «(fjernet)» bak. Etasjer: areal fra arealraden, som `SumLine` («BRA 64,0 m²», og P-ROM når kjernen gir det). Parter: rolle og firmanavn, aldri e-post eller telefon.
- **Linje 3 (14 px `stone`):** «Fjernet av {navn} {når}». Når: «i dag 14:02», «i går 09:15», ellers «12.11.2026 08:30», i `<time dateTime="…">`. En ansatt som har sluttet, vises med navn uten tillegg. Ingen e-post.
- **«Gjenopprett»:** `Button variant="secondary" size="md"` (44 px) til høyre, på smal skjerm under teksten. `aria-label` med navnet: «Gjenopprett Bad». Mens kallet går: «Henter tilbake …», `aria-disabled`. Feil: `FormMessage` under linjen med teksten fra 3.4. Lykkes: linjen forsvinner med revalideringen, og svaret vises i angre-meldingen (3.4).
- **Slettegruppe:** «Gjenopprett» på gruppelinjen henter hele gruppen. «Vis rommene (4)» (ghost, minst 44 px, `aria-expanded`) viser rommene som en innrykket underliste (`pl-4`, kant til venstre i `line`) med egen «Gjenopprett» per rom (A410).
- **Uten endringsrett:** ingen «Gjenopprett»-knapp, bare teksten. Ingen deaktivert knapp.
- **Over 200:** under listen står «Viser de 200 nyeste.» i `stone`.
- Ingen tømming og ingen «Slett for godt» (regel 3).

## 5. Etter «Angre» eller «Gjenopprett» (`useRestoredFocus`)

1. Når svaret er kommet og siden er lastet på nytt, finnes elementet som kom tilbake (rom: `li`, etasje: overskriften `h3`, bygning: `h2`, part: overskriften i kortet). Det får `tabIndex={-1}` og fokus med `preventScroll`.
2. Rull til det med `scrollIntoView({ block: "center", behavior })`. `behavior` er `"smooth"`, men `"auto"` ved `prefers-reduced-motion`. Virker også i Safari på iPad.
3. **Utheving:** raden eller kortet får bakgrunn `--color-restored` (sand) i 2 sekunder, og så fjernes den med en overgang på 600 ms. Ved `prefers-reduced-motion` forsvinner den uten overgang. Ingen farge brukes som eneste tegn, for svaret står også i meldingen.
4. Er papirkurven tom etterpå, forsvinner den. Fokus står da på det som kom tilbake.

Elementene finnes med `data-restore-id="{type}:{id}"` på raden.

## 6. Universell utforming og mål

- Trykkflater: «Angre» 56 px, alle andre knapper og `summary` minst 44 px.
- Kontrast: `night` på hvit og sand, `stone` på hvit (over 4,5:1, i `contrast.test.ts`), `urgent-text` på `urgent-fill`. Kanten på meldingen (`line`) er pynt. Grensen mot innholdet gis av skyggen og den hvite flaten, og knappene har egen kontrast.
- Bare tokens fra temaet, så mørk visning (fase 3) virker uten endringer.
- Skjermleser: meldingen med `role="status"`, feil med `role="alert"`, `<details>` med innebygd tilstand, «Gjenopprett» med navnet i `aria-label`.
- e2e (fra oppgavekortet): meldingen dekker ikke hovedknappene (målt med `boundingBox`), knappestørrelser, Cmd/Ctrl+Z, Playwrights klokke for 10 sekunder.

## 7. Avvik fra A

Ingen. A har ingen angre-melding eller papirkurv. Delene følger kortene, pilleknappene, luften og trykkflatene i A og Byggcon-profilen. Det eneste nye laget er meldingen som flyter. Den har skygge som menyene, i tråd med «skygge bare på lag som flyter».
