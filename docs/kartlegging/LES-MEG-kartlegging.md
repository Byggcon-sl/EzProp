# Eget rapportsystem – kartlegging av IVIT, Spectora og SmartTakst

Sist oppdatert: 28.10.2026 (hovedmål for utviklingen lagt inn: 50 % mindre tid, halvparten så mange reklamasjoner, KI først; utviklingsoppsett med agentlag og prompten `prompt-ezprop-utvikling-agenter.md`)
Eier: Ståle Limstrand. Arbeidet er gjort av Claude 22.–28.10.2026.
Status: Kartlegging og sidemannskontroll er ferdig. `datamodell.md` og `utviklingsplan.md` er oppdatert med Ståles svar fra 27.10.2026. Utkast, ikke godkjent. **Neste steg:** sette opp repoet `EzProp` og starte fase 0a (se «Neste steg»).

## Hva dette er

Byggcon skal lage sitt eget system for tilstandsrapporter, **EzProp**, som erstatter IVIT. Navnet er ikke lenger et arbeidsnavn (Ståle 28.10.2026). EzProp har eget repo (`Byggcon-sl/EzProp`) og felles innlogging med Optiplan.

Malene kommer fra to kilder:
- **Systemmaler:** lages og vedlikeholdes av Byggcon fra systemsiden, med regler, TG-logikk og versjoner. Tilstandsrapporten er den første og viktigste.
- **Egne maler:** lages av de ansatte i **en visuell malbygger**, slik at de kan lage mange spesialtilpassede rapporttyper selv.

## Beslutninger

[Kilde: Ståle]

| Dato | Beslutning |
|---|---|
| 22.10.2026 | **Forskriften** bestemmer hva som skal undersøkes. **NS 3600** brukes for TG-vilkårene. V1 bygges etter forskriften. Flere NS-regler kan legges til senere. |
| 22.10.2026 | IVIT er mønsteret for rapportinnholdet. **Ved uenighet mellom IVIT og NS 3600:2025 følger vi NS 3600.** Spectora er inspirasjon for CRM, automatisering, maler, smarte funksjoner og KI. |
| 23.10.2026 | **Bygget for samarbeid fra bunnen**, ikke én og én takstmann. Flere selskaper, mange ansatte, deling av oppdrag og fraser. Se `grunnmur-samarbeid-og-flere-selskaper.md`. **Presisert 25.10.2026:** intern bruk først (se egen rad). |
| 23.10.2026 | **Utstedende selskap** er der ansvarlig takstmann er ansatt. Sertifisering hører til personen, ansvarsforsikring til selskapet. Hvert selskap har sin egen eAccounting-klient. Hver ansatt er ansatt i ett selskap. |
| 23.10.2026 | **Alt skjer i nettleseren** – ingen egen app. Bekreftet 27.10.2026 (spørsmål 25). |
| 23.10.2026 | **Befaring uten nett er et krav.** Data lagres lokalt og synkroniseres automatisk. Presisert 25.10.2026 i tre nivåer (se egen rad). |
| 23.10.2026 | **Konstruksjoner får to visninger av samme data:** iPad for befaring og PC for kontoret. Bekreftet 25.10.2026: IVITs iPad-app er lik nettversjonen, og det er en dårlig løsning. |
| 23.10.2026 | **Kostnad ved TG3:** IVITs fem intervaller brukes foreløpig, pluss mulighet for **fritt beløp** og **forklarende kostnadstekst** med fraser. ~~Fritt beløp vises avrundet som «ca.» (25.10.2026).~~ **Endret 27.10.2026:** Eget beløp rundes ikke av automatisk. Det gis advarsel hvis det ikke er rundet av til minst nærmeste 10 000 (se rad 27.10.2026). |
| 23.10.2026 | **Levetider og radon:** etter NS 3600:2025 (radon-tiltaksgrense 100 Bq/m³). El-forhold får ikke TG. |
| 23.10.2026 | **Avvikstekster:** Claude lager Byggcons egne tekster med egne formuleringer. Det startes med **10 prøveeksempler for kalibrering** før resten lages. |
| 23.10.2026 | **Hendelser og handlinger** («når X skjer → gjør Y») er en kjernefunksjon. Brukes også til levering til megler. |
| 23.10.2026 | **Oppdragsgiveravtaler** (som Fremtind) kan ha egne maler, sjekklister, priser og rutiner. Første versjon: egen rapportprofil og premissetekst per avtale. Egne kontrollpunkter senere (25.10.2026). |
| 23.10.2026 | **Ingen egen avtale med Kartverket.** Data som krever avtale hentes eventuelt via **Eiendomsverdi** eller **PropCloud**. Åpne kilder brukes ellers. |
| 24.10.2026 | **Norsk marked, ikke amerikansk.** I Norge er det oftest **megler som engasjerer takstmann før salget**. Oppdragsgiver er megler eller selger, og kjøper får rapporten via megler. |
| 24.10.2026 | **Ingen betaling i EzProp.** Byggcon fakturerer **megler eller selger etter at rapporten er levert**, via API til Visma eAccounting. Rapporten låses ikke bak betaling. |
| 24.10.2026 | **Utskiftbare integrasjoner.** Faktura, regnskap, betaling og eiendomsdata kobles til via et eget lag med tilkoblinger («adaptere»), slik at Byggcon ikke bindes til én leverandør. |
| 24.10.2026 | **Design:** Retning A «Fjord», **luftig også på PC**. Skjulte hurtigtaster er med. Mangler før levering vises som et lite merke. Ingen kompakt visning nå. Mørk visning er et valg. Se `design-retninger.md`. |
| 24.10.2026 | **Språk i avvikstekster:** Ingen gjetteord («antas», «antar», «antagelig»). Skriv om det vi ser. Er noe ukjent: skriv det, hvorfor, og hvilken risiko det gir. Flere tiltak per avvik er tillatt. |
| 24.10.2026 | **NS-henvisninger står ikke i rapportteksten.** Bekreftet 25.10.2026: Det er heller ingen automatisk kildelinje ved TG2 på grunn av alder. **Premisseteksten henviser til standarden, og det holder.** Grenseverdiene følger standarden, og kilden ligger i bakgrunnen i regelen. *(Sidemannskontrollen mente NS 3600 tillegg C.1 krever kilde i rapporten. Byggcon har vurdert det og valgt premisseteksten.)* |
| 24.10.2026 | **Kostnad:** Normalt bare ett anslag. Den faste forklaringen (overslag, ikke tilbud, basert på det man visste på befaringsdagen) står i premissene. Kostnadstekst per avvik er valgfri. |
| 24.10.2026 | **Fraser er åpne for alle ansatte**, med endringslogg og mulighet for å gå tilbake. **Retten til å endre kontrollpunkter, spørsmål og regler i systemmalene tildeles personer i admin-innstillingene** (25.10.2026). Hver endring i struktur blir en ny malversjon. |
| 24.10.2026 | **IVITs egne fraser hentes ut** og tas med i EzProp (gjort 24.10.2026, se under). |
| 24.10.2026 | **Levering:** Rapporten sendes til megler som **vedlagt PDF**. **Faktura sendes manuelt** etter kontroll, og mottaker (megler, selger eller selgers representant) velges fritt. Automatisk faktura kan komme senere. |
| 24.10.2026 | **Første automatiske rutiner:** velkomst-e-post til selger ved booking, befaringstidspunkt til megler, påminnelse dagen før, rapport til kunde, rapport til megler, og spørreundersøkelse til selger. **E-post holder**, og den sendes via Microsoft 365 som i Optiplan. Velkomst-e-posten kan ha en del som fungerer som ordrebekreftelse (25.10.2026). **Presisert 27.10.2026:** rutinene kan justeres av admin, og hver takstmann kan lage egne. Spørreundersøkelsen lages i EzProp (ikke Microsoft Forms). Rettet rapport sendes manuelt. |
| 24.10.2026 | **KI:** KI lager utkast, takstmannen godkjenner. KI setter aldri TG og sender aldri noe selv. Krav til KI-leverandør: databehandleravtale, EU/EØS og ingen trening på våre data. Tale til tekst kjøpes som ferdig tjeneste (25.10.2026). Ståle drøfter logging med de ansatte. |
| 24.10.2026 | **iPad Pro med wifi og 5G** brukes av alle. Drift uten nett er for kjellere og grisgrendte strøk. |
| 24.10.2026 | **Eiendomsverdi og PropCloud** er fremtidig utvikling. Ståle kontakter dem. Eier, byggeår og areal registreres for hånd i starten (25.10.2026). |
| 24.10.2026 | **Fraser i IVIT** forbedres og utvides i et eget arbeid. Se mappen `03 Arbeidsmappe/2026-10-24 Fraser i IVIT (SL)/`. |
| 25.10.2026 | **Intern bruk først.** EzProp skal brukes internt i Byggcon. Salg til andre takstfirma legges lenger bak. Arkitekturen beholder organisasjons-ID på alle data, men ingen salgsfunksjoner bygges nå. |
| 25.10.2026 | **Beta holdes smal på funksjoner, men research og planlegging går bredt.** Full selskapsstruktur (organisasjon → selskap → ansatte) er med fra start. **Det viktigste er at datamodellen er riktig fra start.** |
| 25.10.2026 | **Målene for den ferdige løsningen er retningsgivende, ikke absolutte.** Se «Målgang» under. |
| 25.10.2026 | **Ingen tidsfrist fra IVIT.** Byggcon har løpende avtale med IVIT og betaler for bruk. Uttrekk av gamle rapporter og bilder fra IVIT kan vente. |
| 25.10.2026 | **To slags maler:** (1) **Systemmaler** lages og vedlikeholdes av Byggcon fra systemsiden, med regler, TG-logikk og versjoner. Tilstandsrapporten er den første. (2) **Egne maler** lages av ansatte i en **visuell malbygger** med tekstfelt, avkrysningsbokser, bildefelt og spørsmål med svar, og kan bli hundrevis av spesialtilpassede rapporttyper. Malbyggeren kommer **i tillegg til** systemmalene. Begge bygger på samme datamodell. |
| 25.10.2026 | **Volum:** ca. **2000 rapporter per år**, med **15–50 bilder per rapport**. Ca. **60 % er leiligheter**, så **eierform og fellesdeler må være med fra start**. |
| 25.10.2026 | **Hulltaking nektet av eier gir TGIU**, med risikovurdering og beskrivelse (følger NS 3600). Erstatter regelen om TG2. |
| 25.10.2026 | **Publisering:** De 7 kravene fra forskriften gir en sperre: obligatorisk del uten TG, TG2/TG3 uten årsak og konsekvens, TG3 uten kostnad, våtrom eller rom under terreng uten hulltaking eller begrunnelse, BRA mangler, el-vurdering mangler, og befaringsdato mangler. **Den ansatte kan overstyre ved å krysse bort advarselen aktivt.** Det logges. **Mangelen kommer tilbake ved ny versjon** hvis den ikke er rettet. Andre mangler gir vanlig advarsel. |
| 25.10.2026 | **Fra NS 3600 i rapporten:** utgaven av standarden og en oversikt over dokumentasjon er med fra start. Kompetansebeskrivelse, utkast til eier, og lyd og støy kommer senere. |
| 25.10.2026 | **Loft uten adkomst gir TG2**, med unntak for nyere konstruksjoner der det ikke er meningen at man skal komme inn (NS 3600). |
| 25.10.2026 | **Uten nett, tre nivåer:** én takstmann uten nett **må** virke. Flere i samme rapport med nett **bør** virke. Flere uten nett kommer senere. |
| 25.10.2026 | **Sidemannskontroll:** Kravet settes per ansatt (f.eks. nyansatte). Krav per rapport kan komme senere. **Presisert 27.10.2026:** manglende sidemannskontroll gir bare advarsel, og sidemannen kommenterer og godkjenner, men retter ikke. |
| 25.10.2026 | **Innlogging:** samme løsning som Optiplan (engangskode på e-post). Microsoft-innlogging og tofaktor kommer senere. |
| 25.10.2026 | **Bestilling fra meglersystem** registreres for hånd i starten. API kommer senere. |
| 25.10.2026 | **Oppbevaring:** Rapporter, bilder og måledata beholdes i minst 10 år, i låst versjon per utgave. Presisert for originalbilder 27.10.2026 (se egen rad). |
| 25.10.2026 | **Personvern:** Byggcon eier arbeidet, med Ståle som daglig leder. |
| 25.10.2026 | **Utvikling** gjøres som i Optiplan: Claude-prosjekt, én oppgave per tråd, pull requests, og Ståle godkjenner. Ingen henvendelse til Standard Norge, fordi Byggcon har kjøpt standarden. |
| 25.10.2026 | **Innspillene er vurdert og tatt inn** (Ståle: «ta de med – analyser innholdet og se om det er gode innspill»). Tekniske rettinger og «kroker» er lagt inn i `datamodell.md`. Ny rekkefølge, «minimum før ekte data», fase 2 delt i 2a/2b, fagrådet som egen oppgave, PDF under 8 MB og hullene fra funksjonskartet er lagt inn i `utviklingsplan.md`. ~~Fase 4b «Kundesiden» og strekkmålene er forslag som Ståle avgjør.~~ **Avgjort 27.10.2026:** fase 4b godkjent. Ettårs-oppfølging, samspill med Optiplan og samme-dag-rapport er tatt ut. |
| 27.10.2026 | **Gyldig til (spørsmål 1):** Rapporten er gyldig **ett år fra befaringsdato**, slik IVIT gjør. Ståle svarte først «første rapportdato», men endret det samme dag. Ikke lenger et åpent spørsmål. |
| 27.10.2026 | **Eierform og boligtype (spørsmål 2):** Claudes lister er godkjent: eierform (selveiet, eierseksjon, borettslagsandel, aksjeleilighet) og boligtype (inkl. leilighet i tomannsbolig uten sameie, våningshus og annet). |
| 27.10.2026 | **Fagrådet (spørsmål 3):** **Ståle er fagrådet alene** fram til EzProp er i produksjon. «Fagrådet godkjenner» betyr Ståle godkjenner. Ingen faste møter. |
| 27.10.2026 | **Reklamasjoner (spørsmål 4):** registreres med et enkelt skjema fra første ekte rapport. |
| 27.10.2026 | **Sidemann (spørsmål 5):** Manglende sidemannskontroll gir **bare advarsel**, ikke sperre. Sidemannen **kommenterer og godkjenner, men retter ikke**. Bare den som signerer, endrer rapporten. |
| 27.10.2026 | **«Handling»-frasene fra IVIT (spørsmål 6):** importeres som tiltak. Feltet kan hete «Konsekvens/tiltak», slik IVIT gjør nå. |
| 27.10.2026 | **Kostnad (spørsmål 7):** De fem intervallene beholdes. I tillegg kan takstmannen skrive et **eget beløp i stedet for intervall**. Beløpet rundes **ikke** av automatisk. Det gis **advarsel** (ikke sperre) hvis beløpet ikke er rundet av til minst nærmeste 10 000 (f.eks. 37 500). **Endrer** raden 23.10.2026 om avrundet «ca.»-beløp. |
| 27.10.2026 | **Regler i egne maler (spørsmål 8):** **TG-logikk bare i systemmalen for tilstandsrapport.** Egne maler kan ha andre regler, logikk og sjekker. |
| 27.10.2026 | **Kalibrering per takstmann (spørsmål 9):** ja, men senere. Ikke i betaen. |
| 27.10.2026 | **Originalbilder (spørsmål 10):** avviksbilder i original i 10 år, andre originaler i 2 år, komprimert i 10 år. **Alle tidene er innstillinger.** Lagringen legges bak et adapterlag, slik at bildene senere kan flyttes til et lokalt arkiv hos Byggcon. |
| 27.10.2026 | **Hvem ser og endrer hva (spørsmål 11):** Alle takstmenn ser alle oppdrag og alle data, også kontaktopplysninger. **Foreløpig kan alle takstmenn også endre alt.** Det strammes inn hvis det blir et problem. Tilgangen styres av en rolle eller innstilling, og revisjonsloggen viser hvem som endret hva. |
| 27.10.2026 | **Fakturagrunnlag (spørsmål 12):** alle takstmenn kan sende fakturagrunnlag. |
| 27.10.2026 | **Oppdragsstatus (spørsmål 13):** fire statuser til å begynne med: **bestilt, under arbeid, ferdig, fakturert**. Flere kan legges til senere. Kansellering løses med myk sletting. |
| 27.10.2026 | **Automatiske rutiner (spørsmål 14):** Påminnelsen er en justerbar rutine. **Admin og hver takstmann kan lage og justere egne rutiner.** **Spørreundersøkelsen lages i EzProp**, med spørsmål og svar i databasen (ikke Microsoft Forms). Rettet rapport sendes **manuelt** av den ansvarlige. |
| 27.10.2026 | **Små tall (spørsmål 15):** 14 dager på iPaden etter levering, sertifiseringsvarsel 60 og 14 dager før, advarsel over 80 bilder. Alt er innstillinger. |
| 27.10.2026 | **iPad-styring (spørsmål 16):** ingen Intune nå. Kode, Face ID og sperring i EzProp. Intune vurderes senere. |
| 27.10.2026 | **Det kartleggingen ikke dekker (spørsmål 17):** ingenting nytt. |
| 27.10.2026 | **Rapporttyper (spørsmål 18):** Alle IVITs rapporttyper skal over etter hvert, pluss nye. Rekkefølgen tas senere. **Tillegg samme dag:** «De færreste tilstandsrapportene har verdi.» Verdidel og markedsverdi er **ikke et krav for produksjon** og blir liggende i «Senere». Rapporter med markedsverdi lages i IVIT til verdidelen finnes. |
| 27.10.2026 | **Kundesiden (spørsmål 19):** fase 4b kommer etter produksjon og før malbyggeren. |
| 27.10.2026 | **CRM (spørsmål 20):** adressebok med tall i fase 4. **Fullt CRM kommer rett etter**, ikke langt ute i «Senere». **Endrer** planen. |
| 27.10.2026 | **Ettårs-oppfølging (spørsmål 21):** **Nei.** Tatt ut av planen og strekkmålene. |
| 27.10.2026 | **Integrasjoner (spørsmål 22):** Byggcon bruker **Enova (energimerking)** og **Polycam** (3D-skanning og plantegning). API mot begge skal undersøkes. DIAKRIT og Boligpass tas ikke med. |
| 27.10.2026 | **Optiplan (spørsmål 23):** **Ingen samspill med Optiplan foreløpig.** Tatt ut som mål. Felles innlogging gjelder fortsatt. |
| 27.10.2026 | **Samme-dag-rapport (spørsmål 24):** ikke et mål. |
| 27.10.2026 | **App-skall (spørsmål 25):** «Alt i nettleseren» står. LiDAR kan i stedet komme via Polycam. |
| 27.10.2026 | **Byggcon som datakilde (spørsmål 26):** statistikk holdes internt. Vurderes igjen etter 2–3 år. |
| 27.10.2026 | **Beta, pilot og måling (spørsmål 27):** **bare Ståle** i beta og tidsmåling foreløpig. Flere takstmenn velges før piloten. |
| 27.10.2026 | **Retningen (spørsmål 28):** «IVITs innhold, Spectoras drift og SmartTaksts beste detaljer, pluss TG-forslag fra regler» er godkjent. |
| 27.10.2026 | **Reklamasjonssaker (tillegg):** Bare leder og admin ser reklamasjonssaker. Dette er et unntak fra «alle takstmenn ser alt». |
| 27.10.2026 | **Merket «Rettet» (tillegg):** En rapport som er rettet og sendt på nytt, får merket «Rettet» under statusen «Ferdig». |
| 28.10.2026 | **Hovedmål for utviklingen** (kilde: Ståle i chat 28.10.2026): Med EzProp 2.0 skal takstingeniørens hverdag effektiviseres med **50 %** (målt mot dagens IVIT), og antall **reklamasjoner skal halveres**. EzProp lages med **«KI først»** («AI-first»). Hovedmålet er overordnet. De andre målene i «Målgang» er fortsatt retningsgivende. Se «Målgang». |
| 28.10.2026 | **Utviklingsoppsett med agentlag** (kilde: Ståle i chat 28.10.2026): EzProp utvikles av et **agentlag**. **Lederne** bruker Fable 5.1: prosjektleder, arkitekt og databasedesigner, fagansvarlig, UX, UI, KI-ansvarlig, test-leder, feilrettingsleder, sikkerhet og personvern, og **forenkler** (rollen er med). **De som koder** bruker Opus 5.5: utvikler, testskriver og retter. Se `prompt-ezprop-utvikling-agenter.md`. |
| 28.10.2026 | **Utviklingen går av seg selv** (kilde: Ståle i chat 28.10.2026): agentene lager PR-er, og **Ståle merger og ruller ut selv**. ~~**Høyst 3 PR-er venter på Ståle om gangen.**~~ **Endret 28.10.2026 (Ståle i chat, senere samme dag): ingen grense.** Løkken fortsetter uansett hvor mange PR-er som venter, og bygger oppgaver oppå PR-er som ikke er merget når det trengs. |
| 28.10.2026 | **Ingen kostnadstak** (kilde: Ståle i chat 28.10.2026): utviklingen stopper når kvoten er brukt opp, og fortsetter når det er kvote igjen. |
| 28.10.2026 | **Kjøring i skyen** (kilde: Ståle i chat 28.10.2026): som Optiplan, med rutiner. Hovedløkken kjører **annenhver time**, og en **nattløkke** kjører hver natt. |
| 28.10.2026 | **Testmiljø i Azure og samspill med Optiplan** (kilde: Ståle i chat 28.10.2026): EzProp kjører i **samme Azure-miljø som Optiplan**, med testmiljø for prøving på iPad fra fase 1. **Felles innlogging og felles profil for admin og ansatte** i begge løsningene. **Kundene holdes adskilt.** Etter hvert skal løsningene lenkes sammen slik at man bytter sømløst. Presiserer raden 27.10.2026 (spørsmål 23). |
| 28.10.2026 | **Navn** (kilde: Ståle i chat 28.10.2026): målet heter fortsatt **«EzProp 2.0»**. Produktet heter **«EzProp»**, og navnet er **ikke lenger et arbeidsnavn**. |

Alle svar står i `svar-fra-stale-2026-10-23.md`, `svar-fra-stale-2026-10-24.md`, `svar-fra-stale-2026-10-25.md` og `svar-fra-stale-2026-10-27.md`. Radene fra 27.10.2026 har kilde `svar-fra-stale-2026-10-27.md`. Radene fra 28.10.2026 har kilde Ståle i chat 28.10.2026.

## Målgang (oppdatert 28.10.2026)

### Hovedmål (Ståle 28.10.2026)

> «La oss gi utviklingen ett mål: Med EzProp 2.0 skal vi effektivisere takstingeniørens hverdag med 50 % (målt mot dagens IVIT) – samt halvere antall reklamasjoner mot oss i ettertid. Vi har kun sett begynnelsen av hva KI kan hjelpe oss med i arbeidshverdagen – og EzProp skal være laget med "AI-first"-tankegangen.»

Hovedmålet er **overordnet**. Det har to tallmål og ett prinsipp:

1. **50 % mindre tid per rapport** enn i IVIT.
2. **Halvparten så mange reklamasjoner** som før EzProp.
3. **KI først:** EzProp lages med «AI-first»-tankegangen.

**Slik måles det** (Claudes forslag – Ståle bekrefter):
- **Tid:** samlet tid per rapport (forberedelse, befaring, kontorarbeid og levering), per rapporttype. Nullpunktet er Ståles tidsmåling i IVIT (10 oppdrag). Den bør utvides til flere oppdrag og flere rapporttyper, slik at nullpunktet blir sikkert. EzProp måler tiden automatisk fra hendelsesloggen og arbeidsøktene (`datamodell.md` 4.13).
- **Reklamasjoner:** antall reklamasjoner og krav per 100 leverte rapporter, og beløp. Nullpunktet er de siste 3 årene før EzProp. Tallene må hentes fra Byggcons egne oversikter eller fra ansvarsforsikringen (åpent spørsmål). Reklamasjoner registreres i EzProp fra første ekte rapport, slik at tallene kan sammenlignes. Fordi reklamasjoner kommer lenge etter levering, måles dette målet over flere år.

**«KI først» som prinsipp** (Claudes forslag – Ståle bekrefter):
- For hver ny funksjon spør vi først: kan KI gjøre dette, eller forberede det, slik at takstmannen bare kontrollerer og godkjenner?
- Takstmannen har alltid siste ord og signerer. KI foreslår, men publiserer aldri selv.
- Data lagres strukturert og med kilde, slik at KI kan bruke dem.
- All KI-bruk logges med kostnad (`ai_usage_log`), slik at nytten kan måles.
- Reklamasjonene kobles til kontrollpunktene, slik at KI kan varsle om risikopunkter.

**Hva er «EzProp 2.0»?** Ikke avklart (åpent spørsmål). Claudes forslag: versjonen som er i full drift for alle takstmenn, med mål om ca. 12 måneder etter produksjonsstart.

### Retningsgivende mål (25.10.2026, oppdatert 27.10.2026)

Disse målene er fortsatt **retningsgivende, ikke absolutte**. De støtter hovedmålet.

**Overgang fra IVIT:** EzProp er i mål når Byggcon kan gå over fra IVIT uten å miste noe takstmennene, kontoret eller meglerne trenger, og tilstandsrapportene lages raskere og like trygt som i dag.

Mål vi strekker oss etter:
1. Rapporttypene Byggcon trenger kan lages i EzProp, enten som systemmal eller med malbyggeren. Tilstandsrapporten kommer først. Verdidel (markedsverdi) er ikke et krav for produksjon.
2. Rapportene oppfyller forskriften og NS 3600:2025 for TG. Fagrådet har godkjent malen, tekstene og reglene. **Fagrådet er Ståle alene fram til produksjon.**
3. Krav fra forskriften gir sperre som bare kan overstyres med vilje. Alt annet gir advarsel med logg.
4. En hel befaring kan gjøres på iPad uten nett, uten at noe går tapt.
5. Tiden fra befaring til levert rapport er minst like kort som i IVIT, og helst kortere. **Det er ikke et mål å levere samme dag.** (Hovedmålet fra 28.10.2026 er 50 % mindre samlet tid per rapport.)
6. Sidemannskontrollen gjøres i EzProp, med logg (advarsel, ikke sperre).
7. Bestilling inn og rapport ut til megler fungerer.
8. Fakturagrunnlag går til eAccounting for alle tre selskapene.
9. De seks automatiske rutinene virker.
10. Gamle rapporter og bilder fra IVIT kan søkes fram (når det blir aktuelt).
11. Personvern, sikkerhetskopi, tofaktor og oppbevaring i minst 10 år er på plass.
12. Alle ansatte har fått opplæring og bruker EzProp for nye oppdrag.

**Beta og tidsmåling:** bare Ståle foreløpig. Flere takstmenn velges før piloten.

**Etapper (detaljert i `utviklingsplan.md`):** 0a Repo og database → 1 Prøve uten nett på iPad → 0b Innlogging, organisasjon og roller → Minimum før ekte data → 2a Rapporten på PC → 2b Befaringen på iPad → 3 Pilot → 4 Produksjon (med adressebok og deretter fullt CRM) → 4b Kundesiden → 5 Malbygger → Senere. Ved siden av fase 0 og 1: fagråd runde 1 (Ståle), måling i IVIT (Ståle), prøve av eAccounting og undersøkelse av API-ene til Enova og Polycam.

**Strekkmål:** den lukkede sløyfen (reklamasjoner og utfall, sammenligning ved neste takst) og kost per rapport. **Ettårs-oppfølging og samspill med Optiplan er tatt ut** (Ståle 27.10.2026). Se `moonshots-ezprop-2026-10-25.md`.

## Teknisk løsning for drift uten nett (forslag, endelig valg tas i fase 1)

Se `datamodell.md` avsnitt 4.11 og `utviklingsplan.md` fase 1. Kort:
1. **PWA:** Appen legges på hjemskjermen på iPad Pro og starter uten nett.
2. **Lokal lagring først:** Oppdrag lastes ned før befaring.
3. **Synkronisering per felt:** Tekst slås sammen automatisk. For TG, valg og målinger vinner siste endring, med varsel.
4. **Bilder:** lastes opp i bakgrunnen mens appen er åpen.
5. **Synkstatus:** alltid synlig.

**Kandidater å teste:** PowerSync, ElectricSQL og en enkel egen løsning.

## Integrasjonslag (forslag)

EzProp snakker aldri direkte med en leverandør. Kjernen bruker faste «porter», og hver leverandør er en egen tilkobling (adapter) bak porten:

- **Faktura og regnskap:** fakturautkast som sendes manuelt, og status (sendt, betalt). Første tilkobling er Visma eAccounting.
- **Betaling (senere, valgfritt).**
- **Eiendomsdata:** manuell registrering først. Eiendomsverdi eller PropCloud senere.
- **Meglersystemer:** manuell ordre først. Bestilling inn og rapport ut via API senere.
- **E-post** via Microsoft 365 (SMS senere).
- **Bildelagring** (27.10.2026): bak eget lag, slik at bilder senere kan flyttes til et lokalt arkiv hos Byggcon.
- **Energimerking (Enova) og 3D-skanning/plantegning (Polycam)** (27.10.2026): API-ene undersøkes først. Kobles til senere.

## Fraser i IVIT (eget arbeid fra 24.10.2026)

- **Mappe:** `03 Arbeidsmappe/2026-10-24 Fraser i IVIT (SL)/`. Start med `LES-MEG.md` og `Fraseregister-IVIT-forklaring.md`.
- **Fasit for frasene:** `Fraser-IVIT-analyse-2026-10-25 13 (2).xlsx` (versjon 13), fanen «Fraseregister».
- **Må rettes etter beslutningen 25.10.2026:** fraser som gir TG2 når eier nekter hulltaking, skal gi TGIU. `Fraseregister-IVIT-forklaring.md` sier fortsatt TG2.
- **Antall:** sidemannskontrollen fant ulike tall (1057 og 1333). Det må rettes.
- **Første uttrekk fra Claude 24.10.2026** ligger i undermappen `EzProp-kartlegging/excel/`.
- IVITs og Smarttakst sine tekster brukes bare til sammenligning, og skal ikke kopieres.
- **«Handling»-frasene** importeres som tiltak (Ståle 27.10.2026).

## Filene

| Fil | Innhold |
|---|---|
| **`datamodell.md`** | **Én datamodell for systemmaler og egne maler**: organisasjon og rettigheter, parter, ordre, status og hendelser, eiendom med eierform og fellesdeler, malmotor og regler, rapport og avvik, bilder, rutiner, faktura, drift uten nett, enheter og varsler, kroker for senere funksjoner (avsnitt 4.13), ordliste og åpne spørsmål. Oppdatert med Ståles svar 27.10.2026. |
| **`utviklingsplan.md`** | **Fasene 0a → 1 → 0b → 2a → 2b → 3 → 4 → 4b → 5 → Senere**, med punkter som kan krysses av og «ferdig når», minimum før ekte data, mål, måling i piloten, risiko, strekkmål, **sporbarhet for 251 funn** og de første oppgavene. Oppdatert med Ståles svar 27.10.2026. |
| **`prompt-ezprop-utvikling-agenter.md`** | **Prompten som starter den selvgående utviklingen av EzProp** i skyen (28.10.2026): mål, regler, agentlaget (10 ledere på Fable 5.1, 3 som koder på Opus 5.5, med forenkler), løkkene (hovedløkke annenhver time og nattløkke), høyst 3 PR-er som venter på Ståle, ingen kostnadstak, PR-mal og første kjøring (fase 0a). Ståle merger og ruller ut selv. |
| **`svar-fra-stale-2026-10-27.md`** | **Ståles svar på de 28 samlede spørsmålene** (Word-filen «EzProp – samlede spørsmål 25.10»), med beslutning per spørsmål, tillegget om verdi og de tre bekreftelsene fra samme dag. |
| `analyse-ivit-leilighetsrapport-2026-10-27.md` | Analyse av en ekte IVIT-leilighetsrapport (uten personopplysninger): oppbygging, verdidel (markedsverdi, teknisk verdi, fellesgjeld), feil EzProp bør hindre, og forslag til regler og PDF-profil. Forslagene er ikke vedtatt. |
| `innspill-datamodell-og-plan-2026-10-25.md` | Innspill D1–D18 og P1–P15 til datamodell og plan. Tatt inn 25.10.2026. |
| `funksjonskart-ezprop-2026-10-25.md` | 14 funksjonsområder: hva IVIT har, hva Spectora og SmartTakst gjør bedre, og hva EzProp må ha. 12 hull (H1–H12), tatt inn i planen. |
| `funksjonalitet-ki-og-fremtid-2026-10-25.md` | KI og avanserte funksjoner i tre horisonter, samspill med Optiplan, og styring av KI. Kroker og KI-rekkefølge er tatt inn. Samspill med Optiplan er tatt ut som mål 27.10.2026. |
| `moonshots-ezprop-2026-10-25.md` | Funksjoner ingen har i dag: den lukkede sløyfen, befaring, produktet, organisasjonen og fag. Fem strekkmål og kroker. Kroker er tatt inn, strekkmål står i «Senere». Ettårs-oppfølging og Optiplan-oppslag er tatt ut 27.10.2026. |
| `svar-fra-stale-2026-10-23.md` | Ståles svar på 23 spørsmål |
| `svar-fra-stale-2026-10-24.md` | Ståles svar på 32 spørsmål (avvikstekster, maler, levering, KI) |
| `svar-fra-stale-2026-10-25.md` | Ståles svar på 31 spørsmål etter sidemannskontrollen |
| `kravdokument.md` | **Historisk** (22.10.2026). Beslutningene her og `datamodell.md` / `utviklingsplan.md` går foran. |
| `grunnmur-samarbeid-og-flere-selskaper.md` | Organisasjon → selskap → person, oppdragsteam, felles kø, bibliotek, deling (rettet 25.10) |
| `anbefalte-funksjoner.md` | Det beste fra IVIT og Spectora, fordelt på beta, pilot, produksjon og senere (rettet 25.10) |
| `design-retninger.md` | Tre designretninger og valgt design (A, luftig). Skisser i `EzProp-kartlegging/design/` og på https://claude.ai/artifact/P4nHnGEeo4TmPbkksJcpPU |
| `ki-funksjoner.md` | 15 KI-funksjoner fra markedet som kan bygges inn |
| `regelverk-krav.md` | Forskriften, TG-vilkår, levetider, publiseringssperre og kontroller (rettet 25.10) |
| `eiendomsdata-api.md` | Åpne kilder og leverandører (Eiendomsverdi, PropCloud) |
| `kartlegging-kontrollpunkter.md` | Alle **40** faste kontrollpunkter og kjøkken (tallet rettet 25.10) |
| `kartlegging-bad.md` | Våtrom i detalj |
| `kartlegging-rapport-og-oppdrag.md` | Rapportdeler, verktøylinje, validering, PDF, oppdragsside, statusmodell |
| `ivit-detaljer.md` | IVITs profil, innstillinger, menyer, integrasjoner og svakheter |
| `prompt-ny-chat-fraser-ivit.md` | Prompten som startet frasearbeidet |
| `spectora-analyse.md` / `spectora-test.md` / `spectora-detaljer.md` | Spectoras hjelpesenter, test i prøvekonto og småfunksjoner |
| `spectora-maler-og-forslag-malsystem.md` | Spectoras maler, og forslag til malsystem i EzProp |
| `spectora-advanced-automatisering.md` | Automatiseringsmotoren og forslag til «hendelser og handlinger» |
| `spectora-advanced-test.md` | Advanced testet i praksis 24.10.2026 |
| `spectora-ko-oppgaver-sms.md` | Kø per oppdrag, oppgaver og SMS-innboks (24.10.2026) |
| `smarttakst-analyse.md` | Norsk konkurrent SmartTakst (24.10.2026) |
| `prompt-sidemannskontroll-kartlegging.md` | Oppgaven til den uavhengige sidemannskontrollen |
| `sidemannskontroll-kartlegging-2026-10-25.md` | **Sidemannskontroll del 1:** regelverk, motsigelser, risiko og prøveeksemplene |
| `sidemannskontroll-kartlegging-2026-10-25-del2-programvare.md` | **Sidemannskontroll del 2:** programvaren |
| `EzProp-kartlegging/` | Arkiv fra Claude-økten: Excel-uttrekk, Word-filer med spørsmål og svar, designskisser og fullstendige rapporter fra hjelpeagentene |

**Avvikstekster:** `01 Kunnskapsbase/09 Innsamling (ikke godkjent)/1 Til godkjenning/2026-10-23 Claude – Avvikstekster, 10 prøveeksempler.md`. Skrevet om 25.10.2026 etter sidemannskontrollen. Ståles svar ligger nederst.

## Neste steg

1. **De 28 samlede spørsmålene er besvart** (27.10.2026) og ført inn her, i `datamodell.md` og i `utviklingsplan.md`. Se `svar-fra-stale-2026-10-27.md`. **De tre små bekreftelsene nederst i svarfilen er også avklart samme dag:**
   - gyldig til regnes fra befaringsdato
   - alle takstmenn kan endre alt foreløpig
   - eget kostnadsbeløp rundes ikke av automatisk, men gir advarsel hvis det ikke er rundet av til minst nærmeste 10 000
2. **Ved siden av fase 0 og 1 (kan starte nå):**
   - fagråd runde 1 med Ståle (grenser, prøveeksempler, kontrollpunkter for leilighet og fellesdeler, og de tre fagspørsmålene fra leilighetsanalysen)
   - Ståle noterer tid i IVIT på 10 oppdrag, og tidsmålingen utvides til flere oppdrag og rapporttyper, slik at nullpunktet for hovedmålet blir sikkert (28.10.2026)
   - hente tall for reklamasjoner og krav de siste 3 årene (nullpunkt for hovedmålet, 28.10.2026)
   - prøve av eAccounting i sandbox
   - undersøke API-ene til Enova og Polycam
3. **Avvikstekster:** Ståle svarer på lengde, tone og varianter (spørsmål 1, 3 og 6 fra 24.10).
4. **Frasearbeidet:** rette TG for hulltaking nektet (TGIU), og rette antallet fraser.
5. **Sette opp repoet `EzProp` og starte fase 0a** med de første oppgavene i planen. Gjøres ved å starte en ny sesjon i skyen med `prompt-ezprop-utvikling-agenter.md` (28.10.2026).
6. **Spectora Advanced:** Slås av før ca. 23.11.2026 (Billing → Spectora Advanced → Disable Advanced).

## Testdata

- **IVIT:** Oppdrag [oppdragsnr fjernet] (Ståles bolig) beholdes for videre testing.
- **Spectora (prøvekonto, fiktive data):** Alt beholdes (Ståle 24.10.2026):
  - Testmalene «EzProp TEST - Vatrom (Claude)» og «Imported from XLS – 10/24/2026».
  - Automatiseringene TEST A, B og C.
  - Merket «Aktiv selgermegler (TEST)».
  - Dashbordet «TEST megleroversikt».
  - Kontoransatt «Siri Kontor (TEST)» og oppgave nr. 77565.
  - Én testinspeksjon.
- **SmartTakst (Ståles brukerkonto):** Oppdraget [Ståles testadresse] (Ståles eget hus) er status «Under arbeid» og har et utkast med fiktive avvik i rundt 20 bygningsdeler. **Byggeåret 1978 er fiktivt.** Ingenting er ferdigstilt eller betalt.
- Passordene til IVIT, Spectora og SmartTakst byttes når testingen er ferdig.
