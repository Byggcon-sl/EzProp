# EzProp – funksjonskart (v2): hva løsningen skal ha, bygd på kartleggingen av IVIT, Spectora og SmartTakst

Status: **Arbeidsdokument – ikke godkjent**
Sist oppdatert: 25.10.2026 (natt, v2 – skrevet om etter at alle kartleggingsrapportene er lest)
Laget av: Claude, på oppdrag fra Ståle: «analyser hva vi skal ha med i løsningen av funksjonalitet … en produksjonsklar løsning som skal løfte hele organisasjonen og produktet».

**Kilder (alle lest i sin helhet):** `EzProp-kartlegging/rapporter-fra-hjelpeagenter/` (IVIT del 1 og 2, SmartTakst, Spectora dokumentasjon, Spectora kø/oppgaver/SMS, Spectora test), `kartlegging-rapport-og-oppdrag.md`, `kartlegging-kontrollpunkter.md`, `kartlegging-bad.md`, `ivit-detaljer.md`, `smarttakst-analyse.md`, `spectora-*.md`, `anbefalte-funksjoner.md` (rettet 25.10), `LES-MEG.md` med «Målgang», `datamodell.md` og `utviklingsplan.md`.

**Slik er dokumentet bygd:** For hvert av 14 funksjonsområder står det (1) hva Byggcon har i IVIT i dag, (2) hva Spectora og SmartTakst gjør som er verdt å ta med, (3) hva EzProp **må** ha for å være produksjonsklart, (4) hva EzProp skal gjøre **bedre** enn alle tre, og (5) status i `utviklingsplan.md`. Til slutt: hullene, sjekklisten for «produksjonsklar» og spørsmål.

---

## 1. Målet, sagt med kartleggingens egne ord

Kartleggingen viser tre systemer med hver sin styrke og hver sin svakhet:

- **IVIT** har det riktige *innholdet* (norsk tilstandsrapport, matrikkel fra Ambita, teknisk verdi, revisjoner, meglerintegrasjon, ordre, faktura) – men svak validering, synkfeil, varsler som ikke virker (5134 uleste), kunderegister med dubletter, innstillinger uten lagre-knapp, to apper, sjekkpunkter som endres sentralt uten varsel, og data som blir iVerdis eiendom.
- **Spectora** har den riktige *driften* (oppdraget som nav, automatisering med kø, oppgaver, portal, maler med regneark inn/ut, rettighetsmatrise, offline-editor, endringslogg, statistikk) – men er amerikansk, uten TG-logikk, uten NOK, og med betaling og mersalg bygd inn.
- **SmartTakst** har gode *enkeltløsninger* (fraser filtrert på TG, gratis språk-KI, rapport låst til malversjon, plantegning med areal, gyldighetsside med QR, kopier rapport med endringsliste) – men ingen offline, ingen TG-forslag, skjør logikk, én eier per rapport, ingen faktura.

**EzProp skal være IVITs innhold med Spectoras drift og SmartTaksts beste detaljer, på norsk, eid av Byggcon, og med én ting ingen av dem har: regler som foreslår TG fra materiale, alder og målinger.** Det er «produktet». «Organisasjonen» løftes av at oppdraget lever ett sted fra ordre til betalt faktura, og at fagkunnskapen ligger i systemet.

---

## 2. De 14 områdene

### 2.1 Ordre og bestilling

**IVIT i dag:** egen Ordre-fane (mottatt → sett → tildelt kontor → konvertert/avvist), bestilling kommer fra meglersystem (40 kr per rapport, med tilbakeføring av data), varsler «ordre mottatt» og «ordre tildelt». Ordren har melding og fakturainfo fra megler.
**Spectora:** nytt oppdrag låser kalenderen i 10 minutter mens man bestiller; egendefinerte bestillingsfelt; online booking, prisvidget og forespørselsskjema; tilbud lagres som utkast; «Reorder/Copy» på samme eiendom; «Preview Actions» viser hvilke meldinger som vil gå *før* oppdraget lagres, og hver kan slås av for akkurat dette oppdraget.
**SmartTakst:** veiviser i tre steg (eiendom fra Ambita → parter → avtale med frist, hvem som betaler, flervalg «oppdragsdetaljer», «info til takstmann» om nøkler og adkomst); egen rolle *bestiller*.

**EzProp må ha:** ordre som eget objekt (mottatt, konvertert, avvist med grunn, ekstern referanse, hvem som bestilte), manuell innlegging i starten, veiviser med Byggcons egne felt (gnr/bnr, seksjon, borettslag, egenerklæring mottatt, nøkler/adkomst), «gjør om til oppdrag» med parter og avtale, bekreftelse til bestiller (som del av velkomst-e-posten).
**EzProp bedre:** forhåndsvisning «dette vil bli sendt» ved opprettelse (Spectora), e-post → ordreforslag (senere), bestillingsskjema for meglere med samme felt (fjerner avskrift før API finnes).
**Status i planen:** manuell ordre i fase 2, bekreftelse i fase 3. Forhåndsvisning av meldinger står i fase 3 (kø). Bestillingsskjema «senere». **Hull H8.**

### 2.2 Planlegging, kalender og kapasitet

**IVIT i dag:** kalender (måned/uke/dag/agenda) med befaringer per takstingeniør, valg av hvem som vises, kalenderintegrasjon via én e-postadresse, status «tilgjengelig/ikke tilgjengelig». Svakheter: hendelser flyter over i neste uke, ukevisning uten tidslinje, agenda bare i dag.
**Spectora:** tilgjengelighet som tidsvinduer eller faste luker per inspektør og ukedag; online booking finner ledig tid ut fra varighet; daglig e-post med timeplanen for neste 48 timer; dagsvisning med kart og kjørerute fra startadresse; serviceområder per inspektør; kalender med info når man holder musepekeren over.
**SmartTakst:** ingen kalender. Brukerne ønsker kart og kjøretid.

**EzProp må ha:** befaringstid på oppdraget, kalender per takstmann (befaringer, fravær), ukesvisning med tidslinje som ikke flyter over (IVITs feil), invitasjon til Outlook (toveis via Microsoft 365, siden Byggcon alt bruker det), kapasitetsoversikt per kontor neste to uker, flytting av befaring som planlegger meldingene på nytt (Spectora).
**EzProp bedre:** forslag til takstmann (kontor, avstand, kapasitet, sertifisering), kjøreplan for dagen, daglig timeplan-e-post, serviceområder (Salten, Lofoten, Helgeland).
**Status i planen:** bare .ics-invitasjon i fase 3, kalender «senere». **Hull H1 – det største for kontoret.**

### 2.3 Eiendom, parter og dokumenter

**IVIT i dag:** Eiendomsdata med matrikkel fra Ambita (kommune, gnr/bnr/fnr/snr, eiere, tomteareal, flere matrikler), skattetakst, siste hjemmelsovergang (kjøpesum, vises i rapport ja/nei), forsikring; «Valider»-knapp mot matrikkelen; bygninger med fire faner (info, etasjer/arealer med «fra Ambita» og «vanskelig å måle», tilbygg/modernisering, lovlighet med tegninger i fem alternativer, håndverkertjenester siste 5 år, åpenbare ulovligheter); Dokumenter-fane (kilde, sider, dato, status, kommentar, vedlagt i rapport); Boligpass og DIAKRIT av/på; kunde privat/bedrift, ansvarlig, medansvarlig, rekvirert av.
**Spectora:** eiendomsdata hentes automatisk og kan overstyres, og det vises at de er overstyrt; «Make Invisible» for takstmann; kjøpers megler og selgers megler som egne roller.
**SmartTakst:** Ambita-søk på adresse, matrikkel *og eiernavn*; hjemmelshaver foreslås som kunde; Dokumentasjon-fane der megler eller selger legger kommunepakke og egenerklæring; chat mellom partene.

**EzProp må ha:** eiendom med matrikkel (flere enheter), boligtype og eierform (60 % leiligheter), bygninger/etasjer/areal/rom per rapport, lovlighet som i IVIT, parter med roller og hva hver mottar, dokumentmappe med status (lagt fram/mangler/ikke aktuelt) som samtidig er dokumentasjonstabellen i rapporten, egenerklæring mottatt/ikke, forrige Byggcon-rapport på samme bolig synlig.
**EzProp bedre:** eiendomsdata fra leverandør med «overstyrt»-merke (Spectora), selger laster opp selv (SmartTakst), oppslag i Optiplan på sameiets organisasjonsnummer for fellesdeler (ingen har det).
**Status i planen:** dekket i fase 2 (manuelt). Leverandør og selgerportal «senere».

### 2.4 Befaringen

**IVIT i dag:** tre skjemanivåer (enkel, detaljert, kontrollpunkt), verktøy per punkt (TG, HMS, ferdig, kopier, nullstill, slett, fraser, «i» med forskriftstekst), 40 faste kontrollpunkter + rom, «Lagret kl.», bildearkiv. Svakheter: iPad-appen er lik nettversjonen (Ståle: dårlig), tekst tapt ved synk, bilder rotert feil, tekst i «Enkel beskrivelse» kom ikke i PDF, hjelp bare i Zendesk.
**Spectora (V10):** offline-editor med lokal database og trygg oppstart når innloggingen har gått ut; endringssett per del så to kan jobbe samtidig; synk 3 sekunder etter endring med nye forsøk og varsel; «Rapid Fire»-kamera, tegning etter hvert bilde, bilder også til iPadens album; «Classic Ratings» (valg henger sammen, «ikke undersøkt» teller som ferdig og lager tekst automatisk); stedsmerker i tre grupper; søk som tåler skrivefeil; fremdriftsmåler; lys/mørk og fem tekststørrelser; «Reset to server version» og «Send debug info».
**SmartTakst:** ingen offline, ingen målefelt, men fraser filtrert på TG per spørsmål, tellere per blokk, «Lagre som ny ferdig frase».

**EzProp må ha:** iPad-visning laget for befaring (to visninger av samme data), uten nett med synkstatus («3 endringer og 12 bilder venter», «Synk nå»), sjekkliste styrt av boligtype, eierform, rom og materiale, målefelt med enhet, hulltakingstabell, bilder rett på punkt/avvik med riktig rotering og markering som eget lag, fraser med favoritter/mest brukt/skrivefeiltoleranse, TG-forslag fra regler med begrunnelse, «ferdig» per punkt og fremdrift, «glemt noe?» før man går videre, «i»-knapp med forskriftskravet med egne ord, hjelpetekst per punkt, TGIU med ferdig tekst som teller som utfylt (Spectora «Classic Ratings»), stedsmerker, mørk visning for kjeller og loft.
**EzProp bedre:** TG-forslag fra alder og målinger (ingen har det), kontekst fra forrige rapport på hvert punkt, tale til tekst (senere), ett skjemanivå som er godt i stedet for IVITs tre.
**Status i planen:** fase 1–2. Stedsmerker og flagg i fase 3. Godt dekket.

### 2.5 Rapportproduksjon

**IVIT i dag:** rapportdeler (eiendomsdata, opplysninger, bygninger, konstruksjoner, sammendrag, oppsummering bygningsdeler med «sync» fra punktene, årlige kostnader, teknisk verdi, markedsverdi med Eiendomsverdi-verdiassistent og sammenlignbare salg, forutsetninger); rapportoppsett (med/uten markedsverdi, teknisk verdi, arealmåling); «Kopier data fra» med valg av deler; notater; rapportutkast som PDF/e-post/PDF+tekstfil til megler; endelig rapport (koster); revisjoner med gyldig fra; rapporttyper (9). PDF 14 sider: forside, om Byggcon, «dette trenger du å vite», markedsvurdering, sammendrag med TG-diagram, per bygning, bygninger på eiendommen, beregninger, arealer, forutsetninger.
**Spectora:** PDF-valg (innholdsfortegnelse, avvik først, sideskift, bunntekst, minimer luft, telling, signatur), sammendrags-PDF, «Save as Template» fra god rapport, «Observations Copy-and-Paste Text», signatur per inspektør. Svakheter: interne ID-er i PDF, tomme seksjoner gir egne sider (19 sider for ett avvik).
**SmartTakst:** kopier rapport med liste over hva som endret seg siden malen; privat notat med bilder; plantegning med automatisk BRA (følger ikke med i rapporten); «Overordnet faglig vurdering» med fraser; utkast-PDF låst bak profilfelt (ikke gjør).

**EzProp må ha:** PC-visning med rapport og bilder side om side (bildesenter), avvikskort med alt på ett sted, oppsummering per bygningsdel generert fra punktene og redigerbar, sammendrag, TG-oversikt, rapportoppsett per rapporttype (med/uten verdi), PDF i Byggcons profil uten interne koder og uten tomme sider, stående/liggende, revisjoner med opprinnelig dato, kopier data fra tidligere rapport med liste over hva som ikke passer, privat notat.
**EzProp bedre:** én PDF-motor med profiler per selskap og avtale, PDF under 8 MB, sammendrag i klarspråk (KI, senere), nettrapport (senere).
**Status i planen:** fase 2–3. **Teknisk verdi/markedsverdi står som «senere»** – må avklares mot H10 (verditakst).

### 2.6 Kvalitet og sidemannskontroll

**IVIT i dag:** rapportvalidering med «nødvendige» og «advarsler» – men svak (fant bare markedsverdi, befaringsdato og el; TG2 uten tiltak var bare advarsel); Godkjenninger-fane (tom, uten forklaring); revisjoner.
**Spectora:** krav om fullført før publisering; endringslogg på oppdraget (hvem, når, hva); visningslogg av rapporten (tid, IP, hvem) merket på rapportkortet; «det som er signert, fryses».
**SmartTakst:** fremdrift i prosent, `isValid`, status «Til korrektur» (megler kan sette tilbake), plantegning har egen «Kontroller»-liste med «Gå til».

**EzProp må ha:** de sju sperrene med overstyring og logg, advarsler for resten, «Gå til» fra hver mangel (SmartTakst), sidemannskontroll med kommentarer per sted, krav per ansatt, godkjent med navn og tid, endringslogg på oppdrag og rapportinnhold, utgivelser låst med fingeravtrykk, oppbevaring 10 år.
**EzProp bedre:** reklamasjonsmappe på ett klikk (alle utgivelser, bilder, målinger, logg, hvem var til stede), statistikk over sidemannsfunn per kategori, intern avviksregistrering (når prosessen gikk galt), KI-sidemann mot kunnskapsbasen (senere), visningslogg når nettrapporten kommer.
**Status i planen:** sperrer i fase 2, sidemann i fase 3. **Reklamasjonsmappe og intern avviksregistrering mangler (H6).**

### 2.7 Levering og kommunikasjon

**IVIT i dag:** rapportutkast per e-post eller «PDF og tekstfil til megler», endelig rapport med meglerintegrasjon (tilbakeføring av data), «Send e-post», påminnelse, varsler (5134 uleste, ubrukelige). Ordrebekreftelse er obligatorisk i IVIT, men Byggcon sender den ikke.
**Spectora:** automatisering i 11 grupper per rolle og kanal; Advanced: «når → bare hvis → gjør» med kø per oppdrag (grønn/grå/rød), «View Triggers» med tidslinje, leveringsstatus (delivered/open/bounce), «Send nå», «send på nytt med oppdaterte data», flytting av befaring planlegger på nytt; e-postmaler med ca. 45 flettefelt; kundeportal med egne lenker per rolle; varsel når e-post eller SMS ikke kom fram. Svakheter: kø bare i V9, import av nye regler bare framover, meldinger langt fram i tid blir liggende.
**SmartTakst:** PDF lastes opp i oppdraget, kunde og megler åpner der; kundelenke uten innlogging med chat og dokumenter; offentlig gyldighetsside med QR og hendelseslogg.

**EzProp må ha:** hendelser og handlinger med betingelsesgrupper, de seks rutinene levert ferdige, kø per oppdrag med «hvorfor» i klarspråk, forhåndsvisning, «send nå», «stopp», «send på nytt», leveringsstatus fra Microsoft 365, e-postmaler med flettefelt, rapport som PDF-vedlegg, logg over hva som gikk til hvem, varsler som arbeidsliste (lest/ulest, filter) – IVITs varsler er lærdommen.
**EzProp bedre:** regler gjelder også åpne oppdrag (enklere enn Spectora), oppgaver som handling (Spectora mangler), nettrapport + gyldighetsside + visningslogg som én funksjon (senere), SMS via norsk leverandør med samtykke (senere), meglerstatus.
**Status i planen:** fase 3. Godt dekket. Nettrapport «senere».

### 2.8 Faktura og økonomi

**IVIT i dag:** Faktura/ordregrunnlag-fane per oppdrag (Svea-avtale, fakturakunde, fakturatype, betalingsfrist, linjer med dato/beskrivelse/enhet/fra–til/pris/antall/rabatt/MVA, fakturerbar ja/nei, «sett til fakturert»); ordrebekreftelse generert fra linjene; Fakturaer-fane med statusfilter og Excel-eksport; regnskap via eMonkey; abonnementsside som viser klikkpriser (20 142 kr) uten periode.
**Spectora:** prismotor (grunnpris, modifikatorer på m²/alder/avstand/postnummer, tillegg, avgifter, rabattkoder) med pris som vises fortløpende; QuickBooks hver natt; liste over ubetalte og usignerte; kjørelengde-eksport; «rapporten låses til betaling» (ikke for oss).
**SmartTakst:** ingen kundefaktura, bare opplasting av PDF.

**EzProp må ha:** fakturagrunnlag per oppdrag med linjer, MVA og rabatt (som IVIT), prisliste per avtale og standardpriser som *data*, fritt valgt mottaker, riktig eAccounting-klient per selskap, kunde uten dublett, status tilbake (sendt/betalt/forfalt) som hendelser, liste over ufakturert og ubetalt, eksport.
**EzProp bedre:** automatisk fakturagrunnlag når rapporten er sendt (til godkjenning), tillegg fra regler (ekstra bygg, kjøring), omsetning per kontor/takstmann/megler i dashbordet, kjørebok-eksport, internfakturering mellom selskapene (senere).
**Status i planen:** fase 3. **Prisliste som data mangler (H2).** Ordrebekreftelse er erstattet av velkomst-e-posten (beslutning 25.10) – riktig.

### 2.9 Kunder og meglerforhold

**IVIT i dag:** Kunder (1296, privat/bedrift, med dubletter og uten Brønnøysund), kundefelt på oppdraget, «rekvirert av».
**Spectora:** Agents/Agent Teams/Agencies/Clients/People med import og eksport; meglerkort med foretak, team, to typer notater, antall oppdrag som kjøpers/selgers megler; Advanced: meglerprofil med omsetning, samtalelogg, oppgaver og merker satt av regler («aktiv selgermegler»); Metrics med toppmeglere og henvisningskilder.
**SmartTakst:** egen kontaktliste (tom) og en katalog over alle brukere (personvernproblem).

**EzProp må ha:** firma (meglerforetak, sameie, forsikring) og kontakter uten dubletter, Brønnøysund-oppslag, notater, oppdragshistorikk per megler og foretak, kontaktperson per kontor.
**EzProp bedre:** meglerprofil med tall (oppdrag per måned, leveringstid, svar på spørreundersøkelse), merker fra regler, varsel når en aktiv megler slutter å bestille, oppfølgingsoppgaver – **meglerne er kundene**.
**Status i planen:** kontakter i fase 2, profil med tall «senere». **Hull H4.**

### 2.10 Avtaler og oppdragsgivere

**IVIT i dag:** sertifikater per person (Fremtind-rapport, generelle), rapporttyper Norsk takst/Fremtind/Generell i tilbakemeldingsskjemaet, forutsetninger som firmainnstilling.
**Spectora:** tjenester med mal, avtale, pris og varighet; avtaler med e-signering (tid og IP lagres); «Hide inspector name» fryses ved signering.

**EzProp må ha:** avtale med oppdragsgiver (profil, premisser, pris, gyldighet, kontaktpersoner, hvilke sertifiseringer som kreves), oppdraget arver avtalen, volum per avtale.
**EzProp bedre:** SLA (leveringsfrist) med varsel, egne kontrollpunkter per avtale (senere), kvartalsrapport til oppdragsgiver, digital oppdragsavtale med signering (senere).
**Status i planen:** profil og premisser i fase 2. Pris og rapportering mangler (se H2, H3).

### 2.11 Kundeopplevelse for selger, kjøper og megler

**IVIT i dag:** ingenting utover PDF og meglerintegrasjon. Boligpass som tillegg.
**Spectora:** kundeportal uten innlogging (bestilling, kalender, signere, betale, rapport, be om tillegg), meglerlenke, nettrapport med venstremeny med antall per seksjon, filterknapper med «du ser ikke hele rapporten», mobilvisning, «Share with your agent», reparasjonsliste (ikke for oss), anmeldelser.
**SmartTakst:** samhandlingsportal (kundelenke uten innlogging, chat, dokumentopplasting, status som megler følger), offentlig gyldighetsside med QR, utkast-PDF til eier før ferdigstilling.

**EzProp må ha (produksjon):** velkomst, påminnelse, rapport og spørreundersøkelse på e-post (fase 3).
**EzProp bedre (produktløftet):** selgerportal (hva skjer, hva finne fram, last opp, egenerklæring, godkjenn hulltaking), meglerstatus med siste PDF, nettrapport for kjøper med TG-filter og «du ser ikke alt»-varsel, gyldighetsside med QR, utkast til eier (NS-krav, besluttet senere), tilbakemelding som lagres.
**Status i planen:** «senere». **Hull H9 – foreslått som egen fase 4b.**

### 2.12 Fag, maler og kunnskap

**IVIT i dag:** sjekkpunkter eid av iVerdi og endret sentralt uten varsel (16.10); frasepanel (Standard låst/Mine/Delt/Favoritter, dra-og-slipp, «Del med selskap»); admin.ivit.no med «Administrere fraser» (tre) og «Fraseregister» (507 egne, mange med tittel = tekst, ikke koblet til punkt eller TG); NS 3600-abonnement; «i» med forskriftstekst; hjelp i Zendesk (blokkert).
**Spectora:** maleditor i tre kolonner (seksjoner → punkter → kommentarer med Information/Limitations/Deficiencies), svartyper, standardtekst/sted/fagperson/bilde per kommentar, «Edit using AI», malinnstillinger (ratings, kategorier maks 3, PDF-valg), malverktøy (sortering, mest brukt, regneark inn/ut, klone, dele, Template Center), «changes only affect future reports», «Save as Template».
**SmartTakst:** 887 fraser på 202 spørsmål filtrert på TG, egne fraser fra rapporten, `templateSnapshot` per rapport, hjelpesenter på norsk (god forskrift/NS-veiledning), endringsønsker-tavle. Svakheter: mal kan ikke endres, betingelser på tekst («Naturlig_ventilasjon» ≠ «Naturlig ventilasjon»), TG skrevet ulikt.

**EzProp må ha:** systemmal eid av Byggcon med versjoner, kontrollpunkter, utfall, regler med faste koder og testtilfeller, levetider/terskler/kostnadsintervaller som tabeller, regneark inn/ut, «Prøv malen», frasebank felles/mine/favoritter koblet til punkt og TG, hjelpetekst og «i» per punkt, fraseimport fra Excel v13.
**EzProp bedre:** hjelp i appen som peker til Byggcons kunnskapsbase (ikke ekstern Zendesk), kalibreringsbibliotek med eksempelbilder per TG, statistikk for fagrådet, frasebanken lærer av godkjente rapporter, regelverksvakt, malbygger for egne rapporttyper (fase 5), «Save as Template».
**Status i planen:** fase 2 og 5. **Kobling til kunnskapsbasen mangler (H7).**

### 2.13 Ledelse, dashbord og rapportering

**IVIT i dag:** oppdragsliste med faner og antall (Forberedelser 12, Befaringer 12, Ferdigstilling 22), arkiv med lagrede filtre og alle kolonner, Fakturaer med Excel-eksport, abonnementsside med kroner per produkt. Ingen statistikk.
**Spectora:** dashbord (dagens oppdrag med kart, pågående, ubekreftede, utkast), Metrics (oppdrag, henvisningskilder, toppmeglere, omsetning, betalinger, kart), Reporting (meglere, omsetning, oppdrag, 30/60/90/YTD), Data Exports (oppdrag, avgifter, ubetalte/usignerte, kjørelengde), Advanced: egne dashbord og megleranalyse; daglig oppsummering av oppgaver.
**SmartTakst:** ingenting.

**EzProp må ha:** arbeidskø som startside (fase 2), lederdashbord per kontor og selskap: oppdrag per status, befaringer neste uke, kapasitet, levert siste 30 dager, leveringstid, ufakturert, forfalt, rapporter per takstmann; eksport til Excel; pilotmålene lesbare.
**EzProp bedre:** trender, kvalitetstall (sidemannsfunn, overstyrte sperrer, reklamasjoner), meglere som vokser/faller, prognose, egne dashbord (senere).
**Status i planen:** dashbord «senere». **Hull H3.**

### 2.14 Administrasjon, sikkerhet og drift

**IVIT i dag:** innstillinger på én side uten lagre-knapp (betalte tjenester blandet inn), 2-faktor av, «del alle oppdrag med alle», tilgangsbegrensning (ekstern/kontor), startsekvens for oppdragsnummer per takstmann, egen admin-app, diagnostikkfil, tilbakemelding med skjermbilde og tegning, nyheter, versjonsnummer synlig, lisens som gir iVerdi dataene.
**Spectora:** én innstillingsside med søk og autolagring («Saving… Saved!»), team med avkrysning per rettighet, kontorbrukere gratis, tofaktor med sperre etter 8 feil, varsel når mal/avtale slettes mens den er i bruk, nattlig sikkerhetskopi til Drive, «Change Role» uten utlogging, lokalisering (tidssone-advarsel), åpent API og MCP.
**SmartTakst:** automatisk kontoopprettelse på ukjent e-post (ikke gjør), rolle kan ikke endres.

**EzProp må ha:** én app (ikke admin for seg), innstillinger med bekreftelse og angre (lærdom), selskaper/kontorer/ansatte, roller og enkeltrettigheter, sertifiseringer med utløpsvarsel, avtaler, profiler, prisliste, e-postmaler, regler, tilkoblinger med status og feilvarsel, enheter (iPader) med sperring, revisjonslogg, sikkerhetskopi med prøvd gjenoppretting, personvern, oppbevaring, tilbakemelding med skjermbilde, nyheter/endringslogg i appen, hjelp i appen.
**EzProp bedre:** Microsoft-innlogging og tofaktor (senere), Intune for iPader, status-side for drift, MCP/API for Claude (senere), tydelig beskjed når en bruker er deaktivert (Spectoras tomme liste er lærdommen).
**Status i planen:** fase 0 og 4. **Sertifisering med utløp og enheter mangler (H5).**

---

## 3. Rapporttyper – det som avgjør når IVIT kan sies opp

IVITs arkiv viser ni rapporttyper: tilstandsrapport, verditakst, takstrapport, verditakst tomt, fleksibel rapport, reklamasjonsrapport, landbruk, arealmålingsrapport, energirådgivningsrapport. SmartTakst har elleve maler (bl.a. skadetakst, forhåndstakst, uavhengig våtromskontroll, vedlikeholdsplan, forbefaring). IVIT har i tillegg energimerking (Enova-ID) og rapportoppsett med teknisk verdi og markedsverdi (verdiassistent fra Eiendomsverdi).

Planen sier «for det meste tilstandsrapport» og malbygger for resten. Men **teknisk verdi og markedsverdi er et eget beregningsoppsett** (byggekostnader per m², vekting per etasje, fradrag for elde, sammenlignbare salg) som en malbygger med tekstfelt ikke lager. Hvis Byggcon leverer verditakster i IVIT i dag, må **verditakst bli systemmal nr. 2** med egne felt, og arealmåling en forenklet variant av tilstandsrapporten. **Spørsmål 2 i del 5.**

---

## 4. Hullene i dagens plan, sett fra organisasjonen

| # | Hull | Kilde i kartleggingen | Forslag |
|---|---|---|---|
| H1 | **Kalender og kapasitet** | IVIT har kalender (svak); Spectora har tilgjengelighet, kjørerute, daglig timeplan | Enkel kalender + kapasitet + Outlook toveis i fase 3 |
| H2 | **Prisliste som data** | IVIT har linjer per oppdrag; Spectora prismotor | Prisliste per avtale i fase 3, prismotor senere |
| H3 | **Lederdashbord** | Spectora Metrics/Reporting/Exports | Enkel i fase 3 (pilotmål), full i fase 4 |
| H4 | **Meglerprofil med tall** | Spectora Advanced meglerprofil og merker | Fase 4 |
| H5 | **Sertifisering med utløp, enheter med sperring** | IVIT sertifikater; Spectora tofaktor | Fase 0/2 |
| H6 | **Reklamasjonsmappe, intern avviksregistrering** | Spectora endringslogg og visningslogg; IVIT revisjoner | Fase 4 |
| H7 | **Hjelp i appen koblet til kunnskapsbasen** | IVIT: hjelp i Zendesk (blokkert); SmartTakst: norsk hjelpesenter | Fase 3 |
| H8 | **Bestillingsskjema for meglere** | Spectora request form med egne felt; SmartTakst veiviser | Fase 3 |
| H9 | **Nettrapport, selgerportal, meglerstatus, gyldighetsside** | Spectora portal; SmartTakst samhandlingsportal og QR | Egen fase 4b |
| H10 | **Verditakst og andre rapporttyper** | IVITs 9 typer, teknisk verdi/markedsverdi | Avklar volum; verditakst som systemmal nr. 2 i fase 5 |
| H11 | **Varsler som arbeidsliste** | IVIT 5134 uleste (lærdom) | Tabell i modellen, skjerm i fase 3 |
| H12 | **Oppgaver i mobilen og daglig oppsummering** | Spectora oppgaver mangler i mobil | Fase 3 |

---

## 5. Sjekkliste «produksjonsklar» per rolle

**Takstmann:** ser dagens befaringer med alt klart · hele befaringen på iPad uten nett, aldri tap · skriver mindre enn i IVIT (forslag, fraser, hjelp) · rapport ferdig raskere, PDF bedre · sender og gjør klar faktura fra samme sted · går aldri til IVIT.
**Kontor:** alle ordre ett sted, oppdrag på under to minutter · ser hvem som er ledig uten Outlook ved siden av · meldinger går automatisk og er synlige i køen · fakturagrunnlag uten å slå opp priser · én liste over alt som venter.
**Leder:** volum, kapasitet, ufakturert, leveringstid per kontor uten å spørre · meglere som bestiller mer/mindre · kvalitetstall.
**Fagansvarlig:** endrer mal, regler, terskler og fraser selv med versjon og test · ser hvor praksis spriker · nye ansatte får sidemann automatisk og hjelp per punkt.
**Admin:** ansatte, roller, avtaler, priser, profiler, tilkoblinger uten utvikler · personvern, sikkerhetskopi, oppbevaring, enhetssperring på plass.
**Megler og selger:** bekreftelse, tid, rapport og status uten å ringe · selger vet hva som skjer og hva de skal finne fram.

---

## 6. Spørsmål til Ståle

1. Er lesningen i del 1 riktig: «IVITs innhold, Spectoras drift, SmartTaksts detaljer, pluss TG-forslag fra regler»? Mangler det noe fra kartleggingen du mener er viktigere?
2. **Rapporttyper:** Hvilke av IVITs ni typer leverer Byggcon, og omtrent hvor mange per år? Leveres verditakst med teknisk verdi og markedsverdi? (Avgjør H10 og når IVIT kan sies opp.)
3. **Kalender (H1):** enig i fase 3?
4. **Meglerforhold (H4):** skal EzProp være Byggcons CRM, eller holder adressebok med tall?
5. **Produktløft (H9):** egen fase 4b etter produksjon, eller vente til etter malbyggeren?
6. **Energimerking:** IVIT har det som tillegg (Enova-ID). Bruker Byggcon det?
7. **DIAKRIT og Boligpass** er slått på i IVIT. Brukes de, og skal EzProp ha tilsvarende?
8. Finnes det områder i arbeidsdagen kartleggingen ikke dekker (timer, kjøring, utstyr, HMS alene på befaring, ferie og fravær)?

*Når du har svart, fører jeg hullene inn i `utviklingsplan.md`, krokene inn i `datamodell.md` og beslutningene inn i `LES-MEG.md`.*
