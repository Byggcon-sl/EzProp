# Funksjon: Sammenligning av kandidatene og ADR for drift uten nett (foreløpig)

- **Fase:** 1 – Prøve uten nett
- **Modul:** ingen kode. Bare dokumentasjon i `docs/`.
- **Status:** utkast (30.10.2026)
- **Branch:** `fase1-sammenligning-adr` (bygger på `main`)
- **Plan:** de to punktene «Sammenligning av kandidatene …» og «ADR: valg av løsning for drift uten nett …» i `docs/07-utviklingsplan.md`. Se «Slik går fase 1 videre uten Ståle» i `docs/agenter/tilstand.md`.
- **Støtter hovedmål:**
  - **Tid (hovedsak):** befaring uten nett på iPad er den største tidsbesparelsen mot IVIT. Et valg nå lar fase 0b og fase 2 bygges på én løsning i stedet for tre, så vi slipper å bygge ting to ganger.
  - **Reklamasjoner:** valget skal bygge på hva som faktisk virket i prøvene (ingenting går tapt mellom befaring og rapport), og si tydelig hva som ikke virket, så feilen ikke følger med inn i ekte rapporter.
  - **KI først:** se under.

## Problem

Fase 1 har tre kandidater for drift uten nett på samme testskjema: PowerSync, ElectricSQL og en egenbygd løsning (lokal database og endringskø). Prøve C, D, E og F er levert med automatiske tester (Vitest og e2e i pc og iPad-størrelse). Prøve A og B på ekte iPad venter på Ståle (spørsmål nr. 12, koster penger). Uten et valg kan ikke fase 0b (innlogging og organisasjon) starte, fordi synkvalget kan påvirke databasen og innloggingen. Lar vi være, står løkken stille til Ståle er tilbake.

## KI først

Ikke i denne oppgaven. Valget av synkløsning er grunnlaget for KI først: KI-forslag (tekst, TG, bildetolkning) skal senere lages og vises på iPaden, også uten nett, og takstmannen godkjenner dem der. ADR-en skal derfor si hvordan valgt løsning tåler felt som fylles av KI (for eksempel at et KI-forslag er en vanlig endring som synkes per felt, og at takstmannens endring alltid vinner over et forslag). Ingen KI bygges nå.

## Brukerhistorier

- Som **Ståle** vil jeg **se en enkel sammenligning av de tre kandidatene**, slik at **jeg kan godkjenne valget i demoen uten å lese kode**.
- Som **utvikler i fase 0b og 2** vil jeg **ha én valgt løsning med begrunnelse**, slik at **jeg vet hva databasen og innloggingen skal bygges rundt**.

## Omfang

**Med:**

1. **Sammenligning** i `docs/funksjoner/fase1-sammenligning.md`, én tabell og kort tekst per kandidat, med disse punktene:
   - **Virker prøvene:** for C, D, E og F per kandidat, ut fra de automatiske testene på `main` (Vitest og e2e). Kjør `pnpm test` og `pnpm test:e2e` på branchen og oppgi antall bestått/feilet med dato. Skill mellom «virker i automatiske tester» og «ikke prøvd på ekte iPad». A og B: «ikke kjørt», med det som er forberedt (resultatmalene `fase1-prove-ab-*.md`).
   - **Hvor mye arbeid:** omtrent hvor mye kode hver kandidat trengte i `src/modules/offline-trial/sync/` (tell linjer per kandidatmappe), nye avhengigheter, ekstra tjeneste, og hva som må bygges videre for ekte maler (synk per felt, tekstfletting, bilder, myk sletting, organisasjons-ID).
   - **Drift i EU/EØS:** hvor data går, om selvdrevet i Azure Sweden Central er mulig, om det trengs databehandleravtale. Kilde: ADR 0003, `docs/drift/powersync.md`, `docs/drift/electricsql.md`.
   - **Pris:** selvdrevet (anslag fra ADR 0003: ca. 700–850 kr per måned for begge synktjenestene; egenbygd trenger ingen ekstra tjeneste). Skytjenestene nevnes bare med at de ikke er valgt (nr. 10 og 11).
   - **Hvor modent verktøyet er:** versjon, lisens, hvor lenge det har vært stabilt, kjente begrensninger og det som ikke virket i prøvene (for eksempel funnet om Electrics 400-kropp fra PR #10, bildekøen som kunne stå fast fra PR #14, småfunn i prøve D).
2. **ADR 0004** i `docs/adr/0004-drift-uten-nett.md`, merket øverst: **«Status: foreløpig, bekreftes etter prøve A og B på ekte iPad.»** Innhold:
   - Valgt løsning og begrunnelse knyttet til hovedmålene og «det enkleste som virker».
   - **Det som ikke virket** eller ikke ble prøvd, per kandidat.
   - **Hva prøve A og B må vise for at valget står:** konkrete krav (for eksempel null tapte svar og bilder etter 30 minutter i flymodus, 200 bilder, lukking og omstart; tekst flettes og «siste endring vinner» med varsel for TG, valg og tall), og hva som skjer hvis de ikke holder (hvilken kandidat er reserve).
   - Hva valget betyr for fase 0b og 2b (database, innlogging, tabeller med `organization_id`, myk sletting), og at de to andre kandidatene fjernes i en egen PR først etter Ståles godkjenning.
   - Forkastede alternativer med grunn, også skytjenestene.
3. **Spørsmål nr. 10 og 11** (PowerSync og ElectricSQL som leverandør) avgjøres i autonom modus: selvdrevet eller skytjeneste, pris, lisens, databehandleravtale. Føres i tabellen «Avgjort av agentene mens Ståle var borte» i `docs/09-apne-sporsmal.md` med **neste ledige A-nummer på `main` rett før PR** (A1–A10 er brukt; en annen kjøring på `fase1-smafunn-prove-d-f` kan bruke A11 og A12). Status på nr. 10 og 11 settes til «avgjort, se A…».
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

Ingen nye tabeller. ADR-en beskriver hva valget betyr for de ekte tabellene senere (fase 0b og 2b), blant annet indeksmønsteret `(organization_id, updated_at, id)` og N+1 i `applyTrialChanges` (punkt 12 fra nattløkken).

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
- [ ] `git diff main --stat` viser ingen endringer i `src/`, `e2e/`, `infra/` eller `scripts/`.
- [ ] `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne (ingen kode endret, men CI må være grønn før merge).
- [ ] Ingen modellnavn, kundeopplysninger eller hemmeligheter i filene.

## Roller

- **arkitekt:** skriver sammenligningen og ADR 0004, kjører testene og teller kode.
- **sikkerhet-personvern:** gjennomgår drift i EU/EØS, databehandleravtale og leverandørbeslutningene (nr. 10 og 11).

Ikke med: utvikler og testskriver (ingen kode), ux og ui (ingen skjerm), fagansvarlig (ikke fagstoff).

## Åpne spørsmål

- Ingen som stopper oppgaven. Ståle godkjenner ADR-en i demoen etter prøve A og B.
