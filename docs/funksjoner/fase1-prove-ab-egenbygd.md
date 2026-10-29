# Prøve A og B med egenbygd synk: protokoll og resultat

- **Kandidat:** egenbygd (tredje kandidat: lokal database og endringskø, ingen ekstra tjeneste). Oppgavekort: `docs/funksjoner/fase1-kandidat-egenbygd.md`. Protokollen er den samme som for PowerSync (`docs/funksjoner/fase1-prove-ab-powersync.md`) og ElectricSQL (`docs/funksjoner/fase1-prove-ab-electricsql.md`), steg for steg, så tallene kan sammenlignes rad for rad.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve A (må) og prøve B (bør). Kriteriene for alle kandidater står i `docs/funksjoner/fase1-testskjema.md` («Plan for prøvene A–F» og «Kriterier for å sammenligne kandidatene»).
- **Status:** mal, ikke kjørt. Fylles inn av Ståle (tall og skjermopptak) og utvikler (teknisk).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad) og reklamasjoner (ingenting går tapt mellom befaring og rapport).

Samme protokoll brukes for PowerSync, ElectricSQL og egenbygd, i hver sin fil, så kandidatene kan sammenlignes tall for tall. Velg **«Egenbygd»** under «Synkløsning» på listen «Testskjema» på begge iPadene før du starter.

## Før du starter (begge prøver)

1. Testmiljøet i Azure er oppe (PR #7). Den egenbygde kandidaten trenger ingen ekstra tjeneste. `/api/helse` svarer, og versjonen er 0.2.3 eller nyere.
2. To iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm). Åpne appen **fra hjemskjermen**, ikke fra Safari.
3. Slå av Stedstjenester for Safari på begge iPadene (Innstillinger → Personvern og sikkerhet → Stedstjenester → Safari → Aldri), ellers får bildene posisjonen til stedet (spørsmål nr. 8).
4. Logg inn på begge iPadene, åpne listen «Testskjema» én gang **med nett**, velg «Egenbygd» under «Synkløsning» på begge, og se at indikatoren viser «Alt er lagret på serveren». Da ligger appen og skjemaet i hurtiglageret.
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

Fylles inn i byggingen, også det som ikke virket. Det er grunnlaget for kriteriene «Arbeid» og «Modenhet» i sammenligningen. Spørsmålene speiler ElectricSQL-filen der det gir mening, pluss det som er særegent for den egenbygde (egen hente-rute, ingen tjeneste).

| Spørsmål | Svar |
|---|---|
| Hva ble gjenbrukt fra ElectricSQL-kandidaten (kø, innfletting, lagring, sending), og hva måtte endres for å gjenbruke det? | Forarbeidet (29.10.2026) flyttet kø (`outbox.ts`), innfletting (`apply-incoming.ts`), radomforming (`normalize-row.ts`), IndexedDB-oppsett (`idb.ts`) og kjernen i lageret (`trial-store.ts`) fra `electricsql/` til `sync/local/` uten logikkendring; Electric-testene er grønne uendret. Serverdelen bruker `normalizeLocalRow` direkte, så radene fra hente-ruten har nøyaktig den formen enheten venter. **Klienten (bit 1):** hele kjernen ble gjenbrukt uten endring. `custom/store.ts` er bare `createLocalTrialStore` over databasen `offline-trial-custom` med en ny leser. Det eneste nye er leseren (`custom/reader.ts`) og takten (`custom/pull-schedule.ts`), som erstatter Electric-løkken. Leseren gir radene til kjernen gjennom samme `mergeIncoming` som Electric, som `update`, så innflettingen er den samme. |
| Lokal lagring: database, lagre og hvordan hentemarkøren lagres så hentingen fortsetter der den slapp etter lukking og omstart | IndexedDB `offline-trial-custom` med samme lagre som Electric (de tre tabellene og køen), pluss `sync_state` med raden `{ key: "cursor", value }` (markøren som tekst, uendret fra serveren) og `outbox_next_seq` for køen. Markøren skrives i samme IndexedDB-transaksjon som den siste tabellen (bildene). Stopper appen midt i et svar, er markøren ikke flyttet, og neste henting gir de samme radene på nytt (ufarlig, test). Ved start leser leseren markøren fra `sync_state` og fortsetter der den slapp, også etter lukking og omstart. Bildefilene ligger som før i `offline-trial-photos`. Organisasjonsbytte tømmer hele `offline-trial-custom`, også markøren. |
| Hente-ruten: hvordan ser markøren ut, hvordan sikres det at ingen rad hoppes over ved samtidige skrivinger, og hvordan kommer myk slettede rader med? | `GET /api/prove/synk/hent?organisasjon=<id>&siden=<markør>` (`server/changes-since.ts`). Markøren er base64url-JSON `{ v: 1, t: { trial_forms: { u, id }, trial_answers: …, trial_photos: … } }` uten organisasjons-ID. Spørringen filtrerer alltid på `grant.organizationId`, så en markør fra en annen organisasjon gir 0 fremmede rader (test). `u` er `updated_at` i UTC med mikrosekunder, lest med `to_char` i PostgreSQL; overlappet trekkes fra uten at mikrosekundene går gjennom JS `Date` (test med rader som skiller seg med 1 µs). Per tabell: `(updated_at, id) > (u, id)`, sortert, høyst 500 rader i hele svaret, tabellene i fast rekkefølge. **Overlapp 60 s:** `updated_at` settes av databasens `now()` (start av transaksjonen) ved innsetting og av appserverens klokke ved oppdatering (`$onUpdate` i `src/db/schema/common.ts`). Klokkene blandes, og en innsetting i en lang transaksjon får tiden fra starten, så en rad kan bli synlig med en tid før en rad som allerede er hentet. Når en tabell er ferdig lest, settes markøren derfor til (største `u` minus 60 s, nil-uuid), og hver henting leser de siste 60 s på nytt (dobbel levering er ufarlig). Mens sider leses (`ferdig: false`), er markøren ren keyset, så sidene ikke går i ring. Vist med to tilkoblinger i test: en transaksjon som committer etter hentingen, kommer med i neste henting. **Kjent grense:** en rad som blir synlig mer enn 60 s «bakover i tid» (transaksjon over 60 s, eller appklokken mer enn 60 s bak databasen) hoppes over; en test dokumenterer det. Myk slettede rader er med (ingen filter på `deleted_at`). Bare kolonnene i `localColumnsOf` går ut, aldri `storage_path` eller brukerkolonner (test). Ugyldig markør gir 400, aldri 500. |
| Hvor ofte hentes det med nett, og hvor fort ser den andre iPaden en endring (prøve B)? Hva koster det i nettbruk og serverlast med to iPader åpne en hel dag (anslag)? | Takten ligger i klienten (`custom/pull-schedule.ts`, ren funksjon uten klokke): med nett høyst én henting per 5 s. Ferdig: false gir neste side med en gang. Feil (nettverk, 5xx, 401/403, ugyldig svar) gir 5, 10, 20, 40, 60 s, tak 60 s. Når en egen bunt får 200, hentes det om 5 s (også under feilventetid), og feiltelleren nullstilles; en henting som alt er planlagt tidligere, flyttes aldri bakover. Nettet tilbake eller appen fram (`wake`) gir henting med en gang. Uten nett hentes ingenting. Den andre iPaden ser derfor en endring etter høyst ca. 5 s pluss sendetiden. To iPader åpne en hel dag (8 t) gir høyst ca. 5 800 hentinger hver. Serversiden: hver henting er tre små spørringer. På grunn av overlappet sendes rader som er endret de siste 60 s på nytt i hver henting, altså ca. 12 ganger per endring med takt 5 s. Med ett skjema (40 svar) er det noen få kB per henting. Ligger 500 eller flere rader innenfor 60 s, blir hver henting to sider til det roer seg. |
| Endringskøen: samme regler som ElectricSQL (bare ved 200, ventetid, avviste bunter)? Avvik? | |
| Støtter oppsettet flere faner samtidig i Safari? | |
| Tekstfletting med Yjs: virket / utsatt. Hvorfor? | |
| Hvor mange linjer kode eier vi selv for synklaget (uten tester)? Oppgi gjenbrukt fra ElectricSQL og nytt for kandidat 3 som egne tall, og serverdelen (hente-ruten) for seg. | Kodelinjer uten tomme linjer og kommentarer, talt som i ElectricSQL-filen (29.10.2026). **Gjenbrukt fra ElectricSQL (`sync/local/`):** `outbox.ts` 92, `apply-incoming.ts` 106, `idb.ts` 109, `normalize-row.ts` 60, `trial-store.ts` 692, `types.ts` 68; i alt 1 127. **Nytt for kandidat 3, server:** `server/changes-since.ts` 138 og ruten `synk/hent/route.ts` 37; i alt 175. Til sammenligning har Electric-proxyen `server/electric-shape.ts` 147 og `synk/shape/route.ts` 15. **Nytt for kandidat 3, klient (`sync/custom/`):** `reader.ts` 226, `pull-schedule.ts` 26, `store.ts` 17, `types.ts` 35; i alt 304 (talt på nytt 29.10.2026 etter ryddingen; med `wc -l`, også tomme linjer og kommentarer: 272, 42, 30 og 97). Til sammenligning har Electric på klienten 1 213. **Tester (ikke med i tallene over):** `reader.test.ts` 630 linjer (23 tester), `pull-schedule.test.ts` 147 (28) og `server/changes-since.test.ts` 574 (37), talt med `wc -l`. |
| Hva måtte vi bygge selv som PowerSync eller ElectricSQL ga oss? | Lesingen fra serveren: «endringer siden sist» med markør, sider og overlapp (173 linjer på serveren). Electric ga oss en strøm uten tapte rader fra databaseloggen; vi får det samme med overlapp på 60 s og en kjent grense. PowerSync ga i tillegg kø og lokal database. **Klienten:** leseren med takten (252 linjer i `reader.ts` og `pull-schedule.ts`). Køen, lagringen og innflettingen fikk vi fra Electric-kandidaten, ikke fra en pakke. |
| Tid brukt på å få kandidaten klar (arbeidsdager) | Serverdelen (bit 2): under en halv arbeidsdag, medregnet integrasjonstestene. Klientdelen (bit 1): kort, fordi kjernen var gjenbrukt; det meste av tiden gikk til takten og testene. Nøyaktig tid føres inn av prosjektleder. |
| Nye avhengigheter | Ingen (krav i oppgavekortet). |
| Drift: hva trengs i Azure utover appen og databasen? | Ingenting (ingen ekstra container). Bekreftes eller rettes av utvikler. |
| Det som ikke virket i byggingen | Serverdelen: `testDatabaseUrl()` kan ikke kalles i testfilen for den andre tilkoblingen, fordi `tests/setup-env.ts` allerede har satt `DATABASE_URL` lik testdatabasen, og da kaster funksjonen. Testen bruker `process.env.DATABASE_URL`. Ellers virket det på første forsøk. Funn underveis: en full side (nøyaktig 500 rader) fulgt av en tom side ville latt markøren stå som ren keyset uten overlapp. Nå får markøren overlappet også når tabellen er ferdig lest uten nye rader (egen test). **Funn til ADR-en:** det finnes ingen indeks på `(organization_id, updated_at, id)`. Spørringen bruker indeksen på `organization_id` og sorterer resten. Det er greit med prøvens datamengder, men produksjon trenger en migrering med den indeksen. Blandingen av klokker (`now()` ved innsetting, appklokke ved oppdatering) bør også ryddes i produksjon, for eksempel ved at databasen setter `updated_at` i begge tilfeller. **Klienten:** (1) Henting «med en gang» (neste side, ny henting etter 400, `wake`) gikk først via en tidtaker på 0 ms. Den kan bli forsinket, og i Vitests falske tidtakere blir den 1 ms, så testene som sa «uten ventetid» feilet. Nå går den uten tidtaker, via et løfte, og en teller sørger for at en avlyst henting ikke går. (2) To ugyldige markører på rad kunne gitt en løkke: 400 uten `siden` regnes nå som vanlig feil med feilventetid (test). (3) Takten avviker fra testplanen 2.1 på fire punkter (200 på en bunt nullstiller feiltelleren og gir alltid 5 s, `wake` henter med en gang, ingen løkke ved 400); koden gjelder, se «Avgjørelser etter gjennomgangen» i oppgavekortet. (4) Utvikler og testskriver skrev testene hver for seg; de er slått sammen i filene med navnene fra testplanen. **Serveren, i ryddingen:** `subtractOverlap` går nå aldri under startposisjonen, så en forfalsket markør nær år 0001 ikke gir år 0000 (test). |

## Oppsummering for ADR-en (fylles inn til slutt)

| Kriterium | Poeng (1–3) | Begrunnelse |
|---|---|---|
| Virker prøvene (A og B her; C–F senere) | | |
| Arbeid | | |
| Drift i EU/EØS | | (ingen leverandør; alt i appen og databasen) |
| Pris | | (ingen lisens, ingen ekstra container) |
| Modenhet | | |

Hva ville fått oss til å velge bort den egenbygde løsningen:
