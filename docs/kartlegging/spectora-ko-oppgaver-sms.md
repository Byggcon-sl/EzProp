# Spectora: kø per oppdrag, oppgaver og SMS-innboks

Sist oppdatert: 24.10.2026
Status: Utkast – ikke godkjent.
Kilde: Claude-hjelpeagent i Spectoras prøvekonto 24.10.2026, med bare fiktive data. Dette utfyller `spectora-advanced-test.md`.

**Merking:**
- **Testet:** gjort selv i kontoen.
- **Sett:** vist i appen, men ikke fullført.
- **Dok/kode:** fra Spectoras hjelpesenter eller fra koden og API-kallene i appen.

## 1. Kort oppsummering

- **Nytt oppdrag kunne ikke lages.** Prøvekontoen er tom for gratis oppdrag, og «Save Inspection» er låst. Køen er derfor ikke testet på et lagret oppdrag. Den ble kartlagt via «Preview Actions» i skjemaet (sett) og ut fra koden og hjelpesenteret.
- **Den tomme ansvarlig-listen i Oppgaver har en forklaring:** Ståle står som *inaktiv inspektør* fordi kontoen ikke har abonnement. Bare aktive brukere vises. Å aktivere ham igjen koster $99/mnd, så det ble ikke gjort.
- **Oppgaver er testet med en gratis kontoransatt** («Siri Kontor (TEST)», @example.com).
- **SMS-innboksen krever Advanced og et eget telefonnummer** ($20/mnd, finnes bare i USA, Canada, Puerto Rico og Storbritannia). Den er kartlagt, og ingenting er kjøpt.
- Ingenting har kostet penger, og ingen e-post eller SMS er sendt.

## 2. Kø per oppdrag («Inspection Actions»)

**Forhåndsvisning før lagring (sett):** «Preview Actions» i skjemaet for nytt oppdrag.
- Viser alle meldinger som vil gjelde for oppdraget, gruppert etter fase: bestilling, ny dato, avtale og pris, før befaring, publisering og etter befaring.
- Kolonnene er Type/Name, To, Event, Rules og Details, med en bryter per melding.
- En celle åpner en veiviser i fire steg: Event, Rules, Action og Details.
- «+ ADD ACTION» lager en melding bare for dette oppdraget.

**Køen på et lagret oppdrag (dok/kode):**
- **Farger:** grønn = sendt, grå = regel ikke oppfylt, rød = utløst men feilet.
- **Per melding:**
  - bryter med bekreftelse
  - telleren «N Triggers»
  - «View Triggers», med tidslinje og leveringsstatus per sending (levert, åpnet, klikket, avvist, spam, planlagt), tid og mottaker
- **Planlagte meldinger:** dato og tid kan endres, og meldingen kan slås av.
- **«Send»:** sender nå hvis vilkårene er oppfylt, etter en bekreftelse som viser til, fra og kopi.
- **Send på nytt:** kjører regelen med oppdaterte data, så en rettet e-postadresse blir brukt.
- **Import av nye regler:** virker bare framover.
- **Ny befaringsdato:** påminnelsene planlegges på nytt, men meldinger langt fram i tid blir liggende.
- **Begrensninger:**
  - Gjelder bare V9-visningen.
  - Et oppdrag med vanlige automatiseringer kan ikke gjøres om.

## 3. Oppgaver (Tasks)

- **Liste:**
  - Filter på ansvarlig, status, prioritet og type. **Filteret på ansvarlig virker ikke.**
  - Kolonnene er opprettet, type, tittel, prioritet, status, frist, lenke og ansvarlig.
- **Skjema:**
  - type: Confirm, Inquiry, Networking, Scheduling eller Other
  - én ansvarlig
  - prioritet: lav, normal eller høy
  - frist (dato uten klokkeslett)
  - tittel, beskrivelse, automatisk lenke og kommentarer
- **Status:** ny → pågår → ferdig. En ferdig oppgave forsvinner fra standardvisningen. Bare admin kan slette, og sletting kan ikke angres.
- **Varsler (sett):** e-post når en oppgave lages, og daglig oppsummering på e-post til fast tid.
- **Hvor oppgavene vises:**
  - meglerprofil (testet)
  - oppdrag (sett)
  - ikon i toppmenyen med rødt merke ved forfall (dok)
  - widget på dashbordet (dok)
  - **ikke i mobilappen** (dok)
- **Testløp:** én oppgave ble laget fra meglerprofilen, satt til «pågår», kommentert og fullført.

## 4. SMS-innboks (Conversations)

- **Oppbygning:**
  - Fanene Inspektører, Meglere og Kunder, med én tråd per kontakt.
  - Automatiske meldinger er merket «Auto» og har lenke til oppdraget.
  - Fra oppdragssiden åpnes tråden med en snakkeboble per person.
  - En egen rettighet styrer hvem som har tilgang.
- **Samtykke:** En kontakt som har reservert seg («opted out»), er sperret.
- **Begrensninger:**
  - Mottakeren må ha mobilnummer.
  - Bilder kan ikke sendes.
  - Finnes bare på nett.
- **Uten eget nummer:** SMS sendes fra et felles amerikansk nummer, med faste maler og uten mulighet for svar.
- **Med eget nummer:** egne maler (480 tegn), og svar kan videresendes til e-post eller telefon.
- **Priser:** nummer $20/mnd, Advanced $4 per publisert oppdrag, inspektør $99/mnd. Kontoransatte er gratis.

## 5. Svakheter

1. Gratisgrensen stenger alt uten forklaring: inspektøren blir inaktiv, ingen nye oppdrag kan lages, og oppgavelisten blir tom.
2. Filteret på ansvarlig i oppgavelisten virker ikke.
3. Oppgaver har bare én ansvarlig, ingen gjentakelse, ingen frist med klokkeslett, og finnes ikke i mobilen.
4. Regler kan ikke lage oppgaver.
5. Køen finnes bare i den gamle visningen.
6. Import virker bare framover.
7. Meldinger langt fram i tid blir liggende når befaringsdatoen endres.
8. SMS virker ikke i Norge.

## 6. Hva dette betyr for EzProp

Norsk flyt: megler bestiller, og Byggcon fakturerer etter levering via Visma eAccounting.

**Høy prioritet:**
- **Kø per oppdrag:**
  - Statusene planlagt, sendt, levert/åpnet, stoppet med grunn og feilet.
  - Knappene «send nå», «stopp» og «se meldingen».
- **Forhåndsvisning** av hvilke meldinger som vil gå. Enkeltmeldinger kan slås av for ett oppdrag.
- **«Send på nytt»** bruker oppdaterte data, for eksempel rettet e-postadresse til megler.
- **Ny befaringsdato** flytter alle meldinger som hører til datoen. Meldinger som ikke lenger passer, stoppes med begrunnelse.
- **Oppgaver** koblet til oppdrag og megler, med kommentarer og status (ny, pågår, ferdig).
- **Oppgaver som lages av regler**, for eksempel «egenerklæring mangler 2 dager før befaring».

**Middels prioritet:**
- Nye regler gjelder automatisk også for oppdrag som er åpne.
- Oppgaver i mobilen og på dashbordet, med daglig oppsummering.
- Kontorbrukere som ikke koster noe, og tydelig beskjed når en bruker er inaktiv.
- Samtykke til SMS per kontakt.

**Lav prioritet nå:**
- Utgående SMS via en norsk leverandør, med «Byggcon» som avsender. Toveis innboks kan komme senere. (Ståle 24.10.2026: e-post holder foreløpig.)

**Ikke aktuelt:**
- Betalingslås på rapporten.

## 7. Opprettet i prøvekontoen

- **Kontoransatt:** «Siri Kontor (TEST)», siri.kontor@example.com. Gratis, ikke admin.
- **Oppgave nr. 77565:** koblet til Mari Megler (TEST), med én kommentar og status ferdig.
- **Ikke rørt:** Ingenting annet er lagret eller endret.

**Kostnad: ingen.** Ingen kort, abonnementer eller numre er lagt inn eller kjøpt.

**Husk:** Advanced-prøven må avsluttes før den går ut.
