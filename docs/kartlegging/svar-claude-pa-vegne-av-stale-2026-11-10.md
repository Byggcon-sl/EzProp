# Åpne spørsmål om EzProp – besvart av Claude på oppdrag fra Ståle 10.11.2026

Sist oppdatert: 10.11.2026
Status: **Til gjennomgang.** Svarene er Claudes, ikke Ståles egne. Ståle kan endre hva som helst.

[Kilde: Ståle i chat 10.11.2026: «Ut fra det du vet om meg, hva jeg har svart før, Byggcon og de andre programvarene, prøv å besvare de åpne spørsmålene etter beste evne. La kun de helt kritiske stå åpne.»]

## Slik er svarene laget

Hvert svar bygger på noe Ståle har bestemt før. Mønsteret i svarene hans 23.–27.10 og 28.10–04.11.2026 er:

- Hold det enkelt og smalt i betaen. Ting kan bygges ut senere.
- Advarsel med logg, ikke sperre. Bare forskriftens krav sperrer, og sperren kan overstyres aktivt.
- Åpent for alle ansatte først. Stram inn hvis det blir et problem.
- Alle tall og tider er innstillinger.
- Det som kan gi færre reklamasjoner eller mindre tid, går foran. KI foreslår, takstmannen godkjenner.
- Fagstoff godkjennes av fagrådet (Ståle alene fram til produksjon).

Numrene under er numrene i `docs/09-apne-sporsmal.md` i repoet `Byggcon-sl/EzProp`.

---

## 1. Fortsatt åpent – bare Ståle kan gjøre dette

Dette er ikke spørsmål lenger, men ting som stopper arbeidet til Ståle har gjort dem. Viktigst først.

| # | Hva | Hvorfor det haster |
|---|---|---|
| K1 | **Testmiljøet i Azure:** lag ressursgruppen, legg Azure-nøklene og de fire e-post-nøklene inn som secrets i GitHub, og pek `ezprop-test.byggcon.no` dit (nr. 6). Oppskrift: `docs/drift/testmiljo-azure.md`. | Har stått siden 28.10. Uten dette kan ingenting prøves på ekte iPad. |
| K2 | **Prøve A og B på ekte iPad, og godkjenn ADR 0004** (egenbygd synk). Deretter prøve C, D og F. | Valget av synkløsning er foreløpig. Fase 2b bygger på det. |
| K3 | **Fagråd runde 1:** godkjenn levetider og målegrenser (nr. 13), stilen på avvikstekstene (nr. 1) og de tre fagforslagene i del 4. | Fagstoff kan ikke brukes i ekte rapporter før du har godkjent. Alt lages som utkast imens. |
| K4 | **Én henvendelse til ansvarsforsikringen** (per selskap): antall krav og beløp de siste 3 årene (nr. 2), hvordan tidlig melding virker, og om dokumenterte rutiner gir bedre vilkår (nr. 37). Dan-Børge kan sende den. | Nullpunktet for målet om halvparten så mange reklamasjoner. |
| K5 | **Legg inn tallene fra tidsmålingen i IVIT** (10 oppdrag) på `/statistikk/tid`. | Nullpunktet for målet om 50 % mindre tid. |
| K6 | **Felles innlogging med Optiplan:** gi tilgang til Optiplan-oppsettet, og bekreft om Optiplan bruker nøkkelboks (Key Vault). | Siste punkt i fase 0b. |
| K7 | **Folk** (før fase 3, haster ikke): hvem er med i piloten og panelet (nr. 30), og hvem er ansvarlig for overgangen fra IVIT (nr. 36). Forslag står i del 2. | Bare du kan velge personer. |

**To ting du bør vite om:**

- **Repoet `Byggcon-sl/EzProp` er offentlig på GitHub.** Det kunne leses uten innlogging 10.11.2026. Der ligger blant annet beslutninger, kartleggingen av IVIT, Spectora og SmartTakst, og navn på ansatte. Er det meningen? Hvis ikke: gjør repoet privat under Settings → General → Danger Zone.
- **Spectora Advanced** må slås av før ca. 23.11.2026 (Billing → Spectora Advanced → Disable Advanced).

---

## 2. Spørsmål til Ståle (nr. 1–40) – svar

| Nr | Spørsmål | Svar | Grunnlag |
|---|---|---|---|
| 1 | Avvikstekster: lengde, tone, varianter | **Lengde:** korte. Én til to setninger per felt (beskrivelse, årsak, konsekvens, tiltak). **Tone:** «bør» ved TG2 og «må» ved TG3. «Snarest» brukes bare når det gjelder sikkerhet eller en skade som pågår. **Varianter:** én grunntekst med flettefelt for materiale, sted og måleverdi. Egen variant bare når årsak eller tiltak er forskjellig. Tekstene er fortsatt utkast til fagrådet har godkjent dem (K3). | Ståle 24.10 (skriv om det vi ser, ingen gjetteord, flere tiltak, kostnadstekst valgfri). Enkelt og konkret språk. |
| 2 | Nullpunkt for reklamasjoner | Tallene hentes fra ansvarsforsikringens skadehistorikk per selskap, supplert med egne saker. Se K4. | Bare forsikringen og Ståle har tallene. |
| 3 | Hva betyr «EzProp 2.0» i tid, og hvordan måles målene | Som foreslått: EzProp 2.0 er versjonen som er i full drift for alle takstmenn. Målene måles 12 måneder etter produksjonsstart. Tid måles som samlet tid per rapport per rapporttype. Reklamasjoner måles per 100 leverte rapporter, over flere år. | Forslaget har stått uimotsagt siden 28.10. |
| 5 | Excel-faner som er for store | Ikke nødvendig nå. Fasiten for frasene er versjon 13 av fraseregisteret fra frasearbeidet, ikke det første uttrekket. Resten av de to fanene hentes når importen av IVIT-fraser bygges (fase 4). | LES-MEG: «Fasit for frasene: … versjon 13». Spørsmålet var ikke blokkerende. |
| 6 | Adresse og e-post i testmiljøet | Adresse: `ezprop-test.byggcon.no`. E-post går via Optiplans Microsoft 365-oppsett fra start. Selve oppsettet er K1. | Ståle 24.10: e-post sendes via Microsoft 365 som i Optiplan. |
| 8b | GPS i originalbildene | Behold posisjonen i originalen i lagringstiden. Den vises aldri i rapport, PDF eller visningskopi. Innstilling for å slå det av. | Posisjonen er boligens adresse, som alt står i rapporten. Originalen er bevis ved reklamasjon. |
| 9 | Tilgang til `rg-ezprop-test` | Bare Ståle. | Anbefalingen fra sikkerhet og personvern. |
| 12 | Slå på synktjenestene (700–850 kr/md) | Nei. Bare hvis egenbygd synk ikke holder i prøve A og B. | ADR 0004. Ingen kostnader uten grunn. |
| 13 | Levetider og målegrenser | (a) Levetider og grenser tas fra NS 3600:2025, og fra Byggforsk der standarden ikke har tall. Kilden står i bakgrunnen. (b) Ståle bekrefter dem som fagråd (K3). (c) Følg standardens ordlyd per grense. Der den ikke sier noe, regnes «lik grensen» som nådd. Regelen foreslår bare TG. | Ståle 23.10 (levetider etter NS 3600:2025) og 27.10 (fagrådet). Forsiktig side gir færre reklamasjoner. |
| 14 | Delt iPad: hvem står for endringer som venter | Køen sendes bare av den som gjorde endringene. Logger en annen inn på samme iPad, får han varsel om at det ligger usynkede endringer fra en kollega. | Sporbarhet for rapporten som signeres. Alle har egen iPad, så dette skjer sjelden. |
| 15 | Tellere for innloggingssperren | Slettes etter 24 timer. | Agentenes forslag. Ikke fagdata. |
| 16 | Hemmeligheter ved flere organisasjoner | Prefiks per organisasjon i navnet. Bygges først når en organisasjon nummer to skal inn. | Intern bruk først (25.10). |
| 17 | Tøm iPaden ved utlogging | Ja. Tøm når alt er synket. Er noe ikke synket, vises varsel og ingenting tømmes. | Agentenes forslag. Personvern på mistet iPad. |
| 18 | Innloggingstabellene | (a) Ja, økter og koder kan slettes helt. (b) Utløpte koder ryddes etter 24 timer og utløpte økter etter 30 dager. | Samme unntak som nr. 15. |
| 19 | Statusflyt | (a) Alle med rett til å endre oppdrag kan gå et steg tilbake. Det logges. (b) «På vent» blir ikke egen status. Det er et merke på oppdraget. | Ståle 27.10: alle kan endre alt foreløpig, og fire statuser. |
| 20 | De 26 eldre Spectora-videoene | La dem ligge. | Forslaget. |
| 21 | Ny prioritet i videooversikten | Godtatt. | Gjelder bare oversikten i SharePoint. |
| 22 | Internt API nå | Nei. Hendelsesloggen er levert. API bygges når første eksterne kobling (meglersystem) kommer. | Hold det enkelt. |
| 23 | Rydde fraser med KI før piloten | Ja. Claude lager forslag i frasearbeidet, Ståle godkjenner. Piloten skal ikke starte med rotete fraser. | Frasearbeidet er i gang siden 24.10. |
| 24 | Undersøke hva IVIT kan gi ut | Ikke nå. Tas opp når piloten starter. | Ståle 25.10: ingen tidsfrist fra IVIT, uttrekk kan vente. |
| 25 | Skal «Send» stoppe når noe ikke er synket | Ja, som sperre som kan overstyres aktivt, med logg. Knappen viser hva som venter. | Samme mønster som de 7 forskriftskravene (25.10). En rapport uten alle bildene gir reklamasjonsrisiko. |
| 26 | Ekte obligatoriske felt i fase 2a | Ja, for «hva er undersøkt og hvordan» på de obligatoriske punktene. Mangler gir advarsel, ikke sperre. | Ståle 24.10: kontroller stopper ikke publisering. |
| 27 | Nye fraser fra iPad | Rett inn i frasebanken, men merket «ny, ikke gjennomgått», så fagrådet får en liste. Ingen godkjenning kreves. | Ståle 24.10: fraser er åpne for alle, uten samtykke. |
| 28 | Kontrollvisning på befaring | Bare for takstmannen. Den vises ikke til selger. | Foreløpige vurderinger til selger skaper forventninger og kan gi klager. |
| 29 | Tid inn/ut og kontortid | Ingen manuell stempling. Tiden måles automatisk fra arbeidsøktene, som nå. Kontortid måles på samme måte når kontoret begynner å bruke EzProp i piloten. | Enkelt, og drøftingen med de ansatte gjelder én måte å måle på. |
| 30 | EzProp-panel | Ja, fra piloten: én takstmann per selskap og Dan-Børge fra kontoret. Takstmennene er de samme som er med i piloten. Hvem: K7. | Dan-Børge er kontorleder. |
| 31 | Meglerundersøkelse | Ja, kort (fem spørsmål), før piloten. Kan slås sammen med kundeintervjuene til ScaleUp. | Meglerne er kundene. Gir nullpunkt. |
| 32 | Ekstern gjennomgang av malen | Ikke før piloten. Vurderes før produksjon. | Ståle 27.10: Ståle er fagrådet fram til produksjon. |
| 33 | Dele tiltaksfeltet i hva, hvem og når | Nei. Feltet er «Konsekvens/tiltak» som i IVIT. Frasene skrives etter mønsteret hva–hvem–når i teksten. | Ståle 27.10 (spørsmål 6). |
| 34 | Forhåndsvalg i malen | Ja, men bare for beskrivende tekst. Aldri for avvik, tiltak eller TG. Forhåndsvalgte tekster må bekreftes før «Send» (advarsel). | Sparer tid uten at et avvik blir «krysset av» ved en feil. |
| 35 | Skrivemåte for frasetitler | Ståle bestemmer som fagråd. Claude foreslår regelen «objekt – avvik» i frasearbeidet. Klar før importen i fase 4. | Fagstoff. |
| 36 | Ansvarlig for overgangen fra IVIT | Én samlet ansvarlig, med én kontaktperson per selskap. Forslag: Dan-Børge. Bekreftes av Ståle (K7). | Én ansvarlig er enklest. |
| 37 | Spørre forsikringsselskapet | Ja. Samme henvendelse som nr. 2 (K4). | – |
| 38 | Reklamasjonskobling i datamodellen nå | Ja. Koblingen oppdrag → henvendelse/reklamasjon → ny befaring lages sammen med reklamasjonsskjemaet (før første ekte rapport). | Ståle 27.10: reklamasjoner registreres fra første ekte rapport. |
| 39 | Henvisning til TEK, NS eller Byggforsk på frasene | Nei i rapportteksten. Kildefeltet i bakgrunnen finnes alt. | Ståle 24.10 og 25.10. |
| 40 | Skille «utbedre» og «undersøk nærmere» | Ja, som et valg på tiltaket. Forklaringer til funn som ofte misforstås, tas i fagråd runde 2 etter piloten. | Billig nå. Hjelper kjøper og KI. |

---

## 3. Forslagene nr. 41–53 – ja eller nei, og når

Ja betyr at forslaget kan føres inn i planen i den fasen som står. Ingenting flyttes foran det som alt står i gjeldende fase.

| Nr | Forslag | Svar | Fase |
|---|---|---|---|
| 41 | Rette rapporten fra forhåndsvisningen. Endringer gjelder bare rapporten til de lagres til malen. | Ja | 3 |
| 42 | KI velger bare fra godkjente fraser og lager aldri ny tekst for å fylle hull. Krok: taleopptak og bilder i kø uten nett. | Ja | Kroken i 2b, resten med KI-trinnene |
| 43 | Søk med filter «uferdig» og «flagget» uten nett | Ja, som del av «Glemt noe?» | 2b |
| 44 | Synkoversikt med liste per bilde, «Synk alt» og rødt tall | Ja | 2b |
| 45 | Lettlest rapport | Tellere for TG3, TG2 og TGIU og fast innledning i PDF-en: ja. Knappen «bare TG3» og sammendraget: ja. | 2a og 4b |
| 46 | Import av IVIT-fraser som kan filtreres og kjøres flere ganger, med rapport | Ja | 4 |
| 47 | Informasjonstekst ut fra byggeår, følgefraser, og ett funn med flere steder | Byggeår-regel og funn med flere steder: ja. Følgefraser: senere. | 2a, følgefraser senere |
| 48 | Dokumentasjon på stedet | Internt bevisbilde, hurtigvalg «begrenset tilgang» og notattypen «opplyst muntlig»: ja. Arbeidsnotat på flaggede funn: ja, men flagg gir advarsel, ikke stopp. | 2b |
| 49 | Lesbarhetssjekk og «sist gjennomgått» på frasen | Feltet «sist gjennomgått» med eier: ja, som krok nå. Lesbarhetssjekken: ja. | Krok i 2a, sjekken i 3 |
| 50 | Krav til fart og prøve med stor rapport | Ja | 2a |
| 51 | Fast løp for overgangen fra IVIT | Ja. Skrives inn i fase 3 og 4 som plan, ikke kode. | 3 og 4 |
| 52 | Kroker: kategori på tjenesten, fast felt for oppdragsgiver, fast definisjon av hva som teller | Ja, alle tre | 2a |
| 53 | Statusmerker og «Må gjøres» på oppdragskortet, kopiere og flytte funn, merke mange fraser | Kopiere og flytte funn: ja. Statusmerker og «Må gjøres»: ja. Merke mange fraser: ja. | 2a, 3 og 4 |

---

## 4. Til fagrådet – forslag (ikke godkjent)

Dette er fagstoff. Det gjelder ikke før Ståle har godkjent det som fagråd (K3). Forslagene må kontrolleres mot standarden og forskriften før godkjenning.

| Spørsmål | Forslag |
|---|---|
| Kan «tilliggende konstruksjoner våtrom» få TG0 når badet er ca. 20 år og membranen får TG2 for alder? | Nei. TG0 hører til nye bygningsdeler med dokumentasjon. Er hulltakingen tørr og uten avvik, gis TG1. |
| Skal radon-HMS gjelde leiligheter som ikke ligger mot grunnen? | Spørsmålet stilles for boliger med oppholdsrom i de tre laveste etasjene over bakken. For leiligheter høyere opp settes «ikke aktuelt» automatisk, med begrunnelse. |
| Skal røykvarsler og slukkeutstyr være egne punkter i leilighetsmalen? | Ja, to egne punkter under brann, slik forskriften lister dem. |

---

## 5. Åpne spørsmål om planen og fra kunnskapsbasen

| Spørsmål | Svar |
|---|---|
| Hvem er med i piloten? | Minst tre takstmenn, én per selskap. Ståle velger (K7). |
| Forslagene fra leilighetsanalysen (27.10) | **Ja:** advarsel når ventilasjon er beskrevet ulikt, kommentar ved ny versjon (advarsel), og de tre endringene i PDF-profilen. **Senere, sammen med verdidelen:** fellesgjeld, felleskostnader, forretningsfører som påkrevd felt, markedsverdi og sammenlignbare salg. Grunnlag: Ståle 27.10, verdi er ikke krav for produksjon. |
| Enova og Polycam | Agentene undersøker API-ene først. Tilkobling avgjøres etterpå. Ikke noe Ståle må svare på nå. |
| Hvilke tre meglersystemer? | Fortsatt ukjent. Ikke kritisk, fordi ordre registreres for hånd i starten (25.10). Avklares før API-arbeidet. |
| Åpne API-er for matrikkel- og risikodata | Besvart i `eiendomsdata-api.md` (23.10): Kartverkets adresse- og eiendoms-API, NVE, NGU radon, støy, Miljødirektoratet, Riksantikvaren og DiBK er åpne. Eier, byggeår og BRA krever leverandør. |
| Felles innlogging med Optiplan | Besvart 28.10. Det tekniske venter på K6. |

**Spørsmålene om Byggcon fra Spectora-videoene.** Dette kunnskapsbasen alt svarer på:

| Spørsmål | Svar fra kunnskapsbasen |
|---|---|
| Termografi som egen tjeneste? | Står ikke på tjenestelisten (byggcon.no, 17.10.2026). |
| Radonmåling eller andre tjenester direkte til privatkunder? | Radonmåling står ikke på listen. Verditakst, energiattest, overtakelse og rådgivning selges til private. |
| Overtakelse eller ettårsbefaring av ny bolig? | Overtakelse og forhåndsbefaring: ja, med fast pris. Ettårsbefaring står ikke på listen. |
| Registreres kjøring, og brukes den i fakturagrunnlaget? | Kjøring faktureres (minstesats 480 kr, over 20 km etter avtale). Hvordan den registreres, er ikke kjent. |
| Henvisning til TEK eller Byggforsk i rapportene? | Ikke ønsket i rapportteksten (Ståle 24.10 og 25.10). |
| Hvem styrer oppdatering av iPadOS? | Hver takstmann. Ingen Intune nå (Ståle 27.10). |
| Hvordan bestiller meglerne? | Gjennom meglersystemene («alle 3», 24.10) og booking på nettsiden. Andelen av hver er ikke kjent. |

De andre spørsmålene i den listen (kontortid per oppdrag, rolig periode per selskap, klagerutiner, oppstartssamtale med selger, video på befaring, detaljer om IVIT-frasene og flere) stopper ingenting i EzProp. De samles og tas med panelet og meglerundersøkelsen før piloten, og de om forsikring tas i K4.

---

## 6. Hva som ikke er endret

- Beslutningstabellen i `LES-MEG.md` er ikke endret. Den har bare Ståles egne beslutninger. Svarene her flyttes dit når Ståle har sett gjennom dem.
- Ingen fagtekster eller grenser er tatt i bruk.
