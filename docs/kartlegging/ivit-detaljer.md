# IVIT i detalj: profil, innstillinger, menyer

Sist oppdatert: 24.10.2026
Status: Observasjon, ikke godkjent.
Kilde: En Claude-hjelpeagent gikk gjennom IVIT (versjon 10.2.8) med Ståles konto natt til 24.10.2026. Den bare leste, og endret ingenting utenfor testoppdraget 14553-3037. Kundedata er ikke tatt med.

## Viktigste funn

1. **IVIT eier dataene.** Lisensavtalen sier at alle data som registreres og lastes opp blir iVerdis eiendom, også etter oppsigelse, og at iVerdi kan bruke dem kommersielt. Det er et sterkt argument for at Byggcon eier sitt eget system.
2. **Byggcon har 507 egne fraser** i IVITs fraseregister (admin.ivit.no → Administrering av fraser). Frasene deles med Byggcon Helgeland og Troms. De er Byggcons eget innhold og bør eksporteres til EzProp. Mange har lik tittel og tekst, de er ikke koblet til kontrollpunkt eller TG, og de har ingen godkjenning.
3. **IVIT har en KI-funksjon** (KI-assistent og KI-konsistenssjekk) til 169 kr per rapport. Den er deaktivert hos Byggcon. Det er en rettelse: tidligere trodde vi at IVIT ikke hadde KI.
4. **Integrasjoner i IVIT:**
   - Boligpass (tilkoblet)
   - Eiendomsverdi (aktivert)
   - **PropCloud** (finnes)
   - Svea
   - eMonkey (regnskap)
   - meglerintegrasjon med tilbakeføring av data (40 kr per rapport, aktivert)
   - Boligmappa (ikke tilkoblet)
   - NS-abonnement
5. **Sikkerhet:** Tofaktorinnlogging er **av** for firmaet. Det er bare en avkrysning.
6. **Innstillinger lagres med en gang**, uten Lagre- eller Angre-knapp, og betalte tjenester ligger blandet med vanlige innstillinger.
7. **Varsler er ubrukelige:**
   - 5134 uleste
   - ingen «merk som lest» og ingen filter
   - norsk og engelsk dato om hverandre
8. **IVITs egne nyheter bekrefter kjente problemer:**
   - Data kan gå tapt ved synkronisering, og man må «gå online med iPad etter befaring».
   - Bilder ble rotert.
   - Tekst manglet i PDF-en.
   - Rådet om nettleser var motstridende.
9. **Sjekkpunkter endres sentralt uten varsel i rapporten**, for eksempel nye TG2-avvik 16.10. Byggcon bør selv eie og versjonere sjekklistene.

## Struktur

- **Toppmeny:**
  - fanene Ordre, Oppdrag, Fakturaer og Arkiv
  - globalt søk (oppdragsnr. og adresse, med matrikkel, status og dato i treffet)
  - «+ Oppdrag»
  - ikonene Kunder, Kalender, Varsler, Avatar og Fagsystemer
- **Avatarmenyen:**
  - status tilgjengelig/ikke tilgjengelig
  - innstillinger
  - «Abonnement», som viser klikkpriser per produkt
  - hjelp (ekstern Zendesk og diagnostikkfil)
  - bytt passord (Norsk takst-innlogging)
  - lisensavtale
  - logg ut
- **Innstillinger:**
  - **Personlig:** profilbilde og signatur med «Vis i rapport», kontaktinfo, rolle, Enova-ID og markedsbilde
  - **Sertifikater:** egen tabell med fra-dato
  - **Eksterne personer** og **medlemsnumre**
  - **Kalenderintegrasjon:** befaringer sendes til en e-postadresse
  - **Firma:**
    - firmabeskrivelse (blir rapportens side 2) og logo
    - avkrysning for «del alle oppdrag med alle ansatte», tofaktorinnlogging og e-postvarsel
    - rapportoppsett med én eller to kolonner
    - takstmenn med **startsekvens for oppdragsnummer**
    - tilgangsbegrensning for eksterne og kontorbrukere
    - tekst for ordrebekreftelse
    - redigerbare forutsetninger
  - **Integrasjoner:** se over
- **Kunder:** 1296 kunder, privat og bedrift. Det er dubletter på organisasjonsnummer og ingen kobling mot Brønnøysund.
- **Kalender:** måned, uke, dag og agenda, med valg av hvilke takstmenn som vises.
- **Varsler:** ordre mottatt eller tildelt, medansvar, partneroppdrag, oppdrag tildelt, delt, godkjent eller sendt tilbake, og meldinger.
- **admin.ivit.no** (egen app):
  - soner, postnummer og kontorer
  - saker med «Åpne igjen»
  - nyheter
  - frasebibliotek
  - ordrebehandling
  - «Deles med selskaper»
- **Kontrollpunkt:**
  - TG, HMS, ferdig, kopier, endre navn, nullstill, slett og fraser
  - **«i»** viser kravet fra forskriften med nøkkelord understreket
  - skjemanivå: enkel, detaljert eller kontrollpunkt
  - «Lagret kl.»
- **Tilbakemeldinger:** skjema med skjermopptak og tegneverktøy.

## Detaljer EzProp bør ha (prioritet)

| Detalj | Pri |
|---|---|
| «i»-knapp per kontrollpunkt med kravet fra forskriften | Høy |
| Frasebibliotek: Standard (låst), Mine, Delt, Favoritter, søk og rekkefølge med dra og slipp | Høy |
| Deling av fraser og oppdrag mellom selskapene | Høy |
| Lagrestatus med klokkeslett | Høy |
| Globalt søk med oppdragsnr., adresse og matrikkel | Høy |
| Arkiv med sortering, hurtigperioder og lagrede filtre | Høy |
| Signatur og profilbilde i rapporten | Høy |
| Firmabeskrivelse på rapportens side 2 (fra kunnskapsbasen) | Høy |
| Kalender koblet direkte til Microsoft 365 | Høy |
| Faner etter fase med antall | Høy |
| Radmeny: kopier oppdrag, last ned siste PDF, bytt takstmann, kopier data fra | Høy |
| Tilgangsbegrensning per bruker | Høy |
| Ordrebekreftelse og forutsetninger som firmainnstilling | Høy |
| Format på oppdragsnummer per takstmann (må bestemmes) | Middels |
| Kalender med alle takstmenn | Middels |
| Ansattfilter med avatarer over listen | Middels |
| Kort notat per oppdragsrad | Middels |
| HMS-merke på kontrollpunkt | Middels |
| Enkel tilbakemelding med skjermbilde | Middels |
| Endringslogg i appen | Middels |
| Kunderegister med oppslag i Brønnøysund og matrikkel | Middels |

## Svakheter EzProp skal gjøre bedre

- **Data:** Dataene skal eies av Byggcon.
- **Sikkerhet:** Tofaktorinnlogging eller engangskode på e-post skal være påkrevd.
- **Innstillinger:** Endringer skal bekreftes og kunne angres, og betalte tjenester skal ligge for seg.
- **Varsler:** De skal fungere som en arbeidsliste med lest/ulest, filter og gruppering.
- **Kunder:** Ingen dubletter. Bedrifter slås opp i Brønnøysund.
- **Språk:** Bare norsk, og ingen tekniske koder i grensesnittet.
- **Tomme sider:** Tomtilstander skal ha tekst som forklarer hva som skal stå der.
- **Hjelp og tastatur:** Hjelp inne i appen, og tastatursnarveier.
- **Lagring:** Trygg lagring uten nett, og synlig synkstatus.
- **Sjekklister:** Versjonert, og rapporten låses til versjonen den ble startet med.
- **Fraser:** Koblet til kontrollpunkt og felt, og godkjent av fagansvarlig.
- **Én app:** Administrasjonen styres av rolle, ikke av en egen app.
