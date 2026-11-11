# EzProp – levert arbeid (arkiv)

Sist oppdatert: 11.11.2026

Her står det som er levert, slik det sto i planen da det ble krysset av. Filen er historikk. **Planen som gjelder, er `docs/07-utviklingsplan.md`.** Det som fortsatt venter på Ståle fra disse fasene, står under «Venter på Ståle» i planen.

Når et punkt i planen er levert og merget, flytter prosjektlederen linjen hit (læringsløkken), slik at planen bare viser det som gjenstår.

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
- [ ] **Prøve A – én takstmann uten nett (må):** flymodus i 30 minutter, alle felt fylles ut, 200 bilder tas, appen lukkes og åpnes igjen, iPaden startes på nytt. Når nettet kommer: alt synkroniseres, ingenting går tapt. (se også Spectora-YouTube V1, V2)
- [ ] **Prøve B – to i samme rapport (bør):** to iPader endrer samme kontrollpunkt samtidig. Tekst flettes. TG, valg og tall følger «siste endring vinner», og den andre får varsel. (se også Spectora-YouTube V2)
- [x] **Prøve C – lagring i Safari:** hvor mye plass appen får, at data overlever omstart og flere dager uten bruk, og hva som skjer når plassen er brukt opp
  - [x] Småfunn fra gjennomgangen av PR #32: loggen viser bare feilnavnet, testen for åpning uten nett uten reservevei, færre doble tester, ett mønster for plassmålingen (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-c.md`)
- [x] **Prøve D – bilder:** komprimering og riktig rotering på iPaden, HEIC til JPEG, opplasting mens appen er åpen, fortsettelse etter brudd, kontroll med fingeravtrykk (PR-en fra branchen `fase1-prove-d-bilder`, 30.10.2026, `docs/funksjoner/fase1-prove-d-bilder.md`; automatiske tester i Chromium på `pc` og `ipad`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-d-bilder-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #35: en visningskopi som avvises eller er slettet, sendes ikke igjen og vises som «Bare originalen er lagret», serveren slipper bare de feltene kopien trenger, én tegnevei, adressen ett sted, færre doble tester (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md`)
- [x] **Prøve E – regler uten nett:** én regel for alder mot levetid og én målegrense kjører på iPaden og gir samme svar som på serveren (PR-en fra branchen `fase1-prove-e-regler`, 29.10.2026, `docs/funksjoner/fase1-prove-e-regler.md`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-e-regler-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #23 og det som sto igjen fra PR #26: egen test for `localWriteGeneration`, testsakene for prøvereglene bare i testene, grensetallet ett sted, færre doble tester, og loggen i synken viser bare feilmeldingen (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-e.md`)
- [x] **Prøve F – innlogging som har gått ut:** takstmannen kan fortsatt åpne og fullføre rapporten uten nett (PR-en fra branchen `fase1-prove-f-innlogging`, 30.10.2026, `docs/funksjoner/fase1-prove-f-innlogging.md`; prøven på ekte iPad gjenstår, resultatmal `docs/funksjoner/fase1-prove-f-innlogging-resultat.md`)
  - [x] Småfunn fra gjennomgangen av PR #34: færre doble tester for meldingen om innlogging og i sjekken av innloggingen, og opprydding i testhjelperne (30.10.2026, `docs/agenter/oppgaver/fase1-smafunn-prove-d-f.md`)
- [x] Synkstatus som alltid vises: antall endringer og bilder som venter, «lagret kl.», og «Synk nå» (PR #21, 29.10.2026, `docs/funksjoner/fase1-synkstatus.md`) (se også Spectora-YouTube V1, V19)
  - [x] Småfunn fra gjennomgangen av PR #21: egen test for «Synk nå», trygg oppretting av testtakstmannen i e2e (bare lokal database og testdatabase), loggen viser bare feilmeldingen, og opprydding i testkoden (29.10.2026, `docs/agenter/oppgaver/fase1-smafunn-synkstatus.md`)
- [x] Sammenligning av kandidatene: virker prøvene, hvor mye arbeid, drift i EU/EØS, pris og hvor modent verktøyet er (30.10.2026, `docs/funksjoner/fase1-sammenligning.md`; bygger på de automatiske prøvene. **Foreløpig; bekreftes etter prøve A og B på ekte iPad, og Ståles godkjenning i demoen gjenstår**)
- [x] **ADR: valg av løsning for drift uten nett**, med begrunnelse og det som ikke virket (30.10.2026, `docs/adr/0004-drift-uten-nett.md`: egenbygd, reserve PowerSync eller ElectricSQL. **Foreløpig; bekreftes etter prøve A og B på ekte iPad, og Ståles godkjenning i demoen gjenstår**)
- [ ] Demo for Ståle på ekte iPad i en kjeller uten dekning

**Ferdig når:** Prøve A virker uten tap på to iPader flere ganger, prøve B virker med nett, og Ståle har sett demoen og godkjent ADR-en med valgt løsning.

**Ståle avgjør innen demoen:** godkjenne ADR-en for drift uten nett.

## Fase 0b – Innlogging, organisasjon, roller og layout  `status: i arbeid fra 30.10.2026; levert så langt det går uten Ståle (03.11.2026). Igjen: de to Optiplan-punktene (innlogging som Optiplan og bytte med ett trykk), som venter på Ståle og Optiplan-tilgang. Løkken gikk videre til fase 2a 03.11.2026`

**Innlogging og sikkerhet**
- [ ] **Innlogging som Optiplan** (engangskode på e-post), med **felles innlogging og felles profil for admin og ansatte** mellom EzProp og Optiplan (Ståle 28.10.2026): samme bruker, samme navn, telefon, stilling og kontor i begge. **Kundene holdes adskilt**: Optiplans styrer og EzProps kunder og meglere er aldri samme brukere. Løsningen beskrives i en ADR som tar hensyn til ADR-en fra fase 1.
- [ ] **Bytte mellom EzProp og Optiplan med ett trykk** (Ståle 28.10.2026: «sømløst»): en lenke i menyen i begge løsningene, uten ny innlogging. Mer samspill enn dette kommer senere.
- [x] **Sperre etter mange feil** ved innlogging (innspill P12). Tofaktor kommer i fase 4. (02.11.2026, `docs/funksjoner/fase0b-sperre-innlogging.md`, beslutninger A35–A38)
- [x] **Nøkkelboks for hemmeligheter** (for eksempel Azure Key Vault, samme oppsett som Optiplan). Ingen nøkler i koden eller databasen, bare navnet på hemmeligheten (`secret_ref`). (Innspill P12) Levert 03.11.2026 som bare kode, av som standard, Ståle slår på (`ENABLE_KEY_VAULT`); ADR 0005. Steg 2 (appen leser tilkoblingenes hemmeligheter rett fra boksen i kode) er utsatt til den første tilkoblingen som trenger en hemmelighet som ikke er kjent ved utrulling (A50, `docs/funksjoner/fase0b-nokkelboks-kodevei.md`); se fase 3, fakturagrunnlaget.

**Organisasjon og tilgang**
- [x] Organisasjon → selskap → kontor → ansatt, med ansvarsforsikring og firmatekst per selskap. Ansatte som har sluttet, kan stå uten innlogging (innspill D18). (30.10.2026, branch `fase0b-organisasjon-selskap-kontor`)
  - [x] Småfunn fra gjennomgangen av PR #41: faste feltlister for selskaper og kontorer (ingen sporingsfelt), tenant-test også for ansatte som har sluttet, enklere join, seed-testene skriver ikke til konsollen (30.10.2026, `docs/agenter/oppgaver/fase0b-smafunn-organisasjon.md`)
- [x] **Sertifisering med utløpsdato** (funksjonskart H5): den som har utgått sertifisering, kan ikke publisere som ansvarlig, og admin ser hvem som snart går ut. Varsel i arbeidslisten kommer i fase 3.
- [x] Roller og rettigheter i én felles tilgangsmodul, etter rettighetsmatrisen i `datamodell.md` avsnitt 5. Admin kan gi enkeltrettigheter (for eksempel maltilgang). Admin stenges aldri ute. **Fra 27.10.2026:** alle takstmenn ser alle oppdrag og data og kan foreløpig endre alt, styrt av en innstilling som er lett å stramme inn. Alle kan sende fakturagrunnlag. (31.10.2026, `docs/funksjoner/fase0b-roller-rettigheter.md`, beslutninger A18–A21; admin-skjermene er eget punkt)
- [x] Admin: opprette selskaper, kontorer og ansatte, og gi roller (31.10.2026, `docs/funksjoner/fase0b-admin-organisasjon.md`, beslutninger A24–A28; minst én admin alltid)

**Grunnmur**
- [x] Revisjonslogg og hendelseslogg (grunnmuren som rapporter, maler og rutiner skriver til) (31.10.2026, `docs/funksjoner/fase0b-revisjon-hendelser.md`, beslutninger A33 og A34) (se også Spectora-YouTube V61)
- [x] Felles filtjeneste for bilder og dokumenter (lokal mappe i utvikling, fillagring i EU/EØS i drift), **bak et eget lag**, slik at bilder senere kan flyttes til et lokalt arkiv hos Byggcon (27.10.2026). Oppbevaringstidene er innstillinger. (02.11.2026, `docs/funksjoner/fase0b-filtjeneste.md`, beslutninger A39–A43; Azure-adapteren er bare kode og slås på av Ståle)
  - [x] Småfunn fra gjennomgangen rettet (liten oppgave (o)/(p)/(q), 03.11.2026, docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling.md)
- [x] Tilkoblingslag med faste porter (regnskap, e-post, meglersystem, eiendomsdata, KI). Første tilkobling: e-post via Microsoft 365 som i Optiplan, og en «utviklingspostkasse» lokalt. (02.11.2026, `docs/funksjoner/fase0b-tilkoblingslag.md`, beslutninger A44–A48; Microsoft 365-adapteren er bare kode og slås på av Ståle med de fire secretene; `external_references` og selskap på tilkoblingen er flyttet til fase 3)
  - [x] Småfunn fra gjennomgangen rettet (liten oppgave (o)/(p)/(q), 03.11.2026, docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling.md)
- [x] Test av tenant-isolasjon for alle nye tabeller: en bruker i én organisasjon får aldri data fra en annen (02.11.2026, `tests/tenant-tables.ts`, `tests/tenant-isolation-all-tables.test.ts`)
  - [x] Småfunn fra gjennomgangen rettet (liten oppgave (o)/(p)/(q), 03.11.2026, docs/agenter/oppgaver/fase0b-smafunn-filtjeneste-tilkobling.md)
  - [x] Småfunn fra gjennomgangen av PR #69 og nattløkken 03.11.2026 rettet: typen fra skjemaet i e-postoppsettet, enklere loggvask, eksakt e-postoppslag ved ny ansatt, bildefiler skrives ferdig før de får navn, unntaket for `employee_permissions` dokumentert, færre doble tester (liten oppgave (r)/(s), 03.11.2026, `docs/agenter/oppgaver/fase0b-smafunn-r-s.md`)
- [x] Grunnlayout i design A «Fjord» (luftig), for PC og iPad, med tom arbeidskø som startside

**Ferdig når:** Admin har lagt inn Byggcon med selskapene, kontorene og noen ansatte. En takstmann logger inn med engangskode (samme innlogging som i Optiplan) og ser en tom arbeidskø. En automatisk test viser at en annen organisasjon ikke ser noe av Byggcons data.

**Ståle avgjør innen demoen:** ingenting nytt. Betaen er bare Ståle foreløpig, og eierformene og boligtypene er godkjent (27.10.2026).

## Fase 2a – Rapporten på PC (levert til og med 11.11.2026)

- [x] Manuell ordre (bestilling lagt inn for hånd fra e-post), med egne felt som gnr/bnr, seksjon, borettslag og om egenerklæring er mottatt, og «gjør om til oppdrag» eller «avvis» (04.11.2026, `docs/funksjoner/fase2a-manuell-ordre.md`, sidene `/ordre`, `/ordre/ny` og `/ordre/[id]`, beslutningene A51–A55; sammen med oppdragsnummeret)
- [x] **Oppdragsnummer** som `2026-00123`, laget på serveren fra en nummerserie (innspill D9) (04.11.2026, samme kort; tabellen `number_sequences`, én serie per organisasjon og år, A52)
- [x] Oppdrag med team (ansvarlig, medansvarlig, befaringstakstmann, sidemann, kontor), parter med roller (megler, selger, kjøper, representant, fakturamottaker) og hva hver part mottar (04.11.2026, `docs/funksjoner/fase2a-oppdrag-team-parter.md`, tabellene `assignment_team_members` og `assignment_parties`, siden `/oppdrag/[id]`, beslutningene A60–A63)
- [x] Utstedende selskap settes automatisk fra ansvarlig takstmann (05.11.2026, `docs/agenter/oppgaver/fase2a-utstedende-selskap.md`, kolonnen `assignments.company_id`, regelen i `setTeamMember`, linjen på `/oppdrag/[id]`, beslutningene A65–A68)
- [x] Statusflyten med **fire statuser** (bestilt, under arbeid, ferdig, fakturert, 27.10.2026) og hendelser som lagres for alt som skjer. Kansellering med myk sletting. En rapport som er rettet og sendt på nytt, får merket **«Rettet»** under «Ferdig» (27.10.2026). (05.11.2026, `docs/funksjoner/fase2a-statusflyt.md`, `src/core/assignments/status-flow.ts` og `status.ts`, kortet «Status» på `/oppdrag/[id]`, hendelsene `assignment.status_changed` og `assignment.cancelled`, ingen migrering, beslutningene A74–A77)
- [x] Oppdragslisten som arbeidskø: faner etter status med antall, hurtigfilter, kort notat per oppdrag, merker med status, dato og takstmann (05.11.2026, `docs/funksjoner/fase2a-arbeidsko.md`, startsiden `/arbeidskoe`, kolonnene `inspection_at`, `due_date` og `internal_note`, migreringen 0020, beslutningene A99–A107)
- [x] Avtale med oppdragsgiver (for eksempel Fremtind) med egen rapportprofil og premissetekst (06.11.2026, `docs/funksjoner/fase2a-oppdragsgiveravtale.md`, tabellen `client_agreements` og `assignments.client_agreement_id`, migreringen 0021, sidene `/admin/avtaler`, kortet «Avtale» på `/oppdrag/[id]` med forslag fra bestillerens firma, beslutningene A114–A118; PDF-profil og bruk av premisseteksten kommer med PDF-punktene)
- [x] Eiendom og matrikkel lagt inn for hånd, med boligtype og **eierform**, og **fellesdeler** for leilighet (05.11.2026, `docs/funksjoner/fase2a-eiendom-matrikkel.md`, tabellene `properties`, `cadastral_units` og `common_areas`, delene «Eiendom» og «Fellesdeler» på `/oppdrag/[id]`, beslutningene A69–A73)
- [x] Bygninger, etasjer, **areal per etasje** (BRA-i, BRA-e, BRA-b, ALH) med hvem som målte og metode, og rom med romtype og «under terreng» (05.11.2026, `docs/funksjoner/fase2a-bygninger-areal-rom.md`, tabellene `report_buildings`, `floors`, `floor_areas` og `rooms`, siden `/oppdrag/[id]/bygninger`, migreringen 0019, beslutningene A94–A98)
- [x] Kontakter og firma (meglere og meglerforetak) med notater, uten dubletter på organisasjonsnummer, og med kilde for opplysningene (innspill D17) (05.11.2026, `docs/funksjoner/fase2a-kontakter-firma.md`, tabellene `firms` og `contacts`, sidene `/kontakter` og `/firma`, beslutningene A79–A83)
- [x] Koble partene på oppdraget og bestilleren til kontakter og firma (`assignment_parties.contact_id`/`firm_id`, `orders.ordered_by_contact_id`/`ordered_by_firm_id`), med søk etter kontakt fra oppdragssiden (05.11.2026, `docs/funksjoner/fase2a-koble-kontakter.md`, kontaktvelgeren «Søk i kontakter» på partene og ny ordre, sammensatte fremmednøkler med `organization_id`; A84–A92)
- [x] Fjerne (myk sletting fra skjermen) og slå sammen like kontakter og firma (05.11.2026, `docs/funksjoner/fase2a-fjerne-sla-sammen-kontakter.md`, `src/core/contacts/remove-merge.ts`, knappene «Fjern» og «Slå sammen» på `/kontakter/[id]` og `/firma/[id]`, sidene `…/sla-sammen`, ny rettighet `contacts.manage`, ingen migrering, beslutningene A108–A113)
- [x] **Tidsmåling per rapport fra første ekte rapport** (hovedmålet, 28.10.2026): arbeidsøkter per fase (forberedelse, befaring, kontorarbeid, levering) lagres automatisk fra hendelsene, slik at tiden kan sammenlignes med nullpunktet fra IVIT. **Levert 06.11.2026** (`work_sessions`, `/statistikk/tid`, A119–A124). (se også Spectora-YouTube V16, V78)
- [x] **Reklamasjoner med enkelt skjema fra første ekte rapport** (beslutning 27.10.2026, spørsmål 4). **Bare leder og admin ser reklamasjonssakene** (unntak fra «alle ser alt», 27.10.2026). Reklamasjonsmappen kommer i fase 4. **Levert 06.11.2026** (`claims`, `claims.manage`, delen «Reklamasjoner» på oppdraget, A125–A129). (se også Spectora-YouTube V125, V126)
- [x] **Fire testoppdrag som grunndata** (innspill P11): enebolig med garasje, leilighet i sameie, borettslagsleilighet og fritidsbolig, med bilder uten personer. Brukes i «Prøv malen», i regeltester og i demoer. **Levert 06.11.2026** uten bilder (`pnpm db:seed:testoppdrag`, prøveorganisasjonen, A130–A135).

- [x] **ADR: KI i bunnen.** Hvordan modulen `src/core/ai` er bygget, hvordan forslag lagres, logges og merkes, hva som aldri sendes til KI, og hvordan leverandøren byttes. Bygger på reglene over og `docs/05-domenemodell.md` 4.12. (10.11.2026, PR #123, `docs/adr/0006-ki-i-bunnen.md`, oppgavekort `docs/agenter/oppgaver/fase2a-adr-ki-i-bunnen.md`, beslutningene A148–A157, spørsmål 54–58)
- [x] **KI-modulen og loggen:** én vei inn for all KI, tabellen `ai_usage_log` (funksjon, leverandør, kostnad, og om forslaget ble godtatt, endret eller avvist), og en **falsk leverandør** for utvikling og test, slik at alt kan bygges og prøves uten kostnad. (PR #127, 10.11.2026)
- [x] **Forslagsmønsteret:** forslag med kilde og status, én felles måte å vise dem på («bruk, behold, nytt forslag» og angre), merking av KI-tekst, og sperren som hindrer publisering med KI-tekst som ikke er godkjent. (10.11.2026, PR #131, oppgavekort `docs/funksjoner/fase2a-forslagsmonster.md`, prøvesiden `/prove/ki`, beslutningene A166–A168)
- [x] **Vask før KI:** navn, e-post, telefon, adresse og matrikkel fjernes før noe sendes. Med test. (11.11.2026, PR #135, oppgavekort `docs/funksjoner/fase2a-vask-for-ki.md`, migreringen `0027_ki-vask`, `src/shared/lib/pii-patterns.ts`, beslutningene A169–A179)
- [x] Malmotoren fra `datamodell.md` 4.5: malfamilie, malversjon, seksjon, felt, kontrollpunkt, avviksspørsmål, utfall, standardtiltak og regler. Systemmalen er låst for alle uten maltilgang (10.11.2026, PR #119, oppgavekort `docs/funksjoner/fase2a-malmotor.md`, migreringen `0024_malmotor`, tjenestene i `src/core/templates`, beslutningene A136–A147; små funn i liten oppgave (ac))

## Minimum før ekte data (levert)

- [x] **Intern personvernerklæring:** kort om hva som lagres, hvorfor, hvor og hvor lenge (04.11.2026, `docs/personvern/intern-personvernerklaering.md`) (se også Spectora-YouTube V97)
- [x] **Regel for sletting av data fra betaen** som ikke skal beholdes (for eksempel prøverapporter som bare var for testing) (04.11.2026, `docs/personvern/sletting-av-betadata.md`)
  - Merknad 28.10.2026 (oppgave 4): `trial_*`-tabellene fra fase 1 slettes eller gjøres om her bare fordi dataene er oppdiktede. Det er ikke presedens for sletting av ekte data (regel 3: ingenting slettes permanent).

## Ved siden av fase 0 og 1 (levert)

- [x] **Avklare fagrådet:** **Ståle er fagrådet alene** fram til EzProp er i produksjon. Det trengs ikke faste møter. «Fagrådet godkjenner» betyr Ståle godkjenner. (Besluttet 27.10.2026, `svar-fra-stale-2026-10-27.md` spørsmål 3)

---

# Historisk: de første oppgavene (28.10.2026)

Oppgavetekstene som startet fase 0 og 1. De er utført eller erstattet av planen.


Hver oppgave kan gis til en egen Claude-tråd. Rekkefølgen følger planen: **0a** (oppgave 1–2) → **1** (oppgave 3–7) → **0b** (oppgave 8–10). Prøven uten nett (den største risikoen) starter tidlig, fordi valget av synkverktøy kan påvirke databasen og innloggingen. Oppgave 11–16 går ved siden av og trenger lite eller ingen kode.

## Fase 0a

**Oppgave 1 – Repo og verktøy.**
> Sett opp repoet `Byggcon-sl/EzProp` slik Optiplan er satt opp: Next.js med TypeScript (strict), pnpm, ESLint, Prettier, Vitest, Playwright og GitHub Actions (lint, typesjekk, test, bygg). Lag `CLAUDE.md` og `docs/` med samme oppbygging som Optiplan (med regelen «en fast kode endres aldri, den arkiveres»), og legg inn `datamodell.md` og `utviklingsplan.md` fra SharePoint-mappen som `docs/05-domenemodell.md` og `docs/07-utviklingsplan.md`. Produktnavnet står bare i én fil. Ferdig når en tom side starter lokalt og alle sjekkene i GitHub Actions er grønne.

**Oppgave 2 – Database og grunnregler.**
> Sett opp PostgreSQL lokalt og Drizzle. Lag felles kolonner for alle tabeller etter `docs/05-domenemodell.md` avsnitt 3 (ID laget på enheten, organisasjons-ID, laget/endret, myk sletting, radversjon), og tabellene `organizations` og `audit_log`. Lag en testhjelper som viser at en spørring aldri gir data fra en annen organisasjon. Ferdig når migreringen kjører i CI og tenant-testen er grønn.

## Fase 1

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

## Fase 0b

**Oppgave 8 – Felles innlogging med Optiplan.**
> Sett opp innlogging med engangskode på e-post (Better Auth) som i Optiplan, slik at en ansatt bruker samme innlogging i begge løsningene. Legg inn sperre etter mange feil ved innlogging og en nøkkelboks for hemmeligheter (innspill P12). Beskriv valget i en ADR, og ta hensyn til ADR-en fra oppgave 7. Ferdig når en testbruker logger inn i EzProp med kode og ser en tom side, og det er testet at Optiplan virker som før.

**Oppgave 9 – Organisasjon, selskaper, kontorer og ansatte.**
> Lag tabellene og admin-sidene for selskaper (firmatekst, logo, ansvarsforsikring), kontorer, ansatte (ett selskap per person, innlogging kan mangle for dem som har sluttet) og sertifiseringer med utløpsdato (H5), etter `docs/05-domenemodell.md` avsnitt 4.1. Ferdig når admin har lagt inn Byggcon med selskapene og noen ansatte, og testene for tenant-isolasjon er grønne.

**Oppgave 10 – Roller, rettigheter og grunnlayout.**
> Lag den felles tilgangsmodulen etter rettighetsmatrisen i `docs/05-domenemodell.md` avsnitt 5, med enkeltrettigheter som admin kan gi (for eksempel maltilgang), og grunnlayouten i design A «Fjord» for PC og iPad med tom arbeidskø. Admin skal aldri kunne stenges ute. Ferdig når hver rolle har tester som viser hva den kan og ikke kan, og fase 0 kan demonstreres for Ståle.

## Ved siden av fase 0 og 1

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
