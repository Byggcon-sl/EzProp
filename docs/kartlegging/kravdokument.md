# Kravdokument – Byggcons eget rapportsystem (arbeidsnavn EzProp)

Sist oppdatert: 25.10.2026 (merket som historisk, tall og henvisninger rettet)
Første versjon: 22.10.2026
Status: Historisk. Ikke godkjent av Ståle.
Laget av: Claude, sammen med Ståle. [Kilde: samtale med Ståle og observasjon i IVIT, 22.10.2026]

> **Historisk dokument (22.10.2026). Beslutningene i LES-MEG går foran. Gjeldende krav samles i `datamodell.md` og `utviklingsplan.md`.**
>
> De to filene er ikke laget ennå (se «Neste steg» i `LES-MEG.md`). Til da er beslutningstabellen i `LES-MEG.md` fasit.
>
> Kjente punkter i dette dokumentet som er endret senere (sidemannskontroll del 1, M2, og LES-MEG 25.10.2026):
> - **Eiendomsdata:** Byggcon har ingen avtale med Kartverket. Eier, byggeår og areal registreres for hånd i starten. Eiendomsverdi og PropCloud kommer senere.
> - **Egenerklæring og utkast til eier** er krav i NS 3600, ikke i forskriften. De stopper ikke publisering. Bare de 7 kravene i LES-MEG gir sperre.
> - **NS-henvisning:** Kilden til levetiden ligger i bakgrunnen i regelen. Den står ikke i rapportteksten. Premisseteksten henviser til standarden.
> - **Maler:** Det blir to slags maler: systemmaler fra Byggcon og egne maler laget i en visuell malbygger.
> - **Leilighet:** Eierform og fellesdeler skal være med fra start.

Regelverket (forskriften og NS 3600) er oppsummert i `regelverk-krav.md` i samme mappe.

## 1. Mål

Byggcon skal lage sitt eget system for tilstandsrapporter som **erstatter IVIT internt**. Vi kartlegger hva IVIT *gjør* (funksjon og flyt), og bygger det på vår egen måte. Vi kopierer ikke IVITs design, tekster, kode eller merkevare.

Beslutninger tatt 22.10.2026 [Kilde: Ståle]:

| Tema | Beslutning |
|---|---|
| Hovedmål | Erstatte IVIT for Byggcons egne takstmenn |
| Første rapporttype | Tilstandsrapport bolig (forskrift til avhendingslova / NS 3600:2025) |
| Plattform | Nettleser + iPad, befaring må virke uten nett |
| Brukere | Takstmenn, administrasjon, kunder/meglere |
| Integrasjoner | Eiendomsdata (matrikkel/grunnbok) og Visma eAccounting (faktura, har API) |
| Kode | Eget repo `Byggcon-sl/EzProp`. Samme teknologi som Optiplan, slik at de senere kan få felles innlogging og en meny øverst for å bytte mellom Optiplan og rapportsystemet. Lite felles logikk ellers. |

## 2. Slik jobber IVIT i dag (observert)

### 2.1 Oppdragsliste
- Faner: Siste oppdrag, Forberedelser, Befaringer, Ferdigstilling, Ferdige, pluss «Godkjenninger».
- Hver rad: adresse, oppdragsgiver (f.eks. Fremtind/Generell), oppdragsnummer, status (Under arbeid, Ferdig, Fakturert), delstatus (Oppdrag startet, Befaring planlagt, Endelig rapport levert), rapporttype, kunde og ansvarlig takstmann.
- Hovedmeny: Ordre, Oppdrag, Fakturaer, Arkiv.

### 2.2 Nytt oppdrag (veiviser i 6 steg)
0. Velg oppdragsgiver/avtale: *Fremtind* eller *Generell* (bekreftes).
1. **Søk etter eiendom** – søk på adresse, navn, matrikkel eller sted (Ambita). Viser kart, eiere, tinglyst dato og siste omsetning.
2. **Adresse** – fylles ut automatisk: gate, nr, postnr, sted, kommune, gnr/bnr/fnr/snr, bruksenhet (f.eks. H0101).
3. **Kunde** – privat/bedrift. Fylles automatisk med første hjemmelshaver.
4. **Oppdrag** – oppdragsdato, leveringsdato, vår ref, deres ref, mottatt av, notater, melding og fakturainfo fra megler.
5. **Ansvarlig** – ansvarlig takstingeniør (påkrevd), rolle, medansvarlig, ekstern person.
6. **Rekvirert av** – navn, e-post, telefon.

Etter lagring har oppdraget fanene Oversikt, Dokumenter, Notater, Befaringer, Faktura/ordregrunnlag, Ordrebekreftelse, Bilder, Dele oppdrag og Revisjoner. IVIT varsler hvis obligatorisk ordrebekreftelse ikke er sendt.

### 2.3 Ny rapport
- Kategori: Bolig, Landbruk, Takstrapport (mal), Verditakst tomt.
- Under Bolig: Tilstandsrapport (mal «NS3600 2025 – Generell»), Verditakst, Arealmålingsrapport, Reklamasjonsrapport.
- Formål med takseringen (f.eks. Salg).
- Ingenting koster penger før «Ferdig rapport». [Kilde: Ståle]

### 2.4 Rapportens deler
Eiendomsdata · Opplysninger om eiendommen · Bygninger · Konstruksjoner · Kort sammendrag av tilstand · Oppsummering bygningsdeler · Årlige kostnader · Teknisk verdi · Markedsverdi · Forutsetninger.

Eiendomsdata: matrikkel med eiere og tomteareal (hentet automatisk), skattetakst/formuesverdi, siste hjemmelsovergang (kjøpesum, år, type), forsikring.

### 2.5 Bygninger, etasjer og rom
- Bygninger hentes automatisk fra matrikkelen (eksempel: Enebolig + Garasje, med byggeår og antall etasjer).
- Per bygning: navn, type, hovedbygg (ja/nei), undertype, anvendelse, byggeår, standard, vedlikehold, bilde. Egne faner for Etasjer, Tilbygg/modernisering og Lovlighet.
- Rom legges til per etasje ved å velge fra en fast liste med 55 romtyper (flere kan velges samtidig).
- Hvert rom har nummer, navn og arealtype (BRA-i / BRA-e / BRA-b). Arealtypen settes automatisk ut fra romtypen (innglasset balkong → BRA-b, ellers BRA-i).

### 2.6 Konstruksjoner – dynamisk sjekkliste
Sjekklisten bygges ut fra bygningen, rommene og svarene.

**a) Faste kontrollpunkter per bygning (40 stk)**

*Rettet 25.10.2026: Her sto tidligere 47. Listen under har 40 punkter (10 + 11 + 10 + 9), og det samme har `kartlegging-kontrollpunkter.md`.*

- *Utvendig (10):* Taktekking · Nedløp, beslag og skorsteiner over tak · Takkonstruksjon/loft · Yttervegger · Vinduer og takvinduer · Ytterdører · Balkonger, verandaer, takterrasser · Terrasser og plattinger på terreng · Utvendige trapper · Andre utvendige forhold
- *Innvendig (11):* Overflater gulv · Overflater vegger og himlinger · Etasjeskiller og bærende konstruksjoner · Radon · Pipe/skorstein og ildsteder · Rom under terreng · Krypkjeller · Innvendige trapper · Innvendige dører · Skadedyr og fuktkrevende insekter · Andre innvendige forhold
- *Tekniske installasjoner (10):* Innvendige vannledninger · Innvendige avløpsrør · Ventilasjon · Varmesentral · Varmtvannsbereder · Vannbåren varme · Andre VVS-installasjoner · Elektrisk anlegg · Branntekniske forhold · Andre installasjoner
- *Tomteforhold (9):* Byggegrunn · Fuktsikring og drenering · Grunnmur og fundamenter · Forstøtningsmurer · Terrengforhold · Utvendige vann- og avløpsledninger · Septiktank · Oljetank · Andre tomteforhold

**b) Romstyrte kontrollpunkter – én blokk per rom**

Testet med alle 55 romtyper 22.10.2026. Bare 10 romtyper gir egne punkter. Gruppene følger NS 3600 tillegg A (A.2.1 våtrom, A.2.2 kjøkken, A.2.3 toalettrom, A.2.8 spesialrom):

| Gruppe | Romtyper som utløser gruppen | Kontrollpunkter per rom |
|---|---|---|
| Våtrom | Bad, Vaskerom, Bad/vaskerom, Annet våtrom | Generell · Dokumentasjon for våtrom · Overflater vegger og himling · Overflater gulv · Vanntett sjikt, membran og sluk · Sanitærutstyr og innredning · Ventilasjon · Tilliggende konstruksjoner våtrom (8) |
| Kjøkken | Kjøkken, Stue/kjøkken | Overflater og innredning · Avtrekk (2) |
| Toalettrom | Toalettrom | Overflater og konstruksjon · Sanitærutstyr · Avtrekk/ventilasjon (3) |
| Plassbygde spesialrom | Badstue, Fyrrom, Kjølerom | Overflater og konstruksjon · Teknisk anlegg (2) |

Romtyper uten egne punkter (dekkes av de faste): Alkove, Allrom, Annet, Annet rom med sluk, Arbeidsrom, Bibliotek, Bod, Entré, Gang, Garasje, Garderobe, Hall, Hall m/trapp, Hjemmekontor, Hobbyrom, Innglasset balkong, Kjellerstue, Kontor, Kott, Kryperom, Lagerrom, Lekerom, Loftstue, Matkjeller, Medierom, Omkledningsrom, PC-rom, Peisstue, Potetkjeller, Soverom, Spisestue, Stue, Stue m/trapp, Svømmebasseng, Søppelrom, Teknisk rom, Trapperom, Trimrom, TV-stue, Uinnredet kjellerrom, Uinnredet loft, Verksted, Vindfang, Vinkjeller, Walk-in closet.

Avvik vi bør vurdere å gjøre annerledes:
- «Teknisk rom» gir ingen punkter, men NS 3600 A.2.8 omfatter VVS-rom.
- «Annet rom med sluk» gir ikke våtromspunkter.
- «Svømmebasseng» gir ingen punkter. NS 3600 sier at basseng alltid skal ha TGIU.
- Innredet loft (A.2.6) og «andre rom» (A.2.4) har egne punkter i standarden, men gir ikke egne blokker i IVIT.

**c) Svar som utløser flere spørsmål (testet på Taktekking 22.10.2026)**

Oppbygging av et kontrollpunkt (eksempel Taktekking):
1. Materialvalg (flervalg): 17 typer tekking og 4 typer undertak.
2. Besiktiget fra: bakkenivå / fra taket / fra takfot i stige.
3. Beskrivelse (fritekst, kan sendes til samlebeskrivelse).
4. Alder: byggeår / ukjent / årstall.
5. Avviksspørsmål: ja/nei-spørsmål. «Ingen avvik» kan velges for alle samtidig.
6. Eget TG-avvik (fritekst), utfyllende beskrivelse og bilder (velg bilde / bildearkiv).
7. Verktøylinje: TG, HMS, ferdig-markering, kopier, rediger, tilbakestill, slett, frasepanel og info.

Taktekking har 12 faste avviksspørsmål. Blant annet: strakstiltak, fukt/råte, deformasjoner i beslag, biologiske skadegjørere, sprekker/mose, for lite fall, tæret/skadet tekking, uegnet tekking, «vanntett sjikt eldre enn 18 år», ikke mulig å vurdere, svak innfesting og HMS.

Valg som gir ekstra spørsmål:

| Valg | Ekstra avviksspørsmål |
|---|---|
| Flatt tak | +3: store vannansamlinger på taket · manglende sluk eller overløp · sluk ikke tilgjengelig for vedlikehold og kontroll |
| Torv | +1: sig i torvtekkingen / strekk i undertekkingen |
| Skifertakstein | +1: skiferstein ute av posisjon |
| Undertak: Banemembran | +1: eldre enn 18 år (= NS 3600 tabell C.4) |
| Undertak: Oljeimpregnerte trefiberplater | +1: eldre enn 13 år (= tabell C.4) |
| Undertak: Diffusjonsåpent undertak | +1: eldre enn 13 år (= tabell C.4) |
| Undertak: Takpapp | ingen ekstra spørsmål |
| Andre tekkingstyper | ingen ekstra spørsmål |

Aldersgrensene er levetidene i NS 3600 tillegg C (se `regelverk-krav.md` avsnitt 2).

Mønsteret: hvert avviksspørsmål er knyttet til en betingelse (alltid, eller «materialvalg X er krysset av»). Vårt system bør lagre spørsmål og betingelser som data.

**d) TG-logikk: «Ja» på et avviksspørsmål (testet på Taktekking 22.10.2026)**

Hvert avviksspørsmål har en ferdig *konsekvens*: TG, en kort avvikstekst og en tekst for konsekvens/tiltak. Teksten kan redigeres (blyant).

| Avviksspørsmål (Taktekking) | TG ved «Ja» |
|---|---|
| Svekkelser/skader som krever strakstiltak | TG3 |
| Fukt- eller råteskade | TG3 |
| Store deformasjoner i beslag, renner, nedløp | TG3 |
| Biologiske skadegjørere | **Velg selv:** TG3 «skader påvist» eller TG2 «symptom på aktivitet» |
| Sprekker, mose, ujevnheter | TG2 |
| For lite fall | TG2 |
| Tæret, skadet eller deformert | TG2 |
| Uegnet tekking | TG2 |
| Vanntett sjikt eldre enn 18 år | TG2 |
| Ikke mulig å vurdere | **Velg selv:** TGIU «snødekt» eller TGIU «manglende sikker adkomst» |
| Svak mekanisk innfesting | TG2 |
| HMS-forhold | Ingen TG. Gir et HMS-avvik med fritekst, som havner i HMS-oppsummeringen. |
| Eget TG-avvik (fritekst) | TG2 som standard, kan endres til TG3. Har eget felt for konsekvens/tiltak. |

Regler observert:
- **Høyeste TG vinner.** Ett TG2-avvik og ett TG3-avvik gir TG3. Fjernes TG3-avviket, faller punktet tilbake til TG2.
- **Alle svar «Nei» gir TG1** automatisk.
- **Ingen avvik:** I TG-menyen kan bare TG0, TG1 og TGIU velges. TG2 og TG3 er låst.
- **Med avvik:** Bare TG2 og TG3 kan velges. TG0, TG1 og TGIU er låst.
- **Kostnadsestimat:** Ved TG2/TG3 kommer et valg for kostnadsestimat: under 20 000 · 20–100 000 · 100–200 000 · 200–500 000 · over 500 000 kr.
- **TG2 og TG3:** Avviksteksten kan være lik, men konsekvensen er annerledes, og ved TG3 skal det settes kostnadsestimat. [Kilde: Ståle 22.10.2026] Dette stemmer med forskriften § 2-22, der TG3 krever kostnadsanslag.

**e) Frasepanel**
- Åpnes fra verktøylinjen eller fraseknappen i et tekstfelt. Viser fraser for *det feltet som er valgt*, så beskrivelse og avvik har forskjellige fraser.
- Fire kilder som kan slås av og på: Standard (fra IVIT), Mine, Delt (felles for firmaet) og Favoritter.
- Hver frase har en kort tittel (f.eks. «Besiktiget fra bakkenivå», «Eldre undertak (TG2)») og settes inn med «+». Fraser kan søkes i, endres og lages nye.
- Byggcons egne «Delt»-fraser er Byggcons innhold og bør hentes over til vår frasebank (`02 Fagkunnskap`) når vi bygger.

## 3. Krav til vårt system (første versjon)

1. **Oppdrag:** opprett oppdrag med eiendomssøk, automatisk utfylling av adresse, matrikkel og kunde, og ansvarlig takstmann.
2. **Bygninger, etasjer og rom:** hent bygninger fra matrikkelen der det er mulig. Rom velges fra en romtypeliste som vi eier selv. Boligtype styrer omfanget (NS 3600 A.1).
3. **Dynamisk sjekkliste:** sjekklisten er styrt av data, ikke skrevet inn i koden:
   - En tabell kobler romtype → sjekklistegruppe → kontrollpunkter.
   - En tabell med regler sier hvilke svar som utløser hvilke tilleggsspørsmål.
   - Byggcon (fagansvarlig) skal kunne endre dette uten utvikler.
   - Sjekklister og levetider har versjon per utgave av NS 3600. Befaringsdatoen avgjør hvilken som brukes.
4. **Kontrollpunkt:** materialvalg, besiktiget fra, alder, ja/nei-avviksspørsmål med «Ingen avvik»-snarvei, TG 0–3 og TGIU, beskrivelse, årsak/konsekvens/tiltak, målinger (verdi og målested), bilder, HMS-flagg og fraser fra Byggcons godkjente frasebank (`02 Fagkunnskap`).
5. **TG fra avvik:**
   - Hvert avviksspørsmål har én eller flere ferdige konsekvenser (TG og tekst). Når det er flere, velger takstmannen én.
   - Høyeste TG vinner.
   - TG2 og TG3 kan bare settes når det finnes et avvik. TG0, TG1 og TGIU kan bare settes når det ikke finnes noe.
   - Takstmannen kan legge inn eget avvik med fritekst.
6. **Lovpålagte kontroller:** se `regelverk-krav.md` avsnitt 5. Blant annet:
   - TG3 kan ikke lagres uten kostnadsanslag.
   - TGIU krever fire felt.
   - Enkelte punkter har låste grader, og noen punkter får aldri TG.
   - Hulltaking krever samtykke og måledata.
   - Rapporten kan ikke ferdigstilles uten egenerklæring.
7. **Levetider:** tabellen fra NS 3600 tillegg C ligger som data og brukes til å foreslå TG2 ut fra alder, med kildehenvisning.
8. **Frasebank per felt:** frasene er knyttet til kontrollpunkt og felt, med kildene Byggcon felles, egne og favoritter.
9. **Uten nett:** befaringen skal kunne gjøres på iPad uten nett og synkroniseres etterpå, uten at tekst går tapt. (IVIT advarer om at tekst kan gå tapt ved ny synkronisering. Dette skal vi unngå.)
10. **Rapport og PDF:** innhold etter NS 3600 pkt. 14:
    - oppdrag
    - fakta om boligen, inkludert lyd og støy
    - tilstandsanalyse
    - el
    - brann
    - HMS
    - dokumentasjon
    - avvik fra egenerklæring
    - areal
    - vedlegg

    PDF lages fra Byggcons egen mal. Utkast går til eier før endelig rapport. Rettinger får versjonsnummer, og datoen beholdes.
11. **Datamodell:** bør følge SN-NSPEK 3477 (datastruktur for digitale tilstandsrapporter), slik at vi er klare hvis Direktoratet for byggkvalitet krever et fast dataformat (forskriften § 1-7).
12. **Sidemannskontroll:** støtte for kontroll før levering (kobles til skillen `byggcon:sidemannskontroll`).
13. **Faktura:** fakturagrunnlag sendes til Visma eAccounting (senere versjon).
14. **Kunde- og meglerportal:** bestilling og henting av rapport (senere versjon).

## 4. Åpne spørsmål

- Har Byggcon egen avtale med Ambita (eller en annen leverandør av eiendomsdata), eller går dette bare gjennom IVIT i dag?
- Hvem i Byggcon kan lage API-nøkkel til eAccounting?
- Hva gjør IVIT ved «Ferdig rapport» (registrering, levering til megler, betaling)?
- Hva irriterer Ståle mest i IVIT i dag? (Brukes til å prioritere.)
- Navnet «EzProp» er også brukt på en lenke («EzProp Skade») på intranettets startside. Er det et eksisterende system?
- Hvor kommer IVITs kostnadsintervaller fra (under 20 000 … over 500 000 kr)? De står ikke i NS 3600 eller forskriften.
- Har Byggcon SN-NSPEK 3477? Har Direktoratet for byggkvalitet bestemt et fast dataformat?
- Skal ferdige avvikstekster (konsekvens/tiltak) skrives av Byggcon selv? IVITs standardtekster kan ikke kopieres.

## 5. Neste kartlegging

- [x] Tilleggsspørsmål på Taktekking (Flatt tak, Torv, Skifertakstein, undertak) – 22.10.2026
- [x] Hva skjer ved «Ja» på et avviksspørsmål (TG og tekst) – 22.10.2026
- [x] Frasepanel – 22.10.2026 (grunnleggende)
- [x] Regelverk: forskrift og NS 3600:2025 – 22.10.2026 (se `regelverk-krav.md`)
- [ ] Ett våtrom (Bad) i detalj: hulltaking, målinger, dokumentasjon av vanntett sjikt
- [ ] Tilleggsspørsmål på de andre faste kontrollpunktene
- [ ] El, brann, HMS, dokumentasjon og egenerklæring – hvor i IVIT ligger dette?
- [ ] Opplysninger om eiendommen, Kort sammendrag, Oppsummering, Årlige kostnader, Teknisk verdi, Markedsverdi, Forutsetninger
- [ ] PDF-utskrift (forhåndsvisning, uten å trykke «Ferdig rapport»)
- [ ] Ordrebekreftelse, faktura/ordregrunnlag, deling med megler

*Merk 25.10.2026: Listen over er ikke oppdatert etter 22.10. Det meste er kartlagt senere, se `kartlegging-kontrollpunkter.md` avsnitt 8.*

Testoppdrag i IVIT: et oppdrag av typen Generell, opprettet 22.10.2026 av Ståle på egen bolig. Inneholder en tilstandsrapport som ikke er ferdig.

## Endringslogg

| Dato | Endring | Kilde |
|---|---|---|
| 22.10.2026 | Første versjon | Samtale med Ståle og observasjon i IVIT |
| 25.10.2026 | Boks øverst: dokumentet er historisk, og LES-MEG går foran. Liste over kjente punkter som er endret senere. | Sidemannskontroll del 1, M2. LES-MEG 25.10.2026 |
| 25.10.2026 | Antall faste kontrollpunkter rettet fra 47 til 40 (talt i listen i 2.6 a og i `kartlegging-kontrollpunkter.md`). | Sidemannskontroll del 1, motsigelsestabellen |
| 25.10.2026 | Henvisninger rettet: levetider står i `regelverk-krav.md` avsnitt 2 (ikke 5), og kontrollene står i avsnitt 5 (ikke 8). | Sidemannskontroll del 1, M2 |
| 25.10.2026 | Merknad om at «Neste kartlegging» er utdatert. Resten av innholdet står uendret. | Sidemannskontroll del 1, F1 |
