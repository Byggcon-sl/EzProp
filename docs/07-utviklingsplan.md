# EzProp – utviklingsplan

Sist oppdatert: 12.11.2026
Eier: Ståle Limstrand (produkteier). Prosjektlederen i agentlaget holder planen ved like.

**Dette er det ene levende plandokumentet.** Det viser bare det som gjelder nå og det som kommer.

| Vil du se | Les |
|---|---|
| Det som er levert, i detalj | `docs/plan/levert.md` |
| Hvor hvert funn fra researchen havnet | `docs/plan/sporbarhet.md` |
| Hva som er endret i planen, og når | `docs/plan/endringslogg.md` |
| Beslutningene til Ståle | `docs/kartlegging/LES-MEG-kartlegging.md` |
| Datamodellen | `docs/05-domenemodell.md` |
| Hva agentene gjør akkurat nå | `docs/agenter/tilstand.md` |
| Hva testlaget har funnet | `docs/agenter/testlag/rapport.md` |

**Regler for dokumentet** (slik at det er til å stole på):

1. Planen sier bare det som gjelder. Blir noe endret, rettes teksten her, og endringen får én linje i endringsloggen.
2. Et punkt som er levert og merget, flyttes til `docs/plan/levert.md`. Planen viser det som gjenstår.
3. `- [ ]` er arbeid agentene kan gjøre. Det bare Ståle kan gjøre, står i listen «Venter på Ståle» (S1–S8), aldri som avkrysningspunkt.
4. Det som ikke er bestemt av Ståle, er merket **«Claudes forslag»**.
5. Testlagets dokumentvakt kontrollerer at planen, beslutningene og koden stemmer overens (`docs/11-agentlaget.md`, løkke G).

---

## Hovedmål (Ståle 10.11.2026)

> «Vi skal lage et best mulig system for våre ansatte – KI først. Det betyr også at KI må ligge i bunnen, ikke komme som et tillegg senere.»

1. **Best mulig system for de ansatte.** Takstingeniørene, kontoret og lederne skal få en enklere, raskere og tryggere arbeidsdag. Det er de ansatte som avgjør om vi har lykkes.
2. **KI først, og KI i bunnen.** KI er en del av grunnmuren og av hver funksjon fra første dag. For hver oppgave spør vi: hva kan KI gjøre eller forberede, slik at den ansatte bare kontrollerer og godkjenner? Takstmannen har alltid siste ord og signerer. KI setter aldri TG og sender aldri noe selv.
3. **Færre reklamasjoner.** Målet fra 28.10.2026 står: halvparten så mange reklamasjoner per 100 leverte rapporter. Det måles over flere år.

**50 % mindre tid per rapport er ikke lenger hovedmålet** (Ståle 10.11.2026). Tiden måles fortsatt, som ett av flere tegn på at systemet er godt.

Hver oppgave og hver PR sier hvilket av de tre målene den støtter, og hvordan.

**Slik ser vi om vi lykkes** (Claudes forslag):

| Tegn | Hvordan vi ser det |
|---|---|
| De ansatte vil heller bruke EzProp | Kort spørreskjema etter 2 og 4 uker i piloten, og EzProp-panelet |
| KI gjør nytte | Andel KI-forslag som godtas, endres eller avvises (`ai_usage_log`), og kostnad per rapport |
| Arbeidet går lettere | Tid per rapport og fase mot målingen i IVIT, og antall trykk i de vanligste arbeidsflytene |
| Færre feil slipper ut | Reklamasjoner per 100 rapporter, rettinger etter sidemannskontroll og rapporter rettet etter levering |
| Ingenting går tapt | Null tap av data uten nett |

---

## Slik leser du planen

- EzProp bygges i **faser**. Hver fase har punkter som krysses av, og en linje **«Ferdig når»**.
- **Rekkefølgen:** agentene tar punktene i gjeldende fase ovenfra og ned. Alvorlige feil som testlaget har bekreftet, rettes før neste nye punkt.
- **Bygg bare det som står i fasen.** Nye ideer foreslås i `docs/09-apne-sporsmal.md`. De bygges ikke før Ståle har sagt ja.
- **Agentene bygger, tester og merger selv** når alt er grønt (Ståle 29.10.2026). Testlaget prøver det som er bygget, slik at Ståle ikke må teste hver leveranse.
- **Fagstoff** (avvikstekster, regler, grenser) lages som utkast og merkes «ikke godkjent av fagrådet» til Ståle har godkjent det.
- **Datamodellen** bygges i riktig form fra start, også der skjermbildene kommer senere.

```
Levert:  0a Repo og database · 1 Prøve uten nett (automatiske prøver) · 0b Innlogging, organisasjon og roller · 2a Oppdrag og eiendom
Nå:      2a Rapporten på PC   →  2a-1 KI-grunnmuren  →  2a-2 Smal vei  →  2a-3 Bredden
Så:      Minimum før ekte data → 2b Befaringen på iPad → 3a Piloten → 3b Kontoret
         → 4 Produksjon → 4b Kundesiden → 5 Malbygger → Senere
```

## Status nå

| Fase | Status |
|---|---|
| 0a Repo og database | Ferdig 28.10.2026 |
| 1 Prøve uten nett | Ferdig 10.11.2026. Ståle har kjørt prøvene på ekte iPad og godkjent ADR 0004 (egenbygd synk). |
| 0b Innlogging, organisasjon, roller | Ferdig, unntatt felles innlogging med Optiplan (venter på S6) |
| **2a Rapporten på PC** | **Gjeldende fase.** Oppdrag, eiendom, kontakter, tidsmåling og reklamasjonsskjema er levert. Malmotoren (PR #119), ADR 0006 KI i bunnen (PR #123), KI-modulen og loggen (PR #127), forslagsmønsteret (PR #131), vask før KI (PR #135), evalueringssettet (PR #141) og KI-køen (PR #143) er levert. Det alvorlige funnet T-0001 (synkkøen) er rettet i PR #139. Beslutningsnotatet om KI-leverandør og Anthropic-adapteren (siste punkt i 2a-1) er ferdig. 2a-2: malen for ett bad er levert (PR #159), og reglene badet trenger er levert (PR #167). Byggcon-profilen er levert (PR #176). Neste: resten av «Fra Ståles svar 12.11.2026», deretter badet på PC. |
| Minimum før ekte data | To av ti punkter levert. Testmiljøet (S1) er oppe fra 12.11.2026, så resten kan bygges og prøves der. |
| 2b og videre | Ikke startet |

## Venter på Ståle

Dette kan bare Ståle gjøre eller bestemme. Listen er sortert etter hvor mye som står og venter. Detaljer og oppskrifter står under «Trenger Ståle» i `docs/agenter/tilstand.md`.

| Nr | Hva | Hva som venter på det |
|---|---|---|
| S1 | ~~Testmiljøet i Azure for EzProp~~ **Gjort 12.11.2026.** Første vellykkede utrulling: appen `app-ezprop-test` (Sweden Central) og databasen (Norway East, fordi den minste størrelsen ikke var ledig i Sweden Central) i ressursgruppen `rg-ezprop-test2`. Helsesjekken svarer ok. Gjenstår for Ståle: første innlogging og iPad (`docs/drift/testmiljo-azure.md`, punkt d og e). | – |
| S2 | ~~Prøve A og B på ekte iPad, C, D og F, og godkjenne ADR 0004~~ **Gjort (Ståle 10.11.2026: «2 og 3 også»).** ADR 0004 (egenbygd synk) er godkjent. | – |
| S3 | ~~Fagråd runde 1~~ **Gjort (Ståle 10.11.2026: «2 og 3 også»).** Grensene, levetidene, prøveeksemplene og kontrollpunktene for leilighet og fellesdeler er godkjent. De tre fagspørsmålene er besvart samme dag: TG0 gis når det ikke er målt fukt, uansett hvor gammelt badet er; radon er bare HMS; brann og sikkerhet (røykvarsler, slukkeutstyr) er punkter uansett bygningstype. | – |
| S4 | **Ansvarsforsikringen:** antall krav og beløp de siste 3 årene, **hvilken bygningsdel hvert krav gjaldt**, hvordan tidlig melding virker, og om dokumenterte rutiner gir bedre vilkår. | Nullpunktet for reklamasjonsmålet, og hvilke regler og KI-sjekker som bør komme først |
| S5 | **Måling i IVIT:** tre takstmenn noterer tid på 20–30 oppdrag til sammen (forberedelse, befaring, kontorarbeid, levering). Målingen drøftes med de ansatte først. Tallene legges inn på `/statistikk/tid`. | Sammenligningen i piloten |
| S6 | **Tilgang til Optiplan-oppsettet**, og bekrefte om Optiplan bruker nøkkelboks. | Felles innlogging og bytte med ett trykk (fase 0b) |
| S7 | **Folk:** én erfaren takstmann inn i betaen nå, hvem som er med i piloten og EzProp-panelet (forslag: én takstmann per selskap og Dan-Børge fra kontoret), og hvem som er ansvarlig for overgangen fra IVIT. | Andre øyne enn Ståles på det som bygges, og piloten |
| S8 | **KI-leverandør: Anthropic, og Ståle har API-nøkkel (Ståle 10.11.2026: «vi har valgt anthopic - har api nøkler»).** **Anthropic-adapteren er bygget bak KI-porten, og beslutningsnotatet er skrevet (11.11.2026, `docs/beslutningsnotat-ki-leverandor.md`).** Gjenstår for Ståle: velge EU/EØS-vei, godta eller signere databehandleravtalen, svare på spørsmål 54–58 og 73, vurdere forslag 64 (tak på KI-bruk), legge nøkkelen inn som secret `ANTHROPIC_API_KEY` i GitHub (aldri i chat eller repo) og lage tilkoblingen i testmiljøet, og velge leverandør for norsk tale til tekst (anbefalt: Microsoft Azure tale i Norge). | Ekte KI i testmiljøet. Til da prøves alt mot den falske leverandøren. |

---

## KI i bunnen

KI er ikke en fase. Den er en del av grunnmuren, og hver funksjon bygges med KI fra første dag. Reglene:

- **Én vei inn.** All KI går gjennom én felles modul i kjernen (`src/core/ai`), bak KI-porten i tilkoblingslaget. Ingen funksjon snakker direkte med en leverandør, og leverandøren kan byttes.
- **KI foreslår, den ansatte bestemmer.** Alt KI lager, lagres som et forslag med kilde og status (foreslått, godtatt, endret, avvist). Forslag vises likt overalt: bruk, behold eller be om nytt forslag, og angre.
- **KI setter aldri TG, og sender aldri noe.** TG-forslag kommer fra faste regler (materiale, alder, målinger), ikke fra KI. En rapport kan ikke publiseres med KI-tekst som ikke er godkjent av takstmannen.
- **KI velger fra det som er godkjent.** Der det finnes godkjente fraser, velger KI blant dem og viser det den ikke finner, som «ingen treff». Den lager ikke ny tekst for å fylle hull.
- **Alt logges.** Hver bruk logges i `ai_usage_log` med funksjon, kostnad og hva takstmannen gjorde med forslaget. Slik ser vi nytten.
- **Personvern.** Navn, e-post, telefon, adresse og matrikkel fjernes før noe sendes til KI. Leverandøren må ha databehandleravtale, lagring i EU/EØS og ingen trening på våre data.
- **Prøvd før bruk.** Hver KI-funksjon har et evalueringssett med 30–50 eksempler med fasit. Den slås ikke på for ekte bruk før den treffer godt nok, og settet kjøres på nytt når modellen byttes.
- **Virker uten nett.** Opptak, bilder, frasesøk og regelsjekker virker uten nett. Det som trenger KI, legges i kø og vises som «venter på KI».
- **Uten kostnad til Ståle har sagt ja.** Alt bygges og prøves mot en falsk leverandør. Ekte leverandør slås på av Ståle (S8).

Hvor KI kommer inn:

| Fase | KI i funksjonene |
|---|---|
| 2a-1 | Grunnmuren: modul, logg, forslag, vask av persondata, evalueringssett, kø |
| 2a-2 og 2a-3 | Forslag fra frasebanken, språkvask, utkast til oppsummering og sammendrag, KI-sjekk før publisering, e-post blir ordreforslag |
| 2b | Tale til tekst, diktat til ferdig funn, bilde til utkast til observasjon og bildetekst |
| 3a | KI-sidemann før sidemannskontroll, forhåndsutfylling fra tidligere rapport, læring fra sidemannskontrollen |
| 3b | Henvendelse blir handling, hjelp til e-posttekst |

---

## Fase 2a – Rapporten på PC  `status: i arbeid fra 03.11.2026`

Tilstandsrapport for **bolig og leilighet** som systemmal, laget og publisert **på PC**. Kjøres ved siden av IVIT. Fasen har tre deler, og de tas i denne rekkefølgen.

### 2a-1 KI-grunnmuren

Alle punktene i 2a-1 er levert (12.11.2026) og står i `docs/plan/levert.md`.

**Ferdig når:** En prøvefunksjon (språkvask av en setning) går hele veien mot den falske leverandøren: forslaget vises, takstmannen godtar eller avviser, og loggen viser det.

### Prioritert av Ståle 12.11.2026: Microsoft-innlogging

Tas **før neste punkt i 2a-2**. Ståle i chat 12.11.2026: «tror vi skal sette opp logg inn via microsoft 365 kontoene vi har, epost knyttet til @byggcon.no - så kommer vi rett inn uten kode. Vi kan ha kode i bakhånd, i tilfelle microsoft innloggingen feiler».

Levert i PR #166 (12.11.2026), se `docs/plan/levert.md`.

### Fra Ståles svar 12.11.2026

Første punkt tas **før Byggcon-profilen**, fordi det retter reglene som alt er merget. Resten tas etter Byggcon-profilen (levert, PR #176) og før neste punkt i 2a-2, i denne rekkefølgen. Svarene står i `docs/kartlegging/svar-fra-stale-2026-11-12.md`.

- [ ] **Rette en ordre etter at den er lagret** (T1, «full redigeringstilgang. alltid»): også etter at ordren er blitt oppdrag. Endrer A55 og A87. Endringene logges.
- [ ] **Søk i ordrelisten og i arbeidskøen** (T2).
- [ ] **Varsel om mulig dublett** (T3): fast regel uten KI (samme adresse eller matrikkel og overlappende tid). Varselet stopper ikke lagringen.
- [ ] **Flere rom på én gang med færrest mulig trykk** (T4). KI som foreslår rom (for eksempel fra plantegning) står i 2a-3 og tas så tidlig som det lar seg gjøre.
- [ ] **Oppbevaringstid for avviste KI-forslag som innstilling** (K7), 10 år som standard. Endrer A157.

### 2a-2 Smal vei: ett våtrom fra kontrollpunkt til PDF

Før bredden bygges, lages én smal vei gjennom hele rapporten. Da kan Ståle se og godkjenne fag og utseende tidlig, og feil i grunnstrukturen oppdages før de blir dyre.

- [ ] **Badet på PC:** kontrollpunktene, avvikskort (TG, årsak, konsekvens, tiltak, kostnad) og TGIU på punktet. TG-forslag fra reglene kan godtas, endres eller avvises.
- [ ] **KI i veien:** forslag fra frasebanken, språkvask av avviksteksten og utkast til sammendrag, gjennom KI-grunnmuren.
- [ ] **Publisering av badet:** sperren for det som gjelder våtrom (TG2 eller TG3 uten årsak og konsekvens, TG3 uten kostnad, våtrom uten hulltaking eller begrunnelse), med aktiv overstyring og logg.
- [ ] **ADR: valg av PDF-motor,** og en enkel PDF av badet med Byggcons profil. Krav til motoren: stående og liggende, profiler, bilder med markering, innholdsfortegnelse, norsk orddeling og samme resultat hver gang. Testutskriften med 50 bilder kommer i bredden.

**Ferdig når:** På ett testoppdrag kan badet fylles ut, få TG-forslag fra reglene og tekstforslag fra KI, publiseres og bli til en PDF. Testlaget har prøvd veien, og Ståle har sett den.

### 2a-3 Bredden

**Malen og reglene**
- [ ] **Regneark inn og ut med faste ID-er** for systemmalen. Slik redigerer fagansvarlig malen i betaen (P19); egen maleditor kommer i fase 5.
- [ ] Automatisk kontroll av malen før publisering: obligatoriske punkter finnes, TG3 har kostnad, ingen regler peker på felt som ikke finnes, og alle testtilfeller består
- [ ] «Prøv malen»: et testskjema som viser hvilke spørsmål og TG-forslag som kommer
- [ ] **KI: forslag til rom fra plantegning** (Ståle 12.11.2026, T4: «ki first»): takstmannen laster opp plantegningen, og KI foreslår rommene med romtype og etasje. Takstmannen godtar, endrer eller fjerner. Aldri areal som fasit, aldri TG.
- [ ] Levetider (NS 3600:2025 tillegg C som tall, **med trinn**, innspill D4), terskler (bekreftet av fagrådet) og kostnadsintervaller som egne tabeller
- [ ] Regelmotoren som én felles kodepakke for iPad og server: vis/skjul, **TG-forslag fra materiale, alder (med kilde for alderen og om dokumentasjon finnes) og målinger**, forslag om TGIU på punktet, og kontroller. Testtilfeller per regel. De nye betingelsestypene fra innspill D5 (snødekke, bygningstype, TG på annet punkt, bilde mangler, TGIU satt).
- [ ] **Informasjonstekst ut fra byggeår** (for eksempel asbest) foreslås av regler i malen. Bare forslag, aldri TG. (Svar 10.11.2026, nr. 47)
- [ ] Regler fra beslutningene: hulltaking nektet gir TGIU (på kontrollpunktet, innspill D1), loft uten adkomst gir TG2 (med unntaket), radon 100 Bq/m³, våtrom fra før 2000
- [ ] Systemmalen for tilstandsrapport bolig og leilighet lagt inn, med Byggcons egne avvikstekster. **TG-logikk finnes bare i denne systemmalen** (27.10.2026). Radon får aldri TG, bare HMS (spørsmål 59b). Røykvarsler og slukkeutstyr er egne punkter også for leilighet (spørsmål 59c).
- [ ] **Forhåndsvalg i malen** bare for beskrivende tekst, aldri for avvik, tiltak eller TG. Forhåndsvalgte tekster må bekreftes før «Send» (advarsel). (Svar 10.11.2026, nr. 34)
- [ ] «Handling»-frasene fra IVIT importeres som tiltak. Feltet kan hete «Konsekvens/tiltak» (27.10.2026).
- [ ] **Tiltak merkes «utbedre» eller «undersøk nærmere»** som et valg på tiltaket. (Svar 10.11.2026, nr. 40)
- [ ] Rapporten låses til malversjonen den startes med
- [ ] **Kroker i datamodellen** (svar 10.11.2026, nr. 49 og 52): kategori på tjenesten, fast felt for hvem som er oppdragsgiver, fast definisjon av hvilke oppdrag som teller i tall, og «sist gjennomgått» med eier på hver frase.

**Rapporten på PC**
- [ ] Kontrollpunkter per bygning og rom, «i»-knapp med kravet fra forskriften (med egne ord), HMS-merke, hjelpetekster, «ferdig» per punkt og fremdrift
- [ ] **Obligatoriske felt for «hva er undersøkt og hvordan»** på de obligatoriske punktene. Mangler gir advarsel, ikke sperre. (Svar 10.11.2026, nr. 26)
- [ ] Felt for tall med enhet og gyldig område (fall, terskel, skjevhet, punkterte ruter, rekkverkshøyde, fukt) og tabell for hulltakingsmålinger
- [ ] **Avvikskort** med alt på ett sted: TG, årsak (begrunnelse og kriterium, også «manglende dokumentasjon», innspill D7), konsekvens, flere tiltak, kostnad (ett av de fem intervallene, eller **eget beløp** i stedet for intervall) og valgfri kostnadstekst. Eget beløp rundes ikke av automatisk, men gir **advarsel** hvis det ikke er rundet av til minst nærmeste 10 000 (27.10.2026). TG2/TG3-forslag kan godtas, endres eller avvises med begrunnelse.
- [ ] **Samme avvik flere steder samles i ett funn** med flere steder og bilder, og funn kan **kopieres og flyttes** mellom seksjoner. (Svar 10.11.2026, nr. 47 og 53)
- [ ] **TGIU på kontrollpunktet** med opplysningene (hvorfor, eier informert, annen kontroll og resultat, risiko, utsatt konstruksjon), og ferdig tekst som teller som utfylt. «Gjelder ikke» på et obligatorisk punkt krever begrunnelse (innspill D6).
- [ ] Befaringer: dato, klokkeslett, forhold (snø) og hvem som var til stede. **Flere befaringer per rapport** (hovedbefaring, tilleggsbefaring, etterkontroll), innspill D2.
- [ ] Dokumentasjonstabell, egenerklæring (mottatt eller ikke, avvik) og NS-utgave i rapporten
- [ ] **Fraser:** felles og mine, favoritter, «mest brukt», søk som tåler skrivefeil (også med «/»), filtrert på kontrollpunkt, felt og TG, lagre ny frase fra rapporten, endringslogg og «gå tilbake». Forslag fra frasebanken uten KI.
- [ ] **Nye fraser** går rett inn i frasebanken, merket «ny, ikke gjennomgått», slik at fagrådet får en liste. (Svar 10.11.2026, nr. 27)
- [ ] **KI: forslag fra frasebanken på betydning** (de 3–5 beste godkjente frasene) og **språkvask** av notater til rapportspråk, med før og etter side om side.
- [ ] **Bilder på PC:** last opp, knytt til rom, kontrollpunkt og avvik, rotering, markering som eget lag (piler, ringer, tekst, farge etter TG), bildetekst, forsidebilde og bekreftelse før sletting
  - [ ] Bilder uten personer til de fire testoppdragene, i samme seed-steg (`pnpm db:seed:testoppdrag`), når bildemodellen finnes (A134)
- [ ] Sammendrag (skrives av takstmannen), **oppsummering per bygningsdel** som lagres og kan redigeres (innspill D12), og oversikt over TG
- [ ] **KI: utkast til oppsummering per bygningsdel og til sammendraget,** laget fra godkjente funn og sortert etter alvor. Takstmannen godkjenner.
- [ ] Papirkurv og angre for sletting
- [ ] **Fart:** krav til hvor rask rapporten skal være på PC, og en prøve med en stor rapport (mange bygninger og bilder): ett rullefelt, og innhold som ikke hopper mens det lastes. (Svar 10.11.2026, nr. 50)
- [ ] **KI: e-post blir ordreforslag.** En bestilling på e-post limes inn og blir et utkast til ordre som kontoret kontrollerer.
- [ ] **Reklamasjonskoblingen:** oppdrag → henvendelse eller reklamasjon → ny befaring, som kobling i datamodellen. (Svar 10.11.2026, nr. 38)

**Publisering, PDF og sending**
- [ ] **Publisering med sperre:** de sju kravene fra forskriften stopper, den ansatte kan krysse bort sperren aktivt, overstyringen logges, og mangelen kommer tilbake i ny versjon. Sperre nr. 1 tar hensyn til «gjelder ikke» og «gir ikke TG» (innspill D6). Andre mangler gir advarsel, blant annet påkrevd sidemannskontroll som ikke er godkjent, og eget kostnadsbeløp som ikke er rundet av (27.10.2026). Mangler vises underveis som et lite merke.
- [ ] **Nye advarsler i sjekken før publisering** (leilighetsanalysen, svar 10.11.2026): samme ventilasjonsanlegg er beskrevet ulikt to steder, og ny versjon mangler kort kommentar om hva som er endret.
- [ ] **KI-sjekk før publisering:** finner motstrid mellom tekst og TG (for eksempel «råte» i teksten og TG1), uklart språk og gjetteord. Den stiller spørsmål og foreslår aldri TG. Gir advarsel, ikke sperre.
- [ ] Utgivelser med versjon: hver utgivelse låses med innhold, PDF og fingeravtrykk, og med hvem som signerte og hvilken sertifisering som gjaldt (innspill D8). Retting gir ny versjon med opprinnelig dato. **Gyldig til = ett år fra befaringsdato** (27.10.2026).
- [ ] **PDF** med Byggcons profil: forside, om Byggcon (firmatekst fra selskapet), forklaring av TG, sammendrag med antall per TG, bygningene med avvik og bilder, arealer, dokumentasjon, forutsetninger, signatur og bunntekst med juridisk selskap. Ingen interne koder i teksten, og tomme deler gir ikke egne sider. Stående og liggende profil. Bildene i PDF-en har ikke GPS-posisjon (innspill D14).
- [ ] **PDF-profilen** (leilighetsanalysen og svar 10.11.2026, nr. 45): tellere for TG3, TG2 og TGIU øverst, fast innledning om omfang og TG, HMS-delen som kort liste med henvisning, overskrift holdes sammen med teksten under, faste kolonnebredder, og lovlighet står ett sted.
- [ ] **PDF under 8 MB** (innspill P8): bildene i PDF-en skaleres ned og komprimeres. Blir PDF-en likevel større, sendes en lenke eller to e-poster. Testes med rapporten med 50 bilder.
- [ ] **«Send»-knapp** (innspill P9): rapporten sendes som vedlegg til mottakerne først når noen trykker. Status «Ferdig» settes når rapporten er sendt (innspill D16). En rettet rapport sendes manuelt av den ansvarlige (27.10.2026).
- [ ] **Rydding av innloggingsdata:** tellere for innloggingssperren og utløpte koder slettes etter 24 timer, utløpte økter etter 30 dager. (Svar 10.11.2026, nr. 15 og 18)

**Ferdig når:** Fagrådet har gått gjennom malen og reglene i et ekte skjermbilde og godkjent tekstene der, og Ståle godtar en PDF (også testutskriften med 50 bilder, under 8 MB).

### Rest fra fase 0b (venter på S6)

- [ ] **Innlogging som Optiplan** (engangskode på e-post), med **felles innlogging og felles profil for admin og ansatte** mellom EzProp og Optiplan (Ståle 28.10.2026): samme bruker, samme navn, telefon, stilling og kontor i begge. **Kundene holdes adskilt**: Optiplans styrer og EzProps kunder og meglere er aldri samme brukere. Løsningen beskrives i en ADR som tar hensyn til ADR-en fra fase 1.
- [ ] **Bytte mellom EzProp og Optiplan med ett trykk** (Ståle 28.10.2026: «sømløst»): en lenke i menyen i begge løsningene, uten ny innlogging. Mer samspill enn dette kommer senere.

---

## Minimum før ekte data  `status: to av elleve levert`

Før det første ekte oppdraget (med ekte adresser, selgere, bilder og egenerklæringer) legges inn, skal dette være på plass. Den fulle personvernpakken ligger i fase 4. De fleste punktene trenger testmiljøet (S1).

- [ ] **Lagring i EU/EØS med HTTPS** for drift, database og fillagring
- [ ] **Daglig sikkerhetskopi**, og én gjenoppretting som er prøvd og skrevet ned
- [ ] **Databehandleravtaler** med leverandørene for drift, fillagring og e-post
- [ ] **Tilgang bare for ansatte** (ingen innlogging for kunder eller meglere ennå)
- [ ] **Sperring av iPader** (innspill P6 og D10): kode eller Face ID påkrevd, og en mistet iPad kan sperres. Må være på plass før første ekte befaring på iPad i fase 2b.
- [ ] **Microsoft 365 koblet til**, og koden i serverloggen for første admin er ikke lenger i bruk
- [ ] **Privat nettverk eller VNet-integrasjon mellom app og database** (ikke brannmurregelen for alle Azure-tjenester), og egen databasebruker for appen uten eierrettigheter
- [ ] **KI-leverandør:** databehandleravtale signert og behandlingen i EU/EØS (Ståle 12.11.2026, K1: Anthropic direkte bare i testmiljøet med oppdiktede data), før tilkoblingen `anthropic` lages for en organisasjon med ekte data. Spørsmål 54–58 og 73 er besvart 12.11.2026. Leverandørens vanlige oppbevaringstid godtas og skrives inn i personvernerklæringen (K2). Se `docs/beslutningsnotat-ki-leverandor.md`.
- [ ] **Personvernkonsekvensvurdering (DPIA), kort utkast** fra agentene som Ståle godkjenner (K3, 12.11.2026). Før ekte data, ikke før testing.

**Ferdig når:** Ståle har sett listen krysset av og godkjent at ekte data kan legges inn.

---

## Fase 2b – Befaringen på iPad  `status: ikke startet`

Samme rapport, nå med **befaringen på iPad uten nett**, med løsningen fra fase 1.

- [ ] Befaring på iPad uten nett, og samme data på PC (to visninger for konstruksjonene)
- [ ] iPad-visning for befaringen: kontrollpunkter per bygning og rom, store trykkflater, «ferdig» per punkt og fremdrift
- [ ] **Bilder på befaringen:** kamera ett trykk unna, serie med bilder, bildet knyttes til rom, kontrollpunkt og avvik der det tas, og kø for opplasting
- [ ] **KI: tale til tekst og diktat til ferdig funn.** Takstmannen snakker. Opptaket lagres uten nett, og når nettet er tilbake, fordeles det som er sagt, på rom og bygningsdel som utkast til avvik, årsak, konsekvens og tiltak. TG-feltet står tomt. KI finner ikke opp mål, materialer eller årsaker. Transkripsjonen lagres og kan søkes i.
- [ ] **Sjekk av bildekvalitet** med en gang («uskarpt», «for mørkt»), uten KI og uten nett. **KI: bilde gir utkast til observasjon og bildetekst** når nettet er tilbake. Aldri TG.
- [ ] Synkstatus og «lagret kl.» alltid synlig
- [ ] **Synkoversikt:** liste over hvert bilde som venter (med funn, punkt og status), én knapp «Synk alt», og rødt tall på oppdraget når noe ikke er synket. «Synket» vises bare når serveren har bekreftet. (Svar 10.11.2026, nr. 44)
- [ ] **«Send» stopper når noe ikke er synket.** Sperren kan overstyres aktivt, og det logges. Knappen viser hva som venter. (Svar 10.11.2026, nr. 25)
- [ ] **«Glemt noe?»** (`funksjonalitet-ki` K4): før takstmannen går videre fra et rom, vises punkter som mangler og avvik uten bilde. Faste regler, ingen KI, virker uten nett.
- [ ] **Søk i befaringen** med filter «uferdig» og «flagget», i seksjonen eller hele rapporten. Virker uten nett. (Svar 10.11.2026, nr. 43)
- [ ] **Dokumentasjon på stedet** (svar 10.11.2026, nr. 48): internt bevisbilde som lagres på oppdraget, men ikke i rapporten, hurtigvalg «begrenset tilgang» (møbler, snø, låst rom) der bilde kreves, notattypen «opplyst muntlig på befaring», og arbeidsnotat på flaggede funn. Flagg gir advarsel ved «Send», ikke stopp.
- [ ] **Oppsett av iPadene** (innspill P6): kode eller Face ID påkrevd, appen på hjemskjermen, iPaden registrert som enhet i EzProp og mulig å sperre (innspill D10). **Ingen Intune nå** (27.10.2026). Det vurderes senere.
- [ ] **Delt iPad og utlogging** (svar 10.11.2026, nr. 14 og 17): endringer som venter, sendes bare av den som gjorde dem, og en annen som logger inn, får varsel. iPaden tømmes ved utlogging når alt er synket. Er noe ikke synket, vises varsel, og ingenting tømmes.
- [ ] **Posisjon i bildene** (svar 10.11.2026, nr. 8): posisjonen beholdes i originalbildet i lagringstiden, og vises aldri i rapport, PDF eller visningskopi. Kan slås av med en innstilling.
- [ ] **Listen «omveier til IVIT» startes** (innspill P14): alt takstmannen likevel må gjøre i IVIT (ordrebekreftelse, verditakst, meglerlevering, kalender), føres opp fra første betarapport

**Ferdig når:** To tilstandsrapporter (én enebolig og én leilighet med fellesdeler) er laget i EzProp ved siden av IVIT, med befaring på iPad uten nett, diktat til funn, TG-forslag fra alder og målinger, publisering med sperre og en PDF Ståle godtar.

---

## Fase 3a – Piloten  `status: ikke startet`

Flere takstmenn bruker EzProp på ekte oppdrag. Fasen har bare det piloten trenger. IVIT brukes fortsatt for det EzProp ikke dekker, og rapporten sendes med «Send»-knappen.

- [ ] Flere takstmenn og alle tre selskapene i bruk, også to i samme rapport med nett
- [ ] **Sidemannskontroll** i EzProp: krav per ansatt satt av leder, «send til sidemann», kommentarer per sted i rapporten, sendt tilbake eller godkjent med navn og tid, logg og enkel statistikk over funnene. Manglende kontroll gir **bare advarsel**, og sidemannen **kommenterer og godkjenner, men retter ikke** (27.10.2026).
- [ ] **KI-sidemann før sidemannskontrollen:** en KI-gjennomgang mot Byggcons kunnskapsbase (samme kunnskap som skillen for sidemannskontroll) finner gjengangere, motstrid og uklart språk, slik at sidemannen får en renere rapport. Den stiller spørsmål og endrer ingenting selv.
- [ ] **Læring fra sidemannskontrollen:** hver måned foreslår KI nye fraser og gjengangere, som går til fagrådet via innsamlingen i kunnskapsbasen.
- [ ] Kopiere oppdrag og **kopiere data fra en tidligere rapport** på samme bolig, med liste over hva som ikke passer i ny malversjon
- [ ] Radmeny i oppdragslisten: kopier, last ned siste PDF, bytt takstmann (overlevering), kopier data fra
- [ ] **Rette rapporten fra forhåndsvisningen:** takstmannen leser rapporten slik megler ser den, og trykker «Rediger» på funnet for å rette der han står. Endringer gjelder bare rapporten til noen med rettighet lagrer dem til malen. (Svar 10.11.2026, nr. 41)
- [ ] **Statusmerker på oppdragskortet** (egenerklæring mottatt, synket, sendt sidemann, levert) og boksen «Må gjøres». (Svar 10.11.2026, nr. 53)
- [ ] **Lesbarhetssjekk uten KI** per frase og per funn (lange setninger, LIX-tall), og merking av fraser som bare sier «kontakt fagperson». (Svar 10.11.2026, nr. 49)
- [ ] Bildesenter på PC: dra bilder til riktig rom, punkt eller avvik
- [ ] Stedsmerker (etasje, himmelretning, rom) og flagg «må fullføres på kontoret»
- [ ] Privat notat per rapport
- [ ] **Befaringstid og kalender, første versjon:** befaringstid på oppdraget, kalender per takstmann, og befaringen vises i Outlook (én vei, fra EzProp til Outlook).
- [ ] **Søk og arkiv:** globalt søk på oppdragsnummer, adresse, matrikkel og kundenavn, arkiv med filtre, hurtigperioder, lagrede filtre og eksport til Excel
- [ ] **Varsler som arbeidsliste** (funksjonskart H11) med lest/ulest og filter, og varselvalg per type (innspill D11). Også varsel når en sertifisering snart går ut (H5).
- [ ] **Hjelp i appen koblet til kunnskapsbasen** (funksjonskart H7): hjelpetekst og «i» per punkt peker til Byggcons egne sider i kunnskapsbasen, ikke til en ekstern hjelpeside
- [ ] Knappen «Tilbakemelding» med skjermbilde, og enkel feilsøking på iPaden («send feilsøkingsinfo»)
- [ ] Rapportprofil med flere valg for PDF (innholdsfortegnelse, avvik først)
- [ ] Måling av pilotmålene (se «Hva vi måler i piloten»)
- [ ] **Fast løp for overgangen fra IVIT** (svar 10.11.2026, nr. 51), skrevet som plan: kort ordliste IVIT → EzProp, prøverapport på eget hus før første kundeoppdrag, samle takstfolkenes bekymringer før piloten, vise meglere en prøverapport tidlig, og meglerundersøkelsen (fem spørsmål) som nullpunkt.

**Ferdig når:** Minst tre takstmenn har levert ekte rapporter fra EzProp i fire uker, sidemannskontrollen er gjort i EzProp, og panelet sier at de heller vil bruke EzProp enn IVIT.

## Fase 3b – Kontoret  `status: ikke startet`

Rutiner, kalender og økonomi. Kan bygges mens piloten går.

**Rutiner og meldinger**
- [ ] **Hendelser og handlinger:** «når → bare hvis → gjør» med grupper av betingelser, handlingene e-post med **ekte vedlegg** (rapport-PDF), oppgave og merke, innstillinger per melding (én gang, tidsvindu, ikke helg), og regler som også gjelder oppdrag som fantes fra før
- [ ] **De seks ferdige rutinene:** velkomst til selger (med del som ordrebekreftelse), befaringstidspunkt til megler, påminnelse dagen før (kl. 12 til selger, kopi til takstmann), rapport til kunde, rapport til megler og spørreundersøkelse til selger. Rutinene er **avanserte funksjoner som admin kan justere**, og **hver takstmann kan lage egne rutiner** (27.10.2026).
- [ ] **Spørreundersøkelse i EzProp** (27.10.2026): spørsmål og svar lagres i databasen (ikke Microsoft Forms), slik at svarene kan brukes i malene og i meglerprofilen
- [ ] **Automatisk sending ved publisering** kan slås på **per selskap** når køen har vist seg pålitelig (innspill P9). Til da brukes «Send»-knappen.
- [ ] **Kø og logg per oppdrag:** planlagt, sendt, hoppet over, feilet og stoppet, med grunn i klarspråk. Forhåndsvisning av hva som vil gå, «send nå», «stopp» og «send på nytt» med oppdaterte data. Flytting av befaringen planlegger meldingene på nytt. Varsel når noe feiler.
- [ ] Maler for e-post med flettefelt, og forklaring før bekreftelse av hva som skjer automatisk
- [ ] Oppgaver knyttet til oppdrag og kontakt, med ansvarlig, frist, status og kommentarer, også laget av regler (for eksempel «egenerklæring mangler 2 dager før befaring»)
- [ ] Hendelsen «rapporten nærmer seg ett år»
- [ ] **KI: henvendelse blir handling.** En e-post eller et skjema gir utkast til svar, forslag til oppdrag og en oppgave. **KI-hjelp til e-posttekst** i malene. Ingenting sendes uten at noen trykker.

**Kalender og økonomi**
- [ ] **Kapasitet:** ukesvisning per takstmann, fravær, og kapasitet per kontor de neste to ukene. Kobling til Outlook begge veier står i «Senere».
- [ ] **Bestillingsskjema for meglere** (funksjonskart H8): et enkelt skjema med de samme feltene som den manuelle ordren. Bestillingen blir en ordre som kontoret godkjenner. Fjerner avskrift før API mot meglersystemene finnes.
- [ ] **Fakturagrunnlag til eAccounting** gjennom tilkoblingen: fritt valgt mottaker, linjer med MVA, kontroll og «send», riktig eAccounting-klient for hvert av de tre selskapene, ingen dubletter av kunder, status tilbake som hendelsene **«faktura sendt»**, **«faktura betalt»** og «faktura forfalt». Liste over ufakturerte og ubetalte oppdrag. Her bygges også tabellen `external_references` og selskap på tilkoblingen (`company_id` eller `companies.accounting_connection_id`), flyttet fra tilkoblingslaget i fase 0b (02.11.2026, se `docs/funksjoner/fase0b-tilkoblingslag.md`, «Til fase 3»).
  - [ ] Nøkkelboksen steg 2: `readSecret` leser tilkoblingenes hemmeligheter rett fra boksen med appens identitet, av som standard (utsatt fra fase 0b 03.11.2026, A50; oppgavekort og testplan i `docs/funksjoner/fase0b-nokkelboks-kodevei.md`). Bygges i samme PR som den første tilkoblingen som trenger det; kommer en KI-tilkobling med egen nøkkel i fase 2, flyttes punktet dit.
- [ ] **Prisliste per avtale som data** (funksjonskart H2): standardpriser og avtalepriser foreslås på fakturalinjene. En prismotor (pris etter areal, alder og avstand) kommer senere.
- [ ] **Tall om KI-bruk per ansatt, også for leder** (Ståle 12.11.2026, K8). Bygges først når det er drøftet med de ansatte (arbeidsmiljøloven kapittel 9).
- [ ] **Enkelt lederdashbord** (funksjonskart H3): oppdrag per status, befaringer neste uke, levert siste 30 dager, leveringstid, ufakturert og forfalt, per kontor og selskap, og pilotmålene
- [ ] Oppslag i Brønnøysundregistrene for firma (som i Optiplan)

**Ferdig når:** De seks rutinene har gått uten feil som ikke ble oppdaget, og fakturagrunnlag har gått til eAccounting for alle tre selskapene.

**Ståle avgjør:** om automatisk sending skal slås på for et selskap.

---

## Fase 4 – Produksjon  `status: ikke startet`

**Sikkerhet og personvern**
- [ ] **Personvern, full pakke:** behandlingsgrunnlag, personvernerklæring, protokoll over behandlinger, databehandleravtaler med alle leverandørene (drift, e-post, fillagring, tale til tekst, KI), og vurdering av personvernkonsekvenser for KI. Byggcon eier arbeidet, med Ståle som daglig leder (beslutning 25.10.2026). Claude lager utkast. Det grunnleggende er allerede gjort i «Minimum før ekte data».
- [ ] **Sikkerhetskopi:** daglig kopi har gått siden «Minimum før ekte data». Ny prøvegjenoppretting gjøres og dokumenteres før alle tar EzProp i bruk.
- [ ] **Oppbevaring i minst 10 år:** låste utgivelser, bilder og måledata kan ikke slettes, og originalbildene følger innstillingene (avviksbilder i original 10 år, andre originaler 2 år, komprimert 10 år, besluttet 27.10.2026)
- [ ] Tofaktor eller tilsvarende sikker innlogging (mål 11). Sperre etter gjentatte feil kom i fase 0b. **Merk (12.11.2026):** Ståle svarte at engangskoden er reserve for alle, og at Byggcon ikke krever tofaktor i Microsoft i dag. Da er det ingen tofaktor med ekte data. Ståle avgjør om målet endres, eller om tofaktor slås på i Microsoft før ekte data.
- [ ] Drift i EU/EØS med overvåking og varsel, som Optiplan (Azure)
- [ ] Gjennomgang av sikkerhet og tilgjengelighet før alle tar det i bruk

**Overgang fra IVIT**
- [ ] **Flytting av frasene fra IVIT:** Fraseregisteret (Excel v13, rettet for TGIU ved hulltaking nektet og med riktig antall) kobles til kontrollpunktene og importeres med kode, tittel, TG og kilde
- [ ] **Importen kan filtreres og kjøres flere ganger** (sist brukt, antall ganger, per takstmann), og gir en rapport per kjøring med antall flyttet, antall feilet og årsak. Mange fraser kan merkes samtidig ved rydding. (Svar 10.11.2026, nr. 46 og 53)
- [ ] **Opplæring** av alle ansatte, med kort brukerveiledning og hjelp i appen (koblet til `04 Opplæring` i kunnskapsbasen)
- [ ] Regel for pågående oppdrag ved overgangen (fullføres i IVIT)
- [ ] **Fast skjæringsdato per selskap,** systemene side om side en periode, og bytte i en rolig periode. (Svar 10.11.2026, nr. 51)

**Kvalitet og meglere**
- [ ] **Registrering av reklamasjoner og reklamasjonsmappe** (funksjonskart H6 og `moonshots` S1): reklamasjoner og krav registreres på rapporten og på det konkrete punktet eller avviket, med utfall og beløp. Alt om en sak (utgivelser, bilder, målinger, hvem som var til stede, egenerklæring, logg, sidemannskontroll) samles på ett klikk.
- [ ] **Intern avviksregistrering** (H6): når noe gikk galt i arbeidet (feil mottaker, glemt punkt), registreres det, så det kan læres av
- [ ] **Adressebok med tall / meglerprofil** (funksjonskart H4): oppdrag per måned, leveringstid og svar på spørreundersøkelsen, per megler og meglerforetak
- [ ] **Fullt CRM rett etter adresseboka** (flyttet fra «Senere» 27.10.2026, Ståle: «full CRM må komme relativt raskt i utviklingsløpet»): historikk, notater, logg og oppgaver per megler og meglerforetak, automatiske merker (for eksempel «aktiv selgermegler»), megleranalyse og egne eksporter. Spesifiseres før bygging.

**Ferdig når:** Alle ansatte har fått opplæring og bruker EzProp for nye tilstandsrapporter, fagrådet (Ståle) har godkjent malen, tekstene og reglene, personvern og sikkerhetskopi er på plass, og frasene fra IVIT ligger i EzProp.

**Ståle avgjør før produksjon:**
- Når IVIT kan sies opp for tilstandsrapporter. Rapporter med markedsverdi lages i IVIT til en verdidel finnes.
- **Bestilling fra meglersystemene:** API eller fortsatt for hånd. I dag kommer ordrene rett inn i IVIT. Med ca. 2000 ordre i året gir håndregistrering mer arbeid for kontoret. Grunnlaget kommer fra undersøkelsen under.

## Fase 4b – Kundesiden  `status: ikke startet (godkjent 27.10.2026)`

Det kunder og meglere merker. Kommer etter produksjon og før malbyggeren.

- [ ] **Nettrapport** for kjøper, med filter på TG og rom, bilder i full størrelse og varsel «du ser ikke hele rapporten» når et filter er på
- [ ] Knappen «bare TG3» i nettrapporten, og et sammendrag som viser både TG3 og TG2 som bør undersøkes før kjøp. (Svar 10.11.2026, nr. 45)
- [ ] **Gyldighetsside med QR-kode** i PDF-en: lenken viser alltid siste versjon, varsler når rapporten er utgått, og har en visningslogg
- [ ] **Selgerportal** før befaring: hva som skjer, hva selger bør finne fram (dokumentasjonstabellen som sjekkliste), opplasting av egenerklæring og dokumenter
- [ ] **Meglerstatus:** megleren ser status på sine oppdrag og kan laste ned siste PDF

**Ferdig når:** En selger, en kjøper og en megler har brukt sin side på et ekte oppdrag uten å måtte ringe kontoret.

## Fase 5 – Malbygger for egne maler  `status: ikke startet`

Kommer etter at systemmalen for tilstandsrapport virker. Bruker samme datamodell som systemmalene.

- [ ] Visuell malbygger der ansatte setter sammen seksjoner og felt: tekst, avkrysning, valg, tall med enhet og gyldig område, dato, bilde, signatur, tabell og frase
- [ ] Redigering i tre kolonner (seksjoner → felt → innstillinger) med automatisk lagring
- [ ] Regler, logikk og sjekker i egne maler (vis/skjul, kontroller før publisering og lignende), men **ikke TG-logikk**, som er forbeholdt systemmalen for tilstandsrapport (27.10.2026)
- [ ] Flytte og kopiere seksjoner og felt, også mellom maler, og klone en mal
- [ ] Lagre en god rapport som ny mal
- [ ] Versjoner og «endringer gjelder bare nye rapporter», papirkurv og angre
- [ ] «Prøv malen» før den tas i bruk
- [ ] **Én felles PDF-layout for egne maler** (innspill P13): seksjon → felt → svar, bilder i rutenett, med rapportprofilene (logo, bunntekst, stående eller liggende). Systemmalene har sin egen, spesiallagde layout. Vil takstmennene ha mer, blir det en ny fase.
- [ ] Maleditor for fagansvarlig også for systemmalen, i stedet for regneark
- [ ] **KI hjelper til med å lage maler:** en ansatt beskriver rapporttypen, og KI foreslår seksjoner og felt som den ansatte retter på.

**Ferdig når:** En ansatt uten hjelp har laget en ny rapporttype i malbyggeren, brukt den på et oppdrag og fått en PDF.

---

## Undersøkelser ved siden av

Krever lite eller ingen kode, og kan gjøres av agentene når som helst. Hver ender i et kort notat i `docs/`.

- [ ] **Meglersystemene:** hvilke systemer bestillingene kommer fra, hva API-ene for bestilling inn og rapport ut krever, pris og vilkår. Ståle har oppgitt «alle 3» (24.10.2026). Hvilke tre det er, må bekreftes.
- [ ] **eAccounting i prøvemiljøet:** fire kall (kunde uten dublett, fakturautkast, status og kreditnota), og hva det betyr for koblingstabellen `external_references`.
- [ ] **Enova og Polycam:** hva API-ene eller eksporten gir, hva tilgangen krever, pris, vilkår og personvern (EU/EØS). Kan LiDAR komme via Polycam?

## Senere (ikke planlagt i tid)

- **Flere rapporttyper:** alle IVITs maler skal inn etter hvert, pluss nye. Rekkefølgen tas senere. Verdidel og markedsverdi er ikke krav for produksjon (27.10.2026).
- **Verdidel for leilighet og andel** (forslag): markedsverdi, teknisk verdi, tomteverdi, felleskostnader, fellesgjeld med dato og kilde, forretningsfører, og sammenlignbare salg. Et fast beregningsoppsett i kode.
- **API mot meglersystemer:** bestilling inn og rapport ut (se «Ståle avgjør før produksjon» i fase 4).
- **Eiendomsdata fra leverandør** (Eiendomsverdi eller PropCloud), og åpne kilder for risikodata.
- **Enova og Polycam** som tilkoblinger, etter undersøkelsen.
- **Kalender:** kobling til Outlook begge veier, kjøreplan og forslag til takstmann.
- **Arbeidsflaten:** mørk visning og større tekst, oppgaver på mobil og daglig oppsummering på e-post, følgefraser når én frase krysses av.
- **Kalibrering per takstmann** (etter betaen, med enighet fra de ansatte), og krav om sidemannskontroll per rapport.
- **Intune** for styring av iPadene. (Microsoft-innlogging for ansatte er flyttet til fase 2a, Ståle 12.11.2026.)
- **Uttrekk fra IVIT** av gamle rapporter og bilder, slik at de kan søkes fram.
- **Fra NS 3600:** utkast til eier før endelig rapport, kompetansebeskrivelse, og lyd og støy.
- **Egne kontrollpunkter og regler per avtale** med oppdragsgiver.
- **SMS** via norsk leverandør med samtykke, API og MCP for KI-verktøy, egne dashbord, prismotor og internfakturering mellom selskapene.
- **Måleutstyr rett inn og LiDAR,** først når behovet er vist. «Alt i nettleseren» står.
- **Salg til andre takstfirma.** Organisasjons-ID er på plass fra start.
- **Byggcon som datakilde:** statistikk holdes internt, vurderes igjen etter 2–3 år.
- **Strekkmålene** under.

## Strekkmål

Fem strekkmål fra `docs/kartlegging/moonshots-ezprop-2026-10-25.md`. De bygges ikke nå. Krokene i datamodellen er lagt inn (`docs/05-domenemodell.md` 4.13), slik at dataene samles fra første rapport.

| Nr | Strekkmål | Hva det er | Det som mangler |
|---|---|---|---|
| 1 | **Den lukkede sløyfen** | Reklamasjoner og utfall registreres på punktet, og neste takst av samme bolig sammenlignes automatisk med forrige | Reklamasjonsmappen i fase 4. Sammenligningen er senere. |
| 2 | **Robusthet og kalibrering** | Råd før publisering ut fra hvilke punkter som gir saker, månedlig kalibreringsquiz, og regler som ofte avvises, flagges til fagrådet | Nok data (2–3 år), og enighet med de ansatte om kalibrering per person |
| 3 | **Briefing og forbefaring** | Ett ark kvelden før befaringen (forrige rapport, radon, flom og skred, byggeår), og selger tar bilder av sluk, sikringsskap og luker før befaringen | Selgerportalen (fase 4b) og åpne datakilder |
| 4 | **Rapporten i lag, med levende gyldighet** | Én side for den travle, nettrapport og full PDF av samme data. QR-lenke som alltid viser siste versjon. | Fase 4b |
| 5 | **Kost per rapport** | Ekte kostnad per rapport (tid, kjøring, KI, sidemann) | Kjørelengde, og lederdashbordet (fase 3b) |

---

## Retningsgivende mål for overgangen fra IVIT

EzProp er i mål når Byggcon kan gå over fra IVIT uten å miste noe takstmennene, kontoret eller meglerne trenger, og de ansatte heller vil bruke EzProp.

| Nr | Mål | Fase |
|---|---|---|
| 1 | Rapporttypene Byggcon trenger kan lages, som systemmal eller i malbyggeren | 2a–2b (tilstand) og 5 (egne) |
| 2 | Forskriften og NS 3600:2025 for TG følges, og fagrådet (Ståle alene fram til produksjon) har godkjent mal, tekster og regler | Fagråd runde 1 (S3), 2a og 4 |
| 3 | Forskriftskrav gir sperre som bare kan overstyres med vilje. Alt annet gir advarsel med logg. | 2a |
| 4 | En hel befaring kan gjøres på iPad uten nett, uten tap | 1 og 2b |
| 5 | Arbeidet med en rapport går lettere enn i IVIT. Samme dag er ikke et mål. | Målt i IVIT (S5), sammenlignet i 3a |
| 6 | Sidemannskontrollen gjøres i EzProp, med logg (advarsel, ikke sperre) | 3a |
| 7 | Bestilling inn og rapport ut til megler fungerer | 2a (manuell ordre og «Send»), 3b (rutiner og bestillingsskjema), API avgjøres før produksjon |
| 8 | Fakturagrunnlag går til eAccounting for alle tre selskapene | 3b |
| 9 | De seks automatiske rutinene virker | 3b |
| 10 | Gamle rapporter og bilder fra IVIT kan søkes fram | Senere |
| 11 | Personvern, sikkerhetskopi, tofaktor og oppbevaring i minst 10 år | 0b, «Minimum før ekte data» og 4 |
| 12 | Alle ansatte har fått opplæring og bruker EzProp for nye oppdrag | 4 |

## Hva vi måler i piloten

| Hva | Hvordan | Mål |
|---|---|---|
| Takstmennenes vurdering | Kort spørreskjema etter 2 og 4 uker, og panelet | De vil heller bruke EzProp |
| KI-forslag | Andel som godtas, endres eller avvises, per funksjon, og kostnad per rapport | Viser om KI gjør nytte |
| Tid per rapport og fase | Arbeidsøkter (forberedelse, befaring, kontorarbeid, levering) mot målingen i IVIT | Kortere enn i IVIT. Ingen fast prosent. |
| Reklamasjoner per 100 rapporter | Registrert i EzProp, mot de siste 3 årene | Halvparten (måles over flere år) |
| Tap av data uten nett | Konfliktloggen, synkfeil og takstmannens melding | Null tap |
| Sperrer og advarsler | Antall per rapport, og hvor mange som ble overstyrt | Følges, ingen fast grense |
| Rettinger etter sidemannskontroll | Antall kommentarer per rapport og kategori | Synker over tid |
| TG-forslag fra reglene | Andel som godtas, endres eller avvises | Viser om reglene treffer |
| Rapporter rettet etter levering | Antall nye versjoner | Ikke flere enn i IVIT |
| PDF-størrelse | Størrelse på sendte PDF-er | Under 8 MB |
| Omveier til IVIT | Ting som måtte gjøres i IVIT likevel | Liste som tømmes før fase 4 |

## Forutsetninger og risiko

| Forutsetning eller risiko | Hva det betyr | Hva vi gjør |
|---|---|---|
| **Ståle er flaskehals** | Ståle er produkteier, fagråd og eneste betabruker, og driver firmaet. Det som venter på ham, stopper arbeid. | Testlaget prøver og validerer det som bygges. Listen S1–S8 holdes kort og sortert. Én erfaren takstmann inn i betaen (S7). Azure-oppsettet kan gis til en annen (S1). |
| **Synk uten nett er ikke prøvd på ekte iPad** | Fase 2b bygger på et foreløpig valg (egenbygd, ADR 0004). Appen må ligge på hjemskjermen, og iPad laster ikke opp når appen er lukket. | Prøve A og B på ekte iPad (S2) før 2b bygges i bredden. Reserve: PowerSync eller ElectricSQL. |
| **KI koster penger og behandler tekst og tale** | Leverandør må velges, og avtalene må være på plass | Alt bygges mot en falsk leverandør. Beslutningsnotat til Ståle (S8). Persondata vaskes bort før KI. |
| **KI gir feil eller finner på ting** | Feil tekst i en rapport kan gi reklamasjon | KI setter aldri TG, velger fra godkjente fraser, og alt godkjennes av takstmannen. Evalueringssett før en funksjon slås på. |
| **Fagrådets godkjenning** | Malen, tekstene, reglene og kontrollpunktene for leilighet må godkjennes av Ståle | Smal vei (2a-2) viser fag og utseende tidlig. Alt er utkast til det er godkjent (S3). |
| **Ekte kundedata i betaen** | Betaen bruker ekte adresser, selgere og bilder lenge før fase 4 | «Minimum før ekte data» |
| **Mistet iPad** | iPaden har personopplysninger og bilder lagret lokalt | Kode eller Face ID, sperring av enheten og tømming ved utlogging |
| **Meglersystemene** | Ordrene kommer i dag rett inn i IVIT. Håndregistrering gir kontoret mer arbeid. | Undersøkelse nå, bestillingsskjema i 3b, og Ståle avgjør API før produksjon |
| **eAccounting-API-et** | Ikke prøvd: kunder uten dubletter, fakturautkast, status, kreditnota, tre klienter | Fire kall prøves i prøvemiljøet (undersøkelse) |
| **PDF-størrelse i e-post** | 50 bilder kan gi 15–25 MB, og mange meglerkontorer avviser vedlegg over 10 MB | Mål under 8 MB, lenke eller to e-poster ellers |
| **Lagringsplass til bilder** | Ca. 100 000 bilder i året, 3–4 TB etter 10 år | Fillagring bak eget lag, komprimering på iPaden, oppbevaringstider som innstillinger |
| **Frasene** | Fraseregisteret er bygd for IVIT, gir TG2 der beslutningen nå er TGIU, og har ulike tall (1057 og 1333) | Rettes i frasearbeidet før import i fase 4 |
| **Bruk av NS 3600 i programvare** | Tallverdier er fakta, men standardtekst skal ikke kopieres | Bare egne formuleringer. Kilden står i bakgrunnen. |
| **IVIT-data** | IVITs lisens gir iVerdi rett til dataene, og uttrekk er ikke avtalt | Ingen frist (25.10.2026). Tas opp når piloten starter. |
