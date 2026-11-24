# Funksjon: «Hvorfor har dette punktet denne TG-en?» (spor og forklaringsutkast)

- **Fase:** 2a-2 Hele veien først (fra forbedreren 23.11.2026, bygger på «Godtatt forslag og avvik henger alltid sammen», PR #239)
- **Modul:** kjerne / `src/core/reports` (sporet), `src/core/ai` (forklaringsutkastet), badet på PC og iPad, reklamasjonssaken
- **Branch:** `tg-spor` (bygger på main)
- **Status:** utkast
- **A-numre:** A590–A599 (A527–A529 og A543–A549 holdes ledige; A530–A542 er tatt av `pdf-motor-badet`, A550–A563 av `skriv-det-du-ser`, A564–A577 av `overstyringer-leder`). **Spørsmål:** 124 og oppover (120–123 er tatt på andre brancher). **Versjon:** 0.19.8 (én patch over main).
- **Støtter hovedmål:**
  - **Reklamasjoner:** når en kjøper klager, ser leder med ett klikk hvorfor punktet fikk graden: hva reglene foreslo, hva takstmannen valgte, og grunnen. Svaret på reklamasjonen kan bygges på fakta i stedet for hukommelse.
  - **De ansatte:** takstmannen ser selv hvorfor punktet har graden før han publiserer, uten å lete i logger. Leder slipper å spørre takstmannen.
  - **KI i bunnen:** KI skriver et utkast til en kort, saklig forklaring av graden ut fra koder, TG og målinger, som takstmannen eller lederen godtar, endrer eller avviser.

## Problem

Beslutningsloggen for regelforslag (`rule_suggestion_decisions`) er sann og komplett etter PR #239, men ingen kan se den. Endringer på avvik (TG byttet, avvik fjernet, gjenopprettet) står i revisjonsloggen, også usynlig. Ved en reklamasjon må leder i dag spørre takstmannen hvorfor et punkt fikk TG2 og ikke TG3. Lar vi være, blir svaret på reklamasjonen tregere og svakere, og takstmannen ser ikke selv at et TG3-forslag ble endret uten god grunn før han publiserer.

## KI i bunnen

- **Fra første dag:** knappen «Lag forklaring» i sporet gir et KI-utkast på 2–4 setninger om hvorfor punktet har graden, for eksempel: «Reglene foreslo TG3 fordi fuktmålingen viste 25 %. Takstmannen satte TG2 med grunnen ‹Dokumentasjon er lagt fram›.» Den ansatte velger «Bruk» (godta), retter teksten (endre) eller «Forkast» (avvis). Alt logges i `ai_usage_log`.
- **Ny KI-funksjon `tg_explanation`** i `src/core/ai/features.ts`, med egen ledetekst (`tg_explanation.v1`), tillatt-liste over feltkoder, persondatavask, TG-vakt og tallvakt (samme mønster som `summary_draft`), falsk leverandør og eget evalueringssett `src/core/ai/evals/tg_explanation.cases.json` (`pnpm ai:eval tg_explanation`).
- **Det som går til KI** (bare faste koder, tall og etiketter fra den låste malen): kontrollpunktets navn og kode, romtype, regelkode og foreslått TG, beslutning (godtatt / endret / avvist), valgt TG, begrunnelseskode (`override_reason_code`) med etikett, målinger med verdi og enhet, byggeår-sjikt hvis regelen bruker det, og om avviket står eller er fjernet. **Aldri:** navn, e-post, telefon, adresse, matrikkel, begrunnelsesteksten, avviksteksten, reklamasjonens beskrivelse eller klageren.
- **Vakter:** svaret stoppes hvis det nevner en annen TG enn den punktet har eller forslaget hadde, et tall som ikke står i inndata, eller gjetteord («antas», «trolig»). KI setter aldri TG og endrer ingenting i rapporten.
- **Data som lagres for KI:** ingenting nytt i rapporten. Sporet leses fra det som finnes. Utkastet og avgjørelsen står i `ai_usage_log` med mål `checkpoint_result` / `tg_explanation` (feltkode som ikke er en kolonne, som `new_measure`; arkitekten bekrefter). Den endelige teksten lagres ikke i rapporten eller reklamasjonen; den kopieres inn i svaret (se «Ikke med» og A590).
- Uten nett eller med KI av: sporet virker som før, knappen sier «Trenger nett» eller «KI er ikke slått på».

## Brukerhistorier

- Som **takstmann** vil jeg trykke «Spor» på et avvik eller et punkt med regelforslag og se hele kjeden med tid og rolle, slik at jeg vet at graden er godt begrunnet før jeg publiserer.
- Som **leder** vil jeg åpne en reklamasjonssak og se sporet for punktene i rapporten, slik at jeg kan svare kjøperen med fakta.
- Som **leder** vil jeg få et KI-utkast til en kort forklaring av graden som jeg retter og kopierer inn i svaret, slik at svaret går raskere og blir saklig.

## Omfang

**Med:**

1. **Sporet som ren lesetjeneste** i `src/core/reports` (ny fil, for eksempel `tg-trail.ts`): `getTgTrail(grant, reportId, checkpointResultId)` gir en ordnet liste med linjer. Hver linje har tid, rolle (takstmann, leder, admin, «Reglene»), hendelse og detaljer. Kilder:
   - `rule_suggestion_decisions` for punktet: forslag (regelkode, foreslått TG, målingen som utløste den), beslutning (godtatt / endret / avvist), valgt TG, begrunnelseskode som etikett.
   - Revisjonsloggen for avvikene på punktet: avvik laget, TG byttet (fra → til), avvik fjernet, avvik gjenopprettet.
   - Utledet linje «Forslaget er åpent igjen» når gjeldende beslutning ikke lenger gjelder (bruk `isEffectiveDecision` fra `logic/effective-decision.ts`, ingen ny logikk).
   - Gjeldende TG på punktet øverst.
   Begrunnelsesteksten vises bare for den som får se den i dag (`canSeeOverrideReasons`); andre ser bare etiketten for koden. Navn på ansatte vises ikke, bare rolle (A591).
2. **«Spor» på badskjermen (PC og iPad).** En liten lenkeknapp «Spor» på hvert avvikskort og på hvert punkt som har regelforslag. Åpner et panel (dialog på iPad, sidepanel på PC) med linjene som en tidslinje, nyeste nederst. Tastaturbetjent, lesbar for skjermleser (liste med tid som `<time>`), WCAG AA. Lastes først når den åpnes (ikke i rommets første lasting). Uten nett: «Sporet trenger nett» (sporet bygges på serveren, A592).
3. **Samme spor fra reklamasjonssaken** (bare leder og admin, regel 12). På siden for saken: en del «Hvorfor fikk punktene graden?» med rapportene på oppdraget og punktene som har avvik med TG2, TG3 eller regelforslag, gruppert per rom, med «Spor» som åpner samme panel. Samme lesetjeneste; tilgang krever `claims.read` i tillegg til lesetilgang til rapporten.
4. **KI-funksjonen `tg_explanation`** som beskrevet under «KI i bunnen», tilgjengelig fra sporpanelet både på badskjermen og i reklamasjonssaken. Godta / endre / avvis går gjennom `decideAiText` og logges. «Kopier» legger teksten på utklippstavlen. Låst etter publisering? Nei: forklaringen endrer ikke rapporten, så den kan lages også etter publisering (nødvendig ved reklamasjon).
5. **Evalueringssett** med minst 12 saker: godtatt TG3, endret TG3 → TG2 med kode, avvist forslag, TG0 og TGIU, avvik fjernet og forslag åpent igjen, flere målinger, og vaktsaker (feil TG i svaret, oppdiktet tall, gjetteord, persondata i inndata som skal vaskes bort).
6. **Ordliste og domenemodell:** «spor» (`tg_trail`), `tg_explanation`.

**Ikke med (bevisst utelatt):**

- Ingen nye tabeller og ingen migrering. Hvis arkitekten finner at en indeks trengs for revisjonsloggen per avvik, tas det opp som eget spørsmål i stedet.
- Den endelige forklaringen lagres ikke i reklamasjonen eller rapporten (ingen «svar på reklamasjon»-felt finnes; det er et eget forslag til Ståle, A590).
- Ikke spor for vanlige feltsvar uten regelforslag eller avvik.
- Ikke spor i PDF-en eller i rapporten kunden ser.
- Ikke statistikk på tvers av rapporter (det er «Overstyringer for leder»).
- KI foreslår aldri ny TG, og vurderer ikke om graden er riktig.
- Ingen e-post eller sending av forklaringen.

## Tilgang

| Rolle | Se sporet på badet | Se sporet fra reklamasjonssaken | Lage / avgjøre KI-utkast | Se begrunnelsesteksten |
|---|---|---|---|---|
| takstmann | ja, som badet (`reports.read`, `access.inspectors_edit_all`) | nei | ja, på badet | som i dag |
| kontor | ja, hvis kontor kan se badet i dag | nei | nei | nei (`canSeeOverrideReasons`) |
| leder | ja | ja (`claims.read`) | ja | ja |
| admin | ja | ja | ja | ja |

All tilgang sjekkes i `src/core/access`. Spørringene filtrerer på `grant.organizationId`. `expectTenantIsolation` for `getTgTrail`, listen i reklamasjonssaken og `tg_explanation`.

## Data

Ingen nye tabeller eller kolonner. Leser `rule_suggestion_decisions`, `deviations`, `checkpoint_results`, `audit_log`, `claims`, `reports`. Ny KI-funksjonskode `tg_explanation` og feltkode `tg_explanation` på mål `checkpoint_result` (fast kode, regel 6). Oppdater `docs/05-domenemodell.md` og ordlisten.

## Skjermer

- **Badet (PC og iPad):** «Spor» på avvikskort og forslagskort. 1 trykk for å se sporet (i dag: ikke mulig). «Lag forklaring» i panelet: 1 trykk, så «Bruk» / rett / «Forkast», og «Kopier».
- **Reklamasjonssak (PC og iPad):** ny del med punktene og «Spor». 1 trykk fra saken til sporet (i dag: spørre takstmannen).

## Regler

Ingen nye regler. Teksten for hver linje i sporet og etikettene for begrunnelseskodene ligger i `logic/labels.ts` (egne formuleringer). Ledeteksten `tg_explanation.v1` er egen formulering, uten gjetteord og uten henvisning til standarder. Merkes «utkast, ikke godkjent av fagrådet» der den står som fagtekst.

## Akseptkriterier

- [ ] Sporet viser forslag, beslutning, TG-bytte med grunn, fjernet avvik og «Forslaget er åpent igjen» i riktig rekkefølge med tid og rolle (enhetstest av sammensettingen og integrasjonstest mot databasen).
- [ ] Begrunnelsesteksten vises ikke for kontor; etiketten for koden vises (test).
- [ ] Takstmann og kontor får verken delen eller sporet fra reklamasjonssaken, også med `access.inspectors_edit_all` på (test og e2e).
- [ ] Bruker i annen organisasjon får ikke tilgang til sporet, listen eller KI-funksjonen (`expectTenantIsolation`).
- [ ] KI-utkastet kan godtas, endres og avvises, og logges i `ai_usage_log` (test mot falsk leverandør).
- [ ] Ingenting av navn, e-post, telefon, adresse, matrikkel, begrunnelsestekst, avvikstekst eller reklamasjonstekst går til KI (no-leak-test på inndata).
- [ ] Vaktene stopper feil TG, oppdiktede tall og gjetteord (test), og `pnpm ai:eval tg_explanation` består.
- [ ] Ingen endring i rapporten eller TG når forklaringen lages eller avgjøres (test).
- [ ] Virker på PC og iPad-størrelse, med axe uten brudd (e2e).
- [ ] Sporet lastes ikke med rommet; rommets lastetid endres ikke (test eller måling).
- [ ] Versjon 0.19.8, domenemodell og ordliste oppdatert, beslutningene ført i `docs/09-apne-sporsmal.md`.

## Beslutninger tatt av agentene (autonom modus, føres i `docs/09-apne-sporsmal.md`)

- **A590 (lett å endre):** forklaringen lagres bare i `ai_usage_log`, ikke i reklamasjonen. Et felt for «svar på reklamasjonen» er et eget forslag til Ståle.
- **A591 (lett å endre):** sporet viser rolle, ikke navn, på hver linje. Navnet finnes i revisjonsloggen for admin.
- **A592 (lett å endre):** sporet bygges på serveren og krever nett; badet virker ellers som før uten nett.

## Åpne spørsmål

- 124 (stopper ikke bygging): Skal reklamasjonssaken få et eget felt for svaret til klageren, der godtatt forklaring kan lagres? (Ny funksjon, Ståle avgjør.)
