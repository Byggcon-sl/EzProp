# Funksjon: Reglene badet trenger

- **Fase:** 2a-2 Smal vei, andre punkt («Reglene badet trenger»)
- **Modul:** kjerne (ny `src/core/rules`: regelmotoren, levetider og terskler), malmotoren (`src/core/templates`, `src/db/schema/templates.ts`) og badmalen (`src/db/seed/templates/wet-room.ts`)
- **Branch:** `fase2a-regler-bad` (bygger på `main`, som har badmalen fra PR #159)
- **Status:** utkast til forhåndsvurdering (arkitekt, fagansvarlig, ki-ansvarlig, test-leder)
- **Dato:** 12.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** våtrom gir flest reklamasjoner. Reglene foreslår TG ut fra membrantype, alder, dokumentasjon og målinger, likt hver gang, og de foreslår TGIU når hull ikke er tatt. Det er det IVIT ikke gjør (`kartlegging-bad.md`, «Funn og svakheter i IVIT»). Et bad uten hulltaking kan ikke lenger ende med TG0 ved en feil (T-0003).
  - **De ansatte:** takstmannen slipper å slå opp levetider og grenser og huske unntakene. Han får et forslag med begrunnelse og godtar, endrer eller avviser det (skjermen kommer i neste punkt).
  - **KI i bunnen:** regelsvarene er strukturerte data med fast kode og begrunnelse (hvilken alder, hvilken kilde for alderen, hvilket trinn, hvilken måling). Det er dette KI senere bygger årsakstekst og sammendrag på. Reglene er faste og prøvd med testsaker, så KI trenger aldri å vurdere TG.

## Problem
Badmalen (PR #159) har punkter, felt og avvikstekster, men ingen regler. Uten regler må takstmannen selv vite at en foliemembran uten dokumentasjon er over levetiden etter 18 år, at sjikt fra før 2000 gir TG3, og at et bad uten hulltaking skal ha TGIU. Det er nettopp der feilene og reklamasjonene oppstår. Neste punkt (skjermen for badet) kan heller ikke vise TG-forslag før reglene finnes.

Svaret fra Ståle 10.11.2026 (spørsmål 59a) er i tillegg lest på ulike måter (T-0003). Det må bli én tydelig regel før noe bygges.

## KI i bunnen
- **KI setter aldri TG.** TG-forslag kommer bare fra regelmotoren (CLAUDE.md regel 14, ADR 0006). Regelmotoren kaller aldri KI, og regelsvarene går ikke gjennom KI.
- **Ingen KI-kall i denne oppgaven**, og ingenting legges til i `src/core/ai`.
- **Data som lagres for KI senere:** hvert regelsvar har regelkoden, tilstanden (`triggered` / `not_triggered` / `not_evaluated`), forslaget (utfallskode eller TGIU), punktet det gjelder og en strukturert begrunnelse: alder i år, årstallet som ble brukt og hvor det kom fra (sjiktets årstall / våtrommets byggeår), kilden for alderen (`build_year_source`), om dokumentasjon finnes, trinnet i levetidstabellen (kode) og målingen mot grensen (verdi, enhet, grense). Ingen fritekst og ingen persondata i begrunnelsen. Når skjermen og avvikene kommer, lagres dette sammen med `deviations.suggested_by_rule_id`, og KI kan bruke det til utkast til årsak og sammendrag (2a-2 «KI i veien»).
- Levetider og terskler får fast kode og `status` (`draft` / `approved`), så KI og PDF senere kan vise om et tall er godkjent av fagrådet.

## Tolkningen av svar 59a (T-0003), avgjort av agentene
Ståle 10.11.2026: «TG0 gis når vi ikke måler fukt, uavhengig av hvor gammelt badet er.» Lest sammen med forskriften (hulltaking ikke utført gir TGIU) og TG-vilkårene, betyr det: **når det er tatt hull og målt, og fukten ikke er forhøyet, gir alderen alene ikke TG2 på tilliggende konstruksjoner.** Tre tilfeller, hvert med testsak:

| Hulltaking (`wet_room.hole_drilling`) | Måling | Regelens forslag på `wet_room.adjacent` |
|---|---|---|
| `done_no_findings` eller `done_with_findings` | Under grensen | Ingen forslag. Ingen regel gir TG2 på tilliggende på grunn av alder. Takstmannen setter TG selv. |
| `done_no_findings` eller `done_with_findings` | Lik eller over grensen | Utfallet «forhøyet fukt ved hulltaking» (`choose_tg2_tg3`, A207). Takstmannen velger TG2 eller TG3. |
| `not_done` (alle grunner, også `owner_refused`) | – | TGIU på punktet. |
| tomt | – | Ikke vurdert. |

Regelen foreslår aldri TG0 (TG0 er ikke et utfall). Om TG0 kan gis på tilliggende konstruksjoner i et eldre bad når TG-vilkårene sier 0–5 år med dokumentasjon, står fortsatt åpent for fagrådet (spørsmål 72); det påvirker ikke reglene, bare hva takstmannen velger selv. Planlinjen skrives om til «målt uten forhøyet fukt», og svaret som anbefalte TG1 i `svar-claude-pa-vegne-av-stale-2026-11-10.md` merkes som erstattet av Ståles svar. Føres som beslutning i `docs/09-apne-sporsmal.md` (**lett å endre**: bare regeldata og testsaker).

## Brukerhistorier
- Som **takstmann** vil jeg **få et TG-forslag med begrunnelse når membranen er over levetiden, er fra før 2000, terskelen er for lav eller fukten er over grensen** slik at **jeg ikke glemmer noe og vurderer likt hver gang**.
- Som **takstmann** vil jeg **få forslag om TGIU når hull ikke er tatt** slik at **badet ikke får en TG som ikke er undersøkt**.
- Som **fagansvarlig (Ståle)** vil jeg **se levetidene, grensene og reglene som data merket «utkast»** slik at **fagrådet kan godkjenne dem før ekte bruk**.

## Omfang
**Med:**
1. **Regelmotoren i `src/core/rules`** som ren TypeScript uten database, server eller nettleser-API, slik at samme kode kjører på iPaden og på serveren (som prøve E, `docs/funksjoner/fase1-prove-e-regler.md`). Én inngang, for eksempel `evaluateRules({ document, answers, lifespans, thresholds })`, som gir ett svar per aktiv regel: `triggered` / `not_triggered` / `not_evaluated`, forslaget og begrunnelsen. Bare formålene `suggest_outcome` og `suggest_tgiu` kjøres nå. Bare betingelsestypene badet trenger: `option_selected`, `number_vs_limit` (fast verdi eller `threshold_key`), `age_vs_lifespan`, `build_year` og `field_filled`, med grupper og `match` (`all` / `any`). Andre typer gir `not_evaluated`, aldri en stille «slår ikke til».
   - **Tomt eller ugyldig felt gir `not_evaluated`** (T-0015). Verdi lik grensen regnes som nådd (svar 13c i `svar-claude-pa-vegne-av-stale-2026-11-10.md`).
   - **TG-forslag bare fra systemmalen for tilstandsrapport** (domenemodellen 4.5, beslutning 27.10.2026): motoren kjører ikke `suggest_outcome` eller `suggest_tgiu` fra en egen mal.
   - En lint-regel eller test viser at `src/core/rules` ikke importerer database, `server-only`, Node-moduler eller `src/core/ai`.
2. **Levetider med trinn** som data i `src/core/rules/data/lifespans.ts` (tallverdier som fakta fra NS 3600:2025 tillegg C, se `regelverk-krav.md`, «Aldersvilkår»). Én rad per trinn med fast kode, `material_code` (samme koder som valgene for `wet_room.membrane_type`), `documentation` (`with` / `without` / `any`), `min_age` eller `to_year`, `outcome_kind` (`tg2` / `tg3`), `source_ref` og `status = draft`. Med: de åtte membrantypene (smøremembran 22/15, folie 25/18, banemembran 30/20, membranplater 22/15, baderomskabin 20/15, baderomspanel 20/10, våtromstapet/maling 7, våtromsvinyl 20) og trinnet «vanntett sjikt fra før 2000 gir TG3» (`any`). `unknown` har ingen rad og gir `not_evaluated`.
   - **Passer flere trinn, vinner det strengeste.** Et sjikt fra 1990 får bare forslaget om TG3 (før 2000), ikke i tillegg TG2 for alder.
   - Alder regnes fra `wet_room.membrane_year`, ellers `wet_room.build_year`, ellers `not_evaluated`. Kilden for årstallet og `wet_room.build_year_source` står i begrunnelsen.
   - «Med dokumentasjon» betyr at `wet_room.documentation_type` er noe annet enn `none`. Tomt felt gir trinnene for «uten dokumentasjon» (forsiktig side), og begrunnelsen sier at dokumentasjon ikke er oppgitt.
   - Alder regnes mot befaringsåret, som tas inn som argument (ikke dagens dato inne i motoren), så testsakene er stabile.
3. **Terskler** som data i `src/core/rules/data/thresholds.ts`, med fast kode, enhet, verdi, retning, `source_ref` og `status = draft`:
   - `wet_room_threshold_height_mm`: 25 mm fra slukrist til membran ved terskel (A211, `kartlegging-bad.md`). Under grensen gir forslag.
   - `wet_room_hole_moisture_weight_percent`: **én målegrense for fukt** i vekt-% i treverk ved hulltaking. Fagansvarlig foreslår tallet med kilde (Byggforsk der standarden ikke har tall, svar 13a) i forhåndsvurderingen. Spørsmål 71 er åpent, så tallet føres som beslutning (**lett å endre**). Måling i RF % gir `not_evaluated` (bare én grense nå).
4. **Fem regler i badmalen** (`rules`, `rule_conditions`, `rule_test_cases` i `wet-room.ts`), alle med `source_ref` og `message` (egne ord, ingen gjetteord, ingen henvisning til standard i teksten):
   | Kode | Formål | Når | Forslag |
   |---|---|---|---|
   | `wet_room.membrane_past_lifespan` | `suggest_outcome` | Trinnet for alder gir `tg2` | Nytt spørsmål `wet_room.membrane_drain.membrane_past_lifespan` med utfall `tg2` og korte utkasttekster (`text_status = draft`). Tiltaket er normalt nærmere undersøkelse og oppfølging. |
   | `wet_room.membrane_before_2000` | `suggest_outcome` | Trinnet «før 2000» slår til | `wet_room.membrane_drain.membrane_before_2000` (`tg3`, finnes) |
   | `wet_room.low_threshold_height` | `suggest_outcome` | `wet_room.threshold_height_mm` under terskelen | `wet_room.membrane_drain.low_threshold_height` (`choose_tg2_tg3`, finnes) |
   | `wet_room.hole_moisture_over_limit` | `suggest_outcome` | Hull tatt og målt i vekt-%, lik eller over grensen | `wet_room.adjacent.elevated_moisture` (`choose_tg2_tg3`, finnes) |
   | `wet_room.hole_drilling_not_done` | `suggest_tgiu` | `wet_room.hole_drilling = not_done` | TGIU på `wet_room.adjacent` |
   Regelen og utfallet står alltid på samme kontrollpunkt (T-0014).
5. **Testsaker per regel i malen**, minst: slår til, slår ikke til, ikke vurdert (tomt felt), verdi lik grensen, og for alder: med og uten dokumentasjon og ukjent membrantype. For 59a: de tre tilfellene i tabellen over, også gammelt bad (1985) med hull tatt uten forhøyet fukt, der ingen regel gir forslag på tilliggende. For «før 2000»: bad fra 1990 med ny membran fra 2015 gir ikke TG3. Testsakene kjøres av motoren i Vitest (malfilens test), og alle må bestå.
6. **Datamodellen for regler** (A147 løses nå for det som trengs), én migrering `0029_regler-bad` (sjekk før merge at ingen annen branch har tatt 0029):
   - `rule_conditions`: `threshold_key`, `age_year_element_key`, `age_fallback_year_element_key` (eller tilsvarende, arkitekten avgjør), `age_source_element_key`, `documentation_element_key`, `material_element_key`, med samme format-CHECK som `element_key`.
   - `rule_test_cases`: tredje svar «ikke vurdert» (T-0015), for eksempel `expected_state` (`triggered` / `not_triggered` / `not_evaluated`) som erstatter `expect_triggered` i dokumentformatet; arkitekten avgjør formen uten å bryte eksisterende rader. Testsakene får også befaringsåret som input.
   - Med i `schemas.ts`, `getTemplateVersion`, kopien i `createDraftVersion` og tellingen «endret».
   - `last_result` og `last_run_at` venter fortsatt (kontrollen før publisering, 2a-3).
7. **Små kontroller i malmotoren** (del av T-0014, rene funksjoner i `document.ts` med egne tester, kjøres i `saveDraftContent`): en `suggest_outcome`-regel må ha `suggested_outcome`, regelen og utfallet må høre til samme kontrollpunkt, og en TG-regel må ha minst én betingelse som ikke er `always`. Norske feilmeldinger.
8. **Små funn fra PR #159 som hører til reglene:** navnene på valgene for `wet_room.building_code` overlapper i 2010 («1997–2010» og «TEK10»). Bare navnene rettes (for eksempel «1997 til TEK10» og «TEK10»); kodene står (regel 6). Seed lager ny publisert versjon av badmalen når innholdet er endret (finnes fra PR #159).
9. **Testlagsfunn:** T-0003 settes til «rettet» med PR-nummeret, T-0015 til «rettet», T-0014 til «delvis rettet» (punkt 1 og 5 står til 2a-3 hvis de ikke rekkes; si hvilke).
10. **Dokumentasjon:** domenemodellen 4.5 (nye kolonner, at levetider og terskler er kodedata nå og blir tabeller i 2a-3 med samme koder), ordlisten (`evaluateRules`, regelsvar, levetidstrinn, terskelkode, `not_evaluated`), planlinjen for 59a og én linje i `docs/plan/endringslogg.md`, beslutninger fra A214 i `docs/09-apne-sporsmal.md`, `package.json` 0.6.6 → 0.7.0.

**Ikke med (bevisst utelatt):**
- **Skjerm** for badet, avvikskort, TGIU-feltene og visning av TG-forslag (neste punkt «Badet på PC»). Ingen lagring av regelsvar i rapporten ennå.
- **Levetider, terskler og kostnadsintervaller som databasetabeller** og redigering av dem (2a-3). Nå er de kodedata med fast kode.
- Levetider for andre bygningsdeler enn vanntett sjikt i våtrom (rør, avløp, tak osv.), og regler for andre rom (2a-3).
- Fallgrense og gulvskjevhet som regel: grensene er ikke avklart (tillegg A er åpent, R8 i sidemannskontrollen).
- Formålene `show` og `validate`, og de andre betingelsestypene (snødekke, bygningstype, TG på annet punkt, bilde mangler, TGIU satt, romtype, under terreng). 2a-3.
- At publisering av en malversjon stoppes når en testsak feiler, og `last_result`/`last_run_at` (kontrollen før publisering, 2a-3). Nå sikres det av testen på malfilen.
- Informasjonstekst ut fra byggeår, loft, krypkjeller og radon (2a-3).
- Godkjenning av levetider og terskler (fagrådet, Ståle). Ingen `verified_by`.
- De andre små funnene fra PR #159 (`{sted}` i tekstene, to måleverdier i fallteksten, kopisjekk av `data/*.csv`, doble seed-tester, telleverket i `wet-room.ts`, omskriving av to spørsmål). De tas med skjermen for badet, der tekstene vises.
- KI-kall og nye KI-funksjoner.

## Tilgang
Ingen ny tilgang og ingen nye spørringer. Regelmotoren er en ren funksjon uten database. Reglene lagres med malen og følger malmotorens tilgang (`template.edit_structure` for å endre, `organization.read` for å lese). Nye kolonner ligger i tabeller som allerede er tenant-isolert.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja (med malen) | nei |
| kontor | ja | nei |
| leder | ja | nei, uten `template.edit_structure` |
| admin | ja | ja (alltid) |

## Data
- **Endret:** `rule_conditions` (kolonnene for terskel og alder), `rule_test_cases` (tredje svar). Migrering `0029_regler-bad`. Ingen nye tabeller, så `tests/tenant-tables.ts` er uendret.
- **Nytt (kodedata, ikke tabeller):** `src/core/rules/data/lifespans.ts` og `thresholds.ts` med faste koder og `status = draft`.
- **Faste koder som tas i bruk:** de fem regelkodene, spørsmålet `wet_room.membrane_drain.membrane_past_lifespan` med utfallet `tg2`, terskelkodene `wet_room_threshold_height_mm` og `wet_room_hole_moisture_weight_percent`, og kodene på levetidstrinnene. De endres aldri etter merge (regel 6); `key_snapshot` i malens test utvides.

## Skjermer
Ingen.

## Regler
Se Omfang 4 og 5. Reglene er data i badmalen med testsaker, og kjøres av én motor i `src/core/rules`.

## Akseptkriterier
- [ ] `evaluateRules` er en ren funksjon i `src/core/rules`, uten database-, server-, Node- eller KI-importer (test eller lint).
- [ ] Hver av de fem reglene har testsaker for slår til, slår ikke til og ikke vurdert, og verdi lik grensen der det er en grense. Alle består.
- [ ] Svar 59a: gammelt bad med hull tatt uten forhøyet fukt gir ingen forslag på tilliggende; fukt lik eller over grensen gir `choose_tg2_tg3`; `not_done` med hver av de fire grunnene gir TGIU; tomt gir ikke vurdert.
- [ ] Sjikt fra 1990 gir bare TG3-forslaget, ikke TG2 i tillegg. Bad fra 1990 med membran fra 2015 gir ikke TG3.
- [ ] Folie 18 år uten dokumentasjon gir TG2; folie 18 år med dokumentasjon gir det ikke; ukjent membrantype og manglende årstall gir ikke vurdert. Begrunnelsen viser hvilket årstall og hvilken kilde som ble brukt.
- [ ] Ingen regel foreslår TG0, og ingen regel kaller KI.
- [ ] Levetider og terskler har `status = draft` og `source_ref` (test).
- [ ] Kontrollene i Omfang 7 avviser feil mal med norsk melding (test på dokument laget for å feile), og badmalen består.
- [ ] Migreringen: nye kolonner har format-CHECK, eksisterende testsaker beholder sin betydning. Lagring, lesing og kopi til nytt utkast tar med de nye feltene.
- [ ] Bruker i annen organisasjon får ikke tilgang: ingen nye spørringer; eksisterende `expectTenantIsolation` for malmotoren dekker de nye kolonnene (test-leder bekrefter).
- [ ] Virker på iPad-størrelse: ingen skjerm i denne oppgaven. At motoren kjører i nettleseren, vises ved at modulen ikke har server-importer (prøve E har vist mønsteret).
- [ ] KI-forslag: ingen i denne oppgaven.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` og `pnpm test:e2e` er grønne.

## Åpne spørsmål
- Spørsmål 71 (fuktgrensen) og 72 (TG0 på tilliggende i eldre bad) står åpne for fagrådet. Reglene bygges med agentenes valg, merket utkast, og føres som beslutninger (lett å endre).

## Roller
forenkler, arkitekt, fagansvarlig, ki-ansvarlig, test-leder, utvikler, testskriver. Ikke ux, ui-designer eller sikkerhet-personvern: ingen skjerm, ingen nye spørringer, ingen persondata.
