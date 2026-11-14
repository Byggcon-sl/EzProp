# Funksjon: Badet på PC

- **Fase:** 2a-2 Hele veien først, punkt 3 («Badet på PC»)
- **Modul:** kjerne (ny `src/core/reports`: rapporten, svar, kontrollpunkt, avvik, tiltak, TGIU og beslutninger om regelforslag), malmotoren (`src/core/templates`, bare lesing), regelmotoren (`src/core/rules`, bare kall), badmalen (`src/db/seed/templates/wet-room.ts`, småfunn), skjerm under `src/app/(ansatt)/oppdrag/[id]/`
- **Branch:** `badet-pc` (bygger på `main`, 6e5d25f)
- **Status:** utkast til forhåndsvurdering (arkitekt, ux, ui, fagansvarlig, sikkerhet-personvern, test-leder)
- **Dato:** 14.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** våtrom gir flest reklamasjoner. Skjermen tvinger fram strukturen forskriften krever (TG, årsak, konsekvens, tiltak, kostnad per avvik, og TGIU med begrunnelse på punktet), og reglene foreslår TG og TGIU likt hver gang. Takstmannen ser motstrid (T-0059) før rapporten går ut.
  - **De ansatte:** ett skjermbilde for hele badet med fremdrift, faste avvikstekster å starte fra, og TG-forslag med begrunnelse. Lagring per felt, så ingenting går tapt og ingen «Lagre»-knapp må huskes.
  - **KI i bunnen:** alt lagres som strukturerte data med faste koder (punkt, spørsmål, utfall, kriterium, regelsvar og takstmannens beslutning). Det er grunnlaget KI bruker i neste punkt («KI i veien»: frasebank, språkvask, sammendrag).

## Problem
Badmalen (PR #159) og reglene (PR #167) finnes bare som data. Ingen kan fylle ut et bad, og datamodellen for rapporten (`reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`) finnes ikke. Uten dette kan verken KI-forslagene, publiseringssperren eller PDF-en i 2a-2 bygges, og Ståle kan ikke se fag og utseende tidlig. Lar vi være, stopper hele den smale veien.

## KI i bunnen
- **KI setter aldri TG.** TG- og TGIU-forslag kommer bare fra regelmotoren (`evaluateRules`), aldri fra KI (CLAUDE.md regel 14, ADR 0006, ADR 0009). Ingen KI-kall i denne oppgaven, og ingenting nytt i `src/core/ai`.
- **Data som lagres for KI fra første dag:**
  - Hvert avvik har faste koder: kontrollpunkt, spørsmål, utfall, `kind`, `tg`, `cause_criterion`, kostnadstype og intervallkode, og om teksten er standardtekst fra malen eller endret (`text_source`: `template` / `edited` / `free`). Da kan KI senere lære hvilke standardtekster som endres mest.
  - **Beslutning om regelforslag** lagres som egen rad (se Data): regelkoden, forslaget (bare koder), begrunnelsen fra regelsvaret (bare koder og tall, med skjema), beslutningen (`accepted` / `changed` / `rejected`), begrunnelse når takstmannen går bort fra forslaget, hvem og når. Regelsvar er ikke KI, så de går ikke i `ai_usage_log`; men formatet er det samme mønsteret (forslag, beslutning, logg), slik at KI og statistikk kan lese begge.
  - `ai_usage_id` finnes på tekstfeltene i `field_answers` og `deviations` (tom nå), slik at «KI i veien» ikke krever ny migrering.
- **Ingen persondata** i regelsvar, beslutningslogg eller revisjonslogg (bare id-er og koder). Fritekst i avvikene behandles som persondata i loggene (logges aldri).

## Brukerhistorier
- Som **takstmann** vil jeg **åpne badet i oppdraget på PC og se alle kontrollpunktene med fremdrift** slik at **jeg vet hva som gjenstår**.
- Som **takstmann** vil jeg **legge til et avvik fra et avviksspørsmål og få standardteksten for avvik, årsak, konsekvens og tiltak ferdig utfylt** slik at **jeg bare retter det som er annerledes**.
- Som **takstmann** vil jeg **se TG-forslaget fra reglene med begrunnelse og godta, endre eller avvise det** slik at **jeg har siste ord, men ikke glemmer noe**.
- Som **takstmann** vil jeg **sette TGIU på et punkt og fylle ut hvorfor, risiko og hva som må til** slik at **rapporten er riktig når hull ikke er tatt**.
- Som **takstmann** vil jeg **velge kostnadsintervall eller skrive eget beløp og få advarsel hvis beløpet ikke er rundet** slik at **kostnaden er troverdig**.
- Som **leder** vil jeg **at hver beslutning om et regelforslag er logget** slik at **vi kan se hvorfor TG ble som den ble ved en reklamasjon**.

## Flyt
```
Oppdrag -> «Bygninger og rom» -> rom av typen våtrom -> [Fyll ut badet]
  (første gang: rapporten startes på publisert systemmal for tilstandsrapport, låst til versjonen)
-> Badet: venstre kolonne = kontrollpunktene med status (ikke startet / i arbeid / ferdig / TGIU / gjelder ikke)
   og fremdrift «3 av 8 ferdig»; høyre = valgt punkt
   -> felt for punktet (lagres per felt)
   -> regelforslag øverst på punktet: «Forslag fra reglene: TG3 – Vanntett sjikt fra før 2000» + begrunnelse
        [Godta] -> avvik lages fra utfallet med standardtekstene
        [Endre]  -> velg annen TG eller annet utfall, begrunnelse påkrevd
        [Avvis]  -> begrunnelse påkrevd
   -> avvikskort: TG (2/3, eller velg ved «velg TG2 eller TG3»), avvik, årsak (kriterium + tekst),
      konsekvens, tiltak (liste), kostnad (fem intervaller / eget beløp / ingen)
   -> eller TG0/TG1 direkte, eller TGIU med opplysningene, eller «gjelder ikke» med begrunnelse
   -> [Ferdig med punktet]
```
Trykk: fra åpnet punkt med regelforslag til ferdig avvik: 2 (Godta, Ferdig). I IVIT: velg punkt, velg TG, velg frase for avvik, årsak, konsekvens og tiltak hver for seg, velg kostnad (8–12 trykk, og TG må vurderes uten hjelp).

## Omfang
**Med:**
1. **Rapporten startes for oppdraget** (`reports`): én rapport per oppdrag med `report_type = condition_report`, låst til publisert versjon av systemmalen (`template_version_id`), `status = draft`. Startes første gang badet åpnes (ingen egen knapp). Rapporten kobles til eksisterende `report_buildings` og `rooms` uten å flytte dem (A94: `report_id` på bygningene tas når flere rapporter per oppdrag trengs; avgjøres av arkitekten, dyrt å endre). Hovedbefaringen (`inspections`, `kind = main`) lages ikke ennå; befaringsåret til reglene hentes fra oppdragets befaringstid, ellers dagens år, og det vises hvilket som er brukt.
2. **Datamodell** (én migrering, neste ledige nummer etter 0033; sjekk før merge), alle med `organization_id`, sammensatte fremmednøkler mot samme organisasjon, myk sletting og `row_version`:
   - `reports` (felt fra domenemodellen 4.7 som trengs nå: `assignment_id`, `template_version_id`, `report_type`, `ns_edition`, `status`, `responsible_employee_id`; resten venter).
   - `field_answers` (svar per felt med kobling til bygning, rom og kontrollpunkt, `repeat_index`, verdikolonnene som trengs: tekst, tall, valg, `ai_usage_id`).
   - `checkpoint_results` (`tg_direct` 0/1/IU, `tg_computed`, `not_applicable` + begrunnelse, `description_text`, `done`, `done_by`, `done_at`).
   - `deviations` (som 4.7, inkludert `suggested_by_rule_id`, `suggestion_status`, `suggestion_override_reason`, `measurement_value`, `measurement_unit`, `text_source`, `ai_usage_id`).
   - `deviation_measures`, `tgiu_details` (som 4.7).
   - `rule_suggestion_decisions` (ny, se Data).
   - Kostnadsintervallene som kodedata med faste koder (`src/core/reports/cost-bands.ts`, samme mønster som levetider og terskler i ADR 0009); `deviations.cost_band_key` i stedet for `cost_band_id` til tabellene kommer i 2a-3. Merket utkast.
   - Datamodellen følger ADR 0004 (versjon per felt), slik at iPaden i 2b kan bruke den uten ombygging. Om `field_clock` lages nå eller i 2b, avgjør arkitekten (dyrt å endre).
   - Alle nye tabeller føres i `tests/tenant-tables.ts`.
3. **TG-logikk i kjernen** (rene funksjoner, testet): `tg_computed` = høyeste TG blant avvikene, ellers `tg_direct`; ikke TGIU og TG2/TG3 samtidig (HMS er lov sammen med TGIU); TG2/TG3 bare via avvik; «velg TG2 eller TG3» må få valgt TG før avviket er gyldig; TG0 er aldri et utfall.
4. **Regelforslag på skjermen:** `evaluateRules` kjøres på serveren ved lagring av et felt som en regel leser, og i nettleseren for visning (samme kode). Svaret vises på riktig kontrollpunkt med begrunnelsen i klarspråk (koder gjøres om til norsk tekst i én oversettelsesfil). «Ikke vurdert» vises med hva som mangler («Fyll ut årstall for sjiktet»). Godta / Endre / Avvis med begrunnelse når takstmannen går bort fra forslaget. Et forslag som slutter å gjelde (feltet rettes), merkes «gjelder ikke lenger» og fjerner aldri et avvik takstmannen har godtatt; det vises som advarsel på punktet.
5. **Avvikskortet:** TG, avvik, årsak (kriterium som valg + tekst), konsekvens, tiltak (flere, rekkefølge, standardtiltak fra malen), kostnad (fem intervaller, eget beløp eller ingen) og valgfri kostnadstekst. Eget beløp som ikke er rundet til nærmeste 10 000 gir advarsel, aldri sperre (CLAUDE.md regel 12). Måleverdien fra fuktregelen følger med på avviket. Flettefeltene i standardtekstene (`{årstall}`, `{måleverdi}`, `{enhet}`) fylles fra svarene; et flettefelt uten verdi vises tydelig, aldri som `{…}` i teksten. Fritt avvik (uten spørsmål) er mulig.
6. **TGIU på punktet:** `tg_direct = IU` med `tgiu_details` (grunn, eier informert, annen kontroll og resultat, risikovurdering, utsatt konstruksjon, hva som må til). Manglende felt gir advarsel nå; sperren kommer med publisering (neste punkt).
7. **Fremdrift:** status per punkt og «x av 8 ferdig». «Ferdig» kan settes selv om noe mangler, men da vises hva som mangler (advarsel).
8. **Lagring per felt** med `row_version`: to faner som endrer samme felt gir «endret av andre» med nyeste verdi, ingen stille overskriving. Tydelige feilmeldinger på norsk, og feltet beholder teksten ved feil.
9. **Tilgang via `src/core/access`:** nye tillatelser `report.read` og `report.edit` (navn avgjøres av arkitekten), gitt til takstmann, leder og admin; kontor leser. `access.inspectors_edit_all` gjelder som for oppdraget. Hver spørring har `expectTenantIsolation`. Revisjonslogg for avvik, TG, TGIU og beslutninger (bare id-er og koder).
10. **Testlagsfunn som hører hit:**
    - **T-0051:** valget `unknown` i `wet_room.build_year_source` får teksten «Ukjent» (bare navnet, koden står). Byggeår på bygningen finnes ikke; føres i `docs/09-apne-sporsmal.md` som beslutning (lett å endre). Testsak for tilfellet.
    - **T-0059:** advarsel på punktet når hulltaking står «Utført uten funn» og målingen er lik eller over grensen, med forslag om å endre til «Utført med funn». Aldri sperre.
    - **T-0060:** utfall der takstmannen velger TG2 eller TG3 får to tiltakstekster (bør ved TG2, må ved TG3), og valgt TG avgjør hvilken som legges inn. Tekstene er utkast (`text_status = draft`). Hvordan det lagres i malen (for eksempel `applies_to_tg` på standardtiltaket), avgjør arkitekten.
    - Små funn fra PR #159 og #167 som gjelder tekst som nå vises: `{sted}` i avvikstekstene der det trengs, fallteksten med to måleverdier, meldingen på `membrane_before_2000` når byggeåret er brukt, årsaksteksten på `membrane_past_lifespan` («funksjonen er usikker på grunn av alder»), kilden på TGIU-regelen, `checkDocumentKeys` for de sju feltkodene på betingelsene, egen-nøkkel-sjekk i `context.answers`, rimelig årstall i `readYear`, og skjema for regelsvaret når det lagres.
11. **Universell utforming:** tastatur hele veien, fokus synlig, TG alltid med tekst (ikke bare farge, A246: TG-komponenten bygges her), skjermleser leser forslag og advarsler. PC først; iPad-størrelse (liggende og stående) skal virke i e2e, men befaringsvisningen for iPad er 2b.
12. **Dokumentasjon:** domenemodellen 4.7 (hva som er bygget, `rule_suggestion_decisions`, kostnadsintervall som kodedata), ordlisten, ADR for rapportens datamodell og regelforslag-loggen (dyrt å endre), `package.json` 0.11.8 → 0.12.0, beslutninger i `docs/09-apne-sporsmal.md`.

**Ikke med (bevisst utelatt):**
- **KI-forslag** (frasebank, språkvask, sammendrag): neste punkt «KI i veien».
- **Publiseringssperren** og overstyring: punktet «Publisering av badet». Nå gis bare advarsler.
- **PDF:** eget punkt med ADR for PDF-motor.
- **Befaringsvisning på iPad uten nett**, synk, `sync_conflicts` og konfliktvisning mellom enheter (2b). Skjermen virker i iPad-størrelse i nettleseren med nett.
- **Bilder** på punkt og avvik, markering og bildearkiv.
- **Andre rom og bygningsdeler** enn våtrom, og andre rapporttyper.
- **Befaringer** (`inspections`), tilstedeværende, dokumentasjonstabellen, egenerklæring, sammendrag per bygningsdel.
- **Byggeår på bygningen** og bruk av det i reglene (T-0051 får bare riktig tekst nå).
- **Kostnadsintervall som tabell** og redigering (2a-3, mal- og regeleditoren).
- Regler som legger inn tekst automatisk, vis/skjul-regler og nye betingelsestyper (2a-3).
- Sidemannskontroll, versjoner av rapporten, «Rettet», utgivelse.
- Flere rapporter per oppdrag.

## Tilgang
| Rolle | Se | Endre |
|---|---|---|
| takstmann | ja | ja (alle oppdrag så lenge `access.inspectors_edit_all` er på, ellers egne) |
| kontor | ja | nei |
| leder | ja | ja |
| admin | ja | ja (alltid, regel 11) |

Andre organisasjoner: verken rader eller tilgang (test per spørring). Spørringer filtrerer på `grant.organizationId`, aldri på id fra adressen. Rommet, malversjonen og oppdraget må høre til samme organisasjon (sammensatte fremmednøkler).

## Data
- **Nye tabeller:** `reports`, `field_answers`, `checkpoint_results`, `deviations`, `deviation_measures`, `tgiu_details`, `rule_suggestion_decisions`.
- **`rule_suggestion_decisions`** (forslag fra regler, ikke KI): `report_id`, `checkpoint_result_id`, `rule_key`, `suggestion` (jsonb med bare koder: `outcome` med punkt/spørsmål/utfall, eller `tgiu`), `reasons` (jsonb, regelsvarets begrunnelse med skjema), `lifespan_set_key`, `threshold_set_key`, `decision` (`accepted` / `changed` / `rejected`), `override_reason`, `deviation_id` (når et avvik ble laget), `decided_by`, `decided_at`. `deviations.suggested_by_rule_id` slås opp fra regelkoden i malversjonen.
- **Kodedata:** kostnadsintervallene (fem, faste koder, utkast).
- **Endret i malen:** navnet på valget `wet_room.build_year_source.unknown`, tiltak per TG for «velg TG2 eller TG3» (T-0060), tekstrettinger over. Ingen faste koder endres (regel 6); seed lager ny publisert versjon.
- **Faste koder som tas i bruk:** status- og beslutningskodene, `text_source`-kodene, intervallkodene. Endres aldri etter merge.

## Skjermer
- **PC (hoved):** `/oppdrag/[id]/rom/[roomId]` (endelig adresse avgjøres av ux). To kolonner: punktliste med status og fremdrift til venstre, valgt punkt til høyre. Hovedhandling per punkt: «Ferdig med punktet». Regelforslag øverst på punktet med Godta som hovedknapp.
- **iPad-størrelse:** samme skjerm, punktlisten som rullegardin eller fane i stående. Knapper minst 44 pt.
- Lenke «Fyll ut badet» på hvert våtrom i «Bygninger og rom».

## Regler
Ingen nye regler. De fire reglene fra PR #167 brukes som de er, med tekstrettingene over. Testsak for T-0051 (`unknown` uten årstall gir «ikke vurdert» med riktig tekst). Rene funksjoner for TG-logikken og kostnadsadvarselen har egne testsaker (37 500 gir advarsel, 40 000 ikke, 0 og negativt avvises).

## Akseptkriterier
- [ ] Et våtrom i et testoppdrag kan åpnes på PC; rapporten startes én gang, låst til publisert malversjon.
- [ ] Alle åtte kontrollpunkter vises med status og fremdrift; «Ferdig» med advarsel om hva som mangler.
- [ ] Felt lagres hver for seg; ved samtidig endring vises «endret av andre», ingen stille overskriving.
- [ ] Sjikt fra 1990 gir TG3-forslag med begrunnelse; Godta lager avviket med standardtekstene og logger `accepted`.
- [ ] Endre (annen TG eller utfall) og Avvis krever begrunnelse og logges som `changed` / `rejected`.
- [ ] Regler setter aldri TG selv: uten trykk fra takstmannen finnes ingen avvik og ingen TG (test).
- [ ] «Velg TG2 eller TG3» krever valgt TG; tiltaket blir «bør» ved TG2 og «må» ved TG3 (T-0060).
- [ ] Hulltaking ikke utført gir TGIU-forslag; TGIU kan ikke stå sammen med TG2/TG3; HMS kan.
- [ ] TGIU-opplysningene lagres; manglende felt gir advarsel.
- [ ] Eget beløp 37 500 gir advarsel, 40 000 ikke; de fem intervallene kan velges.
- [ ] «Utført uten funn» med fukt over grensen gir advarsel (T-0059).
- [ ] `tg_computed` er høyeste TG blant avvikene, ellers `tg_direct`.
- [ ] Flettefelt uten verdi vises aldri som `{…}`.
- [ ] Kontor ser, men kan ikke endre; admin kan alltid endre.
- [ ] Bruker i annen organisasjon får ikke tilgang (test per spørring, alle nye tabeller i `tests/tenant-tables.ts`).
- [ ] Revisjonsloggen og beslutningsloggen har ingen fritekst og ingen persondata.
- [ ] Virker på iPad-størrelse (e2e), tastatur og skjermleser (axe uten feil).
- [ ] Ingen KI-kall; ingen ny avhengighet uten begrunnelse.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` og `pnpm size` grønne.

## Åpne spørsmål
- Spørsmål 78 (a) og (b) til fagrådet står; agentene bygger advarsel (a) og bør/må (b) som utkast. Stopper ikke bygging.
- Arkitekten avgjør og fører som «dyrt å endre»: om bygninger og rom får `report_id` nå, `field_clock` nå eller i 2b, og navnene på tillatelsene.
