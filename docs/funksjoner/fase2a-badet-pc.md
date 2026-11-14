# Funksjon: Badet på PC

- **Fase:** 2a-2 Hele veien først, punkt 3 («Badet på PC»)
- **Modul:** kjerne (ny `src/core/reports`: rapporten, svar, kontrollpunkt, avvik, tiltak, TGIU og beslutninger om regelforslag; rene funksjoner i `src/core/reports/logic/`), malmotoren (`src/core/templates`, bare lesing), regelmotoren (`src/core/rules`, bare kall), badmalen (`src/db/seed/templates/wet-room.ts`, småfunn), skjerm under `src/app/(ansatt)/oppdrag/[id]/rom/[roomId]/`
- **Branch:** `badet-pc` (bygger på `main`, 6e5d25f)
- **Status:** godkjent etter forhåndsvurdering runde 1 (forenkler, arkitekt, ux, KI, fag, sikkerhet og personvern, test-leder). Rettet 14.11.2026; avgjørelser ved uenighet står under «Avgjort ved forhåndsvurderingen».
- **Dato:** 14.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** våtrom gir flest reklamasjoner. Skjermen tvinger fram strukturen forskriften krever (TG, årsak, konsekvens, tiltak, kostnad per avvik, og TGIU med begrunnelse på punktet), reglene foreslår TG, TGIU og TG0 likt hver gang, og hver beslutning om et forslag logges slik at vi kan forklare TG-en ved en reklamasjon. Takstmannen ser motstrid (T-0059, hulltaking ikke utført uten TGIU) før rapporten går ut.
  - **De ansatte:** ett skjermbilde for hele badet med fremdrift, faste avvikstekster å starte fra, TG-forslag med begrunnelse, to trykk fra forslag til ferdig avvik, lagring per felt uten «Lagre»-knapp og synlig lagrestatus.
  - **KI i bunnen:** alt lagres som strukturerte data med faste koder (punkt, spørsmål, utfall, kriterium, regelsvar og takstmannens beslutning), og tekstfeltene har plass til KI-merket og `ai_usage_id`, slik at «KI i veien» (neste punkt) ikke krever ny migrering eller ombygging.

## Problem
Badmalen (PR #159) og reglene (PR #167, #174) finnes bare som data. Ingen kan fylle ut et bad, og datamodellen for rapporten (`reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`) finnes ikke. Uten dette kan verken KI-forslagene, publiseringssperren eller PDF-en i 2a-2 bygges. Lar vi være, stopper hele den smale veien.

## KI i bunnen
- **Ingen KI-kall i denne oppgaven, og det er riktig.** TG-, TGIU- og TG0-forslag kommer bare fra regelmotoren (`evaluateRules`), aldri fra KI (CLAUDE.md regel 14, ADR 0006, ADR 0009). Regelsvar er ikke KI og går ikke gjennom `src/core/ai` eller i `ai_usage_log`. Statisk test: `src/core/reports` importerer ikke `src/core/ai`.
- **Data som lagres for KI fra første dag:**
  - Hvert avvik har faste koder: kontrollpunkt, spørsmål, utfall, `kind`, `tg`, `cause_criterion`, kostnadstype og intervallkode, og om teksten er standardtekst fra malen eller endret (`text_source`: `template` / `edited` / `free`).
  - **Beslutning om regelforslag** lagres som egen rad i `rule_suggestion_decisions` (se Data). Samme mønster som KI-forslag (forslag, beslutning, logg), men egne koder: regelforslag bruker `decision` = `accepted` / `changed` / `rejected`; KI-tekst bruker `ai_usage_log.status` = `suggested` / `accepted` / `edited` / `rejected`. `changed` betyr alltid regelforslag og `edited` alltid KI-tekst, slik at statistikken ikke blander dem (ordlisten).
- **Kroker for «KI i veien»** (tomme nå):
  - `ai_usage_id` på `field_answers` og `deviations` med sammensatt fremmednøkkel `(organization_id, ai_usage_id)` mot `ai_usage_log`. Settes og tømmes bare av serveren, ett sted i lagringen per felt i `src/core/reports`; kommer aldri fra klienten. Angre tømmer den.
  - `ai_usage_log.report_id` får sammensatt fremmednøkkel `(organization_id, report_id)` mot `reports` i samme migrering (A158), med test for tenant-isolasjon. Domenemodellen 4.12 rettes.
  - Faste koder for KI-mål (`AiTargetRef`): `type` = `deviation` med `fieldKey` `description` / `cause_text` / `consequence_text`; `deviation_measure` med `text`; `field_answer` med feltkoden; `checkpoint_result` med `description_text`. «answer» i domenemodellen rettes til `field_answer` (4.7 og 4.12, ordlisten).
  - Tekstfeltene i avvikskortet og beskrivelsen på punktet bygges som én felles byggekloss med plass for forslagsvisning og KI-merket (`AiTextMark`: bruk / behold / nytt forslag / angre), uten KI-knapp nå.
- **Ingen persondata** i regelsvar, beslutningslogg eller revisjonslogg: bare id-er, faste koder, TG og tall. `reasons` og `suggestion` har strengt Zod-skjema; test viser at fritekst utover skjemaet avvises.

## Brukerhistorier
- Som **takstmann** vil jeg **åpne badet i oppdraget på PC og se alle kontrollpunktene med fremdrift** slik at **jeg vet hva som gjenstår**.
- Som **takstmann** vil jeg **legge til et avvik fra et avviksspørsmål og få standardteksten for avvik, årsak, konsekvens og tiltak ferdig utfylt** slik at **jeg bare retter det som er annerledes**.
- Som **takstmann** vil jeg **se forslaget fra reglene med begrunnelse og godta, endre eller avvise det** slik at **jeg har siste ord, men ikke glemmer noe**.
- Som **takstmann** vil jeg **sette TGIU på et punkt og fylle ut hvorfor, risiko og hva som må til** slik at **rapporten er riktig når hull ikke er tatt**.
- Som **takstmann** vil jeg **velge kostnadsintervall eller skrive eget beløp og få advarsel hvis beløpet ikke er rundet** slik at **kostnaden er troverdig**.
- Som **leder** vil jeg **at hver beslutning om et regelforslag er logget** slik at **vi kan se hvorfor TG ble som den ble ved en reklamasjon**.

## Flyt (PC)
```
Oppdrag -> «Bygninger og rom» -> våtrom -> [Fyll ut badet]
  (har den ansatte report.edit og rapporten ikke finnes: rapporten startes i en egen serverhandling,
   låst til publisert systemmal for tilstandsrapport. Kontor ser «Rapporten er ikke startet».)
-> /oppdrag/[id]/rom/[roomId]?punkt=<key>
   venstre: 8 punkter med status og TG som tekst («TG3», «TGIU»), merket «Forslag gjelder ikke lenger»,
            og «3 av 8 ferdig»
   høyre: valgt punkt
     felt for punktet (lagres per felt; serveren kjører reglene og sender forslagene tilbake)
     [regelforslag: «Forslag fra reglene: TG3 – …» + begrunnelse]
        [Godta] (hovedknapp)   [Endre]   ...avstand...   [Avvis] (sekundær)
     ellers: [TG0] [TG1] [TGIU] [+ Avvik]
     avvikskort -> [Ferdig med punktet] -> neste punkt som ikke er ferdig åpnes selv, fokus på overskriften
```
Trykk per avvik: med regelforslag 2 (Godta, Ferdig); 3 når TG må velges («TG2 eller TG3»); 4 med kostnadsintervall. Uten forslag 4–5 (+ Avvik, utfall, TG ved behov, kostnad, Ferdig). I IVIT 8–12, og TG må vurderes uten hjelp. Anslag (ikke måling): rundt 15 minutter per bad med 2–3 avvik i IVIT, rundt 7–9 i EzProp; kan måles på `/statistikk/tid`.

## Omfang
**Med:**
1. **Rapporten startes for oppdraget** (`reports`): `report_type = condition_report`, låst til publisert versjon av systemmalen (`template_version_id`), `status = draft`. Startes i en egen serverhandling som krever `report.edit`, aldri av en lesing. Tåler to samtidige kall: delvis unik indeks `reports (organization_id, assignment_id) where deleted_at is null and status <> 'superseded'` og `on conflict do nothing`. Finnes ingen publisert systemmal for tilstandsrapport i organisasjonen, gis tydelig feilmelding. En rapport som er startet, blir låst til sin versjon også når en ny malversjon publiseres. Bygninger og rom får **ikke** `report_id` nå (A94); tjenesten sjekker at rommet hører til rapportens oppdrag. Hovedbefaringen (`inspections`) lages ikke ennå. **Befaringsåret** til reglene er oppdragets befaringstid, ellers dagens år regnet i norsk tid på serveren; året sendes inn som argument, står i regelsvaret som lagres, og det vises på skjermen hvilket som er brukt.
2. **Datamodell** (én migrering, neste ledige nummer etter 0033; sjekk mot `testdata-arbeidshverdag` og andre åpne brancher før merge). Alle tabeller har `organization_id`, sammensatte fremmednøkler mot samme organisasjon, myk sletting (`deleted_at`, ingen `ON DELETE CASCADE`), `row_version` og indeks `(organization_id, report_id)` på barnetabellene. Alle sju føres i `tests/tenant-tables.ts`.
   - `reports`: `assignment_id`, `template_version_id`, `report_type`, `status`. (`ns_edition` kommer med «NS-utgave i rapporten» i 2a-3; ansvarlig hentes fra oppdraget.)
   - `field_answers`: rapport, felt, bygning, rom, kontrollpunkt, `repeat_index`, verdikolonnene som trengs (tekst, tall, valg), `ai_usage_id`. Unik også med tomme kolonner (`nulls not distinct` eller uttrykksindeks, delvis på `deleted_at is null`). Fast form for romfelt: `room_id` satt, `report_building_id` og `checkpoint_result_id` tomme, `repeat_index = 0`. Feltet må høre til rapportens låste malversjon; ukjente eller arkiverte feltkoder avvises.
   - `checkpoint_results`: rapport, punkt, bygning/rom (unik på samme måte), `tg_direct` (CHECK i 0, 1, IU), `description_text`, `done`, `done_by`, `done_at`. **`tg_computed` lagres ikke:** den regnes av den rene funksjonen når den leses (én sannhet, kan ikke bli feil).
   - `deviations`: som 4.7, med `kind`, `tg` (CHECK 2/3, tom for `hms`), `cause_criterion`, tekstene, `cost_type` (`band` / `approx` / `none`), `cost_band_key` (varig fast kode), `cost_amount`, `cost_text`, `measurement_value`, `measurement_unit`, `text_source`, `suggested_by_rule_id`, `ai_usage_id`. CHECK: `band` krever kode, `approx` krever beløp over 0, `none` ingen av delene. **Ikke** `suggestion_status` eller `suggestion_override_reason`: beslutningstabellen er fasit.
   - `deviation_measures` (rekkefølge, tekst, `text_source`) og `tgiu_details` (én per kontrollpunkt, delvis unik indeks).
   - `rule_suggestion_decisions` (se Data). Bare tillegg: ny beslutning er ny rad, aldri oppdatering.
   - `standard_measures.applies_to_tg` i malens dokumentformat (heltall, tom = begge, CHECK 2 eller 3); `checkDocument` tillater verdi bare på utfall av typen `choose_tg2_tg3` (T-0060).
   - Kostnadsintervallene som kodedata i `src/core/reports/logic/cost-bands.ts`: fem faste koder med grensene under 20 000, 20 000–100 000, 100 000–200 000, 200 000–500 000 og over 500 000; etikettene med egne ord, merket utkast.
   - `decided_by`, `done_by` er ansatt-id med sammensatt fremmednøkkel. CHECK på `decision`, `text_source`, `cost_type`, og `jsonb_typeof` på `suggestion` og `reasons`.
   - Id-er på nye rader (avvik, tiltak, svar) lages i nettleseren som UUID v7 og sendes inn; `organization_id` alltid fra grant.
   - **Ikke nå:** `field_clock` og `text_crdt` (2b, nye kolonner som kan være tomme), `report_id` på bygninger og rom, `not_applicable` («gjelder ikke», 2a-3).
3. **Rene funksjoner i `src/core/reports/logic/`** (rent blad: bare egen mappe, `@/shared`, `@/core/rules` og `import type`; lint-regel som for regelmotoren). Klientkomponenter importerer bare herfra, aldri fra indeksen som drar med databasen. Innhold: TG-logikk, kostnadsadvarsel, flettefelt, intervallene, tiltak per TG, advarslene på punktet og oversettelsen av koder til norsk. TG-logikken kjøres bare for `system` + `condition_report` (regel 5).
   - `tg_computed` = høyeste TG blant avvikene som ikke er slettet, ellers `tg_direct`. TG2/TG3 bare via avvik. TG0 er aldri et utfall. «Velg TG2 eller TG3» er ugyldig uten valgt TG.
   - TGIU kan ikke stå sammen med TG2/TG3; HMS kan.
   - **Bytte mellom direkte TG og avvik:** får et punkt med TG0 eller TG1 et avvik med TG, gjelder avviket og `tg_direct` tømmes. Har punktet TGIU og takstmannen legger til eller godtar et avvik med TG2/TG3, må han velge aktivt (fjerne TGIU eller la være); TGIU overskrives aldri stille. Fjernet TGIU slettes mykt.
4. **Regelforslag:** `evaluateRules` kjøres **bare på serveren** når et felt som en regel leser, lagres; svaret sendes tilbake og vises på riktig kontrollpunkt med begrunnelsen i klarspråk (én oversettelsesfil). Alle tre forslagstypene håndteres: `outcome` (avvik), `tgiu` og `tg0`. «Ikke vurdert» vises med hva som mangler («Fyll ut årstall for sjiktet»).
   - **Godta:** `outcome` lager avviket med standardtekstene fra den låste malversjonen (`text_source = template`); `tgiu` gir `tg_direct = IU`; `tg0` gir `tg_direct = 0`. Alle gir beslutningsrad `accepted`.
   - **Endre** (annen TG eller annet utfall) og **Avvis** krever begrunnelse og gir `changed` / `rejected`. Skjer på samme flate, ikke i nytt vindu.
   - **Serveren stoler aldri på klientens forslag:** klienten sender bare regelkode, beslutning, valgt TG/utfall og begrunnelse. Serveren kjører reglene på lagrede svar og lagrer sitt eget regelsvar (`suggestion`, `reasons`, settkodene, befaringsåret). Har regelen ikke slått til på serveren, avvises beslutningen med «Forslaget gjelder ikke lenger». Forfalsket forslag eller ukjent `rule_key` avvises.
   - Et forslag som slutter å gjelde (feltet rettes), regnes ved visning (lagres ikke), merkes «gjelder ikke lenger», fjerner aldri et avvik takstmannen har godtatt, og vises som advarsel på punktet.
   - **Endre til annen TG enn utfallets:** tiltaket byttes etter `applies_to_tg` (bør/må) der malen har begge; ellers advarsel «Se over konsekvens og tiltak, teksten hører til TG3». Kostnad kreves ved TG3 (advarsel).
5. **Avvikskortet:** TG, avvik, årsak (kriterium som valg + tekst), konsekvens, tiltak (flere, rekkefølge, standardtiltak fra malen), kostnad (fem intervaller, eget beløp eller ingen) og valgfri kostnadstekst. Eget beløp rundes ikke av automatisk; ikke rundet til nærmeste 10 000 gir advarsel rett under feltet mens takstmannen skriver, aldri sperre eller dialog (regel 12). 0, negative tall og ikke-heltall avvises. Måleverdien fra fuktregelen følger med. Flettefeltene (`{årstall}`, `{måleverdi}`, `{enhet}`, `{sted}`) fylles fra svarene; uten verdi vises de tydelig som manglende, aldri som `{…}`. Avvik og tiltak kan fjernes (myk sletting). Tak på antall avvik og tiltak per punkt (50 og 20).
6. **TGIU på punktet:** `tg_direct = IU` med `tgiu_details`. Hvilke opplysninger som kreves, følger grunnen (fagansvarlig 14.11.2026):
   - Alle TGIU: hva som ikke er undersøkt og hvorfor, risiko, hva som må til.
   - I tillegg på tilliggende konstruksjoner (`wet_room.adjacent`): annen fuktkontroll og resultat, og skadeutsatt konstruksjon.
   - I tillegg når eier har nektet hulltaking: eier er informert om utvidet ansvar.
   - Manglende opplysning gir advarsel nå; sperren kommer med publisering.
7. **Fremdrift og advarsler:** status per punkt (ikke startet / i arbeid / ferdig / TGIU) og «x av 8 ferdig». Slettede rader telles ikke. «Ferdig med punktet» kan alltid trykkes; mangler vises som advarsel på punktet og i listen, uten bekreftelsesdialog, og neste punkt som ikke er ferdig åpnes. Advarslene (nå advarsel, sperre ved publisering der forskriften krever det):
   - Avvik med «velg TG2 eller TG3» uten valgt TG.
   - TG2 eller TG3 uten årsak, uten konsekvens eller uten tiltak (forskriften § 2-22).
   - TG3 uten kostnad («ingen» gir advarsel ved TG3).
   - HMS-avvik uten konsekvens eller tiltak.
   - TGIU-opplysning som mangler (punkt 6).
   - Hulltaking «ikke utført» og noe annet enn TGIU på `wet_room.adjacent` (den kjente IVIT-feilen; aldri sperre, begrunnelsen logges).
   - «Utført uten funn» med måling lik eller over grensen (T-0059), med forslag om å endre til «Utført med funn».
   - Forslag som ikke lenger gjelder.
8. **Lagring per felt:** skrivegrensesnittet er én endring per felt (tabell, rad-id, felt, ny verdi, verdien klienten så). Serveren sammenligner feltets nåverdi (`is not distinct from`); ulik verdi gir «Endret av andre» med nyeste verdi, ingen stille overskriving. To faner som endrer ulike felt på samme avvik gir ingen konflikt. `row_version` øker fortsatt. Formen er den samme som endringene i ADR 0004, slik at 2b kan bruke den. Lagrestatus er alltid synlig per felt og samlet i toppen («Lagret», «Lagrer …», «Ikke lagret – prøv igjen»; uten nett: «Uten nett – endringene dine er ikke lagret ennå»), med synk-tokenene, ikke TG-farger. Feltet beholder teksten ved feil, og lagringen prøves igjen når nettet er tilbake. Ingen rapportdata i localStorage eller IndexedDB (2b).
9. **Tilgang via `src/core/access`:** ingen nye rettigheter. Endring krever `report.edit` (finnes), lesing `organization.read`. `report.read` lages ikke. Hver serverhandling som skriver (start, svar, avvik, tiltak, beslutning, TGIU, ferdig) krever `report.edit` på serveren, ikke bare skjulte knapper. Hver lesing og skriving følger kjeden rom → etasje → bygning → oppdrag → rapport med `grant.organizationId` og `deleted_at is null` i alle ledd, sjekker at rommet er et våtrom og hører til rapportens oppdrag; ellers 404 (`AccessDeniedError`). `requireUuid` på id-er før Zod. Bare UUID i adressen. Nettleseren får bare maldokumentet og svarene for rommet, ikke parter eller adresse.
10. **Logg og personvern:** revisjonslogg for avvik, TG, TGIU og beslutninger med bare id-er, faste koder, feltkoder, TG og tall; aldri gammel og ny verdi for tekstfelt. Fritekst (inkludert `override_reason`) ligger bare i selve raden. Feilgrener logger aldri feltverdier eller databaseparametre. Alle fritekstfelt (avvik, årsak, konsekvens, tiltak, `cost_text`, `override_reason`, `description_text`, tekstfeltene i `tgiu_details`, tekstsvar) har lengdegrense og sperre mot fødselsnummer (elleve sifre), med felles mønster flyttet fra `src/core/orders/schemas.ts` til ett felles sted. Ingen tjeneste i `src/core/reports` kjører `delete` (test).
11. **Testlagsfunn og småfunn som hører hit:**
    - **T-0051:** valget `unknown` i `wet_room.build_year_source` får teksten «Ukjent» (bare navnet, koden står). Byggeår på bygningen finnes ikke; føres som beslutning (lett å endre). Testsak.
    - **T-0059:** advarselen i punkt 7. Aldri sperre.
    - **T-0060:** utfall av typen `choose_tg2_tg3` får to tiltakstekster via `applies_to_tg` (bør ved TG2, må ved TG3), valgt TG avgjør hvilken som legges inn. Tekstene er egne formuleringer, `text_status = draft`.
    - Små funn fra PR #159 og #167: `{sted}` i avvikstekstene der det trengs, fallteksten med to måleverdier, meldingen på `membrane_before_2000` når byggeåret er brukt, årsaksteksten på `membrane_past_lifespan`, kilden på TGIU-regelen, `checkDocumentKeys` for de sju feltkodene på betingelsene, egen-nøkkel-sjekk i `context.answers`, rimelig årstall i `readYear`, og skjema for regelsvaret når det lagres.
12. **Skjermen og universell utforming** (ux 14.11.2026):
    - Ingen nedtrekksmenyer (prinsipp 6): TG, årsakskriterium, kostnadsintervall og TGIU-valg er knapper eller radioknapper med tekst. Trykkflater minst 44 pt; Godta og Ferdig 56–72 pt. Avvis står ikke rett ved Godta.
    - iPad stående: knapp «Punkter (3 av 8)» som åpner hele listen som panel, og «Forrige punkt» / «Neste punkt» nederst (minst 56 pt).
    - Godta flytter fokus til det nye avvikskortet; skjermleseren leser «Avvik lagt til, TG3». Forslag og advarsler har `role="status"`/`aria-live`.
    - Endre: TG- og utfallsknapper og begrunnelsesfelt på samme flate; lagreknappen er sperret til begrunnelsen er fylt ut, og det står hvorfor.
    - TG alltid med tekst, ikke bare farge (A246: TG-komponenten bygges her). Tastatur hele veien, fokus synlig.
    - `source_ref` kan vises for takstmannen på skjermen, men flettes aldri inn i avvikstekst, årsak, konsekvens eller tiltak.
    - Lenke «Fyll ut badet» på hvert våtrom i «Bygninger og rom».
13. **Dokumentasjon:** ADR 0011 «Rapportens datamodell og logg for regelforslag» (sjekk nummeret mot åpne brancher) med dyrt å endre: beslutningstabellen som eneste fasit, serveren regner forslaget, skriveformen per felt, ingen `field_clock` og ingen `report_id` nå (med unik indeks i stedet), unike nøkler med tomme kolonner, rene funksjoner i `logic/`; og det forkastede (felt på avviket som fasit, `report_id` nå, `field_clock` nå, `row_version` per rad som konfliktsjekk, lagret `tg_computed`). Domenemodellen 4.7 og 4.12, ordlisten, `package.json` 0.11.8 → 0.12.0 (kolliderer med `testdata-arbeidshverdag`; den som merges sist, flytter), beslutningene i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- **KI-forslag** (frasebank, språkvask, sammendrag): neste punkt «KI i veien». Krokene står klare.
- **Fritt avvik uten spørsmål:** avvikskortet i 2a-3. Badets avvik kommer fra avviksspørsmålene i malen.
- **«Gjelder ikke» med begrunnelse:** står i 2a-3 (innspill D6). Badets åtte punkter gjelder alltid i et våtrom.
- **Reglene i nettleseren:** på PC med nett kjøres de på serveren ved lagring. Kjøring på enheten hører til 2b og «Regler uten treghet» i 2a-3. Regelmotoren er alt felles kode, så ingenting må bygges om.
- **Kontroll av vilkårene for TG0 direkte** (0–5 år, ingen avvik, dokumentasjon; ikke på `wet_room.adjacent`, F1), se `docs/kartlegging/regelverk-krav.md` 5.3 punkt 3. Bevisst utsatt: alder og dokumentasjon finnes ikke som data ennå. Tas med «i»-knappen og dokumentasjonstabellen i 2a-3.
- **Låste grader for dokumentasjon** som advarsel: venter på fagrådet (spørsmål 88).
- **Teamregelen** «takstmann endrer egne oppdrag når `access.inspectors_edit_all` er av»: egen oppgave i `src/core/access` for alle moduler (spørsmål 89).
- **Publiseringssperren** og overstyring: punktet «Publisering av badet». Nå gis bare advarsler.
- **PDF:** eget punkt med ADR for PDF-motor.
- **Befaringsvisning på iPad uten nett**, synk, `field_clock`, `sync_conflicts` og konfliktvisning mellom enheter (2b).
- **Bilder** på punkt og avvik, markering og bildearkiv.
- **Andre rom og bygningsdeler** enn våtrom, og andre rapporttyper.
- **Befaringer** (`inspections`), tilstedeværende, dokumentasjonstabellen, egenerklæring, NS-utgave, sammendrag per bygningsdel.
- **Byggeår på bygningen** og bruk av det i reglene.
- **Kostnadsintervall som tabell** og redigering (2a-3).
- Regler som legger inn tekst automatisk, vis/skjul-regler og nye betingelsestyper (2a-3).
- Sidemannskontroll, versjoner av rapporten, «Rettet», utgivelse. Flere rapporter per oppdrag.
- Oversikt eller telling per ansatt over beslutninger (spørsmål 90).

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | ja når `access.inspectors_edit_all` er på (standard); når den er av, bare med enkeltrettighet `report.edit`, som i dag |
| kontor | ja (skrivebeskyttet, «ikke startet» uten skriving) | nei, avvist på serveren for hver handling |
| leder | ja | ja |
| admin | ja | ja, alltid, også når innstillingen er av (regel 11) |

Andre organisasjoner: verken rader eller tilgang (`expectTenantIsolation` per spørring). Rom fra annet oppdrag i samme organisasjon gir 404. Spørringer filtrerer på `grant.organizationId`, aldri på id fra adressen. Rommet, malversjonen, oppdraget, ansatte og `ai_usage_log` må høre til samme organisasjon (sammensatte fremmednøkler, testet direkte mot databasen).

## Data
- **Nye tabeller:** `reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`, `rule_suggestion_decisions`.
- **`rule_suggestion_decisions`** (forslag fra regler, ikke KI, bare tillegg): `report_id`, `checkpoint_result_id`, `rule_key`, `suggestion` (jsonb, bare koder: `{kind: "outcome", checkpoint, question, outcome}`, `{kind: "tgiu", checkpoint}` eller `{kind: "tg0", checkpoint}`), `reasons` (jsonb, serverens regelsvar: bare faste koder og tall, ukjente nøkler avvises, øvre størrelse, med befaringsåret), `lifespan_set_key`, `threshold_set_key`, `decision` (`accepted` / `changed` / `rejected`), `chosen_tg`, `chosen_outcome_key`, `override_reason` (fritekst, påkrevd ved `changed` og `rejected`, bare i raden), `deviation_id` (når et avvik ble laget), `decided_by`, `decided_at`. `deviations.suggested_by_rule_id` slås opp fra regelkoden i den låste malversjonen.
- **Endret:** `ai_usage_log.report_id` får sammensatt fremmednøkkel. `standard_measures.applies_to_tg` i malformatet.
- **Kodedata:** kostnadsintervallene (fem faste koder, utkast).
- **Endret i malen:** navnet på `wet_room.build_year_source.unknown`, bør/må-tiltak for «velg TG2 eller TG3», tekstrettingene. Ingen faste koder endres (regel 6); seed lager ny publisert versjon.
- **Faste koder som tas i bruk:** status- og beslutningskodene, `suggestion.kind`, `text_source`, `cost_type`, intervallkodene, `AiTargetRef.type`-kodene. Endres aldri etter merge.

## Regler
Ingen nye regler. De fem reglene i malen brukes som de er: fire fra PR #167 og `wet_room.hole_no_elevated_moisture` (TG0-forslag på `wet_room.adjacent`, PR #174), med tekstrettingene over. Testsaker som data i `src/core/rules/test-cases.ts`:
- Sjikt 1990, folie uten dokumentasjon → ett forslag, TG3 (før 2000), ikke TG2 i tillegg.
- Folie uten dokumentasjon 2008, befaringsår 2026 → TG2-forslag (alder). 2009 → ikke forslag.
- Hull «ikke utført», grunn tom eller eier nektet → TGIU-forslag.
- Hull «uten funn» 14,9 vekt-% → TG0-forslag. 15 → forhøyet fukt (velg TG2 eller TG3), og T-0059-advarselen.
- `unknown` uten årstall → «ikke vurdert» med teksten «Ukjent» (T-0051).
- Samme svar med to måleverdier; `readYear` avviser urimelige årstall; egen-nøkkel-sjekk; `checkDocumentKeys` for de sju feltkodene.

## Akseptkriterier
- [ ] Et våtrom i et testoppdrag kan åpnes på PC; rapporten startes én gang av en med `report.edit`, også ved to samtidige kall, låst til publisert malversjon også etter at en ny versjon publiseres. Kontor ser «ikke startet» uten at noe skrives. Uten publisert systemmal: tydelig feilmelding.
- [ ] Alle åtte kontrollpunkter vises med status, TG som tekst og fremdrift «x av 8»; «Ferdig» viser advarslene i punkt 7 og åpner neste punkt som ikke er ferdig.
- [ ] Felt lagres hver for seg; samme felt endret i to faner gir «endret av andre» med nyeste verdi; ulike felt på samme avvik gir ingen konflikt.
- [ ] Lagringsfeil gir norsk feilmelding, feltet beholder teksten, og lagrestatusen vises.
- [ ] Sjikt fra 1990 gir TG3-forslag med begrunnelse; Godta lager avviket med standardtekstene (`text_source = template`) og logger `accepted`.
- [ ] Hulltaking ikke utført gir TGIU-forslag; Godta gir `tg_direct = IU` og beslutningsrad.
- [ ] Hull uten funn og 14,9 vekt-% gir TG0-forslag; Godta gir `tg_direct = 0` og beslutningsrad. 15 gir avviksforslaget forhøyet fukt.
- [ ] Endre og Avvis uten begrunnelse avvises; med begrunnelse logges `changed` / `rejected`. Ny beslutning er ny rad.
- [ ] Serveren regner forslaget selv: forfalsket forslag, ukjent `rule_key` eller forslag som ikke slår til på serveren avvises.
- [ ] Regler setter aldri TG selv: lagring av felt alene gir ingen avvik, ingen `tg_direct` og `tg_computed` = tom (test).
- [ ] Et forslag som ikke lenger gjelder, fjerner ikke et godtatt avvik og gir advarsel.
- [ ] «Velg TG2 eller TG3» krever valgt TG; tiltaket blir «bør» ved TG2 og «må» ved TG3 (T-0060); endret TG uten bør/må-tekst gir advarsel om å se over teksten.
- [ ] TGIU kan ikke stå sammen med TG2/TG3 uten aktivt valg; HMS kan. TG-avvik på punkt med TG0/TG1 tømmer `tg_direct`.
- [ ] TGIU-opplysningene lagres; advarsel om manglende opplysning følger grunnen (punkt 6), uten falske advarsler.
- [ ] Advarsler: TG2/TG3 uten årsak, konsekvens eller tiltak; TG3 uten kostnad; HMS uten konsekvens eller tiltak; hulltaking ikke utført og annet enn TGIU på tilliggende konstruksjoner; T-0059. Ingen av dem sperrer.
- [ ] Eget beløp 37 500 og 15 000 gir advarsel, 40 000 ikke; 0, negativt og ikke-heltall avvises; de fem intervallene kan velges.
- [ ] `tg_computed` er høyeste TG blant avvikene som ikke er slettet, ellers `tg_direct`.
- [ ] Avvik og tiltak slettes mykt; slettede vises ikke og telles ikke.
- [ ] Flettefelt uten verdi vises aldri som `{…}`.
- [ ] Tilgangsmatrise testet for takstmann, kontor, leder og admin med `access.inspectors_edit_all` på og av; kontor avvises på serveren for hver skrivende handling; admin kan alltid endre.
- [ ] Rom fra annen organisasjon, rom fra annet oppdrag i samme organisasjon og rom som ikke er våtrom gir 404. Sammensatte fremmednøkler avviser kobling på tvers av organisasjoner (test mot databasen).
- [ ] Unike nøkler holder med tomme kolonner (test for dubletter i `field_answers`, `checkpoint_results`, `tgiu_details`).
- [ ] Bruker i annen organisasjon får ikke tilgang (test per spørring; alle sju tabeller i `tests/tenant-tables.ts`; `ai_usage_log.report_id`).
- [ ] Revisjonslogg, beslutningslogg og applikasjonslogg har ingen fritekst og ingen persondata (fritekstmarkør-test); `reasons` med fritekst avvises; fødselsnummer i fritekst avvises.
- [ ] Ingen tjeneste i `src/core/reports` kjører `delete`; `src/core/reports` importerer ikke `src/core/ai`; ingen KI-kall.
- [ ] iPad-størrelse liggende og stående: hele flyten fra Godta til Ferdig, ingen vannrett rulling, knapper minst 44 px, ingen nedtrekksmenyer. Hele flyten med tastatur; axe uten feil; forslag og advarsler har `aria-live`.
- [ ] Gjetteord- og kopitesten dekker de nye tekstene (oversettelsesfilen, tiltakene, intervalletikettene).
- [ ] Ingen ny avhengighet. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` og `pnpm size` grønne. `/security-review` kjørt før PR.

## Testplan (test-leder 14.11.2026)
- **Enhet** (`src/core/reports/logic/`): TG-logikk, kostnad, flettefelt, tiltak per TG, advarslene, T-0059, oversettelsesfilen dekker alle koder i `reasons`, skjema for regelsvaret.
- **Regler:** testsakene under «Regler».
- **Integrasjon:** `expectTenantIsolation` per spørring, tilgangsmatrisen, idempotent start, konflikt per felt, Godta/Endre/Avvis for alle tre forslagstyper, forfalsket forslag, «regler setter aldri TG», myk sletting, TGIU-detaljer, logg uten fritekst, ingen `delete`, ingen KI.
- **E2e** (`e2e/fase-2a-badet-pc.spec.ts`): PC hovedflyt; Endre og Avvis; bør/må; TGIU og advarsel; kostnad 37 500 og intervall; lagringsfeil (`route.abort`); to faner; kontor skrivebeskyttet; iPad liggende og stående; tastatur og axe.

## Avgjort ved forhåndsvurderingen (prosjektlederen 14.11.2026)
- **Tilgang når innstillingen er av:** arkitekten (ingen egen regel i rapportkoden) framfor sikkerhet og test-leder (bygg «egne oppdrag»). Innstillingen står på (Ståle 27.10.2026), oppdragene har ikke regelen i dag, og en regel bare for rapporten gir ulik oppførsel. Teamregelen hører til `src/core/access` for alle moduler og føres som spørsmål 89. A319, lett å endre.
- **«Gjelder ikke» og fritt avvik** flyttes til 2a-3 (forenkler), selv om ux tegnet knappen: begge står i 2a-3, og badet trenger dem ikke for å gå hele veien. A315, lett å endre.
- **Reglene bare på serveren** (forenkler, arkitekt). A316, lett å endre.
- **`tg_computed` regnes ved lesing**, lagres ikke (forenkler). Kan legges til som kolonne senere uten å endre data. A317, lett å endre.
- **`ns_edition` og ansvarlig** lagres ikke på rapporten nå (forenkler). A318, lett å endre.
- **Beslutningstabellen er fasit, serveren regner forslaget, skriveform per felt, ingen `report_id`/`field_clock` nå** (arkitekt). A320–A322, dyrt å endre (ADR 0011).
- **TG0 direkte uten kontroll av vilkårene nå** (fagansvarlig ga valget). A323, lett å endre.
- **TGIU-opplysninger etter grunn, og advarsel (ikke sperre) ved hulltaking ikke utført** (fagansvarlig; spørsmål 88 til fagrådet). A324, lett å endre.
- **KI-målkoden `field_answer`** i stedet for «answer» (KI-ansvarlig). A325, dyrt å endre (fast kode).

## Åpne spørsmål
- Spørsmål 78 (a), (b) og (d) står; agentene bygger advarsel og bør/må som utkast.
- Spørsmål 88 (fag): låste grader for dokumentasjon i våtrom, sperre eller advarsel ved hulltaking ikke utført, TGIU-opplysninger på andre punkter. Agentene bygger advarsel.
- Spørsmål 89 (tilgang): teamregelen når `access.inspectors_edit_all` er av.
- Spørsmål 90 (personvern, før ekte data): hvem-og-når på beslutninger (arbeidsmiljøloven kap. 9), og grunnlag for DPIA og sikkerhetsgjennomgang.
