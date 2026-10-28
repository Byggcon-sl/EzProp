# Anbefalte funksjoner – det beste fra IVIT og Spectora

Sist oppdatert: 25.10.2026 (prioriteringer rettet etter LES-MEG og sidemannskontrollen)
Første versjon: 23.10.2026
Status: Forslag fra Claude – til vurdering av Ståle. Beslutningene i `LES-MEG.md` går foran.
Grunnlag: kartleggingen av IVIT og Spectora i denne mappen (22.–23.10.2026), forskrift til avhendingslova og NS 3600:2025.

**Forutsetninger:**
- **Intern bruk først.** Løsningen er for Byggcons egne ansatte i Norge, men kunder og meglere skal også kunne få tilgang til sitt. Salg til andre takstfirma venter.
- **Forskriften** bestemmer hva som undersøkes. **NS 3600** brukes for TG-vilkårene.
- **IVIT** er mønsteret for rapportinnholdet. **Spectora** er mønsteret for drift, kundeflyt og smarte funksjoner.
- **To slags maler:** systemmaler som Byggcon lager og vedlikeholder (tilstandsrapporten først), og egne maler som de ansatte lager i en visuell malbygger.

**Prioritet** følger etappene i «Målgang» i `LES-MEG.md`:
- **Beta:** full selskapsstruktur og tilstandsrapport for bolig og leilighet, brukt ved siden av IVIT
- **Pilot:** flere takstmenn bruker EzProp
- **Produksjon:** det som må virke før Byggcon kan gå over fra IVIT
- **Senere:** når grunnmuren står

*Merk: Der LES-MEG sier «fra start» eller «tidlig», står det Beta. For resten er fordelingen Claudes forslag. Ståle avgjør endelig i utviklingsplanen.*

---

## 1. Oppdrag og bestilling

| Funksjon | Fra | Pri. |
|---|---|---|
| Nytt oppdrag i få steg. **Eier, byggeår og areal registreres for hånd i starten.** | IVIT | Beta |
| Henting av eiendomsdata fra Eiendomsverdi eller PropCloud | IVIT | Senere |
| **Bestilling fra meglersystem:** ordren er et eget objekt, men legges inn for hånd i starten | IVIT | Beta |
| Bestilling fra meglersystem via API | IVIT | Senere |
| Oppdraget er navet: personer med roller (oppdragsgiver/selger, megler, kjøper), dokumenter, notater, befaringer, rapporter, faktura og logg | Spectora | Beta |
| Oppdragstype og avtale (f.eks. Generell, Fremtind), rapporttype og oppsett (med eller uten markedsverdi og teknisk verdi). Per avtale: egen rapportprofil og premissetekst. Egne kontrollpunkter per avtale kommer senere. | IVIT | Beta |
| Statusflyt med faste steg: bestilt → tildelt → befaring planlagt → utkast → levert → fakturert → lukket | IVIT | Beta |
| Kalender med befaringer per takstmann, og daglig e-post med morgendagens oppdrag | Spectora | Senere |
| **Prismotor:** pris ut fra BRA, byggeår, avstand fra kontoret og tillegg (arealmåling, verdi-/lånetakst). Prisen vises fortløpende. | Spectora | Senere |
| Bestillingsskjema på nettsiden for selger eller megler, med egne felt (gnr/bnr, seksjon, egenerklæring mottatt) | Spectora | Senere |
| Kopiere et oppdrag, og kopiere data fra en tidligere rapport på samme bolig | Begge | Senere |

## 2. Befaring og sjekkliste (kjernen)

| Funksjon | Fra | Pri. |
|---|---|---|
| **App som virker uten nett** på iPad, med sikker synkronisering, så tekst aldri går tapt. Én takstmann uten nett **må** virke. | Spectora (bedre enn IVIT) | Beta (prøves først) |
| **Full selskapsstruktur:** organisasjon → selskap → ansatte, med organisasjons-ID på alle data | Byggcon | Beta |
| **Eierform og fellesdeler (leilighet):** boligtype og eierform (selveier, aksje, andel) styrer hvilke kontrollpunkter som vises. Ca. 60 % av rapportene er leiligheter. | IVIT | Beta |
| Bygninger, etasjer og rom med arealer (BRA-i/e/b, TBA). Bygninger registreres for hånd i starten. | IVIT | Beta |
| **Dynamisk sjekkliste:** romtypen gir egne punkter (våtrom, kjøkken, toalettrom, spesialrom), og materialvalg gir egne spørsmål | IVIT | Beta |
| Hvert punkt merket som *obligatorisk etter forskriften (§)* eller *frivillig* | IVIT | Beta |
| Avviksspørsmål med ferdig utfall (TG og tekst). Takstmannen velger TG2- eller TG3-variant der begge finnes. | IVIT | Beta |
| **Automatisk TG-forslag fra materiale og alder** (levetidene i NS 3600 tillegg C). Kilden lagres i regelen og vises ikke i rapportteksten. | Nytt – bedre enn begge | Beta |
| **Målefelt i stedet for ja/nei:** skjevhet (mm), fall, terskelhøyde, antall punkterte ruter, rekkverkshøyde og fukt. Systemet foreslår avvik. | Nytt | Beta |
| Hulltaking: målested, verdi, samtykke fra eier. Uten hull → TGIU med årsak og risikovurdering. Gjelder også når eier nekter hulltaking. | Nytt (forskriften § 2-2/2-15, NS 3600) | Beta |
| Punkter uten TG (el, brann, rekkverk, radon): bare beskrivelse og HMS | IVIT | Beta |
| Bilder med tegning og tekst på bildet. Fargen følger TG. Dimensjoneres for 15–50 bilder per rapport. | Spectora | Beta |
| **Stedsmerker** (etasje, rom, himmelretning) som hurtigvalg | Spectora | Senere |
| Huskelapper og flagg: «må fullføres på kontoret» | Spectora | Senere |
| Flere takstmenn i samme rapport **med** nett (bør virke) | Spectora | Pilot |
| Flere takstmenn i samme rapport **uten** nett | Spectora | Senere |
| Video og 360-bilder | Spectora | Senere |

## 3. Tekst, TG og kvalitet

| Funksjon | Fra | Pri. |
|---|---|---|
| **Byggcons egen frasebank** per kontrollpunkt og felt, med kildene Byggcon felles, egne og favoritter, og «mest brukt» øverst. **Fraser er åpne for alle ansatte**, med endringslogg og mulighet for å gå tilbake. | Begge | Beta |
| Lagre ny tekst fra rapporten til frasebanken | Spectora | Beta |
| Godkjenningsflyt for fraser (en annen person godkjenner før frasen blir felles) | Spectora + Byggcons fagråd | Senere |
| TG-regler: høyeste TG vinner. TG2/TG3 bare ved avvik. TG3 krever kostnadsanslag (fem intervaller, eller fritt beløp vist som «ca.»). | IVIT + forskriften | Beta |
| **Sperre ved publisering** for de 7 kravene fra forskriften: obligatorisk del uten TG, TG2/TG3 uten årsak og konsekvens, TG3 uten kostnad, våtrom eller rom under terreng uten hulltaking eller begrunnelse, BRA mangler, el-vurdering mangler, befaringsdato mangler. Den ansatte kan overstyre ved å krysse bort advarselen aktivt. Det logges, og mangelen kommer tilbake ved ny versjon. Andre mangler gir vanlig advarsel. | Spectora-prinsipp, strengere enn IVIT | Beta |
| **Sidemannskontroll i systemet:** sendes til kollega, kommentarer, godkjenning med navn og tid. Kravet settes per ansatt. | Spectora (godkjenningskø) + Byggcons rutine | Pilot |
| **Endringslogg** på oppdrag og rapportinnhold (hvem, når, hva) – viktig ved reklamasjoner | Spectora (bedre) | Beta |
| Sjekklister, levetider og tekster har versjon per utgave av NS 3600. Befaringsdatoen avgjør hvilken som gjelder. | Nytt | Beta |

## 4. Rapport og levering

| Funksjon | Fra | Pri. |
|---|---|---|
| PDF i Byggcons profil: forside, om Byggcon, forklaring av TG, sammendrag med TG-diagram, alle bygningsdeler, arealer, matrikkel og forutsetninger. Med **NS-utgave** og **oversikt over dokumentasjon**. | IVIT | Beta |
| **Levering til megler som vedlagt PDF** på e-post | IVIT | Beta |
| «Oppsummering bygningsdeler» som henter tekst fra kontrollpunktene | IVIT | Beta |
| Rapportutkast til eier før endelig rapport | IVIT | Senere |
| Revisjoner av levert rapport med gyldig-fra-dato. Hver utgave lagres låst i minst 10 år. Varsel når rapporten nærmer seg ett år. | IVIT + forskriften § 1-6 | Produksjon |
| **Nettrapport i portal** i tillegg til PDF, med TG2/TG3 først | Spectora | Senere |
| **Visningslogg:** hvem som åpnet rapporten, og når – dokumenterer levering | Spectora | Senere |
| Leveranse til megler via API (data eller tekstfil) | IVIT | Senere |
| Teknisk verdi og markedsverdi med sammenlignbare salg (Eiendomsverdi) | IVIT | Senere |
| Reinspeksjon: «utbedret siden forrige rapport» | Spectora | Senere |

## 5. Kunde, megler og kommunikasjon

| Funksjon | Fra | Pri. |
|---|---|---|
| **Hendelser og handlinger** («når X skjer → gjør Y») som kjernefunksjon | Spectora | Beta |
| **De seks første automatiske rutinene,** levert ferdige: velkomst-e-post til selger ved booking (med en del som kan fungere som ordrebekreftelse), befaringstidspunkt til megler, påminnelse dagen før, rapport til kunde, rapport til megler, og spørreundersøkelse til selger. E-post via Microsoft 365. | Spectora + Byggcon | Beta |
| SMS og flere ferdige forløp (påminnelse om egenerklæring, oppfølging etter 12 måneder) | Spectora | Senere |
| Maler for e-post med flettefelt, kø og varsel når levering feiler | Spectora | Beta |
| **Portal for selger:** signere oppdragsavtale (helst BankID), fylle ut egenerklæring, laste opp dokumenter (tegninger, FDV, ferdigattest), se utkast og kommentere, få faktura | Spectora (tilpasset) | Senere |
| **Lett CRM:** meglere, meglerforetak og kunder, med antall oppdrag, omsetning og notater | Spectora | Senere |

## 6. Faktura og økonomi

| Funksjon | Fra | Pri. |
|---|---|---|
| Fakturagrunnlag per oppdrag med linjer, MVA og rabatt → **fakturautkast i Visma eAccounting via API**, én klient per selskap. Fakturaen sendes manuelt etter kontroll, og mottaker velges fritt. | IVIT (grunnlag) + nytt | Produksjon |
| Automatisk faktura | Nytt | Senere |
| Oversikt over ubetalte, ufakturerte og usignerte oppdrag | Spectora | Senere |
| Rabattkoder og avtalepriser per oppdragsgiver | Spectora | Senere |

## 7. Styring og administrasjon

| Funksjon | Fra | Pri. |
|---|---|---|
| Roller og rettigheter: takstmann, sidemann, kontor, admin. Hvem kan publisere, endre systemmaler og se økonomi. Retten til å endre kontrollpunkter og regler tildeles personer i admin. | Spectora | Beta |
| **Felles innlogging med Optiplan** (engangskode på e-post), og en meny øverst for å bytte mellom løsningene. Microsoft-innlogging og tofaktor senere. | Byggcon | Beta |
| **Globalt søk** på oppdragsnummer, adresse og matrikkel | IVIT | Beta |
| **Arkiv med søk og filtre** (status, type, takstmann, periode), lagrede filtre og eksport til Excel | IVIT | Beta |
| Statistikk: oppdrag og omsetning per takstmann, kontor og megler, gjennomløpstid og andel TG3 | Spectora | Senere |
| **Systemmal for tilstandsrapport,** med regler, TG-logikk og versjoner, vedlikeholdt av Byggcon | Byggcon | Beta |
| Endring av systemmaler for personer med rett: kontrollpunkter, spørsmål, regler og levetider uten utvikler, med import og eksport til regneark | Spectora | Produksjon |
| **Visuell malbygger for egne maler:** tekstfelt, avkrysningsbokser, bildefelt og spørsmål med svar. Kommer etter at systemmalen for tilstandsrapport virker. | Byggcon | Etter systemmalen |
| Nattlig sikkerhetskopi | Spectora | Produksjon |
| Kjørebok-eksport og serviceområder per takstmann (Salten, Lofoten, Helgeland …) | Spectora | Senere |
| Åpent API | Spectora | Senere |

## 8. KI – der Byggcon kan bli best

**IVIT har KI** (KI-assistent og KI-konsistenssjekk) til 169 kr per rapport. Funksjonen er slått av hos Byggcon. [Kilde: `ivit-detaljer.md`, 24.10.2026]

| Funksjon | Fra | Pri. |
|---|---|---|
| **Fra stikkord eller tale til ferdig avvik:** KI foreslår årsak, konsekvens, tiltak og kostnadsintervall på norsk, bygget på Byggcons frasebank. KI setter aldri TG. Takstmannen godkjenner alltid. | Spectora-idé, gjort norsk | Senere |
| **Tale til tekst** med norsk fagordliste, koblet til riktig kontrollpunkt. Kjøpes som ferdig tjeneste. | Spectora (Match) | Senere |
| **KI-sidemannskontroll før levering:** tekst mot TG, motstrid med egenerklæringen, manglende bilder, uklart språk. Kobles til skillen `byggcon:sidemannskontroll`. | IVIT har en konsistenssjekk. Byggcon gjør den bedre. | Senere |
| Utkast til sammendrag for megler og kjøper | Nytt | Senere |
| Bildeanalyse: foreslår bygningsdel og varsler om manglende bilder ved TG2/TG3 | Nytt | Senere |

Krav til KI: KI lager utkast, takstmannen godkjenner. KI setter aldri TG og sender aldri noe selv. Databehandleravtale, data i EU/EØS og ingen trening på våre data. Mulig å slå av. Korte og saklige tekster.

## 9. Bevisst ikke med

- **Mersalg og håndverkertilbud til kjøper** (Spectora): kan svekke uavhengigheten (forskriften § 1-3).
- **Meglere som lead-kilde med provisjon** (amerikansk modell).
- **Reparasjonsliste for prutting:** bare en nøytral kostnadsoversikt, hvis i det hele tatt.
- **Kopiering av IVITs tekster:** Byggcon skriver egne avvikstekster.
- **Betaling i EzProp:** Byggcon fakturerer megler eller selger etter at rapporten er levert. Rapporten låses ikke bak betaling.

## 10. Forslag til rekkefølge

Etappene står i «Målgang» i `LES-MEG.md`.

0. **Research og plan** (nå).
1. **Prøve uten nett på iPad:** én takstmann, befaring uten nett, bilder og synkronisering.
2. **Beta** (ved siden av IVIT):
   - full selskapsstruktur og roller, felles innlogging med Optiplan
   - systemmal for tilstandsrapport, bolig og leilighet, med eierform og fellesdeler
   - app uten nett
   - dynamisk sjekkliste med TG-forslag fra alder og målinger
   - frasebank, åpen for alle, med endringslogg
   - sperre ved publisering for de 7 kravene, med overstyring og logg
   - PDF med NS-utgave og dokumentasjonsoversikt, levert til megler som vedlegg
   - hendelser og handlinger med de seks automatiske rutinene
   - manuell registrering av ordre og eiendomsdata
   - globalt søk og arkivfiltre
   - endringslogg
3. **Pilot:** flere takstmenn, sidemannskontroll i systemet, flere i samme rapport med nett.
4. **Produksjon:** faktura til eAccounting for alle tre selskapene, revisjoner og oppbevaring i minst 10 år, endring av systemmaler for personer med rett, sikkerhetskopi.
5. **Overgang fra IVIT.**
6. **Etter systemmalen:** visuell malbygger for egne maler.
7. **Senere:** API mot meglersystem, Eiendomsverdi og PropCloud, KI-funksjoner, selgerportal, CRM, statistikk, prismotor, kalender, utkast til eier, godkjenningsflyt, flere uten nett i samme rapport, verdi og markedsverdi.

**Avklaringer:**
- Eiendomsdata: **besvart** – manuell registrering i starten (LES-MEG 25.10.2026).
- Kostnadsintervaller: **besvart** – IVITs fem intervaller foreløpig, pluss fritt beløp vist som «ca.» (LES-MEG 23.10 og 25.10.2026).
- Levetider: **besvart** – NS 3600:2025 (LES-MEG 23.10.2026).
- NS 3600 utover TG-vilkårene: **delvis besvart** – NS-utgave og oversikt over dokumentasjon er med fra start. Kompetansebeskrivelse, utkast til eier, og lyd og støy kommer senere (LES-MEG 25.10.2026).
- API-nøkkel til eAccounting: **ikke avklart** (står i `99-apne-sporsmal.md`).

## Endringslogg

| Dato | Endring | Kilde |
|---|---|---|
| 23.10.2026 | Første versjon | Kartleggingen av IVIT og Spectora |
| 25.10.2026 | V1/V2 erstattet med etappene beta, pilot, produksjon og senere. Avsnitt 10 skrevet om etter etappene. | LES-MEG 25.10.2026 («Målgang») |
| 25.10.2026 | Full selskapsstruktur og eierform/fellesdeler (leilighet) lagt inn fra start. | LES-MEG 25.10.2026. Sidemannskontroll del 2, P5 |
| 25.10.2026 | De seks automatiske rutinene, hendelser og handlinger og levering som PDF flyttet til beta. Ordrebekreftelse erstattet av velkomst-e-post. | LES-MEG 24.10 og 25.10.2026. Sidemannskontroll del 1, motsigelsestabellen |
| 25.10.2026 | Bestilling fra meglersystem og eiendomsdata: manuelt først, API senere. | LES-MEG 25.10.2026. Sidemannskontroll del 1, nr. 4, og del 2, P37 |
| 25.10.2026 | To slags maler: systemmal for tilstandsrapport i beta, visuell malbygger etter systemmalen. Maleditor erstattet av rett til å endre systemmaler, tildelt i admin. | LES-MEG 25.10.2026 |
| 25.10.2026 | Lagt inn at IVIT har KI (169 kr per rapport, slått av hos Byggcon). KI-krav og tale til tekst som ferdig tjeneste. | `ivit-detaljer.md`. Sidemannskontroll del 1, motsigelsestabellen. LES-MEG 24.10 og 25.10.2026 |
| 25.10.2026 | Globalt søk og arkivfiltre lagt inn i beta. | LES-MEG 25.10.2026. Sidemannskontroll del 2, P41 |
| 25.10.2026 | Publiseringsregelen med de 7 kravene, hulltaking nektet gir TGIU, fraser åpne for alle, flere i samme rapport i tre nivåer, utkast til eier senere, ingen betaling i EzProp. | LES-MEG 24.10 og 25.10.2026 |
