# EzProp – sporbarhet: fra research til plan

Sist oppdatert: 10.11.2026 (flyttet ut av `docs/07-utviklingsplan.md` uten endring i innholdet)

Tabellene viser hvor hvert funn fra researchen og innspillene ble plassert i planen, og hvorfor. Fasenavnene er slik de var da funnet ble plassert. **Endret 10.11.2026:** fase 3 er delt i 3a (piloten) og 3b (kontoret), fase 2a starter med KI-grunnmuren og en smal vei, og KI-funksjonene er flyttet fra «Senere» inn i fasene. Der tabellene sier «fase 3» eller «Senere (KI)», gjelder plasseringen i planen.


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

### Spectora YouTube (`spectora-youtube/spectora-youtube-funn.md`, 09.11.2026)

Gjennomgangen av Spectoras YouTube-kanal (67 videoer) ga funnene V1–V132. De er **forslag, ikke beslutninger**, og ligger i `docs/kartlegging/spectora-youtube/`. Funn som passer et punkt som alt står i planen, har fått en henvisning på punktet («se også Spectora-YouTube …»), uten at punktets omfang er utvidet. Den som tar punktet, leser funnet og avgjør detaljene innenfor punktet. Funn som ville vært nye funksjoner, er **ikke** lagt inn som planpunkter, men står som forslag til Ståle i `docs/09-apne-sporsmal.md` (nr. 41–53). Spørsmålene i kapittel 7 i funn-filen står der som nr. 20–40. Tellingen over (251 funn) gjelder researchen fra oktober og er ikke endret.

| Funn | Kilde (V-nr) | Fase i planen | Kort begrunnelse |
|---|---|---|---|
| Synkoversikt, «synket» bare når serveren har bekreftet, hjelp ved synkfeil | V1, V19 | Fase 1 (synkstatus, prøve A), 2b (synkstatus), 3 (feilsøking) | Detaljer til punkter som finnes. Listen over hvert bilde som venter er forslag nr. 44. |
| Automatisk synk, to samtidig, batteribruk | V2 | Fase 1 (prøve A og B), 2b, 3 | Batteri er en ny ting å måle i prøvene |
| Nattlig nedlasting av kommende oppdrag | V3 | Fase 2b (befaring uten nett) | Detalj til punktet |
| Knapperad per funn, avkryssede funn øverst, TG-knapper i listen, faste navigasjonsknapper, plass til taleknapp | V4, V11, V12, V18, V106 | Fase 2b (iPad-visning) | Færre trykk |
| Søk med filter «uferdig» og «flagget» som sluttsjekk, kontrollvisning | V5, V8 | Fase 2b («Glemt noe?») | Søket som sluttsjekk er forslag nr. 43; kontrollvisning til selger er spørsmål 28 |
| Duplisere seksjon og punkt, angre sletting | V6 | Fase 2a (papirkurv og angre) | Duplisering selv kommer med iPad-visningen |
| Kamera, fast bildeformat, flere bilder til ett funn, internt bevisbilde | V7, V105, V109 | Fase 2b (bilder på befaringen) | Prøve D i fase 1 er levert |
| Statusmerker på oppdragskortet, svar fra bestillingen øverst | V9 | Fase 3 (bestillingsskjema), forslag nr. 53 | Merkene og «Må gjøres» er nye |
| Tegneverktøy, advarsel om TG2/TG3-bilder uten markering | V10 | Fase 2a (bilder på PC, publisering) | Advarsel, ikke sperre |
| «Generelt»-punkt med undersøkelsesmetode, ekte obligatoriske felt | V13, V37 | Fase 2a (malmotoren, kontrollpunkter, publisering) | Obligatoriske felt med tekst er spørsmål 26 |
| Ringe megler fra navnet, nytt fasadebilde, vis neste oppdrag | V14, V15, V17 | Ikke tatt med nå | Liten nytte. Kan tas opp i demoen for fase 2b. |
| Tid inn/ut per oppdrag, kontortid, ukeslogg som nullpunkt | V16, V78 | Fase 2a (tidsmåling, levert), 3 (dashbord, pilotmål), «Ved siden av fase 0 og 1» (nullpunkt) | Spørsmål 29 |
| Forhåndsvalg som må bekreftes | V102 | Fase 2a (malmotoren, publisering) | Spørsmål 34 |
| Funn via søk, tale eller KI gir samme status som via menyen | V103 | Fase 2a (fraser) | Krav til punktet |
| Arbeidsnotat og flagg som stopper «Send» | V104 | Fase 3 (stedsmerker og flagg), forslag nr. 48 | At «Send» stopper, er nytt |
| Begrenset tilgang med bilde som bevis | V107 | Fase 2a (TGIU på kontrollpunktet) | Hurtigvalg er forslag nr. 48 |
| «Opplyst muntlig på befaring» | V108 | Forslag nr. 48 | Ny notattype |
| Test på hver ny iPadOS-versjon | V132 | «Minimum før ekte data» (sperring av iPader), 2b (oppsett) | Risikoen er Safari på iPad |
| Rett i forhåndsvisningen, endringer bare i rapporten | V20, V21 | Fase 2a (rapporten låst til malversjon), forslag nr. 41 | Redigering fra forhåndsvisningen er ny |
| Kopiere og flytte punkt og funn, merke mange fraser samtidig | V22 | Fase 4 (flytting av frasene), 5 (flytte og kopiere), forslag nr. 53 | |
| Bilder i bulk, bildesenter | V23 | Fase 2a (bilder på PC), 3 (bildesenter) | |
| Publisering fra siste lagrede versjon, stopper hvis noe ikke er synket | V24 | Fase 2a (publisering, utgivelser, «Send») | Spørsmål 25 (stopp eller advarsel) |
| Sted som eget felt | V25 | Fase 3 (stedsmerker) | |
| Samme avvik flere steder i ett funn | V26 | Forslag nr. 47 | |
| Fast innledning, sammendrag med TG2 og TG3, tellere og «bare TG3» | V27, V28, V29 | Fase 2a (PDF, sammendrag), 4b (nettrapport), forslag nr. 45 | |
| Varsel når en endring skjuler innhold | V30 | Ikke tatt med nå | Hører til malbyggeren (fase 5) |
| God PDF-forside | V31 | Fase 2a (PDF) | |
| Video i PDF som lenke | V32 | Fase 2a (PDF under 8 MB), Senere (video) | Bare hvis video tas med |
| Egne kategorier for etterkontroll | V33 | Senere (etterkontroll), fase 4 (reklamasjonsmappe) | |
| Maler og regler etter byggeår, følgefraser | V34, V36 | Fase 2a (regelmotoren), forslag nr. 47 | Bare forslag, aldri TG |
| Rydd frasebanken med KI før piloten, forklaringer til funn som ofte misforstås | V35 | Fase 2a (systemmalen) | Spørsmål 23 og 40 |
| Ny frase fra iPad merket «ny, ikke gjennomgått» | V38 | Fase 2a (fraser) | Spørsmål 27 |
| KI foreslår svaralternativer, undervalg som setter sammen tekst | V39, V116 | Senere (KI til å redigere maler) | |
| Ekstern faglig gjennomgang av malen | V40 | Fase 2a (fagrådet godkjenner) | Spørsmål 32 |
| Versjoner av maler som tåler mange endringer, visningsnavn | V41, V42 | Fase 5 | |
| Fraser i regneark til språkvask | V43 | Fase 2a (regneark inn og ut) | |
| KI-funksjonene (velger fra godkjente fraser, viser det den ikke finner, samlet godkjenning, kilde, testoppsett, prøve med takstmenn) | V44–V50, V52–V54, V59 | Senere (KI-funksjoner, evalueringssett) | Krok for opptak og transkripsjon er forslag nr. 42 |
| Andre KI-ideer (typeskilt, gangrekkefølge, andre skjema, meldingsutkast, telefonvakt, hjelp i appen, visittkort) | V51, V55–V58, V60, V118 | Senere, ikke ført inn | KI sender og avtaler aldri selv |
| Hendelsestabell og internt API | V61 | Fase 0b (hendelsesloggen, levert) | Internt API er spørsmål 22 |
| Innkommende dokumenter kobles til oppdrag | V62 | Senere (e-post blir ordreforslag, A1) | |
| Daglig e-post til takstmannen | V63 | Fase 3 (daglig oppsummering) | |
| Ferdig utfylte rutiner, betingelser, varsel ved feil oppsett, meldinger til megler, klager uten autosvar | V64–V68, V119, V127 | Fase 3 (hendelser og handlinger, de seks rutinene) | |
| Søk i regellisten, regler som lesbare setninger | V69, V120 | Fase 3 (hendelser og handlinger) | |
| Kategori på tjeneste, felt for oppdragsgiver, fast definisjon av tellende oppdrag | V70, V74, V124 | Forslag nr. 52 (kroker i datamodellen), fase 3 (bestillingsskjema, dashbord) | |
| Kalender med varsel i stedet for sperre, utkast til bestilling, kapasitet | V71, V77 | Fase 3 (kalender og kapasitet, dashbord) | |
| Serviceområde per ukedag, kjørelengde i eksport, SMS ved ubesvart anrop | V72, V121, V122 | Senere (kjøreplan, SMS) | |
| Meglerside | V73 | Fase 4b (meglerstatus) | |
| Deling av rapportdata bare med samtykke | V75 | Ikke tatt med nå | Regel for når deling eventuelt bygges |
| MCP med bare lesing for egne ledere | V76 | Senere (API og MCP) | |
| Andel meglere som bestiller igjen, meglermerker | V79, V123 | Fase 4 (fullt CRM) | Ingen nivåer eller belønning |
| Månedsprognose, prisoversikt for næring | V80, V81 | Senere | |
| Kø «venter på leder» | V82 | Fase 3 (oppgaver) | |
| Ordliste IVIT → EzProp, oppstartsløp, hjelpekanal | V83, V93, V94 | Fase 3 (hjelp i appen), 4 (opplæring) | |
| Uttrekk av IVIT-fraser som kan filtreres og kjøres flere ganger | V84, V85 | Fase 4 (flytting av frasene), forslag nr. 46 | |
| Hva som blir med fra IVIT, arkiv av alle IVIT-rapporter | V86, V87 | Senere (uttrekk fra IVIT) | Spørsmål 24 (undersøke nå) |
| Fast skjæringsdato, systemene side om side | V88, V89 | Fase 4 (regel for pågående oppdrag) | |
| Prøverapport på eget hus, bekymringer, meglerprøve, ikke tving iPad, rolig periode | V90–V92, V95, V96 | Fase 3 (pilotmål), forslag nr. 51 | |
| Skriftlig lovnad om lagring | V97 | «Minimum før ekte data» (intern personvernerklæring) | |
| Ny takstmann skriver sammen med erfaren | V98 | Fase 3 (flere takstmenn, sidemannskontroll) | |
| EzProp-panel | V99 | – | Spørsmål 30 |
| Prøvefunksjoner per bruker, side «EzProp nå» | V100, V101 | Ikke tatt med nå | Kan tas opp før piloten |
| Krav til editorfart med stor rapport | V110 | Forslag nr. 50 | |
| Gamle rapporter kan åpnes etter ny malversjon | V111 | Fase 2a (låst malversjon, utgivelser) | |
| Tiltak med hva, hvem og når; «utbedre» eller «undersøk nærmere» | V112 | Fase 2a (avvikskort, systemmalen, «Handling»-frasene) | Spørsmål 33 og 40 |
| Lesbarhetssjekk uten KI, fagordliste, «sist gjennomgått» på fraser | V113, V114 | Fase 3 (sidemannskontroll), 4b (nettrapport), forslag nr. 49 | |
| Fast skrivemåte for frasetitler | V115 | Fase 2a (fraser), 4 (flytting av frasene) | Spørsmål 35 |
| «Mest brukt» per takstmann | V117 | Fase 2a (fraser) | |
| Alt kunden fikk samlet per oppdrag, henvendelser registrert | V125, V126 | Fase 2a (reklamasjoner, levert), 4 (reklamasjonsmappe) | Krok nå er spørsmål 38 |
| Fast rekkefølge for klagesvar, reklamasjonsbefaring | V128, V129 | Fase 4 (reklamasjonsmappe) | |
| «Kopier slik det vises» | V130 | Senere, ikke ført inn | |
| Henvisning til regelverk på frasen | V131 | – | Spørsmål 39. Beslutningen 24.10.2026 (ingen NS-henvisning i rapportteksten) gjelder til Ståle sier noe annet. |
| Forretning (kapittel 5 i funn-filen) | – | Ikke tatt med i planen | Gjelder Byggcon som bedrift, ikke EzProp |
| Ikke for Norge (kapittel 6: betaling, reparasjonsliste, mersalg, anbefalte håndverkere, publisering fra mobil, KI som sender selv, egne gradnavn) | – | Ikke tatt med | Uavhengighet (§ 1-3), ingen betaling i EzProp, sidemannskontroll før levering, KI sender aldri selv |
