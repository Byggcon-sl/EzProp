# Funksjon: Publisering av badet

- **Fase:** 2a-2 Hele veien først, punktet «Publisering av badet»
- **Modul:** kjerne (`src/core/reports`: ny tjeneste for sjekk, publisering og versjoner; ren sjekk i `src/core/reports/logic/publish-check.ts`; tolkning av våtromsfeltene i `src/core/reports/signals.ts`), lås i `src/core/buildings`, én tilgangshjelper i `src/core/access`, skjerm under `src/app/(ansatt)/oppdrag/[id]/`
- **Branch:** `publisering-badet` (bygger på `main`, etter PR #224 og #227)
- **Status:** godkjent etter forhåndsvurdering runde 1 (17.11.2026)
- **Dato:** 17.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner (hovedsaken):** rapporten kan ikke gå ut med de våtromsmanglene forskriften krever (TG2/TG3 uten årsak og konsekvens, TG3 uten kostnad, våtrom uten hulltaking eller begrunnelse, del uten TG, manglende befaringsdato) uten at takstmannen aktivt har krysset bort sperren og sagt hvorfor. Hver overstyring logges, kan vises ved en reklamasjon, og gjelder bare én versjon. Utgivelsen låses i 10 år.
  - **De ansatte:** én liste med alt som mangler. Det opplagte rettes rett i listen, resten med «Gå til» og «Tilbake til publisering». Faste grunner med ett trykk. Ingen leting.
  - **KI i bunnen:** funn og overstyringer lagres som faste koder per kontrollpunkt (`publish_check_results`, med kolonnen `source` klar for KI-sjekken i 2a-3). Snapshot merker hvilken tekst som kom fra et godkjent KI-forslag. KI er ikke med i selve sjekken.

## Problem

«Badet på PC» gir bare advarsler. Ingenting hindrer at et bad med TG3 uten kostnad eller uten hulltaking går ut. Det er de feilene som gir reklamasjoner, og som forskriften (§ 2-2, § 2-22 og § 2-23) krever. Det finnes heller ingen utgivelse: rapporten kan ikke låses, få versjonsnummer eller rettes som versjon 2. Uten dette stopper den smale veien før PDF-en.

## KI i bunnen

- **KI gjør ingenting i selve sjekken.** Sperren er faste regler i ren kode, lik på iPad og server, og gir samme svar hver gang. KI setter aldri TG, krysser aldri bort en sperre og publiserer aldri. Bare en ansatt med `report.publish` og gyldig sertifisering (A29) kan publisere.
- **KI-tekst som ikke er godkjent, kommer ikke med.** Advarselen `ai_suggestion_pending` teller bare rader i `ai_usage_log` med `outcome = 'ok'`, `status = 'suggested'`, `deleted_at is null`, på rapporten, laget etter forrige utgivelse (eller alle, hvis ingen utgivelse finnes) (A454). Slås opp med den delvise indeksen `(organization_id, report_id)`. Forslaget kan behandles rett på publiser-siden (tillegg F4), med de samme handlingene og den samme loggingen som på rommet.
- **KI-merking i snapshot:** for hvert tekstfelt som kom fra et KI-forslag, lagrer snapshot `ai_usage_id` og status (`accepted` eller `edited`), aldri forslagsteksten. Da kan PDF-en og en reklamasjonssak vise hvilken tekst KI foreslo og takstmannen godtok.
- **Klar for KI-sjekken i 2a-3:** `publish_check_results.source` (`rule` eller `ai`, standard `rule`). CHECK: `source = 'ai'` kan bare ha `severity = 'warning'`. KI kan aldri lage en sperre.
- **Begrunnelser går ikke til KI.** Fritekst i `override_reason` sendes aldri til KI uten vasken i `src/core/ai` og egen vurdering. «Råd før publisering» (fase 3) og lederoversikten (nytt planpunkt) bruker `check_code`, `override_reason_code` og `target_ref`, ikke teksten. Det står i kommentaren til kolonnen.
- **Ingen nye KI-kall** i denne oppgaven: ingen ny funksjon i `src/core/ai`, intet nytt evalueringssett, ingen kostnad. Statisk test: `publish-check.ts` og publiseringstjenesten importerer ikke `src/core/ai`; integrasjonstest: publisering lager ingen nye rader i `ai_usage_log`.

## Brukerhistorier

- Som **takstmann** vil jeg se alt som mangler i badet på ett sted og rette det opplagte rett der, slik at rapporten er riktig før den går ut.
- Som **takstmann** vil jeg krysse bort en sperre med ett trykk på en fast grunn når mangelen er riktig, slik at jeg ikke står fast.
- Som **takstmann** vil jeg se hva som publiseres (TG per rom, kostnader) før jeg trykker, slik at jeg oppdager feil TG eller et glemt punkt.
- Som **leder** vil jeg se hvem som krysset bort hva og hvorfor, slik at jeg kan svare på en reklamasjon.
- Som **takstmann** vil jeg lage ny versjon av en publisert rapport, slik at jeg kan rette den, og få sjekken på nytt.

## Omfang

**Med:**

1. **Ren sjekk** `computePublishCheck(input: PublishCheckInput): PublishCheckFinding[]` i `logic/publish-check.ts`. Ingen database, ingen pakker, ingen `node:crypto`, ingen våtromskoder (ADR 0013 punkt 14, A396). Inndata er ferdig tolket tilstand per rom og punkt, laget i `signals.ts` av den som kaller:
   - per rom: `isWetRoom`, `holeDrilling: "unanswered" | "not_done_no_reason" | "other_without_note" | "ok"`, `holeReadingMissing: boolean`, og om tilliggende konstruksjoner har TGIU med grunn;
   - per punkt: `requiresTg` (data, A520), `tgDirect`, TGIU-grunn, avvikene (kind, TG, kriterium, årsak, konsekvens, kostnad, tiltak), og de eksisterende advarslene fra «Badet på PC»;
   - per rapport: om befaringsdato finnes, og antall ventende KI-forslag med mål.
   Utdata: funn sortert etter rom, punktets rekkefølge og fast kode, hver med `checkCode`, `severity`, `source` og `target` (`PublishCheckTarget`: `roomId`, `checkpointId`, `checkpointKey`, `deviationId`, `ruleKey`, `missing` – hva som mangler, som fast kode). Punktet kan mangle rad i `checkpoint_results`, så målet er aldri den id-en.
2. **Sperrer** (`severity = blocker`), kodene fra domenemodellen 4.7:
   - `tg2_tg3_missing_cause_or_consequence`: avvik med `kind = tg` og valgt TG 2 eller 3, der kriterium mangler, årsakstekst er tom eller bare mellomrom, eller konsekvens er tom eller bare mellomrom. Hver for seg (`missing`). HMS-avvik gir aldri denne.
   - `tg3_missing_cost`: avvik med TG3 og `cost_type = none` (databasen tillater bare `band` med intervall, `approx` med beløp eller `none`).
   - `wet_or_below_ground_missing_hole`: våtrom der hulltaking er ubesvart, «ikke utført» uten grunn, eller grunnen er «annet» uten tekst (tom eller blank). TGIU på tilliggende konstruksjoner **med utfylt grunn** teller som begrunnelse (A445); de andre TGIU-opplysningene er advarsel. «Under terreng» kommer med rom under terreng i 2a-3.
   - `mandatory_without_tg` (A520, A443, A444), med tre mål:
     - punkt med `requiresTg = true` uten `tg_direct` og uten avvik med valgt TG (også punkt med bare HMS-avvik);
     - punkt med `tg_direct = IU` og tom eller blank TGIU-grunn (§ 2-23, A443);
     - avvik med `kind = tg` og `tg = null`, med avviket som mål, også når punktet har TG fra et annet avvik (A444).
     Den erstatter advarslene `checkpoint_done_without_tg` og `deviation_tg_not_chosen` på samme mål i sjekken: samme mangel vises aldri to ganger. Punkt med `requiresTg = false` (el, rekkverk, HMS-punkter uten TG) gir aldri sperre.
   - `inspection_date_missing`: oppdraget mangler befaringsdato (flyttet fram fra 2a-3, A523). Krysses den bort, står «gyldig til» tom i utgivelsen; den regnes aldri fra publiseringsdagen.
   - Publisering uten et eneste våtrom i rapporten avvises med «Rapporten har ikke noe våtrom å publisere.» (ikke en sperre som kan krysses bort; et slettet bad skal ikke gi fri publisering).
3. **Advarsler** (`severity = warning`, aldri sperre): de øvrige punktadvarslene fra «Badet på PC» (`tg2_tg3_missing_measure`, `cost_amount_not_rounded`, `hms_missing_consequence_or_measure`, `tgiu_details_missing`, `tgiu_suggested_not_set`, `no_findings_with_reading_over_limit`, `suggestion_no_longer_applies`, `texts_written_for_other_tg`, `tg3_on_age_only`), og to nye koder: `ai_suggestion_pending` og `hole_reading_missing` (hull tatt, «utført uten funn» eller «utført med funn», uten måleverdi eller uten enhet; § 2-2, A446).
4. **Fingeravtrykk:** regnes på serveren (SHA-256, utenfor `logic/`) av kanonisk form av funnlisten: `checkCode`, `severity` og `target`, sortert, uten overstyringer. Sorteringen til kanonisk form er en ren funksjon i `logic/`.
5. **Publiser-siden** på oppdraget (PC og iPad-størrelse). Knappen «Se over og publiser» på rommet har tellemerke («2 må rettes, 3 bør sees over»), også i iPad-størrelse. Siden har:
   - øverst, hvis den ansatte mangler `report.publish` eller gyldig sertifisering: «Du kan ikke publisere: sertifiseringen din gikk ut 01.11. En kollega med gyldig sertifisering kan publisere.» Listen kan fortsatt brukes (F5);
   - oppsummeringen «Dette publiseres» fra samme data som snapshot (F4);
   - gruppen «Må rettes eller krysses bort», deretter «Bør sees over (N)». Advarsler krever ingen avkrysning eller bekreftelse;
   - hvert funn: fast tekst laget fra koden (aldri lagret tekst), «Gå til» (minst 44 pt), og «Rett nå» der rettingen er opplagt (F2);
   - hver sperre: bryterflaten «Publiser likevel» (minst 44 pt, ikke en liten avkrysningsboks). Valgene for grunn vises rett under funnet, ikke i en dialog (F1);
   - synkstatus for rapporten. «Publiser» er sperret mens køen har endringer: «Venter på synk (3 endringer)». Uten nett: «Publisering krever nett. Alt er lagret på enheten.» (A451);
   - hovedknappen «Publiser versjon N» fast nederst (56–72 pt). Er den sperret, sier den hvorfor med tall: «Publiser (2 må rettes eller krysses bort)», og trykk flytter fokus til første sperre. Ingen bekreftelsesdialog: siden er gjennomgangen.
6. **Funnlisten endres mens siden er åpen** (F3): serveren svarer med den nye listen i stedet for en feil. Siden viser «Listen er oppdatert», beholder valgte grunner og påbegynt tekst for funn med samme `checkCode` og samme mål, og merker nye sperrer «Ny siden du åpnet siden». Ingenting av dette lagres før publisering. Det samme gjelder etter «Gå til» og tilbake.
7. **Publiser** (serverhandling, krever `report.publish`): i én transaksjon som låser rapportraden med `FOR UPDATE` (samme lås som `withRoomWrite`):
   - slår opp rapporten fra oppdraget med `grant.organizationId`, aldri fra skjemaet; avviser hvis status ikke er `draft`;
   - slår opp gyldig sertifisering for `grant.employeeId` den dagen i norsk tid (utløpsdagen er siste gyldige dag), entydig valgt (lengst `valid_to`, så id), via en funksjon i `src/core/organization`. Ingen gyldig sertifisering: avvist;
   - kjører sjekken på nytt mot lagrede data, sammenligner fingeravtrykket (mangler eller feil: ny liste tilbake, punkt 6);
   - godtar bare overstyring for sperrer serveren selv har regnet ut (kode og mål). Overstyring av advarsel eller ukjent mål avvises;
   - lager `report_releases`, `publish_check_results` for **alle** funn (også advarsler) med `release_id`, setter `reports.status = published`, skriver revisjonslogg og hendelser.
   Rader i `publish_check_results` skrives bare her, aldri ved visning. Å åpne siden er ren lesing (`organization.read`). To samtidige publiseringer gir én utgivelse.
8. **Utgivelsen** (`report_releases`), som aldri endres (ingen tjeneste for oppdatering eller myk sletting, test; papirkurven kan ikke ta den):
   - felles kolonner; unik `(organization_id, report_id, id)` og `(organization_id, report_id, version_number)`, ikke delvise; CHECK `version_number >= 1`;
   - `released_at`, `released_by` og `signed_by_employee_id` (ansatt-id, slik `done_by` er), `certification_id`, `company_id` (fra oppdraget), alle NOT NULL med sammensatte fremmednøkler `(organization_id, id)`;
   - `original_release_date` og `valid_until` som `date` i norsk tid. `valid_until` = befaringsdato + ett år (regel 12), tom hvis befaringsdatoen manglet og sperren ble krysset bort. Versjon 2 og senere kopierer begge fra versjon 1 og endrer dem aldri (4.7);
   - `snapshot` (jsonb, selvstendig kopi, ikke pekere): `schema_version`, malversjon, bygning, etasje, romnavn og romtype, punkter, TG, avvik, tiltak, kostnad, TGIU, regelbeslutninger og KI-merking. Ingen parter, navn, e-post, telefon, adresse, matrikkel eller reklamasjonsdata. Snapshot logges aldri (A452);
   - `content_hash` (SHA-256 av kanonisk snapshot, regnet på serveren), `retain_until` (utgivelse + 10 år, satt på serveren).
   - Ikke med nå: `pdf_file_id`, `report_profile_version`, `co_signed_by_employee_id`, `revision_note` (A455). `reports.current_release_id` bygges ikke; siste utgivelse er høyeste versjon.
9. **`publish_check_results`** (bare nye rader, aldri endret): felles kolonner, `release_id` NOT NULL med fremmednøkkel med tre kolonner `(organization_id, report_id, release_id)` mot utgivelsen, `check_code`, `severity`, `source`, `target_ref` (jsonb, `PublishCheckTarget`), `overridden`, `overridden_by` (sammensatt fremmednøkkel), `overridden_at` (serverens tid), `override_reason_code`, `override_reason`. CHECK-regler:
   - `check_code` i `PUBLISH_CHECK_CODES` (alle sju sperrekodene fra 4.7 og advarselskodene, så 2a-3 slipper ny migrering);
   - overstyrt bare når `severity = 'blocker'`; en sperre i en utgivelse må være overstyrt;
   - overstyrt krever `overridden_by`, `overridden_at` og `override_reason_code`; ikke overstyrt krever at alle fire (og teksten) er tomme;
   - `override_reason_code = 'other'` krever tekst; teksten er høyst 1000 tegn;
   - `source = 'ai'` bare med `severity = 'warning'`.
   `message` fra 4.7 lagres ikke: teksten lages fra koden ved visning, så romnavn og fritekst ikke lagres to ganger (ADR 0015, sikkerhet-personvern).
10. **Låst etter publisering:**
    - alle skrivinger i `src/core/reports`, også synkruten for feltene, avvises når status er `published` med «Rapporten er publisert. Lag ny versjon for å rette.». Avvisningen fra synkruten stopper ikke køen (jf. T-0001);
    - `src/core/buildings` avviser lagring, fjerning og gjenoppretting av rom, etasjer og bygninger når oppdragets rapport er publisert, med samme melding (A447). Sjekken gjøres med én kjernefunksjon i `src/core/reports` (`isReportPublishedForAssignment`), med test;
    - skjermen viser badet bare lesbart.
11. **Ny versjon:** «Lag ny versjon» (sekundærknapp, ikke ved siden av hovedhandlingen; krever `report.edit`) låser rapportraden, setter rapporten tilbake til `draft` og skriver revisjonslogg (A522). Eldre utgivelser røres aldri. Neste publisering blir versjon 2. Sjekken kjøres helt på nytt, og ingen overstyring følger med: en mangel som ikke er rettet, kommer tilbake som sperre. Ved en slik sperre vises «I versjon 1 krysset du bort dette: <grunn>» med knappen «Bruk samme begrunnelse», som må trykkes aktivt (F3).
12. **Hendelser:** `report.published` bare for versjon 1 (utløser for sending til kunde senere, 4.9), `report.revised` for versjon 2 og senere (en rettet rapport sendes manuelt, regel 12), og `report.publish_override` per sperre som krysses bort. Alle finnes i `EVENT_TYPES`. Bare id-er, versjonsnummer og faste koder; aldri begrunnelsen.
13. **Utgivelser på oppdraget:** hver versjon med hvem som publiserte, når, og hvilke sperrer som ble krysset bort med grunn. Ansattnavn slås opp med samme organisasjon i join (som `listAuditEvents`), også ansatte som har sluttet. `listReleases` returnerer `overrideReason: null` for den som ikke har `canSeeOverrideReasons(grant)` (kontor). Listen slår aldri opp i `claims`.
14. **Migrering** `0038_publisering-badet`: tabellene over, CHECK-reglene, indekser på `(organization_id, report_id)` og en delvis indeks på `(organization_id, created_at) where overridden` for lederoversikten senere. Begge tabellene føres i `tests/tenant-tables.ts`. `PUBLISH_CHECK_CODES` og `PUBLISH_OVERRIDE_REASON_CODES` står i `logic/codes.ts` og i `src/db/schema/reports.ts` med samme typesjekk som `OVERRIDE_REASON_CODES`. **Nummeret kolliderer med `0037_ki-i-veien`:** den som merges sist, bytter nummer (står i tilstandsfilen). Versjon 0.17.0.
15. **ADR 0015** (sjekk nummeret ved merge): de to tabellene, låsing og versjoner (A522), snapshot-formatet, fingeravtrykket, hvorfor `message` og `revision_note` ikke lagres, og det som er forkastet (`current_release_id`, PDF-kolonner nå, rader ved hver visning).

**Ikke med (bevisst utelatt):**

- PDF og sending (neste punkt og 2a-3). Utgivelsen får ikke PDF-kolonner nå.
- Sperrene `bra_missing` og `electrical_missing` og «gjelder ikke» (`not_applicable`): kommer med «Publisering med sperre» i 2a-3. Kodene står alt i CHECK-listen.
- Sidemannskontroll som advarsel, «selskap mangler», ventilasjon beskrevet ulikt, kommentar til ny versjon (`revision_note`): 2a-3.
- KI-sjekk av tekst mot TG, gjetteord og uklart språk: 2a-3 (skriver i samme tabell med `source = 'ai'`).
- Merket «Rettet» på oppdraget (regnes fra sendte utgivelser, kommer med sending). Endring av oppdragsstatus ved publisering (status «Ferdig» settes ved sending, D16).
- Sjekk av malen før publisering av mal (2a-3).
- Publisering uten nett: krever nett. Sjekken og tellemerket virker lokalt (ren kode); iPad-flyten kommer i 2b.
- Liste eller statistikk over overstyringer per person (arbeidsmiljøloven kap. 9). Lederoversikten (nytt planpunkt) bygges uten personfilter til Ståle har svart (spørsmål 100).

## Lagt til av forbedreren

Ført i `docs/plan/forbedrerens-tillegg.md`.

- **F1 Faste grunner med ett trykk** (A449, samme mønster som A380): «Ikke tilgang eller nektet av eier» (`no_access_or_refused`), «Gjelder ikke dette rommet» (`not_applicable_to_room`, til `not_applicable` kommer i 2a-3), «Beskrevet et annet sted i rapporten» (`described_elsewhere`) og «Annet» (`other`). Bare «Annet» krever tekst (minst 10 tegn, så «.» ikke godtas). Til de andre kan en kort tekst legges til. Ny kolonne `override_reason_code`.
- **F2 Rett sperren på publiser-siden:** `wet_or_below_ground_missing_hole` viser de tre svarene på hulltaking og grunnvalget i linjen; `tg3_missing_cost` viser kostnadsintervallene; `mandatory_without_tg` viser TG-knappene for punktet (aldri forhåndsvalgt; takstmannen velger). Gjenbruker `warningFix` og «Rett nå» (A381) og de samme skrivetjenestene som rommet. Etter «Gå til» viser rommet en fast linje «Tilbake til publisering (2 igjen)».
- **F3 Begrunnelser går ikke tapt:** se omfang 6 og 11.
- **F4 KI-forslag og «Dette publiseres» på siden:** `ai_suggestion_pending` viser forslagsteksten med «Bruk», «Endre» og «Avvis», samme handlinger og logging som på rommet (gjenbrukt, ikke nye KI-kall). Øverst: «Dette publiseres: Bad 1: TG3 ×1 (kostnad 50–100 000), TG2 ×2, TGIU ×1», bygget med samme funksjon som snapshot.
- **F5 Si tidlig fra om manglende rett eller sertifisering:** se omfang 5.
- **Nytt planpunkt:** «Overstyringer for leder» under «Fra forbedreren» i 2a-2 (bygges i tur, ikke i denne oppgaven).

## Tilgang

| Rolle | Se | Endre |
|---|---|---|
| takstmann | sjekken, utgivelsene og overstyringene med grunn og tekst | publisere og krysse bort (`report.publish` og gyldig sertifisering), lage ny versjon (`report.edit`) |
| kontor | sjekken og utgivelsene, med grunnkode men uten begrunnelsestekst (`canSeeOverrideReasons` er usann, avgjort i kjernen) | ingenting: ikke publisere, krysse bort eller lage ny versjon |
| leder | alt | som takstmann |
| admin | alt, også uten sertifisering (regel 11) | lage ny versjon; publisere bare med gyldig sertifisering (A29) |

- `canSeeOverrideReasons(grant)` i `src/core/access`: sann for takstmann, leder og admin. Admin ser alltid.
- Reklamasjonssaker (regel 12): snapshot, utgivelser og sjekkrader tar ikke med noe fra `claims`, og listen «Utgivelser» slår ikke opp i `claims` (test for takstmann og kontor).
- Spørringer filtrerer på `grant.organizationId`. «Gå til»-lenken bygges på serveren fra id-er til interne stier, aldri fra en adresse klienten sender. `overridden_by` = `grant.employeeId`.
- `expectTenantIsolation` for `getPublishCheck`, `publishReport`, `startNewVersion`, `listReleases` og oppslaget av ventende KI-forslag.

## Data

- Nye tabeller `report_releases` og `publish_check_results` (omfang 8 og 9). Ingen tjeneste oppdaterer eller sletter dem.
- `override_reason`: trimmes, høyst 1000 tegn i Zod og CHECK, avvises med `containsNationalId` fra `src/shared/validation/free-text.ts` (ingen ny kopi). Hjelpetekst: «Ikke skriv navn eller kontaktopplysninger.» Står aldri i `audit_log.changes`, hendelser, logg eller feilmeldinger.
- Nye faste koder (regel 6): `ai_suggestion_pending`, `hole_reading_missing`, og grunnene i `PUBLISH_OVERRIDE_REASON_CODES`.
- `reports.status` bruker `published`, som alt finnes.
- Domenemodellen 4.7 rettes i samme PR: begrunnelse som kode og tekst, rader bare ved publisering, `message` lagres ikke, `source`, snapshot-innhold, `requiresTg` som data (A520). Ordlisten: `publish check` / «sjekk før publisering», `override` / «krysse bort», `release` / «utgivelse», `override reason code` / «grunn».

## Skjermer

- **Rommet (PC og iPad):** tellemerke ved «Se over og publiser». Etter «Gå til»: fast linje «Tilbake til publisering (N igjen)», og listen oppdateres når man kommer tilbake.
- **Publiser-siden:** se omfang 5. Ingen nedtrekksmenyer.
- **Etter publisering:** «Versjon N er publisert», badet lesbart, og «Lag ny versjon» som sekundærknapp.
- **Trykk:** IVIT har ingen samlet liste (anslag 15–30 trykk og 5–10 minutter leting per bad, ikke målt). EzProp uten mangler: 2 trykk. Én sperre rettet: 4 trykk. Én sperre krysset bort med fast grunn: 4 trykk, ingen tekst.
- Universell utforming: alt virker med tastatur, feltene har etiketter, fokus til første sperre, axe i e2e.

## Regler

Sjekken er regler i kode med testsaker som data i `publish-check.test.ts`, én per kode og grense:

- **Årsak og konsekvens:** TG2 komplett → ingen. Uten kriterium / tom årsak / blank konsekvens → sperre hver for seg. TG3 komplett med `band` → ingen. TG3 med `approx` ikke rundet → ingen sperre, advarsel `cost_amount_not_rounded`. HMS-avvik uten konsekvens → ingen sperre (advarsel). Mykt slettet avvik med mangler → ingenting.
- **Kostnad:** TG3 med `none` → sperre. TG2 med `none` → ingen.
- **Hulltaking:** ubesvart uten TGIU → sperre; ubesvart, TGIU med grunn → ingen; ubesvart, TGIU med blank grunn → sperre; `not_done` uten grunn → sperre; `other` med tom eller blank tekst → sperre; `other` med tekst → ingen; `owner_refused` / `no_access` / `concrete_or_masonry` → ingen; `owner_refused` med TG2 direkte eller TG2-avvik → ingen sperre, advarsel `tgiu_suggested_not_set`; `done_no_findings` og `done_with_findings` med måling → ingen; uten måleverdi eller enhet → advarsel `hole_reading_missing`; to våtrom, mangel i det ene → én sperre med riktig rom; rom som ikke er våtrom → ingen.
- **Punkt uten TG:** TG0, TG1, avvik med TG → ingen. Tomt punkt, punkt med bare HMS → sperre. `requiresTg = false` og ingen TG → ingen. TGIU med grunn → ingen; TGIU med tom eller blank grunn → sperre `mandatory_without_tg` og advarsel `tgiu_details_missing`. Punkt med komplett TG2-avvik og et avvik uten valgt TG → sperre på avviket. `checkpoint_done_without_tg` og `deviation_tg_not_chosen` vises aldri på samme mål som sperren.
- **Befaringsdato:** mangler → sperre `inspection_date_missing`.
- **Generelt:** slettede rom, punkter, avvik og KI-forslag telles ikke; sorteringen er fast og uavhengig av rekkefølgen i inndata; fingeravtrykket er stabilt og endres når et funn kommer til eller faller bort; overstyring gjelder bare én versjon.

## Akseptkriterier

- [ ] `computePublishCheck` gir riktige sperrer og advarsler for alle testsakene over, og er samme modul i nettleser og server (statisk test: ingen import av db, `server-only`, `node:crypto` eller `src/core/ai`)
- [ ] Publisering avvises på serveren når en sperre ikke er krysset bort; ved endret eller manglende fingeravtrykk kommer den nye listen tilbake, og grunner for samme kode og mål står igjen
- [ ] Serveren avviser overstyring av advarsler, ukjente koder og ukjente mål, og tar rapport, ansatt og tid fra seg selv, aldri fra skjemaet
- [ ] Å krysse bort krever en fast grunn; «Annet» krever minst 10 tegn; fødselsnummer (også med mellomrom), blank tekst og over 1000 tegn avvises
- [ ] Publisering lager i én transaksjon utgivelse versjon 1 med snapshot, `content_hash`, gyldig til (befaringsdato + 1 år) og oppbevaring 10 år, og sjekkrader for alle funn med `release_id`; tvunget feil midt i lagrer ingenting; to samtidige publiseringer gir én utgivelse
- [ ] Uten befaringsdato: sperre; krysses den bort, står «gyldig til» tom (aldri regnet fra publiseringsdagen)
- [ ] Versjon 2 arver `original_release_date` og `valid_until` fra versjon 1; `certification_id` er sertifiseringen som var gyldig den dagen i norsk tid, og utløpsdagen er siste gyldige dag
- [ ] Publisert rapport kan ikke endres: skrivetjenestene i `src/core/reports`, synkruten (uten å stoppe køen) og rom, etasjer og bygninger i `src/core/buildings` avvises med samme melding
- [ ] «Lag ny versjon» krever `report.edit`, rører ikke eldre utgivelser, og en mangel som ikke er rettet, kommer tilbake som sperre uten overstyring; «Bruk samme begrunnelse» må trykkes aktivt
- [ ] Utgivelser og sjekkrader kan verken endres eller slettes (ingen tjeneste, test); papirkurven tar dem ikke
- [ ] Rollematrise: takstmann med og uten sertifisering, kontor, leder, admin med og uten sertifisering, enkeltrettighet `report.publish` uten sertifisering. Admin uten sertifisering kan ikke publisere, men ser sjekken, utgivelsene og begrunnelsene og kan lage ny versjon
- [ ] Kontor får ikke begrunnelsesteksten i svaret fra tjenesten (testen leser det serveren sender), og kan verken publisere, krysse bort eller lage ny versjon
- [ ] Mangler den ansatte rett eller gyldig sertifisering, sier siden det øverst før klikk, og listen kan fortsatt brukes
- [ ] «Publiser» er sperret mens synkkøen for rapporten har endringer, og sier hvorfor; uten nett gis en tydelig melding, og sjekken vises fortsatt
- [ ] Ventende KI-forslag (bare `ok` + `suggested`, ikke slettet, etter forrige utgivelse) gir advarsel og står ikke i snapshot; `blocked`, `error` og `no_match` gir ingen advarsel; godkjent KI-tekst er merket med `ai_usage_id` og status i snapshot
- [ ] Snapshot, utgivelser og sjekkrader har ingen reklamasjonsdata, parter eller kontaktopplysninger; listen «Utgivelser» slår ikke opp i `claims`
- [ ] Ingen fritekst eller persondata i revisjonsloggen, hendelsene eller applikasjonsloggen; riktige hendelser (`report.published` v1, `report.revised` v2+, `report.publish_override` per sperre)
- [ ] Publisering uten våtrom avvises
- [ ] CHECK-reglene i begge tabellene prøves med rå innsetting; sammensatt fremmednøkkel mot en utgivelse i en annen organisasjon avvises av databasen
- [ ] Bruker i annen organisasjon får ikke tilgang (`expectTenantIsolation` for de fem oppslagene, tabellene i `tests/tenant-tables.ts`)
- [ ] Migreringen kjører mot en database som alt har rapporter med status `published`
- [ ] «Rett nå» på publiser-siden, KI-forslag behandlet der, «Dette publiseres» og «Tilbake til publisering (N igjen)» virker (e2e)
- [ ] Virker på iPad-størrelse og PC (e2e), uten axe-feil, med tastatur; uten mangler 2 trykk, én sperre med fast grunn 4 trykk
- [ ] Ingen kall til `src/core/ai` og ingen nye rader i `ai_usage_log` ved publisering; KI setter aldri TG og publiserer aldri

## Testplan (test-leder runde 1, lages før koding)

- **Enhet/regel:** P1 én sak per kode og grense (Regler over); P2 fast sortering uansett rekkefølge; P3 slettede rader; P4 `deviation_tg_not_chosen` erstattes av sperren på samme avvik (aldri begge, A444); P5 rom som ikke er våtrom; P6 fingeravtrykk; P7 `content_hash` lik uansett nøkkelrekkefølge; P8 begrunnelsen (tom, blank, «Annet» under 10 tegn, over 1000 tegn, fødselsnummer); P9 statisk importtest.
- **Integrasjon:** I1 avvist ved sperre og ved gammelt fingeravtrykk; I2 én transaksjon med tvunget feil; I3 `Promise.all` gir én utgivelse; I4 publisert rapport kan ikke publiseres igjen; I5 alle skrivetjenester, synkruten og `src/core/buildings` avvises etter publisering; I6 ny versjon; I7 rollematrisen; I8 `expectTenantIsolation` for fem oppslag; I9 tenant-tabellene, fremmednøkler og CHECK; I10 KI-forslag; I11 ingen KI-kall; I12 fritekst med merke ikke i logg, hendelse eller revisjonslogg; I13 befaringsdato mangler (sperre, tom «gyldig til», arv i v2); I14 migrering med eksisterende publiserte rapporter; I15 publisering uten våtrom; I16 kontor får `overrideReason: null`; I17 ingen reklamasjonsdata.
- **E2e (PC og iPad):** E1 tellemerket; E2 «Gå til» og «Tilbake til publisering»; E3 trykktall; E4 sperret knapp med tall og fokus; E5 lesbar visning og «Lag ny versjon» gir sperren tilbake; E6 «Utgivelser» for leder og kontor; E7 uten nett og synkkø; E8 axe og tastatur; E9 «Rett nå», KI-forslag og «Listen er oppdatert».

## Avgjort i autonom modus (føres i `docs/09-apne-sporsmal.md`)

- **A520** `mandatory_without_tg` for alle åtte punktene som gir TG, som data (`requiresTg` i `signals.ts`). Avviker fra `mandatory` i malen og fra 4.7, som rettes. Spørsmål 99. Lett å endre.
- **A521** Overstyring krever en fast grunn; tekst bare ved «Annet». Lett å endre.
- **A522** «Ny versjon» åpner samme rapport igjen. Dyrt å endre.
- **A523** (endret) Uten befaringsdato: sperre `inspection_date_missing` nå, og «gyldig til» regnes aldri fra publiseringsdagen. Lett å endre.
- **A443** TGIU uten grunn gir sperre `mandatory_without_tg`. Lett å endre.
- **A444** Avvik uten valgt TG gir alltid sperre. Lett å endre.
- **A445** TGIU med grunn på tilliggende konstruksjoner teller som begrunnelse for hulltaking. Lett å endre.
- **A446** Ny advarsel `hole_reading_missing`. Lett å endre.
- **A447** Publisert rapport låser rom, etasjer og bygninger; publisering uten våtrom avvises. Lett å endre.
- **A448** Sjekkrader bare ved publisering, alle funn lagres, `message` lagres ikke, kolonnen `source`. Dyrt å endre.
- **A449** Faste grunner for overstyring (forbedreren). Lett å endre.
- **A450** Kontor ser ikke begrunnelsesteksten (`canSeeOverrideReasons`). Lett å endre.
- **A451** «Publiser» venter på tom synkkø. Lett å endre.
- **A452** Snapshot er en selvstendig kopi med `schema_version` og KI-merking, uten persondata og reklamasjonsdata. Dyrt å endre.
- **A453** Hendelser: `report.published` bare v1, `report.revised` v2+, `report.publish_override` per sperre. Lett å endre.
- **A454** Hva som teller som ventende KI-forslag. Lett å endre.
- **A455** `revision_note`, PDF-kolonner, medsignatur og `current_release_id` tas ikke med nå. Lett å endre.

## Avgjort ved uenighet (prosjektlederen)

- **Grunn som fast kode eller bare forhåndsutfylt tekst:** ux-ansvarlig ville ha ferdige grunner som bare fyller fritekstfeltet, uten nye faste koder. Forbedreren ville ha faste koder. Forbedrerens forslag bygges (Ståle 14.11.2026), og faste koder gir tall for leder og KI uten å lese fritekst (sikkerhet-personvern). Fra ux beholdes: minst 10 tegn når tekst kreves, valgene rett under funnet, ingen dialog.
- **Begrunnelse 1–1000 tegn påkrevd (arkitekt) mot kode med valgfri tekst (forbedreren):** CHECK krever kode, og tekst bare ved «Annet». A521 gjelder fortsatt: en grunn er alltid påkrevd.
- **`message` (arkitekt: behold eller begrunn) mot sikkerhet-personvern (ikke lagre tekst med romnavn):** lagres ikke; teksten lages fra koden. Begrunnes i ADR 0015.
- **Låsing av rom (arkitekt: egen A-beslutning; sikkerhet-personvern: bygg nå):** bygges nå (A447), fordi en publisert rapport ellers kan miste badet uten ny versjon.
- **«Gyldig til» uten befaringsdato:** fagansvarlig ga to valg. Sperren tas med nå, fordi koden alt står i 4.7 og det er det enkleste som aldri gir feil dato i en låst utgivelse. Kolonnen `valid_until_basis` (arkitekt) trengs da ikke.
- **Hull uten fuktmåling:** tas med nå som advarsel (A446), fordi feltene finnes og forskriften krever måling; sperre er fag og går til Ståle (spørsmål 99).

## Roller

utvikler og testskriver i parallell; arkitekt (ADR 0015, skjema og låsing); ux-ansvarlig (publiser-siden); sikkerhet-personvern (tilgang, fritekst, oppbevaring); fagansvarlig (testsakene for sperrene); ki-ansvarlig (snapshot-merking og `ai_suggestion_pending`); test-leder (testplanen over).

## Åpne spørsmål

- Spørsmål 99 (fagrådet): hvilke punkter krever TG, TGIU uten grunn og avvik uten TG som sperre, nektet hulltaking med annet enn TGIU, hull uten fuktmåling. Påvirker A520, A443–A446.
- Spørsmål 100 (personvern): lederoversikten per takstmann.
- Skal «under terreng» få samme sperre for hulltaking? Tas med rom under terreng i 2a-3.
