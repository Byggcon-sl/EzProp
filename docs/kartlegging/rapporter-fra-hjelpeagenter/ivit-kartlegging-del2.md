# Rapport: resten av IVIT (profil, innstillinger, menyer og detaljer)

Jeg gikk gjennom IVIT 23. oktober 2026 med Ståles konto, og bare så og leste. Skjermbilder og skript ligger i `/tmp/claude-0/-home-user/b66b5c74-17a0-5297-937a-387efe6ff0c0/scratchpad/ivit-detaljer/`. Dette er observasjoner som ikke er godkjent.

## 1. Hva som finnes i profil, innstillinger og menyer

**Toppmenyen** har disse delene, fra venstre:
- IVIT-logo og fanene Ordre, Oppdrag, Fakturaer og Arkiv
- et stort søkefelt
- knappen «+ Oppdrag»
- fire ikoner: Kunder, Kalender, Varslinger (rød teller: 5134) og avatar med grønn prikk som viser status
- Fagsystemer (rutenett)

Alle ikonene har hover-tekst.

**Avatarmenyen** har sju valg:
- **Status:** «Tilgjengelig» eller «Ikke tilgjengelig». Det styrer den grønne prikken.
- **Innstillinger** (`/system-settings`). Se under.
- **Abonnement:** to kort, «Kontosammendraget mitt» og «Totalt kontosammendrag». De viser kroner og antall per produkt, for eksempel tilstandsrapport, energimerke, meglerintegrasjon, næring og verditakst. Til sammen er det 20 142 kr. Det er altså klikkprisene, ikke et abonnement.
- **Hjelp:** undermeny med «Hjelp», som er en ekstern Zendesk-side hos iVerdi, og «Last ned diagnostikkfil».
- **Bytt passord:** sender deg til Norsk takst-innloggingen. Der står passordkravene: 8 tegn, store og små bokstaver, tall og spesialtegn.
- **Lisensavtale:** iVerdis brukervilkår i en dialog.
- **Logg ut.**

**Innstillinger** er én lang side med venstremeny. Versjonsnummeret 10.2.8 står øverst til høyre.
- **Generelt (personlig):**
  - profilbilde i 3:4-format og signatur, med avkrysning for «Vis i rapport»
  - navn, mobil, bedrift, telefon, brukerrolle (`company-admin`, vist som teknisk kode), e-post, organisasjonsnummer og adresse
  - avkrysning for MVA-registeret og Foretaksregisteret
  - Enova bruker-ID
  - «Markedsbilde» og logo for paraply- eller medlemsforetak
- **Sertifikater:** sertifikatlogoer og et Norsk takst-logo-bryter. Tabellen «Mine sertifikater» viser sertifikat og fra-dato, for eksempel Fremtind-rapport og generelle rapporter.
- **Eksterne personer:** liste med en «add»-knapp.
- **Medlemsnummer i andre organisasjoner.**
- **Kalenderintegrasjoner:** én e-postadresse som befaringene sendes til.
- **Firma-innstillinger:**
  - firmanavn, firmabeskrivelse (brukes på side 2 i rapporten), telefon, mobil og logo
  - Generelle avkrysninger: vis takstingeniør på forsiden (på), send e-postvarsel til ansatte (på), **2-faktor innlogging (av)**, del alle oppdrag med alle ansatte (på)
  - Tilstandsrapport-oppsett: én kolonne i stedet for to (på), og «Vis mer informasjon under oppsummering av tilstand» (av)
  - Takstmenn: fornavn, etternavn, e-post og **startsekvens for oppdragsnummer**, for eksempel [oppdragsnr fjernet]
  - Tilgangsbegrensninger: ekstern- eller kontorbrukere med avkrysning for «Gi oppdragstilgang»
  - Ordrebekreftelse: en tekstredigerer, som er tom, med den engelske plassholderen «Insert text here…»
  - Forutsetninger for generell tilstandsrapport: knappen «Redigér forutsetninger»
- **PDF-innstillinger:** grået ut og ikke tilgjengelig.
- **Integrasjoner:**
  - Boligpass (tilkoblet)
  - NS 3600- og NS 3940-abonnement (kjøp)
  - AI-funksjon: 169 kr per rapport, med AI-assistent og AI-konsistenssjekk. Deaktivert.
  - PropCloud
  - Eiendomsverdi (aktivert)
  - Svea: 6 måneders rentefri betalingsutsettelse for kunden
  - regnskapsintegrasjon via eMonkey
  - meglerintegrasjon med tilbakeføring av data: 40 kr per rapport, aktivert
  - Boligmappa (ikke tilkoblet)

  Hver tjeneste aktiveres ved å krysse av for at man godtar vilkårene.

Det finnes **ingen «Lagre»-knapp** på siden. Det ser ut som endringer lagres med en gang.

**Kunder** (`/customers`):
- faner for Alle kontakter, Privat og Bedrift, og et søkefelt
- kolonnene Kunde, Epost, Type, Adresse, «Org. Number» og Postnummer
- blyant- og kryssikon på hver rad
- 1296 kunder

Skjemaet for ny kunde har Privat/Bedrift, fornavn, etternavn, e-post, mobil, telefon arbeid, adresse, postnummer, poststed, kommunenummer og kommunenavn.

**Kalender** (`/calendar`):
- visningene Måned, Uke, Dag og Agenda, med knappen «I dag»
- venstre side: «Vis verdier», som er en liste over takstingeniørene du kan legge til, og «Vis firmaadmin»
- hendelsene er befaringer, vist med klokkeslett og adresse

**Varsler** er et rullegardinpanel. Disse typene finnes:
- ordre mottatt
- ordre tildelt
- medansvar godtatt eller avvist
- partneroppdrag akseptert eller avvist
- oppdrag tildelt, fjernet, kansellert, delt, godkjent eller sendt tilbake
- melding, tilleggstjenester og fakturainformasjon oppdatert

**Fagsystemer** (rutenettet) lenker til Admin (admin.ivit.no), e-tiq, Svea, Eiendomsverdi og App Store.

**admin.ivit.no** er et eget adminprogram (versjon 4.0.5). Det har:
- soneadministrasjon (359 soner)
- postnummer
- kontoradministrasjon
- saksadministrasjon med «Åpne igjen» for ferdige saker
- nyheter
- **Administrering av fraser**, se under
- ordrebehandling med statusfilter
- «Deles med selskaper», der Byggcon Helgeland og Byggcon Troms deler oppdrag og fraser

Frasedelen har to faner. «Administrere fraser» er et tre etter rapportdel. «Fraseregister» er en liste med 507 egne fraser og kolonnene tittel, tekst og type, med filter på rapporttype.

**Frasepanelet i rapporten** (åpnet på testoppdraget):
- filtrene Standard, Mine, Delt og Favoritter, med søk, «+ Ny frase» og «Endre»
- ikoner per frase: hengelås betyr at det er en standardfrase som ikke kan endres, personikon betyr delt og stjerne betyr favoritt
- i «Endre»-modus kan man dra frasene for å endre rekkefølgen, og hver egen frase har en «Endre»-knapp
- skjemaet har navn, tekst, Favoritt og «Del med selskap», med knappene Lagre/Opprett, Avbryt og Slett
- uten valgt felt viser panelet «Velg et tekstfelt med fraseknapp.»

**Verktøy per kontrollpunkt** (alle med hover-tekst):
- TG-velger
- HMS-merke
- Marker som ferdig
- Kopier sjekkpunkt
- Oppdater sjekkpunktnavn
- Nullstill sjekkpunkt
- Slett
- Fraser
- «i», som viser forskriftsteksten for punktet med nøkkelord understreket

Oppe til høyre velger man skjema: «Enkel beskrivelse», «Detaljert beskrivelse» eller «Kontrollpunkt». Nederst står «Lagret 23:41».

**Godkjenninger** er en liste med hurtigsøk og ansattfilter. Den var helt tom og hadde ingen forklarende tekst.

**Tilbakemeldinger** (blå knapp nede til venstre) åpner et skjema med:
- e-post og «Hva gjelder det?»
- rapporttype (Norsk takst, Fremtind, Generell, Annet), kategori og kommentar
- skjermopptak
- verktøy for å tegne på skjermbildet: Highlight, Comment, Pen, Arrow og Hide

**Nyheter** er en flytende melding nede til høyre. Den åpner en liste med datoer.

## 2. Konkrete detaljer, og om EzProp bør ha dem

| # | Detalj i IVIT | EzProp? |
|---|---|---|
| 1 | «i»-knapp per kontrollpunkt med kravet fra forskriften og understrekede nøkkelord | **Høy** |
| 2 | Frasebibliotek med Standard (låst), Mine, Delt (firma) og Favoritter, søk og rekkefølge med dra og slipp | **Høy** |
| 3 | Fraser deles mellom selskaper i konsernet (Nord, Helgeland, Troms) | **Høy** |
| 4 | Lagrestatus med klokkeslett («Lagret 23:41») | **Høy** |
| 5 | Globalt søk som finner oppdragsnummer og adresse, og viser matrikkel, status og dato i nedtrekkslisten | **Høy** |
| 6 | Arkiv med sortering på alle kolonner, hurtigperioder (denne måneden/3M/6M/12M) og lagrede filtre | **Høy** |
| 7 | Startsekvens for oppdragsnummer per takstingeniør (ansattnummer-løpenummer) | Middels (bestem nummerformat) |
| 8 | Signatur og profilbilde i rapporten, med «Vis i rapport» | **Høy** |
| 9 | Firmabeskrivelse som rapportside 2 | **Høy** (fra kunnskapsbasen, ikke fritekst per bruker) |
| 10 | Kalender med befaringer for alle takstingeniører og valg av hvem som vises | Middels |
| 11 | Kalenderintegrasjon (befaring til Outlook) | **Høy** (bruk M365 direkte) |
| 12 | Tilgjengelig/ikke tilgjengelig-status | Lav |
| 13 | Ansattfilter med avatarer (DP, BS, ØM, 6+) over oppdragslisten | Middels |
| 14 | Faner etter fase med antall (Forberedelser 12, Befaringer 12, Ferdigstilling 22) | **Høy** |
| 15 | Kort notat (merkelapp-ikon) på hver rad i oppdragslisten | Middels |
| 16 | Radmeny: kopier oppdrag, last ned siste PDF, endre takstingeniør, kopier data fra | **Høy** |
| 17 | HMS-merke på kontrollpunkt | Middels |
| 18 | Tre skjemanivåer (enkel, detaljert, kontrollpunkt) | Lav, EzProp bør ha ett godt nivå |
| 19 | Tilbakemeldingsverktøy med skjermbilde og tegning | Middels (enkel versjon) |
| 20 | Nyheter eller endringslogg i appen | Middels |
| 21 | «Last ned diagnostikkfil» til support | Lav |
| 22 | Tilgangsbegrensning per bruker (ekstern eller kontor) | **Høy** (finnes i rolleplanen) |
| 23 | Kundeliste med Privat/Bedrift og kommunenummer | Middels (hent fra Brønnøysund og matrikkel) |
| 24 | Ordrebekreftelse-tekst som firmainnstilling | **Høy** (obligatorisk) |
| 25 | Redigerbare standardforutsetninger på firmanivå | **Høy** |
| 26 | Versjonsnummer synlig | Lav (finnes allerede i Optiplan-regelen) |

## 3. Svakheter i IVIT som EzProp kan gjøre bedre

1. **Dataeierskap.** Lisensavtalen sier at *«All data … som registreres og lastes opp i Tjenesten blir IVerdis eiendom»*, også etter at avtalen er sagt opp. IVerdi kan bruke dataene kommersielt. Det er et sterkt argument for at Byggcon eier sitt eget system.
2. **Sikkerhet.** 2-faktor innlogging er **av** for firmaet. Det er bare en avkrysning, ikke et krav. EzProp bør kreve to faktorer, eller engangskode på e-post slik Optiplan gjør.
3. **Innstillinger lagres uten bekreftelse.** Det finnes ingen Lagre- eller Angre-knapp på en side med firmavalg og avkrysning for betalte tjenester. Det er lett å endre noe ved et uhell. I tillegg ligger betalte tjenester (AI 169 kr per rapport, NS-abonnement) blandet med vanlige innstillinger.
4. **Varsler fungerer ikke.** Det er 5134 uleste. Det finnes ingen «merk som lest» og ingen filtrering, og alle varslene lastes på én gang. Tekstene blander norsk og engelsk dato («October 23, 2026»). Varslene er ubrukelige som arbeidsliste.
5. **Kunderegister med dubletter.** Samme organisasjonsnummer står flere ganger, med ulik skrivemåte i store og små bokstaver. Det er ingen kobling mot Brønnøysund. Sletteknappen (X) står rett i listen.
6. **Språkblanding og tekniske koder:** «Company», «Org. Number», «company-admin», «Insert text here …», Highlight/Pen/Arrow, «Company Name» og «Viser 0 til NaN av undefined innganger» (feil i admin).
7. **Tomtilstander uten tekst.** Godkjenninger og Bildearkiv er bare blanke flater uten forklaring og uten tittel. Frasepanelet er unntaket.
8. **Kalenderen.** I månedsvisningen flyter hendelsene over i neste uke når en dag har mange befaringer. Ukevisningen har ingen tidslinje. Agenda viser bare dagen i dag.
9. **Ingen tastatursnarveier** (/, Ctrl+K og lignende). Tab-rekkefølgen begynner nederst på siden.
10. **Hjelp ligger utenfor appen** i Zendesk, og siden var blokkert for oss. Det finnes ingen hjelp der man jobber, bortsett fra «i»-knappen.
11. **Kjente problemer ifølge IVITs egne nyheter:**
    - Data kan gå tapt ved synkronisering. Man må «ikke bruke inkognito» og må «gå online med iPad etter befaring».
    - Tekst i «Enkel beskrivelse» kom ikke med i PDF-en.
    - Bilder ble rotert 90 grader.
    - Rådet om nettleser motsier seg selv: i august sto det «bruk Chrome, ikke Safari», i oktober «Safari fungerer best».

    EzProp må ha **trygg lagring uten nett** (offline) som grunnkrav og vise tydelig hva som er synkronisert.
12. **Sjekkpunkter endres sentralt uten varsel i rapporten.** Det skjedde for eksempel med nye TG2-avvik 16.10. Byggcon bør selv eie og versjonere sjekklistene og vite hvilken versjon hver rapport bygger på.
13. **Fraseregisteret.** Det har 507 egne fraser, mange der tittel og tekst er identiske. Frasene er ikke koblet til kontrollpunkt eller TG, og det finnes ingen kvalitetskontroll eller godkjenning. EzProp bør ha fraser knyttet til punkt, godkjent av fagansvarlig.
14. **To separate apper** (ivit.no og admin.ivit.no) med ulik design og ulike versjonsnumre. Administrasjonen bør ligge i samme app, styrt av rolle.
15. **Abonnementssiden** viser kroner, men ingen periode, ingen pris per enhet og ingen faktura.

## 4. Bekreftelse: ingen endringer utenfor testoppdraget

- Jeg har **ikke endret** profil, firmainnstillinger, avkrysninger, kunder, fraser, maler eller andre oppdrag.
- Dialogene «Ny kunde», «Ny frase», «Endre frase» (Protan Sarnafil), Bildearkiv, Lisensavtale, Nyheter og Tilbakemeldinger ble åpnet og lukket med ×, Avbryt eller Lukk. Ingenting ble lagret eller sendt.
- På siden «Bytt passord» ble ingenting fylt ut.
- I admin.ivit.no bare leste jeg. Jeg trykket ikke «Åpne igjen», «Ny nyhet» eller lignende.
- Radmenyen (⋮) på et annet oppdrag ble bare åpnet og lukket med Esc.
- **I testoppdraget [oppdragsnr fjernet]:** jeg slo HMS-merket på Taktekking på og straks av igjen, så det er tilbake som før. Jeg byttet frasepanelet mellom Endre og Tilbake og åpnet «i»-dialogen.
- Ingen e-post, SMS, deling, fakturering, endelig rapport eller bestilling.
- Å åpne varselpanelet endret ikke telleren (5134 før og etter).
- Passordet er ikke skrevet i noen logg eller fil.
- Nettleseren er stoppet, og den lagrede innloggingen (`state.json`) er slettet.

Kundenavn og adresser fra andre oppdrag er ikke tatt med i denne rapporten.
