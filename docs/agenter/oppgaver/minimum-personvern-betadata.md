# Funksjon: Intern personvernerklæring og regel for sletting av betadata

- **Fase:** Minimum før ekte data
- **Modul:** kjerne (bare dokumenter)
- **Status:** klar til bygging (rundet av forenkler og test-leder 04.11.2026)
- **Branch:** `minimum-personvern-betadata` (bygger på main)
- **Støtter hovedmål:** Reklamasjoner: klar oppbevaring gjør at rapporter, bilder og logg finnes i 10 år når en sak kommer. Tid: prøvedata blandes ikke inn i ekte oppdrag, så ingen må lete eller rydde for hånd. KI først: se under.

## Problem
Før første ekte oppdrag legges inn (fase 2a) må Byggcon kunne si kort hva EzProp lagrer om personer, hvorfor, hvor og hvor lenge. Betaen har også prøvedata (fase 1-tabellene `trial_*`, oppdiktede brukere og filer) som ikke skal blandes med ekte data. Uten en skrevet regel blir prøvedata liggende sammen med ekte data, eller noen sletter ekte data ved en feil.

## KI først
Agentene lager begge utkastene ut fra det som faktisk finnes i `src/db/schema`, filtjenesten, `login_attempts`, revisjonsloggen og lagringen på iPaden, og ut fra researchen. Daglig leder leser og godkjenner.

## Brukerhistorier
- Som **daglig leder** vil jeg **ha én kort side om personvern i EzProp** slik at jeg kan svare ansatte og kunder og godkjenne at ekte data legges inn.
- Som **admin** vil jeg **vite hvordan prøvedata merkes og ryddes** slik at bare ekte oppdrag blir igjen når piloten starter.

## Omfang
**Med:**
- `docs/personvern/intern-personvernerklaering.md`, merket «utkast, ikke godkjent av Ståle» øverst. Én tabell med én rad per tabell i `src/db/schema` (alle 19: `users`, `sessions`, `accounts`, `verifications`, `login_attempts`, `organizations`, `companies`, `offices`, `employees`, `employee_roles`, `employee_permissions`, `certifications`, `files`, `events`, `audit_log`, `integration_connections`, `trial_forms`, `trial_answers`, `trial_photos`). Kolonner: hva, formål (ett kort formål, ikke rettslig grunnlag), hvor, hvor lenge, hvem ser det (dagens tilgangsregler). Tabeller uten personopplysninger merkes «ingen personopplysninger».
- «Hvor»: Azure Sweden Central (database og fillagring), e-post via Microsoft 365, og **lokalt på iPaden** (nettleserens database, IndexedDB, i `src/modules/offline-trial/sync`) til utkast og bilder er synket. Det står hva som skjer ved utlogging og tapt iPad slik koden gjør i dag; det som ikke er avklart, føres som A-beslutning eller åpent spørsmål.
- «Hvor lenge» skiller mellom **det koden gjør nå** og **foreslått tid, bygges senere**. Koden i dag: økter 30 dager, innloggingskode går ut etter noen minutter, sperrevindu 15 minutter for innloggingsforsøk, men ingenting rydder `login_attempts` eller utløpte økter («ligger til de ryddes, rydding er ikke bygd»). Filer etter `src/core/files/retention.ts`: avviksbilder i original 10 år, andre originaler 2 år, komprimerte kopier 10 år. Rapporter, bilder og måledata minst 10 år (Ståle 25.10 og 27.10.2026).
- Én samlet rad for det som kommer i fase 2a (oppdrag, parter, eiendom, bilder, egenerklæring), uten detaljer fra branchen `fase2a-manuell-ordre`.
- `docs/personvern/sletting-av-betadata.md`, merket «utkast, ikke godkjent av Ståle». Hva som regnes som prøvedata; **én** måte å merke det på: en egen prøveorganisasjon (bruker organisasjons-ID-en som finnes fra før, ingen nye felt); rydding med myk sletting (`deleted_at`); bare admin kan rydde; `audit_log` og `events` ryddes aldri; `trial_*` er eneste unntak fordi dataene er oppdiktede (merknaden 28.10.2026, ikke presedens).
- Beslutninger agentene tar, føres i `docs/09-apne-sporsmal.md` fra A56.
- Lenke fra planen, kryss av de to punktene, oppdatert tilstandsfil, versjon 0.2.70 i `package.json`.

**Ikke med (bevisst utelatt):**
- Kode, migrering, skjerm eller knapp for opprydding (bygges senere).
- Nye oppbevaringstider for innloggingsforsøk og utløpte økter (føres som åpent spørsmål, se under).
- Rettslig grunnlag, behandlingsprotokoll, vurdering av personvernkonsekvenser for KI, opplæring og ekstern personvernerklæring for kunder (fase 4).
- Databehandleravtaler (eget punkt i fasen, Ståle må signere).
- Tekst fra NS 3600, IVIT eller SmartTakst, og juridisk rådgivning.
- Filene til branchen `fase2a-manuell-ordre` (A51–A55, migrering 0013, versjon 0.2.69) røres ikke.

## Tilgang
Ingen endring. Dokumentet beskriver dagens regler: alle ansatte ser og kan endre oppdrag (`access.inspectors_edit_all`), reklamasjonssaker bare leder og admin, opprydding av prøvedata bare admin. Når oppryddingen bygges, kreves tester for at bare admin kan rydde, tenant-isolasjon og at admin ikke stenges ute.

## Data
Ingen nye tabeller eller felt. Prøveorganisasjonen beskrives som forslag til senere bygging.

## Skjermer
Ingen.

## Regler
Ingen regler som data.

## Akseptkriterier
- [ ] Begge filene finnes i `docs/personvern/`, er merket «utkast, ikke godkjent av Ståle» øverst, og erklæringen har høyst cirka 900 ord utenom tabellen.
- [ ] Alle 19 tabellene i `src/db/schema` (navnene i `pgTable`) står i erklæringen; de uten personopplysninger er merket «ingen personopplysninger».
- [ ] «Hvor lenge» skiller mellom det koden gjør nå og foreslått tid. Ingen opprydding påstås som ikke finnes. Tidene stemmer med `src/core/auth/auth.ts`, `src/core/auth/login-throttle.ts` og `src/core/files/retention.ts`, og med Ståles svar 25.10 og 27.10.2026.
- [ ] Lagring på iPaden (IndexedDB) er med, sammen med hva som skjer ved utlogging og tapt iPad, eller et åpent spørsmål om det.
- [ ] Sletteregelen bruker bare myk sletting for alt annet enn `trial_*`, og sier at `audit_log` og `events` aldri ryddes.
- [ ] Sletteregelen sier at prøvedata aldri plukkes ut av ekte oppdrag ut fra innholdet; bare det som ligger i prøveorganisasjonen ryddes. Oppryddingen myk-sletter aldri admin-brukeren eller admins ansatt-rad.
- [ ] Ingen kundeopplysninger, navn på ekte personer (bruk rollen «daglig leder») eller hemmeligheter i filene.
- [ ] Ingen modellnavn og ingen tekst fra NS 3600, IVIT eller SmartTakst.
- [ ] Beslutningene står i tabellen «Avgjort av agentene» fra A56, uten konflikt med A51–A55, og planpunktene er krysset av med lenke.
- [ ] `git diff main` viser ingen endringer i filene til `fase2a-manuell-ordre` og ingen migrering 0013.
- [ ] `pnpm lint`, `pnpm typecheck` og `pnpm test` er grønne (inkludert `tests/tenant-isolation-all-tables.test.ts`); `pnpm test:e2e` kjøres én gang fordi versjonen vises i `/api/helse`.

## Testplan
- Ingen nye automatiske tester: ingen ny spørring og ingen ny tabell, så `expectTenantIsolation` og `tests/tenant-tables.ts` endres ikke.
- `src/core/health/health.test.ts` og `e2e/fase-0a.spec.ts` må tåle versjon 0.2.70.
- Manuell sjekkliste: tabellene mot schema, tidene mot `auth.ts`, `login-throttle.ts` og `retention.ts`, myk sletting med `trial_*` som eneste unntak, `audit_log` og `events` ryddes aldri, A56 og utover riktig nummerert, og diffen mot `fase2a-manuell-ordre`.

## Åpne spørsmål (føres i `docs/09-apne-sporsmal.md`)
- Kontaktperson for personvern: rollen daglig leder (svar 25.10.2026 nr. 25). A-beslutning, kan endres.
- Hvor lenge innloggingsforsøk og utløpte økter skal ligge før de ryddes. Åpent spørsmål; erklæringen sier at rydding ikke er bygd.
- Om iPaden skal tømmes ved utlogging, og hva som gjelder ved tapt iPad (funksjonen for å tømme lokal lagring finnes, men kalles ikke ved utlogging i dag). Åpent spørsmål.

## Avgjort i rundingen (prosjektleder 04.11.2026)
- Alle forslagene fra forenkler og test-leder er tatt inn. De trakk i samme retning: beskriv det koden gjør, ikke lov noe nytt.
- Merking av prøvedata: egen prøveorganisasjon, fordi den bruker organisasjons-ID-en som allerede finnes og ikke krever nytt felt. Alternativet (merke på oppdraget) nevnes som én linje i A-beslutningen.
- Tabelltelling: test-leder skrev «17 tabeller» med `trial_*` som én; kortet krever alle 19 `pgTable`-navn, så listen kan sjekkes uten skjønn.
- Kolonnen «hvem ser det» beholdes (forenkler), siden den bare gjentar dagens tilgangsregler. Rettslig grunnlag tas ut (fase 4).
- Setningen om at KI holder erklæringen oppdatert senere er tatt ut (fase 4).

## Roller
Prosjektleder (kort og PR), utvikler (skriver de to dokumentene ut fra skjemaet og koden), sikkerhetsrådgiver (sjekker at erklæringen stemmer med det som faktisk lagres og at sletteregelen ikke åpner for permanent sletting). Ingen arkitekt, UX, UI eller KI-rolle.
