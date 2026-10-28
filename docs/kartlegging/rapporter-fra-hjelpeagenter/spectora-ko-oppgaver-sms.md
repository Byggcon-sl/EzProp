# Spectora – kø per oppdrag, oppgaver og SMS-innboks (prøvekonto)

Dato: 24.10.2026. Utført av Claude-hjelpeagent i Ståles prøvekonto, med bare fiktive data.
Merking: **Testet** = jeg gjorde det selv i kontoen. **Sett** = vist i appen, men ikke fullført. **Dok/kode** = fra hjelpesenteret eller fra JavaScript og API-kall i appen.

---

## 1. Kort oppsummering

- **Nytt oppdrag kan ikke lages.** Prøvekontoen er tom for gratis oppdrag. Koden i skjemaet sier rett ut: «You have used all your free inspections. Please subscribe to one of our paid plans.» «Save Inspection»-knappen er grå. Jeg stoppet der, som avtalt. Køen per oppdrag er derfor **ikke testet på et ekte oppdrag**.
- **Men jeg fikk sett køen likevel**, via «Preview Actions» i skjemaet for nytt oppdrag. Der ser man alle automatiske meldinger som vil gjelde for oppdraget, og hver enkelt kan slås av eller endres før oppdraget lagres. Resten av køen (status grønn/grå/rød, «Send», «View Triggers», import) er kartlagt fra koden og hjelpesenteret.
- **Årsaken til den tomme listen over ansvarlige i Oppgaver er funnet.** Ståles bruker er en *inaktiv inspektør*, fordi kontoen ikke har noe betalt abonnement. Listen over brukere (`/api/v2/users`) viser bare aktive brukere, og da ble den tom. Å aktivere Ståle igjen krever et abonnement ($99/mnd), så det lot jeg være.
- **Løsning som var gratis:** Jeg la til en kontoransatt («support staff»), «Siri Kontor (TEST)», med en @example.com-adresse. Det er gratis i Spectora. Etter det kom hun opp som ansvarlig, og jeg laget, kommenterte og fullførte én oppgave. **Testet.**
- **SMS-innboksen (Conversations)** er låst. Den krever både Advanced og et eget telefonnummer ($20/mnd, bare USA, Canada, Puerto Rico og Storbritannia). Jeg har kartlagt den ut fra skjermene, hjelpesenteret og koden. Ingenting er kjøpt.
- **Ingenting har kostet penger**, og ingen e-post eller SMS er sendt.

---

## 2. Funksjonene

### 2.1 Køen per oppdrag i Advanced («Inspection Actions»)

**Status: delvis sett i appen (forhåndsvisning), resten fra dokumentasjon og kode.**

#### Hvorfor nytt oppdrag stoppet (testet)
- Skjemaet for nytt oppdrag (`/v/inspections/new`) har avkrysningen **«Use Actions on this inspection? (Otherwise we'll use your usual Automation settings.)»**, med teksten «You're seeing this because you're trialing Actions». Jeg krysset av.
- Jeg fylte ut: dato 30.10.2026 kl. 10, adresse «Testveien 2, Bodo, 8000», kunde «Ola Testselger (TEST)» (ola.testselger@example.com), tjenesten «Tilstandsrapport TEST» og ordre-ID TEST-002. Prisen ble regnet ut til $12 375 inkl. 25 % MVA.
- Listen over inspektører var tom («No data available»), og **«Save Inspection» var grå**.
- I koden (`inspectionSaveable`) må tre ting stemme: adresse, dato, og at det ikke finnes noen «ineligibleReason». Kontoen har `paid=false`, `free_inspection_limit=0` og `inspection_count=1`. Det gir grunnen «freeTrial», med teksten «You have used all your free inspections. Please subscribe to one of our paid plans.» og en knapp til `/subscriptions/new`.
- Jeg stoppet her og lagret ingenting. Ingen kjøpsdialog ble åpnet.
- Det samme ville skjedd med «Reorder/Copy» av Testveien 1, fordi det også lager et nytt oppdrag.

#### «Preview Actions» – forhåndsvisning av køen (sett i appen)
Når «Use Actions» er krysset av, dukker knappen **«Preview Actions»** opp. Den åpner et vindu med teksten «Below are your actions that currently apply to this inspection.»

Meldingene er gruppert slik (antallet gjelder denne kontoen):

| Gruppe | Antall | Innhold |
|---|---|---|
| Scheduling | 2 | E-post til kunde og kjøpers megler ved bestilling |
| Rescheduling | 2 | E-post ved ny dato |
| Inspection Agreements & Fees | 2 | Ny avtale eller ny avgift etter bestilling |
| Pre-Inspection: Client | 3 | Påminnelse 2 dager før, og TEST C (1 dag før, «not having inspection paid») som SMS og e-post |
| Pre-Inspection: Client's Agent / Listing Agent | 0 | – |
| Publishing | 5 | Rapport til kunde og megler, TEST A, og TEST B (e-post og webhook til example.com, med tre betingelser: tjeneste, signert avtale og rapportnavn) |
| Post-Inspection (3 grupper) | 0 | – |

- Hver rad viser kolonnene **Type/Name, To, Event, Rules og Details**, samt en **bryter Enabled/Disabled**. Jeg testet at bryteren endrer status til «Disabled». Jeg satte den tilbake og lagret ikke.
- Klikk på en celle åpner en **veiviser i fire steg**: 1) Choose an Event, 2) Add Rules, 3) Choose an Action, 4) Add Details. Steg 1 har tall, enhet, før/etter og hendelse, pluss valgene «Only trigger once», «Send even when notifications disabled», «Send during certain hours only» og «Do not send on weekends».
- **«+ ADD ACTION»** finnes i hver gruppe. Den lager en ekstra melding bare for dette oppdraget.
- Endringene gjelder bare dette ene oppdraget. Firmaets regler endres ikke.

#### Køen på et lagret oppdrag (fra dokumentasjon og kode)
- Køen åpnes med **«View All Inspection Actions»** på oppdragssiden. Dette gjelder V9-visningen. Hjelpesenteret sier at i V10 finnes lenken ikke alltid, og at man da må bruke «Resend Confirmation Text» eller kontakte support.
- **Fargene** (hjelpesenteret):
  - **Grønn** = sendt.
  - **Grå** = ikke sendt, fordi reglene ikke var oppfylt.
  - **Rød** = utløst, men sending feilet.
- **Per melding** (kode, `auto_track_runs`):
  - Bryter **Enabled/Disabled** («lås»). Ved avslag kommer «Disable Action – Disabling this action will prevent it from triggering.»
  - Teller: «N Triggers» i grønt når meldingen er utført.
  - **«View Triggers»** viser tre tall: «X Emails/Texts Sent», «Is Scheduled» / «Not Scheduled» og «Times Triggered». Under kommer en liste per utløsning («Trigger 1, 2 …») med tidslinje (tid og melding, f.eks. hvorfor den ble stoppet).
  - Per sendt melding vises leveringsstatus med ikon: delivered, open, click, dropped, bounce, spamreport, scheduled og «will send». Gode hendelser er grønne, dårlige (`is_failed`) har varselfarge. Videre vises tidspunkt, mottaker, kopi og emne, og knappen «View» åpner selve e-posten eller SMS-en.
  - Planlagte meldinger vises med klokkeikon, «Scheduled», dato og tid, og knappene **edit** og **disable/enable** («Stop this trigger from happening»).
  - **«Send»**: «Trigger this action now if conditions are met.» En bekreftelse («Send Now») viser To, From, CC, emne og tekst. Meldingen sendes bare hvis betingelsene er oppfylt.
  - «Debug» (bare for Spectoras egne administratorer).
- **Send på nytt** (hjelpesenteret): For Advanced kjøres hele regelen på nytt med oppdaterte data. Hvis man retter e-postadressen først og så trykker «Resend», går meldingen til den nye adressen. For vanlige automatiseringer går den til den gamle adressen.
- **Import av nye regler** (hjelpesenteret): Nye regler gjelder bare oppdrag som lages etterpå. «Import New Actions» nederst på oppdraget henter dem inn, men bare hvis hendelsen ikke har skjedd ennå (f.eks. «ved publisering»). Endrede regler oppdateres ikke ved import. Til det finnes «Update future automations» i Automations (Adv), som oppdaterer alle køede meldinger.
- **Ny dato** (hjelpesenteret): Ved ny dato planlegges påminnelser på nytt ut fra den nye datoen, og «Rescheduled»-meldingen sendes. Meldinger som ligger langt fram i tid (f.eks. etter 1 eller 3 måneder) blir liggende i køen og må slås av for hånd. «Trigger once» hindrer at meldingen om ny dato sendes flere ganger. Hvis oppdraget er bekreftet med varsler avslått, sendes bekreftelsen aldri automatisk etterpå.
- Et oppdrag som er laget med vanlige automatiseringer, kan ikke gjøres om til «Actions». Man må lage det på nytt via Reorder.
- **Manuell melding**: Man kan også lage en engangs-e-post eller -SMS i køen (`auto_event: manually_triggered`).

### 2.2 Oppgaver (Tasks)

**Status: testet**, bortsett fra e-postvarsler og daglig oppsummering (sett, ikke slått på).

#### Hvorfor listen over ansvarlige var tom (testet)
- `/api/v2/users` ga 0 brukere. `/api/v1/inspectors` ga også 0.
- Under Settings → Team står Ståle under **«Inactive inspectors»**. Profilen har `active: false`.
- Kontoen har ingen abonnementer (`plan_ids=[]`, og abonnementssiden er tom).
- Å aktivere en inspektør igjen krever et abonnement. Hjelpesenteret beskriver det slik: «Select the subscription you want to add them to», og en ny inspektør koster $99/mnd. **Ikke gjort.**
- Oppgavesiden filtrerer også som standard på den innloggede brukeren (`assignee_id=Ståle`). Derfor ble listen tom selv for admin.

#### Ny bruker (testet, gratis)
- Settings → Team → «Add Staff Member». Feltene er fornavn, etternavn, telefon, e-post (påkrevd) og «Send confirmation link». Hvis man ikke sender lenke, må man sette passord (minst 12 tegn).
- Rettighetene er avkrysninger: schedule, edit, delete, publish, mal (legge til og redigere), kontakter, conversations, økonomi og admin.
- Jeg la til «Siri Kontor (TEST)», siri.kontor@example.com. Jeg sendte ikke bekreftelseslenke, og hun fikk et tilfeldig passord som ikke er lagret noe sted. Hun er ikke admin og kan ikke slette.
- «Support staff are FREE» (hjelpesenteret). Etterpå ga `/api/v2/users` 1 bruker, og hun kunne velges som ansvarlig.

#### Skjermene
- **Oppgavelisten** (`next.spectora.com/tasks`):
  - Filtre på ansvarlig, status (Queued, In Progress, Complete), prioritet og type.
  - Kolonnene er Created, Task Type, Title, Priority, Status, Due Date (sorterbar), Link og Assignee.
  - Knappene er «Tasks Options» (bare admin) og «Add Task».
  - **Feil sett:** Når jeg valgte Siri i filteret, ble hun vist som valgt, men forespørselen spurte fortsatt etter Ståles oppgaver. Listen forble tom. Jeg bekreftet direkte i API-et at oppgaven finnes.
- **Ny oppgave / «Update Task»** (testet):
  - **Task Type**: Confirm, Inquiry, Networking, Scheduling eller Other.
  - **Assign To**: én bruker. Bare admin kan endre den.
  - **Priority**: Low, Normal eller High.
  - **Due Date**: dato uten klokkeslett. Den lagres som 23:59 samme dag i firmaets tidssone.
  - **Title** og **Description** (valgfri).
  - **Link**: koblingen til megler eller oppdrag, satt automatisk når oppgaven lages derfra.
  - **Comments**: kommentar med dato og navn.
  - Knappene er «Mark In Progresss» (skrivefeilen står i appen), «Mark Queued», «Mark Complete», Cancel og Save.
- **Radmeny** («Open options»): Mark In Progress, Mark Complete, Reassign og Delete. Delete gjelder bare admin og spør «There is no undoing this!».
- **Statuser**: queued → in_progress → complete. En fullført oppgave forsvinner fra standardvisningen og fra meglerprofilen, men kan hentes fram med statusfilteret.
- **Tasks Options** (sett, ikke lagret):
  - «Email Assignee when a task is created», med valgene «High Priority Tasks Only» og «Inspectors Only».
  - «Send Assignees a Task Summary Email Every Day at [klokkeslett 00–23]», med «Weekdays Only» og «Inspectors Only».

#### Hvor oppgavene vises
- **Meglerprofilen** (testet): boksen «Associated Task(s)» med «Add Task» og egen tabell. Jeg laget oppgaven der, og den ble koblet til megleren automatisk.
- **Oppdraget** (sett): Testveien 1 har boksen «ASSOCIATED TASKS» med «NEW», og teksten «There are no tasks associated with this inspection».
- **Toppmenyen** (sett): et ikon for oppgaver. Hjelpesenteret sier at det får rød prikk ved oppgaver som forfaller i dag eller er forfalt.
- **Dashbordet** (dok): widgeten «Tasks» viser Due today, Overdue, Tomorrow eller All. Ikke lagt til.
- **Mobilappen** (dok): oppgavene vises ikke der.

#### Testløp (testet)
Oppgave 77565, «Ring Mari Megler om neste oppdrag (TEST)»:
- Type Networking, prioritet High, ansvarlig Siri Kontor (TEST), frist 31.10/01.11.2026.
- Laget fra meglerprofilen til Mari Megler (TEST).
- Satt til In Progress, fikk én kommentar, og ble til slutt satt til Complete.
- API-et er `POST/PUT /api/v2/tasks` og `POST /api/v2/tasks/{id}/task_comments`.

### 2.3 SMS-innboksen (Conversations)

**Status: sett (låst skjerm), resten fra dokumentasjon og kode.** Ingenting er kjøpt eller sendt.

#### Hva jeg så
- `next.spectora.com/conversations/{inspectors|agents|clients}` har fanene Inspectors, Agents og Clients, og søk etter navn eller e-post («No recent conversations. Search by name or email to start or resume messaging.»).
- Vinduet **«Spectora Advanced and Custom Number Required»** sier at begge deler trengs, med lenke til kjøp av nummer.
- Åpnet jeg Mari Megler (TEST), sto det «Opted out to SMS» og «… has opted out of text messages. You can't send them SMS notifications until they opt back in.» Feltet Send var låst. Samtykke til SMS sjekkes altså per kontakt.
- På oppdragssiden har hver person (kunde og megler) et snakkeboble-ikon som åpner samtalen med den personen i en ny fane.
- I Team finnes rettigheten «Conversations Access?» per bruker.

#### Hvordan den virker (dok og kode)
- **Én tråd per kontakt.** Sendte meldinger står til høyre med tid og navnet på den som sendte. Svar står til venstre.
- **Automatiske SMS-er** fra Automations og Actions vises i samme tråd, med avsender «Auto» og en lenke til oppdraget.
- «Recent» betyr meldinger de siste 2 ukene.
- **Krav til mottaker**: mottakeren må ha nummer i feltet «Mobile Phone». For inspektører er mobilfeltet påkrevd. Appen sier «Recipient has no phone number» hvis det mangler.
- Ingen bilder kan sendes. Funksjonen finnes bare på nett, ikke i mobilappen.
- Svar på SMS sendt med «Share Details» havner ikke i innboksen.
- **Kode**:
  - Sending skjer med `POST /api/v2/text_messages` (`text`, `recipient_id`, `recipient_type`).
  - Lesing markeres med `PUT …{mark_as_read:true}`, og feltene er `sent_at`, `created_at` og `read_at`.
  - Meldinger kommer fortløpende via websocket (ActionCable, «TextMessageChannel»). Feiler den, vises «Messaging is currently unavailable».
  - Nummeret hentes fra `/api/v2/custom_phone_numbers`, som i denne kontoen er tomt.
  - Kontoen har `sms_enabled=false` og `can_customize_sms=false`.
- **Uten eget nummer** sendes SMS fra Spectoras felles nummer i Colorado, med faste maler som ikke kan endres, og svar støttes ikke.
- **Med eget nummer** kan man ha egne maler (maks 480 tegn) og videresende svar til e-post og/eller ett telefonnummer. Videresendingen tar med «likely sender» og en lenke til siste oppdrag. Man kan ikke ringe nummeret. Eget nummer krever registrering (A2P i USA) og tar noen dager.

#### Pris (dok)
- Eget nummer koster **$20/mnd**.
- Advanced koster **$4 per publisert oppdrag**.
- En inspektør koster $99/mnd eller $999/år. Kontoransatte er gratis.
- Nummer fås bare i USA, Canada, Puerto Rico og Storbritannia (fra forrige test). **Det fungerer altså ikke i Norge.**

---

## 3. Svakheter

1. **Gratisgrense som stenger alt.** Når gratisoppdragene er brukt opp, blir inspektøren inaktiv, oppdrag kan ikke lages, og oppgavelisten blir tom uten forklaring. Brukeren får ingen beskjed om hvorfor.
2. **Filterfeil i oppgavelisten.** Filteret på ansvarlig ser ut til å virke, men henter fortsatt den innloggedes oppgaver.
3. **Bare én ansvarlig**, ingen gjentakende oppgaver, ingen frist med klokkeslett, og oppgavene finnes ikke i mobilappen.
4. **Ingen automatisk oppretting av oppgaver** ut fra regler. Oppgaver er ikke en handling i Actions; der finnes bare e-post, SMS og webhook.
5. **Køen er spredt.** Den finnes bare i V9-visningen. I V10 mangler «View All Inspection Actions», og support anbefales.
6. **Import virker bare framover.** Hendelser som har skjedd, kan ikke tas igjen. Endrede regler må oppdateres separat.
7. **Meldinger langt fram i tid** blir liggende ved ny dato og må fjernes for hånd.
8. **SMS er låst til USA, Canada og Storbritannia**, krever både Advanced og et betalt nummer, og kan ikke sende bilder.
9. **Skrivefeil og blanding av V9 og V10** gir et uryddig inntrykk («Mark In Progresss»).

---

## 4. Hva dette betyr for EzProp i norsk flyt

Norsk flyt: megler bestiller tilstandsrapport før salg, Byggcon befarer, rapporten leveres til megler/selger, og faktura går fra Visma eAccounting etterpå. Betaling skjer ikke i rapportsystemet.

| Forslag | Hvorfor | Prioritet |
|---|---|---|
| **Kø per oppdrag**: én liste med alle planlagte, sendte og stoppede meldinger, med statusene planlagt, sendt, levert/åpnet, stoppet (regel ikke oppfylt) og feilet, og med knappene «send nå», «stopp» og «se melding» | Takstmannen må kunne se at megler har fått rapporten, og hvorfor noe ikke ble sendt. Dette er det beste i Spectora. | Høy |
| **Forhåndsvisning før lagring** («dette vil bli sendt»), med mulighet til å slå av enkeltmeldinger for ett oppdrag | Mange oppdrag er spesielle (dødsbo, utleie). Det er enkelt å forstå. | Høy |
| **Send på nytt bruker oppdaterte data** (ny e-post til megler) | Feil e-post til megler er vanlig. Spectora gjør dette riktig i Advanced. | Høy |
| **Ny dato** flytter automatisk alle meldinger som er knyttet til befaringsdatoen. Meldinger som ikke lenger passer, stoppes med begrunnelse. | Unngå Spectoras svakhet med meldinger som blir liggende. | Høy |
| **Nye regler gjelder også åpne oppdrag** der hendelsen ikke har skjedd, uten egen importknapp | Enklere enn Spectora. | Middels |
| **Oppgaver koblet til oppdrag og megler**, med feltene type, ansvarlig, prioritet, frist, beskrivelse og kommentarer, og statusene ny/pågår/ferdig | Typiske oppgaver: «hent egenerklæring», «purre tegninger», «følg opp megler». | Høy |
| **Oppgaver laget av regler** (f.eks. «egenerklæring ikke mottatt 2 dager før befaring → oppgave til kontoret») | Spectora mangler dette. Det ville vært en klar forbedring. | Høy |
| **Oppgaver i mobilen og på dashbordet**, med rød prikk og daglig oppsummering på e-post | Takstmenn er mye ute. | Middels |
| **Gratis kontorbrukere og tydelig beskjed** når en bruker er inaktiv | Unngå Spectoras «tom liste uten forklaring». | Middels |
| **SMS**: start med enkel utgående SMS (påminnelse om befaring og nøkler) via en norsk leverandør med eget avsendernavn, f.eks. «Byggcon». Toveis innboks kan komme senere. | Spectoras løsning virker ikke i Norge. Innboks per kontakt med automatiske meldinger i samme tråd er en god modell senere. | Lav nå, middels senere |
| **SMS-samtykke per kontakt**, og at sending stoppes hvis samtykke mangler | Personvern og markedsføringsloven. | Middels |
| **Ingen betalingslås av rapport**. Faktura via Visma etter levering. | Passer norsk flyt. Spectoras «betal for å åpne» er ikke relevant. | – |

---

## 5. Alt jeg har opprettet eller endret i kontoen

- **Ny bruker:** «Siri Kontor (TEST)», siri.kontor@example.com, som kontoransatt («support staff»). Hun er gratis, ikke admin og kan ikke slette. Ingen bekreftelses-e-post ble sendt, og passordet er tilfeldig og ikke lagret. Hun kan fjernes under Settings → Team hvis Ståle ønsker det.
- **Ny oppgave:** nr. 77565, «Ring Mari Megler om neste oppdrag (TEST)». Den er koblet til Mari Megler (TEST), har ansvarlig Siri, prioritet High og én kommentar, og status **Complete**.
- **Ikke lagret:**
  - Utfylt skjema for nytt oppdrag (Testveien 2). Det kunne ikke lagres.
  - Endringer i «Preview Actions» (bryter og veiviser), som ble avbrutt.
  - «Tasks Options», som jeg bare åpnet.
  - Meglerens «Edit»-vindu, som ble åpnet ved en feil og lukket uten lagring.
- **Ikke rørt:** testmalene, TEST A–C, merket «Aktiv selgermegler (TEST)», dashbordet «TEST megleroversikt», Testveien 1, abonnement, betaling, telefonnummer og Ståles inspektørstatus.
- Innloggingsstatusen (state.json) er slettet fra arbeidsmappen. Passordet finnes ikke i noen fil der (sjekket).

## 6. Kostnad

- **Ingenting har kostet penger.** Jeg har ikke lagt inn betalingskort, startet abonnement, kjøpt telefonnummer eller aktivert Ståle som inspektør. Den siste handlingen ville krevd et abonnement.
- Det eneste jeg la til, en kontoransatt, er gratis ifølge Spectora.
- Ingen e-post eller SMS er sendt. Firmaet kan ikke sende e-post i prøveperioden, og alle adressene er @example.com.
- **Til orientering:** Advanced-prøven har ifølge innstillingene 31 dager igjen, og kontoen har et felt `next_billing_date = 2026-12-24`. Uten betalingskort kan ingenting trekkes, men Ståle bør la prøven løpe ut eller avslutte den før den datoen.
