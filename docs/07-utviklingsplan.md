# EzProp – utviklingsplan

Status: **Utkast – ikke godkjent**
Sist oppdatert: 28.10.2026 (hovedmål for utviklingen satt øverst; svarene fra 27.10.2026 er tatt inn)
Laget av: Claude for Ståle Limstrand (produkteier). Ståle godkjenner planen og hver leveranse.
Hører sammen med: `datamodell.md` i samme mappe.

**Kilder:** `LES-MEG.md` (beslutningene og «Målgang», 22.–28.10.2026), `svar-fra-stale-2026-10-23.md`, `-24.md`, `-25.md` og `-27.md`, `analyse-ivit-leilighetsrapport-2026-10-27.md` (forslag, ikke vedtatt), sidemannskontrollen del 1 og 2 (25.10.2026), `ki-funksjoner.md`, Spectora-filene, `smarttakst-analyse.md`, `ivit-detaljer.md` og Optiplans `docs/07-utviklingsplan.md` (formatet).

**Innspill som er vurdert og tatt inn 25.10.2026 (kveld):** `innspill-datamodell-og-plan-2026-10-25.md` (P1–P15), `funksjonskart-ezprop-2026-10-25.md` (hullene H1–H12), `funksjonalitet-ki-og-fremtid-2026-10-25.md` (KI-krokene, evalueringssett og prioritering) og `moonshots-ezprop-2026-10-25.md` (strekkmålene S1–S6 og avsnitt 6). Hva som er endret, står i endringsloggen nederst.

Der beslutningene ikke gir svar, står det **«Claudes forslag»**.

---

## Hovedmål (Ståle 28.10.2026)

> «La oss gi utviklingen ett mål: Med EzProp 2.0 skal vi effektivisere takstingeniørens hverdag med 50 % (målt mot dagens IVIT) – samt halvere antall reklamasjoner mot oss i ettertid. Vi har kun sett begynnelsen av hva KI kan hjelpe oss med i arbeidshverdagen – og EzProp skal være laget med "AI-first"-tankegangen.»

Hovedmålet er **overordnet** og styrer prioriteringene i planen. De andre målene (se «Mål for den ferdige løsningen») er fortsatt retningsgivende.

1. **50 % mindre tid per rapport** enn i IVIT.
2. **Halvparten så mange reklamasjoner** som før EzProp.
3. **KI først** («AI-first»): for hver ny funksjon spør vi først om KI kan gjøre eller forberede arbeidet, slik at takstmannen bare kontrollerer og godkjenner. Takstmannen har alltid siste ord og signerer.

**Måling (Claudes forslag – Ståle bekrefter):**
- **Tid:** samlet tid per rapport (forberedelse, befaring, kontorarbeid og levering), per rapporttype, mot nullpunktet fra IVIT. EzProp måler automatisk fra hendelsesloggen og arbeidsøktene.
- **Reklamasjoner:** antall reklamasjoner og krav per 100 leverte rapporter, og beløp, mot de siste 3 årene før EzProp. Måles over flere år.

Se `LES-MEG.md` («Målgang») for hele teksten og prinsippene for «KI først».

**Hva bidrar mest til de to tallmålene** (Claudes vurdering, ikke en ny prioritering):

| Fase | Mindre tid (50 %) | Færre reklamasjoner (halvparten) |
|---|---|---|
| Ved siden av 0 og 1 | Nullpunkt for tid i IVIT | Nullpunkt for reklamasjoner (3 år), fagråd runde 1 (grenser og avvikstekster) |
| 1 og 2b | Befaring uten nett, bilder knyttes til punktet der de tas, «Glemt noe?» | «Glemt noe?» (punkter og bilder som mangler) |
| 2a | Fraser, TG-forslag fra regler, avvikskort, oppsummering per bygningsdel, PDF laget automatisk | Sperrer og advarsler før publisering, TG-forslag fra regler, godkjente avvikstekster, TGIU-opplysninger, dokumentasjonstabell, reklamasjoner registrert fra første ekte rapport |
| 3 | Rutiner og kø, kopier data fra tidligere rapport, bestillingsskjema, kalender | Sidemannskontroll med statistikk over funn |
| 4 | Frasene fra IVIT, fullt CRM (lite bidrag) | Reklamasjonsmappe og intern avviksregistrering (læring) |
| Senere (KI) | Tale til tekst, diktat til strukturert funn, språkvask, sammendrag, e-post blir ordreforslag | KI-sjekk før sidemann, KI-sidemann, robusthet før publisering (S2), læring fra sidemannskontroll |

---

## Slik leser du planen

- EzProp bygges i **faser**. Hver fase har punkter som krysses av når de er ferdige, og en linje **«Ferdig når»** som sier hva Ståle skal kunne se eller prøve.
- Hver fase avsluttes med en **demo for Ståle** og en kort gjennomgang mot designprinsippene (A «Fjord», luftig).
- **Ståle avgjør innen demoen (innspill P15):** Hver fase har en kort liste over spørsmål Ståle svarer på før eller i demoen. Da hoper ikke beslutningene seg opp, og neste fase kan starte uten å vente.
- Arbeidet gjøres som i Optiplan: **én oppgave per Claude-tråd**, hver på sin egen gren, levert som en pull request. Ståle godkjenner og fletter inn. Hver leveranse forklarer i klarspråk hva som er gjort, hvordan det prøves, og hva som må bestemmes.
- **Bygg bare det som står i fasen.** Nye ideer foreslås i stedet for å bygges.
- **Datamodellen** (`datamodell.md`) bygges i riktig form fra start, også der skjermbildene kommer senere. Det gjelder også de små «krokene» for senere funksjoner (`datamodell.md` avsnitt 4.13).
- **Teknologi som Optiplan:** Next.js, TypeScript, PostgreSQL, Drizzle, Better Auth (engangskode på e-post), Zod, Vitest, Playwright og pnpm. Unntaket er befaringen på iPad, som må virke uten nett og derfor kjører mer i nettleseren enn Optiplan gjør. Valget av verktøy for synkronisering tas i fase 1.

### Rekkefølgen (innspill P10, tatt inn)

```
0a Repo og database
 → 1  Prøve uten nett på iPad
 → 0b Innlogging, organisasjon, roller og layout
 → Minimum før ekte data
 → 2a Rapporten på PC
 → 2b Befaringen på iPad
 → 3  Pilot
 → 4  Produksjon (adressebok med tall, og rett etter: fullt CRM)
 → 4b Kundesiden (godkjent 27.10.2026)
 → 5  Malbygger for egne maler
 → Senere og strekkmål

Ved siden av fase 0 og 1: Fagråd – runde 1 (Ståle) · Måling i IVIT (Ståle) · Nullpunkt for hovedmålet · eAccounting-prøve · Undersøke API-ene til Enova og Polycam
```

**Hvorfor denne rekkefølgen:** Først det minste som trengs for å komme i gang (repo og database), så den største tekniske risikoen (befaring uten nett), fordi valget av synkverktøy kan påvirke databasen og innloggingen. Deretter resten av grunnmuren. Fase 2 er delt i to (innspill P2): først rapporten på PC, slik at fagrådet og Ståle kan se og godkjenne malen, tekstene og PDF-en tidlig, og så befaringen på iPad. Fagrådet, målingen i IVIT og eAccounting-prøven går parallelt, fordi de ikke trenger kode og ellers ville blitt flaskehalser.

---

## Ved siden av fase 0 og 1  `status: ikke startet`

Fem oppgaver som går parallelt med fase 0 og 1. De krever lite eller ingen kode, men noe må være gjort før fase 2 kan bli ferdig.

### Fagråd – runde 1 (innspill P3)

- [x] **Avklare fagrådet:** **Ståle er fagrådet alene** fram til EzProp er i produksjon. Det trengs ikke faste møter. «Fagrådet godkjenner» betyr Ståle godkjenner. (Besluttet 27.10.2026, `svar-fra-stale-2026-10-27.md` spørsmål 3)
- [ ] **Leveranse 1 – grensene verifisert:** tersklene i terskeltabellen er sjekket mot riktig punkt i NS 3600 (sidemannskontrollen del 1 R8)
- [ ] **Leveranse 2 – de 10 prøveeksemplene** på avvikstekster er godkjent
- [ ] **Leveranse 3 – kontrollpunktene for leilighet og fellesdeler:** hvilke punkter som gjelder boenheten, hvilke som gjelder fellesdelene, og hvilke som gjelder begge
- [ ] **De tre fagspørsmålene fra leilighetsanalysen** (`analyse-ivit-leilighetsrapport-2026-10-27.md`): TG0 på gamle våtrom, radon-HMS for leiligheter over bakkeplan, og røykvarsler og slukkeutstyr som egne punkter i leilighetsmalen

**Ferdig når:** Fagrådet (Ståle) har godkjent alle tre leveransene. Uten leveranse 3 kan ikke leiligheter (ca. 60 % av rapportene) lages i betaen.

### Måling i IVIT nå (innspill P4)

- [ ] **Ståle** noterer tid per befaring og tid fra befaring til levert rapport, på 10 oppdrag i IVIT (beslutning 27.10.2026: bare Ståle foreløpig)
- [ ] Tallene samles i et enkelt regneark og brukes som sammenligning i piloten

**Ferdig når:** 10 oppdrag er målt. Flere takstmenn kan måle når de velges før piloten. Det koster nesten ingenting og gir et ekte sammenligningsgrunnlag for mål 5.

### Nullpunkt for hovedmålet (28.10.2026)

Hovedmålet (50 % mindre tid, halvparten så mange reklamasjoner) trenger et sikkert sammenligningsgrunnlag før EzProp tas i bruk.

- [ ] **Utvide tidsmålingen i IVIT** til et sikkert nullpunkt: flere oppdrag og flere rapporttyper, med samlet tid per rapport delt i forberedelse, befaring, kontorarbeid og levering. Claudes forslag: minst 20–30 oppdrag fordelt på de vanligste rapporttypene.
- [ ] **Hente tall for reklamasjoner og krav de siste 3 årene:** antall, beløp og antall leverte rapporter per år, fra Byggcons egne oversikter eller fra ansvarsforsikringen. Legges inn som nullpunkt (`baseline_metrics` i datamodellen).

**Ferdig når:** Begge nullpunktene er skrevet ned med kilde og godkjent av Ståle.

### eAccounting-prøve i sandbox (innspill P7)

- [ ] Fire kall prøves i eAccountings prøvemiljø (sandbox): kunde uten dublett, fakturautkast, hente status (sendt, betalt) og kreditnota
- [ ] Kort notat: virker «ingen dubletter» og «status tilbake som hendelser», og hva betyr det for koblingstabellen mot leverandøren (`external_references`)

**Ferdig når:** Notatet er skrevet, også det som ikke virket.

### Undersøke API-ene til Enova og Polycam (27.10.2026)

Byggcon bruker **Enova** (energimerking) og **Polycam** (3D-skanning og plantegning med iPad). Ståle vil at API mot begge skal utforskes (`svar-fra-stale-2026-10-27.md` spørsmål 22). DIAKRIT og Boligpass tas ikke med.

- [ ] **Enova:** finnes det et API for energimerking (opprette, hente energimerke og attest)? Hva krever tilgang, og hva kan hentes inn i rapporten?
- [ ] **Polycam:** finnes det et API eller en eksport (plantegning, mål, 3D-modell) som EzProp kan hente? Kan LiDAR-skanning komme via Polycam i stedet for en egen app?
- [ ] Kort notat per tjeneste: hva som er mulig, pris og vilkår, personvern (EU/EØS), og forslag til når det kan bygges

**Ferdig når:** Notatene er skrevet. Selve tilkoblingene bygges senere (se «Senere»), bak porter i tilkoblingslaget.

---

## Fase 0a – Repo og database  `status: ferdig 28.10.2026 (PR #2 og #1)`

- [x] Repoet `Byggcon-sl/EzProp` satt opp som Optiplan: Next.js og TypeScript (strict), pnpm, ESLint, Prettier, Vitest, Playwright
- [x] GitHub Actions: lint, typesjekk, test og bygg ved hver pull request
- [x] `CLAUDE.md` og `docs/` med samme oppbygging som Optiplan (produkt, roller, domenemodell, arkitektur, plan, designprinsipper, åpne spørsmål), mal for funksjonsbeskrivelse og ADR. `CLAUDE.md` får regelen **«en fast kode (`key`) endres aldri, den arkiveres»** (`funksjonalitet-ki` avsnitt 8).
- [x] Datamodellen og planen fra SharePoint lagt inn i `docs/` som utgangspunkt
- [x] Lint-regel for modulgrenser (moduler importerer bare fra kjernen, felles kode og egen mappe)
- [x] PostgreSQL lokalt og Drizzle-oppsett, med felles kolonner på alle tabeller: ID laget på enheten, organisasjons-ID, laget/endret, myk sletting og radversjon
- [x] Testhjelper som viser at en spørring aldri gir data fra en annen organisasjon (`tests/tenant-isolation.ts`, 28.10.2026)
- [x] Produktnavnet «EzProp» står bare ett sted i koden (arbeidsnavn)

**Ferdig når:** En tom side starter lokalt, alle sjekkene i GitHub Actions er grønne, migreringen kjører i CI, og testen for tenant-isolasjon er grønn.

**Ståle avgjør innen demoen:** ingenting nytt. Fagrådet (Ståle) og måling i IVIT (Ståle) er avgjort 27.10.2026.

> Fase 1 starter så snart fase 0a står. Resten av grunnmuren (fase 0b) kommer etter prøven, fordi valget av synkverktøy kan påvirke databasen og innloggingen.

## Fase 1 – Prøve uten nett  `status: i arbeid fra 28.10.2026`

Målet er å finne ut, før noe stort bygges, om befaring uten nett i nettleseren på iPad holder mål (sidemannskontrollen del 1 T1 og del 2 P20–P23). Prøven bruker et lite testskjema, ikke den ekte malen.

- [x] **Testmiljø i Azure** (Ståle 28.10.2026): EzProp kjører i samme Azure-miljø som Optiplan (Sweden Central, EU), med egen app og egen database. Utrulling fra GitHub Actions ved merge til main, etter mønster fra Optiplans `infra/azure` og `deploy-azure.yml`. Bare oppdiktede data til «Minimum før ekte data» er på plass. Innlogging med kode på e-post via Microsoft 365 som i Optiplan (eller koden i serverloggen for første admin til e-post er satt opp). Ståle legger inn Azure-nøklene som secrets i GitHub og velger adressen (forslag: ezprop-test.byggcon.no). Ferdig når appen åpner på ekte iPad Pro i Safari fra hjemskjermen. (PR #7, merget 28.10.2026; «ferdig når»-kriteriet på ekte iPad bekreftes av Ståle etter første utrulling, når nøklene er lagt inn)
- [x] Testoppsett: to iPad Pro, appen lagt på hjemskjermen (PWA), et testskjema med ca. 40 felt (tekst, TG, valg, tall, tabell) og bildefelt (PR #6, 28.10.2026)
  - [x] UU-funn 6–9 fra nattløkken: synlig kolonnenavn i tabellcellene, felt med fokus skjules ikke bak statuslinjen, større trykkflate på «Til forsiden», og meldingen om å vente før bytte av kandidat leses opp (30.10.2026, `docs/agenter/oppgaver/fase1-uu-nattlokken.md`)
- [x] Kandidater satt opp mot samme testskjema: **PowerSync**, **ElectricSQL** og eventuelt andre (Claudes forslag: én enkel egenbygd løsning med lokal database og endringskø, som sammenligningsgrunnlag). Tekstfletting med Yjs eller tilsvarende.
  - [x] Kandidat 1, PowerSync, med tekstfletting (Yjs), protokoll og resultatmal for prøve A og B (PR #8, 28.10.2026, `docs/funksjoner/fase1-kandidat-powersync.md`)
  - [x] Kandidat 2, ElectricSQL, på samme skjema og samme protokoll (PR #10, 29.10.2026, `docs/funksjoner/fase1-kandidat-electricsql.md`)
  - [x] Kandidat 3, egenbygd (lokal database og endringskø), på samme skjema og samme protokoll (PR #11, 29.10.2026, `docs/funksjoner/fase1-kandidat-egenbygd.md`)
  - [x] Synktjenestene for kandidat 1 og 2 i Azure-testmiljøet, av som standard til Ståle slår dem på (PR #17, 29.10.2026, `docs/funksjoner/fase1-synk-i-azure.md`, `docs/drift/testmiljo-azure.md`)
    - [x] Småfunn fra gjennomgangen av PR #17: rydding av replikeringsplasser bare i egen database, lengdekrav på synkhemmelighetene, maskene i utrullingen og dokumentasjonen om hva tjenestene kan lese (29.10.2026, `docs/agenter/oppgaver/fase1-smafunn-synk-azure.md`)
- [ ] **Prøve A – én takstmann uten nett (må):** flymodus i 30 minutter, alle felt fylles ut, 200 bilder tas, appen lukkes og åpnes igjen, iPaden startes på nytt. Når nettet kommer: alt synkroniseres, ingenting går tapt.
- [ ] **Prøve B – to i samme rapport (bør):** to iPader endrer samme kontrollpunkt samtidig. Tekst flettes. TG, valg og tall følger «siste endring vinner», og den andre får varsel.
- [x] **Prøve C – lagring i Safari:** hvor mye plass appen får, at data overlever omstart og flere dager uten bruk, og hva som skjer når plassen er brukt opp
  - [x] Småfunn fra gjennomgangen av PR #32: loggen viser bare feilnavnet, testen for åpning uten nett uten reservevei, færre doble tester, ett mønster for plassmålingen (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-c.md`)
- [x] **Prøve D – bilder:** komprimering og riktig rotering på iPaden, HEIC til JPEG, opplasting mens appen er åpen, fortsettelse etter brudd, kontroll med fingeravtrykk (PR-en fra branchen `fase1-prove-d-bilder`, 30.10.2026, `docs/funksjoner/fase1-prove-d-bilder.md`; automatiske tester i Chromium på `pc` og `ipad`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-d-bilder-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #35: en visningskopi som avvises eller er slettet, sendes ikke igjen og vises som «Bare originalen er lagret», serveren slipper bare de feltene kopien trenger, én tegnevei, adressen ett sted, færre doble tester (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md`)
- [x] **Prøve E – regler uten nett:** én regel for alder mot levetid og én målegrense kjører på iPaden og gir samme svar som på serveren (PR-en fra branchen `fase1-prove-e-regler`, 29.10.2026, `docs/funksjoner/fase1-prove-e-regler.md`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-e-regler-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #23 og det som sto igjen fra PR #26: egen test for `localWriteGeneration`, testsakene for prøvereglene bare i testene, grensetallet ett sted, færre doble tester, og loggen i synken viser bare feilmeldingen (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-e.md`)
- [x] **Prøve F – innlogging som har gått ut:** takstmannen kan fortsatt åpne og fullføre rapporten uten nett (PR-en fra branchen `fase1-prove-f-innlogging`, 30.10.2026, `docs/funksjoner/fase1-prove-f-innlogging.md`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-f-innlogging-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #34: færre doble tester for meldingen om innlogging og i sjekken av innloggingen, og opprydding i testhjelperne (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md`)
- [x] Synkstatus som alltid vises: antall endringer og bilder som venter, «lagret kl.», og «Synk nå» (PR #21, 29.10.2026, `docs/funksjoner/fase1-synkstatus.md`)
  - [x] Småfunn fra gjennomgangen av PR #21: egen test for «Synk nå», trygg oppretting av testtakstmannen i e2e (bare lokal database og testdatabase), loggen viser bare feilmeldingen, og opprydding i testkoden (29.10.2026, `docs/agenter/oppgaver/fase1-smafunn-synkstatus.md`)
- [x] Sammenligning av kandidatene: virker prøvene, hvor mye arbeid, drift i EU/EØS, pris og hvor modent verktøyet er (30.10.2026, `docs/funksjoner/fase1-sammenligning.md`; bygger på de automatiske prøvene. **Foreløpig; bekreftes etter prøve A og B på ekte iPad, og Ståles godkjenning i demoen gjenstår**)
- [x] **ADR: valg av løsning for drift uten nett**, med begrunnelse og det som ikke virket (30.10.2026, `docs/adr/0004-drift-uten-nett.md`: egenbygd, reserve PowerSync eller ElectricSQL. **Foreløpig; bekreftes etter prøve A og B på ekte iPad, og Ståles godkjenning i demoen gjenstår**)
- [ ] Demo for Ståle på ekte iPad i en kjeller uten dekning

**Ferdig når:** Prøve A virker uten tap på to iPader flere ganger, prøve B virker med nett, og Ståle har sett demoen og godkjent ADR-en med valgt løsning.

**Ståle avgjør innen demoen:** godkjenne ADR-en for drift uten nett.

## Fase 0b – Innlogging, organisasjon, roller og layout  `status: ikke startet`

**Innlogging og sikkerhet**
- [ ] **Innlogging som Optiplan** (engangskode på e-post), med **felles innlogging og felles profil for admin og ansatte** mellom EzProp og Optiplan (Ståle 28.10.2026): samme bruker, samme navn, telefon, stilling og kontor i begge. **Kundene holdes adskilt**: Optiplans styrer og EzProps kunder og meglere er aldri samme brukere. Løsningen beskrives i en ADR som tar hensyn til ADR-en fra fase 1.
- [ ] **Bytte mellom EzProp og Optiplan med ett trykk** (Ståle 28.10.2026: «sømløst»): en lenke i menyen i begge løsningene, uten ny innlogging. Mer samspill enn dette kommer senere.
- [ ] **Sperre etter mange feil** ved innlogging (innspill P12). Tofaktor kommer i fase 4.
- [ ] **Nøkkelboks for hemmeligheter** (for eksempel Azure Key Vault, samme oppsett som Optiplan). Ingen nøkler i koden eller databasen, bare navnet på hemmeligheten (`secret_ref`). (Innspill P12)

**Organisasjon og tilgang**
- [x] Organisasjon → selskap → kontor → ansatt, med ansvarsforsikring og firmatekst per selskap. Ansatte som har sluttet, kan stå uten innlogging (innspill D18). (30.10.2026, branch `fase0b-organisasjon-selskap-kontor`)
  - [x] Småfunn fra gjennomgangen av PR #41: faste feltlister for selskaper og kontorer (ingen sporingsfelt), tenant-test også for ansatte som har sluttet, enklere join, seed-testene skriver ikke til konsollen (30.10.2026, `docs/agenter/oppgaver/fase0b-smafunn-organisasjon.md`)
- [ ] **Sertifisering med utløpsdato** (funksjonskart H5): den som har utgått sertifisering, kan ikke publisere som ansvarlig, og admin ser hvem som snart går ut. Varsel i arbeidslisten kommer i fase 3.
- [x] Roller og rettigheter i én felles tilgangsmodul, etter rettighetsmatrisen i `datamodell.md` avsnitt 5. Admin kan gi enkeltrettigheter (for eksempel maltilgang). Admin stenges aldri ute. **Fra 27.10.2026:** alle takstmenn ser alle oppdrag og data og kan foreløpig endre alt, styrt av en innstilling som er lett å stramme inn. Alle kan sende fakturagrunnlag. (31.10.2026, `docs/funksjoner/fase0b-roller-rettigheter.md`, beslutninger A18–A21; admin-skjermene er eget punkt)
- [ ] Admin: opprette selskaper, kontorer og ansatte, og gi roller

**Grunnmur**
- [ ] Revisjonslogg og hendelseslogg (grunnmuren som rapporter, maler og rutiner skriver til)
- [ ] Felles filtjeneste for bilder og dokumenter (lokal mappe i utvikling, fillagring i EU/EØS i drift), **bak et eget lag**, slik at bilder senere kan flyttes til et lokalt arkiv hos Byggcon (27.10.2026). Oppbevaringstidene er innstillinger.
- [ ] Tilkoblingslag med faste porter (regnskap, e-post, meglersystem, eiendomsdata, KI). Første tilkobling: e-post via Microsoft 365 som i Optiplan, og en «utviklingspostkasse» lokalt.
- [ ] Test av tenant-isolasjon for alle nye tabeller: en bruker i én organisasjon får aldri data fra en annen
- [x] Grunnlayout i design A «Fjord» (luftig), for PC og iPad, med tom arbeidskø som startside

**Ferdig når:** Admin har lagt inn Byggcon med selskapene, kontorene og noen ansatte. En takstmann logger inn med engangskode (samme innlogging som i Optiplan) og ser en tom arbeidskø. En automatisk test viser at en annen organisasjon ikke ser noe av Byggcons data.

**Ståle avgjør innen demoen:** ingenting nytt. Betaen er bare Ståle foreløpig, og eierformene og boligtypene er godkjent (27.10.2026).

## Minimum før ekte data (innspill P1)  `status: ikke startet`

Før det første ekte oppdraget (med ekte adresser, selgere, bilder og egenerklæringer) legges inn i fase 2, skal dette være på plass. Den fulle personvernpakken (protokoll, vurdering av personvernkonsekvenser for KI, opplæring) ligger fortsatt i fase 4.

- [ ] **Lagring i EU/EØS med HTTPS** for drift, database og fillagring
- [ ] **Daglig sikkerhetskopi**, og én gjenoppretting som er prøvd og skrevet ned
- [ ] **Databehandleravtaler** med leverandørene for drift, fillagring og e-post
- [ ] **Tilgang bare for ansatte** (ingen innlogging for kunder eller meglere ennå)
- [ ] **Intern personvernerklæring:** kort om hva som lagres, hvorfor, hvor og hvor lenge
- [ ] **Regel for sletting av data fra betaen** som ikke skal beholdes (for eksempel prøverapporter som bare var for testing)
  - Merknad 28.10.2026 (oppgave 4): `trial_*`-tabellene fra fase 1 slettes eller gjøres om her bare fordi dataene er oppdiktede. Det er ikke presedens for sletting av ekte data (regel 3: ingenting slettes permanent).
- [ ] **Sperring av iPader** (innspill P6 og D10): kode eller Face ID påkrevd, og en mistet iPad kan sperres. Må være på plass før første ekte befaring på iPad i fase 2b.
- [ ] **Microsoft 365 koblet til**, og koden i serverloggen for første admin er ikke lenger i bruk
- [ ] **Privat nettverk eller VNet-integrasjon mellom app og database** (ikke brannmurregelen for alle Azure-tjenester), og egen databasebruker for appen uten eierrettigheter

**Ferdig når:** Ståle har sett listen krysset av og godkjent at ekte data kan legges inn.

## Fase 2a – Rapporten på PC  `status: ikke startet`

Tilstandsrapport for **bolig og leilighet** som systemmal, laget og publisert **på PC**, med full selskapsstruktur. Ingen iPad og ingen drift uten nett ennå. Kjøres **ved siden av IVIT** (IVIT er fortsatt fasit). Betaen holdes smal på funksjoner (beslutning 25.10.2026). Målet er at fagrådet og Ståle kan se og godkjenne malen, tekstene, reglene og PDF-en i et ekte skjermbilde så tidlig som mulig (innspill P2).

**Oppdrag og eiendom**
- [ ] Manuell ordre (bestilling lagt inn for hånd fra e-post), med egne felt som gnr/bnr, seksjon, borettslag og om egenerklæring er mottatt, og «gjør om til oppdrag» eller «avvis»
- [ ] **Oppdragsnummer** som `2026-00123`, laget på serveren fra en nummerserie (innspill D9)
- [ ] Oppdrag med team (ansvarlig, medansvarlig, befaringstakstmann, sidemann, kontor), parter med roller (megler, selger, kjøper, representant, fakturamottaker) og hva hver part mottar
- [ ] Utstedende selskap settes automatisk fra ansvarlig takstmann
- [ ] Statusflyten med **fire statuser** (bestilt, under arbeid, ferdig, fakturert, 27.10.2026) og hendelser som lagres for alt som skjer. Kansellering med myk sletting. En rapport som er rettet og sendt på nytt, får merket **«Rettet»** under «Ferdig» (27.10.2026).
- [ ] Oppdragslisten som arbeidskø: faner etter status med antall, hurtigfilter, kort notat per oppdrag, merker med status, dato og takstmann
- [ ] Avtale med oppdragsgiver (for eksempel Fremtind) med egen rapportprofil og premissetekst
- [ ] Eiendom og matrikkel lagt inn for hånd, med boligtype og **eierform**, og **fellesdeler** for leilighet
- [ ] Bygninger, etasjer, **areal per etasje** (BRA-i, BRA-e, BRA-b, ALH) med hvem som målte og metode, og rom med romtype og «under terreng»
- [ ] Kontakter og firma (meglere og meglerforetak) med notater, uten dubletter på organisasjonsnummer, og med kilde for opplysningene (innspill D17)
- [ ] **Tidsmåling per rapport fra første ekte rapport** (hovedmålet, 28.10.2026): arbeidsøkter per fase (forberedelse, befaring, kontorarbeid, levering) lagres automatisk fra hendelsene, slik at tiden kan sammenlignes med nullpunktet fra IVIT.
- [ ] **Reklamasjoner med enkelt skjema fra første ekte rapport** (beslutning 27.10.2026, spørsmål 4). **Bare leder og admin ser reklamasjonssakene** (unntak fra «alle ser alt», 27.10.2026). Reklamasjonsmappen kommer i fase 4.
- [ ] **Fire testoppdrag som grunndata** (innspill P11): enebolig med garasje, leilighet i sameie, borettslagsleilighet og fritidsbolig, med bilder uten personer. Brukes i «Prøv malen», i regeltester og i demoer.

**Malen og reglene**
- [ ] Malmotoren fra `datamodell.md` 4.5: malfamilie, malversjon, seksjon, felt, kontrollpunkt, avviksspørsmål, utfall, standardtiltak og regler. Systemmalen er låst for alle uten maltilgang.
- [ ] **Regneark inn og ut med faste ID-er** for systemmalen. Slik redigerer fagansvarlig malen i betaen (P19); egen maleditor kommer i fase 5.
- [ ] Automatisk kontroll av malen før publisering: obligatoriske punkter finnes, TG3 har kostnad, ingen regler peker på felt som ikke finnes, og alle testtilfeller består
- [ ] «Prøv malen»: et testskjema som viser hvilke spørsmål og TG-forslag som kommer
- [ ] Levetider (NS 3600:2025 tillegg C som tall, **med trinn**, innspill D4), terskler (bekreftet av fagrådet) og kostnadsintervaller som egne tabeller
- [ ] Regelmotoren som én felles kodepakke for iPad og server: vis/skjul, **TG-forslag fra materiale, alder (med kilde for alderen og om dokumentasjon finnes) og målinger**, forslag om TGIU på punktet, og kontroller. Testtilfeller per regel. De nye betingelsestypene fra innspill D5 (snødekke, bygningstype, TG på annet punkt, bilde mangler, TGIU satt).
- [ ] Regler fra beslutningene: hulltaking nektet gir TGIU (på kontrollpunktet, innspill D1), loft uten adkomst gir TG2 (med unntaket), radon 100 Bq/m³, våtrom fra før 2000
- [ ] Systemmalen for tilstandsrapport bolig og leilighet lagt inn, med Byggcons egne avvikstekster. **TG-logikk finnes bare i denne systemmalen** (27.10.2026).
- [ ] «Handling»-frasene fra IVIT importeres som tiltak. Feltet kan hete «Konsekvens/tiltak» (27.10.2026).
- [ ] **Fagrådet (Ståle) godkjenner malen, tekstene og grensene** i det ekte skjermbildet (bygger på «Fagråd – runde 1»)
- [ ] Rapporten låses til malversjonen den startes med

**Rapporten på PC**
- [ ] Kontrollpunkter per bygning og rom, «i»-knapp med kravet fra forskriften (med egne ord), HMS-merke, hjelpetekster, «ferdig» per punkt og fremdrift
- [ ] Felt for tall med enhet og gyldig område (fall, terskel, skjevhet, punkterte ruter, rekkverkshøyde, fukt) og tabell for hulltakingsmålinger
- [ ] **Avvikskort** med alt på ett sted: TG, årsak (begrunnelse og kriterium, også «manglende dokumentasjon», innspill D7), konsekvens, flere tiltak, kostnad (ett av de fem intervallene, eller **eget beløp** i stedet for intervall) og valgfri kostnadstekst. Eget beløp rundes ikke av automatisk, men gir **advarsel** hvis det ikke er rundet av til minst nærmeste 10 000 (27.10.2026). TG2/TG3-forslag kan godtas, endres eller avvises med begrunnelse.
- [ ] **TGIU på kontrollpunktet** med opplysningene (hvorfor, eier informert, annen kontroll og resultat, risiko, utsatt konstruksjon), og ferdig tekst som teller som utfylt. «Gjelder ikke» på et obligatorisk punkt krever begrunnelse (innspill D6).
- [ ] Befaringer: dato, klokkeslett, forhold (snø) og hvem som var til stede. **Flere befaringer per rapport** (hovedbefaring, tilleggsbefaring, etterkontroll), innspill D2.
- [ ] Dokumentasjonstabell, egenerklæring (mottatt eller ikke, avvik) og NS-utgave i rapporten
- [ ] **Fraser:** felles og mine, favoritter, «mest brukt», søk som tåler skrivefeil (også med «/»), filtrert på kontrollpunkt, felt og TG, lagre ny frase fra rapporten, endringslogg og «gå tilbake». Forslag fra frasebanken uten KI.
- [ ] **Bilder på PC:** last opp, knytt til rom, kontrollpunkt og avvik, rotering, markering som eget lag (piler, ringer, tekst, farge etter TG), bildetekst, forsidebilde og bekreftelse før sletting
- [ ] Sammendrag (skrives av takstmannen), **oppsummering per bygningsdel** som lagres og kan redigeres (innspill D12), og oversikt over TG
- [ ] Papirkurv og angre for sletting

**Publisering, PDF og sending**
- [ ] **Publisering med sperre:** de sju kravene fra forskriften stopper, den ansatte kan krysse bort sperren aktivt, overstyringen logges, og mangelen kommer tilbake i ny versjon. Sperre nr. 1 tar hensyn til «gjelder ikke» og «gir ikke TG» (innspill D6). Andre mangler gir advarsel, blant annet påkrevd sidemannskontroll som ikke er godkjent, og eget kostnadsbeløp som ikke er rundet av (27.10.2026). Mangler vises underveis som et lite merke.
- [ ] **Forslag, ikke vedtatt** (fra `analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 6, Ståle avgjør): nye advarsler i sjekken før publisering:
  - ventilasjon (samme anlegg) er beskrevet ulikt to steder i rapporten
  - forretningsfører og kilde for fellesgjeld mangler for borettslag og sameie (påkrevd eller begrunnet)
  - ny versjon uten kort kommentar om hva som er endret
- [ ] Utgivelser med versjon: hver utgivelse låses med innhold, PDF og fingeravtrykk, og med hvem som signerte og hvilken sertifisering som gjaldt (innspill D8). Retting gir ny versjon med opprinnelig dato. **Gyldig til = ett år fra befaringsdato** (27.10.2026).
- [ ] **ADR: valg av PDF-motor** (innspill P5), med testutskrift av en rapport med 50 bilder. Krav: stående og liggende, profiler, bilder med markering, innholdsfortegnelse, norsk orddeling, samme resultat hver gang.
- [ ] **PDF** med Byggcons profil: forside, om Byggcon (firmatekst fra selskapet), forklaring av TG, sammendrag med antall per TG, bygningene med avvik og bilder, arealer, dokumentasjon, forutsetninger, signatur og bunntekst med juridisk selskap. Ingen interne koder i teksten, og tomme deler gir ikke egne sider. Stående og liggende profil. Bildene i PDF-en har ikke GPS-posisjon (innspill D14).
- [ ] **Forslag, ikke vedtatt** (fra `analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 6, Ståle avgjør): i PDF-profilen viser HMS-delen bare en kort liste med henvisning til punktet (ikke hele teksten på nytt), en overskrift holdes alltid sammen med teksten under, tabellkolonner har faste bredder, og lovlighet står bare ett sted.
- [ ] **PDF under 8 MB** (innspill P8): bildene i PDF-en skaleres ned og komprimeres. Blir PDF-en likevel større, sendes en lenke eller to e-poster. Testes med rapporten med 50 bilder.
- [ ] **«Send»-knapp** (innspill P9): rapporten sendes som vedlegg til mottakerne først når noen trykker. Status «Ferdig» settes når rapporten er sendt (innspill D16). En rettet rapport sendes manuelt av den ansvarlige (27.10.2026).

**Ferdig når:** Fagrådet har gått gjennom malen og reglene i et ekte skjermbilde og godkjent tekstene der, og Ståle godtar en PDF (også testutskriften med 50 bilder, under 8 MB).

**Ståle avgjør innen demoen:** forslagene fra leilighetsanalysen (nye advarsler og PDF-profil). Gyldig til, originalbilder og sidemannskontroll er avgjort 27.10.2026.

## Fase 2b – Befaringen på iPad  `status: ikke startet`

Samme rapport, nå med **befaringen på iPad uten nett**, med løsningen fra fase 1.

- [ ] Befaring på iPad uten nett, og samme data på PC (to visninger for konstruksjonene)
- [ ] iPad-visning for befaringen: kontrollpunkter per bygning og rom, store trykkflater, «ferdig» per punkt og fremdrift
- [ ] **Bilder på befaringen:** kamera ett trykk unna, serie med bilder, bildet knyttes til rom, kontrollpunkt og avvik der det tas, og kø for opplasting
- [ ] Synkstatus og «lagret kl.» alltid synlig
- [ ] **«Glemt noe?»** (`funksjonalitet-ki` K4): før takstmannen går videre fra et rom, vises punkter som mangler og avvik uten bilde. Faste regler, ingen KI, virker uten nett.
- [ ] **Oppsett av iPadene** (innspill P6): kode eller Face ID påkrevd, appen på hjemskjermen, iPaden registrert som enhet i EzProp og mulig å sperre (innspill D10). **Ingen Intune nå** (27.10.2026). Det vurderes senere.
- [ ] **Listen «omveier til IVIT» startes** (innspill P14): alt takstmannen likevel må gjøre i IVIT (ordrebekreftelse, verditakst, meglerlevering, kalender), føres opp fra første betarapport

**Ferdig når:** Ståle (betaen er bare Ståle foreløpig, 27.10.2026) har laget to tilstandsrapporter (én enebolig og én leilighet med fellesdeler) i EzProp, ved siden av IVIT, med befaring på iPad uten nett, TG-forslag fra alder og målinger, publisering med sperre og en PDF Ståle godtar.

**Ståle avgjør innen demoen:** hvem som er med i piloten. Flere takstmenn velges før piloten (minst tre).

## Fase 3 – Pilot  `status: ikke startet`

Flere takstmenn bruker EzProp på ekte oppdrag. IVIT brukes fortsatt for det EzProp ikke dekker.

**Kvalitet**
- [ ] Flere takstmenn og alle tre selskapene i bruk, også to i samme rapport med nett
- [ ] **Sidemannskontroll** i EzProp: krav per ansatt satt av leder, «send til sidemann», kommentarer per sted i rapporten, sendt tilbake eller godkjent med navn og tid, logg og enkel statistikk over funnene. Manglende kontroll gir **bare advarsel**, og sidemannen **kommenterer og godkjenner, men retter ikke** (27.10.2026).

**Rutiner og meldinger**
- [ ] **Hendelser og handlinger:** «når → bare hvis → gjør» med grupper av betingelser, handlingene e-post med **ekte vedlegg** (rapport-PDF), oppgave og merke, innstillinger per melding (én gang, tidsvindu, ikke helg), og regler som også gjelder oppdrag som fantes fra før
- [ ] **De seks ferdige rutinene:** velkomst til selger (med del som ordrebekreftelse), befaringstidspunkt til megler, påminnelse dagen før (kl. 12 til selger, kopi til takstmann), rapport til kunde, rapport til megler og spørreundersøkelse til selger. Rutinene er **avanserte funksjoner som admin kan justere**, og **hver takstmann kan lage egne rutiner** (27.10.2026).
- [ ] **Spørreundersøkelse i EzProp** (27.10.2026): spørsmål og svar lagres i databasen (ikke Microsoft Forms), slik at svarene kan brukes i malene og i meglerprofilen
- [ ] **Automatisk sending ved publisering** kan slås på **per selskap** når køen har vist seg pålitelig (innspill P9). Til da brukes «Send»-knappen.
- [ ] **Kø og logg per oppdrag:** planlagt, sendt, hoppet over, feilet og stoppet, med grunn i klarspråk. Forhåndsvisning av hva som vil gå, «send nå», «stopp» og «send på nytt» med oppdaterte data. Flytting av befaringen planlegger meldingene på nytt. Varsel når noe feiler.
- [ ] Maler for e-post med flettefelt, og forklaring før bekreftelse av hva som skjer automatisk
- [ ] Oppgaver knyttet til oppdrag og kontakt, med ansvarlig, frist, status og kommentarer, også laget av regler (for eksempel «egenerklæring mangler 2 dager før befaring»)
- [ ] **Oppgaver på mobil og daglig oppsummering** (funksjonskart H12): egne oppgaver kan ses og krysses av på telefonen, og hver ansatt kan få en kort e-post om morgenen med dagens oppgaver og befaringer
- [ ] Hendelsen «rapporten nærmer seg ett år»

**Kontor, kalender og økonomi**
- [ ] **Kalender og kapasitet** (funksjonskart H1): befaringstid på oppdraget, kalender per takstmann (befaringer og fravær), ukesvisning med tidslinje som ikke flyter over, kapasitet per kontor de neste to ukene, og **kobling til Outlook begge veier** via Microsoft 365. Erstatter den enkle kalenderinvitasjonen (.ics) i den første planen.
- [ ] **Bestillingsskjema for meglere** (funksjonskart H8): et enkelt skjema med de samme feltene som den manuelle ordren. Bestillingen blir en ordre som kontoret godkjenner. Fjerner avskrift før API mot meglersystemene finnes.
- [ ] **Fakturagrunnlag til eAccounting** gjennom tilkoblingen: fritt valgt mottaker, linjer med MVA, kontroll og «send», riktig eAccounting-klient for hvert av de tre selskapene, ingen dubletter av kunder, status tilbake som hendelsene **«faktura sendt»**, **«faktura betalt»** og «faktura forfalt». Liste over ufakturerte og ubetalte oppdrag.
- [ ] **Prisliste per avtale som data** (funksjonskart H2): standardpriser og avtalepriser foreslås på fakturalinjene. En prismotor (pris etter areal, alder og avstand) kommer senere.
- [ ] **Enkelt lederdashbord** (funksjonskart H3): oppdrag per status, befaringer neste uke, levert siste 30 dager, leveringstid, ufakturert og forfalt, per kontor og selskap, og pilotmålene
- [ ] **Søk og arkiv:** globalt søk på oppdragsnummer, adresse, matrikkel og kundenavn, arkiv med filtre, hurtigperioder, lagrede filtre og eksport til Excel
- [ ] Oppslag i Brønnøysundregistrene for firma (som i Optiplan)

**Arbeidsflaten**
- [ ] Kopiere oppdrag og **kopiere data fra en tidligere rapport** på samme bolig, med liste over hva som ikke passer i ny malversjon
- [ ] Radmeny i oppdragslisten: kopier, last ned siste PDF, bytt takstmann (overlevering), kopier data fra
- [ ] Bildesenter på PC: dra bilder til riktig rom, punkt eller avvik
- [ ] Stedsmerker (etasje, himmelretning, rom) og flagg «må fullføres på kontoret»
- [ ] Privat notat per rapport
- [ ] **Varsler som arbeidsliste** (funksjonskart H11) med lest/ulest og filter, og varselvalg per type (innspill D11). Også varsel når en sertifisering snart går ut (H5).
- [ ] **Hjelp i appen koblet til kunnskapsbasen** (funksjonskart H7): hjelpetekst og «i» per punkt peker til Byggcons egne sider i kunnskapsbasen, ikke til en ekstern hjelpeside
- [ ] Mørk visning som valg, og større tekst
- [ ] Knappen «Tilbakemelding» med skjermbilde, og enkel feilsøking på iPaden («send feilsøkingsinfo»)
- [ ] Rapportprofil med flere valg for PDF (innholdsfortegnelse, avvik først)
- [ ] Måling av pilotmålene (se «Hva vi måler i piloten»)

**Ferdig når:** Minst tre takstmenn har levert ekte rapporter fra EzProp i fire uker, sidemannskontrollen er gjort i EzProp, de seks rutinene har gått uten feil som ikke ble oppdaget, og fakturagrunnlag har gått til eAccounting for alle tre selskapene.

**Ståle avgjør innen demoen:** om automatisk sending skal slås på for et selskap. Påminnelsen og spørreundersøkelsen er avgjort 27.10.2026.

## Fase 4 – Produksjon  `status: ikke startet`

**Sikkerhet og personvern**
- [ ] **Personvern, full pakke:** behandlingsgrunnlag, personvernerklæring, protokoll over behandlinger, databehandleravtaler med alle leverandørene (drift, e-post, fillagring, tale til tekst, KI), og vurdering av personvernkonsekvenser for KI. Byggcon eier arbeidet, med Ståle som daglig leder (beslutning 25.10.2026). Claude lager utkast. Det grunnleggende er allerede gjort i «Minimum før ekte data».
- [ ] **Sikkerhetskopi:** daglig kopi har gått siden «Minimum før ekte data». Ny prøvegjenoppretting gjøres og dokumenteres før alle tar EzProp i bruk.
- [ ] **Oppbevaring i minst 10 år:** låste utgivelser, bilder og måledata kan ikke slettes, og originalbildene følger innstillingene (avviksbilder i original 10 år, andre originaler 2 år, komprimert 10 år, besluttet 27.10.2026)
- [ ] Tofaktor eller tilsvarende sikker innlogging (mål 11). Sperre etter gjentatte feil kom i fase 0b.
- [ ] Drift i EU/EØS med overvåking og varsel, som Optiplan (Azure)
- [ ] Gjennomgang av sikkerhet og tilgjengelighet før alle tar det i bruk

**Overgang fra IVIT**
- [ ] **Flytting av frasene fra IVIT:** Fraseregisteret (Excel v13, rettet for TGIU ved hulltaking nektet og med riktig antall) kobles til kontrollpunktene og importeres med kode, tittel, TG og kilde
- [ ] **Opplæring** av alle ansatte, med kort brukerveiledning og hjelp i appen (koblet til `04 Opplæring` i kunnskapsbasen)
- [ ] Regel for pågående oppdrag ved overgangen (fullføres i IVIT)
- [ ] Fagrådet (Ståle) har godkjent malen, tekstene og reglene (mål 2)

**Kvalitet og meglere**
- [ ] **Registrering av reklamasjoner og reklamasjonsmappe** (funksjonskart H6 og `moonshots` S1): reklamasjoner og krav registreres på rapporten og på det konkrete punktet eller avviket, med utfall og beløp. Alt om en sak (utgivelser, bilder, målinger, hvem som var til stede, egenerklæring, logg, sidemannskontroll) samles på ett klikk.
- [ ] **Intern avviksregistrering** (H6): når noe gikk galt i arbeidet (feil mottaker, glemt punkt), registreres det, så det kan læres av
- [ ] **Adressebok med tall / meglerprofil** (funksjonskart H4): oppdrag per måned, leveringstid og svar på spørreundersøkelsen, per megler og meglerforetak
- [ ] **Fullt CRM rett etter adresseboka** (flyttet fra «Senere» 27.10.2026, Ståle: «full CRM må komme relativt raskt i utviklingsløpet»): historikk, notater, logg og oppgaver per megler og meglerforetak, automatiske merker (for eksempel «aktiv selgermegler»), megleranalyse og egne eksporter. Spesifiseres før bygging.

*Tatt ut 27.10.2026 (Ståle: «ikke noe interaksjon foreløpig»):* oppslag i Optiplan på sameiets organisasjonsnummer (O1) og én kundebase med Optiplan (O3). Felles innlogging gjelder fortsatt. **Presisert 28.10.2026:** felles innlogging og profil for admin og ansatte, og bytte mellom løsningene med ett trykk, er med (fase 0b). Kundene holdes adskilt. Mer samspill «etter hvert».

**Ferdig når:** Alle ansatte har fått opplæring og bruker EzProp for nye tilstandsrapporter, personvern og sikkerhetskopi er på plass, og frasene fra IVIT ligger i EzProp.

**Ståle avgjør innen demoen:** når IVIT kan sies opp for tilstandsrapporter. Rapporter med markedsverdi lages fortsatt i IVIT til en verdidel finnes (se «Senere»).

## Fase 4b – Kundesiden  `status: ikke startet (godkjent 27.10.2026)`

Funksjonskartet (H9) foreslo at det kunder og meglere merker, samles i en egen fase etter produksjon. **Godkjent av Ståle 27.10.2026:** fasen kommer etter produksjon og før malbyggeren (fase 5).

- [ ] **Nettrapport** for kjøper, med filter på TG og rom, bilder i full størrelse og varsel «du ser ikke hele rapporten» når et filter er på
- [ ] **Gyldighetsside med QR-kode** i PDF-en: lenken viser alltid siste versjon, varsler når rapporten er utgått, og har en visningslogg
- [ ] **Selgerportal** før befaring: hva som skjer, hva selger bør finne fram (dokumentasjonstabellen som sjekkliste), opplasting av egenerklæring og dokumenter
- [ ] **Meglerstatus:** megleren ser status på sine oppdrag og kan laste ned siste PDF

**Ferdig når:** En selger, en kjøper og en megler har brukt sin side på et ekte oppdrag uten å måtte ringe kontoret.

## Fase 5 – Malbygger for egne maler  `status: ikke startet`

Kommer etter at systemmalen for tilstandsrapport virker (LES-MEG, «Målgang»). Bruker samme datamodell som systemmalene.

- [ ] Visuell malbygger der ansatte setter sammen seksjoner og felt: tekst, avkrysning, valg, tall med enhet og gyldig område, dato, bilde, signatur, tabell og frase
- [ ] Redigering i tre kolonner (seksjoner → felt → innstillinger) med automatisk lagring
- [ ] Regler, logikk og sjekker i egne maler (vis/skjul, kontroller før publisering og lignende), men **ikke TG-logikk**, som er forbeholdt systemmalen for tilstandsrapport (27.10.2026)
- [ ] Flytte og kopiere seksjoner og felt, også mellom maler, og klone en mal
- [ ] Lagre en god rapport som ny mal
- [ ] Versjoner og «endringer gjelder bare nye rapporter», papirkurv og angre
- [ ] «Prøv malen» før den tas i bruk
- [ ] **Én felles PDF-layout for egne maler** (innspill P13): seksjon → felt → svar, bilder i rutenett, med rapportprofilene (logo, bunntekst, stående eller liggende). Systemmalene har sin egen, spesiallagde layout. Vil takstmennene ha mer, blir det en ny fase.
- [ ] Maleditor for fagansvarlig også for systemmalen, i stedet for regneark

**Ferdig når:** En ansatt uten hjelp har laget en ny rapporttype i malbyggeren, brukt den på et oppdrag og fått en PDF.

## Senere (ikke planlagt i tid)

I rekkefølge etter nytte, Claudes forslag:

- **Rapporttyper (27.10.2026):** Målet er at **alle IVITs maler skal inn etter hvert, pluss nye**. Rekkefølgen tas senere. *Merknad:* Ståle sier at **de færreste tilstandsrapportene har verdi**. Verdidel og markedsverdi er derfor **ikke et krav for produksjon**, og blir liggende her sammen med de andre malene. Leilighetsrapporter med markedsverdi (teknisk verdi og fellesgjeld, se `analyse-ivit-leilighetsrapport-2026-10-27.md`) lages i IVIT til en verdidel finnes.
- **Verdidel for leilighet og andel** (*forslag, ikke vedtatt*, fra `analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 2 og 6): formål, markedsverdi med og uten fellesgjeld, teknisk verdi, tomteverdi, felleskostnader, fellesgjeld med dato og kilde, sammenlignbare salg og begrunnelse. Et fast beregningsoppsett i kode, ikke noe malbyggeren lager. Feltene legges i datamodellen når verdidelen planlegges.
- **Enova og Polycam** (27.10.2026): tilkobling for energimerking (Enova) og for 3D-skanning og plantegning (Polycam), bak porter i tilkoblingslaget. Bygges etter undersøkelsen ved siden av fase 0 og 1. LiDAR kan komme via Polycam i stedet for en egen app.
- **Kalibrering per takstmann** (27.10.2026: ja, men **etter betaen**): kalibreringsrunder og kalibreringsbibliotek, med enighet fra de ansatte
- **Intune** for styring av iPadene (27.10.2026: vurderes senere)
- **API mot meglersystemer:** bestilling inn og rapport ut, med sikret webhook, nye forsøk og logg (P37)
- **Eiendomsdata fra leverandør** (Eiendomsverdi eller PropCloud), med visning av hva som er overstyrt
- **Microsoft-innlogging** for ansatte
- **KI-funksjoner** i rekkefølgen fra `ki-funksjoner.md`. *Merket «vurder å flytte fram» (28.10.2026):* funksjonene som klart bidrar til hovedmålet. Ingenting er flyttet ennå.
  - Trinn 1: logg og merking av KI-bruk (bygges før noen KI-funksjon slås på), sjekk av bildekvalitet uten KI, **evalueringssett** og **kostnadsmåling** (`funksjonalitet-ki` avsnitt 9):
    - *Evalueringssett:* for hver KI-funksjon lages 30–50 eksempler med fasit fra fagrådet (for eksempel 50 diktater med riktig strukturering). Funksjonen slås ikke på før den treffer godt nok, og settet kjøres på nytt når modellen byttes.
    - *Kostnadsmåling:* kostnad per kall og per rapport måles fra første dag (`ai_usage_log.cost`), slik at det kan sammenlignes med IVITs 169 kr per rapport.
  - Trinn 2: tale til tekst (kjøpt tjeneste i EU/EØS), språkvask med «bruk, behold, nytt forslag» og angre, utkast til sammendrag. **Vurder å flytte fram** (mindre tid).
  - Trinn 3: diktat til strukturert funn (TG-feltet står tomt), forslag fra frasebanken på betydning, KI-sjekk før sidemannskontroll, bilde til utkast til observasjon, sortering og tekst på bilder. **Vurder å flytte fram:** diktat til strukturert funn (mindre tid) og KI-sjekk før sidemannskontroll (færre reklamasjoner).
  - Deretter: henvendelse til handling, læring fra sidemannskontroll, KI-hjelp til e-posttekst på norsk med spamsjekk, KI til å redigere maler
- **Prioritering etter produksjon** (Claudes forslag fra `funksjonalitet-ki` avsnitt 10, etter nytte per innsats):
  1. Reklamasjonsmappe (F3, nå i fase 4) og boligens historikk (F1: alle Byggcons rapporter på samme eiendom som tidslinje)
  2. «Glemt noe?» (K4, nå i fase 2b)
  3. KI trinn 1–2: logg, språkvask (R1), tale til strukturert funn (K1) og sammendrag i klarspråk (R3)
  4. E-post blir ordreforslag (A1). **Vurder å flytte fram** (mindre tid).
  5. Konsistenssjekk før sidemann (R2) og KI-sidemann mot kunnskapsbasen (R7). **Vurder å flytte fram** (færre reklamasjoner).
  6. ~~Oppslag i Optiplan (O1)~~ tatt ut 27.10.2026 (ingen samspill med Optiplan foreløpig)
  7. Nettrapport, selgerportal og meglerstatus (F6–F8, nå i fase 4b)
  8. Fagrådets verktøy: kalibreringsoversikt (F2), kalibreringsbibliotek (F4) og statistikk (F5). Kalibrering kommer etter betaen (27.10.2026).
  9. Måleutstyr rett inn og LiDAR (K6, K7), først når behovet er bevist. «Alt i nettleseren» står (27.10.2026), og LiDAR kan komme via Polycam.
- **Verditakst som systemmal nr. 2** (funksjonskart H10). Se «Rapporttyper» øverst i listen: alle maler skal inn etter hvert, og rekkefølgen tas senere (27.10.2026).
- **Uttrekk fra IVIT** av gamle rapporter og bilder, slik at de kan søkes fram (mål 10)
- **Salg til andre takstfirma** (organisasjons-ID er på plass fra start)
- Utkast til eier før endelig rapport, kompetansebeskrivelse og lyd og støy (NS 3600, besluttet «senere» 25.10)
- Egne kontrollpunkter og regler per avtale med oppdragsgiver
- Krav om sidemannskontroll per rapport
- SMS via norsk leverandør med samtykke, API og MCP for KI-verktøy, full statistikk og egne dashbord, kjøreplan og forslag til takstmann, prismotor og internfakturering mellom selskapene
- Strekkmålene under
- **Byggcon som datakilde:** statistikk holdes internt, vurderes igjen etter 2–3 år (27.10.2026)

## Strekkmål (moonshots)

De fem strekkmålene fra `moonshots-ezprop-2026-10-25.md` avsnitt 6. De ligger i «Senere» og bygges ikke nå. **Endret 27.10.2026:** ettårs-oppfølgingen, samspill med Optiplan og samme-dag-rapport er tatt ut (Ståle: nei). **Krokene i datamodellen er lagt inn** (`datamodell.md` avsnitt 4.13), slik at dataene samles fra første rapport og funksjonene ikke blir dyre senere.

| Nr | Strekkmål | Hva det er | Kroker som allerede er lagt inn | Det som mangler |
|---|---|---|---|---|
| 1 | **Den lukkede sløyfen** (S1, S6) | Reklamasjoner og utfall registreres på punktet, og neste takst av samme bolig sammenlignes automatisk med forrige. ~~Kjøper og selger spørres etter ett år (S4)~~ – tatt ut 27.10.2026. | `claims`, `reports.copied_from_report_id`, hendelsen `claim.registered` | Enkelt skjema for reklamasjoner fra første ekte rapport (2a), reklamasjonsmappe i fase 4 (H6). Sammenligningen er senere. |
| 2 | **Robusthet og kalibrering** (S2, B7, R1, O3 i `moonshots`) | Råd før publisering ut fra hvilke punkter som gir saker, månedlig kalibreringsquiz, regler som ofte avvises flagges til fagrådet, og et ukesbrev til fagrådet | `claims`, `publish_check_results`, `reference_photos`, `calibration_rounds`, `calibration_answers`, `deviations.suggestion_status`, `peer_reviews.required_reason` (stikkprøve) | Nok data (2–3 år), og enighet med de ansatte om kalibrering per person |
| 3 | **Briefing og forbefaring** (B1, B2) | Ett ark kvelden før befaringen (forrige rapport, radon, flom og skred, byggeår; Optiplan tatt ut 27.10.2026), og selger tar bilder av sluk, sikringsskap og luker før befaringen | `photos.source = seller`, `reports.copied_from_report_id`, `common_areas` | Selgerportal (fase 4b) og åpne datakilder |
| 4 | **Rapporten i lag, med levende gyldighet** (P1, P5, P6 i `moonshots`) | Én side for den travle, nettrapport og full PDF av samme data. QR-lenke som alltid viser siste versjon. Megleren ser sine oppdrag. | `report_releases.snapshot`, `report_releases.valid_until`, rollen `broker` | Fase 4b |
| 5 | **Kost per rapport** (O1 i `moonshots`) | Ekte kostnad per rapport (tid fra hendelsene, kjøring, KI, sidemann). ~~Samme-dag-rapport (O2)~~ er ikke et mål (27.10.2026). | `events`, `ai_usage_log.cost` | Kjørelengde, og et lederdashbord som viser tallene (fase 3 og 4) |

De andre strekk-ideene fra `moonshots` har også kroker nå: kostnadsbank (S3, `cost_observations`), tilstandskurve per bygningsdel (S5, alt finnes), utstyr med kalibrering (B3, `instruments`), bevisbilder (B4, `photos.capture_attestation`), skyggemodus (B6, `reports.training`), og romskisse og LiDAR (B9 og K7, `rooms.geometry` og `floor_areas.method = lidar`).

---

## Mål for den ferdige løsningen (retningsgivende)

Fra «Målgang» i `LES-MEG.md` (25.10.2026, oppdatert 27.10.2026). Målene er retningsgivende, ikke absolutte. **Hovedmålet fra 28.10.2026 (øverst i planen) er overordnet.** Ettårs-oppfølging, samspill med Optiplan og samme-dag-rapport er **ikke** mål (27.10.2026).

**Overgang fra IVIT:** EzProp er i mål når Byggcon kan gå over fra IVIT uten å miste noe takstmennene, kontoret eller meglerne trenger, og tilstandsrapportene lages raskere og like trygt som i dag.

| Nr | Mål | Fase |
|---|---|---|
| 1 | Rapporttypene Byggcon trenger kan lages, som systemmal eller i malbyggeren | 2a–2b (tilstand) og 5 (egne) |
| 2 | Forskriften og NS 3600:2025 for TG følges, og fagrådet (Ståle alene fram til produksjon) har godkjent mal, tekster og regler | Fagråd runde 1, 2a og 4 |
| 3 | Forskriftskrav gir sperre som bare kan overstyres med vilje. Alt annet gir advarsel med logg. | 2a |
| 4 | En hel befaring kan gjøres på iPad uten nett, uten tap | 1 og 2b |
| 5 | Tiden fra befaring til levert rapport er minst like kort som i IVIT. Samme dag er ikke et mål. | Målt i IVIT nå av Ståle (P4), sammenlignet i 3 |
| 6 | Sidemannskontrollen gjøres i EzProp, med logg (advarsel, ikke sperre) | 3 |
| 7 | Bestilling inn og rapport ut til megler fungerer | 2a (manuell ordre og «Send»-knapp), 3 (rutiner og bestillingsskjema), senere API |
| 8 | Fakturagrunnlag går til eAccounting for alle tre selskapene | eAccounting-prøve nå, 3 |
| 9 | De seks automatiske rutinene virker | 3 |
| 10 | Gamle rapporter og bilder fra IVIT kan søkes fram | Senere |
| 11 | Personvern, sikkerhetskopi, tofaktor og oppbevaring i minst 10 år | 0b, «Minimum før ekte data» og 4 |
| 12 | Alle ansatte har fått opplæring og bruker EzProp for nye oppdrag | 4 |

## Hva vi måler i piloten

Claudes forslag, bygd på P44. Samme oppdrag måles i EzProp og IVIT der det er mulig. Tallene fra IVIT samles inn allerede nå av Ståle (innspill P4, beslutning 27.10.2026). Flere takstmenn måles når de velges før piloten.

| Hva | Hvordan | Mål |
|---|---|---|
| Tid per befaring | Fra «befaring startet» til «befaring avsluttet» (hendelser) | Som IVIT eller kortere (sammenlignet med målingen i IVIT) |
| Tid fra befaring til levert rapport | Fra befaringsdato til rapporten er sendt | Som IVIT eller kortere (mål 5) |
| **Samlet tid per rapport** (hovedmål) | Arbeidsøkter per fase (forberedelse, befaring, kontorarbeid, levering), per rapporttype | **50 % mindre** enn nullpunktet fra IVIT (måles fullt i EzProp 2.0) |
| **Reklamasjoner per 100 rapporter** (hovedmål) | Reklamasjoner og krav registrert i EzProp, mot nullpunktet for de siste 3 årene | **Halvparten** (måles over flere år) |
| Tap av data uten nett | Konfliktloggen, synkfeil og takstmannens melding | **Null tap** |
| Sperrer og advarsler | Antall per rapport, og hvor mange som ble overstyrt | Følges, ingen fast grense |
| Rettinger etter sidemannskontroll | Antall kommentarer per rapport og kategori | Synker over tid |
| TG-forslag | Andel forslag som godtas, endres eller avvises | Viser om reglene treffer |
| Rapporter rettet etter levering | Antall nye versjoner | Ikke flere enn i IVIT |
| Automatiske meldinger | Sendt, feilet, stoppet | Ingen feil som ikke oppdages |
| PDF-størrelse | Størrelse på sendte PDF-er | Under 8 MB |
| Takstmennenes vurdering | Kort spørreskjema etter 2 og 4 uker | De vil heller bruke EzProp |
| Omveier til IVIT | Ting som måtte gjøres i IVIT likevel. Listen startes i betaen (innspill P14). | Liste som tømmes før fase 4 |

## Forutsetninger og risiko

| Forutsetning eller risiko | Hva det betyr | Hva vi gjør |
|---|---|---|
| **PWA i Safari på iPad** | Safari kan slette lagrede data for nettsider som ikke er lagt på hjemskjermen, og laster ikke opp når appen er lukket. Ingen av IVIT, Spectora eller SmartTakst beviser at det virker. | Fase 1 tester dette før noe annet bygges. Appen **må** ligge på hjemskjermen. |
| **Valg av synkverktøy** | PowerSync, ElectricSQL og andre er relativt nye verktøy og kan påvirke database og innlogging | Prøves i fase 1, valget skrives som ADR. Innlogging og organisasjon (fase 0b) kommer etter prøven. |
| **Ekte kundedata i betaen** | Betaen bruker ekte adresser, selgere, bilder og egenerklæringer lenge før fase 4 | «Minimum før ekte data» før fase 2 (innspill P1) |
| **Mistet iPad** | iPaden har personopplysninger og bilder lagret lokalt | Kode eller Face ID, og sperring av enheten (innspill P6 og D10) |
| **eAccounting-API-et** | Ikke testet: kunder uten dubletter, fakturautkast, status, kreditnota, tre klienter med hver sin nøkkel | Fire kall prøves i sandboxen ved siden av fase 0–1 (innspill P7). Nøkler bare i nøkkelboksen (fase 0b). |
| **PDF-størrelse i e-post** | 50 bilder kan gi en PDF på 15–25 MB, og mange meglerkontorer avviser vedlegg over 10 MB | Mål under 8 MB, lenke eller to e-poster ellers. Testes i fase 2a (innspill P8). |
| **Lagringsplass til bilder** | Ca. 100 000 bilder i året, 300–400 GB originaler per år og 3–4 TB etter 10 år | Fillagring i EU/EØS bak eget lag (mulig lokalt arkiv), komprimering på iPaden, og oppbevaringstider som innstillinger (besluttet 27.10.2026) |
| **Fagrådets godkjenning** | Betaen trenger godkjente avvikstekster, terskler, regler og kontrollpunkter for leilighet. Avvikstekstene er fortsatt under kalibrering (10 prøveeksempler). | Egen oppgave «Fagråd – runde 1» ved siden av fase 0–1 (innspill P3), og godkjenning i skjermbildet i fase 2a (innspill P2). Fagrådet er Ståle alene fram til produksjon (27.10.2026). |
| **Bruk av NS 3600 i programvare** | Levetider som tall regnes som fakta, men standardtekst skal ikke kopieres | Bare egne formuleringer og tallverdier. Kilde i bakgrunnen. |
| **Felles innlogging med Optiplan** | Må virke uten å svekke sikkerheten i Optiplan | ADR i fase 0b |
| **Meglersystemer** | Bestilling kommer for hånd i starten, og meglerne må godta PDF som vedlegg | Manuell ordre er rask å legge inn. Bestillingsskjema i fase 3. API senere. |
| **Frasene** | Fraseregisteret er bygd for IVIT, gir TG2 der beslutningen nå er TGIU, og har ulike tall (1057 og 1333) | Rettes i frasearbeidet før import i fase 4 |
| **Kapasitet hos Ståle** | Hver leveranse må godkjennes av Ståle, som også driver firmaet. Fra 27.10.2026 er Ståle også fagrådet, eneste betabruker og den som måler tid i IVIT, så risikoen er større. | Små leveranser, tydelige demoer, samling av spørsmål, og «Ståle avgjør innen demoen» i hver fase (innspill P15). Flere takstmenn velges før piloten. |
| **IVIT-data** | IVITs lisens gir iVerdi rett til dataene, og uttrekk er ikke avtalt | Ingen frist (beslutning 25.10). Spørsmålet tas før IVIT sies opp. |

---

## Sporbarhet: funn fra researchen og innspillene → plan

Tabellen viser hvor hvert funn med **høy eller middels prioritet** i researchen er plassert i planen, og hvorfor. Er noe ikke tatt med, står grunnen. «Senere» betyr at det er med i listen over senere arbeid, og at datamodellen tåler det. «Krok i datamodellen» betyr at det bare er en tabell eller et felt nå (`datamodell.md` avsnitt 4.13).

**Oppdatert 25.10.2026 etter innspill:** Funnene fra researchen som stod i fase 0 og fase 2, er fordelt på de nye fasene 0a, 0b, 2a og 2b. Noen funn er flyttet fordi et innspill er tatt inn (for eksempel kalender til fase 3, meglerprofil til fase 4 og nettrapport til fase 4b). Da står innspillet i begrunnelsen. Nye funn fra innspillene står i egne tabeller til slutt.

**Kort om fordelingen:**

| Fase | Funn fra researchen (200) | Nye funn fra innspillene | Til sammen |
|---|---|---|---|
| Hele planen | 0 | 2 | 2 |
| Ved siden av fase 0–1 | 0 | 3 | 3 |
| Fase 0a | 1 | 1 | 2 |
| Fase 1 | 8 | 0 | 8 |
| Fase 0b | 4 | 2 | 6 |
| Før fase 2 | 0 | 1 | 1 |
| Fase 2a | 60 | 5 | 65 |
| Fase 2b | 2 | 3 | 5 |
| Fase 3 | 49 | 7 | 56 |
| Fase 4 | 6 | 3 | 9 |
| Fase 4b | 9 | 1 | 10 |
| Fase 5 | 3 | 1 | 4 |
| Senere | 45 | 8 | 53 |
| Krok i datamodellen | 0 | 11 | 11 |
| Ikke tatt med | 13 | 3 | 16 |
| **Sum** | **200** | **51** | **251** |

*Endret 27.10.2026:* O1 og O3 (Optiplan) og S4 (ettårs-oppfølging) er flyttet til «Ikke tatt med». Automatiske merker og megleranalyse er flyttet fra «Senere» til fase 4 (fullt CRM).

*Før innspillene (første utkast 25.10.2026):* fase 0: 6, fase 1: 8, fase 2: 61, fase 3: 45, fase 4: 2, fase 5: 3, senere: 62, ikke tatt med: 13.

Mange funn havner fortsatt i «Senere». Det følger av beslutningen 25.10.2026 om at betaen holdes smal, at EzProp er for intern bruk først, og at KI kommer i fast rekkefølge etter at grunnmuren står.

### Spectora: hjelpesenteret (`spectora-analyse.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Kommentartyper: informasjon, begrensning, avvik | spectora-analyse.md | Fase 2a | Blir beskrivelse, TGIU og avvik på kontrollpunktet |
| Egne vurderingsskalaer med farge og oversikt | spectora-analyse.md | Fase 2a | TG0–TG3 og TGIU, alltid med tekst, og TG-oversikt i PDF |
| Svartyper (avkrysning, flervalg, tall, intervall, dato, signatur) | spectora-analyse.md | Fase 2a | Felttypene i malmotoren |
| Valgfrie seksjoner, utvidet med hvis–så-regler | spectora-analyse.md | Fase 2a | Regler som data, styrt av romtype, materiale og alder |
| Kostnadsanslag per avvik | spectora-analyse.md | Fase 2a | Påkrevd ved TG3, intervall eller eget beløp (advarsel hvis ikke rundet av, 27.10.2026) |
| Krav om fullført før publisering | spectora-analyse.md | Fase 2a | De sju sperrene fra forskriften |
| Offline-app med synk | spectora-analyse.md | Fase 1 | Prøves først, bygges i fase 2 |
| Bildeannotering med farge etter alvorlighet | spectora-analyse.md | Fase 2a | Markering som eget lag, farge etter TG |
| Lagre tekst fra rapporten til frasebanken, mest brukt | spectora-analyse.md | Fase 2a | Fraser åpne for alle (24.10), uten godkjenning nå |
| Godkjenningskø | spectora-analyse.md | Fase 3 | Blir sidemannskontroll med logg |
| Visningslogg | spectora-analyse.md | Fase 4b | Hører sammen med nettrapporten og gyldighetssiden (H9, forslag) |
| Kundeportal for selger og megler | spectora-analyse.md | Fase 4b | Selgerportal og meglerstatus (H9, forslag). Rapporten sendes som PDF fram til da. |
| Automatiske meldinger med regler | spectora-analyse.md | Fase 3 | Hendelser og handlinger, kjernefunksjon (23.10) |
| Endringslogg, også for rapportteksten | spectora-analyse.md | Fase 0b | Revisjonsloggen er grunnmur |
| API og webhooks | spectora-analyse.md | Senere | Tilkoblingslaget lages i fase 0. Meglersystem senere (25.10). |
| Flere takstfolk i samme rapport | spectora-analyse.md | Fase 1 | Prøves i fase 1, brukes i piloten (nivå «bør») |
| Stedsmerker, flagg og huskelapper | spectora-analyse.md | Fase 3 | Tidsbesparelse, ikke nødvendig for betaen |
| Etterkontroll (reinspeksjon) | spectora-analyse.md | Senere | Skjermen senere. Datamodellen har nå befaringstypen «etterkontroll» (innspill D2). |
| Oppgaver | spectora-analyse.md | Fase 3 | Sammen med hendelser og handlinger |
| Statistikk (omsetning per megler og takstmann, andel TG3) | spectora-analyse.md | Senere | Piloten måler det den trenger. Full statistikk senere. |
| Bildesenter på PC | spectora-analyse.md | Fase 3 | Raskere ferdigstilling på kontoret |
| Video og 360-bilder | spectora-analyse.md | Senere | Lav til middels nytte, mye lagring |
| Rapporten bygges før befaringen (forhåndsutfylling) | spectora-analyse.md | Fase 3 | Som «kopier data fra tidligere rapport» |
| Signaturfelt i rapporten | spectora-analyse.md | Fase 2a | Ansvarlig takstmanns signatur i PDF |
| Dashbord og dataeksport | spectora-analyse.md | Fase 3 | Arbeidskø i fase 2, eksport til Excel i fase 3 |
| Booking-side for kunde og megler | spectora-analyse.md | Fase 3 | Bestillingsskjema for meglere (funksjonskart H8, tatt inn). Booking for privatkunder senere. |
| Prisberegning etter areal, byggeår og sted | spectora-analyse.md | Senere | Fakturagrunnlaget lages for hånd (24.10) |
| Reparasjonsliste for kjøper | spectora-analyse.md | Ikke tatt med | Kan svekke uavhengigheten (forskriften § 1-3) |
| Rapporten låst til betaling | spectora-analyse.md | Ikke tatt med | Ingen betaling i EzProp (24.10) |
| Mersalg av forsikring, garanti og håndverkertilbud | spectora-analyse.md | Ikke tatt med | Uavhengighet |
| KI-tekstforslag (AI Comment Assist) | spectora-analyse.md | Senere | KI trinn 3. KI foreslår aldri TG (24.10). |
| Match: tale og bilde til riktig kommentar | spectora-analyse.md | Senere | KI trinn 2–3 |
| MCP-kobling for KI-assistent | spectora-analyse.md | Senere | Etter API |

### Spectora: test i prøvekonto (`spectora-test.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Én innstillingsside med søk og autolagring | spectora-test.md | Fase 3 | Med bekreftelse og angre (lærdom fra IVIT) |
| Daglig timeplan-e-post til hver takstmann | spectora-test.md | Senere | Middels nytte. Arbeidskøen dekker det i starten. |
| Egendefinerte bestillingsfelt (gnr/bnr, seksjon, borettslag, egenerklæring) | spectora-test.md | Fase 2a | Felt på den manuelle ordren |
| Automatisk henting av eiendomsdata | spectora-test.md | Senere | Manuell registrering først (25.10) |
| Norsk språk, NOK og 25 % MVA | spectora-test.md | Fase 0a | Grunnoppsett |
| Prismotor | spectora-test.md | Senere | Ikke i beslutningene |
| MVA per linje til eAccounting | spectora-test.md | Fase 3 | Fakturagrunnlaget |
| Rettighetsmatrise | spectora-test.md | Fase 0b | Tilgangsmodulen |
| Serviceområder per takstmann | spectora-test.md | Senere | Trengs ikke for å erstatte IVIT |
| Rabattkoder for meglerkampanjer | spectora-test.md | Ikke tatt med | Lav prioritet, ingen betaling i systemet |
| Malen etter forskriftens bygningsdeler og rom | spectora-test.md | Fase 2a | Systemmalen |
| Standardtekst om kontrollnivå per seksjon | spectora-test.md | Fase 2a | Feltet `standard_text` på seksjonen |
| Digital oppdragsavtale med e-signering | spectora-test.md | Senere | Ikke i beslutningene. BankID senere. |
| Kostnadsoversikt for kjøper og megler | spectora-test.md | Senere | Uavhengigheten må vurderes først |
| Lett CRM for meglere og meglerforetak | spectora-test.md | Fase 4 | Adressebok/meglerprofil med tall (H4), og fullt CRM rett etter (27.10.2026). Kontakter med notater kommer i fase 2a. |
| Liste over ufakturerte og ubetalte oppdrag | spectora-test.md | Fase 3 | Sammen med eAccounting |
| Kjørebok-eksport | spectora-test.md | Senere | Middels nytte |
| CSV- og Excel-eksport | spectora-test.md | Fase 3 | Arkivet |
| Online booking og prisvidget | spectora-test.md | Senere | Manuell ordre først |
| KI som foreslår alvorlighet (TG) | spectora-test.md | Ikke tatt med | KI setter eller foreslår aldri TG (24.10) |

### Spectora: detaljer (`spectora-detaljer.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Status for rapportlåsen (sjekkliste før kunden får rapporten) | spectora-detaljer.md | Fase 2a | Blir listen over sperrer og advarsler. Betalingsdelen tas ikke med. |
| Logg over hvem som har sett rapporten | spectora-detaljer.md | Fase 4b | Krever nettrapport (H9, forslag) |
| Angre sletting og papirkurv | spectora-detaljer.md | Fase 2a | Myk sletting fra fase 0, papirkurven i skjermbildene i fase 2 |
| Kopiere oppdrag eller rapport | spectora-detaljer.md | Fase 3 | Med liste over hva som ikke passer i ny malversjon |
| Dialogen forklarer hva som skjer automatisk | spectora-detaljer.md | Fase 3 | Sammen med rutinene |
| Eiendomsdata kan overstyres, og det vises | spectora-detaljer.md | Senere | Når data hentes fra leverandør. Feltet finnes i datamodellen. |
| Merker på rapportkortet (status, dato, mal, takstmann) | spectora-detaljer.md | Fase 2a | Oppdragslisten |
| Søk i fraser og kommentarer (Ctrl+K) | spectora-detaljer.md | Fase 2a | Frasesøk med «/» |
| Alt for ett avvik på samme kort | spectora-detaljer.md | Fase 2a | Avvikskortet |
| Ikoner per punkt: dupliser, flytt, slett, flagg | spectora-detaljer.md | Fase 3 | Tidsbesparelse etter betaen |
| Automatisk tekst ved TGIU, teller som ferdig | spectora-detaljer.md | Fase 2a | TGIU-opplysningene |
| Endringer i mal gjelder bare nye rapporter | spectora-detaljer.md | Fase 2a | Rapporten låst til malversjon |
| Dele og klone mal | spectora-detaljer.md | Fase 5 | Malbyggeren. Deling mellom selskaper trengs ikke, alt er én organisasjon. |
| PDF-valg (innholdsfortegnelse, avvik først, ingen tomme sider) | spectora-detaljer.md | Fase 2a | Grunn-PDF i fase 2, flere valg i profilen i fase 3 |
| Sammendrags-PDF med antall per TG | spectora-detaljer.md | Fase 2a | Sammendrag med TG-oversikt i PDF |
| Nettrapport for kunden (meny, filter, mobil) | spectora-detaljer.md | Fase 4b | Kundesiden (H9, forslag). Rapporten sendes som PDF fram til da. |
| Ferdig lagret PDF som kan lages på nytt etter retting | spectora-detaljer.md | Fase 2a | Utgivelser med versjon |
| Globalt søk, også på kundenavn | spectora-detaljer.md | Fase 3 | Søk og arkiv |
| Bytte rolle eller selskap uten å logge ut | spectora-detaljer.md | Ikke tatt med | Én ansettelse per person (23.10), alle i samme organisasjon |
| Tofaktor med sperre etter gjentatte feil | spectora-detaljer.md | Fase 4 | Tofaktor i fase 4 (mål 11). Sperre etter gjentatte feil flyttet til fase 0b (innspill P12). |
| Det som er signert, fryses | spectora-detaljer.md | Fase 2a | Utgivelser er låst |
| Varselinnstillinger per kategori og kanal | spectora-detaljer.md | Fase 3 | Varsler som arbeidsliste |
| Hurtigfilter i oppdragslisten | spectora-detaljer.md | Fase 2a | Arbeidskøen |
| Kart med kjørerute | spectora-detaljer.md | Senere | Middels nytte |
| Synk ca. 3 sekunder etter endring, nye forsøk, varsel | spectora-detaljer.md | Fase 1 | Prøves i fase 1 |
| Endringer per del, så to kan jobbe samtidig | spectora-detaljer.md | Fase 1 | Versjon per felt |
| Trygg oppstart uten nett når innloggingen har gått ut | spectora-detaljer.md | Fase 1 | Prøve F |
| Serie-kamera og tegneverktøy etter avviksbilde | spectora-detaljer.md | Fase 2b | Bilder på befaringen |
| HEIC-bilder konverteres | spectora-detaljer.md | Fase 1 | Prøve D |
| Søk som tåler skrivefeil, mest brukte først | spectora-detaljer.md | Fase 2a | Frasesøk |
| Lys eller mørk visning og tekststørrelser | spectora-detaljer.md | Fase 3 | Mørk visning er et valg (24.10) |
| Bekreftelse før et bilde slettes | spectora-detaljer.md | Fase 2a | Bilder |
| Feilsøking: send feilsøkingsinfo | spectora-detaljer.md | Fase 3 | Pilot |

### Spectora: malsystemet (`spectora-maler-og-forslag-malsystem.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Regneark inn og ut med faste ID-er | spectora-maler-og-forslag-malsystem.md | Fase 2a | Slik redigerer fagansvarlig systemmalen i betaen (P19) |
| Enheter og standardverdier per felt | spectora-maler-og-forslag-malsystem.md | Fase 2a | Felt i malmotoren |
| Standardbilder (forklarende skisser) | spectora-maler-og-forslag-malsystem.md | Senere | Middels nytte, ikke nødvendig for å erstatte IVIT |
| «Mest brukt» | spectora-maler-og-forslag-malsystem.md | Fase 2a | Bruksteller på fraser |
| «Prøv malen» | spectora-maler-og-forslag-malsystem.md | Fase 2a | Testskjema og kjørbare testtilfeller |
| Papirkurv og angre | spectora-maler-og-forslag-malsystem.md | Fase 2a | Myk sletting |
| Flytte og kopiere mellom maler | spectora-maler-og-forslag-malsystem.md | Fase 5 | Malbyggeren |
| KI til å redigere maler | spectora-maler-og-forslag-malsystem.md | Senere | KI etter trinn 3 |
| Tre kolonner med alt redigert på ett sted | spectora-maler-og-forslag-malsystem.md | Fase 5 | Malbyggeren |
| Låste punkter for fagansvarlig | spectora-maler-og-forslag-malsystem.md | Fase 2a | Systemmalen kan bare endres med maltilgang (25.10) |
| Automatisk kontroll av malen | spectora-maler-og-forslag-malsystem.md | Fase 2a | Før en malversjon publiseres |
| Send til godkjenning med forskjellsvisning | spectora-maler-og-forslag-malsystem.md | Senere | Ingen godkjenningsflyt nå (24.10). Kan slås på. |
| Overlegg per selskap og avtale | spectora-maler-og-forslag-malsystem.md | Senere | Første versjon: profil og premissetekst per avtale (25.10) |
| Import fra andre program (fra IVIT) | spectora-maler-og-forslag-malsystem.md | Fase 4 | Frasene. Rapporter fra IVIT senere. |
| «Info Item»: punkt som bare beskriver | spectora-maler-og-forslag-malsystem.md | Fase 2a | Kontrollpunkt med «gir TG = nei» |
| Påminnelser per seksjon og punkt i appen | spectora-maler-og-forslag-malsystem.md | Fase 2a | Hjelpetekster |
| Valgfrie seksjoner og punkter | spectora-maler-og-forslag-malsystem.md | Fase 2a | Styrt av rom og regler |
| Standardsted med hurtigknapper | spectora-maler-og-forslag-malsystem.md | Fase 3 | Stedsmerker |

### Spectora: automatisering, Advanced, kø og oppgaver (`spectora-advanced-automatisering.md`, `spectora-advanced-test.md`, `spectora-ko-oppgaver-sms.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Når → bare hvis → gjør | spectora-advanced-automatisering.md | Fase 3 | Kjernefunksjon (23.10) |
| Norske hendelser | spectora-advanced-automatisering.md | Fase 2a | Hendelsene lagres fra betaen, rutinene kommer i fase 3 |
| Mottakere etter rolle | spectora-advanced-automatisering.md | Fase 3 | Part på oppdrag med rolle og hva den mottar |
| Ekte vedlegg (rapport-PDF) | spectora-advanced-automatisering.md | Fase 3 | Beslutning 24.10 |
| Kø per oppdrag med status | spectora-ko-oppgaver-sms.md | Fase 3 | Kø og logg |
| Forhåndsvisning av meldinger som vil gå | spectora-ko-oppgaver-sms.md | Fase 3 | Kø og logg |
| «Send på nytt» med oppdaterte data | spectora-ko-oppgaver-sms.md | Fase 3 | Kø og logg |
| Ny befaringsdato flytter meldingene | spectora-ko-oppgaver-sms.md | Fase 3 | Kø og logg |
| Betingelsesgrupper («alle» eller «minst én») | spectora-advanced-test.md | Fase 3 | Bedre enn Spectora |
| Regler også på oppdrag som fantes fra før | spectora-advanced-test.md | Fase 3 | Bedre enn Spectora |
| Innstillinger per melding (én gang, tidsvindu, ikke helg) | spectora-advanced-automatisering.md | Fase 3 | Rutinene |
| Ferdige norske oppskrifter | spectora-advanced-test.md | Fase 3 | De seks rutinene (24.10) |
| Varsel når en melding feiler | spectora-advanced-automatisering.md | Fase 3 | Feil skal alltid vises |
| Oppgaver fra regler | spectora-ko-oppgaver-sms.md | Fase 3 | Handlingen «opprett oppgave» |
| Oppgaver koblet til oppdrag og megler, med kommentarer og status | spectora-ko-oppgaver-sms.md | Fase 3 | Oppgaver |
| Handlingen «sett merke» | spectora-advanced-test.md | Fase 3 | Merker settes for hånd og av regler |
| Faktura-hendelser (sendt, betalt, forfalt) | spectora-advanced-test.md | Fase 3 | eAccounting |
| Hendelsen «rapporten nærmer seg 12 måneder» | spectora-advanced-test.md | Fase 3 | Gyldighet (forskriften § 1-6) |
| Signert webhook med nøkkel, nye forsøk og logg | spectora-advanced-test.md | Senere | Sammen med API mot meglersystemer |
| Levering til meglersystem via API | spectora-advanced-automatisering.md | Senere | Manuell først (25.10) |
| Daglig oppsummering av oppgaver | spectora-ko-oppgaver-sms.md | Fase 3 | Oppgaver på mobil og daglig oppsummering (funksjonskart H12, tatt inn) |
| Automatiske merker (for eksempel «aktiv selgermegler») | spectora-advanced-test.md | Fase 4 | Fullt CRM, flyttet fram 27.10.2026 |
| Megleranalyse og egne eksporter | spectora-advanced-test.md | Fase 4 | Fullt CRM, flyttet fram 27.10.2026 |
| Nøkkeltall og dashbord | spectora-advanced-test.md | Fase 3 | Enkelt lederdashbord (funksjonskart H3, tatt inn). Fullt dashbord senere. |
| KI-hjelp til e-posttekst på norsk | spectora-advanced-test.md | Senere | KI, etter trinn 3 |
| Spamsjekk | spectora-advanced-test.md | Senere | Sammen med KI-hjelp til e-post |
| API og MCP for KI-verktøy | spectora-advanced-test.md | Senere | Etter API mot meglersystemer |
| SMS via norsk leverandør, med samtykke | spectora-ko-oppgaver-sms.md | Senere | E-post holder (24.10) |
| Toveis SMS-innboks | spectora-ko-oppgaver-sms.md | Senere | Lav prioritet |
| Transaksjon og markedsføring skilles, med samtykke | spectora-advanced-automatisering.md | Senere | Bare vanlige meldinger nå, ingen markedsføring |
| Hendelsen «megler eller selger har åpnet rapporten» | spectora-advanced-test.md | Fase 4b | Krever nettrapport (H9, forslag) |
| Kontorbrukere uten kostnad, tydelig beskjed når en bruker er inaktiv | spectora-ko-oppgaver-sms.md | Fase 0b | Ingen lisens per bruker. «Deaktivert» vises tydelig. |
| Webhook ut til andre system | spectora-advanced-automatisering.md | Senere | Tilkoblingslaget tåler det |

### CRM, kundeportal og nettrapport

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Meglerprofil med historikk, notater, logg og oppgaver | spectora-advanced-test.md | Fase 4 | Meglerprofil med tall (H4), og fullt CRM rett etter (27.10.2026), bygd på kontakter (2a), oppgaver og hendelser (3) |
| Kundeportal for selger og megler | spectora-analyse.md | Fase 4b | Selgerportal og meglerstatus (H9, forslag). Rapporten sendes som PDF fram til da. |
| Nettrapport med visningslogg | spectora-analyse.md | Fase 4b | Én funksjon sammen med gyldighetssiden (P27, H9) |

### KI (`ki-funksjoner.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| 1. Logg og merking av KI-bruk | ki-funksjoner.md | Senere | KI trinn 1, bygges før noen KI-funksjon slås på. Tabellen finnes i datamodellen. |
| 2. Tale til tekst på befaring | ki-funksjoner.md | Senere | KI trinn 2, kjøpt tjeneste (25.10) |
| 3. Diktat blir strukturert funn | ki-funksjoner.md | Senere | KI trinn 3, TG-feltet står tomt |
| 4. Forslag fra frasebanken | ki-funksjoner.md | Fase 2a | Enkel variant uten KI (tekstsøk, mest brukt) i fase 2. Søk på betydning i KI trinn 3. |
| 5. Språkvask | ki-funksjoner.md | Senere | KI trinn 2 |
| 6. Sjekk av om rapporten er komplett | ki-funksjoner.md | Fase 2a | Faste regler uten KI, sperrer og advarsler, virker uten nett |
| 7. KI-sjekk før sidemannskontroll | ki-funksjoner.md | Senere | KI trinn 3. Stopper aldri publisering (24.10). |
| 8. Oppsummering i klarspråk | ki-funksjoner.md | Senere | KI trinn 2 |
| 9. Bilde gir utkast til observasjon | ki-funksjoner.md | Senere | KI trinn 3, aldri TG |
| 10. Sortering og tekst på bilder | ki-funksjoner.md | Fase 2b | Enkel variant: bildet knyttes til punktet der det tas (iPad). KI-forslag i trinn 3. |
| 11. Sjekk av bildekvalitet | ki-funksjoner.md | Senere | KI trinn 1 (uten KI, virker uten nett) |
| 12. Forhåndsutfylling fra tidligere rapport og tegninger | ki-funksjoner.md | Fase 3 | Kopier fra tidligere rapport i fase 3. Tegninger med KI senere. |
| 13. Henvendelse blir handling | ki-funksjoner.md | Senere | Etter trinn 3, bygger på hendelser og handlinger |
| 14. Tiltaksliste og kalkyle (skadetakst) | ki-funksjoner.md | Senere | Krever mal for skadetakst og Byggcons prisbank |
| 15. Læring fra sidemannskontroll | ki-funksjoner.md | Senere | Krever data fra sidemannskontrollen (fase 3) |
| Ikke: KI som setter eller foreslår TG | ki-funksjoner.md | Ikke tatt med | Beslutning 24.10. TG-forslag fra alder og målinger er faste regler, ikke KI. |
| Ikke: automatisk publisering eller sending fra KI | ki-funksjoner.md | Ikke tatt med | Beslutning 24.10 |
| Ikke: frie kostnadsestimater fra KI | ki-funksjoner.md | Ikke tatt med | Bare prisbank, og bare i skadetakst |
| Ikke: egen modell for bildegjenkjenning eller «tilstandsscore» | ki-funksjoner.md | Ikke tatt med | Gir falsk presisjon |
| Ikke: kundedata og bilder til KI uten avtaler | ki-funksjoner.md | Ikke tatt med | Krav: databehandleravtale, EU/EØS, ingen trening (24.10) |

### SmartTakst (`smarttakst-analyse.md` del 7)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Fraser knyttet til kontrollpunkt og TG, med flervalg og egne fraser | smarttakst-analyse.md | Fase 2a | Fraser |
| Én versjon av malen per rapport, og liste over endringer ved kopiering | smarttakst-analyse.md | Fase 2a | Låst malversjon i fase 2, kopiering i fase 3 |
| «Vis hvis»-regler med faste koder, testet automatisk | smarttakst-analyse.md | Fase 2a | Regelmotoren |
| Materialvalg styrer punktene, TG foreslås fra materiale og alder | smarttakst-analyse.md | Fase 2a | Den viktigste forbedringen |
| Lagring uten nett per felt | smarttakst-analyse.md | Fase 1 | Prøves i fase 1 |
| Årsak, konsekvens, tiltak og kostnad på samme avvikskort | smarttakst-analyse.md | Fase 2a | Avvikskortet |
| KI som forbedrer språk, med angre | smarttakst-analyse.md | Senere | KI trinn 2 |
| Sjekkliste før levering og sidemannskontroll | smarttakst-analyse.md | Fase 2a | Sperrer og advarsler i fase 2, sidemannskontroll i fase 3 |
| Målefelt med tall og enhet | smarttakst-analyse.md | Fase 2a | Felt i malmotoren |
| Romtyper som henter riktige punkter | smarttakst-analyse.md | Fase 2a | Romtyper med gruppe |
| Areal per etasje med BRA-i, BRA-e, BRA-b og ALH | smarttakst-analyse.md | Fase 2a | Areal per etasje |
| Markering i bilder og forsidebilde | smarttakst-analyse.md | Fase 2a | Bilder |
| Privat notat per rapport | smarttakst-analyse.md | Fase 3 | Lite, men ikke nødvendig i betaen |
| Offentlig gyldighetsside med QR-kode | smarttakst-analyse.md | Fase 4b | Sammen med nettrapporten (H9, forslag) |
| Oppslag av matrikkel og hjemmelshavere | smarttakst-analyse.md | Senere | Eiendomsverdi eller PropCloud |
| Status som megler ser, og kundelenke | smarttakst-analyse.md | Fase 4b | Meglerstatus og selgerportal (H9, forslag) |
| Verktøy for plantegning | smarttakst-analyse.md | Senere | Lav prioritet |
| Katalog der meglere finner takstmenn | smarttakst-analyse.md | Ikke tatt med | Markedsplass og salg, ikke intern bruk (25.10) |
| Mester- og NITO-logo i PDF-en | smarttakst-analyse.md | Ikke tatt med | Lav prioritet. Kan legges i rapportprofilen hvis Byggcon ønsker det. |

### IVIT (`ivit-detaljer.md`, «Detaljer EzProp bør ha»)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| «i»-knapp per kontrollpunkt med kravet fra forskriften | ivit-detaljer.md | Fase 2a | Med egne ord |
| Frasebibliotek: felles, mine, favoritter, søk og rekkefølge | ivit-detaljer.md | Fase 2a | Fraser |
| Deling av fraser og oppdrag mellom selskapene | ivit-detaljer.md | Fase 2a | Alt er i én organisasjon og deles fra start |
| Lagrestatus med klokkeslett | ivit-detaljer.md | Fase 1 | Synkstatus |
| Globalt søk med oppdragsnummer, adresse og matrikkel | ivit-detaljer.md | Fase 3 | Søk og arkiv |
| Arkiv med sortering, hurtigperioder og lagrede filtre | ivit-detaljer.md | Fase 3 | Søk og arkiv |
| Signatur og profilbilde i rapporten | ivit-detaljer.md | Fase 2a | PDF |
| Firmabeskrivelse på rapportens side 2 | ivit-detaljer.md | Fase 2a | Firmatekst per selskap |
| Kalender koblet til Microsoft 365 | ivit-detaljer.md | Fase 3 | Kalender med kobling til Outlook begge veier (funksjonskart H1, tatt inn) |
| Faner etter fase med antall | ivit-detaljer.md | Fase 2a | Arbeidskøen |
| Radmeny: kopier oppdrag, siste PDF, bytt takstmann, kopier data fra | ivit-detaljer.md | Fase 3 | Pilot |
| Tilgangsbegrensning per bruker | ivit-detaljer.md | Fase 0b | Tilgangsmodulen |
| Ordrebekreftelse og forutsetninger som firmainnstilling | ivit-detaljer.md | Fase 2a | Forutsetninger i rapportprofilen. Ordrebekreftelsen blir en del av velkomst-e-posten i fase 3. |
| Format på oppdragsnummer | ivit-detaljer.md | Fase 2a | Bestemt: `2026-00123` fra nummerserie på serveren (innspill D9, tatt inn) |
| Kalender med alle takstmenn | ivit-detaljer.md | Fase 3 | Kalender og kapasitet per takstmann og kontor (H1, tatt inn) |
| Ansattfilter med avatarer over listen | ivit-detaljer.md | Fase 3 | Pilot med flere takstmenn |
| Kort notat per oppdragsrad | ivit-detaljer.md | Fase 2a | Arbeidskøen |
| HMS-merke på kontrollpunkt | ivit-detaljer.md | Fase 2a | Befaringen |
| Enkel tilbakemelding med skjermbilde | ivit-detaljer.md | Fase 3 | Som i Optiplan |
| Endringslogg i appen | ivit-detaljer.md | Fase 2a | Revisjonsloggen vises på oppdraget |
| Kunderegister med oppslag i Brønnøysund | ivit-detaljer.md | Fase 3 | Som i Optiplan. Matrikkeloppslag senere. |

### Innspill 25.10.2026 (vurdert og tatt inn)

Nye funn fra de fire innspillene. Funnene i datamodellen (D1–D18) står i endringsloggen i `datamodell.md`.

#### Innspill til planen (`innspill-datamodell-og-plan-2026-10-25.md`, P1–P15)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| P1 Minimum før ekte data | innspill-datamodell-og-plan-2026-10-25.md | Før fase 2 | Betaen bruker ekte kundedata lenge før personvernpakken i fase 4 |
| P2 Fase 2 deles i 2a «Rapporten på PC» og 2b «Befaringen på iPad» | innspill-datamodell-og-plan-2026-10-25.md | Fase 2a | Fagrådet og Ståle får se mal og PDF tidlig. Fagrådets godkjenning blir en del av 2a. |
| P3 Fagråd – runde 1 (medlemmer, takt, tre leveranser) | innspill-datamodell-og-plan-2026-10-25.md | Ved siden av fase 0–1 | Fagrådet var en risiko uten oppgave. Leveranse 3 trengs for leiligheter. |
| P4 Måling i IVIT nå (to takstmenn, 10 oppdrag hver) | innspill-datamodell-og-plan-2026-10-25.md | Ved siden av fase 0–1 | Gir et ekte sammenligningsgrunnlag for pilotmålene. Bare Ståle måler foreløpig (27.10.2026). |
| P5 ADR for PDF-motor med testutskrift av 50 bilder | innspill-datamodell-og-plan-2026-10-25.md | Fase 2a | PDF er leveransen. Valget må tas før PDF bygges. |
| P6 Oppsett og sperring av iPadene, eventuelt Intune | innspill-datamodell-og-plan-2026-10-25.md | Fase 2b | Personopplysninger og bilder ligger lokalt på iPaden. Intune vurderes senere (27.10.2026). |
| P7 eAccounting-prøve i sandbox | innspill-datamodell-og-plan-2026-10-25.md | Ved siden av fase 0–1 | Avgjør tidlig om «ingen dubletter» og status tilbake er mulig |
| P8 PDF under 8 MB, ellers lenke eller to e-poster | innspill-datamodell-og-plan-2026-10-25.md | Fase 2a | Mange meglerkontorer avviser store vedlegg. Testes før piloten. |
| P9 «Send»-knapp i betaen, automatisk sending i piloten per selskap | innspill-datamodell-og-plan-2026-10-25.md | Fase 2a | Feil i mottakere eller PDF er sannsynlige i starten. Automatikk slås på i fase 3. |
| P10 Rekkefølgen 0a → 1 → 0b → 2a → 2b | innspill-datamodell-og-plan-2026-10-25.md | Hele planen | Prøven uten nett kommer før innlogging og organisasjon |
| P11 Fire testoppdrag som grunndata | innspill-datamodell-og-plan-2026-10-25.md | Fase 2a | Brukes i «Prøv malen», regeltester og demoer |
| P12 Nøkkelboks for hemmeligheter og sperre etter mange feil ved innlogging | innspill-datamodell-og-plan-2026-10-25.md | Fase 0b | Samme oppsett som Optiplan. Tofaktor venter til fase 4. |
| P13 Én felles PDF-layout for egne maler | innspill-datamodell-og-plan-2026-10-25.md | Fase 5 | Pen PDF fra ukjente maler er det vanskelige. Systemmalene har egen layout. |
| P14 Listen «omveier til IVIT» startes i betaen | innspill-datamodell-og-plan-2026-10-25.md | Fase 2b | Den ærligste måleren mot hovedmålet |
| P15 Ståle avgjør innen demoen i hver fase | innspill-datamodell-og-plan-2026-10-25.md | Hele planen | Tiltaket mot risikoen «kapasitet hos Ståle» |

#### Hull i planen (`funksjonskart-ezprop-2026-10-25.md` avsnitt 4, H1–H12)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| H1 Kalender og kapasitet, med Outlook begge veier | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Det største hullet for kontoret |
| H2 Prisliste per avtale som data | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Fakturagrunnlag uten å slå opp priser. Tabellene ligger i datamodellen. |
| H3 Enkelt lederdashbord | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Leder ser volum, kapasitet og ufakturert uten å spørre |
| H4 Meglerprofil med tall | funksjonskart-ezprop-2026-10-25.md | Fase 4 | Meglerne er kundene |
| H5 Sertifisering med utløpsdato og varsel | funksjonskart-ezprop-2026-10-25.md | Fase 0b | Ingen publiserer med utgått sertifisering. Varselet vises i fase 3. |
| H6 Reklamasjonsmappe og intern avviksregistrering | funksjonskart-ezprop-2026-10-25.md | Fase 4 | Sammen med registrering av reklamasjoner (S1) |
| H7 Hjelp i appen koblet til kunnskapsbasen | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Byggcons egen hjelp, ikke en ekstern hjelpeside |
| H8 Bestillingsskjema for meglere | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Fjerner avskrift før API finnes |
| H9 Nettrapport, selgerportal, meglerstatus og gyldighetsside med QR | funksjonskart-ezprop-2026-10-25.md | Fase 4b | Egen fase, godkjent 27.10.2026 |
| H10 Verditakst som systemmal nr. 2 | funksjonskart-ezprop-2026-10-25.md | Senere | Alle maler skal inn etter hvert. Verdidel er ikke krav for produksjon (27.10.2026). |
| H11 Varsler som arbeidsliste | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Lærdom fra IVITs 5134 uleste varsler. Tabellen ligger i datamodellen. |
| H12 Oppgaver på mobil og daglig oppsummering | funksjonskart-ezprop-2026-10-25.md | Fase 3 | Sammen med oppgavene |

#### KI og Optiplan (`funksjonalitet-ki-og-fremtid-2026-10-25.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Evalueringssett (30–50 eksempler med fasit) per KI-funksjon | funksjonalitet-ki-og-fremtid-2026-10-25.md | Senere | Under KI trinn 1. Ingen KI-funksjon slås på uten. |
| Kostnadsmåling av KI per kall og per rapport | funksjonalitet-ki-og-fremtid-2026-10-25.md | Senere | Under KI trinn 1. Kroken `ai_usage_log.cost` er lagt inn nå. |
| K4 «Glemt noe?» (regler uten KI) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Fase 2b | Virker uten nett, færre turer tilbake |
| KI-prioriteringen etter produksjon (avsnitt 10) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Senere | Ført inn som liste under «Senere» |
| Krok: `peer_review_comments.author_type` (R7) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | KI-sidemann senere uten ombygging |
| Krok: `reference_photos` (F4) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | Kalibreringsbibliotek senere |
| Krok: `rooms.geometry` og `floor_areas.method = lidar` (K7) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | Plantegning og LiDAR senere |
| Krok: `price_lists` og `price_list_items` per avtale (A6) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | Skjermen kommer i fase 3 (H2) |
| Krok: `orders.source = email` (A1) | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | E-post blir ordreforslag senere |
| Krok: `ai_usage_log.cost` | funksjonalitet-ki-og-fremtid-2026-10-25.md | Krok i datamodellen | Kostnad per rapport kan måles fra første KI-kall |
| Krok: en fast kode (`key`) endres aldri, den arkiveres | funksjonalitet-ki-og-fremtid-2026-10-25.md | Fase 0a | Skrives i `CLAUDE.md` og datamodellen |
| O1 Oppslag i Optiplan på sameiets organisasjonsnummer | funksjonalitet-ki-og-fremtid-2026-10-25.md | Ikke tatt med | Ingen samspill med Optiplan foreløpig (Ståle 27.10.2026) |
| O3 Én kundebase med Optiplan | funksjonalitet-ki-og-fremtid-2026-10-25.md | Ikke tatt med | Ingen samspill med Optiplan foreløpig (Ståle 27.10.2026) |

#### Strekkmål og kroker (`moonshots-ezprop-2026-10-25.md`)

| Funn | Kilde (fil) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| S1 Reklamasjoner og utfall koblet til punktet | moonshots-ezprop-2026-10-25.md | Fase 4 | Registreres sammen med reklamasjonsmappen (H6). Kroken `claims` ligger i datamodellen. |
| S2 Robusthet før publisering | moonshots-ezprop-2026-10-25.md | Senere | Strekkmål 2. Krever data fra S1 i 2–3 år. |
| S3 Kostnadsbank som lærer | moonshots-ezprop-2026-10-25.md | Senere | Kroken `cost_observations` ligger i datamodellen |
| S4 Ettårs-sløyfen | moonshots-ezprop-2026-10-25.md | Ikke tatt med | Ståle: nei (27.10.2026). Kroken `followup_responses` er tatt ut av datamodellen. |
| S5 Tilstandskurve per bygningsdel | moonshots-ezprop-2026-10-25.md | Senere | Krever nok data. Alt som trengs, finnes i modellen. |
| S6 Neste takst sammenligner automatisk | moonshots-ezprop-2026-10-25.md | Senere | Strekkmål 1. Bygger på «kopier data fra» i fase 3. |
| Krok: `instruments` og `instrument_id` på målinger (B3) | moonshots-ezprop-2026-10-25.md | Krok i datamodellen | Utstyr med kalibrering senere |
| Krok: `photos.capture_attestation` og `photos.source` (B4, B2, B8) | moonshots-ezprop-2026-10-25.md | Krok i datamodellen | Bevisbilder og bilder fra selger senere |
| Krok: `reports.training` (B6) | moonshots-ezprop-2026-10-25.md | Krok i datamodellen | Skyggemodus senere |
| Krok: `calibration_rounds` (B7) | moonshots-ezprop-2026-10-25.md | Krok i datamodellen | Kalibreringsquiz senere, etter betaen (27.10.2026) |
| Krok: `peer_reviews.required_reason` (O4) | moonshots-ezprop-2026-10-25.md | Krok i datamodellen | Tilfeldig stikkprøve senere |

---

## De første oppgavene (fase 0 og 1)

Hver oppgave kan gis til en egen Claude-tråd. Rekkefølgen følger planen: **0a** (oppgave 1–2) → **1** (oppgave 3–7) → **0b** (oppgave 8–10). Prøven uten nett (den største risikoen) starter tidlig, fordi valget av synkverktøy kan påvirke databasen og innloggingen. Oppgave 11–16 går ved siden av og trenger lite eller ingen kode.

### Fase 0a

**Oppgave 1 – Repo og verktøy.**
> Sett opp repoet `Byggcon-sl/EzProp` slik Optiplan er satt opp: Next.js med TypeScript (strict), pnpm, ESLint, Prettier, Vitest, Playwright og GitHub Actions (lint, typesjekk, test, bygg). Lag `CLAUDE.md` og `docs/` med samme oppbygging som Optiplan (med regelen «en fast kode endres aldri, den arkiveres»), og legg inn `datamodell.md` og `utviklingsplan.md` fra SharePoint-mappen som `docs/05-domenemodell.md` og `docs/07-utviklingsplan.md`. Produktnavnet står bare i én fil. Ferdig når en tom side starter lokalt og alle sjekkene i GitHub Actions er grønne.

**Oppgave 2 – Database og grunnregler.**
> Sett opp PostgreSQL lokalt og Drizzle. Lag felles kolonner for alle tabeller etter `docs/05-domenemodell.md` avsnitt 3 (ID laget på enheten, organisasjons-ID, laget/endret, myk sletting, radversjon), og tabellene `organizations` og `audit_log`. Lag en testhjelper som viser at en spørring aldri gir data fra en annen organisasjon. Ferdig når migreringen kjører i CI og tenant-testen er grønn.

### Fase 1

**Oppgave 3 – Testoppsett for prøven uten nett.**
> Lag et lite testskjema i appen (ca. 40 felt: tekst, TG, valg, tall, tabell og bildefelt) og en plan for prøvene A–F i fase 1 i `docs/07-utviklingsplan.md`. Skriv kriteriene for å sammenligne kandidatene (virker prøvene, arbeid, drift i EU/EØS, pris, modenhet) i en kort funksjonsbeskrivelse. Ferdig når skjemaet kan fylles ut i Safari på iPad med nett, og planen er godkjent av Ståle.

**Oppgave 4 – Første kandidat: PowerSync.**
> Koble testskjemaet til PowerSync. Kjør prøve A (30 minutter uten nett, 200 bilder, lukk og åpne, omstart) og prøve B (to iPader i samme kontrollpunkt) på iPad Pro med appen på hjemskjermen. Bruk Yjs eller tilsvarende for tekstfletting. Skriv resultatet med tall og skjermopptak. Ferdig når resultatet er skrevet, også det som ikke virket.

**Oppgave 5 – Andre kandidat: ElectricSQL (og eventuelt en enkel egen løsning).**
> Samme prøver som oppgave 4 med ElectricSQL. Lag også en enkel egen løsning (lokal database og endringskø) som sammenligningsgrunnlag, hvis tiden tillater det. Ferdig når resultatet er skrevet på samme måte som i oppgave 4.

**Oppgave 6 – Bilder, lagring og regler uten nett.**
> Med den beste kandidaten så langt: kjør prøve C (lagringsplass i Safari, data etter omstart og etter flere dager), prøve D (komprimering, rotering, HEIC, opplasting med fortsettelse og fingeravtrykk), prøve E (én regel for alder mot levetid og én målegrense kjører likt på iPad og server, med testtilfeller) og prøve F (innlogging som har gått ut). Lag synkstatus med antall som venter og «Synk nå». Ferdig når alle fire prøvene er skrevet med resultat.

**Oppgave 7 – ADR for drift uten nett og demo.**
> Skriv ADR-en med valgt løsning, begrunnelse, hva som ikke virket og hva det betyr for databasen og innloggingen. Lag en kort demo Ståle kan kjøre selv på iPad i en kjeller. Ferdig når Ståle har sett demoen og godkjent ADR-en.

### Fase 0b

**Oppgave 8 – Felles innlogging med Optiplan.**
> Sett opp innlogging med engangskode på e-post (Better Auth) som i Optiplan, slik at en ansatt bruker samme innlogging i begge løsningene. Legg inn sperre etter mange feil ved innlogging og en nøkkelboks for hemmeligheter (innspill P12). Beskriv valget i en ADR, og ta hensyn til ADR-en fra oppgave 7. Ferdig når en testbruker logger inn i EzProp med kode og ser en tom side, og det er testet at Optiplan virker som før.

**Oppgave 9 – Organisasjon, selskaper, kontorer og ansatte.**
> Lag tabellene og admin-sidene for selskaper (firmatekst, logo, ansvarsforsikring), kontorer, ansatte (ett selskap per person, innlogging kan mangle for dem som har sluttet) og sertifiseringer med utløpsdato (H5), etter `docs/05-domenemodell.md` avsnitt 4.1. Ferdig når admin har lagt inn Byggcon med selskapene og noen ansatte, og testene for tenant-isolasjon er grønne.

**Oppgave 10 – Roller, rettigheter og grunnlayout.**
> Lag den felles tilgangsmodulen etter rettighetsmatrisen i `docs/05-domenemodell.md` avsnitt 5, med enkeltrettigheter som admin kan gi (for eksempel maltilgang), og grunnlayouten i design A «Fjord» for PC og iPad med tom arbeidskø. Admin skal aldri kunne stenges ute. Ferdig når hver rolle har tester som viser hva den kan og ikke kan, og fase 0 kan demonstreres for Ståle.

### Ved siden av fase 0 og 1

**Oppgave 11 – Fagråd – runde 1.**
> Lag en kort arbeidsliste for fagrådet med de tre leveransene: (1) tersklene i terskeltabellen sjekket mot NS-punktet, (2) de 10 prøveeksemplene på avvikstekster, (3) kontrollpunktene for leilighet og fellesdeler (boenhet, fellesdel eller begge), pluss de tre fagspørsmålene fra leilighetsanalysen. Fagrådet er Ståle alene fram til produksjon (27.10.2026). Ferdig når Ståle har godkjent alle tre.

**Oppgave 12 – Måling i IVIT.**
> Lag et enkelt regneark der Ståle noterer tid per befaring og tid fra befaring til levert rapport, på 10 oppdrag i IVIT (bare Ståle foreløpig, 27.10.2026). Ferdig når 10 oppdrag er målt og tallene er oppsummert.

**Oppgave 13 – eAccounting-prøve.**
> Prøv fire kall i eAccountings sandbox: kunde uten dublett, fakturautkast, status (sendt, betalt) og kreditnota. Nøkler bare i hemmelig oppsett. Skriv et kort notat om hva som virket, og hva det betyr for `external_references`. Ferdig når notatet er skrevet.

**Oppgave 14 – Undersøke API-ene til Enova og Polycam.**
> Finn ut hva Enova (energimerking) og Polycam (3D-skanning og plantegning) tilbyr av API eller eksport, hva tilgangen krever, pris og vilkår, og om data kan lagres i EU/EØS. Skriv et kort notat per tjeneste med forslag til når og hvordan det kan kobles til EzProp bak en port i tilkoblingslaget. Ingen kode. Ferdig når notatene er skrevet.

**Oppgave 15 – Nullpunkt for tid (hovedmålet).**
> Utvid regnearket fra oppgave 12 slik at samlet tid per rapport deles i forberedelse, befaring, kontorarbeid og levering, per rapporttype. Lag en plan for hvor mange oppdrag som trengs for et sikkert nullpunkt (Claudes forslag: 20–30 fordelt på de vanligste rapporttypene). Ferdig når nullpunktet er oppsummert og godkjent av Ståle.

**Oppgave 16 – Nullpunkt for reklamasjoner (hovedmålet).**
> Finn ut hvor tallene for reklamasjoner og krav de siste 3 årene finnes (Byggcons egne oversikter eller ansvarsforsikringen), og sett opp antall, beløp og antall leverte rapporter per år. Ingen kundeopplysninger skal skrives ned, bare tall. Ferdig når nullpunktet er skrevet ned med kilde.

---

## Åpne spørsmål om planen

Spørsmålene som stod her (rekkefølgen, beta og pilot, fagrådet, eAccounting, fase 4b, rapporttyper og verditakst, og hvem som måler tid i IVIT) er **besvart** og tatt inn. Se `svar-fra-stale-2026-10-27.md` og beslutningstabellen i `LES-MEG.md`.

Det som fortsatt er åpent:

1. **Hvem er med i piloten?** Betaen og tidsmålingen er bare Ståle. Flere takstmenn (minst tre) velges før piloten (fase 3).
2. **Forslagene fra leilighetsanalysen** (`analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 6): nye advarsler i sjekken før publisering og endringer i PDF-profilen (fase 2a). Ståle avgjør.
3. **Enova og Polycam:** hva API-ene gir, og når en tilkobling skal bygges. Avgjøres etter oppgave 14.
4. **Hovedmålet (28.10.2026):** Hva betyr «EzProp 2.0» i tid? Claudes forslag: versjonen som er i full drift for alle takstmenn, med mål om ca. 12 måneder etter produksjonsstart. Ståle bekrefter også måten tid og reklamasjoner måles på.
5. **Nullpunkt for reklamasjoner:** hvor finnes tallene for de siste 3 årene?

*De åpne spørsmålene om selve datamodellen står i `datamodell.md` avsnitt 9.*

---

## Endringslogg

- **28.10.2026 (Ståle i chat, senere):** ingen grense for antall PR-er som venter på Ståle. Løkken stopper ikke lenger ved tre.
- **28.10.2026 (Ståle i chat):** «Testmiljø i Azure» lagt inn som første punkt i fase 1 (samme miljø som Optiplan). Fase 0b: felles innlogging **og felles profil** for admin og ansatte med Optiplan, kundene adskilt, og bytte mellom løsningene med ett trykk. Samspillet mellom EzProp og Optiplan skal komme «etter hvert», ut over innloggingen.

| Dato | Hva er endret | Fra innspill |
|---|---|---|
| 25.10.2026 | Første utkast | – |
| 25.10.2026 (etter innspill) | Ny rekkefølge 0a → 1 → 0b → 2a → 2b, skrevet ut øverst og i fasene | P10 |
| 〃 | Ny liste «Minimum før ekte data» før fase 2 (EU/EØS med HTTPS, sikkerhetskopi med prøvd gjenoppretting, databehandleravtaler, bare ansatte, intern personvernerklæring, sletteregel for betadata, sperring av iPader) | P1, P6 |
| 〃 | Fase 2 delt i 2a «Rapporten på PC» og 2b «Befaringen på iPad», med «ferdig når». Fagrådets godkjenning lagt inn i 2a. | P2 |
| 〃 | Nytt avsnitt «Ved siden av fase 0 og 1»: Fagråd – runde 1, måling i IVIT, eAccounting-prøve. Nye oppgaver 11–13. | P3, P4, P7 |
| 〃 | ADR for PDF-motor og PDF under 8 MB i fase 2a | P5, P8 |
| 〃 | Oppsett og sperring av iPadene i fase 2b | P6 |
| 〃 | «Send»-knapp i 2a, automatisk sending per selskap i fase 3 | P9 |
| 〃 | Fire testoppdrag som grunndata i 2a | P11 |
| 〃 | Nøkkelboks og sperre etter mange feil ved innlogging i fase 0b | P12 |
| 〃 | Én felles PDF-layout for egne maler i fase 5 | P13 |
| 〃 | Listen «omveier til IVIT» startes i 2b | P14 |
| 〃 | «Ståle avgjør innen demoen» i hver fase | P15 |
| 〃 | Fase 3: kalender og kapasitet med Outlook begge veier, prisliste per avtale, enkelt lederdashbord, hjelp koblet til kunnskapsbasen, bestillingsskjema for meglere, varsler som arbeidsliste, oppgaver på mobil og daglig oppsummering. Fase 3 delt med underoverskrifter. | H1, H2, H3, H7, H8, H11, H12 |
| 〃 | Fase 4: meglerprofil med tall, reklamasjonsmappe og intern avviksregistrering med registrering av reklamasjoner | H4, H6, S1 |
| 〃 | Sertifisering med utløpsdato i fase 0b | H5 |
| 〃 | Ny fase 4b «Kundesiden» (nettrapport, selgerportal, meglerstatus, gyldighetsside med QR), merket «forslag – Ståle avgjør» | H9 |
| 〃 | Verditakst som systemmal nr. 2 i «Senere», med merknad | H10 |
| 〃 | KI trinn 1: evalueringssett og kostnadsmåling. KI-prioriteringen etter produksjon i «Senere». «Glemt noe?» i 2b. | `funksjonalitet-ki` 9, 10, K4 |
| 〃 | Oppslag i Optiplan og én kundebase i fase 4 | O1, O3 |
| 〃 | Nytt avsnitt «Strekkmål (moonshots)» med de fem strekkmålene og krokene som er lagt inn | `moonshots` 6 og 7 |
| 〃 | Sporbarhet: gamle funn fordelt på 0a/0b/2a/2b, noen flyttet etter innspill, nye tabeller for P1–P15, H1–H12, KI-krokene og S1–S6, og ny telling | – |
| 〃 | Mål, pilotmåling, risikotabell og åpne spørsmål oppdatert (spørsmål 1, 3 og 4 tatt inn, tre nye) | – |
| 27.10.2026 | Ståles svar på de 28 samlede spørsmålene og tre bekreftelser ført inn (`svar-fra-stale-2026-10-27.md`) | – |
| 〃 | Fagrådet er Ståle alene fram til produksjon. Beta og tidsmåling i IVIT er bare Ståle. Flere takstmenn velges før piloten. | Spørsmål 3 og 27 |
| 〃 | Ettårs-oppfølging, samspill med Optiplan (O1, O3) og samme-dag-rapport tatt ut som mål og strekkmål. Felles innlogging beholdes. | Spørsmål 21, 23 og 24 |
| 〃 | Fullt CRM flyttet fra «Senere» til fase 4, rett etter adresseboka (meglerprofil med tall) | Spørsmål 20 |
| 〃 | Fase 4b godkjent (etter produksjon, før malbyggeren) | Spørsmål 19 |
| 〃 | Ny oppgave ved siden av fase 0 og 1 (oppgave 14): undersøke API-ene til Enova og Polycam. Tilkoblingen i «Senere». | Spørsmål 22 |
| 〃 | Kalibrering etter betaen, Intune senere | Spørsmål 9 og 16 |
| 〃 | Spørreundersøkelse i EzProp, rutiner som admin og hver takstmann kan lage og justere, rettet rapport sendes manuelt | Spørsmål 14 |
| 〃 | Fire statuser, reklamasjoner fra første ekte rapport, eget kostnadsbeløp med advarsel, gyldig til fra befaringsdato, sidemann bare advarsel, egne maler uten TG-logikk | Spørsmål 1, 4, 5, 7, 8, 13 |
| 〃 | Rapporttyper: alle maler inn etter hvert. Verdidel ikke krav for produksjon («de færreste tilstandsrapportene har verdi»), og leilighetsrapporter med markedsverdi lages i IVIT til verdidel finnes | Spørsmål 18 og tillegg |
| 〃 | Forslag (ikke vedtatt) fra leilighetsanalysen: nye advarsler i sjekken før publisering og PDF-profil i 2a, verdidel i «Senere» | `analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 6 |
| 〃 | Åpne spørsmål om planen: de besvarte er fjernet, tre gjenstår. Sporbarhetstellingen oppdatert. | – |
| 〃 | Merket «Rettet» under «Ferdig» og reklamasjonssaker bare for leder og admin (fase 2a) | Tilleggsbeslutninger 27.10.2026 |
| 28.10.2026 | Hovedmål øverst (50 % mindre tid, halvparten så mange reklamasjoner, KI først), med måling og tabell over hva som bidrar mest per fase. Nye oppgaver 15 og 16 (nullpunkt for tid og reklamasjoner) ved siden av fase 0 og 1. Tidsmåling per rapport i 2a. Pilotmåling med de to tallmålene. KI-funksjoner i «Senere» merket «vurder å flytte fram». To nye åpne spørsmål. | Ståle i chat 28.10.2026 |
