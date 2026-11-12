# ADR 0007 – Status per fagtekst i malen: `text_status` på utfall og standardtiltak

Dato: 12.11.2026. Status: vedtatt av agentene i autonom modus (A200, A201, A209); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-mal-bad.md`. Bygger på malmotoren (`0024_malmotor`, A136–A147).

Støtter hovedmålene: **færre reklamasjoner** (en tekst fagrådet ikke har godkjent, er merket i dataene og kan stoppes før ekte bruk), **KI i bunnen** (KI kan senere velge bare godkjente tekster, og årsak, konsekvens og tiltak ligger hver for seg) og **de ansatte** (fagansvarlig ser hva som er utkast).

## Beslutninger

1. **Én kolonne `text_status` på `outcomes` og på `standard_measures`.** Kodene står i `TEXT_STATUSES = ["draft", "approved"]` i `src/db/schema/templates.ts`. `draft` betyr «utkast, ikke godkjent av fagrådet». `NOT NULL`, standard `draft`, CHECK `outcomes_text_status_check` og `standard_measures_text_status_check` laget fra listen. Eksisterende rader får `draft`. Migrering `0028_mal-tekststatus`.
2. **Statusen på utfallet gjelder rapporttekstene på utfallet samlet** (`deviation_text`, `default_cause_text`, `default_consequence_text`). Hvert tiltak har sin egen status, fordi et utfall kan ha flere tiltak og de kan godkjennes hver for seg.
3. **Ny valgfri kolonne `outcomes.default_cause_text`** (årsak som tekst) ved siden av `default_cause_criterion`. Avviket har begge (domenemodellen 4.7), og forskriften krever årsak per avvik.
4. **Dokumentformatet** (`src/core/templates/schemas.ts`): `text_status` på utfall og standardtiltak, standard `draft`, ukjent verdi avvises. `default_cause_text` er valgfri tekst. `approved` godtas i formatet.
5. **Godkjenning er en ny malversjon, ikke en oppdatering.** Publiserte versjoner endres aldri. En rapport som er låst til en malversjon, viser derfor hvilken status teksten hadde da rapporten ble laget. Hvem som godkjente og når, hører til en godkjenningstjeneste senere og lagres ikke nå.
6. **Telling av endringer følger malmotoren.** Utfall har fast kode: endret `text_status` teller som én endret. Standardtiltak har ingen kode og erstattes samlet (A142): endret status gir fjernet og lagt til.
7. **Koden `draft` og `approved` endres aldri** (regel 6). Trengs flere trinn (for eksempel «avvist»), legges en ny kode til i listen med en ny migrering av CHECK-ene.

## Forkastet

- **Status på malversjonen** («hele versjonen er utkast»): fagrådet kan da ikke godkjenne tekst for tekst, og KI kan ikke skille godkjente fra ikke godkjente tekster i samme mal.
- **Egen tabell for godkjenninger** (tekst, hvem, når): mer enn den smale veien trenger. Kan legges til senere uten å endre kolonnen.
- **Avkrysning `approved` (boolean):** kan ikke utvides med flere trinn uten ny kolonne.
- **Status per tekstfelt på utfallet** (egen for avvik, årsak og konsekvens): tre kolonner til og mer å holde orden på. Tekstene på ett utfall leses og godkjennes sammen.
- **Merket i selve teksten** («UTKAST: …»): kan havne i rapporten, og kan ikke telles eller filtreres.

## Følger

- Publiseringssperren og KI-funksjonen «forslag fra frasebanken» kan senere lese `text_status`. Ingen av dem bygges her.
- Dyrt å endre når ekte maler finnes (migrering og data). Lett nå: bare prøveorganisasjonen får malen (A205).
