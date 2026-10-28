# Sidemannskontroll av kartleggingen for EzProp – del 2: programvaren

Sist oppdatert: 25.10.2026 (kveld, justert etter presisering fra Ståle)
Status: **Utkast – ikke godkjent**
Utført av: Claude som uavhengig sidemann. Del 1 (`sidemannskontroll-kartlegging-2026-10-25.md`) tar regelverk, motsigelser og risiko. Denne delen tar **selve programvaren**: funksjonene som er foreslått, prioriteringene og vurderingene bak dem.

**Presisering fra Ståle 25.10.2026 (chat):** Løsningen skal brukes internt i Byggcon. Konkurranse- og salgsperspektivet (salg til andre takstfirma, sammenligning med konkurrenter) legges lenger bak i vurderingene. [Kilde: Ståle, 25.10.2026]

Dette endrer vektingen slik:
- Funn som bare gjelder salg til andre (plattformadmin, white label per organisasjon, abonnement, deling mellom organisasjoner, selvbetjent oppstart) er flyttet til «Kan vurderes» eller tatt ut. Det eneste som bør beholdes i arkitekturen, er **organisasjons-ID på alle data**, fordi det er billig nå og dyrt senere. Resten kan vente til det eventuelt blir aktuelt.
- Sammenligningene med SmartTakst og Spectora brukes fortsatt, men bare som kilde til gode løsninger, ikke som mål å slå.
- Del 1, funn T3 (salg til andre takstfirma) nedprioriteres tilsvarende. Del 1 er ikke endret.
- **Forslag til LES-MEG (Ståle avgjør):** beslutningen 23.10 «Klar for salg til andre takstfirmaer» kan presiseres til «Intern bruk først. Arkitekturen holder organisasjons-ID, men ingen salgsfunksjoner bygges nå.»

**Kilder:** de samme som i del 1, pluss `spectora-advanced-automatisering.md`, `spectora-ko-oppgaver-sms.md` og `spectora-analyse.md`. Alvor: **Kritisk** (må avklares før utvikling), **Viktig**, **Kan vurderes**.

---

## 1. Kort oppsummering

| # | Alvor | Funn |
|---|---|---|
| 1 | **Kritisk** | **V1 er for stor.** Listen i `anbefalte-funksjoner.md` del 10 har 9 punkter. `grunnmur…md` pkt. 9 flytter 6 til, og beslutningene 23.–24.10 legger på hendelser og handlinger, to visninger av konstruksjoner, tilpasning per avtale med eget rapportdesign, og flere i samme rapport uten nett. Ingen har summert hva V1 nå inneholder. Med intern bruk som mål blir det enklere: forslag om en «V0 pilot» (én takstmann, én rapporttype, uten nett, PDF, ingen integrasjoner) som kjøres ved siden av IVIT, før V1. |
| 2 | **Kritisk** | **Datamodellen er beskrevet fire steder, og de er ikke slått sammen.** `kartlegging-kontrollpunkter.md` avsnitt 7, `kartlegging-bad.md`, `spectora-maler…md` del 5 og `spectora-advanced-automatisering.md`. De er stort sett enige, men skiller seg på om TG ligger på avviket eller kontrollpunktet, hva «Handling» er, og hvor regler bor. Ett dokument må gjelde før arkitektur. |
| 3 | **Kritisk** | **IVITs iPad-app og befaringsflyt er ikke kartlagt.** All kartlegging av IVIT er gjort fra nettleser på PC. Det er befaringen EzProp skal gjøre bedre, og det er der takstmennene bruker tiden. Ordre-flyten fra meglersystem, «Godkjenninger» og «Endelig rapport» er heller ikke sett. |
| 4 | **Viktig** | **Statusmodellen er ulik i tre dokumenter** (`anbefalte-funksjoner.md`, `design-retninger.md`, IVITs 20 oppdragssteg). Sidemannskontroll, utkast til eier og revisjon er ikke plassert i flyten. Hendelsesmotoren trenger én fast liste over hendelser. |
| 5 | **Viktig** | **Regelmotoren («vises når», TG-forslag, målegrenser) er systemets hjerte, men terskelverdier, betingelsesspråk og testing er ikke beskrevet.** `design-retninger.md` sier selv at grensene i skissene bare er eksempler. |
| 6 | **Viktig** | **«Maler åpne for alle» og «rapport låst til malversjon» er ikke forent.** Hvis alle kan endre fellesmalen uten godkjenning, og hver endring gir ny versjon, vil rapporter i samme uke ligge på ulike versjoner. Fraser (trygt) og kontrollpunkter/regler (krever versjon) må behandles ulikt. |
| 7 | **Viktig** | **Leilighet og fellesdeler er ikke med.** IVIT har eierform (selveier/aksje/andel) og punktet «mangler tilstandsrapport for fellesdeler». NS 3600 A.4 har egne punkter. Kartleggingen og datamodellen tar bare enebolig. |
| 8 | **Viktig** | **Bilder er underbeskrevet.** Lagring uten nett, komprimering, rotering (kjent IVIT-feil), kobling til punkt, markering, bilder i PDF, bildearkiv per oppdrag og sletting er spredt over fire filer uten samlet krav. |
| 9 | **Viktig** | **Roller og tilganger er en liste med navn, ikke rettigheter.** Ekstern person, kontorbruker og kunde/megler-visning mangler rettighetsmatrise. Innlogging: «felles med Optiplan» er bestemt, men Byggcon bruker Microsoft 365, og Entra ID er ikke vurdert. |
| 10 | **Kan vurderes** | **Det er ikke skrevet noe om test, pilot og opplæring.** Ingen plan for testdata, automatisk test av regler, akseptansetest med takstmenn eller overgang av pågående oppdrag. |

---

## 2. Funn per område

### 2.1 Oppdrag, ordre og statusflyt

**P1 – Viktig. Tre statusmodeller.**
- `anbefalte-funksjoner.md`: bestilt → tildelt → befaring planlagt → utkast → levert → fakturert → lukket.
- `design-retninger.md`: bestilt → befaring → utkast → sidemann → levert → fakturert.
- IVIT (`kartlegging-rapport-og-oppdrag.md`): ordre mottatt → sett → tildelt kontor → avvist → oppdrag startet → tildelt → befaring planlagt → inspeksjon startet → avsluttet → utkast til godkjenning → akseptert/avvist → endret → endelig levert → faktura sendt → godkjent → stengt/gjenåpnet/kansellert/omplassert.
Forslag: skill **status** (få, vises i lista) fra **hendelser** (mange, driver regler og logg). Status: ordre → bestilt → tildelt → befaring planlagt → under arbeid → til sidemann → utkast hos eier → levert → fakturert → lukket, pluss på vent og kansellert. Hendelseslisten i `spectora-advanced-automatisering.md` («Hva EzProp bør ha» pkt. 2) er god, men mangler: ordre mottatt fra meglersystem, oppdrag avvist, befaring startet/avsluttet, utkast akseptert av eier, revisjon utstedt, oppdrag overlevert til annen takstmann/selskap.

**P2 – Viktig. Ordre er ikke modellert.** IVIT skiller Ordre (fra meglersystem) og Oppdrag. SmartTakst har bestiller-rollen. `anbefalte-funksjoner.md` har «bestillingsskjema på nettsiden» som «Senere», og meglerintegrasjon som V2. Men Byggcon mottar ordre fra tre meglersystemer i dag. Ordre må finnes som objekt i V1, selv om den første tiden legges inn manuelt fra e-post.

**P3 – Viktig. Parter på oppdraget er ikke definert.** Flere filer nevner oppdragsgiver/selger, megler, kjøper, representant for selger, fakturamottaker, rekvirent, ekstern person. Ingen fil sier hvilke roller som finnes, hvilke som er påkrevd, og hvem som får hva (utkast, rapport, faktura, spørreundersøkelse). Hendelsesmotoren trenger dette for mottakere, og fakturaen (fritt valgt mottaker) også. Forslag: tabell «part på oppdrag» med rolle, kontakt, får-utkast, får-rapport, får-faktura, får-melding.

**P4 – Kan vurderes. Kopiering av oppdrag og rapport.** IVIT har «Kopier data fra» med valg av deler. SmartTakst viser hva som endret seg. Begge er tatt med. Bra. Men regelen «rapport låst til malversjon» og «kopier fra tidligere rapport» må virke sammen: data fra en gammel malversjon må kunne legges inn i en ny mal med varsel om punkter som ikke finnes lenger.

### 2.2 Bygninger, rom og omfang

**P5 – Viktig. Leilighet og fellesdeler.** Datamodellen antar hus med egne tak, vegger og tomt. For leilighet gjelder § 2-9, § 2-14 og § 2-16 bare delvis (fellesareal), og NS 3600 A.4 har egne punkter. IVIT løser det med eierform i innstillinger og et frivillig punkt om fellesdeler. EzProp bør ha «boligtype» og «eierform» som styrer hvilke faste kontrollpunkter som vises, på samme måte som romtype styrer rompunktene. Dette står som krav 2 («boligtype styrer omfanget») i `kravdokument.md`, men er ikke fulgt opp i noen datamodell.

**P6 – Viktig. Tilleggsbygg.** Garasje er «egen bygning med egne opplysninger» i IVIT. Frasearbeidet har bygd 50 fraser for tilleggsbygg. Men får garasjen egen sjekkliste, en forenklet, eller bare beskrivelse? Står som åpent i `kartlegging-kontrollpunkter.md` avsnitt 8. Forskriften § 1-2 (tolkningsuttalelse 13.10.2025 til Fremtind om tilleggsbygninger) bør leses før dette avgjøres.

**P7 – Kan vurderes. Romtyper.** IVIT har 55, SmartTakst 18 (bare i plantegning). EzProp skal eie sin egen liste. Ingen har foreslått listen eller hvilke som skal utløse hvilke grupper. `kravdokument.md` 2.6 b) sier at «Teknisk rom», «Annet rom med sluk» og «Svømmebasseng» bør behandles annerledes enn IVIT. Det er riktig, men ikke vedtatt. Forslag: romtype-tabell med kolonnene gruppe (våtrom/kjøkken/toalett/spesialrom/annet), BRA-type, og «under terreng» (ja/nei), siden det styrer § 2-15.

**P8 – Kan vurderes. Areal.** § 2-20 er med, og SmartTakst sin plantegning er vurdert lavt. Men «vanskelig eller umulig å måle opp nøyaktig» (IVIT) og ALH/GUA er ikke i datamodellen. Areal er den vanligste reklamasjonsgrunnen. Minst: areal per etasje per type, hvem som målte, metode, og avvik fra Ambita/eier.

### 2.3 Sjekkliste, regler og TG-forslag (kjernen)

**P9 – Kritisk. Én datamodell.** De fire modellene bør slås sammen til ett dokument med disse avgjørelsene tatt:
- **TG bor på avviket**, kontrollpunktets TG regnes ut (høyeste vinner). `spectora-maler…md` sier dette, `kartlegging-kontrollpunkter.md` lar det være åpent. Konsekvens: TG0/TG1/TGIU settes på kontrollpunktet når det ikke finnes avvik, TG2/TG3 bare via avvik. Dette er IVITs regel og den er riktig.
- **Utfallstyper:** TG2, TG3, TGIU, HMS, og «velg TG2/TG3». HMS må være egen type med konsekvens og tiltak (NS 3600 pkt. 13), ikke en avkrysning.
- **Årsak** må finnes som eget felt per avvik (begrunnelse + TG-kriterium), i tillegg til konsekvens og tiltak. Frasefeltet «Handling» (konsekvens + tiltak) må da deles eller mappes.
- **Målefelt** med enhet, gyldig område og terskel som utløser avviksforslag.
- **Regler** eies av malversjonen, ikke av koden.

**P10 – Viktig. Betingelsesspråk og testing.** SmartTakst-analysen viser hvor skjørt tekstbaserte betingelser er (ventilasjon-feilen). Forslaget «faste koder, ikke tekst» er riktig. Det som mangler:
- Hva slags betingelser må støttes? Funnet i kartleggingen: alltid; valg X krysset av; valg X og valg Y; målt verdi over/under grense; alder over levetid (avhengig av materiale og dokumentasjon); byggeår før/etter årstall; romtype; boligtype; «hulltaking ikke foretatt». Det er nok, og det bør låses som et lite, fast sett.
- **Terskeltabell** med kilde per grense (fall, terskelhøyde, skjevhet, punkterte ruter, rekkverkshøyde, fukt). Finnes ikke. Grensene i designskissene er eksempler.
- **Automatisk test av regler**: for hver regel et eksempel på data som skal utløse og ikke utløse. «Prøv malen»-skjermen i `spectora-maler…md` er riktig tanke, men bør også være en kjørbar test, ikke bare et skjermbilde.

**P11 – Viktig. Aldersforslag: hvor kommer alderen fra?** Forslaget bygger på «materiale + år». I praksis er alderen ofte eiers opplysning uten dokumentasjon, eller byggeåret. Datamodellen må ha: alder (årstall), kilde (dokumentert / eier opplyser / byggeår), og dokumentasjon finnes (ja/nei), fordi tabell C.1/C.2 har ulike grenser med og uten dokumentasjon. `kartlegging-bad.md` nevner dette for våtrom, men det gjelder alle alderspunkter.

**P12 – Kan vurderes. «Velg TG2 eller TG3».** IVIT har mange slike. Vurderingen «vi bør beholde det» er riktig, men det bør loggføres hvorfor takstmannen valgte den ene (det er «årsak» etter pkt. 13). KI-sjekken før levering kan senere se etter TG2 med TG3-ord i teksten.

**P13 – Kan vurderes. «Ses i sammenheng med».** Lenking mellom punkter (krypkjeller ↔ drenering, loft ↔ tekking) er en god idé fra kartleggingen. Den bør også brukes til å *kopiere observasjoner*: når takstmannen registrerer fuktskjolder på loftet under tekking, bør takkonstruksjon-punktet vise det.

### 2.4 Validering og publisering

**P14 – Viktig. Kontroll underveis krever at reglene kjører uten nett.** Designprinsipp 13 («kontroll før levering underveis») og «lite merke med antall mangler» forutsetter at valideringen kjører lokalt på iPaden. Da kan ikke valideringen ligge bare på serveren. Det er ikke sagt noe sted. Samme gjelder TG-forslag fra alder og målinger: de må kjøre lokalt.

**P15 – Kan vurderes. Logg ved overstyring.** Beslutningen sier at publisering tross advarsel logges. Logg hva: hvilke advarsler, hvem, når, og en valgfri begrunnelse. Det bør også telles per takstmann (statistikk) og kunne vises for sidemannen.

### 2.5 Fraser, maler og versjoner

**P16 – Viktig. To typer endringer, to regimer.** Beslutning 24.10: maler er åpne for alle, uten godkjenning, med endringslogg og tilbakeføring. `spectora-maler…md` del 5: malversjon med status, «rapport låst til versjon», «send til godkjenning», «en annen person godkjenner». Disse strider. Forslag:
- **Fraser** (tekstbiter): åpne for alle, trer i kraft straks, endringslogg og angre. Ingen versjonering av rapporten.
- **Kontrollpunkter, spørsmål, utfall, regler, levetider**: bare fagansvarlig, alltid som ny malversjon med «gyldig fra», rapporten låses til versjonen. Godkjenning av en annen person kan slås på senere.
Dette gir «åpent» der det er trygt og «versjon» der det må være.

**P17 – Viktig. Overlegg per avtale (Fremtind, Privatmegleren).** Beslutning 24.10 vil ha egne regler, maler og rapportdesign per avtale fra start, «kan tas ut hvis det blir for avansert». Overlegg med arv er det mest kompliserte i malsystemet. Forslag: V1 får *bare* egen rapportprofil (logo, forside, liggende/stående) og egen premissetekst per avtale. Egne kontrollpunkter og regler per avtale venter til V2. Da forsvinner mesteparten av kompleksiteten uten at Fremtind-avtalen taper noe (Ståle: «lite spesielt i innholdet»).

**P18 – Kan vurderes. Biblioteket med fem nivåer** (EzProp standard, organisasjon, selskap, team, person). Med intern bruk som mål gir «EzProp standard», «selskap» og «team» lite, siden alle opptrer som Byggcon. Forslag: to nivåer i V1, **felles** (fagrådet) og **mine**, pluss favoritter og «mest brukt». Flere nivåer kan legges til senere uten ombygging hvis frasen har et eiernivå-felt fra start.

**P19 – Kan vurderes. Import og eksport med regneark.** Vurdert som «Høy» etter Spectora-testen. Dette er riktig og bør være *den* måten fagansvarlig redigerer malen på i V1, i stedet for en maleditor (V2). Det sparer et helt skjermbilde og gir versjonering gratis (én fil per versjon).

### 2.6 Befaring uten nett, synkronisering og flere brukere

**P20 – Kritisk. Kravet er ikke presist.** Ståle 24.10 (nr. 26): uten nett er unntaket. `LES-MEG.md`: uten nett er et krav. `grunnmur…md`: flere i samme rapport uten nett. Forslag til presist krav:
- **Må:** én takstmann kan gjøre hele befaringen (sjekkliste, målinger, bilder, fraser, TG-forslag, validering) uten nett i minst 4 timer, og alt synkroniseres uten tap når nettet kommer.
- **Bør:** to personer kan jobbe i samme rapport på kontoret med nett, med fletting per felt.
- **Senere:** to personer uten nett i samme rapport.
Da kan synkmodellen velges etter «må», og «bør» kan løses med siste-endring-vinner per felt pluss varsel.

**P21 – Viktig. Hva som flettes og hva som ikke kan flettes.** Tekstfelt kan flettes (Yjs). TG, ja/nei-svar, valg, målinger, bilder og rekkefølge kan ikke flettes meningsfullt; der må én vinne og den andre varsles. Dette må stå i arkitekturen per felttype. Ingen fil sier det.

**P22 – Viktig. Lagringskvote og bilder.** Se del 1 T1. I tillegg: hvor mange oppdrag skal kunne ligge lokalt samtidig (dagens oppdrag + morgendagens?), og hva skjer når iPaden er full. Det bør være en regel «oppdrag lastes ned før befaring, og fjernes lokalt N dager etter levering».

**P23 – Kan vurderes. Synkstatus.** «Alltid synlig» og «lagret kl.» er med (fra SmartTakst og IVIT). Legg til: antall endringer som venter, antall bilder som venter, og en knapp «synk nå». Det er det takstmannen trenger for å vite om han kan forlate huset.

### 2.7 Bilder

**P24 – Viktig. Samlet bildekrav mangler.** Spredt i `anbefalte-funksjoner.md` (tegning på bilde, farge etter TG), `ki-funksjoner.md` (kvalitetssjekk, sortering), `ivit-detaljer.md` (rotering feilet), `design-retninger.md` (kamera ett trykk unna), `smarttakst-analyse.md` (markering, flere bilder samtidig). Forslag til ett avsnitt: bildet tas i appen og knyttes til rom + kontrollpunkt (+ avvik) i det det tas; EXIF-rotering normaliseres ved lagring; komprimering til fast størrelse lokalt, original beholdes til server; markering lagres som eget lag, ikke brent inn; bildetekst; forsidebilde; bilder som ikke er i rapporten beholdes i arkivet; sletting følger oppbevaringsregelen. Antall bilder per rapport bør anslås (IVIT i dag?) for å dimensjonere lagring og PDF.

### 2.8 Rapport og PDF

**P25 – Viktig. Rapportgeneratoren må være én motor for flere profiler.** Krav: profil per selskap (logo, side 2), profil per avtale (liggende A4), rapporttype-oppsett (med/uten teknisk verdi og markedsverdi), NS-utgave i rapporten, kildelinjer for alderskriterier (del 1 R7), revisjoner med versjonsnummer og opprinnelig dato, utkast-vannmerke. Dette tilsier HTML-mal → PDF på server, med profilen som data. Ingen fil sier hvilken teknologi, og det er greit nå, men kravlisten bør samles.

**P26 – Kan vurderes. Oppsummering per bygningsdel og sammendrag.** IVITs «sync»-knapp henter tekst fra punktene. Forslag: generer alltid, og la takstmannen redigere en kopi. KI-funksjon 8 (sammendrag i klarspråk) bygger på det samme og bør bruke samme datagrunnlag.

**P27 – Kan vurderes. Nettrapport, visningslogg og gyldighetsside (V2).** Disse tre henger sammen og bør bygges som én funksjon: en offentlig lenke per utgitt rapport, med gyldig til-dato, versjon, hendelseslogg og visningslogg. Rapporten sendes fortsatt som PDF-vedlegg (beslutning), lenken er tillegg.

### 2.9 Samarbeid, sidemannskontroll og oppgaver

**P28 – Viktig. Sidemannskontroll som flyt er ikke tegnet.** Alle filer sier «sendes til kollega, kommentarer, godkjenning med navn og tid», men ikke: hvor i statusen den ligger, om den er påkrevd for alle rapporter eller bare noen (stikkprøve? nye takstmenn? TG3-tunge?), hva sidemannen kan endre selv, og hva som skjer ved avvisning. Byggcons rutine i `03 Kvalitet og sidemannskontroll` bør være kilden; sjekklisten der er bare et utkast. Forslag: definer tre spørsmål først (når er den påkrevd, hva kan sidemannen gjøre, hvordan logges funn), så kan skjermene tegnes.

**P29 – Kan vurderes. Felles kø uten kalender.** `grunnmur…md` har felles kø i V1, kalender er V2. En kø uten kalender og kapasitet gir lite. Enten tas enkel kalender (befaringer per takstmann) inn i V1, eller så venter køen. Kalender mot Microsoft 365 står som «Høy» i `ivit-detaljer.md`, men ikke i V1-listen.

**P30 – Kan vurderes. Oppgaver.** Godt beskrevet etter Spectora-testen (`spectora-ko-oppgaver-sms.md` del 6). Oppgaver fra regler, flere mottakere og visning i mobilen står alt der. Bra.

### 2.10 Hendelser og handlinger (automatisering)

**P31 – Kan vurderes. Vurderingen er god.** Tredelingen Når → Bare hvis → Gjør, norske hendelser, ekte vedlegg, logg per oppdrag, regler på eksisterende oppdrag og hendelser som revisjonsspor er riktige valg. To tillegg:
- **Ferdige oppskrifter** for de seks rutinene Ståle bestemte, levert som data i V1, slik at ingen må bygge regler selv for å komme i gang.
- **E-postavsender:** hvilken tjeneste sender e-post (Microsoft 365 via Graph, eller en egen leverandør)? Avsenderdomene, SPF/DKIM og leveringslogg må avklares. Det er ikke nevnt.

### 2.11 Faktura og økonomi

**P32 – Viktig. eAccounting-tilkoblingen er ikke spesifisert.** «Fakturautkast som sendes manuelt, og status» er alt som står. Trengs: kunde-oppslag/opprettelse i eAccounting (dubletter!), produktlinjer og MVA-koder, rabatt, kreditnota ved feil, status tilbake (sendt, betalt, forfalt → hendelser), og tre klienter med hver sin nøkkel. Sandbox finnes. Forslag: test de fire kallene (opprett kunde, opprett fakturautkast, hent status, kreditnota) før arkitektur, så man vet hva API-et faktisk gir.

**P33 – Kan vurderes. Ordrebekreftelse.** IVIT varsler at obligatorisk ordrebekreftelse ikke er sendt. Er den obligatorisk fordi Byggcon bestemte det, eller fordi noe krever det (f.eks. angrerett for forbruker)? Ikke undersøkt. Hvis selger er forbruker og bestiller direkte, gjelder angrerettloven ved fjernsalg. Bør sjekkes.

### 2.12 Roller, tilgang og innlogging

**P34 – Viktig. Rettighetsmatrise mangler.** Roller er listet (takstmann, sidemann, kontor, fagansvarlig, leder, admin), men ikke hva hver kan: se alle oppdrag, publisere, endre mal, se økonomi, fakturere, slette, overstyre advarsel. Legg til roller som finnes i IVIT: ekstern person, kontorbruker med begrenset tilgang, og visningsroller for kunde og megler. Plattformadmin og partnerfirma (fra `grunnmur…md`) kan vente, siden løsningen er intern.

**P35 – Viktig. Innlogging.** «Felles innlogging med Optiplan» er vedtatt. Byggcon bruker Microsoft 365 for alt annet. Entra ID (Microsoft-innlogging) gir tofaktor gratis, sentral avslutning når noen slutter, og kalender/e-post i samme identitet. Spørsmål: bruker Optiplan Entra ID i dag? Hvis ikke, bør begge gjøre det.

### 2.13 Integrasjoner

**P36 – Kan vurderes. Adapterlaget er riktig,** også for intern bruk, fordi Byggcon kan bytte regnskapssystem eller datakilde uten ombygging. Legg til porter for: **kalender** (Microsoft 365), **SMS** (senere), **dokumentdeling** (Boligmappa, nevnt i IVIT), **signering** (BankID, V2) og **lagring/sikkerhetskopi** (hvor ligger bilder og PDF-er, og hvem eier lagringskontoen).

**P37 – Viktig. Meglersystem.** Står som V2 i `anbefalte-funksjoner.md`, men er aktiv i IVIT i dag (ordre inn, data tilbake, 40 kr/rapport). Uten den må kontoret taste ordre manuelt, og meglere mister automatisk mottak. Dette er den enkeltintegrasjonen som avgjør om EzProp kan erstatte IVIT. Bør være V1, eller V1 må ha en manuell ordre-innlegging som er like rask.

### 2.14 KI

**P38 – Kan vurderes. Vurderingene er gode.** Rekkefølgen (logg og merking først, så regelbaserte sjekker, så tale og språkvask) er lav risiko. To merknader:
- **Pri 2 tale til tekst «på egen server»** (NB-Whisper) betyr drift av en GPU-tjeneste. Det er en større driftsoppgave enn resten av V1. Alternativ: kjøp tjenesten innen EU/EØS med databehandleravtale, og vurder egen server senere.
- **KI uten nett** er riktig avgrenset («venter KI-behandling»). Men «frasesøk på betydning (pgvector)» virker ikke uten nett. `ki-funksjoner.md` sier at en enkel variant fungerer offline. Det må være tekstsøk med synonymliste. Bør stå tydelig.

### 2.15 Design og skjermer

**P39 – Kan vurderes. Designvalgene er fornuftige og begrunnet.** Tre tillegg:
- «Ingen nedtrekksmenyer eller sveiping i befaringen» (prinsipp 6) møter lister som 55 romtyper og 17 tekkingstyper. Det trengs søkefelt med hurtigvalg («mest brukt» øverst) for lange lister.
- «Samme data, to visninger» (iPad og PC) betyr to skjermsett å vedlikeholde for Konstruksjoner. Det er riktig for befaring, men bør avgrenses til Konstruksjoner, ikke hele appen.
- Tomme sider med forklaring, hjelp i appen og tilbakemelding med skjermbilde (`ivit-detaljer.md`) er riktige krav som ikke står i designprinsippene.

### 2.16 Administrasjon, arkiv og statistikk

**P40 – Kan vurderes. Liste over innstillinger mangler.** Fra IVIT: firmabeskrivelse (side 2), logo, forutsetningstekst, ordrebekreftelsestekst, oppdragsnummer-sekvens, tofaktor, tilgangsbegrensning, sertifikater, signatur, kalenderkobling, integrasjoner. Fra beslutningene: prisliste (prismotor V2), avtaler/oppdragsgivere, e-postmaler, regler, malversjoner, KI av/på og leverandør. Bør samles som én liste med nivå (felles / selskap / person).

**P41 – Kan vurderes. Arkiv og søk.** «Globalt søk», «lagrede filtre», «eksport til Excel» står som Høy i `ivit-detaljer.md`, men ikke i V1-listen i `anbefalte-funksjoner.md`. De er små og bør inn i V1.

**P42 – Kan vurderes. Varsler.** `ivit-detaljer.md` sier at varsler skal være en arbeidsliste med lest/ulest, filter og gruppering. Det står ikke i noen funksjonsliste. Hører sammen med dashbordet «arbeidskø først».

### 2.17 Hva som er observert, og hva som er antatt

**P43 – Viktig. Kartleggingen skiller ikke alltid.** Noen eksempler:
- IVITs **iPad-app** er ikke sett. Hele befaringsopplevelsen Byggcon har i dag, er ukjent for kartleggingen.
- IVITs **Endelig rapport**, meglerlevering og revisjon er ikke utført (koster penger). Hva megleren faktisk mottar (PDF + tekstfil? data?) er antatt.
- IVITs **Ordre**-fane og **Godkjenninger** er ikke åpnet med innhold.
- Spectoras **kø per oppdrag** er kartlagt fra kode og hjelpesider, ikke testet.
- SmartTakst sin **PDF** er ikke sett.
Forslag: en kolonne «sett / testet / antatt» i `anbefalte-funksjoner.md`, og at Ståle (som har tilgang) ser iPad-appen og meglerleveringen i IVIT sammen med Claude på et testoppdrag.

### 2.18 Test, pilot og overgang

**P44 – Kan vurderes. Ingenting er skrevet.** Forslag til minste innhold før utvikling:
- **Testdata:** ett anonymisert oppdrag per boligtype (enebolig, leilighet, fritidsbolig, med garasje), med bilder.
- **Regeltest:** hver regel har eksempler som skal og ikke skal utløse (se P10).
- **Synkprototype** (del 1 T1) som første leveranse.
- **Pilot:** én takstmann kjører EzProp og IVIT parallelt på 5 oppdrag. Måles på tid per befaring, antall advarsler, antall rettinger etter sidemannskontroll.
- **Overgang:** regel for pågående oppdrag (fullføres i IVIT), eksport fra IVIT (del 1 T2), opplæring (`04 Opplæring` i kunnskapsbasen), og dato for oppsigelse.

### 2.19 Det som kan vente når løsningen er intern

**P45 – Kan vurderes.** Disse står i `grunnmur…md` pkt. 7 og i `anbefalte-funksjoner.md`, og kan legges helt bakerst: ny organisasjon med egne selskaper (white label), abonnement og bruk per organisasjon, innstillinger per organisasjon, plattformadmin adskilt fra Byggcon som kunde, deling av bibliotek og oppdrag med andre organisasjoner, selvbetjent oppstart, åpent API for andre. Det eneste som bør bygges nå, er **organisasjons-ID på alle tabeller og filtrering på den i alle spørringer**, fordi det koster lite i dag og mye å ettermontere. Samme regel som i Optiplan.

---

## 3. Motsigelser og hull (programvare)

| Fil A | Fil B | Ulikt | Forslag |
|---|---|---|---|
| `anbefalte-funksjoner.md` (statusflyt 7 steg) | `design-retninger.md` (6 steg med sidemann) og IVIT (20 hendelser) | Ulike statusmodeller | Én statusliste + én hendelsesliste (P1) |
| `anbefalte-funksjoner.md` (meglerintegrasjon V2, automatiske meldinger V2, flere i samme rapport Senere, kalender V2) | `LES-MEG.md`, `grunnmur…md`, `ivit-detaljer.md` (kjernefunksjon / V1 / Høy) | Prioritet | Oppdater anbefalte-funksjoner og summer V1 (oppsummering nr. 1) |
| `svar-fra-stale-2026-10-24.md` nr. 11–12 (maler åpne, ingen godkjenning) | `spectora-maler…md` del 5 (godkjenning, versjon, annen person godkjenner) | Malregime | Fraser åpne, struktur versjonert (P16) |
| `svar-fra-stale-2026-10-24.md` nr. 26 (uten nett er unntaket) | `LES-MEG.md` (krav) og `grunnmur…md` (flere brukere uten nett) | Omfang av offline | Presist krav i tre nivåer (P20) |
| `kartlegging-kontrollpunkter.md` avsnitt 7 (TG på utfall, HMS som flagg) | `spectora-maler…md` del 5 (TG én egenskap per avvik, HMS som utfallstype) | Datamodell | Én modell (P9) |
| `kravdokument.md` krav 2 (boligtype styrer omfang) | Alle datamodeller (bare enebolig) | Leilighet mangler | Boligtype og eierform i modellen (P5) |
| `grunnmur…md` (felles kø V1) | `anbefalte-funksjoner.md` (kalender V2) | Kø uten kalender | Enkel kalender i V1 eller kø i V2 (P29) |
| `ivit-detaljer.md` (globalt søk, arkivfiltre, varsler som arbeidsliste: Høy) | `anbefalte-funksjoner.md` del 10 (ikke i V1) | Små funksjoner glemt | Legg inn (P41, P42) |
| `ki-funksjoner.md` (frasesøk på betydning virker offline i enkel variant) | Samme fil (pgvector krever server) | Uklart | Presiser (P38) |
| `LES-MEG.md` (to visninger av konstruksjoner) | `design-retninger.md` (fem skjermer per retning, to av dem iPad) | Gjelder to visninger hele appen eller bare Konstruksjoner? | Avgrens (P39) |
| `LES-MEG.md` beslutning 23.10 («klar for salg til andre takstfirmaer») | Ståle 25.10 (intern bruk, salg lenger bak) | Vekting | Presiser beslutningen i LES-MEG (se øverst) |

---

## 4. Spørsmål til Ståle (programvare), sortert etter viktighet

1. **V1-omfang:** Er du enig i en «V0 pilot» (én takstmann, tilstandsrapport, uten nett, PDF, ingen integrasjoner, kjørt ved siden av IVIT) før V1? Hvis ikke: hvilke av de 15–20 V1-punktene kan vente?
2. **Offline-krav:** Godtar du de tre nivåene i P20 (én bruker uten nett = må; flere med nett = bør; flere uten nett = senere)?
3. **Maler:** Godtar du at fraser er åpne for alle, mens kontrollpunkter og regler bare endres av fagansvarlig som ny versjon (P16)?
4. **Tilpasning per avtale:** Holder det i V1 med egen rapportprofil og premissetekst per avtale, og at egne kontrollpunkter per avtale venter (P17)?
5. **Meglersystem i V1 eller manuell ordre:** Hva kan Byggcon leve med den første tiden?
6. **Leilighet og fellesdeler:** Hvor stor andel av Byggcons tilstandsrapporter er leiligheter? Må V1 støtte det?
7. **Sidemannskontroll:** Når er den påkrevd i dag, hva kan sidemannen endre selv, og hvordan logges funn? (P28)
8. **Innlogging:** Bruker Optiplan Microsoft Entra ID? Kan EzProp bruke det? (P35)
9. **IVIT-befaring:** Kan du vise iPad-appen og «Endelig rapport»/meglerlevering på et testoppdrag, slik at kartleggingen dekker det? (P43)
10. **Bilder:** Omtrent hvor mange bilder tas per tilstandsrapport i dag? (Dimensjonering, P24)
11. **Tale til tekst:** Egen server eller kjøpt tjeneste i EU/EØS? (P38)
12. **Ordrebekreftelse:** Hvorfor er den obligatorisk i IVIT – Byggcons valg eller et krav? (P33)
13. **E-post:** Skal EzProp sende via Microsoft 365, eller en egen e-posttjeneste? (P31)
14. **LES-MEG:** Skal presiseringen om intern bruk føres inn i beslutningstabellen? (Forslag til tekst står øverst.)

---

## 5. Det som er godt gjort (programvare)

- **Datastyrt sjekkliste** (romtype → gruppe → punkter, betingelser som data, regler som data) er riktig valgt og begrunnet av det som ble observert i alle tre systemene. Det er den viktigste arkitekturbeslutningen, og den er godt underbygget.
- **TG-forslag fra materiale, alder og målinger** med kilde og «takstmannen bestemmer» er riktig avgrenset, også mot KI («faste regler i koden, ikke KI»).
- **Adapterlaget** for integrasjoner, og **hendelser som revisjonsspor**, er riktige grep uansett om løsningen er intern eller ikke.
- **Malsystemet** i `spectora-maler…md` del 5 (malfamilie, versjon, regneark inn og ut, «prøv malen», låst rapport) er det mest gjennomarbeidede enkeltforslaget i mappen.
- **Hendelser og handlinger** er bedre tenkt enn forbildet: norske hendelser, ekte vedlegg, regler på eksisterende oppdrag, logg og «send på nytt», oppgaver fra regler.
- **Lærdommene fra SmartTakst** («ikke lås forhåndsvisning bak profilfelt», «ikke bland fritekst og tall», «faste koder, ikke tekst i betingelser») er konkrete og riktige.
- **Designprinsippene** (arbeidskø først, én hovedhandling per skjerm, tall i stedet for ja/nei, TG alltid med tekst, høy kontrast, store trykkflater) er godt begrunnet og passer befaring.
- **KI-rekkefølgen** (logg først, deretter regelsjekker uten KI, så tale og språkvask) er lav risiko og gir tidlig gevinst.
- **IVITs svakheter** er omsatt til konkrete krav (varsler som arbeidsliste, innstillinger som bekreftes, tofaktor, ingen dubletter, tekst går ikke tapt). Det er en god «skal gjøres bedre»-liste.

---

*Svar gjerne per funn: «P9 enig», «P17 uenig – Fremtind trenger egne punkter fordi …», «P33 ikke relevant». Fant du noe jeg ikke fant?*
