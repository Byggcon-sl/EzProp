# Spectora: test i praksis og hva Byggcon bør hente derfra

Jeg har testet Spectora i prøvekontoen. Jeg brukte bare fiktive data. Sesjonen var gyldig hele tiden.

**To ting er viktige å vite først:**
- **Spectora Advanced er låst.** Det gjelder avanserte automatiseringer, oppgaver, kontaktmerker, megleranalyse, avanserte tall og SMS-innboks. For å teste dem må prøveperioden for Advanced startes. Det er et tillegg til $4 per publiserte rapport, så jeg lot det være. Disse delene er beskrevet ut fra Spectoras egne funksjonssider, ikke testet.
- **Ingen e-post er sendt.** I prøvekontoen står det «This company cannot send emails», og e-postmalene kan ikke redigeres. Systemet har altså ikke sendt noe til noen.

Skript, tekstdumper og skjermbilder ligger i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/spectora/agent/`.

---

## (a) Moduler og navigasjon

Toppmenyen har: Dashboard, Templates (maler), Contacts, Metrics, Automations, Advanced, Settings og Support Center. Menyen kan tilpasses med dra-og-slipp. Ekstra punkter som kan legges inn er Inspections, Calendar, New Inspection, Payments, E-postkø, SMS-kø, Team, Data, Reporting, Billing og Unconfirmed.

Øverst er det et globalt søkefelt («Search everything»), og under brukermenyen finnes Integrations, Reporting, Data Exports og What's New.

- **Dashboard:** Dagens oppdrag med kart og kjørerute, pågående oppdrag, kalender, ubekreftede oppdrag og utkast. Knapper for «New inspection» og «New quote».
- **Inspeksjonen er navet.** Alt henger på oppdraget: personer, tjenester, avtaler, betaling, rapporter, e-post og SMS, interne notater og endringslogg.
- **To rapportredigerere:**
  - V10 (editor-next.spectora.com), en ny nettleser-app som fungerer uten nett.
  - V9 (app.spectora.com/report/…/editor), den klassiske.
- **Kundeportal** (portal.spectora.com): kunde og megler får hver sin lenke med token, uten innlogging.
- **Rapportvisning** (reports.spectora.com eller /v/reports): nettrapport, PDF, sammendrag og reparasjonsliste.

---

## (b) Område for område

### 1. Innstillinger (Settings)
Innstillingene er én lang side med sammenleggbare seksjoner, og den lagrer automatisk («Saving… Saved!»). Seksjonene er gruppert slik:

**BASICS**
- Profil: logo, toppfelt-logo, adresse og offentlig adresse. Inspektørinfo: direkte telefon med SMS, fagkompetanse (rik tekst), video, tjenester og serviceområde.
- Tjenester og priser, tilgjengelighet, team, eksempelrapporter og rabattkoder.

**BUSINESS TOOLS**
- **Agreements (avtaler):** signaturtype er enten avkrysning eller håndskrevet signatur. Begge lagrer dato, tid og IP-adresse. Inspektørens navn og bilde kan skjules på usignerte avtaler. Instrukstekst til kunden kan tilpasses.
- **Payments:** betalingsinstruks med `{{BALANCE}}`, varsel om betaling (i appen eller på e-post), automatisk kvittering og fast tekst på faktura.
- **Reviews:** egne stjerneanmeldelser fra 0 til 5 (`{{REVIEW_LINK}}`) og ekstern lenke til for eksempel Google.
- **Internal Communication:** varsel når en e-post eller SMS ikke kommer fram.
- **Email:**
  - Hvem som er avsender: inspektør eller firma.
  - Blindkopi av alle e-poster.
  - Egendefinert topp og bunn.
  - **Daglig e-post** til hver inspektør med timeplanen for de neste 48 timene, til valgt klokkeslett.
- **Text/SMS:** samtykkeavkrysning (transaksjons-SMS og markedsførings-SMS for seg). Eget nummer koster $20/mnd og fås kun i USA, Canada, Puerto Rico og Storbritannia. SMS-maler har en grense på 480 tegn.
- **Quotes:** tilbud lagres som utkast til oppdrag, og tilbudsmalen har egne plassholdere (`{{ONLINE_SCHEDULER}}`, `{{GET_QUOTE_WIDGET}}`).
- **Client Portal:**
  - Kunden kan gjøre handlinger også etter kansellering.
  - Feltene «Closing Date» og «End of Period» kan brukes som utløser i automatiseringer. Navnet på perioden kan velges: Option, Inspection, Due Diligence eller Contingency Period.
  - «Collect payment after publish»: betaling tas først etter publisering.
- **Repair Request Builder (reparasjonsliste):** kan slås på eller av, fremmes i portalen, og kan ha en egen ansvarsfraskrivelse.

**SCHEDULING TOOLS**
- **Scheduling Options:**
  - Et halvferdig bestillingsskjema låser kalenderen i 10 minutter.
  - Areal og byggeår hentes automatisk fra offentlige data (ATTOM eller RentCast).
  - Fast liste over henvisningskilder.
  - Om oppdrag skal være bekreftet som standard.
  - Kopi-e-post til kunde.
  - Adressefelt for kjøper og meglere.
  - **Egendefinerte bestillingsfelt.**
- **Online Scheduler:**
  - Kontaktinfo før eller etter valg av dato.
  - Ingen bestilling innen X timer.
  - Skjule priser eller vise prisdetaljer.
  - Visning av 1, 2 eller 4 uker.
  - Krav om manuell bekreftelse.
  - Egen bekreftelsestekst.
  - Varsel på e-post og SMS ved fullført eller avbrutt bestilling.
  - Kode for å bygge inn på nettsiden.
- **Get-a-Quote-widget:** egne farger og tekster, kan be om megler, og kan vise egendefinerte felt.
- **Inspection Request Form:** enkelt forespørselsskjema med standardpris, varighet, mal og avtale.
- **Add-on-forespørsler i portalen:** kunden kan be om tilleggstjenester, også etter publisering.

**REPORT OPTIONS**
- Report Tools:
  - Tildele inspektør per rapport, slik at riktig signatur kommer på.
  - 360-bilder.
  - **Reinspeksjon.**
  - **Krav om at alt er fullført før publisering.**
  - **Kostnadsestimat.**
- Liste over fagfolkstyper (standard og egne).
- **Stedsmerker:** tre grupper hurtigvalg, for eksempel etasje, himmelretning og rom.
- Om V10 er standard.

**COMPANY SETTINGS**
- Sosiale lenker, abonnement og integrasjoner. Integrasjonene er Repair Pricer, HomeBinder, Blipp, Google Drive (nattlig sikkerhetskopi av rapporter, fakturaer og avtaler), QuickBooks (salgskvittering hver natt), call-sentre, InterNACHI BuyBack og RecallChek.
- Dataimport fra ISN og fra andre maler.
- Visning av meglere.
- Kalenderen kan vise info når man holder musepekeren over et oppdrag, og kan vise kart på dagsvisningen.
- **Lokalisering:** metrisk eller imperisk, valuta (ikke NOK), tidssone, datoformat, landskode og navnet på fylke-feltet.

**USER SETTINGS**
- Dashbord: standardvisning, arbeidsdag, startadresse og hvor langt man vil kjøre.
- Navigasjonslinje, iCal- og Google-kalender, tofaktorinnlogging, varselinnstillinger og betafunksjoner.

**Byggcon bør kopiere:**
- Én innstillingsside med søk og autolagring. (Høy)
- Daglig timeplan-e-post. (Middels)
- Stedsmerker per rom og etasje. (Høy)
- Kravet «alt må være fullført før publisering», koblet til forskriftens minstekrav. (Høy)
- Egendefinerte bestillingsfelt, for eksempel gårds- og bruksnummer, seksjon, borettslag og om egenerklæring er mottatt. (Høy)
- Automatisk henting av eiendomsdata. I Norge betyr det matrikkel/Kartverket og Eiendomsverdi, med byggeår og BRA. (Høy)
- Norsk språk, NOK og 25 % MVA. Spectora mangler NOK. (Høy)

### 2. Automatiseringer

**Basic (testet)** er inndelt i 11 grupper:
- Scheduling, Rescheduling, Cancellation, Agreements & Fees
- Pre-Inspection for henholdsvis kunde, kundens megler og selgers megler
- Publishing
- Post-Inspection for henholdsvis kunde, kundens megler og selgers megler

Hver gruppe har egne av/på-valg for e-post og SMS per mottakerrolle. Tidspunktet settes som et tall (1–30) og en enhet (timer, dager, uker eller måneder) før eller etter befaring. Under Publishing kan man få varsel når kunden eller megleren åpner rapporten.

**E-postmalene** har:
- Type: transaksjon eller markedsføring. Markedsføring krever samtykke og avmeldingslenke.
- Emne og rik tekst.
- Omtrent 45 plassholdere, blant annet `{{CLIENT_FIRST_NAME}}`, `{{ADDRESS}}`, `{{INSPECTION_DATE/TIME}}`, `{{SIGN_AND_PAY_LINK}}`, `{{SIGN_LINK}}`, `{{PAY_LINK}}`, `{{REPORT_LINK}}`, `{{REPORT_PDF}}`, `{{SUMMARY_PDF}}`, `{{VIEW_REPORT_ON_CLIENT_PORTAL_LINK}}`, `{{INVOICE_LINK}}`, og felt for megler og selgers megler.
- Spectora legger automatisk på topp og bunn.
- E-post- og SMS-køene vises i egne tabeller (planlagt og sendt).

**Testautomatisering:** Jeg slo på «Pre-Inspection: Client – Reminder One», 2 dager før befaring. Jeg prøvde også å skrive om malen til norsk. Det gikk ikke: emnet, editoren og lagreknappen er låst i prøvekontoen.

**Advanced Automations / «Actions» (ikke testet, låst):**
- Utløsere: oppdrag bestilt, bekreftet, fullført, betalt, publisert, kansellert, «closing date» og liknende.
- Handlinger: e-post, SMS eller webhook, med forsinkelse i dager eller uker og ferdige oppsett («presets»).
- Betingelser: på tjeneste og på kontaktmerker, og merker kan settes automatisk etter regler. Vedlegg i e-post. Manuelle e-poster fra maler.

**Byggcon bør:**
- Lage en motor med utløser, betingelse, forsinkelse og handling, der handlingen kan være e-post, SMS, webhook eller oppgave. (Høy)
- Ha roller som passer norsk marked: oppdragsgiver/selger, megler, kjøper og budgiver. (Høy)
- Ha køvisning og varsel om feil levering. (Høy)
- Ha egne norske, ferdige forløp:
  - Bestillingsbekreftelse med oppdragsavtale og signering.
  - Påminnelse om egenerklæringsskjema og dokumentasjon (tegninger, FDV, ferdigattest).
  - Påminnelse dagen før befaring.
  - «Rapport klar» til selger.
  - Ved publisering: rapporten sendes til megler for vedlegg i salgsoppgaven.
  - Oppfølging etter 12 måneder (fornyet rapport eller vedlikehold). (Høy)

### 3. Tjenester, priser, rabatter, kalender og team

**Tjeneste (testet):** navn, kategori (20 faste, pluss egne under «Service Categories»), beskrivelse, skjult i booking, mal(er), avtale(r), grunnpris og varighet.
- **Modifikatorer:** «When» kan være kvadratfot, **kvadratmeter**, alder, byggeår, postnummer, fylke, fundament, eller avstand i km/miles fra firma eller fra inspektørens hjem. Typen er intervall, per enhet eller per enhet over en grense. Modifikatoren legger til pris og/eller timer.
- **Tillegg:** egen pris og tid, egen mal og avtale, «Learn more»-lenke, upsell og egne modifikatorer.
- **Avgifter:** prosent, beregnet etter modifikatorer og tillegg.

Skjemaet for ny bestilling viser prisoppbyggingen fortløpende. I testen ble det slik: grunnpris $9900, minus 10 % rabatt ($990), pluss 25 % MVA ($2227,50). Tillegget kom på $1500 + $375. Totalt $13 012,50 og 3 timer.

**Rabattkoder:** kode (skiller mellom store og små bokstaver), prosent eller beløp, tekst kunden ser, intern notat, hvilke tjenester og tillegg koden gjelder for, maks antall bruk og utløpsdato. Antall bruk telles.

**Tilgjengelighet:** åpne tidsvinduer eller faste tidsluker per inspektør og ukedag. Online booking finner ledig tid ut fra varigheten.

**Team:** inspektører og støttepersonell har avkrysning for disse rettighetene:
- Booke seg selv eller alle
- Endre og slette oppdrag
- Publisere
- Legge til i og endre mal
- Håndtere kontakter
- Se økonomidata
- Admin

Det finnes også verktøy for organisasjoner med flere avdelinger, som deler maler, avtaler og automatiseringer. Advanced har i tillegg serviceområder, begrensning på hvilke tjenester hver inspektør kan ta, lønnsfordeling og timeføring (ikke testet).

**Byggcon bør:**
- Lage en prismotor med areal (BRA), byggeår, avstand fra Bodø-kontoret og tillegg. Typiske tillegg: arealmåling, boligsalgsrapport for fritidsbolig, verdi- og lånetakst, el-kontroll og fuktmåling. (Høy)
- Beregne MVA per linje og sende fakturaen til Visma eAccounting via API. Spectora har bare QuickBooks. (Høy)
- Ha rettighetsmatrise. (Høy)
- Ha serviceområder per takstmann, for eksempel Salten, Lofoten og Helgeland. (Middels)
- Ha rabattkoder for meglerkampanjer. (Lav)

### 4. Maleditor
Maleditoren har tre kolonner: **Seksjoner → Punkter → Kommentarer**. Kommentarene er delt i tre grupper: Information, Limitations og Deficiencies. Det finnes også vedlegg per mal.

- **Svartyper:** avkrysning, flervalg/liste (for eksempel «Style») og tall (#). Hver gruppe har et «Other»-valg for fritekst.
- **Kommentarkortet har:**
  - «Default to checked»
  - Anbefalt fagperson (en lang liste over fagfolk)
  - Standard sted
  - Standardtekst i rik tekst
  - Standardbilde
  - **«EDIT USING AI»**
  - Ikoner for å endre navn, duplisere, flytte og slette, pluss dra-og-slipp.

**Malinnstillinger:**
- Navn og visningsnavn, standardmal.
- Topptekst for hele rapporten og for sammendraget.
- Visningsvalg: telling per kategori, antall punkter undersøkt, inspektørsignatur, standarder per seksjon (fritekst om kontrollnivå), anbefalt fagperson, kompakt visning.
- PDF: innholdsfortegnelse, avviksliste først, sideskift, bunntekst, sammendrag med eller uten bilder.
- Ordet for avvik kan endres.
- **Vurderinger (ratings):** Classic gir IN/NI/NP/D med auto-tekst. Custom gir fritt valgte vurderinger med navn, forkortelse, farge og standardvalg, og kan vises som et rutenett i rapporten.
- **Avvikskategorier:** én, to eller tre nivåer, med eget navn per nivå og valg om de skal med i sammendraget.
- Delingsvalg.

**Malverktøy:** sortere alfabetisk, sortere etter mest brukt, fjerne alle fagfolk-anbefalinger, eksportere til regneark, importere fra regneark eller annen programvare, klone, kopiere innstillinger, dele med andre og malbibliotek («Template Center»).

**Testet:** Jeg klonet malen til «Byggcon TEST – Tilstandsrapport NS 3600» og satte opp egne vurderinger: TG0, TG1, TG2, TG3 og TGIU, med farger. Avvikskategoriene fikk navnene TG1, TG2 og TG3. Det fungerte i rapporten: TG-knapper per punkt, og rutenett og forklaring i rapporten. **Begrensningen er at det maks er tre avvikskategorier**, og at vurdering og kategori er to separate ting. NS 3600 trenger at TG, årsak, konsekvens og tiltak henger sammen per avvik.

**Byggcon bør:**
- Bygge malstrukturen etter forskriftens bygningsdeler og rom, med obligatoriske punkter og krav om fullført før publisering. (Høy)
- Lage TG som en felles egenskap per avvik, med feltene årsak, konsekvens, tiltak og kostnadsintervall i kroner. Kostnadsintervallene bør bruke forskriftens grupper: under 10 000, 10–50 000, 50–100 000, 100–300 000 og over 300 000. (Høy)
- Ha et frasebibliotek per punkt med sortering etter «mest brukt». (Høy)
- Ha standardtekst om kontrollnivå per seksjon. (Middels)
- Ha import og eksport til regneark. (Middels)

### 5. Testinspeksjon, rapport, publisering, portal og reparasjonsliste

**Ny bestilling** har disse feltene:
- Inspektør, og om kunden har bedt om en bestemt inspektør
- Dato og tid
- Adresse (søk eller skjema med areal, byggeår og fundament)
- Kunde (også firma), kopi-e-post, notater, private notater og SMS-samtykke
- Tjenester, tillegg og rabatt
- Hendelser (Advanced)
- Om betaling kreves før rapporten frigis
- Kundens megler, selgers megler, andre personer
- Ordre-ID, henvisningskilde, bekreftet, slå av varsler, interne notater, V10 eller V9

**Oppdragssiden** viser kart og bygningsdata, vedlegg, interne felt og notater (kontornotater krever Advanced), closing-dato og opsjonsdato, personer med «Resend confirmation», egne lenker for kunde- og meglervisning, tjenester, avtaler (vis, endre, last opp, PDF), e-post med status, SMS, avgifter og betalinger (manuell avgift, mottatt betaling, faktura). Menyen har:
- Reschedule
- Reorder/Copy
- Cancel
- Print Order
- Konvertering mellom V9 og V10
- **Endringslogg** (hvem, når, hva)

**Rapportredigering:**
- I V10-editoren lastet ikke den nye rapporten min. Den ble trolig ikke bygget før den ble åpnet i mobilappen. Demo-rapporten fungerte. Der er det:
  - Seksjoner og punkter til venstre, og faner for Information, Limitations og Defects.
  - Per avvik: kategori (tre knapper), sted, rik tekst, anbefaling, «Provide Cost Estimate», bilde, video og 360.
  - Ikoner for å lagre tilbake til malen, sortere, duplisere, flytte, flagge og slette.
  - Søk med Ctrl+K, og at editoren fungerer uten nett.
- Jeg gjorde derfor om til V9 og skrev der. Jeg satte **TG2** på «Coverings», krysset av materialet «Tile» og avviket «Tiles Cracked». Stedet ble «Sørvendt takflate», jeg la til norsk tekst, og kostnadsestimatet ble min/maks $15 000–30 000.

**Publisering:** «Preview» viser nettrapporten med sammendrag, avvik og TG-rutenett. «Quick Publish» publiserer uten varsel. «Publish All» sender e-post.

**Portalen (testet anonymt som kunde):**
- Bestillingsdetaljer, legg til i kalender.
- Signere avtale. Jeg sendte inn initialene «KK» i det påkrevde feltet og krysset av for «I agree». Status ble «Signed».
- Betaling. Rapporten var låst («Make payment to unlock report»). Etter at jeg registrerte en manuell betaling ble den frigitt.
- Meglerlenken viser det samme.

**Reparasjonsliste (testet som kunde):**
- Filtre: alle, anbefalinger + TG3, eller bare TG3.
- Kunden velger avvik. Per avvik kan man legge inn **kreditt-beløp** og **kommentar**. Totalt krevd kreditt summeres.
- Dokumentnavn, sortering og innledningstekst.
- Forhåndsvisning, og «Create» lager et dokument.
- «Observations Copy-and-Paste Text» gir avvikene som tekst.

**Byggcon bør:**
- Lage en digital oppdragsavtale med e-signering. BankID er å foretrekke, avkrysning er minimum. Systemet bør lagre tid og IP. (Høy)
- Ha betalingsstyring, slik at rapporten frigis etter betaling eller av en megler som garanterer oppgjøret. (Middels)
- Ha portal med egne lenker for selger, megler og kjøper. Kjøperens tilgang bør styres via megler. (Høy)
- Ha endringslogg på oppdraget. Det er viktig ved reklamasjoner. (Høy)
- Ha reinspeksjon («utbedret siden forrige rapport»). (Middels)
- Lage reparasjonsliste og kostnadsoversikt for kjøper og megler, med NOK-intervall per TG2/TG3. Den kan brukes i budrunden. (Middels)

### 6. Kontakter, Metrics, Data og Reporting

**Kontakter:** fanene er Agents, Agent Teams, Agencies, Clients og People, med import og eksport.
- Meglerkortet har navn, e-post, kopi-e-post, to telefoner, SMS-samtykke, adresse, bursdag, bilde, meglerforetak, team, sosiale lenker og to typer notater (synlig for firmaet, og bare for admin).
- Listen viser antall oppdrag som henholdsvis kjøpers og selgers megler.
- Meglerprofil med omsetning, samtalelogg og oppgaver, samt merker, krever Advanced.
- Jeg opprettet «Mari Megler (TEST)».

**Metrics** viser demodata: oppdrag, henvisningskilder, toppmeglere, omsetning, mottatte betalinger, kart over oppdrag, partnerinntekt og inntekt fra online booking.

**Data Exports:**
- Oppdrag (fritt valgt periode eller år), avgifter, betalinger og gebyrer
- Ubetalte eller usignerte oppdrag
- Kjørelengde per år
- Programvaregebyrer
- Meglereksport og eksport av eksterne bestillinger

**Reporting** (next.spectora.com/reporting) har rapporter for meglere, omsetning og oppdrag. Datoforslagene er 30, 60 eller 90 dager, YTD og liknende, og rapportene kan lastes ned. Betalingsrapporten viste min manuelle betaling.

**Byggcon bør:**
- Lage et lett CRM for meglere og meglerforetak, med henvisninger og omsetning per megler og kontor, og notater. (Høy)
- Lage en liste over ubetalte og usignerte oppdrag. (Høy)
- Lage kjørebok-eksport. (Middels)
- Ha CSV-eksport av alt. (Middels)

---

## (c) Avanserte funksjoner og innstillinger Spectora er god på
1. **Prismotor** med modifikatorer (m², alder, avstand, postnummer), tillegg med egne modifikatorer, avgifter, rabatt og prisoppbygging som vises fortløpende.
2. **Detaljert automatisering** med av/på per rolle og kanal og fleksibel timing. Advanced legger til utløser, betingelse, forsinkelse og webhook.
3. **Portal og selvbetjening:** signering, betaling, rapport, reparasjonsliste og bestilling av tillegg i én flyt. Rapporten låses til betaling er mottatt.
4. **Malsystem** med egne vurderinger, kategorier, standardtekster, sted, fagfolk, bilde, sortering etter mest brukt, kloning, deling og import fra regneark.
5. **Kvalitetssikring:** krav om fullført før publisering, signatur per inspektør, endringslogg og varsel ved feil levering.
6. **Booking-kanaler:** intern bestilling, online booking, prisvidget, forespørselsskjema og tilbud som lagres som utkast. Kalenderen låses mens noen bestiller.
7. **Rettighetsmatrise** og organisasjonsverktøy for flere avdelinger.
8. **Åpenhet utad:** offentlig API (developer.spectora.com), iCal og Google Calendar, nattlig sikkerhetskopi til Drive og markedsplass for integrasjoner.
9. **Små ting som sparer tid:** stedsmerker, daglig e-post med timeplan, kart og kjørerute, «Reorder/Copy» av oppdrag, og automatisk henting av eiendomsdata.

## (d) KI
- **Maleditor – «Edit using AI»:** man skriver et funn og velger lengde (Normal, Short eller Long). Tjenesten `POST /api/v2/ai/comments` returnerer tittel, beskrivelse, alvorlighetsgrad (kategori), anbefalt fagperson og sted. Brukeren velger hvilke felt som skal tas i bruk. Det står en ansvarsfraskrivelse om å kontrollere resultatet.
- **Rapporteditor (V10):** «Edit this comment with AI» per kommentar, «Edit with AI» på informasjonspunkter og «Generate using AI» når man lager en ny kommentar. Det åpner et chat-panel med ledetekst, lengde og svartype, og brukeren velger med «Use selected».
- **Testresultat:** Den norske teksten «knuste takstein på sørvendt takflate, fuktmerker på undertak, vurder TG etter NS 3600» ga **engelsk** svar:
  - «Broken Roof Tiles with Moisture Damage»
  - alvorlighetsgrad «Major Concern»
  - fagperson «roof»
  - sted «South»

  KI-en forstår altså norsk og plukker ut strukturerte felt, men skriver ikke på norsk og kjenner ikke TG-logikken.
- **AI-tilkobling via MCP** (connect.spectora.com/mcp, med OAuth): Claude eller ChatGPT kan spørre i oppdrag, kunder og meglere, og lage oppsummeringer og dagsbriefer. Det finnes også et bibliotek med ferdige arbeidsflyter.

**Byggcon bør:** lage norsk KI som går fra stikkord eller diktering til ferdig avvik med TG-forslag, årsak, konsekvens, tiltak og kostnadsintervall. Takstmannen må alltid godkjenne. KI-en bør også kontrollere rapporten mot forskriftens minstekrav, altså en automatisk sidemannskontroll. I tillegg bør Byggcon tilby en MCP- eller API-tilkobling.

## (e) Topp 15 krav til Byggcons system
1. Oppdraget er navet, med personrollene selger/oppdragsgiver, megler og kjøper og egne lenker per rolle. (Høy)
2. Prismotor med BRA, byggeår, avstand og tillegg, MVA per linje og forhåndsvisning av totalpris. (Høy)
3. Faktura og betaling sendes til Visma eAccounting, med betalingsstatus og valg om at rapporten frigis etter betaling. (Høy)
4. Digital oppdragsavtale med plassholdere og påkrevde felt. E-signatur (BankID helst) som lagrer tid og IP. (Høy)
5. Automatiseringsmotor: utløser, betingelse, forsinkelse og handling (e-post, SMS, webhook, oppgave), med køvisning og feilvarsel. (Høy)
6. Maler med frasebibliotek etter forskriftens bygningsdeler. TG0–TG3 og TGIU per punkt og avvik, med årsak, konsekvens, tiltak og kostnadsintervall. (Høy)
7. Krav om fullført før publisering, ut fra forskriftens minstekrav. (Høy)
8. Nettleser- og mobileditor som virker uten nett, med bilder og stedsmerker. (Høy)
9. Portal med nettrapport og PDF, sammendrag med TG2/TG3 først, og kostnadsoversikt. (Høy)
10. Endringslogg på oppdrag og rapport. (Høy)
11. Norsk KI-skriving og automatisk kvalitetskontroll. (Høy)
12. CRM for meglere og meglerforetak med statistikk over henvisninger og omsetning. (Middels)
13. Online booking eller forespørselsskjema med egne felt (gnr/bnr, seksjon, egenerklæring mottatt). Tilbud lagres som utkast. (Middels)
14. Rettighetsmatrise per rolle og daglig e-post med timeplan. (Middels)
15. Eksport, rapporter og API/MCP: oppdrag, ubetalt eller usignert, kjørebok og meglerstatistikk. (Middels)

## (f) Opprettet eller endret i testkontoen
- **Tjeneste:** «Tilstandsrapport TEST» med kategori 4 Point, $9900 og 3 timer. Den har en modifikator (m² >150 og ≤250 gir +2000 og +1 time), tillegget «Arealmaaling BRA (test)» til $1500, avgiften «MVA» på 25 %, og malen og avtalen nedenfor koblet på.
- **Rabattkode:** BYGGCONTEST, 10 %, maks 20 bruk.
- **Avtale:** «Oppdragsavtale tilstandsrapport (TEST)» med påkrevde initialer.
- **Mal:**
  - Klonet til «Byggcon TEST – Tilstandsrapport NS 3600» med vurderingene TG0–TG3 og TGIU og kategoriene TG1–TG3.
  - Klikkingen min endret ved et uhell navnet på originalmalen «Residential Template». Den lagrer automatisk. **Jeg satte tilbake «Residential Template / Residential Report».**
- **Kontakter:** megleren «Mari Megler (TEST)» (mari.megler@example.com, 555-0100) og kunden «Kari Kjoper (TEST)» (kari.kjoper@example.com).
- **Inspeksjon:** Testveien 1, Bodø, 23.10.2026, ordre TEST-001. Den brukte én av to gratis prøveinspeksjoner.
  - Gjort om til V9 og bygget.
  - TG2 og avviket med sted, tekst og kostnad $15 000–30 000 lagt inn.
  - Publisert med «Quick Publish», uten varsler.
  - Avtalen ble signert som fiktiv kunde. Manuell betaling på $13 012,50 er registrert.
  - Reparasjonslisten ble åpnet. Jeg valgte ett avvik, men laget ikke noe dokument.
- **Innstillinger:**
  - Kostnadsestimat og reinspeksjon er slått **på**.
  - Online booking ble slått på for å teste, og så **av** igjen.
  - Automatiseringen «Client Reminder One» er **på** (2 dager før).
- **Demo-rapporten:** én avkrysning ble endret, og KI-forslag ble generert men ikke tatt i bruk.

Jeg startet ingen abonnement eller Advanced-prøve. Jeg la ikke inn betalingskort og koblet ikke til Stripe, Square, QuickBooks eller Google. Jeg endret ikke passord eller e-post på kontoen, og jeg rørte ikke SharePoint.
