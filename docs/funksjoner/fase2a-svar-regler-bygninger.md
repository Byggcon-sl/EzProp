# Funksjon: Svarene i reglene og bygningene (F1–F7, F9)

- **Fase:** 2a, delen «Fra Ståles svar 12.11.2026», første punkt
- **Modul:** kjerne (`src/core/rules`, `src/core/buildings`, `src/core/templates`), badmalen (`src/db/seed/templates/wet-room.ts`), bygningsskjermen
- **Branch:** `svar-stale-regler-bygninger`, bygger på `svar-stale-12-11-i-planen` (PR #168)
- **Status:** klar for bygging (rettet etter forhåndsvurdering runde 1: forenkler, arkitekt, fagansvarlig, test-leder)
- **Støtter hovedmål:** Reklamasjoner: reglene følger fagrådets svar (TG0 bare når det er målt uten funn, TGIU når det ikke er undersøkt, lik grensen gir forslag), og kryperom og kjeller får riktig arealtype og etasje fra start. De ansatte: færre felt å rette selv (etasjenummer, under terreng, arealtype fylles ut). KI i bunnen: regelsvarene er faste koder og tall som KI-forslagene senere bygger på.

Fasit: `docs/kartlegging/svar-fra-stale-2026-11-12.md` (F1–F7, F9).

## Problem
Reglene for badet (PR #167) ble laget før fagrådet svarte. Ingen regel foreslår TG0 (A224), kilden for fuktgrensen sier «bransjepraksis» og ikke NS 3600:2025, og kryperom regnes som BRA-i (T-0016). Etasjen «Kjeller» får neste ledige nummer og ikke «under terreng» (T-0010). Lar vi det stå, får takstmannen feil forslag og feil arealtype, som er vanlige grunner til reklamasjon.

## KI i bunnen
- KI gjør ikke noe nytt her. Regelmotoren er bevisst uten KI (ADR 0009): samme rene funksjoner på iPad og server, og KI setter aldri TG.
- Det som lagres for KI: regelsvaret (regelkode, tilstand, forslag, begrunnelse som koder og tall, kode på terskel- og levetidssett) og arealtypen og «under terreng» som faste koder. Dette er grunnlaget når KI senere skriver utkast til avvikstekst og foreslår rom fra plantegning (T4). Ingen fritekst og ingen persondata i regelsvaret.
- Ingen nye kall til `src/core/ai`.

## Brukerhistorier
- Som **takstmann** vil jeg få forslag om TG0 på tilliggende konstruksjoner når jeg har tatt hull uten funn og målt under grensen, slik at et gammelt bad med god måling ikke får TG2 bare på grunn av alder.
- Som **takstmann** vil jeg at «Kjeller» og «Underetasje» får etasje -1 og «Under terreng» krysset av, og at kryperom og uinnredet loft foreslås som «Ikke del av BRA», slik at jeg slipper å rette det.

## Omfang
**Med:**

1. **F1, nytt formål og ny regel.**
   - Nytt regelformål `suggest_tg0`, sist i `RULE_PURPOSES` og i `TG_RULE_PURPOSES` (`src/db/schema/templates.ts`). Ny forslagstype i `src/core/rules/types.ts`:
     `RuleSuggestion = ({ kind: "outcome" } & OutcomeRef) | { kind: "tgiu"; checkpoint_key: string } | { kind: "tg0"; checkpoint_key: string }`.
   - `suggest_tg0` må inn alle steder formålene står hardkodet: `givesTgSuggestion` i `src/core/templates/document.ts` (bruk `TG_RULE_PURPOSES`), `checkRuleCheckpointGivesTg` og `checkRuleConditionShape`, `evaluateRule` i `src/core/rules/evaluate.ts` (motoren kan bare `import type` fra `@/db/schema`, så listen står i `src/core/rules/codes.ts` med en test som viser at den er lik `TG_RULE_PURPOSES`), kommentarene «Aldri TG0» og koden `target_missing` i `types.ts`.
   - `suggest_tg0` krever `target_checkpoint_key` på et kontrollpunkt med `gives_tg` og har `suggested_outcome = null`, kontrollert i `@/core/templates` som for TGIU. Bare lov i systemmalen, som andre TG-formål.
   - **«Under grensen» uttrykkes med ny kolonne `rule_conditions.negate boolean not null default false`** (A237), også i dokumentformatet. Motoren snur `true`/`false`; `unknown` står. `ConditionReasonBase` får `negated: boolean`; `truth` er verdien etter snuing. Det gir én terskel og én sannhet: den nye regelen leser samme terskel `wet_room_hole_moisture_weight_percent` som `hole_moisture_over_limit`, med `negate = true`. 15,0 gir aldri begge, 14,9 gir aldri ingen, RF % eller tom måling gir «ikke vurdert» i begge.
   - **Ny regel `wet_room.hole_no_elevated_moisture`** (`suggest_tg0`) på `wet_room.adjacent`: hulltaking er `done_no_findings` **og** måling i vekt-% er under grensen (negert «lik eller over»). Gir TG0-forslag uansett alder. **Bare «utført uten funn»** (A238): «utført med funn» betyr at takstmannen har sett noe i hullet (misfarging, råte, mugg, lukt), og da vurderer han selv.
   - Meldingen sier at forslaget forutsetter måling i treverk, og at annet materiale vurderer takstmannen selv (samme som på `hole_moisture_over_limit`). Ingen gjetteord.
   - Kilden: «Ståles beslutning 12.11.2026 (F1); utkast, ikke godkjent av fagrådet». Ikke NS 3600, for standarden sier ikke dette (TG0-vilkåret er 0–5 år og dokumentasjon, `docs/kartlegging/regelverk-krav.md` linje 63 og 126).
   - `docs/kartlegging/regelverk-krav.md` får én linje i endringstabellen: unntak for tilliggende konstruksjoner i våtrom når hull er tatt uten funn og målt under grensen (Ståle 12.11.2026, F1). Kontrollen «TG0 bare ved 0–5 år» (linje 207) skal ikke gi advarsel på `wet_room.adjacent` når den bygges; det står i denne fila og i kommentaren over reglene.
   - Spørsmål 77 (a, b) til Ståle: bevisst unntak fra 5-årsvilkåret, og «med funn». Regelen er utkast til han har svart.
   - ADR 0009 punkt 6, 7 og 9 og «Forkastet» rettes i samme PR (TG0-formålet, `negate`, og forkastede løsninger: egen terskel med `lt` og samme tall, og fast verdi på betingelsen).
   - A224 får ny linje i `docs/09-apne-sporsmal.md` (erstattet av F1). Kommentaren over reglene i `wet-room.ts` («De foreslår aldri TG0», «gir reglene ikke noe forslag på `wet_room.adjacent`») og navnene på 59a-testsakene rettes.
   - Ny test på malfilen: ingen testsak gir både `tg0` og `outcome` eller `tgiu` på samme kontrollpunkt (motoren løser ikke motstrid).
2. **F2.** Regelen `wet_room.hole_drilling_not_done` (`suggest_tgiu`) beholdes. Meldingen sier at begrunnelse og risikovurdering skal fylles ut. Kilden: «NS 3600:2025 og forskriften § 2-2; Ståle 25.10.2026 og 12.11.2026 (F2)» (småfunn fra #167).
3. **F3.** `source_ref` for fuktgrensen (`src/core/rules/data/thresholds.ts`, `SOURCE_RULE_MOISTURE`) og alderstabellen (`lifespans.ts`, `SOURCE_RULE_AGE`) sier: «NS 3600:2025 (Ståle 12.11.2026, F3); tallene er ikke kontrollert mot standarden; utkast, ikke godkjent av fagrådet». Tallet 15 vekt-% og tallene i alderstabellen står. Testen i `data.test.ts` som forbyr «NS» i kilden, rettes. Bare navn på standarden og tall, ingen tekst fra den.
4. **F4, F5.** Motoren bruker alt «lik eller over» (`gte`) for alder og fukt. Gå gjennom alle regler og testsaker, og legg til kanttestsak der den mangler (lik grensen gir forslag, én under gir ikke). `hole_moisture_over_limit` beholder koden selv om navnet sier «over»: den regner alt «lik eller over» (testsakene F2 og F3 gir forslag ved 15), så koden arkiveres ikke. A226 merkes bekreftet av Ståle 12.11.2026.
5. **F9.** Ren funksjon ved siden av `checkNoTgLogicInCustom` i `src/core/templates/schemas.ts`: i egne maler (`custom`) avvises `validate`-regler med `severity = blocker`, og `warning` godtas. Systemmalen kan fortsatt ha `blocker`. Funksjonen kalles fra samme valideringssted i `templates.ts` (linje ~1333) som `checkNoTgLogicInCustom`, så både `saveDraftContent` og `publishVersion` stopper den, med norsk melding som nevner regelkoden. Lesing av et eksisterende utkast krasjer ikke. Egne maler kan ikke opprettes ennå (A139), så det finnes ingen slike data. Notat i ADR 0009: motoren skal behandle `blocker` utenfor systemmalen som advarsel når `validate` tas i bruk.
6. **F6, T-0016.** Ny arealtype `not_bra` («Ikke del av BRA») sist i `AREA_TYPES` (`src/core/buildings/codes.ts`), i `AREA_TYPE_LABELS`, Zod-skjemaet og CHECK i `src/db/schema/rooms.ts`. `AREA_TYPES` brukes bare av rom (etasjearealet har egne kolonner bra_i/bra_e/bra_b), så etasjearealet berøres ikke.
   - `not_bra` er **en merking på rommet**. BRA regnes fra `floor_areas` (`sumFloorArea`), og rom har ikke areal. `AreaSum` får ingen ny nøkkel, og summene er uendret.
   - Romtypene `crawl_space` og `unfinished_attic` foreslår `not_bra`. `basement_room` er fortsatt BRA-i. Takstmannen kan endre arealtypen.
   - `crawl_space` får `defaultBelowGround: false` og tas ut av `USUALLY_BELOW_GROUND`. Står kryperommet i en etasje under terreng, gir `suggestBelowGround` fortsatt «under terreng». Det er et faktum om plasseringen, og det er riktig (A239).
   - Kryperom følger krypkjeller uten krav om hulltaking. Kravet om hulltaking i rom under terreng finnes ikke ennå. Når det bygges, skal unntaket knyttes til romtypen `crawl_space`, aldri til `below_ground = false`. Det står i denne fila og i domenemodellen 4.4, ikke som notat i koden (forenkler).
   - Domenemodellen 4.4 (linje 647, 660, 671) og ordlisten (linje 2141) oppdateres. Eksisterende rader migreres ikke.
7. **F7, T-0010.** Ren funksjon i `src/core/buildings/codes.ts`:
   `suggestFloor(name: string, existingLevels: readonly number[]): { level: number; belowGround: boolean } | null`
   - Navnet sammenlignes uten forskjell på store og små bokstaver og uten mellomrom foran og bak.
   - «Kjeller» og «Underetasje» gir -1 og `belowGround: true`, også om -1 alt er brukt (to etasjer på -1 er lov; ingen unik regel på nummeret).
   - «Loft» gir `max(høyeste, 0) + 1` og `belowGround: false`. Ingen etasjer eller bare kjeller gir 1. Høyeste 20 gir 20 (holdes innenfor -3 til 20, `floors_level_check`).
   - Andre forslag fra listen (for eksempel «1. etasje») og fritekst gir `null`; da gjelder dagens `nextLevel`, og «under terreng» endres ikke.
   - `existingLevels` er etasjene som ikke er slettet.
   - Listen `FLOOR_NAME_SUGGESTIONS` flyttes fra `buildings-editor.tsx` til `codes.ts`. Skjermen er klientkode og importerer fra den rene fila, ikke fra `service.ts`.
   - Bare forslag ved valg; takstmannen kan endre nummer og «under terreng» før lagring. Etasjenavn er fritekst, ingen migrering.
8. **Småfunn fra #167:** kilde på TGIU-regelen (punkt 2). Meldingen på `membrane_before_2000` får én fast tekst: «Sjiktet er fra før 2000.» med forslaget (ingen variant med byggeåret). `membrane_past_lifespan`: kilden er alderstabellen (punkt 3), og årsaksteksten er «funksjonen er usikker på grunn av alder». Ordet «levetid» brukes ikke i rapporttekst, for tallet er halv funksjonstid. `checkDocumentKeys` sjekker feltkodene på betingelsene (`age_*_element_key`, `documentation_element_key`, `material_element_key`, `unit_element_key`). Bare tekst endres, kodene står.
9. **Migrering:** én migrering `0031` med `rules_purpose_check` (`suggest_tg0`), `rooms_area_type_check` (`not_bra`) og `rule_conditions.negate`.
10. T-0010 og T-0016 settes til «rettet» med PR-nummer. Versjon 0.9.0. Ordlisten (`tg0`, `suggest_tg0`, `not_bra`, `negate`). `docs/05-domenemodell.md` (arealtype, regelformål, `negate`). «Trenger Ståle» i tilstandsfilen nevner både fuktgrensen og alderstabellen mot NS 3600:2025.

**Faste koder (regel 6):** utfall, spørsmål og regler som alt er merget, endres ikke i kode, bare i tekst, kilde og melding. Trengs ny betydning, arkiveres den gamle koden og en ny lages.

**Ikke med (bevisst utelatt):**
- Endre tallet 15 vekt-% eller alderstabellen (venter på at Ståle sjekker standarden).
- Regel for krav om hulltaking i rom under terreng, og egne regler for krypkjeller.
- Skjerm for regelforslag eller TG0-forslag i rapporten. «Badet på PC» må avgjøre hvor et godtatt TG0-forslag lagres; `deviations.suggested_by_rule_id` passer ikke, for TG0 er ikke et avvik.
- `not_bra` i arealsummene eller i etasjearealet.
- Kontrollen «TG0 bare ved 0–5 år» (regelverk-krav linje 207).
- Øvrige småfunn fra #167 og #159 (`readYear`, `__proto__`, `{sted}`, doble tester m.m.); de tas med «Badet på PC».
- T1–T4, K1–K9, I1–I3 og Byggcon-profilen (egne punkter i planen).

## Tilgang
Ingen endring, og ingen nye spørringer med `organization_id`. Maler og regler: som før (bare systemmalen har TG-regler). Bygninger: som før (`access.inspectors_edit_all`). Eksisterende tilgangs- og tenant-tester (`saveDraftContent`, romlagring) skal være grønne. Trenger koden likevel en ny spørring, kreves nytt kall til `expectTenantIsolation`.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
- `rules.purpose`: ny kode `suggest_tg0`. `rooms.area_type`: ny kode `not_bra`. `rule_conditions.negate`: ny kolonne. Alt i migrering `0031`.
- Ny regel `wet_room.hole_no_elevated_moisture` med betingelser og testsaker i badmalen, merket utkast.
- Ingen nye tabeller.

## Skjermer
Bygningsskjermen (iPad og PC): ett valg av etasjeforslaget fyller ut navn, nummer og under terreng (før: tre felt). Romtypen fyller ut arealtype som før, nå også «Ikke del av BRA». Ingen nye skjermer.

## Regler
| Regel | Formål | Slår til når | Kant |
|---|---|---|---|
| `wet_room.hole_no_elevated_moisture` (ny) | `suggest_tg0` | hull uten funn, vekt-% under grensen (`negate`) | 14,9 ja, 15,0 nei; RF %, tom: ikke vurdert |
| `wet_room.hole_moisture_over_limit` | `suggest_outcome` | hull tatt, vekt-% lik eller over | 15,0 ja, 14,9 nei |
| `wet_room.hole_drilling_not_done` | `suggest_tgiu` | hull ikke tatt | uendret |
| `wet_room.membrane_past_lifespan` | `suggest_outcome` | alder lik eller over tabellen | lik ja, én under nei |
| `wet_room.membrane_before_2000` | `suggest_outcome` | sjikt fra før 2000 | 1999 ja, 2000 nei |

### Testsaker i badmalen (inndata → forventet)
- 59a: bad fra 1985, hull uten funn, 14,9 vekt-% → TG0 på tilliggende, og fortsatt TG3-forslag på membran og sluk (før 2000). Hvert sitt kontrollpunkt.
- Hull uten funn, 15,0 → ikke TG0; `hole_moisture_over_limit` slår til (kant).
- Hull med funn, 14,9 → ikke TG0 (A238).
- Hull uten funn, RF % 85 / tom måling / tom enhet / negativ / tekst → TG0-regelen ikke vurdert.
- Hull uten funn, 0 vekt-% → TG0-forslag (0 er en gyldig måling for motoren; takstmannen kontrollerer, A238).
- Hull ikke tatt → ikke TG0, TGIU slår til.
- Tom hulltaking → ikke vurdert.
- Alder lik tabellverdien for hvert materiale, med og uten dokumentasjon → TG2-forslag; én under → ikke.
- Sjikt fra 1999 → TG3; fra 2000 → ikke.
- Meta-test: hver regel i badmalen har minst én testsak med «kant» i navnet.

## Akseptkriterier
- [ ] TG0-forslag på `wet_room.adjacent` ved hull uten funn og måling under grensen, uansett alder; 15,0 gir forhøyet fukt og ikke TG0; «med funn» gir ikke TG0 (testsaker i malen og `evaluate.test.ts`).
- [ ] `negate` snur sant og usant, og «ikke vurdert» står (`evaluate.test.ts`). Testen «forslaget er aldri TG0» er skrevet om til «TG0 bare fra formålet suggest_tg0».
- [ ] Ingen testsak gir TG0 og et annet forslag på samme kontrollpunkt (test på malfilen).
- [ ] Alle regler gir forslag ved lik grensen (F4, F5), med kanttestsak per regel.
- [ ] `suggest_tg0` krever kontrollpunkt med TG og avvises i egne maler; `blocker` avvises i egne maler og godtas i systemmalen (F9) (`schemas.test.ts`, `document.test.ts`).
- [ ] Kildene for fukt og alderstabellen sier NS 3600:2025 og utkast; tallet er fortsatt 15; kildeteksten er kort (lengdegrense i `data.test.ts`).
- [ ] `checkDocumentKeys` avviser ukjent feltkode på en betingelse, én sak per felt.
- [ ] `AREA_TYPES` er bra_i, bra_e, bra_b, not_bra. Kryperom og uinnredet loft foreslår `not_bra`; kryperom har `defaultBelowGround` false; summene er uendret (test). Migreringen godtar `not_bra` og `suggest_tg0` og avviser ukjent kode.
- [ ] `suggestFloor`: Kjeller og Underetasje gir -1 og under terreng; Loft gir høyeste + 1 med kantene over; fritekst gir `null` (enhetstest).
- [ ] Virker på iPad-størrelse og PC: den eksisterende e2e-testen for bygningsskjermen utvides (velg «Kjeller» → -1 og under terreng; endre til -2 og lagre; «Loft» → høyeste + 1; kryperom → «Ikke del av BRA»). Valget i listen gjøres med samme input-hendelse som et ekte valg.
- [ ] Eksisterende tilgangs- og tenant-tester grønne; `fase-1-prove-e-regler` grønn.
- [ ] Ingen KI-kall; regelsvaret har bare koder og tall.
- [ ] T-0010 og T-0016 satt til «rettet»; A234–A240 ført i `docs/09-apne-sporsmal.md`.

## Beslutninger (autonom modus)
- **A234:** TG0 som eget regelformål `suggest_tg0` og egen forslagstype `tg0`, ikke som utfall (TG0 er ikke et avvik). Dyrt å endre (fast kode).
- **A235:** Arealtypen `not_bra` som egen kode, ikke tom arealtype (kolonnen er påkrevd). Merking på rommet, påvirker ikke summene. Dyrt å endre (fast kode).
- **A236:** «Kjeller» og «Underetasje» gir -1 og under terreng forhåndsvalgt (F7); «Loft» gir høyeste + 1 innenfor -3 til 20. Lett å endre.
- **A237:** «Under grensen» som `rule_conditions.negate` på samme terskel, ikke egen terskel med `lt` og ikke fast verdi på betingelsen. Én grense og ett sted å rette tallet. Dyrt å endre (kolonne og dokumentformat).
- **A238:** TG0-forslaget bare ved «utført uten funn»; «med funn» vurderer takstmannen selv. 0 vekt-% behandles som en måling. Regelens kilde er Ståles beslutning, ikke NS 3600. Spørsmål 77 a og b. Lett å endre (data i malen).
- **A239:** «Under terreng» er et faktum om plasseringen og følger etasjen også for kryperom; unntaket fra hulltaking knyttes til romtypen `crawl_space` når kravet bygges. Lett å endre.
- **A240:** Alle uinnredede loft foreslås som «Ikke del av BRA», som forslag takstmannen kan endre; uinnredet kjellerrom er fortsatt BRA-i. Spørsmål 77 d. Lett å endre.

## Avgjort ved uenighet i forhåndsvurderingen
- **TG0 med funn:** arkitekt, fagansvarlig og test-leder pekte på risikoen. Valgt: bare «uten funn» (A238), fordi «med funn» betyr at noe er sett i hullet.
- **Kryperom og «under terreng» i etasje under terreng:** fagansvarlig ville ha «ikke under terreng» også der; arkitekt og test-leder ville beholde faktumet. Valgt: faktumet står, og unntaket fra hulltaking knyttes til romtypen (A239). Begrunnelse: «under terreng» brukes også til annet enn hulltaking, og romtypen er den sikre bæreren av unntaket.
- **Notat om hulltaking i koden:** arkitekt ville ha notat i koden, forenkler ikke. Valgt: i kortet og domenemodellen, der datamodellen er fasit.
- **0 vekt-%:** fagansvarlig foreslo «ikke vurdert». Valgt: 0 er en måling for motoren, så vi slipper en ny særregel i motoren; takstmannen godkjenner alltid forslaget. Lett å endre.
- **F9-test:** test-leder ville ha integrasjonstest på lagring av egen mal; forenkler og arkitekt mente enhetstest holder. Valgt: enhetstest av den rene funksjonen, og at den kalles fra samme sted som `checkNoTgLogicInCustom`, som alt dekker begge lagringsveiene. Egne maler kan ikke opprettes ennå.
- **Meldingen på `membrane_before_2000`:** én fast tekst (forenkler), ikke variant med byggeåret.
- **E2e:** den eksisterende testen for bygningsskjermen utvides, ingen ny fil.

## Roller
utvikler (motor, maler, bygninger, migrering), testskriver (testsaker, enhet, e2e). Arkitekt og fagansvarlig har gjort forhåndsvurderingen; gjennomgangen etter bygging som vanlig.

## Åpne spørsmål
- Spørsmål 77 i `docs/09-apne-sporsmal.md`: TG0 eldre enn 5 år, «med funn», 15 vekt-% og alderstabellen mot NS 3600:2025, og hvilke loft som er «ikke del av BRA».
