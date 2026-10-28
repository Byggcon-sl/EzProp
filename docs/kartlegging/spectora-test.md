# Spectora – test i praksis (prøvekonto)

Sist oppdatert: 23.10.2026
Status: Utkast – ikke godkjent.
Kilde: Test i Ståles prøvekonto i Spectora (bare fiktive data, Ståles tillatelse 22.10.2026). Utført av en Claude-hjelpeagent natt til 23.10.2026. Hører sammen med `spectora-analyse.md` (gjennomgang av hjelpesenteret).

**Rettelse fra Claude:** Agenten skrev at forskriften har faste kostnadsintervaller. Det stemmer ikke. Forskriften § 2-22 krever bare et «sjablonmessig anslag» ved TG3. Teksten er rettet nedenfor.

**To ting er viktige å vite først:**
- **Spectora Advanced er låst.** Det gjelder avanserte automatiseringer, oppgaver, kontaktmerker, megleranalyse, avanserte tall og SMS-innboks. For å teste dem må prøveperioden for Advanced startes. Det er et tillegg på $4 per publiserte rapport, så det ble ikke gjort. Disse delene er beskrevet ut fra Spectoras egne funksjonssider, ikke testet.
- **Ingen e-post er sendt.** Prøvekontoen kan ikke sende e-post («This company cannot send emails»).

## (a) Moduler og navigasjon

Toppmenyen har: Dashboard, Templates (maler), Contacts, Metrics, Automations, Advanced, Settings og Support Center. Menyen kan tilpasses med dra-og-slipp. Ekstra punkter som kan legges inn er Inspections, Calendar, New Inspection, Payments, e-post- og SMS-kø, Team, Data, Reporting, Billing og Unconfirmed. Globalt søkefelt («Search everything») øverst.

- **Dashboard:** dagens oppdrag med kart og kjørerute, pågående oppdrag, kalender, ubekreftede oppdrag og utkast. Knapper for «New inspection» og «New quote».
- **Inspeksjonen er navet.** Alt henger på oppdraget: personer, tjenester, avtaler, betaling, rapporter, e-post og SMS, interne notater og endringslogg.
- **To rapportredigerere:** V10 (ny nettleser-app som virker uten nett) og V9 (den klassiske).
- **Kundeportal:** kunde og megler får hver sin lenke, uten innlogging.
- **Rapportvisning:** nettrapport, PDF, sammendrag og reparasjonsliste.

## (b) Område for område

### 1. Innstillinger
Én lang side med sammenleggbare seksjoner som lagrer automatisk.

**Grunnleggende:**
- Profil (logo, adresse, inspektørinfo, kompetanse, serviceområde).
- Tjenester og priser, tilgjengelighet, team, eksempelrapporter og rabattkoder.

**Forretningsverktøy:**
- **Avtaler:**
  - Signatur som avkrysning eller håndskrevet. Dato, tid og IP lagres.
  - Instrukstekst til kunden kan tilpasses.
- **Betaling:**
  - Betalingsinstruks med plassholder for saldo.
  - Varsel ved betaling og automatisk kvittering.
  - Fast tekst på faktura.
- **Anmeldelser:** egne stjerner 0–5 og lenke til for eksempel Google.
- **Intern kommunikasjon:** varsel når en e-post eller SMS ikke kommer fram.
- **E-post:**
  - Avsender (inspektør eller firma), blindkopi, egen topp- og bunntekst.
  - **Daglig e-post til hver inspektør** med timeplanen for de neste 48 timene.
- **SMS:** samtykke (transaksjon og markedsføring hver for seg). Eget nummer koster $20/mnd og gjelder bare noen land. Maks 480 tegn.
- **Tilbud:** tilbud lagres som utkast til oppdrag.
- **Kundeportal:**
  - Handlinger etter kansellering.
  - Feltene «closing date» og «periodeslutt» kan utløse automatiseringer.
  - Betaling kan tas først etter publisering.
- **Reparasjonsliste:** av/på, egen ansvarsfraskrivelse.

**Booking:**
- Et påbegynt bestillingsskjema låser kalenderen i 10 minutter.
- Areal og byggeår hentes automatisk fra offentlige data (USA).
- Liste over henvisningskilder.
- **Egendefinerte bestillingsfelt.**
- **Online booking:**
  - Kontaktinfo før eller etter datovalg.
  - Ingen bestilling innen X timer.
  - Skjule eller vise pris.
  - Manuell bekreftelse og egen bekreftelsestekst.
  - Varsel ved fullført eller avbrutt bestilling.
  - Kan bygges inn på nettsiden.
- **Prisvidget** («Get a quote») og **forespørselsskjema.**
- **Tilleggstjenester:** kunden kan be om dem i portalen, også etter publisering.

**Rapportvalg:**
- Inspektør per rapport (riktig signatur).
- 360-bilder.
- **Reinspeksjon.**
- **Krav om at alt er fullført før publisering.**
- **Kostnadsestimat.**
- Liste over fagfolk.
- **Stedsmerker:** tre grupper hurtigvalg, for eksempel etasje, himmelretning og rom.

**Firma:**
- **Integrasjoner:** Repair Pricer, HomeBinder, Google Drive (nattlig sikkerhetskopi av rapporter, fakturaer og avtaler), QuickBooks og flere.
- **Import:** fra ISN og andre maler.
- **Lokalisering:** metrisk/imperisk, valuta (NOK finnes **ikke**), tidssone og datoformat.

**Bruker:**
- Dashbord: standardvisning, arbeidsdag og startadresse.
- Kalenderkobling (iCal/Google).
- Tofaktorinnlogging og varselinnstillinger.

**Byggcon bør kopiere:**
- Én innstillingsside med søk og autolagring (høy)
- Daglig timeplan-e-post (middels)
- Stedsmerker per rom og etasje (høy)
- «Alt må være fullført før publisering», koblet til forskriftens minstekrav (høy)
- Egendefinerte bestillingsfelt som gnr/bnr, seksjon, borettslag og egenerklæring mottatt (høy)
- Automatisk henting av eiendomsdata fra matrikkel og Eiendomsverdi (høy)
- Norsk språk, NOK og 25 % MVA (høy)

### 2. Automatiseringer

**Grunnversjonen (testet):** 11 grupper:
- bestilling, ombooking, kansellering, avtaler og gebyrer
- før befaring for kunde, kundens megler og selgers megler
- publisering
- etter befaring for de samme tre rollene

Hver gruppe har av/på for e-post og SMS per mottaker. Tidspunktet settes som 1–30 timer, dager, uker eller måneder før eller etter befaring. Ved publisering kan man få varsel når kunden eller megleren åpner rapporten.

**E-postmaler:**
- Transaksjon eller markedsføring (markedsføring krever samtykke og avmeldingslenke).
- Ca. 45 plassholdere, for eksempel kundens navn, adresse, dato, lenke for å signere og betale, rapportlenke, rapport-PDF, sammendrag-PDF, portal-lenke, fakturalenke og meglerfelt.
- E-post- og SMS-køene vises i egne tabeller (planlagt og sendt).

**Testet:** påminnelse til kunde 2 dager før befaring slått på. Malene kunne ikke redigeres i prøvekontoen.

**Avansert (låst, ikke testet):**
- Utløsere: bestilt, bekreftet, fullført, betalt, publisert, kansellert, closing date.
- Handlinger: e-post, SMS eller webhook, med forsinkelse.
- Betingelser på tjeneste og kontaktmerker. Merker kan settes automatisk.

**Byggcon bør:**
- Lage en motor med utløser, betingelse, forsinkelse og handling (e-post, SMS, webhook, oppgave) (høy)
- Ha norske roller: oppdragsgiver/selger, megler, kjøper (høy)
- Ha køvisning og varsel ved feil levering (høy)
- Ha ferdige norske forløp (høy):
  - bestillingsbekreftelse med oppdragsavtale og signering
  - påminnelse om egenerklæring og dokumentasjon (tegninger, FDV, ferdigattest)
  - påminnelse dagen før befaring
  - «utkast klart» til eier
  - ved levering: rapport til megler
  - oppfølging etter 12 måneder

### 3. Tjenester, priser, rabatter, kalender og team

**Tjeneste (testet):**
- Felt: navn, kategori, beskrivelse, skjult i booking, mal(er), avtale(r), grunnpris og varighet.
- **Modifikatorer:** pris og/eller tid justeres etter **kvadratmeter**, alder, byggeår, postnummer eller avstand i km fra kontoret. Typen kan være intervall, per enhet, eller per enhet over en grense.
- **Tillegg:** med egen pris, tid, mal og avtale.
- **Avgifter i prosent** (MVA ble testet som 25 %).
- Bestillingsskjemaet viser prisoppbyggingen fortløpende: grunnpris, rabatt, MVA og tillegg.

**Rabattkoder:** prosent eller beløp, hvilke tjenester koden gjelder, maks antall bruk og utløpsdato.

**Tilgjengelighet:** åpne tidsvinduer eller faste tidsluker per inspektør og ukedag. Online booking finner ledig tid ut fra varigheten.

**Team:** rettigheter per person:
- booke seg selv eller alle
- endre og slette oppdrag
- publisere
- endre mal
- kontakter
- se økonomi
- admin

**Byggcon bør:**
- Lage en prismotor med BRA, byggeår, avstand fra kontoret og tillegg som arealmåling, verdi- og lånetakst og el-kontroll (høy)
- Beregne MVA per linje og sende faktura til Visma eAccounting via API (høy)
- Ha rettighetsmatrise (høy)
- Ha serviceområder per takstmann, for eksempel Salten, Lofoten og Helgeland (middels)
- Ha rabattkoder for meglerkampanjer (lav)

### 4. Maleditor
Tre kolonner: **seksjoner → punkter → kommentarer**. Kommentarene er delt i Information, Limitations og Deficiencies.

- **Svartyper:** avkrysning, flervalg og tall, med «Other» for fritekst.
- **Kommentarkort:**
  - standard avkrysset
  - anbefalt fagperson
  - standard sted
  - standardtekst og standardbilde
  - **«Edit using AI»**
  - endre navn, duplisere, flytte og slette
- **Malinnstillinger:**
  - topptekst for rapport og sammendrag
  - visningsvalg (telling, antall undersøkte punkter, signatur, kontrollnivå per seksjon)
  - PDF-valg (innholdsfortegnelse, avvik først, sammendrag med eller uten bilder)
- **Vurderinger:** egne vurderinger med navn, forkortelse og farge, vist som rutenett i rapporten.
- **Avvikskategorier:** 1–3 nivåer.
- **Verktøy:** sortere etter mest brukt, eksport/import til regneark, klone, dele og malbibliotek.

**Testet:** Malen ble klonet til «Byggcon TEST – Tilstandsrapport NS 3600», med vurderingene TG0, TG1, TG2, TG3 og TGIU i farger og avvikskategoriene TG1–TG3. Det virket i rapporten.

**Begrensninger:**
- Maks tre avvikskategorier.
- Vurdering og kategori er to separate ting. NS 3600 trenger at TG, årsak, konsekvens og tiltak henger sammen per avvik.

**Byggcon bør:**
- Bygge malen etter forskriftens bygningsdeler og rom, med obligatoriske punkter og krav om fullført før publisering (høy)
- Lage TG som en felles egenskap per avvik, med årsak, konsekvens, tiltak og kostnadsintervall i kroner. Kostnadsintervallene må Byggcon bestemme. IVIT bruker under 20 000 / 20–100 000 / 100–200 000 / 200–500 000 / over 500 000 kr. (høy)
- Ha frasebibliotek per punkt med «mest brukt» (høy)
- Ha standardtekst om kontrollnivå per seksjon (middels)
- Ha import og eksport til regneark (middels)

### 5. Testinspeksjon, rapport, publisering, portal og reparasjonsliste

**Ny bestilling:**
- inspektør, dato og tid
- adresse med areal og byggeår
- kunde, kopi-e-post, notater og SMS-samtykke
- tjenester, tillegg og rabatt
- om betaling kreves før rapporten frigis
- kundens megler, selgers megler og andre personer
- ordre-ID, henvisningskilde, bekreftet, slå av varsler, interne notater

**Oppdragssiden:**
- kart og bygningsdata, vedlegg og notater
- personer med «send bekreftelse på nytt»
- egne lenker for kunde- og meglervisning
- tjenester og avtaler (vis, endre, last opp, PDF)
- e-post med status, SMS, avgifter og betalinger
- menyvalg: ombooke, kopiere oppdrag, kansellere og skrive ut ordre
- **endringslogg (hvem, når, hva)**

**Rapportredigering (V10 og V9):**
- Seksjoner og punkter til venstre, og faner for informasjon, begrensninger og avvik.
- Per avvik: kategori, sted, tekst, anbefaling, kostnadsestimat (min–maks), bilde, video og 360-bilde.
- Lagre tilbake til malen, flagge, søk med Ctrl+K. V10 virker uten nett.
- **Testet i V9:** TG2 på et takpunkt, materiale «Tile», avvik «Tiles Cracked», stedet «Sørvendt takflate», norsk tekst og kostnad min–maks.

**Publisering:** «Preview» viser nettrapport med sammendrag, avvik og TG-rutenett. «Quick Publish» publiserer uten varsel. «Publish All» sender e-post.

**Portalen (testet som kunde):**
- Bestillingsdetaljer og legg til i kalender.
- **Signere avtale:** initialer og «I agree» ga status «Signed».
- **Betaling:** Rapporten var låst til betaling var registrert.
- Meglerlenken viser det samme.

**Reparasjonsliste (testet som kunde):**
- Filter: alle / anbefalinger + alvorlige / bare alvorlige.
- Kunden velger avvik og legger inn krevd kreditt og kommentar per avvik, og totalen summeres.
- Dokument og kopierbar tekst.

**Byggcon bør:**
- Lage digital oppdragsavtale med e-signering (helst BankID, avkrysning som minimum) som lagrer tid og IP (høy)
- Kunne frigi rapporten etter betaling, eller når megler garanterer oppgjøret (middels)
- Ha portal med egne lenker for selger, megler og kjøper. Kjøperens tilgang styres via megler. (høy)
- Ha endringslogg på oppdraget, viktig ved reklamasjoner (høy)
- Ha reinspeksjon, «utbedret siden forrige rapport» (middels)
- Ha kostnadsoversikt for kjøper og megler med NOK-intervall per TG3. Uavhengigheten må vurderes. (middels)

### 6. Kontakter, statistikk, eksport

**Kontakter:** meglere, meglerteam, meglerforetak, kunder og personer, med import og eksport.
- Meglerkortet har kontaktinfo, foretak, team og notater (synlige for alle eller bare admin).
- Listen viser antall oppdrag per megler.
- Meglerprofil med omsetning og oppgaver krever Advanced.

**Metrics:** oppdrag, henvisningskilder, toppmeglere, omsetning, betalinger, kart og inntekt fra online booking.

**Dataeksport:**
- oppdrag, avgifter og betalinger
- ubetalte og usignerte oppdrag
- kjørelengde per år
- meglereksport

**Rapporter:** for meglere, omsetning og oppdrag, med datovalg og nedlasting.

**Byggcon bør:**
- Lage lett CRM for meglere og meglerforetak med henvisninger, omsetning og notater (høy)
- Ha liste over ubetalte og usignerte oppdrag (høy)
- Ha kjørebok-eksport (middels)
- Ha CSV-eksport (middels)

## (c) Avanserte funksjoner Spectora er god på

1. **Prismotor** med modifikatorer (m², alder, avstand, postnummer), tillegg, avgifter, rabatt og prisoppbygging som vises fortløpende.
2. **Automatisering** per rolle og kanal med fleksibel timing. Advanced legger til utløser, betingelse, forsinkelse og webhook.
3. **Portal og selvbetjening:** signering, betaling, rapport, reparasjonsliste og tilleggsbestilling i én flyt. Rapporten låses til betaling er mottatt.
4. **Malsystem** med egne vurderinger, kategorier, standardtekster, sted, fagfolk, bilde, «mest brukt», kloning, deling og import fra regneark.
5. **Kvalitetssikring:** krav om fullført før publisering, signatur per inspektør, endringslogg og varsel ved feil levering.
6. **Mange måter å bestille på:** intern bestilling, online booking, prisvidget, forespørselsskjema og tilbud som utkast. Kalenderen låses mens noen bestiller.
7. **Rettighetsmatrise** og verktøy for flere avdelinger.
8. **Åpenhet utad:** åpent API, kalenderkobling, nattlig sikkerhetskopi og integrasjoner.
9. **Små tidsbesparelser:** stedsmerker, daglig timeplan, kart og kjørerute, kopiere oppdrag og automatisk henting av eiendomsdata.

## (d) KI

- **Maleditor, «Edit using AI»:**
  - Man skriver et funn og velger lengde (kort, normal, lang).
  - KI-en gir tittel, beskrivelse, alvorlighetsgrad, anbefalt fagperson og sted.
  - Brukeren velger hvilke felt som tas i bruk.
- **Rapporteditor (V10):** «rediger med KI» per kommentar, og «generer med KI» for nye kommentarer, i et chat-panel.
- **Test:** Den norske teksten «knuste takstein på sørvendt takflate, fuktmerker på undertak, vurder TG etter NS 3600» ga **engelsk** svar:
  - tittel «Broken Roof Tiles with Moisture Damage»
  - alvorlighetsgrad «Major Concern»
  - fagperson «roof»
  - sted «South»

  KI-en forstår norsk og plukker ut strukturerte felt, men skriver ikke norsk og kjenner ikke TG-logikken.
- **MCP-kobling:** Claude eller ChatGPT kan spørre i oppdrag, kunder og meglere.

**Byggcon bør:**
- Lage norsk KI fra stikkord eller diktering til ferdig avvik, med TG-forslag, årsak, konsekvens, tiltak og kostnadsintervall. Takstmannen godkjenner alltid.
- La KI-en kontrollere rapporten mot forskriftens minstekrav, som en automatisk sidemannskontroll.
- Tilby en API- eller MCP-tilkobling.

## (e) Topp 15 krav til Byggcons system (fra Spectora-testen)

1. **Oppdraget er navet**, med rollene selger/oppdragsgiver, megler og kjøper og egne lenker per rolle. (høy)
2. **Prismotor** med BRA, byggeår, avstand og tillegg, MVA per linje og forhåndsvist totalpris. (høy)
3. **Faktura og betaling** via Visma eAccounting, med betalingsstatus og valg om at rapporten frigis etter betaling. (høy)
4. **Digital oppdragsavtale** med e-signatur (helst BankID) som lagrer tid og IP. (høy)
5. **Automatiseringsmotor:** utløser, betingelse, forsinkelse og handling, med køvisning og feilvarsel. (høy)
6. **Maler og frasebibliotek** etter forskriftens bygningsdeler. TG og avvik med årsak, konsekvens, tiltak og kostnad. (høy)
7. **Krav om fullført før publisering**, ut fra forskriftens minstekrav. (høy)
8. **Editor som virker uten nett**, med bilder og stedsmerker. (høy)
9. **Portal** med nettrapport og PDF, sammendrag med TG2/TG3 først, og kostnadsoversikt. (høy)
10. **Endringslogg** på oppdrag og rapport. (høy)
11. **Norsk KI-skriving** og automatisk kvalitetskontroll. (høy)
12. **CRM for meglere** med statistikk. (middels)
13. **Online booking eller forespørselsskjema** med egne felt (gnr/bnr, seksjon, egenerklæring mottatt). (middels)
14. **Rettighetsmatrise** og daglig timeplan-e-post. (middels)
15. **Eksport, rapporter og API/MCP.** (middels)

## (f) Opprettet eller endret i prøvekontoen

- **Tjeneste:** «Tilstandsrapport TEST», med en modifikator for areal, tillegget «Arealmaaling BRA (test)», avgiften MVA 25 %, og koblet mal og avtale.
- **Rabattkode:** BYGGCONTEST (10 %).
- **Avtale:** «Oppdragsavtale tilstandsrapport (TEST)».
- **Mal:** «Byggcon TEST – Tilstandsrapport NS 3600» med TG-vurderinger. Originalmalen fikk ved et uhell endret navn, men det er satt tilbake.
- **Kontakter:** «Mari Megler (TEST)» og «Kari Kjoper (TEST)» med example.com-adresser.
- **Inspeksjon:** Testveien 1, Bodø, 23.10.2026 (brukte én av to gratis prøveinspeksjoner).
  - Publisert uten varsler.
  - Avtalen signert som fiktiv kunde, og manuell betaling registrert.
  - Reparasjonslisten åpnet.
- **Innstillinger:** Kostnadsestimat og reinspeksjon er slått på. Online booking ble testet og slått av igjen. Påminnelse til kunde 2 dager før befaring er slått på.
- **Ikke gjort:** Ingen abonnement eller betalingskort. Ingen tilkobling til Stripe, Square, QuickBooks eller Google. Ingen endring av passord eller e-post.
