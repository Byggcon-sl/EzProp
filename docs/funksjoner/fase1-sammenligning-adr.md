# Funksjon: Sammenligning av kandidatene og ADR for drift uten nett (foreløpig)

- **Fase:** 1 – Prøve uten nett
- **Modul:** ingen kode. Bare dokumentasjon i `docs/`.
- **Status:** klar til bygging etter forhåndsvurdering fra arkitekten, runde 1 (30.10.2026)
- **Branch:** `fase1-sammenligning-adr` (bygger på `main`)
- **Plan:** de to punktene «Sammenligning av kandidatene …» og «ADR: valg av løsning for drift uten nett …» i `docs/07-utviklingsplan.md`. Se «Slik går fase 1 videre uten Ståle» i `docs/agenter/tilstand.md`.
- **Støtter hovedmål:**
  - **Tid (hovedsak):** befaring uten nett på iPad er den største tidsbesparelsen mot IVIT. Et valg nå lar fase 0b og fase 2 bygges på én løsning i stedet for tre, så vi slipper å bygge ting to ganger.
  - **Reklamasjoner:** valget skal bygge på hva som faktisk virket i prøvene (ingenting går tapt mellom befaring og rapport), og si tydelig hva som ikke virket, så feilen ikke følger med inn i ekte rapporter.
  - **KI først:** se under.

## Problem

Fase 1 har tre kandidater for drift uten nett på samme testskjema: PowerSync, ElectricSQL og en egenbygd løsning (lokal database og endringskø). Prøve C, D, E og F er levert med automatiske tester (Vitest og e2e i pc og iPad-størrelse). Prøve A og B på ekte iPad venter på Ståle (spørsmål nr. 12, koster penger). Uten et valg kan ikke fase 0b (innlogging og organisasjon) starte, fordi synkvalget kan påvirke databasen og innloggingen. Lar vi være, står løkken stille til Ståle er tilbake.

## KI først

Ikke i denne oppgaven. Valget av synkløsning er grunnlaget for KI først: KI-forslag (tekst, TG, bildetolkning) skal senere lages og vises på iPaden, også uten nett, og takstmannen godkjenner dem der. ADR-en skal derfor si hvordan valgt løsning tåler forslag, etter domenemodellen: **et forslag er ikke en vanlig endring av verdien.** Forslaget ligger i egne felt eller rader (`suggested_by_rule_id`, `suggestion_status`, `suggestion_override_reason`, og tilsvarende for KI). Takstmannens godkjenning er hans egen endring av verdien. Et forslag som kommer sent via synk, kan derfor aldri overskrive takstmannens verdi gjennom «siste endring vinner». Ingen KI bygges nå.

## Brukerhistorier

- Som **Ståle** vil jeg **se en enkel sammenligning av de tre kandidatene**, slik at **jeg kan godkjenne valget i demoen uten å lese kode**.
- Som **utvikler i fase 0b og 2** vil jeg **ha én valgt løsning med begrunnelse**, slik at **jeg vet hva databasen og innloggingen skal bygges rundt**.

## Omfang

**Med:**

1. **Sammenligning** i `docs/funksjoner/fase1-sammenligning.md`, én tabell og kort tekst per kandidat, med disse punktene:
   - **Virker prøvene:** for C, D, E og F per kandidat, ut fra de automatiske testene på `main` (Vitest og e2e). Kjør `pnpm test` og `pnpm test:e2e` på branchen og oppgi antall bestått/feilet med dato. Skill mellom «virker i automatiske tester» og «ikke prøvd på ekte iPad». A og B: «ikke kjørt», med det som er forberedt (resultatmalene `fase1-prove-ab-*.md`).
   - **Hvor mye arbeid:** omtrent hvor mye kode hver kandidat trengte i `src/modules/offline-trial/sync/`, nye avhengigheter, ekstra tjeneste, og hva som må bygges videre for ekte maler (synk per felt, tekstfletting, bilder, myk sletting, organisasjons-ID). Linjene telles på nytt i oppgaven, med dato og kommando, og vises i tre deler: **egen kode per kandidat** (`custom/`, `electricsql/`, `powersync/`), **felles kode som kandidaten trenger** (`sync/local/` brukes av egenbygd og ElectricSQL; filene rett i `sync/` brukes av alle tre) og **testfiler for seg**. Arkitektens tall uten å skille ut tester (bare til sammenligning): custom 1439, electricsql 819, powersync 1069, local 2679.
   - **Drift i EU/EØS:** hvor data går, om selvdrevet i Azure Sweden Central er mulig, om det trengs databehandleravtale. Kilde: ADR 0003, `docs/drift/powersync.md`, `docs/drift/electricsql.md`.
   - **Pris:** selvdrevet (anslag fra ADR 0003: ca. 700–850 kr per måned for begge synktjenestene; egenbygd trenger ingen ekstra tjeneste). Skytjenestene nevnes bare med at de ikke er valgt (nr. 10 og 11).
   - **Hvor modent verktøyet er:** versjon, lisens, hvor lenge det har vært stabilt, kjente begrensninger og det som ikke virket i prøvene. Versjon og lisens hentes **bare fra kilder i repoet**: `docker-compose.yml` (powersync-service 1.27.2, electric 1.8.1) og `package.json` eller `node_modules` for klientpakkene. Det som ikke er sjekket mot en kilde, skrives «ikke sjekket». Ingen påstand om lisens eller modenhet uten kilde.
   - **Det som ikke virket** skal minst ha med: Electrics 400-kropp som sendes videre uendret (PR #10, funn 1 fra sikkerhet-personvern) under ElectricSQL; bildekøen som kunne stå fast (PR #14); småfunnene fra prøve D (liten oppgave h).
2. **ADR 0004** i `docs/adr/0004-drift-uten-nett.md`, merket øverst: **«Status: foreløpig, bekreftes etter prøve A og B på ekte iPad.»** Innhold:
   - Valgt løsning og begrunnelse knyttet til hovedmålene og «det enkleste som virker».
   - **Det som ikke virket** eller ikke ble prøvd, per kandidat.
   - **Hva prøve A og B må vise for at valget står:** konkrete krav (for eksempel null tapte svar og bilder etter 30 minutter i flymodus, 200 bilder, lukking og omstart; tekst flettes og «siste endring vinner» med varsel for TG, valg og tall), og hva som skjer hvis de ikke holder (hvilken kandidat er reserve).
   - Hva valget betyr for fase 0b og 2b (database, innlogging, tabeller med `organization_id`, myk sletting), og at de to andre kandidatene fjernes i en egen PR først etter Ståles godkjenning.
   - Forkastede alternativer med grunn, også skytjenestene.
   - **Felles kolonner i ekte tabeller** (domenemodellen 4.x): `id` lages på iPaden (UUID v7); `organization_id` settes alltid fra grant, aldri fra nyttelasten (som `applyTrialChanges` gjør i dag); `row_version` eies av serveren og øker bare ved faktisk endring (`apply-changes.test.ts`); myk sletting er en endring av `deleted_at`, og DELETE gir feil (`InvalidTrialChangeError`), slik det skal være i ekte tabeller også.
   - **Synk per felt mot konflikttabellen** i domenemodellen: tekst flettes (`text_state`); for TG, valg og tall vinner siste endring med varsel, og den tapte verdien lagres i `sync_conflicts`. ADR-en sier **hvor** dette skjer i valgt løsning (på serveren i `applyTrialChanges` eller hos klienten). Prøven har ikke `sync_conflicts`; det står som «ikke prøvd».
   - **Bilder:** hvert bilde har egen id og legges bare til; serveren bekrefter med fingeravtrykk (A9, A10). Bildekøen er felles for alle kandidatene og skiller dem ikke.
   - **KI-forslag:** som under «KI først».
   - **Hvor synkmotoren skal ligge** når den blir ekte: i `src/core/sync` (eller `src/shared`), og hver modul melder inn sine egne tabeller. Ingen modul importerer fra en annen. I dag ligger alt i `src/modules/offline-trial` og er bare for prøven. Flyttingen skjer i en egen PR etter Ståles godkjenning, sammen med at de andre kandidatene fjernes.
   - **Kontrakten `TrialSyncStore`** (`sync/types.ts`) er grensen. Skjermer og bildekø importerer aldri SDK-en til synkverktøyet; `candidate-boundaries.test.ts` er beviset. Reserveløsningen kobles inn bak samme kontrakt, og kontrakten beholdes i fase 2b, slik at et bytte etter prøve A og B ikke berører skjermene.
   - **Regelmotoren fra prøve E** er uavhengig av synkvalget (viser til testsakene i `src/modules/offline-trial/rules/`).
   - **Krav til fase 2b** (ikke endring nå, ingen migrering): indeksen `(organization_id, updated_at, id)` på ekte tabeller, og at N+1 i `applyTrialChanges` ikke tas med videre.
3. **Spørsmål nr. 10 og 11** (PowerSync og ElectricSQL som leverandør) avgjøres i autonom modus. Beslutningen gjelder **bare** at tjenesten driftes selv i Azure Sweden Central, og at skytjenesten ikke velges. Den slår ingenting på og koster ingenting. Føres i tabellen «Avgjort av agentene mens Ståle var borte» i `docs/09-apne-sporsmal.md` som **A13 og A14** (A1–A10 er brukt på `main`; `fase1-smafunn-prove-d-f` kan bruke A11 og A12). Har `main` flere numre rett før PR, brukes de neste ledige. Status på nr. 10 og 11 settes til «avgjort, se A13/A14».
4. **Planen:** kryss av begge punktene som levert, med tekst om at ADR-en er foreløpig og at Ståles godkjenning i demoen gjenstår.
5. **Ordlisten** i `docs/05-domenemodell.md` avsnitt 8: bare hvis ADR-en innfører nye ord.
6. **Tilstandsfilen:** oppdateres; under «Trenger Ståle når han er tilbake» legges «les og godkjenn ADR 0004 i demoen».
7. **Versjon** i `package.json` økes (patch), regel 13.

**Ikke med (bevisst utelatt):**

- Ingen endringer i `src/`, `e2e/`, `infra/`, `scripts/` eller avhengigheter. Ingen kandidat fjernes.
- Ingen nye tjenester, ingen kontoer, ingenting som koster penger. Synktjenestene i Azure slås ikke på.
- Prøve A og B kjøres ikke (krever ekte iPad og påslåtte tjenester).
- Ingen ytelsesmåling utover det testene allerede viser. Tall som ikke er målt, skrives som «ikke målt».
- Ingen ADR for felles innlogging med Optiplan (fase 0b).
- Demoen for Ståle (eget punkt i planen).
- Ingen tekst fra NS 3600, IVIT eller SmartTakst, og ingen modellnavn.

## Tilgang

Ingen endring. Bare dokumentasjon.

## Data

Ingen nye tabeller og ingen migrering. ADR-en beskriver hva valget betyr for de ekte tabellene senere (fase 0b og 2b): felles kolonner, konflikttabellen, forslag i egne felt, og som krav til fase 2b indeksmønsteret `(organization_id, updated_at, id)` og N+1 i `applyTrialChanges` (punkt 12 fra nattløkken).

## Skjermer

Ingen.

## Regler

Ingen nye. ADR-en bekrefter at regelmotoren fra prøve E kjører likt på iPad og server uavhengig av synkvalget.

## Akseptkriterier

- [ ] `docs/funksjoner/fase1-sammenligning.md` finnes med alle fem punktene (prøvene, arbeid, EU/EØS, pris, modenhet) for alle tre kandidatene, og testtallene har dato og kommando.
- [ ] `docs/adr/0004-drift-uten-nett.md` har status «foreløpig, bekreftes etter prøve A og B på ekte iPad», valgt løsning med begrunnelse, «det som ikke virket», krav til prøve A og B, reserveløsning og forkastede alternativer.
- [ ] Hver påstand om at noe virker, viser til en test, en PR eller en fil. Ikke prøvd står som «ikke prøvd».
- [ ] Nr. 10 og 11 står som avgjort i `docs/09-apne-sporsmal.md`, med A-nummer som ikke kolliderer med `main` eller `fase1-smafunn-prove-d-f`.
- [ ] Begge punktene er krysset av i planen, med «foreløpig; Ståles godkjenning i demoen gjenstår».
- [ ] ADR-en dekker felles kolonner, konflikttabellen (med `sync_conflicts` som «ikke prøvd»), bilder, KI-forslag i egne felt, plassering i `src/core/sync`, kontrakten `TrialSyncStore` og regelmotoren, og har indeks og N+1 som krav til fase 2b.
- [ ] Linjetellingen skiller egen kode, felles kode og testfiler, med dato og kommando.
- [ ] Versjon og lisens viser til en fil i repoet, ellers «ikke sjekket».
- [ ] «Det som ikke virket» har med Electrics 400-kropp (PR #10), bildekøen (PR #14) og småfunnene fra prøve D (h).
- [ ] `git diff main --stat` viser ingen endringer i `src/`, `e2e/`, `infra/` eller `scripts/`. Bare `docs/` og `package.json` (patch).
- [ ] `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne (ingen kode endret, men CI må være grønn før merge).
- [ ] Ingen modellnavn, kundeopplysninger eller hemmeligheter i filene.

## Roller

- **arkitekt:** skriver sammenligningen og ADR 0004, kjører testene og teller kode.
- **sikkerhet-personvern:** gjennomgår drift i EU/EØS, databehandleravtale og leverandørbeslutningene (nr. 10 og 11).

Ikke med: utvikler og testskriver (ingen kode), ux og ui (ingen skjerm), fagansvarlig (ikke fagstoff).

## Avgjørelser etter forhåndsvurderingen (prosjektleder, 30.10.2026)

Arkitekten (runde 1) godkjente at oppgaven går videre, med 13 punkter som må med. Alle er tatt inn over. Ingen uenighet:

- **KI-forslag (punkt 4):** den første teksten i kortet («et KI-forslag er en vanlig endring») stred mot domenemodellen (`suggested_by_rule_id`, `suggestion_status`, `suggestion_override_reason`). Arkitekten har rett, og teksten er rettet. Grunn: hindrer at et sent forslag overskriver takstmannens verdi (reklamasjoner), og takstmannen har siste ord (KI først).
- **Indeks og N+1 (punkt 5):** står som krav til fase 2b, ikke som migrering nå. Grunn: bare dokumentasjon i denne oppgaven, og prøvetabellene skal fjernes.
- **Flytting til `src/core/sync` (punkt 6):** skjer i en egen PR etter Ståles godkjenning. Grunn: valget er foreløpig til prøve A og B er kjørt.
- **A-nummer (punkt 12):** A13 og A14, med mindre `main` har flere numre rett før PR.

Ingen spørsmål om fag, pris eller personvern ut over nr. 10 og 11, som avgjøres i autonom modus.

## Åpne spørsmål

- Ingen som stopper oppgaven. Ståle godkjenner ADR-en i demoen etter prøve A og B.
