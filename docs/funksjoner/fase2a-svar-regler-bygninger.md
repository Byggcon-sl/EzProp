# Funksjon: Svarene i reglene og bygningene (F1–F7, F9)

- **Fase:** 2a, delen «Fra Ståles svar 12.11.2026», første punkt
- **Modul:** kjerne (`src/core/rules`, `src/core/buildings`, `src/core/templates`), badmalen (`src/db/seed/templates/wet-room.ts`), bygningsskjermen
- **Branch:** `svar-stale-regler-bygninger`, bygger på `svar-stale-12-11-i-planen` (PR #168)
- **Status:** utkast
- **Støtter hovedmål:** Reklamasjoner: reglene følger fagrådets svar (TG0 bare når det er målt, TGIU når det ikke er undersøkt, kantverdier gir forslag), og kryperom og kjeller får riktig areal og «under terreng» fra start. De ansatte: færre felt å rette selv (etasjenummer, under terreng, arealtype fylles ut). KI i bunnen: regelsvarene er strukturerte koder og tall som KI-forslagene senere bygger på.

Fasit: `docs/kartlegging/svar-fra-stale-2026-11-12.md` (F1–F7, F9).

## Problem
Reglene for badet (PR #167) ble laget før fagrådet svarte. Ingen regel foreslår TG0 (A224), kildene sier «bransjepraksis» og ikke NS 3600:2025, og kryperom regnes som BRA-i og «under terreng» (T-0016). Etasjen «Kjeller» får nummer 2 og ikke «under terreng» (T-0010). Lar vi det stå, får takstmannen feil forslag og feil areal, som er vanlige grunner til reklamasjon.

## KI i bunnen
- KI gjør ikke noe nytt her. Regelmotoren er bevisst uten KI (ADR 0009): samme rene funksjoner på iPad og server, og KI setter aldri TG.
- Det som lagres for KI: regelsvaret (regelkode, tilstand, forslag, begrunnelse som koder og tall, kode på terskel- og levetidssett) og arealtypen og «under terreng» som faste koder. Dette er grunnlaget når KI senere skriver utkast til avvikstekst og foreslår rom fra plantegning (T4). Ingen fritekst og ingen persondata i regelsvaret.
- Ingen nye kall til `src/core/ai`. Takstmannen godtar, endrer eller avviser regelforslaget som før.

## Brukerhistorier
- Som **takstmann** vil jeg få forslag om TG0 på tilliggende konstruksjoner når jeg har tatt hull og målt under grensen, slik at et gammelt bad med god måling ikke får TG2 bare på grunn av alder.
- Som **takstmann** vil jeg at «Kjeller» og «Underetasje» får etasje -1 og «Under terreng» krysset av, og at kryperom og uinnredet loft ikke regnes som BRA, slik at arealet blir riktig uten at jeg retter det.

## Omfang
**Med:**
1. **F1, ny regel og nytt formål.** Nytt regelformål `suggest_tg0` (ny fast kode i `RULE_PURPOSES` og `TG_RULE_PURPOSES`, migrering for CHECK-regelen) og ny forslagstype `{ kind: "tg0", checkpoint_key }` i `RuleSuggestion`. Ny regel `wet_room.hole_no_elevated_moisture` på `wet_room.adjacent`: hulltaking `done_no_findings` eller `done_with_findings`, og fuktmåling i vekt-% under grensen, gir forslag om TG0 uansett alder. Lik grensen gir ikke TG0 (da slår `hole_moisture` til). Måling i RF % eller tom måling gir «ikke vurdert». TG0 bare lov i systemmalen, som andre TG-formål. ADR 0009 punkt 7 («Motoren foreslår aldri TG0») rettes i samme PR. A224 endres (ny linje i `docs/09-apne-sporsmal.md`).
2. **F2.** Regelen `hole_not_done` beholdes (TGIU). Meldingen sier at begrunnelse og risikovurdering skal fylles ut. Kilden rettes til forskriften og Ståles beslutning 25.10.2026 og 12.11.2026 (småfunn fra #167).
3. **F3.** `source_ref` for fuktgrensen (`thresholds.ts`), levetidene (`lifespans.ts`) og reglene i badmalen sier «NS 3600:2025 …, utkast, ikke godkjent av fagrådet». Tallet 15 vekt-% står (Ståle sjekker mot standarden, står under «Trenger Ståle»). Testen i `data.test.ts` som forbyr «NS» i kilden, rettes. Ingen tekst fra standarden, bare navn og tall.
4. **F4, F5.** Gå gjennom alle regler og testsaker: lik grensen gir forslag (alder lik levetiden, fukt lik grensen). Testsaker for kantverdiene finnes for hver regel, også den nye (15,0 gir ikke TG0, 14,9 gir TG0). A226 merkes bekreftet av Ståle 12.11.2026.
5. **F9.** `validate`-regler i egne maler (`custom`) kan bare ha `severity = warning`; `blocker` avvises ved lagring i `src/core/templates` med test. Bare systemkravene sperrer.
6. **F6, T-0016.** Ny arealtype `not_bra` («Ikke del av BRA») i `AREA_TYPES` (ny fast kode sist, migrering for `rooms_area_type_check`). Summene teller den ikke med i BRA. Romtypene `crawl_space` og `unfinished_attic` får `not_bra` som forslag, og `crawl_space` får `defaultBelowGround: false`. Takstmannen kan endre begge. Kryperom følger krypkjeller, uten krav om hulltaking (kravet finnes ikke ennå; notat i koden der det kommer).
7. **F7, T-0010.** Etasjeforslagene i bygningsskjermen fyller ut nummer og «under terreng»: «Kjeller» og «Underetasje» gir -1 og «Under terreng» krysset av, «Loft» gir høyeste etasje + 1. Bare forslag ved valg; takstmannen kan endre. Forslagslogikken som ren funksjon i `src/core/buildings` med tester.
8. **Småfunn fra #167 som er små:** kilde på TGIU-regelen (punkt 2); meldingen på `membrane_before_2000` sier «byggeåret» når byggeåret er brukt, eller generelt «sjiktet er fra før 2000»; kilde (levetidstabellen) og årsaksteksten «funksjonen er usikker på grunn av alder» på `membrane_past_lifespan`; `checkDocumentKeys` sjekker feltkodene på betingelsene (`age_*_element_key`, `documentation_element_key`, `material_element_key`, `unit_element_key`).
9. T-0010 og T-0016 settes til «rettet» med PR-nummer. Versjon opp (minor, 0.9.0). Ordlisten (`tg0`, `not_bra`). `docs/05-domenemodell.md` (arealtype, regelformål).

**Faste koder (regel 6):** utfall, spørsmål og regler som alt er merget, endres ikke i kode, bare i tekst, kilde og melding. Trengs ny betydning, arkiveres den gamle koden og en ny lages.

**Ikke med (bevisst utelatt):**
- Endre tallet 15 vekt-% eller levetidene (venter på at Ståle sjekker standarden).
- Regel for krav om hulltaking i rom under terreng, og egne regler for krypkjeller.
- Skjerm for regelforslag eller TG0-forslag i rapporten («Badet på PC»).
- Øvrige småfunn fra #167 og #159 (`readYear`, `__proto__`, `{sted}`, doble tester m.m.); de tas med «Badet på PC».
- T1–T4, K1–K9, I1–I3 (egne punkter i planen).
- Byggcon-profilen.

## Tilgang
Ingen endring. Maler og regler: som før (bare systemmalen har TG-regler). Bygninger: som før (`access.inspectors_edit_all`).

| Rolle | Se | Endre |
|---|---|---|
| takstmann | som før | som før |
| kontor | som før | som før |
| leder | som før | som før |
| admin | som før | som før |

## Data
- `rules.purpose`: ny kode `suggest_tg0` (migrering, CHECK).
- `rooms.area_type`: ny kode `not_bra` (migrering, CHECK). Arealsummen hopper over den.
- Ny regel `wet_room.hole_no_elevated_moisture` med betingelser og testsaker i badmalen, merket utkast.
- Ingen nye tabeller, ingen nye spørringer med `organization_id` (eksisterende tenant-tester holder; lagring av mal med sperre i egen mal får test).

## Skjermer
Bygningsskjermen (iPad og PC): ett trykk på etasjeforslaget fyller ut navn, nummer og under terreng (før: tre felt). Romtypen fyller ut arealtype som før, nå også «Ikke del av BRA». Ingen nye skjermer.

## Regler
| Regel | Formål | Slår til når | Kant |
|---|---|---|---|
| `wet_room.hole_no_elevated_moisture` (ny) | `suggest_tg0` | hull tatt, vekt-% under grensen | 15,0 ikke, 14,9 ja; RF % og tom: ikke vurdert |
| `wet_room.hole_moisture` | `suggest_outcome` | hull tatt, vekt-% lik eller over | 15,0 ja, 14,9 nei |
| `wet_room.hole_not_done` | `suggest_tgiu` | hull ikke tatt | uendret |
| `membrane_past_lifespan`, `membrane_before_2000` | `suggest_outcome` | alder lik eller over levetiden / før 2000 | lik gir forslag |

Svar 59a (bad fra 1985, hull tatt, 14,9): TG0-forslag på tilliggende, ingen TG2 fra fukt.

## Akseptkriterier
- [ ] Ny regel gir TG0-forslag ved hull tatt og måling under grensen, uansett alder; lik grensen gir forhøyet fukt og ikke TG0 (testsaker i malen og i `evaluate.test.ts`).
- [ ] Alle regler gir forslag ved lik grensen (F4, F5), med kanttestsak per regel.
- [ ] `suggest_tg0` avvises i egne maler; `blocker` avvises i egne maler (F9), med tester.
- [ ] Kildene for fukt og levetider sier NS 3600:2025 og er merket utkast; ingen tekst fra standarden.
- [ ] `checkDocumentKeys` avviser ukjent feltkode på en betingelse (test).
- [ ] Kryperom og uinnredet loft får «Ikke del av BRA»; kryperom ikke under terreng; arealet telles ikke i BRA (test).
- [ ] Kjeller og Underetasje gir -1 og under terreng, Loft gir høyeste + 1, og alt kan endres (enhetstest og e2e).
- [ ] Bruker i annen organisasjon får ikke tilgang (eksisterende tester grønne; ny test for lagring av egen mal).
- [ ] Virker på iPad-størrelse (e2e for etasjeforslaget).
- [ ] Ingen KI-forslag i denne oppgaven; regelsvaret har bare koder og tall.
- [ ] T-0010 og T-0016 satt til «rettet»; A234 og videre ført i `docs/09-apne-sporsmal.md`.

## Beslutninger (autonom modus, fra A234)
- A234: TG0 som eget regelformål `suggest_tg0` og egen forslagstype, ikke som utfall (TG0 er ikke et avvik). Dyrt å endre (fast kode).
- A235: Arealtypen `not_bra` som egen kode i stedet for tom arealtype (kolonnen er påkrevd, og summene blir enklere). Dyrt å endre (fast kode).
- A236: «Underetasje» får -1 og under terreng forhåndsvalgt (F7); «Loft» høyeste + 1. Lett å endre.

## Roller
arkitekt (nytt regelformål og ADR 0009), fagansvarlig (tekster, kilder, kantverdier), utvikler, testskriver.

## Åpne spørsmål
- Tallet 15 vekt-% mot NS 3600:2025 (Ståle, står under «Trenger Ståle»).
