# Sidemannskontroll av kartleggingen for EzProp

Sist oppdatert: 25.10.2026
Status: **Utkast – ikke godkjent**
Utført av: Claude som uavhengig sidemann, på oppdrag fra Ståle Limstrand (`prompt-sidemannskontroll-kartlegging.md`).

**Kilder (lest 25.10.2026):**
- Hovedmappen: `LES-MEG.md`, `kravdokument.md`, `regelverk-krav.md`, `svar-fra-stale-2026-10-23.md`, `svar-fra-stale-2026-10-24.md`, `grunnmur-samarbeid-og-flere-selskaper.md`, `anbefalte-funksjoner.md`, `ki-funksjoner.md`, `design-retninger.md`, `eiendomsdata-api.md`, `kartlegging-kontrollpunkter.md`, `kartlegging-bad.md`, `kartlegging-rapport-og-oppdrag.md`, `ivit-detaljer.md`, `smarttakst-analyse.md`, `spectora-advanced-test.md`, `spectora-maler-og-forslag-malsystem.md`.
- Frasearbeidet: `2026-10-24 Fraser i IVIT (SL)/LES-MEG.md`, `Fraseregister-IVIT-forklaring.md`, Excel versjon 13 (fanen «Til IVIT» er lest i detalj, de andre fanene bare oversikten).
- Til godkjenning: `2026-10-23 Claude – Avvikstekster, 10 prøveeksempler.md`, `2026-10-25 Claude – Kontroll av fraser mot forskrift og NS 3600.md`.
- NS 3600:2025+AC:2026 (`Kunnskapsmappen/NS3600/NS3600-2025+AC_2026.pdf`): innhold, pkt. 10–14, A.2.1.7–A.2.1.9, A.2.7, A.2.14, A.2.15, A.3.18.1–A.3.18.2 og tillegg C. Ingen tekst er kopiert.
- Forskrift til avhendingslova: lovdata.no lot seg ikke hente direkte. Forskriftsteksten er lest slik den er gjengitt i kursiv i NS 3600:2025+AC:2026 (§ 2-2, § 2-9, § 2-10, § 2-14, § 2-18, § 2-20, § 2-21, § 2-22, § 2-23, § 1-6) og via `regelverk-krav.md`.
- Nett: Norsk takst (norsktakst.no, overgang til NS 3600:2025 fra 1.7.2026) og Standard Norge (lanseringsmøte 10.3.2026). Et kort søk etter andre norske verktøy ga ingen nye sikre treff utover det som alt er nevnt i mappen.
- Kunnskapsbasen: `00-LES-MEG-FORST.md`, `99-apne-sporsmal.md`.

**Avgrensning:** Jeg har ikke logget inn i IVIT, Spectora eller SmartTakst. De fullstendige rapportene fra hjelpeagentene (undermappen `EzProp-kartlegging/`, som i prompten kalles `EzProp-kartlegging-arkiv/`) er ikke lest, bare sammendragene. Der jeg er usikker, står det som spørsmål.

---

## 1. Kort oppsummering – de viktigste funnene

| # | Alvor | Funn |
|---|---|---|
| 1 | **Kritisk** | **«Eier nekter hulltaking gir TG2» strider mot NS 3600:2025.** A.2.1.8 gir TGIU når hulltaking ikke er utført og årsaken er oppgitt. IVITs nye mal (v27) gjør det samme. Byggcons egen regel er «ved uenighet følger vi NS 3600». Prøveeksempel 5B bruker TGIU, frasearbeidet bruker TG2. Dette må avgjøres én gang, og begrunnes hvis Byggcon velger å avvike. |
| 2 | **Kritisk** | **Publiseringsregelen er ført som beslutning, men ikke bekreftet, og er ufullstendig.** `svar-fra-stale-2026-10-24.md` (nr. 21) sier «Ståle må bekrefte dette». `LES-MEG.md` fører det som vedtak. I tillegg er «tiltak» et krav i NS 3600 pkt. 13, ikke i forskriften § 2-22, mens flere ekte forskriftskrav (TG på alle obligatoriske deler, BRA fordelt, el-vurdering, begrunnet unntak fra hulltaking) ikke står på listen over det som stopper. |
| 3 | **Kritisk** | **«Ingen NS-henvisning i rapporten» kolliderer med NS 3600 tillegg C.1 og pkt. 14.2.** Når alderstabellene brukes til TG2, skal rapporten vise hvor alderskriteriet er hentet fra og angi kriteriet konkret. Rapporten skal også si hvilken årsversjon av NS 3600 som er brukt. Automatisk TG-forslag fra alder er EzProps viktigste nye funksjon, så dette må løses i rapportmalen. |
| 4 | **Kritisk** | **V1 uten avtale om eiendomsdata er et skritt tilbake fra IVIT.** `kravdokument.md`, `anbefalte-funksjoner.md` (V1) og NS 3600 pkt. 14.3 forutsetter eier, byggeår, bygninger og BRA. `eiendomsdata-api.md` viser at de åpne kildene ikke gir dette. Enten må V1 ha en betalt kilde (Eiendomsverdi, PropCloud eller Ambita), eller så må alle godta manuell registrering. |
| 5 | **Kritisk** | **Overgangen fra IVIT er ikke planlagt.** IVITs lisens sier at dataene blir iVerdis eiendom. Historiske rapporter, «kopier data fra tidligere rapport», «forhåndsutfylling fra tidligere rapport» og reklamasjonssaker (5 års reklamasjonsfrist etter avhendingslova) forutsetter tilgang til gamle rapporter og bilder. Det finnes ingen plan for uthenting før oppsigelse. |
| 6 | **Viktig** | **Frasene er bygget for IVITs struktur, ikke EzProps.** 201 tiltak i 50-serien er koblet til IVITs låste avvik ved navn. Disse avvikene finnes ikke i EzProp (de kan ikke kopieres). Feltet «Handling» slår sammen konsekvens og tiltak, mens EzProp har årsak, konsekvens og tiltak hver for seg. Excel v13 har ikke kobling til EzProps kontrollpunkt-ID-er. |
| 7 | **Viktig** | **Flere i samme rapport uten nett er flyttet til V1 i `grunnmur…md`, men står som «Senere» i `anbefalte-funksjoner.md`.** Synkroniseringsmodellen (Yjs, PowerSync, ElectricSQL) er ikke testet. Dette er den største tekniske risikoen og bør avgjøres med en prototype før noe annet bygges. |
| 8 | **Viktig** | **Byggcon må avgjøre om rapporten skal være «etter forskriften» eller «etter NS 3600».** Lyd og støy (12.8), dokumentasjonstabell (tabell 1, 14.4 e), kompetansebeskrivelse (14.2), utkast til eier (14.5) og egenerklæring som vedlegg (14.1) er NS-krav. Fremtind sitter i NS-komiteen, og meglere og boligselgerforsikring forventer trolig NS 3600-rapporter. Spørsmålet er ikke besvart. |
| 9 | **Viktig** | **«Erstatte IVIT» krever mer enn tilstandsrapport.** IVIT brukes til 9 rapporttyper, ordre fra meglersystem med tilbakeføring (aktivert, 40 kr/rapport), ordrebekreftelse, kalender, kunderegister (1296), energimerking og teknisk verdi/markedsverdi. Flere av disse står som V2 eller «Senere». IVIT kan ikke sies opp før alt Byggcon faktisk bruker er på plass. |
| 10 | **Viktig** | **Flere dokumenter sier ulike ting om samme sak** (antall kontrollpunkter 47/37/40, antall fraser 1057/1333, person i flere selskaper, godkjenningsflyt for fraser, automatiske meldinger V1/V2, krypkjeller TGIU). Se tabellen i del 3. |

---

## 2. Funn per kontrollområde

### 2.1 Regelverket

#### 2.1.1 Dekker kravdokumentene det forskriften krever?

**Funn R1 – Viktig.** `regelverk-krav.md` avsnitt 1 gir en god oversikt over § 2-1 til § 2-23. Dette mangler eller er svakt:
- **Befaringen.** Det står ingen krav til hva som skal registreres om selve befaringen: dato, hvem som var til stede, værforhold og snø (gir TGIU), hvilke rom og flater som var tilgjengelige, og hva eier ble spurt om (§ 2-5, § 2-7, § 2-10, § 2-18 og § 2-19 krever at eier spørres). NS 3600 pkt. 14.2 krever befarings- og rapporteringstidspunkt. Forslag: egen del «Befaring» i datamodellen med tilstedeværende, forhold, spørsmål til eier og svar.
- **Egenerklæring.** NS 3600 pkt. 14.1 krever kopi som vedlegg, og 14.4 f) krever at vesentlige forskjeller mellom analysen og egenerklæringen, eller manglende egenerklæring, går fram. `kravdokument.md` krav 6 sier «rapporten kan ikke ferdigstilles uten egenerklæring». Det er et NS-krav, ikke et forskriftskrav, og det kolliderer med publiseringsregelen (se R3). Forslag: felt «egenerklæring mottatt / ikke mottatt» + fritekst om avvik, med advarsel, ikke stopp.
- **Dokumentasjon.** NS 3600 tabell 1 lister dokumentasjon som skal legges fram (tegninger, ferdigattest, FDV, våtromsdokumentasjon, samsvarserklæring, el-tilsyn). 14.4 e) krever oversikt over det som er lagt fram og det som mangler. Dette er bare delvis dekket (våtrom og el). Forslag: en dokumentasjonstabell i datamodellen, med status per dokument, som også styrer TG0 (krever dokumentasjon) og lovlighet (pkt. 10).
- **Takstmannens kvalifikasjoner og uavhengighet.** § 1-3 og NS 3600 pkt. 4 og 14.2 (beskrivelse av kompetanse). `grunnmur…md` har sertifisering per person, men ingenting om hvordan uavhengighet dokumenteres per oppdrag (f.eks. en avkrysning «ingen tilknytning til selger, megler eller eiendommen»). Forslag: obligatorisk uavhengighetserklæring per oppdrag, lagret med rapporten.
- **Gyldighet.** § 1-6 (maks ett år ved bindende avtale) er med. NS 3600 pkt. 14.5 sier i tillegg at rettinger etter utstedelse beholder opprinnelig dato, og at ny full gjennomgang gir ny dato. `kravdokument.md` krav 10 dekker dette. Bra.
- **Årsversjon av NS 3600.** Pkt. 14.2: rapporten skal vise hvilken årsversjon som er brukt, og befaringsdatoen avgjør. Rapporter befart før 1.7.2026 etter NS 3600:2018 er gyldige til sommeren 2027 (Norsk takst). EzProp V1 trenger ikke støtte 2018-versjonen, men datamodellen må ha feltet «NS-utgave» fra start (det står alt som krav 3 i `kravdokument.md`, men ikke at det skal stå i rapporten).

#### 2.1.2 Stemmer levetider, grenser og TG-regler med NS 3600:2025?

**Funn R2 – Kan vurderes.** Levetidstabellen i `regelverk-krav.md` avsnitt 2 er kontrollert mot tillegg C.2–C.8 og stemmer. To presiseringer:
- C.1 sier at tabellene er veiledende for tiltak og ikke kan brukes som konklusjon om teknisk levetid. Avvikstekstene bør derfor ikke si «har passert forventet levetid» (prøveeksempel 3A), men «alderen gir usikker fremtidig funksjon».
- C.1 sier at ved TG2 ut fra alder skal det angis tiltak, for eksempel nærmere undersøkelser. Prøveeksempel 9A («bør skiftes innen få år») er strengere enn standarden legger opp til.

**Funn R3 – Kritisk. «Eier nekter hulltaking gir TG2».** NS 3600 A.2.1.8 gir TGIU når hulltaking ikke er utført og årsak oppgis, og krever da at skaderisiko og andre observasjoner oppgis. Pkt. 8 i samme punkt krever at våtrommet i stedet fuktkontrolleres med en annen metode. Pkt. 1 krever at eier informeres om utvidet ansvar når eier nekter. Byggcons regel (Ståle 24.10 og 25.10, «som IVIT») gir TG2. Konsekvenser:
- Forskriften § 2-23 sier at kriteriene for TG følger NS 3600. En TG2 der standarden sier TGIU kan bestrides i en reklamasjonssak.
- Prøveeksempel 5B gir TGIU. Frasene K15/K16 gir TG2. Dokumentene er altså uenige.
- Regelen «ikke undersøkt → TG IU som hovedregel» (frasearbeidet 25.10) er på sin side *mildere* enn NS 3600 pkt. 12.2, som sier at TGIU bare brukes unntaksvis når både alder og materiale er ukjent. Dette er alt merket i `Kontroll av fraser…md`, men ikke avgjort.
Forslag: Ståle avgjør om Byggcon følger A.2.1.8 (TGIU) eller avviker bevisst. Uansett må EzProp registrere: årsak til at hull ikke ble tatt, at eier er informert om utvidet ansvar, alternativ fuktkontroll (metode og resultat), skaderisiko og om konstruksjonen er skadeutsatt. Disse fem feltene mangler i datamodellen i `kartlegging-bad.md`.

**Funn R4 – Viktig. Loft og krypkjeller.**
- «Loft uten adkomst gir TG2» stemmer med A.3.18.1, men bare når det mangler dokumentasjon på utførelsen, og det gjelder *ikke* nyere konstruksjoner der tilkomst ikke er tiltenkt (A.3.18.1 pkt. 6). Regelen i frasearbeidet mangler unntaket.
- «Krypkjeller uten adkomst gir TG2» stemmer med A.2.7.1 og tabell 2. Men `regelverk-krav.md` avsnitt 2 sier at TGIU er lov for krypkjeller uten innvendig tilgang. Det stemmer bare når heller ikke utvendig inspeksjon er mulig (normalt snø). Tabellen bør rettes.

**Funn R5 – Kan vurderes. El, radon, rekkverk, lovlighet uten TG.** Stemmer med forskriften § 2-18, § 2-21 og NS 3600 pkt. 12.5 og 12.9. Men pkt. 13 krever at også HMS-punkter får vurdering av avvik, konsekvens og tiltak. EzProps validering bør derfor varsle når et HMS-avvik mangler konsekvens og tiltak. Dette står ikke i `regelverk-krav.md` avsnitt 5.

**Funn R6 – Kan vurderes. Radon 100 Bq/m³.** Stemmer med A.2.14 (anbefalt tiltaksgrense). Standarden sier i tillegg at bolig i NGUs aktsomhetskart «høy» eller «særlig høy» uten måling er et avvik. `eiendomsdata-api.md` planlegger å hente NGU-klassen i V1. Disse to bør kobles: NGU-klasse hentes automatisk og utløser HMS-spørsmålet om radon. Det står ikke i noen av filene.

**Funn R7 – Kritisk. NS-henvisning i rapporten.** Beslutningen 24.10 (nr. 2) sier at NS-henvisninger skal ligge i bakgrunnen. Tillegg C.1 sier at når tabellene brukes, skal det tydeliggjøres i rapporten hvor alderskriteriet er hentet fra, og kriteriet skal angis konkret. Forslag: avvikstekster uten henvisning, men rapportmalen skriver automatisk en kildelinje under avvik som bygger på alder, f.eks. «Alderskriterium: NS 3600:2025 tabell C.4, 18 år». Da holdes teksten ren, og kravet oppfylles.

**Funn R8 – Viktig. Målegrenser må verifiseres.** Prøveeksemplene bruker grensene 15/25/30 mm for skjevhet (eks. 10) og «flere enn 3 punkterte ruter» for TG3 (eks. 6). Disse kommer fra IVIT. Jeg har ikke kontrollert A.2.11.1 og A.3.17.3 i denne gjennomgangen. Før de legges inn som regler i EzProp, bør fagrådet lese punktene og bekrefte grensene, og det bør noteres i regelen hvilket punkt de kommer fra.

#### 2.1.3 Andre lover og regler systemet må følge

**Funn R9 – Viktig.** Følgende er ikke, eller bare så vidt, nevnt i kartleggingen:

| Tema | Hva det betyr for EzProp | Alvor |
|---|---|---|
| **Personvern (GDPR)** | Eier, kjøpesum, bilder med personer og egenerklæring er personopplysninger. Trengs: behandlingsgrunnlag, personvernerklæring, protokoll over behandling, databehandleravtale med drift og KI-leverandør, sletteregler, og trolig en personvernkonsekvensvurdering (DPIA) for KI-bruk på bilder og tekst. `eiendomsdata-api.md` og `grunnmur…md` nevner det, men ingen eier tiltaket. | Viktig |
| **Oppbevaring** | Reklamasjonsfristen etter avhendingslova er 5 år. Foreldelse av erstatningskrav kan gå lenger. Bokføringsloven krever 5 år for fakturagrunnlag. Forslag: rapporter, bilder og måledata beholdes uendret i minst 10 år, med låst versjon per utstedelse. Spørsmålet står alt i `99-apne-sporsmal.md` for SharePoint, men ikke for EzProp. | Viktig |
| **Norsk takst og sertifisering** | IVIT bruker Norsk takst-innlogging og medlemsnummer. Er det krav fra Norsk takst eller sertifiseringsordningen til rapportsystem, rapportmal eller innsending? Ikke undersøkt. | Viktig (spørsmål) |
| **Lisens på NS 3600 i programvare** | IVIT har «NS-abonnement» som integrasjon. Standard Norge krever skriftlig tillatelse for elektronisk bruk. Å legge levetidstabellene (tallverdier) som data er trolig greit, men kriterietekster og «i»-knapp med forskriftstekst er ikke. Bør avklares med Standard Online før utvikling. | Viktig (spørsmål) |
| **Forsikring** | Ansvarsforsikring per selskap er registrert. Stiller forsikringsselskapet krav til rapportformat eller kontrollrutiner? Ikke undersøkt. | Kan vurderes |
| **Registrering og innsending** | § 1-7: DiBK kan kreve fast dataformat. Ståle har svart nei til SN-NSPEK 3477. Risikoen er at et format kommer. Forslag: datamodellen designes slik at den kan eksporteres til 3477 uten ombygging. | Kan vurderes |
| **Energimerking** | IVIT har energimerking som tilleggsfunksjon (Enova-ID). Ikke med i EzProp. Er det en tjeneste Byggcon selger? | Kan vurderes |
| **Universell utforming** | Forskrift om universell utforming av IKT-løsninger gjelder nettløsninger rettet mot allmennheten. Et internt verktøy er unntatt, men kundeportal og offentlig gyldighetsside (SmartTakst-idé) er omfattet (WCAG). | Kan vurderes |
| **Arbeidsmiljøloven kap. 9** | Logging av KI-bruk og endringslogg per ansatt er kontrolltiltak. Nevnt i `ki-funksjoner.md`. Ståle drøfter med ansatte. Bra. | – |
| **E-signering** | Portal med BankID-signering (V2) krever avtale med en signeringsleverandør og vurdering etter esignaturloven. | Kan vurderes |

### 2.2 Fullstendighet i kartleggingen

**Funn F1 – Viktig. Deler av IVIT som ikke er kartlagt.** `kartlegging-kontrollpunkter.md` avsnitt 8 lister det som gjenstår: garasje, fanene Etasjer/Tilbygg/Lovlighet, de øvrige rapportdelene, verktøylinjen og oppdragsfanene. Deler av dette er dekket i `kartlegging-rapport-og-oppdrag.md`, men listen er ikke oppdatert. I tillegg mangler:
- **Rapporttyper:** verditakst, arealmålingsrapport, reklamasjonsrapport, landbruk, fleksibel rapport, energirådgivning. Hvilke bruker Byggcon, og hvor mange per år?
- **Roller og tilganger i IVIT:** kontorbruker, ekstern person, medansvarlig, partneroppdrag, «del alle oppdrag med alle ansatte». Bare delvis beskrevet.
- **Ordre fra meglersystem:** Hvordan ser en ordre ut (felter)? Hva sendes tilbake (PDF, tekstfil, data)? Dette er i bruk i dag og må virke fra dag én hvis IVIT skal sies opp.
- **Godkjenninger-fanen** (sidemannskontroll i IVIT i dag): hvordan brukes den?
- **Revisjoner:** hvordan ser en ny versjon ut i PDF-en, og hva skjer med meglerintegrasjonen ved ny versjon?
- **Statistikk og eksport:** hva tar Byggcon ut av IVIT i dag (Excel-eksport av fakturaer og arkiv)?
- **Oppdragsnummer:** startsekvens per takstmann i IVIT. Skade-Bodø bruker 5-sifret saksnummer fra et annet system (`99-apne-sporsmal.md`). Nummerformatet i EzProp er ikke bestemt.

**Funn F2 – Kan vurderes. Spectora og SmartTakst.** Det meste er vurdert. Det som ikke er tatt stilling til:
- SmartTakst **plantegning med automatisk areal** (lav prioritet). Siden § 2-20 krever BRA etter NS 3940:2023 og areal er en vanlig reklamasjonsgrunn, bør dette vurderes høyere, i det minste som import fra et tegneverktøy.
- SmartTakst **offentlig gyldighetsside med QR** og hendelseslogg. God løsning på § 1-6 (ettårsregelen) som ingen av de andre har. Står som «middels».
- Spectora **API og MCP-kobling** (slik at KI-verktøy kan lese oppdrag). Står som «senere». Bør ligge i arkitekturen fra start, siden Byggcon alt bruker Claude på oppdragsdata.
- Ingen av de tre har **sidemannskontroll som ekte flyt**. EzProps forslag er bra, men bør kobles til `03 Kvalitet og sidemannskontroll` i kunnskapsbasen (sjekklisten der er ennå bare et utkast).

**Funn F3 – Kan vurderes. Andre norske løsninger som bør sjekkes før utvikling.** Et kort søk ga ingen sikre nye treff. Jeg foreslår at disse undersøkes (ikke bekreftet hva de kan):
1. **Pretakst** (Skien) – nevnt i `ki-funksjoner.md`, varslet KI for tilstandsrapport. Hva har de i dag?
2. **Meglersystemene** Byggcon mottar ordre fra (trolig Vitec Next, Webmegler/Meglerfront og ett til) – dokumentasjon på bestillings- og leverings-API.
3. **Boligmappa** – IVIT har tilkobling (ikke aktiv). Dokumentasjon og FDV som eier kan dele med takstmann, nyttig for tabell 1.
4. **Ambita Infoland** – kommunepakke og eiendomsdata, som IVIT bruker i dag. Pris for direkte avtale bør hentes selv om Kartverket-avtale er valgt bort.
5. **Verktøy for plantegning og arealmåling** (f.eks. det SmartTakst bruker, eller frittstående apper) – for § 2-20.

### 2.3 Motsigelser og hull mellom dokumentene

Se tabellen i del 3. De viktigste:

**Funn M1 – Kritisk. Publiseringsregelen.** Se oppsummering nr. 2. Forslag til fullstendig liste over det som stopper publisering (bare forskriftskrav):
1. Et rom eller en bygningsdel som forskriften krever, mangler TG og er ikke merket ikke undersøkt med begrunnelse (§ 2-22, § 2-23).
2. TG2/TG3 mangler årsak eller konsekvens (§ 2-22).
3. TG3 mangler kostnadsanslag (§ 2-22).
4. Våtrom eller rom under terreng mangler både hulltaking og begrunnet unntak (§ 2-2, § 2-15).
5. BRA totalt og fordelt på BRA-i/-e/-b mangler (§ 2-20).
6. El-anlegget mangler vurdering eller opplysning om siste tilsyn (§ 2-18).
7. Befaringsdato mangler (§ 1-6 kan ikke beregnes uten).
Alt annet (tiltak, HMS-konsekvens, egenerklæring, lyd og støy, dokumentasjonstabell, bilder) gir advarsel, med logg når takstmannen publiserer likevel.

**Funn M2 – Viktig. `kravdokument.md` er utdatert, men står som fil nr. 3 i leselisten.** Det sier blant annet: integrasjon med matrikkel/grunnbok (nå valgt bort), «samme teknologi som Optiplan» (ikke bekreftet etter grunnmur-beslutningen), «utkast går til eier» og «kan ikke ferdigstilles uten egenerklæring» (NS-krav, ikke forskrift), henvisninger til «regelverk-krav.md avsnitt 8» og «avsnitt 5» (finnes ikke, filen har avsnitt 0–6), 47 faste kontrollpunkter (listen i samme fil har 40, `kartlegging-kontrollpunkter.md` sier 37). Forslag: merk filen tydelig som «historisk» øverst, eller skriv den om til et kort, gjeldende kravdokument som peker til LES-MEG for beslutningene.

**Funn M3 – Viktig. Frasearbeidet passer ikke rett inn i EzProp.** Kodesystemet og navnemønsteret er laget for IVITs frasepanel (15–20 synlige tegn, tre felt per bygningsdel, IVITs låste avvik). I EzProp:
- Avvik, årsak, konsekvens og tiltak er egne felt på samme avvikskort. «Handling»-fraser må deles i konsekvens og tiltak, eller EzProp må godta ett kombinert felt.
- 50-seriens tiltak hører til IVIT-avvik som ikke finnes i EzProp. Hvert av disse 201 tiltakene trenger et eget Byggcon-avvik (nytt avviksspørsmål med Byggcons egen tekst).
- Å1/Å2 «årsak» er fysisk årsak. NS 3600 pkt. 13 definerer årsak som begrunnelsen for valgt TG og hvilket kriterium som er brukt. Begge trengs.
- Excel v13 har «Bygningsdel» og «Felt i IVIT», men ikke EzProps kontrollpunkt-ID, romtype eller «vises når»-betingelse. Flyttingen krever en tilleggsfane med denne koblingen.
- Antall: `Fraseregister-IVIT-forklaring.md` og hovedmappens `LES-MEG.md` sier 1057 fraser, frasearbeidets `LES-MEG.md` sier 1333 (1355 rader). De to første må oppdateres.
Det er ikke et problem at frasene er lagt inn i IVIT nå; Byggcon har nytte av dem fram til EzProp er klar, og Excel v13 er kopien som sikrer at de ikke går tapt.

**Funn M4 – Viktig. Beslutninger som er uklare eller mangler begrunnelse.**
- «Forskriften bestemmer hva som undersøkes, NS 3600 bare TG.» Begrunnelsen er ikke skrevet ned. Konsekvensen (rapporter som ikke er «etter NS 3600») er ikke vurdert mot hva Fremtind, meglere og forsikring krever. IVITs egen forutsetningstekst sier at NS 3600:2025 legges til grunn for TG, men IVITs mal følger tillegg A i omfang. Byggcon kan altså komme til å levere mindre enn i dag.
- «Flere tiltak per avvik» er bestemt, men ikke hvordan de vises i rapporten (nummerert liste? ett avsnitt?).
- «Fritt beløp» ved TG3: forskriften sier sjablonmessig anslag. Et eksakt beløp kan oppfattes som pristilbud. Trengs en regel om at fritt beløp alltid vises som «ca.» eller avrundet, og at premisseteksten dekker det.
- Design A «bygger på Optiplans designspråk». Optiplans designsystem (farger, typografi, komponenter) er ikke dokumentert i mappen. Skissene ligger bare som privat claude.ai-side, ikke i SharePoint.
- «Tilpasning per kunde og avtale fra start, kan tas ut hvis det blir for avansert.» Det er ingen kriterier for når det tas ut. Bør avgjøres før arkitektur, siden overlegg per avtale påvirker datamodellen for maler.

### 2.4 Risiko og antakelser

**Funn T1 – Viktig. Teknikk: befaring uten nett i nettleseren.**
Generelt faglig råd, ikke Byggcon-praksis:
- En PWA på iPad kan fungere uten nett, men iOS gir ingen bakgrunnssynkronisering når appen er lukket. «Bilder lastes opp i bakgrunnen» virker bare mens appen er åpen.
- Safari kan slette lagret data for nettsider som ikke er lagt på hjemskjermen. EzProp må derfor *kreve* at appen legges på hjemskjermen, og lagringskvoten for bilder (gjerne 100–300 bilder per befaring) må testes på ekte iPad Pro.
- Flere brukere i samme rapport uten nett krever flettemodell per felt. Tekst kan flettes (Yjs), men TG, valg og målinger kan ikke flettes automatisk; der må siste endring vinne med varsel. Dette må avgjøres per felttype.
- Spectora har egen app, IVIT har egen iPad-app med kjente synkfeil, SmartTakst har ingen offline. Ingen av de tre beviser at «bare nettleser + offline + flerbruker» fungerer. Dette er en uprøvd antakelse.
Forslag: synkprototypen i «Neste steg» bør kjøres *før* repo og plan, med en test som omfatter 2 iPader, 200 bilder, 30 minutter uten nett og samtidig endring i samme kontrollpunkt.

**Funn T2 – Kritisk. Forretning: data og overgang fra IVIT.** Se oppsummering nr. 5. Spørsmål som må besvares: Kan Byggcon eksportere alle historiske rapporter (PDF og data) og bilder fra IVIT? Hva sier lisensavtalen om eksport og om sletting etter oppsigelse? Hva koster det å beholde lesetilgang til IVIT i en overgangsperiode? Hvor mange aktive oppdrag må flyttes manuelt?

**Funn T3 – Viktig. Forretning: salg til andre takstfirma.** Grunnmuren er riktig tenkt, men ingen har vurdert: Byggcon som leverandør konkurrerer med IVIT og SmartTakst, som begge har kobling til meglersystemer og Norsk takst. Uten disse koblingene er EzProp vanskelig å selge. Meglerintegrasjon bør derfor ikke være V2.

**Funn T4 – Viktig. Juss.**
- **IVIT- og SmartTakst-tekster:** Frasearbeidet sier at IVIT-tekster bare er brukt til sammenligning. Men 50-seriens tiltak «begynner med samme stikkord som IVIT-avviket» og «IVITs standardtiltak har god risikotekst» (K16). Grensen mellom «inspirert av» og «kopiert fra» bør kontrolleres av en person på et utvalg, før tekstene flyttes til EzProp.
- **NS 3600:** Kriterietekstene er vernet. «i»-knappen med forskriftstekst er greit (forskrift er fri), men ikke standardens tilleggsbestemmelser. Se R9.
- **Ansvar for KI-tekst:** Takstmannen godkjenner alt. Bra. Men logg og merking (KI-funksjon 1) må være på plass *før* første KI-funksjon slås på, ikke bygges parallelt.
- **Eiers navn i rapporten:** NS 3600 pkt. 14.3 krever boligens eier. Spørsmålet i `eiendomsdata-api.md` («avgjør om eierens navn skal stå») er dermed besvart av standarden, hvis Byggcon følger pkt. 14.

**Funn T5 – Viktig. Uprøvde antakelser (liste).**
1. Visma eAccounting-API-et dekker fakturautkast, sending og status per klient for tre selskaper. (Sandbox finnes, men ikke testet.)
2. Meglersystemene har åpne API-er som et nytt system kan kobles til uten godkjenning fra Norsk takst eller leverandøren.
3. Standard Norge tillater bruk av tillegg C som data i programvare.
4. Takstmennene godtar en sjekkliste etter forskriften, som er kortere enn IVITs sjekkliste etter tillegg A.
5. En PWA i Safari på iPad er stabil nok for 200 bilder uten nett (se T1).
6. KI-leverandør med EU/EØS-lagring og uten trening finnes til akseptabel pris for norsk tekst og bilder.
7. Optiplans teknologi passer for en offline-først-løsning. (Ikke vurdert.)
8. Kostnadsintervallene fra IVIT er «bransjestandard». SmartTakst bruker andre intervaller. Det er ingen standard.
9. Meglere godtar PDF som vedlegg uten lenke eller portal. (Beslutning 24.10, men ikke sjekket med én megler.)

### 2.5 Kvaliteten på prøveeksemplene

**Funn E1 – Viktig. Språkreglene.** Kontrollert mot Ståles regler (ingen gjetteord, ingen NS-henvisning, flere tiltak, kostnadstekst bare ved behov):
- **NS-henvisning i teksten:** finnes i 2A, 3A, 6C, 8A, 9A og 10A. Kjent, skal skrives om. Se R7 for hvordan kilden likevel må inn i rapporten.
- **Gjetteord:** Ingen «antas/antar/antagelig». Men 3A («ut fra eiers opplysninger / synlige forhold er sjiktet lagt før 2000») og 4A («mindre enn det som var vanlig krav da badet ble bygget») gjetter indirekte. Ståles eget forslag til omskriving av 3A er riktig. 4A bør si hva som er målt og hva referansenivået er.
- **Flere tiltak:** 1A, 1B, 2A, 3A, 3B, 4A, 5A, 6B, 7A, 8A og 10A har flere. Bra.
- **Kostnadstekst:** alle sju TG3-eksempler har kostnadstekst. Skal bli valgfri. Kjent.
- **Absolutte påstander:** 6A «Det gir ikke fuktskader i veggen» og 3A «Det er stor risiko» bør mykes til det som faktisk er observert.

**Funn E2 – Viktig. Faglig.**
- **5B (hulltaking ikke utført, TGIU):** Mangler alternativ fuktkontroll (A.2.1.8 pkt. 8), om konstruksjonen er skadeutsatt (tabell 2, TGIU), og at eier er informert om utvidet ansvar. Og den strider mot Byggcons TG2-regel (R3).
- **TGIU-eksempler generelt:** Tabell 2 krever fire ting: hva, hvorfor, tiltak for å kunne undersøke, konsekvens, og om konstruksjonen er skadeutsatt. Bare 5B er TGIU, og den mangler den siste.
- **Årsak som TG-kriterium:** Pkt. 13 sier at årsak er begrunnelsen for valgt TG og hvilket kriterium som er brukt. Eksemplene gir fysisk årsak. Det bør komme tydelig fram hvilket kriterium: «symptom på skade» (TG2), «usikker fremtidig funksjon på grunn av alder» (TG2), «påvist funksjonssvikt» (TG3). Da blir det også enklere å se at TG er riktig.
- **9A:** «bør skiftes innen få år» er strengere enn C.1 (tiltak ved alder er f.eks. nærmere undersøkelse). 2A gjør dette riktig.
- **10B:** kostnad 100 000–200 000 kr før årsaken er kjent. Forskriften krever anslag, men teksten bør si at anslaget er usikkert til undersøkelsen er gjort. Det står alt. Bra.
- **Grenser i 6 og 10:** se R8, må verifiseres mot A.3.17.3 og A.2.11.1.
- **Oppbyggingen** (vises når → avvik → årsak → konsekvens → tiltak → kostnad) er god og dekker § 2-22 og pkt. 13. Variantene TG2/TG3 per avvik stemmer med IVITs praksis og med at TG3 krever kostnad.

---

## 3. Motsigelser mellom dokumentene

| Fil A | Fil B | Hva som er ulikt | Forslag |
|---|---|---|---|
| `LES-MEG.md` (beslutning 24.10: «bare krav i forskriften stopper publisering») | `svar-fra-stale-2026-10-24.md` nr. 21 («Ståle må bekrefte dette») | Ført som vedtak uten bekreftelse | Ståle bekrefter eller endrer. Se M1 for fullstendig liste. |
| `LES-MEG.md` (TG2/TG3 uten «årsak, konsekvens og tiltak» stopper) | NS 3600 pkt. 13 / forskriften § 2-22 | Tiltak er NS-krav, ikke forskriftskrav | Tiltak gir advarsel, eller Ståle bestemmer at det likevel skal stoppe (da er det Byggcon-regel, ikke forskrift). |
| Frasearbeidet (eier nekter hulltaking = TG2) | Prøveeksempel 5B (TGIU) og NS 3600 A.2.1.8 (TGIU) | Ulik TG for samme situasjon | Én regel, begrunnet. Se R3. |
| `regelverk-krav.md` avsnitt 2 (krypkjeller uten innvendig tilgang: TGIU lov) | NS 3600 A.2.7.1 og tabell 2 (TGIU bare når heller ikke utvendig er mulig) | Tabellen er for mild | Rett tabellen. |
| `LES-MEG.md` (NS-henvisning ikke i rapporten) | NS 3600 C.1 og 14.2 (kilde for alderskriterium og årsversjon skal stå i rapporten) | Kolliderer | Kildelinje genereres av malen, ikke av fraser. Se R7. |
| `kravdokument.md` («47 faste kontrollpunkter») | `kartlegging-kontrollpunkter.md` og `LES-MEG.md` («37») | Listen i kravdokumentet har 40 | Tell på nytt i IVIT og rett alle tre. |
| `kravdokument.md` krav 1–2 og `anbefalte-funksjoner.md` V1 (bygninger og kunde fylles fra matrikkel) | `eiendomsdata-api.md` (ingen avtale, åpne kilder gir ikke eier, byggeår, BRA) | V1 kan ikke levere det kravene sier | Avgjør kilde for V1. Se oppsummering nr. 4. |
| `grunnmur…md` pkt. 1 (person knyttet til flere selskaper) | `svar-fra-stale-2026-10-23.md` nr. 3 (bare ett selskap) | Ulik modell | Én ansettelse per person. Oppdater grunnmur. |
| `grunnmur…md` pkt. 9 (frasebank med godkjenning i V1) | `svar-fra-stale-2026-10-24.md` nr. 12 (ingen godkjenningsflyt nå) | Ulikt | Godkjenning som funksjon som kan slås på. Oppdater grunnmur. |
| `grunnmur…md` pkt. 9 (flere i samme rapport i V1) | `anbefalte-funksjoner.md` del 2 («Senere») | Ulik prioritet | Avgjør etter synkprototypen. |
| `anbefalte-funksjoner.md` (automatiske meldinger V2, leveranse til megler V2) | `LES-MEG.md` (hendelser og handlinger er kjernefunksjon, første rutiner bestemt, levering som PDF) | Ulik prioritet | Oppdater anbefalte-funksjoner til V1 for de seks rutinene og levering. |
| `anbefalte-funksjoner.md` (rapportutkast til eier V1) og `kravdokument.md` krav 10 | `regelverk-krav.md` avsnitt 4 (utkast til eier er NS-krav, ikke bindende) | Er det krav eller ikke? | Ståle avgjør. Anbefaler ja (NS 14.5 og vanlig praksis). |
| `kravdokument.md` krav 6 (ikke ferdigstille uten egenerklæring) | Publiseringsregelen | Egenerklæring er NS-krav | Advarsel, ikke stopp. |
| `kravdokument.md` («regelverk-krav.md avsnitt 8» og «avsnitt 5» for levetider) | `regelverk-krav.md` (avsnitt 0–6, levetider i 2, kontroller i 5) | Feil henvisninger | Rett. |
| `Fraseregister-IVIT-forklaring.md` og hovedmappens `LES-MEG.md` (1057 fraser) | Frasearbeidets `LES-MEG.md` (1333 i IVIT, 1355 rader) | Ulike tall | Oppdater til 1333. |
| `prompt-sidemannskontroll-kartlegging.md` («EzProp-kartlegging-arkiv/») | SharePoint (mappen heter `EzProp-kartlegging/`) | Navn | Rett prompten eller mappen. |
| `ivit-detaljer.md` («IVIT har ikke KI» rettet til «har KI, 169 kr») | `smarttakst-analyse.md` del 6 («IVIT: 169 kr per rapport») | Stemmer nå, men `anbefalte-funksjoner.md` del 8 sier fortsatt ingenting om at IVIT har KI | Oppdater anbefalte-funksjoner. |
| `kartlegging-rapport-og-oppdrag.md` (IVIT-tekst: «17 dyktige ansatte») | Kunnskapsbasen (16, lista har 15) | Antall ansatte | Står alt i 99-apne-sporsmal. |
| `svar-fra-stale-2026-10-24.md` nr. 26 («uten nett er unntaket») | `LES-MEG.md` («befaring uten nett er et krav») og `grunnmur…md` («flere i samme rapport uten nett») | Hvor mye skal offline tåle? | Definer: én bruker uten nett er krav, flere brukere uten nett i samme rapport er ønske. |

---

## 4. Spørsmål til Ståle (sortert etter viktighet)

1. **Hulltaking nektet:** Følger Byggcon NS 3600 A.2.1.8 (TGIU med alternativ fuktkontroll), eller holder vi på TG2? Hvis TG2: hva er begrunnelsen som skal stå i rapporten og i kunnskapsbasen?
2. **Publisering:** Bekrefter du listen i M1 over det som stopper publisering? Skal manglende tiltak stoppe (Byggcon-regel) eller bare varsle?
3. **Rapportens omfang:** Skal EzProp levere rapporter «etter NS 3600:2025» (tillegg A, pkt. 14, lyd og støy, dokumentasjonstabell, utkast til eier) eller bare «etter forskriften»? Hva krever Fremtind-avtalen og meglerne? Dette avgjør sjekklistens størrelse og er den største faglige beslutningen som ikke er tatt.
4. **Eiendomsdata i V1:** Godtar du manuell registrering av eier, byggeår og BRA i V1, eller skal det hentes inn tilbud fra Eiendomsverdi, PropCloud og Ambita nå?
5. **Overgang fra IVIT:** Har du lest lisensavtalen om eksport og sletting? Skal vi be iVerdi om et uttrekk av alle rapporter og bilder nå, mens avtalen løper?
6. **Hvilke tre meglersystemer** kommer ordrene fra, og har du kontaktperson hos leverandørene?
7. **Rapporttyper:** Hvilke av IVITs rapporttyper bruker Byggcon, og hvor mange per år? Hvilke må være i EzProp før IVIT sies opp?
8. **NS-lisens:** Kan du spørre Standard Online om vilkår for å bruke tillegg C og forskriftshenvisninger i eget program?
9. **Oppbevaring:** Hvor lenge skal rapporter, bilder og måledata beholdes i EzProp? (Forslag: minst 10 år, låst versjon.)
10. **Loft uten adkomst:** Skal regelen få unntaket for nyere konstruksjoner uten tiltenkt tilkomst (A.3.18.1)?
11. **Fritt beløp ved TG3:** Skal beløpet alltid vises avrundet/«ca.», og skal premisseteksten nevne det?
12. **Synkprototype:** Er du enig i at prototypen (2 iPader, 200 bilder, samtidig redigering) kjøres før repo og plan?
13. **Designskissene:** Kan de lagres i SharePoint (PDF eller bilder) slik at de ikke bare ligger på en privat claude.ai-side? Finnes Optiplans designsystem dokumentert?
14. **Grenser i prøveeksemplene** (15/25/30 mm, 3 punkterte ruter): Kan fagrådet bekrefte mot A.2.11.1 og A.3.17.3?
15. **Egen bolig i arbeidsmappen:** Testoppdragene bruker din egen adresse i `LES-MEG.md` og `smarttakst-analyse.md`. Vil du ha den anonymisert?

---

## 5. Det som er godt gjort

- **Prinsippet «forskriften bestemmer hva, NS 3600 bestemmer TG»** er riktig lest ut av § 2-23, og det stemmer med Standard Norges egen framstilling (lansering 10.3.2026). Avsnitt 0 i `regelverk-krav.md` kan brukes som den er.
- **Levetidstabellen** i `regelverk-krav.md` stemmer med tillegg C.2–C.8. Radon 100 Bq/m³, el/rekkverk/lovlighet/radon uten TG, og krypkjeller-regelen stemmer med NS 3600:2025+AC:2026.
- **Automatisk TG-forslag fra materiale og alder** er en reell forbedring som verken IVIT, SmartTakst eller Spectora har. Datamodellen i `kartlegging-kontrollpunkter.md` avsnitt 7 og malsystemet i `spectora-maler…md` del 5 er godt gjennomtenkt og kan brukes som grunnlag for arkitekturen.
- **Kartleggingen av IVITs kontrollpunkter og bad** er grundig (alle valg og alle «Ja» testet), og skiller mellom tema og IVITs tekst. Det er riktig gjort.
- **Beslutningstabellen i `LES-MEG.md`** med kilde og dato gjør det lett å finne hva som gjelder. Svarfilene fra Ståle er ryddige.
- **Grunnmuren (organisasjon → selskap → person, oppdragsteam, bibliotek med nivåer)** er riktig å ta inn i V1. Det er dyrt å bygge om senere.
- **KI-prinsippene** (utkast, takstmann godkjenner, aldri TG, aldri sending, logg først, EU/EØS, ingen trening) er riktige og i tråd med RICS-standarden.
- **Frasearbeidet** har gitt Byggcon et ryddig og komplett register på kort tid, med kopi i Excel. Kontrollen 25.10 mot forskrift og NS 3600 fant og rettet reelle feil (feieradkomst, radonsperre, lovlighet). Hvert avvik har tiltak, slik pkt. 13 krever.
- **Prøveeksemplenes oppbygging** (vises når, avvik, årsak, konsekvens, tiltak, kostnad) dekker § 2-22 og pkt. 13, og TG2/TG3-variantene er faglig fornuftige.
- **SmartTakst- og Spectora-analysene** er ærlige om svakheter og sier tydelig hva som ikke skal kopieres.

---

## Forslag til nye punkter i `01 Kunnskapsbase/99-apne-sporsmal.md` (Ståle avgjør)

Under «Eget rapportsystem (EzProp)»:
- Skal EzProp levere rapporter etter NS 3600:2025 i fullt omfang (tillegg A og pkt. 14), eller bare etter forskriften? Hva krever Fremtind og meglerne?
- Hulltaking nektet av eier: TG2 (Byggcon i dag) eller TGIU (NS 3600 A.2.1.8)?
- Hvilke rapporttyper i IVIT bruker Byggcon, og hvor mange per år?
- Hva sier IVITs lisensavtale om eksport av rapporter og bilder ved oppsigelse?
- Krever Standard Online lisens for å bruke NS 3600 tillegg C som data i eget program?
- Stiller Norsk takst eller sertifiseringsordningen krav til rapportsystem eller innsending?
- Hvor lenge skal rapporter, bilder og måledata oppbevares i EzProp?
- Hvem eier personvernarbeidet for EzProp (behandlingsgrunnlag, DPIA for KI, databehandleravtaler)?

---

*Svar gjerne per funn, for eksempel: «R3 enig», «M1 uenig – tiltak skal stoppe fordi …», «F3 ikke relevant». Fant du noe jeg ikke fant?*
