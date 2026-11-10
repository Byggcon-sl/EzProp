# Intern personvernerklæring for EzProp

**Utkast, ikke godkjent av Ståle.** Dato: 04.11.2026, sist endret 05.11.2026 (kontakter og firma; partene og bestilleren koblet til kontakter; fjerne og slå sammen kontakter og firma).

- **Fase:** Minimum før ekte data
- **Støtter hovedmål:** Reklamasjoner (rapporter, bilder og logg finnes i 10 år når en sak kommer) og KI først (agentene har laget utkastet ut fra koden, daglig leder leser og godkjenner).

## Hva dette er

Dette er en kort, intern oversikt over hvilke personopplysninger EzProp lagrer, hvorfor, hvor og hvor lenge. Den gjelder EzProp slik systemet er i betaen, før ekte oppdrag legges inn. Den beskriver det koden gjør i dag (`src/db/schema`, filtjenesten, innloggingssperren og revisjonsloggen), ikke det vi har tenkt å bygge, med mindre det står «foreslått».

Byggcon eier personvernarbeidet. Kontaktperson for personvern er **rollen daglig leder** (A56, svar 25.10.2026 nr. 25).

Dokumentet er ikke juridisk rådgivning. Det dekker ikke rettslig grunnlag, behandlingsprotokoll, databehandleravtaler eller erklæring til kunder. Det kommer i fase 4 eller som egne punkter i planen.

## Tabellene

Én rad per tabell i `src/db/schema` (29 tabeller etter kontakter og firma i fase 2a. Radene for `properties`, `cadastral_units` og `common_areas` fra PR #91 mangler ennå og legges inn som egen liten oppgave). Alle tabeller med `organization_id` filtreres på organisasjonen fra tilgangssjekken, så ansatte ser bare egen organisasjon. «Admin» betyr rettigheten `organization.manage`, «leder og admin» betyr `staff.manage`.

| Tabell | Hva | Formål | Hvor | Hvor lenge | Hvem ser det |
|---|---|---|---|---|---|
| `users` | Navn, e-postadresse, om e-posten er bekreftet, bilde (tomt i dag), siste innlogging | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: beholdes så lenge den ansatte står på rapporter (minst 10 år) | Brukeren selv; admin via ansattlisten |
| `sessions` | IP-adresse, nettleser og enhet (user agent), bruker, utløpstid | Holde den ansatte innlogget | Database | Nå i koden: økten gjelder 30 dager og forlenges når den brukes (høyst én gang per døgn). Tabellen har ikke myk sletting. Better Auth sletter raden helt ved utlogging, ved «logg ut andre økter» og når en utløpt økt slås opp. Utløpte økter som aldri slås opp igjen, blir liggende; ingen rydding er bygd. Se spørsmål nr. 18 | Ingen skjerm; bare drift med databasetilgang |
| `accounts` | Kobling mellom bruker og innloggingsmåte. Feltene for passord og nøkler fra andre tjenester er tomme, siden vi bare bruker engangskode på e-post | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: som `users` | Ingen skjerm |
| `verifications` | E-postadresse og innloggingskoden (lagret som hash, ikke i klartekst), utløpstid | Sende og sjekke innloggingskoden | Database | Nå i koden: koden gjelder i 10 minutter. Tabellen har ikke myk sletting. Better Auth sletter koden helt når den er brukt, når den har gått ut og blir prøvd, etter 3 feil forsøk og når en ny kode bestilles. Koder som aldri prøves, blir liggende; ingen rydding er bygd. Se spørsmål nr. 18 | Ingen skjerm |
| `login_attempts` | E-postadressen som HMAC (ikke i klartekst), type forsøk, tidspunkt. Gjelder også fremmede som prøver å logge inn | Sperre innlogging etter mange feil koder | Database | Nå i koden: sperrevinduet er 15 minutter. Radene ligger til de ryddes, rydding er ikke bygd. Foreslått, bygges senere: slettes etter 24 timer (spørsmål nr. 15) | Ingen skjerm |
| `organizations` | Ingen personopplysninger (navn på organisasjonen, innstillinger) | Skille data mellom organisasjoner | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte i organisasjonen; admin endrer |
| `companies` | Normalt ingen personopplysninger; navnet på et enkeltpersonforetak kan være et personnavn, og det vises på oppdraget (selskapsnavn, organisasjonsnummer, adresse, forsikring) | Utsteder rapporten | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `offices` | Ingen personopplysninger (kontornavn og adresse) | Plassere ansatte | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `employees` | Navn, stillingstittel, selskap, kontor, kobling til bruker, når den ansatte sluttet | Vite hvem som jobber og står på rapporten | Database | Nå i koden: myk sletting. «Har sluttet» (`deactivatedAt`) gjør at tilgangssjekken sier nei (`src/core/access/guards.ts`), og raden blir stående. Innloggingen og økten virker fortsatt, men uten tilgang til noe; se «iPaden». Foreslått, bygges senere: minst 10 år etter siste rapport | Alle ansatte i organisasjonen ser navn, stillingstittel, selskap og kontor (`listEmployees`, `organization.read`). Bare admin ser e-postadressen og endrer (`organization.manage`) |
| `employee_roles` | Hvilke roller den ansatte har | Styre tilgang | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `employee_permissions` | Enkeltrettigheter gitt til den ansatte | Styre tilgang | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `certifications` | Sertifiseringsområde, utsteder, sertifikatnummer, gyldig fra og til | Bare sertifiserte kan publisere rapport | Database | Nå i koden: myk sletting; fornyelse er ny rad, den gamle blir stående som historikk | Admin |
| `files` | Metadata om filen (type, størrelse, sjekksum, hvem som lastet opp). Selve filen ligger i fillagringen og kan være bilder med personer eller adresser | Lagre bilder og dokumenter trygt | Database og fillagring | Nå i koden: myk sletting, filinnholdet blir liggende. `retain_until` er ikke regnet ut ennå (fase 2). Foreslått, bygges senere: se «Hvor lenge» | Alle ansatte i organisasjonen; admin merker som slettet |
| `events` | Hendelser på oppdrag, hvem som gjorde det, tidspunkt, detaljer uten mer personopplysninger enn nødvendig. Unntak: grunnen ved statusendring tilbake og ved kansellering av oppdrag er fritekst (se «Fritekst i hendelsene») | Rutiner og varsler | Database | Nå i koden: endres og slettes aldri, heller ikke mykt | Ingen skjerm ennå |
| `audit_log` | Hvem som endret hva og når, og enhet. Loggen lagrer feltnavn, id-er og statusendringer, ikke e-postadresse, sertifikatnummer, passord eller nøkler. Unntak: grunnen ved avvist ordre (`rejectedReason`) lagres som den ble skrevet. Den er fritekst og kan inneholde personopplysninger. For parter og team lagres bare feltnavn, rolle og hva parten mottar, aldri navn, firma, e-post, telefon eller grunnen ved bytte. Fra fase 2a har loggen også én linje per avgjort eller angret KI-forslag (godtatt, endret, avvist, angret), med hvem som gjorde det og gammel og ny status, aldri forslagsteksten eller feltverdier. Leder og admin kan lese linjene; det tas med når målingen drøftes med de ansatte (spørsmål 57) | Spore endringer, viktig ved reklamasjon | Database | Nå i koden: ryddes aldri | Leder og admin |
| `integration_connections` | Ingen personopplysninger (tilkoblinger til andre systemer; bare navnet på hemmeligheten, aldri verdien) | Koble til e-post og andre tjenester | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `ai_usage_log` | Én rad per KI-kall: hvem som ba om forslaget (`employee_id`), hvem som godtok, endret eller avviste det og når (`decided_by`, `decided_at`), forslagsteksten fra KI (`output_text`), hvilke felt som var grunnlaget (bare feltkoder) og antall tegn per felt (`input_summary`, aldri teksten), funksjon, leverandør, modell, utfall, mengde og kostnad. Forslagsteksten kan inneholde noe som slapp gjennom vasken. Navn, e-post, telefon, adresse og matrikkel sendes aldri til KI (tillatt-liste per funksjon). I dag brukes bare den falske leverandøren `fake`, så ingenting sendes ut | KI-forslag som den ansatte kontrollerer og godkjenner, og sporbarhet ved reklamasjon (hvem godtok hva, og når) | Database | Nå i koden: myk sletting, ryddes aldri. `retain_until` settes til opprettet + 10 år (A157, spørsmål 56) | Ingen skjerm. Ingen tall eller lister per ansatt (spørsmål 57) |
| `trial_forms` | Navn på testskjemaet (skulle være oppdiktet), hvem som laget det | Prøven uten nett i fase 1 | Database og iPaden | Nå i koden: bare myk sletting. Foreslått, bygges senere: slettes helt sammen med bildefilene, som eneste unntak fra regel 3, fordi tabellene skulle inneholde oppdiktede data (merknaden 28.10.2026). Unntaket er ikke presedens for andre tabeller. Se sletteregelen | Alle ansatte i organisasjonen |
| `trial_answers` | Svar i fritekst (skulle være oppdiktede, men kan inneholde det den ansatte skrev), fast id per nettleser-installasjon (`device_id`) | Prøven uten nett i fase 1 | Database og iPaden | Som `trial_forms` | Alle ansatte i organisasjonen |
| `trial_photos` | Bilder fra prøven (filnavn, størrelse, sjekksum, plassering i fillagringen `storage_path`), fast id per nettleser (`device_id`). Dette er ekte kamerabilder. Bildefilen lastes opp uendret og kan ha posisjon (GPS) fra iPaden | Prøven uten nett i fase 1 | Database, fillagring og iPaden | Som `trial_forms` | Alle ansatte i organisasjonen |
| `orders` | Bestillingen slik den kom inn: adresse, gnr/bnr/snr, borettslag, bestiller som tekst, ekstern referanse, status og grunn ved avvisning. Bestilleren kan i tillegg kobles til en kontakt i registeret (`ordered_by_contact_id`, `ordered_by_firm_id`; bare id-er). Kan inneholde navn og adresse til kunder | Ta imot og fordele oppdrag | Database | Nå i koden: myk sletting; en avvist ordre blir stående (A55). Foreslått, bygges senere: minst 10 år | Alle ansatte i organisasjonen ser ordrene (`listOrders` og `getOrder`, `organization.read`). Bare ansatte med `assignment.edit` legger inn, avviser og gjør om til oppdrag |
| `assignments` | Oppdraget: oppdragsnummer, type, status, kontor, kobling til ordren, utstedende selskap (settes fra ansvarlig takstmann, A65) | Lage og levere rapporten | Database | Nå i koden: myk sletting. Foreslått, bygges senere: minst 10 år | Alle ansatte i organisasjonen ser oppdragsnummeret i ordrelisten (`organization.read`). Bare ansatte med `assignment.edit` lager oppdrag (fra en ordre). Egen oppdragsliste finnes ikke ennå |
| `number_sequences` | Nummerserien for oppdragsnummer (prefiks, siste nummer). Ingen personopplysninger | Unike oppdragsnummer | Database | Nå i koden: telleren blir stående, ingen sletting (heller ikke myk) | Ingen skjerm |
| `assignment_parties` | Partene på oppdraget: rolle (megler, selger, kjøper, representant, fakturamottaker), navn, firma, e-post, telefon og hva parten mottar. En part kan kobles til en kontakt i registeret (`contact_id`, `firm_id`; bare id-er). Navn, firma, e-post og telefon på parten er en kopi fra da parten ble lagret, og endres ikke når kontakten endres. Personopplysninger om kunder og andre utenfor Byggcon. Fødselsnummer stoppes i skjemaet | Levere rapport og faktura til riktig mottaker | Database | Nå i koden: myk sletting (`deleted_at`/`deleted_by`). Foreslått, bygges senere: minst 10 år | Alle ansatte i organisasjonen ser (`organization.read`). Bare ansatte med `assignment.edit` legger til, endrer og fjerner |
| `assignment_team_members` | Hvilken ansatt som hadde hvilken rolle på oppdraget, fra og til, og grunnen ved bytte (fritekst, høyst 300 tegn). Skjermen ber om at det ikke skrives helseopplysninger i grunnen (A64) | Vite hvem som hadde ansvaret, viktig ved reklamasjon | Database | Nå i koden: slettes aldri; et bytte avslutter raden med `to_at` og lager en ny | Alle ansatte i organisasjonen ser (`organization.read`). Bare ansatte med `assignment.edit` endrer |
| `firms` | Firmaregisteret: navn, organisasjonsnummer, type (meglerforetak, forsikringsselskap, sameie eller borettslag, annet) og et kort notat. Ikke personopplysninger i seg selv, men notatet kan nevne personer. Skjermen ber om at det ikke skrives helseopplysninger eller fødselsnummer, og 11 sifre på rad stoppes | Kontakt med meglerforetak og andre bestillere om oppdrag; ett firma per organisasjonsnummer | Database | Nå i koden: myk sletting (`deleted_at`). Leder og admin kan fjerne et firma eller slå sammen to like firma (`contacts.manage`). Begge deler er myk sletting: raden blir stående, og kontaktene i firmaet beholdes. Foreslått, bygges senere: minst 10 år som resten | Alle ansatte i organisasjonen ser (`listFirms` og `getFirm`, `organization.read`). Bare ansatte med `assignment.edit` legger inn og endrer. Sendes aldri til KI |
| `contacts` | Personer utenfor Byggcon, for eksempel meglere: fornavn, etternavn, e-post, telefon, firma, kort notat og **kilde** (`source`: lagt inn for hånd eller fra en ordre), slik at vi kan svare den det gjelder om hvor opplysningene kom fra (D17). Fødselsnummer stoppes i skjemaet, og skjemaet ber om at notatet ikke har helseopplysninger | Kontakt med meglere og bestillere om oppdrag. Brukes ikke til markedsføring; samtykke til markedsføring lagres ikke ennå | Database | Nå i koden: myk sletting (`deleted_at`). Leder og admin kan fjerne en kontakt eller slå sammen to like kontakter (`contacts.manage`). Begge deler er myk sletting: raden blir stående, og ved sammenslåing flyttes koblingene på parter og ordrer til kontakten som beholdes. Foreslått, bygges senere: minst 10 år som resten | Alle ansatte i organisasjonen ser (`listContacts` og `getContact`, `organization.read`). Bare ansatte med `assignment.edit` legger inn og endrer. Sendes aldri til KI |
| `claims` | Reklamasjonssaker på et oppdrag: type, når kravet kom, hvem som klaget (en part på oppdraget som id, eller fritekst `claimant_text`), kort beskrivelse (`description`), kontrollpunkt eller bygningsdel (`building_part_text`), utfall, beløp og hvem som registrerte saken. De tre fritekstfeltene kan inneholde navn på kunder og andre utenfor Byggcon, og i verste fall helseopplysninger (for eksempel plager etter fukt eller muggsopp). Skjemaet ber om at det ikke skrives fødselsnummer eller helseopplysninger, og elleve sifre på rad stoppes. Fritekstene står aldri i revisjonsloggen eller i hendelsene; loggen får bare handling og feltnavn, og hendelsen `claim.registered` bare id-er, type og dato | Registrere reklamasjoner for å måle og redusere dem (hovedmål 2: halvparten så mange reklamasjoner per 100 leverte rapporter) | Database | Nå i koden: myk sletting (`deleted_at`); fjernede saker vises ikke, raden blir stående. Oppbevares i 10 år som oppdragsdata | Bare leder og admin (`claims.read` for å se, `claims.manage` for å endre). Takstmenn og kontor ser dem ikke, heller ikke med `access.inspectors_edit_all`. Sendes ikke til KI |
| `work_sessions` | Arbeidsøkter: oppdrag, ansatt, fase, start og slutt | Måle tid per oppdrag og fase mot IVIT (hovedmålet) | Database | Nå i koden: myk sletting, ingen rydding | Leder og admin, bare samlet per fase, aldri per person (se «Tidsmåling») |
| *Kommer senere i fase 2a: eiendom, bilder, egenerklæring* | Opplysninger om kunder, eiere, kjøpere og eiendommen, og bilder fra befaringen | Lage og levere rapporten | Database og fillagring, utkast på iPaden | Foreslått, bygges senere: minst 10 år (Ståle 25.10 og 27.10.2026), med myk sletting | Alle ansatte (`access.inspectors_edit_all`); reklamasjonssaker bare leder og admin |

## Kobling mellom oppdrag, ordre og kontakter

Partene på oppdraget og bestilleren på ordren kan kobles til en kontakt i kontaktregisteret (fase 2a, 05.11.2026). Koblingen er valgfri; en part eller bestiller kan fortsatt bare være fritekst, for eksempel en kjøper som ikke skal inn i registeret.

- **Bare egen organisasjon.** Databasen stopper en kobling til en kontakt eller et firma i en annen organisasjon (sammensatte fremmednøkler med `organization_id`), og søket i kontakter viser bare egen organisasjon.
- **Bare id-er i loggene.** Revisjonsloggen får id-ene til kontakten og firmaet, aldri navn, e-post eller telefon. Hendelsene for partene har bare id-en og rollen til parten. Søkeordet og skjemaverdiene skrives ikke til serverloggen.
- **Aldri til KI.** Kontaktdata, koblingene og treffene fra søket sendes aldri til KI. Søket skjer i vår egen database.
- **Fjerne og slå sammen (05.11.2026).** Bare leder og admin. Ingenting slettes permanent; kontakten eller firmaet får `deleted_at` og vises ikke lenger i lister og søk. Revisjonsloggen (`contact.removed`, `firm.removed`, `contact.merged`, `firm.merged`) får bare id-er og antall flyttede rader, aldri navn, e-post, telefon, notat eller organisasjonsnummer. Mislykkede forsøk logges ikke.

## Fritekst i hendelsene

Når et oppdrag flyttes ett steg tilbake i status, eller kanselleres, må den ansatte skrive en grunn (høyst 500 tegn). Grunnen er fritekst og lagres i hendelsene (`assignment.status_changed` og `assignment.cancelled` i `events`), ikke i revisjonsloggen. Hendelsene endres og slettes aldri, og oppdragsdata oppbevares i 10 år. Derfor skal det **ikke skrives personopplysninger** i grunnen, for eksempel navn på kunder, helse eller fødselsnummer. Skriv hva som skjedde med oppdraget, for eksempel «Trykket feil» eller «Kunden har avbestilt». Hendelsene vises ikke på noen skjerm ennå.

## Hvor

- **Database og fillagring:** Azure, region Sweden Central (EU/EØS). Fillagring i Azure Blob Storage er bygd i koden, men ikke slått på ennå; til da ligger filene i en lokal mappe på serveren.
- **E-post:** innloggingskoder sendes via Microsoft 365. Til det er koblet til, vises koden i utviklingspostkassen lokalt eller i serverloggen for første admin.
- **Serverloggen:** Azure App Service samler loggen fra serveren (`src/shared/lib/logger.ts`). Den har bruker-id, rute og referansekode, ikke e-postadresse eller telefonnummer (loggeren vasker dem bort). Unntak: til Microsoft 365 er koblet til, står engangskoden til første admin i klartekst i loggen (`src/core/email/server-log.ts`). Koden gjelder i 10 minutter. Hvor lenge loggen lagres, er ikke satt ennå.
- **iPaden:** i nettleserens database (IndexedDB, `src/modules/offline-trial/sync`). Utkast og bilder ligger der til de er synket. Originalbildet slettes fra iPaden når serveren har bekreftet det; svarene og visningskopiene blir liggende.

## iPaden

Lokal lagring tømmes **ikke** ved utlogging i dag. Utloggingsknappen avslutter bare økten. Funksjonene som tømmer iPaden (bilder, synklagringen og «Lagret kl.», se `clearIfOtherOrganization`) kalles bare når en person fra en annen organisasjon logger inn på samme iPad (`select-store.ts`).

Ved tapt iPad finnes ingen fjernsletting og ingen knapp for å stoppe økten. Det som virker i dag:

- Admin markerer den ansatte som «Har sluttet» (`deactivatedAt`). Da sier tilgangssjekken nei (`src/core/access/guards.ts`). Innloggingen og økten virker fortsatt, men uten tilgang. En synknøkkel som allerede er utstedt, virker i opptil 1 time (`SYNC_TOKEN_TTL_SECONDS`). Dataene på iPaden blir liggende.
- Noen med databasetilgang sletter øktraden i `sessions`.
- Ellers går økten ut etter 30 dager uten bruk.

Sperring av en mistet iPad er allerede et punkt i planen under «Minimum før ekte data» (`docs/07-utviklingsplan.md`), og skal være på plass før første ekte befaring på iPad i fase 2b. Det som er åpent, er bare om iPaden skal tømmes ved utlogging (spørsmål nr. 17).

## Ikke kontroll av ansatte

EzProp lagrer noen opplysninger om hva den enkelte ansatte gjør: IP-adresse og enhet (`sessions`), siste innlogging (`users`), revisjonsloggen (`audit_log`), hendelser (`events`) og fast id per nettleser (`device_id` i `trial_*`). Disse brukes bare til innlogging, sikkerhet og oppfølging av reklamasjoner. De brukes ikke til å måle tid eller følge med på den enkelte ansatte.

Tiden måles bare i `work_sessions` (se «Tidsmåling» under), og den brukes bare samlet per fase, ikke per person. Det samme står i `docs/06-arkitektur.md`, avsnittet «Personvern og sikkerhet».

## Tidsmåling

Bygget i fase 2a (06.11.2026), oppgavekort `docs/funksjoner/fase2a-tidsmaling.md`, beslutningene A119–A124. Formålet er å se om EzProp gir 50 % mindre tid per rapport enn IVIT (hovedmålet 28.10.2026).

- **Hva som lagres:** i tabellen `work_sessions` lagres oppdraget, den ansatte, fasen (forberedelse, befaring, kontorarbeid eller levering), og når økten startet og sluttet. Ikke hva personen gjorde, ikke hvilken side, ikke IP-adresse eller enhet.
- **Hvordan:** tiden måles av seg selv når den ansatte har oppdragssiden eller bygningssiden åpen og er aktiv. Pause over 10 minutter avslutter økten. Den ansatte fører ingen timer.
- **Hvem ser det:** bare leder og admin, på siden `/statistikk/tid`, og bare samlet per fase for ferdige og fakturerte oppdrag. Det finnes ingen visning, filter eller eksport per person, og den ansatte vises aldri i statistikken.
- **Av og på:** admin kan slå målingen av med bryteren «Mål tid». Da lagres ingen nye økter. Økter som allerede er lagret, blir liggende.
- **Hvor lenge:** som andre data etter vanlig regel. Økter slettes bare mykt (`deleted_at`), og ingen funksjon sletter dem permanent.
- **Viktig i betaen:** med bare én takstmann er «samlet» i praksis tallene til én person (Ståle, som selv er med i målingen, A121). Før flere ansatte tas med i målingen, skal den drøftes med de ansatte (arbeidsmiljøloven kapittel 9). Bruk av tallene per person krever enighet med de ansatte først.

## Hvor lenge

**Nå i koden:**

- Økt: 30 dager (`src/core/auth/auth.ts`).
- Innloggingskode: 10 minutter (`src/core/auth/otp-email.ts`).
- Sperrevindu for innlogging: 15 minutter (`src/core/auth/login-throttle.ts`).
- `login_attempts`: radene blir liggende, rydding er ikke bygd (spørsmål nr. 15).
- `sessions` og `verifications`: Better Auth sletter rader helt (se tabellen). Det som blir liggende, er utløpte økter som aldri slås opp igjen og koder som aldri prøves (spørsmål nr. 18).
- `audit_log` og `events` ryddes aldri (A58).
- Myk sletting (`deleted_at`) gjelder alle tabeller med `baseColumns` (`src/db/schema/common.ts`). Innloggingstabellene `users`, `sessions`, `accounts`, `verifications` og `login_attempts` har ikke `deleted_at`.
- **Kjent unntak fra regel 3 (ingenting slettes permanent):** Better Auth sletter rader helt i `sessions` og `verifications`. Det er innloggingsdata, ikke rapportdata. Om unntaket skal godtas, er en del av spørsmål nr. 18. Appens egen kode sletter ikke rader permanent.
- Oppbevaringstidene for filer står som innstillinger (`src/core/files/retention.ts`): avviksbilder i original 10 år, andre originaler 2 år, komprimerte kopier 10 år. Fristen (`retain_until`) regnes ikke ut ennå, så i dag ryddes ingen filer.

**Foreslått, bygges senere:**

- Rapporter, bilder og måledata: minst 10 år (Ståle 25.10 og 27.10.2026), med filtidene over.
- Innloggingsforsøk: 24 timer (spørsmål nr. 15).
- Utløpte økter og koder: avgjøres i spørsmål nr. 18.

## Prøvedata

Hvordan prøvedata fra betaen merkes og ryddes, står i [sletting-av-betadata.md](sletting-av-betadata.md). Kort: prøvedata ligger i en egen prøveorganisasjon (A57), bare admin rydder, og oppryddingen myk-sletter aldri ansatt-raden som gir admin tilgang til den ekte organisasjonen eller siste admin i prøveorganisasjonen (A59).
