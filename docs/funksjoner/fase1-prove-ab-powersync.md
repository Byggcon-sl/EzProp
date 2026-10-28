# Prøve A og B med PowerSync: protokoll og resultat

- **Kandidat:** PowerSync (første kandidat). Oppgavekort: `docs/funksjoner/fase1-kandidat-powersync.md`.
- **Plan:** `docs/07-utviklingsplan.md` fase 1, prøve A (må) og prøve B (bør). Kriteriene for alle kandidater står i `docs/funksjoner/fase1-testskjema.md` («Plan for prøvene A–F» og «Kriterier for å sammenligne kandidatene»).
- **Status:** mal, ikke kjørt. Fylles inn av Ståle (tall og skjermopptak) og utvikler (teknisk).
- **Støtter hovedmål:** Tid (befaring uten nett på iPad) og reklamasjoner (ingenting går tapt mellom befaring og rapport).

Samme protokoll brukes for ElectricSQL og egenbygd, i hver sin fil, så kandidatene kan sammenlignes tall for tall.

## Før du starter (begge prøver)

1. Testmiljøet i Azure er oppe (PR #7) og PowerSync kjører ved siden av appen (`docs/drift/powersync.md`). `/api/helse` svarer, og versjonen er 0.1.3 eller nyere.
2. To iPad Pro med appen lagt på hjemskjermen fra Safari (Del → Legg til på Hjem-skjerm). Åpne appen **fra hjemskjermen**, ikke fra Safari.
3. Slå av Stedstjenester for Safari på begge iPadene (Innstillinger → Personvern og sikkerhet → Stedstjenester → Safari → Aldri), ellers får bildene posisjonen til stedet (spørsmål nr. 8).
4. Logg inn på begge iPadene og åpne listen «Testskjema» én gang **med nett**, så appen og skjemaet ligger i hurtiglageret.
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

Fylles inn i byggingen, også det som ikke virket. Det er grunnlaget for kriteriene «Arbeid» og «Modenhet» i sammenligningen.

| Spørsmål | Svar |
|---|---|
| Hvilken lokal lagring bruker PowerSync web-SDK i Safari på iPad (OPFS eller IndexedDB), og i Chromium? | IndexedDB i begge. SDK-en bruker sin standard `IDBBatchAtomicVFS` (wa-sqlite) i en egen web worker, med filnavnet `offline-trial.sqlite`. Den er valgt fordi den er den trygge for Safari og ikke krever egne hoder. OPFS-variantene krever en egen type worker og er ikke prøvd. Bildefilene ligger i en egen IndexedDB-database, `offline-trial-photos`. Chromium er bekreftet i e2e: svar og bilde er der fortsatt etter `reload`. **Safari på iPad må bekreftes av Ståle i prøve A** (A5 og A6). |
| Støtter oppsettet flere faner samtidig i Safari? | Delvis. Flere faner (`enableMultiTabs`) er av som standard i Safari og på iPad i SDK-en. Vi har slått det av overalt, så Chromium i e2e oppfører seg likt. Flere faner kan åpnes og lese samme database, men bare én fane synker om gangen. Appen på hjemskjermen har bare én fane, så det betyr lite for prøvene. |
| Virket SDK-en i Next 16 uten omveier? Hvilke tilpasninger måtte til? | Ja, med tre små tilpasninger. (1) `next.config.ts` kopierer worker og wasm fra `node_modules/@powersync/web/dist/worker` til `public/@powersync/`, og databasen laster dem fra `/@powersync/worker.js`. Mappen står i `.gitignore`, siden ca. 7 MB wasm ikke skal inn i git. Turbopack bygger uten feil, men lager i tillegg sine egne kopier av wasm-filene i `.next/static/media`. Grunnen er at SDK-en har `new URL('./worker.js', import.meta.url)` som reserve. (2) Databasen åpnes bare i nettleseren (`typeof window`), aldri under SSR, i en egen klientkomponent rundt listen og skjemaet. (3) `public/@powersync/**` står i listene over filer ESLint og Prettier hopper over. Service workeren (bit 4) må legge `/@powersync/*` i hurtiglageret. Ellers åpner ikke databasen uten nett. |
| Service worker: håndskrevet eller bibliotek? Hva måtte hurtiglagres for at skjemaet åpner uten nett? | |
| Tekstfletting med Yjs gjennom PowerSync: virket / utsatt. Hvorfor? | Bygget, men ikke prøvd mot tjenesten. Klienten skriver `value` og `text_state` sammen ca. 300 ms etter siste tastetrykk, og lager aldri tilstand fra en gammel `value`. Endringen regnes fra teksten brukeren skrev ut fra: enten det enheten selv skrev sist, eller det som ligger lagret. Så flettes den med det som ligger lagret (`nextTextState` i `store.ts`, med enhetstest). Visningen viser alltid teksten fra den flettede tilstanden. PowerSync legger ikke nedlastede rader over lokale endringer før de er sendt, og serveren fletter på samme måte. Derfor ender begge sider likt. Om det holder med to iPader, viser prøve B. |
| Hvor mange linjer kode eier vi selv for synklaget (uten tester)? | Klienten har ca. 1 100 linjer i modulen (`sync/`, `sync/powersync/`, `foreign-change.ts`, `sync-indicator.tsx`) og ca. 450 linjer i sidene (`prove/testskjema/`), med kommentarer. Server, synkregler og service worker kommer i tillegg (bit 1 og 4). |
| Tid brukt på å få kandidaten klar (arbeidsdager) | Klientdelen: under én arbeidsdag (28.10.2026). |
| Versjon av `@powersync/web`, `@journeyapps/wa-sqlite`, PowerSync-tjenesten (bilde) og `yjs` | `@powersync/web` 2.5.0 (med `@powersync/common` 2.4.0), `@powersync/react` 2.1.0, `@journeyapps/wa-sqlite` 2.0.10 og `yjs` 13.6.33. PowerSync-tjenesten: `journeyapps/powersync-service:1.27.2` (fast tag i `docker-compose.yml`, finnes for amd64 og arm64). |
| Lisens på hver (sjekket dato) | `@powersync/web`, `@powersync/common` og `@powersync/react` har Apache-2.0. `@journeyapps/wa-sqlite` og `yjs` har MIT. Sjekket i `package.json` til pakkene 28.10.2026. PowerSync-tjenesten: FSL-1.1-ALv2 (sjekket 28.10.2026 mot npm, pakkene `@powersync/service-*`; spørsmål nr. 10). `jose`: MIT (sjekket 28.10.2026). |
| Det som ikke virket i byggingen | (1) Uten synktjeneste i e2e går «Venter: N endringer» aldri ned til 0. Det er ventet. (2) Utlogging tømmer ikke den lokale databasen ennå. «Logg ut» ligger på arbeidskøen, utenfor prøven, og er ikke koblet til `disconnectAndClear()`. Bytter en annen organisasjon til samme enhet, tømmes databasen og bildene neste gang den åpnes. (3) Endringer serveren avviser (400 eller 409), blir liggende i køen og prøves igjen i det uendelige. Da stopper køen for den enheten. Det er godt nok for prøven, men må løses før produksjon. (4) Et skjema som ikke er synket til enheten ennå, kan ikke åpnes; siden sier fra. Ellers kunne svar blitt skrevet til et skjema serveren ikke kjenner. (5) Mens et tallfelt har fokus, viser det det brukeren skriver. En verdi fra en annen enhet vises derfor først når feltet mister fokus (gjelder visningen i bit 3). |

## Oppsummering for ADR-en (fylles inn til slutt)

| Kriterium | Poeng (1–3) | Begrunnelse |
|---|---|---|
| Virker prøvene (A og B her; C–F senere) | | |
| Arbeid | | |
| Drift i EU/EØS | | (spørsmål nr. 10) |
| Pris | | (spørsmål nr. 10) |
| Modenhet | | |

Hva ville fått oss til å velge bort PowerSync:
