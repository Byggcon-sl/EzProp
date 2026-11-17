# Design: «Tilbud i stedet for ordre» (komponentspesifikasjon)

- **Oppgavekort:** `docs/funksjoner/fase2a-tilbud.md` (Omfang 3–8, 11, 11b og 12, og tilleggene F1–F5)
- **Testplan:** `docs/funksjoner/fase2a-tilbud-testplan.md` (avsnitt 4, 5 og 7)
- **Grunnlag:** `docs/08-designprinsipper.md` (Byggcon-profilen), `docs/design/bilder/A-dashbord.png` (overskrift med hovedknapp til høyre, faner med tall), `docs/design/bilder/A-oppdrag.png` og `A-ipad-*.png` (luft og trykkflater), og mønstrene fra `docs/funksjoner/fase2a-nytt-oppdrag-design.md`
- **Dato:** 16.11.2026
- **Støtter hovedmål:**
  - **De ansatte:** menyen viser først det kontoret gjør hver dag. På tilbudet står «Gjør om til oppdrag» øverst, med kontoret valgt, så det er ett trykk uten rulling på iPad. Listen viser hva som går ut snart.
  - **KI i bunnen:** skjermene viser bare data og status fra kjernen. Tilbud som KI senere lager fra e-post (`source = email`), vises i den samme listen og på den samme siden uten nye komponenter. Ingen KI her, og derfor heller ikke noe KI-merke.
  - **Færre reklamasjoner:** alt fylles inn fra tilbudet. Dublettvarselet står ved hovedknappen, slik at boligen ikke blir tatt to ganger.

Ingen ny komponent i `src/shared/ui`. To små utvidelser der: `Badge` får `gap-1` (ikon og tekst), og `Notice` får en valgfri lenke (avsnitt 6). Resten bygges av `Card`, `Button`, `buttonVariants`, `Field`, `Input`, `Textarea`, `Radio`, `ChoiceGroup`, `FormMessage`, `Notice` og `Badge`, og av delene i `(ansatt)`: `SubmitButton`, `FormErrors`, `OrderFields`, `SearchBox`, `NavLink`, `Detail`, `BookingDuplicatesNotice`, `PossibleDuplicatesFrame` og `booking-history`.

## 1. Hva som lages

| Del | Fil (forslag) | Ny eller endret |
|---|---|---|
| Menypunktet | `(ansatt)/layout.tsx` | endret (flyttet og nytt navn) |
| Videresending `/ordre*` | `next.config.ts` (`redirects()`, 308) | endret |
| Tilbudslisten | `tilbud/page.tsx`, `tilbud/offer-filter-nav.tsx`, `tilbud/offer-list-row.tsx` | flyttet fra `ordre/` og utvidet |
| Felles stil for faner | `(ansatt)/segments.ts` (de tre klassekonstantene fra `arbeidskoe/queue-toolbar.tsx`) | ny, køen importerer derfra |
| Statusmerkene | `tilbud/offer-status-badge.tsx` (erstatter `order-status-badge.tsx`), `tilbud/offer-expiry-badge.tsx` | endret og ny |
| Nytt tilbud | `tilbud/ny/page.tsx`, `tilbud/ny/offer-form.tsx` | flyttet, felt «Gyldig til» |
| Tilbudssiden | `tilbud/[id]/page.tsx`, `tilbud/[id]/offer-actions.tsx` (gjør om, forleng, avslå), `tilbud/[id]/offer-edit-form.tsx` | flyttet og skrevet om |
| Fokus på `#gjor-om` | `tilbud/[id]/focus-convert.tsx` (liten klientdel) | ny |
| «Lagre som tilbud i stedet» | `oppdrag/ny/assignment-form.tsx` | endret |
| «Gjør om tilbudet» i dublettvarselet | `(ansatt)/possible-duplicates-notice.tsx` | endret |
| Kvittering og «Laget fra tilbud» på oppdraget | `oppdrag/[id]/page.tsx` | endret |
| Felles verdier | `ordre/order-values.ts` → `(ansatt)/order-values.ts` | flyttet (11b) |

Mappen `ordre/` finnes ikke etterpå.

## 2. Menyen

```
Hovedmeny
  + Nytt oppdrag
  ⌂ Arbeidskø
  ☺ Kontakter
  ▦ Firma
  ✉ Tilbud          <- før: punkt 3 «Ordre». Nå: rett over Statistikk
  ▤ Statistikk
```

- `NavLink href="/tilbud" matchChildren` med `InboxIcon` (samme ikon som før) og teksten «Tilbud». Aktivt på `/tilbud`, `/tilbud/ny` og `/tilbud/<id>` (`aria-current="page"`).
- Samme vilkår som før (`organizations.length > 0`).
- «Nytt tilbud» står **ikke** i menyen. Det er en knapp på listen.

## 3. Tilbudslisten `/tilbud`

`<main className="max-w-4xl">`, som ordrelisten i dag. Tittel i fanen: «Tilbud».

```
Tilbud                                              [ Nytt tilbud ]   <- secondary, md (44 px)
Mulige jobber som ikke er oppdrag ennå.                                  (stone, text-sm)

┌──────────────────────────────────────────────────────────────────────┐
│ [Åpne 3] [Utløpt 2] [Avslått 1] [Gjort om til oppdrag 4] [Alle 10]   │  <- nav «Status»
└──────────────────────────────────────────────────────────────────────┘
Søk på adresse, nummer, megler eller gnr/bnr  [______________] [ Søk ]
Tøm søk                                                    (bare med søk)

[ ✓ Storgata 1A, 8006 Bodø er gyldig til 16.12.2026. ]     (bare etter «Forleng»)

┌──────────────────────────────────────────────────────────────────────┐
│ Storgata 1A, 8006 Bodø                     [⏱ Går ut om 3 dager]     │
│ Mottatt 02.11.2026 · Line Mørch · Gyldig til 19.11.2026  [Forleng 30 dager]
├──────────────────────────────────────────────────────────────────────┤
│ Fjellveien 8, 8010 Bodø                            [Åpent]           │
│ Mottatt 10.11.2026 · Gyldig til 10.12.2026                           │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Overskrift og hovedhandling

- `h1` «Tilbud» (Schibsted Grotesk) og under den en kort linje i stone: «Mulige jobber som ikke er oppdrag ennå.» Linjen forklarer begrepet for dem som kjente «Ordre».
- «Nytt tilbud» er lenke til `/tilbud/ny` med `buttonVariants({ variant: "secondary", size: "md" })`. **Sekundær, ikke hovedknapp:** tilbud er sjeldent arbeid (Ståle 13.11.2026), og hovedvalget i løsningen er «Nytt oppdrag». Vises bare med `canEditOrders`.
- Raden er `flex flex-wrap items-start justify-between gap-3`, som i arbeidskøen.

### 3.2 Filterknappene (`OfferFilterNav`)

Samme uttrykk som fanene i arbeidskøen (A-dashbord), ikke nedtrekksliste.

- `<nav aria-label="Status">` med `<ul>` og én `Link` per filter, i rekkefølgen **Åpne, Utløpt, Avslått, Gjort om til oppdrag, Alle**. Kodene er `OfferListFilter` (`open`, `expired`, `rejected`, `converted`, `all`).
- Klassene `segmentList`, `segmentLink` og `segmentCurrent` flyttes fra `queue-toolbar.tsx` til `(ansatt)/segments.ts`, og både køen og tilbudslisten importerer dem (ett sted for utseendet). Knappene er minst 44 px (`min-h-11`).
- Valgt filter har `aria-current="page"`. Lenken er `/tilbud?status=<kode>` og tar med `q` når det er et søk. `open` er standard og skrives ikke i adressen (`/tilbud`), slik at menylenken og «Åpne» er samme side.
- Tallet står i en pille etter etiketten, som i køen. Skjermleseren skal lese «Åpne, 3 tilbud»:
  ```
  Åpne<span class="sr-only">,</span> <span class="pill">3</span><span class="sr-only"> tilbud</span>
  ```
- Feiler tellingen eller listen, vises knappene uten tall (ingen «0» som ikke stemmer).
- På iPad stående brytes raden til to linjer. Ingen vannrett rulling.

### 3.3 Søket

`SearchBox` som i dag, med samme etikett. Den får en valgfri prop `hidden?: Record<string, string>` som blir skjulte felt i GET-skjemaet, slik at `status` følger med når man søker. Er filteret `open`, sendes ikke `status`. «Tøm søk» beholder filteret.

### 3.4 En rad i listen (`OfferListRow`)

Hver rad er en `<li>` med to deler ved siden av hverandre, **ikke** en knapp inne i en lenke:

1. **Lenken** (`flex-1`, `min-h-14`, `px-5 py-3`, hover `bg-brand-50`) til `/tilbud/<id>`:
   - Linje 1: adressen (`font-medium`, brytes med `[overflow-wrap:anywhere]`).
   - Linje 2 (`text-sm text-slate-600`): «Mottatt 02.11.2026» · bestiller · «Meglerens ordrenr. 55-1234» · **«Gyldig til 19.11.2026»** for åpne og utløpte tilbud.
   - Til høyre: oppdragsnummer (gjort om), deretter merkene (3.5). Gjort om og oppdraget er kansellert: «2026-0042 (kansellert)» (T-0031).
2. **«Forleng 30 dager»** (F1), bare for utløpte tilbud og åpne tilbud med 0–7 dager igjen, og bare med `canEditOrders`: `Button variant="secondary" size="md"` i et eget lite skjema, til høyre for lenken på PC og under lenken på iPad stående (`flex-wrap`, knappen får `ml-5 mb-3` når den bryter).

Sortering: «Åpne» etter «Gyldig til» (de som går ut først, øverst), de andre filtrene nyeste først (F3).

### 3.5 Merkene

Merkene er `Badge` (flate, ingen kant, 24 px høye, så de ikke ligner knapper). Teksten bærer meningen; fargen er bare hjelp.

| Visningsstatus | Tekst | Tone | Merknad |
|---|---|---|---|
| `open` | «Åpent» | `brand` | |
| `expired` | «Utløpt 14.11.2026» | `neutral` | datoen er `validUntil` |
| `rejected` | «Avslått» | `neutral` | var `warning` som «Avvist»; gult er nå forbeholdt «går ut snart» |
| `converted` | «Gjort om til oppdrag» | `neutral` | |

**«Går ut»-merket (`OfferExpiryBadge`, F3):** bare på åpne tilbud med 0–7 dager igjen (`offerDaysLeft`). Tone `warning` (watch: «følg med»), klokkeikon 14 px (`aria-hidden`, strek 2) foran teksten:

| Dager igjen | Tekst |
|---|---|
| 0 | «Går ut i dag» |
| 1 | «Går ut i morgen» |
| 2–7 | «Går ut om N dager» |
| 8 eller mer | ikke noe merke |

Står da i stedet for «Åpent» (to merker på én rad blir uroa; «Går ut …» sier at tilbudet er åpent). `Badge` får `gap-1` i grunnklassen så ikon og tekst får luft; ingen andre endringer i `Badge`.

### 3.6 Tom liste og feil

| Filter | Uten søk | Med søk |
|---|---|---|
| Åpne | «Ingen åpne tilbud.» | «Ingen tilbud passer søket.» |
| Utløpt | «Ingen utløpte tilbud.» | samme |
| Avslått | «Ingen avslåtte tilbud.» | samme |
| Gjort om til oppdrag | «Ingen tilbud er gjort om til oppdrag.» | samme |
| Alle | «Ingen tilbud er lagt inn ennå.» | samme |

Teksten står i et `Card`. Feil fra `loadListOrError` vises som i dag med `FormMessage`. Linjen «Viser 50 av 73. Bruk søket for å finne flere.» står over listen som i dag.

### 3.7 Kvittering etter «Forleng 30 dager» i listen

Raden kan forsvinne fra filteret «Utløpt» når datoen er ny. Kvitteringen kan derfor ikke stå i raden.

- Listen pakkes i en liten klientdel (`OfferListNotice`) med ett `role="status"`-område over listen, som alltid finnes (tomt til det brukes).
- Etter lagring står: «Storgata 1A, 8006 Bodø er gyldig til 16.12.2026.» (`Notice`). Adressen er med fordi listen har mange tilbud; den står bare på siden, aldri i adressen.
- Fokus flyttes til kvitteringen (`tabIndex=-1`), siden knappen som hadde fokus, kan være borte.
- Ingen `?lagret=1` i adressen (T-0089). Andre trykk på samme rad (samme `row_version`) gir ingen feilmelding.
- Uten nett: «Du er uten nett. Endringen er ikke lagret.» som `FormMessage` på samme sted.

## 4. Nytt tilbud `/tilbud/ny`

Som ordreskjemaet i dag (`OrderFields layout="order"`), med nye ord og ett nytt felt.

```
‹ Tilbud
Nytt tilbud                                           (h1)

┌────────────────────────────────────────────┐
│ (feltene som i dag: adresse, mottatt,       │
│  bestiller, meglerens ordrenummer, matrikkel,│
│  borettslag, egenerklæring)                 │
│                                            │
│ Gyldig til                                 │
│ [16.12.2026]                               │
│ 30 dager fra i dag er foreslått. Høyst ett år fram.
└────────────────────────────────────────────┘
[    Lagre    ]   Avbryt
```

- «‹ Tilbud» øverst (lenke, `min-h-11`).
- **Gyldig til:** `Field label="Gyldig til" htmlFor="validUntil"` med `Input type="date" name="validUntil"`, `defaultValue` i dag + `OFFER_VALID_DAYS`, `min` i dag og `max` i dag + `OFFER_VALID_UNTIL_MAX_DAYS` (bare hjelp i nettleseren; kjernen avgjør). Hint: «30 dager fra i dag er foreslått. Høyst ett år fram.» Datovelgeren på iPad er den innebygde, ikke en nedtrekksliste.
- Feltet står sist, etter de andre feltene, fordi det sjelden endres.
- «Ekstern referanse» heter «Meglerens ordrenummer» her også, så tilbud og oppdrag bruker samme ord.
- «Lagre» er `SubmitButton` (`primary`, `lg`), «Avbryt» er `ghost`-lenke til `/tilbud`.
- Etter lagring: `/tilbud/<id>` med kvitteringen «Tilbudet er laget. Gyldig til 16.12.2026.»
- Feil: som i dag ved feltene. «Gyldig til kan ikke være før i dag.» og «Gyldig til kan være høyst ett år fram.» står under datofeltet. Uten nett: «Du er uten nett. Endringen er ikke lagret.» over «Lagre» (A360), og det som er skrevet, står igjen.

## 5. Tilbudssiden `/tilbud/[id]`

`<main className="max-w-2xl">`. Tittel i fanen: «Tilbud».

### 5.1 Åpent eller utløpt tilbud

```
‹ Tilbud
Storgata 1A, 8006 Bodø                 [⏱ Går ut om 3 dager]      (h1 + merke)
Gyldig til 19.11.2026                                             (stone)

[ ✓ Tilbudet er laget. Gyldig til 19.11.2026. ]                   (bare som kvittering)

┌ id="gjor-om" ───────────────────────────────────────────────┐
│ ! Mulig dublett. Se varselet under før du gjør om.           │  (bare ved treff)
│ [        Gjør om til oppdrag        ]                         │  <- primary, lg, 56 px
│ Alt fra tilbudet fylles inn. Oppdraget får nummer nå.         │  (stone, text-sm)
│ Kontor: Bodø   Velg et annet kontor ▸                         │
│                                                              │
│ [ Forleng 30 dager ]   [ Avslå tilbud ]                       │  <- secondary, md, 44 px
└──────────────────────────────────────────────────────────────┘

┌ Avslå tilbudet ──────────────┐   (bare når «Avslå tilbud» er trykket, se 5.4)

[ Mulig dublett … ]                (BookingDuplicatesNotice, som i dag)

┌ Tilbudet ──────────────────────────────────┐
│ Adresse               Storgata 1A, 8006 Bodø│
│ Matrikkel             Gnr. 12, bnr. 34      │
│ Hvem bestilte         Line Mørch            │
│                       Kontakt i registeret ›│
│ Meglerens ordrenummer 55-1234               │
│ Borettslag eller sameie  Ikke oppgitt       │
│ Mottatt               02.11.2026 kl. 09.12  │
│ Gyldig til            19.11.2026            │
│ Egenerklæring mottatt Nei                   │
│ [ Endre tilbudet ]                          │
└────────────────────────────────────────────┘
Endringer                                     (åpen seksjon, som i dag)
```

**Rekkefølgen er låst** (testplan 4.2.1): tittel og merke, «Gyldig til»-linjen, kvittering, handlingsblokken, avslag, dublettvarsel, detaljkort, endringer.

- **Tittel:** `h1` er adressen (`[overflow-wrap:anywhere]`), merket ved siden av (3.5): «Åpent», «Går ut …» eller «Utløpt 14.11.2026».
- **«Gyldig til»-linjen** under tittelen: «Gyldig til 19.11.2026» i stone. For utløpt tilbud står datoen allerede i merket, og linjen sløyfes.
- **Handlingsblokken** er et `Card` med `id="gjor-om"` og `aria-labelledby` til en skjult overskrift «Gjør om eller avslå» (`h2 sr-only`). Vises bare med `canEditOrders`.
- **Dublettvarselet står under handlingsblokken**, slik at hovedknappen alltid er synlig uten rulling på iPad (testplan 5.18), også med mange treff og lang adresse. Så varselet ikke blir oversett, står det **én linje over knappen** når det finnes treff: varseltrekant (som i `PossibleDuplicatesFrame`) og teksten «Mulig dublett. Se varselet under før du gjør om.» i `text-watch-text` på hvit flate, der «Se varselet under» er en lenke til `#mulig-dublett-tittel`. Linjen har ingen egen `role`; selve varselet har `role="status"` som før.

### 5.2 «Gjør om til oppdrag» (ett trykk)

- `SubmitButton` (`primary`, `lg` = 56 px, `w-full` under `sm`, ellers `w-auto` med `px-8`) med teksten «Gjør om til oppdrag», og «Lager oppdraget …» mens lagringen pågår. Låst mens lagringen pågår; kjernen låser raden.
- Hint under knappen (`text-sm text-slate-600`): «Alt fra tilbudet fylles inn. Oppdraget får nummer nå.»
- **Kontoret:**
  - **Den ansatte har kontor** (vanlig tilfelle): skjult felt `officeId` med kontoret, og linjen «Kontor: Bodø» under hintet. Har organisasjonen flere kontorer, står `<details>` med `summary` «Velg et annet kontor» (minst 44 px, understreket, fjord-dark) rett etter. Inni står `ChoiceGroup legend="Kontor"` med én `Radio` per kontor, den ansattes valgt. Radioene sendes med også når `<details>` er lukket, og da vinner det valgte (skjult felt brukes ikke når radioene finnes).
  - **Den ansatte har ikke kontor** (for eksempel admin): `ChoiceGroup legend="Kontor" columns` står **over** knappen, uten noe valgt. Feil: «Velg kontor.» ved gruppen. Admin stenges aldri ute.
  - **Organisasjonen har ingen kontorer:** teksten fra `officeChoice` (`emptyMessage`) i stedet for knappen. «Avslå tilbud» virker.
- Etter lagring: `/oppdrag/<id>?fra=tilbud` med kvitteringen i avsnitt 6.
- Uten nett: «Du er uten nett. Endringen er ikke lagret.» (`FormMessage`, `role="alert"`) rett over knappen, og knappen kan trykkes igjen.
- Er tilbudet allerede gjort om eller avslått (en annen var raskere): siden lastes på nytt med `FormMessage` «Tilbudet er allerede gjort om eller avslått.» øverst i blokken, og den nye statusen vises.

### 5.3 «Forleng 30 dager» (F1)

- Vises i handlingsblokken for utløpte tilbud og åpne tilbud med 0–7 dager igjen, som `Button variant="secondary" size="md"`. Står først på raden med «Avslå tilbud».
- Låst mens lagringen pågår. Etter lagring lastes siden med ny dato, og `Notice` «Gyldig til 16.12.2026.» står øverst i handlingsblokken. Kvitteringen kommer fra svaret på handlingen, ikke fra adressen (T-0089). Knappen forsvinner etter lagring (mer enn 7 dager igjen), så kvitteringen eies av hele handlingsblokken (`OfferActions`, klientdel), ikke av knappen.
- Uten nett: som 5.2.

### 5.4 «Avslå tilbud» og kortet «Avslå tilbudet» (F4)

- «Avslå tilbud» er `Button variant="secondary" size="md"` med `aria-expanded` og `aria-controls="avsla-tilbud"`. Den åpner kortet under handlingsblokken; fokus går til kortets overskrift. Står det åpent, heter knappen fortsatt «Avslå tilbud» (`aria-expanded="true"`).
- Kortet (`Card id="avsla-tilbud"`):

```
Avslå tilbudet                                    (h2, tabIndex=-1)
Grunn
( ) Pris                    ( ) Tidspunkt passet ikke
( ) Valgte en annen         ( ) Kunden trakk seg
( ) Annet
Mer om grunnen
[_____________________________________________]
Må fylles ut når du velger Annet. Ingen fødselsnummer eller helseopplysninger.
[ Avslå tilbudet ]   Avbryt
```

- `ChoiceGroup id="reasonKey" legend="Grunn" columns` med fem `Radio` fra `OFFER_REJECTION_REASON_KEYS` og etikettene ved siden av. Ingen er valgt fra start. Hele raden er trykkflaten (minst 44 px).
- `Field label="Mer om grunnen" htmlFor="reasonText"` med `Textarea` (`maxLength` 500, `min-h-24`) og hintet over. Etiketten endres ikke etter valget (etiketter som skifter, forvirrer skjermlesere); hintet sier når den er påkrevd.
- `SubmitButton variant="secondary"` «Avslå tilbudet» («Avslår …» mens den lagrer) og `ghost`-knappen «Avbryt», som lukker kortet og setter fokus tilbake på «Avslå tilbud». Sekundær fordi hovedknappen på siden er «Gjør om til oppdrag».
- Feil: «Velg en grunn.» ved gruppen, «Skriv grunnen.» ved tekstfeltet. Fokus til første felt med feil. Valg og tekst står igjen.
- Uten nett: som 5.2, over knappen.
- Etter lagring lastes siden som avslått (5.5). Kortet «Avslått: Pris» er kvitteringen, og fokus flyttes dit (`tabIndex=-1`); handlingsblokken finnes ikke lenger, så en egen melding ville forsvunnet med den.

### 5.5 Avslått eller gjort om

Handlingsblokken, «Avslå tilbudet» og «Forleng» vises ikke. Øverst, under tittelen:

- **Avslått:** `Card` med «Avslått: Pris» (`text-lg font-medium`) og fritekst under hvis den finnes (`whitespace-pre-line`, `break-words`).
- **Gjort om:** `Card` med lenken «Gjort om til oppdrag 2026-0042» (som i dag). Kansellert oppdrag: samme tekst med «(kansellert)» og uten lenke.

### 5.6 Detaljkortet og «Endre tilbudet»

- `dl` med `Detail` som i dag. Endringer: «Ekstern referanse» → «Meglerens ordrenummer»; gårds-, bruks- og seksjonsnummer samles i én linje «Matrikkel» (som «Bestilling» på oppdraget); ny linje «Gyldig til».
- «Endre tilbudet» (var «Endre ordren»): sekundærknapp, 44 px, i alle statuser. Mønsteret `OrderEditSection` står: skjemaet åpnes i kortet, fokus til overskriften «Endre tilbudet», handlingsblokken skjules mens skjemaet er åpent (bare én «Lagre» på siden).
- **«Gyldig til» i skjemaet** står **først**, fordi det er det som oftest endres på et tilbud: `Input type="date" name="validUntil"`, hint «Høyst ett år fram.». For avslått og gjort-om tilbud vises ikke feltet; i stedet linjen «Gyldig til kan bare endres på åpne og utløpte tilbud.» i stone.
- **Gjort om (T-0075):** linjen over feltene byttes til: «Tilbudet og oppdraget har hver sin kopi av opplysningene. Endringer her endrer ikke oppdraget. Rett adresse, matrikkel og bestiller på oppdraget, under Bestilling.» etterfulgt av lenken «Gå til oppdrag 2026-0042» (som i dag). Utvikler sjekker at teksten stemmer med kjernen (ADR 0011: oppdraget eier sine bestillingsopplysninger), og testen låser den.
- **«Lagret.» (T-0089):** kvitteringen etter «Lagre» kommer fra svaret på handlingen, ikke fra `?endret=1`. Den vises bare når noe faktisk ble endret («Endringene er lagret.»), forsvinner ved neste forsøk, og kommer ikke tilbake ved omlasting. Ingenting endret: skjemaet lukkes uten kvittering.
- Konflikt: «Tilbudet er endret av en annen. Last siden på nytt.» med sekundærknappen «Last siden på nytt» (samme mønster som «Bestilling»).

### 5.7 Fokus på `#gjor-om` (F2 b)

`FocusConvert` (klientdel, ingen tekst): når siden åpnes med `location.hash === "#gjor-om"`, settes fokus på «Gjør om til oppdrag» (eller på første kontorradio når den ansatte ikke har kontor). Nettleseren ruller selv til blokken. Ingen fokusflytting ellers (tastaturet skal ikke sprette opp).

## 6. Oppdraget etter omgjøring (F5) og «Laget fra tilbud»

- **Kvittering** når adressen har `?fra=tilbud`: `Notice` «Oppdraget er laget.» etterfulgt av lenken «Velg takstmann og befaringsdato» til `#takstmann`. `?ny=1` («Oppdrag NNN er lagret.») er uendret for «Nytt oppdrag».
- **`Notice` får valgfri `link?: { href: string; label: string }`.** Lenken står etter meldingen i samme `role="status"`-avsnitt: `inline-flex min-h-11 items-center font-medium text-fjord-dark underline`, med « ›» (`aria-hidden`). Fjord-dark mot sand holder 4,5:1 (legges inn i `contrast.test.ts`). Uten `link` er `Notice` som før.
- **Ankeret `#takstmann`** settes på seksjonen «Team» (`<section id="takstmann" tabIndex={-1}>`), fordi omgjøringen ikke setter ansvarlig takstmann, og den delen står langt nede. Kortet «Befaring og frist» står allerede rett under kvitteringen og er synlig uten rulling. Lenken flytter fokus til seksjonen (`tabIndex=-1`, fokusramme vises, se T2-rettingen).
- **«Laget fra tilbud»:** lenken øverst heter «‹ Tilbudet» (var «‹ Ordren») og går til `/tilbud/<id>`. I «Bestilling» heter linjen «Laget fra tilbud» (var «Fra ordre») med lenken «Åpne tilbudet».

## 7. «Nytt oppdrag»: lagre som tilbud og «Gjør om tilbudet» (F2)

### 7.1 «Lagre som tilbud i stedet»

```
[ Mulig dublett … ]
[      Lagre      ]   [ Lagre som tilbud i stedet ]   Avbryt
```

- Ny `SubmitButton variant="secondary" size="md"` i raden med «Lagre», før «Avbryt». Sender det samme skjemaet til en egen handling (`formAction` på knappen).
- Mens noe lagres, er begge knappene låst; bare den trykte viser «Lagrer …».
- Takstmann, befaringsdato og kontor tas ikke med. Det står ikke på skjermen (det følger av ordet «tilbud»); hjelpeteksten i oppgavekortet holder.
- Etter lagring: `/tilbud/<id>` med «Tilbudet er laget. Gyldig til 16.12.2026.» Feil: på «Nytt oppdrag», og det som er skrevet står igjen.
- På iPad stående brytes raden; «Lagre» står alltid først.

### 7.2 «Gjør om tilbudet» i dublettvarselet

- `BookingDuplicateItem` får `displayStatus?: OfferDisplayStatus` (bare for `kind: "order"`). Statusordet i linjen blir visningsstatusen («Åpent», «Utløpt», «Avslått», «Gjort om til oppdrag»), og «Ordre» blir «Tilbud»: «Tilbud – Storgata 1A, 8006 Bodø – Utløpt – samme adresse».
- Teksten under overskriften blir: «Samme adresse eller matrikkel som et annet oppdrag eller et tilbud. Sjekk at boligen ikke blir tatt to ganger.»
- For treff med `displayStatus` `open` eller `expired`, **og bare i skjemaet «Nytt oppdrag»** (prop `offerAction` på varselet): under lenken står `Link` til `/tilbud/<id>#gjor-om` med `buttonVariants({ variant: "secondary", size: "md" })` og teksten «Gjør om tilbudet». Ringen er slate-700 mot watch-flaten (over 3:1). Skjermleseren får `aria-describedby` til treffets linje, så «Gjør om tilbudet» ikke står alene.
- Det som er skrevet i «Nytt oppdrag», går tapt når man går til tilbudet. Det er villet: tilbudet har allerede opplysningene, og målet er å unngå dobbel registrering.
- På oppdragssiden og tilbudssiden er varselet som før (bare lenker).

## 8. Tekster (samlet)

| Sted | Tekst |
|---|---|
| Meny, `h1` og fanetittel | «Tilbud» |
| Linje under `h1` | «Mulige jobber som ikke er oppdrag ennå.» |
| Knapp på listen | «Nytt tilbud» |
| Filter | «Åpne», «Utløpt», «Avslått», «Gjort om til oppdrag», «Alle» (skjermleser: «Åpne, 3 tilbud») |
| Merker | «Åpent», «Utløpt 14.11.2026», «Avslått», «Gjort om til oppdrag», «Går ut i dag», «Går ut i morgen», «Går ut om N dager» |
| Listen | «Gyldig til 19.11.2026», «Meglerens ordrenr. 55-1234», «2026-0042 (kansellert)» |
| Tom liste | se 3.6 |
| Nytt tilbud | «Nytt tilbud», «Gyldig til», «30 dager fra i dag er foreslått. Høyst ett år fram.» |
| Tilbudssiden | «‹ Tilbud», «Gyldig til 19.11.2026», «Gjør om til oppdrag», «Lager oppdraget …», «Alt fra tilbudet fylles inn. Oppdraget får nummer nå.», «Kontor: Bodø», «Velg et annet kontor», «Forleng 30 dager», «Avslå tilbud» |
| Dublettlinje ved knappen | «Mulig dublett. Se varselet under før du gjør om.» |
| Avslag | «Avslå tilbudet», «Grunn», «Pris», «Tidspunkt passet ikke», «Valgte en annen», «Kunden trakk seg», «Annet», «Mer om grunnen», «Må fylles ut når du velger Annet. Ingen fødselsnummer eller helseopplysninger.», «Avslår …», «Avbryt» |
| Avslått | «Avslått: Pris» |
| Detaljkortet | «Meglerens ordrenummer», «Matrikkel», «Gyldig til», «Endre tilbudet» |
| Endre, låst dato | «Gyldig til kan bare endres på åpne og utløpte tilbud.» |
| Endre, gjort om (T-0075) | «Tilbudet og oppdraget har hver sin kopi av opplysningene. Endringer her endrer ikke oppdraget. Rett adresse, matrikkel og bestiller på oppdraget, under Bestilling.», «Gå til oppdrag NNN» |
| Kvitteringer | «Tilbudet er laget. Gyldig til [dato].», «Gyldig til [dato].», «[adresse] er gyldig til [dato].» (listen), «Endringene er lagret.», «Oppdraget er laget.» + «Velg takstmann og befaringsdato» |
| Feil | «Velg en grunn.», «Skriv grunnen.», «Velg kontor.», «Gyldig til kan ikke være før i dag.», «Gyldig til kan være høyst ett år fram.», «Tilbudet er allerede gjort om eller avslått.», «Tilbudet er endret av en annen. Last siden på nytt.» |
| Uten nett (A360) | «Du er uten nett. Endringen er ikke lagret.» |
| Oppdraget | «‹ Tilbudet», «Laget fra tilbud», «Åpne tilbudet» |
| Nytt oppdrag | «Lagre som tilbud i stedet», «Gjør om tilbudet» |
| Dublettvarsel | «Samme adresse eller matrikkel som et annet oppdrag eller et tilbud. Sjekk at boligen ikke blir tatt to ganger.», «Tilbud – … – Utløpt – samme adresse» |

Ingen synlig tekst sier «ordre» om dette, unntatt «Meglerens ordrenummer»/«ordrenr.».

## 9. Mål

| Del | Mål |
|---|---|
| «Gjør om til oppdrag» | `min-h-14` (56 px), `px-8`, `text-lg`, pille, night; hele bredden under `sm` |
| Sekundærknapper («Nytt tilbud», «Forleng 30 dager», «Avslå tilbud», «Endre tilbudet», «Gjør om tilbudet», «Lagre som tilbud i stedet») | `min-h-11` (44 px), pille, ring slate-700 |
| Filterknapper | `min-h-11`, `px-4`, 8 px hjørner i en ramme med 12 px hjørner (som køen) |
| Radiorader (kontor, grunn) | minst 44 px, hele raden er trykkflaten, to kolonner fra `md` |
| Rad i listen | lenken `min-h-14`, `px-5 py-3` |
| Merker | 24 px høye, ingen kant |
| Kort | hvit, tynn kant `line`, 12 px hjørner, ingen skygge |
| Avstand | 24 px mellom kortene, 12 px mellom knappene i handlingsblokken |
| Bredde | liste `max-w-4xl`, skjema og side `max-w-2xl` |

## 10. Universell utforming

- Filter: `nav` med `aria-label="Status"`, valgt filter `aria-current="page"`, tallene lest som «Åpne, 3 tilbud».
- Merker og «Går ut …» har alltid tekst; klokke- og varselikon er `aria-hidden`.
- Radiogruppene er `fieldset` med `legend`; feil knyttes med `aria-describedby` og `aria-invalid` (`ChoiceGroup` gjør det).
- Fokus: første felt med feil; overskriften når «Avslå tilbudet» og «Endre tilbudet» åpnes; «Avslå tilbud» etter «Avbryt»; kvitteringen i listen etter «Forleng»; «Gjør om til oppdrag» ved `#gjor-om`; seksjonen «Team» etter lenken i kvitteringen.
- Varsler: kvitteringer `role="status"`, feil `role="alert"`, dublett `role="status"`.
- Fokusramme i fjord (2 px) på alt som kan trykkes, også `summary` («Velg et annet kontor») og seksjoner med `tabIndex=-1`.
- Kontrast: bare tokens fra temaet. Nye par i `contrast.test.ts`: watch-tekst mot hvit (dublettlinjen ved knappen) og fjord-dark mot sand (lenken i `Notice`). E2e sjekker merkene med den egne `contrastRatio` (ingen axe).
- Tastatur: Tab følger rekkefølgen i 5.1; piltaster i radiogruppene; Enter på filterlenkene.

## 11. Tilstander på tilbudssiden

| Tilstand | Hva vises |
|---|---|
| Åpent, mer enn 7 dager igjen | «Åpent», «Gyldig til …», gjør om og avslå |
| Åpent, 0–7 dager igjen | «Går ut …», «Gyldig til …», gjør om, forleng og avslå |
| Utløpt | «Utløpt [dato]», gjør om, forleng og avslå |
| Avslått | «Avslått», kortet «Avslått: [grunn]» (fokus dit rett etter avslag), ingen handlinger utenom «Endre tilbudet» |
| Gjort om | «Gjort om til oppdrag», lenken til oppdraget (eller «(kansellert)»), ingen handlinger utenom «Endre tilbudet» |
| Uten `canEditOrders` | bare visning: merke, «Gyldig til», detaljkort og endringer |
| Lagrer | den trykte knappen viser sin «…»-tekst («Lager oppdraget …», «Avslår …», «Lagrer …») og er låst, de andre knappene i blokken er låst |
| Uten nett | `FormMessage` over knappen som ble trykket, alt står igjen |
| Ukjent, fremmed eller slettet id | `NoAccess` som i dag |

## 12. Ikke med

Som oppgavekortet: ingen pris, tilbuds-PDF eller sending til kunde, ingen statistikk over avslagsgrunner, ingen KI-forslag, ingen varsel når et tilbud går ut, ingen mørk eller kompakt visning.

## 13. Sjekkliste for utvikler

- [ ] Ingen ny komponent i `src/shared/ui`; bare `gap-1` i `Badge` og valgfri `link` i `Notice`. Ingen ny avhengighet.
- [ ] Menyen: Nytt oppdrag, Arbeidskø, Kontakter, Firma, Tilbud, Statistikk.
- [ ] Ingen `Select` på tilbudssidene (kontor og grunn er radioer).
- [ ] Ingen knapp inne i en lenke i listen.
- [ ] Ingen kvittering for endringer fra adressen (`?endret=1`, `?lagret=1`); de kommer fra svaret på handlingen (T-0089). Unntak der lagringen sender til en ny side: `?ny=1` på `/tilbud/<id>` («Tilbudet er laget. …», etter «Nytt tilbud» og «Lagre som tilbud i stedet») og `?fra=tilbud` på oppdraget. Begge fjernes fra adressen når kvitteringen er vist (`router.replace` uten parameteren), så den ikke kommer tilbake ved omlasting.
- [ ] Ingen persondata i adressen; bare id-er og `status`/`q`.
- [ ] Rekkefølgen på tilbudssiden er som i 5.1, og «Gjør om til oppdrag» er synlig uten rulling på iPad stående og liggende.
- [ ] Ingen synlig «ordre» om tilbud (unntak «Meglerens ordrenummer»).
- [ ] Skjermbilder i PC og iPad stående legges ved PR-en: listen (Åpne med «Går ut»-merke, Utløpt), tilbudssiden (åpent med dublett, utløpt, avslått, admin uten kontor), «Avslå tilbudet» med feil, «Nytt oppdrag» med «Gjør om tilbudet», oppdraget med kvitteringen.
