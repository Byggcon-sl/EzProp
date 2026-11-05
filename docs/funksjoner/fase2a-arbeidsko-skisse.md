# Skisse: Oppdragslisten som arbeidskø (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-arbeidsko.md` (fasit for regler, data og tester)
- **Design:** A «Fjord». Mønstrene er «Mine oppdrag» i `docs/design/bilder/A-dashbord.png` (rad med adresse, nummer, merke og frist), `.pill`-merkene og `.seg`-velgeren i `docs/design/retning-A.html`.
- **Dato:** 05.11.2026
- **Støtter hovedmål:** tid (startsiden viser det som venter, ett trykk til oppdraget, søk i ett felt), reklamasjoner («Forfalt» og «Befaring ikke avtalt» synes på kortet, så ingenting blir liggende). KI først: ikke i denne oppgaven; kortet har plass til et KI-merke senere (se 9).

## 1. Komponenter

Gjenbruk: `Card`, `Badge`, `Button`/`buttonVariants`, `Field`, `Input`, `Textarea`, `FormMessage`, `Notice` fra `src/shared/ui`. Ikoner er små inline-SVG med `aria-hidden="true"`. Ingen ny avhengighet.

Én endring i `src/shared/ui`:

| Endring | Hvorfor |
|---|---|
| `Badge` får tonen `danger`: `bg-red-50 text-red-800` (ca. 7,8:1) | «Forfalt» må skille seg fra «Rettet» (amber). Tilsvarer `.p-u` i skissen A. |

Nye filer, bare i siden (ingen klientkomponent, alt er serverkomponenter og vanlige skjemaer):

| Fil | Innhold |
|---|---|
| `src/app/(ansatt)/arbeidskoe/page.tsx` | Siden (finnes, bygges om) |
| `src/app/(ansatt)/arbeidskoe/queue-toolbar.tsx` | Fanene, Mine/Alle og søket |
| `src/app/(ansatt)/arbeidskoe/queue-card.tsx` | Ett oppdragskort med merker og notat |
| `src/app/(ansatt)/oppdrag/[id]/schedule-card.tsx` | Kortet «Befaring og frist» på oppdragssiden |

Lenkene i fanene og Mine/Alle lages av én liten ren funksjon `queueHref({ status, mine, q })` i sidemappen, slik at de tre verdiene alltid følger med. Den testes sammen med tolkingen av adressen.

## 2. Oppsett, PC og iPad (bredde 768 px og mer)

Siden beholder `max-w-3xl`. Avstand mellom blokkene `mt-6`, mellom kortene `space-y-3`.

```
┌────────────────────────────────────────────────────────────────────┐
│ [Notice: Oppdrag 26-1042 er kansellert.]     (bare med ?kansellert=)│
│                                                                    │
│ Arbeidskø                                                  (h1)    │
│ Hei, Ingrid.                                                       │
│                                                                    │
│ ┌ Bestilt  3 ┐┌ Under arbeid 12 ┐┌ Ferdig  4 ┐┌ Fakturert 40 ┐      │  fanene
│ └────────────┘└═════════════════┘└───────────┘└──────────────┘      │  (valgt: hvit, skygge)
│                                                                    │
│ ( Mine | Alle )   [🔍 Søk på adresse eller oppdragsnummer ] [Søk]  │  verktøylinje
│                   Tøm søk                         (bare med ?q=)   │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Fjellveien 12, 8015 Bodø                                (lenke) │ │
│ │ 26-1042                                                         │ │
│ │ [Under arbeid] [Befaring 6. nov. kl. 09:00] [Frist 10. nov.]    │ │
│ │ [👤 Ingrid Solberg]                                             │ │
│ │ ─────────────────────────────────────────────────────────────── │ │
│ │ Venter på nøkkel fra megler.                                    │ │
│ │ ✎ Notat                                                         │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Mørkvedlia 41, 8022 Bodø                                        │ │
│ │ 26-1031                                                         │ │
│ │ [Under arbeid] [Befaring ikke avtalt] [Frist 2. nov.] [Forfalt] │ │
│ │ [👤 Ingen ansvarlig]                                            │ │
│ │ ─────────────────────────────────────────────────────────────── │ │
│ │ ✎ Notat                                                         │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ Viser 50 av 73. Bruk søket for å finne flere.   (bare når N > 50)  │
└────────────────────────────────────────────────────────────────────┘
```

Smalere enn 640 px (ikke målet, men skal ikke knekke): fanene brytes til to rader (`flex-wrap`), Mine/Alle står over søket, og merkene brytes.

## 3. Mål og klasser

| Del | Mål (Tailwind, tokens fra `globals.css`) |
|---|---|
| Fanene | `<nav aria-label="Status">` med `<ul class="flex flex-wrap gap-1 rounded-xl bg-white/60 p-1 ring-1 ring-slate-200/60">`. Hver fane er en `<a>` (Next `Link`): `inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-base text-slate-700 hover:bg-white`. Valgt: `bg-white font-medium text-slate-900 shadow-card` og `aria-current="page"` |
| Antallet i fanen | `rounded-full bg-slate-100 px-2 text-sm tabular-nums text-slate-700`; i valgt fane `bg-brand-50 text-brand-700` |
| Mine/Alle | Samme mønster som fanene (`.seg`), to lenker, `<nav aria-label="Filter">`, `min-h-11`, valgt med `aria-current="page"` |
| Søket | `<form method="get" action="/arbeidskoe" role="search">`. `Input type="search" name="q"` med `pl-10` og lupe-ikon, `maxLength={100}`. Skjulte felt `status` og `mine` med gjeldende verdier. `Button variant="secondary"` «Søk». Etiketten er `sr-only` |
| Verktøylinjen | `mt-4 flex flex-wrap items-center gap-3`; søket `flex-1 min-w-64` |
| Kortet | `<li id="kort-{assignmentId}">` med `Card className="p-5"` |
| Adressen | `Link` til `/oppdrag/[id]`, `text-lg font-medium text-slate-900 hover:text-brand-700 hover:underline`. Hele adressen er lenketeksten; ingen «Åpne»-knapp (én hovedhandling) |
| Oppdragsnummer | `mt-0.5 text-sm text-slate-600 tabular-nums` |
| Merkene | `mt-3 flex flex-wrap gap-2`, `Badge` (24 px høye, som `.pill`) |
| Skillelinje og notat | `mt-4 border-t border-slate-200 pt-3` |
| Notatteksten | `text-base text-slate-800 break-words`, foran står `<span class="sr-only">Notat: </span>` |
| `<summary>` «Notat» | `buttonVariants({ variant: "ghost" })`, `min-h-11 -ml-3 w-fit cursor-pointer list-none`, blyant-ikon. Fokusring fra `globals.css` |
| Notatskjemaet | `mt-2 space-y-3`. `Textarea rows={2} maxLength={200} className="min-h-20"`. Knapper `flex gap-3`: «Lagre» (`primary`, `md`), «Avbryt» (`secondary`, `md`) |
| «Viser 50 av N» | `mt-4 text-sm text-slate-600` |

Trykkflater: alle lenker, faner, `<summary>` og knapper er minst 44 px høye (prinsipp 6). Hovedhandlingen (åpne oppdraget) er adresselenken; den er 28 px høy tekst, men hele første linje i kortet (`block py-1`) er trykkflaten.

## 4. Merkene på kortet

Fast rekkefølge, venstre til høyre. Teksten bærer alltid betydningen; fargen er bare tillegg (prinsipp 11, 15).

| Merke | Tekst | Tone | Når |
|---|---|---|---|
| Status | «Bestilt» / «Under arbeid» / «Ferdig» / «Fakturert» (`codes.ts`) | `brand` (som på oppdragssiden) | alltid |
| Rettet | «Rettet» | `warning` | når `isCorrected` gir sant |
| Befaring | «Befaring 6. nov. kl. 09:00» | `neutral` | `inspection_at` finnes |
| Befaring mangler | «Befaring ikke avtalt» | `neutral` | `inspection_at` er tomt |
| Frist | «Frist 10. nov.» | `neutral` | `due_date` finnes |
| Frist mangler | «Ingen frist» | `neutral` | `due_date` er tomt |
| Forfalt | «Forfalt» | `danger` | `isOverdue` gir sant |
| Takstmann | person-ikon + «Ingrid Solberg», foran står `sr-only` «Ansvarlig takstmann: » | `neutral` | ansvarlig finnes |
| Ingen takstmann | person-ikon + «Ingen ansvarlig» | `neutral` | ingen ansvarlig |

Datoer: norsk kortform i Europe/Oslo, `Intl.DateTimeFormat("nb-NO")`: «6. nov.», med årstall når datoen ikke er i inneværende år («6. nov. 2027»). Klokkeslett «kl. 09:00». Statusmerket vises også i fanen der alle har samme status: det holder kortet likt overalt og forbereder et samlet søk senere.

## 5. Tilstander

| Tilstand | Visning |
|---|---|
| Ikke registrert som ansatt | Kortet «Du er ikke registrert som ansatt» som i dag; ingen faner |
| Tom fane | Ett `Card`: «Ingen oppdrag med status Under arbeid.» I fanen Bestilt i tillegg lenken «Ny ordre» (`buttonVariants({ variant: "primary" })`, til `/ordre/ny`) |
| Tom fane med søk | Samme tekst, og lenken «Tøm søk» under |
| Flere enn 50 | 50 kort og «Viser 50 av 73. Bruk søket for å finne flere.» |
| Notat tomt | Ingen notattekst, bare «Notat» |
| Notat lagret | Siden lastes på nytt til `…#kort-{id}`; `<details>` er lukket og notatet står i kortet |
| Notat avvist | `<details open>` på kortet, feilen under feltet via `Field error`, feltet viser det lagrede notatet (se under) |
| Uten `assignment.edit` | Notatteksten vises, men ikke `<summary>` og skjemaet (siden bruker `canEdit` fra tilgangssjekken; selve sjekken skjer i kjernen) |

Feiltekster (fra eksisterende skjema der de finnes):
- Over 200 tegn: «Notatet kan ha høyst 200 tegn.» (`maxLength` stopper det også i nettleseren)
- Fødselsnummer: «Fødselsnummer skal ikke lagres her.» (samme tekst som `schemas.ts`)
- Ikke funnet / kansellert: «Fant ikke oppdraget. Det kan være kansellert.» som `FormMessage` øverst på siden
- Ingen tilgang: «Du har ikke tilgang til å endre notatet.» som `FormMessage`

Feilen må tilbake til siden uten klientkomponent. Forslag til utvikler: server action redirecter til `/arbeidskoe?…&notatfeil={id}&feil={kode}#kort-{id}`, der `feil` er en fast kode (`for_langt`, `fnr`, `ikke_funnet`, `ingen_tilgang`) og teksten slås opp i siden. Det avviste notatet sendes ikke tilbake i adressen; feltet viser det lagrede notatet, og brukeren skriver på nytt. Dette er enklere og holder et mulig fødselsnummer ute av adressen og loggene.

«Avbryt» er en vanlig `<a>` (ikke `Link`) til gjeldende kø-adresse uten `#`. Den laster siden på nytt, så `<details>` lukkes og teksten forkastes, også uten JavaScript. Notatet står urørt.

## 6. Kortet «Befaring og frist» på oppdragssiden

Plasseres rett under kortet «Status».

```
┌────────────────────────────────────────────────────┐
│ Befaring og frist                            (h2)  │
│                                                    │
│ Avtalt befaring           Frist for levering       │
│ [ 06.11.2026 09:00 ]      [ 10.11.2026 ]           │
│ La feltet stå tomt hvis befaringen ikke er avtalt. │
│                                                    │
│ [ Lagre ]                                          │
└────────────────────────────────────────────────────┘
```

- `Field` + `Input type="datetime-local" name="inspectionAt"` og `Input type="date" name="dueDate"`. To kolonner fra `md` (`grid md:grid-cols-2 gap-5`), ellers under hverandre.
- Hjelpetekst under feltene: «La feltet stå tomt hvis befaringen ikke er avtalt eller fristen ikke er satt.»
- «Lagre» (`primary`, `md`). Etter lagring vises `Notice` «Befaring og frist er lagret.» øverst i kortet.
- Uten `assignment.edit`: verdiene vises som tekst (samme format som merkene), ingen felt.
- Klokkeslettet tolkes i Europe/Oslo.

## 7. Universell utforming

- Fanene og Mine/Alle er lenker i `<nav>` med `aria-current="page"` på valgt; ikke `role="tablist"`, fordi de bytter adresse (tilbake-knappen virker).
- Tilgjengelig navn på fanen: synlig tekst «Under arbeid» og antallet med `sr-only` «oppdrag» etter, slik at skjermleser leser «Under arbeid 12 oppdrag».
- Listen er `<ul aria-label="Oppdrag med status Under arbeid">`. Hvert kort er `<li>` med adressen som første element.
- Søket har `role="search"` og etiketten «Søk på adresse eller oppdragsnummer» (`sr-only`), samme tekst som `placeholder`.
- `<summary>` har synlig tekst «Notat» og `aria-describedby` til notatteksten når den finnes. `Textarea` har synlig etikett «Notat» og hjelpeteksten «Internt, høyst 200 tegn. Kommer aldri i rapporten.»
- Etter redirect til `#kort-{id}` får kortet `tabIndex={-1}`, slik at fokus og skjermleser lander på riktig kort.
- Kontrast: alle merker er minst 4,5:1 (`slate-700`/`slate-100` ca. 9:1, `brand-700`/`brand-50` ca. 6,5:1, `amber-900`/`amber-50` ca. 9:1, `red-800`/`red-50` ca. 7,8:1). Grå hjelpetekst er `slate-600` (ca. 7:1 på hvitt).

## 8. Testkroker

Testene finner det meste med rolle og navn. Bare disse får `data-testid`:

| Del | `data-testid` |
|---|---|
| Kortet | `work-queue-card` |
| Antallet i en fane | `work-queue-count-{status}` (for eksempel `work-queue-count-in_progress`) |
| «Viser 50 av N» | `work-queue-limit` |
| Tomtilstanden | `work-queue-empty` |

Fane: `getByRole("link", { name: /Under arbeid/ })`, valgt med `aria-current`. Notat: `getByText("Notat")` (summary), `getByRole("button", { name: "Lagre" })` innenfor kortet.

## 9. Mørk visning og senere

- Mørk visning er ikke bygget. Komponentene bruker bare farger fra temaet og `Badge`-tonene, så en mørk variant kan legges på uten å endre oppsettet.
- KI-merke (for eksempel «Utkast klart») skal senere stå sist i merkeraden med tonen `brand` og teksten «KI:» foran. Ikke med nå.

## 10. Bevisst utelatt

Kalender, lederdashbord, flere hurtigfiltre, radmeny, bytte status fra køen, «vis flere», tallkortene øverst i dashbordskissen og «Felles kø». Se oppgavekortet.

## 11. Antall trykk

Før: `/ordre` → ordre → oppdrag, 3 trykk og leting. Etter: startsiden → kort, 1 trykk. Med søk: skriv, Enter, 1 trykk. Notat: 1 trykk for å åpne, skriv, 1 trykk for å lagre. Anslaget bekreftes av ux-ansvarlig.
