# Funksjon: PDF-motor (ADR) og PDF-utkast av badet i Byggcons profil

- **Fase:** 2a-2 Hele veien først, punkt 4 («ADR: valg av PDF-motor, og PDF-en av badet i Byggcons profil, i ferdig kvalitet»)
- **Modul:** kjerne, ny `src/core/pdf` (motoren bak eget grensesnitt, profilene, oppsettet). Leser rapporten gjennom `src/core/reports` (ny lesefunksjon `getReportPdfData`). Knapp og rute under `src/app/(ansatt)/oppdrag/[id]/`.
- **Branch:** `pdf-motor-badet` (bygger på `main`, 50fad3e)
- **Status:** utkast (prosjektleder 18.11.2026)
- **Dato:** 18.11.2026
- **Støtter hovedmål:**
  - **Færre reklamasjoner:** PDF-en er det kunden og megleren leser. Den viser hvert avvik med TG, årsak, konsekvens, tiltak og kostnad på samme måte hver gang, TGIU med begrunnelse, og forklaringen av TG. Ingen interne koder eller tomme sider som kan misforstås. Takstmannen kan se nøyaktig hva leseren får, før publisering.
  - **De ansatte:** ett trykk på «Lag PDF (utkast)» gir rapporten slik den blir, uten å vente på publisering og uten å fylle opp arkivet (utkast lagres ikke).
  - **KI i bunnen:** rapportdataene samles i én strukturert modell med faste koder (`ReportPdfData`). Den samme modellen blir grunnlaget for KI-sammendrag og KI-sjekk før publisering i 2a-3, så KI og PDF alltid ser de samme dataene.

## Problem
Badet kan fylles ut på PC (PR #224), men det finnes ingen PDF. Uten PDF kan ikke «hele veien» i 2a-2 fullføres, Ståle kan ikke se og godkjenne utseendet, og valget av PDF-motor er ikke tatt. Velges motoren feil, må alt som bygges i 2a-3 (full rapport, 50 bilder, flere profiler, liggende) bygges om. Derfor ADR først, så PDF-en av badet.

## KI i bunnen
- **KI lager aldri PDF-en og endrer aldri tekst i den.** PDF-en er en ren gjengivelse av lagrede data: samme data og samme profil gir samme fil. Ingen KI-kall i `src/core/pdf`; statisk test viser at modulen ikke importerer `src/core/ai`.
- **Strukturerte data fra første dag:** `getReportPdfData` lager `ReportPdfData` med faste koder (punkt, utfall, TG, kostnadstype, TGIU-grunn) ved siden av teksten som vises. Persondata (adresse, matrikkel, navn) ligger i en egen del (`cover`), slik at en KI-funksjon i 2a-3 kan få resten gjennom vasken i `src/core/ai` uten å røre forsiden.
- **KI-tekst som ikke er godtatt:** PDF-en viser bare tekst som er lagret i rapporten. Forslag som venter i `ai_usage_log`, kommer aldri med. Hvordan godtatt KI-tekst merkes før publisering, avgjøres i «KI i veien» og «Publisering av badet» (andre brancher); denne oppgaven rører ikke det.
- **Måling:** hvert utkast gir hendelsen `report.draft_pdf_created` (rapport-id, profilkode, antall sider, antall bilder, millisekunder). Ingen persondata. Viser hvor ofte utkast brukes, og hvor lang tid motoren tar.

## Brukerhistorier
- Som **takstmann** vil jeg **trykke «Lag PDF (utkast)» på badet og få PDF-en slik kunden får den** slik at **jeg ser feil før rapporten går ut**.
- Som **leder** vil jeg **at PDF-en alltid har bunntekst med riktig juridisk selskap** slik at **rapporten er riktig overfor kunden og forsikringen**.
- Som **Ståle** vil jeg **at samme rapport kan få ulik layout og farger senere** slik at **vi kan tilpasse PDF-en til en kunde eller et segment** (Ståle 16.11.2026; bygges i 2a-3, men motoren velges for det nå).

## Omfang
**Med:**
1. **ADR 0016 «PDF-motor»** (`docs/adr/0016-pdf-motor.md`; 0015 er tatt av `publisering-badet`). Sammenligner minst tre motorer mot kravene i en tabell:
   - Chromium/Playwright med HTML og CSS for utskrift (Paged Media),
   - Typst (som Node-pakke med ferdigbygd motor, uten egen tjeneste),
   - et rent JS-bibliotek (for eksempel pdfmake eller react-pdf).
   Kravene: stående og liggende i samme dokument, flere profiler fra samme data, bilder med markering som eget lag, innholdsfortegnelse med sidetall, norsk orddeling for bokmål, samme fil hver gang (fast dato, faste skrifter, ingen tilfeldige id-er), kjører i Azure-testmiljøet (App Service B1 Linux, zip-utrulling, 1,75 GB minne) uten tjenester som koster ekstra, tid og minne med 50 bilder (anslag nå, måling i 2a-3), sikkerhet (rapportdata kan aldri bli kode i malen), lisens, og ny avhengighet begrunnet etter regel 9. Arkitekten **prøver** orddeling og fast resultat med et lite skript før valget, og skriver resultatet i ADR-en. ADR-en sier også hvordan det rulles ut (det som må med i `deploy-azure.yml` og `start.sh`, om noe).
2. **Grensesnittet** i `src/core/pdf`: `renderReportPdf(data: ReportPdfData, profile: PdfProfile, options: { draft: boolean }): Promise<Uint8Array>`. Motoren ligger bak grensesnittet i én fil, slik at den kan byttes. Rapportdata går inn som data (JSON), aldri limt inn i malteksten.
3. **Profilene som kodedata:** `PdfProfile` (kode, navn, stående/liggende, farger, skrifter, logo, forsideoppsett, rekkefølge på delene, bunntekst-mal). `byggcon_standard` (stående) er standard. En andre profil finnes bare i testene (liggende, andre farger) og viser at samme data gir en annen PDF. Tabellen `report_profiles` og valg av profil i skjermene kommer med «Flere PDF-utgaver» i 2a-3.
4. **`getReportPdfData(grant, reportId)`** i `src/core/reports`: leser rapporten, badet, kontrollpunktene, avvikene med tiltak, TGIU og selskapet med `grant.organizationId` i alle ledd og `deleted_at is null`. Etiketter i stedet for koder (fra den låste malversjonen og oversettelsesfilen).
5. **PDF-en av badet i Byggcons profil:**
   - **Forside:** «Tilstandsrapport», adresse og matrikkel, oppdragsnummer, befaringsdato, selskapets logo og navn. Ingen bilder på forsiden før forsidebilde finnes (2a-3).
   - **Innholdsfortegnelse** med sidetall (kort nå, viser at motoren kan det).
   - **Forklaring av TG** (TG0–TG3 og TGIU) med egne formuleringer, merket «utkast, ikke godkjent av fagrådet» i dataene (regel 7).
   - **Badet:** romnavn og etasje, hvert kontrollpunkt med TG og beskrivelse, avvik med TG, avvikstekst, årsak, konsekvens, tiltak og kostnad (intervall eller eget beløp i kroner), TGIU med hvorfor, risiko og hva som må til. Punkter uten innhold og deler uten innhold tas ikke med og gir aldri egne sider.
   - **Bilder med markering når den finnes:** oppsettet tar imot bilder (visningskopi uten GPS, bildetekst, markering som vektorlag over bildet). Badet har ingen bilder i databasen før «Bilder på PC» (2a-3), så i denne oppgaven prøves bildedelen med oppdiktede bilder og markering i testene. Bilder med EXIF eller GPS avvises før de går inn i motoren.
   - **Bunntekst på hver side:** juridisk selskap (navn og organisasjonsnummer fra `companies`), oppdragsnummer og «side x av y».
   - **Utkast:** «UTKAST» som vannmerke på hver side og i tittelen i PDF-ens egenskaper. Lagres ikke, verken i filer eller database (Ståle 16.11.2026).
6. **Knapp «Lag PDF (utkast)»** på badet og på oppdraget (PC). Åpner PDF-en i ny fane fra en rute (`GET`) som svarer med `application/pdf`, `Cache-Control: no-store` og filnavn uten persondata (`utkast-<oppdragsnummer>.pdf`). Tydelig melding ved feil («PDF-en kunne ikke lages. Prøv igjen.»), sperret uten nett med forklaring.
7. **Tilgang** via `src/core/access`: samme som å se badet (`organization.read`), reklamasjonssaker bare leder og admin (regel 12). Fremmed eller slettet rapport gir 404.
8. **Logging** uten persondata: feil i motoren logges med rapport-id og feilkode, aldri tekst fra rapporten.
9. Ordlisten (`docs/05-domenemodell.md` avsnitt 8): PDF-profil (`PdfProfile`), rapportdata for PDF (`ReportPdfData`), PDF-utkast (`draft`). Domenemodellen 4.3 får en merknad om at profilene er kodedata til 2a-3.
10. `package.json` versjon 0.18.0 (ny modul).

**Ikke med (bevisst utelatt):**
- Lagring av endelig PDF, versjonslogg og sletting bare av admin (2a-3, «Endelig rapport lagres som ferdig PDF»). `report_pdf` i filmodulen brukes ikke.
- Tabellen `report_profiles`, admin-skjerm for profiler og valg av profil på avtale eller oppdrag (2a-3, «Flere PDF-utgaver»).
- Hele rapporten (om Byggcon, sammendrag, arealer, dokumentasjon, forutsetninger, signatur) (2a-3, «PDF med Byggcons profil»).
- Testutskriften med 50 bilder og kravet om under 8 MB (2a-3).
- Bildetabellen `photos`, opplasting og markering på skjermen (2a-3, «Bilder på PC»).
- Publiseringssperren (branch `publisering-badet`) og KI i veien (branch `ki-i-veien`). Ingen filer der røres.
- PDF på iPad uten nett (2b).
- Sending av PDF på e-post.

## Tilgang
| Rolle | Se (lage utkast) | Endre |
|---|---|---|
| takstmann | Ja (`organization.read`), ikke reklamasjonssaker | – (PDF endrer ingenting) |
| kontor | Ja (`organization.read`), ikke reklamasjonssaker | – |
| leder | Ja, også reklamasjonssaker | – |
| admin | Ja, alltid (regel 11) | – |

## Data
- **Ingen migrering.** Ingen nye tabeller eller kolonner.
- Ny hendelsestype `report.draft_pdf_created` i `src/core/events/types.ts` (og testen som teller typene).
- Faste koder: profilkoden `byggcon_standard` (regel 6: endres aldri, arkiveres), delkodene `cover`, `toc`, `tg_explanation`, `room`.
- Ny avhengighet: motoren som ADR-en velger, begrunnet i PR-en (regel 9). Skriftene i `public/fonts` brukes (OFL).

## Skjermer
- **PC, badet** (`/oppdrag/[id]/rom/[roomId]`): knappen «Lag PDF (utkast)» i toppen ved siden av fremdriften. Ett trykk, PDF i ny fane.
- **PC, oppdraget** (`/oppdrag/[id]`): samme knapp der rapporten vises, når rapporten finnes.
- Mens PDF-en lages: knappen viser «Lager PDF …» og er sperret; tilgjengelig navn og status for skjermleser.
- **PDF-en:** universell utforming så langt motoren gir det (tagget PDF om motoren støtter det, språk satt til `nb`, tittel, lesbar kontrast etter Byggcon-profilen, TG vises både med tekst og farge).
- iPad: knappen vises også i iPad-størrelse på PC-skjermen (e2e), men PDF uten nett er 2b.

## Regler
Ingen nye fagregler. Rene funksjoner med tester:
- Tomme deler og punkter tas ikke med (ingen side uten innhold).
- Eget kostnadsbeløp vises som kroner med mellomrom som tusenskille; intervall som «kr 10 000–50 000».
- Ingen fast kode (`key`, `tg2`, `wet_room.*`) i teksten i PDF-en.

## Akseptkriterier
- [ ] ADR 0016 sammenligner minst tre motorer mot alle kravene, viser prøven av orddeling og fast resultat, og velger én, med begrunnelse for ny avhengighet og hva som trengs i Azure (ingen tjeneste som koster ekstra).
- [ ] `renderReportPdf` er eneste vei til motoren; modulen importerer ikke `src/core/ai` (statisk test).
- [ ] Samme data og profil to ganger gir like byte (eller lik struktur når motoren ikke kan gi like byte, begrunnet i ADR-en) (test).
- [ ] Testprofil (liggende, andre farger) gir en annen PDF fra samme data (test).
- [ ] PDF-en av badet fra et testoppdrag har forside, innholdsfortegnelse, TG-forklaring, kontrollpunkter, avvik med TG, årsak, konsekvens, tiltak og kostnad, TGIU, og bunntekst med juridisk selskap på hver side (strukturtest som leser teksten i PDF-en).
- [ ] Bilder med markering kommer med i riktig rekkefølge med bildetekst; bilde med GPS eller EXIF avvises (test med oppdiktede bilder).
- [ ] «UTKAST» står på hver side, og ingenting lagres i filer eller database (test).
- [ ] Ingen interne koder i teksten (test som søker etter kodemønstre).
- [ ] Tomme deler gir ingen egne sider (test med rapport uten avvik og uten TGIU).
- [ ] Norsk orddeling virker for bokmål (test med langt ord i smal kolonne, eller prøven i ADR-en hvis motoren ikke kan testes for det direkte).
- [ ] Rapportdata kan ikke bli kode i malen (test med tekst som ligner malsyntaks og HTML).
- [ ] Bruker i annen organisasjon får 404 (test, `expectTenantIsolation` for `getReportPdfData`).
- [ ] Takstmann og kontor får ikke PDF av reklamasjonssak; leder og admin får (test).
- [ ] Knappen virker på PC og i iPad-størrelse, gir PDF i ny fane, og axe finner ingen feil (e2e).
- [ ] Feil i motoren gir tydelig melding og logg uten persondata (test).
- [ ] Bygget rulles ut i testmiljøet uten nye Azure-ressurser (`deploy-azure.yml` oppdatert om nødvendig, og `start.sh` om oppsettet endres).
- [ ] KI-forslag: ingen i denne oppgaven; PDF-en viser bare lagret tekst, aldri ventende forslag (test).

## Beslutninger (autonom modus, føres i `docs/09-apne-sporsmal.md`)
- **A480** Profilene er kodedata i `src/core/pdf` til «Flere PDF-utgaver» i 2a-3; da kommer `report_profiles`. Lett å endre.
- **A481** Utkast-PDF krever `organization.read` (samme som å se badet), reklamasjonssaker bare leder og admin. Lett å endre.
- **A482** Bildedelen prøves med oppdiktede bilder i testene til `photos` finnes (2a-3); markering tegnes som vektorlag over visningskopien, ikke som eget ferdig bilde. Lett å endre.
- **A483** TG-forklaringen i PDF-en er egen tekst, merket «utkast, ikke godkjent av fagrådet». Lett å endre (tekst som data).
- **A484** Valg av PDF-motor (ADR 0016). Dyrt å endre: alle PDF-oppsett i 2a-3 bygges på den.
- **A485** Filnavnet på utkastet har bare oppdragsnummeret, ingen adresse (persondata i nettleserhistorikk og nedlastinger). Lett å endre.

## Roller
- **arkitekt:** ADR 0016 med prøven, grensesnittet og utrullingen i Azure.
- **utvikler** (to i parallell etter ADR-en): (a) `src/core/pdf` med motor, profil og oppsett; (b) `getReportPdfData`, ruten, knappene og hendelsen.
- **testskriver** (parallelt med utviklerne): struktur- og snapshottester, tilgang og tenant-isolasjon, e2e.
- **ui-designer:** oppsettet av PDF-en i Byggcon-profilen (forside, avvikskort, TG-farger, bunntekst).
- **fagansvarlig:** TG-forklaringen og rekkefølgen av avviksfeltene mot forskriften.
- **sikkerhet-personvern:** malinjeksjon, GPS og EXIF, filnavn, logging og tilgang.
- **ki-ansvarlig:** at `ReportPdfData` kan brukes av KI i 2a-3 uten persondata, og at ventende forslag aldri kommer med.

## Åpne spørsmål
- Ingen til Ståle nå. Utseendet ser Ståle når 2a-2 er ferdig («Ståle har sett den»).
