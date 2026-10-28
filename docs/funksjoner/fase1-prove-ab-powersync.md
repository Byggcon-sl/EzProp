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
| Hvilken lokal lagring bruker PowerSync web-SDK i Safari på iPad (OPFS eller IndexedDB), og i Chromium? | |
| Støtter oppsettet flere faner samtidig i Safari? | |
| Virket SDK-en i Next 16 uten omveier? Hvilke tilpasninger måtte til? | |
| Service worker: håndskrevet eller bibliotek? Hva måtte hurtiglagres for at skjemaet åpner uten nett? | **Håndskrevet** (`public/sw.js`, ca. 170 linjer, ingen ny avhengighet). Virket i Next 16 uten omveier; `@serwist/next` trengtes ikke. Registreres fra `src/app/service-worker-registration.tsx` bare i produksjonsbygg (ikke i `pnpm dev`). CSP-en begrenser ikke `script-src`/`worker-src`, så sikkerhetshodene måtte ikke endres. **Hurtiglagret:** alle filer under `/_next/static/` (skript, CSS, skrifttyper), `/fonts/`, `/brand/`, `/@powersync/` og manifestet (hurtiglager først); HTML for `/arbeidskoe`, `/prove/testskjema` og `/prove/testskjema/<id>` lagret under ren sti, pluss RSC-svar for samme sider (nett først). For at en side som bare er åpnet med klientnavigering (eller forhåndshentet fra listen) også skal åpne etter omstart, henter service workeren HTML-en for siden én gang og legger skriptene HTML-en viser til i hurtiglageret. Aldri lagret: `/api/`, `/logg-inn`, `/dev/`, `/_next/image`, svar med status ≠ 200, omdirigeringer (f.eks. til innlogging) og svar fra andre domener. **Sjekket for hånd i Chromium** (`pnpm build && pnpm start`, 28.10.2026): etter innlogging og ett besøk med nett åpnet `/prove/testskjema` og `/arbeidskoe` uten nett med overskrift og teller; hurtiglageret hadde ingen adresser under `/api/`, `/logg-inn` eller `/dev/`. **Det som ikke virket / begrensninger:** (1) Et skjema som aldri er åpnet eller vist i listen med nett (f.eks. laget i flymodus), har ingen lagret side. Da sender service workeren brukeren til listen `/prove/testskjema` i stedet for en tom feilside. En lagret kopi av et *annet* skjema brukes bevisst ikke: skjema-id-en kommer fra serveren i siden, så kopien ville vist og skrevet til feil skjema. Derfor sier protokollen at skjemaet lages og åpnes med nett (A1). (2) Uten nett åpner bare sider som er besøkt med nett minst én gang etter innlogging. (3) Lagrede sider slettes ikke ved utlogging (bare når hurtiglagerets versjon økes); greit for prøven, må vurderes før drift på delte iPader. (4) Safari på iPad er ikke sjekket ennå; det gjøres i prøve A (A5 og A6). |
| Tekstfletting med Yjs gjennom PowerSync: virket / utsatt. Hvorfor? | |
| Hvor mange linjer kode eier vi selv for synklaget (uten tester)? | |
| Tid brukt på å få kandidaten klar (arbeidsdager) | |
| Versjon av `@powersync/web`, `@journeyapps/wa-sqlite`, PowerSync-tjenesten (bilde) og `yjs` | |
| Lisens på hver (sjekket dato) | |
| Det som ikke virket i byggingen | |

## Oppsummering for ADR-en (fylles inn til slutt)

| Kriterium | Poeng (1–3) | Begrunnelse |
|---|---|---|
| Virker prøvene (A og B her; C–F senere) | | |
| Arbeid | | |
| Drift i EU/EØS | | (spørsmål nr. 10) |
| Pris | | (spørsmål nr. 10) |
| Modenhet | | |

Hva ville fått oss til å velge bort PowerSync:
