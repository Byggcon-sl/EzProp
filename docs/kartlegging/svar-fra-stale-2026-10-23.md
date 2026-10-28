# Svar fra Ståle på åpne spørsmål – 23.10.2026

Sist oppdatert: 23.10.2026
Kilde: Ståle Limstrand, svar i Word-skjema 23.10.2026. Disse svarene er beslutninger og går foran det som står i de andre filene i mappen.

## A. Selskaper og samarbeid

| # | Spørsmål | Svar | Betydning for EzProp |
|---|---|---|---|
| 1 | Hvem bestemmer utstedende selskap? | Selskapet der takstmannen er ansatt | Utsteder settes automatisk fra **ansvarlig takstmanns ansettelse**. Bytter ansvarlig takstmann selskap, foreslås nytt utsteder. |
| 2 | Sertifisering og ansvarsforsikring | Sertifisering er personlig. Ansvarsforsikring er knyttet til selskapet. | Sertifisering registreres på **person** (område, gyldig til). Forsikring registreres på **selskap**. Bare sertifiserte personer kan stå som ansvarlig og signere. |
| 3 | Ansatt i flere selskaper? | Bare ansatt i ett selskap, men alle opptrer utad som «Byggcon» | Én ansettelse per person. Rapport og e-post kan vise merkevaren «Byggcon» med juridisk selskap i bunnteksten. |
| 4 | Internt oppgjør | Litt internfakturering for å flytte inntekter dit de hører hjemme | Grunnlag for internfaktura når noen fra et annet selskap bidrar på et oppdrag. Kommer senere. |
| 5 | Egen eAccounting-klient per selskap? | Ja | Faktura sendes til riktig klient ut fra utstedende selskap |
| 6 | Antall ansatte | 16 nå. Jørn Neverhei sluttet 30.09.2026. | Ført i kunnskapsbasen |

## B. Avtaler og integrasjoner

| # | Spørsmål | Svar | Betydning for EzProp |
|---|---|---|---|
| 7 | Avtale med Ambita? | Ikke ennå. Mulig vi kan finne åpne API-er for matrikkeldata og risikoopplysninger. | Undersøk Kartverket og Geonorge (adresse, matrikkel, bygninger), NVE (skred, flom, kvikkleire), NGU (radon) og støykart. Eier fra grunnboken krever trolig avtale. |
| 8 | Eiendomsverdi, Boligpass, DIAKRIT? | Eiendomsverdi kan bli aktuelt via API senere hvis bruken øker | Senere. Ikke i V1. |
| 9 | API-nøkkel til eAccounting | Opprettet, og vi har fått en sandbox | eAccounting-integrasjonen kan bygges og testes i sandboxen. Nøkkelen skal ligge i hemmelig konfigurasjon, aldri i kode eller dokumenter. |
| 10 | Brukes Svea? | Nei | Ikke med |
| 11 | Faste oppdragsgivere | Foreløpig bare Fremtind, men det kan endre seg. Avtalen kan knyttes til egne maler og egen utførelse. | **Avtale/oppdragsgiver som eget objekt**, med egne maler, sjekklister, priser og rutiner. Flere kan legges til uten utvikler. |

## C. Regelverk og fag

| # | Spørsmål | Svar | Betydning for EzProp |
|---|---|---|---|
| 12 | Kostnadsintervaller | Satt av IVITs faggruppe, men innarbeidet som en slags bransjestandard. Bruk dem foreløpig. Vi må også kunne sette **et fritt beløp** og en **forklarende tekst** til kostnadsintervallet, også knyttet til fraseregisteret. | Fem intervaller (under 20 000 / 20–100 000 / 100–200 000 / 200–500 000 / over 500 000). I tillegg et valgfritt fritt beløp og en kostnadstekst med fraser. Intervallene ligger i en tabell som kan endres. |
| 13 | NS 3600 utover TG-vilkårene | Vi forholder oss foreløpig til forskriften, og legger til flere funksjoner og sjekkpunkter etter hvert | V1 bygges etter forskriften. Andre NS-regler kan legges til senere som valgfrie regler. |
| 14 | Levetider | NS 3600 | Tabell C fra NS 3600:2025 brukes som den er |
| 15 | Radon | Nye NS 3600 | Tiltaksgrense 100 Bq/m³ |
| 16 | El-avvik med TG i våtrom | Hold oss mest mulig til nye NS 3600. IVIT kan ha utdaterte eller feil vurderinger. | El-forhold får ikke TG, men føres som el/HMS. **Generelt: ved uenighet mellom IVIT og NS 3600:2025 følger vi NS 3600.** |
| 17 | Egne avvikstekster? | Analyser IVITs tekster og skriv dem om, slik at det ikke blir plagiat, men behold meningen og forklaringen | Claude lager forslag til Byggcons egne avvikstekster med egne formuleringer, ut fra meningen i IVITs tekster og vilkårene i NS 3600. Fagrådet godkjenner før bruk. |
| 18 | SN-NSPEK 3477 / fast dataformat | Nei | Vi lager egen datamodell. Følg med på om Direktoratet for byggkvalitet krever et format. |
| 19 | Hva skjer ved «Ferdig rapport» i IVIT? | Ferdig rapport sendes til megler via API for bestillinger fra meglersystemene, ellers ingenting. Her kommer de avanserte innstillingene til nytte: vi kan knytte handlinger til hendelser og bygge våre egne rutiner, f.eks. «generer ferdig rapport» → send e-post til megler → vedlegg ferdig rapport. | **Hendelser og handlinger** (som Spectora Advanced) blir en kjernefunksjon. I tillegg kommer integrasjon mot meglersystemene (bestilling inn, rapport ut). |

## D. Produkt og navn

| # | Spørsmål | Svar | Betydning for EzProp |
|---|---|---|---|
| 20 | «EzProp Skade» på intranettet | Tidligere skisse, kan ses bort fra. EzProp skal bygges ut med mange rapporttyper og maler etter hvert. | Rapporttype og mal må være generelle fra start. Tilstandsrapport er bare den første. |
| 21 | Teste mer i Spectora? | Start prøveperioden for Advanced. Kostnader opp til $25 er godtatt. Spør før mer. | Claude tester Advanced innenfor $25. |

## E. Opprydding

| # | Spørsmål | Svar |
|---|---|---|
| 22 | Passord byttet? | Ikke ennå. Mer testing trengs først. |
| 23 | Testoppdrag [oppdragsnr fjernet] | Beholdes for videre testing |

## Nye åpne spørsmål

- Hvilke meglersystemer kommer bestillinger fra, og hvilke tar imot ferdig rapport via API?
- Hvilke åpne API-er dekker matrikkel- og risikodata godt nok? Claude undersøker.
