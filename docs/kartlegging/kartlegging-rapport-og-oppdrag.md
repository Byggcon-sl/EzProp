# Kartlegging: rapportens øvrige deler, verktøy og oppdragssiden i IVIT

Sist oppdatert: 23.10.2026
Status: Utkast – observasjon i IVIT, ikke godkjent.
Kilde: Testoppdrag [oppdragsnr fjernet] (Ståles egen bolig, type Generell) i IVIT. Gjennomgått natt til 23.10.2026. Rapportutkast lastet ned som PDF for å se oppbyggingen. Ingenting er sendt, levert eller fakturert.

Hører sammen med `kravdokument.md`, `kartlegging-kontrollpunkter.md` og `kartlegging-bad.md`.

## 1. Rapportens deler (venstremeny)

| Del | Innhold |
|---|---|
| Eiendomsdata | **Matrikkel** (kommune, gnr/bnr/fnr/snr, adresse, eiere, tomteareal – hentet fra Ambita, kan legge til flere matrikler). **Skattetakst og formuesverdi** (beløp, år, kommentar). **Siste hjemmelsovergang** (kjøpesum, år, type som «fritt salg», om den skal vises i rapporten). **Forsikring** (selskap, avtalenr., forsikringssum, premie, type). |
| Opplysninger om eiendommen | Tabell med fritekstlinjer som legges til («add») |
| Bygninger | Per bygning fire faner – se avsnitt 2 |
| Konstruksjoner | Sjekklistene – se `kartlegging-kontrollpunkter.md` |
| Kort sammendrag av tilstand | Ett fritekstfelt «Sammendrag» |
| Oppsummering bygningsdeler | Per bygning og gruppe (utvendig, innvendig, våtrom, kjøkken, tekniske installasjoner, tomteforhold) med «sync»-knapp som henter tekster fra kontrollpunktene («Sendes til samlebeskrivelse») |
| Årlige kostnader | Linjer med beskrivelse og kostnad per måned, kvartal eller år. Sum per år. |
| Teknisk verdi | Per bygning og tomt: byggeår, vedlikeholdsbehov (f.eks. «middels 0,5 %»), pris per m² etter byggtype (veiledende byggekostnader), korreksjon for størrelse, vekting per etasje, normale byggekostnader (beregnet og fastsatt), tillegg for spesielle konstruksjoner, fradrag for elde og mangler. Sum teknisk verdi inkl. tomt. |
| Markedsverdi | Markedsvurdering (tekst, påkrevd), markedsverdi uten fradrag, avrundet markedsverdi, pris per m² (BRA-i og BRA), **sammenlignbare salg** og **«Start Verdiassistent» fra Eiendomsverdi** |
| Forutsetninger | Lang standardtekst med en kommentarboks. Teksten sier selv at **forskriften fastsetter minimumsinnholdet og hva som skal undersøkes, og at NS 3600:2025 legges til grunn for valg av tilstandsgrad.** Det er nøyaktig Byggcons prinsipp. [Ståle 22.10.2026] |

**Rapporttype styrer delene.** Under Innstillinger kan man velge:
- Eierform: selveier, aksjeobjekt eller andelsobjekt
- Oppdragstype: tilstandsrapport eller verditakst
- Oppsett: med markedsverdi / med teknisk verdi men uten markedsverdi / uten teknisk verdi og markedsverdi / uten arealmåling
- Tilleggsfunksjon: energimerking (gebyr)

## 2. Bygninger

- **Bygningsinformasjon:** posisjon, navn, type, hovedbygg, undertype, anvendelse, byggeår og kommentar, standard, vedlikehold og bilde. Validering advarer hvis ingen bygning er merket som hovedbygg.
- **Etasjer (arealer):**
  - Tabell per etasje: BRA-i, BRA-e, BRA-b, SUM og TBA (terrasse og balkong).
  - Tilleggsopplysninger: ALH (areal ved lav himlingshøyde) og GUA (gulvareal).
  - Kolonne «Fra Ambita», kommentarfelt, og spørsmålet «Er det vanskelig eller umulig å måle opp arealet nøyaktig?».
  - Rommene fordeles per etasje og arealtype.
- **Tilbygg/modernisering:** tabell med type, årstall og beskrivelse.
- **Lovlighet:**
  - Byggetegninger, fem alternativer: godkjente og stemmer / ikke godkjente / godkjente men stemmer ikke med bruk / godkjente men med avvik / ingen tegninger.
  - Håndverkertjenester siste 5 år (ja/nei, jf. forskriften § 2-19).
  - Åpenbare ulovligheter (ja/nei, jf. § 2-21).
- **Garasje:** egen bygning med egne opplysninger. Vises under «Bygninger på eiendommen» i rapporten.

## 3. Verktøylinjen i rapporten

| Knapp | Hva den gjør |
|---|---|
| Forskrift til avhendingslova | Lenke til forskriften |
| Kopier data fra | **Kopierer valgte deler fra en annen rapport:** opplysninger, bygninger, konstruksjoner, sammendrag, oppsummering, årlige kostnader, teknisk verdi, markedsverdi, energimerking, aksje/andel, forutsetninger og «avvik, TG, konsekvens/tiltak». Kan ta med vedlegg og notater. Nyttig ved ny rapport på samme bolig. |
| Notater | Interne notater for rapporten |
| Rapportvalideringer | Kontroll før levering. Viser «Nødvendige» og «Advarsler» med lenke til der feilen er. |
| Send e-post | E-post fra IVIT (ikke testet) |
| Rapportutkast | Generer og last ned PDF / send per e-post / påminnelse / PDF og tekstfil til megler / energimerke (gebyr) |
| Endelig rapport | **Koster penger – ikke trykket på** |
| Innstillinger | Eierform, oppdragstype, rapportoppsett, energimerking |
| Mer-meny (⋮) | Sett på vent, endre status til ferdig |

### Rapportvalidering – svak i IVIT

I testrapporten var de fleste kontrollpunkter tomme eller satt til TG1 under testingen. Valideringen fant likevel bare:
- **Nødvendige (3):**
  - markedsverdi ikke fylt ut
  - befaringsdato mangler
  - el-anlegget mangler beskrivelse eller avvik
- **Advarsler (3):**
  - forsidebilde mangler
  - ingen bygning er hovedbygg
  - **Taktekking har TG2, men mangler tiltak** (bare advarsel, ikke stopp)

**Muligheten for oss:** Valideringen bør følge forskriften og stoppe levering når:
- et obligatorisk rom eller en obligatorisk bygningsdel mangler TG eller begrunnelse
- TG2 eller TG3 mangler årsak eller konsekvens
- TG3 mangler kostnadsanslag
- hulltaking mangler
- areal mangler

Jf. `regelverk-krav.md` avsnitt 5. Spectora har en tilsvarende sperre («må være fullført før publisering»).

## 4. Rapporten som PDF (utkast, 14 sider)

1. **Forside:** adresse, kommune, gnr/bnr, markedsverdi, sum areal (BRA og BRA-i), befaringsdato, rapportdato, oppdragsnr., foretak og takstingeniør
2. **Om Byggcon:** firmapresentasjon og kontaktinfo til rapportansvarlig (Byggcons egen tekst)
3. **«Dette trenger du å vite om tilstandsrapporten»** (to sider):
   - hva en tilstandsrapport er
   - at vurderingen gjøres mot byggeregler på søknadstidspunktet
   - hva som ikke undersøkes
   - TG-forklaringer
   - **utbedringskostnader i fem intervaller: under 20 000 / 20–100 000 / 100–200 000 / 200–500 000 / over 500 000 kr, oppgitt for TG3**
4. **Beskrivelse av eiendommen og markedsvurdering**
5. **Sammendrag av boligens tilstand:** stolpediagram med antall per TG, og oppsummering av avvik per bygning
6. **Tilstandsrapport per bygning:** utvendig, innvendig, våtrom og kjøkken per etasje og rom, tekniske installasjoner og tomteforhold
7. **Bygninger på eiendommen** (garasje osv.), **konklusjon og markedsvurdering** (formål, BRA, markedsverdi, teknisk verdi)
8. **Beregninger**
9. **Arealer:** romfordeling per etasje og arealtype, og matrikkeldata (areal, kilde Ambita, eierforhold, hjemmelshaver)
10. **Forutsetninger**

**Merk:**
- Kostnadsintervallene står i «Dette trenger du å vite»-teksten. Det er trolig en felles bransjetekst, men ikke fra forskriften eller NS 3600. Kilden må avklares.
- Firmateksten sier «17 dyktige ansatte». Kunnskapsbasen sier 16 [03-folk-og-roller.md, 17.10.2026]. Ført i 99-apne-sporsmal.md.

## 5. Oppdragssiden

| Fane | Innhold |
|---|---|
| Oversikt | Adresse med BruksenhetsidentId og «Valider»-knapp (sjekk mot matrikkel), oppdrag (datoer, ref, mottatt av, notat, melding og fakturainfo fra megler), kunde (privat/bedrift), ansvarlig og medansvarlig, rekvirert av. Venstre side: forsidebilde, oppdragsnr., status, «Start ny rapport», kart, **Boligpass** (av/på) og **DIAKRIT** (av/på – visualisering/plantegning). Varsel om at obligatorisk ordrebekreftelse ikke er sendt. |
| Dokumenter | Tabell: kilde, sider, dokumentdato, status, kommentar, fra/internnotat, vedlagt i rapport |
| Notater | Dato og beskrivelse |
| Befaringer | «Legg til befaringer». Rapporten mangler befaringsdato til befaring er lagt inn. |
| Faktura / ordregrunnlag | Svea-avtale (betalingsløsninger), fakturakunde, fakturatype, betalingsfrist, «sett oppdrag til fakturert», fakturalinjer (dato, beskrivelse, enhet, fra–til, enhetspris, antall, rabatt, MVA, sum), fakturerbar ja/nei, ansvarlig, kommentar |
| Ordrebekreftelse | Forhåndsvisning, valg av fakturalinjer (ingen / usendte / sendte / alle), betalingsbetingelser |
| Bilder | Last opp eller hent fra bildearkiv |
| Dele oppdrag | Velg bruker(e) å dele med |
| Revisjoner | Versjon, gyldig fra, ny versjon, kommentar, last ned – **versjoner av levert rapport** |

## 6. Hovedmenyen

- **Ordre:** innkomne bestillinger (mottatt, konvertert til oppdrag, kansellert) med søk
- **Oppdrag:** liste med faner etter fase (forberedelser, befaringer, ferdigstilling, ferdige) og godkjenninger
- **Fakturaer:** filter på fakturastatus og periode, eksport til Excel
- **Arkiv:**
  - Filter på dato (befaring/opprettet), status, periode, rapporttype, eierskap og oppdragssteg. Filtre kan lagres.
  - Status: opprettet, påbegynt, under arbeid, på vent, fakturert, ferdig, lukket, kansellert.
  - Rapporttyper: tilstandsrapport, verditakst, takstrapport, verditakst tomt, fleksibel rapport, reklamasjonsrapport, landbruk, arealmålingsrapport, energirådgivningsrapport.
  - Eierskap: delt, medansvarlig, ansvarlig, i selskapet, på kontoret, tildelt selskapet, opprinnelig eier, partneroppdrag.
  - Kolonner: eierforhold, oppdragsnr., type, status, kunde, opprettet, adresse, ansvarlig, rapporttype, matrikkel, befaringsdato, fakturert.

### Oppdragssteg (hendelser) i IVIT – nyttig som statusmodell

Ordre mottatt → ordre sett → ordre tildelt kontor → (ordre avvist) → oppdrag startet → oppdrag tildelt → befaring planlagt → inspeksjonen startet → inspeksjonen avsluttet → utkast sendt til godkjenning → utkast akseptert / avvist → oppdrag oppdatert/endret → endelig rapport levert → faktura sendt → oppdrag godkjent → oppdrag stengt / gjenåpnet / kansellert / omplassert.

**For oss:** Disse hendelsene bør drive automatiske meldinger, slik Spectora gjør («når utkast er sendt → e-post til eier»). Se `spectora-analyse.md`.

## 7. Hva IVIT mangler (muligheter)

1. **Streng validering etter forskriften** før levering (se avsnitt 3).
2. **Automatisk TG fra materiale og alder** (se `kartlegging-kontrollpunkter.md`).
3. **Målefelt i stedet for ja/nei** for skjevhet, fall, terskel, antall ruter og rekkverk.
4. **Kundeportal** for eier og megler: egenerklæring, utkast og kommentarer, signering, visningslogg (Spectora).
5. **Automatiske meldinger** knyttet til oppdragsstegene (Spectora).
6. **Tekst går ikke tapt ved synkronisering.** IVIT advarer om det i hvert beskrivelsesfelt.
7. **CRM og statistikk** for megler og kunde (Spectora). IVIT har bare lister og Excel-eksport.

## 8. Funksjoner i IVIT vi bør ha med

- Kopier data fra tidligere rapport (valgfrie deler)
- Oppsummering per bygningsdel som henter tekst automatisk fra kontrollpunktene
- Fem kostnadsintervaller for TG3 (eller det Byggcon bestemmer)
- Rapportoppsett med eller uten markedsverdi og teknisk verdi
- Revisjoner av levert rapport, med gyldig-fra-dato
- Validering av adresse og bruksenhet mot matrikkelen
- Sammenlignbare salg og verdiassistent (krever avtale med Eiendomsverdi)
- Ordrebekreftelse (obligatorisk) generert fra fakturagrunnlaget
