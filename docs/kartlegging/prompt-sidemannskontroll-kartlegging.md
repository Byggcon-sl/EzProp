# Oppgave: Sidemannskontroll av kartleggingen for EzProp

Du skal kontrollere arbeidet som er gjort for Byggcon. Byggcon er et takseringsfirma med hovedkontor i Bodø og tre selskaper: Byggcon Nord, Helgeland og Troms. Du jobber for Ståle Limstrand, daglig leder og produkteier. Svar på norsk, i enkelt og konkret språk, og unngå engelske ord.

## Bakgrunn

Byggcon skal lage sitt eget system for tilstandsrapporter, med arbeidsnavnet **EzProp**. Det skal erstatte IVIT. Fra 22. til 25.10.2026 har en annen Claude-økt gjort dette:
- kartlagt IVIT, som Byggcon bruker i dag
- kartlagt Spectora, et amerikansk program brukt som inspirasjon for CRM, automatisering og maler
- kartlagt SmartTakst, en norsk konkurrent
- samlet Ståles beslutninger
- skrevet kravdokument, forslag til funksjoner, design, KI-funksjoner og prøveeksempler på avvikstekster

I en egen chat er Byggcons fraser i IVIT ryddet og utvidet.

Du skal være en **uavhengig sidemann**. Målet er å finne det som er oversett, misforstått, motsigende eller for svakt begrunnet, før utviklingen starter. Ikke bare bekreft det som står. Les kildene selv, og vurder med egne øyne.

## Les dette først

Alt ligger i SharePoint-mappen «Claude» (området Bilder → Delte dokumenter → Claude).

1. `LES-MEG.md` og `01 Kunnskapsbase/00-LES-MEG-FORST.md`. Kunnskapsbasen er fasit om Byggcon.
2. **Hovedmappen:** `03 Arbeidsmappe/2026-10-22 Eget rapportsystem – kartlegging av IVIT (SL)/`
   - Start med `LES-MEG.md`. Den har alle beslutninger og en liste over filene.
   - Les alle `.md`-filene i mappen.
   - Undermappen `EzProp-kartlegging-arkiv/` har Excel- og Word-filer, designskisser og de fullstendige rapportene fra hjelpeagentene. Bruk de fullstendige rapportene når et sammendrag virker tynt.
3. **Frasearbeidet:** `03 Arbeidsmappe/2026-10-24 Fraser i IVIT (SL)/`. Les `LES-MEG.md`, `Fraseregister-IVIT-forklaring.md` og Excel-filen med versjon 13.
4. **Til godkjenning:** `01 Kunnskapsbase/09 Innsamling (ikke godkjent)/1 Til godkjenning/`, særlig avvikstekstene og frasefilene.
5. **Regelverket:**
   - Forskrift til avhendingslova (tryggere bolighandel), på lovdata.no
   - NS 3600:2025, som ligger i kunnskapsmappen i SharePoint
   - **Kopier aldri tekst fra standarden** inn i rapporten din. Henvis til punkt og tabell.

## Det som er bestemt (kort)

Les selve beslutningstabellen i LES-MEG. Hovedpunktene:
- **Forskriften** bestemmer hva som undersøkes. **NS 3600** brukes bare for vilkårene for tilstandsgrad.
- **Norsk marked:** megler bestiller før salget. Byggcon fakturerer megler eller selger etter levering, via Visma eAccounting. Det er ingen betaling i systemet.
- **Teknikk:** alt i nettleseren, og befaring uten nett er et krav (iPad Pro).
- **Samarbeid:** flere selskaper og ansatte fra bunnen av, og klart for salg til andre takstfirma.
- **TG:** forslag ut fra materiale og alder etter faste regler. KI setter aldri TG.
- **Publisering:** bare krav i forskriften stopper publisering. Alt annet gir advarsel.
- **Fraser og maler:** åpne for alle ansatte, men med endringslogg.
- **Design:** retning A, luftig.

## Dette skal du kontrollere

**1. Regelverket**
- Dekker kravene i `regelverk-krav.md` og `kravdokument.md` alt forskriften krever av innhold i tilstandsrapporten? Tenk på:
  - bygningsdeler og rom
  - hulltaking og fuktmåling
  - areal
  - TGIU
  - årsak, konsekvens og tiltak
  - kostnadsanslag
  - egenerklæring
  - dokumentasjon
  - takstmannens kvalifikasjoner og uavhengighet
  - befaringen
  - gyldighet
- Stemmer levetidene, grensene og TG-reglene med NS 3600:2025? Det gjelder både kartleggingen, de 10 prøveeksemplene på avvikstekster og TG-reglene i frasearbeidet. Eksempler på regler å sjekke:
  - «Eier nekter hulltaking gir TG2»
  - «Loft uten adkomst gir TG2»
  - «El, radon og rekkverk får ikke TG»
  - radongrense 100 Bq/m³
- Er det andre lover og regler systemet må følge? For eksempel:
  - personvern (GDPR)
  - hvor lenge rapporter og bilder skal oppbevares
  - krav fra Norsk takst eller sertifiseringsordningen
  - forsikringskrav for takstmannen
  - registrering eller innsending av rapporten
  - energimerking
  - universell utforming

**2. Fullstendighet i kartleggingen**
- Er det deler av IVIT som ikke er kartlagt? Sammenlign filene med hverandre, for eksempel:
  - rapporttyper ut over tilstandsrapport
  - roller og tilganger
  - administrasjon
  - integrasjoner
  - statistikk
  - arkiv
  - rapporthistorikk og revisjoner
- Er det viktige funksjoner i Spectora eller SmartTakst som ikke er vurdert for EzProp?
- Bør andre norske løsninger eller bransjeverktøy kartlegges før utviklingen starter? Gjør et kort søk og foreslå de viktigste.

**3. Motsigelser og hull mellom dokumentene**
- Er det steder der eldre dokumenter sier noe annet enn beslutningene i LES-MEG? Et eksempel er `kravdokument.md` fra 22.10.
- Passer frasearbeidet (kodesystem, TG-regler, navnemønster) med kravene til EzProp, slik at frasene kan flyttes over uten problemer?
- Er noen beslutninger uklare, eller mangler de begrunnelse?

**4. Risiko og antakelser**
- **Teknikk:** befaring uten nett i nettleseren, synkronisering, bilder og flere brukere i samme rapport.
- **Forretning:**
  - data og eierskap (IVITs lisensavtale)
  - overgangen fra IVIT
  - historiske rapporter
  - salg til andre takstfirma
- **Juss:** bruk av tekster fra IVIT, Smarttakst og NS 3600, ansvar for KI-tekst, og personvern.
- **Uprøvde antakelser:** Hva tar vi for gitt uten at det er sjekket?

**5. Kvaliteten på prøveeksemplene**
- Følger de 10 avvikstekstene Ståles språkregler?
  - ingen gjetteord
  - ingen NS-henvisning i selve teksten
  - flere tiltak
  - kostnadstekst bare ved behov
- Er de faglig riktige?

## Grenser

- **Ikke endre** eksisterende filer. Skriv bare din egen rapport, og legg forslag til endringer i den.
- **Ikke logg inn** i IVIT, Spectora eller SmartTakst. Kontrollen gjøres på dokumentene.
- **Ingen passord og ingen kundeopplysninger** i filene.
- **Kopier ikke** tekst fra NS 3600, IVIT eller SmartTakst.
- **Er du usikker:** skriv det som et spørsmål, ikke som en påstand.

## Leveranse

Lagre rapporten som `sidemannskontroll-kartlegging-<dato>.md` i hovedmappen (`03 Arbeidsmappe/2026-10-22 Eget rapportsystem – kartlegging av IVIT (SL)/`). Øverst skal den ha sist oppdatert, status «Utkast – ikke godkjent» og kilder.

Struktur:
1. **Kort oppsummering:** de 5–10 viktigste funnene, sortert etter alvor
2. **Funn per kontrollområde (1–5 over)**, hvert funn med:
   - alvor: **Kritisk** (må avklares før utvikling), **Viktig** eller **Kan vurderes**
   - hva som er funnet, med henvisning til fil og avsnitt
   - kilde: paragraf i forskriften, punkt i NS 3600 eller lenke
   - forslag til hva som bør gjøres
3. **Motsigelser mellom dokumentene:** en tabell med fil A, fil B, hva som er ulikt, og forslag
4. **Spørsmål til Ståle,** sortert etter viktighet
5. **Det som er godt gjort**, kort, så vi vet hva vi kan stole på

Gi deretter Ståle en kort oppsummering i chatten, med lenke til rapporten. Forslag til nye spørsmål i `01 Kunnskapsbase/99-apne-sporsmal.md` skal stå i rapporten. Ståle avgjør om de skal føres inn.
