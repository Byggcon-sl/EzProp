# Skisse: varselet «Mulig dublett» på ordresiden (T3)

- **Oppgavekort:** `docs/funksjoner/fase2a-varsel-dublett.md` (punkt 2, «Skjermen `/ordre/[id]`»)
- **Testplan:** `docs/funksjoner/fase2a-varsel-dublett-testplan.md` avsnitt 5, 6 og 7
- **Dato:** 13.11.2026 (ui-designer, før bygging)
- **Design:** A «Fjord» med Byggcon-profilen (`docs/08-designprinsipper.md`). Ingen avvik fra A.
- **Støtter hovedmål:** de ansatte (kontoret ser med en gang at boligen er bestilt før, og ett trykk åpner den andre ordren; varselet stopper ingenting) og færre reklamasjoner (ikke to oppdrag på samme bolig). KI i bunnen: ingen KI her; komponenten tar bare treffene fra kjernen, så samme komponent kan vises på et ordreforslag fra e-post senere.

## Plassering på `/ordre/[id]`

```
‹ Tilbake til ordre
Storgata 1A, 8006 Bodø                     [Mottatt]      ← h1 og statusmerket (som i dag)

┌ sand ─────────────────────────────────────────────┐
│ ✓ Endringene er lagret.                           │      ← Notice, bare med ?endret=1
└───────────────────────────────────────────────────┘
┌ gul (watch) ──────────────────────────────────────┐
│ ⚠  Mulig dublett                                  │      ← h2
│    Samme adresse eller matrikkel som en annen     │
│    ordre. Sjekk at boligen ikke blir bestilt      │
│    eller tatt to ganger.                          │
│    ─────────────────────────────────────────────  │
│    Storgata 1a, 8006 Bodø                         │      ← lenke, hele raden, min. 44 px
│    mottatt 12.11.2026 – Mottatt – samme adresse   │
│    ─────────────────────────────────────────────  │
│    Storgata 1 A                                   │
│    mottatt 02.09.2026 – Gjort om til oppdrag      │
│    2026-00042 – samme adresse, samme matrikkel    │
│    ─────────────────────────────────────────────  │
│    Viser de 10 nyeste.                            │      ← bare når hasMore
└───────────────────────────────────────────────────┘
┌ kort ─────────────────────────────────────────────┐
│ Gjort om til oppdrag 2026-00041                   │      ← bare når ordren er gjort om
└───────────────────────────────────────────────────┘
┌ kort: Adresse, Mottatt, Hvem bestilte … ──────────┐
[Endre ordren]  [Gjør om til oppdrag]  [Avvis]             ← uendret, ingen ekstra trykk
```

Rekkefølgen er fast: kvitteringen, varselet, «Gjort om til oppdrag», ordrekortet. Varselet har `mb-6` som de andre blokkene over kortet.

## Komponent

**`PossibleDuplicatesNotice`** i `src/app/(ansatt)/ordre/[id]/possible-duplicates-notice.tsx`.

- Props: `{ items: PossibleDuplicateOrder[]; hasMore: boolean }`.
- Server-komponent (ingen tilstand, ingen klientkode). Ingen ny komponent i `src/shared/ui`: varselet brukes bare her nå. Kommer et nytt varsel med overskrift og liste et annet sted, flyttes skallet dit da.
- `items.length === 0` gir `null` (ingenting i HTML, heller ikke når `hasMore` er sann).

### Oppbygging og klasser

```tsx
<div
  role="status"
  aria-labelledby="possible-duplicates-title"
  className="mb-6 rounded-xl bg-watch-fill px-4 py-3 text-watch-text"
>
  <div className="flex items-start gap-3">
    <WarningIcon />                                   {/* 20 px, aria-hidden, focusable="false" */}
    <div className="min-w-0 flex-1">
      <h2 id="possible-duplicates-title" className="text-lg font-semibold">Mulig dublett</h2>
      <p className="mt-1 text-sm">Samme adresse eller matrikkel som en annen ordre. Sjekk at
        boligen ikke blir bestilt eller tatt to ganger.</p>
      <ul className="mt-2 divide-y divide-watch-line/40 border-t border-watch-line/40">
        <li key={item.id}>
          <Link
            href={`/ordre/${item.id}`}
            className="flex min-h-11 flex-col justify-center py-2 underline underline-offset-2 [overflow-wrap:anywhere]"
          >
            <span className="font-medium">{item.addressText}</span>
            <span className="text-sm">{meta}</span>
          </Link>
        </li>
      </ul>
      {hasMore && <p className="mt-2 text-sm">Viser de 10 nyeste.</p>}
    </div>
  </div>
</div>
```

- **Farge:** `bg-watch-fill` og `text-watch-text` (samme par som merket «warning» og andre gule advarsler; paret står alt i `contrast.test.ts`, kontrast over 4,5:1). Ingen ny farge, ingen fargeovergang, ingen kant (som `Notice` og de gule boksene på bygningssiden).
- **Lenkene** har samme tekstfarge som resten av varselet og skilles med understreking (ikke bare farge). Fokus er den felles fjord-rammen fra `globals.css` (`:focus-visible`), minst 3:1 mot den gule bakgrunnen. Ingen egen fokusstil.
- **Ikon:** varseltrekant med utropstegn, strek `currentColor`, `strokeWidth` 2, 20 × 20, `aria-hidden="true"`, `focusable="false"`, `mt-0.5 shrink-0`. Samme tegnemåte som haken i `Notice`. Ingen andre `svg` i varselet.
- **h2** får Schibsted Grotesk fra basen (`h1, h2` i `globals.css`); ikke sett font selv. Bare én `h2` i varselet.

### Treff-linjen

Hele treffet er én lenke (stort trykkområde, ett trykk åpner den andre ordren). To linjer i lenken:

1. **Adressen** (`addressText`, slik den er skrevet på den andre ordren), `font-medium`.
2. **Metalinjen** (`text-sm`), delene skilt med « – »:
   - `mottatt dd.mm.åååå` med `formatOsloDate` fra `../received-at` (Oslo-tid; 23:30Z 11.11 blir 12.11).
   - statusordet med `orderStatusLabel(status)` (de samme ordene som `OrderStatusBadge`). Er ordren gjort om og `assignmentNumber` finnes: `Gjort om til oppdrag 2026-00042` (nummeret i `tabular-nums`).
   - grunnene med `duplicateReasonLabel` i fast rekkefølge fra `DUPLICATE_REASONS`, skilt med komma: `samme adresse`, `samme matrikkel` eller `samme adresse, samme matrikkel`.

Eksempler (metalinjen):

| Treff | Metalinjen |
|---|---|
| mottatt, samme adresse | `mottatt 12.11.2026 – Mottatt – samme adresse` |
| gjort om, samme matrikkel | `mottatt 02.09.2026 – Gjort om til oppdrag 2026-00042 – samme matrikkel` |
| begge grunner | `mottatt 12.11.2026 – Mottatt – samme adresse, samme matrikkel` |

«mottatt» (dato) og «Mottatt» (status) står begge, fordi testene krever begge og fordi statusordet skal være det samme som på merket. Med datoen først og liten forbokstav leses det som to ulike ting.

### Lange adresser og iPad

- `[overflow-wrap:anywhere]` på lenken og `min-w-0` på tekstkolonnen, slik at en lang adresse uten mellomrom brytes i stedet for å gi vannrett rulling (testplan 7.13; samme mønster som `order-history.tsx`).
- Lenkene er minst 44 px høye (`min-h-11` og `py-2`), også med én kort linje (7.14).
- Ingen egen stil for liggende iPad: varselet følger bredden til `main` (`max-w-2xl`).

### Tekster (ordrett, testene sjekker dem)

| Sted | Tekst |
|---|---|
| Overskrift (`h2`) | Mulig dublett |
| Forklaring | Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger. |
| Grunn `address` | samme adresse |
| Grunn `cadastre` | samme matrikkel |
| Flere enn 10 | Viser de 10 nyeste. |

Grunnene står i `src/core/orders/codes.ts` (`duplicateReasonLabel`, eksportert fra `@/core/orders`), ikke i komponenten, slik at e-post-til-ordre kan bruke de samme ordene.

## Tilstander

| Tilstand | Visning |
|---|---|
| Ingen treff | Ingenting. |
| 1–10 treff | Varselet med én lenke per treff, nyeste først (rekkefølgen fra kjernen). |
| Flere enn 10 (`hasMore`) | 10 lenker og «Viser de 10 nyeste.» under listen. |
| Ordren selv er avvist | Ingenting (kjernen gir tom liste). |
| Oppslaget feiler | Ingenting. Siden vises som vanlig med kvittering og knapper; feilen logges uten verdier (fast melding, ingen feiltekst, adresse eller matrikkel). |
| Etter «Lagre» (ny ordre eller «Endre ordren») | Samme som over; ingen egen logikk for `?endret=1`. |
| «Endre ordren» er åpen | Varselet står der fortsatt (det ligger over skjemaet og lukkes ikke). |

## Universell utforming

- `role="status"` med `aria-labelledby` til `h2`: skjermleseren sier fra når varselet kommer etter «Lagre», og overskriften gir navnet.
- Mening i tekst og ikon, ikke bare i gul farge. Ikonet er pynt (`aria-hidden`).
- Lenketekstene er unike nok (adresse og dato), så de gir mening alene i lenkelisten til skjermleseren.
- Tastatur: lenkene nås med Tab i vanlig rekkefølge og åpnes med Enter; synlig fokus fra den felles fjord-rammen.
- Mørk visning: bare tokener (`watch-*`), ingen faste fargeverdier, så varselet følger mørk visning når den kommer.

## Ikke med

- Knapp for «Ikke dublett» eller lukk-kryss (A288).
- Varsel i ordrelisten, arbeidskøen eller på oppdragssiden.
- Oppdragsstatus i linjen (bare oppdragsnummeret; den andre ordren er ett trykk unna).
- Ny komponent i `src/shared/ui` eller ny farge i `globals.css`.
