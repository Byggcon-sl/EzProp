# Funksjon: Publisering av badet

- **Fase:** 2a-2 Hele veien først, punktet «Publisering av badet»
- **Modul:** kjerne (`src/core/reports`: ny tjeneste for kontroll og publisering; rene funksjoner i `src/core/reports/logic/publish-check.ts`), skjerm under `src/app/(ansatt)/oppdrag/[id]/`
- **Branch:** `publisering-badet` (bygger på `main`, etter PR #224 og #227)
- **Status:** utkast
- **Dato:** 17.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** rapporten kan ikke gå ut med de våtromsmanglene forskriften krever (TG2/TG3 uten årsak og konsekvens, TG3 uten kostnad, våtrom uten hulltaking eller begrunnelse, punkt uten TG) uten at takstmannen aktivt har krysset bort sperren og skrevet hvorfor. Hver overstyring logges og kan vises ved en reklamasjon. Mangelen kommer tilbake i ny versjon, så den glemmes ikke.
  - **De ansatte:** én liste med alt som mangler, med lenke rett til punktet og feltet. Advarslene fra «Badet på PC» samles på ett sted før utgivelse. Ingen leting.
  - **KI i bunnen:** sjekken lagrer hver sperre, advarsel og overstyring som strukturerte koder per kontrollpunkt (`publish_check_results`). Det er grunnlaget KI senere bruker til «KI-sjekk før publisering» (2a-3) og «Råd før publisering» (fase 3). Se under.

## Problem

«Badet på PC» gir bare advarsler. Ingenting hindrer at et bad med TG3 uten kostnad eller uten hulltaking går ut. Det er de feilene som gir reklamasjoner og som forskriften (§ 2-22 og § 2-2) krever. Det finnes heller ingen utgivelse: rapporten kan ikke låses, få versjonsnummer eller rettes som versjon 2. Uten dette stopper den smale veien før PDF-en.

## KI i bunnen

- **KI gjør ingenting i selve sjekken.** Sperren er faste regler i ren kode, lik på iPad og server, og skal gi samme svar hver gang. KI setter aldri TG, krysser aldri bort en sperre, og publiserer aldri. Bare en ansatt med `report.publish` (krever gyldig sertifisering, A29) kan publisere.
- **KI-tekst som ikke er godkjent kommer ikke med.** Forslag i `ai_usage_log` med status `suggested` på rapporten gir advarselen `ai_suggestion_pending` med lenke til feltet («Et tekstforslag er ikke godtatt eller avvist. Det kommer ikke med i rapporten.»). Slås opp med den delvise indeksen `(organization_id, report_id)` fra PR #224. Forslag kommer bare inn i teksten ved «Bruk», så rapporten inneholder aldri ubehandlet KI-tekst (planen, «KI setter aldri TG, og sender aldri noe»).
- **Data som lagres for KI:** hver kjøring av sjekken lagrer én rad per funn i `publish_check_results` med `check_code`, `severity`, `target_ref` (rapport, rom, kontrollpunkt, avvik som id-er og faste koder), om den ble overstyrt, og begrunnelsen. Utgivelsen lagrer et låst øyeblikksbilde (`snapshot`) med TG, avvik og regelbeslutninger. Sammen med reklamasjonene (`claims.checkpoint_key`) gir det KI grunnlag for å si hvilke punkter og overstyringer som ender i saker. Ingen persondata i disse feltene; begrunnelsen er fritekst med lengdegrense og sperre mot fødselsnummer, og står bare i raden.
- **Ingen nye KI-kall** i denne oppgaven, så ingen ny funksjon i `src/core/ai` og intet nytt evalueringssett. KI-sjekken av tekst mot TG er eget punkt i 2a-3.

## Brukerhistorier

- Som **takstmann** vil jeg se alt som mangler i badet på ett sted, med lenke til punktet, slik at jeg retter det før rapporten går ut.
- Som **takstmann** vil jeg kunne krysse bort en sperre med en begrunnelse når mangelen er riktig (for eksempel kunden nektet å oppgi noe), slik at jeg ikke blir stående fast.
- Som **leder** vil jeg se hvem som overstyrte hva og hvorfor, slik at jeg kan svare på en reklamasjon.
- Som **takstmann** vil jeg lage ny versjon av en publisert rapport, slik at jeg kan rette den, og få sjekken på nytt.

## Omfang

**Med:**

1. **Ren sjekk** `computePublishCheck(input)` i `src/core/reports/logic/publish-check.ts` (ingen database, ingen pakker, samme kode i nettleser og server). Inndata er samme form som advarslene i «Badet på PC» bruker, pluss svarene på hulltaking og antall ventende KI-forslag. Utdata: liste over funn sortert etter rom, punktets rekkefølge og fast kode, hver med `checkCode`, `severity`, `target`, og lenkemål (rom, punkt, felt).
2. **Sperrer** (`severity = blocker`), kodene fra domenemodellen 4.7, ingen nye koder:
   - `tg2_tg3_missing_cause_or_consequence`: avvik med TG2 eller TG3 uten årsak (kriterium og tekst) eller uten konsekvens. Samme logikk som advarselen.
   - `tg3_missing_cost`: avvik med TG3 og `cost_type = none` eller uten kostnad.
   - `wet_or_below_ground_missing_hole`: rom som er våtrom, der `wet_room.hole_drilling` mangler svar, eller er «ikke utført» uten `wet_room.hole_drilling_reason`, eller grunnen er «annet» uten tekst i `wet_room.hole_drilling_reason_note`. TGIU med utfylte TGIU-opplysninger på tilliggende konstruksjoner teller som begrunnelse. «Under terreng» kommer med rom under terreng i 2a-3.
   - `mandatory_without_tg`: kontrollpunkt i badet uten `tg_direct` og uten avvik med TG (A423). Alle åtte punktene teller som obligatoriske til fagrådet har svart (spørsmål 88 d). «Gjelder ikke» finnes ikke ennå (`not_applicable` kommer i 2a-3), så overstyring brukes til da.
3. **Advarsler** (`severity = warning`, aldri sperre): de øvrige punktadvarslene fra «Badet på PC» (`tg2_tg3_missing_measure`, `cost_amount_not_rounded`, `hms_missing_consequence_or_measure`, `tgiu_details_missing`, `tgiu_suggested_not_set`, `no_findings_with_reading_over_limit`, `suggestion_no_longer_applies`, `texts_written_for_other_tg`, `tg3_on_age_only`, `deviation_tg_not_chosen`) og ny kode `ai_suggestion_pending`. `deviation_tg_not_chosen` gir også `mandatory_without_tg` når punktet ellers er uten TG.
4. **Skjermen «Publiser»** på oppdraget (PC og iPad-størrelse): knappen «Se over og publiser» åpner en side med to grupper, «Må rettes eller krysses bort» og «Bør sees over». Hvert funn har lenke «Gå til» som åpner rommet med fokus på punktet og feltet (samme mål som «Rett nå» i A381). Hver sperre har en avkrysning «Publiser likevel» som åpner et begrunnelsesfelt (påkrevd, A424). «Publiser» er sperret og sier hvorfor til alle sperrer er rettet eller krysset bort. Tellemerket «3 må rettes» vises ved knappen på rommet.
5. **Publiser (serverhandling, krever `report.publish`):** kjører sjekken på nytt på serveren mot lagrede data (aldri det klienten sendte), avviser hvis en sperre er uten overstyring eller sjekken er endret siden siden ble åpnet (fingeravtrykk av funnlisten), og lager i én transaksjon: `report_releases` (versjon 1, 2, …), `publish_check_results` for alle funn med overstyring og `release_id`, `reports.status = published`, revisjonslogg og hendelsen `report.published`. Tåler to samtidige klikk (unik `(organization_id, report_id, version_number)`).
6. **Utgivelsen** (`report_releases`): `version_number`, `released_at`, `released_by`, `signed_by_employee_id` (den som publiserer), `certification_id` (gyldig sertifisering den dagen), `company_id` (fra oppdraget), `original_release_date` (fra versjon 1), `valid_until` (befaringsdato + ett år, regel 12; uten befaringsdato: sperren `inspection_date_missing` er ikke med nå, se «Ikke med», så dagens dato brukes og det står i utgivelsen, A426), `revision_note` (valgfri), `snapshot` (jsonb: rapport, rom, punkter, avvik, tiltak, TGIU, regelbeslutninger, malversjon), `content_hash` (SHA-256 av kanonisk snapshot), `retain_until` (utgivelse + 10 år). `pdf_file_id` og `report_profile_version` kan være tomme til PDF-punktet. Utgivelsen endres aldri (ingen oppdateringstjeneste, test).
7. **Låst etter publisering:** alle skrivinger i `src/core/reports` avvises med tydelig melding når status er `published` («Rapporten er publisert. Lag ny versjon for å rette.»). Skjermen viser badet bare lesbart.
8. **Ny versjon:** knappen «Lag ny versjon» (krever `report.edit`) setter rapporten tilbake til `draft` med revisjonslogg (A425). Neste publisering blir versjon 2, sjekken kjøres helt på nytt, og ingen overstyring følger med: en mangel som ikke er rettet, kommer tilbake som sperre.
9. **Overstyringsloggen:** under «Utgivelser» på oppdraget ser leder, admin og takstmenn hver versjon med hvem som publiserte, når, og hvilke sperrer som ble krysset bort med begrunnelse.
10. **Migrering** `0037_publisering-badet`: tabellene `report_releases` og `publish_check_results` med `organization_id`, sammensatte fremmednøkler, CHECK på `severity` og koder, myk sletting, indekser på `(organization_id, report_id)`. Føres i `tests/tenant-tables.ts`. Versjon 0.17.0.

**Ikke med (bevisst utelatt):**

- PDF og sending (neste punkt og 2a-3). `pdf_file_id` står tom.
- De andre tre sperrene fra forskriften (`bra_missing`, `electrical_missing`, `inspection_date_missing`) og «gjelder ikke»: kommer med «Publisering med sperre» i 2a-3.
- Sidemannskontroll som advarsel, «selskap mangler»-advarsel, ventilasjon beskrevet ulikt, kommentar til ny versjon: 2a-3.
- KI-sjekk av tekst mot TG, gjetteord og uklart språk: 2a-3.
- Merket «Rettet» på oppdraget (regnes fra sendte utgivelser, kommer med sending).
- Endring av oppdragsstatus ved publisering (status «Ferdig» settes ved sending, D16).
- Sjekk av malen før publisering av mal (2a-3).
- Uten nett: publisering krever nett. Sjekken kan kjøres lokalt (ren kode), men iPad-flyten kommer i 2b.

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | sjekken, utgivelsene og overstyringene på oppdraget | publisere og krysse bort (med `report.publish` og gyldig sertifisering), lage ny versjon (`report.edit`) |
| kontor | utgivelsene (uten begrunnelsestekst) | ingenting |
| leder | alt | som takstmann |
| admin | alt | som takstmann; admin stenges aldri ute fra å se (regel 11) |

Reklamasjonssaker: bare leder og admin (regel 12). Spørringer filtrerer på `grant.organizationId`. `expectTenantIsolation` for kjøring av sjekken, publisering, ny versjon og liste over utgivelser.

## Data

- Nye tabeller `report_releases` og `publish_check_results`, slik domenemodellen 4.7 beskriver dem. `publish_check_results.override_reason` er påkrevd når `overridden` er sann (CHECK, A424), med lengdegrense (1000) og sperre mot fødselsnummer. `target_ref` er jsonb med bare id-er og faste koder.
- Ny fast kode i `PUBLISH_CHECK_CODES`: `ai_suggestion_pending`. Kodene fra 4.7 og advarselskodene gjenbrukes uendret (regel 6).
- `reports.status` bruker `published`, som alt finnes.
- Hendelsen `report.published` (bare id-er og versjonsnummer).
- Domenemodellen 4.7 rettes: begrunnelse påkrevd, ny kode, og hva snapshot inneholder. Ordlisten: `publish check` / «sjekk før publisering», `override` / «krysse bort», `release` / «utgivelse».

## Skjermer

- **Rommet (PC og iPad):** tellemerke ved «Se over og publiser» («2 må rettes, 3 bør sees over»).
- **Publiser-siden:** hovedhandling «Publiser versjon N». Fra rapport uten mangler: 2 trykk (åpne, publiser). Med én sperre som skal krysses bort: 4 trykk og en kort tekst.
- **Etter publisering:** bekreftelse med versjonsnummer, og «Lag ny versjon».
- Universell utforming: lenkene og avkrysningene virker med tastatur, feltene har etiketter, fokus flyttes til første sperre ved feil (axe i e2e).

## Regler

Sjekken er regler i kode med testsaker i `publish-check.test.ts`, én per kode og grense:
- TG2 med årsak og konsekvens: ingen sperre; uten kriterium, uten årsakstekst, uten konsekvens: sperre hver for seg.
- TG3 med `cost_type = none`: sperre; med intervall eller eget beløp: ingen.
- Hulltaking ubesvart; «ikke utført» uten grunn; «annet» uten tekst; «ikke utført» med grunn; TGIU med opplysninger; «utført uten funn»: sperre / sperre / sperre / ingen / ingen / ingen.
- Punkt med TG1, TG0, TGIU, avvik med TG: ingen sperre. Punkt med bare HMS, tomt punkt, avvik uten valgt TG: `mandatory_without_tg`.
- Slettede rader telles ikke. Sorteringen er fast.
- Overstyring gjelder bare én versjon: ny versjon med samme mangel gir sperre igjen.

## Akseptkriterier

- [ ] `computePublishCheck` gir riktige sperrer og advarsler for testsakene over, og samme svar i nettleser og server (samme modul, test)
- [ ] Publisering avvises på serveren når en sperre ikke er krysset bort, eller når funnlisten er endret siden siden ble åpnet
- [ ] Å krysse bort krever begrunnelse; overstyringen lagres med hvem, når og hvorfor, og vises under «Utgivelser»
- [ ] Publisering lager utgivelse versjon 1 med snapshot, fingeravtrykk, gyldig til (befaringsdato + 1 år) og oppbevaring 10 år, i én transaksjon; to samtidige klikk gir én utgivelse
- [ ] Uten `report.publish` eller uten gyldig sertifisering: ingen publisering; kontor kan ikke publisere
- [ ] Publisert rapport kan ikke endres; «Lag ny versjon» åpner den, og en mangel som ikke er rettet kommer tilbake som sperre i versjon 2
- [ ] Ventende KI-forslag gir advarsel og kommer ikke med i snapshot
- [ ] Lenken «Gå til» åpner riktig rom med fokus på punktet og feltet
- [ ] Ingen fritekst eller persondata i revisjonsloggen, hendelsen eller applikasjonsloggen
- [ ] Bruker i annen organisasjon får ikke tilgang (test, `expectTenantIsolation` per spørring, tabellene i `tests/tenant-tables.ts`)
- [ ] Virker på iPad-størrelse og PC (e2e), uten axe-feil
- [ ] KI-forslag: ingen nye; testen viser at KI aldri setter TG eller publiserer (ingen kall til `src/core/ai` fra publiseringen)

## Avgjort i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A423** `mandatory_without_tg` er med som sperre for badets åtte punkter (lett å endre).
- **A424** Begrunnelse er påkrevd ved overstyring, ikke valgfri som domenemodellen sa (lett å endre).
- **A425** «Ny versjon» åpner samme rapport igjen, ikke en ny rapport (dyrt å endre).
- **A426** Uten befaringsdato regnes «gyldig til» fra publiseringsdagen til sperren for befaringsdato kommer i 2a-3 (lett å endre).

## Roller

utvikler og testskriver i parallell; arkitekt (to nye tabeller, låsing og versjoner); ux (publiser-siden og overstyring); sikkerhet-personvern (tilgang, fritekst, oppbevaring); fagansvarlig (sperrenes grenser, særlig hulltaking og `mandatory_without_tg`).

## Åpne spørsmål

- Spørsmål 88 (d) til fagrådet: skal alle åtte punktene kreve TG? Påvirker `mandatory_without_tg` (A423).
- Skal «under terreng» få samme sperre for hulltaking? Tas med rom under terreng i 2a-3.
