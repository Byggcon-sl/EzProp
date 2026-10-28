# Spectora Advanced testet i praksis

Sist oppdatert: 24.10.2026
Status: Utkast – ikke godkjent.
Kilde: Claude-hjelpeagent i Spectoras prøvekonto 24.10.2026, med fiktive data (testoppdraget Testveien 1). Retter og utfyller `spectora-advanced-automatisering.md`.

## 1. Kort oppsummert

- **Rettelser til `spectora-advanced-automatisering.md`:**
  - Kategoriene er ti faste, og man kan legge til flere.
  - SMS kan ikke skrives fritt uten et kjøpt telefonnummer. Da er det bare 24 låste engelske maler å velge mellom.
  - Automatiske merker settes med en gang regelen lagres, ikke om natten.
  - «Check deliverability» (spamsjekk) er slått av for vår konto.
- **Nytt:**
  - Det er **29 utløsere**.
  - Valget «Per Inspection / All Inspections» styrer hvilke oppdrag reglene gjelder.
  - Det finnes et offentlig API og en MCP-kobling, slik at KI-verktøy kan lese oppdrag, kunder og meglere.
- **Ikke testet:** køen per oppdrag (grønn, grå og rød status, «send på nytt»). Den vises bare på oppdrag som er laget etter at Advanced ble slått på, og vi har ingen gratis oppdrag igjen.

## 2. Oppbygning

- **Regelen:** «When this happens → Only send if (valgfritt) → Do this». Lagres som aktiv eller inaktiv. Maks 10 handlinger per regel.
- **Handlinger:** bare e-post, SMS og webhook. Regler kan ikke lage oppgaver eller sette merker.
- **Betingelser:**
  - Valg: tjeneste, tillegg og tjenestekategori; betalt eller ikke; avtaler signert; rapport publisert eller navnet inneholder; byggeår; grunnmur; areal; postnummer, by og delstat; merker.
  - Bare én type kobling per regel, OG eller ELLER.
- **Mottakere:** kunde, kundens og selgers megler, advokat, forsikring, oppgjør, admin, inspektør og faste adresser. Både Cc og Bcc.
- **Tid:** før eller etter utløseren, i minutter, timer, dager, uker eller måneder. «X dager før befaring» settes på selve meldingen.
- **Innstillinger per melding:**
  - bare én gang
  - også gjentatte oppdrag
  - send selv om varsler er av
  - tidsvindu
  - ikke i helgen
  - transaksjon eller markedsføring
- **E-post:**
  - Rik tekst, testsending og opplasting av faste vedlegg.
  - Rundt 90 plassholdere.
  - **Rapport-PDF og sammendrag kan bare sendes som lenke, ikke som vedlegg.**
- **Webhook:**
  - Man velger hvilke datagrupper som sendes med.
  - Mangler hemmelig nøkkel, overskrifter og HTTP-metode.
- **KI-hjelp til tekst:** Valg av formål og tone. **Lager god norsk tekst** med riktige plassholdere når man ber om bokmål.
- **Ferdige oppskrifter:** 13, alle amerikanske (mersalg av radon og mugg, garanti, anmeldelse).
- **Metrics:** aktive regler, mersalg, åpningsrate og antall sendte meldinger.

## 3. CRM sett i praksis

- **Automatiske merker:** For eksempel «aktiv selgermegler» ut fra antall oppdrag og omsetning i en periode. Merket fjernes når regelen ikke lenger stemmer.
- **Meglerprofil:**
  - Omsetning og antall oppdrag per periode.
  - Interne notater, oppgaver og logg over samtaler, e-post og notater.
- **Megleranalyse:**
  - Rapporter: toppmeglere, nye meglere, inaktive meglere, toppkontorer og duplikater.
  - Egne eksporter i tre steg.
  - Egne dashbord med 25 ferdige widgeter.
- **Oppgaver:**
  - Har type, ansvarlig, prioritet og frist, og en daglig oppsummering på e-post.
  - Kunne ikke testes, fordi listen over ansvarlige var tom i prøvekontoen.
- **SMS-innboks:** krever kjøpt nummer.

## 4. Svakheter

1. Regler gjelder ikke oppdrag som allerede finnes.
2. Bare OG eller bare ELLER i en regel.
3. Rapporten kan ikke legges ved som fil.
4. SMS er låst til engelske maler.
5. Webhook er usikret og har ingen logg.
6. Alt er bygd for amerikansk flyt: betaling før rapport, «Closing Date» og amerikanske tjenester.
7. Regler kan ikke lage oppgaver eller merker.
8. Med «Per Inspection» kan regler stille la være å kjøre.
9. Feilmeldinger er uklare (tom ansvarlig-liste uten forklaring).

## 5. Norsk flyt (ramme fra Ståle 24.10.2026)

- **Megler som oppdragsgiver:** Kjøpers og selgers megler blir én rolle, megler som oppdragsgiver. Andre mottakere er selger og eventuelt kjøper via megler.
- **Faktura:** Betalingsutløsere erstattes av hendelser fra regnskapstilkoblingen: **faktura sendt**, **faktura betalt** og **faktura forfalt**. Rapporten låses ikke bak betaling.
- **Relevante utløsere:** «oppdragsavtale signert» og «megler eller selger har åpnet rapporten».
- **Ikke relevant:** «Closing Date». Den norske motsvarigheten kan være «rapporten nærmer seg 12 måneder».

## 6. Forbedringer i EzProp (prioritert)

1. **Regler også på eksisterende oppdrag.** De vurderes når hendelsen skjer, med en «gjelder fra»-dato.
2. **Ekte vedlegg** (rapport-PDF, sammendrag, egenerklæring). Velg per regel om det skal være lenke, vedlegg eller begge.
3. **Norske hendelser**, også faktura-hendelser og «rapport rettet».
4. **Logg per oppdrag** med status, årsak og «send på nytt», og varsel når noe feiler.
5. **Grupper av betingelser**, vist enkelt som «alle» eller «minst én».
6. **Sikret webhook** med nøkkel, nye forsøk og logg. Levering til meglersystem via tilkobling.
7. **Handlingene «opprett oppgave» og «sett merke».**
8. **SMS som kan skrives fritt**, via norsk leverandør bak en tilkobling.
9. **Norske ferdigoppskrifter:** rapport til megler, påminnelse dagen før befaring og egenerklæring mangler.
10. **KI-hjelp til tekst på norsk**, med spamsjekk.
11. **Senere:** automatiske merker, megleranalyse, egne eksporter og API/MCP for KI-verktøy.

## 7. Opprettet i prøvekontoen (fiktivt)

- **Tre automatiseringer** (aktive, men kjører bare når noen krysser av for «Use Actions» på et oppdrag):
  - TEST A: rapport til megler
  - TEST B: med betingelser og webhook til example.com
  - TEST C: påminnelse dagen før
- **Merke** «Aktiv selgermegler (TEST)», satt på Mari Megler.
- **Ett notat** på Mari Megler.
- **Dashbordet** «TEST megleroversikt» (tomt).
- **Innstillingen** «Per Inspection» er satt tilbake.

**Kostnad: ingen.** Ingen rapport er publisert, og ingen e-post er sendt.

**Husk:** Advanced koster 4 dollar per publisert rapport etter prøveperioden (31 dager fra 24.10.2026). Den må slås av før perioden går ut: Billing → Spectora Advanced → Disable Advanced.
