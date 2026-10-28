# Grunnmur: samarbeid og flere selskaper

Sist oppdatert: 25.10.2026 (oppdatert etter Ståles svar og sidemannskontrollen)
Første versjon: 23.10.2026
Status: Forslag fra Claude, rettet etter beslutningene i `LES-MEG.md`. Beslutningene i LES-MEG går foran.

## Beslutning

[Kilde: Ståle, 23.10.2026, presisert 25.10.2026]

1. **EzProp bygges fra bunnen for samarbeid**, ikke for én og én takstmann. IVIT er bygget rundt den enkelte takstmannen, og leverandøren har selv innrømmet at det er en designfeil.
2. **Løsningen skal fra start håndtere** flere selskaper, mange ansatte, deling av oppdrag og deling av fraser på tvers av selskapene i Byggcon.
3. **Byggcon har tre juridiske selskaper**, men jobber i praksis som ett. Systemet må støtte begge deler.
4. **Intern bruk først** (25.10.2026). EzProp skal brukes internt i Byggcon. Salg til andre takstfirma legges lenger bak. Alle data får likevel organisasjons-ID, men ingen salgsfunksjoner bygges nå.
5. **Full selskapsstruktur fra start** (25.10.2026): organisasjon → selskap → ansatte er med i betaen. Det viktigste er at datamodellen er riktig fra start.

Selskapsstruktur [01-om-byggcon.md]: Byggcon AS (mor) eier Byggcon Nord AS, Byggcon Helgeland AS og Byggcon Troms AS.

## 1. Oppbygging: hvem eier hva

```
Organisasjon (i dag bare «Byggcon-gruppen»)
 ├─ Selskaper (juridiske enheter: Byggcon Nord AS, Helgeland AS, Troms AS)
 │    org.nr, MVA, egen eAccounting-klient, logo og rapportprofil, ansvarsforsikring
 ├─ Kontorer / team (Bodø, Mo i Rana, Mosjøen, Narvik, Tromsø – på tvers av selskapene)
 └─ Personer (én innlogging, ansatt i ett selskap)
      sertifisering hører til personen
```

- **Organisasjon** er den ytterste grensen for data. Alle data har organisasjons-ID, og alle spørringer filtreres på den. I dag finnes bare én organisasjon (Byggcon). Det gjør det mulig å legge til andre senere uten ombygging.
- **Selskap** er den juridiske enheten. Hvert oppdrag har ett **utstedende selskap**, som står som foretak på rapporten, fakturerer og har ansvaret. **Utstedende selskap er der ansvarlig takstmann er ansatt.** Ansvarsforsikringen hører til selskapet.
- **Kontor/team** er praktiske grupper på tvers av selskapene, brukt til fordeling, kalender og statistikk.
- **Person:** Én innlogging (felles med Optiplan). **Hver person er ansatt i ett selskap.** Personen kan likevel jobbe på oppdrag for de andre selskapene i gruppen (se oppdragsteam). Sertifiseringen hører til personen.

## 2. Samarbeid på oppdrag – kjernen

| Funksjon | Hva det betyr i praksis |
|---|---|
| **Oppdragsteam** | Hvert oppdrag har roller: ansvarlig takstmann (signerer), medansvarlig, befaringstakstmann, sidemann, kontor/saksbehandler. Hver rolle kan fylles av noen fra et annet selskap i gruppen. |
| **Felles oppdragskø** | Nye oppdrag havner i en kø per kontor eller område. Ledige takstmenn kan ta dem, eller kontoret fordeler. Kapasitet og kalender vises for alle. |
| **Overlevering** | Et oppdrag kan flyttes mellom takstmenn og selskaper (sykdom, ferie, kapasitet) med full historikk. |
| **Flere i samme rapport** | Se «Drift uten nett i tre nivåer» under. Endringer lagres per felt og kontrollpunkt. Den som sist endret et punkt vises, og det varsles ved konflikt. |
| **Fordeling av arbeid** | Kontrollpunkter eller bygninger fordeles mellom personer, for eksempel at én tar bad og teknisk og en annen tar utvendig. |
| **Kommentarer og @nevning** | Diskusjon per kontrollpunkt: «Hva tenker du om TG her?». Varsel til den som nevnes. |
| **Sidemannskontroll som flyt** | Rapporten sendes til kollega i samme eller annet selskap. Kommentarer per punkt, ny runde, godkjenning med navn og tid. Statistikk over funn (kobles til `byggcon:sidemannskontroll`). **Kravet om sidemannskontroll settes per ansatt** (for eksempel for en nyansatt som følges tett opp). Krav per rapport kan komme senere. |
| **Oppgaver** | «Hent tegninger», «purre egenerklæring», «ring megler», knyttet til oppdrag og person, med frist. |
| **Endringslogg** | Hvem gjorde hva og når, på oppdrag og i rapportteksten |

### Drift uten nett i tre nivåer (25.10.2026)

| Nivå | Krav |
|---|---|
| **Må virke** | Én takstmann gjør hele befaringen uten nett. Alt synkroniseres uten tap når nettet kommer. |
| **Bør virke** | Flere jobber i samme rapport **med** nett. |
| **Senere** | Flere jobber i samme rapport **uten** nett. |

## 3. Deling av kunnskap (fraser, maler, levetider)

Biblioteket har nivåer. Den som skriver, ser alle nivåene samlet:

| Nivå | Hvem eier | Eksempel |
|---|---|---|
| EzProp standard | Plattformen | Grunnsjekkliste etter forskriften, levetider fra NS 3600 tillegg C |
| Organisasjon | Byggcon fagråd | Byggcons fraser og avvikstekster, felles for alle tre selskaper |
| Selskap | Hvert selskap | Firmatekst, rapportprofil, eventuelt lokale tillegg |
| Team / kontor | Kontoret | Lokale forhold (f.eks. Helgeland, kyst og vind) |
| Person | Den enkelte | Egne fraser og favoritter |

Regler for endring (LES-MEG 24.10 og 25.10.2026):
- **Fraser er åpne for alle ansatte.** Alle endringer får endringslogg, og man kan gå tilbake til en tidligere tekst.
- **Kontrollpunkter, spørsmål og regler i systemmalene** kan bare endres av personer som har fått den retten. **Retten tildeles i admin-innstillingene.** Hver endring i strukturen blir en ny malversjon.
- **Godkjenningsflyt kommer senere.** Det betyr at en annen person må godkjenne en endring før den gjelder for alle.
- **Versjon per NS-utgave:** Befaringsdatoen avgjør hvilken versjon som brukes.
- **Deling på tvers av organisasjoner** venter (se avsnitt 7).

## 4. Deling av oppdrag på tvers

- **Innenfor organisasjonen:** fritt etter rolle. Alle i gruppen kan se og hjelpe til.
- **Med andre organisasjoner (partnere):** venter (se avsnitt 7).
- **Med kunder og meglere:** egne lenker eller portal med tilgang bare til «sitt» (se `anbefalte-funksjoner.md`).

## 5. Økonomi når selskapene jobber som ett

- Faktura går alltid fra det **utstedende selskapet** til riktig klient i eAccounting. **Hvert selskap har sin egen eAccounting-klient.**
- Fakturaen sendes manuelt etter kontroll, og mottaker velges fritt (LES-MEG 24.10.2026).
- **Internt oppgjør:** Når en takstmann fra Troms gjør en jobb for Nord, registreres timer og bidrag per person og selskap. Systemet lager grunnlag for internfakturering eller fordeling mellom selskapene.
- **Statistikk på alle nivåer:** konsern, selskap, kontor og person.

## 6. Tilgang, innlogging og sikkerhet

- **Innlogging:** samme løsning som Optiplan, med engangskode på e-post. Microsoft-innlogging og tofaktor kommer senere (LES-MEG 25.10.2026).
- **Roller per selskap og kontor:** takstmann, sidemann, kontor, fagansvarlig, leder, admin. Rettigheter som å publisere, endre systemmaler, se økonomi og se alle oppdrag.
- **Retten til å endre systemmaler** (kontrollpunkter, spørsmål og regler) gis til enkeltpersoner i admin-innstillingene.
- **Krav om sidemannskontroll** settes per ansatt i admin-innstillingene.
- **Hver spørring filtreres på organisasjon.** Det testes automatisk at ingen ser andre organisasjoners data. Samme regel som Optiplan.
- **Rapportens juridiske eier** er selskapet. Signaturen er ansvarlig takstmann.
- **Personvern:** Byggcon eier arbeidet, med Ståle som daglig leder (LES-MEG 25.10.2026). Hvis EzProp en gang selges, blir Byggcon databehandler for andre firmaer. Det krever databehandleravtale, data i EU/EØS, eksport og sletting.

## 7. Salg til andre takstfirma (venter)

Ingen av disse bygges nå (LES-MEG 25.10.2026). Organisasjons-ID på alle data gjør at de kan legges til senere:

- **Ny organisasjon** med egne selskaper, logo og rapportprofil (white label per selskap).
- **Abonnement og bruk per organisasjon:** antall brukere og rapporter.
- **Innstillinger per organisasjon:** maler, priser, meldinger og integrasjoner (egen eAccounting- eller Tripletex-klient osv.).
- **Plattformadmin** (Byggcon som leverandør) adskilt fra **Byggcon som kunde**.
- **Deling av bibliotek og oppdrag med andre organisasjoner.** Et firma kan dele et bibliotek med andre firmaer, eller dele et oppdrag med valgt tilgang (lese, skrive, sidemann).
- **Selvbetjent oppstart** for nye firmaer.

## 8. Forhold til Optiplan

- **Felles innlogging og personregister.** Samme person kan ha rolle i begge. EzProp og Optiplan har egne repoer.
- **Ulik «kunde»:** I Optiplan er kunden et borettslag eller sameie. I EzProp er organisasjonen i dag Byggcon, og borettslag og selgere er *kunder av* Byggcon.
- **Felles byggesteiner:** innlogging, roller, varsler, endringslogg, filer og PDF. Hver løsning har sine egne moduler.
- **Mulig senere:** Når en tilstandsrapport leveres til et borettslag som bruker Optiplan, kan den sendes direkte inn dit.

## 9. Hva dette betyr for planen

Etappene står i «Målgang» i `LES-MEG.md`: prøve uten nett på iPad → beta → pilot → produksjon → overgang fra IVIT.

- **Med i datamodellen fra start:** organisasjon → selskap → person (ansatt i ett selskap), oppdragsteam og bibliotek med nivåer. Det er dyrt å bygge om senere. Skjermbildene kan starte enkelt.
- **Med i betaen:** full selskapsstruktur. Betaen avgrenses på funksjoner, ikke på brukere.
- **Tidlig, når grunnmuren står:**
  - oppdragsteam
  - felles kø og overlevering
  - kommentarer
  - sidemannskontroll som flyt, med krav per ansatt
  - endringslogg
  - frasebank med nivåer, åpen for alle, med endringslogg
- **Senere:** godkjenningsflyt for fraser og maler, flere i samme rapport uten nett, krav om sidemannskontroll per rapport, Microsoft-innlogging og tofaktor, og alt i avsnitt 7.
- **Synkronisering:** Én takstmann uten nett må virke. Endringer lagres per felt og kontrollpunkt, ikke for hele rapporten. Det bestemmes i arkitekturen før bygging.

## Åpne spørsmål

- **Internt oppgjør:** Gjøres det i dag ved internfakturering, fordeling hos revisor, eller ikke i det hele tatt?

Besvart (står nå i teksten over):
- Selskap per oppdrag: utstedende selskap er der ansvarlig takstmann er ansatt (LES-MEG 23.10.2026).
- Ansatte i flere selskaper: nei, hver person er ansatt i ett selskap (LES-MEG 23.10.2026).
- Regnskap: hvert selskap har sin egen eAccounting-klient (LES-MEG 23.10.2026).
- Sertifisering: hører til personen. Ansvarsforsikring hører til selskapet (LES-MEG 23.10.2026).

## Endringslogg

| Dato | Endring | Kilde |
|---|---|---|
| 23.10.2026 | Første versjon | Ståle 23.10.2026 |
| 25.10.2026 | Tittel og beslutning: «klar for salg» erstattet med «intern bruk først». Organisasjons-ID beholdes, salgsfunksjoner venter (avsnitt 7). | LES-MEG 25.10.2026. Sidemannskontroll del 2, P45 |
| 25.10.2026 | Hver person er ansatt i ett selskap. Utstedende selskap, forsikring og sertifisering presisert. | LES-MEG 23.10.2026. Sidemannskontroll del 1, motsigelsestabellen |
| 25.10.2026 | Fraser åpne for alle. Retten til å endre systemmaler tildeles i admin. Godkjenningsflyt kommer senere. | LES-MEG 24.10 og 25.10.2026. Sidemannskontroll del 1 og del 2, P16 |
| 25.10.2026 | Flere i samme rapport uten nett flyttet til senere. Tre nivåer for drift uten nett. | LES-MEG 25.10.2026. Sidemannskontroll del 2, P20 |
| 25.10.2026 | Krav om sidemannskontroll settes per ansatt. | LES-MEG 25.10.2026 (svar nr. 17) |
| 25.10.2026 | Innlogging som i Optiplan (engangskode på e-post). Microsoft-innlogging og tofaktor senere. | LES-MEG 25.10.2026 (svar nr. 18) |
| 25.10.2026 | V1/V2 i avsnitt 9 erstattet med etappene fra «Målgang». Besvarte åpne spørsmål flyttet inn i teksten. | LES-MEG 25.10.2026 |
