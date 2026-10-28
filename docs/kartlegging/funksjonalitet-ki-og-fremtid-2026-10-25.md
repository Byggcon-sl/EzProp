# EzProp – avanserte funksjoner, KI-bruk og fremtidsvisjoner

Status: **Arbeidsdokument – ikke godkjent**
Sist oppdatert: 25.10.2026 (sen kveld)
Laget av: Claude, på oppdrag fra Ståle («hva med funksjonalitet – avanserte funksjoner, ai bruk, fremtidsvisjoner»).
Hører sammen med: `innspill-datamodell-og-plan-2026-10-25.md`, `ki-funksjoner.md`, `utviklingsplan.md` («Senere») og `datamodell.md`.

**Rammer som gjelder (fra `LES-MEG.md`):** Intern bruk først. KI lager utkast, takstmannen godkjenner. KI setter aldri TG og sender aldri noe selv. Databehandleravtale, EU/EØS, ingen trening på våre data. Logg og merking av KI-bruk bygges før noen KI-funksjon slås på. Alt i nettleseren.

**Slik leses dokumentet:** Ideene er sortert i tre horisonter. **Nær** = kan bygges rett etter produksjon (fase 4), med dagens datamodell. **Mellom** = 1–2 år, krever noen nye tabeller eller avtaler. **Visjon** = 3 år og lenger, eller krever at en beslutning endres. For hver idé står det hvilken **krok i datamodellen** som må finnes fra start for at ideen ikke blir dyr senere. Det er den viktigste delen: ikke å bygge ideene nå, men å ikke bygge seg bort fra dem.

---

## 1. Det som gjør EzProp til noe annet enn IVIT

IVIT er et skjema som gir en PDF. Det EzProp kan bli, bygger på tre ting IVIT ikke har:

1. **Strukturerte data.** Hvert avvik har TG, kriterium, årsak, konsekvens, tiltak, kostnad, måling og bilde som egne felt, ikke som tekst i en PDF. 2000 rapporter i året gir etter tre år 6000 rapporter og rundt 100 000 avvik som kan telles, sammenlignes og læres av.
2. **Hendelser.** Alt som skjer er loggført og kan utløse noe.
3. **Regler som data.** Fagkunnskapen ligger i tabeller fagrådet eier, ikke i kode.

Nesten alle ideene under er måter å bruke disse tre tingene på. Datamodellen slik den er skrevet 25.10 gir dem; de få krokene som mangler står merket.

---

## 2. KI i befaringen (takstmannen i felt)

| # | Idé | Horisont | Hva det gir | Krok i datamodellen |
|---|---|---|---|---|
| K1 | **Tale → strukturert funn.** Takstmannen sier «bad 2. etasje, sluk, rust rundt klemring, fukt 18 prosent i veggen bak dusj». KI foreslår rom, kontrollpunkt, avvikstekst, måling og bilde-kobling. TG står tomt. | Nær (KI trinn 2–3 i planen) | Færre trykk på iPaden, mer tid til å se | `ai_usage_log`, `deviations.measurement_value`. Finnes. |
| K2 | **Bilde → forslag til kontrollpunkt.** Bildet som tas, foreslår automatisk hvilket rom og punkt det hører til (ut fra hva det ligner på og hvor i sjekklisten takstmannen er). | Nær | Sparer sortering, som er det folk misliker mest i IVIT | `photos.checkpoint_result_id`, `ai_usage_log`. Finnes. |
| K3 | **Bilde → utkast til observasjon.** «Bildet viser riss i puss ved vindu, ca. 1 mm.» Takstmannen godtar eller forkaster. Aldri TG. | Mellom | Raskere tekst, lik kvalitet | Som K2. |
| K4 | **Glemt noe?** Før takstmannen forlater rommet: «Du har ikke registrert ventilasjon på badet, og det mangler bilde av sluket.» Dette er regler, ikke KI, og virker uten nett. | Nær (fase 2) | Færre turer tilbake | `rules` med `validate` og `photo_missing` (foreslått i innspill D5). |
| K5 | **Kontekst fra forrige rapport.** Når takstmannen åpner et punkt, vises hva som stod sist gang boligen ble taksert (av Byggcon), med dato. | Nær (fase 3 har «kopier fra») | Ser utvikling, fanger opp forverring | `reports.copied_from_report_id`, `properties` felles. Finnes. |
| K6 | **Måleutstyr rett inn.** Fuktmåler, laseravstandsmåler og termokamera sender verdier rett til feltet via Bluetooth. | Visjon | Ingen avskrift, færre feil | **Mangler.** Safari på iPad har ikke Web Bluetooth. Krever et lite «følge-program» (native skall rundt nettappen). Se avsnitt 8. |
| K7 | **Arealmåling med LiDAR.** iPad Pro har LiDAR. Rommet skannes, BRA foreslås per rom og etasje, og plantegningen følger med i rapporten. | Visjon | Areal er den vanligste reklamasjonsgrunnen. Måling og tegning i ett. | **Mangler.** Samme begrensning som K6: ikke tilgjengelig fra nettleseren. Datamodellen bør ha `rooms.geometry` (polygon) og `floor_areas.method = lidar` fra start. |
| K8 | **Befaringsassistent som snakker.** Takstmannen spør: «Hva sier standarden om fall til sluk?» og får svar fra Byggcons egen kunnskapsbase. | Mellom | Færre oppslag, lik praksis | Kunnskapsbasen i SharePoint via MCP. Ingen ny tabell. |

---

## 3. KI i rapportskrivingen (kontoret)

| # | Idé | Horisont | Hva det gir | Krok |
|---|---|---|---|---|
| R1 | **Språkvask i Byggcon-stil.** «Bruk / behold / nytt forslag», med Ståles språkregler (ingen gjetteord, skriv det vi ser) som fast instruks. | Nær (KI trinn 2) | Jevn tekst på tvers av 15 takstmenn | `ai_usage_log`. Finnes. |
| R2 | **Konsistenssjekk før sidemann.** Regler + KI leser rapporten: TG2 med TG3-ord i teksten, kostnad uten TG3, tiltak som ikke matcher avviket, konsekvens som mangler risiko, gjetteord, samme avvik registrert to ganger, bilde som ikke hører til teksten. Gir bare advarsler. | Nær (KI trinn 3) | Sidemannen bruker tiden på fag, ikke på å finne skrivefeil | `publish_check_results` med `severity = warning`, `check_code` for KI-sjekker. Finnes. |
| R3 | **Sammendrag i klarspråk** for kjøper, laget fra avvikene, ikke fra fritekst. | Nær (KI trinn 2) | Bedre rapport for kjøper, mindre skriving | `reports.summary_text` + lagret generert tekst (innspill D12). |
| R4 | **Egenerklæringen leses av KI** og sammenlignes med funnene: «Selger oppgir ingen fuktskader. Rapporten har TG3 fukt i kjeller.» Forslag til teksten under «avvik mot egenerklæring» (NS 3600 pkt. 14.4 f). | Mellom | Dekker et krav som ofte gjøres slurvete | `seller_declarations.differences_text` finnes. Trenger `file_id` som KI kan lese (finnes). |
| R5 | **Dokumentasjon leses av KI.** Ferdigattest, FDV og våtromsdokumentasjon lastes opp; KI fyller dokumentasjonstabellen (type, dato, hva det dekker) og foreslår `build_year_source = documented` der det stemmer. | Mellom | Dokumentasjonstabellen blir faktisk brukt | `documentation_items` finnes. |
| R6 | **Forhåndsutfylling fra tegninger og tidligere rapport.** Plantegning lastes opp → etasjer og rom foreslås. | Mellom | Oppstart på 2 minutter i stedet for 20 | `floors`, `rooms` per rapport. Finnes. |
| R7 | **KI-sidemann med Byggcons kunnskapsbase.** Samme kontroll som `sidemannskontroll`-skillen gjør i dag, men inne i EzProp, mot kunnskapsbasen i SharePoint, med funn som kommentarer i `peer_review_comments` merket «KI». Mennesket godkjenner fortsatt. | Mellom | Lik kontroll på alle rapporter, ikke bare de som får sidemann | `peer_review_comments` med `author_type = ai`. **Liten krok som bør inn nå.** |
| R8 | **Kalibrering av avvikstekster.** KI foreslår nye fraser fra godkjente rapporter («denne formuleringen er brukt 40 ganger, men finnes ikke i frasebanken»). Fagrådet godkjenner. | Mellom | Frasebanken vokser av seg selv, i Byggcons språk | `phrases.source = ai_draft`. Finnes. |

---

## 4. KI og automatikk på kontoret og i driften

| # | Idé | Horisont | Hva det gir | Krok |
|---|---|---|---|---|
| A1 | **E-post inn → ordre.** Bestillinger fra meglere kommer på e-post i dag. KI leser e-posten og foreslår en ordre (adresse, megler, ønsket rapport, frist). Kontoret godkjenner med ett klikk. | Nær (etter fase 3) | Dekker «manuell ordre» nesten like godt som API | `orders.source = email`, `raw_payload`. Finnes. E-post via Microsoft 365 (tilkobling finnes). |
| A2 | **Henvendelse → handling.** «Kan vi flytte befaringen til torsdag?» fra selger blir et forslag om ny tid i køen, som kontoret bekrefter. | Mellom (KI 13) | Mindre manuell e-post | `events`, `action_runs`. Finnes. |
| A3 | **Forslag til tildeling.** Nytt oppdrag → forslag om takstmann ut fra kontor, avstand, ledig kapasitet og sertifisering. Leder velger. | Mellom | Jevnere belastning over fem kontorer | `properties.latitude/longitude`, `offices`, `certifications` finnes. Trenger kalender/kapasitet (senere). |
| A4 | **Ruteplan for dagen.** Befaringer sorteres i kjørerekkefølge, med kjøretid. | Mellom | Færre kilometer | Posisjon på eiendom finnes. |
| A5 | **Prognose for volum.** Ut fra ordre inn, sesong og meglerne: forventet antall rapporter neste 4 uker per kontor. | Visjon | Bemanning og innleie | `orders`, `events`. Finnes. |
| A6 | **Fakturering uten feil.** Regel: når rapport er sendt og mottaker er valgt, lages fakturagrunnlaget automatisk fra avtalens pris, og legges til godkjenning. | Nær (fase 3 har grunnlaget) | Ingen glemte fakturaer | `client_agreements.price_note` er tekst i dag. **Krok:** `price_list` som data senere. |
| A7 | **Regelverksvakt.** En rutine følger med på lovdata og Standard Norge, og varsler fagansvarlig når forskriften eller NS 3600 endres, med forslag om hva i malen som berøres. | Mellom | Byggcon er aldri bak på regelverk | `template_versions.regulation_version`, `ns_edition`. Finnes. |

---

## 5. Avanserte funksjoner uten KI (verdien ligger i dataene)

| # | Idé | Horisont | Hva det gir | Krok |
|---|---|---|---|---|
| F1 | **Boligens historikk.** Alle Byggcons rapporter på samme eiendom vises som en tidslinje: TG per punkt over tid, bilder side om side. | Nær | Viser utvikling, støtter neste takstmann og reklamasjonssaker | `properties` felles, `reports` per oppdrag. Finnes. |
| F2 | **Kalibreringsoversikt per takstmann.** Andel TG2/TG3 per kontrollpunkt sammenlignet med gjennomsnittet i Byggcon, og hvor ofte TG-forslag avvises. Ikke for å måle folk, men for å finne ulik praksis og ta det i fagrådet. | Nær (etter pilot) | Likere rapporter, bedre opplæring | `deviations.suggestion_status`, `cause_criterion`. Finnes. Krever enighet med ansatte (arbeidsmiljøloven kap. 9, allerede notert). |
| F3 | **Reklamasjonsmappe på ett klikk.** Ved en reklamasjon: alle utgivelser, bilder med tidsstempel, målinger, hvem som var til stede, hva eier opplyste, egenerklæring, logg over endringer, sidemannskontroll – samlet som én PDF. | Nær | Dager spart per sak, bedre forsvar | `report_releases.snapshot`, `audit_log`, `inspection_attendees`. Finnes. |
| F4 | **Kalibreringsbibliotek.** Godkjente eksempelbilder per kontrollpunkt og TG («slik ser TG2 på taktekking ut»), som takstmannen kan slå opp i på befaringen. Fagrådet velger bildene. | Mellom | Opplæring av nye, likere vurdering | **Krok:** `reference_photos` (checkpoint_key, tg, file_id, godkjent av). Bør inn i modellen nå. |
| F5 | **Statistikk for fagrådet.** De vanligste avvikene per boligtype og byggeår, typiske kostnader, hvor ofte TGIU brukes og hvorfor. | Mellom | Byggcons egen erfaringsbase; grunnlag for bedre fraser og kostnadsintervaller | Alt finnes. |
| F6 | **Nettrapport, gyldighetsside og visningslogg** (fra «Senere» i planen). Kjøper får en rapport som kan filtreres på TG og rom, med bilder i full størrelse. | Mellom | Bedre for kjøper, løser PDF-størrelsen (innspill P8) | `report_releases` finnes. |
| F7 | **Selgerportal før befaring.** Selger får en lenke: hva som skjer, hva de bør finne fram (dokumentasjonstabellen som sjekkliste), egenerklæring kan lastes opp, hulltaking kan forhåndsgodkjennes. | Mellom | Færre TGIU og manglende dokumenter | `documentation_items`, `seller_declarations`, `tgiu_details.owner_informed`. Finnes. Trenger kundeinnlogging (modellen har rollen). |
| F8 | **Meglerstatus.** Megler ser status på sine oppdrag og kan laste ned siste PDF. | Mellom | Færre telefoner til kontoret | Rollen `broker` (visning) finnes. |
| F9 | **Eksport i standard dataformat (SN-NSPEK 3477).** Rapporten kan leveres som data, ikke bare PDF, hvis forskriften § 1-7 eller meglerne krever det. | Mellom | Byggcon er klar hvis kravet kommer | Datamodellen er detaljert nok. **Krok:** holde felt-navn og koder stabile. |
| F10 | **Hjelpeprogram for takstmannen på PC.** Alt i rapporten kan redigeres i to kolonner: rapporten og bildene. Dra bilder, flytt avvik, bytt rekkefølge. | Nær (fase 3 har bildesenter) | Raskere ferdigstilling | Finnes. |

---

## 6. Samspill med Optiplan (den største muligheten)

60 % av Byggcons tilstandsrapporter er leiligheter. Fellesdelene (tak, fasade, drenering, rør) er ofte det kjøper lurer mest på, og det takstmannen vet minst om. **Optiplan er Byggcons system for tilstandsanalyse og vedlikeholdsplan for borettslag og sameier.** Det er altså Byggcon selv som ofte har svaret.

| # | Idé | Horisont | Hva det gir | Krok |
|---|---|---|---|---|
| O1 | **Oppslag i Optiplan fra EzProp.** Når en leilighet registreres med sameiets organisasjonsnummer, sjekker EzProp om Optiplan har en tilstandsanalyse eller vedlikeholdsplan for bygget. Takstmannen får sammendraget og kan fylle `common_areas` med kilde. | Mellom | Bedre leilighetsrapporter enn noen konkurrent kan lage. Ingen andre har begge sider. | `common_areas.association_firm_id`, `firms.org_number`. Finnes. Trenger en lesetilkobling mellom de to (felles innlogging finnes). |
| O2 | **Tilbake til Optiplan.** Funn på fellesdeler fra EzProp-befaringer (f.eks. rust på rekkverk i oppgang) samles per bygg og tilbys sameiet som grunnlag for en vedlikeholdsplan. | Visjon | Nye oppdrag til Optiplan fra EzProp-data | Hendelse `report.published` + filter på `applies_to_unit = common`. |
| O3 | **Én kundebase.** Sameier og borettslag er kunder i Optiplan og «firma» i EzProp. Samme organisasjonsnummer bør gi samme rad. | Mellom | Ingen dubletter, hel kundehistorikk | `firms.org_number` finnes; avtale om hvem som eier raden. |

---

## 7. Visjoner (3 år og lenger)

Disse krever at beslutninger endres, eller at noe utenfor Byggcon skjer. De står her for at datamodellen ikke skal stenge for dem.

- **Boligens digitale tilstandspass.** Byggcons rapport blir en strukturert datapakke som følger boligen (via Boligmappa eller tilsvarende) og oppdateres ved neste takst. Krever F9 og en avtale.
- **Kjøperens spørsmål til rapporten.** Kjøper kan spørre en KI som bare svarer fra rapporten («hva betyr TG2 på drenering for meg?»), med tydelig merking og uten å gi nye vurderinger. Krever F6, en grundig juridisk vurdering (uavhengighet § 1-3, ansvar), og at KI aldri går utover det som står i rapporten.
- **Forsikringsselskap og meglere henter data direkte.** Fremtind får strukturerte funn i stedet for PDF, hvis de vil. Krever F9 og avtale.
- **Følge-app for maskinvare.** Hvis K6 og K7 (Bluetooth, LiDAR) blir viktige, må beslutningen «alt i nettleseren» justeres til «alt i nettleseren, pluss et tynt native skall for iPad» (for eksempel Capacitor). Nettappen er den samme; skallet gir tilgang til sensorer og bedre bakgrunnsopplasting. Dette er den eneste visjonen som krever en endring i en beslutning, og det er greit at den tas først når behovet er bevist.
- **Fagrådets regler som Byggcons eiendel.** Når reglene, tersklene, frasene og kalibreringsbildene ligger som data, er det Byggcons samlede fagkunnskap i et format som kan vedlikeholdes, revideres og – hvis det en dag blir aktuelt – deles. Salg til andre ligger lenger bak, men dataformatet gjør at døren står åpen.

---

## 8. Det som må inn i datamodellen nå (så ideene ikke blir dyre)

| Krok | Hvilke ideer | Hva som skal inn |
|---|---|---|
| `peer_review_comments.author_type` (`employee` / `ai`) | R7 | Ett felt |
| `reference_photos` | F4 | Liten tabell: `checkpoint_key`, `tg`, `file_id`, `caption`, `approved_by` |
| `rooms.geometry`, `floor_areas.method = lidar` | K7 | Valgfritt JSON-felt og én verdi til i listen |
| `price_lists` / `price_list_items` per avtale | A6 | Kan starte som tekst (`price_note`), men tabellene bør være tegnet |
| `orders.source = email` | A1 | Én verdi til i listen |
| Stabile `key`-verdier på kontrollpunkter, felt og utfall | F9, alle KI-funksjoner | Allerede et prinsipp i modellen; bør stå som regel i `CLAUDE.md`: en `key` endres aldri, den arkiveres |
| `ai_usage_log.cost` | Alle KI | Kostnad per kall, slik at KI-bruk kan måles mot IVITs 169 kr per rapport |

Alt annet i dette dokumentet dekkes av datamodellen slik den er.

---

## 9. Styring av KI (slik at det forblir trygt)

- **Rekkefølgen i planen er riktig:** logg og merking → regelbaserte sjekker uten KI → tale og språkvask → bilde og struktur → læring. Ingen KI-funksjon slås på før loggen virker.
- **Evalueringssett.** For hver KI-funksjon lages 30–50 eksempler med fasit fra fagrådet (f.eks. 50 diktater med riktig strukturering). Funksjonen slås ikke på før den treffer godt nok, og settet kjøres på nytt ved bytte av modell. Dette mangler i planen og bør inn som punkt under «KI trinn 1».
- **Kostnad per rapport** måles fra første dag (`ai_usage_log.cost`). IVIT tar 169 kr per rapport for KI; EzProp bør vite hva det selv koster.
- **Tydelig merking** i skjermbildet av tekst som kom fra KI til den er godkjent, og i loggen etterpå.
- **Aldri personopplysninger til KI** utover det som trengs. Kontakter sendes aldri (står i modellen). Bilder med personer i skal filtreres eller sladdes før KI.
- **Fagrådet eier KI-instruksene** (språkregler, hva KI skal se etter), som data i `settings`, ikke i kode.

---

## 10. Forslag til prioritering etter produksjon (fase 4)

Claudes forslag, etter nytte per innsats og hva som bygger på hverandre:

1. **F3 Reklamasjonsmappe** og **F1 Boligens historikk** – nesten gratis når dataene finnes, høy verdi.
2. **K4 «Glemt noe?»** – regler, ingen KI, virker uten nett. Egentlig fase 2.
3. **KI trinn 1–2:** logg, R1 språkvask, K1 tale → struktur, R3 sammendrag.
4. **A1 E-post → ordre** – løser det meste av «manuell ordre».
5. **R2 Konsistenssjekk** og **R7 KI-sidemann** – kvalitetsløft på alle rapporter.
6. **O1 Oppslag i Optiplan** – unik for Byggcon, og 60 % av rapportene.
7. **F6/F7/F8 Nettrapport, selgerportal, meglerstatus** – kundesiden.
8. **F2/F4/F5 Kalibrering, bibliotek, statistikk** – fagrådets verktøy.
9. **K6/K7 Maskinvare** – først når behovet er bevist og beslutningen om native skall er tatt.

---

## 11. Spørsmål til Ståle

1. Er samspillet med Optiplan (O1–O3) noe du vil ha med som mål i «Målgang»? Det er det ingen konkurrent kan kopiere.
2. Skal evalueringssett for KI (avsnitt 9) inn i planen under KI trinn 1?
3. Vil du åpne for et tynt native skall rundt nettappen senere (K6, K7), eller skal «alt i nettleseren» stå fast uansett?
4. Kalibreringsoversikt per takstmann (F2): er det noe du vil ta opp med de ansatte sammen med loggingen av KI-bruk?
5. Hvilke tre av ideene vil du se først etter produksjon? Da kan de få kroker og testtilfeller allerede i fase 2.

*Svar gjerne per punkt. Det som bestemmes, fører jeg inn i LES-MEG, datamodellen (krokene i avsnitt 8) og planen («Senere»-listen).*
