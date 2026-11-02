# Funksjon: Sperre etter mange feil ved innlogging

- **Fase:** 0b (innspill P12)
- **Modul:** kjerne (`src/core/auth`)
- **Status:** klar for bygging (autonom modus, avgjort av agentene, gjennomgått av forenkler, sikkerhet-personvern og test-leder 31.10.2026)
- **Branch:** `fase0b-sperre-innlogging` fra `main`. Versjon **0.2.49** (main har 0.2.48 etter at PR #59 med revisjonsloggen ble merget 31.10.2026).
- **Bygger på:** `main` (PR #59 er merget, tabellen `events` finnes på main).
- **Støtter hovedmål:** Reklamasjoner: indirekte. En konto som blir tatt over, kan endre eller publisere rapporter i en takstmanns navn. Sperren gjør det mye vanskeligere å gjette seg til en kode, og beskytter rapportene og signaturen. Tid: ingen ekstra trykk for den som skriver riktig kode. KI først: se under.

## Problem
Innloggingen er en sekssifret kode på e-post. I dag finnes to vern: Better Auth gir hver kode tre forsøk, og Better Auths egen fartsgrense (`rateLimit`) teller forsøk per IP-adresse i minnet på én server. Det holder ikke:
- Den som bestiller ny kode, får tre nye forsøk. Med mange bestillinger kan man prøve mange koder mot samme adresse.
- Better Auth åpner flere endepunkter som tar e-post og kode. `/email-otp/check-verification-otp` godtar `type: "sign-in"`, bruker ikke opp koden og teller forsøk uten låsing. Der kan koden gjettes med mange samtidige forespørsler.
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
- Egen sperre per e-postadresse, lagret i databasen (virker likt på alle servere, etter omstart, og uavhengig av om Better Auths `rateLimit` er på). Det finnes **ikke** noe miljøflagg som slår sperren av, heller ikke i e2e.
- **Feil koder:** 5 feil koder på samme adresse innen 15 minutter gir sperre i 15 minutter fra den 5. feilen. Sperren gjelder både bestilling av ny kode og innlogging med kode.
- **Bestilling av koder:** høyst 5 koder per adresse innen 15 minutter (glidende vindu). Den 6. bestillingen avvises med tidspunkt for neste mulige.
- **Riktig kode nullstiller** både feil og bestillinger for adressen. Det gjøres uten å slette noe: det lagres en rad `login_succeeded`, og bare rader etter den siste slike raden telles.
- Sperren går ut av seg selv (ingen varig sperre, gjelder alle, også admin).
- Samme svar om adressen finnes eller ikke (ingen avsløring av hvem som er ansatt). Tellingen skjer også for ukjente adresser.
- **Bare to innloggingsendepunkter er åpne:** i `hooks.before` avvises alle stier under `/email-otp/*` og `/forget-password/*` med 404, unntatt `/email-otp/send-verification-otp`. `/sign-in/email-otp` er fortsatt åpen. Da kan koden ikke prøves noe annet sted enn der sperren gjelder.
- E-postadressen lagres ikke i klartekst, bare en HMAC-SHA256. Nøkkelen avledes fra `BETTER_AUTH_SECRET` med prefikset `login-throttle:` (den rå hemmeligheten brukes ikke direkte). Adressen normaliseres som i Better Auth: `trim()` og deretter `toLowerCase()`. Byttes hemmeligheten, nullstilles alle sperrer. Det er greit.
- Sjekken ligger i `src/core/auth/login-throttle.ts`, koblet inn med Better Auths `hooks.before`/`hooks.after` på `/email-otp/send-verification-otp` og `/sign-in/email-otp`. Ingen logikk i skjema eller side.
- Svar med status 429 og en norsk melding med klokkeslett i norsk tid (`Europe/Oslo`):
  - feil koder: «For mange feil koder. Du kan prøve igjen kl. 14:35.»
  - bestillinger: «For mange koder bestilt. Du kan be om ny kode kl. 14:35.»
  Innloggingsskjemaet viser meldingen fra serveren i stedet for dagens faste tekst «Vent ett minutt», som fjernes.
- Grensene (5 feil, 5 bestillinger, 15 minutter) står som konstanter ett sted i `login-throttle.ts`.
- Logging med `src/shared/lib/logger.ts`: bare at en sperre slo inn, med rute og tidspunkt. Aldri e-post eller hash.
- Migrering for den nye tabellen. `login_attempts` legges inn i `resetDatabase()` i `tests/factories.ts`. Ordlisten i `docs/05-domenemodell.md` oppdateres.

**Ikke med (bevisst utelatt):**
- Tofaktor (fase 4).
- Sperre per IP-adresse (Better Auths `rateLimit` står som i dag i drift).
- Knapp for admin til å oppheve en sperre, og liste over sperrer i adminområdet.
- E-post eller varsel til brukeren eller admin om sperre.
- Hendelse i hendelsesloggen (`events`): tabellen finnes nå på main (PR #59), men hendelse ved sperre holdes utenfor for å holde PR-en liten. Legges til som egen liten oppgave.
- Opprydding av gamle rader. Forslaget er sletting etter 24 timer (A38), men det bygges senere.
- Endringer i Optiplan eller felles innlogging (egen oppgave i fase 0b).
- CAPTCHA eller lignende.

## Tilgang
Gjelder før innlogging, altså uten rolle. Sperren leser aldri roller, så alle (takstmann, kontor, leder, admin) får samme sperre, og den går ut av seg selv. Ingen ser eller endrer sperretabellen i grensesnittet.

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
| `kind` | `code_requested`, `code_failed` eller `login_succeeded` |
| `created_at` | Når |

Indeks på `(email_hash, kind, created_at)`. Ingen `organization_id`: før innlogging vet vi ikke hvilken organisasjon personen hører til, og raden inneholder ingen data om organisasjonen. Samme unntak som Better Auths egne tabeller. Ingen myk sletting trengs (radene endres aldri, og slettes ikke i denne oppgaven). Ingen IP-adresse lagres. Ingen nye faste koder (`key`).

## Slik virker det (for utvikler)
1. **`before`** på begge stiene: i én transaksjon, ta `pg_advisory_xact_lock` på hashen, les tellingen og avgjør.
   - Sperret: svar 429 med melding. Forsøket **lagres ikke**, så sperren blir ikke forlenget.
   - Ikke sperret: sett inn raden (`code_requested` eller `code_failed`) i samme transaksjon, og slipp videre til Better Auth.
   Låsen gjør at samtidige forsøk ikke kan komme forbi grensen.
2. **`after`** på `/sign-in/email-otp`: lyktes innloggingen (ny session), sett inn `login_succeeded`. Da teller ikke forsøket som feil lenger, og både feil og bestillinger nullstilles.
3. **Hva er en feil kode:** alle forsøk på `/sign-in/email-otp` som ikke gir innlogging (feil kode, for mange forsøk på koden, utløpt kode, ukjent adresse). De telles fordi raden settes inn i `before` og ikke følges av `login_succeeded`.
4. **Klokke:** sperremodulen tar `now` som parameter, så utløp kan testes uten å vente.

## Regler
Ingen fagregler. Sperreregelen er kode med testsaker. Bare rader etter siste `login_succeeded` for adressen telles.
1. 4 feil koder på 15 minutter: neste forsøk slipper gjennom.
2. 5 feil koder der den eldste og nyeste er høyst 15 minutter fra hverandre: sperret til den 5. (nyeste) feilen + 15 minutter. Meldingen viser det klokkeslettet.
3. Ved nøyaktig sperretid + 15:00 slipper man gjennom; ved 14:59 er man sperret.
4. Forsøk mens sperren gjelder, avvises før Better Auth og lagres ikke (sperren forlenges ikke).
5. Riktig kode nullstiller både feil og bestillinger.
6. 5 bestillinger på 15 minutter: den 6. avvises. Neste mulige = eldste bestilling i vinduet + 15 minutter.
7. `Ola@Eksempel.no ` og `ola@eksempel.no` regnes som samme adresse.
8. Ukjent adresse telles og får samme 429-svar som kjent adresse.
9. Sperren virker selv om Better Auths `rateLimit` er av.
10. Andre `/email-otp/*`- og `/forget-password/*`-stier enn `send-verification-otp` gir 404.

## Testplan
**Enhetstester (`login-throttle.test.ts`)**, med fast `now`:
- regel 1–7
- grensen nøyaktig ved 14:59 og 15:00
- klokkeslett i `Europe/Oslo` både sommer- og vintertid, med datoer rundt 25.10.2026
- at grensene leses fra konstantene

**Integrasjonstester mot testdatabasen**, gjennom `auth.handler`/`auth.api`, så det er vist at krokene er koblet inn:
- a) 5 feil gir 429 med norsk melding, både på bestilling og innlogging. Better Auth gir bare 3 forsøk per kode, så testen bestiller ny kode underveis.
- b) riktig kode mens sperren gjelder gir 429 og ingen ny rad i `sessions`
- c) 6. bestilling gir 429, ingen ny rad i `verifications` og ingen e-post
- d) en admin (seed-rolle) sperres, og kommer inn igjen etter utløp (tilbakedaterte `created_at`). Én test dekker både «går ut av seg selv» og regel 11.
- e) riktig kode nullstiller tellingen (feil og bestillinger)
- f) kjent og ukjent adresse gir samme 429-svar (status og tekst). Gir Better Auth ulik tekst under grensen, noteres det i PR-en, men endres ikke her.
- g) `login_attempts` har ingen kolonne med adressen, og `Ola@Eksempel.no ` gir samme hash som `ola@eksempel.no`
- h) testene kjører med `rateLimit` av (sjekk at miljøet gir `enabled=false`)
- i) forsøk under sperren forlenger den ikke
- j) 10 samtidige feil forsøk: høyst 5 slipper gjennom til Better Auth
- k) `/email-otp/check-verification-otp` (og en av de andre stengte stiene) gir 404
- l) sperre på adresse A påvirker ikke adresse B, også når A og B er i hver sin organisasjon (erstatter `expectTenantIsolation`, se under)

**e2e (`e2e/fase-0b-sperre-innlogging.spec.ts`)**: én test, som kjører i både pc- og ipad-prosjektet. Den bruker en oppdiktet, ukjent adresse som er unik per prosjekt og kjøring (aldri `ADMIN_EMAIL`), ber om kode og skriver 5 feil koder. Deretter vises «For mange feil koder. Du kan prøve igjen kl. HH:MM.» i skjemaet, og «Vent ett minutt» finnes ikke. Bare utviklings-postkassen brukes. Hele e2e-pakken skal være grønn etterpå (viser at nullstillingen holder `logIn()` i gang).

## Akseptkriterier
- [ ] Etter 5 feil koder innen 15 minutter avvises både ny bestilling og innlogging med status 429 og norsk melding med klokkeslett (test).
- [ ] Høyst 5 kodebestillinger per adresse per 15 minutter (test).
- [ ] Sperren går ut av seg selv; en admin kommer inn igjen etter utløp (test).
- [ ] Riktig kode nullstiller feil og bestillinger, uten sletting (test). Hele e2e-pakken er grønn.
- [ ] Forsøk under sperren forlenger den ikke (test).
- [ ] Samtidige forsøk kommer ikke forbi grensen (test).
- [ ] Andre kode-endepunkter i Better Auth er stengt (test).
- [ ] Sperren virker med `rateLimit` av (integrasjonstest og e2e kjører med `DEV_MAILBOX=1`). Ingen bryter som slår sperren av.
- [ ] E-postadressen står ikke i klartekst i `login_attempts`, og loggen inneholder verken adresse eller hash (test).
- [ ] Samme 429-svar for kjent og ukjent adresse (test).
- [ ] Ingen e-post til ekte mottakere; e2e bruker utviklings-postkassen.
- [ ] Ingen ny avhengighet. Versjon 0.2.49.
- [ ] Isolasjon: `expectTenantIsolation` passer ikke, fordi tabellen ikke har organisasjons-ID og leses bare av sperresjekken. Begrunnes i PR-en; test l erstatter.
- [ ] Virker på iPad-størrelse (e2e: meldingen vises på `/logg-inn`).

## Avgjort ved uenighet (prosjektleder)
- **Riktig kode nullstiller: beholdt** (forenkler ville kutte, test-leder og sikkerhet-personvern ville beholde). Uten nullstilling blir e2e røde: `logIn()` kalles 79 ganger, nesten alle med admin, og grensen på 5 bestillinger ville stenge resten ute. En bakdør i miljøet er ikke akseptabelt. Forenklerens innvending om sletting er løst med en tredje `kind` (`login_succeeded`) i stedet for å slette rader.
- **Tester for utløp og admin slått sammen** (forenkler): én integrasjonstest (d).
- **Én e2e-test** (forenkler), som kjører i pc og ipad. Bestillingsgrensen og like svar dekkes av integrasjonstester.
- **Ingen egen test per rolle** (test-leder foreslo fire roller): sperren leser aldri roller, og regel 11 er dekket av test d med admin. En rolletest ville bare teste at koden ikke gjør noe den ikke gjør.
- **Sikkerhetsfunnene tas alle med:** stengte endepunkter, lås mot samtidige forsøk, avledet nøkkel, logging uten adresse, og oppbevaring som spørsmål (A38).

## Avgjort av agentene (føres i `docs/09-apne-sporsmal.md`)
- **A35** Grensene: 5 feil koder eller 5 bestillinger per adresse på 15 minutter gir sperre som går ut av seg selv etter 15 minutter. Kjent ulempe: hvem som helst kan holde en kjent adresse sperret (også admin) ved å sende 5 feil koder hvert 15. minutt. Sperren er aldri varig, så regel 11 holdes.
- **A36** Sperren lagres per e-postadresse som HMAC i en egen tabell uten organisasjons-ID. Riktig kode nullstiller med en egen rad, ingenting slettes.
- **A37** Bare to kode-endepunkter i Better Auth er åpne; resten gir 404.
- **A38** Oppbevaring: radene er sikkerhetstellere, ikke fagdata, og tiårsregelen gjelder ikke dem. Agentene foreslår sletting etter 24 timer; det bygges senere. Ståle bekrefter (spørsmål 15).

## Roller
- `utvikler`: tabell, migrering, sperremodul, kroker og stengte stier i `auth.ts`, melding i skjemaet, `resetDatabase()`.
- `testskriver` (parallelt): enhets-, integrasjons- og e2e-tester etter «Testplan» over.
- `sikkerhet-personvern`: gjennomgang (endepunkter, lås, HMAC, logging, ingen avsløring av ansatte, admin ikke stengt ute).

## Åpne spørsmål
- Ingen som stopper oppgaven. Spørsmål 15 (hvor lenge radene lagres) og om admin skal kunne oppheve en sperre, står i `docs/09-apne-sporsmal.md`.
