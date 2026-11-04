# Funksjon: Intern personvernerklæring og regel for sletting av betadata

- **Fase:** Minimum før ekte data
- **Modul:** kjerne (bare dokumenter)
- **Status:** utkast
- **Støtter hovedmål:** Reklamasjoner: ryddige data og klar oppbevaring gjør at rapporter, bilder og logg finnes i 10 år når en sak kommer. Tid: takstmannen slipper å lure på hva som kan lagres, og prøvedata blandes ikke inn i ekte oppdrag. KI først: se under.

## Problem
Før første ekte oppdrag legges inn (fase 2a) må Byggcon kunne si kort hva EzProp lagrer om personer, hvorfor, hvor og hvor lenge. Betaen har også prøvedata (fase 1-tabellene `trial_*`, oppdiktede brukere og filer) som ikke skal blandes med ekte data. Uten en skrevet regel blir prøvedata liggende sammen med ekte data, eller noen sletter ekte data ved en feil.

## KI først
Agentene lager begge utkastene ut fra det som faktisk finnes i `src/db/schema`, filtjenesten, `login_attempts` og revisjonsloggen, og ut fra researchen. Ståle leser og godkjenner. Senere (fase 4) kan KI holde erklæringen oppdatert når nye tabeller kommer, men det bygges ikke nå.

## Brukerhistorier
- Som **daglig leder** vil jeg **ha én kort side om personvern i EzProp** slik at jeg kan svare ansatte og kunder og godkjenne at ekte data legges inn.
- Som **admin** vil jeg **vite hvordan prøvedata merkes og ryddes** slik at bare ekte oppdrag blir igjen når piloten starter.

## Omfang
**Med:**
- `docs/personvern/intern-personvernerklaering.md`, merket «utkast, ikke godkjent av Ståle». Kort tabell per datagruppe: hva, hvorfor (formål og grunnlag), hvor (Azure Sweden Central, database og fillagring, e-post via Microsoft 365), hvor lenge, hvem ser det. Bygd på det som lagres i dag: `users`, `sessions`, `accounts`, `verifications`, `login_attempts` (e-post som hash), `employees`, `employee_roles`, `employee_permissions`, `certifications`, `organizations`, `companies`, `offices`, `files` (inkludert at GPS i bildedata ikke skal i PDF), `events`, `audit_log`, `integration_connections`, `trial_*`. Egen linje for det som kommer i fase 2a (oppdrag, parter, eiendom, bilder, egenerklæring), slik at erklæringen ikke må skrives om.
- Oppbevaringstidene fra Ståles svar: rapporter, bilder og måledata minst 10 år; avviksbilder i original 10 år, andre originaler 2 år, komprimert 10 år (innstillinger, 27.10.2026). Korte tider for innloggingsdata der koden allerede har dem.
- `docs/personvern/sletting-av-betadata.md`, merket «utkast, ikke godkjent av Ståle». Hva som regnes som prøvedata, hvordan det merkes (for eksempel en egen prøveorganisasjon eller et merke på oppdraget), at det ryddes med myk sletting (`deleted_at`), hvem som kan gjøre det (admin), at revisjonsloggen og `events` aldri ryddes, og at `trial_*`-tabellene er eneste unntak fordi dataene er oppdiktede (merknaden 28.10.2026, ikke presedens).
- Beslutninger agentene tar, føres i `docs/09-apne-sporsmal.md` fra A56.
- Lenke fra planen, kryss av de to punktene, oppdatert tilstandsfil, versjon 0.2.70 i `package.json`.

**Ikke med (bevisst utelatt):**
- Kode, migrering, skjerm eller knapp for opprydding (bygges senere).
- Behandlingsprotokoll, vurdering av personvernkonsekvenser for KI, opplæring og ekstern personvernerklæring for kunder (fase 4).
- Databehandleravtaler (eget punkt i fasen, Ståle må signere).
- Tekst fra NS 3600, IVIT eller SmartTakst, og juridisk rådgivning.
- Filene til branchen `fase2a-manuell-ordre` (A51–A55, migrering 0013, versjon 0.2.69) røres ikke.

## Tilgang
Ingen endring. Dokumentet beskriver dagens regler: alle ansatte ser og kan endre oppdrag (`access.inspectors_edit_all`), reklamasjonssaker bare leder og admin, opprydding av prøvedata bare admin.

## Data
Ingen nye tabeller eller felt. Hvordan prøvedata skal merkes, beskrives som forslag til senere bygging.

## Skjermer
Ingen.

## Regler
Ingen regler som data.

## Akseptkriterier
- [ ] Begge filene finnes, er merket «utkast, ikke godkjent av Ståle» øverst, og er korte (erklæringen kan leses på fem minutter).
- [ ] Hver tabell i `src/db/schema` som har personopplysninger, er nevnt i erklæringen med hva, hvorfor, hvor og hvor lenge.
- [ ] Oppbevaringstidene stemmer med Ståles svar 25.10 og 27.10.2026 og med det koden gjør i dag (for eksempel `login_attempts`, økter, filer slettes aldri).
- [ ] Sletteregelen bruker bare myk sletting for alt annet enn `trial_*`, og sier at `audit_log` og `events` aldri ryddes.
- [ ] Ingen kundeopplysninger, navn på ekte personer eller hemmeligheter i filene.
- [ ] Beslutningene står i tabellen «Avgjort av agentene» fra A56, og planpunktene er krysset av med lenke.
- [ ] `pnpm lint` og `pnpm test` er grønne (ingen kodeendring, bare versjon).

## Åpne spørsmål
- Hvem er kontaktperson for personvern i Byggcon (forslag: Ståle som daglig leder, svar 25.10.2026 nr. 25). Føres som A-beslutning, kan endres.
- Hvor lenge innloggingsforsøk og utløpte økter skal ligge før de ryddes. Agentene foreslår ut fra dagens kode og fører beslutningen.

## Roller
Prosjektleder (kort og PR), utvikler (skriver de to dokumentene ut fra skjemaet og koden), sikkerhetsrådgiver (sjekker at erklæringen stemmer med det som faktisk lagres og at sletteregelen ikke åpner for permanent sletting). Ingen arkitekt, UX, UI eller KI-rolle.
