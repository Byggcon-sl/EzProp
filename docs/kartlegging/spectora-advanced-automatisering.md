# Spectora Advanced – automatisering («hendelser og handlinger»)

Sist oppdatert: 23.10.2026
Status: Utkast – ikke godkjent.
Kilde: En Claude-hjelpeagent i Spectoras prøvekonto 23.10.2026, Spectoras hjelpesider og programkoden som lastes i nettleseren. **Advanced ble ikke aktivert**, så automatiseringene er ikke prøvd i praksis.

Bakgrunn: Ståle vil at EzProp skal ha «hendelser og handlinger», for eksempel «generer ferdig rapport → send e-post til megler → vedlegg ferdig rapport». [Svar 23.10.2026, spørsmål 19]

## Hvorfor Advanced ikke ble testet

- Prøveperioden er 30 dager gratis, deretter $4 per publiserte rapport.
- **Den kan ikke startes uten betalingskort**, og den går automatisk over til betaling etter 30 dager uten noe tak.
- Begge deler bryter Ståles grense på $25, så ingenting ble aktivert, publisert eller lagt inn.
- **Hvis Ståle vil teste selv:**
  1. Legg inn kort.
  2. Sett en påminnelse om å slå av Advanced før dag 30 (Billing → Spectora Advanced → Disable Advanced).
  3. Publiser høyst 2 rapporter. Kostnad: $0 i prøveperioden, høyst $8 hvis noe glipper.

## Slik fungerer automatiseringene i Spectora

**Editoren har tre blokker:**
1. **Når dette skjer** (utløser)
2. **Bare hvis** (betingelser, valgfritt)
3. **Gjør dette** (opptil 10 meldinger per regel, hver med eget tidspunkt, mottakere og tekst)

Reglene lagres som aktive eller inaktive, kan sorteres i egne kategorier, og det finnes et bibliotek med ferdige oppskrifter.

**Utløsere (eksempler):**
- forespørsel mottatt, oppdrag bekreftet, flyttet eller avlyst
- tjeneste eller tillegg lagt til eller fjernet
- vedlegg lagt til
- rapport publisert
- tidsstyrt: X minutter, timer eller dager før eller etter befaring

**Betingelser:**
- tjeneste eller tillegg
- ord i rapportnavn eller vedleggsnavn
- egne bestillingsfelt
- byggeår, areal, fundament
- merke på klient eller megler
- betalt, signert, publisert

**Begrensning:** Betingelsene kan bare kombineres med enten OG eller ELLER, aldri begge.

**Handlinger:** e-post, SMS og webhook (JSON til et annet system). **Oppgaver og merker kan ikke lages av en regel.**

**Mottakere:** klient, klientens megler, selgers megler, inspektør og fast adresse.

**Innstillinger per melding:**
- bare én gang
- bare innenfor visse klokkeslett
- ikke i helger
- send selv om varsler er slått av
- transaksjons- eller markedsføringsmelding (markedsføring får avmeldingslenke)

**Vedlegg:** bare faste filer (maks 10 MB). **Selve rapport-PDF-en kan ikke legges ved**, bare sendes som lenke.

**Flettefelt:** 92 stykker, for klient, megler, selgers megler, inspektør, eiendom, oppdrag, lenker (signer, betal, rapport, faktura, portal) og firma.

**Kø og logg per oppdrag:**
- **Grønn** = sendt, **grå** = betingelsen var ikke oppfylt, **rød** = feilet. Man kan se *hvorfor*.
- Meldinger kan sendes på nytt med oppdaterte data.
- **Svakhet:** Nye regler gjelder bare oppdrag som bookes etterpå.

**KI:**
- **AI Message Assist** skriver emne og tekst ut fra formål og tone.
- **Check deliverability** ser etter ord som kan gi spamfilter-treff.

**API og webhooks** (oppdrag opprettet, bekreftet, avlyst eller publisert, megler eller kunde endret) med automatiske nye forsøk. Krever ikke Advanced.

**CRM i Advanced:**
- **Kontaktmerker** og regler for automatiske merker, kjørt hver natt. Eksempler: «toppmegler», «inaktiv», «ny megler».
- **Meglerprofil** med omsetning, antall oppdrag, logg over samtaler og e-post, notater og oppgaver.
- **Megleranalyse:** nye, inaktive og toppmeglere og -foretak.
- **Oppgaver** med ansvarlig, prioritet, status og kommentarer, knyttet til oppdrag eller megler. Daglig oppsummering på e-post.
- **SMS-innboks** per kontakt, med automatiske SMS i samme tråd.

## Hva EzProp bør ha

**Må med:**
1. Den samme tredelingen **Når → Bare hvis → Gjør**, på norsk og med få valg.
2. **Norske hendelser:**
   - oppdrag bestilt
   - befaring bekreftet, flyttet eller avlyst
   - befaring om X dager
   - utkast sendt
   - egenerklæring mottatt
   - kommentar fra selger
   - sidemannskontroll godkjent
   - ferdig rapport
   - rapport rettet (ny revisjon)
   - faktura sendt, faktura betalt
3. **Mottakere etter rolle:** oppdragsgiver/selger, megler, kjøper, takstmann, kontor, fast adresse.
4. **Ekte vedlegg:** rapport-PDF, faktura og egenerklæring, ikke bare lenke. Dette er bedre enn Spectora.
5. **Logg per oppdrag** med status og forklaring, og mulighet til å sende på nytt.
6. **Handlinger:** e-post, SMS, **opprett oppgave**, **legg til merke** og **lever til megler via API**. Dette er bedre enn Spectora.

**Bør med:**
- **Levering til meglersystem** via API eller webhook, med automatiske nye forsøk.
- **Innstillinger per melding:** bare én gang, tidsvindu, ikke helg, forsinkelse.
- **Ferdige oppskrifter** for vanlige rutiner, gjerne per oppdragsgiveravtale (f.eks. Fremtind).
- **Transaksjon og markedsføring** skilles, med samtykke lagret på kontakten.

**Senere:** automatiske merker på meglere, meglerprofil, megleranalyse og KI-hjelp til tekst.

**Unngå Spectoras svakheter:**
- At regler bare gjelder nye oppdrag. Regelen bør vurderes når hendelsen skjer.
- At man bare kan velge OG eller ELLER. Vi bør tillate grupper.
- At meldinger feiler i stillhet. Feil skal alltid vises.

## Forslag til datamodell (utkast)

- **hendelse:** id, organisasjon, type, oppdrag, data, tidspunkt. Hendelser slettes aldri, så dette er også revisjonssporet.
- **regel:** id, organisasjon, navn, kategori, aktiv, utløser (hendelsestype), logikk (alle/minst én, med grupper).
- **betingelse:** regel, felt, operator, verdi, gruppe.
- **steg** (flere per regel):
  - handlingstype: e-post, SMS, webhook, oppgave, merke, lever til megler
  - forsinkelse og tidsvindu
  - ikke helg, bare én gang, meldingstype
- **mottaker:** rolle, fast adresse eller kontakt.
- **mal:** emne og tekst med flettefelt.
- **vedlegg:** rapport-PDF, sammendrag, faktura, egenerklæring eller fast fil.
- **kjøring:** regel, steg, hendelse, status (venter / hoppet over / sendt / feilet), årsak, tidspunkter, antall forsøk og kopi av det som ble sendt.

Alt filtreres på organisasjon, og regler kan eies av organisasjon, selskap eller oppdragsgiveravtale (se `grunnmur-samarbeid-og-flere-selskaper.md`).

## Kilder

- https://support.spectora.com/en/articles/10843842-advanced-automations
- https://support.spectora.com/en/articles/3483315-how-to-create-advanced-automations-for-specific-triggers
- https://support.spectora.com/en/articles/9745604-how-to-add-attachments-to-advanced-automation-emails
- https://support.spectora.com/en/articles/4860431-list-of-placeholders-and-where-to-use-them
- https://support.spectora.com/en/articles/15465749-spectora-webhooks-what-they-are-when-they-fire-and-how-they-work
- https://support.spectora.com/en/articles/10089183-how-to-start-a-free-trial-for-spectora-advanced
- https://support.spectora.com/en/articles/8067074-spectora-advanced-auto-tagging
- https://support.spectora.com/en/articles/8107198-spectora-advanced-tasks-management
- https://support.spectora.com/en/articles/6272903-spectora-advanced-agent-reporting
- https://support.spectora.com/en/articles/13518824-advanced-automations-ai-message-assist
