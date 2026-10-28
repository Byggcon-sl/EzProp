# Prøve A og B med ElectricSQL: protokoll og resultat

- **Kandidat:** ElectricSQL (andre kandidat). Oppgavekort: `docs/funksjoner/fase1-kandidat-electricsql.md`. Protokollen er den samme som for PowerSync (`docs/funksjoner/fase1-prove-ab-powersync.md`), steg for steg, så tallene kan sammenlignes rad for rad.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve A (må) og prøve B (bør). Kriteriene for alle kandidater står i `docs/funksjoner/fase1-testskjema.md` («Plan for prøvene A–F» og «Kriterier for å sammenligne kandidatene»).
- **Status:** mal, ikke kjørt. Fylles inn av Ståle (tall og skjermopptak) og utvikler (teknisk).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad) og reklamasjoner (ingenting går tapt mellom befaring og rapport).

Samme protokoll brukes for PowerSync, ElectricSQL og egenbygd, i hver sin fil, så kandidatene kan sammenlignes tall for tall. Velg **«ElectricSQL»** under «Synkløsning» på listen «Testskjema» på begge iPadene før du starter.

## Før du starter (begge prøver)

1. Testmiljøet i Azure er oppe (PR #7) og ElectricSQL kjører ved siden av appen (`docs/drift/electricsql.md`). `/api/helse` svarer, og versjonen er 0.2.2 eller nyere.
2. To iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm). Åpne appen **fra hjemskjermen**, ikke fra Safari.
3. Slå av Stedstjenester for Safari på begge iPadene (Innstillinger → Personvern og sikkerhet → Stedstjenester → Safari → Aldri), ellers får bildene posisjonen til stedet (spørsmål nr. 8).
4. Logg inn på begge iPadene, åpne listen «Testskjema» én gang **med nett**, velg «ElectricSQL» under «Synkløsning» på begge, og se at indikatoren viser «Alt er lagret på serveren». Da ligger appen og skjemaet i hurtiglageret.
5. **Bare oppdiktede data.** Ingen ekte adresser, navn eller bilder av personer eller dokumenter. Ta bilder av vegger, gulv, utstyr og lignende.
6. Start skjermopptak på iPaden (Kontrollsenter → Skjermopptak) før hver prøve. Lagre opptaket i SharePoint-mappen `Claude/03 Arbeidsmappe/Fase 1 prøver/` og lim inn lenken under.

## Prøve A – én takstmann uten nett (må)

Kjøres **tre ganger**, gjerne på begge iPadene samtidig med hvert sitt skjema.

| Steg | Gjør dette | Noter |
|---|---|---|
| A1 | Nett på. Åpne appen fra hjemskjermen, trykk «Nytt testskjema», åpne det. Se at indikatoren viser «Alt er lagret på serveren». | Klokkeslett start |
| A2 | Slå på flymodus. Indikatoren skal vise «Uten nett». | |
| A3 | Fyll ut alle 40 felt. Telleren skal nå «40 av 40 felt utfylt». | Tid brukt |
| A4 | Ta **200 bilder** fordelt på de åtte bildefeltene (ca. 25 per felt), ett og ett med kameraknappen. Indikatoren teller bilder som venter. | Antall bilder indikatoren viser |
| A5 | Lukk appen helt (sveip opp fra appveksleren). Åpne igjen fra hjemskjermen. Skjemaet skal åpne uten nett med alle svar og alle bilder. | Åpnet? Antall felt og bilder etter åpning |
| A6 | Start iPaden på nytt. Åpne appen fra hjemskjermen. Samme kontroll som A5. | Åpnet? Antall felt og bilder etter omstart |
| A7 | Slå av flymodus. La appen ligge åpen. Ta tiden til indikatoren viser «Alt er lagret på serveren». | **Tid til synk ferdig** |
| A8 | På PC: åpne samme testskjema. Tell felt (telleren) og bilder per felt. Sammenlign med iPaden. | Felt på server / bilder på server |
| A9 | Stopp skjermopptaket. | Lenke |

**Bestått når:** alle 40 svar og alle 200 bilder er på serveren etter alle tre rundene, ingenting mangler og ingenting er dobbelt.

### Resultat prøve A

| Runde | iPad | Felt lokalt | Felt på server | Bilder lokalt | Bilder på server | Tid til synk ferdig | Overlevde lukking (A5) | Overlevde omstart (A6) | Skjermopptak |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | / 40 | / 40 | / 200 | / 200 | min sek | ja / nei | ja / nei | lenke |
| 2 | | / 40 | / 40 | / 200 | / 200 | | | | |
| 3 | | / 40 | / 40 | / 200 | / 200 | | | | |

**Det som ikke virket (prøve A):**
-

**Vurdering:** bestått / delvis / ikke bestått. Begrunnelse:

## Prøve B – to i samme skjema (bør)

Begge iPader **med nett**, samme testskjema (åpne det samme navnet fra listen på begge).

| Steg | Gjør dette | Noter |
|---|---|---|
| B1 | Begge åpner samme skjema. Begge indikatorer viser «Alt er lagret på serveren». | |
| B2 | **Tekst:** iPad 1 skriver en setning i «Tak – beskrivelse». Samtidig skriver iPad 2 en annen setning i samme felt. Vent til begge indikatorer sier «Alt er lagret på serveren». | Hva står i feltet på iPad 1, iPad 2 og på PC? |
| B3 | **TG:** iPad 1 setter «Tak – tilstandsgrad» til TG2. Samtidig setter iPad 2 TG3. Vent på synk. | Hvilken verdi vant? Viste den andre iPaden «Endret av en annen»? |
| B4 | **Tall:** iPad 1 skriver 12 i «Fuktmåling gulv». Samtidig skriver iPad 2 18. Vent på synk. | Hvilken verdi vant? Varsel på den andre? |
| B5 | **Valg:** iPad 1 velger «Ja» på «Fall mot sluk», iPad 2 velger «Nei». Vent på synk. | Hvilken vant? Varsel? |
| B6 | Gjenta B2 én gang til med lengre tekst (to–tre setninger hver) der begge skriver midt i teksten. | Er begge bidrag med? Er noe borte eller dobbelt? |

**Bestått når:** teksten har begge bidrag (ingenting borte); TG, tall og valg har samme verdi på begge iPader og på PC, og den iPaden som ikke vant, viste «Endret av en annen».

**Ventet oppførsel som ikke er feil (skrives likevel i resultatet):**
- Rekkefølgen på serveren avgjør hvem som vinner for TG, tall og valg. En endring fra en iPad som var lenge uten nett, kan derfor slå en nyere endring fra den andre. Det er dagens modell («siste endring vinner»).
- Hvis begge iPader fylte samme felt mens de var uten nett, beholder serveren den raden som kom først; den andre iPaden ser verdien bytte når synken er ferdig. Ingen data går tapt.

### Resultat prøve B

| Steg | Felt | iPad 1 skrev | iPad 2 skrev | Resultat på server | Likt på begge iPader | Varsel vist hos den andre | Skjermopptak |
|---|---|---|---|---|---|---|---|
| B2 | Tak – beskrivelse | | | | ja / nei | – | lenke |
| B3 | Tak – tilstandsgrad | TG2 | TG3 | | ja / nei | ja / nei | |
| B4 | Fuktmåling gulv | 12 | 18 | | ja / nei | ja / nei | |
| B5 | Fall mot sluk | Ja | Nei | | ja / nei | ja / nei | |
| B6 | Tak – beskrivelse (lang) | | | | ja / nei | – | |

**Det som ikke virket (prøve B):**
-

**Vurdering:** bestått / delvis / ikke bestått. Begrunnelse:

## Teknisk som utvikleren fyller inn (før PR-en åpnes)

Fylles inn i byggingen, også det som ikke virket. Det er grunnlaget for kriteriene «Arbeid» og «Modenhet» i sammenligningen. Spørsmålene speiler PowerSync-filen der det gir mening, pluss det som er særegent for ElectricSQL (lesing via shapes, egen endringskø).

| Spørsmål | Svar |
|---|---|
| Hvilken lokal lagring valgte arkitekten (PGlite eller egen IndexedDB-lagring), og hvorfor? Hvilken lagring bruker den i Safari på iPad og i Chromium? | Egen IndexedDB-lagring (alternativ b, avgjørelse D): databasen `offline-trial-electric` med lagrene `synced_trial_forms`, `synced_trial_answers` (unik indeks på skjema + felt), `synced_trial_photos`, `shape_state` og `outbox`, rått API uten avhengighet og uten wasm. Samme lagring i Safari og Chromium. **PGlite (a) er forkastet:** wasm på flere MB, egen worker og hurtiglagring i service workeren, og vi måtte uansett eie endringskøen selv. Lageret kan brukes av kandidat 3 som det er, bare med en annen lesevei. Bildene ligger som før i `offline-trial-photos`. |
| Hvordan lagres synkposisjonen (`offset`/`handle`) så synken fortsetter der den slapp etter lukking og omstart? | Én rad per tabell i `shape_state` (`table`, `handle`, `offset`, `upToDate`). Raden skrives i **samme IndexedDB-transaksjon** som radene fra svaret, etter innflettingen, så posisjonen aldri ligger foran dataene. Ved oppstart hentes hver tabell fra lagret posisjon; etter `up-to-date` går den over til `live=true` (lang-polling) med `cursor`. 409 eller `must-refetch`: posisjonen og de synkede radene for tabellen slettes og alt hentes fra `offset=-1`. Rader med usendte endringer blir stående (ellers forsvinner de fra skjermen til de er sendt), og køen røres aldri. Vist i nettleseren med simulerte Electric-svar (200 med `up-to-date`, så `live`, så 409). |
| Endringskøen: hvordan er den bygget, hvor ligger den, og hva skjer med bunter serveren avviser? | Ren tilstandsmaskin i `sync/electricsql/outbox.ts` (`enqueue`, `takeBatch`, `ackBatch`, `keepBatch`, `pendingKeys`), lagret i objektlageret `outbox` (`seq` → operasjon), neste `seq` i `shape_state`. Hver skriving legger raden i `synced_*` og operasjonen i `outbox` i samme transaksjon. Samme rad slås sammen med opprinnelig `seq`; skjemaet sendes alltid først fordi `createForm` legger det i køen før første svar. Bunter på høyst 500 i `seq`-rekkefølge til `POST /api/prove/synk/endringer`, bare med nett, tas ut **bare ved 200**. Det som skrives mens en bunt er underveis, får ny `seq` og går i neste bunt (vist i nettleseren: to bunter, `7` så `8`). Alt annet (4xx, 5xx, avbrutt) beholder bunten med ventetid 5, 10, 20, 40, 60 s. **Kjent svakhet (som PR #8):** en bunt serveren avviser med 400/409, blir liggende og prøves igjen for alltid. Etter 200 holdes nøkkelen som «bekreftet» til første melding for den kommer fra Electric (ekkoet av egen skriving hoppes over); kommer ekkoet aldri, slippes nøkkelen etter 2 min. **Kjent svakhet:** en eldre melding som var underveis før vår skriving, kan bli tatt for ekkoet. |
| Støtter oppsettet flere faner samtidig i Safari? | Ikke trygt. Ingen `navigator.locks` (bevisst, hold det enkelt): to faner har hver sin kø i minnet over samme lager og kan sende samme bunt to ganger (serveren tåler det, upsert) eller ikke se hverandres nye rader før neste omlasting. Lagringen lukker seg når en annen fane sletter databasen (organisasjonsbytte). På iPaden kjøres appen som én fane fra hjemskjermen. Kjent svakhet. |
| Virket Electric-klienten i Next 16 uten omveier? Hvilke tilpasninger måtte til (worker, wasm, hurtiglager i service workeren)? | **Valgt bort; egen `fetch`-løkke brukes** (avgjørelse 4). `ShapeStream` fra `@electric-sql/client` 1.5.28 ble prøvd med innsatt `fetchClient` og `backoffOptions { initialDelay: 5000, maxDelay: 60000, multiplier: 2 }` mot en proxy som svarer 502: kallene kom ved 0 s, 2,5 s, 2,5 s og 8,1 s (tilfeldig ventetid og to kall nesten samtidig), altså brudd på regelen om høyst ett kall per tabell per 5 s. Den holder også posisjonen bare i minnet og legger på `log=full`. Egen løkke (`nextShapeParams`, `readShapeHeaders`, `parseShapeMessages`, `retryDelayMs`) var mindre arbeid enn å temme SDK-en. Pakken er tatt ut igjen; ingen ny avhengighet. Ingen worker, ingen wasm, ingen endring i service workeren. Målt uten Electric: 2 kall per tabell på 12,5 s (ved 0 s og 5 s). |
| Proxy-ruten: hvilke parametre slippes gjennom, hvordan sendes `organization_id` som parameter, og hva skjer når Electric ikke svarer? | |
| Brukes synktokenet fra PR #8 av denne kandidaten? Hvis nei: hva erstatter det? | Nei. iPaden snakker bare med appen, med samme innlogging som de andre `/api/prove/`-rutene; proxy-ruten sjekker tilgang og legger på `ELECTRIC_SECRET` på serveren. Mindre å eie enn for PowerSync (ingen JWT, ingen nøkkel å bytte). |
| Tekstfletting med Yjs gjennom ElectricSQL: virket / utsatt. Hvorfor? | Virket uten Electric: samme `text-merge.ts` og samme `nextTextState` som PowerSync (flyttet til `sync/text-state.ts`, ingen ny flettekode). Innkommende `text_state` flettes alltid, også når feltet har usendte endringer, og `value` følger alltid tilstanden. Vist i nettleseren via testkroken: «Merk: » fra en annen enhet og «Taket er tett.» lokalt gir begge. Mot ekte Electric prøves det i prøve B. |
| Hvor mange linjer kode eier vi selv for synklaget (uten tester)? Oppgi endringskø og lokal lagring som egne tall. | Kodelinjer uten tomme linjer og kommentarer (28.10.2026): **endringskø** `outbox.ts` 92; **lokal lagring** `storage.ts` 100; innfletting `apply-incoming.ts` 91; tolking av Electric-svar `shape-messages.ts` 146; lageret med sending, henting og lyttere `store.ts` 784 (en del er samme mønster som PowerSync-lageret: tekstfelt, bilder, snapshot). I alt for Electric på klienten: 1 213. Felles for alle kandidater (telles ikke mot Electric): `select-store.ts` 98, `test-hooks.ts` 128, `text-state.ts` 38, `photo-uploader.ts` 93. Serverdelen (proxy-ruten) telles i bit 2. PowerSync-lageret har til sammenligning ingen egen kø, lagring eller innfletting. |
| Tid brukt på å få kandidaten klar (arbeidsdager) | Klientdelen (bit 1): under én arbeidsdag, medregnet forsøket med `ShapeStream`. Grensen på to arbeidsdager (pkt. 16) slo ikke inn. Serverdelen (bit 2) føres inn av prosjektleder. |
| Versjon av `@electric-sql/client` (og `@electric-sql/pglite` / `pglite-sync` hvis brukt), Electric-tjenesten (bilde) og `yjs` | `@electric-sql/client` 1.5.28 prøvd og tatt ut igjen (står ikke i `package.json`). PGlite ikke brukt. `yjs` 13.6.33 (fra PR #8). Electric-bildet: fylles inn fra bit 2. |
| Lisens på hver (sjekket dato) | `@electric-sql/client` 1.5.28: Apache-2.0, med avhengigheten `@microsoft/fetch-event-source` (MIT); sjekket i pakkenes `package.json` 28.10.2026. `yjs` 13.6.33: MIT, sjekket 28.10.2026. Electric-bildet: fylles inn fra bit 2. |
| Publikasjon og replikeringsplass: lagde Electric sin egen, eller brukte den en fra migreringen? Hvilke rettigheter trengte databaserollen? | |
| Kjører Electric og PowerSync side om side på samme database uten å forstyrre hverandre? | |
| Det som ikke virket i byggingen | (1) `ShapeStream` holdt ikke 5-sekundersregelen (se over); egen løkke brukes. (2) Electric sender ved update og delete (standard `replica`) bare `id` og endrede kolonner, så meldingen kan mangle `trial_form_id`/`field_key`. Innflettingen finner da raden på `id`. Har svaret fått en annen `id` på serveren (to iPader laget samme felt samtidig), tar lageret over serverens `id` når meldingen med nøkkelkolonnene kommer, også om feltet har usendte endringer (innholdet står urørt). (3) Testkroken `applySyncedRows` bruker bare køen som vern, ikke «bekreftet»-settet; ellers ville en rad fra «en annen enhet» rett etter egen lagring blitt tatt for ekkoet. (4) Uten Electric i e2e når indikatoren likevel «Alt er lagret på serveren», fordi skriveruten finnes. (5) Kontraktsryddingen: PowerSync-lagerets `subscribe` lytter nå også på `trial_forms`, siden snapshoten har `form`. `markPhotoUploaded` i PowerSync skriver rett i `ps_data__trial_photos` med `json_set`, utenom `ps_crud` (avgjørelse 6). Det virket: indikatoren viser «Alt er lagret på serveren» etter opplasting mens endringer-ruten svarer 500, og dagens PowerSync-e2e er grønne. (6) Ikke prøvd mot ekte Electric-tjeneste (skyen har ikke Docker); proxy-ruten og Electric prøves på Macen. |

## Oppsummering for ADR-en (fylles inn til slutt)

| Kriterium | Poeng (1–3) | Begrunnelse |
|---|---|---|
| Virker prøvene (A og B her; C–F senere) | | |
| Arbeid | | |
| Drift i EU/EØS | | (spørsmål nr. 11) |
| Pris | | (spørsmål nr. 11) |
| Modenhet | | |

Hva ville fått oss til å velge bort ElectricSQL:
