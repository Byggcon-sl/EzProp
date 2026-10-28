# Kartlegging av SmartTakst (app.smarttakst.no)

Gjennomgått 24. oktober 2026 med Ståles konto, i testoppdraget [Ståles testadresse]. Funnene er observasjoner. De er ikke godkjent fagstoff. Skript, skjermbilder og lagrede data ligger i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/smarttakst/`.

---

## 1. Kort oppsummering

**Hva SmartTakst er:** et norsk takstprogram som bare finnes i nettleseren («laget av takstmenn, for takstmenn»). Det har 11 rapportmaler: tilstandsrapport etter NS 3600:2025, verditakst, skadetakst, reklamasjonstakst, befaringsnotat, forhåndstakst, boligoppmåling, uavhengig våtromskontroll, vedlikeholdsplan, standardbeskrivelse og forbefaring. Ved siden av rapportdelen har de en «samhandlingsportal» der takstmann, megler og kunde deler oppdrag, dokumenter og chat. Rapportnummeret vårt var 00022742, og nettsiden sier over 20 000 rapporter. Prisen er 190 kr per rapport (minst 2 i måneden), Basic 2490 kr i måneden for 20 rapporter, eller Pro 3690 kr i måneden uten grense. Betaling skjer med kort via Stripe.

**De 5 viktigste funnene:**

1. **Sjekklisten er et enkelt skjema med «hvis–så»-regler, og TG settes for hånd.** Malen har 10 seksjoner, 40 bygningsdeler og 279 spørsmål. 52 spørsmål vises bare når et annet svar har en bestemt verdi. Det skjer for eksempel ved «Ja», eller ved TG2/TG3, som åpner «Årsak/konsekvens», og ved TG3, som åpner «Kostnadsestimat». Valg av materiale eller alder gir **ingen** nye spørsmål og **ingen** forslag til TG. Alder er bare et ja/nei-spørsmål, for eksempel «Er undertak over 13 år?», og byggeåret er et fritekstfelt som ikke brukes til noe.
2. **Ferdige fraser filtreres etter valgt TG.** Malen har 887 fraser fordelt på 202 spørsmål. Velger du TG2, ser du bare fraser for TG2 (13 for yttervegger). Du kan krysse av flere fraser samtidig og lagre din egen tekst som ny frase. Dette sparer mye tid, og det er det beste ved løsningen.
3. **KI-funksjonen «Forbedre språk» er gratis og godt laget.** Den sender med seksjon, bygningsdel og spørsmål, og forslaget vises ved siden av din egen tekst. Du velger «Bruk forslaget», «Behold min tekst» eller «Nytt forslag», og du kan angre. Teksten sier rett ut at forslaget bare er språklig og at faglige vurderinger ikke er endret. En KI-kontroll av hele rapporten mot NS 3600 står i listen over funksjoner de jobber med.
4. **Det finnes ingen drift uten nett og ingen ekte app.** Siden har ingen bakgrunnslagring. Lastes siden på nytt uten nett, kommer en feilside. Trykker du «Lagre» uten nett, kommer bare «Oi.. Noe gikk galt». Det som er lagt inn, ble likevel lagret da nettet kom tilbake, men bare fordi siden ikke var lukket. Løsningen tilpasser seg iPad og mobil i nettleseren.
5. **Hver rapport eies av én takstmann.** Andre kan bare se rapporten («Visningsmodus. Bare eieren kan redigere»). Samarbeidet skjer i oppdraget: deltakere, chat, dokumenter og status. Det finnes ingen sidemannskontroll utover statusen «Til korrektur». Når du lagrer, sendes hele seksjonen til tjeneren. Lagrer to personer samme seksjon samtidig, vinner den som lagrer sist.

Andre viktige funn:
- Hver rapport har en egen kopi av malen. Rapporten er altså låst til malversjonen den ble startet med. Det er bra.
- De har et eget verktøy for plantegning som regner ut BRA-i, BRA-e, BRA-b, åpent areal og ALH automatisk.
- Rapporten har en offentlig side for gyldighet med QR-kode.
- Malen har flere feil i logikken. Se kapittel 3.6.

---

## 2. Skjerm for skjerm

### 2.1 Venstremenyen
Menyen har Oppdrag, Kontakter, Profil, Rapporter, Legg til kontakt og Faktura. Hjelpesenter og Endringsønsker åpner en ekstern side (Featurebase), og Logg ut ligger nederst. Nede i hjørnet er det en chat med kundestøtte (Tidio). På iPad blir menyen en «hamburgermeny» øverst.

**Innlogging:** e-post og så passord (Firebase). Skriver du en ukjent e-post, lages det en ny konto automatisk, med rollen *takstmann* eller *bestiller*. Rollen kan ikke endres senere. Kunden kommer inn via en lenke i e-post uten å logge inn.

### 2.2 Oppdrag (`/assignments`)
- **Listen** har søk på adresse eller postnummer, filter på status og sortering «Etter status» eller «Sist oppdatert». Oppdragene er gruppert etter status. Hver rad viser adresse, matrikkel, sist oppdatert og status.
- **«Opprett oppdrag»** er en veiviser i tre steg:
  1. **Eiendom:** søk i Ambita på adresse, matrikkel eller eiernavn. Treffet viser matrikkel og eiernavn («Hentet fra Ambita»). Du kan også «Fyll inn manuelt» eller «Rediger adresse og matrikkel».
  2. **Parter:**
     - *Kunde* (valgfri): får e-post med lenke og kan chatte. Hjemmelshaveren fra Ambita foreslås.
     - *Bestillere*: følger oppdraget.
     - *Takstmenn*: du legges til selv, og du kan finne flere.
  3. **Avtale:**
     - frist
     - hvem som betaler, *bestiller* eller *kunde* (påkrevd, men bare til informasjon for takstmannen)
     - *oppdragsdetaljer*, en flervalgsliste med for eksempel «Tilstandsrapport: Enebolig … under 300 m²», «… over 400 m²», «Fritidsbolig med/uten våtrom», leilighetstyper, «Planskisser med/uten målsatte vegger» og «Standardbeskrivelse»
     - fritekst «Info til takstmann», for eksempel om nøkler eller adkomst

  Jeg gikk gjennom alle stegene, men trykket ikke «Opprett».
- **Oppdragssiden** har tre faner:
  - *Framgang*: status, «Åpne rapport», befaringsdato, og opplasting av takstrapport (maks 10), plantegning og vedlegg (maks 15) og faktura (maks 2). Alt kan lastes opp som fil eller legges inn som lenke.
  - *Oppdragsdetaljer*: hvem som betaler.
  - *Dokumentasjon*: der megler eller selger legger kommunepakke, egenerklæring og liknende.

  Til høyre står «Deltakere» med navn, rolle, e-post, telefon og «Fjern meg fra oppgaven», og under det «Kommunikasjon», en chat for alle parter. ⋮-menyen har Endre og Slett.
- **Statusflyten** er manuell, med seks valg: Ikke påbegynt → Under arbeid → Til korrektur → Satt på vent → Har ikke tid → Ferdig. Statusen er det megleren følger med på. Ifølge hjelpesiden betyr «Til korrektur» at utkastet er sendt til gjennomgang. Megleren kan også sette oppdraget tilbake til takstmannen med den statusen.

### 2.3 Rapporter (`/reports`)
- Listen er gruppert i «Under arbeid» og «Ferdige» og viser adresse, rapporttype, status (Utkast) og boligtype.
- **«Opprette ny rapport»**: du søker i Ambita (adresse, matrikkel og eiernavn) eller velger «Velg adresse manuelt». Deretter velger du boligtype og rapportmal. Rapporten er uavhengig av oppdraget og kobles til det etterpå, eller lages fra oppdraget.
- **Rapportsiden** viser øverst adresse, boligtype, matrikkel, eiere (fra Ambita) og fremdrift i prosent. Under ligger én flis per seksjon med statusen IKKE STARTET, UNDER ARBEID eller FULLFØRT og en egen fremdriftslinje.
- **Knapper:**
  - «Ferdigstill rapport» krever abonnement. Den er **ikke** trykket.
  - «Gå til oppdrag».
  - ⋮-menyen har «Hent utkast PDF», «Marker rapport som gyldig», «Kopier rapport» og «Slett rapport».
- **Nederst** ligger en fast linje med «Notat» og «Lagre». Den viser også lagringsstatus: «Lagrer…», «Ulagrede endringer» eller «Alle endringer lagret kl. …».

### 2.4 Kontakter og «Legg til kontakt»
- **Kontakter** er din egen liste, med søk. Den var tom.
- **«Legg til kontakt»** åpner «Finn kontakter». Det er en katalog over **alle brukere som har valgt å være synlige**, både takstmenn og bestillere. Den viser navn, firma, rolle, e-post, telefon og postnummer de dekker, og har 74 sider. Du kan trykke «Legg til» på en person. Fanen «Opprett kontakt» har bare e-post og telefon. Jeg lagret ingenting, fordi skjemaet ser ut til å sende en invitasjon.
- Det finnes ingen kundehistorikk, og ingen CRM ut over denne listen.

### 2.5 Profil
Profilen har disse feltene: bilde av deg, fullt navn, e-post, telefon, beskrivelse, firmalogo, selskap, organisasjonsnummer, adresse, postnummer og by. I tillegg kommer postnumrene du dekker («Legg til»). Det er tre avkrysninger:
- synlig for meglere, med teksten «klikkavgift fra Smarttakst på kr 200,- inkl mva per mottatte oppdrag»
- mesterlogo i rapporten
- NITO-logo i rapporten

Ingenting er endret. Profilen brukes også på takstmannssiden i PDF-en. Profilen har et skjult felt for om brukeren er tilgjengelig for Visma. På nettsiden nevner de Visma CORE og Visma Broker, som er meglersystemer.

### 2.6 Faktura (`/subscriptions`)
- Overskriften er «Faktura og abonnement». Siden viser tre kort med «Velg plan»: Pro 3690 kr/mnd, «Per report» 190 kr/mnd* (minst 2 rapporter) og Basic 2490 kr/mnd (20 rapporter).
- Under står «Tidligere abonnementer», «Ferdige rapporter» og «24/7 service tidligere abonnement». Den ene tjenesten svarte med en feil (500).
- **Dette er bare SmartTakst sitt eget abonnement.** Betalingen går via Stripe. Takstmannen kan laste ned sine egne fakturaer og få beskjed som «Betal innen 24 timer ellers vil abonnementet utløpe».
- Det finnes **ingen** fakturering av kundene dine og ingen kobling til regnskapssystem (Fiken, Tripletex eller Visma regnskap). Fakturaen til kunden er bare en PDF du laster opp i oppdraget.
- Det er ingen registreringsgebyr. Kostnadene er klikkavgiften på 200 kr hvis du vil være synlig for meglere, og at du må ha abonnement for å ferdigstille. Hver rapportmal har et internt prisfelt (249 kr for tilstandsrapport, 149 for våtromskontroll og 39 for standardbeskrivelse). Jeg vet ikke hva det brukes til.

### 2.7 Hjelpesenter (Featurebase)
Det er 20 korte artikler, for eksempel:
- profil og roller
- slik oppretter du rapport
- veiledning for tilstandsrapport (en god sammenstilling av forskriften og NS 3600:2025)
- TG-nivåene
- areal
- fraser og «Forbedre språk»
- ferdigstilling og gyldighet
- forhåndsvisning
- markering i bilder
- plantegning
- kobling mellom rapport og oppdrag
- notat
- bestille, motta og styre oppdrag
- dokumentasjon og chat

Funksjoner jeg fant bare i hjelpen:
- Rapporten er gyldig i 1 år. Gyldigheten kan endres for hånd, og det vises offentlig om rapporten er gjort ugyldig.
- Utkast-PDF skal sendes til eieren til kontroll før ferdigstilling.
- Kunden kan laste opp dokumenter og chatte via lenken.

### 2.8 Endringsønsker (Featurebase-tavle)
Brukerne stemmer på ønsker. Det som står der (stemmene er få, 1–3):
- integrasjon med meglersystemet Next
- kart og kjøretid i oppdraget
- egen «ferdig»-knapp per post
- KI-analyse av rapporten mot NS 3600:2025 før ferdigstilling
- markering i bilder
- enklere oppretting av oppdrag
- verktøy for planskisse
- lage rapport fra oppdraget
- flere takstmenn på én rapport
- notat per rapport
- KI-skrivehjelp
- ny PDF med forsidebilde
- kopiering av rapporter
- mal for næringstakst

Ønsket om en «ferdig»-knapp forteller noe viktig. Brukeren skriver at når alt er besvart, betyr ikke det at teksten er ferdig. Etter en pause må hun gå gjennom alle punktene på nytt.

### 2.9 Selve tilstandsrapporten, seksjon for seksjon
Malen heter «Tilstandsrapport NS3600:2025» og gjelder både hus og leilighet. Jeg så samme mal for begge.

| Seksjon | Bygningsdeler (blokker) |
|---|---|
| Generell informasjon | Informasjon om oppdraget, Boliginformasjon, Dokumentasjon, Lovlighet (fast med) |
| Fundament og grunnmur | Grunnmur/fundamenter, Drenering, Krypkjeller, Rom under terreng, Forstøtningsmurer, Radonsikring, Geologiske forhold, Annen bygningsdel |
| Vegg og fasader | Yttervegger/fasader, Vinduer/dører, Balkong/terrasse, Annen bygningsdel |
| Takkonstruksjon | Takkonstruksjon, Loft, Taktekking og beslag, Takrenner og nedløp, Annen bygningsdel |
| Våtrom | Våtrom (kan gjentas: bad, vaskerom, toalettrom osv. får eget navn) |
| Innvendig konstruksjon | Piper/ildsteder, Etasjeskiller, Innvendig trapp, Kjøkken, Ventilasjon, Elektrisk anlegg og samsvarserklæringer, Slokke- og brannvarsling, Innvendige overflater, Annen bygningsdel; fast med: Innvendige vann og avløpsrør, Oppvarming, Skadedyr |
| Areal | Arealinformasjon (per etasje), Plantegning |
| Garasjeanlegg | Garasjeplass, Bod |
| Verdi og beskrivelse | Verdisetting (markedsverdi, teknisk verdi, tomteverdi, grunnlag, kilder, sammenlignbare salg) |
| Ekstra bygg | Frittstående byggverk |

**Slik jobber du:**
- Trykk «Legg til [bygningsdel]», og gi den et navn, for eksempel «Bad 1. etasje».
- Fold blokken ut. Den viser en teller for besvarte spørsmål, for eksempel «Bad 1. etasje (7/22)».
- Hvert spørsmål ligger på et eget kort. Spørsmålet har Ja/Nei-knapper, en nedtrekksliste eller en TG-velger, og et kommentarfelt med knappene «Bruk ferdig frase», «Forbedre språk» og «Lagre som ny ferdig frase».
- Spørsmålstypene er Ja/Nei (102), fritekst (71), nedtrekk (27, mange med flervalg), TG (33), bilde (37), tall (3) og dato. I tillegg finnes egne felt for eiere, adresse, matrikkel, areal og plantegning.
- Mange spørsmål har en «?» med hjelpetekst.
- Hver blokk og hvert gjentatt spørsmål har en ⋮-meny med «Endre» (gi nytt navn) og «Slett».
- Nye blokker legges øverst.

**Rom og romtyper:** sjekklisten har **ingen romtyper**. Våtrom er én blokktype som gjentas med fritt navn. Romtyper finnes bare i plantegningsverktøyet, med 18 typer: entré, gang, stue, kjøkken, stue/kjøkken, soverom, bad, WC, innredet rom, vaskerom, bod, ekstern bod, teknisk rom, kontor, loftstue, garasje, trapp/svalgang og «ikke spesifisert». Rommene er **ikke** koblet til sjekklisten. Tegner du et bad, dukker det ikke opp noe i Våtrom. Badstue finnes ikke som type.

**Målefelt:** det er ingen felt for måleverdier, for eksempel fuktmåling i prosent, fall i millimeter eller høyde på rekkverk. Det står bare «Er det utført fuktmåling / hulltaking …?» Ja/Nei med kommentar. De eneste tallfeltene er areal per etasje (BRA-i, BRA-e, BRA-b, åpent areal og ALH, hver med beskrivelse) og verdisettingen.

**Avvik, årsak, konsekvens, tiltak og kostnad:**
- TG2 og TG3 åpner fritekstfeltet «Årsak/konsekvens».
- TG3 åpner i tillegg «Kostnadsestimat», en liste med fem intervaller: under 10 000, 10–50 000, 50–100 000, 100–300 000 og over 300 000. TG2 gir **ikke** kostnadsfeltet.
- Tiltak legges inn med «Legg til Anbefalte tiltak / ytterligere undersøkelser anbefales?» (Ja/Nei med kommentar). Det kan gjentas, men er ikke koblet til TG.
- Fare for helse, miljø og sikkerhet (HMS) er et fritekstfelt «HMS vurdering» i noen blokker, for eksempel terrasse, pipe, trapp, elektrisk anlegg, radon, geologi og forstøtningsmur.

**Fraser og maler:**
- Fraser ligger per spørsmål og velges med avkrysning. For TG-spørsmål vises bare fraser for valgt TG. Fritekstfelt som «Hindringer på befaringsdagen» og «Overordnet faglig vurdering» har også fraser.
- Malen kan ikke endres av brukeren. Det finnes ingen malredigering i appen.
- I PDF-en ligger 15 faste tekstdeler, for eksempel «Om rapporten», «Levetidsbetraktninger», «Nivå av analysen», «Eiers plikter» og «Oppsummert».

**Bilder:**
- «Legg til Bilde» lar deg dra inn eller velge flere bilder samtidig.
- Hvert bilde får et kommentarfelt og to knapper: markering (blyant) og slett.
- Markeringsverktøyet har Velg, Flytt, Pil, Ramme, Sirkel, Tegn, Tekst, «Mer» og zoom. Den markerte versjonen brukes i rapporten.
- Forsidebilde legges inn under Boliginformasjon.

**KI:**
- «Forbedre språk» finnes på alle tekstfelt. Det krever et visst antall tegn før det virker.
- Eksempel: «Fiktivt testavvik: råte i nedre del av kledning på nordvegg. Kan gi fuktinntrengning i veggen.» ble til «Det er registrert råte i nedre del av kledning på nordvegg. Dette kan medføre fuktinntrengning i yttervegg.»
- Du kan gi tilbakemelding med «Nyttig?». Det kostet ingenting, og ingen melding om betaling dukket opp.
- KI lager ikke utkast til selve vurderingen, og den foreslår ikke TG.

**Kontroll før levering:**
- tellere per blokk og prosent per seksjon og rapport
- meldingen «Vennligst fyll ut alle obligatoriske felter»
- rapporten har feltet `isValid` (var «false»)

Det finnes ingen egen sjekkliste for faglig kontroll, og ingen sidemannskontroll. Plantegningen har en egen «Kontroller»-liste, for eksempel «Noen vegger er ikke koblet i begge ender» og «Ett eller flere rom mangler navn», med «Gå til».

**Forhåndsvisning:** «Hent utkast PDF» stoppet med feilen `PROFILE_IS_EMPTY` («Company logo», «User avatar»). Det må altså være firmalogo og profilbilde i profilen før utkastet kan lages. Jeg endret ikke profilen fordi det er utenfor testoppdraget, så jeg har **ikke** sett PDF-en. Ståle kan legge inn logo og bilde hvis vi skal se den.

**Egenerklæring:** det finnes ikke noe eget skjema. Under Dokumentasjon står «Er selgers egenerklæring kontrollert?» (Ja/Nei, med 7 fraser) og «Når ble egenerklæringen signert?» (fritekst). Selve dokumentet lastes opp i oppdraget.

**Sammendrag:** det er ingen egen skjerm for sammendrag. Brukeren fyller ut fritekstfeltet «Overordnet faglig vurdering» (med fraser) under Boliginformasjon. PDF-en har en fast del «Oppsummert», og den lages trolig av TG-ene. Det har jeg ikke kunnet se.

**Notat:** knappen «Notat» åpner en privat logg i chat-form for rapporten, med tekst og bilder. Den kommer aldri med i rapporten.

**Plantegning** (Areal → Plantegning → «Opprett»):
- Du tegner med verktøyene Vegg, Dør, Vindu, Åpning, Trapp, Pipe/sjakt, Symboler, Uteareal, Mållinje og Merknad, per etasje.
- Når veggene møtes, blir det et rom, og arealet regnes ut med en gang. Rommet mitt på 3,7 m² ble BRA-i.
- Du kan bruke en gammel tegning som bakgrunn, eksportere til PDF eller JPEG og hente arealene inn i arealfeltene.
- Tegningen følger **ikke** med i rapporten.

**Lagring:** endringer lagres automatisk etter en liten pause, og også når du trykker «Lagre». Hver lagring sender **hele seksjonen** til tjeneren.

**Kopier rapport:** du velger om eiendom og eiere skal hentes fra Ambita på nytt og om notatene skal kopieres. Etterpå vises en liste over hva som ble endret, for eksempel når malen har endret seg siden originalen.

**Gyldighetsside:** hver rapport har en offentlig side (`/reports-validity/<id>`) med QR-kode, statusen GYLDIG eller IKKE GYLDIG, «gyldig til» og en hendelseslogg (opprettet, ferdigstilt, ugyldiggjort).

---

## 3. Logikken for kontrollpunkter og TG (det viktigste)

### 3.1 Datamodellen
Mal → seksjon → blokk (bygningsdel) → spørsmål.
- Hvert ledd kan gjentas eller ikke, og har en største og minste mengde.
- Hvert spørsmål har:
  - type
  - svaralternativer
  - kommentarfelt, enten alltid eller bare ved bestemte svar, for eksempel «Annet»
  - en gruppe ferdige fraser
  - hjelpetekst
  - én enkel betingelse, `showIfQuestionHasValue: {questionId, value:[…]}`
- Rapporten lagrer en **kopi av hele malen** når den opprettes. Den kopien heter `templateSnapshot`. Svarene lagres per spørsmål som verdi pluss kommentar.

### 3.2 Hva styrer hvilke kontrollpunkter du får
- **Bygningstype:** samme mal brukes for hus og leilighet. Boligtypen er bare et nedtrekksvalg med 18 typer og styrer ingen spørsmål.
- **Rom:** styrer ingenting. Du legger selv til blokker.
- **Materialvalg:** styrer **ingenting**. Unntaket er at «Annet» åpner et kommentarfelt.
- **Ja/Nei-svar og TG:** styrer oppfølgingsspørsmål. Se tabellen.

### 3.3 Valg → hva som dukker opp (testet i [Ståles testadresse])

| Valg | Dette dukker opp |
|---|---|
| Fasade = «Liggende trekledning» (eller annen kledning) | Ingenting nytt |
| Taktekking, fundamenttype, oppvarming, rør, pipetype | Ingenting nytt (bare «Annet» gir kommentarfelt) |
| Byggeår = 1978 | Ingenting (fritekst, brukes ikke) |
| Alle TG-spørsmål: TG0 eller TG1 | Bare kommentar og fraser for valgt TG |
| TG2 | + «Årsak/konsekvens» (fritekst) |
| TG3 | + «Kostnadsestimat» (5 intervaller) + «Årsak/konsekvens» |
| TGIU | Bare kommentar (ingen fraser, ingen årsak) |
| Våtrom: «Utført arbeider etter byggeår?» = Ja | + «Har selger dokumentasjon …?» (teller 17 → 18) |
| Våtrom: «Innebygget sisterne?» = Ja | + «Drenshull fra sisternekassen?» (18 → 19) |
| Balkong: «Etablert rekkverk?» = Ja | + «Rekkverkshøyde og åpninger etter dagens forskrift?» (6 → 7) |
| Balkong: «Tekket?» = Ja | + «Krav til fall/avrenning?» (7 → 8) |
| Loft: «Endringer etter byggeår?» = Ja | + «Kan arbeidet dokumenteres?» |
| Loft: «Konstruksjonen inspisert?» = Ja | + «Funnet avvik ved inspeksjon?» |
| Pipe: «Rapport fra brann/feiervesen?» = Ja | + «Påvist avvik som ikke er lukket?» |
| Vann/avløp: «Hovedstengekran lokalisert?» = Ja | + «Funksjonstestet?» |
| Vann/avløp: «Varmtvannsbereder kontrollert?» = Ja | + «Totalvurdering av varmtvannsbereder» (TG) |
| Skadedyr: «Hatt skadedyr?» = Ja | + «Er det gjort tiltak?» |
| Dokumentasjon: «Egenerklæring kontrollert?» = Ja | (Spørsmålet om signeringsdato er alltid synlig) |
| Krypkjeller: «Inspisert?» = Ja / Nei | Ja: ventilasjon, fuktsperre, TG, tiltak, bilde. Nei: «Tegn til ventilering utvendig (ventiler i ringmur)?» (fra malen, ikke testet i skjermen) |
| Drenering: «Arbeid etter byggeår?» = Ja | + «Kan arbeidet dokumenteres?» (fra malen) |
| Ventilasjon = «Naturlig» / «Balansert» | Skulle gitt «Gjennomstrømning av tilluft» / «Plassering av luftaggregat», men **ingenting skjer**. Se feil under. |

### 3.4 Settes TG automatisk?
**Nei.** TG velges alltid for hånd fra en liste. Det er ingen regel mellom svar og TG. Svarer du for eksempel «Ja» på «Fuktskade/sopp/råte?», foreslås ingen TG. Alderen tas med som ja/nei-spørsmål («Er undertak over 13 år?», «Er dreneringen eldre enn 30 år …?»), men det gir ingen TG. Byggeåret brukes ikke. «Levetidsbetraktninger» er bare fast tekst i PDF-en som viser til Byggforsk 700.320. Hjelpeteksten deres forklarer selv tillegg C i NS 3600:2025 om alderskriterier for TG2, men det er ikke bygd inn i programmet.

### 3.5 Kostnad, tiltak og HMS
Kostnadsanslag finnes bare ved TG3 og bare som intervall. Tiltak er et Ja/Nei-felt med fritekst som ikke er knyttet til avviket. HMS er fritekst uten TG, og det står bare på noen bygningsdeler.

### 3.6 Feil og svakheter i malen (konkrete)
- **Feil i betingelsene for ventilasjon:** betingelsen ser etter verdien «Naturlig_ventilasjon» og «Balansert-ventilasjon», men listen lagrer «Naturlig ventilasjon» og «Balansert ventilasjon». Derfor vises oppfølgingsspørsmålene aldri. Dette viser hvor skjør logikk basert på tekst er.
- **TG-verdiene er skrevet ulikt:** noen steder «TG2», andre steder «TG 2». Betingelsene må derfor skrives for hver variant.
- **«Totalvurdering av fuktsøk»** mangler TG1. Valgene er TG 0, 2, 3 og IU.
- **Elektrisk anlegg har fortsatt et TG-felt**, selv om deres egen hjelpetekst sier at elektrisk anlegg ikke lenger skal ha TG etter NS 3600:2025.
- **Ekstra bygg:** «Årsak/konsekvens» er et Ja/Nei-spørsmål, ikke tekst.
- **Fritekst der det burde være tall:** byggeår og tomt (m²) er fritekst.

---

## 4. Styrker: hva SmartTakst gjør bedre enn IVIT

1. **Fraser filtrert på valgt TG og knyttet til hvert spørsmål.** IVIT har en løs frasebank som ikke er koblet til punkt eller TG.
2. **Gratis KI for språk** med tydelige valg og angre. IVIT tar 169 kr per rapport for KI.
3. **Rapporten låses til malversjonen.** IVIT endrer sjekkpunkter sentralt uten varsel.
4. **Plantegning med automatisk areal** etter de nye arealbegrepene, og arealene kan hentes inn i rapporten.
5. **Offentlig side for gyldighet med QR-kode** og hendelseslogg.
6. **Kopier rapport** med en tydelig liste over hva som endret seg.
7. **Privat notat per rapport**, med bilder.
8. **Enkel og ryddig skjerm:** én seksjon om gangen, tellere per blokk og tydelig lagringsstatus («Alle endringer lagret kl. …»).
9. **Hjelpen er på norsk og faglig god**, og den åpne tavlen for ønsker viser hva de jobber med.
10. **Ambita-oppslag** fyller ut matrikkel, hjemmelshavere, tomtetype og tomteareal automatisk.

## 5. Svakheter

1. **Ingen drift uten nett** og ingen ekte app. Det er bare nettleser. Uten nett får du bare en generell feilmelding.
2. **Ingen automatisk TG**, ingen bruk av alder eller levetider og ingen målefelt.
3. **Materialvalg styrer ingenting.** Sjekklisten er den samme for murhus og trehus, og for hus og leilighet.
4. **Logikken i malen er skjør**, med betingelser som ikke slår til. Se 3.6.
5. **Kostnad bare ved TG3**, og tiltak er ikke koblet til avviket.
6. **Én eier per rapport.** Det er ingen sidemannskontroll og ingen samtidig redigering, og hele seksjonen overskrives ved lagring. Under testen ble to blokker av typen «Grunnmur / fundamenter» lagt inn i rapporten kl. 17.25 av noen andre enn meg. Det viser at flere kan skrive i samme rapport uten at det er synlig eller varslet.
7. **Utkast-PDF er låst** til profilen har logo og bilde. Det er ingen forhåndsvisning inne i appen.
8. **Ingen faktura til kunden og ingen kobling til regnskap.** Fakturaen er en PDF du laster opp.
9. **Ingen direkte levering til meglersystem** i appen. Levering skjer ved at PDF-en lastes opp i oppdraget, og så åpner megler og kunde den der. Nettsiden nevner Visma Broker og Visma CORE, men jeg så det ikke i appen.
10. **Personvern:** kontaktkatalogen viser e-post og telefon for alle synlige brukere til alle innloggede.
11. **Mindre ting:**
    - Byggeår og tomt er fritekst.
    - «Lagre som ny ferdig frase» vises også på byggeår.
    - Engelske koder vises i feilmeldinger («PROFILE_IS_EMPTY»).
    - Tjenesten for tidligere abonnementer feiler (500).

---

## 6. Sammenligning med IVIT og Spectora

| Tema | SmartTakst | IVIT | Spectora |
|---|---|---|---|
| Plattform | Bare nettleser, tilpasset iPad og mobil | Nett og iPad, egen admin-app | Nett og egen iPad/mobil-app |
| Uten nett | Nei | Ja, men med kjente tap ved synkronisering | Ja (app) |
| Mal og sjekkliste | Fast mal fra SmartTakst, 279 spørsmål, låst per rapport | Sentral sjekkliste som endres uten varsel | Egne maler, kan deles og klones mellom firma |
| TG-forslag | Nei, alltid manuell | Delvis (forhåndsdefinerte avvik), ingen alderslogikk sett | Nei TG, men «classic ratings» med automatiske kommentarer |
| Logikk | Enkle «vis hvis»-regler (52), ikke styrt av materiale | Sjekkpunkter med avvik | Valg som skjuler og viser kommentarer |
| Fraser | Per spørsmål, filtrert på TG, egne fraser | Løs frasebank (507 egne), ikke koblet til punkt | Kommentarbibliotek per punkt |
| KI | Gratis språkforbedring | 169 kr per rapport | Begrenset |
| Kostnadsanslag | 5 intervaller, bare TG3 | Ja | Min–maks per avvik |
| Bilder og markering | Ja, godt verktøy | Ja | Ja |
| Plantegning og areal | Eget tegneverktøy med arealberegning | Nei (sett) | Nei |
| Samarbeid | Oppdrag med chat; én eier per rapport | Firmaoppsett, roller | Flere takstmenn, deling av maler |
| Sidemannskontroll | Bare status «Til korrektur» | Godkjenning (tom skjerm) | Nei |
| Levering | PDF lastes opp i oppdraget; kundelenke; QR-side | Meglerintegrasjon (klikkpris) | Nettrapport med visningslogg |
| Faktura til kunde | Nei (bare opplasting av PDF) | Fakturaer-fane | Betaling i systemet (USA) |
| Pris | 190 kr/rapport, 2490 eller 3690 kr/mnd | Klikkpriser per produkt | Månedspris (USA) |

---

## 7. Hva EzProp bør ta med (prioritert)

**Høy**
1. **Fraser knyttet til kontrollpunkt og TG**, med flervalg og egne fraser. Frasene må godkjennes av fagansvarlig før de deles i firmaet.
2. **Én versjon av malen per rapport** (kopi eller versjonsnummer), og en liste over endringer ved kopiering.
3. **Regler for «vis hvis» som bruker faste koder, ikke tekst.** Vi bør teste reglene automatisk, slik at feil som ventilasjonsfeilen hos SmartTakst ikke kan skje. Bruk ett format for TG overalt (TG0–TG3, TGIU).
4. **Valg av materiale skal styre kontrollpunktene.** Forhåndsvis TG ut fra materiale og alder (levetider), og vis forslaget med begrunnelse slik at takstmannen godkjenner. SmartTakst mangler dette helt, og det er vår største mulighet.
5. **Lagring uten nett** som fungerer i nettleseren på iPad, med tydelig status per endring. Lagre på feltnivå, ikke hele seksjonen, slik at flere kan jobbe samtidig uten å skrive over hverandre.
6. **Årsak, konsekvens, tiltak og kostnad på samme avvikskort.** Kostnad bør også kunne gis ved TG2. Fagansvarlig må sjekke hva forskriften krever. Tiltak skal kobles til avviket.
7. **KI som forbedrer språk på hvert felt**, med «bruk, behold, nytt forslag» og angre. Senere kommer KI-utkast til vurdering og en KI-kontroll før levering, og takstmannen godkjenner alltid.
8. **Sjekkliste før levering:** obligatoriske felt, TG2/TG3 uten årsak, TG3 uten kostnad, manglende bilde og egenerklæring som ikke er kontrollert. Til slutt kommer sidemannskontroll med godkjenning.

**Middels**
9. **Målefelt med tall og enhet**, for eksempel fukt i prosent, fall i millimeter og høyde på rekkverk, som kan gi TG-forslag.
10. **Rom med romtyper** (bad, vaskerom, toalettrom, badstue og så videre) som henter riktige kontrollpunkter.
11. **Areal per etasje** med BRA-i, BRA-e, BRA-b, åpent areal og ALH, og en sum.
12. **Markering i bilder**, bildekommentar og forsidebilde.
13. **Privat notat per rapport.**
14. **Offentlig gyldighetsside med QR-kode** og hendelseslogg.
15. **Ambita eller tilsvarende oppslag** for matrikkel og hjemmelshavere.
16. **Status for oppdraget** som megler ser, og en kundelenke uten innlogging for dokumenter og chat.

**Lav**
17. Verktøy for plantegning (fint, men stort å bygge).
18. Katalog der meglere kan finne takstmenn (passer ikke vår modell).
19. Mester- og NITO-logo i PDF-en.

**Lærdom (ikke gjør):** ikke lås forhåndsvisningen bak profilfelt. Ikke bland fritekst og tall. Vis ikke andres kontaktinformasjon uten samtykke og behov.

---

## 8. Alt jeg har opprettet eller endret i kontoen

Alt ble gjort i oppdraget og rapporten **[Ståles testadresse]**. Alle navn og tekster er merket «fiktiv» eller «Fiktivt».

**Oppdraget**
- Status endret fra «Ikke påbegynt» til «Under arbeid».

**Rapporten (utkast, ikke ferdigstilt)**
- **Vegg og fasader:**
  - «Yttervegger hovedhus»: alle svar fylt ut, TG2, fraser, årsak/konsekvens, tiltak med fiktivt kostnadsanslag og ett generert testbilde (`testbilde.jpg`, en brun flate med teksten «TESTBILDE»).
  - «Vinduer og dører (fiktiv)» lagt til.
  - «Terrasse vest (fiktiv)» med TG3 og kostnadsintervall under 10 000.
- **Takkonstruksjon:** «Tak hovedhus (fiktiv)», «Loft (fiktiv)» (TG1), «Taktekking (fiktiv)» og «Renner (fiktiv)».
- **Våtrom:**
  - «Bad 1. etasje (fiktiv)»: vanntett sjikt TG2, overflater TG0, membran TG3 med kostnad 50–100 000, sanitær TG2 og fuktsøk TGIU.
  - «Vaskerom kjeller (fiktiv)»: to svar.
- **Innvendig konstruksjon:**
  - Lagt til «Pipe (fiktiv)», «Kjøkken (fiktiv)», «Ventilasjon (fiktiv)» (Naturlig) og «Elektrisk (fiktiv)».
  - Svart på noen spørsmål om vann/avløp og skadedyr.
- **Garasjeanlegg:** «Garasje (fiktiv)» og «Bod (fiktiv)».
- **Verdi og beskrivelse:** «Verdi (fiktiv)» (tom).
- **Ekstra bygg:** «Uthus/bod (fiktiv)» med TG3.
- **Generell informasjon:** byggeår satt til **1978 (fiktiv verdi, må rettes)** og «Egenerklæring kontrollert» = Ja.
- **Areal:** etasjene «1. etasje» (BRA-i 95, BRA-e 8 «Bod utvendig») og «Kjeller» (BRA-i 40), alle med fiktive beskrivelser.
- **Plantegning:** ett rom på 3,7 m² med romtype Bad på 1. etasje.
- **Notat:** «Fiktivt testnotat fra kartlegging (kan slettes).»
- **KI:** «Forbedre språk» brukt 3 ganger (gratis).

**Ikke gjort av meg:** to blokker av typen «Grunnmur / fundamenter» (én med «Multimur») ble lagt inn kl. 17.25 av noen andre.

**Ikke endret:** profil, abonnement, kontakter (fortsatt 0), andre oppdrag og frasebanken. «Lagre som ny ferdig frase» er ikke brukt.

## 9. Bekreftelse

- Jeg har **ikke** ferdigstilt, signert, låst, merket som gyldig, sendt, levert eller registrert rapporten. Status er «Utkast», `payment` er tom, `completedAt` er tom og det finnes ingen PDF.
- Jeg har ikke trykket «Velg plan», ikke lagt inn betalingskort og ikke startet abonnement. Abonnement er fortsatt «ingen».
- Jeg har ikke laget eller lastet opp fakturaer, ikke opprettet nye oppdrag og ikke invitert kunder eller kontakter.
- Jeg har ikke sendt noe via Endringsønsker, hjelpesenteret eller chatten.
- Avkrysningen for synlighet overfor meglere (klikkavgift 200 kr) er ikke rørt.
- «Hent utkast PDF» ble forsøkt, men stoppet fordi profilen mangler logo og bilde. Det ble ikke laget noen PDF.
- Ingenting har kostet penger, så langt jeg kan se.
- Passordet er ikke skrevet i skript, logger eller i denne rapporten.
- Jeg har ikke laget nye innloggingsfiler. Bare den opprinnelige `state.json` finnes.
- Arbeidsmappen inneholder kopier av rapportdata (`report*.json`) med hjemmelshavernes navn. De kan slettes når de ikke trengs lenger.
