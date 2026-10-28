# Kartlegging av SmartTakst (app.smarttakst.no)

Sist oppdatert: 24.10.2026
Status: Utkast – observasjoner, ikke godkjent fagstoff.
Kilde: En Claude-hjelpeagent gikk gjennom SmartTakst 24.10.2026 med Ståles brukerkonto, i testoppdraget Bulrats vei 9 (Ståles bolig). SmartTakst sine tekster er ikke kopiert. Bare korte eksempler er tatt med.

---

## 1. Kort oppsummering

**Hva SmartTakst er:** et norsk takstprogram som bare finnes i nettleseren («laget av takstmenn, for takstmenn»). Det har 11 rapportmaler: tilstandsrapport etter NS 3600:2025, verditakst, skadetakst, reklamasjonstakst, befaringsnotat, forhåndstakst, boligoppmåling, uavhengig våtromskontroll, vedlikeholdsplan, standardbeskrivelse og forbefaring.

Ved siden av rapportdelen har de en «samhandlingsportal» der takstmann, megler og kunde deler oppdrag, dokumenter og chat. Nettsiden sier over 20 000 rapporter.

**Pris:** 190 kr per rapport (minst 2 i måneden), Basic 2490 kr i måneden for 20 rapporter, eller Pro 3690 kr i måneden uten grense. Betaling skjer med kort via Stripe.

**De 5 viktigste funnene:**

1. **Sjekklisten er et enkelt skjema med «hvis–så»-regler, og TG settes for hånd.**
   - Malen har 10 seksjoner, 40 bygningsdeler og 279 spørsmål. 52 spørsmål vises bare ved bestemte svar.
   - «Ja» eller TG2/TG3 åpner «Årsak/konsekvens». TG3 åpner også «Kostnadsestimat».
   - Materiale og alder gir **ingen** nye spørsmål og **ingen** forslag til TG. Alder er bare ja/nei-spørsmål, og byggeåret er fritekst som ikke brukes til noe.
2. **Ferdige fraser filtreres etter valgt TG.**
   - Malen har 887 fraser fordelt på 202 spørsmål. Velger du TG2, ser du bare fraser for TG2.
   - Du kan krysse av flere fraser samtidig og lagre egen tekst som ny frase.
   - Dette sparer mye tid, og det er det beste ved løsningen.
3. **KI-funksjonen «Forbedre språk» er gratis og godt laget.**
   - Den tar hensyn til seksjon, bygningsdel og spørsmål.
   - Du velger «Bruk forslaget», «Behold min tekst» eller «Nytt forslag», og du kan angre.
   - Teksten sier rett ut at forslaget bare er språklig. En KI-kontroll av hele rapporten mot NS 3600 står på listen over det de jobber med.
4. **Det finnes ingen drift uten nett og ingen ekte app.**
   - Uten nett kommer en feilside, eller bare «Oi.. Noe gikk galt».
   - Det som var lagt inn, ble lagret da nettet kom tilbake, men bare fordi siden ikke var lukket.
5. **Hver rapport eies av én takstmann.**
   - Andre kan bare se den.
   - Samarbeidet skjer i oppdraget, med deltakere, chat, dokumenter og status.
   - Det finnes ingen sidemannskontroll utover statusen «Til korrektur».
   - Når du lagrer, sendes hele seksjonen. Den som lagrer sist, vinner.

**Andre viktige funn:**
- **Rapporten er låst til malversjonen:** hver rapport lagrer sin egen kopi av malen.
- **Plantegning:** et eget verktøy som regner ut BRA-i, BRA-e, BRA-b, åpent areal og ALH automatisk.
- **Gyldighetsside:** offentlig, med QR-kode.
- **Feil i logikken:** malen har flere slike feil (se 3.6).

---

## 2. Skjerm for skjerm

### 2.1 Meny og innlogging
- **Menyen:** Oppdrag, Kontakter, Profil, Rapporter, Legg til kontakt og Faktura.
- **Hjelp:** Hjelpesenter og Endringsønsker ligger på en ekstern side (Featurebase). Chat med kundestøtte nede i hjørnet.
- **Innlogging:** e-post og passord. En ukjent e-post lager automatisk en ny konto med rollen *takstmann* eller *bestiller*, og rollen kan ikke endres senere.
- **Kunden:** kommer inn via en lenke i e-post, uten å logge inn.

### 2.2 Oppdrag
**Listen:**
- søk på adresse eller postnummer
- filter på status
- sortering
- gruppert etter status

**«Opprett oppdrag»:** veiviser i tre steg.
1. **Eiendom:** søk i Ambita på adresse, matrikkel eller eiernavn. Du kan også fylle inn manuelt.
2. **Parter:**
   - *kunde*, som får e-post med lenke og kan chatte
   - *bestillere*, som følger oppdraget
   - *takstmenn*
3. **Avtale:**
   - frist
   - hvem som betaler, *bestiller* eller *kunde* (bare til informasjon)
   - oppdragsdetaljer, som boligtype og størrelse, planskisser og standardbeskrivelse
   - fritekst til takstmann

**Oppdragssiden:**
- **Fanen «Framgang»:**
  - status og «Åpne rapport»
  - befaringsdato
  - opplasting av takstrapport (maks 10), plantegning og vedlegg (maks 15) og faktura (maks 2)
- **Fanen «Oppdragsdetaljer».**
- **Fanen «Dokumentasjon»:** her legger megler eller selger kommunepakke og egenerklæring.
- **Til høyre:** deltakere, og «Kommunikasjon» som er en chat for alle parter.

**Statusflyten** er manuell: Ikke påbegynt → Under arbeid → Til korrektur → Satt på vent → Har ikke tid → Ferdig. Megleren følger statusen.

### 2.3 Rapporter
- **Listen:** delt i «Under arbeid» og «Ferdige».
- **Ny rapport:** Ambita-søk eller manuell adresse, deretter boligtype og rapportmal. Rapporten kobles til et oppdrag.
- **Rapportsiden:**
  - adresse, boligtype, matrikkel og eiere
  - fremdrift i prosent
  - én flis per seksjon med status og fremdriftslinje
- **Knapper:**
  - «Ferdigstill rapport» (krever abonnement)
  - «Hent utkast PDF»
  - «Marker rapport som gyldig»
  - «Kopier rapport»
  - «Slett rapport»
- **Bunnlinjen:** «Notat» og «Lagre», med lagringsstatus som «Lagrer…», «Ulagrede endringer» og «Alle endringer lagret kl. …».

### 2.4 Kontakter
- **Kontakter:** din egen liste.
- **«Legg til kontakt»:** åpner en katalog over **alle brukere som har valgt å være synlige**, både takstmenn og bestillere. Den viser navn, firma, rolle, e-post, telefon og postnumre (74 sider).
- **Ingen CRM:** det finnes ingen kundehistorikk eller CRM utover dette.

### 2.5 Profil
- **Felt:**
  - bilde, navn, e-post og telefon
  - beskrivelse og firmalogo
  - selskap, organisasjonsnummer og adresse
  - postnumre du dekker
- **Avkrysninger:**
  - synlig for meglere, med klikkavgift på 200 kr inkl. mva per mottatt oppdrag
  - mesterlogo i rapporten
  - NITO-logo i rapporten
- **Integrasjon:** nettsiden nevner Visma CORE og Visma Broker (meglersystemer).

### 2.6 Faktura
- **Bare abonnementet:** siden gjelder SmartTakst sitt eget abonnement, med betaling via Stripe.
- **Ingen faktura til kunden:** ingen kobling til regnskap (Fiken, Tripletex eller Visma). Fakturaen til kunden er en PDF du laster opp i oppdraget.
- **Kostnader:** ingen registreringsgebyr. Det koster bare klikkavgift hvis du vil være synlig for meglere, og du må ha abonnement for å ferdigstille.

### 2.7 Hjelpesenter
20 korte artikler på norsk, blant annet:
- veiledning for tilstandsrapport (forskriften og NS 3600:2025)
- TG-nivåer og areal
- fraser og «Forbedre språk»
- ferdigstilling og gyldighet
- markering i bilder og plantegning

**Funnet bare i hjelpen:**
- **Gyldighet:** rapporten gjelder i 1 år. Det kan endres for hånd, og det vises offentlig om rapporten er gjort ugyldig.
- **Utkast-PDF:** sendes til eieren til kontroll før ferdigstilling.

### 2.8 Endringsønsker (brukernes ønsker, med få stemmer)
- integrasjon med meglersystemet Next
- kart og kjøretid
- egen «ferdig»-knapp per post
- KI-analyse mot NS 3600:2025 før ferdigstilling
- markering i bilder og planskisse
- flere takstmenn på én rapport
- notat per rapport
- KI-skrivehjelp
- ny PDF med forsidebilde
- kopiering av rapporter
- mal for næringstakst

**Verdt å merke seg:** Ønsket om en «ferdig»-knapp forteller noe viktig. Brukeren skriver at alle svar utfylt ikke betyr at teksten er ferdig, og etter en pause må hun gå gjennom alt på nytt.

### 2.9 Selve tilstandsrapporten

| Seksjon | Bygningsdeler (blokker) |
|---|---|
| Generell informasjon | Informasjon om oppdraget, Boliginformasjon, Dokumentasjon, Lovlighet |
| Fundament og grunnmur | Grunnmur/fundamenter, Drenering, Krypkjeller, Rom under terreng, Forstøtningsmurer, Radonsikring, Geologiske forhold, Annen bygningsdel |
| Vegg og fasader | Yttervegger/fasader, Vinduer/dører, Balkong/terrasse, Annen bygningsdel |
| Takkonstruksjon | Takkonstruksjon, Loft, Taktekking og beslag, Takrenner og nedløp, Annen bygningsdel |
| Våtrom | Våtrom (gjentas med eget navn: bad, vaskerom, toalettrom osv.) |
| Innvendig konstruksjon | Piper/ildsteder, Etasjeskiller, Innvendig trapp, Kjøkken, Ventilasjon, Elektrisk anlegg, Slokke- og brannvarsling, Innvendige overflater, Annen bygningsdel, Innvendige vann- og avløpsrør, Oppvarming, Skadedyr |
| Areal | Arealinformasjon per etasje, Plantegning |
| Garasjeanlegg | Garasjeplass, Bod |
| Verdi og beskrivelse | Verdisetting |
| Ekstra bygg | Frittstående byggverk |

**Slik jobber du:**
- **Ny bygningsdel:** trykk «Legg til [bygningsdel]» og gi den et navn, for eksempel «Bad 1. etasje».
- **Teller:** hver blokk viser hvor mange spørsmål som er besvart, for eksempel «(7/22)».
- **Spørsmålskort:** Ja/Nei, nedtrekk eller TG, og et kommentarfelt med «Bruk ferdig frase», «Forbedre språk» og «Lagre som ny ferdig frase».
- **Spørsmålstyper:**
  - Ja/Nei (102)
  - fritekst (71)
  - nedtrekk (27)
  - TG (33)
  - bilde (37)
  - tall (3)
  - dato
- **Hjelpetekst:** «?» på mange spørsmål.

**Rom og romtyper:**
- Sjekklisten har **ingen romtyper**. Våtrom er én blokktype med fritt navn.
- De 18 romtypene finnes bare i plantegningsverktøyet og er **ikke** koblet til sjekklisten.
- Badstue finnes ikke som romtype.

**Målefelt:** Det finnes ingen felt for fukt i prosent, fall i millimeter eller høyde på rekkverk. Det står bare «Er det utført fuktmåling / hulltaking …?» Ja/Nei med kommentar.

**Avvik, årsak, konsekvens, tiltak og kostnad:**
- **Årsak/konsekvens:** TG2 og TG3 åpner fritekstfeltet.
- **Kostnadsestimat:** bare ved TG3, med fem intervaller: under 10 000, 10–50 000, 50–100 000, 100–300 000 og over 300 000.
- **Tiltak:** et eget Ja/Nei-spørsmål med kommentar, som ikke er koblet til TG.
- **HMS:** fritekst i noen blokker.

**Fraser og maler:**
- **Fraser:** per spørsmål, filtrert på valgt TG, og flere kan velges.
- **Maler:** brukeren kan ikke endre malen.
- **PDF:** 15 faste tekstdeler, for eksempel «Om rapporten», «Levetidsbetraktninger» og «Oppsummert».

**Bilder:** flere bilder kan velges på én gang. Hvert bilde har kommentar og et markeringsverktøy med pil, ramme, sirkel, frihånd og tekst.

**KI:**
- **Gratis:** «Forbedre språk» finnes på alle tekstfelt og er gratis.
- **Eksempel:** «… råte i nedre del av kledning på nordvegg. Kan gi fuktinntrengning …» ble til «Det er registrert råte i nedre del av kledning på nordvegg. Dette kan medføre fuktinntrengning i yttervegg.»
- **Begrensning:** KI lager ikke selve vurderingen og foreslår ikke TG.

**Kontroll før levering:**
- **Det som finnes:** tellere og prosent, og «Vennligst fyll ut alle obligatoriske felter».
- **Det som mangler:** en faglig sjekkliste og sidemannskontroll.

**Forhåndsvisning:** Utkast-PDF stopper til profilen har firmalogo og profilbilde. PDF-en er derfor ikke sett.

**Egenerklæring:** Det finnes ikke noe eget skjema. Det er bare «Er selgers egenerklæring kontrollert?» og signeringsdato, og dokumentet lastes opp i oppdraget.

**Sammendrag:** Det finnes ingen egen skjerm. Det er fritekstfeltet «Overordnet faglig vurdering», og PDF-en har en fast del «Oppsummert».

**Notat:** en privat logg med tekst og bilder per rapport, som ikke kommer med i rapporten.

**Plantegning:**
- Du tegner vegger, dører, vinduer og trapper, og arealet regnes ut med en gang.
- Tegningen kan eksporteres til PDF eller JPEG, og arealene kan hentes inn i rapporten.
- Selve tegningen følger ikke med i rapporten.

**Lagring:** automatisk etter en liten pause. Hver lagring sender hele seksjonen.

**Kopier rapport:** du kan hente eiendom og eiere på nytt og kopiere notater, og få en liste over hva som endret seg.

**Gyldighetsside:** offentlig side med QR-kode, statusen GYLDIG eller IKKE GYLDIG, «gyldig til» og en hendelseslogg.

---

## 3. Logikken for kontrollpunkter og TG

### 3.1 Datamodellen
- **Oppbygning:** mal → seksjon → blokk (bygningsdel) → spørsmål.
- **Hvert spørsmål har:**
  - type
  - svaralternativer
  - kommentarfelt
  - fraser
  - hjelpetekst
  - én enkel betingelse: «vis hvis spørsmål X har verdi Y»
- **Rapporten:** lagrer en kopi av hele malen når den opprettes.

### 3.2 Hva styrer kontrollpunktene
- **Bygningstype:** samme mal for hus og leilighet. Boligtypen styrer ingenting.
- **Rom:** styrer ingenting. Du legger selv til blokker.
- **Materialvalg:** styrer ingenting, bortsett fra at «Annet» åpner et kommentarfelt.
- **Ja/Nei og TG:** styrer oppfølgingsspørsmål.

### 3.3 Valg → hva som dukker opp (testet)

| Valg | Dette dukker opp |
|---|---|
| Fasade, taktekking, fundament, oppvarming, rør, pipetype | Ingenting nytt |
| Byggeår | Ingenting (fritekst) |
| TG0 / TG1 | Kommentar og fraser for valgt TG |
| TG2 | + «Årsak/konsekvens» |
| TG3 | + «Kostnadsestimat» + «Årsak/konsekvens» |
| TGIU | Bare kommentar |
| Våtrom: utført arbeid etter byggeår = Ja | + dokumentasjon fra selger? |
| Våtrom: innebygget sisterne = Ja | + drenshull fra sisternekassen? |
| Balkong: rekkverk = Ja | + rekkverkshøyde og åpninger etter dagens krav? |
| Balkong: tekket = Ja | + krav til fall/avrenning? |
| Loft: endringer / inspisert = Ja | + dokumentasjon / avvik funnet? |
| Pipe: rapport fra feiervesen = Ja | + avvik som ikke er lukket? |
| Vann/avløp: stengekran lokalisert / bereder kontrollert = Ja | + funksjonstestet? / TG for bereder |
| Skadedyr = Ja | + tiltak gjort? |
| Krypkjeller: inspisert Ja/Nei | Ja: ventilasjon, fuktsperre, TG og tiltak. Nei: tegn til ventilering utvendig? |
| Ventilasjon = naturlig/balansert | Skulle gitt oppfølgingsspørsmål, men **ingenting skjer** (feil) |

### 3.4 Settes TG automatisk?
**Nei.** TG velges alltid for hånd, og det finnes ingen regel mellom svar og TG.
- **Alder:** tas med som ja/nei-spørsmål, for eksempel «Er undertak over 13 år?», men det gir ingen TG.
- **Byggeår:** brukes ikke.
- **Levetidsbetraktninger:** bare fast tekst i PDF-en.

### 3.5 Kostnad, tiltak og HMS
- **Kostnad:** bare ved TG3, og bare som intervall.
- **Tiltak:** ikke knyttet til avviket.
- **HMS:** fritekst uten TG.

### 3.6 Feil i malen
- **Ventilasjon:** betingelsen ser etter en annen skrivemåte enn den listen lagrer. Derfor vises oppfølgingsspørsmålene aldri. Det viser hvor skjør logikk basert på tekst er.
- **TG skrives ulikt:** både «TG2» og «TG 2».
- **«Totalvurdering av fuktsøk»:** mangler TG1.
- **Elektrisk anlegg:** har fortsatt TG-felt, selv om deres egen hjelpetekst sier at det ikke skal ha det.
- **Fritekst der det burde være tall:** byggeår og tomt.

---

## 4. Styrker: det SmartTakst gjør bedre enn IVIT

1. **Fraser:** knyttet til hvert spørsmål og filtrert på valgt TG.
2. **KI:** gratis språkforbedring med tydelige valg og angre. IVIT tar 169 kr per rapport.
3. **Malversjon:** rapporten er låst til versjonen den ble startet med.
4. **Plantegning:** automatisk areal etter de nye arealbegrepene.
5. **Gyldighetsside:** offentlig, med QR-kode og hendelseslogg.
6. **Kopier rapport:** med en liste over hva som endret seg.
7. **Notat:** privat notat per rapport.
8. **Skjermbildet:** enkelt og ryddig, med tydelig lagringsstatus.
9. **Hjelpen:** god og på norsk, og det finnes en åpen tavle for ønsker.
10. **Ambita-oppslag:** fyller ut matrikkel og hjemmelshavere.

## 5. Svakheter

1. **Uten nett:** virker ikke, og det finnes ingen ekte app.
2. **TG:** ingen automatisk TG, ingen bruk av levetider og ingen målefelt.
3. **Materialvalg:** styrer ingenting, så sjekklisten er lik for alle bygg.
4. **Logikken i malen:** skjør (se 3.6).
5. **Kostnad og tiltak:** kostnad bare ved TG3, og tiltak er ikke koblet til avviket.
6. **Én eier per rapport:**
   - Det er ingen sidemannskontroll og ingen trygg samtidig redigering.
   - Under testen ble to blokker lagt inn av noen andre uten at det var synlig eller varslet.
7. **Utkast-PDF:** låst til profilen har logo og bilde.
8. **Faktura:** ingen faktura til kunde og ingen kobling til regnskap.
9. **Meglersystem:** ingen direkte levering fra appen.
10. **Personvern:** kontaktkatalogen viser e-post og telefon for alle synlige brukere.

---

## 6. Sammenligning med IVIT og Spectora

| Tema | SmartTakst | IVIT | Spectora |
|---|---|---|---|
| Plattform | Bare nettleser | Nett og iPad, egen admin-app | Nett og egen app |
| Uten nett | Nei | Ja, men med kjente tap ved synkronisering | Ja (app) |
| Mal | Fast mal, låst per rapport | Sentral, endres uten varsel | Egne maler, kopi mellom firma |
| TG-forslag | Nei | Avviksspørsmål gir TG, ingen alderslogikk sett | Ingen TG |
| Logikk | Enkle «vis hvis»-regler, ikke styrt av materiale | Spørsmål styrt av materialvalg | Valg som viser og skjuler kommentarer |
| Fraser | Per spørsmål, filtrert på TG | Løs frasebank og standardavvik | Kommentarbibliotek per punkt |
| KI | Gratis språkforbedring | 169 kr per rapport | Begrenset |
| Kostnadsanslag | 5 intervaller, bare TG3 | 5 intervaller | Min–maks |
| Plantegning | Ja, med areal | Nei | Nei |
| Samarbeid | Oppdrag med chat, én eier | Firmaoppsett, roller | Flere takstmenn |
| Sidemannskontroll | Bare status «Til korrektur» | Godkjenning | Nei |
| Levering | PDF lastes opp i oppdraget, kundelenke, QR | Meglerintegrasjon | Nettrapport |
| Faktura til kunde | Nei | Fakturaer-fane | Betaling i systemet (USA) |
| Pris | 190 kr/rapport, 2490 eller 3690 kr/mnd | Klikkpriser | Månedspris (USA) |

---

## 7. Hva EzProp bør ta med (prioritert)

**Høy**
1. **Fraser knyttet til kontrollpunkt og TG**, med flervalg og egne fraser.
2. **Én versjon av malen per rapport**, og en liste over endringer ved kopiering.
3. **«Vis hvis»-regler med faste koder, ikke tekst**, som testes automatisk. Ett format for TG overalt.
4. **Materialvalg styrer kontrollpunktene, og TG foreslås ut fra materiale og alder** med begrunnelse, som takstmannen godkjenner. SmartTakst mangler dette helt, og det er vår største mulighet.
5. **Lagring uten nett** i nettleseren på iPad, per felt, slik at flere kan jobbe samtidig.
6. **Årsak, konsekvens, tiltak og kostnad på samme avvikskort**, med tiltak koblet til avviket.
7. **KI som forbedrer språk** med «bruk, behold, nytt forslag» og angre.
8. **Sjekkliste før levering og sidemannskontroll.**

**Middels**
9. Målefelt med tall og enhet, som kan gi TG-forslag.
10. Romtyper (bad, vaskerom, toalettrom, badstue) som henter riktige kontrollpunkter.
11. Areal per etasje med BRA-i, BRA-e, BRA-b, åpent areal og ALH.
12. Markering i bilder og forsidebilde.
13. Privat notat per rapport.
14. Offentlig gyldighetsside med QR-kode.
15. Oppslag av matrikkel og hjemmelshavere (via Eiendomsverdi eller PropCloud).
16. Status som megler ser, og kundelenke uten innlogging.

**Lav**
17. Verktøy for plantegning.
18. Katalog der meglere kan finne takstmenn.
19. Mester- og NITO-logo i PDF-en.

**Lærdom (ikke gjør):**
- Ikke lås forhåndsvisningen bak profilfelt.
- Ikke bland fritekst og tall.
- Ikke vis andres kontaktinformasjon uten samtykke.

---

## 8. Endret i SmartTakst-kontoen (testoppdraget Bulrats vei 9)

- **Status:** «Under arbeid».
- **Utkast med fiktive data:**
  - rundt 20 bygningsdeler med fiktive avvik i TG0–TG3 og TGIU, og kostnadsintervaller
  - ett testbilde og ett privat notat
  - areal for to etasjer
  - ett rom i plantegningen
- **Byggeår:** satt til 1978. **Det er en fiktiv verdi som må rettes.**
- **Ikke gjort av agenten:** to blokker «Grunnmur / fundamenter» ble lagt inn kl. 17.25 av noen andre.
- **Ikke endret:** profil, abonnement, kontakter og andre oppdrag.

## 9. Bekreftelse

- **Rapporten:** ikke ferdigstilt, signert, merket som gyldig, sendt eller levert.
- **Økonomi:** ingen abonnementer, betalingskort eller fakturaer.
- **Sendt:** ingenting via Endringsønsker, hjelpesenteret eller chatten.
- **Kostnad:** ingen, så langt vi kan se.
- **Personopplysninger:** kopier av rapportdata med hjemmelshavernes navn er slettet etter kartleggingen.
