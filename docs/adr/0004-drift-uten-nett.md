# ADR 0004 – Drift uten nett: egenbygd lokal lagring og endringskø

**Status: foreløpig, bekreftes etter prøve A og B på ekte iPad.**

Dato: 30.10.2026. Tatt av agentene i autonom modus («Slik går fase 1 videre uten Ståle» i `docs/agenter/tilstand.md`). Ståle godkjenner eller endrer valget i demoen. Grunnlag: `docs/funksjoner/fase1-sammenligning.md`, resultatfilene `fase1-prove-ab-*.md`, ADR 0003, domenemodellen 4.11 og sidemannskontrollen del 2 P20–P23. Oppgavekort: `docs/funksjoner/fase1-sammenligning-adr.md`.

**Støtter hovedmål:**
- **Tid:** befaring uten nett på iPad er den største tidsbesparelsen mot IVIT. Ett valg nå gjør at fase 0b og 2 bygges på én løsning, ikke tre.
- **Reklamasjoner:** valget bygger på det som faktisk virket hele veien i de automatiske prøvene, og det som ikke virket står under.
- **KI først:** løsningen tåler KI-forslag som lages og godkjennes på iPaden uten nett (se «KI-forslag»).

## Beslutning

1. **Valgt løsning: egenbygd** (kandidat 3): lokal lagring i IndexedDB på iPaden, egen endringskø som sendes til appen, og «hent endringer siden sist» fra appen. Ingen synktjeneste, ingen ny avhengighet. Koden i prøven: `src/modules/offline-trial/sync/local/` (lokal kjerne), `sync/custom/` (leser og takt), `server/changes-since.ts` (hente-ruten) og `server/apply-changes.ts` (skriveruten).
2. **Reserve, avhengig av hva som svikter i prøve A og B:**
   - Svikter **lagringen eller køen på iPaden** (data borte etter lukking, omstart eller dager uten bruk): **PowerSync**, som har sin egen lokale database (SQLite i nettleseren) og egen kø. ElectricSQL hjelper ikke da, fordi den bruker den samme lokale kjernen.
   - Svikter **bare hentingen** (rader som mangler på den andre iPaden, for treg eller for tung henting): **ElectricSQL**, som bytter ut bare leseren og beholder kjernen.
   - Begge reservene krever at synktjenestene slås på i testmiljøet (spørsmål nr. 12, koster penger, Ståle).
3. **PowerSync og ElectricSQL driftes selv hvis de noen gang tas i bruk**, i Azure Sweden Central. Skytjenestene velges ikke (A13 og A14 i `docs/09-apne-sporsmal.md`).
4. **De to andre kandidatene beholdes** til Ståle har godkjent ADR-en. De fjernes i en egen PR etterpå, sammen med flyttingen til `src/core/sync` (punkt «Hvor synkmotoren skal ligge»).

## Hvorfor

- **Det eneste som virket hele veien.** Egenbygd er den eneste kandidaten der både sending og henting er prøvd mot ekte ruter og testdatabase i e2e, også to nettleserkontekster i samme skjema: tekst flettes, og TG følger «siste endring vinner» med varselet «Endret av en annen» (`e2e/fase-1-egenbygd.spec.ts`). PowerSync- og Electric-tjenesten er aldri startet i en automatisk test (skyen har ikke Docker).
- **Det enkleste som virker.** Ingen ekstra container, ingen replikeringsrolle, ingen logisk replikering, ingen JWT-nøkkel å bytte, ingen wasm å hurtiglagre. Alt går gjennom appen med samme innlogging og samme tilgangssjekk (`requireOrganizationAccess`) som resten.
- **Prøve A og B kan kjøres uten kostnad.** Egenbygd trenger ikke synktjenestene (ADR 0003), så Ståle kan bekrefte valget på ekte iPad uten å svare ja på nr. 12 først.
- **Drift og personvern.** Data går bare mellom iPaden og appen i Sweden Central. Ingen ny leverandør, ingen databehandleravtale, og ingen tjeneste med `REPLICATION` som i praksis kan lese hele databasen (`docs/drift/powersync.md`).
- **Passer domenemodellen.** Synk per felt, `sync_conflicts` og forslag i egne felt må vi uansett bygge på serveren selv (skriveruten er vår for alle tre kandidatene). Med egenbygd er hente- og skriveveien samme kode, i Drizzle, med `organization_id` fra grant.
- **Prisen vi betaler:** vi eier mest kode selv (ca. 2 300 linjer uten tester mot ca. 1 000 for PowerSync), og hentemarkøren har en kjent grense (se under). Det veier mindre enn en tjeneste vi ikke har sett virke.

## Det som ikke virket eller ikke ble prøvd

**Ikke prøvd for noen:** prøve A og B på ekte iPad, Safari på iPad i det hele tatt, 200 bilder, omstart av iPaden, 7 dager uten bruk (prøve C), `sync_conflicts`, `field_clock`, ytelse (ikke målt).

**Egenbygd (valgt)**
- Hentemarkøren bruker `updated_at` med 60 s overlapp. En rad som blir synlig mer enn 60 s «bakover i tid» (lang transaksjon, eller appklokken mer enn 60 s bak databasen), hoppes over. Dokumentert med test i `server/changes-since.test.ts`.
- `updated_at` settes av databasen ved innsetting og av appklokken ved oppdatering (`src/db/schema/common.ts`).
- Rader endret siste 60 s sendes i hver henting (ca. 12 ganger per endring). Ikke målt på ekte nett.
- Ikke trygt med flere faner samtidig (ingen `navigator.locks`). Appen på hjemskjermen har én fane.
- Bunter serveren avviser (400/409), blir liggende og prøves på nytt for alltid.

**PowerSync (reserve for lagring)**
- Henting fra tjenesten er aldri prøvd. Uten tjenesten når synkstatusen aldri «Alt er lagret», og køen sendes bare med «Synk nå».
- Avviste bunter stopper køen for enheten. Utlogging tømmer ikke den lokale databasen.
- Tjenestens lisens er FSL-1.1-ALv2 (resultatfilen), ikke Apache-2.0 som klientpakkene.

**ElectricSQL (reserve for henting)**
- **Electrics 400-kropp sendes videre til iPaden uendret** (PR #10, funn 1 fra sikkerhet-personvern; `SHAPE_FORWARDED_STATUSES` i `server/types.ts`). Må rettes før ekte data hvis ElectricSQL tas i bruk: 400 fra Electric skal gi `{ feil }` med vår egen tekst.
- Klientpakken `@electric-sql/client` holdt ikke regelen om høyst ett kall per 5 s og ble tatt ut; egen løkke brukes.
- Krever `REPLICA IDENTITY FULL` (migrering `0002`) på hver tabell. Henting bare prøvd med simulerte svar.

**Felles (skiller ikke kandidatene)**
- Bildekøen kunne stå fast når én opplasting aldri fikk svar. Rettet med tidsavbrudd per opplasting i PR #14.
- Småfunnene fra prøve D (liten oppgave h): kopi som avvises (400) eller får 404 etter myk sletting sendes på nytt hver runde, metadatasjekken slipper COM og andre APP-felt, m.m. Rettes på `fase1-smafunn-prove-d-f`.
- N+1 i `applyTrialChanges` (én spørring per rad i bunten).

## Hva prøve A og B må vise for at valget står

Kjøres med egenbygd først, etter `docs/funksjoner/fase1-prove-ab-egenbygd.md`, mot testmiljøet i Azure. Trenger ikke synktjenestene.

| Krav | Valget står når |
|---|---|
| A: 30 min i flymodus, alle 40 felt, 200 bilder, appen lukket og åpnet, iPaden startet på nytt | **Null** tapte eller doble svar og **null** tapte bilder på serveren, tre ganger på rad, på begge iPadene. Alle bildene har samme fingeravtrykk på iPad og server |
| A: synk når nettet kommer | Synkstatusen går til «Alt er lagret» uten «Synk nå», innen rimelig tid (føres i resultatfilen; ikke målt ennå) |
| A: lagring | Data ligger på iPaden etter omstart. Ingen melding om at noe ikke ble lagret |
| B: tekst | Begge bidrag i `roof_description` på begge iPadene |
| B: TG, valg og tall | Samme verdi på begge (siste endring vinner), og varselet «Endret av en annen» hos den som tapte |
| B: tid | Den andre iPaden ser endringen innen ca. 10 s med nett (takt 5 s pluss sending) |

**Hvis kravene ikke holder:**
- Tap eller feil i lagringen på iPaden → bytt til **PowerSync**; Ståle slår på synktjenestene (nr. 12), og A og B kjøres med PowerSync.
- Bare hentingen svikter (B for treg, rader mangler) → først rette markøren (se «Krav til fase 2b»); holder ikke det, **ElectricSQL** bak samme kontrakt.
- Byttet berører ikke skjermene, fordi alt går gjennom `TrialSyncStore` (se under).

## Hva valget betyr for fase 0b og 2b

- **Database:** ingen logisk replikering, ingen publikasjon og ingen synkroller i produksjon. Migrering `0002` og publikasjonen `powersync` fra `0001` gjelder bare prøvetabellene og forsvinner med dem.
- **Innlogging (fase 0b):** synken bruker appens vanlige økt (Better Auth). Ingen egen synknøkkel. Det gjør felles innlogging med Optiplan enklere.
- **Ekte tabeller** får felles kolonner som under, og hver synket tabell meldes inn i synkmotoren.
- **Ingen kode endres nå.** Prøvetabellene og kandidatene ligger urørt til Ståle har godkjent.

### Felles kolonner i ekte tabeller (domenemodellen avsnitt 3)

- `id` lages på iPaden (UUID v7, `src/shared/lib/uuid.ts`).
- `organization_id` settes **alltid fra grant** (`grant.organizationId`), aldri fra nyttelasten, slik `applyTrialChanges` gjør i dag.
- `row_version` eies av serveren og øker bare når noe faktisk endres (`server/apply-changes.test.ts`).
- Myk sletting er en endring av `deleted_at`. En DELETE-operasjon gir feil (`InvalidTrialChangeError`; endringsskjemaet godtar bare `PUT` og `PATCH`), slik det skal være i ekte tabeller også.

### Synk per felt mot konflikttabellen (domenemodellen 4.11)

- **Hvor:** på serveren, i skriveveien (det `applyTrialChanges` er i prøven). Serveren er eneste sted som ser begge endringene, og bare serveren skriver `sync_conflicts`. iPaden viser varselet når den henter konflikten eller den nye verdien.
- **Tekst** flettes (`text_state`, Yjs, `mergeTextStates`), som i prøven.
- **TG, valg og tall:** siste endring vinner, med varsel. Den tapte verdien lagres i `sync_conflicts` (`winning_value`, `losing_value`, `losing_employee_id`, `losing_device_id`). «Siste» avgjøres av `field_clock` (hybrid klokke per felt), ikke av rekkefølgen endringene kommer fram i.
- **Ikke prøvd:** prøven har verken `sync_conflicts` eller `field_clock`. I dag vinner den som kommer sist fram, og varselet lages bare på iPaden (`foreign-change.ts`).

### Bilder

Hvert bilde har egen id og legges bare til (ingen konflikt). Serveren bekrefter med fingeravtrykk (SHA-256) før iPaden gir slipp på bildet, og et avbrutt bilde sendes på nytt i sin helhet (A9, A10). Bildekøen (`photo-uploader.ts`) er felles for alle kandidatene og skiller dem ikke.

### KI-forslag

Et forslag er **ikke** en vanlig endring av verdien. Forslaget ligger i egne felt eller rader (`suggested_by_rule_id`, `suggestion_status`, `suggestion_override_reason`, og tilsvarende for KI). Takstmannens godkjenning er hans egen endring av verdien, med sin egen `field_clock`. Et forslag som kommer sent via synk, endrer bare forslagsfeltene og kan derfor aldri overskrive takstmannens verdi gjennom «siste endring vinner». KI publiserer aldri selv. Ingen KI bygges nå.

### Regelmotoren

Regelmotoren fra prøve E er uavhengig av synkvalget. Samme kode og samme testsaker kjører i nettleseren og på serveren (`src/modules/offline-trial/rules/`, `trial-rule-cases.ts`, `/api/prove/regler`). Den leser verdier fra lageret, ikke fra synkverktøyet.

### Hvor synkmotoren skal ligge

Når synken blir ekte, flyttes den til `src/core/sync` (kjernen), og hver modul melder inn sine egne tabeller. Ingen modul importerer fra en annen. I dag ligger alt i `src/modules/offline-trial` og er bare for prøven. Flyttingen skjer i en egen PR etter Ståles godkjenning, sammen med at PowerSync og ElectricSQL fjernes. Utkast til grensesnitt (bygges ikke nå):

```ts
// src/core/sync/types.ts (utkast)
export interface SyncedTableSpec {
  table: string; // tabellnavn i databasen
  localColumns: readonly string[]; // det som går til iPaden (aldri storage_path eller *_by)
  textColumns: readonly string[]; // flettes med text_state
  lastWriteWinsColumns: readonly string[]; // TG, valg, tall: varsel og sync_conflicts
}
export type RegisterSyncedTable = (spec: SyncedTableSpec) => void;
```

### Kontrakten `TrialSyncStore`

`TrialSyncStore` i `sync/types.ts` er grensen. Skjermer og bildekø importerer aldri synkverktøyets SDK; `sync/candidate-boundaries.test.ts` er beviset. En reserveløsning kobles inn bak samme kontrakt. Kontrakten (med nytt navn uten «Trial») beholdes i fase 2b, slik at et bytte etter prøve A og B ikke berører skjermene.

## Krav til fase 2b (ikke endring nå, ingen migrering)

- Indeksen `(organization_id, updated_at, id)` på alle ekte tabeller som synkes (prøvetabellene har den fra migrering `0003`).
- N+1 i `applyTrialChanges` tas ikke med videre: hent eksisterende rader for hele bunten på én gang per tabell, eller bruk `INSERT ... ON CONFLICT` (punkt 12 i nattløkken).
- Fjern den kjente grensen i hentemarkøren: `updated_at` settes av databasen både ved innsetting og oppdatering, eller markøren bygger på en løpende teller fra databasen. Avgjøres når fase 2b spesifiseres.
- Avviste bunter (400/409) skal ikke stoppe køen for alltid: de tas ut, vises for takstmannen og lagres slik at ingenting går tapt i stillhet.
- Utlogging og sperret iPad tømmer lokal lagring og hurtiglagrede sider («Sperring av iPader» under «Minimum før ekte data» i planen).

## Forkastet

- **PowerSync som hovedvalg.** Minst egen kode og mest ferdig lokal database, men tjenesten er aldri prøvd i en automatisk test, den krever en container, en replikeringsrolle som kan lese hele databasen, JWT-nøkkel og ca. 9 MB worker og wasm i hurtiglageret. Synkregler og klientskjema kommer i tillegg til Drizzle-skjemaet. Beholdt som reserve for lagringen.
- **ElectricSQL som hovedvalg.** Vi eier like mye kode som egenbygd (samme lokale kjerne) og får i tillegg en container, `REPLICA IDENTITY FULL`, en proxy med kjent funn (400-kroppen) og en klientpakke som ikke holdt våre regler. Beholdt som reserve for hentingen.
- **PowerSync Cloud og Electric Cloud.** Rapportdata via en ny leverandør, databehandleravtale og en månedlig kostnad, uten at tjenestene er prøvd. Ikke valgt (A13, A14).
- **PGlite (Postgres i nettleseren).** Forkastet i ElectricSQL-kandidaten: wasm på flere MB og egen worker, og køen måtte vi uansett eie.
- **Å vente med valget til Ståle er tilbake.** Da står fase 0b stille. Valget er foreløpig og kan snus uten at skjermene berøres.

## Konsekvenser

- Fase 0b kan starte uten synktjeneste i databasen eller innloggingen.
- Prøve A og B for egenbygd kan kjøres uten å slå på synktjenestene. Spørsmål nr. 12 trengs bare hvis en reserve må prøves.
- Når Ståle har godkjent: egen PR som fjerner PowerSync og ElectricSQL (kode, avhengigheter, `docker-compose.yml`, Bicep-delen fra ADR 0003, migrering for å fjerne publikasjonene) og flytter synkmotoren til `src/core/sync`.
- Holder ikke prøve A og B, skrives en ny ADR som erstatter denne.
