# EzProp – endringslogg for planen

Nyeste øverst i listen. Tabellen under er den eldre loggen (25.–28.10.2026 og 09.11.2026).

- **14.11.2026 (Ståle i chat, PR #212):** Forbedreren erstatter forenkleren, og det forbedreren foreslår, bygges uten å spørre Ståle. Større tillegg blir punkter under «Fra forbedreren» i gjeldende fase. Alle tillegg føres i `docs/plan/forbedrerens-tillegg.md`.
- **12.11.2026 (Branch `fase2a-regler-bad`, PR #167):** 2a-2: «Reglene badet trenger» krysset av (regelmotoren i `src/core/rules`, fire regler med testsaker i badmalen, levetider og fuktgrense som utkast, A224–A232). Statuslinjen for 2a oppdatert.
- **12.11.2026 (Branch `fase2a-regler-bad`, funn T-0003):** Planlinjen for «Reglene badet trenger» (2a-2) presisert etter Ståles svar 10.11.2026 (59a): er det tatt hull og målt uten forhøyet fukt, gir alderen alene ikke TG2 på tilliggende konstruksjoner; hulltaking ikke utført gir TGIU (A224).
- **12.11.2026 (Prosjektlederen, funn T-0021):** «Beslutningsnotat om KI-leverandør» flyttet til `docs/plan/levert.md` (PR #154). Radene fra 11.–12.11.2026 flyttet fra tabellen hit, så nyeste står øverst. Planen sier «Sist oppdatert: 12.11.2026».
- **12.11.2026 (Læringsløkken):** «Malen for ett bad» flyttet til `docs/plan/levert.md` (PR #159 merget). Statuslinjen for 2a: neste er reglene badet trenger.
- **12.11.2026 (Branch `fase2a-mal-bad`):** 2a-2: «Malen for ett bad» krysset av (systemmalen med ett våtrom i malmotoren, tekster som utkast, A200–A213).
- **12.11.2026 (Beslutningsnotatet og Anthropic-adapteren, branch `fase2a-ki-leverandor`):** Statuslinjen for fase 2a: alle punktene i 2a-1 er levert; neste er 2a-2 Smal vei.
- **12.11.2026 (Utrullingen 12.11.2026):** S1 gjort: første vellykkede utrulling til Azure (PR #149–#152: databaseregion, brannmurkommando, appens logg ved feil og flate pakker).
- **11.11.2026 (Ståle 10.11.2026, Anthropic valgt):** 2a-1: «Beslutningsnotat om KI-leverandør» krysset av (notatet `docs/beslutningsnotat-ki-leverandor.md`, Anthropic-adapteren bygget). Nytt punkt i «Minimum før ekte data» om KI-leverandør (avtale, EU/EØS-vei, spørsmål 54–58 og 73); telleren er nå to av ti. S8 viser hva som gjenstår for Ståle.
- **11.11.2026 (Kontroll av arbeidsflyten «Utrulling til Azure»):** S1 satt tilbake til åpen: utrullingen til Azure hopper fortsatt over fordi `AZURE_CLIENT_ID` mangler.
- **11.11.2026 (Hovedløkken etter PR #143):** Statuslinjen for fase 2a: KI-køen (PR #143) levert, neste er «Beslutningsnotat om KI-leverandør».
- **11.11.2026 (Prosjektlederen):** Det alvorlige funnet T-0001 (synkkøen) er rettet i PR #139. Statuslinjen for 2a oppdatert. Neste: «Evalueringssett» (2a-1).
- **11.11.2026 (Prosjektlederen):** Små rettinger i ADR 0006 del 11 og domenemodellen etter «Vask før KI» (PR #137).
- **11.11.2026 (Læringsløkken):** «Forslagsmønsteret» (PR #131) og «Vask før KI» (PR #135) flyttet fra planen til `docs/plan/levert.md`. Radene fra 10.11.2026 er flyttet fra tabellen hit, så nyeste står øverst (funn T-0021).
- **10.11.2026 (Prosjektlederen):** «Forslagsmønsteret» (2a-1) levert som PR #131 (påbegynt av en kjøring som stanset uten PR, fullført og åpnet av hovedløkken). Flyttes til `docs/plan/levert.md` av læringsløkken.
- **10.11.2026 (Læringsløkken):** «KI-modulen og loggen» (2a-1) levert som PR #127 og flyttet til `docs/plan/levert.md`.
- **10.11.2026 (Prosjektlederen):** Fagsvarene ført inn som spørsmål 59 i `docs/09-apne-sporsmal.md` og i punktene «Reglene badet trenger» (2a-2) og systemmalen (2a-3).
- **10.11.2026 (Ståle i chat):** Svar på de tre fagspørsmålene: TG0 når det ikke er målt fukt, uansett alder; radon bare som HMS; brann og sikkerhet er punkter uansett bygningstype. S3 er helt gjort. KI-leverandør Anthropic er bekreftet, og Ståle har API-nøkkel (S8).
- **10.11.2026 (Ståle i chat):** S1 (testmiljøet), S2 (prøvene på ekte iPad og ADR 0004) og S3 (fagråd runde 1) er gjort. KI-leverandør er Anthropic (S8 delvis). Fase 1 er ferdig. «Minimum før ekte data» kan bygges i testmiljøet.
- **10.11.2026 (Læringsløkken):** Malmotoren (2a-3) merget som PR #119 og flyttet til `docs/plan/levert.md`. Statuslinjen for 2a oppdatert.
- **10.11.2026 (Læringsløkken):** «ADR: KI i bunnen» (2a-1) merget som PR #123 og flyttet til `docs/plan/levert.md`.
- **10.11.2026 (Ståle i chat):** Nytt hovedmål: best mulig system for de ansatte, KI først, og KI i bunnen. 50 % mindre tid er ikke lenger hovedmål. Planen er ryddet til ett levende dokument: levert arbeid er flyttet til `docs/plan/levert.md`, sporbarheten til `docs/plan/sporbarhet.md` og loggen hit. «De første oppgavene» og «Åpne spørsmål om planen» er tatt ut (utført eller besvart). Fase 2a starter nå med KI-grunnmuren og en smal vei (ett våtrom fra kontrollpunkt til PDF). KI-funksjonene er flyttet fra «Senere» inn i fasene. Fase 3 er delt i 3a (piloten) og 3b (kontoret). Outlook-kobling én vei først; mørk visning og morgen-e-post er flyttet til «Senere». Svarene fra 10.11.2026 (`docs/kartlegging/svar-claude-pa-vegne-av-stale-2026-11-10.md`) og forslagene nr. 41–53 er ført inn i fasene. Nytt testlag (løkke G, `docs/11-agentlaget.md`). Henvisningene «(se også Spectora-YouTube V…)» er tatt ut av punktene; de står i sporbarheten.

- **28.10.2026 (Ståle i chat, senere):** ingen grense for antall PR-er som venter på Ståle. Løkken stopper ikke lenger ved tre.
- **28.10.2026 (Ståle i chat):** «Testmiljø i Azure» lagt inn som første punkt i fase 1 (samme miljø som Optiplan). Fase 0b: felles innlogging **og felles profil** for admin og ansatte med Optiplan, kundene adskilt, og bytte mellom løsningene med ett trykk. Samspillet mellom EzProp og Optiplan skal komme «etter hvert», ut over innloggingen.

| Dato | Hva er endret | Fra innspill |
|---|---|---|
| 25.10.2026 | Første utkast | – |
| 25.10.2026 (etter innspill) | Ny rekkefølge 0a → 1 → 0b → 2a → 2b, skrevet ut øverst og i fasene | P10 |
| 〃 | Ny liste «Minimum før ekte data» før fase 2 (EU/EØS med HTTPS, sikkerhetskopi med prøvd gjenoppretting, databehandleravtaler, bare ansatte, intern personvernerklæring, sletteregel for betadata, sperring av iPader) | P1, P6 |
| 〃 | Fase 2 delt i 2a «Rapporten på PC» og 2b «Befaringen på iPad», med «ferdig når». Fagrådets godkjenning lagt inn i 2a. | P2 |
| 〃 | Nytt avsnitt «Ved siden av fase 0 og 1»: Fagråd – runde 1, måling i IVIT, eAccounting-prøve. Nye oppgaver 11–13. | P3, P4, P7 |
| 〃 | ADR for PDF-motor og PDF under 8 MB i fase 2a | P5, P8 |
| 〃 | Oppsett og sperring av iPadene i fase 2b | P6 |
| 〃 | «Send»-knapp i 2a, automatisk sending per selskap i fase 3 | P9 |
| 〃 | Fire testoppdrag som grunndata i 2a | P11 |
| 〃 | Nøkkelboks og sperre etter mange feil ved innlogging i fase 0b | P12 |
| 〃 | Én felles PDF-layout for egne maler i fase 5 | P13 |
| 〃 | Listen «omveier til IVIT» startes i 2b | P14 |
| 〃 | «Ståle avgjør innen demoen» i hver fase | P15 |
| 〃 | Fase 3: kalender og kapasitet med Outlook begge veier, prisliste per avtale, enkelt lederdashbord, hjelp koblet til kunnskapsbasen, bestillingsskjema for meglere, varsler som arbeidsliste, oppgaver på mobil og daglig oppsummering. Fase 3 delt med underoverskrifter. | H1, H2, H3, H7, H8, H11, H12 |
| 〃 | Fase 4: meglerprofil med tall, reklamasjonsmappe og intern avviksregistrering med registrering av reklamasjoner | H4, H6, S1 |
| 〃 | Sertifisering med utløpsdato i fase 0b | H5 |
| 〃 | Ny fase 4b «Kundesiden» (nettrapport, selgerportal, meglerstatus, gyldighetsside med QR), merket «forslag – Ståle avgjør» | H9 |
| 〃 | Verditakst som systemmal nr. 2 i «Senere», med merknad | H10 |
| 〃 | KI trinn 1: evalueringssett og kostnadsmåling. KI-prioriteringen etter produksjon i «Senere». «Glemt noe?» i 2b. | `funksjonalitet-ki` 9, 10, K4 |
| 〃 | Oppslag i Optiplan og én kundebase i fase 4 | O1, O3 |
| 〃 | Nytt avsnitt «Strekkmål (moonshots)» med de fem strekkmålene og krokene som er lagt inn | `moonshots` 6 og 7 |
| 〃 | Sporbarhet: gamle funn fordelt på 0a/0b/2a/2b, noen flyttet etter innspill, nye tabeller for P1–P15, H1–H12, KI-krokene og S1–S6, og ny telling | – |
| 〃 | Mål, pilotmåling, risikotabell og åpne spørsmål oppdatert (spørsmål 1, 3 og 4 tatt inn, tre nye) | – |
| 27.10.2026 | Ståles svar på de 28 samlede spørsmålene og tre bekreftelser ført inn (`svar-fra-stale-2026-10-27.md`) | – |
| 〃 | Fagrådet er Ståle alene fram til produksjon. Beta og tidsmåling i IVIT er bare Ståle. Flere takstmenn velges før piloten. | Spørsmål 3 og 27 |
| 〃 | Ettårs-oppfølging, samspill med Optiplan (O1, O3) og samme-dag-rapport tatt ut som mål og strekkmål. Felles innlogging beholdes. | Spørsmål 21, 23 og 24 |
| 〃 | Fullt CRM flyttet fra «Senere» til fase 4, rett etter adresseboka (meglerprofil med tall) | Spørsmål 20 |
| 〃 | Fase 4b godkjent (etter produksjon, før malbyggeren) | Spørsmål 19 |
| 〃 | Ny oppgave ved siden av fase 0 og 1 (oppgave 14): undersøke API-ene til Enova og Polycam. Tilkoblingen i «Senere». | Spørsmål 22 |
| 〃 | Kalibrering etter betaen, Intune senere | Spørsmål 9 og 16 |
| 〃 | Spørreundersøkelse i EzProp, rutiner som admin og hver takstmann kan lage og justere, rettet rapport sendes manuelt | Spørsmål 14 |
| 〃 | Fire statuser, reklamasjoner fra første ekte rapport, eget kostnadsbeløp med advarsel, gyldig til fra befaringsdato, sidemann bare advarsel, egne maler uten TG-logikk | Spørsmål 1, 4, 5, 7, 8, 13 |
| 〃 | Rapporttyper: alle maler inn etter hvert. Verdidel ikke krav for produksjon («de færreste tilstandsrapportene har verdi»), og leilighetsrapporter med markedsverdi lages i IVIT til verdidel finnes | Spørsmål 18 og tillegg |
| 〃 | Forslag (ikke vedtatt) fra leilighetsanalysen: nye advarsler i sjekken før publisering og PDF-profil i 2a, verdidel i «Senere» | `analyse-ivit-leilighetsrapport-2026-10-27.md` avsnitt 6 |
| 〃 | Åpne spørsmål om planen: de besvarte er fjernet, tre gjenstår. Sporbarhetstellingen oppdatert. | – |
| 〃 | Merket «Rettet» under «Ferdig» og reklamasjonssaker bare for leder og admin (fase 2a) | Tilleggsbeslutninger 27.10.2026 |
| 28.10.2026 | Hovedmål øverst (50 % mindre tid, halvparten så mange reklamasjoner, KI først), med måling og tabell over hva som bidrar mest per fase. Nye oppgaver 15 og 16 (nullpunkt for tid og reklamasjoner) ved siden av fase 0 og 1. Tidsmåling per rapport i 2a. Pilotmåling med de to tallmålene. KI-funksjoner i «Senere» merket «vurder å flytte fram». To nye åpne spørsmål. | Ståle i chat 28.10.2026 |
| 09.11.2026 | Funnene fra Spectoras YouTube-kanal (V1–V132) knyttet til planen: henvisning på 61 punkter, ny underseksjon under «Sporbarhet», nye funksjoner som forslag og kapittel 7 som spørsmål i `docs/09-apne-sporsmal.md` (nr. 20–53). Ingen punkter er lagt til eller utvidet. | `spectora-youtube/spectora-youtube-funn.md` |
| 12.11.2026 | Microsoft-innlogging for ansatte flyttet fra «Senere» til fase 2a og prioritert før 2a-2, med engangskoden som reserve. | Ståle i chat 12.11.2026 |
| 12.11.2026 | Ny oppgave i fase 2a: Byggcon-profilen (samme grep som Optiplan), etter Microsoft-innlogging og før 2a-2. Grunnlaget kopiert til `docs/design/byggcon-profil/`. | Ståle i chat 12.11.2026 |
| 12.11.2026 | Svarene fra Ståle 12.11.2026 ført inn: ny del «Fra Ståles svar 12.11.2026» i 2a (reglene og bygningene, rette ordre, søk, dublettvarsel, flere rom, oppbevaring som innstilling), KI-forslag til rom fra plantegning i 2a-3, DPIA-utkast i «Minimum før ekte data», tall om KI-bruk per ansatt i 3b, og merknad om tofaktor i fase 4. Tak på KI-bruk (forslag 64) bygges ikke. | `docs/kartlegging/svar-fra-stale-2026-11-12.md` |
| 12.11.2026 | Fase 2b: «diktat til ferdig funn» er nå live mens takstmannen snakker, fordelt på rom, bygningsdel og felt med godkjente fraser, automatisk rombytte, retting med stemmen, og TG bare når takstmannen sier den selv. | Ståle i chat 12.11.2026 |
| 12.11.2026 | Nytt strekkmål 6: KI-briller med en KI-assistent på befaringen. Live diktat i fase 2b bygges slik at inngangen kan byttes. Ingenting bygges for brillene nå. | Ståle i chat 12.11.2026 |
| 12.11.2026 | Live diktat skjer i det vanlige befaringsbildet (ingen egen dikteringsskjerm). Strekkmål 6: Ståle sier personvern er ok som retning; lovpålagte rutiner lages før bruk. | Ståle i chat 12.11.2026 |
| 12.11.2026 | Byggcon-profilen levert (PR #176) og flyttet til `docs/plan/levert.md`. | Hovedløkken |
| 12.11.2026 | Microsoft-innlogging levert (PR #166) og flyttet til `docs/plan/levert.md`. | Hovedløkken |
| 12.11.2026 | «Minimum før ekte data»: DPIA-punktet (K3) har fått en linje om verdier i revisjonsloggen ved endring av ordre (spørsmål 79, A252). | Prosjektleder, forhåndsvurdering av T1 |
| 13.11.2026 | «Rette en ordre etter at den er lagret» (T1) krysset av under «Fra Ståles svar 12.11.2026», bygget på branch `rette-ordre` (`docs/funksjoner/fase2a-rette-ordre.md`, A249–A254). | Utvikler, rette-ordre |
| 13.11.2026 | «Minimum før ekte data»: nytt punkt om at HTTP-loggen i Azure slås av eller tømmes for adresser med søketekst før ekte data (A263, søk T2). Telleren er nå to av tolv. | Utvikler, sok-ordre-arbeidsko |
| 13.11.2026 | Nytt punkt i fase 3a: «Spør EzProp», spørsmål på vanlig norsk som blir søk med tilgangssjekk og kilder, uten persondata til KI. | Ståle i chat 13.11.2026 |
| 13.11.2026 | Prinsipp: full kvalitet, ingen midlertidige løsninger. Regnearket for systemmalen er erstattet av en full mal- og regeleditor i fase 2a-3 (flyttet fra fase 5), med regelbygger for alle felt, tekst lagt inn automatisk av regler, og ytelseskrav på under 50 ms. | Ståle i chat 13.11.2026 |
| 13.11.2026 | Fase 2b: video overalt der bilder kan legges til, og video som er huket av for leseren vises som QR-kode med kommentar i PDF-en. | Ståle i chat 13.11.2026 |
| 13.11.2026 | Prinsipp: produksjonsklar fra første linje. «Minimum før ekte data» heter nå «Klar for drift» og har fått produksjonsmiljø, overvåking, sikkerhetsgjennomgang, lasttest og driftsrutiner. «Smal vei» heter «Hele veien først». Ord som «enkel» og «første versjon» er tatt bort fra punktene. | Ståle i chat 13.11.2026 |
| 13.11.2026 | Nytt prioritert punkt: rike testdata i testmiljøet (selskaper, ansatte, meglere, eiendommer, oppdrag i alle statuser, rapporter og bilder), aldri i produksjon. Testmiljø og produksjon holdes adskilt. | Ståle i chat 13.11.2026 |
| 13.11.2026 | «Søk i ordrelisten og i arbeidskøen» (T2) levert (PR #190) og flyttet til `docs/plan/levert.md`. | Hovedløkken |
| 13.11.2026 | «Flere rom på én gang med færrest mulig trykk» (T4) krysset av under «Fra Ståles svar 12.11.2026», bygget på branch `flere-rom-samtidig` (`docs/funksjoner/fase2a-flere-rom.md`, A280–A284). | Utvikler, flere-rom-samtidig |
| 13.11.2026 | «Flere rom på én gang» (T4) levert (PR #194) og flyttet til `docs/plan/levert.md`. | Hovedløkken |
| 13.11.2026 | «Testdata som ligner en ekte arbeidshverdag» delt i to (A300): del 1 (ansatte, kontakter, eiendommer, oppdrag i alle statuser, reklamasjoner, produksjonsvakt og utrulling) krysset av; del 2 (bilder, funn, TG, målinger og byggeår) flyttet til 2a-2 «Badet på PC». Ny liten oppgave: produksjonsvakt også på `pnpm db:seed:testoppdrag`. | Utvikler, testdata-arbeidshverdag |
| 13.11.2026 | «Oppbevaringstid for avviste KI-forslag som innstilling» (K7) krysset av under «Fra Ståles svar 12.11.2026», levert som PR fra branch `ki-oppbevaring-avviste` (`docs/agenter/oppgaver/ki-oppbevaring-avviste.md`, A272–A275). | Utvikler |
| 13.11.2026 | «Varsel om mulig dublett» (T3) krysset av under «Fra Ståles svar 12.11.2026», bygget på branch `varsel-dublett` (`docs/funksjoner/fase2a-varsel-dublett.md`, A285–A291). Varsel for kontakter og firma er ikke med (forslag 62, A289). | Prosjektlederen, varsel-dublett |
| 13.11.2026 | «Varsel om mulig dublett» (T3) levert (PR #198) og flyttet til `docs/plan/levert.md`. | Hovedløkken |
| 13.11.2026 | Rett på oppdrag: «Nytt oppdrag» er hovedveien, «Ordre» blir «Tilbud» (lead som gjøres om til oppdrag med ett trykk), lenger ned i menyen. Tilbud med pris og PDF i 3b. E-post-KI og bestillingsskjema lager oppdrag, ikke ordre. | Ståle i chat 13.11.2026 |
| 14.11.2026 | Gjenopprettet live diktat (fase 2b) og strekkmål 6 (KI-briller), som PR #174 skrev over ved en feil (testlagets funn T-0052). | Ståles beslutninger 12.11.2026 |
| 14.11.2026 | Frasebanken fylles fra Byggcons fraser i SharePoint, både fra IVIT-malene og Byggcons egne, i én felles bank (flyttet fra fase 4 til 2a-3). S10: rett til IVIT-malfrasene. | Ståle i chat 13.11.2026 |
| 14.11.2026 | S10 gjort: Ståle bekrefter at avtalen med IVIT tillater at Byggcon tar med seg frasene fra IVIT-malene. | Ståle i chat 14.11.2026 |
| 14.11.2026 | Raskere utvikling: tre oppgaver samtidig i hovedløkken, og lett prosess for små oppgaver i arbeidsflyten `oppgave`. | Ståle i chat 14.11.2026 |
