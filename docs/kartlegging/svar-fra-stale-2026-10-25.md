# Svar fra Ståle 25.10.2026 – etter sidemannskontrollen

Sist oppdatert: 25.10.2026
Kilde: Ståles svar i Word-filen «EzProp – spørsmål etter sidemannskontrollen 25.10» (31 spørsmål med Claudes anbefaling). Spørsmålene bygger på `sidemannskontroll-kartlegging-2026-10-25.md` (del 1) og `…-del2-programvare.md` (del 2).

## A. Fag og regelverk

| Nr | Tema | Ståles svar | Betydning for EzProp |
|---|---|---|---|
| 1 | Eier nekter hulltaking | **TGIU**, med risikovurdering og beskrivelse | Følger NS 3600. Rapporten skal vise hvorfor det ikke ble tatt hull, risikovurderingen og beskrivelsen. Frasene i IVIT som gir TG2, må rettes (frasearbeidet). |
| 2 | Hva som stopper publisering | De 7 kravene fra forskriften skal stoppe publisering. **Den ansatte kan overstyre ved å krysse bort advarselen aktivt.** Mangelen skal komme tilbake hvis det lages ny versjon uten at den er rettet. | De 7 kravene gir en «sperre som kan overstyres med vilje», med logg. Andre mangler gir vanlig advarsel. Overstyring gjelder bare én versjon. |
| 3 | Tillegg fra NS 3600 i rapporten | Ta med **hvilken utgave av standarden** vurderingen bygger på, og **oversikt over dokumentasjon**. Resten (kompetansebeskrivelse, utkast til eier, lyd og støy) kan komme senere. | To felt i første versjon: NS-utgave og dokumentasjonstabell. |
| 4 | Kildelinje ved TG2 på grunn av alder | **Nei.** Premisseteksten henviser til standarden, og det holder. | Ingen kildelinje under avviket. Kilden lagres i regelen (i bakgrunnen). *Merk:* sidemannskontrollen mener NS 3600 tillegg C.1 krever at kilden går fram. Byggcon har vurdert det og valgt premisseteksten. |
| 5 | Loft uten adkomst | Ja, unntak for nyere konstruksjoner, slik NS 3600 sier | Regelen får unntaket. |
| 6 | Fritt beløp ved TG3 | Ja, vises avrundet som «ca.» | – |
| 7 | Grenseverdier | Kan legges inn. Vi følger standarden for TG, men henviser ikke til det enkelte punktet i rapporten. | Grensene legges inn som regler, med kilde bare i bakgrunnen. |
| 8 | Spørre Standard Norge om bruk av NS 3600 | **Nei**, Byggcon har kjøpt standarden | Ingen henvendelse nå. |
| 9 | Oppbevaring | Ja, minst 10 år | Rapporter, bilder og måledata beholdes i låst versjon per utgave i minst 10 år. |
| 10 | Leiligheter | **Ca. 60 % av rapportene er leiligheter.** Eierform og fellesdeler må være med fra start. | Boligtype og eierform styrer kontrollpunktene fra første versjon. |

## B. Programmet

| Nr | Tema | Ståles svar | Betydning for EzProp |
|---|---|---|---|
| 11 | Hvor smal beta | Det skal lite til å gå fra én takstmann til full selskapsstruktur, så **vi gjør det fra start**. Det viktigste er at **datamodellen er riktig fra start**. | Beta har organisasjon → selskap → ansatte fra dag én. Betaen avgrenses på funksjoner, ikke på brukere. |
| 12 | Uten nett i tre nivåer | Ja | Én takstmann uten nett **må** virke. Flere i samme rapport med nett **bør** virke. Flere uten nett kommer senere. |
| 13 | Hvem kan endre maler og regler | Det skal kunne **tildeles via innstillinger for admin** | Rettigheten «kan endre kontrollpunkter og regler» gis til personer i admin. Fraser er åpne for alle. |
| 14 | Tilpasning per avtale | Ja | Første versjon: egen rapportprofil og premissetekst per avtale. Egne kontrollpunkter senere. |
| 15 | Bestilling fra meglersystem | Manuell registrering holder. API kan komme senere. | Ordre er eget objekt, men legges inn for hånd i starten. |
| 16 | Eiendomsdata | Manuell registrering holder i starten | – |
| 17 | Sidemannskontroll | Bestemmes manuelt i dag, f.eks. for en nyansatt som følges tett opp. Krav på enkeltrapporter kan vurderes senere. | Krav om sidemannskontroll settes per ansatt i første versjon. Krav per rapport noteres til senere. |
| 18 | Innlogging | Samme løsning som Optiplan nå (engangskode på e-post). Tofaktor og Microsoft-innlogging kan komme senere. | – |
| 19 | IVITs iPad-app | Befaringsbildet i iPad-appen er **helt likt** som i nettleseren. Ståle mener det er en dårlig løsning fordi skjermene er så forskjellige. | Kartleggingen fra nettleseren dekker iPad-appen. Bekrefter beslutningen om egen iPad-visning for befaring. |
| 20 | Bilder og volum | **15–50 bilder per rapport. Ca. 2000 rapporter per år.** | Rundt 30 000–100 000 bilder per år. Brukes til å beregne lagring, PDF og synkronisering. |
| 21 | Tale til tekst | Ferdig tjeneste. Vi utvikler ikke selv. | Leverandør med lagring i EU/EØS og databehandleravtale. |
| 22 | E-post | Samme løsning som Optiplan (Microsoft 365) | – |
| 23 | Ordrebekreftelse | Byggcon sender den ikke i dag. Selger skal i stedet få en **velkomst-e-post** med befaringstidspunkt, hva de kan forvente og forberede, og prosessen etterpå. En del av e-posten kan fungere som ordrebekreftelse. | Velkomst-e-posten er den første automatiske rutinen og har en del som kan brukes som ordrebekreftelse. |

## C. Data, personvern og organisering

| Nr | Tema | Ståles svar | Betydning for EzProp |
|---|---|---|---|
| 24 | Uttrekk av gamle data fra IVIT | Kan vente. Avtalen med IVIT holdes løpende en god stund. | Ikke en del av første versjon. |
| 25 | Personvern | **Byggcon eier arbeidet, med Ståle som daglig leder.** | Claude lager utkast til behandlingsgrunnlag, risikovurdering for KI og avtaler med leverandører. |
| 26 | Rapporttyper | For det meste **tilstandsrapport**. Systemet skal likevel være klart for enkel oppretting av maler: **en visuell malbygger** der man setter inn tekstfelt, avkrysningsbokser, bildefelt og spørsmål med svar, og lagrer som mal. Da kan de ansatte lage hundrevis av spesialtilpassede rapporter. | **Nytt stort krav:** en malbygger. Tilstandsrapporten blir én mal blant mange, med egne regler. Datamodellen må være generell fra start (felt og spørsmål som data). |
| 27 | Utvikling | Samme måte som Optiplan, i utgangspunktet | Claude-prosjekt, én oppgave per tråd, pull requests, og Ståle godkjenner. |
| 28 | EzProp og Optiplan | Egne repoer og felles innlogging. Er satt opp slik nå. | – |

## D. Dokumentene

| Nr | Tema | Ståles svar |
|---|---|---|
| 29 | Intern bruk først | Ja (alt ført inn 25.10.2026) |
| 30 | [Ståles testadresse] i dokumentene | Det er Ståles eget hus, og det går fint at det står |
| 31 | Designskissene som PDF i SharePoint | Ja. *Skissene ligger alt i `EzProp-kartlegging/design/` (bilder og HTML). Det er nok.* |
