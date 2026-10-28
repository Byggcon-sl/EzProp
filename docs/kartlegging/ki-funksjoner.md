# KI-funksjoner Byggcon kan bygge inn i EzProp

Sist oppdatert: 24.10.2026
Status: Utkast – ikke godkjent.
Kilde: En Claude-hjelpeagent søkte natt til 24.10.2026 etter takst- og inspeksjonsprogrammer med KI (USA, Storbritannia, Norden, Tyskland). Kilder står per punkt. Det meste er leverandørenes egen markedsføring, og påstander om tidsbesparelse er ikke uavhengig testet.

**Viktig avklaring:** TG-forslag ut fra materiale, alder og målinger (levetidstabellen i NS 3600) er **faste regler i koden, ikke KI**. Det er fortsatt en del av planen. Punktet «KI skal ikke foreslå TG» under gjelder KI som *gjetter* TG ut fra tekst eller bilder.

## Hovedmønsteret i markedet

**KI lager utkast, og takstmannen godkjenner.** Ingen seriøs leverandør lar KI sette tilstandsgrad eller sende rapporten selv. RICS (UK) innførte en egen standard for ansvarlig KI-bruk fra 9. mars 2026: styring, faglig skjønn og åpenhet overfor kunden. Den er en god mal for Byggcon.

## 15 funksjoner (prioritert)

| Pri | Funksjon | Hva den gir | Innsats | Når |
|---|---|---|---|---|
| 1 | **Logg og merking av KI-bruk** | Viser hvor KI har vært med, og hvem som godkjente. Rapporten kan ikke låses med KI-tekst som ikke er godkjent. | Liten | Overalt, bygges først |
| 2 | **Tale til tekst på befaring** | Takstmannen snakker i stedet for å skrive. Lyden lagres offline og gjøres om til tekst når nettet er tilbake (NB-Whisper fra Nasjonalbiblioteket er best på norsk og kan kjøres på egen server). | Liten–middels | iPad |
| 3 | **Diktat blir strukturert funn** | Det som er sagt fordeles på rom og bygningsdel, med utkast til avvik, årsak, konsekvens og tiltak. **TG-feltet står tomt.** Streng instruks: ikke finn opp mål, materialer eller årsaker. | Middels | Kontor eller når nettet er tilbake |
| 4 | **Forslag fra frasebanken** | Foreslår de 3–5 beste *godkjente* frasene. Søk på betydning (pgvector), og en enkel variant fungerer offline. | Middels | iPad og kontor |
| 5 | **Språkvask** | Korte notater blir rapportspråk, kort eller utfyllende. Før og etter vises side om side. | Liten | Kontor |
| 6 | **Sjekk av om rapporten er komplett** | Faste regler, ingen KI: TG2/TG3 uten årsak eller tiltak, TG3 uten kostnad, manglende bilde, areal eller hulltaking. | Liten | Før sidemannskontroll, også offline |
| 7 | **KI-sjekk før sidemannskontroll** | Finner motstrid (f.eks. «råte» i teksten men TG1), uklart språk og gjengangere. Stiller spørsmål, foreslår aldri ny TG. Gjenbruker skillen `byggcon:sidemannskontroll`. | Middels | Kontor |
| 8 | **Oppsummering i klarspråk** | Utkast til sammendrag ut fra godkjente funn, sortert etter alvor | Liten | Kontor |
| 9 | **Bilde gir utkast til observasjon** | «Riss i flis ved sluk …». Aldri TG. | Middels | Kontor |
| 10 | **Sortering og tekst på bilder** | Bildet knyttes til det rommet og punktet takstmannen står i (vanlig kode). KI foreslår flytting og bildetekst. | Middels | Kontor (enkel variant offline) |
| 11 | **Sjekk av bildekvalitet** | «Uskarpt» eller «for mørkt» med en gang, mens takstmannen ennå er på stedet. Ingen KI, virker offline. | Liten | iPad |
| 12 | **Forhåndsutfylling fra tidligere rapport og tegninger** | Henter byggeår, konstruksjoner og gamle funn. Merkes «ikke kontrollert». | Middels | Før befaring |
| 13 | **Henvendelse blir handling** | E-post eller skjema gir utkast til svar, forslag til oppdrag og en oppgave. Kobles på motoren for hendelser og handlinger. | Liten–middels | Kontor |
| 14 | **Tiltaksliste og kalkyle (skadetakst)** | Diktat gir poster fra **Byggcons egen prisbank**. Aldri frie priser fra KI. | Middels | Kontor |
| 15 | **Læring fra sidemannskontroll** | Månedlige forslag til nye fraser og gjengangere, via «09 Innsamling» og fagrådet | Liten | Hver måned |

**Rekkefølge:**
1. Først 1, 6 og 11 (lite eller ingen KI, lav risiko).
2. Så 2, 5 og 8 (rask gevinst).
3. Deretter 3, 4, 7 og 9.

## Hva andre har (kort)

- **USA:** ISN (AI Comment Helper, AI Image Defect Detector), Palmtech 11, InspectorData og Cotality Property Vision. Alle lager forslag som inspektøren godkjenner.
- **Storbritannia:** PropScribe (logg over KI-bruk, offline-diktat), SurveyorSuite (KI-erklæring, streng instruks), Imfuna, Otto/home.co.uk og Property Inspect (sjekk av manglende felt og motstrid).
- **Skade:** Verisk XactAI (oppsummering, bilder, kalkyle), DocuSketch (tale til tiltaksposter) og Encircle (varslet).
- **Norden:** Pretakst (Skien) varslet i 2024 KI for tilstandsrapport, men hvor langt de har kommet er ikke bekreftet. I Sverige finnes Besikt (transkribering). Hos Vitec, Boligmappa, Norsk Takst og Infoland er ingen KI funnet.
- **Tyskland:** KI-Syndikat (utkast fra tidligere rapporter, skadekalkyle).

## Dette bør vi IKKE gjøre

1. **KI som setter eller foreslår TG** ut fra tekst eller bilder. TG er takstmannens skjønn og ansvar.
2. **Automatisk publisering eller sending** av rapport eller e-post. Et menneske trykker alltid «send».
3. **Frie kostnadsestimater fra KI** i tilstandsrapporten. Bare prisbank, og bare i skadetakst.
4. **Egen bildegjenkjenningsmodell eller «tilstandsscore»** fra bilder. Det krever forskning og gir falsk presisjon.
5. **Kundedata og bilder til KI uten avtaler:**
   - Databehandleravtale og helst lagring i EU/EØS kreves.
   - Dataene skal ikke brukes til å trene modeller.
   - Kunden skal informeres om at KI brukes.
   - Norsk Takst sine vernede standardtekster skal ikke inn i KI-instrukser.

## Felles grep

- **Offline-regelen:** Opptak, bilder, bildekvalitet, frasesøk og regelsjekker virker ute uten nett. KI kjøres når nettet er tilbake eller på kontoret, og iPaden viser «venter KI-behandling».
- **Test på norsk:** Hver instruks testes på 20–30 anonymiserte Byggcon-notater. Vi måler hvor ofte takstmannen må rette.
- **Én felles KI-modul i kjernen**, med logging, anonymisering og mulighet til å bytte leverandør.
- **Arbeidsmiljøloven:** Logging av ansattes arbeid kan være et kontrolltiltak etter kapittel 9, så det må vurderes og drøftes.

## Kilder (utvalg)

- ISN: https://www.inspectionsupport.com/turn-photos-into-findings-isn-ai-image-defect-detector/ og https://www.inspectionsupport.com/ai-comment-helper/
- Palmtech: https://intercom.help/palmtech/en/articles/13754309-palmtech-11
- InspectorData: https://inspectordata.com/features/ai-inspection-reports.html
- Property Inspect: https://propertyinspect.com/inspect-ai/
- PropScribe: https://propscribe.co.uk/
- SurveyorSuite: https://surveyorsuite.co.uk/reports/rics-level-3-building-survey
- Imfuna: https://www.imfuna.com/industries/residential-surveying/
- RICS: https://www.rics.org/news-insights/rics-first-ever-standard-on-responsible-ai-use-now-in-effect
- Verisk XactAI: https://www.xactware.com/xactai.html
- Cotality: https://www.cotality.com/resources/computer-vision-for-property-professionals
- Pretakst: https://kommunikasjon.ntb.no/pressemelding/18228632/pretakst-utvikler-ny-ai-drevet-teknologi-for-tilstandsrapporter?publisherId=17848929&lang=no
- Besikt: https://besikt.app/
- KI-Syndikat: https://www.ki-syndikat.de/usecases/gutachter/
- Språkbanken (talegjenkjenning 2024): https://www.nb.no/sbfil/dok/2024_talegjenkjenning.pdf
- NHO om KI og arbeidsgiver: https://www.nho.no/tema/digitalisering/ki-pa-jobben-hva-ma-arbeidsgiver-gjore/
