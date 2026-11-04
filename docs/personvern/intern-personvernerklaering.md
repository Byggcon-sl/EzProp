# Intern personvernerklæring for EzProp

**Utkast, ikke godkjent av Ståle.** Dato: 04.11.2026.

- **Fase:** Minimum før ekte data
- **Støtter hovedmål:** Reklamasjoner (rapporter, bilder og logg finnes i 10 år når en sak kommer) og KI først (agentene har laget utkastet ut fra koden, daglig leder leser og godkjenner).

## Hva dette er

Dette er en kort, intern oversikt over hvilke personopplysninger EzProp lagrer, hvorfor, hvor og hvor lenge. Den gjelder EzProp slik systemet er i betaen, før ekte oppdrag legges inn. Den beskriver det koden gjør i dag (`src/db/schema`, filtjenesten, innloggingssperren og revisjonsloggen), ikke det vi har tenkt å bygge, med mindre det står «foreslått».

Byggcon eier personvernarbeidet. Kontaktperson for personvern er **rollen daglig leder** (A56, svar 25.10.2026 nr. 25).

Dokumentet er ikke juridisk rådgivning. Det dekker ikke rettslig grunnlag, behandlingsprotokoll, databehandleravtaler eller erklæring til kunder. Det kommer i fase 4 eller som egne punkter i planen.

## Tabellene

Én rad per tabell i `src/db/schema` (19 tabeller). Alle tabeller med `organization_id` filtreres på organisasjonen fra tilgangssjekken, så ansatte ser bare egen organisasjon. «Admin» betyr rettigheten `organization.manage`, «leder og admin» betyr `staff.manage`.

| Tabell | Hva | Formål | Hvor | Hvor lenge | Hvem ser det |
|---|---|---|---|---|---|
| `users` | Navn, e-postadresse, om e-posten er bekreftet, bilde (tomt i dag), siste innlogging | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: beholdes så lenge den ansatte står på rapporter (minst 10 år) | Brukeren selv; admin via ansattlisten |
| `sessions` | IP-adresse, nettleser og enhet (user agent), bruker, utløpstid | Holde den ansatte innlogget | Database | Nå i koden: økten gjelder 30 dager og forlenges når den brukes (høyst én gang per døgn). Utløpte økter ligger til de ryddes, rydding er ikke bygd. Foreslått, bygges senere: se spørsmål nr. 18 | Ingen skjerm; bare drift med databasetilgang |
| `accounts` | Kobling mellom bruker og innloggingsmåte. Feltene for passord og nøkler fra andre tjenester er tomme, siden vi bare bruker engangskode på e-post | Innlogging | Database | Nå i koden: slettes aldri, ingen rydding. Foreslått, bygges senere: som `users` | Ingen skjerm |
| `verifications` | E-postadresse og innloggingskoden (lagret som hash, ikke i klartekst), utløpstid | Sende og sjekke innloggingskoden | Database | Nå i koden: koden gjelder i 10 minutter. Brukte og utløpte koder ligger til de ryddes, rydding er ikke bygd. Foreslått, bygges senere: se spørsmål nr. 18 | Ingen skjerm |
| `login_attempts` | E-postadressen som HMAC (ikke i klartekst), type forsøk, tidspunkt. Gjelder også fremmede som prøver å logge inn | Sperre innlogging etter mange feil koder | Database | Nå i koden: sperrevinduet er 15 minutter. Radene ligger til de ryddes, rydding er ikke bygd. Foreslått, bygges senere: slettes etter 24 timer (spørsmål nr. 15) | Ingen skjerm |
| `organizations` | Ingen personopplysninger (navn på organisasjonen, innstillinger) | Skille data mellom organisasjoner | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte i organisasjonen; admin endrer |
| `companies` | Ingen personopplysninger (selskapsnavn, organisasjonsnummer, adresse, forsikring) | Utsteder rapporten | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `offices` | Ingen personopplysninger (kontornavn og adresse) | Plassere ansatte | Database | Nå i koden: myk sletting, ingen rydding | Alle ansatte ser; admin endrer |
| `employees` | Navn, stillingstittel, selskap, kontor, kobling til bruker, når den ansatte sluttet | Vite hvem som jobber og står på rapporten | Database | Nå i koden: myk sletting; «Har sluttet» stopper innlogging, men raden blir stående. Foreslått, bygges senere: minst 10 år etter siste rapport | Alle ansatte ser listen; admin endrer |
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
| *Kommer i fase 2a: oppdrag, parter, eiendom, bilder, egenerklæring* | Opplysninger om kunder, eiere, kjøpere og eiendommen, og bilder fra befaringen | Lage og levere rapporten | Database og fillagring, utkast på iPaden | Foreslått, bygges senere: minst 10 år (Ståle 25.10 og 27.10.2026), med myk sletting | Alle ansatte (`access.inspectors_edit_all`); reklamasjonssaker bare leder og admin |

## Hvor

- **Database og fillagring:** Azure, region Sweden Central (EU/EØS). Fillagring i Azure Blob Storage er bygd i koden, men ikke slått på ennå; til da ligger filene i en lokal mappe på serveren.
- **E-post:** innloggingskoder sendes via Microsoft 365. Til det er koblet til, vises koden i utviklingspostkassen lokalt eller i serverloggen for første admin.
- **iPaden:** i nettleserens database (IndexedDB, `src/modules/offline-trial/sync`). Utkast og bilder ligger der til de er synket. Originalbildet slettes fra iPaden når serveren har bekreftet det; svarene og visningskopiene blir liggende.

## iPaden

Lokal lagring tømmes **ikke** ved utlogging i dag. Utloggingsknappen avslutter bare økten. Funksjonene som tømmer iPaden (`clearLocalPhotos`, `clearElectricStorage`) kalles bare når en person fra en annen organisasjon logger inn på samme iPad (`select-store.ts`).

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
- `login_attempts`, utløpte økter og `verifications`: ligger til de ryddes, rydding er ikke bygd. Se spørsmål nr. 15 (innloggingsforsøk) og nr. 18 (utløpte økter og koder).
- `audit_log` og `events` ryddes aldri (A58).
- Myk sletting (`deleted_at`) gjelder alt. Ingenting slettes permanent av appen i dag.
- Oppbevaringstidene for filer står som innstillinger (`src/core/files/retention.ts`): avviksbilder i original 10 år, andre originaler 2 år, komprimerte kopier 10 år. Fristen (`retain_until`) regnes ikke ut ennå, så i dag ryddes ingen filer.

**Foreslått, bygges senere:**

- Rapporter, bilder og måledata: minst 10 år (Ståle 25.10 og 27.10.2026), med filtidene over.
- Innloggingsforsøk: 24 timer (spørsmål nr. 15).
- Utløpte økter og koder: avgjøres i spørsmål nr. 18.
- `trial_*` er eneste unntak fra myk sletting, fordi dataene er oppdiktede (merknaden 28.10.2026, ikke presedens).

## Prøvedata

Hvordan prøvedata fra betaen merkes og ryddes, står i [sletting-av-betadata.md](sletting-av-betadata.md). Kort: prøvedata ligger i en egen prøveorganisasjon (A57), bare admin rydder, og admin-brukeren og admins ansatt-rad myk-slettes aldri (A59).
