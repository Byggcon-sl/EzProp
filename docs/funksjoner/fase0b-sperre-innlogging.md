# Funksjon: Sperre etter mange feil ved innlogging

- **Fase:** 0b (innspill P12)
- **Modul:** kjerne (`src/core/auth`)
- **Status:** utkast (autonom modus, avgjort av agentene)
- **Branch:** `fase0b-sperre-innlogging` fra `main`. Versjon **0.2.49** (PR #59 med revisjonsloggen har 0.2.48 og venter på merge).
- **Bygger på:** `main` (ikke på PR #59).
- **Støtter hovedmål:** Reklamasjoner: indirekte. En konto som blir tatt over, kan endre eller publisere rapporter i en takstmanns navn. Sperren gjør det mye vanskeligere å gjette seg til en kode, og beskytter rapportene og signaturen. Tid: ingen ekstra trykk for den som skriver riktig kode. KI først: se under.

## Problem
Innloggingen er en sekssifret kode på e-post. I dag finnes to vern: Better Auth gir hver kode tre forsøk, og Better Auths egen fartsgrense (`rateLimit`) teller forsøk per IP-adresse i minnet på én server. Det holder ikke:
- Den som bestiller ny kode, får tre nye forsøk. Med mange bestillinger kan man prøve mange koder mot samme adresse.
- Fartsgrensen ligger i minnet og nullstilles ved omstart og ved flere servere i Azure. Den er av lokalt og i e2e (`DEV_MAILBOX`), så den er ikke testet.
- Det finnes ingen tydelig melding om når man kan prøve igjen.

Lar vi være, står innloggingen svakere enn i Optiplan til tofaktor kommer i fase 4 (mål 11).

## KI først
Nei. Dette er en fast sikkerhetsregel uten skjønn. KI skal ikke avgjøre hvem som slipper inn. Takstmannen merker ingenting så lenge koden er riktig.

## Brukerhistorier
- Som **takstmann** vil jeg at ingen kan gjette seg til koden min, slik at rapportene jeg signerer ikke kan endres av andre.
- Som **takstmann som har skrevet feil kode flere ganger** vil jeg se nøyaktig når jeg kan prøve igjen, slik at jeg ikke må ringe noen.
- Som **admin** vil jeg aldri bli stengt ute for godt, slik at jeg alltid kommer inn igjen, også om noen prøver å sperre meg med vilje.

## Omfang
**Med:**
- Egen sperre per e-postadresse, lagret i databasen (virker likt på alle servere, etter omstart, og uavhengig av om Better Auths `rateLimit` er på).
- **Feil koder:** 5 feil koder på samme adresse innen 15 minutter gir sperre i 15 minutter. Sperren gjelder både bestilling av ny kode og innlogging med kode.
- **Bestilling av koder:** høyst 5 koder per adresse innen 15 minutter. Den sjette bestillingen avvises med tidspunkt for neste mulige.
- Sperren går ut av seg selv (ingen varig sperre, gjelder alle, også admin). Riktig kode etter at sperren er ute, nullstiller tellingen.
- Samme svar om adressen finnes eller ikke (ingen avsløring av hvem som er ansatt). Tellingen skjer også for ukjente adresser.
- E-postadressen lagres ikke i klartekst i sperretabellen, bare en HMAC (med `BETTER_AUTH_SECRET`) av adressen med små bokstaver og uten mellomrom rundt.
- Sjekken ligger i `src/core/auth` som én modul (for eksempel `login-throttle.ts`), koblet inn med Better Auths `hooks.before`/`hooks.after` på stiene `/email-otp/send-verification-otp` og `/sign-in/email-otp`. Ingen logikk i skjema eller side.
- Svar med status 429 og en norsk melding med klokkeslett, for eksempel: «For mange feil koder. Du kan prøve igjen kl. 14:35.» (norsk tid, `Europe/Oslo`). Innloggingsskjemaet viser meldingen fra serveren i stedet for dagens faste tekst «Vent ett minutt».
- Grensene (5, 5, 15 minutter) står som konstanter ett sted, slik at de kan endres uten å lete.
- Tester: enhetstester for regnestykket (grenser, utløp, nullstilling, store/små bokstaver), integrasjonstester mot testdatabasen, og én e2e som viser meldingen etter for mange feil koder (med utviklings-postkassen, ingen ekte e-post).
- Migrering for den nye tabellen. Ordlisten i `docs/05-domenemodell.md` oppdateres.

**Ikke med (bevisst utelatt):**
- Tofaktor (fase 4).
- Sperre per IP-adresse (Better Auths `rateLimit` står som i dag i drift).
- Knapp for admin til å oppheve en sperre, og liste over sperrer i adminområdet.
- E-post eller varsel til brukeren eller admin om sperre.
- Hendelse i hendelsesloggen (`events`): tabellen kommer med PR #59, som ikke er merget. Legges til senere som liten oppgave.
- Opprydding av gamle rader (radene er små, ingen kundeopplysninger; tas senere om nødvendig).
- Endringer i Optiplan eller felles innlogging (egen oppgave i fase 0b).
- CAPTCHA eller lignende.

## Tilgang
Gjelder før innlogging, altså uten rolle. Alle (takstmann, kontor, leder, admin) får samme sperre, og den går ut av seg selv. Ingen ser eller endrer sperretabellen i grensesnittet.

| Rolle | Se | Endre |
|---|---|---|
| takstmann | Bare meldingen om sin egen sperre | Nei |
| kontor | Som takstmann | Nei |
| leder | Som takstmann | Nei |
| admin | Som takstmann | Nei (sperren går ut av seg selv, admin stenges aldri ute for godt) |

## Data
Ny tabell **`login_attempts`** (systemtabell for innloggingen, som `sessions` og `verifications`):

| Felt | Betydning |
|---|---|
| `id` | Id |
| `email_hash` | HMAC av e-postadressen (aldri klartekst) |
| `kind` | `code_requested` eller `code_failed` |
| `created_at` | Når |

Indeks på `(email_hash, kind, created_at)`. Ingen `organization_id`: før innlogging vet vi ikke hvilken organisasjon personen hører til, og raden inneholder ingen data om organisasjonen. Samme unntak som Better Auths egne tabeller. Ingen myk sletting trengs (radene endres aldri). Ingen nye faste koder (`key`).

## Skjermer
Bare `/logg-inn`: feilmeldingen i begge stegene viser meldingen fra serveren ved 429. Ingen nye trykk.

## Regler
Ingen fagregler. Sperreregelen er kode med testsaker:
1. 4 feil koder på 15 minutter: neste forsøk slipper gjennom.
2. 5 feil koder på 15 minutter: sperret; meldingen viser klokkeslett = tidspunktet for den 5. feilen + 15 minutter.
3. Etter at sperren er ute: slipper gjennom igjen.
4. Riktig kode: tellingen av feil nullstilles.
5. 5 bestillinger på 15 minutter: den 6. avvises med klokkeslett.
6. `Ola@Eksempel.no ` og `ola@eksempel.no` regnes som samme adresse.
7. Ukjent adresse telles og får samme svar som kjent adresse.
8. Sperren virker selv om Better Auths `rateLimit` er av.

## Akseptkriterier
- [ ] Etter 5 feil koder innen 15 minutter avvises både ny bestilling og innlogging med status 429 og norsk melding med klokkeslett (test).
- [ ] Høyst 5 kodebestillinger per adresse per 15 minutter (test).
- [ ] Sperren går ut av seg selv; en admin kommer inn igjen etter utløp (test).
- [ ] Riktig kode nullstiller tellingen (test).
- [ ] Sperren virker med `rateLimit` av (integrasjonstest og e2e kjører med `DEV_MAILBOX=1`).
- [ ] E-postadressen står ikke i klartekst i `login_attempts` (test).
- [ ] Samme svar for kjent og ukjent adresse (test).
- [ ] Ingen e-post til ekte mottakere; e2e bruker utviklings-postkassen.
- [ ] Ingen ny avhengighet. Versjon 0.2.49.
- [ ] Bruker i annen organisasjon får ikke tilgang: ikke relevant, tabellen har ingen organisasjonsdata og leses bare av sperresjekken (begrunnes i PR-en).
- [ ] Virker på iPad-størrelse (e2e: meldingen vises på `/logg-inn`).

## Avgjort av agentene (føres i `docs/09-apne-sporsmal.md`)
- **A35** Grensene: 5 feil koder eller 5 bestillinger per adresse på 15 minutter gir 15 minutters sperre som går ut av seg selv. Hvorfor: vanlig nivå for engangskoder, gir rom for skrivefeil, og admin stenges aldri ute for godt (CLAUDE.md regel 11). Kilde: innspill P12, `spectora-detaljer.md` (sperre etter gjentatte feil). Endres i konstantene i `src/core/auth`.
- **A36** Sperren lagres per e-postadresse som HMAC i en egen tabell uten organisasjons-ID. Hvorfor: virker på alle servere og etter omstart, og lagrer ikke adresser fra fremmede som prøver seg. Endres med ny migrering.

## Roller
- `utvikler`: tabell, migrering, sperremodul, kroker i `auth.ts`, melding i skjemaet.
- `testskriver` (parallelt): enhets-, integrasjons- og e2e-tester etter «Regler» over.
- `sikkerhet-personvern`: gjennomgang (innlogging, HMAC, ingen avsløring av ansatte, admin ikke stengt ute).

## Åpne spørsmål
- Ingen som stopper oppgaven. Om admin skal kunne oppheve en sperre manuelt, vurderes etter at Ståle har sett A35.
