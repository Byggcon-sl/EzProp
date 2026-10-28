# Svar fra Ståle 24.10.2026

Sist oppdatert: 24.10.2026
Kilde: Ståle svarte i Word-filen «EzProp – åpne spørsmål 24.10» (32 spørsmål).
Ubesvart: 1, 3 og 6 (avvikstekster), og 29 og 30 (påminnelser).

## A. Avvikstekster

| Nr | Spørsmål | Svar | Betydning for EzProp |
|---|---|---|---|
| 1 | Lengde | *Ikke besvart* | Venter |
| 2 | NS-henvisning i teksten | Skal ligge i bakgrunnen, ikke stå i rapporten | Kilden (f.eks. NS 3600 tabell C.4) lagres som felt på teksten og regelen, men skrives ikke i rapporten. Prøveeksemplene må skrives om. |
| 3 | «bør» for TG2, «må/snarest» for TG3 | *Ikke besvart* | Venter |
| 4 | Flere tiltak | Ja, det kan være flere tiltak per avvik | Takstmannen kan velge flere tiltak |
| 5 | Kostnadstekst | Som regel bare ett anslag. Premisseteksten i rapporten forklarer at det er et overslag og ikke et tilbud, basert på det man visste på befaringsdagen. Det må være mulig å legge til kostnadstekst i enkelte tilfeller. | Fast forklaring i premissene. Kostnadsteksten per avvik er valgfri, ikke standard. |
| 6 | Varianter for materiale og måling | *Ikke besvart* | Venter |
| 7 | Ordvalg | Ikke «antas», «antar», «antagelig» eller lignende ord som gjetter på tilstanden. Skriv om det vi ser. Er noe usikkert eller ukjent, skal vi skrive det, hvorfor, og hvilken risiko det gir. | Språkregel for alle tekster, og en regel i den automatiske språkkontrollen: gjetteord gir varsel |

## B. Design

| Nr | Spørsmål | Svar |
|---|---|---|
| 8 | Skjulte hurtigtaster på PC | Ja, god idé |
| 9 | Mangler før levering vist som et lite merke | Ja |
| 10 | Ingen kompakt visning nå | Ja |

## C. Maler og fraser

| Nr | Spørsmål | Svar | Betydning |
|---|---|---|---|
| 11 | Hvem eier malen | Åpent til å begynne med. Kompetansen sitter hos de ansatte og skal deles. Vi snevrer inn senere hvis det endres mye og kvaliteten ikke er god nok. | Alle takstmenn kan endre fellesmalen. Endringslogg (hvem, hva, når) og mulighet for å gå tilbake er nødvendig, så det kan strammes inn senere. |
| 12 | Godkjenning av malendringer | Nei, endringer gjøres uten samtykke | Ingen godkjenningsflyt i første versjon. Rollen «godkjenner» kan slås på senere. |
| 13 | IVITs 507 fraser | Ja, hent ut alt fra IVIT. Det er overordnet språk som går igjen uansett system. | Claude henter ut frasene fra IVIT (admin.ivit.no) når Ståle sier fra. Frasene vaskes for gjetteord. |
| 14 | Fremtind-avtalen | Lite spesielt i innholdet. Vil likevel fra start kunne sette opp egne regler, maler eller endringer for bestemte kunder og grupper. Eksempler: annet utseende på rapporten for Fremtind, liggende A4 for Privatmegleren. Kan vurderes tatt ut hvis det blir for avansert. | Tilpasninger per kunde og avtale omfatter også **rapportdesign** (oppsett, liggende/stående), ikke bare innhold |

## D. Levering, faktura og automatiske rutiner

| Nr | Spørsmål | Svar | Betydning |
|---|---|---|---|
| 15 | Meglersystemer | «Alle 3». API-ene er ikke undersøkt ennå. | Hvilke tre systemer det gjelder, må bekreftes. Claude kan undersøke API-ene. |
| 16 | Vedlegg eller lenke | Rapporten sendes som vedlagt PDF | Rapporten sendes som ekte vedlegg (der Spectora bare sender lenke) |
| 17 | Faktura | Som regel megler, av og til selger eller en representant for selger. Mottaker velges fritt ved fakturering. Fakturaen sendes etter aktiv kontroll av opplysningene, ved at noen trykker selv. Fakturarutinene varierer, og dette kan kanskje automatiseres senere. | Ingen automatisk faktura i første versjon. Knappen «Lag faktura» viser et utkast med fritt valgt mottaker, og fakturaen sendes ved godkjenning. |
| 18 | Første automatiske rutiner | Se listen under | – |
| 19 | SMS | E-post holder. Kanskje som en innstilling for admin eller en avansert funksjon. | SMS-tilkobling kommer senere, som et valg |

**De første automatiske rutinene (Ståles liste):**
1. Velkomst-e-post til selger når befaringen er booket, med informasjon om befaringen og spørsmål til selger.
2. Tidspunktet for befaringen sendes til megler når den er booket.
3. Påminnelse om befaringen dagen før.
4. Rapport til kunde, med fast tekst.
5. Rapport til megler.
6. Spørreundersøkelse til selger.

## E. KI

| Nr | Spørsmål | Svar | Betydning |
|---|---|---|---|
| 20 | Grunnregel | Ja. KI lager utkast, takstmannen godkjenner, og KI setter aldri TG og sender ingenting selv. | – |
| 21 | Rekkefølge | Ja. Men kontrollen skal ikke være for streng: en KI-vurdering skal ikke stoppe publisering. Takstingeniøren skal kunne overstyre med en advarsel. | **Kontroller stopper aldri publisering.** De gir advarsel, og takstmannen kan publisere likevel (det logges). Dette gjelder også mangler som oppdages av faste regler. Unntaket er det forskriften krever, se under. |
| 22 | Krav til KI-leverandør | Ja | Databehandleravtale, lagring i EU/EØS og ingen trening på våre data |
| 23 | Drøfting med de ansatte | Ståle tar det | – |

**Merk til nr. 21 (Claude):** Noen få ting er krav i forskriften, for eksempel at TG3 har kostnadsanslag og at TG2/TG3 har årsak, konsekvens og tiltak. Claude foreslår at bare disse stopper publisering, og at alt annet gir advarsel. Ståle må bekrefte dette.

## F. Leverandører og folk

| Nr | Spørsmål | Svar | Betydning |
|---|---|---|---|
| 24 | Eiendomsverdi og PropCloud | Ståle kontakter dem. Føres opp som fremtidig utvikling. | Ikke i første versjon |
| 25 | Hvem mangler på ansattlisten | Ståle vil se listen | Listen er sendt Ståle 24.10.2026 |
| 26 | iPad | Alle bruker iPad Pro med wifi og 5G. Det kan likevel være kjellere og grisgrendte strøk uten dekning. | Test på iPad Pro. Uten nett skal det fungere, men det er unntaket, ikke normalen. |

## G. Neste steg

| Nr | Spørsmål | Svar | Betydning |
|---|---|---|---|
| 27 | Sette opp repo og plan nå | Vent. Kartleggingen er ikke ferdig. | Kartleggingen fortsetter |
| 28 | Testdata i Spectora | Beholdes. Det er bare en testbruker. | – |
| 29 | Slå av Spectora Advanced | *Ikke besvart* | Påminnelse står fortsatt i LES-MEG |
| 30 | Bytte passord og mer testing | *Ikke besvart* | – |
