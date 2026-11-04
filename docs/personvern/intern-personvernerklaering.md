# Intern personvernerklæring for EzProp

**Utkast, ikke godkjent av Ståle.** Dato: 04.11.2026.

- **Fase:** Minimum før ekte data
- **Støtter hovedmål:** Reklamasjoner (rapporter, bilder og logg finnes i 10 år når en sak kommer) og KI først (agentene har laget utkastet ut fra koden, daglig leder leser og godkjenner).

## Hva dette er

Dette er en kort, intern oversikt over hvilke personopplysninger EzProp lagrer, hvorfor, hvor og hvor lenge. Den gjelder EzProp slik systemet er i betaen, før ekte oppdrag legges inn. Den beskriver det koden gjør i dag (`src/db/schema`, filtjenesten, innloggingssperren og revisjonsloggen), ikke det vi har tenkt å bygge, med mindre det står «foreslått».

Byggcon eier personvernarbeidet. Kontaktperson for personvern er **rollen daglig leder** (A56, svar 25.10.2026 nr. 25).

Dokumentet er ikke juridisk rådgivning. Det dekker ikke rettslig grunnlag, behandlingsprotokoll, databehandleravtaler eller erklæring til kunder. Det kommer i fase 4 eller som egne punkter i planen.

## Tabellene

Én rad per tabell i `src/db/schema` (22 tabeller etter PR #82). Alle tabeller med `organization_id` filtreres på organisasjonen fra tilgangssjekken, så ansatte ser bare egen organisasjon. «Admin» betyr rettigheten `organization.manage`, «leder og admin» betyr `staff.manage`.

| Tabell | Hva | Formål | Hvor | Hvor lenge | Hvem ser det |
|---|---|---|---|---|---|
| `users` | Navn, e-postadresse, om e-posten er bekreftet, bilde (tomt i dag), siste innlogging | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: beholdes så lenge den ansatte står på rapporter (minst 10 år) | Brukeren selv; admin via ansattlisten |
| `sessions` | IP-adresse, nettleser og enhet (user agent), bruker, utløpstid | Holde den ansatte innlogget | Database | Nå i koden: økten gjelder 30 dager og forlenges når den brukes (høyst én gang per døgn). Tabellen har ikke myk sletting. Better Auth sletter raden helt ved utlogging, ved «logg ut andre økter» og når en utløpt økt slås opp. Utløpte økter som aldri slås opp igjen, blir liggende; ingen rydding er bygd. Se spørsmål nr. 18 | Ingen skjerm; bare drift med databasetilgang |
| `accounts` | Kobling mellom bruker og innloggingsmåte. Feltene for passord og nøkler fra andre tjenester er tomme, siden vi bare bruker engangskode på e-post | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: som `users` | Ingen skjerm |
| `verifications` | E-postadresse og innloggingskoden (lagret som hash, ikke i klartekst), utløpstid | Sende og sjekke innloggingskoden | Database | Nå i koden: koden gjelder i 10 minutter. Tabellen har ikke myk sletting. Better Auth sletter koden helt når den er brukt, når den har gått ut og blir prøvd, etter 3 feil forsøk og når en ny kode bestilles. Koder som aldri prøves, blir liggende; ingen rydding er bygd. Se spørsmål nr. 18 | Ingen skjerm |
| `login_attempts` | E-postadressen som HMAC (ikke i klartekst), type forsøk, tidspunkt. Gjelder også fremmede som prøver å logge inn | Sperre innlogging etter mange feil koder | Database | Nå i koden: sperrevinduet er 15 minutter. Radene ligger til de ryddes, rydding er ikke bygd. Foreslått, bygges senere: slettes etter 24 timer (spørsmål nr. 15) | Ingen skjerm |
| `organizations` | Ingen personopplysninger (navn på organisasjonen, innstillinger) | Skille data mellom organisasjoner | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte i organisasjonen; admin endrer |
| `companies` | Ingen personopplysninger (selskapsnavn, organisasjonsnummer, adresse, forsikring) | Utsteder rapporten | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `offices` | Ingen personopplysninger (kontornavn og adresse) | Plassere ansatte | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `employees` | Navn, stillingstittel, selskap, kontor, kobling til bruker, når den ansatte sluttet | Vite hvem som jobber og står på rapporten | Database | Nå i koden: myk sletting; «Har sluttet» stopper innlogging, men raden blir stående. Foreslått, bygges senere: minst 10 år etter siste rapport | Bare admin ser listen og endrer (`organization.manage`) |
| `employee_roles` | Hvilke roller den ansatte har | Styre tilgang | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `employee_permissions` | Enkeltrettigheter gitt til den ansatte | Styre tilgang | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `certifications` | Sertifiseringsområde, utsteder, sertifikatnummer, gyldig fra og til | Bare sertifiserte kan publisere rapport | Database | Nå i koden: myk sletting; fornyelse er ny rad, den gamle blir stående som historikk | Admin |
| `files` | Metadata om filen (type, størrelse, sjekksum, hvem som lastet opp). Selve filen ligger i fillagringen og kan være bilder med personer eller adresser | Lagre bilder og dokumenter trygt | Database og fillagring | Nå i koden: myk sletting, filinnholdet blir liggende. `retain_until` er ikke regnet ut ennå (fase 2). Foreslått, bygges senere: se «Hvor lenge» | Alle ansatte i organisasjonen; admin merker som slettet |
| `events` | Hendelser på oppdrag, hvem som gjorde det, tidspunkt, detaljer uten mer personopplysninger enn nødvendig | Rutiner og varsler | Database | Nå i koden: endres og slettes aldri, heller ikke mykt | Ingen skjerm ennå |
| `audit_log` | Hvem som endret hva og når, gammel og ny verdi (aldri passord eller nøkler), enhet | Spore endringer, viktig ved reklamasjon | Database | Nå i koden: ryddes aldri | Leder og admin |
| `integration_connections` | Ingen personopplysninger (tilkoblinger til andre systemer; bare navnet på hemmeligheten, aldri verdien) | Koble til e-post og andre tjenester | Database | Nå i koden: myk sletting, ingen rydding | Admin |
| `trial_forms` | Navn på testskjemaet (oppdiktet), hvem som laget det | Prøven uten nett i fase 1 | Database og iPaden | Nå i koden: myk sletting. Eneste unntak fra regelen om myk sletting fordi dataene er oppdiktede (merknaden 28.10.2026, ikke presedens), se sletteregelen | Alle ansatte i organisasjonen |
| `trial_answers` | Oppdiktede svar, fast id per nettleser-installasjon | Prøven uten nett i fase 1 | Database og iPaden | Som `trial_forms` | Alle ansatte i organisasjonen |
| `trial_photos` | Bilder fra prøven (filnavn, størrelse, sjekksum), fast id per nettleser. Bildefilen lastes opp uendret og kan ha posisjon fra iPaden | Prøven uten nett i fase 1 | Database, fillagring og iPaden | Som `trial_forms` | Alle ansatte i organisasjonen |
| `orders` | Bestillingen slik den kom inn: adresse, gnr/bnr/snr, borettslag, bestiller som tekst, ekstern referanse, status og grunn ved avvisning. Kan inneholde navn og adresse til kunder | Ta imot og fordele oppdrag | Database | Nå i koden: myk sletting; en avvist ordre blir stående (A55). Foreslått, bygges senere: minst 10 år | Ansatte med `assignment.edit` i organisasjonen |
| `assignments` | Oppdraget: oppdragsnummer, type, status, kontor, kobling til ordren | Lage og levere rapporten | Database | Nå i koden: myk sletting. Foreslått, bygges senere: minst 10 år | Ansatte med `assignment.edit` i organisasjonen |
| `number_sequences` | Nummerserien for oppdragsnummer (prefiks, siste nummer). Ingen personopplysninger | Unike oppdragsnummer | Database | Nå i koden: telleren blir stående, ingen sletting (heller ikke myk) | Ingen skjerm |
| *Kommer senere i fase 2a: parter, eiendom, bilder, egenerklæring* | Opplysninger om kunder, eiere, kjøpere og eiendommen, og bilder fra befaringen | Lage og levere rapporten | Database og fillagring, utkast på iPaden | Foreslått, bygges senere: minst 10 år (Ståle 25.10 og 27.10.2026), med myk sletting | Alle ansatte (`access.inspectors_edit_all`); reklamasjonssaker bare leder og admin |

## Hvor

- **Database og fillagring:** Azure, region Sweden Central (EU/EØS). Fillagring i Azure Blob Storage er bygd i koden, men ikke slått på ennå; til da ligger filene i en lokal mappe på serveren.
- **E-post:** innloggingskoder sendes via Microsoft 365. Til det er koblet til, vises koden i utviklingspostkassen lokalt eller i serverloggen for første admin.
- **iPaden:** i nettleserens database (IndexedDB, `src/modules/offline-trial/sync`). Utkast og bilder ligger der til de er synket. Originalbildet slettes fra iPaden når serveren har bekreftet det; svarene og visningskopiene blir liggende.

## iPaden

Lokal lagring tømmes **ikke** ved utlogging i dag. Utloggingsknappen avslutter bare økten. Funksjonene som tømmer iPaden (bilder, synklagringen og «Lagret kl.», se `clearIfOtherOrganization`) kalles bare når en person fra en annen organisasjon logger inn på samme iPad (`select-store.ts`).

Ved tapt iPad finnes ingen fjernsletting og ingen knapp for å stoppe økten. Det som virker i dag:

- Admin markerer den ansatte som «Har sluttet». Da sier tilgangssjekken nei, men dataene på iPaden blir liggende.
- Noen med databasetilgang sletter øktraden i `sessions`.
- Ellers går økten ut etter 30 dager uten bruk.

Hva som skal gjelde, er åpent spørsmål nr. 17.

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

Hvordan prøvedata fra betaen merkes og ryddes, står i [sletting-av-betadata.md](sletting-av-betadata.md). Kort: prøvedata ligger i en egen prøveorganisasjon (A57), bare admin rydder, og admin-brukeren og admins ansatt-rad myk-slettes aldri (A59).
