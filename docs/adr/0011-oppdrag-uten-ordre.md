# ADR 0011 – Oppdrag uten ordre: oppdraget eier bestillingsopplysningene

Dato: 14.11.2026. Status: vedtatt av agentene i autonom modus (A292–A299 i `docs/09-apne-sporsmal.md`); Ståle kan endre. Oppgavekort: `docs/funksjoner/fase2a-nytt-oppdrag.md`. Kilde: Ståle 13.11.2026: «Det er svært sjelden vi oppretter ordre, men stort sett går vi rett på oppdrag. Jeg ønsker at vi i utgangspunktet skal gå rett på oppdrag, men ha mulighet for å opprette ett tilbud.»

Støtter hovedmålene: **de ansatte** (ett skjema og ett trykk gir et oppdrag, uten mellomsteg), **KI i bunnen** (bestillingen ligger som egne felt med kilde på oppdraget, slik at KI senere kan foreslå akkurat disse feltene, og vernet før KI har én kilde å lese) og **færre reklamasjoner** (dublettvarselet virker på oppdraget, og riktig adresse og matrikkel står fra start).

## Beslutninger

1. **Oppdraget eier bestillingsopplysningene for alle oppdrag** (A292). `assignments` får `received_at`, `source`, `external_ref`, `ordered_by_text`, `ordered_by_contact_id`, `ordered_by_firm_id`, `address_text`, `gnr`, `bnr`, `snr`, `housing_association_name` og `seller_declaration_received`, med samme navn og regler som på `orders`. Alt som viser eller bruker dem leser fra oppdraget: arbeidskøen, søket, eiendomsforslaget, vasken før KI, avtaleforslaget, sammenslåing av kontakter og firma, tellingen i `merge-view.ts`, dublettregelen og historikken.
2. **Ingen skjult ordre.** Et oppdrag laget direkte har tom `assignments.order_id`. Det lages ingen ordrerad for å holde på opplysningene.
3. **Ordren beholder sin kopi** som «slik bestillingen kom». `convertOrderToAssignment` kopierer feltene til oppdraget i samme transaksjon. Etter det lever de to hver for seg.
4. **Én kilde for retting.** Opplysningene om et oppdrag rettes på oppdraget (`updateAssignmentBooking`). En gjort-om ordre kan fortsatt endres (Ståle T1), men det flytter ikke oppdraget (A251); ordresiden lenker til oppdraget.
5. **Migrering 0034 kopierer fra ordren inn i eksisterende oppdrag** (A293). Kobling: `orders.id = assignments.order_id` eller `orders.assignment_id = assignments.id` i samme organisasjon; ved flere brukes en ordre som ikke er slettet, og så den eldste. Oppdrag uten ordre får adressen fra eiendommen og `received_at` fra `created_at`. `row_version` og `updated_at` røres ikke.
6. **`address_text` og `received_at` er påkrevd** (A296). Finnes et oppdrag uten både ordre og eiendom med adresse, stopper migreringen før noe endres, med antallet i meldingen. `source` og `seller_declaration_received` har standardverdi; resten er valgfrie.
7. **Vern mot dobbel lagring:** `creation_key` (uuid, valgfri) med unik indeks på `(organization_id, creation_key)` (A298). Samme nøkkel to ganger gir det første oppdraget tilbake.
8. **Faste koder endres ikke** (regel 6). Kildekodene `manual` og `email`, feltkodene og dublettgrunnene er de samme som før og står nå ett sted, `src/core/assignments/booking/codes.ts`; `src/core/orders/codes.ts` gir dem videre under de gamle navnene. Nytt: hendelseskoden `assignment.booking_updated` og treff-typene `order` og `assignment`.
9. **Importretning:** det som er felles for ordre og oppdrag (koder, Zod-regler, normalisering, dublettregel, `duplicate-sql.ts`, feltliste og lesing av historikk) ligger i `src/core/assignments/booking/`. `src/core/orders` importerer derfra, aldri motsatt. Det er samme retning som i dag (ADR 0010 punkt 2).
10. **Dublettspørringen er `UNION ALL` av to delspørringer:** ordre med status `received` og oppdrag som ikke er slettet. Uttrykkene er de samme som i 0033, og `assignments` får egne uttrykksindekser i 0034. Et oppdrag fra en ordre gir dermed ett treff. Delspørringer trengs også fordi kolonnene nå har samme navn i begge tabellene.
11. **Vern mot KI:** de nye fritekst- og matrikkelkolonnene står i `NEVER_FIELDS`, og `loadKnownValues` leser kjente verdier fra oppdraget (også når `order_id` og `property_id` er tomme). Gjennomgås av sikkerhet-personvern (A175).
12. **Grensesnittet** står i `src/core/assignments/booking/contract.ts`: `CreateAssignment`, `UpdateAssignmentBooking`, `ListAssignmentBookingHistory`, `FindPossibleDuplicatesFor`, `FindPossibleDuplicatesForAssignment` og `GetNewAssignmentFormOptions`.

## Begrunnelse

- **Én lesekilde gir færre feil.** Ni steder leser bestillingen i dag. Med to kilder måtte hvert sted velge riktig, og en glipp i vasken før KI ville sendt adresse eller navn ut.
- **Kopien er ikke nye persondata.** Det er de samme opplysningene om det samme oppdraget, i samme organisasjon, med samme tilgang og samme oppbevaring. Ordren er bestillingsdokumentet; oppdraget er arbeidet.
- **Det speiler arbeidsdagen.** 98–99 av 100 oppdrag kommer uten ordre. Da må oppdraget kunne stå alene.
- **Samme navn og regler** gjør at skjemaet, valideringen, historikken og dublettregelen kan deles mellom ordre og oppdrag uten oversettelse.

## Stenger ikke for Tilbud

Neste planpunkt gjør «Ordre» om til «Tilbud». Et tilbud som gjøres om til oppdrag fyller de samme feltene gjennom `convertOrderToAssignment`. Tabellen `orders`, statusene og kodene er urørt her, så navn og flyt for tilbud kan avgjøres der uten ny migrering av oppdragene.

## Det vi vet at dette koster

- Bestillingen står to steder for oppdrag som kom fra en ordre, og de kan bli ulike etter retting. Det er ønsket (punkt 3 og 4), men må forklares på ordresiden.
- Gammel og ny verdi i revisjonsloggen gjelder nå også oppdraget (spørsmål 79 til Ståle står åpent). Verdiene ligger samlet under `values` og lages av én felles funksjon, så et nei rettes ett sted.
- `properties` og `cadastral_units` har også adresse og matrikkel når eiendommen er lagt inn. Oppdragets felt er bestillingen; eiendommen er det takstmannen har kontrollert. Køen viser eiendommens adresse når den finnes.

## Forkastet

- **Lesing med forrang** (oppdraget, ellers ordren): ni lesesteder med to kilder, vanskelig å teste, og vernet før KI kan glippe. Hvem som «eier» en verdi blir uklart ved retting.
- **Skjult ordre** bak hvert direkte oppdrag: to rader og to nummer for én ting, en ordreliste full av rader ingen har laget, og Tilbud ville arvet et begrep som ikke betyr tilbud.
- **Eiendom med en gang** (lagre adressen i `properties` ved oppretting): krever boligtype og eierform i skjemaet (påkrevde kolonner), altså flere felt og trykk for kontoret, og opplysninger kontoret ofte ikke har.
- **Egen tabell `assignment_bookings`:** én-til-én med oppdraget, en join på hver lesing og en ny tabell i tenant-testene, uten gevinst.
- **Flytte opplysningene** (fjerne dem fra ordren): ordren mister «slik bestillingen kom», ordresiden og T1 måtte bygges om, og Tilbud ville manglet feltene sine.
- **Alle nye kolonner valgfrie:** et oppdrag uten adresse kan ikke takseres eller sjekkes for dublett.
- **Vern mot dobbel lagring bare i skjermen** (låst knapp): holder ikke ved ustabilt nett på iPad, der samme innsending kan komme to ganger.

## Følger

- Migrering `0034_oppdrag-bestilling` (prøvd mot en database med oppdrag fra ordre, oppdrag med bare eiendom og oppdrag uten begge).
- Ingen ny tabell og ingen ny avhengighet. `tests/tenant-tables.ts` er uendret.
- `tests/factories.ts` setter oppdiktet adresse på oppdrag som lages direkte i tester.
- **Dyrt å endre:** punkt 1, 5 og 6 (datamodell, atferd og databaseregel). **Lett å endre:** punkt 7, 10 og grensesnittet.
